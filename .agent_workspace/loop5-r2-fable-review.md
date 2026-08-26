# Loop 5 · Round 2 — Fable-review-req: `src/review/`, `src/rubric/`, `src/requirement/`, `src/evaluation/`

Reviewer: Fable-review-req (claude-fable-5-thinking-xhigh). Analysis only; no `src/` edits, no commit by this agent.

Reviewed at HEAD `826a44a` (`docs(agent): close Loop 5 Round 1 review and start Round 2`) on `cursor/pi-sparkle-sota-opt-0da8`. These four modules were flagged in `loop5-r1-review.md` §4 as "untouched by any report"; this closes that gap. Focus per brief: **operator reachability vs library-only**.

Inputs: direct reads of all 21 files in the four modules (~1,750 lines), full importer trace across `src/` and `test/`, `src/adaptation/promotion.ts`, `src/cli/adapt.ts`, `src/track/{loop,clarify,plan,primary-split}.ts`, the three run-start call sites, `docs/status-matrix.md`, `docs/specs/adaptive-agent-work-loop.md` (M4-T1/T3), `docs/research/modification-points-validation.md`, README, `package.json`, and git history of the four directories.

Verification run at HEAD: all tests touching these modules pass — `test/unit/review` (2 files), `test/unit/evaluation` (4), `test/unit/requirement` (7), plus `integration/m3/checkpoint-d`, `m3/requirement-extraction`, `m3/coverage-gate`, `m4/delivery-evidence`: **93/93 pass, 13 suites**.

---

## 1. Verdict in one paragraph

`src/requirement/` is live operator infrastructure: it is the engine behind `run --track` (clarification questions, contract synthesis, coverage gate) and the coverage gate on every contract-bearing start. `src/review/self-review.ts` is a live, fail-closed, operator-reachable safety gate on `adapt promote`. **Everything else — `review/critic.ts`, `review/pairwise.ts`, `review/reconcile.ts`, all of `src/rubric/`, and all eight files of `src/evaluation/` — has zero production importers.** They are the M4 "review fabric" (spec M4-T1/T3), shipped as library code, exercised only by tests, and never integrated with the judgment paths that actually run (`src/tracking/` prescore, feedback records, episode outcomes). Since `package.json` has no `exports` map and the only bin is `dist/cli/main.js`, "library-only" here means **test-only in the shipped artifact**: no supported path — CLI or import — reaches them.

## 2. Reachability map (all 21 files)

### Operator-reachable (verified chain to a CLI verb)

| File | Chain | Notes |
|---|---|---|
| `requirement/heuristic.ts` | `run --track` → `track/loop.ts` → `clarifyObjective` → `extractHeuristicContract`; `shouldScout` also in `track/plan.ts` | The only shipped `RequirementExtractor`. Mints the clarification questions (`q-done`/`q-tests`/`q-scope`/`q-write`) that the R1 F4 dead end strands |
| `requirement/extractor.ts` | via `heuristicExtractor` → `buildContractCandidate` | Role-separation check (extractor ≠ critic role) live; inference/authority legs inert — see F3 |
| `requirement/normalizer.ts` | `normalizeSources`/`createTrustedSource` via extractor/heuristic | `buildContractFromSources` is test-only |
| `requirement/critic.ts` | via `heuristicCritic` → `critiqueContract` | Score + missing-sources live; most finding kinds unreachable on this path — see F3 |
| `requirement/provenance.ts` | via `critiqueContract` → `findUnsourcedItems` | Live |
| `requirement/coverage.ts` | `assertCoverageAllowsStart` at `startFlowchartRun` / `startParentRun` / `startSupervisedRun`; live on `--track`, skipped on plain `--children` (`skipContract: true`) | Matches the README honesty note and status-matrix row exactly. `orphanRequirements` leg unreachable via the wired path (`coverageMatrixFromTasks` always returns `[]`) |
| `requirement/precedence.ts` | `applyPrecedence(contract, "user-first")` in `track/loop.ts:108` | Imported and called on every track run, but **semantically inert** — see F3 |
| `review/self-review.ts` | `adapt promote` → `cli/adapt.ts:280` `parsePromotionReview` → `validatePromotionReview` → `assertCanPromoteFromReview`; also enforced on every registry-snapshot load that parses a review | `assertCanPromoteFromReview` is load-bearing and correct (rejects by kind **or** identity, fail-closed). `applyRoutingScoreUpdate` is test-only — no routing-score consumer exists |

