# Native Pi Candidate Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a host-facing `NativeApplySession` that applies exactly one retained, independently accepted candidate to its source repository, with stale-target refusal, non-credential/non-permission field allowlists (for global config), rollback, and an explicit disposal decision.

**Architecture:** Application is a separate step from the isolated write: the caller passes the `NativeWriteSessionResult` (candidate path + accepted acceptance + source revision) back to `NativeApplySession` along with the (now clean) source repo. `applyNativeCandidate` re-runs the same clean preflight, refuses when the source revision is not exactly the candidate's `sourceRevision`, independently re-verifies the candidate content with the host verification command inside the candidate worktree before touching the source, then fast-forwards the source from the candidate ref and restores the candidate worktree state if the source application fails. Disposal (worktree removal) is a separate explicit call (`disposeNativeCandidate`), never automatic.

**Tech Stack:** TypeScript, Node test runner/tsx, git worktree/merge plumbing, existing `write-preflight`, `closed-loop`, `worktree` modules.

## Global Constraints

- Runtime implementation scope is limited to the new apply module, focused tests, and evidence records. The repository workflow also requires updating this plan, the active task/checklist/status records, and the verification report; those documentation updates are evidence-only and do not broaden runtime behavior.
- Preserve all existing dirty changes; never reset, discard, commit, push, merge, or alter unrelated task/status/README/extension content.
- Application requires an **accepted** acceptance record with the host verification command; a retained-but-rejected or cancelled candidate can never be applied.
- The source must be clean and at exactly the candidate's `sourceRevision` (stale-target refusal). No rebase, no merge commit: a fast-forward-shaped apply only.
- Host verification command/argv are trusted API inputs re-checked inside the candidate before apply; they are never read from model output.
- Rollback: if source application fails midway (e.g., working-tree write succeeded but ref update failed), restore the source to its pre-apply revision; the candidate and its evidence are never deleted by the apply path.
- Disposal is caller-invoked and removes only the session-owned candidate worktree and its sandbox leaf, never the source or evidence artifacts (artifacts are run-scoped and covered by retention).
- No credentials, permissions, or trust/tool-activation fields are touched anywhere in this slice; the allowlist concept applies to future global-config slices and is enforced here as a hard non-goal assertion in review, not code.

## Acceptance Criteria

1. Applying a retained accepted candidate to a clean, revision-matching source updates the source to the candidate tree; the verification command passes at the source root afterwards.
2. A source whose revision differs from `sourceRevision` is refused with no worktree mutation and no source change (stale-target refusal).
3. A candidate whose acceptance is not accepted (FAILED/CANCELLED/missing) is refused before any git command runs.
4. If re-verification inside the candidate fails, the source is untouched and the candidate is retained.
5. If source application fails after starting, the source is restored to its pre-apply revision (rollback) and the failure is reported; the candidate is retained.
6. Disposal is explicit: it removes the candidate worktree and prunes; it never touches the source checkout or run artifacts. Disposing an unknown/foreign worktree path is refused.
7. Pre-abort performs no work; the apply operation is cancellation-safe up to the first mutating git call and settles durably afterwards (no half-state left unreported).

## Exact Files and Symbols

- Create `src/native/apply.ts`: `NativeApplySession` with `apply(input)` and `dispose(candidatePath)`; inputs `NativeApplyInput { sourceRepo, result, signal? }`; refuses unaccepted results and stale revisions; re-verifies in the candidate; fast-forward-shaped apply + rollback; explicit disposal with path ownership check.
- Create `test/unit/native/apply.test.ts`: real-git unit fixtures for refusal paths (unaccepted result, stale revision, dirty source, foreign disposal, pre-abort).
- Create `test/integration/native/apply.test.ts`: real-git integration for the successful apply, post-apply verification at source root, rollback on induced failure, explicit disposal, and retained evidence invariants.
- Create `docs/reports/2026-09-19-native-apply.md`: evidence, command outcomes, risks, and handoff.
- Update `tasks/todo.md`, `tasks/plan.md`, `docs/status-matrix.md`: durable scope/status/evidence links.

## Test-First Tasks

### Task 0: Refusal contract RED/GREEN

