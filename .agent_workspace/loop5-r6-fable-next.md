# Loop 5 · Round 6 — Fable-next: the three implementable operator batches after Round 5

Slot: Fable-r6-next (claude-fable-5-thinking-xhigh). Analysis/spec only; no `src/` edits, no commit
or push by this agent.

Ranked at HEAD **`83beb1e37c9dee3088ad039a135b5cee98480eb8`**
(`docs(agent): record D22 doctor storage inventory merge`) on
`origin/cursor/pi-sparkle-sota-opt-0da8`, fetched and checked out fresh from the remote. Method:
direct reads at HEAD of `src/cli/{list,episode,commits,pause,inject,models,validate,migrate-legacy,
pi-compat,init-examples,errors,model-catalog}.ts`, `src/run/{inventory,injection,event-store,
episode-store}.ts`, `src/config/providers-config.ts`, `src/tools/decision-commit.ts`,
`src/domain/ids.ts`; pin greps across `test/` for every string a batch below would change; PR #12
state and full file list re-pulled live via `gh pr view 12` (OPEN,
`cursor/merge-preview-release-8011`, head `5c6376c` — unchanged since the D20 recheck);
D20–D24 dispositions read from `docs/agent-decisions.md` and cross-checked against `git log`.
**Every defect claimed below was additionally reproduced live on this VM** (deps installed with
`pnpm install --frozen-lockfile`, lockfile unchanged; Node 22.14.0 engine warning only), via
`pnpm cli` probes and two seeded-state-root scripts; probe outputs are quoted in place.

## 0. Constraints every batch below satisfies

- **Round 5 closeout honored, not re-ranked.** D20 KEEP (its files — `cli/{commits,episode,pause,
  errors}.ts`, `run/pause-controller.ts` — are free again). D21 FIX→**D24 in flight: `src/cli/auth.ts`
  and `test/unit/cli/auth.test.ts` are owned** (D24's file list in `docs/agent-decisions.md` names
  exactly those two) — no batch touches either. D22 landed (`35cbb91`), GPT recheck IN FLIGHT:
  **`src/cli/doctor.ts` and `test/unit/cli/doctor.test.ts` are owned** — no batch touches either,
  and `doctor-overlay.ts` is left alone too (it feeds the owned surface). D23 KEEP: the
  eval-dataset files are free, but the `adapt dataset` verb surface is `cli/adapt.ts`, #12-held.
- **PR #12 disjointness.** #12's src files at its live head: `adaptation/eval-routing.ts`,
  `cli/adapt.ts`, `cli/inspect-format.ts`, `cli/main.ts`, `feedback/redaction.ts`,
  `pi-adapter/runtime.ts`, `run/flowchart-run.ts`, `run/inspection.ts`; plus `ci.yml`, README,
  CHANGELOG, SECURITY, `.env.example`, `package.json`, `docs/status-matrix.md`,
  `docs/data-dictionary.md`, `docs/specs/*`, `scripts/*`, and 21 test files (notably
  `test/integration/cli/cli.test.ts`, `test/integration/m1/cli-children.test.ts`,
  `test/unit/cli/adapt.test.ts`, `test/unit/run/inspection.test.ts`). No batch below touches any of
  them. **No `main.ts` edit anywhere** — so no new top-level verb is rankable; all three batches
  enhance already-dispatched verbs, parsing any new flag inside the verb module it belongs to.
- **Freeze gate.** No live R1/`selectArm`/`planTaskTopology`; ADR-006 stays Proposed;
  `INSPECT_SUMMARY` four keys untouched; doctor `--json` untouched entirely (the file is owned);
  eight-member `RunStatus` untouched (Rank 1 passes statuses through, never mints one); **no new
  Event types** — `MODELS_LIST` and the `warnings` key on `RUN_LIST`/`EPISODE_LIST` are CLI view
  objects carrying `preview: true`, the exact precedent of `RUN_LIST`/`VALIDATE_OK`/
  `COMMITS_PREVIEW`/`INIT_EXAMPLES`; `package.json` untouched (`private: true` stays); crash probe
  (`scripts/crash-probe.mjs`) untouched; blocked-next four-line prefix untouched (trivially — no
  `main.ts` edit). D3's day-one rule for new/extended JSON contracts is followed: exact-shape and
  one-line pins land in the same diff.
