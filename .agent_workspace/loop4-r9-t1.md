[Model: claude-opus-5-thinking-high-fast]

# Loop 4 · Round 9 — R9-1: the durable run contract on the flowchart checkpoint

## Outcome

`contract?: RequirementContract` is now a persisted field of
`FlowchartCheckpointState` at the unchanged `schemaVersion: 1`. A resume that
holds nothing but a run id recovers the constraints the run started under, and
the flip-pin is flipped **through the production CLI boundary**: a contract-ful
run resumed with `main(["resume", …])` reports `constraint-retention: PASS` on
the leg the log had never seen run. Absence stays valid, and nothing is ever
synthesized from the episode — a run started without a contract still reports
`NOT_APPLICABLE`, pinned.

One consumer the design census had not named turned up and is fixed in the same
diff: **`unblockLockedFlowchartRun` rebuilds the flowchart payload from parts**
(`{ definition, snapshot: reopened, limits }`) rather than from the loop
context, so it was the one writer that would have dropped the contract with
every restorer still correct. See §4.

## 1. Census first (working tree, 2026-08-24 22:29 UTC, HEAD `54d3131`)

Verified against the working tree, not the reports:

1. `src/run/replay.ts` had zero `contract` occurrences; `FlowchartCheckpointState`
   was exactly `{ definition, snapshot, limits }`.
2. `persistCheckpoint` built the payload from `ctx.definition` /
   `supervisor.snapshot()` / `ctx.flowchartLimits` only, though
   `FlowchartLoopContext` already carried `contract?`.
3. `restoreFlowchartSession` (shared by `pauseFlowchartRun` and
   `injectFlowchartRun`) restored definition/snapshot/limits only.
4. `resumeLockedFlowchartRun` honoured `continuation.contract` and nothing else.
5. `flowchartContinuation` accepted `checkpoint?: RunCheckpoint` and projected
   no contract; both `resumeCommand` and `answerCommand` feed it the checkpoint.
6. `src/run/checkpoint-store.ts` is a generic crash-atomic JSON byte store — no
   schema-specific change needed, confirmed.
7. **New, not in R8-2 §4:** `unblockLockedFlowchartRun` is a third flowchart
   checkpoint writer, and the only one that materializes the payload literally.
8. Complete `materializeCheckpoint` census: 9 call sites; only the two in
   `flowchart-run.ts` pass a flowchart payload. `coordinator.ts` (×2),
   `supervisor.ts` (×3), `track/loop.ts`, and `main.ts`'s non-flowchart resume
   branch all pass none, and that branch is guarded by
   `requireDurableFlowchartCheckpoint`.
9. Readers that tolerate the additive field, re-verified: `src/cli/commits.ts`
   (`checkpoint.flowchart?.definition.nodes`), `src/tools/decision-commit.ts`
   (`snapshot` + `definition`).

