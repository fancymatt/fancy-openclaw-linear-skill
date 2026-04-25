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
- semantic workflow commands (considerWork, beginWork, handoffWork, complete, needsHuman, refuseWork, observeIssue)
- issue read and write commands
- workflow state discovery
- project / milestone / relation helpers
- board and review helpers
- workflow and hygiene documentation

### Semantic vs Raw Commands

This skill provides two layers of CLI access to Linear:

**Semantic commands** are the agent-facing standard. Each captures a workflow intent (e.g., "I'm considering this task," "I'm done, hand to the next agent") and handles multiple state changes atomically. Agents should use these exclusively — they eliminate the class of bugs where an agent changes status but forgets to clear the delegate.

**Raw commands** (status, assign, delegate, comment, handoff) remain available for human interactive use but print deprecation warnings when called by agents.

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

**Standard install (single-host, multiple agents):** Clone once and symlink into each agent workspace. This ensures all agents share one binary — a single `npm run build` in the canonical checkout propagates to every agent immediately.

```bash
# 1. Clone once to a shared location
git clone git@github.com:fancymatt/fancy-openclaw-linear-skill.git ~/Code/openclaw-linear/fancy-openclaw-linear-skill
cd ~/Code/openclaw-linear/fancy-openclaw-linear-skill
npm install
npm run build

# 2. Symlink into each agent workspace (repeat per agent)
ln -s ~/Code/openclaw-linear/fancy-openclaw-linear-skill ~/.openclaw/workspace-{agent}/skills/linear
```

**Do not clone into individual agent workspaces.** Independent copies diverge silently and require per-workspace rebuilds on every update.

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

## Command Reference

### Semantic Workflow Commands (Agent Standard)

| Command | Description |
|---|---|
| `linear considerWork <id>` | Mark issue as being considered (status → Thinking, delegate → self, assignee cleared). Returns issue context. |
| `linear beginWork <id>` | Begin actively working (status → Doing). Idempotent. |
| `linear handoffWork <id> <agent> [--comment <msg>] [--comment-file <path>]` | Hand off task to another agent. Sets delegate, clears assignee, posts comment. |
| `linear complete <id> [--comment <msg>] [--comment-file <path>]` | Mark task as Done, clear delegate. |
| `linear needsHuman <id> <assignee> [--comment <msg>] [--comment-file <path>]` | Escalate to human. Sets assignee, clears delegate. |
| `linear refuseWork <id> <delegate> [--comment <msg>] [--comment-file <path>]` | Refuse task and delegate to another agent. |
| `linear observeIssue <id> [--all]` | Read-only observation of an issue. No ownership change. `--all` includes all comments. |

### Issue Management

| Command | Description |
|---|---|
| `linear issue <id>` | View issue details |
| `linear create <team> <title> [--description <desc>] [--project <id>] [--milestone <id>] [--assignee <id>] [--priority <n>] [--parent <id>]` | Create a new issue |
| `linear edit <id> --title <title> --description <desc>` | Edit issue title and/or description |
| `linear delete <id>` | Delete an issue |
| `linear search <query> [--team <team>] [--limit <n>]` | Search issues by text |
| `linear branch <id>` | Get the branch name associated with an issue |
| `linear priority <id> <level>` | Set issue priority |
| `linear comments <id> [--all]` | Read comments on an issue |
| `linear delete-comment <commentId>` | Delete a comment |
| `linear upload <file> --comment <issueId>` | Upload a file attachment, optionally linking to a comment |

### Labels

| Command | Description |
|---|---|
| `linear labels [--team <team>]` | List available labels for a team |
| `linear label <id> <labelName...> [--team <team>]` | Add label(s) to an issue. Case-insensitive. Appends to existing labels. |
| `linear unlabel <id> <labelName...> [--team <team>]` | Remove label(s) from an issue. Case-insensitive. |

### Deprecated Commands (Hidden from --help)

These commands still work when invoked directly but are hidden from `linear --help` output. They bypass the semantic workflow model and should not be used by agents.

| Command | Description |
|---|---|
| `linear assign <id> <user>` | Assign issue to a human user. Clears delegate. |
| `linear delegate <id> <agent>` | Delegate issue to an agent. |
| `linear handoff <id> <reviewer> [comment] [--comment-file <path>]` | Delegate + post comment atomically. |
| `linear status <id> <state> [--team <team>]` | Change issue status. |
| `linear comment <id> <body>` | Post a comment to an issue. |
| `linear comment <id> --body-file <path>` | Post a comment from a file. |

> ⚠️ Hidden from `--help`. Print deprecation warnings when used. Agents should use semantic commands instead.

### Hierarchy & Relations

| Command | Description |
|---|---|
| `linear subtask <team> <title> --parent <id>` | Create a subtask under a parent issue |
| `linear children <id>` | View child issues |
| `linear block <id> --blocked-by <issueId>` | Create a blocking relation |
| `linear unblock <id> --blocked-by <issueId>` | Remove a blocking relation |
| `linear relations <id>` | View relations for an issue |

### Projects & Milestones

| Command | Description |
|---|---|
| `linear projects` | List all projects |
| `linear project-detail <name>` | View project details |
| `linear project-issues <name>` | List issues in a project |
| `linear project-attach <id> <name>` | Attach an issue to a project |
| `linear milestones <team>` | List milestones for a team |
| `linear milestone-create <project> <name> <targetDate>` | Create a milestone |
| `linear milestone-attach <id> <name>` | Attach an issue to a milestone |

### Agent Workflows (Personal Queue)

| Command | Description |
|---|---|
| `linear my-issues` | All issues assigned to me |
| `linear my-todos` | Issues in Todo state |
| `linear my-new [--since <iso>]` | Recently updated issues (default: last 24h) |
| `linear my-queue [--project <name>]` | Issues in Todo, filtered by project optionally |
| `linear my-next` | Highest-priority pending issue |
| `linear my-blocked [--limit <n>]` | Issues assigned to me in Blocked state |
| `linear review-queue` | Issues needing review |
| `linear stalled [days]` | Issues inactive for N days (default: 2) |
| `linear standup` | Daily standup summary |

### Notifications & Urgency

| Command | Description |
|---|---|
| `linear notifications [--limit <n>]` | Unread notifications |
| `linear urgent [--limit <n>]` | High-priority issues (priority ≤ 2) |

### Organization & Metadata

| Command | Description |
|---|---|
| `linear teams [--refresh]` | List all teams |
| `linear states <team> [--refresh]` | List workflow states for a team |
| `linear board <team>` | View team board (issues grouped by state) |

### Auth & Diagnostics

| Command | Description |
|---|---|
| `linear auth check` | Verify authentication |
| `linear auth doctor` | Diagnose Linear auth and CLI setup |
| `linear test` | Run full round-trip integration test |

## Docs

- `SKILL.md` — agent-facing skill entrypoint and quick reference
- `references/auth.md` — auth setup, env var names, discovery rules, onboarding checklist
- `references/permissions.md` — agent permissions guide, credential types, scope requirements
- `references/hygiene.md` — workflow hygiene rules
- `references/graphql.md` — safe raw GraphQL escape-hatch patterns
- `references/workflows.md` — multi-step workflows including GitHub cleanup
- `references/workflow-contract.md` — higher-level behavioral contract
- `references/connector-integration.md` — connector-specific notes

## License

MIT — see [LICENSE](LICENSE).
