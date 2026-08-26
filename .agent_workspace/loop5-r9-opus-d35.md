# Loop 5 · Round 9 · Rank 2 (D35) — `auth login` refusal envelopes

Slot: Opus-d35-auth-envelopes. Branch `cursor/auth-login-envelopes-0da8`, based on
`origin/cursor/pi-sparkle-sota-opt-0da8` at `328fbe5` (`docs(agent): record Round 9 implementer
dispatch ids`). Not merged to the integration branch — parent merges after review.

## Files changed

- `src/cli/auth.ts` — six thrown `DomainValidationError`s become `cliFail` returns; two
  missing-argument guards extended to cover a blank positional; the now-unused
  `DomainValidationError` import removed.
- `test/unit/cli/auth.test.ts` — whole-field `parseCliErrorJson` pins on all six surfaces plus a
  precedence pin; three new cases, four existing cases extended.
- `test/integration/cli/commands.test.ts` — the two `assert.rejects` converted to exit-1 +
  `parseCliErrorJson` on the same messages.
- `.agent_workspace/loop5-r9-opus-d35.md` — this report.

Nothing else is touched. `src/pi-adapter/auth-session.ts`, `src/cli/main.ts`, `package.json`, and
every other file are byte-identical to the base branch.

## The invariant this batch holds

**Every message keeps its exact current bytes.** Only the report envelope changes. The conversion
is mechanical: `throw new DomainValidationError(<expr>)` becomes `return cliFail(io, { command,
stage, message: <the same expr>, next })`, so the D12/D21 wording is carried through unmodified —
including the ternary in the not-configured branch, which keeps both of its arms verbatim.

**No catch is added or widened.** Six throws became returns; nothing gained a `try`. The outer
`asAuthStoreUnreadable` catch in `authCommand` keeps exactly the errors it had — it now sees fewer
of them, because the six `DomainValidationError`s that used to pass through it (unmatched, rethrown
into `main.ts`) no longer exist, and no other error class changed shape. The narrow `parseAuthArgs`
catch and `listStoredCredentialsIfReadable`'s damaged-store catch are untouched.

Exit code stays 1 on every converted path (`cliFail` returns `CLI_EXIT.error`), stdout stays empty,
and stderr carries the human block plus the one-line `CliErrorReport` JSON.

## Exact contracts

### 1. Blank positional folds into the missing-argument refusal

`loginCommand` and `logoutCommand` guards are now
`providerId === undefined || providerId.startsWith("-") || providerId.trim() === ""`. Both reports
keep their pinned bytes:

| verb | `command` | `stage` | `message` | `next` |
| --- | --- | --- | --- | --- |
| login | `auth login` | `parse-args` | `auth login requires <provider>` | `run pi-sparkle auth --help` |
| logout | `auth logout` | `parse-args` | `auth logout requires <provider>` | `run pi-sparkle auth --help` |

`auth login ""` no longer reaches the provider lookup and no longer reports `unknown provider ""`;
`auth logout ""` no longer reaches `deleteStoredCredential`, so the store's own
`provider id must be non-empty` throw is unreachable from argv. Login keeps echoing `AUTH_USAGE`
before its report and logout keeps not inventing one — the guard body is unchanged.

### 2. Multi-mode → parse-args

Position unchanged (already before any config or store read).

| field | value |
| --- | --- |
| `command` | `auth login` |
| `stage` | `parse-args` |
| `message` | `auth login takes one of --key, --from-env, --oauth; got ${modes.join(" and ")} — nothing was stored` |
| `next` | `pass exactly one of --key, --from-env, --oauth` |

No flag value is echoed: `modes` holds flag *names* only, and the `next` is a constant. The
no-secret pin holds.

### 3. Blank `--key` → parse-args, before config

Moved from after the provider lookup to immediately after the multi-mode guard, ahead of
`loadProvidersConfig`.

| field | value |
| --- | --- |
| `command` | `auth login` |
| `stage` | `parse-args` |
| `message` | `auth login --key must be non-empty` |
| `next` | `pass --key <key> with a non-empty value` |

