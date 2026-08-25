# Loop 4 · Round 11 · R11-2 — discard append-window SIGKILL probe

## Verdict: PASS

The eleventh standing probe case is
`unblock-discard-append-before-checkpoint-sigkill`. The original ten names and
their order are unchanged, and the executable name-list pin carries the
required ten-to-eleven disclosure. No production source was edited by this
slot.

## Census

- `scripts/crash-probe.mjs` is the sole producer of the probe case set.
- The sole executable consumer is the verified-existing
  `test/integration/persist/crash-recovery.test.ts`, which pins all names and
  their order.
- A recursive path census found no other `crash-recovery.test.ts`;
  `test/integration/m2/crash-recovery.test.ts` does not exist and was not
  created.
- Prose consumers under `docs/**` are concurrently owned by R11-5 and were not
  edited here.

## Probe

The setup uses the real three-node gate-blocked shape from
`blockedWithExecutedDescendant`: the scout is COMPLETED, root-cause analysis is
FAILED, and an `any`-join summary behind it is COMPLETED. The child calls the
real, unmodified `unblockFlowchartRun` with `discardExecuted: true` and a valid
16 MiB reason. It has no crash callback, checkpoint seam, sentinel, or
self-kill.

The parent observes the complete newline-terminated append and sends external
SIGKILL while the producer re-reads the log. The case proves:

1. the child exits by SIGKILL;
2. exactly one new row decodes, it is
   `RUN_UNBLOCKED_WITH_DISCARD`, and it records only the executed summary;
3. `checkpoint.json` remains byte-identical to the pre-unblock BLOCKED bytes;
4. no checkpoint temp exists;
5. the abandoned lifecycle lock names the reaped child PID.

After documented manual stale-lock removal, real `resumeFlowchartRun` takes the
stale-checkpoint recompute-matches path. It re-executes the retry target and
discarded summary exactly once, does not re-execute the scout, reaches
COMPLETED, retains exactly the one original discard authorization, and replays
with zero anomalies.

## Verification

- `node scripts/crash-probe.mjs` — PASS: `ok: true`, 11 cases × 3 iterations.
- `test/integration/persist/crash-recovery.test.ts` — PASS 3/3 independent
  runs, one test each, zero failures/skips.
- `pnpm exec eslint scripts/crash-probe.mjs test/integration/persist/crash-recovery.test.ts`
  — PASS.
- Whole-tree `pnpm exec tsc --noEmit` — PASS.
- `git diff --check` on both owned code/test files — PASS.
- No full gate, as instructed.

One initial reduced run crossed R11-4's in-progress shared-tree edit and failed
both the unchanged tenth case and the new case with the same
`retryNodeId`-of-undefined error. The source census showed
`restoreCheckpointedSupervisor` already passing four arguments while
`applyClearingEvent` still accepted three. R11-4 completed that signature at
`2026-08-24 23:58:19Z`; the unchanged command then passed, followed by every
verification above. No probe workaround was added.

## Scope and shared tree

This slot changed only:

- `scripts/crash-probe.mjs`;
- `test/integration/persist/crash-recovery.test.ts` (name-list pin only);
- this report.

At the final pre-report census (`2026-08-24T23:59:20Z`, HEAD `330466a`),
concurrent unowned edits were present under `docs/**`,
`src/run/flowchart-run.ts`, `test/integration/cli/blocked-next.test.ts`, and
`test/unit/run/**`, plus other slots' `.agent_workspace` reports. This slot did
not edit them. The branch remained `agent/opt-continuous`; no checkout, commit,
push, or history operation was performed.
