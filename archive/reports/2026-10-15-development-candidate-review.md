# B3-03 candidate evidence review

Plan: [bounded development batch and review](../superpowers/plans/2026-10-15-development-batch-review.md). Owner: command-cleanup agent; state: ready-for-review. Baseline: `726e5e5519aabf74fcb6699c64b268d401a2cefd`. Root owns integrated acceptance, final source binding and delivery.

## Scoped design and test-first plan

Add `reviewDevelopmentCandidate({ sourceRepo, queuePath, stateRoot, actionId })` in a new development module, with focused integration tests. Read actual queue/action stores, require a completed candidate-write receipt bound to the current task claim and immutable definition, follow explicit final/loop/attempt/contract references only, and compare queue/action versions and content after all evidence reads. No worker, checker, source application or queue/action transition is invoked.

The result is a bounded historical summary: at most five attempts and eight criterion IDs, fixed host check status/exit/ok fields, opaque references and identity/version metadata. It omits goals, source contents, argv, stdout/stderr and arbitrary stored failure text. `historicalOnly: true`, `reverified: false`, `sourceApplied: false` are mandatory. Legacy receipts with no explicit final reference return `evidenceStatus: unavailable`; declared references that are missing, corrupt, stale or mismatched refuse the operation. Declared criteria remain definitions, not invented per-criterion verdicts.

Before implementation, tests cover valid multi-attempt and single-attempt records, unsuccessful outcomes, legacy unavailable, stale task claims, changed definitions, run/candidate/check/criterion mismatch, oversized attempts/artifacts, missing references, version races, and unchanged persisted bytes. Root approved an additive bounded loop-artifact read seam, delegated to the exact-snapshot agent; its [separate report](2026-10-15-loop-artifact-bounds.md) records the reader's RED/GREEN and compatibility evidence. Root owns CLI wrapping and receipt writers.

## Implemented boundaries

The helper reads `WorkItemStore.load` and `ActionLedger.get`, checks the completed candidate-write action's immutable input, queue ID, definition, claim token/owner, source base, idempotency key and receipt, then follows only explicit opaque references. Before returning it rereads both stores and requires unchanged versions and exact canonical snapshots. Missing action storage is refused before the ledger's read could initialize a directory. Review acquires the stores' ordinary short metadata locks; persisted queue/action/source bytes are unchanged.

Every reported attempt binds its run, artifact, candidate path, base revision, host invocation and recipe definitions, opaque check identity and original host exit status. Stored artifact descriptor byte lengths must match the located files. Each loop attempt's explicit task-contract artifact and recorded TASK_REQUEST bind the declared criterion IDs and descriptions. Single-attempt receipts lack a task-contract locator, so their criterion binding uses the recorded request and final check's recipe definition; no directory discovery occurs. At most five attempt/check records, five contract records and one loop summary are read. Each artifact is capped at 512 KiB; each run log at 2 MiB and 10,000 records. A declared oversized, missing or malformed artifact refuses review rather than becoming a legacy-unavailable result.

Cancellation can supersede an accepted last attempt: the history retains that attempt's accepted verdict while the outer receipt remains rejected with `cancelled` or `time-budget`. An accepted last attempt paired with an unrelated failure stop reason is refused. This preserves the native loop's terminal-persistence race semantics without treating the historical successful attempt as current authorization.

Returned data has fixed status/ID/count fields and bounded paths/references. Arbitrary stored errors are replaced with fixed review error messages; goals, raw source, checker argv, stdout/stderr, provider messages and receipt failure prose are never reflected. Per-criterion fields explicitly remain `UNOBSERVED` definitions; aggregate host observations do not invent individual criterion verdicts.

## Test-first commands and results

All commands use direct Node entry points; no pnpm wrapper or package/build-policy changes were made by this slice.

