[Model: claude-opus-5-thinking]

# Loop 4 · Round 20 · slot R20-2 — a steer must land in the run whose handle accepted it

Branch `cursor/opt-r18-postmerge-42b1`, dispatched at HEAD `adcf727`. No commits, no pushes, no
branch changes. No `PROGRESS.md` edit. Sibling R20-1's files (`flowchart-run.ts`, `replay.ts`,
`resume.test.ts`, `docs/specs/m0-m2-architecture.md`) are untouched by me; they show modified in
`git status` because the sibling is landing in the same working tree.

**Outcome: the sign-off shape landed exactly.** `AgentExecutor.steerText?(text, agentInstanceId?)`;
`startRun` passes its root instance, `startParentRun` passes none; a targeted miss is a loud
`DomainValidationError` and never writes `STEER_INJECTED`. No new event type, `src/run/events.ts`
unchanged, no broadcast, no second kernel registry, R18-1 replay mechanics byte-unchanged.

## 1. Files changed

| File | Change |
|---|---|
| `src/execution/contract.ts` | Optional member widened to `steerText?(text: string, agentInstanceId?: AgentInstanceId): void`. The "silently goes nowhere is worse than a rejected one" sentence is kept verbatim and extended: a targeted call refuses when that instance has no attempt in flight rather than falling back to whichever attempt is; omitting the target keeps sole-live-or-refuse. Nothing else in the file moved. |
| `src/pi-adapter/pi-executor.ts` | `steerText` region only. New first branch: with a target, look up that instance in `liveKernels`; miss ⇒ `DomainValidationError("cannot steer: no agent run is in flight for ${agentInstanceId}")`; hit ⇒ deliver and record under that instance. Untargeted path unchanged, including both refusal strings byte-for-byte. The record-after-accept body (`kernel.steerText(text)` then `acceptedSteers.get(id)?.push(text)`) moved verbatim into a private `deliver(...)` so both branches share one ordering; its comment is unchanged. |
| `src/run/coordinator.ts` | `SteerChannel` gains a `target` field, `open(record, agentInstanceId?)` sets it, `close()` clears it, and `steer` calls `this.executor.steerText(text, this.target)` at the same point in the same order (delivery still strictly before `record(...)`). `startRun`'s `open` now passes its root `agentInstanceId`; `startParentRun`'s passes none, with the reason written next to it. `RunningRun.steer`'s docstring now says "this run's agent is not in flight — including between the attempts of a retry, even if the same executor is driving another run that is". |
| `scripts/kernel-reuse-probe.mjs` | One regex character class: `steerText\s*\(\s*text\s*:\s*string\s*\)` → `…\s*[,)]`. See residual R1 — this is a landing-triggered census fix, not a scope grab. |
| `test/integration/pi-adapter/steer-target.test.ts` | **New** (464 lines), 3 tests. |

Censused and deliberately **not** changed: `src/testing/fake-executor.ts` (`GatedExecutor.steerText(text)`),
`KernelBackedExecutor` in `steer-inflight.test.ts`, `SparkleKernel.steerText`. A one-parameter
implementation stays assignable to the two-parameter optional member, and each ignores the extra
argument — which is exactly what their pins assert. `test/unit/pi-adapter/steer-inflight.test.ts`
needed no unit pin: the executor-level targeted refusal is pinned end-to-end in the new file, and
M2/M4 below show it single-red from there.

## 2. Test names

New, in `test/integration/pi-adapter/steer-target.test.ts`:

1. `a steer aimed at a run in retry backoff is refused, not delivered into a run sharing the executor`
   — the audit's §4.2 proof shape as a regression pin. Two real `startRun`s on one real
   `PiAgentExecutor`; run A's attempt 1 takes a 429 and its backoff `sleep` is held on a deferred;
   run B is then started and held live by a blocking tool. **In-proof control:** before B exists,
   `runA.steer` refuses loudly — the frozen unshared-backoff contract. **The regression:** with B
   live, `runA.steer` still refuses. Asserted afterwards: no run A model call carries the text; no
   run B model call carries it; run A's log has **no** `STEER_INJECTED` (no false record for a
   drop); run B's log has none either (no steal); both runs still complete.
2. `a steer through a live run's own handle reaches that run and no other on the same executor`
   — the positive half, so the fix cannot be "refuse everything". Both runs live; an untargeted
   `executor.steerText` is asserted to refuse with `/2 agent runs are in flight/`, and then
   `runA.steer` succeeds: exactly one run A model call carries the text, zero of run B's do, run A's
   `STEER_INJECTED` carries its actor and its own `AGENT_STARTED` instance, run B's log has none.
3. `a parent run steers whichever child is live, naming no agent instance`
   — pins the "keeps passing none" half against a recording executor: the target the parent's steer
   arrives with is `[undefined]`, and the parent's `STEER_INJECTED` payload keys are exactly
   `["text"]`.

Run 3× in-tree, identical each time, alongside the 12 pre-existing steer pins (all green,
**untouched**): 15 tests / 15 pass / 0 fail / 0 cancelled / 0 skipped.

