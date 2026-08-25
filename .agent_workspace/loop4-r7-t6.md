# Loop 4 · Round 7 · R7-6 — Round 6 documentation truth-up

Result: **PASS**

Stayed on `agent/opt-continuous`. No checkout, commit, or push was performed.
The shared-tree edits outside `docs/**` and this required slot report were left
untouched.

## Census

The current-contract Round 6 coordination snapshots were confined to
`docs/data-dictionary.md`, `docs/status-matrix.md`, and
`docs/specs/m0-m2-architecture.md`. `docs/how-to-adapt-to-pi.md` has no Round 6
runtime claim to update. The Round 6 handoffs and their production/test symbols
were rechecked at HEAD before editing.

## Change

- Recorded the first-replayed-terminal contract: tracking-gate
  `queue_analysis` beats a later node failure, leaving one BLOCKED terminal
  with `ANALYSIS_QUEUED`, checkpoint BLOCKED, episode WAITING, and no
  overwrite anomaly.
- Added the clarification-run lifecycle lock, persist-nothing refused-start
  posture, empty-`runtime/runs/` refused-resume posture, and supervised
  pre-rounds terminal-then-settle behavior.
- Documented doctor's frozen-additive `learnedState` shape and the distinct
  bandit, preference, and derived-catalog routes; corrected the current status
  row for doctor's signed-off read-only bandit diagnostic exception without
  implying live selection.
- Documented `delete --lock-wait-ms` for both targets, including omission,
  zero, strict-decimal/24-hour bounds, and why `pause` deliberately has no
  matching flag.
- Added the production cascade wire witness and crash probe case 9,
  `sigkill-run-lock-operator-recovery`.
- Replaced the stale Round 6 snapshots with a `2026-08-24 21:01 UTC`
  end-of-round sync that says only that R7-1, R7-2, and R7-3 were in flight.
  It makes no prediction about their result.

## Files

- `docs/data-dictionary.md`
- `docs/status-matrix.md`
- `docs/specs/m0-m2-architecture.md`
- `.agent_workspace/loop4-r7-t6.md` (required report)

No ADR file or ADR status line was touched. ADR-006 remains Proposed.

## Verification

- `git diff --check -- docs` — PASS
- Round 6 snapshot/stale-timestamp census in the three current-contract docs —
  no stale snapshot remains
- ADR status census — `docs/decisions/0006-pi-extension-reverse-adapter.md`
  still says `Proposed`
- Product tests — not run, per the doc-only task
- Scratch files — none created
