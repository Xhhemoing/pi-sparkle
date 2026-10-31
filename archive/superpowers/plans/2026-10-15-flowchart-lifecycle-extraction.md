# Flowchart durable-recovery prerequisite extraction

- ID: `TASK-20261015-flowchart-lifecycle-extraction` (bounded DP06 continuation).
- Owner: command-cleanup agent; root coordinates integration.
- State: `implemented-and-focused-verified`; date: 2026-10-15 Asia/Shanghai. Integrated gate and final commit binding remain root-owned.
- Scope: behavior-preserving extraction only. Related contracts: existing flowchart replay/checkpoint schemas, terminal and unblock ordering, import isolation.

`src/run/flowchart-run.ts` repeats durable log prerequisites in resume/control restore and checkpoint prerequisites in resume/control/unblock. Extract exactly these pure validations into `src/run/flowchart-lifecycle.ts`:

- `requireFlowchartReplay(runId, events)`: nonempty log, replay, required RUN_CREATED, required PROJECT_DISCOVERED in the existing order; return narrowed replay state.
- `requireFlowchartCheckpoint(runId, raw)`: required checkpoint, existing schema validation, required flowchart snapshot; return narrowed checkpoint.

Current call-site ranges before extraction are approximately 1954–1974 (resume), 2133–2152 (control restore), and 2584–2592 (unblock checkpoint). Unblock keeps its distinct log/status checks before checkpoint loading. Terminal event persistence, cancellation, checkpoint writes, crash teardown and state transitions remain exactly where they are; this is one durable-recovery-validation responsibility, not a lifecycle redesign.

Acceptance: exact error messages and validation ordering remain unchanged; invalid restores append no run events; valid replay/checkpoint behavior and terminal/cancellation/recovery suites stay green; no new live-routing import reaches inspection/replay paths.

Before moving code, add public-API characterization tests for resume/control missing log/run/project/checkpoint, malformed/missing flowchart snapshot, and unblock status-before-checkpoint ordering. Run these and existing abort/checkpoint/flowchart integration suites on the original source. Then extract and rerun the same command, typecheck and scoped lint. Root owns full gate and import-isolation checks. No new behavior is intended, so characterization before/after replaces a feature RED requirement.

Owned files: the two runtime files, `test/unit/run/flowchart-lifecycle.test.ts`, this plan and dated report. No common task/status docs or commits. Abort on changed events/status/error messages or source-pinning failures; preserve all unrelated changes.

## Verification closeout

The original-source and extracted-source commands both passed the same 50 tests. Additional resume/unblock/live-import-isolation coverage passed 54 tests. Typecheck, scoped ESLint, workflow check and whitespace check passed. A different agent reviewed the source diff without editing it and independently passed all 13 new public-path characterization cases. See [the exact command/evidence record](../../reports/2026-10-15-flowchart-lifecycle-extraction.md).

This completes the bounded recovery-validation portion of DP06, not the entire architectural plan or any production gate. No terminal-persistence or teardown behavior changed; those existing seams retain their regression coverage.
