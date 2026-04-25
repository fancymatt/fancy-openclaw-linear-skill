import { linearGraphQL } from "./client";
import { STATE_BLOCK, TEAM_BLOCK } from "./fragments";

interface SearchResponse {
  issues: {
    nodes: Array<{
      id: string;
      identifier: string;
      title: string;
      state?: { id: string; name: string; type: string };
      assignee?: { id: string; name: string };
      priority: number;
      team?: { id: string; key: string; name: string };
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

export async function searchIssues(query: string, teamId?: string, limit?: number): Promise<SearchResponse["issues"]["nodes"]> {
  const first = limit ?? 25;
  const teamFilter = teamId ? `, team: { id: { eq: $teamId } }` : "";

  const data = await linearGraphQL<SearchResponse>(
    `
      query SearchIssues($query: String!, $first: Int!${teamId ? ", $teamId: ID" : ""}) {
        issues(first: $first, filter: { title: { containsIgnoreCase: $query }${teamFilter} }) {
          nodes {
            id
            identifier
            title
            ${STATE_BLOCK}
            assignee { id name }
            priority
            ${TEAM_BLOCK}
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `,
    { query, first, teamId }
  );

  return data.issues.nodes;
}
