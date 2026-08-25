# Loop 5 Round 2 — GPT validate recheck

Scope: independent review of commit `42b4c6c` against the current `run --flowchart` path at HEAD `826a44a`. Analysis only; no `src/` edits and no commit.

## Verdict

**ACCEPT the catalog-parity fix.** For the model-ID membership check it claims to mirror, `validate --flowchart` now uses the same state root, the same `buildLiveCatalogConfig(...)` result, and the same `parseFlowchartFile(..., catalogIds)` check as `run --flowchart`. The former static-catalog false positive/false negative is closed.

This is not a promise that every validated flowchart will complete a run: `validate` deliberately does not construct an executor, route nodes, create state, or execute work. Its current command help scopes the parity claim to structural validation plus live-catalog membership, so that boundary is honest.

The validate-specific success JSON is also honest: `catalogSource: "live"` means the locally resolved providers-config catalog, not a provider connection, and the help says that explicitly. `stateRoot` records the source used. The frozen-additive test was updated with both keys.

Two adjacent false claims remain, but neither is a validate/run disagreement:

1. README says both catalog aliases always exist, and init says its examples can run immediately. A supported one-model default can expose `cheap` but not `premium`, making both `validate` and `run` reject the shipped flowchart example.
2. A broken-catalog error tells the user to fix it with `models list`; that command is read-only and, for malformed `providers.json`, fails on the same parse.

`init` should remain **KEEP**, not REPLACE. Replacing the verb with checked-in examples would preserve the same broken `premium` reference while removing installed-binary access to the examples. KEEP does not mean “no cleanup needed”; its wording, atomicity, JSON formatting, and parser coverage still need repair.

## Why catalog parity is actually closed

- `run --flowchart` selects `values["state-root"] ?? defaultStateRoot()`, builds `buildLiveCatalogConfig(stateRoot)`, and passes its model ids to `parseFlowchartFile` (`src/cli/main.ts:688`, `src/cli/main.ts:698-703`).
- `validate --flowchart` now performs the same sequence (`src/cli/validate.ts:146-160`).
- Both default-root helpers are `join(homedir(), ".pi-sparkle")` (`src/cli/main.ts:172-174`, `src/cli/validate.ts:76-78`).
- The run later creates a calibrated router, but calibration maps the same models and changes only cost/latency fields (`src/routing/cost-calibration.ts:107-122`); it does not change catalog membership.
- Both paths therefore share the exact `validateFlowchart` and `assertFlowchartModelsInCatalog` implementation through `parseFlowchartFile` (`src/cli/flowchart-io.ts:23-29`).

I also drove the two public commands side by side:

| State/spec | `validate --flowchart` | `run --flowchart --executor fake` |
|---|---:|---:|
| `openai/gpt-4o-mini` enabled; node allows that concrete id | 0 | 0 |
| only `openai/gpt-4o-mini` set as primary; shipped init flowchart allows `premium` | 1 | 1 |

The rejection message in the second row was the same membership fact in both paths: `premium` is unavailable; catalog ids are `openai/gpt-4o-mini, cheap`.

The new unit test is directionally good: it proves an enabled concrete model passes in its state root and fails elsewhere (`test/unit/cli/validate.test.ts:172-218`). It does not invoke `run`, however. A future regression could make the two call sites diverge while this “parity” test stayed green. Add one side-by-side acceptance test, preferably the single-primary alias case.

## Remaining claim defects

### 1. README/init overstate alias availability

`buildLiveCatalogConfig` adds `cheap` whenever it has a fast row, but adds `premium` only when `primaryId !== fastId` (`src/cli/model-catalog.ts:64-75`). With:

```text
pi-sparkle models set-default --primary openai/gpt-4o-mini
```

`inferFastId(primaryId)` selects that same model, so the live catalog is the concrete id plus `cheap`, without `premium`.

That contradicts:

- README: “Catalog aliases are `cheap` / `premium`” (`README.md:142`).
- Init help: “write example specs you can run immediately” (`src/cli/init-examples.ts:15`).
- The generated/static flowchart, whose nodes both allow `premium` and whose second node prefers it (`src/cli/init-examples.ts:67-82`; `examples/sparkle-flowchart.example.json:9-24`).

The clean fix is in catalog construction: expose both semantic aliases even when they resolve to the same concrete model. That also matches the Pi executor, which already constructs both aliases from one primary (`src/cli/main.ts:215-229`). Pin the one-model catalog and run the init flowchart through the real validate path.

Until that lands, the README and “run immediately” wording are false. Commit `42b4c6c` correctly makes validate reject what run rejects; it merely makes this pre-existing catalog/init inconsistency visible.

### 2. Broken-catalog remediation is not actionable

On catalog construction failure, validate emits:

```text
fix the enabled models with pi-sparkle models list, or pass --state-root <dir>
```

(`src/cli/validate.ts:150-158`).

`models list` only reads and prints configuration (`src/cli/models.ts:61-94`). It cannot repair an unknown enabled model, and malformed `providers.json` makes it fail before printing anything. The failure JSON therefore carries a false `next` action. Point valid-but-unknown entries to `models disable <provider/model>`; malformed JSON needs explicit file repair/removal guidance.

### 3. Init KEEP still has independent contract debt

KEEP remains the better product decision, but these earlier findings remain:

- “Existing files are never replaced without `--force`” is not concurrency-safe: `existsSync` preflight is followed by ordinary `writeFile`, leaving a create-between-check-and-write overwrite window (`src/cli/init-examples.ts:128-145`).
- `INIT_EXAMPLES --json` is pretty-printed across multiple lines (`src/cli/init-examples.ts:147-160`), unlike the compact one-object machine surfaces. This is inconsistent, not semantically false.
- The children example test hand-checks fields instead of passing the file through `parseChildSpec` plus `compileChildrenToFlowchart`; only the flowchart example uses a real validator (`test/unit/cli/init-examples.test.ts:54-82`).
- `isHelp` scans every token, so `init --dir help` prints help instead of creating a valid directory named `help` (`src/cli/init-examples.ts:107-109`).

REPLACE would not fix the example contents because `examples/` is byte-pinned to the embedded constants. Keep the verb and repair these bounded defects.

## Verification

- `pnpm typecheck` — pass.
- `pnpm test -- test/unit/cli/validate.test.ts` — 12/12 pass.
- `pnpm test -- test/unit/cli/live-catalog.test.ts` — 2/2 pass.
- `pnpm test -- test/unit/cli/init-examples.test.ts` — 8/8 pass.
- `pnpm test -- test/unit/cli/main-dispatch.test.ts` — 5/5 pass.
- Manual validate/run matrix above — matching 0/0 and 1/1 decisions.

All commands emitted the already-recorded environment warning: host Node `22.14.0` is below the package engine floor `>=22.19.0`; no checked command failed.
