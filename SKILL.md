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

## Supported auth inputs

Currently supported:
- `LINEAR_API_KEY`
- agent workspace `.secrets/linear.env`

Note: this is being hardened further to better support explicit developer-token onboarding and first-time setup for app-style agents.

## Quick reference

- `linear auth check`
- `linear my-issues`
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

## Connector relationship

This skill works on its own.
If paired with `fancy-openclaw-linear-connector`, the connector handles delivery/routing while this skill handles agent-side commands and workflow discipline.
