[Model: claude-opus-5-thinking-high-fast]

# R8-7 — The parent plane's two crash residuals, decided

Slot: R8-7 · branch `agent/opt-continuous` (no checkout, no commit, no push) · owned files
`src/run/coordinator.ts` (sole) and one new additive test file,
`test/unit/run/parent-crash-residuals.test.ts`.

**`src/run/crash-terminal.ts` was not opened for edit** — per the parent sign-off, adding a
rethrow-free variant there would falsify that module's frozen contract. I read it (to quote
its rethrow clause accurately) and left it byte-identical. I touched no other slot's file:
not `replay.ts`/`events.ts` (R8-1, in flight), not `parent-terminal-refusal.test.ts` (R7-4),
not `docs/**` (R8-5).

## 1. Census, before writing anything

Taken against the working tree, not the brief.

| Claim under test | What the source says | Verdict |
|---|---|---|
| R7-4 disclosure 3: the refusal is terminal-keyed, so a crash over WAITING_FOR_USER still records `RUN_FAILED` | `loggedTerminalStatus` → `replayedTerminalStatus` → `TERMINAL_REPLAY_STATUSES = {COMPLETED, FAILED, BLOCKED}`; `replay.ts:181` only reaches `WAITING_FOR_USER` under `if (!sawTerminal)` | confirmed, and now reproduced end to end (§4) |
| `recordCrashTerminal`'s rule is broader | `crash-terminal.ts:63` — `if (status !== "PLANNING" && status !== "RUNNING") return;` | confirmed |
| its docstring's third rule blocks reuse here | "**The caller always rethrows.** Recording a terminal is bookkeeping; it never converts a crash into a settled run for the caller" — this plane's catch settles on purpose | confirmed |
| R7-4 disclosure 4: `RUN_CANCEL_REQUESTED` is unguarded | `writeCancel` appends behind `cancelWritten` only; `replayRun` flags `RUN_CANCEL_REQUESTED after a terminal event` | confirmed |
| "the flowchart plane does not guard it either" (R7-4's wording) | **partly wrong, and I did not repeat it.** `rg RUN_CANCEL_REQUESTED src/` finds *no* producer in `flowchart-run.ts` at all. The comparable plane is the supervised one: `supervisor.ts:279-284`'s `recordCancel`, unguarded behind a once-only flag | corrected in-source |
| review finding 3: `failureReason` at `:608` is write-only outside the child-failure branch | exactly that — declared at loop scope, assigned only at `:671`, read only at `:675`; the catch inlines its own reason | confirmed |
| the wait's answer channel | `ChildCoordinator` appends `RUN_WAITING_FOR_USER` to the **parent's** log (`child-coordinator.ts:809`) and answers through the in-memory `questionResolvers` map (`:223`, `:258`), which `answerQuestion` rejects for an unknown id | confirmed — this is the argument the decision rests on |

One census result changed a claim I was about to write down, so it is worth naming: the CLI's
`answer` command does **not** need a live resolver — it appends `USER_ANSWER` straight to the
log (`main.ts:1515-1523`). So "a buried wait was unrecoverable anyway" would have been false in
general. It is true only because `startParentRun` has no production caller and the CLI drives
the flowchart plane. The comment says that, rather than the stronger thing.

## 2. The two decisions, recorded in source

**Decision 1 — the refusal stays terminal-keyed; the `waiting` flag suffices.** Recorded as a
new `## Terminal-keyed, and that is the decision` section on `recordTerminal`. The substance:

- The difference from `recordCrashTerminal`'s in-flight rule is *owned here*, not inherited:
  a crash over a log replaying WAITING_FOR_USER still records `RUN_FAILED`.
- Why that is right rather than merely convenient: this plane carries its own wait in the
  loop's `waiting` flag, and that flag is exactly what breaks the loop out **before** any
  recorder is reached. A wait still on the log when the loop dies was therefore written by the
  child machinery while the loop turned, and the channel that would have answered it —
  `ChildCoordinator`'s in-memory `questionResolvers` — died with the process. `RUN_FAILED` is
  the true thing to say; leaving WAITING_FOR_USER standing would advertise a wait no live
  process is holding. `RUN_BLOCKED` is the opposite case, which is why the refusal exists at
  all: the gate wrote it deliberately and the *operator* owns clearing it.
- The cost, stated: an out-of-band `USER_ANSWER` would have cleared a wait left standing;
  under a recorded terminal it cannot, because replay reads the terminal first. No production
  caller can reach that combination today, and the comment says so instead of pretending the
  trade is free.
- Both widenings named and refused: `recordCrashTerminal` would falsify the frozen rethrow
  clause; re-deriving its rule locally is the drift `replayedTerminalStatus` exists to prevent.

**Decision 2 — `RUN_CANCEL_REQUESTED` stays unguarded.** Recorded as a new docstring on
`writeCancel`. The substance: a cancel request is an operator fact, not a status claim; it
stays true whatever the log says; it claims nothing on its own (`replayRun` reads it as
CANCELLED only on a terminal-free log, and otherwise reports the ordering as an anomaly, so
the fact is visible without the writer suppressing it); refusing it would make a finished run
silently swallow the operator's request. Cross-plane evidence corrected per the census above,
plus R4-3 from the other side: `supervisor.ts:468-472` deliberately does *not* trip its abort
controller on a crash so that "a cancellation nobody requested" cannot stand in for it. The
vocabularies do not substitute in either direction.

Neither comment mentions `RUN_CRASHED`, and nothing here makes WAITING_FOR_USER terminal.

## 3. The `failureReason` residue

`let failureReason: string | undefined;` deleted from the loop scope; the child-failure branch
now builds a `const reason` and passes `{ reason }`. The payload key and the string are
byte-identical for both arms (`"<taskId>: <summary>"` joined with `"; "`, and
`"unstarted children: …"`), so no recorded reason moves — R7-4's test 5 pins the child-summary
arm and stays green. The crash arm never used the variable and is untouched. Three lines
changed, no behaviour.

## 4. Tests — behaviour first, record second

New file `test/unit/run/parent-crash-residuals.test.ts` (4 tests, additive). I chose to pin the
*behaviour* of both decisions and to add the prose pin on top, rather than only the R7-2-style
record: a comment pin alone would let someone change what a crashed parent run says while
leaving the paragraph that describes the old answer in place.

| # | Test | What it holds |
|---|---|---|
| 1 | a crash over a log replaying WAITING_FOR_USER still records `RUN_FAILED` | decision 1 as behaviour: the wait is on the log *before* the terminal (index-ordered), status/checkpoint FAILED, one terminal, reason is still the raw escaping message, and — the accepted cost, pinned so it stays a decision — replay says FAILED with `anomalies: []` and the episode closes |
| 2 | a cancel request still lands on a log that already replays a terminal | decision 2 as behaviour: a gate-blocked run, then an out-of-band `cancel()`; `RUN_CANCEL_REQUESTED` reaches the log, replay still says **BLOCKED** (it is a fact, not a status), the single anomaly is `RUN_CANCEL_REQUESTED after a terminal event`, and no terminal was invented for it |
| 3 | both parent-plane crash decisions are recorded where the code makes them | R7-2-style prose pins (leading-`*` stripped, whitespace collapsed) on the two sentences, plus `doesNotMatch(/RUN_CRASHED/)` holding R4-4 |
| 4 | a terminal append in the parent loop cannot skip the recorder | the routing obligation R7-4 handed to "review only", made mechanical: inside `runParentRun`'s slice, `recordTerminal(` must appear and `make("RUN_COMPLETED"` / `make("RUN_FAILED"` must not. `startRun` (M0) is excluded by the slice, as it has no recorder |

Test 1's stand-in writer is R7-4's `blockRunLog` mechanism with the event swapped: the real
producer of `RUN_WAITING_FOR_USER` on a parent log is `ChildCoordinator`, but on that path the
loop sets `waiting` and breaks before reaching a recorder, so the residual shape needs a second
writer exactly as R7-4's did. The docstring says so.

**Mutation check — four mutations, each killing exactly one pin and nothing else:**

| Mutation | Result |
|---|---|
| widen `loggedTerminalStatus` to return `WAITING_FOR_USER` as well | **1 red**, 2/3/4 green |
| add `if ((await loggedTerminalStatus(eventStore)) !== undefined) return;` to `writeCancel` | **2 red**, 1/3/4 green |
| reword "a cancel request is an operator fact, not a status claim" | **3 red**, 1/2/4 green |
| replace the catch's `recordTerminal` call with a direct `append(make("RUN_FAILED", …))` | **4 red**, 1/2/3 green |

All reverted immediately (`git diff --stat` re-checked to the same 57/3 shape after each).
**Rewrap check:** re-broke the pinned sentence across four extra comment lines mid-phrase —
4/4 still green, so the prose pin really is wrap-insensitive.

## 5. Verification

- `npx eslint src/run/coordinator.ts test/unit/run/parent-crash-residuals.test.ts`: exit 0.
- `npx tsc --noEmit` (whole tree): **no error in any file I touched.** Three errors exist at
  the moment of writing, all in `test/unit/run/event-row-fuzz.test.ts`, all
  `Property 'RUN_UNBLOCKED' …` — see §6.
- Owned file **3×**: 4/4 each, 228/227/223 ms (test 2 polls the log, so the timing was checked).
- R7-4's file, unmodified: **7/7 green**, run together with mine (11/11).
- Consumer census of `coordinator.ts`, all run green: `src` importers `supervisor.ts`,
  `flowchart-run.ts`, `cli/main.ts`, `track/loop.ts` (none imports a symbol I changed — the
  edits are two comments and one branch-local variable, no signature moves, no export added or
  removed); `startParentRun` test consumers `m1/parent-run.test.ts`, `m3/coverage-gate.test.ts`,
  `cluster/undelivered-mail.test.ts`, `cluster/peer-mailbox.test.ts`,
  `cluster/dynamic-spawn.test.ts`, `unit/run/run-lifecycle-lock.test.ts`; plus
  `m0/coordinator.test.ts` and `acceptance/evidence-invariant.test.ts`. **37/37, 0 failures,
  0 skips.**
- `test/unit/run/**`: 177 pass / 2 fail, both attributed in §6. My four are in that pass count.
- `test/unit/routing/live-isolation.test.ts`: 8/8 green. (I added no `src` import at all — the
  diff is comments plus a `let`→branch-local `const` — so the rule did not bind, but it is
  cheap and the round asks for it.)
- No full gate (parent's job). No crash-probe case touched. **No perf claim, and no perf
  cost**: no new read, no new append, no new lock; `recordTerminal`'s single `readAll()` per
  terminal is unchanged from R7-4.
- No scratch files in the tree. The mutation backup lived at `/tmp/r87-coordinator.bak`.

## 6. Shared-tree transients, attributed

Both are **R8-1's in-flight `RUN_UNBLOCKED` landing**, not mine. `git diff` shows
`src/run/events.ts` (+45) and `src/run/replay.ts` (+61) already carrying the new event while
its consumer updates are not yet in the tree:

1. `test/unit/run/event-row-fuzz.test.ts` — 3 `tsc` errors and 1 red test: the exact-keyed seed
   map is missing `RUN_UNBLOCKED`. R8-1's brief lists that file as a mandatory in-diff consumer.
2. `test/unit/run/replay.test.ts:164` — the `vocabulary has no RUN_UNBLOCKED` tripwire, red by
   design; it is the **replace-not-weaken** pin R8-1 owns replacing.

Neither file is reachable from my diff (I touched no `src` outside `coordinator.ts`, and its
only new runtime-visible change is a branch-local `const`). Re-verified at the minute of
writing: with `event-row-fuzz` excluded, `tsc` reports nothing.

## 7. Disclosures

1. **I corrected an R7-4 disclosure rather than quoting it.** Disclosure 4 says "the flowchart
   plane does not guard it either". `flowchart-run.ts` has no `RUN_CANCEL_REQUESTED` producer
   at all, so there is nothing there to guard; the honest cross-plane witness is the supervised
   plane's `recordCancel`. The conclusion (leave it unguarded) is unchanged; the evidence in
   source is now the one that exists.
2. **Beyond the brief: test 4.** R7-4's handoff said a fourth terminal append "test 7 will not
   catch … only review will". The brief asked me to keep routing every terminal append through
   the recorder, so I made the ordinary bypass mechanical instead of leaving it to review. It is
   a source pin scoped to `runParentRun`'s slice, so it does not constrain `startRun`'s M0
   plane, and a determined bypass (a helper that builds the event elsewhere) still needs review.
3. **Test 2 polls.** `writeCancel` is `void`-ed from the abort listener, so nothing in the API
   awaits the out-of-band append. The test reads the log until `RUN_CANCEL_REQUESTED` appears,
   with a 5 s deadline and an explicit `assert.fail` message rather than a silent timeout. The
   in-loop alternative (cancel mid-run, let the loop's own `await writeCancel()` be the witness)
   would have raced the listener's append against the final read, which is worse.
4. **The residual that remains is now a stated cost, not an open question.** A crash over a
   waiting log still buries the wait. That is the recorded decision, with its price written
   next to it; anyone who wants the other answer is changing a decision and turning test 1 red,
   which is the point.
5. **Nothing here anticipates R8-1.** My recorder reads `replayedTerminalStatus`, and R8-1's
   diff clears the latch inside `replayRun` — so when the unblock lands, this plane follows it
   with **zero edits here**, which is the seam R6-1/R7-4 built. I did not touch it to help.

## 8. Handoff

- The parent plane's two crash-shaped decisions are now in source with behaviour pins under
  them. Changing either is a decision, not a refactor: test 1 for the wait, test 2 for the
  cancel, test 3 for the record itself.
- Test 4 is the mechanical half of R7-4's routing obligation. If a future slot legitimately
  needs a terminal named outside `recordTerminal` in that function, it owns updating that pin
  with a disclosure — the same replace-not-weaken posture R7-3's tripwire has.
- `crash-terminal.ts` is untouched and its contract is intact; the rethrow clause is now cited
  by name from `coordinator.ts`, so a future owner amending it can find the caller that leans
  on it.
- Unchanged and still true: `RUN_CRASHED` was not invented, `TERMINAL_REPLAY_STATUSES` was not
  widened, ADR-006 and `package.json` were not opened, and no live R1 surface was touched.
