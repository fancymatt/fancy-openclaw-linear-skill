#!/usr/bin/env node
import fs from "node:fs/promises";

import { Command } from "commander";

import { checkAuth, linearDoctor } from "./auth";
import { getMyBlocked } from "./blocked";
import { getBoard, getReviewQueue, getStalled } from "./boards";
import { considerWork, refuseWork, beginWork, handoffWork, complete, needsHuman, observeIssue, note } from "./semantic";
import { addComment, createIssue, findUserByName, getIssue, getMyIssues, getMyNewIssues, getMyQueue, updateIssue, verifyComment } from "./issues";
import { attachIssueToMilestone, attachIssueToProject, createMilestone, getProjectDetail, getProjectIssues, listMilestones, listProjects } from "./projects";
import { createBlockingRelation, listRelations, removeBlockingRelation, setParent, removeParent } from "./relations";
import { findStateByName, getWorkflowStates } from "./states";
import { listTeams, resolveTeamId } from "./teams";
import { uploadFile } from "./upload";
import { deleteIssue, deleteComment } from "./delete";
import { listLabels, addLabels, removeLabels } from "./labels";
import { searchIssues } from "./search";
import { linearTest } from "./test";
import { linearGraphQL, LinearApiError } from "./client";
import { relativeTime, wrapText } from "./utils";
import { ObserveResult } from "./semantic";
import { setDebugMode, isDebugMode } from "./debug";
import { CreateIssueInput, UpdateIssueInput } from "./types";

interface NotificationsResponse {
  notifications: {
    nodes: Array<{
      id: string;
      type: string;
      readAt?: string | null;
      createdAt: string;
      updatedAt: string;
      issue?: { id: string; identifier: string; title: string; state?: { name: string } };
      project?: { id: string; name: string };
    }>;
  };
}

interface UrgentIssuesResponse {
  issues: {
    nodes: Array<{
      id: string;
      identifier: string;
      title: string;
      priority: number;
      url: string;
      state?: { name: string; type: string };
      assignee?: { name: string };
      team?: { key: string; name: string };
    }>;
  };
}

interface StandupIssueNode {
  id: string;
  identifier: string;
  title: string;
  priority?: number;
  team?: { key: string };
}

interface StandupResponse {
  todos: { assignedIssues: { nodes: StandupIssueNode[] } };
  inProgress: { assignedIssues: { nodes: StandupIssueNode[] } };
  recentlyDone: { assignedIssues: { nodes: StandupIssueNode[] } };
}

