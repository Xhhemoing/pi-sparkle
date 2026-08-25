MODEL_SLUG: claude-opus-5-thinking-high-fast

# Loop 4 · Round 22 · slot R22-2 — the flowchart plane now carries a run-level `maxCostUsd`

Branch `cursor/opt-r22-42b1`. **Not committed** (per dispatch). No PROGRESS tick. No
`git checkout`. No files owned by R22-1 or R22-3 touched.

## 1. Verdict

Landed the handoff exactly as ROUND22-BRIEF §4 R22-2 specifies. The plane the CLI `--children`
compiles onto no longer discards a declared run-level spend ceiling: it accepts one on
`FlowchartRunInput`, refuses a bad one before any write, stamps a good one onto the run's own
`RUN_CREATED.limits`, hands it to `ChildCoordinator` at both call sites, and restores it on resume
from that durable record only.

Audit P2's defect transcript is inverted. The proof shape the audit ran as part B
(`B. child execution request maxCostUsd: [ undefined ]` / `B. child RUN_CREATED …: [ undefined ]` /
`B. flowchart RUN_CREATED run.limits.maxCostUsd: [ undefined ]`) is now `0.5 / 0.5 / 0.5` for the
same one-child, no-per-child-cap arc, and the part-B *absence* shape is preserved verbatim as the
control when no cap is declared.

## 2. Files in this diff (mine only)

| Path | Change |
|---|---|
| `src/run/flowchart-run.ts` | input field, pre-lock refusal, `RUN_CREATED` stamp, `attachChildRuntime` param + spread, both call sites |
| `test/integration/m2.5/flowchart-run-cap.test.ts` | new, 5 tests |
| `docs/specs/m0-m2-architecture.md` | one new bullet beside the `:359-366` budget clauses (now `:367-383`) |
| `docs/data-dictionary.md` | `:163-166` sentence extended (conditional triggered — see §6) |

`git status` also shows R22-1's uncommitted `docs/kernel-reuse.md` and
`.agents/skills/pi-sparkle/references/kernel-reuse.md` edits in the shared working tree. Untouched
by me; excluded from every diff and lint invocation below.

## 3. The landing, clause by clause against the contract

- **`FlowchartRunInput.maxCostUsd?: number` beside `childTasks`** (`:142`, after the `childTasks`
  field). **Not** on `FlowchartRunLimits` — that interface is byte-unchanged, as is
  `validateFlowchartRunLimits` and `resolveLimits`. **No `FlowchartContinuation` counterpart** —
  that interface is byte-unchanged.
