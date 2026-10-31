# Development control-plane implementation and verification

Plan: [development control plane](../superpowers/plans/2026-10-15-development-control-plane.md). Task authority: [DP checklist](../tasks/development-control-plane-todo.md). Baseline: stage-one PR #60, remote `c2b802c3`.

## Stage-two source checkpoint

The scoped implementation is present and independently reviewed. The initial checkpoint preserved source before the final example and aggregate gate. The final gate and checkpoint are recorded below; a live-model trial has not completed.

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

The reusable scripted example, continuation guide, aggregate local gate and hosted Linux/Windows gates are complete. Continue later work by a host-authored queue, one bounded claim/effect at a time, checking the receipt and candidate before accepting, integrating source explicitly, and only then unlocking dependent work. Do not schedule a perpetual writer or infer integration from queue acceptance. The remaining live-evaluation condition is an allowed configured model/provider and a host-defined trial budget.

## Saved checkpoint and aggregate correction

The source checkpoint was saved locally as `a4c4a428ae8b5195454bc600d1db4779613e7877` and remotely as `83105ec2af2d70ac1650368ae3be6427634b4a70` on PR #60. Both point to exact Git tree `58c5a8465aca2fc1e3de185de3c7609f056f7090`.

The first aggregate run reports 3426 tests, 3423 pass, 2 fail, 1 opt-in provider skip. The moved fake-executor producer was still pinned to its previous file; the source and complete behavior/census assertions were independently verified unchanged before updating the path. The episode source guard treated the new host work-item/verdict `acceptance` properties as episode data. Its correction retains conservative scanning and adds strict host declaration origins plus same-location episode mutants; review also requires explicit type assertions not to bypass that boundary. These failures are preserved rather than reclassified as a passing gate. Initial hosted quality run [38616547755](https://github.com/Xhhemoing/pi-sparkle/actions/runs/38616547755) failed its Test step; both smoke jobs and both report-root jobs succeeded. A fresh hosted run is required after the reviewed test correction.

The runnable [development demo](2026-10-15-development-demo.md) and [agent continuation guide](../../docs/development-agent-loop.md) now pass author and independent checks. Actual scripted attempt count, duration, first failure and repaired acceptance feed the evaluation module; unknown cost remains unknown. No runtime source changed during these demonstration and documentation slices. The CI smoke matrix now additionally runs new development CLI/controller integration cases on Ubuntu and Windows, rather than treating historical CLI smoke as coverage for new behavior.

Read-only model availability was rechecked with `node dist/cli/main.js models list --json`: `MODELS_LIST`, enabled mode, `primary: null`, `fast: null`, `models: []`. No live calls were made.

## Final local delivery gate

After the independent source-guard corrections, a fresh `node scripts/run-tests.mjs` run completed **3431 tests / 3430 pass / 0 fail / 1 skip**, 69.0188 seconds. The skip is the existing opt-in real-provider smoke. The test runner used the final reviewed episode guard blob `f44fa0a415e09e76c409c0896f40b309f41b8ad5`; intermediate passing output from before the binding-default correction is not substituted for this result.

The final original package commands all exit 0: `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/eslint/bin/eslint.js .`, `node scripts/workflow-check.mjs`, `node node_modules/typescript/bin/tsc -p tsconfig.build.json`, and `git diff --check`. Security probe reports 26 PASS and no open findings; Pi compatibility 4 PASS; kernel reuse 3 PASS. Both retained Git demonstrations passed with no original-source application. Current local evidence is summarized in [development validation JSON](2026-10-15-development-validation.json).

Final episode-guard independent review passed 10/10 (24.19 seconds), plus all five independently constructed existing cast/alias/binding/default probes rejected reconstruction. The guard still scans all source modules and function scopes; its exception resolves only the two declared host interfaces, with conservative unknown/union handling and bounded initializer-origin checks. It is a source regression guard, not a general interprocedural information-flow proof. [Detailed correction](2026-10-15-episode-contract-boundary-review.md).

The standard local pnpm wrapper remains an environment failure, not a passing `pnpm gate`: it selects 11.25.0 while the repository fixes 10.17.1. A later literal workflow command also triggered the wrapper's install phase and `ERR_PNPM_IGNORED_BUILDS`; its generated four-line `allowBuilds` draft was precisely removed, with the original `onlyBuiltDependencies: [esbuild]` unchanged. No build-policy approval was granted. The direct original package commands above provide the local gate-equivalent result; hosted pinned-pnpm gates are recorded separately.

## Hosted gate, saved stages and completion

Final tested source/demo/test checkpoint: local `b3910c65a2e04b890f457c5e7af7914fc9e75330`, remote `9828011b3c2aeb68a302fe3a677067f29a748d05`, exact shared tree `3539ff0724e946cd6df97a55dfdea840d65653bc`. Public Git fetch independently confirmed the remote ref and no tree difference. Earlier source checkpoint `a4c4a42` / `83105ec2` is preserved; stage-one implementation and evidence remain in the same PR history.

| Hosted run at `9828011b` | Jobs | Result |
|---|---|---|
| [CI 38619472492](https://github.com/Xhhemoing/pi-sparkle/actions/runs/38619472492) | quality, Ubuntu smoke, Windows smoke | **3/3 success** |
| [Report root regression 38619472480](https://github.com/Xhhemoing/pi-sparkle/actions/runs/38619472480) | Ubuntu, Windows | **2/2 success** |

Both smoke jobs' actual `Development queue and controller` steps returned success. These run the new CLI and controller integration cases, in addition to existing doctor, children, native reliability and persistence checks. The quality job executes the repository's standard pinned pnpm workflow, type, lint, full test, build and probe steps. This is hosted Node 22.19.x evidence, separate from the local Node 24.19.0 result.

DP-01 through DP-08 are implemented, independently reviewed, verified and saved for review in [PR #60](https://github.com/Xhhemoing/pi-sparkle/pull/60). Final closeout changes only evidence and task documents; runtime source, tests, example and CI configuration remain identical to the tested checkpoint. Main stays `44db4b1`, with no merge, release or original-source application. LIVE-01 remains explicitly blocked by empty configured model selection and missing trial budget, with zero live trials; no effectiveness, cost benefit, adaptive/holdout or production conclusion is implied.
