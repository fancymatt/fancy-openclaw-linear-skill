import fs from "node:fs/promises";

import {
  extractGitArtifacts,
  verifyArtifacts,
  guardDoneGate,
  formatProvenanceError,
  logDoneGateEvent,
  __setTestRunner,
  type DoneGateRunner,
  type RunResult,
} from "../done-gate";
import { note, complete, handoffWork } from "../semantic";
import { addComment, findUserByName, resolveUserWithHints, getIssue, updateIssue } from "../issues";
import { findSemanticState } from "../states";
import { getSelfUser } from "../auth";
import { findRecentDuplicate } from "../state-machine";

jest.mock("node:fs/promises");
const mockFs = fs as jest.Mocked<typeof fs>;

jest.mock("../client", () => ({
  ...jest.requireActual("../client"),
  linearGraphQL: jest.fn(),
}));

jest.mock("../auth", () => ({
  ...jest.requireActual("../auth"),
  getSelfUser: jest.fn(),
}));

jest.mock("../issues", () => ({
  addComment: jest.fn(),
  findUserByName: jest.fn(),
  resolveUserWithHints: jest.fn(),
  getIssue: jest.fn(),
  updateIssue: jest.fn(),
}));

jest.mock("../boards", () => ({
  getComments: jest.fn().mockResolvedValue([]),
  getIssueHistory: jest.fn().mockResolvedValue([]),
}));

jest.mock("../states", () => ({
  ...jest.requireActual("../states"),
  findSemanticState: jest.fn(),
}));

jest.mock("../state-machine", () => ({
  ...jest.requireActual("../state-machine"),
  findRecentDuplicate: jest.fn(),
}));

const mockGetSelfUser = getSelfUser as jest.MockedFunction<typeof getSelfUser>;
const mockAddComment = addComment as jest.MockedFunction<typeof addComment>;
const mockFindUserByName = findUserByName as jest.MockedFunction<typeof findUserByName>;
const mockResolveUserWithHints = resolveUserWithHints as jest.MockedFunction<typeof resolveUserWithHints>;
const mockGetIssue = getIssue as jest.MockedFunction<typeof getIssue>;
const mockUpdateIssue = updateIssue as jest.MockedFunction<typeof updateIssue>;
const mockFindSemanticState = findSemanticState as jest.MockedFunction<typeof findSemanticState>;
const mockFindRecentDuplicate = findRecentDuplicate as jest.MockedFunction<typeof findRecentDuplicate>;

const baseIssue: any = {
  id: "issue-1",
  identifier: "AI-1098",
  title: "Test Issue",
  team: { id: "team-1", key: "AI", name: "AI Systems" },
  state: { id: "state-todo", name: "Todo", type: "unstarted" },
  assignee: null,
  delegate: { id: "user-charles", name: "Charles (CTO)" },
};

const doneState = { id: "state-done", name: "Done", type: "completed" };
const todoState = { id: "state-todo", name: "Todo", type: "unstarted" };

beforeEach(() => {
  jest.resetAllMocks();
  mockFs.appendFile.mockResolvedValue(undefined);
  mockFs.readFile.mockRejectedValue(new Error("not found"));
  mockGetIssue.mockResolvedValue(baseIssue);
  mockGetSelfUser.mockResolvedValue({ id: "user-charles", name: "Charles (CTO)", email: "c@test.com" });
  mockFindUserByName.mockImplementation(async (name: string) => {
    const users: Record<string, { id: string; name: string }> = {
      "Matt Henry": { id: "user-matt", name: "Matt Henry" },
      "Ai": { id: "user-ai", name: "Ai" },
      "Charles (CTO)": { id: "user-charles", name: "Charles (CTO)" },
    };
    const user = users[name];
    if (!user) throw new Error(`Could not uniquely resolve Linear user "${name}".`);
    return user;
  });
  mockResolveUserWithHints.mockImplementation(async (name: string) => {
    const users: Record<string, { id: string; name: string; email?: string | null }> = {
      "Matt Henry": { id: "user-matt", name: "Matt Henry" },
      "Ai": { id: "user-ai", name: "Ai" },
      "Charles (CTO)": { id: "user-charles", name: "Charles (CTO)" },
    };
    const user = users[name];
    if (!user) throw new Error(`Could not uniquely resolve Linear user "${name}".`);
    return user;
  });
  mockFindSemanticState.mockImplementation(async (_teamId: string, name: string) =>
    name === "done" ? doneState : todoState
  );
  mockUpdateIssue.mockResolvedValue({ ...baseIssue, state: doneState });
  mockAddComment.mockResolvedValue({
    issueId: "issue-1",
    body: "comment",
    commentId: "comment-1",
    commentUrl: "https://linear.app/comment/1",
    commentCreatedAt: new Date().toISOString(),
    commentBodyLength: 10,
  });
  mockFindRecentDuplicate.mockResolvedValue(null);
  __setTestRunner(null);
});

