# Connector Integration Reference

How this skill relates to the [fancy-openclaw-linear-connector](https://github.com/fancymatthenry/fancy-openclaw-linear-connector) service.

## Architecture

```
Linear workspace
    │
    ├─ webhook event (issue created/updated/assigned)
    ▼
fancy-openclaw-linear-connector (service)
    │
    ├─ filters, routes, formats
    ▼
OpenClaw agent session
    │
    ├─ this skill (workflow behavior)
    ├─ base linear skill (API calls)
    ▼
Agent does the work, updates Linear
```

## What the Connector Sends

The connector delivers task messages to agent sessions. The standard format is:

```
[NEW TASK] <issue-title>

Issue: <issue-id>
Priority: <urgent|high|medium|low|none>
Project: <project-name>
Labels: <label-list>

<issue-description>
```

The connector may also send:

- **Task updates** when an issue is modified after delivery (description changed, priority escalated)
- **Reassignment notices** when a task is moved to a different agent
- **Cancellation notices** when an issue is cancelled or deleted

## What the Agent Does in Response

| Connector Event | Agent Response |
|---|---|
| `[NEW TASK]` | Evaluate priority, start or queue, update status |
| Task update | Re-read description, adjust approach if needed |
| Reassignment (incoming) | Treat as new task, read comment history first |
| Reassignment (outgoing) | Stop work, no further action needed |
| Cancellation | Stop work, clean up any in-progress artifacts |

## Independence Contract

This skill and the connector are **independent components**:

- The **connector works without this skill.** It will deliver tasks regardless of whether agents know the workflow contract. Agents just won't have shared behavioral standards.
- **This skill works without the connector.** If tasks arrive through other means (manual assignment, other integrations), the workflow contract still applies. The contract is about behavior, not delivery mechanism.
- **Neither depends on the other's version.** The connector's message format is simple and stable. This skill's behavioral rules don't change based on connector features.

## Configuration

This skill has no configuration. It is a behavioral contract, not a software integration.

The **base `linear` skill** must be configured with API access for the agent to act on Linear issues (status changes, comments, assignments). See the `linear-access` skill for setup.

## Using the Base Linear Skill

All Linear API operations should go through the base skill's scripts:

```bash
# Reference pattern (resolved at runtime)
LINEAR_SCRIPT="{baseDir}/../linear/scripts/linear.sh"

# Status transitions
$LINEAR_SCRIPT update-status <issue-id> "In Progress"
$LINEAR_SCRIPT update-status <issue-id> "Needs Review"

# Comments
$LINEAR_SCRIPT comment <issue-id> "Deliverable attached: see commit abc123"

# Assignment
$LINEAR_SCRIPT assign <issue-id> <user-id>
$LINEAR_SCRIPT unassign <issue-id>
```

This skill does not introduce new scripts. It defines *when* and *why* to call the existing ones.
