# Loop 5 · Round 8 — GPT-r8 independent ranking/spec challenge

## 1. Method

I reviewed live HEAD `443a97ae02869c8561d5629e899d335c5a81ac17` on
`cursor/pi-sparkle-sota-opt-0da8`. The two commits after Fable's
`33e8cf341e2023a3435fca7e28a7ab6a9f2b5d61` change only
`.agent_workspace/loop5-r8-fable-next.md`, `docs/agent-decisions.md`, and
`docs/agent-progress.md`; the ranked source and tests are unchanged.

I read D20, D26, D28-D33, the Round 7 closeout and Round 8 progress, live
`src/cli/{pause,inject,commits,episode}.ts`, their plane helpers and event/id
schemas, and all three ranked test files. I ran:

- `gh pr view 12 --json files,state,headRefName` (OPEN,
  `cursor/merge-preview-release-8011`);
- `npx tsx --test test/integration/cli/pause-inject.test.ts
  test/integration/cli/commits.test.ts
  test/integration/m3/episode-cli.test.ts` — **46/46 pass**;
- `npx tsx /tmp/loop5-r8-gpt-seed.ts`, producing a completed one-node
  flowchart run, a gate-waiting flowchart run, an OPEN episode subsequently
  driven to WAITING_FOR_USER by a refused close, and a second validated
  episode with tabs/newlines in operator-authored event fields under
  `/tmp/loop5-r8-gpt-state`;
- direct `pnpm cli` probes for every claimed D31-D33 refusal, success
  boundaries (`commits preview --json`, `inspect`, `episode events --json`),
  missing-state ordering, an explicit blank `--repo`, and unknown episode
  subcommand precedence;
- a pipeline from live `episode events --json` into Fable's proposed human
  formatter to test its one-line invariant.

Runtime was Node `v22.14.0`, pnpm `10.17.1`, tsx `4.23.12`. pnpm reported the
package's `>=22.19.0` engine warning, but the focused tests and probes ran.

## 2. Verdicts

### D31 — **KEEP**

The ranked defect and exact contract hold.

- `pause --run banana` and valid `inject ... --run banana` both exit 1 as
  `stage: "validation"` with `Invalid RunId` and the generic doctor next.
- On the seeded waiting run, blank `--reason`, `--key`, `--node`, and
  `--actor` each reach the plane/controller and return the corresponding
  non-empty-string validation error plus the doctor next.
- `pause --run banana --state-root /tmp/loop5-r8-gpt-no-state` still reaches
  the bare ID parser, confirming why the new guard belongs before state I/O.
- `inject --run banana --type banana` returns D30's `--type` parse-args
  refusal, confirming the specified type/confidence-before-run-shape
  precedence.

Keep Fable's messages, next actions, stages, ordering, no-write assertions,
and use of `isRunId` exactly as specified. No plane catch should be added.

### D32 — **FIX** (keep the slot; add the omitted explicit-blank `--repo` contract)

Fable's five surfaces are live:

- malformed `--run` is validation + doctor;
- unknown `--nodes bogus` is validation + doctor;
- `--nodes ","` says `no completed nodes to commit`;
- unreadable `--file` is raw ENOENT at `stage: "execute"` + doctor;
- a non-git `--repo` is validation + doctor.

Keep every specified D32 correction, including the narrow catches and
byte-identical `COMMITS_PREVIEW`/D20 partial-apply behavior. Correct one
omission in the same batch: the source currently conflates an explicitly
blank argv value with an absent checkpoint fallback:

`commits apply --run <valid> --repo "  "` currently returns
`apply requires --repo or a checkpoint project.rootPath` as validation +
doctor. Against a nonexistent state root it performs the run lookup first
and returns `stage: "lookup"`. Fable's proposed conversion would merely turn
the former into preflight; it would still fail to identify the supplied
blank flag as argv.

Implement this exact addition in `applyCommand`:

1. After the required-`--run` check and Fable's `isRunId` guard, and before
   `loadCommitInput` or any other state read, if
   `values.repo !== undefined && values.repo.trim() === ""`, call `cliFail`
   with:
   - `command: "commits"`
   - `stage: "parse-args"`
   - `message: 'invalid --repo "<raw>": repository path must be a non-empty string'`
   - `next: "pass --repo <path to a git work tree> or omit it to use checkpoint project.rootPath"`
   - `runId` set to the validated run id.
2. Keep the later omitted-fallback case
   (`values.repo === undefined` and no checkpoint `project.rootPath`) at
   Fable's `stage: "preflight"` with
   `apply requires --repo or a checkpoint project.rootPath`.
3. Keep a supplied nonblank path that is not a work tree at
   `stage: "preflight"` with Fable's original message and next.

Test pins to add:

- whole-report exact assertions for both `--repo ""` and `--repo "  "`;
- stdout empty;
- the whitespace case with a nonexistent `--state-root` still returns that
  parse-args report, proving no state read;
- omitted repo continues to use checkpoint `project.rootPath`, while an
  unavailable fallback and a non-git path retain their distinct preflight
  reports.

