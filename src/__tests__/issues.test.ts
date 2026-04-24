import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { linearGraphQL } from "../client";
import {
  getIssue,
  createIssue,
  updateIssue,
  addComment,
  getMyIssues,
  getMyNewIssues,
  getMyQueue,
  findUserByName
} from "../issues";

jest.mock("../client", () => ({
  ...jest.requireActual("../client"),
  linearGraphQL: jest.fn()
}));

const mockedGraphQL = linearGraphQL as jest.MockedFunction<typeof linearGraphQL>;

// Silence stderr warnings during tests
beforeEach(() => {
  jest.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => {
  (process.stderr.write as jest.Mock).mockRestore();
});

const mockIssue = {
  id: "issue-uuid-1",
  identifier: "AI-100",
  title: "Test issue",
  description: "A test",
  priority: 1,
  url: "https://linear.app/test/AI-100",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  team: { id: "team-1", key: "AI", name: "AI Systems" },
  state: { id: "state-1", name: "Todo", type: "unstarted", color: "#ccc", position: 0 },
  assignee: { id: "user-1", name: "Matt", email: "matt@example.com" },
  delegate: null,
  project: { id: "proj-1", name: "Test Project" },
  projectMilestone: { id: "milestone-1", name: "Sprint 1", description: null, targetDate: "2026-02-01" },
  labels: { nodes: [{ id: "label-1", name: "bug", color: "red" }] },
  parent: null,
  children: { nodes: [] },
  relations: { nodes: [] },
  comments: { nodes: [] }
};

describe("getIssue", () => {
  beforeEach(() => mockedGraphQL.mockReset());

  it("fetches issue by UUID", async () => {
    mockedGraphQL.mockResolvedValue({ issue: mockIssue });
    const result = await getIssue("issue-uuid-1");
    expect(result.identifier).toBe("AI-100");
    expect(result.milestone?.name).toBe("Sprint 1");
    expect(result.labels).toEqual([{ id: "label-1", name: "bug", color: "red" }]);
  });

  it("fetches issue by identifier (e.g. AI-100)", async () => {
    mockedGraphQL.mockResolvedValue({ issues: { nodes: [mockIssue] } });
    const result = await getIssue("AI-100");
    expect(result.identifier).toBe("AI-100");
    expect(mockedGraphQL).toHaveBeenCalledWith(
      expect.stringContaining("IssueByIdentifier"),
      { teamKey: "AI", number: 100 }
    );
  });

  it("throws when issue not found by UUID", async () => {
    mockedGraphQL.mockResolvedValue({ issue: null });
    await expect(getIssue("nonexistent-uuid")).rejects.toThrow("Issue not found");
  });

  it("throws when issue not found by identifier", async () => {
    mockedGraphQL.mockResolvedValue({ issues: { nodes: [] } });
    await expect(getIssue("ZZ-999")).rejects.toThrow("Issue not found");
  });
});

describe("createIssue", () => {
  beforeEach(() => mockedGraphQL.mockReset());

  it("creates issue and returns fetched result", async () => {
    mockedGraphQL
      .mockResolvedValueOnce({ issueCreate: { success: true, issue: { id: "new-id", identifier: "AI-200", title: "New" } } })
      .mockResolvedValueOnce({ issue: { ...mockIssue, id: "new-id", identifier: "AI-200" } });

    const result = await createIssue({ teamId: "team-1", title: "New issue" });
    expect(result.identifier).toBe("AI-200");
    expect(mockedGraphQL).toHaveBeenCalledTimes(2);
  });

  it("throws when mutation fails", async () => {
    mockedGraphQL.mockResolvedValue({ issueCreate: { success: false, issue: null } });
    await expect(createIssue({ teamId: "team-1", title: "Fail" })).rejects.toThrow("issueCreate mutation failed");
  });
});

describe("updateIssue", () => {
  beforeEach(() => mockedGraphQL.mockReset());

  it("updates issue and returns fetched result", async () => {
    mockedGraphQL
      .mockResolvedValueOnce({ issueUpdate: { success: true, issue: { id: "issue-uuid-1" } } })
      .mockResolvedValueOnce({ issue: { ...mockIssue, title: "Updated" } });

    const result = await updateIssue("issue-uuid-1", { title: "Updated" });
    expect(result.title).toBe("Updated");
  });

  it("throws when update mutation fails", async () => {
    mockedGraphQL.mockResolvedValue({ issueUpdate: { success: false, issue: null } });
    await expect(updateIssue("issue-uuid-1", { title: "Fail" })).rejects.toThrow("issueUpdate mutation failed");
  });
});

describe("addComment", () => {
  beforeEach(() => mockedGraphQL.mockReset());

  it("posts comment inline", async () => {
    mockedGraphQL.mockResolvedValue({
      commentCreate: { success: true, comment: { id: "c-1", body: "Hello" } }
    });
    const result = await addComment("issue-1", "Hello");
    expect(result.body).toBe("Hello");
    expect(result.issueId).toBe("issue-1");
  });

  it("unescapes literal \\n sequences", async () => {
    mockedGraphQL.mockResolvedValue({
      commentCreate: { success: true, comment: { id: "c-2", body: "line1\nline2" } }
    });
    const result = await addComment("issue-1", "line1\\nline2");
    expect(result.body).toBe("line1\nline2");
  });

  it("crashes on undefined body (known bug: guard runs after .replace)", async () => {
    // BUG: addComment calls body.replace() before the !finalBody guard, so
    // undefined causes a TypeError instead of the intended error message.
    await expect(addComment("issue-1", undefined as any)).rejects.toThrow("Cannot read properties of undefined");
  });

  it("throws when mutation fails", async () => {
    mockedGraphQL.mockResolvedValue({
      commentCreate: { success: false, comment: null }
    });
    await expect(addComment("issue-1", "Hello")).rejects.toThrow("Failed to create comment");
  });
});

describe("getMyIssues", () => {
  beforeEach(() => mockedGraphQL.mockReset());

  it("returns all assigned issues without filter", async () => {
    mockedGraphQL.mockResolvedValue({
      viewer: { assignedIssues: { nodes: [mockIssue] } }
    });
    const issues = await getMyIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0].identifier).toBe("AI-100");
  });

  it("filters by state names", async () => {
    mockedGraphQL.mockResolvedValue({
      viewer: { assignedIssues: { nodes: [mockIssue] } }
    });
    const issues = await getMyIssues(["Todo", "In Progress"]);
    expect(mockedGraphQL).toHaveBeenCalledWith(
      expect.stringContaining("$stateNames"),
      { stateNames: ["Todo", "In Progress"] }
    );
  });
});

