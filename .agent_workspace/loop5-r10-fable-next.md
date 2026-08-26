# Loop 5 · Round 10 — Fable-next: the three implementable operator batches after Round 9

Slot: Fable-r10-next (claude-fable-5). Analysis/spec only; no `src/` edits by this agent; not merged
to the parent integration branch.

Ranked at HEAD **`acd2eb746c1dfbfedd58a8da0ac7162f21bbfc1f`**
(`docs(agent): record Fable-r10-next dispatch id`) on `origin/cursor/pi-sparkle-sota-opt-0da8`,
fetched fresh (`git fetch origin cursor/pi-sparkle-sota-opt-0da8`) and re-fetched after probing —
origin moved once before this round started, from the Round 9 closeout `726963a` to `acd2eb7`, and
the whole delta is one line of `docs/agent-progress.md` (`git diff --stat 726963a acd2eb7`);
**every `src/` and `test/` byte ranked here is identical at `726963a` and `acd2eb7`**. HEAD
contains merge `de2f459` (D34 KEEP) and closeout `726963a` (`docs(agent): record D34 KEEP; close
Round 9`). Method: direct reads at HEAD of `src/cli/{list,migrate-legacy,pi-compat,init-examples,
doctor,episode,errors,pause,main}.ts` (main read-only), targeted greps of
`src/cli/{models,auth,validate,commits,inject}.ts` for state-root resolution sites and `command:`
dialect values, `src/episode/store.ts`, `src/run/episode-store.ts`, `src/run/event-store.ts`,
`src/persist/{jsonl,file-lock}.ts`; pin greps across `test/` for every string a batch below would
change (no existing test passes a blank `--state-root` anywhere — verified by grep). PR #12 file
list pulled live twice via `gh pr view 12 --json files,state,headRefName` (OPEN, head
`cursor/merge-preview-release-8011`; src set unchanged across the round: `adaptation/eval-routing.ts`,
`cli/adapt.ts`, `cli/inspect-format.ts`, `cli/main.ts`, `feedback/redaction.ts`,
`pi-adapter/runtime.ts`, `run/flowchart-run.ts`, `run/inspection.ts`, plus its test files —
re-listed in §0). **Every defect claimed below was reproduced live on this VM**
(`pnpm install --frozen-lockfile` clean, Node v22.14.0 — engines warning only) via
`node_modules/.bin/tsx src/cli/main.ts` so the working directory could be controlled, against:
a seeded state root at `/tmp/r10probe/state` holding corrupt episode logs
(`ep_corrupt.events.jsonl` bad JSON, `ep_badevent.events.jsonl` valid JSON / invalid event,
`ep_badsnap.jsonl` bad snapshot JSON), a second root with a corrupt run log, a real
fake-executor COMPLETED run seeded into `/tmp/r10probe/cwdtrap`, a regular file at
`/tmp/r10probe/blocker`, a read-only directory, a directory squatting an example filename, and a
cwd carrying legacy-shaped `feedback/records.jsonl`. Probe outputs are quoted in place; every
refusal quoted exited 1 unless stated otherwise. Baseline: the ten test files the batches extend
pass **213/213** at HEAD (`npx tsx --test` — per file: `list.test.ts` 22,
`pause-inject.test.ts` 27, `commits.test.ts` 32, `models.test.ts` 28, `auth.test.ts` 32,
`validate.test.ts` 18, `episode-cli.test.ts` 17, `init-examples.test.ts` 11,
`migrate-legacy.test.ts` unit 22 + integration 4).

## 0. Round 9 closeout honored; constraints every batch satisfies

- **Not re-ranked.** D34 KEEP `de2f459` (`models.ts` id preflight, three-way disable, blank
  `--provider`, no raw state-root in `next` — the `(no models)` pin stays), D35 KEEP `2afc5f8`
  (`auth.ts` login envelopes, split `--from-env` next, D24 untrimmed envVar), D36 KEEP `367bd45`
  (`validate.ts` blank/unreadable paths; `children-spec.ts`/`flowchart-io.ts` untouched — no
  batch below opens either). Per the round brief their files are free only for **NEW** defects:
  Rank 1 reopens `models.ts`/`auth.ts`/`validate.ts` (and the D31/D32 files) for exactly one
  defect none of those decisions classified — the blank `--state-root` value — and says so at the
  batch. Earlier D1–D33 KEEP as recorded in `docs/agent-decisions.md` (re-read in full this
  round, with `docs/agent-progress.md`).
