# Agent decisions

Parent: Loop 5 on `cursor/pi-sparkle-sota-opt-0da8` (2026-08-25).

## D1 — This is a product/usability campaign, not Loop 4 Round 21

Loop 4 Round 21 opened with **zero honesty-hole candidates**. Repeating that audit is `NO_HIGH_VALUE_CHANGE_FOUND` by construction. Loop 5 optimizes **developer-preview usability and competitiveness**: missing operator verbs, honest docs, safer local workflows, coverage of modules Loop 4 did not productize.

Do not:

- Wire live R1 / bandit `selectArm` / `planTaskTopology` into the execution path (Checkpoint F-PROD still open).
- Register a Pi extension (ADR-006 stays Proposed).
- Claim Outcome-supported.
- Auto-promote adaptation candidates.
- Duplicate PR #12 (`--max-cost-usd`, `inspect --follow`, market-eval probe, governance files).
- Re-litigate frozen Loop 4 contracts (see D3).

## D2 — Round 1 feature bets (to be challenged, then landed)

Three operator verbs are missing on `main` and are independently useful:

1. **`list`** — enumerate runs (all statuses) and episodes from the state root. Today `inspect` / `resume` / `delete` / `pause` require the operator to already know the id. Doctor only lists PLANNING/RUNNING crash candidates; that filter stays.
2. **`validate`** — parse+validate `--children` / `--flowchart` JSON without creating a run or writing state. Reuse existing parsers/validators; do not invent a second schema language.
3. **`init`** — write example children and flowchart JSON into a directory (`--force` to overwrite). No state-root mutation, no run.

GPT-5.6-sol must independently challenge these bets. If a bet is wrong, record `NO_HIGH_VALUE_CHANGE_FOUND` for that slot and pick a better one — do not pad.

## D3 — Frozen contracts new code must not break

Carried from Loop 4 (non-exhaustive, still binding):

- Live R1/bandit/topology off the execution path; `selectArm` has no live caller.
- ADR-006 Proposed; no `package.json#pi.extensions`.
- `INSPECT_SUMMARY` four keys (`type`/`runId`/`status`/`requiredEvidence`) keep name, type, meaning.
- Doctor `--json` is frozen-additive; five doctor routes stay character-exact.
- Eight-member `RunStatus`.
- `independentEvidence` exactly one `void` discard.
- `taskCriteria` / `taskCostCeilings` as shipped (optional, never synthesized, first-write-wins).
- Targeted `steerText` as shipped; no second kernel registry; no broadcast.
- `EventStore.append` / `CheckpointStore.write` unlocked.
- Crash probe 11-case names and order.
- `package.json` stays `private: true`; no drive-by dependency edits.
- Adaptation-plane privacy guards on any adaptation import change.

New JSON contracts (`RUN_LIST`, validate stdout) start **frozen-additive** on day one: pin `type` and the documented keys; new keys later must update those pins.

## D4 — File ownership (Round 1 implementers)

To avoid overwrite:

| Slot | Owns | Must not touch |
|---|---|---|
| Opus-list | `src/run/inventory.ts`, `src/cli/list.ts`, `test/unit/cli/list.test.ts`, `test/unit/run/inventory.test.ts`; may add **one** `case "list"` + import + **one** USAGE line in `src/cli/main.ts` | `validate.ts`, `init-examples.ts`, doctor, inspection, replay |
| Opus-validate | `src/cli/validate.ts`, `test/unit/cli/validate.test.ts`; may add **one** `case "validate"` + import + **one** USAGE line in `src/cli/main.ts` | `list.ts`, `inventory.ts`, `init-examples.ts` |
| Opus-init | `src/cli/init-examples.ts`, example JSON under `examples/`, `test/unit/cli/init-examples.test.ts`; may add **one** `case "init"` + import + **one** USAGE line in `src/cli/main.ts` | list/validate implementation |

If two USAGE edits conflict, keep all three lines; do not drop siblings.

Fable-cli (Round 1): `validate` must not import `src/cli/main.ts` (dispatch cycle). Extract `parseChildSpec` into `src/cli/children-spec.ts` or `flowchart-io.ts`; `run` and `validate` both import that module. Do not leave two children decoders.

## D5 — Honesty of claims

`private: true`, developer preview, not npm-publishable, not Outcome-supported. New commands are preview operator tools. Do not describe them as production, adaptive-live, or held-out proven.

## D6 — `init` verb (open)

**KEEP the verb** (Round 1 synthesis). GPT-challenge preferred static `examples/` only. Fable-map and Fable-cli kept the verb because `package.json` `files[]` ships `dist` (plus skill/prompt trees) and forbids a drive-by `examples/` pack, so embedded constants only reach an installed binary through `init`. Repo `examples/` stays for checkout readers. Do not treat `init` as a project cookiecutter.

## D7 — Same-episode track continuation stays design-only

