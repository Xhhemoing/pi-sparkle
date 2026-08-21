# Specification: Adaptive Agent Work Loop

## Status

Proposed for review. This specification extends, but does not replace, the approved M0-M2 runtime architecture. M0-M2 remain the execution foundation; the capabilities below begin after Checkpoint C unless an explicitly bounded observability slice is pulled forward.

The M3–M6 headings in this document name the **adaptive library plane**. They are not a continuation of the runtime CLI milestones (M0–M2.5). Live execution uses flowchart + R0-equivalent `ModelRouter`; R1/bandit/topology stay shadow or parked until Checkpoint F.

## Objective

Build a native, evidence-driven improvement loop for `pi-sparkle` that can:

1. turn a project conversation into explicit requirements, constraints, acceptance criteria, and an executable task graph;
2. coordinate bounded single-model and multi-model work while preserving the minimum sufficient context between stages;
3. select models using task fit, observed quality, user preference, cost, latency, risk, and uncertainty;
4. review the whole project episode rather than only the final answer or diff;
5. learn durable user and project preferences from repeated, attributable evidence;
6. propose, evaluate, promote, roll back, and retire agent improvements without silently rewriting its own policy.

The target is not unrestricted self-modification. The target is **controlled adaptation**: every learned change is versioned, scoped, measurable, reversible, and promoted only after comparable evidence shows that it helps without violating guardrails.

## Why this is the right product boundary

Developer evidence points to a trust and integration problem, not merely a model-capability problem:

- The 2025 Stack Overflow Developer Survey reports that more developers distrust AI-tool accuracy than trust it and that developers remain especially cautious around deployment, project planning, security, and other systemic work.
- Empirical work on agent-generated pull requests finds substantial acceptance, but also significant human revision for project conventions, documentation, tests, design, and integration. Functional correctness alone is not a sufficient quality target.
- Harness-engineering practice distinguishes feedforward controls (rules, specs, architecture, examples) from feedback sensors (tests, type checks, linters, runtime evidence, reviews). Either side alone is incomplete.

Therefore `pi-sparkle` must optimize the **whole work loop**:

```text
intent -> contract -> plan -> execution -> verification -> delivery -> feedback
   ^                                                               |
   |---------------- controlled learning and promotion ------------|
```

## Governing principles

1. **User intent outranks inferred preference.** An explicit current instruction overrides all learned defaults.
2. **Deterministic evidence outranks model opinion.** Tests, type checks, schemas, policy gates, and observed runtime results are primary signals.
3. **A review is not a reward until it is attributable.** Every score or critique must identify the task, artifact, evaluator, rubric, evidence, and evaluated version.
4. **Configured capability is not observed use; observed use is not proven benefit.** Benefit requires a comparable later or held-out outcome.
5. **Separate execution from optimization.** Runtime traces are immutable inputs to an optimizer; the optimizer cannot mutate a live run.
6. **Promote candidates, never edit active policy in place.** Prompt, routing, memory, role, and workflow changes are versioned resources with lineage and rollback.
7. **Prefer the cheapest reliable control.** Schema/test/linter before LLM judge; one model before a cluster; targeted review before full debate.
8. **Ask only when the answer changes the plan or authority.** Do not burden the user with routine confirmations.
9. **Learning is scoped.** User-global, project, repository area, task family, role, model, and provider observations remain distinct.
10. **No hidden chain-of-thought dependency.** Persist actions, observations, concise rationales, critiques, and evidence references—not private reasoning traces.

## System overview

```text
Conversation / issue / spec / project state
                 |
                 v
        Intent & Contract Engine
                 |
        Requirement Contract v1
                 |
                 v
       Planner + Graph Validator
                 |
      Task Graph + Review Strategy
                 |
                 v
     Router ------+------ Context Compiler
       |                     |
       v                     v
 Model / cluster         Context Packets
       |                     |
       +------> M1/M2 execution runtime
                        |
              Events / artifacts / checks
                        |
                        v
               Evaluation Fabric
      deterministic + human + peer + judge
                        |
                        v
                Episode Outcome
                        |
          Preference & Learning Analyzer
                        |
               Improvement Candidate
                        |
          offline replay / shadow / canary
                        |
                        v
        Promotion Registry + Rollback Ledger
```

## Unit of analysis: Project Episode

A `ProjectEpisode` is one user goal with one acceptance boundary. It may span many turns, runs, child agents, or process restarts. Unrelated goals must not be merged merely because they occur in the same chat.

```ts
interface ProjectEpisode {
  id: EpisodeId;
  projectId: ProjectId;
  objective: string;
  contractVersion: number;
  runIds: RunId[];
  startedAt: IsoTimestamp;
  closedAt?: IsoTimestamp;
  status: "OPEN" | "WAITING_FOR_USER" | "COMPLETED" | "FAILED" | "ABANDONED";
  acceptance: AcceptanceCriterion[];
  evidenceRefs: EvidenceId[];
  outcomeId?: OutcomeId;
}
```