- **PR #12 disjointness, re-pulled live.** #12's current src files: `adaptation/eval-routing.ts`,
  `cli/adapt.ts`, `cli/inspect-format.ts`, `cli/main.ts`, `feedback/redaction.ts`,
  `pi-adapter/runtime.ts`, `run/flowchart-run.ts`, `run/inspection.ts`; its test files:
  `test/integration/cli/{cli,inspect-follow,run-cost-cap}.test.ts`,
  `test/integration/m1/cli-children.test.ts`, `test/integration/m2.5/flowchart-run-cap.test.ts`,
  `test/integration/pi-adapter/costgate-cli-warning.test.ts`, unit
  `adapt/cost-flag/inspect-format/readme-command-parity/cost` files, the redaction/inspection/
  package/pi-boundary/eval-routing/promotion/active-routing/flowchart-learned-routing/
  release-gate-policy sets. **No ranked file is in that set** (checked name-by-name; the thirteen
  src/test files ranked below all absent). No batch edits `main.ts` — every conversion happens
  inside the verb module that owns it, so the blocked-next four-line routed prefix and the
  eleven-case crash probe are untouched trivially.
- **Freeze gate.** No live R1/`selectArm`/`planTaskTopology`; ADR-006 stays Proposed;
  `INSPECT_SUMMARY` four keys untouched; doctor `--json` byte-untouched (no batch opens
  `doctor.ts` — see HOLD for why its blank-root behavior already fails closed); doctor
  `runStates` stays PLANNING/RUNNING; eight-member `RunStatus`; **no new Event types and no new
  JSON key anywhere** — `RUN_LIST`, `MODELS_LIST`, `AUTH_STATUS`, `VALIDATE_OK`,
  `COMMITS_PREVIEW`, `INIT_EXAMPLES`, and `episode events --json` are byte-identical (every new
  refusal fires before its verb's JSON assembly, and the one new stderr note in Rank 2 is
  prose-only); `package.json` untouched (`private: true` stays); no Outcome-supported claims; D7
  Variant B untouched; `episode close --outcome` value domain untouched (held). Windows CI: the
  cli-smoke Windows leg runs `test/integration/m1/cli-children.test.ts` and
  `test/unit/cli/doctor.test.ts`; no batch touches either, and every new fixture below is
  portable (argv + capture-io + `mkdtemp` construction; no chmod-dependent case is load-bearing).

**The round's through-line, found by probing every free verb at HEAD:** D31–D33 taught the
run-state verbs to refuse bad flag *values* before the plane; D34–D36 taught the config-plane
verbs and the spec checker to classify value and environment faults. What is still live is the
**target contract**: the flag every verb shares (`--state-root`) and the two verbs whose whole
job is writing into an operator-named directory (`init`, `migrate-legacy`) still accept a blank
or obstructed target and then answer authoritatively about — or **write into** — a tree the
operator never named: `auth login` stores a credential into `./runtime/auth.json` of the current
directory and claims success; `models enable` writes routing config there and prints `Enabled`;
`list` prints `(no runs)` for a root that was never looked at; `migrate-legacy --apply` copies
files rooted at the cwd and reports a clean migration; `init --force` leaves a half-written
example pair with no disclosure; and the last free verb that still throws stored-state faults to
`main.ts` (`episode` on a corrupt log) sends the operator to a doctor that provably has no
episode-log inventory. Grep confirms no closed decision pinned any of these: the only behavior
pins near these paths are the D31/D32/D34/D35/D36 envelopes, all of which keep their bytes.

---

## Rank 1 (D37) — every free verb refuses a blank `--state-root` instead of silently retargeting reads and writes at a cwd-relative tree

**Why first.** The costliest wrong reports of the round, and two of them are *writes*. An
explicitly blank `--state-root` — the exact artifact of an unset shell variable
(`--state-root "$SR"`) — is accepted by every free verb, which then resolves runtime and
adaptation paths **relative to the process working directory**. Reproduced live at HEAD (all from
controlled cwds):

- `auth login openai --key sk-… --state-root ""` → stdout `Stored api_key credential for openai
  in runtime/auth.json`, **exit 0** — and the credential file appears at
  `<cwd>/runtime/auth.json`. A secret written into whatever directory the operator happened to
  be in (a repository checkout being the common case), reported as a success with a relative
  path and no root;
