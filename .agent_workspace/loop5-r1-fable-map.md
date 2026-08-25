# Loop 5 · Round 1 — Fable-map: feature map and under-productized surfaces

Agent: Fable-map (claude-fable-5-thinking-xhigh). Analysis only; no src/test/package.json changes.
Base: `cursor/pi-sparkle-sota-opt-0da8` @ `7adea03` (off `main` @ `80eb0bd`).
Inputs read: `docs/agent-progress.md`, `docs/agent-decisions.md`, `.agent_workspace/LOOP5-ROUND1-BRIEF.md`, `README.md`, `docs/status-matrix.md`, `tasks/plan.md`, `tasks/adaptive-todo.md`, PR #12 file list (via `gh pr view 12`).

Method: read the full CLI dispatcher (`src/cli/main.ts:2137–2205` switch, `USAGE` at `:249–357`), every `src/cli/*.ts` usage block, then traced importers of every module under `src/experiments`, `src/review`, `src/learning`, `src/routing`, `src/preferences`, `src/adaptation`, `src/context`, `src/tracking` to classify each as CLI-reachable, runtime-reachable, or library/test-only.

---

## 1. Feature map — what exists and how an operator reaches it

### 1.1 CLI verbs (the whole switch, `src/cli/main.ts:2140–2195`)

| Verb | Operator path | Notes |
|---|---|---|
| `run` (plain M0) | `pnpm cli run --project --objective` | fake executor default; `startRun` (`main.ts:1058`) |
| `run --children` | `+ --children spec.json` | compiled via `compileChildrenToFlowchart` (`main.ts:974`); skip-contract start; smart model plan (`smartChildPlan`, `main.ts:451`); post-run auto-adapt (`main.ts:1031`) |
| `run --flowchart` | `+ --flowchart flow.json [--results] [--executor]` | public orchestrator; `parseFlowchartFile` against live catalog ids (`main.ts:783–787`) |
| `run --track` | `+ --track [--assume-defaults\|--answers]` | clarify → plan → route → execute → learn (`startTrackedRun`, `main.ts:899`); questions persisted at `runtime/runs/<runId>/track-questions.json` (`src/track/loop.ts:321`) |
| `run --thinking / --public-prior / --require-public-prior` | flags on all run forms | thinking per-run only (`main.ts:111–134`) |
| `inspect --run [--json\|--summary-json]` | needs a known runId | frozen-additive `INSPECT_SUMMARY` (`main.ts:1181–1188`) |
| `inspect --episode [--json]` | needs a known epId | `main.ts:1082–1118` |
| `resume` (flowchart / supervised / plain) | needs runId | executor-config disclosure (`describeResumeExecutorConfig`, `main.ts:1272`) |
| `answer` | needs runId (+msgId or `--selected`) | approval-plan correlation (`main.ts:1706`) |
| `pause / pause --clear` | needs runId | `src/cli/pause.ts` |
| `inject --type fact\|override\|skip` | needs runId | `src/cli/inject.ts` |
| `unblock [--retry-node] [--discard-executed]` | needs runId | the only verb that ends BLOCKED (`main.ts:1505–1574`) |
| `episode events\|close [--outcome <id>]` | needs epId | `src/cli/episode.ts:14–17` |
| `delete --run\|--episode [--lock-wait-ms]` | needs id | privacy cascade (`main.ts:2008–2042`) |
| `pref list\|correct\|export\|delete` | direct | snapshot-locked mutators (`main.ts:1652–1957`) |
| `auth status\|login\|logout` | direct | incl. `--from-env` and `--oauth` (`src/cli/auth.ts:24–26`) |
| `models list [--available] \|enable\|disable\|set-default` | direct | Pi catalog browse via `--available` (`src/cli/models.ts:21–26`) |
| `adapt status\|learn\|auto\|eval\|promote\|rollback` | direct | **eval + rollback exist** (`src/cli/adapt.ts:35–38`) |
| `commits preview\|apply` | needs runId | ledger → conventional commits (`src/cli/commits.ts:31–32`) |
| `doctor [--project] [--agents-dir] [--json]` | direct | locks/runStates/learnedState inventories (`src/cli/doctor.ts`) |
| `migrate-legacy [--apply]` | direct | copy-only plane migration (`src/cli/migrate-legacy.ts:73–87`) |
| `pi-compat [--json] [--offline\|--online]` | direct | adapter-contract report (`src/cli/pi-compat.ts`) |
| `version / help` | direct | `main.ts:2175–2187` |