The key value is never echoed, blank or not. **Precedence, pinned deliberately:**
`auth login banana --key "  "` now reports the blank key, not the unknown provider — argv refuses
before anything that depends on the config, and the provider is never looked up. No existing test
bound the old order.

Multi-mode is checked before the blank key, so `auth login openai --key "  " --oauth` still reports
the mode conflict; nothing in the suite bound that pair either way, and the mode check is what
decides whether `--key` is even in play.

### 4. Unknown provider → validation with a real inventory

| field | value |
| --- | --- |
| `command` | `auth login` |
| `stage` | `validation` — provider membership is the builtin catalog plus `providers.json` state, not CLI knowledge |
| `message` | `unknown provider "${providerId}"` (bytes kept) |
| `next` | `pass a provider this install resolves: pnpm cli models list --available prints ids as <provider>/<model>, and providers.json customProviders adds more` |

### 5. Keyless-custom store modes → validation naming its two remedies

One site covers `--key`, `--oauth`, and the interactive mode.

| field | value |
| --- | --- |
| `command` | `auth login` |
| `stage` | `validation` |
| `message` | the D21 paragraph, byte-identical (all four concatenated segments unchanged) |
| `next` | `add envVar for ${providerId} to providers.json, or use the per-run PI_API_KEY override for the selected default provider` |

### 6. `--from-env` refusals → preflight

Both throws in `loginFromEnvCommand` converted. An unconfigured environment is an environment
fault: nothing about the command line is wrong, and nothing failed to execute.

| case | `stage` | `message` | `next` |
| --- | --- | --- | --- |
| keyless custom, nothing to check | `preflight` | D21 bytes: `provider ${providerId} is a custom provider with no envVar in providers.json, so no environment variable configures it and --from-env has nothing to check` | `add envVar for ${providerId} to providers.json` |
| named custom `envVar` unset | `preflight` | D12 bytes: `provider ${providerId} is not configured in the environment: ${customEnvVar} is unset or empty (providers.json names it for this provider)` | `set the environment the message names, or store a credential with pnpm cli auth login ${providerId} --key <key>` |
| builtin ambient paragraph | `preflight` | D12 bytes: the full `--from-env checks what this provider resolves ambiently …` paragraph | same as above |

`command` is `auth login` on all three.

D12's semantics are untouched: success off the environment, the fail-closed refusal when only a
stored credential configures the provider, the outranking-credential note, and the corrupt-`auth.json`
warning path keep their code and their pins. Only the refusal envelope changed.

## Tests

### `test/unit/cli/auth.test.ts` — 31 pass (28 before)

Three new cases:

- **`a blank <provider> folds into the missing-argument refusal on both verbs`** — whole-field pins
  on login and logout, plus `doesNotMatch` on `/unknown provider/` and
  `/provider id must be non-empty/` (the two reports the blank positional used to produce), plus
  `auth.json` never created.
- **`an unknown provider is a validation refusal naming the inventory that lists the ids`** —
  whole-field pins, no key echoed, no store write.
- **`a blank --key is an argv refusal, and it is reached before the provider lookup`** — whole-field
  pins on `auth login openai --key "  "`, then the precedence pin: `auth login banana --key "  "`
  reports the blank key and `doesNotMatch` `/unknown provider/`. `auth.json` never created on either.

Four existing cases extended with whole-field pins on the same invocations they already covered:

- the mutually-exclusive-modes loop (all four combinations, each with its own `got …` message);
- the keyless-custom loop (all three writing modes) — which already re-asserts `auth.json` bytes
  unchanged against a pre-seeded store;
- `--from-env` on custom providers (keyless and unset-`envVar` variants);
- `--from-env` fails closed when only a stored credential configures the provider (the builtin
  ambient paragraph) — which already re-asserts `auth.json` bytes unchanged.

Every added pin asserts `command`, `stage`, `message`, and `next` as whole fields, and every new
case asserts exit 1 and empty stdout. No-store-write is covered on all six surfaces: the three new
cases assert `auth.json` does not exist; the multi-mode case already did; the keyless-custom and
fail-closed cases already compare the file's bytes before and after.

