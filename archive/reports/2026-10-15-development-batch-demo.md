# Offline development batch demonstration

- Task: B3-06 under [the controlling plan](../superpowers/plans/2026-10-15-development-batch-review.md).
- Owner: baseline agent; state: ready-for-review.
- Scope: new `examples/development-batch-demo.mjs`; no runtime or test changes.

The planned example uses built APIs and a retained real Git fixture. Two independent host tasks each undergo a scripted incorrect edit, a real failed host check, and a repair based on that feedback. Batch completion means two retained candidates ready for review; explicit acceptance and source application are absent. The historical review API follows both action receipts without re-verifying current candidate contents or changing queue/action records.

Acceptance: each review contains attempts `[false, true]`; real host exits are `[1, 0]`; the batch stops at its two-item limit with ready count two and accepted count zero; source HEAD, four fixture files and clean status remain unchanged; each candidate modifies only its assigned implementation and preserves both checkers. Record actual elapsed times, zero live-model calls, and unknown cost. Do not use checker side effects or infer live-model effectiveness.

## Verification

Author verification on 2026-10-15, Linux / Node 24:

| Command | Result |
|---|---|
| `node node_modules/typescript/bin/tsc -p tsconfig.build.json` | PASS |
| `node examples/development-batch-demo.mjs` | PASS, exit 0, empty stderr |
| `node node_modules/eslint/bin/eslint.js examples/development-batch-demo.mjs` | PASS |
| `node scripts/workflow-check.mjs` | PASS: 10 required files / 16 required headings |
| Scoped `git diff --check` | PASS |

Logs: `.agent_workspace/architecture-20261015/development-batch-demo-{build,lint,workflow}.log`; full observed output: `.agent_workspace/architecture-20261015/development-batch-demo-run.json`. Frozen example Git blob: `ad74b93e9df8cc95cf325d19fe726ebb855c9eb2`.

The real run stopped at `max-items` with two ready-for-review tasks, zero planned/running/blocked tasks, and **zero accepted tasks**. Each scripted worker ran attempts `[1, 2]`; each historical review reported acceptance observations `[false, true]` and actual command exit codes `[1, 0]`. `historicalAccepted: true` refers to the completed native host check; it does not change the queue's explicit host acceptance state. Both historical reviews state `reverified: false` and retain final/loop artifact references.

Observed batch elapsed time was **1013.80035 ms**. The `performance.now()` interval from batch start through historical review and final file/Git assertions was **1088.58488 ms**. These are descriptive measurements of this single scripted run. No live model was called; cost remains `unknown`, not an inferred measured zero.

Retained fixture root: `.agent_workspace/development-batch-demo-TtkrOa`.

| Task | Completed action | Retained candidate |
|---|---|---|
| `implement-addition` | `action_v1_6a61d53a-797f-4a49-a1f5-b63a85ac3421` | `candidates/wt-5-mv8uedu9` |
| `implement-multiplication` | `action_v1_0d55509e-953e-4be6-a960-02a97f58cc94` | `candidates/wt-5-mv8uee8a` |

Each candidate contains only its assigned repaired implementation; the other implementation remains the committed stub. Both checker files remain unchanged in both candidates. Historical review leaves snapshotted queue/action/source/candidate bytes unchanged and does not add worker executions. The original source HEAD, implementation/checker contents and clean Git status remain unchanged; `sourceApplied` is false. The example contains no accept/release/apply call and retains all candidates and evidence for inspection.

## Independent review and execution

Research agent reviewed the exact frozen example blob above and independently ran `node examples/development-batch-demo.mjs`: **PASS**, exit 0, stderr 0 bytes, no scoped findings. Output is `.agent_workspace/architecture-20261015/development-batch-demo-independent-run.json`; stderr is recorded beside it. Batch elapsed **869.663136 ms** and total measured duration **934.146428 ms**. The independent run confirmed two ready tasks, zero accepted tasks, four worker executions, each task's `[1, 2]` scripted attempts, `[false, true]` historical outcomes and `[1, 0]` host exit codes. Both retained candidates were checked to exist.

Independent fixture: `.agent_workspace/development-batch-demo-cDmHmP`. Addition action `action_v1_23376008-3a7a-4aa5-8fd6-164065e4fd4e` retained `candidates/wt-5-mv8ugjof`; multiplication action `action_v1_dbb45f3f-7a8a-4e0e-9892-57053983199c` retained `candidates/wt-5-mv8ugk0b`. Source and review snapshots remained unchanged, `sourceApplied: false`, live calls zero, cost unknown.

Aggregate/hosted gates and staged source saving remain coordinator-owned. This demonstration does not establish live-model effectiveness, production readiness or any experimental gate.
