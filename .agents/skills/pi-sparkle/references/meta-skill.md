# Missing Meta-Skill: harness-friction-analyzer

## Gap
No skill ingests multi-project harness reports and proposes **global** fixes.
`scenario-skill-router` has no observability: which skills activated or were
skipped per session is not a persisted fact.

## Observed State
- AIstudy, cengfan, and better-harness each produce local reports; Pi core has
  no `.pi/` self-review harness.
- Better-harness dimensions frequently stay "not observed in this boundary"
  because skill-route and delivery events are not logged (see
  [evidence-loop.md](evidence-loop.md)).
- Negative cases (should-route-but-did-not) are never captured, so a meta-skill
  would currently optimize on success traces only.

## Spec (proposal, not shipped)
A `harness-friction-analyzer` skill should:

1. Read existing report files and `.pi/subagents/runs/*.json` as evidence.
2. Cluster friction by class: skill bloat, agent-not-found, missing route log,
   delivery outside agent context, prompt over/under-fit.
3. Propose **one** durable change (router update, shared skill, or kill a
   duplicate) rather than a new per-project skill.
4. Record `AVAILABLE` / `EXPLICITLY_ACTIVATED` only. Do not persist `USED`.

It must not become a Pi extension, session listener, or auto-promoter
(ADR-006 Proposed; ADR-004 proposal-first).

## Validation
After a real analyzer exists: three projects in, at least one proposed global
fix cites two independent report files, and "not observed" is not filled by
inference.
