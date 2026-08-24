# Round 1 opus-2
MODEL_SLUG: claude-opus-5-thinking-high-fast

## Implemented

### Task A — 429-aware retry at the Pi executor

New `src/pi-adapter/provider-retry.ts` holds the classification and backoff
policy; `src/pi-adapter/pi-executor.ts` drives it.

- **Two failure shapes, one classifier.** A provider failure reaches the
  adapter either as a thrown SDK error (`status` / `statusCode` /
  `$metadata.httpStatusCode` / nested `cause`) or — the common case — as the
  flattened string the agent loop keeps on `AgentState.errorMessage`, since
  `createErrorMessage` discards the error object and keeps only
  `error.message`. `classifyProviderFailure(error, errorMessage)` probes both,
  including the shapes pi's own `formatProviderError` produces
  (`"429: {...}"`, `"openrouter-ox (429): ..."`, `"429 status code (no body)"`).
  Without the string path the retry would have been dead code on the real
  openrouter route.
- **Retryable set:** 408, 425, 429, 500, 502, 503, 504, 529. Deterministic 4xx
  (400/404/422) and 501 are terminal. 401/403 are classified `auth` and are
  never retried even when the payload carries a `remedy_hint` telling us to —
  a retry only re-sends the credential the provider just refused.
- **Wait precedence:** `remedy_hint` delay → `Retry-After` → exponential
  backoff. `Retry-After` is read from a `Headers` instance, a plain header
  record, `retry-after-ms`, SDK fields (`retryAfterSeconds`, `retry_after`, …),
  an HTTP-date, or the flattened message. Backoff is
  `baseDelayMs * 2^(attempt-1)` with additive jitter, capped at 8s.
- **`maxRetryAfterMs` (30s):** a server asking for a longer wait than this gets
  `requested-delay-exceeds-cap` and the failure is surfaced instead of slept
  through. This mirrors pi-ai's own `maxRetryDelayMs` idea: an executor call
  should not silently hold a run for 20 minutes.
- **`remedy_hint`** is honored as a string (`"back off for 6 seconds"`,
  `"do not retry; upgrade your plan"`), as a structured object
  (`{ retry, delayMs }`), and when it only survived inside the flattened JSON
  body. It can veto a retry as well as request one.
- **Defaults are live without wiring.** `maxAttempts: 3`. `PiExecutorOptions.retry`
  is optional and `createConfiguredPiExecutor` now passes it through, so the
  CLI `--executor pi` path gets three attempts today.
- **Cancellation stays prompt.** `sleepWithAbort` resolves on abort, and the
  loop re-checks `signal.aborted` after each sleep.
- Each attempt builds a **fresh `Agent`**, so a failed turn never leaks into
  the retried transcript, and only the surviving attempt's events are yielded.
- `attempt` (>= 1) and a terminal `callOutcome` (`ok` | `timeout` | `cancelled`
  | `error`) are recorded on every invocation. 408/504 map to `timeout`;
  everything else non-`ok` maps to `error`.
- Observability without logging: `retry.onRetry(info)` fires before each sleep
  with the attempt, delay, reason, and classified failure. The adapter itself
  never writes to the console.

### Task B — usage integrity

- `translatePiEvent` now rejects any usage count that is not a non-negative
  integer, and the all-zero guard is symmetric (previously `input: undefined,
  output: 0` slipped through and recorded a fabricated `0`).
- `buildInvocation` stores `tokensIn`/`tokensOut` as `undefined` whenever
  `callOutcome !== "ok"`. This is the report's §1.2 defect: error payloads
  carry a zeroed usage block, and a partial stream reports only what arrived
  before the failure.
