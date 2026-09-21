# Evidence-first phase implementation and evaluation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Each task produces a separately reviewable deliverable.

**Goal:** Move pi-sparkle from implemented-and-exercised capability to a narrowly bounded, reproducible evidence claim about cost per independently accepted task, without weakening evaluator, privacy, routing, or apply boundaries.

**Architecture:** The phase has two distinct control planes. A read-only evaluation plane freezes task, runtime, evaluator, policy, and provider identities before the projection pilot. A separate change-control plane binds candidate snapshots, evaluator bundles, approvals, and idempotent apply/reconciliation before any write-tool registration. Projection remains default-off and run-local; real-provider evidence is opt-in and claim-scoped.

**Tech Stack:** TypeScript/Node ≥22.19, pnpm, Pi 0.86.1 adapter, content-addressed SHA-256 observation storage, JSONL event/telemetry records, Git worktrees and revisions, deterministic/fake executors for development, opt-in real Pi providers for acceptance.

## Global Constraints

- No code or plan in this phase may claim `Outcome-supported` from local fake, loopback, synthetic lifecycle, or author-only evidence.
- R1/bandit/topology remain shadow/offline; the live path reads only a versioned, hash-verified promoted routing-policy snapshot.
- Projection stays disabled by default; no CLI wiring before the B-versus-C evidence gate.
- The A/B/C pilot is exploratory: it can detect large regressions and estimate cost scale, but cannot by itself establish strict non-inferiority or broad generalization.
- The write-tool and automatic candidate application remain blocked until the R10/R11 evaluator/apply boundary review and owner authorization close.
- The authoritative evaluator bundle is not writable by a candidate in the proposed production design; candidate-supplied tests are evidence, not the sole authoritative verdict.
- Missing provider usage is unknown, never zero. Provider, authentication, quota, retry, timeout, and runtime failures remain visible in task-level cost and failure taxonomy.
- Cross-session observation-counter persistence is out of scope for this phase. Cross-tenant observation sharing is never allowed.
- Real-provider, crash, benchmark, and holdout runs are opt-in and require a durable evidence record with the exact command/configuration and evidence class.
- Existing user changes, ignored worktree content, privacy deletion rules, and frozen additive-only CLI/event/JSON contracts must be preserved.

---

## Identity

- ID: `TASK-20260921-evidence-first-phase`
- Owner: main agent session for documentation/test work; owner approval required at explicit policy, budget, capability, and public-claim gates
- State: `planned` — amended 2026-09-21 from the deep-research report; submitted for expert re-review
- Date opened: 2026-09-21
- Related: [external review disposition](../../reports/2026-09-21-external-review-disposition.md); [deep-research amendment](../../reports/2026-09-21-deep-research-plan-amendment.md); [native Pi plan](2026-09-18-native-pi.md); [status matrix](../../status-matrix.md); [projection plan](2026-09-20-native-observation-projection.md).

## Problem and Scope

### Problem

The runtime and native slices are implemented and locally exercised, but no
capability is Outcome-supported. The current projection evidence is synthetic,
real-provider end-to-end acceptance is opt-in, and the apply path's evaluator
identity is not yet bound strongly enough for a production change-control
claim. Adding more agent features before measuring a bounded real outcome would
increase surface area without resolving the central product question:

> Can the system lower the total cost of an independently accepted task while
> preserving evidence integrity and a reproducible approval/apply chain?

The supplied research report proposes positioning pi-sparkle as a vendor-neutral
**Evidence & Change Control Runtime** around coding agents. This is a strategic
hypothesis for review, not an approved README/product claim.

### Mainline sequence

1. **Review-channel decision and independent review dispatch** *(owner gate;
   no silent fallback)*. Record an approved cross-failure-domain reviewer path,
   material scope, budget, credential authority, and audit trail. Then dispatch
   apply-registration, delegate-routing, and projection reviews separately,
   each bound to its own commit, acceptance criteria, and verdict.
