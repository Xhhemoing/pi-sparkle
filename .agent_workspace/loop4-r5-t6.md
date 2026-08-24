# R5-6 — Dead letters are reachable: the mailbox skips the sending *role*, not the sending agent id

Slot: Round 5 · R5-6 (P2/P3, cluster semantics decision). Branch `agent/opt-continuous`, HEAD at start `6975aab`. No commit (per instructions). Parent sign-off consumed: **option (b) only**.

## 1. Census first (verified at HEAD, not brief hearsay)

| Symbol | Where | What it does today |
|---|---|---|
| `claimRole(role, agentId)` | `src/cluster/mailbox.ts:117-146` (pre-change) | Skipped a queued role-cast iff `mail.from === agentId`; every skip ticked `requeues`, and the tick that would exceed `maxRoleRequeues` dead-lettered the mail. Any other claimant was delivered to. |
| `DEFAULT_MAX_ROLE_REQUEUES` | `mailbox.ts:33` | `3`. Consumed by `createMailbox` and by three test files; no src consumer overrides it. |
| `runAttempt` | `src/run/child-coordinator.ts:639-641` | `createAgentInstanceId(this.generateId)` then `this.cluster.register(childAgentId, input.role, input.taskId)`. **The only production `register` call in the tree** (`rg '\.register\(' src` → this plus an unrelated `vault.register` in `experiments/simulation-holdout.ts`). One fresh id per *attempt*, so the same id never claims twice. |
| `ClusterHost.register` | `src/cluster/host.ts:185` | The only `claimRole` caller. |
| `ClusterHost.send` (role-cast) | `host.ts:212-229` | Unicasts to every *existing* holder of the role except the sender; only queues when that target set is **empty**. So a queued role-cast always means "the sender was the sole holder of that role at cast time". |

R4-2's census reproduced: with the instance-level skip plus fresh ids, no run could cross the bound, and `dead-lettered=` was structurally 0.

**Census finding R4-2 did not have, and it is worse than the brief says.** R4-2 concluded "`pending=` carries real starvation". That holds only for a run with exactly one registration of the role. As soon as a *second* attempt or sibling registers the same role, the old code handed the starved self-cast to that fresh id and it vanished from **both** counters. Measured as a negative control (§5): the new five-scout run reports `pending=0, dead-lettered=0` on the old predicate — the operator line prints nothing at all. So the old semantics did not merely fail to dead-letter; in the multi-registration shape it lost the signal entirely, by "delivering" a stale peer question to an unrelated later agent instance.

## 2. Decision (option b, as signed off)

**A role-cast is skipped when its sender holds the role it was cast at — not when its sender happens to be the claiming agent id.** The mailbox learns holders from the claims themselves (`claimRole(role, agentId)` is the registration signal, already called from exactly one place), so no new API and no new caller obligation.

Why this is the right granularity, in one line: an `AgentInstanceId` is *attempt*-scoped, so `mail.from === agentId` asks "is the claimant literally the same attempt?" when the question the invariant means is "is the claimant the same logical agent?". With a fresh id per attempt the instance test is always false, which is precisely why the bound was unreachable. Role is the coarsest safe approximation available without option (c) (stable per-task identity), which is out of scope this round.

The bound now means what the brief asked for: **this mail survived N claim opportunities on its own role.**

Consequences, stated plainly:

- A self-role-cast is now *undeliverable by construction*: the holder set only grows, so a mail that was requeued once is never delivered later — it is dead-lettered on claim `DEFAULT_MAX_ROLE_REQUEUES + 1` of that role and reported. Pinned.
- **Cross-role casts are untouched**, including their late delivery: mail addressed to a role its sender does not hold is delivered to the first agent that ever claims that role, however late, and never accrues a requeue. That is the case the working cluster path uses (`peer-mailbox.test.ts`, `DeliveredCastExecutor`), and it now has its own pin at a zero bound.
- Claims on *other* roles still do not advance the bound (no TTL, unchanged). Mail for a role nobody ever holds still sits in `pendingForRole` forever, still never dead-lettered.

