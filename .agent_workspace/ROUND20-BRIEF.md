[Model: claude-fable-5-thinking-xhigh]

# ROUND 20 BRIEF — injection context for Loop 4 · Round 20 dispatch

Provenance: written by the Round 20 auditor at HEAD `f6d6151` on `cursor/opt-r18-postmerge-42b1`
(code tree = `4412fac`); full sweep evidence and proof transcripts in
`.agent_workspace/loop4-r20-audit.md`. Round 19 was recorded zero-slot. Per the standing loop
protocol this round retargeted to I/O, races, protocol honesty, and disaster recovery at HEAD, on
paths the Round 18 merge-honesty sweep did not race-prove plus combinations the R18 landings newly
made load-bearing. **Two candidates, both proven with 3× deterministic out-of-tree transcripts of
real repo code at HEAD — do not pad.**

## 1. What landed last (context, all committed — do not re-implement)

| What | SHA | State |
|---|---|---|
| R18-2 | `daea498` | `parseChildSpec` carries/refuses a declared per-child `maxCostUsd`; carriage pinned on disk (`TASK_REQUEST.limits` + child `RUN_CREATED.limits`); spec §359-366 rewritten. ACCEPTed by the R18 review with single-red mutants. |
| R18-1 | `4412fac` | Accepted steers survive 429/5xx retries, direction (a): execution-scoped `acceptedSteers`, per-attempt snapshot, re-delivery at each retry attempt's first `TURN_FINISHED`, latched once, record-after-accept. ACCEPTed; all three clauses mutant-proven. |
| Round 19 | — | Zero-slot, recorded (ROUND19-BRIEF §4 empty). |
| Round 20 audit | this HEAD | No code landed; two proven candidates below. Baseline re-verified; `security-probe` vs `dist/` exercised for the first time since the merge — clean. |

## 2. Current baseline (independent, this VM, Node v22.14.0, engines `>=22.19.0` warning only)

- Auditor's own `pnpm gate` at HEAD: **GREEN, exit 0 — 2042 tests / 2041 pass / 0 fail /
  0 cancelled / 1 skipped / 120 suites**; exactly one `# SKIP` line (`PI_SMOKE`). Matches the
  parent's recorded numbers exactly.
- Auditor's own `node scripts/crash-probe.mjs`: **exit 0, `ok: true`, 11 cases × 3 iterations**,
  names and order verified one-by-one, `unblock-discard-append-before-checkpoint-sigkill` last.
  No 12th case.
- Auditor's own `node scripts/security-probe.mjs` against the gate-built `dist/`: **exit 0,
  `status: "ok"`, 14/14 passed, zero open findings, zero waived, no `SECURITY_WAIVER` set.**
- No perf claims this round. Any future perf claim still owes same-VM before/after with an
  unchanged-arm control, ≥5% end-to-end.

## 3. Forbidden / frozen for Round 20 landings (Rounds 1–18 + merge-settled, carried verbatim)

Everything in ROUND19-BRIEF §3, unchanged and carried whole: the global forbidden list (live
R1/bandit/topology on the execution path; Outcome-supported claims; ADR-006 stays Proposed;
auto-promote; P0 privacy sign-off stays human; `package.json`/dependency edits; git history
rewrites; subagents do not commit; no `git checkout` of other branches; `independentEvidence`
exactly one `void`; eight-member `RunStatus`; no fourth `RUN_UNBLOCKED` key); the Rounds 1–17
frozen-contract set (jsonl/atomic-write/lock/delete/crash-terminal/`applyRetry`/resume-disclosure/
five doctor routes character-exact/`INSPECT_SUMMARY` four keys/BLOCKED-prefix/episode-boundary/
option (a)/discard-audit/probe 11-case order/verdict-producer; `taskCriteria` writer as shipped;
`onRunStarted` on all three public run paths; census terminator; `EventStore.append`/
`CheckpointStore.write` unlocked; preferences writer contract; write-side episode-event validation;
atomic eval publish; both migrate-legacy publish arms; inferred-pref plane not-live; `from-episode`
ingress single); the merge-settled freezes (no kernel-reuse revert; live-through-tool-start as
shipped; thinking bytes-only outside `src/pi-adapter/**`; adaptation closure exactly 4 modules with
both privacy guards censused on any adaptation-plane import change; `remainingCostUsd` a separate
enforced plane); and the Round 18 contracts (steer re-delivery across retries as shipped — first
`TURN_FINISHED` placement, once-per-attempt latch, execution-scoped log, backoff = loud refusal;
ceiling stop outranks an unconsumed steer; per-child cap carriage + parse-time refusal as shipped;
the spec surfaces aligned by `159630e`/R18-2).

Note for the two slots below: **each restores a frozen contract rather than moving one.** R20-1
restores "an absent cap stays absent — never invent one" on the resume rebuild; R20-2 restores
"a steer during backoff stays a loud refusal" under a shared executor. Neither slot may weaken the
other frozen clauses while doing so.

