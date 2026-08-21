# Implementation Plan: Adaptive Agent Work Loop (M3-M6)

> **Archived snapshot 2026-08-17** of the full M3–M6 plan (including completed tasks). Active remaining work is `../adaptive-plan.md`. Completed/verified slices are listed in `ACCEPTANCE-2026-08-17.md`. Do not treat this snapshot as the live checklist.

---

# Implementation Plan: Adaptive Agent Work Loop (M3-M6)

## Status and gate

Proposed for human review. This plan implements [the adaptive work-loop specification](../docs/specs/adaptive-agent-work-loop.md) and [ADR-004](../docs/decisions/0004-controlled-adaptation.md).

Do not begin M3 product implementation until:

1. M0-M2 Checkpoint C passes;
2. the adaptive specification and ADR-004 are accepted;
3. the six defaults under the specification's “Decision required before implementation” section are approved or revised;
4. the M3 storage/privacy preflight below passes.

An explicitly approved observability-only spike may define contracts earlier, but it must not alter M0-M2 runtime behavior or active agent resources.

## Delivery rules

- Implement one task at a time with RED -> GREEN -> full task verification.
- Commit each task independently only when the user asks for commits.
- Before each task starts, replace planned file/command hints with the current repository paths discovered at preflight; stale “likely files” never authorize inventing a module or overwriting concurrent work.
- Do not add a dependency, database, hosted service, credential, provider, write-capable tool, or incompatible event format without approval.
- Treat the current event schemas and repository code as authoritative; resolve exact schema versions and migration paths before changing persisted data.
- Never use a live user workspace for replay, shadow, judge, or optimizer experiments.
- Every model, rubric, resource, and policy reference is versioned.
- “Improved” is reserved for `Outcome-supported`; earlier states are `Present`, `Wired`, or `Exercised`.

## Dependency graph

```text
Checkpoint C
  -> P0 privacy/storage/authority preflight
      -> M3-T1 episode lifecycle
          -> M3-T2 requirement contract + coverage
              -> M3-T3 source normalization + extraction/critique
                  -> M3-T4 project context index
                      -> M3-T5 context packet compiler
                          -> M3-T6 feedback/evaluation + redaction
                              -> M3-T7 closure + inspection
                                  -> M3-T8 task/model telemetry
                                      -> Checkpoint D
                                          -> M4-T1 rubric/evaluator registry
                                              -> M4-T2 project/code/delivery adapters
                                                  -> M4-T3 actor/critic + pairwise review
                                                  -> M4-T4 preference observations
                                                      -> M4-T5 preference lifecycle CLI
                                                  -> M4-T6 pattern detector
                                                  -> Checkpoint E
                                                      -> M5-T1 capability registry/R0
                                                          -> M5-T2 Bayesian estimates
                                                              -> M5-T3 replay + propensity
                                                                  -> M5-T4 bandit shadow
                                                                      -> M5-T5 topology router
                                                                          -> Checkpoint F
                                                                              -> M6-T1 resource registry
                                                                                  -> M6-T2 isolated replay/holdout
                                                                                      -> M6-T3 shadow/canary
                                                                                          -> M6-T4 optimizer
                                                                                          -> M6-T5 promotion CAS
                                                                                              -> M6-T6 drift/rollback
                                                                                                  -> Checkpoint G
```

## Preflight P0: Freeze privacy, storage, and authority contracts

**Goal:** Remove ambiguity before new durable data or adaptive behavior is introduced.

**Decisions to freeze:**

- episode state root and retention policy;
- encryption/reference-only policy for raw conversation and tool bodies;
- redaction policy and forbidden dataset fields;
- user-global versus project-only preference authority;
- deletion/tombstone and backup-retention semantics;
- crowd-data and dataset-export policy (default off until explicit user approval);
- initial proposal-first promotion authority;
- high-risk task classification and no-exploration rule;
- schema-version and forward-migration policy.

**Acceptance:**

- [ ] Every durable record class has owner, retention, redaction, deletion, and migration rules.
- [ ] Active resources cannot be changed by the execution plane.
- [ ] Raw prompts, secrets, environment dumps, and hidden reasoning are explicitly excluded from optimization datasets.
- [ ] Open decisions are resolved in an accepted ADR/spec revision.

**Verification:** documentation links resolve; `git diff --check` passes; an independent privacy/security review has no unresolved blocker.

**Likely files:** `docs/specs/adaptive-agent-work-loop.md`, `docs/decisions/0004-controlled-adaptation.md`, one forward ADR only if storage/privacy decisions cannot fit ADR-004.

## Phase M3: Episode observability and evaluation foundation

