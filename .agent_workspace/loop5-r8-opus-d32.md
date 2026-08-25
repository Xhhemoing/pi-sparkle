# Loop 5 · Round 8 · Rank 2 (D32) — `commits` refusal retargeting

Slot: Opus-d32-commits-retarget. Branch `cursor/commits-refusal-retarget-0da8`, based on
`origin/cursor/pi-sparkle-sota-opt-0da8` at `09305ae` (`docs(agent): record D31–D33; open Round 8`).
Not merged to the integration branch — parent merges after GPT-r8 KEEP.

## Files changed

- `src/cli/commits.ts` — five refusals retargeted; `proposalsFromInput` now takes already-filtered
  node ids.
- `test/integration/cli/commits.test.ts` — eleven new pinned cases (both subcommands where the
  refusal applies).
- `.agent_workspace/loop5-r8-opus-d32.md` — this report.

Nothing else is touched: `src/tools/decision-commit.ts`, `src/cli/main.ts`, `package.json`, and every
other file are byte-identical to the base branch.

## Exact contracts

All five emit through `cliFail`, so exit code is 1, stdout stays empty, and stderr carries the human
block plus the one-line `CliErrorReport` JSON that `parseCliErrorJson` reads.

### 1. Malformed `--run` (both `previewCommand` and `applyCommand`, before `loadCommitInput`)

Guard is `isRunId` from `domain/ids.js`, placed after the existing `--run` required check and after
`stateRoot` is resolved; `parseRunId` still runs afterwards and can no longer throw.

| field | value |
| --- | --- |
| `command` | `commits` |
| `stage` | `parse-args` |
| `message` | `invalid --run "${values.run}": expected a run id of the form run_<suffix>` |
| `next` | `pass --run <runId> as printed by pnpm cli list --state-root ${stateRoot}` |
| `runId` | `values.run` (the raw operator value) |

### 2. Empty `--nodes` selection (both commands, before any state read)

The CSV is parsed once per command (`const nodeIds = parseCommitNodeIdsCsv(values.nodes)`) and the
same array is reused by the filter below. Fires when `values.nodes !== undefined` and the parse
yielded zero ids.

| field | value |
| --- | --- |
| `stage` | `parse-args` |
| `message` | `invalid --nodes "${values.nodes}": selects no node ids` |
| `next` | `pass --nodes <id,id> or drop the flag to use every completed node` |
| `runId` | absent — the run was never read |

`--nodes only,` (a trailing comma that still names ids) keeps today's lenient trim and previews
normally; only the selects-nothing case refuses.

### 3. Unknown `--nodes` ids (both commands)

`filterDecisionCommitNodeIds(knownIds, nodeIds)` is hoisted out of `proposalsFromInput` into each
command body, with `knownIds` read as
`loaded.checkpoint.flowchart?.definition.nodes.map((node) => node.id) ?? []`. The try/catch wraps
**only** that one synchronous call (the lexical `parseArgs`-catch precedent).

| field | value |
| --- | --- |
| `stage` | `validation` — the valid set is run state, not CLI knowledge |
| `message` | the helper's own, e.g. `unknown flowchart node id(s): bogus` |
| `next` | `pass --nodes ids from this run's flowchart; pi-sparkle inspect --run ${runId} --state-root ${stateRoot} lists its nodes` |
| `runId` | the parsed run id |

`generateDecisionCommits` and the `--file` selection stay outside every catch, so a true
`no completed nodes to commit` keeps its current classification (unretargeted, as specified).
`proposalsFromInput` now accepts the filtered ids and never calls the filter itself.

### 4. `--file` read and parse (`applyCommand` only, two narrow trys)

`readFile(values.file, "utf8")`:

| field | value |
| --- | --- |
| `stage` | `lookup` |
| `message` | `cannot read --file ${values.file}: ${error.message}` |
| `next` | `check the --file path; commits preview --json writes an input this flag accepts` |
| `runId` | the parsed run id |

`parseDecisionCommitFile(raw)`:

| field | value |
| --- | --- |
| `stage` | `validation` |
| `message` | `${values.file}: ${parser message}` |
| `next` | `fix ${values.file} or regenerate it with commits preview --json` |
| `runId` | the parsed run id |

### 5. Repo preflight (`applyCommand`)

Both former `throw new DomainValidationError(...)` sites are now direct `cliFail` with
`stage: "preflight"` and **unchanged message wording**:

| case | `message` | `next` |
| --- | --- | --- |
| missing repo | `apply requires --repo or a checkpoint project.rootPath` | `pass --repo <path to a git work tree>` |
| not a work tree | `apply requires a git work tree at ${repo}: ${workTree.detail}` | `run git init in ${repo} or pass --repo <git work tree>` |

Both carry `runId`. Exit stays 1 and stdout stays empty, so the existing
`/git|work tree|not a git/i` pin holds byte-for-byte. `DomainValidationError` is still imported and
used by `loadCommitInput` (no durable checkpoint) and `proposalsFromInput` (empty `--file`
selection).

## Tests added (`test/integration/cli/commits.test.ts`)

Parameterised over `preview` and `apply`:

- `commits preview|apply refuses a malformed --run before reading state` — whole-field pins on
  `command`/`stage`/`message`/`next`/`runId`; run against a state root that does not exist.
- `commits preview|apply refuses a --nodes CSV that selects nothing, before state` — run with
  `--run run_missing0001` and a **nonexistent** `--state-root`, so a `--nodes` refusal (rather than
  the `stage: "lookup"` missing-run report) is the order pin; asserts `runId` is absent.
