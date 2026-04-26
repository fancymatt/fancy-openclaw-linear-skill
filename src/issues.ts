import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { linearGraphQL } from "./client";
import { getSelfUser } from "./auth";
import { ISSUE_FIELDS, STATE_BLOCK, ASSIGNEE_BLOCK, TEAM_BLOCK, DELEGATE_BLOCK } from "./fragments";
import { CreateIssueInput, Issue, UpdateIssueInput } from "./types";

interface IssueResponse {
  issue: Issue | null;
}

interface IssuesResponse {
  viewer: {
    assignedIssues: {
      nodes: Issue[];
    };
  };
}

interface SearchUsersResponse {
  users: {
    nodes: Array<{ id: string; name: string; email?: string | null }>;
  };
}

interface CreateIssueMutationResponse {
  issueCreate: {
    success: boolean;
    issue: Issue | null;
  };
}

interface UpdateIssueMutationResponse {
  issueUpdate: {
    success: boolean;
    issue: Issue | null;
  };
}

interface CommentCreateResponse {
  commentCreate: {
    success: boolean;
    comment: {
      id: string;
      body: string;
    } | null;
  };
}

// ISSUE_FIELDS imported from ./fragments

interface RawIssue extends Omit<Issue, "milestone" | "labels" | "relations" | "comments" | "children"> {
  projectMilestone?: Issue["milestone"];
  labels?: { nodes?: Issue["labels"] };
  relations?: { nodes?: Issue["relations"] };
  comments?: { nodes?: Issue["comments"] };
  children?: { nodes?: Issue["children"] };
}

function normalizeIssue(issue: RawIssue): Issue {
  return {
    ...issue,
    milestone: issue.projectMilestone ?? null,
    labels: issue.labels?.nodes ?? [],
    relations: issue.relations?.nodes ?? [],
    comments: issue.comments?.nodes ?? [],
    children: issue.children?.nodes ?? []
  };
}

interface IssuesByFilterResponse {
  issues: {
    nodes: Issue[];
  };
}

const IDENTIFIER_RE = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/;

export async function getIssue(id: string): Promise<Issue> {
  const identifierMatch = IDENTIFIER_RE.exec(id);
  if (identifierMatch) {
    const teamKey = identifierMatch[1].toUpperCase();
    const number = Number(identifierMatch[2]);
    const data = await linearGraphQL<IssuesByFilterResponse>(
      `
        query IssueByIdentifier($teamKey: String!, $number: Float!) {
          issues(filter: { number: { eq: $number }, team: { key: { eq: $teamKey } } }) {
            nodes {
              ${ISSUE_FIELDS}
            }
          }
        }
      `,
      { teamKey, number }
    );
    if (!data.issues.nodes.length) {
      throw new Error(`Issue not found: ${id}`);
    }
    return normalizeIssue(data.issues.nodes[0] as unknown as RawIssue);
  }

  const data = await linearGraphQL<IssueResponse>(
    `
      query IssueDetail($id: String!) {
        issue(id: $id) {
          ${ISSUE_FIELDS}
        }
      }
    `,
    { id }
  );
  if (!data.issue) {
    throw new Error(`Issue not found: ${id}`);
  }
  return normalizeIssue(data.issue as unknown as RawIssue);
}

export async function createIssue(input: CreateIssueInput): Promise<Issue> {
  if (!input.projectId) {
    process.stderr.write("Warning: no-orphan warning: creating issue without --project\n");
  }

  const data = await linearGraphQL<CreateIssueMutationResponse>(
    `
      mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
            identifier
            title
          }
        }
      }
    `,
    {
      input: {
        ...(input.teamId ? { teamId: input.teamId } : {}),
        title: input.title,
        description: input.description,
        projectId: input.projectId,
        projectMilestoneId: input.projectMilestoneId,
        assigneeId: input.assigneeId,
        priority: input.priority,
        parentId: input.parentId
      }
    }
  );

  if (!data.issueCreate.success || !data.issueCreate.issue) {
    throw new Error("Linear issueCreate mutation failed.");
  }

  return getIssue(data.issueCreate.issue.id);
}