Fable-track specified Variant B (successor run, same episode). GPT-r2 independently **DEFER**ed that design: current project-id / concurrency / reservation holes mean the “small branch” cannot attach safely. Literal same-run-id (Variant A) stays rejected. Do not implement Variant B as specified. Revisit only with a reservation that is race-safe and an identity model GPT can re-challenge.

## D8 — Track `answer` is fail-closed without a correlatable question

The sidecar-only refusal is not enough: `waitForClarification` appends `RUN_WAITING_FOR_USER` before writing `track-questions.json`, and GPT reproduced a phantom-RUNNING `USER_ANSWER` on that torn state. Override Fable-track §6.3 fall-through.

Before the generic non-flowchart append: a non-flowchart `WAITING_FOR_USER` run with no correlatable persisted child `QUESTION` must refuse. Readable sidecar → the existing track-specific message. Missing or unreadable sidecar on that wait → generic fail-closed (inspect, not `answer`). Ordinary non-waiting runs with no sidecar still record (existing pin). `INSPECT_SUMMARY` and `replay.ts` stay untouched.

## D9 — Track continuation is facts, not a copy-paste shell line

`trackContinuationCommand` interpolates unquoted paths and uses `JSON.stringify` as shell quoting. GPT reproduced `$()` / `;` / spaces injection in the inspect/`answer` `next:` text. Do not emit a copy-pasteable executable command. Print labeled argument facts (verb, project, objective, answers file, state-root). Tests that match `run --track` / `--answers <file.json>` stay valid as facts; they must not require a single concatenable argv line. `blocked-next` four-line prefix is unrelated and stays byte-identical.

## D10 — `adapt dataset` is HOLD until privacy/isolation/deletion land

GPT-r2: **SELECTIVE ROLLBACK / HOLD** the exporter, keep `adapt show`. Required before treating the verb as merge-ready: redact-then-truncate (D1), do not claim `objective` is the only user text — classify/protect workspace path and store it at most once per manifest (D2), cascade default `adaptation/eval-datasets/<runId>/` from `delete --run` (D3), reject `--dir` under the runtime plane with realpath-aware checks (D4). Do not invent independent “episodes” from tasks.

**Landed** (Opus-dataset-privacy): redact-then-excerpt; `source.originalWorkspace` redacted once and copied onto rows; `delete --run` cascades default eval-datasets dir; `--dir` realpath-refuses the runtime plane; JSON key `episodes` kept with `rowKind: "routed-task-from-one-run"`.

**D18 residual (GPT-d10 FIX → D18/D19/D23 KEEP):** a symlink at the default `<runId>` leaf wrote the manifest outside the state root and `delete --run` only unlinked the alias. D18 closed that shape, D19 closed one-way pathname identity, D23 closed restored-empty-directory success. `adapt dataset` is merge-ready on those conditions.

## D11 — Gate-cause landing KEEP; wording and deterministic-fail coverage are riders

GPT-gate-cause-recheck: event pairing, four-key `--summary-json`, stall-path prefix, and persisted-events-only reads all PASS. Do not revert. Follow-up (wording-only + tests, no new Event/`RunStatus`/summary keys):

- Blocked `note:` should say the tracking gate's verdict is not a running job and that no analysis consumer is wired; `unblock` remains the action. Do not imply a live queue. Keep failed dimensions / per-criterion evidence on `inspect`.
- Pin `deterministic-fail` (inspect `gate cause:` and the blocked note), not only `unmet-acceptance-criterion`.
- Optional hardening: require the paired `GATE_TRANSITION` to be `queue_analysis` / `to === "BLOCKED"` and join the assessment by hash+seq.

## D12 — Auth `--from-env` must succeed when the environment is configured, even if `auth.json` is corrupt

GPT-auth-landing-recheck: **FIX**. Keep the empty-store probe and flag exclusivity. After `checkProviderEnvAuth` succeeds, do not let `listStoredCredentials` (or any real-store parse) fail the command. Omit the stored-wins note when the store cannot be listed. Add the corrupt-file + env-key CLI pin (exit 0, env source named, no secret, bytes unchanged). Add stored-OAuth `--from-env` pins (env absent → fail; env key set → succeed). Describe the check as environment/ambient auth with `auth.json` ignored — do not say “environment variables only” unless the probe is actually process-env-only. Do not change store-first `checkProviderAuth()`.

## D13 — One-model catalog must emit both `cheap` and `premium`

Fable-catalog-honesty: **HIGH VALUE**, freeze-safe. The `primaryId !== fastId` guard in `src/cli/model-catalog.ts` is not load-bearing (`cheap` is already a same-content alias). Drop that conjunct only; do not touch `catalogFromPrimary` / `primary-catalog.ts` (pinned `length === 1`). No `main.ts` / README / example-file edits — existing claims become true. Implement C1–C4 in `.agent_workspace/loop5-r3-fable-catalog.md` as one commit.

## D14 — Gate-cause transition must be the event immediately before the block

