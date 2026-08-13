# Research Brief: Evidence Behind the Adaptive Agent Work Loop

## Status

Research input, not implementation authority. The approved specification, ADRs, executable tests, and current repository code take precedence.

Accessed 2026-08-12. Paper and project results describe their evaluated settings; they do not prove the same effect in `pi-sparkle`.

## Evidence classes

- `Developer evidence`: observed developer attitudes or real repository workflows.
- `Runnable OSS mechanism`: source-visible implementation pattern that can be prototyped locally.
- `Academic mechanism`: evaluated research idea with stated benchmark/setting limitations.
- `Design inference`: a `pi-sparkle` decision derived from one or more sources and requiring local validation.

## Developer evidence

### Trust and oversight remain the central constraint

The 2025 Stack Overflow Developer Survey reports that more developers distrust AI output accuracy than trust it, with experienced developers especially cautious. Security/privacy concerns remain high, and developers are most resistant to high-responsibility systemic tasks such as deployment and project planning.

**Design inference:** autonomy must scale with evidence and reversibility. High-risk tasks need deterministic gates and human authority; adding more models is not a substitute for trustworthy sensors.

Source: https://survey.stackoverflow.co/2025/ai

### Real agentic PRs still need project-specific refinement

The study “On the Use of Agentic Coding” examined 567 agent-generated PRs across 157 projects. It reports an 83.8% acceptance rate and 54.9% accepted without revisions; revisions frequently addressed bug fixes, documentation, refactoring, style, and project context. This is one ecosystem and period, not a universal success estimate.

**Design inference:** evaluate the full requirement/project/delivery episode, not only compilation or a generated patch. Project conventions, review rework, and acceptance remain explicit outcome dimensions.

Source: https://arxiv.org/abs/2509.14745

### Feedforward and feedback controls are complementary

Harness-engineering practice separates guides available before action from sensors available after action, and deterministic computational controls from slower inferential controls.

**Design inference:** requirement contracts, architecture rules, and context packets reduce error probability; tests, lint, runtime checks, and reviews detect/correct errors. Repeated failures should improve the responsible control, but only later comparable outcomes prove benefit.

Sources:

- https://martinfowler.com/articles/harness-engineering.html
- https://martinfowler.com/articles/sensors-for-coding-agents.html

## Open-source mechanisms

### Better Harness: Task Episodes and longitudinal learning evidence

Source-visible mechanisms include:

- a Task Episode as one user goal with one acceptance boundary;
- independent session, project-harness, and configured-agent evidence lanes;
- explicit unavailable/unobserved states;
- distinction between capability presence, wiring, exercise, and later outcome support;
- recurrence/negative controls before recommending a durable procedure or knowledge asset;
- an intervention ledger that defers effectiveness claims until comparable later work.

**Adopt:** Project Episode, evidence maturity ladder, independent evidence lanes, pattern negative controls, intervention/promotion ledger.

**Do not copy:** its report-oriented fixed dimension model as a universal router reward; its host-specific evidence collectors; a periodic report as the online runtime itself.

Source: https://github.com/QoderAI/better-harness

### SWE-agent: versioned trajectories and reproducible experiment artifacts

SWE-agent persists action/observation trajectories, configuration, predictions, and separate evaluation artifacts. It also supports turning selected trajectories into demonstrations.

**Adopt:** immutable trajectory/event records, frozen configuration, separation of generation and evaluation, derived demonstrations with provenance.

**Do not copy:** raw thought storage as a required learning input. `pi-sparkle` records observable actions, outcomes, concise rationales, and evidence; hidden reasoning is excluded.

Source: https://github.com/SWE-agent/SWE-agent/blob/main/docs/usage/trajectories.md

### OpenHands: execution/evaluation separation and software-agent benchmarks

OpenHands exposes an agent SDK and separate benchmark infrastructure, including software-engineering and safety scenarios. Critic/reranking work shows the value of multiple complete trajectories where budget allows.

**Adopt:** stable runtime/evaluator boundary, isolated workspaces, benchmark adapters, optional candidate generation and ranking.

**Do not copy:** benchmark scores as model-routing truth for a user's project; expensive multi-trajectory selection as the default topology.

Sources:

- https://github.com/OpenHands/software-agent-sdk
- https://github.com/OpenHands/benchmarks

### RouteLLM: preference-based quality/cost routing

RouteLLM frames routing between stronger and weaker models using preference data and quality-cost thresholds.

**Adopt:** pairwise outcomes, calibrated probability that one eligible model beats another, explicit cost-quality operating point.

**Do not copy unchanged:** binary strong/weak assumptions for a heterogeneous multi-role cluster; public preference data as a user's preference profile.

Sources:

- https://github.com/lm-sys/RouteLLM
- https://arxiv.org/abs/2406.18665

### DSPy and GEPA: versioned prompt-program optimization