### M3-T1: ProjectEpisode lifecycle and append-only event schemas

**Goal:** Represent one user goal across runs and restarts without changing existing run truth.

**Contracts:** `EpisodeId`, `ProjectEpisode`, `EpisodeEvent`, `EPISODE_OPENED`, `RUN_ATTACHED`, `EPISODE_WAITING`, `EPISODE_CLOSED`, replay reducer, atomic materialized checkpoint.

**Acceptance:**

- [ ] One episode can attach multiple existing run IDs but cannot attach a run from another project.
- [ ] Duplicate opens, attachments, and terminal events fail closed.
- [ ] Replay after a truncated final JSONL line recovers consistently with the run event store.
- [ ] Cross-stream references are validated only after referenced run events are durable.
- [ ] Existing M0-M2 run replay remains byte/behavior compatible.

**RED:** focused tests for duplicate terminal events, foreign-run attachment, dangling references, and truncated episode log fail before implementation.

**Verification:**

```bash
corepack pnpm exec tsx --test test/unit/episode/*.test.ts test/integration/m3/episode-store.test.ts
corepack pnpm run typecheck
```

**Likely files:** `src/domain/episode.ts`, `src/episode/events.ts`, `src/episode/store.ts`, `src/episode/replay.ts`, corresponding tests.

**Depends on:** P0, Checkpoint C.

### M3-T2: Requirement contract and coverage matrix

**Goal:** Turn conversation/project sources into a typed, source-attributed contract and prove every requirement reaches a task and check.

**Contracts:** `RequirementContract`, `Constraint`, `Assumption`, `DecisionQuestion`, `AuthorityGrant`, `CoverageMatrix`, validators. The first implementation accepts already-extracted structured input; LLM extraction remains behind an interface and deterministic fixtures.

**Acceptance:**

- [ ] Every deliverable, constraint, and criterion has at least one source reference or is marked as an assumption.
- [ ] Conflicting requirements remain explicit until resolved by the defined precedence rule.
- [ ] Unobservable acceptance criteria are rejected.
- [ ] A task graph cannot start while mandatory criteria are uncovered or a blocking decision remains unanswered.
- [ ] A contract critic can report omissions but cannot mutate the accepted contract.

**RED:** tests reject orphan criteria, invalid source references, contradictory unresolved authority, and uncovered acceptance criteria.

**Verification:**

```bash
corepack pnpm exec tsx --test test/unit/requirements/*.test.ts test/integration/m3/coverage-gate.test.ts
corepack pnpm run typecheck
```

**Likely files:** `src/requirements/contract.ts`, `src/requirements/coverage.ts`, `src/requirements/precedence.ts`, `src/requirements/critic.ts`, tests.

**Depends on:** M3-T1.

### M3-T3: Normalize sources, extract requirements, and critique the contract

**Goal:** Implement the native conversation/project-source path that creates a contract candidate instead of requiring pre-structured input forever.

**Contracts:** `ConversationSource`, `ProjectSource`, `NormalizedSourceFacet`, `RequirementExtractor`, `ContractCandidate`, `ContractCritique`. Source normalization is deterministic; model extraction and critique use separately versioned roles and prompts.

**Acceptance:**

- [x] User turns, approved specs/plans/ADRs, and repository facts retain distinct authority/provenance.
- [x] Prompt-like text in code, logs, quoted web content, or tool output is data and cannot become user authority.
- [x] Extraction returns a validated `RequirementContract` covering objectives, deliverables, constraints, non-goals, assumptions, questions, authority grants, acceptance criteria, and source references.
- [x] A critic receives normalized sources plus the candidate, not the extractor's defense, and reports omissions/contradictions without mutating it.
- [x] Low-confidence or materially conflicting output routes to a user decision; it does not silently pick an interpretation.
- [x] Inferred/latent requirements are labeled as inference and routed to user confirmation unless corroborated by an explicit source.
- [x] Faux-provider fixtures reproduce extraction/critique protocol behavior without credentials.

**RED:** fixtures fail for an early privacy constraint, changed user instruction, quoted prompt injection, implicit assumption, conflicting approved plan, and missing acceptance criterion.

**Verification:**

```bash
corepack pnpm exec tsx --test test/unit/requirement/source-normalization.test.ts test/integration/m3/requirement-extraction.test.ts
corepack pnpm run typecheck
```

**Likely files:** `src/requirements/sources.ts`, `src/requirements/extractor.ts`, `src/requirements/critic.ts`, `src/pi-adapter/structured-executor.ts`, tests.

**Depends on:** M3-T2.

