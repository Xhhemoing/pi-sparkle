# Projection measurement specification v1 (draft)

## Status

- State: `draft — not frozen`
- Owner: pending owner/evaluator approval
- Related plan: [projection hardening](../plans/2026-09-21-projection-hardening.md)
- This is a measurement contract, not evidence that projection has a real-provider benefit.

## Arm and identity contract

A is the native Pi baseline with sparkle learned routing disabled. B is
pi-sparkle with the frozen common routing tuple and projection off. C shares B's
common evaluator/task/repository/provider constraints and frozen routing tuple,
but enables projection and explicitly adds `sparkle_recall_observation`. Runtime
identity and tool schema are arm-scoped; complete A/B/C schema identity is not
claimed. Each metric and ledger row carries an opaque `armManifestId` as well as the
common `manifestId`.

## Metric layers

```text
repeatMassBytes =
  UTF-8 bytes in same-content projectable observations from occurrence 3 onward
  / UTF-8 bytes in all tool outputs

repeatMassTokens =
  provider-tokenizer tokens for the same numerator/denominator,
  only when tokenizer identity and usage are known; otherwise unknown
```

`repeatMassBytes` is the always-available mechanism metric. Token values record
tokenizer/provider identity and are unknown when unavailable. Expected repeat
mass may be used for pre-treatment strata only from an arm-independent baseline.
Realized repeat mass is post-treatment and descriptive, never a favorable-task
selection rule.

Record exact-byte observation identity references, projectability reason,
source/tool schema, full and placeholder bytes, projection count, recall
calls/pages/bytes, cumulative budget refusals, storage-unavailable fallbacks,
repeatMassBytes, and known repeatMassTokens. Proposed recall defaults are 262,144 bytes/32 pages/16 calls
per run over the existing 16,384-byte/400-line page cap.

## Primary platform metric

For each distinct task, schedule exactly `K=2` runs in every arm, with no outcome-driven extra runs. The planned scheduled-run field is `taskAttemptsPerScheduledRun=1`; this documentation does not implement task/agent retry enforcement. Existing provider transport retry is scoped to
one `PiAgentExecutor.execute()` execution: `maxAttempts=3` is an upper bound
including the first attempt, not exactly three API calls and not a global budget
across all children or tool turns. It applies only where that executor policy is
actually used and remains inside the scheduled-run ledger.

```text
costPerAcceptedTaskBundle(arm) =
  sum(providerCost + runtimeCost across both scheduled runs and applicable
      provider-executor retries)
  /
  count(distinct tasks with >=1 valid independently accepted run
          without human correction)
```

A zero denominator is undefined and blocks a claim. Report cost per accepted
run, independent acceptance rate, accepted-after-correction rate, correction
minutes, wall time, retry/failed-attempt counts, failure categories, all-in
human-time sensitivity, and billed/estimated/unknown cost separately.

## Integrity and recovery

Record candidate/evaluator/policy identity drift, arm-manifest mismatch,
manifest mismatch, recall cross-run refusal, budget refusal, and apply-related
incidents separately. Critical evidence-integrity incidents have a zero-
tolerance operational stop. The authoritative evaluator is outside candidate
write scope; this measurement contract cannot issue apply capabilities.

## Data and provenance requirements

Each metric row carries experiment ID, arm, task ID, task-set digest, repository
revision, common `manifestId`, `armManifestId`, boundary design record id,
runtime/tool/policy identifiers, provider/model version, run state, usage status,
and evidence class. No aggregate-only report may discard task-level references
or opaque references.

## Analysis rules

- Distinct task is the resampling unit; repository is an additional cluster.
- Use paired task-level bootstrap or a preregistered hierarchical estimator.
- Randomize arm and repeat order; record session/cache/temperature/seed policy
  where exposed.
- No post-outcome exclusions, replacements, or favorable contrast selection.
- Pilot is exploratory; no non-inferiority claim. Confirmation sample size is
  recalculated from pilot variance/discordance and a frozen MDE.

## Proposed thresholds and gate

Pilot and confirmation thresholds remain hypotheses, not frozen facts. Exact
values, interval/decision rules, unknown-cost handling, and stopping authority
must be recorded in the preregistration before collection and approved before
outcome inspection. No threshold or local documentation review is a freeze,
owner approval, independent review, live run, or Outcome-supported claim.
