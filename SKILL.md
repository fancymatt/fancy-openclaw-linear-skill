---
name: linear
description: Use the Linear CLI for issue management, delegation, and project work. Semantic commands capture agent intent and handle state transitions automatically.
---

# Linear CLI Quick Reference

## Core Semantics — Know These

### Assignee vs Delegate
- **Assignee** = human who must act next. Set automatically by `needsHuman` and `complete`. Cleared when an agent takes ownership.
- **Delegate** = agent who owns the ticket. Set by `considerWork` (self) and `handoffWork`/`refuseWork` (another agent). Cleared by `complete` and `needsHuman`.
- **The key insight:** assignee is ONLY set when a human needs to do something. This makes "assigned to me" views in Linear reliable — every ticket there is genuinely waiting on human input.

### Semantic Commands (Agent Standard)

These are the ONLY commands agents should use for workflow state transitions. Every command captures intent and handles multiple API calls atomically.

#### Read Commands

```
linear observeIssue <ID>             # Read issue + last 10 comments (no ownership change)
linear observeIssue <ID> --all       # Read issue + ALL comments
```

Use `observeIssue` when you are @mentioned (not delegated) or doing a board sweep. No state changes.

#### Write Commands

```
linear considerWork <ID>             # Accept delegation: set delegate=self, status=Thinking, clear assignee
                                     # Returns issue context + last 10 comments
linear beginWork <ID>                # Start active work: status=Doing (idempotent)
linear refuseWork <ID> <agent>       # Decline: status=Todo, delegate to another agent (requires --comment)
linear handoffWork <ID> <agent>      # Hand off: status=Todo, delegate to agent (requires --comment)
linear complete <ID>                 # Finish: status=Done, clear delegate + assignee (optional --comment)
linear needsHuman <ID> <human>       # Escalate: status=Todo, assignee=human, clear delegate (requires --comment)
```

#### Comment Options

All write commands accept `--comment "<msg>"` or `--comment-file <path>` for comments. `refuseWork`, `handoffWork`, and `needsHuman` require a comment. `considerWork` and `beginWork` do not accept comments — agents should not comment without a handoff.

### When to Use Each Command

| Situation | Command |
|---|---|
| You receive a webhook delegation | `considerWork <ID>` |
| You are @mentioned but not delegated | `observeIssue <ID>` |
| You start actively coding/researching | `beginWork <ID>` |
| You're done and passing to another agent | `handoffWork <ID> <agent> --comment "..."` |
| You're done and the ticket is complete | `complete <ID>` |
| You need a human decision/input | `needsHuman <ID> <human> --comment "..."` |
| You're the wrong person for this task | `refuseWork <ID> <agent> --comment "..."` |
| Browsing tickets without ownership | `observeIssue <ID>` |

### Workflow Rules (from AGENTS.md)

1. **All communication goes in the ticket.** Post analysis, findings, updates, deliverables as comments via `--comment` on semantic commands.
2. **Always hand off when your work is done.** Use `handoffWork`, `complete`, or `needsHuman`. Never leave a ticket delegated to yourself after completing work.
3. **If it's not your area, give your perspective and delegate back.** Use `handoffWork` or `refuseWork`.
4. **Structural issues get their own tickets.** Don't bury observations as footnotes.
5. **Move tickets forward immediately.** New tickets → delegate to appropriate agent via the semantic commands.

### Deprecated Commands (Human Use Only)

The following commands still work but print deprecation warnings for agents:
- `linear status`, `linear assign`, `linear delegate`, `linear handoff`, `linear comment`

Agents should NOT use these. They bypass the semantic intent model and cause delegate/assignee drift. Use semantic commands instead.

## Navigation & Utility Commands

```
linear my-issues                     # Issues delegated to you
linear my-todos                      # Your todo items
linear board <TEAM>                  # Team board view
linear review-queue                  # Items in review state
linear stalled <days>                # Stale tickets
linear children <ID>                 # View sub-issues
linear relations <ID>                # View related issues
linear block <ID> --blocked-by <ID>  # Mark as blocking
linear unblock <ID> --blocked-by <ID>  # Remove block
linear project-issues <project>      # List project issues
linear create <TEAM> "<title>"       # Create issue
linear edit <ID> --title/--desc      # Edit title/description
```

## Team Keys
- `LIFE` — Matt's Personal Life
- `LN3` — Lane 3 (Lane team)
- `ILL` — Innovative Language Learning (work)
