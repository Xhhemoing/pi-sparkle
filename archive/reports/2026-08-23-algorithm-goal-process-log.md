# Algorithm goal process log — 2026-08-23

Purpose: record every phase, actor / model slug, action, and measured result
for simulate → decide keep/deepen/replace → cross-validate/polish until the
pi-sparkle algorithms are usable. **Not** an Outcome-supported claim. Does
**not** close Checkpoint F-PROD.

## Actors

| Role | Model slug | Notes |
|---|---|---|
| Parent coordinator | `cursor-grok-4.6` | This run. Cross-validate + polish. Goal owner. |
| Phase 1 measurement | `claude-opus-5-thinking-high-fast` | Cloud subagent: simulate + real-test, collect data |
| Phase 2 strategy | `claude-fable-5-thinking-xhigh` | Cloud subagent: keep / deepen / replace from data + plan purpose |

Prior independent campaign (other run, tree `e06eee6` / 9035 branches) is
**background only**. This goal re-measures the merged tree
`cursor/merge-inactive-slices-f31b` @ `10d08a5`.

## Phase 0 — goal armed

- **Actor:** `cursor-grok-4.6`
- **Action:** `/goal` created; process log started; branched
  `cursor/algorithm-eval-goal-f31b` from `origin/cursor/merge-inactive-slices-f31b`
  (`10d08a5`).
- **Result:** Goal active. 9035 algorithm agent still RUNNING — those branches
  are not write targets. Message queue empty at start.

## Phase 1 — measurement

### 1a. Parent local measurement — `cursor-grok-4.6`

- **Action:** this turn: algorithm suites + isolated fake-executor CLI on `10d08a5`.
- **Result:** filling below as commands finish.

### 1b. Cloud measurement — `claude-opus-5-thinking-high-fast`

- **Actor:** [算法模拟与真实测试](baccafb1-96a1-4dd7-ab9e-5862c8a84081)
- **Action:** launched 2026-08-23; independent re-measure of
  `cursor/merge-inactive-slices-f31b`. Branched
  `cursor/algorithm-goal-measure-f31b` from `10d08a5`. Did not touch the
  `*-9035` branches. Fake executor only — `PI_SMOKE` unset and no provider
  credential present, so the real-provider path was never exercised.
- **Deliverable:** `docs/reports/2026-08-23-algorithm-goal-measurement.md`
  (command table, CLI table, F-SIM numbers, desirability table, 12-item anomaly
  list). Environment: Node v22.14.0 vs `engines.node >= 22.19.0` — one minor
  below the declared floor, warned on every pnpm call, nothing failed.

- **Result — suites.** F-SIM integration 11/11; `r1-shadow-report` 8/8;
  `routing/shadow` 11/11; `shadow-compare` 1/1. Algorithm units all green:
  analyze-task 3, assign 4, flowchart-router 15, signals 3, auto-loop 8,
  cluster mailbox 2, cluster spawn 2, acceptance adaptive-loop 2. Wider routing
  sweep (11 files incl. r0 20, r1 17, topology 15, live-isolation 3) all green.
  Cluster directory import reproduces `ERR_UNSUPPORTED_DIR_IMPORT`, so per-file
  invocation is mandatory. Whole repo after this branch's fix:
  `pnpm typecheck` clean, `pnpm lint` clean, `pnpm test` **1186 pass / 0 fail /
  1 skipped** out of 1187.

- **Result — F-SIM (fresh run, `scripts/measure/simulation-holdout-drive.ts`,
  68 train / 20 holdout).** `evidenceClass: simulation`;
  `canCloseProductionCheckpointF: false` on both protocol and comparison;
  claims reduced to `["仿真证据"]`. **`utilityDelta.mean = 0`, CI `[0, 0]`,
  SE 0** — and this is *structural*, not empirical: `r1-shadow-report.ts:115-123`
  assigns the same observed `utility` to `baselineUtility` and
  `candidateUtility`, so no F-SIM run can ever yield quality evidence.
  **`costDelta.mean = +0.03136 USD`, CI `[0.02213, 0.04059]`** — R1 is a
  strict cost regression on this fixture. R0-vs-R1 divergence **14/20 = 70 %**,
  with 6 `r1Fallback` (the `docs` family, unseen in train). `invoked: false`
  everywhere. `pi-sparkle adapt status` already states this limitation aloud,
  so behaviour and documentation agree.

