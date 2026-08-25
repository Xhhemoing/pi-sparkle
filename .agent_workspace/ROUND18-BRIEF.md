[Model: claude-fable-5-thinking-xhigh]

# ROUND 18 BRIEF — injection context for Loop 4 · Round 18 dispatch (post-merge)

Provenance: written by the Round 18 post-merge auditor at HEAD `7d8b7a3` on
`cursor/opt-r18-postmerge-42b1` (code tree = merge `985250b`); full sweep evidence and proof
transcripts in `.agent_workspace/loop4-r18-audit.md`. The previous zero-candidate ROUND18-BRIEF was
written for the pre-merge Loop 4 tree and remains correct **for that tree**; PR #8's merge of
Loop 4 + Loop 3 + kernel-reuse into `main` is the new seam its §4 reason 1 anticipated, and this
brief replaces it with the merged tree's audited state: **2 proven candidates — do not pad to 10.**

## 1. What landed last (context, all committed — do not re-implement)

| What | SHA | Landed |
|---|---|---|
| R17-1 / R17-2 | `223e3dd` / `16a471d` | Inferred-preference call removed + plane pinned not-live; migrate-legacy fallback never-overwrite pinned. Both re-verified diff-empty across the merge; all pins green at HEAD. |
| Merge-in | `b52988d` | origin/main (Loop 3 + kernel-reuse) merged into `agent/opt-continuous`: SparkleKernel facade, CostGate, live streaming, steering (`RunningRun.steer`, `STEER_INJECTED`), `THINKING_DELTA` (bytes only), `maxCostUsd` forwarding, inspect-summary projection, feedback-log lock. |
| Merge fixes | `4e13877`, `3684e59` | Test-only: steer event in the exhaustive fuzz seeds; canonical agent id in the steer fixture. |
| CI fixes on #8 | `77e5d42`, `dc0c611`, `159630e` | Kernel events stream live through tool start (verdict still buffered per attempt); adaptation closure allowance shrunk to 4 modules; `maxCostUsd` disclosure rewritten to forwarding + executor-dependent enforcement (`costCapFor` = min of per-task and run caps). **All three verified holding at HEAD** (audit §3). |
| Merge to main | `985250b` | PR #8 merged; `7d8b7a3` on this branch is PROGRESS/OWNERSHIP only, so the gate below stands for HEAD's code. |

## 2. Current baseline (independent, this VM, Node v22.14.0, engine warning only)

- Auditor's own `pnpm gate` at HEAD: **GREEN, exit 0 — 2038 tests / 2037 pass / 0 fail /
  0 cancelled / 1 skipped (PI_SMOKE, exactly one `# SKIP` line) / 120 suites**. This independently
  verifies the merger's claimed 2038/2037/1. Delta vs Round 17 (1981/112) is the merged kernel-reuse
  + Loop 3 test surface plus the CI-fix test rewrites.
- Auditor's own `node scripts/crash-probe.mjs`: **`ok: true`, 11 cases × 3 iterations**, names and
  order verified against the Round 16 record, `unblock-discard-append-before-checkpoint-sigkill`
  last. No 12th case; the script is diff-empty across the merge.
- Both privacy guards green standalone (11/11) — allowlists equal the real import graph in both
  directions (both tests carry stale-entry asserts, so green is bidirectional proof).
- No perf claims this round. Any future perf claim still owes same-VM before/after with an
  unchanged-arm control, ≥5% end-to-end.

## 3. Forbidden / frozen for Round 18 (Rounds 1–17 + merge-settled)