Cross-cutting operator affordances already shipped: `Run <id>: started` early disclosure on all three public run paths (`main.ts:813–815, 912–914, 1001–1003`); BLOCKED runs print a four-line routed remedy block (`formatBlockedRunReport`, `main.ts:565–584`); frozen error codes route `next:` to `doctor --json` (`DOCTOR_ROUTED_NEXT`, `main.ts:2065–2091`); EPIPE-quiet piping (`main.ts:2211`).

### 1.2 Runtime / persistence

- Event log + checkpoint per run at `runtime/runs/<runId>/` (`events.jsonl`, `checkpoint.json`); episodes at `runtime/episodes/`; shared `runtime/invocations.jsonl` telemetry with a single locked writer (`src/telemetry/invocation-log.ts`). Plane split runtime/adaptation (`src/privacy/state-layout.ts:4–21`), 18 record classes (`src/privacy/record-classes.ts`).
- Eight-member `RunStatus` (frozen), truncated-tail JSONL recovery, crash terminals (`src/run/crash-terminal.ts`), file pause controller, run lifecycle lock, delete cascade with lock-bounded waits.

### 1.3 Routing: live vs shadow

- **Live**: static R0-equivalent `ModelRouter` (`src/supervisor/model-router.ts`) + `assignTasks`/`analyze-task` for `--children`/`--track`; cost calibration from ok-outcome invocation rows (`src/routing/cost-calibration.ts`); learned routing policy, when promoted, is applied silently at flowchart start (`src/run/flowchart-run.ts:1329`) and loaded for children plans (`main.ts:950`).
- **Shadow/offline (frozen off live path)**: `r1.ts`, `bandit.ts#selectArm` (no live caller), `topology.ts#planTaskTopology` (parked in `src/run/supervisor.ts`), `shadow.ts`, `drift.ts`, `r1-shadow-report.ts`. Enforced by `live-isolation.test.ts`. Correctly not CLI-exposed; must stay that way (D1/D3).

### 1.4 Adaptation plane

`adapt auto` collects signals → feedback (redacted, class-stamped) → bandit write → routing-policy candidate proposal (`src/learning/auto-loop.ts`); promotion is CAS + review provenance; rollback wired. Kill switch `SPARKLE_AUTO_ADAPT=0`. Preferences with tombstoned deletes and dataset export.

### 1.5 Tests / CI / scripts / Pi adapter

- 277 test files across unit/integration/acceptance; `pnpm gate` = typecheck+lint+test+build; `pnpm prerelease` adds security probe.
- CI (`.github/workflows/ci.yml`): quality job (ubuntu, Node 22.x) + `cli-smoke` on ubuntu **and windows** (`:46–74`). PR #12 touches this file (Node 22.19.0 pin) — leave alone.
- Scripts: aliased — `pi:latest`, `pi:probe`, `invocation:probe`, `security:probe` (`package.json:32–47`). **Un-aliased**: `bench-runtime.mjs`, `crash-probe.mjs`, `retention-probe.mjs`, `kernel-reuse-probe.mjs` (invoked only as `node scripts/...`; `retention-probe` is referenced from `docs/status-matrix.md:48`).
- Pi adapter: pinned pair 0.84.3 behind `src/pi-adapter/` (ADR-001); Pi package integration is skills + prompts only (`package.json:20–27`, `prompts/sparkle.md`, `.agents/skills/pi-sparkle/SKILL.md`); no extension (ADR-006 Proposed).

---

## 2. Under-productized surfaces (library yes, CLI/docs no)

Classification from importer tracing. "Library-only" = no path from any CLI verb or live run reaches it.

