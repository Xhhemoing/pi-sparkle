# Reliability optimization execution — 2026-09-27

## Scope and authority

User authorized implementation of the [consolidated plan](../superpowers/plans/2026-09-27-reliability-optimization.md) with multiple subagents. Original commit: `e1ce19c0f93d8e34e7ca25512c5d32d2743ba669`. Isolated branch: `codex/reliability-optimization-20260927`. Original checkout and its four planning files remain untouched. O12, live provider/holdout, production apply, S0-min, R10/R11 and F6 approvals are not granted by this execution.

## Ownership and acceptance

Delivery authority update (2026-09-27): the user authorized local integration/merge, recoverable cleanup of delivered inactive worktrees, and commit/push of non-sensitive project data. A later explicit urgent request prioritizes syncing the independently reviewed, gate-verified first batch to GitHub now; O01–O11 remaining work will follow in later commits. O12 and prior human/experiment boundaries remain excluded. Root is the sole integration/push channel. This paragraph records authority and intended sequence, not a push claim. The coordinated O09 worktree also owns O08b next and remains protected as in-use. [Ordered delivery and privacy constraints](../superpowers/plans/2026-09-27-reliability-optimization.md#2026-09-27-delivery-authorization-and-coordinated-ownership).

| Slice | Owner | Exclusive write scope | State |
|---|---|---|---|
| O01 | apply implementer | native/apply, apply tests, apply description only | focused/spec/quality PASS; integration gate pending |
| O04b | config implementer | providers-config and its tests | focused/spec/quality PASS; integration gate pending |
| O04c / bounded O05 | evidence implementer | adaptation registry/promotion, comparison-report and their tests | focused/spec/quality PASS; raw-source promotion handoff open |
| O04a / O02 setup / O08a / O11 waiver | coordinator | privacy, session setup, kernel queue, security waiver | focused/spec/quality PASS; remaining package scopes open |
| O07 | JSONL implementer | persist/jsonl and offset tests | focused/spec/quality PASS for I/O slice; heap/latency NOT RUN |
| O09a/b | coordinated external thread | offline-logit/offline-types/patterns and corresponding tests in `offline-determinism-o09` | exclusively delegated; not integrated |
| integration / O11 CI | coordinator | reports/tasks/status/ADR correction and existing CI matrix | in-progress |

Each slice uses the plan's acceptance criteria, failing behavioral tests before production changes, focused verification, then specification review and code-quality review. No agent may overwrite another slice or run the full suite concurrently. Root owns final integration commands and all status claims.

## Environment and setup

Windows, Node 24.18.0, pnpm 10.17.1. Shell scripts use pwsh, Stop error policy, explicit UTF8. Native worktree creation completed. Offline dependency install could not find the pinned pi-agent-core tarball; normal frozen-lockfile installation is used without dependency upgrades. No product defect inferred from this setup failure.

## Verification record

Raw command logs belong under `.agent_workspace/verification/2026-09-27-reliability/`. Failed tests, skips and NOT RUN items remain visible. Full gate and probes are not yet claimed.

- O04a: five intended stat-error regressions failed before repair; final focused deletion/adaptation-closure/CLI-delete run: 79 passed, zero failures/skips. Only ENOENT is absence; ENOTDIR and operational errors propagate. Independent review exposed loss of the retry trigger when aggregate invalidation failed after deleting identifying rows. RED reproduced; invalidation now precedes telemetry rewrite under the invocation lock. A later rewrite failure discloses already invalidated aggregates and possible partial rewrite, preserving the cause. Reviewer independently reran the corrected ordering and retry regression.
- O04b: author verification 80 tests, 76 passed and four pre-existing Windows atomic-file skips; ten application concurrency cases actually ran on Windows. Config uses the existing short cooperative lock for the complete update; public whole-save remains replacement. Independent specification and quality review PASS.
- O04c: duplicate/reference/partial restore RED reproduced; final six-file adjacent check: 116 passed, one existing Windows skip. Restore validates temporary maps before exchanging readable state. Legacy metadata-only snapshots remain readable and round-trip without invented contents. Independent review exposed a partial-content reload failure after mutation; RED reproduced and `metadataOnly` state now refuses content-adding mutations until an explicit complete restore. This is a deliberate compatibility refusal, not automatic migration. Independent specification/quality review and re-run PASS.
- O05: duplicate rows and raw-backed validator have focused GREEN. A separate compatibility limit remains: legacy routing promotion reports omit complete raw pairs, so structural-only validation cannot prove independent evidence. No new sidecar/schema or permanent disabling of valid legacy flows is introduced; raw-source propagation needs a scoped follow-up design and migration/pinning review. O05 is not fully accepted.
- O02 setup sub-slice (coordinator-owned session.ts/session.test.ts): prebound projector reproduced an active-run leak. Setup exceptions now cancel and await settlement, remove active/listener state and avoid child work/post-run learning. Current session focused: 12 passed. Async runner/cancellation timing work remains open.
- O11 empty-register sub-slice: two meaningful RED tests proved unregistered environment requests could suppress findings. Current security-waiver fixture tests: 3 passed; all nonempty requests are refused while the existing register is empty, and packaged secrets remain unwaivable. No future approved-waiver registry is fabricated.
- O08a (coordinator-owned kernel.ts/kernel.test.ts): 100,000 queued events exposed 99,999 slot writes on the first dequeue. Head indexing, reference clearing and geometric compaction replace shift. Queue/live-stream focused: 7 passed, 100,000 events delivered in order; no timing threshold, backpressure, loss/coalescing or hard memory-bound claim.

## O01 implementation design correction

The strengthened reference-transaction fixture revealed an additional Git-native race: merge updates ORIG_HEAD and invokes its hook before publishing its already-loaded index. A successful hook staging change can therefore be overwritten by merge even after removing reset --hard. The failing test and raw index evidence are retained. Implementation uses two-tree read-tree checkout followed by ORIG_HEAD and expected-old-revision branch update, with no index/worktree writes after reference hooks. Detached source HEAD is refused after a separate probe demonstrated an OID-only HEAD update could overwrite a new symbolic HEAD. Candidate worktrees remain detached. This is not a crash-atomic protocol or R10/R11 approval. Any partial/ambiguous result preserves the observed source and retained candidate. [ADR correction](../decisions/0006-pi-extension-reverse-adapter.md#2026-09-27-reliability-correction--preserve-source-changes).

Final independent command: `pnpm test -- --test-concurrency=1 test/unit/native/apply.test.ts test/integration/native/apply.test.ts test/unit/native/write-preflight.test.ts` — 30 pass / 0 fail / 0 skip, 164580.3401 ms. Specification and code-quality review PASS for O01, not O02/O03. Earlier author full run was 29 pass before the final detached-source restriction; do not substitute that older count for this final check.

## O07 bounded I/O and measurement limits

Healthy append reads the final byte, while a missing LF triggers 4 KiB reverse scanning. Offset reads check the boundary byte and read only the suffix. Prefix line counting occurs only for recovery/corruption. Short reads, captured EOF, growth detection before repair, CRLF/blank/UTF-8 byte offsets and existing recovery semantics are covered; one fd is used for inspection/repair. `repair:true` requires writable access. This is not an immutable snapshot or cross-process repair transaction; callers still serialize writes.

| Prefix records | Healthy append before → after (bytes read) | Fixed 14-byte suffix before → after (bytes read) |
|---|---|---|
| 100 | 2400 → 1 | 2414 → 15 |
| 1000 | 24000 → 1 | 24014 → 15 |
| 10000 | 240000 → 1 | 240014 → 15 |

The 10,012-byte torn tail probe fell from 250,014 to 12,289 bytes read. Independent verification reproduced the new byte counts and ran `pnpm test -- --test-concurrency=1 test/unit/persist/jsonl.test.ts test/unit/persist/jsonl-offset.test.ts test/unit/run/event-store.test.ts test/unit/run/event-store-offset.test.ts test/unit/run/flowchart-checkpoint.test.ts`: 57 pass / 0 fail / 0 skip, 3424.4425 ms. Heap peak and append/checkpoint latency are **NOT RUN**; byte counts do not prove latency or memory improvement and complete O07 performance acceptance remains open. No runtime benchmark was run.

## Independent review and integration checks

Two actual subagent review records reside at `.agent_workspace/verification/2026-09-27-reliability/review-first-batch.md` and `review-apply-jsonl.md`. The first covers O04a/b/c, O02 setup, bounded O05, O08a and O11 waiver; the second covers O01/O07. Both performed specification review before quality review and scoped their PASS to implemented boundaries. Two P1 findings (privacy retry identity and legacy registry partial contents) were reproduced, fixed and independently rechecked. Independent test groups overlap: 169 pass / 4 skips, 93 pass / 0 skips, 116 pass / 1 skip, 30 pass / 0 skips and 57 pass / 0 skips must not be summed as unique coverage. These are agent source/test reviews, not human approval.

The existing Linux/Windows `cli-smoke` CI matrix now includes serial native/apply/config/path/JSONL focused tests. Hosted CI is **NOT RUN**; configuration is not cross-platform execution evidence. The coordinator's current local gate and probes are recorded below.

### First default integration run — FAIL, 2026-09-27

`pnpm gate` ran 12:51:35–12:55:45 +08:00 in the isolated Windows worktree. Workflow/typecheck/lint passed; tests: 3023 total, 3003 pass, 2 fail, 18 skips, zero cancelled, 195392.4027 ms. Build was not reached. No simultaneous full suite ran; two agents performed read-only reconnaissance and the coordinated O09 worktree ran only lightweight focused checks. One sampled load observation showed 16 available CPUs, 38 Node processes and about 1.79 GB free RAM; this is not a time-series or a root-cause claim. The previous fuzz timeout did not reproduce; no timeout was raised or test disabled.

1. `supervisor-crash.test.ts` exposed a real O07 integration regression: directory-backed event logs were treated as empty and produced a false `PLANNING` checkpoint. The original-error assertion passed; the checkpoint assertion failed. Real-directory RED coverage reproduced five failures; `regularFileSize` now refuses non-regular descriptors before empty/offset shortcuts. The original crash test was not changed.
2. `holdout-scripts.test.ts` imported pure arm-order helpers through a top-level built-library import, failing in the clean checkout because `dist/experiments/arm-outcome.js` was absent. A no-dist fixture was RED; the runtime-only import moved into the real runner entrypoint and all five focused tests passed. No holdout or provider was executed. Files: `scripts/holdout-block.mjs`, `test/unit/experiments/holdout-scripts.test.ts`.

Raw evidence: `integration/gate-default.log` and `integration/gate-default-result.json` under the log root above. Initial hypotheses about Windows errno were superseded by the complete stack; the product regression is the false checkpoint, not the errno assertion.

### Corrected first-batch gate and probes

On 2026-09-27 Windows, `pnpm gate` ran 13:44:57–13:48:56 +08:00, exit 0: workflow check, typecheck, lint and build succeeded; tests 3011 pass / 0 fail / 0 cancelled / 18 existing skips (3029 total; test phase 174716.039 ms). Built-artifact `pnpm security:probe` exit 0 (26 pass, no open findings or waived findings), `pnpm pi:probe` exit 0 (4 checks), and `pnpm kernel-reuse:probe` exit 0 (3 checks). Raw logs and timestamps: `integration/gate-corrected.log`, `gate-corrected-result.json`, `probe-results.json` and the three named probe logs. Independent delta review of the two fixes ran seven files: 79 pass / 0 fail / 1 existing Windows skip, 5792.5336 ms; specification and quality PASS for the changed scope. The first-batch and delta review records are in the ignored verification directory. Hosted Linux/Windows CI, real provider, real crash, runtime benchmark, holdout and production apply remain NOT RUN or unapproved as applicable.

### Urgent interim publication scope and privacy check

The user's later instruction prioritizes putting the latest reviewed code on GitHub before the rest of O01–O11 is complete. This interim publication contains the current O01, O04a/b/c, O02 setup, bounded O05, O07, O08a and O11 waiver/CI/clean-tree slices plus their tests and dated docs. O09a is under a P1 review correction; O09b/O08b belong to the separate coordinated worktree and are not part of this first publication. O02 async/process cleanup, O03, O05 raw-evidence handoff, O06, O08b, O09, O10 and O11 remaining acceptance continue in later changes.

Before the interim commit, the implementation worktree had 37 changed/new source, test, workflow and documentation files. A scoped scan of those files found no long `sk-`, `ghp_`, `github_pat_` or literal private-key values; the secret-shaped hits in `security-probe.mjs` and its test were synthetic fixture strings already used by the probe. The ignored directories were `.agent_workspace/.learnings`, `.agent_workspace/verification`, `dist` and `node_modules`; they are outside this interim source commit. The original checkout retains four dirty planning files. This scan does not certify all ignored data as publishable.

### First GitHub synchronization — verified result

The 37-file interim commit is `e2edc68cf0ef19b2e7c994e6c167d19e4584883d` (`fix(runtime): harden reliability boundaries`). The implementation worktree was clean after commit. Local `main` was verified as an ancestor, then fast-forwarded from `f15a3b81d6ff8b2e1b67ac0f26ca5bc7937455bb` to this commit. `git push origin main` succeeded; a fresh `git ls-remote origin refs/heads/main` returned the exact same commit. Remote `main` moved from `a143aad9063cdc5d3dc969d606eae97125dcaf6e` to `e2edc68cf0ef19b2e7c994e6c167d19e4584883d` without a force push. That range includes previously committed local ancestors; the current reliability commit itself changed 37 files. The worktree was switched back to `codex/reliability-optimization-20260927` for the remaining O01–O11 work. No worktree was archived, deleted or cleaned by this sync. O09a/O09b/O08b were not included. Hosted GitHub checks are pending; a successful push is not a CI result.

## Remaining work and boundaries

O02/O03/O06–O10 follow their dependencies. O08b requires an explicit ordering decision before persistence changes. O09/O08b are exclusively owned by the coordinated worktree; their semantics, reviews and commits must be checked before later integration. Full-suite execution is coordinated between both threads. O10 crash intermediate states must not be labelled atomic based only on locks. O12 remains deferred. This report is updated as publication progresses; no live provider, real crash probe, runtime benchmark or holdout run is claimed.
