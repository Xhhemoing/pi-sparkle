# PS-06 status/recovery projection — verification record

## Identity

- Task: `TASK-20261001-ps06-status-projection`; implementation owner: coding agent; independent acceptance owner: maintainer/reviewer.
- Verification date/environment: 2026-10-02, Windows, Node `v24.18.0`, pnpm `10.17.1`.
- Worktree: `C:/Users/86080/dev/pi-sparkle`, branch `feat/status-projection-20261001`; baseline main `cd47a753c88cb5364f036eb3dda64d0f13772321` (PR #51).
- Initial plan `262f993`, initial module-missing RED `0d4c0c7`. Continuation corrects the uncommitted draft; boundary RED/GREEN commands below are working-tree evidence, not separately committed RED revisions. Initial PS-06 source commit: `e0affe57289fa9fd640575ef21ef23be0c0607ad` (same runtime/test bytes as the first working-tree gate). Current combined feature source: `6d45d59bfeccff0e873d4c04bb1d4a9a0ef93a01` after incorporating upstream PR #52; verification below. State: ready-for-review, not accepted or merged into main.
- [Plan / acceptance criteria](../superpowers/plans/2026-10-01-ps06-status-projection.md); [contract](../data-dictionary.md#run-status-projection-ps-06).

## Commands

All commands ran in the worktree above. Raw outputs are local, ignored `.agent_workspace/ps06/` records, not uploaded transcripts.

| Command | Result | Notes/evidence |
|---|---|---|
| `node scripts/run-tests.mjs test/unit/run/status-projection.test.ts test/integration/cli/status-projection.test.ts test/integration/cli/inspect-summary.test.ts` (boundary RED) | FAIL, expected: 19 tests / 8 pass / 11 fail / 0 skip | `boundary-red.log`; real assertions on lost child verdicts, mixed-run cost, swallowed errors, absent-log availability, stale advice, price gaps and truncation. |
| Same command (boundary GREEN, before added pin/limit tests) | PASS: 19 tests / 19 pass / 0 fail / 0 skip | `boundary-green.log`. |
| `node scripts/run-tests.mjs test/integration/cli/status-projection.test.ts` (reader-limit RED) | FAIL, expected: 10 tests / 9 pass / 1 fail | `limits-red.log`; `Missing expected rejection` before limits were forwarded into the reader. |
| `node scripts/run-tests.mjs test/unit/run test/unit/telemetry test/integration/cli/inspect-summary.test.ts test/integration/cli/status-projection.test.ts test/integration/cli/readme-command-parity.test.ts` | PASS: 372 tests / 370 pass / 0 fail / 2 skip | `focused.log`; skipped Windows concurrent-checkpoint and sink-lock retry cases. |
| `pnpm typecheck && pnpm lint` | PASS (draft boundary correction) | Exit 0; final gate reruns both on delivery source. |
| `pnpm gate` | PASS: 3257 tests / 3238 pass / 0 fail / 19 skip; typecheck, lint, workflow and build PASS | `gate.log`; delta from baseline is +16 tests/+16 pass, no added skips. |
| `pnpm security:probe` | PASS: `status: ok`, `passed: 26`, all finding/waiver arrays empty | `security.log`; built-artifact probe. |
| `pnpm pi:probe` | PASS: four checks | `pi-probe.log`; both pins 0.86.1, no legacy GoogleThinkingLevel, ThinkingLevel import source correct. |
| `git diff --check` | PASS, exit 0 | After gate/probes, before source commit. |
| `pnpm workflow:check` | PASS | `workflow-check: ok (10 required files, 16 required headings)`; final documentation closeout. |
| `node scripts/run-tests.mjs test/unit/run/status-projection.test.ts test/integration/cli/status-projection.test.ts test/integration/cli/inspect-summary.test.ts test/unit/cli/readme-command-parity.test.ts` | PASS: 29 tests / 29 pass / 0 fail / 0 skip | `final-focused.log`; correct README-parity path. The earlier focused command named the nonexistent **integration** path, which the runner silently omitted; its reported 372 tests did not include README parity. Full gate did include it. This final command explicitly verifies the seven parity cases. |

## Behavioral Evidence

### Root causes and fixes

1. **Absent file != thrown ENOENT.** `src/persist/jsonl.ts::openExisting` returns undefined, and `readJsonlObjectsFromOffset` returns an empty read. The draft's catch never ran for a missing invocation file, so it claimed availability. CLI now observes presence separately; an existing empty log remains available. Non-ENOENT errors and invalid rows refuse instead of being silently treated as empty.
2. **Shared log != run-local log.** `readInvocationRecords` reads all runs. CLI validates rows and filters requested runId; the pure projection also filters by runId. Foreign cost is pinned out by real persisted-row integration coverage.
3. **ChildInspection shape mismatch.** Verification lives under `terminalResult.verification`, not top-level. Projection now consumes `ChildInspection` directly. Both pure and CLI tests prove terminal verification/criteria survive. `verificationSource` explicitly says child-report, not independent acceptance.
4. **Historical gate != current blocker.** Gate advice is emitted only for current BLOCKED status; terminal/cleared blocks have none. Pending child questions use answer without incorrectly applying the unrelated clarification-only warning.
5. **Two reads != one event snapshot.** `inspectRunEvents` extracts the unchanged inspection reducer, so this mode uses the already-read event snapshot. Telemetry remains a separate observation, not an atomic transaction.
6. **Stat limits != read limits.** Optional read limits are forwarded inside `readInvocationRecords`; projection enforces the same 4 MiB / 20,000-record limits as event inspection, with no repair/write. Torn event and telemetry tails have independent flags and stderr warnings.

### Files / compatibility

- `src/run/projection.ts`: pure child/progress/blocker/cost/advice projection; reuses `sumUsage`, no model-percent authority. USD is the finite fully priced subset, not billing or budget settlement.
- `src/cli/main.ts`: new mutually exclusive run-only flag, validated bounded reads, one JSON object; original summary refusal strings restored unchanged.
- `src/run/inspection.ts`: shared reducer extraction; existing inspection output unchanged.
- `src/telemetry/invocation-log.ts`: optional read limits only; existing caller defaults unchanged.
- `test/unit/run/status-projection.test.ts`, `test/integration/cli/status-projection.test.ts`: semantics, nested contract pins, corrupt/absent/empty/non-file logs, own-run costs and read-only torn-tail bytes.
- `README.md`, `docs/data-dictionary.md`, `docs/status-matrix.md`, active plan/checklists and this record: bounded contract and honest delivery status.
- No changes to Event union, RunStatus, four-key INSPECT_SUMMARY, stored schemas, permissions, provider configuration or acceptance authority.

### Review / integration status

Author inspection included runtime diff and existing/new machine-output pins. This is not independent review.

Read-only review attempt: `sparkle_delegate`, model `xhh-grok/grok-4.7`, run `run_6a316602-49df-4cca-89a8-293444e4225f`, task `tsk_d5395153-da4d-49f6-852c-dd114db66adc`: **FAILED**, HTTP **403**, Cloudflare blocked page; no child verdict, independent acceptance **UNOBSERVED**. A preceding longer request was refused by the 8,000-character task-budget check before dispatch. No successful review, channel recovery or acceptance is claimed.

Main merge and hosted CI are not established by local tests. The upstream-to-feature merge below is not a feature-to-main merge.

## Risks and Gates

- Child success counts are outcomes only; unknown verification may overlap. Missing criterion lists are explicit, but missing expected IDs cannot be derived from the reported subset. No independent PASS or complete task coverage claim.
- Cost totals are observed subsets. No complete token-side coverage claim, exactly-once settlement, parent/child rollup or external pricing lookup. Unknown numeric totals are absent JSON keys, not zero. Excluded failed/legacy calls may have incurred spend.
- File presence is an advisory stat observation. Concurrent append/delete can change observations between log reads; no writer lock or atomic cross-log snapshot is introduced. Full global telemetry is bounded/validated before filtering, so oversized/foreign-corrupt logs may refuse this projection.
- Question/block text is the same local inspection data, not a redacted export. No new storage or network transmission in the product path.
- Candidate location and Web UI are deferred PS-06 work. PS-03/O02/O03 ownership reconciliation, PS-04 root budgets, B2/S0-min/L1/L2, independent review, live-provider, holdout, production and Outcome-supported gates remain open.
- Earlier PS-02/PS-05 source merges are not accepted by this slice. Canonical caller roots/ambiguous legacy reuse and broader verifier identity remain separate review items. The mutable dependency/evaluator/target snapshot issue from baseline `cd47a75` has a newer upstream fix `56c10ca` in PR #52; preserve it rather than reimplementing it.
- Paid product-provider, crash, benchmark and holdout runs: NOT RUN / opt-in. The failed review-provider request is recorded separately above.

### Upstream synchronization decision

Final fetch found remote main had advanced to `ab2f11394b46295182ac23185b2c5841c4d7788f` (PR #52: preview.2 metadata, documentation and creation-time evidence snapshots). Diff reviewed; no dependencies changed. Preserve that work, incorporate only if Git can merge without conflict, and rerun the full gate/probes on the combined feature branch before publication. Any conflict requires separate resolution/review; no reset, force push, preview tag or main merge is authorized by this decision.

Outcome: `git merge-tree --write-tree HEAD origin/main` produced a conflict-free tree; `git merge --no-edit origin/main` created feature-branch commit `6d45d59bfeccff0e873d4c04bb1d4a9a0ef93a01`. No conflict hunks were authored or auto-resolved. All upstream changes are retained.

| Command on combined source | Result | Evidence |
|---|---|---|
| First `pnpm gate` attempt (600-second tool limit) | **FAIL / incomplete gate** | Tool timed out while descendants continued. `integrated-gate.log` later recorded 3258 tests / 3239 pass / 0 fail / 19 skip, then `ELIFECYCLE` exit **3221225794 (`0xC0000142`)**; build not reached. No assertion failure, but this is not a passing gate. OS/process cause unestablished. |
| Unchanged-source `pnpm gate` rerun (1800-second tool limit) | **PASS**, `GATE_EXIT=0` | `integrated-gate-rerun.log`: 3258 tests / 3239 pass / 0 fail / 19 skip; test duration 195204 ms; workflow, typecheck, lint and build passed. No source change or timeout-related fix. One extra test vs the earlier gate is upstream's binding snapshot regression, not new PS-06 scope. |
| `node scripts/run-tests.mjs test/unit/run/status-projection.test.ts test/integration/cli/status-projection.test.ts test/integration/cli/inspect-summary.test.ts test/unit/cli/readme-command-parity.test.ts test/unit/evaluation/evidence-invalidation.test.ts` | **PASS**, 37 tests / 37 pass / 0 fail / 0 skip | `integrated-focused.log`; new projection, old summary/NDJSON, README parity, and upstream invalidation regression. |
| `pnpm security:probe` | **PASS**, 26 checks, no findings | `integrated-security.log`; current build. |
| `pnpm pi:probe` | **PASS**, four checks | `integrated-pi-probe.log`; current build. |
| `git diff --check` | **PASS**, exit 0 | Combined feature source. |

This records an unchanged-source successful rerun, not proof that the transient process failure has been repaired. If it recurs, collect process/resource evidence under a separate runner-reliability task rather than altering runtime assertions.

## Publication and latest-main blocker

Draft [PR #54](https://github.com/Xhhemoing/pi-sparkle/pull/54) opened with published head `250d69f0d8b5941b219736573d34676ad675929f` (documentation-only successor of tested source `6d45d59`). No main merge was attempted.

During publication, main advanced again, to `3dd25aada218ca84c94f67c6d3bc385f88258598`, adding native cooperative verification cancellation. That work is **not included in this branch's verification**. GitHub reports `mergeable: CONFLICTING`; a read-only `git merge-tree --write-tree HEAD origin/main` confirms one content conflict in `tasks/report-execution-todo.md` (two independently added task sections). The real worktree/index are clean: no actual merge, conflict resolution, reset or overwrite was performed. Preserve both owners' work. Resolving that hunk requires the repository's line-by-line human conflict review and a new combined-source gate; independent PS-06 review also remains open. Hosted CI is not claimed here.

## Handoff

- Next: reconcile the checklist-only conflict against main `3dd25aa`, retain native cancellation changes, obtain conflict-hunk human review, rerun the combined-source gate, and re-dispatch independent PS-06 review. Keep PR #54 draft until those conditions hold; do not auto-merge.
- Durable links: [active plan](../../tasks/plan.md), [active checklist](../../tasks/todo.md), [execution checklist](../../tasks/report-execution-todo.md), [status](../status-matrix.md).
