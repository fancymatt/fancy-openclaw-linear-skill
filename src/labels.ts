import { linearGraphQL } from "./client";
import { getIssue } from "./issues";
import { resolveTeamId } from "./teams";

interface LabelsResponse {
  team: {
    labels: {
      nodes: Array<{ id: string; name: string; color: string }>;
    };
  };
}



export async function listLabels(team?: string): Promise<Array<{ id: string; name: string; color: string }>> {
  const teamId = team ? await resolveTeamId(team) : undefined;
  const teamClause = teamId
    ? `team(id: "${teamId}") { labels(first: 100) { nodes { id name color } } }`
    : `teams(first: 1) { nodes { labels(first: 100) { nodes { id name color } } } }`;

  const data = await linearGraphQL<{
    teams?: { nodes: Array<{ labels: LabelsResponse["team"]["labels"] }> };
    team?: LabelsResponse["team"];
  }>(
    `
      query ListLabels {
        ${teamClause}
      }
    `
  );

  if (data.team) {
    return data.team.labels.nodes;
  }
  if (data.teams?.nodes?.length) {
    return data.teams.nodes[0].labels.nodes;
  }
  return [];
}

export async function resolveLabelIds(teamId: string, labelNames: string[]): Promise<string[]> {
  const data = await linearGraphQL<LabelsResponse>(
    `
      query ResolveLabels($teamId: ID!) {
        team(id: $teamId) {
          labels(first: 100) {
            nodes { id name color }
          }
        }
      }
    `,
    { teamId }
  );

  const teamLabels = data.team.labels.nodes;
  const resolved: string[] = [];
  const notFound: string[] = [];

  for (const name of labelNames) {
    const match = teamLabels.find(
      (l) => l.name.toLowerCase() === name.toLowerCase()
    );
    if (match) {
      resolved.push(match.id);
    } else {
      notFound.push(name);
    }
  }

  if (notFound.length > 0) {
    throw new Error(`Label(s) not found: ${notFound.join(", ")}. Available labels: ${teamLabels.map((l) => l.name).join(", ") || "(none)"}`);
  }

  return resolved;
}

export async function addLabels(issueId: string, labelNames: string[], teamId?: string): Promise<unknown> {
  const issue = await getIssue(issueId);
  const tid = teamId ?? issue.team?.id;
  if (!tid) {
    throw new Error(`Unable to resolve team for issue ${issueId}. Pass --team explicitly.`);
  }

  const newLabelIds = await resolveLabelIds(tid, labelNames);
  const existingLabelIds = issue.labels?.map((l: { id: string }) => l.id) ?? [];

  // Deduplicate
  const allLabelIds = [...new Set([...existingLabelIds, ...newLabelIds])];

  const data = await linearGraphQL<{ issueUpdate: { success: boolean; issue: { id: string; labels: { nodes: Array<{ id: string; name: string }> } } } }>(
    `
      mutation AddLabels($id: ID!, $labelIds: [ID!]) {
        issueUpdate(input: { id: $id, labelIds: { set: $labelIds } }) {
          success
          issue { id labels { nodes { id name } } }
        }
      }
    `,
    { id: issue.id, labelIds: allLabelIds }
  );

  return data.issueUpdate;
}

export async function removeLabels(issueId: string, labelNames: string[], teamId?: string): Promise<unknown> {
  const issue = await getIssue(issueId);
  const tid = teamId ?? issue.team?.id;
  if (!tid) {
    throw new Error(`Unable to resolve team for issue ${issueId}. Pass --team explicitly.`);
  }

  const labelIdsToRemove = await resolveLabelIds(tid, labelNames);
  const existingLabelIds = issue.labels?.map((l: { id: string }) => l.id) ?? [];

  const filtered = existingLabelIds.filter((id: string) => !labelIdsToRemove.includes(id));

  const data = await linearGraphQL<{ issueUpdate: { success: boolean; issue: { id: string; labels: { nodes: Array<{ id: string; name: string }> } } } }>(
    `
      mutation RemoveLabels($id: ID!, $labelIds: [ID!]) {
        issueUpdate(input: { id: $id, labelIds: { set: $labelIds } }) {
          success
          issue { id labels { nodes { id name } } }
        }
      }
    `,
    { id: issue.id, labelIds: filtered }
  );

  return data.issueUpdate;
}
