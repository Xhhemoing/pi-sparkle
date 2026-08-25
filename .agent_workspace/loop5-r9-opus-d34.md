# Loop 5 · Round 9 — D34 implementation report (Opus-d34-models-preflight, rank 1)

Slot: Loop 5 Round 9 rank 1. Branch `cursor/models-id-preflight-0da8`, based on
`origin/cursor/pi-sparkle-sota-opt-0da8` at `764e1ad` (`docs(agent): record D34–D36; open Round 9`).
Not merged into the integration branch; opened as a draft PR with base
`cursor/pi-sparkle-sota-opt-0da8`.

Spec implemented: `.agent_workspace/loop5-r9-fable-next.md` Rank 1 (D34), in full and as written.

## Files changed

- `src/cli/models.ts`
- `test/unit/cli/models.test.ts`
- `.agent_workspace/loop5-r9-opus-d34.md` (this report)

Nothing else. `src/config/model-ref.ts`, `src/config/providers-config.ts`,
`src/pi-adapter/listed-model.ts`, `src/cli/main.ts` and `package.json` are byte-untouched;
`listed-model.js` gains only a type-only import in `models.ts` (`import type { SparkleListedModel }`),
which is erased at compile and leaves the module's dynamic `import()` at each call site as it was.

## 1. Malformed `<provider/model>` / `--primary` / `--fast` (four sites)

Guarded with the already-exported `tryParseModelRef` — the domain's own predicate, so the shape is
asked about rather than restated. On `undefined`, `cliFail` fires before any config read.

| site | `command` | `message` |
| --- | --- | --- |
| `enable <id>` | `models enable` | `invalid <provider/model> "<v>": expected a model id of the form provider/model` |
| `disable <id>` | `models disable` | same, `models disable` |
| `set-default --primary` | `models set-default` | `invalid --primary "<v>": …` |
| `set-default --fast` | `models set-default` | `invalid --fast "<v>": …` |

`stage: "parse-args"` on all four. `next` is
`pass <provider/model> as printed by pnpm cli models list --available --state-root ${stateRoot}` for
the positionals and `pass --primary <provider/model> as printed by …` (resp. `--fast`) for the flags.
`--primary` is checked before `--fast` (pinned). No `runId` key on any report (pinned explicitly).

Placement: after the existing D21 missing-argument refusals, whose bytes do not change, and after
`stateRootOf(values)` — which reads argv, not the state root — so the blank positional `""` folds
into this guard (`"" !== undefined`, does not start with `-`, does not parse) and nothing opens
`providers.json`. The downstream `parseModelRef` calls in `providers-config.ts` become
unreachable-throw and were left in place.

## 2. Unknown model returns instead of throwing

