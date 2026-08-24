# Loop 4 Round 10 — R10-6 verdict-producer freeze

## Outcome

The deferred discard crash-probe was not touched. This replacement slot adds
only standing-rule pins in
`test/unit/pi-adapter/report-task-result.test.ts`; producer behaviour is
unchanged.

The freeze now fails on four weakenings:

1. Model-supplied `from`, `runId`, and `taskId` values are adversarially passed
   to the tool and the emitted `TASK_RESULT` must still use the leased request's
   identity.
2. A `FAILED` report with an explicitly empty `evidenceIds` array is refused
   and emits nothing. This complements the existing absent-field refusal and
   the downstream `assessChildObservation` pin that proves an unreferenced FAIL
   is discarded.
3. Repeating the same `PASSED` report is refused and leaves exactly one
   terminal. This complements the existing conflicting-second-verdict pin and
   proves the rule is one call per attempt, not merely one call per verdict
   value.
4. A TypeScript-AST source pin requires `reportTaskResult` to be a direct member
   of the attempt's `tools` array. An in-memory mutation wraps it behind a
   runtime option and proves the pin rejects that opt-in shape. The existing
   faux-provider test still proves the tool is surfaced behaviourally when the
   request has no cluster.

## Census first

Taken against the working tree at **2026-08-24 23:06:03 UTC**:

- The brief-provided path
  `test/unit/pi-adapter/report-task-result.test.ts` exists.
- Production occurrences of the surface are confined to
  `src/pi-adapter/pi-executor.ts`: the exported name, tool factory,
  per-attempt construction, unconditional tools-array member, and `finish`
  documentation. A concurrent R10-5 comment in `src/tracking/from-child.ts`
  names the tool but does not produce or configure it.
- `PiExecutorOptions` and `createConfiguredPiExecutor` expose no verdict-tool
  runtime flag.
- Existing owned tests already covered leased identity only with ordinary
  inputs, missing (but not explicitly empty) FAILED evidence, a conflicting
  second verdict, and no-cluster surfacing. The additions above close those
  specific standing-freeze gaps without duplicating producer behaviour.
- The downstream reason remains mechanically covered in
  `test/unit/tracking/option-a-preconditions.test.ts`: a FAILED observation
  with no evidence has `apply === false`.

No consumer requires an update: this slot changes tests only and does not alter
the tool, executor contract, protocol, tracking input, or runtime factory.

## Verification

- `pnpm test -- test/unit/pi-adapter/report-task-result.test.ts`:
  **17 pass / 0 fail / 0 skipped**.
- `pnpm exec eslint test/unit/pi-adapter/report-task-result.test.ts`:
  exit 0.
- `pnpm exec tsc --noEmit`: executed repeatedly against the whole tree. A clean
  shared-tree result is pending because R10-1 and R10-4 are actively editing
  their owned files. The latest run reported only their in-flight joints:
  `src/run/events.ts:436` (incomplete return),
  `test/unit/run/event-row-fuzz.test.ts:270/619/643` (new event seed not yet
  added), and `test/integration/m2.5/resume.test.ts:192` (AST narrowing).
  Earlier, before R10-1 added the event union member,
  `test/unit/run/gate-status-posture.test.ts:425` also failed. The
  owned-file-filtered typecheck output was empty.
- `git diff --check`: exit 0.
- Tests are deterministic/offline, not timing-sensitive; no 3× timing run was
  required.
- No full gate was run.

The expected Node v22.14.0 engine warning appeared. No new skip, scratch file,
dependency, protocol criterion, source file, probe case, or crash-probe edit was
introduced.