An episode is not complete because an agent says it is complete. Closure requires the declared acceptance policy: relevant final changes, verification evidence, delivery state, unresolved risks, and user decisions.

## End-to-end workflow

### Stage 0: Freeze scope, authority, and observation policy

Before interpreting the request, record:

- canonical project/workspace root and repository topology;
- active user, project, and task scope;
- allowed tools, side effects, cost/time/token budget, and model/provider policy;
- privacy policy for conversation, code, logs, model outputs, and feedback;
- current active resource versions: rules, prompts, skills, memories, router, judge rubrics, and workflow templates.

Output: `EpisodeOpened` plus a versioned `ExecutionPolicySnapshot`.

Fail closed when the root, authority, or policy cannot be resolved. Do not silently borrow global memories or credentials.

### Stage 1: Convert conversation into a requirement contract

The Intent & Contract Engine performs four passes:

1. **Extract** explicit goals, constraints, non-goals, acceptance statements, requested process, and side-effect authority.
2. **Ground** each claim in a user message, project document, code fact, or explicit assumption.
3. **Reconcile** conflicts using this precedence:
   - current explicit user instruction;
   - approved project spec/ADR/plan;
   - current repository facts and executable constraints;
   - durable explicit user preference;
   - inferred preference;
   - system default.
4. **Expose uncertainty** only when it materially changes architecture, safety, cost, or acceptance.

```ts
interface RequirementContract {
  schemaVersion: 1;
  objective: string;
  deliverables: Deliverable[];
  constraints: Constraint[];
  nonGoals: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  assumptions: Assumption[];
  questions: DecisionQuestion[];
  authority: AuthorityGrant[];
  sourceRefs: SourceRef[];
}
```

Every criterion must be observable. Replace “high quality” with concrete checks such as user-visible behavior, named tests, latency bounds, prohibited side effects, or review requirements.

**Contract review gate:** a separate critic receives only the contract, source excerpts, and project facts. It looks for omitted requirements, contradictions, untestable criteria, unsupported assumptions, and scope creep. For high-risk or ambiguous work, the user approves the contract before execution.

### Stage 2: Discover the project and compile task context

Project discovery produces a versioned `ProjectContextIndex` containing:

- instruction hierarchy and ownership;
- manifests, language/toolchain, commands, and supported environment;
- architecture/module map and relevant dependency boundaries;
- tests and fast/full validation routes;
- current git state and user-owned changes;
- known risks, migrations, security boundaries, and generated artifacts;
- prior episodes relevant to the same task family.

The context compiler does not dump the whole repository into every prompt. For each task it builds a bounded packet:

```ts
interface ContextPacket {
  taskId: TaskId;
  contractDigest: string;
  requiredFacts: ContextFact[];
  relevantFiles: ArtifactRef[];
  interfaces: ArtifactRef[];
  examples: ArtifactRef[];
  constraints: ConstraintRef[];
  priorLessons: LessonRef[];
  validationRoute: CheckRef[];
  omittedSummary: { reason: string; count: number }[];
  tokenBudget: number;
}
```

Context is selected by necessity, dependency distance, authority, freshness, and risk—not semantic similarity alone. A child receives the smallest packet sufficient for its task and requests additional facts through a structured message.

### Stage 3: Plan as a validated dependency graph

The planner transforms the contract into vertical, independently verifiable tasks. Each task defines:

- outcome and non-goals;
- dependencies and join rule;
- input/output contract;
- required context and authority;
- task family, skills, and capability requirements;
- verification and evidence requirements;
- expected cost/latency/risk;
- retry, escalation, and stop policy.

The graph validator checks completeness against the requirement contract, cycles, missing dependencies, oversized tasks, incompatible parallel writes, acceptance coverage, and irreversible steps.

A `CoverageMatrix` maps every requirement to one or more tasks and one or more checks. No orphan requirement may proceed unnoticed.

### Stage 4: Choose execution topology before choosing a model

The supervisor first selects the least complex topology likely to succeed:

1. deterministic tool only;
2. one agent, one pass;
3. one agent with bounded self-refinement;
4. actor + independent critic;
5. multiple independent candidates + ranker;
6. specialist pipeline;
7. bounded debate/consensus;
8. human decision boundary.

Escalation is justified by task risk, uncertainty, expected value of additional evidence, and prior failure—not by a blanket “more agents is better” rule.

Default topology by task:

