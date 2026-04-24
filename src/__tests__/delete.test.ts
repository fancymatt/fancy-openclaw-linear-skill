import { linearGraphQL } from "../client";
import { deleteIssue, deleteComment } from "../delete";

jest.mock("../client", () => ({
  ...jest.requireActual("../client"),
  linearGraphQL: jest.fn()
}));

const mockedGraphQL = linearGraphQL as jest.MockedFunction<typeof linearGraphQL>;

describe("deleteIssue", () => {
  beforeEach(() => mockedGraphQL.mockReset());

  it("deletes an issue successfully", async () => {
    mockedGraphQL.mockResolvedValue({ issueDelete: { success: true } });
    const result = await deleteIssue("issue-1");
    expect(result).toEqual({ success: true, id: "issue-1" });
    expect(mockedGraphQL).toHaveBeenCalledWith(
      expect.stringContaining("issueDelete"),
      { id: "issue-1" }
    );
  });

  it("throws on not-found error from API", async () => {
    mockedGraphQL.mockRejectedValue(new Error("Issue not found"));
    await expect(deleteIssue("nonexistent")).rejects.toThrow("Issue not found");
  });
});

describe("deleteComment", () => {
  beforeEach(() => mockedGraphQL.mockReset());

  it("deletes a comment successfully", async () => {
    mockedGraphQL.mockResolvedValue({ commentDelete: { success: true } });
    const result = await deleteComment("comment-1");
    expect(result).toEqual({ success: true, id: "comment-1" });
    expect(mockedGraphQL).toHaveBeenCalledWith(
      expect.stringContaining("commentDelete"),
      { id: "comment-1" }
    );
  });

  it("throws on not-found error from API", async () => {
    mockedGraphQL.mockRejectedValue(new Error("Comment not found"));
    await expect(deleteComment("nonexistent")).rejects.toThrow("Comment not found");
  });
});
