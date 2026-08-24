# ROUND 1 BRIEF — injection context for Loop 4 · Round 2

Provenance: written by the Round 1 SOTA reviewer (claude-fable-5-thinking-xhigh) after evidence-based review of T1–T10; verdicts and measurements in `.agent_workspace/loop4-r1-review.md`.

## 1. What landed in Round 1 (all committed on `agent/opt-continuous`)

| Slot | Landed | Key symbols (do not re-implement) |
|---|---|---|
| T1 | Feedback log cooperative lock; episode-delete cascade fails **closed** on corrupt log and runs before episode-file unlink | `feedbackLogLockPath`, `withFeedbackLogLock`, locked `appendFeedback`, `cascadeFeedbackTombstones(stateRoot, episodeId, options?)` |
| T2 | Bounded lock-timeout retry sink for invocation telemetry; flowchart branch now records invocations | `createInvocationSink(stateRoot, opts?)` in `telemetry/invocation-log.ts`; both `createExecutor` sites in `runCommand` pass it (source-pinned) |
| T3 | One shared atomic writer, unique temp names (`<file>.<pid>.<random>.tmp`, open `"wx"`), rename fallback unified | `writeFileAtomic(path, contents, options?)` in `persist/atomic-file.ts`; checkpoint-store and pause-controller delegate to it |
| T4 | Episode event reads validated (blind cast gone); run-side settle serialized under the CLI's episode lock | `validateEpisodeEvent` in `episode/events.ts`; `episodeLockPath` in `run/episode-bind.ts`; `settleBoundEpisode` re-reads inside the lock |
| T5 | Executor honors pre-aborted signals: zero provider calls / zero Agent construction after cancellation, in all three windows | `execute` pre-check, per-attempt check in `runWithRetry`, post-registration re-check in `runAttempt` (`pi-adapter/pi-executor.ts`) |
| T6 | Durable per-child cancel (queued + between-attempts windows) and `maxWallTimeMs` actually enforced | `cancelledChildren` set + wall deadline timer in `run/child-coordinator.ts`; outcome `TIMEOUT` with wall summary |
| T7 | jsonl append fast path, bench-gated and reviewer-re-verified: −31.5% plain, −28.6% fsync on this VM | `appendJsonlLine` body only; **signatures frozen and unchanged**; new `jsonlAppendFsyncMs` bench in `scripts/bench-runtime.mjs` |
| T8 | Deterministic seeded protocol fuzzer (seed `0x4f310008`); found+fixed a real `TypeError` escape | `assertAtMostOneTerminal` now validates entries (fail-closed); `test/unit/protocol/fuzz.test.ts` |
| T9 | Doctor hermetic (`nodeVersion` injection seam); adaptation-plane **transitive value-import closure** with 3-edge justified allowlist and a negative fixture | `DoctorOptions` in `cli/doctor.ts`; closure walker in `test/unit/privacy/plane-boundary.test.ts` |
| T10 | Real-SIGKILL crash probe: jsonl tail recovery, checkpoint old-then-next-write, no-steal lock posture | `scripts/crash-probe.mjs` (naming-agnostic), `test/integration/persist/crash-recovery.test.ts` |

## 2. Current baseline (this VM, Node v22.14.0, pnpm 10.17.1)

- **`pnpm gate` is fully GREEN**: 1508 tests / 1507 pass / 0 fail / 1 skip. The old "2 known doctor failures" allowance is **retired** — do not cite it, and do not leave the gate red.
  - Pending at review time: one uncommitted one-line lint fix in `test/unit/cli/doctor.test.ts` (reviewer-applied; parent to commit). If you see it committed, the tree is clean.
- Bench (post-T7): `{"jsonlAppendMs":45.58,"jsonlAppendFsyncMs":198.806,"jsonlReadMs":0.484,"lockSerialMs":189.745,"lockContendedMs":199.955}` (1000 samples). Any perf slot records its **own** same-VM baseline before optimizing; ≥5% or rollback.
- `node scripts/crash-probe.mjs` → `ok: true`.

## 3. Forbidden / frozen for Round 2

Global forbidden list, unchanged: live R1/bandit/topology on the execution path; Outcome-supported claims; ADR-006 Accepted (stays Proposed); auto-promote; P0 privacy sign-off stays human; `package.json`/dependency edits; git history rewrites; subagents do not commit.