Concurrent slots were visible in the shared tree throughout (R9-2's
`pi-executor.ts` + `option-a-preconditions.test.ts`, R9-4's `docs/**`, R9-5's
`crash-probe.mjs`, R9-6's `gate-apply.ts`, R9-7's new
`doctor-routed-next-freeze.test.ts`, R9-8's `flowchart-run-abort.test.ts`,
R9-9's `live-isolation.test.ts`). None were edited here.

## 2. Implementation

### `src/run/replay.ts`

- `contract?: RequirementContract` on `FlowchartCheckpointState`, with the
  never-synthesize reason stated on the field and the **reserved** note that
  per-task acceptance criteria may ride the same seam later (R8-4 §5.3) —
  prose only, no field.
- `validateFlowchartCheckpointState` runs `validateRequirementContract` when
  the field is present and wraps failures as
  `Invalid RunCheckpoint: flowchart.contract: …`; absence returns the exact
  three-key object it always did, so no empty contract is invented.

### `src/run/flowchart-run.ts`

- `persistCheckpoint` writes `ctx.contract` when defined — every checkpoint,
  not just the pre-loop one.
- `restoreFlowchartSession` restores `checkpoint.flowchart.contract` into the
  context, so pause/inject cannot strip it on their next write.
- `resumeLockedFlowchartRun`: `continuation.contract ?? checkpoint.flowchart.contract`.
- `unblockLockedFlowchartRun` carries the contract onto the reopened
  checkpoint (§4).

### `src/cli/main.ts`

- `flowchartContinuation` projects `opts.checkpoint?.flowchart?.contract`;
  one change, both `resumeCommand` and `answerCommand`.
- The `INSPECT_SUMMARY` producer literal now names the freeze in a three-line
  comment (four keys, additive, a fifth only alongside the
  `inspection.test.ts` pins). No behaviour, no key change.

**Never synthesized from the episode.** `episode-bind.ts` is untouched and the
pin forbidding a `contract:`/`constraints:` projection onto the episode is kept
(reframed from "currently" to the standing rule) — the reason is now
*load-bearing*, because a recovery that read constraints back from the episode
would present `[]` as the run's own.

## 3. Tests

`test/integration/m2.5/resume.test.ts` (10 → 15):

- The three R8-2 absence tripwires are **replaced by positive pins**, not
  deleted. The schema pin now requires the field, `validateRequirementContract`,
  the `flowchart.contract` error prefix, the writer, both restorers, the
  unblock writer, and the precedence expression — plus `doesNotMatch` that the
  reserved per-task-criteria field was *not* implemented, and the unchanged
  `checkpoint-store.ts` schema-agnosticism.
- **Region-regex nit fixed** (review §5 nit 1). R8-2 anchored `resumeCommand`
  on `^}\n\nconst PREFERENCE_SCOPES`, which R8-1's `unblockCommand` had slipped
  inside. Every region now ends on the function's own `^\}$`, and the pin
  asserts `doesNotMatch(/\bunblockCommand\b/)` so the boundary cannot drift
  again. Note `^\}` alone was *not* sufficient: `flowchartContinuation`'s
  parameter-object literal closes at column zero, so the old regex captured
  only the signature — which is why R8-2's `doesNotMatch(/contract/)` on that
  region passed vacuously. `^\}$` captures the whole function.
- **Flip, with disclosure.** `a resume that is handed no contract assesses its
  children against none` is replaced by `a contract-ful run resumed through the
  CLI assesses its children against it`. The disclosure is in the test's
  docstring: the old assertion was honest and is no longer true; the proof runs
  `main(["resume","--run",…,"--executor","fake","--unpause"])` and reads
  `constraint-retention: PASS` for `tsk_second` off the log, not off a return
  value, with the stored contract asserted before and after. The run is still
  *seeded* through the embedder API because **no CLI command accepts a
  contract** — that is stated in the docstring too.
- `a CLI resume of a run that started without a contract invents none` —
  both legs `NOT_APPLICABLE`, checkpoint contract still `undefined`.
- `a direct resume handed no contract recovers the run's own durable one` —
  the retired pin's exact call shape, flipped, pinning the runner-side default.
- `an explicit continuation contract outranks the run's durable one` — a
  constraint-free continuation contract yields `NOT_APPLICABLE` while the
  checkpoint's carries two, which is what makes `??` (not `||`, not the
  reverse) behaviourally load-bearing.
- `unblocking a blocked run carries its contract onto the reopened checkpoint`.
- `a pause taken between the legs does not strip the run contract` — the
  preservation assertion, through the shipped `pause` command, then a resume
  that still reports PASS.

`test/unit/supervisor/flowchart-snapshot.test.ts` (7 → 10): the valid /
malformed / absent trio. Malformed covers four shapes (empty objective,
non-array constraints, `schemaVersion: 2`, non-object) each matched against the
full `flowchart.contract: …` prefix; absent asserts `"contract" in … === false`
so the validator invents nothing.

`test/unit/persist/row-fuzz.test.ts` (5 tests, unchanged count): a
contract-bearing flowchart checkpoint joins `CHECKPOINT_SEED` as
`CHECKPOINT_SEEDS`, cycled the way the episode and feedback arms already cycle
theirs. Both seeds are asserted valid before mutation, and the arm now ends
with `contractsMutated > 0` — R8-2's complaint was that the sole seed could
never reach the field, so the arm proves it is no longer vacuous rather than
assuming it.

## 4. Finding: the unblock was a silent contract-dropper

`unblockLockedFlowchartRun` does not go through `persistCheckpoint`. It
materializes `{ definition, snapshot: reopened, limits }` directly, so with the
writer and both restorers correct, an operator authorizing a blocked run would
still have erased the contract from it — and the next resume would have
assessed the reopened work against nothing while reporting success. It now
destructures `contract` off the validated checkpoint and carries it forward,
pinned in source and behaviourally (BLOCKED stall run with a contract →
`unblockFlowchartRun` → contract still on the checkpoint). This is preservation
only: `RUN_UNBLOCKED`'s payload is untouched and stays exact-key frozen.

## 5. Disclosures

