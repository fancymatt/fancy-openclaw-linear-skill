import { linearGraphQL } from "./client";
import { STATE_BLOCK, ASSIGNEE_BLOCK, TEAM_BLOCK } from "./fragments";

interface BlockedIssue {
  id: string;
  identifier: string;
  title: string;
  updatedAt: string;
  priority: number;
  state: { id: string; name: string; type: string };
  assignee: { id: string; name: string; email: string } | null;
  team: { id: string; key: string; name: string };
  project?: { id: string; name: string };
}

interface BlockedResponse {
  viewer: {
    assignedIssues: {
      nodes: BlockedIssue[];
    };
  };
}

export async function getMyBlocked(limit?: number): Promise<BlockedIssue[]> {
  const first = limit ?? 50;

  const data = await linearGraphQL<BlockedResponse>(
    `
      query MyBlocked($first: Int!) {
        viewer {
          assignedIssues(first: $first, filter: {
            state: { name: { eq: "Blocked" } }
          }) {
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
    { first }
  );

  return data.viewer.assignedIssues.nodes;
}