### `test/integration/cli/commands.test.ts` — 6 pass

`auth rejects an unknown provider and an empty key fail-closed` no longer asserts a throw. Both
invocations now pin exit 1, empty stdout, and a parseable report whose `message` matches the same
`/unknown provider/` and `/non-empty/` the `assert.rejects` matched. `parseCliErrorJson` is imported
from `../../../src/cli/errors.js`.

## Pins confirmed unchanged

Verified by running the files and by reading the diff:

- **D28** — the unknown-subcommand report (`command: "auth"`, `Unknown auth command: staus`) and the
  three-verb `parseArgs` refusal (`Unknown option '--bogus'`, next `run pi-sparkle auth --help`).
- **`AUTH_STATUS`** — all four `deepEqual` pins (stored, empty stored, `--all`, empty `--all`). No
  converted refusal is on a path that reaches JSON assembly, and `statusCommand` is untouched.
- **D24** — the source-column pins (`keyless`/`gateway`/`openai` offsets, the padded-`envVar` row,
  the `amazon-bedrock` ambient understatement). `sourceLabel` is untouched.
- **D12** — `/not configured in the environment/`, `/ADC files or AWS profiles/`, `/ignores auth\.json/`,
  the corrupt-store warning, the outranking note, the oauth-session cases.
- **D21** — `/takes one of --key, --from-env, --oauth/`, `/nothing was stored/`,
  `/no envVar in providers\.json/`, the four keyless-paragraph regexes and both `doesNotMatch`
  guards, `/unknown provider/`, `/non-empty/`, the missing-`<provider>` reports, the usage-echo
  ordering, and the logout removal/never-stored split.
- **D16** — the `--help` invocations (flag and positional spellings on all three verbs) and the
  damaged-`auth.json` report on every verb that needs the file.

No Event type, no new JSON key, no `main.ts`, no `pi-adapter` edit, no `package.json` change.

## Verification

- `npx tsx --test test/unit/cli/auth.test.ts test/integration/cli/commands.test.ts` — 37 pass,
  0 fail.
- `npx tsc --noEmit` — clean.
- `npx eslint src/cli/auth.ts test/unit/cli/auth.test.ts test/integration/cli/commands.test.ts` —
  clean.
- `pnpm test` (whole suite) — 2318 pass, 0 fail, 1 skipped (unchanged pre-existing skip).

Host Node is v22.14.0 against engines `>=22.19.0`; that is a warning only and no test depends on it.

## Rider — GPT-r9-challenge FIX: three remedies restated in terms of what was actually checked

GPT-r9 returned **FIX** (slot kept) on the envelopes' `next` strings and one missed D24-shaped
value case. The verdict keeps the blank-positional folding, the argv-before-config order, the
message preservation for the already-pinned ordinary cases, and the parse-args/validation/preflight
split; the multi-mode-before-blank-key order is unchanged. Rider is on the same branch, same three
source files.

### 1. The unknown-provider inventory is read under the root that refused

`models list --available` prints a different catalog per state root — a custom provider comes from
that root's `providers.json` — so a remedy that omitted the flag pointed at an inventory that would
not contain the provider the operator is looking for. The raw path is not embedded.

| field | value |
| --- | --- |
| `next` | `pass a provider shown by pi-sparkle models list --available using the same --state-root; custom providers come from that root's providers.json` |

`command`, `stage`, and the `unknown provider "${providerId}"` message are unchanged from the first
landing.

### 2. The unset-environment remedy splits by what the probe checked

The two messages name different kinds of thing, so one remedy could not be true of both. A custom
provider's message names a single variable. A builtin's names ambient *categories* — environment
variables, ADC files, AWS profiles — because Pi keeps the variable list inside its resolver, so the
first landing's `set the environment the message names` pointed at a name that is not in the line.

| case | `next` |
| --- | --- |
| named custom `envVar` | `set the providers.json envVar exactly as configured for ${providerId}, or store a credential with pi-sparkle auth login ${providerId} --key <key>` |
| builtin | `configure one of the ambient sources named in the message, or store a credential with pi-sparkle auth login ${providerId} --key <key>` |

