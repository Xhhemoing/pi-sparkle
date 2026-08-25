[Model: claude-opus-5-thinking-high-fast]

# Loop 4 · Round 18 — slot R18-1: a steered instruction must not silently die in a retry

Direction **(a) re-deliver**, exactly as signed off. `PiAgentExecutor` now keeps the steer texts it
accepts for the whole `execute()` and hands them to each fresh retry kernel, polled after the new
attempt's first turn. No new event type, no `RunStatus` contact, no edit to `coordinator.ts` /
`events.ts`, no change to the `AgentExecutor.steerText` contract — the fix makes the implementation
match the docstring that was already there.

## 0. Census (before any edit)

- Branch `cursor/opt-r18-postmerge-42b1`, HEAD **`daea498`** (`fix(cli): carry declared per-child
  maxCostUsd through parseChildSpec`). The brief and audit were written at `7d8b7a3`; since then the
  parent has committed the orchestrator files and **R18-2 has already landed** (`daea498`). Working
  tree at slot start: clean. Sibling R18-2 owns `src/cli/main.ts`,
  `test/integration/m1/cli-children.test.ts`, `docs/specs/m0-m2-architecture.md` — **disjoint** from
  everything below, and already committed, so no live contention.
- All handed paths exist: `src/pi-adapter/pi-executor.ts`,
  `test/unit/pi-adapter/steer-inflight.test.ts`, and the directory
  `test/integration/pi-adapter/` for the new file.
- Defect re-confirmed at source before editing: `runWithRetry` (`pi-executor.ts:644`) calls
  `runAttempt` once per attempt; `runAttempt` builds a fresh kernel via `SparkleKernel.fromFactory`
  (`:536`) and registers it in `liveKernels` (`:561`), deleting it again in its own `finally`
  (`:612`). `steerText` (`:702`) targeted whatever kernel was live and kept nothing, so a text
  accepted under attempt N died with attempt N's discarded context.
- Pi-side mechanics checked in `node_modules` rather than assumed, because the fix's placement turns
  on them: `Agent.steer` only enqueues (it never throws and does not require an active run);
  `PendingMessageQueue` defaults to `one-at-a-time`, so several queued steers arrive one per turn;
  `runLoop` polls `getSteeringMessages` **once before the first turn** (`agent-loop.js:83`) and again
  **after every `turn_end`** (`:160`). That first poll is why re-delivery cannot happen at prompt
  time — see §2.

**Consumer census (whole tree, `src` + `test`):**

| Symbol | Importers found | Action |
|---|---|---|
| `PiAgentExecutor.steerText` | `src/run/coordinator.ts` (via the optional `AgentExecutor.steerText`), `test/integration/m0/steer.test.ts`, `test/integration/pi-adapter/steer-blocked-tool.test.ts`, `test/unit/pi-adapter/steer-inflight.test.ts` | none — signature, refusals and their messages are byte-identical |
| `PiAgentExecutor.runAttempt` / `runWithRetry` | private; no importer anywhere. (`ChildCoordinator.runAttempt` at `child-coordinator.ts:646` is an unrelated private method with the same name, referenced only in comments) | none |
| `acceptedSteers` | new, private, referenced only inside `pi-executor.ts` | none |
| `AgentExecutor.steerText` docstring (`execution/contract.ts:39-53`) | frozen; not owned | **not edited** — it already promised "picked up after the current turn" and "a steer that silently goes nowhere is worse than a rejected one"; this slot makes both true rather than rewriting either |
| `SparkleKernel.steerText` / `AsyncEventQueue` (`kernel.ts`) | unchanged | none |
| Adaptation-plane `src` import edges | none added or removed — the only new imports are inside the new test file | neither privacy guard enters ownership, as the brief predicted |

## 1. Files changed

**`src/pi-adapter/pi-executor.ts`** (owned) — four edits, all inside the class:

1. New private field `acceptedSteers: Map<AgentInstanceId, string[]>`, with the docstring carrying
   the *why*: the record is scoped to the execution and not the attempt precisely because a fresh
   Agent per attempt is what loses the text, and `STEER_INJECTED` is written once the executor
   accepts it.
2. `runAttempt` takes a `replay: readonly string[]`. Inside the existing kernel subscription — no
   second subscribe — the first `TURN_FINISHED` of the attempt re-delivers each replayed text with
   `kernel.steerText`, latched by a `replayPending` flag so it happens once per attempt.
