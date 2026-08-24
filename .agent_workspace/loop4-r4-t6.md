claude-opus-5-thinking-high-fast

# Loop 4 Round 4 — R4-6 resume rebuilds the executor blind

## Census (before trusting the brief)

The brief's evidence holds at HEAD, and the census settles the build-vs-buy question the brief left open.

- `resumeCommand`'s `parseArgs` accepted `run`, `state-root`, `supervised`, `executor`, `results`, `selected`, `selected-ids`, `text`, `unpause` — neither `--primary-model` nor `--thinking`. Both `createExecutor` calls passed three arguments, so `modelOverride` and `thinkingLevel` were `undefined`; `createExecutor` then resolved `thinkingLevel ?? resolveThinkingLevel(undefined)` (i.e. `PI_THINKING_LEVEL` or `off`) and the primary model from env/`providers.json`. A run started on `--primary-model X --thinking high` resumed on neither, silently.
- **Nothing anywhere records a run's executor configuration.** `thinkingLevel` appears in `src/cli/main.ts`, the pi adapter, and `pi-compat` only — no event payload, no checkpoint field, no `Run` field. `RUN_CREATED` carries `payload.run`, which `validateRun` checks as the eight-field `Run` interface (`id`, `projectId`, `parentRunId?`, `rootTaskId`, `status`, `limits`, `createdAt`, `updatedAt`).
- The decisive fact against the persistence option: `checkpoint.json` is **derived, not authoritative**. The non-flowchart resume path rebuilds it with `materializeCheckpoint(replayRun(events), nowIso())` (`src/run/replay.ts:214`), which constructs the object from replayed state alone. A config field written into the checkpoint at run start would be silently dropped by the first plain resume. Persisting honestly therefore requires an *event-log* payload change (a `RUN_CREATED` field or a new event), not a checkpoint field — that is schema, and per the brief it needs parent sign-off. There is no clean additive path that stays out of the event schema, so **I did not take it**; see Disclosures.

