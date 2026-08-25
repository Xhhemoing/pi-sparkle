[Model: gpt-5.6-sol-xhigh-fast]

# Loop 4 · Round 9 · R9-9 — post-deletion bandit isolation freeze

## Census before edits

The census covered all 215 TypeScript modules under `src/**` plus the existing
isolation test:

- `loadProjectBanditByKey` was declared in
  `src/learning/bandit-store.ts`; its only production consumer remained
  `src/cli/doctor.ts` (one import and one call).
- The exact retired identifier `\bloadProjectBandit\b` had no `src/**` match.
  The boundary deliberately did not match `loadProjectBanditByKey`.
- `selectArm` occurred only at its definition in `src/routing/bandit.ts` and at
  the import/call in `src/routing/shadow.ts`.
- The existing doctor `assert.match(..., /\bloadProjectBanditByKey\b/)` and the
  live-reader sweep using `\bloadProjectBandit(?:ByKey)?\b` were present.
- The signed-off wording “read-only inventory, never a selector” was present
  and unchanged.

The existing reader sweep does not imply the whole-source deletion pin: it
checks only the live import closure and deliberately excludes the store and
doctor. A distinct recursive `src/**` assertion was therefore required.

## Change

Only additive lines were made in
`test/unit/routing/live-isolation.test.ts` (+37/−0):

- Added a recursive TypeScript-module census rooted at `src`.
- Added one test pinning every non-definition `selectArm` occurrence to exactly
  `src/routing/shadow.ts`, which remains outside the live closure.
- In the same test, pinned the R8-9-deleted root-keyed reader to zero source
  occurrences with `/\bloadProjectBandit\b/`. The trailing word boundary means
  the live keyed reader does not false-positive.

The existing doctor assertion, widened readers sweep, and signed-off
justification were left intact. No live reader or routing behavior was added.
There was no edit to `src/**`, `doctor.ts`, `bandit-store.ts`, ADR-006,
`package.json`, or live R1.

## Post-edit census

- `src/**`: zero exact `\bloadProjectBandit\b` matches.
- `loadProjectBanditByKey`: store declaration plus doctor import/call only.
- `selectArm`: bandit definition plus shadow import/call only.
- Scoped diff: `test/unit/routing/live-isolation.test.ts` is +37/−0.

## Verification

- `pnpm exec eslint test/unit/routing/live-isolation.test.ts`: clean.
- Whole-tree `pnpm exec tsc --noEmit`: clean.
- `node --test --import tsx test/unit/routing/live-isolation.test.ts` run 3×:
  9/9 pass, 0 fail, 0 skipped on every run.
- `git diff --check`: clean.

Per dispatch, no full gate was run. The branch stayed
`agent/opt-continuous`; no checkout or git commit was made, and no scratch file
was created.