- **Fail-closed in the pre-lock refusal zone** (`:1366-1374`, immediately after
  `resolveLimits(input.limits)` and before the coverage assert / executor check, i.e. inside the
  block the file's own comment marks as "everything that can refuse the run before it has written
  anything"). Anything present that is not a positive finite number throws
  `DomainValidationError("flowchart maxCostUsd must be a positive finite number of US dollars")`.
  The predicate is `typeof !== "number" || !Number.isFinite(v) || v <= 0`, the same rule
  `limits.ts:52` and `replay.ts:587` already use, so an embedder cannot reach a durable record with
  a value `validateRun` would reject.
- **Stamped at `RUN_CREATED`** (`:1429-1436`):
  `...(input.maxCostUsd !== undefined ? { maxCostUsd: input.maxCostUsd } : {})` inside the run
  record's `limits`. Absent stays an absent key; write-side validated by `validateRun` through
  `events.ts:619`.
- **`attachChildRuntime` input gains `readonly maxCostUsd?: number`** (`:706-707`) and spreads it
  into the `ChildCoordinator` deps (`:756`) in exactly `coordinator.ts:726`'s shape, in the same
  position relative to `maxConcurrentTasks` / `now`.
- **Start call site** (`:1503`) passes `run.limits.maxCostUsd` — read back off the record the run
  just wrote, not off `input`, so the coordinator and the durable record cannot disagree.
- **Resume call site** (`:1713-1718`) passes `replayed.run.limits.maxCostUsd`.

### The five "must NOT"s, each checked in the diff

- **`TASK_REQUEST.limits`** — untouched. `child-coordinator.ts:403` builds it from `input.limits`
  verbatim and nothing in my diff reaches it. Pinned negatively in three of the five tests, and
  mutant M7 (below) proves the pins bite.
- **`taskCostCeilings`** — `plannedTaskCostCeilings`, `advanceTaskCostCeilings`, `declaredCeiling`
  and `byCeilingTaskId` are byte-unchanged. Two tests assert the record stays `undefined` for a
  capped run whose children declare nothing.
- **`fallbackChildLimits` / `withRecordedCostCeilings`** — byte-unchanged. Worth stating why the
  new key on `RUN_CREATED.limits` cannot leak through the substitution path: `fallbackChildLimits`
  reaches `event.payload.run.limits` (`:550`) but constructs its return from
  `maxAttemptsPerTask` / `FALLBACK_CHILD_TIMEOUT_MS` / `maxWallTimeMs` by name, never by spread, so
  R20-1's ceiling-free substitution holds unchanged. Test 5 confirms it empirically: the
  substituted child's `TASK_REQUEST.limits` is exactly the three fields.
- **`remainingCostUsd`, `replay.ts`, `child-coordinator.ts`, checkpoint schema, adaptation-plane
  imports** — none appear in the diff. No new import edge in `flowchart-run.ts`;
  `DomainValidationError` was already imported at `:1`. Checkpoint `schemaVersion` untouched.
- **Effective cap** — still `costCapFor` = `Math.min(per-task, run-level)` at
  `child-coordinator.ts:413-418`, unedited. Test 2 pins both directions.

## 4. Tests — `test/integration/m2.5/flowchart-run-cap.test.ts` (new, 5 cases)

Self-contained: its own `PassingExecutor` (records `AgentExecutionRequest.maxCostUsd` per task,
keyed so "ran uncapped" is distinguishable from "never ran"), `TogglePause`, `testerChild`, and
disk readers, modelled on `resume.test.ts`'s R20-1 block so the two read alike.

| # | Test name (as it appears in TAP) | Pins |
|---|---|---|
| 1 | `a run-level cap reaches the child's execution request and both RUN_CREATED records` | flowchart `RUN_CREATED.limits.maxCostUsd` = 0.5; child `RUN_CREATED` = 0.5; execution request = 0.5; `TASK_REQUEST.limits` = the three fields only; `taskCostCeilings` `undefined` |
| 2 | `each child attempt runs under the tighter of its own ceiling and the run-level cap` | per-child 0.1 under run 0.5 → 0.1 on both records + request; per-child 0.9 under run 0.5 → request/child-record 0.5 while `TASK_REQUEST` keeps the declared 0.9; the ceiling record keeps declared, not effective |
| 3 | `a run declaring no cap keeps an absent key on every record it writes` | audit part-B control: `Object.hasOwn(limits, "maxCostUsd") === false` on the flowchart record, `undefined` request + child record, `taskCostCeilings` `undefined` |
| 4 | `a run-level cap that is not a positive finite number is refused before any write` | `0`, `-1`, `-0.5`, `NaN`, `Infinity`, `"0.5"`, `null` each throw `DomainValidationError` with the message byte-pinned; the executor is never reached; `readdir(stateRoot)` is `[]` — no `runtime/`, no log, no lock |
| 5 | `a resume restores the run-level cap from the replayed RUN_CREATED without inventing a per-task one` | pause-after-first shape from `resume.test.ts`; the substituted `tsk_second`'s request and child `RUN_CREATED` carry 0.5 while its `TASK_REQUEST.limits` gains no cap and `taskCostCeilings` stays `undefined` across the resume's own checkpoint writes |

Test *names* verified present in the TAP output of every run below.

### 3× owned-suite transcript (in-tree, `/tmp/tsx-*` cleared before each)

Three byte-identical bodies:

```
ok 1 - a run-level cap reaches the child's execution request and both RUN_CREATED records
ok 2 - each child attempt runs under the tighter of its own ceiling and the run-level cap
ok 3 - a run declaring no cap keeps an absent key on every record it writes
ok 4 - a run-level cap that is not a positive finite number is refused before any write
ok 5 - a resume restores the run-level cap from the replayed RUN_CREATED without inventing a per-task one
# tests 5
# pass 5
# fail 0
# cancelled 0
# skipped 0
```

## 5. Mutation proofs (out-of-tree `/tmp/r22-2`, full `git ls-files` copy, `node_modules`
symlinked, deleted afterwards)

