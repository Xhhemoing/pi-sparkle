# Deep-research plan amendment — 2026-09-21

## Provenance and scope

A research report supplied by the owner was reviewed as a strategic input:

- Original path: `C:\Users\86080\Downloads\deep-research-report (2).md`
- Preserved project copy: `.agent_workspace/external/deep-research-report-2026-09-21.md`
- SHA-256: `cc01f7b7e7459d26f9be1f8ec3ceb897dea5ba15de09ffef713c157cf26ed8ec`
- Retrieval/review date: 2026-09-21

The report contains external market, research, and regulatory claims. Those
claims have **not** been independently re-verified in this repository and are
not treated as project facts. Its embedded `cite`/`filecite` tokens are not
repository-resolvable sources; uncited or future-dated claims require an
independent URL/source, retrieval date, and evidence record before promotion.
Repository facts remain sourced from `docs/status-matrix.md`, task plans,
verification records, and current code. This record captures the plan changes
proposed by the report and identifies what still requires expert or owner
approval.

## Strategic synthesis

The report's strongest recommendation is accepted as a planning hypothesis,
not yet as final product positioning:

> Treat pi-sparkle as a vendor-neutral **Evidence & Change Control Runtime**
> around coding agents, rather than as another general-purpose coding agent.

The measurable value hypothesis is:

> Under fixed task, model, tool, evaluator, and budget conditions, reduce the
> total cost per independently accepted task without reducing acceptance
> integrity, while preserving an auditable chain from candidate to approval and
> apply.

The README/product-positioning decision remains owner-gated. No
Outcome-supported claim follows from this hypothesis.

## Plan changes adopted for expert review

### 1. Evaluator/apply boundary moves before the real-provider pilot

The prior plan placed the R10/R11 boundary review immediately before
write-tool registration. The research report identifies this as a product-level
trust boundary, not a late implementation detail. The revised plan therefore
requires a **boundary design and freeze gate before the A/B/C pilot**. The pilot
may exercise read-only delegation and projection only; write-tool registration
remains blocked until the boundary implementation and independent review are
closed.

The proposed production invariant is:

- the authoritative evaluator bundle is not writable by the candidate;
- candidate-supplied tests are evidence, not the sole authoritative verdict;
- the apply capability identifies an immutable candidate snapshot rather than
  trusting a mutable path;
- evaluator/config/runtime/policy/result identities are bound to the issued
  capability;
- any change to those identities invalidates the capability and requires a
  new evaluation/approval;
- the local weak-integrity mode, if retained, is explicitly labeled and is not
  used for a strong Outcome-supported claim.

The minimum proposed capability identity is:

```text
run_id
repo/tenant identity
base revision
candidate tree digest
 evaluator bundle digest
 evaluator result digest
 runtime/container identity
 tool-schema digest
 policy digest
 approval identity
 issue/expiry timestamps
 idempotency/apply key
```

Whether cryptographic signing is needed in the first implementation, and the
exact immutable snapshot mechanism, are questions for the expert review. This
record does not claim that these fields already exist in the code.

### 2. Apply lifecycle becomes an explicit reconciliation state machine

The boundary review must cover the following durable states and crash windows:

```text
PREPARED -> VERIFIED -> AUTHORIZED -> APPLIED -> RECEIPTED
```

Recovery must reconcile repository state and an idempotency/apply key rather
than infer "not applied" from a missing receipt. Required negative cases:

- candidate/evaluator changes after verification;
- source base advances before merge;
- process failure after source mutation but before receipt persistence;
- duplicate or resumed apply requests;
- disposal or deletion while an apply is in progress.

The exact implementation can be narrower than a full distributed transaction,
but the claimed guarantee must be explicit: Git rollback cannot undo
out-of-repository side effects such as network calls, credentials, or external
files.

### 3. Projection policy becomes typed and budget-aware

The current projection path is default-off and read-result-only. The amended
plan proposes a typed projectability policy rather than relying primarily on
text markers:

```text
projectable =
  resultKind == observation
  && !isError
  && !mutatesState
  && !securityCritical
  && toolPolicy.projectable
```

At minimum, error results, evidence/verification receipts, permission results,
secret-bearing output, and write-tool results remain non-projectable. The
existing marker check remains fail-closed until typed metadata is available.

The projector should add a **cumulative recall budget** in addition to the
existing per-page bound:

- maximum bytes/tokens per recall;
- maximum cumulative recall bytes/tokens per run;
- maximum page count and recall calls;
- explicit typed budget-exceeded result;
- no silent truncation of evidence or receipt metadata.

The send counter should use the full content SHA-256 and remain run-local for
now. Cross-session persistence is explicitly deferred until telemetry proves
that its benefit justifies stale-snapshot, privacy, reproducibility, and
benchmark-contamination risks. If later reconsidered, the key must include
tenant/repository/content scope, tool-schema version, and projection algorithm
version; cross-tenant sharing is prohibited.

