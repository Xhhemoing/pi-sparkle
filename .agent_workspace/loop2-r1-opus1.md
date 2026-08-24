# Loop 2 Round 1 opus-1

MODEL_SLUG: claude-opus-5-thinking-high-fast

Role: surface aggregated `requiredEvidence` on inspect without breaking the
`inspect --run --json` event stream. No git commit (per slot instructions).

Exclusive writes honored: this file, `src/run/inspection.ts`,
`test/unit/run/inspection.test.ts`, and `src/cli/main.ts` inside
`inspectCommand` plus the two USAGE lines for the new flag. `onInvocation` and
the rest of `main.ts` untouched.

## Implemented

- **`src/run/inspection.ts`** — `RunInspection.requiredEvidence:
  readonly string[]`. Filled from the *latest* `STALL_DETECTED` or `RUN_BLOCKED`
  payload (last writer wins across the event scan), copied verbatim and in event
  order; `[]` when the run never stalled or blocked. No merging of superseded
  demands, no derivation from anything but those two payloads
  (`src/run/events.ts:193–197, 230–233`; producers at
  `src/run/flowchart-run.ts:497–510`, `src/run/gate-apply.ts:132–139`,
  `src/run/supervisor.ts`).
- **`src/cli/main.ts` prose inspect** — prints, only when non-empty:

  ```
    required evidence (2):
      - failing test output
      - parser benchmark
  ```

  One bullet per entry (ledger descriptions are free text, so a comma join would
  be ambiguous). Placed after the agent-outcome lines, before `children:`.
- **`src/cli/main.ts` `--summary-json`** — new opt-in flag on `inspect --run`
  printing exactly one line:

  ```
  {"type":"INSPECT_SUMMARY","runId":"run_…","status":"BLOCKED","requiredEvidence":[…]}
  ```

  Rejected (exit 1, `cliFail`) when combined with `--json`, and when used with
  `--episode` (episode snapshots carry no run stall/block events). USAGE line
  updated to `[--json | --summary-json]` plus one sentence in the help prose.

## Why `--summary-json` and not a last-line `INSPECT_SUMMARY`

The slot brief preferred appending an `INSPECT_SUMMARY` line to `--json` *if*
existing tests only checked that events exist. They check more than that, and
those files are not mine to edit:

- `test/integration/cli/cli.test.ts:145` asserts the `--json` stdout is exactly
  `12` lines for a plain run — an appended line breaks it outright.
- `test/integration/cli/cli.test.ts:121–124` and `:146–149` assert **every**
  line parses to an object with both `id` and `type`; a summary object with no
  event id fails that too.

So `--json` stays a byte-for-byte pure event NDJSON stream and the aggregate is
opt-in. The summary object is deliberately not a domain `Event`: its `type` is
outside the `Event` union in `src/run/events.ts` and it has no `id`, so nothing
can mistake it for a persisted event if the two outputs are ever concatenated.

## Tests

`test/unit/run/inspection.test.ts` — 8 new cases (12 total in the file), all
passing:

- no stall/block ⇒ `requiredEvidence` is `[]` (nothing invented);
- two stalls then a block ⇒ only the latest demand, superseded entries absent;
- a stall with no block yet ⇒ evidence retained while status is not `BLOCKED`;
- prose prints the block, prose omits it entirely for a clean run;
- `--json` for a stalled run ⇒ 5 lines, exact type order, every line has
  `id`+`type`, no `INSPECT_SUMMARY` (this is the documented no-break contract);
- `--summary-json` ⇒ exactly one object, deep-equal, `id` absent;
- `--summary-json` on a clean run ⇒ `requiredEvidence: []`;
- `--json --summary-json` ⇒ exit 1; `--episode --summary-json` ⇒ exit 1.

## Verification

- `pnpm typecheck` clean (strict, `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`).
- `pnpm lint` clean.
- `pnpm test` (full suite): 1419 pass, 0 fail, 1 pre-existing skip. The
  `inspect --json` line-count and shape assertions in
  `test/integration/cli/cli.test.ts` still pass unchanged.
- End-to-end probe against a **real** supervisor-produced blocked run (throwaway
  script in `/tmp`, not committed; drives `startSupervisedRun` to `BLOCKED` like
  `test/integration/m2/supervisor.test.ts:139`, then calls the CLI): prose
  printed `required evidence (1): Add a completed task, validated evidence, a
  new fact, or resolve a blocker in the next round` — the ledger's own wording,
  not a synthesized one — `--summary-json` emitted the single object with
  `status: BLOCKED`, and `--json` still emitted all 37 lines, every one a domain
  event.

## Honesty notes

- Evidence strings are reproduced exactly as the supervisor ledger wrote them;
  nothing is normalized, deduped, translated, or back-filled.
- Nothing here is Outcome-supported. The claims above are Test-supported
  (unit + full suite) and Probe-observed (the blocked-run probe); no live run,
  no production data.
- `EPISODE_WAITING.requiredEvidence` is deliberately **not** folded in: the field
  is specified as the latest stall/block demand, and episode waits are a
  different gate. Combining them would misattribute the source.

## Not done / follow-ups for other slots

- No CLI-integration test file added for `--summary-json`; per the slot map
  those live with gpt-sol-2 (`test/integration/cli/`). The contract is pinned in
  my own unit file so it cannot regress silently.
- README/status-matrix rows for the new flag belong to fable-1's docs slot.
