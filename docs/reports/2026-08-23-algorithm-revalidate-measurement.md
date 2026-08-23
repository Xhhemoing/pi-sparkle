# Phase-1 algorithm revalidation measurement — 2026-08-23

**Model slug:** `claude-opus-5-thinking-high-fast`
**Phase:** 1 of 2 — measurement only. No verdict. No new live selector. No R1 / bandit /
topology wired into live.
**Phase 2 owner:** `claude-fable-5-thinking-xhigh` (keep / deepen / replace is theirs, not mine).

**Branch measured:** `cursor/algorithm-revalidate-9035`
**Tree at start of measurement:** `acf034d` (flowchart-v4 + Stage-1 `USER_ANSWER.answeredBy`).
The parent coordinator pushed `af244ca` mid-run; `git diff --name-only acf034d af244ca -- src test`
is **empty** (docs only), so every number below is valid for both. My own fix is `8d98522`.
`origin/cursor/algorithm-revalidate-9035` did not exist when I started; the branch was local
and I pushed it.

**Environment:** Node 22.19.0, pnpm 10.17.1, deterministic **fake executor only**. Zero real
provider calls, zero production episodes, zero sealed holdout, zero legal OPE, zero cluster
spawns fired by a CLI run.

This report is **not** an Outcome-supported claim and **cannot** close Checkpoint F-PROD.
Authorities honoured: [routing final plan](../research/model-routing-final-plan.md),
[ADR-004](../decisions/0004-controlled-adaptation.md),
[adaptive work loop](../specs/adaptive-agent-work-loop.md),
[status matrix](../status-matrix.md).

