# M0-B atomic admission and scoped readiness: author record

- Plan: [TASK-20261017-m0-atomic-admission](../superpowers/plans/2026-10-17-m0-atomic-admission.md).
- Environment: restored source checkout, Linux, Node 24.19.0; frozen dependencies.
- State: author focused verification complete; combined full gate/publication is
  owned by the root task and recorded separately. No commits/pushes by this agent.

## Resulting behavior

`ActionLedger.admit` checks host conflicts and publishes prepared/running
history in one existing `ActionStore.update`. The controller uses it for both
checker and writer admission. Concurrent different action IDs cannot both pass
an empty precheck for overlapping effects. A rejected contender creates no row;
running/uncertain records persist across restart. Reusing a running/completed
idempotency key cannot replay an effect. Existing explicit prepare/claim and
stopped-worker reconciliation APIs remain available.

Readiness evaluates the existing priority-ordered eligible candidates, checking
accepted ancestors and overlapping accepted rows for the particular candidate.
Only explicit host-classified effect conflicts permit trying unrelated work;
invalid evidence and cancellation still fail. A fully accepted queue dispatches
no freshness checks. No additional planner/model calls or scheduler were added.
Checks performed inside a native write stay owned by that write action; a
matching owner name never exempts another running/uncertain action.

The controller now shares the exact safe literal scope validator with task
definitions. Malformed legacy scope bindings, including glob/colon/.git/NUL/
blank/overlength prefixes, conservatively fence admission rather than proving
disjointness. Its state-layout import also follows the concurrent M2 forwarding
migration to `persist/state-layout`.

## Test changes and actual observations

Raw logs are under `.agent_workspace/m0-atomic/`.

| Command / log | Actual observation |
|---|---|
| Initial focused RED, `red.log` | 10 fail / 0 pass; old all-accepted checking, missing host conflict classifier and missing atomic API. Dependencies were still installing, so this Node-only RED used Node 24 experimental type transformation with a temporary local `.js`→`.ts` resolution hook. No package/tooling files changed. |
| Standard tsx new focused tests, `green.log` | 10 pass / 0 fail / 0 skip. |
| Standard tsx adjacent ledger/work-items/store/cancellation, `adjacent.log` | 50 pass / 0 fail / 0 skip, 1.80 s. |
| Initial controller/process command, `controller-process.log` | 40 pass / 1 fail: independent B was correctly selected, but its fixture omitted the required snapshot file. Strict snapshot refusal was preserved; the fixture now tracks that baseline file. |
| Disjoint diagnostic, `disjoint-diagnostic.log` | 1 fail; reason was `exact snapshot: required include prefix is missing`, confirming the fixture problem. |
| Malformed legacy binding RED, `malformed-red.log` | Command exit 1, seven printed failures and no aggregate summary. Do not interpret this partial log as an eight-test aggregate result. Shared scope validation was then implemented. |
| Final serial controller/process command, `controller-process-green.log` | 49 pass / 0 fail / 0 skip, 26.36 s: real checker contention, checker admitted after writer advisory reads, accepted-A uncertainty/disjoint-B progress, malformed bindings, cancellation, source integration, actual nested processes and parent crash/restart. |
| Final adjacent group plus controller-admission, `final-focused.log` | 61 pass / 0 fail / 0 skip, 4.20 s; includes the final fixture cleanup-await guard. |
| `git diff --check` | PASS after the final runtime changes. |

The old writer prepare/claim gap no longer exists. Its cancellation tests now
exercise atomic admission and checkpoint cancellation, retaining zero executor
dispatch, the original task token and uncertain action assertions. Standalone
prepare/claim CAS/recovery regressions remain unchanged. Selection-cancellation
fixtures now make the next task depend on accepted A, keeping A's checker
relevant; the source-view retention fixture likewise includes a pending
dependent. No-ready behavior has its own explicit no-new-check regression.

Commands for the two adjacent groups:

```sh
node scripts/run-tests.mjs --test-concurrency=1 \
  test/unit/development/action-admission.test.ts \
  test/unit/development/action-ledger.test.ts \
  test/unit/development/work-items.test.ts \
  test/integration/development/scoped-readiness.test.ts \
  test/integration/development/work-item-store.test.ts \
  test/integration/development/work-item-cancellation.test.ts

node scripts/run-tests.mjs --test-concurrency=1 \
  test/integration/development/controller-admission.test.ts \
  test/integration/development/controller.test.ts \
  test/integration/development/controller-cancellation.test.ts \
  test/integration/development/source-integration.test.ts \
  test/integration/development/process-ownership.test.ts
```

## Review and remaining conditions

Self-review added fixture cleanup awaiting the checker settlement even when a
readiness assertion fails. Independent source review identified the malformed
legacy scope mismatch; the shared-validator fix and real-controller regressions
address that finding. Final independent review and combined gate status belong
to their own records, not this author report.

This slice fixes accepted-row freshness starvation. A high-priority *planned*
item explicitly released while its own unresolved action persists may still
return reconciliation before lower-priority disjoint work. It does not claim
global starvation freedom or introduce a new scheduling policy.

Terminal checker archival remains deferred. Successful actual checks consume
bounded audit rows; conflict/no-ready calls do not. Existing 1024-action/8 MiB
limits still refuse before dispatch. Nothing deletes unresolved or terminal
evidence. General coding-tool process uncertainty, OS containment, Windows
qualification, legacy no-caller-signal verifier timeout behavior and real-provider/
production/experimental gates remain open. Stop older controllers or use isolated
state roots before adopting this cooperative admission change; old binaries do
not honor the new atomic conflict protocol. Schema and frozen CLI/event fields
are unchanged.
