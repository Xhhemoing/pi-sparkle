MODEL_SLUG: claude-fable-5-thinking-xhigh

# Loop 4 · Round 22 SOTA audit — pi-sparkle

Auditor HEAD: `63a4443` on `cursor/opt-r22-42b1` (post-merge tree; `origin/main` = `80eb0bd`, the
Round 18–20 merge). Working tree clean before this report; the only writes are this file and
`ROUND22-BRIEF.md`. No commits made (per dispatch). No `src/` edits. All proofs ran out-of-tree
(`/tmp/r22`, full tar copy, `node_modules` symlinked), 3× each, transcripts embedded below; the
copy and every scratch file were deleted at report time. `/tmp/tsx-*` cleared before the gate and
before every proof run.

## 1. Round context and grant

Rounds 19 and 21 were honest zero-slot: the honesty/I/O/race/protocol/DR plane at HEAD is
saturated. This round exists because the parent issued **product sign-offs** that open new seams:

1. LIFT the `docs/kernel-reuse.md` freeze — truth-up landing only (three recorded stale spots plus
   the skill-reference copy). No runtime change.
2. YES CLI run-level `--max-cost-usd` (parse like `parseChildCostCeiling`; absent stays absent;
   forward via `StartRunInput.limits`).
3. YES flowchart `ChildCoordinator` receives that run-level cap the way `startParentRun` already
   does. No `FlowchartRunLimits.maxCostUsd`; no unification with `remainingCostUsd`; no
   cross-child ledger.
4. YES wire `onCostGate` from the CLI so a requested-but-disarmed cap is stderr-visible (frozen
   wording specified in §5 of the brief). No new `ExecutionEvent` type; CostGate arithmetic frozen.
5. CONDITIONAL `steer` CLI verb — only under a tight contract honoring R20-2; otherwise §5.

Verdict up front: **three real slots** (truth-up docs; flowchart run-level cap carriage; CLI cost
flag + onCostGate stderr). The steer verb fails its own condition and is recorded in §5 with the
reasoning. No padding; file ownership disjoint; explicit landing order R22-1 → R22-2 → R22-3.

## 2. Baseline (independent, this VM, Node v22.14.0, engines `>=22.19.0` warning only)

- **`pnpm gate` at HEAD: GREEN, exit 0 — 2050 tests / 2049 pass / 0 fail / 0 cancelled /
  1 skipped / 120 suites.** Exactly one `# SKIP` line (`grep -c` = 1):
  `ok 301 - PiAgentExecutor completes a run against a real provider # SKIP` (the standing
  `PI_SMOKE` gate). Matches the Round 20 review's recorded 2050/2049/1/120 exactly — the merge and
  the Round 21/22 orchestrator commits moved no test.
- **`node scripts/crash-probe.mjs`: exit 0, `ok: true`, 11 cases × 3 iterations**, names verified
  one-by-one against the pinned order (`jsonl-truncated-tail` first,
  `unblock-discard-append-before-checkpoint-sigkill` last). No 12th case.
- **`node scripts/kernel-reuse-probe.mjs`: 3 PASS, exit 0** (live-stream, kernel-facade,
  executor-steer with the R20 widened regex). Note for R22-1: the probe greps `src/` only — it
  reads neither doc file, so the truth-up cannot redden it.
- Working tree clean at every step; `git status --short` empty before this report.
- No perf claims this round.

## 3. HEAD re-read (source, not memory)

Every claim below was read at `63a4443` this round:

- `src/cli/main.ts:1058` — `startRun({ stateRoot, executor }, { projectRoot, objective })`, no
  `limits`. `StartRunInput.limits?: RunLimits` exists (`coordinator.ts:116-121`), and `startRun`
  forwards `run.limits.maxCostUsd` onto the root execution request only when present
  (`coordinator.ts:393-396`; pinned by `test/integration/m0/coordinator.test.ts:80-102`).
- `src/run/coordinator.ts:719-729` — `startParentRun` constructs `ChildCoordinator` with
  `...(run.limits.maxCostUsd !== undefined ? { maxCostUsd: run.limits.maxCostUsd } : {})` (:726).
