# Loop 5 · Round 8 · D31 — `pause`/`inject` argv value preflight (Opus-d31-pause-inject)

Slot: Rank 1 implementer. Branch `cursor/pause-inject-value-preflight-0da8`, based on
`origin/cursor/pi-sparkle-sota-opt-0da8` at `09305ae` (`docs(agent): record D31–D33; open Round 8`).
Spec: `.agent_workspace/loop5-r8-fable-next.md` Rank 1, implemented as written.

## Files changed

- `src/cli/pause.ts` — blank `--reason` guard; malformed `--run` guard; `isRunId` import.
- `src/cli/inject.ts` — blank `--key`/`--node`/`--actor` guards; malformed `--run` guard;
  `isRunId` import.
- `test/integration/cli/pause-inject.test.ts` — eight new tests (27 total, all green).
- `.agent_workspace/loop5-r8-opus-d31.md` — this report.

Nothing else. `main.ts`, `src/run/injection.ts`, `src/run/pause-controller.ts`,
`src/run/flowchart-run.ts`, `package.json`, and doctor are untouched; the two plane files were read
for wording only.

## Exact contracts

All five refusals are `cliFail` with `stage: "parse-args"` and carry `runId: values.run` (the raw
operator string, per D30's precedent), exit 1, stdout empty.

| trigger | `command` | `message` | `next` |
| --- | --- | --- | --- |
| `!isRunId(values.run)` | `pause` / `inject` | `invalid --run "<raw>": expected a run id of the form run_<suffix>` | `pass --run <runId> as printed by pnpm cli list --state-root <stateRoot>` |
| `--reason` supplied, `trim() === ""` | `pause` | `invalid --reason "<raw>": pause reason must be a non-empty string` | `pass --reason <text> or omit it` |
| `--key` supplied, `trim() === ""` | `inject` | `invalid --key "<raw>": injection key must be a non-empty string` | `pass --key <name>` |
| `--node` supplied, `trim() === ""` | `inject` | `invalid --node "<raw>": injection nodeId must be a non-empty string` | `pass --node <id>` |
| `--actor` supplied, `trim() === ""` | `inject` | `invalid --actor "<raw>": injection actor must be a non-empty string` | `pass --actor <who> or omit it` |

The blank-value wording mirrors the plane's own strings (`pause-controller.ts:93`,
`injection.ts:73/80/89` with the `payload.` → `injection ` rewrite the spec names) so the CLI rule
cannot drift from the rule it front-runs. `isRunId` is imported from `domain/ids.js`, never
restated. `parseRunId` still runs afterwards for the branded type; on these paths it can no longer
throw.

### Order

- `pause.ts`: help → `parseArgs` → `--help` → `--run` required → **existing `--clear`+`--reason`
  refusal (precedence unchanged)** → blank `--reason` → `stateRoot` → `isRunId` → `parseRunId` →
  `EventStore` lookup.
- `inject.ts`: help → `parseArgs` → `--help` → `--run`/`--type` required → **existing D30 blocks
  (`INJECTION_KINDS`, per-type required flags, `--confidence`) unchanged** → blank
  `--key`/`--node`/`--actor` → `stateRoot` → `isRunId` → `parseRunId` → `EventStore` lookup.

`stateRoot` is resolved just before the `isRunId` guard because that refusal's `next` names it.
Every new guard sits ahead of all state I/O. D30's pinned precedence holds:
`inject --run banana --type banana` still reports the `--type` typo, with `runId: "banana"`.

The `--node` guard keys on the flag being supplied, not on the injection kind, so a `fact` carrying
`--node ""` is refused (a `fact` may legally carry a node id). Default `actor: "user"` when the flag
is omitted is unchanged.

## Tests added

All in `test/integration/cli/pause-inject.test.ts`, using the existing `capture`,
`parseCliErrorJson`, `readEventLines`, `startWaiting`, and `withRoots` harness:

1. `pause on a malformed --run refuses parse-args and names the flag` — whole-field pin
   (command/stage/message/next/runId) plus `assert.doesNotMatch(err, /doctor/)`.
2. `inject on a malformed --run refuses parse-args and names the flag` — same, on
   `--type fact --key k --value v`.
3. `a --type typo still outranks the malformed --run guard` — D30 precedence pin.
4. `the malformed --run guard precedes all state I/O` — `pause --run banana --state-root
   <nonexistent>`: parse-args refusal, and the directory is still absent afterwards.
5. `pause on a blank --reason refuses parse-args and writes no token` — `""` and `"  "` on the
   waiting-run fixture; `events.jsonl` line count unchanged and `pause.json` does not exist.
6. `pause --clear --reason keeps its combination refusal on a blank reason` — the pinned
   `--clear`+`--reason` message still wins over the new blank check.
7. `inject refuses a blank --key, --node, or --actor before the plane` — all three flags × `""` and
   `"  "`, whole-field pins, `events.jsonl` unchanged for each.
8. `a blank --node is refused even when the type does not require one` — `--type fact --node "  "`.

`npx tsx --test test/integration/cli/pause-inject.test.ts`: **27/27 pass** (19 pre-existing + 8
new). `pnpm typecheck` clean. `npx eslint` on the three files clean. Host Node is v22.14.0 against
engines `>=22.19.0` — pnpm prints the unsupported-engine warning only.

## Deliberately not changed

- **No catch added or widened anywhere.** The only `try` in either file is still the lexical
  `parseArgs` wrapper. Run lookup and `injectFlowchartRun`/`pauseFlowchartRun` failures keep
  `stage: "validation"` and the generic `main.ts` remedy.
- **Every D30 pin string** (`unknown --type "…"`, `invalid --confidence "…"`, their `next` values,
  the `0`/`1` boundary success path) is byte-identical. `INJECTION_KINDS` and the confidence
  conversion are untouched.
- **Existing `stage: "lookup"` pins hold**: they use valid-format missing ids
  (`run_missing0001`), which `isRunId` accepts, so the new guard does not fire on them.
- Plane call, lookup refusal, `pause --clear` messages, and both success echoes are byte-identical.
- No new JSON contract, no new Event type, no `main.ts` edit, no plane-file edit. `INSPECT_SUMMARY`
  four keys, doctor `--json`, and the eight-member `RunStatus` untouched. D7 Variant B not
  implemented. No PR #12 file touched. No Outcome-supported claim. No auth, network, or
  access-control change — operator-contract work only.