- **Windows CI.** The `cli-smoke` Windows leg runs only `test/integration/m1/cli-children.test.ts`
  and `test/unit/cli/doctor.test.ts` (`ci.yml:73-74`) — none of the test files below is on it, and
  none is edited by #12. All new tests stay temp-dir hermetic and `path.join`-portable anyway.

---

## Rank 1 — `list` claims only what it read: truncation disclosure + `--sort last-event`

**Why first.** Two verified defects in the campaign's flagship R1 verb, one of them the exact
silent-shortened-history class D20 closed everywhere else. (a) `listRuns`/`listEpisodes` read every
log with the truncation-recovering JSONL readers and **silently discard the recovery**
(`inventory.ts:93-101`, `:149-155`): a run whose terminal event was crash-truncated lists with the
status replayed from the shortened log and no disclosure anywhere. Reproduced live — after seeding
`RUN_CREATED`+`RUN_STARTED` and appending a half-written terminal event:

- `list --json` → `{"type":"RUN_LIST",...,"status":"RUNNING",...,"errors":[]}`, stderr empty,
  exit 0;
- `inspect --run` on the **same log** → `warning: ignored truncated event log at line 3`.

So the product's two run-reading surfaces disagree about the same file, and the one operators
triage from is the silent one — a crashed-during-completion run looks live. (b) Run ids are
`run_<uuid>` (`ids.ts:60`, `randomUUID`), so `list`'s documented by-id order
(`inventory.ts:107`) is **random order with respect to time**: the primary "what did I run
recently / which of these 30 runs is current" question requires reading every `lastEventAt` by
eye. The rows already carry the answer.

**Exact files and edits:**