GPT-r3-landings: D11 wording KEEP, pairing **FIX**. `gate-apply.ts` writes `GATE_TRANSITION` then `RUN_BLOCKED` with nothing between. `gateBlockCause` currently scans backward past intervening events and can attribute a pause-separated (or otherwise non-adjacent) `queue_analysis` transition to a later `ANALYSIS_QUEUED` block. Require `events[blockedIndex - 1]` to be that qualifying transition; otherwise print no cause. Negative pins: intervening `PAUSE_REQUESTED` (or any non-transition) → no cause; prior block/unblock cycle must not leak onto a later unmatched block. Bound child-result evidence to events at or before the selected block. Prose-only; no Event/`RunStatus`/`INSPECT_SUMMARY` change.

Auth TTY secret-echo is Round 4 (highest-value leftover per GPT-r3), not a reason to reopen D12. Fable-r4-next ranks the implementable Round 4 batches as: G6 not-found retarget (D15), auth F5+F11+F8 (D16), `INIT_EXAMPLES` compact JSON (D17). Windows cli-smoke and status-matrix stay HOLD behind PR #12.

## D15 — Finish not-found retarget onto `list` (Round 4 rank 1)

Copy the `missingRun` house wording (do not import from `main.ts`). `episode` events/close `next:` → `list --episodes`. `pause` lookup `next:` → `list`. `inject` gets an `EventStore` empty-log preflight like `pause` (`stage: "lookup"`). No `main.ts`. Spec: `.agent_workspace/loop5-r4-fable-next.md` Rank 1.

## D16 — Auth remainder F5 + doctor auth preflight F11 + custom `--available` F8

Hidden-input for secret prompts on real stdin; additive doctor `auth` check (secrets never in `detail`); `models list --available` appends `listedModelsFromCustom`. Update doctor check-name pin additively. Hermetic doctor tests (Windows CI). Do not churn `auth.ts` D12 landing. Spec: Rank 2 of the same report.

**Landed** (Opus-auth-echo-doctor-F8): secret prompts muted on real-stdin readline (injected `io.question` unchanged); doctor check `auth` after `providers`; `--available` appends custom listed models.

**GPT-d16-recheck: KEEP.** PTY secret mute (xterm/dumb), stdin-EOF reject, doctor `auth` additive with no secret in `detail`, custom `--available`. Report: `.agent_workspace/loop5-r4-gpt-d16.md`.

## D17 — `INIT_EXAMPLES` is one compact JSON line

Drop `JSON.stringify(..., null, 2)` in `src/cli/init-examples.ts`; keep keys `type/preview/dir/files/overwritten`; pin stdout is exactly one parseable line.

## D18 — The default eval-dataset cascade must bind to a path, not to a name

GPT-r4 F1 reproduced a D10 residual: with no `--dir`, but `adaptation/eval-datasets/<runId>` pre-created as a **symlink to an external directory**, the exporter canonicalized for its isolation checks and then published `manifest.json` *through* the alias, and `delete --run` `stat`ed the path (follows the link, so the dataset "existed"), `rm`ed the lexical path (does not, so only the alias went), and reported the default directory as removed while the derivative survived externally. No warning fired — the external-export warning is a `--dir` disclosure the operator never triggered.

**Landed** (Opus-d18-dataset-symlink): both halves ask `lstat` what the leaf *is*, through the shared `src/privacy/eval-dataset-path.ts`. A default export binds — the `eval-datasets` container is resolved, the leaf is created with a non-recursive `mkdir` (never follows or adopts a final symlink), the binding is re-asserted after the publish, and a swap detected there takes the published bytes back — and refuses a symlinked leaf outright. `delete --run` refuses the shape with a typed `EvalDatasetAliasError` (`code: "EVAL_DATASET_ALIAS"`) before either cooperative lock and again at the removal point: it may not follow the alias into an operator's external directory, and it may not unlink it and call that a cascade. No global manifest search was invented; `--dir` keeps the existing external-export warning and stays outside every cascade. D10 behaviours unchanged.

**GPT-d18-recheck: FIX.** Pre-created symlink cases KEEP. Post-publish check compares canonical pathnames only, so replacing the bound leaf with a fresh real directory at the same `<runId>` path returns success while `manifestPath` does not contain the manifest. See D19. `adapt dataset` is still not merge-ready.

## D19 — Default export bind and publish must share directory identity

The post-publish assertion must confirm the leaf is a directory and is the **same directory** the bind accepted (`dev`/`ino` or an equivalent that a replacement directory cannot satisfy), not only `realpath` string equality. Thread that identity from `bindDefaultEvalDatasetDir` into `assertDefaultEvalDatasetPublished`. If the leaf was replaced during publish, fail loudly and do not return a path whose `manifest.json` is missing. Keep the existing symlink-swap pin; add a real-directory replacement pin via the `AtomicWriteOptions.rename` seam. Do not change `--dir`, deletion of a pre-created symlink leaf, `main.ts`, or invent a global search.

**Landed** (Opus-d19-publish-identity): `bindDefaultEvalDatasetDir` returns `BoundEvalDatasetDir` (lexical path + accepted leaf identity); `assertDefaultEvalDatasetPublished` re-reads that identity. Identity is `lstat` `dev`/`ino` as bigint; when `ino === 0n`, a uniquely named witness file with `"wx"` is the equivalent.

