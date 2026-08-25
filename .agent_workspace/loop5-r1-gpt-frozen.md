# Loop 5 Round 1 — GPT-frozen contract checklist

Independent review against `cursor/pi-sparkle-sota-opt-0da8` on 2026-08-25.
This is a landing gate for the proposed `list`, `validate`, and `init`
commands, not authorization to widen their scope.

## 1. File and dispatch boundary

- [ ] Keep each implementation in its assigned new surface:
  - `list`: `src/run/inventory.ts`, `src/cli/list.ts`, and its two assigned
    tests.
  - `validate`: `src/cli/validate.ts` and its assigned test.
  - `init`: `src/cli/init-examples.ts`, static files under `examples/`, and its
    assigned test.
- [ ] In `src/cli/main.ts`, each command adds only its import, one switch case,
  and one two-space-indented USAGE line. Preserve all three sibling lines when
  resolving a merge conflict.
- [ ] Do not reformat or move existing `main.ts` code while adding dispatch.
  In particular, do not touch `INSPECT_SUMMARY`, executor construction,
  invocation sinks, unblock routing, or doctor routing.
- [ ] Add no dependency and make no `package.json` or lockfile edit.
  `package.json` remains `private: true`, with no `pi.extensions`.
- [ ] Keep all claims at developer-preview/Exercised at most. Nothing becomes
  Outcome-supported, and ADR-006 remains Proposed.

## 2. Command-specific safety

### `list`

- [ ] Implement a separate read-only inventory. Do **not** export, reuse, or
  widen doctor's private `runStateInventory`; doctor intentionally inventories
  only PLANNING/RUNNING crash candidates.
- [ ] Include valid runs in all eight existing `RunStatus` values:
  `PLANNING`, `RUNNING`, `WAITING_FOR_USER`, `PAUSED`, `BLOCKED`, `COMPLETED`,
  `FAILED`, and `CANCELLED`. Include all five existing episode statuses without
  adding another status vocabulary.
- [ ] Derive a run status only by validating its event log and calling the
  shipped replay logic. Never map age, a lock, a missing checkpoint, an empty
  directory, or a corrupt log to `CRASHED`, `STALE`, `UNKNOWN`, `FAILED`, or
  `PLANNING`.
- [ ] Do not call `replayRun([])`: an empty/missing event log is not evidence of
  a PLANNING run. A corrupt middle row fails closed; a recovered truncated tail
  retains the existing JSONL-reader meaning. A skipped/unreadable record must
  be explicit in the new result or fail the command—never silently disappear
  behind a clean-looking count.
- [ ] For episodes, use the validated latest persisted snapshot. Do not infer
  episode state from attached runs or synthesize a closure/outcome.
- [ ] Keep the operation point-in-time and read-only. No watch loop, polling,
  lock acquisition/stealing, pause token, event append, checkpoint write,
  directory creation, or repair.
- [ ] Keep inventory to runs and episodes. Do not read, aggregate, append, or
  rewrite `runtime/invocations.jsonl`; cost/activity summaries are a different
  feature and privacy surface.
- [ ] Make ordering deterministic and test it, but do not present ordering as a
  lifecycle transition.
- [ ] Give machine output its own non-event `type: "RUN_LIST"` contract. Pin
  every documented key and its meaning in exact-shape tests now. Later fields
  are additive only and require an intentional pin update.

### `validate`

- [ ] Validate exactly one requested input kind (`--children` or
  `--flowchart`) without starting a run, constructing an executor/router,
  loading learned routing, writing state, or minting ids.
- [ ] Reuse the shipped JSON/parsing/domain validators. In particular,
  `parseFlowchartFile(path)` can perform structural flowchart validation
  without a state-derived catalog when no catalog ids are supplied.
- [ ] Do not create a second children schema. The current children parser is
  private inside `main.ts`; that is a real sharing seam, not permission to copy
  it. If extraction is needed so both `run --children` and `validate` consume
  one parser, coordinate the ownership change and prove existing children
  behavior unchanged before landing. Do not solve the seam with a
  `validate.ts` → `main.ts` cycle.
- [ ] State the validation scope honestly. Structural validity is not proof
  that a provider/model catalog is configured or that execution will succeed.
  Do not silently load/default a catalog merely to print “valid.”