Global forbidden list, unchanged from the Round 17 brief §3: live R1/bandit/topology on the
execution path (doctor's `loadProjectBanditByKey` inventory read stays the only exception);
Outcome-supported claims; **ADR-006 stays Proposed**; auto-promote; P0 privacy sign-off stays human;
`package.json`/dependency edits; git history rewrites; subagents do not commit; no `git checkout` of
other branches; `independentEvidence` never read as corroboration; exact eight-member `RunStatus`;
no fourth `RUN_UNBLOCKED` key.

Frozen contracts: the whole Rounds 1–17 set carried verbatim — jsonl/atomic-write/lock/delete/
crash-terminal/`applyRetry`/resume-disclosure/doctor/routes (five `DOCTOR_ROUTED_NEXT` +
`GENERIC_FAILURE_NEXT`, character-exact)/`INSPECT_SUMMARY` (four frozen-additive keys, now built by
the pure `buildInspectSummaryJson` — same contract)/BLOCKED-prefix/episode-boundary/option (a)/
discard-audit/probe (11 cases, order pinned)/verdict-producer freezes; `taskCriteria` writer as
shipped; `onRunStarted` on all three public run paths; three-path early-id disclosure; the scoped
laundering coda; the comparator soundness rule; the census terminator (**the treadmill stays
closed** — R18-2 below carries the one landing-triggered spec alignment inside its own diff, which
is what the terminator prescribes); `EventStore.append`/`CheckpointStore.write` unlocked (frozen
measured decision); the preferences writer contract (bind inside `preferenceSnapshotLockPath`,
readers lock-free); write-side episode-event validation; atomic eval publish; the migrate-legacy
publish protocol; mailbox/cluster, lock stealing, resume-time adoption, non-terminal `RUN_CRASHED`,
jsonl/lock perf, skipContract honesty, rewriting append-only logs: off the table. The CLI
inferred-preference plane stays not-live; both migrate-legacy publish arms stay pinned; the
`from-episode` ingress stays `run/event-store.ts` alone.

**New, settled by the merge (now frozen):**
- **Do not revert kernel-reuse.** `SparkleKernel`/`AsyncEventQueue`, the CostGate arithmetic
  (arms only with cap + catalog prices; zero-pair = unpriced = disarmed; non-`ok` usage counted by
  the ceiling but excluded from telemetry), and the `maxCostUsd` forward
  (`startRun`/`startParentRun`/`supervisor` → `costCapFor` = min(per-task, run) → request + child
  `RUN_CREATED.limits`) are the shipped contract. An absent cap stays absent — never invent one.
- **Live-through-tool-start streaming as shipped** (`77e5d42`): every translated event streams until
  the task-verdict emit closes the prefix; the verdict and its tail stay buffered per attempt so a
  retried attempt's verdict cannot leak. Do not re-buffer structured events.
- **Thinking stays bytes-only** everywhere outside `src/pi-adapter/**`; nothing thinking-derived may
  ever be routed into `STEER_INJECTED.text` (payload docstring pins this).
- **The adaptation closure allowance is exactly 4 modules** (`dc0c611`); both privacy guards fail
  closed on stale entries — a dispatch that changes an adaptation-plane `src` import edge must
  census **both** `test/unit/privacy/plane-boundary.test.ts` **and**
  `test/unit/privacy/adaptation-plane-closure.test.ts` into its ownership grant up front.
- **`remainingCostUsd` (flowchart routing budget) is a separate, enforced plane** — do not conflate
  it with the executor spend ceiling or "unify" the two.

Process requirements per slot (carried forward): census first against the working tree; verify
handed paths exist; scoped `eslint` + whole-tree `tsc --noEmit` before reporting; consumer census in
your own diff; timing-sensitive owned tests 3×; full gate is the parent's job; no scratch files at
report time (including `/tmp` state roots from proofs); mutations/proofs out-of-tree (full copy,
`node_modules` symlinked), then deleted; landing commits are slot files + report only, no PROGRESS
ticks.

## 4. Round 18 candidates (2 real, proven at HEAD — do not pad to 10)

Both were proven with deterministic out-of-tree runs of real repo code, 3× each, transcripts in
`loop4-r18-audit.md` §4; the proof copies are deleted. Every landing owes destructive/defensive
tests in its own diff.

### R18-1 (P2) — a steered instruction must not silently die in a retry

- **Proven defect:** `runWithRetry` builds a fresh Agent per attempt, so a steer accepted by
  `PiAgentExecutor.steerText` during an attempt that is then retried (429/5xx) never reaches any
  surviving model call. Proof transcript: attempt 1's second provider call carried the steer as its
  second user turn (context then discarded); attempt 2's fresh agent saw only the original prompt;
  the run finished `EXECUTION_FINISHED:SUCCESS`. The coordinator's `STEER_INJECTED` (written
  delivery-before-logging) then permanently records an instruction no surviving call saw — violating
  `execution/contract.ts`'s own rule that "a steer that silently goes nowhere is worse than a
  rejected one".