**GPT-d19-recheck: FIX.** Endpoint identity KEEP for one-way replacement. Restoring the originally bound directory after the publish landed in a replacement still returns success with a missing `manifest.json`. See D23. `adapt dataset` is still not merge-ready.

## D23 — Successful default export must find `manifest.json` in the bound directory

Post-publish must not only re-read directory identity; it must `lstat` `manifest.json` inside that same directory and require a regular file. If the originally bound directory is restored empty after the write went to a replacement, fail at stage `"publish"` and do not return a path whose manifest is missing. Keep D18 symlink refusals and the D19 one-way replacement pin. Add a rename-seam pin: move bound leaf aside → publish into a replacement → move replacement aside → restore original leaf → export rejects. Do not search the filesystem for the displaced directory. Do not change `--dir` or `main.ts`.

**Landed** (Opus-d23-manifest-exists): `assertDefaultEvalDatasetPublished` `lstat`s `EVAL_DATASET_MANIFEST_FILE` on the bound path and requires `isFile()`.

**GPT-d23-recheck: KEEP.** Success implies a regular-file manifest in the bound directory; D18/D19 pins intact. Report: `.agent_workspace/loop5-r4-gpt-d23.md`.

## D20 — Round 5 rank 1: CLI claims only the work it did

Fable-r5-next: **HIGH VALUE**. GPT-r5-challenge: **FIX** the two remedies, keep the slot.