- `models enable openai/gpt-5.2 --state-root ""` → stdout `Enabled openai/gpt-5.2`, **exit 0**,
  writing `<cwd>/runtime/providers.json` — routing configuration the real state root never sees,
  so every later `models list` against the intended root shows nothing enabled;
- `list --state-root ""` from an empty cwd → `(no runs)`, **exit 0** — "you have no runs" for a
  root that was never read; from a cwd holding a seeded runtime tree it lists **that tree's**
  run (`run_03df5100-… COMPLETED …`) as if it were the answer;
- `pause --run run_03df5100-… --state-root ""` → `{"ok":false,"command":"pause","stage":"lookup",
  "message":"Run run_03df5100-… not found under ","next":"check --state-root, then pnpm cli list
  --state-root  for the run ids that exist there",…}` — "not found" for a run that exists in the
  tree the operator meant, plus a remedy line that pastes as `list --state-root for` (the blank
  swallows the next word); `inject` and `commits preview` reproduce the identical mangled
  envelope (`command: "inject"` / `"commits"`, same `not found under ` message and broken next);
- `validate --children <spec> --state-root ""` → `valid: children 2 tasks → flowchart children
  (2 nodes)`, **exit 0** — the D13 catalog-parity check ran against a cwd-relative
  `providers.json`, so a spec whose model policy would be refused against the real root's
  config can be reported valid;
- `models list --state-root ""` → `No models enabled. Use: pi-sparkle models enable
  <provider/model>`, exit 0 — an authoritative answer about a tree never named.

