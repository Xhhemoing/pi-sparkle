# Native Pi Bounded Write Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a host-facing `NativeWriteSession` that runs one scoped implementer in a retained isolated git worktree and accepts only host-supplied independent verification.

**Architecture:** `NativeWriteSession` performs preflight against the source repository before allocating a worktree or invoking an executor. It reuses `openClosedLoop`/`closeClosedLoop`, `startParentRun`, the existing Pi executor factory, `createWorktreeCodingTools`, and `runClosedLoopCheck`. The executor receives only read/write tools bound to the candidate; the trusted host supplies the verification command and argv. Candidate worktrees and run evidence remain retained for caller inspection; no application or disposal occurs automatically.

**Tech Stack:** TypeScript, Node test runner/tsx, git worktrees, existing run event store/coordinator, Pi adapter executor factory, closed-loop acceptance/artifact APIs.

## Global Constraints

- Runtime implementation scope is limited to the new session/preflight, integration/unit tests, and narrowly required adapter changes. The repository workflow also requires updating this plan, the active task/checklist/status records, and the verification report; those documentation updates are evidence-only and do not broaden runtime behavior.
- Preserve all existing dirty changes; never reset, discard, commit, push, merge, or alter unrelated task/status/README/extension content.
- Reject staged, unstaged, or untracked source changes before allocation or model invocation.
- Workers receive read/write tools only; no shell or spawn capability.
- Verification command/argv are trusted host API inputs, never model text or tool parameters.
- Executor errors, thrown exceptions, cancellation, and shutdown are durable and discoverable; self-report never implies acceptance.
- Git worktree isolation is not an OS sandbox; host verification may execute candidate code and this must be documented.
- Pre-abort performs no work. Cancellation/shutdown settles executor work and skips acceptance.
- No unrestricted native write registration or automatic candidate application in this slice.

## Acceptance Criteria

1. Clean source preflight is required and happens before worktree/model allocation; dirty source is unchanged and rejected.
2. A successful deterministic executor can write through the candidate-scoped tools, durable run identity/events are returned, and a retained candidate path plus artifact and accepted acceptance record are returned.
3. Host-supplied verification failure returns retained evidence with `accepted: false`; no-check/self-report-only cannot be accepted.
4. Pre-abort causes no executor call or worktree allocation; in-flight cancellation and shutdown settle and skip acceptance.
5. Thrown executor failures are returned as retained failure evidence rather than silently lost.
6. Tests use real git fixtures, real worktrees, persistence, and a deterministic executor factory; test cleanup removes only test-owned retained artifacts.

## Exact Files and Symbols

- Create `src/native/write-preflight.ts`: read-only source-root/HEAD/cleanliness validation and immutable host verification snapshot used before candidate allocation.
- Create `test/unit/native/write-preflight.test.ts`: clean snapshot, dirty source variants, invalid input, non-repository/subdirectory, and pre-abort cases.
- Create `src/native/write-session.ts`: `NativeWriteSession`, `NativeWriteSessionInput`, `NativeWriteSessionResult`, executor factory contract, source cleanliness preflight, candidate retention and lifecycle/error records.
- Create `test/integration/native/write-session.test.ts`: success, nonzero verification, missing check/self-report-only refusal, dirty source, pre-abort, in-flight cancel, shutdown, thrown executor, retained cleanup.
- Create `docs/reports/2026-09-18-native-write-worker.md`: evidence, command outcomes, risks, and handoff for main-agent review.
- Only if existing contracts block the implementation: add narrowly scoped factory/tool support in `src/pi-adapter/native-executor.ts` or `src/pi-adapter/worktree-coding-tools.ts`, with `test/unit/pi-adapter/native-write-executor.test.ts`.

## Test-First Tasks

### Task 0: Read-only preflight RED/GREEN

