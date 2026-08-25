# Loop 5 Round 1 — GPT challenge

## Verdict

| Bet | Verdict | Reason |
|---|---|---|
| `list` | **KEEP** | There is no untargeted run/episode discovery surface. Doctor and inspect are not substitutes. |
| `validate` | **KEEP, conditional on one shared parser path** | `run` fails closed on invalid input, but a valid-input check necessarily proceeds into a run. The no-write stopping point is genuinely missing. |
| `init` | **REPLACE** | The example gap is real; a mutating CLI scaffold is padding. Ship static examples and spend the command slot on a higher-value runtime correctness gap. |

## 1. `list`: missing, not covered by doctor/inspect

`doctor` deliberately inventories only crash candidates. `runStateInventory` walks run directories, replays each log, then drops every status except `PLANNING` and `RUNNING` (`src/cli/doctor.ts:370-416`, especially 397-398). It never scans `runtime/episodes`. This is the right preflight behavior and should remain unchanged.

`inspect` is strictly keyed: it rejects an invocation without `--run` or `--episode` (`src/cli/main.ts:1120-1166`), and `inspectRun` opens exactly one `EventStore` for the supplied run id (`src/run/inspection.ts:93-98`). Therefore an operator who has lost the id cannot reach inspect, resume, pause, or delete.

So `list` is a real missing primitive. Keep it separate from doctor and inspection:

- enumerate `runtime/runs/<runId>/events.jsonl` and `runtime/episodes/<epId>.jsonl`;
- replay all eight existing `RunStatus` values rather than introducing a ninth;
- use the latest validated episode snapshot;
- report truncated-tail recovery and per-entry scan/read errors explicitly instead of silently omitting damaged records or changing doctor semantics.

ADR-002 anticipated exactly this query boundary: JSONL is adequate, with SQLite deferred until “run listing, concurrent writers, or cross-run analytics require indexed queries” (`docs/decisions/0002-event-log-and-checkpoints.md:21-27`). A filesystem inventory is appropriate now; an index/database is not.

## 2. `validate`: not redundant with fail-closed `run`

The existing execution paths do validate before creating a run:

- flowchart: `parseFlowchartFile` calls `validateFlowchart` and catalog validation (`src/cli/flowchart-io.ts:23-29`); `runCommand` does that at `src/cli/main.ts:782-787`, before `startFlowchartRun` at 804;
- children: `parseChildSpec` is called at `src/cli/main.ts:949-959`, then `compileChildrenToFlowchart` at 974-989, before `startFlowchartRun` at 990.

That proves invalid input does not create a run. It does **not** provide a validation workflow: when input is valid there is no success stop, so the command proceeds into state creation and execution/stall. `run` also requires irrelevant `--project` and `--objective` arguments. A dedicated no-write success path is useful for editors and CI.

The condition is important: children parsing currently lives as private `parseChildSpec` in `src/cli/main.ts:378-449`, while the flowchart parser is already exported. A second children decoder in `validate.ts` would immediately create two schema languages. Extract the children parser once and make both `run` and `validate` call it; otherwise **KILL** the children half rather than claiming parity. Validation output should distinguish:

1. structural/schema validity; and
2. catalog compatibility when a state root/catalog is supplied.

Only an explicit machine mode should be frozen additive. Human success prose should not become a frozen JSON contract by accident.

## 3. `init`: command is padding; examples are not

README already contains a complete-enough children JSON specimen and invocation (`README.md:97-136`). The actual documentation hole is flowchart JSON: the flowchart section invokes `flow.json` but never shows its shape (`README.md:140-152`). There is currently no `examples/` directory.

Static, versioned `examples/children.json` and `examples/flowchart.json`, linked from README, close that hole more directly. Every checkout already contains them, diffs show when the schema changes, and no overwrite/path/`--force` contract is needed. A private developer-preview repository does not gain meaningful capability from copying those same bytes through `pi-sparkle init`.

**Replacement:** ship the two static examples, but do not add an `init` verb.

## 4. Higher-value feature missed: durable resume executor configuration

The code already documents a correctness gap larger than scaffolding: model and thinking configuration are not recorded. `describeResumeExecutorConfig` says resume can rebuild on defaults and tells the operator to re-pass flags (`src/cli/main.ts:1258-1305`); README repeats that limitation (`README.md:318-322`). Consequently a resumed run can silently change model channel and reasoning effort, affecting behavior and cost. The warning is honest, but it is not restoration.

Use the displaced `init` slot for a design/implementation that durably records the non-secret effective executor configuration (`kind`, resolved provider/model reference, thinking level) and lets resume restore it, with explicit flags as audited overrides. Do not persist API keys. This needs an additive event/checkpoint design review, so if Round 1 must remain low-risk, record it as the next feature rather than padding the round with `init`.

## 5. Frozen contracts and PR #12

There is no necessary frozen-contract collision for `list` or `validate` if they stay isolated:

- do not add fields to the four-key `INSPECT_SUMMARY` or route list through `src/run/inspection.ts`;
- do not widen doctor’s `PLANNING`/`RUNNING` inventory;
- do not add a `RunStatus`;
- keep any `RUN_LIST` / validation machine object outside the domain event union, with a minimal documented additive shape.

There **is** a concrete integration collision with open [PR #12](https://github.com/Xhhemoing/pi-sparkle/pull/12). This branch is based on `origin/main` `80eb0bd`; PR #12 also targets `main` and changes `src/cli/main.ts`, `src/run/inspection.ts`, README, and tests for `--max-cost-usd` and `inspect --follow`. All three proposed verbs edit the same `main.ts` import/USAGE/switch regions. PR #12 also adds `readme-command-parity.test.ts`, which requires every dispatched verb to appear both in exported `USAGE` and the README command table. D4’s “one USAGE line” allowance is therefore insufficient after PR #12 unless the parent also adds the corresponding README row.

Integration order should be: land/rebase onto PR #12’s result, then reapply the new imports, USAGE lines, switch cases, and README rows while preserving `--max-cost-usd`, `inspect --follow`, `USAGE` export, and the parity test. `list` must not resolve the conflict by editing PR #12’s expanded inspection model.
