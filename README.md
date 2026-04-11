# fancy-openclaw-linear-skill

A self-contained Linear skill for OpenClaw agents.

This repo packages both:
- a robust Linear CLI for reading and mutating Linear data
- the workflow guidance that tells agents how to work with Linear safely

It is the recommended companion to the `fancy-openclaw-linear-connector`, but it is also useful on its own.

## What This Is

This is a complete Linear skill package, not an add-on to some other internal skill.

It includes:
- auth/bootstrap behavior
- issue read and write commands
- workflow state discovery
- handoff flows
- project / milestone / relation helpers
- board and comment-reading helpers
- workflow and hygiene documentation

## Product Boundary

This repo should be installable and understandable by an outside OpenClaw user without needing access to Fancymatt's legacy internal `linear` skill.

The connector relationship is:

```text
Linear → fancy-openclaw-linear-connector → OpenClaw agent
                                         ↓
                           fancy-openclaw-linear-skill
```

- **Connector** handles ingestion, routing, queueing, and recovery
- **This skill** handles agent-side Linear operations and workflow discipline

## Install

Supported install modes:

### Option 1: Clone directly into your skills directory

```bash
cd ~/.openclaw/workspace/skills
git clone git@github.com:fancymatt/fancy-openclaw-linear-skill.git
cd fancy-openclaw-linear-skill
npm install
npm run build
```

### Option 2: Symlink during development

```bash
git clone git@github.com:fancymatt/fancy-openclaw-linear-skill.git ~/Code/fancy-openclaw-linear-skill
cd ~/Code/fancy-openclaw-linear-skill
npm install
npm run build
ln -s ~/Code/fancy-openclaw-linear-skill ~/.openclaw/workspace/skills/fancy-openclaw-linear-skill
```

## Verify

```bash
cd ~/.openclaw/workspace/skills/fancy-openclaw-linear-skill
node dist/index.js auth check --human
```

## Docs

- `SKILL.md` — agent-facing skill entrypoint and quick reference
- `references/hygiene.md` — workflow hygiene rules
- `references/graphql.md` — safe raw GraphQL escape-hatch patterns
- `references/workflows.md` — multi-step workflows including GitHub cleanup
- `references/workflow-contract.md` — higher-level behavioral contract
- `references/connector-integration.md` — connector-specific notes

## Current note

This repo is being actively hardened through real dogfooding. Auth/bootstrap and permissions setup are being tightened to make fresh-agent onboarding fully explicit.

## License

MIT — see [LICENSE](LICENSE).
