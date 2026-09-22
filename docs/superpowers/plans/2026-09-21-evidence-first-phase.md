# Evidence-first phase coordination plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to execute the four child plans separately. Do not implement the pilot and apply-boundary work as one unreviewed change.

**Goal:** Move pi-sparkle from implemented-and-exercised capability to a narrowly bounded, reproducible evidence claim about cost per independently accepted task without weakening evaluator, privacy, routing, or apply boundaries.

**Architecture:** This is a coordination plan over four independently reviewable
plans: projection hardening/telemetry, a read-only evaluator manifest, an
exploratory A/B/C pilot, and the full evaluator/apply boundary. The boundary
plan has a **Stage 0 design/freeze** that must precede the read-only manifest
and live pilot, while its **Stage 1 implementation/authorization** remains a
later change-control gate. Stage 0 does not register or authorize writes.
Projection remains default-off and run-local; live-provider evidence is opt-in
and claim-scoped.

**Tech Stack:** TypeScript/Node ≥22.19, pnpm, Pi 0.86.1 adapter, opaque-id observation storage with exact-byte comparison, JSONL event/telemetry records, Git worktrees/revisions, deterministic fake executors, and opt-in real Pi providers.

## SHA-256 removal prerequisite (2026-09-21)

[ADR-008](../../decisions/0008-remove-sha256.md) is now the accepted successor contract for identity surfaces: opaque versioned locators and exact-byte comparison, with no cryptographic tamper guarantee. This coordination plan still does not authorize a pilot, provider call, apply, or freeze; Stage 0 remains draft-only until independent review and owner approval.

## Global Constraints

- No local fake, loopback, synthetic lifecycle, or author-only result is `Outcome-supported` evidence.
- Author-run verification, independent review, human/owner approval, and outcome evidence are four separate evidence classes; one never substitutes for another.
- `sparkle_apply_candidate` is already registered and wired as a host-facing, handle-only apply surface. It is **not production-authorized** until the R10/R11 independent review and owner approval close.
- `NativeWriteSession`/worker write registration is a separate library capability and is not registered in the Pi extension or default CLI. Automatic write-to-apply chaining is also not registered.
- No new worker-write capability, automatic chaining, or production apply authorization claim may proceed before the full evaluator/apply boundary gate closes. The existing host-facing registration is an R10/R11 hardening/authorization subject, not an absent feature.
- Projection is disabled by default. No CLI projection wiring precedes the B-versus-C evidence gate.
- R1/bandit/topology remain shadow/offline; live routing reads only a versioned promoted routing-policy snapshot whose canonical bytes are checked exactly in local-weak mode.
- The A/B/C pilot is exploratory. Approximately 30 distinct tasks cannot establish strict non-inferiority or broad generalization.
- Arm identity is scoped per arm, not assumed globally identical: A is native Pi
  with learned sparkle routing disabled; B and C share the same frozen tuple.
  Common evaluator/task/repository constraints are shared, but runtime identity
  and tool schemas may differ. C's recall tool is an intentional declared
  difference, not a claim of complete schema identity. Every ledger row carries
  the opaque `armManifestId`.
- F6/F-PROD is not closed, started, sealed, or substituted by this phase. The pilot cannot enable live adaptive selection or reuse F6 holdout/pricing evidence.
- M7 training infrastructure is out of scope; only data qualification may be assessed.
- Missing provider usage is unknown, never zero. Provider, authentication, quota, retry, timeout, and runtime failures remain visible.
- Cross-session observation-counter persistence and cross-tenant observation sharing are out of scope/prohibited.
- Real-provider, crash, benchmark, and holdout runs are opt-in and require an exact durable evidence record.
- Existing privacy deletion rules, user changes, ignored files, and frozen additive-only CLI/event/JSON contracts are preserved.

## Identity

- ID: `TASK-20260921-evidence-first-phase`
- Owner: main agent for documentation/test work; owner approval is required at policy, budget, capability, and public-claim gates
- State: `planned` — amended after the deep-research report and expert review on 2026-09-21
- Date opened: 2026-09-21
- Related: [expert review record](../../reports/2026-09-21-evidence-first-plan-expert-review.md); [research amendment](../../reports/2026-09-21-deep-research-plan-amendment.md); [native Pi plan](2026-09-18-native-pi.md); [status matrix](../../status-matrix.md); [external disposition](../../reports/2026-09-21-external-review-disposition.md).

## Current capability-state vocabulary

Every plan and status record must use these distinctions:

1. **Host-facing apply registration:** `sparkle_apply_candidate` is present and
   wired in `extensions/pi-sparkle/index.ts`; it accepts only a host-issued
   handle and reconstructs trusted bytes from a persisted artifact.
2. **Worker write registration:** `NativeWriteSession` exists as a library
   capability, but no worker write tool is registered in the extension/default
   CLI.
3. **Authorization:** neither registration nor local tests grants production
   permission to apply candidates or chain writes automatically. Existing apply
   use remains pending R10/R11 independent review and owner authorization.

