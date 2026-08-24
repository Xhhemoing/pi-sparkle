# Round 1 opus-1
MODEL_SLUG: claude-opus-5-thinking-high-fast

## Implemented

### Task A — real redaction (`src/feedback/redaction.ts`)

`redactPII` now transforms text instead of only labelling the record. New
`redactSensitiveText(text)` runs three passes over both `body` and `summary` and
reports which classes actually matched; `REDACTION_PLACEHOLDER` exports the
stable placeholder set (`[secret] [path] [email] [ipv4] [phone] [card]`).

- **secret**: PEM `BEGIN … PRIVATE KEY` blocks including the base64 body
  (terminated or not); `Bearer` tokens (scheme preserved, credential gone);
  vendor key shapes `sk-*` (covers `sk-proj-`/`sk-ant-`/`sk-or-v1-`),
  `github_pat_`, `ghp_`/`gho_`/…, `AKIA…`, `xox[abposr]-`, `AIza…`, JWTs;
  quoted and unquoted assignments for `api_key|apikey|secret|token|
  access_token|auth_token|refresh_token|client_secret|private_key|password|
  passwd|pwd` (the key name and quotes survive, the value does not).
- **pii**: emails, IPv4, E.164-ish phones, CN 11-digit mobiles, and 13–19 digit
  cards with separators, gated on Luhn **and** a major issuer range.
- **path**: `/home`, `/Users`, `/root`, `~` paths (including spaced ones such as
  `…/Library/Application Support/pi/auth.json`), any `.ssh` directory, Windows
  `Users\…` profiles with or without a drive letter, and Windows UNC shares.
- **prompt-injection**: deliberately not implemented. The file carries the
  reasoning (cheap signatures mangle ordinary review feedback about prompts, and
  a stored feedback body is never executed as a prompt), and a unit test pins the
  current behaviour: text preserved, class never emitted.

Ordering change that makes the gate pass: the value-removing transforms now run
**before** the `forbiddenSubstrings` strip. The strip deletes markers like `sk-`
in place, and a detector that has lost its prefix can no longer recognise the key
body behind it — that is exactly the `sk-proj-abcdefghijklmnop1234567890` case.
Longest-first strip, oversized → omit body + `referenceOnly`, and the class
semantics are otherwise unchanged: `pii` still means "the PII pass ran" (so
`applyRedaction(record, { redactPII: true }).redacted === true` for an empty
record), while `secret`/`path` are added only on a real match.

Because the transforms shrink text, the size check now runs last: a body that
redaction brings under `maxBodyChars` is kept rather than dropped.

**ReDoS hardening.** The first working version was quadratic on hostile bodies
(24KB of `aaa…@b.b.b.` took 1.2s; 32KB of `/a/a/a…` took 4.5s). Three fixes, each
commented at the pattern: the email TLD is validated in code instead of as an
ambiguous trailing group and the pattern got a left lookbehind guard; `/` is
excluded from posix path segments so `(?:/segment)+` has one parse; the `.ssh`
prefix is bounded (≤12 segments, ≤64 chars each) instead of open-ended. Worst
case is now ~5ms at 32K chars, and a unit test pins a 2s budget over six hostile
shapes (~400x the observed cost, so it fails on a regression in kind, not on
timing noise).

### Task B — doctor `--json` + `legacy-layout`

- `DoctorJsonReport` in `src/cli/doctor.ts` is the frozen contract:
  `{ version, preview: true, liveAdaptive: false, ok, checks: [{name, ok,
  detail}], next: string[] }`. `--json` writes exactly one JSON object to stdout
  and nothing else; default prose output is byte-for-byte what it was, plus the
  new check line.
- Failures still go through `cliFail`, so stdout stays purely the contract while
  the operator-facing report goes to stderr and the exit code is unchanged
  (`ok ? 0 : 1`). In JSON mode `next[0]` becomes
  `fix the failing entries in checks[], then re-run pi-sparkle doctor`, since a
  JSON consumer never sees the stderr prose.
- New informational `legacy-layout` check (`src/cli/doctor-overlay.ts`,
  `legacyLayoutCheck`): flags `<stateRoot>/feedback/records.jsonl` and a flat
  `<stateRoot>/runs/` directory, names the plane-aware path each one belongs at,
  and warns they are invisible to plane-aware code. Always `ok: true` — an old
  directory next to a working one must not block anyone's preflight. Detection
  only; no migration (opus-2 owns that). It ignores the plane-aware layout and
  only flags `runs` when it is really a directory.

## Tests (commands + results)

Node v22.22.2 (the nvm toolchain; `/exec-daemon/node` on the default PATH is
v22.14.0 and fails the engines check — see risks).