| Surface | Evidence | Productization state |
|---|---|---|
| **Run/episode enumeration** | Nothing scans `runtime/runs/` except doctor, which filters to PLANNING/RUNNING advisory crash candidates only (`src/cli/doctor.ts:90, 398, 643`) | Missing entirely. Every stateful verb demands an id the operator must have kept from scrollback |
| **Spec validation without a run** | `parseChildSpec` (`main.ts:379–449`) and `parseFlowchartFile` (`src/cli/flowchart-io.ts:23–30`, → `validateFlowchart` `src/domain/flowchart.ts:347`) run only inside `runCommand`, which acquires the run lock and writes state | Validators exist and are exactly reusable; no dry-run verb |
| **Flowchart JSON schema for users** | README shows `flow.json` on the command line (`README.md:140–152`) but never its contents; node shape (taskId, role ∈ actor/critic/router/judge/tool/human, modelPolicy, confidenceThreshold, approvalRequired — `flowchart.ts:347–377`) is discoverable only from source; no `examples/` dir in repo | The "public orchestrator" (status-matrix M2.5) has no user-facing example |
| **`unblock` in README** | Zero occurrences of "unblock" in `README.md` (rg-verified), while every BLOCKED run's stderr routes the operator to it (`main.ts:565–584`) and it's the sole exit from BLOCKED | Fully implemented + tested (`test/integration/cli/unblock.test.ts`), undocumented at the front door |
| **`adapt eval` / `adapt rollback`** | Implemented (`src/cli/adapt.ts:35–38, 83–87`); absent from the main `USAGE` adapt lines (`main.ts:277–280`) and from the README commands table (`README.md:154–186`) | Hidden CLI |
| **Active learned-routing visibility** | `loadLearnedRouting` is applied to live flowchart runs (`flowchart-run.ts:1329`) and children plans (`main.ts:950`); `adapt status` prints only *proposed* candidates (`adapt.ts:101–126`) | An operator cannot ask "what learned policy is steering my runs right now" |
| **Cost/usage reporting** | `UsageTotals`/`sumUsage` exist (`src/telemetry/usage-aggregate.ts:35–57`); sole importer is cost calibration. `invocations.jsonl` carries per-call model/usage/outcome | No spend/usage view. PR #12 adds a *cap* (`--max-cost-usd`) and `inspect --follow`, not a report |
| **Feedback transparency** | `appendFeedback` writes redacted rows with `redactionClasses`; readers are the deletion cascade and record-classes only (no CLI importer of a feedback reader) | Collected-about-me view missing; only `pref` has list/export/delete |
| **Pattern detection** | `detectRepeatedPatterns` / severe-safety one-offs (`src/learning/patterns.ts`) imported by no src module — test/acceptance only | Library-only; no diagnosis surface uses it |
| **Preference loop eval** | `evaluatePreferenceLoop` (`src/preferences/loop-eval.ts`) has zero src importers | Test-only |
| **Experiments (F-SIM)** | `holdout`, `canary`, `shadow-compare`, `simulation-holdout`, `threshold-calibration`, `plan`, `attribution-report`, `replay`, `dataset` reachable only from each other / tests; `manifest`+`isolation`+`comparison-report`+`evaluation-card` reach the CLI solely through `adapt eval` | Deliberately parked (ADR-005). Do **not** productize live; a read-only shadow report is possible but low preview value — defer |
| **Cluster dead-letter post-hoc** | `deadLetterReport()`/`onDeadLetter` are host APIs (`src/cluster/host.ts:73–142`); the one stderr warning prints at settlement only; no durability (status-matrix row) | Post-hoc inspection impossible without persistence — runtime change, out of Loop 5 scope |
| **Probe scripts** | `bench-runtime` / `crash-probe` / `retention-probe` / `kernel-reuse-probe` lack pnpm aliases (`package.json:32–47`) | Discoverability gap, but `package.json` is frozen this round and PR #12 edits it — defer |
| **README small drifts** | `auth login --oauth`/`--from-env` (auth.ts:25) vs README:93 key-only; `episode close --outcome` (episode.ts:16) missing from table; `doctor --agents-dir` (USAGE:253) missing from table; USAGE `--track` line omits `[--state-root]` (`main.ts:257`) it actually accepts | Batchable one-slot docs truth-up |

---

## 3. Ranked usability / competitive gaps

Ranked by (operator pain × frequency) / risk. PR #12 collisions and Loop-4 freezes annotated per item.

