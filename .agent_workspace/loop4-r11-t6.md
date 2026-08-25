[Model: gpt-5.6-sol-xhigh-fast]

# Loop 4 · Round 11 · R11-6 — live-isolation concurrent-src guard

## Census

The handed path `test/unit/routing/live-isolation.test.ts` exists. The initial
and final censuses recursively covered all **215** TypeScript modules under
`src/**`.

Final census against HEAD `98c2194` plus R11-1's working-tree diff:

- `loadProjectBanditByKey` remains confined to its declaration in
  `src/learning/bandit-store.ts` and the import/call in `src/cli/doctor.ts`.
- `selectArm` remains defined in `src/routing/bandit.ts`; its only other source
  module is `src/routing/shadow.ts` (import and call).
- Exact `\bloadProjectBandit\b` has zero `src/**` matches. The trailing word
  boundary deliberately spares `loadProjectBanditByKey`.
- The signed-off “read-only inventory, never a selector” justification and the
  existing allowlist `because` are unchanged.
- R11-1 added one source import, type-only `AcceptanceCriterion` in
  `src/run/replay.ts`. The transitive closure guard followed the resulting
  working tree and stayed green; it did not make any forbidden learned,
  shadow, R1, or holdout module reachable.

## Decision

No additive test change was needed. The existing file already:

1. walks the transitive closure from all four live entry points;
2. checks the learned-module allowlist and exact importer sets; and
3. uses the recursive 215-module `SRC_MODULES` census to pin `selectArm` to
   `routing/shadow.ts` and bare `loadProjectBandit` to zero.

R11-1's concurrent import therefore did not escape an existing pin. Adding a
duplicate assertion would not strengthen the property. `git diff --exit-code
-- test/unit/routing/live-isolation.test.ts` is clean; no existing pin was
deleted or weakened. This report is R11-6's only file addition. No `src/**`
file was edited.

## Verification

- `pnpm test -- test/unit/routing/live-isolation.test.ts`: **9/9 pass**, 0 fail,
  0 skipped, against the final R11-1 working tree.
- `pnpm exec eslint test/unit/routing/live-isolation.test.ts`: clean.
- Whole-tree `pnpm exec tsc --noEmit`: clean.
- `git diff --check`: clean.

Per dispatch, no full gate was run. The branch remained
`agent/opt-continuous`; no checkout, commit, or push was performed, and no
scratch file or skip was added.