- **Fix shape (a), recommended:** the executor keeps the accepted steer texts for the current
  `execute()` and re-delivers them into each fresh retry kernel before/at the new prompt (polled
  after the new attempt's first turn — preserves "picked up after its current turn"; the discarded
  context cannot double-apply). Fix shape (b): leave delivery semantics alone and surface the drop —
  an executor-level notification the coordinator turns into a correcting event (log-contract
  change). 
- **Tests owed:** the audit's proof shape as a regression test (steer during blocked tool → 429 →
  retry → assert the steer reaches attempt 2's context under (a), or the drop record exists under
  (b)); existing 10 steer pins stay green untouched; run 3×.
- **Ownership (exclusive):** `src/pi-adapter/pi-executor.ts`, new
  `test/integration/pi-adapter/steer-retry.test.ts` (dir exists),
  `test/unit/pi-adapter/steer-inflight.test.ts` (only if (a) adds executor-level steer state worth a
  unit pin). Under (b) only: add `src/run/coordinator.ts` + `src/run/events.ts` +
  `test/integration/m0/steer.test.ts` to the grant. No adaptation-plane import edges — privacy tests
  stay outside ownership.
- **Parent sign-off needed: YES** — (a) vs (b) is a delivery-semantics/product decision (R17-1
  precedent). An explicit decline of both (recording the drop as an accepted retry cost, with the
  contract docstring amended to say so) is a valid outcome — then that docstring edit is the slot.
- **Parent sign-off (2026-08-25): R18-1 YES — direction (a) re-deliver.** `STEER_INJECTED` already
  claims delivery. A retry that drops the steer makes that record false. Re-deliver accepted steer
  texts into each fresh retry kernel. Do not add a correcting event type (no new `RunStatus`, no
  new route). Existing 10 steer pins stay green.

### R18-2 (P2) — `run --children` must carry a declared `maxCostUsd` to the coordinator

- **Proven defect (merge-induced in the strict sense — neither side had it alone):**
  `parseChildSpec` (`src/cli/main.ts:420-424`) copies only `maxAttempts`/`timeoutMs`/`maxWallTimeMs`,
  silently discarding `maxCostUsd`. Harmless while the field was disclosed-unenforced (pre-merge
  Loop 4 tree); dishonest now that `costCapFor` forwards it to the executor and stamps it into the
  child's `RUN_CREATED.limits`. Proof transcript: spec declared `maxCostUsd: 0.25`;
  `validateAgentMessage` accepted that exact limits object (control); CLI exit 0, no warning; the
  on-disk `TASK_REQUEST.limits` and child `RUN_CREATED.limits` carry no ceiling. Forwarding-when-
  present is already pinned green (`child-coordinator-limits.test.ts`), so the drop is localized to
  the parse.
- **Fix:** copy a positive finite `maxCostUsd` in `parseChildSpec`; **refuse** any other
  non-undefined value with `DomainValidationError` naming the task (silently copying an invalid
  value would fail far away at message validation). Executor-dependence stays as disclosed — the
  fake-children executor ignoring the forwarded cap is the pinned contract, not a bug.
- **Fold in (landing-triggered census, terminator-compliant):**
  `docs/specs/m0-m2-architecture.md:359-360` still claims the child coordinator "does not currently
  read usage or enforce this ceiling" — false since `159630e`; rewrite to match the
  `ChildRunLimits` disclosure. The CI fix updated protocol/v1, child-coordinator and the data
  dictionary but missed this spec surface.
- **Tests owed:** CLI end-to-end pin (spec with ceiling → child `RUN_CREATED.limits.maxCostUsd` and
  `TASK_REQUEST.limits.maxCostUsd` on disk); invalid-value refusal (exit non-zero, nothing written);
  existing `cli-children` tests untouched.
- **Ownership (exclusive):** `src/cli/main.ts` (`parseChildSpec` region only),
  `test/integration/m1/cli-children.test.ts`, `docs/specs/m0-m2-architecture.md` (the two stale
  lines only).
