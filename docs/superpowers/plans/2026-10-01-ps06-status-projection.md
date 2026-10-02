# PS-06 slice 1: run status and recovery projection (`inspect --run --status-json`)

Task: `TASK-20261001-ps06-status-projection`. Date: 2026-10-01.
Owner: implementation agent; independent review remains a separate open gate.
State: ready-for-review; implementation and author-run gates verified, independent review and merge open.
Baseline: main `cd47a753c88cb5364f036eb3dda64d0f13772321` (PR #51 merged; includes PS-01, PS-02 and the bounded PS-05 classifier). Continuation verification date: 2026-10-02.

## Problem and Scope

### Problem

PS-06's acceptance asks for a projection of progress, satisfied/unmet criteria, current blockers, known/unknown cost, candidate position, and safe next steps — all rebuildable from existing events and artifacts, with missing/truncated data displayed explicitly and errors never disguised as "no data". Today `inspectRun` reconstructs children, questions, blockers and the evidence gap, but nothing aggregates per-child verification into a run-level picture, cost is not surfaced at all (the invocation log is never consulted by `inspect`), a truncated event-log tail is warned on stderr but absent from machine-readable output, and the frozen `INSPECT_SUMMARY` (four keys) deliberately stays minimal. The plan defers an independent Web UI; the CLI panel comes first.

### In scope

- New pure library module `src/run/projection.ts` (host-independent, no I/O):
  - `buildRunStatusProjection(RunStatusProjectionInput)` consumes runId, replayed status, existing `ChildInspection[]`, events, optional validated invocations/questions/evidence, and read-recovery flags. Outputs child outcome + explicitly child-reported verification/criteria, outcome counts (including PARTIAL/CANCELLED), missing-verification and missing-criteria counts, current blockers and advisory next steps. Outcome success and verification unknown may overlap; neither proves independent acceptance. Cost reuses `sumUsage` and reports only this run's observed eligible tokens and fully priced USD subset, with exclusions/gaps counted. Event/telemetry torn tails have separate flags. No model percent-complete, bill/settlement, or new terminal state is inferred. Current BLOCKED → inspect/inject/unblock/conditional resume; pending child question → answer; PAUSED → resume --unpause; terminal/no-remedy → empty steps. Clarification-only waiting is not a child question and gets no guessed answer command.
- Additive CLI flag `inspect --run --status-json`: prints exactly one `RUN_STATUS_PROJECTION` object on stdout (mutually exclusive with `--json`, `--summary-json`, `--follow` under the same refusal pattern). The object is **not** a domain Event; it is a second frozen-additive surface with its own contract keys pinned in tests from day one.
- Reads the shared invocation log through `readInvocationRecords` + `isInvocation` using inspection byte/record limits. Only the requested run's rows contribute. Missing log → `cost.invocationsAvailable: false`; existing empty file → true. Undefined token/USD totals are omitted in JSON, never fabricated as zero. Corruption/invalid rows/non-ENOENT I/O errors fail the command rather than produce a projection. File presence is advisory; there is no atomic cross-log snapshot.
- `warnTruncatedJsonl` stays on stderr; the machine-readable object additionally carries the flag.

### Out of scope

- No change to the frozen four-key `INSPECT_SUMMARY`, the `Event` union, `RunStatus`, event validation, or any persisted schema. `--json` output is untouched.
- No candidate position in this slice (worktree/apply candidates live outside the run event log; a later slice may add an opt-in lookup).
- No Web UI, no live provider runs, no budget enforcement, no writes of any kind. `inspect` stays read-only.
- B2/S0-min dependent host wiring and independent acceptance stay open, as everywhere else.

## Acceptance Criteria

- [x] Mixed existing `ChildInspection` terminal records retain verification/criteria and explicit missing-criteria state. SUCCESS counts outcomes only; `unobserved` can overlap, and `verificationSource` does not imply host acceptance. Unit and CLI pin tests verified 2026-10-02.
- [x] Blocked/pending/paused commands use existing verbs; stale historical gates and terminal/no-remedy states yield no recovery commands. Unit/CLI tests verified 2026-10-02.
- [x] Own-run eligible token totals and fully priced USD subset stay distinct from missing usage/prices, excluded outcomes, and missing files. Unit/CLI tests verified 2026-10-02.
- [x] Separate event and invocation tail flags accompany stderr warnings; stdout is one JSON object and bytes are unchanged. CLI test verified 2026-10-02.
- [x] Old four-key summary, NDJSON and refusal behavior preserved; new flags and nested keys pinned. Existing summary tests and new CLI tests verified 2026-10-02.
- [x] Focused tests, typecheck, lint, full `pnpm gate`: 3257 tests / 3238 pass / 0 fail / 19 skip; build PASS. Security probe 26 PASS, Pi probe four PASS (2026-10-02). Existing summary assertions unchanged. Independent review remains separate and unobserved.

## Implementation Slice

| File/symbol | Change | Owner | Dependency/risk |
|---|---|---|---|
| `test/unit/run/status-projection.test.ts` (new) | RED: pure projection semantics (rollup, blockers, cost split, truncation, next steps) | implementation agent | none; RED on current code |
| `src/run/projection.ts` (new) | `RunStatusProjection`, `buildRunStatusProjection` | implementation agent | pure; consumes existing types only |
| `src/cli/main.ts` | `inspect --status-json` flag + printing + refusals | implementation agent | same handler; additive |
| `test/integration/cli/status-projection.test.ts` (new) | End-to-end over `main()` with synthetic runs | implementation agent | mirrors `inspect-summary.test.ts` pattern |
| `README.md`, `docs/data-dictionary.md`, `docs/status-matrix.md`, `tasks/plan.md`, `tasks/todo.md`, `tasks/report-execution-todo.md`, `docs/reports/2026-10-02-ps06-status-projection.md` | Contract, scope, command evidence and open review/human gates | implementation agent | after GREEN |

## Test-First Plan

- Red test: `test/unit/run/status-projection.test.ts` — expected RED (module missing) on current code.
- Focused command: `node scripts/run-tests.mjs test/unit/run test/integration/cli/status-projection.test.ts`
- Integration/acceptance command: full `pnpm test`, then `pnpm gate`.
- Negative and recovery cases: truncated tail, missing invocation log, unattributed/not-ok rows, no-remedy states, mutual-exclusion refusals.

## Gates and Handoff

- Human/policy gate: none closed; independent review open; frozen-contract additions pinned by tests in the same diff.
- Rollback or abort condition: a frozen-contract conflict with the four-key summary pins, or regression outside the new surfaces — stop and reconcile.
- Required durable records: this plan, RED commit, GREEN commit, evidence report, data-dictionary + status-matrix + checklist rows.
- Next command after handoff: re-dispatch independent review against `6d45d59` or its documentation-only successor; keep merge pending that review.

## CLI-boundary correction (before delivery)

Root cause of the failing absent-log regression: `readJsonlObjectsFromOffset` returns an empty read when `openExisting` returns undefined; `readInvocationRecords` therefore does not throw ENOENT. The draft also swallowed corruption, did not filter runId, and passed `ChildInspection` to a structurally different projection input, dropping `terminalResult.verification`. These are implementation defects, not reasons to weaken tests.

Additional acceptance and exact files:
- `src/run/projection.ts` consumes existing `ChildInspection` including terminal criteria. Reports are explicitly child reports, never independent acceptance; absent criteria stay unknown. Terminal states and cleared historical blocks get no unblock/answer advice; actual pending questions use existing `answer` without the clarification-only caveat.
- `src/cli/main.ts` distinguishes absent vs empty invocation files before reading; corruption, invalid rows and I/O failures remain command errors. Only requested-run rows contribute; foreign rows never leak cost. Event and telemetry torn tails are separate flags. Existing --summary-json refusal strings remain unchanged.
- Tests in `test/unit/run/status-projection.test.ts` and `test/integration/cli/status-projection.test.ts` cover these boundaries before correction, plus exact JSON keys, read-only bytes, meaningful child/criteria wiring, and foreign-run isolation.
- `src/telemetry/invocation-log.ts::readInvocationRecords` gains optional maxBytes/maxRecords arguments forwarded to the existing JSONL reader (existing callers unchanged). Projection uses actual read limits, not only a pre-read stat size check; limit regression fails with "Missing expected rejection" before the change.
- `src/run/inspection.ts::inspectRunEvents` extracts the existing reducer without changing it; `--status-json` uses the already-read event snapshot once (no second read mixing child/progress state with an older block/recovery snapshot).
- Cost reuses `sumUsage` and reports partial priced USD only for fully known token counts and both recorded rates. Unknown-price/usage and non-ok/unattributed rows remain counted. This is neither a bill total nor parent/child settlement (PS-04 stays open).
- Verify: `node scripts/run-tests.mjs test/unit/run/status-projection.test.ts test/integration/cli/status-projection.test.ts test/integration/cli/inspect-summary.test.ts`, then `pnpm gate`, `pnpm security:probe`, `pnpm pi:probe`, `pnpm workflow:check`. Keep raw outputs under `.agent_workspace/ps06/`.

## Upstream reconciliation (2026-10-02)

Final fetch found PR #52 advanced origin/main to `ab2f11394b46295182ac23185b2c5841c4d7788f` (preview.2 metadata/docs and evaluation binding snapshots). Preserve all upstream changes; merge into this feature branch only if conflict-free, then rerun focused tests, `pnpm gate`, security/Pi probes and workflow check. No preview tag, independent acceptance or main merge follows. Exact resulting revision and outcomes go in the verification record. Dependencies did not change; no lockfile regeneration is needed.

## Closeout

- Verified initial source: `e0affe57289fa9fd640575ef21ef23be0c0607ad`, 2026-10-02. Latest combined source: `6d45d59bfeccff0e873d4c04bb1d4a9a0ef93a01`, preserving upstream PR #52 without conflicts.
- Latest commands: focused 37/0/0; unchanged-source full gate rerun 3239/0/19 and build PASS; security 26 PASS; Pi four PASS. The preceding gate attempt timed out and exited 3221225794 after passing assertions; it did not build and is recorded as failure. No process-failure fix is claimed.
- Open risks/follow-ups: independent review dispatch failed HTTP 403 (no verdict); no merge or outcome support. Candidate position/Web UI deferred; advisory strings need re-review if CLI recovery semantics change. Cost is not complete billing; no cross-log atomic snapshot.
- Evidence: [verification record](../../reports/2026-10-02-ps06-status-projection.md).