3. `runWithRetry` owns the log's lifetime: it creates the array, registers it under the request's
   `agentInstanceId`, and deletes it in a `finally` (guarded by identity, so a same-instance
   execution cannot clobber another's entry). Each attempt is handed a **snapshot** (`[...steers]`)
   taken before the attempt starts.
4. `steerText` iterates `liveKernels.entries()` instead of `.values()` so it knows which execution
   to record under, and appends **after** `kernel.steerText(text)` returns.

**`test/integration/pi-adapter/steer-retry.test.ts`** (new, owned) — two tests, no timers beyond a
5s dead-man fallback that the assertions require not to have fired; the retry `sleep` is stubbed so
no backoff wall clock is burned.

## 2. Why the re-delivery sits at the first `turn_end` and not at the prompt

This is the part of the sign-off that constrains the implementation, so it is worth stating plainly.
Pi's loop polls its steering queue once *before* the first turn. Enqueueing at kernel construction
or before `kernel.prompt()` would therefore fold the steer into the retry's **opening request** —
the model would see it as a second user turn of the very first call, which is not the "picked up
after its current turn" the operator was promised, and it is also the shape in which the audit's
"discarded context cannot double-apply" argument stops holding. Delivering at the first `turn_end`
lands the text in exactly the poll a live steer would have hit. Mutant 2 in §5 is that alternative,
and it reddens both tests.

Two smaller consequences of the same reasoning, both deliberate:

- The snapshot is taken **before** the attempt starts, so a steer accepted live *during* attempt N+1
  is delivered by the kernel once and is not also in that attempt's replay list.
- Nothing is cleared on success: the log is discarded with the execution, not with the attempt, so a
  third attempt still replays what attempt 1 was told (pinned by the second test).

## 3. Tests

Both are the audit's proof shape turned into regressions.

1. **`a steer accepted before a retried provider failure reaches the retry's context`** — text +
   blocking tool call; steer while the hook holds the turn; the next call throws
   `429: {"error":{"message":"rate limit exceeded"}}`; attempt 2 succeeds. Asserts attempt 1's second
   call carried the steer (the context the retry threw away), that exactly one call after the retry
   carries it, that attempt 2's *first* call still repeats the original prompt alone, that the
   surviving call is prompt-plus-steer, that the run ends `SUCCESS`, and that there were exactly four
   provider calls.
2. **`a steer survives more than one retry and is re-delivered exactly once per attempt`** — attempt
   2 dies on its opening call before it can consume the steer it was handed, so attempt 3 must be
   handed the same text again. Asserts one steer-carrying call across five, and that neither of the
   two failed attempts saw it.

**Owned tests, 3× (`node scripts/run-tests.mjs test/integration/pi-adapter/steer-retry.test.ts`):**

```text
=== run 1 ===              === run 2 ===              === run 3 ===
ok 1 - ...retry's context  ok 1 - ...retry's context  ok 1 - ...retry's context
ok 2 - ...once per attempt ok 2 - ...once per attempt ok 2 - ...once per attempt
# tests 2 # pass 2 # fail 0 (identical across all three)
```

**The existing 10 steer pins, untouched and green** (`m0/steer.test.ts` 5,
`pi-adapter/steer-blocked-tool.test.ts` 2, `unit/pi-adapter/steer-inflight.test.ts` 3):
`# tests 10 # pass 10 # fail 0`.

`test/unit/pi-adapter/steer-inflight.test.ts` was **not** edited. The conditional grant applied only
if the new executor-level state needed a unit pin; the two integration tests above exercise
`acceptedSteers` end-to-end through a real kernel, and the one behaviour a unit pin could add — that
a kernel *refusal* is not recorded for replay — is not reachable through `PiAgentExecutor` (see §6).

**Wider runs on this VM (Node v22.14.0, engine warning only):**

- `node scripts/run-tests.mjs test/integration/pi-adapter test/unit/pi-adapter`: 136 tests / 135 pass
  / 0 fail / 1 skip (`PI_SMOKE`).
- Whole suite, `node scripts/run-tests.mjs` (same discovery as `pnpm test`): **2042 tests / 2041 pass
  / 0 fail / 0 cancelled / 1 skipped / 120 suites**. That is the audit's 2038 plus R18-2's two new
  CLI tests plus this slot's two. Full `pnpm gate` remains the parent's job.
- `npx tsc --noEmit` on the whole tree: clean, exit 0.
- `npx eslint src/pi-adapter/pi-executor.ts test/integration/pi-adapter/steer-retry.test.ts`: clean.

## 4. Contracts kept

- **Live-through-tool-start (`77e5d42`) not touched.** The replay rides the existing subscription and
  emits no `ExecutionEvent`; `streamPrefixOpen`, `streamedCount` and the per-attempt verdict buffer
  are byte-identical. The first test steers on a **live** `TOOL_STARTED`, so it re-pins that streaming
  behaviour on the way past.
- **Thinking stays bytes-only.** `translatePiEvent` is unchanged, the replay reads only strings the
  caller passed to `steerText`, and nothing thinking-derived can reach `STEER_INJECTED.text`.
- **Steer refusals stay refusals.** All three `DomainValidationError` messages are unchanged, and the
  record happens only after the kernel has taken the text.
- **Cost gate untouched.** `recordTurn` still runs first on every `TURN_FINISHED`, and the replay
  never calls the latching `requestStopIfExceeded`. A ceiling stop still wins: the loop's own
  `shouldStopAfterTurn` runs between the enqueue and the poll.
- No `package.json`, no dependency change, no new `RunStatus`, no route text, no adaptation-plane
  import edge, no PROGRESS tick, no commit, no branch change.

## 5. Mutation transcript (out-of-tree)

Method: `git archive HEAD | tar -x -C /tmp/r18-t1/tree`, this slot's two files copied over it,
`node_modules` symlinked, run through the repo's own `scripts/run-tests.mjs`. `/tmp/r18-t1` deleted
afterwards.

**Control** (unmutated copy): `ok 1`, `ok 2`, `# pass 2 # fail 0`.

**Mutant 1 — re-delivery removed** (drop `for (const text of replay) kernel.steerText(text);`). This
is the pre-fix behaviour, and it reproduces the audit's transcript exactly:

```text
not ok 1 - a steer accepted before a retried provider failure reaches the retry's context
  error: |-
    the surviving attempt must see the steer exactly once, got
    [["[{\"type\":\"text\",\"text\":\"Working directory: .\\n\\nCall blocking_hook, then report.\"}]"]]
    0 !== 1
not ok 2 - a steer survives more than one retry and is re-delivered exactly once per attempt
  expected: 1   actual: 0
# tests 2 # pass 0 # fail 2
```

**Mutant 2 — re-delivered before the retry's prompt** instead of at its first `turn_end` (the §2
alternative). Reddens the placement clause in test 1 and the double-apply clause in test 2:

```text
not ok 1 - the retry's first call must repeat the original prompt alone, got
  ["[{...Call blocking_hook, then report.}]","\"Switch to the migration path and skip the rewrite.\""]
not ok 2 - the third attempt must see the steer exactly once, got [[prompt, steer],[prompt, steer]]
  expected: 1   actual: 2
# tests 2 # pass 0 # fail 2
```

**Mutant 3 — `replayPending` never latched**, so the text is re-queued after every turn. The run
never terminates on its own script and both tests go red on the outcome:

```text
not ok 1 - ...  expected: 'SUCCESS'  actual: 'FAILURE'
not ok 2 - ...  expected: 'SUCCESS'  actual: 'FAILURE'
# tests 2 # pass 0 # fail 2
```

## 6. Residuals (recorded, not fixed here)

1. **The record-after-accept ordering in `steerText` is defensive and currently unreachable.**
   Pi's `Agent.steer` only pushes onto an array, so `SparkleKernel.steerText` cannot throw against a
   real kernel; the ordering matters only for a hypothetical kernel that refuses. `PiAgentExecutor`
   builds its kernel through an inlined `SparkleKernel.fromFactory` with no injection seam, so
   pinning the refusal path would mean adding a seam to production code purely for the test. Left
   unpinned and disclosed rather than contorted. (`steer-inflight.test.ts` pins the analogous
   ordering one layer up, through its own `KernelBackedExecutor`.)
2. **Ordering when a live steer and a replayed steer land in the same attempt.** If attempt N+1
   receives a *new* steer during its first turn, that one is enqueued mid-turn and the replayed
   attempt-N text is enqueued at `turn_end`, so the newer text is polled first. Both are delivered,
   once each; only their relative order differs from the order the operator typed them. No contract
   names an ordering across a retry boundary, and constructing the case needs a steer inside a
   blocked tool of an attempt that itself follows a retry. Recorded, not fixed.
3. **A steer is still refused between attempts.** During the backoff sleep no kernel is live, so
   `steerText` throws "no agent run is in flight". That is the existing refuse-loudly contract and is
   unchanged — this slot repairs dropped delivery, it does not widen the steerable window.
4. **A cost-ceiling stop can still leave a replayed steer unconsumed.** If the gate's
   `shouldStopAfterTurn` fires between the enqueue and the poll, the run ends at the ceiling with the
   steer unread. That terminal is disclosed in the transcript ("pi agent stopped at the cost
   ceiling") and letting the ceiling win is the right precedence; noted so it is not mistaken for the
   defect this slot closed.
5. **Test hygiene, outside this slot:** a full-suite run leaves ~138 `mkdtemp` state roots behind in
   `/tmp` (`pi-sparkle-pause-*`, `pi-sparkle-eval-*`, `pi-sparkle-adapt-*`). Not caused by this slot's
   files; I deleted the ones my runs created. Worth a slot for whoever owns those suites.

## 7. Process record

- Census first, against the working tree; every handed path verified to exist; the defect
  re-confirmed at source at `daea498` before any edit.
- Whole-tree `tsc --noEmit` and scoped `eslint` both clean; owned tests 3× with identical results;
  the 10 existing steer pins green untouched; whole suite green.
- Mutations and the control run out-of-tree only (full `git archive` copy, `node_modules` symlinked),
  then deleted. No scratch files and no `/tmp` state roots remain at report time.
- No commits, no pushes, no branch change, no `PROGRESS.md` edit. Working tree carries exactly two
  paths: `src/pi-adapter/pi-executor.ts` (modified) and
  `test/integration/pi-adapter/steer-retry.test.ts` (new), plus this report.
