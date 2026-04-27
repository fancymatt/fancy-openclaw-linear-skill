import { linearGraphQL } from "../client";
import { verifyComment } from "../issues";

jest.mock("../client", () => ({
  ...jest.requireActual("../client"),
  linearGraphQL: jest.fn()
}));

const mockedGraphQL = linearGraphQL as jest.MockedFunction<typeof linearGraphQL>;

beforeEach(() => {
  mockedGraphQL.mockReset();
  jest.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => {
  (process.stderr.write as jest.Mock).mockRestore();
});

describe("verifyComment", () => {
  it("returns comment details when found", async () => {
    mockedGraphQL.mockResolvedValue({
      comment: {
        id: "c-1",
        body: "Hello world",
        createdAt: "2026-04-26T12:00:00Z",
        url: "https://linear.app/test/issue/AI-100#comment-c-1",
        issue: { identifier: "AI-100" }
      }
    });

    const result = await verifyComment("c-1");
    expect(result).toEqual({
      commentId: "c-1",
      exists: true,
      body: "Hello world",
      createdAt: "2026-04-26T12:00:00Z",
      issueIdentifier: "AI-100",
      url: "https://linear.app/test/issue/AI-100#comment-c-1"
    });
  });

  it("returns exists: false when comment not found", async () => {
    mockedGraphQL.mockResolvedValue({ comment: null });

    const result = await verifyComment("nonexistent-id");
    expect(result).toEqual({ commentId: "nonexistent-id", exists: false });
  });

  it("uses comment(id:) node query, not issue.comments connection", async () => {
    mockedGraphQL.mockResolvedValue({ comment: null });
    await verifyComment("c-1");
    const query = mockedGraphQL.mock.calls[0][0] as string;
    expect(query).toContain("comment(id:");
    expect(query).not.toContain("issue { comments");
  });
});
