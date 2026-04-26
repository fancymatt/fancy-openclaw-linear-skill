import fs from "node:fs/promises";

import { getSelfUser } from "./auth";
import { getComments } from "./boards";
import { addComment, findUserByName, getIssue, updateIssue } from "./issues";
import { findSemanticState } from "./states";
import { ObserveResult, SemanticResult } from "./semantic";

// --- Shared helpers ---

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

// --- State machine types ---

export type CommentMode = "none" | "optional" | "required";

export interface StateTransition {
  /** Semantic state name to transition to (e.g. "thinking", "doing", "todo", "done") */
  targetState: string;
  /** Comment policy for this command */
  commentMode: CommentMode;
  /** Resolve a user by name and set as delegate? If set, the string is the user name argument. */
  delegateName?: string | ((args: TransitionArgs) => string | undefined);
  /** Resolve a user by name and set as assignee? If set, the string is the user name argument. */
  assigneeName?: string | ((args: TransitionArgs) => string | undefined);
  /** Set delegate to null? */
  clearDelegate?: boolean;
  /** Set assignee to null? */
  clearAssignee?: boolean;
  /** Set delegate to self (current authenticated user)? */
  delegateToSelf?: boolean;
  /** Comment before or after the state update? Default: false (after) */
  commentFirst?: boolean;
  /** Skip update when already in target state? (idempotency guard for beginWork) */
  skipIfSameState?: boolean;
  /** Include context (issue + comments) in result? (for considerWork) */
  includeContext?: boolean;
}

export interface TransitionArgs {
  issueId: string;
  comment?: string;
  commentFile?: string;
  /** Positional user name argument (used when delegateName/assigneeName is a string) */
  userName?: string;
}

export interface TransitionResult extends SemanticResult {
  context?: ObserveResult;
}

// --- State machine executor ---

/**
 * Execute a semantic command's state transition against a Linear issue.
 *
 * This is the shared core that all 6 semantic commands delegate to.
 * Each command defines its transition config and calls this function.
 */
export async function executeTransition(
  commandName: string,
  args: TransitionArgs,
  config: StateTransition
): Promise<TransitionResult> {
  // 1. Fetch issue and resolve team
  const issue = await getIssue(args.issueId);
  const teamId = issue.team?.id;
  if (!teamId) {
    throw new Error(`Issue ${issue.identifier} has no team.`);
  }

  // 2. Resolve target state
  const state = await findSemanticState(teamId, config.targetState);

  // 3. Idempotency check — skip update if already in target state
  if (config.skipIfSameState) {
    const currentStateName = issue.state?.name?.toLowerCase() ?? "";
    const targetStateName = state.name.toLowerCase();
    if (currentStateName === targetStateName) {
      return {
        command: commandName,
        issueId: issue.identifier,
        state: state.name,
        delegate: issue.delegate?.name ?? null,
        assignee: issue.assignee?.name ?? null,
        commentPosted: false,
        commentId: null,
      };
    }
  }

  // 4. Resolve comment
  const body = await resolveComment(args.comment, args.commentFile);
  if (config.commentMode === "required") {
    requireComment(commandName, body);
  }

  // 5. Resolve delegate
  let delegateId: string | null | undefined = undefined; // undefined = don't touch, null = clear
  let delegateName: string | null = null;
  if (config.delegateToSelf) {
    const self = await getSelfUser();
    delegateId = self.id;
    delegateName = self.name;
  } else if (config.clearDelegate) {
    delegateId = null;
    delegateName = null;
  } else if (config.delegateName) {
    const name = typeof config.delegateName === "function"
      ? config.delegateName(args)
      : config.delegateName;
    if (name) {
      const user = await findUserByName(name);
      delegateId = user.id;
      delegateName = user.name;
    }
  }

  // 6. Resolve assignee
  let assigneeId: string | null | undefined = undefined; // undefined = don't touch, null = clear
  let assigneeNameResult: string | null = null;
  if (config.clearAssignee) {
    assigneeId = null;
  } else if (config.assigneeName) {
    const name = typeof config.assigneeName === "function"
      ? config.assigneeName(args)
      : config.assigneeName;
    if (name) {
      const user = await findUserByName(name);
      assigneeId = user.id;
      assigneeNameResult = user.name;
    }
  }

  // 7. Post comment (before update if commentFirst)
  let commentPosted = false;
  let commentId: string | null = null;
  if (body && config.commentMode !== "none") {
    if (config.commentFirst) {
      const result = await addComment(args.issueId, body);
      commentId = result.commentId;
      commentPosted = true;
    }
  }

  // 8. Build update payload
  const updatePayload: Record<string, any> = { stateId: state.id };
  if (delegateId !== undefined) updatePayload.delegateId = delegateId;
  if (assigneeId !== undefined) updatePayload.assigneeId = assigneeId;

  // 9. Execute update
  const updatedIssue = await updateIssue(args.issueId, updatePayload);

  // 10. Post comment (after update if not commentFirst)
  if (body && config.commentMode !== "none" && !config.commentFirst) {
    const result = await addComment(args.issueId, body);
    commentId = result.commentId;
    commentPosted = true;
  }

  // 11. Build result
  const result: TransitionResult = {
    command: commandName,
    issueId: issue.identifier,
    state: state.name,
    delegate: config.delegateToSelf ? delegateName
      : config.clearDelegate ? null
      : delegateName ?? issue.delegate?.name ?? null,
    assignee: config.clearAssignee ? null
      : assigneeNameResult ?? issue.assignee?.name ?? null,
    commentPosted,
    commentId: commentId ?? null,
  };

  // 12. Include context for considerWork
  if (config.includeContext) {
    const comments = await getComments(updatedIssue.id);
    result.context = {
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
  }

  return result;
}