interface BranchResponse {
  issue: { branchName: string } | null;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Expected a number, got "${value}".`);
  }
  return parsed;
}

function isObserveResult(value: unknown): value is ObserveResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "identifier" in value &&
    "comments" in value &&
    "createdAt" in value
  );
}

function renderTimeline(data: ObserveResult): string {
  const lines: string[] = [];
  const sep = "─".repeat(56);

  // Header
  lines.push(`${data.identifier} | ${data.title}`);
  const metaParts = [`State: ${data.state.name}`, `Priority: ${data.priority}`];
  if (data.createdAt) {
    const rel = data.createdAt ? relativeTime(data.createdAt) : "";
    metaParts.push(`Created: ${data.createdAt}${rel ? ` (${rel})` : ""}`);
  }
  lines.push(metaParts.join(" | "));
  if (data.assignee) lines.push(`Assignee: ${data.assignee.name}`);
  if (data.delegate) lines.push(`Delegate: ${data.delegate.name}`);

  lines.push("");
  lines.push(`── Timeline ${sep}`);
  lines.push("");

  // Issue creation event
  if (data.createdAt) {
    const rel = relativeTime(data.createdAt);
    lines.push(`📌 ${data.createdAt} (${rel}) — Issue created`);
  }

  // Comments
  for (const comment of data.comments) {
    const rel = comment.createdAt ? relativeTime(comment.createdAt) : "";
    const user = comment.user?.name ?? "Unknown";
    lines.push("");
    lines.push(`💬 ${comment.createdAt}${rel ? ` (${rel})` : ""} — ${user}`);
    lines.push(`   ${wrapText(comment.body, 70).split("\n").join("\n   ")}`);
  }

  return lines.join("\n") + "\n";
}

function printResult(result: unknown, human = false): void {
  if (human && isObserveResult(result)) {
    process.stdout.write(renderTimeline(result));
    return;
  }

  if (!human) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (typeof result === "string") {
    process.stdout.write(`${result}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function runCommand(handler: () => Promise<unknown>, human = false): Promise<void> {
  try {
    const result = await handler();
    printResult(result, human);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    if (isDebugMode() && error instanceof LinearApiError && error.details?.length) {
      process.stderr.write(`[DEBUG] Raw GraphQL error details: ${JSON.stringify(error.details, null, 2)}\n`);
    }
    process.exitCode = 1;
  }
}

const DEPRECATION_MSG =
  "⚠️  This command is deprecated for agent use. Use semantic commands: consider-work, refuse-work, begin-work, handoff-work, complete, needs-human. Pass --silence-deprecation to suppress.";

function deprecationWarn(cmd: string, noWarn?: boolean): void {
  if (!noWarn) {
    process.stderr.write(`${DEPRECATION_MSG}\n`);
  }
}

async function main(): Promise<void> {
  const program = new Command();
  program.name("linear").description("Linear CLI for OpenClaw").option("--human", "Use readable output").option("--debug", "Dump raw GraphQL errors to stderr");
  setDebugMode(!!program.opts<{ debug?: boolean }>().debug);

  const auth = program.command("auth").description("Auth operations");
  auth.command("check").description("Verify auth").action(async () => {
    await runCommand(async () => ({ viewer: await checkAuth() }), program.opts<{ human?: boolean }>().human);
  });
  auth.command("doctor").description("Diagnose Linear auth and CLI setup").action(async () => {
    await runCommand(async () => linearDoctor(), program.opts<{ human?: boolean }>().human);
  });

  // --- Consolidated queue + my-issues commands ---

  program.command("queue")
    .description("Issues delegated to you (your work queue)")
    .option("--next", "Return only the highest-priority issue")
    .option("--blocked", "Show only blocked issues")
    .option("--project <name>", "Filter by project name")
    .action(async (options: { next?: boolean; blocked?: boolean; project?: string }) => {
      await runCommand(async () => {
        if (options.blocked) return getMyBlocked(undefined);
        const queue = await getMyQueue(options.project);
        if (options.next) {
          if (queue.length === 0) return { message: "Queue is empty — nothing to do." };
          return queue[0];
        }
        return queue;
      }, program.opts<{ human?: boolean }>().human);
    });

  program.command("my-issues")
    .description("All issues assigned or delegated to you")
    .option("--status <status>", "Filter by status name (e.g. 'To Do', 'Thinking')")
    .option("--new", "Show only new (unviewed) issues")
    .option("--since <iso>", "Issues created since this date")
    .action(async (options: { status?: string; new?: boolean; since?: string }) => {
      await runCommand(async () => {
        if (options.new) return getMyNewIssues(options.since);
        if (options.status) return getMyIssues([options.status]);
        return getMyIssues();
      }, program.opts<{ human?: boolean }>().human);
    });

  // --- Legacy my-* commands (hidden, backward compat) ---
  // These are thin wrappers that delegate to the canonical commands.

  program.command("my-todos", { hidden: true }).action(async () => {
    await program.parseAsync(["node", "linear", "my-issues", "--status", "Todo"]);
  });

  program.command("my-new", { hidden: true }).option("--since <iso>").action(async (options: { since?: string }) => {
    const args = ["node", "linear", "my-issues", "--new"];
    if (options.since) args.push("--since", options.since);
    await program.parseAsync(args);
  });

  program.command("my-queue", { hidden: true })
    .option("--project <name>", "Filter by project name")
    .action(async (options: { project?: string }) => {
      const args = ["node", "linear", "queue"];
      if (options.project) args.push("--project", options.project);
      await program.parseAsync(args);
    });

  program.command("my-next", { hidden: true }).action(async () => {
    await program.parseAsync(["node", "linear", "queue", "--next"]);
  });

  program.command("issue").argument("<id>").action(async (id: string) => {
    await runCommand(async () => getIssue(id), program.opts<{ human?: boolean }>().human);
  });

  program
    .command("create")
    .argument("<team>")
    .argument("<title>")
    .option("--description <description>")
    .option("--project <projectId>")
    .option("--milestone <milestoneId>")
    .option("--assignee <assigneeId>")
    .option("--priority <priority>")
    .option("--parent <parentId>")
    .action(async (team: string, title: string, options: Record<string, string | undefined>) => {
      await runCommand(async () => {
        const teamId = await resolveTeamId(team);
        const input: CreateIssueInput = {
          title,
          description: options.description,
          projectId: options.project,
          projectMilestoneId: options.milestone,
          assigneeId: options.assignee,
          priority: parseOptionalNumber(options.priority),
          parentId: options.parent
        } as CreateIssueInput;
        if (teamId) {
          input.teamId = teamId;
        }
        return createIssue(input);
      }, program.opts<{ human?: boolean }>().human);
    });

  program
    .command("comment", { hidden: true })
    .argument("<id>")
    .argument("[body]")
    .option("--body-file <path>")
    .action(async () => {
      console.error("Error: 'linear comment' has been removed. Comments must be paired with a state transition.");
      console.error("Use one of: handoff-work, needs-human, refuse-work, or complete (with --comment flag).");
      process.exit(1);
    });

  program.command("states").argument("<team>").option("--refresh").action(async (team: string, options: { refresh?: boolean }) => {
    await runCommand(async () => {
      const teamId = await resolveTeamId(team);
      return getWorkflowStates(teamId, Boolean(options.refresh));
    }, program.opts<{ human?: boolean }>().human);
  });

  program.command("status", { hidden: true }).argument("<id>").argument("<state>").option("--team <teamId>").option("--silence-deprecation", "Suppress deprecation warning").action(async (id: string, state: string, options: { team?: string; silenceDeprecation?: boolean }) => {
    deprecationWarn("status", options.silenceDeprecation);
    await runCommand(async () => {
      const issue = await getIssue(id);
      const teamId = options.team ?? issue.team?.id;
      if (!teamId) {
        throw new Error(`Unable to resolve a team for issue ${id}. Pass --team explicitly.`);
      }
      const resolved = await findStateByName(teamId, state);
      return updateIssue(id, { stateId: resolved.id });
    }, program.opts<{ human?: boolean }>().human);
  });

  program.command("edit").argument("<id>").option("--title <title>").option("--description <description>").action(async (id: string, options: { title?: string; description?: string }) => {
    await runCommand(async () => {
      if (!options.title && !options.description) {
        throw new Error("At least one of --title or --description is required.");
      }
      const input: UpdateIssueInput = {};
      if (options.title) {
        input.title = options.title;
      }
      if (options.description) {
        input.description = options.description;
      }
      return updateIssue(id, input);
    }, program.opts<{ human?: boolean }>().human);
  });

  program.command("assign", { hidden: true }).argument("<id>").argument("<user>").option("--silence-deprecation", "Suppress deprecation warning").action(async (id: string, userName: string, options: { silenceDeprecation?: boolean }) => {
    deprecationWarn("assign", options.silenceDeprecation);
    await runCommand(async () => {
      const user = await findUserByName(userName);
      return updateIssue(id, { assigneeId: user.id, delegateId: null });
    }, program.opts<{ human?: boolean }>().human);
  });

  program.command("delegate", { hidden: true }).argument("<id>").argument("<agent>").option("--silence-deprecation", "Suppress deprecation warning").action(async (id: string, agentName: string, options: { silenceDeprecation?: boolean }) => {
    deprecationWarn("delegate", options.silenceDeprecation);
    await runCommand(async () => {
      const user = await findUserByName(agentName);
      return updateIssue(id, { delegateId: user.id });
    }, program.opts<{ human?: boolean }>().human);
  });

  program.command("priority").argument("<id>").argument("<level>").action(async (id: string, level: string) => {
    await runCommand(async () => updateIssue(id, { priority: parseOptionalNumber(level) }), program.opts<{ human?: boolean }>().human);
  });

  program.command("handoff", { hidden: true }).argument("<id>").argument("<reviewer>").argument("[comment]").option("--comment-file <path>").option("--silence-deprecation", "Suppress deprecation warning").action(async (id: string, reviewer: string, comment: string | undefined, options: { commentFile?: string; silenceDeprecation?: boolean }) => {
    deprecationWarn("handoff", options.silenceDeprecation);
    const args = ["node", "linear", "handoff-work", id, reviewer];
    if (comment) args.push(comment);
    if (options.commentFile) args.push("--comment-file", options.commentFile);
    await program.parseAsync(args);
  });

  program.command("projects").action(async () => {
    await runCommand(async () => listProjects(), program.opts<{ human?: boolean }>().human);
  });
  program.command("project-detail").argument("<name>").action(async (name: string) => {
    await runCommand(async () => getProjectDetail(name), program.opts<{ human?: boolean }>().human);
  });
  program.command("project-attach").argument("<id>").argument("<name>").action(async (id: string, name: string) => {
    await runCommand(async () => attachIssueToProject(id, name), program.opts<{ human?: boolean }>().human);
  });
  program.command("project-issues").argument("<name>").action(async (name: string) => {
    await runCommand(async () => getProjectIssues(name), program.opts<{ human?: boolean }>().human);
  });
  program.command("milestones").argument("<team>").action(async (team: string) => {
    await runCommand(async () => {
      const teamId = await resolveTeamId(team);
      return listMilestones(teamId);
    }, program.opts<{ human?: boolean }>().human);
  });
  program.command("milestone-create").argument("<project>").argument("<name>").argument("<targetDate>").action(async (project: string, name: string, targetDate: string) => {
    await runCommand(async () => createMilestone(project, name, targetDate), program.opts<{ human?: boolean }>().human);
  });
  program.command("milestone-attach").argument("<id>").argument("<name>").action(async (id: string, name: string) => {
    await runCommand(async () => attachIssueToMilestone(id, name), program.opts<{ human?: boolean }>().human);
  });
  program.command("relations").argument("<id>").action(async (id: string) => {
    await runCommand(async () => listRelations(id), program.opts<{ human?: boolean }>().human);
  });
  program.command("block").argument("<id>").requiredOption("--blocked-by <issueId>").option("--yes").action(async (id: string, options: { blockedBy: string; yes?: boolean }) => {
    await runCommand(async () => createBlockingRelation(id, options.blockedBy, "blocked-by", !options.yes), program.opts<{ human?: boolean }>().human);
  });
  program.command("unblock").argument("<id>").requiredOption("--blocked-by <issueId>").action(async (id: string, options: { blockedBy: string }) => {
    await runCommand(async () => removeBlockingRelation(id, options.blockedBy), program.opts<{ human?: boolean }>().human);
  });
  program.command("parent").argument("<id>").argument("<parentId>").description("Set parent issue (makes <id> a sub-issue of <parentId>)").action(async (id: string, parentId: string) => {
    await runCommand(() => setParent(id, parentId), program.opts<{ human?: boolean }>().human);
  });

  program.command("unparent").argument("<id>").description("Remove parent relationship from issue").action(async (id: string) => {
    await runCommand(() => removeParent(id), program.opts<{ human?: boolean }>().human);
  });

  program.command("subtask").argument("<team>").argument("<title>").requiredOption("--parent <id>").action(async (team: string, title: string, options: { parent: string }) => {
    await runCommand(async () => {
      const teamId = await resolveTeamId(team);
      return createIssue({ teamId, title, parentId: options.parent });
    }, program.opts<{ human?: boolean }>().human);
  });
  program.command("children").argument("<id>").action(async (id: string) => {
    await runCommand(async () => (await getIssue(id)).children ?? [], program.opts<{ human?: boolean }>().human);
  });

  program.command("board").argument("<team>").action(async (team: string) => {
    await runCommand(async () => {
      const teamId = await resolveTeamId(team);
      return getBoard(teamId);
    }, program.opts<{ human?: boolean }>().human);
  });
  program.command("review-queue").action(async () => {
    await runCommand(async () => getReviewQueue(), program.opts<{ human?: boolean }>().human);
  });
  program.command("stalled").argument("[days]").action(async (days: string | undefined) => {
    await runCommand(async () => getStalled(days ? Number(days) : 2), program.opts<{ human?: boolean }>().human);
  });
  program.command("comments", { hidden: true }).argument("<id>").option("--all").action(async (id: string, options: { all?: boolean }) => {
    const args = ["node", "linear", "observe-issue", id];
    if (options.all) args.push("--all");
    await program.parseAsync(args);
  });

  program.command("upload").argument("<file>").option("--comment <issueId>").action(async (file: string, options: { comment?: string }) => {
    await runCommand(async () => uploadFile(file, options.comment), program.opts<{ human?: boolean }>().human);
  });

  // --- New commands ---

  program.command("teams").option("--refresh").description("List all teams").action(async (options: { refresh?: boolean }) => {
    await runCommand(async () => listTeams(Boolean(options.refresh)), program.opts<{ human?: boolean }>().human);
  });

  program.command("notifications").option("--limit <n>").description("Unread notifications").action(async (options: { limit?: string }) => {
    await runCommand(async () => {
      const limit = options.limit ? Number(options.limit) : 25;
      const data = await linearGraphQL<NotificationsResponse>(
        `
          query Notifications($first: Int!) {
            notifications(first: $first) {
              nodes {
                id
                type
                readAt
                createdAt
                updatedAt
                ... on IssueNotification {
                  issue { id identifier title state { name } }
                }
                ... on ProjectNotification {
                  project { id name }
                }
              }
            }
          }
        `,
        { first: limit }
      );
      return data.notifications.nodes.filter((n: { readAt?: string | null }) => !n.readAt);
    }, program.opts<{ human?: boolean }>().human);
  });

  program.command("urgent").option("--limit <n>").description("High-priority issues (priority ≤ 2)").action(async (options: { limit?: string }) => {
    await runCommand(async () => {
      const limit = options.limit ? Number(options.limit) : 25;
      const data = await linearGraphQL<UrgentIssuesResponse>(
        `
          query UrgentIssues($first: Int!) {
            issues(first: $first, filter: {
              priority: { lte: 2, gte: 1 },
              state: { type: { nin: ["completed", "canceled"] } }
            }) {
              nodes {
                id identifier title priority url
                state { name type }
                assignee { name }
                team { key name }
              }
            }
          }
        `,
        { first: limit }
      );
      return data.issues.nodes;
    }, program.opts<{ human?: boolean }>().human);
  });

  program.command("standup").description("Daily standup summary").action(async () => {
    await runCommand(async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const data = await linearGraphQL<StandupResponse>(
        `
          query Standup($since: DateTimeOrDuration!) {
            todos: viewer {
              assignedIssues(first: 50, filter: { state: { name: { in: ["Todo"] } } }) {
                nodes { id identifier title priority team { key } }
              }
            }
            inProgress: viewer {
              assignedIssues(first: 50, filter: { state: { name: { in: ["In Progress"] } } }) {
                nodes { id identifier title priority team { key } }
              }
            }
            recentlyDone: viewer {
              assignedIssues(first: 50, filter: {
                state: { type: { eq: "completed" } },
                completedAt: { gte: $since }
              }) {
                nodes { id identifier title team { key } }
              }
            }
          }
        `,
        { since: sevenDaysAgo }
      );

      return {
        todos: data.todos.assignedIssues.nodes,
        inProgress: data.inProgress.assignedIssues.nodes,
        recentlyDone: data.recentlyDone.assignedIssues.nodes
      };
    }, program.opts<{ human?: boolean }>().human);
  });