### M3-T4: Build a versioned ProjectContextIndex

**Goal:** Turn project discovery into a task-oriented, versioned map of instructions, architecture boundaries, tests, risks, commands, and workspace ownership.

**Contracts:** `ProjectContextIndex`, `InstructionOwner`, `ModuleBoundary`, `ValidationRoute`, `WorkspaceOwnership`, `ContextFact` with trust/freshness and source hashes.

**Acceptance:**

- [ ] Instruction precedence and ownership are explicit, including nested project rules.
- [ ] The index records manifests, commands, public interfaces, relevant dependency boundaries, tests, migrations/security risks, generated artifacts, and dirty-worktree ownership.
- [x] A ranked code-map view (public interfaces and call structure) with its own token budget complements the file-level facts. _(`ProjectContextIndex.codeMap` ranks public symbols first, preserves normalized call edges, and records deterministic token-budget omissions; verified by `test/unit/context/project-index.test.ts`.)_
- [ ] Missing facts remain unavailable and stale source hashes invalidate affected facts.
- [ ] Unrelated dirty changes are visible but cannot be assigned to the episode without evidence.
- [ ] Index refresh is incremental and deterministic from frozen project inputs.

**RED:** temporary-repository fixtures fail for nested instructions, stale source, missing test route, multiple manifests, generated files, and unrelated dirty changes.

**Verification:**

```bash
corepack pnpm exec tsx --test test/unit/context/project-index.test.ts test/integration/m3/project-context-index.test.ts
corepack pnpm run typecheck
```

**Likely files:** `src/context/project-index.ts`, `src/context/instructions.ts`, `src/context/validation-routes.ts`, `src/project/discovery.ts`, tests.

**Depends on:** M3-T3.

### M3-T5: Bounded context-packet compiler and fidelity checks

**Goal:** Pass the minimum sufficient context between stages without losing requirements, authority, failures, decisions, or evidence.

**Contracts:** `ContextPacket`, `ContextFact`, `OmissionRecord`, `ContextRequest`, token estimator, deterministic selector interface. LLM summaries are optional candidates behind the interface and never replace source references.

**Acceptance:**

- [ ] Mandatory contract constraints, authority grants, unresolved decisions, validation route, and dependency outputs cannot be omitted.
- [ ] Duplicate facts collapse by stable identity while conflicting facts remain separate.
- [ ] Token overflow triggers ranked omission records or a structured request for a larger budget, not silent truncation.
- [ ] Downstream fixture questions can be answered from the packet and artifact refs without loading the parent transcript.
- [ ] Secret/reference-only evidence is not expanded into the packet.
- [ ] Packet creation is deterministic from the same frozen index, selector version, and budget.

**RED:** golden fixtures fail for a privacy constraint hidden early in a conversation, conflicting requirements, oversized logs, missing dependency output, and token overflow.

**Verification:**

```bash
corepack pnpm exec tsx --test test/unit/context/*.test.ts test/integration/m3/context-packet.test.ts
corepack pnpm run typecheck
```

**Likely files:** `src/context/packet.ts`, `src/context/select.ts`, `src/context/budget.ts`, `src/context/fidelity.ts`, tests.

**Depends on:** M3-T4.

### M3-T6: Structured feedback/evaluation and redaction boundary

**Goal:** Persist attributable evaluation and feedback without storing unsafe raw bodies.

**Contracts:** `EvaluationRecord`, `EvaluatorIdentity`, `CriterionScore`, `Finding`, `UserFeedback`, `TrustClass`, `RedactionDecision`, `Tombstone`.

**Acceptance:**

- [ ] An evaluation identifies target artifact/version, evaluator/model version, rubric version, evidence, independence class, and confidence.
- [ ] A failing deterministic check cannot be replaced by an inferential passing score.
- [ ] Redaction removes configured secret/PII/path classes before persistence and emits a bounded audit result.
- [ ] Oversized/untrusted input is reference-only or rejected according to policy.
- [ ] Tombstoned source payloads disappear from materialized views and dataset exports.

**RED:** seeded secret, path, prompt-injection, oversized body, missing-provenance, and tombstone fixtures fail.

**Verification:**

```bash
corepack pnpm exec tsx --test test/unit/evaluation/*.test.ts test/unit/privacy/*.test.ts test/integration/m3/redaction.test.ts
corepack pnpm run lint
corepack pnpm run typecheck
```

**Likely files:** `src/evaluation/contract.ts`, `src/privacy/redaction.ts`, `src/privacy/trust.ts`, `src/privacy/deletion.ts`, tests.

**Depends on:** M3-T5.