1. **The CLI projection is behaviourally redundant with the runner-side
   default, deliberately.** Both were signed off. Mutation-checked: removing
   the `flowchartContinuation` projection alone leaves every behavioural test
   green (the `??` fallback covers the CLI), and removing the `??` fallback
   alone also leaves them green (the projection covers the CLI). Each is
   source-pinned; the pair is defence in depth — the projection makes the
   recovery explicit at the boundary an operator uses, the default covers every
   embedder that resumes by run id alone. Neither is dead code, but neither is
   individually load-bearing for the CLI, and a future slot removing one should
   know that only the source pin will notice.
2. **The seeding is API-side.** No CLI command accepts a contract, so the
   contract-ful run in the flip test is started via `startFlowchartRun`.
   Everything after the seed — argv, the CLI's calibrated router, its file
   pause controller, its executor, its checkpoint read — is the shipped path.
3. **`validateCheckpoint` still returns the raw value**, as before, so an extra
   key inside a persisted contract survives the round trip even though
   `validateRequirementContract` reconstructs a clean object. This is unchanged
   behaviour for `definition`/`snapshot`/`limits` and was not widened.
4. **`row-fuzz`'s checkpoint arm now splits its 240 iterations across two
   seeds**, so the original non-flowchart seed gets 120 rather than 240. This
   is the file's existing idiom (episode and feedback arms cycle); the
   alternative was a sixth test. Total runtime of the arm went 77 ms → ~120 ms.

## 6. Verification (this VM, Node v22.14.0)

- Baseline of the three owned suites before editing: **22/22 pass, 0 skipped**.
  Final: **30/30 pass, 0 skipped**, three consecutive runs, identical. Delta
  **+8** (resume +5, flowchart-snapshot +3, row-fuzz +0). **No new skip.**
- Consumer sweep, one run over `test/unit/run/`, `test/unit/supervisor/`,
  `test/unit/cli/`, `test/unit/persist/`, `test/unit/tracking/`,
  `test/unit/routing/live-isolation.test.ts`, `test/integration/cli/`,
  `test/integration/run/`, `test/integration/m2/`, `test/integration/m2.5/`,
  `test/integration/pi-adapter/loopback-cli-resume.test.ts`: **666/666 pass, 0
  skipped**. That set contains R8-3's `applyRetry` AST pin, R9-7's five-route
  freeze, R9-8's reconstruction pin, R9-9's isolation pins, the loopback
  supervised resume stderr pin, the four-line BLOCKED block, `unblock-flow`,
  `cli/unblock`, `event-row-fuzz` and `inspection`'s `INSPECT_SUMMARY` pins —
  all green.
- `live-isolation.test.ts` run explicitly (9/9): `replay.ts` gained an import of
  `src/domain/contract.js`, which is inside the live closure and already
  reachable through `flowchart-run.ts`; it is on no watchlist and the allowlist
  is unchanged.
- Scoped `pnpm exec eslint` over the six owned files: pass.
- Whole-tree `pnpm exec tsc --noEmit`: pass (twice; also after the unblock fix).
- Full gate not run, per instruction.

### Mutation checks (each reverted immediately)

| Removed | Result |
|---|---|
| `persistCheckpoint`'s contract write | 3 red (schema pin, CLI flip, pause preservation) |
| `restoreFlowchartSession`'s restore | 2 red (schema pin, pause preservation) |
| `continuation.contract ?? checkpoint.flowchart.contract` fallback | 1 red (schema pin) |
| Precedence inverted to `checkpoint.flowchart.contract ?? continuation.contract` | 2 red (schema pin, precedence pin) |
| `flowchartContinuation`'s projection | 1 red (CLI pin) |
| The unblock's carry-forward | 2 red (schema pin, unblock pin) |

## 7. Scope

Changed: `src/run/replay.ts`, `src/run/flowchart-run.ts`, `src/cli/main.ts`,
`test/integration/m2.5/resume.test.ts`,
`test/unit/supervisor/flowchart-snapshot.test.ts`,
`test/unit/persist/row-fuzz.test.ts`, and this report. No scratch files (the
three `/tmp` mutation backups were removed; the `/tmp/*.bak` files still on the
VM belong to other slots). No commits, pushes, branch changes, `package.json`,
dependency, ADR, docs, or live-routing edits. `RUN_UNBLOCKED`'s payload,
`TERMINAL_REPLAY_STATUSES`, `DOCTOR_ROUTED_NEXT`, `GENERIC_FAILURE_NEXT`, the
four-line BLOCKED block, `loopback-cli-resume.test.ts`, `childTasksFromLog`,
`recordCrashTerminal` and `scheduler.ts` are all untouched. Option (a)'s
per-task criteria field is reserved in prose only.
