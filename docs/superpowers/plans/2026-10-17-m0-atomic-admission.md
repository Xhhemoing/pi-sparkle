# M0-B atomic effect admission and scoped readiness

- Task: `TASK-20261017-m0-atomic-admission`; owner: M0 implementation agent.
- State: ready-for-review, author focused checks complete; continuation of
  ADR-009/M0-A, not full M0 acceptance. [Author record](../../reports/2026-10-17-m0-atomic-admission.md).
- Scope: `src/development/{action-ledger,controller,work-item-store,work-items}.ts`
  and focused development tests. Root owns task/status reconciliation and delivery.

## Problem and design

The controller's list/prepare/claim sequence admits two different overlapping
actions after concurrent empty observations. Existing per-row compare-and-swap
does not serialize admission across rows. Reuse the existing short
`ActionStore.update` lock to check host conflicts and publish a running action
atomically; both checker and writer use it. Do not run effects under that lock.
Admission rejection must leave no prepared row. Running and uncertain rows,
including legacy bindings that cannot prove disjointness, remain fences.

Queue readiness currently rechecks all accepted rows, so an unrelated uncertain
accepted A blocks independent B. Select from existing ordered eligible items,
verify accepted ancestors and overlapping accepted scopes for each item, and
allow only explicit host-classified effect conflicts to skip that item. Never
swallow corruption, invalid evidence, caller cancellation or arbitrary errors.
Use the current task definition/claim, not an owner name, as authority; owned
native verification remains within its candidate-write effect. Separate checks
are never exempted merely because their owner string matches.

## Acceptance and test-first cases

1. Two ledger instances concurrently admit overlapping checker/write actions:
   exactly one running effect is published; rejected attempts create no rows.
2. Distinct scopes can be admitted concurrently; unknown/legacy bindings remain
   conservative; running/uncertain rows survive restart and refuse overlap.
3. Reusing the same idempotency key cannot replay running/completed effects or
   change immutable input identity; settlement still fences stale claims.
4. A planned task verifies accepted ancestors/overlapping rows, but skips
   unrelated accepted rows. An uncertain A does not prevent independent B;
   dependent/overlapping work remains unclaimed until reconciliation.
5. Caller cancellation and invalid evidence are not treated as skippable
   conflicts. Existing explicit accept and completed-receipt recovery still
   reverify actual evidence. No-ready queues do not dispatch freshness checks.
6. Real controller integration exercises atomic admission, with fixture barriers
   and bounded cleanup, plus existing process/cancellation/source-integration
   regressions. No real provider, production migration or paid model calls.

Run the new focused tests RED before implementation, then their GREEN and
adjacent development/ledger tests. Coordinate expensive process/full gate runs
with root so they are serial. Root runs the final applicable `pnpm gate`,
workflow/probes, records exact results and publishes. No commit/push from this
agent.

## Compatibility, bounds and rollback

Keep ledger/queue schema 1, existing prepare/claim APIs, frozen CLI/event fields,
capacity limits and durable receipts. Conflict rejection adds no records;
successful checks still consume explicitly bounded audit rows. Automatic
terminal archival/reuse is deferred rather than deleting audit or unknown
effects. General coding-tool uncertainty, OS containment/Windows qualification,
legacy no-caller-signal timeout behavior, live/provider/production gates remain
separate. Stop old controllers or use isolated roots: additive code cannot fence
an older binary that still uses unguarded admission. Abort on schema/contract
disagreement; preserve all unknown effects and claims for host reconciliation.