2. **Read-only evaluator freeze** *(proposed hard prerequisite to the live
   pilot)*. Freeze the task/evaluator/runtime/policy identity used to judge A/B/C
   outcomes. The evaluator bundle must be outside candidate write scope and
   content-addressed. This does not require write-tool registration or a full
   distributed transaction; it prevents a pilot result from depending on a
   mutable acceptance definition.
3. **Projection hardening and measurement instrumentation** *(engineering
   gate; can proceed while item 1 is blocked)*. Add full SHA-256 counter keys,
   typed projectability metadata or an explicit fail-closed fallback, cumulative
   recall budgets, lifecycle/prefix tests, and mechanism/economic/outcome
   telemetry.
4. **Pilot preregistration and budget approval** *(owner gate)*. Freeze task
   strata, groups, provider/model/version, repo revisions, tool permissions,
   evaluator digest, environment, cost accounting, thresholds, stopping rules,
   and data handling before live calls.
5. **Exploratory real-provider A/B/C pilot** *(opt-in)*. Compare native Pi,
   pi-sparkle projection-off, and the identical pi-sparkle configuration with
   projection-on. Use approximately 30 distinct tasks and 2–3 repeats per
   task, with task-level pairing and predeclared strata.
6. **Pilot decision and confirmatory design** *(owner evidence gate)*. A pilot
   can authorize a larger 100–200 distinct-task confirmation only if its
   integrity and quality guardrails pass. It cannot by itself create a broad
   Outcome-supported claim.
7. **CLI wiring decision** *(evidence gate)*. Wire projection into CLI paths
   only if the predeclared B-versus-C result supports a benefit with no
   unacceptable quality/integrity regression.
8. **Full evaluator/apply boundary and write-tool registration** *(last)*.
   Close R10/R11, bind immutable candidate/evaluator/runtime/policy/result
   identities, implement crash reconciliation/idempotency, obtain independent
   review and owner authorization, then consider write registration.

### Out of scope

- F6/F-PROD execution, sealing, or live adaptive selection. F6 remains an
  independent line with an owner, decision date, restart conditions, budget,
  and degrade/abandon rule still to be supplied.
- M7 SFT/preference/RL infrastructure. Only data qualification may be
  assessed.
- Cross-session or cross-tenant observation counter persistence.
- A general coding-agent UI, IDE, model, or provider feature race.
- Final product positioning, commercial pricing, staffing, or regulatory
  conclusions without owner and deployment-specific decisions.

## Acceptance Criteria

### Evidence and boundary gates

- [ ] An approved (or explicitly refused) independent review path is recorded
  with model, credential authority, budget, material scope, failure domain, and
  switch audit trail; no silent fallback is used.
- [ ] The three pending independent reviews are dispatched separately, each
  with a frozen commit, scope, commands, acceptance criteria, and verdict. A
  batch may share transport but may not collapse the conclusions into one PASS.
- [ ] A read-only pilot evaluator manifest is frozen before live calls. It
  names the task-set version, repo/revision set, evaluator bundle digest,
  runtime/tool schema, routing-policy version, provider/model/version, budget,
  environment, and data-retention class. The candidate cannot modify the
  evaluator bundle used to issue the result.
- [ ] R10/R11 full apply design records the minimum capability identity:
  `runId`, tenant/repo identity, base revision, immutable candidate-tree
  digest, evaluator-bundle digest, evaluator-result digest, runtime identity,
  tool-schema digest, policy digest, approval identity, issue/expiry times, and
  idempotency/apply key. Any identity change invalidates the capability and
  requires a new evaluation/approval. Exact signing and snapshot mechanism
  remain expert-review decisions, not assumed implementation facts.
- [ ] Apply recovery design covers `PREPARED → VERIFIED → AUTHORIZED → APPLIED
  → RECEIPTED`, duplicate/replay requests, candidate/evaluator mutation, base
  advancement, post-mutation/pre-receipt crash, and disposal/delete races. The
  design states explicitly which external side effects Git rollback cannot
  undo.

### Projection hardening and telemetry

- [ ] The send counter uses the full content SHA-256; same-path mutation and
  head/tail/length collision cases have tests. Counter state remains run-local.
