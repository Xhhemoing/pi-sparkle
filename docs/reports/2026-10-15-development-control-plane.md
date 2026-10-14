# Development control-plane implementation and verification

Plan: [development control plane](../superpowers/plans/2026-10-15-development-control-plane.md). Task authority: [DP checklist](../../tasks/development-control-plane-todo.md). Baseline: stage-one PR #60, remote `c2b802c3`.

## Stage-two source checkpoint

The scoped implementation is present and independently reviewed. This checkpoint preserves source before the final example and aggregate gate; it does not claim the aggregate gate or a live-model trial has completed.

The host declares a work-item dependency graph, literal write prefixes, named command criteria and protected checker/configuration paths. `DevelopmentController` claims one eligible item, records action intent before effects, runs a bounded native-write loop in an isolated Git candidate, saves a completed effect receipt before the queue transition, and exposes the candidate for explicit review. Acceptance never applies the candidate to the original source. Dependent work rechecks the accepted prerequisite against the actual source revision in a disposable check worktree.

Completed-effect reconciliation rechecks bound receipts and real host evidence without executing the worker again. Running or uncertain actions prevent another dispatch, including after queue release. An operator must establish that the old worker has stopped and reconcile uncertain effects using the ledger API; the CLI deliberately supports completed-receipt reconciliation only.

Named criteria reach worker contracts and per-attempt artifacts. The aggregate checker reports criterion observations before bounded excerpts; assertion failure (exit 1) may repair, infrastructure failure (exit 2) stops. Candidate and declared external checker bytes are compared exactly within bounded memory, without persisted snapshots or a cryptographic guarantee. Protected checker dependencies cannot be rewritten by workers, dirty candidates, or committed checker changes. Host authors must declare all transitive checker dependencies; this is not an OS sandbox or an automatic dependency analyzer.

## Reviewed evidence

| Slice | Focused evidence | Independent outcome |
|---|---|---|
| Work items/store | queue 14/14; persistence 40/40; true two-process single claim | PASS after transitive dependency-state fix |
| Durable action ledger | ledger and persistence 38/38; process killed after a real effect | PASS after strict history/schema fix |
| Native criteria | 67/67 | PASS |
| Trusted exact verification | combined 50/50; final wrapper 8/8 | PASS after removing forged registration and refusing cwd aliases |
| CLI assembly/fallback | 573/573 CLI/adapter checks | PASS |
| Flowchart extraction | 50/50 before/after; 54/54 isolation/resume/unblock | PASS, independent 13/13 |
| Controller/CLI/evaluation | author 22/22; independent 22/22 | PASS after protected-path and Node inline-argv fixes |

Final independent controller review: [review record](2026-10-15-development-independent-review.md). Slice-specific plans and reports contain their acceptance commands and limits.

`node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/eslint/bin/eslint.js .`, `node scripts/workflow-check.mjs` and `git diff --check` passed on the source checkpoint. Workflow check reports 10 required files and 16 required headings. The full suite and build are recorded separately after they finish.

## Evaluation boundary

The evaluation module reports first-pass, acceptance, repair, attempts, duration and separately attributed observed/estimated costs. Scripted and live trials cannot be mixed; missing observed prices cannot produce a cost-per-accepted claim. These are descriptive metrics, not causal or comparative evidence.

Read-only model inspection found no configured primary, fast, or available model. Therefore a real provider run has not been performed. Configuring a provider/model and an explicit trial budget is the remaining live-evaluation condition; offline Pi seams are not live trials. Existing experimental, application, privacy/production, holdout and promotion gates remain distinct.

## Continuation

Finish the reusable scripted development example, aggregate local checks and hosted Linux/Windows gates; save exact tested trees and final results. Continue later work by a host-authored queue, one bounded claim/effect at a time, checking the receipt and candidate before accepting, integrating source explicitly, and only then unlocking dependent work. Do not schedule a perpetual writer or infer integration from queue acceptance.