- **Parent sign-off:** none needed — completes plumbing the merged tree's own contract already
  describes and validates; no schema, no new status, no `RunStatus` contact.

### Dispatch cross-check

No file appears in two slots (`pi-executor.ts` only in R18-1; `main.ts` only in R18-2; test files
disjoint; the spec doc only in R18-2). Every named path exists at HEAD except R18-1's new test file,
which it creates in an existing directory. Zero candidates elsewhere: the audit's §5 table records
nine merge-seam surfaces swept clean with reasons — re-dispatching any of them is padding.

## 5. Explicitly NOT for Round 18

Everything in the Round 17 brief §5, verbatim — live R1/bandit/topology; reading
`independentEvidence` as corroboration; any new `RunStatus`; a fourth `RUN_UNBLOCKED` key; the
`taskCriteria` surface; overloading `onRunStarted`; per-path liveness/pause proofs; a third
`Run <id>: <word>` line; synthesizing `contract`/`taskCriteria`; re-litigating option (a), the
discard audit, the unblock fail-closed default, the gate-ledger posture, or set-before-sums;
protocol-layer criterion correlation; per-criterion `UNOBSERVED`; manufactured pauses; jsonl/lock
perf; mailbox/cluster; lock stealing; resume-time adoption; non-terminal `RUN_CRASHED`; rewriting
append-only logs; ADR-006 status changes; P0 sign-off; dependency bumps; in-tree mutation testing;
editing the `replay.ts` docstring; bare-`createScanner` comment-only proofs; freeze-extra
re-censuses; census notes absent a landing that changes the surfaces; re-locking
`EventStore.append`/`CheckpointStore.write`; a catalog-observed producer or its locking; deleting
the three pinned zero-importer barrels; the `pause`/`inject` USAGE `[--state-root]` cosmetic nit; a
crash-probe case for the eval-report writer; a 12th crash-probe case; more migrate-legacy
publish-arm tests without a new proven mutant; re-litigating the R17-1 (b) sign-off; making the
inferred-preference plane live; the `doctor.ts:507` path nit and `LearnFromOutcomesInput.projectId`
(both still folded into whichever future slot owns those files); the
`withAdaptationRegistryLock` cosmetic — **plus, new this round:**

- **Reverting or re-buffering the kernel-reuse contracts** (see §3): the `maxCostUsd` forward, the
  live-through-tool-start stream, bytes-only thinking, the 4-module closure allowance.
- **Wiring `onCostGate` at the CLI as a standalone slot.** Today the disarmed-cap event has no CLI
  producer path until R18-2 lands, the `ChildRunLimits` disclosure already names enforcement
  best-effort/executor-dependent, and a ceiling-stop is already visible in the transcript summary.
  Fold CLI cost surfacing into whichever future slot owns it with a proven operator need.
- **The `SteerChannel.settled()` allSettled swallow** (a disk-level append failure loses the steer
  record while the run continues; the un-awaited caller promise still rejects). Disk-failure-only,
  no reproduction; recorded for whoever next owns `coordinator.ts`. Not a slot.
- **The `AsyncEventQueue` close/streamedCount theoretical race** — unreachable while Pi awaits
  listeners before `waitForIdle` settles (kernel docstring pins the semantics). Not a slot.
- **Flowchart-node spend ceilings / a cross-child run-spend ledger.** `FlowchartRunLimits` carries
  no `maxCostUsd`, nothing claims flowchart nodes are capped, and the N·$X multi-child bound is
  disclosed on `ChildCoordinatorDeps.maxCostUsd`. Capability work, not an honesty hole; needs a
  parent product decision first.
- **A `steer` CLI verb.** `RunningRun.steer` is an embedder API; no surface claims CLI steering.
  Product work, not a hole.

**Valid reasons to dispatch anything beyond §4:** exactly the four from the pre-merge brief
(new seam / reproduced behavioural gap / gate-or-probe red / landing that stale-ifies recorded
surfaces), each owing a fresh deterministic out-of-tree proof at that HEAD. A zero-slot follow-up
round after §4 lands is a valid, recordable round.
