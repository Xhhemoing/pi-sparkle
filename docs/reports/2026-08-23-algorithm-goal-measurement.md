# Algorithm goal measurement — Phase 1b — 2026-08-23

Independent re-measurement of the merged tree, run from scratch. Every number
below was produced in this session; nothing is carried over from the earlier
`9035` campaign.

- **Measured tree:** `cursor/merge-inactive-slices-f31b` @ `10d08a5`
- **Work branch:** `cursor/algorithm-goal-measure-f31b`
- **Model slug:** `claude-opus-5-thinking-high-fast`
- **Executor:** fake only. `PI_SMOKE` unset and no provider credential
  (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `PI_API_KEY`, `PI_PROVIDER`,
  `PI_MODEL`, `GOOGLE_API_KEY` all unset), so **no real-provider path was
  exercised** and nothing here is evidence about real model behaviour.
- **Evidence class:** simulation + local fake-executor only.
  **Not Outcome-supported. Checkpoint F-PROD stays open.**
- **Toolchain:** Node v22.14.0, pnpm 10.17.1. (`package.json` wants Node
  `>=22.19.0`; pnpm prints an `Unsupported engine` warning on every command.
  Nothing failed because of it, but the whole run is one minor below the
  declared floor.)

## 1. Command table

Every command was run from the repo root on `10d08a5` plus this branch's two
commits. `PASS`/`FAIL` are the `node:test` summary counters.

### 1.1 Simulation / shadow / F-SIM

| Command | Pass | Fail | Duration |
|---|---|---|---|
| `pnpm exec tsx --test test/integration/m6/simulation-holdout.test.ts` | 11 | 0 | 223 ms |
| `pnpm exec tsx --test test/unit/routing/r1-shadow-report.test.ts` | 8 | 0 | 175 ms |
| `pnpm exec tsx --test test/unit/routing/shadow.test.ts` | 11 | 0 | 173 ms |
| `pnpm exec tsx --test test/unit/experiments/shadow-compare.test.ts` | 1 | 0 | 157 ms |

### 1.2 Algorithm units, cluster, acceptance

| Command (`pnpm exec tsx --test <file>`) | Pass | Fail | Duration |
|---|---|---|---|
| `test/unit/routing/analyze-task.test.ts` | 3 | 0 | 160 ms |
| `test/unit/routing/assign.test.ts` | 4 | 0 | 221 ms |
| `test/unit/supervisor/flowchart-router.test.ts` | 15 | 0 | 182 ms |
| `test/unit/learning/signals.test.ts` | 3 | 0 | 166 ms |
| `test/unit/learning/auto-loop.test.ts` | 8 | 0 | 216 ms |
| `test/unit/cluster/mailbox.test.ts` | 2 | 0 | 153 ms |
| `test/unit/cluster/spawn.test.ts` | 2 | 0 | 177 ms |
| `test/acceptance/adaptive-loop.test.ts` | 2 | 0 | 191 ms |

Cluster tests were run **per file** as required. Passing the directory
reproduces the failure:

```
$ pnpm exec tsx --test test/unit/cluster/
# Error [ERR_UNSUPPORTED_DIR_IMPORT]: Directory import
#   '/workspace/test/unit/cluster' is not supported resolving ES modules
#   imported from /workspace/
# pass 0  # fail 1
```

Note the runner still exits `0` at the shell level in a pipeline; the failure
only shows in the TAP counters.

### 1.3 Wider routing sweep (context for the above)

| File | Pass | Fail |
|---|---|---|
| `test/unit/routing/live-isolation.test.ts` | 3 | 0 |
| `test/unit/routing/live-catalog.test.ts` | 11 | 0 |
| `test/unit/routing/live-cascade.test.ts` | 7 | 0 |
| `test/unit/routing/high-risk-filter.test.ts` | 3 | 0 |
| `test/unit/routing/catalog-eligibility.test.ts` | 4 | 0 |
| `test/unit/routing/r0.test.ts` | 20 | 0 |
| `test/unit/routing/r1.test.ts` | 17 | 0 |
| `test/unit/routing/topology.test.ts` | 15 | 0 |
| `test/unit/routing/outcomes.test.ts` | 5 | 0 |
| `test/unit/routing/failure-class.test.ts` | 7 | 0 |
| `test/unit/routing/feature-version.test.ts` | 3 | 0 |