`assertKnownCatalogId` now returns `SparkleListedModel | undefined` rather than throwing
`DomainValidationError`; the refusal moved into the three call sites (enable, set-default
`--primary`, set-default `--fast`). `stage: "validation"` — catalog membership is stored config plus
catalog state, not CLI knowledge (D32's unknown-`--nodes` precedent). Message bytes are exactly
`unknown model "${catalogId}"`, so the `/unknown model/i` pin at `test/unit/cli/api-config.test.ts:128`
holds with no edit (re-run green). `next` is
`pass an id printed by pnpm cli models list --available --state-root ${stateRoot}; providers.json customProviders adds ids the builtin catalog does not have`.

Both set-default assertions run before `setDefaultModels`, so a refused `--fast` writes nothing —
pinned against `providers.json` bytes, for the unknown-`--fast` and the malformed-`--fast` cases.
`models.ts` no longer imports `DomainValidationError` (it had no other user).

## 3. Honest disable

`disableCommand` already loaded `before`; the claim is now keyed on it. When
`before.enabled` does not include `formatted`, stdout is
`${formatted} was not enabled; nothing to disable (pnpm cli models list --state-root ${stateRoot} shows the enabled models)\n`
and the exit code stays 0 (idempotent re-run stays safe — the `auth logout` D21 F9 and `pause --clear`
D20 precedent). When it does, `Disabled ${catalogId}\n` is byte-identical, so `models.test.ts:161`
and `:177` hold unchanged.

`disableModel` is still called in both branches: a hand-edited config can hold a `primary`/`fast`
equal to an id not in `enabled`, and dropping that dangling default is real work. The D21 F9
dropped-default note keeps firing for it — pinned by a fixture whose `enabled` is `["local/m2"]` and
whose `primary` is `local/m1`, asserting no `Disabled` claim *and* the primary-default note *and*
that `list` afterwards shows `local/m2` with no tag.

## 4. `list --provider` without `--available`

`cliFail` `command: "models list"`, `stage: "parse-args"`, message
`models list --provider filters the --available catalog and does not apply to enabled models`,
`next: "add --available, or drop --provider"`. Placed at the top of `listCommand` after `--help`,
before `loadProvidersConfig` and before any JSON assembly, so `MODELS_LIST` is byte-identical on
every path that prints it (the D27 deepEqual pins re-run green, and the refusal is pinned with and
without `--json` to assert stdout is empty in both).

Refused rather than made to filter: filtering the enabled view would be a new feature on a
frozen-additive contract; the silent ignore is the defect (D25 refuse-don't-ignore precedent).

## Tests

`test/unit/cli/models.test.ts` goes 17 → 25 cases, all green
(`npx tsx --test test/unit/cli/models.test.ts` → `# pass 25 / # fail 0`). New cases:

- whole-field `parseCliErrorJson` pins (command/stage/message/next, plus `runId === undefined`) on
  all four malformed sites, including `""` on the positionals and `--primary`, and a `trailing/`
  case so the guard is provably the domain predicate and not a substring check;
- `--primary`-before-`--fast` precedence;
- argv-before-config order: the nonexistent `--state-root` from the spec, and additionally an
  unparseable `providers.json` in the state root — loading it would throw past the verb, so a
  `parse-args` report is proof nothing read it (asserted for enable, disable and set-default, with
  the corrupt bytes still on disk afterwards);
- unknown-model whole-field pins on all three sites against a seeded custom-provider config;
- refused `set-default --fast` (unknown and malformed) with `providers.json` bytes unchanged;
- not-enabled disable: exit 0, the exact honest line, no `Disabled` substring anywhere,
  `providers.json` bytes unchanged, and the enabled list unchanged;
- the dangling-default fixture described above;
- the `--provider` refusal with and without `--json`, plus a re-assertion that plain `list` still
  works.

Existing pins hold untouched: the D21 five missing-argument reports, the D27 `MODELS_LIST`
deepEquals (enabled, empty, available, `--available --provider`), the `--available --provider`
filter pins, the deliberately-pinned `(no models)` for an unknown `--available` provider, both
`Disabled` bytes, the mistyped-flag parse-args pins, and the unknown-subcommand dialect pin.

## Verification

- `npx tsx --test test/unit/cli/models.test.ts` — 25/25 pass.
- `npx tsx --test test/unit/cli/api-config.test.ts test/integration/cli/commands.test.ts test/unit/cli/validate.test.ts test/unit/cli/auth.test.ts test/unit/config/model-ref.test.ts test/unit/config/providers-config.test.ts`
  — 63/63 pass (every neighbouring file that exercises the `models` verb or the config plane it
  writes).
- `pnpm typecheck` (`tsc --noEmit`) — clean.
- `pnpm lint` (`eslint .`) — clean.
- `pnpm test` (full suite) — 2324 tests across 125 suites: 2323 pass, 0 fail, 1 skipped (the skip
  is pre-existing and unrelated).

## Freeze / scope

`MODELS_LIST` byte-identical; no new Event type and no new JSON key anywhere; no `main.ts` edit, so
the blocked-next prefix and the crash probe are untouched; no plane-file edit, so the
`providers-config` and `listed-model` pins are untouched; `package.json` untouched. No auth,
network, or access-control change — the verb's existing `providers.json` writes are the only
mutations, and two of the four changes strictly remove writes from refusal paths. D21 (missing
arguments) and D27 (JSON contract + `parseArgs` dialect) are reopened only for the value-domain
defects neither covered. Disjoint from Ranks 2 (`auth.ts`) and 3 (`validate.ts`) and from PR #12's
file list.
