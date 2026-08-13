# Modification-Point Validation: Adaptive Agent Work Loop

## Status

Research input, not implementation authority. The approved specification, ADRs, executable tests, and current repository code take precedence.

All sources below were checked on 2026-08-12: arXiv IDs were verified against the arXiv API, and every cited URL returned HTTP 200. Paper and project results describe their evaluated settings; they do not prove the same effect in `pi-sparkle`. Optimizations marked "written into the plan" are proposed plan changes that still require the normal approval gates before any M3-M6 implementation.

## 1. Concrete modification points

28 modification points organized into 8 clusters. Status: `validated` = existing design matches independent evidence; `optimized` = research produced a concrete design change, now written into the plan; `open` = needs a user decision.

| ID | Modification | Task | Status | Code home |
| --- | --- | --- | --- | --- |
| MP-01 | `ProjectEpisode` as the cross-run review/learning unit | M3-T1 | validated | `src/episode/` (mirrors `src/run/`) |
| MP-02 | Typed `RequirementContract` + `CoverageMatrix` | M3-T2 | validated | `src/requirements/` |
| MP-03 | Native requirement extraction + independent contract critic | M3-T3 | optimized | `src/requirements/` |
| MP-04 | Versioned `ProjectContextIndex` | M3-T4 | optimized | `src/context/` + `src/project/discovery.ts` |
| MP-05 | Bounded `ContextPacket` + fidelity checks | M3-T5 | validated | `src/context/` |
| MP-06 | Structured feedback/evaluation + redaction/tombstone | M3-T6 | validated | `src/evaluation/`, `src/privacy/` |
| MP-07 | Deterministic episode closure + inspection CLI | M3-T7 | validated | `src/episode/`, `src/cli/main.ts` |
| MP-08 | Task taxonomy + model invocation telemetry | M3-T8 | validated | `src/routing/features.ts`, `src/telemetry/` |
| MP-09 | Rubric registry + evaluator interface | M4-T1 | validated | `src/evaluation/` |
| MP-10 | Project/code/delivery evaluator adapters | M4-T2 | validated | `src/evaluation/` |
| MP-11 | Independent actor/critic + blind pairwise review | M4-T3 | validated | `src/evaluation/` |
| MP-12 | Scoped preference observations + views | M4-T4 | optimized | `src/preferences/` |
| MP-13 | Preference inspect/correct/export/delete | M4-T5 | validated | `src/preferences/`, `src/cli/` |
| MP-14 | Repeated-pattern detector with negative controls | M4-T6 | validated | `src/learning/` |
| MP-15 | Capability registry + deterministic R0 router | M5-T1 | optimized | `src/routing/` |
| MP-16 | Bayesian task-family estimates | M5-T2 | validated | `src/routing/` |
| MP-17 | Router replay + propensity + baseline comparison | M5-T3 | optimized | `src/routing/` |
| MP-18 | Contextual bandit in shadow mode | M5-T4 | validated | `src/routing/` |
| MP-19 | Execution-topology router | M5-T5 | validated | `src/routing/` |
| MP-20 | Typed improvement candidate + resource registry | M6-T1 | validated | `src/adaptation/` |
| MP-21 | Isolated replay + sealed holdout | M6-T2 | optimized | `src/experiments/` |
| MP-22 | Shadow/canary experiment runner | M6-T3 | validated | `src/experiments/` |
| MP-23 | Reflective prompt/workflow optimizer | M6-T4 | optimized | `src/experiments/` |
| MP-24 | Approval + compare-and-swap promotion | M6-T5 | optimized | `src/adaptation/` |
| MP-25 | Drift monitor + automatic rollback + retirement | M6-T6 | validated | `src/adaptation/` |
| MP-26 | Execution/adaptation plane separation (ADR-004) | P0 | validated | architecture |
| MP-27 | Frozen experiment protocol, paired/off-policy statistics | P0 | validated | cross-cutting |
| MP-28 | Evidence ladder + evidence precedence | P0 | validated | cross-cutting |

## 2. Validation and optimizations per cluster

### Cluster 1 — Requirement understanding (MP-02, MP-03)

**OSS:** `github/spec-kit` shows the value of a spec-first contract as an explicit project workflow. MP-02 already accepts structured input before LLM extraction, matching this practice.

**Paper:** LENS, "LLM-Based Discovery of Latent Requirements from Stakeholder Conversations" (arXiv:2606.25867) extracts explicit requirements and infers additional *latent* requirements from interview transcripts, representing both as user stories. Industry findings are preliminary.