Process requirements per slot (carried forward): census first against the working tree; verify
handed paths exist; scoped `eslint` + whole-tree `tsc --noEmit` before reporting; consumer census in
your own diff; timing-sensitive owned tests 3×; full gate is the parent's job; no scratch files at
report time (including `/tmp` state roots); mutations/proofs out-of-tree (full copy, `node_modules`
symlinked), then deleted; landing commits are slot files + report only, no PROGRESS ticks.

## 4. Round 20 candidates (2 real, proven at HEAD — do not pad)

Both proven with deterministic out-of-tree runs of real repo code, 3× identical each; transcripts in
`loop4-r20-audit.md` §4; proof copies deleted. Every landing owes destructive/defensive tests in its
own diff.

### R20-1 (P2) — pause/resume must not rewrite a declared per-child `maxCostUsd`

- **Proven defect (both directions, CLI-reachable via `run --children` → `pause` → `resume`):**
  `resumeFlowchartRun`'s rebuild gives a never-dispatched child `fallbackChildLimits`
  (`flowchart-run.ts:428-449`): the sibling arm returns the sibling's **entire** limits object —
  since R18-2 that can include the sibling's `maxCostUsd`, which is then stamped into the child's
  `TASK_REQUEST.limits`, its `RUN_CREATED.limits`, and the execution request (**invented cap**,
  proven `0.25` on all three records for a child that declared none); the no-sibling arm copies
  three fields and drops the child's own declared cap (**disappeared cap**, proven: declared `0.05`
  absent from all three records, child runs uncapped, exit 0, no warning). Control proven: the
  straight-through path carries the cap intact, so the pause/resume boundary is the sole
  difference-maker. Nothing durable records a declared-but-never-dispatched child's limits — the
  R12-1 `taskCriteria` record covers criteria only.
- **Fix directions (parent picks one; sign-off YES):**
  (a) minimal — substitute only the three coordinator-enforced fields (strip `maxCostUsd` from the
  sibling arm); kills the invention, leaves the disappearance as a disclosed substitution;
  (b) full — record dispatched per-child limits (or just the ceiling) durably at accept time and
  restore them for substituted specs, mirroring the R11→R12 `taskCriteria` seam (validated
  checkpoint-schema addition). (b) subsumes (a). An explicit (a)-only decision must say the
  disappearance is accepted and update the disclosure accordingly.
- **Fold in (landing-triggered census, terminator-compliant):**
  `docs/specs/m0-m2-architecture.md:368-377` — "receives the earliest logged sibling's budget" must
  say what the substituted budget now does and does not carry.
- **Tests owed:** the audit's three proof shapes as regression pins in the resume suite (control;
  no-invention; and under (b) cap-restored / under (a) disclosed-drop); the existing sibling-budget
  pin (`resume.test.ts:738-743`) stays green; under (b), checkpoint validation pins for the new
  field; run 3×.
- **Ownership (exclusive):** `src/run/flowchart-run.ts` (`fallbackChildLimits` region; plus the
  accept-time recorder under (b)), `src/run/replay.ts` (**only under (b)**: checkpoint field
  validation), `test/integration/m2.5/resume.test.ts`, `docs/specs/m0-m2-architecture.md:368-377`.
  No adaptation-plane import edges — privacy guards stay outside ownership.
- **Parent sign-off needed: YES** — (a) vs (b) is a schema/product decision (R11/R12 precedent).
- **Parent sign-off (2026-08-25): R20-1 YES — direction (b) restore.** A declared per-child ceiling is a dispatch fact, like `taskCriteria`. Record each child's `maxCostUsd` (ceiling only, not the whole limits object) at accept time, optional + absence stays unknown, first-write-wins, no `FlowchartContinuation` field. Restore it onto substituted specs. The sibling arm must not copy `maxCostUsd` (absent stays absent; never invent). Do **not** rewrite the `replay.ts:95-101` laundering coda; add parallel validation next to `taskCriteria`. Disappearance is **not** accepted.

### R20-2 (P3) — a steer must not land in a different run than the one whose handle accepted it

- **Proven defect (embedder-reachable; two `startRun` calls sharing one `PiAgentExecutor`):**
  `AgentExecutor.steerText?(text)` carries no target, so during run A's retry backoff (A's kernel
  deleted from `liveKernels`) a steer through **A's own `RunningRun.steer`** is delivered into run
  B's sole live kernel, recorded in **B's** `acceptedSteers` (a retry of B would re-deliver A's
  instruction into B), while **A's** log durably records `STEER_INJECTED` with **A's**
  `agentInstanceId`. Proven 3×: A's model calls never carried the text; exactly one of B's did; B's
  log records no steer. In-proof control: with no other kernel live the same steer refuses loudly —
  the frozen backoff-refusal contract holds unshared and breaks only under sharing. The disclosed
  whichever-child targeting (`coordinator.ts:777-779`) covers one parent run's children, whose
  `STEER_INJECTED` carries no `agentInstanceId`; only the root path's record goes false.
