# R6-7 — Round 5 documentation truth-up

Slot: Round 6 · R6-7 (docs). Stayed on `agent/opt-continuous`; no checkout and
no commit. Census began at requested HEAD `b4cc072`. The shared branch advanced
concurrently through orchestrator dispatch and R6-10 (`6fb7d9d` at report
time); those commits were not mine.

## Result

Updated the current operator/specification documents to the landed Round 5
contracts:

- mailbox skip is role-level (`holdersByRole`), not instance-id-level;
  `dead-lettered=` is production-reachable; a self-role-cast may survive
  `DEFAULT_MAX_ROLE_REQUEUES` claim opportunities and drops on the next claim;
  same-role late delivery is deliberately unavailable, while cross-role late
  delivery and no-TTL `pending=` remain;
- M0, parent, flowchart, and supervised start/resume paths hold the run lock
  through teardown; delete waits up to the default bound, pause-on-live fails
  closed, SIGKILL leaves the never-stolen lock, and doctor provides the manual
  remedy;
- supervised crashes share the crash-terminal module, settle launched work,
  close the episode, materialize the honestly replayed checkpoint, and rethrow;
  the episode/checkpoint settle halves remain independently best effort;
- damaged learned bandit state throws
  `BanditStateUnreadableError` / `BANDIT_STATE_UNREADABLE`, preserves bytes,
  and distinguishes ENOENT from damage and unknown-key version skew;
  `run --children` prints `adapt skipped: …`, while `adapt auto` and tracked
  runs reach `stage: "validation"`;
- `LOCK_TIMEOUT` and `RUN_RECORDS_SURVIVED` code-route `next:` to doctor at the
  failing state root; generic failures retain the frozen generic route;
- malformed `CheckpointStore.read()` input throws a path-naming
  `DomainValidationError`; only ENOENT returns `undefined`;
- the loopback wire witness covers requested model versus distinct default,
  `stream: true`, flagged `reasoning_effort: "high"`, its flag-free absence,
  and supervised resume.

At `2026-08-24 20:25 UTC`, R6-1, R6-2, and R6-3 were explicitly disclosed as
in flight. The docs record observed Round 5 source and do not predict those
slots' terminal-semantics, resume-reconstruction, or remaining lifecycle-lock
decisions.

ADR-006 is marked **Accepted** per the task instruction. Current text is
explicit that acceptance reserves the inbound-adapter boundary but does not
implement or register an extension. No capability is marked
Outcome-supported, and live R1/bandit/topology remain off the execution path.

## Census source

- `src/cluster/mailbox.ts`, `src/cluster/host.ts`,
  `src/run/child-coordinator.ts`,
  `test/integration/cluster/undelivered-mail.test.ts`
- `src/run/coordinator.ts`, `src/run/flowchart-run.ts`,
  `src/run/supervisor.ts`, `test/unit/run/run-lifecycle-lock.test.ts`,
  `test/integration/m2/supervisor-crash.test.ts`
- `src/learning/bandit-store.ts`, `src/learning/auto-loop.ts`,
  `src/cli/main.ts`, `test/unit/learning/bandit-store*.test.ts`
- `src/run/checkpoint-store.ts`, `test/unit/run/checkpoint-store.test.ts`
- `src/cli/errors.ts`, `test/integration/cli/command-error-doctor.test.ts`
- `test/integration/pi-adapter/loopback-cli-resume.test.ts`
- `.agent_workspace/loop4-r5-t6.md` §7.6 and
  `.agent_workspace/loop4-r5-t3.md` operator-surface disclosure

## Files

- `docs/data-dictionary.md`
- `docs/status-matrix.md`
- `docs/specs/m0-m2-architecture.md`
- `docs/decisions/0006-pi-extension-reverse-adapter.md`
- `docs/how-to-adapt-to-pi.md`
- this report

## Verification

- `git diff --check -- docs` — exit 0.
- Current-doc stale-phrase census found no remaining Round 5 coordination
  snapshot, instance-id dead-letter posture, production-unreachable
  `dead-lettered=`, or Proposed ADR-006 wording in the updated current docs.
- Documentation-only slot: no product tests run.

