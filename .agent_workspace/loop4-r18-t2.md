[Model: claude-opus-5-thinking-high-fast]

# Loop 4 · Round 18 · R18-2 — `run --children` carries a declared `maxCostUsd`

Branch `cursor/opt-r18-postmerge-42b1` (no checkout, no commit, no push — parent commits).
Base HEAD `101e4bb`. Sibling R18-1's working-tree edits (`src/pi-adapter/pi-executor.ts`,
new `test/integration/pi-adapter/steer-retry.test.ts`) were present alongside mine and are
disjoint; I touched neither.

## Census (before editing)

- `src/cli/main.ts:420-424` at HEAD copied exactly `maxAttempts`/`timeoutMs`/`maxWallTimeMs`;
  `limits.maxCostUsd` had no reader in the parse. Confirmed.
- Forwarding downstream exists and is load-bearing: `child-coordinator.ts:413-418 costCapFor`
  = `min(per-task, run-level)`, stamped at `:436` (child `RUN_CREATED.limits`) and `:669`
  (`AgentExecutionRequest.maxCostUsd`). `protocol/v1.ts:75-89 ChildRunLimits` validates the
  field as positive-finite. So the drop was localized to the parse, as the audit said.
- Consumer census for the parse output: `parseChildSpec` has exactly one caller
  (`main.ts:932`, the `--children` branch), which feeds `smartChildPlan` →
  `startFlowchartRun({ childTasks })` → `ChildCoordinator`. `smartChildPlan` spreads the child
  through untouched (`...child`), so the new field survives routing.
- No test or script reads `docs/specs/m0-m2-architecture.md` (`rg` over `test/`, `scripts/`),
  so the doc edit has no pinned consumer. No child spec anywhere in `test/` declared
  `maxCostUsd` before this slot, so no existing fixture changes shape.
- Every handed path existed at HEAD.

## Files changed (3, all inside the grant)

| File | Change |
|---|---|
| `src/cli/main.ts` | New `parseChildCostCeiling(taskId, value)` immediately above `parseChildSpec`; one call site inside the task mapper; conditional spread into the built `limits`. Nothing outside the `parseChildSpec` region touched — `runCommand`, doctor routes, `INSPECT_SUMMARY`, `onRunStarted` and the preference lock are byte-identical. |
| `test/integration/m1/cli-children.test.ts` | Two new tests + two local helpers (`readEventLog`, `runDirectoryNames`) and a `readdir` import. The eight existing tests are unchanged in text and intent. |
| `docs/specs/m0-m2-architecture.md` | The two stale lines (359-360) rewritten only. |

Behaviour: a positive finite `maxCostUsd` is copied; **any** other non-`undefined` value
(`0`, negative, string, `null`) is refused with
`DomainValidationError: Child task <taskId>: limits.maxCostUsd must be a positive finite number`.
Absent stays absent — no invented cap. The fake-children executor ignoring the forwarded cap is
left exactly as pinned; nothing in this diff asserts enforcement, only carriage.

Doc rewrite mirrors the `159630e` disclosure (`ChildRunLimits` docstring): forwards the tighter
of per-task and run-level to the executor, stamps the effective cap into the child's
`RUN_CREATED.limits`, `PiAgentExecutor` prices observed usage and stops before another turn,
an executor that cannot price leaves it unenforced — best-effort per-execution cap, not a
cross-child ledger. No other surface census-noted.

## Tests added

1. `run --children carries a declared maxCostUsd to the child run and its TASK_REQUEST` —
   real `main()` end-to-end with the default fake-children executor, spec declares
   `maxCostUsd: 0.25`; then reads the **state root back off disk**: the parent's
   `events.jsonl` `CHILD_MESSAGE`→`TASK_REQUEST.limits.maxCostUsd === 0.25` (exactly one
   request) and the child's `events.jsonl` `RUN_CREATED.payload.run.limits.maxCostUsd === 0.25`
   (exactly one `RUN_CREATED`).
2. `run --children refuses a non-positive maxCostUsd naming the task and writes no run` —
   four declared values (`0`, `-1`, `"0.25"`, `null`; JSON cannot carry `NaN`/`Infinity`, so
   `null` is the real "not a number" shape), each in a fresh state root: exit non-zero, stderr
   names `tsk_capped` and `maxCostUsd`, the CLI error JSON parses with `ok:false`, and
   `runtime/runs` is absent-or-empty (nothing written).

