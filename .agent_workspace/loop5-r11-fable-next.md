# Loop 5 · Round 11 — Fable-next: the three implementable operator batches after Round 10

Slot: Fable-r11-next (claude-fable-5). Analysis/spec only; no `src/` edits by this agent; not merged
to the parent integration branch.

Ranked at HEAD **`d056bcf66a70f61b6c0520d372610a2f72b8e889`**
(`docs(agent): record Fable-r11-next dispatch id`) on `origin/cursor/pi-sparkle-sota-opt-0da8`,
fetched fresh (`git fetch origin cursor/pi-sparkle-sota-opt-0da8`) and re-fetched after probing —
origin moved once during this round, from the Round 10 closeout `1966ebb` to `d056bcf`, and the
whole delta is one line of `docs/agent-progress.md` (`git diff --stat 1966ebb d056bcf`);
**every `src/` and `test/` byte ranked here is identical at `1966ebb` and `d056bcf`**. HEAD
contains the three Round 10 merges as ancestors, verified with `git merge-base --is-ancestor`:
`a777832` (D37), `39d4f33` (D38), `f447946` (D39), and the closeout `1966ebb` (`docs(agent):
record D37 KEEP; close Round 10`). Method: direct full reads at HEAD of
`src/cli/{auth,list,episode,pause,inject,models,commits,validate}.ts` and
`src/run/{inventory,injection}.ts`, `src/episode/closure.ts`, `openEpisode` in
`src/episode/manager.ts`, targeted greps of `src/run/checkpoint-store.ts` and
`src/tools/decision-commit.ts` for throw sites, and pin greps across `test/` for every string a
batch below would change (`no completed nodes` has **zero** pins anywhere in `test/`;
`no durable checkpoint` is pinned only for `resume`/`answer` in `test/integration/cli/cli.test.ts`
— a PR #12 test file none of the batches touch; `already-closed` and `satisfy required evidence`
are pinned nowhere). PR #12 file list pulled live twice via
`gh pr view 12 --json files,state,headRefName` (OPEN, head `cursor/merge-preview-release-8011`;
src set unchanged across the round: `adaptation/eval-routing.ts`, `cli/adapt.ts`,
`cli/inspect-format.ts`, `cli/main.ts`, `feedback/redaction.ts`, `pi-adapter/runtime.ts`,
`run/flowchart-run.ts`, `run/inspection.ts`, plus its test files — re-listed in §0).
**Every defect claimed below was reproduced live on this VM** (`pnpm install --frozen-lockfile`
clean, Node v22.14.0 — engines `>=22.19.0` warning only) via `node_modules/.bin/tsx
src/cli/main.ts` from a controlled cwd, against `/tmp/r11probe`: a real fake-executor COMPLETED
children run (`run --project … --objective …`, default executor), two clones of its run directory
— one with `checkpoint.json` deleted, one with `checkpoint.json` overwritten with non-JSON — a
real BLOCKED flowchart run started from the `init` example flowchart, three hand-seeded OPEN
episodes (`openEpisode` + both stores, the `episode-cli.test.ts` harness pattern), a
legacy-shaped root for migrate-legacy, and a regular file at `/tmp/r11probe/blocker` used as a
`--state-root`. Probe outputs are quoted in place; every refusal quoted exited 1 and every
success quoted exited 0 unless stated otherwise. Baseline: the three test files the batches
extend pass **92/92** at HEAD (`npx tsx --test` — per file: `commits.test.ts` 35,
`pause-inject.test.ts` 34, `episode-cli.test.ts` 23).

## 0. Round 10 closeout honored; constraints every batch satisfies

- **Not re-ranked.** D37 KEEP `a777832` (blank `--state-root` parse-args on
  list/pause/inject/commits/models/auth and flowchart-only validate; `--children` ignores
  `--state-root` by design; no shared helper in `errors.ts` — every guard below stays copied
  per module), D38 KEEP `39d4f33` (init blank `--dir`, obstruction preflight, `writeFile` seam;
  migrate-legacy blank-root + coded-fs `lookup`), D39 KEEP `f447946` (episode corrupt-log
  envelopes; blank-root after the D33 dispatch order). Per the round brief their files are free
  only for **NEW** defects: Rank 1 reopens `commits.ts` (D32/D20 closed scopes), Rank 2 reopens
  `inject.ts` (D30/D31/D37 scopes), Rank 3 reopens `episode.ts` (D33/D39 scopes) — each for
  defects none of those decisions classified, stated at the batch. Earlier D1–D36 KEEP as
  recorded in `docs/agent-decisions.md` (re-read in full this round, with
  `docs/agent-progress.md`).