### 1.4 Whole-repo gates (after this branch's fix)

| Command | Result |
|---|---|
| `pnpm typecheck` | clean |
| `pnpm lint` | clean |
| `pnpm test` | 1187 tests, **1186 pass, 0 fail, 1 skipped**, 19.1 s |

## 2. F-SIM numbers

Reproduce with `pnpm exec tsx scripts/measure/simulation-holdout-drive.ts`
(added on this branch, measurement-only, not imported by any live plane file).

Fixture: 68 train episodes (8 `cheap`/FAIL, 50 `mid`/PASS, 10 `mid`/FAIL),
20 holdout episodes across two families (14 `bugfix`, 6 `docs`), models
`cheap` and `mid`, `r0Config = { confidenceGate: 0.7, cascade: true }`.

| Field | Value |
|---|---|
| `protocol.design` | `paired` |
| `protocol.evidenceClass` | `simulation` |
| `protocol.trainEpisodeCount` / `holdoutEpisodeCount` | 68 / 20 |
| `comparison.evidenceClass` | `simulation` |
| **`canCloseProductionCheckpointF`** | **`false`** (both on `protocol` and `comparison`) |
| `claims` | `["仿真证据"]` — no improvement-flavoured claim survives |
| `rawCounts` | 20 episodes / 20 baseline / 20 candidate |
| **`utilityDelta.mean`** | **`0`** — standardError `0`, CI `[0, 0]`, `provisional: false` |
| **`costDelta.mean`** | **`+0.03136` USD**, standardError `0.004710`, CI `[0.022129, 0.040591]`, `provisional: false` |
| `familyBreakdown[bugfix]` | count 14, utilityDelta 0, costDelta `+0.0448` |
| `familyBreakdown[docs]` | count 6, utilityDelta 0, costDelta `0` |

R0 vs R1 divergence over the 20 holdout pairs:

| Field | Value |
|---|---|
| pairs | 20 |
| divergent (`r0ModelId !== r1ModelId`) | **14 (70.0 %)** |
| `r1Fallback` | 6 (30.0 %) — exactly the `docs` family, unseen in train |
| distinct R0 selections | `["cheap"]` |
| distinct R1 selections | `["mid", "cheap"]` |
| any `invoked` | `false` — nothing was executed |

**The single most important structural fact.** `utilityDelta` is not "measured
as zero", it is **zero by construction**. In `buildR1ShadowReport` both arms are
handed the *same* observed outcome:

```115:123:src/routing/r1-shadow-report.ts
    const utility = episode.taskSuccess === "PASS" ? 1 : 0;
    records.push({
      episodeHash: episode.episodeHash,
      taskFamily: episode.taskFamily,
      baselineUtility: utility,
      candidateUtility: utility,
      baselineCostUsd: selectedCost(r0, r0.selection),
      candidateCostUsd: selectedCost(r0, r1.selection),
    });
```

`baselineUtility` and `candidateUtility` are the same variable, so the paired
utility delta can never be anything but `0` regardless of which model each arm
picked. Only cost differs. Consequences:

- F-SIM can measure **cost and action-diff only**. It can never produce
  evidence that R1 is better or worse in quality.
- The improvement-claim gate in `validateComparisonReport` is therefore
  guaranteed to fire: with CI `[0, 0]`, `utilityCi.lower <= 0` always holds.
  Claim-stripping is real but currently redundant.
- The CLI already says this out loud. `pi-sparkle adapt status` prints
  *"adapt eval replays frozen episodes for cost and action-diff evidence only;
  qualityEvidence is none-by-construction (utilityDelta 0)"*. The behaviour and
  the documentation agree; the honesty is genuine.

Direction of the one number that *is* real: R1 costs **more**, by
`+0.031 USD/episode` with a CI strictly above zero. On this fixture R1 is a
cost regression with no measurable quality upside.

## 3. Real local CLI (fake executor)

Project: a throwaway `/tmp/measure/proj` (package.json + one JS file + README).
Each scenario used its own `--state-root`, wiped beforehand. All runs used
`--track --assume-defaults` except S5.