1. `src/run/inventory.ts` —
   - Add `warnings: InventoryError[]` (reuse the `{path, message}` shape) to `RunInventory` and
     `EpisodeInventory`.
   - In `listRuns`, after the `readAll()` at `:93`: when `read.recovery.incompleteLine !==
     undefined`, push `{ path, message: "ignored truncated event log at line ${N}; status and
     lastEventAt are replayed from the shortened log" }` and **still list the row** (the record was
     readable, just shorter than written). Same in `listEpisodes` after `:149` with label
     "episode log". Sort warnings by path like `errors`.
   - Do **not** change the run/episode sort (the by-id sort is pinned load-bearing at
     `inventory.test.ts:100`; ordering is Rank 1's `list.ts` concern).
2. `src/cli/list.ts` —
   - Surface warnings: one stderr line per entry, `warning: ${path}: ${message}` (exit stays 0 —
     same posture as the existing unreadable-record counter, whose pinned line
     `warning: list incomplete: N unreadable record(s)` at `list.ts:79` is not touched).
   - JSON: additive `warnings: readonly ListJsonError[]` key on `ListJson`, always present like
     `errors`. Frozen-additive legal move, pins updated in the same diff per D3.
   - New `--sort <id|last-event>` string option, default `id` (behavior unchanged when absent).
     `last-event` sorts most-recent-first by `lastEventAt`, tie-broken by id ascending; in
     `--episodes` mode rows with no `lastEventAt` sort last. Sorting happens in `list.ts` on the
     returned rows. Unknown value → `cliFail` `stage: "parse-args"`,
     `next: "pass --sort id or --sort last-event"`. Composes with `--status` and `--json`.
   - `LIST_USAGE`: one sentence for `--sort`, one for the truncation disclosure. Safe: the usage
     pin compares against the imported constant (`list.test.ts:101`).

**Tests** (extend, don't fork): `test/unit/run/inventory.test.ts` — truncated run tail (append a
half line to a seeded log) → row present with the replayed status, `warnings[0]` names the path
and line; untruncated fixtures → `warnings: []`; episodes-mode twin. `test/unit/cli/list.test.ts`
— existing `RUN_LIST`/`EPISODE_LIST` exact-shape assertions gain `warnings: []`; truncated fixture
→ stderr `warning:` line + row still listed + exit 0 + `--json` stdout still exactly one parseable
line; `--sort last-event` case seeding ids whose UUID order inverts their `lastEventAt` order
(the same trick `inventory.test.ts:100` uses for the id sort); `--sort bogus` → `parseCliErrorJson`
gives `stage: "parse-args"`; `--sort last-event --episodes` with one undefined-timestamp row.

**Freeze pins, verified at HEAD:** `RUN_LIST`/`EPISODE_LIST` are frozen-additive by D3 and the
`warnings` key is the legal additive move (no `Object.keys` pin exists on the payload — grepped);
the two pinned stderr lines (`list.test.ts:236,243`) fire only on unreadable records, which no new
fixture creates in those cases; success-path `deepEqual(err, [])` pins hold because their fixtures
are untruncated; `RunStatus` untouched; `list` stays read-only.
**PR #12 / D22 / D24 contact: none** — `inventory.ts`, `list.ts`, and both test files are outside
all three sets.

---

## Rank 2 — One-dialect argv errors and a working `--help` across the six free verb modules

**Why second.** Six free verb modules still let `parseArgs` throw through to `main.ts`'s generic
catch (`main.ts:2381-2388`), so a mistyped flag — the highest-frequency operator error there is —
exits with `stage: execute` and the one remedy that cannot help
(`fix the reported error, then retry; use pi-sparkle doctor for preflight`, `main.ts:2223`), while
`list`/`inject`/`pause` and the five D21-converted sites all speak `stage: "parse-args"` with a
`--help` pointer. Worse, two of those verbs **refuse their own `--help`**: the subcommand parses
of `episode` and `commits` declare no `help` option, so the discovery gesture itself is an error.
All reproduced live at HEAD:

- `episode events --help` → `error: Unknown option '--help'`, `stage: execute`, doctor next;
- `commits preview --help` → identical failure;
- `validate --bogus`, `migrate-legacy --bogus`, `init --bogus`, `pi-compat --bogus`,
  `models list --help` → all `stage: execute` + the generic doctor next.

The fix is the exact pattern already shipped in `list.ts:143-163`, applied per file. Fully
mechanical, zero contract surfaces, and it finishes the G4 one-dialect program D21 started
(GPT-d21 endorsed the direction and pinned the house `next` at `models.test.ts:238`).

**Exact files and edits** (one try/catch per `parseArgs`, `cliFail` with the verb's own command
string, `stage: "parse-args"`, the thrown parser message, and `next: "run pi-sparkle <verb>
--help"`):

1. `src/cli/episode.ts` — wrap the parse at `:30-39`; add `help: { type: "boolean", short: "h",
   default: false }` to its options and honor it (`io.stdout(USAGE)`, exit 0) after the existing
   positional-help branch at `:41-44`.
2. `src/cli/commits.ts` — same in `previewCommand` (`:177-185`) and `applyCommand` (`:209-219`);
   both gain a `help` boolean that prints `COMMITS_USAGE` and exits 0.
3. `src/cli/validate.ts` — wrap `:102-111` (its `help` option already exists).
4. `src/cli/migrate-legacy.ts` — wrap `:105-112` (`help` exists).
5. `src/cli/pi-compat.ts` — wrap `:172-179`; add a `help` boolean honored to usage/exit 0 (today
   only a positional first-arg `--help` works, `:167-171`).
6. `src/cli/init-examples.ts` — wrap `:116-123` only; `isHelp` (`:107-109`) already accepts
   `--help` anywhere, so no option change.

**Optional rider, same theme, file free and in no other batch:** `src/cli/inject.ts` — preflight
`--type` outside `fact|override|skip` and a non-finite or out-of-[0,1] `--confidence` as
`stage: "parse-args"` before the plane is called (today `Number("banana")` → NaN travels to
`validateInjection` and comes back `stage: validation` with the doctor next). Reuses the plane's
own rule wording. Drop the rider if the diff should stay purely mechanical.

**Tests** (extend, don't fork): per verb, two cases — unknown flag → `parseCliErrorJson` yields
the verb's command string, `stage: "parse-args"`, `next` matching `/--help/`; subcommand `--help`
→ usage on stdout, exit 0, stderr empty. Files: `test/integration/m3/episode-cli.test.ts`,
`test/integration/cli/commits.test.ts`, `test/unit/cli/validate.test.ts`,
`test/unit/cli/migrate-legacy.test.ts`, `test/unit/cli/pi-compat.test.ts`,
`test/unit/cli/init-examples.test.ts` (+ `test/integration/m3/pause-inject.test.ts` if the inject
rider rides).

**Freeze pins, verified at HEAD:** zero test pins exist on the current fall-through behavior for
these six verbs (grepped `test/` for `Unknown option` — only an unrelated public-prior redaction
match); `GENERIC_FAILURE_NEXT` and the five `DOCTOR_ROUTED_NEXT` routes live in untouched files;
`command-error-doctor.test.ts`'s routed pins cover `pref`/`adapt`/`delete` — all `main.ts`-inline
verbs this batch never touches; `CliErrorReport` gains no keys; no USAGE constant changes, so
every help pin comparing against imported constants holds by construction. The same defect exists
in `auth.ts` (unknown-subcommand raw dialect) — **explicitly deferred to a D24 follow-up**, that
file is owned. **PR #12 / D22 / D24 contact: none** (six src files + six test files, all outside
all three sets).

---

## Rank 3 — `models list --json`: the config surface scripts actually need, plus the models dialect leftovers

**Why third.** Every read surface this campaign shipped or touched emits one compact typed JSON
line (`RUN_LIST`, `VALIDATE_OK`, `INIT_EXAMPLES`, `COMMITS_PREVIEW`, `episode events --json`,
doctor, pi-compat) — except the one that answers "what will my runs route to": `models list` has
no `--json` at all (`models list --json` → `Unknown option '--json'`, reproduced live). Its human
output is also the least stable line format in the CLI — D21 just added `primary`/`fast` tags and
the `(not in catalog)` stale annotation (`models.ts:106-117`) — so any script scraping it breaks
next round. A `MODELS_LIST` view object makes enabled models, defaults, and staleness
machine-readable in the house style. Same batch finishes the models dialect: the raw
unknown-subcommand branch at `models.ts:47-50` (the one free site GPT-d21's review named — the
`auth.ts` twin is D24-owned) and the four uncaught subcommand `parseArgs` (`:63-70`, `:122-125`,
`:143-146`, `:175-182`).

**Exact files and edits:** `src/cli/models.ts` only —

1. `--json` boolean on the `list` subcommand's `parseArgs`, plus a `help` boolean (probe-verified
   `models list --help` currently throws). Enabled mode emits exactly one compact line:
   `{"type":"MODELS_LIST","preview":true,"mode":"enabled","models":[{"id":"<provider/model>",
   "primary":<bool>,"fast":<bool>,"inCatalog":<bool>}, ...]}` with top-level `primary`/`fast`
   string keys present only when configured (house omit-if-unset style). The "No models enabled"
   notice stays prose-only; JSON mode emits the object with `models: []`. `--available [--provider
   <id>]` mode emits `{"type":"MODELS_LIST","preview":true,"mode":"available","models":[{"id":
   "..."}]}` from the same builtin+custom merge the human path uses (`:71-94`). Frozen-additive
   from day one per D3: exact-shape and one-line pins land in the same diff.