- **PR #12 disjointness, re-pulled live.** #12's current src files: `adaptation/eval-routing.ts`,
  `cli/adapt.ts`, `cli/inspect-format.ts`, `cli/main.ts`, `feedback/redaction.ts`,
  `pi-adapter/runtime.ts`, `run/flowchart-run.ts`, `run/inspection.ts`; its test files:
  `test/integration/cli/{cli,inspect-follow,run-cost-cap}.test.ts`,
  `test/integration/m1/cli-children.test.ts`, `test/integration/m2.5/flowchart-run-cap.test.ts`,
  `test/integration/pi-adapter/costgate-cli-warning.test.ts`, unit
  `adapt/cost-flag/inspect-format/readme-command-parity` files, and the redaction/inspection/
  package/pi-boundary/eval-routing/promotion/active-routing/flowchart-learned-routing/
  release-gate-policy sets. **No ranked file is in that set** (checked name-by-name; the six
  src/test files ranked below are all absent). No batch edits `main.ts` — every conversion
  happens inside the verb module that owns it, before the throw would cross into main's held
  catch, so the blocked-next four-line routed prefix and the eleven-case crash probe are
  untouched trivially.
- **Freeze gate.** No live R1/`selectArm`/`planTaskTopology`; ADR-006 stays Proposed;
  `INSPECT_SUMMARY` four keys untouched; doctor `--json` byte-untouched (no batch opens
  `doctor.ts`); doctor `runStates` stays PLANNING/RUNNING (Rank 1's evidence *depends* on that
  pin — see the probe); eight-member `RunStatus`; **no new Event types and no new JSON key
  anywhere** — `COMMITS_PREVIEW`, `episode events --json`, `RUN_LIST`, `MODELS_LIST`,
  `AUTH_STATUS`, `VALIDATE_OK`, `INIT_EXAMPLES` are byte-identical (every new refusal fires
  before its verb's JSON assembly); no new `stage` value (`parse-args`/`lookup`/`validation`/
  `close` all exist in these modules today); `package.json` untouched (`private: true` stays);
  no Outcome-supported claims; D7 Variant B untouched; `episode close --outcome` **value
  domain** untouched (the any-string design HOLD stands — Rank 3 refuses only the
  blank/whitespace instance under the D31 blank-value rule and says so). Windows CI: no batch
  touches `cli-children.test.ts` or `doctor.test.ts`, and every new fixture below is portable
  (argv + capture-io + `mkdtemp` construction; no chmod-dependent case is load-bearing).

