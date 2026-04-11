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

## Auth Setup

This skill authenticates to Linear using personal API keys (developer tokens). No OAuth is needed.

### Quick start for a new agent

1. Generate a Linear API key: **Linear → Settings → Account → Security & access → API → New token**
2. Create the secrets directory and write the key:
   ```bash
   mkdir -p ~/.openclaw/workspace-{agent}/.secrets
   echo "LINEAR_{AGENT}_API_KEY=lin_api_your_token" > ~/.openclaw/workspace-{agent}/.secrets/linear.env
   chmod 600 ~/.openclaw/workspace-{agent}/.secrets/linear.env
   ```
3. Verify:
   ```bash
   cd ~/.openclaw/workspace/skills/fancy-openclaw-linear-skill
   node dist/index.js auth check --human
   ```

You should see your Linear user name and email printed. If not, see `references/auth.md` for the full auth guide including env var names, discovery rules, and troubleshooting.

### Auth discovery priority

1. `LINEAR_API_KEY` environment variable
2. `LINEAR_DEVELOPER_TOKEN` environment variable
3. `~/.openclaw/workspace-{agent}/.secrets/linear.env` (key must match `linear` + `api_key`/`developer_token`/`token`)
4. `{cwd}/.secrets/linear.env` (fallback)

## Docs

- `SKILL.md` — agent-facing skill entrypoint and quick reference
- `references/auth.md` — auth setup, env var names, discovery rules, onboarding checklist
- `references/hygiene.md` — workflow hygiene rules
- `references/graphql.md` — safe raw GraphQL escape-hatch patterns
- `references/workflows.md` — multi-step workflows including GitHub cleanup
- `references/workflow-contract.md` — higher-level behavioral contract
- `references/connector-integration.md` — connector-specific notes

## License

MIT — see [LICENSE](LICENSE).
