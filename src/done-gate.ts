import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export interface CommitRef {
  /** Raw sha as it appeared in the comment (7-40 hex chars). */
  sha: string;
  /** Present when the sha was extracted from a github.com/<owner>/<name>/commit/<sha> URL. */
  repo?: { owner: string; name: string };
  /** Verbatim text that produced this ref (for error messages). */
  source: string;
}

export interface PrRef {
  url: string;
  owner: string;
  name: string;
  number: number;
}

export interface ExtractedArtifacts {
  commits: CommitRef[];
  branches: string[];
  prs: PrRef[];
}

export type ArtifactKind = "commit" | "branch" | "pr";

export interface ArtifactFailure {
  kind: ArtifactKind;
  ref: string;
  reason: string;
}

export interface VerificationResult {
  ok: boolean;
  failures: ArtifactFailure[];
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface DoneGateRunner {
  runGit: (args: string[], opts?: { cwd?: string }) => Promise<RunResult>;
  runGh: (args: string[]) => Promise<RunResult>;
}

const COMMIT_URL_RE = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/commit\/([0-9a-f]{7,40})\b/gi;
const COMMIT_KEYWORD_RE = /\b(?:commit|sha)[:\s]+`?([0-9a-f]{7,40})`?/gi;
const COMMIT_FULL_RE = /(?<![\w])([0-9a-f]{40})(?![\w])/g;
const COMMIT_BACKTICK_SHORT_RE = /`([0-9a-f]{7,12})`/g;

const PR_URL_RE = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/pull\/(\d+)\b/gi;

const BRANCH_KEYWORD_RE = /\b(?:branch|on\s+branch)[:\s]+`?([\w][\w./\-]{0,200})`?/gi;
const BRANCH_PUSHED_TO_RE = /\bpushed\s+to\s+`?([\w][\w./\-]{2,200})`?/gi;

const BRANCH_BLOCKLIST = new Set([
  "main",
  "master",
  "origin",
  "remote",
  "head",
  "trunk",
  "production",
  "prod",
]);

export function extractGitArtifacts(text: string): ExtractedArtifacts {
  const commits = new Map<string, CommitRef>();
  const branches = new Set<string>();
  const prs = new Map<string, PrRef>();

  let m: RegExpExecArray | null;

  COMMIT_URL_RE.lastIndex = 0;
  while ((m = COMMIT_URL_RE.exec(text)) !== null) {
    const sha = m[3].toLowerCase();
    commits.set(`url:${sha}`, {
      sha,
      repo: { owner: m[1], name: m[2] },
      source: m[0],
    });
  }

  COMMIT_KEYWORD_RE.lastIndex = 0;
  while ((m = COMMIT_KEYWORD_RE.exec(text)) !== null) {
    const sha = m[1].toLowerCase();
    const key = `kw:${sha}`;
    if (!commits.has(`url:${sha}`)) commits.set(key, { sha, source: m[0] });
  }

  COMMIT_BACKTICK_SHORT_RE.lastIndex = 0;
  while ((m = COMMIT_BACKTICK_SHORT_RE.exec(text)) !== null) {
    const sha = m[1].toLowerCase();
    if (!commits.has(`url:${sha}`) && !commits.has(`kw:${sha}`)) {
      commits.set(`bt:${sha}`, { sha, source: m[0] });
    }
  }

  COMMIT_FULL_RE.lastIndex = 0;
  while ((m = COMMIT_FULL_RE.exec(text)) !== null) {
    const sha = m[1].toLowerCase();
    if (![...commits.keys()].some((k) => k.endsWith(`:${sha}`))) {
      commits.set(`full:${sha}`, { sha, source: m[0] });
    }
  }

  PR_URL_RE.lastIndex = 0;
  while ((m = PR_URL_RE.exec(text)) !== null) {
    const url = m[0];
    prs.set(url, {
      url,
      owner: m[1],
      name: m[2],
      number: Number(m[3]),
    });
  }

  const collectBranch = (raw: string) => {
    const cleaned = raw.replace(/[.,;:!?)`'"\]]+$/, "").trim();
    if (!cleaned) return;
    const lc = cleaned.toLowerCase();
    if (BRANCH_BLOCKLIST.has(lc)) return;
    if (/^[0-9a-f]{7,40}$/.test(cleaned)) return;
    if (!/[\/_\-]/.test(cleaned) && !/^[\w]+\/[\w]/.test(cleaned)) {
      // single bare word with no separator — too ambiguous (e.g. "production")
      return;
    }
    branches.add(cleaned);
  };

  BRANCH_KEYWORD_RE.lastIndex = 0;
  while ((m = BRANCH_KEYWORD_RE.exec(text)) !== null) collectBranch(m[1]);

  BRANCH_PUSHED_TO_RE.lastIndex = 0;
  while ((m = BRANCH_PUSHED_TO_RE.exec(text)) !== null) collectBranch(m[1]);

  return {
    commits: [...commits.values()],
    branches: [...branches],
    prs: [...prs.values()],
  };
}

function defaultRun(cmd: string, args: string[], opts?: { cwd?: string }): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts?.cwd ?? process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("error", (err) => resolve({ stdout, stderr: stderr + String(err), code: 1 }));
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
  });
}

export const defaultRunner: DoneGateRunner = {
  runGit: (args, opts) => defaultRun("git", args, opts),
  runGh: (args) => defaultRun("gh", args),
};

let testRunnerOverride: DoneGateRunner | null = null;

/** Test seam: override the runner used by guardDoneGate when no runner is passed. */
export function __setTestRunner(runner: DoneGateRunner | null): void {
  testRunnerOverride = runner;
}

function activeRunner(): DoneGateRunner {
  return testRunnerOverride ?? defaultRunner;
}

export async function verifyArtifacts(
  artifacts: ExtractedArtifacts,
  runner: DoneGateRunner = defaultRunner
): Promise<VerificationResult> {
  const failures: ArtifactFailure[] = [];

  for (const commit of artifacts.commits) {
    if (commit.repo) {
      const ghPath = `repos/${commit.repo.owner}/${commit.repo.name}/commits/${commit.sha}`;
      const res = await runner.runGh(["api", ghPath, "--silent"]);
      if (res.code !== 0) {
        failures.push({
          kind: "commit",
          ref: commit.source,
          reason: `gh api ${ghPath} returned ${res.code}: ${(res.stderr || res.stdout).trim().split("\n")[0] || "not found"}`,
        });
      }
    } else {
      const res = await runner.runGit(["cat-file", "-e", commit.sha]);
      if (res.code !== 0) {
        failures.push({
          kind: "commit",
          ref: commit.source,
          reason: `git cat-file -e ${commit.sha} returned ${res.code}: commit not present in local repo (cwd may not be the right repo, or commit was never created)`,
        });
      }
    }
  }

  for (const branch of artifacts.branches) {
    const res = await runner.runGit(["ls-remote", "--heads", "origin", branch]);
    if (res.code !== 0) {
      failures.push({
        kind: "branch",
        ref: branch,
        reason: `git ls-remote --heads origin ${branch} returned ${res.code}: ${(res.stderr || "ls-remote failed").trim().split("\n")[0]}`,
      });
    } else if (!res.stdout.trim()) {
      failures.push({
        kind: "branch",
        ref: branch,
        reason: `branch '${branch}' does not exist on origin`,
      });
    }
  }

  for (const pr of artifacts.prs) {
    const res = await runner.runGh(["pr", "view", pr.url, "--json", "state,headRefOid"]);
    if (res.code !== 0) {
      failures.push({
        kind: "pr",
        ref: pr.url,
        reason: `gh pr view returned ${res.code}: ${(res.stderr || res.stdout).trim().split("\n")[0] || "not found"}`,
      });
    }
  }

  return { ok: failures.length === 0, failures };
}

export function formatProvenanceError(issueId: string, failures: ArtifactFailure[]): string {
  const lines: string[] = [];
  const summary = failures.map((f) => `${f.kind}:${f.ref}`).join(", ");
  lines.push(`DONE_GATE_PROVENANCE_FAILED: ${summary}`);
  lines.push(`Issue ${issueId} comment references git artifacts that do not exist:`);
  for (const f of failures) {
    lines.push(`  - ${f.kind} ${f.ref}: ${f.reason}`);
  }
  lines.push(`Either commit/push/open-PR the work first, or remove the false claim from the comment.`);
  lines.push(`Bypass with --force-done-claim (logged loudly).`);
  return lines.join("\n");
}

const LOG_PATH = path.join(
  process.env.HOME ?? "~",
  "obsidian-vault/ai-systems/areas/agent-behavior/escalation-pattern-log.md"
);

export type DoneGateLogKind = "REFUSED" | "FORCE-BYPASS";

export async function logDoneGateEvent(
  issueId: string,
  kind: DoneGateLogKind,
  detail: string
): Promise<void> {
  const timestamp = new Date().toISOString();
  const line = `| ${timestamp} | CLI | ${issueId} | done-gate | \`${detail.replace(/\|/g, "\\|").slice(0, 240)}\` | ${kind} |\n`;
  try {
    await fs.appendFile(LOG_PATH, line);
  } catch {
    // Log failure is non-fatal
  }
}

export interface GuardOptions {
  comment?: string;
  commentFile?: string;
  forceDoneClaim?: boolean;
}

async function resolveCommentText(options?: GuardOptions): Promise<string> {
  if (options?.commentFile) {
    try {
      return (await fs.readFile(options.commentFile, "utf8")).trim();
    } catch {
      return "";
    }
  }
  return options?.comment?.trim() ?? "";
}

/**
 * Done-gate provenance check. Artifact-driven: if the comment references a
 * commit hash, branch name, or PR URL, each is verified against git/GitHub.
 * If any referenced artifact doesn't exist, the post is refused (unless
 * forceDoneClaim is set). Comments with no artifact references are a no-op,
 * regardless of "done"-shape language or ticket team.
 */
export async function guardDoneGate(
  issueId: string,
  options?: GuardOptions,
  runner: DoneGateRunner = activeRunner()
): Promise<void> {
  const text = await resolveCommentText(options);
  if (!text) return;

  const artifacts = extractGitArtifacts(text);
  const hasArtifacts =
    artifacts.commits.length + artifacts.branches.length + artifacts.prs.length > 0;
  if (!hasArtifacts) return;

  const result = await verifyArtifacts(artifacts, runner);
  if (result.ok) return;

  const detail = result.failures.map((f) => `${f.kind}:${f.ref}`).join("; ");
  await logDoneGateEvent(
    issueId,
    options?.forceDoneClaim ? "FORCE-BYPASS" : "REFUSED",
    detail
  );

  if (!options?.forceDoneClaim) {
    throw new Error(formatProvenanceError(issueId, result.failures));
  }

  process.stderr.write(
    `⚠️  --force-done-claim used: bypassing done-gate refusal for ${detail}.\n`
  );
}
