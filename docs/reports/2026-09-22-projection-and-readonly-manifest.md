# Projection hardening and read-only manifest — verification record

## Identity

- Date/environment: 2026-09-22, Windows worktree `E:\Project\pi-sparkle`
- Status: **author-run engineering slices; Stage 0, pilot, and production apply remain open**

## Completed in this session

- Native delegate catalog ordering keeps an equal-cost assignment on the explicit model. Corrected-source run `run_ab1bfcb6-4172-4630-8627-6a5ea0ab28c5` routed to `xhh-luna/gpt-5.6-luna-fast`. Its child did not persist a verdict.
- Observation projection now uses the observation-store opaque id as the send-counter key. A middle-only mutation gets a fresh first-two window and a distinct ref.
- Missing or unsafe projectability metadata is not packed. Disabled projection still writes no archive.
- Recall enforces a run-local call/page/byte budget and returns a typed refusal without the archived page text.
- Mechanism counters record repeat mass, projection bytes, placeholder bytes, recall refusals, and storage-unavailable count.
- `src/experiments/readonly-evaluator-manifest.ts` validates the read-only A/B/C manifest, refuses evaluator writes and canonical-byte drift, and emits `INVALID_COLLECTION` ledger rows. It does not freeze or approve a manifest.

## Not completed — external gates

- Stage 0 independent review and owner/evaluator freeze. The agent cannot supply either.
- A completed independent Stage 0 verdict. The corrected routing attempt stopped before `sparkle_report_task_result` persisted a verdict.
- Exploratory A/B/C pilot. It requires the Stage 0 freeze, a frozen manifest, and owner budget/data approval.
- Stage 1 production apply authorization and worker-write registration.
- Checkpoint F, F6, holdout sealing, and Outcome-supported claims.
- These external gates were subsequently rerun after the follow-up corrections; the current evidence is recorded below.

## Verification

| Command | Result |
|---|---|
| `pnpm exec tsc -p tsconfig.json --noEmit` | PASS |
| `pnpm exec tsx --test test/unit/pi-adapter/observation-tools.test.ts test/unit/native/session.test.ts test/unit/experiments/readonly-evaluator-manifest.test.ts test/unit/routing/live-isolation.test.ts` | 28 pass / 0 fail |
| `pnpm gate` | 2850 pass / 0 fail / 18 skip; workflow, typecheck, lint, and build included |

## Author review corrections

The same-session author review is not independent review. It found and fixed three local defects before the gate:

- Recall budget refusal now happens before `ObservationStore.recall`. The byte check uses the reference byte length and page cap, so an over-budget page is not read in order to be rejected.
- Disabled projection returns before constructing the observation store, so it creates no archive directory.
- The native read wrapper marks thrown read errors as non-projectable error results and rethrows them. Successful reads remain the only projectable path.

No Stage 0 approval, manifest freeze, pilot authorization, or production apply authorization is claimed.

## Follow-up verification and correction (2026-09-22, current session)

The test-first follow-up found two fail-closed gaps. First, the adapter called
`ObservationStore.put` before checking the projection eligibility threshold.
Small, error, receipt, and unsafe results were not packed, but they could still
create archive directories/objects. The projector now checks
`isObservationEligible` before storing and reuses the exact-byte ref for the
projection step. Second, `ObservationStore.put` failures escaped the live
adapter instead of returning the documented full-result fallback; the adapter
now returns the original text and increments `storageUnavailable`. Recall
budgets are validated as positive safe integers at construction. The manifest
ledger validator also compares loaded-policy canonical bytes in addition to the
routing snapshot bytes, rejects observed routing data when routing is disabled,
and validates opaque task-set and repository references. Malformed common/arm
fields and unknown fields are rejected before collection; mismatches now return
`INVALID_COLLECTION` or manifest validation refusal.

RED/GREEN evidence:

- `pnpm exec tsx --test test/unit/pi-adapter/observation-tools.test.ts` — RED on the
  new no-archive assertion (7 pass / 1 fail), demonstrating the pre-fix write.
- The same focused test after the first fix — 8 pass / 0 fail.
- The storage-fallback, invalid-budget, disabled-routing, opaque-reference,
  malformed-manifest, unknown-field, nested-budget, retry-policy,
  repository-revision-field, optional-model-version, and canonical-JSON
  regressions ran in the combined focused set — 35 pass / 0 fail:
  `pnpm exec tsx --test test/unit/native/routing-catalog.test.ts test/unit/native/session.test.ts test/unit/pi-adapter/observation-tools.test.ts test/unit/experiments/readonly-evaluator-manifest.test.ts test/unit/context/observation-projection.test.ts`.

