# O08b control ordering verification — 2026-09-27

## Identity and scope

Task `TASK-20260927-o08b-control-order`; source revision `e1ce19c0f93d8e34e7ca25512c5d32d2743ba669` (provenance, not a new baseline mechanism). Dedicated O08b ownership assigned by the integration coordinator; working branch `codex/offline-determinism-o09`. [Plan](../superpowers/plans/2026-09-27-o08b-control-order.md).

Only `src/run/control-plane.ts::listPending` and its unit/CLI regression tests changed. The queue snapshot now sorts validated requests by `Date.parse(submittedAt)` in epoch milliseconds, then exact request ID code-unit order. Persisted schema, random IDs, single-writer and acknowledgement behavior remain unchanged. `src/run/flowchart-run.ts` was inspected but not edited.

## RED, GREEN and independent review

All commands ran in pwsh from this checkout on 2026-09-27. Raw local logs are under `.agent_workspace/verification/2026-09-27-o08b/`; they are not themselves publication material.

- Pre-change characterization: `pnpm test -- --test-concurrency=1 test/unit/run/control-plane-single-writer.test.ts test/integration/cli/pause-inject.test.ts` — 44 pass / 0 fail; `prechange-focused.log`.
- Behavioral RED with new tests and old production order: same command — 47 pass / 5 expected fail. The real CLI resume/drain missed `INJECTION_REQUESTED` when the later pause sorted ahead of the completed inject; `red-focused.log`.
- Author GREEN: same command — 52 pass / 0 fail / 0 skip; `green-focused.log`. Scoped ESLint exit 0 (`scoped-eslint.log`); `pnpm workflow:check` exit 0 (`workflow-check.log`).
- Independent specification review PASS: reviewer independently ran the focused command, 52 pass / 0 fail / 0 skip, and inspected RED evidence and the contract; `spec-review.md` and `spec-review-focused.log`.
- Separate independent quality review PASS with no actionable P1/P2/P3: reviewer independently ran the focused command, 52 pass / 0 fail / 0 skip, plus `pnpm workflow:check` and scoped `git diff --check`, all exit 0; `o08b-quality-review.md`.
- Coordinator combined-branch gate: `pnpm build` then `pnpm gate`, both exit 0; gate reported 2907 pass / 0 fail / 18 skip and its final build passed. Logs/results: `.agent_workspace/verification/2026-09-27-o09/pre-gate-build.log`, `o09-o08b-gate.log`, and `o09-o08b-gate-result.json`. The prebuild was necessary on this older base because its holdout helper import otherwise depends on `dist`; the separate integration branch carries a fix for that clean-tree defect. This gate covers the combined O09/O08b working tree at this date, not the later integration merge.

Actual CLI regression asserts injection event before pause, both acknowledgements `applied`, empty pending queue, retained injected fact and PAUSED checkpoint. Controlled clocks/IDs exercise distinct milliseconds, equal milliseconds, submillisecond truncation, equivalent/different timezone offsets, concurrent submissions, and clock rollback. Existing pause/inject refusal and terminal behavior stay covered by the focused command.

## Limits, privacy and handoff

Ordering is deterministic within a loaded snapshot; it is not strict FIFO for equal milliseconds, concurrent completion, clock rollback, delayed publication or future snapshots. No new sequence store, transaction, hash, frozen contract or gate was added. No live provider, holdout, benchmark, crash or production apply was run. S0-min, R10/R11 and F6 remain open.

This slice satisfies its bounded acceptance criteria and independent agent reviews; it does not assert the whole O01–O11 stage or GitHub integration is complete. Integration owner will record the final commit/SHA, run applicable verification after merge, publish and safely clean up worktrees. The ignored raw logs remain local unless individually screened and promoted as safe evidence.
