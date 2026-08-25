# Loop 5 · Round 5 — Fable-next: the three implementable operator batches after Round 4

Slot: Fable-r5-next (claude-fable-5-thinking-xhigh). Analysis/spec only; no `src/` edits, no commit
or push by this agent.

Ranked at HEAD **`c4e3e63d2af78b05a6cc346ae6bc104fdec0f29f`**
(`docs(agent): record D16 KEEP and D18 merge; recover GPT-d16 report`) on
`origin/cursor/pi-sparkle-sota-opt-0da8`, checked out fresh from the remote (remote is source of
truth; the local `main` this VM booted with was 4 rounds stale). Method: direct reads at HEAD of
`src/cli/{auth,models,episode,commits,pause,inject,list,validate,doctor,pi-compat,errors,init-examples}.ts`,
`src/pi-adapter/auth-session.ts`, `src/run/{pause-controller,flowchart-run}.ts`,
`src/config/providers-config.ts`, `src/tools/decision-commit.ts`; pin greps across `test/` for
every string a batch below would change; PR #12 state and full file list re-pulled live via
`gh pr view 12` (OPEN, `cursor/merge-preview-release-8011`); D15–D18 dispositions read from
`docs/agent-decisions.md` and cross-checked against `git log` of the touched files.

## 0. Constraints every batch below satisfies

- **PR #12 disjointness.** #12's src files at HEAD of the PR: `adaptation/eval-routing.ts`,
  `cli/adapt.ts`, `cli/inspect-format.ts`, `cli/main.ts`, `feedback/redaction.ts`,
  `pi-adapter/runtime.ts`, `run/flowchart-run.ts`, `run/inspection.ts`; plus `ci.yml`, README,
  CHANGELOG, SECURITY, `.env.example`, `package.json`, `docs/status-matrix.md`,
  `docs/data-dictionary.md`, `docs/specs/*`, scripts, and 21 test files (notably
  `test/integration/cli/cli.test.ts`, `test/integration/m1/cli-children.test.ts`,
  `test/unit/cli/adapt.test.ts`, `test/unit/run/inspection.test.ts`). No batch below touches any
  of these. No `main.ts` edit anywhere — which also means **no new top-level verb is rankable
  this round** (every new verb needs a `main.ts` dispatch case); all three batches enhance
  already-dispatched verbs.
- **D18 disjointness.** GPT-d18 recheck is IN FLIGHT, so `src/privacy/eval-dataset-path.ts`,
  `src/learning/eval-dataset.ts`, `src/privacy/deletion.ts` (and their tests
  `eval-dataset.test.ts`, `deletion.test.ts`) are owned. No batch touches them; Rank 3's storage
  walk is specified lstat-only / never-follow-symlinks precisely so it stays consistent with the
  D18 posture without touching D18 code.
- **Freeze gate.** No live R1/`selectArm`/`planTaskTopology`; ADR-006 stays Proposed;
  `INSPECT_SUMMARY` four keys untouched; doctor `--json` frozen-additive (Rank 3 uses the legal
  additive move, precedented by `learnedState`); eight-member `RunStatus` untouched; **no new
  Event types** (`COMMITS_PREVIEW`-style CLI view objects are not Events and none are added);
  `package.json` untouched (stays `private: true`); crash probe (`scripts/crash-probe.mjs`)
  untouched; blocked-next four-line prefix lives in `main.ts:499-503`, untouched trivially.
- **D16 KEEP** unblocked `auth.ts`, `auth-session.ts`, `doctor.ts`, `models.ts`. All are free.

## 0.5 Queue correction (verified in source, not inherited)

The brief queued "`auth.ts` riders F4/F6/F12/F13" as unblocked work. **Two and a half of the four
are already landed** and must not be re-ranked:

- **F4 (corrupt-store remedy): LANDED** — `authCommand` catches `asAuthStoreUnreadable` and emits
  the targeted `next: move <path> aside …` (`auth.ts:64-76`), pinned by
  `auth.test.ts` ("a damaged auth.json is named by every verb…"). Landed in `4a99475`/`b2d924e`
  (the D12 batch), covered by the GPT-auth-landing recheck.