- **Fix shape:** widen the optional contract member to `steerText(text, agentInstanceId?)`.
  `startRun` passes its root agent instance; `startParentRun` keeps passing none (whichever-child
  stays the disclosed one-run semantics); `PiAgentExecutor.steerText` with a target delivers only to
  that instance's kernel and refuses loudly when that instance has no live kernel. Backward-
  compatible optional parameter; no new event type; R18-1 replay mechanics untouched
  (`acceptedSteers` keys correctly for free). Documentation-only is **not** an acceptable outcome —
  it leaves a durable record naming an agent instance that never received the text.
- **Tests owed:** the audit's proof shape as a regression pin (shared executor, backoff window →
  targeted steer refuses loudly / reaches only its own run), new
  `test/integration/pi-adapter/steer-target.test.ts` (dir exists); the 12 existing steer pins stay
  green untouched; targeted-refusal unit pins in `steer-inflight.test.ts` if executor-level state
  warrants; run 3×.
- **Ownership (exclusive):** `src/execution/contract.ts` (the optional signature only),
  `src/pi-adapter/pi-executor.ts` (`steerText` region), `src/run/coordinator.ts` (the two
  `SteerChannel` call sites only), new `test/integration/pi-adapter/steer-target.test.ts`,
  `test/unit/pi-adapter/steer-inflight.test.ts`. No adaptation-plane import edges.
- **Parent sign-off needed: YES** — it changes `execution/contract.ts` (domain-contract decision per
  ADR-001 precedent), even though the widening is backward-compatible.
- **Parent sign-off (2026-08-25): R20-2 YES — optional target.** Widen to `steerText(text, agentInstanceId?)`. `startRun` passes the root instance; `startParentRun` keeps passing none (disclosed whichever-child). Targeted miss = loud refusal, never a `STEER_INJECTED` for an instance that did not receive the text. No new event type. R18-1 replay placement/latch/backoff-unshared unchanged. Do not broadcast. Do not add a second kernel registry.

### Dispatch cross-check

No file appears in two slots (`flowchart-run.ts`/`replay.ts`/`resume.test.ts`/the spec doc only in
R20-1; `contract.ts`/`pi-executor.ts`/`coordinator.ts`/steer tests only in R20-2). Every named path
exists at HEAD except R20-2's new test file, created in an existing directory. R20-2 touches
`pi-executor.ts` and `coordinator.ts`, which carry R18-1 and steer-channel freezes — its grant is
exactly the steer-target seam, and §3's note binds it to leave every other frozen clause intact.

## 5. Explicitly NOT for Round 20 landings

Everything in ROUND19-BRIEF §5, verbatim — including: re-litigating the R18-1 replay placement or
latch; a steer-ordering contract across retry boundaries; pinning the unreachable kernel-refusal
ordering in `steerText`; treating a ceiling-stopped unread steer as a defect; a run-level
`maxCostUsd` CLI flag; wiring `onCostGate` as a standalone slot; the `SteerChannel.settled()`
swallow; the `AsyncEventQueue` close race; flowchart-node spend ceilings / a cross-child run-spend
ledger; a `steer` CLI verb; the `/tmp` suite-root leak as a standalone slot (re-measured this round:
~65 roots after one full-suite run, same prefixes, same posture); a 12th crash-probe case;
`docs/kernel-reuse.md` edits — **plus, new this round:**

- **The cluster `onSpawn` hardcoded limits** (`coordinator.ts:692`, `flowchart-run.ts:595`). Killed
  with evidence (audit §3 H1): the coordinator plane's run-level cap still reaches spawned peers
  through `costCapFor`; the flowchart plane has no run-level cap and spawned peers declare none —
  no declared or forwarded ceiling exists there to lose. Not a slot.
- **Re-running `security-probe` as a recurring audit chore.** It is a release-gate script; this
  round exercised it against `dist/` because Round 18 explicitly had not — clean, 14/14, no waivers.
  It re-enters an audit only when `dist/`-facing code or the redaction pipeline changes.
- **Editing `docs/kernel-reuse.md`'s superseded retry-steer lines** (`:131-136`, `:213-214` — the
  present-tense "Semantics extenders must respect" section still says queued steering does not
  survive a retry, which R18-1 superseded for accepted steers). The file-wide freeze from
  ROUND19-BRIEF §5 is carried and honored; the lines are recorded in audit §3 H5 for whenever the
  parent re-judges that freeze. A slot that edits this file without the parent explicitly lifting
  the freeze is out of bounds.
- **Broadcasting steers to all live kernels, or a per-run kernel registry** as alternative R20-2
  shapes: the first delivers instructions to runs nobody steered; the second duplicates state the
  target parameter carries for free. R20-2's grant is the optional-target shape or an explicit
  parent-decided alternative, not exploration.

**Valid reasons to dispatch anything beyond §4** (unchanged, each owing a fresh deterministic
out-of-tree proof at that HEAD): a new seam lands; a reproduced behavioural gap; gate or probe goes
red on an independent run; a landing stale-ifies recorded surfaces (then the alignment rides inside
that landing). A zero-slot follow-up round after §4 lands is a valid, recordable round.
