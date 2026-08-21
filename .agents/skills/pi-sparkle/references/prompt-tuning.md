# Prompt Optimization Guardrails

## Risks
- **Overfit:** project-specific agents (for example `worker.md` tool lists) copy
  local conventions into a prompt that then fails on the next repo.
- **Underfit:** generic prompts ignore package-level `AGENTS.md` and nested
  instruction files.
- **Static composition:** no add/remove of prompt sections from scenario
  similarity; no versioned A/B for variants.

## Observed State
- cengfan agents (`temp-luna`, `tokenfree-luna`) and better-harness meta-skills
  are project-bound; there is no scenario-similarity router.
- Prompt changes today are manual edits, not candidates on the adaptation plane.

## Guardrails
1. Treat prompts as versioned resources. Live runs must not rewrite the active
   prompt (ADR-004). Propose a candidate; promote only with `adapt promote
   --approve`.
2. Compose from **scenario similarity** (task role, contract risk, instruction
   files present), not from the last session's wording.
3. Prefer dropping unused sections over appending more text. Token bloat is a
   skill-bloat sibling (see [skill-bloat.md](skill-bloat.md)).
4. Never claim a prompt variant "worked" from a single in-loop self-review.

## Fit Checks (when auditing)
- Does this section exist because of evidence in *this* project, or because
  another project needed it?
- Would removing the section change a required behavior, or only tone?
- Is there a package/project `AGENTS.md` that already states the same rule?

## Validation
A later A/B must use held-out tasks. Until Checkpoint F-PROD, do not claim
prompt-routing gains.
