[Model: claude-opus-5-thinking-high-fast]

# Loop 4 · Round 4 · R4-2 — Dead letters actually reach an operator (the last hop)

Slot: R4-2 (P2, operability). Branch `agent/opt-continuous`, working tree only — **not committed** (per instruction). Base HEAD `9db9bab`.

## Census first: the brief's evidence held, and one thing it did not say

Re-verified at HEAD before writing any code:

- `createClusterHost` has exactly two production call sites, `src/run/coordinator.ts:322` and `src/run/flowchart-run.ts:267`, and both passed only `onSpawn`. No production caller of `deadLetterReport()` or `onDeadLetter` existed (`rg deadLetter src/` returned only `cluster/host.ts` and `cluster/mailbox.ts`). R3-7's evidence stands.
- **New finding, and it changes the shape of the fix: no run can produce a dead letter today.** A drop requires the mailbox's requeue bound to be crossed, and `claimRole` only counts a requeue when `mail.from === agentId` (`cluster/mailbox.ts:122`) — i.e. when the *same* agent instance re-registers. `ClusterHost.register` has one production caller, `ChildCoordinator.runAttempt` (`run/child-coordinator.ts:633`), and it mints a **fresh** `createAgentInstanceId` for every attempt one line earlier (`:631`). So the same id never registers twice, no mail ever reaches `attempted > DEFAULT_MAX_ROLE_REQUEUES`, and `deadLetterReport().total` is 0 in every real run. What a sender-only starvation actually produces is mail that sits in the role queue forever — the case `cluster/mailbox.ts:66-69` already documents ("Role-cast mail for a role that nobody ever claims stays visible in `pendingForRole` indefinitely and is never dead-lettered").

That is why the operator surface here reports **undelivered mail**, of which dead letters are one of two kinds. A consumer that read only `deadLetterReport()` would have been a line that can never print, and the brief's own acceptance test ("sender-only starvation produces the line") would have been unwritable through real wiring. Both surfaces are read exactly as published; `cluster/host.ts` and `cluster/mailbox.ts` were not touched.

## Change

### `src/run/coordinator.ts` (owned outright)

- `ClusterMailReport` + `ClusterMailRoleCount`: `{ pending, pendingByRole, deadLettered, deadLetteredByRole, deadLetteredByReason }`.
- `summarizeClusterMail(host)`: reads `host.mailbox().pendingForRole(role)` across `AGENT_ROLES` (a role queue can be starved precisely when no agent holds that role, so the roles have to come from the canonical list, not from `peers()`), and `host.deadLetterReport()` for the drop half. Pending counts are sorted most-first with a name tiebreak — the same ordering R3-7 gives its tallies, so the printed line is stable.
- `RunOutcome.clusterMail?: ClusterMailReport` — present whenever the run had a cluster (including `pending: 0`, i.e. "looked, found nothing"), absent otherwise. `startParentRun` fills it at the existing return.

**Pull, not push, and the reason is not taste.** `onDeadLetter` fires from `register`, so drops caused by an out-of-band `mailbox()` claim are only announced at the *next* registration — and a run that is ending has no next registration (`cluster/host.ts:109-118` says this itself). `deadLetterReport()` is recomputed from the mailbox on every call and cannot lag. The push seam stays available and unchanged for embedders that want a drop mid-run; the doc block on `summarizeClusterMail` records the choice.

### `src/run/flowchart-run.ts` (only `createClusterHost` options + outcome/summary)

