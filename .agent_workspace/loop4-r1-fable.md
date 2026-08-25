# Loop 4 · Round 1 — fable architecture audit (`agent/opt-continuous`)

- **Auditor:** claude-fable-5-thinking-xhigh (Round 1 fable slot)
- **Base:** `main` @ `2a921ee` (Loop 2 / PR #6 merged); branch head `265fb41`
- **Method:** evidence-based file reads + greps + one baseline test run and one bench run on this VM. No metrics below are invented; each is either a line citation or a number I measured here.
- **Baseline measured on this VM (Node v22.14.0, pnpm 10.17.1):**
  - `pnpm test`: **1435 tests, 1432 pass, 2 fail, 1 skip**. Both failures are `test/unit/cli/doctor.test.ts` (`doctor reports developer preview…`, `doctor reports the pinned Pi packages…`) — the doctor `node` check reads `process.versions.node` (22.14.0 < engines `>=22.19.0`) and correctly fails closed; the *tests* assume a compliant host. This is an environment-hermeticity defect in the tests, not a branch regression (parent verified green on 22.22.2). See G-3.
  - `node scripts/bench-runtime.mjs`: `{"jsonlAppendMs":68.264,"jsonlReadMs":0.518,"lockSerialMs":190.55,"lockContendedMs":201.402}` (1000 samples). There is **no fsync-append benchmark** today.

## 0. Loop-3 draft claims — verified status on THIS branch

| Claim | Status here | Evidence |
|---|---|---|
| INSPECT_SUMMARY freeze | **Effectively closed** | `test/unit/run/inspection.test.ts:443-466` pins the exact object with `assert.deepEqual` (`type/runId/status/requiredEvidence`, no `id`); `--json` purity pinned at `:416-441`. No further freeze task needed. |
| Feedback append vs rewrite lock | **OPEN** | `src/feedback/store.ts:50-54` (`appendFeedback` → unlocked `appendJsonlLine`), `:68-76` (`writeFeedbackRecords` → unlocked `writeFile`); cascade caller `src/privacy/deletion.ts:424-446` takes no lock. |
| Invocation lock-timeout retry | **OPEN** | `src/cli/main.ts:687` `void appendInvocationRecord(...).catch(() => undefined)` — one attempt, silent drop. `appendInvocationRecord` (`src/telemetry/invocation-log.ts:75-96`) has an in-process queue but no lock-timeout retry. |
| Adaptation-plane transitive import closure | **OPEN** | `test/unit/privacy/plane-boundary.test.ts:91-108` checks only first-hop `from "…"` strings per adaptation file; the eval-routing→assign→model-router chain is hand-special-cased (`:136-156`). A new `adaptation/x.ts → routing/y.ts → telemetry/…` value chain would pass unnoticed. |

## 1. Persist I/O

**1a. `appendJsonlLine` does 2–3 fs ops per append** — `src/persist/jsonl.ts:13-23`: every append runs `mkdir(dirname, {recursive:true})` (a syscall that is a no-op after the first call), then `appendFile`, and on the fsync path *opens a second fd* (`open(path,"a")` + `sync` + `close`) instead of syncing the handle it wrote through. Every event append (`EventStore`, `EpisodeStore`, `EpisodeEventStore`, feedback, invocations) pays this. Fsync fires on terminal run events (`src/run/event-store.ts:8,42`) and terminal episode snapshots (`src/run/episode-store.ts:8,39`). Code-closable, measurable (baseline above; no fsync bench exists yet — must be added first).

**1b. Whole-file reads** — `readJsonlObjects` (`jsonl.ts:29`) and `loadInvocationsFromStateRoot` (`src/routing/cost-calibration.ts:126-146`) read entire files into one string. At current retention (loop-3 probe: 33 files / ~26 KB) this is *not* a live bottleneck. **Deliberately not tasked** this round: a streaming rewrite is speculative and its ≥5% claim would be fabricated at these sizes. Revisit only with retention growth evidence.

**1c. Atomic-write duplication + fixed temp name** — `CheckpointStore.write` (`src/run/checkpoint-store.ts:16-28`) and `writeAtomic` (`src/run/pause-controller.ts:25-44`) are near-duplicate tmp+rename implementations with a **fixed** temp path (`<file>.tmp`). Two concurrent writers to the same checkpoint collide on that path: writer B's `open(tempPath,"w")` truncates the inode writer A is still writing/syncing, so A's rename can publish a file containing B's partial bytes — a *torn final file* despite the "atomic" rename. `resumeFlowchartRun` / `pauseFlowchartRun` / `injectFlowchartRun` on the same run in parallel with a live loop make this reachable from the CLI. Also: the two copies have diverged (pause has an EPERM/EEXIST Windows rename fallback, checkpoint does not), and a crash between tmp-write and rename leaves a stale `.tmp` forever (harmless today only because the name is fixed).

**1d. `EventStore.enqueue` "swallow" is benign** — the loop-4 risk list carries "EventStore queue swallows errors". Verified: `src/run/event-store.ts:47-51` returns the un-swallowed `run` promise to the caller; the `.catch(() => undefined)` only un-poisons the chain. Every production call site awaits (`flowchart-run.ts`, `supervisor.ts`, `child-coordinator.ts:280,298`, `cli/main.ts:1319`). Downgraded to non-issue; no task.

## 2. Cross-module races

**2a. Feedback log: unlocked append vs delete-cascade rewrite (HIGH)** — `appendFeedback` appends with no lock while `cascadeFeedbackTombstones` does read→filter→`writeFeedbackRecords` with no lock (`deletion.ts:424-446`). An auto-adapt append landing between the cascade's read and write is silently clobbered; worse, an append of a record bound to the deleted episode can land *after* the rewrite and resurrect free text whose id was just tombstoned (text hidden by the read-filter but present on disk, contradicting "removed from disk, not just hidden", `deletion.ts:419-423`). The invocation log solved exactly this shape with `invocations.jsonl.lock` (`src/telemetry/invocation-log.ts:9-25`); feedback never got the same treatment.

**2b. Feedback cascade fails OPEN on corrupt log (HIGH, privacy)** — `src/privacy/deletion.ts:428`: `readFeedbackRecordsRaw(stateRoot).catch(() => [])`. A corrupt middle line makes the raw reader throw; the catch converts that to "no records", so `delete --episode` **returns success with zero cascaded tombstones while the episode's feedback text stays on disk**. This is the exact failure mode the invocation rewrite refuses ("refusing to rewrite it for a delete", `deletion.ts:492-503`) — the feedback side contradicts the module's own doc comment.

**2c. Episode close: lock on one side only (MEDIUM)** — CLI `episode close` wraps its read-decide-append in `withExclusiveFileLock(<id>.lock)` (`src/cli/episode.ts:90-137`), but the run-side `settleBoundEpisode` (`src/run/episode-bind.ts:118-210`) does the same read-decide-append (`snapshots.readAll().episodes.at(-1)` → decide → append CLOSED/WAITING) with **no lock**. A live run settling while an operator closes can interleave into two terminal snapshots or a WAITING appended after CLOSED. The delete path also removes `<id>.lock` even while a holder is alive (`deletion.ts:168-177` — disclosed by comment, acceptable).

**2d. Invocation telemetry drop windows (MEDIUM)** — `cli/main.ts:680-688`: single attempt, `.catch(() => undefined)`. When a `delete --run` rewrite holds `invocations.jsonl.lock` past the 5 s default (`file-lock.ts:39`), every live append in that window is dropped with no retry and no disclosure. Additionally the **flowchart branch never wires the hook at all**: `cli/main.ts:631-640` builds its executor with `hooks = undefined`, so `run --flowchart --executor pi` records *zero* invocation rows — cost calibration and `costEligible` accounting are blind to the entire flowchart path. That second defect is a plain wiring hole, not a race.

**2e. Child cancel windows (HIGH, correctness)** — `ChildRunHandle.cancel()` (`src/run/child-coordinator.ts:255-263`) only aborts `attemptControllers.get(childRunId)`, which exists **only during an active attempt** (`:500-501` set, `:560` deleted in `finally`). Cancel while the child is queued behind the `ConcurrencyGate` (`:247`), or between attempts (during TASK_RETRY appends / cascade decisions), is a silent no-op — the child then starts or retries anyway. `flowchart-run.ts` creates a run-level `AbortController` (`:790,891,1044`) whose `.abort()` **no code ever calls** (grep: only supervisor/coordinator legacy paths call their own controllers), so teardown-on-failure never propagates to spawned cluster children either.

## 3. Protocol parse surface

`src/protocol/v1.ts` is a clean hand-rolled validator (trims, enum whitelists, integer checks, `isFinite` on `maxCostUsd`, approval-plan cross-validation, `assertAtMostOneTerminal`). It is example-tested (`test/unit/protocol/v1.test.ts`) but **never fuzzed**; inputs come from child transcripts (attacker-adjacent). Unverified classes: `__proto__`/`constructor` keys through `isRecord`, huge arrays (`inputArtifactIds`, `options`), deep nesting via `approvalPlan`, surrogate-garbage strings in ids, error-class discipline (callers rely on catching `DomainValidationError` — any `TypeError` escaping `messageError` would crash the coordinator's attempt loop at `child-coordinator.ts:638`).

**Blind cast in the episode plane:** `EpisodeEventStore.readAll` (`src/episode/store.ts:37-46`) returns `values as EpisodeEvent[]` — *no validation at all*, unlike `EventStore.readAll` (validates each row) and `EpisodeStore.readAll` (`run/episode-store.ts:57`, validates). `episode events --json` (`cli/episode.ts:53-68`) re-emits those unvalidated rows verbatim, and replay/closure consumers trust the cast.

## 4. Disaster / crash windows

- Torn final line: recovered by `readJsonlObjects` tail logic — pinned by unit tests, but never exercised by a **real kill**; nothing kills a writer mid-append/mid-checkpoint and then asserts recovery end-to-end.
- Checkpoint: rename is atomic for *sequential* single writers; the concurrent-writer torn-tmp hole is 1c. Crash between tmp write and rename leaves `.tmp`; next write silently truncates it (OK today, must stay OK after 1c's fix).
- Lock holder SIGKILLed: lock file persists; waiters time out with `DomainValidationError` and manual cleanup is documented (no PID stealing, `file-lock.ts:29-33`). This posture is deliberate — it should be *probed*, not changed.
- Feedback cascade ordering: text is stripped **before** tombstones are persisted (`deletion.ts:441-444`). A crash in between leaves stripped shells un-tombstoned — the privacy-safe direction (text already gone). Keep the order; do not "fix".
- `LeaseRegistry.expired()` and `.restore()` (`src/run/scheduler.ts:53-71`) have **no production callers** — lease expiry is dead on the live path; real bounding is per-attempt timers. Honest to note; not worth code churn this round.

## 5. Isolation / privacy honesty

- Live-isolation transitive closure (tracking plane) exists; the **adaptation-plane** boundary test is first-hop only (see §0, item 4).
- `SPARKLE_AUTO_ADAPT=0` collect-only: intact. ADR-006 Proposed: intact (no Pi extension import). Nothing here claims Outcome-supported.
- Residual episode text in run events after `delete --episode`: disclosed by design (`deletion.ts:225-244`); no change.
- The one *new* privacy finding this round is 2b (fail-open cascade on corrupt feedback log) — it silently under-deletes.

## 6. CLI contract freeze

- `doctor --json`: frozen contract with tests — intact.
- `inspect --json` / `--summary-json`: NDJSON purity and INSPECT_SUMMARY shape both pinned — intact (§0).
- Doctor tests are host-Node-dependent (see baseline above): `nodeCheck` (`src/cli/doctor.ts:109-118`) has no injection seam, so `pnpm gate` on any 22.14–22.18 host reports false failures — including **this VM**, which will mask real regressions for every implementer this round unless fixed.

## 7. Scheduler / leases

`planRound` / `applyTaskOutcome` / `applyRetry` are pure and well-tested. In-memory `LeaseRegistry` is single-process by design. The genuinely unfulfilled contract is in the *child* limits: **`maxWallTimeMs` is validated everywhere and enforced nowhere** — required by protocol (`v1.ts:73,180-184`), defaulted to 3 600 000 (`cli/main.ts:386`, `flowchart-run.ts:193,233`, `track/loop.ts:115`), and no reader exists (grep). Real bound today = `maxAttempts × timeoutMs` plus unbounded inter-attempt work. A declared limit that does nothing is a contract-honesty defect. `maxCostUsd` on `ChildRunLimits` is likewise unread at the child level (experiments plane enforces its own) — disclose; wall-time is the one worth enforcing now.

## 8. Cluster mailbox

`createMailbox` (`src/cluster/mailbox.ts`) is in-memory, in-process; role-cast mail waits in a role queue until `claimRole`, which re-queues the sender's own mail (`:64-79`) — if the *only* registered agent with a role is the sender, that mail sits forever (starvation by design; no TTL, no dead-letter). No durability: a crash loses undelivered mail. Because the cluster only exists inside one process today (spawned children share the host), durability is an accepted non-goal — **documented, not tasked**. Duplication is impossible (claim moves mail), ordering is preserved per queue.

## 9. pi-adapter abort / teardown

- **Pre-aborted signal is not honored (HIGH):** `runAttempt` registers `signal.addEventListener("abort", …)` (`pi-executor.ts:236-237`); per AbortSignal semantics the listener **never fires for an already-aborted signal**, and neither `execute` (`:299`) nor `runAttempt` checks `signal.aborted` before calling `agent.prompt`. An executor invoked with an aborted signal (parent cancelled while the child was queued) runs the **full provider call** — spend + latency after cancellation. `runWithRetry` only checks after sleeps (`:293`).
- Teardown is otherwise sound: fresh `Agent` per attempt, listener removed in `finally`, `sleepWithAbort` for backoff, buffered events replayed after invocation recording (buffering is a design choice — noted, not tasked).
- Invocation honesty (usage undefined on non-ok, all-zero filter) verified intact.

## Severity ranking (code-closable this round unless noted)

| # | Gap | Sev | Closable | Slot |
|---|---|---|---|---|
| 1 | Feedback cascade fail-open on corrupt log + unlocked append/rewrite (2a/2b) | **P1** | yes | T1 (opus) |
| 2 | `maxWallTimeMs` unenforced + child cancel no-op windows (2e, §7) | **P1** | yes | T6 (opus) |
| 3 | Pre-aborted signal runs full provider call (§9) | **P1** | yes | T5 (opus) |
| 4 | Fixed-tmp concurrent torn write, checkpoint+pause duplication (1c) | **P1** | yes | T3 (opus) |
| 5 | Flowchart path records zero invocations; lock-timeout drop w/o retry (2d) | **P2** | yes | T2 (opus) |
| 6 | Episode settle unlocked vs CLI close; blind `EpisodeEvent` cast (2c, §3) | **P2** | yes | T4 (opus) |
| 7 | Doctor tests host-dependent (2 failures on this VM); adaptation closure first-hop only (§0.4, §6) | **P2** | yes | T9 (gpt-sol) |
| 8 | Per-append `mkdir` + second fd on fsync (1a) | **P3/perf** | yes, bench-gated | T7 (gpt-sol) |
| 9 | Protocol v1 unfuzzed (§3) | **P3** | yes (test-side) | T8 (gpt-sol) |
| 10 | Crash windows reasoned, never kill-tested (§4) | **P3** | yes (probe) | T10 (gpt-sol) |
| — | Mailbox durability; unbounded retention (Q3 accepted); JSONL streaming; lock stealing; buffered executor streaming; run-level abort wiring into flowchart teardown | — | **not this round** (design decisions / no evidence of need / too invasive for concurrent landing) | disclosed |

Standing constraints re-affirmed: adaptive R1/bandit/topology stay OFF the live execution path; nothing becomes Outcome-supported; ADR-006 stays Proposed; P0 privacy sign-off stays human; no auto-promote.
