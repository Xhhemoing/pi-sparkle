# ROUND 2 BRIEF — injection context for Loop 4 · Round 3

Provenance: written by the Round 2 SOTA reviewer (claude-fable-5-thinking-xhigh) after evidence-based review of R2-1…R2-10; verdicts and measurements in `.agent_workspace/loop4-r2-review.md` (8 ACCEPT, 2 ACCEPT-WITH-NITS, 0 ROLLBACK).

## 1. What landed in Round 2 (all committed on `agent/opt-continuous`, `70f0942`…`749fbe9`)

| Slot | Landed | Key symbols (do not re-implement) |
|---|---|---|
| R2-1 | Flowchart run-level abort actually fires: teardown on failure/pause/terminal/escaping error; spawned peers tracked and cancelled; refuse post-abort spawns | `RunAbortScope` (module-private), `cancelAndSettle()`, `withRunTeardown`, `resumeRestoredRun` in `run/flowchart-run.ts`; signal now reaches `executeFlowchartNode` |
| R2-2 | Typed lock-timeout discriminator + measured lock perf (reviewer-confirmed −14.4% serial / −12.0% contended vs Round 1 baseline) | `FileLockTimeoutError` (extends `DomainValidationError`), `LOCK_TIMEOUT_CODE = "LOCK_TIMEOUT"` in `persist/file-lock.ts`; message unchanged; sink's `isLockTimeout` is code-based |
| R2-3 | `delete --episode` unlinks only inside the episode's cooperative lock; fail-closed on timeout; stale lock ⇒ delete fails (no-steal); lock no longer in `removedPaths` | `deleteEpisodeRecords(stateRoot, episodeId, options?)`, private `unlinkEpisodeFiles`; imports `episodeLockPath` (pinned) |
| R2-4 | Feedback persist drop-window parity: bounded lock-timeout retry, honest drop, warn-don't-fail for auto-adapt; every other failure still rejects | `appendFeedback(…, options?)`, `appendFeedbackWithRetry` → `FeedbackAppendOutcome` in `feedback/store.ts`; `AutoAdaptResult.feedbackPersisted/feedbackDropped/feedbackDropReasons`; `discloseDrops` on all return sites |
| R2-5 | `maxCostUsd` non-enforcement disclosed at both reader surfaces + pinned ("inert" behavioral test, source pin on no `limits.maxCostUsd` read); O(n²) → O(n) terminal check | `AttemptTranscript` in `run/child-coordinator.ts` (per-attempt `sawTerminal`); duplicate-terminal wording parity test-enforced with `assertAtMostOneTerminal` (unmodified) |
| R2-6 | Crash probe now 6 cases: cascade strip-before-tombstone (FIFO-pinned kill window), episode-settle stale-lock recovery (waiter fails closed, manual cleanup, one terminal), atomic-write old-or-new + inert stale temp | `scripts/crash-probe.mjs`; uses only pre-existing public seams (`AtomicWriteOptions.rename/uniqueSuffix`) |
| R2-7 | Deterministic persistence-row fuzzer (seed `0x4f320007`): episode events, pause token, checkpoint, feedback rows, invocation records. Found the invocation TypeError (R3-1) and skip-named it rather than fixing across ownership | `test/unit/persist/row-fuzz.test.ts`, `skipUnowned` pattern |
| R2-8 | Sender-only role-cast starvation bounded: requeue tally → observable dead letters; no TTL and no durability, both disclosed and pinned | `deadLetters(role?)`, `requeueCount(mailId)`, `MailboxOptions`, `DEFAULT_MAX_ROLE_REQUEUES = 3`, `ClusterDeadLetter` in `cluster/mailbox.ts` |
| R2-9 | Dead lease expiry removed (`expired()`/`isExpired()`); **`restore()` kept — it is live on resume** (`supervisor.ts:210`); contract now states leases never expire; mutation-checked source pins on the supervisor recovery loop | `LeaseRegistry` honesty doc; test pin forbids `.expired(`/`.isExpired(` reappearing in `supervisor.ts` |
| R2-10 | Docs truth-up: unique temp names, six-entry lock inventory (with no-steal/manual-cleanup), enforced-vs-validated child limits | `docs/data-dictionary.md`, `docs/specs/m0-m2-architecture.md` |

## 2. Current baseline (this VM, Node v22.14.0, pnpm 10.17.1)

