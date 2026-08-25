# Loop 5 · Round 10 — GPT-r10 independent ranking/spec challenge

Verdict: keep the ranking and all three slots, with contract corrections:
**D37 FIX**, **D38 FIX**, **D39 FIX**. No held item is a stronger file-disjoint
replacement. The order D37 → D38 → D39 stands.

## Method

- Challenged latest origin SHA `1f56eb2dddf1dc466699d88ac32f8360a94cc2f7`
  (`docs(agent): record GPT-r10-challenge dispatch id`). It contains
  `58ed045a8614440446a252df51d9a624ef94bd9a`
  (`docs(agent): record Round 10 Fable ranking (D37–D39)`). Origin advanced
  from `58ed045` to `1f56eb2` after the first report push, so the newer parent
  was fetched and merged into this challenge branch before final delivery.
  Fable ranked at `acd2eb746c1dfbfedd58a8da0ac7162f21bbfc1f`.
  `git diff --name-status acd2eb7..1f56eb2 -- src test`,
  `git diff --name-status 58ed045..1f56eb2 -- src test`, and the mandatory
  `git diff --name-status 58ed045..HEAD -- src test` were all empty, so all
  ranked source and test blobs are identical to the ones Fable probed.
- Read `.agent_workspace/loop5-r10-fable-next.md`, D37–D39 in
  `docs/agent-decisions.md`, and the relevant D15/D17/D20/D25/D26/D31–D36
  decisions. Read live `src/cli/{list,pause,inject,commits,models,auth,validate,
  init-examples,migrate-legacy,episode,errors,doctor,model-catalog,main}.ts`,
  `src/{episode/store,run/episode-store,run/event-store,persist/jsonl,
  persist/file-lock,domain/errors}.ts`, and all ten ranked test files.
- Re-pulled `gh pr view 12 --json files,state,headRefName` after probing. PR
  #12 is **OPEN**, head `cursor/merge-preview-release-8011`. Its live source
  files remain `src/adaptation/eval-routing.ts`, `src/cli/{adapt,inspect-format,
  main}.ts`, `src/feedback/redaction.ts`, `src/pi-adapter/runtime.ts`, and
  `src/run/{flowchart-run,inspection}.ts`, plus the test sets Fable listed.
  None of the D37–D39 source or test files is present.
- Ran `pnpm install --frozen-lockfile`; it completed cleanly apart from the
  expected Node v22.14.0 warning against `engines.node >=22.19.0`.
- Baseline command:
  `npx tsx --test test/unit/cli/list.test.ts
  test/integration/cli/pause-inject.test.ts
  test/integration/cli/commits.test.ts test/unit/cli/models.test.ts
  test/unit/cli/auth.test.ts test/unit/cli/validate.test.ts
  test/integration/m3/episode-cli.test.ts
  test/unit/cli/init-examples.test.ts
  test/unit/cli/migrate-legacy.test.ts
  test/integration/cli/migrate-legacy.test.ts` passed **213/213**.
- Seeded only `/tmp/r10-gpt-challenge/**`. Probes invoked the live
  `node_modules/.bin/tsx src/cli/main.ts` from controlled working directories;
  direct store probes used the same live TypeScript modules. Every quoted
  refusal exited 1 unless an exit is stated explicitly.

## D37 — FIX (keep rank 1)

D37 is one defect, not seven unrelated defects: one explicitly present but
blank target option is resolved as a cwd-relative state tree. The consequences
span reads and writes, but the invariant and refusal fields are the same. Live:

- `auth login openai --key sk-probe --state-root ""` printed
  `Stored api_key credential for openai in runtime/auth.json`, exited 0, and
  created `/tmp/r10-gpt-challenge/d37-auth/runtime/auth.json`.
- `models enable openai/gpt-5.2 --state-root ""` printed
  `Enabled openai/gpt-5.2`, exited 0, and created the cwd-relative
  `runtime/providers.json`.
- `list --state-root ""` printed `(no runs)` and exited 0.
- Pause, inject, and commits all produced the claimed shape. Pause, for example:
  `message: "Run run_probe not found under "` and
  `next: "check --state-root, then pnpm cli list --state-root  for the run ids
  that exist there"`.