**Exact files and edits:** `src/cli/list.ts`, `src/cli/pause.ts`, `src/cli/inject.ts`,
`src/cli/commits.ts`, `src/cli/models.ts`, `src/cli/auth.ts`, `src/cli/validate.ts` +
`test/unit/cli/{list,models,auth,validate}.test.ts`,
`test/integration/cli/{pause-inject,commits}.test.ts`. One uniform guard per module (copied, not
imported — the D15 house rule; a shared helper in `errors.ts` would couple concurrently
dispatched batches and `errors.ts` feeds `main.ts`'s held failure path):

1. **The guard.** In each module, when `values["state-root"] !== undefined &&
   values["state-root"].trim() === ""`: `cliFail` with `stage: "parse-args"`,
   `message: 'invalid --state-root "${values["state-root"]}": state root must be a non-empty
   directory path'` (echoing whitespace is safe — no secret, no path), `next: 'pass --state-root
   <dir> or omit it to use the default ~/.pi-sparkle'` — **never interpolating the raw value into
   `next`** (the D34-rider rule; `models.ts:415-425` is the house model: name the flag, not the
   value). `command` is each module's existing dialect value: bare `"list"` / `"pause"` /
   `"inject"` / `"commits"` / `"validate"`, subcommand-qualified `"models enable"` /
   `"models disable"` / `"models set-default"` / `"models list"` and `"auth status"` /
   `"auth login"` / `"auth logout"` exactly as those modules already report their other argv
   refusals (D28/D34/D35 style; no new dialect is invented).
2. **Placement.** At (or immediately before) each module's existing resolution site
   (`values["state-root"] ?? defaultStateRoot()` — `list.ts:296`, `pause.ts:88`,
   `inject.ts:161`, `commits.ts:254/:315`, `models.ts:63` via `stateRootOf`, `auth.ts:88` via
   `stateRootOf`, `validate.ts:172`), and in every case **before any refusal whose `next`
   interpolates the resolved root and before any filesystem read or write**. Two precedence
   facts to pin deliberately: in `pause.ts` the resolution (`:88`) already precedes the
   D31 `isRunId` guard (`:93`), so `pause --run banana --state-root ""` reports the blank root
   first — the refusal that would otherwise print the mangled `list --state-root ` next; the
   D30/D31 type/confidence-before-run-shape order in `inject.ts` is unaffected because no
   existing guard reads the root. For `models.ts`/`auth.ts`, the guard runs at the top of each
   subcommand body (their `stateRootOf` helpers are called per subcommand); D34's id guards and
   D35's login envelope guards keep their existing order among themselves — no existing pin
   binds blank-root order because no test passes one.
3. **Nothing else changes.** The plane files are not edited; a nonblank relative `--state-root`
   (e.g. `--state-root state`) stays accepted — refusing relative paths would invent a rule no
   plane owns, and the operator who types one named a real target. Only the
   explicit-blank/whitespace value refuses, exactly the D31 blank-value rule
   (`pause.ts:79-87`) applied to the flag it never covered.

**Tests** (extend the six files; every harness already has `parseCliErrorJson` + capture-io):
whole-field pins (command/stage/message/next) for `--state-root ""` and `--state-root "  "` on
one representative path per module (`list`, `list --episodes`, `pause`, `pause --clear`,
`inject`, `commits preview`, `commits apply`, `models list/enable/set-default`,
`auth status/login/logout`, `validate --children`); an order pin in `pause`
(`--run banana --state-root ""` reports the blank root, not the run shape); a no-write pin on
the two write verbs (refused `auth login --key sk-x --state-root ""` and refused
`models enable openai/gpt-5.2 --state-root ""` leave no `runtime/` directory behind — assert
against a `mkdtemp` cwd or the absence of the relative path); and one `--json`-mode pin
(`list --json --state-root ""` refuses before any `RUN_LIST` is printed). Existing pins hold:
grep confirms no test in the repo passes a blank `--state-root`, so all 159 baseline tests in
these six files (22+27+32+28+32+18) pass unchanged.

**Freeze/PR#12 check:** all guards fire before JSON assembly, so `RUN_LIST`, `MODELS_LIST`,
`AUTH_STATUS`, `VALIDATE_OK`, and `COMMITS_PREVIEW` are byte-identical on every path that prints
them; no Event, no `main.ts`, no plane edit. Closed scopes reopened, explicitly: D25 (`list`
truncation/sort), D31 (`pause`/`inject` run-shape + blank reason/key/node/actor), D32 (`commits`
run/nodes/file/repo), D34 (`models` ids/provider/disable), D35 (`auth login` envelopes), D36
(`validate` spec paths) — none classified the blank root; this is one new defect with one new
guard per file. None of the thirteen files is in PR #12. Disjoint from Ranks 2 and 3
(`episode.ts`, `init-examples.ts`, `migrate-legacy.ts` and their tests are owned there — the
same blank-root defect in those two modules is fixed in their own batches, stated at each).

---

## Rank 2 (D38) — `init` and `migrate-legacy` stop half-writing and mis-blaming when the target directory is not what they need

**Why second.** The two verbs whose whole contract is "write into the directory the operator
named" still hand target faults to the wrong reporter — `init` throws raw errnos into `main.ts`'s
catch and, under `--force`, leaves a **partial write it promised to prevent**; `migrate-legacy`
answers a blank root by *migrating the current directory* and calling it success. All reproduced
live at HEAD:

- `init --dir /tmp/r10probe/blocker` (a regular file) → `{"ok":false,"command":"init",
  "stage":"execute","message":"EEXIST: file already exists, mkdir '/tmp/r10probe/blocker'",
  "next":"fix the reported error, then retry; use pi-sparkle doctor for preflight"}` — a raw
  errno, `--dir` never named, and a doctor remedy that has no check for an arbitrary target
  directory; `init --dir /tmp/r10probe/blocker/sub` → same envelope with `ENOTDIR: not a
  directory, mkdir …`; `init --dir <read-only dir>` → same with `EACCES: permission denied,
  open '…/sparkle-children.example.json'`;
- **the partial write:** with a directory squatting the flowchart name,
  `init --dir /tmp/r10probe/partial --force` → `EISDIR: illegal operation on a directory, open
  '…/sparkle-flowchart.example.json'` through main's catch — and `ls` shows
  `sparkle-children.example.json` (551 bytes, fresh) **was written first and is not disclosed**,
  the exact state the module's own comment promises to prevent ("a partial write would leave the
  operator with one fresh example next to one of their own files"). Worse, without `--force` the
  same squat is reported as `…/sparkle-flowchart.example.json already exists` with
  `next: "re-run with --force to overwrite"` — a remedy that then produces the partial write;
- `init --dir " "` → **exit 0**, creating a directory literally named `" "` and printing
  `next: pi-sparkle validate --children /tmp/…/ /sparkle-children.example.json` — a remedy line
  that splits into two argv words when pasted; `init --dir ""` silently writes into the cwd;
- `migrate-legacy --state-root /tmp/r10probe/blocker` (a regular file) →
  `{"ok":false,"command":"migrate-legacy","stage":"scan","message":"ENOTDIR: not a directory,
  stat '/tmp/r10probe/blocker/feedback'","next":"repair or remove the unreadable legacy file,
  then re-run migrate-legacy"}` — there is no legacy file; the state root is not a directory;
  the flag is never named, and the remedy asks the operator to repair a file that does not
  exist;
- `migrate-legacy --state-root ""` from a cwd holding `feedback/records.jsonl` → dry run prints
  `state root: ` (blank) and `would copy: feedback/records.jsonl → adaptation/feedback/…`, and
  `--apply` **actually copies** (`summary: 1 copied, …`, exit 0), creating
  `<cwd>/adaptation/feedback/records.jsonl` — a migration performed on a tree the operator never
  named, reported as a clean success.

**Exact files and edits:** `src/cli/init-examples.ts` + `src/cli/migrate-legacy.ts` +
`test/unit/cli/{init-examples,migrate-legacy}.test.ts` +
`test/integration/cli/migrate-legacy.test.ts`. No plane file, no example-constant byte, and no
`INIT_EXAMPLES` key changes.

1. **`init` blank `--dir` → parse-args.** When `values.dir !== undefined &&
   values.dir.trim() === ""`: `cliFail` `command: "init"`, `stage: "parse-args"`,
   `message: 'invalid --dir "${values.dir}": directory must be a non-empty path'`,
   `next: 'pass --dir <path> or omit it to write into the current directory'`. Kills both the
   `""` silent-cwd case and the `" "` literal-space directory.
2. **Obstruction preflight, before any write.** Extend the existing both-targets-first check:
   `lstat` each existing target; when one is not a regular file, `cliFail` **even with
   `--force`** — `command: "init"`, `stage: "preflight"`, `message: 'cannot write
   ${target.path}: it exists and is not a regular file'`, `next: 'move it aside; init writes
   sparkle-children.example.json and sparkle-flowchart.example.json as regular files, and
   --force only overwrites regular files'`. The pinned no-`--force` refusal
   (`stage: "execute"`, `${first.path} already exists`, `re-run with --force to overwrite` —
   `init-examples.test.ts:123-125`) keeps its bytes and now can only fire when `--force` would
   actually succeed.
3. **Write faults name the flag and disclose partial work.** Wrap the `mkdir` + write loop in
   one narrow try: on throw, `cliFail` `command: "init"`, `stage: "execute"`,
   `message: 'cannot write into --dir ${dir}: ${error.message}'`,
   `next: 'check the --dir path is a writable directory'` — and when any target had already been
   written, an stderr `note: wrote ${written.join(", ")} before the failure` first (the D20
   claim-only-what-happened rule: the refusal must not hide work that did happen). No catch
   wider than the mkdir/write sequence; the JSON/human success paths are byte-identical.
4. **`migrate-legacy` blank `--state-root` → parse-args.** Same guard and bytes as Rank 1's
   dialect (`command: "migrate-legacy"`), before `planLegacyMigration` — a verb that copies
   files must never resolve its source tree from the cwd.
5. **`migrate-legacy` unreadable root → the scan catch classifies.** In the existing catch
   (`migrate-legacy.ts:133-140`), mirror D36: when `errorCodeOf(error) !== undefined` (an fs
   fault — the corrupt-legacy-JSONL throw is a plain `Error` with no code, and
   `readJsonlObjects` wraps every decode fault through the caller's factory) → `cliFail`
   `command: "migrate-legacy"`, **`stage: "lookup"`**, `message: 'cannot scan --state-root
   ${stateRoot}: ${error.message}'`, `next: 'check the --state-root path; it must be the flat
   pre-2026-08-22 state directory'`; else today's report byte-identical (`stage: "scan"`,
   `"repair or remove the unreadable legacy file, then re-run migrate-legacy"` — still first
   for corrupt legacy JSONL, the fault it was written for). A nonexistent root keeps its
   honest empty dry run (`listFiles` already maps ENOENT to `[]` — pinned at
   `migrate-legacy.test.ts:79`; refusing it would invent a rule no plane owns, unchanged from
   the r9 HOLD).

**Tests** (extend the three files): whole-field pins for blank `--dir` (`""` and `" "`), the
obstruction refusal with and without `--force` **plus an ls-equivalent assertion that no file
was written** (the B4 regression pin: directory squatting the flowchart name, `--force`, expect
refusal and zero fresh files), the write-fault envelope via the portable ENOTDIR fixture
(`--dir <file>/sub`), and the partial-disclosure note via the squat fixture ordered after one
successful write (drive the write loop to fail on the second target); for `migrate-legacy`:
blank-root refusal pins (dry and `--apply`, asserting nothing is copied), file-as-root pinned as
`stage: "lookup"` with message matching `/^cannot scan --state-root /` (errno text left free for
Windows variance), and the existing corrupt-JSONL scan pins re-asserted byte-identical. Existing
pins hold: the `already exists` bytes, `INIT_EXAMPLES` one-line JSON (D17), both USAGE pins, the
empty-scan exit-0 pin, and the publish-seam suite (`migrate-legacy.test.ts:280-326`) are
untouched.

**Freeze/PR#12 check:** `INIT_EXAMPLES` keys and compactness byte-identical (refusals fire
before JSON assembly); no Event, no `main.ts`; `init-examples.ts` reopened outside D17 (JSON
shape) and D26 (argv dialect/`--help`) scopes; `migrate-legacy.ts` has no closed decision on its
failure classification (D26 landed only its parse-args catch and `--help`). Neither src file nor
any of the three test files is in PR #12. Disjoint from Ranks 1 and 3.

