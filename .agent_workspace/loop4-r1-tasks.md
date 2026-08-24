# Loop 4 · Round 1 — task topology (10 concurrent slots)

Source audit: `.agent_workspace/loop4-r1-fable.md`. Ownership lists are **binding and pairwise disjoint**; if a path is not in your list, do not touch it. `src/cli/main.ts` is owned by T2 only, and only inside the named function stated there. Subagents do not git commit. Every task inherits the global forbidden list (repeated per task).

**Shared API freeze for this round (all slots):** `appendJsonlLine(filePath, line, fsync)` and `readJsonlObjects(filePath, corrupt)` signatures must not change (T7 owns the file but keeps the exports stable); `withExclusiveFileLock(lockPath, operation, options)` is untouched by everyone.

**Environment note for all implementers:** this VM runs Node 22.14.0; until T9 lands, `pnpm test` shows 2 pre-existing failures in `test/unit/cli/doctor.test.ts` (host-Node-dependent, documented in the audit). Do not "fix" them from any slot other than T9; treat them as the known baseline.

---

## T1 — Feedback log cooperative lock + fail-closed delete cascade

- **model:** `claude-opus-5-thinking-high-fast`
- **ownership (exclusive):**
  - `src/feedback/store.ts`
  - `src/privacy/deletion.ts`
  - `test/unit/feedback/store.test.ts`
  - `test/unit/privacy/deletion.test.ts`
- **problem (evidence):** `appendFeedback` (`store.ts:50-54`) appends `records.jsonl` unlocked; `writeFeedbackRecords` (`store.ts:68-76`) rewrites it unlocked; the episode cascade (`deletion.ts:424-446`) does read→filter→write with no lock, so a live auto-adapt append interleaving with the rewrite is clobbered — or lands after it and resurrects tombstoned free text on disk. Worse, `deletion.ts:428` `readFeedbackRecordsRaw(...).catch(() => [])` turns a corrupt feedback log into "no records": `delete --episode` then reports **success with zero cascade while the episode's feedback text stays on disk** (fail-open privacy defect).
- **change:** mirror the invocation-log pattern (`src/telemetry/invocation-log.ts`) inside `src/feedback/store.ts`: a `feedbackLogLockPath(stateRoot)` (`records.jsonl.lock`), a `withFeedbackLogLock` helper, an in-process per-path append queue, and `appendFeedback` appending under the lock. The cascade in `deletion.ts` performs read+filter+rewrite+tombstone-write inside that same lock and **stops swallowing read errors**: a corrupt line fails the episode delete closed with a `DomainValidationError` naming the line and the refusal (ENOENT stays a no-op). Keep the existing strip-before-tombstone ordering (crash-safe direction; see audit §4). No renames, no format churn.
- **tests (must land):** (1) append racing a slow cascade (hold the lock, fire an append, release) → the appended row survives whole, never clobbered; (2) cascade attempted while an external holder owns the lock → times out with `DomainValidationError`, records file byte-identical; (3) corrupt middle line → `deleteEpisodeRecords` rejects, no partial rewrite, no tombstone written; (4) idempotent re-delete still passes; (5) existing readFeedback/tombstone contracts unchanged.
- **metric:** correctness/fail-closed; no perf claim.
- **acceptance:** `pnpm gate` green (modulo the two documented doctor baseline failures); every new behavior pinned by a test; `readFeedback`/`appendFeedback`/`writeFeedbackRecords` signatures unchanged (rewrite may gain a required "caller holds lock" doc like `writeInvocationRecords`).
- **forbidden:** live R1/bandit/topology, Outcome-supported claims, ADR-006 Accepted, auto-promote, package.json dependency bumps, rewriting git history.

## T2 — Invocation telemetry: bounded lock-timeout retry + flowchart hook wiring

- **model:** `claude-opus-5-thinking-high-fast`
- **ownership (exclusive):**
  - `src/telemetry/invocation-log.ts`
  - `src/cli/main.ts` — **only** inside `runCommand`: the two `createExecutor(...)` call sites (flowchart branch ~`:631-640`, children/track branch ~`:676-692`) and their `hooks` argument. No other function in `main.ts`.
  - `test/unit/telemetry/invocation-log.test.ts`
