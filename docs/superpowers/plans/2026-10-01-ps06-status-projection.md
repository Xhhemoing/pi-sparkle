# PS-06 slice 1: run status and recovery projection (`inspect --run --status-json`)

Task: `TASK-20261001-ps06-status-projection`. Date: 2026-10-01.
Owner: implementation agent; independent review remains a separate open gate.
State: planned, before runtime edits.
Baseline: main `cd47a753c88cb5364f036eb3dda64d0f13772321` (PR #51 merged; includes PS-01/PS-02/PS-06-precursor lines).

## Problem and Scope

### Problem

PS-06's acceptance asks for a projection of progress, satisfied/unmet criteria, current blockers, known/unknown cost, candidate position, and safe next steps — all rebuildable from existing events and artifacts, with missing/truncated data displayed explicitly and errors never disguised as "no data". Today `inspectRun` reconstructs children, questions, blockers and the evidence gap, but nothing aggregates per-child verification into a run-level picture, cost is not surfaced at all (the invocation log is never consulted by `inspect`), a truncated event-log tail is warned on stderr but absent from machine-readable output, and the frozen `INSPECT_SUMMARY` (four keys) deliberately stays minimal. The plan defers an independent Web UI; the CLI panel comes first.

### In scope

- New pure library module `src/run/projection.ts` (host-independent, no I/O):
  - `buildRunStatusProjection(input: { inspection, run?, events, invocations?, truncated })` → `RunStatusProjection` with: per-child `{ taskId, outcome, verification: PASSED/FAILED/UNOBSERVED, unmetCriteria }`; run-level rollup `{ total, succeeded, failed, unobserved, inFlight }` (UNOBSERVED counted separately, never folded into success); blockers from `gateBlockCause` + `pendingQuestions` + `requiredEvidence`; cost split `known` / `unknown` (sum of cost-eligible invocation `tokensIn`/`tokensOut` and derived USD from `pricing` when present; `unknown` counts excluded not-ok, unattributed, and missing-usage rows — "no data" never prints as zero); `dataQuality: { truncated: boolean }` from the actual read recovery; and `safeNextSteps` restricted to verbs that exist, one per blocker class, aligned with the exact routed lines `formatBlockedRunReport` already prints (inspect → inject → unblock(+retry-node) → resume; `answer` for pending questions with its cannot-continue caveat; resume `--unpause` for PAUSED). No terminal status is invented; a model's "percent complete" is never accepted — progress counts only derive from recorded outcomes.
- Additive CLI flag `inspect --run --status-json`: prints exactly one `RUN_STATUS_PROJECTION` object on stdout (mutually exclusive with `--json`, `--summary-json`, `--follow` under the same refusal pattern). The object is **not** a domain Event; it is a second frozen-additive surface with its own contract keys pinned in tests from day one.
- Reads the invocation log through the single validated reader (`readInvocationRecords` + `isInvocation`), filtering by the run's own `runId` only. Missing invocation log (ENOENT) projects `cost: known 0 rows / unknown 0` with `dataQuality.invocationsAvailable: false` — explicit, not disguised.
- `warnTruncatedJsonl` stays on stderr; the machine-readable object additionally carries the flag.

### Out of scope

- No change to the frozen four-key `INSPECT_SUMMARY`, the `Event` union, `RunStatus`, event validation, or any persisted schema. `--json` output is untouched.
- No candidate position in this slice (worktree/apply candidates live outside the run event log; a later slice may add an opt-in lookup).
- No Web UI, no live provider runs, no budget enforcement, no writes of any kind. `inspect` stays read-only.
- B2/S0-min dependent host wiring and independent acceptance stay open, as everywhere else.

## Acceptance Criteria

- [ ] A synthetic run with mixed child outcomes projects per-child verification states and a rollup where UNOBSERVED is its own count; a PASSED child without per-criterion data shows `unmetCriteria` honestly as UNOBSERVED, never "met".
- [ ] Blocked/pending/paused runs produce exactly the `safeNextSteps` the existing routed lines produce for those states; no invented verbs; nothing prints for states with no remedy.
- [ ] Cost splits known vs unknown: only cost-eligible rows with reported usage contribute to known tokens; excluded rows count into `unknown` with reasons; absent invocation log is explicit (`invocationsAvailable: false`), never zero-cost.
- [ ] A crash-truncated tail sets `dataQuality.truncated: true` in the object while stderr keeps the existing warning; output remains exactly one JSON object.
- [ ] Frozen four-key `INSPECT_SUMMARY` pins unchanged; `--json` NDJSON untouched; flag mutual-exclusion refusals match the existing `inspect` error style.
- [ ] Focused unit + integration suites, typecheck, lint, full `pnpm gate` green; no existing assertion weakened.

## Implementation Slice

| File/symbol | Change | Owner | Dependency/risk |
|---|---|---|---|
| `test/unit/run/status-projection.test.ts` (new) | RED: pure projection semantics (rollup, blockers, cost split, truncation, next steps) | implementation agent | none; RED on current code |
| `src/run/projection.ts` (new) | `RunStatusProjection`, `buildRunStatusProjection` | implementation agent | pure; consumes existing types only |
| `src/cli/main.ts` | `inspect --status-json` flag + printing + refusals | implementation agent | same handler; additive |
| `test/integration/cli/status-projection.test.ts` (new) | End-to-end over `main()` with synthetic runs | implementation agent | mirrors `inspect-summary.test.ts` pattern |
| `docs/data-dictionary.md`, status-matrix row, checklist, evidence report | Contract keys + closeout records | implementation agent | after GREEN |

## Test-First Plan

- Red test: `test/unit/run/status-projection.test.ts` — expected RED (module missing) on current code.
- Focused command: `node scripts/run-tests.mjs test/unit/run test/integration/cli/status-projection.test.ts`
- Integration/acceptance command: full `pnpm test`, then `pnpm gate`.
- Negative and recovery cases: truncated tail, missing invocation log, unattributed/not-ok rows, no-remedy states, mutual-exclusion refusals.

## Gates and Handoff

- Human/policy gate: none closed; independent review open; frozen-contract additions pinned by tests in the same diff.
- Rollback or abort condition: a frozen-contract conflict with the four-key summary pins, or regression outside the new surfaces — stop and reconcile.
- Required durable records: this plan, RED commit, GREEN commit, evidence report, data-dictionary + status-matrix + checklist rows.
- Next command after handoff: `pnpm gate`, evidence commit; reassess queue afterwards.

## Closeout

- Verified commit/date: pending.
- Commands and outcomes: pending.
- Open risks/follow-ups: candidate position and Web UI deferred; `safeNextSteps` strings mirror existing CLI wording and must be re-diffed if those change.
- Evidence links: filled at closeout.
