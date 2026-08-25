# Loop 5 Round 2 — Fable-auth-models: credential & model-catalog operator UX audit

Slot: Fable-auth-models (claude-fable-5). Analysis only; no `src/` edits, no commit.
Base: `cursor/pi-sparkle-sota-opt-0da8` @ `29e0068`, working tree clean apart from sibling
`.agent_workspace` reports. This is the audit Round 1's review §4 named as uncovered:
"`src/pi-adapter/` + `auth`/`models` UX depth — no audit of the login/enable/set-default
operator flow, `--from-env`/`--oauth` docs, or failure modes."

Method: code read of `src/cli/auth.ts`, `src/cli/models.ts`, `src/pi-adapter/auth-session.ts`,
`file-credential-store.ts`, `runtime.ts`, `listed-model.ts`, `src/config/providers-config.ts`,
`model-ref.ts`, the pinned `@earendil-works/pi-ai@0.84.3` auth internals
(`dist/auth/resolve.js`, `dist/auth/helpers.js`, `dist/models.js`, `dist/env-api-keys.js`),
plus **live CLI probes** against a throwaway `--state-root` (`/tmp/auth-audit-sr`) via
`pnpm cli`. Every "verified live" below was actually run; the probe transcript is in §6.

Out of scope by brief: any change to frozen JSON contracts; the two-error-dialect
unification (already tracked as Fable-cli G4); PR #12 collision surfaces.

---

## 1. Surface inventory

| Verb | Impl | Delegates to | Notes |
|---|---|---|---|
| `auth status [--all]` | `auth.ts:64-91` | `listStoredCredentials`, `checkProviderAuth` per provider | `--all` adds env-configured builtin + custom providers, one `checkAuth` each (~0.85s wall for ~30 providers — fine) |
| `auth login <p> [--key\|--from-env\|--oauth]` | `auth.ts:93-134` | `storeApiKeyCredential` / `checkProviderAuth` / `loginProviderInteractive` → `models.login` | provider gated by `isKnownProvider` (builtin ∪ custom) before anything runs |
| `auth logout <p>` | `auth.ts:136-149` | `FileCredentialStore.delete` | idempotent; **not** gated by `isKnownProvider` |
| `models list [--available] [--provider]` | `models.ts:61-95` | `listSparkleModels` (builtin only) / `loadProvidersConfig` | plain list marks `primary`/`fast` |
| `models enable/disable <p/m>` | `models.ts:97-127` | `enableModel`/`disableModel` + `assertKnownCatalogId` (enable only) | disable is validation-free by design |
| `models set-default --primary [--fast]` | `models.ts:129-155` | `setDefaultModels` (auto-enables both ids) | both ids catalog-checked first |

Auth truth model (pi-ai `dist/auth/resolve.js`): **a stored credential owns the provider;
ambient env is consulted only when nothing is stored**. The store is
`<state-root>/runtime/auth.json`, one credential per provider, file-locked, atomic-write,
chmod 0600 after publish. `checkAuth` reports `{type, source}` and never a secret. The
CLI's headline claim "stored credentials win over env" is accurate against the pin.

---

## 2. Findings (ranked)

### F1 — `--from-env` is not an env check; its failure message misdescribes its own logic. Verified live. **Highest-value fix.**

`auth login <p> --from-env` (`auth.ts:117-124`) calls `checkProviderAuth`, which is pi's
`models.checkAuth` — and that check reads the **credential store first** (`models.js:244-253`
→ `resolve.js`: stored-first). Three consequences, all confirmed live:

- With **no env var and no store**: fails `provider openai is not configured in the
  environment` — the only case where the wording is right.
- With **only a stored credential** (no env var anywhere): exits 0 with
  `openai configured via stored credential (not written to auth.json)`. A flag named
  `--from-env` reported success off auth.json. The parenthetical "(not written to
  auth.json)" is then actively confusing — the source it just named *is* auth.json.