- **`pnpm gate` GREEN, exit 0**: 1550 tests / 1548 pass / 0 fail / **2 skipped**. Skip #2 is R2-7's named skip on the invocation-row TypeError — it becomes the regression test when R3-1 lands; do not "fix" the skip any other way.
- Bench: `{"jsonlAppendMs":44.927,"jsonlAppendFsyncMs":222.654,"jsonlReadMs":0.485,"lockSerialMs":162.402,"lockContendedMs":176.052}` (1000 samples). The fsync number moved (198.8→222.7) with `persist/jsonl` untouched — fsync variance is real on this VM; any perf slot records its **own** same-VM before/after; ≥5% or rollback.
- `node scripts/crash-probe.mjs` → `ok: true`, 6 cases × 3 iterations.

## 3. Forbidden / frozen for Round 3

Global forbidden list, unchanged: live R1/bandit/topology on the execution path; Outcome-supported claims; ADR-006 stays Proposed; auto-promote; P0 privacy sign-off stays human; `package.json`/dependency edits; git history rewrites; subagents do not commit.

Frozen contracts (Round 1 set plus new):
- `appendJsonlLine(filePath, line, fsync)` / `readJsonlObjects(filePath, corrupt)`; `writeFileAtomic(path, contents, options?)`; `episodeLockPath` ⇔ `cli/episode.ts` symmetry; `runCommand` invocation-sink wiring (all pinned, all held through Round 2).
- `withExclusiveFileLock` is **re-frozen** (R2-2's one-slot unfreeze is over). Its message and `FileLockTimeoutError`/`LOCK_TIMEOUT_CODE` are now public contract: new lock-timeout handling must use the code, never string-match. Lock acquisition perf is saturated — do not chase more.
- `deleteEpisodeRecords(stateRoot, episodeId, options?)` semantics (fail-closed stale lock, lock not in `removedPaths`, no-op posture); `appendFeedbackWithRetry`/`FeedbackAppendOutcome`; the `AutoAdaptResult` disclosure fields; `deadLetters`/`requeueCount` surface; `AttemptTranscript` invariant + duplicate-terminal wording parity; R2-5's source pin — wiring a `limits.maxCostUsd` read requires rewriting the disclosure docs in the same change or the pin goes red.
- Feedback writers go through `appendFeedback`/`appendFeedbackWithRetry`/`withFeedbackLogLock`; invocation writers through the sink or `appendInvocationRecord`.

Process requirements per slot (carried forward — they worked): scoped `eslint` on owned files + whole-tree `tsc --noEmit` before reporting; attribute shared-tree transients to files, never edit unowned files to "fix" them; unowned defects get R2-7's **named-skip + report** treatment; timing-sensitive owned tests run 3×; full gate is the parent's job.

## 4. Ranked Round 3 candidates (mutually exclusive ownership)

Saturation note: `persist/jsonl`, `protocol/v1` parse, `file-lock` acquisition perf, and mailbox starvation semantics are saturated. This round tilts to deep I/O crash-atomicity, cross-process races, decoder fail-closed discipline, disaster recovery, and no-steal lock operability.

### R3-1 (P1, protocol/fail-closed) — Invocation-row decoders must fail closed, not TypeError
**Evidence (reviewer-reproduced at HEAD):** `invocationError` (`telemetry/model-invocation.ts:85-86,128`) dereferences `config` and `pricing` unguarded: `config: null`, `config` missing, and `pricing: null` all escape as `TypeError` from `validateInvocation` **and from `isInvocation`** (a type predicate that throws). `loadInvocationsFromStateRoot` (`routing/cost-calibration.ts:143`) — documented "invalid rows are skipped" — calls `isInvocation` uncaught and feeds `createCalibratedCliModelRouter`, i.e. one bad row in `runtime/invocations.jsonl` crashes `pi run`/`resume` startup. R2-7's fuzzer found it (seed `0x4f320007`, iteration 11) and left a named skip.
**Change:** null/shape-guard `config` and `pricing` in `invocationError` (return a message, as for every other field); `isInvocation` must never throw. Un-skip the fuzz case; add a `loadInvocationsFromStateRoot` skips-bad-rows contract test.
**Ownership:** `src/telemetry/model-invocation.ts`, `test/unit/persist/row-fuzz.test.ts` (un-skip only), `test/unit/telemetry/model-invocation.test.ts`, routing cost-calibration test file.

### R3-2 (P1/P2, I/O disaster recovery) — Privacy rewrites are not crash-atomic
**Evidence:** `writeFeedbackRecords` (`feedback/store.ts:275-282`) and `writeInvocationRecords` (`telemetry/invocation-log.ts:253-261`) are plain truncate-then-write `writeFile` — concurrency-safe under their locks but a SIGKILL mid-rewrite loses **unrelated** rows and can tear a line (which then fails every subsequent locked read closed). R2-6's probe deliberately could not reach this window (no seam inside `writeFile`). `writeFileAtomic` exists and rename-over does not disturb the separate lock file.
**Change:** route both rewrites through `writeFileAtomic` (same bytes, same locks); extend the crash probe with kill-inside-rewrite cases via the atomic writer's `rename` seam. Also migrate `store.ts`'s `isLockTimeout` to `LOCK_TIMEOUT_CODE` (the disclosed R2-2/R2-4 joint residual) since this slot owns the file.
**Ownership:** `src/feedback/store.ts`, `src/telemetry/invocation-log.ts`, `scripts/crash-probe.mjs`, `test/integration/persist/crash-recovery.test.ts`, `test/unit/feedback/store.test.ts`, `test/unit/telemetry/invocation-log.test.ts`.

### R3-3 (P2, privacy/races) — `delete --run` resurrection race
**Evidence:** `deleteRunRecords` (`privacy/deletion.ts`) `rm -rf`s `runtime/runs/<id>/` with no coordination; `EventStore.append` holds no cross-process lock and `appendJsonlLine`'s ENOENT→`mkdir`→retry (`persist/jsonl.ts:33-34`) **recreates the deleted directory** — a live run writing events resurrects partial run records after a "successful" delete. The exact class R2-3 closed for episodes, on the run plane.
**Change:** smallest honest fix — the slot decides between a run-scoped delete lock (only if a writer-side acquisition point exists without invasive churn), a terminal-event precondition with explicit override semantics, or fail-closed detection (post-delete re-check; a resurrected directory fails the delete loudly). A silent success that isn't one is the only forbidden outcome. Coordinate with the parent if the chosen fix needs `event-store.ts` (R3-4's file).
**Ownership:** `src/privacy/deletion.ts`, `test/unit/privacy/deletion.test.ts`, `test/integration/cli/delete.test.ts`.

