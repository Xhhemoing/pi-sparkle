# Loop 5 · Round 6 — GPT D27 independent recheck

## Verdict: KEEP

Reviewed fetched `origin/cursor/models-list-json-0da8` at
`c83fc99dfe66e3e1e3bca4ea00db587366fb5fa9`, the discriminated-shape rider
on parent `0fded4e7409550a239203e55693ff859b520ea32`. No blocking finding.

## Evidence

1. **Enabled `MODELS_LIST` shape: PASS.** Enabled JSON always carries
   `type`, `preview`, `mode`, `primary`, `fast`, and `models`.
   `primary`/`fast` are `string | null` and are never omitted
   (`src/cli/models.ts:119-127`, `202-214`). Each enabled row is exactly
   `{ id, inCatalog }`; there are no per-row primary/fast booleans
   (`src/cli/models.ts:110-112`). Empty state emits `primary: null`,
   `fast: null`, and `models: []`.

2. **Available-mode shape: PASS.** Available JSON has exactly `type`,
   `preview`, `mode`, and `models`; rows are exactly `{ id }`
   (`src/cli/models.ts:129-134`, `179-188`). No `primary`/`fast` fields
   appear on that object or its rows.

3. **Stored-configuration comments: PASS.** The contract comment states
   that the object reports stored model configuration under the state
   root, not what a run will route to, because `--primary-model` /
   `--fast-model` and `PI_PROVIDER` / `PI_MODEL` / `PI_FAST_MODEL` can
   outrank those defaults (`src/cli/models.ts:92-109`). The available-mode
   comment says browsing the catalog is not a question about configured
   defaults (`src/cli/models.ts:128`).

4. **`parseModelsArgs` catch boundary: PASS.** The helper's `try` executes
   only the supplied synchronous `parse()` call, which every call site
   binds to `parseArgs(...)` (`src/cli/models.ts:76-90`, `143-154`,
   `245`, `270`, `306-314`). `loadProvidersConfig`, `parseModelRef`,
   dynamic catalog imports, and config writes run after a successful
   parse and remain outside that catch.

5. **Whole-object pins: PASS.** Tests `deepEqual` populated enabled
   (`test/unit/cli/models.test.ts:241-256`), empty enabled (`285-297`),
   unfiltered available, and provider-filtered available (`313-345`).
   The compact-output test asserts one newline-terminated JSON line and
   pins that whole object (`257-283`).

6. **Footprint and freeze: PASS.** `c83fc99` vs `0fded4e` changes only
   `src/cli/models.ts` and `test/unit/cli/models.test.ts`. It does not
   touch `src/cli/main.ts`, adds no Event variant, and has no path
   overlap with live PR #12 at head `5c6376c`.

## Verification

- Focused `test/unit/cli/models.test.ts`: **17 passed, 0 failed, 0 skipped**.
- `pnpm typecheck`: **passed**.
- Focused eslint on the two rider files: **passed**.
- `git diff --check 0fded4e c83fc99 -- src/cli/models.ts test/unit/cli/models.test.ts`: **passed**.
- Empty CLI probe:
  `{"type":"MODELS_LIST","preview":true,"mode":"enabled","primary":null,"fast":null,"models":[]}`.
- Populated CLI probe emitted configured string defaults and only
  `{ id, inCatalog }` rows, on one compact line.
- The VM used Node `v22.14.0`, below the package's declared `>=22.19.0`; pnpm
  emitted an engine warning, but the requested checks completed successfully.
- Analysis only: no application source was edited, and no commit or push was
  made.