- With a **keyless custom provider** (no `envVar` in providers.json): always exits 0 with
  `local configured via local (no key) (not written to auth.json)` — `--from-env` is
  unconditionally true for keyless customs because `runtime.ts:95-98` resolves them as
  configured-with-no-key.

The flag's real semantics are "assert this provider resolves auth from *any* source, store
untouched". Either rename the concept in the message (`configured via <source>` is already
printed — keep it, fix the error text and usage line), or make it env-only by checking
`check.source` against a stored-credential sentinel. Small `auth.ts`-only diff either way.

### F2 — Login-mode flags are not mutually exclusive; conflicts resolve silently, and a conflicting `--key` is silently **not stored**. Verified live.

`AUTH_USAGE` says `[--key <key> | --from-env | --oauth]` (exclusive-or). The code
(`auth.ts:117-133`) implements silent precedence **from-env > key > oauth**:

- `auth login openai --key sk-NEW --oauth --from-env` → exit 0,
  `openai configured via stored credential (not written to auth.json)`. The operator who
  meant to rotate a key believes they logged in; the **old** stored key still owns the
  provider. This is the dangerous case: success exit + no write.
- `--key x --oauth` → key stored, `--oauth` ignored without a word.

One `DomainValidationError("choose one of --key, --from-env, --oauth")` when more than one
is set closes this. ~5 lines.

### F3 — Both docs lie about where auth.json lives. Code-verified + live-verified.

- `README.md:93`: "writes `~/.pi-sparkle/auth.json`".
- `AUTH_USAGE` (`auth.ts:28`): "Stored credentials live in `<state-root>/auth.json`".
- Reality: `authStorePath` = `join(runtimeRoot(stateRoot), "auth.json")` =
  `<state-root>/runtime/auth.json` (`file-credential-store.ts:15-17`,
  `state-layout.ts:23-25`), and the login success message prints the real path —
  so `auth login` **contradicts its own `--help` two lines apart**. An operator following
  the README to hand-audit or delete the credential file looks in the wrong directory; the
  data-dictionary (`docs/data-dictionary.md:74`) has it right. Two one-line doc fixes.

### F4 — A corrupt auth.json is an operator dead end: even `logout` refuses. Verified live.

`FileCredentialStore.load` throws `invalid auth.json at <path>` on unparseable JSON
(`file-credential-store.ts:69-74`), and **every** verb goes through `load`, including
`delete` (`:54-61`, load-before-delete). So after corruption: `auth status`, `auth login`,
`auth logout` all fail with the same message, and the natural remedy — log out and back in —
is unavailable. The `next:` line is the generic "fix the reported error…". Nothing tells the
operator the file is safe to delete (it holds only credentials they can re-enter). Fix is a
targeted `next:` ("delete <path> and re-run auth login") or a `logout --force` that
tolerates a corrupt store. Note the error already carries the path, so the routed-next fix
is string-only.

### F5 — `secret` prompts are echoed to the terminal while typed; the module doc overclaims. Code-verified.

`cliAuthInteraction` (`auth-session.ts:107-133`) handles `prompt.type === "select"`
specially and funnels **everything else — including `type: "secret"` — through a plain
`readline.question` with `output: process.stdout`**. Node's readline echoes keystrokes on a
TTY: the pasted API key is displayed on screen and lands in terminal scrollback. The header
comment "Never echoes what the user typed — the answer to a `secret` prompt goes straight
back to Pi, not to `io.stdout`" is true only in the narrow re-print sense; there is no
input muting at all. The unit tests can't see this because their injected `question` never
touches a TTY. Compounding it, `README.md:93` recommends the *other* leaky path —
`auth login openai --key sk-...` puts the secret in shell history and process listings —
while the clean path that exists today (pipe the key on stdin:
`printf '%s\n' "$KEY" | pi-sparkle auth login openai`, verified working live) is documented
nowhere. Minimum fix: mute echo for `secret` prompts (readline output-muting is ~15 lines,
no new deps) and add the stdin-pipe example to README/usage with a history caveat on `--key`.