Companion files on the same tree:
[parent coordinator's independent pass](2026-08-23-algorithm-revalidate-measurement-parent.md)
(agrees with everything I measured that overlaps) and the
[prior cycle's Phase-1 report](2026-08-23-algorithm-measurement.md) at `e06eee6`, which this
supersedes for routing behaviour.

---

## 1. Command table

Durations are wall clock for the whole command including `tsx` startup; `node duration_ms` is
the test runner's own figure. Cluster suites were run as **files**, per the known directory
limitation reproduced in row 4a.

| # | Command | Exit | tests | pass | fail | skip | node duration_ms | wall |
|---|---|---|---|---|---|---|---|---|
| 1 | `pnpm exec tsx --test test/integration/m6/simulation-holdout.test.ts` | 0 | 11 | 11 | 0 | 0 | 176.9 | 0.44 s |
| 1b | same, after my fix in §6 | 0 | **12** | 12 | 0 | 0 | 191.2 | 0.48 s |
| 2 | `pnpm exec tsx --test test/unit/routing/r1.test.ts test/unit/routing/r1-shadow-report.test.ts test/unit/routing/shadow.test.ts test/unit/experiments/shadow-compare.test.ts test/unit/experiments/candidate-shadow.test.ts` | 0 | 50 | 50 | 0 | 0 | 344.6 | 0.62 s |
| 3 | `pnpm exec tsx --test test/acceptance/adaptive-loop.test.ts` | 0 | 2 | 2 | 0 | 0 | 153.0 | 0.42 s |
| 4a | `pnpm exec tsx --test test/integration/cluster/` (**directory**) | **1** | 1 | 0 | **1** | 0 | 139.1 | 0.41 s |
| 4b | `pnpm exec tsx --test test/integration/cluster/dynamic-spawn.test.ts test/integration/cluster/peer-mailbox.test.ts` | 0 | 4 | 4 | 0 | 0 | 269.4 | 0.54 s |
| 5 | 12 routing / supervisor / learning unit files (list below) | 0 | 121 | 121 | 0 | 0 | 716.9 | 0.99 s |
| 6 | `pnpm gate` **before** my change | 0 | 1190 | 1189 | 0 | 1 | 16460.8 | 27.3 s |
| 7 | `pnpm gate` **after** my change | 0 | **1191** | **1190** | **0** | 1 | 16197.5 | 26.8 s |
| 7a | `pnpm typecheck` | 0 | — | — | — | — | — | 3.47 s |
| 7b | `pnpm lint` | 0 | — | — | — | — | — | 3.53 s |
| 7c | `pnpm build` | 0 | — | — | — | — | — | 3.10 s |

Row 5 files: `test/unit/routing/{analyze-task,assign,feature-version,high-risk-filter,live-isolation,failure-class,r0}.test.ts`,
`test/unit/supervisor/{flowchart-router,flowchart-supervisor}.test.ts`,
`test/unit/learning/{signals,auto-loop,task-success}.test.ts`.

**Row 4a is a runner limitation, not an algorithm failure.** Verbatim:
`Error [ERR_UNSUPPORTED_DIR_IMPORT]: Directory import '/workspace/test/integration/cluster' is not
supported resolving ES modules imported from /workspace/`. It fires in the Node ESM resolver
before any test loads. Row 4b runs the same two files explicitly and all four tests pass. This
reproduces both the prior cycle's finding and the parent coordinator's.

The single skip in rows 6 and 7 is
`PiAgentExecutor completes a run against a real provider # SKIP set PI_SMOKE=1 …` — the opt-in
real-provider smoke, expected to skip here. Row 7 is +1 test over row 6: the regression test I
added with the fix in §6.

---

## 2. Real local CLI runs

Isolated temp project `/tmp/m1/proj` (a `package.json`, a `README.md`, one `src/billing.ts`,
`git init`), a separate state root per scenario. All runs
`--executor fake --track --assume-defaults` unless noted.

| # | Scenario | Objective | Exit | runId | Events | `MODEL_ROUTED` | Routed models | Wall |
|---|---|---|---|---|---|---|---|---|
| R1 | Ordinary | "Refactor the billing helper and add a unit test" | 0 | `run_c81f5cce-3c51-46d3-8665-fc561b6cc85c` | 41 | 10 | planner→**premium**; scout / implementer / reviewer / tester→**cheap** | 0.75 s |
| R2 | High-risk | "Deploy payment credentials to production" | 0 | `run_8838e0fd-fc0e-4ea9-aa82-70f6988b2f83` | 43 | 8 | all four roles→**premium** | 0.74 s |
| R3 | Local-only | "Refactor billing; this must stay local" | **1** | none written | — | — | refused before any run | 0.67 s |
| R4 | Vision | "Look at this screenshot and fix the padding" | 0 | `run_769f61e7-934f-4109-b629-a524588d9c66` | 35 | 8 | all four roles→**premium** | 0.73 s |

Two extra probes of the same high-risk objective, because `--assume-defaults` conflates two
separate consents (clarification answers and the routing gate):

| # | Variant | Exit | runId | Events | `MODEL_ROUTED` | Children run | Terminal status |
|---|---|---|---|---|---|---|---|
| R2b | `--track` only, no `--assume-defaults` | 0 | `run_e89faa1f-b4a2-43e2-8864-97de6474f3d8` | 7 | 0 | 0 | `WAITING_FOR_USER` at **clarification**, before routing |
| R2c | `--track --answers answers.json`, **no** `--assume-defaults` | 0 | `run_8593439e-0efd-4a5b-bf3d-94f1f3bcf2ba` | 13 | 6 | **0** | `WAITING_FOR_USER` at the **high-risk gate** |

R2c is the important one: it proves the gate is load-bearing rather than cosmetic. Routing
completed for five tasks, the first flowchart-v4 node armed the gate, and the run halted with
**zero `CHILD_RUN_CREATED` events**. `--assume-defaults` is exactly what converts that halt into
four auto-consents.

`pnpm cli inspect --run <id> --state-root <root> --json` succeeded for the completed runs.

### R1 — ordinary, per-event detail (all 10 `MODEL_ROUTED`)

```
assign-v4     planner     family=plan      MEDIUM  premium  highRisk=false  RUNNING  rej=0
assign-v4     scout       family=research  LOW     cheap    highRisk=false  RUNNING  rej=0
assign-v4     implementer family=refactor  MEDIUM  cheap    highRisk=false  RUNNING  rej=0
assign-v4     reviewer    family=review    MEDIUM  cheap    highRisk=false  RUNNING  rej=0
assign-v4     tester      family=test      LOW     cheap    highRisk=false  RUNNING  rej=0
flowchart-v4  planner     family=plan      MEDIUM  premium  highRisk=false  RUNNING  rej=0
flowchart-v4  scout       family=research  MEDIUM  cheap    highRisk=false  RUNNING  rej=0
flowchart-v4  implementer family=refactor  MEDIUM  cheap    highRisk=false  RUNNING  rej=0
flowchart-v4  reviewer    family=review    MEDIUM  cheap    highRisk=false  RUNNING  rej=0
flowchart-v4  tester      family=test      MEDIUM  cheap    highRisk=false  RUNNING  rej=0
```

Every event carried `agentRole`, and `behaviorDistribution` was a genuine one-hot over the
eligible set in all 26 `MODEL_ROUTED` events I collected across R1/R2/R4.

**Tester family on ordinary flowchart-v4: confirmed correct.** The tester node records
`agentRole=tester`, `family=test`, and the reviewer records `agentRole=reviewer`, `family=review`.
The prior cycle's A5 (8 of 10 events collapsing to `family: "test"`, reviewer included) is fixed
on this tree. Five distinct families across five children.

### R2 — high-risk, rejection matrix verbatim

```json
{"family": "deploy", "featureVersion": "flowchart-v4", "modelVersion": "premium-v1",
 "model": "premium", "highRisk": true, "complexity": "HIGH",
 "eligibleModels": ["premium"], "behaviorDistribution": {"premium": 1},
 "statusAfterRoute": "WAITING_FOR_USER", "policyVersion": "router-v1-primary",
 "agentRole": "planner",
 "rejections": [
   {"modelId": "cheap", "constraint": "complexity", "detail": "maxComplexity MEDIUM < HIGH"},
   {"modelId": "cheap", "constraint": "high-risk-approval", "detail": "model is not approved for high-risk tasks"}]}
```

**The two live paths now agree on the gate.** `assign-v4`: 4 / 4 `WAITING_FOR_USER`.
`flowchart-v4`: 4 / 4 `WAITING_FOR_USER`. The prior cycle's A3 (flowchart says `RUNNING` while
assign says `WAITING_FOR_USER`, deploy work completing with no gate) and A4 (contradictory
approval records in one log) are both fixed. Source: `routeFlowNode` now passes
`approvalRequired: node.approvalRequired || analysis.highRisk` (`src/supervisor/model-router.ts:378`).

The run recorded 4 `RUN_WAITING_FOR_USER` and 4 `USER_ANSWER`, every one of them:

```json
{"messageId": "msg_3c7df29e-…", "answer": "Selected route:premium",
 "approvalReply": {"approvalPlanId": "approval:tsk_d7c68a07-…:premium",
                   "selectedActionIds": ["route:premium"]},
 "answeredBy": "assume-defaults-auto"}
```

**Consent is labelled honestly.** `ANSWER_SOURCES = ["user", "assume-defaults-auto"]`
(`src/run/events.ts:159`), the schema validator rejects any other value (line 547), and the flag
path passes `"assume-defaults-auto"` explicitly (`src/run/flowchart-run.ts:634`). A human answer
via `pi-sparkle answer` writes `answeredBy: "user"` (`src/cli/main.ts:1226`). Nothing in these
runs let a machine consent masquerade as a person.

### R3 — local-only refusal (exit 1, no run written)

```
error: No allowed model satisfies privacy class (cheap: cloud-general cannot serve local; premium: cloud-general cannot serve local)
```

Correct fail-closed, and it names the constraint that actually bound. `analyzeTask` derived
`privacyRequired: "local"` from "must stay local" with no contract flag.

### R4 — vision now routes instead of refusing

```
x8 cheap|capability|capability not declared: vision
```

`premiumCatalogModel()` declares `capabilities: ["tool-use", "vision"]`
(`src/routing/primary-catalog.ts:43`), so the vision objective is now routable — the prior
cycle's A2 is half-fixed. `cheap` is correctly excluded on `capability`, all four children go to
`premium`, and the run completes. Note the cost consequence in anomaly **A2** below.

### Cluster spawn under the fake CLI: none, as expected

Zero `SPAWN` / `CLUSTER` / `DEREGISTER` / `PEER` events across all six runs. `createClusterHost`
is constructed but the fake executor never issues a spawn request, so `onSpawn` never fires.
Cluster behaviour in §4 is therefore measured by direct probes and the four integration tests,
not by CLI runs.

---

## 3. Adversarial probes — I did not trust the tests

Every result below is from running the live functions directly, not from reading assertions.

### 3.1 `extraSignals` cannot forge `failureClass` or `taskSuccess` — with one caveat

```
failureClass=model (subagent)                       REJECTED: extraSignals cannot forge failureClass
failureClass=environment (subagent)                 REJECTED: extraSignals cannot forge failureClass
criterion=taskSuccess, source=user                  REJECTED: extraSignals cannot forge criterion taskSuccess
criterion=taskSuccess, kind=human, source=subagent  REJECTED: extraSignals cannot forge criterion taskSuccess

parseOutcomeObservation:
  taskSuccess + source=human            REJECTED: taskSuccess requires source deterministic-check
  taskSuccess + source=peer             REJECTED: taskSuccess requires source deterministic-check
  taskSuccess + source omitted          REJECTED: taskSuccess requires source deterministic-check
  failureClass="vibes"                  REJECTED: outcome observation failureClass is invalid

observationsForR1: 11 rows in, 2 kept
  kept: taskSuccess / PASS  / (no class) / deterministic-check
  kept: taskSuccess / FAIL  / model      / deterministic-check
  dropped: FAIL+environment, FAIL+run, FAIL+tool, FAIL+contract, FAIL+no class,
           ABSTAIN, UNOBSERVED, userAcceptance/human, policyCompliance/peer
```

Replaying R2's real 43-event log through `collectSignalsFromEvents` produced 4 signals, all
`subagent / deterministic / taskSuccess / PASS`, and **0 user-sourced `taskSuccess`** — despite
the log containing 4 `USER_ANSWER` events. Tracking and human scores stay out.

**The caveat, which is a real finding.** The literal-field guard holds, but the derivation
behind it does not fail closed. `parseObservedSignal` rejects a supplied `failureClass`, then
re-derives one from caller-supplied prose via `classifyTaskFailure`, whose default for
FAIL-with-no-recognised-hint is `model`. Measured end to end against the real bandit store:

```
parseObservedSignal({source:"subagent", kind:"deterministic", criterion:"taskSuccess",
                     outcomeKind:"FAIL", summary:"it produced nonsense", modelId:"premium"})
  -> ACCEPTED, failureClass derived = model

bandit after 1 honest PASS:   pulls={premium:1}  rewardSum={premium:1}   mean 1.00
bandit after 1 prose-only FAIL: pulls={premium:2} rewardSum={premium:1}  mean 0.50
```

Changing only the prose to `"http 429 too many requests"` derives `environment` and the
posterior does **not** move. So the attribution decision for `extraSignals` FAILs is made by a
regex over a string the caller wrote, with `model` as the fallback. Scope limits the severity:
`extraSignals` is a library parameter on `runAutoAdaptLoop`, not a CLI flag or a protocol
message, and the bandit is adaptation-plane only — live routing reads the promoted
routing-policy, never this file. It is still the one place where ADR-004's "only attributable
`taskSuccess` with `failureClass === "model"` may lower a posterior" rests on prose rather than
on evidence. Logged as **A5**.

### 3.2 429 / transport / `TASK_TIMEOUT` are non-model

`classifyTaskFailure`, 21 cases:

```
httpStatus 429 / 500 / 503                       -> environment
transportCode ECONNRESET / ETIMEDOUT / ENOTFOUND -> environment
timedOut (TASK_TIMEOUT)                          -> run
protocolViolation                                -> run
summary "rate-limited" / "too many requests"     -> environment
failure.category TOOL_ERROR                      -> tool
failure.category TIMEOUT                         -> run
failure.category VALIDATION                      -> contract
acceptance-omission prose                        -> contract
verification PASSED / outcome SUCCESS            -> undefined
plain FAILED, no evidence                        -> model

agent claims MODEL_ERROR + httpStatus 429        -> environment   <- runtime outranks self-report
agent claims MODEL_ERROR + ECONNRESET            -> environment   <- runtime outranks self-report
agent claims MODEL_ERROR + timedOut              -> run           <- runtime outranks self-report
agent claims MODEL_ERROR, no runtime evidence    -> model
```

The provenance ordering holds in all three adversarial cases: an agent that self-reports
`MODEL_ERROR` cannot override runtime-observed transport or timeout evidence.

### 3.3 F-SIM: `observedUtilityOnBothArms`, delta ≡ 0, and selection disagreement

`src/routing/r1-shadow-report.ts:123-131` assigns the **same** observed label to both arms:

```123:131:src/routing/r1-shadow-report.ts
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

I ran `runSimulationHoldout` on four datasets chosen to break it if anything could:

| Dataset | train | holdout | selectionDisagreement | rate | invoked | utilityDelta mean / SE / 95 % CI | costDelta mean / 95 % CI |
|---|---|---|---|---|---|---|---|
| A mixed labels | 68 | 30 | **30** | 1.0000 | 0 | 0 / 0 / **[0, 0]** | +0.0448 / [0.0448, 0.0448] |
| B holdout **all PASS** | 68 | 30 | **30** | 1.0000 | 0 | 0 / 0 / **[0, 0]** | +0.0448 / [0.0448, 0.0448] |
| C holdout **all FAIL** | 68 | 30 | **30** | 1.0000 | 0 | 0 / 0 / **[0, 0]** | +0.0448 / [0.0448, 0.0448] |
| D large n | 400 | 400 | **400** | 1.0000 | 0 | 0 / 0 / **[0, 0]** | +0.0448 / [0.0448, 0.0448] |

`observedUtilityOnBothArms = true`, `protocol.evidenceClass = "simulation"`,
`protocol.canCloseProductionCheckpointF = false`, `comparison.canCloseProductionCheckpointF = false`,
`claims = ["仿真证据"]` in every case. Flipping every holdout label from all-PASS to all-FAIL, and
raising n by 13×, moves the utility delta by exactly nothing.

**Confirmed, and this is the decisive F-SIM fact.** The zero is structural, not empirical.
Decision 1 of the routing final plan needs a utility-delta 95 % lower bound strictly above zero;
this harness returns a lower bound of exactly zero for every possible input, and its cost CI
lower bound is positive (+0.0448), which independently blocks a "cheaper" claim too.

What the harness *does* measure honestly: selection disagreement (100 % here — the train
posterior moves R1 off R0 on every holdout pair), contamination resistance (it refuses an
implicit split, rejects a holdout hash that also appears in train, and holdout labels that would
reverse the posterior never reach R1), holdout-vault audit, and claim suppression.

### 3.4 Live isolation, verified transitively rather than textually

I built the actual transitive `.ts` import graph from the real entrypoint `src/cli/main.ts`
(static + dynamic imports, 154 unique modules):

| Module | Reachable from CLI entrypoint | Shortest chain |
|---|---|---|
| `src/routing/r1.ts` | **no** | — |
| `src/routing/shadow.ts` | **no** | — |
| `src/routing/r1-shadow-report.ts` | **no** | — |
| `src/routing/posterior.ts` | **no** | — |
| `src/routing/propensity.ts` | **no** | — |
| `src/routing/offline-logit.ts`, `offline-prob-add.ts`, `drift.ts` | **no** | — |
| `src/experiments/simulation-holdout.ts`, `shadow.ts`, `shadow-compare.ts`, `canary.ts` | **no** | — |
| `src/routing/bandit.ts` | yes | `cli/main.ts → learning/auto-loop.ts → learning/bandit-store.ts → routing/bandit.ts` |
| `src/routing/topology.ts` | yes | `cli/main.ts → run/supervisor.ts → routing/topology.ts` |
| `src/experiments/replay.ts` | yes | `cli/main.ts → learning/auto-loop.ts → adaptation/promotion.ts → adaptation/eval-routing.ts → experiments/replay.ts` |

Call-site scan across all 154 reachable modules: `routeR1(`, `chooseArm(`, `selectShadow(` and
`runSimulationHoldout(` have **no call site anywhere in the live graph**. `planTaskTopology(`
appears exactly once — its own definition in `src/run/supervisor.ts:64`, never invoked. The three
reachable modules are all adaptation-plane, behind `adapt` / post-run learning, and none of them
influences a model selection.

**The invariant holds. Its guard still does not prove it.**
`test/unit/routing/live-isolation.test.ts` greps a hardcoded 10-file allowlist for five import
substrings, against a 154-module live graph. It would not catch a new live file, a transitive
import, or a re-export. Logged as **A7**.

---

## 4. Cluster lifecycle, measured directly

Constants read back from the live module, then every boundary exercised through
`validateSpawn` and a real `createClusterHost`:

```
MAX_SPAWN_DEPTH = 2     MAX_SPAWNS_PER_PARENT = 4

fan-out allowlist (derived by probing, not by reading the table):
  planner     -> worker, debugger, scout, implementer, reviewer, tester
  worker      -> scout, reviewer, tester
  debugger    -> scout, tester
  scout / implementer / reviewer / tester -> (leaf: no delegation)

depth 0 ALLOWED   depth 1 ALLOWED   depth 2 REFUSED   depth 3 REFUSED
spawnsByParent 0..3 ALLOWED         spawnsByParent 4, 5 REFUSED
liveTaskCount 7 / maxTasks 8 ALLOWED    liveTaskCount 8 / maxTasks 8 REFUSED
parentCanDelegate=false REFUSED     empty objective REFUSED
unknown child role 'architect' REFUSED  planner -> planner REFUSED (no recursion)
```

Host lifecycle, on a real `ClusterHost`:

```
register planner@d0 + reviewer@d1, unicast planner -> reviewer      reviewer inbox = 1
deregister(complete)   -> role queue 0, successor inbox 0     (undrained mail is consumed)
deregister(handoff)    -> role queue 1, successor inbox 1     (mail follows the retry)
   successor body: "rerun the suite after the fix"
deregister(unknown id) -> no throw                            (teardown cannot crash)
host.spawn x5 from one planner -> 4 ALLOWED, 5th REFUSED "parent already spawned 4 children"
onSpawn fired 4 times: scout@d1, tester@d1, tester@d1, tester@d1
```

Deregistration is dispositioned rather than a bare removal, and the handoff path genuinely
re-queues undrained peer mail so a retry of the same role inherits it. Every limit fails closed
with a specific message.

---

## 5. Desirability scores

Grounded in the numbers above. Not intent, not vibes.

| Algorithm | Live decision quality | Attribution trustworthiness | Policy alignment (ADR-004, no live R1) | Usability |
|---|---|---|---|---|
| **R0 + flowchart routing** (`analyzeTask`, `assignTasks`, `routeFlowNode`, `ModelRouter`) | **desirable** | **desirable** | **desirable** | **mixed** |
| **Cluster lifecycle** (spawn depth, fan-out, deregister, peer mail) | **desirable** | **desirable** | **desirable** | **mixed** |
| **Self-feedback / adaptation** (`failureClass`, signals, auto-loop, CAS promotion) | **mixed** | **mixed** | **desirable** | **desirable** |

### Routing — decision quality: desirable

Routing measurably changes what runs, and the two live paths now agree. Cost profile across a
five-child plan on the shipped fake catalog (`cheap` $0.10, `premium` $0.50; all-cheap = $0.50,
all-premium = $2.50):

| Objective | Total | Gated | Assignment |
|---|---|---|---|
| ordinary refactor + test | **$0.90** | 0 / 5 | planner premium, other four cheap |
| "Add a null check to the parser" | **$0.90** | 0 / 5 | planner premium, other four cheap |
| "Review the pull request and leave nits" | **$0.90** | 0 / 5 | planner premium, other four cheap |
| deploy credentials to production | **$2.50** | **5 / 5** | all premium, `cheap` rejected twice per task |
| "Look at this screenshot…" | **$2.50** | 0 / 5 | all premium, `cheap` rejected on `capability` |
| "Prove the invariants…" | **$2.50** | 0 / 5 | all premium (reasoning escalates complexity) |
| "…must stay local" | refused | — | both models rejected on `privacy-class` |

Ordinary work is 36 % of the all-premium cost; risk and capability escalate deterministically,
each with a recorded rejection matrix. Filtering runs through one shared matrix,
`evaluateLiveCandidate` (`src/routing/policy.ts`), used by both `routeFlowNode` and `assignOne`.
Upgraded from *mixed* in the prior cycle because the family key now separates roles (5 distinct
families across 7 roles on 6 of 8 objectives, versus a collapse to `test` before) and the
high-risk gate arms on the executed path.

### Routing — attribution: desirable

All 26 `MODEL_ROUTED` events carried `family`, `featureVersion`, `modelVersion`, `highRisk`,
`eligibleModels`, `rejections`, `agentRole`, and a one-hot `behaviorDistribution`. No `unknown`
family fallback appeared in any run.

### Routing — policy alignment: desirable

§3.4: R1, shadow, posterior, propensity and simulation-holdout are all unreachable from the CLI
entrypoint; the three reachable adaptive modules have no live call site.

### Routing — usability: mixed

Refusals name the real constraint (R3, R4) rather than a generic role/complexity mismatch — the
prior cycle's fix holds, and the two load-bearing wordings are still intact. What keeps this
mixed: the run summary for R2 printed `COMPLETED` with no mention that **four high-risk approval
gates were armed and auto-cleared**. The only record is `events.jsonl`. An operator running
`--assume-defaults` unattended gets no signal that a deploy-flavoured objective tripped the gate
four times (**A3**).

### Cluster — decision quality: desirable, usability: mixed

Every limit in §4 fails closed with a specific message, no recursion, no orphaned mail. Upgraded
from *mixed* because I exercised the full lifecycle rather than only the limits table. Usability
stays mixed for two reasons: the limits are static constants with no project calibration, and no
CLI run under the fake executor fires a single spawn, so the whole subsystem is exercised only by
tests and direct probes — there is no end-to-end production evidence for it at all.

### Adaptation — decision quality: mixed

The loop reaches a real conclusion on every run (`no actionable model-project issue` on R1 / R2 /
R4, `no feedback to learn from` on the gate-blocked R2c) and `--track` genuinely loads a promoted
policy via `loadLearnedRouting`, so a promoted candidate would change later routing. Mixed
because nothing was proposed on any of these runs: the decision-changing path was not exercised
end to end by a real run, only by unit tests.

### Adaptation — attribution: mixed (downgraded from the prior cycle)

Everything in §3.1 and §3.2 that the policy names explicitly holds, and holds under adversarial
probing. I downgrade to mixed for one measured reason: the derived-`failureClass` path in §3.1
lets caller-supplied prose set `model` by default and move a posterior. The guard's *name*
("extraSignals cannot forge failureClass") is broader than what it enforces.

### Adaptation — policy alignment: desirable

`runAutoAdaptLoop` returns `promoted: false` on every branch and its doc comment states
`autoPromote` is ignored (`src/learning/auto-loop.ts:71`). Promotion stays behind
`adapt promote --approve`. Proposal-first CAS, as ADR-004 requires. Self-review alone proves
nothing here because the loop cannot promote at all.

### Adaptation — usability: desirable

The `learn:` line always renders a conclusion, the kill switch still collects, and the
gate-blocked run degrades to `no feedback to learn from` rather than erroring.

---

## 6. The one blocking measurement bug I fixed

**Symptom.** The task asks me to report `observedUtilityOnBothArms` and `selectionDisagreement*`
from F-SIM. I could not. `runSimulationHoldout` returned only
`{comparison, pairs, protocol}` — I had to recompute disagreement from `pairs` by hand, and
`observedUtilityOnBothArms` was unreachable from that entrypoint entirely.

**Why it blocks truthful numbers.** `buildR1ShadowReport` already computes all three fields and
documents them as "the honest F-SIM fact". `runSimulationHoldout` destructured `comparison` and
`pairs` off the shadow report and dropped the rest. A caller measuring F-SIM through the
simulation entrypoint therefore sees `utilityDelta.mean === 0` with no adjacent indication that
the zero is structural. That reads as *a measured tie between two arms* when the truth is *no
counterfactual outcome was ever modelled*. Same class as the prior cycle's refusal-message bug:
the system knew the real reason and did not tell the caller.

**Fix** (`8d98522`, `src/experiments/simulation-holdout.ts`): forward
`observedUtilityOnBothArms`, `selectionDisagreementCount` and `selectionDisagreementRate` onto
`SimulationHoldoutResult`. Verified after the change:

```
keys on SimulationHoldoutResult: comparison, pairs, observedUtilityOnBothArms,
                                 selectionDisagreementCount, selectionDisagreementRate, protocol
observedUtilityOnBothArms: true      selectionDisagreementCount: present
canCloseProductionCheckpointF: false
```

One regression test added in `test/integration/m6/simulation-holdout.test.ts` pinning the flag,
the zero delta, and agreement between the reported count/rate and `pairs`.

**Constraints honoured.** No `analyzeTask` or sensor change, so `ASSIGN_FEATURE_VERSION` stays
`assign-v4` and `FLOWCHART_FEATURE_VERSION` stays `flowchart-v4` (a bump would have been required
otherwise). `src/supervisor/flowchart-supervisor.ts` is untouched; both load-bearing refusal
strings are byte-identical — `"No allowed model is approved for high-risk tasks"` and
`"No allowed model fits the remaining cost and time limits"`, the latter still matched by
`flowchart-supervisor.ts:688` to fail one node instead of the whole run. `git diff --name-only
af244ca HEAD` is exactly two files, neither in `src/routing/` or `src/supervisor/`. No new
selector, no R1 / bandit / topology in live. Full gate green after the change: **1191 tests,
1190 pass, 0 fail, 1 skip, 26.8 s**.

---

## 7. Anomalies Phase 2 must not ignore

| # | Severity | Finding |
|---|---|---|
| **A1** | **high** | **F-SIM is informationally empty on the main gate, and no dataset can change that.** `baselineUtility === candidateUtility` by construction. Measured across four datasets including all-PASS, all-FAIL and n = 400: utility delta 0, SE 0, 95 % CI [0, 0] every time, while selection disagreement was 100 %. Decision 1 needs a lower bound strictly above zero. Any Phase-2 plan whose evidence step is "run more simulation" is dead on arrival. The only routes to a utility signal are real paired production outcomes, or an explicitly validated counterfactual outcome model — and the latter needs its own ADR. |
| **A2** | **high** | **A capability or risk keyword anywhere in the shared run objective escalates every child.** Under `--track` all children see the same objective text. "screenshot" put `vision` in `requiredCapabilities` for all five roles including the planner and the scout, forcing every child to `premium`: **$2.50 versus $0.90, a 2.8× cost increase** for a task where only the implementer plausibly needs to see the image. "Prove the invariants…" does the same via HIGH complexity. Deploy does it via `highRisk`. The escalation is correct *for the task*; applying it to every sibling is the defect. |
| **A3** | **medium** | **The auto-cleared high-risk gate is invisible in the run summary.** R2's stdout says `COMPLETED` and lists routed models. It does not say that four approval gates armed and were auto-consented. Worse, `makeApprovalPlan` marks `Use <model>` as `defaultSelected: true` and `Do not run this task` as `false`, so `--assume-defaults` always resolves a high-risk gate toward *proceed*. The event log is honest (`answeredBy: assume-defaults-auto`); the operator-facing surface is silent. |
| **A4** | **medium** | **`assign-v4` and `flowchart-v4` record different complexity for the same task in the same run.** `defaultComplexity` floors flowchart nodes at MEDIUM (`flowchart-supervisor.ts:211`) and `routeFlowNode` takes `maxComplexity(node, analysis)`, so scout and tester are LOW on assign-v4 and MEDIUM on flowchart-v4 — visible in R1's real event log. On the shipped two-tier catalog this is label-only. On a three-tier catalog with a LOW-only model I measured it becoming a **model change for 2 of 7 roles** (scout and tester: `tiny` $0.02 → `cheap` $0.10, 5× per task) with the preferred model held identical, so the complexity floor is the sole cause. Complexity is a hard-filter input and part of the R1 isolation context; two live paths must not disagree about it. |
| **A5** | **medium** | **`extraSignals` attribution is decided by caller-supplied prose, defaulting to `model`.** The literal-field guard fires as documented, but `parseObservedSignal` then re-derives `failureClass` from `summary`, and `classifyTaskFailure`'s fallback for an unrecognised FAIL is `model`. Measured: a prose-only FAIL moved a real bandit arm from mean 1.00 to 0.50; the same signal with "429" in the prose did not. Bounded scope — library parameter, adaptation plane only, live routing never reads the bandit — but it is the only place where ADR-004's attribution rule rests on a string rather than on evidence. |
| **A6** | **medium** | **The generic edit roles still inherit the objective's keyword family.** Role-first classification fixed reviewer / tester / scout / planner, but `implementer`, `debugger` and `worker` fall through to text. "Verify the invoice totals and validate the QA coverage report" labels all three `family: "test"`; the deploy objective collapses all seven roles to `family: "deploy"`. `family` is the R1 data-isolation key, so this is posterior contamination, not cosmetics. Materially better than the prior cycle (5 distinct families across 7 roles versus 1), but not closed. |
| **A7** | low | **The live-isolation guard is a 10-file textual allowlist against a 154-module live graph** (§3.4). The invariant it is supposed to protect currently holds; the test does not prove it and would not catch a new live file, a transitive import, or a re-export. |
| **A8** | low | **`flowchart-supervisor.ts:688` branches on a regex over an error message** to decide whether to fail one node or the whole run. Behaviour-critical control flow coupled to prose. Pinned by a test and deliberately preserved here, but the coupling remains. |
| **A9** | low | **`test/integration/cluster/` cannot be passed to `tsx --test` as a directory** (`ERR_UNSUPPORTED_DIR_IMPORT`, reproduced in row 4a). Any CI invocation using the directory form reports a false failure. `pnpm test` is unaffected. |
| **A10** | low | **A plain `pnpm cli run` emits no `MODEL_ROUTED` at all.** Live routing exists only on `--track`, `--flowchart` and `--children`. Anyone measuring "does routing do anything" from a plain run will conclude, wrongly, that it does nothing. |

### Fixed since the prior cycle — do not re-litigate

The prior report's A3 (high-risk gate never armed on the executed path), A4 (contradictory
approval records in one log) and A5 (`family` collapsing to `test`, reviewer included) are all
fixed on this tree and I re-verified each from real event logs, not from tests. A2 (vision
unroutable) is half-fixed: `premium` now declares `vision`, so the objective routes; the
sibling-escalation cost remains as my A2. A1 (refusal messages naming the wrong constraint) holds
fixed, confirmed by R3 and R4.

---

## 8. What this data does and does not claim

**It does claim, on fake-executor evidence:**

1. Live routing changes execution measurably and deterministically. Ordinary work costs 36 % of
   all-premium; deploy work escalates every child to `premium` with a two-row rejection matrix per
   task; privacy and capability refusals fail closed and name the binding constraint.
2. The high-risk human gate is armed on the executed path and is load-bearing. R2c proves a run
   halts at the gate with zero children executed, and `--assume-defaults` is precisely what
   converts that halt into four machine consents labelled `assume-defaults-auto`.
3. The attribution boundary named in ADR-004 survives adversarial probing: forged `failureClass`,
   forged `taskSuccess`, human-sourced `taskSuccess`, 429s, transport errors and timeouts all stay
   out of R1, and runtime evidence outranks agent self-report. With the A5 caveat, which is real
   and bounded.
4. No adaptive selector influences a live model choice — verified transitively across the whole
   154-module live graph, not by grep.
5. Cluster limits fail closed at every boundary, and deregistration disposition genuinely
   controls whether undrained peer mail follows a retry.
6. F-SIM's utility delta is identically zero by construction, invariant to label distribution and
   sample size.

**It does not claim, and must not be read as claiming:**

1. **This is not Checkpoint F-PROD and cannot become it.** `evidenceClass` is `simulation`,
   `canCloseProductionCheckpointF` is a hard-coded `false` on both the protocol and the comparison
   report. Simulation ≠ production.
2. **This is not an Outcome-supported claim.** Zero real provider calls, zero production
   episodes, zero sealed holdout, zero legal OPE.
3. **No verdict.** I am not saying keep, deepen or replace. That is Phase 2's call, and it belongs
   to `claude-fable-5-thinking-xhigh`.
4. **No quality claim about any model or any selector.** F-SIM structurally cannot support one
   (A1), and I ran no experiment that could.
5. **No claim about cluster behaviour in production.** Not one CLI run fired a spawn; §4 is direct
   probes plus four integration tests.
6. **No claim that self-review proves PASS.** Nothing here was promoted, and `runAutoAdaptLoop`
   cannot promote.
7. **The measured costs are fake-catalog list prices** ($0.10 / $0.50 per task), not observed
   spend. Ratios are meaningful; absolute dollars are not.

**Leverage order for whoever acts on this**, per the final plan
(eligibility → features / version isolation → outcome attribution → experiment identifiability):
A2 and A6 are feature-quality problems and sit earliest; A4 is a version-isolation problem; A5 is
outcome attribution; A1 is experiment identifiability and is the one that no amount of additional
simulation can move.

---

## 9. 中文总结

本次为 Phase 1 复测，只做测量，不给结论，不新建 live 选择器，也未把 R1 / bandit / topology
接入 live。测量树为 `cursor/algorithm-revalidate-9035` @ `acf034d`（父协调者中途推送的
`af244ca` 仅改文档，`src`/`test` 零改动），模型 slug 为 `claude-opus-5-thinking-high-fast`。
全量 `pnpm gate` 在我改动后通过：**1191 项测试，1190 通过、0 失败、1 跳过**（需
`PI_SMOKE=1` 的真实 provider 冒烟），耗时 26.8 秒。`test/integration/cluster/` 目录形式仍报
`ERR_UNSUPPORTED_DIR_IMPORT`，按文件运行 4/4 全过——这是运行器限制，不是算法故障。

六次真实 CLI（fake executor）确认 live 路由确实改变执行：普通改动五个子任务中四个走
`cheap`（$0.90，仅为全 premium 的 36 %）；"部署生产支付凭据"把全部子任务升到 `premium`
（$2.50）并逐条记录 `cheap` 的拒绝矩阵；"必须留在本地"正确 fail-closed 并指名 `privacy class`；
"看这张截图"因 `premium` 已声明 `vision` 而可路由。上一轮的三项主要缺陷已修复并经真实事件日志
复核：高风险人工门现在在**真正执行的路径**上武装（`assign-v4` 与 `flowchart-v4` 均为
`WAITING_FOR_USER`，不再自相矛盾），`family` 也不再塌缩成 `test`。关键证据是 R2c：只给
`--answers` 不给 `--assume-defaults` 时，路由完成 6 条但**零个子任务启动**，运行停在门上；
`--assume-defaults` 才把它转成四次机器同意，且全部标注 `answeredBy: assume-defaults-auto`。

归因边界经对抗性探测依然可信：伪造 `failureClass`、伪造 `taskSuccess`、human 来源的
`taskSuccess`，以及 429 / 传输错误 / `TASK_TIMEOUT` 全部进不了 R1，且运行时证据优先于 agent
自报。隔离性用**从 CLI 入口做的 154 模块传递闭包**验证（非文本 grep）：R1、shadow、posterior、
propensity、simulation-holdout 均不可达，`planTaskTopology` 仅有定义无调用。

Phase 2 不可忽视的要点：**F-SIM 在主门上恒为空**——`baselineUtility` 与 `candidateUtility`
被赋成同一观测标签，我用全 PASS、全 FAIL、n=400 四组数据实测，utility delta 恒为
0、95 % CI 恒为 [0, 0]，而选择分歧率恒为 100 %，故决策 1 要求的 LCB > 0 结构上永不可达，
再多仿真也无用。其次，共享 objective 中的任一能力/风险关键词会连坐升级所有子任务
（截图场景 $0.90 → $2.50，2.8 倍）。第三，`assign-v4` 与 `flowchart-v4` 对同一任务记录不同
complexity，在三档目录下实测导致 7 个角色中 2 个换模型。第四，`extraSignals` 的
`failureClass` 由调用方散文经正则推导且默认落到 `model`，实测可把 bandit 后验从 1.00 压到
0.50（仅影响 adaptation 平面，live 不读 bandit）。

我只修了一个阻塞"取真实数字"的缺陷：`runSimulationHoldout` 计算了
`observedUtilityOnBothArms` 与 `selectionDisagreementCount/Rate` 却在返回前丢弃，使调用方只看到
`utilityDelta.mean === 0`，误读为"实测打平"而非"根本没有反事实结果模型"。已转发这三个字段并加
回归测试。未改 `analyzeTask` 或任何 sensor，故 `assign-v4` / `flowchart-v4` 无需升版；
`flowchart-supervisor.ts` 未触碰，两条承重拒绝措辞逐字保留。以上全部为 fake executor 证据，
**不构成 Outcome-supported 声称，也不能关闭 Checkpoint F-PROD**。