Decision: accept the flags on resume (the brief's "smallest" option), and make the divergence loud in both directions.

## Change

`src/cli/main.ts`, `resumeCommand` region only:

- `parseArgs` now accepts `"primary-model"` and `thinking`. `--thinking` is validated at `stage: "parse-args"` with the same message and `next` text `runCommand` uses, then resolved through the existing `resolveThinkingLevel`; `--primary-model` goes through `tryParseModelRef`, same precedence comment and alias posture as `run` (an alias like `premium` is not a concrete ref and does not pin a channel).
- Both `createExecutor` call sites now pass `modelOverride` and `thinkingLevel` as the 4th and 5th arguments. The existing hooks object is untouched, so the frozen sink wiring and its mutation targets are byte-identical.
- New exported `describeResumeExecutorConfig(...)` returns the one-line disclosure (or `undefined`), and `resumeCommand` prints it to stderr before building anything. Four cases:
  - no executor will be built (plain checkpoint rebuild, or flowchart resume without `--executor`) and flags were passed → `warning: resume ignored --primary-model/--thinking: this resume rebuilds no executor ...`;
  - a non-`pi` executor and flags were passed → `warning: resume ignored ...: they configure --executor pi, and this resume builds the fake-children executor`;
  - `pi` with no flags → `warning: resume rebuilt the pi executor on defaults (the default primary model, thinking off); the run's own --primary-model/--thinking are not recorded, so pass them again if it did not start on defaults` — this is the R4-6 case, and it is the line that ends the silence;
  - `pi` with flags → `note: resume rebuilt the pi executor with primary model p/m and thinking high; the run's own executor configuration is not recorded, so this is what you asked for now, not what it started with`.
  - Everything else stays silent: a resume with no flags on a path that cannot use them prints nothing new.
- Disclosure is emitted **before** `createExecutor`, so a resume that then fails to build a pi executor has still said what it was going to use.
- USAGE: the `resume --supervised` line gained `[--primary-model <id>] [--thinking <level>]`, and the resume prose gained three lines stating that executor configuration is not recorded. This is the only edit outside `resumeCommand` itself (see Disclosures).

## Pins

`test/unit/cli/invocation-sink-wiring.test.ts` (owned): the published sink pin, its wording and all five of its mutants are unchanged and green. Added, additively:

- `rawFunctionBody`, which reuses the fact that `normalizeSource` replaces characters one-for-one to cut the same span out of the raw source, so parse options can be matched by their real (unblanked) flag names — with an assertion that the length-preservation property still holds.
- `assertResumeExecutorConfigWiring`: resume's `parseArgs` accepts both flags; `thinkingLevel` comes from `resolveThinkingLevel(values.thinking)`; `modelOverride` comes from `tryParseModelRef`; and both `createExecutor` call sites mention `modelOverride` and `thinkingLevel`.
- Six mutants for the new pin: each call site dropping the config, the override being parsed then replaced by `undefined` on the way to the executor, either flag disappearing from `parseArgs`, and `resolveThinkingLevel(values.thinking)` degrading to `resolveThinkingLevel(undefined)`. All six are rejected.

`test/unit/cli/resume-executor-config.test.ts` (new, behavioral): `--thinking ultra` fails at parse-args with nothing on stdout; an unusable ambient `PI_THINKING_LEVEL` is refused; flags are accepted and the checkpoint still rebuilds, with the ignored-flags warning; a flag-free resume stays silent; a flowchart `resume --executor fake` completes and discloses that the fake executor ignores the config; `resume --supervised --executor pi` with no provider configured prints the defaults warning *before* the build failure (asserted by offset ordering, which is the offline way to prove the sequencing); plus the four `describeResumeExecutorConfig` shapes and the usage text.

## Verification

- `npx tsx --test test/unit/cli/invocation-sink-wiring.test.ts test/unit/cli/resume-executor-config.test.ts`: 26/26 PASS, three consecutive runs.
- `npx eslint src/cli/main.ts test/unit/cli/invocation-sink-wiring.test.ts test/unit/cli/resume-executor-config.test.ts`: PASS.
- `npx tsc --noEmit` (whole tree, integrated with other slots' in-flight edits): PASS. An earlier attempt showed errors only in `src/track/loop.ts` (R4-1) and `test/unit/routing/catalog-observed.test.ts` (R4-9) — mid-edit transients in unowned files, gone on the retry; nothing was attributed to my files at any point and I edited nothing unowned to clear them.
- Regression sweep on suites that could see the new stderr line or the usage change: `test/integration/m2/resume.test.ts`, `test/integration/m2.5/resume.test.ts`, `test/integration/cli/cli.test.ts`, `test/unit/cli/thinking-flag.test.ts`, `test/unit/cli/flowchart-cli.test.ts` (50/50 PASS), and `test/integration/cli/commands.test.ts`, `test/integration/cli/migrate-legacy.test.ts`, `test/integration/m4/preferences-cli.test.ts`, `test/unit/pi-adapter/thinking-clamp.test.ts` (21/21 PASS).

## Disclosures

1. **The schema path was not taken.** Restoring a run's original configuration honestly needs the event log, because the checkpoint is derived (above). That is an event-payload schema change and needs parent sign-off; the operator therefore re-specifies, and every disclosure line says explicitly that the run's own configuration is not recorded rather than implying resume restored it. This is a real remaining gap: resume cannot detect that the operator re-specified the *wrong* values, only that it is using the ones it was given now.
2. **Behavior change beyond the flags:** resume now calls `resolveThinkingLevel`, so an unusable ambient `PI_THINKING_LEVEL` fails a resume that previously ignored the variable — including a plain checkpoint rebuild that builds no executor. That is deliberate parity with `run` (which refuses it even for `--executor fake`; `thinking-flag.test.ts` pins that), and the alternative would be a rule that changes with the checkpoint's shape. It is pinned in the new test so it is a decision, not an accident.
3. **One edit outside `resumeCommand`:** the two USAGE touches. They are in the `resume` lines of the usage block, not the run-summary/warning output region R4-2 owns; my working tree already contained R4-2's `main.ts` edits (`formatUndeliveredClusterMail`, `printFlowchartOutcome`) and there is no overlap. Flagging it because the usage block is a shared string.
4. **Scope of the offline evidence:** only `--executor pi` reads `modelOverride`/`thinkingLevel`, and building one needs a provider, so no offline test can observe the values arriving at `createConfiguredPiExecutor`. The forwarding is pinned structurally (with mutants), the disclosure behaviorally — the same split R3-9 used for the sink, for the same reason. R4-10's loopback provider would close it if it lands.
5. **Noise posture:** a `--executor pi` resume with no flags now always prints one stderr warning. That is intentional (the silence was the defect) and matches the established invocation-drop shape, but it is a new line on a path operators may run often.

Per instructions: stayed on `agent/opt-continuous`, no branch changes, nothing committed.