- `commits preview|apply sends an unknown --nodes id to inspect, not to doctor` — pins
  `stage: "validation"`, the helper's message, the whole `next` string, `next` matching
  `/inspect --run/`, and `runId`.

Single cases:

- `commits preview accepts a --nodes CSV with a trailing comma` — `--nodes work,` still exits 0 and
  prints the proposal (lenient-trim boundary).
- `apply names --file when the path cannot be read` — `stage: "lookup"`, message prefix
  `cannot read --file <path>: ` plus `/ENOENT/`, exact `next`, `runId`.
- `apply reports an unparsable --file against the file, not the run` — `stage: "validation"`,
  message prefixed with the path, exact `next`, `runId`.
- `apply with a blank --repo reports preflight and names the flag` — `--repo "   "` reaches the
  missing-repo branch; exact message and `next`.
- `apply against a directory that is not a work tree reports preflight` — exact `next`, message
  prefix `apply requires a git work tree at <dir>: `.

Every case also asserts exit 1 and empty stdout.

## D20 and freeze pins confirmed unchanged

Verified by running the file and by reading the diff — none of these strings or bytes moved:

- `COMMITS_PREVIEW` `deepEqual` (type/preview/commits with the eight-key proposal) — unchanged; the
  emitting line in `previewCommand` is untouched.
- D20 partial-apply notes: the generated-proposal note ending
  `pass --nodes second to apply only those`, the `--file` suffix-file note ending
  `do not rerun an input that still contains the first 1`, and the comma-bearing-id case
  (`node ids second,tail;` with no `--nodes` command). `partialApplyNote` and
  `nodesCsvSelectsExactly` are byte-identical.
- `--nodess` parser refusal on both subcommands (`stage: "parse-args"`, `next` naming `--help`).
- Lookup on a valid-format missing run (`stage: "lookup"`, `runId`, `next` matching `/pnpm cli list/`)
  — the `isRunId` guard does not fire on `run_missing0001`.
- `apply without a git repo fails closed` — `/git|work tree|not a git/i` on stderr, exit 1, empty
  stdout.
- `COMMITS_USAGE`, `--help` on both subcommands, bare/unknown subcommand reports, the truncated-JSONL
  warning, and the legacy untyped `{ commits: [...] }` file path.

No Event type, no new JSON contract, no `main.ts`, no `package.json`, no edit to
`src/tools/decision-commit.ts`.

## Verification

- `npx tsx --test test/integration/cli/commits.test.ts` — 28 pass, 0 fail (17 before this change).
- `pnpm typecheck` (`tsc --noEmit`) — clean.
- `npx eslint src/cli/commits.ts test/integration/cli/commits.test.ts` — clean.
- `pnpm test` (whole suite) — 2296 pass, 0 fail, 1 skipped.

Host Node is v22.14.0 against engines `>=22.19.0`; that is a warning only and no test depends on it.

## Rider — GPT-r8-challenge FIX: a blank `--repo` is argv, not a missing environment

GPT-r8 returned **FIX** (slot kept) on the one contract the Fable spec omitted: `commits apply
--repo "  "` fell through the `??` fallback into the preflight branch, so the report blamed a
missing environment for an empty string the operator had supplied and never named `--repo`.

`applyCommand` now refuses a supplied blank path immediately after the `isRunId` guard and
`parseRunId`, before the `--nodes` CSV check and before `loadCommitInput` or any other state read:

| field | value |
| --- | --- |
| `command` | `commits` |
| `stage` | `parse-args` |
| `message` | `invalid --repo "${values.repo}": repository path must be a non-empty string` (raw operator string) |
| `next` | `pass --repo <path to a git work tree> or omit it to use checkpoint project.rootPath` |
| `runId` | the validated run id |

The two preflight reports are unchanged and stay distinct from it:

- flag omitted **and** the checkpoint names no project → `stage: "preflight"`,
  `apply requires --repo or a checkpoint project.rootPath`, next
  `pass --repo <path to a git work tree>`;
- a supplied non-blank path that is not a work tree → `stage: "preflight"`,
  `apply requires a git work tree at ${repo}: ${workTree.detail}`, next
  `run git init in ${repo} or pass --repo <git work tree>`.

The residual `repo.trim() === ""` arm of the fallback branch is now only reachable through a
checkpoint whose `project.rootPath` is blank, and keeps the preflight wording.

### Rider tests

- `apply refuses --repo "" as argv, naming the flag` and `apply refuses --repo "  " as argv, naming
  the flag` — whole-report `deepEqual` on the parsed JSON (including `ok: false` and `runId`), with
  empty stdout.
- `apply refuses a whitespace --repo before reading state` — same whole-report `deepEqual` against a
  **nonexistent** `--state-root`, so the argv refusal provably precedes the run read.
- `apply with no --repo still commits into the checkpoint project.rootPath` — `git init` in the
  project root, apply without the flag, exit 0 and the commit lands there.
- `apply with no --repo and no checkpoint project reports preflight` — `project` is deleted from
  `checkpoint.json` on disk; whole-report `deepEqual` on the unchanged preflight report.
- `apply against a directory that is not a work tree reports preflight` (from the first landing) is
  unchanged and keeps the second preflight report distinct.

### Rider verification

- `npx tsx --test test/integration/cli/commits.test.ts` — 32 pass, 0 fail.
- `pnpm typecheck` and `npx eslint src/cli/commits.ts test/integration/cli/commits.test.ts` — clean.
- `pnpm test` (whole suite) — 2300 pass, 0 fail, 1 skipped.

Every earlier D32 pin, the D20 partial-apply notes, and the `COMMITS_PREVIEW` `deepEqual` are
unchanged; the rider touches only `applyCommand`'s repo handling.
