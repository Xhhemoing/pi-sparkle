[Model: gpt-5.6-sol-xhigh-fast]

# Loop 4 · Round 9 · R9-5 — real SIGKILL in the unblock append window

## Verdict: PASS

The tenth standing probe case is `unblock-append-before-checkpoint-sigkill`.
The original nine cases and their order are unchanged. No production source was
edited by this slot.

## Census

- `scripts/crash-probe.mjs` is the sole producer of the case set.
- The sole executable consumer is
  `test/integration/persist/crash-recovery.test.ts`; it imports the script and
  pins every case by name. The brief/ownership path
  `test/integration/m2/crash-recovery.test.ts` does not exist.
- The pin now discloses that the set intentionally grew from nine cases to ten
  and names the new case.
- `docs/specs/m0-m2-architecture.md` also contains prose saying “nine” while
  this slot ran. It is not an executable case-set consumer, and `docs/**` is
  concurrently owned and edited by R9-4, so this slot did not collide with it.

## Deterministic external window

The child invokes the real, unmodified `unblockFlowchartRun` producer against a
real gate-BLOCKED flowchart run. Its operator reason is a valid 16 MiB string.
That widens the producer's existing post-append `EventStore.readAll()` enough
for the parent process to observe the complete newline-terminated
`RUN_UNBLOCKED` row and send `SIGKILL`; the child contains no crash callback,
sentinel, injected checkpoint seam, or self-kill.

The parent proves where the kill landed:

1. production `EventStore.readAll()` parses exactly one complete
   `RUN_UNBLOCKED`, with the full reason and retry node;
2. `checkpoint.json` is byte-identical to the pre-unblock BLOCKED checkpoint;
3. no `checkpoint.json.<child-pid>.*` temp exists, proving the child had not
   started `CheckpointStore.write`;
4. the lifecycle lock records the externally killed child PID.

After the documented manual stale-lock removal, real `resumeFlowchartRun`
recovers the reopen. The formerly FAILED node executes exactly once, reaches
COMPLETED, the log still contains exactly one `RUN_UNBLOCKED`, terminals are
`RUN_BLOCKED` then `RUN_COMPLETED`, and replay reports no anomalies.

## Verification

- `node scripts/crash-probe.mjs` — PASS, `ok: true`, 10 cases × 3 iterations.
- Reduced integration pin — PASS 4/4 runs, 1 test each, 0 failures/skips
  (including a final run after concurrent source updates).
- `pnpm exec eslint scripts/crash-probe.mjs test/integration/persist/crash-recovery.test.ts`
  — PASS.
- Whole-tree `pnpm exec tsc --noEmit` — PASS.
- `git diff --check` on both owned files — PASS.
- No full gate, as instructed.

## Scope and shared tree

Branch remained `agent/opt-continuous`; no checkout, commit, or history
operation was performed. This slot changed only:

- `scripts/crash-probe.mjs`
- `test/integration/persist/crash-recovery.test.ts` (name-list pin only)
- this report

At the final census (`2026-08-24T22:31:35Z`, HEAD `8f45505`), concurrent
unowned edits were present under `docs/**`, `src/{cli,pi-adapter,run}/**`,
`test/unit/**`, `.agent_workspace/loop4-r9-t3.md`, and
`test/unit/run/gate-status-posture.test.ts`. This slot did not edit them.