---

## Rank 3 (D39) — `episode` stops routing corrupt-log faults to a doctor that cannot see them

**Why third.** Rarer than Ranks 1–2 (a hard-corrupt log rather than a blank flag), but the
remedy is a proven dead end and `episode events` is the operator's only view into what a waiting
episode still requires. `episode.ts` is the last free verb whose stored-state faults still cross
into `main.ts`'s catch. Reproduced live at HEAD:

- `episode events --episode ep_corrupt --state-root /tmp/r10probe/state` (events log holds one
  non-JSON line) → `{"ok":false,"command":"episode","stage":"validation","message":"Invalid JSON
  at line 1 in /tmp/…/runtime/episodes/ep_corrupt.events.jsonl","next":"fix the reported error,
  then retry; use pi-sparkle doctor for preflight"}`; the valid-JSON/invalid-event variant
  (`ep_badevent`) reports the same envelope with `Invalid episode event at line 1 … Unknown
  EpisodeEvent.type: BANANA`;
- `episode close --episode ep_badsnap --status FAILED --state-root …` (corrupt snapshot log) →
  the same envelope with `Invalid JSON at line 1 in …/ep_badsnap.jsonl`;
- **the remedy is provably empty:** `doctor --json --state-root /tmp/r10probe/state` on that
  root reports every inventory clean — `runStates.scanErrors: []`, `locks.scanErrors: []`, no
  check names either file (the only FAIL is the unrelated Node-engines check on this VM), and
  the report string contains neither `ep_corrupt` nor `ep_badsnap`. Doctor inventories run logs
  (`runtime/runs`), not episode logs — contrast the corrupt **run** log probe, where doctor's
  `run-state-inventory` fails and names the exact file, which is why `pause`/`inject` on a
  corrupt run log stay NO_HIGH_VALUE (see HOLD);