```text
ok 1  - steering a live run reaches the executor and is recorded with its actor and text
ok 2  - a steer lands in the log before the run reads its own event log back
ok 3  - blank steer text is refused synchronously and never reaches the executor
ok 4  - steering an executor that does not implement it is refused, not silently dropped
ok 5  - steering outside the execution window is refused
ok 6  - steerText reaches the live agent while a tool blocks the run, and only then
ok 7  - steerText refuses to guess when the shared executor has several runs in flight
ok 8  - a steer accepted before a retried provider failure reaches the retry's context
ok 9  - a steer survives more than one retry and is re-delivered exactly once per attempt
ok 10 - a steer aimed at a run in retry backoff is refused, not delivered into a run sharing the executor   [new]
ok 11 - a steer through a live run's own handle reaches that run and no other on the same executor          [new]
ok 12 - a parent run steers whichever child is live, naming no agent instance                               [new]
ok 13 - SparkleKernel queues steering text while its agent prompt is in flight
ok 14 - RunningRun.steer forwards in-flight text to the live kernel and rejects empty text
ok 15 - a steer refused by the kernel is not recorded as if the agent had received it
```

Consumer sweep beyond the owned tests (not the full gate — that is the parent's):
`test/integration/{m0,m1,m3,pi-adapter,cluster}` + `test/unit/{run,pi-adapter}` =
**445 tests / 444 pass / 0 fail / 1 skipped (`PI_SMOKE`) / 30 suites**.

## 3. Mutant transcript

All mutants run **out of tree** (full working-tree copy under `/tmp/r20-2-mut/tree`, `node_modules`
symlinked), 2× each with identical results, tree deleted and verified gone. Baseline of the copy
before each mutant: 3/3 pass.

| # | Mutation | Result (2/2) |
|---|---|---|
| M1 | `SteerChannel.steer` drops the target: `this.executor.steerText(text)` | **Tests 1 and 2 red.** T1 `Missing expected exception (DomainValidationError)`; T2 `cannot steer: 2 agent runs are in flight and steering has no target`. |
| M1b/c | M1 plus a probe that swallows T1's refusal assertion, so the *delivery* assertions speak | **The audit's defect verbatim.** See transcript below. |
| M2 | Executor keeps the target lookup but falls back to the sole-live path on a miss instead of throwing | **Test 1 red only** (`Missing expected exception`); tests 2 and 3 green. The targeted-refusal clause alone is load-bearing. |
| M3 | `startRun` opens the channel with no target (`open(record)`) | **Tests 1 and 2 red**, same two messages as M1. The call site is load-bearing independently of the channel. |
| M4 | Executor's targeted branch always throws, never delivers | **Test 2 red only** (`cannot steer: no agent run is in flight for agt_…`); tests 1 and 3 green. The fix is not "refuse everything". |
| M5 | `startParentRun` opens with an invented `createAgentInstanceId(generateId)` target | **Test 3 red only.** The "parent passes none" clause is pinned. |

**M1b/c transcript — drop the target and the cross-run delivery returns:**

```text
# MUTANT PROBE: runA.steer was ACCEPTED while run A was in backoff
not ok 1 - a steer aimed at a run in retry backoff is refused, not delivered into a run sharing the executor
  error: run B must not be handed run A's instruction, got …
    + actual - expected
    + [
    +   [
    +     '[{"type":"text","text":"Working directory: /tmp/pi-sparkle-proj-b-5jkqc8\n\nRUN-B: refactor the parser"}]',
    +     '"RUN-A ONLY: stop the schema migration immediately."'
    +   ]
    + ]
    - []
```

and, with that assertion also probed rather than asserted, both durable dishonesties the audit
named, reproduced at this HEAD:

```text
# MUTANT PROBE: run A STEER_INJECTED = [{"agentInstanceId":"agt_89eb683b-…","text":"RUN-A ONLY: stop the schema migration immediately."}]
# MUTANT PROBE: run B STEER_INJECTED = []
```

Run A's log names run A's own agent instance for text run A's agent never saw; run B's model got the
instruction with no record of it anywhere. Both go away with the target restored.

## 4. Gates run

- `pnpm exec tsc --noEmit` (whole tree, includes the sibling's in-flight edits): **exit 0**.
- `pnpm exec eslint` scoped to `src/execution/contract.ts src/pi-adapter/pi-executor.ts
  src/run/coordinator.ts scripts/kernel-reuse-probe.mjs
  test/integration/pi-adapter/steer-target.test.ts`: **exit 0**.
- `node scripts/kernel-reuse-probe.mjs`: **3 PASS, exit 0** — recorded PASS at baseline before any
  edit, and PASS again after (see residual R1).
- No full gate, no crash-probe, no security-probe: parent's job, and nothing here touches `dist/`
  or the redaction pipeline.
- Hygiene at report time: no `/tmp/r20*`, no `pi-sparkle-{state,proj}-{a,b}-*` roots (my test's own
  prefixes), mutant copy deleted. The `/tmp` roots left by other suites are the known frozen
  phenomenon and are not mine.

## 5. Frozen-contract compliance

- **R18-1 untouched.** The diff on `pi-executor.ts` is confined to `steerText` and the extracted
  `deliver`. `runAttempt`'s first-`TURN_FINISHED` replay placement, the `replayPending`
  once-per-attempt latch, `runWithRetry`'s execution-scoped `acceptedSteers` open/close with its
  identity guard, and the per-attempt `[...steers]` snapshot are all byte-identical. Pins 8 and 9
  green 3×. Unshared-backoff refusal is now pinned twice: the existing executor-level pins and this
  slot's in-proof control.
- **Delivery before logging preserved.** `SteerChannel.steer` still calls the executor before
  `record(...)`; the targeted miss throws inside that call, so no write is even attempted. Pin 15
  ("a steer refused by the kernel is not recorded as if the agent had received it") still holds.
- **No new event type**, `src/run/events.ts` 0 diff lines. `startParentRun`'s payload still carries
  no `agentInstanceId` (pinned by test 3).
- **No broadcast, no second registry.** The only kernel map is the existing `liveKernels`; the
  targeted path is one `Map.get`.
- **Untargeted refusal strings byte-identical** (`cannot steer: no agent run is in flight`,
  `cannot steer: N agent runs are in flight and steering has no target`). The new targeted message
  is deliberately in the same family and also matches the existing `/no agent run is in flight/`
  assertions.
- Not touched: doctor routes, `INSPECT_SUMMARY`, `onRunStarted`, the five `DOCTOR_ROUTED_NEXT`
  strings, `RUN_UNBLOCKED` keys, `SteerChannel.settled()`, `AsyncEventQueue`, `package.json`, any
  adaptation-plane import edge, any CLI verb.

## 6. Residuals

**R1 — `scripts/kernel-reuse-probe.mjs` (one regex character class, outside the named ownership).**
The probe's `executor-steer` check asserted the *exact* one-parameter signature
(`steerText\s*\(\s*text\s*:\s*string\s*\)`), so the sign-off's widening turns it red on a source
shape it was never checking for. It is a documented manual source gate
(`docs/kernel-reuse.md:231`), not part of `pnpm gate` or `prerelease`, so nothing would have caught
this in the parent's gate — it would have gone red the next time someone ran it. I recorded PASS
before the edit, widened only the terminator to `[,)]`, and recorded PASS after; the check still
requires `export class PiAgentExecutor`, a `steerText(text: string…` declaration, and a
`.steerText(text)` forward to a kernel. No other file in the round claims this path. Flagging it
because it is a census consequence rather than a granted file: **if the parent prefers, revert it
and take the probe red instead.**

**R2 — `docs/kernel-reuse.md` is now stale in two more places, and stays frozen.** `:54` and `:72`
both write the contract as `AgentExecutor.steerText?(text)` and describe `PiAgentExecutor.steerText`
as targeting "the single in-flight kernel and refuses when zero or several runs are live" — true
only of the untargeted call now. The file-wide freeze from ROUND19-BRIEF §5 is carried into
ROUND20-BRIEF §3/§5 and I honored it: **no edit made or proposed.** This is the same shape as audit
§3 H5 record 1 (the superseded retry-steer lines at `:131-136`, `:213-214`), and both now wait on
the same decision, so whenever the parent re-judges that freeze there are three stale spots, not
one. `docs/reports/2026-08-24-kernel-reuse-audit.md:202` says the same thing but is a dated report,
historical rather than normative — I would leave it alone even unfrozen.

**R3 — a parent run sharing an executor with a root run can still deliver cross-run.**
`startParentRun` passes no target by sign-off, so its steer goes to the executor's sole live kernel.
If the only live kernel belongs to a *root* run on the same executor rather than to one of the
parent's own children, the parent's text lands in that root run's kernel and in its
`acceptedSteers`. No record goes false — the parent's `STEER_INJECTED` names no instance (pinned by
test 3) and the root run writes nothing — so this is not the R20-2 defect, and the whichever-child
semantics are explicitly frozen as disclosed. Recording it because the audit scoped its analysis to
one parent run's children (`coordinator.ts:777-788`) and this combination is a step outside that
scope. Fixing it would need a per-run set of candidate instances, which is the "second registry"
the sign-off forbids; the cheaper answer if the parent ever wants one is for the parent path to
refuse when the sole live kernel is not one of its own children.

**R4 — the targeted branch validates blank text first, then the target.** Same order as the
untargeted path, so a blank steer aimed at a dead instance reports "non-empty" rather than "not in
flight". Deliberate and consistent with the pinned pre-existing ordering; noting it because it is
the one place a caller could see a different message than the audit's transcript.

**R5 — `deliver` is reachable only from `steerText`.** I extracted it so the targeted and
sole-live branches cannot drift on record-after-accept ordering (M2 shows what drift there costs).
It is not a new seam and takes no new state.