### M3-T7: Deterministic episode closure and inspection CLI

**Goal:** Close an episode only from declared acceptance evidence and make the whole work loop inspectable.

**Commands:** `inspect --episode <id>`, `episode events --episode <id> --json`, and `episode close --episode <id> --status <COMPLETED|FAILED|ABANDONED>`.

**Acceptance:**

- [x] Closure rejects uncovered acceptance criteria and records the required evidence before refusing completion.
- [x] Snapshot inspection and append-only event inspection expose current/terminal episode state.
- [x] The CLI never labels an agent's completion claim as verified without matching evidence.
- [x] Restarting the CLI preserves episode/run linkage and terminal state through durable snapshots/events.

**RED:** process-level CLI tests prove blocked and successful closure paths.

**Verification:**

```bash
corepack pnpm exec tsx --test test/integration/m3/episode-cli.test.ts
corepack pnpm run build
```

**Likely files:** `src/episode/closure.ts`, `src/episode/inspection.ts`, `src/cli/main.ts`, tests.

**Depends on:** M3-T6.

### M3-T8: Task taxonomy and model invocation telemetry

**Goal:** Produce routing/evaluation data without making adaptive routing decisions yet.

**Contracts:** versioned `TaskFeatures`, `TaskFamily`, `ModelInvocation`, `UsageRecord`, `RoutingObservation`. Record candidate/selected model identity, provider/model version, role, context/tool needs, latency, tokens/cost when available, failure class, and evidence refs.

**Acceptance:**

- [ ] Missing provider usage is represented as unavailable, not zero.
- [ ] Pricing/catalog version is recorded separately from provider-reported usage.
- [ ] Retries, cache hits, timeouts, and cancelled calls are attributable.
- [ ] No prompt or secret body is required for telemetry analysis.
- [ ] Taxonomy version changes do not rewrite historical facts.

**RED:** unavailable accounting, retry attribution, and taxonomy-version fixtures fail.

**Verification:**

```bash
corepack pnpm exec tsx --test test/unit/telemetry/*.test.ts test/integration/m3/pi-telemetry.test.ts
corepack pnpm run test
corepack pnpm run lint
corepack pnpm run typecheck
corepack pnpm run build
```

**Likely files:** `src/routing/features.ts`, `src/telemetry/model-invocation.ts`, `src/pi-adapter/pi-executor.ts`, tests.

**Depends on:** M3-T7.

### Checkpoint D

- [ ] A multi-run M2 scenario replays into one episode.
- [ ] Conversation/project-source fixtures produce a source-attributed contract whose independent critique catches seeded omissions and contradictions.
- [ ] ProjectContextIndex fixtures expose instruction precedence, validation routes, risk boundaries, and unrelated dirty-worktree ownership.
- [ ] Requirement coverage, checks, feedback, evaluator provenance, and model usage are inspectable.
- [ ] Context-packet fixtures preserve every critical fact and record every bounded omission without forwarding a raw parent transcript.
- [ ] Every missing outcome is `Unobserved`, never fabricated.
- [ ] Redaction/deletion adversarial tests pass.
- [ ] Existing M0-M2 tests remain green.

## Phase M4: Review fabric and preference learning

### M4-T1: Rubric registry and evaluator interface

**Goal:** Make deterministic, human, and inferential evaluation pluggable without flattening their authority.

**Contracts:** immutable rubric versions; criterion applicability; evaluator capabilities; `PASS`, `FAIL`, `ABSTAIN`, `UNOBSERVED`; evidence precedence table.

**Acceptance:**

- [x] Unknown/stale rubric versions fail closed.
- [x] An evaluator can only score declared criteria and scopes.
- [x] `ABSTAIN` and missing evidence remain distinct from failure.
- [x] Deterministic criteria cannot be overridden by inferential evaluators.

**Verification:** focused registry/interface tests plus typecheck.

**Likely files:** `src/evaluation/rubric-registry.ts`, `src/evaluation/evaluator.ts`, `src/evaluation/precedence.ts`, tests.

**Depends on:** Checkpoint D.

### M4-T2: Project, code, and delivery evaluator adapters

**Goal:** Convert real project checks and delivery outcomes into typed evaluation evidence rather than relying on generic model scores.

**Adapters:** configured command/test results, type/lint/build, requirement coverage, changed-path/diff scope, architecture/security policy checks, review revisions, user/manual acceptance, rollback/reopen, and runtime health when explicitly configured.

**Acceptance:**