- New `src/telemetry/usage-aggregate.ts`: `isCostEligible`, `isUnattributed`,
  `costEligibleInvocations`, `sumUsage`. Only `callOutcome === "ok"` is
  billable. Records with **no** `callOutcome` (everything written before
  attribution existed) are excluded conservatively but counted separately as
  `excludedUnattributed`, so a caller can tell "this call failed" from "this
  record predates outcome attribution". Totals stay `undefined` rather than
  collapsing to `0` when nothing eligible reported usage.
- `tokensIn`/`tokensOut` validation in `model-invocation.ts` is unchanged
  (present ⇒ non-negative integer); the executor now sanitizes upstream so the
  validator never has to reject a whole record over one bad count.

### Task C — `migrate-legacy`

New `src/cli/migrate-legacy.ts`; `src/cli/main.ts` gained exactly three lines
(import, `case "migrate-legacy"`, one USAGE line).

- Legacy sources are pinned to a plane in one table and never inferred:
  `feedback/` → `adaptationRoot`; `runs/`, `episodes/`, `invocations.jsonl` →
  `runtimeRoot`. `src/privacy/state-layout.ts` is imported, not edited.
- Default is a dry run that writes nothing (verified: it does not even create
  the plane directories) and prints per-file `would copy` / `already migrated`
  / `conflict` lines plus a summary.
- `--apply` copies with `COPYFILE_EXCL`; sources are never moved or deleted.
- **Idempotent** via SHA-256 comparison: an identical destination is
  `already-migrated` and skipped; a *differing* destination is a `conflict`
  and is never overwritten.
- **Fails closed** on corrupt JSONL using the shared `readJsonlObjects` helper,
  so the corruption contract matches the store that will read the copy. A
  corrupt middle line aborts before anything is written; a recoverable
  truncated final line only warns (the copy is byte-for-byte).
- Exit codes, as specified: `0` when a dry run finds nothing or `--apply`
  succeeds; `1` when a dry run finds pending work or conflicts, or when apply
  hits a conflict/copy failure. The pending-work `1` is deliberate (a
  `git diff --exit-code`-style "migration needed" signal) and is stated in the
  command's own usage text so it does not surprise anyone.
- No retention vacuum was added.

## Tests

All green. Note on the runner: `pnpm test -- <dir>` cannot work in this
checkout — `tsx --test -- <dir>` resolves the directory as an ES module import
and throws `ERR_UNSUPPORTED_DIR_IMPORT`. This is pre-existing (it reproduces on
untouched directories such as `test/unit/domain`, on both the sandbox's Node
22.14 and on Node 22.22), and `package.json` is outside my write paths, so I
ran the same suites by file glob.

```
pnpm test -- test/unit/pi-adapter/*.test.ts test/unit/telemetry/*.test.ts \
             test/unit/cli/migrate-legacy.test.ts \
             test/integration/pi-adapter/*.test.ts \
             test/integration/cli/migrate-legacy.test.ts
# 78 pass, 0 fail, 1 skipped (PI_SMOKE, still gated and untouched)

pnpm test -- $(find test -name '*.test.ts')   # whole repo
# 1272 tests, 1271 pass, 0 fail, 1 skipped

pnpm typecheck   # clean for my files
pnpm lint        # clean for my files
pnpm build       # clean
```

New test files:

- `test/unit/pi-adapter/provider-retry.test.ts` (21 assertions-heavy cases) —
  classification from objects and from flattened strings, nested SDK shapes,
  401/403 refusal including hint-override refusal, Retry-After in four
  encodings, remedy_hint string/structured/embedded, backoff growth, jitter
  bound, the 8s cap, the attempt cap, the over-cap refusal, abort-aware sleep.
- `test/unit/pi-adapter/executor-retry.test.ts` (10 cases) — the required
  faux-provider test: scripted 429 → success through `execute()`, asserting the
  provider really was called twice, that the failed attempt's transcript does
  not leak, `attempt: 2`, `callOutcome: "ok"`. Plus Retry-After and remedy_hint
  honored, attempt cap, 401 not retried, 503 retried, 504 → `timeout`, clean
  first call, cancellation → `cancelled`, and the two usage-integrity cases.
  No network and no real timers: `retry.sleep` is injected and the requested
  delay is asserted rather than slept.
