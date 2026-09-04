# Real-provider dogfood acceptance — xhh relay (2026-09-04)

Scope: exercise the `--executor pi` path against a real provider (the `xhh`
relay) as the multi-agent method for closing preview gaps, and record what
happened. This upgrades real-provider evidence from "opt-in smoke, once" to
"three orchestrated multi-agent rounds on record". It does **not** make
anything Outcome-supported (that bar stays at Checkpoint F-PROD, ADR-005).

## What ran

| Round | Model (xhh) | Role | Parent run | Outcome |
|---|---|---|---|---|
| Smoke | claude-fable-5 | 1-node flowchart, pinned `modelPolicy` | `run_6aa81104-…` | COMPLETED |
| R1 propose | claude-fable-5 | 3 parallel children (F6 / retention / audit) | `run_96745e08-…` | COMPLETED, all PASSED |
| R2 challenge | gpt-5.6-sol | adversarial review of R1 | `run_b620a0a0-…` | COMPLETED, PASSED |
| R3 synthesis | kimi-k3 | final F6 decision package | (events archived) | COMPLETED, PASSED |

Deliverables: `docs/reports/2026-09-04-f6-holdout-decision-package.md`;
working files in `.agent_workspace/dogfood/` (prompts, raw summaries,
host adjudication).

## What the loop produced (verified by the host, not assumed)

- **Six status-matrix cells truthed-up** (commit `docs(matrix): truth-up six
  drifted cells`): Pi pin 0.84.3→0.84.4; migrate-legacy, cost-calibration,
  provider-retry, doctor rows gained integration citations. One suspected
  drift (`run --thinking` loopback) was checked and **refuted** — the matrix
  stood.
- **Four retention contract tests** added (commit `test(privacy): pin four
  retention contracts`): concurrent-append survival, residual episode-text
  disclosure via retain, held-lock LOCK_TIMEOUT, mtime fallback pinning.
- **F6 holdout decision package** landed as a proposal with five owner
  questions; the adversarial round's valid critiques (arm contamination,
  episode-unit ambiguity, missing power numerics, seal≠confidentiality,
  tokens≠billed cost, grep≠provenance, freeze-scope) are absorbed into the
  design.

## Honest limits observed (product findings, not waived)

1. **Deliverable transport**: agent prose is not persisted by the runtime;
   `TASK_RESULT.summary` via `sparkle_report_task_result` is the only
   durable channel, and its tool description says "one line". Long-form
   child deliverables ride a field documented as short. Works today
   (length is not schema-enforced) but is a contract smell worth an ADR.
2. **Children-path model pinning**: `--children` has no per-task model
   pinning; `assignedModel` is planner-internal. This loop pinned models by
   disabling all but one catalog entry per round. `--flowchart` node
   `modelPolicy` allows exact pinning but does not persist agent text
   (finding 1). A documented per-task model field on the children spec
   would remove the workaround.
3. **Default per-task timeout is 60 s** (`children-spec` limits default);
   real analysis tasks need explicit `limits.timeoutMs`. The first R1
   attempt failed 3/3 on this — recorded as run `run_2425359a-…` (FAILED,
   retried successfully with raised limits).
4. **Cost stays unobserved for xhh**: the three models are unpriced in the
   catalog, so no cost calibration data accrued. The F6 package's §2.8
   makes a billing source a Week-0 prerequisite.

## Reproduction

Per round: enable exactly one xhh model
(`pnpm cli models disable … / enable … / set-default --primary … --fast …`),
then `pnpm cli run --project . --objective <round> --children
.agent_workspace/dogfood/rN-*.json --executor pi`. Extract deliverables from
the parent run's `CHILD_MESSAGE` `TASK_RESULT` events.
