import { linearGraphQL } from "../client";
import { resolveUserRef, resolveUserWithHints } from "../issues";

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

describe("resolveUserRef", () => {
  beforeEach(() => mockedGraphQL.mockReset());

  it("passes through a UUID directly without calling API", async () => {
    const uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const result = await resolveUserRef(uuid);
    expect(result).toBe(uuid);
    expect(mockedGraphQL).not.toHaveBeenCalled();
  });

  it("passes through a UUID (uppercase prefix variant)", async () => {
    const uuid = "A1B2C3D4-E5F6-7890-ABCD-EF1234567890";
    const result = await resolveUserRef(uuid);
    expect(result).toBe(uuid);
    expect(mockedGraphQL).not.toHaveBeenCalled();
  });

  it("resolves a name to user ID via findUserByName", async () => {
    mockedGraphQL.mockResolvedValue({
      users: { nodes: [{ id: "u-1", name: "Charles (CTO)", email: "c@example.com" }] }
    });
    const result = await resolveUserRef("Charles (CTO)");
    expect(result).toBe("u-1");
    expect(mockedGraphQL).toHaveBeenCalledTimes(1);
  });

  it("resolves a partial name to user ID", async () => {
    mockedGraphQL.mockResolvedValue({
      users: { nodes: [{ id: "u-2", name: "Matt Henry", email: "m@example.com" }] }
    });
    const result = await resolveUserRef("matt");
    expect(result).toBe("u-2");
  });

  it("throws when name is not found", async () => {
    mockedGraphQL.mockResolvedValue({ users: { nodes: [] } });
    await expect(resolveUserRef("nobody")).rejects.toThrow("Could not uniquely resolve");
  });

  it("throws when name matches multiple users", async () => {
    mockedGraphQL.mockResolvedValue({
      users: { nodes: [{ id: "u-1", name: "Matt A" }, { id: "u-2", name: "Matt B" }] }
    });
    await expect(resolveUserRef("Matt")).rejects.toThrow("Could not uniquely resolve");
  });

  it("does not treat a short string as UUID", async () => {
    mockedGraphQL.mockResolvedValue({
      users: { nodes: [{ id: "u-1", name: "Short Name", email: "s@example.com" }] }
    });
    const result = await resolveUserRef("short");
    expect(result).toBe("u-1");
    expect(mockedGraphQL).toHaveBeenCalledTimes(1);
  });
});

describe("resolveUserWithHints (UUID passthrough)", () => {
  beforeEach(() => mockedGraphQL.mockReset());

  it("passes through a UUID directly without calling API", async () => {
    const uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const result = await resolveUserWithHints(uuid);
    expect(result.id).toBe(uuid);
    expect(mockedGraphQL).not.toHaveBeenCalled();
  });

  it("resolves a name via findUserByName when not a UUID", async () => {
    mockedGraphQL.mockResolvedValue({
      users: { nodes: [{ id: "u-1", name: "Charles (CTO)", email: "c@example.com" }] }
    });
    const result = await resolveUserWithHints("Charles (CTO)");
    expect(result.id).toBe("u-1");
    expect(mockedGraphQL).toHaveBeenCalledTimes(1);
  });

  it("throws with hints when name not found", async () => {
    mockedGraphQL.mockResolvedValue({ users: { nodes: [] } });
    await expect(resolveUserWithHints("nobody")).rejects.toThrow("Could not uniquely resolve");
  });
});