### R3-4 (P2, protocol/disaster recovery) — Run event log decoder discipline + fuzz
**Evidence:** `EventStore.readAll` (`run/event-store.ts`) throws a **bare `Error`** for a corrupt middle line — the pre-T4 posture the episode store was already upgraded from; `validateEvent` (`run/events.ts`) and `replayRun` decode the source-of-truth log and are unfuzzed (R2-7 covered episode/pause/checkpoint/feedback/invocation rows only).
**Change:** upgrade the corrupt-line error to `DomainValidationError`; extend the seeded-fuzz pattern over `validateEvent` (per event type) and corrupted-row `readAll`; invariant: accept idempotently or throw exactly `DomainValidationError`, never TypeError/hang. Fix-only rights in the two owned src files, named regressions per defect.
**Ownership:** `src/run/events.ts`, `src/run/event-store.ts`, new `test/unit/run/event-row-fuzz.test.ts`, `test/unit/run/events.test.ts`.

### R3-5 (P2, disaster-recovery honesty) — Terminal events on escaping errors
**Evidence (R2-1 disclosure, verified):** a flowchart run that dies by an error escaping `withRunTeardown` cancels its children but writes **no `RUN_FAILED`** — replay sees a run that just stops; a child whose `runTask` throws writes no terminal child event either (`run/child-coordinator.ts`).
**Change:** best-effort terminal append in the teardown path (append failure must not mask the original error — rethrow it regardless), and the child-side equivalent; pin replay/resume behavior for a run that crashed this way. No new event types; reuse `RUN_FAILED` with an honest reason.
**Ownership:** `src/run/flowchart-run.ts`, `src/run/child-coordinator.ts`, `test/unit/run/flowchart-run-abort.test.ts`, `test/integration/m2.5/children-flowchart.test.ts`.

