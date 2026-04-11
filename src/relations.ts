import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { linearGraphQL } from "./client";
import { IssueRelation } from "./types";
import { getIssue } from "./issues";

interface RelationMutationResponse {
  issueRelationCreate?: {
    success: boolean;
  };
  issueRelationDelete?: {
    success: boolean;
  };
}

export async function listRelations(issueId: string): Promise<IssueRelation[]> {
  const issue = await getIssue(issueId);
  return issue.relations ?? [];
}

export async function createBlockingRelation(
  issueId: string,
  relatedIssueId: string,
  mode: "blocked-by" | "blocks",
  confirm = true
): Promise<{ issueId: string; relatedIssueId: string; mode: string }> {
  const [issue, relatedIssue] = await Promise.all([getIssue(issueId), getIssue(relatedIssueId)]);

  const prompt =
    mode === "blocked-by"
      ? `${issue.identifier} will be blocked by ${relatedIssue.identifier} (${relatedIssue.identifier} must complete before ${issue.identifier}). Confirm? [y/N] `
      : `${issue.identifier} will block ${relatedIssue.identifier} (${issue.identifier} must complete before ${relatedIssue.identifier}). Confirm? [y/N] `;

  if (confirm) {
    const rl = readline.createInterface({ input, output });
    const answer = await rl.question(prompt);
    rl.close();
    if (!["y", "yes"].includes(answer.trim().toLowerCase())) {
      throw new Error("Aborted.");
    }
  }

  const [prerequisiteId, dependentId] =
    mode === "blocked-by" ? [relatedIssue.id, issue.id] : [issue.id, relatedIssue.id];

  const data = await linearGraphQL<RelationMutationResponse>(
    `
      mutation CreateRelation($issueId: String!, $relatedIssueId: String!) {
        issueRelationCreate(input: { issueId: $issueId, relatedIssueId: $relatedIssueId, type: blocks }) {
          success
        }
      }
    `,
    {
      issueId: prerequisiteId,
      relatedIssueId: dependentId
    }
  );

  if (!data.issueRelationCreate?.success) {
    throw new Error("Failed to create relation.");
  }

  return { issueId: issue.identifier, relatedIssueId: relatedIssue.identifier, mode };
}

export async function removeBlockingRelation(issueId: string, relatedIssueId: string): Promise<{ removed: boolean }> {
  const relations = await listRelations(issueId);
  const relation = relations.find((candidate) => {
    const a = candidate.issue.identifier;
    const b = candidate.relatedIssue.identifier;
    return [a, b].includes(issueId) && [a, b].includes(relatedIssueId);
  });

  if (!relation) {
    throw new Error(`No relation found between ${issueId} and ${relatedIssueId}.`);
  }

  const data = await linearGraphQL<RelationMutationResponse>(
    `
      mutation DeleteRelation($id: String!) {
        issueRelationDelete(id: $id) {
          success
        }
      }
    `,
    { id: relation.id }
  );

  if (!data.issueRelationDelete?.success) {
    throw new Error("Failed to delete relation.");
  }

  return { removed: true };
}
