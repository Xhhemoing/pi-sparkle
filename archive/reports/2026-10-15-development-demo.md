# Runnable offline development demonstration

- Date/environment: 2026-10-15; Linux; Node 24.19.0.
- Owner: baseline agent; root owns combined gates and staged save.
- Controlling plan: [development control plane](../superpowers/plans/2026-10-15-development-control-plane.md), runnable offline demonstration subitem.
- Deliverable: [`examples/development-demo.mjs`](../../examples/development-demo.mjs).

## Reproduce

From the repository root after installing the pinned dependencies:

```sh
node node_modules/typescript/bin/tsc -p tsconfig.build.json
node examples/development-demo.mjs
```

The example uses built runtime modules. Each invocation creates a fresh temporary Git fixture beneath `.agent_workspace/`, preserves its source/candidate/state directories and prints their absolute paths. It changes no existing project source. This example adds orchestration and assertions over already-tested APIs; no runtime source or test files were edited.

## Demonstrated behavior

The host queue contains one scoped addition task and a committed `check-add.mjs` criterion with declared `protectedPaths`. The scripted executor writes subtraction on the first attempt. A real Node checker fails with exit 1; the second attempt receives its stored feedback and writes addition. The repaired candidate passes the actual host checker with exit 0. The script reads both durable artifacts and asserts that their trusted-verification records remained valid, distinguishing an actual behavior failure from unavailable or changed verification.

`runNext` leaves the task `ready-for-review`. Only a separate explicit `controller.accept` call advances it to `accepted`, re-verifying the evidence. The example then confirms there is no next task. Assertions also check that the original source revision, source content, host checker and clean Git status are unchanged. The candidate contains the repaired implementation and unchanged protected checker, and remains available for inspection. No apply or cleanup is performed.

The existing `summarizeDevelopmentTrials` receives the actual attempt count, final accepted queue state and elapsed `performance.now()` time from `runNext` through explicit acceptance, including artifact inspection. Output includes `descriptiveEvaluation` with mode `scripted` and cost source `unknown`; absence of model calls is not treated as a measured zero total cost. Observed/estimated subtotals are empty, cost coverage is zero, and cost per accepted task remains undefined.

## Actual verification

| Command | Result | Evidence |
|---|---|---|
| `node node_modules/typescript/bin/tsc -p tsconfig.build.json` | PASS, exit 0 | `development-demo-build.log` |
| `node examples/development-demo.mjs` | PASS, exit 0; attempts `[1, 2]`; host exits `1 → 0`; explicit acceptance | `development-demo-run.json`; empty `development-demo-run.stderr.log` |
| `node node_modules/eslint/bin/eslint.js examples/development-demo.mjs` | PASS, exit 0 | `development-demo-lint.log` |
| `node scripts/workflow-check.mjs` | PASS, exit 0 | `development-demo-workflow.log` |

Command logs are under `.agent_workspace/architecture-20261015/`. The latest observed action was `action_v1_984fb5d4-046c-4d63-b0b3-5ade3532b615`; retained fixture root was `.agent_workspace/development-demo-ZDdrH0`, with candidate `candidates/wt-5-mv8ge8qi` and `queue.json` beneath that root. These generated identifiers and paths vary on later runs.

The measured descriptive sample has one task, one accepted task, two attempts, first-pass rate 0, repair success rate 1 and elapsed time 713.05 ms. This is a single predetermined scripted mechanism trial, not a statistical success-rate estimate or comparative benchmark. The earlier pre-evaluation execution also passed and its retained fixture remains separate.

The run emitted `mode: "offline-scripted"`, `liveModelCalls: 0`, `supportsLiveEffectivenessClaim: false`, `sourceUnchanged: true` and `sourceApplied: false`. It demonstrates controller mechanics and evidence handling. It provides no live model success-rate, cost comparison, autonomous development effectiveness or production approval evidence.

Research agent independently reviewed and executed the final example including descriptive-evaluation wiring, reporting no concrete blocker. Reviewed example Git blob: `5b210f781ffb61abbf5d177b61c5f61356093f37`. The independent command exited 0 with empty stderr and confirmed attempts `[1, 2]`, host check exits 1 then 0, ready-for-review then explicit acceptance, unchanged source and retained candidate. Its actual elapsed trial time was 617.86 ms; the single scripted task was accepted after two attempts, with unknown cost, zero cost coverage and no cost-per-accepted-task estimate. Evidence: `development-demo-independent-run.json` beneath the same log directory; retained fixture `.agent_workspace/development-demo-x2aOXM`, candidate `candidates/wt-5-mv8gh8dh`. These independent results are separate from the author run above.

## Handoff

Retained files can be inspected using the emitted paths; the demonstration intentionally leaves deletion to the host after review. Complete checker dependency declarations remain a host responsibility. Root owns the final integrated gate and revision binding; this report covers the executed built demonstration only.
