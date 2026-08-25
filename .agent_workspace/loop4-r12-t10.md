[Model: gpt-5.6-sol]

# Loop 4 · Round 12 · R12-10 — checkpoint writer carriage

Status: **LANDED IN WORKING TREE**

## Census

At `2026-08-25T00:48:24Z`, the whole-`src` AST/source census found two
`materializeCheckpoint` calls with a third (flowchart) payload:

1. `src/run/flowchart-run.ts:689`, whose local `flowchart` initializer carries
   `contract`.
2. `src/run/flowchart-run.ts:2002`, whose inline payload carries `contract`.

There were zero `taskCriteria` mentions in `src/run/flowchart-run.ts`; R12-1's
writer had not landed at census time.

## Change

Added `test/unit/run/checkpoint-writer-carriage.test.ts`.

- Recursively parses every `src/**/*.ts` module.
- Selects every `materializeCheckpoint` call with a flowchart payload.
- Resolves identifier payloads to their nearest preceding initializer in the
  same function, matching the R10-4 property census rather than freezing a
  writer count.
- Guards against vacuity with `writers.length > 0`.
- Requires the `contract` property on every discovered payload.
- Requires `taskCriteria` as a property only when that payload AST mentions
  `taskCriteria`; a value/condition reference with a dropped or renamed
  property does not satisfy carriage. A payload that has never carried the
  field remains valid until R12-1 lands its writer.

No `src/**` file or `test/integration/m2.5/resume.test.ts` was edited.

## Successor after R12-1

A source-only conditional cannot remember a completely deleted optional writer:
allowing zero `taskCriteria` writers now and failing after the last writer is
later removed requires an activation assertion once R12-1 has landed. The
one-line successor is:

```ts
assert.ok(writers.some(({ payload }) => carriesProperty(payload, "taskCriteria")), "the source census must find a taskCriteria writer");
```

Place it after the existing `writers.length > 0` guard once the production
writer exists. The per-payload property check then remains the carriage rule;
the successor is only its non-vacuity guard.

## Verification

- `pnpm exec eslint test/unit/run/checkpoint-writer-carriage.test.ts` — PASS.
- `pnpm exec tsx --test test/unit/run/checkpoint-writer-carriage.test.ts` —
  PASS, 1/1, 0 skipped.
- `pnpm exec tsc --noEmit` — PASS for the whole working tree.
- No full gate was run.
- The owned test is structural, not timing-sensitive, so a 3× repetition was
  not applicable.
