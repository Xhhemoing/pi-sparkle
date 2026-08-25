# Loop 5 Round 1 — Fable-cli: CLI operator UX audit

Slot: Fable-cli (claude-fable-5-thinking-xhigh). Analysis only; no src/test/package.json edits, no commits.
Base: `cursor/pi-sparkle-sota-opt-0da8` @ `228c7a0`. Sibling implementers were already mid-flight in this
workspace when audited (untracked `src/cli/list.ts`, `src/run/inventory.ts`, `src/cli/init-examples.ts`,
`examples/*`, three tests; **no `src/cli/validate.ts` yet**). §3 doubles as a review of that in-flight code.

Out of scope by brief: `inspect --follow` and `--max-cost-usd` (PR #12), live R1/bandit/topology, Pi
extensions, any change to `INSPECT_SUMMARY` or doctor `--json`.

---

## 1. Command inventory

Top-level dispatch is the switch at `src/cli/main.ts:2140-2195`. Twenty verbs incl. aliases.

| Verb | Impl | Forms / subcommands | Error dialect | `next:` + JSON error object? |
|---|---|---|---|---|
| `run` | `main.ts:708-1070` | plain · `--children` · `--flowchart [--results]` · `--track` | `cliFail` | yes |
| `inspect` | `main.ts:1120-1256` | `--run [--json\|--summary-json]` · `--episode [--json]` | `cliFail` | yes |
| `resume` | `main.ts:1308-1482` | checkpoint rebuild · flowchart continuation · `--supervised` | `cliFail` + thrown→catch-all | yes |
| `answer` | `main.ts:1706-1815` | flowchart `--selected/--selected-ids` · plain `--message --text` | `cliFail` | yes |
| `pause` | `pause.ts` | pause · `--clear` | `cliFail` | yes |
| `inject` | `inject.ts` | `--type fact\|override\|skip` | `cliFail` | yes |
| `unblock` | `main.ts:1505-1636` | plain · `--retry-node [--discard-executed]` | `cliFail` | yes |
| `episode` | `episode.ts` | `events` · `close [--outcome]` | `cliFail` (bare invocation → exit 1) | yes |
| `delete` | `main.ts:2008-2042` | `--run` · `--episode` | **mixed**: raw stderr for arg errors (2021-2023) and nothing-found (2032) | no on those paths |
| `auth` | `auth.ts` | `status [--all]` · `login <p> [--key\|--from-env\|--oauth]` · `logout <p>` | raw stderr | no |
| `models` | `models.ts` | `list [--available] [--provider]` · `enable` · `disable` · `set-default` | raw stderr | no |
| `pref` | `main.ts:1935-1957` | `list` · `correct` · `export` · `delete` | raw stderr | no |
| `adapt` | `adapt.ts` | `status` · `learn` · `auto` · **`eval`** · `promote` · **`rollback`** | raw stderr (bare → exit 1) | no |
| `commits` | `commits.ts` | `preview` · `apply [--repo --file --sign --nodes]` | raw stderr | no |
| `doctor` | `doctor.ts` | `[--project] [--agents-dir] [--json]` | `cliFail` on failure exit | yes |
| `migrate-legacy` | `migrate-legacy.ts` | dry-run · `--apply` | `cliFail` | yes |
| `pi-compat` | `pi-compat.ts` | `[--json] [--offline]` · `--online` | `cliFail` + warnings | yes |
| `version` / `--version` / `-V` | `main.ts:2175-2178` | — (bare `version` word undocumented) | — | — |
| `help` / `--help` / `-h` / (none) | `main.ts:2180-2187` | prints `USAGE`, exit 0 | — | — |
| unknown | `main.ts:2188-2195` | stderr USAGE + `cliFail` | `cliFail` | yes |

Catch-all at `main.ts:2197-2204` gives every *thrown* error a structured report with doctor-routed `next:`
(`DOCTOR_ROUTED_NEXT`, `main.ts:2065-2091`) — so the bare-stderr groups above are structured only on their
throw paths, not on their `return 1` paths.

**Missing verbs confirmed on committed tree:** `list` (no untargeted run/episode discovery anywhere),
`validate` (no no-write success stop for a spec), `init`/examples (no committed `examples/`; README invokes
`flow.json` at `README.md:146-152` but never shows its shape). Doctor deliberately inventories only
PLANNING/RUNNING (`DoctorInFlightRunStatus`, `doctor.ts:90`; filter at `doctor.ts:398`) and never scans
episodes — that filter is correct preflight behavior and stays.

---

## 2. Ranked gaps

### P0 — missing verbs (the Round 1 bets; all confirmed real)

**G1. No `list`.** Every stateful verb requires an id the operator must already have: `inspect`
(`main.ts:1160-1166`), `resume` (1325-1331), `pause` (`pause.ts:30-36`), `delete` (`main.ts:2020-2024`),
`answer` (1719-1725). The not-found remedies are circular: `missingRun` (`main.ts:590-598`) answers "run X
not found" with "…pnpm cli inspect --run X" — the command that just failed; `pause.ts:55` likewise;
`inspectEpisode` not-found (`main.ts:1088-1093`) and `episode events` not-found (`episode.ts:56-61`) both
require a run id the operator may equally not have. Doctor's `runStates[]` shows only crash candidates, so a
COMPLETED/BLOCKED/WAITING run is undiscoverable once the terminal output scrolls away. Highest-value verb.

**G2. No `validate`.** Invalid input does fail closed before a run exists (flowchart:
`parseFlowchartFile` at `flowchart-io.ts:23-30` called from `main.ts:784-787`; children: `parseChildSpec`
at `main.ts:379-449` then `compileChildrenToFlowchart` at 974-989). But valid input has no stopping point —
checking a spec costs a run, requires irrelevant `--project`/`--objective` (`main.ts:731-737`), and on the
default fake path writes state. Blocking seam: **the children parser is module-private in `main.ts`**
(`parseChildSpec` 379, `parseChildCostCeiling` 368); see §3.2 for the resolution — this is the one place D4's
"one case + import + one USAGE line" allowance is insufficient.

**G3. No spec-authoring on-ramp.** The flowchart JSON shape is documented nowhere (README shows only
children JSON, `README.md:108-127`); its only "docs" are `validateFlowchart` error messages. Defaults an
author needs (limits: maxAttempts 1 / timeoutMs 60 000 / maxWallTimeMs 3 600 000) exist only in code
(`main.ts:441-443`). Also relevant: `package.json` `files[]` (13-19) excludes `examples/`, so a packed
install (`bin.pi-sparkle`) would not carry checked-in examples — this materially shapes the `init` design
(§3.3) and is the strongest counterargument to the GPT challenge's "static files only" position.

### P1 — error `next:` quality and USAGE drift

**G4. Two error dialects.** `auth`, `models`, `pref`, `adapt`, `commits`, plus `delete`'s arg/not-found
paths, report failures as one raw stderr line + exit 1: no `next:`, no trailing JSON object, so
`parseCliErrorJson` (`errors.ts:61-76`) returns nothing for them. ~25 failure sites (e.g. `auth.ts:105,
143`; `models.ts:104, 121, 139`; `main.ts:1873-1877, 1923, 2021, 2032`; `adapt.ts:135, 163, 201, 249, 371`;
`commits.ts:46, 128, 155, 191, 195`). Unifying on `cliFail` is a good Round-2 batch (behavior-visible:
stderr shapes change; nothing pins those strings except `commands.test.ts`-style integration greps — audit
per site before landing).

**G5. USAGE vs switch/subcommand drift** (all in the exported `USAGE`, `main.ts:249-357`):
- `adapt eval` and `adapt rollback` exist (`adapt.ts:82-87`, ADAPT_USAGE 35-38) but are absent from top-level
  USAGE (277-280). An operator reading `pi-sparkle help` cannot discover the rollback path at all.
- Corrupted `--track` paragraph: line 304 ends a sentence ("…spawn depth ≤ 2 / 4 per parent).") and line 305
  restarts mid-sentence ("predecessor artifacts, assigns other catalog models from --primary-model…") — a
  leftover edit duplication (`main.ts:300-312`). Reads as broken English in `help`.
- `episode close` USAGE line (262) omits `[--outcome <id>]` (accepted, `episode.ts:16, 33, 131`).
- `pause`/`inject` lines (267-269) show value-taking flags without placeholders: `[--state-root]`,
  `[--key] [--value] [--node] [--confidence] [--actor]` — reads as booleans.
- `run --children` line (256) omits `--primary-model`/`--fast-model`, which that path consumes for routing
  (`main.ts:865-872, 952-958`); they are shown only on the `--track` form (257).
- `adapt learn`/`adapt auto` lines (278-279) omit `[--primary-model <id>]` (`adapt.ts:33-34`); `adapt
  promote` (280) omits `[--state-root <dir>]` (`adapt.ts:37`).
- Bare `version` word accepted (`main.ts:2175`) but undocumented; harmless, but completions (G8) will need
  the true token set.
Fix hazard: several USAGE fragments are pinned by tests — see §4.5 before touching any of this.

**G6. Circular/weak `next:` lines that `list` unlocks.** `main.ts:595` ("check --state-root and pnpm cli
inspect --run X"), `main.ts:1093`, `pause.ts:55`, `episode.ts:60, 100`. None of these strings is pinned by
any test (verified: no test matches "check --state-root" / "not found under"). After `list` lands, retarget
to `pnpm cli list --state-root <dir>` (and `list --episodes`). Beyond D4's Round-1 allowance — queue as an
explicit Round-2 slot rather than let implementers exceed their file grants.

**G7. Group-command inconsistencies.** Bare `auth`/`models`/`pref` print usage and exit 0
(`auth.ts:46-48`, `models.ts:43-45`, `main.ts:1949-1951`); bare `adapt`/`episode` print usage and exit 1
(`adapt.ts:91-93`, `episode.ts:39-42`). Also mixed remedy spelling: `pnpm cli …` in run/resume/unblock
remedies (`main.ts:530, 578-582, 1572`) vs `pi-sparkle …` in doctor routes and doctor remediations
(`main.ts:2065-2091`, `doctor.ts:407`). Both spellings are partially frozen (byte-pinned in
`blocked-next.test.ts` and `doctor-routed-next-freeze.test.ts` respectively), so full unification is off the
table; new code should match its neighbors (inside `main.ts` error paths: `pnpm cli`).

### P2 — defer

**G8. Shell completions: recommend NO_CHANGE this round.** Nothing exists (`rg completion src/` → only
unrelated hits). The progress doc already queues completions for a later round. Precondition worth stating
now: G5 proves hand-maintained surfaces drift, so a future `completions bash|zsh` must be generated from a
single command/flag table that `main.ts` dispatch and USAGE also consume (the §1 inventory is the seed), not
a third hand-written copy. Do not spend a Round-1 slot on it.

---

## 3. Specs for the three verbs (and review of in-flight sibling code)

### 3.1 `list` — spec confirmed; in-flight code review

The untracked `src/run/inventory.ts` + `src/cli/list.ts` already match what I would have specified:
read-only scan of `runtime/runs/<id>/events.jsonl` and `runtime/episodes/<epId>.jsonl`, status via the
shipped `replayRun` (all eight `RunStatus` values, no ninth), latest validated episode snapshot, per-record
errors surfaced (stderr count + `errors[]`) rather than silently skipped, no `replayRun([])` (empty logs
skipped, `inventory.ts:95`), no locks/writes, deterministic id ordering, `cliFail` everywhere, and a
non-event JSON contract `type: "RUN_LIST" | "EPISODE_LIST"` with `preview: true`.

Findings to settle **before the JSON contract freezes**:
1. **Ordering** (`inventory.ts:107, 161`): lexicographic by id. Operators looking for "my latest run" want
   recency; `lastEventAt` descending with id tiebreak is the better default, and post-freeze scripts may
   ossify whatever ships. Decide now, deliberately. If id order stays, the human header should say so (the
   `LIST_USAGE` prose already does).
2. **Exit code with unreadable records** (`list.ts:218, 236`): stays 0 with a stderr warning. Defensible for
   an inventory (doctor's fail-on-scan-error posture serves a different go/no-go purpose), and the USAGE
   states it honestly — keep, but the exact-shape test must pin `errors` so scripts cannot miss it.
3. Contract pins must cover **both** `type` literals plus `runs[]`/`episodes[]`/`errors[]` row keys
   (decisions doc D3 names only `RUN_LIST`).
4. `--status` refused with `--episodes` (`list.ts:191-198`) — correct, keep; an ignored filter would lie.
5. Wiring is still absent from `main.ts` (by design; the file header carries the one-case/one-line note).

### 3.2 `validate` — full spec (not yet implemented; the seam needs a D4 amendment)

Surface:
```
pi-sparkle validate --children <spec.json> [--state-root <dir>] [--json]
pi-sparkle validate --flowchart <flow.json> [--catalog] [--state-root <dir>] [--json]
```
Exactly one of `--children`/`--flowchart` (refuse both/neither via `cliFail`). No run, no executor, no
router, no learned-routing load, no id minting persisted, no state write.

Semantics — make "valid" predict "run will accept":
- `--flowchart`: `parseFlowchartFile(path)` with no catalog ids = structural stage.
  `--catalog` additionally loads `buildLiveCatalogConfig(stateRoot)` and re-runs
  `assertFlowchartModelsInCatalog` exactly as `run` does (`main.ts:783-787`) = catalog stage. Without
  `--catalog`, print `catalog: skipped (structural only; pass --catalog to check model ids against the
  enabled catalog)` — never silently default a catalog to print "valid" (matches the GPT gate).
- `--children`: shared `parseChildSpec` **then** `compileChildrenToFlowchart` with the default
  `cheap`/`premium` aliases (pure, `compile-children.ts:46`). Parsing alone would pass specs that die at
  compile (self-dependency `compile-children.ts:77-78`, unknown `dependsOn` :80, duplicate ids :56, cycles
  via the terminal `validateFlowchart`). State the catalog caveat: children model assignment is
  state-dependent and is not checked here.
- Stdout on success: one compact object, frozen-additive day one, e.g.
  `{ "type": "VALIDATION_REPORT", "preview": true, "ok": true, "kind": "children"|"flowchart",
  "path": ..., "checks": [{ "name": "structural"|"catalog", "ok": true|..., "detail": ... }] }` (human prose
  without `--json`). On failure: `cliFail` to stderr, exit 1, **nothing** on stdout — no partial success
  object.

**The parser seam (blocking, needs a parent decision):** `parseChildSpec` is private in `main.ts:379-449`.
- Do **not** re-implement in `validate.ts` (second schema language — D2 violation).
- Do **not** export it from `main.ts` and import from `validate.ts`: `main.ts` imports `validate.ts` for
  dispatch, giving a `main ⇄ validate` ESM cycle the GPT gate explicitly forbids.
- **Recommended:** amend D4 to let Opus-validate move `parseChildSpec` + `parseChildCostCeiling`
  (`main.ts:359-449`) verbatim into `src/cli/flowchart-io.ts` (already the spec-IO module `main.ts`
  imports, `main.ts:79-83`) — or a new `child-spec-io.ts` — and have `run --children` import it from there.
  Safety check done: no source-pin test references `parseChildSpec`, it sits outside `runCommand` so the
  `blocked-next.test.ts` body heuristics are unaffected, and the `invocation-sink` pin counts only
  `createExecutor` call sites. Existing children behavior must be proven unchanged (the current
  `parseChildSpec` unit coverage keeps running against the new location).
- If the parent declines the amendment: ship `validate --flowchart` alone and record the children half as
  `NO_HIGH_VALUE_CHANGE_FOUND`-for-now rather than a fake parity claim.

### 3.3 `init` — keep the verb, with the embedded-constant design; three fixes

The GPT challenge said REPLACE (static examples only). The in-flight `init-examples.ts` answers the
strongest half of that objection: examples are **embedded as source constants** (`init-examples.ts:29-35`)
because `files[]` ships `dist` only — a packed/`pnpm add -g .` install has no `examples/` checkout, and D3
forbids the `package.json` `files[]` edit that static-only would need to travel. The checked-in `examples/`
copies remain for repo browsers, with a unit test pinning the two copies byte-identical. That is the right
shape; I recommend the parent **keep the verb** (it is ~170 lines, refuses overwrite without `--force`,
checks both targets before writing either, touches no state root).

Fixes before landing:
1. **`--json` prints pretty-printed JSON** (`init-examples.ts:150-160`, `JSON.stringify(..., null, 2)`).
   Every other machine surface (doctor, inspect, list-in-flight) is one compact line. Make it compact
   before `INIT_EXAMPLES` freezes with the inconsistency in it.
2. **Cross-slot coupling:** success output prints `next: pi-sparkle validate --children …`
   (`init-examples.ts:169`) — a command that does not exist yet. Either land `validate` first, or gate the
   line: fall back to `pnpm cli run --project <path> --objective <text> --children <file>` (the README-true
   next step) if the validate slot slips or is killed.
3. Both examples must pass the same validators `run` uses (children through
   `parseChildSpec`+`compileChildrenToFlowchart`; flowchart through `validateFlowchart`) **in the test**, so
   the scaffold can never emit a spec the runtime rejects. (Also the honest check that the flowchart
   example's alias models `cheap`/`premium` stay the compile defaults, `compile-children.ts:14-15`.)

---

## 4. Freeze hazards for anything landing in `src/cli/main.ts`

Beyond the D3 list, four **source-pinning tests parse `main.ts` itself** and constrain new code mechanically:

1. **`test/integration/cli/blocked-next.test.ts:449-450, 493-494`** — counts exactly **2** occurrences of
   `return flowchartExitCode(outcome.status);` inside `runCommand` and exactly **4** in the whole file, each
   preceded within 200 chars by the exact BLOCKED-routing block. A new command in `main.ts` (or moved-in
   helper) that calls `flowchartExitCode` breaks the count. `list`/`validate`/`init` return
   `CLI_EXIT.ok`/`cliFail` only — never that helper.
2. **`blocked-next.test.ts:443-446`** locates `runCommand` by `"async function runCommand("` and ends it at
   the first `\n}\n` — do not insert or reflow anything inside `runCommand`, including when resolving the
   three-way switch/USAGE merge.
3. **`test/unit/cli/doctor-routed-next-freeze.test.ts:41-52`** — `GENERIC_FAILURE_NEXT` and
   `DOCTOR_ROUTED_NEXT` must remain **top-level constants of `main.ts`**, AST-shape and character exact
   (five routes, one `${doctor}` interpolation each). No sixth route for new commands; their not-found
   errors use plain `cliFail`.
4. **`test/unit/cli/invocation-sink-wiring.test.ts:180`** — exactly **4** `createExecutor(` call sites in
   `main.ts` (run ×2, resume ×2), each with `onInvocation`. New commands must not build executors (none
   needs to; `validate` explicitly must not).
5. **USAGE fragment consumers** (relevant to fixing G5 and to the three additive lines):
   `thinking-flag.test.ts:170-178` regex-parses the seven levels across the current line wrap at
   `main.ts:293-294` and :187-190 pins the Google-clamp sentence (297); `resume-executor-config.test.ts`
   pins the exact wrap `executor configuration is\nnot recorded` (321-322);
   `test/integration/cli/unblock.test.ts` pins both unblock USAGE lines (270-271) and the BLOCKED prose;
   `test/integration/cli/commands.test.ts` pins the full `adapt promote …` line (280);
   `migrate-legacy.test.ts` and `preferences-cli.test.ts` pin their lines. Consequence: the G5 fixes
   (garbled `--track` paragraph at 303-305, `adapt eval|rollback` lines) are safe **only** as edits that
   leave those pinned fragments byte-identical — the duplication removal at 305 touches none of them.
6. **Additive-line safety:** there is no full-help snapshot test, so three new two-space-indented USAGE
   lines + three switch cases + three imports are safe. Per D4, a merge conflict keeps all three sibling
   lines.
7. **Contracts untouched by design:** `INSPECT_SUMMARY` stays four keys and `list` must not route through
   `RunInspection`/`inspection.ts`; `DoctorJsonReport` and `DoctorInFlightRunStatus`
   (`"PLANNING"|"RUNNING"`, `doctor.ts:90`) unchanged; eight-member `RunStatus` (`status.ts:1-10`)
   unchanged — the in-flight code honors all three. No new event types (`RUN_LIST`/`VALIDATION_REPORT`/
   `INIT_EXAMPLES` are CLI views outside the event union, no `id`).
8. **New-contract freezing:** per D3, `RUN_LIST`/`EPISODE_LIST`, `VALIDATION_REPORT`, and `INIT_EXAMPLES`
   need exact-shape pins in their own tests at landing (settle §3.1 items 1-3 and §3.3 item 1 first —
   freezing the pretty-print or the id-ordering by accident is the avoidable mistake this round).
9. **PR #12 collision** (defer to GPT report §5 for detail): PR #12 edits the same `main.ts`
   import/USAGE/switch regions and adds a README/USAGE parity test; after it merges, each new verb also
   needs a README command-table row, which D4's one-line allowance does not currently cover.

---

## 5. Recommendations to the parent (ranked)

1. Land `list` after settling §3.1 items 1-3 (ordering, exit-code pin, both-type pins). It also unblocks G6.
2. Amend D4 for the `validate` parser seam (move `parseChildSpec`/`parseChildCostCeiling` to
   `flowchart-io.ts`); otherwise ship flowchart-only validate honestly.
3. Keep `init` (embedded-constant design beats the static-only replacement given `files[]`+D3), with the
   three §3.3 fixes; sequence it after `validate` or gate its `next:` line.
4. Queue for Round 2 (not Round 1 scope creep): G6 next-line retargeting onto `list`; G4 `cliFail`
   unification for auth/models/pref/adapt/commits/delete; G5 USAGE drift fixes under the §4.5 pin
   constraints.
5. Completions: explicit NO_CHANGE this round (G8); revisit only with a generated single-source table.
