import { checkAuth, resolveAgentName } from "../auth";
import { LinearApiError, linearGraphQL } from "../client";

jest.mock("../client", () => ({
  ...jest.requireActual("../client"),
  linearGraphQL: jest.fn()
}));

const mockedLinearGraphQL = linearGraphQL as jest.MockedFunction<typeof linearGraphQL>;

describe("checkAuth", () => {
  beforeEach(() => {
    mockedLinearGraphQL.mockReset();
  });

  it("returns the viewer on success", async () => {
    mockedLinearGraphQL.mockResolvedValue({
      viewer: {
        id: "user-1",
        name: "Matt Fancy",
        email: "matt@example.com"
      }
    });

    await expect(checkAuth()).resolves.toEqual({
      id: "user-1",
      name: "Matt Fancy",
      email: "matt@example.com"
    });
  });

  it("fails loudly when LINEAR_API_KEY is missing", async () => {
    mockedLinearGraphQL.mockRejectedValue(new Error("No LINEAR_API_KEY set. Set it via the linear-access skill."));

    await expect(checkAuth()).rejects.toThrow("No LINEAR_API_KEY set. Set it via the linear-access skill.");
  });

  it("fails loudly when the LINEAR_API_KEY is invalid", async () => {
    mockedLinearGraphQL.mockRejectedValue(new LinearApiError("Unauthorized", "UNAUTHORIZED"));

    await expect(checkAuth()).rejects.toThrow("LINEAR_API_KEY is invalid: Unauthorized");
  });
});

describe("resolveAgentName", () => {
  const ENV_KEYS = ["OPENCLAW_MCP_AGENT_ID", "OPENCLAW_AGENT_NAME", "HOME"] as const;
  const saved: Partial<Record<typeof ENV_KEYS[number], string | undefined>> = {};
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    warnSpy.mockRestore();
  });

  it("uses OPENCLAW_MCP_AGENT_ID as primary", () => {
    process.env.OPENCLAW_MCP_AGENT_ID = "charles";
    process.env.HOME = "/home/somebody";
    expect(resolveAgentName().name).toBe("charles");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("falls back to OPENCLAW_AGENT_NAME when MCP id is unset", () => {
    process.env.OPENCLAW_AGENT_NAME = "astrid";
    expect(resolveAgentName().name).toBe("astrid");
  });

  it("derives name from $HOME when basename starts with workspace-", () => {
    process.env.HOME = "/home/fancymatt/.openclaw/workspace-igor";
    expect(resolveAgentName().name).toBe("igor");
  });

  it("derives name from $HOME when basename starts with openclaw-", () => {
    process.env.HOME = "/home/openclaw-felix";
    expect(resolveAgentName().name).toBe("felix");
  });

  it("returns no name when no source matches", () => {
    process.env.HOME = "/home/fancymatt";
    expect(resolveAgentName().name).toBeUndefined();
  });

  it("warns when sources disagree and uses highest priority", () => {
    process.env.OPENCLAW_MCP_AGENT_ID = "charles";
    process.env.OPENCLAW_AGENT_NAME = "astrid";
    expect(resolveAgentName().name).toBe("charles");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("disagree");
  });

  it("does not warn when sources agree (case-insensitive)", () => {
    process.env.OPENCLAW_MCP_AGENT_ID = "Charles";
    process.env.OPENCLAW_AGENT_NAME = "charles";
    expect(resolveAgentName().name).toBe("charles");
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
