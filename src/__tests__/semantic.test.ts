import fs from "node:fs/promises";

import { getSelfUser } from "../auth";
import { addComment, findUserByName, getIssue, updateIssue } from "../issues";
import { findSemanticState } from "../states";
import {
  considerWork,
  refuseWork,
  beginWork,
  handoffWork,
  complete,
  needsHuman,
} from "../semantic";

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
  getIssue: jest.fn(),
  updateIssue: jest.fn(),
}));

jest.mock("../boards", () => ({
  getComments: jest.fn().mockResolvedValue([]),
}));

jest.mock("../states", () => ({
  ...jest.requireActual("../states"),
  findSemanticState: jest.fn(),
}));

const mockGetSelfUser = getSelfUser as jest.MockedFunction<typeof getSelfUser>;
const mockAddComment = addComment as jest.MockedFunction<typeof addComment>;
const mockFindUserByName = findUserByName as jest.MockedFunction<typeof findUserByName>;
const mockGetIssue = getIssue as jest.MockedFunction<typeof getIssue>;
const mockUpdateIssue = updateIssue as jest.MockedFunction<typeof updateIssue>;
const mockFindSemanticState = findSemanticState as jest.MockedFunction<typeof findSemanticState>;

const baseIssue: any = {
  id: "issue-1",
  identifier: "AI-100",
  title: "Test Issue",
  team: { id: "team-1", key: "AI", name: "AI Systems" },
  state: { id: "state-todo", name: "Todo", type: "unstarted" },
  assignee: { id: "user-matt", name: "Matt Henry" },
  delegate: null,
};

const thinkingState = { id: "state-thinking", name: "In Progress", type: "started" };
const doingState = { id: "state-doing", name: "In Progress", type: "started" };
const todoState = { id: "state-todo", name: "Todo", type: "unstarted" };
const doneState = { id: "state-done", name: "Done", type: "completed" };

beforeEach(() => {
  jest.resetAllMocks();
  mockGetIssue.mockResolvedValue(baseIssue);
  mockGetSelfUser.mockResolvedValue({ id: "user-igor", name: "Igor (Back End Dev)", email: "igor@test.com" });
  mockFindUserByName.mockImplementation(async (name: string) => {
    const users: Record<string, { id: string; name: string }> = {
      "Charles (CTO)": { id: "user-charles", name: "Charles (CTO)" },
      "Matt Henry": { id: "user-matt", name: "Matt Henry" },
      "Igor (Back End Dev)": { id: "user-igor", name: "Igor (Back End Dev)" },
    };
    const user = users[name];
    if (!user) throw new Error(`Could not uniquely resolve Linear user "${name}".`);
    return user;
  });
  mockFindSemanticState.mockImplementation(async (_teamId: string, semantic: string) => {
    const map: Record<string, any> = {
      thinking: thinkingState,
      doing: doingState,
      todo: todoState,
      done: doneState,
    };
    return map[semantic] ?? todoState;
  });
  mockAddComment.mockResolvedValue({ issueId: "issue-1", body: "test" });
  mockUpdateIssue.mockImplementation(async (id: string, input: any) => ({
    ...baseIssue,
    ...input,
  }));
});

describe("considerWork", () => {
  it("sets delegate=self, status=In Progress, assignee=null", async () => {
    const result = await considerWork("AI-100");
    expect(mockUpdateIssue).toHaveBeenCalledWith("AI-100", {
      stateId: "state-thinking",
      delegateId: "user-igor",
      assigneeId: null,
    });
    expect(result).toEqual({
      command: "considerWork",
      issueId: "AI-100",
      state: "In Progress",
      delegate: "Igor (Back End Dev)",
      assignee: null,
      commentPosted: false,
    });
  });

  it("does not post any comment", async () => {
    await considerWork("AI-100");
    expect(mockAddComment).not.toHaveBeenCalled();
  });

  it("throws when issue has no team", async () => {
    mockGetIssue.mockResolvedValue({ ...baseIssue, team: null });
    await expect(considerWork("AI-100")).rejects.toThrow("no team");
  });
});

describe("refuseWork", () => {
  it("sets status=Todo, delegate=specified user, posts comment", async () => {
    const result = await refuseWork("AI-100", "Charles (CTO)", { comment: "Not my area." });
    expect(mockAddComment).toHaveBeenCalledWith("AI-100", "Not my area.");
    expect(mockUpdateIssue).toHaveBeenCalledWith("AI-100", {
      stateId: "state-todo",
      delegateId: "user-charles",
    });
    expect(result.delegate).toBe("Charles (CTO)");
    expect(result.state).toBe("Todo");
    expect(result.commentPosted).toBe(true);
  });

  it("reads comment from file", async () => {
    jest.spyOn(fs, "readFile").mockResolvedValueOnce("File refusal reason");
    const result = await refuseWork("AI-100", "Charles (CTO)", { commentFile: "/path/to/file.md" });
    expect(mockAddComment).toHaveBeenCalledWith("AI-100", "File refusal reason");
    expect(result.commentPosted).toBe(true);
  });

  it("throws when comment is missing", async () => {
    await expect(refuseWork("AI-100", "Charles (CTO)", {})).rejects.toThrow("non-empty comment");
  });

  it("throws when comment is whitespace-only", async () => {
    await expect(refuseWork("AI-100", "Charles (CTO)", { comment: "   " })).rejects.toThrow("non-empty comment");
  });
});

