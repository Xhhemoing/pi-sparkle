# SOTA loop 3 — Round 1 architecture report — 2026-08-24

Branch `agent/sota-opt-loop3-7e63`, HEAD `ce28506`, based on `main` @ `2a921ee`
(PR #6, the merged loop-2 SOTA work). This report continues the
[loop-2 architecture report](2026-08-24-sota-loop2-architecture.md) and tracks
its §3 ranked items. Nothing here claims Outcome-supported, closes Checkpoint
F-PROD or the P0 privacy sign-off, or recommends enabling live
R1/bandit/topology (ADR-005; ADR-006 stays Proposed).

## Method and snapshot honesty

Loop 3 Round 1 runs six slots concurrently against one shared working tree;
the parent commits after the round. As in loop 2, claims are labeled:

- **At HEAD (`ce28506`)** — the last commit: loop-2 as merged, plus the
  orchestrator's loop-3 start note. None of this round's code exists there.
- **In the Round 1 working tree** — sibling changes present but uncommitted
  when this report was finalized (~16:45 UTC). The tree moved while this
  report was being written: the integration test, the feedback-lock test, and
  the adaptation-closure test all landed mid-audit and were verified after
  they appeared. Nothing counts as closed until the parent gate re-runs over
  the final combined tree.

Citations into in-flight files use symbol names, not line numbers (loop-2 §3
P2-7 hygiene).

## 1. The carried-over loop-2 §3 items, one by one

### 1.1 `INSPECT_SUMMARY` stability declared: frozen additive-only (loop-2 P1-2)

**Closed this round, code + docs together.**

Loop 2 shipped `inspect --run --summary-json` printing one `INSPECT_SUMMARY`
object but deliberately left its stability undeclared. The loop-2 report
recommended freezing it additive-only like `DoctorJsonReport`, because it is
a machine-readable surface and scripts grow against such surfaces whether or
not a promise exists. Declaring it unfrozen would have produced the worst of
both worlds: consumers pin keys anyway, with no obligation on our side.

**In the Round 1 working tree (opus-1, code):**

- `src/run/inspection.ts` exports the frozen shape `InspectSummaryJson`
  (`type: "INSPECT_SUMMARY"`, `runId: RunId`, `status: RunStatus`,
  `requiredEvidence: readonly string[]`) with the freeze stated in its doc
  comment, plus the pure projection `buildInspectSummaryJson` — it copies
  `requiredEvidence` verbatim and derives nothing the inspection did not
  already collect from `STALL_DETECTED` / `RUN_BLOCKED`.
- `inspectCommand` in `src/cli/main.ts` now emits by calling the builder
  instead of inlining an object literal, so the CLI cannot drift from the
  exported type.
- The unit suite pins the exact key set (`INSPECT_SUMMARY_KEYS` in
  `test/unit/run/inspection.test.ts`): a key can be added only by
  deliberately updating that list, and none of the four may be renamed,
  retyped, or dropped.
- NEW `test/integration/cli/inspect-summary.test.ts` (six cases, landed
  mid-round, verified 6/6 after landing): one frozen object for a genuinely
  blocked flowchart run whose `requiredEvidence` equals the persisted
  `RUN_BLOCKED` payload verbatim; `COMPLETED` with `[]` for a clean run;
  `--json` stays one line per persisted event with no summary appended;
  both refusals (`--json` + `--summary-json`, `--episode` +
  `--summary-json`); and a spawned-process check that real stdout carries
  exactly one object.

**This slot (docs):** the status-matrix inspect row and both README mentions
now declare the freeze where users read, replacing "stability is not yet
declared".

**The contract, spelled out once:**

- *Consumers may rely on:* summary mode prints exactly one JSON object on
  stdout; the keys `type` (always `"INSPECT_SUMMARY"`), `runId`, `status`,
  and `requiredEvidence` (the latest stall/block demand verbatim, `[]` when
  the run never stalled) exist with those meanings.
- *The project reserves:* adding new keys. A consumer that iterates keys must
  tolerate unknown ones.
- *Forbidden by the freeze:* removing, renaming, or retyping the four keys;
  changing their meaning; giving the object an `id`; admitting its `type`
  into the `Event` union; emitting it inside `--json`; extending it to
  `--episode`. It stays run-only and outside the event log.
- *Scope honesty:* this is a shape-compatibility promise for a
  developer-preview surface, not an Outcome-supported claim, and it does not
  move any matrix cell past Exercised.

Freezing now is cheap: the shape is four keys, one pure function owns the
projection, and two tests pin the key set. Freezing later — after external
scripts differ on what they assumed — is when it gets expensive.

### 1.2 Bounded retry + probe for the invocation lock timeout (loop-2 P1-3)

**In the Round 1 working tree: implemented (gpt-sol-1).**
`appendInvocationRecord` (`src/telemetry/invocation-log.ts`) now retries a
lock timeout exactly once with the same options — bounding telemetry waiting
to at most two acquisition windows — and a second timeout still rejects so
the live caller drops the row. The failure *direction* is unchanged: a run is
never failed for the sake of a telemetry row. NEW
`scripts/invocation-lock-probe.mjs` (script key `invocation:probe`, the one
sanctioned `package.json` edit this round) measures contended locked-append
latency and demonstrates the documented drop under a lock held through both
windows, so the loop-2 residual is now *measured*, matching the repo standard
that admitted limits get numbers. Pinned by the new telemetry test "an append
retries once then rejects when both lock waits time out".

### 1.3 Adaptation-plane transitive closure check (loop-2 P2-4)

**In the Round 1 working tree: implemented (gpt-sol-2).** NEW
`test/unit/privacy/adaptation-plane-closure.test.ts` walks the union
value-import closure from five adaptation directories (`adaptation`,
`learning`, `preferences`, `experiments`, `feedback`) against pinned runtime
prefixes, with a per-module allowlist that states *why* each allowed runtime
edge exists (e.g. the episode-id pipe statically loading episode settlement).
The walker is deliberately fail-closed regex (comment text that looks like an
import counts as an edge) and a repository-wide watchlist rejects computed
`import(expr)`. This closes the loop-2 limit that `plane-boundary.test.ts`
was a direct-import scan which laundering through a fresh intermediate module
would not trip. `live-isolation.test.ts` is untouched, per ownership.

### 1.4 Feedback append vs. delete-cascade rewrite race (new this loop)

**In the Round 1 working tree: implemented (opus-2).** The same race class
loop 2 closed for `invocations.jsonl` existed on
`adaptation/feedback/records.jsonl`: `appendFeedback` appended unlocked while
`cascadeFeedbackTombstones` did an unlocked read–filter–write, so an append
landing in the rewrite window was silently clobbered — which for this file
means a deleted episode's body could survive the delete. Now
`src/feedback/store.ts` owns the writer surface: `withFeedbackLogLock` over
`records.jsonl.lock`, a locked queued `appendFeedback` (per-path in-process
queue, same shape as the invocation log), and `writeFeedbackRecords`
documented as the lock-holder's write half. `cascadeFeedbackTombstones`
(`src/privacy/deletion.ts`) wraps read + rewrite + `tombstones.json` write in
one critical section, so the tombstone id list and the stripped rows cannot
disagree. Timeouts fail closed in both directions: a delete that cannot
serialize refuses rather than racing the live appender; an append that cannot
serialize is a dropped feedback row, never a failed run. Readers stay
lock-free. Pinned by NEW `test/unit/feedback/store-lock.test.ts`.

### 1.5 Parent gate over the final combined tree (loop-2 P1-1, recurring)

Loop 2's gate ran green after that round (1434 pass / 0 fail / 1 skip,
security probe 14/14, per the orchestrator log). The obligation recurs for
this round: my targeted verification (§5) predates the final tree, and
nothing in §1.1–1.4 counts as closed before `pnpm gate` +
`pnpm security:probe` pass over what the parent actually commits. Parent
action, not a slot.