### 4. Measurement is split into mechanism, economics, and outcome

The plan now requires the following mechanism metric before interpreting total
cost:

```text
repeat-mass =
  tokens in projectable same-content observations from repeat 3 onward
  / all tool-output tokens
```

Economic telemetry must use provider-reported usage where available and keep
these components separate:

- input/model tokens;
- cached input tokens;
- output tokens;
- retries and failed attempts;
- runtime/sandbox compute;
- wall time;
- human correction time.

The canonical primary platform KPI is:

```text
cost per independently accepted task bundle
= all provider/runtime costs for the fixed K scheduled runs and retries
  / distinct tasks with at least one valid independent acceptance
    without human correction
```

Human correction minutes are a separately gated secondary outcome and are also
reported in an all-in sensitivity analysis with a predeclared valuation. A zero
accepted-task denominator is undefined and blocks a claim. No metric may
silently treat missing usage as zero or exclude provider/auth/quota failures
from task cost.

### 5. A/B/C pilot is explicitly exploratory

The groups remain:

- **A:** native Pi single-agent baseline;
- **B:** pi-sparkle, frozen routing, projection disabled;
- **C:** same as B, projection enabled.

B→C estimates projection's marginal effect; A→B estimates the runtime's
aggregate effect. The pilot target is approximately 30 distinct tasks with exactly K=2 scheduled
runs per arm (a third scheduled run requires a new preregistered protocol),
stratified before execution by language, repository size, task class, context
size, test duration, and arm-independent expected repeat-observation mass.
Realized repeat mass is post-treatment and is reported descriptively, not used
for primary eligibility or favorable subgroup selection.
Repeated runs are not treated as independent tasks.

The pilot can discover large regressions and cost scale. It **cannot** by
itself establish strict non-inferiority or a broad Outcome-supported claim.
A confirmatory phase is required if the pilot passes its advance gate:
a later/untouched task set whose size is recalculated from pilot variance,
paired discordance, repository clustering, and the pre-registered MDE; a
100–200 range is only a planning placeholder, not a power guarantee.

The following are proposed thresholds for expert/owner review, not accepted
project facts:

- pilot advance signal: C shows at least 10% cost improvement versus B on the
  primary metric, without a material quality/integrity regression;
- confirmatory product target: approximately 15% cost improvement;
- confirmatory quality guardrail: lower confidence bound for C−B acceptance
  difference above a pre-registered margin near −5 percentage points;
- pilot stop signal: a clear C−B acceptance loss near −10 percentage points;
- critical evidence-integrity failure: zero tolerance;
- human correction time: no more than 10% worse in the pilot, with a desired
  reduction in confirmation.

These values must be frozen before data collection, and the statistical
method must not interpret a non-significant result as proof of no degradation.
The review must decide whether these thresholds and sample sizes are
appropriate.

### 6. Outcome claim is a separate owner gate

A first narrow claim, if earned, must identify the exact:

- task-set version and strata;
- repository/revision set;
- pi-sparkle commit;
- provider/model/version;
- tool and routing policy;
- evaluator bundle digest;
- budget and environment;
- cost, acceptance, correction-time estimates and confidence intervals.

The A/B/C pilot report alone does not authorize a public Outcome-supported
claim. A separate owner evidence gate is required.

## Deliberately not adopted as facts

- Vendor-reported product usage, benchmark improvements, funding, or market
  size from the research report.
- Specific regulatory conclusions for a future deployment without a data-flow,
  jurisdiction, customer, and product-form analysis.
- The report's 0–36 month staffing and budget ranges as commitments.
- A final README repositioning.
- A claim that cryptographic signing, container identity, or a full typed
  envelope already exists in the repository.

## Review questions

The expert re-review should specifically decide:

1. Must evaluator/apply boundary design be a hard prerequisite to the
   read-only projection pilot, or is a frozen read-only evaluator sufficient?
2. Which minimum capability fields are necessary in this repository's first
   safe apply design, and which should be deferred?
3. Are typed projectability metadata and cumulative recall budgets required in
   the current projection hardening slice, or should they be a follow-up?
4. Are the proposed pilot thresholds and 30/100–200 task phases statistically
   and operationally defensible?
5. Should the primary KPI include human correction time in the numerator, or
   report it as a separately gated outcome metric?
6. What exact evidence is required before the first narrowly scoped
   Outcome-supported status row can be added?

## References

- [Revised evidence-first phase plan](../superpowers/plans/2026-09-21-evidence-first-phase.md)
- [External review disposition](2026-09-21-external-review-disposition.md)
- [Projection verification](2026-09-20-native-observation-projection.md)
- [Source report copy](../../.agent_workspace/external/deep-research-report-2026-09-21.md)
