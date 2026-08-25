# Loop 5 · Round 3 — First-run catalog honesty: implementer spec

Author: Fable-catalog-honesty (claude-fable-5). Analysis/spec only — no `src/` edits, no commit by this agent.

Written at HEAD `cd6f834` on `cursor/pi-sparkle-sota-opt-0da8`. Sources: R2 review §3 rank 3, GPT-validate recheck (`loop5-r2-gpt-validate.md` §§1–2), direct reads of `src/cli/model-catalog.ts`, `src/routing/primary-catalog.ts`, `src/cli/validate.ts`, `src/cli/init-examples.ts`, `src/cli/main.ts` (executor alias construction, run/track catalog call sites), `src/cli/models.ts`, `src/config/providers-config.ts`, `src/supervisor/model-router.ts`, `src/routing/{live-selection,assign,assign-plan,cost-calibration}.ts`, `src/track/loop.ts`, and every test that pins any of them. Live repro executed at HEAD (§1).

## Verdict

**HIGH VALUE — implementable without freeze breaks.** The `primaryId !== fastId` guard is **not load-bearing**; §2 proves it from code. The batch is four bounded changes: one conditional dropped in `src/cli/model-catalog.ts`, one `next:` string in `src/cli/validate.ts`, one new parity test file, and test additions in three existing test files. **No edit to `main.ts`, README, `init-examples.ts`, `primary-catalog.ts`, `package.json`, or any example file** — the code fix makes the existing README/init claims true as written, which also zeroes out the PR #12 collision risk this item inherited (§6).

---

## 1. Defect, reproduced live at HEAD

Script: temp state root → `setDefaultModels(stateRoot, { primary: "openai/gpt-4o-mini" })` (exactly what `models set-default --primary openai/gpt-4o-mini` does — it also self-enables, `providers-config.ts:110-113`) → build the live catalog → validate and run the shipped init flowchart.

```text
one-primary catalog ids: openai/gpt-4o-mini, cheap
validate: exit 1 — flowchart node survey modelPolicy references unavailable model "premium"; CLI catalog: openai/gpt-4o-mini, cheap
run --executor fake: exit 1 — same message
empty-config catalog ids: cheap, premium
```

