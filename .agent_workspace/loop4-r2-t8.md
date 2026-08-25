[Model: claude-opus-5-thinking-high-fast]

# Loop 4 · Round 2 · R2-8 — Mailbox starvation honesty

Slot: R2-8 (P3, protocol/races). Branch `agent/opt-continuous`, working tree only — **not committed** (per instruction).

## Problem (restated from evidence)

`createMailbox` (`src/cluster/mailbox.ts:64-79` at HEAD `c3fee5c`) re-queues a role-cast mail whenever the claiming agent is the mail's own sender. If the only agent registered under that role is the sender, the mail is undeliverable and the old code kept it in the role queue forever: no TTL, no dead-letter, no counter, nothing an operator or test could observe. Fable §8 flagged this as starvation-by-design that the API refused to admit.

## Change (smallest honest fix)

Bounded **requeue count** with an observable dead-letter surface on the existing mailbox API. Purely additive; no durability, no persistence, no timer.

`src/cluster/mailbox.ts`:

- `claimRole` now counts each sender-skip for a mail. While the tally is `<= maxRoleRequeues` the mail is requeued exactly as before; the attempt that would exceed the bound drops it from the role queue and records a dead letter instead.
- New exports: `DEFAULT_MAX_ROLE_REQUEUES = 3`, `MailboxOptions` (`maxRoleRequeues?`, `now?`), `ClusterDeadLetter`, `ClusterDeadLetterReason` (`"requeue-limit"` — one reason, no speculative variants).
- New `ClusterMailbox` members (additive; the only implementation is `createMailbox`, the only consumer is `ClusterHost` via `host.mailbox()`, so no caller breaks):
  - `deadLetters(role?): readonly ClusterDeadLetter[]` — oldest first, snapshot copy, optional role filter. Each entry carries the mail, role, reason, the requeue count it burned, and `deadLetteredAt`.
  - `requeueCount(mailId): number` — how close still-pending mail is to the bound; `0` for unknown/delivered/dropped mail.
- `createMailbox(options = {})` keeps its zero-arg call shape. A non-integer or negative `maxRoleRequeues` fails closed with `DomainValidationError`. `now` is injectable so the dead-letter timestamp is testable without wall-clock flake.
- `claimRole` internals: builds the survivors list and assigns it once at the end instead of the old clear-then-push-back dance. Same queue order, same delivered array, same `{ ...mail, to: agentId }` copy semantics.

Delivery semantics for the non-starvation case are untouched: unicast still lands only on `to`; role-cast still goes to the first claiming non-sender; a mail that was requeued and is later claimed by a different agent is delivered normally and its tally is cleared.

### Documented starvation disclosure

A doc block on `createMailbox` now states the three deliberate limits, in the source that implements them:

1. A sender never receives its own role-cast; when the sender is the only role-holder the mail is undeliverable, is bounded by `maxRoleRequeues`, and then surfaces in `deadLetters()`.
2. The bound counts **claim attempts, not time**. There is no wall-clock TTL, and `ClusterHost` only calls `claimRole` from `register`, so a queue that sees no further registrations makes no progress toward the bound — role-cast mail for a role nobody ever claims stays in `pendingForRole` indefinitely and is never dead-lettered. This is the honest residual, disclosed rather than papered over.
3. No durability: pending mail, inboxes and dead letters are process-local and lost on exit, and dead letters accumulate for the mailbox's lifetime rather than being persisted or acknowledged. Durability remains the accepted non-goal (brief §5) — nothing here builds toward it.

The default of 3 is deliberate and documented: only sender-skips increment it, so it absorbs a couple of re-registrations by a lone role-holder and then terminates.

## Tests (`test/unit/cluster/mailbox.test.ts`, 9 added, 2 pre-existing kept unchanged)