- [x] Each adapter declares supported criterion, input contract, trust class, timeout, unavailable semantics, and evidence owner.
- [ ] Command exit status, stdout/stderr artifact hash, working directory, environment policy, and affected revision/change set are attributable.
- [x] Final validation is linked to the final change set; a pre-change pass cannot close an episode.
- [x] Diff-scope review distinguishes episode-owned changes, unrelated user changes, generated files, and unknown ownership.
- [x] Review rework and rollback are outcomes, not automatically agent failures; attribution remains explicit.
- [x] Runtime/manual acceptance remains unavailable when not configured or observed.

**RED:** fixtures fail for stale test results, wrong working directory, changed diff after validation, unrelated dirty files, missing manual acceptance, and rollback caused by an external dependency.

**Verification:**

```bash
corepack pnpm exec tsx --test test/unit/evaluation/project-adapters.test.ts test/integration/m4/delivery-evidence.test.ts
corepack pnpm run typecheck
```

**Likely files:** `src/evaluation/check-adapter.ts`, `src/evaluation/diff-adapter.ts`, `src/evaluation/delivery-adapter.ts`, `src/evaluation/ownership.ts`, tests.

**Depends on:** M4-T1.

### M4-T3: Independent actor/critic and blind pairwise review

**Goal:** Support evidence-bounded self/peer review and candidate comparison with judge-bias controls.

**Acceptance:**

- [x] A critic receives artifact, contract, rubric, and evidence—not actor identity or defense.
- [ ] Pairwise input order is randomized and material comparisons are repeated with swapped order.
- [x] Position-sensitive disagreement becomes uncertainty/abstention.
- [x] Reconciliation deduplicates causal defects and preserves dissent.
- [ ] Self-review cannot update the actor's routing score or promote its resource.

**Verification:** faux-provider integration tests for order bias, abstention, duplicate findings, and disagreement.

**Likely files:** `src/evaluation/critic.ts`, `src/evaluation/pairwise.ts`, `src/evaluation/reconcile.ts`, tests.

**Depends on:** M4-T2.

### M4-T4: Scoped preference observations and materialized views

**Goal:** Store explicit and inferred preference evidence without converting incidental behavior into durable user profiling.

**Acceptance:**

- [x] Current explicit instruction overrides every broader learned preference.
- [x] Explicit project and user-global observations remain separate.
- [x] Inferred observations require configured comparable recurrence and retain confidence/provenance.
- [x] Silence, completion, one edit, or one click cannot become a durable preference alone.
- [x] Conflicts lower confidence and preserve history.
- [ ] Preference-loop evaluation includes correction cost and forgetting/reversal behavior, not only preference fit.

**Verification:** precedence, recurrence, scope, conflict, expiry, and forbidden-inference tests.

**Likely files:** `src/preferences/observation.ts`, `src/preferences/materialize.ts`, `src/preferences/precedence.ts`, tests.

**Depends on:** M4-T1.

### M4-T5: Preference inspect/correct/export/delete workflow

**Goal:** Give the user direct control over learned preferences.

**Acceptance:**

- [x] CLI lists effective preference, scope, confidence, and non-sensitive provenance.
- [x] Correction adds an explicit observation and recomputes the view without deleting audit history.
- [x] Export contains only authorized scopes.
- [x] Delete creates a tombstone and excludes dependent data from future datasets.
- [ ] A deleted preference is absent after restart/replay.

**Verification:** process-level CLI and deletion propagation tests.

**Likely files:** `src/preferences/service.ts`, `src/preferences/export.ts`, `src/cli/main.ts`, tests.

**Depends on:** M4-T4.

### M4-T6: Repeated-pattern detector

**Goal:** Detect attributable improvement opportunities from structured episode signatures rather than raw transcript clustering.

**Acceptance:**

- [ ] Default recurrence requires two independent comparable episodes; explicit severe safety events are labeled one-off readiness findings.
- [ ] Detectors implement negative controls for repeated reads/edits, missing instrumentation, protective gate blocks, and unrelated failures.
- [x] Findings identify the earliest supported boundary: contract/context/plan/route/execution/tool/review/delivery.
- [x] No supported pattern produces an explicit no-candidate result rather than filler.

**Verification:** fixture matrix for each detector, negative control, confidence tier, and causal-boundary attribution.

**Likely files:** `src/learning/signatures.ts`, `src/learning/patterns.ts`, `src/learning/attribution.ts`, tests.

**Depends on:** M4-T3, M4-T5.

### Checkpoint E

- [x] Explicit feedback changes the next comparable episode with traceable precedence.
- [x] Final project/code/delivery evaluations are tied to the final change set and distinguish unrelated or externally caused outcomes.
- [x] One ambiguous behavior cannot create a durable preference.
- [x] Pairwise judge position/self-enhancement fixtures abstain or remain uncertain.
- [x] Repeated patterns link to evidence and negative controls.
- [x] Full quality gates pass.

