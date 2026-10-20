# Later local ADR-009 slices

## Identity
- ID: TASK-20261019-local-followons
- Owner: root coordinator and sequential implementation agents.
- State: planned.
- Date: 2026-10-19 (America/Los_Angeles).
- Parent: [staged continuation](2026-10-19-staged-continuation.md).

## Scope and decisions
Implement independent read models and thin entry points after M1-C. Do not duplicate task ownership, mutate frozen event/queue/packet schemas, infer trust from serialized JSON, or add hashes, baselines, frozen contracts or gates. Existing strict/local/policy behavior remains authoritative. Each item below is independently reviewed and committed after real focused checks. Final integration uses the existing pnpm gate and applicable probes.

## M4-B reported usage coverage
Files: new src/telemetry/usage-coverage.ts and test/unit/telemetry/usage-coverage.test.ts; documentation/status owned by root.

Input: readonly ModelInvocation rows with existing reported token counts, pricing snapshots and callOutcome. Output: total records, per-outcome coverage (ok/error/timeout/cancelled/unknown), reported input/output totals, missing fields and price coverage, and priced known-cost subset explicitly distinguished from complete total. Pure read-only projection; no writes, catalog fetches or guessed prices. Existing sumUsage and costEligibleInvocations retain success-only calibration semantics. Exact duplicate invocation identity must not double-count; conflicting identity is surfaced as conflict rather than silently selected. Invalid/non-finite arithmetic must not become a spend number.

RED/GREEN: failed and cancelled calls with usage remain in reported coverage; absent usage and absent one side of pricing stay unknown; actual zero differs from absent; input order does not change totals; repeated identity deduplicates, conflicting identity cannot yield complete totals; existing usage-aggregate tests unchanged. Command: pnpm test --test-concurrency=1 test/unit/telemetry/usage-coverage.test.ts test/unit/telemetry/usage-aggregate.test.ts. This is reported telemetry coverage, not provider bill settlement or evidence that all calls were recorded.

## M6-A project continuation
Files: new src/development/advance-project.ts; new test/integration/development/advance-project.test.ts and optional focused unit tests.

Compose a host-supplied controller with status(), currentSourceRevision() and runNext(). A single call performs at most one existing runNext operation, retains cancellation/settlement, and returns before/after read-only progress plus original result. Never pre-claim, rebuild readiness, auto-accept or auto-apply. A status snapshot is descriptive, not authorization. Preserve per-task overlap fencing rather than inventing a global queue owner. Reject malformed options before dispatch. Concurrent callers rely on existing atomic store/controller semantics.

RED/GREEN: real temporary Git and queue, concurrent advance cannot execute the same item twice; accepted-but-unintegrated prerequisite cannot unlock dependent work; unresolved overlapping effect retains original claim and blocks execution; empty queue and pre-cancellation dispatch nothing; ordinary candidate result remains ready-for-review and source unchanged. Command: pnpm test --test-concurrency=1 test/integration/development/advance-project.test.ts test/integration/development/batch.test.ts. No connector or external scheduler is added by this slice.

## M3-A findings and M7-A dataset preparation
Before implementation, complete source-specific designs for trusted observation identity and acceptance provenance. A plain caller-supplied check JSON cannot mint host authority. M3 must bind existing check/run evidence, base revision and attempt generation, deduplicate same evidence, expose stale findings read-only, and retain raw cancellation/effect facts. M7 must consume actual host acceptance rather than TASK_RESULT self-report; preserve missing usage/price coverage; exclude environment/provider/cancellation failures from model-quality labels; split chronologically without repeated task identity crossing train/test. No online pointer changes, automatic repair or active learning is authorized by these projections.

## Verification and rollback
Each runtime slice: focused RED/GREEN, typecheck/lint, specification review, then independent quality review. Local delivery: existing pnpm gate; boundary changes: existing security/Pi probes. Exact commands/results go in a dated record linked from tasks/migration-todo.md and docs/status-matrix.md. Rollback is a normal code revert, preserving all records/unknown effects. No live provider, crash experiment, benchmark, holdout promotion or remote connector write is part of these local checks.

## Further source-grounded increments after the first local sequence
Read-only feasibility review (remaining_feasibility, no tests executed) identified concrete follow-ups. These are hypotheses until observed RED, not completed work:

1. M0 scoped readiness: controller currently returns immediately when its first planned advisory item's own effect remains unresolved. Add a host eligibility predicate to the existing store selection path for both next and atomic claimNext; retain final ledger admission. Real Git regression must execute unrelated lower-priority work while leaving uncertain overlapping work unchanged, including claim races and malformed scopes.
2. M4 deleted preference replay: recordObservation/applyObservation and rebuildViews appear not to consult existing tombstones. Test deletion then replay of the original ID (twice and across reload); a genuinely new correction ID remains allowed. Reuse current snapshot writer lock and schema. No new deletion authority.
3. M3 analysis: build upon the existing settled same-candidate repair owner. Read-only observation dedup and optional single-flight analysis must ignore stale revision/generation results, reuse completed identical evidence, preserve new hazards, and never authorize repair or clear unsettled effects.
4. M5 local qualification: actual Pi Agent deterministic-provider cost-stop tests already exist. An isolated exact-version candidate and subprocess behavior matrix can be qualified without paid calls; static package/source probes cannot substitute. Test no workspace dependency fallback, providerCalls=1 at stop, cancellation/usage/settlement, immutable root-generation binding and refusal to resume against another generation. Real project managed dispatch remains conditional on actual containment evidence.
5. M6 read-only connector: bounded transport receipt store plus injected HTTP/current-fact importer, separate from finite business ledger. Loopback cases cover duplicate/order/alias/auth/rate-limit/drop/retention/capacity. Real remote writes require a specifically authorized repository object; that does not block read-only implementation or local fault simulation.
6. M0 terminal archival: only settled candidate-check receipts initially; preserve get/idempotency via bounded archive, archive-first then active removal under existing lock, crash and conflict checks. Old binary could replay a key after removal because it ignores archives. Therefore actual writer/root isolation must precede enabling removal; a marker does not prove exclusion. Preserve unresolved/action-write/apply receipts.

Static routing already contains capability filtering, explicit preference and non-model-failure abstention. Inspect and test actual configured-primary/calibration behavior and nested retry ownership before adding another route abstraction. Existing S0/F6/production decisions and non-Windows containment evidence retain their named owner/conditions.
