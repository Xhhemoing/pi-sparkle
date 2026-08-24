# Round 2 fable-1

MODEL_SLUG: claude-fable-5-thinking-xhigh

## Implemented (docs only — no src/, no git operations)

- `README.md`
  - §Parent + children: `--children` now correctly described as compiling
    through `compileChildrenToFlowchart` (`src/cli/main.ts:735`) onto the
    flowchart engine (`startFlowchartRun`, `main.ts:751`) with child-protocol
    semantics (`ChildCoordinator`, `src/run/flowchart-run.ts:241`);
    `startParentRun` (`src/run/coordinator.ts:224`) named library/test-only.
  - §Flowchart: "not `--children`" reworded to "the same DAG engine
    `--children` compiles onto"; kept the flags-mutually-exclusive rule.
  - §Project Status: M1 bullet now says `startParentRun` is library/test-only;
    M2.5 bullet's "not compiled into flowchart" replaced with the compile
    truth.
  - Command table: added `answer`, `pause`, `inject`, `episode events|close`,
    `pref`, `delete`, `commits preview|apply`, `auth`, `models`,
    `migrate-legacy`; extended `resume` (`--supervised`/`--unpause`) and
    `doctor` (`--json` frozen `DoctorJsonReport`, `preview: true`,
    `liveAdaptive: false`, "not a production capability" kept). Every row
    matches the dispatcher and `USAGE` in `src/cli/main.ts:204–283`. No
    real-provider Outcome claims added; developer-preview framing untouched.
- `docs/specs/m0-m2-architecture.md` §Milestone names: same `--children`
  compile-to-flowchart honesty, with the correction dated; doctor sentence
  updated — the `--json` contract is now frozen, doctor stays a preview
  capability.
- `docs/status-matrix.md`
  - New runtime rows: `migrate-legacy` (own row; dry-run default, copy-never-
    move, fail-closed on corrupt non-tail JSONL), Provider retry (429/5xx,
    wired **inside `--executor pi` only**, Retry-After/`remedy_hint` caps,
    401/403 never retried, failed-call usage `undefined` never zero), Persist
    file lock (exclusive `wx`, fd leak fixed 2026-08-24, stale locks
    timeout-only by design).
  - New adaptive row: Redaction as transform (wired at `appendFeedback`,
    value-removing + ReDoS-hardened; known limits disclosed: only
    `redacted: boolean` persisted, `pii` class means "pass ran",
    prompt-injection class deliberately unused).
  - R1/bandit/topology row: enforcement note refreshed to the **transitive**
    closure test now on disk (Round 2 in-flight), replacing the stale
    "direct imports of ten files" wording. Wired cell stays
    "shadow / offline only"; F-PROD prohibition unchanged.
  - Nothing marked Outcome-supported; F-PROD and P0 sign-off rows untouched.
- `docs/reports/2026-08-24-sota-r2-architecture.md`: Round 2 re-audit —
  Round 1 closures verified at file:line, in-flight Round 2 test work
  observed, ranked P0/P1/P2 gap list for Round 3.

## Honesty patches (claim → truth, with evidence)

1. "`--children` is not the `--flowchart` engine" (README:85, README:174,
   m0-m2-architecture §Milestone names) → the CLI compiles the spec and runs
   it on the flowchart engine; `startParentRun` is tests-only (consumers:
   `test/integration/m1/parent-run.test.ts`, `test/integration/cluster/
   peer-mailbox.test.ts`, `dynamic-spawn.test.ts`,
   `test/integration/m3/coverage-gate.test.ts`).
2. Seven commands absent from README (`answer`, `pause`, `inject`, `episode`,
   `pref`, `delete`, `commits`) → all documented, plus `auth`/`models` (prose
   only before) and `doctor --json` / `migrate-legacy`.
3. "doctor … not a production capability until its output contract is frozen"
   (spec) → `--json` contract IS frozen (`src/cli/doctor.ts:27–34`); doctor
   remains preview. Both halves now stated.
4. Status-matrix isolation note said "direct imports of ten live files" →
   on-disk test walks the transitive closure with a pinned two-entry
   allowlist (`test/unit/routing/live-isolation.test.ts:40–45, 83–95`).

## Remaining SOTA gaps (for Round 3 — full detail in the R2 report §3)

- **P0-1** `costEligibleInvocations` (`src/telemetry/usage-aggregate.ts:29`)
  unwired: `calibrateCatalogRates` has no `callOutcome` guard
  (`src/routing/cost-calibration.ts:34–47`); legacy/partial usage-bearing
  records still skew rates.
- **P0-2** Delete-cascade holes: `delete --run` leaves the run's rows in
  `runtime/invocations.jsonl` (`src/privacy/deletion.ts:55–66`;
  runId at `src/telemetry/model-invocation.ts:45`); episode `.lock` survives
  (`src/cli/episode.ts:91` vs `deletion.ts:81–89`); cascade strips `body` but
  not free-text `summary` (`deletion.ts:117`; `src/feedback/types.ts:18`;
  filled from `signal.summary` at `src/learning/auto-loop.ts:232`).
- **P0-3** Redaction decision classes computed then dropped at rest
  (`src/feedback/redaction.ts:11–16` vs `src/feedback/store.ts:39–41`).
- **P1** Orphan barrel `src/supervisor/flowchart.ts` (zero importers); bare
  `adapt promote` in USAGE (`src/cli/main.ts:231` vs
  `src/cli/adapt.ts:240–263`); plain `--children` starts contract-less
  (`main.ts:751–767`, gate at `flowchart-run.ts:758–760`, records
  `skipContract: true` at `:781`) — decide derive-or-document;
  real-provider children/track coverage still smoke-only.
- **P2** Fake-backed `auth-session`/`cluster-tools` units; unbounded
  retention of `invocations.jsonl`/episodes; `inspect --json` lacks
  `requiredEvidence`; engines `>=22.19.0` vs 22.14.0 hosts.

## Verification

- Every claim edited into README/spec/matrix traced to a file:line cited
  above; re-checked the dispatcher switch and `USAGE` string against the new
  command table (16 commands, all covered).
- Docs-only changes; no test/typecheck run needed and none of my files feed
  the build. Concurrent slots' uncommitted work (`live-isolation` rewrite,
  `bandit-store` tests, `checkpoint-store` crash tests, `run-tests.mjs`,
  `evidence-invariant`) was read but not modified.

## Blocked / handoff

- `src/cli/main.ts:231` bare `adapt promote` USAGE line — src/ forbidden to
  this slot; one-line fix for an opus slot.
- `src/supervisor/flowchart.ts` delete-or-justify — src/ forbidden.
- P0-1/P0-2/P0-3 above are code changes — Round 3 implementation slots.
- Constraints held: no Outcome-supported claims, live R1 stays off,
  ADR-006 stays Proposed, F-PROD/P0 sign-off untouched, no git operations.
