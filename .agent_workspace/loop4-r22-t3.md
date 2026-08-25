MODEL_SLUG: claude-opus-5-thinking-high-fast

# Loop 4 · Round 22 · slot R22-3 — CLI `--max-cost-usd` + `onCostGate` stderr

Contract: `ROUND22-BRIEF.md` §4 R22-3 (parent sign-offs 2 + 4). Audit evidence: P3 + P4.
Branch `cursor/opt-r22-42b1`, working tree at `8f11e5c` (R22-2 landed; `FlowchartRunInput.maxCostUsd`
verified present at `src/run/flowchart-run.ts:159`). **Nothing committed by this slot; no branch
change; `PROGRESS.md` untouched.**

## 1. Census first (working tree, before any edit)

| Handed path | Verified at | Fact |
|---|---|---|
| `src/cli/main.ts:1058` plain `startRun` | now `:1153` | was `startRun({ stateRoot, executor }, { projectRoot, objective })`, no `limits` |
| `src/cli/main.ts:990-1012` `--children` `startFlowchartRun` | now `:1090-1108` | input was `{ projectRoot, flowchart, objective, childTasks, assignments }` |
| `runCommand` `parseArgs` options | `:711-727` | 12 options, no `max-cost-usd` — matches audit P4's `Unknown option` |
| `createExecutor` `hooks` | `:175` | one member, `onInvocation` only; `rg onCostGate src/cli/` empty (audit P3) |
| `createConfiguredPiExecutor` input | `runtime.ts:29-41` | no `onCostGate` member — the TS2353 the audit transcribed |
| `PiExecutorOptions.onCostGate` | `pi-executor.ts:110` | already exists; emitters at `:781` (stopped) and `:852` (disarmed) |
| `CostGateEvent` union | `pi-executor.ts:114-126` | two arms, `disarmed` carries `CostGateDisarmedReason` (three values) |
| `FlowchartRunInput.maxCostUsd` | `flowchart-run.ts:159` | R22-2's field, validated pre-lock `:1371-1376`, stamped `:1435` |
| `StartRunInput.limits` | `coordinator.ts:119` | whole `RunLimits` or nothing → the cap must ride a full `defaultRunLimits()` spread |
| `costCapFor` | `child-coordinator.ts:413-418` | `Math.min` of per-task and run-level; stamped at `:436` (child `RUN_CREATED`) and `:669` (request) |
| `defaultRunLimits` in `main.ts` | — | **not** imported; added (`../domain/limits.js`) |
| `docs/status-matrix.md` | rows 32 / 34 / 38 | present, edited as specified |
| `test/helpers/loopback-openai-provider.ts` | — | present; hosts the P3 vehicle (no fallback needed) |

Ownership respected: no edit to `docs/kernel-reuse.md` or the skill reference (R22-1), and none to
`src/run/flowchart-run.ts`, `test/integration/m2.5/flowchart-run-cap.test.ts`,
`docs/specs/m0-m2-architecture.md`, `docs/data-dictionary.md` (R22-2). No edit to `pi-executor.ts`,
`cost-gate.ts`, `contract.ts`; no CostGate arithmetic change; no new `ExecutionEvent` type; no new
durable cost-gate record; `FlowchartRunLimits` untouched; no cross-child ledger; `remainingCostUsd`
never referenced.

## 2. What landed in the working tree

`src/cli/main.ts` (+119/−16), `src/pi-adapter/runtime.ts` (+10/−1),
`docs/status-matrix.md` (+3/−3), `test/integration/m1/cli-children.test.ts` (+129),
new `test/unit/cli/cost-flag.test.ts`, `test/integration/cli/run-cost-cap.test.ts`,
`test/integration/pi-adapter/costgate-cli-warning.test.ts`.