## Phase M5: Adaptive routing and model clusters

### M5-T1: Capability registry and deterministic R0 router

**Goal:** Filter ineligible models and make a conservative, explainable static choice.

**Acceptance:**

- [x] Provider policy, privacy class, capabilities, context, tool needs, budget, and deadline are hard constraints.
- [x] Unknown capability is not treated as supported.
- [x] Every candidate rejection and fallback is recorded.
- [x] High-risk tasks use the configured approved model/topology and never explore.
- [x] R0 supports deterministic cost-cascade rules (cheap-model attempt with a confidence gate before escalation).

**Verification:** exhaustive policy/capability matrix tests.

**Likely files:** `src/routing/capability-registry.ts`, `src/routing/policy.ts`, `src/routing/r0.ts`, tests.

**Depends on:** Checkpoint E.

### M5-T2: Bayesian task-family outcome estimates

**Goal:** Replace unqualified labels with uncertainty-aware observations while retaining the deterministic eligibility gate.

**Acceptance:**

- [x] Estimates are keyed by task family, role, model version, and feature version.
- [x] Missing/abstained outcomes do not become failures or zeros.
- [x] Recency decay and minimum samples are explicit and deterministic under fake time.
- [x] Lower-confidence-bound fallback selects the conservative baseline.

**Verification:** seeded posterior, decay, sparse-sample, and model-version reset tests.

**Likely files:** `src/routing/posterior.ts`, `src/routing/outcomes.ts`, `src/routing/r1.ts`, tests.

**Depends on:** M5-T1.

### M5-T3: Router replay harness and propensity ledger

**Goal:** Reproduce routing policies against frozen episode datasets before any online exploration.

**Acceptance:**

- [x] Dataset manifests freeze episode hashes, exclusions, split, resource versions, environment, and seed.
- [x] Replay cannot write to original workspaces or active pointers.
- [x] Every eligible action receives a logged probability/propensity.
- [x] Propensity support/overlap and effective sample size are reported before off-policy comparison.
- [x] Unsupported counterfactual regret claims are rejected by report validation.
- [x] Static baseline, observed utility, uncertainty, cost, and guardrails are reported separately.
- [x] Comparison uses a versioned evaluation card with domain coverage, difficulty tiers, and multiple metrics, not only local task replay.

**Verification:** deterministic rerun hash, isolation, contamination, and report-schema tests.

**Likely files:** `src/experiments/manifest.ts`, `src/experiments/replay.ts`, `src/routing/propensity.ts`, tests.

**Depends on:** M5-T2.

### M5-T4: Contextual bandit in shadow mode

**Goal:** Learn candidate routing decisions without affecting live execution.

**Acceptance:**

- [x] The bandit sees only versioned observable task features.
- [x] Shadow decisions never invoke an unselected model or change side effects unless an explicit experiment budget authorizes isolated comparison.
- [x] Exploration budget is separate and high-risk exploration count remains zero.
- [x] Distribution shift widens uncertainty and falls back.
- [x] Any guardrail breach stops the experiment.

**Verification:** deterministic seeded simulations plus live-shadow faux-provider test.

**Likely files:** `src/routing/bandit.ts`, `src/routing/shadow.ts`, `src/routing/drift.ts`, tests.

**Depends on:** M5-T3.

### M5-T5: Execution-topology router

**Goal:** Decide whether the task needs one agent, refinement, critic, candidates, specialists, debate, or a human boundary.

**Acceptance:**

- [x] Deterministic/tool-only and one-agent routes are preferred when sufficient.
- [x] Additional agents require positive expected value under remaining cost/time budget.
- [x] Failed repeated reflection triggers model/topology change or stop, not an unbounded loop.
- [x] Majority opinion cannot override deterministic failure or unresolved user intent.
- [ ] Topology decision and aggregation cost are recorded. _(pending: the run loop does not call `planTaskTopology` yet; task-family semantics and remaining-budget bookkeeping are Checkpoint F prerequisites)_

**Verification:** scenario table covering low-risk mechanical work, architecture, security, ambiguous product intent, open-ended search, and stalled refinement.

**Likely files:** `src/routing/topology.ts`, `src/routing/expected-value.ts`, `src/run/supervisor.ts`, tests.

**Depends on:** M5-T4.

### Checkpoint F

