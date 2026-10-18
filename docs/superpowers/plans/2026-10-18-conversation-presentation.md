# Conversation host entry, focus and task presentation

## Identity

- ID: `TASK-20261018-conversation-presentation`
- Owner: root integration; conversation builder; presentation builder; independent reviewer.
- State: `ready-for-review` (bounded source independently reviewed and local gate verified).
- Opened: 2026-10-18 UTC; user continued the approved execution plan.
- Base: local `541868a5377d8ee3bda2e6c7eac1582de4e68cd1`, including reviewed M1-B. Remote PR #60 remains `2a3dd470` because upload was rejected again.
- Authority: [ADR-009](../../decisions/0009-lightweight-adaptive-framework.md), [direction roadmap](2026-10-18-direction-completion.md), [conversation proposal](../../conversation-workflow.md), [migration checklist](../../../tasks/migration-todo.md).

## Problem and Scope

The candidate tools and direct-task function are present, but hosts lack a small structured conversation entry, focus versioning and immediate per-task presentation preferences. A user should be able to ask a side question without losing their main task, query current facts, return to a known reference and execute an already host-authorized direct task. This slice connects those existing capabilities and adds presentation-only overlays; it does not claim end-user natural-language tool registration or persistent cross-session memory.

### C1/C2-A experimental host facade

Host registers known project/status and direct-task bindings. Structured requests select only known references and include message provenance and a focus token. The host remains responsible for interpreting the actual user message and authorizing registrations; a model cannot supply a repository path, checker, executor, permission, or apply handle through the request. Queries call the real controller's read-only `status()`, never `next()` (which may execute checks). Direct execution calls the existing `startDevelopmentTask` and awaits its shutdown.

Focus stores references and provenance only, with opaque per-session generation and monotonic revision. Questions/status reads leave it unchanged; explicit switching/restoring uses compare-and-set. A stale completion returns the real task result marked stale and cannot overwrite the new focus. One active direct task per session; changing focus never releases execution ownership. Unknown/unsettled effects keep the session fenced pending host reconciliation, not auto-replayed. Bounded in-memory deduplication refuses repeated/conflicting dispatch from the same request provenance; no crash-safe/external/durable exactly-once claim. Restore reads current facts or changes a pointer, not reruns completed work.

### M4-A explicit presentation overlay

Pure allowlisted language/detail/format preferences with user < project < task precedence. Host supplies user/project snapshots explicitly; task overrides never write the global preference singleton. Copy/freeze before awaits; fixed bounded wording is appended to a cloned implementer system instruction, keeping objective, acceptance, checker, tool policy, learning state and execution limits unchanged. No overlay preserves prior prompts byte-for-byte. This remains active when inferred adaptation is disabled.

### Outside this slice

Natural-language classifier/new model call; Pi extension/CLI tool registration; apply/issue/accept/automatic runNext; persistent focus, task promotion/plan patch; inferred preference learning; CodeMap extraction/packet selection; provider calls, production apply and policy activation. Main/#61 integration and existing M0/S0/R10/R11/F6 boundaries remain separate. External GitHub upload is blocked by automatic review and will not be bypassed; local implementation continues.

## Acceptance Criteria

- [x] Real Git direct task runs through the facade exactly once for a request, retains candidate/evidence and leaves source unchanged; unsupported actions and request overrides fail closed.
- [x] Actual controller status/query and incidental questions cause zero worker/checker calls and no queue/action/source mutation.
- [x] Focus CAS/generation rejects unknown/stale bindings; insert questions/side task/restore keeps the mainline reference; late results do not overwrite a changed focus.
- [x] Concurrent/repeated requests do not dispatch overlapping workers or replay the same provenance; cancellation waits for actual existing shutdown; unsettled results remain fenced.
- [x] Task presentation applies precedence, records scope per field, rejects invalid/authority keys/accessors before allocating work, and isolates concurrent tasks, retries and subsequent tasks.
- [x] No presentation leaves old prompts/objectives/checkers unchanged; formatting cannot cause a failing check to be accepted and does not modify global preference data.
- [x] Focused tests, independent source review, actual pinned full gate, security/Pi probes and current status/usage records are complete with failures/skips disclosed.

## Implementation Slice

| Files | Owner | Boundary |
|---|---|---|
| `src/conversation/focus.ts`, `src/conversation/session.ts` | conversation builder | host-neutral experimental facade and in-memory pointers; no internal store writer or extra scheduler |
| `test/unit/conversation/focus.test.ts`, `test/integration/conversation/session.test.ts` | conversation builder | real API/Git checks, concurrency, duplicate request, stale completion, no-mutation query |
| `src/preferences/task-presentation.ts`, `src/native/write-session.ts` | presentation builder | pure snapshot and cloned profile instruction only; no store mutation or task authority |
| `test/unit/preferences/task-presentation.test.ts`, `test/integration/development/task-presentation.test.ts` | presentation builder | validation/precedence/immutability and actual task wiring |
| `src/development/start-task.ts` | root | reject presentation accessors/inherited fields before rest destructuring; snapshot via the pure helper, covered by presentation builder integration tests |
| plan/checklists/status, conversation/direct-task usage, dated report | root | final evidence and limits; no broad historical claim rewriting |

## Test-First Plan

Each builder writes and executes intended failing cases before implementation, then focused and neighboring checks. Runtime dependencies are already pinned. Commands use `node scripts/run-tests.mjs --test-concurrency=1` with the owned tests and adjacent start-task/native/preferences/controller suites; final integrated command is genuine `pnpm@10.17.1 gate` with single-CPU inherited execution plus security/Pi probes. Tests use scripted executors and real temporary Git; no live-provider or Windows execution claim.

## Gates and Handoff

No additional user decision is needed for reversible local implementation within the existing plan. Do not retry rejected GitHub publication through another transport/destination. Independent reviewer must inspect the final combined source; source-disjoint review is not human or policy acceptance. Abort exposure if query acquires effects, focus switching releases ownership, task preference modifies authority, or a frozen contract changes. New APIs are experimental deep imports; no exports/schema migration or release. Evidence goes in `docs/reports/2026-10-18-conversation-presentation.md` and raw logs under `.agent_workspace/`.

## Closeout

Source `294375722fa6058b865f1c30df510e20573aa5b8`: focus/session 17/17, presentation/native adjacent 46/46, independent combined review PASS with 63/63; actual pinned full gate 3,689 pass / 0 fail / 2 conditional skips plus build. Exact commands, initial failures and post-build checks are in the [verification record](../../reports/2026-10-18-conversation-presentation.md). GitHub upload remains separately blocked pending explicit payload/destination approval; local delivery does not imply main integration, full NL frontend, C3/C4 or M1–M7 completion.