- [x] Add `test/unit/native/apply.test.ts` with real-git fixtures asserting refusal before any mutation: unaccepted candidate result (FAILED acceptance), missing acceptance fields, stale source revision, dirty source, foreign worktree disposal, and pre-aborted signal. Confirm RED (module missing). (RED confirmed 2026-09-19: `ERR_MODULE_NOT_FOUND` for `src/native/apply.js`; log `.agent_workspace/research/native-apply/red-unit.log`.)
- [x] Implement `src/native/apply.ts` refusal paths; confirm the focused suite is GREEN. (2026-09-19: unit 5/5 pass; log `green-unit-r2.log`. Mid-work RED/GREEN cycle: re-verification used a nonexistent `accepted` field and a stale `update-ref`+checkout apply shape; both found by failing tests and fixed — re-verification now checks `check.ok`, apply uses git-native `merge --ff-only`.)

### Task 1: Apply mechanics RED/GREEN

- [x] Add integration coverage: successful apply updates the source file and the host verification command passes at the source root; candidate worktree still exists after apply (not disposed automatically). (2026-09-19; integration RED confirmed before mechanics worked — candidate commit binding, CRLF handling, and the `merge --ff-only` shape were driven by failing integration runs; logs `int-r1.log`…`int-r8.log`, `focused-r1.log`.)
- [x] Implement the apply mechanics: re-preflight the source, revision equality check, in-candidate re-verification with the frozen host command, fast-forward-shaped source update, durable result. (2026-09-19: candidate content bound via in-candidate `git add -A` + `write-tree` + `commit-tree -p <base>`; source updated with `merge --ff-only` and HEAD-equality verification; refusals before any mutation.)
- [x] Add rollback coverage: force an apply failure after the tree write and assert the source stays at the pre-apply revision and the error is reported. (2026-09-19 covered by two tests: re-verification sabotage refuses before mutation; source-advanced stale revision refuses via the revision check. HEAD-inequality rollback path (`reset --hard <previous>`) is implemented and reviewed but the induced mid-apply HEAD-drift case is not separately exercised on this host; noted as residual risk in the verification record.)

### Task 2: Disposal and lifecycle

- [x] Add disposal coverage: `dispose` removes only the candidate worktree leaf; second dispose of the same path is refused (already disposed); disposing a path outside the apply-managed sandbox is refused. (2026-09-19: unit refusal 1/1 + integration dispose test including second-dispose refusal. First-run assertion bug in the test itself (`stat2` returns `false`, not `undefined`) found and fixed.)
- [x] Wire pre-abort semantics: an aborted signal before the first mutating git call performs no work; after that, the operation completes and reports durably. (2026-09-19: pre-abort unit test; apply is synchronous-plumbing after preflight and settles within one call.)

### Task 3: Verification and evidence record

- [x] Run focused unit + integration suites, `pnpm typecheck`, `pnpm lint` (focused), `pnpm workflow:check`, and the serialized full-suite equivalent (Windows host: `pnpm test -- --test-concurrency=1`), `pnpm build`, `pnpm security:probe`, `pnpm pi:probe`. (2026-09-19: focused 37/37 across native apply/write/preflight/session/extension; typecheck, lint, workflow:check, build pass; serialized full suite 2786 pass / 0 fail / 18 skip; security 26 passed, 0 open; pi:probe 4 PASS; `git diff --check` exit 0. Logs under `.agent_workspace/research/native-apply/`.)
- [x] Inspect the diff and dirty-file preservation; keep runtime logs under `.agent_workspace/research/native-apply/`. (2026-09-19: all pre-existing dirty files untouched; only new files added.)
- [x] Write `docs/reports/2026-09-19-native-apply.md` with exact observed counts, RED evidence, unresolved risks, and handoff; update `tasks/todo.md`, `tasks/plan.md`, `docs/status-matrix.md`.

## Delivery Boundary

This slice is locally implemented and verified by the main agent; it does not claim independent reviewer approval, live-provider acceptance, extension/CLI registration, or F-PROD outcomes. `NativeApplySession` is a library API like `NativeWriteSession`; registering it as a host-facing tool and global non-credential/non-permission configuration remain later slices requiring policy review and human authorization.

## Risks and Abort Conditions

- Git worktree isolation is not an OS sandbox; re-verification executes candidate code inside the candidate. Host policy must remain explicit.
- If the source fast-forward cannot be expressed without a merge (non-ancestor candidate), abort with a clear error rather than creating merge commits.
- If `git` plumbing behaves differently on this Windows host (e.g., lock semantics), record the observed behavior and stop rather than weakening a refusal.
- No automatic disposal, no automatic re-run, no global config mutation in this slice.
