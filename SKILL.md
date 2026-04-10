---
name: fancy-openclaw-linear-skill
description: Agent-side workflow contract for tasks delivered by the fancy-openclaw-linear-connector. Defines how agents acknowledge, execute, and complete Linear tasks.
---

# Linear Workflow Contract

This skill defines **how you behave** when you receive a task routed from Linear via the [fancy-openclaw-linear-connector](https://github.com/fancymatthenry/fancy-openclaw-linear-connector). It is not about API calls — the base `linear` skill handles that. This is about workflow discipline.

## Prerequisites

- **Base `linear` skill** installed (provides `linear.sh` for API access)
- **Linear API key** available (see `linear-access` skill)

Use the base skill's scripts for all Linear API calls:

```bash
LINEAR_SCRIPT="{baseDir}/../linear/scripts/linear.sh"
```

## This Skill Is Optional

The connector works without this skill installed. But without it, agents have no shared contract for how to handle tasks — leading to inconsistent status updates, comment spam, and dropped work. Install it.

---

## Task Lifecycle

### 1. Acknowledge Receipt

When you receive a `[NEW TASK]` message from the connector:

- **Immediately** transition the issue from `Todo` → `In Progress`
- Do NOT comment "I'm on it" or "Acknowledged" — the status change IS the acknowledgement
- If you cannot start the task right now (e.g., blocked by another task), leave it in `Todo` and do not acknowledge until you begin

### 2. Do the Work

- Stay in `In Progress` for the duration
- Comment **only** when you have something substantive: a deliverable, a blocker, a decision point, or a question
- If you discover the task is larger than expected, comment with a scope assessment and ask for guidance
- If you need something from a human or another agent, comment with the specific ask and assign/mention them

### 3. Request Review

Move to `Needs Review` when:

- The work is **complete and verifiable** — not "mostly done"
- You've attached or linked all deliverables
- A human or reviewer can evaluate the work without asking you clarifying questions

Do NOT move to `Needs Review` if:

- You're just tired of working on it
- You want feedback on a partial approach (comment instead)
- There are known issues you haven't addressed

### 4. Complete

Only a **human or designated reviewer** moves issues to `Done`. Agents do not self-close unless explicitly told "mark it done" or the task type is pre-approved for self-closure (e.g., automated maintenance tasks).

Exception: if the task description explicitly says "close when complete," you may move to `Done` after delivering.

---

## Comment Hygiene

Comments are for **net-new information only**. Every comment should pass the test: "Would a human reading this learn something they didn't already know?"

### Good Comments

- "Deliverable attached: `report.pdf` — covers Q1 metrics as requested"
- "Blocked: need API credentials for the staging environment. @matt can you provide?"
- "Scope change: the CSV import also needs validation logic. Estimate +2h. Proceed?"
- "Decision: went with approach B (batch processing) because X. See commit abc123."

### Bad Comments

- "Working on this now" (the status change says this)
- "Making progress" (say nothing or say something specific)
- "Done!" (move the status instead)
- "I'll look into this" (just look into it)

---

## Queue Management

When multiple tasks arrive:

1. **Work sequentially** unless tasks are explicitly parallelizable
2. **Priority order:** assigned priority in Linear > order received
3. **Don't acknowledge tasks you can't start** — leave them in `Todo`
4. If your queue is full and a new Urgent/High task arrives, comment on your current task that you're pausing it, move it back to `Todo`, and pick up the urgent one
5. Never have more than **one task In Progress** unless you are genuinely doing parallel work (rare)

---

## Handoff Protocol

### To Another Agent

1. Comment with context: what you've done, what remains, and why you're handing off
2. Unassign yourself
3. Assign the target agent (or leave unassigned if routing to a pool)
4. Move back to `Todo`

### Back to Human

1. Comment with your findings, deliverables, or the reason for handoff
2. Move to `Needs Review` if work is complete, or `Todo` if you're returning it unfinished
3. Assign the human

### Receiving a Handoff

Treat it like a new task. Read the full comment history before starting. Don't re-ask questions that were already answered in the thread.

---

## Failure Handling

### When You're Stuck

1. **Try harder first.** Search, read docs, explore. Don't bail at the first obstacle.
2. If stuck for real: comment with what you tried, what failed, and what you think the blocker is
3. Keep the issue `In Progress` if you're actively debugging; move to `Todo` with a blocker comment if you need external help

### When a Task Is Impossible

1. Comment explaining why the task cannot be completed as specified
2. Suggest alternatives if any exist
3. Move to `Needs Review` so a human can decide next steps
4. Do NOT silently drop or ignore tasks

### When You Made a Mistake

1. Comment immediately with what went wrong
2. If reversible, fix it and note what you did
3. If not reversible, flag it clearly and move to `Needs Review`

---

## Rules Summary

| Rule | Why |
|---|---|
| Status change = acknowledgement | No comment spam |
| One task In Progress at a time | Focus and honesty |
| Comments carry information, not ceremony | Signal over noise |
| Don't self-close issues | Human oversight |
| Hand off with context | Continuity |
| Fail loudly, not silently | Trust |
