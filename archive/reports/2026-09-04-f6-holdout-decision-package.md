<!--
Produced by three-model cross-validation over the xhh relay on 2026-09-04:
R1 propose xhh/claude-fable-5 (run_96745e08), R2 adversarial challenge xhh/gpt-5.6-sol (run_b620a0a0),
R3 synthesis xhh/kimi-k3, host adjudication in .agent_workspace/dogfood/r2-adjudication.md.
Status: PROPOSAL awaiting owner sign-off on the five questions in section 5.
-->

# FINAL F6 DECISION PACKAGE — Sealed Holdout for ADR-005 Checkpoint F-PROD (pi-sparkle)

git_root=E:\Project\pi-sparkle; manifests: package.json, pnpm-workspace.yaml, tsconfig.json; pnpm workspace; validation routes build / dev / lint / test / typecheck; tests via `node scripts/run-tests.mjs`. Synthesized from the R1 proposal, the R2 adversarial challenge, and the orchestrator adjudication (F6 verdict: AMEND — Candidate A survives; challenges C1–C3, C5–C9 are valid and are absorbed below).

---

## 1. DECISION

The sealed holdout data source for closing ADR-005 checkpoint F-PROD is **Candidate A: prospective, purpose-authored dogfood episodes executed on the pi-sparkle repository by real models over the xhh relay (claude-fable-5 / gpt-5.6-sol / kimi-k3), logged to runtime/invocations.jsonl**, run as a clean-room paired-block design (adaptive routing vs. frozen static R0). Candidate D (opt-in external user traffic) is a **separately pre-registered secondary stratum** with fixed inclusion rules — never appended ad hoc to the confirmatory sample. Candidate B (public issue/PR benchmark) is rejected for unfixable model-side training contamination and missing harness; Candidate C (synthetic-sealed tasks) is rejected as primary because its task distribution is not production-class under ADR-005 gate (2) and risks collapsing into simulation-class if generator logic touches the deterministic fake executor — at most it may appear later as an explicitly labeled robustness set. Candidate A is chosen because it is the only source that is (a) unambiguously real-execution (tokens, latency, provider calls are genuine xhh invocations, not replay/simulation), (b) feasible at the required n within 4 weeks at moderate cost, and (c) scoreable against the repo's own validation routes (build/lint/typecheck/`node scripts/run-tests.mjs`) plus task-specific oracles. Its sealing weakness is addressed procedurally via the commitment-and-custodian protocol in §2/§3. **Contingent qualification:** whether prospective purpose-authored dogfood tasks on the development repository count as "production" under ADR-005 is a human interpretation call — flagged in §5; F-PROD closure on this package proceeds only if the owner answers yes.

---

## 2. DESIGN (corrected; absorbs adjudicated challenges C1–C3, C5–C9)

### 2.1 Unit definitions (C2)
- **taskSpec** — one sealed, custodian-held task description (spec, base commit, oracle, family label).
- **armRun** — one execution of one taskSpec under one arm (adaptive or R0). armRuns are the unit of cost/telemetry accounting and are reported separately, but are NOT the analytic unit.
- **pairedBlock** — one taskSpec executed under both arms from the same immutable base commit; the unit of inference. All power math and both ADR-005 gate CIs apply to **per-block deltas** (adaptive − R0) across independent pairedBlocks.
- ADR-005 floor reading: "100 episodes, 30 per claimed family" is conservatively interpreted as **100 pairedBlocks total, ≥30 pairedBlocks per claimed family** (i.e., 200 armRuns minimum for the confirmatory sample). This is the strictest reading of the three possible (task / armRun / pair) and is adopted so the floor argument survives any unit interpretation.

