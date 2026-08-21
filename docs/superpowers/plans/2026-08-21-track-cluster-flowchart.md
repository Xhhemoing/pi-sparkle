# Track cluster through flowchart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** One product path that turns an objective into a role graph, schedules it on the flowchart supervisor, and executes children as a bounded agent cluster.

**Architecture:** `--track` keeps planning (`planFromContract` + R0 assign). `compileChildrenToFlowchart` becomes the live graph. `startFlowchartRun` runs each leased node through `ChildCoordinator` with mailbox/spawn, context packets, and cascade. CLI `--children` uses the same engine. Standalone `--flowchart` JSON without `childTasks` keeps the thin executor / `--results` path.

**Tech Stack:** Existing TypeScript / Node 22 / `tsx --test`. No R1 live. No auto-promotion.

## Global Constraints

- Pi types stay in `src/pi-adapter/`.
- Live R1 / bandit / topology stay off.
- `--flowchart` CLI flag stays incompatible with `--track` / `--children`; those commands compile internally.
- Fake-executor tests are the required proof path.
- Nothing is Outcome-supported.

## File map

| File | Change |
| --- | --- |
| `src/run/flowchart-run.ts` | `childTasks` + cluster + episode + assignment events + ChildCoordinator execution |
| `src/run/flowchart-executor.ts` | Map `ChildRunOutcome` → `ChildNodeResult` |
| `src/track/loop.ts` | Compile planned children and call `startFlowchartRun` |
| `src/cli/main.ts` | `--children` compiles and runs through flowchart |
| skipped m2.5 / m1 tests | Unskip as acceptance |
| status-matrix / README / architecture | Document the weld |

---