- **Result — real CLI (fake executor, isolated `--state-root` per scenario).**
  All five runs exit 0. S1 ordinary → `planner premium / scout cheap /
  implementer cheap / reviewer cheap` (the cheap/premium split is real).
  S2 deploy+credentials → all four `premium`, family `deploy`, `HIGH`,
  8 rejections (`complexity`, `high-risk-approval`). S3 local-only → **did not
  fail closed**, routed to cloud exactly like S1, 0 rejections. S4 vision →
  **no capability rejection**, routed like S1. S5 without `--track` → **0
  `MODEL_ROUTED` events** out of 12, confirming routing is a
  `--track`/`--children`/`--flowchart` feature only. `featureVersion` observed:
  `assign-v2` and `flowchart-v1`. Three repeat runs in one shared state root
  were byte-identical, and `loadLearnedRouting` returned `undefined`
  (`adapt status`: `proposed candidates: 0`), so **sidecar / learned-routing did
  not influence any measured run**.

- **Result — the four structural findings Phase 2 must price in.**
  (i) Every tracked task is routed **twice** and the two decisions disagree:
  the `assign-v2` event is rich and correct but advisory, while the
  `flowchart-v1` event that actually leases the node reports
  `family: "unknown"`, `complexity: MEDIUM`, `highRisk: false` and an empty
  rejection matrix. (ii) The **approval gate is not armed** —
  `compile-children.ts:131` hard-codes `approvalRequired: false`, and S2
  completed with no `RUN_WAITING_FOR_USER` despite the assign plane emitting
  `statusAfterRoute: WAITING_FOR_USER` for all four tasks. (iii) The
  **high-risk hard filter is absent from the executing plane** —
  `flowchart-supervisor.ts:684-692` passes no `highRisk`/`family`/
  `privacyRequired`/`requiredCapabilities`, so S2's flowchart rows listed
  `cheap` as *eligible* for a credentials task; the correct outcome came from
  `preferredModel` ranking, not from enforcement. (iv) **Privacy and capability
  are never wired**: `assignTasks` never sets `privacyRequired` (router default
  `cloud-general`) and `assignOne` never sets `requiredCapabilities` (always
  `["tool-use"]`), which is exactly why S3 and S4 could not fail closed. The
  engine itself is correct — probing the router directly with `privacyRequired:
  "local"` or `requiredCapabilities: ["vision"]` **does** refuse.

- **Result — additional anomalies.** `analyzeTask` keyword matching produced
  false-positive high-risk on 3 of 10 probes (*"Speed up the production
  build"*, *"Rename the prod flag"*, *"Write docs explaining how we deploy"* all
  → `deploy/HIGH/highRisk=true`), each forcing the whole child cluster onto
  `premium`. Live `--track` runs **write** `bandit.json`
  (`pulls {premium:3, cheap:9}` after three runs) but nothing reads it —
  `routing/bandit.ts` has no importer besides `bandit-store.ts`, so the
  no-bandit-in-live constraint holds, though under the fake executor
  `rewardSum === pulls` makes the collected data zero-variance. The live-plane
  guard in the F-SIM integration test checks only `simulation-holdout` and
  `routing/r1`; `src/run/supervisor.ts` is on that list and does import
  `decideTopology`, with the real protection living in `live-isolation.test.ts`.
  `inspect --run` shows humans no routing at all (it is all in `--json`), and
  `preferredConstraint` is computed then dropped by `routingContextFields`.

- **Result — one minimal usability fix, kept separate from the measurement.**
  Routing refusals rendered as *"No allowed model satisfies role X and
  complexity Y"* even when the actual blockers were `privacy-class` or
  `capability`; since the CLI prints only `error.message` and never reads
  `RoutingRefusalError.refusals`, the real constraint was unreachable from the
  terminal — which blocked the S3/S4 measurement itself. `model-router.ts` now
  derives the message from the constraints actually present, preserving the
  high-risk and budget/deadline headlines (the supervisor still matches
  `/fits the remaining cost and time limits/i`) and appending
  `blocked by <constraints> [<model>/<constraint>: <detail>]`. Regression test
  `test/unit/routing/refusal-message.test.ts` (4 tests). Verified end-to-end
  through the CLI at exit 1. **This changes wording only — S3 and S4 still do
  not fail closed.**

- **Policy compliance:** R1 / bandit / topology were **not** connected to live.
  No Outcome-supported claim is made. **Checkpoint F-PROD remains open.**
  No `*-9035` branch was modified.

## Phase 2 — strategy — `claude-fable-5-thinking-xhigh`

