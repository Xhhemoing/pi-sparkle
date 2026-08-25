[Model: claude-fable-5-thinking-xhigh]

# Loop 4 · Round 18 — post-merge audit of the combined tree

Auditor role: Round 18 post-merge auditor. Branch `cursor/opt-r18-postmerge-42b1` at HEAD `7d8b7a3`
(PROGRESS/OWNERSHIP only); audited code tree = merge `985250b` (PR #8: Loop 4 + Loop 3 + kernel-reuse
into `main`). No commits made by this auditor; no other branches checked out.

**Verdict: 2 candidates, both proven with deterministic out-of-tree runs of real repo code.**
R18-1 (steer silently lost across a provider retry, P2, sign-off YES on semantics) and
R18-2 (`run --children` silently drops a declared per-child `maxCostUsd`, P2, no sign-off).
Everything else on the merge seam is clean; the three CI-fix commits hold at HEAD.

## 1. The merge seam (what could even be new)

`git diff a941f9b 985250b -- src scripts` (pre-merge Loop 4 tree vs merged tree) is exactly 16 files:

- New modules: `src/pi-adapter/kernel.ts` (SparkleKernel facade + AsyncEventQueue),
  `src/pi-adapter/cost-gate.ts` (CostGate + catalogPrices), `scripts/invocation-lock-probe.mjs`,
  `scripts/kernel-reuse-probe.mjs`.
- Rewritten: `src/pi-adapter/pi-executor.ts` (kernel-driven attempts, live streaming, steering,
  cost gate, `THINKING_DELTA` translation).
- Extended: `src/execution/contract.ts` (`THINKING_DELTA`, `maxCostUsd`, optional `steerText`),
  `src/run/coordinator.ts` (SteerChannel + `RunningRun.steer` + `maxCostUsd` forward + THINKING_DELTA
  append), `src/run/child-coordinator.ts` (`costCapFor`, cap on child `RUN_CREATED` + request,
  THINKING_DELTA), `src/run/events.ts` (`STEER_INJECTED` type + payload validation, THINKING_DELTA
  agent-event kind), `src/run/supervisor.ts` (cap forward), `src/run/replay.ts` (STEER_INJECTED
  no-op), `src/run/inspection.ts` + `src/cli/main.ts` (pure `buildInspectSummaryJson` projection,
  same four frozen keys), `src/protocol/v1.ts` (rewritten `maxCostUsd` disclosure),
  `src/pi-adapter/index.ts` (barrel exports), `src/testing/fake-executor.ts` (steer-aware fakes).

Files NOT in the diff (`preferences/*`, `learning/*`, `adapt.ts`, `feedback/store.ts`,
`persist/*`, `migrate-legacy.ts`, `crash-probe.mjs`, `file-credential-store.ts`) are byte-identical
across the merge — the Round 17 closures and all frozen contracts are untouched.

## 2. Independent baseline (this VM, Node v22.14.0, engine warning only)

- Auditor's own `pnpm gate` at HEAD: **GREEN, exit 0 — 2038 tests / 2037 pass / 0 fail /
  0 cancelled / 1 skipped / 120 suites**. The skip is the single `PI_SMOKE` line
  (`PiAgentExecutor completes a run against a real provider # SKIP`). This **verifies the merger's
  claimed 2038/2037/1**.
- Auditor's own `node scripts/crash-probe.mjs`: **`ok: true`, 11 cases × 3 iterations**, names and
  order identical to the Round 16/17 record, `unblock-discard-append-before-checkpoint-sigkill`
  last. No 12th case; `scripts/crash-probe.mjs` diff-empty across the merge.
- Both privacy guards pass standalone (11/11 subtests): `plane-boundary.test.ts` and
  `adaptation-plane-closure.test.ts`. Both fail closed in both directions (unallowlisted-edge AND
  stale-allowance asserts), so a green run means the allowlists equal the real import graph:
  direct exceptions = 5 entries; value-runtime ingress edges = 2
  (`learning/from-episode.ts -> run/event-store.ts`, `routing/assign.ts -> supervisor/model-router.ts`);
  transitive closure allowance = 4 modules (`run/event-store.ts`, `run/events.ts`,
  `run/injection.ts`, `supervisor/model-router.ts`). The R17-1 `episode-bind` edges stay gone.

## 3. The three CI-fix commits hold at HEAD

| Commit | Verified at HEAD by |
|---|---|
| `77e5d42` keep kernel events live through tool start | `pi-executor.ts:558-561` streams every translated event while `streamPrefixOpen` (closed only by the task-verdict emit at `:518`); `translatePiEvent:134-141` maps `thinking_delta` to bytes only. Pinned green by `steer-blocked-tool.test.ts` (the consumer steers upon a **live** `TOOL_STARTED` while the tool blocks) and `live-stream.test.ts`. |
| `dc0c611` shrink adaptation closure allowance | `adaptation-plane-closure.test.ts` allowlist = the 4 modules above; the stale-allowance assert makes shrink mandatory; green standalone and in the gate. `docs/data-dictionary.md` precision note matches. |
| `159630e` align child cost contract with enforcement | `protocol/v1.ts:78-88` discloses forwarding + executor-dependent enforcement; `child-coordinator.ts:407-418 costCapFor` = min(per-task, run-level); forwarded at `:436` (child `RUN_CREATED.limits`) and `:669` (request). Pinned by the two rewritten tests (source-regex pin + forwarded-cap assert), both green. |