**Conclusion and optimization:**

- Keep the design: source-attributed contract, independent critic, low-confidence routing to the user.
- Add: a `LatentRequirement` category. Inferred requirements must be labeled as inference and routed to user confirmation unless an explicit source already corroborates them. *Written into M3-T3.*
- Caution retained: preliminary industry results justify the conservative default, not an autonomous interpretation layer.

### Cluster 2 — Project context and bounded packets (MP-04, MP-05)

**OSS:** aider's repository map (https://aider.chat/docs/repomap.html) builds a concise, ranked map of classes/functions with signatures from the whole repo and uses it inside a token budget. This is exactly the missing "code map" view in MP-04.

**Paper:** MemGPT (arXiv:2310.08560, OSS `letta-ai/letta`) manages a main-context/archival hierarchy with retrieval on demand ("virtual context management"). This validates MP-05's packet + artifact-ref + structured `ContextRequest` design and its rejection of whole-transcript forwarding.

**Conclusion and optimization:**

- Add to the index: a ranked code-map view (public interfaces, call structure) with its own token budget, in addition to file-level manifests/commands. *Written into M3-T4.*
- Keep: deterministic incremental refresh, stale-hash invalidation, dirty-worktree ownership (already planned).

### Cluster 3 — Evaluation and feedback fabric (MP-06, MP-09..11)

**OSS/paper:** OpenHands benchmark separation and the LLM-judge bias literature (MT-Bench, arXiv:2306.05685) were already adopted. The agentic-PR study (arXiv:2509.14745) motivates binding final validation to the final change set.

**Conclusion:** validated as-is; no new optimization. The blind-identity, order-swap, and abstention controls already answer the documented judge biases.

### Cluster 4 — Preference learning (MP-12..14)

**OSS:** Mem0 (`mem0ai/mem0`) provides user-scoped add/search/update/delete memory, confirming that inspect/correct/export/delete is the expected lifecycle. Mem0's cloud-default model also confirms the risk profile: `pi-sparkle` keeps preferences local and redacted.

**Paper:** "Toward Personalized LLM-Powered Agents" (arXiv:2602.22680) organizes personalization into profile modeling, memory, planning, and action execution, and highlights evaluation gaps. Long-horizon, cross-interaction adaptation is the setting where personalization is reliable — supporting the recurrence thresholds and rejecting one-shot inference.

**Conclusion and optimization:**

- Add evaluation dimensions for the preference loop: correction cost and forgetting/reversal behavior, alongside preference fit. *Written into M4-T4.*
- Keep: explicit > inferred, scope separation, confidence/provenance, decay, contradiction tracking.

### Cluster 5 — Model routing and clusters (MP-08, MP-15..19)

**Papers:**

- FrugalGPT (arXiv:2305.05176) formalizes cascade strategies: try a cheap model with a confidence gate, escalate only when needed. This fits R0 as a deterministic, explainable policy.
- RouterArena (arXiv:2510.00202) builds a standardized router comparison: broad domain coverage, per-domain difficulty tiers, multiple metrics, automated leaderboard updates. Its initial leaderboard places popular learned routers (RouteLLM ≈ 58.0, NotDiamond ≈ 59.4) well below the best scoring router (≈ 67.3) — one benchmark snapshot, but a concrete reason to keep the conservative R0/R1 ladder instead of jumping to a learned router.
- RouteLLM (already adopted) covers pairwise preference data and quality-cost operating points.

**Conclusion and optimization:**

- Add deterministic cascade rules to the capability registry/R0. *Written into M5-T1.*
- Require the replay harness to use a versioned evaluation card with domain coverage, difficulty tiers, and multiple metrics — not only local task replay. *Written into M5-T3.*
- Keep: propensity logging, overlap/effective-sample diagnostics, zero high-risk exploration, shadow-only bandits.

### Cluster 6 — Controlled self-optimization (MP-20..25)

**Papers:**

- "A Survey of Self-Evolving Agents" (arXiv:2507.21046) organizes evolution along what (model/memory/tools/architecture), when (intra- vs inter-test-time stages), and how. This gives the M6 scope its axes.
- ADAS (arXiv:2408.08435) shows a meta-agent discovering new agents by programming them in code and evaluating on downstream tasks. Its known costs are evaluation budget and overfitting to the dev tasks.
- AFlow (arXiv:2410.10762) searches over code-represented workflows with MCTS, validating the workflow-as-a-versioned-resource representation.
- SWE-bench Live (arXiv:2505.23419, `Microsoft/SWE-bench-Live`) shows that the same agent-model pair scored 43.2% on the static SWE-bench Verified but only 19.25% on continuously refreshed live tasks — direct evidence that repeatedly re-inspected static holdouts go stale. It refreshes monthly while keeping verified/lite splits frozen.
- GEPA (already adopted) supplies reflective candidates, lineage, and Pareto retention.

