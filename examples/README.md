# Examples

Two runnable spec files for the two `pi-sparkle run` graph modes, plus the one
thing that trips people up: **these files use two different role vocabularies,
and they are not interchangeable.**

| File | Flag | Role vocabulary |
|------|------|-----------------|
| `children-tasks.json` | `--children <file>` | agent roles: `worker`, `scout`, `planner`, `implementer`, `reviewer`, `tester`, `debugger` |
| `flowchart.json` | `--flowchart <file>` | flowchart node roles: `actor`, `critic`, `router`, `judge`, `tool`, `human` |

Both run on the same engine — `--children` compiles its task list into a
flowchart through `compileChildrenToFlowchart` and hands it to the same
supervisor `--flowchart` drives directly. The vocabularies differ because they
answer different questions.

## Why there are two

An **agent role** (`src/domain/roles.ts`) says *who* the child is: which agent
profile is resolved for it, what its prompt and tools look like, and which
catalog model the router assigns. `scout` and `tester` are jobs on a team.

A **flowchart node role** (`FlowchartNodeRole` in `src/domain/flowchart.ts`)
says *what the node does to the graph*: an `actor` produces work, a `critic`
judges somebody else's, a `judge` decides an outcome, a `router` picks a
branch, `tool` and `human` name the two non-model executors. They are graph
positions, not job titles.

The compiler maps the first onto the second; nothing maps the other way. So:

- Putting `"role": "actor"` in a `--children` spec is refused
  (`role must be a known AgentRole`).
- Putting `"role": "implementer"` in a `--flowchart` spec is refused
  (`node <id> role is invalid`).

## `children-tasks.json` — `--children`

```bash
pnpm cli run \
  --project /path/to/project \
  --objective "Migrate to new payment provider" \
  --children examples/children-tasks.json
```

Task ids must be `tsk_<suffix>` and unique. `dependsOn` names other task ids
and orders the compiled graph. `acceptanceCriteria` gate each child's
`TASK_RESULT`, and `limits` bounds one child's attempts, per-attempt timeout,
and wall time (`limits.maxCostUsd` is also accepted and must be a positive
number when present). `inputArtifactIds` must be `art_<suffix>`.

Plain `--children` starts **without a requirement contract**: the run records
`skipContract: true`, the coverage gate never runs, and the CLI prints one
stderr warning saying so. Per-task `acceptanceCriteria` still gate each child,
but they are deliberately not compiled into a run-level contract. Use `--track`
for a coverage-gated start.

## `flowchart.json` — `--flowchart`

```bash
pnpm cli run \
  --project /path/to/project \
  --objective "Add remember-me to login" \
  --flowchart examples/flowchart.json \
  --executor fake
```

This example fans one `actor` out to two `critic` nodes in the same
`parallelGroup` and joins both into a `judge` whose `joinPolicy` requires them
(`mode: "all"`). Every node needs a unique `id`, a unique `tsk_<suffix>`
`taskId`, a `modelPolicy.allowedModels` drawn from the live catalog
(`cheap` / `premium` are the aliases that are always present), a
`confidenceThreshold` between 0 and 1, and an explicit `approvalRequired`.
Edges carry a condition — `success`, `confidence`, `evidence-count`,
`user-decision`, or `custom` — and the graph must be acyclic.

`--flowchart` also starts without a requirement contract and prints the same
warning. Without `--results` or `--executor`, leased nodes stay RUNNING until
the run stalls; `--executor fake` runs them through the protocol child fake and
needs no API keys.

`--flowchart` is mutually exclusive with `--children` and `--track`.
