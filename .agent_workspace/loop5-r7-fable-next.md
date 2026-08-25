# Loop 5 · Round 7 — Fable-next: the three implementable operator batches after Round 6

Slot: Fable-r7-next (claude-fable-5). Analysis/spec only; no `src/` edits by this agent; not merged
to the parent integration branch.

Ranked at HEAD **`786f23ea994fdf1ac3aaf0e20a0474d94e347505`**
(`docs(agent): record D26 KEEP and D27 KEEP; close Round 6`) on
`origin/cursor/pi-sparkle-sota-opt-0da8`, fetched fresh and re-fetched after probing — origin has
not moved. Method: direct reads at HEAD of `src/cli/{auth,doctor,inject,episode,pause,commits,
list,models,validate,migrate-legacy,pi-compat,init-examples,errors,main}.ts` (main read-only),
`src/run/{injection,inventory}.ts`, `src/domain` id/timestamp helpers; pin greps across `test/`
for every string a batch below would change; PR #12 file list re-pulled live via `gh pr view 12`
(OPEN, head `cursor/merge-preview-release-8011` — src set unchanged from the Round 6 read);
D20–D27 dispositions read from `docs/agent-decisions.md`. **Every defect claimed below was
reproduced live on this VM** (`pnpm install --frozen-lockfile` clean, Node 22.14.0), via `pnpm
cli` against a seeded state root at `/tmp/r7probe/state` holding one fake-executor COMPLETED run,
one flowchart run BLOCKED at its first node, and one seeded episode (OPEN → WAITING_FOR_USER).
Probe outputs are quoted in place.

## 0. Round 6 closeout honored; constraints every batch satisfies

- **Not re-ranked.** D25 KEEP (verified live: `list --json` now carries `warnings: []` and
  `--sort last-event` orders by `Date.parse` descending), D26 KEEP (verified: `episode events
  --help` and `commits preview --help` print usage and exit 0; `validate --bogus` is
  `stage: "parse-args"` with a `--help` next), D27 KEEP (verified: `models list --json` emits the
  discriminated `MODELS_LIST` object; `models bogus` and `models enable --bogus` speak the house
  dialect). Their files are free again but no batch below touches any of them — all three ranked
  batches live in files Round 6 never edited.
- **PR #12 disjointness, re-read live.** #12's current src files: `adaptation/eval-routing.ts`,
  `cli/adapt.ts`, `cli/inspect-format.ts`, `cli/main.ts`, `feedback/redaction.ts`,
  `pi-adapter/runtime.ts`, `run/flowchart-run.ts`, `run/inspection.ts` — unchanged from the Round
  6 read; plus `ci.yml`, README/CHANGELOG/SECURITY/`.env.example`/`package.json`,
  `docs/status-matrix.md`, `docs/data-dictionary.md`, `docs/specs/*`, `scripts/*`, and 21 test
  files. **No ranked file is in that set** (checked name-by-name; the inject batch's test file is
  `test/integration/cli/pause-inject.test.ts`, which is not among #12's three
  `test/integration/cli/*` files). No batch edits `main.ts` — every new flag or branch parses
  inside the verb module that owns it, so the blocked-next four-line prefix is untouched trivially.
- **Freeze gate.** No live R1/`selectArm`/`planTaskTopology`; ADR-006 stays Proposed;
  `INSPECT_SUMMARY` four keys untouched; **doctor `--json` gains no key and loses none** (Rank 2
  changes argv handling only; the 16 `checks[]` and four inventories are byte-identical);
  doctor runStates stays PLANNING/RUNNING; eight-member `RunStatus` untouched; **no new Event
  types** — `AUTH_STATUS` (Rank 1) is a CLI view object carrying `preview: true`, the exact
  precedent of `RUN_LIST`/`MODELS_LIST`/`VALIDATE_OK`; `package.json` untouched (`private: true`
  stays); crash probe untouched; no Outcome-supported claims; D7 Variant B untouched. D3's
  day-one rule holds: the one new JSON contract lands with whole-object `deepEqual` and
  one-compact-line pins in the same diff.
