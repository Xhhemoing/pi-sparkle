# PS-HOTFIX: provider failure → UNOBSERVED + non-model failureClass

Date: 2026-09-12  
Branch: `grok/sol-efficiency` (continued from `da38a44` PR-A+PR-B PASS)

## Problem

`PiAgentExecutor.finish()` synthesized `verification: { kind: "FAILED", evidenceIds: [] }` when the provider failed and no agent `TASK_RESULT` was reported. That fed `taskSuccessFromResult` → FAIL, then `classifyTaskFailure` defaulted unlabeled FAILED → `model`, poisoning bandit / diagnostics / R1.

## Fix

1. **finish()** always synthesizes `verification: { kind: "UNOBSERVED", evidenceIds: [] }` when closing without an agent-reported result. Provider failures attach `failure: { category: "PROVIDER_ERROR", detail: ... }` via `taskFailureForProvider`.
2. **FailureClass** gains `"provider"`; protocol **FailureCategory** gains `"PROVIDER_ERROR"`.
3. **classifyTaskFailure** maps provider HTTP/transport/hints and `PROVIDER_ERROR` → `provider` (sandbox/fs stays `environment`). R1 / bandit / diagnostics already exclude non-`model` FAILs.

## Regression bar

- Provider fail → UNOBSERVED + no deterministic taskSuccess FAIL for the model; diagnostic summary/events retained.
- Agent-reported FAILED with evidence still model-attributable taskSuccess FAIL.

## Focused tests

```
pnpm test -- test/unit/pi-adapter/provider-failure-attribution.test.ts \
  test/unit/routing/failure-class.test.ts \
  test/unit/routing/outcomes.test.ts \
  test/unit/learning/signals.test.ts \
  test/unit/learning/diagnostics.test.ts \
  test/unit/learning/bandit-store.test.ts \
  test/unit/learning/task-success.test.ts \
  test/unit/pi-adapter/executor-retry.test.ts \
  test/unit/pi-adapter/report-task-result.test.ts \
  test/unit/pi-adapter/provider-retry.test.ts
```

## Gate

`pnpm gate` (recorded in commit message / agent report). No merge / no push.