**The round's through-line, found by probing every free verb at HEAD:** Rounds 8–10 made the
free verbs refuse bad flags, bad values, and bad targets *before* touching state. What is still
live is the boundary **after** state is read: three free verbs still hand faults that argv was
innocent of — or argv faults discovered late — to `main.ts`'s generic catch, whose one remedy
(`use pi-sparkle doctor for preflight`) is provably empty for every one of them. `commits`
throws all four of its stored-ledger faults (non-flowchart checkpoint, absent checkpoint,
corrupt checkpoint, zero completed nodes) at a doctor that has **no checkpoint inventory at
all** — probed: on a root holding both a deleted and a corrupt `checkpoint.json`, `doctor
--json` passes every inventory and the string `checkpoint` appears nowhere in its report,
because both runs are COMPLETED and `runStates` is pinned to PLANNING/RUNNING. `inject` still
lets two pure argv mistakes — a non-scalar `--value` and a flag the chosen `--type` does not
take — travel through the run lookup into the plane's thrower and come back as `stage:
"validation"` with the doctor next, never naming the flag (the exact defect class D30 fixed for
`--confidence`). And `episode close` persists a blank `--outcome` into the append-only event
log as `"outcomeId":""` while `episode events` silently ignores `--status`/`--outcome`, and the
one refusal it does issue for a terminal re-close tells the operator to do two things that will
both refuse. Grep confirms no closed decision pinned any of these: D32/D20 pinned commits' argv
and partial-apply surfaces, D30/D31 pinned inject's type/confidence/blank values, D33/D39
pinned episode's ids, event lines, corrupt logs and blank root — none classified the six
defects below.

---

## Rank 1 (D40) — `commits` stops routing its four stored-ledger faults to a doctor with no checkpoint inventory

**Why first.** Highest frequency and the deadest remedy of the round. The *default* run kind
(`run` with no `--flowchart`) produces a checkpoint with no flowchart, so the very first
`commits preview` a preview operator tries against the README's default run already lands in
this class — and `apply`, the verb about to write into their git history, reports the same dead
end. All reproduced live at HEAD:

- **non-flowchart run** (the default children run, COMPLETED): `commits preview --run
  run_186d4cfe-… --state-root /tmp/r11probe/state` →
  `{"ok":false,"command":"commits","stage":"validation","message":"checkpoint has no flowchart;
  decision-to-commit requires a flowchart run","next":"fix the reported error, then retry; use
  pi-sparkle doctor for preflight"}` — there is no error to fix and nothing for doctor to find;
  `commits apply … --repo /tmp/r11probe/proj` reproduces the identical envelope;
- **absent checkpoint** (run directory with events but `checkpoint.json` deleted — a run that
  died before its first durable write): `commits preview --run run_…0001 …` → same envelope
  with `message: "Run run_00000000-0000-4000-8000-000000000001 has no durable checkpoint"`;
- **corrupt checkpoint** (`checkpoint.json` overwritten with `not json{`): same envelope with
  `message: "Invalid checkpoint /tmp/r11probe/state/runtime/runs/run_…0002/checkpoint.json:
  Unexpected token 'o', \"not json{\n\" is not valid JSON"`;
- **zero completed nodes** (a real BLOCKED flowchart run started from the `init` example):
  `commits preview --run run_8f9e485f-… …` → same envelope with `message: "no completed nodes
  to commit"`; `apply` identical. This is not even a fault of the tree — it is a fact about the
  run's progress, reported as an execution failure with a preflight remedy;
- **the remedy is provably empty:** `doctor --json --state-root /tmp/r11probe/state` on the
  root holding all of the above reports `run-state-inventory` **ok**, `runStates.entries: []`,
  `runStates.scanErrors: []` (both damaged runs are COMPLETED, and doctor inventories only
  PLANNING/RUNNING event logs — a frozen pin), and the string `checkpoint` appears nowhere in
  the entire JSON report. The only FAIL is the unrelated Node-engines check on this VM.
  Contrast the corrupt run *event log*, where doctor's inventory fails naming the exact file —
  which is why that family stays out of this batch's catch (see HOLD).

**Exact files and edits:** `src/cli/commits.ts` + `test/integration/cli/commits.test.ts` only.
`src/tools/decision-commit.ts` and `src/run/checkpoint-store.ts` are not edited (the D32 rule) —
the messages are theirs; only the envelope converts, inside the verb that owns it. `commits.ts`
adds `errorCodeOf` to its existing `./errors.js` import (the D39 discrimination).

1. **Absent checkpoint → refusal in-module.** `loadCommitInput` already returns `undefined`
   after an in-module `cliFail` for the not-found run; the `throw new
   DomainValidationError('Run ${runId} has no durable checkpoint')` (`commits.ts:63`) becomes
   the same pattern: `cliFail` `command: "commits"`, **`stage: "lookup"`** (an absent stored
   record, the house class for `--file` ENOENT and the missing run), message bytes kept,
   `next: 'this run recorded events but no durable checkpoint; pi-sparkle inspect --run
   ${runId} --state-root ${stateRoot} shows its status — only checkpointed runs have a decision
   ledger'`, `runId`.
2. **Corrupt checkpoint → validation with an honest next.** Wrap the
   `new CheckpointStore(stateRoot, runId).read()` + `validateCheckpoint(raw)` pair
   (`commits.ts:61-65`) in one narrow try catching **only** `error instanceof
   DomainValidationError && errorCodeOf(error) === undefined` (a coded throw — ENOTDIR on a
   file-as-root, EACCES, the lock family — must keep reaching `main.ts`'s routing untouched;
   see HOLD): `cliFail` `command: "commits"`, `stage: "validation"` (stored-state fault, the
   D39 precedent), message bytes kept (the store already names the file and the reason),
   `next: 'repair or move aside the checkpoint file named above, then retry; pi-sparkle doctor
   does not inventory checkpoint files'`, `runId`. The catch is around the read+validate only:
   `EventStore.readAll` at `:47` stays outside it, so a corrupt *event log* keeps today's
   main-routed envelope whose doctor remedy genuinely answers.
3. **Non-flowchart checkpoint → validation naming the run kind.** Wrap
   `assembleDecisionCommitInput(checkpoint, read.events, runId)` (`commits.ts:66`, throws
   `decision-commit.ts:161`) in an identical narrow try: `stage: "validation"`, message bytes
   kept, `next: 'decision commits are generated from a flowchart run's checkpoint; this run
   was not started with run --flowchart, so it has no decision ledger'`, `runId`. No claim
   about other surfaces (list does not show run kinds; nothing untested is promised).
4. **Zero completed nodes → validation with the inspect retarget.** Wrap the two
   `proposalsFromInput(...)` call sites (`previewCommand` `:291`, `applyCommand` `:393`) in the
   same narrow try (covers both throw sites — `commits.ts:84` for a `--file` + `--nodes`
   selection of nothing, `decision-commit.ts:199` for generated proposals): `stage:
   "validation"`, message bytes kept, `next: 'pi-sparkle inspect --run ${runId} --state-root
   ${stateRoot} lists its nodes; commit proposals exist only for COMPLETED nodes'`, `runId` —
   the same inspect claim D32's unknown-nodes remedy already makes, so no new promise is
   invented.

**Tests** (extend `commits.test.ts`; harness already has `parseCliErrorJson`, flowchart run
construction, and checkpoint-file surgery — it deletes/edits `checkpoint.json` today): whole-
field pins (command/stage/message shape/next) for all four envelopes, each on `preview` and the
two run-kind ones on `apply` as well; the `--file` + `--nodes` zero-selection variant of the
no-completed-nodes envelope (drive `apply --file <preview of another node>` `--nodes <id absent
from the file>`); a no-git pin on `apply` (each refusal leaves the repo's `git log` untouched);
two passthrough pins that the catches stay narrow — a corrupt *event log* still reaches main's
generic envelope (`next` still names doctor; doctor genuinely answers there), and a coded fs
fault (`--state-root <regular file>`) keeps today's main-routed `ENOTDIR` report byte-identical;
and one `COMMITS_PREVIEW` pin that the JSON success path is byte-identical on a completed
flowchart run. Existing pins hold: grep confirms no test anywhere pins the four current
envelopes (`no completed nodes` appears nowhere in `test/`; `no durable checkpoint` pins are
`resume`/`answer` in PR #12's `cli.test.ts`, untouched), and the D32/D20 pins (run shape, empty
CSV, unknown nodes, `--file` read/parse, repo preflight, partial-apply notes) all trigger on
inputs these edits never reach — all 35 baseline tests pass unchanged.

**Freeze/PR#12 check:** `COMMITS_PREVIEW` byte-identical (all conversions fire before the JSON
print); no Event, no `main.ts`, no `decision-commit.ts`/`checkpoint-store.ts` edit; no new
stage value. `commits.ts` reopened outside D32's closed scope (argv refusals) and D20's
(partial-apply disclosure) — neither classified the checkpoint-read or proposal-generation
faults; this is stated reopening. Neither file is in PR #12. Disjoint from Ranks 2 and 3.

---

## Rank 2 (D41) — `inject` refuses a non-scalar `--value` and a flag its `--type` does not take, as the argv mistakes they are

**Why second.** Pure argv faults with the wrong classification and the dead remedy — the exact
class D30 closed for `--confidence`, still live one flag over because the thrower runs *after*
the run lookup. Reproduced live at HEAD (all against real runs under `/tmp/r11probe/state`):

- `inject --run run_186d4cfe-… --type fact --key k1 --value '{"a":1}'` →
  `{"ok":false,"command":"inject","stage":"validation","message":"fact value must be a JSON
  scalar or bare string","next":"fix the reported error, then retry; use pi-sparkle doctor for
  preflight"}` — `--value` never named, doctor offered for a typo; `--value '[1,2]'` and
  `--value 'null'` reproduce it byte-identically (`parseFactValue`, called at `inject.ts:209`
  after the `EventStore` lookup, throws through `main.ts`);
- `inject --run run_8f9e485f-… --type skip --node work --key k1 --value v1` →
  `{"ok":false,…,"stage":"validation","message":"injection key is not valid for skip",
  "next":"fix the reported error, then retry; use pi-sparkle doctor for preflight"}` — the
  plane's relevance rule (`injection.ts:44-50`: `fact` takes `key`/`value`/`nodeId`;
  `override`/`skip` take only `nodeId`) reported as a state fault with the preflight remedy;
  `inject … --type override --node survey --confidence 0.5 --value v1` reproduces it as
  `injection value is not valid for override`. The house model is `pause --clear does not
  accept --reason` — refused as `parse-args` before any state read (`pause.ts:67-74`).

