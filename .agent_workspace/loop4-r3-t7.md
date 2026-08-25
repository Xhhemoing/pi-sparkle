[Model: claude-opus-5-thinking-high-fast]

# Loop 4 · Round 3 · R3-7 — Dead letters reach an operator

Slot: R3-7 (P3, races/observability). Branch `agent/opt-continuous`, working tree only — **not committed** (per instruction).

## Problem (restated from evidence, re-verified at HEAD `152bdb4`)

R2-8 bounded sender-only role-cast starvation and recorded it as `ClusterMailbox.deadLetters()`, but nothing in production reads that surface — it was observable only to `test/unit/cluster/mailbox.test.ts`. `ClusterHost` is the sole `claimRole` caller (`src/cluster/host.ts:95`, inside `register`), so it is the only place where a drop can happen and the only place positioned to report one; it exposed `mailbox()` and left the reading to nobody. A lone role-holder shouting into its own role queue therefore produced a silent drop.

## Change (smallest wiring, `src/cluster/host.ts` only)

The host now observes its own drops and offers both a pull and a push surface. Purely additive to behavior — delivery, requeue, spawn and directory semantics are byte-for-byte unchanged, and `mailbox.ts` was not touched.

- **Pull:** `ClusterHost.deadLetterReport(): ClusterDeadLetterReport` — `{ total, byRole, byReason, entries, observerErrors }`. It is computed from `mailbox.deadLetters()` on every call rather than from a private copy, so it cannot drift from the mailbox and it includes drops caused by a caller claiming out-of-band through `host.mailbox()`. `byRole` / `byReason` are counted and sorted most-dropped first, ties broken by name, so a run summary can print a stable line.
- **Push:** `ClusterHostOptions.onDeadLetter?: (entry: ClusterDeadLetter) => void` — the same embedder-callback shape the host already uses for `onSpawn`, which is its only existing outward reporting path. Fired from `register` for each drop that appeared since the previous registration, so no drop is announced twice and none is skipped (including out-of-band ones, which are picked up at the next registration).
- **Reporting must not break the run:** an `onDeadLetter` that throws is caught and tallied in `report.observerErrors`; the drop itself still appears in `entries`, and the registration that observed it completes normally. Same principle as R3-5's "an append failure must not mask the real work".
- New exported types: `ClusterDeadLetterReport`, `ClusterDeadLetterRoleCount`, `ClusterDeadLetterReasonCount`. `ClusterDeadLetter` / `ClusterDeadLetterReason` are re-used from `mailbox.ts` as type-only imports.

### Non-goals held (both re-stated in the source doc block)

No TTL: the bound still counts claim attempts, and since the host only claims at `register`, a role queue with no further registrations still makes no progress — the report says nothing about mail nobody has tried to claim. No durability: the report is process-local and dies with the process. Neither is built toward here; both stay as R2-8 disclosed them.

## Tests (`test/unit/cluster/host.test.ts`, new file, 6 tests)

- **sender-only role-cast starvation reaches the host's dead-letter report** — the required operator-visibility case. A lone `reviewer` registers, role-casts to its own role, and the mail queues. A registration for an unrelated role is asserted *not* to advance the queue (the no-TTL residual, pinned at the host level). Then `DEFAULT_MAX_ROLE_REQUEUES` re-registrations requeue it (tally checked each time, report still empty), and the next one drops it: `total: 1`, `byRole [{reviewer,1}]`, `byReason [{requeue-limit,1}]`, `observerErrors 0`, the entry's mail id/body/`requeues`, an empty pending queue, and exactly one `onDeadLetter` push.
- **a cluster that delivers its mail reports nothing** — the non-starvation path: a scout's role-cast is delivered to the implementer that registers after it, and the whole report deep-equals the empty shape with no push.
- **counts group by role and reason, most-dropped first** — three roles with 2/2/1 drops pin both the descending-count order and the name tiebreak, plus `entries` ordering (oldest first, queue order within one claim).
- **an observer that throws is tallied and does not fail the registration** — `observerErrors: 1`, the drop still in `entries`, and the registering peer still in the directory.
- **a drop caused outside register is reported at once and pushed exactly once** — drops forced through `host.mailbox().claimRole` show in `deadLetterReport()` immediately (no lag, because the report reads the mailbox), push on the next registration, and do not re-push on the one after.
- **a report is a snapshot, not a live view** — an earlier report is unaffected by later drops.

### Mutation check (each mutation applied, run, reverted)

| Mutation | Caught by |
|---|---|
| drop the `reportNewDeadLetters()` call from `register` | tests 1, 4, 5 fail |
| notify from index 0 instead of the observed watermark | test 5 fails (exactly-once) |
| sort tallies by name only, no count ordering | test 3 fails |
| let observer exceptions escape (no try/catch) | test 4 fails |

## Verification (this VM, Node v22.14.0)

- Owned tests, 3× consecutive: `node --test --import tsx test/unit/cluster/host.test.ts test/unit/cluster/mailbox.test.ts test/unit/cluster/spawn.test.ts` → **19 pass / 0 fail** each run.
- Downstream cluster integration (not owned, run as a regression guard): `test/integration/cluster/peer-mailbox.test.ts` + `dynamic-spawn.test.ts` → **3 pass / 0 fail**.
- Scoped lint: `npx eslint src/cluster/host.ts test/unit/cluster/host.test.ts` → clean.
- Whole-tree `npx tsc --noEmit` → **exit 0, zero diagnostics** in the shared working tree (sibling slots' in-progress edits were present and clean at the time of the run).
- Full gate not run (parent's job, per the slot instruction).

## Scope discipline

- Files touched: `src/cluster/host.ts` (+92/−1) and new `test/unit/cluster/host.test.ts` (181 lines). Nothing else. `src/cluster/mailbox.ts` was read only — it stays settled, and adding a required member to the `ClusterHost` interface breaks no implementer (`createClusterHost` is the only one; `tsc` confirms).
- No frozen contract touched: `deadLetters`/`requeueCount` are consumed exactly as R2-8 published them; `appendJsonlLine`/`readJsonlObjects`, `writeFileAtomic`, `withExclusiveFileLock`, `episodeLockPath` symmetry, the invocation-sink wiring and R2-5's source pin are all untouched.
- Forbidden list respected: no live R1/bandit/topology, no Outcome-supported claim, ADR-006 untouched, no auto-promote, no `package.json` or dependency edit, no git history change, **no commit**.

## Residual risk / follow-ups (disclosed, not done here)

- **The last hop to a human is one line in an unowned file.** The host now reports; the two embedders that construct it — `src/run/coordinator.ts:322` and `src/run/flowchart-run.ts:267` (the latter is R3-5's file this round) — still pass neither `onDeadLetter` nor read `deadLetterReport()` at run end, so a CLI operator sees nothing yet. That hookup is deliberately outside this slot's exclusive ownership (`src/cluster/host.ts`, `test/unit/cluster/`); it is a `onDeadLetter: (entry) => …` option on the existing `createClusterHost({…})` call plus a summary line. Whoever owns the run-summary surface next should take it — the seam is now there and tested, which is the part that was missing.
- Push notification is register-driven by construction: a cluster that stops registering agents stops announcing drops, even though `deadLetterReport()` remains accurate for a poll. That is the same no-TTL residual R2-8 disclosed, not a new one.
- `observerErrors` is a count, not a log: a badly-behaved reporter is visible but its error is swallowed. Keeping the failure detail would need a logging seam the cluster layer does not have (`no-console` is an eslint error tree-wide), and inventing one exceeds "smallest wiring".