- **Actor:** cloud subagent, slug `claude-fable-5-thinking-xhigh`.
- **Action:** branched `cursor/algorithm-goal-strategy-f31b` from
  `origin/cursor/algorithm-goal-measure-f31b` (Phase-1b report + refusal-message
  fix included). Read the authoritative plan
  (`docs/research/model-routing-final-plan.md` lever order), ADR-004, ADR-005,
  the work-loop spec, the status matrix, and both Phase-1 reports; re-verified
  every load-bearing claim against source (`r1-shadow-report.ts:115-123`,
  `compile-children.ts:131`, `flowchart-supervisor.ts:684-692`,
  `assign.ts`/`analyze-task.ts` wiring gaps, `signals.ts:139-157`
  last-write-wins, `auto-loop.ts:106-108` bandit write path). Docs only — no
  P0 implementation, per instructions.
- **Deliverable:** `docs/reports/2026-08-23-algorithm-goal-strategy.md`.
- **Result — verdict.** **Keep** the selection algorithms (R0 live hard filter
  + preferred→cost→id ranking, proposal-first adaptation plane, F-SIM honesty
  labels, live isolation, one-hot behaviorDistribution, the refusal-message
  fix). **Deepen** eight measurement/wiring items: double routing (execution
  plane inherits task analysis), arming the approval gate, high-risk hard
  filter on the executing plane, explicit fail-closed privacy/capability
  inputs, keyword false positives via `contractRisk` precedence (not an LLM
  classifier), bandit write-provenance hygiene, machine-readable
  none-by-construction labeling on F-SIM reports, and the three small
  observability/guard holes. **Replace: nothing.** New analytic point: the
  F-SIM `costDelta +0.031` and `utilityDelta 0` are two faces of the same
  instrument defect (the quality channel is blind), so the numbers justify
  neither cutting R1 nor promoting it — keep shadow, fix the instrument
  (F2→F6). One new poisoning path confirmed: `collectSignalsFromEvents` is
  last-write-wins over `MODEL_ROUTED`, so the degraded `flowchart-v1` events
  overwrite `family` to `unknown` in every learning signal.
- **Result — checklist.** P0×3 (thread analysis into the executing plane; arm
  the approval gate with `--assume-defaults` not waiving it; explicit
  privacy/capability inputs), P1×7, each with files, this round's data, and
  the cost of not doing it. Suggested Phase-3 order:
  P0-1 → P0-2 → P0-3 → (P1-2, P1-3 cheap add-ons) → P1-1 → P1-4 → P1-5/6/7,
  with re-run expectations for S2/S3/S4/S5 and the 10-probe set.
- **Policy compliance:** R1 / bandit / topology not wired to live; no
  Outcome-supported claim; Checkpoint F-PROD stays open; no `*-9035` branch
  touched; no PR opened.

## Phase 3 — cross-validate + polish — `cursor-grok-4.6`

- **Actor:** parent coordinator, slug `cursor-grok-4.6`.
- **Action:** branched `cursor/algorithm-goal-polish-f31b` from
  `cursor/algorithm-goal-strategy-f31b` (`1fdfff1`). Implemented P0-1 (execution
  plane inherits task analysis), P0-2 (arm high-risk approval gate;
  `--assume-defaults` does not waive it), P0-3 (explicit `--privacy` /
  `--require-capability`, never inferred from prose). Cheap add-ons: P1-2
  (auto-loop stops writing `bandit.json` unless `persistBandit: true`), P1-3
  (`qualityEvidence: none-by-construction` on constructed-utility comparison
  reports), P1-5 (plain `run` prints that routing/tracking is off). Did not
  change R1/bandit/topology live wiring. Did not bump `assign-v2` (classifier
  unchanged). Did not implement P1-1 / P1-4 / P1-6 / P1-7.
- **Result — verification.** `pnpm typecheck` clean; `pnpm lint` clean;
  `pnpm test` **1196 pass / 0 fail / 1 skipped**; `pnpm build` clean;
  `pnpm security:probe` `{ status: "ok", passed: 10, openFindings: [] }`.
  Cross-validate flips (strategy §7):
  - S2 deploy+credentials + `--assume-defaults` → `WAITING_FOR_USER`,
    `RUN_WAITING_FOR_USER` present, every `MODEL_ROUTED` has
    `family: deploy`, `highRisk: true`, `eligibleModels: ["premium"]`.
  - S3 `--privacy local` → exit 1, message names `privacy-class`.
  - S4 `--require-capability vision` → exit 1, message names `capability`.
  - S5 plain `run` → stderr note that routing/tracking is off; no
    `MODEL_ROUTED` in the printed summary.
  - 10-probe false positives **not** flipped (P1-1 deferred; `assign-v2`
    unchanged).
- **Policy compliance:** R1 / bandit / topology still not live. Bandit
  writes are now opt-in (`persistBandit`). No Outcome-supported claim.
  Checkpoint F-PROD stays open. No `*-9035` branch touched. PR creation
  still fails (`must be a collaborator`); branch
  `cursor/algorithm-goal-polish-f31b` is pushed.
