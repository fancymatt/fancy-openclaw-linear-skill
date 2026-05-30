import os from "node:os";
import path from "node:path";

import { getAgentWorkspaceDir, getLinearSecretPath } from "../paths";

describe("getAgentWorkspaceDir", () => {
  const savedConfigDir = process.env.OPENCLAW_CONFIG_DIR;
  const savedHome = process.env.HOME;

  afterEach(() => {
    if (savedConfigDir === undefined) delete process.env.OPENCLAW_CONFIG_DIR;
    else process.env.OPENCLAW_CONFIG_DIR = savedConfigDir;
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
  });

  it("returns configDir/workspace/{agentId} for named agents", () => {
    expect(
      getAgentWorkspaceDir("charles", { configDir: "/cfg" }),
    ).toBe(path.join("/cfg", "workspace", "charles"));
  });

  it("returns configDir/workspace (no subdir) for the main agent", () => {
    expect(
      getAgentWorkspaceDir("main", { configDir: "/cfg" }),
    ).toBe(path.join("/cfg", "workspace"));
  });

  it("uses OPENCLAW_CONFIG_DIR when no override is supplied", () => {
    process.env.OPENCLAW_CONFIG_DIR = "/env-cfg";
    expect(getAgentWorkspaceDir("astrid")).toBe(
      path.join("/env-cfg", "workspace", "astrid"),
    );
  });

  it("falls back to $HOME/.openclaw when neither override nor env is set", () => {
    delete process.env.OPENCLAW_CONFIG_DIR;
    process.env.HOME = "/fake-home";
    expect(getAgentWorkspaceDir("astrid")).toBe(
      path.join("/fake-home", ".openclaw", "workspace", "astrid"),
    );
  });

  it("falls back to os.homedir()/.openclaw when HOME is unset", () => {
    delete process.env.OPENCLAW_CONFIG_DIR;
    delete process.env.HOME;
    expect(getAgentWorkspaceDir("astrid")).toBe(
      path.join(os.homedir(), ".openclaw", "workspace", "astrid"),
    );
  });
});

describe("getLinearSecretPath", () => {
  it("appends .secrets/linear.env to the workspace dir", () => {
    expect(
      getLinearSecretPath("charles", { configDir: "/cfg" }),
    ).toBe(path.join("/cfg", "workspace", "charles", ".secrets", "linear.env"));
  });

  it("places main agent's secrets at workspace/.secrets/linear.env", () => {
    expect(
      getLinearSecretPath("main", { configDir: "/cfg" }),
    ).toBe(path.join("/cfg", "workspace", ".secrets", "linear.env"));
  });
});