- [ ] Make validate stdout one command-owned JSON object with a unique literal
  type and documented keys. Freeze those keys additive on day one with an
  exact-shape test. The object is a CLI view, not an `Event`; failures must not
  leave a success object or partial JSON on stdout.
- [ ] Test parser parity with fixtures accepted and rejected by the live
  parser/validator. Do not weaken existing runtime validation to make an
  example pass.

### `init`

- [ ] Write only the named example children/flowchart files beneath the
  operator-selected output directory. It has no state-root default and creates
  no run, episode, event, checkpoint, telemetry row, learned state, provider
  config, package manifest, or Pi extension.
- [ ] Without `--force`, refuse before overwriting either existing target.
  With `--force`, replace only the command-owned target files—never remove,
  truncate, or recursively clean unrelated directory contents.
- [ ] Keep the checked-in examples static and deterministic. Run both through
  the same validators used by `validate` and the live commands.
- [ ] Do not add generated status, timestamps, ids, checkpoint fields, or
  invocation metadata to the examples.

## 3. Frozen surfaces that must remain untouched

### CLI JSON and help

- [ ] `InspectSummaryJson` remains exactly the existing four-key
  `INSPECT_SUMMARY` view (`type`, `runId`, `status`, `requiredEvidence`) in
  name, type, and meaning. Do not reuse it for list output or add inventory
  fields to it.
- [ ] `INSPECT_SUMMARY` remains outside `EVENT_TYPES` and `validateEvent`;
  `inspect --json` remains pure event NDJSON and `--summary-json` remains one
  non-event object.
- [ ] `DoctorJsonReport` remains frozen-additive and unchanged by these
  commands: top-level keys, check names/order, `locks`, `runStates`, and
  `learnedState` shapes all stay as shipped. Do not add list results or a new
  doctor check.
- [ ] Doctor's `DoctorInFlightRunStatus` remains
  `"PLANNING" | "RUNNING"`, and its inventory filter remains exactly those two
  statuses. COMPLETED and every other status stay absent even though `list`
  shows them.
- [ ] Preserve `GENERIC_FAILURE_NEXT` and all five `DOCTOR_ROUTED_NEXT`
  key/rendering tuples character-for-character. A new command does not justify
  a sixth doctor route.

### Domain, replay, and persistence

- [ ] Do not add `RUN_LIST`, validation, initialization, “listed,” “watched,”
  or “stale” event types. No new command needs to persist an event.
- [ ] Do not add or rename a `RunStatus`; the eight-member union and the
  COMPLETED/FAILED/BLOCKED terminal replay set remain exact.
- [ ] Do not change replay transitions or make a view command transition a run
  or episode.
- [ ] Add no checkpoint field. In particular, do not persist inventory,
  validation, initialization, executor configuration, or list cursor data.
- [ ] Leave checkpoint `contract`, `taskCriteria`, and `taskCostCeilings`
  semantics untouched: optional at schema version 1, absence means unknown,
  never synthesized, and the two per-task records remain monotone
  first-write-wins.
- [ ] Leave `EventStore.append` and `CheckpointStore.write` unlocked. These
  commands are not a reason to revisit the measured per-step lock decision.
- [ ] Leave the eleven crash-probe case names and order unchanged.
- [ ] Leave targeted `steerText` unchanged: no second kernel registry and no
  broadcast/follow mechanism.
- [ ] Leave `PrescoreInput.independentEvidence` with exactly its one `void`
  discard reader. Inventory/validation must not reinterpret it as
  corroboration.

### Live/adaptation/privacy boundary

- [ ] Remember that every module statically imported by `src/cli/main.ts` joins
  the transitive live import closure even when its switch case is not selected.
  New command modules must not import R1, shadow, holdout, bandit-selection, or
  topology code.
- [ ] Keep `selectArm` shadow-only and `planTaskTopology` parked. Do not widen
  the two-entry live-isolation allowlist or give the bandit module a new live
  importer. Doctor remains the sole signed-off diagnostic learned-state reader.
- [ ] Do not call `createExecutor` from any new command. The source pin expects
  exactly four builders in `main.ts` (run two, resume two), each with the
  invocation sink.
- [ ] Do not touch `invocations.jsonl`, catalog observations, bandit state,
  preferences, feedback, adaptation candidates, or promotion. If a future
  feature crosses an adaptation import, it requires the existing privacy
  guards and a separate decision.