- **sender-only role-cast is dead-lettered once the requeue bound is exceeded** — bound 2 and a fixed clock: two claims requeue (tally 1, then 2; still pending, no dead letters), the third drops it. Asserts the dead-letter payload (id, role, reason, `requeues: 2`, injected `deadLetteredAt`), that `pendingForRole` is empty, that `requeueCount` resets, and that a later claim by a *different* agent does not resurrect it.
- **the default requeue bound is what an unconfigured mailbox enforces** — pins `DEFAULT_MAX_ROLE_REQUEUES` against the constructed behavior, so the constant cannot drift from the code.
- **a claim by a different agent still delivers mail that was requeued earlier** — the required non-starvation case: requeued once, then delivered to a peer with `to` rewritten, queue drained, no dead letter, tally cleared.
- **a claim skips only the claimant's own mail and preserves queue order** — mixed senders in one queue: the peer's mail is delivered, the claimant's two stay in original order, and both dead-letter together on the next claim; the role filter on `deadLetters` is checked both positively and negatively.
- **a zero bound dead-letters sender-only mail on its first claim** — boundary at `maxRoleRequeues: 0`.
- **role-cast mail nobody ever claims stays pending: there is no TTL** — pins the disclosed residual so a future reader cannot mistake the bound for a timer.
- **dead-letter accessors hand back copies, not the live log** — snapshot isolation.
- **an invalid requeue bound is rejected at construction** — `-1`, `1.5`, `NaN` all `DomainValidationError`.
- **requeueCount reports zero for unknown mail**.

## Verification (this VM, Node v22.14.0)

- Owned tests: `npx tsx --test test/unit/cluster/mailbox.test.ts test/unit/cluster/spawn.test.ts` → **13/13 pass, 0 fail**.
- Lint on owned files: `npx eslint src/cluster/mailbox.ts test/unit/cluster/` → **clean, 0 problems**.
- Whole-tree `tsc --noEmit`: in the shared working tree it reports **two errors, both inside `src/privacy/deletion.ts` (lines 180, 185: `Cannot find name 'unlinkEpisodeFiles'`, `Cannot find name 'removed'`)** — that file belongs to R2-3 and was mid-edit by a sibling slot while I ran. Nothing in `src/cluster/**` or `test/unit/cluster/**` appears.
  - To get an attributable result I checked out a detached worktree at HEAD `c3fee5c`, copied in **only** my two files, and ran `tsc --noEmit` there: **exit 0, zero diagnostics**. In the same isolated tree, `npx tsx --test` over `test/unit/cluster/mailbox.test.ts`, `test/unit/cluster/spawn.test.ts` and the downstream consumer `test/unit/pi-adapter/cluster-tools.test.ts` → **20/20 pass**. The worktree was then removed (`git worktree list` shows only `/workspace`).
- Full gate not run (parent's job, per the slot instruction).

## Scope discipline

- Files touched: `src/cluster/mailbox.ts`, `test/unit/cluster/mailbox.test.ts`. Nothing else — `src/cluster/host.ts` was read to confirm the only `claimRole` caller and left alone (it is not in this slot's ownership, and it needs no change: `host.mailbox()` already exposes the new surface).
- No frozen contract touched: `appendJsonlLine`/`readJsonlObjects`, `writeFileAtomic`, `episodeLockPath` symmetry, the `runCommand` invocation-sink wiring, and `withExclusiveFileLock` are all untouched.
- Forbidden list respected: no live R1/bandit/topology, no Outcome-supported claim, ADR-006 untouched (stays Proposed), no auto-promote, no `package.json`/dependency edit, no git history change, **no commit**, and this is not a cosmetic edit — it changes `claimRole` behavior at the bound and adds observability that did not exist.

## Residual risk / follow-ups (not done here, deliberately)

- No wall-clock TTL: mail in a role queue that never sees a claim attempt is still unbounded in time. Fixing that needs a sweep trigger (a claim-time age check would mutate on read, a timer would add lifecycle to an in-memory helper); it is a separate decision, not a smallest-fix item.
- `deadLetters()` grows for the mailbox's lifetime with no acknowledge/drain. That is bounded by messages sent within one process and is disclosed in the doc block; adding `drainDeadLetters()` is trivial if a consumer ever needs it.
- Nothing currently reads `deadLetters()` in production code. The surface is observable by design (host, tests, future supervisor); wiring a warning into the cluster host or run telemetry would cross slot ownership and belongs to whoever owns `src/cluster/host.ts` next.
