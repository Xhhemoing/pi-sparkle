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

1. **Rust PR closeout** ([PR #85](https://github.com/Xhhemoing/pi-sparkle/pull/85), candidate `ef533595e8ff66720c634c8bcca8a30ba7696d24`, `agent-delivery-guidance` worktree). [CI 40212357799](https://github.com/Xhhemoing/pi-sparkle/actions/runs/40212357799) and [recovery 40212357893](https://github.com/Xhhemoing/pi-sparkle/actions/runs/40212357893) succeeded for this candidate. Preserve the local full-gate failure and the unchanged isolated rerun failure of `cumulative TaskSpec worker allowance excludes slow first-factory preparation` (`worker cumulative time budget exhausted`; exit 1). One private instrumented synthetic case retained the original 1-second worker budget, 1.2-second preparation and assertions and passed: preparation 1925.932 ms, base checks 705.103 ms, worker charge 942.805 ms, executor 3.048 ms. Source and instrumentation show preparation is excluded from worker charging; the charged parent-run interval includes host settlement/persistence overhead and had only 57.195 ms remaining. The original failed runs were not instrumented, so their exact timings and the cause of the variation remain unknown; the later diagnostic pass does not erase them. Evidence stays in `.agent_workspace/phase1-languages/` (`rust-gate.log`, `rust-timing-isolated-20261025.{log,json}`, `timing-diagnostic-evidence-20261025.json`). The original serial local gate (PID 48816) is still running at this checkpoint; complete local gate/build acceptance is not established. The owner approved the two-line plan/checklist proposal in chat on 2026-10-25; the resolution retains this plan structure and changes only Rust R0.1 in these files. Obtain current checks for the resulting candidate. Runtime PR #85 still requires the owner's merge decision.
2. **External PRs #80/#82**: fork CI was approved 2026-10-25. Process them after Rust merges, since they overlap the single-writer `test/integration/cli/task-spec.test.ts` and `tasks/plan.md`. Ask the contributors to rebase, or have the coordinator integrate their cases serially; their `tasks/plan.md` changes are not taken. #80 changes path containment logic and needs an independent review. The owner merges.
3. **Task record tooling** (does not exist today). Add `scripts/real-task-record.mjs` and `scripts/real-task-summary.mjs` (dev scripts, not in the published package, no new public CLI). Records are built from what already exists: the `task run --json` projection (status/accepted/effectsSettled/runId/refusal), the cost for that runId in `<stateRoot>/invocations.jsonl`, and phase timestamps, plus human-entered fields. Failure categories reuse `src/routing/outcomes.ts` `FailureClass` (model/contract/tool/environment/provider/run), with a free-text root cause. Records go to `.agent_workspace/real-tasks/<date>-<id>/record.json`; never commit them. Acceptance: unit tests use synthetic projection/invocation inputs, and the summary counts every attempt, unknown cost appears as unknown, and the weekly spend counts each unknown-cost attempt as US$5.
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