export async function updateIssue(id: string, input: UpdateIssueInput): Promise<Issue> {
  const resolvedInput: UpdateIssueInput = { ...input };
  if (input.description) {
    resolvedInput.description = await rewriteWithWorkspaceLinks(input.description);
  }

  const data = await linearGraphQL<UpdateIssueMutationResponse>(
    `
      mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue {
            id
          }
        }
      }
    `,
    {
      id,
      input: resolvedInput
    }
  );

  if (!data.issueUpdate.success || !data.issueUpdate.issue) {
    throw new Error(`Linear issueUpdate mutation failed for issue ${id}.`);
  }

  return getIssue(data.issueUpdate.issue.id);
}

// ---------------------------------------------------------------------------
// Issue-identifier rewriting for clickable Markdown links
// ---------------------------------------------------------------------------

const BARE_ISSUE_RE = /\b([A-Z]{2,10}-\d+)\b/g;
const HAS_BARE_ISSUE_RE = /\b[A-Z]{2,10}-\d+\b/;

let cachedWorkspaceUrlKey: string | undefined;

interface OrganizationResponse {
  organization: { urlKey: string };
}

export function _resetWorkspaceUrlKeyCache(): void {
  cachedWorkspaceUrlKey = undefined;
}

export async function getWorkspaceUrlKey(): Promise<string> {
  if (cachedWorkspaceUrlKey) return cachedWorkspaceUrlKey;
  const data = await linearGraphQL<OrganizationResponse>(
    `query OrganizationUrlKey { organization { urlKey } }`
  );
  cachedWorkspaceUrlKey = data.organization.urlKey;
  return cachedWorkspaceUrlKey;
}

function findSkipRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const patterns: RegExp[] = [
    /```[\s\S]*?```/g,            // fenced code blocks
    /`[^`\n]+`/g,                  // inline code spans
    /!?\[[^\]]*\]\([^)]*\)/g,     // existing markdown links / images
    /https?:\/\/\S+/g              // bare URLs
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      ranges.push([m.index, m.index + m[0].length]);
    }
  }
  return ranges;
}

function inAnyRange(idx: number, ranges: Array<[number, number]>): boolean {
  for (const [s, e] of ranges) {
    if (idx >= s && idx < e) return true;
  }
  return false;
}

/**
 * Rewrite bare Linear issue identifiers (e.g. AI-424) into Markdown links
 * pointing at the workspace URL, skipping identifiers that appear inside
 * code blocks, code spans, existing Markdown links, or bare URLs.
 */
export function rewriteIssueLinks(text: string, urlKey: string): string {
  if (!HAS_BARE_ISSUE_RE.test(text)) return text;
  const skipRanges = findSkipRanges(text);
  const matches: { index: number; length: number; id: string }[] = [];
  BARE_ISSUE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BARE_ISSUE_RE.exec(text)) !== null) {
    matches.push({ index: m.index, length: m[0].length, id: m[1] });
  }
  let result = text;
  for (let i = matches.length - 1; i >= 0; i--) {
    const { index, length, id } = matches[i];
    if (inAnyRange(index, skipRanges)) continue;
    const url = `https://linear.app/${urlKey}/issue/${id}`;
    result = result.slice(0, index) + `[${id}](${url})` + result.slice(index + length);
  }
  return result;
}

async function rewriteWithWorkspaceLinks(text: string): Promise<string> {
  if (!HAS_BARE_ISSUE_RE.test(text)) return text;
  try {
    const urlKey = await getWorkspaceUrlKey();
    return rewriteIssueLinks(text, urlKey);
  } catch {
    return text;
  }
}

export async function addComment(issueId: string, body: string): Promise<{ issueId: string; commentId: string; body: string; bodyFile?: string }> {
  // Unescape literal \n sequences that shell interpolation often produces
  let finalBody = body.replace(/\\n/g, "\n");
  let tempFilePath: string | undefined;

  if (Buffer.byteLength(body, "utf8") > 4 * 1024) {
    tempFilePath = path.join(os.tmpdir(), `linear-comment-${issueId}-${Date.now()}.md`);
    await fs.writeFile(tempFilePath, body, "utf8");
    finalBody = await fs.readFile(tempFilePath, "utf8");
  }

  // Rewrite bare issue identifiers to clickable Markdown links
  finalBody = await rewriteWithWorkspaceLinks(finalBody);

  const data = await linearGraphQL<CommentCreateResponse>(
    `
      mutation AddComment($issueId: String!, $body: String!) {
        commentCreate(input: { issueId: $issueId, body: $body }) {
          success
          comment {
            id
            body
          }
        }
      }
    `,
    { issueId, body: finalBody }
  );

  if (!data.commentCreate.success || !data.commentCreate.comment) {
    throw new Error(`Failed to create comment for issue ${issueId}.`);
  }

  return {
    issueId,
    commentId: data.commentCreate.comment.id,
    body: data.commentCreate.comment.body,
    bodyFile: tempFilePath
  };
}

