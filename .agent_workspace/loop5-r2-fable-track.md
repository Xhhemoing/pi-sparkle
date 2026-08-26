# Loop 5 · Round 2 — Fable-track: same-run continuation design for track clarification

MODEL_SLUG: claude-fable-5-thinking (cloud)

Scope: design only, per assignment. No `src/` edits, no commit. Inputs: `src/track/loop.ts`, `src/run/inspection.ts`, `src/cli/main.ts` (`answerCommand`, `resumeCommand`, `runCommand --track`), `src/run/replay.ts` (`RUN_WAITING_FOR_USER` / `USER_ANSWER` handling), `src/run/coordinator.ts` (`withRunLifecycleLock`), `src/run/flowchart-run.ts`, `src/run/episode-bind.ts`, `src/episode/manager.ts`, `src/privacy/{deletion,record-classes}.ts`, review §5.1 (`loop5-r1-review.md`), gpt-close §2 (`loop5-r1-gpt-close.md`), runtime F4 (`loop5-r1-fable-runtime.md`), and the freeze tests named in §5 below.

Coordination context: **Opus-track is concurrently implementing the cheap half** — inspect renders the clarification questions + continuation guidance, and `answer` refuses on the clarification plane instead of appending a consumer-less `USER_ANSWER`. This document designs the **complete continuation** that would sit behind that refusal in a later round, and answers the assigned question: is a true same-run continuation worth it versus refuse + new run?

---

## 0. Verdict up front