| Command / stage | Exact outcome |
|---|---|
| `node --import tsx --test --test-concurrency=1 test/integration/development/candidate-review.test.ts`, before dependency restoration | BLOCKED: missing `tsx`; not counted as behavioral RED. |
| Same command, after restoration with an exported throwing implementation placeholder | RED: 0 pass / 16 fail / 0 skip; all tests exercised real fixture stores and failed on the missing implementation. |
| Same command, first implementation | GREEN: 16 pass / 0 fail / 0 skip. |
| Added actual Git/controller two-attempt case with a trailing empty argv element | RED: 16 pass / 1 fail, task/criterion binding mismatch; expected criterion text had omitted native preflight's trimming. Matching the existing normalization fixed it. |
| `node --import tsx --test --test-name-pattern='shadow-ref' test/integration/development/candidate-review.test.ts` | RED: 0 pass / 1 fail, missing expected rejection; removed the synthetic single-attempt shortcut from loop-row parsing. |
| `node --import tsx --test --test-name-pattern='artifact-size' test/integration/development/candidate-review.test.ts` | RED: 0 pass / 1 fail, missing expected rejection; now verifies descriptor byte lengths before bounded reads. |
| `node --import tsx --test --test-concurrency=1 test/integration/development/candidate-review.test.ts test/unit/execution/loop-artifact-bounds.test.ts test/unit/execution/loop-artifact.test.ts`, before independent outcome correction | GREEN: 39 pass / 0 fail / 0 skip; 3.23 seconds. |
| `node --import tsx --test --test-name-pattern='accepted final attempt outcome' test/integration/development/candidate-review.test.ts` | Independent-review follow-up RED: 2 pass / 2 fail. Existing cancellation/time-budget controls passed; contradictory executor-failed/attempt-limit summaries were not yet refused. |
| `node --import tsx --test --test-concurrency=1 test/integration/development/candidate-review.test.ts`, after outcome correction | GREEN: 23 pass / 0 fail / 0 skip; 2.35 seconds. |
| `node node_modules/typescript/bin/tsc --noEmit` | PASS for the combined worktree before the final three-line outcome guard. An earlier run reported only concurrent batch-test typing errors, later resolved by that owner. |
| `node node_modules/eslint/bin/eslint.js src/development/candidate-review.ts test/integration/development/candidate-review.test.ts` | PASS after outcome correction. |
| `node scripts/workflow-check.mjs` and `git diff --check` | PASS after outcome correction; workflow reports 10 required files and 16 required headings. |

The real Git test executes a scripted worker twice (exit 1 then exit 0), retains one candidate, modifies that candidate later, and reviews only the historical records. It observes no additional worker calls or host-check marker writes during review and compares queue, action, source and marker bytes before/after. Source Git status remains clean. This proves read-only historical behavior, not live-model effectiveness or current candidate validity.

## Independent review and remaining scope

The baseline agent independently found an outcome-binding gap: changing a failed outer receipt to describe an accepted final attempt as `executor-failed` was not refused. A scratch reproduction failed with a missing expected rejection. The recorded positive/negative tests above reproduced and fixed it. Final independent rereview: **PASS**, with no remaining scoped blocker. The reviewer ran the candidate suite 23/23 (1.971 s), CLI review cases 3/3 (1.163 s), and their original outcome reproduction 1/1 (0.708 s), all with zero skips. They confirmed explicit references only, no legacy fallback for bad references, stable queue/action reads, no private output projection and no checker execution. Review binds source Git blob `def9e3e762f649ba9c5b65f3bd2182c898dbaa10` and test blob `2a8a91071e185ad83bfe6c23953f50f5794aa414`; root must bind these to the final combined commit. Raw local evidence is under `.agent_workspace/architecture-20261015/` in `candidate-review-independent.log`, `candidate-review-cli-independent.log` and `candidate-review-outcome-green.log`.

The bounded-reader implementation was separately reviewed for fixture lifecycle: its FIFO refusal regression now runs in an isolated child with a five-second timeout and parent-owned cleanup so a future blocking regression cannot hang the full suite. Its updated focused command reports 42 pass / 0 fail / 0 skip. Runtime reader defaults remain unchanged.

This is local cooperative record validation. Opaque artifact/check IDs and byte lengths are not cryptographic authenticity; exact metadata comparisons do not make arbitrary coordinated record tampering or transient filesystem swaps impossible. Artifacts are historical observations. The helper never reconstructs trusted descriptor runtime authority, reruns checks, establishes current candidate validity, accepts work or applies source. Full integrated/hosted gates and final commit binding remain root-owned; live-provider, production, application and experimental gates remain open.
