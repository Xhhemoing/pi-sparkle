# Loop 5 · Round 1 · Fable-runtime — Core-flow map and usability gaps

Agent: Fable-runtime (claude-fable-5-thinking-xhigh) · branch `cursor/pi-sparkle-sota-opt-0da8` · analysis only, no src edits, no commit.

Scope read: `src/run/`, `src/graph/`, `src/track/`, `src/cluster/`, `src/supervisor/`, `src/cli/main.ts` + subcommand files, `src/privacy/deletion.ts`, `docs/specs/m0-m2-architecture.md`, `docs/status-matrix.md` (runtime section), `docs/agent-decisions.md`. Every claim below is cited to a file/line I read this round; nothing is inferred from docs alone.

Out of scope by instruction (not proposed anywhere below): taskCriteria/taskCostCeilings, steerText registry, crash-probe 12th case, live topology, synthesizing contracts from acceptanceCriteria. Loop 4 frozen honesty surfaces (`--summary-json` INSPECT_SUMMARY pins, byte-pinned stderr on the supervised resume branch, refusal wording) are treated as fixed constraints; every gap below is additive UX or wiring, not a change to an honesty claim.

---

## 1. Core flow map (start → stall/block → inspect → answer/unblock → resume → delete)

There are four run planes, and the flow is only fully closed on one of them.

### Plane A — Flowchart (`run --flowchart`, and what `--track`/`--children` compile into)
- **start**: `startFlowchartRun` takes the run lifecycle lock for the whole run (`flowchart-run.ts:1366`), persists checkpoint per step.
- **stall/block**: run settles `WAITING_FOR_USER` (approval/question), `PAUSED`, or `BLOCKED`; settle-time report printed by the driving process (`main.ts:833,1054`).
- **inspect**: shows status, flowchart node states, pending approval (ids only, see F6), required evidence (`main.ts:1190–1255`).
- **answer/unblock**: `answer --selected/--text` continues in-process; `unblock --retry-node` is the only exit from BLOCKED (`main.ts:1484–1494`).
- **resume**: `resume --run` with flowchart continuation; refuses while paused unless `--unpause` (`main.ts:1428–1430`).
- **delete**: `delete --run` under the same lock.
- **Verdict: closed loop.** The gaps here are discoverability (F5, F6), not missing verbs.

### Plane B — Track clarification (`run --track` before a flowchart exists)
- **start**: `startTrackedRun` → `waitForClarification` mints a run, records `RUN_WAITING_FOR_USER` with a `messageId`, writes `track-questions.json` (`track/loop.ts:241–331`).
- **inspect**: shows `WAITING_FOR_USER` and **nothing else** — questions live only in the file/payload, and `inspectRun` collects questions solely from `AGENT_MESSAGE` `QUESTION` messages (`inspection.ts:136–138`).
- **answer**: `answer --message --text` is accepted and recorded (`main.ts:1804–1814`) — and **never consumed by anything**.
- **resume**: does not exist for this plane. No code path reads `track-questions.json` back. The only printed guidance ("re-run with `--assume-defaults` or `--answers`", `main.ts:928`) appears once, at settle time, in the starting terminal, and starts a **new** run.
- **delete**: the only exit for the stranded run.
- **Verdict: dead end** (F4). This is the plane a first-time interactive user hits first.

### Plane C — Supervised DAG (`run --supervised`, `resume --supervised`)
- Closed via `resumeSupervisedRun`, but plain `resume` on a DAG run silently degrades to "checkpoint rebuilt" with exit 0 (F9). No approvals/questions on this plane; block recovery is retry-on-resume.

### Plane D — M0/M1 (`run` plain, parent/child)
- **answer** records `USER_ANSWER` and stops without pointing at the verb that makes it take effect (F10). `inspect` does surface child questions **with** the messageId needed (`main.ts:1244–1245` prints `question.id` which *is* the message id) — this plane's answer loop is discoverable, just not guided.

**Cross-cutting entry problem**: every verb after `run` requires a run id, and there is no reachable command that lists them (F1). **Cross-cutting exit problem**: there is no way to stop a live run at all (F7), and the escape hatch (kill the process) is documented to leave a stale lock that then blocks pause/delete.

---

## 2. Findings (ranked)

### F1 — `list` is finished, tested, committed… and unreachable (P0, wiring)
`src/cli/list.ts` is a complete command: usage text, `--runs/--episodes/--status/--json`, a frozen-additive `RUN_LIST`/`EPISODE_LIST` JSON contract, error accounting for unreadable records. `src/run/inventory.ts` is its backend. Both are committed with passing unit tests (`test/unit/cli/list.test.ts`, `test/unit/run/inventory.test.ts`). The file *opens with its own wiring instructions* (`list.ts:1–7`: one import, one `case "list"`, one USAGE line) — and `main.ts`'s dispatch (`main.ts:2140–2196`) has no `list` case, so `pi-sparkle list` prints "Unknown command: list". `docs/agent-decisions.md:22` names this decision #1 ("Today inspect/resume/delete/pause require the operator to already know the id") and `:53` authorized agent Opus-list to add exactly those lines; the wiring never landed.