describe("beginWork", () => {
  it("sets status to In Progress when not already there", async () => {
    mockGetIssue.mockResolvedValue({ ...baseIssue, state: { name: "Todo", type: "unstarted" } });
    const result = await beginWork("AI-100");
    expect(mockUpdateIssue).toHaveBeenCalledWith("AI-100", { stateId: "state-doing" });
    expect(result.state).toBe("In Progress");
  });

  it("is idempotent — no state update when already In Progress", async () => {
    mockGetIssue.mockResolvedValue({
      ...baseIssue,
      state: { id: "state-doing", name: "In Progress", type: "started" },
    });
    const result = await beginWork("AI-100");
    expect(mockUpdateIssue).not.toHaveBeenCalled();
    expect(result.state).toBe("In Progress");
  });

  it("does not post any comment", async () => {
    await beginWork("AI-100");
    expect(mockAddComment).not.toHaveBeenCalled();
  });

  it("preserves existing delegate and assignee", async () => {
    mockGetIssue.mockResolvedValue({
      ...baseIssue,
      state: { name: "Todo", type: "unstarted" },
      delegate: { id: "user-igor", name: "Igor" },
      assignee: null,
    });
    const result = await beginWork("AI-100");
    expect(result.delegate).toBe("Igor");
    expect(result.assignee).toBeNull();
  });
});

describe("handoffWork", () => {
  it("sets status=Todo, delegate=agent, clears assignee, posts comment", async () => {
    const result = await handoffWork("AI-100", "Charles (CTO)", { comment: "Your turn." });
    expect(mockAddComment).toHaveBeenCalledWith("AI-100", "Your turn.");
    expect(mockUpdateIssue).toHaveBeenCalledWith("AI-100", {
      stateId: "state-todo",
      delegateId: "user-charles",
      assigneeId: null,
    });
    expect(result).toEqual({
      command: "handoffWork",
      issueId: "AI-100",
      state: "Todo",
      delegate: "Charles (CTO)",
      assignee: null,
      commentPosted: true,
    });
  });

  it("throws when comment is missing", async () => {
    await expect(handoffWork("AI-100", "Charles (CTO)", {})).rejects.toThrow("non-empty comment");
  });

  it("is idempotent — safe to call multiple times", async () => {
    // First call
    await handoffWork("AI-100", "Charles (CTO)", { comment: "Handing off." });
    // Second call with same params — should succeed without error
    await handoffWork("AI-100", "Charles (CTO)", { comment: "Re-confirming handoff." });
    expect(mockAddComment).toHaveBeenCalledTimes(2);
    expect(mockUpdateIssue).toHaveBeenCalledTimes(2);
  });
});

describe("complete", () => {
  it("sets status=Done, clears delegate and assignee", async () => {
    const result = await complete("AI-100", { comment: "All done!" });
    expect(mockAddComment).toHaveBeenCalledWith("AI-100", "All done!");
    expect(mockUpdateIssue).toHaveBeenCalledWith("AI-100", {
      stateId: "state-done",
      delegateId: null,
      assigneeId: null,
    });
    expect(result.state).toBe("Done");
    expect(result.delegate).toBeNull();
    expect(result.assignee).toBeNull();
  });

  it("works without a comment", async () => {
    const result = await complete("AI-100");
    expect(mockAddComment).not.toHaveBeenCalled();
    expect(result.commentPosted).toBe(false);
  });
});

describe("needsHuman", () => {
  it("sets status=Todo, clears delegate, sets assignee=human, posts comment", async () => {
    const result = await needsHuman("AI-100", "Matt Henry", { comment: "Need your input." });
    expect(mockAddComment).toHaveBeenCalledWith("AI-100", "Need your input.");
    expect(mockUpdateIssue).toHaveBeenCalledWith("AI-100", {
      stateId: "state-todo",
      delegateId: null,
      assigneeId: "user-matt",
    });
    expect(result).toEqual({
      command: "needsHuman",
      issueId: "AI-100",
      state: "Todo",
      delegate: null,
      assignee: "Matt Henry",
      commentPosted: true,
    });
  });

  it("throws when comment is missing", async () => {
    await expect(needsHuman("AI-100", "Matt Henry", {})).rejects.toThrow("non-empty comment");
  });

  it("is idempotent — safe to call multiple times", async () => {
    await needsHuman("AI-100", "Matt Henry", { comment: "First ping." });
    await needsHuman("AI-100", "Matt Henry", { comment: "Second ping." });
    expect(mockAddComment).toHaveBeenCalledTimes(2);
    expect(mockUpdateIssue).toHaveBeenCalledTimes(2);
  });
});
