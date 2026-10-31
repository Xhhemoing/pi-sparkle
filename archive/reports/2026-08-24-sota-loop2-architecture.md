# SOTA loop 2 — Round 1 architecture report — 2026-08-24

Branch `agent/sota-opt-next-7e63`, HEAD `1b228d3`, based on `main` @ `b371e12`
(PR #3, the merged loop-1 SOTA work). This report continues the accepted
[Round 3 acceptance](2026-08-24-sota-r3-acceptance.md) and tracks the four
P1/P2 gaps that acceptance left open. Nothing here claims Outcome-supported,
closes Checkpoint F-PROD or the P0 privacy sign-off, or recommends enabling
live R1/bandit/topology (ADR-005; ADR-006 stays Proposed).

## Method and snapshot honesty

Loop 2 Round 1 runs six slots concurrently against one shared working tree;
the parent commits after the round. This report therefore distinguishes two
states and says which one every claim is about:

- **At HEAD (`1b228d3`)** — what the last commit actually contains.
- **In the Round 1 working tree** — sibling changes present but uncommitted
  when this report was written (~16:20 UTC). These were verified by reading
  the diffs and running their tests, but they are not closed until the parent
  gate re-runs over the final combined tree.

Because the in-flight files were still moving, citations into them use symbol
names, not line numbers. Line numbers are used only for files that no Round 1
slot edits.

## 1. The four carried-over gaps, one by one

### 1.1 `inspect --json` lacked aggregated `requiredEvidence` (R3 P2-5)

**At HEAD: open.** `inspect --run --json` dumps the raw event NDJSON and
nothing else; the evidence a blocked run demands exists only inside
`STALL_DETECTED` / `RUN_BLOCKED` payloads in that stream. The prose view does
not surface it either.

**In the Round 1 working tree: implemented (opus-1).**

- `RunInspection` gained `requiredEvidence: readonly string[]`
  (`src/run/inspection.ts`): filled last-writer-wins from the newest
  `STALL_DETECTED` or `RUN_BLOCKED` payload, copied verbatim and in event
  order, `[]` when the run never stalled or blocked. Nothing is derived,
  merged, or invented. `EPISODE_WAITING.requiredEvidence` is deliberately
  **not** folded in — episode waits are a different gate, and combining them
  would misattribute the source.
- The CLI adds an opt-in `inspect --run --summary-json` printing exactly one
  `INSPECT_SUMMARY` object (`type`, `runId`, `status`, `requiredEvidence`).
  Crucially, `--json` **stays a byte-identical pure event stream**: the
  existing integration assertions (`test/integration/cli/cli.test.ts` pins
  exact line counts and that every line carries an event `id`) made the
  brief's alternative — appending a summary line to `--json` — a breaking
  change, so the aggregate went behind its own flag. The summary object is
  deliberately not a domain `Event` (its `type` is outside the `Event` union
  and it has no `id`), so the two outputs cannot be confused if concatenated.
- `--json` with `--summary-json` is refused; `--episode` with `--summary-json`
  is refused; the prose view prints a `required evidence (n):` bullet list
  only when non-empty.
- Pinned by eight new cases in `test/unit/run/inspection.test.ts`, including
  the no-break contract on `--json` (exact event-type sequence, no
  `INSPECT_SUMMARY` line).

**Open residue:** the `INSPECT_SUMMARY` shape has no declared stability
(doctor `--json` is a frozen additive-only contract; this is not, yet), and
no test exists in `test/integration/cli/` — both ranked in §3.

### 1.2 Unlocked invocation append vs. the delete lock (R3 P1-3)

**At HEAD: open.** The `delete --run` rewrite of the shared
`runtime/invocations.jsonl` takes the log's cooperative lock, but the live
appender wrote with a fire-and-forget unlocked `appendFile` in the CLI's
`onInvocation` hook. An append landing between the rewrite's read and its
`writeFile` was silently clobbered. Disclosed at HEAD in the
`dropRunFromInvocationLog` contract comment — disclosure was the acceptance
criterion; the fix was ranked work.

**In the Round 1 working tree: implemented (opus-2).**

- New single-writer surface `src/telemetry/invocation-log.ts` owns the log
  path (`invocationsLogPath`), the lock (`withInvocationLogLock` over
  `invocations.jsonl.lock`), the locked validating append
  (`appendInvocationRecord`, which fails closed on a malformed record), and
  the writer-side read/write halves (`readInvocationRecords` fails closed on
  a corrupt middle line; `writeInvocationRecords` documents that callers must
  already hold the lock).
- An in-process append queue chains appends per path, so concurrent appends
  in one process wait in JS instead of spinning on the file lock's `EEXIST`.
- `src/privacy/deletion.ts` now runs read–filter–write inside
  `withInvocationLogLock` — the same lock the appender takes — so a live
  append lands wholly before the read or wholly after the write.
- `src/routing/cost-calibration.ts` re-exports `INVOCATIONS_LOG` /
  `invocationsLogPath` from the new module instead of owning a second copy of
  the path; calibration reads stay lock-free by design (a torn tail costs a
  calibration sample, never blocks a live run).
- The CLI `onInvocation` hook now calls `appendInvocationRecord`; errors — a
  lock timeout while a delete holds the lock, or a validation failure — drop
  the telemetry row rather than fail the run mid-execution.
- Pinned by eleven tests in `test/unit/telemetry/invocation-log.test.ts`
  (including "a rewrite under the lock cannot clobber a concurrent append"
  and "an append that cannot take the lock times out instead of writing
  unlocked") and three new deletion tests ("an invocation appended while a
  run delete runs is never clobbered", "a live append cannot resurrect the
  deleted run's rows after the rewrite").

**Honest residuals (disclosed, by design):** a lock timeout on the live path
drops that telemetry row silently; cross-process append **order** is
whatever the lock grants (each row still lands whole); readers remain
lock-free. These are choices, not gaps — the status matrix now states them.

### 1.3 Overbroad plane-boundary justification (R3 isolation §1.3)

**At HEAD: open.** The `plane-boundary.test.ts` allowlist comment for
`adaptation/eval-routing.ts -> ../supervisor/model-router.js` claimed
"type-only, so nothing supervisor-side is loaded at runtime". The first half
is true; the conclusion is not: `eval-routing` value-imports
`routing/assign`, which value-imports and loads `supervisor/model-router` at
runtime. No record was ever reachable — `model-router` has zero filesystem
access — so this was a false *comment*, not a leak.

**In the Round 1 working tree: implemented (gpt-sol-1).** The comment now
states the accurate two-step fact, the `ALLOWED` list is unchanged, and a new
test pins the whole chain: `eval-routing` must value-import `assignTasks`,
`routing/assign` must value-import `createModelRouter`, and
`supervisor/model-router.ts` must stay free of `node:fs` /
`readFile` / `writeFile` / `appendFile`. If someone adds record access to the
router, the boundary test — not a comment — turns red.

**Open residue:** this pins the one *known* transitive chain. The general
limit stands: `plane-boundary.test.ts` is still a direct-import scan, and
adaptation→runtime laundering through a fresh intermediate module would not
trip it (ranked in §3; the closure machinery already exists in
`live-isolation.test.ts`).

### 1.4 Plain `--children` starts `skipContract: true` (R3 P1-1)

**Still open in both HEAD and the working tree — by decision, and now
documented rather than changed.** The CLI children path compiles the spec
(`compileChildrenToFlowchart` in `src/cli/main.ts`) and calls
`startFlowchartRun` without a `contract`, so the run binds

```781:781:src/run/flowchart-run.ts
    ...(input.contract !== undefined ? { contract: input.contract, skipContract: false } : { skipContract: true })
```

and the coverage gate never fires there, while `--track` always builds a
contract:

```245:245:src/track/loop.ts
    skipContract: false,
```

The loop-2 decision (PROGRESS.md item 4) is **document honestly, do not
silently invent a contract** from `acceptanceCriteria`. Deriving one would
change start semantics for every existing children spec — a spec that starts
today could begin refusing — and would blur the line the coverage gate is
supposed to draw: a contract is a *user-supplied* obligation, not something
the runtime back-fills. Per-task `acceptanceCriteria` still gate each child's
`TASK_RESULT`; they are simply not compiled into a run-level requirement
contract. This round's README and status-matrix edits (this slot) state all
of that where users will read it, and the decision is now **pinned by a
test** (gpt-sol-2, in-tree):
`test/integration/m2.5/cli-contract-honesty.test.ts` asserts that a plain
`--children` run persists only the synthetic `run-complete` acceptance
criterion — the observable projection of the skip-contract start — that
child `acceptanceCriteria` are never promoted into an invented parent
contract, and that `--track` records its extracted `ac-objective` /
`ac-tests` contract without `run-complete`. A future change that silently
derives a contract turns this red.

## 2. Architecture observations on the in-flight designs

These are review notes, not defects; none blocks the round.

1. **`INSPECT_SUMMARY` is correctly not an `Event`.** Keeping it outside the
   `Event` union with no `id` is the right shape — it can never be appended
   to an event log or replayed. The remaining decision is contract stability
   (§3, P1-2).
2. **Last-writer-wins is the right aggregation.** A run that stalls twice
   has one current demand; merging superseded demands would misreport what
   the run is waiting for. The unit tests pin exactly this.
3. **The append queue is per-process.** Two processes appending concurrently
   serialize on the file lock, so rows land whole, but inter-process order is
   unspecified. For telemetry this is acceptable and now documented; it must
   never be repurposed for evidence-bearing records.
4. **Row loss on lock timeout is a chosen failure direction.** The
   alternative — failing the live run because telemetry could not be
   written — would invert the priority of the two planes. The choice is
   sound; it just has to stay visible (matrix, this round).
5. **One path owner.** Re-exporting `invocationsLogPath` from
   `invocation-log.ts` through `cost-calibration.ts` removes the
   writer/reader-disagree-on-path failure class instead of documenting it.
6. **`inspectCommand` replays twice on the prose path** (`replayRun` then
   `inspectRun`, which replays internally). Harmless at preview scale;
   consolidation candidate only if inspect grows.

## 3. Ranked Loop 2 Round 2 work

**P1**

1. **Parent gate over the final combined tree.** `pnpm gate`
   (typecheck / lint / test / build) plus `pnpm security:probe` after all six
   Round 1 slots land. My targeted verification (§5) and opus-1's full-suite
   run predate the final tree; nothing in §1.1–1.4 counts as closed until
   this is green. Parent action, not a slot.
2. **Decide and declare `INSPECT_SUMMARY` stability.** Either freeze it
   additive-only like `DoctorJsonReport` (recommended — it is a
   machine-readable surface and scripts will grow against it) or mark it
   explicitly unfrozen-preview in the matrix. Add the
   `test/integration/cli/` coverage opus-1's handoff note assigns there.
3. **Cross-process append probe.** Extend `scripts/bench-runtime.mjs` (or add
   a probe) measuring contended locked-append latency and demonstrating the
   documented row-drop on a held lock, so the residual in §1.2 is *measured*,
   matching the repo's standard that admitted limits get numbers.

**P2**

4. **Adaptation-plane transitive closure check.** Reuse the
   `live-isolation.test.ts` closure walker over the five adaptation
   directories so laundering through an intermediate module is caught
   structurally, not per-known-chain (carries over r3-isolation ranked
   item 3).
5. **Real-provider `--children` coverage** stays smoke-only (`PI_SMOKE=1`).
   Only opt-in coverage may close this — never an outcome claim (carries over
   R3 P1-2).
6. **Retention bounding and the Node engines floor** remain open product
   decisions (R3 P2-4/P2-6); the probe measures, the policy does not exist.
7. **Report line-number hygiene.** Loop-1 reports cite line numbers valid for
   the trees they audited; Round 1 shifts `src/cli/main.ts` and others. Dated
   reports stay as-is (they are snapshots); living docs (matrix, README,
   dictionary) should prefer symbol anchors, as this round's edits do.

## 4. Policy-gated, unchanged

Same table as the R3 acceptance, re-affirmed without movement: Checkpoint
F-PROD stays open (no sealed holdout has run); Outcome-supported stays
forbidden and no matrix row claims it; the P0 privacy sign-off remains a
human act that this loop cannot self-certify; ADR-006 stays Proposed with no
`extensions/pi-sparkle/` import; live R1/bandit/topology stay off the
execution path, enforced by `live-isolation.test.ts`, which no Round 1 slot
touched.

## 5. Verification performed for this report

Against the shared Round 1 working tree (Node v22.22.2, pnpm 10.17.1):

- `pnpm exec tsc --noEmit` — clean.
- `pnpm test -- test/unit/privacy/plane-boundary.test.ts
  test/unit/run/inspection.test.ts test/unit/privacy/deletion.test.ts
  test/unit/routing/cost-calibration.test.ts` — **48 pass / 0 fail**.
- `pnpm test -- test/unit/telemetry/invocation-log.test.ts
  test/unit/privacy/deletion.test.ts` — **32 pass / 0 fail**.
- `pnpm test -- test/integration/m2.5/cli-contract-honesty.test.ts` —
  **1 pass / 0 fail** (the §1.4 pin, after it landed mid-round).
- One earlier targeted run showed 2 transient failures while a sibling was
  mid-write to the same files; both immediate re-runs were green. This is why
  §3 P1-1 (the parent gate over the *final* tree) is ranked first.

## Standing constraints

Re-affirmed unchanged: nothing in this repo is Outcome-supported; Checkpoint
F-PROD and the P0 privacy sign-off stay open; ADR-006 stays Proposed; live
R1, bandit, and topology stay off the execution path; the package stays
`private: true` developer preview.