### 2.2 Clean-room arm isolation (C1)
- Each armRun executes from the **same immutable base commit** in an **independently provisioned, disposable git worktree** with its **own state root**: separate runtime state directory, separate logs, unique run ID, fresh session/conversation identity, and isolated build/dependency caches (no shared `node_modules` build artifacts, no shared tool caches; ASSUMPTION: pnpm store is content-addressed and read-only-safe — to be verified in Week 0; if not, per-arm pnpm stores).
- **Cache policy:** provider-side prompt caching disabled where the xhh relay supports it; where it cannot be disabled, cache metadata must be recorded per invocation and any armRun showing a cache hit on holdout-derived content voids the pair (replacement per §2.7). Identical prompts across arms are expected (same spec) — this is precisely why caching must be off or detected.
- **Cross-arm information barrier:** neither arm's patch, output, adjudication, or telemetry is exposed to the other arm, to the router, or to developers until both arms of the block are complete and logged. Adjudication happens only after both armRuns of a block exist.
- **Carryover diagnostic (pre-registered):** for every block, programmatically diff post-run worktree state against expectation, verify disjoint run IDs/sessions/state roots, and scan arm-2 logs for any reference to arm-1 artifacts. A failed diagnostic = contaminated pair → excluded-with-replacement (§2.7), and the exclusion is reported.
- **Fallback (pre-committed):** if Week-0 smoke runs show provider-side contamination cannot be ruled out (cache cannot be disabled or detected), abandon same-spec pairing and switch to **randomized matched-pair blocks**: independently authored, difficulty-matched task pairs with random arm assignment, analyzed as block-level effects. The switch decision and its trigger criteria are frozen in the pre-registration, not chosen post hoc.

### 2.3 Numeric power: MDE, sd, and the ADR-005 formula (C3)
ADR-005 formula: **n ≥ ((1.96 + 0.84) · sd(Δ) / MDE)²**, applied to pairedBlock deltas, per confirmatory analysis. All values below are **ASSUMPTIONS** (no pilot exists; only ~5 real invocations are logged — they are insufficient to estimate sd and are not used as one).

**Utility (taskSuccess, binary per block → per-block delta ∈ {−1, 0, +1}):**
For a paired binary endpoint, sd(Δ) = √(p₁₀ + p₀₁ − (p₁₀ − p₀₁)²), maximized at p₁₀ + p₀₁ = 1. ASSUMPTION: under the null-ish region of interest, discordant-pair mass p₁₀ + p₀₁ = 0.40, giving **sd(Δ) ≈ 0.60** (0.40 − small Δ̄² term; stated conservatively as 0.63 = √0.40, using the exact formula at MDE gives 0.60; we power at 0.63 to stay conservative). ASSUMPTION **MDE = 0.15** (a 15-point win-rate advantage for adaptive routing is the smallest effect worth closing F-PROD on).
- Per-family n: ((2.80 × 0.63) / 0.15)² = (11.76)² ≈ **139 pairedBlocks per family** if each family must individually pass. This exceeds the 30/family floor by ~4.6×. **Consequence (binding):** family-level confirmatory claims at MDE 0.15 are NOT achievable at the ADR floor; see §2.4 for the resulting claim structure.
- Overall n (all claimed families pooled): the same formula gives **139 pairedBlocks** for a single overall confirmatory CI at MDE 0.15, sd 0.63. With 100 blocks (30/30/30 + 10), the detectable effect at 80% power is MDE = 2.80 × 0.63 / √100 ≈ **0.176** — i.e., n=100 closes F-PROD only if the true utility delta is ≳ 0.18. **Pre-registered resolution:** confirmatory close at n=100 pairedBlocks is valid for MDE_overall = 0.18 (sd 0.63 ASSUMPTION); the 100-block design is adopted as the fixed budget, and the detectable-effect statement above is frozen so the closure condition is numeric, not vibes. If a Week-0/1 pilot readout (first 10 blocks, safety-look only, non-inferential) shows sd(Δ) > 0.80, collection pauses for re-powering rather than silently continuing underpowered.

**Cost (per-block token-cost delta, continuous):**
ASSUMPTION: sd(cost Δ) = **$0.40 per block** and **MDE = $0.00** (the gate is one-sided: cost-delta 95% CI upper bound ≤ 0, i.e., we must rule out adaptive being more expensive; equivalence-style). n for a one-sided 97.5% upper bound to exclude +$0.10 margin: ((2.80 × 0.40)/0.10)² ≈ **126 blocks**. With n=100, the excludable cost harm at 80% power is ≈ 2.80 × 0.40/√100 ≈ **$0.11/block** — i.e., at n=100 we can certify "adaptive does not cost more" only if true cost harm is below ~$0.11/block; this numeric bound is frozen. All dollar figures are ASSUMPTIONS until the billing source in §2.8 is live.

The ADR floor (100 blocks, 30/family) is therefore treated as a **budget floor, not a power proof**; the power implications above are pre-registered so that a pass at n=100 has a stated, numeric meaning and a null triggers pre-registered re-power, not quiet extension.