- mechanical edits and deterministic transforms: tool or one agent;
- implementation with strong tests: actor + deterministic sensors;
- architecture/security/migration: independent specialists + adjudicator + user gate;
- ambiguous product intent: contract critic and user decision, not agent voting;
- hard open-ended solution search: diverse candidates then evidence-based ranking;
- repeated failure/local optimum: switch model or topology rather than repeat the same reflection.

### Stage 5: Route models using constrained expected utility

#### 5.1 Cold-start capability registry

Each model version has declared and measured attributes:

- provider, model/version, context limit, tool/vision/structured-output support;
- price and observed latency/reliability;
- benchmark priors by task family;
- policy restrictions and data-handling class;
- freshness and minimum sample count.

Static labels are priors, not truth.

#### 5.2 Task feature vector

The router derives only observable features:

```text
family, language, repository area, difficulty, ambiguity, context size,
tool needs, structured-output need, risk, reversibility, deadline,
quality floor, budget, privacy class, user style preference, topology role
```

#### 5.3 Utility

For model `m` and task `x`:

```text
U(m, x) = E[Q | m,x]
          + w_pref * E[P_user | m,x]
          - w_cost * normalizedCost(m,x)
          - w_latency * normalizedLatency(m,x)
          - w_risk * failureRisk(m,x)
          + explorationBonus(m,x)
```

Subject to hard constraints:

```text
capabilities satisfied
privacy/provider policy satisfied
predicted quality lower bound >= task quality floor
cost <= remaining budget
latency <= deadline
```

Quality is multi-dimensional; never collapse it too early:

```text
requirement coverage, functional correctness, test quality, architecture fit,
security, maintainability, review burden, user satisfaction, delivery reliability
```

#### 5.4 Algorithm progression

- **R0 rules:** explicit capability and policy filtering, then conservative static ranking.
- **R1 Bayesian estimates:** per `(task family, role, model version)` quality/cost/latency posterior with recency decay and confidence intervals.
- **R2 contextual bandit:** LinUCB or Thompson sampling over the filtered model set; exploration is bounded by risk and budget.
- **R3 pairwise preference router:** Bradley-Terry or pairwise classifier from blind A/B outcomes; calibrate quality-cost thresholds on project data.
- **R4 cluster policy:** estimate when an extra candidate or critic has positive expected value, including aggregation cost.

The router records `RoutingDecision`, candidate set, rejected reasons, feature version, policy version, expected utility, uncertainty, and later realized outcome.

Safety rules:

- no exploration on irreversible/high-risk actions;
- new model versions start in shadow or low-risk tasks;
- a model's self-rating does not update its own routing score;
- user overrides are stored as explicit constraints, not treated as objective quality labels;
- distribution shift or stale samples widen uncertainty and trigger fallback.

### Stage 6: Execute through bounded stage contracts

Every stage emits a compact `StageResult` rather than forwarding full transcripts:

```ts
interface StageResult {
  taskId: TaskId;
  status: "COMPLETED" | "FAILED" | "BLOCKED" | "NEEDS_DECISION";
  claims: Claim[];
  decisions: DecisionRecord[];
  changedArtifacts: ArtifactRef[];
  evidenceRefs: EvidenceId[];
  unresolved: OpenItem[];
  nextContext: ContextFact[];
  cost: UsageRecord;
}
```

Claims without evidence remain unverified. Full logs remain addressable artifacts when policy allows, but downstream agents receive summaries plus references.

#### Bounded self-refinement

Use `draft -> critique -> revise -> verify` only when:

- the artifact has a clear rubric;
- a critique can identify actionable defects;
- there is new evidence or a changed candidate;
- maximum iterations and no-progress stopping are defined.

Stop when deterministic acceptance passes, the critic reports no material issue, the score fails to improve beyond a minimum delta, feedback repeats, the budget is exhausted, or the user must decide.

#### Multi-agent peer review

Reviewers receive artifact + contract + evidence, not the author's defense. Each finding contains:

```text
criterion, severity, claim, evidence, affected artifact, suggested check,
confidence, reviewer model/version, rubric/version, conflict-of-interest metadata
```

Independent reviews run in parallel. A reconciler deduplicates by causal defect, classifies contract misreads/trade-offs/noise/actionable findings, and cannot invent a new finding without evidence.

Use pairwise blind comparison when selecting among candidate artifacts. Randomize A/B order and, for material decisions, swap order. Disagreement becomes uncertainty or escalation—not an averaged truth.

### Stage 7: Evaluate the whole episode

The Evaluation Fabric has four evidence tiers:

1. **Deterministic:** schemas, compiler, tests, lint, typecheck, security/static analysis, invariant checks, runtime assertions.
2. **Project outcome:** diff scope, acceptance coverage, CI, review changes, rollback, escaped defects, runtime health.
3. **Human:** explicit accept/reject, corrections, pairwise preference, rubric ratings, manual test result, override reason.
4. **Inferential:** self-review, peer critique, LLM judge, semantic architecture/security/product review.