- `list --episodes --state-root /tmp/r10probe/state` → `(no episodes)` + stderr `warning: list
  incomplete: 1 unreadable record(s)`, exit 0 — the episode **snapshot** inventory (D25's
  errors machinery) already answers for damaged snapshot logs, so the honest retarget exists
  and nothing points at it.

**Exact files and edits:** `src/cli/episode.ts` + `test/integration/m3/episode-cli.test.ts`
only. The stores (`episode/store.ts`, `run/episode-store.ts`) are not edited — the messages are
theirs; only the envelope converts, inside the verb that owns it.

1. **Corrupt events log → refusal in-module.** Wrap the `EpisodeEventStore.readAll()` call
   (`episode.ts:145`) in a narrow try catching `error instanceof DomainValidationError &&
   errorCodeOf(error) === undefined` only (a coded throw — e.g. the routed
   `FileLockTimeoutError` family — must keep reaching `main.ts`'s doctor-routed remedies):
   `cliFail` `command: "episode"` (the module's uniform dialect value — D33 pinned this
   spelling; the subcommand question is not reopened), **`stage: "validation"`** (stored-state
   fault, the D34 unknown-model precedent — the stage was never the lie here), message bytes
   kept exactly (the store already names file and line), and the honest next:
   `'the episode event log is append-only and pi-sparkle never rewrites it: repair or move
   aside the file named above, then retry; pi-sparkle doctor does not inventory episode logs'`.
2. **Corrupt snapshot log on close → same conversion plus the working retarget.** Wrap
   `snapshots.readAll()` inside the close lock (`episode.ts:192`) identically, with
   `next: 'the episode log is append-only and pi-sparkle never rewrites it: repair or move
   aside the file named above; pnpm cli list --episodes --json lists the readable episodes and
   names damaged records under errors[]'` — the D25 inventory is the one surface that already
   answers (probed above). The catch is around `readAll` only: `decideClosure`, the appends,
   and the lock acquisition keep today's paths (a lock timeout still reaches main's routed
   `locks[]` next, which works).
