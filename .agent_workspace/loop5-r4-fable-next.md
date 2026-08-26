# Loop 5 · Round 4 — Fable-next: the three implementable operator batches after Round 3

Slot: Fable-r4-next (claude-fable-5-thinking-xhigh). Analysis/spec only; no `src/` edits, no commit
by this agent.

Ranked at HEAD `6401a9a` (`merge: Loop 5 R3 honest blocked-note wording and hardened gate
pairing`) on `cursor/pi-sparkle-sota-opt-0da8`, 4 commits ahead of origin, working tree content-clean
(the `docs/agent-progress.md` "modified" in `git status` is a stale stat entry — `git diff --raw` is
empty). Method: direct reads at HEAD of `src/cli/{episode,inject,pause,commits,models,doctor,
init-examples,main}.ts`, `src/pi-adapter/{auth-session,listed-model}.ts`, the relevant test files;
pin greps for every string a batch below would change; PR #12 state and full file list re-pulled via
`gh pr view 12` (OPEN, `cursor/merge-preview-release-8011`); D10 read from
`docs/agent-decisions.md:83-85`.

## 0. Constraints every batch below satisfies

- **D10 file-disjointness.** D10 (dataset privacy: redact-then-truncate, workspace-path record
  class, `delete --run` cascade into `adaptation/eval-datasets/<runId>/`, realpath `--dir` guard) is
  still in flight and owns `src/learning/eval-dataset.ts` and `src/privacy/deletion.ts` — plus, in
  practice, `src/cli/adapt.ts`, `src/privacy/record-classes.ts`, and their tests
  (`eval-dataset.test.ts`, `deletion.test.ts`, `adapt.test.ts`, `record-classes.test.ts`,
  `plane-boundary.test.ts`). No batch below touches any file under `src/learning/`, `src/privacy/`,
  or `src/cli/adapt.ts`, nor any of those tests.
- **PR #12 disjointness.** #12's src files are `adaptation/eval-routing.ts`, `cli/adapt.ts`,
  `cli/inspect-format.ts`, `cli/main.ts`, `feedback/redaction.ts`, `pi-adapter/runtime.ts`,
  `run/flowchart-run.ts`, `run/inspection.ts`, plus `ci.yml`, README, `docs/status-matrix.md`,
  `docs/data-dictionary.md`, `package.json`, and 20 test files (including
  `test/integration/m1/cli-children.test.ts` and `test/integration/cli/cli.test.ts`). No batch below
  edits any of these — in particular **no `main.ts` edit, no README/docs rider, and F8/F5 stay out
  of `pi-adapter/runtime.ts`**. Docs riders that would normally accompany these batches are
  explicitly deferred behind #12.
- **Freeze gate** (gpt-frozen §3-4 as restated in `loop5-r3-fable-aux.md` §0): no new `Event` type;
  `GENERIC_FAILURE_NEXT` + five `DOCTOR_ROUTED_NEXT` routes character-exact; `CliErrorReport` keys
  exactly `ok/command/stage/message/next/runId?/taskId?`; machine JSON = one compact line with
  literal `type` + `preview: true` and a day-one exact-shape pin; pinned `main.ts` USAGE fragments
  and the byte-pinned `blocked-next` inject remedy lines untouched (trivially — no `main.ts` edit).

Round 3 state this ranking is measured against (verified in source, not inherited): E1 disclosure
landed (`episode.ts:113-120` + USAGE sentence), I1 help landed (`INJECT_USAGE`/`PAUSE_USAGE` +
parse-args catch), C1+C2+C3 landed (`commits.ts` is all-`cliFail`, `COMMITS_PREVIEW` typed-compact,
run-not-found routed to `list` at `commits.ts:49-57`), auth F1/F2 landed (exclusive login flags +
`checkProviderEnvAuth`), D8/D9 track fixes landed, D13 catalog honesty landed.

---

## Rank 1 — Finish the G6 not-found retarget onto `list` (aux E2 + I2 + `pause` remedy)