### Library-only (zero `src/` importers; tests are the only callers)

| File | Test coverage | Notes |
|---|---|---|
| `review/critic.ts` (`createCriticObservation`) | `unit/review/critic-pairwise` | Actor-defense refusal (ABSTAIN) is the spec's independence control; nothing produces `CriticInput` in production |
| `review/pairwise.ts` (`blindPairwiseCompare`, `runBlindPairwisePair`) | same | Order-swap position-bias detection is genuinely verified by tests; no producer of pairwise inputs exists |
| `review/reconcile.ts` (`reconcileReviews`) | same | Only importer is `pairwise.ts` (itself test-only) |
| `rubric/registry.ts` (whole module) | `unit/evaluation/rubric-registry` | In-memory module-level **mutable singleton**; no persistence; no bridge to the adaptation plane — see F5 |
| `rubric/types.ts` | type-only imports from two test-only modules | `RubricCriterion.weight` (0–1) is **never read by any code**; `Rubric.version` is always 1 |
| `evaluation/types.ts` | via all evaluation tests | `EvaluationOutcome` type-imported by test-only `review/critic.ts`; erased at build |
| `evaluation/evaluator.ts` (`createEvaluationRecord`, `canEvaluatorScoreCriterion`, `validateEvaluatorScope`) | `unit/evaluation/evaluation-identity`, `evaluator-precedence`, `integration/m3/checkpoint-d` | Nothing in production ever creates an `EvaluationRecord`; no store persists one. Exported `EvaluationResult` type is used by **nothing at all**, including tests — dead type that name-collides with the live `feedback/types.ts` `EvaluationResult` (F2) |
| `evaluation/precedence.ts` (whole module) | `evaluator-precedence` | deterministic > human > inferential table; no consumer |
| `evaluation/adapters.ts` | via adapter tests | Interface layer only |
| `evaluation/check-adapter.ts` | `unit/evaluation/project-adapters` | Staleness (revision/change-set) and cwd-escape guards are good; **the real child verifier does not use it** — see F1 |
| `evaluation/delivery-adapter.ts` | same + `integration/m4/delivery-evidence` | Strict typed-guard (ABSTAIN vs UNOBSERVED distinction) is correct; nothing collects `DeliveryEvidence` in production |
| `evaluation/diff-adapter.ts`, `evaluation/ownership.ts` | same | `classifyDiffScope` has no production caller |

## 3. Findings

**F1. The M4 review fabric is a parallel judgment plane that never merged with the paths that actually judge.** The spec (`docs/specs/adaptive-agent-work-loop.md`, M4-T1/T3) designed rubric registry + evaluator interface + blind pairwise for artifact judgment, including a `PAIRWISE` feedback source. What actually runs: child verification uses `src/tracking/` exit-code prescore semantics (`from-child.ts:193`, `prescore.ts:116`), not `CheckAdapter`; `feedback/types.ts` shipped its own `FeedbackKind` (`human|peer|judge|deterministic`) with the spec's `PAIRWISE` source dropped; episode acceptance (`episode close --outcome`) never feeds `DeliveryAdapter.manualAcceptance`; nothing produces an `EvaluationRecord`. There are now **three disconnected "rubric" notions**: the typed `Rubric` in `src/rubric/`, the adaptation plane's `"rubric"` `ResourceKind` (`adaptation/resource.ts:14` — how a rubric would actually be versioned and promoted under D3), and `feedback.rubricVersion` as a free string (`"auto-loop-v1"` at `learning/auto-loop.ts:319`). None interoperate. `docs/research/modification-points-validation.md` marks MP-09/MP-11 "validated" pointing at `src/evaluation/` — true as design validation, easy to misread as "wired".

