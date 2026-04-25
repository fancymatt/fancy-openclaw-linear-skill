import fs from "node:fs/promises";

import { getSelfUser } from "./auth";
import { getComments } from "./boards";
import { addComment, findUserByName, getIssue, updateIssue } from "./issues";
import { findSemanticState } from "./states";

export interface ObserveResult {
  identifier: string;
  title: string;
  description: string;
  state: { name: string };
  priority: number;
  assignee: { name: string } | null;
  delegate: { name: string } | null;
  comments: Array<{ body: string; createdAt: string; user: { name: string } }>;
}

export interface SemanticResult {
  command: string;
  issueId: string;
  state: string;
  delegate: string | null;
  assignee: string | null;
  commentPosted: boolean;
}

async function resolveComment(
  comment?: string,
  commentFile?: string
): Promise<string | undefined> {
  if (commentFile) {
    const content = await fs.readFile(commentFile, "utf8");
    return content.trim() || undefined;
  }
  return comment?.trim() || undefined;
}

function requireComment(
  command: string,
  comment?: string
): asserts comment is string {
  if (!comment) {
    throw new Error(
      `${command} requires a non-empty comment. Use --comment or --comment-file.`
    );
  }
}

/**
 * linear observeIssue <id> [--all]
 *
 * Read-only observation of an issue. Does NOT change ownership.
 * Used when an agent is @mentioned (not delegated) or doing a board sweep.
 * Returns issue context + last 10 comments by default (or all with --all).
 */
export async function observeIssue(
  issueId: string,
  allComments = false
): Promise<ObserveResult> {
  const issue = await getIssue(issueId);
  const comments = await getComments(issue.id, allComments);

  return {
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? "",
    state: { name: issue.state?.name ?? "Unknown" },
    priority: issue.priority ?? 0,
    assignee: issue.assignee ? { name: issue.assignee.name } : null,
    delegate: issue.delegate ? { name: issue.delegate.name } : null,
    comments: comments.map((c) => ({
      body: c.body,
      createdAt: c.createdAt ?? "",
      user: c.user ? { name: c.user.name } : { name: "Unknown" },
    })),
  };
}

/**
 * linear considerWork <id>
 *
 * Agent received a webhook notification and is considering the task.
 * Context gateway: returns issue info + last 10 comments.
 * - Set delegate = self
 * - Set status to "thinking" (maps to In Progress)
 * - Clear assignee
 * - No comment (agents only comment through handoffs)
 */
export async function considerWork(
  issueId: string
): Promise<SemanticResult & { context?: ObserveResult }> {
  const issue = await getIssue(issueId);
  const teamId = issue.team?.id;
  if (!teamId) {
    throw new Error(`Issue ${issue.identifier} has no team.`);
  }

  const self = await getSelfUser();
  const state = await findSemanticState(teamId, "thinking");

  // updateIssue returns the fresh (post-mutation) issue, avoiding a re-fetch
  const updatedIssue = await updateIssue(issueId, {
    stateId: state.id,
    delegateId: self.id,
    assigneeId: null,
  });

  // Only fetch comments — issue data comes from updateIssue's built-in re-fetch
  const comments = await getComments(updatedIssue.id);
  const context: ObserveResult = {
    identifier: updatedIssue.identifier,
    title: updatedIssue.title,
    description: updatedIssue.description ?? "",
    state: { name: updatedIssue.state?.name ?? "Unknown" },
    priority: updatedIssue.priority ?? 0,
    assignee: updatedIssue.assignee ? { name: updatedIssue.assignee.name } : null,
    delegate: updatedIssue.delegate ? { name: updatedIssue.delegate.name } : null,
    comments: comments.map((c) => ({
      body: c.body,
      createdAt: c.createdAt ?? "",
      user: c.user ? { name: c.user.name } : { name: "Unknown" },
    })),
  };

  return {
    command: "considerWork",
    issueId: issue.identifier,
    state: state.name,
    delegate: self.name,
    assignee: null,
    commentPosted: false,
    context,
  };
}

/**
 * linear refuseWork <id> <delegate>
 *
 * Agent decides they are not the best person for the next action.
 * - Set status to Todo
 * - Post comment (required)
 * - Set delegate to the specified user
 */
export async function refuseWork(
  issueId: string,
  delegateName: string,
  options?: { comment?: string; commentFile?: string }
): Promise<SemanticResult> {
  const issue = await getIssue(issueId);
  const teamId = issue.team?.id;
  if (!teamId) {
    throw new Error(`Issue ${issue.identifier} has no team.`);
  }

  const body = await resolveComment(options?.comment, options?.commentFile);
  requireComment("refuseWork", body);

  const delegate = await findUserByName(delegateName);
  const state = await findSemanticState(teamId, "todo");

  // Update issue FIRST — if this fails, no orphaned comment
  await updateIssue(issueId, {
    stateId: state.id,
    delegateId: delegate.id,
  });

  await addComment(issueId, body!);

  return {
    command: "refuseWork",
    issueId: issue.identifier,
    state: state.name,
    delegate: delegate.name,
    assignee: null,
    commentPosted: true,
  };
}

