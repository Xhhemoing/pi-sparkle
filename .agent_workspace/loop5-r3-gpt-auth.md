# Loop 5 Round 3 — GPT auth-fix challenge

Scope: independent review of the proposed login-mode exclusivity and
`--from-env` fix. Read-only analysis of `src/cli/auth.ts`, the auth adapter/runtime,
tests, and pinned `@earendil-works/pi-ai@0.84.3`; no `src/` edits and no commit.

## Verdict

Enforce mutual exclusion, but include **all three** explicit modes:
`--key`, `--from-env`, and `--oauth`. Count `values.key !== undefined`, not key
truthiness, and reject before entering any mode branch. This removes the current
silent `from-env > key > oauth` precedence and guarantees that a rejected command
does not write `auth.json`.

Do **not** implement env-only behavior by filtering the current
`checkProviderAuth()` result on `check.source`. The Round 2 suggestion that a
`"stored credential"` sentinel is enough is unsafe. Pi exposes `source` as a
human-readable status label, not structured provenance, and `checkAuth()` answers
"is this provider effectively configured?", not "is an env var present?".

The safer behavior is:

> `--from-env` asks whether Pi would consider the provider configured if the
> persisted credential store were empty.

Keep the existing store-aware `checkProviderAuth()` unchanged. Add a separate
ambient/environment probe that constructs the same Pi provider registry with an
empty in-memory `CredentialStore`, then calls Pi's `models.checkAuth()`. This
ignores `auth.json` without reimplementing provider auth rules or mutating the real
store.

## Why source filtering fails

Pinned Pi behavior is explicit:

- `models.checkAuth()` reads the provider credential first
  (`dist/models.js:244-253`).
- Stored OAuth returns `{ source: "OAuth", type: "oauth" }`
  (`dist/models.js:222-225`). A check such as
  `source !== "stored credential"` therefore accepts a stored-only OAuth login as
  `--from-env`.
- Stored API-key credentials mask ambient auth. If both `auth.json` and
  `OPENAI_API_KEY` exist, the result is `"stored credential"`. Rejecting that
  source produces a false negative even though the requested env configuration
  exists.
- Keyless custom providers return `<id> (no key)`, so they also pass a
  not-`"stored credential"` test with no environment variable at all.
- `AuthCheck.source` is documented as an optional, human-readable label for
  status UI. Provider-specific checks may choose any text; it is not a stable
  provenance enum.

Checking `type === "api_key"` as well does not repair this: it removes the
stored-OAuth false positive, but cannot see an env key hidden by any stored
credential.

Required regression cases:

| Store | Environment | Expected `--from-env` |
|---|---|---|
| none | key set | success, env source shown |
| stored API key | absent | failure |
| stored API key | key set | success; proves the store did not mask env |
| stored OAuth | absent | failure; catches source-sentinel false positive |
| stored OAuth | key set | success if that provider also supports env API-key auth |
| corrupt `auth.json` | key set | success; an env probe should not read the file |
| keyless custom provider | none | refusal/not env-configured |

## What must not be changed

`checkProviderAuth()` currently preserves Pi's effective-auth contract: stored
credentials own the provider, and ambient sources are consulted only when no
credential is stored (`dist/auth/resolve.js:21-54`). Changing that shared helper
to be env-first or store-blind would make status/preflight semantics disagree
with request execution, which remains stored-first. Leave it as the effective
auth probe.

Likewise, do not:

- temporarily delete, rename, or rewrite the real credential file to expose env;
  that creates loss and cross-process race windows;
- call `process.env` through a hand-maintained provider-to-variable table;
- import Pi's private `dist/env-api-keys.js` implementation;
- call `provider.auth.apiKey.resolve()` directly and bypass an optional
  provider-owned `apiKey.check()`.

The last two shortcuts would lose Pi's provider completeness semantics.
Cloudflare needs multiple values, Bedrock supports several combinations, Google
Vertex supports ADC plus project/location, and Anthropic has several differently
applied tokens. Pi's `checkAuth()` already owns these rules and deliberately uses
`apiKey.check()` when a provider supplies a side-effect-free check.

## Recommended shape

1. Leave the normal runtime backed by `FileCredentialStore`.
2. Factor provider registration so both probes use the same built-in and custom
   provider set.
3. For the new environment probe, use Pi's exported
   `InMemoryCredentialStore` with no entries and call `models.checkAuth(providerId)`.
   This preserves Pi's provider-specific check/resolve behavior and its
   no-OAuth-refresh `checkAuth` contract while making persisted credentials
   impossible to observe.
4. Explicitly reject or return unconfigured for a custom provider with no
   `envVar`; its current keyless resolver is intentionally always configured.
5. Report the returned source, but never branch on its text.

Pi treats both env vars and some ambient machine configuration (for example
Google ADC files) as valid provider configuration. The least risky contract is
"environment/ambient auth, with `auth.json` ignored" and the CLI text should say
that. If product policy requires **literal process-env variables only**, that is a
narrower contract than Pi's `checkAuth()`: use an env-only `AuthContext`
(`fileExists` always false) plus the empty store and pin provider-matrix tests.
A future structured provenance field in Pi would be preferable; parsing source
labels is not an acceptable substitute.

## Exclusivity tests

Pin all conflicting pairs and the triple:

- `--key x --from-env`
- `--key x --oauth`
- `--from-env --oauth`
- all three together

Each must reject with one argument-validation error, omit the key from all
output, and leave the credential store absent or byte-for-byte unchanged.
Non-conflicting `--key`, `--from-env`, `--oauth`, and the default interactive
API-key path must retain their existing behavior.
