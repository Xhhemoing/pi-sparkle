# Active implementation plan

## Real-task improvement loop (2026-10-25)

Owner decision 2026-10-25 ([ADR-011](../docs/decisions/0011-real-task-improvement-loop.md)): the project had drifted toward synthetic tests and process. From now on, **real development tasks drive the work**. Run pi-sparkle on real tasks, record every outcome, review the failures periodically, and fix *classes* of problems with general mechanisms. On that basis, build bounded self-optimization in two steps: proposal → approval → verification, then automation. The previous Phase 1 plan is archived at [2026-10-25-phase1-plan](archive/2026-10-25-phase1-plan.md). TS (S4) is merged as #83; Rust (S5) is finishing; resume B1/B2 is deferred (see "Retained" below).

### Purpose and measures

The essential goal: **make Pi deliver real changes more correctly and efficiently.** Every piece of work is ranked by its effect on these per-task measures (the denominator is every attempt; failures, rejections, timeouts and unknowns are all included):

| Measure | Definition |
|---|---|
| Correct delivery | The candidate passes acceptance, the owner/reviewer keeps it after review, and no problem turns up afterwards |
| Escaped defect | A problem found after apply or later in use (the most important signal) |
| Human interventions | Number of times a person had to step in: rewriting the TaskSpec, giving hints, fixing it by hand, retrying |
| Total time | Writing the TaskSpec + preparation + model + checks + review, recorded per phase |
| Total cost | Reference cost of all attempts, including failures and retries; unknown cost is recorded as unknown, never as 0 |

The ADR-010 targets still stand: defects reduced by at least 50%, correct delivery non-inferior (within -3 points), and cost per correct delivery at most 1.3x. They are proven only once matched comparison data exists.

### Authorization and autonomy