Evidence precedence is tier-aware and criterion-specific. An LLM judge cannot overrule a failing test; a passing test cannot prove visual quality or user intent.

```ts
interface EvaluationRecord {
  id: EvaluationId;
  episodeId: EpisodeId;
  target: EvaluatedTarget;
  evaluator: EvaluatorIdentity;
  rubricVersion: string;
  criterionScores: CriterionScore[];
  findings: Finding[];
  evidenceRefs: EvidenceId[];
  confidence: number;
  independence: "SELF" | "PEER" | "EXTERNAL" | "HUMAN" | "DETERMINISTIC";
  createdAt: IsoTimestamp;
}
```

#### Judge controls

Because LLM judges show position, verbosity, and self-enhancement bias:

- use criterion-level rubrics and references where available;
- blind model identity and candidate lineage;
- randomize and swap pairwise order for consequential comparisons;
- separate judge model family from actor when practical;
- calibrate each judge against human labels and deterministic outcomes;
- track agreement, false-positive/negative rates, abstention, and drift;
- require `ABSTAIN` when evidence is insufficient;
- never train/promote solely on synthetic judge labels.

#### Episode outcome vector

Keep raw dimensions and provenance:

```text
requirement coverage
functional verification
change safety
maintainability/architecture
security/privacy
review rework
elapsed time
model/tool cost
user acceptance and corrections
delivery/rollback outcome
```

A scalar reward may be derived for a specific optimizer, but the vector remains authoritative to prevent metric gaming.

### Stage 8: Capture feedback without polluting preference memory

Feedback signals are classified before learning:

- **explicit preference:** “always show the plan first”;
- **task correction:** “this endpoint must remain private”;
- **artifact judgment:** accept/reject/rating/pairwise choice;
- **process preference:** desired autonomy, review depth, format, cadence;
- **behavioral observation:** user edited/reverted/ignored output;
- **project outcome:** tests, review revisions, CI, rollback, escaped defect;
- **peer/self assessment:** critique requiring independent corroboration.

Do not infer preference from silence, mere task completion, a single edit, or a click without context.

```ts
interface PreferenceObservation {
  subject: PreferenceSubject;
  scope: "TURN" | "EPISODE" | "PROJECT" | "USER_GLOBAL";
  statement: string;
  polarity: "PREFER" | "AVOID" | "REQUIRE";
  source: "EXPLICIT_USER" | "PAIRWISE" | "CORRECTION" | "BEHAVIOR" | "OUTCOME";
  evidenceRefs: EvidenceId[];
  confidence: number;
  validFrom: IsoTimestamp;
  expiresAt?: IsoTimestamp;
  contradicts?: PreferenceId[];
}
```

Promotion policy:

- explicit stable user statement can become a durable preference immediately, subject to scope;
- inferred preference requires repeated comparable episodes or direct confirmation;
- contradictions retain both observations, apply recency/specificity, and lower confidence;
- sensitive personal inference is prohibited unless explicitly supplied and useful;
- the user can inspect, correct, export, and delete learned preferences.

### Stage 9: Diagnose repeated patterns and assign credit

The analyzer clusters **structured episode signatures**, not raw transcript text. Default recurrence threshold: two independent comparable episodes; three or repeated explicit correction raises confidence.

Candidate patterns include:

- repeated requirement rediscovery;
- recurring user correction;
- relevant asset present but not routed;
- routed instruction not applied;
- recurring validation omission;
- model/task-family underperformance;
- excessive review rework;
- context bloat or missing context;
- retries without new evidence;
- successful procedure that is repeatedly reconstructed.

For every candidate, identify the earliest causal boundary supported by evidence:

```text
contract -> context -> plan -> route -> execution -> tool -> review -> delivery
```

Do not blame the selected model for missing requirements that never entered its task contract. Do not reward the planner for an outcome caused by a human rewrite. Credit assignment records uncertainty and competing explanations.

### Stage 10: Generate typed improvement candidates

An improvement is a versioned patch to one bounded resource:

- requirement extraction/rubric;
- project context rule or retrieval policy;
- task decomposition template;
- role prompt or stage contract;
- skill/example set;
- deterministic sensor/gate;
- model-routing prior/policy;
- memory/preference entry;
- topology/escalation policy;
- judge rubric/calibration;
- tool or adapter behavior.

```ts
interface ImprovementCandidate {
  id: CandidateId;
  target: ResourceRef;
  parentVersion: string;
  patch: ArtifactRef;
  hypothesis: string;
  supportedBy: EvidenceId[];
  affectedScopes: ScopeRef[];
  expectedBenefits: MetricDelta[];
  guardrails: Guardrail[];
  evaluationPlan: ExperimentPlan;
  risk: "LOW" | "MEDIUM" | "HIGH";
  status: "DRAFT" | "APPROVED" | "EVALUATING" | "REJECTED" | "PROMOTED" | "ROLLED_BACK";
}
```

