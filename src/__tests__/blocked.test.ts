import { linearGraphQL } from "../client";
import { getMyBlocked } from "../blocked";

jest.mock("../client", () => ({
  ...jest.requireActual("../client"),
  linearGraphQL: jest.fn()
}));

const mockedGraphQL = linearGraphQL as jest.MockedFunction<typeof linearGraphQL>;

const mockBlockedIssue = (id: string) => ({
  id,
  identifier: id,
  title: `Blocked issue ${id}`,
  updatedAt: "2026-01-01T00:00:00Z",
  priority: 2,
  state: { id: `s-${id}`, name: "Blocked", type: "started" },
  assignee: { id: "u-1", name: "Matt", email: "m@example.com" },
  team: { id: "t-1", key: "AI", name: "AI Systems" },
  labels: [],
  relations: [],
  comments: [],
  children: []
});

describe("getMyBlocked", () => {
  beforeEach(() => mockedGraphQL.mockReset());

  it("returns blocked issues", async () => {
    mockedGraphQL.mockResolvedValue({
      viewer: {
        assignedIssues: {
          nodes: [mockBlockedIssue("AI-100"), mockBlockedIssue("AI-200")]
        }
      }
    });
    const results = await getMyBlocked();
    expect(results).toHaveLength(2);
    expect(results[0].state?.name).toBe("Blocked");
  });

  it("returns empty array when no blocked issues", async () => {
    mockedGraphQL.mockResolvedValue({
      viewer: {
        assignedIssues: {
          nodes: []
        }
      }
    });
    const results = await getMyBlocked();
    expect(results).toHaveLength(0);
  });

  it("respects limit parameter", async () => {
    mockedGraphQL.mockResolvedValue({
      viewer: {
        assignedIssues: { nodes: [mockBlockedIssue("AI-100")] }
      }
    });
    await getMyBlocked(10);
    expect(mockedGraphQL).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ first: 10 })
    );
  });
});
