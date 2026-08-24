# Round 3 opus-1
MODEL_SLUG: claude-opus-5-thinking-high-fast

No git operations performed (no commit, no branch change, no push).

## Task 1 — persisted redaction classes on `FeedbackRecord`

The Round 2 finding was that `redacted: true` only means "the PII pass ran" and
that `RedactionDecision.classes` was computed and then thrown away at
`appendFeedback`. The class list is now part of the record and survives to disk.

### `src/feedback/types.ts`

- `REDACTION_CLASSES` (the closed vocabulary, in canonical order) and
  `isRedactionClass` now live here, next to the record they describe, because
  the store validates persisted rows against them. `redaction.ts` imports the
  const and re-exports the `RedactionClass` type, so its public API is
  unchanged for every existing importer. This matches house style
  (`src/evaluation/types.ts`, `src/tracking/types.ts` already hold const
  vocabularies plus guards).
- New optional `readonly redactionClasses?: readonly RedactionClass[]` on
  `FeedbackRecord`, documented with the three states that matter:
  `undefined` = unknown (row predates the field), a list without `secret` =
  the pass ran and found no secret (`["pii"]` is the store's shape for that),
  a list containing a class = that class was found and removed.

### `src/feedback/redaction.ts`

- `redactFeedback` stamps the classes onto the record it returns.
  `decision.classes` still describes **this pass** (existing assertions such as
  `deepEqual(decision.classes, ["secret","pii","path"])` are untouched);
  `feedback.redactionClasses` describes **the record as it now stands**, i.e.
  the union of what earlier passes recorded and what this pass matched. That
  makes re-redacting a stored record non-destructive: a record that once had a
  secret stripped does not forget it because a later no-op pass ran over it.
- One deliberate subtraction in the union: `oversized` asserts the body was
  dropped, so it is removed if the outgoing record still has a body. Readers
  use that class as authority to refuse a body, so a record may not carry both.
- `CLASS_ORDER` deleted in favour of `REDACTION_CLASSES` (it was a duplicate of
  the same list).

### `src/feedback/store.ts`

- The store policy is now exported as `FEEDBACK_REDACTION_POLICY`
  (`as const satisfies RedactionPolicy`), so tests can reproduce the decision a
  record went through instead of hard-coding what its class list "should" be.
  `appendFeedback` persists the redacted record whole, classes included.
- Reads are validated rather than trusted, in `loadFeedbackRow`:
  - a non-feedback-shaped row is skipped, exactly as before;
  - `redactionClasses` absent → the row loads unchanged (old JSONL stays
    valid, and the field stays absent rather than being defaulted to `[]`,
    because "unknown" and "nothing matched" are different claims);
  - `redactionClasses` present but not an array of known classes → the whole
    read fails with `DomainValidationError` (fail closed: an unrecognised
    class means we cannot tell what was removed from that record). The
    offending value is truncated to 32 chars in the message, since it lands in
    logs;
  - a row whose class list says `oversized` never hands a body back, whoever
    wrote it — this is the "readers must not resurrect stripped body" rule,
    enforced on read rather than assumed from the writer;
  - unknown *other* properties are preserved, because the episode-deletion
    cascade reads records and writes them back whole and must not silently
    truncate a forward-version log.
- Both `readFeedback` and `readFeedbackRecordsRaw` (the deletion engine's
  unfiltered reader) go through the same path, so the export/deletion side
  cannot see a shape the normal reader rejects.

There is no equivalent guard for `summary` because no class means "summary
dropped": summary is only ever removed by the episode-deletion cascade, which
tombstones the id, and the tombstone filter in `readFeedback` is what keeps it
out. That is unchanged from before this round.

### Tests

`test/unit/feedback/store.test.ts` (new, 9 tests). Rows that model a *foreign*
writer (older code, future code, a bad rewrite) are hand-written into the JSONL
so the tests are not limited to shapes this version produces:

- append persists exactly the classes the decision reported, on disk and in the
  return value (the expectation is derived from `redactFeedback(record,
  FEEDBACK_REDACTION_POLICY).decision.classes`, so the two cannot drift);
- classes round-trip in canonical order through both readers;
- **the distinguishability case**: `redacted` is `true` for both a clean record
  and one that carried a key; `["pii"]` vs `["secret","pii"]` separates them,
  and a foreign row that wrote `redacted: true, redactionClasses: []` loads as
  `[]` and is likewise distinguishable from a secret match;
- a pre-field row loads with body/summary intact and `redactionClasses`
  absent (asserted with `"redactionClasses" in record === false`);
- unknown class string and malformed field (`"secret"`, `[1]`) each fail the
  read closed, through `readFeedback` and `readFeedbackRecordsRaw`;
- a row claiming `oversized` plus a body yields no body (summary survives,
  since `oversized` only ever drops the body);
- an oversized append drops the body, records the class, and re-appending the
  reloaded record does not resurrect one;
- forward-version extra fields survive a read.

`test/unit/feedback/redaction.test.ts` gained 5 tests: record classes match the
decision; a no-op pass returns the input identity and leaves prior classes
alone; a second pass unions instead of overwriting; `oversized` is not claimed
by a record that still has a body (both directions).

`test/integration/m3/redaction.test.ts` now asserts the on-disk line and the
reloaded record carry `["secret","pii","path"]`, next to the existing
"no raw values on disk" assertions.

## Task 2 — `auth-session` unit tests (`test/unit/pi-adapter/auth-session.test.ts`, new, 13 tests)

Offline by construction: the only Pi flow exercised is `api_key` login, which
prompts and writes the credential store with no network call (verified against
the real `@earendil-works/pi-ai` build). The OAuth flow is deliberately **not**
covered — I probed it and it performs a real token exchange against
`platform.claude.com`, so it belongs in a live smoke test.

Coverage: store round-trip and metadata-only listing; two providers not
disturbing each other; delete removing one provider, being idempotent on a
missing one, and creating no `auth.json` on an empty state root; blank provider
id / blank key refused with nothing written; `isKnownProvider` false for an
unknown id (with and without custom providers) and agreeing with
`listBuiltinProviderIds`; login to an unknown provider rejecting **before any
prompt** and writing nothing; an api-key login prompting exactly once through
the injected reader and never echoing the key; `checkProviderAuth` reporting
`{type, source}` for an env-configured provider without the value and returning
`undefined` (not a fabricated status) for unknown/unconfigured ones; the select
prompt rendering options, resolving to an option id, and failing closed on
`"3"`, `"0"`, `"-1"`, `"yes"`, `""`; two consecutive prompts on one interaction;
`notify` rendering all four event kinds without printing `undefined`.

No secret is printed by the tests, and the fake key is asserted *against* every
string the module produces (`stdout`, prompt text, `list()`, `checkAuth`).
The env-var tests clear all three variables Pi consults for anthropic
(`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`) and
restore them, so a machine that already exports one cannot change the result.

### Hardening in `src/pi-adapter/auth-session.ts` (kept minimal, signatures unchanged)

1. `SparkleAuthIo` gains an optional `question(prompt): Promise<string>`.
   `src/cli/auth.ts` passes its own `AuthIo`, which is still structurally
   assignable, so the CLI is untouched (I did not edit `src/cli/main.ts` or
   `src/cli/auth.ts`).
2. The readline interface is created **lazily, per prompt**, instead of eagerly
   per interaction. This fixes a real defect: the old code opened one interface
   in `cliAuthInteraction` and closed it in the `finally` of the first prompt,
   so any two-step login (select an auth method, then enter the key) asked its
   second question on a closed stream. It also means an OAuth flow that never
   prompts no longer grabs stdin.
3. `cliAuthInteraction` is exported, since the prompt/notify paths are
   otherwise only reachable through a real stdin.
4. Fail-closed input validation: blank provider id (`storeApiKeyCredential`,
   `deleteStoredCredential`, `loginProviderInteractive`) and blank api key.
   An empty key is worse than no credential — the stored entry wins over the
   provider's ambient sources, so writing one silently disables a working
   environment variable and fails later, at request time.

## Verification

Node v22.22.2, `pnpm test` = `node scripts/run-tests.mjs`.

- `pnpm test -- test/unit/feedback test/unit/pi-adapter test/integration/m3` →
  **140 pass, 0 fail**.
- `pnpm test -- test/unit` → **1158 pass, 0 fail**.
- `pnpm test -- test/integration test/acceptance test/smoke.test.ts` →
  **202 pass, 0 fail, 1 skipped** (the skip is pre-existing).
- `pnpm typecheck` → clean repo-wide.
- `pnpm lint` on `src/feedback`, `src/pi-adapter`, `test/unit/feedback`,
  `test/unit/pi-adapter`, `test/integration/m3/redaction.test.ts` → clean.
- Release gate compatibility: built `tsconfig.build.json` to a scratch outDir
  and loaded `feedback/redaction.js` the way `scripts/security-probe.mjs` does.
  `redactFeedback` behaves identically (`"key [secret] mail [email]"`) and the
  new runtime import resolves, because `tsc` emits `dist/feedback/types.js`.

**Negative cases run, not assumed.** Each guard was broken on purpose and the
suite re-run, then reverted (`pnpm typecheck` clean afterwards):

| Mutation | Result |
|---|---|
| drop the `oversized`→no-body rule on read | 1 fail ("a row claiming the body was dropped never hands one back") |
| accept unknown classes instead of throwing | 2 fail (unknown class, malformed field) |
| stop stamping classes onto the redacted record | 8 fail across unit + m3 integration |
| remove the auth blank-id/blank-key validation | 2 fail (blank refused; unknown-provider login writes nothing) |

## Residual risks / honest limits

- The lazy-readline fix (hardening item 2) is **not** directly test-covered: the
  tests inject `io.question`, so they never construct a readline interface. What
  they pin is that one interaction can serve two consecutive prompts; the
  stdin-backed path still needs a TTY to exercise, and there is no such test in
  this repo.
- OAuth login is untested here for the reason above (network). `notify`
  rendering of `auth_url`/`device_code` is covered directly, but the flow that
  emits them is not.
- `redactionClasses` is a union across passes while `decision.classes` is
  per-pass. That split is intentional and documented in both places, but a
  caller that assumes `record.redactionClasses === decision.classes` after
  re-redacting an already-redacted record will be wrong.
- The reader drops a body from any row that claims `oversized`. For rows this
  version wrote that can never fire; for a contradictory row it is a one-way
  loss if the deletion cascade then rewrites the log. That is the intended
  direction (privacy over recovery), but it is a real data-loss path.
- `prompt-injection` remains unimplemented, as instructed. The existing test
  that pins "no rule emits it, and prompt review text is preserved verbatim" is
  unchanged, and the class stays in the vocabulary so the persisted shape does
  not have to change if a high-precision detector ever lands.
- `isFeedbackRecord` is still the loose shape check it always was (id/episodeId/
  kind/score), so a row missing `createdAt` still loads. I did not tighten it:
  that would change which historical rows are readable, which is a migration
  decision, not a redaction one.

## Handoff

- **opus-2 (`src/privacy/deletion.ts`)**: the cascade's read-modify-write path
  (`readFeedbackRecordsRaw` → `writeFeedbackRecords`) now goes through the
  validating reader. Two consequences: a log containing an unknown redaction
  class makes the cascade fail closed instead of rewriting, and a
  contradictory `oversized`-plus-body row loses its body permanently on the
  next rewrite. `stripFreeText` needs no change — the class list describes
  redaction, not deletion, and the tombstone is what covers a deleted record.
- **fable-2 (`docs/data-dictionary.md`)**: the `feedback` record class has a new
  optional field, `redactionClasses` (closed vocabulary, not sensitive). No
  `migrationVersion` bump: old rows without the field remain valid and are read
  as "unknown", which is test-pinned. `src/privacy/record-classes.ts` line for
  `feedback` is still accurate as written; if it is being rewritten anyway, the
  honest sentence is that the record now records *which* classes were removed,
  not just that redaction ran.
- **Whoever owns `src/cli/auth.ts` next**: it can now pass a `question`
  implementation in its `AuthIo` if the CLI ever needs a non-TTY login path
  (piped key, embedded host). Nothing requires it today.