**Exact files and edits:** `src/cli/inject.ts` + `test/integration/cli/pause-inject.test.ts`
only. `src/run/injection.ts` is not edited — its rules are imported facts, not restated; the
plane keeps its own validation for programmatic callers.

1. **Flag relevance → parse-args.** After the existing per-type required-flag checks
   (`inject.ts:92-118`) and before the confidence conversion: for `values.type === "override" ||
   values.type === "skip"`, refuse a supplied `--key` or `--value` — `cliFail` `command:
   "inject"`, `stage: "parse-args"`, `message: 'inject --type ${values.type} does not accept
   ${flag}'` (the D26/pause wording), `next: 'drop ${flag}; --key and --value apply to --type
   fact'`, `runId: values.run`. `--node` on `fact` stays legal (the plane allows it —
   `injection.ts:78`), and `--confidence` stays legal on every type (validated by the plane for
   all kinds; probed: a fact injection with `--confidence 0.5` succeeds, exit 0 — that is plane
   behavior, not a silent ignore). No existing pin passes an irrelevant flag, so D30/D31
   precedence pins keep their trigger inputs.
2. **`--value` domain → parse-args, single call.** Where the plane's own decoder already
   defines the domain, ask it once: hoist the `parseFactValue(values.value)` call out of the
   request assembly (`inject.ts:209`) into the value-check block (after the blank-flags loop
   `:145-160`, before the D37 blank-root guard `:166` — path-free argv stays ahead of the root,
   preserving the pinned order), wrapped in a narrow try catching `DomainValidationError` only:
   `cliFail` `command: "inject"`, `stage: "parse-args"`, `message: 'invalid --value "${raw}":
   fact value must be a JSON scalar or bare string; objects, arrays, and null are refused'`
   (the flag named, the plane's rule quoted, the same raw-echo style as `--confidence`),
   `next: 'pass --value <json-scalar|text> as documented in pi-sparkle inject --help'`,
   `runId: values.run`. The parsed result is passed through to the request so the value is
   decoded exactly once (the D32 single-call rule). A JSON number that parses but is not finite
   (`--value 1e999`) is refused by the same rule (`isFactScalar` requires finite). `--value ""`
   stays accepted — an empty-string fact is legal in the plane today (`isFactScalar("")` is
   true) and refusing it would invent a rule no plane owns.

**Tests** (extend `pause-inject.test.ts`; harness has `parseCliErrorJson` + real seeded runs):
whole-field pins for `--type skip --key`, `--type skip --value`, `--type override --key`,
`--type override --value`, and `--value` `'{"a":1}'` / `'[1,2]'` / `'null'` / `'1e999'`; an
order pin that `--type banana --key k --value '{"a":1}'` still reports the unknown type first
(D30 precedence untouched) and that `--type fact --value '{"a":1}' --state-root ""` reports the
value before the blank root is *not* required — the D37 pin used a nonblank root, and the new
guard sits with the other path-free argv checks ahead of the root guard, so pin the mixed case
as value-first with a nonexistent root to show no state was read; a passthrough pin that
`--type fact --node <id>` still injects (exit 0, plane accepts a fact with a nodeId); and a
no-write pin (each refusal leaves the run's `events.jsonl` byte-identical). Existing pins hold:
grep confirms no test passes `--key`/`--value` with `override`/`skip` or a non-scalar
`--value`, so all 34 baseline tests pass unchanged.

**Freeze/PR#12 check:** no JSON surface exists on `inject`; `INJECT_USAGE` bytes untouched (it
already documents the value domain and the per-type flags — the behavior now matches it); no
Event, no `main.ts`, no plane edit; no new stage value. `inject.ts` reopened outside D30's
closed scope (type/confidence), D31's (blank key/node/actor, run shape), and D37's (blank
root) — none classified the `--value` domain or flag relevance; stated reopening. Neither file
is in PR #12. Disjoint from Ranks 1 and 3.

---

## Rank 3 (D42) — `episode` stops persisting a blank `--outcome`, gives the terminal re-close a usable remedy, and refuses the flags `events` ignores

**Why third.** Lower frequency than Ranks 1–2 but the first defect is a *write*: a blank flag
value recorded forever in an append-only log the CLI refuses to rewrite. All reproduced live at
HEAD (episodes seeded OPEN via the test-harness pattern):

- **the blank write:** `episode close --episode ep_probe1 --status FAILED --outcome ""
  --state-root /tmp/r11probe/state` → stdout `Episode ep_probe1: FAILED`, **exit 0** — and
  `episode events --episode ep_probe1 --json` shows the persisted event
  `{"type":"EPISODE_CLOSED","episodeId":"ep_probe1","status":"FAILED","closedAt":"…",
  "outcomeId":""}`. The COMPLETED path reproduces it with whitespace: `--status COMPLETED
  --outcome "  "` → exit 0, `"outcomeId":"  "`. The exact artifact of `--outcome "$OC"` with an
  unset variable, recorded as if meant — the D31 blank-value rule (`pause --reason`,
  `inject --key`) applied to the one free-verb flag it never covered;
- **the unusable remedy:** with `ep_probe2` closed FAILED, `episode close --episode ep_probe2
  --status COMPLETED …` → `{"ok":false,"command":"episode","stage":"close",
  "message":"already-closed","next":"satisfy required evidence or close as FAILED/ABANDONED"}`
  (plus a duplicate bare `already-closed` stderr line) — both suggested actions refuse on a
  terminal episode: the non-COMPLETED path already owns the correct envelope for this exact
  fault (`episode close … --status FAILED` again → same message with `next: "inspect --episode
  to see the terminal status"`, and `inspect --episode ep_probe2` works — probed). One fault,
  two remedies, one of them a dead end: the shared `next` at `episode.ts:294-299` was written
  for `acceptance-incomplete` and fires for every `decideClosure` reason
  (`closure.ts:10-13` returns `reason: "already-closed"` for a terminal snapshot);
- **the silent ignores:** `episode events --episode ep_probe1 --status FAILED …` → prints the
  event lines, **exit 0** — `--status` parsed and ignored (an operator reading it as a filter
  gets an unfiltered answer reported as the answer); `--outcome foo` on `events` is ignored the
  same way. The module's own precedent runs the other direction already: `episode close
  --json` refuses with `"--json applies to episode events"` (`episode.ts:231-238`), and D34's
  rider established refuse-over-ignore for `models list --provider`.

**Exact files and edits:** `src/cli/episode.ts` + `test/integration/m3/episode-cli.test.ts`
only. `src/episode/closure.ts` and both stores are not edited — `decideClosure` keeps returning
`already-closed`; only the envelope the verb wraps it in changes.

1. **Blank `--outcome` → parse-args.** In the close branch, after the `--status` refusal
   (`episode.ts:239-247`) and before the lock is taken: when `values.outcome !== undefined &&
   values.outcome.trim() === ""` — `cliFail` `command: "episode"`, `stage: "parse-args"`,
   `message: 'invalid --outcome "${values.outcome}": outcome id must be a non-empty string'`,
   `next: 'pass --outcome <id> or omit it'`. The **value domain stays untouched** — any
   nonblank string is still accepted, exactly as held (the any-string design question is not
   reopened; this is the blank-value rule only, the same boundary D31 drew for `--reason`).
   Mixed case `--status banana --outcome ""` keeps reporting the status first (the guard sits
   after it).
2. **Terminal re-close → the working envelope, once.** In the `!decision.canClose` branch
   (`episode.ts:279-300`), when `decision.reason === "already-closed"`: return the byte-same
   refusal the non-COMPLETED guard already issues (`:301-308`) — `command: "episode"`,
   `stage: "close"`, `message: "already-closed"`, `next: "inspect --episode to see the terminal
   status"` — and skip the bare `decision.reason` stderr line for this reason (it printed the
   same word twice; the refusal envelope is the report). The `acceptance-incomplete` paths keep
   every byte: the WAITING_FOR_USER append-and-disclose flow, the already-waiting note, the
   evidence stderr line, and the `satisfy required evidence or close as FAILED/ABANDONED` next
   all still fire only for the reason they were written for.
