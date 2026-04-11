import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { linearGraphQL } from "./client";
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

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  priority
  url
  createdAt
  updatedAt
  team {
    id
    key
    name
  }
  state {
    id
    name
    type
    color
    position
    teamId
  }
  assignee {
    id
    name
    email
  }
  project {
    id
    name
  }
  projectMilestone {
    id
    name
    description
    targetDate
  }
  labels {
    nodes {
      id
      name
      color
    }
  }
  parent {
    id
    identifier
    title
  }
  children {
    nodes {
      id
      identifier
      title
      state {
        id
        name
        type
        color
      }
    }
  }
  relations {
    nodes {
      id
      type
      issue {
        id
        identifier
        title
      }
      relatedIssue {
        id
        identifier
        title
      }
    }
  }
  comments(last: 5, orderBy: createdAt) {
    nodes {
      id
      body
      createdAt
      updatedAt
      user {
        id
        name
        email
      }
    }
  }
`;

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

export async function getIssue(id: string): Promise<Issue> {
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
        teamId: input.teamId,
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
      input
    }
  );

  if (!data.issueUpdate.success || !data.issueUpdate.issue) {
    throw new Error(`Linear issueUpdate mutation failed for issue ${id}.`);
  }

  return getIssue(data.issueUpdate.issue.id);
}

export async function addComment(issueId: string, body: string): Promise<{ issueId: string; body: string; bodyFile?: string }> {
  let finalBody = body;
  let tempFilePath: string | undefined;

  if (Buffer.byteLength(body, "utf8") > 4 * 1024) {
    tempFilePath = path.join(os.tmpdir(), `linear-comment-${issueId}-${Date.now()}.md`);
    await fs.writeFile(tempFilePath, body, "utf8");
    finalBody = await fs.readFile(tempFilePath, "utf8");
  }

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
    {
      issueId,
      body: finalBody
    }
  );

  if (!data.commentCreate.success || !data.commentCreate.comment) {
    throw new Error(`Failed to create comment for issue ${issueId}.`);
  }

  return {
    issueId,
    body: data.commentCreate.comment.body,
    bodyFile: tempFilePath
  };
}

export async function getMyIssues(filterStateNames?: string[]): Promise<Issue[]> {
  const stateFilter = filterStateNames?.length ? ", filter: { state: { name: { in: $stateNames } } }" : "";
  const data = await linearGraphQL<IssuesResponse>(
    `
      query MyIssues($stateNames: [String!]) {
        viewer {
          assignedIssues(first: 100${stateFilter}) {
            nodes {
              id
              identifier
              title
              updatedAt
              priority
              state { id name type }
              assignee { id name email }
              team { id key name }
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
              state { id name type }
              assignee { id name email }
              team { id key name }
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