The R10/R11 review is therefore prospective hardening and authorization review
of an existing apply surface, not a claim that the host-facing tool is absent.

## Mainline sequence and dependencies

| Order | Deliverable | Depends on | Gate |
|---|---|---|---|
| 1 | Approved review channel and separate independent verdicts | owner decision / relay health | owner + reviewer provenance |
| 2 | Stage 0 evaluator/apply boundary design and freeze | 1; no implementation required | owner/reviewer design freeze; no writes |
| 3 | Projection hardening and telemetry | 1; Stage 0 constraints | engineering gate; no live claim |
| 4 | Read-only evaluator manifest/freeze | 2 + 3; no write capability | owner/evaluator freeze |
| 5 | Exploratory A/B/C pilot and preregistration | 3 + 4 | owner budget/data gate |
| 6 | Pilot decision and confirmatory design | pilot report | owner evidence gate |
| 7 | CLI projection decision | B-versus-C evidence | evidence gate |
| 8 | Stage 1 full evaluator/apply implementation, review, and authorization; future worker-write decision | Stage 0 + owner capability decision; pilot evidence may inform scope | independent R10/R11 + owner capability gate |

The four executable child plans are:

- [Projection hardening and telemetry](2026-09-21-projection-hardening.md)
- [Read-only evaluator manifest/freeze](2026-09-21-readonly-evaluator-freeze.md)
- [Exploratory A/B/C pilot](2026-09-21-ab-c-pilot.md)
- [Full evaluator/apply boundary](2026-09-21-evaluator-apply-boundary.md), whose Stage 0
  design/freeze precedes the pilot and whose Stage 1 implementation is later.

The named draft deliverables used by those plans are:

- [Read-only evaluator manifest spec](../specs/2026-09-21-readonly-evaluator-manifest.md)
- [Stage 0 evaluator/apply boundary freeze spec](../specs/2026-09-21-evaluator-boundary-freeze.md)
- [Projection measurement spec](../specs/2026-09-21-projection-measurement.md)
- [A/B/C pilot preregistration](../../reports/2026-09-21-ab-c-pilot-preregistration.md)

These documents are drafts until their owner/reviewer gates are recorded.

## Problem and Scope

### Problem

The runtime and native slices are implemented and locally exercised, but no
capability is Outcome-supported. Projection currently has synthetic evidence,
real-provider acceptance is opt-in, and the existing apply surface does not yet
bind evaluator semantics strongly enough for a production change-control claim.
The central question is:

> Can pi-sparkle lower total provider/runtime cost per independently accepted
> task while preserving evidence integrity and a reproducible approval/apply
> chain?

The proposed product framing — a vendor-neutral Evidence & Change Control
Runtime around coding agents — remains a strategic hypothesis, not an approved
README or market claim.

### In scope

- Four child plans and their reviewable artifacts.
- A Stage 0 evaluator/apply boundary design freeze and read-only evaluator
  freeze before live A/B/C collection; neither gate authorizes writes.
- Projection hardening: exact-byte observation identity for the send counter,
  fail-closed typed projectability, cumulative recall budgets, lifecycle/prefix
  tests, and mechanism/economic/outcome telemetry.
- Exploratory A/B/C only after preregistration and owner budget/data approval.
- Prospective R10/R11 design for the existing apply surface and future worker
  write registration.
- A separate owner evidence gate for any narrow Outcome-supported status row.

### Out of scope

- F6/F-PROD execution, sealing, or live adaptive selection.
- M7 training infrastructure.
- General coding-agent UI/IDE/model/provider feature parity.
- Cross-session observation persistence.
- Final product positioning, commercial pricing, staffing, or regulatory
  conclusions without deployment-specific owner decisions.

## Canonical pilot estimand (draft for preregistration)

The pilot must use one definition consistently in the plan, manifest, and
preregistration:

- A **distinct task** is one inference cluster. Every task appears in all three
  arms unless an incomplete-block design is approved before collection.
- The pilot uses exactly **K = 2 scheduled runs per task per arm**. The
  `taskAttemptsPerScheduledRun=1` field is frozen as a planned schedule
  parameter, not an enforcement claim; task/agent retry enforcement is not
  implemented by this documentation slice. Source scope is kept separate:
  `NativeSession` currently submits child requests with `limits.maxAttempts=1`,
  while the native `PiAgentExecutor.runWithRetry()` has the provider retry
  policy inside one `execute()` call. Its `maxAttempts=3` is an upper bound
  including the first provider-executor attempt, not exactly three API calls
  and not a global budget across all children or tool turns. No outcome-driven
  extra runs are added.
- Primary platform KPI:

  ```text
  provider/runtime cost per independently accepted task bundle
  = total provider + runtime cost across both scheduled runs and all retries
    / number of distinct tasks with ≥1 valid run independently accepted
      without human correction
  ```

- A zero accepted-task denominator makes the primary KPI undefined and blocks
  any claim; it is not converted to zero or infinity.
