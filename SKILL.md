---
name: fancy-openclaw-linear-skill
description: Self-contained Linear skill for OpenClaw, including CLI commands and workflow guidance. Recommended companion to the fancy-openclaw-linear-connector.
---

# Fancy OpenClaw Linear Skill

This repo is the Linear skill.
It is self-contained.
It does not assume a separate legacy internal `linear` skill is installed.

It includes:
- a Linear CLI for common reads and mutations
- auth/bootstrap behavior
- workflow-state discovery
- handoff, board, relation, project, and milestone helpers
- workflow and hygiene guidance for agents

## Setup

Install dependencies and build the CLI:

```bash
npm install
npm run build
```

Then verify auth:

```bash
node dist/index.js auth check --human
```

Or, if globally linked (`npm link`):

```bash
linear auth check --human
```

## Auth — Which Token Do I Use?

Agents onboarded by the **fancy-openclaw-linear-connector** use **OAuth tokens** (`lin_oauth_...`). These are provisioned through the connector and auto-refreshed every ~20 hours.

Agents NOT on the connector use **personal API keys** (`lin_api_...`). These don't expire.

**The `linear` CLI discovers your token automatically.** You do NOT need to manually export it. The CLI reads from `~/.openclaw/workspace-{you}/.secrets/linear.env` on every invocation.

**Do NOT use the `linear-access` skill to inject tokens.** That skill is for legacy agents with personal API keys. If you're a connector agent, your token lives in `.secrets/linear.env` and the CLI reads it directly.

**Discovery priority (built into the CLI):**
1. `LINEAR_API_KEY` env var
2. `LINEAR_DEVELOPER_TOKEN` env var
3. `~/.openclaw/workspace-{agent}/.secrets/linear.env` (key must match `linear` + `api_key`/`developer_token`/`token`)
4. `{cwd}/.secrets/linear.env` (fallback)

**Agent name sources (first wins):** `OPENCLAW_AGENT_NAME`, `OPENCLAW_AGENT_ID`, `account_id`, `$USER`, home dir basename

### If you get a 401 / "Account disabled"

Your OAuth token was refreshed and the old one is invalidated. Re-read the secrets file — the connector has already written the new token. If you're running in a session with a cached token, the next CLI invocation will pick up the fresh one automatically.

**Do NOT fall back to personal API keys.** If your personal key was disabled when the OAuth app took over, it's gone permanently. The OAuth token in `.secrets/linear.env` is your only valid credential.

## Quick reference

- `linear auth check`
- `linear teams [--refresh]`
- `linear my-issues`
- `linear notifications [--limit N]`
- `linear urgent [--limit N]`
- `linear standup`
- `linear branch <ID>`
- `linear my-todos`
- `linear my-new [--since ISO]`
- `linear issue <ID>`
- `linear create <TEAM> <TITLE> [flags]`
- `linear comment <ID> <BODY> | --body-file <path>`
- `linear states <TEAM> [--refresh]`
- `linear status <ID> <STATE>`
- `linear assign <ID> <USER>`
- `linear priority <ID> <LEVEL>`
- `linear handoff <ID> <REVIEWER> <COMMENT>`
- `linear projects`
- `linear project-detail <NAME>`
- `linear project-attach <ID> <NAME>`
- `linear project-issues <NAME>`
- `linear milestones <TEAM>`
- `linear milestone-create <PROJECT> <NAME> <YYYY-MM-DD>`
- `linear milestone-attach <ID> <NAME>`
- `linear relations <ID>`
- `linear block <ID> --blocked-by <OTHER>`
- `linear unblock <ID> --blocked-by <OTHER>`
- `linear subtask <TEAM> <TITLE> --parent <ID>`
- `linear children <ID>`
- `linear board <TEAM>`
- `linear review-queue`
- `linear stalled [days]`
- `linear comments <ID> [--all]`
- `linear upload <FILE> [--comment <ID>]`

## When You Receive a [NEW TASK] Message

If you're a connector agent and you get a message starting with `[NEW TASK]`, follow this pattern:

1. **Read the task message** — it tells you the issue identifier (e.g. AI-243)
2. **Fetch the issue**: `linear issue AI-243`
3. **Fetch the comments**: `linear comments AI-243`
4. **Read both the description AND comments** — the task brief may be in either place
5. **Do the work**, then comment on the issue with your deliverable
6. **Done** — the connector handles session cleanup

Do NOT use the `linear-access` skill or try to manually source tokens. Just run `linear` commands directly.

## Common workflows

### Handoff

```bash
linear handoff AI-123 Charles --comment-file /tmp/review.md
```

### Review queue sweep

```bash
linear review-queue
linear comments AI-123
linear issue AI-123
```

### GitHub worktree lifecycle

See `references/workflows.md`.

## Hygiene rules

Short version:
- no orphan issues
- `Needs Review` requires reassignment
- `Done` means genuinely done
- read comments oldest-first
- use explicit blocking direction

Full rules: `references/hygiene.md`

## Raw GraphQL

Use raw GraphQL only when the CLI does not yet support the operation.
Always build JSON with `jq -n --arg`, never with string interpolation.

Examples: `references/graphql.md`

## Token freshness (connector agents)

OAuth tokens refresh every ~20 hours. When it refreshes:

1. The old token is **invalidated** — any cached copy will 401
2. The connector writes the new token to `~/.openclaw/workspace-{you}/.secrets/linear.env`
3. Your running session may still have the old token in memory

**Rules:**
- If you get a 401 from Linear, re-read the secrets file before retrying
- Do NOT cache the token across sessions — always re-read from the file
- The connector syncs the token on every refresh, so the file is always current

## Connector relationship

This skill works on its own.
If paired with `fancy-openclaw-linear-connector`, the connector handles delivery/routing while this skill handles agent-side commands and workflow discipline.

Agents should NOT reference the `linear-access` skill or legacy `linear.sh` scripts. This skill replaces both.
