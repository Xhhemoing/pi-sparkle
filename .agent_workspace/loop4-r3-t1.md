claude-opus-5-thinking-high-fast

# Loop 4 · Round 3 · R3-1 — Invocation-row decoders fail closed instead of throwing TypeError

Branch `agent/opt-continuous`, working tree only (no commit, per instruction). Owned files touched: `src/telemetry/model-invocation.ts`, `test/unit/persist/row-fuzz.test.ts` (un-skip), `test/unit/telemetry/model-invocation.test.ts`, `test/unit/routing/cost-calibration.test.ts`. Nothing else edited.

## 1. Reproduced at HEAD before changing anything

A scratch driver over `invocationError` / `isInvocation` / `validateInvocation` at HEAD (`3473253`) confirmed the brief and found **two more cases** in the same defect class:

| Input | `invocationError` | `isInvocation` | `validateInvocation` |
|---|---|---|---|
| `config: null` | `TypeError: Cannot read properties of null (reading 'provider')` | **throws** | TypeError |
| `config` missing | `TypeError … undefined (reading 'provider')` | **throws** | TypeError |
| `config.modelVersion: 123` | `TypeError: config.modelVersion.trim is not a function` | **throws** | TypeError |
| `pricing: null` | `TypeError … null (reading 'catalogVersion')` | **throws** | TypeError |
| row is `null` / `undefined` | `TypeError … (reading 'id')` | `false` (guarded) | TypeError |

The last two rows are new relative to the brief: `config.modelVersion` was dereferenced with `.trim()` after only an `!== undefined` check (any non-string value is a TypeError), and `validateInvocation(null)` threw a TypeError rather than `DomainValidationError` — `isInvocation` happened to be shielded there by its own pre-guard, which is exactly why the fuzzer surfaced the `config` case and not this one.

The fuzz test's un-skip was also verified in the failing direction: with the fixed test file and the **HEAD** source restored, `test/unit/persist/row-fuzz.test.ts` fails with

```
[row fuzz] seed=0x4f320007 invocation-row validator iteration=11: TypeError: Cannot read properties of null (reading 'provider')
```

so the un-skipped case is a real regression test, not a test that passes for unrelated reasons.

## 2. Change

**`src/telemetry/model-invocation.ts`** — `invocationError` is now a *total* function: parameter widened to `unknown`, and every branch returns a message.

- Root guard: a non-record row (`null`, `undefined`, number, string, boolean, array) returns `invocation must be an object: <shape>` instead of dereferencing `.id`.
- `config` guard: `config must be an object: <shape>` for `null`, missing, string, number, array. Records still fall through to the existing per-field messages, so `provider`/`model`/`parameterHash` wording is unchanged.
- `config.modelVersion`: non-string now returns `invalid config.modelVersion: <shape>`; the empty-string case keeps its existing message (`config.modelVersion must not be empty when present`), so no existing assertion moved.
- `pricing` guard: `pricing must be an object when present: <shape>` for `null`, string, number, array; `pricing: undefined` and an absent key still pass. The `catalogVersion` and per-rate messages are unchanged.
- Numeric checks (`tokensIn`/`tokensOut`/`latencyMs`/`attempt`/pricing rates) now narrow with `typeof … !== "number"` first. Behaviorally equivalent to the old `Number.isInteger`/`Number.isFinite` checks (both already return `false` for non-numbers) — it removes the `as number` casts the widened parameter type would otherwise have required.
- `describe(value)` helper renders rejected values for messages without coercing objects. `String()` on a null-prototype object throws, and this function's whole contract is "never throws"; it also turns `String([])` (empty string, previously an unreadable message) into `array`.
- `isInvocation` is now a one-line delegation with the doc comment stating the contract; its old inline null/object pre-guard moved into `invocationError` where it covers `validateInvocation` too.
- `validateInvocation` keeps its `ModelInvocation` parameter type and now throws exactly `DomainValidationError` for every input, including `null`.