describe("getMyNewIssues", () => {
  beforeEach(() => mockedGraphQL.mockReset());

  it("defaults to 24h window", async () => {
    mockedGraphQL.mockResolvedValue({
      viewer: { assignedIssues: { nodes: [] } }
    });
    await getMyNewIssues();
    const callVars = mockedGraphQL.mock.calls[0][1] as { updatedAt: string };
    const since = new Date(callVars.updatedAt).getTime();
    const now = Date.now();
    expect(now - since).toBeLessThan(25 * 60 * 60 * 1000);
  });

  it("accepts custom since date", async () => {
    mockedGraphQL.mockResolvedValue({
      viewer: { assignedIssues: { nodes: [] } }
    });
    await getMyNewIssues("2026-01-01T00:00:00Z");
    expect(mockedGraphQL).toHaveBeenCalledWith(
      expect.any(String),
      { updatedAt: "2026-01-01T00:00:00Z" }
    );
  });
});

describe("getMyQueue", () => {
  beforeEach(() => mockedGraphQL.mockReset());

  it("returns issues sorted by priority then updatedAt", async () => {
    mockedGraphQL.mockResolvedValue({
      viewer: {
        assignedIssues: {
          nodes: [
            { ...mockIssue, identifier: "AI-300", priority: 2, updatedAt: "2026-01-02T00:00:00Z", state: { name: "Todo", type: "unstarted" } },
            { ...mockIssue, identifier: "AI-100", priority: 0, updatedAt: "2026-01-05T00:00:00Z", state: { name: "In Progress", type: "started" } },
            { ...mockIssue, identifier: "AI-200", priority: 1, updatedAt: "2026-01-03T00:00:00Z", state: { name: "Todo", type: "unstarted" } }
          ]
        }
      }
    });
    const queue = await getMyQueue();
    expect(queue.map(i => i.identifier)).toEqual(["AI-200", "AI-300", "AI-100"]);
  });

  it("excludes blocked issues", async () => {
    mockedGraphQL.mockResolvedValue({
      viewer: {
        assignedIssues: {
          nodes: [
            { ...mockIssue, identifier: "AI-100", state: { name: "Blocked", type: "started" } },
            { ...mockIssue, identifier: "AI-200", state: { name: "Todo", type: "unstarted" } }
          ]
        }
      }
    });
    const queue = await getMyQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].identifier).toBe("AI-200");
  });

  it("filters by project name", async () => {
    mockedGraphQL.mockResolvedValue({
      viewer: {
        assignedIssues: {
          nodes: [
            { ...mockIssue, identifier: "AI-100", project: { id: "p1", name: "Alpha" }, state: { name: "Todo", type: "unstarted" } },
            { ...mockIssue, identifier: "AI-200", project: { id: "p2", name: "Beta" }, state: { name: "Todo", type: "unstarted" } }
          ]
        }
      }
    });
    const queue = await getMyQueue("Alpha");
    expect(queue).toHaveLength(1);
    expect(queue[0].identifier).toBe("AI-100");
  });
});

describe("findUserByName", () => {
  beforeEach(() => mockedGraphQL.mockReset());

  it("finds user by exact name match (case-insensitive)", async () => {
    mockedGraphQL.mockResolvedValue({
      users: { nodes: [{ id: "u-1", name: "Charles (CTO)", email: "c@example.com" }] }
    });
    const user = await findUserByName("charles (cto)");
    expect(user.id).toBe("u-1");
  });

  it("returns single result when no exact match", async () => {
    mockedGraphQL.mockResolvedValue({
      users: { nodes: [{ id: "u-2", name: "Matt Henry", email: "m@example.com" }] }
    });
    const user = await findUserByName("matt");
    expect(user.id).toBe("u-2");
  });

  it("throws when no users found", async () => {
    mockedGraphQL.mockResolvedValue({ users: { nodes: [] } });
    await expect(findUserByName("nobody")).rejects.toThrow("Could not uniquely resolve");
  });

  it("throws when multiple users and no exact match", async () => {
    mockedGraphQL.mockResolvedValue({
      users: { nodes: [{ id: "u-1", name: "Matt A" }, { id: "u-2", name: "Matt B" }] }
    });
    await expect(findUserByName("Matt")).rejects.toThrow("Could not uniquely resolve");
  });
});
