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

## Auth

This skill uses Linear personal API keys (developer tokens). Full setup guide: `references/auth.md`.

**Quick version:**

1. Generate token at Linear → Settings → Account → Security & access → API
2. Store in `~/.openclaw/workspace-{agent}/.secrets/linear.env` as `LINEAR_{AGENT}_API_KEY=lin_api_...` or `LINEAR_{AGENT}_DEVELOPER_TOKEN=lin_oauth_...`
3. Or set `LINEAR_API_KEY` or `LINEAR_DEVELOPER_TOKEN` env var directly
4. Run `linear auth check --human` to verify

**Discovery priority:**
1. `LINEAR_API_KEY` env var
2. `LINEAR_DEVELOPER_TOKEN` env var
3. `~/.openclaw/workspace-{agent}/.secrets/linear.env` (key must match `linear` + `api_key`/`developer_token`/`token`)
4. `{cwd}/.secrets/linear.env` (fallback)

**Agent name sources (first wins):** `OPENCLAW_AGENT_NAME`, `OPENCLAW_AGENT_ID`, `account_id`, `$USER`, home dir basename

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

## Token freshness (important for connector agents)

If you were onboarded by the `fancy-openclaw-linear-connector`, your Linear token is an **OAuth token that refreshes every ~20 hours**. When it refreshes:

1. The old token is **invalidated** — any cached copy will 401
2. The connector writes the new token to `~/.openclaw/workspace-{you}/.secrets/linear.env`
3. Your running session may still have the old token in memory

**Rules:**
- If you get a 401 from Linear, re-read the secrets file before retrying
- Do NOT cache the token across sessions — always re-read from the file
- The connector syncs the token on every refresh, so the file is always current
- Personal API keys (lin_api_*) don't expire and don't have this problem — only OAuth tokens (lin_oauth_*) do

## Connector relationship

This skill works on its own.
If paired with `fancy-openclaw-linear-connector`, the connector handles delivery/routing while this skill handles agent-side commands and workflow discipline.
