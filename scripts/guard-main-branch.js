#!/usr/bin/env node
// Refuses to build when the live symlinked repo is on a non-main branch.
// Dev work must use a git worktree — see the runbook for instructions.
const { execSync } = require('child_process');

let branch;
try {
  branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
} catch {
  // Not a git repo or git unavailable — let the build proceed.
  process.exit(0);
}

if (branch && branch !== 'main') {
  console.error(
    `\nLIVE BUILD GUARD: refusing to build on branch "${branch}".\n` +
    `The live npm-global-linked CLI must only be built from main.\n` +
    `For dev work, use a git worktree:\n\n` +
    `  git worktree add ../fancy-openclaw-linear-skill-${branch} ${branch}\n` +
    `  cd ../fancy-openclaw-linear-skill-${branch} && npm run build\n`
  );
  process.exit(1);
}
