MODEL_SLUG: claude-fable-5-thinking-xhigh

# ROUND 22 BRIEF — injection context for Loop 4 · Round 22 dispatch

Provenance: written by the Round 22 auditor at HEAD `63a4443` on `cursor/opt-r22-42b1`
(post-merge; `origin/main` = `80eb0bd`); full sweep evidence and 3× proof transcripts in
`.agent_workspace/loop4-r22-audit.md`. Rounds 19 and 21 were honest zero-slot; this round opens on
**parent product sign-offs**, not on a reproduced honesty regression — the sign-offs are the new
seam. **Three candidates, each proven at HEAD with 3× identical out-of-tree transcripts of real
repo code. Dispatch order is load-bearing: R22-1 → R22-2 → R22-3. Do not pad.**

## 1. What landed last (context, all committed — do not re-implement)

| What | SHA | State |
|---|---|---|
| R20-2 | `57ade59` | `AgentExecutor.steerText?(text, agentInstanceId?)`: `startRun` targets its root instance; `startParentRun` untargeted (whichever-child disclosed); targeted miss = loud `DomainValidationError` before any write; no new event type / broadcast / second registry; probe regex widened inside the landing. ACCEPTed, mutant-proven. |
| R20-1 | `1d9ef99` | `FlowchartCheckpointState.taskCostCeilings` dispatch-fact record (ceiling only, optional, absence stays an absent key, first-write-wins, never synthesized, fail-closed validation); `fallbackChildLimits` substitutes only the three coordinator-enforced fields; `withRecordedCostCeilings` restores recorded ceilings onto substituted specs only; spec/dictionary/matrix clauses folded in. ACCEPTed, mutant-proven. |
| Rounds 19 & 21 | — | Zero-slot, recorded (ROUND19-BRIEF / ROUND21-BRIEF §4 empty). |
| Merge | `80eb0bd` | PR #10 merged the R18–R20 line to `main`; Round 22 opens on the post-merge tree (`63a4443`, orchestrator commit only — code tree unchanged). |
| Round 22 audit | this HEAD | No code landed; three proven candidates below; parent sign-offs 1–4 accepted, sign-off 5 (steer verb) assessed and deferred to §5 with reasoning. |

## 2. Current baseline (independent, this VM, Node v22.14.0, engines `>=22.19.0` warning only)

- Auditor's own `pnpm gate` at HEAD: **GREEN, exit 0 — 2050 tests / 2049 pass / 0 fail /
  0 cancelled / 1 skipped / 120 suites**; exactly one `# SKIP` line (`PI_SMOKE`). Matches the
  Round 20 review's recorded numbers exactly.
- Auditor's own `node scripts/crash-probe.mjs`: **exit 0, `ok: true`, 11 cases × 3 iterations**,
  names and order verified one-by-one, `unblock-discard-append-before-checkpoint-sigkill` last.
  No 12th case.
- Auditor's own `node scripts/kernel-reuse-probe.mjs`: **3 PASS, exit 0.** The probe greps `src/`
  only — R22-1's doc edits cannot redden it.
- No perf claims this round. Any future perf claim still owes same-VM before/after with an
  unchanged-arm control, ≥5% end-to-end.

## 3. Forbidden / frozen for Round 22 landings (Rounds 1–21 + merge-settled, carried verbatim)

Everything in ROUND21-BRIEF §3, unchanged and carried whole: the global forbidden list (live
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
both privacy guards censused on any adaptation-plane import change; **`remainingCostUsd` a separate
enforced routing-budget plane — R22-2/R22-3 must not touch or unify with it**); the Round 18
contracts (steer re-delivery across retries as shipped; ceiling stop outranks an unconsumed steer;
per-child cap carriage + parse-time refusal as shipped; spec surfaces aligned by `159630e`/R18-2);
the Round 20 contracts (the `taskCostCeilings` record as shipped; ceiling-free substitution as
shipped; targeted `steerText` as shipped; the widened probe regex; the doc surfaces aligned inside
`1d9ef99`) — **with these Round 22 modulations from the parent's sign-offs:**

