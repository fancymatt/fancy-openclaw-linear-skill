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
  // If description contains bare issue identifiers, upgrade to descriptionData
  let resolvedInput: UpdateIssueInput & { descriptionData?: object } = { ...input };
  if (input.description) {
    const descData = await buildTiptapBody(input.description);
    if (descData) {
      const { description: _desc, ...rest } = resolvedInput;
      resolvedInput = { ...rest, descriptionData: descData } as typeof resolvedInput;
    }
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
// Tiptap bodyData helpers for native Linear issue references
// ---------------------------------------------------------------------------

const BARE_ISSUE_RE = /\b([A-Z]{2,10}-\d+)\b/g;

type TiptapNode =
  | { type: "doc"; content: TiptapNode[] }
  | { type: "paragraph"; content?: TiptapNode[] }
  | { type: "text"; text: string; marks?: Array<{ type: string }> }
  | { type: "hardBreak" }
  | { type: "issueReference"; attrs: { id: string } };

/**
 * Build a tiptap JSON document from plain text, replacing bare issue
 * identifiers (e.g. AI-424) with native issueReference nodes.
 * Returns null if no issue identifiers are found (caller falls back to Markdown).
 */
export async function buildTiptapBody(text: string): Promise<object | null> {
  // Quick check — if no identifiers present, skip expensive resolution
  const identifiers = Array.from(new Set(Array.from(text.matchAll(BARE_ISSUE_RE), m => m[1])));
  if (identifiers.length === 0) return null;

  // Resolve all identifiers to UUIDs (best-effort; skip on error)
  const uuidMap = new Map<string, string>();
  await Promise.all(
    identifiers.map(async (identifier) => {
      try {
        const issue = await getIssue(identifier);
        uuidMap.set(identifier, issue.id);
      } catch {
        // If we can't resolve, we'll leave it as plain text
      }
    })
  );

  // If none resolved, fall back to Markdown
  if (uuidMap.size === 0) return null;

  const paragraphNodes: TiptapNode[] = [];

  // Split text into lines, build tiptap paragraphs
  const lines = text.split("\n");
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const inlineNodes: TiptapNode[] = [];

    let lastIndex = 0;
    BARE_ISSUE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = BARE_ISSUE_RE.exec(line)) !== null) {
      const [fullMatch, identifier] = match;
      const uuid = uuidMap.get(identifier);

      // Emit preceding text if any
      if (match.index > lastIndex) {
        inlineNodes.push({ type: "text", text: line.slice(lastIndex, match.index) });
      }

      if (uuid) {
        inlineNodes.push({ type: "issueReference", attrs: { id: uuid } });
      } else {
        // Unresolved — emit as plain text
        inlineNodes.push({ type: "text", text: fullMatch });
      }

      lastIndex = match.index + fullMatch.length;
    }

    // Emit trailing text if any
    if (lastIndex < line.length) {
      inlineNodes.push({ type: "text", text: line.slice(lastIndex) });
    }

    const para: TiptapNode = inlineNodes.length > 0
      ? { type: "paragraph", content: inlineNodes }
      : { type: "paragraph" };
    paragraphNodes.push(para);
  }

  return {
    type: "doc",
    content: paragraphNodes
  };
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

  // Attempt to build tiptap bodyData for native issue references
  const bodyData = await buildTiptapBody(finalBody);

  let data: CommentCreateResponse;
  if (bodyData) {
    data = await linearGraphQL<CommentCreateResponse>(
      `
        mutation AddComment($issueId: String!, $bodyData: JSON!) {
          commentCreate(input: { issueId: $issueId, bodyData: $bodyData }) {
            success
            comment {
              id
              body
            }
          }
        }
      `,
      { issueId, bodyData }
    );
  } else {
    data = await linearGraphQL<CommentCreateResponse>(
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
  }

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