**Conclusion and optimization:**

- Bound the optimizer by the what/when/where axes: resource type, offline inter-test-time adaptation only, prompt/workflow/routing parameterization (no weights before M7). *Written into M6-T4.*
- Seal and rotate holdouts on a schedule; a holdout repeatedly used for optimization is marked compromised and replaced. *Written into M6-T2.*
- Topology search runs only under a predeclared budget on low-risk task families. *Written into M6-T4.*
- Keep: no self-supporting candidates, CAS promotion, approval gating, automatic guardrail rollback.

### Cluster 7 — Architecture and statistical guardrails (MP-26..28)

Validated by Agent Lightning's execution/training disaggregation and the existing statistical-protocol section. No new optimization.

### Cluster 8 — Review unit and closure (MP-01, MP-07)

Validated by Better Harness Task Episodes and SWE-agent trajectory practices (already in the evidence brief). No new optimization.

## 3. Code-scenario adaptation

Current conventions the new modules must follow (verified against the repository):

- `src/domain/*`: branded IDs from `ids.ts`, validators throwing `DomainValidationError`, `schemaVersion` fields, `isRecord` guards. New contracts (`EpisodeId`, `RequirementContract`, `ContextFact`, `EvaluationRecord`, `PreferenceObservation`, resource versions) follow this pattern.
- `src/run/*`: append-only JSONL `EventStore`, atomic `CheckpointStore`, replay reducer. MP-01 should mirror this trio under `src/episode/` rather than invent a new persistence abstraction; cross-stream run references are validated only after the referenced run events are durable.
- `src/project/discovery.ts` already discovers instructions, manifests, commands, and the git root. MP-04 builds `ProjectContextIndex` *on top of* `discoverProject` output (additive, new module) — do not rewrite discovery.
- `src/execution/contract.ts` defines `AgentExecutor`; MP-08 telemetry hooks into `src/pi-adapter/pi-executor.ts` as additive instrumentation, keeping the Pi-boundary test intact.
- `src/cli/main.ts` gains `episode inspect/events/close` subcommands additively.
- Testing: `tsx --test` runner, `test/unit` vs `test/integration` split, fixture-first tests, faux providers in the style of `src/testing/fake-executor.ts`. Deterministic fixtures are mandatory for every model-calling component.
- Dirty-worktree discipline: T5 files (`src/cli/`, `src/pi-adapter/`, `src/project/discovery.ts` context) are modified only additively and only when their task starts.

## 4. How to optimize self-evolution itself

1. **Fix the three axes before writing the optimizer (M6-T4).** What evolves: memory, prompts, context selectors, rubrics, routing policy, workflow topology — never weights before M7. When: offline, inter-test-time only; live runs always use frozen approved versions. Where: typed parameters of versioned resources, never in-place edits.
2. **Rotate and seal holdouts (M6-T2).** Static holdouts go stale; the SWE-bench Live gap (43.2% → 19.25% under the same setup) is the strongest published warning. Schedule rotation, freeze the frozen split for comparability, and mark compromised holdouts.
3. **Pre-register the search budget (M6-T4).** ADAS-style search over topologies/prompts consumes evaluation budget and overfits dev tasks without controls. Cap the number of candidates per epoch, restrict topology search to low-risk task families, and report the budget spent.
4. **Require external support.** A candidate supported only by itself or its actor model cannot promote (already in the spec) — keep this as the anti-collapse rule.
5. **Make promotion a budgeted, classed decision (M6-T5).** Approval profiles are themselves versioned resources; the default stays proposal-first; only explicitly user-approved classes may auto-promote, and only inside a bounded budget.

## 5. How to make the project flow more flexible