- `pnpm test -- "test/unit/feedback/*.test.ts" "test/unit/privacy/redaction.test.ts" "test/integration/m3/redaction.test.ts" "test/unit/cli/doctor.test.ts" "test/unit/cli/doctor-overlay.test.ts"` → **PASS, 58/58**.
- `pnpm test` (full suite) → **PASS, 1282/1283, 0 fail, 1 pre-existing skip**.
- `pnpm typecheck` → **PASS**.
- `pnpm build && node scripts/security-probe.mjs` → **`"status": "ok"`, 14 passed,
  0 open findings, 0 waivers** (exit 0). This is the real prerelease gate against
  `dist/`, including the `macos-path`, `windows-unc-path`, `bearer-token-body`
  and `pem-private-key-body` samples a sibling slot added mid-session.
- ESLint over the owned files → **clean**. (Repo-wide `pnpm lint` reports 7
  pre-existing unused-symbol errors in `src/pi-adapter/pi-executor.ts`, which is
  not mine to touch.)

The literal command in the brief, `pnpm test -- test/unit/feedback`, cannot work
in this repo: `tsx --test` cannot take a directory and fails with
`ERR_UNSUPPORTED_DIR_IMPORT` before loading anything. It fails identically for
untouched directories (`pnpm test -- test/unit/domain`) on both Node v22.14.0 and
v22.22.2, so it is a pre-existing script limitation, not a regression. The glob
form above runs the intended files.

New coverage: 26 redaction tests (one per release-gate core with the exact
expected output, PEM terminated and unterminated, Bearer, vendor key shapes,
quoted assignments, spaced/UNC/relative paths, card Luhn+issuer gating,
idempotence, prose left untouched, class reporting, the hostile-input budget),
2 privacy tests (values gone, not just labelled; nothing raw survives
`JSON.stringify` of the redacted copy), 2 integration tests (the m3 pipeline now
pins the redacted summary, plus a new end-to-end test that appends through the
feedback store and greps the on-disk JSONL for every raw value), 5 doctor tests
and 4 overlay tests.

## Residual risks

- **Known over-redaction, accepted and pinned by tests**: a slashed word right
  after a path reads as a continuation, so `/home/j/a.txt and/or the log`
  becomes `[path] the log`. A dotted-quad version string (`1.2.3.4`) is redacted
  as `[ipv4]`, because it is a valid IPv4 and the class is privacy-first.
- **Known under-redaction**: cards need Luhn *and* a major issuer prefix, so a
  mistyped or exotic 16-digit card survives. That gate is what keeps 13-digit
  epoch milliseconds and ticket ids out of the card class; loosening it trades a
  rare leak for frequent mangling of ordinary numbers.
- The `pii` class is still added whenever the policy flag is on, so
  `classes.includes("pii")` does not mean PII was found. Callers that want
  "something was actually stripped" should look at `secret`/`path` or compare
  the text. Kept for compatibility with the existing decision contract.
- Redaction only covers `body` and `summary`. Free text that reaches disk
  through other fields or other stores is out of this file's reach.
- The `legacy-layout` check is `existsSync`-based and does not read the files,
  so it cannot tell a real pre-plane log from an empty placeholder.
- The environment's default `node` is v22.14.0, below the `>=22.19.0` engines
  floor, so the `node` doctor check fails there and the pre-existing test
  `doctor reports developer preview and fake-executor next steps` fails with it.
  It passes on v22.22.2. I deliberately did not weaken that assertion; my own
  `--json` tests never assume the host passes every check — they assert `ok`
  against the checks themselves and against the exit code.

## Blocked / handoff

- Nothing blocked. All work landed inside the exclusive write paths; no commit,
  push, or branch operation was performed.
- **opus-2 (migrate)**: `legacyLayoutCheck` in `src/cli/doctor-overlay.ts` is the
  detector, exported and unit-tested. `LEGACY_STATE_ENTRIES` already maps each
  legacy path to its plane-aware destination via `runtimeRoot`/`adaptationRoot`,
  so a migrate command can drive off that list instead of re-deriving it. The
  check intentionally stays `ok: true`; if migrate should ever fail the
  preflight, that is a policy change to make there, not here.
- **Whoever owns `src/feedback/store.ts`**: its `REDACTION.forbiddenSubstrings`
  is still `["sk-", "api_key", "API_KEY", "BEGIN PRIVATE"]` while the gate policy
  now also seeds `"Bearer"`. Not a leak (the scheme name is not a secret, and the
  token is removed by shape either way), but the two lists have drifted.
- **Docs**: the `--json` contract and the `legacy-layout` check are not mentioned
  in `README.md` or the CLI usage string in `src/cli/main.ts`, both outside my
  write paths.