3. **`events` irrelevant flags → parse-args.** At the top of the events branch (after the
   subcommand dispatch, missing-`--episode`, blank-root, and `isEpisodeId` guards — the pinned
   D39 order is untouched, and these are subcommand-scoped argv faults like close's `--json`
   refusal, which also sits after those guards): refuse a supplied `--status` or `--outcome` —
   `cliFail` `command: "episode"`, `stage: "parse-args"`, `message: 'episode events does not
   accept ${flag}; ${flag} applies to episode close'`, `next: 'drop ${flag}, or use episode
   close'` — mirroring the close `--json` refusal's shape in the opposite direction. Fires in
   both output modes, before either store read.

**Tests** (extend `episode-cli.test.ts`; harness already seeds episodes and byte-compares
logs): whole-field pins for blank `--outcome` (`""` and `"  "`, on FAILED and COMPLETED closes)
plus a no-write pin (both episode logs byte-identical after the refusal); a whole-field pin
that the COMPLETED re-close of a FAILED episode now returns the `:301` envelope, with a
no-write pin and a stderr pin (no `satisfy required evidence` and no duplicate reason line);
regression pins that an `acceptance-incomplete` COMPLETED close keeps today's bytes end-to-end
(the WAITING append, both notes, the reason line, and the existing next) and that a FAILED
re-close keeps its existing envelope; whole-field pins for `events --status FAILED` and
`events --outcome x` (plain and `--json` — no JSON is printed); and an order pin
(`episode events --status FAILED --state-root ""` still reports the blank root first, per the
D39 order). Existing pins hold: `already-closed` and `satisfy required evidence` are pinned
nowhere in `test/` (grep), the D33 escaped-events and raw-JSONL pins never pass `--status` to
`events`, and the harness's `--outcome oc_r8probe` close pin uses a nonblank value — all 23
baseline tests pass unchanged.