Catalog resolved to two models: `cheap` (roles actor/critic, maxComplexity
MEDIUM, `approvedForHighRisk: false`, est. $0.10) and `premium` (roles
actor/critic/judge/router, maxComplexity HIGH, `approvedForHighRisk: true`,
est. $0.50). `policyVersion` was `router-v1-primary` for every decision.

| # | Scenario | Exit | Duration | runId | MODEL_ROUTED | Rejections | Waiting |
|---|---|---|---|---|---|---|---|
| S1 | ordinary code change | 0 | 999 ms | `run_6095d20e-5c4b-4da4-a892-08a440e1d487` | 8 | 0 | no |
| S2 | deploy / credentials | 0 | 963 ms | `run_9afee4a6-2444-43fd-8845-15a85c79a782` | 8 | 8 (`complexity`, `high-risk-approval`) | marked, not honoured |
| S3 | local-only / confidential | 0 | 976 ms | `run_fb3ccec4-1b98-4ea4-8abe-8e2b388216ea` | 8 | 0 | no |
| S4 | vision / screenshot | 0 | 1022 ms | `run_3919cf38-8dbb-4513-bd42-58ff9ebb3dbf` | 8 | 0 | no |
| S5 | same as S1, **no `--track`** | 0 | 939 ms | `run_9ce707c1-612c-4782-b562-28b322a82418` | **0** | 0 | no |

`featureVersion` observed: `assign-v2` and `flowchart-v1` in every tracked run;
none in S5.

### 3.1 Every tracked run routes twice

Each task produces **two** `MODEL_ROUTED` events, from two different planes:

- **assign plane** (`featureVersion: assign-v2`): emitted from
  `startFlowchartRun` replaying `input.assignments`. Carries the real
  `agentRole`, the analyzed `family`, the analyzed `complexity`, the true
  `highRisk`, and the full rejection matrix.
- **flowchart plane** (`featureVersion: flowchart-v1`): emitted when the
  supervisor actually leases the node. This is the decision that **drives
  execution**. It reports `family: "unknown"`, `complexity: MEDIUM`,
  `highRisk: false`, and an empty rejection list on every run measured.

The two planes disagree, and the executing one is the weaker of the two.

### 3.2 Per-scenario routing matrix

**S1 — ordinary change.** Objective: *"Fix the login bug in src/login.js so
empty usernames are rejected"*. The cheap/premium split works as advertised.

| Plane | Role | Family | Complexity | Model | behaviorDistribution |
|---|---|---|---|---|---|
| assign | planner | plan | MEDIUM | `premium` | `{cheap:0, premium:1}` |
| assign | scout | research | LOW | `cheap` | `{cheap:1, premium:0}` |
| assign | implementer | edit | MEDIUM | `cheap` | `{cheap:1, premium:0}` |
| assign | reviewer | review | MEDIUM | `cheap` | `{cheap:1, premium:0}` |
| flowchart | — | unknown | MEDIUM | `premium`, `cheap`, `cheap`, `cheap` | one-hot, matches assign |

**S2 — high risk.** Objective mentions deploy, production, credentials, secrets.

| Plane | Family | Complexity | highRisk | Model | eligibleModels | behaviorDistribution | statusAfterRoute | rejections |
|---|---|---|---|---|---|---|---|---|
| assign (×4) | deploy | HIGH | `true` | `premium` | `["premium"]` | `{premium:1}` | **`WAITING_FOR_USER`** | `complexity`, `high-risk-approval` |
| flowchart (×4) | unknown | MEDIUM | **`false`** | `premium` | **`["cheap","premium"]`** | `{cheap:0, premium:1}` | **`RUNNING`** | none |

`behaviorDistribution` is one-hot in every decision measured (`oneHotDistribution`
over `eligibleModels`), so it records the choice but carries no propensity
information — relevant if Phase 2 wants off-policy estimates from live logs.

All four tasks did go to `premium`, so "全 premium" holds *as an outcome*. But
the reason is not the high-risk filter — it is that `preferredModel` was carried
into the flowchart node. In the executing plane `cheap` is listed as **eligible**
for a high-risk deploy task even though `cheap.approvedForHighRisk === false`.