- **Windows CI.** The cli-smoke Windows leg runs `test/integration/m1/cli-children.test.ts` and
  `test/unit/cli/doctor.test.ts`. Rank 2 adds cases to `doctor.test.ts`, so its new tests run on
  Windows: they are pure argv tests (capture-io harness, `mkdtemp` temp roots, `path.join`) with
  no POSIX fixture, and `ci.yml` itself is not edited (it is #12-held anyway).

---

## Rank 1 (D28) — `auth` speaks the house dialect and answers in JSON: dialect completion + `auth status --json`

**Why first.** `auth` is the front door — the first verb a new operator runs after install — and
it is now the **only** multi-subcommand CLI module left on the raw pre-D21 dialect. Four defect
surfaces, all reproduced live at HEAD:

- `auth badcmd` → two raw stderr lines (`Unknown auth command: badcmd` + usage), **no JSON
  report, no stage, no next**, exit 1 — a script parsing the house error dialect gets nothing;
- `auth status --bogus` → `{"ok":false,"command":"auth","stage":"execute","message":"Unknown
  option '--bogus'","next":"fix the reported error, then retry; use pi-sparkle doctor for
  preflight"}` — an argv typo classified as an execution failure with the one remedy that cannot
  help;
- `auth status --help` and `auth logout openai --help` → `Unknown option '--help'`, exit 1 — the
  discovery gesture itself is an error on both subcommands (`auth login --help` fails differently:
  the positional check reports `auth login requires <provider>`, exit 1);
- `auth status --json` → `Unknown option '--json'`, `stage: execute`. The credential-status read
  surface — the one CI preflight scripts actually poll ("can provider X authenticate before I
  start a paid run") — is scrape-the-padEnd-columns only, while every sibling read surface
  (`RUN_LIST`, `MODELS_LIST`, `VALIDATE_OK`, doctor, pi-compat) emits one compact typed line.

This is the leftover Fable-r5 and Fable-r6 both queued by name ("the `auth.ts` twin is
D24-owned — queue as a D24-KEEP follow-up"); D24 closed KEEP, the file set is free, and the batch
mirrors the exact composition GPT-d27 just endorsed to KEEP on `models.ts`: one src file, one
test file, subcommand dialect leftovers plus a discriminated `--json` view object in the same
diff.

**Exact files and edits:** `src/cli/auth.ts` + `test/unit/cli/auth.test.ts` only.

1. Convert the unknown-subcommand branch (`auth.ts:60-63`): keep the usage echo on stderr, then
   `cliFail` with `command: "auth"`, `stage: "parse-args"`,
   `message: "Unknown auth command: ${sub}"`, `next: "use auth status, login, or logout"` — the
   `commits.ts`/`episode.ts` precedent (usage echo precedes the report, exit stays 1).
2. Wrap the three subcommand `parseArgs` calls (`:89-92`, `:185-193`, `:364-367`) in try/catch →
   `cliFail` `stage: "parse-args"`, the thrown parser message,
   `next: "run pi-sparkle auth --help"` (the house `next` D21 pinned for models). The catch ends
   immediately after the synchronous `parseArgs(...)` — provider checks, store reads, and the
   `load-credentials` damaged-store handler at `:65-77` keep their current classification.
3. `--help` on all three subcommands: add `help: { type: "boolean", short: "h", default: false }`
   to each parse; honor it (print `AUTH_USAGE`, exit 0) **before** any provider/positional check
   or store read. In `login`/`logout`, also treat a first positional of `help`/`--help`/`-h` as
   help before the `requires <provider>` refusal — asking for help must not be an error.
4. `auth status --json` (new boolean on the status parse). One compact line on stdout, prose
   notices suppressed in JSON mode, discriminated exactly:
   - without `--all`: `{"type":"AUTH_STATUS","preview":true,"mode":"stored","stored":[{
     "providerId":"...","credentialType":"api_key|oauth"}, ...]}` — exactly those four top-level
     keys; stored rows exactly `providerId` + `credentialType`, sorted by `providerId` ascending;
   - with `--all`: `{"type":"AUTH_STATUS","preview":true,"mode":"all","stored":[...],
     "environment":[{"providerId":"...","label":"env"|"ambient","source":"..."}, ...]}` —
     exactly five top-level keys; environment rows exactly `providerId` + `label` + `source`,
     where `label` is the existing `sourceLabel(...)` verdict (D24's untrimmed-equality rule,
     reused not reimplemented) and `source` is the same `check.source ?? check.type` string the
     human column prints; rows cover only providers **not** already stored, exactly as the human
     path does; sorted by `providerId` ascending.
   Empty states keep the exact shape (`stored: []`, `environment: []`); the "No stored
   credentials…" and "(no environment-configured providers found)" notices stay prose-only.
   Security posture unchanged and stated in the diff: the object carries provider ids, credential
   *types*, and source *names* (e.g. `OPENAI_API_KEY`) — every byte of it already printed by the
   human path; never a value. `AUTH_STATUS` is a `preview: true` CLI view object, not an Event
   (the private `AUTH_STATUS` HTTP-status set in `pi-adapter/provider-retry.ts` is module-local
   and unrelated). `AUTH_USAGE`'s status line gains `[--json]`.

**Tests** (extend `test/unit/cli/auth.test.ts`; the temp-state-root + custom-provider + env-var
harness is already there, including the D24 padded-`envVar` rig): whole-object `deepEqual` pins
for stored mode populated and empty, and all mode with one `env` row, one `ambient` row, and a
stored provider correctly excluded from `environment`; stdout-is-exactly-one-parseable-line pin;
stderr empty on JSON success. Unknown subcommand → `parseCliErrorJson` gives `command: "auth"`,
`stage: "parse-args"`, the message and `next` above, usage echoed before the report, exit 1.
`auth status --bogus` → parse-args + `next` matching `/--help/`. `--help` on all three
subcommands (flag and positional forms) → usage on stdout, exit 0, stderr empty, and no
`auth.json` read (assert no store file is created). Existing D21/D24 pins (five missing-argument
sites at `auth.test.ts:593-608`, source column, `--from-env`, damaged-store remedy) hold — none
of their strings change.

**Freeze/PR#12 check:** no Event, no `main.ts`, no frozen key set touched; `AUTH_USAGE` has zero
byte-exact test pins (grepped — only the `Usage:`-echo-ordering match at `auth.test.ts:610`,
which the conversion preserves). Neither file is in PR #12; neither was touched by D25–D27. One
landing note, same class as D27's: #12 carries `test/unit/cli/readme-command-parity.test.ts`,
which checks top-level verbs and `main.ts` usage, not `AUTH_USAGE` flag spellings — whichever
side lands second re-runs it.

---

## Rank 2 (D29) — `doctor --help` must not fail: argv dialect + usage on the remedy target itself

**Why second.** Every generic failure in the product ends with "use pi-sparkle doctor for
preflight", and five routed remedies say "run pi-sparkle doctor --json and read …". The command
all of those point at **refuses its own discovery gesture** — its `parseArgs`
(`doctor.ts:1081-1089`) is uncaught and declares no `help` option, and `main.ts` dispatches
`doctor` straight through. Reproduced live at HEAD:

- `doctor --help` → `{"ok":false,"command":"doctor","stage":"execute","message":"Unknown option
  '--help'","next":"fix the reported error, then retry; use pi-sparkle doctor for preflight"}`,
  exit 1 — the failure's own remedy is the command that just failed;
- `doctor --bogus` → identical `stage: execute` + doctor-pointing next.

There is also no usage text at all: doctor's flags (`--state-root`, `--project`, `--agents-dir`,
`--json`) are documented only inside the top-level `main.ts` USAGE blob. This is the last
free-file instance of the exact defect class D26 closed on six verbs (the only other instances
left live in `main.ts`-inline verbs, #12-held).

**Exact files and edits:** `src/cli/doctor.ts` + `test/unit/cli/doctor.test.ts` only.

1. New module-local `DOCTOR_USAGE` const (no existing pins to collide with — grepped): the four
   flags one line each, plus the existing preview posture line ("developer preview — not a
   production capability; live R1/bandit/topology off until Checkpoint F-PROD closes") so the
   help surface repeats the honesty banner the human report already prints.
2. Add `help: { type: "boolean", short: "h", default: false }` to the parse; when true, print
   `DOCTOR_USAGE` and return 0 **before** `readPackageEngines()` and before any inventory — the
   current command mkdirs the state root via `stateRootWritable`, and a help request must write
   nothing (order: parse → help → work).
3. Wrap only the synchronous `parseArgs(...)` in try/catch → `cliFail` with
   `command: "doctor"`, `stage: "parse-args"`, the thrown parser message,
   `next: "run pi-sparkle doctor --help"`. Everything after the parse — engines read, all four
   inventories, the 16 checks, JSON emission, the `preflight`-stage failure report — is outside
   the catch and byte-identical.

**Tests** (extend `test/unit/cli/doctor.test.ts`, which calls `doctorCommand` directly):
`--help` → usage on stdout, exit 0, stderr empty, and the given temp `--state-root` directory is
**not created** (the no-write pin); `-h` twin; `--bogus` → `parseCliErrorJson` gives
`command: "doctor"`, `stage: "parse-args"`, `next` matching `/doctor --help/`, and stdout empty
(no half-report before the refusal); a stray positional (`doctor help`) → same parse-args
refusal (positionals stay disallowed; the flag form is the documented gesture). All new cases
are Windows-portable by construction (argv + capture-io only) since this file runs on the
cli-smoke Windows leg.

**Freeze/PR#12 check:** the frozen-additive `--json` contract is untouched — no
`DoctorJsonReport` key is added, removed, or reordered, and the existing exact pins
(`doctor --json prints exactly one JSON object`, ok-mirroring, stderr-report cases at
`doctor.test.ts:185-319`) hold because no fixture passes `--help` or a bad flag; runStates stays
PLANNING/RUNNING; no sixth `DOCTOR_ROUTED_NEXT` route (that map lives in `main.ts`, untouched).
`doctor.ts` was D22-owned; **GPT-d22-recheck closed KEEP**, so the file is free, and this batch
touches none of D22's storage/inventory code. Neither file is in PR #12.

---

## Rank 3 (D30) — `inject` refuses value-domain typos before the plane: `--type` and `--confidence` preflight

**Why third.** The rider GPT-r6 explicitly cut from D26 ("not part of the six missing parser
boundaries — leave it out of the mechanical landing; if it is ever included, validate only
`type`/finite `[0,1]` confidence explicitly and do not widen a catch around run lookup or
injection") is real on its own evidence, and it is worse than the Round 6 spec claimed. `inject`
parses `--type` and `--confidence` as free strings, checks per-type required args only for the
three *known* types (`inject.ts:77-103` — an unknown type matches no block and sails through),
and forwards `kind: values.type` / `Number(values.confidence)` to the flowchart plane. Reproduced
live at HEAD, both arms:

- against the **flowchart** run: `inject --run <fr> --type banana` →
  `{"ok":false,...,"stage":"validation","message":"injection kind must be fact, override, or
  skip","next":"fix the reported error, then retry; use pi-sparkle doctor for preflight"}` — an
  argv typo classified as a validation failure with the doctor remedy;
- against the plain fake-executor run: the **same typo** → `"message":"Flowchart run run_… 
  checkpoint is missing flowchart snapshot"` — the plane fails on run shape *before* reading the
  payload, so the operator is sent to debug a checkpoint that has nothing wrong with it and the
  message never mentions the flag they mistyped;
- `--confidence banana` and `--confidence 2` (both types of wrongness) → `stage: "validation"`,
  `"confidence must be a finite number between 0 and 1"`, doctor next — again after the plane
  was called.

**Exact files and edits:** `src/cli/inject.ts` + `test/integration/cli/pause-inject.test.ts`
only (note: the inject CLI tests live in `test/integration/cli/`, not `test/integration/m3/` as
the Round 6 doc wrote — the m3 file is the plane-level suite and is not needed).

1. Immediately after the `--run`/`--type`-required block (`inject.ts:69-76`), before the
   per-type blocks and **before** the `EventStore` lookup at `:109`: refuse
   `values.type ∉ {fact, override, skip}` with `cliFail` `stage: "parse-args"`,
   `message: 'unknown --type "${values.type}": injection kind must be fact, override, or skip'`
   (reuses the plane's own rule wording; keeps the existing `/kind|unknown/i` pin at
   `pause-inject.test.ts:234` true), `next: "pass --type fact, override, or skip"`,
   `runId: values.run`.
2. After the per-type required-arg blocks, still before the lookup: when
   `values.confidence !== undefined`, compute `Number(values.confidence)` once; refuse
   non-finite or outside `[0,1]` with `stage: "parse-args"`,
   `message: 'invalid --confidence "${values.confidence}": confidence must be a finite number
   between 0 and 1'`, `next: "pass --confidence <0-1>"`, `runId: values.run`; pass the validated
   number into the request. No other line of the command moves: the lookup refusal, the plane
   call, and the success echo are byte-identical, and per GPT-r6's condition **no catch widens**
   around run lookup or `injectFlowchartRun` — deeper plane failures keep `stage: "validation"`.
   Parse-order note, consistent with every other verb: a value-domain argv refusal now precedes
   the run-not-found lookup (`inject --run <missing> --type banana` reports the typo, not the
   missing run), the same precedence the existing `:69-103` blocks already have.

**Tests** (extend `test/integration/cli/pause-inject.test.ts`): strengthen the existing
unknown-type case (`:228-235`) to `parseCliErrorJson` → `stage: "parse-args"` and assert the run
gained **no** new event (read `events.jsonl` length before/after); new cases — unknown type
against the *non-flowchart* run seeded by the harness → parse-args with the same message (the
checkpoint red herring is gone); `--confidence banana`, `2`, and `-1` on `--type override` →
parse-args + `next` matching `/--confidence/`; boundary `--confidence 0` and `1` still reach the
plane and succeed on the waiting fixture; `inject --run <missing> --type banana` → parse-args
(order pin). The lookup test at `:319-342` and the help/dialect pins at `:281-297` hold —
none of their strings change.

**Freeze/PR#12 check:** no JSON contract exists on inject success (human echo only — untouched);
no Event type, no `RunStatus`, no `main.ts`; `inject.ts` and this test file match parent exactly
after D26's rider revert `25742b4`, so there is no ownership residue; neither file is in PR #12
(its `test/integration/cli/*` files are `cli.test.ts`, `inspect-follow.test.ts`,
`run-cost-cap.test.ts`). Disjoint from Ranks 1 and 2.

---

## HOLD / NO_HIGH_VALUE — everything else examined, one line each

- **`episode events` human timestamps** (bare `EPISODE_OPENED`/`EPISODE_WAITING` lines
  reproduced live; every event carries `occurredAt`): still real, still queued as a deliberate
  rider on the next `episode.ts` touch — no batch this round touches `episode.ts`, and spending a
  slot on a cosmetic line-shape rewrite (pin at `episode-cli.test.ts:174`) while three
  wrong-remedy defects are open would be padding; it needs a designed line format, not a mix-in.
- **`unblock` argv dialect**: same class as Rank 2 but the verb is `main.ts`-inline — HOLD behind
  PR #12 with the rest of the `main.ts` remainder (G5 placeholders, G7 bare-verb normalization,
  E4 `[--outcome]`, cost/usage verb, completions).
- **Windows cli-smoke step / status-matrix / data-dictionary / README riders**: HOLD behind
  PR #12 (all in its diff), unchanged from R6; every batch above defers its docs rider.
- **F7 oauth discoverability / F15 perms window** (`auth.ts`): still NO_HIGH_VALUE per R5
  (drift-prone hardcoded list; security-slot material) — D28 deliberately excludes both.
- **`doctor` retention-probe registration / storage refinements**: the `package.json`/`scripts/`
  half is #12-held; no new defect found in the D22 storage code at HEAD.
- **`commits`/`models`/`validate`/`migrate-legacy`/`pi-compat`/`init` dialect**: probed live —
  all speak parse-args with working `--help` after D26/D27; nothing left in those files worth a
  slot.
- **`list`/`inventory` follow-ups**: D25 verified live (`warnings: []`, `--sort last-event`
  ordering correct against the probe fixtures); no new defect found.
- **`auth login` interactive flow in non-TTY contexts**: auth-plane behavior, out of scope by
  the parent's business/auth/data-plane rule — spec only, not ranked.
- **D7 Variant B**: frozen by decision — not ranked.

## Final ranking

1. **D28 — `auth` dialect completion + `auth status --json` (`AUTH_STATUS`)** — `src/cli/auth.ts`
   + `test/unit/cli/auth.test.ts`. The front-door verb stops speaking the last raw error dialect
   in the CLI, gains `--help` on all three subcommands, and the credential-preflight question
   scripts actually ask becomes one compact typed line — the exact composition D27 just landed as
   KEEP on `models.ts`.
2. **D29 — `doctor --help`/argv dialect + `DOCTOR_USAGE`** — `src/cli/doctor.ts` +
   `test/unit/cli/doctor.test.ts`. The remedy target of every generic and routed `next` in the
   product must stop refusing its own discovery gesture (probe: `doctor --help` fails with
   "use pi-sparkle doctor for preflight" as its remedy); `--json` stays byte-frozen.
3. **D30 — `inject` value-domain preflight** — `src/cli/inject.ts` +
   `test/integration/cli/pause-inject.test.ts`. A mistyped `--type`/`--confidence` must refuse as
   parse-args before the plane is called (probe: today it surfaces as `stage: validation`, or as
   a "checkpoint is missing flowchart snapshot" red herring on non-flowchart runs).

The three batches are mutually file-disjoint, disjoint from PR #12's live file list, disjoint
from every D25–D27 file, and can be dispatched concurrently.
