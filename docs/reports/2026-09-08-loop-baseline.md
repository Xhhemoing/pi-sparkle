# Loop baseline — the adaptation loop closes end to end (2026-09-08)

**Evidence class: fake executor, seeded failures. Nothing here is F-PROD or
Outcome-supported evidence.** This report answers one question only: does the
execute → observe → propose → approve → live-route → rollback chain actually
run through the shipped CLI on `main` (`dc187a1`)? Yes. Every step below is a
real command with its real output; the state root was a throwaway
(`/tmp/sparkle-baseline`).

## Why this report exists

The routing/self-improvement line has been described as "present, wired,
exercised" in the status matrix, but no single record showed a learned policy
changing a live routing decision. Before spending F6 holdout budget, the loop
had to be shown to close at all — and the two frictions found here (§4) are
exactly the kind of thing a sealed holdout would have surfaced as a null result
at 100× the cost.

## 1. Baseline run (R0, nothing learned)

```
pnpm cli run --project /tmp/sparkle-proj --objective "Refactor the payment module and add integration tests" \
  --children children.json --state-root /tmp/sparkle-baseline
```

Five children, roles planner/implementer/tester/reviewer/scout:

```
routing (primary=premium, fast=cheap):
    tsk_plan_01 (planner, MEDIUM) -> premium
    tsk_impl_01 (implementer, MEDIUM) -> cheap
    tsk_test_01 (tester, LOW) -> cheap
    tsk_rev_01 (reviewer, MEDIUM) -> cheap
    tsk_res_01 (scout, LOW) -> cheap
```

39 events; 10 `MODEL_ROUTED` (assign + flowchart node), `policyVersion
router-v1-primary`, `featureVersion assign-v5`. Post-run auto-loop:
`adapt: no actionable model-project issue` — correct, the fake child always
returns `SUCCESS/PASSED`, so there is nothing to learn from.

## 2. Seeded observation run

`scripts/loop-baseline-seed.ts` appends, through the validated `EventStore`,
one run in which `cheap` fails the `review` family five times with
`outcome: FAILURE, verification: FAILED` (the `ACTIONABLE_SAMPLES = 5`,
`ACTIONABLE_MEAN < 0.45` thresholds in `src/learning/diagnostics.ts`).

```
npx tsx scripts/loop-baseline-seed.ts /tmp/sparkle-baseline /tmp/sparkle-proj cheap review 5
→ run_c74e60fa-…
```

## 3. Propose → eval → promote → live → rollback

| step | command | result |
|---|---|---|
| propose | `adapt learn --run run_c74e60fa… --primary-model premium` | `proposed routing-policy candidate (cnd_rsv_a5387842…)` — content: `avoid [{cheap, family review, reason "deterministic-check taskSuccess FAIL (failureClass=model)"}]` |
| dataset | `adapt dataset --run run_c74e60fa…` | 5 rows exported (`adaptation/eval-datasets/<run>/`) |
| eval | `adapt eval --candidate cnd_… --dataset …` | `action diff: 5 episode(s) cheap -> premium costDelta=+0.40 USD`; `quality evidence: none-by-construction`; positive cost-UCB warning, promotion still allowed |
| export bytes | `adapt show --candidate cnd_… --content-file content.json` | 207 bytes, hash `526ffa6d` |
| promote | `adapt promote --candidate cnd_… --expected rsv_rsv_e84c56f7… --content-file content.json --review-file review.json --eval-file <eval> --approve` | `promoted cnd_… -> rsv_rsv_f2201412… (rollback rsv_rsv_e84c56f7…)` |
| **live re-run** | same `run --children` as §1 | **`tsk_rev_01 (reviewer, MEDIUM) -> premium`**; `MODEL_ROUTED.eligibleModels = ["premium"]` (cheap removed from the allow-list by `applyLearnedRouting`); all other tasks unchanged |
| rollback | `adapt rollback --expected rsv_rsv_f2201412… --target rsv_rsv_e84c56f7… --reason user` | `rolled back …` |
| live re-run | same `run --children` | `tsk_rev_01 (reviewer, MEDIUM) -> cheap` — baseline restored |

The review artifact carried `reviewerKind: independent`, `reviewerId:
human:xhh`, `actorId: pi-sparkle-learn` (the detector) — the promotion rules
refused every shortcut tried before that (no `--approve`, no review file,
mismatched content bytes, see §4).

## 4. Findings

1. **The chain closes.** A promoted `routing-policy` version changes the live
   `--children` allow-list on the very next run, and rollback restores it.
   Live-path reading is the registry active pointer
   (`loadLearnedRouting` → `applyLearnedRouting`); `routing.json` is refused
   as a policy store by design.
2. **Nothing learns from success, and the fake never fails.** The fake child
   executor is unconditional `SUCCESS/PASSED`, so with the default executor
   the loop can be *exercised* but never *triggered*. Any fake-class rehearsal
   of the loop needs seeded FAIL observations (this script) or a fake failure
   knob (not added — proposal only).
3. **`failureClass` prose heuristics can silently swallow a model failure.**
   The first seed used the summary "acceptance check failed"; `classifyTaskFailure`
   matched `CONTRACT_HINT` (`acceptance`) and classified the FAIL as
   `contract`, which `diagnoseModelProjectIssues` correctly refuses to count
   against the model — result: `no bound taskSuccess outcomes`, no candidate.
   Real reviewers will write "acceptance criterion X not met" in summaries all
   the time. Worth deciding whether `verification.kind === FAILED` should
   outrank summary prose when no `failure` structure is present.
4. **`adapt dataset` needs `TASK_GRAPH_ACCEPTED`, which `--children` runs
   never emit.** Objectives are read only from that event
   (`eval-dataset.ts objectivesByTaskId`); the flowchart/children path records
   objectives elsewhere (child spec, `CHILD_RUN_CREATED`). So a candidate
   learned from a real `--children` run cannot get an eval report, and
   `promote` on a `routing-policy` **requires** `--eval-file`. Today the
   proposal-first loop is therefore only fully promotable from `--track`
   (supervisor) runs. This is the Phase-1 blocker to fix first.
5. **Cost-only eval.** `adapt eval` reports `utilityDelta 0` by construction
   and a positive cost UCB (+0.40 USD/episode for cheap→premium). It is a
   routing/cost fixture, never quality evidence — exactly as `adapt status`
   says. Quality evidence remains the F6 holdout's job.
6. **Content bytes are hash-strict.** Copying the printed candidate content
   adds a trailing newline and fails
   `eval report contentHash must equal …`; always use
   `adapt show --content-file` to export the exact bytes.

## 5. What this does and does not license

- Licenses: rehearsing the operator workflow, writing docs against real
  command output, and fixing §4.3/§4.4 before any real-provider collection.
- Does not license: any claim that learned routing improves outcomes. The
  seeded failures are synthetic; `avoid cheap for review` was learned from
  data written to make it learnable.

## 6. Next

1. Fix §4.4 so `adapt dataset` reads objectives from the children/flowchart
   path (real `--children` runs become promotable).
2. Decide §4.3 (verification-first failure class) — small change, large
   effect on what the diagnostics can ever see.
3. Only then: real-provider exploratory observation (Phase 2 of the routing
   plan), so R1 has model-diverse samples before F6 seals.