DSPy treats LM pipelines as compositional programs evaluated by metrics. MIPROv2/GEPA optimize instructions/examples, using training/validation data. GEPA uses textual reflection, candidate lineage, minibatch/full evaluation, and Pareto retention.

**Adopt:** typed prompt/workflow resources, metric-driven candidate evaluation, module-specific feedback, lineage, sealed holdout, Pareto frontier.

**Do not copy unchanged:** Python runtime dependency, benchmark-specific metrics, or automatic promotion of the best validation prompt.

Sources:

- https://github.com/stanfordnlp/dspy
- https://dspy.ai/diving-deeper/choosing-an-optimizer/
- https://arxiv.org/abs/2507.19457

### Agent Lightning: decouple execution from optimization

Agent Lightning proposes tracing agent execution as structured transitions and training selected agents without tightly coupling training logic to the runtime.

**Adopt:** execution/learning-plane separation, structured transition/span export, selective optimization by role/resource.

**Defer:** reinforcement learning and model-weight updates until enough consented, high-quality, attributable data exists; keep GPU training outside the TypeScript runtime.

Sources:

- https://github.com/microsoft/agent-lightning
- https://arxiv.org/abs/2508.03680

## Academic mechanisms and cautions

### Reflexion and Self-Refine

Reflexion turns environmental feedback into verbal episodic lessons; Self-Refine iterates feedback and revision without weight updates.

**Adopt:** natural-language critique as an interpretable candidate-generation signal; bounded `draft -> critique -> revise -> verify` loops.

**Caution:** self-evaluation can misassign credit and repeat the same local optimum. Reflection cannot prove correctness or promote its own prompt.

Sources:

- https://arxiv.org/abs/2303.11366
- https://arxiv.org/abs/2303.17651

### LLM-as-a-Judge and Chatbot Arena

MT-Bench/LLM-as-a-Judge research documents position, verbosity, self-enhancement, and reasoning biases while showing useful agreement in evaluated settings. Chatbot Arena uses anonymous randomized pairwise human preferences and Bradley-Terry estimation.

**Adopt:** criterion rubrics, blind identity, A/B randomization and order swap, pairwise user feedback, confidence intervals, judge calibration, abstention.

**Caution:** model agreement is not ground truth; pairwise preference indicates preference between presented candidates, not absolute correctness; user/task populations and model versions change.

Sources:

- https://arxiv.org/abs/2306.05685
- https://arxiv.org/abs/2403.04132

### Multi-agent debate

Debate and verification can add search diversity, but shared model priors and persuasive errors can produce consensus without truth. Degeneration-of-thought research cautions that agents can be pulled toward erroneous reasoning.

**Adopt:** independent generation before communication, evidence-bound criticism, dissent preservation, and escalation on disagreement.

**Caution:** no majority vote may override deterministic failure, security policy, or unresolved user intent. Debate is a selected topology, not the default.

Source: https://aclanthology.org/2024.emnlp-main.992/

## Consolidated design choices

| Need | Initial mechanism | Upgrade trigger | Required local proof |
| --- | --- | --- | --- |
| Requirement understanding | typed contract, source refs, coverage gate | recurring attributable omissions | held-out contract fixtures and later lower correction rate |
| Context transfer | deterministic bounded ContextPacket | packet misses critical downstream fact | answerability/fidelity fixtures and token reduction without quality loss |
| Agent topology | conservative rule table | repeated task-family evidence that extra agents help | paired cost-quality evaluation |
| Model routing | eligibility filter + static ranking | sufficient versioned outcomes and overlap | sealed replay/shadow result with policy compliance |
| User preference | explicit scoped observations | repeated comparable implicit evidence | user-inspectable application and fewer corrections |
| Peer review | independent critic + deterministic sensors | material judge-human calibration exists | bias fixtures and outcome correlation |
| Prompt/workflow change | proposal-first candidate registry | stable replay/holdout/canary infrastructure | outcome-supported later result, no guardrail regression |
| Weight training | no support before M7 | sufficient consented, attributable dataset | separate model-risk/privacy/licensing review |

## Rejected shortcuts

- Use the strongest model for every stage.
- Route from model marketing labels or one aggregate leaderboard.
- Store whole conversations as undifferentiated memory.
- Let the actor grade and promote itself.
- Convert every user edit or silence into a preference.
- Average tests, user satisfaction, security, cost, and style into one unqualified reward.
- Forward every transcript to every child to avoid designing context contracts.
- Declare improvement from the same episodes used to propose or tune the change.
- Add debate or more agents whenever uncertainty exists.
- Let an optimizer modify live prompts, permissions, or active resource pointers.

## Local validation obligation

The combined design is a hypothesis. `pi-sparkle` must validate each mechanism under its own projects, users, providers, models, budgets, and safety policies. Unsupported evidence remains unavailable; small samples remain provisional; only held-out or comparable later benefits without guardrail regression are `Outcome-supported`.
