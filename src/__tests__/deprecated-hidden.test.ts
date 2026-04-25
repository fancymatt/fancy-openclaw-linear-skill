describe("deprecated commands hidden from --help", () => {
  const deprecatedCommands = ["status", "assign", "delegate", "handoff", "comment"];

  it("should not include deprecated commands in help output", () => {
    const { execSync } = require("child_process");
    const helpOutput = execSync("node dist/index.js --help", {
      encoding: "utf8",
      cwd: __dirname + "/../..",
    });

    for (const cmd of deprecatedCommands) {
      const commandRegex = new RegExp(`^  ${cmd}(\\s|\\|)`, "m");
      expect(helpOutput).not.toMatch(commandRegex);
    }
  });

  it("deprecated commands should still be invocable", () => {
    const { execSync } = require("child_process");

    for (const cmd of deprecatedCommands) {
      let output: string;
      try {
        output = execSync(`node dist/index.js ${cmd} --help`, {
          encoding: "utf8",
          cwd: __dirname + "/../..",
        });
      } catch {
        fail(`${cmd} --help should not throw`);
      }
      expect(output).toContain(`Usage: linear ${cmd}`);
    }
  });
});
