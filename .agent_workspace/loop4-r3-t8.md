claude-opus-5-thinking-high-fast

# Loop 4 · Round 3 · R3-8 — Scheduler and supervisor leftovers

Slot: P3, honesty/dead code. Files owned and touched: `src/run/scheduler.ts`, `src/run/supervisor.ts`,
`test/unit/run/scheduler.test.ts`, `test/integration/m2/scheduler.test.ts`. No other file was edited.
Not committed (per instruction).

## 1. Census first — the brief's three claims, re-verified at HEAD

The brief said "do not trust the brief". All three claims held, and the census turned up one the brief
did not mention.

**(a) `applySkipped` has no production caller — CONFIRMED.** Repo-wide search for `applySkipped` returns
exactly four hits: the definition (`scheduler.ts:165`), one unit-test import and one unit-test call
(`test/unit/run/scheduler.test.ts:12,186`), and prose in `.agent_workspace/*.md`. There is no barrel or
`index.ts` re-exporting `run/scheduler.js` — the only three importers of that module in the whole tree are
`src/run/supervisor.ts`, `test/unit/run/scheduler.test.ts`, `test/integration/m2/scheduler.test.ts` — so
removal cannot break an external consumer. I also checked the deeper question the function's own doc comment
raised ("a task becomes SKIPPED **only** through this transition"): nothing in the DAG plane produces a
SKIPPED `TaskStatus` at all. `TASK_STATUS_CHANGED` is written only through the supervisor's `recordStatus`,
and no call site passes SKIPPED. Every other SKIPPED in `src/` belongs to the flowchart plane, which is a
**different union** (`FlowNodeState` in `supervisor/flowchart-supervisor.ts`, set via `setRuntime` and the
`skip` injection) and is untouched by this slot.

**(b) `planRound`'s `_leaseDurationMs` is unread — CONFIRMED, and every call site is inside this slot.**
Three call sites exist: `supervisor.ts:275`, the owned unit test (8 calls), the owned integration test
(1 call). R2-9 left the parameter because dropping it was a cross-file change it did not own; this slot owns
all three files, so the blocker is gone.

**(c) `supervisor.ts:253` says "orphaned or expired leases" — CONFIRMED,** and stale in the exact way R2-9's
contract rewrite made visible: nothing expires a lease, so "expired" describes a mechanism that does not exist.

**(d) NEW finding, not in the brief — `applyRetry` also has no production caller.** Same search discipline:
`applyRetry` appears in `src/` only at its own definition and in a doc comment. The supervisor performs the
BLOCKED→READY retry **inline** (`await recordStatus(taskId, "READY", transition.attempt)` at two sites) rather
than calling the declared rule. I did **not** change this — see §5, it is a materially different case from
`applySkipped` and fixing it is a refactor, not a smallest honest fix.

## 2. Decision: remove, not wire

Wiring `applySkipped` would mean inventing a DAG-plane skip decision — new behavior, a new event producer, and
new resume/readiness semantics. That is the opposite of a P3 dead-code slot, and the system already has a skip
decision where skips are actually made (the flowchart plane's `skip` injection, which validates against
`SKIP_FORBIDDEN` states and moves a `FlowNodeState`). The honest action is removal plus a pin that makes a
caller-less re-introduction go red.

## 3. Changes

1. **`scheduler.ts`: `applySkipped` removed.** Replaced by a note stating the constraint a reader will
   otherwise trip over: `TaskStatus` includes SKIPPED and `allDependenciesSatisfied` accepts it, but no
   DAG-plane caller produces it, and the flowchart plane's skip is a different union. The note says a skip rule
   may come back once a live caller exists.
2. **`scheduler.ts`: `_leaseDurationMs` dropped from `planRound`.** Signature is now
   `planRound(graph, statusOf, maxConcurrentTasks, leases?)`. `leases` stays optional, so the call sites that
   omit it are unchanged. The doc comment no longer has to explain a parameter that is not there.
3. **`supervisor.ts`: call site updated** to the 4-argument form. `LEASE_MS` is still live (lease duration on
   `leases.lease`, the `TASK_LEASED` payload's `expiresAt`, and the reconstructed `leasedAt` in
   `reconstructSupervisorState`) — only its use as a `planRound` argument is gone.