**Why first.** The house remedy shipped twice already (`missingRun` at `main.ts:578-588` for
inspect/resume/answer; copied into `commits.ts:49-57` in Round 3), so the CLI now speaks two
not-found dialects: five verbs route the operator to the inventory that answers the question, while
`episode` still answers "episode X not found" with `inspect --run` (which requires the run id the
operator equally lacks), `pause` gives the circular "check --state-root and --run <id>", and
`inject` on a missing run still falls through to `restoreFlowchartSession`'s throw and exits as a
*generic* catch-all report with `GENERIC_FAILURE_NEXT` — no stage, no `runId` key, no remedy.
Highest confusion-relief per line, fully mechanical, zero contract risk.

**Exact files and edits:**

1. `src/cli/episode.ts` — two string edits, one line each:
   - `:62` (events not-found) `next:` becomes
     `check --state-root, then pnpm cli list --state-root ${stateRoot} --episodes for the episode ids that exist there`.
   - `:102` (close not-found) `next:` becomes the same string.
2. `src/cli/pause.ts` — `:84` `next:` becomes the `missingRun` house wording:
   `check --state-root, then pnpm cli list --state-root ${stateRoot} for the run ids that exist there`.
3. `src/cli/inject.ts` — I2's preflight, mirroring `pause.ts:78-87` exactly: after `parseRunId`,
   `await new EventStore(stateRoot, runId).readAll()`; if `events.length === 0`, `cliFail` with
   `command: "inject"`, `stage: "lookup"`, `message: "Run ${runId} not found under ${stateRoot}"`,
   the house `next:` above, and `runId`. **Copy the wording; do not import `missingRun` from
   `main.js`** — `main.ts` imports `injectCommand`, so that import is a cycle (same rationale
   recorded in `commits.ts:49-50`). Adds one `EventStore` import; deeper plane errors (no durable
   checkpoint, non-flowchart) keep their existing throw path.

**Explicitly excluded:** the `inspect --episode` not-found remedy at `main.ts:1081-1083` ("pass a
bound --episode id from inspect --run") is the same defect but lives in #12-contended `main.ts` —
leave it queued behind the merge; note it in the landing report so it isn't lost.

**Tests:** extend, don't fork. `test/integration/m3/episode-cli.test.ts`: not-found cases for
`events` and `close` asserting `parseCliErrorJson` yields `stage: "lookup"` and `next` matching
`/pnpm cli list/` and `/--episodes/`. `test/integration/cli/pause-inject.test.ts`: (a) inject
against a missing run → exit 1, `command: "inject"`, `stage: "lookup"`, `runId` present, `next`
matching `/pnpm cli list/`; (b) same `next` assertion on pause's existing lookup path. Neither file
is in PR #12 or the D10 set.

**Freeze pins, all verified at HEAD:** the three replaced strings are unpinned (grep across `test/`
for "inspect --run first to get", "inspect --run to find", "check --state-root and --run": zero
hits); `pause-inject.test.ts` has no pin on inject's current not-found behavior (no "not found" /
"restoreFlowchartSession" / "no durable checkpoint" matches), so converting generic→lookup is
unpinned in both directions; `GENERIC_FAILURE_NEXT` and `DOCTOR_ROUTED_NEXT` constants are not
edited; `blocked-next.test.ts`'s byte pins live in `main.ts:499-503`, untouched; `CliErrorReport`
gains no keys (`runId` exists). PR #12 collision: **none** (three files, none in its list).

---

## Rank 2 — Remaining auth batch: secret echo muting (F5) + doctor auth preflight (F11) + custom providers in `--available` (F8)

**Why second.** All three re-verified still open at HEAD, and they are the highest-weight operator
items left standing: F5 is security-adjacent (a pasted API key is echoed to the terminal and lands
in scrollback, while the module header at `auth-session.ts:153-154` still claims "Never echoes");
F11 is the worst remaining failure mode (missing credentials discovered mid-run as Pi's
`Provider is not configured` after run state exists, while `doctor.ts:710` explicitly punts); F8
makes the one advertised browse surface show the models the operator configured themself
(`models.ts:70-81` consults only builtin `listSparkleModels`; `models enable local/m1` succeeds
while `models list --available --provider local` prints "(no models)").