1. **Per-task fast-path.** Aider's architect/editor split shows that topology choice per task is practical. Let the planner default to the simplest topology, let the user override ("just do it" / "review everything"), and record the override as an explicit instruction (it outranks learned defaults).
2. **Spec-first as an option, not an obligation.** `github/spec-kit` projects will want to feed an accepted spec directly into the contract (MP-02 already supports structured input first). Projects without specs keep the native extraction path.
3. **Approval profiles.** Default proposal-first, but let users define classes of low-risk resources that may auto-promote inside a bounded budget, and always-approve classes (security, permissions, credentials, global rules) that can never auto-promote. Profiles are versioned resources with rollback. *Written into M6-T5 and P0.*
4. **Stage parallelization.** M3-T8 telemetry and a minimal M4-T1 rubric set can be pulled forward as observability-only slices (the plan already allows an approved spike). Explicitly allow M4-T1 to define the two or three rubrics M3-T6 needs, so evaluation records are rubric-attributed from day one.
5. **The boundary of flexibility stays fixed:** evidence maturity, deterministic-gate precedence, reversibility, and the no-online-exploration rule for high-risk work.

## 6. Do we need crowd data, and how to collect it

**Conclusion: not needed for M3-M6.** Single-user, multi-project local evidence is sufficient to build and validate every mechanism above (paired episodes, per-task-family priors, sealed holdouts, candidate gates). Crowd data becomes worth its governance cost only later, for three specific purposes:

1. **Router priors that generalize** across users, project types, and providers (RouteLLM/RouterArena-style preference pools).
2. **Fresh benchmark tasks** to fight static-benchmark overfitting (SWE-bench Live's monthly-refresh pattern, built from public repositories).
3. **Rare failure-mode coverage** for pattern detectors and rubrics.

**How to collect, if later approved:**

1. **Opt-in export only.** The user explicitly exports episode facets; nothing leaves the machine by default. Purpose, retention, and revocation are stated before export.
2. **Redact and aggregate locally first.** Only structured, redacted facets (task family, outcome dimensions, costs, anonymized signatures) leave the machine; raw conversations, prompts, paths, and secrets never do (already the P0 rule).
3. **Two public channels, modeled on existing practice.** Anonymous pairwise preference votes (Chatbot Arena / Bradley-Terry style, LMSYS-Chat-1M consent practice) and public-repository task instances (SWE-bench Live style) carry no user content.
4. **Differential privacy for any learned statistics.** Dataset builders apply DP noise/aggregation so single users cannot be reconstructed; this becomes part of the M7 dataset-builder contract, not an afterthought.
5. **Attribution and license policy** for anything derived from community tasks (LMSYS-Chat-1M is CC-BY-licensed with consent; Arena records explicit use consent).
6. **Kill switch, export, and delete** for every contributed record class, mirroring the local tombstone semantics.

**Red lines (frozen in P0):** crowd collection defaults to off until explicit approval; hidden reasoning, secrets, PII, and raw conversation bodies are never collected; high-risk task data never participates in any shared dataset.

## 7. Changes written into the plan by this validation pass

- P0: freeze the crowd-data default-off decision.
- M3-T3: latent/inferred requirements are labeled and user-confirmed unless corroborated.
- M3-T4: ranked code-map view with token budget added to the index.
- M4-T4: correction-cost and forgetting/reversal dimensions added to preference evaluation.
- M5-T1: deterministic cost-cascade rules in the capability registry.
- M5-T3: versioned multi-domain/difficulty/metric evaluation card for router replay.
- M6-T2: holdout sealing, rotation schedule, compromised-holdout marking.
- M6-T4: what/when/where search-space axes + predeclared topology search budget.
- M6-T5: approval profiles as versioned resources.
- Verification: focused `tsx --test` runs must assert at least one intended test was collected.

## 8. New sources added by this pass

All verified HTTP 200; arXiv IDs verified via the arXiv API on 2026-08-12.

- LENS latent requirement extraction: https://arxiv.org/abs/2606.25867
- MemGPT virtual context management: https://arxiv.org/abs/2310.08560 and https://github.com/letta-ai/letta
- Personalized LLM-Powered Agents survey: https://arxiv.org/abs/2602.22680
- RouterArena: https://arxiv.org/abs/2510.00202
- ADAS, automated design of agentic systems: https://arxiv.org/abs/2408.08435
- AFlow, automated workflow generation: https://arxiv.org/abs/2410.10762
- FrugalGPT cascades: https://arxiv.org/abs/2305.05176
- LMSYS-Chat-1M: https://arxiv.org/abs/2309.11998
- Self-Evolving Agents survey: https://arxiv.org/abs/2507.21046
- SWE-bench Live: https://arxiv.org/abs/2505.23419 and https://github.com/Microsoft/SWE-bench-Live
- Aider repository map: https://aider.chat/docs/repomap.html
- Aider usage modes: https://aider.chat/docs/usage/modes.html
- Mem0: https://docs.mem0.ai/introduction and https://github.com/mem0ai/mem0
- GitHub Spec Kit: https://github.com/github/spec-kit
