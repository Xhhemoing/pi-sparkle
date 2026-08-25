# R1-opus-B — thinking deltas as size-only execution events

MODEL_SLUG: claude-opus-5-thinking-high-fast

## What changed

`thinking_delta` events from Pi now reach supervisors and the event log as a
byte count, never as text.

| File | Change |
|---|---|
| `src/execution/contract.ts` | New `ExecutionEvent` variant `{ type: "THINKING_DELTA"; bytes: number }`. |
| `src/pi-adapter/pi-executor.ts` | `translatePiEvent` switch only: `message_update` with `assistantMessageEvent.type === "thinking_delta"` maps to `THINKING_DELTA` carrying `Buffer.byteLength(delta, "utf8")`. |
| `src/run/events.ts` | `AGENT_EVENT_KINDS` gains `"THINKING_DELTA"`, so `AGENT_EVENT` payload validation accepts the kind. |
| `src/run/coordinator.ts` | New case appending `AGENT_EVENT` with summary `thinking delta (N bytes)`. |
| `src/run/child-coordinator.ts` | Same, via `appendChildEvent` on the child run. |

## Field name verified against the installed types

`@earendil-works/pi-ai@0.84.3` `dist/types.d.ts:400-453` defines
`AssistantMessageEvent` as a discriminated union; the reasoning arm is
`{ type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }`.
The delta field is `delta`, the same name the `text_delta` arm uses, so the new
branch mirrors the existing text branch except for what it keeps.

## Redaction boundary

The raw reasoning string is read exactly once, inside `translatePiEvent`, to
measure it. It is never placed on the returned event, so no consumer
downstream of the adapter — coordinator, child coordinator, event store,
checkpoint, invocation telemetry — has a value to persist. `buildInvocation`
folds only `TEXT_DELTA` into `responseText`, so `responseHash` is unaffected by
thinking and stays comparable with records written before this change.

Bytes rather than characters: the count is UTF-8 encoded length, which is what
a size or cost signal should mean, and it does not vary with JS surrogate-pair
representation the way `String.length` does.

## Exhaustiveness

`tsconfig.json` sets `noImplicitReturns`, so `ChildCoordinator.handleExecutionEvent`
(which returns `Promise<TaskResult | undefined>` off a switch with no default)
would have failed to compile without the new case. The parent coordinator's
switch is statement-shaped and would have silently dropped the event instead;
it got the case explicitly. Those two are the only switches over
`ExecutionEvent` in `src/`. `flowchart-executor.ts` filters for `MESSAGE` and
`EXECUTION_FINISHED` by equality and needs nothing; `FakeExecutor` replays a
caller-supplied script and emits no thinking events.

## Verification

- `npx tsc --noEmit -p tsconfig.json` — clean.
- `npm test` — 1413 pass, 1 skipped, 0 fail (includes R1-gpt-B's
  `test/unit/pi-adapter/translate-thinking.test.ts`, which asserts the raw
  thinking string does not appear in `JSON.stringify` of the translated event).
- `npm run lint` — clean.

`test/unit/pi-adapter/translate-usage.test.ts` was left untouched; nothing in
it broke, since `turn_end` handling is unchanged.

## Not done here / handoff

- `docs/specs/m0-m2-architecture.md:289` reproduces the `ExecutionEvent` union
  and now omits `THINKING_DELTA`. Docs belong to R1-fable-A this round, so it
  is flagged rather than edited.
- No commit, per the round invariants.