**F2. Name and semantics collisions await anyone who wires the fabric later.** Two exported `EvaluationResult` types: `evaluation/evaluator.ts:30` (used by nothing, not even tests) and `feedback/types.ts:60` (live). Two aggregation semantics: `createCriticObservation` computes overall = PASS if **any** criterion passes; `createEvaluationRecord` computes FAIL-dominates. Both are shipped, tested, and contradictory; a future consumer must pick one and the generous critic rule is the suspect one (a rubric where one of five criteria has evidence reads PASS overall, and `weight` — the field that would arbitrate — is dead, per §2).

**F3. Reachable-but-inert branches on the wired track path** — none are bugs, all are aspirational branches only a custom library caller can trigger; worth knowing before anyone claims these behaviors exist:
- `applyPrecedence` at `track/loop.ts:108` is a **guaranteed no-op**: `detectConflicts` only fires on `fast`/`< 10ms` vs `slow`/`> 1000ms` `observableCheck` text, and the heuristic extractor emits only `"run.status is COMPLETED…"` and `"tester child TASK_RESULT verification is PASSED"`.
- The extractor's inference labeling (`corroborated`/`needs-confirmation`) and `assertAuthorityGrounding` fail-closed loop never execute meaningfully: `heuristicExtractor` always returns `inferences: []`, `authorityGrounding: []`, and `authority: []`.
- `heuristicCritic`'s only added omission (`acceptance-missing-while-questions-open`) can never fire — the heuristic always emits `ac-objective`.
- Net effect: on the wired path `requiresUserDecision` reduces to exactly `isVague(objective)` (confidence 0.55 vs the 0.8 floor); `waiting` additionally trips on open questions.
- `createEvaluationRecord`'s overall `ABSTAIN` is unreachable (per-criterion outcomes are only PASS/FAIL/UNOBSERVED; empty criteria hits the `every`-vacuous UNOBSERVED branch first).
- Status-matrix row "Requirement provenance + critic … critic reports omissions" is technically true at library level while the wired critic can produce almost none of its finding kinds. One-line qualifier if the matrix row is next touched; not worth its own edit.

**F4. `q-scope` is asked and its answer is discarded — a live wired-path UX honesty gap, new this review.** `requirement/heuristic.ts:71-77` asks "Which files or modules should this change touch?" (reachable, e.g. `run --track "fix the typo in the readme"`: `shouldScout` false, no named targets, verb match). The answer flows into `applied.resolved` and unblocks the gate, but **no code reads `answers["q-scope"]`** — `track/plan.ts` consumes only `q-tests`, `q-done`, `q-write` (lines 32-34); grep for `q-scope` across `src/` finds only the asking site. The operator types file paths in response to a direct question and the plan ignores them. Riders for whoever owns the Round 2 track slot (Fable-track-design/Opus-track): (a) either consume the answer in planning/scout scoping or stop asking; (b) note that `applyAnswers` accepts any non-empty string — options are advisory, not validated; (c) `assertCoverageAllowsStart` defaults resolved questions to `options[0]` — "assume defaults" is first-option-wins by construction; (d) the question ids and option lists in `heuristic.ts` are the de-facto contract behind `track-questions.json` and are pinned by no test.

**F5. `rubric/registry.ts` is a dead in-memory singleton and the wrong future home.** Module-level mutable state (`let registry`), no persistence, last-registered-wins per scope, `version` never incremented. If rubrics ever become real they belong on the adaptation plane as `"rubric"` resources (versioned, promoted under the D3 human-approval guard, rollback-able) — the registry as shipped would bypass all of that. No action now; recorded so a future wiring slot doesn't reach for the singleton because it exists.

