# Architecture and bounded agent development

## Identity

- ID: `TASK-20261015-architecture-agent-loop`
- Owner: root coordinator; file-disjoint implementation and independent review agents.
- State: `ready-for-review`
- Opened: 2026-10-15 (Asia/Shanghai); baseline `44db4b1` on GitHub main.
- Related contracts: ADR-001 Pi boundary, ADR-006 native adapter, ADR-008 opaque identity; existing native write/apply, frozen status/event contracts and adaptive gates.

## Problem and Scope

The repository has a Pi execution kernel, durable run/event stores, isolated native candidates and host verification, but native writing ends after one candidate attempt. Reliable ongoing development also depends on bounded command cleanup and correct provider fallback semantics. This task improves those actual execution boundaries and documents a resumable development protocol.

### In scope

1. Audit current architecture and compare a small set of primary-source long-running agent/evaluation designs.
2. Reproduce and correct fallback classification, stale failure attribution and model-chain budget behavior.
3. Make command timeout/cancellation cleanup bounded even when a child ignores graceful termination.
4. Add opt-in, same-candidate repair after a completed independent verification failure, with frozen host verification, finite attempts/time, immutable bounded feedback and no-progress stopping.
5. Exercise the loop using real temporary Git worktrees and command checks; provide a runnable offline example and a precise SDK handoff.
6. Preserve evidence, perform independent source review and publish a reviewable branch/PR.
7. Review-driven second iteration: make explicit supervisor rejection dominate child success, and settle completion on the last allowed round. Correct test-launcher IPC portability using the same tests and assertions.

### Out of scope

No automatic candidate application, merge, release, production deployment, adaptive policy promotion, live paid model call, new cryptographic integrity scheme, global configuration change, or claim of autonomous crash recovery. Existing R10/R11, S0-min, F6/F-PROD and outcome-support gates remain separate. This is task-code repair, not online routing learning.

## Acceptance Criteria

- [x] Permanent provider errors do not dispatch fallback; successful fallback has honest success attribution; priced fallback attempts share the configured execution ceiling.
- [x] Timeout/cancellation/output overflow terminates a stubborn command within a bounded interval, retains the original failure reason, and documents platform limits.
- [x] Default native write behavior remains one attempt. Opt-in repair preserves the same candidate, host verifier and original source; completed verifier failure feeds the next attempt and successful host acceptance stops the loop.
- [x] Cancellation, infrastructure failure, unchanged candidate, unavailable progress evidence and exhausted limits stop safely; each checked attempt retains its run/artifact evidence.
- [x] Real Git/command regression tests, relevant compatibility/security checks and an independent review are recorded with environment limitations distinguished from product defects.
- [x] Tasks/status/docs accurately distinguish source implementation, command verification, independent agent review and human/production acceptance.

## Implementation Slice

| Files | Owner | Purpose |
|---|---|---|
| `src/pi-adapter/pi-executor.ts`, fallback tests | runtime agent | Model-chain correctness |
| `src/execution/command-runner.ts`, command-runner tests | cleanup agent | Bounded process lifecycle |
| `src/native/write-session.ts`, repair helper/tests, additive independent-check process status | loop agent | Same-candidate repair control |
| Dated architecture report, examples, active task/status links | root | Integration, research, executable demonstration and handoff |
| `src/run/supervisor.ts`, bounded regression tests | runtime agent | Judge authority and final-round completion |
| Test runner and CLI child-launch helpers | baseline agent | Use supported Node/tsx loader without optional CLI IPC |
| `.agent_workspace/architecture-20261015/` | verification agent/root | Local command evidence (untracked) |

## Test-First Plan

Each implementation slice records its RED test before changing behavior and GREEN focused result in its own dated report. Root runs integration checks after the slices converge. Required gates: `pnpm gate`, `pnpm security:probe`, `pnpm pi:probe`; if the environment prevents a command, record the exact failure and run the equivalent checks without falsely claiming the original gate passed. Tests must inspect real effects and retained evidence, not a model's self-report.

## Gates and Handoff

Stop implementation expansion on a frozen-contract mismatch; resolve in a dated decision before continuing. Retain candidates and evidence on failure. Deliver as an isolated branch/PR without changing main. Next development sessions must read this task, current Git/CI state and the evidence report, select one unaccepted item, run its reproduction, then implement/review it. No always-running worker or schedule is created by this task.

## Closeout

2026-10-15 implementation tree `cec9a9aa0175b8aa03aadaee225aa2516f7cca7c`, remote implementation commit `14ffc2a4`, [PR #60](https://github.com/Xhhemoing/pi-sparkle/pull/60). Gate-equivalent direct commands passed: 3313 tests passed / 0 failed / 1 live-provider opt-in skipped; build/typecheck/lint/workflow and security/Pi/kernel probes passed. Literal local pnpm gate is environment-blocked by nested package-manager version mixing, separately documented; hosted CI is tracked on the PR. Independent agent review findings were reproduced and closed. See [architecture and evidence](../../reports/2026-10-15-architecture-agent-loop.md). This scoped implementation acceptance does not close the open project/production gates.