**Freeze/PR#12 check:** `episode events --json` byte-identical on every success path (the new
refusals fire before the store read); `EPISODE_USAGE` bytes untouched (it already reads
`[--outcome <id>]` on close only); no Event, no store or `closure.ts` edit, no new stage value;
the D39 corrupt-log catches and the D33 dispatch order keep their bytes. `episode.ts` reopened
outside D33's closed scope (id guard, dispatch order, events lines) and D39's (corrupt logs,
blank root) — neither classified the outcome value, the close-refusal remedies, or events flag
relevance; stated reopening. Neither file is in PR #12. Disjoint from Ranks 1 and 2.

---

## HOLD / NO_HIGH_VALUE — everything else examined, one line each

- **`--state-root <regular file>` (file-as-root) on any verb**: probed on every free verb —
  `pause`/`inject`/`commits` report main's raw `ENOTDIR … events.jsonl` with the doctor next,
  `models`/`auth` report `ENOTDIR … providers.json`/`auth.json` (losing the subcommand dialect:
  `command: "models"`, `command: "auth"`), `list` reports `stage: "execute"` with the flag
  named (`check --state-root /tmp/r11probe/blocker is readable`) — but `doctor --state-root
  <the same file>` **answers**: `FAIL state-root: /tmp/r11probe/blocker not writable: EEXIST…`
  and `FAIL providers: ENOTDIR …` (quoted from the live run), so the whole class is held under
  the corrupt-`providers.json` / corrupt-run-log rule (the generic remedy genuinely answers);
  D40/D41's catches deliberately rethrow coded errors to keep it that way. NO_HIGH_VALUE this
  round; the lost subcommand dialect rides on this class and is noted for whenever it un-holds.
