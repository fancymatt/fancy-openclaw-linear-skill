# Connector Integration Reference

`fancy-openclaw-linear-skill` is self-contained and useful without the connector.
When paired with `fancy-openclaw-linear-connector`, the split of responsibility is:

- **connector**: receives Linear events, routes work, manages queueing/recovery
- **skill**: gives agents the commands and workflow rules needed to act on Linear safely

## Paired architecture

```text
Linear → fancy-openclaw-linear-connector → OpenClaw agent runtime
                                         ↓
                           fancy-openclaw-linear-skill
```

## Important boundary

This skill does **not** require the connector.
The connector does **not** require this skill.
But together they give a better end-to-end system:
- tasks arrive automatically
- agents have a common CLI and workflow contract
- handoffs and status behavior are more consistent

## Typical paired flow

1. Connector delivers a task to an agent
2. Agent uses this skill to inspect the issue
3. Agent updates status, comments, attachments, and handoffs through this skill
4. Connector continues to manage delivery/recovery concerns outside the skill boundary

## What changed from the old model

This repo no longer assumes a separate legacy internal `linear` skill for API access.
This repo is the Linear skill.
