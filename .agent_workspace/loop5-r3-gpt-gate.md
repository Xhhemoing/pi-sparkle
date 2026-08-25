# Loop 5 · Round 3 — GPT gate-cause recheck

Auditor: GPT-gate-cause-recheck. Analysis only; no `src/` edits and no commit.

Reviewed landing merge `3140a96` from the branch snapshot at HEAD `cd6f834`, against:

- `.agent_workspace/loop5-r3-fable-gate.md`
- `.agent_workspace/loop5-r2-fable-context.md` G1–G3
- the stated summary, blocked-report, status, event-vocabulary, and gate-authority freezes

## Verdict: KEEP-with-riders

Keep the landing. Its event selection is correctly ordered, both machine-output and
stall-report freezes hold, and it reads only persisted events. The riders are a
small honesty wording follow-up and direct coverage of the other ordinary
production cause (`deterministic-fail`). Neither warrants reverting or holding
the landed visibility.

## 1. Event pairing: PASS

`gateBlockCause` does exactly the temporal selection requested:

1. `findLastIndex` selects the newest `RUN_BLOCKED`.
2. It returns no cause unless that block's reason is `ANALYSIS_QUEUED`.
3. It scans backward from `blockedIndex - 1` and stops at the first
   `GATE_TRANSITION`.

Therefore a transition after the selected block cannot be attributed to it. For
`T-old, B-analysis, T-later`, the function returns `T-old`; for a newest stall
block it returns `undefined`, even if an older gate transition exists.

This is better ordered than the pre-landing Fable sketch, whose simple
`findLast(queue_analysis)` did not itself bound the transition search at the
block. One test gap remains: the exact `T-old, B, T-later` adversarial ordering
is explained in source but not pinned directly.

Low-risk hardening, not a landing defect: the selected transition is not also
checked for `directive === "queue_analysis"` / `to === "BLOCKED"`, and its
assessment is joined by hash without `seq`. Production `applyTrackingGate`
writes the valid assessment → queue transition → block triple, and all fields
rendered from the assessment participate in that hash, so the shipped producer
does not expose a wrong-cause path. Adding the directive and sequence checks
would make the reader more defensive against independently valid but
causally-inconsistent synthetic logs.

## 2. Frozen `--summary-json`: PASS

The gate-blocked integration run still emits exactly:

```text
type, runId, status, requiredEvidence
```

`InspectSummaryJson` and `buildInspectSummaryJson` remain four-key projections;
`gateBlockCause` is called only after the `--json` and `--summary-json` early
returns. The new integration assertion checks the actual criterion-blocked gate
run and rejects a hidden `gateCause` key. Existing exact-shape and fifth-key
tripwires also pass.

## 3. Stall report and routed prefix: PASS

The stall path is byte-identical. Its newest `RUN_BLOCKED.reason` is not
`ANALYSIS_QUEUED`, so `gateBlockCause` returns `undefined` and the conditional
spread appends nothing.

The frozen routed prefix remains, byte for byte:

1. inspect `next:`
2. inject `next:`
3. unblock `next:`
4. resume `note:`

There are still exactly three `next:` lines. The discard disclosure remains a
`note:` and the new cause note is trailing and gate-only. Both the exhaustive
stall test and the richer gate-path prefix assertion pass.

## 4. Wording challenge: Fable is more honest

The landed sentence:

> `ANALYSIS_QUEUED names the queue this block was filed under, not the cause`

correctly distinguishes the payload label from the anomaly code, but it still
suggests a real queue. Production creates an ephemeral anomaly packet when
`wakeAnalysis` is true and then drops it; `proposeFromAnomaly` has only test
callers. There is no durable queued item, running job, consumer, or dequeue
operation. Manual `unblock` is what reopens the run.

Fable's “tracking gate verdict, not a running job; no analysis consumer is wired
yet” wording states the operational truth more completely. A wording-only
follow-up is worth making because G2 is specifically an honesty gap, but it is a
rider rather than a correctness gate: the landed note does expose the real
reason code and does not promise that processing will complete.

The appended unmet criterion is factual and useful, but it makes the blocked
note carry diagnostic detail already available in `inspect`. Prefer a short
blocked note containing:

- the gate verdict / not-a-job disclosure;
- the recorded reason code and turn;
- the fact that no consumer is wired and `unblock` remains the action.

Keep failed dimensions and per-criterion evidence in `inspect`. Dropping the
criterion from the blocked note is optional; correcting the implied live queue
is the valuable part.

## 5. Freeze and production-shape census

No freeze break found:

- `INSPECT_SUMMARY` remains four keys.
- The blocked routed prefix and exactly-three-`next:` rule remain intact.
- `RunStatus` remains the same eight members.
- `EVENT_TYPES` / the `Event` union gain no member.
- The implementation reads persisted `Event[]`; it does not read
  `GateApplyResult`.
- `RUN_BLOCKED.reason` remains `ANALYSIS_QUEUED`; the anomaly is additive prose.

The production implementation supports both reachable hard causes:

- `unmet-acceptance-criterion`: directly exercised end to end, including
  criterion id/evidence in inspect and the blocked note.
- `deterministic-fail`: supported generically by `reasonCode`, codes, failed
  dimensions, and the note formatter, but not directly asserted by the new
  suite.

That second shape is the meaningful coverage rider. The existing
`blocked-next.test.ts` creates a real `deterministic-fail` gate block but checks
only the old reason/evidence/routing surfaces. Extend it to assert the new note,
and add an inspect assertion for `gate cause: deterministic-fail` (plus failed
dimensions when present). The landing also did not add Fable's proposed child
`verification: FAILED (...)` line; this is not a G1/G3 failure because inspect
now names the actual gate cause, but a direct deterministic-fail test would
protect that ordinary operator journey.

## Verification

Passed:

- `pnpm typecheck`
- 56 targeted tests across `blocked-gate-cause`, `blocked-next`,
  `inspection`, `inspect-summary`, gate-authority posture, and event-row fuzz

The runner emitted the pre-existing environment warning that Node `22.14.0` is
below the package's declared `>=22.19.0`; no targeted check failed.