- **problem (evidence):** `main.ts:687` fires one `appendInvocationRecord` and swallows every error — while a `delete --run` rewrite holds `invocations.jsonl.lock` past the 5 s default, all live telemetry in that window is silently dropped (known risk: "lock timeout drops telemetry with no bounded retry"). Separately, the flowchart branch (`main.ts:631-640`) passes `hooks = undefined`, so `run --flowchart --executor pi` persists **zero** invocation rows — cost calibration and `costEligible` are blind to the whole flowchart path.
- **change:** in `invocation-log.ts`, add a small exported sink factory (e.g. `createInvocationSink(stateRoot, opts?: { onDrop?(reason: string): void })`) that wraps `appendInvocationRecord` with a bounded retry **on lock-timeout only** (e.g. 3 total tries, short backoff; validation failures never retried), resolves without throwing, and reports the terminal drop through `onDrop`. Both `createExecutor` call sites in `runCommand` pass the same sink (`onDrop` → one `io.stderr` warning line). Keep readers lock-free.
- **tests (must land):** (1) lock held past the first timeout then released → the row lands via retry; (2) lock held past all retries → resolves, `onDrop` fired exactly once, log unchanged; (3) invalid record → rejected immediately, zero retries; (4) in-process ordering preserved under the queue with retries in play; (5) a source-pin test (same style as `plane-boundary.test.ts`) asserting **both** `createExecutor` call sites in `runCommand` pass an invocation hook, so the flowchart wiring cannot silently regress.
- **metric:** correctness/fail-closed; no perf claim.
- **acceptance:** `pnpm gate` green; live path never throws out of the sink; `appendInvocationRecord` signature unchanged; flowchart branch demonstrably wired.
- **forbidden:** live R1/bandit/topology, Outcome-supported claims, ADR-006 Accepted, auto-promote, package.json dependency bumps, rewriting git history.

## T3 — Atomic single-file writes: unique temp names, one shared helper

- **model:** `claude-opus-5-thinking-high-fast`
- **ownership (exclusive):**
  - `src/persist/atomic-file.ts` (new)
  - `src/run/checkpoint-store.ts`
  - `src/run/pause-controller.ts`
  - `test/unit/persist/atomic-file.test.ts` (new)
  - `test/unit/run/checkpoint-store.test.ts`
  - `test/unit/run/pause-controller.test.ts`
- **problem (evidence):** `CheckpointStore.write` (`checkpoint-store.ts:16-28`) and `writeAtomic` (`pause-controller.ts:25-44`) are diverged duplicates using a **fixed** `<file>.tmp`: two concurrent writers collide — the second `open(tmp,"w")` truncates the inode the first is still writing, so the first writer's `rename` can publish a torn file (reachable via `resume`/`pause`/`inject` racing a live loop). Checkpoint's copy also lacks pause's EPERM/EEXIST rename fallback; a crash between tmp-write and rename strands a stale `.tmp`.
- **change:** one `writeFileAtomic(path, contents)` in `src/persist/atomic-file.ts`: unique temp name (`<file>.<pid>.<random>.tmp`), write+fsync+close, rename with the EPERM/EEXIST/EACCES unlink-retry fallback, and best-effort cleanup of its own temp on failure. `CheckpointStore.write` and the pause controller both call it (behavioral drop-in: same final bytes, trailing newline preserved). Stale temps from crashed writers must not break subsequent writes or reads.
- **tests (must land):** (1) N concurrent writes to one path → final file is exactly one writer's **complete** payload, parses as JSON, and no torn hybrid is ever observable; (2) a pre-planted stale `.tmp` (both old fixed-name style and new-style) neither corrupts nor blocks the next write; (3) rename-fallback path exercised (simulate EEXIST via injected rename or pre-created destination semantics where portable); (4) existing checkpoint/pause contracts (read old-or-new, ENOENT → undefined / `{paused:false}`, malformed → fail closed) still pinned.
- **metric:** correctness/fail-closed; no perf claim.
- **acceptance:** `pnpm gate` green; checkpoint-store and pause-controller contain no private tmp+rename copies; concurrent-writer test is deterministic (no sleeps-as-synchronization).
- **forbidden:** live R1/bandit/topology, Outcome-supported claims, ADR-006 Accepted, auto-promote, package.json dependency bumps, rewriting git history.

## T4 — Episode plane: validated event reads + settle under the episode lock

- **model:** `claude-opus-5-thinking-high-fast`
- **ownership (exclusive):**
  - `src/episode/store.ts`
  - `src/episode/events.ts`
  - `src/run/episode-bind.ts`
  - `src/run/episode-store.ts`
  - `test/unit/episode/**` (existing + new files under this directory)
  - `test/unit/run/episode-bind.test.ts`
  - `test/unit/run/episode-store.test.ts`