- **F12 (logout honesty): LANDED** — `deleteStoredCredential` returns a boolean and logout prints
  "No stored credential … nothing to remove" (`auth.ts:266-275`), pinned at
  `auth.test.ts:380,391`. Same commit.
- **F6, `--from-env` half: LANDED** — keyless-custom `--from-env` is refused outright
  (`auth.ts:190-197`). **The `--key` and interactive halves are still open** (see Rank 2): `auth
  login local --key sk-dead` still stores a never-sent secret, because `runtime.ts:106-110` builds
  keyless customs a resolver that ignores the credential store.
- **F13 (status polish): still open** — `status --all` with nothing configured prints zero output
  (`auth.ts:94` suppresses the notice exactly when `--all` is set), and the second column is
  hardcoded `env` for every non-stored row (`auth.ts:110`) even when the printed source is
  `<id> (no key)`. No test exercises `--all` at all (grepped: zero hits).

Also verified landed and healthy at HEAD, so out of scope: D15 (episode/pause/inject not-found →
`list`), D16 (secret mute + `question` EOF-reject + doctor `auth` check + custom `--available`),
D17 (compact `INIT_EXAMPLES`), E1 (WAITING disclosure at `episode.ts:113-124`), I1
(`INJECT_USAGE`/`PAUSE_USAGE` + parse-args catch), C1/C2/C3 (`commits` all-`cliFail`, typed
compact `COMMITS_PREVIEW` at `commits.ts:153`, house not-found remedy at `commits.ts:49-57`).

---

## Rank 1 — `commits`/`episode`/`pause`: the CLI claims only the work it did

**Why first.** Three verified silent-drop/false-claim defects, and the worst one touches the
operator's **own git repository**: `commits apply` loops proposals and commits them one by one
(`commits.ts:193-196`); when commit *k* of *n* fails, the command exits 1 having already created
`k-1` real commits, and says nothing about it — a blind re-run (the natural reflex) **duplicates
those commits** in the user's repo. Sibling defects in the same family: the event/episode logs are
read with a truncation-recovering JSONL reader whose recovery is silently discarded by `episode`
and `commits` while `inspect` discloses it (`main.ts:1085,1270` warn; `episode.ts:56,100` and
`commits.ts:47` do not) — so `commits preview` can silently omit the last node's commit when the
log tail was crash-truncated, and `episode events` prints a silently shortened history. And
`pause --clear` prints `Cleared pause for <runId>` unconditionally (`pause.ts:90-93`) while
`clearPause` swallows ENOENT (`pause-controller.ts:83-87`) — the exact false-work claim F12 just
removed from `auth logout`. All additive stderr/one-line changes; zero contract surfaces.

**Exact files and edits:**

1. `src/cli/errors.ts` — export `warnTruncatedJsonl(io, recovery, label)`, byte-identical wording
   to the private copy at `main.ts:1062-1070` (`warning: ignored truncated ${label} at line N`).
   `errors.ts` imports nothing from the CLI layer, so `episode.ts`/`commits.ts` importing it is
   cycle-free; `main.ts` keeps its private copy until the post-#12 reconciliation (note for the
   landing report).
2. `src/cli/commits.ts` —
   - **C4 (partial-apply disclosure):** switch the `applyCommand` loop (`:193-196`) to an indexed
     loop; on `applyProposal` failure with `index > 0`, one stderr line before `return 1`:
     `note: ${index} of ${proposals.length} proposed commits were already created in ${repo} before this failure; re-running apply would create them again — pass --nodes ${proposals.slice(index).map((p) => p.nodeId).join(",")} to apply only the rest`.
     `--nodes` filtering already works on both generated and `--file` proposals
     (`proposalsFromInput`, `filterDecisionCommitNodeIds` validates ids against the checkpoint).
   - **Truncation disclosure:** in `loadCommitInput` after the `readAll()` at `:47`,
     `warnTruncatedJsonl(io, read.recovery, "event log")` (same label as `main.ts:1270`). Runs on
     preview and apply; stdout machine surface (`COMMITS_PREVIEW`) stays one clean line — the
     warning is stderr.