4. **`supervisor.ts`: stale comment fixed** — and it now discloses the residual instead of hiding it: the
   recovery loop is triggered by **orphaning**, not expiry, but the event it appends is still named
   `TASK_LEASE_EXPIRED`. The event type name is in `run/events.ts` (R3-4's file this round) and is persisted in
   every existing log, so renaming it is a schema change, not a comment fix. The comment states the mismatch.
5. **Tests:** dead argument dropped at all 9 call sites; the `applySkipped` assertion is replaced by two new
   pins (§4).

Behavior is unchanged: no production code path was altered, only a parameter that was never read and a comment.

## 4. New pins (both mutation-checked)

**`planRound takes no lease-duration parameter`** — asserts `planRound.length === 4` and then proves
positionally that the 4th argument is the registry (a lease in slot 4 excludes its task). Note the arity is 4,
not 3: TypeScript's optional `leases?` still emits a real parameter, so `Function.length` counts it. My first
draft asserted 3 and went red — the pin is calibrated against the runtime, not against the type signature.

**`the DAG plane declares no skip transition, because nothing produces one`** — three assertions: no scheduler
export matches `/skip/i` (catches a rename, not just the old name); no accepted `TaskOutcome` yields SKIPPED;
and the comment-stripped `supervisor.ts` source contains no `"SKIPPED"` literal, so wiring a skip into the
supervisor forces you to restore a declared transition rule in the same change.

Mutation check (11 cases, replicating each assertion's logic against mutated in-memory copies — R2-9's
technique; the real sources stay green on all of them):

| Mutation | Result |
|---|---|
| `applySkipped` re-added | RED |
| renamed skip helper `markSkipped` | RED |
| renamed skip helper `applySkip` | RED |
| dead lease-duration parameter re-added | RED |
| `leases` parameter removed entirely | RED |
| supervisor records `"SKIPPED"` (double quotes) | RED |
| supervisor records `'SKIPPED'` (single quotes) | RED |
| R2-9: `restore()` removed from supervisor | RED |
| R2-9: resume recovery loop removed | RED |
| R2-9: expiry sweep resurrected | RED |
| R2-9: `restore()` call left only in a comment | RED |

The last four matter for this slot specifically: I rewrote the comment block that sits directly above the
recovery loop R2-9's source pin matches, so I re-ran R2-9's own assertions against mutated copies to prove I
did not blind them. **`restore()` is untouched and still live on resume**, and the `expired()`/`isExpired()`
absence pin still bites.

## 5. Disclosed residuals (not fixed here)

- **`applyRetry` is a declared rule that production duplicates instead of calling** (finding (d)). It is *not*
  the same defect as `applySkipped`: the BLOCKED→READY transition genuinely happens in production, just written
  as a literal at `supervisor.ts` (post-recovery and post-REJECTED). So it is not phantom behavior — it is a
  divergence risk: editing `applyRetry` would not change what the supervisor does. Wiring it is behavior-neutral
  and both call sites are in files I own, but it is a refactor the brief did not ask for, so I disclosed rather
  than widened (the R2-9 precedent the brief told me to follow). Recommended as a one-line follow-up if any
  round wants it.
- **Two stale doc claims for R3-10** (`docs/**` is R3-10's ownership; I did not touch them).
  `docs/specs/m0-m2-architecture.md:169` says READY requires dependencies "COMPLETED or explicitly `SKIPPED`
  **by a declared transition rule**" — after this slot there is no such rule in the DAG plane (readiness still
  accepts a SKIPPED status; nothing produces one). The same line also says "**Lease expiry** converts a running
  task to `BLOCKED`", which R2-9 already made false — the conversion happens on resume recovery of an orphaned
  lease, with no wall-clock involved. The state diagram at `:159` shows a `-> SKIPPED` edge, same caveat.
- **`TASK_LEASE_EXPIRED` event name vs. its trigger** — disclosed in the supervisor comment (§3.4). A rename
  touches `run/events.ts`, `run/replay.ts`, and every persisted log; out of scope for a P3 comment slot.

## 6. Verification (this VM, Node v22.14.0)

- Owned tests, 3 consecutive runs: `test/unit/run/scheduler.test.ts` + `test/integration/m2/scheduler.test.ts`
  + `test/integration/m2/supervisor.test.ts` + `test/integration/m2/resume.test.ts` → **23/23 pass, 0 fail,
  0 skipped** each run. The unit file grew from 8 to 10 tests (one assertion removed, two pins added).
- Adjacent suites that could feel a scheduler or status change:
  `test/unit/domain/state.test.ts`, `test/unit/graph/*`, `test/unit/supervisor/*`, `test/integration/m2/*` →
  **106/106 pass**. `test/unit/routing/topology.test.ts` (imports the supervisor) green.
- Scoped `eslint` on all four owned files: clean.
- Whole-tree `tsc --noEmit`: **clean, 0 errors**, at the time of the final run.
- Shared-tree transients observed during the slot, attributed to files and left alone, all in peer slots'
  in-flight edits and all resolved by their owners before my final run: `test/unit/cluster/host.test.ts:158`
  (`'mail' does not exist on type 'never'`, R3-7) and `test/unit/run/event-row-fuzz.test.ts:536`
  (`'error' is of type 'unknown'`, R3-4) early on; later `src/privacy/deletion.ts:725,737` (missing
  `staleAggregate` on `InvocationRewrite`, the R3-3 × R3-2 boundary). None involved my files at any point.
- Not run: full `pnpm gate` (parent's job), bench (no perf claim in this slot).

## 7. Frozen contracts respected

R2-9's `restore()` liveness and `expired()`/`isExpired()` absence pins: green and re-mutation-checked.
No live R1/bandit/topology wiring, no Outcome-supported claim, ADR-006 untouched, no auto-promote, no
`package.json` or dependency edit, no unowned file edited, no commit.
