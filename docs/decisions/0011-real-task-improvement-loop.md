# ADR-011: Real-task-driven improvement loop

- Date: 2026-10-25.
- Status: **Accepted by the owner in conversation on 2026-10-25.** Amends the priority order and the learning/adaptation freeze of [ADR-010](0010-evidence-bound-changes.md); ADR-010's product role, execution boundaries, apply/settlement safety and benefit targets stay in force.
- Active plan: [tasks/plan.md](../../tasks/plan.md).

## Context

From Phase 0 to Phase 1, every reported success used synthetic fixtures and loopback models. A typical runtime change waited about two hours for a serial local gate (4,810 tests), and recent deliverables mostly handled configuration-failure messages. Defect reduction, correct-delivery non-inferiority and cost per correct delivery were never measured on real work. The owner judged this to be drift away from the program's purpose. Real development and production expose many more kinds of failure than a fixture suite can encode, so fixing one narrow failure at a time does not converge.

## Decision

1. **Purpose.** pi-sparkle exists to make Pi deliver real development changes more correctly and efficiently. Work is ranked by its effect on real tasks: correct deliveries, human interventions, rework, defects that escape to later use, total time and total cost including failures. Test counts and green gates show safety; they do not show progress.
2. **Real tasks drive development.** Run pi-sparkle on real development tasks from two sources at the same time: pi-sparkle's own backlog (dogfooding) and Soul's real requirements, implemented in an isolated copy and applied to the original only by the owner's explicit decision. Record every attempt, including failures, rejections, timeouts and unknown costs.
3. **Fix classes of problems.** Review the recorded attempts periodically, group failures by root cause, and fix the most frequent or costly class with a general mechanism. Prefer improving shared inputs over adding a special case for one failure: task description, context selection, check recipes, preparation and guidance to the worker. A class fix counts as successful only when later real tasks show the class shrinking.
4. **Bounded self-optimization, in two steps.**
   - Step 1, proposals: the system derives improvement proposals from recorded attempts, for example TaskSpec templates, context rules, check recipes, prompt guidance or model choice. The owner or a delegated reviewer approves each proposal before it is used. Approved proposals are evaluated on subsequent real tasks against the previous behavior, recording all outcomes.
   - Step 2, automation: only a proposal *type* whose approved instances improved measured real-task outcomes may be applied automatically. Automatic changes stay within the budget and safety boundaries, are recorded with a rollback path, and are reviewed periodically. Hidden or held-out scoring never feeds proposals.
   - Reuse the existing mechanisms: the proposal-first adaptation plane of [ADR-004](0004-controlled-adaptation.md) and [ADR-009](0009-lightweight-adaptive-framework.md) (`src/lab/adaptation` versioned candidates, evaluation plans, CAS promotion/rollback, `approval-profile` with `maxAutoPromotions: 0` by default; `src/lab/learning` diagnostics and pattern detection; `pi-sparkle adapt learn|eval|promote|rollback`). Extend them from routing to other proposal types instead of building a parallel system. Their rules still hold: permissions, credentials and security settings never auto-promote, and only outcome-supported changes count as improvements. Step 2 needs the pre-authorized scope and verified stop/rollback chain that ADR-009 requires.
   - This ADR lifts the freeze only for this loop. Unrelated P4/P5 features stay frozen until a separate decision.
5. **Lighter verification, same safety.** Keep the tests that protect user code: scope enforcement, protected paths, exact candidate checks, explicit apply, settlement and unknown-effect refusal. For an ordinary change, run focused local tests plus typecheck/lint and rely on hosted CI for the complete suite. Reserve the serial local `pnpm gate` for changes to the safety core (scope, candidate/apply/discard, Ledger, budgets, cancellation) and for release. Write a new test when a real failure shows a gap, not to raise coverage in the abstract.
6. **Autonomy and budget.** Autonomous agents may spend up to US$5 per task and US$50 per week in reference cost on the owner's configured Pi model. They stop and report when either limit or an unknown-cost state would exceed it. Agents may merge their own PRs to `main` only when the PR changes documentation, records or tests alone and current CI is green. The owner merges runtime-behavior and safety changes, applies changes to the original Soul, approves new providers, budget increases, publication and any widening of this ADR.

## Boundaries that do not change

- Original Soul code and data are modified only through the owner's explicit apply decision. Private chat or personal data never enters prompts, records committed to Git, or uploaded artifacts; tasks use synthetic test data.
- A worker's self-report is not acceptance. Exact-candidate checks, accept/apply separation, cumulative budgets, cancellation, settlement and refusal on unknown effects remain mandatory.
- The ADR-010 benefit targets (defects reduced by at least 50%, correct-delivery non-inferiority within -3 points, cost per correct delivery at most 1.3x direct Pi) still need comparative evidence. Real-task records are the first source of that evidence; they do not establish the targets on their own.
- Paid benchmark runs, npm publication and release need separate authorization.

## Consequences

- Phase 1 resume (B1/B2) is deferred until real tasks show that interrupted work needs cross-process apply/discard. Its acceptance details remain in the archived plan.
- Phase 2's 30-task benchmark follows the real-task loop: only once real-task records show a benefit worth proving publicly.
- The active plan records aggregated loop statistics at each review. Per-task details stay private under `.agent_workspace/real-tasks/`.
