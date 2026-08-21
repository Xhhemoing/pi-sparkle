# Design: Execution, tracking, and analysis lines

Date: 2026-08-18  
Status: Frozen for external review 2026-08-18 (accepted in brainstorm; not implemented)  
Canonical Chinese briefing for reviewers: [2026-08-18-three-line-tracking-定稿.md](./2026-08-18-three-line-tracking-定稿.md)  
Scope: Product rules for isolating work, cheap process monitoring, and gated optimization. This refines [ADR-004](../../decisions/0004-controlled-adaptation.md); it does not replace M0–M2 run truth.

## 1. Problem

A live run that rewrites its own prompts, routing, or permissions cannot be reproduced or rolled back. A second model that reads the full transcript every turn costs more than the worker. A single average “quality score” lets self-review or a casual LGTM bury a failed test.

The product needs three isolated lines, a cheap rolling tracker, and a combined score that wakes the expensive analyzer only when rules or the user say so.

## 2. Three lines

| Line | Job | Must not do |
| --- | --- | --- |
| **Execution** | Do the task with approved contracts, tools, and routing. | Mutate active prompts, routing, rubrics, or permissions. Consume tracking summaries as authority. |
| **Tracking** | Record structured events; score this window; roll history into a structured summary for the *next tracking turn only*. | Command a policy change. Treat its own prose as proof the task succeeded. |
| **Analysis** | Read an anomaly packet; emit versioned improvement candidates. | Patch the in-flight run. Auto-promote. Persist hidden chain-of-thought. |

Correction of *this* output stays on execution/tracking: bounded repair or stop and ask the user. Changing *future* defaults is analysis → candidate → explicit promotion (existing CAS / proposal-first).

## 3. Tracking window and roller

Each tracking turn sees:

1. the previous **structured rolling summary** (not free prose);
2. the **current high-detail window**: new context, user/AI text of this turn, and **tool-call situation** (name, target path/scope, exit code, duration, write/escape flags, artifact/evidence ids and hashes);
3. still-open minors and unresolved decisions.

Default: do **not** load tool bodies or chain-of-thought. Expand those only for the turn that already qualifies as an anomaly (hard gate or `score < 0.55`).

After the turn, fold the current window into the next summary. The summary is a fixed record, not a story:

- still-active constraints, unresolved questions, confirmed decisions;
- operation list (tools, paths, results);
- `prescore`, human signal, `score`, anomaly codes, evidence refs;
- `open-minors`;
- **omissions**: anything dropped from the next window must be named.

Mandatory items (constraints, authority, unresolved decisions, failed checks) cannot be dropped. If they cannot fit, record an omission and fail closed (ask the user or block), do not silently forget.

The rolling summary is **tracking-only**. Execution continues to receive only its task context packet.

## 4. Scores

All machine scores are on `[0, 1]`. Missing evidence is `UNOBSERVED`, never filled with `0.5`.

### 4.1 Prescore `P` (no human)

Tracking credibility for this window. Dimensions (fixed, not a learned mix):

- evidence consistency (claims vs events/exit codes);
- scope safety (ownership / path escape);
- check coverage (required verification ran);
- constraint retention (early mandates still in the summary);
- progress vs stall;
- narrative coherence (advisory only; may `ABSTAIN`).

Composition (fixed):

- any hard-related dimension fail caps `P` at `0.30`;
- `UNOBSERVED` without independent evidence cannot be a high score;
- narrative quality is never averaged with a failing test.

Evidence precedence (versioned table, not learned): deterministic > explicit user verdict > independent check/critic > tracking credibility > actor self-score (self-score weight `0`).

### 4.2 Human score `H`

Extract in this order (first match wins):

1. **Agreement ratio** when the AI output is a countable list (plan, proposal, `ApprovalPlan` checkboxes): `H = agreed / evaluable`.
2. **Ten-point mark** when the user writes `x/10` or `x分`: `H = x / 10`.
3. **Short-rule buckets** when the reply is unstructured negation: whole reject / rollback → `0.15`; reject this operation, plan still ok → `0.35`; named error but continue → `0.45`.

If extraction is uncertain: `H = UNOBSERVED` (treat as “no human evaluation”).

Do not prompt for a score every turn. Do not run an extra LLM over every user reply to “detect mood.”

A rejected **permission/security** item is never cancelled by a high overall ratio; that item is a hard anomaly or an escalated minor.

### 4.3 Obvious human problem

True when any of:

- at least one list item is disagreed;
- a ten-point mark is present and `< 8`;
- short-rule negation hits.

False when the user is silent, gives a short confirm (ok / 行 / 继续), or only adds requirements without blaming the current operation.