- **The `docs/kernel-reuse.md` file-wide freeze is LIFTED for R22-1 only** — one truth-up landing,
  no runtime change, dated journal subsections stay historical except where they assert a
  superseded fact as current semantics (exact spots in §4). R22-2 and R22-3 may **not** edit
  `docs/kernel-reuse.md` or the skill reference; if either believes it stale-ified them, that goes
  in its report for the parent, not in its diff.
- **New surface freezes created by this round (bind on landing):** the R22-3 stderr wording for a
  disarmed cap is frozen as specified in §4 (byte-pinned in its own unit test); `CostGate`
  arithmetic and the `CostGateEvent` union stay exactly as shipped (no new `ExecutionEvent` type,
  no new event-log record for cost-gate outcomes); `FlowchartRunLimits` gains **no** `maxCostUsd`;
  no cross-child spend ledger; no flowchart-node ceilings; the cluster `onSpawn` hardcoded limits
  (`coordinator.ts:713`, `flowchart-run.ts:720`) stay as shipped (killed candidate, R20 audit H1).
- **Absent stays absent, everywhere, still:** no layer invents a cap. The run-level cap R22-2/R22-3
  carry is only ever the caller's/operator's declared number or nothing; restores read only the
  durable `RUN_CREATED.limits` the run itself wrote (write-side validated via `validateRun`).

Process requirements per slot (carried verbatim from ROUND21-BRIEF §3): census first against the
working tree; verify handed paths exist; scoped `eslint` + whole-tree `tsc --noEmit` before
reporting; consumer census in your own diff; timing-sensitive owned tests 3×; full gate is the
parent's job; no scratch files at report time (including `/tmp` state roots); mutations/proofs
out-of-tree (full copy, `node_modules` symlinked), then deleted; landing commits are slot files +
report only, no PROGRESS ticks; clear `/tmp/tsx-*` before every verification or mutant run and
verify your own new test *names* appear in the TAP output.

## 4. Round 22 candidates (3 real, proven at HEAD, disjoint files — land in order)

All three proven with deterministic out-of-tree runs of real repo code, 3× identical transcripts
in `loop4-r22-audit.md` §4; proof copies deleted. Every landing owes destructive/defensive tests
in its own diff (R22-1 excepted per its nature; its regression guard is stated inline).

### R22-1 (P1, land first) — `docs/kernel-reuse.md` truth-up under the lifted freeze

- **Proven lie (audit P1, 3×):** the file's normative sections tell extenders the opposite of two
  shipped, pinned, merge-settled contracts. `:131-136` and `:213-214` say queued steering does not
  survive a retry and the decision was document-and-drop — superseded by R18-1 `4412fac` (accepted
  steers re-delivered at each retry attempt's first `TURN_FINISHED`, pinned by `steer-retry.test.ts`
  `ok 1`/`ok 2`). `:54` and `:72` describe a one-parameter `steerText?(text)` with sole-live-only
  targeting — superseded by R20-2 `57ade59` (`contract.ts:61` is two-parameter targeted; targeted
  miss refuses loudly; pinned by `steer-target.test.ts`). The skill reference still matches the old
  signature (`:42-47`) and the old retry-drop semantics (`:112-118`), so the census terminator pulls
  it in.
