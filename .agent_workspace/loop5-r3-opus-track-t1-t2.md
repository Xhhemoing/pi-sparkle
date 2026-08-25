# Loop 5 Round 3 — track follow-ups T1 + T2

Slot: Opus-track-t1-t2. Branch `cursor/track-failclosed-quoting-3be3`, cut from
`cursor/pi-sparkle-sota-opt-0da8` @ `cd6f834`. Implements D8 (T1) and D9 (T2)
only. D7 (same-episode continuation) stays design-only; nothing here touches it.

## T1 — `answer` fails closed without a correlatable question

`src/cli/main.ts`, `answerCommand`. The sidecar refusal is unchanged and still
first: a run with `track-questions.json` (readable or not) is refused with the
existing track-specific message. After it, and after the flowchart branch has
returned, a second guard runs before the generic non-flowchart append:

- if `replayRun(events).status === "WAITING_FOR_USER"` and `--message` matches
  no `inspectRun(...).pendingQuestions` id (a `CHILD_MESSAGE` `QUESTION` with no
  `USER_ANSWER` for its id), the command refuses and appends nothing;
- otherwise the append is exactly as before.

The correlation is `inspectRun`'s own pending list, so `answer` accepts exactly
the ids `inspect` prints — one definition, no second decoder.

Cases:

| State | Result |
|---|---|
| Sidecar present (readable or unreadable) | refused, track-specific message |
| WAITING, sidecar deleted/never written, uncorrelated `--message` | refused, generic message |
| WAITING, `--message` is a pending child `QUESTION` | records `USER_ANSWER` |
| Not waiting, no sidecar | records `USER_ANSWER` (existing pin) |

The generic message names no questions file, because on that path there is
none: it says the run is `WAITING_FOR_USER` with no pending question of that
id, that recording the answer would replay the run as RUNNING with nothing
consuming it, that nothing was appended, and that `inspect --run` lists the ids
the run actually recorded. It adds that a `run --track` wait whose
`track-questions.json` was lost also lands here and its questions are then
recorded nowhere.

The optional writer reorder in `src/track/loop.ts` was **not** taken. Writing
the sidecar before `RUN_WAITING_FOR_USER` only moves the tear: a crash between
them would leave a questions file on a run that never reached WAITING, which
`inspect` would then report as a clarification wait and `answer` would refuse —
a different dishonesty. D8's operator-side guard covers both orders.

## T2 — continuation facts, not argv

`trackContinuationCommand` is gone. `trackContinuationFacts` returns labelled
lines, and `trackFactValue` JSON-escapes a value only when it carries control
characters, so a newline in an objective or path cannot forge another fact
line. Rendered form (identical in `inspect` prose and in the refusal):

```
  next: this run stays WAITING_FOR_USER; start a new tracked run from the facts below (they are arguments, not a shell line)
  continuation verb: run --track
  continuation project: /tmp/demo proj; echo INJECTED
  continuation objective: fix $(echo INJECTED) it
  continuation answers: --answers <file.json>
  continuation state-root: /tmp/demo-state
```

Unrecorded values read `(not recorded — supply the project this run was started
on)` / `(... the objective this run was started with)`.

On the `answer` refusal the facts live inside the single `cliFail` `next`
string, after a `pnpm cli inspect --run <id>` remedy: the human render puts
them on their own `  continuation ...` lines and the JSON report carries them
escaped, so neither half loses the data. `next` interpolates only the run id,
which is a parsed `run_` identifier; no operator-controlled path or objective
goes into anything that looks executable.

## Tests

`test/integration/cli/track-clarification.test.ts`: 5 -> 9 cases. New:

1. clarification wait with the sidecar deleted — exit 1, event log
   byte-identical, no `USER_ANSWER`, `--summary-json` still `WAITING_FOR_USER`,
   and the missing file is not named;
2. a seeded coordinator wait (`CHILD_RUN_CREATED` + `QUESTION` +
   `RUN_WAITING_FOR_USER` written to the event store) refuses an id it never
   asked and records the one it did;
3. inspect on a project path containing `; echo INJECTED` and a space, with
   objective `fix $(echo INJECTED) it` — both appear as labelled facts;
4. the same fixture through the refusal, including the JSON report's `next`.

All four assert `!/next:.*pnpm cli run --track --project/` and that no `next:`
line carries `--project` or `--objective`. All four fail against the previous
`src/cli/main.ts`.

Kept green and untouched: the four pre-existing clarification cases,
`blocked-next.test.ts`, `inspection.test.ts` summary pins.

## Freeze

Nothing negotiated. No edits to `src/run/replay.ts`, `src/run/inspection.ts`,
`src/track/loop.ts`, `EVENT_TYPES`, `RunStatus`, `INSPECT_SUMMARY`,
`package.json`, or any frozen file in the brief. `pnpm gate` green: typecheck,
lint, 2132 pass / 0 fail / 1 skipped, build. Host Node 22.14.0 warns against
the `>=22.19.0` engine.