### 2.4 Claimed families, estimand, and multiplicity (C3)
- **Confirmatory estimand: ONE overall paired utility delta** across the three claimed families (implementation, testing, review), 90 blocks, plus 10 research blocks declared **exploratory only** (descriptive; never promoted; no research-family claim at n=10, per R1 and reaffirmed).
- **Closure rule (the only close condition, per ADR-005 gates 1 & 4):** overall utility-delta 95% CI lower bound > 0 (taskSuccess endpoint, never tracking score) **AND** overall cost-delta 95% CI upper bound ≤ 0.
- **Multiplicity control:** exactly **two** confirmatory intervals (one utility, one cost), both two-sided 95% (utility two-sided for the lower bound, cost one-sided upper at 97.5% ≡ two-sided 95% upper bound). Because ADR-005 requires BOTH inequalities to hold (intersection–union structure), **no alpha adjustment is required** — each test at α=0.05 yields a joint ≤0.05 false-close rate. Family-level CIs (30 blocks each) are computed and reported as **descriptive secondary**, explicitly non-confirmatory, so no family multiplicity correction is claimed or needed. No post-hoc family promotion.
- CI methods frozen now: utility — paired, BCa bootstrap over block deltas, 10,000 resamples, fixed seed committed; cost — same bootstrap on per-block dollar deltas. Sensitivity: exact McNemar CIs reported alongside for the binary endpoint.

### 2.5 Oracles / taskSuccess predicates (C4 carried — owner confirmation pending; R1 items folded)
Generic validation routes (build/lint/typecheck/`node scripts/run-tests.mjs`) are **necessary but not sufficient**. Per-family, task-specific, arm-independent oracles, authored blind to arms and frozen with each spec:
- **implementation:** pre-written hidden acceptance tests (authored with the spec, custodian-held, not visible to either arm) + repo gates (pnpm build, pnpm lint, typecheck, `node scripts/run-tests.mjs`) all pass.
- **testing:** authored tests must pass on the base+patch AND fail on ≥1 pre-registered mutant shipped with the spec.
- **review:** independently constructed planted-defect ground truth with pre-registered precision/recall thresholds per task.
- **research (exploratory):** expert rubric with named source set; descriptive only.
Adjudication: blind to arm where feasible, within 48h of block completion, against the frozen predicate only; late changes prohibited.

### 2.6 Sealing & confidentiality (C6)
- The evaluated repo contains **hash commitments only** (SHA-256 of each taskSpec + oracle + family label + base commit), committed before Week 1; commit hash is the immutability seal.
- **Plaintext specs live with an independent custodian** outside the repo and outside the evaluated agents' reach; each spec is revealed to an isolated arm only when that block is scheduled, and to adjudicators only after both armRuns complete. Committing readable tasks is explicitly rejected (immutability ≠ confidentiality).

### 2.7 Exclusion / replacement (C6)
- Exclusion only for **objective, arm-blind** criteria: infrastructure failure evidenced in runtime/invocations.jsonl (relay outage, logging loss, missing invocation rows), cache-contamination flag (§2.2), or provenance failure (§2.9). Outcome-dependent exclusion is prohibited; **failed armRuns are retained and reported**, and exclusions are adjudicated blind to arm outcome where feasible.
- Replacement: a **15-spec reserve pool**, committed alongside the main pool; reserves are drawn by a **pre-committed random schedule** (fixed seed), never hand-selected. Because route/model choice can cause failures (non-ignorable missingness), every exclusion records which arm/route failed and the failure rate per arm is reported; if per-arm failure rates differ significantly, that is reported as a limitation on the cost/utility estimand.

### 2.8 Cost definition & billing source (C7)
- tokensIn/tokensOut from runtime/invocations.jsonl × a frozen price table is **not billed cost**. Per orchestrator adjudication, xhh models are currently **UNPRICED in the catalog**. Pre-registered cost source, in order of preference: (1) xhh provider billing records for the collection window, reconciled per invocation ID; (2) if unavailable, an owner-frozen price table versioned at seal time, with cost results labeled ESTIMATE. The telemetry field list (taskId, provider, model, tokensIn/out, latencyMs, callOutcome, parameterHash) has **no billed-cost or cache field** — therefore a per-invocation immutable metadata record (executor class, invocation ID, price version, cache status) must be added before Week 1; its schema is part of the frozen artifacts.
- Aggregation rules frozen: retries and failed calls count toward the arm's cost (intention-to-treat on cost); multi-invocation tasks aggregate all invocation costs to the armRun, then to the block; latencyMs descriptive only. All 4-week/low-cost feasibility statements in this package are **estimates, not repo facts**.

