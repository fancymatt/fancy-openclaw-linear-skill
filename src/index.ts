#!/usr/bin/env node
import fs from "node:fs/promises";

import { Command } from "commander";

import { checkAuth } from "./auth";
import { getBoard, getComments, getReviewQueue, getStalled } from "./boards";
import { handoffIssue } from "./handoff";
import { addComment, createIssue, findUserByName, getIssue, getMyIssues, getMyNewIssues, updateIssue } from "./issues";
import { attachIssueToMilestone, attachIssueToProject, createMilestone, getProjectDetail, getProjectIssues, listMilestones, listProjects } from "./projects";
import { createBlockingRelation, listRelations, removeBlockingRelation } from "./relations";
import { findStateByName, getWorkflowStates } from "./states";
import { uploadFile } from "./upload";
import { CreateIssueInput, UpdateIssueInput } from "./types";

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

function printResult(result: unknown, human = false): void {
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
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const program = new Command();
  program.name("linear").description("Linear CLI for OpenClaw").option("--human", "Use readable output");

  const auth = program.command("auth").description("Auth operations");
  auth.command("check").description("Verify auth").action(async () => {
    await runCommand(async () => ({ viewer: await checkAuth() }), program.opts<{ human?: boolean }>().human);
  });

  program.command("my-issues").action(async () => {
    await runCommand(async () => getMyIssues(), program.opts<{ human?: boolean }>().human);
  });

  program.command("my-todos").action(async () => {
    await runCommand(async () => getMyIssues(["Todo"]), program.opts<{ human?: boolean }>().human);
  });

  program.command("my-new").option("--since <iso>").action(async (options: { since?: string }) => {
    await runCommand(async () => getMyNewIssues(options.since), program.opts<{ human?: boolean }>().human);
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
        const input: CreateIssueInput = {
          teamId: team,
          title,
          description: options.description,
          projectId: options.project,
          projectMilestoneId: options.milestone,
          assigneeId: options.assignee,
          priority: parseOptionalNumber(options.priority),
          parentId: options.parent
        };
        return createIssue(input);
      }, program.opts<{ human?: boolean }>().human);
    });

  program
    .command("comment")
    .argument("<id>")
    .argument("[body]")
    .option("--body-file <path>")
    .action(async (id: string, body: string | undefined, options: Record<string, string | undefined>) => {
      await runCommand(async () => {
        const finalBody = options.bodyFile ? await fs.readFile(options.bodyFile, "utf8") : body;
        if (!finalBody) {
          throw new Error("Comment body is required. Pass <body> or --body-file.");
        }
        return addComment(id, finalBody);
      }, program.opts<{ human?: boolean }>().human);
    });

  program.command("states").argument("<team>").option("--refresh").action(async (team: string, options: { refresh?: boolean }) => {
    await runCommand(async () => getWorkflowStates(team, Boolean(options.refresh)), program.opts<{ human?: boolean }>().human);
  });

  program.command("status").argument("<id>").argument("<state>").option("--team <teamId>").action(async (id: string, state: string, options: { team?: string }) => {
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

  program.command("assign").argument("<id>").argument("<user>").action(async (id: string, userName: string) => {
    await runCommand(async () => {
      const user = await findUserByName(userName);
      return updateIssue(id, { assigneeId: user.id });
    }, program.opts<{ human?: boolean }>().human);
  });

  program.command("priority").argument("<id>").argument("<level>").action(async (id: string, level: string) => {
    await runCommand(async () => updateIssue(id, { priority: parseOptionalNumber(level) }), program.opts<{ human?: boolean }>().human);
  });

  program.command("handoff").argument("<id>").argument("<reviewer>").argument("[comment]").option("--comment-file <path>").action(async (id: string, reviewer: string, comment: string | undefined, options: { commentFile?: string }) => {
    await runCommand(async () => handoffIssue(id, reviewer, comment, options.commentFile), program.opts<{ human?: boolean }>().human);
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
    await runCommand(async () => listMilestones(team), program.opts<{ human?: boolean }>().human);
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
  program.command("subtask").argument("<team>").argument("<title>").requiredOption("--parent <id>").action(async (team: string, title: string, options: { parent: string }) => {
    await runCommand(async () => createIssue({ teamId: team, title, parentId: options.parent }), program.opts<{ human?: boolean }>().human);
  });
  program.command("children").argument("<id>").action(async (id: string) => {
    await runCommand(async () => (await getIssue(id)).children ?? [], program.opts<{ human?: boolean }>().human);
  });

  program.command("board").argument("<team>").action(async (team: string) => {
    await runCommand(async () => getBoard(team), program.opts<{ human?: boolean }>().human);
  });
  program.command("review-queue").action(async () => {
    await runCommand(async () => getReviewQueue(), program.opts<{ human?: boolean }>().human);
  });
  program.command("stalled").argument("[days]").action(async (days: string | undefined) => {
    await runCommand(async () => getStalled(days ? Number(days) : 2), program.opts<{ human?: boolean }>().human);
  });
  program.command("comments").argument("<id>").option("--all").action(async (id: string, options: { all?: boolean }) => {
    await runCommand(async () => getComments(id, Boolean(options.all)), program.opts<{ human?: boolean }>().human);
  });

  program.command("upload").argument("<file>").option("--comment <issueId>").action(async (file: string, options: { comment?: string }) => {
    await runCommand(async () => uploadFile(file, options.comment), program.opts<{ human?: boolean }>().human);
  });

  await program.parseAsync(process.argv);
}

void main();
