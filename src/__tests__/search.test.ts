import { linearGraphQL } from "../client";
import { searchIssues } from "../search";

jest.mock("../client", () => ({
  ...jest.requireActual("../client"),
  linearGraphQL: jest.fn()
}));

const mockedGraphQL = linearGraphQL as jest.MockedFunction<typeof linearGraphQL>;

const mockSearchResult = (id: string) => ({
  id,
  identifier: id,
  title: `Search result ${id}`,
  state: { id: `s-${id}`, name: "Todo", type: "unstarted" },
  assignee: { id: "u-1", name: "Matt" },
  priority: 1,
  team: { id: "t-1", key: "AI", name: "AI Systems" }
});

describe("searchIssues", () => {
  beforeEach(() => mockedGraphQL.mockReset());

  it("returns matching issues", async () => {
    mockedGraphQL.mockResolvedValue({
      issues: {
        nodes: [mockSearchResult("AI-100"), mockSearchResult("AI-200")],
        pageInfo: { hasNextPage: false, endCursor: null }
      }
    });
    const results = await searchIssues("test query");
    expect(results).toHaveLength(2);
    expect(results[0].identifier).toBe("AI-100");
  });

  it("returns empty array when no results", async () => {
    mockedGraphQL.mockResolvedValue({
      issues: {
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null }
      }
    });
    const results = await searchIssues("nonexistent query");
    expect(results).toHaveLength(0);
  });

  it("passes teamId filter when provided", async () => {
    mockedGraphQL.mockResolvedValue({
      issues: {
        nodes: [mockSearchResult("AI-100")],
        pageInfo: { hasNextPage: false, endCursor: null }
      }
    });
    await searchIssues("test", "team-1");
    expect(mockedGraphQL).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ query: "test", first: 25, teamId: "team-1" })
    );
  });

  it("respects limit parameter", async () => {
    mockedGraphQL.mockResolvedValue({
      issues: {
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null }
      }
    });
    await searchIssues("test", undefined, 5);
    expect(mockedGraphQL).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ first: 5 })
    );
  });
});
