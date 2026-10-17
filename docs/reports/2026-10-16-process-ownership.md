# M0-A process ownership: execution record

- Task: [TASK-20261016-process-ownership](../superpowers/plans/2026-10-16-process-ownership.md).
- Baseline: PR #60 `415b072b8be18818be84e87489d00d7d44826bce` (main `44db4b1`; PR #61 separate).
- Environment: Linux, Node 24.19.0, genuine cached pnpm 10.17.1; existing installed dependencies, unchanged lockfile.
- State: `ready-for-review` (author verified); GitHub publication blocked by automatic approval review.

## Behavioral changes

The internal recipe CLI now keeps recipes in the independent checker's POSIX
group. Normal leader exit also triggers cleanup if its group still has members.
Signal delivery/close is not OS containment proof: interrupted commands carry
`cleanupUnsettled`, and the aggregator reserves internal exit 3 for unresolved
inner cleanup. Native preflight copies/freezes host exit-code policy and refuses
overlap with repairable codes. Existing functional exit 1 and unavailable exit 2
retain their meanings; exported recipe checking retains its existing outcome API.

Strict/native verification refuses to inspect or issue exact snapshot authority
after unresolved effects. Native failure artifacts retain bounded process metadata
and return optional `effectsSettled: false`. The development controller preserves
the running task claim, marks its action needs-reconciliation and refuses replay.
Candidate/source rechecks use existing `candidate-check` actions, including before
a dependent task is claimed. Unknown checker views are retained; overlapping
unknown scopes are fenced while clearly disjoint work remains eligible.

No new scheduler, store schema, command status, Pi generation, live call, auto-apply,
source integration, PR #61 integration or release is introduced. Optional check
record fields are additive; ordinary successful records retain their old shape.

## Commands and observations so far

Raw command logs are retained under `.agent_workspace/m0-settlement/`.

| Command / log | Actual result | Interpretation |
|---|---|---|
| Baseline real-process regressions, `red.log` | 4 fail / 0 pass | Abort/repeated abort/deadline returned while writes continued; escaped case returned blocked/completed rather than uncertain |
| Initial runner/develop integration, `green-initial.log` | 13 pass / 1 fail | Group fix stopped three write paths; self-review exposed loss of uncertainty through nested pipes |
| Second focused run, `green-second.log` | 19 pass / 1 fail | Safety behavior passed; new refusal assertion expected the wrong existing error text (invalid transition) |
| Native/develop adjacency, `focused.log` | 62 pass / 1 fail | Existing cancellation reason lost the word cancelled; implementation now preserves cancellation plus cleanup detail |
| Controller/source integration, `focused-controller.log` | 32 pass / 0 fail | Existing run/review/accept/integrate semantics retained |
| Expanded process/native checks, `focused-expanded.log` | 16 pass / 0 fail | Own deadline, retained source-check view and parent crash/restart covered |
| Concurrent timing run, `focused-final-process.log` | 19 pass / 1 fail | Historical 300-ms timeout fixture never became ready under concurrent compilation/process load; original deadlines/assertions unchanged |
| Final focused runner/native/development/preflight/recipe/source integration, `focused-final.log` | 92 pass / 0 fail / 0 skip, 94.56 s | Existing and new behavior assertions passed; full gate covers the final atomic-marker cleanup refinement |
| `tsc --noEmit`, ESLint whole tree, `git diff --check` | PASS | No assertion, dependency, build permission or global configuration relaxation |

The final full gate uses one-CPU affinity to serialize Node's default file
concurrency. The above failed commands remain failures, not silently replaced
by later evidence.

## Self-review findings

1. Joining groups alone cannot prove escaped descendants stopped: add conservative
   uncertainty and preserve it through the internal checker exit protocol.
2. Before/after snapshot capture on an unresolved candidate would issue misleading
   evidence: refuse before the final capture/authority step in strict/native paths.
3. Source and candidate rechecks also own effects: reuse `candidate-check` ledger
   rows and retain views when interruption is unresolved, rather than disposing in
   an unconditional finally block.
4. Releasing a task token cannot prove stopped effects: consult pending write/check
   actions and scope overlap before another dispatch. Disjoint work can proceed.
5. Fixtures need atomic ready markers, bounded watchdogs and validated process IDs;
   cleanup must not accidentally signal PID zero or the test process.

This is author self-review, not independent verification.

## Remaining M0 and policy conditions