## Mutation transcript (out-of-tree)

Copy: `git archive HEAD` → `/tmp/r18-t2/tree`, working-tree diff for my three files applied
with `patch -p1`, `node_modules` symlinked to `/workspace/node_modules`. Run via the repo's own
`scripts/run-tests.mjs`. `/tmp/r18-t2` deleted afterwards.

Baseline in the copy — 10/10 pass:

```text
ok 1 - run --children carries a declared maxCostUsd to the child run and its TASK_REQUEST
ok 2 - run --children refuses a non-positive maxCostUsd naming the task and writes no run
...
# tests 10 / # pass 10 / # fail 0
```

**Mutant A — restore the drop** (delete `...(maxCostUsd !== undefined ? { maxCostUsd } : {})`
from the built `limits`, keep the refusal):

```text
not ok 1 - run --children carries a declared maxCostUsd to the child run and its TASK_REQUEST
    + actual - expected
  expected: 0.25
  operator: 'strictEqual'
ok 2 - run --children refuses a non-positive maxCostUsd naming the task and writes no run
# tests 10 / # pass 9 / # fail 1
```

**Mutant B — silently copy invalid** (`parseChildCostCeiling` returns `value as number` with no
validation, copy restored):

```text
ok 1 - run --children carries a declared maxCostUsd to the child run and its TASK_REQUEST
not ok 2 - run --children refuses a non-positive maxCostUsd naming the task and writes no run
  actual: |-
  operator: 'match'
# tests 10 / # pass 9 / # fail 1
```

Mutant B's actual stderr is **empty**: with `maxCostUsd: 0` copied through, the CLI exits
non-zero only because the child run fails at protocol validation deep inside the coordinator,
with no operator-facing message naming the file or the task. That is precisely the
"fails far away" failure mode the refusal exists to prevent, so the pin asserts the message and
not just the exit code. Both mutants killed; each mutant reddens exactly one of the two new
pins and no existing test.

## Verification

- `npx tsc --noEmit` whole tree: clean, exit 0.
- `npx eslint src/cli/main.ts test/integration/m1/cli-children.test.ts`: clean, no output.
- Owned suite 3×: 10/10 pass each time, identical ordering, no flake.
- Consumer-adjacent suites in-tree (`test/integration/m1`, `test/integration/cli`,
  `test/unit/run`, `test/integration/m2.5`): **399 tests / 399 pass / 0 fail / 0 skipped**.
  This covers `child-coordinator-limits`, the flowchart resume/child-spec rebuild paths, and
  every CLI integration suite. Full gate is the parent's job.
- No scratch at report time: `/tmp/r18-t2` removed; no `pi-sparkle-cli-m1-*` state roots left
  (the tests `mkdtemp` and remove in `finally`). Pre-existing unrelated `/tmp` entries from
  earlier rounds were not created by this slot and were left alone.

## Residuals / notes for the parent

- **No CLI surfacing of a disarmed cap.** This slot creates the first CLI path that can declare
  a `maxCostUsd`, so `onCostGate` now has a producer — but per ROUND18-BRIEF §5 wiring it is
  explicitly not a slot, and I did not. Operator-visible today: the `ChildRunLimits` disclosure
  says enforcement is executor-dependent, and a real ceiling stop shows in the transcript
  summary. With the default fake-children executor a declared cap is carried and recorded but
  never enforced, silently. If the parent later wants that surfaced, it belongs with whoever
  owns the CLI cost plane, with a proven operator need.
- **Run-level `maxCostUsd` still has no CLI door.** `run --children` can now declare a per-child
  ceiling; there is no flag to set the *run*-level cap that `costCapFor` mins against. Not in
  this grant and not an honesty hole (nothing claims the flag exists) — capability work.
- **`docs/kernel-reuse.md:107-114`** ("`maxCostUsd` now flows end to end") is outside my grant
  and was already true for the run-level plane; this landing makes it more true, not less. Left
  untouched deliberately, per "do not census-note other surfaces".
- Nothing in this diff touches adaptation-plane `src` import edges, so neither privacy guard
  entered ownership; `src/domain/limits.ts`, `src/protocol/v1.ts` and
  `src/run/child-coordinator.ts` are unmodified.