- `commits apply`: always disclose successful count and remaining proposal ids. Recommend `--nodes` only for generated proposals whose remaining ids round-trip through `parseCommitNodeIdsCsv`. For `--file`, tell the operator to write the uncommitted suffix as a new `{ "commits": [...] }` file and rerun; do not print a command that can replay the prefix. Do not narrow flowchart ids.
- Truncation warning + `episode close --json` refuse as Fable specified (`warnTruncatedJsonl` in `errors.ts`; `main.ts` keeps its private copy until #12).
- `pause --clear`: base the message on whether unlink actually removed a file (narrow result-bearing helper in `pause-controller.ts`). No malformed-token special case; no TOCTOU probe-then-clear.

No `main.ts`. Spec: `.agent_workspace/loop5-r5-fable-next.md` Rank 1 as corrected by `.agent_workspace/loop5-r5-gpt-challenge.md`.

**Landed** (Opus-d20-cli-honesty + GPT-r5 riders): truncation warnings, `episode close --json` refuse, partial-apply notes that prescribe `--nodes` only for CSV-round-trippable generated ids, `--file` suffix-file recovery, `unlinkPauseToken` result-bearing clear.

**GPT-d20-recheck: KEEP.** Report: `.agent_workspace/loop5-r5-gpt-d20.md`.

## D21 — Round 5 rank 2: auth/models operator remainder

Fable-r5-next. GPT-r5-challenge: **FIX** the login message and G4 count; keep the slot. F4, F12, and keyless-custom `--from-env` already landed — do not re-implement.

- Keyless-custom `--key`/interactive/oauth: refuse storing into `auth.json` because the custom resolver ignores it. Do **not** say requests are always keyless: `PI_API_KEY` can still apply to the selected default provider. Do not advise “remove the flag.”
- Convert the **five** missing-argument sites (auth login/logout, models enable/disable/set-default), or all seven including unknown-subcommand; do not claim six.
- F9 disable dropped-default disclosure; F13 `status --all` never empty; source column `env` only when `check.source` equals the configured `envVar`, else `ambient`.

Do not edit `pi-adapter/runtime.ts` (PR #12). Spec: Rank 2 as corrected by the GPT challenge.

**Landed** (Opus-d21-auth-models + GPT-r5 riders): keyless-custom login refuses store writes and names `PI_API_KEY`; custom source column equals configured `envVar` else `ambient`; five missing-arg `cliFail` sites; F9/F13/F14.

**GPT-d21-recheck: FIX.** Keyless-custom refusal, five-site `cliFail`, F9/F13/F14 KEEP. Source column compares `check.source` to `custom.envVar?.trim()` while config keeps the untrimmed value, so a padded `envVar` that still resolves labels `ambient`. Builtin comment calls `"AWS access keys"` a non-env path; it is the two-env-var AWS path. See D24.

## D24 — Auth status source column must match the configured `envVar` bytes

Compare `check.source` to the preserved configured `envVar` (or trim at parse, resolution, and display together). Do not trim only on the display side. Pin a padded `envVar` custom row as `env` when resolution used that variable. Correct the builtin comment: do not describe the `"AWS access keys"` source as a file/profile/role branch. Optionally pin `amazon-bedrock` classification for that source. Do not edit `runtime.ts` or `main.ts`. Files: `src/cli/auth.ts`, `test/unit/cli/auth.test.ts`.

**Landed** (Opus-d24-source-column): equality is `source === custom.envVar` (untrimmed). AWS access-keys comment corrected.

**GPT-d24-recheck: KEEP.** Report: `.agent_workspace/loop5-r5-gpt-d24.md`.

## D25 — Round 6 rank 1: `list` truncation disclosure + `--sort last-event`

Fable-r6-next. GPT-r6-challenge: **FIX** the remedies, keep the slot. Inventory must not silently discard JSONL recovery: add `warnings` (update empty-inventory exact `{ runs/episodes, errors }` pins to include `warnings: []`). CLI: stderr `warning: ${path}: ${message}`; additive JSON `warnings`. Keep inventory by-id sort unchanged; absent `--sort` equals `id`. Apply `last-event` only to a copied CLI row array. Compare `Date.parse(lastEventAt)` descending, then id ascending — not `localeCompare` (offset-bearing pin). Do not invent an undefined `startedAt` episode fixture; test `undefined`-last at a factored sort seam if needed. No `main.ts`. Spec: `.agent_workspace/loop5-r6-fable-next.md` Rank 1 as corrected by `.agent_workspace/loop5-r6-gpt-challenge.md`.

**Landed** (Opus-d25-list-sort): `72a3b2e` warnings + CLI `last-event`; rider `02ef2f4` Date.parse comparator + offset pins on `cursor/list-truncation-sort-0da8`.

**GPT-d25-recheck: KEEP.** Report: `.agent_workspace/loop5-r6-gpt-d25.md`. Merged to the integration branch.

## D26 — Round 6 rank 2: one-dialect argv errors and working `--help` on free verbs

GPT-r6-challenge: **KEEP**. Wrap only the synchronous `parseArgs(...)` call. Honor new help booleans before any state read. Omit the optional inject rider. Spec: Rank 2.

**Landed** (Opus-d26-argv-help): `d962aa8`/`daf7fc7` six-verb argv/`--help`; revert `25742b4` dropped the inject rider so `inject.ts` and `pause-inject.test.ts` match parent.

**GPT-d26-recheck: KEEP.** Report: `.agent_workspace/loop5-r6-gpt-d26.md`. Merged to the integration branch.

## D27 — Round 6 rank 3: `models list --json` (`MODELS_LIST`) + leftover dialect

GPT-r6-challenge: **FIX** the JSON contract, keep the slot. Discriminated shape: enabled always has `type`, `preview`, `mode`, `primary`, `fast`, `models` (`primary`/`fast` are `string | null`; each row is exactly `id` + `inCatalog`). Available has exactly `type`, `preview`, `mode`, `models` and rows exactly `{id}`. Do not duplicate defaults as per-row booleans. Describe as stored configuration, not effective per-run routing. Catch only `parseArgs`. Whole-object `deepEqual` pins. Files: `src/cli/models.ts`, `test/unit/cli/models.test.ts`.

**Landed** (Opus-d27-models-json): first `0fded4e`; rider `c83fc99` discriminated shape on `cursor/models-list-json-0da8`.

**GPT-d27-recheck: KEEP.** Report: `.agent_workspace/loop5-r6-gpt-d27.md`. Merged to the integration branch.

## D28 — Round 7 rank 1: `auth` dialect completion + `auth status --json` (`AUTH_STATUS`)

Fable-r7-next. GPT-r7-challenge: **FIX** the parser `command` field, keep the slot. Convert unknown-subcommand and three `parseArgs` to `cliFail` `stage: "parse-args"`. Parser errors pin `command: "auth status"|"auth login"|"auth logout"`; unknown subcommand stays `command: "auth"`. Honor `--help` on status/login/logout before provider/store I/O. Discriminated `AUTH_STATUS` stored mode `type/preview/mode/stored` rows `{providerId,credentialType}`; `--all` adds `environment` `{providerId,label,source}` via `sourceLabel`, never a secret value. Catch only `parseArgs`. Files: `src/cli/auth.ts`, `test/unit/cli/auth.test.ts`.

**Landed** (Opus-d28-auth-json): `ad14592` runtime; rider `4d3fcc4` exact parser-error tests.

**GPT-d28-recheck: KEEP.** Report: `.agent_workspace/loop5-r7-gpt-d28.md`. Merged to the integration branch.

## D29 — Round 7 rank 2: `doctor --help` and argv dialect

Fable-r7-next. GPT-r7-challenge: **KEEP**. `DOCTOR_USAGE`; `help` boolean honored before engines/inventory/mkdir. Wrap only synchronous `parseArgs`. Frozen `--json` contract byte-untouched. Files: `src/cli/doctor.ts`, `test/unit/cli/doctor.test.ts`. Spec: Rank 2.

**Landed** (Opus-d29-doctor-help): `0244549` on `cursor/doctor-help-dialect-0da8`.

**GPT-d29-recheck: KEEP.** Report: `.agent_workspace/loop5-r7-gpt-d29.md`. Merged to the integration branch.

## D30 — Round 7 rank 3: `inject` `--type`/`--confidence` preflight

Fable-r7-next (the rider GPT-r6 omitted from D26, now its own slot). GPT-r7-challenge: **FIX** blank confidence, keep the slot. Refuse `type` outside exported `INJECTION_KINDS` and non-finite/`[0,1]` `--confidence` as `parse-args` before EventStore lookup. Reject `values.confidence.trim() === ""` before `Number()` (empty/whitespace coerce to 0). Do not widen a catch around run lookup or injection. Files: `src/cli/inject.ts`, `test/integration/cli/pause-inject.test.ts`. Spec: Rank 3 as corrected by `.agent_workspace/loop5-r7-gpt-challenge.md`.

**Landed** (Opus-d30-inject-preflight): `6a7c2dd` plus rider `c2be255` (shared kinds + blank confidence).

**GPT-d30-recheck: KEEP.** Report: `.agent_workspace/loop5-r7-gpt-d30.md`. Merged to the integration branch.

## D31 — Round 8 rank 1: `pause`/`inject` argv value preflight

Fable-r8-next. Refuse malformed `--run` (`isRunId`) and blank `--reason`/`--key`/`--node`/`--actor` (plane trim rule) as `parse-args` **before any state read**. Preserve D30 precedence: type/confidence refusals still fire before the `--run` shape guard. No catch added or widened; plane files read for wording only. Files: `src/cli/pause.ts`, `src/cli/inject.ts`, `test/integration/cli/pause-inject.test.ts`. Spec: `.agent_workspace/loop5-r8-fable-next.md` Rank 1.

**GPT-r8-challenge: KEEP.** Report: `.agent_workspace/loop5-r8-gpt-challenge.md`.

**Landed** (Opus-d31-pause-inject): `b1d9621` on `cursor/pause-inject-value-preflight-0da8`. Report: `.agent_workspace/loop5-r8-opus-d31.md`.

**GPT-d31-recheck: KEEP.** Report: `.agent_workspace/loop5-r8-gpt-d31.md`. Merged to the integration branch as `393f164`.

## D32 — Round 8 rank 2: `commits` refusal retargeting

Fable-r8-next. Five surfaces: malformed `--run`; empty `--nodes` CSV (blames the run); unknown node ids (doctor remedy); `--file` ENOENT as `stage: "execute"`; repo-preflight throws pick up generic doctor next. `isRunId` guard; empty-CSV parse-args before state; hoist `filterDecisionCommitNodeIds` into each command body under a single-call catch; two narrow trys around `readFile`/`parseDecisionCommitFile`; repo throws → `stage: "preflight"` `cliFail` keeping pinned "work tree" wording. `COMMITS_PREVIEW` and D20 partial-apply pins byte-identical. Do not edit `src/tools/decision-commit.ts`. Files: `src/cli/commits.ts`, `test/integration/cli/commits.test.ts`. Spec: Rank 2 as corrected by `.agent_workspace/loop5-r8-gpt-challenge.md`.

**GPT-r8-challenge: FIX** (keep the slot). Add explicit-blank `--repo` as `parse-args` before any state read: `values.repo !== undefined && values.repo.trim() === ""` → `invalid --repo "<raw>": repository path must be a non-empty string`, next names omit-to-checkpoint-fallback. Keep omitted-fallback and non-git path as distinct `stage: "preflight"` reports. Pin `--repo ""` / `"  "` and argv-before-state on a nonexistent `--state-root`.

**Status:** GPT blank-`--repo` rider landed (`c91af7b` on `cursor/commits-refusal-retarget-0da8`).

**GPT-d32-recheck: KEEP.** Report: `.agent_workspace/loop5-r8-gpt-d32.md`. Merged to the integration branch as `53dccde`.

## D33 — Round 8 rank 3: `episode` malformed-id guard + designed `events` lines

Fable-r8-next (Fable-r7 rider rides on this real touch). `isEpisodeId` parse-args guard on both real subcommands, retargeting to `list --episodes`. Human `events` lines become `<timestamp>\t<TYPE>\t<detail>` per event type (each type's own timestamp field; WAITING discloses `reason: requiredEvidence`). `--json` byte-identical; `EPISODE_USAGE` untouched. Files: `src/cli/episode.ts`, `test/integration/m3/episode-cli.test.ts`. Spec: Rank 3 as corrected by `.agent_workspace/loop5-r8-gpt-challenge.md`.

**GPT-r8-challenge: FIX** (keep the slot). (A) Unknown-subcommand refusal must precede required-`--episode` / `isEpisodeId` — pin `episode nonsense --episode banana` to the existing unknown-command report. (B) Escape `\`, tab, CR, LF in human detail fields so one physical line per event and exactly two structural tabs; `--json` unchanged.

**Status:** GPT dispatch-order + escape rider landed (`8ca3026` on `cursor/episode-id-events-lines-0da8`).

**GPT-d33-recheck: FIX** (keep the slot; tests only). Source behavior is correct. (1) Each `requiredEvidence` entry in the escape fixture must contain literal `\`, tab, CR, and LF — current `["tests\tunit", "docs\nadr", "plain"]` does not. (2) Raw-JSONL pins must compare stdout to the file bytes directly, not via `trimEnd().split("\n")`. Report: `.agent_workspace/loop5-r8-gpt-d33.md`.

**Status:** test-pin rider landed (`08219b2` on `cursor/episode-id-events-lines-0da8`).

**GPT-d33b-recheck: KEEP.** Report: `.agent_workspace/loop5-r8-gpt-d33b.md`. Merged to the integration branch as `82e6ad4`.

## D34 — Round 9 rank 1: `models` id preflight, honest disable, `--provider` refusal

Fable-r9-next. Refuse malformed `<provider/model>` / `--primary` / `--fast` via `tryParseModelRef` as `parse-args` before config. Unknown ids keep `unknown model "${id}"` at `stage: "validation"` with `models list --available` next. `disable` prints an honest not-enabled message (exit 0) when the id was never in `before.enabled`, still calling `disableModel`. `list --provider` without `--available` refuses as parse-args. `MODELS_LIST` byte-identical. Files: `src/cli/models.ts`, `test/unit/cli/models.test.ts`. Spec: Rank 1 as corrected by `.agent_workspace/loop5-r9-gpt-challenge.md`.

**GPT-r9-challenge: FIX** (keep the slot). (1) Blank `--provider` parse-args before either list branch. (2) Three-way disable: in-enabled keep `Disabled`; dangling default call `disableModel` and say clearing dangling routing default references (never “nothing to disable”); pure no-op skip `disableModel` and pin bytes unchanged. (3) Do not interpolate an unquoted raw state-root into `next`.

**Status:** GPT-r9 FIX rider landed (`09c2f0d` on `cursor/models-id-preflight-0da8`). PR #19.

**GPT-d34-recheck: KEEP.** Report: `.agent_workspace/loop5-r9-gpt-d34.md`. Merged to the integration branch as `de2f459`.

## D35 — Round 9 rank 2: `auth login` refusal envelopes

Fable-r9-next. Convert six thrown D12/D21 refusals to `cliFail` with `command: "auth login"` (blank positional folds into the existing missing-arg report). Multi-mode and blank `--key` are parse-args before config; unknown provider and keyless-custom are validation with inventory next; `--from-env` unset is preflight. Message bytes unchanged. Convert `commands.test.ts` `assert.rejects` with the throws. No catch added or widened. Files: `src/cli/auth.ts`, `test/unit/cli/auth.test.ts`, `test/integration/cli/commands.test.ts`. Spec: Rank 2 as corrected by `.agent_workspace/loop5-r9-gpt-challenge.md`.

**GPT-r9-challenge: FIX** (keep the slot). Unknown-provider `next` must name `models list --available` using the same `--state-root` without embedding the raw path. Split unset-`--from-env` next by named custom `envVar` vs builtin ambient sources. Preserve D24: do not trim a custom envVar only when reporting its failure; pin padded `envVar: " PADDED_ENV "`.

**Status:** GPT-r9 FIX rider landed (`a8e80d5` on `cursor/auth-login-envelopes-0da8`). PR #20.

**GPT-d35-recheck: KEEP.** Report: `.agent_workspace/loop5-r9-gpt-d35.md`. Merged to the integration branch as `2afc5f8`.

## D36 — Round 9 rank 3: `validate` unreadable/blank path retargeting

Fable-r9-next. Blank `--children`/`--flowchart` refuse as parse-args. Unreadable paths become `stage: "lookup"` naming the flag with an `init` retarget (classify via `errorCodeOf` in the existing catch). Spec faults keep `stage: "validation"` + "fix the spec". Do not edit `children-spec.ts` / `flowchart-io.ts`. `VALIDATE_OK` byte-identical. Files: `src/cli/validate.ts`, `test/unit/cli/validate.test.ts`. Spec: Rank 3.

**Status:** landed on `cursor/validate-path-retarget-0da8` (`2e9d35e`). PR #18.

**GPT-r9-challenge: KEEP.** Report: `.agent_workspace/loop5-r9-gpt-challenge.md`.

**GPT-d36-recheck: KEEP.** Report: `.agent_workspace/loop5-r9-gpt-d36.md`. Merged to the integration branch as `367bd45`.

## D37 — Round 10 rank 1: blank `--state-root` preflight on seven free verbs

Fable-r10-next. When `--state-root` is present and `trim() === ""`, each free verb refuses as `parse-args` before any filesystem read or write (and before any `next` that interpolates the resolved root). Message: `invalid --state-root "${raw}": state root must be a non-empty directory path`. Next names the flag, never interpolates the raw value: `pass --state-root <dir> or omit it to use the default ~/.pi-sparkle`. `command` stays each module's existing dialect. Guard copied per module (D15; no shared helper in `errors.ts`). Nonblank relative roots stay accepted. Files: `src/cli/{list,pause,inject,commits,models,auth,validate}.ts` + `test/unit/cli/{list,models,auth,validate}.test.ts` + `test/integration/cli/{pause-inject,commits}.test.ts`. Spec: Rank 1 in `.agent_workspace/loop5-r10-fable-next.md`. Reopens D25/D31/D32/D34/D35/D36 files only for this new defect.

**Status:** GPT-r10 FIX rider is the implementation contract. Implementer dispatched.

**GPT-r10-challenge: FIX** (keep the slot). Guard list/pause/inject/commits/models/auth as Fable specified, after each module's existing path-free argv checks. In `validate`, apply the guard **only on the flowchart branch** after the exactly-one and blank-spec checks; `--children` documents that `--state-root` is ignored — do not refuse a blank root there. Pause mixed case `pause --run banana --state-root ""` reports blank root first (does not fight D31: existing malformed-run pins use a nonblank temp root). Keep per-module copied guards; no helper in `errors.ts`/`main.ts`. Report: `.agent_workspace/loop5-r10-gpt-challenge.md`.

## D38 — Round 10 rank 2: `init` and `migrate-legacy` target-directory contract

Fable-r10-next. `init`: blank/whitespace `--dir` is parse-args; obstruction preflight (`lstat` each target, refuse even with `--force` when not a regular file) before any write; write faults name `--dir` and disclose partial work on stderr (D20). Pinned no-`--force` "already exists" bytes kept and now only fire when `--force` would succeed. `migrate-legacy`: same blank `--state-root` parse-args as D37; coded fs faults in the existing scan catch become `stage: "lookup"` naming the flag; corrupt legacy JSONL keeps `stage: "scan"`. Nonexistent root keeps the honest empty dry run. Files: `src/cli/{init-examples,migrate-legacy}.ts` + `test/unit/cli/{init-examples,migrate-legacy}.test.ts` + `test/integration/cli/migrate-legacy.test.ts`. Spec: Rank 2 in `.agent_workspace/loop5-r10-fable-next.md`.

**Status:** GPT-r10 FIX rider is the implementation contract. Implementer dispatched.

**GPT-r10-challenge: FIX** (keep the slot). Blank `--dir` next stays “omit to write into the current directory” (omission is the documented default; explicit blank is malformed). Obstruction `lstat` preflight even with `--force`. Execute catch: message may interpolate the resolved dir; `next` stays path-free. Partial-disclosure cannot use the squat fixture (preflight rejects it); add an optional `writeFile` seam (default real `writeFile`) so one test pins squat/zero-write and a separate seam test pins the note after the first write. Append to `written` only after `writeFile` resolves. Migrate: D37 blank-root bytes; coded fs → `lookup`; uncoded JSONL stays `scan`; ENOENT empty dry-run stays exit 0. Report: `.agent_workspace/loop5-r10-gpt-challenge.md`.

## D39 — Round 10 rank 3: `episode` corrupt-log envelopes

Fable-r10-next. Convert corrupt events-log and close snapshot-log throws to in-module `cliFail` (`command: "episode"`, `stage: "validation"`, store message bytes kept). Next must not send the operator to doctor (doctor does not inventory episode logs); close retargets `list --episodes --json` `errors[]`. Catch only `DomainValidationError` without an `errorCodeOf` so lock timeouts still reach main. Also refuse blank `--state-root` as parse-args (file-disjoint instance of D37). Do not edit episode stores. Files: `src/cli/episode.ts` + `test/integration/m3/episode-cli.test.ts`. Spec: Rank 3 in `.agent_workspace/loop5-r10-fable-next.md`. Reopens D33 only for this new defect.

**Status:** landed on `cursor/episode-corrupt-log-0da8` (`0f773df`). Report: `.agent_workspace/loop5-r10-opus-d39.md`. Merge gated on GPT-d39-recheck KEEP.

**GPT-r10-challenge: FIX** (keep the slot). Keep `command: "episode"` (D33 spelling) and store message bytes. Blank-root guard **after** help and unknown-subcommand (and after missing-episode), **before** `isEpisodeId`. Pin `episode events --help --state-root ""` usage/exit 0 and `episode nonsense … --state-root ""` as `Unknown episode command: nonsense`. Catch only uncoded `DomainValidationError` around each `readAll()`; rethrow everything else (lock-timeout still reaches main). Report: `.agent_workspace/loop5-r10-gpt-challenge.md`.

## D22 — Round 5 rank 3: doctor storage inventory

GPT-r5-challenge: **FIX** the inventory, keep the additive check. Walk immediate entries under both plane roots and recursively total each (covers `catalog-observed.json`, `registry.json`, learning projects; the shipped preferences path is `adaptation/preferences.json`, not `preferences/`). Report logical bytes. `lstat` before recursion is best-effort, not race-proof; count a link without descending. Windows: inject an fs seam or wrong-node fixture for `scanErrors`; skip directory-link only on capability error. No sixth `DOCTOR_ROUTED_NEXT` route. Spec: Rank 3 as corrected.

**Landed** (Opus-d22-doctor-storage): additive `storage` field and check; plane-root walk; `storageFs` seam + ENOTDIR fixture for scanErrors.

**GPT-d22-recheck: KEEP.** Report: `.agent_workspace/loop5-r5-gpt-d22.md`.