Fresh delivery checks:

- `pnpm gate` — 2858 pass / 0 fail / 18 skip; build completed after the
  canonical-JSON follow-up.
- `pnpm lint` — PASS.
- `pnpm security:probe` — status `ok`, 26 passed, 0 open findings.
- `pnpm pi:probe` — PASS; agent-core/ai pinned at 0.86.1 and legacy adapter probes clear.
- `pnpm workflow:check`, targeted documentation check, and `git diff --check` — PASS.

The independent two-role review dispatch `run_ee7843e3-5890-4aea-b5b1-54efdc54df4b`
failed with `no actionable model-project issue`; acceptance remains `UNOBSERVED`.
A subsequent scoped review dispatch `run_be4facfd-142d-4e0f-892b-d6f9c21d2d17`
using the explicitly designated `xhh-luna/gpt-5.6-luna-fast` channel failed with
the same result; it is also `UNOBSERVED` and is not independent verification.
A final gate-review dispatch `run_0735283f-00e9-44cc-97f4-0550da23062b`
through the same designated channel failed with `no actionable model-project
issue`; acceptance remains `UNOBSERVED`.
This is not independent verification and does not close Stage 0. A subsequent
fail-closed routing pin added `AgentExecutor.supportedModelIds`, with a focused
native regression proving unsupported learned reassignment is rejected before
run persistence.

## Final gate sweep (2026-09-22)

Local/repository gates were attempted and closed where the author-run command is
authorized to establish them:

- `pnpm prerelease` — PASS: preview-release probe, workflow check, typecheck,
  lint, full test/build gate (2858 pass / 0 fail / 18 skip), security probe
  (26 passed / 0 open findings), and Pi compatibility probe (0.86.1 pins).
- `pnpm workflow:check` — PASS.
- `node .agent_workspace/evidence-first-reconciliation/check-docs.mjs` — PASS.
- `git diff --check` — PASS, with the existing CRLF conversion warning for
  `src/execution/contract.ts`.

The following gates were attempted or assessed but cannot be closed by this
model's author-run evidence:

- Stage 0 independent review — **UNOBSERVED** after the failed dispatches above;
  no PASS verdict was obtained.
- Stage 0 owner/evaluator approval and freeze — **OPEN / NOT AUTHORIZED**.
- Projection hardening acceptance — implementation locally verified, but the
  independent-review and owner/evaluator prerequisites remain open.
- Read-only evaluator manifest freeze — validator exists and is locally tested,
  but the manifest remains a draft and no freeze record was created.
- Exploratory A/B/C pilot — **NOT AUTHORIZED**; no live calls were made.
- Production apply / worker-write registration — **OPEN / NOT AUTHORIZED**;
  the handle-only host surface remains non-production-authorized and worker
  write tools remain unregistered.
- F6 holdout / Checkpoint F-PROD / Outcome-supported claims — **OPEN**; no
  holdout seal, live collection, or outcome claim was created.
- Migration execution — not run with `--apply`; no state migration was
  authorized in this sweep.

No gate was marked closed from a failed relay, local green tests, or this
model's own implementation authorship. The working tree
also contains pre-existing untracked `nul` and `pelican-bike.html`; they were
inspected and preserved, not treated as product changes or deleted.

## Projection secret-boundary correction (2026-09-25)

The live read wrapper previously supplied `secretBearing: false` itself. That
made projectability depend on an unverified caller assertion: `.env`,
credential files, private-key files, or large read results containing a
recognized token could enter the observation archive. The projector now owns
that decision. It validates the original read parameters, applies a
credential-like path policy, and reuses the shared secret detector on the full
returned text before `ObservationStore.put`. Missing or malformed read
parameters fail closed. The wrapper forwards its original parameters and no
longer declares content safe.

Recall exhaustion now throws `RecallBudgetExceededError` with a stable
`RECALL_BUDGET_EXHAUSTED` code and a structured receipt containing run/ref,
dimension, observed value, limit, and offset. Its message remains compatible
with the earlier human-readable refusal and never includes archived content.

RED evidence: the focused projector test failed to load the new structured
error export before implementation. GREEN evidence and the native loopback
that repeats `.env.production` three times are recorded in
[the dated verification record](2026-09-25-projection-secret-boundary.md).
Stage 0 freeze, persistent mechanism/economic telemetry, provider-token
measurement, source-mutation/delete/resume coverage, multi-provider prefix
capture, pilot authorization, and live-provider evidence remain open.
