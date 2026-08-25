[Model: gpt-5.6-sol]

# Loop 4 · Round 12 · R12-8 — live-isolation concurrent-src guard

## Census

The handed path `test/unit/routing/live-isolation.test.ts` exists. Initial and
final recursive censuses covered all **215** TypeScript modules under `src/**`.

Final census against HEAD `03f4b74` plus R12-1's working-tree source diff:

- The four live entry points reached **165** modules. Of the watched routing
  modules, only `src/routing/bandit.ts` and `src/routing/topology.ts` were
  reachable, through exactly `src/learning/bandit-store.ts` and
  `src/run/supervisor.ts`, respectively. R1, shadow, shadow-report, offline
  shadow comparison, and holdout simulation remained outside the closure.
- R12-1 added only the type symbol `TaskAcceptanceCriteria` to
  `flowchart-run.ts`'s existing `./replay.js` import. Its edits in
  `flowchart-run.ts`, `track/loop.ts`, and `cli/main.ts` introduced no new
  relative-module edge, so the live closure stayed at 165 modules.
- `loadProjectBanditByKey` remains confined to its declaration in
  `src/learning/bandit-store.ts` and the import/call in `src/cli/doctor.ts`.
- `selectArm` remains defined in `src/routing/bandit.ts`; its only other source
  module is `src/routing/shadow.ts` (import and call).
- Exact `\bloadProjectBandit\b` has zero `src/**` matches. The trailing word
  boundary deliberately excludes `loadProjectBanditByKey`.
- The signed-off allowlist `because` remains exactly “adaptation-plane reward
  writer only; the exploratory selectArm path is not reachable”; the
  read-only-inventory/never-a-selector justification is also unchanged.

## Decision

No additive test change was needed. The existing nine tests already walk the
transitive closure, pin the watched-module allowlist and exact importer sets,
and recursively census all source modules for `selectArm` and bare
`loadProjectBandit`. R12-1's import remained on an existing in-closure edge, so
another assertion would duplicate an existing property.

`test/unit/routing/live-isolation.test.ts` is byte-identical to HEAD (both blob
ids `1fa52a1b791d1851c9f45c22498bccd76a0bb9df`); no pin or signed-off
justification was deleted or weakened. This report is R12-8's only addition.
R12-8 edited no `src/**` file.

## Verification

- `pnpm test -- test/unit/routing/live-isolation.test.ts`, three consecutive
  runs: **9/9 pass** each (**27/27 aggregate**), 0 fail, 0 skipped.
- `pnpm exec eslint test/unit/routing/live-isolation.test.ts`: clean.
- Whole-tree `pnpm exec tsc --noEmit`: clean.
- `git diff --check`: clean.
- `git diff --exit-code -- test/unit/routing/live-isolation.test.ts`: clean.

Per dispatch, no full gate was run. The branch remained
`agent/opt-continuous`; no checkout, commit, push, scratch file, or skip was
added. The only command warning was the standing Node engine mismatch
(`v22.14.0` vs package requirement `>=22.19.0`).
