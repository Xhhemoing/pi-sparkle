[Model: claude-opus-5-thinking-high-fast]
# Loop 4 Round 1 — T6 report

Scope: `src/run/child-coordinator.ts`, `test/unit/run/child-coordinator-limits.test.ts` (new),
`test/integration/m1/child-coordinator.test.ts`. No other file touched; no protocol shape change,
no new event type, no commit.

## (a) Durable per-child cancel

`ChildRunHandle.cancel()` previously reached only `attemptControllers.get(childRunId)`, a map entry
that exists solely between `runAttempt`'s `set` and its `finally` `delete`. A cancel while the child
sat behind the `ConcurrencyGate`, or in the retry window between attempts, aborted nothing and the
child started or retried anyway.

- `ChildCoordinator` now holds `cancelledChildren: Set<RunId>`. `cancel()` records the child run id
  and still aborts a live attempt controller, so mid-attempt behavior is unchanged.
- `runTask` consults the set at the top of every attempt iteration — the first iteration runs right
  after the gate admitted the child, which covers the queued window. Outcome `CANCELLED` with
  `"cancelled before start"` (no attempt ran, `attempts: 0`) or `"cancelled between attempts"`
  (`attempts` stays at the last executed attempt). The terminal child-run event is the existing
  `RUN_CANCEL_REQUESTED`.
- The set entry is dropped when the child settles, and `cancel()` after settling is a no-op, so the
  set cannot grow without bound.

## (b) `maxWallTimeMs` enforcement

The limit was protocol-required, defaulted at every call site, and had zero readers; the real bound
was `maxAttempts x timeoutMs` plus unbounded inter-attempt work.

- `runTask` arms one deadline timer per child run through the injectable `schedule`. Because the
  per-attempt timer and the deadline timer race, an attempt ends at `min(timeoutMs, remaining wall
  budget)` — whichever fires first — without the coordinator needing a wall clock of its own.
- On expiry the timer aborts the live attempt (if any) and marks the run. An attempt that produced
  neither a terminal `TASK_RESULT` nor a protocol violation is reported as the wall limit rather
  than as the abort's downstream shape (attempt timeout / executor cancellation): one `TASK_TIMEOUT`
  parent event, outcome `TIMEOUT`, summary
  `wall-clock limit of <maxWallTimeMs>ms exhausted after N attempt(s)`.
- Every retry path (`task timed out`, `attempt failed`, and the live-cascade escalation) funnels
  through the top-of-loop deadline check, so an exhausted budget stops the ladder with the same
  `TIMEOUT` outcome and wall summary. A terminal result or protocol failure that still arrived keeps
  its own honest outcome.
- The deadline timer is cancelled when the child settles (pinned: no timer outlives a child run).
- Fail-closed guard: the protocol validator requires a positive integer, but in-process limits
  bypass it, so a non-finite or non-positive budget is treated as already exhausted (no attempt
  runs) instead of as "unbounded". Values above the `setTimeout` range are clamped rather than
  silently firing immediately.

## Tests

New unit file (fake clock driving the injected `schedule`; no real sleeps anywhere):

1. gate saturated, queued child cancelled — executor invoked once (for the running child only), the
   cancelled child settles `CANCELLED` / `attempts: 0` / `"cancelled before start"`, child log is
   exactly `RUN_CREATED, RUN_STARTED, RUN_CANCEL_REQUESTED`.
2. cancel landing in the retry window — `TASK_RETRY` is recorded (the retry decision was reached),
   the executor is invoked once, outcome `CANCELLED` / `"cancelled between attempts"`.
3. `maxWallTimeMs` (500) below `timeoutMs` (10 000) — the single attempt is aborted at the wall,
   outcome `TIMEOUT` naming the wall limit, `TASK_TIMEOUT` present, no `TASK_RETRY`, child
   `RUN_FAILED.reason` equals the summary, no timer left live.
4. wall exhausted during attempt 1 of 3 — attempts stop at 1, no `TASK_RETRY`.
5. non-positive wall budget — fails closed before any attempt (`attempts: 0`, executor never
   invoked).
6. cascade path — the escalation decision is still recorded, but the escalated attempt never runs
   past the deadline (`models === ["cheap"]`, outcome `TIMEOUT`).
7. generous wall — cascade escalation still reaches `premium` and succeeds in 2 attempts, no wall
   text in the summary, no leftover timers.

Integration file (`test/integration/m1/child-coordinator.test.ts`) keeps all 14 existing tests and
adds two:

- **regression pin:** with a generous wall the timeout-and-retry flow pins the exact parent event
  sequence (`RUN_CREATED, CHILD_RUN_CREATED, CHILD_MESSAGE, TASK_TIMEOUT, TASK_RETRY, CHILD_MESSAGE,
  CHILD_MESSAGE`) and the child lifecycle spine. `AGENT_EVENT` rows are filtered out of that
  comparison because how far the stream got before the timeout abort landed is genuinely
  timing-dependent (pre-existing, unchanged by this task).
- **end-to-end wall bound:** `maxAttempts 3 x timeoutMs 1 000` budgets 3 000 ms of attempts while the
  wall stops at 2 500 — three attempts run, the third ends at the wall (not at its own timer), three
  `TASK_TIMEOUT` and only two `TASK_RETRY` events, outcome `TIMEOUT` with the wall summary.

## Verification

`pnpm test -- test/unit/run/child-coordinator-limits.test.ts test/integration/m1/child-coordinator.test.ts`

Result: **23 passed, 0 failed**, repeated three times (stable). `npx tsc --noEmit` reports no error
in any T6 file, `npx eslint` clean on all three. Per instructions the full suite and `pnpm gate`
were not run (other slots are editing the same tree concurrently; the only typecheck error in the
tree at the time of writing is in `test/unit/protocol/v1.test.ts`, owned by T8).

Negative check (does the new suite actually catch the old behavior?): the pre-change coordinator was
restored from `HEAD` into an isolated `/tmp` copy of `src` — the shared workspace was never reverted
— and the same tests run against it. Results there: unit tests 1, 2 fail with the documented wrong
outcomes (`SUCCESS` instead of `CANCELLED` for the queued cancel, `FAILURE` instead of `CANCELLED`
for the retry-window cancel), and every wall test hangs until the runner reports
"Promise resolution is still pending" — the unbounded-run defect itself. The integration wall test
hangs the same way. The generous-wall regression pin passes **identically** on the pre-change code,
which is the byte-identical evidence for requirement 5.

## Disclosures

- A cancel that lands mid-attempt on an executor that ignores its abort signal and still returns a
  terminal `TASK_RESULT` settles with that result, not `CANCELLED`. Only the two windows named in
  the task (queued, between attempts) are made durable; honoring a terminal result that actually
  arrived stays the honest reading.
- `maxCostUsd` on `ChildRunLimits` remains unread at the child level (audit §7); this task enforced
  wall time only.
- No live R1 / bandit / topology claim, no Outcome-supported claim, no ADR-006 status change, no
  auto-promote, no `package.json` change, no git history rewrite, no cosmetic-only edit.