3. `src/cli/episode.ts` —
   - **E5:** after the `events` read at `:56`, `warnTruncatedJsonl(io, read.recovery, "episode event log")`;
     after the `close` snapshot read at `:100`, `warnTruncatedJsonl(io, read.recovery, "episode log")`
     (label matches `main.ts:1085` for the same store).
   - **E7:** `--json` is parsed for all subcommands (`:37`) but only `events` honors it; on
     `close`, refuse rather than ignore (house precedent: `list --status` with `--episodes`,
     `list.ts:189-198`): after the `subcommand !== "close"` guard, if `values.json === true` →
     `cliFail` `stage: "parse-args"`, message `episode close prints no JSON; --json applies to episode events`,
     next `drop --json, or use episode events --json`.
4. `src/cli/pause.ts` — **clear honesty rider:** before `clearPause` (`:90-93`), probe
   `pause.token(runId)` in a try/catch. Token `paused: true` → clear, current message. Token
   `paused: false` → clear (stays idempotent), print
   `No pause token for ${runId}; nothing to clear`. `token()` throws (malformed `pause.json` —
   `pause-controller.ts:28-35`) → still clear (the clear *is* the remedy for a damaged token) and
   print `Cleared malformed pause token for ${runId}`. Exit 0 in all three; re-runs stay safe.

**Tests** (extend, don't fork): `test/integration/cli/commits.test.ts` — partial-apply case via a
temp-repo `commit-msg` hook that rejects the second proposal's subject (Linux CI only; this file
is not in the Windows `cli-smoke` matrix, verified in `ci.yml:73-74`): assert exit 1, first commit
present, note matches `/1 of 2 .* --nodes/` and names the remaining nodeId; truncation case by
appending a half-line to `events.jsonl` before preview → stderr matches
`/ignored truncated event log/`, `--json` stdout still exactly one parseable line.
`test/integration/m3/episode-cli.test.ts` — truncated tail on the episode event log → warning +
remaining events still print; `close --json` → exit 1, `parseCliErrorJson` gives
`stage: "parse-args"`; existing close-refusal pins untouched.
`test/integration/cli/pause-inject.test.ts` — `pause --clear` with no token → exit 0,
`/nothing to clear/`; with a token → `/Cleared pause/`; with `pause.json` containing `not-json` →
exit 0, `/Cleared malformed pause token/`, file gone.

**Freeze pins, verified at HEAD:** zero test matches for `Committed `, `Cleared pause`,
`ignored truncated` (outside main-path tests with untruncated fixtures), or any episode-close
`--json` invocation (only `events --json` at `episode-cli.test.ts:138`); success-path
`assert.deepEqual(err, [])` pins hold because no fixture is truncated; the `COMMITS_PREVIEW`
exact-shape pin (`commits.test.ts:183`) parses stdout only; `CliErrorReport` gains no keys;
`INJECT_USAGE`/`PAUSE_USAGE` help pins compare against the imported constants
(`pause-inject.test.ts:8-9,285,304`) so they cannot break. **PR #12 / D18 contact: none** (four
src files + three test files, all outside both sets).

---

## Rank 2 — `auth`/`models` operator remainder: F6-key guard, F9, F13, one-dialect arg errors

