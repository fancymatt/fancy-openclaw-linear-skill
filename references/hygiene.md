# Linear Hygiene Rules

## Non-negotiables

- No orphan tickets. Attach issues to a project whenever possible.
- `Needs Review` requires reassignment to a reviewer.
- `Done` means merged, verified, and complete, not just drafted.
- Blocking direction must be stated explicitly.
- Read the full comment history before acting.

## Safe defaults

- Use `linear handoff` instead of manually sequencing comment + reassign + status update.
- Use `linear comments <ID>` to read oldest-first.
- Use `linear block <ID> --blocked-by <OTHER>` for dependencies.
- Prefer exact state names or `linear status <ID> review` with dynamic team-state resolution.

## Done gate reminder

Do not move technical work to Done unless the branch, PR, CI, and acceptance criteria have all been verified.