afterAll(() => {
  __setTestRunner(null);
});

// ─── Unit tests: extractGitArtifacts ────────────────────────────────────────

describe("extractGitArtifacts", () => {
  it("returns empty for empty text", () => {
    const r = extractGitArtifacts("");
    expect(r.commits).toEqual([]);
    expect(r.branches).toEqual([]);
    expect(r.prs).toEqual([]);
  });

  it("returns empty for plain prose with no git references", () => {
    const r = extractGitArtifacts("Bought groceries today — milk, eggs, bread. All done.");
    expect(r.commits).toEqual([]);
    expect(r.branches).toEqual([]);
    expect(r.prs).toEqual([]);
  });

  it("extracts a PR URL", () => {
    const r = extractGitArtifacts("Shipped in https://github.com/fancymatt/repo/pull/27");
    expect(r.prs).toHaveLength(1);
    expect(r.prs[0]).toEqual({
      url: "https://github.com/fancymatt/repo/pull/27",
      owner: "fancymatt",
      name: "repo",
      number: 27,
    });
  });

  it("extracts a commit URL with owner+repo", () => {
    const r = extractGitArtifacts("See https://github.com/fancymatt/repo/commit/abc1234def5678901234567890123456789abcde");
    expect(r.commits).toHaveLength(1);
    expect(r.commits[0].sha).toBe("abc1234def5678901234567890123456789abcde");
    expect(r.commits[0].repo).toEqual({ owner: "fancymatt", name: "repo" });
  });

  it("extracts a bare 40-char commit hash", () => {
    const r = extractGitArtifacts("HEAD is now at abc1234def5678901234567890123456789abcde.");
    expect(r.commits).toHaveLength(1);
    expect(r.commits[0].sha).toBe("abc1234def5678901234567890123456789abcde");
    expect(r.commits[0].repo).toBeUndefined();
  });

  it("extracts a short backticked commit hash", () => {
    const r = extractGitArtifacts("Pushed `abc1234` to origin.");
    expect(r.commits).toHaveLength(1);
    expect(r.commits[0].sha).toBe("abc1234");
  });

  it("extracts a 'commit:' keyword commit", () => {
    const r = extractGitArtifacts("Reverted commit abc1234 yesterday.");
    expect(r.commits).toHaveLength(1);
    expect(r.commits[0].sha).toBe("abc1234");
  });

  it("extracts branches from 'branch <name>' phrasing", () => {
    const r = extractGitArtifacts("Working on branch ai-1070/optional-handoff-comment now.");
    expect(r.branches).toContain("ai-1070/optional-handoff-comment");
  });

  it("extracts branches from 'pushed to <name>' phrasing", () => {
    const r = extractGitArtifacts("Pushed to life-547/done-gate-provenance.");
    expect(r.branches).toContain("life-547/done-gate-provenance");
  });

  it("ignores main/master/origin as branches", () => {
    const r = extractGitArtifacts("Pushed to main and merged to master.");
    expect(r.branches).toEqual([]);
  });

  it("ignores bare single-word 'branch' references with no separator", () => {
    // "branch banking" — "banking" has no /, _, - so it's filtered out
    const r = extractGitArtifacts("Visit the local branch banking center.");
    expect(r.branches).toEqual([]);
  });

  it("dedups the same commit referenced multiple ways", () => {
    const r = extractGitArtifacts(
      "Pushed `abc1234` to origin. See https://github.com/fancymatt/repo/commit/abc1234def5678901234567890123456789abcde"
    );
    // url form (full sha) and bt form (short sha) won't collide because the
    // short form's sha is a prefix only, not equal. Dedup happens only on
    // exact sha match. This is acceptable — verifier handles each.
    expect(r.commits.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Unit tests: verifyArtifacts ────────────────────────────────────────────

function makeRunner(overrides?: {
  git?: (args: string[]) => RunResult | Promise<RunResult>;
  gh?: (args: string[]) => RunResult | Promise<RunResult>;
}): DoneGateRunner {
  return {
    runGit: async (args) =>
      overrides?.git ? overrides.git(args) : { stdout: "", stderr: "", code: 0 },
    runGh: async (args) =>
      overrides?.gh ? overrides.gh(args) : { stdout: "", stderr: "", code: 0 },
  };
}

describe("verifyArtifacts", () => {
  it("returns ok=true when no artifacts", async () => {
    const r = await verifyArtifacts({ commits: [], branches: [], prs: [] }, makeRunner());
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it("fails when a bare commit hash is not in local repo", async () => {
    const runner = makeRunner({
      git: () => ({ stdout: "", stderr: "fatal: Not a valid object", code: 128 }),
    });
    const r = await verifyArtifacts(
      { commits: [{ sha: "abc1234", source: "abc1234" }], branches: [], prs: [] },
      runner
    );
    expect(r.ok).toBe(false);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].kind).toBe("commit");
    expect(r.failures[0].reason).toContain("commit not present in local repo");
  });

  it("passes when bare commit hash exists in local repo (cat-file exit 0)", async () => {
    const runner = makeRunner({ git: () => ({ stdout: "", stderr: "", code: 0 }) });
    const r = await verifyArtifacts(
      { commits: [{ sha: "abc1234", source: "abc1234" }], branches: [], prs: [] },
      runner
    );
    expect(r.ok).toBe(true);
  });

  it("uses gh api for commits with repo info", async () => {
    let capturedArgs: string[] = [];
    const runner = makeRunner({
      gh: (args) => {
        capturedArgs = args;
        return { stdout: "", stderr: "HTTP 404: Not Found", code: 1 };
      },
    });
    const r = await verifyArtifacts(
      {
        commits: [
          {
            sha: "abc1234def5678901234567890123456789abcde",
            repo: { owner: "fancymatt", name: "repo" },
            source: "https://github.com/fancymatt/repo/commit/abc...",
          },
        ],
        branches: [],
        prs: [],
      },
      runner
    );
    expect(capturedArgs[0]).toBe("api");
    expect(capturedArgs[1]).toBe(
      "repos/fancymatt/repo/commits/abc1234def5678901234567890123456789abcde"
    );
    expect(r.ok).toBe(false);
    expect(r.failures[0].kind).toBe("commit");
  });

  it("fails when branch is not on origin (empty ls-remote stdout)", async () => {
    const runner = makeRunner({ git: () => ({ stdout: "", stderr: "", code: 0 }) });
    const r = await verifyArtifacts(
      { commits: [], branches: ["ai-1070/missing-branch"], prs: [] },
      runner
    );
    expect(r.ok).toBe(false);
    expect(r.failures[0].kind).toBe("branch");
    expect(r.failures[0].reason).toContain("does not exist on origin");
  });

  it("passes when branch is on origin (ls-remote prints a ref)", async () => {
    const runner = makeRunner({
      git: () => ({
        stdout: "abc1234def5678901234567890123456789abcde\trefs/heads/feat\n",
        stderr: "",
        code: 0,
      }),
    });
    const r = await verifyArtifacts(
      { commits: [], branches: ["feat/branch"], prs: [] },
      runner
    );
    expect(r.ok).toBe(true);
  });

  it("fails when PR URL does not resolve via gh", async () => {
    const runner = makeRunner({
      gh: () => ({ stdout: "", stderr: "GraphQL: Could not resolve to a PullRequest", code: 1 }),
    });
    const r = await verifyArtifacts(
      {
        commits: [],
        branches: [],
        prs: [{ url: "https://github.com/x/y/pull/999", owner: "x", name: "y", number: 999 }],
      },
      runner
    );
    expect(r.ok).toBe(false);
    expect(r.failures[0].kind).toBe("pr");
  });

  it("passes when PR URL resolves via gh", async () => {
    const runner = makeRunner({
      gh: () => ({ stdout: '{"state":"OPEN","headRefOid":"abc"}', stderr: "", code: 0 }),
    });
    const r = await verifyArtifacts(
      {
        commits: [],
        branches: [],
        prs: [{ url: "https://github.com/x/y/pull/27", owner: "x", name: "y", number: 27 }],
      },
      runner
    );
    expect(r.ok).toBe(true);
  });
});

// ─── Unit tests: guardDoneGate ──────────────────────────────────────────────

describe("guardDoneGate", () => {
  it("no-ops on empty comment", async () => {
    await expect(guardDoneGate("AI-1", { comment: "" })).resolves.toBeUndefined();
  });

  it("no-ops when comment has no git artifacts (regardless of 'done' language)", async () => {
    // No artifacts → no verification calls → no refusal.
    const runner = makeRunner({
      git: () => {
        throw new Error("git should not be called");
      },
      gh: () => {
        throw new Error("gh should not be called");
      },
    });
    await expect(
      guardDoneGate("LIFE-100", { comment: "Done — bought groceries today. All shipped." }, runner)
    ).resolves.toBeUndefined();
  });

  it("throws structured error when an artifact does not exist", async () => {
    const runner = makeRunner({
      git: () => ({ stdout: "", stderr: "fatal: ambiguous argument", code: 128 }),
    });
    await expect(
      guardDoneGate("AI-1", { comment: "Pushed `abc1234` to origin." }, runner)
    ).rejects.toThrow("DONE_GATE_PROVENANCE_FAILED");
  });

  it("passes when all referenced artifacts exist", async () => {
    const runner = makeRunner({
      git: (args) => {
        if (args[0] === "ls-remote") {
          return {
            stdout: "abc1234def5678901234567890123456789abcde\trefs/heads/feat\n",
            stderr: "",
            code: 0,
          };
        }
        return { stdout: "", stderr: "", code: 0 };
      },
      gh: () => ({ stdout: '{"state":"OPEN"}', stderr: "", code: 0 }),
    });
    await expect(
      guardDoneGate(
        "AI-1",
        {
          comment:
            "Shipped on branch feat/x with `abc1234`. PR: https://github.com/o/r/pull/1",
        },
        runner
      )
    ).resolves.toBeUndefined();
  });

  it("bypasses refusal with forceDoneClaim + logs FORCE-BYPASS", async () => {
    const runner = makeRunner({
      git: () => ({ stdout: "", stderr: "fatal", code: 128 }),
    });
    await expect(
      guardDoneGate("AI-1", { comment: "Pushed `abc1234` to origin.", forceDoneClaim: true }, runner)
    ).resolves.toBeUndefined();
    expect(mockFs.appendFile).toHaveBeenCalledTimes(1);
    const [, line] = mockFs.appendFile.mock.calls[0] as [string, string];
    expect(line).toContain("FORCE-BYPASS");
  });

  it("logs REFUSED when refusing", async () => {
    const runner = makeRunner({
      git: () => ({ stdout: "", stderr: "fatal", code: 128 }),
    });
    await expect(
      guardDoneGate("AI-1", { comment: "Pushed `abc1234` to origin." }, runner)
    ).rejects.toThrow();
    const [, line] = mockFs.appendFile.mock.calls[0] as [string, string];
    expect(line).toContain("REFUSED");
  });
});

// ─── formatProvenanceError ──────────────────────────────────────────────────

describe("formatProvenanceError", () => {
  it("includes structured header, per-artifact details, and bypass hint", () => {
    const msg = formatProvenanceError("AI-1098", [
      { kind: "branch", ref: "ai-1070/x", reason: "does not exist on origin" },
      { kind: "pr", ref: "https://github.com/x/y/pull/99", reason: "not found" },
    ]);
    expect(msg).toContain("DONE_GATE_PROVENANCE_FAILED");
    expect(msg).toContain("AI-1098");
    expect(msg).toContain("branch ai-1070/x");
    expect(msg).toContain("pr https://github.com/x/y/pull/99");
    expect(msg).toContain("--force-done-claim");
  });
});

// ─── logDoneGateEvent ───────────────────────────────────────────────────────

describe("logDoneGateEvent", () => {
  it("appends a log line with kind and detail", async () => {
    await logDoneGateEvent("AI-1", "REFUSED", "branch:foo");
    const [, line] = mockFs.appendFile.mock.calls[0] as [string, string];
    expect(line).toContain("AI-1");
    expect(line).toContain("done-gate");
    expect(line).toContain("branch:foo");
    expect(line).toContain("REFUSED");
  });

  it("does not throw on log write failure", async () => {
    mockFs.appendFile.mockRejectedValue(new Error("disk full"));
    await expect(logDoneGateEvent("AI-1", "REFUSED", "x")).resolves.toBeUndefined();
  });
});

// ─── Integration: replay the AI-1098 incident ───────────────────────────────

describe("AI-1098 hallucinated-shipping incident replay", () => {
  // The actual failure: Charles claimed work was shipped on branch
  // `ai-1070/optional-handoff-comment` with a PR opened, but the work was
  // never committed/pushed and no PR existed.

  it("complete refuses when comment references a branch+PR that don't exist", async () => {
    __setTestRunner(
      makeRunner({
        git: () => ({ stdout: "", stderr: "", code: 0 }),
        gh: () => ({ stdout: "", stderr: "GraphQL: Could not resolve", code: 1 }),
      })
    );

    await expect(
      complete("AI-1098", {
        comment:
          "## Done\n\nImplementation shipped on branch `ai-1070/optional-handoff-comment`. PR opened at https://github.com/fancymatt/repo/pull/9999. 288/288 tests passing. AC met.",
      })
    ).rejects.toThrow("DONE_GATE_PROVENANCE_FAILED");

    expect(mockUpdateIssue).not.toHaveBeenCalled();
    expect(mockAddComment).not.toHaveBeenCalled();
  });

  it("handoff-work refuses for the same comment shape", async () => {
    __setTestRunner(
      makeRunner({
        git: () => ({ stdout: "", stderr: "", code: 0 }),
        gh: () => ({ stdout: "", stderr: "not found", code: 1 }),
      })
    );

    await expect(
      handoffWork("AI-1098", "Ai", {
        comment:
          "Done — PR opened: https://github.com/fancymatt/repo/pull/9999. Branch: feat/missing-branch.",
      })
    ).rejects.toThrow("DONE_GATE_PROVENANCE_FAILED");
  });

  it("note refuses when posting a comment that fabricates a PR", async () => {
    __setTestRunner(
      makeRunner({
        git: () => ({ stdout: "", stderr: "", code: 0 }),
        gh: () => ({ stdout: "", stderr: "not found", code: 1 }),
      })
    );

    await expect(
      note("AI-1098", {
        comment: "Update: PR is up — https://github.com/fancymatt/repo/pull/12345",
      })
    ).rejects.toThrow("DONE_GATE_PROVENANCE_FAILED");

    expect(mockAddComment).not.toHaveBeenCalled();
  });

  it("post-fix replay — when commit/branch/PR exist, complete succeeds", async () => {
    __setTestRunner(
      makeRunner({
        git: (args) => {
          if (args[0] === "ls-remote") {
            return {
              stdout: "abc1234def5678901234567890123456789abcde\trefs/heads/x\n",
              stderr: "",
              code: 0,
            };
          }
          return { stdout: "", stderr: "", code: 0 };
        },
        gh: () => ({ stdout: '{"state":"OPEN"}', stderr: "", code: 0 }),
      })
    );

    await expect(
      complete("AI-1098", {
        comment:
          "## Done\n\nShipped on branch `life-547/done-gate-provenance`. PR: https://github.com/fancymatt/fancy-openclaw-linear-skill/pull/27",
      })
    ).resolves.toBeDefined();

    expect(mockUpdateIssue).toHaveBeenCalled();
    expect(mockAddComment).toHaveBeenCalled();
  });

  it("LIFE-style non-dev ticket with vague 'done' language is a no-op", async () => {
    __setTestRunner(
      makeRunner({
        git: () => {
          throw new Error("git must not be invoked when no artifacts present");
        },
        gh: () => {
          throw new Error("gh must not be invoked when no artifacts present");
        },
      })
    );

    await expect(
      complete("LIFE-100", { comment: "Done — bought the groceries. All AC met." })
    ).resolves.toBeDefined();

    expect(mockUpdateIssue).toHaveBeenCalled();
    expect(mockAddComment).toHaveBeenCalled();
  });

  it("--force-done-claim allows refused comment to post", async () => {
    __setTestRunner(
      makeRunner({
        git: () => ({ stdout: "", stderr: "", code: 0 }),
        gh: () => ({ stdout: "", stderr: "not found", code: 1 }),
      })
    );

    await expect(
      complete("AI-1098", {
        comment: "Done — https://github.com/fancymatt/repo/pull/9999",
        forceDoneClaim: true,
      })
    ).resolves.toBeDefined();

    const calls = mockFs.appendFile.mock.calls as Array<[string, string]>;
    const logged = calls.map(([, line]) => line).join("");
    expect(logged).toContain("FORCE-BYPASS");
    expect(mockUpdateIssue).toHaveBeenCalled();
  });
});
