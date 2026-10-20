# Staged ADR-009 continuation implementation plan

## Identity
- ID: TASK-20261019-staged-continuation
- Owner: root coordinator; gpt-6.1-sol/high implementation and independent review agents.
- State: in-progress.
- Date: 2026-10-19 (America/Los_Angeles).
- Authority: [ADR-009](../../decisions/0009-lightweight-adaptive-framework.md), [migration design](../../architecture-migration.md), [active checklist](../../../tasks/migration-todo.md).
- Workspace: continue the existing codex/command-tool-uncertainty-20261019 checkout; preserve its initial ten-file task diff. No reset or unrelated branch integration. A managed M1 worktree from the same source base may be used while the initial full gate runs, to keep its source unchanged; integrate reviewed commits afterward.

## Problem and scope
The user requests sustained staged implementation, feasibility analysis, review and a commit for each completed part. Source inspection confirms that the current M0-C change needs fresh gate evidence and independent review, while several later roadmap entries describe capabilities not yet wired. Execute local implementation increments in dependency order. Existing opt-in provider/crash/benchmark/holdout and production boundaries remain explicit; local tests cannot accept them. No new hash, frozen contract, baseline or gate mechanism is introduced.

## Feasibility and sequence
1. M0-C closeout: verify and independently review the initial command uncertainty diff; commit its source and current evidence. Reuse existing unresolved-effect ownership.
2. M1-C task-local context: bounded candidate-local required/related source files and honest file/module CodeMap entries; mandatory admission and fresh repair context; wire actual factory and executor prompt without changing historical packet/event schemas. No parser dependency or semantic call-graph claims.
3. M2-B additive narrow SDK: supported host/testing/context/diagnostic entry modules and real packed consumer execution; retain deep imports. Optional contribution activation follows with single-flight, duplicate registration and stale-generation tests.
4. M3-A read-only findings: trusted independent-check observations, revision/generation/evidence identity, deterministic deduplication and stale filtering. Automatic repair retains M0 prerequisites.
5. M4-B all-outcome usage coverage: explicit missing usage/prices and failure categories; preserve existing successful-calibration aggregates. No price guesses or new spend guarantee.
6. M6-A thin project continuation: compose existing controller status/runNext without a second claim/scheduler; verify concurrent continue and accepted-unintegrated dependency behavior.
7. M7-A attribution/offline preparation: trusted acceptance and coverage joins, chronological task-disjoint dataset split, explicit exclusions; no automatic promotion or live benefit claims.
8. Reassess remaining M0/M2/M3/M4/M5/M6/M7 items against actual source after these increments; implement further locally verifiable pieces, recording genuine environmental or owner dependencies individually. Do not mark a whole M-number complete from a bounded slice.

## Acceptance criteria
- Each new behavior has an observed RED, focused GREEN and actual integration evidence where applicable.
- Remaining parts receive one independent read-only review covering specification, code quality and applicable contract-pinning tests before commit; concrete fixes receive targeted re-review when needed. Earlier separately executed specification/quality reviews remain historical evidence. This follows the updated user collaboration instructions recorded below.
- Applicable existing pnpm gate and probes are executed; full output stays under .agent_workspace/staged-continuation. Failure/skip is never reclassified as pass.
- Plans/checklists/status and a dated verification record identify changed symbols, exact commands, remaining scope and owner/condition.
- Local commits preserve each completed part; publication, main/#61 integration and external acceptance are tracked separately.

## Implementation slices and verification
| Slice | Files/symbols | Observable checks |
|---|---|---|
| M0-C | Existing native/write-session, pi-adapter/worktree-coding-tools and changed unit/controller tests | pnpm test --test-concurrency=1 test/unit/pi-adapter/worktree-coding-tools.test.ts test/integration/development/controller-admission.test.ts; pnpm gate; existing security/Pi probes |
| M1-C | New context/task-context.ts; native/write-session.ts; development/start-task.ts; unit/context and integration/development task-context tests | Candidate bytes reach real executor prompt; missing/stale/too-large mandatory context prevents dispatch; unrelated optional entries omitted visibly; repair reads current candidate; no source edit |
| Later slices | Exact symbols and RED commands are recorded in a scoped plan before editing that slice | Existing workflow/gate plus focused contract and packed/process checks appropriate to the actual change |

## M1-C design and test-first plan
Reuse host-neutral bounded workspace readers. The explicit host taskContext input supplies requiredFiles, optional relatedFiles, expectedSourceRevision and a tokenBudget; paths are candidate relative. Required files and objective/acceptance metadata must fit or fail before executor allocation. Copy/validate input synchronously so later host mutation cannot change the task. Read required files in full under fixed byte/file limits; optional modules use deterministic order with visible omissions. Refresh source contents for each repair attempt. SourceRevision binds the initial Git base, not a claim that a dirty candidate still equals that base. Context source is untrusted data and grants no tools/authority.

Avoid the existing grounder overwrite: either supply an additive explicit context channel that the grounder consumes or carry a bounded rendered data block in the existing objective shared by factory and child. Prefer the latter if it preserves packet contracts and avoids a second index owner. Verify the final AgentExecutionRequest.prompt, not just the factory argument. No whole-prompt/provider-token guarantee is inferred from the existing deterministic estimator.