2. Convert the unknown-subcommand branch (`:47-50`) to keep the usage echo and `cliFail`
   (`command: "models"`, `stage: "parse-args"`, `message: "Unknown models command: ${sub}"`,
   `next: "use models list, enable, disable, or set-default"`) — the `commits.ts:275-283`
   precedent.
3. Wrap the four subcommand `parseArgs` in try/catch → `cliFail` `stage: "parse-args"`,
   `next: "run pi-sparkle models --help"` (the exact `next` D21 already pinned at
   `models.test.ts:238`).
4. `MODELS_USAGE` list line gains `[--json]`.

**Tests:** `test/unit/cli/models.test.ts` (the hermetic temp-state-root harness is already there)
— exact-shape `deepEqual` pin for enabled mode including a primary-tagged and a stale
(`inCatalog: false`) entry; stdout-is-exactly-one-parseable-line pin; available mode with and
without `--provider <custom>`; empty-store JSON (`models: []`, no prose); unknown subcommand →
`parseCliErrorJson` `stage: "parse-args"`; `models list --help` → usage, exit 0; unknown flag →
parse-args report.

**Freeze pins, verified at HEAD:** `MODELS_LIST` is a CLI view object with `preview: true`, not an
Event; no existing human line changes (the JSON branch is new, D21's F9/F13/F14 outputs and the
`Enabled`/`Disabled`/`Defaults:` pins are byte-untouched); `MODELS_USAGE` is a non-exported local
const with zero test pins (grepped); doctor's `auth`/`providers` checks call config loaders, not
this command. One reconciliation note for the landing report: **PR #12 adds
`test/unit/cli/readme-command-parity.test.ts`** — whichever side lands second re-runs that parity
check against the extended `MODELS_USAGE`, same class of note as D20's `main.ts` private-helper
copy. **PR #12 / D22 / D24 contact: none** (one src file + one test file, outside all three sets;
`models.ts` was D21's file and D21's models half is KEEP — D24's ownership list names `auth.ts`
and `auth.test.ts` only).

