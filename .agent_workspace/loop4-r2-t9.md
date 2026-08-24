[Model: claude-opus-5-thinking-high-fast]

# Loop 4 · Round 2 · R2-9 — Scheduler lease dead code

Slot: R2-9 (P3, honesty/dead code). Branch `agent/opt-continuous`, **not committed** (per instruction).
Owned files touched, and only these: `src/run/scheduler.ts`, `test/unit/run/scheduler.test.ts`.

## 1. Correction to the brief's evidence (read this first)

ROUND1-BRIEF §4 R2-9 and `loop4-r1-fable.md:53` both say **`LeaseRegistry.expired()` *and* `.restore()`** have no
production callers. That is half right. `restore()` **has a live production caller**:

```205:217:src/run/supervisor.ts
  // Rebuild leases for RUNNING tasks. Resume treats them as orphaned — there
  // is no live worker — so runSupervisorRounds recovers them immediately.
  const leases = new LeaseRegistry(nowMs);
  for (const [taskId, lease] of Array.from(leaseEnds)) {
    if (statuses.get(taskId) === "RUNNING") {
      leases.restore({ ... });
```

`reconstructSupervisorState` is reached from `resumeRun` (`supervisor.ts:649`), which is the live `pi-sparkle resume`
path, and its output feeds `runSupervisorRounds` (`supervisor.ts:700`). Deleting `restore()` would have broken resume.
So I removed only what is genuinely dead and pinned `restore()`'s caller instead of trusting the brief.

Full caller census (`rg` over the whole tree, all file types):

| Symbol | Production callers | Test callers | Verdict |
|---|---|---|---|
| `expired()` | **none** | `test/unit/run/scheduler.test.ts` only | removed |
| `isExpired()` | **none** (only `expired()` itself) | same file only | removed |
| `restore()` | `src/run/supervisor.ts:210` (resume) | — | **kept + pinned** |
| `lease` / `release` / `active` / `list` | `supervisor.ts` 207–380 | unit + `test/integration/m2/scheduler.test.ts` | kept |

`src/run/scheduler.ts` has exactly one production importer (`src/run/supervisor.ts`); there is no public barrel
(`src/` has only `toolchain.ts` at top level, `bin` is `dist/cli/main.js`), so removal has no external surface.

## 2. The actual dishonesty, and what it cost

The old class contract read: *"Exactly one active lease per task; expiry never silently duplicates work."* The second
clause implied an enforcement that does not exist anywhere:

- nothing on the live path calls `expired()` or `isExpired()`;
- `planRound` excludes a task while `leases.active(id) !== undefined` — **no expiry check** (`scheduler.ts:102`), so a
  lease past its `expiresAt` keeps its task unschedulable *forever* within a process, the opposite of "expiry";
- resume does not use expiry either: `runSupervisorRounds` iterates `leases.list()` and recovers **every** restored
  lease unconditionally (`supervisor.ts:253-266`), precisely because a reconstructed RUNNING lease has no live worker;
- real bounding of the work lives in the child coordinator (`timeoutMs` per attempt, and `maxWallTimeMs` since T6).

So the honest statement is: the registry is single-process mutual exclusion with descriptive timestamps, and expiry is
not a mechanism the system has. I took the preferred option — **remove** — because no justified live caller exists.
I did not wire flowchart teardown: `src/run/flowchart-run.ts` is R2-1's file and is not mine to touch, and its
supervisor (`supervisor/flowchart-supervisor.ts`) uses `NodeLease`, a different type that never touches `LeaseRegistry`.

## 3. Change

`src/run/scheduler.ts`:

1. **Deleted** `expired(): TaskLease[]` and `isExpired(lease): boolean`. Nothing else in the class changes; `nowMs` is
   still needed by `lease()` to stamp `leasedAt`/`expiresAt`.
2. Replaced the class doc with one that states the real contract: at most one active lease per task, cleared only by
   `release()`; leases do **not** expire; `leasedAt`/`expiresAt` are descriptive metadata recorded on `TASK_LEASED` and
   rebuilt by `reconstructSupervisorState`; `planRound` ignores `expiresAt`; bounding belongs to the child coordinator;
   resume recovers restored leases unconditionally.
3. Marked `TaskLease.expiresAt` as descriptive at the field.
4. `restore()`'s doc now names its live caller and why no expiry check is involved (so the next reader auditing for dead
   code does not repeat the brief's mistake).
5. `planRound`'s doc now says `_leaseDurationMs` is unread and that planning never consults expiry. **Signature
   unchanged** — dropping the positional parameter would have forced edits in `supervisor.ts:275` and
   `test/integration/m2/scheduler.test.ts`, neither of which I own.