The candidate generator may use natural-language reflection as a semantic gradient, but must distinguish diagnosis from proof. Maintain several candidates when they optimize different task families or objectives; do not greedily overwrite the global prompt.

### Stage 11: Evaluate candidates outside the live task

Use a reproducible promotion ladder:

1. **Static validation:** schema, lint, policy, secrets/privacy, resource compatibility.
2. **Offline replay:** evaluate on redacted historical episodes without writing into original workspaces.
3. **Train/validation/holdout split:** split by episode/time/project where possible to prevent leakage.
4. **Counterfactual shadow:** run candidate decisions beside baseline without taking side effects.
5. **Canary:** low-risk, reversible tasks only; fixed exposure and budget.
6. **Comparable live window:** measure later outcomes against baseline and guardrails.

For prompt/workflow optimization, use a GEPA-like loop:

```text
select parent candidate
-> sample failing/successful episode minibatch
-> collect criterion score + textual feedback
-> reflect on attributable failures
-> mutate one target component
-> evaluate on minibatch
-> if promising, evaluate on validation set
-> retain non-dominated candidates
```

Maintain lineage and a Pareto frontier across quality, preference fit, cost, latency, and risk. A candidate wins only on the metrics and scopes it was evaluated for.

Avoid training and validating on the same episodes. User feedback used to propose a change cannot by itself prove that change works.

### Stage 12: Promote, monitor, roll back, and retire

Default governance:

- low-risk memory/prompt/router changes: user-visible proposal and explicit approval for initial releases;
- mandatory rules, permissions, provider/credential policy, destructive tools, security boundaries, or global resources: always explicit approval;
- after the system has proven reliable, the user may opt into bounded auto-promotion for named low-risk resource classes.

Promotion requires:

- statistically or operationally meaningful improvement on the declared scope;
- no guardrail regression;
- minimum sample size or an explicit “provisional” state;
- rollback artifact and previous active version;
- change note explaining evidence and expected effect.

Monitor drift by model version, project distribution, task mix, user preference changes, and judge calibration. Automatically roll back on guardrail breach; otherwise propose rollback when the lower confidence bound crosses the configured degradation threshold.

## Token-efficient information flow

Use four layers:

1. `ContextPacket`: what a worker needs before acting.
2. `StageResult`: claims, decisions, artifacts, evidence, unresolved items.
3. `EpisodeDigest`: whole-task outcome and reusable lessons.
4. `ArtifactRef`: on-demand access to full code, logs, diffs, and reviews.

Compression rules:

- preserve constraints, IDs, decisions, failures, and evidence references verbatim;
- summarize repeated tool output and text deltas;
- never summarize an unresolved contradiction into one side;
- record omitted counts and reasons;
- give downstream stages a token budget and retrieval route;
- test summaries for answerability against required downstream questions.

## Event and storage model

M0-M2 JSONL remains the immutable run source of truth. Add separate append-only streams or event namespaces for:

```text
EPISODE_OPENED
REQUIREMENT_CONTRACT_CREATED
CONTRACT_REVIEWED
TASK_GRAPH_CREATED
CONTEXT_PACKET_CREATED
ROUTING_DECIDED
MODEL_INVOCATION_RECORDED
STAGE_RESULT_RECORDED
EVALUATION_RECORDED
USER_FEEDBACK_RECORDED
PREFERENCE_OBSERVED
EPISODE_CLOSED
PATTERN_DETECTED
IMPROVEMENT_CANDIDATE_CREATED
EXPERIMENT_STARTED
EXPERIMENT_RESULT_RECORDED
RESOURCE_PROMOTED
RESOURCE_ROLLED_BACK
RESOURCE_RETIRED
```

Recommended logical stores:

```text
state/runs/<run>/events.jsonl             existing run truth
state/episodes/<episode>/events.jsonl     cross-run task truth
state/evaluations/                        rubric-scoped evaluations
state/resources/<type>/<name>/<version>/ versioned prompts/rules/router/skills
state/experiments/<experiment>/           immutable candidate results
state/preferences/                        scoped observations and materialized views
state/registry/                           active-version pointers and rollback ledger
```

Raw conversation and tool bodies remain encrypted or reference-only according to policy. Learning data should use redacted semantic facets by default. Secrets, environment dumps, hidden reasoning, and unrelated user data must never enter optimization datasets.

### Consistency, deletion, and failure semantics

Cross-stream projections must be rebuildable and idempotent:

- every derived episode/evaluation/preference record stores its source event IDs and projection version;
- an episode stream may reference a run event only after that run event is durable;
- active-resource pointer changes use compare-and-swap plus an append-only promotion/rollback event;
- a crash between resource creation and pointer activation leaves an inactive candidate, never a half-promoted resource;
- replay detects dangling references, duplicate terminal events, hash mismatches, and incompatible schema versions and fails closed;
- schema evolution uses forward migrations that retain original events and records the migrator version.

User deletion is represented by an auditable tombstone and cryptographic/physical deletion of the protected payload. Derived views and future datasets must exclude tombstoned sources. Reports may retain non-identifying aggregate counts only when policy permits; they must not retain reconstructable content. Backup-retention limits and provider-side deletion remain explicit policy fields rather than implied guarantees.

### Threat model for learning and evaluation inputs

Conversation text, repository files, tool output, reviewer prose, and imported historical episodes are untrusted data. Before they reach a judge, optimizer, or context packet:

- label provenance and trust class;
- strip or quarantine instructions that are not authoritative for the target stage;
- apply secret, personal-data, and path redaction;
- enforce per-source size and token limits;
- keep tool execution unavailable to offline judges/optimizers unless the experiment explicitly grants a sandboxed tool profile;
- treat generated feedback as evidence about an artifact, never as authority to change policy.

Poisoning defenses include source diversity, duplicate/signature detection, minimum independent support, holdout evaluation, candidate diff review, and a prohibition on promoting a candidate whose only support is content generated by that candidate or its actor model.

## Statistical and experiment protocol

Before an experiment starts, freeze an `ExperimentPlan` with:

- hypothesis, target resource/scope, baseline, candidate, and primary outcome;
- guardrail metrics and automatic stop conditions;
- eligible episode population, exclusion rules, split strategy, and contamination checks;
- minimum sample/effect threshold or an explicitly justified operational threshold;
- randomization unit, seeds, model/provider versions, environment image, tool versions, and budget;
- missing-data, abstention, timeout, and user-intervention handling;
- analysis method, confidence/uncertainty reporting, and promotion authority.

Use paired evaluation on the same eligible episode when side effects can be isolated; otherwise use temporal or project-level holdouts and state the confounders. Report raw counts and dimension-level outcomes alongside aggregates. Do not repeatedly inspect a holdout and continue optimizing against it; rotate or seal compromised holdouts. Small samples remain `provisional` and cannot justify global promotion.

For online routing, log propensities for every eligible action so off-policy analysis remains possible. Exploration traffic is capped independently from task budgets, excludes high-risk tasks, and stops on any guardrail breach. “Regret versus best eligible model” is reported only where counterfactual outcomes were actually measured or estimated under a declared method; otherwise report observed utility and uncertainty without an oracle claim.

Deterministic reducers, schemas, routing policies, and dataset builders must
reproduce exactly from frozen inputs. External model calls are only
configuration-reproducible: record provider/model version, request settings,
resource hashes, context-packet hash, tool/environment versions, and response
hash, but do not promise byte-identical output. Repeated model evaluations
report run-to-run variance. Logged outcomes are selection-biased; comparisons
must use paired isolated runs or a predeclared off-policy estimator with
propensity overlap/effective-sample diagnostics before making a comparative
claim.

## Metrics

### Product success

- requirement recall and contradiction rate;
- acceptance-criterion coverage before execution;
- first-pass and eventual task success;
- user correction/reopen/revert rate;
- review rework and escaped defect rate;
- user-rated preference fit;
- cost and latency at fixed quality floor;
- successful resume/recovery and rollback;
- percentage of claims backed by valid evidence.

### Router quality

- regret versus best eligible model known after evaluation;
- quality at fixed cost and cost at fixed quality;
- calibration error and abstention rate;
- exploration spend and high-risk exploration count (must be zero);
- performance by task family, project, role, provider, and model version.

### Learning-loop quality

Use an evidence ladder:

```text
Missing -> Present -> Wired -> Exercised -> Outcome-supported
```

- `Present`: candidate/resource exists;
- `Wired`: retrieval/routing and evaluation path exists;
- `Exercised`: it was used in a real or replayed episode;
- `Outcome-supported`: a comparable later/held-out result improved without guardrail regression.

Do not report “self-improved” below `Outcome-supported`.

## Failure modes and controls