### 2.9 Provenance validation — not grep (C8)
- Every armRun must carry an **authenticated executor/provenance class** and unique invocation ID; validation is programmatic: schema + completeness check on runtime/invocations.jsonl, allowlist match on provider/model, and **reconciliation of every analyzed invocation against provider/relay records**. Fail closed: any missing, duplicate, or mixed-provenance invocation excludes the block (with replacement per §2.7) and is reported. Grepping for "anything ≠ real providers" is explicitly rejected as a provenance mechanism (a fake can carry a production-looking provider string). The deterministic fake executor is banned for all holdout episodes (ADR-005 gate 2); the 2549 repo tests are code tests, never episodes.

### 2.10 Router-freeze scope (C9)
- **Frozen during collection:** adaptive-routing policy parameters and the static R0 config (versioned parameterHash committed). R0 is defined completely in the pre-registration artifact (fixed model/effort mapping per family, no learning).
- **What MAY update:** only state that cannot influence holdout routing decisions — operational bug fixes that do not alter routing decisions require a logged exception and a sensitivity note; anything touching routing policy, prompts used in routing, or family classification **voids episodes collected after the change** (per R1 rule) and triggers custodian notification.
- If the adaptive arm is defined to learn online in production, freezing it changes the intervention; the package therefore pre-registers the intervention as "**adaptive router, parameters frozen at seal**," and any learning from holdout tasks/labels during collection is prohibited (holdout labels are custodian-sealed until analysis). Temporal dependence note: arm order within blocks is randomized with a committed seed; calendar drift between Week 1 and Week 4 arms is checked via a pre-registered week-covariate sensitivity analysis.

---

## 3. PRE-REGISTRATION CHECKLIST (frozen before Week 1; seal = hash commitments committed in repo, plaintext with custodian)

1. **Endpoint:** taskSuccess with exact per-family mechanical oracles (§2.5); explicit statement that tracking score is NOT an endpoint (gate 4).
2. **Units:** taskSpec / armRun / pairedBlock definitions (§2.1); statement that 100 pairedBlocks (200 armRuns) is the strictest reading of the ADR floor.
3. **Families:** implementation / testing / review claimed (30 blocks each); research exploratory (10 blocks); no post-hoc promotion.
4. **Power:** ADR formula shown with numeric inputs — utility: sd 0.63, MDE 0.15 → 139 blocks (family-level infeasible at floor); adopted design n=100 blocks ⇒ detectable overall utility delta ≈ 0.18; cost: sd $0.40, margin $0.10 → 126; at n=100 excludable harm ≈ $0.11/block. All labeled ASSUMPTION; pilot-trigger re-power rule (sd > 0.80 ⇒ pause/re-power).
5. **Closure rule:** overall utility-delta 95% CI LB > 0 AND cost-delta 95% CI UB ≤ 0; IUT multiplicity argument; BCa bootstrap, 10,000 resamples, fixed seed; McNemar sensitivity.
6. **Isolation protocol:** disposable worktrees, separate state roots/sessions/caches, provider cache disable-or-detect, cross-arm information barrier, carryover diagnostic, matched-pair fallback trigger (§2.2).
7. **Arms:** adaptive (frozen parameterHash) and complete R0 definition; allowed/forbidden state updates; change-voids-episodes rule (§2.10).
8. **Executor policy:** real xhh invocations only; fake executor banned; programmatic provenance class + invocation ID + provider reconciliation; fail-closed (§2.9).
9. **Backlog & seal:** 100 specs + 15 reserves as SHA-256 commitments in repo; plaintext with named independent custodian; reveal-on-schedule protocol; blinded authorship statement.
10. **Exclusion/replacement:** objective arm-blind criteria; retain-and-report failures; committed random reserve schedule; per-arm failure-rate reporting (§2.7).
11. **Randomization:** per-block arm-order seed committed; reserve-draw schedule committed.
12. **Cost:** billing source hierarchy (provider records preferred; frozen price table = ESTIMATE), retry/failure/multi-invocation aggregation, per-invocation price-version + cache-status metadata schema (§2.8).
13. **Adjudication:** who scores, arm-blind where feasible, 48h window, frozen predicates only.
14. **Stopping:** fixed n=100 blocks; no efficacy peeking; one non-inferential safety/pilot look after block 10 (harness integrity + sd check only).
15. **Smoke list:** Week-0 throwaway taskIds named and excluded.
16. **Strata:** Candidate D traffic (if any) = separate pre-registered secondary stratum with fixed inclusion/analysis rules; never merged into the confirmatory 100 (C5).