The two merge-resolution test commits (`4e13877` fuzz seed, `3684e59` canonical agent id) also hold
(event-row fuzz + steer fixtures green in the gate).

## 4. Proven holes (deterministic, out-of-tree, real repo code; proofs deleted after capture)

Method: full tree copy via `git archive HEAD` to `/tmp/r18-audit/tree`, `node_modules` symlinked,
proofs run via the repo's own `scripts/run-tests.mjs`, each run 3× (identical results), then the
whole `/tmp/r18-audit` deleted.

### R18-1 (P2) — a steer accepted mid-attempt is silently lost when the attempt is retried

`execution/contract.ts`'s own contract: *"a steer that silently goes nowhere is worse than a
rejected one."* The merged tree violates it at the steer × retry seam: `runWithRetry` builds a
**fresh Agent per attempt** (`runAttempt` → `SparkleKernel.fromFactory`), so a steer accepted by
`steerText` during attempt N — queued, or already consumed into attempt N's context — dies with the
discarded kernel when a retryable provider failure (429/5xx) triggers attempt N+1. Nothing signals
the drop: the executor accepted the text (no throw), the coordinator has already appended
`STEER_INJECTED` (delivery-before-logging), and the run finishes `SUCCESS`. The event log
permanently claims the run was told something no surviving model call ever saw.

Proof (out-of-tree test, real `PiAgentExecutor` + faux provider, no timers — retry `sleep` stubbed):
responses = (1) text + blocking tool call; (2) capture context, then throw
`429: {"error":{"message":"rate limit exceeded"}}`; (3) capture context, succeed. The test steers
while the tool blocks (same shape as the in-tree `steer-blocked-tool` pin), releases the hook, and
observes:

```text
# attempt-2 user turns: ["[{\"type\":\"text\",\"text\":\"Working directory: .\\n\\nCall blocking_hook, then report.\"}]"]
# final event trail: [...,"EXECUTION_FINISHED:SUCCESS"]
ok 1 - a steer accepted before a retried provider failure never reaches any model call
```

Attempt 1's second provider call saw the steer as its second user turn (consumed into the context
the retry then threw away); attempt 2's only context is the original prompt; the run reports plain
SUCCESS. 3/3 identical. Severity P2: needs steer + transient retryable failure in one attempt
window, but the result is a silent contract violation plus a permanently false `STEER_INJECTED`
record.

Fix shapes (parent sign-off owed on which):
(a) **recommended** — the executor keeps the accepted steer texts for the current `execute()` and
re-delivers them into each fresh retry kernel (they are polled after the new attempt's first turn,
preserving "picked up after its current turn"; the discarded context cannot double-apply them);
(b) record the drop instead of repairing it — surface an executor-level event so the coordinator can
append a correcting record. (a) makes the existing log true; (b) changes the log contract. Either
way `src/pi-adapter/pi-executor.ts` is the seat; no adaptation-plane import edge changes, so neither
privacy test enters ownership.

### R18-2 (P2) — `run --children` silently drops a declared per-child `maxCostUsd`