3. **Blank `--state-root` → parse-args.** Episode's instance of the Rank 1 class, owned here
   for file-disjointness (stated in both batches): same guard bytes at the resolution site
   (`episode.ts:101`), before the id guard whose `next` interpolates the root
   (`episode.ts:139` — probed: `episode events … --state-root ""` reports `has no events
   under ` with the mangled `list --state-root  --episodes` next).

**Tests** (extend `episode-cli.test.ts`; its harness already builds state roots by hand):
whole-field pins for the three corrupt-log envelopes (events bad-JSON, events invalid-event,
close bad-snapshot) including the exact `next` strings; a pin that the close refusal writes
nothing (no new snapshot or event line — byte-compare both logs); the blank-root refusal pins
(`""` and `"  "`, events and close); and a passthrough pin that a coded
`DomainValidationError` is not swallowed (drive the lock-timeout path with a held lock — the
harness pattern in `commands.test.ts` for lock contention — asserting the routed `locks[]`
next still appears). Existing pins hold: the D33 dispatch-order, `isEpisodeId`, escaped
events-lines, and byte-exact JSONL pins are untouched (`--json` output is unreachable from any
new refusal), and `EPISODE_USAGE` keeps its bytes.

**Freeze/PR#12 check:** `episode events --json` byte-identical on every success path; no Event,
no `main.ts`, no store edit, no new stage value (`parse-args`/`validation` both exist in the
module today); `episode.ts` reopened outside D33's closed scope (id guard, dispatch order,
events lines — none classified the corrupt-log envelope or the blank root). Neither file is in
PR #12. Disjoint from Ranks 1 and 2.

---

## HOLD / NO_HIGH_VALUE — everything else examined, one line each

- **`pause`/`inject` on non-flowchart or terminal runs; unknown `inject --node`**: messages in
  `flowchart-run.ts`, classification in `main.ts`, both in PR #12's live diff — HOLD behind
  PR #12 (unchanged from r8/r9; not re-probed beyond confirming the file list).
