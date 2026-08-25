# Loop 5 Round 1 — Fable-adapt: adaptation/learning product usability

Agent: Fable-adapt (claude-fable-5-thinking-xhigh). Analysis only; no src/ edits, no commit.
HEAD at read time: `7adea03` on `cursor/pi-sparkle-sota-opt-0da8`.

Read: `src/adaptation/*` (13 files), `src/learning/*` (10 files), `src/routing/` (surface + isolation posture), `src/cli/adapt.ts`, `src/experiments/` (surface), ADR-004/005/006, status-matrix adaptive line, `docs/agent-decisions.md`, `src/review/self-review.ts`, `src/privacy/record-classes.ts` (adaptation classes), README command table, `src/cli/main.ts` USAGE.

## Verdict

**Not operator-complete — `NO_HIGH_VALUE_CHANGE_FOUND` is NOT recorded.** The safety architecture is finished and verified; the *product workflow* is not. The plane can propose a routing-policy candidate automatically after every tracked run, and a promoted policy demonstrably steers the next live assignment — but the only sanctioned path from "proposed" to "promoted" requires the operator to hand-extract candidate content from `~/.pi-sparkle/adaptation/registry.json`, hand-author a review-provenance JSON whose required `actorId` no command ever prints, and hand-author a replay dataset manifest **that nothing in the repo can produce**. The loop is closed in code and open in practice.

## What works (verified)

- **Collect → diagnose → propose** is live and honest. `runAutoAdaptLoop` (`src/learning/auto-loop.ts`) collects TASK_RESULT / USER_ANSWER / JUDGE_DECISION / subagent signals (`signals.ts`), persists them as redacted feedback with lock-timeout drops disclosed three ways (`feedbackDropped`, `feedbackDropReasons`, `reason`), updates the per-project bandit as a **writer only**, and proposes a routing-policy candidate when ≥5 deterministic taskSuccess samples put a non-primary model's mean below 0.45 (`diagnostics.ts:15-16`). Kill switch `SPARKLE_AUTO_ADAPT=0` stops everything that learns and keeps observation, exactly as documented.
- **No auto-promote, structurally.** `runAutoAdaptLoop` hardcodes `promoted: false`; the CLI never passes an `approvalProfile`, so `createDefaultApprovalProfile()` (empty `autoPromoteClasses`, `maxAutoPromotions: 0`) makes `canAutoPromote` unconditionally false; `preparePromotion` then requires `explicitApproval` plus a human `approvedBy` (`registry.ts:608-619`). Model and self-review actors are refused by name (`promotion.ts:200-211`, `self-review.ts`).
- **No `selectArm` on the live path.** `bandit-store.ts` is reward bookkeeping only; live selection reads the promoted policy via `loadLearnedRouting` → `applyLearnedRouting` (`src/track/loop.ts:116`, `src/cli/main.ts:950`, `src/run/flowchart-run.ts:1329`, `src/routing/assign.ts:102`), and the transitive-closure isolation test posture from ADR-005 (Round 2 hardening) still holds. Promotion is therefore product-meaningful: avoid/prefer take effect on the very next assign.
- **CAS + rollback discipline.** Two-phase intent/commit with append-only promotion and rollback ledgers; guardrail rollback automatic, degradation two-step propose-then-`--confirm`, user rollback explicit; retired versions refuse reassignment. Routing-policy promotion additionally demands a replay-class eval report whose contentHash triple-matches and refuses production-labeled comparisons (`promotion.ts:221-263`).
- **`adapt eval` exists and is real** (`eval-routing.ts`): static + replay stages, forbidden-field scan, isolation guard against the original workspace, deterministic `cacheKey`/`rerunHash`, provisional gating.

## Gaps (evidence-backed)

### G1 — Promote requires three artifacts; zero producers for two, none discoverable for the third

To run the documented `adapt promote --candidate --expected --content-file --review-file --approve --eval-file`:

1. **`--content-file`** must hash (hash32) to `candidate.contentHash`. The registry *stores* the content (`registry.json` `contents[]`, `registry.ts:154-159`), but no command prints it. `adapt status` shows only `candidateId kind/name parent=` (`adapt.ts:114-117`) — not even the contentHash. The operator must extract the blob from the snapshot by hand; a whitespace slip fails as `content hash mismatch`.
2. **`--review-file`** must satisfy `parsePromotionReview` + `preparePromotion`: `verdict: "approved"`, `reviewerKind` peer/independent, `reviewerId ≠ actorId`, non-empty `evidenceRefs`, `contentHash` matching, and **`actorId` equal to `candidate.author.identity`** (`registry.ts:569-575`) — an internal string (`pi-sparkle-auto-loop` / `pi-sparkle-learn`) printed by no surface. The refusal message names the rule, not the expected value. This is guessable only by reading source or registry.json.
3. **`--eval-file`** is mandatory for routing-policy — the only kind the loop ever proposes. `adapt eval` needs `--dataset <dir>` with a `manifest.json` (episodeHash/taskId/role/objective/originalWorkspace/taskSuccess per episode, `eval-routing.ts:252-332`). **Grep confirms no dataset producer exists anywhere in `src/`** — yet every required field is already in the run event log (`outcomesFromRoutedRun` extracts family/role/model/outcome from MODEL_ROUTED + TASK_RESULT; objective is in TASK_REQUEST; originalWorkspace in PROJECT_DISCOVERED). The 2026-08-19 routing briefing planned this chain ("adapt eval 仍缺"); eval shipped, its input pipeline did not.

Net effect: the only auto-proposed candidate kind cannot be promoted through supported tooling. This is the plane's single biggest product hole.

