# fancy-openclaw-linear-skill

Agent-side workflow contract for tasks delivered by the [fancy-openclaw-linear-connector](https://github.com/fancymatt/fancy-openclaw-linear-connector).

## What This Is

An Agent Skill that teaches OpenClaw agents how to behave when they receive Linear tasks routed by the connector. It defines the workflow contract: acknowledgement, status transitions, comment discipline, queue management, handoffs, and failure handling.

## How It Fits Together

```
Linear (webhook) → fancy-openclaw-linear-connector → OpenClaw agent
                                                        ↓
                                                  this skill (behavior)
                                                        +
                                                  linear skill (API access)
```

- **Connector** handles ingestion and routing — it delivers tasks to agents
- **This skill** defines how agents should behave when they receive those tasks
- **Base `linear` skill** provides the low-level API scripts (`linear.sh`) for status changes, comments, etc.

This skill is **optional** — the connector works without it. But without a shared workflow contract, agents behave inconsistently.

## Install

Copy or symlink to your skills directory:

```bash
# Per-agent install
cp -r fancy-openclaw-linear-skill ~/.openclaw/workspace/skills/

# Org-wide install (all agents)
cp -r fancy-openclaw-linear-skill ~/.openclaw/shared/skills/
```

The base `linear` skill must also be installed.

## Reference Docs

- [`references/workflow-contract.md`](references/workflow-contract.md) — detailed lifecycle, anti-patterns, examples
- [`references/connector-integration.md`](references/connector-integration.md) — how the connector and skill interact

## License

MIT — see [LICENSE](LICENSE).