**Signature note (deliberate, worth a reviewer's eye):** `invocationError(inv: ModelInvocation)` became `invocationError(value: unknown)`. That is what makes `isInvocation` honest — it is fed `JSON.parse` output, so a parameter type that promises `ModelInvocation` was a lie the callers were paying for. The cost is that a typo'd call site is no longer a compile error. All six existing call sites are in tests and still pass typed values. No frozen signature is involved (`invocationError` is not on the frozen list).

**`test/unit/persist/row-fuzz.test.ts`** — un-skip only, as scoped. The invocation case's two `skipUnowned(...)` calls became `failFuzz(...)`, and the test no longer takes a `TestContext`. Within the same loop it now also asserts that `isInvocation` neither throws nor disagrees with `validateInvocation` on the same candidate — the predicate is the surface that actually crashes production, so pinning only the validator would leave the reported defect half-covered. `skipUnowned` stays in the file (the feedback-row case still uses it), so no dead helper.

**`test/unit/telemetry/model-invocation.test.ts`** — new `describe` block, 18 cases: 6 non-object rows and 11 malformed `config`/`config.modelVersion`/`pricing` shapes, each asserting a matching message from `invocationError`, `isInvocation === false`, and `validateInvocation` throwing with `constructor === DomainValidationError` (exact class, not `instanceof`, so a TypeError regression cannot pass); plus one case pinning that `pricing: undefined` is still accepted.

**`test/unit/routing/cost-calibration.test.ts`** — new contract test `loadInvocationsFromStateRoot skips shape-drifted rows instead of crashing startup`. It writes ten bad rows (`null`, `42`, a bare string, `[]`, `config: null`, missing `config`, `config` as a string, non-string `modelVersion`, `pricing: null`, `pricing: 7`) **ahead of** one well-formed row and asserts exactly one row survives, i.e. a bad row does not abort the scan. It then runs `calibrateCatalogFromState` over the same state root to cover the real startup path (`loadInvocationsFromStateRoot` → `calibrateCatalogConfig` → the calibrated router) end to end rather than just the loader.

## 3. Verification (this VM, Node v22.14.0, pnpm 10.17.1)

- Owned tests, 3× (timing-sensitive fuzz): `44 pass / 0 fail / 0 skipped` each run. Fuzz file alone 3×: `5 pass / 0 fail / 0 skipped`, ~1.0–1.3 s (5 s timeout).
- Failing-direction check: fixed tests + HEAD source ⇒ fuzz fails at seed `0x4f320007` iteration 11, as quoted in §1.
- Neighbouring consumers of the changed module (not owned, run read-only to catch fallout): `test/unit/telemetry`, `test/unit/routing`, `test/unit/pi-adapter`, `test/integration/pi-adapter`, `test/unit/privacy/deletion.test.ts`, `test/integration/m3` ⇒ `406 pass / 0 fail / 1 skipped`. That one skip is the pre-existing `PI_SMOKE=1` real-provider gate, not a named defect skip.
- Scoped `eslint` on the four owned files: exit 0.
- Whole-tree `tsc --noEmit`: exit 0.
- No full `pnpm test` / `pnpm gate` run (parent's job).

**Skip-count effect on the parent's gate:** the Round 2 baseline was 2 skipped; R2-7's named invocation skip is now gone, so the expected new baseline is **1 skipped** (the `PI_SMOKE` gate) with one more test file case converted from skip to pass. Test count rises by 19 in the two owned test files (18 new fail-closed cases + 1 loader contract test).

## 4. Cross-slot transient observed (attributed, not touched)

Mid-slot, one `tsc --noEmit` run reported:

```
src/privacy/deletion.ts(269,21): error TS2339: Property 'staleAggregate' does not exist on type 'InvocationRewrite'.
src/privacy/deletion.ts(269,76): error TS2339: Property 'staleAggregate' does not exist on type 'InvocationRewrite'.
```

`staleAggregate` occurs nowhere else in the tree. This is R3-3 (`src/privacy/deletion.ts`) consuming a field R3-2 had not yet added to `InvocationRewrite` in `src/telemetry/invocation-log.ts` — a shared-tree ordering transient between two other slots, unrelated to this change. Not edited. It had cleared by the final `tsc` run, which is green.

## 5. Residuals and non-goals

- **Getter-based throws are still out of reach.** "`isInvocation` never throws" is now true for any value `JSON.parse` can produce, which is the reported blast radius. A hand-constructed object with a throwing getter or a throwing `Symbol.toPrimitive` would still escape; guarding that would mean wrapping the whole validator in a `try`, which converts genuine bugs into silent `false`. Not done deliberately.
- **Message text for object-valued fields changed** from `[object Object]` / `""` to `object` / `array`. No production code or test string-matches these (checked across the tree); only the owned test file matches invocation-error wording.
- **Writer side was already contained** and is unchanged: `appendInvocationRecord` still fails closed via `validateInvocation`, and the sink still catches. This slot only widened what the *reader* survives.
- **Not in scope, not touched:** `src/telemetry/invocation-log.ts` (R3-2), `src/routing/cost-calibration.ts` source (only its test file is owned — the loader needed no change once `isInvocation` stopped throwing, which is the point of the fix). No `package.json`, no live R1, no Outcome-supported claim, no ADR-006 change, no auto-promote, no `file-lock.ts`, no jsonl signature touched. No git commit.
