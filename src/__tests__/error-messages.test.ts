import { spawn } from "child_process";

function run(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn("node", ["dist/index.js", ...args], {
      cwd: "/home/fancymatt/Code/fancy-openclaw-linear-skill",
      env: { ...process.env, LINEAR_API_KEY: "test-key" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
  });
}

describe("error messages with usage hints", () => {
  test("unknown command suggests similar command name", async () => {
    const { stderr, code } = await run(["handof-work", "AI-1", "charles"]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/unknown command.*handof-work/);
    expect(stderr).toMatch(/Did you mean.*handoff-work/);
    expect(stderr).toMatch(/linear --help/);
  });

  test("unknown command without close match shows help hint", async () => {
    const { stderr, code } = await run(["zzzzz"]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/unknown command.*zzzzz/);
    expect(stderr).toMatch(/linear --help/);
    expect(stderr).not.toMatch(/Did you mean/);
  });

  test("unknown flag on subcommand shows usage hint", async () => {
    const { stderr, code } = await run(["handoff-work", "AI-1", "charles", "--bad-flag"]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/unknown option.*--bad-flag/);
    expect(stderr).toMatch(/Usage: linear handoff-work/);
    expect(stderr).toMatch(/See 'linear handoff-work --help'/);
  });
});