---

## HOLD / NO_HIGH_VALUE — the rest of the candidate list, one line each

- **Windows cli-smoke step**: HOLD behind PR #12 (per the round brief) — lives only in `ci.yml`,
  which #12 edits; the R3 YAML remains land-ready the day #12 merges.
- **Status-matrix / data-dictionary / README riders**: HOLD behind PR #12 — all three files are in
  its diff; every batch above defers its docs rider accordingly.
- **`main.ts` remainder** (G5 placeholders, `inspect --episode` circular remedy, E4 `[--outcome]`,
  bare-verb exit normalization G7, cost/usage verb, feedback list/export verb, shell completions —
  anything needing a dispatch case): HOLD behind #12, unchanged from R5.
- **`auth.ts` items** (unknown-subcommand dialect twin of Rank 3.2, F7 oauth discoverability, F15
  perms window): blocked by D24 ownership; F7/F15 additionally remain NO_HIGH_VALUE per R5 (drift-
  prone hardcoded list; security-slot material) — queue the dialect twin as a D24-KEEP follow-up.
- **`doctor.ts` follow-ups** (storage-check refinements, retention-probe registration): blocked by
  the in-flight D22 recheck; the probe's `package.json`/`scripts/` half is #12-held regardless.
- **`episode events` human timestamps** (bare `type` lines today; every episode event carries a
  timestamp): real but it rewrites the pinned line shape at `episode-cli.test.ts:173` — queue as a
  deliberate rider on the next `episode.ts` touch after Rank 2 lands, not as a mix-in to a
  mechanical dialect diff.
- **`commits --nodes ",,,"` empty selection**: verified NOT a defect — `generateDecisionCommits`
  throws `no completed nodes to commit` (`decision-commit.ts:198-200`).
- **`adapt dataset` follow-ups**: D23 KEEP closed the exporter chain; the verb surface is
  `cli/adapt.ts`, #12-held — HOLD.
- **`doctor-overlay.ts`**: no verified defect, and it feeds the D22-owned surface — left alone.
- **D7 Variant B (same-episode continuation)**: frozen by decision — not ranked.
- **Track/tracking dead-knob cleanup**: NO_HIGH_VALUE stands from R5 — the honest-docs half is
  status-matrix, #12-held.

## Final ranking

1. **`list` truncation disclosure + `--sort last-event`** — `src/run/inventory.ts` +
   `src/cli/list.ts` + their two unit test files. A crash-truncated run must stop listing as
   silently live (probe: `RUN_LIST` says `RUNNING`, `errors: []`, while `inspect` warns on the
   same log), and the run catalog gains the recency ordering random UUIDs cannot give.
2. **One-dialect argv errors + working `--help`** — `src/cli/{episode,commits,validate,
   migrate-legacy,pi-compat,init-examples}.ts` (+ optional `inject.ts` confidence/type preflight
   rider) + six test files. Probe-verified: `episode events --help` and `commits preview --help`
   are errors today, and every mistyped flag on these verbs gets the doctor remedy that cannot
   help.
3. **`models list --json` (`MODELS_LIST`) + models dialect leftovers** — `src/cli/models.ts` +
   `test/unit/cli/models.test.ts`. The routing-config read surface becomes machine-readable in the
   house one-compact-line style before its freshly annotated human format ossifies into scripts.

The three batches are mutually file-disjoint, disjoint from PR #12's full file list and from the
D22-owned (`doctor.ts`) and D24-owned (`auth.ts`) sets, and can be dispatched concurrently.
