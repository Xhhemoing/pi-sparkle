# Loop 5 Round 3 — auth honesty landing recheck

## Verdict

**FIX**

The empty-store probe, runtime credential override, mode exclusion, and unchanged
store-first effective-auth path all match the Round 3 design. The landed CLI does
not, however, satisfy the required corrupt-store row: after the empty-store probe
succeeds, it reads the real store to print an informational note, so a corrupt
`auth.json` turns the required success into exit 1.

## Required matrix

| Store | Environment | Expected `--from-env` | Landing | Regression coverage |
|---|---|---|---|---|
| none | key set | success, env source shown | **PASS** — the empty store permits Pi to resolve and report the env source | `test/unit/cli/auth.test.ts:177-190` |
| stored API key | absent | failure | **PASS** — the probe cannot see the stored key | `test/unit/cli/auth.test.ts:157-175`; adapter coverage at `test/unit/pi-adapter/auth-session.test.ts:259-273` |
| stored API key | key set | success; proves the store did not mask env | **PASS** — env succeeds, then the valid real store is listed only for the precedence note | `test/unit/cli/auth.test.ts:192-209`; adapter coverage at `test/unit/pi-adapter/auth-session.test.ts:275-284` |
| stored OAuth | absent | failure; catches source-sentinel false positive | **PASS by structure, but untested** — the empty store makes stored OAuth invisible and absent env yields `undefined` | No stored-OAuth `--from-env` test |
| stored OAuth | key set | success if that provider also supports env API-key auth | **PASS by structure, but untested** — the empty probe sees the key; a valid OAuth entry can subsequently be listed | No stored-OAuth-plus-env test |
| corrupt `auth.json` | key set | success; an env probe should not read the file | **FAIL** — the probe succeeds without the file, but the command then reads the corrupt file and exits 1 | No corrupt-store-plus-env test; the damaged-file test omits `--from-env` |
| keyless custom provider | none | refusal/not env-configured | **PASS** — the CLI rejects a custom provider lacking `envVar` before probing | `test/unit/cli/auth.test.ts:211-243` |

## Blocking code path

The parent's suspicion is confirmed:

1. `loginCommand()` enters `loginFromEnvCommand()` at
   `src/cli/auth.ts:153-155`.
2. `loginFromEnvCommand()` calls `checkProviderEnvAuth()` at
   `src/cli/auth.ts:192`.
3. `checkProviderEnvAuth()` creates the normal provider registry with
   `credentials: new EmptyCredentialStore()` at
   `src/pi-adapter/auth-session.ts:103-113`. The runtime override is passed to
   `builtinModels` at `src/pi-adapter/runtime.ts:22-39`, so this probe never
   reads `auth.json` and succeeds when the key is set.
4. Before printing success, `loginFromEnvCommand()` calls
   `listStoredCredentials(stateRoot)` at `src/cli/auth.ts:200-204`.
5. That call constructs the real `FileCredentialStore`; `list()` loads and
   parses the file (`src/pi-adapter/file-credential-store.ts:89-95,132-152`).
   Corrupt JSON throws `AuthStoreUnreadableError`.
6. `authCommand()` catches that error and returns the `cliFail()` result, exit
   1, at `src/cli/auth.ts:62-73`. Because the list is intentionally before the
   success write, stdout contains no success line.

The test named “a damaged auth.json is named by every verb” does not exercise
this path: its invocation list at `test/unit/cli/auth.test.ts:268-295` contains
status, `login --key`, and logout only, with the OpenAI environment cleared.
There is also no corrupt-file case in the adapter env-probe tests.

## Other required properties

- **Mode exclusion passes.** `src/cli/auth.ts:135-144` counts
  `values.key !== undefined`, includes all three explicit modes, and rejects
  before provider config loading and every mode branch. All three pairs and the
  triple are covered at `test/unit/cli/auth.test.ts:109-132`; the rejection does
  not echo the key or create a store. The existing-store rotation case also
  proves byte-preserving refusal at `test/unit/cli/auth.test.ts:134-155`.
- **`checkProviderAuth()` remains store-first.** It still creates a runtime
  without a credential override (`src/pi-adapter/auth-session.ts:78-90`), and
  `createPiRuntime()` defaults to `FileCredentialStore`
  (`src/pi-adapter/runtime.ts:33-39`). The adapter test asserts that stored auth
  remains preferred even with an env key.
- **The env probe has the intended isolation.** `EmptyCredentialStore` returns
  no credentials, performs no file I/O, and rejects mutations
  (`src/pi-adapter/file-credential-store.ts:186-221`). Built-ins and custom
  providers are registered through the same runtime path.

## FIX items

1. Do not make successful `--from-env` depend on parsing the real credential
   store. The precedence note must be omitted or obtained without reading
   credential contents; add the required corrupt-`auth.json` plus env-key CLI
   regression asserting exit 0, env source output, no secret output, and
   unchanged corrupt bytes.
2. Add both stored-OAuth matrix tests (env absent and env key set). The empty
   store makes the present code correct, but the required source-sentinel
   regression is not pinned.
3. Align the user-facing contract with the implementation. The probe accepts
   Pi ambient sources such as ADC files and AWS profiles, as acknowledged by
   `src/pi-adapter/auth-session.ts:99-101`, while the failure at
   `src/cli/auth.ts:197` says it “checks environment variables only.” Describe
   the check as environment/ambient auth with `auth.json` ignored, or implement
   a genuinely process-env-only context if that narrower policy is intended.