- **Corrupt run event log through `commits`/`pause`/`inject`**: unchanged from r10 — doctor's
  `run-state-inventory` names the exact file; D40's catch excludes `EventStore.readAll` so this
  stays main-routed. NO_HIGH_VALUE.
- **`pause`/`inject` on non-flowchart or terminal runs; unknown `inject --node`**: messages in
  `flowchart-run.ts`, classification in `main.ts`, both in PR #12's live diff — HOLD.
  Observed while probing (recorded, not ranked): a `fact` injection into the BLOCKED example
  flowchart run succeeded (exit 0, snapshot echoed) although `INJECT_USAGE` says injection
  into a BLOCKED run fails closed — that contract lives in PR #12's files; re-examine after
  #12 lands.
- **`unblock` / G5 / G7 / E4 `[--outcome]` / cost verb / completions / `pref`**: `main.ts`
  remainder — HOLD behind PR #12 (unchanged from r6–r10). Likewise blank `--state-root` on
  `run`/`resume`/`inspect`/`answer`/`delete`/`unblock`/`adapt` (parsed in `main.ts`/`adapt.ts`).
- **Windows cli-smoke / status-matrix / data-dictionary / README riders**: HOLD behind PR #12;
  every batch above defers its docs rider.
- **Corrupt `providers.json`**: doctor's `providers` check names the file — held as before.
- **`models list --available --provider <unknown>` `(no models)`**: pinned choice. NO.
- **F7 oauth discoverability / F15 perms window**: no new evidence this round. NO_HIGH_VALUE.
- **D7 Variant B**: frozen by decision — not ranked.
- **`episode close --outcome` any-string value domain**: still needs design, not a slot —
  Rank 3 refuses only the blank instance and leaves every nonblank string accepted.
- **`adapt dataset` / `adapt.ts`**: merge-ready per D10/D18/D19/D23 and in PR #12 — not ranked.
- **`migrate-legacy --apply` twice**: probed — the second apply reports `already migrated: …`
  and `summary: 0 copied, 1 already migrated…`, exit 0; honest idempotency, nothing to fix. NO.
- **`validate`**: read at HEAD — D36/D37 landed; the catalog-build catch already classifies
  broken catalogs with an owned envelope naming `providersConfigPath` and `--state-root`
  (`validate.ts:193-204`); nothing new. NO_HIGH_VALUE.
