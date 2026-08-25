# Loop 4 Round 5 — R5-4 atomic-writer consolidation

Result: **PASS**

Baseline: `agent/opt-continuous` at requested HEAD `6975aabe65169671dfa6562979b60a0f0a47c62f`. No checkout, commit, or push was performed.

## Census

Before editing, a `src/**/*.ts` census for temp-path construction and direct rename found exactly the three private publishers named by the brief, in addition to the frozen shared implementations in `src/persist/atomic-file.ts`:

1. `src/config/providers-config.ts::writeAtomicJson` used fixed `${path}.tmp`, opened with `"w"`, then renamed.
2. `src/pi-adapter/file-credential-store.ts::FileCredentialStore.save` used fixed `${filePath}.tmp`, opened with `"w"`, then renamed.
3. `src/adaptation/promotion.ts::saveAdaptationRegistry` used a unique `"wx"` temp, but its cleanup covered rename failures only; a write/sync failure occurred before that cleanup block and leaked the temp.

The first two could truncate/adopt an abandoned fixed temp and make concurrent publishers share one temp inode. The third avoided collisions but did not cover the full pre-publication failure interval. The frozen `writeFileAtomic` already supplies unique `"wx"` temps, collision retry, fsync/close, rename fallback, and an outer failure cleanup covering write, sync, close, and rename.

After editing, none of the three owned source files contains `open`, `rename`, `unlink`, a temp path, or a `.tmp` construction. No `src/persist/` file was edited.

## Change

- `saveProvidersConfig` now serializes the validated config exactly as before and publishes it with `writeFileAtomic`; the private `writeAtomicJson` copy was deleted.
- `FileCredentialStore.save` now publishes the same pretty JSON plus trailing newline with `writeFileAtomic`. Its best-effort `chmod(this.filePath, 0o600)` remains after successful publication.
- `saveAdaptationRegistry` now publishes the same pretty JSON plus trailing newline with `writeFileAtomic`; its private temp lifecycle was deleted, so shared-writer cleanup now covers write failures.

Unit coverage pins:

- exact provider and credential bytes;
- abandoned legacy fixed temps remain byte-for-byte untouched;
- credential mode is `0o600`, with a source pin that chmod follows the shared publish;
- concurrent registry saves always publish one complete snapshot and leave no owned temp;
- all three callers import and invoke the shared writer and contain no private temp/rename copy.

The existing shared-writer unit suite already pins unique concurrent temp names, stale-temp refusal/retry, and failure cleanup. The owned caller tests prove delegation plus the caller-specific byte and permission contracts, so an additional crash-probe case would duplicate those properties. `scripts/crash-probe.mjs` was not changed.

## Verification

- Owned unit suites: **38 passed, 0 failed, 0 skipped**.
- Concurrent registry publish test: **3/3 runs passed**.
- Scoped ESLint on the three source files and three unit files: **exit 0**.
- Whole-tree `pnpm exec tsc --noEmit`: **exit 0**.
- `git diff --check`: **exit 0**.
- Post-change source census on the three publishers: **0 private temp/rename matches**.

No `package.json`, `src/persist/`, or crash-probe changes were made. Concurrent round edits outside R5-4 ownership were left untouched.