- [x] Add a real-git unit fixture for `prepareNativeWrite` before candidate allocation exists. (Main review 2026-09-19; `test/unit/native/write-preflight.test.ts`.)
- [x] Validate canonical Git toplevel, pinned `HEAD`, staged/unstaged/untracked/ignored rejection, runtime input validation, pre-abort, and frozen host verification arguments. (Main review 2026-09-19; ignored-user-code RED caught missing `--ignored`, Grok fix `mu832msg-253c9b0e`.)
- [x] Run `pnpm exec tsx --test test/unit/native/write-preflight.test.ts`, typecheck, and lint. (Main: 7 pass, 0 fail, 0 skip; focused ESLint, `pnpm typecheck`, and `pnpm workflow:check` exit 0; `.agent_workspace/research/native-write/preflight-final.log`.)

### Task 1: Integration RED for the public session contract

- [x] Add a real-git fixture and deterministic executor factory to `test/integration/native/write-session.test.ts` (RED confirmed before `src/native/write-session.ts` existed; final test is 8/8).
- [x] Add the accepted-success test asserting source cleanliness, candidate retention, write-tool use, run identity/events, host command binding, artifact retention, and `acceptance.accepted === true`.
- [x] Add failure/lifecycle tests for nonzero check, missing check, dirty source, pre-abort, cancellation, shutdown, and thrown executor.
- [x] Run `pnpm exec tsx --test test/integration/native/write-session.test.ts`; final 8 pass / 0 fail / 0 skip on 2026-09-19. Evidence: `.agent_workspace/research/native-write/focused-delivery-final.log` and `docs/reports/2026-09-18-native-write-worker.md`.

### Task 2: Minimal preflight and retained candidate execution

- [x] Implement source status parsing/preflight without changing the source repository.
- [x] Open a closed loop only after preflight, allocate one candidate, create the parent run with the supplied executor factory, and retain candidate/run metadata.
- [x] Ensure the implementer executor receives only `sparkle_read_file`, `sparkle_write_file`, and task-reporting behavior; never `sparkle_run_command`.
- [x] Record exceptions/failures in durable result metadata and do not turn them into acceptance.
- [x] Rerun the focused integration test and confirm green lifecycle/error behavior. Evidence: focused 8/8 and adjacent 30/30 checks on 2026-09-19.

### Task 3: Trusted independent verification and evidence

- [x] Require host `verification.command` and `verification.args` as immutable API fields; reject absent verification before acceptance.
- [x] Invoke `runClosedLoopCheck` only after settled successful execution and pass only host fields; preserve check/artifact/acceptance records.
- [x] On nonzero check or self-report-only input, return retained candidate/evidence with `accepted: false`; failed host checks now return `status: "FAILED"`.
- [x] Document that host checks can execute candidate code and that no automatic application/disposal occurs.
- [x] Run `pnpm exec tsx --test test/integration/native/write-session.test.ts` and the focused preflight/episode/closed-loop/worktree-tool tests.

### Task 4: Verification and evidence record

- [x] Run focused integration and unit checks, typecheck, lint, `pnpm workflow:check`, and the serialized full gate-equivalent checks without live providers.
- [x] Inspect diff and dirty-file preservation; runtime logs remain under `.agent_workspace/research/native-write/`.
- [x] Write `docs/reports/2026-09-18-native-write-worker.md` with exact observed counts, RED evidence, unresolved risks, and main-agent review handoff.

## Delivery Boundary

This slice is locally implemented and verified, but it does not claim independent reviewer approval, live-provider acceptance, automatic candidate application, or a normal parallel `pnpm gate` pass on the Windows host. The retained candidate remains caller-owned until a later application slice explicitly adds stale-target checks, policy allowlists, rollback, and disposal behavior.

## Risks and Abort Conditions

- Existing coordinator/executor contracts may not expose a safe single-implementer factory; if adapting them would require shared infrastructure or frozen-contract changes, stop and report the exact blocker.
- Git status parsing and worktree registration can fail; preserve the failure and any allocated candidate rather than deleting it automatically.
- Verification is trusted host execution, not an OS sandbox; host policy must remain explicit in later integration.
- No automatic candidate application, global configuration mutation, or unrestricted tool registration is allowed in this slice.
- Main agent personally reviews the implementation; no independent review or live-provider/holdout result is claimed.