Frozen contracts (new this round — breaking these reverses landed work):
- `appendJsonlLine(filePath, line, fsync)` / `readJsonlObjects(filePath, corrupt)` signatures.
- `writeFileAtomic(path, contents, options?)` public contract; no private tmp+rename copies may reappear.
- The lock-path symmetry `episodeLockPath` ⇔ `src/cli/episode.ts` (source-pinned from both sides).
- The `runCommand` invocation-sink wiring (source-pinned; reverting a hooks argument to `undefined` goes red).
- Feedback-log writers must go through `appendFeedback` / `withFeedbackLogLock`; invocation-log writers through the sink or `appendInvocationRecord`.
- `withExclusiveFileLock` was untouchable in Round 1. Round 2 **deliberately unfreezes it for exactly one slot** (R2-2 below); every other slot keeps hands off.

Process requirement for every Round 2 slot (lesson from two integration breaks this round): run scoped `eslint` on owned files **and a whole-tree `tsc --noEmit`** before reporting; the full suite/gate stays the parent's job.

## 4. Ranked Round 2 candidates (mutually exclusive ownership)

Saturation note: `persist/jsonl` and `protocol/v1` are saturated (<2% further gain without new evidence). Per the standing rule, this round tilts to I/O, races, protocol honesty, and disaster recovery.

### R2-1 (P1, races/teardown) — Flowchart run-level abort is never fired
**Evidence:** `flowchart-run.ts:790,891,1044` construct `new AbortController()`; `rg '\.abort\(' src/run/flowchart-run.ts` returns **nothing**. Teardown-on-failure never propagates to spawned children, even though T5/T6 just made cancellation effective in every window. A failed/paused flowchart run leaves live children spending money.
**Change:** wire the run-level controller: abort it on run failure, pause, and terminal teardown; propagate to child handles (`ChildRunHandle.cancel()`) / executor signals. No protocol shape changes.
**Ownership:** `src/run/flowchart-run.ts`, `test/integration/m2.5/flowchart-run.test.ts`, `test/integration/m2.5/children-flowchart.test.ts`, new unit test file.

### R2-2 (P1/P2, I/O + protocol) — Typed lock-timeout error + lock perf (sanctioned `file-lock.ts` unfreeze)
**Evidence:** T2's `isLockTimeout` string-matches `withExclusiveFileLock`'s message (`invocation-log.ts`), disclosed as a brittle coupling; lock bench sits at ~190/200 ms per 1000 acquisitions (serial/contended).
**Change:** add a typed discriminator (e.g. `code: "LOCK_TIMEOUT"` field on the thrown `DomainValidationError` — message unchanged, signature unchanged); migrate `isLockTimeout` to it. Then, bench-gated ≥5% on `lockSerialMs`/`lockContendedMs` vs own same-VM baseline, optimize acquisition (fewer fs ops per acquire/release, tuned retry cadence); rollback the perf half if <5%, keep the typed error either way.
**Ownership:** `src/persist/file-lock.ts`, `src/telemetry/invocation-log.ts` (classifier only), `test/unit/persist/file-lock.test.ts`, `test/unit/telemetry/invocation-log.test.ts`, `scripts/bench-runtime.mjs`.