No behavior change on any live path: the two removed methods had zero production callers, so no execution path differs.
`planRound` / `applyTaskOutcome` / `applyRetry` / `applySkipped` bodies are untouched.

## 4. Tests (`test/unit/run/scheduler.test.ts`, 8 tests, all pass)

The old test `LeaseRegistry enforces one lease per task and expiry` asserted the dead API and was the *only* thing
keeping it alive. Rewritten into three:

1. `LeaseRegistry enforces exactly one active lease per task` — lease/duplicate-reject/release/double-release-reject,
   plus the timestamps derived from the injected clock (they are what the `TASK_LEASED` payload carries).
2. `leases do not expire: no sweep API, and planRound still skips a lease past expiresAt` — the honesty pin. Asserts
   `expired`/`isExpired` are absent from `LeaseRegistry.prototype`, then advances the injected clock to
   `expiresAt + 60 s` and asserts the lease is *still* active and `planRound` *still* excludes the task, and that only
   `release()` frees it. The behavior everyone assumed was expiry is now written down as an assertion.
3. `restore rebuilds a resume lease and keeps mutual exclusion` — restore keeps persisted timestamps, rejects a
   duplicate, blocks a fresh `lease()`; plus a **source pin** (repo idiom, cf. `test/unit/telemetry/invocation-log.test.ts:386`)
   on comment-stripped `src/run/supervisor.ts` requiring `leases.restore(` and the `for (const lease of leases.list())`
   recovery loop to still exist, and forbidding `.expired(` / `.isExpired(` from reappearing there.

Both pins were mutation-checked, not just observed green:

| Mutation | Result |
|---|---|
| re-add `isExpired()` to the class (real edit, reverted) | `not ok 4 … LeaseRegistry.isExpired() is dead code` |
| `leases.restore({` deleted from supervisor | pin fails |
| `leases.restore({` commented out | pin fails (comment stripping works) |
| resume recovery loop removed | pin fails |
| recovery loop switched to `leases.expired()` | pin fails |

Supervisor mutations were evaluated against mutated in-memory copies of the source via a scratch script rather than by
editing `src/run/supervisor.ts`, because this worktree is shared with the other Round 2 slots and I did not want a
transiently broken non-owned file to poison a parallel agent's typecheck.

## 5. Verification (this VM, Node v22.14.0, pnpm 10.17.1)

| Check | Command | Result |
|---|---|---|
| Owned tests | `npx tsx --test test/unit/run/scheduler.test.ts` | 8 tests / 8 pass / 0 fail |
| Consumers (not owned, must not break) | `npx tsx --test test/integration/m2/scheduler.test.ts` | 3/3 pass |
| Consumers | `npx tsx --test test/integration/m2/resume.test.ts test/integration/m2/supervisor.test.ts` | 10/10 pass |
| Lint (owned) | `npx eslint src/run/scheduler.ts test/unit/run/scheduler.test.ts` | clean, 0 findings |
| Whole-tree types | `npx tsc --noEmit -p tsconfig.json` | exit 0, 0 diagnostic lines |

Full gate not run (per instruction). Note for the parent: an earlier typecheck of mine caught three transient
`src/learning/auto-loop.ts` errors from R2-4 mid-edit in this shared worktree; they were gone on re-run and were never
mine. The final whole-tree `tsc` above is clean across everything currently in the tree.

## 6. Handoffs / residuals (not mine to fix)

- `docs/specs/m0-m2-architecture.md:331` claims the checkpoint contains "active leases". It does not — `rg -i lease src/persist/**` returns
  nothing, and leases are rebuilt purely from `TASK_LEASED` events. That is a stale line for **R2-10**'s docs pass.
- `applySkipped` (`scheduler.ts:151`) has no production caller either, only the unit test. Same dead-code class, but it
  is a declared state-machine transition rather than a lease concern, so it is outside R2-9's stated scope; I left it
  and disclose it rather than silently widening the slot.
- `planRound`'s `_leaseDurationMs` stays in the signature (documented as unread). Removing it is a cross-file change
  touching `supervisor.ts` and an integration test — worth a future slot that owns those files.

## 7. Constraint compliance

No live R1/bandit/topology; no Outcome-supported claim; ADR-006 untouched (stays Proposed); no auto-promote; no
`package.json`/dependency edit; no git commit; no file outside the two owned paths modified. Not cosmetic: a public
method pair with no callers is deleted, the contract statement is corrected to match behavior, and the previously
implicit no-expiry behavior is now pinned by mutation-verified tests.