### G2 — Active-pointer and history are invisible

`--expected` must name the *current active* version. For the first promotion, `adapt status`'s `parent=` works. After any promotion or rollback, the active id is discoverable **only** through the CAS refusal message (`CAS failed: active version rsv_X …`, `active-pointer.ts:47-51`) or by reading registry.json. No command shows: active version per identity, version lineage, promotion/rollback ledgers, pending intents, or non-`proposed` candidates (approved/rejected/retired are silently absent from `adapt status`). `adapt rollback --target` is likewise pick-from-nowhere.

### G3 — USAGE/README omit the load-bearing verbs

Top-level USAGE (`main.ts:277-280`) and the README command table (rows 173–176) list `adapt status/learn/auto/promote` but **not `adapt eval` or `adapt rollback`** (README line 356's prose "rollback remain available" aside). `learn`/`auto` rows omit `--primary-model`. `adapt.ts`'s own sub-USAGE is complete. After PR #12's readme-command-parity direction, subcommand rows should be truthed up. No walkthrough doc exists for the end-to-end loop (track → status → eval → promote → verify next assign → rollback); the provisional-eval double-negative (`acceptProvisional` must be `false` with empty claims, `promotion.ts:246-256`) is exactly the kind of rule a how-to must explain because no error message can.

### G4 — Shelf modules are Present-only (deliberate, but unrecorded per-module)

`monitor.ts` (adaptation drift), `mutate.ts`/`reflection.ts` (offline prompt/workflow mutation), `pareto.ts`, `retirement.ts` have unit tests but **no importer** outside `reflection→mutate`; `registry.retire`/`assertAssignable` have no CLI caller. The status matrix rolls them into "M3–M6 machinery". Leave parked: wiring reflection would mint prompt/workflow-template candidates that `adapt eval` cannot evaluate (routing-policy only, `eval-routing.ts:150-154`), creating promotable-without-eval pressure. Do not wire this round.

### G5 — Stale privacy-dictionary text (small honesty item)

Record class `candidate` says "content is stored as hash, not body" (`record-classes.ts:180`), but `registry.snapshot()` has persisted full content blobs in `registry.json` since the `contents[]` field landed (`registry.ts:471-482`, `promotion.ts:128-130`). Today's contents are detector-generated routing JSON (no user text), but the dictionary line is factually wrong and P0 privacy sign-off is still open. Docs-truth fix only; no behavior change.

## Ranked next-round product work

All items preserve proposal-first; none touch live selection, `selectArm`, auto-promote defaults, or ADR-006. New `adapt` subcommands join `main.ts`'s live import closure — implementers must not import `routing/r1.ts`, `routing/shadow.ts`, `r1-shadow-report.ts`, `experiments/shadow-compare.ts`, or `simulation-holdout.ts` (live-isolation transitive test). New machine output starts frozen-additive per D3.

1. **`adapt show --candidate <cnd_…>`** — print candidate content (exact bytes), contentHash, author identity, parent version id, the **current active** version id for its identity (i.e., the correct `--expected`), and status; add `--content-out <file>` and a `--review-template <file>` that emits ready-to-edit review JSON with candidateId/contentHash/actorId prefilled and reviewer fields blank. Read-only against the registry; closes G1(1)+(2) and half of G2. Owns `src/cli/adapt.ts` + tests; no registry mutation.
2. **`adapt dataset --run <runId> --out <dir>`** — export a routing-eval `manifest.json` from a tracked run's recorded events (MODEL_ROUTED + TASK_RESULT + TASK_REQUEST + PROJECT_DISCOVERED). Deterministic, replay-class by construction; refuse runs with no PASS/FAIL-verified routed outcomes (matches eval's own refusal). Closes G1(3): the full loop becomes track → status → show → dataset → eval → promote. Caution: objectives are user text — the exported manifest is a new persisted record; add a record-class entry and route summaries through existing redaction posture rather than inventing one (D3 adaptation-plane privacy guard applies).
3. **`adapt status` deepening (+ optional `--json`)** — per-identity active version id, non-proposed candidate counts by status, promotion/rollback ledger tails, pending intents, `autoPromotionsUsed`. If `--json` ships, pin a frozen-additive `ADAPT_STATUS` type on day one. Closes the rest of G2 (rollback target discovery included).
4. **Docs truth-up** — add `adapt eval` / `adapt rollback` rows to USAGE and README (plus `--primary-model` on learn/auto); write one operator walkthrough (`docs/how-to-adapt-workflow.md` or README section) covering the end-to-end loop, the review-provenance rules (actorId = candidate author; reviewer ≠ actor; kind peer/independent), and the provisional `acceptProvisional: false` + empty-claims rule; fix the stale `candidate` record-class sentence (G5). Cheapest slot, real payoff.
5. **Parked — record, do not build:** wiring monitor/mutate/reflection/pareto/retirement (G4); a bandit-contents viewer (bandit is not on the live path; doctor already inventories damage); any shadow/R1 report CLI (blocked by the isolation closure and pointless before F-PROD). If a future round wants prompt-kind candidates, it must first extend eval beyond routing-policy — that ordering is the guardrail.

Items 1+2 are the round's high-value pair: they convert an implemented-but-unreachable promotion pipeline into an operator workflow while changing zero policy semantics. Item 4 can ride along with any slot. If only one slot exists, take item 1 — it unblocks promote for operators willing to skip eval-gated kinds' nice-to-haves, and `adapt show` is prerequisite tooling for item 2's verification anyway (routing-policy promote still requires the eval file, so item 2 is what fully closes the loop).