### 4.4 Combined `score` (analysis gate)

- No human evaluation, **or** no obvious problem → `score = P`.
- Else → `score = 0.7 * min(H, P) + 0.3 * max(H, P)`.

`H` missing is `UNOBSERVED`, not `0.5`. There is no `0.5 * P + 0.5 * H` blend.

### 4.5 Soft threshold

Absolute (not relative to history): **`score < 0.55`** is a soft anomaly and wakes analysis (after the hard-gate check).

The threshold is a versioned config the user may change. The execution model cannot change it. Analysis may *propose* a new threshold as a candidate.

## 5. Anomaly gates

**Hard (skip the 0.55 formula):** deterministic fail (test/type/lint), write outside episode ownership, claimed verification with no check events, repeated no-progress, explicit user reject/stop. Expand tool bodies / CoT as needed; send an anomaly packet to analysis; or stop and ask the user.

**Soft:** `score < 0.55`.

**Small issues** (no safety/authority/failed check, user did not reject):

1. verify against events, hashes, or a deterministic check — never by asking the tracker to “think again”;
2. verified false positive → close; verified true and light → `open-minors` and a slight `P` dip;
3. cheap bounded repair only if it does not change the plan or permissions (e.g. re-run one test);
4. escalate into `score` only if the same minor repeats **2** consecutive tracking turns, or the episode accumulates **3** unclosed minors, or the item touches a constraint / user reject.

Unverifiable minors stay `UNOBSERVED` in `open-minors`. They do not wake analysis by themselves.

## 6. Analysis line

**Input:** anomaly packet = rolling summary, current-window structured detail, `P` / `H` / `score`, which gate fired, evidence refs. Tool bodies and CoT only if this turn already anomalied.

**Output:** optimization proposals as **versioned candidates** (one declared resource boundary, evidence, rollback target). Existing registry / promotion / proposal-first rules apply. A candidate is not active.

**Model:** stronger than the tracker when an LLM is used; prefer a different family from the actor. Called only when a gate fires; context is the packet, not the raw parent transcript.

**Live run:** analysis does not mutate execution. In-flight actions remain tracking’s bounded repair or `WAITING_FOR_USER`.

## 7. Persistence and privacy

- Durable tracking artifacts are structured summaries, scores, omissions, and evidence refs.
- Raw conversation and tool bodies stay reference-only or encrypted per P0; they are not the default learning fields.
- Hidden chain-of-thought may be read ephemerally on anomaly; it is not persisted and is not a replay dependency.
- Actor identity and actor defense are not given to analysis as scoring input (same independence rule as the existing critic).

## 8. Out of scope

- Remaining adaptive defaults 1 and 4–6 (default 2 is full proposal-first; default 3 is “no weight training” — routing *allocation* is §10, not SFT).
- Live ranking until a user-approved `routing-policy` **and** the §10.4 promotion gate. Shadow comparison may run earlier.
- BKT as a routing availability model; DKT / RouteLLM / NeuralUCB as live routers.
- M3 leftovers (episode store, coverage gate, packet fidelity, telemetry).
- Pi extension (ADR-006).
- Claiming `Outcome-supported` improvement.

## 9. Acceptance when implemented

- Execution tests still pass without reading tracking summaries.
- A fixture with an early privacy constraint still present after three rolled summaries (or an explicit omission + fail-closed).
- Tool-body / CoT readers are not invoked on a green, above-threshold turn.
- `score` matches §4 on fixtures: silence → `P`; 4/5 agree with no safety dissent → ratio path; `7分` → `H=0.7` and formula if `< 8`; test fail → hard gate even if `P` is high.
- `score = 0.41` from `H=0.2, P=0.9` enters analysis; `H` absent does not become `0.5`.
- Three light minors do not call analysis until the 2-turn / 3-count rule.
- Additive hierarchical estimates stay defined with n=1 (shrunk hard toward the scenario parent); a routing-policy still cannot go live without the §10.4 promotion gate.
- `UNOBSERVED` increments exposure only; it does not move posteriors.
- Attribution fixtures use shrunk effects (model / project / common / interaction), never `meanScore`.
- Ranking among R0-eligible models prefers the cheapest whose availability LCB clears the scenario bar; if none clear, pick highest LCB.

## 10. Routing allocation weights (decided)

“Weight” here is **which eligible model to prefer for a scenario**, not neural-net training. Live execution stays on the approved R0-equivalent catalog until the user promotes a `routing-policy`. No estimator may override R0 hard constraints or high-risk no-exploration.

### 10.1 Why the previous sketch was wrong