## 4. USAGE/help consumer census

There is no character-exact full-help snapshot at this base. An additive,
well-placed command line should leave existing tests green. The following
tests consume specific USAGE fragments and will go red if an edit deletes,
rewraps, or changes their pinned fragment:

- [ ] `test/integration/cli/commands.test.ts` — exact full
  `adapt promote --candidate ... --approve [--eval-file ...]` substring.
- [ ] `test/integration/cli/migrate-legacy.test.ts` — migrate-legacy syntax.
- [ ] `test/integration/cli/unblock.test.ts` — both complete two-space-indented
  unblock lines plus the “ends a BLOCKED run”/“executes nothing” prose.
- [ ] `test/integration/m4/preferences-cli.test.ts` — the
  `pref list|correct|export|delete` fragment.
- [ ] `test/unit/cli/thinking-flag.test.ts` — `--thinking`, precedence prose,
  the exact seven levels parsed across line wrapping, and the Google clamp
  warning.
- [ ] `test/unit/cli/resume-executor-config.test.ts` — resume model/thinking
  flags and the exact `executor configuration is\nnot recorded` wrap.
- [ ] `test/integration/cli/cli.test.ts` indirectly receives USAGE on the
  unknown-command stderr path, then checks the structured error; an additive
  line is safe, but malformed output can break it.

`test/unit/pi-adapter/thinking-clamp.test.ts` does not parse help, but it is the
behavioral sentinel behind the Google clamp sentence.

Honest update rule:

- [ ] Add a command-specific help assertion to each new command's assigned
  test, checking the actual supported syntax and dispatch.
- [ ] Do not regenerate a nonexistent snapshot, weaken an old regex, or update
  an old expected string merely to hide a reflow. Restore unrelated existing
  text instead.
- [ ] Update an old help expectation only if the old command's real behavior
  intentionally changed in the same diff. That is outside these three slots
  and requires a separate decision.

## 5. “Helpful” extras that fail this gate

- [ ] No `--watch`, `--follow`, tailing, polling, streaming cursor, or daemon
  mode. `inspect --follow` is already assigned outside this work (PR #12);
  adding it here is both duplication and scope expansion.
- [ ] No synthetic stale/crashed/healthy status, inferred terminal, inferred
  episode outcome, or automatic repair.
- [ ] No invocation/cost/activity aggregation and no
  `invocations.jsonl` touch.
- [ ] No state migration, cleanup, retention, deletion, lock stealing, or
  checkpoint rebuilding.
- [ ] No executor/provider smoke test, model routing, learned recommendation,
  automatic adaptation, or candidate promotion.
- [ ] No event “for observability,” no persisted validation receipt, and no
  checkpoint field “for resume convenience.”
- [ ] No extension command or session listener, and no production or
  Outcome-supported claim.

## 6. Required verification before merge

- [ ] New tests prove `list` is read-only, deterministic, all-status, honest on
  empty/corrupt input, and exact-keyed for `RUN_LIST`.
- [ ] New tests prove `validate` writes nothing, rejects malformed inputs by
  the shared validators, and exact-key the success JSON contract.
- [ ] New tests prove `init` refuses overwrite by default, force-overwrites
  only its two targets, preserves unrelated files, and emits examples accepted
  by validation.
- [ ] Re-run the help consumers listed in §4.
- [ ] Re-run:
  - `test/unit/cli/doctor.test.ts`
  - `test/unit/cli/doctor-routed-next-freeze.test.ts`
  - `test/unit/run/inspection.test.ts`
  - `test/integration/cli/inspect-summary.test.ts`
  - `test/unit/run/terminal-replay-statuses-freeze.test.ts`
  - `test/unit/run/event-row-fuzz.test.ts`
  - `test/unit/routing/live-isolation.test.ts`
  - `test/unit/cli/invocation-sink-wiring.test.ts`
  - `test/unit/run/checkpoint-writer-carriage.test.ts`
  - `test/integration/m2.5/resume.test.ts`
  - `test/unit/tracking/independent-evidence-posture.test.ts`
  - `test/unit/package/pi-manifest.test.ts`
- [ ] Run typecheck and the repository gate after the three siblings are
  integrated. A red freeze pin is a design stop, not an expected-file update.
