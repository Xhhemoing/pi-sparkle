# Framework migration verification — 2026-10-17

## Identity

- Task: `TASK-20261017-framework-migration`; [plan](../superpowers/plans/2026-10-17-framework-migration.md).
- Environment: Linux, Node 24.19.0, pnpm 10.17.1; no real provider invoked.
- Owners: root integration; disjoint M0-B, M1-A and M2-A implementation agents.
- Baseline: PR #60 `aac7a380`; main `44db4b1`; PR #61 remains separate.
- Frozen integrated source checkpoint: local `9089a5458978407921e21cf580044f52cff97573`,
  tree `a5a80479eeadb4467864d5bb720f1e6e1e450744`. Later evidence-only commits
  retain this runtime/test/CI content; remote commit mapping is recorded below.
- [Machine-readable validation](2026-10-17-framework-migration-validation.json).

## Commands

| Command / operation | Result | Evidence |
|---|---|---|
| Restore saved M0-A patch onto `aac7a380`, `git apply --check --index`, `git write-tree` | PASS | Recovered exact prior final tree `73e74bc2c3e236d1c0c73b79024a982c93413d18`; local checkpoint `778b235` |
| Authorized HTTPS `git push origin HEAD:codex/architecture-agent-loop-20261015` | FAILED | No local HTTPS username/credential; no remote mutation |
| Connected GitHub tree/commit + expected-head non-forced ref update; fresh branch fetch | PASS | Remote `e6f6a5b187f8a6a5b468a7ccee3f16e152001df6` has the exact recovered tree; parent `aac7a380` |
| Reviewed migration source publication + fresh branch fetch | PASS | Remote `51cf50d572123511ce4cd041e67fce3638ad5cab`, tree `a5a80479eeadb4467864d5bb720f1e6e1e450744`, parent `e6f6a5b`; matches local `9089a54` exactly |
| Organized documentation/evidence publication + fresh branch fetch | PASS | Remote `20383c2d0464c68011497633b64459ad1aca5532`, tree `e3971c2b77d4f28e3cb623a111bfcc8af04ca23c`, parent `cd3aaab`; matches local `a381d29` exactly |
| Pinned `pnpm@10.17.1 install --frozen-lockfile` | PASS | 195 packages, package/lockfile/build policy unchanged |
| Runtime fallback `pnpm test …` invoked by M1/M2 authors | FAILED before tests | Shim tried a package-manager install and refused non-TTY module removal; no behavioral result claimed; switched to normal Node test launcher |
| M2 `node scripts/run-tests.mjs --test-concurrency=1 test/unit/architecture test/unit/cli/flowchart-cli.test.ts test/unit/cli/live-catalog.test.ts test/unit/native/routing-catalog.test.ts test/unit/preferences/snapshot-lock.test.ts test/integration/cli/delete.test.ts test/integration/cli/retain.test.ts test/integration/m4/preferences-cli.test.ts test/integration/track/track-loop.test.ts test/unit/privacy/plane-boundary.test.ts test/unit/privacy/adaptation-plane-closure.test.ts test/unit/routing/live-isolation.test.ts test/unit/pi-boundary.test.ts` | PASS | 98 pass / 0 fail / 0 skip; `.agent_workspace/m2-focused.log` |
| M1 `node scripts/run-tests.mjs --test-concurrency=1 test/integration/development/start-task.test.ts` | PASS | 6 pass / 0 fail / 0 skip; actual missing-module RED before source; [scoped plan](../superpowers/plans/2026-10-17-direct-development-task.md) |
| M0 new focused RED/GREEN and adjacent regressions | PASS after actual RED | Initial 10 fail; new focused 10 pass; adjacent 50 pass; final group plus real controller-admission 61 pass / 0 fail / 0 skip; [full author commands and failures](2026-10-17-m0-atomic-admission.md) |
| M0 serial controller/admission/cancellation/source-integration/process-ownership command | PASS | 49 pass / 0 fail / 0 skip; initial 40 pass / 1 fixture failure and separate malformed-binding RED preserved in the author record |
| Pinned `pnpm typecheck`, `pnpm lint` | PASS | Both exit 0 on integrated source before final M0 legacy-binding correction; final gate verifies the final source again |
| `node scripts/workflow-check.mjs`, `git diff --check`, changed-Markdown local-link scan | PASS | 10 files / 16 headings; 453 links, no missing local files |
| Existing CI focused-list path audit | PASS | 34 explicit test paths exist, including new M0/M1/M2 cases on Ubuntu/Windows; hosted execution remains separate |
| Final documentation/preservation review | PASS | Four remote files match exact bytes, both task summaries retained; 471 local Markdown links valid; source/test/CI still equal reviewed `9089a54` |
| Source-disjoint final source review | PASS after R1 correction | [Review](2026-10-17-framework-migration-review.md), source `9089a54`; reviewer independently ran 36 guard tests |
| `PATH="$PWD/.agent_workspace/tooling/bin:$PATH" taskset -c 0 pnpm gate` | PASS | Workflow, typecheck, lint, all tests and build; 3632 total / 3630 pass / 0 fail / 2 skip; test duration 343411.50 ms; `.agent_workspace/migration-20261017/full-gate.log` |
| Pinned `pnpm security:probe` | PASS | 26 checks, zero open/waived/refused findings; built dist/package probe |
| Pinned `pnpm pi:probe` | PASS | Four compatibility pin/import checks; no live provider |
| Pinned `pnpm kernel-reuse:probe` | PASS | Three kernel facade/stream/steer checks |
| `node examples/development-integration-demo.mjs`, built CLI `--version` | PASS | Four scripted worker executions, zero live calls, no automatic acceptance/application; built version `0.1.0-preview.3` |
| Source hosted CI | PARTIAL / SUPERSEDED | Ubuntu CLI and both platform root regressions passed; quality and Windows CLI were cancelled when parallel documentation commit `cd3aaab` arrived. Cancelled jobs are not passes. |

