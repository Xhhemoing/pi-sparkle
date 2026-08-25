# Loop 5 · Round 9 — Fable-next: the three implementable operator batches after Round 8

Slot: Fable-r9-next (claude-fable-5). Analysis/spec only; no `src/` edits by this agent; not merged
to the parent integration branch.

Ranked at HEAD **`6bdeb4e943f7674615cb5668146b78905455dc6c`**
(`docs(agent): record Round 9 Fable ranking dispatch id`) on `origin/cursor/pi-sparkle-sota-opt-0da8`,
fetched fresh and re-fetched after probing — origin moved once mid-round, from the Round 8 closeout
`ff13281` to `6bdeb4e`, and the whole delta is one line of `docs/agent-progress.md`; **every `src/`
and `test/` byte ranked here is identical at `ff13281` and `6bdeb4e`** (verified by `git diff
--stat`). Method: direct reads at HEAD of `src/cli/{pause,inject,commits,episode,list,validate,
auth,models,doctor,doctor-overlay,migrate-legacy,pi-compat,init-examples,errors,model-catalog,
children-spec,flowchart-io,main}.ts` (main read-only), `src/config/{model-ref,providers-config}.ts`,
`src/run/inventory.ts`, `src/domain/ids.ts`; pin greps across `test/` for every string a batch
below would change; PR #12 file list re-pulled live via `gh pr view 12 --json files,state,headRefName`
(OPEN, head `cursor/merge-preview-release-8011` — src set unchanged from the Round 8 read).
**Every defect claimed below was reproduced live on this VM** (`pnpm install --frozen-lockfile`
clean, Node v22.14.0) via `pnpm cli` against a seeded state root at `/tmp/r9probe/state` holding
one plain fake-executor COMPLETED run, one flowchart run WAITING_FOR_USER at its gate, one BLOCKED
flowchart run, and one COMPLETED single-node flowchart run, plus a custom-provider `providers.json`
under `/tmp/r9probe/custom` and a corrupt one under `/tmp/r9probe/corrupt`. Probe outputs are
quoted in place; every refusal quoted below exited 1 unless stated otherwise. Baseline: the four
test files the batches extend pass 65/65 at HEAD (`npx tsx --test` — `models.test.ts` +
`auth.test.ts` + `validate.test.ts` 59, `commands.test.ts` 6).

## 0. Round 8 closeout honored; constraints every batch satisfies

- **Not re-ranked.** D31 KEEP (verified live: `pause --run banana` refuses
  `stage: "parse-args"` with `invalid --run "banana"` and the list retarget; blank
  `--reason`/`--key`/`--node`/`--actor` all refuse before state), D32 KEEP (verified:
  `commits preview --run <cr> --nodes ","` → `invalid --nodes ",": selects no node ids` as
  parse-args; blank `--repo` rider in place), D33 KEEP (verified: `episode nonsense --episode
  banana` reports `Unknown episode command: nonsense` first — the dispatch-order rider holds;
  `isEpisodeId` guard and escaped events lines in source at HEAD). Per the round brief their files
  are free only for **NEW** defects — no batch below touches `pause.ts`, `inject.ts`,
  `commits.ts`, `episode.ts`, or their test files at all, so the question does not arise.