- **problem (evidence):** `EpisodeEventStore.readAll` (`episode/store.ts:37-46`) returns `values as EpisodeEvent[]` — a blind cast, unlike `EventStore.readAll` (validates every row) and `EpisodeStore.readAll` (`run/episode-store.ts:57`). `episode events --json` re-emits unvalidated rows verbatim. Separately, `settleBoundEpisode` (`run/episode-bind.ts:118-210`) does read-latest→decide→append with **no** `<id>.lock`, while CLI `episode close` holds it (`cli/episode.ts:90-137`): a run settling while an operator closes can append a second terminal snapshot or WAITING-after-CLOSED.
- **change:** add `validateEpisodeEvent(value): EpisodeEvent` to `src/episode/events.ts` (fail closed on unknown `type` or malformed required fields; keep the four known shapes exact); `EpisodeEventStore.readAll` validates each row through it. Wrap `settleBoundEpisode`'s read-decide-append in `withExclusiveFileLock` on the **same** lock path the CLI uses (`runtime/episodes/<id>.lock`), re-reading `latest` inside the lock before deciding. `bindEpisodeToRun` writes a freshly created episode id — no contention possible; leave it unlocked and say so in a comment.
- **tests (must land):** (1) malformed / unknown-type row → `readAll` throws `DomainValidationError` naming the line (no silent cast); (2) valid logs round-trip identically; (3) settle attempted while an external holder owns the lock → times out closed, no event appended; (4) settle re-checks state inside the lock: episode already terminal → no-op (no double CLOSED); (5) existing waiting/close transitions unchanged; (6) truncated-tail recovery still reported, not fatal.
- **metric:** correctness/fail-closed; no perf claim.
- **acceptance:** `pnpm gate` green; `episode events --json` can no longer emit a row that fails validation; exactly one terminal snapshot possible per episode across CLI-vs-run races (pinned by test).
- **forbidden:** live R1/bandit/topology, Outcome-supported claims, ADR-006 Accepted, auto-promote, package.json dependency bumps, rewriting git history.

## T5 — pi-executor: honor pre-aborted signals, close the abort race

- **model:** `claude-opus-5-thinking-high-fast`
- **ownership (exclusive):**
  - `src/pi-adapter/pi-executor.ts`
  - `test/unit/pi-adapter/executor-abort.test.ts` (new)
  - `test/unit/pi-adapter/executor-retry.test.ts`
