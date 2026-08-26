# Loop 5 · Round 12 — Fable-next: the three implementable operator batches after Round 11

Slot: Fable-r12-next (claude-fable-5). Analysis/spec only; no `src/` edits by this agent; not merged
to the parent integration branch.

Ranked at HEAD **`a9ea02f`** (`docs(agent): record Fable-r12-next dispatch id`) on
`origin/cursor/pi-sparkle-sota-opt-0da8`, fetched fresh (`git fetch origin
cursor/pi-sparkle-sota-opt-0da8`) and re-fetched after probing — origin moved once during this
round, from the Round 11 closeout `d115e9d` to `a9ea02f`, and the whole delta is four lines of
`docs/agent-progress.md` (`git diff --stat d115e9d a9ea02f`); **every `src/` and `test/` byte
ranked here is identical at `d115e9d` and `a9ea02f`** (`git diff d115e9d a9ea02f -- src test` is
empty). Method: direct full reads at HEAD of
`src/cli/{list,models,auth,pause,inject,commits,episode,validate,init-examples,doctor,errors,migrate-legacy,pi-compat,doctor-overlay,model-catalog}.ts`,
plus `src/routing/cost-calibration.ts`, `src/pi-adapter/auth-session.ts` (login/prompt paths),
`src/pi-adapter/file-credential-store.ts` (error typing), `src/config/providers-config.ts`
(throw sites), and `main.ts`'s dispatch/catch tail read for the envelope every unconverted throw
gets (`stage: "validation"` for a `DomainValidationError`, `"execute"` otherwise, `next: "fix the
reported error, then retry; use pi-sparkle doctor for preflight"`, and the verb's subcommand
dialect lost). Pin greps across `test/` for every string a batch below would change: `unknown
model` is pinned only for `models enable`/`set-default` (`models.test.ts`,
`api-config.test.ts`) and `validate` (`validate.test.ts`) — never through `pause`/`inject`;
`stdin closed` is pinned **nowhere** in `test/`; no test passes a blank `--state-root`,
`--project`, or `--agents-dir` to `doctor`. PR #12 file list pulled live twice via `gh pr view 12
--json files,state,headRefName` (OPEN, head `cursor/merge-preview-release-8011`; src set
unchanged across the round: `adaptation/eval-routing.ts`, `cli/adapt.ts`,
`cli/inspect-format.ts`, `cli/main.ts`, `feedback/redaction.ts`, `pi-adapter/runtime.ts`,
`run/flowchart-run.ts`, `run/inspection.ts`, plus its test files — re-listed in §0).
**Every defect claimed below was reproduced live on this VM** (`pnpm install --frozen-lockfile`
clean, Node v22.14.0 — engines `>=22.19.0` warning only) via `node_modules/.bin/tsx
src/cli/main.ts` from a controlled cwd, against `/tmp/r12probe/**`: a real fake-executor
COMPLETED run (`run --project /tmp/r12probe/proj --objective … --state-root
/tmp/r12probe/state`, default executor, exit 0, `run_c1a93fdb-…`), a cwd trap directory
(`/tmp/r12probe/cwdtrap`) holding a `package.json` and a `runtime/runs/<that run>/events.jsonl`
truncated to its first three events so it replays PLANNING, a hand-edited
`runtime/providers.json` carrying one enabled model the catalog does not resolve (the exact
artifact `models.ts` documents: "a pin bump that drops a model leaves the entry behind"), a
corrupt `providers.json` variant, and a piped-empty stdin for the interactive login. Probe
outputs are quoted in place; every refusal quoted exited 1 and every success quoted exited 0
unless stated otherwise. Baseline: the three test files the batches extend pass **109/109** at
HEAD (`npx tsx --test` — per file: `doctor.test.ts` 32, `pause-inject.test.ts` 40,
`auth.test.ts` 37).

## 0. Round 11 closeout honored; constraints every batch satisfies

- **Not re-ranked.** D40 KEEP `f3a1c21` (`commits.ts` stored-ledger envelopes; absent=lookup,
  corrupt/non-flowchart/zero-completed=validation; path-free inspect nexts; `EventStore.readAll`
  outside the catch), D42 KEEP `5057df8` (`episode.ts` blank `--outcome`, terminal re-close
  next, events flag relevance, D39 dispatch order kept), D41 KEEP `be653d6` (`inject.ts`
  override/skip `--key`/`--value` refusals, `parseFactValue` before blank-root, mixed-argv
  value-first). Per the round brief their files are free only for **NEW** defects: Rank 2
  reopens `pause.ts` (D31/D37 scopes) and `inject.ts` (D30/D31/D37/D41 scopes), Rank 3 reopens
  `auth.ts` (D12/D16/D21/D24/D28/D35/D37 scopes), Rank 1 reopens `doctor.ts` (D29/D22 scopes) —
  each for a defect none of those decisions classified, stated at the batch. Earlier D1–D39
  KEEP as recorded in `docs/agent-decisions.md` (re-read in full this round, with D20/D32/D34's
  path-free-`next` rule, D15's copied-guard rule, and D37–D39).
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
  untouched trivially. No batch edits `model-catalog.ts` (shared with main's `run`/`resume`
  callers), `injection.ts`, `flowchart-run.ts`, `auth-session.ts`, or any store.
- **Freeze gate.** No live R1/`selectArm`/`planTaskTopology`; ADR-006 stays Proposed;
  `INSPECT_SUMMARY` four keys untouched; **doctor `--json` byte-identical for every accepted
  argv** — Rank 1's three guards fire at parse-args before `readPackageEngines()` and print no
  JSON on refusal, exactly like D29's existing mistyped-flag refusal; doctor `runStates` stays
  PLANNING/RUNNING; check names and the five `DOCTOR_ROUTED_NEXT` routes byte-identical;
  eight-member `RunStatus`; no new Event types and no new JSON key anywhere (`AUTH_STATUS`,
  `MODELS_LIST`, `RUN_LIST`, `COMMITS_PREVIEW`, `VALIDATE_OK`, `INIT_EXAMPLES` untouched — no
  ranked refusal sits on a JSON success path); no new `stage` value (`parse-args`/`validation`/
  `preflight`/`lookup` all exist in these modules today); `package.json` untouched; no
  Outcome-supported claims; D7 Variant B untouched; `episode close --outcome` value domain
  untouched; no Pi extension registered. Windows CI: no batch touches `cli-children.test.ts`;
  every new fixture below is argv + capture-io + `mkdtemp` construction, and the one coded-fault
  passthrough uses a directory-where-a-file-belongs fixture (`readFile` reports EISDIR on POSIX
  and Windows both); no chmod-dependent case is load-bearing.

**The round's through-line, found by probing every free verb at HEAD:** Rounds 8–11 made the
free verbs honest about their flag values, their config plane, which tree they act on, and the
stored state they read. What is still live is the **remedy chain itself**. Every generic and
unconverted refusal in this CLI ends in the same sentence — "use pi-sparkle doctor for
preflight" — and this round's probes show the three places that sentence still breaks: `doctor`
itself, handed the blank `--state-root`/`--project` an unset shell variable leaves behind,
answers authoritatively about a cwd-relative tree the operator never named (and for `" "`
*creates a directory* and passes itself); `pause` and `inject` still throw the one config-plane
fault their own router build can hit — an enabled model the catalog no longer resolves — through
main's catch at a doctor whose report, probed on that exact root, is green on `providers` and
`auth` and never says the word "model", while `validate` has owned the honest envelope for the
identical fault since D36; and `auth login`'s interactive path reports a closed stdin as
`command: "auth"`, `stage: "validation"` with the doctor next — the one auth-login refusal left
that loses the D28/D35 dialect and prescribes a remedy that cannot conjure a terminal. Grep
confirms no closed decision pinned any of these: D29/D22 pinned doctor's argv dialect and
storage check, D30/D31/D37/D41 pinned inject's argv and root, D31/D37 pause's, D12–D35 pinned
every auth surface except the prompt flow — none classified the three defects below.

---

## Rank 1 (D43) — `doctor` refuses blank `--state-root`/`--project`/`--agents-dir` instead of answering about a tree the operator never named

**Why first.** Doctor is the remedy target of every generic `next` in the CLI: it is the command
an operator is *told to run* when something else failed, usually with flags copied from the
failing invocation — including `--state-root "$SR"` with the variable unset, the exact artifact
D37 closed on all seven state-verbs and D38/D39 closed on migrate-legacy and episode. Doctor is
the last free verb without the guard, and it is the worst place to lack it, because its whole
job is to answer authoritatively. All reproduced live at HEAD:

- **blank `--state-root` inventories the cwd.** From `/tmp/r12probe/cwdtrap` (holding
  `package.json` and a `runtime/runs/run_c1a93fdb-…/events.jsonl` that replays PLANNING):
  `doctor --state-root "" --json` exits 1 and the report mixes verdicts about an invisible path
  with authoritative inventories of the current directory —
  `state-root` FAILs as `" not writable: ENOENT: no such file or directory, mkdir ''"` (the
  subject path is empty, so the line names nothing), while `run-state-inventory` is **ok** with
  `1 PLANNING/RUNNING run log(s)`: entry `runId: run_c1a93fdb-…`, `path:
  runtime/runs/run_c1a93fdb-…/events.jsonl` — a **cwd-relative** path (`runtimeRoot("")` is
  `"runtime"`) — and `remediation: "inspect with pi-sparkle inspect --run run_c1a93fdb-…; then
  resume --run … or delete --run …"`, commands that, run as printed (no `--state-root`), target
  the default `~/.pi-sparkle` — a *third* tree. `storage` is ok totalling the trap
  (`runtime=1690 logical byte(s) in 1 file(s)`), `legacy-layout` says `no pre-plane files
  under ` (blank interpolation), and `providers` reads `<cwd>/runtime/providers.json`: with a
  config seeded into the trap the human report printed `ok providers: enabled=1
  primary=openai/gpt-4o` — the trap's configuration reported as the answer;
- **whitespace `--state-root` writes.** From an empty cwd: `doctor --state-root " "` printed
  `ok  state-root:   writable` and **exit 0** — and `ls` shows the cwd gained a directory
  literally named `" "`: the write-probe `mkdir`'d a root the operator never meant, then doctor
  passed itself on it. A read-and-report tool ("it never steals locks, changes run state, or
  repairs learned state" — its own usage) created a filesystem entry out of an unset variable;
- **blank `--project` answers about the cwd and invents learned state.** `doctor --project ""
  --state-root /tmp/r12probe/state`: `project ok —  has package.json` (the *trap's*
  `package.json`, with a blank subject), `skill-route` and `agent-drift` answer about
  `<cwd>/.pi/**`, and `learned-state-inventory` gains a bandit entry with `projectKey: "p0"` —
  `stableProjectKey("")` hashed the empty path into a project key for a project the operator
  never named;
- **blank `--agents-dir` is silently read as absent.** `doctor --agents-dir "" …`:
  `pi-dispatch ok — skipped (no agents dir)` — an explicitly passed flag converted into "you
  passed nothing", exit 0, where the dir the operator meant might have FAILed the check.

**Exact files and edits:** `src/cli/doctor.ts` + `test/unit/cli/doctor.test.ts` only. Three
guards, copied per module (the D15 rule — no helper in `errors.ts`), inserted after the
`values.help === true` return and **before `readPackageEngines()` and every inventory** —
path-free argv work, before any filesystem read or write, so no later line can interpolate the
blank and the `" "` mkdir can never run. Order: `--state-root`, then `--project`, then
`--agents-dir` (usage order). Each is `cliFail` `command: "doctor"`, `stage: "parse-args"`:

1. `--state-root` blank/whitespace: `message: 'invalid --state-root "${raw}": state root must
   be a non-empty directory path'`, `next: "pass --state-root <dir> or omit it to use the
   default ~/.pi-sparkle"` — the D37 bytes, unchanged.
2. `--project` blank/whitespace: `message: 'invalid --project "${raw}": project root must be a
   non-empty directory path'`, `next: "pass --project <dir> or omit it to skip the project
   checks"` (omission is the documented default — `projectCheck` says "omitted"; explicit blank
   is malformed, the D38 `--dir` rule).
3. `--agents-dir` blank/whitespace: `message: 'invalid --agents-dir "${raw}": agents directory
   must be a non-empty path'`, `next: "pass --agents-dir <dir> or omit it to use the default Pi
   agents directories"`.

No other change: check functions, inventories, `DOCTOR_USAGE`, and the report assembly keep
every byte.

**Tests** (extend `doctor.test.ts`; harness drives `doctorCommand` with capture-io and mkdtemp
roots): whole-field envelope pins for all three flags with `""`, plus `--state-root "  "`; a pin
that the refusal prints **no JSON** on stdout in `--json` mode and exits 1 (the D29 parse-args
precedent); a mixed pin `doctor --state-root "" --project <real dir>` reports the root first
(guard order); a passthrough pin that a nonblank relative `--state-root` still inventories as
today (existing tests already pass temp roots — bytes unchanged); and `--help --state-root ""`
still prints usage and exits 0 (help precedes the guards, the D39-order precedent). Existing
pins hold: grep confirms no test passes a blank value for any of the three flags, and every
D29/D22 pin (argv dialect, storage check, frozen `--json` keys) triggers on nonblank argv — all
32 baseline tests pass unchanged.

**Freeze/PR#12 check:** doctor `--json` frozen-additive contract byte-identical for every argv
it accepts (the guards fire before report assembly; a refused argv printed a *failing report
about the wrong tree* before, and prints no report now — the same shape as D29's mistyped-flag
refusal); `runStates` PLANNING/RUNNING untouched; check names untouched; no new stage value
(`parse-args` exists in doctor since D29). `doctor.ts` reopened outside D29's closed scope
(`--help`/argv dialect) and D22's (storage inventory) — neither classified blank flag values;
stated reopening. Neither file is in PR #12. Disjoint from Ranks 2 and 3.

---

## Rank 2 (D44) — `pause`/`inject` stop throwing their own router-build fault at a doctor that cannot see it

**Why second.** The one config-plane fault these two verbs' own module code can hit — the
routing catalog they build before touching the run — still crosses into main's generic catch,
and the remedy it comes back with is provably empty while `validate` has owned the honest
envelope for the identical fault since D36 (KEEP). Reproduced live at HEAD against the real run,
with `runtime/providers.json` hand-edited to `{"version":1,"enabled":["openai/no-such-model"]}`
— the exact stale-entry artifact `models.ts`'s own comments document ("a pin bump that drops a
model leaves the entry behind") — and `OPENAI_API_KEY` set so the provider itself resolves:

- `pause --run run_c1a93fdb-… --reason hold --state-root /tmp/r12probe/state` →
  `{"ok":false,"command":"pause","stage":"validation","message":"unknown model
  \"openai/no-such-model\"","next":"fix the reported error, then retry; use pi-sparkle doctor
  for preflight"}` — the message never says which surface owns the fault (the run? the
  flowchart? providers.json?), and the envelope carries no `runId`;
- `inject --run run_c1a93fdb-… --type fact --key k1 --value v1 …` → the identical envelope with
  `command: "inject"` — a D41-vetted argv, a real run, and the verb still refused for a
  configuration fault it blamed on nothing;
- **the remedy is provably empty:** `doctor --json --state-root /tmp/r12probe/state` on that
  exact root reports `providers ok — enabled=1 primary=(none)` (the config parses),
  `auth ok — openai=api_key via OPENAI_API_KEY` (the provider resolves), every inventory ok,
  and the only FAIL is this VM's unrelated Node-engines pin: nothing in the report names a
  model fault. The surfaces that do answer are `models list --state-root …` →
  `openai/no-such-model  (not in catalog)` (exit 0) and the cure itself, probed:
  `models disable openai/no-such-model …` → `Disabled openai/no-such-model`, exit 0;
- **`validate` already owns the honest envelope for this exact fault** (the D36 KEEP, quoted
  from the same root): `validate --flowchart … --state-root /tmp/r12probe/state` →
  `{"ok":false,"command":"validate","stage":"validation","message":"could not build the model
  catalog at /tmp/r12probe/state: unknown model \"openai/no-such-model\"","next":"disable an
  unknown enabled model with pi-sparkle models disable <provider/model>, repair
  /tmp/r12probe/state/runtime/providers.json, or pass --state-root <dir>"}` — one fault, two
  spellings, one of them a dead end;
- **the fault is scoped to the action paths:** `pause --clear --run … ` on the same broken
  catalog prints `No pause token for run_c1a93fdb-…; nothing to clear`, **exit 0** — `--clear`
  never builds the router; and a missing run on the same broken catalog still reports
  `stage: "lookup"` first (probed) — the build sits after the lookup today and stays there.

**Exact files and edits:** `src/cli/pause.ts` + `src/cli/inject.ts` +
`test/integration/cli/pause-inject.test.ts` only. `model-catalog.ts` is not edited (it is shared
with `main.ts`'s `run`/`resume` callers, which are PR #12 territory); `injection.ts`,
`flowchart-run.ts`, and `cost-calibration.ts` are not edited. In each verb, hoist the inline
`await createCalibratedCliModelRouter(stateRoot)` (pause.ts:140, inject.ts:261) into a `let
router; try { … }` at the same position — after the run lookup, after every argv guard, before
the plane call — wrapped in one narrow catch: `error instanceof DomainValidationError &&
errorCodeOf(error) === undefined`, everything else rethrown (`pause.ts` adds the
`DomainValidationError` import and both files add `errorCodeOf` to their existing `./errors.js`
import). The converted envelope, per verb:

- `command: "pause"` / `"inject"`, `stage: "validation"` (a stored-config fault, the
  D36/D39/D40 class), `message: 'could not build the model catalog at ${stateRoot}:
  ${error.message}'` — validate's exact message shape, so the same fault has one spelling
  across the three verbs that build this catalog (a message may name the resolved root; the
  D38 rule), `runId`,
- `next` (path-free, the D34/D40 rule — validate's landed next predates it and interpolates
  `providersConfigPath`; these do not): `'disable an unknown enabled model with pi-sparkle
  models disable <provider/model> using the same --state-root, or repair providers.json under
  that root; pi-sparkle models list names enabled ids that are not in the catalog'` — every
  claim in it probed above.

**Catch scope, stated precisely.** The uncoded-`DomainValidationError` family reachable through
this build is exactly two faults, and the batch deliberately covers both with the dual remedy —
the same decision D36 landed and GPT recheck kept for `validate`, whose catch comment says so in
place ("the two ways to get here are an enabled model no provider exposes and a malformed
providers.json"): the unknown enabled model (from `buildLiveCatalogConfig`) and a malformed
`providers.json` (from `loadProvidersConfig` inside it). The corrupt-`providers.json` instance
through `pause` today gets main's generic envelope whose doctor remedy genuinely answers
(probed: `pause` on `not json{` → `message: "invalid providers.json at
/tmp/r12probe/state/runtime/providers.json"` with the doctor next, and `doctor` FAILs
`providers` naming that file) — after this batch it gets the D36 envelope instead, whose message
carries the store's own file-naming bytes and whose next names the repair directly; that
held-family instance moves *with* the catch, mirroring validate's kept precedent, and is pinned
as such rather than left ambiguous. Coded faults — EACCES/EISDIR on `providers.json` or
`invocations.jsonl`, the lock family — rethrow untouched to main's routing.

**Tests** (extend `pause-inject.test.ts`; harness has `parseCliErrorJson`, real seeded runs, and
byte-compares logs): whole-field pins for the `pause` and `inject` stale-enabled-model
envelopes (hand-written providers.json fixture, `mkdtemp` root); a whole-field pin for the
corrupt-providers.json instance (message `could not build the model catalog at <root>: invalid
providers.json at <path>`); an order pin that a missing run plus the broken catalog still
reports the `lookup` envelope (the build stays after the lookup); a passthrough pin that
`pause --clear` on the broken catalog keeps today's stdout bytes and exit 0; no-write pins
(events.jsonl byte-identical after each refusal; no pause token created; no injection appended);
and a coded passthrough pin that a directory at `runtime/providers.json` (readFile → EISDIR,
portable) still reaches main's envelope byte-identically. Existing pins hold: grep confirms no
test drives pause/inject with a non-empty `enabled` list, and every D30/D31/D37/D41 pin triggers
on argv these edits never reach — all 40 baseline tests pass unchanged.

**Freeze/PR#12 check:** no JSON surface on either verb; `PAUSE_USAGE`/`INJECT_USAGE` untouched;
no Event, no `main.ts`, no plane or shared-module edit; no new stage value. `pause.ts` reopened
outside D31's closed scope (argv values) and D37's (blank root); `inject.ts` outside
D30/D31/D37/D41's (type/confidence, blank values, blank root, value domain/flag relevance) —
none classified the router-build fault; stated reopening. No ranked file is in PR #12. Disjoint
from Ranks 1 and 3.

---

## Rank 3 (D45) — `auth login`'s interactive prompt flow refuses in its own dialect instead of losing it through main

**Why third.** Lower frequency than Ranks 1–2, but it is the last `auth login` refusal that
still crosses into main's catch — D28/D35 gave every other one `command: "auth login"` and an
honest stage — and the operator it hits is exactly the one who cannot use the remedy offered:
someone scripting a login without a terminal. Reproduced live at HEAD:

- **closed stdin on the interactive path:** `printf '' | pi-sparkle auth login openai
  --state-root /tmp/r12probe/authroot` prints the prompt (`Enter OpenAI API key: `) and then →
  `{"ok":false,"command":"auth","stage":"validation","message":"stdin closed before the prompt
  was answered","next":"fix the reported error, then retry; use pi-sparkle doctor for
  preflight"}`, exit 1 — the subcommand dialect lost (`auth`, not `auth login`), a
  terminal-channel fault classed as `validation`, and a doctor remedy that cannot conjure a
  TTY, while the two modes that actually work without one (`--key`, `--from-env`) are never
  named. Nothing was written (`/tmp/r12probe/authroot` gained no `runtime/` at all — probed);
- **the same class, second instance (recorded, held — see HOLD):** `printf '' | … auth login
  openai --oauth` → `{"ok":false,"command":"auth","stage":"execute","message":"OpenAI does not
  support oauth login","next":"fix the reported error, then retry; use pi-sparkle doctor for
  preflight"}` — a plain (non-`DomainValidationError`) throw from the Pi runtime, so an honest
  in-verb classification needs either message matching (forbidden — `errors.ts`: discriminate
  on `code`, never on the message) or a typed error at the pi-adapter boundary, which is a
  plane-contract change to design in its own slot, not this batch.

**Exact files and edits:** `src/cli/auth.ts` + `test/unit/cli/auth.test.ts` only.
`auth-session.ts` is not edited — the refusal messages are its own bytes, kept. In
`loginCommand`, wrap the one interactive call (`await loginProviderInteractive(stateRoot,
providerId, type, io, config.customProviders)`, auth.ts:452) in a narrow try catching **only**
`error instanceof DomainValidationError && errorCodeOf(error) === undefined` (auth.ts adds the
`DomainValidationError` import and `errorCodeOf` to its `./errors.js` import): `cliFail`
`command: "auth login"`, `stage: "preflight"` (the login flow's interaction channel failed
before any credential existed — the same stage the module's `--from-env` environment faults
already use), message bytes kept, `next: 'nothing was stored; answer the prompt as asked, or
use a non-interactive mode: pi-sparkle auth login <provider> --key <key> or --from-env'`. The
uncoded family reachable through this call is exactly the interaction's own refusals —
`stdin closed before the prompt was answered` (both reader sites) and `invalid selection` (an
out-of-range answer to a select prompt) — and the next is written to be true for both. Everything
else keeps its owner: `AuthStoreUnreadableError` extends `DomainValidationError` **with a
code**, so the uncoded-only discrimination rethrows it to the existing outer `load-credentials`
catch byte-identically; plain Pi errors (oauth-unsupported, network) rethrow to main as today;
the `--key` path (`storeApiKeyCredential`) stays outside the catch.

**Tests** (extend `auth.test.ts`; the injected-`question` reader is the established
`auth-session.test.ts` pattern and `SparkleAuthIo.question` is the documented seam): a
whole-field envelope pin driving `main(["auth","login","openai"])` with an io whose `question`
rejects with an uncoded `DomainValidationError("stdin closed before the prompt was answered")`;
a no-write pin (no `auth.json` and no `runtime/` created by the refusal); a dialect pin
(`command` is exactly `"auth login"`, and the message bytes are the store's); a passthrough pin
that a `question` rejecting with a **plain** `Error` still surfaces through `main` as today's
`stage: "execute"` envelope byte-identically (the catch stays narrow); a passthrough pin that a
corrupt `auth.json` during an interactive login that reached the store still reports today's
`load-credentials` envelope (the coded rethrow); and a success-path pin that an injected
`question` resolving a key still prints `Stored api_key credential for openai in …` unchanged.
Existing pins hold: `stdin closed` is pinned nowhere in `test/` (grep), and every
D12/D16/D21/D24/D28/D35 pin triggers on paths these edits never reach — all 37 baseline tests
pass unchanged.

**Freeze/PR#12 check:** `AUTH_STATUS` byte-identical (status path unedited); `AUTH_USAGE`
untouched (it already documents the three modes the new next names); no Event, no `main.ts`, no
`auth-session.ts` edit; no new stage value (`preflight` exists in `auth.ts` today). `auth.ts`
reopened outside D12's closed scope (`--from-env`), D16's (secret echo), D21/D24's
(keyless-custom, source column), D28's (parse dialect, `AUTH_STATUS`), D35's (login refusal
envelopes — its six conversions were all pre-prompt), and D37's (blank root) — none classified
the prompt-flow throw; stated reopening. Neither file is in PR #12. Disjoint from Ranks 1 and 2.

---

## HOLD / NO_HIGH_VALUE — everything else examined, one line each

- **`pause`/`inject` on non-flowchart or terminal runs; unknown `inject --node`; the BLOCKED-run
  fact-inject vs `INJECT_USAGE` fail-closed claim**: messages in `flowchart-run.ts`,
  classification in `main.ts`, both in PR #12's live diff — HOLD, re-examine after #12 lands
  (unchanged from r11; D44 deliberately leaves `pauseFlowchartRun`/`injectFlowchartRun` throws
  alone).
- **`auth login --oauth` on a provider without oauth support**: reproduced this round (quoted at
  Rank 3) — a plain Pi error through main with the dead doctor next and the lost dialect; an
  honest conversion needs a typed error at the pi-adapter boundary (message matching is
  forbidden by the `errors.ts` doctrine), which is a plane-contract design for its own slot.
  HOLD with the probe recorded.
- **`doctor --agents-dir <nonexistent dir>`**: observed while probing Rank 1 — an explicitly
  named directory that does not exist earns `ok pi-dispatch: skipped (no agents dir)`, a pass
  where the dir the operator meant might FAIL; flipping a check verdict is a doctor-contract
  design question under the frozen-additive `--json` pin, not a blank-instance rule — recorded
  for a design slot, not ranked.
- **`unblock` / G5 / G7 / E4 `[--outcome]` / cost verb / completions / `pref`**: `main.ts`
  remainder — HOLD behind PR #12 (unchanged from r6–r11). Likewise blank `--state-root` on
  `run`/`resume`/`inspect`/`answer`/`delete`/`unblock`/`adapt` (parsed in `main.ts`/`adapt.ts`);
  doctor was the one *free* verb still missing the guard, ranked as D43.
- **Corrupt `providers.json` reaching `models`/`auth`/`episode`/…**: doctor's `providers` check
  names the file (re-probed this round: `providers FAIL — invalid providers.json at …`) — held
  as before. The one instance that moves is the pause/inject router-build site, where it rides
  the D44 catch under validate's kept dual-remedy precedent, stated and pinned at Rank 2.
- **Corrupt run event logs through `commits`/`pause`/`inject`**: doctor's `run-state-inventory`
  names the exact file; D40's catch keeps `EventStore.readAll` outside — unchanged.
  NO_HIGH_VALUE.
- **File-as-root (`--state-root` a regular file)**: held under the r11 examination — `doctor
  --state-root <that file>` answers (ENOTDIR on `state-root` and `providers`); D40/D41/D44/D45's
  catches all rethrow coded errors to keep it that way. NO_HIGH_VALUE.
- **Windows cli-smoke / status-matrix / README / data-dictionary riders**: HOLD behind PR #12;
  every batch above defers its docs rider.
- **`models list --available --provider <unknown>` `(no models)`**: pinned choice. NO.
- **F7 oauth discoverability / F15 perms window**: no new evidence. NO_HIGH_VALUE.
- **D7 Variant B**: frozen by decision — not ranked.
- **`episode close --outcome` any-string value domain**: design HOLD stands (D42 closed the
  blank instance only).
- **`adapt dataset` / `adapt.ts`**: merge-ready per D10/D18/D19/D23 and in PR #12 — not ranked.
- **`init` success `next:` interpolates the resolved children path** into an executable-looking
  line (`next: pi-sparkle validate --children <dir>/sparkle-children.example.json` splits on a
  `--dir` holding a space) — the D9 facts-over-command-lines class on a success surface;
  rider-scale, not a slot; recorded for the next `init-examples.ts` touch. NO_HIGH_VALUE this
  round.
- **`episode` / `commits` / `models` / `validate` / `list` / `migrate-legacy` / `init`**:
  re-read in full at HEAD — the D25/D32/D33/D34/D36/D37/D38/D39/D40/D41/D42 landings hold;
  no new operator-visible defect found in any of them this round. NO_HIGH_VALUE.
- **`pi-compat`**: unchanged from the r9–r11 examinations — argv complete, exit 1 reserved for
  the broken-adapter contract. NO.
- **`errors.ts` `doctorJsonCommand`**: only caller is `main.ts`'s failure path — HOLD behind
  PR #12 (unchanged).
- **`doctor-overlay.ts` / `model-catalog.ts` / `children-spec.ts` / `flowchart-io.ts`**: support
  modules with no verb of their own; `model-catalog.ts`'s throw is classified by the verbs that
  call it (D36 landed, D44 ranked) rather than by editing the shared module. NO.

## Final ranking

1. **D43 — `doctor` blank-flag preflight** — `src/cli/doctor.ts` +
   `test/unit/cli/doctor.test.ts`. The remedy target of every generic `next` stops answering
   authoritatively about a tree the operator never named (probe: `--state-root ""` from a cwd
   trap reports the trap's run as a PLANNING crash candidate at a cwd-relative path with a
   remediation aimed at a third tree, totals the trap's storage, and reads the trap's
   providers.json; `--state-root " "` **creates a directory named `" "` in the cwd** and exits
   0 with `ok state-root:   writable`; `--project ""` answers ` has package.json` about the cwd
   and invents learned-state project key `p0`; `--agents-dir ""` is silently read as absent).
   Three copied parse-args guards (D37 bytes for the root; D38-style blank-vs-omitted wording
   for the other two) before any filesystem read or write; the frozen `--json` report is
   byte-identical for every argv doctor accepts.
2. **D44 — `pause`/`inject` router-build fault envelopes** — `src/cli/pause.ts` +
   `src/cli/inject.ts` + `test/integration/cli/pause-inject.test.ts`. The one config-plane
   fault these verbs' own build can hit stops crossing into main's catch (probe: a stale
   enabled model turns `pause`/`inject` on a real run into `unknown model …` with the doctor
   next and no `runId`, while `doctor --json` on that root passes `providers` and `auth` and
   never names a model fault, `models list` prints the honest `(not in catalog)`, and
   `validate` has owned the honest envelope since D36). One narrow uncoded-
   `DomainValidationError` catch per verb around the hoisted
   `createCalibratedCliModelRouter` call, at its current position after the run lookup;
   validate's message shape, a path-free dual-remedy next naming `models disable` and the
   providers.json repair; `--clear`, missing-run order, and every coded fault keep today's
   bytes.
3. **D45 — `auth login` interactive prompt-flow envelope** — `src/cli/auth.ts` +
   `test/unit/cli/auth.test.ts`. The last auth-login refusal still leaking through main gets
   the D28/D35 dialect (probe: a piped-empty stdin turns interactive login into
   `command: "auth"`, `stage: "validation"`, `stdin closed before the prompt was answered`,
   doctor next — a remedy that cannot conjure a terminal, with `--key`/`--from-env` never
   named and nothing written). One narrow uncoded-`DomainValidationError` catch around
   `loginProviderInteractive`: `command: "auth login"`, `stage: "preflight"`, message bytes
   kept, next naming the two non-interactive modes; the coded damaged-store rethrow and every
   plain Pi error (the reproduced oauth-unsupported instance is recorded under HOLD) keep
   today's routing.

The three batches are mutually file-disjoint, disjoint from PR #12's live file list (re-pulled
after probing: OPEN, same eight src files), reopen closed-decision files (D29/D22 in Rank 1,
D30/D31/D37/D41 in Rank 2, D12–D37 in Rank 3) only for defects outside those closed scopes with
the reopen stated at each batch, and can be dispatched concurrently. Through-line: Round 8 made
the free verbs honest about their flag values, Round 9 about their config plane, Round 10 about
which tree they act on, Round 11 about the stored state they read; Round 12 makes the **remedy
chain itself** honest — the doctor every generic `next` points at now answers about the tree
the operator named and never writes one they didn't, and the two verb-owned faults still
funneling into that generic advice, probed against the reports it points to, get the envelope
of the surface that actually answers: the routing config a `pause`/`inject` needs before it can
act, and the terminal a login prompt needs before it can be answered.
