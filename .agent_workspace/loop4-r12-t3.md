[Model: opus-fast]

# Loop 4 · Round 12 · R12-3 — production-reachability proof for `unmet-acceptance-criterion`

Mandate: brief `.agent_workspace/ROUND11-BRIEF.md` §4 R12-3, review finding §6.4, ownership row R12-3. One new file, test-only, no `src/**`, no edit to `unblock-flow.test.ts`.

## 1. Census before writing (working tree, `2026-08-25T00:47Z`–`00:51Z`, HEAD `d694de1`)

- **Path exists, verified before writing** (standing rule): `ls test/integration/run/` at `00:47Z` returned exactly one entry, `unblock-flow.test.ts` (49082 bytes, mtime `Aug 25 00:05`). The directory is real; the new file is its second occupant.
- **Branch** `agent/opt-continuous` throughout. No `git checkout`, no commit, no push, no `git worktree`.
- Source path read end to end before writing, to confirm the brief's claimed channel and to predict the shape rather than discover it by trial:
  - `src/run/child-tracking.ts:72-83` — `observationFromChild` spreads the child's `terminalResult.verification` **wholesale** (`...(verification !== undefined ? { verification } : {})`), so `criteria` rides through untouched. This is the brief's `child-tracking.ts:80`.
  - `src/tracking/from-child.ts:52-54,136` — `unmetCriteriaOf` filters reported `FAILED` only; `assessChildObservation` supplies it as the required `gateFacts.criterionUnmet`.
  - `src/tracking/gates.ts:44` — `unmet-acceptance-criterion` pushed after `claimed-verification-without-checks`, before `repeated-no-progress`; hard.
  - `src/run/gate-apply.ts:252-287` — `mapGateDirective` sends a hard gate with no `user-reject-stop` to `queue_analysis`/`BLOCKED`, stamping `reasonCode: gate.codes[0]`.
  - `src/run/flowchart-run.ts:739-779` — `alreadyTerminal` is why the run lands BLOCKED even though the node COMPLETED: the gate's `RUN_BLOCKED` is already on the log when `persistCompleted` runs, so no `RUN_COMPLETED` is appended and `finish` reports what replay says. The docstring names this rule explicitly ("The gate wins").
- **Consumer census: none, as the brief expected.** `rg "criteria-gate"` across the tree (excluding `node_modules`/`.agent_workspace`) returns zero hits. Test discovery is a recursive directory walk in `scripts/run-tests.mjs:6-18` (`entry.name.endsWith(".test.ts")`), so there is no registry, manifest or fixed file list to update. The three files that mention the sibling (`test/integration/cli/unblock.test.ts`, `scripts/crash-probe.mjs`, `src/run/gate-apply.ts:229`) reference it in prose only and do not enumerate the directory. No pin file censuses the `test/` tree — checked `option-a-preconditions`, `criteria-are-guidance`, `gate-status-posture`, `live-isolation`, `episode-contract-boundary`; all of them census `src`.
- **`live-isolation.test.ts` not run, and correctly so**: this slot adds no import inside the live closure — it adds no `src` file at all, and test modules are not in the closure the 215-module census walks.

## 2. What landed

One new file, `test/integration/run/criteria-gate.test.ts`, **+4 registered tests, 0 skips**. Nothing else in the tree changed (`git status --short` at `00:50:59Z`: exactly one `??` line, this file).

### 2.1 The block (test 1)

A test executor yields a terminal `TASK_RESULT` with `outcome: "SUCCESS"` and `verification: { kind: "PASSED", evidenceIds: [evd_task_run], criteria: [{ id: "ac_no_regression", kind: "FAILED", evidenceIds: [evd_criterion_suite] }] }` — one clustered child, `startFlowchartRun` with `cluster: true`, no loopback server and no live provider. Asserted, in order:

- `reporting.taskIds` is `[tsk_migrate]` and **`snapshot.nodes[NODE].state === "COMPLETED"`** — the node succeeded. This is the whole point of the shape: nothing in the flowchart plane failed, so the block cannot be attributed to a failed node.
- **`outcome.status === "BLOCKED"`** — the run itself, which is the gap review §6.4 named. `terminals(events)` is `["RUN_BLOCKED"]`, `replayedTerminalStatus` is `BLOCKED`, `replayRun(...).anomalies` is `[]`.
- The criteria array is durable on the parent log: the `CHILD_MESSAGE` row's `TASK_RESULT.verification.criteria` deep-equals what the child reported.
- Exactly one `TRACKING_ASSESSMENT`, whose `gate.kind` is `"hard"` and whose `gate.codes` deep-equals **`["unmet-acceptance-criterion"]`** — a whole-array equality, not an `includes`. That is what rules out a second code doing the work: every other hard code is ordered ahead of this one in `gates.ts`, so any of them firing would take `codes[0]` and stamp a different `reasonCode`.
- Exactly one `GATE_TRANSITION`, with `reasonCode: "unmet-acceptance-criterion"`, `from: "RUNNING"`, `to: "BLOCKED"`, `directive: "queue_analysis"`, `turnId: NODE`, and `evidenceRefs` containing the **criterion's own** evidence id — the auditability property `evidenceRefsOf` exists for.

### 2.2 The sanctioned exit (same test)

- The block names no failed node (`gateBlockedFailedNode` requires `state === "FAILED"`; here it is COMPLETED), so it takes no retry target. Asking for one is refused by the transform — `assert.rejects(..., /cannot reopen node tsk_migrate in state COMPLETED: only a FAILED node can be re-driven/)` — and, since the transform runs before the append, writes nothing (asserted afterwards: `replayedTerminalStatus(unblocked.events)` is `undefined` and there is exactly one authorization).
- `unblockFlowchartRun` with reason only → status `RUNNING`; exactly one `RUN_UNBLOCKED` whose payload deep-equals `{ blockedEventId, reason }` (two keys, no `retryNodeId`) against the `activeBlockedEventId` replay named.
- `resumeFlowchartRun` → **`COMPLETED`**, `terminals` `["RUN_BLOCKED", "RUN_COMPLETED"]`, `replayedTerminalStatus` `COMPLETED`, zero anomalies, and the resume executor's `taskIds` is `[]` — a completed node is not re-driven, so the block really was the only thing between this run and its terminal.

### 2.3 The control (tests 2–4, one per arm)

The identical run shape with exactly one field changed, in three arms: criterion `PASSED`, criterion `UNOBSERVED`, `criteria` omitted. Each asserts the child ran the same once, the node COMPLETED, the run **COMPLETED**, `terminals` `["RUN_COMPLETED"]`, zero anomalies, and the reported criteria round-trip to what the arm sent.

The load-bearing part of the control is not "it completed" but the two lines after it: exactly one `TRACKING_ASSESSMENT` with `gate.kind === "none"` and `gate.codes` deep-equal `[]`, and **zero** `GATE_TRANSITION`s. Without those, an arm that silently stopped reaching the gate at all (admission declined, assessment skipped) would pass the completion assertions while proving nothing about the criterion. With them, the gate demonstrably assessed the same child through the same path and returned no directive.

Arms 2 and 3 are also the frozen unknown-is-not-unmet rule seen from production rather than from the unit gate: `UNOBSERVED` says the verifier did not look, absence says it spoke only about the whole task, and neither is the child saying it fell short.

### 2.4 Two deliberate fixture choices, stated in-source

- **Role `implementer`, `acceptanceCriteria: []` on the spec.** Only a tester's asked-for criteria become `requiredChecks` (`child-tracking.ts:60-65`), so this shape has none. That leaves nothing request-derived that could be producing the block — the gate is reading what the child *reported*, and it does so whatever the role, which is the property `prescore.ts`'s obligation 2 records.
- **The summary is not a success boast.** `isSuccessClaim` matches `/pass|passed|verified|succeed/i`; a match would recruit `evidence-consistency` and `derivedClaimedVerificationWithoutChecks` into the result. Keeping the prose plain leaves exactly one variable between the block and its controls.

