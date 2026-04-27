import fs from "node:fs/promises";

import {
  executeTransition,
  type TransitionArgs,
  type TransitionResult,
} from "./state-machine";
import { getComments } from "./boards";
import { addComment, getIssue } from "./issues";

/**
 * Result of observing an issue. Comments are sorted ascending by createdAt.
 */
export interface ObserveResult {
  identifier: string;
  title: string;
  description: string;
  createdAt: string;
  state: { name: string };
  priority: number;
  assignee: { name: string } | null;
  delegate: { name: string } | null;
  /** Sorted ascending by createdAt */
  comments: Array<{ id: string; body: string; createdAt: string; user: { name: string } }>;
}

export interface SemanticResult {
  command: string;
  issueId: string;
  state: string;
  delegate: string | null;
  assignee: string | null;
  commentPosted: boolean;
  commentId: string | null;
  commentUrl: string | null;
  commentCreatedAt: string | null;
  commentBodyLength: number | null;
  bodyFile: string | null;
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
  allComments = false,
  sinceTimestamp?: string
): Promise<ObserveResult> {
  const issue = await getIssue(issueId);
  const comments = await getComments(issue.id, allComments, sinceTimestamp);

  const rawComments = comments.map((c) => ({
    id: c.id,
    body: c.body,
    createdAt: c.createdAt ?? "",
    user: c.user ? { name: c.user.name } : { name: "Unknown" },
  }));

  // Explicit ascending sort by createdAt (guarantee for consumers)
  rawComments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return {
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? "",
    createdAt: issue.createdAt ?? "",
    state: { name: issue.state?.name ?? "Unknown" },
    priority: issue.priority ?? 0,
    assignee: issue.assignee ? { name: issue.assignee.name } : null,
    delegate: issue.delegate ? { name: issue.delegate.name } : null,
    comments: rawComments,
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
  return executeTransition("considerWork", { issueId }, {
    targetState: "thinking",
    commentMode: "none",
    delegateToSelf: true,
    clearAssignee: true,
    includeContext: true,
    skipIfSameState: true,
  });
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
  return executeTransition("refuseWork", {
    issueId,
    comment: options?.comment,
    commentFile: options?.commentFile,
    userName: delegateName,
    commandName: "refuse-work",
  }, {
    targetState: "todo",
    commentMode: "required",
    delegateName: (args) => args.userName,
    commentFirst: true,
  });
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
  return executeTransition("beginWork", { issueId }, {
    targetState: "doing",
    commentMode: "none",
    skipIfSameState: true,
  });
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
  return executeTransition("handoffWork", {
    issueId,
    comment: options?.comment,
    commentFile: options?.commentFile,
    userName: delegateName,
    commandName: "handoff-work",
  }, {
    targetState: "todo",
    commentMode: "required",
    delegateName: (args) => args.userName,
    clearAssignee: true,
    commentFirst: true,
  });
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
  return executeTransition("complete", {
    issueId,
    comment: options?.comment,
    commentFile: options?.commentFile,
  }, {
    targetState: "done",
    commentMode: "optional",
    clearDelegate: true,
    clearAssignee: true,
  });
}

/**
 * linear note <id>
 *
 * Post a comment on an issue without changing any state, delegate, or assignee.
 * Works on issues in any status including Done and Canceled.
 * Comment is required (--comment or --comment-file).
 */
export async function note(
  issueId: string,
  options: { comment?: string; commentFile?: string }
): Promise<{ issueId: string; commentId: string; commentPosted: boolean; commentUrl: string | null; commentCreatedAt: string | null; commentBodyLength: number | null; bodyFile: string | null }> {
  let body = options.comment?.trim();
  if (options.commentFile) {
    body = (await fs.readFile(options.commentFile, "utf8")).trim();
  }
  if (!body) {
    throw new Error("note requires a non-empty comment. Use --comment or --comment-file.");
  }
  const issue = await getIssue(issueId);
  const commentResult = await addComment(issue.id, body);
  return {
    issueId: issue.identifier,
    commentId: commentResult.commentId,
    commentPosted: true,
    commentUrl: commentResult.commentUrl,
    commentCreatedAt: commentResult.commentCreatedAt,
    commentBodyLength: commentResult.commentBodyLength,
    bodyFile: commentResult.bodyFile ?? null
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
  return executeTransition("needsHuman", {
    issueId,
    comment: options?.comment,
    commentFile: options?.commentFile,
    userName: assigneeName,
    commandName: "needs-human",
  }, {
    targetState: "todo",
    commentMode: "required",
    clearDelegate: true,
    assigneeName: (args) => args.userName,
    commentFirst: true,
  });
}