The reviewed source candidate was published after focused tests and independent
source review, while the local full gate continued. This starts hosted
Ubuntu/Windows verification in parallel; final source/evidence delivery still
requires the full gate and probes. Source runs:
[CI 38992273378](https://github.com/Xhhemoing/pi-sparkle/actions/runs/38992273378)
and [root regression 38992273418](https://github.com/Xhhemoing/pi-sparkle/actions/runs/38992273418).

Parallel remote documentation `cd3aaab29b709c8e8ad92f05d7a6abfdf40d7ae6`
descends from source `51cf50d`. Its four architecture HTML/report/plan files are
preserved byte for byte, and both additive task summaries are retained beside
the migration entries. Its diff touches no runtime, tests or CI, confirmed by
`git diff --quiet 51cf50d cd3aaab -- src test .github/workflows/ci.yml`.
The old CI cancellation follows workflow concurrency; it is not a failed or
successful full hosted run. Replacement runs on that documentation head are
[CI 38992608584](https://github.com/Xhhemoing/pi-sparkle/actions/runs/38992608584)
and [root regression 38992608540](https://github.com/Xhhemoing/pi-sparkle/actions/runs/38992608540).

The two local skips are the real-provider smoke (explicit `PI_SMOKE=1` plus
provider/model required) and the Windows-only raw executable-tree comparison
on Linux. Neither is counted as a pass or complete platform qualification.
The whole gate exited 0; no source/test assertions or deadlines were relaxed.

## Behavioral Evidence

M0-A publication uses the previous exact tested tree, not a claim that its old
3594-pass run verifies this session's new source. The explicit current push
authorization supersedes the earlier automatic approval rejection. API and
local commit IDs differ because commit metadata differs; their tree is equal.

M2 moves model-catalog and state-layout implementation bytes unchanged, retains
old import forwarding and pins runtime function/error identity. Shared CLI lock
options no longer originate from main. Privacy guards classify the new catalog
path without expanding allowlists. Its initial structural regression was RED
4/4, then focused tests passed after implementation.

M1 adds only the direct host wrapper and its guide/tests. One session performs
preflight, executor dispatch, candidate check and optional same-candidate repair;
the wrapper awaits shutdown in `finally` and returns its original result. Real
Git tests cover source isolation, repair, cancellation, invalid/dirty refusal,
caller mutation and retained uncertain effects. No queue, default planner,
monetary input, new registry or automatic source application is introduced.

M0 reuses one existing metadata transaction for conflict checking and publishing
the running checker/writer action. Rejected attempts leave no prepared rows;
running/uncertain effects retain their fences. Readiness verifies accepted
ancestors and overlapping scopes for the actual candidate, so unrelated accepted
task uncertainty no longer prevents independent work. Invalid evidence and caller
cancellation are not classified as skippable ownership conflicts. Source review
found incomplete malformed-legacy-scope parsing; the author replaced it with the
existing exact `workItemScope` validator and added real-controller regressions.

Source-disjoint [review](2026-10-17-framework-migration-review.md) covered the
final runtime/tests, with R1 resolved and no remaining bounded-slice correctness
blocker. Its independent guard run passed 36/36; author-focused and integrated
gate evidence are recorded separately rather than relabeled as independent runs.

## Project Organization

The [migration checklist](../../tasks/migration-todo.md) is the current work
entry. Three completed architecture documentation tasks moved from active
plan/checklist summaries to a [dated archive](../../tasks/archive/2026-10-16-architecture-docs.md),
with links adjusted and original dated facts preserved. Other checkouts,
unmerged branches and runtime/policy gates are retained.
The maintained framework/README now link the direct task guide and canonical
module paths. New regressions join the existing cross-platform focused CI job;
the workflows, dependency policy and package export surface otherwise remain
unchanged.
The parallel architecture controls/download correction is preserved rather
than overwritten by the task-file organization.

## Risks and Gates

This delivery does not claim complete M0, stable SDK, main integration or
production/live-model benefit. Full containment/Windows behavior, old-writer
isolation, generic coding-tool uncertainty and terminal-ledger archival remain
explicit follow-ups. Existing strict checker/apply and policy gates stay in force.
Scoped readiness removes unrelated accepted-task freshness checks; it is not a
starvation-free scheduler. A high-priority planned item with its own unresolved
effect can still return reconciliation before a lower-priority disjoint item.

## Handoff

Source and organized evidence are published and read back exactly. This final
publication receipt changes documentation only; current-head mapping and hosted
checks are on [PR #60](https://github.com/Xhhemoing/pi-sparkle/pull/60). Hosted
results stay bound to the commit that actually ran. Local gate/probes, focused
evidence and source-disjoint review are complete. Documentation-only successors
do not change the verified source.

Next implementation: bounded M1 controlled tools/context; separately qualify
full M0 containment and old-writer/terminal-ledger follow-ups before expanding
process backends or overlapping writers. Current open conditions remain in the
[migration checklist](../../tasks/migration-todo.md).
