import { linearGraphQL } from "./client";

interface SearchResponse {
  issueSearch: {
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

export async function searchIssues(query: string, teamId?: string, limit?: number): Promise<SearchResponse["issueSearch"]["nodes"]> {
  const first = limit ?? 25;
  const teamFilter = teamId ? `, filter: { team: { id: { eq: $teamId } } }` : "";

  const data = await linearGraphQL<SearchResponse>(
    `
      query SearchIssues($query: String!, $first: Int!${teamId ? ", $teamId: ID" : ""}) {
        issueSearch(query: $query, first: $first${teamFilter}) {
          nodes {
            id
            identifier
            title
            state { id name type }
            assignee { id name }
            priority
            team { id key name }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `,
    { query, first, teamId }
  );

  return data.issueSearch.nodes;
}