1. **Flag.** `"max-cost-usd": { type: "string" }` on `run`. New exported
   `parseRunCostCeiling(raw: string | undefined): number | undefined`: `undefined` stays
   `undefined`; accepted spelling `/^\d+(\.\d+)?$/` then finite and `> 0`; anything else throws
   `DomainValidationError` with the frozen
   `--max-cost-usd must be a positive finite number of US dollars, got: <raw>`.
2. **Plain path.** `startRun({ stateRoot, executor }, { projectRoot, objective, ...(maxCostUsd !==
   undefined ? { limits: { ...defaultRunLimits(), maxCostUsd } } : {}) })`. The whole limits block,
   because `StartRunInput.limits` is all-or-nothing — a lone `maxCostUsd` would drop `maxRounds`,
   `maxTasks`, `maxConcurrentTasks`. Absent flag ⇒ the same two-key input object as before.
3. **`--children`.** `...(maxCostUsd !== undefined ? { maxCostUsd } : {})` on the
   `startFlowchartRun` input, R22-2's field. Cap-free spec + run cap ⇒ the child's `RUN_CREATED`
   carries it and `TASK_REQUEST.limits` does not.
4. **`--flowchart` / `--track`.** `cliFail` at `stage: "parse-args"`, placed with the other
   flag-combination refusals and therefore ahead of the flowchart file read, the catalog build and
   the state root. Frozen message and next-line exactly as briefed.
5. **Resume.** No new flag. `resumeCommand` gains only the warning sink, because the work a resume
   re-drives can carry a cap from a durable record (R22-2's replayed `RUN_CREATED`, or a logged
   `TASK_REQUEST`), so the same silence is reachable there.
6. **`onCostGate`.** `createConfiguredPiExecutor` input gains
   `readonly onCostGate?: (event: CostGateEvent) => void`, conditionally spread exactly like
   `onInvocation`. `createExecutor`'s `hooks` gains `onCostGate`, forwarded on the `pi` arm only —
   the fakes have no gate, so wiring them would promise a warning that can never fire. All four
   executor builds (2 in `runCommand`, 2 in `resumeCommand`) hand it `reportCostGate`, which writes
   `formatCostGateWarning(event)` to stderr when the formatter returns a string.
7. **Frozen wording.** New exported `formatCostGateWarning(event): string | undefined`.
   `unpriced-model` and `invalid-cap` produce the two briefed lines verbatim (assembled by `+`
   concatenation for line length; the byte-pins in the unit test assert the single joined string).
   `no-cap` and `stopped` return `undefined` — the `switch` is exhaustive over
   `CostGateDisarmedReason` with no `default`, so a fourth reason would fail typecheck rather than
   fall through to silence.