- [ ] Projectability is typed where the tool surface permits it:
  `resultKind=observation`, `!isError`, `!mutatesState`, `!securityCritical`,
  and `toolPolicy.projectable`; absent metadata fails closed. Error results,
  evidence/verification receipts, permission results, secret-bearing output,
  state-mutating results, and write-tool results are not projected.
- [ ] Existing evidence-marker detection remains fail-closed until typed
  metadata is available; marker-containing ordinary text is never packed.
- [ ] Recall retains its per-page byte/line caps and adds cumulative per-run
  byte/token, page-count, and call-count budgets. Budget exhaustion returns an
  explicit typed result and never silently truncates evidence/receipt metadata.
- [ ] Recall-after-source-mutation returns the archived hash-verified snapshot;
  recall after run deletion fails closed; post-resume counter reset behavior is
  documented and tested; no cross-run id is accepted.
- [ ] Two consecutive projected provider requests preserve an append-only
  message prefix; no prior history or thinking block is rewritten.
- [ ] Mechanism telemetry records `repeatMass`, projection count, archived
  bytes, placeholder bytes, recall calls/pages/bytes, budget refusals, and
  storage-unavailable fallbacks.
- [ ] Economic telemetry keeps input, cached input, output, retries, failed
  attempts, runtime/sandbox compute, wall time, and human correction time
  separate. Missing usage is unknown.

### Pilot and decision gates

- [ ] Before data collection, a preregistration freezes A/B/C, task strata,
  pairing/randomization, model/provider versions, repo revisions, permissions,
  evaluator digest, budget, environment, primary/secondary metrics, thresholds,
  stopping rules, and retention/data-transfer policy.
- [ ] Groups are exactly: A = native Pi single-agent baseline; B = pi-sparkle
  with frozen routing and projection off; C = identical B with projection on.
  B→C is the projection effect; A→B is the aggregate runtime effect.
- [ ] The pilot contains approximately 30 distinct tasks × 2–3 repeats and
  reports task-level pairing. Repeats are not counted as independent tasks.
  Strata are fixed before execution and include task type, language/repository
  size, context size, test duration, and expected repeat-observation mass.
- [ ] The primary platform metric is **provider/runtime cost per independently
  accepted task**, including failed attempts and retries. All-in cost including
  human correction time is reported separately and never hidden.
- [ ] The report includes independent acceptance rate, correction time, wall
  time, repeat mass, failure taxonomy, evidence-integrity incidents, and full
  environment/provider usage records. Provider/auth/quota/runtime failures are
  not relabeled as model failures.
- [ ] Pilot thresholds are frozen before calls. Proposed values for expert/owner
  review are: advance signal ≥10% C-vs-B cost improvement without material
  quality/integrity regression; stop signal near −10 percentage points in
  acceptance; zero critical evidence-integrity failures. Proposed confirmation
  target is approximately 15% cost improvement with a predeclared non-inferiority
  margin near −5 percentage points, subject to pilot variance and power analysis.
  These are hypotheses, not current project facts.
- [ ] A pilot report explicitly states that non-significance is not proof of
  non-inferiority. A passed pilot may authorize a 100–200 distinct-task
  confirmation with paired/hierarchical analysis; it does not by itself add an
  Outcome-supported status row.
- [ ] A first narrow Outcome-supported claim, if any, receives a separate owner
  evidence approval and names task-set/repo revisions, pi-sparkle commit,
  provider/model/version, tool/routing policy, evaluator digest, budget,
  environment, cost and acceptance estimates, uncertainty, and limitations.
- [ ] CLI wiring is either implemented only after the B-vs-C evidence gate or
  explicitly declined with a durable reason. Write registration is not started
  before R10/R11 closure.
- [ ] F6 receives a durable decision node: named owner, next decision date,
  restart prerequisites, maximum investigation budget, and degrade/abandon rule.

## Implementation Slice