The approval gate is worse: the assign plane sets `statusAfterRoute:
WAITING_FOR_USER`, but the run **completed without ever waiting** — no
`RUN_WAITING_FOR_USER` event appears in the 35-event stream, and `inspect`
reports `COMPLETED` with `unverified: 0/4`. Source confirms why: children are
compiled with the gate hard-coded off,

```131:131:src/graph/compile-children.ts
      approvalRequired: false,
```

and the supervisor's route call passes no risk context at all:

```684:692:src/supervisor/flowchart-supervisor.ts
        decision = this.router.route({
          taskId: node.taskId,
          role: node.role,
          complexity: this.complexityOf(node),
          modelPolicy: node.modelPolicy,
          confidenceThreshold: node.confidenceThreshold,
          approvalRequired: node.approvalRequired,
          limits: this.routingLimits()
        });
```

No `highRisk`, no `family`, no `privacyRequired`, no `requiredCapabilities`, no
`agentRole`, no `featureVersion`.

**S3 — local-only. Did not fail closed.** Objective: *"Refactor this codebase
locally only; the source is confidential and must never leave the local machine
or be sent to any cloud model"*. The run completed normally and routed exactly
like S1 (`premium`, `cheap`, `cheap`, `cheap`), zero rejections, exit 0. The
implementer's family came out as `refactor`.

The refusal machinery is not broken — it is never invoked. The engine *does*
fail closed when asked:

```
[local-only privacy] REFUSED
    refusals: ["cheap/privacy-class: undeclared privacy class cannot serve local",
               "premium/privacy-class: undeclared privacy class cannot serve local"]
```

But nothing between the CLI objective and the router ever sets
`privacyRequired`. `assignTasks` omits it, so `model-router.ts` applies its
default `"cloud-general"`, and `satisfiesPrivacy` only rejects undeclared models
for `"local"`. There is no phrase a user can type that reaches that branch.

**S4 — vision. No capability rejection.** Objective: *"Look at the attached
screenshot of the dashboard and reproduce that UI layout in the app"*. Routed
identically to S1, zero rejections, exit 0. Same root cause: `analyzeTask`
returns `options.requiredCapabilities ?? ["tool-use"]`, and `assignOne` never
populates that option, so `requiredCapabilities` is `["tool-use"]` for every
task ever routed. Asking the router directly for `vision` does refuse:

```
[vision capability] REFUSED
    refusals: ["cheap/capability: capability not declared: vision",
               "premium/capability: capability not declared: vision"]
```

**S5 — no `--track`.** Confirmed: the plain `run` path emits **zero**
`MODEL_ROUTED` events. The 12-event stream is `PROJECT_DISCOVERED`,
`RUN_CREATED`, `EPISODE_OPENED`, `RUN_ATTACHED`, `RUN_STARTED`,
`AGENT_STARTED`, `AGENT_EVENT` ×3, `AGENT_FINISHED`, `RUN_COMPLETED`,
`EPISODE_CLOSED`. No routing, no cascade, no tracking assessment, no adaptation.
Routing is a `--track`/`--children`/`--flowchart` feature only.

### 3.3 `inspect` cross-check

- `inspect --run <id>` (human): prints run status, project, episode, flowchart
  node states, per-child results, artifacts, evidence, `unverified: 0/4`. It
  shows **no routing information at all** — not the model, not the family, not
  the rejection matrix, not the approval status.
- `inspect --run <id> --json`: emits the raw event stream as JSONL (35 lines for
  a tracked run). All 8 `MODEL_ROUTED` payloads are present with keys
  `agentRole, approvalPlan, behaviorDistribution, coldStartRoutingScore,
  complexity, confidence, eligibleModels, estimatedCostUsd,
  estimatedDurationMs, family, featureVersion, highRisk, justification, model,
  modelVersion, policyVersion, rejections, role, statusAfterRoute, taskId`.

So the routing audit trail exists and is complete in `--json`, but a human using
`inspect` cannot see any of it. `preferredConstraint` is computed by the router
and dropped by `routingContextFields`, so it never reaches the event either —
the one-hot `behaviorDistribution` is the only surviving hint of why a model won.