**Why second.** Every item is live-verified operator pain in the self-configured-provider path,
and D16's KEEP plus the §0.5 verification says exactly what is left. F6 (`--key` half): a keyless
custom provider accepts and stores a secret that the request path **never sends**
(`runtime.ts:106-110` resolves keyless customs as `{auth: {}, source: "<id> (no key)"}` ignoring
the store) — the operator believes login worked; interactive login on the same provider surfaces
pi's baffling `local does not support api_key login`. F9: `models disable` silently deletes the
primary/fast default (`providers-config.ts:94-95` drops it; `disableCommand` at `models.ts:127-140`
prints only `Disabled <id>`), and the operator discovers it as a later run failure. F13: `auth
status --all` with nothing configured prints **nothing** and exits 0, and the hardcoded `env`
column mislabels ambient sources like `local (no key)`. Plus the last free G4 sites: six raw
bare-stderr arg errors in exactly these two files, while every sibling verb speaks `cliFail`.

**Exact files and edits:**

1. `src/cli/auth.ts` —
   - **F6-key/interactive guard:** in `loginCommand`, after the config load (`:147`), detect
     keyless custom exactly as `loginFromEnvCommand:190-192` does; when matched and the mode is
     `--key`, `--oauth`, or interactive, throw
     `DomainValidationError("provider ${id} is keyless (no envVar in providers.json): requests are sent with no key, so there is nothing to store — remove the flag, or add envVar to providers.json")`.
     (`--from-env` on the same shape is already refused; customs *with* `envVar` keep working
     end-to-end, verified in the R2 probes.)
   - **F13a:** drop the `&& values.all !== true` conjunct at `:94` so the "No stored credentials"
     notice prints under `--all` too; in the `--all` loop, count printed env rows and, when zero,
     print `(no environment-configured providers found)` — `--all` never again exits 0 with empty
     output.
   - **F13b:** replace the hardcoded `env` at `:110` with a derived label: `env` when
     `check.source` names an environment variable (the `envApiKeyAuth` shape), else `ambient` —
     column width unchanged (`padEnd(28)` intact).
   - **G4:** convert `:127-131` (login requires `<provider>`) and `:261-264` (logout requires
     `<provider>`) to `cliFail` `stage: "parse-args"` with `next: "run pi-sparkle auth --help"`;
     keep the usage echo before the report (episode precedent). Leave the bare/unknown-subcommand
     exit codes as they are — bare-verb exit normalization is the parked G7 item, not this batch.
2. `src/cli/models.ts` —
   - **F9:** in `disableCommand`, load the config before mutating, normalize `catalogId` via
     `parseModelRef`, and after `Disabled ${id}` print one line per dropped default:
     `note: ${id} was the ${role} default; the default is now unset — set a new one with pi-sparkle models set-default`.
     No `providers-config.ts` change (the pre-load compare suffices).
   - **G4:** convert `:116-119` (enable requires), `:133-136` (disable requires), `:151-154`
     (set-default requires `--primary`) to `cliFail` `stage: "parse-args"`,
     `next: "run pi-sparkle models --help"`. (The set-default site is the exact bare-stderr
     dialect example the R2 probe transcript flagged.)
   - **F14 optional rider (recommended):** in the non-`--available` list branch (`:100-106`),
     annotate enabled ids that fail `resolveListedModel` with `  (not in catalog)` — turns the
     post-pin-bump stale-entry explosion in `buildLiveCatalogConfig` into a visible line. Drop the
     rider if the diff should stay minimal; it is not what earns the slot.

**Tests:** `test/unit/cli/auth.test.ts` — keyless-custom `--key`/interactive refusal (exit 1,
message names `envVar`, `auth.json` byte-unchanged), `status --all` empty state (both lines
present, exit 0), label derivation (keyless custom row shows `ambient`, env row shows `env`), and
`parseCliErrorJson` cases for the two converted sites. `test/unit/cli/models.test.ts` — the
hermetic temp-state-root harness already there: disable-drops-primary disclosure, disable of a
non-default id prints no note, converted arg errors, optional stale-annotation case.