**Exact files and edits:**

1. **F5 — `src/pi-adapter/auth-session.ts`.** In `cliAuthInteraction`, branch on
   `prompt.type === "secret"` before the generic `ask` (`auth-session.ts:181`): when `io.question`
   is injected, keep the current path (tests and embedders unchanged); on the real-stdin path,
   create the readline interface over a muting `Writable` that passes the prompt text through and
   suppresses keystroke echo afterwards (~15 lines, no new deps). Rewrite the `:153-154` header
   comment to state the real contract. Optional same-function rider: F10's stdin-EOF settle
   (reject the `question` promise on the interface `close` event) — same 10 lines of the same file,
   recommended.
2. **F11 — `src/cli/doctor.ts`.** One additive check (suggested id `auth`, placed after
   `providers`): resolve the providers of `primary`/`fast`/`enabled` from the providers config and
   call the existing exported `checkProviderAuth` (`auth-session.ts`, unit-tested at
   `auth-session.test.ts:242-284`) for each; `detail` reports provider + source **type only, never
   a secret** (same posture as `auth status`); nothing enabled → ok with a "fake executor needs no
   credentials" detail (keeps the current `:710` honesty). Follow the existing injection-seam
   pattern (the `nodeVersion` inject / keyed readers) so tests stay hermetic. No network:
   `checkAuth` is local source resolution (measured ~0.85s for ~30 providers in the R2 audit;
   preflight touches ≤3).
3. **F8 — `src/cli/models.ts`.** In the `--available` branch (`:70-81`): also
   `loadProvidersConfig(stateRootOf(values))` and append `listedModelsFromCustom(provider)` for
   each custom provider (respecting `--provider`); the helper already ships
   (`listed-model.ts:47-60`). ~8 lines.

**Tests:** `test/unit/pi-adapter/auth-session.test.ts` — muting-writer unit (prompt text passes,
subsequent writes suppressed) + secret-prompt path via injected streams; existing injected-question
pins hold by construction. `test/unit/cli/doctor.test.ts` — new check cases via env-var + temp
providers.json; **must update the exact ordered check-name list at `doctor.test.ts:228-246`**
(fourteen names today) in the same diff — a legal additive-contract pin update, precedented by every
prior check addition; each check keeps exactly `name/ok/detail` keys (`:222-227`). Caution unique to
this batch: `doctor.test.ts` runs on the **Windows CI leg** (`ci.yml` names it in `cli-smoke`), so
the new cases must be env-var/temp-dir hermetic and path-portable. `test/unit/cli/models.test.ts` —
new file (none exists; verified by glob), covering builtin-only, custom-appended, and
`--provider <custom>` cases.