| Failure mode | Control |
| --- | --- |
| Reward hacking | Preserve metric vector, deterministic guardrails, holdout set, human audit |
| Judge bias or collusion | Blind identity, order swap, reference checks, cross-family judge, calibration |
| Self-review echo/local optimum | Independent critic, diversity trigger, topology/model switch, bounded rounds |
| Preference overfitting | Scope, confidence, recurrence threshold, decay, explicit override |
| Memory pollution | Typed observations, provenance, contradiction tracking, inspect/delete UI |
| Context explosion | StageResult/ArtifactRef boundary, token budgets, on-demand retrieval |
| False attribution | Causal boundary analysis, competing hypotheses, uncertainty |
| Non-stationary models | Version-specific records, drift detection, shadow requalification |
| Unsafe self-modification | Candidate registry, approval classes, sandboxed replay, rollback |
| Cross-project leakage | project/user scope separation, explicit sharing policy |
| Metric gaming by verbosity | criterion rubrics, normalized output comparison, judge calibration |
| Endless loops | max attempts/rounds/cost/time, novelty and minimum-delta stop |
| Multi-agent consensus error | independent evidence, dissent preservation, no majority override of tests |
| Data leakage | temporal/project holdout, provenance-aware dataset builder |

## Milestones after M2

### M3: Episode observability and evaluation foundation

- M3-T1: `ProjectEpisode` lifecycle and append-only event schemas.
- M3-T2: requirement contract plus requirement-to-check coverage matrix.
- M3-T3: conversation/project-source normalization, requirement extraction with labeled latent requirements routed to user confirmation, and independent contract critique.
- M3-T4: versioned `ProjectContextIndex` over instructions, code boundaries, tests, risks, dirty-worktree ownership, and a ranked code-map view with a token budget.
- M3-T5: bounded `ContextPacket` compiler and summary-fidelity checks.
- M3-T6: structured feedback/evaluation records and the redaction/trust boundary.
- M3-T7: deterministic episode closure and whole-loop inspection CLI.
- M3-T8: task-family taxonomy plus model invocation cost/latency telemetry.

Checkpoint D: one M2 workflow is reconstructable as an episode, every outcome dimension has evidence or is explicitly unobserved, bounded context packets preserve all fixture-critical facts without raw transcript forwarding, and no raw secret/private reasoning is persisted.

### M4: Review fabric and preference learning

- M4-T1: rubric registry and deterministic/inferential evaluator interface.
- M4-T2: project/code/delivery evaluator adapters for checks, diff scope, rework, rollback, and acceptance evidence.
- M4-T3: independent actor/critic and blind pairwise candidate comparison.
- M4-T4: scoped preference observation and materialized-view contracts.
- M4-T5: preference contradiction handling plus inspect/correct/export/delete CLI.
- M4-T6: repeated-pattern detector over structured episode signatures.

Checkpoint E: explicit feedback changes the next comparable task in a traceable way; inferred preference cannot promote from one ambiguous episode; judge bias tests pass.

### M5: Adaptive routing and model clusters

- M5-T1: capability registry, deterministic R0 router, and cost-cascade rules.
- M5-T2: Bayesian task-family outcome estimates and uncertainty-aware routing.
- M5-T3: router replay harness, propensity logging, a versioned multi-domain evaluation card, and static-baseline comparison.
- M5-T4: contextual bandit in shadow mode with hard policy/budget constraints.
- M5-T5: topology router for actor/critic/candidates/debate and expected-value stopping.

Checkpoint F: under a predeclared paired evaluation or valid off-policy estimator with overlap diagnostics, the router beats the static baseline on sealed held-out episodes at the declared cost-quality target, records zero policy violations, and can explain every decision from versioned inputs.

### M6: Controlled self-optimization

- M6-T1: typed improvement candidate and versioned resource registry.
- M6-T2: isolated offline replay and a sealed, rotating holdout evaluator.
- M6-T3: shadow/canary experiment runner with guardrail stops.
- M6-T4: reflective prompt/workflow optimizer bounded by the what/when/where axes, with candidate lineage, Pareto retention, and a predeclared topology search budget.
- M6-T5: versioned approval profiles plus compare-and-swap active-version pointers.
- M6-T6: drift monitor, automatic guardrail rollback, and retirement workflow.

Checkpoint G: at least one low-risk resource progresses from observed problem to candidate to held-out improvement to approved promotion, then survives a comparable later window without guardrail regression. A forced regression automatically rolls back.

### M7: Optional training integration

Only after M6 produces sufficient high-quality, consented data:

- export transition/trajectory datasets through a stable interface;
- integrate external SFT/preference/RL trainers rather than embedding GPU training in the runtime;
- selectively train router, critic, or open model weights;
- require separate model-risk, privacy, licensing, and deployment review.

M7 is optional. Prompt, context, routing, skills, sensors, and workflow optimization should deliver value before weight updates.

## Acceptance scenarios