- [ ] On a sealed held-out set, adaptive routing meets the approved cost-quality target against R0 under paired isolated evaluation or a predeclared estimator with valid overlap diagnostics. _(open questions recorded in `docs/decisions/0005-checkpoint-f-holdout-open-questions.md` — awaiting expert input; experiment runner and improvement claims are frozen until then)_
- [x] Confidence intervals/raw counts and task-family breakdown are reported. _(module level: `src/experiments/comparison-report.ts` computes paired 95% CIs, raw counts, and per-family breakdown; improvement claims are gated on non-provisional samples, CI excluding zero, and cost tolerance — verified by `test/unit/experiments/comparison-report.test.ts`. No real held-out run exists yet; see the item above.)_
- [x] Zero privacy, budget, high-risk exploration, or provider-policy violations occur.
- [x] Every deterministic routing/topology decision reproduces from frozen inputs; external model calls record configuration and response hashes plus run-to-run variance without claiming byte-identical replay. _(routing rerun-hash tests + topology scenario-table reproduction tests; `src/telemetry/model-invocation.ts` records frozen config hash + response hash and `compareRunToRun` reports paired variance; wired into `PiAgentExecutor` via `onInvocation` and verified through the faux-provider path. Real-provider recording stays opt-in.)_

## Phase M6: Controlled self-optimization

### M6-T1: Versioned resource and improvement-candidate registry

**Goal:** Represent prompts, routing policies, rubrics, skills, examples, memories, and workflow templates as immutable candidates.

**Acceptance:**

- [x] Content hash, parent, scope, author/source, status, and evaluation plan are required.
- [x] Creating a candidate cannot change the active version.
- [x] Cyclic lineage, hash mismatch, unknown parent, and incompatible scope fail closed.
- [x] Permission/security/credential targets are classified non-auto-promotable.

**Verification:** registry and lineage property tests.

**Likely files:** `src/adaptation/resource.ts`, `src/adaptation/candidate.ts`, `src/adaptation/registry.ts`, tests.

**Depends on:** Checkpoint F. _(delivered as pre-research while Checkpoint F item 1 — the sealed held-out experiment — awaits an approved cost-quality target and dataset source)_

### M6-T2: Isolated replay and sealed holdout evaluator

**Goal:** Evaluate candidates reproducibly without contaminating workspaces or repeatedly optimizing against the holdout.

**Acceptance:**

- [x] Train/validation/holdout manifests are immutable and contamination checked. _(`src/experiments/dataset.ts`: sealed three-way manifest, hash-verifiable, overlap/unknown/exclusion contamination fails closed)_
- [x] Original project state, event logs, and active resources are read-only. _(`src/experiments/isolation.ts`: isolation guard rejects writes into read-only roots and outside the isolated output root)_
- [x] Holdout access is audited; a compromised holdout is sealed and replaced, not reused silently. _(`src/experiments/holdout.ts`: `HoldoutVault` audits every access, seals on compromise, replace requires a sealed predecessor and a fresh open target)_
- [x] Holdout splits are rotated on a schedule; the frozen split is preserved for comparability. _(`rotateHoldout` folds the old holdout into train and freezes it in `previousHoldout`)_
- [x] Small samples are provisional and cannot justify global promotion. _(enforced by Checkpoint F-2 claim gating in `validateComparisonReport` — see `test/unit/experiments/comparison-report.test.ts`)_

**Verification:** filesystem isolation, manifest hash, leakage, and holdout-access tests.

**Likely files:** `src/experiments/isolation.ts`, `src/experiments/dataset.ts`, `src/experiments/holdout.ts`, tests.

**Depends on:** M6-T1. _(machinery delivered; the R0-vs-R1 experiment run and improvement claims remain frozen per ADR-005)_

### M6-T3: Shadow/canary experiment runner

**Goal:** Exercise promising candidates with bounded exposure and automatic guardrail stops.

**Acceptance:**

- [ ] Experiment plan freezes baseline, candidate, population, metrics, thresholds, budget, randomization, and stop policy.
- [ ] Shadow cannot change the selected live action.
- [ ] Canary is limited to approved reversible scopes and fixed exposure.
- [ ] Guardrail breach stops new assignments and records rollback evidence.
- [ ] Missing outcomes and user intervention follow the predeclared analysis policy.

**Verification:** fake-time/fake-outcome tests for allocation, stop, timeout, cancellation, and crash resume.

**Likely files:** `src/experiments/plan.ts`, `src/experiments/shadow.ts`, `src/experiments/canary.ts`, tests.

**Depends on:** M6-T2.

### M6-T4: Reflective prompt/workflow optimizer

**Goal:** Generate bounded, interpretable candidates from attributable failures and successes.

**Acceptance:**