### F6 — Keyless custom providers accept and store credentials that are never sent. Verified live + code.

For a custom provider without `envVar`, `runtime.ts:95-98` builds an auth whose `resolve`
**ignores the credential argument** and returns `{auth: {}, source: "<id> (no key)"}`.
Consequences:

- `auth login local --key sk-dead` → exit 0, `Stored api_key credential for local in
  …/runtime/auth.json` — a secret now sits on disk that the request path will never send.
  Silent no-op credential, worst kind of "it worked".
- `auth login local` (interactive) → `local does not support api_key login` — technically
  right (the fallback auth has no `login`), but reads like a bug, and is inconsistent with
  `--key` being accepted one flag away.

Guard both in `auth.ts`/`auth-session.ts`: a custom provider without `envVar` should refuse
`--key` and interactive login with "provider <id> is keyless (no envVar configured);
nothing to store". (Custom providers *with* `envVar` behave correctly end-to-end —
verified: prompt, store, stored-wins resolution via pi's `envApiKeyAuth`.)

### F7 — `--oauth` capability is undiscoverable; the README never mentions `--from-env`/`--oauth` at all.

OAuth-capable providers in the pinned catalog: **anthropic, openai-codex, github-copilot,
openrouter, xai, kimi-coding, radius** (grep of `dist/providers/*.js`). No CLI surface
lists this; discovery is try-and-fail (`Groq does not support oauth login`, verified live —
decent message, generic `next:`). Two traps worth documenting: (a) ChatGPT-plan OAuth lives
on provider id `openai-codex`, not `openai` — `auth login openai --oauth` fails; (b) README's
auth paragraph (`README.md:93`) documents only `--key`, so the two other modes exist only in
`auth --help`. Cheap fix: mark oauth-capable rows in `auth status --all` or add one usage
line naming the ids; add one README sentence.

### F8 — Custom providers are invisible to `models list --available`, even with `--provider`. Verified live.

`models.ts:70-81` only consults `listSparkleModels` (builtin catalog). With
`customProviders: [{id: "local", models: [{id: "m1"}]}]` in providers.json:
`models list --available --provider local` prints `(no models)` while
`models enable local/m1` **succeeds** (enable's `assertKnownCatalogId` does pass
`config.customProviders`, `models.ts:157-165`). The one browse surface the usage text
advertises ("Browse the Pi catalog with --available") can't show the models the operator
themself configured. `listedModelsFromCustom` already exists (`listed-model.ts:47-60`) —
the fix is appending it in the `--available` branch, ~6 lines.

### F9 — `models disable` silently deletes the primary/fast default. Verified live.

`disableModel` (`providers-config.ts:85-98`) drops `primary`/`fast` when they match the
disabled id — correct behavior, zero disclosure. Live sequence: `set-default --primary
local/m1` → `disable local/m1` → output is just `Disabled local/m1`; `models list` then
says "No models enabled", and the next `run --executor pi` fails with "--executor pi
requires an enabled primary model…". One extra stdout line ("also cleared primary default")
at the CLI layer closes it; the config function's return value already carries enough to
detect the drop.

### F10 — Headless login without stdin ends in an unsettled-top-level-await exit, not an error. Verified live.

`pnpm cli auth login gateway </dev/null` prints the prompt, then Node's "Warning: Detected
unsettled top-level await" and **exit 13**: on stdin EOF, `rl.question`'s callback never
fires, the promise never settles, and the process falls off the event loop
(`auth-session.ts:111-119`, `157-159`). No structured error, no JSON report line, an exit
code nothing documents. CI/scripted callers hit this the first time a pipe is empty. Fix:
resolve/reject the question promise on the interface's `close` event ("stdin closed before
a key was entered"). Piped input *with* a line works today (verified) and should keep working.

### F11 — No credential preflight exists anywhere; missing auth is discovered mid-run.