| An agent (Codex) may do directly | Must stop and ask the owner |
|---|---|
| Run real tasks on pi-sparkle's own backlog and on isolated Soul copies, within budget | Apply any change to the original Soul (`E:/Project/Soul`) |
| Spend up to **US$5 per task / US$50 per week** (reference cost; owner's configured Pi model) | Exceed the budget, add a provider/model, or have enough unknown-cost attempts that the cap can no longer be judged |
| Open PRs; **self-merge PRs that only change docs, task records or tests, once current CI is green** | Merge PRs that change runtime behavior, safety, CI or dependencies |
| Fix bugs exposed by real tasks, test first, including the safety core | Changes to authorization/safety boundaries, frozen CLI/event/JSON, or the scope of ADR-011 |
| Generate improvement proposals and prepare evidence for each one | Approve proposals (R3), enter automation (R4), benchmarks, npm publication, deleting worktrees or private evidence |

Agent-authored conflict resolutions still require the existing human conflict-hunk review. Prefer small PRs that merge quickly so conflicts never arise.

### Stages and acceptance

**R0 Close out and prepare (no model spend)**

1. **Rust PR closeout** ([PR #85](https://github.com/Xhhemoing/pi-sparkle/pull/85), candidate `ef533595e8ff66720c634c8bcca8a30ba7696d24`, `agent-delivery-guidance` worktree). [CI 40212357799](https://github.com/Xhhemoing/pi-sparkle/actions/runs/40212357799) and [recovery 40212357893](https://github.com/Xhhemoing/pi-sparkle/actions/runs/40212357893) succeeded for this candidate. Preserve the local full-gate failure and the unchanged isolated rerun failure of `cumulative TaskSpec worker allowance excludes slow first-factory preparation` (`worker cumulative time budget exhausted`; exit 1). One private instrumented synthetic case retained the original 1-second worker budget, 1.2-second preparation and assertions and passed: preparation 1925.932 ms, base checks 705.103 ms, worker charge 942.805 ms, executor 3.048 ms. Source and instrumentation show preparation is excluded from worker charging; the charged parent-run interval includes host settlement/persistence overhead and had only 57.195 ms remaining. The original failed runs were not instrumented, so their exact timings and the cause of the variation remain unknown; the later diagnostic pass does not erase them. Evidence stays in `.agent_workspace/phase1-languages/` (`rust-gate.log`, `rust-timing-isolated-20261025.{log,json}`, `timing-diagnostic-evidence-20261025.json`). The original serial local gate (PID 48816) is still running at this checkpoint; complete local gate/build acceptance is not established. Owner review of the proposed plan/checklist conflict hunks is pending before any actual merge/rebase resolution; retain this plan structure and change only Rust R0.1 in these files. After an approved resolution, obtain checks for the resulting candidate. Runtime PR #85 still requires the owner's merge decision.
2. **External PRs #80/#82**: fork CI was approved 2026-10-25. Process them after Rust merges, since they overlap the single-writer `test/integration/cli/task-spec.test.ts` and `tasks/plan.md`. Ask the contributors to rebase, or have the coordinator integrate their cases serially; their `tasks/plan.md` changes are not taken. #80 changes path containment logic and needs an independent review. The owner merges.
3. **Task record tooling** (implemented candidate, owner merge pending). Review `scripts/real-task-record.mjs` and `scripts/real-task-summary.mjs` (dev scripts, not in the published package, no new public CLI). Records are built from what already exists: the `task run --json` projection (status/accepted/effectsSettled/runId/refusal), the cost for that runId in `<stateRoot>/runtime/invocations.jsonl`, and phase timestamps, plus human-entered fields. Failure categories reuse `src/routing/outcomes.ts` `FailureClass` (model/contract/tool/environment/provider/run), with a free-text root cause. Records go to `.agent_workspace/real-tasks/<date>-<id>/record.json`; never commit them. Acceptance: unit tests use synthetic projection/invocation inputs, and the summary counts every attempt, unknown cost appears as unknown, and the weekly spend counts each unknown-cost attempt as US$5.
4. **Task queue**: private file `.agent_workspace/real-tasks/queue.md`. Sources: (a) pi-sparkle: this checklist, GitHub issues, and friction hit while using it; (b) Soul: requirements the owner gives, plus Soul's own TODO/issues (read-only). Each entry records source, size estimate, risk, and whether it gets a direct-Pi comparison.
5. **Isolated Soul copies**: before each task, `git clone --no-hardlinks` the original Soul's committed HEAD onto a drive with enough space (E: has under 1 GB free; use C: or D:). Do not copy `target/` or uncommitted content; set a separate `CARGO_TARGET_DIR`. **Use synthetic test data only**; private chat/personal data (for example `E:/SoulFeedback`) never enters prompts or records. Record the original Soul HEAD at copy time, and never write to the original Soul.
6. **Budget**: each TaskSpec sets `budget.usd <= 5`; check the weekly running total with the summary script before each task.

R0 exit: Rust PR submitted; record/summary tooling usable (owner merges); queue holds at least 10 tasks; isolated-copy procedure verified once.

**R1 First real tasks (rolling, starting at 10)**

- Alternate between the two sources: pi-sparkle dogfood (candidates: split #68, the helper kill-error/reap regression, real failures surfaced by the tests, doc/onboarding friction) and Soul requirements.
- Per task: write the TaskSpec (time this, since it is a human cost) → `pnpm cli preflight <task> --project <repo> --json` → `pnpm cli task run <task> --project <repo> --executor pi --review --json` → review the candidate → apply/discard/retain → write the record. Pi-sparkle candidates go through the normal PR flow after apply; Soul candidates stay in the copy as a branch/patch for the owner to decide.
- At least 3 of the first 10 tasks also get a **direct-Pi** comparison run with the same model, inputs and budget, so comparison data starts accumulating.
- Stop conditions: budget hit; an infrastructure failure with a fixed cause may be rerun once; record any other failure and move to the next task. Do not loop on retries.
- Exit: 10 attempts recorded (any outcome) and a summary generated; original Soul unchanged; budget respected.

**R2 Reviews and class fixes (every 10 attempts or weekly)**

- Aggregate by failure class and root cause, by intervention count, and by where the time went. Pick the 1-2 classes with the highest frequency × cost.
- Write a hypothesis in this plan (class X drops from a/n to ≤ b/n over the next n tasks) and a general fix. Prefer improving shared inputs: TaskSpec init inferring checks and scope, context selection, preparation detection, guidance to the worker. Build the failing test from a minimal synthetic reproduction of the real failure, without private data.
- Verify on later real tasks. A class is solved only once it actually shrinks; otherwise record the result and change approach.
- Update the "Run statistics" table below at each review.

**R3 Self-optimization step 1: proposals → owner approval → verification**

- Extend the existing proposal-first mechanism (`src/lab/adaptation` candidates/evaluation/CAS promotion and rollback, `src/lab/learning` diagnostics and pattern detection, `pi-sparkle adapt learn|eval|promote|rollback`) from routing to: TaskSpec template defaults, context selection rules, check recipes, worker guidance, and model/thinking choice. Do not build a parallel system.
- Each proposal carries its source records, expected effect, scope and rollback. Batch them for the owner; approval goes through the existing `adapt promote --review-file --approve` (reviewer different from the author). Permissions, credentials and security settings are never proposed for automation.
- Evaluation: compare the approved proposal against the previous period/same task category on later real tasks, recording every outcome. Exit: at least 2 proposals evaluated on at least 5 later tasks each, with conclusions (better/worse/unclear).

**R4 Self-optimization step 2: automate what has proven effective (requires owner approval to enter)**

- Only proposal types with outcome-supported improvement. The owner sets the `approval-profile` scope (for example `maxAutoPromotions`), and a test first verifies the stop/rollback chain. Every automatic change is recorded; if measures regress, roll back automatically and stop. Review every 10 tasks.

**R5 Public proof (the former Phase 2)**: once the real-task records show a benefit worth proving, register the 30-task Sparkle-Bench three-arm evaluation following the ADR-010 statistical rules. Paid runs, macOS CI, Windows process-tree reclamation, 10-minute onboarding and npm publication each need separate authorization.

### Verification policy (ADR-011 §5)

- Keep the safety tests that protect user code: scope/protected paths, exact candidate checks, explicit apply, budgets, cancellation, settlement, unknown-effect refusal.
- Ordinary changes: focused tests + `pnpm typecheck` + `pnpm lint` locally; the complete suite runs in hosted CI. Safety-core changes (scope, candidate/apply/discard, Ledger, budgets, cancellation) and releases also run one serial `pnpm gate` plus the applicable probes. Docs/records: `pnpm workflow:check` + `git diff --check`.
- Write a test only when a real failure exposes a gap; do not report test counts as progress. Record failed, skipped and unknown results as they are; a later pass does not mean the cause was found.

### Per-task record fields

`id, date, source (pi-sparkle|soul), arm (sparkle|direct-pi), objective summary (no private content), taskSpecMinutes, prepare/model/check/review seconds, status, accepted, applied/kept, failureClass, rootCause, interventions, referenceUsd|unknown, escapedDefects (backfilled), linked PR/branch, notes`.

### Run statistics

| Review | Attempts | Correct delivery | Escaped defects | Avg interventions | Total cost | Top failure classes | Fixes/proposals in progress |
|---|---|---|---|---|---|---|---|
| — | 0 | — | — | — | US$0 | — | — |

### Retained evidence and unfinished obligations

- [Archived Phase 1 plan](archive/2026-10-25-phase1-plan.md): S4 TS is merged (#83). **B1/B2 resume is deferred** until real tasks show that interrupted work needs cross-process apply/discard; its trust model, budget and counterexample acceptance details remain the requirements whenever it resumes. [Phase 1 exit traceability](../docs/evidence/phase1-exit.md) keeps its candidate-specific scope. Declaring Phase 1 complete is still the owner's decision.
- [Whole-plan obligations and prior PR disposition](archive/2026-10-25-pre-maintenance-plan.md#whole-plan-completion-obligations): #68 still needs to be split; #72 stays a deferred lab evaluation. Before adopting the old direct helper, its kill-error/reap regression must be fixed and retested. The old 15-task comparison is unfinished; real-task records may feed it but do not complete it automatically.
- [Earlier unresolved obligations](archive/2026-10-21-pre-integration-checklist.md): F6, S0-min, R10/R11, PR #36 artifacts, privacy, containment and production approval.
- Unexplained anomalies stay recorded: one Windows CI failure on #79, a local Git error on #81, an intermediate TS preflight failure, and the 2026-10-25 Rust gate timing failure.

For a local generation-time snapshot run `pnpm status`; `STATUS.md` is ignored, not a source of authorization. CI generates `.agent_workspace/ci/STATUS.md` and includes it in the existing quality and CLI artifacts. Open the relevant Actions run, download its job artifact and restore that path in a checkout of the same commit to follow relative links. The snapshot says CI unknown; obtain live CI state from the run itself.
### R0 preparation candidate (2026-10-25)

Next usable result: record a real task from existing host projections and cost observations, then summarize every attempt and the weekly budget before dispatch. Effective implementation workspace: `C:/Users/86080/.codex/worktrees/real-task-tooling/pi-sparkle`, branch `codex/real-task-record-tooling-20261025`, based on main after ADR-011 merge `af04fd6b` (#84). E: is below the 2 GiB heavy-work threshold; all new state/copies/build output use C:/D:.

- Scope: `scripts/real-task-record.mjs`, `scripts/real-task-summary.mjs`, `test/unit/package/real-task-record.test.ts`, this plan/checklist. Development tools only; no published CLI/schema, lifecycle, dependency or authorization changes. Owner merges the tooling PR. No extra local full gate; ordinary focused/type/lint checks and hosted CI apply.
- Records: selected fields from captured execution/application/disposal JSON, operator phase timestamps/seconds and review observations. Failed/refused/timeout/missing projections remain attempts; worker acceptance is separate from reviewed/kept delivery. Each comparison arm has its own attempt ID and a shared `comparisonId`. Direct-Pi results require independently reviewed `checkEvidence`; observation-only `--update` backfills review/escaped defects without adding attempts or replacing Sparkle execution/cost identity. Invocation logs, prompts, checker bodies, credentials and arbitrary extra fields are not copied into records.
- Costs: read existing `runtime/invocations.jsonl`, retain all retries/failures in accounting, and keep unknown totals unknown. A numeric logical-task total also requires the existing native-write-loop worker population and independent complete/settled NativeWriteCostSummary receipts; sparse telemetry cannot certify completeness. Partial receipts/logs preserve observed known lower bounds. Unknown attempts reserve `max(US$5, observed lower bound)`; an observed task overrun prevents further admission even below the weekly cap. Summary is observation of the existing budget, never lifecycle authority.
- Validation: test-first synthetic subprocess cases cover real projection shapes, all outcomes, retry/drop/partial costs, cross-week and paired arms, review backfill and record path/identity errors. Independent read-only review reproduced accounting/direct-arm defects; all reported findings are now resolved by affected re-review. REDs, intermediate failures, focused results and final command logs remain in `.agent_workspace/tooling-evidence/`; final whole-candidate type/lint/workflow/diff checks and hosted CI must be read before delivery. Initial lint failure is retained, not erased by the repair. No full runtime or real-task acceptance is claimed.
- Private queue: `.agent_workspace/real-tasks/queue.md` has 10 alternating candidate objectives (5 pi-sparkle backlog, 5 committed Soul requirements; 3 matched direct-Pi pairs planned). Recheck requirements/current committed implementation before each run; replace already completed work from the same accepted source instead of repeating it.
- Isolation rehearsal: clean `--no-hardlinks` committed-only Soul clone at `D:/pi-sparkle-lab/.agent_workspace/real-tasks/r0-soul-copy-20261025/source`, HEAD `7f5aca3`. Original HEAD/tracked status unchanged at copy time; 34 existing dirty tracked paths and target directories were not copied; no Git object alternates. Separate Cargo target is registered, no Cargo/model run performed. Evidence: private `soul-isolation-verification.json`. Fresh clone/HEAD and synthetic-only inputs are required for each actual task.
- Rust: [#85](https://github.com/Xhhemoing/pi-sparkle/pull/85) is submitted and ready at `ef533595`; current CI/recovery green. Existing local gate still running with a timing failure. Unchanged isolated rerun failed exit 1; one bounded private probe retained the original assertions/budgets and measured prepare 1925.932ms, base checks 705.103ms, worker charge 942.805ms and executor 3.048ms. Preparation is excluded from worker accounting; the host interval has only 57.195ms margin. Exact original-failure timing/load contribution remains unknown. No product fix, allowance increase or further retry. The earlier wait helper was canceled; no duplicate rerun is scheduled. Evidence stays under the Rust worktree's `.agent_workspace/phase1-languages/`.
- Decisions/dependencies: #84 was merged without squash as `af04fd6b` after exact-head green CI and independent review, under the latest explicit /goal docs-only authorization. Rust's plan/todo conflict has a concrete private proposal preserving the ADR-011 structure and updating only Rust R0.1; human hunk review must precede actual resolution/commit/push. Runtime #85 and tooling still need owner merge; #80/#82 integration remains after Rust. #80 has a read-only review of `d89c5649` with no actionable finding, not integrated-candidate verification.
- Model selection resolved by owner in chat: new endpoint and two models authorized; defaults/credential stores saved for both Pi and Sparkle, old endpoint test aliases replaced, unrelated providers retained. Both requested IDs appear in the authenticated catalog; actual generation/thinking support remains unverified. Sol/high is the default; Luna/xhigh (max alternative) is in the private task profile. Prices are unverified, so zero/omitted configuration prices are not evidence of free service. Private redacted state: `.agent_workspace/real-tasks/model-configuration.json` and `.agent_workspace/real-task-models.json`; no credential in Git, CLI arguments or logs. New processes load persisted defaults; existing processes must explicitly load the saved thinking/provider/model environment for task runs.

All sources/arms write to **one coordinator record root** so the weekly denominator is complete. Dates are explicit America/Los_Angeles local dates, and `--week` is an ISO Monday. Minimal metadata fields are `id,date,source,arm,objective`; add measured task-spec minutes, prepare/model/check/review seconds or timezone-bearing `{start,end}`, interventions and explicit review observations. Missing observations stay unknown, including escaped defects until checked.

```powershell
$ErrorActionPreference = 'Stop'
node scripts/real-task-summary.mjs --root . --week 2026-10-19 --json
node scripts/real-task-record.mjs --root . --metadata .agent_workspace/task/metadata.json --projection .agent_workspace/task/projection.jsonl --state-root .agent_workspace/task/state
# Optional: append --loop-artifact <existing final native-write-loop artifact> for complete cost evidence.
# Without it the attempt remains recorded with unknown total and any observed lower bound.
node scripts/real-task-record.mjs --root . --metadata .agent_workspace/task/review.json --update
node scripts/real-task-summary.mjs --root . --week 2026-10-19 --json
```

Initial writes refuse overwrite; explicit updates preserve the original cost/execution observations. Keep free-text summaries redacted and never include private data. All comparison arms share the US$50 cap; unknown pricing can require the next week. R0 is not yet complete: owner tooling merge, Rust integration/conflict decision and current hosted results remain. R1 has not started: **0 real attempts, US$0 model spend**. R2/R3 outcome exits and the ADR-010 benefit targets remain unproven.