  program.command("branch").argument("<id>").description("Get branch name for an issue").action(async (id: string) => {
    await runCommand(async () => {
      const issue = await getIssue(id);
      const data = await linearGraphQL<BranchResponse>(
        `
          query IssueBranch($id: String!) {
            issue(id: $id) {
              branchName
            }
          }
        `,
        { id: issue.id }
      );
      if (!data.issue?.branchName) {
        throw new Error(`No branch name for issue ${id}`);
      }
      return { identifier: issue.identifier, branchName: data.issue.branchName };
    }, program.opts<{ human?: boolean }>().human);
  });

  program.command("test").description("Run full round-trip test of Linear CLI").action(async () => {
    await linearTest();
  });

  // --- Delete commands ---

  program.command("delete").argument("<id>").description("Delete an issue").action(async (id: string) => {
    await runCommand(async () => deleteIssue(id), program.opts<{ human?: boolean }>().human);
  });

  program.command("delete-comment").argument("<commentId>").description("Delete a comment").action(async (commentId: string) => {
    await runCommand(async () => deleteComment(commentId), program.opts<{ human?: boolean }>().human);
  });

  program.command("verify-comment").argument("<commentId>").description("Verify a comment exists using strongly-consistent node lookup").action(async (commentId: string) => {
    const result = await verifyComment(commentId);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.exists) {
      process.exitCode = 1;
    }
  });

  // --- Label commands ---

  program.command("labels").option("--team <team>").description("List available labels for a team").action(async (options: { team?: string }) => {
    await runCommand(async () => listLabels(options.team), program.opts<{ human?: boolean }>().human);
  });

  program.command("label").argument("<id>").argument("<labelName...>").option("--team <team>").description("Add label(s) to an issue").action(async (id: string, labelNames: string[], options: { team?: string }) => {
    await runCommand(async () => addLabels(id, labelNames, options.team), program.opts<{ human?: boolean }>().human);
  });

  program.command("unlabel").argument("<id>").argument("<labelName...>").option("--team <team>").description("Remove label(s) from an issue").action(async (id: string, labelNames: string[], options: { team?: string }) => {
    await runCommand(async () => removeLabels(id, labelNames, options.team), program.opts<{ human?: boolean }>().human);
  });

  // --- Search command ---

  program.command("search").argument("<query>").option("--team <team>").option("--limit <n>").description("Search issues by text").action(async (query: string, options: { team?: string; limit?: string }) => {
    await runCommand(async () => {
      const teamId = options.team ? await resolveTeamId(options.team) : undefined;
      return searchIssues(query, teamId, options.limit ? Number(options.limit) : undefined);
    }, program.opts<{ human?: boolean }>().human);
  });

  // --- My blocked (hidden, backward compat) ---

  program.command("my-blocked", { hidden: true }).option("--limit <n>").description("Show issues assigned to me that are Blocked").action(async (options: { limit?: string }) => {
    await program.parseAsync(["node", "linear", "queue", "--blocked"]);
  });

  // --- Semantic commands ---

  // --- Semantic commands (kebab-case primary, camelCase aliases for compat) ---

  program.command("note").argument("<id>").requiredOption("--comment <msg>", "Comment body").option("--comment-file <path>", "Read comment from file").description("Post a comment on an issue without changing state, delegate, or assignee").action(async (id: string, options: { comment?: string; commentFile?: string }) => {
    await runCommand(async () => note(id, options), program.opts<{ human?: boolean }>().human);
  });

  program.command("observe-issue").alias("observeIssue").argument("<id>").option("--all", "Include all comments instead of last 10").description("Read-only observation of an issue (no ownership change)").action(async (id: string, options: { all?: boolean }) => {
    await runCommand(async () => observeIssue(id, options.all), program.opts<{ human?: boolean }>().human);
  });

  program.command("consider-work").alias("considerWork").argument("<id>").description("Mark issue as being considered by agent (returns issue context)").action(async (id: string) => {
    await runCommand(async () => considerWork(id), program.opts<{ human?: boolean }>().human);
  });

  program.command("refuse-work").alias("refuseWork").argument("<id>").argument("<delegate>", "agent display name in quotes, e.g. \"Astrid (CPO)\"").option("--comment <msg>").option("--comment-file <path>").description("Refuse task and delegate to another agent").action(async (id: string, delegate: string, options: { comment?: string; commentFile?: string }) => {
    await runCommand(async () => refuseWork(id, delegate, options), program.opts<{ human?: boolean }>().human);
  });

  program.command("begin-work").alias("beginWork").argument("<id>").description("Begin actively working on a task (idempotent)").action(async (id: string) => {
    await runCommand(async () => beginWork(id), program.opts<{ human?: boolean }>().human);
  });

  program.command("handoff-work").alias("handoffWork").argument("<id>").argument("<delegate>", "agent display name in quotes, e.g. \"Charles (CTO)\"").option("--comment <msg>").option("--comment-file <path>").description("Hand off task to another agent").action(async (id: string, delegate: string, options: { comment?: string; commentFile?: string }) => {
    await runCommand(async () => handoffWork(id, delegate, options), program.opts<{ human?: boolean }>().human);
  });

  program.command("complete").argument("<id>").option("--comment <msg>").option("--comment-file <path>").description("Mark task as complete").action(async (id: string, options: { comment?: string; commentFile?: string }) => {
    await runCommand(async () => complete(id, options), program.opts<{ human?: boolean }>().human);
  });

  program.command("needs-human").alias("needsHuman").argument("<id>").argument("<assignee>", "human display name in quotes, e.g. \"Matt Henry\"").option("--comment <msg>").option("--comment-file <path>").description("Escalate to human for action").action(async (id: string, assignee: string, options: { comment?: string; commentFile?: string }) => {
    await runCommand(async () => needsHuman(id, assignee, options), program.opts<{ human?: boolean }>().human);
  });

  await program.parseAsync(process.argv);
}

void main();