- **problem (evidence):** `runAttempt` (`pi-executor.ts:236-237`) relies on an `"abort"` listener, which per AbortSignal semantics **never fires for an already-aborted signal**; neither `execute` (`:299`) nor `runAttempt` checks `signal.aborted` up front, so an executor invoked after cancellation (parent cancelled while the child sat in a queue) runs the full provider call — real spend and latency after the run is dead. `runWithRetry` checks `signal.aborted` only after sleeps (`:293`).
- **change:** fail-closed short-circuits: (a) `execute` with an aborted signal yields `EXECUTION_FINISHED / CANCELLED` (and, when `onInvocation` is set, an invocation with `callOutcome: "cancelled"`, usage undefined, `latencyMs` ≈ 0, attempt 1) **without constructing an Agent or calling streamFn**; (b) `runWithRetry` checks `signal.aborted` before every attempt, not just after sleeps; (c) in `runAttempt`, after registering the listener, re-check `signal.aborted` and call `agent.abort()` once if it flipped in between (registration race). No change to retry classification, usage honesty, or event translation.
- **tests (must land):** (1) pre-aborted signal → streamFn never invoked, outcome CANCELLED, invocation recorded as cancelled with undefined usage; (2) abort flips between attempt N and N+1 (via injected `sleep`) → no attempt N+1; (3) abort racing listener registration (abort inside a fake streamFn's first tick) still cancels; (4) existing retry/Retry-After/auth-never-retried pins stay green.
- **metric:** correctness/fail-closed; no perf claim.
- **acceptance:** `pnpm gate` green; zero provider calls demonstrable after cancellation in all three windows; no behavioral change for non-aborted paths.
- **forbidden:** live R1/bandit/topology, Outcome-supported claims, ADR-006 Accepted, auto-promote, package.json dependency bumps, rewriting git history.

## T6 — Child coordinator: cancel in every window + enforce `maxWallTimeMs`

- **model:** `claude-opus-5-thinking-high-fast`
- **ownership (exclusive):**
  - `src/run/child-coordinator.ts`
  - `test/unit/run/child-coordinator-limits.test.ts` (new)
  - `test/integration/m1/child-coordinator.test.ts`
- **problem (evidence):** `ChildRunHandle.cancel()` (`child-coordinator.ts:255-263`) aborts only the live attempt's controller, which exists solely during an attempt (`:500-501` set, `:560` deleted); cancel while queued behind the `ConcurrencyGate` (`:247`) or between attempts is a **silent no-op** — the child starts or retries anyway. And `ChildRunLimits.maxWallTimeMs` — protocol-required (`protocol/v1.ts:73,180-184`), defaulted to 3 600 000 at every call site — has **no reader anywhere**: a declared limit that does nothing. Real bound today is `maxAttempts × timeoutMs` plus unbounded inter-attempt work.
- **change:** (a) per-child durable cancel: `cancel()` records the childRunId in a cancelled set *and* aborts any live controller; `runTask` checks the set right after gate acquisition and at the top of every attempt iteration → outcome `CANCELLED` with an honest summary ("cancelled before start" / "cancelled between attempts"), terminal child-run event as today. (b) wall-clock deadline: `runTask` computes `deadline = start + limits.maxWallTimeMs`; each attempt's timer becomes `min(timeoutMs, remaining)` (using the injectable `schedule`); when the deadline is exhausted, stop retrying with outcome `TIMEOUT` and a summary naming the wall limit. No protocol shape changes; no new event types.
- **tests (must land):** (1) gate saturated, cancel a queued child → executor never invoked for it, outcome CANCELLED; (2) cancel during the TASK_RETRY window between attempts → no further attempt; (3) `maxWallTimeMs < timeoutMs` → single attempt aborted at the wall deadline, outcome TIMEOUT with the wall reason; (4) wall exhausted after attempt 1 of 3 → attempts stop at 1; (5) generous wall limit → behavior byte-identical to today (regression pin on existing integration flows); (6) cascade-retry path still respects the deadline. Use the injected `schedule`/fake timers — no real sleeps.
- **metric:** correctness/fail-closed; no perf claim.
- **acceptance:** `pnpm gate` green; `maxWallTimeMs` provably read and enforced; every cancel window pinned; existing m1 integration behavior for un-cancelled, in-budget children unchanged.
- **forbidden:** live R1/bandit/topology, Outcome-supported claims, ADR-006 Accepted, auto-promote, package.json dependency bumps, rewriting git history.

## T7 — persist/jsonl append fast path (bench-gated)

- **model:** `gpt-5.6-sol-xhigh-fast`
- **ownership (exclusive):**
  - `src/persist/jsonl.ts`
  - `scripts/bench-runtime.mjs`
  - `test/unit/persist/jsonl.test.ts`
- **problem (evidence):** `appendJsonlLine` (`jsonl.ts:13-23`) runs `mkdir(recursive)` on **every** append and, on the fsync path, opens a **second fd** (`appendFile` then `open(path,"a")`+`sync`+`close`) — up to 3 fs ops per durable append. Every store (run events, episode snapshots/events, feedback, invocations) pays this per line. Measured baseline on this VM: `jsonlAppendMs: 68.264` per 1000 non-fsync appends; **no fsync-append benchmark exists**.
- **change:** first extend `scripts/bench-runtime.mjs` with `jsonlAppendFsyncMs` (1000 fsync appends) and record the baseline JSON in the slot report; then optimize: single `open(path,"a")` handle for write(+sync) on the fsync path, and drop the unconditional `mkdir` (append first, on ENOENT `mkdir` and retry once — or a per-path created memo; either way ENOENT-safe). **Exported signatures `appendJsonlLine` / `readJsonlObjects` must not change** — four other slots depend on them.
- **tests (must land):** (1) append into a missing directory still creates it (both fsync and non-fsync); (2) fsync path still durable-by-construction (write and sync on the same handle — pin via behavior, not mocks, where possible); (3) truncated-tail recovery byte-for-byte unchanged; (4) parallel appends from multiple in-process callers never produce an interleaved/torn line at 1 KB line sizes; (5) corrupt-middle-line still throws via the injected error factory.
- **metric:** **performance** — ≥5% improvement on `jsonlAppendMs` and/or `jsonlAppendFsyncMs` versus the same-VM baseline recorded in the slot report, else **ROLLBACK** the optimization (the new bench stays either way).
- **acceptance:** `pnpm gate` green; bench JSON before/after included in the slot report; no signature drift.
- **forbidden:** live R1/bandit/topology, Outcome-supported claims, ADR-006 Accepted, auto-promote, package.json dependency bumps, rewriting git history.

## T8 — Protocol v1 structured fuzz

- **model:** `gpt-5.6-sol-xhigh-fast`
- **ownership (exclusive):**
  - `src/protocol/v1.ts` (fix-only, and only if the fuzzer exposes a defect)
  - `test/unit/protocol/fuzz.test.ts` (new)
  - `test/unit/protocol/v1.test.ts`
- **problem (evidence):** `validateAgentMessage` and friends parse child-transcript JSON (attacker-adjacent) but are example-tested only; the risk register lists "protocol v1 parse surface under-fuzzed". Unverified classes: `__proto__`/`constructor` keys through `isRecord`, huge arrays (`inputArtifactIds`, `options`, `evidenceIds`), deep `approvalPlan` nesting, surrogate-garbage / zero-width strings in ids and enums, numeric edge cases (`-0`, `NaN`, `2**53`), duplicate-terminal placement. Error-class discipline matters: `child-coordinator.ts:638` catches around validation expecting `DomainValidationError`-shaped failures — any `TypeError` escaping the validator is a crash, not a rejection.
- **change:** a deterministic, seeded mutation fuzzer inside `test/unit/protocol/fuzz.test.ts` (small xorshift PRNG written in-test — **no new dependencies**): start from one valid seed per message type, apply a few thousand structured mutations (drop/retype/inflate/rename fields, inject proto-pollution keys, corrupt enums/ids/timestamps), and assert the invariant: `validateAgentMessage` either returns a value that re-validates to a deep-equal result (idempotence) or throws **exactly** `DomainValidationError` — never any other error class, never a hang. Same invariant for `validateApprovalReplyForPlan` and `assertAtMostOneTerminal` over generated arrays. Print the seed on failure for reproduction. If a defect surfaces, the minimal fail-closed fix in `v1.ts` plus a named regression test in `v1.test.ts`.
- **tests (must land):** the fuzz suite itself (bounded runtime, deterministic seed) + explicit named cases for proto-pollution keys, duplicate terminal at first/last index, and oversized arrays.
- **metric:** correctness/fail-closed; no perf claim (fuzz suite must stay under a few seconds so the gate stays fast).
- **acceptance:** `pnpm gate` green; fuzz deterministic (fixed default seed); zero non-`DomainValidationError` escapes over the full run.
- **forbidden:** live R1/bandit/topology, Outcome-supported claims, ADR-006 Accepted, auto-promote, package.json dependency bumps, rewriting git history.

## T9 — Doctor hermeticity + adaptation-plane transitive closure

- **model:** `gpt-5.6-sol-xhigh-fast`
- **ownership (exclusive):**
  - `src/cli/doctor.ts`
  - `test/unit/cli/doctor.test.ts`
  - `test/unit/cli/doctor-overlay.test.ts` (only if the seam requires it)
  - `test/unit/privacy/plane-boundary.test.ts`
- **problem (evidence):** (A) `nodeCheck` (`doctor.ts:109-118`) reads `process.versions.node` with no seam; on this VM (22.14.0 < engines `>=22.19.0`) two doctor tests fail — measured baseline **1432 pass / 2 fail** — so every implementer's gate this round contains false failures that can mask real regressions. Doctor's fail-closed behavior is correct; the *tests* are host-dependent. (B) `plane-boundary.test.ts:91-108` checks only first-hop imports per adaptation file; the eval-routing→assign→model-router value chain is hand-special-cased (`:136-156`), and any new `adaptation/* → routing/* → {run,telemetry,episode,…}` transitive value chain would pass silently (Loop-3 residual "adaptation-plane transitive import closure", still open).
- **change:** (A) give `doctorCommand` (or the check builder it calls) an optional injected `nodeVersion` defaulting to `process.versions.node` — zero behavior change for the real CLI — and rewrite the two host-dependent tests to inject a compliant version, plus one test injecting a non-compliant version pinning the FAIL line and exit 1. (B) extend `plane-boundary.test.ts` with a transitive **value-import** closure walk (regex-based, same conservative style as the tracking live-isolation walker: `import type` edges excluded, comment false-positives fail closed) from `ADAPTATION_DIRS` through relative `src/` imports, asserting the closure touches `RUNTIME_MODULES` only via the pinned allowlist (model-router through `routing/assign.ts`, plus the existing sanctioned readers).
- **tests (must land):** hermetic doctor pass/fail pair (injected versions); doctor JSON contract untouched; closure test green on the current tree and demonstrably red when a synthetic violation is described (prove via the test's own negative-case fixture or an in-test simulated file table, not by editing `src/`).
- **metric:** correctness; no perf claim.
- **acceptance:** **`pnpm test` fully green on this VM's Node 22.14.0** (the 2 baseline failures gone) while doctor still fails closed for real on old hosts; closure test enumerates its allowlist with justifications.
- **forbidden:** live R1/bandit/topology, Outcome-supported claims, ADR-006 Accepted, auto-promote, package.json dependency bumps (including `engines` edits), rewriting git history.

## T10 — Crash / disaster-recovery probe (real process kills)

- **model:** `gpt-5.6-sol-xhigh-fast`
- **ownership (exclusive):**
  - `scripts/crash-probe.mjs` (new)
  - `test/integration/persist/crash-recovery.test.ts` (new directory + file)
- **problem (evidence):** every crash-window claim in the persistence layer (truncated-tail recovery in `readJsonlObjects`, checkpoint old-or-new via rename, lock-holder death → waiter timeout with manual cleanup) is reasoned and unit-mocked but never exercised by an actual killed process. The risk register carries "CheckpointStore atomic write vs concurrent torn reads" and the lock's no-steal posture as untested-under-crash.
- **change:** `scripts/crash-probe.mjs` in the style of `security-probe.mjs`/`retention-probe.mjs`: spawn short-lived Node child processes (via `tsImport`, like `bench-runtime.mjs`) that SIGKILL themselves mid-write — (a) partial JSONL line flushed then kill → parent asserts `readJsonlObjects` returns the intact prefix and reports the tail via `recovery`; (b) checkpoint writer killed between temp-write and rename → parent asserts `CheckpointStore.read` yields the previous complete document and the **next** write succeeds despite the stale temp; (c) lock holder killed → parent asserts a waiter times out with `DomainValidationError` naming the lock path (the documented no-steal posture), and that removing the stale lock file recovers. Emits one JSON verdict line (`{ ok, cases: [...] }`), exit 1 on any failed invariant. The integration test runs a reduced-iteration probe pass. **Constraint:** assert only public-API invariants that hold both before and after T3/T7 land (single sequential writer for the checkpoint case; no dependence on temp-file naming or fd strategy).
- **tests (must land):** the integration test above (deterministic, bounded < ~10 s, tmpdir-isolated, no reliance on timing races — the child signals its progress point through a sentinel file before killing itself).
- **metric:** correctness/disaster-recovery; no perf claim.
- **acceptance:** `pnpm gate` green; `node scripts/crash-probe.mjs` prints `ok: true` on this VM; probe is rerunnable and leaves no temp state behind.
- **forbidden:** live R1/bandit/topology, Outcome-supported claims, ADR-006 Accepted, auto-promote, package.json dependency bumps (invoke the probe via `node scripts/crash-probe.mjs`; do not add a package script), rewriting git history.

---

## Disjointness proof (by file)

| Path | Owner |
|---|---|
| `src/feedback/store.ts`, `src/privacy/deletion.ts` | T1 |
| `src/telemetry/invocation-log.ts`, `src/cli/main.ts` (runCommand hooks only) | T2 |
| `src/persist/atomic-file.ts`*, `src/run/checkpoint-store.ts`, `src/run/pause-controller.ts` | T3 |
| `src/episode/store.ts`, `src/episode/events.ts`, `src/run/episode-bind.ts`, `src/run/episode-store.ts` | T4 |
| `src/pi-adapter/pi-executor.ts` | T5 |
| `src/run/child-coordinator.ts` | T6 |
| `src/persist/jsonl.ts`, `scripts/bench-runtime.mjs` | T7 |
| `src/protocol/v1.ts` | T8 |
| `src/cli/doctor.ts` | T9 |
| `scripts/crash-probe.mjs`* | T10 |

\* new file. Test-file ownership is listed per task and is likewise disjoint (`test/unit/persist/jsonl.test.ts` → T7; `test/unit/persist/atomic-file.test.ts` → T3; `test/unit/privacy/deletion.test.ts` → T1; `test/unit/privacy/plane-boundary.test.ts` → T9; `test/integration/m1/child-coordinator.test.ts` → T6; `test/integration/persist/**` → T10). Cross-slot **imports** of another slot's modules are allowed; **edits** are not.
