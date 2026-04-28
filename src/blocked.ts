import { linearGraphQL } from "./client";
import { Issue } from "./types";
import { STATE_BLOCK, ASSIGNEE_BLOCK, TEAM_BLOCK } from "./fragments";

interface BlockedResponse {
  viewer: {
    assignedIssues: {
      nodes: Issue[];
    };
  };
}

export async function getMyBlocked(limit?: number): Promise<Issue[]> {
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