8. **USAGE.** `[--max-cost-usd <usd>]` on the run line that covers both the plain and `--children`
   forms, plus the prose paragraph: per-run USD ceiling forwarded to the executor's cost gate and
   stamped on `RUN_CREATED.limits`; tighter-of on `--children`; unpriced model says so on stderr;
   **"There is no cross-child spend ledger: N children under a $X run cap can spend up to N times
   $X between them."**; refused on `--flowchart` and `--track`. One adjacent reflow: `--children
   runs the / parent as a coordinator over the child tasks in / the spec file` was re-wrapped to
   two lines because my insertion left `--children runs the` stranded alone. No test or doc pins
   that string (`rg "parent as a coordinator over the child"` → `src/cli/main.ts` only).
10. **`docs/status-matrix.md`.** Row 32: the flag, the refused spellings with the frozen message,
    stamped-on-`RUN_CREATED` vs absent key, the parse-args refusal on `--flowchart`/`--track`, the
    single frozen disarmed warning line, and that a real stop prints nothing / there is no cost-gate
    `ExecutionEvent` / `resume` gains no flag. Row 34: recorded-and-forwarded, **not** enforced by
    the child fake; never in `TASK_REQUEST.limits` or `taskCostCeilings`; no cross-child ledger.
    Row 38: `a declared ceiling` → `a declared per-task ceiling` (one-word disambiguation inside my
    own row), and the run-level ceiling named as a separate durable source replayed from the run's
    own `RUN_CREATED.limits.maxCostUsd`, restored not invented, unreachable from a flag or a
    continuation input. This is the same distinction R22-2 made in `docs/data-dictionary.md:160-169`.

## 3. Tests (all run 3×, `/tmp/tsx-*` cleared before every run)

Eleven new test names, all present in TAP, three identical runs at the final tree state
(`25 tests / 25 pass / 0 fail / 0 skipped`, name sets byte-identical across runs):

- `test/unit/cli/cost-flag.test.ts` (6): omitted flag → `undefined`; accept table
  (`5`, `0.5`, `0.01`, `0.000001`, `10.25`, `100`, `007`); refuse table with the frozen message
  byte-compared for `0`, `0.0`, `-1`, `-0.5`, `1e4`, `1E4`, `0x10`, ` 5 `, `5 `, `+5`, `.5`, `5.`,
  `1_000`, `abc`, `NaN`, `Infinity`, `$5`, `5usd`, `""`; both disarmed wordings byte-pinned as whole
  strings; `no-cap` and `stopped` → `undefined`.
- `test/integration/cli/run-cost-cap.test.ts` (5): `--max-cost-usd 0.5` → `RUN_CREATED.limits
  .maxCostUsd === 0.5` on disk; flag absent → `"maxCostUsd" in limits === false` (the byte-level
  control); seven invalid spellings each refused with the frozen message, empty stdout, and **no
  `runtime/runs/` directory at all**; `--flowchart` and `--track` each refused with the frozen
  message *and* `next:` at `stage: "parse-args"` with no run directory (the `--flowchart` case
  points at a nonexistent spec file, so "before any work" is what the assertion actually shows);
  USAGE pins for the flag position and the four prose claims.
- `test/integration/m1/cli-children.test.ts` (2 added, 10 existing untouched and green): cap-free
  spec + `--max-cost-usd 0.5` → child `RUN_CREATED.limits.maxCostUsd === 0.5`, flowchart run's own
  `RUN_CREATED.limits.maxCostUsd === 0.5`, and `TASK_REQUEST.limits` has **no** `maxCostUsd` key;
  spec declaring `0.1` under run `0.5` → effective `0.1` on the child `RUN_CREATED` and the
  declared `0.1` still on the request. The R18-2 pins at `:84-169` were not edited.
- `test/integration/pi-adapter/costgate-cli-warning.test.ts` (2): the brief's **primary** vehicle,
  not the fallback — the loopback harness hosts it. A custom provider declared with no
  `inputCostPerMTok`/`outputCostPerMTok` is unpriced by construction (`buildCustomProvider`
  zero-fills, `catalogPrices` reads a zero pair as no-price). `run --executor pi --max-cost-usd
  0.01` prints **exactly one** stderr line, byte-compared against the frozen text with the taskId
  read from the run's own `RUN_CREATED.rootTaskId`, exits `0` by the run's own outcome, and makes
  exactly one provider call — proving `main → createExecutor → createConfiguredPiExecutor →
  PiAgentExecutor → stderr` end to end. Control: the same run without the flag emits empty stderr,
  so the warning fires because a ceiling was requested and could not be armed, not because the
  model is unpriced.

## 4. Verification

- **Whole-tree `tsc --noEmit`: exit 0.** Scoped `eslint` over all six touched/new files: exit 0.
- **Full suite (`node scripts/run-tests.mjs test`) on this tree: exit 0 —
  2065 tests / 2064 pass / 0 fail / 0 cancelled / 1 skipped / 120 suites**, the one `# SKIP` being
  `PI_SMOKE`. (Round 22 baseline was 2050/2049 at `63a4443`; R22-2 added 4 and this slot adds 11.)
