# Loop 5 · Round 8 — Fable-next: the three implementable operator batches after Round 7

Slot: Fable-r8-next (claude-fable-5). Analysis/spec only; no `src/` edits by this agent; not merged
to the parent integration branch.

Ranked at HEAD **`33e8cf341e2023a3435fca7e28a7ab6a9f2b5d61`**
(`docs(agent): record D28 KEEP; close Round 7`) on `origin/cursor/pi-sparkle-sota-opt-0da8`,
fetched fresh and re-fetched after probing — origin has not moved. Method: direct reads at HEAD of
`src/cli/{pause,inject,commits,episode,list,validate,auth,doctor,models,migrate-legacy,pi-compat,
init-examples,errors,doctor-overlay,main}.ts` (main read-only), `src/run/{injection,
pause-controller}.ts`, `src/tools/decision-commit.ts`, `src/episode/{events,manager,store}.ts`,
`src/domain/ids.ts`; pin greps across `test/` for every string a batch below would change; PR #12
file list re-pulled live via `gh pr view 12` (OPEN, head `cursor/merge-preview-release-8011` — src
set unchanged from the Round 7 read). **Every defect claimed below was reproduced live on this
VM** (`pnpm install --frozen-lockfile` clean, Node v22.14.0) via `pnpm cli` against a seeded state
root at `/tmp/r8probe/state` holding one plain fake-executor COMPLETED run, one flowchart run
WAITING_FOR_USER at its gate, one COMPLETED single-node flowchart run (so `commits` produces real
proposals), and one seeded episode driven OPEN → WAITING_FOR_USER by a refused COMPLETED close.
Probe outputs are quoted in place; every refusal quoted below exited 1. Baseline: the three test
files the batches extend pass 46/46 at HEAD (`npx tsx --test` on `pause-inject.test.ts`,
`commits.test.ts`, `episode-cli.test.ts`).

## 0. Round 7 closeout honored; constraints every batch satisfies

- **Not re-ranked.** D28 KEEP (verified live: `auth status --json` emits the discriminated
  `{"type":"AUTH_STATUS","preview":true,"mode":"stored","stored":[]}`; `auth --help`/`-h`/bare
  print usage), D29 KEEP (verified: `doctor --help` and `-h` print `DOCTOR_USAGE` and exit 0;
  `doctor help` refuses as `stage: "parse-args"` with the doctor-help next; `--json` untouched),
  D30 KEEP (verified: unknown `--type` and bad `--confidence` refuse as parse-args before the
  plane). Per the round brief their files are **free only for NEW defects** — Rank 1 touches
  `inject.ts` and `pause-inject.test.ts` for flags GPT-r6/r7 explicitly scoped *out* of D30
  ("validate only `type`/finite `[0,1]` confidence"), and touches nothing D28/D29 owned.