So at HEAD, a supported single-primary default (README's own `models set-default` path) makes three shipped claims false on first contact:

- README:142 — "Catalog aliases are `cheap` / `premium`."
- `INIT_USAGE` (`src/cli/init-examples.ts:15`) — "write example specs you can run immediately."
- `examples/sparkle-flowchart.example.json` / `FLOWCHART_EXAMPLE_JSON` — both nodes allow `premium`, the second prefers it (`init-examples.ts:67-85`).

Validate/run **parity holds** (both exit 1 with the same membership fact — the R2 landing did its job); the lie is in the catalog, not in a validate/run disagreement.

The cause is the guard:

```66:75:src/cli/model-catalog.ts
  if (fastRow !== undefined && !byId.has(DEFAULT_FAST_MODEL_ID)) {
    models.push({ ...fastRow, id: DEFAULT_FAST_MODEL_ID });
  }
  if (
    primaryRow !== undefined &&
    primaryId !== fastId &&
    !byId.has(DEFAULT_PRIMARY_MODEL_ID)
  ) {
    models.push({ ...primaryRow, id: DEFAULT_PRIMARY_MODEL_ID });
  }
```

With one primary and no fast, `inferFastId(primaryId)` returns `primaryId` (`primary-catalog.ts:69-73`), so `primaryId === fastId`, `cheap` is pushed (a copy of the primary row) and `premium` is suppressed.

## 2. The guard is not load-bearing — proof

Checked every consumer and every mechanism that could depend on `premium` being absent:

1. **The asymmetry is the tell.** The `cheap` alias is already pushed **unconditionally** (line 66) — in the one-model case it is already a duplicate-content copy of the primary row (same roles/caps/costs, different id). If a same-content alias row were harmful, `cheap` would already exhibit the harm. The guard only makes `premium` inconsistent with `cheap`; it protects nothing `cheap` doesn't already violate.
2. **Router:** `validateConfig` requires only unique ids and valid roles (`model-router.ts:135-150`). Alias rows have distinct ids. Routing filters by id membership and evaluates each row independently; nothing assumes rows map 1:1 to distinct underlying models.
3. **Selection stability:** `selectLiveModel` keeps the earliest catalog-order candidate on ties (`live-selection.ts:24-39`), and both `planAssignmentPolicy` sorts are stable ties-keep-order (`assign-plan.ts:31-37`). Aliases are **appended after** the enabled rows, and in the one-model case all rows have equal cost, so the concrete row keeps winning `primaryPreferredId` and `cheapestAssignableId`. Track/children assignments are byte-identical before and after the fix; only explicitly alias-preferring flowchart nodes newly resolve.
4. **Calibration:** `calibrateCatalogConfig` maps per-row and leaves zero-sample rows untouched (`cost-calibration.ts:97-123`). An alias row that never accrues invocations is inert — already true for `cheap` today.
5. **Executor:** the Pi executor **already constructs both aliases from one primary** — `premiumAlias = primary`, `cheapAlias = fast ?? premiumAlias` (`main.ts:221-242`). A routed `premium` resolves correctly at execution time with a single configured primary. The catalog suppression *contradicts* the executor rather than protecting it. (`--executor fake` ignores model ids entirely.)
6. **No suppression pin exists.** Grepped all of `src/` and `test/` for anything asserting `premium` absent from a one-model catalog: nothing. `live-catalog.test.ts` pins only the empty-config `[cheap, premium]` case and the two-model aliasing case. `assign.test.ts:102-110` pins a one-model catalog — but from `catalogFromPrimary`, which this fix does not touch (§3.1 scope).
7. **History:** the guard arrived in the original `09f325c` wip landing with no comment, no test, and no report justifying it.

Conclusion: no `NO_HIGH_VALUE` finding. Dropping the conjunct is safe and is the fix GPT-validate specified ("expose both semantic aliases even when they resolve to the same concrete model").

---

## 3. Changes

### C1 — Emit both aliases even when primary = fast

**File: `src/cli/model-catalog.ts`, lines 69-75 only.** Drop the `primaryId !== fastId` conjunct:

```ts
if (primaryRow !== undefined && !byId.has(DEFAULT_PRIMARY_MODEL_ID)) {
  models.push({ ...primaryRow, id: DEFAULT_PRIMARY_MODEL_ID });
}
```

Constraints the implementer must keep:

- **Append order stays `[...enabled, cheap, premium]`.** §2.3 depends on aliases following the concrete rows; do not prepend or reorder. In the one-model case both alias rows are copies of the primary row (id aside) — matching the executor, where both aliases resolve to the primary.
- `!byId.has(...)` guards stay (defensive only — enabled ids always contain `/` so can never equal an alias, but they're free).
- **Do not touch `catalogFromPrimary` / `primary-catalog.ts`.** Its one-model branch (`primary-catalog.ts:56-61`) is pinned at `models.length === 1` by `test/unit/routing/assign.test.ts:102-110` and feeds the eval-routing baseline (`eval-routing.ts:169`). It is also *not* part of this defect's surface: `buildLiveCatalogConfig` reaches its early-return (line 47-49) only when neither primary nor fast parses as `provider/model` — impossible from a stored config (`parseProvidersConfig` validates `primary`/`fast` through `parseModelRef`, `providers-config.ts:137-140`; `models set-default` likewise) and reachable only via `run --track --primary-model cheap`-style alias overrides, where the track plane compiles `allowedModels` from that same catalog's own ids (`track/loop.ts:168,175`) and therefore stays self-consistent. Scoped out; noted for the record.
- Do not touch `defaultCliModelRouterConfig` (static `[cheap, premium]`, pinned by `flowchart-cli.test.ts:24`) or `policyVersion` strings (`router-v1-live` / `router-v1-primary` — MODEL_ROUTED payloads carry them).

**New pin (same diff), `test/unit/cli/live-catalog.test.ts`:** one-model catalog test — `setDefaultModels(stateRoot, { primary: "openai/gpt-4o-mini" })` (no fast, no separate enable), then `assert.deepEqual(ids, ["openai/gpt-4o-mini", "cheap", "premium"])` (exact — this pins both the alias emission and the append order §2.3 relies on), and assert both alias rows carry `providerId: "openai"` and the concrete row's `estimatedCostUsd`.

### C2 — Fix the broken-catalog remediation text

**File: `src/cli/validate.ts`, line 157.** Current `next:` names read-only `models list`, which cannot repair an unknown enabled model and itself dies on malformed `providers.json`. Every failure reaching this catch is a `DomainValidationError` (`unknown model "X"` from `buildLiveCatalogConfig`, or `invalid providers.json at <path>` / shape errors from `loadProvidersConfig`), so one static-shape string with the real file path covers both classes honestly:

```ts
next: `disable an unknown enabled model with pi-sparkle models disable <provider/model>, repair ${providersConfigPath(stateRoot)}, or pass --state-root <dir>`
```

- Add the import: `providersConfigPath` from `"../config/providers-config.js"`.
- `models disable` genuinely repairs the unknown-model case: it filter-rewrites `enabled` and drops matching `primary`/`fast` (`providers-config.ts:85-98`).
- **Pin update in the same diff:** `test/unit/cli/validate.test.ts:240-243` asserts the old string verbatim — update it (the test already has `stateRoot` and imports `providersConfigPath`). Add one new case in the same file: `await enableModel(stateRoot, "nope/unknown-model")` (the function validates only ref *shape*, not catalog membership, so this writes cleanly), then assert validate fails with `unknown model` in `message` and `models disable` in `next`.
- No other surface pins this string: grepped `test/` for `models list` — only `validate.test.ts:242` (this pin) and an unrelated `api-config.test.ts` title. `blocked-next.test.ts` / `doctor-routed-next-freeze.test.ts` do not reference it. The `run` path's generic broken-catalog `next:` is a different string and out of scope.

### C3 — Side-by-side validate/run parity test (the GPT-validate rider)

**New file: `test/integration/cli/validate-run-parity.test.ts`** (integration, because it drives `run`; model the harness on `cli.test.ts`'s `withRoots` + `validate.test.ts`'s `capture`). Two tests, both driving `main()`:

1. **Single-primary alias case — the exact scenario GPT-validate named.** Temp state root; `setDefaultModels(stateRoot, { primary: "openai/gpt-4o-mini" })`; write `FLOWCHART_EXAMPLE_JSON` (import the constant from `init-examples.js` — this doubles as the "shipped example actually runs" proof) to a temp spec file. Assert:
   - `validate --flowchart <path> --state-root <root>` exits 0;
   - `run --project <tmp> --objective x --flowchart <path> --executor fake --state-root <root>` exits 0 and prints `COMPLETED`;
   - the run's `events.jsonl` contains a `MODEL_ROUTED` event with `"model":"premium"` (the `migrate` node prefers it) — proving the alias flows through the real router, not just parse-time membership.
2. **Divergence guard, negative side.** Same state root; mutate one node to `allowedModels: ["mystery"]`; assert **both** commands exit 1 and both stderr reports contain the same membership fact (`unavailable model "mystery"`). This is the "future regression could make the two call sites diverge while the parity test stayed green" hole from the GPT report — one test now fails if either side drifts.

### C4 — Feed the init examples through the real parsers

**File: `test/unit/cli/init-examples.test.ts`, additions only** (do not touch the byte-pin test at lines 100-105 or the existing hand-check — the hand-check pins field values the parser doesn't). One new test: run `initExamplesCommand` into a temp dir, then via `main()`:

- `validate --children <children path>` exits 0 — this is `parseChildSpec` + `compileChildrenToFlowchart`, the real run-path parsers the children example has never been fed through (GPT-validate §3, bullet 3);
- `validate --flowchart <flowchart path> --state-root <empty temp root>` exits 0 — the empty-config default catalog case;
- `validate --flowchart <flowchart path> --state-root <single-primary root>` exits 0 — the case C1 fixes; before C1 this asserts the current lie, so land it in the same diff as C1, after it.

With C1+C4 in place, `INIT_USAGE`'s "run immediately" and README:142's alias sentence are true as already written — **ship no doc edits in this batch.**

---

## 4. Exact file inventory

| File | Action |
|---|---|
| `src/cli/model-catalog.ts` | C1: drop one conjunct (lines 69-75) |
| `src/cli/validate.ts` | C2: `next:` string + one import (line 157 area) |
| `test/unit/cli/live-catalog.test.ts` | C1 pin: one-model catalog, exact id list + order |
| `test/unit/cli/validate.test.ts` | C2: update `next` pin (240-243); add unknown-enabled-model case |
| `test/integration/cli/validate-run-parity.test.ts` | C3: new file, two tests |
| `test/unit/cli/init-examples.test.ts` | C4: add real-parser test; existing tests untouched |

Nothing else. In particular **not** `main.ts`, README, `init-examples.ts` (src), `primary-catalog.ts`, `examples/*`, `package.json`, `docs/*`.

## 5. Freeze-pin ledger

Must update in the same diff (pins on surfaces this batch changes):

- `validate.test.ts:240-243` — the broken-catalog `next` string (C2).

Must stay green untouched — re-run these to prove no strain:

- `test/unit/cli/live-catalog.test.ts:19-27` — empty-config exact `[cheap, premium]` (early-return path unchanged).
- `test/unit/cli/flowchart-cli.test.ts:24` — static default catalog `[cheap, premium]` (`defaultCliModelRouterConfig` untouched).
- `test/integration/cli/cli.test.ts:550-582` — `/cheap, premium/` in the fail-closed message (empty state root — unchanged).
- `test/unit/routing/assign.test.ts:102-110` — `catalogFromPrimary` one-model `length === 1` (`primary-catalog.ts` untouched).
- `test/unit/routing/assign-plan.test.ts` — selection-semantics lock (§2.3: assignments unchanged because aliases append and ties keep order).
- `VALIDATE_OK` frozen-additive keys (`validate.test.ts:286-326`) — no key added/renamed; C2 changes only the *failure* `next`, not the success object.
- `INSPECT_SUMMARY` four keys (`test/integration/cli/inspect-summary.test.ts`), doctor routes (`doctor.test.ts`, `doctor-routed-next-freeze.test.ts`, `command-error-doctor.test.ts`), `blocked-next.test.ts` three-`next:` shape, `m1-replay`, `unblock-flow` — none of their producing code is touched; run as the standard frozen-pin sweep.
- Eight-member `RunStatus` (`src/domain/status.ts`), `EVENT_TYPES` (`src/run/events.ts`) — no new members, no new event types (MODEL_ROUTED payloads gain nothing; only which `model` id can appear in the one-model case, which is data, not schema).
- `package.json` — untouched: `private: true`, `files[]`, deps all preserved.
- Init byte pin (`init-examples.test.ts:100-105`, `examples/` ≡ constants) — no example content changes.
- No executor construction in new code paths; the parity test uses `--executor fake` only (no keys, no network).

Track-plane side effect, checked not pinned: compiled track nodes' `allowedModels` (`track/loop.ts:168,175`) gain `premium` in the one-model case. No track test pins that list's exact contents (all track/routing tests build `premium`/`cheap` catalogs, which are unchanged); assignments themselves are unchanged per §2.3.

## 6. PR #12 / #13 collision

Fetched PR [#12](https://github.com/Xhhemoing/pi-sparkle/pull/12)'s file list at spec time: it touches `src/cli/main.ts` (+316/−22), `README.md` (two command-table rows at ~159/168), `package.json`, `ci.yml`, inspection/adapt/redaction files and their tests. **Zero file overlap with this batch** — it touches none of `model-catalog.ts`, `validate.ts`, `live-catalog.test.ts`, `validate.test.ts`, `init-examples.test.ts`, and this batch ships no `main.ts`/README/`package.json` edit precisely so that stays true. The R1-flagged main.ts/README merge-order hazard therefore does not bind this batch. (PR [#13](https://github.com/Xhhemoing/pi-sparkle/pull/13) is this branch's own campaign PR; the touched files land through it as usual.)

One semantic note for whoever lands after #12: its `readme-command-parity.test.ts` asserts README/usage agreement on its branch — this batch changes neither surface, so no interaction.

## 7. Out of scope (deliberately)

- `catalogFromPrimary`'s one-model branch — pinned, baseline-feeding, unreachable from stored configs (§3.1). If a future round wants alias emission there too, it must renegotiate `assign.test.ts:102` and the eval-routing baseline in one diff.
- `INIT_EXAMPLES` compact/typed JSON, `commits preview --json`, init check-then-write race, `init --dir help` — R2 review §3 rank 4 and GPT-validate §3 residue; separate batch.
- README/doc wording — becomes true without edits; touching README here would only re-open the #12 hazard.
- The run path's generic broken-catalog `next:` and any doctor auth/catalog preflight — auth-slot territory.

## 8. Sequencing and verification

Land as **one commit** (C1–C4 are honesty-coupled: C4's single-primary assertion is false before C1; C2's pin update must ride its string change). Order inside the diff is free.

Verify: `pnpm typecheck`; then targeted — `live-catalog`, `validate`, `init-examples`, `flowchart-cli`, `assign`, `assign-plan`, `validate-run-parity` (new); then the frozen-pin sweep (`inspection`, `inspect-summary`, `blocked-next`, `main-dispatch`, `m1-replay`, `unblock-flow`, `doctor*`); then full suite. Expect the standing Node 22.14.0 < `>=22.19.0` engines warning; nothing gates on it.

---

**Bottom line:** the batch is implementable now, without freeze breaks, in six files, with no shared-file exposure to PR #12. The suppression guard is dead weight with a false-claims blast radius; removing one conjunct plus one honest `next:` string closes GPT-validate defects 1 and 2, and the two new test surfaces (parity file, real-parser init feed) close its two named test gaps.
