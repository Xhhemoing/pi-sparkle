# Loop 5 · Round 11 — D41 (rank 3): `inject` flag relevance and `--value` domain

Branch `cursor/inject-value-relevance-0da8` off
`origin/cursor/pi-sparkle-sota-opt-0da8` at
`05566af` (`docs(agent): record GPT-r11 FIX riders; reorder D40→D42→D41`).

Implemented **D41 as corrected by GPT-r11-challenge**, not raw Fable. GPT moved
this batch to rank 3: every bad input here already fails without appending an
injection, so the defect is classification, state-read ordering, and remedy
quality — not a durable write.

Files: `src/cli/inject.ts`, `test/integration/cli/pause-inject.test.ts`, this
note. `src/run/injection.ts`, `src/cli/main.ts`, and `package.json` untouched;
the plane's rules are imported, not restated.

## What changed

1. **Flag relevance → `parse-args`.** After the per-type required-flag checks
   and before the confidence conversion, `--type override` or `--type skip`
   carrying `--key` or `--value` is refused with
   `message: 'inject --type ${type} does not accept ${flag}'`,
   `next: 'drop ${flag}; --key and --value apply to --type fact'`,
   `runId: values.run`. Previously the plane's relevance rule fired after the
   run lookup as `injection key is not valid for skip`, `stage: "validation"`,
   with the doctor preflight remedy and no flag named. `--node` on a `fact` and
   `--confidence` on every kind stay legal — both are plane-accepted, so the
   guard names only the two flags it actually refuses.
2. **`--value` domain → `parse-args`, single call.** `parseFactValue` is
   hoisted out of the request assembly into a narrow try after the blank
   key/node/actor loop and **before** the D37 blank-root guard, catching
   `DomainValidationError` only and rethrowing anything else. Refusal is
   `message: 'invalid --value "${raw}": fact value must be a JSON scalar or
   bare string; objects, arrays, and null are refused'`,
   `next: 'pass --value <json-scalar|text> as documented in pi-sparkle inject
   --help'`. The parsed result is what the request carries, so the string is
   decoded exactly once. `--value ""` stays accepted (`isFactScalar("")` is
   true); `--value 1e999` is refused because it parses but is not finite.

## The GPT complete-argv pin

This is the binding correction to Fable. Fable's mixed-case test used the
abbreviated literal `--type fact --value '{"a":1}' --state-root ""`, which
omits both the command's required `--run` and `fact`'s required `--key`. That
argv cannot prove value-before-root ordering: it would be refused by the
missing-required-flag guard long before either the value or the root is
reached, so the pin would pass for the wrong reason.

The pin here uses the **complete** argv GPT specified, with a syntactically
valid run id and `--key` present:

```
inject --run run_missing0001 --type fact --key k --value '{"a":1}' --state-root ""
```

It asserts all four refusal fields are the `--value` fault, that neither
`state root` nor `not found under` appears, and — because a blank root resolves
to the process working directory — that a temp cwd is still empty afterwards.
That empty directory is the evidence no state was read or created.

## Ordering, all pinned

1. D30 unknown `--type` still first: `--type banana --key k --value '{"a":1}'`
   still reports `unknown --type "banana"`.
2. D31 blank `--key` still wins over an invalid fact value: `--key=` with
   `--value '{"a":1}'` reports the blank key.
3. Value domain is root-free argv work, so it precedes D37's blank-root guard
   (the complete-argv pin above). D37's own pins, including
   `pause --run banana --state-root ""`, are in another module and unchanged.

## Tests

Six new tests in `pause-inject.test.ts`, whole-field pins throughout:

- skip/override × `--key`/`--value` relevance, all four fields plus `runId`,
  asserting no `doctor` and no `not valid for` in stderr;
- `--value` `'{"a":1}'`, `'[1,2]'`, `'null'`, `'1e999'`, all four fields;
- `--value ""` still injects (exit 0, prints `facts: empty=`);
- a fact carrying `--node work` and fact/skip carrying `--confidence 0.5` still
  reach the plane at exit 0 — the relevance guard does not oversweep;
- D30/D31 precedence over the value domain;
- the GPT complete-argv value-before-root pin with the empty-cwd proof.

Every refusal pin compares the run's `events.jsonl` **byte-identical** before
and after (new `readEventsText` helper; the existing line-count helper now
reads through it).

## Verification

- `npx tsx --test test/integration/cli/pause-inject.test.ts` → **40/40 pass**
  (34 baseline unchanged + 6 new).
- `npx tsc --noEmit` → clean.

## Freeze

No live R1, no `main.ts`, no plane edit, no new stage value, no JSON surface on
`inject`. `INJECT_USAGE` bytes untouched — it already documented the value
domain and the per-type flags, and the behavior now matches what it says.
Operator-contract language only. `inject.ts` reopened outside D30's closed
scope (type/confidence), D31's (blank key/node/actor, run shape), and D37's
(blank root); none of them classified the `--value` domain or flag relevance.
File-disjoint from D40 (`src/cli/commits.ts`) and D42
(`src/cli/episode.ts`), and from PR #12.