Merge-induced in the exact sense of ROUND18-BRIEF §4 reason 1: **neither side had this hole alone**.
The Loop 4 side's `parseChildSpec` (`src/cli/main.ts:420-424`) has always copied only
`maxAttempts`/`timeoutMs`/`maxWallTimeMs` — harmless while `maxCostUsd` was disclosed as
validated-but-unenforced. The kernel-reuse side made the field load-bearing
(`costCapFor` → child `RUN_CREATED.limits` + `AgentExecutionRequest.maxCostUsd` → `CostGate`).
Combined: an operator who writes `"limits": {..., "maxCostUsd": 0.25}` in a `--children` spec gets
exit 0, no warning, and a ceiling that never reaches the coordinator — while the protocol validator
accepts that exact limits object on a `TASK_REQUEST` and the coordinator provably forwards the field
when it survives (pinned by `child-coordinator-limits.test.ts`'s forwarded-cap assert, green at HEAD).

Proof (out-of-tree test, real `main()` end-to-end with the default fake-children executor, then
reading the state root back):

```text
# cli exit: 0
# TASK_REQUEST limits: {"maxAttempts":1,"timeoutMs":60000,"maxWallTimeMs":300000}
# child RUN_CREATED limits: {"maxTasks":16,"maxConcurrentTasks":2,"maxAttemptsPerTask":3,"maxRounds":32,"maxConsecutiveStalls":3,"maxWallTimeMs":3600000}
# records scanned: 1 child RUN_CREATED, 1 TASK_REQUEST; maxCostUsd present: false
ok 1 - run --children silently drops a declared per-child maxCostUsd ceiling
```

The declared `$0.25` appears nowhere on disk; `validateAgentMessage` accepted the same limits in the
same test (control). 3/3 identical. Fix: `parseChildSpec` copies a positive finite `maxCostUsd` and
**refuses** any other non-undefined value loudly (a silently-copied invalid value would otherwise be
rejected later by message validation, far from the operator's file). Fold in the stale disclosure
this same plane still carries: `docs/specs/m0-m2-architecture.md:359-360` still says *"the child
coordinator does not currently read usage or enforce this ceiling"* — false since `159630e`; this is
the landing-triggered census alignment the terminator allows and requires (the CI fix updated
protocol/v1, child-coordinator and the data dictionary but missed the spec).

## 5. Swept clean (not candidates, with reasons)

| Surface | Result |
|---|---|
| Thinking-delta privacy | Bytes-only at the adapter (`translatePiEvent`), bytes-only summaries in both coordinators' `AGENT_EVENT`s; no other reader of raw kernel events outside `src/pi-adapter/**`; `STEER_INJECTED` docstring forbids routing anything thinking-derived into its verbatim text. Closure test pins the plane. |
| Steer refusal honesty | Blank text / no run / ambiguous concurrent runs / non-steering executor all refuse loudly (`DomainValidationError`), never drop — pinned by 5 `m0/steer` + 3 `steer-inflight` + 2 `steer-blocked-tool` tests. `FakeExecutor` deliberately lacks `steerText` so fakes refuse too. |
| Steer log ordering | Accepted steer's append settles before the run reads its own log back / writes its terminal (`steerChannel.settled()` before `RUN_COMPLETED`); pinned by `m0/steer` test. Residual note (not a slot): `settled()` uses `allSettled`, so an append that fails at the disk level is swallowed by the run while the caller-facing promise rejects — disk-failure-only path, no reproduction attempted, recorded for whoever next owns `coordinator.ts`. |
| `maxCostUsd` forward paths | `startRun` (root request), `startParentRun` → `ChildCoordinator`, `supervisor.ts` → `ChildCoordinator`: all forward; absent stays absent (no invented caps). Flowchart plane has **no run-level cap to drop**: `FlowchartRunLimits` carries no `maxCostUsd`; its `remainingCostUsd` is the separate, fully-enforced routing-budget plane (decremented per `MODEL_ROUTED`, floor at router). `executeFlowchartNode` (thin non-cluster path) has no cap source; nothing claims it does. |
| Cost-gate honesty | Gate arms only with cap + catalog prices; zero-pair prices read as unpriced (fails safe); non-`ok` usage excluded from telemetry but counted by the ceiling (each with in-source rationale); stop-at-ceiling is visible in the transcript (`"pi agent stopped at the cost ceiling"` summary) even with `onCostGate` unwired. `onCostGate` disarm surfacing at the CLI: noted, not a slot — no CLI path can declare a cap today (R18-2 creates the first), and the `ChildRunLimits` disclosure already names enforcement executor-dependent/best-effort. |
| Isolation allowlists | Both guards green standalone and in the gate; both fail closed in both directions (M2-proven walker + stale-entry asserts). No merge-induced import edges on the adaptation plane. |
| Silent persistence / CLI-vs-disk | No new writers in the 16-file seam (coordinators write through frozen `EventStore`; `inspect --summary-json` projection is pure with the four frozen keys). Preferences/learning/adapt/feedback/persist all diff-empty across the merge; preferences CLI-layer lock (`preferenceSnapshotLockPath` held in `main.ts:1676`) intact; inferred-preference plane stays not-live (R17-1 pins green). |
| Lock contracts | No new snapshot writers landed. Feedback log writer locked + probed (Loop 3, `store-lock.test.ts` + `invocation-lock-probe.mjs`, green). `EventStore.append`/`CheckpointStore.write` stay unlocked (frozen measured decision — not touched). |
| security-probe vs dist | Not exercised: neither proven hole is reachable through `dist` differently than through `src`, and no new dist-facing surface landed. |
| `AsyncEventQueue` close race | Theoretical only: an event pushed after `queue.close()` with the prefix still open would bump `streamedCount` for a dropped value; unreachable in practice because Pi awaits listeners before `waitForIdle` settles (kernel docstring pins this). No reproduction; not a slot. |

## 6. Process record

- Census run against the working tree before anything else; every path named above exists at HEAD.
- Proofs: out-of-tree full copy (`git archive` + symlinked `node_modules`), run 3× each via the
  repo's own runner, transcripts captured above, then `/tmp/r18-audit` (and the gate log) deleted.
  No scratch files remain; no `/tmp` state roots remain (proof state roots were `mkdtemp`'d and
  removed by the proofs themselves).
- No commits, no pushes, no branch changes by this auditor. Zero `src`/`test` edits — findings only.