**F6. Promotion review verdict coercion launders unknown verdicts into "approved"** — the one finding on an **operator-reachable** path, though the file is `adaptation/promotion.ts` (the seam this module's `self-review.ts` feeds). `parsePromotionReview` maps any verdict that is not exactly `"rejected"` to `"approved"` (`promotion.ts:597`) *before* `validatePromotionReview` requires `"approved"` — so a hand-authored review file (the only kind that exists, per Fable-adapt G1) containing `"verdict": "Approved"`, `"aproved"`, or `42` parses as an approved review instead of being refused. The self-review/identity gates still apply, so this cannot approve a self-review — it weakens only the verdict field's fail-closed posture. Symmetric observation: a review with verdict `"rejected"` can never round-trip (validation refuses it), which is currently unreachable-by-construction — registry `"rejected"` ledger entries carry the *approved* review from the pending intent (`registry.ts:435`), so no persisted snapshot legally contains a rejected-verdict review. One-line fix (refuse unknown verdict strings), fits as a rider on Opus-adapt's `adapt show`/`dataset` slot or the delete-disclosure batch; no pin touches this string.

**F7. Micro-gaps in `evaluation/ownership.ts` default rules** — library-only, so recorded for a future wiring pass only: `\.lock$` misses `pnpm-lock.yaml` (would classify the lockfile as unrelated-user → FAIL); `node_modules/` maps to `unknown` which also FAILs (arguably right, arguably noise); patterns are not path-normalized for Windows separators.

**F8. Operator-facing docs make no overclaim about these modules — checked and clean.** README's coverage-gate honesty note, the status-matrix "Coverage gate" and "Requirement provenance + critic" rows, and USAGE match the verified wired behavior. `review`/`rubric`/`evaluation` are simply absent from operator docs, which is the honest state for library-only code. The only borderline text is the MP-09/MP-11 "validated" wording noted in F1.

## 4. Recommendations (ranked)

1. **Do not wire the review fabric this loop — record as NO_HIGH_VALUE_CHANGE.** Wiring pairwise/evaluator/rubric into live judgment is a new-policy decision of the same class as adapt G4 (would create judgment-plane pressure without an eval story), touches frozen surfaces (child verification semantics, feedback record shape), and no operator has asked for it. The library code is small, green, and documents M4 intent; **KEEP, labeled library-only** — pruning would delete the only implementation of the spec's bias controls (blind identity, order swap, abstention) for zero preview gain.
2. **`q-scope` fix (F4)** — smallest honest change: stop asking until consumed, or thread the answer into scout scoping. Belongs to the Round 2 track slot as a rider; the question strings are unpinned so either direction is freeze-safe.
3. **Verdict-coercion one-liner (F6)** — refuse unknown verdicts in `parsePromotionReview`. Operator-reachable, fail-closed, ~3 lines + one test; natural rider on Opus-adapt's slot since it edits the same file family.
4. **Docs one-liners, only when the files are next touched anyway:** status-matrix qualifier on the critic row (F3); a "library-only, no operator surface" note for review/rubric/evaluation in the matrix module section; MP-09/MP-11 "validated (design; not wired)" clarification.
5. **If a future loop does wire evaluation:** resolve F2 (delete the dead `EvaluationResult`, pick one aggregation rule), decide `weight`'s fate, move rubrics to the adaptation plane (F5), and fix F7 — as one slot, not piecemeal.

## 5. Explicit NO_HIGH_VALUE_CHANGE_FOUND areas

- **`review/pairwise.ts` + `reconcile.ts` internals** — correct and genuinely well-tested (slot-bound vs identity-bound scoring, swap remap, uncertainty on disagreement). Nothing to fix until a consumer exists.
- **`review/self-review.ts` gate** — load-bearing, fail-closed on both kind and identity, enforced at parse time so historical snapshots are re-checked on load. Leave untouched.
- **`requirement/` wired behavior** — honest, matrix-documented, and consistent with the README's skip-contract disclosure; the coverage gate's refusal message is clear. The inert branches (F3) are documentation nuance, not defects.
- **`evaluation/` adapter guards** — the delivery adapter's ABSTAIN-vs-UNOBSERVED distinction and the check adapter's staleness/cwd guards are the right shape; no changes warranted while unconsumed.
- **Renaming/pruning the four directories** — churn with no operator value; the naming overlap (`requirement/critic.ts` vs `review/critic.ts`, three rubric notions) is confusing to auditors but invisible to operators and cheap to document instead.
