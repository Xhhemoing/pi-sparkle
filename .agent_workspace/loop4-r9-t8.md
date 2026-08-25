[Model: gpt-5.6-sol-xhigh-fast]

# Loop 4 · Round 9 · R9-8 — resume reconstruction freeze

## Census before edits

- `flowchart-run-abort.test.ts` already had the behavioral rebuilt-spec pin:
  a resumed in-flight node reruns under the objective, artifacts, criteria,
  limits, and tester role recorded on the parent log.
- It already had the cascade pin: a resumed failed child restores the routed
  tiers and escalates from `cheap` to `premium`.
- The R6-2 tripwire already swept both verification kinds across all five child
  outcomes and asserted that check-coverage cannot reach `FAIL`. Its contract
  prose named `childTasksFromLog`.
- What was missing was structural enforcement. No test pinned the
  `resumeLockedFlowchartRun` call site to `childTasksFromLog`, and no assertion
  protected the tripwire's existence or its reference to that reconstruction
  seam.

## Change

Only additive lines were made in
`test/unit/run/flowchart-run-abort.test.ts` (+56/−0):

- Added one source pin scoped to `resumeLockedFlowchartRun`. It requires exactly
  one `childTasksFromLog` call with `read.events`, the checkpoint definition,
  registry, and model catalog, and requires resumed execution's child map to be
  built from that result.
- The same test reads the test module and freezes the older R6-2 tripwire by
  title, its `childTasksFromLog` reference, both verification kinds, all five
  child outcomes, and the assertion that `FAIL` is unreachable.
- The existing rebuilt-spec, cascade, gate-verdict, and FAIL-unreachable tests
  were not rewritten.

No `src/**`, ADR-006, live R1, `package.json`, or check-coverage behavior was
changed.

## Verification

- `pnpm exec eslint test/unit/run/flowchart-run-abort.test.ts`: pass.
- Whole-tree `pnpm exec tsc --noEmit`: pass.
- `pnpm test -- test/unit/run/flowchart-run-abort.test.ts`: 23/23 pass,
  including the existing rebuilt-spec and cascade pins.
- `git diff --check`: pass.

No existing timing-sensitive test was touched, so the 3× timing rerun rule did
not apply. No full gate was run. The branch stayed `agent/opt-continuous`; no
checkout or git commit was made, and no scratch file was created. Unrelated
working-tree changes from concurrent R9 slots were left untouched.