- The real validate target defect is on `--flowchart`, not Fable's
  `--children` probe. From a cwd whose relative `runtime/providers.json`
  exposed `local/m1`, `validate --flowchart ... --state-root ""` printed
  `valid: flowchart flw_probe ... checked against the live catalog at ` and
  exited 0. The same spec against the intended empty root refused:
  `flowchart node work modelPolicy references unavailable model "local/m1";
  CLI catalog: cheap, premium`.

Fable's statement that its `validate --children ... --state-root ""` result
ran a catalog-parity check against cwd-relative `providers.json` is false.
Live it printed `valid: children 2 tasks → flowchart children (2 nodes)`, but
`validate.ts` never resolves or reads the state root in that branch, and its
usage explicitly says `--state-root is ignored by --children`. Do not turn
that documented ignored option into a blank-only incompatibility.

Keep Fable's common refusal bytes and ranking, with these exact corrections:

1. For list, pause, inject, commits, models, and auth, when the raw option is
   present and `trim() === ""`, return `cliFail` with the module's existing
   command dialect, `stage: "parse-args"`,
   `message: 'invalid --state-root "<raw>": state root must be a non-empty
   directory path'`, and
   `next: "pass --state-root <dir> or omit it to use the default
   ~/.pi-sparkle"`. The next is path-free. Nonblank relative roots remain
   accepted.
2. Place the guard immediately before the first root resolution/use, after
   existing path-free argv checks. Concretely: list keeps runs/episodes,
   status, and sort precedence; pause keeps required-run, clear/reason, and
   blank-reason precedence, then checks blank root before `isRunId`; inject
   keeps type/confidence/key/node/actor precedence, then checks blank root
   before `isRunId`; each commits subcommand checks it before its current root
   assignment; each models/auth subcommand checks it after help and its
   existing positional/value checks but before config/store I/O. This preserves
   D31/D34/D35 argv ordering wherever the earlier next does not need a root.
3. In validate, apply the guard only to the flowchart branch, after the
   exactly-one-spec and blank-spec checks but before catalog construction.
   Leave `validate --children`'s documented state-root-independent behavior
   unchanged. Replace Fable's children-only blank-root test with a flowchart
   pin that proves no cwd config is read and pins all four refusal fields.
4. Pin the pause mixed case exactly:
   `pause --run banana --state-root ""` reports blank state-root first. Live
   today it instead reports `invalid --run "banana"` with the broken
   `next: ... list --state-root `. This does not fight D31: its existing
   malformed-run pins pass a nonblank temp root and retain every byte; inject's
   D30/D31 type/confidence precedence also remains ahead of the new guard.
5. Keep the representative no-I/O/no-write pins Fable names, including both
   write verbs and JSON list. Grep found no existing test passing a blank
   state-root, so this is outside the closed D25/D31/D32/D34/D35/D36 scopes.

D15 is not a blanket rule that every common CLI check must be copied. It says
not to import `missingRun` from `main.ts`, because `main.ts` already imports
those verbs. A standalone state-root helper would be clean in a single unified
change, but this round deliberately assigns the same invariant to D37, D38,
and D39. Adding a helper to one branch makes the other two depend on that
unmerged branch; using it only in D37 still leaves two copies and does not
solve the drift. Keep the small per-module guards for file-disjoint dispatch,
and make whole-field tests own their identical bytes. Do not edit
`errors.ts` or `main.ts`.

## D38 — FIX (keep rank 2)

The selected target-contract defects are live:

- A regular file as `init --dir` produced
  `EEXIST: file already exists, mkdir ...`, `stage: "execute"`, and
  `next: "fix the reported error, then retry; use pi-sparkle doctor for
  preflight"`.
- With a directory at `sparkle-flowchart.example.json`,
  `init --dir ... --force` produced `EISDIR: illegal operation on a directory,
  open ...`; the fresh `sparkle-children.example.json` was present afterward
  and no line disclosed it.
- `init --dir " "` exited 0, created the literal space directory, and printed
  `next: pi-sparkle validate --children .../ /sparkle-children.example.json`.
  `init --dir ""` also exited 0 and wrote both files into the cwd.