- **PR #12 disjointness, re-read live.** #12's current src files: `adaptation/eval-routing.ts`,
  `cli/adapt.ts`, `cli/inspect-format.ts`, `cli/main.ts`, `feedback/redaction.ts`,
  `pi-adapter/runtime.ts`, `run/flowchart-run.ts`, `run/inspection.ts` — unchanged from the Round
  7 read; plus `ci.yml`, README/CHANGELOG/SECURITY/`.env.example`/`package.json`,
  `docs/status-matrix.md`, docs/specs/reports, `scripts/*`, and its test files
  (`test/integration/cli/{cli,inspect-follow,run-cost-cap}.test.ts` and unit/m1/m2.5/pi-adapter
  files). **No ranked file is in that set** (checked name-by-name: `pause-inject.test.ts`,
  `commits.test.ts`, and `test/integration/m3/episode-cli.test.ts` are not #12 files). No batch
  edits `main.ts` — every guard parses inside the verb module that owns it, so the blocked-next
  four-line prefix and the eleven-case crash probe are untouched trivially.
- **Freeze gate.** No live R1/`selectArm`/`planTaskTopology`; ADR-006 stays Proposed;
  `INSPECT_SUMMARY` four keys untouched; **doctor `--json` byte-untouched** (no batch opens
  `doctor.ts`); doctor runStates stays PLANNING/RUNNING; eight-member `RunStatus` untouched; **no
  new Event types and no new JSON contract at all this round** — every batch is argv dialect,
  refusal retargeting, and one designed human line format; `RUN_LIST`/`MODELS_LIST`/`VALIDATE_OK`/
  `AUTH_STATUS`/`COMMITS_PREVIEW` and `episode events --json` are byte-identical; `package.json`
  untouched (`private: true` stays); no Outcome-supported claims; D7 Variant B untouched.
- **Windows CI.** The cli-smoke Windows leg runs `test/integration/m1/cli-children.test.ts` and
  `test/unit/cli/doctor.test.ts`; no batch touches either, and every new test is argv +
  capture-io + `mkdtemp`/`path.join` construction anyway. `ci.yml` is not edited (#12-held).

**The round's through-line, found by probing every free verb:** the CLI validates *which flags*
you passed (D21/D26-D30) but still forwards *flag values* to the domain layer unchecked in four
free files. A malformed id, a blank string, or an empty CSV reaches `parseId`/the flowchart
plane/the pause controller, and `main.ts`'s generic catch reports the resulting
`DomainValidationError` as `stage: "validation"` with "use pi-sparkle doctor for preflight" — the
one remedy that cannot fix an argv typo, and the report never names the flag. Grep confirms zero
existing test pins on any of these behaviors (`Invalid RunId`/`Invalid EpisodeId` are pinned only
in `test/unit/domain/ids.test.ts:57` against the parser itself), so every conversion below is
pin-safe.

---

## Rank 1 (D31) — `pause`/`inject` refuse malformed and blank argv before the plane

**Why first.** These are the two mid-incident verbs — the operator reaching for them has a live
run burning money or waiting on a gate. Five defect surfaces, all reproduced live at HEAD, all
the same wrong-remedy class D30 just closed for `--type`/`--confidence`:

- `pause --run banana` → `{"ok":false,"command":"pause","stage":"validation","message":"Invalid
  RunId: expected \"run_<suffix>\"","next":"fix the reported error, then retry; use pi-sparkle
  doctor for preflight"}`, exit 1 — a pasted-wrong run id mid-incident is classified as a
  validation failure, sent to doctor preflight, and the report never says `--run`
  (`pause.ts:76` calls `parseRunId` bare; the throw crosses into `main.ts`'s catch);
- `inject --run banana --type fact --key k --value v` → identical class (`inject.ts:142`);
- `pause --run <fr> --reason "  "` → `"pause reason must be a non-empty string"`,
  `stage: "validation"`, doctor next — the blank check lives in `requestPause`
  (`pause-controller.ts:92-93`) and fires only **after** the run lookup read the event log, so a
  pure argv defect is checked after state I/O;
- `inject --run <fr> --type skip --node ""` → `"injection nodeId must be a non-empty string"`,
  validation + doctor — the plane's `nonEmpty` (trim) rule at `injection.ts:89`, reached after
  the EventStore lookup;
- `inject … --key "  "` and `… --actor "  "` → `"injection key/actor must be a non-empty
  string"`, same class (`injection.ts:73,80`).

This is the exact composition GPT-r7 endorsed to KEEP as D30 — value-domain argv refused as
`parse-args` before `parseRunId`/lookup, plane untouched, no catch widened — extended to the
remaining unchecked flags of the same two verbs.

**Exact files and edits:** `src/cli/pause.ts` + `src/cli/inject.ts` +
`test/integration/cli/pause-inject.test.ts` only (the one test file already covers both verbs).

1. **Malformed `--run`, both verbs.** Guard with the already-exported `isRunId` from
   `domain/ids.js` (the D30 principle: reuse the domain's own predicate, never restate it) at the
   point each file currently calls `parseRunId` bare (`pause.ts:76`, `inject.ts:142` — i.e.
   *after* the existing value-domain blocks, preserving D30's pinned precedence where
   `inject --run <missing> --type banana` reports the typo first): when false, `cliFail` with the
   verb's `command`, `stage: "parse-args"`,
   `message: 'invalid --run "${values.run}": expected a run id of the form run_<suffix>'`,
   `next: "pass --run <runId> as printed by pnpm cli list --state-root ${stateRoot}"`,
   `runId: values.run` (D30 precedent: the refusal carries the raw operator value). The
   subsequent `parseRunId` keeps the branded type and can no longer throw.
2. **Blank `--reason` (`pause.ts`).** After the existing `--clear`+`--reason` refusal at
   `:67-74` (its precedence is pinned and unchanged), when `values.reason !== undefined &&
   values.reason.trim() === ""`: `cliFail` `stage: "parse-args"`,
   `message: 'invalid --reason "${values.reason}": pause reason must be a non-empty string'`
   (mirrors the controller's own wording so the rule cannot drift),
   `next: "pass --reason <text> or omit it"`, `runId: values.run`. Placed before the
   `EventStore` lookup — argv refuses before state is read.
3. **Blank `--key`/`--node`/`--actor` (`inject.ts`).** Alongside the existing per-type and
   confidence blocks (`:92-140`), still before the lookup at `:146`: for each of the three flags,
   when supplied and `trim() === ""`, `cliFail` `stage: "parse-args"`,
   `message: 'invalid --key "${raw}": injection key must be a non-empty string'` (resp. `nodeId`,
   `actor` — the exact strings the plane prints today via `injection.ts`'s `payload.` →
   `injection ` rewrite), `next: "pass --key <name>"` / `"pass --node <id>"` /
   `"pass --actor <who> or omit it"`, `runId: values.run`. The `--node` guard keys on the flag,
   not the type (a `fact` may legally carry `--node`, `injection.ts:82`). **No catch is added or
   widened anywhere**; the plane call, lookup refusal, and success echo are byte-identical; run
   lookup and `injectFlowchartRun`/`pauseFlowchartRun` failures keep `stage: "validation"`.

**Tests** (extend `pause-inject.test.ts`; `readEventLines` and both run fixtures are already in
the harness): `parseCliErrorJson` whole-field pins (command/stage/message/next/runId) for
`pause --run banana`, `inject --run banana --type fact --key k --value v`, blank `--reason` on
the waiting run, and blank `--key`/`--node`/`--actor`; for each state-adjacent case assert
`events.jsonl` gained no event and, for blank `--reason`, that no pause token file exists after
the refusal; order pin `pause --run banana --state-root <nonexistent dir>` refuses parse-args
(proving the guard precedes all state I/O). Existing pins hold — the `stage: "lookup"` cases at
`:476/:491` use *valid-format* missing ids the guard does not fire on, and every D30 pin string
(`:255-336`) is untouched.

**Freeze/PR#12 check:** no JSON contract, no Event, no `main.ts`, no plane file;
`src/run/injection.ts` and `pause-controller.ts` are read for wording only, not edited. Neither
src file nor the test file is in PR #12. `inject.ts`/`pause-inject.test.ts` are D30-owned files
reopened for **new** defects only — the five surfaces above are all outside D30's closed scope
(GPT-r7's D30 report pins type/confidence exclusively). Disjoint from Ranks 2 and 3.

---

## Rank 2 (D32) — `commits` stops blaming the run for argv and environment faults

**Why second.** `commits` is the verb that writes the operator's git history — the surface where
a wrong remedy costs the most cleanup. Five defect surfaces, all reproduced live at HEAD against
the COMPLETED flowchart run (`run_64ec38e8…`, one node `only`, `commits preview` prints a real
proposal and `preview --json` a well-formed `COMMITS_PREVIEW`):

- `commits preview --run banana` → `Invalid RunId` as `stage: "validation"` + doctor next
  (`commits.ts:209`, and `:258` on apply) — same class as Rank 1;
- `commits preview --run <cr> --nodes bogus` → `{"…","stage":"validation","message":"unknown
  flowchart node id(s): bogus","next":"fix the reported error, then retry; use pi-sparkle doctor
  for preflight"}` — a mistyped node id gets the preflight remedy, and nothing names `--nodes`
  or tells the operator where node ids can be read;
- `commits preview --run <cr> --nodes ","` → `"no completed nodes to commit"` — the CSV parsed
  to **zero ids** (`parseCommitNodeIdsCsv` trims and filters, `decision-commit.ts:147-153`), the
  empty filter sailed through, and the error blames the run's completion state for an argv
  mistake (probed identically on the genuinely-unfinished waiting run, where the same message is
  *true* — the operator cannot tell the two apart);
- `commits apply --run <cr> --file /tmp/r8probe/nope.json --repo …` → raw
  `"ENOENT: no such file or directory, open '/tmp/r8probe/nope.json'"`, `stage: "execute"`,
  doctor next — an unreadable operator-supplied path surfaces as an execution failure with no
  flag named (`:261` bare `readFile`);
- `commits apply --run <cr> --repo /tmp/r8probe/notgit` → `"apply requires a git work tree at
  /tmp/r8probe/notgit: fatal: not a git repository …"` — the message is right, but the thrown
  `DomainValidationError` (`:269`, and `:265` for a missing repo) crosses into `main.ts` and
  picks up the doctor next instead of naming `--repo`.

**Exact files and edits:** `src/cli/commits.ts` + `test/integration/cli/commits.test.ts` only.
`src/tools/decision-commit.ts` is not edited.

1. **Malformed `--run`:** the same `isRunId` guard as Rank 1, in both `previewCommand` and
   `applyCommand`, before `loadCommitInput` — same message/next/`runId` contract.
2. **Empty `--nodes` selection:** pure argv, so before any state read: parse the CSV once per
   command (`const nodeIds = parseCommitNodeIdsCsv(values.nodes)`); when `values.nodes !==
   undefined && nodeIds.length === 0`, `cliFail` `stage: "parse-args"`,
   `message: 'invalid --nodes "${values.nodes}": selects no node ids'`,
   `next: "pass --nodes <id,id> or drop the flag to use every completed node"`. A trailing comma
   that still names ids (`--nodes only,`) keeps today's lenient trim — only the
   selects-nothing case refuses.
3. **Unknown `--nodes` ids:** hoist the `filterDecisionCommitNodeIds(knownIds, nodeIds)` call out
   of `proposalsFromInput` (`:75`, module-local — the function signature changes to accept the
   already-filtered ids) into each command body, wrapped in a try/catch containing **only that
   synchronous call** (the lexical parseArgs-catch precedent): on its `DomainValidationError`,
   `cliFail` `stage: "validation"` (the valid set is run state, not CLI knowledge — honest
   classification), the helper's own message,
   `next: "pass --nodes ids from this run's flowchart; pi-sparkle inspect --run ${runId}
   --state-root ${stateRoot} lists its nodes"` (verified live: inspect prints
   `flowchart: COMPLETED (only=COMPLETED)`), `runId`. `generateDecisionCommits` and the `--file`
   selection stay **outside** every catch: a true "no completed nodes to commit" keeps its
   current classification.
4. **`--file` read and parse:** two narrow trys in `applyCommand`, one around `readFile(
   values.file, "utf8")` → `cliFail` `stage: "lookup"`,
   `message: 'cannot read --file ${values.file}: ${error.message}'`,
   `next: "check the --file path; commits preview --json writes an input this flag accepts"`,
   `runId`; one around `parseDecisionCommitFile(...)` → `stage: "validation"`, the parser's own
   message prefixed with the path, `next: "fix ${values.file} or regenerate it with commits
   preview --json"`, `runId`.
5. **Repo preflight:** convert the two throws at `:264-269` to direct `cliFail` with
   `stage: "preflight"` (doctor's precedent for environment checks), the **same message wording**
   (so the existing pin `/git|work tree|not a git/i` at `commits.test.ts:273` holds
   byte-for-byte), `next: "pass --repo <path to a git work tree>"` (missing) /
   `"run git init in ${repo} or pass --repo <git work tree>"` (not a work tree), `runId`. Exit
   stays 1, stdout stays empty — the `:267-276` test passes unchanged.

**Tests** (extend `commits.test.ts`; `tinyCompletedRun` is already in the harness):
`parseCliErrorJson` whole-field pins for all five refusals on both subcommands where they apply;
the empty-CSV case run with a **nonexistent** `--state-root` to pin argv-before-state order; the
unknown-ids case pins `runId` and a `next` matching `/inspect --run/`; `--nodes only,` still
previews the proposal (lenient-trim boundary). Existing pins hold — partial-apply notes
(`:405-550`), `--nodess` parser refusal (`:587-594`), lookup on a valid-format missing run
(`:377-379`), the COMMITS_PREVIEW `deepEqual`, and the work-tree regex all keep their strings.

**Freeze/PR#12 check:** `COMMITS_PREVIEW` byte-identical; no Event, no `main.ts`;
`partialApplyNote`/`nodesCsvSelectsExactly` (D20's landed contract) untouched; neither file is in
PR #12; `commits.ts` was last owned by D20/D26, both closed KEEP. Disjoint from Ranks 1 and 3.

---

## Rank 3 (D33) — `episode` id guard, plus event lines that answer "what and since when"

**Why third.** The remaining wrong-remedy defect heads the batch; the queued Fable-r7 rider rides
on the touch exactly as the round brief directs ("queued as rider on next episode.ts touch, not a
padding slot"). Reproduced live at HEAD:

- `episode events --episode banana` and `episode close --episode banana --status FAILED` →
  `{"ok":false,"command":"episode","stage":"validation","message":"Invalid EpisodeId: expected
  \"ep_<suffix>\"","next":"…doctor…"}` — `episode.ts:68` parses the id bare, *before* the
  subcommand branches, so the defect covers both verbs and even masks the unknown-subcommand
  refusal (probed: `episode nonsense --episode banana` reports the id error, not "Unknown
  episode command");
- `episode events --episode ep_r8probe01` (human mode) → exactly two bare lines,
  `EPISODE_OPENED` / `EPISODE_WAITING`, while the `--json` twin carries `occurredAt`, `reason:
  "acceptance-incomplete"`, and `requiredEvidence: ["tests"]` — the human surface withholds every
  fact an operator polls this command for (what is it waiting on, since when), on the episode
  plane whose whole point (D20/D26 lineage) is naming required evidence.

**Exact files and edits:** `src/cli/episode.ts` + `test/integration/m3/episode-cli.test.ts` only.

1. **Malformed `--episode`:** replace the bare `parseEpisodeId` at `:68` with an `isEpisodeId`
   guard (exported by `domain/ids.js`): when false, `cliFail` `stage: "parse-args"`,
   `message: 'invalid --episode "${values.episode}": expected an episode id of the form
   ep_<suffix>'`, `next: "pass --episode <epId> as printed by pnpm cli list --state-root
   ${stateRoot} --episodes"` — the same episodes-list retarget the lookup path at `:82/:135`
   already uses, so the malformed and missing cases hand the operator the same door. Guard
   position is unchanged (after help/required, before the subcommand branches): both outcomes it
   can mask are parse-args refusals naming a real mistake.
2. **Designed human line format** (the rider — `--json` byte-identical, JSONL of raw events):
   one tab-separated line per event, timestamp first, mirroring `list`'s row style, using each
   type's own timestamp field (`events.ts:13-40` — there is no shared field, which is why this
   needed a designed format and not a mix-in):
   - `${occurredAt}\tEPISODE_OPENED\t${episode.objective}`
   - `${attachedAt}\tRUN_ATTACHED\t${runId}`
   - `${occurredAt}\tEPISODE_WAITING\t${reason}${requiredEvidence.length > 0 ? `: ${requiredEvidence.join(", ")}` : ""}`
   - `${closedAt}\tEPISODE_CLOSED\t${status}${outcomeId !== undefined ? ` outcome=${outcomeId}` : ""}`
   Every byte printed is already emitted by the `--json` path today — no new disclosure surface.
   `EPISODE_USAGE` is untouched (it documents flags, not the line shape).

**Tests** (extend `episode-cli.test.ts`): update the one existing bare-line pin (`:174`,
`deepEqual` on `["EPISODE_OPENED"]`) to assert three tab-separated fields whose first
`Date.parse`s and whose second/third are `EPISODE_OPENED` / the seeded objective; add whole-line
pins for all four types — WAITING via the existing refused-close fixture (pin
`acceptance-incomplete: tests` in the detail field), CLOSED with and without `--outcome`,
RUN_ATTACHED seeded directly through `EpisodeEventStore.append` (its shape passes
`validateEpisodeEvent`); `--json` unchanged-bytes pin on the same fixture (`:143` already
deepEquals the type sequence); malformed-id `parseCliErrorJson` pins on **both** subcommands with
`next` matching `/--episodes/`, plus a no-write pin (refused close on a malformed id leaves the
snapshot log untouched). The lookup retarget tests (`:240-256`) and the close/waiting flow pins
hold — none of their strings change.

**Freeze/PR#12 check:** no Event type, no schema change — the line format is a CLI view of
validated events; `episode events --json`, `episode close` dialect (D20's refuse-`--json` pin),
and `EPISODE_USAGE` are byte-identical; `warnTruncatedJsonl` disclosure unchanged (the truncated
fixture still prints its surviving line, now timestamped). Neither file is in PR #12 (`m3/` has
no #12 files); `episode.ts` was last touched by D26 (closed KEEP). Disjoint from Ranks 1 and 2.

---

## HOLD / NO_HIGH_VALUE — everything else examined, one line each

- **`pause`/`inject` on non-flowchart or terminal runs**: reproduced live (`pause --run <plain>`
  → `"Flowchart run … checkpoint is missing flowchart snapshot"` — a corruption-shaped message
  for "this is not a flowchart run"; `"cannot pause/inject into a COMPLETED run"` with doctor
  next) — the messages are owned by `flowchart-run.ts` (#12-held) and the classification by
  `main.ts` (#12-held); a CLI-side checkpoint-shape preflight would restate plane rules GPT-r6/r7
  told D30 not to duplicate. HOLD behind PR #12.
- **`inject --node <unknown-id>`**: plane-owned check against run state (`unknown node: X`);
  unlike D32's `--nodes` (where `commits.ts` already owns the filter call), inject has no
  CLI-local seam — HOLD with the item above.
- **`commits` "no completed nodes to commit" when genuinely nothing completed**: honest
  validation; retargeting its next would mean widening a catch around `generateDecisionCommits`.
- **`unblock` argv dialect / G5 / G7 / E4 `[--outcome]` / cost verb / completions**: `main.ts`
  remainder, HOLD behind PR #12 (unchanged from R6/R7).
- **Windows cli-smoke step / status-matrix / data-dictionary / README riders**: HOLD behind
  PR #12 (all in its diff); every batch above defers its docs rider.
- **`episode close --outcome` value domain**: the event schema deliberately accepts any string
  (`events.ts:123-126`); refusing shapes would invent a rule no plane owns — needs design, not a
  slot.
- **F7 oauth discoverability / F15 perms window** (`auth.ts`): still NO_HIGH_VALUE per R5; D28
  closed KEEP and re-probing found no new auth defect.
- **`doctor` post-D29**: `--help`/`-h`/positional/`--bogus` all verified healthy; `--json`
  frozen; no new defect found. `doctor-overlay.ts` read — no operator-facing gap.
- **`list`/`models`/`validate`/`migrate-legacy`/`pi-compat`/`init`**: probed live at HEAD — all
  speak parse-args with working `--help` after D25-D27; `list` flag/value refusals are complete
  (status, sort, and mode conflicts all targeted); nothing left worth a slot.
- **New `--json` surfaces (`inject`/`pause` success echoes)**: write-op echoes; no script demand
  demonstrated, and this round's wrong-remedy defects outrank cosmetic contracts by the round
  brief's own rule.
- **D7 Variant B**: frozen by decision — not ranked.

## Final ranking

1. **D31 — `pause`/`inject` argv value preflight (malformed `--run`, blank
   `--reason`/`--key`/`--node`/`--actor`)** — `src/cli/pause.ts` + `src/cli/inject.ts` +
   `test/integration/cli/pause-inject.test.ts`. The two mid-incident verbs stop classifying
   pasted-wrong ids and blank flag values as validation failures with the doctor remedy (probe:
   `pause --run banana` → `stage: "validation"`, doctor next, flag never named); guards reuse
   `isRunId` and the plane's own non-empty wording; no catch added or widened.
2. **D32 — `commits` argv/environment refusal retargeting (malformed `--run`, empty and unknown
   `--nodes`, unreadable `--file`, repo preflight)** — `src/cli/commits.ts` +
   `test/integration/cli/commits.test.ts`. The git-history verb stops blaming the run for an
   empty `--nodes` CSV, stops routing a mistyped node id to doctor preflight, and names
   `--file`/`--repo` in their own refusals (probe: `--nodes ","` → `"no completed nodes to
   commit"`; `--file` → raw ENOENT at `stage: "execute"`); `COMMITS_PREVIEW` and every D20
   partial-apply pin byte-identical.
3. **D33 — `episode` malformed-id guard + designed `events` line format** — `src/cli/episode.ts`
   + `test/integration/m3/episode-cli.test.ts`. Both subcommands stop reporting a malformed
   `--episode` as validation-with-doctor-remedy, and the human `events` surface prints
   `<timestamp>\t<TYPE>\t<detail>` instead of bare type names (probe: today it prints
   `EPISODE_WAITING` and withholds `acceptance-incomplete: tests`), discharging the Fable-r7
   rider on a real defect's touch; `--json` byte-identical.

The three batches are mutually file-disjoint, disjoint from PR #12's live file list, reopen
D28-D30 files only for defects outside their closed scopes, and can be dispatched concurrently.