RED cases: required file content absent from dispatch; invalid/missing/escaped/stale context dispatches a worker; overflow silently truncates required content; mutation after execute changes context; repair sees stale first-attempt bytes. GREEN command: pnpm test --test-concurrency=1 test/unit/context/task-context.test.ts test/integration/development/task-context.test.ts; adjacent native/direct/context tests; typecheck/lint; applicable existing gate and probes.

## Risks, rollback and records
- Source files may contain private data: only host-selected files are read; do not broaden to automatic whole-repo content ingestion. No raw source is added to tracked reports.
- Context is data, not a new authority or verifier configuration. No new persistent completion state.
- Roll back a slice through a normal reviewed revert; preserve unresolved effects, candidates, existing user changes and historical evidence.
- Real-provider benefit, full OS containment, old-writer shared-root qualification, managed version environments, connector credentials and established policy/production approvals require their actual evidence, not unit-test substitutions.
- Current evidence: [staged verification](../../reports/2026-10-19-staged-continuation.md). Scratch logs stay untracked.


## Test fixture correction required by actual gate evidence
- Scope: test/unit/execution/exact-git-tree.test.ts fixture after-hook only.
- Observed RED: full gate 3646 pass / 1 fail / 48 skip and unchanged selected rerun 0/1, both EPERM in fs.rmSync temporary-directory teardown; production output-cap assertion is not the failing line.
- Change: use existing fixture convention maxRetries=10/retryDelay=50 for recursive removal; retain final error on exhaustion, no catch-ignore and no skipped behavior assertion.
- Acceptance: selected test repeated successfully, complete exact-git-tree file passes, focused lint; independent review; fresh final integrated gate still required. No production behavior or bound changed.

## Updated user collaboration rules (2026-10-20)
The latest user-provided AGENTS instructions replace earlier general instructions. Continue the authorized scope, preserve other contributors' changes and use one writer per path. Current shared run/binding work remains serial. For remaining slices, one independent reviewer covers requirements, actual diff, code quality and relevant frozen-surface pinning evidence; the reviewer reads the candidate before the author narrative and reports concrete defects only. Do not repeat broad checks on an unchanged candidate without a new concern. This supersedes the earlier two-reviewer sequencing in this plan and its subordinate local slice plans; it preserves independent review and all existing applicable acceptance checks.

Root schedules complete builds, gates and packaging so at most one is running. Tests that internally run a full build count toward this restriction. Implementers may run authorized focused tests/typecheck/lint that do not trigger a complete build; they request scheduling for heavier commands. Root continues integration and targeted verification, then the required final current-candidate gate/probes. No dependency installation, lockfile change, new gate, hash or baseline is authorized by this process refinement. Previously recorded command results are not retroactively changed or described as future acceptance.

## Final-gate regression repair (2026-10-20)
Actual full gate at a7d82cd8:3965 pass/6 fail/48 skip,3049136.1519ms; no final build because tests failed. Four failures are privacy value-import/opaque-import boundary checks, and two pin the private argument lists of lifecycle-lock wrappers. Preserve these protections; no allowlist expansion or weakened assertions. Root owns the two lock pin tests; privacy_gate_fix owns an independently reviewed minimal boundary repair after identifying actual import chains. Existing schema/CLI/default behavior must remain.

Acceptance: the four privacy tests preserve their existing policy and pass with actual imports; coordinator and clarification lock assertions still require the whole record-writing body under the shared lifecycle lock and its unchanged options, now explicitly passing captured engineBinding. Run the exact failing files RED before edits, focused GREEN plus relevant managed/binding regressions, typecheck/lint, one independent delta review, then a complete current-candidate pnpm gate and probes/packed consumers. Existing failed/interrupted logs remain. No provider call, dependency change, broad refactor or new gate is part of this repair.

Privacy regression root cause and bounded repair: the new host-attribution preparation module joined genuine Native observations and runtime telemetry from src/learning, bringing runtime modules into the adaptation value closure. Move this unpublished host-side bridge to src/native/host-attribution.ts and update its sole test import; keep public symbols, authority checks and dataset behavior. There are no SDK/source consumers to redirect and no learning value-forwarder may retain the forbidden edge. Existing runtime module/ingress allowances remain unchanged.

The repository-wide computed-import watchlist separately flags the new GithubCurrentFactImporter.import method, which is not an import expression, and the intentional managed bootstrap loader. Use the existing TypeScript parser to distinguish actual ImportKeyword calls, with RED cases for method/literal versus variable/template/whitespace imports; retain the conservative literal value-closure walker unchanged. The one new justified computed-loader entry is runtime-only managed/bootstrap.ts: it validates a physical contained entry and resolves runtime-selected candidate entries, including existing boundary fixtures, so a fixed static dispatch would change the current loader contract. Explicitly assert both computed-loader exceptions remain outside the adaptation value closure; preserve the actual bootstrap dependency hooks and entry validation. This is a narrow existing watchlist correction, not permission for learning to import runtime or a new gate. Independent delta review must check the justification and regression assertions before acceptance.