- **PR #12 disjointness, re-read live.** #12's current src files: `adaptation/eval-routing.ts`,
  `cli/adapt.ts`, `cli/inspect-format.ts`, `cli/main.ts`, `feedback/redaction.ts`,
  `pi-adapter/runtime.ts`, `run/flowchart-run.ts`, `run/inspection.ts` — unchanged from the Round
  8 read; plus `ci.yml`, README/CHANGELOG/SECURITY/`.env.example`/`package.json`,
  `docs/status-matrix.md`, docs/specs/reports, `scripts/*`, and its test files
  (`test/integration/cli/{cli,inspect-follow,run-cost-cap}.test.ts`,
  `test/integration/m1/cli-children.test.ts`, `test/integration/m2.5/…`, unit files
  `adapt/cost-flag/inspect-format/readme-command-parity` and the redaction/inspection/package
  sets). **No ranked file is in that set** (checked name-by-name: `models.ts`, `auth.ts`,
  `validate.ts`, `test/unit/cli/{models,auth,validate}.test.ts`, and
  `test/integration/cli/commands.test.ts` are not #12 files). No batch edits `main.ts` — every
  refusal converts inside the verb module that owns it, so the blocked-next four-line prefix and
  the eleven-case crash probe are untouched trivially.
- **Freeze gate.** No live R1/`selectArm`/`planTaskTopology`; ADR-006 stays Proposed;
  `INSPECT_SUMMARY` four keys untouched; doctor `--json` byte-untouched (no batch opens
  `doctor.ts`); doctor runStates stays PLANNING/RUNNING; eight-member `RunStatus` untouched; **no
  new Event types and no new JSON key anywhere** — `MODELS_LIST`, `AUTH_STATUS`, `VALIDATE_OK`,
  `RUN_LIST`, `COMMITS_PREVIEW`, and `episode events --json` are byte-identical (every converted
  refusal fires before its verb's JSON assembly); `package.json` untouched (`private: true`
  stays); no Outcome-supported claims; D7 Variant B untouched. Windows CI: the cli-smoke Windows
  leg runs `test/integration/m1/cli-children.test.ts` and `test/unit/cli/doctor.test.ts`; no
  batch touches either, and every new test is argv + capture-io + `mkdtemp` construction.

**The round's through-line, found by probing every free verb:** D31–D33 taught the *run-state*
verbs to refuse bad flag values before the plane. The same wrong-remedy class survives intact on
the **config-plane verbs and the spec checker** — `models`, `auth login`, and `validate` still
throw value and environment faults into generic catches. The symptom set is uniform: `command`
names the top-level verb only (`"models"`, `"auth"` — where D28 pinned the house style as
`"auth login"`), `stage` claims `"validation"` or `"execute"` for what is argv or an unreadable
path, `next` is "use pi-sparkle doctor for preflight" or "fix the spec" — remedies that cannot fix
a typo'd positional or a wrong path — and the flag or positional is never named. One surface goes
further and **claims work that did not happen** (`models disable` prints `Disabled <id>` for an id
that was never enabled — the exact class D20 closed for `pause --clear` and D21 F9 closed for
`auth logout`). Grep confirms the only behavior pins on these paths are message regexes and two
`assert.rejects` in `commands.test.ts` (converted in-batch below); no closed decision pinned any
of these classifications deliberately.

---

## Rank 1 (D34) — `models` refuses malformed and unknown ids as its own, and stops claiming disables it never did

**Why first.** `models` writes the routing configuration every run reads; its false "Disabled"
claim leaves an operator believing an expensive model is off while routing still resolves it —
the costliest wrong report of the three batches, on top of five wrong-remedy surfaces. All
reproduced live at HEAD:

- `models enable banana` → `{"ok":false,"command":"models","stage":"validation","message":"model
  id must be provider/model (got \"banana\")","next":"fix the reported error, then retry; use
  pi-sparkle doctor for preflight"}` — `parseModelRef` throws out of `enableCommand` into
  `main.ts`'s catch; the positional is never named as the mistake and the subcommand is lost
  (`models.ts:262` via `assertKnownCatalogId:341-348`); identical for `models disable banana`
  (`:292`), `models set-default --primary banana`, `--fast banana` (`:327-329`), and the blank
  positional `models enable ""` (passes the `startsWith("-")` guard at `:253`);
- `models enable bogus/model` → `"unknown model \"bogus/model\""`, `stage: "validation"`, doctor
  next — the remedy that lists valid ids exists (`models list --available`) and the report does
  not name it; identical on `set-default --primary bogus/model`;
- `models disable anthropic/claude-fable-5` (never enabled; verified `models list` before and
  after prints only `openai/gpt-5.2`) → stdout `Disabled anthropic/claude-fable-5`, **exit 0** —
  a claim about work that did not happen;
- `models list --provider anthropic` (without `--available`) → prints the enabled `openai/gpt-5.2`
  and exits 0 — the flag is parsed and **silently ignored** in enabled mode (`listCommand` only
  reads `values.provider` inside the `--available` branch), so the answer to "which anthropic
  models are enabled" is wrong; compare `list --status` with `--episodes`, which D25 made refuse.

**Exact files and edits:** `src/cli/models.ts` + `test/unit/cli/models.test.ts` only.
`src/config/{model-ref,providers-config}.ts` and `pi-adapter/listed-model.js` are not edited.

1. **Malformed `<provider/model>` / `--primary` / `--fast`, four sites.** Guard with the
   already-exported `tryParseModelRef` from `../config/model-ref.js` (the domain's own predicate
   — D30/D31 principle, never restate the shape): when `undefined`, `cliFail` before any config
   read with, for the positionals, `command: "models enable"` (resp. `"models disable"`),
   `stage: "parse-args"`, `message: 'invalid <provider/model> "${catalogId}": expected a model id
   of the form provider/model'`, `next: 'pass <provider/model> as printed by pnpm cli models list
   --available --state-root ${stateRoot}'`; for set-default, `command: "models set-default"`,
   `message: 'invalid --primary "${values.primary}": expected a model id of the form
   provider/model'` (resp. `--fast`), `next: 'pass --primary <provider/model> as printed by pnpm
   cli models list --available --state-root ${stateRoot}'` (resp. `--fast`), `--primary` checked
   before `--fast`. No `runId` key on any report in this round — none of these verbs has a run in
   play. Placed after the existing (D21-pinned) missing-argument refusals, whose bytes do not
   change; the blank positional `""` folds into this guard. The plane's own `parseModelRef` calls
   downstream become unreachable-throw, not removed.
2. **Unknown model names its inventory.** Change module-local `assertKnownCatalogId` to return
   the resolution instead of throwing (it is private to `models.ts`; no plane file changes): at
   its three call sites (enable; set-default `--primary`; set-default `--fast`), on `undefined`
   `cliFail` with `command: "models enable"` / `"models set-default"`, **`stage: "validation"`**
   (catalog membership is stored config + catalog state, not CLI knowledge — the honest
   classification, D32's unknown-`--nodes` precedent), message bytes kept exactly
   `unknown model "${catalogId}"` (the `/unknown model/i` pin at
   `test/unit/cli/api-config.test.ts:128` holds without edits), `next: 'pass an id printed by
   pnpm cli models list --available --state-root ${stateRoot}; providers.json customProviders
   adds ids the builtin catalog does not have'`. Both set-default assertions stay **before**
   `setDefaultModels` — a refused `--fast` must keep writing nothing (pinned).
3. **`disable` claims only what it did.** `disableCommand` already loads `before`; when
   `before.enabled` does not include `formatted`, print
   `${formatted} was not enabled; nothing to disable (pnpm cli models list --state-root
   ${stateRoot} shows the enabled models)\n` and exit 0 (idempotent re-run stays safe — the
   `auth logout` D21 F9 and `pause --clear` D20 precedent); when it does, keep `Disabled
   ${catalogId}` byte-identical (pins `models.test.ts:161/:177` hold). **Still call
   `disableModel` in both cases**: a hand-edited config can hold a dangling `primary`/`fast`
   equal to an id not in `enabled`, and the existing dropped-default note (D21 F9) must keep
   firing for it — the message is keyed on `before`, the mutation is not.
4. **`--provider` stops being ignored.** In `listCommand`, when `values.provider !== undefined`
   and `values.available !== true`: `cliFail` `command: "models list"`, `stage: "parse-args"`,
   `message: "models list --provider filters the --available catalog and does not apply to
   enabled models"`, `next: "add --available, or drop --provider"` — the D25 refuse-don't-ignore
   precedent (`list --status` with `--episodes`), refused rather than silently filtering because
   filtering the enabled view would be a new feature on a frozen-additive contract, not a defect
   fix. Fires before any config read and before any JSON assembly, so `MODELS_LIST` is
   byte-identical on every path that prints it.

**Tests** (extend `models.test.ts`; `withStateRoot`/`writeCustomProviders` are already in the
harness): `parseCliErrorJson` whole-field pins (command/stage/message/next) for malformed on all
four sites (including `""`), unknown on all three, and the `--provider` refusal (with and without
`--json`); argv-before-state order pin (`models enable banana --state-root <nonexistent dir>`
refuses parse-args); not-enabled disable pins exit 0, the honest message, and `providers.json`
bytes unchanged on a seeded config; dangling-default fixture (hand-written config with `primary`
not in `enabled`) pins no `Disabled` claim plus the existing dropped-default note; refused
`set-default --fast` pins `providers.json` unchanged. Existing pins hold — the D21 five
missing-arg reports (`:388-399`), the D27 `MODELS_LIST` deepEquals, `--available --provider`
filter pins (`:104-115`), the deliberately-pinned `(no models)` for an unknown `--available`
provider (`:118-125`, untouched — see HOLD), and both `Disabled` bytes (`:161/:177`).

**Freeze/PR#12 check:** `MODELS_LIST` byte-identical; no Event, no `main.ts`, no plane file edit
(`providers-config.test.ts` and `listed-model` pins untouched); D21/D27 closed scopes reopened
for value-domain defects they never covered (D21 = missing arguments, D27 = JSON contract +
`parseArgs` dialect). Neither file is in PR #12. Disjoint from Ranks 2 and 3.

---

## Rank 2 (D35) — `auth login` refusals speak the house dialect instead of throwing to main

**Why second.** The credential verb's refusals all carry correct *messages* (D12/D21 landed
wording) and all arrive mis-shaped: thrown `DomainValidationError`s cross into `main.ts`'s catch,
so `command` is `"auth"` where D28 pinned the subcommand style (`"auth status"`/`"auth login"`),
`stage` is `"validation"` for pure argv, and `next` is doctor preflight while the real remedy sits
in the message the operator has to re-read. Six surfaces, all reproduced live at HEAD:

- `auth login banana --key sk-test` → `{"ok":false,"command":"auth","stage":"validation",
  "message":"unknown provider \"banana\"","next":"…doctor…"}` (`auth.ts:368`);
- `auth login openai --key sk-x --oauth` → the D21 multi-mode message (`… — nothing was stored`)
  as validation + doctor (`:362`) — mutually exclusive flags are the same argv class
  `pi-compat --offline --online` and `list --runs --episodes` already refuse as parse-args;
- `auth login openai --key "  "` → `"auth login --key must be non-empty"`, validation + doctor
  (`:371`), checked only **after** the provider lookup and the config read;
- `auth login local --key sk-x` (keyless custom, seeded `providers.json`) → the whole D21
  keyless paragraph as validation + doctor (`:387`);
- `auth login openai --from-env` (env unset) → the D12 ambient-auth paragraph as validation +
  doctor (`:455`) — an environment fault reported as a validation failure;
- `auth login ""` / `auth logout ""` → `unknown provider ""` resp. the plane's
  `"provider id must be non-empty"` (thrown out of `deleteStoredCredential`), both validation +
  doctor — a blank positional slips past the `startsWith("-")` missing-argument guards.

**Exact files and edits:** `src/cli/auth.ts` + `test/unit/cli/auth.test.ts` +
`test/integration/cli/commands.test.ts` (its two `assert.rejects` pin the throwing behavior
itself and must convert with it; the file is free — not in PR #12, not owned by any other batch).
`pi-adapter/auth-session.ts` is not edited; its own unit pins are untouched. **Every message
below keeps its exact current bytes** — the D12/D21 regex pins (`/takes one of --key, --from-env,
--oauth/`, `/nothing was stored/`, `/not configured in the environment/`, `/ADC files or AWS
profiles/`, `/ignores auth\.json/`, `/no envVar in providers\.json/`, `/unknown provider/`,
`/non-empty/`) all hold byte-for-byte; only the report envelope changes.

1. **Blank positional folds into the missing-argument refusal.** In `loginCommand` and
   `logoutCommand`, extend the existing guard to
   `providerId === undefined || providerId.startsWith("-") || providerId.trim() === ""` — the
   pinned `auth login requires <provider>` / `auth logout requires <provider>` reports (bytes
   unchanged) now also cover `""`, and the plane's `deleteStoredCredential("")` throw becomes
   unreachable from argv.
2. **Multi-mode → parse-args.** Replace the throw at `:361-365` with `cliFail`
   `command: "auth login"`, `stage: "parse-args"`, message bytes kept, `next: "pass exactly one
   of --key, --from-env, --oauth"`. Already positioned before any config or store read; no flag
   value is echoed (the existing no-secret pin at `auth.test.ts:210` holds).
3. **Blank `--key` → parse-args, before config.** Move the check from `:370` to beside the
   multi-mode guard, ahead of `loadProvidersConfig`: `cliFail` `command: "auth login"`,
   `stage: "parse-args"`, message bytes kept (`auth login --key must be non-empty` — the key
   value is never echoed, blank or not), `next: "pass --key <key> with a non-empty value"`.
   Precedence change to pin deliberately: `auth login banana --key "  "` now reports the blank
   key first (argv refuses before config-dependent checks — D30/D31's pinned precedence
   principle); no existing test binds the old order.
4. **Unknown provider → validation with a real inventory.** Replace the throw at `:367-369`:
   `cliFail` `command: "auth login"`, `stage: "validation"` (provider membership is the builtin
   catalog plus `providers.json` state, not CLI knowledge), message bytes kept, `next: 'pass a
   provider this install resolves: pnpm cli models list --available prints ids as
   <provider>/<model>, and providers.json customProviders adds more'`.
5. **Keyless-custom store modes → validation naming its two remedies.** Replace the throw at
   `:386-393`: `cliFail` `command: "auth login"`, `stage: "validation"`, the D21 paragraph
   byte-identical, `next: 'add envVar for ${providerId} to providers.json, or use the per-run
   PI_API_KEY override for the selected default provider'`. One site covers `--key`, `--oauth`,
   and the interactive mode (all three pinned at `auth.test.ts:425-427`).
6. **`--from-env` refusals → preflight.** In `loginFromEnvCommand`, replace the two throws
   (`:448`, `:455`): `cliFail` `command: "auth login"`, **`stage: "preflight"`** (an unconfigured
   environment is an environment fault — D32's repo-preflight precedent; doctor's `auth` check is
   its matching inventory), messages byte-identical in all three variants (keyless
   nothing-to-check; named custom `envVar` unset; builtin ambient paragraph), `next:` keyless →
   `'add envVar for ${providerId} to providers.json'`, not-configured →
   `'set the environment the message names, or store a credential with pnpm cli auth login
   ${providerId} --key <key>'`. D12's semantics are untouched: success off the environment, the
   stored-credential fail-closed refusal, the outranking-credential note, and the
   corrupt-auth.json warning path keep their code and their pins; only the refusal envelope
   changes. **No catch is added or widened anywhere** — six throws become returns, and the outer
   `asAuthStoreUnreadable` catch at `:69-81` keeps exactly the errors it has today.

**Tests**: in `auth.test.ts`, extend the existing cases with `parseCliErrorJson` whole-field pins
(command/stage/message/next) for all six surfaces, a no-store-write re-assertion on each (the
harness already checks `auth.json` bytes), and the new blank-key-before-unknown-provider order
pin; in `commands.test.ts`, convert the two `assert.rejects` (`:65-73`) to exit-1 +
`parseCliErrorJson` pins on the same messages. Existing pins hold — D28's parser-error `command`
pins, `AUTH_STATUS` deepEquals, D16 mute/EOF pins, D24 source-column pins, and every D12/D21
message regex.

**Freeze/PR#12 check:** `AUTH_STATUS` byte-identical (no refusal here reaches JSON assembly); no
Event, no `main.ts`, no `pi-adapter` edit; `auth.ts` reopened for **new** defects only — D28
closed the dialect of unknown-subcommand and `parseArgs` errors, D21 closed message wording, D12
closed `--from-env` semantics; none of the three classified these six refusal envelopes. None of
the three files is in PR #12. Disjoint from Ranks 1 and 3.

---

## Rank 3 (D36) — `validate` stops telling the operator to fix a spec that does not exist

**Why third.** The no-write preflight verb: wrong remedies here cost confusion rather than money
or history, but this is the verb `init` explicitly hands new operators
(`next: pi-sparkle validate --children …`), so its first refusal is often the product's first
impression. Reproduced live at HEAD:

- `validate --children /tmp/r9probe/nope.json` → `{"ok":false,"command":"validate",
  "stage":"execute","message":"ENOENT: no such file or directory, open
  '/tmp/r9probe/nope.json'","next":"fix the spec and re-run pi-sparkle validate"}` — a raw
  errno for an unreadable operator-supplied path, the flag never named, and a remedy that asks
  them to fix a spec that was never read (`children-spec.ts:29` bare `readFile`, caught by
  `validate.ts`'s own catch at `:187-197`);
- `validate --flowchart /tmp/r9probe/nope.json --state-root <sr>` → identical class
  (`flowchart-io.ts:13`);
- `validate --children ""` → `ENOENT … open ''` with the same fix-the-spec remedy — a blank flag
  value survives the exactly-one check (`"" !== undefined`) and crashes into the same wrong
  report.

This is exactly the class D32 closed for `commits apply --file` (raw ENOENT at the wrong stage,
flag unnamed), on the two path flags `validate` owns.

**Exact files and edits:** `src/cli/validate.ts` + `test/unit/cli/validate.test.ts` only.
`children-spec.ts` and `flowchart-io.ts` are **not** edited — `run --children`/`--flowchart`
reach the same parsers through `main.ts` (#12-held), so the conversion lives entirely in
`validate.ts`'s already-existing catch and touches no shared seam.

1. **Blank path → parse-args.** After the exactly-one refusal (bytes unchanged), when the
   supplied path is defined and `trim() === ""`: `cliFail` `command: "validate"`,
   `stage: "parse-args"`, `message: 'invalid --children "${childrenPath}": spec path must be a
   non-empty string'` (resp. `--flowchart`), `next: "pass --children <spec.json>"` (resp.
   `"pass --flowchart <flowchart.json>"`). Before any read.
2. **Unreadable path → lookup naming the flag.** In the existing shared catch (`:187-197`),
   classify in order: `error instanceof DomainValidationError` → today's report byte-identical
   (`stage: "validation"`, `next: "fix the spec and re-run pi-sparkle validate"` — the bad-JSON
   and schema pins at `validate.test.ts:293-294` and `:118-120` hold); else when
   `errorCodeOf(error) !== undefined` (already exported by `./errors.js` — fs faults carry the
   code, and both parsers wrap every JSON/schema fault as `DomainValidationError`, so an fs read
   is the only coded throw on these paths) → `cliFail` `command: "validate"`,
   **`stage: "lookup"`** (the D32 `--file` precedent: an unreadable operator path is a lookup
   fault, not an execution failure), `message: 'cannot read ${flag} ${path}:
   ${error.message}'` where `flag` is `--children` or `--flowchart` by which branch ran,
   `next: 'check the ${flag} path; pi-sparkle init writes example specs this command accepts'`;
   else → today's `stage: "execute"` + generic bytes, unchanged. The flowchart branch's
   catalog-build catch (`:159-171`) already names its own remedies and is untouched.
3. **Pin update, in-batch.** The one existing pin on the converted behavior is
   `validate.test.ts:296-302` (missing file asserted as `stage: "execute"` + message includes the
   path — a generic-classification pin, not a decision): update it to `stage: "lookup"` and
   `message` matching `/^cannot read --flowchart /` + the path.

**Tests** (extend `validate.test.ts`): `parseCliErrorJson` whole-field pins for missing
`--children` and `--flowchart` files and for both blank-path refusals; an EISDIR fixture (a
directory passed as the spec path) pinning the same `lookup` class, so the guard is provably
errno-generic and not an ENOENT special case; a stdout-empty assertion on each (never a
`VALIDATE_OK` on failure — the `:306` contract test also re-asserts this); the bad-JSON,
exactly-one, parse-args, and both `VALIDATE_OK` deepEqual pins hold byte-for-byte.

**Freeze/PR#12 check:** `VALIDATE_OK` frozen-additive contract byte-identical (nothing on the
success path changes); no Event, no `main.ts`, no shared-parser edit (`run`'s behavior through
`main.ts` is unchanged, so no #12 collision); `validate.ts` has no closed defect decision on its
failure classification (Opus-validate landed the verb; D13 touched only the catalog-parity
remedy, which is untouched). Neither file is in PR #12. Disjoint from Ranks 1 and 2.

---

## HOLD / NO_HIGH_VALUE — everything else examined, one line each

- **`pause`/`inject` on non-flowchart or terminal runs**: re-probed at HEAD, byte-identical to the
  r8 quotes (`"Flowchart run … checkpoint is missing flowchart snapshot"`; `"cannot inject into a
  COMPLETED run"` as validation + doctor) — messages owned by `flowchart-run.ts`, classification
  by `main.ts`, both #12-held. HOLD behind PR #12 (unchanged from r8).
- **`inject --node <unknown-id>`**: plane-owned check against run state with no CLI-local seam —
  HOLD with the item above (unchanged from r8).
- **`unblock` argv dialect / G5 / G7 / E4 `[--outcome]` / cost verb / completions / `pref`
  dialect**: all `main.ts` remainder (verified `pref` is implemented inside `main.ts`), HOLD
  behind PR #12 (unchanged from r6–r8).
- **Windows cli-smoke step / status-matrix / data-dictionary / README riders**: HOLD behind
  PR #12 (all in its live diff); every batch above defers its docs rider.
- **Corrupt `providers.json` classification** (shared by `models`/`auth`/`validate` through
  `loadProvidersConfig` → main's catch): probed — `doctor --json` on that state root reports the
  `providers` check `ok: false` with `invalid providers.json at <path>`, so this is the one
  refusal family where the doctor next genuinely answers, and the message already names the path.
  NO_HIGH_VALUE — retargeting it would break the only case where the generic remedy works.
- **`models list --available --provider <unknown>` printing `(no models)`**: deliberately pinned
  at `models.test.ts:118-125` ("still says (no models) for a provider that exists nowhere") — a
  refusal would re-litigate a landed choice, not fix a defect. NO (D34 leaves it byte-identical).
- **`episode close --outcome` value domain**: the event schema deliberately accepts any string;
  needs design, not a slot (unchanged from r8).
- **F7 oauth discoverability / F15 perms window** (`auth.ts`): still NO_HIGH_VALUE per R5 — D35
  is a different defect set (refusal envelopes, not feature gaps) and does not un-hold these.
- **D33 human-lines follow-ups**: `episode events` verified healthy at HEAD (guard, order,
  escapes, byte-exact JSONL pins all landed); no new episode defect found.
- **`doctor` post-D29 / `list` post-D25 / `migrate-legacy` / `pi-compat` / `init`**: probed live
  at HEAD — `--help` and the argv dialect are complete; `pi-compat --offline --online` refuses as
  parse-args; `migrate-legacy` on a nonexistent root honestly reports an empty dry run (a
  not-a-directory refusal would invent a rule no plane owns); `init` refusals name `--force`.
  Nothing left worth a slot.
- **New `--json` surfaces (`models enable/disable`, `auth login` success echoes)**: write-op
  echoes with no demonstrated script demand; wrong-remedy defects outrank cosmetic contracts (the
  standing round rule).
- **`models disable` writing `providers.json` on a no-op**: invisible to the operator contract
  (same serialized content); D34 fixes the claim, not the write. NO.
- **D7 Variant B**: frozen by decision — not ranked.

## Final ranking

1. **D34 — `models` id preflight, unknown-model retarget, honest disable, `--provider` refusal**
   — `src/cli/models.ts` + `test/unit/cli/models.test.ts`. The routing-config verb stops
   reporting a typo'd `<provider/model>` as a validation failure with the doctor remedy (probe:
   `models enable banana` → `command: "models"`, doctor next, positional never named), names
   `models list --available` on unknown ids, stops printing `Disabled <id>` for ids that were
   never enabled (probe: exit 0 false claim), and refuses the silently-ignored
   `list --provider`-without-`--available`; guards reuse `tryParseModelRef`, `MODELS_LIST`
   byte-identical.
2. **D35 — `auth login` refusal envelopes (multi-mode, blank `--key`, blank/unknown provider,
   keyless-custom, `--from-env` preflight)** — `src/cli/auth.ts` + `test/unit/cli/auth.test.ts` +
   `test/integration/cli/commands.test.ts`. Six thrown refusals with correct D12/D21 messages
   stop crossing into main's catch as `command: "auth"` validation-with-doctor-remedy (probe:
   `auth login banana --key sk-test` → doctor next; `auth logout ""` → plane throw); messages
   byte-identical, envelopes converted in place, no catch added or widened.
3. **D36 — `validate` unreadable-path and blank-path retargeting** — `src/cli/validate.ts` +
   `test/unit/cli/validate.test.ts`. The spec checker stops answering a wrong path with a raw
   ENOENT at `stage: "execute"` and "fix the spec" (probe: `validate --children /nope.json`);
   unreadable paths become `stage: "lookup"` naming the flag with the `init` retarget, blank
   paths refuse as parse-args, spec faults keep today's bytes; `VALIDATE_OK` byte-identical and
   the shared parsers untouched.

The three batches are mutually file-disjoint, disjoint from PR #12's live file list, reopen
closed-decision files (D21/D27 `models.ts`, D12/D16/D21/D24/D28 `auth.ts`) only for defects
outside those closed scopes, and can be dispatched concurrently.