| Task / file or symbol | Deliverable | Gate / risk |
|---|---|---|
| `docs/reports/2026-09-21-deep-research-plan-amendment.md` | Research provenance, adopted changes, proposed-vs-fact boundary | Complete; expert review pending |
| `docs/superpowers/specs/2026-09-21-readonly-evaluator-manifest.md` | Immutable pilot evaluator manifest schema and freeze procedure | Must precede live pilot; no write capability required |
| `src/pi-adapter/observation-tools.ts`, `src/pi-adapter/native-executor.ts`, `src/context/observation-store.ts`, focused tests | SHA-256 counter, typed/fail-closed projectability, cumulative recall budgets | Default-off; preserve disabled-path bytes and privacy cascade |
| `src/native/apply-registration.ts`, `src/native/apply.ts`, `src/native/write-session.ts`, boundary tests | R10/R11 capability identity and reconciliation design/implementation | Must precede write registration; candidate cannot define authoritative evaluator |
| `docs/superpowers/specs/2026-09-21-projection-measurement.md` | Metric schema, repeat-mass, cost attribution, missing-usage policy | Must freeze before pilot |
| `docs/reports/2026-09-21-ab-c-pilot-preregistration.md` | Task strata, A/B/C assignment, thresholds, stopping rules, budget/data policy | Owner budget/evidence gate |
| `scripts/` or existing experiment/telemetry surfaces | Live pilot collection and report generation | Opt-in provider and privacy approval |
| `docs/reports/` + `docs/status-matrix.md` | Pilot report, CLI decision, narrowly scoped claim if earned | Separate owner evidence gate; no overclaim |

## Test-First and Verification Plan

### Local hardening

- Red tests: SHA-256 counter collision; marker-containing content; explicit
  `isError`; snapshot after source mutation; delete-after recall; resume reset;
  cumulative recall budget; append-only provider prefix; routing policy mutation
  does not change live output.
- Focused command:
  `pnpm test test/unit/pi-adapter test/unit/context test/unit/native test/unit/routing`
- Full local gate:
  `pnpm gate`
- Preview/security boundary probes:
  `pnpm security:probe && pnpm pi:probe`
- Workflow record:
  `pnpm workflow:check`

### Pilot verification

- No live run starts before the evaluator manifest, preregistration, owner
  budget approval, and data-transfer/retention decision are recorded.
- Live acceptance command and exact environment are recorded in the pilot
  report; loopback tests remain separate evidence class.
- The report must include raw task-level ledger references or content hashes,
  not only aggregate percentages. Any excluded task/run requires a recorded
  reason decided before outcome inspection.
- If a provider fails, the run is classified and costed; it is not silently
  retried outside the manifest or dropped from the denominator.

## Gates and Handoff

- **Owner/policy gates:** cross-failure-domain review path; read-only pilot
  evaluator freeze; provider budget/data-transfer approval; threshold
  preregistration; CLI wiring decision; full R10/R11 closure; first public
  Outcome-supported claim; F6 decision node.
- **Engineering autonomy:** unit tests, typed/fail-closed projection,
  run-local SHA-256 counter, recall budgets, telemetry schema, and loopback
  fault injection within the approved scope.
- **Rollback/abort:** any live-isolation allowlist change; any critical
  evidence-integrity failure; any unmanifested provider/data path; any pilot
  quality loss beyond the predeclared stop threshold; any candidate/evaluator/
  runtime identity drift after verification.
- **Required durable records:** expert re-review verdicts, evaluator manifest,
  measurement spec, pilot preregistration, task-level ledger, pilot report,
  CLI decision, apply boundary review, F6 decision, and status-matrix update.
- **Next handoff:** after expert review, split accepted work into separate
  implementation plans for (a) projection hardening and (b) evaluator/apply
  boundary; do not implement both as one unreviewed broad change.

## Closeout

- Verified commit/date: pending expert re-review and owner decisions.
- Commands/outcomes: pending; existing projection baseline is recorded in
  `docs/reports/2026-09-20-native-observation-projection.md`.
- Open risks: relay failure domain; evaluator semantic binding; real-provider
  cost/data handling; sample-size/power uncertainty; F6 external materials;
  SCM/xhh PR #36 evidence gap.
- Evidence links: [research amendment](../../reports/2026-09-21-deep-research-plan-amendment.md), [external review disposition](../../reports/2026-09-21-external-review-disposition.md), [projection verification](../../reports/2026-09-20-native-observation-projection.md).