### 3.4 Determinism and sidecar influence

Three consecutive `--track` runs in one shared `--state-root` produced
byte-identical routing (`planner→premium`, `scout→cheap`, `implementer→cheap`,
`reviewer→cheap`) and `learn: no actionable model-project issue` every time.

`loadLearnedRouting` reads the adaptation registry; with no promoted candidate
it returns `undefined`, so learned routing had **no effect** on any measured run.
`adapt status` confirmed `proposed candidates: 0 (no registry yet)`.

One side effect is worth naming: a live `--track` run **writes bandit state**.
After three runs, `adaptation/learning/projects/p3631166b/bandit.json` held:

```json
{ "arms": ["premium", "cheap"], "pulls": { "premium": 3, "cheap": 9 },
  "rewardSum": { "premium": 3, "cheap": 9 },
  "explorationsUsed": 0, "highRiskExplorations": 0 }
```

This is **write-only**: `updateProjectBandit` in `src/learning/auto-loop.ts` is
the sole caller, and `src/routing/bandit.ts` is imported by nothing except
`bandit-store.ts`. Nothing reads it back into routing, so the "bandit is not in
live" constraint holds. But the data being accumulated is degenerate — under the
fake executor every child returns SUCCESS, so `rewardSum` equals `pulls` exactly
for both arms. Zero variance, zero signal.

## 4. Desirability table

Each row states what was checked and the artifact that shows it.

| Question | Verdict | Evidence |
|---|---|---|
| **Does live routing actually change what runs?** | **Yes, partially — and less than the logs suggest.** | S1 vs S2: planner/scout/implementer/reviewer got `premium/cheap/cheap/cheap` vs `premium/premium/premium/premium`. That is a real behavioural difference driven by the objective text. But the *executing* plane (`flowchart-v1`) routes every node as `family=unknown, complexity=MEDIUM, highRisk=false`; the differentiation survives only because `preferredModel` is threaded through `compileChildrenToFlowchart`. The hard filters that are supposed to enforce it are not applied where execution happens. |
| **Is attribution trustworthy?** | **No, not for quality.** | `utilityDelta` is structurally `0` (`r1-shadow-report.ts:115-123`, both arms assigned the same `utility` variable); measured CI `[0, 0]` over 20 pairs. F-SIM yields cost/action-diff evidence only. `failureClass` exists and is exercised (`failure-class.test.ts`, 7 pass) but F-SIM hardcodes `failureClass: "model"` for every train observation (`simulation-holdout.ts:231`), so the class carries no discriminating information in this path. The bandit rewards collected from live runs are all `1.0` under the fake executor. |
| **Policy alignment — can F-SIM close F-PROD?** | **No. Correctly enforced.** | `canCloseProductionCheckpointF: false` on both `protocol` and `comparison`. `productionCheckpointFOpen` returns `false` whenever `evidenceClass !== "production"`, and `validateComparisonReport` adds *"simulation cannot close production Checkpoint F"*. Verified in the run output, not just the test. |
| **Policy alignment — does live import R1?** | **Holds, with one gap in the guard.** | `routing/r1.js` is imported only by `r1-shadow-report.ts`, `simulation-holdout.ts`, `shadow-compare.ts` — all offline. `simulation-holdout` is imported by nothing but itself. The live-plane test checks 7 files for `simulation-holdout` and `routing/r1` and passes. **However** it does not check `routing/topology.ts` or `routing/bandit.ts`, and a file on its own `LIVE_PLANE` list — `src/run/supervisor.ts` — *does* import `decideTopology`. A separate guard (`live-isolation.test.ts`, 3 pass) covers this by asserting `planTaskTopology` stays "defined but unused in the live loop", so the constraint holds today; it is guarded by a different test than the one that looks like it owns the boundary. |
| **Usability — refusal messages** | **Was broken; minimally fixed on this branch.** | Before: a `local`-privacy refusal and a `vision`-capability refusal both produced *"No allowed model satisfies role actor and complexity MEDIUM"* — naming two constraints that had not failed while hiding the one that had. The CLI renders only `error.message` (`src/cli/errors.ts`) and never touches `RoutingRefusalError.refusals`, so the real cause was unreachable from the terminal. See §5. |
| **Usability — classification coarseness** | **Coarse, with cheap-to-trigger false positives.** | `analyzeTask` is a keyword regex. Measured: *"Speed up the production build so CI finishes faster"*, *"Rename the prod flag in the config reader"*, and *"Write docs explaining how we deploy"* all classify as `family=deploy, complexity=HIGH, highRisk=true, preferPrimary=true` — 3 of 10 probe objectives are false-positive high-risk purely from the words `production`/`prod`/`deploy`. Each false positive forces the whole 4-child cluster onto `premium` (5× the estimated cost of `cheap`). |
| **Usability — the non-`--track` path** | **Silently unrouted.** | S5: plain `run` emits 0 `MODEL_ROUTED` events out of 12. No warning, no note in the output. A user who omits `--track` gets no routing, no tracking assessment, and no adaptation, and the CLI does not say so. |