### R3-6 (P2, no-steal lock operability / partition posture) — Stale-lock diagnosability
**Evidence:** every lock file carries `{ownerToken, pid, acquiredAt}` (`file-lock.ts:79-82`) and **nothing reads it**; after a crash the operator's manual-cleanup decision (the documented no-steal recovery, now load-bearing for `delete --episode` and settle) is blind. Also, a kill between `open("wx")` and the metadata write leaves an empty lock file with zero diagnostics.
**Change:** read-only `doctor` surface: inventory `*.lock` files under the state root, report age, recorded pid, and pid-liveness **as advisory only** (PID reuse disclaimer, per the file-lock doc), and the empty-metadata case; never steal, never delete. `--json` additive.
**Ownership:** `src/cli/doctor.ts`, `test/unit/cli/doctor.test.ts`. Do not touch `file-lock.ts` (re-frozen); parse lock-file JSON locally.

### R3-7 (P3, races/observability) — Dead letters reach an operator
**Evidence:** R2-8 residual: `deadLetters()` has no production reader; a starved role-cast is observable only to tests. `ClusterHost` (`cluster/host.ts`) is the sole `claimRole` caller and already exposes `mailbox()`.
**Change:** smallest wiring — surface dead-letter counts/reasons through the host's existing reporting path (or run summary if the host has none), with a test that a sender-only starvation becomes operator-visible. No TTL, no durability (accepted non-goals).
**Ownership:** `src/cluster/host.ts`, `test/unit/cluster/` (new file or `host.test.ts`; `mailbox.ts` itself is settled).

### R3-8 (P3, honesty/dead code) — Scheduler and supervisor leftovers
**Evidence (R2-9 disclosures, verified):** `applySkipped` (`run/scheduler.ts:151`) has no production caller; `planRound`'s `_leaseDurationMs` is unread but kept for call-site symmetry (`supervisor.ts:275` + integration test are the blockers R2-9 didn't own); `supervisor.ts:253` comment still says "orphaned **or expired** leases".
**Change:** remove or wire `applySkipped` (census first, R2-9-style — do not trust this brief); drop the dead parameter across its call sites; fix the stale comment. Keep R2-9's pins green.
**Ownership:** `src/run/scheduler.ts`, `src/run/supervisor.ts`, `test/unit/run/scheduler.test.ts`, `test/integration/m2/scheduler.test.ts`.

### R3-9 (P2, telemetry honesty) — Resume path records zero invocations
**Evidence:** `resumeCommand` calls `createExecutor` **without hooks** at `cli/main.ts:1130` (supervised) and `:1167` (flowchart `--executor`) — the sink exists only inside `runCommand` (line 627), so resumed runs spend money with no invocation rows: routing calibration and run-to-run comparison silently under-count. Same class T2 closed for `runCommand`'s flowchart branch.
**Change:** construct/share the sink in `resumeCommand` and pass `onInvocation` at both sites; extend the source-pin idea in a **new** test file (the existing pin file belongs to R3-2 this round).
**Ownership:** `src/cli/main.ts` (the two call sites + sink construction only), new `test/unit/cli/invocation-sink-wiring.test.ts`.

### R3-10 (P3, docs) — Docs/comment accuracy pass
**Evidence:** `docs/specs/m0-m2-architecture.md:347` claims the checkpoint contains "active leases" (verified false — leases rebuild from `TASK_LEASED` events; the checkpoint schema has no lease field); `docs/data-dictionary.md` "the episode `.lock` previously survived deletion" and `src/privacy/record-classes.ts:86-89` "all removed by delete --episode: … `<id>.lock`" both describe the pre-R2-3 hand-unlink.
**Change:** doc-only truth-up (comment-only in `record-classes.ts` — no behavior, no schema). Sync with R3-3's outcome if it changes `delete --run` wording.
**Ownership:** `docs/**`, `src/privacy/record-classes.ts` (comments only).

## 5. Explicitly NOT for Round 3 (unchanged or newly settled)

Live R1/bandit/topology (standing); jsonl streaming reads (no retention-growth evidence); mailbox durability and wall-clock TTL (R2-8 disclosed residual — a sweep trigger is a design decision, not a smallest fix); lock stealing in any form (no-steal is deliberate, crash-probed, and now the documented recovery for delete/settle — R3-6 makes it operable, never automatic); further lock or jsonl perf (saturated at this VM's noise floor); building a model price catalog just to enforce `maxCostUsd` (R2-5's disclosure stands until someone owns a real pricing source); `deadLetters()` drain/ack API (add only when a consumer exists beyond R3-7's reporting).
