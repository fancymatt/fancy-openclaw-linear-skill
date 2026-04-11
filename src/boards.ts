import { linearGraphQL } from "./client";
import { Comment, Issue } from "./types";

interface TeamIssuesResponse {
  team: {
    issues: {
      nodes: Issue[];
    };
  } | null;
}

interface ViewerIssuesResponse {
  viewer: {
    assignedIssues: {
      nodes: Issue[];
    };
  };
}

interface CommentsResponse {
  issue: {
    comments: {
      nodes: Comment[];
    };
  } | null;
}

export async function getBoard(teamId: string): Promise<Record<string, Issue[]>> {
  const data = await linearGraphQL<TeamIssuesResponse>(
    `
      query TeamBoard($teamId: String!) {
        team(id: $teamId) {
          issues(first: 200, filter: { state: { type: { nin: [completed, canceled] } } }) {
            nodes {
              id
              identifier
              title
              updatedAt
              priority
              state { id name type }
              assignee { id name email }
            }
          }
        }
      }
    `,
    { teamId }
  );

  if (!data.team) {
    throw new Error(`Team not found: ${teamId}`);
  }

  return data.team.issues.nodes.reduce<Record<string, Issue[]>>((groups, issue) => {
    const key = issue.state?.name ?? "Unspecified";
    groups[key] ??= [];
    groups[key].push(issue);
    return groups;
  }, {});
}

export async function getReviewQueue(): Promise<Issue[]> {
  const data = await linearGraphQL<ViewerIssuesResponse>(`
    query ReviewQueue {
      viewer {
        assignedIssues(first: 100, filter: { state: { name: { eq: "Needs Review" } } }) {
          nodes {
            id
            identifier
            title
            updatedAt
            priority
            state { id name type }
            team { id key name }
            assignee { id name email }
          }
        }
      }
    }
  `);

  return data.viewer.assignedIssues.nodes;
}

export async function getStalled(days = 2): Promise<Issue[]> {
  const before = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const data = await linearGraphQL<ViewerIssuesResponse>(
    `
      query Stalled($updatedAt: DateTimeOrDuration!) {
        viewer {
          assignedIssues(
            first: 100,
            filter: { state: { name: { eq: "In Progress" } }, updatedAt: { lte: $updatedAt } }
          ) {
            nodes {
              id
              identifier
              title
              updatedAt
              priority
              state { id name type }
              team { id key name }
              assignee { id name email }
            }
          }
        }
      }
    `,
    { updatedAt: before }
  );

  return data.viewer.assignedIssues.nodes;
}

export async function getComments(issueId: string, all = false): Promise<Comment[]> {
  const data = await linearGraphQL<CommentsResponse>(
    `
      query IssueComments($id: String!, $count: Int!) {
        issue(id: $id) {
          comments(last: $count, orderBy: createdAt) {
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
        }
      }
    `,
    { id: issueId, count: all ? 250 : 10 }
  );

  if (!data.issue) {
    throw new Error(`Issue not found: ${issueId}`);
  }

  return data.issue.comments.nodes;
}