1. **Requirement omission:** a request contains a privacy constraint in an early turn. The contract critic detects its absence before planning; no worker runs until resolved.
2. **Model routing:** a low-risk documentation task uses a cheaper model, while a migration review uses an eligible stronger model and independent critic. Both decisions cite task features, policy, and uncertainty.
3. **Peer disagreement:** two reviewers disagree after order swapping. The system records uncertainty and escalates rather than fabricating consensus.
4. **Preference correction:** the user explicitly rejects verbose progress reports. A scoped preference is visible and applied on the next task; a later opposite instruction overrides it without deleting history.
5. **False self-lesson:** a worker blames the model, but evidence shows the planner omitted a requirement. The improvement targets contract extraction, not routing.
6. **Safe evolution:** a proposed prompt improves replay training episodes but regresses holdout security review. It is rejected and never becomes active.
7. **Rollback:** a canary routing policy increases rework beyond threshold. The active pointer returns to the prior version and records the trigger.
8. **Token-bound handoff:** a child produces large logs. The parent receives bounded findings and artifact references, can retrieve the exact failing section, and does not receive the entire transcript.
9. **No-op learning:** a report finds no repeated, attributable pattern. The system records “no supported candidate” rather than generating optimization work to fill a quota.
10. **Outcome proof:** an improvement is marked `Exercised` after canary use but only becomes `Outcome-supported` after a later comparable episode improves with no guardrail regression.

## Explicit non-goals

- unrestricted autonomous changes to system prompts, permissions, credentials, or tools;
- treating model consensus as truth;
- storing or training on hidden chain-of-thought;
- global user profiling from incidental behavior;
- claiming causal improvement from before/after scores without comparable controls;
- replacing deterministic project tests with LLM review;
- embedding a full model-training platform in the TypeScript runtime before data quality is proven;
- maximizing agent count, loop length, or token use as a proxy for intelligence.

## Sources and design influences

Accessed 2026-08-12 unless otherwise stated.

### Developer use and harness practice

- Stack Overflow, “2025 Developer Survey — AI”: https://survey.stackoverflow.co/2025/ai
- Martin Fowler, “Harness engineering for coding agent users”: https://martinfowler.com/articles/harness-engineering.html
- Martin Fowler, “Maintainability sensors for coding agents”: https://martinfowler.com/articles/sensors-for-coding-agents.html
- “On the Use of Agentic Coding: An Empirical Study of Pull Requests on GitHub,” arXiv:2509.14745: https://arxiv.org/abs/2509.14745

### Open-source systems

- QoderAI Better Harness, Task Episodes and Agent Work Loop: https://github.com/QoderAI/better-harness
- SWE-agent trajectory format and reproducible experiments: https://github.com/SWE-agent/SWE-agent/blob/main/docs/usage/trajectories.md
- OpenHands Software Agent SDK and critic/refinement examples: https://github.com/OpenHands/software-agent-sdk
- RouteLLM preference-based routing: https://github.com/lm-sys/RouteLLM
- DSPy optimizers and GEPA documentation: https://dspy.ai/diving-deeper/choosing-an-optimizer/
- Microsoft Agent Lightning: https://github.com/microsoft/agent-lightning

### Academic foundations

- Reflexion, verbal reinforcement and episodic memory, arXiv:2303.11366: https://arxiv.org/abs/2303.11366
- Self-Refine, iterative feedback/refinement, arXiv:2303.17651: https://arxiv.org/abs/2303.17651
- LLM-as-a-Judge/MT-Bench bias and calibration, arXiv:2306.05685: https://arxiv.org/abs/2306.05685
- Chatbot Arena pairwise human preference and Bradley-Terry ranking, arXiv:2403.04132: https://arxiv.org/abs/2403.04132
- RouteLLM, preference-trained cost-quality routing, arXiv:2406.18665: https://arxiv.org/abs/2406.18665
- DSPy declarative self-improving pipelines, arXiv:2310.03714: https://arxiv.org/abs/2310.03714
- GEPA reflective prompt evolution and Pareto search, arXiv:2507.19457: https://arxiv.org/abs/2507.19457
- Agent Lightning execution/training disaggregation and transition-level credit, arXiv:2508.03680: https://arxiv.org/abs/2508.03680
- Multi-Agent Debate and degeneration-of-thought caution: https://aclanthology.org/2024.emnlp-main.992/

These sources inform mechanisms and risks; they do not prove that the combined
`pi-sparkle` design will improve real projects. In particular, benchmark and
paper results are not transferred into router priors as project evidence.
Every local benefit claim remains subject to the experiment and
`Outcome-supported` rules above.

## Decision required before implementation

Approve or revise these defaults:

1. M0-M2 remains the priority; M3 begins only after Checkpoint C.
2. Self-optimization initially proposes candidates but requires user approval to promote them.
3. No model-weight training is included before M7.
4. Raw conversation bodies are excluded from learning datasets by default; only redacted structured facets and references are used.
5. High-risk work never participates in online exploration.
6. “Improved” means held-out or comparable later benefit without guardrail regression—not a favorable self-review.