/**
 * linear beginWork <id>
 *
 * Agent is actively handling the delegated task. Idempotent.
 * - Set status to "doing" (maps to In Progress)
 * - Does NOT change delegate
 * - No comment (agents only comment through handoffs)
 */
export async function beginWork(
  issueId: string
): Promise<SemanticResult> {
  const issue = await getIssue(issueId);
  const teamId = issue.team?.id;
  if (!teamId) {
    throw new Error(`Issue ${issue.identifier} has no team.`);
  }

  const state = await findSemanticState(teamId, "doing");

  // Only update state if not already in a "doing" state
  const currentStateName = issue.state?.name?.toLowerCase() ?? "";
  const targetStateName = state.name.toLowerCase();
  if (currentStateName !== targetStateName) {
    await updateIssue(issueId, { stateId: state.id });
  }

  return {
    command: "beginWork",
    issueId: issue.identifier,
    state: state.name,
    delegate: issue.delegate?.name ?? null,
    assignee: issue.assignee?.name ?? null,
    commentPosted: false,
  };
}

/**
 * linear handoffWork <id> <delegate>
 *
 * Agent-to-agent handoff. Idempotent — safe to call multiple times.
 * - Set status to Todo
 * - Post comment (required)
 * - Set delegate to specified agent
 * - Clear assignee
 */
export async function handoffWork(
  issueId: string,
  delegateName: string,
  options?: { comment?: string; commentFile?: string }
): Promise<SemanticResult> {
  const issue = await getIssue(issueId);
  const teamId = issue.team?.id;
  if (!teamId) {
    throw new Error(`Issue ${issue.identifier} has no team.`);
  }

  const body = await resolveComment(options?.comment, options?.commentFile);
  requireComment("handoffWork", body);

  const delegate = await findUserByName(delegateName);
  const state = await findSemanticState(teamId, "todo");

  // Update issue FIRST — if this fails, no orphaned comment
  await updateIssue(issueId, {
    stateId: state.id,
    delegateId: delegate.id,
    assigneeId: null,
  });

  await addComment(issueId, body!);

  return {
    command: "handoffWork",
    issueId: issue.identifier,
    state: state.name,
    delegate: delegate.name,
    assignee: null,
    commentPosted: true,
  };
}

/**
 * linear complete <id>
 *
 * Ticket has reached the desired acceptance criteria state.
 * - Set status to Done
 * - Post comment (optional)
 * - Clear delegate
 * - Clear assignee
 */
export async function complete(
  issueId: string,
  options?: { comment?: string; commentFile?: string }
): Promise<SemanticResult> {
  const issue = await getIssue(issueId);
  const teamId = issue.team?.id;
  if (!teamId) {
    throw new Error(`Issue ${issue.identifier} has no team.`);
  }

  const state = await findSemanticState(teamId, "done");
  const body = await resolveComment(options?.comment, options?.commentFile);

  let commentPosted = false;
  if (body) {
    await addComment(issueId, body);
    commentPosted = true;
  }

  await updateIssue(issueId, {
    stateId: state.id,
    delegateId: null,
    assigneeId: null,
  });

  return {
    command: "complete",
    issueId: issue.identifier,
    state: state.name,
    delegate: null,
    assignee: null,
    commentPosted,
  };
}

/**
 * linear needsHuman <id> <assignee>
 *
 * Human action is required. Idempotent — safe to call multiple times.
 * - Set status to Todo
 * - Post comment (required)
 * - Clear delegate
 * - Set assignee to specified human
 */
export async function needsHuman(
  issueId: string,
  assigneeName: string,
  options?: { comment?: string; commentFile?: string }
): Promise<SemanticResult> {
  const issue = await getIssue(issueId);
  const teamId = issue.team?.id;
  if (!teamId) {
    throw new Error(`Issue ${issue.identifier} has no team.`);
  }

  const body = await resolveComment(options?.comment, options?.commentFile);
  requireComment("needsHuman", body);

  const assignee = await findUserByName(assigneeName);
  const state = await findSemanticState(teamId, "todo");

  // Update issue FIRST — if this fails, no orphaned comment
  await updateIssue(issueId, {
    stateId: state.id,
    delegateId: null,
    assigneeId: assignee.id,
  });

  await addComment(issueId, body!);

  return {
    command: "needsHuman",
    issueId: issue.identifier,
    state: state.name,
    delegate: null,
    assignee: assignee.name,
    commentPosted: true,
  };
}