## 2. Architecture observations on the in-flight designs

Review notes, not defects; none blocks the round.

1. **One projection function is the right freeze anchor.** The CLI emitting
   `buildInspectSummaryJson(...)` means the frozen type, the emitted bytes,
   and the two key-set tests cannot drift apart independently. Additions have
   a single procedure: extend `InspectSummaryJson`, update
   `INSPECT_SUMMARY_KEYS` in both suites, and touch the matrix/README wording
   in the same change.
2. **Writer-surface convergence, not a shared lock.** The feedback log now
   mirrors the invocation log (path owner + cooperative lock + queued
   validating append + fail-closed timeout + lock-free readers), but each
   file keeps its own lock. That is correct: one global lock would couple the
   runtime and adaptation planes through a mutex, which the plane boundary
   exists to prevent.
3. **Deletion is point-in-time, and that should stay disclosed.** The cascade
   strips what exists when it runs. A feedback row bound to the deleted
   episode but appended *after* the cascade completes carries a new id the
   tombstone list has never seen. The lock closes the torn-rewrite window; it
   does not (and should not) turn a delete into a standing filter. Same class
   as the existence pre-check outside the lock: a log created by an append
   racing that check holds only rows appended after the delete began. Worth
   one sentence in the data dictionary (fable-2's file) if not already there.
4. **The bounded retry preserves the priority inversion guard.** Two
   acquisition windows instead of one changes how long telemetry waits, not
   who wins: the live run still never fails for a telemetry row, and the drop
   is still honest (probed, not just admitted).
5. **The closure walker's fail-closed bias is the right default.** Counting
   comment text as import edges produces false positives that a maintainer
   must resolve by rewording a comment — annoying, cheap, and safe. The
   inverse failure (a real edge unseen) would be silent.
6. **`--children` stays `skipContract: true` by product decision.**
   Re-affirmed, not revisited: the runtime does not invent a run-level
   contract from per-task `acceptanceCriteria`, the honesty test from loop 2
   pins it, and no slot this round touches it.

## 3. Ranked remaining work after this round

**P1**

1. **Parent gate + security probe over the final combined tree** (§1.5).
   Recurring parent action; everything above is provisional until it is
   green.
2. **Record one probe run's numbers.** `scripts/invocation-lock-probe.mjs`
   exists and demonstrates the drop; a representative local result (like the
   retention probe's line in the orchestrator log) would finish the "limits
   get numbers" standard for this residual.

**P2 / policy-gated (no code path this loop may take)**

3. **P0 privacy sign-off** — a human act; the reviewer re-verifies Q1/Q2
   remediation. This loop widened the cascade's correctness (feedback lock),
   which belongs in the reviewer's packet, not in a self-certification.
4. **Checkpoint F-PROD / sealed holdout** — untouched, open (ADR-005).
   Outcome-supported stays forbidden; no matrix cell moved past Exercised.
5. **ADR-006** — stays Proposed; no `extensions/pi-sparkle/` import.
6. **Retention default stays unbounded** (accepted Q3 position); the probe
   measures, the policy decision remains open. No slot changed this.
7. **Node engines floor and real-provider coverage** — unchanged; `--children`
   / `--track` real-provider coverage stays opt-in `PI_SMOKE=1` smoke, and
   only opt-in coverage may ever close it.
8. **Point-in-time delete semantics for late-bound feedback** (§2.3) — a
   one-line dictionary disclosure candidate, not a mechanism change.

## 4. Policy-gated, unchanged

Same table as the loop-2 report, re-affirmed without movement: Checkpoint
F-PROD stays open; Outcome-supported stays forbidden and no matrix row claims
it; the P0 privacy sign-off remains a human act; ADR-006 stays Proposed; live
R1/bandit/topology stay off the execution path, enforced by
`live-isolation.test.ts` (untouched this round) and now additionally by the
adaptation-plane closure walker.

## 5. Verification performed for this report

Against the shared Round 1 working tree (Node v22.22.2, pnpm 10.17.1):

- `pnpm exec tsc --noEmit` — clean.
- `pnpm test -- test/unit/run/inspection.test.ts test/unit/feedback/
  test/unit/telemetry/invocation-log.test.ts
  test/unit/privacy/deletion.test.ts` — **103 pass / 0 fail**.
- `pnpm test -- test/integration/cli/inspect-summary.test.ts
  test/unit/feedback/store-lock.test.ts
  test/unit/privacy/adaptation-plane-closure.test.ts` — **18 pass / 0 fail**
  (run after these three files landed mid-round).
- `git diff package.json` — the only change is the `invocation:probe` script
  key (sanctioned for gpt-sol-1); no dependency moved.

## Standing constraints

Re-affirmed unchanged: nothing in this repo is Outcome-supported; Checkpoint
F-PROD and the P0 privacy sign-off stay open; ADR-006 stays Proposed; live
R1, bandit, and topology stay off the execution path; retention stays
unbounded by default; the package stays `private: true` developer preview.
