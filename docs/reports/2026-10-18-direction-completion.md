# Direction completion verification — 2026-10-18

- Task: `TASK-20261018-direction-completion`; [plan](../superpowers/plans/2026-10-18-direction-completion.md).
- Base: PR #60 `2a3dd47043efdb53dacff5e3f2c08feb79427958`; main `44db4b1`; PR #61 separate. Work branch `codex/direction-completion-20261018`.
- Environment: Linux, Node 24.19.0, genuine pnpm 10.17.1. Scripted workers/real temporary Git; no live provider calls.
- Current state: source reviewed and local full gate verified; GitHub publication BLOCKED by automatic approval review. Whole-roadmap acceptance remains separate.

## Direction and implementation boundary

ADR-009 governs lightweight core with optional collaboration and controlled adaptation. First priority is ordinary task usability; inferred optimization remains proposal-first with existing experimental gates. Tools discover/locate/read/patch candidate files, while the existing host verifier owns acceptance. No new shell permission, source apply, completion database, persistent schema, model call or online policy activation is added. The roadmap separates conversation/focus, local context, presentation preferences, findings/project continuation, SDK/Pi qualification and measured learning.

## Commands and failures

| Command | Result |
|---|---|
| Runtime fallback `pnpm install --frozen-lockfile` | Environment setup failed: pnpm 11.25.0 ignored-build error and inserted `allowBuilds` placeholders. Those tool-created YAML changes were removed exactly; no dependency/build policy change retained. |
| First pinned `pnpm@10.17.1 install --frozen-lockfile` | Non-TTY module replacement refusal; no test result. |
| `CI=true .agent_workspace/tooling/node_modules/.bin/pnpm install --frozen-lockfile` | PASS, genuine 10.17.1, 195 packages. Existing `onlyBuiltDependencies: esbuild` retained; unapproved optional build scripts remained ignored. |
| Early `node scripts/run-tests.mjs …` during install | Failed before tests: `tsx` unavailable during dependency replacement. Not counted as behavioral RED. |
| `node scripts/run-tests.mjs --test-concurrency=1 test/unit/execution/workspace-patch.test.ts test/unit/pi-adapter/worktree-coding-tools.test.ts test/integration/development/start-task.test.ts` before implementation | Actual RED: 18 total / 14 pass / 4 fail. Missing patch module, missing direct-task tool and two missing-tool adapter failures. `.agent_workspace/tools-red.log`. |
| `node scripts/run-tests.mjs --test-concurrency=1 test/unit/execution/workspace-patch.test.ts` after implementation | GREEN: 4 pass / 0 fail / 0 skip. `.agent_workspace/patch-green.log`. |

The final sections below supersede this initial pending snapshot. Linux execution does not claim Windows qualification. Source-disjoint agent review does not substitute for human/policy approval. Full M0 containment, root shared budgets, task context, stable SDK, main/#61 integration, S0-min/R10/R11/F6/F-PROD and actual live-provider benefit remain open.

## Source checkpoint and focused verification

Frozen source/test checkpoint: `b0dffab4ed8e8cd179555ac3263cccc24447dbff`, tree
`afac627c4c8529fd860cc3cc8a898e14953895e9`. Subsequent closeout updates are
restricted to documentation; runtime/test/package/CI equality is checked again
before publication.

| Check | Actual result |
|---|---|
| Reader actual initial RED | Missing service module; dependency-not-ready attempts excluded |
| Reader binary/link and null-parameter RED follow-ups | Actual rejection/completeness regressions failed, then final reader/path GREEN 23/23 |
| CLI wiring RED | 20 total / 18 pass / 2 fail: new tools were missing in actual Pi CLI factories |
| Patch regular-file review RED | 5 total / 4 pass / 1 fail: directory reached open instead of regular-file refusal; hardened flags and precheck then GREEN 5/5 |
| Controller patch scope RED | 14 total / 12 pass / 2 fail: out-of-scope and checker bytes actually changed before failure |
| Controller canonical alias RED | 16 total / 14 pass / 2 fail: write and patch could mutate a protected target through an allowed directory alias |
| Controller final GREEN | 16 pass / 0 fail / 0 skip; both mutators now share lexical and canonical scope checks, including nearest existing parent for new writes |
| Author 9-suite focused integration | 83 pass / 0 fail / 0 skip; `.agent_workspace/tools-focused.log`; command below |
| Author TypeScript, changed-file ESLint, `git diff --check` | PASS |

Author focused command:

```sh
node scripts/run-tests.mjs --test-concurrency=1 test/unit/execution/workspace-files.test.ts test/unit/execution/workspace-patch.test.ts test/unit/pi-adapter/worktree-coding-tools.test.ts test/integration/development/start-task.test.ts test/integration/native/write-session.test.ts test/integration/native/write-loop.test.ts test/integration/cli/development.test.ts test/integration/cli/development-batch-review.test.ts test/integration/execution/pi-closed-loop.test.ts
```

An early focused run overlapped the reader's deliberate excluded-path policy/test
adjustment and returned 33 pass / 1 stale expectation failure. The completed,
released source was rerun successfully above. Initial TypeScript checks similarly
reported the not-yet-created service and unknown integration-tool return types;
those were resolved before the frozen checkpoint. No failures are counted as
passing evidence.

## Independent source review

Source-disjoint reviewer `review_tools` returned **PASS** for exact checkpoint
`b0dffab4ed8e8cd179555ac3263cccc24447dbff`, against base `2a3dd470`.
The reviewer found and rechecked CLI tool forwarding, both mutator guards,
canonical aliases, patch special-file/identity checks and optional null validation.
No blocking finding remained. Scope and command default-deny were not relaxed.