**Freeze pins, verified at HEAD:** zero test matches for any of the six raw-stderr strings, for
`Disabled `, `Defaults: primary`, the status column layout (`stored    `/`env       `), or any
`status --all` invocation; the one `Enabled ${primary}` pin (`commands.test.ts:91`) is on `enable`,
untouched; models.test.ts's five `--available` pins (builtin/custom/`(no models)`) all describe
behavior this batch keeps. `MODELS_USAGE`/`AUTH_USAGE` pinned fragments (`auth.test.ts` asserts
the store path and mode sentences) are not edited. Doctor `auth` check calls `checkProviderAuth`,
not `loginCommand` — no interaction. **PR #12 / D18 contact: none** (two src files + two unit test
files, all outside both sets; `pi-adapter/runtime.ts` is #12-held and is deliberately only *read*
for the F6 rationale, never edited).

---

## Rank 3 — Doctor storage/retention inventory (persist F5, the free half)

**Why third.** Retention is unbounded by accepted policy, and the only measurement surface is
`scripts/retention-probe.mjs` — unregistered, undocumented, and mislabeled (it divides the whole
state root by run count and calls it per-run). Doctor already inventories locks, crash candidates,
and learned-state files but says nothing about **growth**: an operator whose `~/.pi-sparkle` is
eating a disk cannot see which plane is growing or which existing verb (`delete --run`,
`episode`-cascade, `pref delete`) frees what. The `DoctorJsonReport` pattern for exactly this
shape already exists three times over (`locks`/`runStates`/`learnedState`: top-level
`advisory/entries/scanErrors` field + one summarizing check), so the addition is mechanical and
frozen-additive-legal. Ranked third because it is observability rather than an honesty repair —
but it is the highest-value item left that needs no `main.ts` and no #12 file.

**Exact files and edits:** `src/cli/doctor.ts` only —

1. New `DoctorStorageInventory` `{ advisory, entries, scanErrors }` with entries per record-class
   directory: `runtime/runs`, `runtime/episodes`, `runtime/invocations.jsonl`, `runtime/auth.json`,
   `runtime/providers.json`, `adaptation/feedback`, `adaptation/evals`,
   `adaptation/eval-datasets`, `preferences` — each `{ path, bytes, files, class }` where `class`
   is `runtime` | `adaptation`. Walk with `lstat`, **never follow symlinks** (count the link
   itself, do not recurse through it) — keeps the walk consistent with the D18 posture without
   touching any D18 file; unreadable subtrees land in `scanErrors`, never a throw. Advisory:
   `retention is unbounded by accepted policy; doctor measures and never deletes — delete --run and episode deletion are the reclaim verbs`.
2. Top-level `storage` field on `DoctorJsonReport` (`doctor.ts:67-77`) and a summarizing check
   `{ name: "storage", ok: scanErrors.length === 0, detail: per-plane byte/file totals + advisory }`
   appended after `learnedStateInventoryCheck(learnedState)` at `:929`. Checks keep exactly
   `name/ok/detail`.
3. Human output: one line via the existing check loop (no new print path).

**Tests:** `test/unit/cli/doctor.test.ts` — same-diff **legal additive pin updates**, both
precedented by the `learnedState` addition: append `"storage"` to `CONTRACT_KEYS`
(`doctor.test.ts:159-169`) and to the ordered check-name list (`:229-246`, sixteen names after);
add `Object.keys(report.storage)` = `["advisory","entries","scanErrors"]` and an entry-shape pin;
behavior cases: empty state root (zero entries or zero-byte entries, ok), populated temp tree with
known byte counts, an unreadable directory → `scanErrors` + check not-ok, and a symlinked
`eval-datasets/<runId>` leaf whose target bytes are **not** counted. **Windows caution carried
from R4:** this file runs on the Windows `cli-smoke` leg (`ci.yml:73-74`) — temp-dir hermetic,
`path.join` throughout, no shell, no symlink assertions on Windows (guard the symlink case with a
capability check, the same pattern the D18 tests use on the main suite).