## 3. Non-vacuity — mutation-proved, out of tree

The shared working tree was never mutated. Both mutations ran in a throwaway copy at `/tmp/r12t3-mut` (`src`, `test`, `scripts`, `prompts`, configs copied; `node_modules` symlinked), which was confirmed green first (4/4) and deleted afterwards. This keeps the standing "no `src/**`" rule and avoids putting a transiently-broken `src` in front of a concurrent sibling's test run.

| Mutation (in the copy only) | Result |
|---|---|
| baseline, unmutated | 4 pass / 0 fail |
| `src/tracking/gates.ts:44` → `void input.criterionUnmet;` (the hard code removed) | **1 fail** / 3 pass — test 1 fails at `blocked.status`, `actual: 'COMPLETED'`, `expected: 'BLOCKED'` |
| `src/run/child-tracking.ts:80` wholesale spread narrowed to `{ kind, evidenceIds }` (the criteria channel severed at the exact line the brief names) | **1 fail** / 3 pass — identical failure, `actual: 'COMPLETED'`, `expected: 'BLOCKED'` |

Two things are worth reading off that table. First, the failure mode is `COMPLETED`, not some other error: with the channel cut, this run *completes*, which is precisely the reachability claim stated as its own negation. Second, in both mutations the three control arms stay green — the mutation moves only the arm it should, so the controls are measuring the criterion and not the harness.

## 4. Verification

All on this VM, Node v22.14.0 (engine warning only), branch `agent/opt-continuous`, working tree otherwise untouched.

- `npx eslint test/integration/run/criteria-gate.test.ts` — clean, exit 0. (Scoped, per the standing rule.)
- `npx tsc --noEmit` — **whole tree**, clean, exit 0, 6.2 s.
- `npx tsx --test test/integration/run/criteria-gate.test.ts` **3×** (the file drives real child coordinators over real temp dirs, so it takes the timing-sensitive treatment): 4 tests / 4 pass / 0 fail / **0 skipped** on every run; durations 285 ms, 280 ms, 288 ms.
- **Zero new skips.** Every run reports `# skipped 0`; this slot introduces no conditional or gated test.
- No full gate (parent's job, per dispatch). No scratch files at report time — `/tmp/r12t3-mut` deleted, and `git status --short` shows exactly one entry, the new test.

## 5. Frozen contracts touched: none

No `src/**`, no protocol or gate source, no `unblock-flow.test.ts`, no pin file, no `package.json`. No fourth `RunStatus` (the run uses the existing BLOCKED/COMPLETED and asserts the trio's behaviour rather than extending it). No new `RUN_UNBLOCKED` key — the authorization payload is asserted to have exactly the two it earns here. No dependency, no fs primitive, no live provider, no loopback. Option (a)'s schema is exercised as shipped and not modified.

## 6. Notes for the reviewer

1. **The shape is more interesting than the brief predicted, and in the right direction.** Because the whole-task verdict is PASSED, the node lands **COMPLETED** and the flowchart supervisor's own status is COMPLETED — the run is BLOCKED purely because `alreadyTerminal` sees the gate's `RUN_BLOCKED` first. So this file measures the "gate wins" rule in `flowchart-run.ts:739-756` from the one direction the existing suite could not: the sibling's R6-1 seed reaches that rule with a FAILED node and a FAILED verdict, where the block and the failure agree. Here they disagree, and the gate still wins.
2. **This block's sanctioned exit is the no-retry-node one, and that is a consequence, not a choice.** `gateBlockedFailedNode` gates on `state === "FAILED"`, so a criterion block behind a COMPLETED node names no target — the same door the run-level stall shape uses. The refusal assertion in test 1 pins that, with the exact producer message. Worth recording because it means `--discard-executed` is unavailable for this block class too (`flowchart-run.ts:1956` refuses when the block names no failed node) — correctly, since there is no failed node whose consequences it could discard.
3. **Nothing prescribed for another slot.** Zero consumers, no pin obligations, no follow-up. The gate count should move `+4` from this slot alone.
