gpt-5.6-sol

# Loop 4 Round 5 — R5-7 documentation truth-up

## Result

- Updated `docs/data-dictionary.md`, `docs/status-matrix.md`, and
  `docs/specs/m0-m2-architecture.md`.
- Replaced the stale R4-1 snapshot with the shipped run-plane contract:
  `runtime/runs/<runId>.lock` covers deletion plus its first verification,
  deletion verifies again after release, pause/track-question writes take the
  lock, and measured per-step event/checkpoint writers remain lock-free.
- Documented the one-line CLI undelivered-mail warning and its
  `pending=`/`dead-lettered=` detail, including the current production
  reachability limit.
- Documented resume `--primary-model`/`--thinking` forwarding and all disclosure
  postures: requested-now Pi configuration, default Pi rebuild, ignored flags
  when no executor is rebuilt, and ignored flags for a non-Pi executor. The
  flags are not described as restoring persisted configuration.
- Distinguished rebuildable `CATALOG_OBSERVED_CORRUPT` derived state from
  non-rebuildable `PREFERENCE_SNAPSHOT_UNREADABLE` learned state and its
  bind-after-successful-load protection.
- Added doctor's additive per-lock `remediation` and `runStates` inventory,
  supervised crash-terminal behavior, flowchart `preserveResumableState`
  checkpoint flushing, and at-least-once in-flight recovery.
- Added the local OpenAI-compatible SSE loopback fixture as the deterministic
  no-external-network Pi run → approval → resume verification path through the
  production calibration reader.

## Source census

The documentation was re-censused from source and tests at HEAD `6975aab`;
the stale R4-8 coordination prose was not used as the behavioral source:

- `src/privacy/deletion.ts`, `src/run/event-store.ts`,
  `src/run/checkpoint-store.ts`, `src/run/pause-controller.ts`, and
  `src/track/loop.ts` for the cooperative lock and double verification.
- `src/run/coordinator.ts`, `src/run/flowchart-run.ts`, `src/cli/main.ts`,
  `src/cluster/mailbox.ts`, and `src/run/child-coordinator.ts` for the
  undelivered-mail report, CLI line, and reachability census.
- `src/cli/main.ts` for resume flags, forwarding, validation, and disclosure.
- `src/routing/catalog-observed.ts` and `src/preferences/store.ts` for the two
  integrity errors and their distinct recovery postures.
- `src/cli/doctor.ts`, `src/run/supervisor.ts`, and
  `src/run/flowchart-run.ts` for doctor and crash-teardown contracts.
- `test/helpers/loopback-openai-provider.ts` and
  `test/integration/pi-adapter/loopback-cli-resume.test.ts` for the offline
  wire-level verification path.

## Round 5 coordination snapshot

At 2026-08-24 19:34 UTC, the docs timestamp-disclose these in-flight slots
without predicting their outcomes:

- **R5-1:** the run lifecycle did not hold `runLockPath`; a delete racing live
  event/checkpoint writes refused with `RUN_RECORDS_SURVIVED` rather than
  waiting for clean teardown.
- **R5-2:** flowchart, supervised, and child crash-terminal helpers remained
  separate, and a supervised crash rethrew before its outer
  episode/outcome/checkpoint settlement tail.
- **R5-6:** production attempts still minted fresh agent ids while
  `claimRole` requeue-counted only `mail.from === agentId`; production
  `dead-lettered=` therefore remained 0, with dead letters reachable only
  through direct mailbox/host API use.

No Outcome-supported claim or live R1/bandit/topology wiring was introduced.
ADR-006 remains Proposed; this slot did not mark it Accepted.

## Verification

- `git diff --check -- docs/data-dictionary.md docs/status-matrix.md docs/specs/m0-m2-architecture.md`
  — PASS.
- Implementation edits are confined to `docs/**`; this file is the requested
  slot report. No commit was created.
