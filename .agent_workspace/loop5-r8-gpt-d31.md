# Loop 5 · Round 8 · D31 landing recheck

## Verdict — KEEP

The landing at `origin/cursor/pause-inject-value-preflight-0da8` (`ea44cb9`) matches
Fable Rank 1 and the GPT-r8 D31 KEEP contract.

## Contract review

- The code uses the domain-exported `isRunId` for both verbs and refuses malformed
  `--run` values at `stage: "parse-args"` before `parseRunId` or state I/O.
- Blank `--reason`, `--key`, `--node`, and `--actor` values are refused at
  `stage: "parse-args"` with the specified messages, next actions, and raw `runId`.
  The `--node` check keys on the supplied flag, including for `fact`.
- Pause preserves the existing `--clear` plus `--reason` refusal ahead of the new
  blank-reason check.
- Inject preserves D30 precedence: kind, required per-kind values, and confidence
  validation all remain ahead of the blank-value and run-ID guards. Live malformed-run
  probes still returned the unchanged D30 `--type` and `--confidence` refusals first.
- No catch was added or widened. The existing lexical `parseArgs` catches are unchanged;
  lookup and plane failures retain their prior handling.
- Valid-format missing IDs still reach `stage: "lookup"`; the focused suite's existing
  pause and inject lookup pins passed, and a live `run_missing0001` probe returned lookup.
- The D30 refusal strings and confidence boundary paths are untouched. The diff changes
  only `src/cli/pause.ts`, `src/cli/inject.ts`,
  `test/integration/cli/pause-inject.test.ts`, and the implementer report. It contains no
  plane or `main.ts` edit.

## Verification

From a detached worktree of the D31 branch:

`npx tsx --test test/integration/cli/pause-inject.test.ts`

passed **27/27**.

Live probes confirmed exit 1 and the expected parse-args reports for malformed pause and
inject `--run`, blank `--reason`, `--key`, `--node`, and `--actor`. The common nonexistent
state root remained absent, confirming these refusal paths performed no state write.

No correction is required.