- `src/run/flowchart-run.ts:729-739` — `attachChildRuntime` constructs `ChildCoordinator` with
  **no** `maxCostUsd` and no way to receive one: its input (:681-690) has no cap field,
  `FlowchartRunInput` (:133-145) has none, and `resolveLimits` (:178-190) copies a fixed key list,
  silently discarding anything else. Both call sites (:1459 start, :1668 resume) forward nothing.
  `startFlowchartRun` stamps `run.limits = { ...defaults, maxConsecutiveStalls, maxRounds }`
  (:1397-1401) — never a cap.
- `src/run/child-coordinator.ts:407-418` — `costCapFor` takes the tighter of the per-task and
  run-level caps; `runTask` stamps the effective cap into the child's `RUN_CREATED.limits`
  (:427-440) and the execution request (:662-673). The machinery is complete; the flowchart plane
  just never hands it the run-level side.
- `src/pi-adapter/pi-executor.ts:100-126` — `PiExecutorOptions.onCostGate?` and the two-variant
  `CostGateEvent` (`disarmed` with `CostGateDisarmedReason`, `stopped` with ledger). Emission:
  disarmed at `buildCostGate` only when a cap was requested (:851-858); stopped after the loop
  (:779-787). `src/pi-adapter/cost-gate.ts:30-36` — reasons `no-cap` / `invalid-cap` /
  `unpriced-model`; `catalogPrices` (:68-76) treats a **zero rate pair as unpriced** — and
  `runtime.ts:buildCustomProvider` fills omitted rates with zero, so every CLI custom provider
  without explicit costs is an unpriced model.
- `src/pi-adapter/runtime.ts:29-62` — `createConfiguredPiExecutor` input has **no `onCostGate` and
  no `maxCostUsd`** member; `src/cli/main.ts:createExecutor` (:172-232) passes neither. Zero
  `onCostGate` references anywhere under `src/cli/`.
- `src/execution/contract.ts:61` — `steerText?(text: string, agentInstanceId?: AgentInstanceId)`
  (R20-2). `pi-executor.ts:712-745` — targeted delivery, loud targeted-miss refusal, sole-live
  untargeted; `:582` — R18-1 per-attempt re-delivery of accepted steers.
