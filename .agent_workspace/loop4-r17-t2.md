[Model: gpt-5.6-sol-xhigh-fast]

# Loop 4 · Round 17 · R17-2 — migrate-legacy fallback never-overwrite pin

## Census

- Branch remained `agent/opt-continuous`; slot started at `c3ef49e55e924e70b4dea9bb3bcc7d7c3232fd13`.
- `test/unit/cli/migrate-legacy.test.ts` exists and is the only owned code/test path.
- Initial `git status --short` was empty. At the final census, sibling R17-1 had begun editing its owned `src/learning/from-episode.ts`; that dirt is disjoint and untouched by R17-2.
- The existing fallback test injects `link` → `EPERM` with no destination, while `racerWriting`, `tempsBeside`, and the divergent mid-apply test provide the required race and cleanup seams.
- There is no manifest or explicit non-Markdown consumer of this test path. `scripts/run-tests.mjs` recursively discovers every `*.test.ts`, so no registry update is needed.

## Landing

Added exactly one test to `test/unit/cli/migrate-legacy.test.ts`:

> `never overwrites a destination that appears during the exclusive-copy fallback`

The test combines `link` → `EPERM` with `uniqueSuffix: racerWriting(destination, live)`. It asserts exit 1, `could not copy` on stderr, byte-identical preservation of the divergent live destination, and removal of the run-owned temp.

R17-2 made no `src`, integration, crash-probe, package, protocol, or sweeper change. The final shared-tree `src` diff is sibling-owned R17-1 work.

## Verification

| Check | Result |
|---|---|
| Owned file run 1: `pnpm exec tsx --test test/unit/cli/migrate-legacy.test.ts` | exit 0; 20 pass / 0 fail / 0 skipped |
| Owned file run 2 | exit 0; 20 pass / 0 fail / 0 skipped |
| Owned file run 3 | exit 0; 20 pass / 0 fail / 0 skipped |
| `pnpm exec eslint test/unit/cli/migrate-legacy.test.ts` | exit 0; no diagnostics |
| `pnpm exec tsc --noEmit` | exit 0; no diagnostics both before and after sibling R17-1 dirt appeared |
| `git diff --check` | exit 0 |

## Mutation proof

Created a full copy at `/tmp/r17-2-mutant` with `/workspace/node_modules` symlinked, then changed only the copy's fallback from:

```ts
copyFile(tempPath, destination, constants.COPYFILE_EXCL)
```

to:

```ts
copyFile(tempPath, destination)
```

Running the owned file against that clobbering mutant exited 1:

```text
not ok 7 - never overwrites a destination that appears during the exclusive-copy fallback
Expected values to be strictly equal:
0 !== 1
# tests 20
# pass 19
# fail 1
```

The new test was the sole red test. The mutation copy was deleted and `/tmp/r17-2-*` was empty at the final scratch census.

## Residuals

- The documented fallback crash window and inert orphan-temp posture are unchanged.
- Full gate remains the parent's responsibility.