Baseline in the copy: 5/5 pass. Then, one mutant at a time, restore-and-reapply, `/tmp/tsx-*`
cleared before each:

| Mutant | Result |
|---|---|
| M1 start call site drops the cap | 2 fail — tests 1, 2 |
| M2 resume call site drops the restored cap | 1 fail — test 5 |
| M3 `RUN_CREATED` stamping removed | 3 fail — tests 1, 2, 5 |
| M4 stamp becomes an unconditional `maxCostUsd: input.maxCostUsd as number` | **survived — equivalent, see below** |
| M4a stamp invents `input.maxCostUsd ?? 1` | 1 fail — test 3 |
| M4b coordinator handoff invents `input.maxCostUsd ?? 1` | 1 fail — test 3 |
| M5 pre-lock validation deleted | 1 fail — test 4 |
| M6 validation *moved* into `startLockedFlowchartRun` (still throws, but after the lock) | 1 fail — test 4, on `a refused start leaves the state root untouched`, actual `['runtime']` vs expected `[]` |
| M7 run-level cap leaked into `buildTaskRequest`'s `limits` | 3 fail — tests 1, 2, 5 |
| M8 `costCapFor` `Math.min` → `Math.max` | 1 fail — test 2 |

M6 is the one that matters most for honesty: it proves test 4 pins the *placement* of the refusal,
not merely that a throw happens.

**M4 is an equivalent mutant, not a gap, and here is the proof rather than the assertion.** The
mutant makes the in-memory record carry an own `maxCostUsd` key holding `undefined`. Every boundary
the run exposes is JSON: the record reaches disk through `EventStore.append`, and
`JSON.stringify` omits an own key whose value is `undefined`, so the durable bytes are identical to
the absent-key case; `FlowchartRunOutcome.events` is `read.events`, re-read from that same log, so
it cannot differ either; and the handoff at `:1503` tests `!== undefined`, which is false in both
worlds. There is no observer that could distinguish them, so no test could kill it without
asserting on a private in-memory object. M4a and M4b are the same class of defect made *observable*
(a synthesized default cap) and both die. M8 lives in `child-coordinator.ts`, which I may not edit —
it was mutated only in the out-of-tree copy, to show test 2's tighter-of pins have teeth against the
enforcement side as well as the handoff.

Copy deleted; `ls /tmp/r22-2 /tmp/tsx-*` is empty at report time. No scratch files remain in the
tree or in `/tmp`.

## 6. Docs

**`docs/specs/m0-m2-architecture.md`** — one new bullet immediately after the `maxCostUsd` bullet
and immediately before the flowchart-resume paragraph the brief cites (the `:368-381` clauses,
now `:385-398`). It states: declared by the caller on `startFlowchartRun`'s own input rather than on
`FlowchartRunLimits` and why; refused pre-lock with `DomainValidationError` so a refused start leaves
the state root untouched; stamped into the run's `RUN_CREATED.limits` (durable, `validateRun`-checked,
absent key when undeclared); handed to the child coordinator under the unchanged tighter-of rule;
coordinator state and therefore never in a `TASK_REQUEST.limits`, never in `taskCostCeilings`, and
not altering the ceiling-free substitution; restored on resume only from the replayed record, with
no `FlowchartContinuation` counterpart; never synthesized.