`doctor`'s providers check (`doctor.ts:702-716`) only parses providers.json and explicitly
punts ("fake executor does not need credentials") — it never calls `checkAuth`, and no
doctor check mentions `auth` at all. `run --executor pi` constructs the executor without an
auth check (`main.ts:196-234`); the first failure surfaces at request time as pi's
`Provider is not configured: <provider>` (`models.js:366`) inside a running attempt, after
the run and its state exist. The building block is shipped and tested
(`checkProviderAuth`); an additive doctor check — resolve auth for the providers of
`primary`/`fast`/`enabled` — turns a mid-run failure into a preflight line. Doctor's output
contract is unfrozen, so this is additive-safe.

### F12 — `auth logout` reports success for credentials that never existed, on providers that don't exist. Verified by test + code.

`logoutCommand` (`auth.ts:136-149`) skips `isKnownProvider` and prints
`Removed stored credential for <p>` unconditionally; the underlying delete is deliberately
idempotent (good, keeps re-runs safe — pinned in `auth-session.test.ts:135-156`). But
`auth logout opnai` (typo) exits 0 claiming a removal, while `auth login opnai` correctly
refuses `unknown provider "opnai"`. Cheap honesty fix: report "no stored credential for
<p>" when the store had nothing (the delete path already knows), keep exit 0.

### F13 — `auth status` polish (minor, batch into any auth.ts touch).

- `auth status --all` with nothing configured prints **nothing** — the "No stored
  credentials…" notice is suppressed exactly when `--all` is set (`auth.ts:71-73`).
  Verified live: zero output, exit 0.
- The second column is hardcoded `env` for every non-stored row (`auth.ts:87`), but the
  printed source can be `local (no key)` (not env) or `OAuth`. Cosmetic dishonesty.
- No column headers; two-space alignment breaks visually past 28-char provider ids
  (`cloudflare-ai-gateway` is 21 — fine today).

### F14 — Stale `enabled` entries after a Pi pin bump have no detection surface (minor, latent).

`models list` prints `config.enabled` without re-validating; a catalog model removed by a
future pi-ai bump stays listed and only explodes later in `buildLiveCatalogConfig`
(`model-catalog.ts:57-59`, `unknown model "<id>"`) when `run --track`/`--flowchart` builds
the live catalog. `models disable` being validation-free is the correct escape hatch
(verified it removes anything), so this is a diagnostics gap, not a trap — a `(not in
catalog)` annotation in `models list`, or a doctor line, when a cheap `resolveListedModel`
probe fails.

### F15 — Hardening note: auth.json is world-readable for a moment on every save.

`FileCredentialStore.save` publishes via `writeFileAtomic` (temp file created with default
0644 mode, `atomic-file.ts:51`) and chmods 0600 **after** rename, swallowing chmod failure
(`file-credential-store.ts:86-90`). Final perms verified 0600 on disk; the window is small
and same-user-dir, but passing `mode: 0o600` at `open()` (or an options seam on
`writeFileAtomic`) removes it entirely. Low priority, cheap.

---

## 3. What holds up (verified, no action)

- **The precedence story is true and consistently told.** "Stored credentials win over env"
  matches pi's resolver exactly (stored-first, no silent env fallback), and is stated in
  `AUTH_USAGE`, README, and the top-level USAGE. `PI_API_KEY` is honestly scoped as a
  compatibility override wired only to the default provider (`main.ts:223`,
  `pi-executor.ts:553-555`).
- **Secret hygiene on output paths.** `status`/`list` never print key material
  (`CredentialInfo` is type-metadata only); tests assert the fake key against *every*
  produced string; live probes confirmed no leakage on status/login/logout output.
- **Fail-closed provider gate.** Unknown provider is refused before any prompt or write,
  both at the CLI (`isKnownProvider`) and inside pi (`Unknown provider:`), pinned by tests.
- **Empty-key refusal** with the correct rationale in a comment (an empty stored key would
  shadow a working env var and fail at request time) — both at the CLI arg and the store API.
- **Store correctness.** File lock around read-modify-write, atomic publish, corrupt-store
  fail-closed (the *remedy* is F4; refusing to guess is right), oauth credential shape
  validated on read, multi-provider isolation tested.
