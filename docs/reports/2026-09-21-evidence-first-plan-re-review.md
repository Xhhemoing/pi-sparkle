# Evidence-first phase plan — expert re-review request (2026-09-21)

## Purpose

This is the durable review request for the amended next-phase plan. It follows
an owner-supplied deep research report and a prior external review. The request
is for **read-only expert review of plan quality and boundary assumptions**, not
implementation approval and not a product-positioning approval.

## Materials and provenance

Primary materials:

- [Amended phase plan](../superpowers/plans/2026-09-21-evidence-first-phase.md)
- [Research-plan amendment](2026-09-21-deep-research-plan-amendment.md)
- [Prior external-review disposition](2026-09-21-external-review-disposition.md)
- [Projection plan](../superpowers/plans/2026-09-20-native-observation-projection.md)
- [Status matrix](../status-matrix.md)
- [Active checklist](../../tasks/todo.md)
- [Active plan index](../../tasks/plan.md)
- Relevant implementation: `src/native/apply.ts`,
  `src/native/apply-registration.ts`, `src/native/write-session.ts`,
  `src/pi-adapter/observation-tools.ts`,
  `src/pi-adapter/native-executor.ts`,
  `src/context/observation-store.ts`, and their tests.

Source research report:

- Original: `C:\Users\86080\Downloads\deep-research-report (2).md`
- Preserved copy: `../../.agent_workspace/external/deep-research-report-2026-09-21.md`
- SHA-256: `cc01f7b7e7459d26f9be1f8ec3ceb897dea5ba15de09ffef713c157cf26ed8ec`

The research report's market, vendor, regulatory, staffing, and budget claims
are not repository facts and were not independently re-verified here. Reviewers
should assess the plan's engineering consequences, not silently promote those
claims into status-matrix evidence.

## Changes since the previous plan review

1. A read-only evaluator manifest/freeze is now proposed **before** any live
   A/B/C pilot, so a mutable acceptance definition cannot contaminate a result.
2. R10/R11 is split into a pilot-safe read-only evaluator boundary and the
   later full apply/write boundary. Production apply must bind candidate,
   evaluator, runtime, policy, result, approval, and idempotency identities;
   exact signing/snapshot mechanics remain open for review.
3. Projection hardening now includes full SHA-256 counter keys, typed or
   fail-closed projectability, cumulative recall budgets, repeat-mass telemetry,
   and separate mechanism/economic/outcome measures. Cross-session counters are
   explicitly deferred.
4. A/B/C is explicitly exploratory: approximately 30 distinct tasks with
   2–3 repeats can detect large regressions and estimate cost scale, but cannot
   establish strict non-inferiority or a broad Outcome-supported claim.
5. Proposed pilot/confirmation thresholds are labeled hypotheses, not facts:
   pilot advance near 10% C-vs-B cost improvement; confirmation target near
   15%; proposed quality guardrail near −5 percentage points; critical integrity
   failures zero. They must be frozen or revised before data collection.
6. `cost per independently accepted task` is the primary platform metric;
   human correction time is separately reported and also included in an
   all-in sensitivity view.
7. The first possible Outcome-supported status row receives a separate owner
   evidence gate and must be narrowly scoped to task set, revisions, model,
   provider, evaluator, policy, budget, and environment.

## Required expert verdict

Please return one of:

- **APPROVE** — plan is internally coherent; no blocking issue.
- **APPROVE WITH CHANGES** — list concrete changes, severity, and exact plan
  section; no implementation should begin for the affected section until
  incorporated.
- **REQUEST CHANGES** — identify a blocking safety, validity, governance, or
  scope flaw; state the minimum change required to make the plan reviewable.

For every finding, classify it as `P0` (blocks the phase), `P1` (must be fixed
before the relevant gate), or `P2` (follow-up). Cite the exact file and heading.
Separate repository facts from hypotheses and external-report assumptions.
Do not apply edits or run live providers in this review.

## Review questions by domain

### A. Program/governance

1. Is the sequence `review channel → evaluator freeze → projection telemetry →
   exploratory pilot → confirmation decision → CLI decision → write boundary`
   correctly ordered?
2. Which gates require owner approval, and which should remain engineering
   autonomy? Is the separate Outcome-supported claim gate necessary?
3. Does the plan preserve the project's existing distinction between author-run
   verification, independent review, human approval, and outcome evidence?
4. Are the F6/M7 exclusions and the no-silent-fallback rule explicit enough?

### B. Evaluation/statistics

1. Is A/B/C correctly interpreted as A→B aggregate runtime effect and B→C
   projection marginal effect?
2. Are ≈30 distinct tasks × 2–3 repeats suitable for an exploratory pilot if
   repeats are not treated as independent? What task strata, pairing, stopping
   rules, and missing-run rules are missing?
3. Are the proposed thresholds clearly labeled as hypotheses, and what should
   be preregistered before data collection?
4. Is `cost per independently accepted task` defined without hiding failed
   attempts, retries, provider failures, runtime cost, or human correction?
5. What evidence and sample size would be required before a narrow
   Outcome-supported claim?

### C. Security/trust boundary

1. Is a frozen read-only evaluator manifest enough to make the projection pilot
   valid without closing full write/apply R10/R11?
2. Is the proposed capability identity minimally complete, especially
   candidate-tree snapshot, evaluator bundle, runtime/tool schema, policy,
   approval, expiry, and idempotency?
3. Does the PREPARED → VERIFIED → AUTHORIZED → APPLIED → RECEIPTED state model
   cover the important crash/replay/delete windows?
4. Should authoritative evaluator files be outside candidate write scope,
   digest-bound, or both? Which claims are safe in a local weak-integrity mode?
5. Are typed projectability and cumulative recall budgets required now, or can
   they be staged without weakening the current default-off contract?

### D. Repository consistency

1. Does the amended plan contradict `docs/status-matrix.md`, accepted ADRs,
   `tasks/todo.md`, or the current implementation?
2. Are any referenced deliverables too vague for a future implementer, or are
   any proposed changes outside the stated phase scope?
3. Does the plan accidentally imply that the supplied research report is
   independent verification or that the existing 2826-pass gate is a live
   outcome result?

## Dispatch status (2026-09-21)

The first four-way `sparkle_delegate` attempt did not start because the
preferred `cursor-grok-4.6-fast` model was unavailable. A second attempt with
an explicit `xhh-api/gpt-5.6-sol` override failed with `no actionable
model-project issue`. Neither result is an expert verdict, independent
verification, or approval. No fallback was silently promoted. The owner-
designated `luna-fast` channel remains subject to the relay outage recorded in
[the outage report](2026-09-20-luna-dispatch-outage.md). A future dispatch must
record the exact baseline commit and reviewer provenance before its result is
used as a gate.

## Expected review artifact

A bounded report with:

- verdict;
- findings ordered by severity;
- exact path/heading citations;
- accepted assumptions vs facts;
- recommended plan edits;
- unresolved questions and the condition for re-review.

Independent review is still subject to the relay/channel gate recorded in
`docs/reports/2026-09-20-luna-dispatch-outage.md`; no reviewer result is
claimed until the actual dispatch path and reviewer provenance are recorded.