- `migrate-legacy --state-root "" --apply` printed `state root: `, copied
  `feedback/records.jsonl -> adaptation/feedback/records.jsonl`, and exited 0.
  A regular file as root was misclassified as `stage: "scan"` with
  `next: "repair or remove the unreadable legacy file..."`.

Fable's blank-`--dir` next is true and is the contract to keep. Live `init`
with omitted `--dir` wrote both examples into the cwd and exited 0. Omission
selects the documented default; an explicitly blank value is malformed. This
is consistent with D37 and does not invent a ban on nonblank relative paths.

Keep the slot with these exact fields and one necessary testability
correction:

1. Before `resolve`, target construction, or `existsSync`/`lstat`, blank
   `--dir` returns `command: "init"`, `stage: "parse-args"`,
   `message: 'invalid --dir "<raw>": directory must be a non-empty path'`,
   `next: "pass --dir <path> or omit it to write into the current directory"`.
   Nonblank relative paths remain accepted.
2. Before `mkdir` or either write, `lstat` both existing targets. A
   non-regular target returns `command: "init"`, `stage: "preflight"`,
   `message: "cannot write <target path>: it exists and is not a regular
   file"`, and
   `next: "move it aside; init writes sparkle-children.example.json and
   sparkle-flowchart.example.json as regular files, and --force only
   overwrites regular files"`, even with `--force`. For a regular
   existing target without `--force`, the current bytes remain:
   `stage: "execute"`, `<path> already exists`,
   `next: "re-run with --force to overwrite"`. Live that pin still fires.
3. In the narrow `mkdir`/write catch, return `command: "init"`,
   `stage: "execute"`,
   `message: "cannot write into --dir <resolved dir>: <thrown message>"`, and
   `next: "check the --dir path is a writable directory"`. Append a target
   to `written` only after
   its `writeFile` resolves. On failure, print
   `note: wrote <successful target paths> before the failure` only when that
   list is nonempty, before `cliFail`. Never list the target whose write
   rejected as completed.
4. Fable's proposed partial-disclosure test cannot use the directory-squat
   fixture. The new `lstat` preflight necessarily rejects that fixture before
   the write loop, so it cannot both prove zero writes and drive a failure
   after one successful write. Add an optional `InitExamplesOptions.writeFile`
   seam (defaulting to the real `writeFile`), analogous to the existing
   migrate publish seams. One test uses the real directory squat to pin
   preflight and zero fresh files; a separate seam test lets the first real
   write resolve and rejects the second, then pins the exact note, the first
   file's bytes, the absent second file, and all four error fields.
5. Interpolating the resolved `dir` in the diagnostic `message` is acceptable:
   it identifies the target that failed, and the JSON report escapes it. The
   D34 rider applies to executable-looking `next` text. Keep D38's next exactly
   path-free: `check the --dir path is a writable directory`.
6. Before `planLegacyMigration`, a blank root uses D37's exact message/next
   with `command: "migrate-legacy"` and `stage: "parse-args"`. In the existing
   scan catch, a string `errorCodeOf(error)` returns
   `command: "migrate-legacy"`, `stage: "lookup"`,
   `message: "cannot scan --state-root <stateRoot>: <thrown message>"`, and
   `next: "check the --state-root path; it must be the flat pre-2026-08-22
   state directory"`. An uncoded error keeps today's scan fields byte-for-byte.
   Live corrupt middle JSONL stayed
   `stage: "scan"` with
   `corrupt legacy JSONL at feedback/records.jsonl line 2`; a nonexistent root
   printed `no legacy files found` and exited 0. Pin both while changing only
   coded filesystem faults to `lookup`.

## D39 — FIX (keep rank 3)

The envelope defect and remedy gap are live:

- Bad event JSON produced `command: "episode"`, `stage: "validation"`,
  `Invalid JSON at line 1 in .../ep_corrupt.events.jsonl`, then the generic
  doctor next.
- A valid JSON row with `type: "BANANA"` produced
  `Invalid episode event at line 1 ... Unknown EpisodeEvent.type: BANANA`,
  with the same doctor next. A bad snapshot on close did the same for
  `ep_badsnap.jsonl`.
- Direct store probes reported
  `{"name":"bad-json","domain":true,"code":null,...}`,
  `{"name":"unknown-event","domain":true,"code":null,...}`, and the same
  uncoded `DomainValidationError` result for the bad snapshot.