- Neighbour sweep `test/unit/cli test/integration/cli test/integration/m1
  test/integration/pi-adapter`: 296 tests, 295 pass, 1 skip, 0 fail — including
  `loopback-cli-resume.test.ts`, whose two byte-pinned resume-disclosure stderr assertions stay
  exact (its loopback models are priced, so no cost-gate line can appear), and
  `invocation-sink-wiring` / `resume-executor-config` / `thinking-flag`.
- `node scripts/kernel-reuse-probe.mjs`: **3 PASS, exit 0.**
- `node scripts/crash-probe.mjs`: **`ok: true`, 11 cases × 3 iterations**, order unchanged,
  `unblock-discard-append-before-checkpoint-sigkill` last.
- No perf claim is made this round.

### Mutation proof (out-of-tree, full copy with `node_modules` symlinked, deleted afterwards)

Twelve mutants, each applied to a copy and reverted; `/tmp/tsx-*` cleared before each. **All twelve
killed** — no survivors:

| Mutant | Killed by |
|---|---|
| M1 drop the plain-decimal spelling rule (`Number(raw)`) | unit refuse table + CLI refusal test |
| M2 accept `0` and negatives (drop `<= 0`) | unit refuse table + CLI refusal test |
| M3 invent a cap for an absent flag | unit `undefined` arm + the absent-key control |
| M4 soften the unpriced-model wording | unit byte-pin + the loopback stderr pin |
| M5 print a line for a real ceiling stop | unit `stopped → undefined` |
| M6 delete the `--flowchart`/`--track` refusal | the refusal test |
| M7 plain path drops the cap | `RUN_CREATED` record test + loopback warning test |
| M8 plain path stamps a default cap when none was asked | the absent-key control |
| M9 `--children` drops the cap | the cap-free-spec children test |
| M10 `--children` copies the run cap into each child's `limits` | both new children tests (the invented `TASK_REQUEST` budget, and the tighter-of arm) |
| M11 `createConfiguredPiExecutor` swallows `onCostGate` | the loopback warning test |
| M12 `createExecutor` stops forwarding `onCostGate` | the loopback warning test |

M8 and M10 are the honesty mutants: they are the two ways this diff could have invented a cap
nobody declared, and each is caught by an absent-key assertion rather than by a value assertion.

## 5. Scratch and hygiene

Out-of-tree copy `/tmp/r22t3-mut` deleted (its `node_modules` was a symlink, never copied). All
`/tmp/tsx-*` caches, `/tmp/r22t3-*` transcripts, and the 153 `/tmp/pi-sparkle-*` suite state roots
the full-suite run left behind are removed. `git status --short` at report time is exactly the
seven intended paths (4 modified, 3 untracked) plus this report. Nothing committed, no branch
change, no `PROGRESS.md` tick.

## 6. For the parent (not acted on)

- `README.md:159` summarizes `run` flags as
  `(--children, --flowchart, --track, --executor, --thinking, --state-root)`. It is already a
  partial list (it omits `--public-prior`, `--require-public-prior`, `--results`,
  `--primary-model`, `--fast-model`, `--assume-defaults`, `--answers`), so this landing does not
  make it false — but it is now one flag further from complete. `README.md` is not in this slot's
  ownership and was not touched.
- Node's own `parseArgs` refuses a bare dash-leading value (`--max-cost-usd -1`) with
  `Option '--max-cost-usd' argument is ambiguous.` before this CLI's parser runs; it is still a
  loud exit-1 refusal that writes nothing, and it names the `--max-cost-usd=-XYZ` spelling. The
  refusal test therefore exercises `-1` through the `=` form and documents why in place. Every
  other `run` string option has the same property today, so this is inherited behaviour, not a
  seam this landing opened.
- Both `formatCostGateWarning` handlers are defined identically in `runCommand` and
  `resumeCommand` (four lines each) rather than hoisted, matching how `invocationSink` is already
  built twice with the same body. Hoisting would need an `io` parameter and buys nothing; recorded
  in case a later slot prefers the shared helper.