Independent commands on the final source:

```sh
node scripts/run-tests.mjs --test-concurrency=1 test/integration/development/controller.test.ts test/integration/development/start-task.test.ts test/integration/native/write-session.test.ts test/integration/cli/development.test.ts test/integration/cli/development-batch-review.test.ts test/unit/pi-adapter/worktree-coding-tools.test.ts
# 62 pass / 0 fail / 0 skip
node scripts/run-tests.mjs --test-concurrency=1 test/unit/execution/workspace-files.test.ts test/unit/execution/workspace-patch.test.ts test/unit/execution/paths.test.ts
# 28 pass / 0 fail / 0 skip
```

Independent `git diff --check 2a3dd470 b0dffab` passed. An additional temporary
range probe checked 14 UTF-8/CRLF/no-final-newline combinations across the 64 KiB
read boundary; all matched expected bytes. The probe fixture was removed.
The reviewer did not independently run the full gate/probes, Windows or live
provider; this is agent source review, not human/policy acceptance.

## Behavioral Evidence

A real temporary Git repository and one scripted worker demonstrate listing the
candidate, locating an exported value, reading its line, applying an exact patch,
then obtaining the existing independent host-check acceptance. Source bytes and
clean Git status remain unchanged. CLI and native paths carry the same scoped
closures; the command tool is excluded. Scope/alias tests inspect the retained
candidate bytes to prove refusal occurs before forbidden mutation.

The reader allocates bounded chunks, skips unqualified binary search inputs with
visible truncation, and permits range excerpts of large files without requiring
a full-file read. Exact patch compares original text, file metadata and pathname
identity, but does not claim a transaction against external filesystem writers.
The candidate single-writer requirement remains. Once a bounded write starts it
finishes rather than intentionally cancelling mid-write; I/O/crash failures may
still leave partial candidate changes that require inspection. No inferred
improvement, new authority, new persistent schema or cryptographic digest is
introduced.


## Final local gate

```sh
PATH="$PWD/.agent_workspace/tooling/bin:$PATH" taskset -c 0 pnpm gate
```

PASS, exit 0 on the frozen runtime/test source: workflow, TypeScript, lint,
**3,659 total / 3,657 pass / 0 fail / 2 skip**, then build PASS. Test duration
347958.020045 ms; `.agent_workspace/full-gate.log`. Genuine pnpm 10.17.1 and
Node 24.19.0; one-CPU inherited execution makes the full suite serial without
changing test assertions, dependency versions or build policy. Skips are the
opt-in real-provider smoke and Windows-only raw executable-tree comparison on
Linux, neither counted as passing evidence. Dependencies and `package.json`,
lockfile and build permissions match the baseline.

Changed Markdown local-link scan: 336 references checked, no missing local file.
Final documentation/status workflow and diff checks PASS; final link scan checked
339 references with no missing files. `git diff --quiet b0dffab -- src test
package.json pnpm-lock.yaml pnpm-workspace.yaml .github` PASS: closeout changes
retain the exact reviewed and gate-tested runtime/test/package/CI bytes.


## Final probes and handoff

| Command | Actual result |
|---|---|
| Pinned `pnpm security:probe` | PASS: status ok, 26 checks; no open findings, waived findings or refused waivers |
| Pinned `pnpm pi:probe` | PASS: 4 pin/import compatibility checks; no live provider |
| Pinned `pnpm kernel-reuse:probe` | PASS: 3 stream/facade/steer checks |

Authorized publication targets existing PR #60 / `codex/architecture-agent-loop-20261015`,
using expected prior head `2a3dd47043efdb53dacff5e3f2c08feb79427958` and a
non-forced update. Publication uses the connected GitHub API when local HTTPS
credentials are unavailable. Git commit metadata may differ from the local
checkpoint; exact Git tree equality and unchanged reviewed runtime/test/package/CI
content are the readback conditions. No new remote commit/tree receipt exists: automatic approval review rejected the
GitHub create-tree upload before branch/ref mutation. The exact rejection and
unblock condition follow. Hosted CI has not run for this new source; existing PR
checks do not verify this local checkpoint.

State: bounded M1-B source reviewed and locally verified, ready for integration.
Rollback is code-only with no persisted schema migration. Disable file-tool
exposure to return to the old entry if needed; retain candidate/effect evidence.
The next implementable work is C1/C2 host capability/focus wiring and M1 task-local
context. M0 qualification and #60/#61 integration retain their own review. Explicit
presentation preferences can be developed independently of inferred-learning
owner gates under ADR-009. Do not activate learned selection, claim real-provider
benefit or treat successful candidate checks as source application.


## Publication blocker — automatic approval review

After all local work and verification, connected GitHub `create_tree` was
rejected for the 22-file payload (361,040 content characters) targeting
`Xhhemoing/pi-sparkle`, prepared against PR #60 head `2a3dd470`. Exact reason:

> This action uploads a large set of project source, tests, and documentation to an unverified GitHub repository, and the user did not explicitly authorize that exact payload and destination.

No tree/commit/ref publication or PR description update succeeded. No shell push,
indirect upload or alternate destination was used to bypass the rejection. Local
source and the reviewable plan/report remain committed; a complete Git patch is
provided for inspection. Unblock condition: explicit user approval to upload these
22 reviewed files to `Xhhemoing/pi-sparkle` on existing PR #60 branch
`codex/architecture-agent-loop-20261015`. Keep main and PR #61 unchanged.
The same local full-gate and source-review evidence remains valid; this blocker
concerns external publication, not a test failure.
