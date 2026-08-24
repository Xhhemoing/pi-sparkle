[Model: claude-opus-5-thinking-high-fast]

# R9-6 — the gate's near-write-only reconstruction: posture recorded, absence pinned

**Verdict: the posture is the parent's, recorded in source, and now mechanical.** `GateApplyResult.runStatus` gained no consumer. `src/run/gate-apply.ts` changed by comments only (diff verified: every added line is a comment line). One new additive file, `test/unit/run/gate-status-posture.test.ts` (8 tests, all mutation-checked).

---

## 1. Census (working tree, 2026-08-24 ~22:30 UTC, branch `agent/opt-continuous`, base `8f45505`)

### 1.1 Producers of `GateApplyResult`

| Producer | Sites |
|---|---|
| `src/run/gate-apply.ts::applyTrackingGate` | 5 returns: idempotent-transition replay (`existing.payload.to`), duplicate-assessment replay (`currentGateStatus`), `directive: "none"` (`from`), and the two written-transition returns (`mapped.runStatus`) |
| `src/run/child-tracking.ts::applyChildThreeLine` | the `skipped` literal (`runStatus: "RUNNING"`, four refusal paths) + pass-through of `applyTrackingGate` |

Nothing else in `src/**` constructs one. `applyTrackingGate` has exactly one `src` caller (`child-tracking.ts`); `applyChildThreeLine` has exactly two (`flowchart-run.ts`, `coordinator.ts`).

### 1.2 Who reads what, per plane

| Consumer | `events` | `directive` | `runStatus` | `applied` | `transitionId` |
|---|---|---|---|---|---|
| **flowchart plane** — `flowchart-run.ts::executeClusteredNode` (call at `:547`) | read | **discarded** | **discarded** | **discarded** | **discarded** |
| **parent DAG plane** — `coordinator.ts` (call at `:693`) | read | read (`wait_user` → WAITING_FOR_USER; `queue_analysis` → BLOCKED) | **discarded** | **discarded** | **discarded** |

The flowchart plane binds `const gated = …` and touches **only** `gated.events` — the entire `result` is dropped. Its control comes from `flowchartStatus(ctx.supervisor)` (`:619`, the `FlowchartSupervisor` state machine) and its reported status from `replayRun(read.events).status` in `finish` (`:789`/`:793`). So the gate reaches that plane strictly as the `RUN_BLOCKED` / `RUN_WAITING_FOR_USER` events it appended, arbitrated at `alreadyTerminal` (`:744`, whose docstring already records "the gate wins" for the BLOCKED-and-FAILED collision).

**Global result: `runStatus` has zero readers anywhere in `src/**` outside `gate-apply.ts` itself.** A word-boundary sweep finds the identifier in only two files, and in `child-tracking.ts` it is a single object-literal *write*. Inside `gate-apply.ts` the only dereferences are `mapped.runStatus` (twice, into the transition payload and the return). `applied` and `transitionId` likewise have no `src` reader; `directive` has exactly one. This is a stronger fact than R8-1 §11.3 stated (it named the flowchart path); the parent plane discards it too.

### 1.3 Test-side readers (unchanged by me)

`test/unit/run/gate-apply.test.ts` asserts `result.runStatus` at three sites; `test/integration/track/gate-apply.test.ts` reads only `result.applied`. `currentGateStatus` has exactly one end-to-end observer: the re-block cycle at `test/integration/run/unblock-flow.test.ts:276`, via `from: "RUNNING"` on the second transition. Confirmed by reading it, not by report hearsay.

### 1.4 Why it is nearly unobservable

`currentGateStatus` surfaces in production only through the `from` field of a **subsequently** written transition. A recovering run writes none — a passing re-verification maps to `directive: "none"`, which returns before the `GATE_TRANSITION` push. Only a run that fails a second time reads the reconstruction back. That is the whole reason R8-1's mutation "`currentGateStatus` ignores `RUN_UNBLOCKED`" was caught by exactly one test.

---

## 2. What I changed

**`src/run/gate-apply.ts` — comments only, two docstrings.**

