[Model: gpt-5.6-sol-xhigh-fast]

# Loop 4 · Round 8 · R8-3 — flowchart `applyRetry` absence pin

Result: the additional negative pin is in place. The flowchart state machine
cannot import the DAG scheduler or reference `applyRetry` in either owned
flowchart source without turning the test red.

## Ownership

Owned changes are limited to:

- new `test/unit/run/flowchart-applyretry-absence.test.ts`
- this report, `.agent_workspace/loop4-r8-t3.md`

No `src/**`, `test/unit/run/scheduler.test.ts`, `package.json`, ADR-006, or live
R1 file was edited. This agent stayed on `agent/opt-continuous` and did not
commit, checkout, or push.

## Census first

The exact `applyRetry` source census found:

1. `src/run/scheduler.ts` defines `applyRetry` and mentions it in its own
   documentation.
2. `src/run/supervisor.ts` has the only production import and the only
   production call site. The call is in `recordRetry` inside
   `executeSupervisorRounds`, reached through `runSupervisorRounds`.
3. `src/run/flowchart-run.ts` neither imports `scheduler.ts` nor names
   `applyRetry`.
4. `src/supervisor/flowchart-supervisor.ts` neither imports `scheduler.ts` nor
   names `applyRetry`.
5. `src/run/gate-apply.ts` neither imports nor names `applyRetry`.
6. The only non-production calls are scheduler-focused tests in
   `test/unit/run/scheduler.test.ts` and `test/integration/m2/scheduler.test.ts`.

The final pre-report census found no `RUN_UNBLOCKED`, unblock function, or
flow-node reopen helper in either pinned flowchart source. R8-1 had therefore
not yet landed that helper in the shared tree; the pin targets both files'
current import graphs as prescribed.

## Added pin

The new test parses both flowchart sources with the TypeScript AST and rejects:

- every static import/re-export or dynamic import of `scheduler.js`, including
  a namespace import that does not yet spell `applyRetry`; and
- every executable identifier or exact computed-property string named
  `applyRetry`, including an aliased named import or a reopen helper call.

The pin is mutation-checked against two synthetic regressions: a scheduler
namespace import in `flowchart-run.ts`, and a future `reopenFailedNode` helper
calling `applyRetry` in `flowchart-supervisor.ts`. Both are rejected. This is
additional to the frozen scheduler sole-producer pin; the scheduler test stayed
byte-identical.

## Verification

- Owned test: **2/2 pass, 0 fail, 0 skip**.
- Scoped ESLint on the new test: clean.
- Whole-tree `pnpm exec tsc --noEmit`: clean.
- `git diff --check`: clean.
- `git diff --exit-code -- test/unit/run/scheduler.test.ts`: clean.
- No full gate was run.
- No scratch file was created.

The test command emitted the repository's existing engine warning because the
VM runs Node `22.14.0` while `package.json` requests `>=22.19.0`; the scoped
tests passed.
