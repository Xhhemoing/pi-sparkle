[Model: claude-opus-5-fast]

# Loop 4 · Round 13 — R13-2 report

**Mandate:** two behavioural pins for the `taskCriteria` writer's least-exercised arms. Test-only, additive, no `src/**`, no writer edits.

**Verdict: both pins landed.** +2 tests (`criteria-gate.test.ts` 4→5, `resume.test.ts` 21→22). Whole-tree `tsc --noEmit` exit 0; scoped `eslint` exit 0; owned tests 3× green (27/27, zero skips). Four out-of-tree mutations recorded, each with the exact reds it produced; every mutation copy deleted.

Branch `agent/opt-continuous` throughout; no `git checkout`, no commit, no push.

## 1. Census (working tree, before writing)

Taken 2026-08-25 01:28–01:29 UTC at `dfb185b` (`chore(orchestrator): close Round 12 (10 ACCEPT) and open Round 13`).

Both paths the brief handed me exist:

- `test/integration/run/criteria-gate.test.ts` — 351 lines, 4 registered tests (R12-3's block + three loop-registered controls).
- `test/integration/m2.5/resume.test.ts` — 1425 lines, 21 registered tests.

Writer census (`src`, whole-tree grep for `taskCriteria|plannedTaskCriteria|advanceTaskCriteria|withRecordedCriteria`) — the three sources and the four write/restore seams read directly, matching the brief §3 exactly:

| Seam | `src/run/flowchart-run.ts` | Read at census |
|---|---|---|
| Source 1 — caller specs at start | `plannedTaskCriteria` :340, seeded :1310, written :1359 | yes |
| Source 2 — non-empty logged requests | `advanceTaskCriteria` :376, called from `persistCheckpoint` :817, written :831 | yes |
| Source 3 — the checkpoint on restore | resume :1485/:1558, pause+inject session :1686, unblock reopen :2117/:2180 | yes |
| Reader | `withRecordedCriteria` :541, sole call site :1509 | yes |

Validator: `validateTaskCriteria` (`src/run/replay.ts:449`) — absence valid and means unknown, present-but-empty array rejected, per-entry `acceptanceCriteria: []` **accepted**. Both pins depend on that asymmetry and it holds at HEAD.

Consumers of the two owned files: three prose references only (`option-a-preconditions.test.ts:617`, `episode-contract-boundary.test.ts:22`, and the new cross-reference I wrote myself). No test counts, imports, or asserts against either file. Nothing to update or prescribe.

Fixture reachability, checked before writing rather than after: R12-3's `childSpec` sets `acceptanceCriteria: []` and the run is BLOCKED, so its checkpoint carries `[{taskId: "tsk_migrate", acceptanceCriteria: []}]` — the caller's durable **known-none**, which is precisely the entry pin (a) needs. `pausedBeforeSecondChild` in `resume.test.ts` leaves a log with one non-empty `TASK_REQUEST` (`tsk_first` → `crit-integration`), which is precisely what pin (b) needs. Neither pin needed an `src` change; no stop-and-report.

## 2. Pin (a) — unblock carry-forward, in `criteria-gate.test.ts`

New test: *"unblocking the blocked run carries its known-none criteria record across the reopen and the resume"*.

Additive in the strict sense — R12-3's block test is byte-untouched. I re-drove its fixture in a new test rather than bolting assertions onto it, because the ownership row says additive and because an assertion pair wedged into a four-arm reachability test would make a failure ambiguous between the two mechanisms.

Three reads of the durable record, off disk through `CheckpointStore.read()` + `validateCheckpoint` rather than off the outcome object, so each one is the bytes a later command would restore from:

1. before the unblock — `[{ taskId: "tsk_migrate", acceptanceCriteria: [] }]`
2. after the unblock's reopen rewrite — deep-equal the same
3. after the resume's own checkpoint write — deep-equal the same

Whole-array `deepEqual` against one shared expected value, so the three failure modes the mandate named are separated by construction: **dropped** shows as `undefined`, **partially dropped** as a shorter array, **synthesized** as different content (any invented criterion, or the known-none silently rewritten as absence).

Why this fixture is the strongest one available, and why the pin matters beyond bookkeeping: a known-none entry is the one statement no downstream writer can rebuild. A logged `TASK_REQUEST` carrying no criteria is deliberately ignored by `advanceTaskCriteria`, so if the reopen drops this entry it is gone permanently — the field falls from known-none to unknown and no later resume can tell. Mutation 1 below confirms exactly that: with the reopen's carry removed, read (2) *and* read (3) are both `undefined`.

New imports: `CheckpointStore`, `validateCheckpoint`, `type TaskAcceptanceCriteria`, `type RunId`. All test-side; no `src` import was added inside the live closure, so `live-isolation.test.ts` is not implicated (its census walks `src`, and my diff has none).

## 3. Pin (b) — `advanceTaskCriteria`'s log-derived arm, in `resume.test.ts`

New test: *"a resume of a checkpoint written before the writer recovers the record from the log"*.

The arm's domain is a checkpoint that predates the writer, and the test reproduces that state rather than fabricating a run: take `pausedBeforeSecondChild` to its real pause (record present, both tasks), then `delete raw.flowchart["taskCriteria"]` and write the checkpoint back. The result is schema-valid — absence is how "unknown" is spelled — and the test asserts that immediately (`storedTaskCriteria` → `undefined`) through the production validator, so a hand-edit that reached a state the schema forbids would fail there rather than silently later.

The resume then holds a run id and a log and nothing else. What it recovers can only be log-derived:

- dispatch: `{ tsk_first: ["crit-integration"], tsk_second: [] }` — the legacy cost is made visible, not papered over. `tsk_second` really is re-dispatched with nothing, because by then the run genuinely had no record of it.
- final record: `{ tsk_first: ["crit-integration"] }` — the merge arm recovered the one task the log can prove, and `tsk_second`, whose only request is the empty one this resume just logged, stays **absent**.

So the single test carries both halves of the semantics the brief asked to document: legacy recovery restores what the log can prove, and declines to launder the rest. No writer was invented and `src/run/flowchart-run.ts` is diff-empty in my change.

## 4. Mutation evidence (out of tree, `/tmp/r13t2/repo`, deleted)

Full tree copied to `/tmp` with `node_modules` symlinked; baseline 27/27 green there before any mutation; the copy `rm -rf`'d at 01:31 UTC and verified gone. The working tree's `src` was never modified.

| # | Mutation to `src/run/flowchart-run.ts` | Reds in the two owned files | Reading |
|---|---|---|---|
| 1 | Reopen drops the record (`...(taskCriteria !== undefined ? { taskCriteria } : {})` removed from `unblockLockedFlowchartRun`'s payload) | **2** — new pin (a) + R12-1's pre-existing source pin (`the flowchart checkpoint, its validator, its writer and both restorers carry the run contract`) | pin (a) bites, and the second red is the source pin it was written to succeed |
| 2 | Resume drops the restored record from its loop context (`...(taskCriteria !== undefined ? { taskCriteria } : {})` removed from the resume ctx) | **1** — new pin (a) only, failing at read (3), `criteria-gate.test.ts:388` | **the new guarantee.** R12-1's source pin still matches (`const taskCriteria = checkpoint.flowchart.taskCriteria;` is untouched) and R12-1's resume test survives, because its own resume re-logs non-empty requests the merge recovers. Only a known-none record exposes this |
| 3 | `advanceTaskCriteria` never merges logged requests (loop body replaced with `void requests;`) | **1** — new pin (b) only | exactly the §6.3 gap, closed: nothing else in either file notices the arm disappearing |
| 4 | Empty logged requests no longer ignored (`request.acceptanceCriteria.length === 0` guard removed) | **2** — new pin (b) + R12-1's `a resume re-dispatches recorded criteria and leaves an unrecorded node unknown` | pin (b) is a second, independent witness for the ignore rule, on the legacy-recovery path R12-1's test cannot reach |

Mutations 2 and 3 each red exactly one test, and in both cases it is the new one — which is the claim the mandate makes: these two arms had no behavioural discriminator before this slot.

Not mutation-proved, disclosed rather than glossed: "the reopen re-synthesizes instead of carrying". Building a synthesizing writer would mean editing the writer's shape, and for this fixture the only plausible synthesis source (the definition's node ids with empty lists) produces the *same* value, so it would be a worthless discriminator. The whole-array `deepEqual` covers synthesis structurally — any content other than the caller's own entry reds — and that is the honest extent of the claim.

## 5. Verification

- Whole-tree `pnpm exec tsc --noEmit` — exit 0 (01:32:02 UTC, after both edits and with the siblings' in-flight `src` present).
- Scoped `pnpm exec eslint test/integration/run/criteria-gate.test.ts test/integration/m2.5/resume.test.ts` — exit 0.
- Owned tests 3× (01:31:50 → 01:31:56 UTC), both files in one process each run: **27 tests / 27 pass / 0 fail / 0 skipped**, all three runs identical. No new skip introduced — the `PI_SMOKE` gate is in neither file.
- Test-registration delta, static: `criteria-gate.test.ts` 4→5, `resume.test.ts` 21→22. **+2** for the parent's gate accounting (expect 1949 total if the other slots' deltas hold).
- No full `pnpm gate` run (parent's job). No crash-probe run — my diff touches no persist path and no probe case.
- No scratch files at report time: `git status` shows my two owned test files modified and this report added, nothing else. `/tmp/r13t2` deleted.

## 6. Shared-tree transients

Three siblings were writing the tree during my runs; none produced a transient in my two files, but the timestamps are recorded so a later reader can attribute anything that does appear:

| File | mtime at my 3× run (UTC) | Owner |
|---|---|---|
| `src/run/replay.ts` | 01:29:24 | R13-1 (comment-only) |
| `src/tracking/prescore.ts` | 01:29:29 | R13-1 (comment-only) |
| `test/integration/cli/blocked-next.test.ts` | 01:30:51 | R13-3 |
| `src/cli/main.ts` | 01:31:49 | R13-3 |

One cross-slot note worth the parent's eye, no action from me: `resume.test.ts`'s existing source pin asserts `/never \*synthesized\*/` against `src/run/replay.ts` prose (line 412 pre-diff). R13-1 owns that file comment-only and the brief tells it to keep that sentence; it was still matching at 01:31:56.

## 7. Freeze check

Nothing in §3 or the ownership row's frozen list was touched. Specifically: `src/**` diff-empty from me; the writer's three sources, the empty-logged-request rule and the substitutions-only reader are asserted **as shipped**, never changed; no `continuation.taskCriteria` was introduced or read; no `ctx.childByTaskId` substitution empty is written anywhere in my fixtures; `unblock-flow.test.ts`, `replay.test.ts`, `flowchart-run.ts` and `docs/**` untouched; `RUN_UNBLOCKED`'s payload is used with its existing two-key no-retry shape and no new key; no new `RunStatus`; no live R1; ADR-006 untouched; `package.json`/`pnpm-lock.yaml` diff-empty.

## 8. Residuals

1. **Pin (a) measures the known-none entry only.** That is the strongest shape this fixture offers and the one whose loss is irreversible, but a BLOCKED run whose record carries a *non-empty* entry across the reopen is still unmeasured. Low value — mutation 1 shows the carry is a single conditional spread with no per-entry logic, so a content-sensitive drop is not a reachable bug shape — and I judged manufacturing a second BLOCKED fixture for it to be the busywork the brief warns against. Recorded, not smuggled.
2. **Pin (b) exercises the arm through the resume restore only.** `advanceTaskCriteria` also runs on `persistCheckpoint` calls reached from the pause and inject side commands; those paths seed `ctx.taskCriteria` from the same checkpoint, so the arm's behaviour is identical, but it is inference from shared code rather than measurement.
3. **`--discard-executed`** remains structurally unavailable for this block class (R12-3's recorded consequence), so the reopen's other authorization shape carries no `taskCriteria` measurement. Unchanged by this slot; noting it so the seam's coverage map stays honest.