Not taken, deliberately: (a) "API-only" documentation, since (b) was signed off; (c) stable per-task identity (touches R5-2's `child-coordinator.ts`, explicitly excluded); any TTL, sweep, drain/ack or durability.

## 3. Change

`src/cluster/mailbox.ts` (the whole behavioral diff is 4 lines):

```ts
const holdersByRole = new Map<AgentRole, Set<AgentInstanceId>>();
// ...
claimRole(role, agentId) {
  const roleHolders = holders(role);
  roleHolders.add(agentId);
  // ...
  if (roleHolders.has(mail.from)) {   // was: mail.from === agentId
```

Everything else in `claimRole` is byte-identical: same survivors list, same queue order, same `{ ...mail, to: agentId }` copy, same dead-letter record (`reason: "requeue-limit"`, `requeues: maxRoleRequeues`, injected `now()`), same `byRole.set(role, remaining)`.

One line deleted: `requeues.delete(mail.id)` in the *delivery* branch. It is now provably unreachable — a mail only has a tally if it was skipped, the skip predicate is monotone in the holder set, so a mail with a tally can never take the delivery branch. Removing it rather than leaving dead code is the R5-10 doctrine applied to my own file; the monotonicity it used to guard is pinned by test (§4, "a fresh agent id holding the sending role…" asserts tick 1 → tick 2 → drop across three distinct claimants).

Doc comments rewritten to the new contract: `DEFAULT_MAX_ROLE_REQUEUES`, `ClusterMailbox.claimRole`, and the three-bullet starvation disclosure on `createMailbox` (now four bullets: the role-level skip, the preserved cross-role late delivery, the unchanged no-TTL rule, the unchanged no-durability rule). `src/cluster/host.ts` gets a doc-only "Reachability" paragraph naming `send`'s sole-holder queueing rule and `ChildCoordinator.runAttempt` as the production shape that now reaches a drop.

**No signature, interface or shape changed.** `ClusterMailbox`, `ClusterDeadLetter`, `ClusterDeadLetterReason`, `MailboxOptions`, `deadLetterReport()`, `onDeadLetter`, `ClusterMailReport` and the pinned CLI line `warning: cluster role-cast mail undelivered: …` are all untouched — I edited no file outside my ownership (`src/run/coordinator.ts` is R5-1's this round and was read-only for me).

## 4. Tests

`test/unit/cluster/mailbox.test.ts` (11 → **13**, all pass):
- **replaced** "a claim by a different agent still delivers mail that was requeued earlier" — the one existing pin that encoded the instance-level skip, and the only existing test the decision invalidates — with "**a fresh agent id holding the sending role does not receive the role's own cast**": bound 2, three *distinct* claimants of `tester`, ticks 1 → 2 → drop, empty inbox for the fresh ids, dead-letter payload asserted.
- new "**a cast to a role its sender does not hold is delivered however late the role arrives**": at `maxRoleRequeues: 0`, claims on two other roles neither deliver nor tick, then the first `implementer` claim delivers with `to` rewritten. This is the regression guard for the delivery half.
- new "**the mailbox learns role holders from claims, so cast order does not matter**": a cast enqueued *before* its sender is known to hold the role still counts as self-role-cast on the first claim.
- renamed "a claim skips only mail cast by its own role…" (was "…the claimant's own mail"); assertions unchanged and green.
- untouched and green: the no-TTL pin, the zero-bound pin, default-bound pin, snapshot-copy pin, construction validation, `requeueCount` of unknown mail.

`test/unit/cluster/host.test.ts` (6 → **7**): new "**registrations with a fresh id per attempt reach the bound on the sending role**" — the host-level reachability pin, with the fresh claimant's inbox asserted empty at every step, the `onDeadLetter` push asserted exactly once, and `entries[0].requeues === DEFAULT_MAX_ROLE_REQUEUES`. The pre-existing "registrations for other roles never touch the starved queue" assertion (`requeueCount === 0` after an unrelated `scout` join) is **still green** — the no-TTL property survives the change intact.

`test/integration/cluster/undelivered-mail.test.ts` (7 → **8**, additive): "**a run registering a fresh id per attempt reaches a dead letter**" — a real `startParentRun` with `cluster: true` and five `scout` children chained through `dependsOn`, so the first scout is the only scout when it casts (its cast queues) and the four registrations that follow are four claim opportunities on its own role. Asserts the run completes and

```
clusterMail = { pending: 0, pendingByRole: [], deadLettered: 1,
                deadLetteredByRole: [{ role: "scout", count: 1 }],
                deadLetteredByReason: [{ reason: "requeue-limit", count: 1 }] }
line        = "warning: cluster role-cast mail undelivered: pending=0, dead-lettered=1 (scout=1; requeue-limit=1)\n"
```

Each child registers through `ChildCoordinator.runAttempt` with a fresh `createAgentInstanceId` — the exact shape the census said could never produce a drop. The stale doc comment on the host-driven dead-letter test ("no run can produce one today") was corrected; its assertions are unchanged.

## 5. Negative control

Restored the old predicate (`mail.from === agentId`) with everything else in place and re-ran the integration file: the new pin is the **only** failure, and it fails with

```
actual   { pending: 0, pendingByRole: [], deadLettered: 0, deadLetteredByRole: [], deadLetteredByReason: [] }
expected { pending: 0, pendingByRole: [], deadLettered: 1, … }
```

i.e. old semantics report *nothing* for this run (§1). Restored the file byte-for-byte and re-verified green.

## 6. Verification

- Scoped `eslint src/cluster/mailbox.ts src/cluster/host.ts test/unit/cluster/ test/integration/cluster/undelivered-mail.test.ts` → exit 0.
- Whole-tree `./node_modules/.bin/tsc --noEmit` → exit 0, run twice, with R5-1/R5-2/R5-3/R5-9's in-flight edits present in the shared tree (`src/run/{flowchart-run,supervisor,coordinator,child-coordinator,event-store}.ts`, `src/cli/{main,errors}.ts`, `src/learning/bandit-store.ts`, `src/privacy/deletion.ts`, `src/run/crash-terminal.ts`). No transients attributable to me; I edited none of them.
- Owned suites 3× (run-driven, so timing-sensitive): `test/unit/cluster/*` + `test/integration/cluster/*` → 33/33 pass on each of three runs.
- Full blast radius: `rg -l "clusterMail|summarizeClusterMail|mailbox\(\)" test/` returns only the two files I own, and `cluster: true` appears only under `test/integration/cluster/`. Ran those plus `test/unit/pi-adapter/cluster-tools.test.ts` (the downstream session consumer) → **40/40 pass, 0 skipped**. Per file: mailbox 13, host 7, undelivered-mail 8.
- No new skips. No scratch files in the repo (the negative-control copy lived in `/tmp`). Full gate is the parent's.

## 7. Disclosures and residuals

1. **One deliberate pin was deleted, not weakened elsewhere.** R2-8's "a claim by a different agent still delivers mail that was requeued earlier" is gone: same-role late delivery no longer exists. The behavior traded away is narrow — `host.send` already unicasts to every holder that exists at cast time, so the only mail affected is a cast made while the sender was the sole holder, and the recipient it would have reached is a later instance of the same role (very often a retry of the same task). It is now dead-lettered and *reported* instead of quietly handed to a stale reader. This is the cost of (b) versus (c); (c) would refuse only the same logical agent.
2. **Role granularity over-approximates.** A different *task* with the same role also no longer receives another task's queued self-cast. Bounded by the same argument as (1) — that peer, if it had been registered at cast time, would have been unicast directly.
3. `requeueCount` is now a countdown to a certain drop rather than a progress indicator that delivery can reset. Documented in the disclosure block.
4. Counts move between the two operator fields for multi-registration runs: shapes that used to print `pending=1` (single-registration runs, unchanged and still pinned) versus shapes that used to print nothing at all (multi-registration, now `dead-lettered=1`). The line *format* is byte-identical and its pins are green.
5. Not in scope, unchanged: TTL, sweep, drain/ack, durability, `deadLetters()` growth for the mailbox's lifetime.
6. **For R5-7 (docs):** the operator-facing statement R4-2 asked to be documented — "`dead-lettered=` is production-unreachable" — is **false at this HEAD**. The accurate wording: a role-cast a role sends at itself is dropped and reported after `DEFAULT_MAX_ROLE_REQUEUES` (3) further registrations of that role; mail waiting on a role nobody holds is still `pending=` forever with no TTL.
7. **For R5-1/R5-2:** no coupling. I touched neither `coordinator.ts` nor `child-coordinator.ts`; `runAttempt`'s fresh-id-per-attempt behavior is unchanged and is now the *supported* shape rather than the blocker.

## 8. Files touched

`src/cluster/mailbox.ts`, `src/cluster/host.ts` (doc comments only), `test/unit/cluster/mailbox.test.ts`, `test/unit/cluster/host.test.ts`, `test/integration/cluster/undelivered-mail.test.ts`, plus this report. Nothing else.
