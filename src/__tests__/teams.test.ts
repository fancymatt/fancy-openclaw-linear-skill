import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { linearGraphQL } from "../client";
import { listTeams, resolveTeamId } from "../teams";

jest.mock("../client", () => ({
  ...jest.requireActual("../client"),
  linearGraphQL: jest.fn()
}));

jest.mock("node:fs/promises", () => {
  const actual = jest.requireActual("node:fs/promises");
  return { ...actual };
});

const mockedGraphQL = linearGraphQL as jest.MockedFunction<typeof linearGraphQL>;

describe("listTeams", () => {
  beforeEach(() => {
    mockedGraphQL.mockReset();
    // Reset cache by mocking fs
    jest.spyOn(fs, "readFile").mockRejectedValue(new Error("no cache"));
    jest.spyOn(fs, "mkdir").mockResolvedValue(undefined);
    jest.spyOn(fs, "writeFile").mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("fetches teams from API when no cache", async () => {
    mockedGraphQL.mockResolvedValue({
      teams: { nodes: [{ id: "t-1", key: "AI", name: "AI Systems" }] }
    });
    const teams = await listTeams();
    expect(teams).toHaveLength(1);
    expect(teams[0].key).toBe("AI");
  });

  it("uses cache when available and refresh=false", async () => {
    jest.spyOn(fs, "readFile").mockResolvedValueOnce(
      JSON.stringify([{ id: "t-1", key: "AI", name: "AI Systems" }])
    );
    const teams = await listTeams(false);
    expect(teams).toHaveLength(1);
    expect(mockedGraphQL).not.toHaveBeenCalled();
  });

  it("bypasses cache when refresh=true", async () => {
    mockedGraphQL.mockResolvedValue({
      teams: { nodes: [{ id: "t-2", key: "LIFE", name: "Life" }] }
    });
    const teams = await listTeams(true);
    expect(teams).toHaveLength(1);
    expect(mockedGraphQL).toHaveBeenCalled();
  });
});

describe("resolveTeamId", () => {
  beforeEach(() => {
    mockedGraphQL.mockReset();
    jest.spyOn(fs, "readFile").mockRejectedValue(new Error("no cache"));
    jest.spyOn(fs, "mkdir").mockResolvedValue(undefined);
    jest.spyOn(fs, "writeFile").mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns UUID directly if it looks like a UUID", async () => {
    const id = await resolveTeamId("550e8400-e29b-41d4-a716-446655440000");
    expect(id).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(mockedGraphQL).not.toHaveBeenCalled();
  });

  it("resolves team key to ID", async () => {
    mockedGraphQL.mockResolvedValue({
      teams: { nodes: [{ id: "team-ai-id", key: "AI", name: "AI Systems" }] }
    });
    const id = await resolveTeamId("AI");
    expect(id).toBe("team-ai-id");
  });

  it("resolves team key case-insensitively", async () => {
    mockedGraphQL.mockResolvedValue({
      teams: { nodes: [{ id: "team-ai-id", key: "AI", name: "AI Systems" }] }
    });
    const id = await resolveTeamId("ai");
    expect(id).toBe("team-ai-id");
  });

  it("throws when team key not found", async () => {
    mockedGraphQL.mockResolvedValue({ teams: { nodes: [] } });
    await expect(resolveTeamId("NONEXISTENT")).rejects.toThrow('Unknown team key "NONEXISTENT"');
  });
});