POSIX group cleanup covers the cooperative chain exercised here; arbitrary
deliberate detach/ignored-stdio escapes require OS containment. Windows interrupted
verification retains uncertainty; Windows whole-tree stopping is not claimed.
Parent-crash regression proves durable refusal to replay, not immediate death of
the child tree. No live-provider effectiveness, root monetary settlement,
independent review, production/R10/R11 or experimental/Outcome-supported gate is
closed. Interrupted strict tasks require stopped-worker actual-state reconciliation
using existing ActionLedger host APIs; deleting claims/receipts is not recovery.

Each strict recheck now records an effect in the existing ledger. Its existing
1024-action bound is unchanged and refuses before dispatch when exhausted;
terminal-record archival/retention is a separate follow-up, not an automatic
deletion of audit evidence or unknown effects. Direct native tasks do not acquire
a project queue or extra planner/reviewer calls through this change.

## Compatibility and further implementation boundaries

Old controllers do not fence these pending checker actions. Evaluation must use
an isolated state root, or stop old writers through the host before adopting a
shared root; an additive schema or marker cannot stop an old binary. Automatic
archive/reuse of terminal checker rows, atomic concurrent checker admission,
and general coding-tool process ownership remain follow-up M0 work. This slice
adds no parallel writer or general process-sandbox guarantee.

Publication preparation found concurrent documentation head `aac7a380` after
`415b072`. It adds the detailed architecture map/navigation and task records.
Those changes were preserved byte-for-byte; only independent new task sections
were prepended. No merge-conflict hunks were created or auto-resolved. Combined
source checkpoint `482dabbf4ba1784a6aa56987dcd262092a233e41` / tree
`916c966c5a38a3c39651491cbc5f923ee6d0df79` has exactly the tested `ed97692`
runtime, test, workflow, dependency, script and extension bytes. The final review
also corrects one explanatory controller comment without changing statements.

## GitHub publication block

The non-forced push to existing PR #60 branch
`codex/architecture-agent-loop-20261015` was rejected by automatic approval
review. The stated reason was an unverified destination and insufficient clear
end-user authorization for exporting code and changing that remote branch.
Read-only follow-up verified the remote as `Xhhemoing/pi-sparkle`, owner push
permission, the existing branch at `aac7a380`, and fast-forward ancestry. Historical
context did not establish the exact authorization required by the reviewer. No
alternate write endpoint or indirect push was attempted. Remote CI for this
change has therefore not run. The user can review the saved patch/evidence and
explicitly authorize that concrete existing-branch publication.

## Final author verification

Full gate command (genuine pnpm 10.17.1 first on the session-local PATH):

```sh
taskset -c 0 pnpm gate
pnpm security:probe
pnpm pi:probe
pnpm kernel-reuse:probe
```

| Check | Final outcome | Scope |
|---|---|---|
| Actual `pnpm gate` | PASS, exit 0 | workflow, typecheck, lint, 3596 tests / 3594 pass / 0 fail / 2 skip, build; test duration 513.21 s |
| Security probe | PASS 26; 0 open, waived or refused findings | Built tested source |
| Pi compatibility probe | PASS 4 | Existing Pi 0.86.1 boundary |
| Kernel reuse probe | PASS 3 | Existing kernel seams |
| Combined-tree review | PASS | Concurrent architecture map/docs preserved; runtime/tests/workflows/dependencies identical at `482dabb` vs tested `ed97692` |
| Final controller comment correction | PASS | TypeScript emit with comments removed is byte-identical to `ed97692`; no runtime statement change |
| Final workflow / diff / relative links | PASS | Final source and evidence tree, before local commit |
| Hosted Node 22.19.x / Windows jobs | NOT RUN for this delta | Source publication was blocked; no CI or Windows claim |

The two full-suite skips are the opt-in real-provider Pi smoke and the
Windows-only raw executable-tree refusal test on this Linux host. New
POSIX-specific process tests ran here; their Windows skip paths are not Windows
behavior evidence. No test timeout/assertion, dependency, build permission or
global configuration was relaxed. The final focused 92/92 command selected:

```sh
node scripts/run-tests.mjs --test-concurrency=1 \
  test/integration/development/process-ownership.test.ts \
  test/integration/development/controller-cancellation.test.ts \
  test/integration/development/controller.test.ts \
  test/integration/development/recipe-limits.test.ts \
  test/integration/development/source-integration.test.ts \
  test/integration/native/write-session.test.ts \
  test/integration/native/write-loop.test.ts \
  test/unit/execution/command-runner.test.ts \
  test/unit/execution/independent-check.test.ts \
  test/unit/native/write-preflight.test.ts
```

Next condition: explicit authorization to publish the prepared local commits to
`Xhhemoing/pi-sparkle`, existing PR #60 branch
`codex/architecture-agent-loop-20261015`; then record the actual hosted/platform
results. This does not authorize main merge, live calls, apply or a release.