## 5. Minimal usability fix made on this branch

Kept deliberately separate from the measurement, per the read-only-first
instruction. This is the one change to `src/`.

**Problem.** `createModelRouter` threw a message chosen from three cases:
high-risk, budget/deadline, and an `else` that blamed role and complexity. A
privacy-class or capability refusal fell into the `else`, so the terminal showed
a role/complexity mismatch that had not occurred, while the accurate
`refusals` array was discarded. This blocked the S3/S4 measurements themselves —
there was no way to tell from CLI output which constraint had fired.

**Change.** `src/supervisor/model-router.ts` now builds the message from the
constraints actually present in `refusals`: the high-risk and budget/deadline
headlines are preserved verbatim, role/complexity is used only when `role` or
`complexity` really is among the failures, and every case appends
`; blocked by <constraints> [<modelId>/<constraint>: <detail>; ...]`.

**Result, through the real CLI** (`run --flowchart` with a `judge` node the
catalog cannot serve), exit 1:

```
error: No allowed model satisfies role judge and complexity HIGH; blocked by role, complexity [cheap/role: role judge not declared; cheap/complexity: maxComplexity MEDIUM < HIGH]
```

And through the router directly, the two cases that were previously mislabelled:

```
[local-only privacy] No allowed model satisfies the request constraints; blocked by privacy-class [cheap/privacy-class: undeclared privacy class cannot serve local; ...]
[vision capability]  No allowed model satisfies the request constraints; blocked by capability [cheap/capability: capability not declared: vision; ...]
```

**Regression test.** `test/unit/routing/refusal-message.test.ts`, 4 tests:
privacy names `privacy-class` and no longer blames role/complexity; capability
names the missing capability; high-risk and budget keep their headlines and gain
the constraint list; a genuine role mismatch still reports role and complexity.

**Blast radius.** `flowchart-supervisor.ts` matches routing errors with
`/fits the remaining cost and time limits/i` to fail a node instead of aborting
the run; the fix appends to that headline rather than replacing it, so the match
still holds. Full suite after the change: 1186 pass, 0 fail, 1 skipped.

This fix changes only the wording of an error. It does **not** make S3 or S4
fail closed — those need wiring that does not exist, which is Phase-2 work.

## 6. Anomaly list for Phase 2

Ordered by how much they distort a decision about keep / deepen / replace.

1. **`utilityDelta` is zero by construction, not by measurement.**
   `r1-shadow-report.ts:115-123` assigns the same observed `utility` to both
   arms. No F-SIM run can ever produce quality evidence for or against R1. Any
   plan that says "run more simulation to find out whether R1 is better" is
   unbuildable on this harness as written. Measured CI `[0, 0]` over 20 pairs.

2. **The approval gate is not armed on the path that executes.**
   `compile-children.ts:131` hard-codes `approvalRequired: false`. In S2 the
   assign plane emitted `statusAfterRoute: WAITING_FOR_USER` for all four
   high-risk tasks and the run completed anyway, with no `RUN_WAITING_FOR_USER`
   event. Whether this is intended for `--track` needs an explicit decision; as
   it stands the event stream claims a gate that does not exist.