export async function getMyIssues(filterStateNames?: string[]): Promise<Issue[]> {
  const hasFilter = filterStateNames && filterStateNames.length > 0;
  const varDecl = hasFilter ? "($stateNames: [String!])" : "";
  const stateFilter = hasFilter ? ", filter: { state: { name: { in: $stateNames } } }" : "";
  const data = await linearGraphQL<IssuesResponse>(
    `
      query MyIssues${varDecl} {
        viewer {
          assignedIssues(first: 100${stateFilter}) {
            nodes {
              id
              identifier
              title
              updatedAt
              priority
              ${STATE_BLOCK}
              ${ASSIGNEE_BLOCK}
              ${TEAM_BLOCK}
              project { id name }
            }
          }
        }
      }
    `,
    { stateNames: filterStateNames }
  );

  return data.viewer.assignedIssues.nodes;
}

export async function getMyNewIssues(updatedSinceIso?: string): Promise<Issue[]> {
  const since = updatedSinceIso ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const data = await linearGraphQL<IssuesResponse>(
    `
      query MyNewIssues($updatedAt: DateTimeOrDuration!) {
        viewer {
          assignedIssues(first: 100, filter: { updatedAt: { gte: $updatedAt } }) {
            nodes {
              id
              identifier
              title
              updatedAt
              priority
              ${STATE_BLOCK}
              ${ASSIGNEE_BLOCK}
              ${TEAM_BLOCK}
              project { id name }
            }
          }
        }
      }
    `,
    { updatedAt: since }
  );

  return data.viewer.assignedIssues.nodes;
}

interface DelegatedIssuesResponse {
  issues: {
    nodes: Issue[];
  };
}

export async function getMyQueue(projectName?: string): Promise<Issue[]> {
  const self = await getSelfUser();
  const data = await linearGraphQL<DelegatedIssuesResponse>(
    `
      query MyQueue($delegateId: ID!) {
        issues(first: 100, filter: {
          delegate: { id: { eq: $delegateId } },
          state: { type: { nin: ["completed", "canceled"] } }
        }) {
          nodes {
            id
            identifier
            title
            updatedAt
            priority
            ${STATE_BLOCK}
            ${ASSIGNEE_BLOCK}
            ${DELEGATE_BLOCK}
            ${TEAM_BLOCK}
            project { id name }
          }
        }
      }
    `,
    { delegateId: self.id }
  );

  let issues = data.issues.nodes;

  if (projectName) {
    issues = issues.filter((issue) =>
      issue.project?.name?.toLowerCase().includes(projectName.toLowerCase())
    );
  }

  // Sort: priority asc (0/null=no priority treated as lowest=5), then updatedAt desc
  issues.sort((a, b) => {
    const pa = !a.priority || a.priority === 0 ? 5 : a.priority;
    const pb = !b.priority || b.priority === 0 ? 5 : b.priority;
    if (pa !== pb) return pa - pb;
    return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
  });

  return issues;
}

export async function findUserByName(name: string): Promise<{ id: string; name: string; email?: string | null }> {
  const data = await linearGraphQL<SearchUsersResponse>(
    `
      query SearchUsers($query: String!) {
        users(first: 50, filter: { name: { containsIgnoreCase: $query } }) {
          nodes {
            id
            name
            email
          }
        }
      }
    `,
    { query: name }
  );

  const exact = data.users.nodes.find((user) => user.name.toLowerCase() === name.toLowerCase());
  if (exact) {
    return exact;
  }

  if (data.users.nodes.length === 1) {
    return data.users.nodes[0];
  }

  throw new Error(`Could not uniquely resolve Linear user "${name}".`);
}
