---
name: linear
description: Use the Linear CLI for issue management, delegation, and project work. Covers commands, field semantics, and common patterns.
---

# Linear CLI Quick Reference

## Core Semantics — Know These

### Assignee vs Delegate
- **Assignee** = human owner (Matt, Charles as person, etc.). Set with `linear assign <id> <human>`.
- **Delegate** = agent doing the work (Ai, Charles as agent, Hachi, etc.). Set with `linear delegate <id> <agent-name>`.
- Agents can ONLY be delegates. If you want Charles (the agent) to work on a ticket, use `linear delegate LIFE-10 charles`.
- If `linear delegate` returns without error but the delegate field stays null, the agent name may not match — check the exact Linear display name.

### Workflow Rules (from AGENTS.md)
1. **All communication goes in the ticket.** Post analysis, findings, updates, deliverables as comments.
2. **Always delegate when your work is done.** Use `linear handoff <ID> <agent> "<reason>"` — this sets the delegate AND posts a comment. Tagging in a comment alone ≠ delegation.
3. **If it's not your area, give your perspective and delegate back.**
4. **Structural issues get their own tickets.** Don't bury observations as footnotes.
5. **Move tickets forward immediately.** New tickets → Todo status, delegate to appropriate agent.

## Common Commands

```
# View
linear issue <ID>                    # Full issue details + comments
linear my-issues                     # Issues assigned to you
linear my-todos                      # Your todo items
linear board <TEAM>                  # Team board view

# Create
linear create <TEAM> "<title>"       # Create issue (opens editor for description)

# Edit
linear status <ID> "<state>"         # Move to new state
linear assign <ID> <human>           # Set human assignee
linear delegate <ID> <agent>         # Set agent delegate
linear comment <ID> "<body>"         # Post comment
linear handoff <ID> <agent> "<msg>"  # Delegate + comment in one

# Navigation
linear children <ID>                 # View sub-issues
linear relations <ID>                # View related issues
linear block <ID> <blocks-ID>        # Mark as blocking
linear unblock <ID> <blocks-ID>      # Remove block
linear project-issues <project>      # List project issues
```

## Team Keys
- `LIFE` — Matt's Personal Life
- `LN3` — Lane 3 (Lane team)
- `ILL` — Innovative Language Learning (work)

## Patterns

### Completing your work on a ticket
1. Post your deliverable/findings as a comment
2. Run `linear handoff <ID> <next-person> "<summary of what was done and what's needed next>"`
3. Never leave a ticket delegated to yourself after completing work

### Creating child tickets
Use `linear subtask <TEAM> "<title>"` with `--parent <ID>` to create sub-issues.

### Reviewing tickets
Use `linear review-queue` and `linear stalled <days>` for triage.
