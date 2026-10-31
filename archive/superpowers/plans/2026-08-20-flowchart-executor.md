# Flowchart optional executor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `--flowchart` complete RUNNING nodes through an `AgentExecutor` so a graph can finish without a hand-written `--results` file.

**Architecture:** Keep the flowchart supervisor as the scheduler. After a node is leased RUNNING, apply `--results` first (explicit override), then optionally call `AgentExecutor` and map the attempt to `ChildNodeResult`. Default `--flowchart` with neither flag still stalls. Do not compile `--children` into this path. Do not attach R1/bandit/topology.

**Tech Stack:** Existing TypeScript / Node 22 / `tsx --test`. Reuse `ProtocolChildExecutor` / CLI `ChildFakeExecutor` for `--executor fake`.

## Global Constraints

- Pi types stay in `src/pi-adapter/`.
- Live R1 / bandit / topology stay off the execution path until F-PROD.
- CLI `--children` remains the parent coordinator; `compileChildrenToFlowchart` stays library-only.
- `--flowchart` stays incompatible with `--children` and `--track`.
- Fake-executor tests are the required proof path; real Pi smoke stays opt-in.
- Nothing in this change is Outcome-supported.
- Missing confidence still counts as 0 on confidence edges (fail closed).
- `verification.kind === "FAILED"` is FAILURE even if TASK_RESULT says SUCCESS.
- `verification.kind === "UNOBSERVED"` may complete the node but must not set high confidence.

---

## File map

| File | Responsibility |
| --- | --- |
| `src/run/flowchart-executor.ts` | Map executor events → `ChildNodeResult`; run one node |
| `src/run/flowchart-run.ts` | Optional `executor` on start/resume; fill remaining RUNNING nodes |
| `src/cli/main.ts` | Allow `--flowchart --executor fake\|pi`; resume forwards executor |
| `test/unit/run/flowchart-executor.test.ts` | Mapping contract |
| `test/integration/m2.5/flowchart-run.test.ts` | Run-loop wiring |
| `test/integration/cli/cli.test.ts` | CLI contract |
| `docs/status-matrix.md`, `README.md`, `docs/specs/m0-m2-architecture.md` | Document the new compatibility |

## Task 1: Mapping contract

- [x] Write failing unit tests for `childNodeResultFromExecution`
- [x] Implement mapper (PASSED → confidence 0.9; UNOBSERVED omits confidence; FAILED verification → FAILURE)
- [x] Run `pnpm test -- test/unit/run/flowchart-executor.test.ts`

## Task 2: Flowchart run loop

- [x] Write failing tests: executor completes a one-node graph; `--results` wins over a failing executor; no executor still stalls
- [x] Add optional `executor` to `FlowchartRunDeps` and execute remaining RUNNING nodes
- [x] Run `pnpm test -- test/integration/m2.5/flowchart-run.test.ts test/unit/run/flowchart-executor.test.ts`

## Task 3: CLI

- [x] Replace “incompatible with --executor” with a completing `--flowchart --executor fake` test
- [x] Keep `--flowchart` incompatible with `--children` / `--track`
- [x] `--executor fake` on flowchart uses the protocol child fake (TASK_RESULT), same as `--children`
- [x] Resume forwards `--executor` into `resumeFlowchartRun`
- [x] Update usage / README / status-matrix / architecture one-liners
- [x] Run `pnpm test -- test/integration/cli/cli.test.ts test/integration/m2.5/flowchart-run.test.ts test/unit/run/flowchart-executor.test.ts`

## Out of scope (locked)

- CLI compiling `--children` / `--track` into `--flowchart`
- ContextPacket / CoverageGate / live cascade on flowchart nodes
- Recovering an already BLOCKED stall by later attaching an executor
- R1 live, cost-calibration claims, Outcome-supported language