- `docs/kernel-reuse.md` — stale spots verified verbatim (transcript in §4, P1): `:54` (sole-live,
  one-parameter `steerText?`), `:72` (`steerText?(text)`), `:131-136` ("Queued steering …​ do not
  survive a retried attempt … either re-arm … or document the drop"), `:213-214` ("The retry
  decision went to document-and-drop"). Also carrying the same superseded fact in dated journal
  prose: `:80-82` ("Retry semantics unchanged … documented as dropped"). Still true and untouched:
  the cost-stop-outranks-steer bullet (:137-156), `followUpText`/`reset`/`sessionId` facade-only
  (:56 — re-verified: `rg -l followUpText src/` hits `kernel.ts` only), "No CLI verb for live
  steer exists yet" (:58-63).
- `.agents/skills/pi-sparkle/references/kernel-reuse.md:42-47` — still the old one-parameter
  `steerText?(text)` + "refuses when zero or several agents are in flight" (matches the old
  signature → in scope per the parent's census terminator); `:112-118` — "queued steering …​ do
  not survive a retry" (same superseded fact). The facade list at `:13-15` is still accurate
  (kernel-level `steerText(text)` is unchanged; the target lives at the executor).
- `docs/specs/m0-m2-architecture.md:359-366` (per-child cap protocol clause) and `:368-381`
  (substituted budget, never-carried `maxCostUsd`, `taskCostCeilings` restore) — accurate at HEAD.
  `docs/status-matrix.md:38` and `docs/data-dictionary.md:158-165` — accurate at HEAD (R20-1
  fold-ins verified word-for-substance).
- `src/cli/main.ts` USAGE (:249-357) — no cost flag anywhere; `INSPECT_SUMMARY` frozen-additive
  comment intact (:1183-1186); `onRunStarted` on all three public run paths intact (:813, :912,
  :1001).
- `src/domain/limits.ts:50-55` — `RunLimits.maxCostUsd` optional, positive-finite fail-closed in
  `validateRunLimits`; `src/run/events.ts:616-624` — `RUN_CREATED.payload.run` validated at write
  time via `validateRun`, so a run-level cap stamped there is durable **and** fail-closed on
  replay. `CHILD_RUN_CREATED.payload.childRun` carries the child's full `Run` (:137-139).

## 4. Proofs (out-of-tree `/tmp/r22`, real repo code, 3× identical each)

### P1 — `docs/kernel-reuse.md` + skill reference lie to extenders (candidate R22-1)

Probe: `proofs/p1-doc-vs-code.sh` — extracts the doc claim lines, greps the shipped signatures,
then runs the two shipped steer suites. 3 runs, transcripts byte-identical (`diff -q` clean).
Merged transcript:

```
== DOC CLAIMS (docs/kernel-reuse.md) ==
--- :54 (wired-today table, steering row, excerpt) ---
targets the single in-flight kernel and refuses when zero or several runs are live
optional `steerText?`
--- :72 ---
- `AgentExecutor.steerText?(text)` on the contract; `RunningRun.steer(text,
--- :131-136 ---
- **Retry resets the agent.** `runWithRetry` builds a fresh `Agent` per
  attempt. Queued steering/follow-up messages and `sessionId` do not survive a
  retried attempt, and only the last attempt's events form the invocation
  record. A steering feature must tolerate a retry restarting from the
  original prompt — either re-arm queued messages after retry or document the
  drop.
--- :213-214 ---
   in flight. The retry decision went to document-and-drop: queued steering
   does not survive the fresh-`Agent` retry.
== DOC CLAIMS (.agents/skills/pi-sparkle/references/kernel-reuse.md) ==
--- :42-47 ---
   - *Executor.* `AgentExecutor` declares optional `steerText?(text)`
     ...: rejects empty text, refuses when
     zero or several agents are in flight, otherwise forwards to the live
     kernel. ...
--- :112-116 ---
6. **Respect retry and queue semantics.** The executor retries transient
   provider failures with a *fresh* `Agent` per attempt, so queued steering
   and follow-up messages do not survive a retry, ...
== SHIPPED CODE ==
61:  steerText?(text: string, agentInstanceId?: AgentInstanceId): void;
712:  steerText(text: string, agentInstanceId?: AgentInstanceId): void {
582:          for (const text of replay) kernel.steerText(text);
== SHIPPED BEHAVIOUR (repo tests, real code) ==
ok 1 - a steer accepted before a retried provider failure reaches the retry's context
ok 2 - a steer survives more than one retry and is re-delivered exactly once per attempt
ok 3 - a steer aimed at a run in retry backoff is refused, not delivered into a run sharing the executor
ok 4 - a steer through a live run's own handle reaches that run and no other on the same executor
ok 5 - a parent run steers whichever child is live, naming no agent instance
# pass 5
# fail 0
```

The file's normative sections tell an extender the exact opposite of two shipped, pinned,
merge-settled contracts: (a) accepted steers **do** survive retries (R18-1 `4412fac`, `ok 1`/`ok
2` above), while `:131-136` and `:213-214` instruct them to tolerate the drop; (b) `steerText` is
two-parameter targeted with a loud targeted-miss refusal (R20-2 `57ade59`, `ok 3`/`ok 4`), while
`:54`/`:72` and skill `:42-47` describe one-parameter sole-live. An extender following the doc
would design steering features around a re-arm-or-drop decision that was already made and a
cross-run hazard that was already closed. This is the lying-record shape this loop exists to kill,
and the parent has lifted the freeze exactly for it.

### P2 — the flowchart plane silently discards a run-level spend ceiling (candidate R22-2)

Probe: `proofs/p2-flowchart-cap.ts` — deterministic ids, `ProtocolChildExecutor` wrapped to record
execution requests; control on the coordinator plane, defect on the flowchart plane (the plane CLI
`--children` compiles onto), one child that declares **no** per-child cap in both parts. 3 runs,
exit 0, transcripts byte-identical:

```
A. startParentRun status: COMPLETED
A. child execution request maxCostUsd: [ 0.5 ]
A. child RUN_CREATED limits.maxCostUsd: [ 0.5 ]
B. startFlowchartRun status: COMPLETED
B. child execution request maxCostUsd: [ undefined ]
B. child RUN_CREATED limits.maxCostUsd: [ undefined ]
B. flowchart RUN_CREATED run.limits.maxCostUsd: [ undefined ]
```

Part A (control): `startParentRun` with `limits: { ...defaultRunLimits(), maxCostUsd: 0.5 }` — the
cap reaches the child's execution request **and** its durable `RUN_CREATED.limits`. Part B
(defect): the identical child on `startFlowchartRun` + `childTasks`, handing the nearest spelling
an embedder can reach (`limits: { maxCostUsd: 0.5 }`, which TS rejects and `resolveLimits`
silently drops at runtime) — the run **completes with exit-0 semantics, no warning, no cap on any
record**: not on the child's request, not on the child's `RUN_CREATED`, not on the flowchart run's
own `RUN_CREATED`. The sole difference-maker is the plane. `costCapFor` and the effective-cap
stamping already exist and are pinned (`child-coordinator.ts:407-440`); the flowchart plane simply
never hands the run-level side over — `attachChildRuntime` (:729-739) constructs `ChildCoordinator`
capless at both call sites.

### P3 — a requested-but-disarmed cap is invisible, and the CLI chain cannot see it (candidate R22-3)

Probe: `proofs/p3-costgate-silence.ts` — faux provider, unpriced model (the zero cost pair
`runtime.ts:buildCustomProvider` stamps for every custom provider without explicit rates),
requested cap `0.000001` USD. 3 runs, exit 0, transcripts byte-identical:

```
A. requested cap: 0.000001 USD; provider calls made: 2
A. terminal event: EXECUTION_FINISHED SUCCESS
A. any ExecutionEvent mentioning the cap or the disarm: 0
B. onCostGate events: [{"kind":"disarmed","taskId":"tsk_00000000-0000-4000-8000-000000000002","maxCostUsd":0.000001,"reason":"unpriced-model"}]
C. createConfiguredPiExecutor accepts onCostGate: see tsc transcript
```

Part A (defect shape, the CLI's exact situation): cap requested, gate disarms, no `onCostGate`
wired → the run makes both provider calls, finishes `SUCCESS`, and **zero** of its
`ExecutionEvent`s mention the cap or the disarm — the operator's requested ceiling evaporates with
no observable trace anywhere. Part B (control): the same run with `onCostGate` wired reports
`disarmed`/`unpriced-model` — the fix's information already exists at the executor. Part C
(type-level, deterministic): uncommenting the `onCostGate` member in a `createConfiguredPiExecutor`
call fails `tsc` with:

```
error TS2353: Object literal may only specify known properties, and 'onCostGate' does not exist
in type '{ readonly stateRoot: string; ... readonly onInvocation?: ... }'.
```

so the CLI's only executor factory chain (`createExecutor` → `createConfiguredPiExecutor`) cannot
wire the sink today. `rg onCostGate src/cli/` is empty.

### P4 — no run-level cap is requestable from the CLI at all (candidate R22-3, flag half)

Probe: `proofs/p4-cli-flag-absent.ts` driving the real `main()`. 3 runs, byte-identical:

```
exit 1
error: Unknown option '--max-cost-usd'
  command: run
  stage: execute
  next: fix the reported error, then retry; use pi-sparkle doctor for preflight
```

Together with P2/P3: an operator cannot declare a run-level ceiling (P4); if the library plane got
one, the `--children` plane would drop it (P2); and if a ceiling is declared but unenforceable, the
CLI has no channel to hear about it (P3). Three seams, one honest cost plane.

### Sign-off 5 assessment — `steer` CLI verb: fails its own condition, goes to §5

The condition was a tight contract needing no product design beyond a verb + tests. Read at HEAD,
it cannot be met: `RunningRun.steer` is an in-memory handle in the `run` command's own process,
which blocks until the run is terminal, and `PiAgentExecutor.steerText` requires the live kernel
object. A `steer --run <id>` verb necessarily executes in a **second** process, so it needs a
cross-process delivery channel — and every candidate channel is a product decision, not plumbing:
a pause-style file token would make the verb return after *enqueueing*, not after *delivery*, so
the R20-2 property "targeted miss refuses before `STEER_INJECTED`" cannot be honored by the
process that owns the refusal (the verb would either lie about delivery or need poll/attach
semantics); the queue file would be a durable record of steers no live process may ever consume (a
crashed run leaves an accepted-by-nobody steer, exactly the false-record shape R20-2 exists to
prevent); and naming a live run from outside requires an attach/ack protocol the product does not
have. That is "how to name a live run, poll vs attach" — the parent's own §5 trigger, verbatim.
Recorded in ROUND22-BRIEF §5 with this reasoning; not a slot.

## 5. Candidates kept (full contracts in ROUND22-BRIEF §4)

- **R22-1 (docs)** — `docs/kernel-reuse.md` + skill reference truth-up under the lifted freeze.
  Proof P1. Ownership: the two doc files only.
- **R22-2 (library)** — flowchart run-level cap carriage: `FlowchartRunInput.maxCostUsd`
  (validated fail-closed pre-lock) → stamped into the flowchart run's `RUN_CREATED.limits` →
  `attachChildRuntime` → `ChildCoordinator`, restored on resume from the replayed durable
  `RUN_CREATED` (never invented). Proof P2. Ownership: `src/run/flowchart-run.ts`, new
  `test/integration/m2.5/flowchart-run-cap.test.ts`, `docs/specs/m0-m2-architecture.md`,
  `docs/data-dictionary.md` (conditional census).
- **R22-3 (CLI)** — `run --max-cost-usd` (plain path via `StartRunInput.limits`; `--children` via
  R22-2's input field; loud refusal on `--flowchart`/`--track`; no resume flag) + `onCostGate`
  threaded through `createExecutor`/`createConfiguredPiExecutor` with a frozen stderr wording for
  `disarmed` only. Proofs P3 + P4. Ownership: `src/cli/main.ts`, `src/pi-adapter/runtime.ts`,
  `test/integration/m1/cli-children.test.ts`, three new test files, `docs/status-matrix.md`.

Dispatch order is load-bearing: **R22-1 first** (truth at current HEAD; the freeze-lift is for a
truth-up only, so R22-2/R22-3 may not touch `docs/kernel-reuse.md`, and landing the truth-up first
keeps it from having to describe unlanded work), then **R22-2**, then **R22-3** (its `--children`
forwarding compiles against R22-2's input field).

File-disjointness cross-check: no file appears in two slots. The two kernel-reuse docs only in
R22-1; `flowchart-run.ts` + the new m2.5 test + `m0-m2-architecture.md` + `data-dictionary.md`
only in R22-2; `main.ts` + `runtime.ts` + `cli-children.test.ts` + the three new test files +
`status-matrix.md` only in R22-3. Every named existing path verified present at HEAD.

## 6. Hypotheses examined and dropped (not slots, with evidence)

- **`--max-cost-usd` forwarding on `--track` / `--flowchart`.** `--track` compiles through
  `startFlowchartRun` + `childTasks` (`src/track/loop.ts:180-198`) so R22-2's seam would carry it,
  but the input plumbing crosses `startTrackedRun` (another file, another input type) and the
  sign-off names `--children` only; `--flowchart` without `childTasks` executes RUNNING nodes on
  the thin path (`executeRemainingRunningNodes` → `executeFlowchartNode`, `flowchart-run.ts:
  833-856`), which forwards no cap at all — wiring it is a new enforcement surface, not a handoff.
  R22-3 therefore refuses the flag loudly on both combinations; forwarding is §5.
- **Refusing unknown keys in `resolveLimits`** (the silent drop P2 part B exercised). The
  first-class input field is the fix; hardening a validator that the fix makes unreachable through
  the CLI is defensive code for a scenario TS already refuses. Not a slot.
- **A `stopped` stderr line in the CLI `onCostGate` handler.** The parent's own sign-off: a real
  ceiling stop is already transcript-visible (the gate's stop ends the execution and the outcome
  is durable); a second channel would be a duplicate record. The frozen handler prints for
  `disarmed` only.
- **Extending `scripts/kernel-reuse-probe.mjs` to check doc claims.** The probe is a source-truth
  claim gate; pointing it at prose would make every future docs edit a probe edit. The truth-up's
  regression guard is the census terminator plus the P1 grep transcript (reproducible verbatim).
- **A 12th crash-probe case, census-note treadmill, padding to 10 slots** — all forbidden by the
  dispatch and not needed by anything found this round.

## 7. Hygiene

- `/tmp/r22` (proof copy incl. `proofs/`), `/tmp/r22-p1-run*.txt`, `/tmp/r22-p2-run*.txt`,
  `/tmp/r22-p3-run*.txt`, `/tmp/r22-cli-run*.txt`, `/tmp/r22-gate.log`, `/tmp/r22-crash.json`,
  leaked `pi-sparkle-*` suite roots, and `/tmp/tsx-*` caches all deleted at report time; the
  `r22-gate` tmux session killed.
- Working tree at report time: this file + `ROUND22-BRIEF.md` only. No commits, no branch moves.