- **`unblock` / G5 / G7 / E4 `[--outcome]` / cost verb / completions / `pref` dialect**: all
  `main.ts` remainder — HOLD behind PR #12 (unchanged from r6–r9). The blank `--state-root`
  class also lives on `run`/`resume`/`inspect`/`answer`/`delete`/`unblock`/`adapt` — every one
  of those parses the flag inside `main.ts` or `adapt.ts` (PR #12), so their instances are HOLD
  behind PR #12 and noted here so Round 11 does not mistake Rank 1 for full coverage.
- **`doctor --state-root ""`**: probed — the `state-root` check already FAILs
  (`'' not writable: ENOENT: no such file or directory, mkdir ''`) and the run exits 1, so the
  blank root cannot produce a clean report; a parse-args refusal there is dialect polish on a
  surface that already fails closed, and `doctor.ts` stays byte-untouched this round
  (frozen-additive `--json`). NO_HIGH_VALUE.
- **Corrupt run log through `pause`/`inject`/`resume`**: probed — `pause --run run_bad` on a
  corrupt `events.jsonl` reports `stage: "validation"` + the generic doctor next, and doctor's
  `run-state-inventory` **fails naming the exact file** (`runStates.scanErrors:
  ["…/run_bad/events.jsonl: Corrupt event log line 1"]`) — the one refusal family where the
  generic remedy genuinely answers (the r9 corrupt-`providers.json` logic). NO_HIGH_VALUE.
- **Windows cli-smoke / status-matrix / data-dictionary / README riders**: HOLD behind PR #12
  (all in its live diff); every batch above defers its docs rider.
- **`models list --available --provider <unknown>` printing `(no models)`**: pinned choice —
  untouched by Rank 1 (the blank-root guard fires before either list branch). NO.
- **F7 oauth discoverability / F15 perms window**: no new evidence this round; the Rank 1
  `auth.ts` reopen is a different defect (target contract, not feature gaps). NO_HIGH_VALUE.
- **D7 Variant B**: frozen by decision — not ranked.
- **`episode close --outcome` any-string**: needs design, not a slot (unchanged from r8/r9);
  Rank 3 does not touch the close success path.
- **`adapt dataset` / `adapt.ts`**: merge-ready per D10/D18/D19/D23 and in PR #12 — not ranked.
- **`pi-compat`**: probed r9 and re-read at HEAD — argv dialect complete, `--offline --online`
  refuses as parse-args, no target flag to get wrong (it reads only its own package.json), exit
  1 reserved for the broken-adapter contract. Nothing worth a slot.
- **`init --dir` relative/dot paths, `list --status` case-sensitivity, `episode close --status
  completed` (lowercase)**: probed — each refusal names the accepted values and the flag
  (`episode close requires --status COMPLETED, FAILED, or ABANDONED`); tightening them is
  wording polish, not a wrong report. NO_HIGH_VALUE.
- **`init` writing `--dir` targets when the *children* name is squatted by a directory**:
  covered by Rank 2's obstruction preflight (fires on either target); listed here so the squat
  order is not mistaken for a second defect.
- **New `--json` surfaces (`init` failure JSON, `migrate-legacy --json`)**: no demonstrated
  script demand; wrong-target and wrong-remedy defects outrank cosmetic contracts (the standing
  round rule).
- **`errors.ts` `doctorJsonCommand` interpolating the raw state root**: its only caller is
  `main.ts`'s failure path (grep-verified) — editing it changes held `main.ts` outputs. HOLD
  behind PR #12.
- **`doctor-overlay.ts` / `model-catalog.ts`**: support modules with no verb of their own;
  `legacy-layout`'s blank-root detail (`no pre-plane files under `) rides on doctor's already
  failing report. NO_HIGH_VALUE.

## Final ranking

1. **D37 — blank `--state-root` value preflight across the seven free verb modules** —
   `src/cli/{list,pause,inject,commits,models,auth,validate}.ts` +
   `test/unit/cli/{list,models,auth,validate}.test.ts` +
   `test/integration/cli/{pause-inject,commits}.test.ts`. The flag every verb shares stops
   silently retargeting reads and writes at a cwd-relative tree (probe: `auth login … --state-root
   ""` stores a credential in `<cwd>/runtime/auth.json` and claims success; `models enable`
   writes routing config there; `list` answers `(no runs)` for a root never read; pause/inject/
   commits print `not found under ` with a remedy line that pastes broken). One guard per
   module, parse-args, before any I/O; every machine contract byte-identical.
2. **D38 — `init` + `migrate-legacy` target-directory contract** — `src/cli/init-examples.ts` +
   `src/cli/migrate-legacy.ts` + `test/unit/cli/{init-examples,migrate-legacy}.test.ts` +
   `test/integration/cli/migrate-legacy.test.ts`. The scaffold verb stops throwing raw errnos
   through main's catch (probe: `EEXIST … mkdir` with a doctor next), stops half-writing under
   `--force` (probe: fresh children file beside an EISDIR crash, undisclosed), and refuses
   blank/whitespace `--dir` (probe: a directory literally named `" "` and a next line that
   splits when pasted); the migration verb refuses a blank root instead of migrating the cwd
   (probe: `--apply` copied a cwd file and reported success) and classifies a non-directory
   root as a lookup fault naming the flag instead of `repair or remove the unreadable legacy
   file`.
3. **D39 — `episode` corrupt-log envelopes + its blank-root instance** — `src/cli/episode.ts` +
   `test/integration/m3/episode-cli.test.ts`. The episode verbs stop sending corrupt-log faults
   to a doctor with no episode-log inventory (probe: doctor reports every inventory clean while
   `episode events`/`close` fail on the named file); the refusal keeps the store's message
   bytes, says the log is append-only and never rewritten, and points `close` at the
   `list --episodes` errors inventory that already answers; blank `--state-root` refuses as
   parse-args before the id guard that interpolates it.

The three batches are mutually file-disjoint, disjoint from PR #12's live file list (re-pulled
after probing), reopen closed-decision files (D25/D31/D32/D34/D35/D36 in Rank 1, D17/D26 in
Rank 2, D33 in Rank 3) only for defects outside those closed scopes with the reopen stated at
each batch, and can be dispatched concurrently. Through-line: Rounds 8–9 made every free verb
honest about *which flags and values* it was given; Round 10 makes them honest about *which tree
they acted on* — the blank shared root that silently retargets reads and writes at the current
directory, the scaffold and migration verbs that half-write or mis-blame when their target is
obstructed, and the one remaining verb that routes stored-state faults to a remedy that provably
cannot see them.