- **The two-prompt regression** (second question on a closed readline) is fixed and pinned
  (`auth-session.test.ts:283-293`).
- **README quickstart example ids are real**: `openai/gpt-4o-mini` and
  `anthropic/claude-sonnet-4-5` both resolve in the pinned catalog (verified live), and the
  env-var-only quickstart (no login) genuinely works with the resolver semantics.
- **`models enable` validates, `set-default` validates both ids and auto-enables them** —
  the auto-enable is sensible and keeps "routing only uses enabled models" true;
  `parseModelRef` handles slashed model ids (openrouter-style) correctly by splitting on
  the first `/` only.
- **`models` and `auth` stay out of frozen surfaces**: no JSON contracts, no event types,
  no executor construction (except `checkAuth`'s runtime, which never streams).

---

## 4. README / USAGE honesty scorecard

| Claim | Where | Verdict |
|---|---|---|
| "Stored credentials win over env" | README:93, AUTH_USAGE, USAGE | **True** (pin-verified) |
| "writes `~/.pi-sparkle/auth.json`" | README:93 | **False** — `~/.pi-sparkle/runtime/auth.json` (F3) |
| "Stored credentials live in `<state-root>/auth.json`" | AUTH_USAGE (auth.ts:28) | **False** — same, contradicted by the command's own success output (F3) |
| "Status never prints secrets" | AUTH_USAGE | **True** (tested + probed) |
| `[--key <key> \| --from-env \| --oauth]` (exclusive) | AUTH_USAGE | **Not enforced** — silent precedence, dangerous no-write success (F2) |
| `--from-env` implies an environment check | flag name + its error text | **Misleading** — store-first check (F1) |
| "OPENAI_API_KEY / ANTHROPIC_API_KEY / … still work without login" | AUTH_USAGE, README | **True** |
| "PI_API_KEY is only a compatibility override for the default provider" | AUTH_USAGE, USAGE, README | **True** |
| "Browse the Pi catalog with --available" | MODELS_USAGE | **Half-true** — builtin only; operator-defined custom providers invisible (F8) |
| "Routing only uses enabled models" | MODELS_USAGE | **True with disclosed exception** — `PI_PROVIDER`/`PI_MODEL` bypass is documented; live catalog = enabled ∪ {primary, fast} |
| `--from-env`/`--oauth` exist | README | **Absent** — README documents only `--key`, the least safe mode (F5, F7) |
| Never-echo comment | auth-session.ts:104-106 | **Overclaims** — no input muting on secret prompts (F5) |

---

## 5. Ranked recommendations (for a future implementation round — nothing changed now)

1. **auth.ts honesty batch** (F1+F2+F3+F12+F13): mutual-exclusion guard for login modes;
   from-env message/error wording that matches the store-first reality; correct paths in
   AUTH_USAGE + README:93; logout "nothing was stored" variant; status `--all` empty-state
   line and source-derived column label. One file + README, no contract surfaces, high
   deception-per-line removed.
2. **Corrupt-store remedy** (F4): targeted `next:` naming the file as safe to delete, or
   `logout --force`. The error already carries the absolute path.
3. **Secret-prompt muting + credential-passing docs** (F5): mute readline echo for
   `prompt.type === "secret"`; document the stdin-pipe login; caveat `--key` re shell
   history. Security-adjacent and the current doc comment actively misleads reviewers.
4. **Custom providers in `--available`** (F8) and **keyless-custom login guard** (F6):
   both are small, both in the operator's self-configured path where confusion is total
   today (store-a-dead-secret vs "(no models)" for a provider that demonstrably works).
5. **Doctor auth preflight** (F11): additive `auth` check resolving the providers of
   `primary`/`fast`/`enabled` via the existing `checkProviderAuth`; converts the worst
   remaining failure mode (mid-run `Provider is not configured`) into preflight.
6. **Disable-drops-default disclosure** (F9), **stdin-EOF settle** (F10), **oauth
   capability listing** (F7), **stale-enabled annotation** (F14), **temp-file mode**
   (F15) — each independently tiny; batch opportunistically.

## NO_HIGH_VALUE_CHANGE_FOUND areas

- **The store design itself** (one credential per provider, file lock, atomic publish,
  fail-closed parse, list-without-secrets): matches pi's `CredentialStore` contract and
  needs no rework. Keychain/OS-keyring integration would be new scope, not a fix.
- **`PI_API_KEY`/`PI_PROVIDER`/`PI_MODEL` compat**: honestly scoped everywhere it appears;
  removing or expanding it would churn a documented bridge.
- **`models` enable/disable/set-default semantics** (validation on enable, free disable,
  auto-enable on set-default): correct shape; only the F9 disclosure line is worth adding.
- **Error-dialect split** (auth/models arg errors are bare stderr, thrown errors get the
  structured report): real but already tracked as Fable-cli G4 with a repo-wide fix shape;
  a local fix here would add a third dialect. Deliberately not re-proposed.
- **`auth status --all` performance** (~0.85s for ~30 providers incl. per-provider runtime
  construction): measured, fine at preview scale; caching would be premature.
- **OAuth flow unit coverage**: the deliberate live-smoke-only posture for token exchange
  is right; the F10 EOF fix is testable without any network.

---

## 6. Probe transcript (throwaway state root, all commands actually run)

```text
# F1: no env, nothing stored
$ auth login openai --from-env            → exit 1  "provider openai is not configured in the environment"
# F1: stored only, env scrubbed
$ auth login openai --key sk-fake-stored  → exit 0  "Stored api_key credential … /tmp/auth-audit-sr/runtime/auth.json"
$ auth login openai --from-env            → exit 0  "openai configured via stored credential (not written to auth.json)"
# F2: all three modes at once
$ auth login openai --key sk-conflict --oauth --from-env
                                          → exit 0  from-env branch; sk-conflict NOT stored
# F7: oauth on non-oauth provider
$ auth login groq --oauth                 → exit 1  "Groq does not support oauth login"
# status
$ auth status --all   (keys scrubbed)     → only "openai stored api_key"; 0.85s wall
$ GROQ_API_KEY=fake ANTHROPIC_AUTH_TOKEN=fake auth status --all
                                          → env rows: "anthropic env ANTHROPIC_AUTH_TOKEN", "groq env GROQ_API_KEY"
# F4: corrupt store
$ printf not-json > …/runtime/auth.json
$ auth status                             → exit 1  "invalid auth.json at …"
$ auth logout openai                      → exit 1  same error (logout unavailable)
# custom providers: local (keyless), gateway (envVar GATEWAY_KEY)
$ models list --available                 → 1312 lines, builtin only
$ models list --available --provider local→ "(no models)"          (F8)
$ models enable local/m1                  → exit 0 "Enabled local/m1" (F8 inconsistency)
$ models set-default --primary local/m1; models disable local/m1; models list
                                          → "No models enabled." — primary silently gone (F9)
$ auth status --all  (GATEWAY_KEY unset)  → "local  env  local (no key)"        (F13 label)
$ auth login local --from-env             → exit 0 "local configured via local (no key) …" (F1/F6)
$ auth login local </dev/null             → exit 1 "local does not support api_key login"  (F6)
$ auth login gateway </dev/null           → prompt, unsettled-TLA warning, exit 13         (F10)
$ printf 'sk-piped-key\n' | auth login gateway
                                          → exit 0, stored (undocumented safe path, F5)
$ auth login local --key sk-dead-key      → exit 0, stored a never-sent secret             (F6)
$ models list --available --provider anthropic | rg sonnet
                                          → anthropic/claude-sonnet-4-5 present (README example valid)
$ auth status --oauth                     → exit 1 "Unknown option '--oauth'" (structured via catch-all)
$ models set-default --fast local/m1      → exit 1 bare stderr "requires --primary" (dialect: G4)
$ stat auth.json → 600; providers.json → 644                                              (F15 final perms ok)
```