Deep look at BKT identifiability (Beck & Chang; Baker constraints), Efron–Morris / hierarchical Beta-Binomial shrinkage, and cost-aware cascade routing:

1. **BKT with `P(T)=0` is the wrong model for models.** Guess, slip, and `P(L0)` trade off; many parameter triples give the same success curve. Models do not “learn a skill” from one episode. Fitting `P(G)`/`P(S)` on sparse cells is empirically degenerate. Do **not** use BKT for routing availability. (BKT remains available later for *collaboration skills* in the intelligent-loop report — a different latent.)
2. **Three independent tables + a residual column are not one model.** Rates can disagree (model table says good, residual says bad). Attribution must come from **one additive hierarchy** with partial pooling.
3. **A hard `n=5` cliff makes the estimator jump.** Literature (James–Stein / Beta-Binomial EB) uses continuous shrinkage `w = κ/(κ+n)`: n=1 is allowed, it just barely moves the parent. Keep a sample gate only as a **promotion** rule, not as “refuse to estimate.”
4. **Binarizing `score` at 0.55 throws away the three-line signal** and then tries to recover noise with slip/guess. Keep 0.55 as the *anomaly/analysis* gate. For routing, use a **reliability-weighted** observation (below).
5. **Ranking by availability LCB alone ignores cost** (picks the slightly more trusted expensive model). Production routers use “cheapest that clears a quality bar, else escalate.”

DKT / NeuralUCB / RouteLLM stay out of live: they need training sets we do not have and cannot explain model vs project vs common.

### 10.2 One hierarchy (closed form, no MCMC)

Every informative observation updates a single generative story on the probability scale via conjugate Beta, with empirical-Bayes parents. Recency decay is the existing R1 half-life, applied *before* pooling.

```text
scenario parent     μ_s     ← all informative y in this scenario (any model/project)
model offset        δ_m     ← this model in this scenario, shrunk toward μ_s
project offset      δ_p     ← this project in this scenario, shrunk toward μ_s
interaction         δ_mp    ← this model in this project in this scenario,
                              shrunk toward (μ_s + δ_m + δ_p)  i.e. toward 0 extra
```

**Posterior mean for a cell** (probability scale, nested partial pool):

```text
p_m  = w_m  * μ_s + (1-w_m)  * ŷ_m          w_m  = κ_s / (κ_s + n_m)
p_p  = w_p  * μ_s + (1-w_p)  * ŷ_p          w_p  = κ_s / (κ_s + n_p)
p_mp = w_mp * p_add + (1-w_mp) * ŷ_mp       w_mp = κ_i / (κ_i + n_mp)
p_add = clip( p_m + p_p - μ_s )             // additive on probability, clipped to (ε,1-ε)
```

`ŷ_*` is the decay-weighted mean of observations in that slice. `κ_s` is estimated by method of moments across models (or projects) in the scenario: if `v` is the between-cell variance of `ŷ` and `m=μ_s`, then `κ_s = clip( m(1-m)/v - 1, 2, 40 )`. With fewer than 3 cells, `κ_s = 8` (default pseudo-count). Interaction uses a **larger** default `κ_i = 16` so `δ_mp` stays near 0 until the cell is actually crowded.

**LCB** uses the Beta approximation of the leaf: treat `p_mp` as mean of `Beta(α,β)` with effective sample size `n_eff = n_mp + w_mp*κ_i` (parent strength), then `LCB = max(0, mean - 1.96 * sd)` as in R1. Sparse cells have wide sd → low LCB → will not beat the quality bar.

**Attribution (replaces meanScore diagnostics):**

| Diagnosis | Test on shrunk effects |
| --- | --- |
| Common / scenario too hard | `μ_s` LCB below the quality bar **and** ≥ 2 models **and** ≥ 3 projects contribute |
| Single-model problem | `p_m - μ_s` LCB `< -0.10` and `δ_mp` CI includes 0 |
| Single-project problem | `p_p - μ_s` LCB `< -0.10` and `δ_mp` CI includes 0 |
| Interaction (“only here”) | `p_mp - p_add` LCB `< -0.10` |
| Uncertain | none of the above; do not emit an avoid/prefer rule |

Effect size `0.10` is versioned (same config family as `0.55`). Analysis proposes checks/topology for *common*, avoid/prefer for *model* or *interaction*, and process/contract work for *project* — never “buy a bigger model” for a common or project problem.

### 10.3 Observation model (keep information, don’t overfit)

Anomaly/analysis still uses the ternary in §5. Routing uses a **separate** reliability-weighted `y ∈ [0,1]`:

| Case | `y` | weight |
| --- | --- | --- |
| Hard deterministic fail or path escape | `0` | `1.0` |
| Deterministic pass **and** no obvious human problem | `1` | `1.0` |
| Combined `score` available, checks not `UNOBSERVED` | `score` | `0.6` |
| Human obvious problem (formula `score`) | `score` | `0.8` |
| `UNOBSERVED` / abstain | — | `0` (exposure only) |

Weights `< 1` are how slip/guess enter: weak evidence moves the posterior less, instead of inventing BKT emission parameters. `y` is never filled with `0.5` for silence.

### 10.4 Data-scarce vs data-sufficient (estimator vs promotion)

**Estimator (always on in the adaptation plane):** compute §10.2 for every cell with any exposure. n=0 → `p = μ_s` (or conservative prior `Beta(1,1)` if the scenario is empty). No cliff.

**Live ranking (off until promotion):** still forbidden until the user approves a `routing-policy` **and** the *target cells* satisfy: `n_eff ≥ 5` **and** at least one independent source (deterministic or human) in that scenario. This is a governance gate, not an estimation gate.

**When live ranking is approved,** among R0-eligible models:

1. Drop any model whose LCB(p_mp) is undefined solely because the model is ineligible.
2. Let `bar` be a versioned quality floor (`0.55` for standard-risk, `0.70` for high-risk — high-risk still only the approved list).
3. Choose the **cheapest** eligible model with `LCB ≥ bar`.
4. If none clear the bar, choose the eligible model with **highest LCB** (escalate). Do not explore. Do not Thompson-sample on the live path.

Shadow may compare this policy to R0 without activating it. Thompson sampling is allowed **only** in shadow with exploration budget 0 on high-risk.

**Reset:** model version change or approved prompt/routing candidate zeros that model’s `ŷ_m` / `ŷ_mp` and keeps `μ_s` / `δ_p` (project difficulty is not the model’s fault).

**DKT:** offline holdout contrast after Checkpoint F only; must beat this hierarchy on **calibration (ECE) and cost** , not only AUC; never the sole live router.

### 10.5 Collect more labels without buying more model calls

Unchanged intent, tighter mechanics:

1. **Always log exposure** at assign time (eligible set, rejects, scenario key, versions, propensity if a shadow policy was recorded).
2. **Cheap labels first:** bounded repair that runs a real check is the main `UNOBSERVED` → `y∈{0,1}` converter.
3. **Keep abstentions** as exposure rows.
4. **Deficit list:** sort cells by `exposure / (n_eff + ε)` descending. Propose shadow replay, never live explore. High-risk exploration count stays 0.
5. **Do not spawn a judge LLM** to label routing data.
6. **Holdout sealed.** Updates use train/validation only.
7. Log `y` and `weight`, not only the ternary, so the hierarchy can be replayed.

`adapt auto` may write the hierarchy and propose a `routing-policy`. It must not activate the pointer.

### 10.6 How routing moves toward “fit”

Each task: classify scenario → R0 hard filter → if no approved policy or cell fails the §10.4 gate, pick cheapest eligible (high-risk: approved list only); else cheapest with `LCB ≥ bar`, else highest LCB. No live exploration.

After the node: log exposure; write reliability-weighted `y`; update the hierarchy (shadow may record “what the new table would have picked”). Anomaly or a clear shrunk-effect diagnosis may emit **one** `routing-policy` candidate. The user must approve before the next task uses the new ranking. Guardrail regression rolls the pointer back.

“Fit” means **clear the quality bar at the lowest cost**, not maximize model strength. Improvement is a sequence of versioned, reversible policies—not a hidden weight drift inside a live run.

## 11. Decisions log

| Decision | Choice |
| --- | --- |
| Line split | Execution / tracking / analysis |
| Rolling summary consumer | Tracking next turn only |
| Current-window detail | Context + tool *situation*; bodies/CoT on anomaly only |
| Soft threshold | Absolute `0.55` |
| Combined score | `P` if no human eval or no obvious problem; else `0.7*min + 0.3*max` |
| `H` source | Ratio → ten-point → short-rule; uncertain → no eval |
| Ten-point “obvious problem” | Mark present and `< 8` |
| Small issues | Verify / ledger / bounded repair; 2-turn or 3-count escalate |
| Analysis output | Versioned candidates, not live patches |
| Promotion authority | Full proposal-first: no auto-promote, including `routing-policy`. `adapt auto` may collect and propose only. Permission/security/credential never auto-promote. |
| Routing weights | Additive hierarchical Beta-Binomial EB; cheapest LCB ≥ bar; no BKT/DKT live |
| Routing labels | Reliability-weighted `y`; exposures always; cheap checks over extra judges |