**A literal same-run-id continuation (the flowchart phase appended into the clarification run's own log) is NOT worth building.** It requires an "embedded start" mode and a checkpoint-first ordering change in `src/run/flowchart-run.ts` — the most pinned, most contended file in the tree — plus a lock-reentrancy seam in the one lock discipline Loop 4 spent five rounds getting right, and the only thing it buys over the alternative is that the operator types one run id instead of following one episode link.

**Refuse + new run (the Opus-track baseline) is also not complete.** It closes the operator trap but leaves four honesty gaps (§2.3): a permanently stranded WAITING run and WAITING episode per clarification, no durable link between the question run and the answer run, no correlation check between the answers file and the questions actually asked (typo'd ids default silently), and a question set that can drift between the two clarify passes without detection.

**The design this report recommends as "the complete continuation" is the middle form (§3): consume the answers on the clarification run itself (`USER_ANSWER` correlated to the persisted `messageId`), settle that run `COMPLETED`, and start the execution run attached to the same episode instead of a fresh one.** Zero new event types, zero new files, zero changes to `replay.ts` / `flowchart-run.ts` core semantics beyond one small additive input (`existingEpisodeId`), and it closes all four gaps. The literal same-run-id variant is fully specified in §4 so the rejection is grounded, not asserted.

---

## 1. Ground truth (verified at HEAD, worktree of `cursor/pi-sparkle-sota-opt-0da8`)

The dead end, mechanically:

1. `startTrackedRun` → `waitForClarification` mints a run under `withRunLifecycleLock`, appends `PROJECT_DISCOVERED`, `RUN_CREATED`, binds a fresh episode, appends `RUN_STARTED`, then `RUN_WAITING_FOR_USER { messageId }` (`src/track/loop.ts:284–313`). The question texts are **not** in the payload — only in `runtime/runs/<runId>/track-questions.json` `{questions, objective, contract}` (`:320–323`, written crash-atomically). The episode is settled `WAITING_FOR_USER` and a checkpoint is written (`:324–334`).
2. `inspectRun` builds `pendingQuestions` only from child `QUESTION` messages (`src/run/inspection.ts:136–139`), so the clarification question is invisible to inspect. (Opus-track is fixing the prose surface now.)
3. `answerCommand`'s non-flowchart tail appends a bare `USER_ANSWER` with no plane check (`src/cli/main.ts:1707–1730`). `replayRun` clears `sawWaiting` on any `USER_ANSWER` (`src/run/replay.ts:311–314`), and because the clarification log already carries `RUN_STARTED`, the run then replays **RUNNING** (`:350–355`) — a phantom that `doctor`'s PLANNING/RUNNING crash inventory will now name as an interrupted run. This `USER_ANSWER → RUNNING` flow is **pinned** by `test/unit/run/m1-replay.test.ts:60–76`; a design must work with it, not against it. (Opus-track's refusal closes the faucet; logs already poisoned this way remain, see §3.6.)
4. The only continuation is a fresh `run --track --answers <file>` (printed once at settle, `main.ts:844`). It re-clarifies from scratch: `answers !== undefined` forces `assumeDefaults` (`track/loop.ts:100`), `applyAnswers` silently ignores unknown ids and silently defaults unanswered ones (`src/track/clarify.ts:56–64`), and the new run binds a **new episode**, so the old run and old episode are stranded `WAITING_FOR_USER` forever, with no pointer in either direction.
5. `resume --run <clarificationRun>` is a success-looking no-op: the log fails `eventsLookLikeFlowchartRun`, no flowchart flags are set, so it rebuilds the checkpoint and prints `checkpoint rebuilt (WAITING_FOR_USER, …)`, exit 0 (`main.ts:1389–1397`). Runtime F11, confirmed unchanged.
6. `pause --run` on a clarification run fails with the invented-state refusal (runtime F8, unchanged); `delete --run` is currently the only exit for the stranded run.

Domain facts the design leans on, verified:

- `attachRun` refuses only duplicate run ids and cross-project attachment — attaching a second run to a `WAITING_FOR_USER` episode is legal (`src/episode/manager.ts:50–72`), and `settleBoundEpisode` can close an episode from `WAITING_FOR_USER` (`src/run/episode-bind.ts:174–176` only refuses already-terminal snapshots).
- `RUN_COMPLETED` has a frozen **empty** payload (`src/run/events.ts:625–628`) — a terminal cannot carry a continuation pointer.
- `withRunLifecycleLock` is keyed per run id and is not reentrant (`src/run/coordinator.ts:107–114`; the self-deadlock note at `track/loop.ts:316–319` is the standing warning).
- `UserAnswerPayload.answer` is any non-empty string (`events.ts:708–711`) — a canonical JSON object is a legal answer body.
- `track-questions.json` is a registered record class with run-scoped deletion, propagated from run-events (`src/privacy/record-classes.ts:60, 214–225`), and is scanned by the episode-delete residual pass (`src/privacy/deletion.ts:549–554`). It has **no `schemaVersion` field** today and no reader until Opus-track's inspect lands.

---

## 2. The design space

### 2.1 Baseline: refuse + new run (Opus-track, in flight)

`inspect` shows the questions and the `run --track --answers` guidance; `answer` refuses on this plane. This closes the two acute traps (invisible question; state-corrupting answer). Keep it — everything below layers on top of its plane-detection.

### 2.2 What "continuation" must mean, regardless of variant

Any complete continuation has five obligations:

1. **Correlation** — the answers consumed must be checked against the persisted question set of *this* run (the authoritative `track-questions.json` + the `RUN_WAITING_FOR_USER` `messageId`), failing closed on unknown ids and on unanswered questions unless `--assume-defaults` is explicit. This is the check the fresh-run path structurally cannot do (it re-derives questions that may no longer match).
2. **Consumption record** — the answers must land on the clarification run's own log as a `USER_ANSWER` correlated to the recorded `messageId`, so the wait is closed by the event that answers it, exactly as the flowchart plane does (`main.ts:1669–1676` enforces the same id match there).
3. **No stranded state** — after continuation, nothing replays `WAITING_FOR_USER` forever: the clarification run reaches a real terminal, and the episode either continues into the execution run or is closed by it.
4. **Durable linkage** — an auditor holding either run id can reach the other.
5. **Crash re-entry** — every crash window leaves a state the same command can recognize and finish from, because the resolved answers are durable before anything irreversible happens.

### 2.3 What refuse + new run permanently lacks

Measured against §2.2: it satisfies none of 1–4 (silent-default answers file; no `USER_ANSWER` ever consumed; run + episode stranded WAITING; zero linkage) and trivially satisfies 5 (nothing to re-enter). It is a guardrail, not a continuation.

---

## 3. Recommended design — same-episode continuation ("Variant B")

One sentence: `answer --run <clarifyRunId> --answers-file <file.json>` consumes the answers on the clarification run, settles it `COMPLETED`, and starts the execution run **attached to the clarification run's episode**, so the episode — the domain object that already means "one user intent, possibly several runs" — is the thread of identity.

### 3.1 CLI surface

Extend `answerCommand`'s clarification-plane branch (the branch Opus-track is adding as a refusal):

```
pi-sparkle answer --run <runId> --answers-file <file.json>
  [--assume-defaults] [--executor fake|pi] [--primary-model <id>] [--fast-model <id>] [--thinking <level>] [--state-root <dir>]
```

- `answer` rather than `resume`, because the flowchart plane already gives `answer` exactly this shape: correlate a reply to the pending question **and drive the run onward** in the same invocation (`main.ts:1684–1705`). `resume` on this plane gains a one-line retarget: "this run waits on clarification answers; use `answer --run … --answers-file …`" (also killing the F11 no-op).
- Executor/model/thinking flags are taken **again** and disclosed, reusing the R4-6 posture verbatim (`describeResumeExecutorConfig`, `main.ts:1188–1222`): nothing durable records what the run started with, and the continuation must not silently invent a configuration. `--answers-file` (not the existing `--text`) keeps the flowchart `answer` contract untouched.
- Legacy `--message`: accepted, must equal the recorded `messageId` (same rule as the flowchart branch); omitted, derived from the log.

### 3.2 Plane detection

The clarification plane is: event log non-empty, `eventsLookLikeFlowchartRun` false, no flowchart checkpoint, log carries a coordinator-actor `RUN_WAITING_FOR_USER`, and `runtime/runs/<id>/track-questions.json` exists and parses. This is the same predicate Opus-track needs for the refusal — it must be **one shared function** (suggest `src/track/continuation.ts` exporting `detectClarificationPlane(stateRoot, runId, events)`), or round 3 inherits two drifting plane tests.

### 3.3 Algorithm

Phase 1 — consume, under `withRunLifecycleLock(stateRoot, clarifyRunId, …)`:

1. Re-read the log under the lock. Refuse unless replay status is exactly `WAITING_FOR_USER` (see §3.6 for the phantom-RUNNING and re-entry cases).
2. Load `track-questions.json`; run `applyAnswers(persisted.questions, answersFile)`. Refuse on any answer key not in the question set (a **stricter** check than `applyAnswers`, which ignores unknowns — the continuation adds the unknown-key scan). Refuse on `unanswered.length > 0` without `--assume-defaults`.
3. Append one `USER_ANSWER`:
   - `messageId`: the recorded one from `RUN_WAITING_FOR_USER`;
   - `answer`: canonical JSON, sorted keys: `{"kind":"track-clarification","resolved":{…},"assumedDefaults":["q-…"]}`. One event, not one per question: the payload is the atomic durable record the crash re-entry (§3.6) reads back, and `messageId` names one message. Legal today (`answer` is any non-empty string); no schema change.
4. Append `RUN_COMPLETED {}`. This is the honest terminal: the clarification run's whole deliverable was a decided contract, and it is now delivered. Replay: `USER_ANSWER` clears the wait, `RUN_COMPLETED` is the first terminal — no anomalies, status `COMPLETED`. `list` stops parading the run; doctor never sees it (COMPLETED is outside the PLANNING/RUNNING inventory); delete/pause behave normally.
5. Do **not** call `settleBoundEpisode` here — deliberately. The episode is not done; the execution run inherits it. (Even if called, the `EPISODE_WAITING` dedupe at `episode-bind.ts:181` makes it a no-op on this log; skipping is the honest spelling.)
6. Rebuild and write the checkpoint (replay → `materializeCheckpoint` → write), as `recordClarificationRun` does.
7. Release the lock. (Not held across phase 2: holding it would block `delete`/`pause` on the old run for the whole execution run, and two lifecycle locks held nested — old then new — is a discipline this tree has avoided everywhere.)

Phase 2 — execute, as a new run:

8. Recompute the plan exactly as `startTrackedRun` does post-clarification (`track/loop.ts:108–178`): `applyPrecedence(persisted.contract, "user-first")` (the file stores the pre-precedence candidate — same input the start path uses), calibrated catalog, learned routing, `splitAndAssignForPrimary` with `answers: resolved`, profile registry, `compileChildrenToFlowchart`. Refactor `startTrackedRun` so this half is one shared `executeTrackedPlan(…)` — the continuation must not be a second copy of the pipeline.
9. Call `startFlowchartRun` with **one additive input**: `existingEpisode?: { id: EpisodeId }`. When present, `startLockedFlowchartRun` replaces its `bindEpisodeToRun` call with attach-to-existing: read latest episode snapshot, `attachRun` (legal on WAITING, §1), append the snapshot + episode event to the episode stores, append `RUN_ATTACHED` to the **new** run's log, and skip `EPISODE_OPENED`. Everything downstream already works: `episodeIdFromEvents` on the new log finds the `RUN_ATTACHED`; the tail `settleBoundEpisode` closes or re-waits the shared episode (closure from WAITING is legal, and the new log has no `EPISODE_WAITING` so the dedupe cannot mis-fire); `decideClosure` still judges against the acceptance criteria the clarify contract opened the episode with. This is the **only** `flowchart-run.ts` edit in the whole design: one optional input, one ~15-line branch beside `bindEpisodeToRun`, no ordering, locking, or recorder changes. A small helper `attachRunToExistingEpisode` belongs in `episode-bind.ts` next to `bindEpisodeToRun`.
10. Run `runAutoAdaptLoop` on the new run's outcome exactly as `startTrackedRun`'s tail does, and print the same outcome block (`Run <newId>: …`, routing table, questions empty, learn line). Print one linkage line on the old-run side: `continued as <newRunId> (episode <epId>)`.

### 3.4 Linkage, without a new event or file

Both runs attach to one episode. From the old run: log → `RUN_ATTACHED.episodeId` → episode snapshot → `runIds` — the successor is every id after this one. From the new run: same episode, predecessors are the ids before it. `inspect` prose on the clarification run renders "continued by <id>" from that read (an additive prose line; `INSPECT_SUMMARY` untouched). No `RUN_CONTINUED` event (would cost the full new-event checklist, §5.3), no `track-continuation.json` (would cost a record-class row and a deletion-propagation edit for a pointer the episode already holds). Cost accepted and disclosed: if the **episode** is deleted, the link is gone — the residual scan already treats `track-questions.json` as episode-text-bearing (`deletion.ts:549–554`), so episode deletion already reaches into this run's directory; a severed link after an explicit privacy delete is correct behavior, not a leak.

### 3.5 What the continuation refuses (fail-closed table)

| Log state at `answer --answers-file` | Behavior |
|---|---|
| Replays `WAITING_FOR_USER`, questions file parses | Continue (§3.3) |
| Questions file missing/unparseable | Refuse: "clarification record missing; re-run `run --track` fresh" — never fabricate questions (matches the record-class recovery note) |
| Replays RUNNING with a legacy bare `USER_ANSWER` (pre-refusal poisoning) | Refuse, name the stray event id, remediation: fresh `run --track --answers`. Never treat an uncorrelated free-text answer as a resolved map |
| Replays COMPLETED with a `kind:"track-clarification"` `USER_ANSWER` and episode has a successor run | Report already-continued + successor id, exit 0 (idempotent) |
| Replays COMPLETED with the consumed answer but **no** successor on the episode | Crash re-entry: skip phase 1, re-run phase 2 from the durable `USER_ANSWER.resolved` (§3.6) |
| Any other terminal / PAUSED / unknown-key or unanswered questions | Refuse with the specific reason |

### 3.6 Crash windows and re-entry

- **Between `USER_ANSWER` and `RUN_COMPLETED`** (two appends): log replays RUNNING — the pinned semantics, and now *true* in spirit (a continuation was in flight). Re-entry detects the canonical `kind:"track-clarification"` answer, appends the missing terminal, proceeds. Doctor listing it as a crash candidate in the interim is correct, not a bug.
- **Between phase 1 and phase 2**: old run COMPLETED, answers durable in the event payload, episode has no successor. Re-entry runs phase 2 only, reading `resolved` from the log, not from the file (the file may have changed; the log is what was consumed).
- **Mid phase 2**: an ordinary flowchart run crash — the standard checkpoint/`childTasksFromLog` resume story applies unmodified, which is precisely what Variant A cannot say (§4).
- **Double-continuation race** (crash after the new run's `RUN_ATTACHED` landed but before the operator saw it; re-entry starts a second): prevented by the §3.5 successor check running under the *episode's* read — cheap, and the residual worst case (two successors on one episode after a torn crash plus an immediate concurrent re-entry) is visible in the episode's `runIds` rather than silent.

### 3.7 `track-questions.json` riders (additive, coordinate with Opus-track)

The file is about to gain its first reader. Two additive keys should ride the next writer touch: `schemaVersion: 1` (it has none) and `habits` (the `HeuristicHabits` consumed at clarify time — `splitAndAssignForPrimary` takes habits, and re-deriving them at continuation time from live preferences can produce a split the recorded questions never implied). Absence stays valid forever: a continuation of an old-format file re-derives habits and discloses the drift on stderr. **Opus-track's reader must tolerate unknown keys from day one** — that is the one hard coordination requirement this round.

---

## 4. The literal same-run-id continuation ("Variant A") — specified, then rejected

For completeness, the design the assignment names: the flowchart phase appended into the clarification run's own log, one run id end to end.

Mechanics: phase 1 as §3.3 but **without** the terminal; then an *embedded* flowchart phase against the same log. Requires, beyond everything in §3:

1. **An embedded-start mode in `flowchart-run.ts`**: skip minting the run id; skip `PROJECT_DISCOVERED` / `RUN_CREATED` / `bindEpisodeToRun` / `RUN_STARTED` appends (all already on the log — a second `RUN_CREATED` is a replay anomaly); accept the caller's `rootTaskId`/project; run supervisor rounds and recorders against the prefixed log.
2. **A lock-held mode**: the continuation already holds the run's lifecycle lock, `withRunLifecycleLock` is not reentrant, and `startFlowchartRun` unconditionally acquires it — the exact self-deadlock the comment at `track/loop.ts:316–319` documents. Either the embedded mode takes a `lockAlreadyHeld` flag (a footgun exported forever) or the continuation passes its whole body as the locked closure into a restructured start (invasive).
3. **Checkpoint-first ordering**: the moment the first `MODEL_ROUTED` lands, `eventsLookLikeFlowchartRun` flips true for this log **retroactively and permanently** (`replay.ts:416–418`), and a crash before the first flowchart checkpoint write leaves a log that `requireDurableFlowchartCheckpoint` (`main.ts:575–579`) refuses on every subsequent `inspect`/`resume`/`answer` — "refusing to invent state", forever, with delete as the only exit. Fixing that means writing a flowchart checkpoint *before* the first routed event or widening the refusal — both are semantics changes to the R4-4/R9-8 crash-resume machinery that currently holds an 11-case SIGKILL probe green.
4. **Episode wrinkle**: the log's `EPISODE_WAITING` from the clarification settle permanently disarms the settle dedupe for this run, so a later mid-flowchart wait (approval) records no second `EPISODE_WAITING` on the run log; episode-store status stays right, the run-log narration goes stale.

What A buys over B: `inspect --run <one id>` tells the whole story without one episode hop, and `list` shows one row instead of two. That is the entire delta — statuses, linkage, correlation, crash re-entry, adapt-loop, privacy surfaces come out identical.

What A costs over B: items 1–3 land in `flowchart-run.ts` (three recorders, resume reconstruction, crash-flush, the taskCriteria/taskCostCeilings machinery — the file every Loop 4 round fought over), touch the lifecycle-lock discipline (R5-1) and the invented-state refusal (a frozen operator guarantee), and every crash-window test in the resume suite gains a "log with a non-flowchart prefix" dimension. **Rejected.** If a future round wants single-id UX, B is a strict prerequisite anyway (all of §3's correlation/consumption machinery is shared), so nothing is foreclosed by shipping B first.

---

## 5. Freeze hazards (both variants, checked against the actual pins)

| Frozen surface | Pin | B (recommended) | A (rejected) |
|---|---|---|---|
| `USER_ANSWER` clears the wait → RUNNING | `test/unit/run/m1-replay.test.ts:60–76` | Conforms — the RUNNING window is real and bounded by the adjacent terminal; no replay edit | Conforms, same |
| `RunStatus` exactly eight; terminals exactly COMPLETED/FAILED/BLOCKED | `terminal-replay-statuses-freeze.test.ts` | No new status, no terminal change | Same |
| Event union: `EVENT_SEEDS` keys must equal `EVENT_TYPES` | `event-row-fuzz.test.ts:984` | **Zero new event types** — the reason `USER_ANSWER` carries the canonical map and linkage rides the episode | Same (A also needs no new event) |
| `INSPECT_SUMMARY` frozen-additive (type/runId/status/requiredEvidence) | `inspection.test.ts` pins | Untouched; continuation facts are prose lines only | Untouched |
| Invented-state refusal (`requireDurableFlowchartCheckpoint`) | operator guarantee + resume tests | Untouched — the new run is a normal flowchart run | **Must be weakened or ordering changed** — the sharpest hazard (§4.3) |
| Lifecycle-lock discipline (R5-1: CLI-reachable lifecycles hold `runLockPath`; not reentrant) | lock tests + coordinator docstring | Two sequential acquisitions on two different run ids — no nesting | **Needs a lock-held bypass** in `startFlowchartRun` |
| `answer` flowchart contract (`--selected` correlation, `--message` must match pending) | `cli.test.ts` + USAGE pins | Additive branch on a plane the command currently refuses; flowchart path byte-untouched; `--selected/--results` still refuse off-plane (`main.ts:1716–1718`) | Same entry, but outcome printing must handle an embedded outcome |
| USAGE / source-pin freeze set (GPT-frozen §4, nine consumers) + `blocked-next.test.ts` main.ts body heuristics | freeze tests | New flags are additive lines; every pinned fragment stays byte-identical — same constraint §5.5 of the review put on the docs slot | Same, plus embedded-outcome print changes |
| Privacy record classes / deletion propagation | `record-classes.ts`, deletion tests | **No new files** → no new class, no propagation edit; `track-questions.json` gains additive keys only (class row's field list already covers objective/acceptance text) | Same |
| Doctor PLANNING/RUNNING inventory | doctor pins | Old run leaves the inventory (COMPLETED); mid-continuation crash appears — correctly | A's mid-crash log appears as a flowchart run with (transiently) no checkpoint — the refused state |
| Opus-track's in-flight refusal + inspect prose | landing this round | The refusal branch becomes the continuation dispatch; see coordination list §6 | Same |

---

## 6. Coordination requirements on the in-flight Opus-track slot (so round-3 continuation stays possible)

1. **Do not byte-pin the refusal message** as a frozen contract; pin it as ordinary CLI output. Its `next:` should say `run --track --answers <file.json>` (today's truth). When continuation lands, the same detection point dispatches instead of refusing.
2. **Plane detection must be an exported function**, not inline in `answerCommand` — §3.2's shared predicate.
3. **The `track-questions.json` reader must ignore unknown keys** (schemaVersion/habits arrive additively, §3.7) and must treat a missing/unparseable file as "no clarification plane" (fall through to today's behavior), never as fatal to `inspect`.
4. **Do not "fix" the phantom-RUNNING replay** by touching `replay.ts` — the pin at `m1-replay.test.ts:60–76` is load-bearing for the M1 question flow, and the continuation design *relies* on `USER_ANSWER` opening the run.
5. If the refusal also covers `resume` on this plane (F11), keep it a retarget message, not an error contract.

## 7. Required events / files — final inventory (Variant B)

- **New event types: none.** New `RunStatus`: none. New payload keys: none.
- **Events appended to the clarification run:** one `USER_ANSWER` (recorded `messageId`; `answer` = canonical sorted-key JSON `{"kind":"track-clarification","resolved":{…},"assumedDefaults":[…]}`), then one `RUN_COMPLETED {}`. Checkpoint rewritten after.
- **Events appended to the execution run:** the normal flowchart set, with `RUN_ATTACHED` naming the **existing** episode and `EPISODE_OPENED` absent.
- **Episode stores:** one `attachRun` snapshot + event on the shared episode; settle at the execution run's end as today.
- **Files:** no new files. `track-questions.json` gains additive `schemaVersion` and `habits` keys at the next writer touch. No record-class or deletion-propagation changes.
- **Code surfaces:** `src/track/continuation.ts` (new: plane detect + phase 1 + re-entry table), `src/track/loop.ts` (extract `executeTrackedPlan`; additive file keys), `src/run/episode-bind.ts` (`attachRunToExistingEpisode`), `src/run/flowchart-run.ts` (one additive `existingEpisode` input + attach branch), `src/cli/main.ts` (`answer` clarification branch + flags; `resume` retarget line).
- **Tests owed with the implementation:** continuation happy path through `main()`; every §3.5 refusal row; the three §3.6 crash windows (kill between the two appends; between phases; mid-flowchart) plus idempotent re-entry; episode close-from-WAITING via the successor; unknown-answer-key and unanswered-without-defaults refusals; a pin that the flowchart `answer` path is byte-unchanged.

## 8. Sequencing recommendation

Round 2 (in flight): Opus-track's inspect-prose + refuse-answer, with §6 honored. Round 3, one slot: Variant B behind the existing refusal point — phase 1 + re-entry first (they are the correctness core and independently testable), phase 2 wiring second. Variant A: not scheduled; revisit only if episode-hop UX proves to be a real operator complaint, and then as an addition on top of B, never instead of it.
