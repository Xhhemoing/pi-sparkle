# Loop 5 Round 4 — GPT D16 landing challenge

## Verdict: KEEP

Audited `4332f0f35c3f149d4444961c0792109d81d0da4a` after fetching
`origin/cursor/pi-sparkle-sota-opt-0da8`. D16 does what its operator-facing
claims say, preserves the frozen surfaces and D12 behavior, and has no blocking
leak, false local-auth result, custom-provider miss, or isolation break.

## 1. F5 secret mute

- The real-stdin secret branch bypasses the ordinary readline path and creates
  readline with a muting `Writable`. `rl.question(message, ...)` writes the
  prompt synchronously before `output.mute()` runs, so the question remains
  visible while subsequent readline rendering is swallowed.
- The injected `io.question` branch returns before any muting code. The comment
  is honest: an injected reader owns its own echo policy, and the module cannot
  control it.
- PTY probes passed with delayed, character-by-character input:
  - `TERM=xterm`: the prompt was visible (with readline cursor-control bytes),
    the 21-character marker was absent, and `AFTER:21` appeared on the next
    line.
  - `TERM=dumb`: the plain prompt was visible, the 20-character marker was
    absent, and `AFTER:20` appeared on the next line.
  - In both cases the submitted newline was hidden and the explicit newline in
    `finally` kept following output off the prompt line.
- A PTY EOF probe rejected with
  `stdin closed before the prompt was answered`. The real CLI with
  `</dev/null` also settled promptly: exit 1 with the structured validation
  error, rather than the former exit-13/unsettled-await behavior.
- The typed value is returned to Pi for intentional credential-store
  persistence, but is not sent to stdout/stderr or a debug/logger path.
  Relevant tests use a conspicuous fake key and assert it is absent from
  rendered strings; there are no secret-output snapshots.

## 2. F11 doctor `auth`

- This is frozen-additive: `auth` is immediately after `providers`; every check
  still has exactly `name`/`ok`/`detail`; the exact ordered check-name pin was
  updated; the five `DOCTOR_ROUTED_NEXT` routes and generic route text are
  unchanged.
- The checked set is the deduplicated provider portion of `primary`, `fast`,
  and all `enabled` model refs. Each call receives the configured custom
  providers.
- Production detail construction receives only Pi's auth `type` and source
  label. Pi 0.84.3 returns labels such as `stored credential`, `OAuth`, or an
  environment-variable name; the credential value is not part of
  `SparkleAuthCheck`. Real env-backed coverage confirms
  `ANTHROPIC_API_KEY` is printed while its value is absent in both JSON and
  prose.
- Nothing configured returns ok and explicitly says the fake executor needs no
  credentials. An unreadable `providers.json` fails `providers` once while
  `auth` reports a successful skip pointing back to that failure.
- The real env-key test uses the shipped `checkProviderAuth`, so the doctor
  result agrees with runtime source resolution rather than only an injected
  fake.
- The new tests are hermetic and Windows-portable: temp roots, `join`, and
  environment save/restore are used; multi-provider tests use the injected
  resolver seam and no network.
- `runDoctorJson` remains host-engine-aware. New success-at-check-level cases do
  not require overall code 0 on an older host. This audit ran on Node
  `v22.14.0`, below `engines.node >=22.19.0`; the expected engine warning was
  present.
- Scope is local credential resolution, not an online proof that a provider
  will accept a key. That matches the prescribed `checkProviderAuth` building
  block and the missing-credential failure D16 claims to move into preflight.

## 3. F8 `models list --available`

- The builtin catalog is collected first and custom models are appended in
  configured provider/model order.
- `--provider` filters both halves. Configured `local/m1` and `local/m2` are
  shown for `--provider local`; an unknown provider alone still prints
  `(no models)`.
- Plain `models list` does not enter the available-catalog branch and remains
  enabled-only. The test enables `local/m1` and gets exactly `local/m1`.

## 4. Freeze and isolation

- The D16 merge changes only:
  `src/pi-adapter/auth-session.ts`, `src/cli/doctor.ts`,
  `src/cli/models.ts`, and their three unit-test files.
- No D16 edit to `main.ts`, `auth.ts`, `runtime.ts`, `package.json`, or README;
  `package.json` remains `"private": true`.
- `INSPECT_SUMMARY` remains the exact four-key view and outside `EVENT_TYPES`.
  `RunStatus` remains the same eight members. No Event type was added.
- D12 `--from-env`/corrupt-store pins pass unchanged.
- The literal one-line dynamic import of `listed-model.js` is visible to the
  closure walker; its computed-import and adaptation-closure checks pass.

## 5. Verification

- Focused D16, D12, plane-closure, doctor-route, RunStatus, Event/summary tests:
  **90/90 passed**.
- `pnpm typecheck`: passed.
- PTY probes: xterm pass, dumb pass, EOF rejection pass.
- Real CLI `</dev/null` probe: prompt visible, structured exit 1, no hang.

No fix or hold condition was found.