Impact: the single largest flow gap in the CLI — id discovery for *every* other verb — is already solved in the tree and costs three lines to ship. Also the Round-1 "add a list command" bet from earlier loops should be re-scoped from "build" to "wire".

### F2 — `init` is finished and unreachable, and uncommitted (P0, wiring + rescue)
`src/cli/init-examples.ts` (+ `examples/`, + `test/unit/cli/init-examples.test.ts`) is Opus-init's complete deliverable, with the same self-describing wiring note (`init-examples.ts:1–3`). It is **untracked in the working tree** (`git status`: `??`) — one `git clean` away from vanishing — and has no `case "init"` in the dispatch. Onboarding today requires hand-writing children/flowchart JSON with no template.

### F3 — `validate` never landed at all (P1, missing deliverable)
`docs/agent-decisions.md:54` planned `src/cli/validate.ts` (+ tests + one-case wiring) for agent Opus-validate. No such file exists anywhere in `src/cli/`. Spec errors are currently discovered only by starting a run; pre-flight refusal already exists in `graph/validate.ts` / `validateFlowchart` but has no offline entry point.

### F4 — The clarification wait is a dead end with an invisible question (P1, flow break)
Three independent breaks on Plane B, all verified:
1. **Invisible**: `inspect --run` on a clarification run shows `WAITING_FOR_USER` with no question text and no messageId. `waitForClarification` records the messageId only in the `RUN_WAITING_FOR_USER` payload (`track/loop.ts:312–313`) and the questions only in `track-questions.json` (`:320–323`); `inspectRun.pendingQuestions` reads neither (`inspection.ts:136–138`). The questions are printed once, at settle, in the starting terminal (`main.ts:923–928`).
2. **Answer accepted but dead**: the generic `answer --message --text` path appends `USER_ANSWER` and exits 0 (`main.ts:1804–1814`); nothing on the track plane ever reads it.
3. **No resume**: no code path consumes `track-questions.json`; the documented continuation is a fresh `run --track --answers`, which strands the old run in `WAITING_FOR_USER` permanently (no terminal event; delete is the only exit; these accumulate in `list` output once F1 ships).

Cheapest honest fix that touches no frozen surface: teach `inspect` to render the clarification question(s) + the re-run guidance (read from `track-questions.json` / the event payload), and make `answer` on a clarification run either refuse with "this run continues via `run --track --answers <file>`" or write the answers file. A true resume path is a bigger bet; the refusal+guidance version closes the operator trap immediately.

### F5 — Blocked-run recovery guidance is print-once (P1, discoverability)
The unblock how-to (blocked node, `unblock --run … --retry-node …`, discard-executed note) is produced by `reportBlockedRun` (`main.ts:572–588`) and printed only when a `run`/`resume`/`answer` *settles* into BLOCKED in that same process (call sites `main.ts:833,1054,1469,1787`). `inspect --run` on a BLOCKED run prints status and `required evidence` (`main.ts:1220–1225`) but never the blocked node id or the unblock command. A blocked run is precisely the run an operator returns to in a new session; today the recovery verb is discoverable only from USAGE. The block payload is already in the event log — inspect can render the same report additively (new lines, no changes to existing lines or to `--summary-json`).

### F6 — Approval prompts identify items by id only (P2, discoverability)
Both the settle-time print (`main.ts:638–642`) and inspect (`main.ts:1207–1212`) render `pending approval pln_x: act_1, act_2` from `item.id`. `ApprovalItem` carries a human `label`, and the plan distinguishes ROUTE vs BRANCH (`supervisor/flowchart-supervisor.ts:73–80`). The reply must be ids (`--selected`), but *choosing* requires labels — today that means reading `checkpoint.json` by hand. Rendering `id — label` (and the plan kind) is additive text on both surfaces.

### F7 — There is no way to stop a live run; the workaround's aftermath is a stale lock (P2, missing verb)
The lock posture itself is deliberate, tested, and signed off — cross-process `pause` of a live run fails closed with LOCK_TIMEOUT ("the disclosed cost of the acquisition", `coordinator.ts:62–106`; test `run-lifecycle-lock.test.ts:276–308`) — and I am **not** proposing to change it. The gap is what's left: no `cancel`/`stop` verb, and no `SIGINT`/`SIGTERM` handler anywhere in `src/` (grep-verified: zero `process.on` in src), so the only stop is killing the process, which per the same comment block leaves the lock file behind and then delete/pause/track-question writes "fail closed until an operator removes the file". An in-process signal handler in the CLI entry (record crash terminal via the existing `recordCrashTerminal` machinery, release the lock, exit nonzero) stops the run *from inside the lock holder* — fully consistent with the cross-process posture, and it converts today's worst flow (kill → stale lock → doctor → manual `rm`) into a clean stop.