- **Exact scope (truth-up only, no runtime, no test changes):**
  - `docs/kernel-reuse.md:54` (wired-today table, steering row): rewrite to the shipped contract —
    optional `steerText?(text, agentInstanceId?)`; `startRun` opens its steer window targeted at
    its root agent instance; `startParentRun` opens untargeted (whichever-child stays the disclosed
    semantics); a targeted miss is a loud `DomainValidationError` thrown before any write;
    untargeted sole-live-or-refuse unchanged. Add `steer-retry.test.ts` and `steer-target.test.ts`
    to the row's "Verified by".
  - `:131-136` ("Retry resets the agent" bullet): rewrite to the shipped truth — a fresh `Agent`
    per attempt still means kernel-internal queues, follow-ups and `sessionId` do not survive, but
    steers **accepted through the contract are re-delivered** at each retry attempt's first
    `TURN_FINISHED`, latched once per attempt, execution-scoped (R18-1). Extender guidance becomes:
    steer through the contract and re-delivery is handled; anything queued directly on a kernel is
    still lost.
  - `:213-214` (worked example, step 2): the section presents itself as "the answers filled in" —
    fill in the current answer: initially document-and-drop, superseded 2026-08-25 by R18-1
    (`4412fac`) with per-attempt re-delivery; and the executor forward is now targeted (R20-2).
  - Dated journal lines asserting the superseded facts as current semantics get a bracketed
    superseded-pointer only, no rewrite: `:72` (one-parameter signature in the Round 2 status
    journal) and `:80-82` ("Retry semantics unchanged … documented as dropped"). All other journal
    prose stays byte-identical (dated subsections stay historical, per sign-off).
  - Refresh the `Status: current as of` header line (`:3`) with the landing date and note the
    truth-up.
  - `.agents/skills/pi-sparkle/references/kernel-reuse.md:42-47`: two-parameter signature, targeted
    delivery + targeted-miss refusal, sole-live-or-refuse when untargeted. `:112-118` (item 6):
    accepted-steer re-delivery per R18-1; keep the followUpText/`sessionId` non-survival and keep
    `:120-130` (cost-stop drop path) byte-identical — it is still true (a ceiling stop outranks an
    unconsumed steer; frozen). Keep the two files in lockstep per their own rule
    (`kernel-reuse.md:250-252`).
