# Workflow Contract Reference

Detailed reference for the Linear task lifecycle managed by OpenClaw agents.

## Full Task Lifecycle

### Stage 1: Delivery

The connector sends a `[NEW TASK]` message to the assigned agent's session. The message includes:

- Issue ID, title, and description
- Priority level
- Assignee (the receiving agent)
- Any labels or project context

**Agent behavior:** Parse the task. Evaluate whether you can start immediately.

### Stage 2: Acknowledgement

If you can start now:
- Transition the issue to `In Progress` via the base linear skill
- Begin work immediately

If you cannot start now (queue full, blocked, wrong agent):
- Leave in `Todo`
- If wrong agent: comment explaining why and unassign yourself
- If blocked: comment with the blocker

**The status transition IS the acknowledgement.** No comment needed.

### Stage 3: Execution

Active work phase. The issue stays `In Progress`.

**Expected behaviors:**
- Work focused on the task's acceptance criteria
- Comment only with substantive updates (deliverables, blockers, scope changes, decisions)
- If the task takes longer than expected, comment with a revised estimate
- If you need to pause for a higher-priority task, comment why and move back to `Todo`

### Stage 4: Review Submission

When work is complete:
- Attach or link all deliverables in a comment
- Transition to `Needs Review`
- The comment with deliverables should be self-contained — a reviewer shouldn't need to ask what was done

### Stage 5: Completion

A human or designated reviewer evaluates the work:
- If accepted → moved to `Done`
- If changes needed → moved back to `In Progress` with review comments
- Agent addresses feedback and re-submits to `Needs Review`

---

## Anti-Patterns

### Status Theater

**What it looks like:** Moving issues to `In Progress` immediately upon receipt, even when you have 5 other tasks queued. Everything is "in progress," nothing is actually being worked on.

**Why it's bad:** Status loses meaning. Humans can't tell what's actually being worked on.

**Instead:** Only one task `In Progress` at a time. Be honest about your queue.

### Comment Spam

**What it looks like:**
- "Acknowledged!"
- "Looking into this now"
- "Making good progress"
- "Almost done"
- "Done! ✅"

**Why it's bad:** Noise drowns signal. Humans learn to ignore comments, then miss the ones that matter.

**Instead:** Comment when you have information the reader doesn't already have. Status changes communicate progress.

### Premature State Changes

**What it looks like:** Moving to `Needs Review` when the work is 80% done "so someone can start looking at it."

**Why it's bad:** Reviewers waste time on incomplete work. Trust in the `Needs Review` status erodes.

**Instead:** `Needs Review` means "this is ready to evaluate." Not before.

### Silent Drops

**What it looks like:** A task is assigned, the agent acknowledges, then... nothing. No updates, no status change, no completion.

**Why it's bad:** The task falls into a black hole. Nobody knows if it's being worked on, blocked, or forgotten.

**Instead:** If you're stuck, say so. If you can't do it, hand it off. Loud failure > silent failure.

### Premature Self-Closure

**What it looks like:** Agent moves task to `Done` without review.

**Why it's bad:** Bypasses human oversight. Work quality degrades without feedback loops.

**Instead:** Move to `Needs Review`. Let a human close it.

---

## Examples

### Good: Bug Fix Task

```
[Connector delivers task: "Fix login timeout on mobile"]

Agent: (moves to In Progress)
Agent: (investigates, finds the issue in session handling)
Agent: (comments) "Root cause: session TTL was 5min on mobile vs 30min on desktop.
        Fix in commit abc123 — unified to 30min. Tested on iOS and Android simulators."
Agent: (moves to Needs Review)

Reviewer: (verifies fix, moves to Done)
```

### Good: Blocked Task

```
[Connector delivers task: "Update API docs for v3 endpoints"]

Agent: (moves to In Progress)
Agent: (comments) "Blocked: v3 endpoints aren't deployed to staging yet.
        Need @matt to confirm the deploy timeline so I can document actual behavior,
        not just the spec. Moving back to Todo."
Agent: (moves to Todo)
```

### Bad: Everything Wrong

```
[Connector delivers task: "Add export feature to dashboard"]

Agent: (comments) "On it! 🚀"
Agent: (moves to In Progress)
Agent: (comments) "Making progress!"
Agent: (comments) "Almost there..."
Agent: (moves to Done)
Agent: (comments) "Done! Let me know if you need anything else! 😊"

[No deliverable attached. No description of what was built. Self-closed.]
```