### F8 — `pause` speaks flowchart-only, on every plane (P2, error UX)
`pauseCommand` routes all runs through `pauseFlowchartRun` → `restoreFlowchartSession` (`cli/pause.ts:64–68`), so pausing an M0/M1/supervised run — or a track clarification run, which has *no* checkpoint at all — fails with "Flowchart run … has no durable checkpoint; refusing to invent state" or "checkpoint is missing flowchart snapshot" (`flowchart-run.ts:1789–1798`). USAGE presents `pause --run` as a general verb. A plane check before the restore could refuse with what the run actually is and which verbs apply to it.

### F9 — Plain `resume` on a supervised run silently no-ops as "checkpoint rebuilt" (P3)
When the checkpoint carries no flowchart and `--supervised` was not passed, `resumeCommand` falls through to rebuilding `checkpoint.json` and exits 0 with "checkpoint rebuilt (RUNNING, N events)" (`main.ts:1476–1481`). For a DAG run this is a success-looking no-op; nothing suggests `--supervised`. The events can show the run is supervised (task-graph events); one additive hint line fixes it. (The supervised branch's byte-pinned stderr, `main.ts:1465–1467`, is untouched — the hint belongs on the *fall-through* path, which is not pinned.)

### F10 — `answer` (non-flowchart) records and stops without a next step (P3)
`main.ts:1804–1814`: "Recorded answer for msg on run", exit 0. On the flowchart plane the same verb continues the run in-process; on M0/M1 the answer takes effect only on the next continuation. One additive line ("run `resume --run …` to continue") aligns the two.

### F11 — PAUSED exit code disagrees between planes (P3, scripting)
`flowchartExitCode` returns 0 for `COMPLETED | WAITING_FOR_USER | PAUSED` (`main.ts:513–515`); the tracked path returns 0 only for `COMPLETED | WAITING_FOR_USER` (`main.ts:946`), so a paused tracked run exits 1 while a paused flowchart run exits 0. Same operator meaning ("parked on purpose"), opposite automation signal. Whichever direction is chosen, it's a one-line change plus test pins.

### F12 — `delete --run` on a parent neither cascades to nor names child runs (P2, privacy-adjacent scope)
`privacy/deletion.ts` removes the one run subtree; child runs minted by the child coordinator are sibling run directories holding their own event logs (objective text, outputs), and deletion has no `childRunId` awareness (grep-verified). Deleting a parent therefore leaves children behind with no indication they exist. Minimal honest fix without touching deletion semantics: `delete --run` prints the surviving child run ids (already reconstructable — `inspection.children` lists them) so the operator can delete them explicitly. A cascade flag is a larger design decision (children can be shared/inspected independently) and should be its own bet.

---

## 3. Deliberate designs verified and *not* flagged
- Live-run pause failing closed with LOCK_TIMEOUT: documented trade with parent sign-off and a dedicated test; only the *absence of any stop path* is flagged (F7).
- Locks never stolen; `doctor` inventories holders: consistent posture, kept.
- Empty-`runtime/runs/` residue on resume-of-nonexistent-run: disclosed in `supervisor.ts:766–774`, deliberate, kept.
- `inject` holding no lifecycle lock: documented side-channel semantics (`main.ts:1487–1489`), kept.
- `unblock` executing nothing (authorize vs spend split): documented and right, kept.

## 4. Suggested Round-2 bets, in order
1. **Wire what exists** (F1 `list`, F2 `init` — commit Opus-init's files first): highest value-to-risk ratio in the repo; two dispatch cases + two USAGE lines, tests already green.
2. **Close the clarification trap** (F4): inspect renders questions + guidance; `answer` on a clarification run refuses with the correct continuation command.
3. **Make BLOCKED recoverable from a fresh session** (F5) and label approvals (F6): additive inspect/report lines only.
4. **Ctrl-C handler** (F7): in-process, posture-preserving; kills the worst operator flow (stale lock → manual rm).
5. Small polish batch: F8 pause plane check, F9 resume hint, F10 answer hint, F11 exit-code pin, F12 delete disclosure.

Items 1–3 change no frozen contract: `--summary-json` keys, byte-pinned supervised stderr, and refusal wordings are untouched; every proposed surface change is additive lines on unpinned output.
