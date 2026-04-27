---
name: linear
description: Use the Linear CLI for issue management, delegation, and project work. Semantic commands capture agent intent and handle state transitions automatically.
---

# Linear CLI Quick Reference

## Debugging

- Add `--debug` to any command to dump raw GraphQL errors to stderr when something fails. Useful for diagnosing opaque validation errors.
- Common validation errors and their workarounds:
  - **Self-reference in comment body** → bare ticket ID detected; use em-dashes (—) or spell out the ID
  - **Comment too long** → exceeds max length; split into multiple comments or shorten
  - **Team/label mismatch** → label from wrong team; use a label from the issue's team
  - **Generic Argument Validation Error** → re-run with `--debug` to inspect which field failed

## Core Semantics — Know These

### Assignee vs Delegate
- **Assignee** = human who must act next. Set automatically by `needsHuman` and `complete`. Cleared when an agent takes ownership.
- **Delegate** = agent who owns the ticket. Set by `considerWork` (self) and `handoffWork`/`refuseWork` (another agent). Cleared by `complete` and `needsHuman`.
- **The key insight:** assignee is ONLY set when a human needs to do something. This makes "assigned to me" views in Linear reliable — every ticket there is genuinely waiting on human input.

### Semantic Commands (Agent Standard)

These are the ONLY commands agents should use for workflow state transitions. Every command captures intent and handles multiple API calls atomically.

#### Read Commands

```
linear observe-issue <ID>             # Read issue + last 10 comments (no ownership change)
linear observe-issue <ID> --all       # Read issue + ALL comments
```

Use `observe-issue` when you are @mentioned (not delegated) or doing a board sweep. No state changes.

#### Write Commands

```
linear consider-work <ID>             # Accept delegation: set delegate=self, status=Thinking, clear assignee
                                      # Returns issue context + last 10 comments
linear begin-work <ID>                # Start active work: status=Doing (idempotent)
linear refuse-work <ID> <agent>       # Decline: status=Todo, delegate to another agent (requires --comment)
linear handoff-work <ID> <agent>      # Hand off: status=Todo, delegate to agent (requires --comment)
linear complete <ID>                  # Finish: status=Done, clear delegate + assignee (optional --comment)
linear needs-human <ID> <human>       # Escalate: status=Todo, assignee=human, clear delegate (requires --comment)
linear note <ID> --comment "<msg>"    # Post comment only: no state, delegate, or assignee change
                                      # Works on any status (including Done/Canceled)
```

> **Note:** camelCase aliases (`considerWork`, `beginWork`, etc.) still work for backward compatibility but kebab-case is the standard.

#### Comment Options

All write commands accept `--comment "<msg>"` or `--comment-file <path>` for comments. `refuse-work`, `handoff-work`, and `needs-human` require a comment. `consider-work` and `begin-work` do not accept comments — agents should not comment without a handoff.

### When to Use Each Command

| Situation | Command |
|---|---|
| You receive a webhook delegation | `consider-work <ID>` |
| You are @mentioned but not delegated | `observe-issue <ID>` |
| You start actively coding/researching | `begin-work <ID>` |
| You're done and passing to another agent | `handoff-work <ID> <agent> --comment "..."` |
| You're done and the ticket is complete | `complete <ID>` |
| You need a human decision/input | `needs-human <ID> <human> --comment "..."` |
| You're the wrong person for this task | `refuse-work <ID> <agent> --comment "..."` |
| Browsing tickets without ownership | `observe-issue <ID>` |
| Adding context to a closed ticket | `note <ID> --comment "..."` |

### Workflow Rules (from AGENTS.md)

1. **All communication goes in the ticket.** Post analysis, findings, updates, deliverables as comments via `--comment` on semantic commands.
2. **Always hand off when your work is done.** Use `handoff-work`, `complete`, or `needs-human`. Never leave a ticket delegated to yourself after completing work.
3. **If it's not your area, give your perspective and delegate back.** Use `handoff-work` or `refuse-work`.
4. **Structural issues get their own tickets.** Don't bury observations as footnotes.
5. **Move tickets forward immediately.** New tickets → delegate to appropriate agent via the semantic commands.

### Closing Rules — Non-Negotiable

6. **The agent who does the work cannot close the ticket.** `complete` must only be called by a reviewer — never by the agent who implemented the work. Once you've done the work, use `handoffWork` or `needsHuman` to pass it to a reviewer. The reviewer calls `complete`.
7. **Do not close a ticket with open flagged issues.** If a reviewer raised an issue in a comment, it must be resolved in one of three ways before `complete` is called:
   - A new ticket was created to track it, OR
   - The original poster confirmed it can be ignored, OR
   - The fix was implemented and confirmed.
   Silence is not resolution. A flagged issue with no explicit response blocks `complete`.

### Comment Verification

**Never read-after-write to verify a comment.** The mutation result is the strongly-consistent source of truth. Trust the `commentId` and `commentUrl` printed on success. If you genuinely need to confirm propagation (rare), use `linear verify-comment <commentId>` — it uses the strongly-consistent node query, not the eventually-consistent connection feed. The `linear comments` / `observe-issue` connection feed can lag by seconds to minutes.

### Deprecated Commands (Human Use Only)

The following commands still work but print deprecation warnings for agents:
- `linear status`, `linear assign`, `linear delegate`, `linear handoff`, `linear comment`

Agents should NOT use these. They bypass the semantic intent model and cause delegate/assignee drift. Use semantic commands instead.

## Navigation & Utility Commands

```
linear queue                         # Issues delegated to you (your work queue)
linear queue --next                  # Highest-priority issue only
linear queue --blocked               # Blocked issues only
linear my-issues                     # All issues assigned or delegated to you
linear my-issues --status "To Do"    # Filter by status
linear my-issues --new               # New/unviewed issues
linear board <TEAM>                  # Team board view
linear review-queue                  # Items in review state
linear stalled <days>                # Stale tickets
linear children <ID>                 # View sub-issues
linear relations <ID>                # View related issues
linear block <ID> --blocked-by <ID>  # Mark as blocking
linear unblock <ID> --blocked-by <ID>  # Remove block
linear verify-comment <commentId>    # Strongly-consistent comment existence check
linear project-issues <project>      # List project issues
linear create <TEAM> "<title>"       # Create issue
linear create <TEAM> "<title>" --assignee <name|uuid>  # Assign on create
linear create <TEAM> "<title>" --delegate <name|uuid>  # Delegate on create
linear edit <ID> --title/--desc      # Edit title/description
```

## Team Keys
- `LIFE` — Matt's Personal Life
- `LN3` — Lane 3 (Lane team)
- `ILL` — Innovative Language Learning (work)