| # | Gap | Impact | Files | Risk / freeze collisions |
|---|---|---|---|---|
| 1 | **`list` runs + episodes** (all 8 statuses, project, age; `--json`) | Highest. 10+ verbs demand a remembered id; loses the id ⇒ loses the run *and* its episode (epId only discoverable via `inspect --run`). Every competing runtime has this verb | Per D4: `src/run/inventory.ts`, `src/cli/list.ts` + one case/import/USAGE line | Low. New `RUN_LIST` JSON must be frozen-additive day one (D3:45). Implementation note: prefer checkpoint status where durable, fall back to `replayRun`; `EventStore.readAll` already tolerates truncated tails |
| 2 | **README documents `unblock`** (one table row + one paragraph in the flowchart section) | High. The recovery verb for a routine terminal (tracking-gate `queue_analysis` BLOCKs a children run) is invisible in the only doc a new user reads; stderr routes to a command README never introduces | `README.md` only | Near-zero. README is not frozen; PR #12 adds 2 lines to README — trivially mergeable. Not one of the parent's three bets — recommend adding as a docs ride-along or Round 2 slot |
| 3 | **`validate`** for children/flowchart specs | High. A malformed spec today costs a run start (lock, state, run dir) to discover; `--flowchart` schema is un-guessable (see #4) so iteration on a spec is trial-by-run | Per D4: `src/cli/validate.ts` + one case line | Low. Reuse `parseChildSpec`/`parseFlowchartFile` verbatim (D2 "no second schema language"). One decision to fix up front: `parseFlowchartFile` checks models against the live catalog (`main.ts:783–787`), which reads the state root. Validate should run the same check (validate-pass ⇒ run-parse-pass) — reads are fine, writes are not |
| 4 | **`init` example scaffold** | High. No `examples/` dir; README embeds a children JSON (`README.md:108–127`) but **no flowchart JSON exists anywhere user-facing**; the M2.5 "public orchestrator" requires reading `src/domain/flowchart.ts` to write its input | Per D4: `src/cli/init-examples.ts`, `examples/`, one case line | Low. Examples must satisfy `validateFlowchart` + `parseChildSpec` (test should validate scaffold output with the real parsers). No state-root mutation |
| 5 | **`usage`/cost report verb** (per run / per model totals from `invocations.jsonl` via `sumUsage`; `excludedNotOk`/`excludedUnattributed` disclosure) | Medium-high, competitive. Cost visibility is a table-stakes agent-runtime feature; the cap (PR #12) without a report is half a feature | new `src/cli/usage.ts` + reader; `usage-aggregate.ts` untouched | Medium-low. Not in PR #12 (verified against its file list). Reads are lock-free by design. New JSON contract ⇒ frozen-additive day one |
| 6 | **adapt CLI truth-up**: surface `eval`/`rollback` in main USAGE + README; extend `adapt status` to show the *active* learned routing policy per project | Medium. Governance verbs that exist but are hidden undercut the "proposal-first, reviewable" story | `main.ts` USAGE strings, README; `adapt.ts` status | Medium-low. PR #12 modifies `src/cli/adapt.ts` (+24) and `main.ts` (+316) — coordinate or wait for its merge. D3 privacy guards apply to any adaptation import change; status extension only reads files the plane already owns |
| 7 | **Feedback transparency** (`adapt feedback list`-style read-only view incl. `redactionClasses` and tombstones) | Medium. Strengthens the privacy story pre-P0-sign-off: an operator can see exactly what the plane retained | new reader in feedback plane + CLI | Medium. Data dictionary is frozen (no doc edits there); plane-boundary allowlist test will flag new cross-plane imports — keep the reader inside the adaptation plane |
| 8 | **`--json` consistency** for `models list`, `pref list`, `adapt status` | Medium-low. Scripting parity with doctor/inspect/commits/pi-compat | respective CLI files | Low each, but each new JSON object is a day-one frozen-additive contract (D3) — don't ship casually |
| 9 | **Probe script aliases + docs pointers** (`bench`, `crash`, `retention`, `kernel-reuse`) | Low | `package.json` | **Blocked this round**: package.json frozen for analysis agents and PR #12 edits it. Defer until #12 merges |
| 10 | **Shell completions / per-command `--help` audit** | Low | new script | Low; nice-to-have after verbs stabilize |

Deliberately **not** proposed (freeze-respecting): any CLI over `r1-shadow-report`/holdout/canary (ADR-005, Checkpoint F open); any Pi extension registration (ADR-006 Proposed); cluster dead-letter persistence (runtime semantics change, not a Loop 5 usability slot); retention *bounding* (accepted Q3 position — only diagnostics may move).

---

## 4. Verdict on the parent's three bets: `list` / `validate` / `init`

**KEEP all three.** Evidence summary:

- **`list` — KEEP.** No `case "list"` in the dispatcher (`main.ts:2140–2195`; the only `list` cases are `pref list` `:1938` and `models list`). Doctor's `runStates` deliberately filters to PLANNING/RUNNING (`doctor.ts:398`) and must keep that filter (its route map is frozen). `inspect`/`resume`/`answer`/`pause`/`inject`/`unblock`/`delete`/`commits`/`adapt learn` all hard-require `--run` (USAGE `:259–282`). Episodes should be included in the same verb: an episode id is only reachable through a run you can still name.
- **`validate` — KEEP, with one narrowing decision.** Parsers already exist and are the run path's own (`parseChildSpec` `main.ts:379`; `parseFlowchartFile` `flowchart-io.ts:23`; `validateFlowchart` `flowchart.ts:347`). Narrow: run the catalog-membership assert exactly as the run path does (read-only state-root access) so `validate` green means `run` will parse — a structure-only validate would pass specs the run path then refuses (`assertFlowchartModelsInCatalog`). Refuse `--results` validation scope creep in R1; `parseChildNodeResultsFile` can join later.
- **`init` — KEEP.** No `examples/` directory exists (verified); README carries a children spec inline but no flowchart JSON at all; the flowchart node contract (six role enums, modelPolicy, confidenceThreshold, approvalRequired) is source-only knowledge. Acceptance suggestion for Opus-init: the scaffold test should feed the written files through `parseChildSpec` and `parseFlowchartFile` so examples can never drift from the validators.

No REPLACE case found: nothing else at comparable impact/risk is missing from the operator loop except README-`unblock` (gap #2), which is a docs slot, not a CLI slot, and can ride along without displacing a bet.

---

## 5. Next-round module priorities (uncovered areas)

1. **Docs truth-up slot** (one agent, docs-only): README `unblock` row + paragraph; add `adapt eval`/`adapt rollback` to USAGE and README table; `auth --oauth/--from-env`; `episode close --outcome`; `doctor --agents-dir`; USAGE `--track [--state-root]` drift (`main.ts:257`). All non-frozen docs. Wait for PR #12's README/main.ts edits to land or rebase over them.
2. **Cost UX slot**: `usage` verb over `invocations.jsonl` (gap #5). Pairs with the parent's Round 0 "cost UX" theme; complements, does not duplicate, PR #12's `--max-cost-usd`.
3. **Adapt observability slot**: `adapt status` active-policy display (gap #6) after PR #12 merges (it touches `adapt.ts`).
4. **Track-loop UX review**: the clarify → `--answers` round trip works but the question file (`runtime/runs/<runId>/track-questions.json`, `track/loop.ts:321`) has no reader beyond inspect's pending-questions view; assess whether a `list`-style questions view or an `--answers` template emitter is worth a slot.
5. **Feedback transparency slot** (gap #7) — schedule after P0 reviewer re-verification round so the CLI reflects whatever the sign-off decides.
6. **Deferred pending PR #12 merge**: probe script aliases (package.json), any `main.ts`-adjacent JSON flags (gap #8).

## Appendix: collision checklist consulted

- PR #12 file list checked against every recommendation: no overlap with `list`/`validate`/`init` (D4 files untouched by #12); `usage` verb absent from #12; #12 owns `README.md`(+2), `main.ts`(+316), `adapt.ts`(+24), `ci.yml`, `package.json` — items 2/6/8/9 sequenced accordingly.
- D3 freezes re-verified where touched: doctor routes/JSON (untouched), `INSPECT_SUMMARY` (untouched), eight-member `RunStatus` (list must render all eight, not reinterpret), live-isolation allowlist (no new adaptation imports proposed on the live path), `private: true` (no packaging claims).
