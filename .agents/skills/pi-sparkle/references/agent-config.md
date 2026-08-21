# Agent Config Drift

## Detection Signals
- Subagent run JSON in `.pi/subagents/runs/` with `failed` / `Unknown agent: <name>`
- Project agents listed in a prompt or spawn table that do not exist in the
  current checkout
- Tool allowlists that differ across copies of the same role (for example
  `worker.md`)

## Observed Failures
- `Unknown agent: tokenfree-luna` — the agent existed in cengfan, not in the
  spawn registry the parent used.
- `Unknown agent: general-purpose` — local pi-sparkle subagent runs
  (`msu84tlk`, `msu85blr`). The name comes from skills such as
  `requesting-code-review`. The dispatch contract refuses it on purpose;
  do not add a `general-purpose` profile to silence the error. Route reviews
  to `reviewer`.
- Global `~/.agents/skills` and project agent files drift independently; there
  is no prune or drift check at session start.

## Audit Steps
1. Collect unique agent names from recent `.pi/subagents/runs/*.json`.
2. Resolve each name against the project's agent directory and Pi's loaded
   profiles. Record **missing** names; do not invent replacements.
3. Compare tool allowlists for the same role across projects. Differences are
   drift candidates, not automatic merges.
4. If a parent still routes to a missing agent, the durable fix is to update
   the spawn table or restore the agent file — not to add a new skill.

## Enforcement (proposal)
- Fail closed on unknown agent names at spawn time (already observed as
  subagent failures; make it a preflight).
- Keep tool allowlists in versioned files; do not widen them from a successful
  run.
- Installing this package does not grant credential, permission, or
  allowlist edits (ADR-006).

## Validation
After a drift check: zero `Unknown agent` in a fresh project session that uses
only declared profiles, or an explicit skip with the missing name recorded.