**Freeze pins:** doctor `--json` is frozen **additive-only** — a new check is the legal move; no
sixth `DOCTOR_ROUTED_NEXT` route is added (checks are not routes). `MODELS_USAGE` ("Browse the Pi
catalog with --available") and "(no models)" are unpinned (grep: zero hits); the gpt-frozen §4
pinned USAGE fragments are all in `main.ts`, untouched. PR #12 collision: **none** — #12 touches
`pi-adapter/runtime.ts` but not `auth-session.ts`/`listed-model.ts`/`models.ts`/`doctor.ts`, and
none of the three test files. D10: no privacy/learning file touched. Deliberately **excluded** to
avoid churning Round 3's fresh auth landing while the GPT landing challenge is out: F4 corrupt-store
remedy, F6 keyless-custom guard, F12 logout honesty, F13 status polish (all in `auth.ts`) — queue as
one `auth.ts` follow-up after the challenge reports.

---

## Rank 3 — `INIT_EXAMPLES` compact one-line JSON (last off-convention machine surface)

**Why third.** Round 3's `COMMITS_PREVIEW` landing closed half of the "machine surfaces are one
compact typed line" pair (R1 review §2.3 / R2 aux C2); `init --json` is now the CLI's **only**
pretty-printed machine object (verified: `JSON.stringify(..., null, 2)` at
`init-examples.ts:150-160`). It is on the "before external scripts ossify" clock — every round it
waits, the multi-line form gets harder to change — and it is a two-line diff.

**Exact files and edits:** `src/cli/init-examples.ts:149-161` — drop the `null, 2` arguments so the
object prints as one compact line; keys stay exactly `type/preview/dir/files/overwritten`.
`test/unit/cli/init-examples.test.ts` — the existing exact-shape pin (`:207-213`) parses full
stdout with `JSON.parse` and passes unchanged (verified); add the D3 one-line pin in the same diff:
stdout trims to exactly one line that `JSON.parse`s to the deepEqual shape.

**Freeze pins:** `INIT_EXAMPLES` keys unchanged (frozen-additive holds vacuously); no USAGE edit
needed; the proposed Windows smoke step prints this object but asserts nothing about its line shape
(orthogonal). PR #12 / D10 collision: **none** (two files, in neither set).

---

## NO_HIGH_VALUE / HOLD — the rest of the candidate list, one sentence each

- **Windows cli-smoke** (`loop5-r3-fable-windows.md`): **HOLD until PR #12 merges** — the step can
  only live in `ci.yml`, which #12 edits, and although the hunk analysis shows a clean textual
  merge in either order, the campaign's standing sequencing rule (R1 review §2.1, R2 aux §2.3)
  defers all `ci.yml` edits behind #12 and there is no file-disjoint way to add a CI step; the §1
  YAML is land-ready verbatim the day #12 merges.
- **Status-matrix rows** (`loop5-r3-fable-matrix.md`): **HOLD** on two independent grounds — PR #12
  edits `docs/status-matrix.md`, and the Round 15 census-note contract requires "no sibling landing
  in flight", which is false while D10 is open; the copy-paste rows and census replacement are
  ready in that report.
- **Track same-episode continuation (Variant B)**: NO_HIGH_VALUE now — D7 recorded GPT's DEFER
  ("do not implement Variant B as specified") pending a race-safe reservation design, so it is a
  design slot, not an operator batch.
- **`auth.ts` riders (F4/F6/F12/F13)**: NO_HIGH_VALUE this round — each is small and real, but they
  churn the file Round 3's Opus-auth just rewrote while the GPT Round 3 landing challenge is still
  out against exactly that landing.
- **`main.ts` remainder (G5 placeholders, `inspect --episode` remedy, E4 `[--outcome]`)**:
  NO_HIGH_VALUE until #12 merges — every item is a cosmetic-to-small edit in the one contended src
  file, and none is worth reopening the merge-order risk early.
- **Episode/commits micro-riders (E5 truncation warning, E7 `--json` ignored, C4 partial-apply
  line)**: NO_HIGH_VALUE as a standalone batch — each is one line without an operator-pain story;
  fold E5/E7 into the next `episode.ts` touch (Rank 1 lands in `episode.ts`, so E5's
  `warnTruncatedJsonl` call and E7's refuse-or-document are cheap **optional riders** there if the
  parent wants them, but they are not what earns the slot).

## Final ranking

1. **G6 not-found retarget completion** — `episode.ts` + `pause.ts` + `inject.ts` (+ their two
   test files); strings verified unpinned; zero #12/D10 contact.
2. **Auth remainder F5+F11+F8** — `auth-session.ts` + `doctor.ts` + `models.ts` (+ two extended
   test files, one new `models.test.ts`); one legal additive pin update in `doctor.test.ts`;
   Windows-leg hermeticity required for the doctor cases; zero #12/D10 contact.
3. **`INIT_EXAMPLES` compaction** — `init-examples.ts` + its test; existing pin passes, one-line
   pin added per D3; zero #12/D10 contact.

The three batches are mutually file-disjoint and can be dispatched concurrently.