- **`pi-compat`**: unchanged from the r9/r10 examinations — argv complete, no target flag,
  exit 1 reserved for the broken-adapter contract. NO.
- **`inject --value ""` (empty-string fact)**: examined — legal in the plane today
  (`isFactScalar("")` is true) and accepted end-to-end; refusing it would invent a rule no
  plane owns. Left as-is, stated at Rank 2.
- **`inject --type fact --confidence 0.5`**: probed — succeeds; the plane validates and
  records confidence for every kind, so this is plane behavior, not a silent ignore. NO.
- **`auth logout` of a never-stored provider / `models disable` no-op / `pause --clear` with
  no token**: re-read at HEAD — all three already report honestly (D20/D21/D34 landings);
  `auth.ts` needs nothing this round. NO_HIGH_VALUE.
- **`list --sort <unknown>` / `--status` on `--episodes`**: re-read at HEAD — both refused as
  parse-args with the accepted values named (D25 landing). NO.
- **`errors.ts` `doctorJsonCommand`**: only caller is `main.ts`'s failure path — HOLD behind
  PR #12 (unchanged).
- **`doctor-overlay.ts` / `model-catalog.ts` / `children-spec.ts` / `flowchart-io.ts`**:
  support modules with no verb of their own; no new operator-visible defect found. NO.

## Final ranking

1. **D40 — `commits` stored-ledger fault envelopes** — `src/cli/commits.ts` +
   `test/integration/cli/commits.test.ts`. The ledger verb stops throwing its four
   stored-state faults through main's catch at a doctor with no checkpoint inventory (probe:
   non-flowchart, absent, and corrupt `checkpoint.json` plus zero-completed-nodes all report
   `fix the reported error … use pi-sparkle doctor for preflight`, while `doctor --json` on
   that same root passes every inventory and never says `checkpoint`). Absent → `lookup` with
   an inspect retarget; corrupt → `validation` saying doctor does not inventory checkpoints;
   non-flowchart → `validation` naming the run kind; no-completed-nodes → `validation` with
   the D32-established inspect claim. Narrow uncoded-`DomainValidationError` catches only;
   coded fs faults and corrupt event logs keep their working main-routed remedies.
2. **D41 — `inject` `--value` domain + flag relevance as parse-args** — `src/cli/inject.ts` +
   `test/integration/cli/pause-inject.test.ts`. Two pure argv mistakes stop traveling through
   the run lookup into the plane's thrower (probe: `--value '{"a":1}'` → `fact value must be a
   JSON scalar or bare string` with the doctor next and `--value` never named; `--type skip
   --key k1` → `injection key is not valid for skip`, same envelope). One hoisted
   `parseFactValue` call refuses non-scalars before any state read; `--key`/`--value` on
   `override`/`skip` refuse in the pause `--clear`/`--reason` house dialect; `--node` on fact
   and `--confidence` everywhere stay legal (plane-accepted, probed).
3. **D42 — `episode` outcome/close/events contract** — `src/cli/episode.ts` +
   `test/integration/m3/episode-cli.test.ts`. The close verb stops persisting a blank
   `--outcome` into the append-only log (probe: `--outcome ""` → exit 0 and
   `"outcomeId":""` on disk; `"  "` likewise on the COMPLETED path); the terminal re-close
   gets the module's own working remedy instead of `satisfy required evidence or close as
   FAILED/ABANDONED` — two actions that both refuse (probe quoted, and the FAILED-path twin
   already prints `inspect --episode to see the terminal status`); and `events` refuses the
   `--status`/`--outcome` flags it silently ignores today (probe: exit 0, unfiltered output).

The three batches are mutually file-disjoint, disjoint from PR #12's live file list (re-pulled
after probing: OPEN, same eight src files), reopen closed-decision files (D32/D20 in Rank 1,
D30/D31/D37 in Rank 2, D33/D39 in Rank 3) only for defects outside those closed scopes with the
reopen stated at each batch, and can be dispatched concurrently. Through-line: Round 8 made the
free verbs honest about their flag values, Round 9 about their config plane, Round 10 about
which tree they acted on; Round 11 makes them honest at the boundary *after* the tree is read —
the stored-ledger faults, late-discovered argv faults, and refusal remedies that today all
funnel into one generic catch whose single suggestion, probed against every fault it is offered
for, either cannot see the defect (doctor has no checkpoint or episode-outcome inventory), asks
the operator to fix an error that does not exist, or prescribes commands that themselves
refuse.
