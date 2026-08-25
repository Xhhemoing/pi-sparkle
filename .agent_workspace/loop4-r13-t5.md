# Loop 4 Round 13 — R13-5 live-isolation report

## Outcome

Report-only. I did not edit `test/unit/routing/live-isolation.test.ts` or any
`src/**` file. The existing transitive-closure and whole-`src` pins already
cover the Round 13 mandate; another symbol-name assertion would duplicate
those pins without strengthening the contract.

## Census

- Branch remained `agent/opt-continuous`.
- At the initial census, the working tree was clean and
  `git diff -- src/cli/main.ts` was empty.
- Final shared-tree recensus at `2026-08-25T01:29:29Z` observed concurrent
  sibling work in `docs/specs/m0-m2-architecture.md`,
  `docs/status-matrix.md`, `src/run/replay.ts`,
  `test/integration/run/criteria-gate.test.ts`, and sibling reports
  `loop4-r13-t6.md` through `loop4-r13-t10.md`. Neither
  `src/cli/main.ts` nor `test/unit/routing/live-isolation.test.ts` had a diff.
  Thus no in-flight R13-3 `main.ts` diff was available at either census.
- The live closure remains **165 of 215** `src` TypeScript modules.
- The reachable learned-routing allowlist remains exact:
  - `src/routing/bandit.ts`, imported in-closure only by
    `src/learning/bandit-store.ts`;
  - `src/routing/topology.ts`, imported in-closure only by
    `src/run/supervisor.ts`.
- R1, routing shadow, R1 shadow report, shadow comparison, and holdout
  simulation remain outside the live closure.
- `bandit-store.ts` imports only `BanditState`, `createBanditState`, and
  `recordReward` from `routing/bandit.ts`.
- `loadProjectBanditByKey` occurs only at its `bandit-store.ts` definition and
  the doctor inventory import/call. Bare `loadProjectBandit` has zero `src`
  matches.
- `selectArm` occurs only at its definition plus the import/call in
  `src/routing/shadow.ts`; it has no live-closure caller.
- Topology remains parked: `decideTopology` is defined in `topology.ts` and
  imported only by `supervisor.ts` for the single `planTaskTopology` wrapper;
  the live loop has no caller.
- Current `main.ts` has only the existing track-path `onRunStarted` handler.
  It imports `BANDIT_STATE_UNREADABLE_CODE` for error routing, not a bandit
  reader or selector. The expected R13-3 callback-only additions were not
  present to census, but would add no import edge.
- The two signed-off `because` strings are unchanged.

## Verification

- `pnpm exec eslint test/unit/routing/live-isolation.test.ts` — exit 0.
- `pnpm exec tsc --noEmit` — exit 0.
- Owned test, three independent runs:
  1. 9 passed, 0 failed, 0 skipped.
  2. 9 passed, 0 failed, 0 skipped.
  3. 9 passed, 0 failed, 0 skipped.

Each owned-test run emitted only the baseline Node engine warning
(`>=22.19.0` wanted; VM is `v22.14.0`).