`attachChildRuntime` now returns the `clusterHost` it built, `FlowchartLoopContext` carries it, and `finish()` puts `clusterMail` on the outcome. Read after `cancelAndSettle()`, so every child that could still claim role mail has settled first. `FlowchartRunOutcome.clusterMail?` added. The `recordCrashTerminal`/teardown region (R4-4's) was not touched — the diff there is R4-4's own in-flight work in the shared tree.

The report is honest at a pause too: the mailbox is process-local, so mail still queued when a `PAUSED`/`WAITING_FOR_USER` run returns is *gone* — resume builds an empty host. Surfacing it at every `finish()`, not just terminal ones, is deliberate.

### `src/cli/main.ts` (only the run-summary/warning output region)

One stable line, same shape as the invocation-drop warning (single stderr line, never fails the run):

```
warning: cluster role-cast mail undelivered: pending=1 (scout=1), dead-lettered=0
warning: cluster role-cast mail undelivered: pending=3 (scout=2, tester=1), dead-lettered=1 (reviewer=1; requeue-limit=1)
```

`formatUndeliveredClusterMail(report)` (exported, pure) returns `undefined` for no cluster or nothing undelivered, so a healthy run stays silent — the existing `assert.deepEqual(err, [])` pins in `test/integration/m1/cli-children.test.ts` still hold. `warnUndeliveredClusterMail(io, …)` is called from `printFlowchartOutcome` (which covers `run --flowchart`, `run --children`, `resume` and `answer` in one place, without entering `resumeCommand` — R4-6's region) and from the `--track` summary block. `resumeCommand`'s parse/executor region was not touched.

## Tests — `test/integration/cluster/undelivered-mail.test.ts` (new, 7 tests)

- **a starved role-cast reaches the parent run's outcome and the operator line** — the required E2E on the coordinator embedder: a real `startParentRun(… cluster: true)` with one scout child whose executor emits a `PEER_MESSAGE` addressed to its own role. Run COMPLETES, `outcome.clusterMail` deep-equals `pending: 1 / scout=1 / deadLettered: 0`, and the formatter yields the exact line.
- **… the flowchart run's outcome and the operator line** — same starvation through `startFlowchartRun` with `childTasks` + compiled flowchart (the embedder the CLI actually uses for `--children`/`--track`), same assertions.
- **a cluster run that delivers its peer mail reports nothing and prints no line** — scout casts to `implementer`, an implementer child follows and claims it: report is all zeros, formatter returns `undefined`.
- **a run without a cluster carries no mail report** — `clusterMail` absent, no line.
- **dead letters from the host surface in the same summary and line** — the R3-7 half, driven straight at `createClusterHost` because (see census) no run can drive it: forced re-registration past `DEFAULT_MAX_ROLE_REQUEUES`, then `summarizeClusterMail` and the exact `dead-lettered=1 (reviewer=1; requeue-limit=1)` line.
- **pending and dead-lettered mail share one line, counts ordered by size then role** — pins the full line shape and the ordering.
- **both CLI run-summary paths warn about undelivered cluster mail** — source pin (R3-9 pattern): exactly two `warnUndeliveredClusterMail(io, …)` call sites, one of them inside `printFlowchartOutcome`. Needed because the CLI has no seam to inject a peer-mail executor: `--children`/`--track` build `ChildFakeExecutor` in `main.ts` (outside this slot's region) and it never sends peer mail, so a true `main()`-level E2E of the line is not reachable this round.

### Mutation check (each applied, run, reverted)

| Mutation | Caught by |
|---|---|
| drop `clusterMail` from `startParentRun`'s return | tests 1 and 3 fail |
| drop `clusterMail` from `finish()` in `flowchart-run.ts` | test 2 fails |
| drop the `warnUndeliveredClusterMail` call from `printFlowchartOutcome` | test 7 fails |

## Verification (this VM, Node v22.14.0)

- Owned tests 3× consecutive: `node scripts/run-tests.mjs test/integration/cluster` → **10 pass / 0 fail / 0 skip** each run.
- Neighbouring suites as a regression guard: `test/integration/m2.5 test/integration/m1 test/integration/track test/unit/cluster test/unit/run` → **199 pass / 0 fail**.
- Scoped lint: `npx eslint src/run/coordinator.ts src/run/flowchart-run.ts src/cli/main.ts test/integration/cluster/` → clean.
- Whole-tree `npx tsc --noEmit` → exit 0, zero diagnostics (final run). One earlier run reported `main.ts has no exported member 'formatUndeliveredClusterMail'` while a sibling slot was mid-write on that shared file; the export was present throughout and the next run was clean — shared-tree transient, attributed to the file, not fixed by editing anything.
- Whole-tree test run (informational, full gate is the parent's job): **1661 tests / 1657 pass / 3 fail / 1 skip**. The one skip is the `PI_SMOKE` gate — this slot added none. All three failures are sibling slots' in-flight work in the shared tree, not mine:
  - `test/integration/pi-adapter/loopback-cli-resume.test.ts:172` — asserts empty stderr, now receives R4-6's new `warning: resume rebuilt the pi executor on defaults …` line. R4-6 × R4-10 collision.
  - `a run directory recreated by a live writer fails the delete loudly` and `the run delete cannot report a subtree removal it did not verify` — R4-1's run-delete lock, mid-edit (`src/privacy/deletion.ts` also failed `tsc` transiently earlier in the round with `Cannot find name 'runLockPath'`, and compiled clean later).

## Scope discipline

- Files touched: `src/run/coordinator.ts`, `src/run/flowchart-run.ts` (createClusterHost options + outcome/summary only), `src/cli/main.ts` (run-summary/warning output only), new `test/integration/cluster/undelivered-mail.test.ts`. No `m2.5` addition was needed — the flowchart embedder's E2E lives with its sibling in `test/integration/cluster/`.
- Frozen contracts held: `deadLetterReport()`/`onDeadLetter` consumed exactly as R3-7 published them, no reshaping, no new host/mailbox member. No TTL, no durability, no drain/ack, no mailbox edit. `recordCrashTerminal` (R4-4) and `resumeCommand` (R4-6) untouched; the invocation-sink wiring pin untouched and green.
- Forbidden list respected: no live R1/bandit/topology, no Outcome-supported claim, ADR-006 untouched, no auto-promote, no `package.json`/dependency edit, no git history change, **no commit**.
- `src/track/loop.ts` (R4-1's file) was read but not edited: `TrackRunOutcome extends RunOutcome`, so `--track` inherits `clusterMail` through its existing `...outcome` spread with no change there.

## Residual risk / follow-ups (disclosed, not done here)

1. **The dead-letter bound is unreachable in production** (census above). This slot reports drops correctly and pins them, but until either agent ids are stable across a task's attempts or the bound counts something other than same-sender claims, `dead-lettered=` will read 0 forever and `pending=` is the field that carries real starvation. Deciding that is a mailbox-semantics change — explicitly out of scope this round; it is Round 5 evidence.
2. **No `main()`-level E2E of the printed line.** Blocked on `ChildFakeExecutor` (region-owned elsewhere) never sending peer mail; covered instead by a real-run E2E through both embedders plus the exported formatter and a source pin. A test-only fake that role-casts, exposed through the CLI's executor factory, would close it.
3. **The coordinator embedder has no CLI caller.** `startParentRun` is used only by tests today (`--children` and `--track` both go through `startFlowchartRun`), so its half of the wiring is API-visible, not operator-visible, until something calls it. Wired anyway, per the brief's "both embedders".
4. **One line, no remedy text.** The line says what was lost, not what to do about it — matching the invocation-drop precedent. The honest remedy ("that peer message never arrived; the mailbox is process-local and holds no TTL") is documentation, and `docs/**` belongs to R4-8: the host dead-letter surfaces are on its undocumented list, and the pending-mail half now belongs on it too.