1. A new docstring on `GateApplyResult` stating the posture: `runStatus` is a **consistency ledger for the transition record, not a control input** (attributed `Loop 4 R9-6, parent-signed`); it reports what this apply wrote — or would have written — into `GATE_TRANSITION.payload.to`; **outside this module nothing reads it**; the per-plane census above in two bullets; and the refusal, spelled out: wiring it into either plane's control flow moves the gate from writing the record to driving the run, which needs its own justification, because the adjacent authority question is settled — **soft and hard both block** (R8-4 C7). It names `child-tracking.ts::applyChildThreeLine` explicitly so a reader arriving from there lands here.
2. An added paragraph on `currentGateStatus`: **this reconstruction never decides anything**; it is **observable only through the `from` field** of a subsequently written transition; the recovering run writes none; exactly one end-to-end shape observes it; keeping it in step with replay is an obligation about the record, not a control path. The existing R8-1 paragraph (the active-block-id rule) is untouched.

**`test/unit/run/gate-status-posture.test.ts` — new, additive, 8 tests.** No other file touched.

---

## 3. The pins

| # | Pin | Holds down |
|---|---|---|
| 1 | The posture is recorded at `GateApplyResult` **and** at `currentGateStatus` | four phrases in the first docstring, two in the second |
| 2 | **`runStatus` has no reader outside `src/run/gate-apply.ts`** — AST sweep over all 215 `src/**/*.ts` | the parent sign-off: no new consumer |
| 3 | **The flowchart path uses the gate's answer only for `events`** — AST over the real `flowchart-run.ts` | "still does not feed `runStatus` back into control" |
| 4 | Synthetic mutation checks for pins 1–3 | the pins reject property reads, index reads, destructures, a flowchart consumer, and a dropped record |
| 5 | Real-source mutation checks + rewrap-safety | see §3.2 |
| 6 | `result.runStatus === transition.payload.to` and `result.transitionId === payload.transitionId` | makes "consistency ledger for the transition record" mechanical rather than prose |
| 7 | With `directive: "none"`, no transition is written and `runStatus` is the reconstructed `from` (BLOCKED over a blocked log) | the "or would have written" half of the same claim |
| 8 | **`currentGateStatus` still reads a matched `RUN_UNBLOCKED` as RUNNING** (`from: "RUNNING"`), an unmatched one as BLOCKED | R8-1's contract, now also at the unit boundary — it previously had exactly one observer, and that one was an integration test |

### 3.1 Comment-rewrap-safety, by construction

Pin 1 does not grep the file. It resolves the declaration through the TypeScript AST, takes its leading comment ranges, strips `/**`, `*/` and per-line `*`, collapses all whitespace runs to single spaces, then substring-matches. Rewrapping, re-indenting, or joining lines cannot break it; only restating the posture in different words can.

Proven, not asserted: pin 5 reflows the **real** `gate-apply.ts` by joining every continuation line (291 newlines → 248, the whole docstring on one line) and re-runs pin 1 green.

### 3.2 Mutation-checked against the real files, in memory

Every absence pin is exercised against the sources as they actually are — no disk write, so no other slot's in-flight work is disturbed:

| Mutation applied to the real source | Pin that goes red |
|---|---|
| `gate-apply.ts` with `"consistency ledger"` → `"record"` | 1 |
| `gate-apply.ts` fully reflowed onto one line | *stays green* (rewrap-safety) |
| `flowchart-run.ts` + `void <binding>.result.runStatus;`, where `<binding>` is read out of the real file rather than hard-coded | 3 **and** 2 |

