# Controller cancellation and explicit artifact receipts

## Plan recorded before implementation

- Task: B3-01/B3-02 under [the stage-three plan](../superpowers/plans/2026-10-15-development-batch-review.md).
- Owner: native loop agent; state: ready-for-review; baseline: `726e5e55` (2026-10-15).
- Scope: `src/development/controller.ts`, new `test/integration/development/controller-cancellation.test.ts`, this report. Store cancellation, review API, batch and CLI have separate owners.
- Problem: selection/claim/publication do not receive the operation signal; preparation awaits can dispatch after cancellation, and a post-claim queue load is outside cleanup. Durable receipts omit direct final/loop artifact locators.
- Preserve: old `DevelopmentResult` JSON, old receipts without refs, host scope/verification/claim fencing, uncertain-effect reconciliation, completed receipt immutability, no automatic acceptance/application/provider use.

Acceptance and test-first plan:

1. RED deterministic real-store seams for aborts after selection, admission reads, committed claim, action prepare/claim, candidate checkpoint and effect completion; no worker dispatch after preparation cancellation. A committed task claim must be blocked using its original token when no completed effect receipt exists.
2. Move post-claim reads inside the cleanup `try`; pass the snapshotted signal through `next`, `claimNext` and `markReady`, and fence preparation awaits before new work. Never race a mutation against an abort promise or abandon an in-flight write. Preserve actual completed results before checking cancellation at publication.
3. Persist `finalArtifactRef` as `runId/artifactId` for every native result and optional `loopArtifactRef` from `result.loop.artifact`. Failed results retain refs; legacy receipts still reconcile without them. Expose `currentSourceRevision()` as a fresh Git HEAD query for bounded batches.
4. GREEN new and original controller suites; TypeScript, focused lint, workflow and diff checks. Dependency restoration is parent-owned; use direct Node commands, never pnpm/live providers. Parent coordinates independent review and full/hosted gates.

Risks: cancellation is cooperative, persistence and cleanup are awaited to real settlement, synchronous Git can outlast the deadline, and an unknown effect remains uncertain. A saved completed effect is not overwritten to fabricate a cancellation result. If a token/queue/action is corrupt, preserve the evidence and require explicit host recovery.

## Verification

Author commands on the shared stage-three worktree, 2026-10-15:

| Command | Outcome | Evidence |
|---|---|---|
| `node --import tsx --test test/integration/development/controller-cancellation.test.ts` before dependency restoration | BLOCKED: `ERR_MODULE_NOT_FOUND` for `tsx`; not behavioral RED | `.agent_workspace/controller-cancellation-red.txt` |
| Same command after restoration, before controller edits | RED: 0 pass / 13 fail / 0 skip | `.agent_workspace/controller-cancellation-red-behavior.txt` |
| `node --import tsx --test test/integration/development/controller-cancellation.test.ts test/integration/development/controller.test.ts` after edits | GREEN: 26 pass / 0 fail / 0 skip, 7.23 s | `.agent_workspace/controller-cancellation-green.txt`; 15 new and 11 existing regressions |
| `node node_modules/eslint/bin/eslint.js src/development/controller.ts test/integration/development/controller-cancellation.test.ts` | PASS | exit 0 |
| `node node_modules/typescript/bin/tsc --noEmit` during parallel implementation | BLOCKED by other stage-three WIP | Missing batch module and candidate-review stub return type; no controller/new cancellation test diagnostic. Combined rerun remains required. |
| `node scripts/workflow-check.mjs` | PASS | 10 required files / 16 required headings |
| `git diff --check` | PASS | exit 0 |

The controller snapshots options before awaiting, forwards the signal to selection/claim/publication, and checks cancellation after preparation awaits and before host factory/executor dispatch. A committed claim is already inside token-fenced cleanup before the next queue read. A prepared action remains visibly prepared; claimed/checkpointed unknown effects remain uncertain. No mutation is abandoned via `Promise.race`.

Actual completed native results are persisted before cancellation can suppress queue publication. Cancellation after a successful receipt returns `needs-reconciliation`, keeping its completed receipt intact; if publication already committed, the ready queue record is preserved. Reconciliation rechecks evidence and performs only a missing state transition, without invoking the executor. Failed/cancelled native results retain final/loop locators and block the owned task. Pre-run cancellation has no native artifact to invent.

Receipts now store `finalArtifactRef = result.runId/result.artifact.id` and optional `loopArtifactRef = result.runId/result.loop.artifact.id`. Present refs must have the receipt's run ID and a valid opaque artifact ID; old missing fields remain readable. These refs are historical locators, not renewed acceptance authority. `DevelopmentResult` stays unchanged. `currentSourceRevision()` queries Git HEAD freshly for the batch owner.

## Independent review

The baseline agent independently reviewed the frozen controller and tests and reported **PASS**, with no scoped blocker. Independent command: `node --import tsx --test test/integration/development/controller-cancellation.test.ts test/integration/development/controller.test.ts` — **26 pass / 0 fail / 0 skip**, 7.01 s; evidence `.agent_workspace/architecture-20261015/controller-cancellation-independent.log`.

Reviewed Git blobs: controller `98d5428c395640a9e8b352bcba97e98a6a395d78`; cancellation test `6145a2a17bdf98ea07d1f3fa06bec31a97f866bc`. Review confirmed pre-claim fences, immediate post-claim cleanup ownership, preparation/checkpoint stops, actual completed-receipt preservation, failed-result references, legacy compatibility and fresh source HEAD behavior.

Full/hosted gates are parent-owned and not claimed here. No source application, automatic acceptance, live provider run, production or experimental gate closure occurred.