- [ ] The optimizer mutates one declared resource boundary per candidate.
- [ ] Candidate generation uses redacted evidence and cannot access active-pointer mutation tools.
- [ ] Evaluation uses validation/holdout separation and retains candidate lineage.
- [ ] Non-dominated quality/preference/cost/latency/risk candidates can coexist.
- [ ] A candidate supported only by itself or its actor model cannot promote.
- [ ] The search space is bounded by the what/when/where axes (resource type, offline inter-test-time stage, parameterization level), and topology search runs only under a predeclared budget on low-risk task families.

**Verification:** faux optimizer tests for mutation scope, lineage, Pareto retention, local-optimum diversity, and self-support rejection.

**Likely files:** `src/adaptation/reflection.ts`, `src/adaptation/mutate.ts`, `src/adaptation/pareto.ts`, tests.

**Depends on:** M6-T3.

### M6-T5: Approval and compare-and-swap promotion

**Goal:** Activate an approved candidate atomically and retain a dependable rollback target.

**Acceptance:**

- [ ] Initial policy requires explicit approval for every promotion.
- [ ] Approval profiles are versioned resources; only user-approved low-risk classes may auto-promote inside a bounded budget, and security/permission/credential/global-rule classes can never auto-promote.
- [ ] Pointer update verifies expected current version and candidate eligibility.
- [ ] Crash before activation leaves an inactive candidate; crash after activation is replayable.
- [ ] Concurrent promotions cannot lose an update.
- [ ] Change note includes scope, evidence, guardrails, and rollback version.

**Verification:** concurrency, crash-boundary, stale-pointer, approval, and replay tests.

**Likely files:** `src/adaptation/promotion.ts`, `src/adaptation/active-pointer.ts`, `src/cli/main.ts`, tests.

**Depends on:** M6-T4.

### M6-T6: Drift monitor, rollback, and retirement

**Goal:** Detect regressions and safely leave the candidate version.

**Acceptance:**

- [ ] Drift is evaluated by model version, task mix, project, policy, and judge calibration.
- [ ] Guardrail breach automatically restores the previous pointer without waiting for an LLM.
- [ ] Non-guardrail degradation proposes rollback with uncertainty and evidence.
- [ ] Rollback is idempotent, append-only, and preserves both versions.
- [ ] Retired versions cannot receive new assignments but remain reproducible subject to retention policy.

**Verification:** forced regression, repeated rollback, crash recovery, stale evidence, and retirement tests.

**Likely files:** `src/adaptation/monitor.ts`, `src/adaptation/rollback.ts`, `src/adaptation/retirement.ts`, tests.

**Depends on:** M6-T5.

### Checkpoint G

- [ ] A seeded repeated failure creates an attributable low-risk candidate.
- [ ] The candidate passes static, replay, sealed holdout, and approved canary gates.
- [ ] Promotion is atomic and visible in the ledger.
- [ ] A comparable later episode is required before `Outcome-supported`.
- [ ] A forced guardrail regression automatically rolls back.
- [ ] User preference inspect/correct/export/delete still works after promotion and rollback.
- [ ] Full quality gates pass.

## Cross-phase test suites

Maintain these suites as first-class owners rather than scattering assertions:

- `test/contract/`: schema compatibility, event/resource versioning, import boundaries;
- `test/security/`: redaction, prompt injection, poisoning, cross-project leakage, authority escalation;
- `test/replay/`: crash/restart/idempotence/dangling-reference scenarios;
- `test/evaluation/`: judge bias, abstention, precedence, calibration fixtures;
- `test/experiments/`: split leakage, reproducibility, shadow/canary isolation;
- `test/acceptance/adaptive-loop.test.ts`: end-to-end Checkpoint G scenario with deterministic fakes.

At every checkpoint run, in order:

```bash
corepack pnpm run test
corepack pnpm run lint
corepack pnpm run typecheck
corepack pnpm run build
```

Focused task commands (for example `corepack pnpm exec tsx --test <files>`) must assert that at least one intended test file was collected and executed; a run that collects zero intended tests fails verification.

A real-provider/model suite remains opt-in, budget-capped, read-only, and separate from required local acceptance.

## Stop conditions

Stop implementation and return to design review when any task requires:

- an incompatible rewrite of M0-M2 run truth;
- persistent raw conversations or hidden reasoning contrary to P0;
- online exploration for high-risk work;
- an evaluator that can overrule deterministic gates;
- an optimizer that can mutate active resources directly;
- model-weight training before M7 review;
- a database/hosted service/new provider/dependency without approval;
- a claim of improvement without held-out or comparable later evidence.