Plus the synthetic set (pin 4): `x.result.runStatus`, `const { runStatus } = x`, `x["runStatus"]`, a flowchart `if (gated.result.runStatus === 'BLOCKED')`, and a `GateApplyResult` with no docstring — all red. And the negative control: an interface member `readonly runStatus: string` together with a literal `{ runStatus: 'RUNNING' }` is **not** a reader, so producers (`child-tracking.ts`'s `skipped`) stay legal.

Pin 3 also asserts `flowchart-run.ts` reaches `applyChildThreeLine` exactly once, and handles destructuring at the call site, so moving to `const { events } = applyChildThreeLine(…)` stays green while `const { result } = …` goes red.

---

## 4. Ownership deviation, disclosed

The parent sign-off says "record the posture in-source at `applyChildThreeLine` / `currentGateStatus`". **`applyChildThreeLine` lives in `src/run/child-tracking.ts`, not in my sole-owned `src/run/gate-apply.ts`** (the brief's §4 R9-6 line names the symbol but the ownership line names only the file). No Round 9 slot owns `child-tracking.ts`, so I did not edit it.

The posture is instead recorded on `GateApplyResult` — the type `applyChildThreeLine` declares as its return, imported from `gate-apply.js`, so jump-to-definition and hover from that signature both land on it — and the comment names `child-tracking.ts::applyChildThreeLine` in the text. **Prescribed for whoever next owns `child-tracking.ts`:** a one-line pointer above `applyChildThreeLine` (`the result's `runStatus` is a ledger entry, not a control input — see {@link GateApplyResult}`). Nothing depends on it; it would only shorten the path for a reader who never opens the return type.

---

## 5. What I did not do

- **No new consumer for `runStatus`.** Pin 2 now makes adding one go red across all of `src/`.
- **No runtime behavior change.** The `gate-apply.ts` diff is comment-only, verified mechanically (`git diff` added lines, all matching a comment-line pattern).
- **`currentGateStatus` still treats a matched `RUN_UNBLOCKED` as RUNNING** — R8-1's contract, untouched in source and now pinned twice (pin 8 at unit level; the re-block cycle integration test unchanged and green).
- **Did not edit `flowchart-run.ts`** (R9-1's file this round) — pins 3 and 5 read it, never write it.
- No `applyRetry`/scheduler contact, no live R1, no ADR-006, no `package.json`, no scratch files, no git operations, still on `agent/opt-continuous`.
- **Did not reopen R8-4 C7.** Soft and hard both block; the comment cites it as settled rather than re-arguing it.

---

## 6. Verification

- `npx tsc --noEmit` **whole tree: clean, exit 0** (run twice — before and after the other slots' in-flight edits landed in the working tree).
- `npx eslint src/run/gate-apply.ts test/unit/run/gate-status-posture.test.ts`: **clean, exit 0**.
- Owned test **3×**: 8/8 pass each, stable (it reads a tree other slots are actively editing, so repetition is meaningful here).
- Consumers: `test/unit/run/**` **195/195 pass**, 0 skip (includes `gate-apply.test.ts`, R8-3's `flowchart-applyretry-absence`, `event-row-fuzz`, `parent-crash-residuals`, `inspection`). `test/integration/run/unblock-flow.test.ts` **8/8** — the re-block cycle's `from: "RUNNING"` still holds.
- **No new skip introduced** by this slot (my file has none; the only skip in the tree remains `PI_SMOKE=1`).
- No full gate (parent's job). No perf claim (comments and one AST-reading unit test; pin 2 parses 215 files in ~450 ms, inside the unit suite's normal range).
- No scratch files in the repo at report time — `git status` shows only my two paths plus other slots' work.

## 7. Shared-tree transient, attributed (not mine)

`test/unit/tracking/option-a-preconditions.test.ts` → **"no shipped executor can produce the verdict the gate admits on" is RED** at the moment of writing: `AssertionError: the pi adapter emits exactly one protocol message: the terminal it synthesizes — actual: 2, expected: 1`.

Attributed to **R9-2**, file `src/pi-adapter/pi-executor.ts` (modified in the working tree, +169 lines): that slot is landing the `report_task_result` producer, which is precisely what R8-4's precondition pin 2 measures the absence of. R9-2 owns replacing pin 2 in the same diff (brief §4 R9-2; `OWNERSHIP.md` R9-2, "pin 2 only"). Independent of my change — my whole diff is two comments in `gate-apply.ts` and one new file. Re-verify after R9-2 lands.

## 8. For the parent

1. **The census is one step stronger than R8-1 §11.3 recorded.** `runStatus` is discarded on the *parent DAG plane* too — the coordinator reads `directive` and nothing else — so it has **zero readers anywhere in `src/`**, not just on the flowchart path. `applied` and `transitionId` are in the same position. If the ledger ever wants a real consumer, `directive` is the only field with a live precedent to argue from.
2. **The `unblock` reopen and this posture are now consistent in writing.** R8-1 made the gate's reconstruction agree with replay; this slot records *why* that agreement is worth maintaining even though nothing reads the result — because the disagreement would be published in the `from` field of the next transition, which is a durable record an operator reads.
3. **A fifth flowchart command, or any new gate directive, inherits pin 3.** It says the flowchart plane reaches `applyChildThreeLine` exactly once and takes only `events`. A second call site trips it deliberately: routing a new plane through the gate should be a decision, in the same way the four-site BLOCKED wiring pin makes routing a new exit one.