- `doctor --json` exited 1 only because of live checks such as this VM's Node
  version; its report had `runStates.scanErrors: []` and contained none of
  `ep_corrupt`, `ep_badevent`, or `ep_badsnap`. It did name the deliberately
  seeded `ep_lock.lock`, confirming the distinction: doctor inventories
  locks, not episode JSONL.
- `list --episodes --json` exited 0 and put the bad snapshot path and message
  in `errors[]`, with the stderr incomplete warning. The close retarget works.
- A held episode lock still reached main and produced the coded routed next:
  `the lock is held ... run pi-sparkle doctor --json --state-root
  /tmp/r10-gpt-challenge/episodes and read locks[] ...`.

Keep `command: "episode"`, `stage: "validation"`, and the store's exact
message. Around the events `readAll()` only, catch
`error instanceof DomainValidationError && errorCodeOf(error) === undefined`
and use
`next: "the episode event log is append-only and pi-sparkle never rewrites it:
repair or move aside the file named above, then retry; pi-sparkle doctor does
not inventory episode logs"`. Around the close snapshot `readAll()` only, use
the same classification and
`next: "the episode log is append-only and pi-sparkle never rewrites it:
repair or move aside the file named above; pnpm cli list --episodes --json
lists the readable episodes and names damaged records under errors[]"`.
Rethrow every other error. Pin close snapshot/event bytes unchanged. D33 pinned
the command spelling; there is no live reason to invent subcommand-qualified
variants.

Correct the blank-root guard order:

1. Parse argv first; preserve both help returns and the unknown-subcommand
   refusal before judging verb flags. Preserve the existing missing-episode
   refusal next. Then refuse blank state-root, resolve the root, and only then
   run `isEpisodeId`, whose next interpolates the root.
2. Pin `episode events --help --state-root ""` as usage/exit 0 and
   `episode nonsense --episode ep_probe --state-root ""` as
   `Unknown episode command: nonsense`. Live both behave that way. Inserting
   Fable's guard literally at the current line-101 resolution site would put it
   before both branches and contradict D33's rule that the verb is settled
   before that verb's flags are judged.
3. For events and close with real subcommands and ids, keep the same
   parse-args blank-root message/next as D37 with `command: "episode"`, before
   store reads and lock acquisition.
   The corrupt-log catches remain around `readAll()` only. A coded
   `DomainValidationError` is rethrown, so the demonstrated lock-timeout route
   remains owned by main.

## Ranking, disjointness, freeze, and held items

The corrected batches remain mutually file-disjoint: D37 owns its seven verb
modules and six tests; D38 owns init/migrate and three tests; D39 owns episode
and its one test. The D37 correction does not add a shared helper. All are
disjoint from PR #12's refreshed live file list.

Closed-decision files reopen only for new defects: D37's real blank-target
paths were not covered by D25/D31/D32/D34/D35/D36 (and its validate correction
does not reopen the deliberately ignored children path); D38 is outside
D17/D26's JSON/dialect scopes; D39 is outside D33's id/line-format scope while
preserving D33 ordering and command spelling. Grep found no pre-existing blank
state-root pin in any ranked test.

The freeze gate holds: no live R1/topology, ADR-006, `INSPECT_SUMMARY`, doctor
JSON keys/routes, `main.ts`, Event types, package metadata, or D7 Variant B.
No success JSON gains or loses a key. D20 is honored on D38 partial writes, and
the D34 rider is honored everywhere: raw operator paths stay out of `next`.

Nothing Fable held is a stronger replacement. The `main.ts` and `adapt.ts`
remainder overlaps PR #12; doctor blank-root already exits 1; corrupt run logs
have a doctor inventory that names them; the remaining held items are design
questions or lower-value wording/features. Therefore:

- **D37 FIX** — keep slot 1; correct validate to the real flowchart target and
  preserve per-module argv precedence.
- **D38 FIX** — keep slot 2; separate obstruction/no-write and injected
  partial-write disclosure tests.
- **D39 FIX** — keep slot 3; preserve help/unknown/missing-episode ordering
  before the blank-root guard.

**Overall: keep the ranking; do not reorder or replace a slot.**