**Freeze pins:** doctor `--json` is frozen-additive and this is the additive move; no sixth
`DOCTOR_ROUTED_NEXT` route (a check is not a route; the five tuples at `doctor.ts` are untouched);
crash probe untouched (`scripts/` untouched); `package.json` untouched — registering
`retention:probe` and correcting the probe's metric are **explicitly deferred behind #12**
(`package.json` and `scripts/` are #12-contended). **PR #12 / D18 contact: none** (one src file +
one test file; `doctor.ts` was D16's file and D16 is KEEP).

---

## HOLD / NO_HIGH_VALUE — the rest of the candidate list, one line each

- **Windows cli-smoke step**: HOLD behind PR #12 — lives only in `ci.yml`, which #12 edits; the
  R3 YAML is land-ready the day #12 merges.
- **Status-matrix rows / data-dictionary / README riders**: HOLD behind PR #12 — all three files
  are in #12's diff; every batch above defers its docs rider accordingly.
- **`main.ts` remainder** (G5 placeholders, `inspect --episode` circular not-found remedy at
  `main.ts:1082`, E4 `[--outcome]`, bare-verb exit-code normalization G7): HOLD behind #12 — all
  in the one contended src file.
- **F4 / F12 / F6-from-env**: already landed in `4a99475`+`b2d924e` (verified §0.5) — removed
  from the queue, not re-ranked.
- **F7 (oauth capability discoverability)**: NO_HIGH_VALUE this round — no runtime capability
  surface is verified in the pinned pi-ai (deps not installed on this VM; the only known source is
  a grep of `dist/providers/*.js`), so a hardcoded id list in `AUTH_USAGE` would drift with every
  pin bump; revisit with a probe-based design.
- **F15 (auth.json 0644→0600 temp-file window)**: NO_HIGH_VALUE for a product/usability campaign —
  same-user directory, final perms verified 0600; internals hardening, queue for a security slot.
- **persist F6 (feedback list/export/per-record delete)**: HOLD — a genuine missing verb, but it
  needs a `main.ts` dispatch case or `adapt.ts`, both #12-held.
- **Cost/usage report verb (map #5)**: HOLD behind #12 — needs `main.ts` and builds on #12's
  `--max-cost-usd` accounting.
- **Context G2 (`ANALYSIS_QUEUED` formatter honesty)**: HOLD — the formatter lives in
  `inspection.ts`/`inspect-format.ts`/`main.ts`, all #12-held.
- **Context G6 (fact-plane sentence)**: too thin to earn a slot — the free half is one
  `INJECT_USAGE` sentence (safe: help pins compare against the imported constant); noted as an
  optional rider on any future `inject.ts` touch.
- **D7 Variant B (same-episode continuation)**: frozen by decision — design slot, not an operator
  batch; not ranked.
- **`adapt dataset` follow-ups**: owned by the in-flight GPT-d18 recheck — no assignment until
  KEEP.
- **Track/tracking dead-knob cleanup (context G7/G8)**: NO_HIGH_VALUE — inert machinery with
  living pins is cheap; the docs rider that would make it honest is status-matrix (#12-held).

## Final ranking

1. **`commits`/`episode`/`pause` claim-only-what-happened batch** — C4 partial-apply disclosure +
   E5 truncation-warning parity (shared helper in `errors.ts`) + E7 `close --json` refusal +
   `pause --clear` honesty. Files: `src/cli/{commits,episode,pause,errors}.ts` + three integration
   test files. Protects the operator's git history; every string verified unpinned.
2. **`auth`/`models` operator remainder** — F6 keyless-custom login guard, F9 dropped-default
   disclosure, F13 status `--all` empty state + honest source column, G4 dialect conversion of the
   six raw-stderr sites, optional F14 stale-annotation rider. Files: `src/cli/{auth,models}.ts` +
   two unit test files.
3. **Doctor storage/retention inventory** — additive `storage` top-level field + check, lstat-only
   walk, Windows-hermetic tests, legal additive pin updates. Files: `src/cli/doctor.ts` +
   `test/unit/cli/doctor.test.ts`.

The three batches are mutually file-disjoint, disjoint from PR #12 and the D18-owned set, and can
be dispatched concurrently.