### R2-3 (P2, privacy/races) — `delete --episode` removes a live lock
**Evidence:** `deletion.ts:168-177` unlinks `runtime/episodes/<id>.lock` even while a holder is alive (disclosed by comment). Both writers now serialize on that lock (T4), so deleting it mid-hold reopens the exact race T4 closed.
**Change:** `deleteEpisodeRecords` acquires the episode lock (bounded timeout, fail closed with the standard `DomainValidationError`) before unlinking the episode files; idempotency and `DeletionResult` shape unchanged.
**Ownership:** `src/privacy/deletion.ts`, `test/unit/privacy/deletion.test.ts` (import `episodeLockPath` from T4's module — imports allowed, edits not).

### R2-4 (P2, telemetry honesty) — Feedback append drop-window parity
**Evidence:** T1 residual: `appendFeedback` rejects on 5 s lock timeout and `src/learning/auto-loop.ts:251` awaits it — a long cascade surfaces as a failed auto-adapt persist. Same drop-window class T2 fixed for invocations.
**Change:** bounded lock-timeout retry + honest disclosure for the auto-adapt persist path (mirror `createInvocationSink` semantics; decide and document whether a terminal drop fails the loop iteration or warns). Signatures additive only.
**Ownership:** `src/learning/auto-loop.ts`, `src/feedback/store.ts` (additive), `test/unit/learning/**`, `test/unit/feedback/store.test.ts`.

### R2-5 (P2, protocol contract honesty) — `maxCostUsd` unread + coordinator O(n²) validation
**Evidence:** `ChildRunLimits.maxCostUsd` is validated (`protocol/v1.ts`) and read by no child-level enforcement (fable §7; T6 enforced wall time only). Separately, T8's fix makes `child-coordinator.ts:721` re-validate the whole message prefix per incoming message — O(n²) per transcript.
**Change:** (a) either enforce a cumulative child cost ceiling (only if usage/cost is cheaply derivable at the coordinator — do not build a calibration pipeline for it) or document non-enforcement explicitly in `protocol/v1.ts` doc comments and the task-input doc; a declared limit must either work or say it doesn't. (b) validate only the incoming message and track a terminal-seen flag; keep the fuzz invariant green.
**Ownership:** `src/run/child-coordinator.ts`, `src/protocol/v1.ts` (docs/fix-only), their unit tests.

### R2-6 (P2, disaster recovery) — Crash-probe extension over Round 1's new writers
**Evidence:** T10 probes jsonl/checkpoint/lock, but the round added three new crash-sensitive protocols it does not cover: the locked feedback cascade (strip-before-tombstone ordering), settle-under-episode-lock, and `writeFileAtomic` unique temps.
**Change:** new probe cases: kill mid-cascade → either the old file or the stripped file, never tombstone-before-strip; kill a settle/close lock holder → waiter fails closed, manual cleanup recovers, no second terminal snapshot afterwards; kill inside `writeFileAtomic` → destination is old-or-new, stale unique temp inert for the next writer. Public-API invariants only.
**Ownership:** `scripts/crash-probe.mjs`, `test/integration/persist/crash-recovery.test.ts`.

### R2-7 (P2/P3, protocol fuzz expansion) — Persistence-row fuzz
**Evidence:** T8's harness covers `protocol/v1` only. The round added `validateEpisodeEvent` (new, unfuzzed) and there are other attacker-adjacent/corruption-adjacent row decoders: feedback row loading, invocation record validation, `parsePauseToken`, checkpoint parse.
**Change:** reuse the seeded xorshift pattern (in-test, no dependencies) with the same invariant: idempotent accept or exactly `DomainValidationError` (or the module's documented fail-closed class), never a `TypeError`/hang. Fix-only touches if defects surface, each with a named regression.
**Ownership:** new `test/unit/persist/row-fuzz.test.ts` (or split per module under existing test dirs); fix-only rights in `src/episode/events.ts`, `src/feedback/store.ts`, `src/telemetry/invocation-log.ts`, `src/run/pause-controller.ts` — coordinate with parent if a fix collides with another slot.

### R2-8 (P3, protocol/races) — Mailbox starvation honesty
**Evidence:** fable §8: role-cast mail re-queued by `claimRole` (`cluster/mailbox.ts:64-79`) sits forever when the only role-holder is the sender; no TTL, no dead-letter, silent.
**Change:** smallest honest fix — a bounded requeue count or age surface (observable via the existing mailbox API) and a documented starvation disclosure; do not build durability (accepted non-goal).
**Ownership:** `src/cluster/mailbox.ts`, `test/unit/cluster/**`.

### R2-9 (P3, honesty/dead code) — Scheduler lease dead code
**Evidence:** `LeaseRegistry.expired()` / `.restore()` (`run/scheduler.ts:53-71`) have no production callers; lease expiry is dead on the live path (fable §4).
**Change:** remove (or wire, if a live caller is justified by R2-1's teardown work) — either way the contract stops implying an enforcement that does not exist. Pin with tests.
**Ownership:** `src/run/scheduler.ts`, `test/unit/run/scheduler.test.ts`.

### R2-10 (P3, docs) — Data-dictionary and docs accuracy pass
**Evidence:** `docs/data-dictionary.md:181` still says `pause.json.tmp`; temps are now `pause.json.<pid>.<random>.tmp` (checkpoint likewise); the round also added two lock files (`records.jsonl.lock`, settle-side use of `episodes/<id>.lock`) and made `maxWallTimeMs` real.
**Change:** doc-only truth-up of the transient-file naming, lock inventory, and enforced-limits list. No behavior.
**Ownership:** `docs/data-dictionary.md`, other `docs/*.md` as strictly needed.

## 5. Explicitly NOT for Round 2 (unchanged design decisions)

JSONL streaming reads (no retention-growth evidence; a ≥5% claim would be fabricated at ~26 KB); mailbox durability; lock stealing (no-steal posture is deliberate and now crash-probed); buffered executor streaming (invasive; revisit with evidence); unbounded retention (Q3 accepted).