---

## 4. 4-WEEK PLAN (weekly quotas; blocks = pairedBlocks, each = 2 armRuns)

- **Week 0 (pre-collection):** owner answers §5 questions; custodian appointed; 100+15 specs authored blind, hashed, committed (commitments only); plaintext to custodian; provenance/price/cache metadata schema landed and verified against implementation; cache-disable capability tested; pnpm-store sharing assumption verified; 2–3 smoke blocks executed, verified end-to-end (logging, isolation, reconciliation), then named in the exclusion list.
- **Week 1: 22 blocks** — implementation 8, testing 8, review 4, research(exploratory) 2. Cheapest-to-adjudicate families first to shake out harness/logging failures early. Block-10 safety look (non-inferential): harness integrity + sd(Δ) pilot check.
- **Week 2: 26 blocks** — implementation 8, testing 8, review 8, research 2. Mid-collection integrity audit: hash-commitment verification (no spec modified), programmatic provenance reconciliation against provider records (NOT grep), cache-flag rate review.
- **Week 3: 26 blocks** — implementation 8, testing 8, review 8, research 2.
- **Week 4: 26 blocks** — implementation 6, testing 6, review 10, research 4 (top-up; absorbs Weeks 1–3 shortfalls via committed reserve schedule).
- **Totals: 100 blocks = 200 armRuns** — implementation 30, testing 30, review 30 (claimed), research 10 (exploratory). Adjudication within 48h of each block's completion; all exclusions/replacements logged against the committed rules.

---

## 5. OPEN QUESTIONS FOR THE OWNER (genuine human decisions only)

1. **ADR-005 interpretation:** do prospective, purpose-authored dogfood tasks on the development repository qualify as "production" evidence for F-PROD, or is production strictly organic traffic? (Closure on Candidate A proceeds only on "yes"; a "no" forces Candidate D as primary, which is infeasible at ~5 invocations to date — that trade-off is the owner's call.)
2. **Custodian:** who holds the plaintext task specs and oracles, independent of router tuning? (A named person/role is required before Week 0 sealing.)
3. **xhh pricing source:** can provider billing records for the collection window be obtained for reconciliation, or must cost run on an owner-frozen price table labeled ESTIMATE — and who supplies/approves the table given the models are currently unpriced in the catalog?
4. **R0 definition:** what exactly is the frozen static baseline (fixed model per family? single default model?), since it must be completely specified in the pre-registration and is a product/policy choice.
5. **Learning-arm scope:** is freezing the adaptive router's parameters for 4 weeks an acceptable definition of the intervention, or must the production learning loop stay live (which forces the temporal-dependence analysis and weakens sealing)?

---

## 6. WHAT THIS DOES NOT CLAIM (honesty footer)

- Nothing here is **Outcome-supported** evidence: zero holdout episodes have been collected, and F-PROD remains open until the gated analysis on 100 sealed pairedBlocks passes both CIs exactly as pre-registered.
- All sd, MDE, price, cost-feasibility, and 4-week throughput numbers are **ASSUMPTIONS or estimates**, not measurements; only ~5 real invocations exist, and they ground none of the power inputs.
- The n=100/30 figures satisfy the ADR-005 conservative **floor** but, on the stated assumptions, are powered only for an overall utility delta ≳ 0.18 and a cost-harm bound of ≈ $0.11/block — family-level confirmatory claims are **not** powered and are explicitly not made.
- Repo validation routes alone do not establish task success; only the custodian-held, task-specific oracles do.
- Research-family results are exploratory at n=10 and can never close anything.
- Candidate D traffic, if it arrives, is a separate stratum and changes no confirmatory claim.
- This package asserts a **protocol**, not a result: if any seal, isolation, provenance, or billing prerequisite in §2–§3 cannot be met in Week 0, collection must not start, and F-PROD stays open.