**`docs/data-dictionary.md:158-165` — the conditional fired, so it is extended in this diff.** The
existing sentence read "a declared ceiling comes back only from the durable `taskCostCeilings`
record", inside the paragraph about a *substituted* node. After this landing that sentence would
tell a reader that a substituted node with no entry in that record resumes uncapped, which test 5
proves false: it resumes under the run-level cap restored from `RUN_CREATED.limits`. Narrowed to
"a declared **per-task** ceiling", and the run-level ceiling named as the separate durable source it
now is. No other clause in that paragraph changed.

Nothing else needed a docs pass: `docs/status-matrix.md` row 38 is R22-3's (§4 ownership) and
`docs/kernel-reuse.md`'s `maxCostUsd` claim gate is `rg -n "maxCostUsd" src/run/coordinator.ts`
(still exactly 2 hits — I did not touch `coordinator.ts`), so R22-1's file is not stale-ified by me.

## 7. Verification run at report time

| Check | Result |
|---|---|
| `npx tsc --noEmit` (whole tree, not scoped) | exit 0 |
| `npx eslint src/run/flowchart-run.ts test/integration/m2.5/flowchart-run-cap.test.ts` | exit 0 |
| Owned suite 3× (`/tmp/tsx-*` cleared each time) | 5/5 pass, three identical transcripts |
| `test/integration/m2.5/*` + `test/unit/run/*` + `test/integration/m1/cli-children.test.ts` | 279 tests / 279 pass / 0 fail |
| `resume.test.ts`, `children-flowchart.test.ts`, `flowchart-run.test.ts` specifically | green, untouched |
| `node scripts/run-tests.mjs` (whole gate; the parent's job, run here as insurance) | exit 0 — **2055 tests / 2054 pass / 0 fail / 0 cancelled / 1 skipped / 120 suites**, exactly one `# SKIP` (`PI_SMOKE`) |
| `node scripts/crash-probe.mjs` | exit 0, `ok: true`, 11 cases × 3 iterations, `unblock-discard-append-before-checkpoint-sigkill` last |
| `node scripts/kernel-reuse-probe.mjs` | 3 PASS, exit 0 |

The gate delta against the brief's §2 baseline (2050 / 2049 / 1 skip / 120 suites) is **+5 tests,
+5 pass, suites unchanged** — my five, and nothing else moved. R22-1's doc edits were present in the
tree for that run and add no tests, which the delta confirms.

No perf claim is made.

## 8. Notes for the parent

- **R22-3 compiles against this.** `FlowchartRunInput.maxCostUsd` is landed with the exact spelling
  §4 R22-3 references for its `--children` forwarding
  (`...(cap !== undefined ? { maxCostUsd: cap } : {})` into the `startFlowchartRun` input).
- **The refusal message is not in any frozen set.** `flowchart maxCostUsd must be a positive finite
  number of US dollars` is a library-level message, byte-pinned only by my own test 4. It is
  deliberately distinct from R22-3's frozen CLI message (`--max-cost-usd must be a positive finite
  number of US dollars, got: <raw>`), so a CLI-layer refusal and a library-layer refusal stay
  distinguishable in a transcript. If the parent wants it frozen, that is a one-line addition to the
  next brief's §3; I have not asserted it is frozen.
- **The `--children` path still has no cross-child ledger,** and this landing does not create one:
  N children under one run cap can spend up to N times it between them. That is
  `child-coordinator.ts:56-63`'s disclosed semantics, restated in the new `FlowchartRunInput` doc
  comment so an embedder reading the field cannot conclude otherwise. R22-3 owes the same sentence
  in USAGE per its §4.
- **Not committed, as instructed.** The working tree also holds R22-1's uncommitted edits; whoever
  commits will need to split by ownership.