- Secondary metrics report cost per accepted run, independent acceptance rate,
  human correction minutes, wall time, repeat mass, and an all-in sensitivity
  that assigns a predeclared value to human time. Human-assisted acceptance is
  not agent-only independent acceptance.
- C-versus-B is the projection marginal contrast only under the frozen
  equivalence manifest. A-versus-B is a system-level contrast, not a pure
  projection effect.
- Repeats are never treated as independent tasks. Task is the bootstrap unit;
  repository is an additional cluster where tasks share a repository.

The exact estimator, interval method, missingness treatment, and thresholds are
frozen in the pilot preregistration before live calls.

## Evidence ledger requirement

Every gate record must separately identify:

1. author-run command, commit, environment, and result;
2. independent reviewer identity/channel, provenance, scope, tested commit,
   commands, and verdict;
3. human/owner approval identity, date, and exact authorization scope;
4. outcome evidence class, estimator, task population, and claim scope.

An author verification record cannot be relabeled as independent review or
Outcome-supported evidence. The supplied deep-research report is an
owner-supplied hypothesis source, not any of these four classes.

## Acceptance Criteria

- [ ] Existing host-facing `sparkle_apply_candidate` registration, unregistered
  worker write capability, and production authorization are described
  consistently in the permitted evidence-first documents and their referenced
  status/ADR records. The existing registration is present/wired but not
  production-authorized; worker write registration and automatic chaining remain
  absent.
- [ ] The four child plans and three named draft deliverables exist, link
  correctly, state their owner/state/schema/acceptance/verification/refusal
  rules, and are reviewed independently.
- [ ] Stage 0 boundary design is frozen before the read-only manifest and any
  live pilot. The draft specification defines canonicalization and exact-byte
  comparison, opaque record identity, evaluator write exclusion, local-weak
  labeling, crash/replay assumptions, provenance, and non-circular approval
  binding. `designRecordId` is a locator and approval evidence binds the exact
  canonical payload bytes. This slice drafts only; it does not self-approve or
  freeze the design.
- [ ] A read-only evaluator manifest is frozen before any live pilot. Its
  immutable inputs use opaque references with exact canonical-byte checks, it
  is outside candidate write scope, mutation-tested, cannot issue an apply
  capability, and references the Stage 0 boundary design record id.
- [ ] Projection hardening and telemetry pass the child-plan gate while the
  default-off and privacy contracts remain unchanged.
- [ ] The pilot preregistration freezes K=2, arm/task pairing and randomization,
  routing snapshot reference and canonical policy bytes, taskAttemptsPerScheduledRun=1
  (a planned fixed scheduled-run field whose enforcement is not implemented by
  this documentation slice), and the existing provider executor's local
  maxAttempts=3 upper bound where applicable. The latter includes the first
  provider-executor attempt, is not exactly three API calls, and is not global
  across children or tool turns. The opaque arm manifest id and per-ledger-row
  `armManifestId` are also frozen. Primary/secondary estimands and
  data-transfer/retention policy are frozen as well. It defines
  assigned/not-started, provider failure, runtime failure, evaluator failure,
  valid accepted/rejected, cancelled, and invalid-collection states; no
  post-outcome exclusion or replacement is allowed.
- [ ] The exploratory pilot report, if run, includes task-level ledgers and
  does not claim non-inferiority, F6 closure, live adaptive benefit, or broad
  Outcome-supported benefit.
- [ ] Any confirmation sample size is recalculated from pilot variance/
  discordance and a predeclared MDE; it is not inferred from a fixed 100–200
  range.
- [ ] CLI projection wiring is either justified by the predeclared B-versus-C
  evidence or explicitly declined with a durable reason.
- [ ] Full R10/R11 closure precedes production authorization of the existing
  apply surface and any future worker-write registration. ADR-006 limits remain
  explicit: no credential mutation, permission mutation, trust mutation, or
  tool-allowlist/activation edits.


## Verification and handoff

- Documentation gate: `pnpm workflow:check` plus link/diff checks.
- Local projection gate: child-plan focused tests, `pnpm gate`, security and Pi
  probes; no live-provider claim.
- Pilot gate: Stage 0 boundary design freeze, manifest + preregistration + owner
  budget/data approval before collection; exact task-level ledger and report
  after collection.
- Apply gate: Stage 1 independent R10/R11 review and owner authorization;
  existing wired apply tool remains non-production-authorized until then.
- Abort on critical evidence-integrity incident, unmanifested provider/data
  path, live-isolation allowlist change, evaluator/policy identity drift, or
  a predeclared pilot safety stop.
- After this umbrella plan is approved, execute the four child plans as
  separate reviewable workstreams. Do not implement pilot and apply-boundary
  changes in one broad diff.

## Closeout

- Verified commit/date: pending fresh plan review and owner gates.
- Existing baseline evidence: [projection verification](../../reports/2026-09-20-native-observation-projection.md).
- Current expert review: [2026-09-21 plan review](../../reports/2026-09-21-evidence-first-plan-expert-review.md).
- Stage 0 has a draft-only canonical freeze-record specification and remains
  unapproved/unfrozen pending independent review and owner decision.
