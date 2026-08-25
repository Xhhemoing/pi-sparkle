claude-opus-5-thinking-high-fast

# Loop 4 · Round 3 · R3-9 — Resume path records zero invocations

Slot: R3-9 (P2, telemetry honesty). Base: `agent/opt-continuous` @ `152bdb4`. Not committed (per instruction).

## Defect, re-verified at HEAD

`resumeCommand` built both of its executors with no hooks. Measured on `git show HEAD:src/cli/main.ts`, over the extracted `resumeCommand` body:

```
resume sites: 2
has onInvocation in resume body: false
has sink in resume body: false
```

The sink existed only in `runCommand` (`createInvocationSink(stateRoot, …)`, line 627), so a resumed run that spends money on `--executor pi` wrote nothing to `runtime/invocations.jsonl`. Everything reading that log — `loadInvocationsFromStateRoot` → `createCalibratedCliModelRouter`, and any run-to-run cost comparison — silently under-counted every run that was resumed rather than finished in one go. Same class T2 closed for `runCommand`'s flowchart branch.

## Change (src/cli/main.ts, +19 / −2, nothing else in the file reformatted)

1. One `createInvocationSink(stateRoot, { onDrop })` built in `resumeCommand` right after `stateRoot` resolves, with the same stderr disclosure string `runCommand` uses (`warning: invocation telemetry dropped: …`). One sink, shared by both call sites — the sink's per-log-path queue is what keeps a retrying row ahead of rows issued after it, so two sinks over one log would be a regression, not a duplicate.
2. Supervised site (`resumeSupervisedRun` deps, was `main.ts:1130`): now passes `{ onInvocation: (invocation) => { void invocationSink(invocation); } }`.
3. Flowchart `--executor` site (was `main.ts:1167`): same hook. No `thinkingLevel` argument — `resume` has no `--thinking` flag, so the third positional is the only one added.

`runCommand`'s wiring is untouched; its pin in `test/unit/telemetry/invocation-log.test.ts` (R3-2's file this round) is unmodified and green. `src/telemetry/invocation-log.ts` untouched.

## New test file: `test/unit/cli/invocation-sink-wiring.test.ts` (9 tests)

Source pin, local `normalizeSource` copy (comments and string bodies blanked, length preserved) so a hook that survives only in a comment cannot satisfy it. It is deliberately not a bare regex: `assertResumeSinkWiring(rawSource)` takes source text, so the same predicate that guards HEAD can be run against deliberately broken variants.

- `both createExecutor call sites in resumeCommand pass the shared invocation hook` — exactly 2 sites, each with `onInvocation:` and `invocationSink(`, plus one `const invocationSink = createInvocationSink(stateRoot` in the body.
- `no createExecutor call anywhere in main.ts is built without an invocation hook` — 4 call sites total (run 2, resume 2), each hooked; the declaration is excluded by its preceding `function`. This is the pin that makes the whole defect class, not just today's two sites, go red.
- **Five mutation controls**, each asserting the pin throws: supervised site drops its hooks argument; flowchart site drops its hooks argument; the hook survives only as a comment; a hook bypasses the shared sink; the sink is built from something other than the resolved state root. Without these the pin would be decoration — mutants 1 and 2 reproduce the HEAD form exactly.

Behavioral (offline-drivable paths):

- `resume --supervised still completes with the invocation hook wired` — real supervised run via `startSupervisedRun`, then `main(["resume", …, "--supervised"])`: exit 0, `resumed (COMPLETED)`, no drop warning on stderr.
- `resume --executor on a flowchart checkpoint still completes with the hook wired` — `run --flowchart --results`, then `main(["resume", …, "--executor", "fake"])`: exit 0, `COMPLETED`, no drop warning.

## Honest scope limits (disclosed, and asserted rather than hidden)

- **The fix only produces rows for `--executor pi`.** `createExecutor` forwards `onInvocation` solely on the `pi` branch; `fake` / `fake-children` never call a model. Both behavioral tests therefore assert `invocations.jsonl` has **zero** rows — that is the truthful post-condition for a fake executor, and it states that the added wiring costs nothing on the paths a test can drive offline.
- **No end-to-end proof that a resumed `pi` run persists a row.** `createConfiguredPiExecutor` always passes `models` from `createPiRuntime`, which means `PiAgentExecutor`'s built-in `faux` provider handle is never constructed, so `--executor pi` cannot be driven without a live provider (or a local HTTP provider fixture, which is out of proportion to a two-call-site slot). This is exactly why the existing `runCommand` guard is a source pin too. The mutation-checked pin plus the already-covered `PiAgentExecutor → onInvocation → createInvocationSink` legs (`test/integration/pi-adapter/invocation-recording.test.ts`, `test/unit/telemetry/invocation-log.test.ts`) are the evidence; the joint is pinned, not executed.
- The pin now forbids any future unhooked `createExecutor` call in `main.ts`. If a later command legitimately needs a hookless executor, that assertion has to be revisited deliberately — which is the intent.

## Verification

- `node scripts/run-tests.mjs test/unit/cli/invocation-sink-wiring.test.ts` → 9/9 pass.
- Owned + adjacent, **3× consecutive** (`invocation-sink-wiring`, `telemetry/invocation-log`, `integration/cli/cli`, `integration/cli/pause-inject`): 61/61 pass each run. R3-2's `runCommand` pin green throughout.
- `npx eslint src/cli/main.ts test/unit/cli/invocation-sink-wiring.test.ts` → clean.
- `npx tsc --noEmit` (whole tree) → clean.
- Whole-tree `node scripts/run-tests.mjs test` → 1599 pass / 0 fail / 1 skipped.

**Shared-tree transient, attributed not fixed:** one earlier whole-tree run reported `1596 tests / 1 fail`. The working tree is shared with the other Round 3 slots (`git status` showed in-flight edits in `src/telemetry/model-invocation.ts`, `src/run/event-store.ts`, `src/cli/doctor.ts`, `src/cluster/host.ts`, `src/feedback/store.ts`, `src/privacy/deletion.ts`, `src/run/scheduler.ts`, and others), and the test count moved between runs (1596 → 1600) as siblings landed. The failure did not reproduce on the next two runs and is not in any file this slot owns; my owned tests passed on all runs. Skip count dropping 2 → 1 is R3-1 un-skipping the fuzz case, as planned. The parent's gate is the authority here.

## Constraints honored

No live R1/bandit/topology, no Outcome-supported claim, ADR-006 untouched, no auto-promote, no `package.json`/dependency edit, no git commit. Files touched: `src/cli/main.ts` (two call sites + sink construction only) and the new `test/unit/cli/invocation-sink-wiring.test.ts`. `src/telemetry/invocation-log.ts` and `test/unit/telemetry/invocation-log.test.ts` (R3-2) left alone.
