import { linearGraphQL } from "../client";
import { listLabels, addLabels, removeLabels } from "../labels";
import { getIssue } from "../issues";

jest.mock("../client", () => ({
  ...jest.requireActual("../client"),
  linearGraphQL: jest.fn()
}));

jest.mock("../issues", () => ({
  getIssue: jest.fn()
}));

jest.mock("../teams", () => ({
  resolveTeamId: jest.fn().mockResolvedValue("team-1")
}));

const mockedGraphQL = linearGraphQL as jest.MockedFunction<typeof linearGraphQL>;
const mockedGetIssue = getIssue as jest.MockedFunction<typeof getIssue>;

const mockIssue = (id: string, labels: Array<{ id: string; name: string }> = []) => ({
  id: `uuid-${id}`,
  identifier: id,
  title: `Issue ${id}`,
  state: { id: "s-1", name: "Todo", type: "unstarted" },
  team: { id: "team-1", key: "AI", name: "AI Systems" },
  labels
}) as any;

const mockTeamLabels = [
  { id: "lbl-1", name: "bug", color: "#ff0000" },
  { id: "lbl-2", name: "feature", color: "#00ff00" },
  { id: "lbl-3", name: "infra", color: "#0000ff" }
];

describe("listLabels", () => {
  beforeEach(() => mockedGraphQL.mockReset());

  it("lists labels for a specified team", async () => {
    mockedGraphQL.mockResolvedValue({
      team: { labels: { nodes: mockTeamLabels } }
    });
    const labels = await listLabels("team-1");
    expect(labels).toHaveLength(3);
    expect(labels[0].name).toBe("bug");
  });

  it("lists labels for default team when no team specified", async () => {
    mockedGraphQL.mockResolvedValue({
      teams: { nodes: [{ id: "team-1", labels: { nodes: mockTeamLabels } }] }
    });
    const labels = await listLabels();
    expect(labels).toHaveLength(3);
  });

  it("returns empty array for team with no labels", async () => {
    mockedGraphQL.mockResolvedValue({
      team: { labels: { nodes: [] } }
    });
    const labels = await listLabels("team-1");
    expect(labels).toHaveLength(0);
  });
});

describe("addLabels", () => {
  beforeEach(() => {
    mockedGraphQL.mockReset();
    mockedGetIssue.mockReset();
  });

  it("adds a single label to an issue", async () => {
    mockedGetIssue.mockResolvedValue(mockIssue("AI-100", []));
    mockedGraphQL
      .mockResolvedValueOnce({ team: { labels: { nodes: mockTeamLabels } } })
      .mockResolvedValueOnce({
        issueUpdate: {
          success: true,
          issue: {
            id: "uuid-AI-100",
            labels: { nodes: [{ id: "lbl-1", name: "bug" }] }
          }
        }
      });

    const result = await addLabels("AI-100", ["bug"]);
    expect(mockedGetIssue).toHaveBeenCalledWith("AI-100");
    expect(result).toBeDefined();
    expect(mockedGraphQL).toHaveBeenLastCalledWith(
      expect.stringContaining("issueUpdate"),
      expect.objectContaining({ id: "uuid-AI-100", addedLabelIds: ["lbl-1"] })
    );
  });

  it("adds multiple labels without fetching existing ones", async () => {
    mockedGetIssue.mockResolvedValue(mockIssue("AI-100", [{ id: "lbl-1", name: "bug" }]));
    mockedGraphQL
      .mockResolvedValueOnce({ team: { labels: { nodes: mockTeamLabels } } })
      .mockResolvedValueOnce({
        issueUpdate: {
          success: true,
          issue: {
            id: "uuid-AI-100",
            labels: {
              nodes: [
                { id: "lbl-1", name: "bug" },
                { id: "lbl-2", name: "feature" },
                { id: "lbl-3", name: "infra" }
              ]
            }
          }
        }
      });

    await addLabels("AI-100", ["feature", "infra"]);
    expect(mockedGraphQL).toHaveBeenLastCalledWith(
      expect.stringContaining("issueUpdate"),
      expect.objectContaining({ id: "uuid-AI-100", addedLabelIds: ["lbl-2", "lbl-3"] })
    );
  });

  it("throws when label not found", async () => {
    mockedGetIssue.mockResolvedValue(mockIssue("AI-100", []));
    mockedGraphQL.mockResolvedValue({
      team: { labels: { nodes: mockTeamLabels } }
    });

    await expect(addLabels("AI-100", ["nonexistent"])).rejects.toThrow("Label(s) not found: nonexistent");
    expect(mockedGraphQL).toHaveBeenCalledWith(
      expect.stringContaining("ResolveLabels"),
      expect.objectContaining({ teamId: "team-1" })
    );
  });

  it("is case-insensitive when matching label names", async () => {
    mockedGetIssue.mockResolvedValue(mockIssue("AI-100", []));
    mockedGraphQL
      .mockResolvedValueOnce({ team: { labels: { nodes: mockTeamLabels } } })
      .mockResolvedValueOnce({
        issueUpdate: {
          success: true,
          issue: { id: "uuid-AI-100", labels: { nodes: [{ id: "lbl-1", name: "bug" }] } }
        }
      });

    await addLabels("AI-100", ["BUG"]);
    expect(mockedGraphQL).toHaveBeenCalledWith(
      expect.stringContaining("issueUpdate"),
      expect.objectContaining({ addedLabelIds: ["lbl-1"] })
    );
  });
});

describe("removeLabels", () => {
  beforeEach(() => {
    mockedGraphQL.mockReset();
    mockedGetIssue.mockReset();
  });

  it("removes a label from an issue", async () => {
    mockedGetIssue.mockResolvedValue(mockIssue("AI-100", [{ id: "lbl-1", name: "bug" }]));
    mockedGraphQL
      .mockResolvedValueOnce({ team: { labels: { nodes: mockTeamLabels } } })
      .mockResolvedValueOnce({
        issueUpdate: {
          success: true,
          issue: { id: "uuid-AI-100", labels: { nodes: [] } }
        }
      });

    const result = await removeLabels("AI-100", ["bug"]);
    expect(result).toBeDefined();
    expect(mockedGraphQL).toHaveBeenCalledWith(
      expect.stringContaining("issueUpdate"),
      expect.objectContaining({ id: "uuid-AI-100", removedLabelIds: ["lbl-1"] })
    );
  });

  it("throws when label not found in team", async () => {
    mockedGetIssue.mockResolvedValue(mockIssue("AI-100", [{ id: "lbl-1", name: "bug" }]));
    mockedGraphQL.mockResolvedValue({
      team: { labels: { nodes: mockTeamLabels } }
    });

    await expect(removeLabels("AI-100", ["nonexistent"])).rejects.toThrow("Label(s) not found: nonexistent");
    expect(mockedGraphQL).toHaveBeenCalledWith(
      expect.stringContaining("ResolveLabels"),
      expect.objectContaining({ teamId: "team-1" })
    );
  });
});