This is a sixth surface inside D32, not a fourth slot.

### D33 — **FIX** (keep the slot; correct dispatch order and the line-format invariant)

The core slot is live. Both real subcommands report malformed `--episode`
as validation + doctor. Human events print only `EPISODE_OPENED` and
`EPISODE_WAITING`, while JSON exposes timestamps and
`acceptance-incomplete: tests`.

Keep Fable's `isEpisodeId` message/next/stage and its four event-specific
detail choices, but apply two corrections.

#### A. Unknown subcommand must precede episode-id validation

`episode nonsense --episode banana` currently reports `Invalid EpisodeId`;
Fable explicitly preserves that masking. It is the wrong operator order:
there is no valid episode operation in which to interpret the id.

After parseArgs and help handling, move the existing
`subcommand !== "events" && subcommand !== "close"` refusal before the
required-`--episode` check and `isEpisodeId` guard. Preserve its existing
contract:

- `stage: "parse-args"`
- `message: "Unknown episode command: <subcommand>"`
- `next: "use episode events or episode close"`
- usage still goes to stderr.

Pin `episode nonsense --episode banana` to that whole report. Keep malformed
ID whole-report pins on both **real** subcommands.

#### B. Escape control characters in human detail fields

Fable promises one tab-separated line per event but interpolates validated,
operator-authored strings raw. The schemas allow tabs/newlines in
`episode.objective`, WAITING `reason` and every `requiredEvidence` entry, and
CLOSED `outcomeId`. I seeded such validated events. Feeding their live JSON
through the proposed formatter produced **five physical lines for two
events**:

`{"proposed":"...\\tEPISODE_OPENED\\tship\\toperator\\nprobe\\n...\\tEPISODE_WAITING\\tneeds\\towner\\napproval: tests\\tlinux, docs\\nreview\\n","physicalLineCount":5}`

Add one module-local human-field helper that, in this order, replaces:

1. `\` with `\\`
2. tab with `\t`
3. carriage return with `\r`
4. newline with `\n`

(The right-hand forms are literal backslash escape text.) Apply it to
OPENED objective, ATTACHED run id, WAITING reason and each evidence entry,
and CLOSED outcome id. Keep the simple-value output exactly:

- `<occurredAt>\tEPISODE_OPENED\t<escaped objective>`
- `<attachedAt>\tRUN_ATTACHED\t<escaped runId>`
- `<occurredAt>\tEPISODE_WAITING\t<escaped reason>[: <escaped evidence joined by ", ">]`
- `<closedAt>\tEPISODE_CLOSED\t<status>[ outcome=<escaped outcomeId>]`

Add a fixture containing literal backslashes plus tab/CR/LF in every
unconstrained detail field. Pin exact escaped lines, exactly one physical
line per event, exactly two structural tab delimiters per line, and the
same parsed `--json` events byte-for-byte in shape/content. Keep all of
Fable's four-type, timestamp, lookup, truncation, and no-write pins.

This does not reject any currently valid event, add an Event type, or change
the JSON path.

## 3. Ranking

The ranking is **not wrong**. No different free-file batch outranks these:

1. D31 remains the highest-impact mid-incident correction.
2. D32 remains second and is stronger with the same-file blank-repo fix.
3. D33 remains third after making its designed human view physically stable.

The remaining bare ID parsers found by the audit are predominantly in
`main.ts` or `adapt.ts`, both held by PR #12. The free-file auth/model
remainders do not displace a reproduced episode surface that currently
withholds both cause and timestamp.

## 4. Freeze and PR #12 disjointness

PR #12 is OPEN. Its ranked-relevant source set is
`src/adaptation/eval-routing.ts`, `src/cli/adapt.ts`,
`src/cli/inspect-format.ts`, `src/cli/main.ts`,
`src/feedback/redaction.ts`, `src/pi-adapter/runtime.ts`,
`src/run/flowchart-run.ts`, and `src/run/inspection.ts`; none of the six
D31-D33 source/test files is present. The three batches remain mutually
file-disjoint.

The corrections above do not touch live R1/selectArm/planTaskTopology,
ADR-006, INSPECT_SUMMARY, doctor JSON/runStates, RunStatus, package metadata,
the crash-probe order, blocked-next prefix, D7 Variant B, or Outcome claims.
They add no Event type and keep `COMMITS_PREVIEW` and `episode events --json`
unchanged.

## 5. Held items

I agree with Fable's holds:

- non-flowchart/terminal pause-inject messaging and unknown injected node
  remain plane/`main.ts` work behind PR #12;
- genuine `no completed nodes to commit` remains honest validation;
- unblock/G5/G7/E4/cost/completions and Windows/docs riders remain behind
  PR #12;
- `episode close --outcome` must not gain a new value grammar; escaping its
  human rendering is sufficient;
- auth/doctor/list/models/validate/migrate/pi-compat/init remainders, new
  pause/inject JSON echoes, and D7 Variant B stay held/no-high-value.

I would un-hold none. The two extra findings are contract corrections inside
the already-ranked D32 and D33 files.