3. **The high-risk hard filter is not applied in the executing plane.**
   `flowchart-supervisor.ts:684-692` routes with no `highRisk`, `family`,
   `privacyRequired`, `requiredCapabilities`, or `agentRole`. In S2 the
   flowchart plane listed `eligibleModels: ["cheap","premium"]` for a deploy /
   credentials task while the assign plane had correctly narrowed it to
   `["premium"]`. Today `preferredModel` happens to keep the outcome correct.
   That is a coincidence of ranking, not an enforced constraint.

4. **Nothing ever sets `privacyRequired`, so local-only cannot fail closed.**
   S3 completed and routed to cloud models. `satisfiesPrivacy` is correct and
   `assignTasks` simply never passes the field, so the router's
   `"cloud-general"` default applies to every task. There is no user input that
   reaches the `local` branch. Deciding *how* privacy class should be derived
   (contract field? explicit flag? never inferred from prose?) is a Phase-2 call.

5. **Nothing ever sets `requiredCapabilities` beyond `["tool-use"]`.**
   `analyzeTask` accepts the option; `assignOne` never supplies it. S4's vision
   objective produced zero capability rejections. Same shape of gap as #4.

6. **Family / risk misclassification from bare keywords.**
   3 of 10 probes were false-positive high-risk: *"Speed up the production
   build"*, *"Rename the prod flag"*, *"Write docs explaining how we deploy"* →
   `deploy/HIGH/highRisk=true`. Each one forces the full child cluster onto
   `premium`. `analyzeTask` also has no negative-lookaround and no way for a
   user to correct a misclassification. Note `contractRisk` exists as an
   override but `primary-split.ts` never passes it.

7. **Every tracked task is routed twice, and the two decisions disagree.**
   8 `MODEL_ROUTED` events for 4 tasks in all four tracked runs: `assign-v2`
   (rich, correct, advisory) and `flowchart-v1` (degraded, authoritative). Any
   downstream consumer that aggregates `MODEL_ROUTED` — learning signals,
   attribution, the bandit — is reading a stream where half the rows report
   `family: "unknown"` and `highRisk: false` for tasks that are neither.

8. **Live `--track` runs accumulate bandit state that nothing reads.**
   `bandit.json` reached `pulls {premium:3, cheap:9}` after three runs.
   `updateProjectBandit` is the only writer and there is no reader, so the "no
   bandit in live" constraint holds — but under the fake executor
   `rewardSum === pulls` for both arms, so what is being persisted is a
   zero-variance artifact. If this data ever becomes an input, it will be
   poisoned by every fake-executor run that touched the state root.

9. **The live-plane guard test does not cover topology or bandit.**
   `test/integration/m6/simulation-holdout.test.ts` checks 7 files for
   `simulation-holdout` and `routing/r1` only. `src/run/supervisor.ts` is on
   that list and imports `decideTopology`. The actual protection is in
   `live-isolation.test.ts` (a `planTaskTopology` occurrence count). The
   constraint holds; the guard is in a surprising place and is easy to defeat by
   editing a different file.

10. **Sidecar / learned-routing did not affect any measured run — verified, not
    assumed.** Three repeat runs in one state root routed identically;
    `loadLearnedRouting` returns `undefined` with no promoted candidate;
    `adapt status` reported `proposed candidates: 0`. So the CLI numbers above
    are clean. This also means Phase 2 has **no** evidence about what happens
    once a candidate *is* promoted — that path is untested here.

11. **`inspect --run` hides routing from humans.** All the data is in
    `--json`, none of it in the human view. `preferredConstraint` is computed and
    then dropped by `routingContextFields`, so the reason a model won is not
    recoverable from the event stream at all.

12. **Toolchain is below the declared floor.** Node v22.14.0 against
    `engines.node >= 22.19.0`. Every pnpm invocation warns. Nothing failed, but
    no result here is evidence about the supported Node version.

## 7. What this report does not establish

- Nothing about real provider behaviour. No credentials, `PI_SMOKE` unset, fake
  executor only.
- No Outcome-supported claim. Evidence class is `simulation` plus local fake
  runs.
- Checkpoint F-PROD is **not** closed and this report does not argue that it
  should be.
- R1, bandit, and topology were **not** connected to any live path, and this
  branch does not propose connecting them.