Both stay `command: "auth login"`, `stage: "preflight"`. The keyless `--from-env` refusal
(`add envVar for ${providerId} to providers.json`) and the keyless-custom store-mode refusal are
unchanged.

### 3. A custom `envVar` is no longer trimmed when its failure is reported

`loginFromEnvCommand` read `?.envVar?.trim()` and printed the trimmed spelling. The runtime looks
the variable up under the bytes `providers.json` configures — the same fact D24 pinned when
`status --all` labels a padded name `env` off its configured `envVar` — so for
`envVar: " SPARKLE_TEST_PADDED_KEY "` the refusal named `SPARKLE_TEST_PADDED_KEY`, a *different*
variable that the operator could set without changing the outcome.

The read is now the raw configured value, and the report branches on whether those bytes differ
from their trim:

| case | `message` |
| --- | --- |
| ordinary (unpadded) | `provider ${providerId} is not configured in the environment: ${customEnvVar} is unset or empty (providers.json names it for this provider)` — bytes unchanged, no quotes added |
| padded | `provider ${providerId} is not configured in the environment: providers.json envVar ${JSON.stringify(customEnvVar)} is unset or empty (whitespace is part of the variable name)` |

`JSON.stringify` supplies the quotes and the escaping, so the whitespace is visible in the line and
a name carrying a quote or a control character cannot forge one. No value is read or printed.

Dropping the `.trim()` does not change which branch a whitespace-only or empty `envVar` takes: both
are keyless by `isKeylessCustomProvider` (which keeps its own `trim()`, mirroring the runtime's
guard for whether a resolver is built at all) and are refused before this point.

The three message/remedy pairs are built by a new module-local
`unconfiguredEnvironmentReport(providerId, customEnvVar)` returning `{ message, next }`, spread into
the existing `cliFail`. No catch added or widened; the outer `asAuthStoreUnreadable` catch, the
`parseAuthArgs` catch, and `listStoredCredentialsIfReadable` are untouched.

### Rider tests

- **`--from-env names a padded envVar exactly as configured, and its trimmed spelling does not
  satisfy it`** (new) — a `padded` custom provider with `envVar: " SPARKLE_TEST_PADDED_KEY "`. With
  only the trimmed spelling set: exit 1, empty stdout, whole-field pins on `command`/`stage`/
  `message`/`next`, `doesNotMatch` on `/: SPARKLE_TEST_PADDED_KEY is unset or empty/` (the trimmed
  name is never offered as the thing to set), the env value never printed, and `auth.json` never
  created. Then, with the configured name set spaces and all: exit 0 and the success line naming the
  padded source — so the refusal is provably about the wrong variable rather than a provider that
  can never pass.
- Updated pins on the three remedies: the unknown-provider `next`; the gateway unset-`envVar` `next`;
  the builtin fail-closed `next`, plus a `doesNotMatch` on `/set the environment the message names/`
  so the false remedy cannot come back.

The ordinary custom case keeps its existing message pin
(`/SPARKLE_TEST_GATEWAY_KEY is unset or empty/` plus the whole-field message assertion), which is
what holds the "unpadded bytes unchanged" half.

### Rider verification

- `npx tsx --test test/unit/cli/auth.test.ts test/integration/cli/commands.test.ts` — 38 pass,
  0 fail (37 before the rider).
- `npx tsc --noEmit` — clean.
- `npx eslint src/cli/auth.ts test/unit/cli/auth.test.ts test/integration/cli/commands.test.ts` —
  clean.
- `pnpm test` (whole suite) — 2319 pass, 0 fail, 1 skipped.

Every first-landing envelope, the blank-positional folding, the multi-mode-before-blank-key order,
and all the D12/D21/D24/D28/D16 and `AUTH_STATUS` pins listed above are unchanged; the rider touches
only three `next` strings and the custom-`envVar` reporting path. `test/integration/cli/commands.test.ts`
needed no rider change — it pins the two messages, and neither moved.