- `test/unit/telemetry/usage-aggregate.test.ts` (10 cases) — including the
  exact on-disk shape the report found (a zeroed 429 next to one real call),
  `undefined`-not-zero totals, a genuine zero from a completed call, and
  legacy records counted apart from known failures.
- `test/unit/cli/migrate-legacy.test.ts` (11 cases) — plane routing for all six
  fixture files, plane-crossing negative assertions, dry run writes nothing,
  sources survive apply, idempotence, corrupt-middle-line refusal (with nothing
  copied), truncated-tail tolerance, conflict never overwritten, and the
  headline check: `readFeedback` returns `[]` before and the record after.
- `test/integration/cli/migrate-legacy.test.ts` (2 cases) — through `main()`:
  a real `EventStore` reads a migrated legacy run, and the usage line is present.

## Residual risks

1. **`sumUsage` is not wired into cost calibration.**
   `src/routing/cost-calibration.ts` still aggregates every invocation,
   including failed ones, so the §1.2 skew persists at the calibration layer
   until someone routes `loadInvocationsFromStateRoot` through
   `costEligibleInvocations`. `src/routing/**` is outside my write paths, so I
   deliberately did not touch it. **This is the highest-value follow-up.** The
   change is one call site, but note it will exclude *all* pre-existing records
   (none have `callOutcome`), so whoever does it should decide whether legacy
   rows get an opt-in via `isUnattributed`.
2. **Status inference from message text is heuristic.** A message containing
   something like `code: 500` that is not an HTTP status would cost up to two
   extra attempts. Bounded and short (≤ 8s total), and the failure mode is
   extra patience rather than a wrong answer, but it is inference.
3. **The retry is per-`execute()`, not per-turn.** A 429 on the fifth turn of a
   long tool-using conversation restarts that `execute()` call from a fresh
   agent, discarding the partial transcript. Correct and safe, but it re-pays
   the earlier turns' cost. Per-turn retry would need a hook inside `streamFn`
   or pi's own `retryAssistantCall`; that is a larger change than this round.
4. **`maxRetryAfterMs = 30s` is a judgement call**, not a measured value. The
   observed pool took ~20 minutes to recover, which no executor-level retry can
   absorb — that case still needs supervisor-level rescheduling.
5. **No live-provider evidence.** Every retry test uses the faux provider. The
   real 429 message shape is inferred from pi's `formatProviderError` source,
   not from a captured 429 body. The next real 429 should be captured and
   pinned as a fixture.
6. **`migrate-legacy` migrates the four sources named in the task only**
   (feedback, runs, episodes, invocations). Other legacy top-level files — e.g.
   a flat `preferences.json`, which the current code reads from
   `adaptationRoot` — are left alone rather than guessed at.

## Blocked / handoff

- Nothing blocked me.
- **Handoff 1 (routing owner):** wire `costEligibleInvocations` into
  `src/routing/cost-calibration.ts`. See residual risk 1 for the legacy-record
  decision that comes with it.
- **Handoff 2 (docs owner):** `README` and the status matrix are outside my
  paths and do not yet mention `migrate-legacy`; the report's §2.2 candidate is
  now implemented and can be marked so.
- **Handoff 3 (whoever holds `package.json`):** `pnpm test -- <dir>` is broken
  in this checkout, which is what the round's own test command uses. Either the
  `test` script needs a glob-capable form or the documented invocation should
  name files.
- **Note for the merger:** `pnpm typecheck` and `pnpm lint` currently fail on
  `test/unit/feedback/redaction.test.ts` (`STORE_POLICY` undefined,
  `GATE_POLICY` unused) from a concurrent agent's in-progress edit. Not mine and
  not in my paths; my files are clean under both.