- **Must NOT change:** the cost-stop-outranks-steer bullet (`:137-156`), the facade-only rows
  (`:56` re-verified true at HEAD), "No CLI verb for live steer exists yet" (`:58-63` — still true;
  §5), the ADR-001/ADR-006 rule text, the verification-gates section, anything in
  `docs/reports/2026-08-24-kernel-reuse-audit.md` (dated report, stays historical). Do not
  pre-describe R22-2/R22-3 (unlanded at this slot's HEAD).
- **Regression guard (no runtime test owed):** the census terminator, plus the audit P1 grep
  transcript re-run against the landed tree — the old claim strings
  (`steerText?(text)` one-parameter at `:54`/`:72`, "went to document-and-drop", "do not survive a
  retried attempt" as unqualified current semantics) must no longer match, and
  `node scripts/kernel-reuse-probe.mjs` stays 3 PASS (it greps `src/` only).
- **Ownership (exclusive):** `docs/kernel-reuse.md`,
  `.agents/skills/pi-sparkle/references/kernel-reuse.md`. Nothing else.
- **Parent sign-off: granted (freeze lift, truth-up only).**

### R22-2 (P2, land second) — the flowchart plane must carry a run-level `maxCostUsd` to `ChildCoordinator`

- **Proven defect (audit P2, 3×, control + defect):** on the coordinator plane a run-level cap of
  0.5 reaches the child's execution request and its durable `RUN_CREATED.limits` (control); on the
  flowchart plane — the plane CLI `--children` compiles onto — the same declared intent is
  **silently discarded**: `attachChildRuntime` (`flowchart-run.ts:729-739`) constructs
  `ChildCoordinator` with no `maxCostUsd` at both call sites (`:1459` start, `:1668` resume),
  `FlowchartRunInput` has no field for one, and `resolveLimits` (`:178-190`) drops the nearest
  spelling without a word — child request `undefined`, child `RUN_CREATED` capless, flowchart
  `RUN_CREATED` capless, status COMPLETED, no warning. The enforcement machinery
  (`costCapFor`, effective-cap stamping, `child-coordinator.ts:407-440`) already exists and is
  pinned; only the handoff is missing.
- **Fix shape (parent sign-off 3, YES):** mirror `startParentRun` exactly.
  - `FlowchartRunInput.maxCostUsd?: number` (new optional field beside `childTasks`;
    **not** on `FlowchartRunLimits` — forbidden — and **no** `FlowchartContinuation` counterpart:
    a resume must not be a way to introduce or raise a cap).
  - Validate fail-closed in `startFlowchartRun`'s pre-lock refusal zone (`:1340-1357`): anything
    present that is not a positive finite number throws `DomainValidationError` before any write
    (a refused start leaves the state root untouched).
  - Stamp it into the flowchart run's own record at `:1397-1401`:
    `...(input.maxCostUsd !== undefined ? { maxCostUsd: input.maxCostUsd } : {})` — durable on
    `RUN_CREATED.limits`, write-side validated via `validateRun`; absent stays an absent key.
  - `attachChildRuntime` input gains optional `maxCostUsd`; spread into the `ChildCoordinator`
    deps exactly as `coordinator.ts:726` does.
  - Start call site (`:1459`) passes `run.limits.maxCostUsd`; resume call site (`:1668`) passes
    `replayed.run.limits.maxCostUsd` — a durable-record restore, not an invention, and therefore
    needs no disclosure line. `unblock` executes nothing; the reopened work resumes through the
    same rebuild.
  - **Interaction contract:** the run-level cap is coordinator state, not a per-task declaration —
    it must NOT enter `TASK_REQUEST.limits` (that record stays the caller's declared per-task
    budget), must NOT enter `taskCostCeilings` (per-task declared ceilings only, frozen), and must
    NOT alter `fallbackChildLimits` / `withRecordedCostCeilings` (R20-1, frozen). The effective
    per-attempt cap remains `costCapFor` = min(per-task, run-level), stamped where it already is.
- **Tests owed (new `test/integration/m2.5/flowchart-run-cap.test.ts`, run 3×):** (1) input cap →
  child execution request + child `RUN_CREATED.limits` carry it, and the flowchart run's own
  `RUN_CREATED.limits.maxCostUsd` records it; (2) tighter-of both directions (per-child 0.1 under
  run 0.5 → 0.1; per-child 0.9 under run 0.5 → 0.5); (3) absent stays absent (the audit's part-B
  shape as the control: no cap anywhere, request `undefined`, absent keys on both records);
  (4) invalid input (`0`, negative, `NaN`, `Infinity`, non-number) refused with
  `DomainValidationError` before any write — state root left untouched; (5) resume restore: start
  with a run-level cap, interrupt before a child dispatches (pause-shape used by
  `resume.test.ts`), resume → the substituted child's execution request carries the run-level cap
  from the replayed `RUN_CREATED`, and `TASK_REQUEST.limits` still does not. Existing suites
  (`resume.test.ts`, `children-flowchart.test.ts`) stay green untouched.
- **Docs owed (census terminator, same commit):** `docs/specs/m0-m2-architecture.md` — beside the
  `:368-381` budget clauses, state the run-level ceiling contract: declared on
  `startFlowchartRun`'s input, stamped into the run's `RUN_CREATED.limits`, handed to the child
  coordinator (tighter-of rule unchanged), restored on resume only from that durable record, never
  synthesized. `docs/data-dictionary.md:158-165` — conditional: if the landing's diff makes "a
  declared ceiling comes back only from the durable `taskCostCeilings` record" misleading, extend
  that sentence to name the run-level ceiling's separate durable source in the same commit.
- **Ownership (exclusive):** `src/run/flowchart-run.ts`, new
  `test/integration/m2.5/flowchart-run-cap.test.ts`, `docs/specs/m0-m2-architecture.md`,
  `docs/data-dictionary.md` (conditional). No `replay.ts`, no `child-coordinator.ts`, no
  checkpoint-schema change, no adaptation-plane import edges.
- **Parent sign-off: granted (sign-off 3, YES).**

### R22-3 (P3+P4, land third — compiles against R22-2's input field) — CLI `--max-cost-usd` + `onCostGate` stderr

- **Proven defects (audit P3 + P4, 3× each):** (P4) `run --max-cost-usd 5` is
  `Unknown option` exit 1 — no run-level ceiling is requestable from the CLI at all. (P3) a
  requested cap on an unpriced model disarms with **zero observable trace** when `onCostGate` is
  unwired: 2 provider calls, `EXECUTION_FINISHED SUCCESS`, no `ExecutionEvent` mentions the cap —
  and the CLI chain *cannot* wire the sink: `createConfiguredPiExecutor`'s input has no
  `onCostGate` member (TS2353 transcript in the audit), `rg onCostGate src/cli/` empty. Every CLI
  custom provider without explicit rates is an unpriced model (`buildCustomProvider` zero-fills;
  `catalogPrices` reads a zero pair as no-price), so this is the *common* case, not a corner.
- **Fix shape (parent sign-offs 2 + 4, YES):**
  - **Flag:** `--max-cost-usd <usd>` on `run` (`parseArgs` options, `type: "string"`). Parse via a
    new exported `parseRunCostCeiling(raw: string | undefined): number | undefined` in `main.ts`:
    `undefined` stays `undefined` (never invent a cap); accepted spelling is plain decimal only
    (`/^\d+(\.\d+)?$/`, then positive-finite and > 0 — the `lockWaitOptions` spelling discipline:
    no `1e4`, no `0x10`, no whitespace); anything else throws `DomainValidationError` with frozen
    message `--max-cost-usd must be a positive finite number of US dollars, got: <raw>`.
  - **Plain path:** `startRun({ stateRoot, executor }, { projectRoot, objective, ...(cap !==
    undefined ? { limits: { ...defaultRunLimits(), maxCostUsd: cap } } : {}) })` at `main.ts:1058`.
    An absent flag makes the byte-identical call the CLI makes today. `startRun` already forwards
    it to the root request only when present (`coordinator.ts:393-396`, pinned).
  - **`--children` path:** pass `...(cap !== undefined ? { maxCostUsd: cap } : {})` into the
    `startFlowchartRun` input at `main.ts:990-1012` (R22-2's field). The fake-children executor
    ignoring the cap stays the pinned contract — the cap is recorded and forwarded, not enforced
    by fakes.
  - **`--flowchart` / `--track`:** loud parse-stage refusal (`cliFail`, before any work), frozen
    message `run --max-cost-usd is not wired for --flowchart or --track yet; it caps the default
    and --children paths`, next-line `omit --max-cost-usd, or use the default or --children path`.
    Silent acceptance of a flag that does nothing is the exact dishonesty this loop kills.
    Forwarding for those paths is §5.
  - **Resume:** gains no flag (an unknown option already refuses). Nothing re-arms a cap from
    flags on any resume path; the flowchart resume restores the durable run-level cap via R22-2's
    replayed-`RUN_CREATED` path, which is a record restore and needs no disclosure; the plain-path
    resume rebuilds a checkpoint and executes nothing; `--supervised` is out of scope. This is the
    `--thinking` disclosure posture the sign-off asked for: no new disclosure machinery, nothing
    claimed that is not recorded.
  - **`onCostGate`:** `createConfiguredPiExecutor` input gains
    `readonly onCostGate?: (event: CostGateEvent) => void`, conditionally spread into
    `PiAgentExecutor` options (existing callers unbroken — optional member, same pattern as
    `onInvocation`). `main.ts:createExecutor`'s `hooks` parameter gains `onCostGate`, passed on the
    `pi` arm only; both `runCommand` executor builds and both `resumeCommand` executor builds hand
    it a handler that writes `formatCostGateWarning(event)` to stderr when defined.
  - **Frozen wording** — new exported `formatCostGateWarning(event: CostGateEvent): string |
    undefined` in `main.ts`:
    - `disarmed` / `unpriced-model`: `warning: cost ceiling not enforced for task <taskId>:
      requested <maxCostUsd> USD, but the catalog quotes no usable price for this model, so spend
      is unknowable; the run continues uncapped\n`
    - `disarmed` / `invalid-cap`: `warning: cost ceiling not enforced for task <taskId>: requested
      <maxCostUsd> USD is not a positive finite number of dollars; the run continues uncapped\n`
    - `disarmed` / `no-cap`: `undefined` (unreachable — the executor emits disarmed only when a cap
      was requested — handled exhaustively, printing nothing).
    - `stopped`: `undefined` — a real ceiling stop is already transcript-visible (parent sign-off);
      no second record, no new `ExecutionEvent`.
  - **USAGE:** add `[--max-cost-usd <usd>]` to the plain and `--children` run lines and one prose
    sentence: per-run USD ceiling forwarded to the executor's cost gate; on `--children` each
    child attempt runs under the tighter of it and that child's own `limits.maxCostUsd`; an
    unpriced model cannot enforce it and says so on stderr; there is no cross-child spend ledger —
    N children under a $X run cap can spend up to N·$X between them (the disclosed
    `ChildCoordinator` semantics, `child-coordinator.ts:56-63` — do not imply otherwise).
- **Tests owed (run 3×):**
  - New `test/unit/cli/cost-flag.test.ts`: `parseRunCostCeiling` accept/refuse table (valid
    decimals; refuse `0`, negative, `1e4`, `0x10`, ` 5 `, `abc`, empty; `undefined` →
    `undefined`) with the frozen message byte-pinned; `formatCostGateWarning` byte-pins for all
    four arms (both disarmed wordings exact; `no-cap` and `stopped` → `undefined`).
  - New `test/integration/cli/run-cost-cap.test.ts`: `run --max-cost-usd 0.5` (fake executor) →
    the run's `RUN_CREATED.limits.maxCostUsd` is `0.5` on disk; flag absent → absent key
    (byte-level control that the no-flag call is unchanged); refusal pins for the invalid
    spelling, and for `--flowchart` and `--track` combinations (frozen messages).
  - `test/integration/m1/cli-children.test.ts` (existing, extended): `run --children
    --max-cost-usd 0.5` with a cap-free spec → each child's `RUN_CREATED.limits.maxCostUsd` is
    `0.5` while its `TASK_REQUEST.limits` gains **no** invented per-task cap; with a spec
    declaring `0.1` → effective `0.1` (tighter-of); the existing R18-2 pins (`:84-162`) stay green
    untouched.
  - New `test/integration/pi-adapter/costgate-cli-warning.test.ts` (uses the existing
    `test/helpers/loopback-openai-provider.ts` harness the way `loopback-cli-resume.test.ts`
    does): a CLI `run --executor pi --max-cost-usd 0.01` against a costless custom provider
    (unpriced by construction) prints exactly one frozen `unpriced-model` warning line on stderr
    and still exits by the run's own outcome — proving the whole
    `main.ts → createExecutor → createConfiguredPiExecutor → PiAgentExecutor → stderr` thread; if
    the loopback harness cannot host it, the fallback vehicle is a runtime-level test constructing
    `createConfiguredPiExecutor` with a costless custom provider and asserting the callback
    reaches the handler — but the stderr byte-pin then still rides the unit test above.
- **Ownership (exclusive):** `src/cli/main.ts`, `src/pi-adapter/runtime.ts`,
  `test/integration/m1/cli-children.test.ts`, new `test/unit/cli/cost-flag.test.ts`, new
  `test/integration/cli/run-cost-cap.test.ts`, new
  `test/integration/pi-adapter/costgate-cli-warning.test.ts`, `docs/status-matrix.md` (row 32
  and/or 34: the flag, the recorded-not-fake-enforced posture, the disarmed warning; row 38: one
  sentence that a run-level ceiling comes back from the run's own `RUN_CREATED.limits` on
  flowchart resume). No `pi-executor.ts` edits (the sink and events exist; only the factory and
  CLI thread through), no `cost-gate.ts` edits (arithmetic frozen), no `contract.ts` edits.
- **Parent sign-off: granted (sign-offs 2 + 4, YES).**

### Dispatch cross-check

No file appears in two slots (the two kernel-reuse docs only in R22-1; `flowchart-run.ts` + the
new m2.5 test + `m0-m2-architecture.md` + `data-dictionary.md` only in R22-2; `main.ts` +
`runtime.ts` + `cli-children.test.ts` + three new test files + `status-matrix.md` only in R22-3).
Every named existing path verified at HEAD; the four new test files land in existing directories.
**Order is binding:** R22-1 first (truth at its HEAD, and the freeze re-closes behind it), R22-2
second, R22-3 third (its `--children` forwarding references R22-2's `FlowchartRunInput.maxCostUsd`
and will not typecheck before it lands).

## 5. Explicitly NOT for Round 22 landings

Everything in ROUND21-BRIEF §5, verbatim — including: re-litigating the R18-1 replay placement or
latch; a steer-ordering contract across retry boundaries; pinning the unreachable kernel-refusal
ordering in `steerText`; treating a ceiling-stopped unread steer as a defect; the
`SteerChannel.settled()` swallow; the `AsyncEventQueue` close race; flowchart-node spend ceilings /
a cross-child run-spend ledger; the `/tmp` suite-root leak as a standalone slot; a 12th crash-probe
case; the cluster `onSpawn` hardcoded limits; re-running `security-probe` as a recurring chore;
broadcasting steers or a per-run kernel registry; the parent-run × root-run untargeted
cross-delivery (no false durable record — unchanged judgment); the unblock-reopen test-only pin;
the tsx cache hazard as a code slot; a `taskCostCeilings` legacy-recovery arm — **with these
Round 22 updates:**

- **The `steer` CLI verb (parent sign-off 5: condition not met — deferred with reasoning).**
  `RunningRun.steer` is an in-memory handle inside the blocking `run` process;
  `PiAgentExecutor.steerText` needs the live kernel object. A `steer --run` verb executes in a
  second process, so it requires a cross-process delivery channel, and every candidate channel is
  a product decision: a pause-style token file makes the verb return on *enqueue*, not *delivery*,
  so the process that owns the R20-2 refusal ("targeted miss refuses before `STEER_INJECTED`")
  is not the process the operator invoked — the verb must either lie about delivery or grow
  poll/attach semantics; the queue file is a durable record of steers a crashed run never consumed
  (the false-record shape R20-2 exists to prevent); and naming/attaching to a live run needs an
  ack protocol that does not exist. That is "how to name a live run, poll vs attach" — the
  sign-off's own §5 trigger. Needs a parent product design (delivery channel, ack, crash
  semantics) before any slot exists. `docs/kernel-reuse.md:58-63`'s "no CLI verb yet" stays true
  and stays in the truth-up unchanged.
- **`--max-cost-usd` forwarding on `--track` and `--flowchart`.** `--track` would carry via
  R22-2's seam but crosses `startTrackedRun`'s input (`src/track/loop.ts`) — not in the sign-off's
  grant; `--flowchart` without `childTasks` executes RUNNING nodes on the thin path
  (`executeRemainingRunningNodes` → `executeFlowchartNode`), which forwards no cap at all — a new
  enforcement surface, not a handoff. R22-3 refuses the flag loudly on both; forwarding is a
  future sign-off.
- **Refusing unknown keys in `resolveLimits`.** The silent drop the audit exercised is closed by
  the first-class input field; hardening a validator against a spelling TS already refuses is
  defensive code for an unreachable case.
- **A `stopped` stderr line, a cost-gate `ExecutionEvent`, or any new durable cost-gate record.**
  A real ceiling stop is already transcript-visible (parent sign-off); the frozen handler prints
  for `disarmed` only.
- **A run-level-cap flag on `resume`, or executor-cap re-arming on resume.** The flowchart plane
  restores from the durable `RUN_CREATED`; nothing else may re-arm from flags this round.
- **Extending `scripts/kernel-reuse-probe.mjs` to check prose.** The probe is a source claim gate;
  R22-1's guard is the census terminator plus the reproducible P1 grep transcript.

**Valid reasons to dispatch anything beyond §4** (unchanged, each owing a fresh deterministic
out-of-tree proof at that HEAD, 3× identical transcripts of real repo code): a new seam lands; a
reproduced behavioural gap; gate or probe goes red on an independent run; a landing stale-ifies
recorded surfaces (then the alignment rides inside that landing). A zero-slot follow-up round
after §4 lands is a valid, recordable round.
