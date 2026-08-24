MODEL_SLUG: gpt-5.6-sol-xhigh-fast

# Round 3 — R3-gpt-A

## Changes

- `src/testing/fake-executor.ts` now captures every `AgentExecutionRequest` in
  `FakeExecutor.requests`.
- `test/integration/m0/coordinator.test.ts` covers a root coordinator request
  with `RunLimits.maxCostUsd` set and with the limit unset.
- `test/integration/m1/child-coordinator.test.ts` covers a child execution
  request with `ChildRunLimits.maxCostUsd` set and with the limit unset.
- The unset assertions pass with `undefined`, allowing either an omitted
  property or an explicitly undefined optional property.

## Verification

- `pnpm test -- test/integration/m0/coordinator.test.ts test/integration/m1/child-coordinator.test.ts`
  — passed: 25 tests, 0 failures. The configured root and child requests
  receive `0.75` and `0.25`, respectively; both unset cases receive
  `undefined`.
- `pnpm exec eslint src/testing/fake-executor.ts test/integration/m0/coordinator.test.ts test/integration/m1/child-coordinator.test.ts`
  — passed.
- `pnpm typecheck` — passed.
- `git diff --check` for the three implementation/test files — passed.

No `src/cli/main.ts` change was made. No commit was created.
