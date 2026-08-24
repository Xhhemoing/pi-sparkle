gpt-5.6-sol

# Loop 4 · Round 7 · R7-7 — supervised tracking dead branch

Baseline: current shared-tree `agent/opt-continuous` HEAD at the pre-edit census.
This agent did not change branches, commit, or push.

## Pre-edit ownership claim

Recorded after the census and before any source or test edit:

- sole source claim: `src/run/supervisor.ts`
- additive test claim: `test/unit/run/supervisor-dead-branch.test.ts`
- report: `.agent_workspace/loop4-r7-t7.md`

No other `src/**` or `test/**` file is claimed.

## Census first

- Exact repo-wide symbol search found `settleSupervisedOutcome` only at its
  definition and sole call in `src/run/supervisor.ts`, plus historical
  `.agent_workspace/**` reports/briefs and one unchecked historical plan.
- The sole production call is `finishSupervisedRun`; it does not pass
  `trackingAssessment`, `policyVersion`, or `expectedSeq`, so the helper returns
  at its `assessment === undefined` guard on every production invocation.
- Exact `trackingAssessment` search found only the optional property and its
  read in that helper. No test imports or calls the helper.
- Source import census found production consumers of `run/supervisor.ts` use
  only `resumeSupervisedRun`; test consumers use `startSupervisedRun`,
  `resumeSupervisedRun`, `runSupervisorRounds`,
  `reconstructSupervisorState`, or `planTaskTopology`. There is no barrel
  re-export, dynamic import, or namespace consumer of the dead helper.
- The real tracking-gate producers remain outside this path:
  `src/run/child-tracking.ts` derives a child assessment and calls
  `applyTrackingGate`; `src/run/gate-apply.ts` owns the gate operation. The
  supervised DAG plane has no assessment producer to wire into its settle tail.
- Consumer pins that read `supervisor.ts` source cover lease recovery,
  lifecycle-lock structure, and live-isolation import boundaries; none consumes
  or pins the dead helper. Removing its gate-only imports adds no import to the
  live closure.

Decision: delete the helper and its always-no-op call. Wiring a supervised gate
would add a new producer and behavior without an assessment source or parent
sign-off.

## Changes

1. Deleted the exported `settleSupervisedOutcome` helper and its sole,
   always-no-op call from `finishSupervisedRun`.
2. Deleted the helper's gate-only imports and types. The live child tracking
   producer and `gate-apply.ts` are unchanged.
3. Updated the settle-tail comment to its actual two operations: settle the
   bound episode, then materialize and write the final checkpoint.
4. Added a namespace-export absence pin. Reintroducing the removed seam under
   its old name now turns the owned test red unless a future change consciously
   replaces the pin with evidence of a live producer and caller.

R6-3's lifecycle lock, pre-flight placement, pre-rounds terminal-then-settle
path, crash settle, and resume ordering were not changed.

## Verification

- Owned absence-pin test, 3 consecutive runs: **1/1 pass, 0 fail, 0 skip**
  each run.
- Supervised lifecycle consumer suites (`supervisor`, `resume`,
  `supervisor-crash`, `supervised-lifecycle-lock`): **31/31 pass, 0 fail,
  0 skip** on the final run.
- Direct `supervisor.ts` source-pin consumers (`scheduler`,
  `live-isolation`): **19/19 pass, 0 fail, 0 skip**.
- Scoped ESLint on the owned source and test: clean.
- Scoped `git diff --check`: clean.
- Whole-tree `pnpm exec tsc --noEmit`: clean, 0 errors on the final run. Two
  intermediate rechecks attributed shared-tree transients to R7-9's then-new
  `empty-graph.test.ts` and R7-8's mid-migration `doctor.ts`; both owners
  completed their edits, and neither file was touched here.
- No full gate was run; it is the parent's responsibility.

The first adjacent M2 consumer run also caught R7-9's pre-rounds crash fixture
between its empty-graph validator change and its authorized fixture reseed
(29/31 pass). After its owner completed the reseed, the exact rerun was 31/31
green. No R7-9 file was touched here.

No dependency, branch, commit, or push operation was performed. No import was
added to the live closure, and no scratch file remains in the repository.
