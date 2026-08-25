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

**Landed** (Opus-dataset-privacy): redact-then-excerpt; `source.originalWorkspace` redacted once and copied onto rows; `delete --run` cascades default eval-datasets dir; `--dir` realpath-refuses the runtime plane; JSON key `episodes` kept with `rowKind: "routed-task-from-one-run"`. Treat `adapt dataset` as merge-ready on those conditions.

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

## D17 — `INIT_EXAMPLES` is one compact JSON line

Drop `JSON.stringify(..., null, 2)` in `src/cli/init-examples.ts`; keep keys `type/preview/dir/files/overwritten`; pin stdout is exactly one parseable line.

## D18 — The default eval-dataset cascade must bind to a path, not to a name

GPT-r4 F1 reproduced a D10 residual: with no `--dir`, but `adaptation/eval-datasets/<runId>` pre-created as a **symlink to an external directory**, the exporter canonicalized for its isolation checks and then published `manifest.json` *through* the alias, and `delete --run` `stat`ed the path (follows the link, so the dataset "existed"), `rm`ed the lexical path (does not, so only the alias went), and reported the default directory as removed while the derivative survived externally. No warning fired — the external-export warning is a `--dir` disclosure the operator never triggered.

**Landed** (Opus-d18-dataset-symlink): both halves ask `lstat` what the leaf *is*, through the shared `src/privacy/eval-dataset-path.ts`. A default export binds — the `eval-datasets` container is resolved, the leaf is created with a non-recursive `mkdir` (never follows or adopts a final symlink), the binding is re-asserted after the publish, and a swap detected there takes the published bytes back — and refuses a symlinked leaf outright. `delete --run` refuses the shape with a typed `EvalDatasetAliasError` (`code: "EVAL_DATASET_ALIAS"`) before either cooperative lock and again at the removal point: it may not follow the alias into an operator's external directory, and it may not unlink it and call that a cascade. No global manifest search was invented; `--dir` keeps the existing external-export warning and stays outside every cascade. D10 behaviours unchanged.
