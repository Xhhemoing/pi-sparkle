# Loop 5 Round 2 — GPT track min-fix challenge

Reviewed independently at `HEAD` `826a44a`. Analysis/report only; no `src/` edits and no commit.

## Verdict

**ACCEPT WITH CHANGES.** Refusing `answer` on a track-clarification record is strictly safer than appending `USER_ANSWER`, and is the right containment fix. The proposed next step must not be described as continuing or resuming that run, however. Today `run --track --answers` starts a **replacement run** with a new run id and episode; the original remains `WAITING_FOR_USER`.

The minimum honest behavior is:

1. Human `inspect` shows the persisted question ids/text/options and the required answers-file shape.
2. `answer` recognizes this plane before parsing a displayed `q-*` id as a protocol `msg_*` id, exits nonzero, appends nothing, and says no answer was recorded.
3. Guidance says to repeat the original `run --track` invocation with a complete `--answers <answers.json>` map to start a **new replacement run**. It explicitly says the old run is not resumed and remains waiting.
4. `--json` and `--summary-json` do not read or render the sidecar.

This removes the state-corruption trap. It does not close the lifecycle gap, and should not claim to.

## Evidence

Current code has three incompatible identities/operations:

- `recordClarificationRun` writes one generated `RUN_WAITING_FOR_USER.payload.messageId` (`msg_*`) and separately writes multiple contract questions to `track-questions.json` under ids such as `q-done` and `q-tests` (`src/track/loop.ts:311-323`).
- Generic `answer` accepts a protocol message id and appends one free-text `USER_ANSWER` (`src/cli/main.ts:1707-1730`). It cannot represent the question-id-to-answer map that `applyAnswers` consumes.
- `startTrackedRun` consumes only its new invocation's `answers` object (`src/track/loop.ts:96-105`). No path reads prior `USER_ANSWER` rows or the old run's sidecar to continue that run.

I reproduced the current failure with the actual runner and CLI:

```json
{"before":"WAITING_FOR_USER","answerCode":0,"after":"RUNNING","answersRecorded":1,"sidecarQuestionIds":["q-done","q-tests"],"waitMessageId":"msg_..."}
```

That transition comes from the global replay rule that any `USER_ANSWER` clears `sawWaiting` (`src/run/replay.ts:306-313`); with the earlier `RUN_STARTED`, replay falls through to `RUNNING`. No executor is running and no track consumer processes the answer. The row may also be interpreted later as a `userAcceptance` learning signal (`src/learning/signals.ts:175-192`), although it was clarification rather than acceptance.

A complete answers map produced a different result:

```json
{"firstStatusNow":"WAITING_FOR_USER","secondStatus":"COMPLETED","distinctRuns":true}
```

So a new run is a workable retry, but not continuation. It re-extracts the contract using current preferences, re-discovers the project, reads current catalog/learned routing state, mints a new run id, and binds a new episode. It does not consume, supersede, close, or link to the old run.

## Required correction to the guidance

`track-questions.json` is **not** an answers file. Its shape is:

```json
{"questions":[...],"objective":"...","contract":{...}}
```

`--answers` expects a top-level map:

```json
{
  "q-done": "tests and a code change",
  "q-tests": "yes"
}
```

Passing `track-questions.json` itself as `--answers` was independently reproduced to fail the coverage gate with `blocking=q-done,q-tests`. The inspect text must therefore never imply that the sidecar path itself can be supplied. It should show an answers template or state the map shape, and require a non-empty answer for every displayed question.

“Start a new `--track --answers` run” is also incomplete CLI guidance because `run` still requires the project and objective, and execution/model flags may matter. Prefer:

> This clarification run cannot be continued by `answer`; no answer was recorded. Create an answers JSON object keyed by every question id above, then repeat the original `run --track --project ... --objective ...` invocation with `--answers <answers.json>`. This starts a replacement run with a new id; `<oldRunId>` remains `WAITING_FOR_USER`.

Do not interpolate an unquoted persisted objective into a copy-paste shell command.

## Why refusal is better than append

- It preserves the only true current status: waiting.
- It prevents a success-looking command whose result has no consumer.
- It avoids misclassifying clarification text as user-acceptance feedback.
- It avoids pretending one `msg_*` answer resolves several `q-*` decisions.
- It is additive at the CLI edge and does not risk changing `USER_ANSWER` replay for real child questions and flowchart approvals.

Do not “fix” this by changing `replayRun` so `USER_ANSWER` never clears waiting; that rule is shared by working planes. Prevent the invalid producer instead. Existing already-corrupted logs are not repaired by this min-fix; an optional human-mode warning for sidecar + answer rows is honest, while rewriting history is not.

## Sidecar/classification edge

Sidecar presence is strong evidence of a track clarification, but successful JSON parsing must not be the only guard against the bad append. `RUN_WAITING_FOR_USER` is appended before the atomic sidecar write, so a crash/write failure can leave a waiting clarification record with no readable sidecar. A malformed or missing sidecar must not fall through to an arbitrary generic append.

A small fail-closed rule is available: before the generic non-flowchart append, require `--message` to correlate to an actually persisted pending child `QUESTION`. A track clarification has no such child question, so it remains protected even if the sidecar is absent. When a valid sidecar exists, return the track-specific replacement guidance; otherwise refuse generically because no correlatable pending question exists.

The sidecar reader should validate only the fields it prints (`questions[]`, non-empty string id/question, string options when present). A malformed sidecar may warn in human inspect mode, but must not make event-log inspection or summary fail.

## `INSPECT_SUMMARY` freeze risks

The safe seam is human text mode only, after the existing early returns for `--json` and `--summary-json`.

- Do not add `questions`, `trackQuestions`, `next`, or any fifth key to `InspectSummaryJson` / `buildInspectSummaryJson`. Existing tests deep-pin exactly `type`, `runId`, `status`, and `requiredEvidence`.
- Do not append sidecar content to `inspect --json`; that stream is domain-event NDJSON and the sidecar is not an event.
- Prefer a separate sidecar helper called only by human inspect. Making `inspectRun` unconditionally parse the sidecar would make frozen summary availability depend on an ancillary file even if its four-key shape stays unchanged.
- Do not add an event type, alter `RunStatus`, or synthesize question events for display.
- Keep `--summary-json` one line and four keys even when the sidecar is present, missing, or malformed.

## Acceptance checks for the implementer

1. Human inspect of a fresh clarification run prints every `q-*` question and a complete-map/replacement warning.
2. `answer` with either the wait's `msg_*` id or a displayed `q-*` id exits nonzero, records no event, and leaves replay/checkpoint status `WAITING_FOR_USER`.
3. The event log is byte-identical before and after the refusal.
4. A deleted or malformed sidecar cannot fall through to `USER_ANSWER`; inspect still prints the event-derived run status.
5. `inspect --json` remains exactly the original event rows; `--summary-json` remains exactly the frozen four-key object.
6. A generated answers map starts a distinct run, while the test explicitly asserts the original is still waiting.
7. Existing flowchart approval answering and a correlated non-flowchart child question remain unchanged.

## Close

The refusal is the correct min-fix. Calling the replacement run an “honest continuation” is not correct: it is an honestly disclosed workaround only when the CLI names the new lifecycle, the stranded old lifecycle, and the exact answers-file shape. A true same-run continuation remains a separate design requiring durable execution configuration, multi-question correlation, one-run/one-episode transition semantics, and a resume-capable track entry point.
