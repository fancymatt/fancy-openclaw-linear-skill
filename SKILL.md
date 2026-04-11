---
name: fancy-openclaw-linear-skill
description: Robust Linear CLI + workflow guidance for OpenClaw agents, including the recommended companion contract for the fancy-openclaw-linear-connector.
---

# Fancy OpenClaw Linear Skill

This skill is the recommended agent-side companion to the `fancy-openclaw-linear-connector`.
It also works as a general-purpose Linear skill on its own.

## Setup

Provide a personal Linear API key either by:
- setting `LINEAR_API_KEY`
- or provisioning `.secrets/linear.env` in your agent workspace

Verify setup:

```bash
npm install
npm run build
node dist/index.js auth check --human
```

## Command quick reference

- `linear auth check` - verify auth/bootstrap
- `linear my-issues` - all assigned issues
- `linear my-todos` - assigned Todo issues
- `linear my-new [--since ISO]` - recently updated assigned issues
- `linear issue <ID>` - full issue detail
- `linear create <TEAM> <TITLE> [flags]` - create issue
- `linear comment <ID> <BODY> | --body-file <path>` - add comment
- `linear states <TEAM> [--refresh]` - fetch/cache workflow states
- `linear status <ID> <STATE>` - update status with dynamic state resolution
- `linear assign <ID> <USER>` - assign issue
- `linear priority <ID> <LEVEL>` - set priority number
- `linear handoff <ID> <REVIEWER> <COMMENT>` - comment + assign + move to Needs Review
- `linear projects` - list projects
- `linear project-detail <NAME>` - get description and content
- `linear project-attach <ID> <NAME>` - attach issue to project
- `linear project-issues <NAME>` - list project issues
- `linear milestones <TEAM>` - list milestones
- `linear milestone-create <PROJECT> <NAME> <YYYY-MM-DD>` - create milestone
- `linear milestone-attach <ID> <NAME>` - attach milestone
- `linear relations <ID>` - list issue relations
- `linear block <ID> --blocked-by <OTHER>` - add dependency safely
- `linear unblock <ID> --blocked-by <OTHER>` - remove dependency
- `linear subtask <TEAM> <TITLE> --parent <ID>` - create child issue
- `linear children <ID>` - list subtasks
- `linear board <TEAM>` - non-done issues grouped by state
- `linear review-queue` - your Needs Review issues
- `linear stalled [days]` - your stale In Progress issues
- `linear comments <ID> [--all]` - ordered oldest-first comments
- `linear upload <FILE> [--comment <ID>]` - upload asset, optionally comment URL

## Common workflows

### Handoff

```bash
linear handoff AI-123 Charles --comment-file /tmp/review.md
```

### Create + attach

```bash
linear create AI "Title" --project <project-id> --priority 2
```

### Review queue sweep

```bash
linear review-queue
linear comments AI-123
linear issue AI-123
```

### GitHub branch to PR to cleanup

See `references/workflows.md` for the full worktree workflow including cleanup after merge.

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

## Known limitations

- some advanced Linear fields may still need raw GraphQL during early versions
- relation removal resolves by current known relation graph, so exact matching matters
- `create` currently expects IDs for project/milestone/assignee flags rather than name lookup
