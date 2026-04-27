import { linearGraphQL } from "../client";
import { getIssue, updateIssue } from "../issues";
import { listRelations, createBlockingRelation, removeBlockingRelation, setParent, removeParent } from "../relations";

jest.mock("../client", () => ({
  ...jest.requireActual("../client"),
  linearGraphQL: jest.fn()
}));

jest.mock("../issues", () => ({
  getIssue: jest.fn(),
  updateIssue: jest.fn()
}));

const mockedGraphQL = linearGraphQL as jest.MockedFunction<typeof linearGraphQL>;
const mockGetIssue = getIssue as jest.MockedFunction<typeof getIssue>;
const mockUpdateIssue = updateIssue as jest.MockedFunction<typeof updateIssue>;

describe("listRelations", () => {
  beforeEach(() => mockGetIssue.mockReset());

  it("returns relations from issue", async () => {
    const relations = [
      { id: "rel-1", type: "blocks", issue: { id: "i-1", identifier: "AI-100", title: "A" }, relatedIssue: { id: "i-2", identifier: "AI-200", title: "B" } }
    ];
    mockGetIssue.mockResolvedValue({ relations } as any);
    const result = await listRelations("AI-100");
    expect(result).toHaveLength(1);
  });

  it("returns empty array when no relations", async () => {
    mockGetIssue.mockResolvedValue({ relations: [] } as any);
    const result = await listRelations("AI-100");
    expect(result).toEqual([]);
  });
});

describe("createBlockingRelation", () => {
  beforeEach(() => {
    mockedGraphQL.mockReset();
    mockGetIssue.mockReset();
    mockGetIssue.mockImplementation(async (id: string) => ({
      id: id === "AI-100" ? "uuid-100" : "uuid-200",
      identifier: id,
      title: id,
      relations: []
    } as any));
    mockedGraphQL.mockResolvedValue({ issueRelationCreate: { success: true } });
  });

  it("creates blocked-by relation", async () => {
    const result = await createBlockingRelation("AI-100", "AI-200", "blocked-by", false);
    expect(result.mode).toBe("blocked-by");
    expect(result.issueId).toBe("AI-100");
    expect(result.relatedIssueId).toBe("AI-200");
    // blocked-by: relatedIssue (200) blocks issue (100)
    // So prerequisite = relatedIssue (uuid-200), dependent = issue (uuid-100)
    expect(mockedGraphQL).toHaveBeenCalledWith(
      expect.stringContaining("issueRelationCreate"),
      { issueId: "uuid-200", relatedIssueId: "uuid-100" }
    );
  });

  it("creates blocks relation", async () => {
    await createBlockingRelation("AI-100", "AI-200", "blocks", false);
    // blocks: issue (100) blocks relatedIssue (200)
    expect(mockedGraphQL).toHaveBeenCalledWith(
      expect.stringContaining("issueRelationCreate"),
      { issueId: "uuid-100", relatedIssueId: "uuid-200" }
    );
  });

  it("throws when mutation fails", async () => {
    mockedGraphQL.mockResolvedValue({ issueRelationCreate: { success: false } });
    await expect(createBlockingRelation("AI-100", "AI-200", "blocked-by", false)).rejects.toThrow("Failed to create relation");
  });
});

describe("removeBlockingRelation", () => {
  beforeEach(() => {
    mockedGraphQL.mockReset();
    mockGetIssue.mockReset();
  });

  it("finds and removes relation", async () => {
    mockGetIssue.mockResolvedValue({
      relations: [
        { id: "rel-1", type: "blocks", issue: { id: "i-1", identifier: "AI-100", title: "A" }, relatedIssue: { id: "i-2", identifier: "AI-200", title: "B" } }
      ]
    } as any);
    mockedGraphQL.mockResolvedValue({ issueRelationDelete: { success: true } });

    const result = await removeBlockingRelation("AI-100", "AI-200");
    expect(result.removed).toBe(true);
    expect(mockedGraphQL).toHaveBeenCalledWith(
      expect.stringContaining("issueRelationDelete"),
      { id: "rel-1" }
    );
  });

  it("throws when no relation found", async () => {
    mockGetIssue.mockResolvedValue({ relations: [] } as any);
    await expect(removeBlockingRelation("AI-100", "AI-200")).rejects.toThrow("No relation found");
  });

  it("throws when delete mutation fails", async () => {
    mockGetIssue.mockResolvedValue({
      relations: [
        { id: "rel-1", type: "blocks", issue: { id: "i-1", identifier: "AI-100", title: "A" }, relatedIssue: { id: "i-2", identifier: "AI-200", title: "B" } }
      ]
    } as any);
    mockedGraphQL.mockResolvedValue({ issueRelationDelete: { success: false } });
    await expect(removeBlockingRelation("AI-100", "AI-200")).rejects.toThrow("Failed to delete relation");
  });
});

describe("setParent", () => {
  beforeEach(() => {
    mockGetIssue.mockReset();
    mockUpdateIssue.mockReset();
  });

  it("sets parent on an issue", async () => {
    mockGetIssue.mockImplementation(async (id: string) => ({
      id: id === "AI-100" ? "uuid-100" : "uuid-200",
      identifier: id,
      title: id
    } as any));
    mockUpdateIssue.mockResolvedValue({ id: "uuid-100" } as any);

    const result = await setParent("AI-100", "AI-200");
    expect(result.issueId).toBe("AI-100");
    expect(result.parentId).toBe("AI-200");
    expect(mockUpdateIssue).toHaveBeenCalledWith("uuid-100", { parentId: "uuid-200" });
  });

  it("throws when setting self as parent", async () => {
    mockGetIssue.mockResolvedValue({ id: "uuid-100", identifier: "AI-100", title: "A" } as any);
    await expect(setParent("AI-100", "AI-100")).rejects.toThrow("cannot be its own parent");
  });
});

describe("removeParent", () => {
  beforeEach(() => {
    mockGetIssue.mockReset();
    mockUpdateIssue.mockReset();
  });

  it("removes parent from an issue", async () => {
    mockGetIssue.mockResolvedValue({
      id: "uuid-100",
      identifier: "AI-100",
      title: "A",
      parent: { id: "uuid-200", identifier: "AI-200", title: "B" }
    } as any);
    mockUpdateIssue.mockResolvedValue({ id: "uuid-100" } as any);

    const result = await removeParent("AI-100");
    expect(result.issueId).toBe("AI-100");
    expect(result.removed).toBe(true);
    expect(mockUpdateIssue).toHaveBeenCalledWith("uuid-100", { parentId: null });
  });

  it("throws when issue has no parent", async () => {
    mockGetIssue.mockResolvedValue({ id: "uuid-100", identifier: "AI-100", title: "A", parent: null } as any);
    await expect(removeParent("AI-100")).rejects.toThrow("has no parent");
  });
});
