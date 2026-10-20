# Revision-bound read-only check findings

## Identity
- ID: TASK-20261019-check-findings
- Owner: root coordinator, sequential implementation/review agents.
- State: planned.
- Date: 2026-10-19 (America/Los_Angeles).
- Authority: ADR-009 / A2; parent [continuation](2026-10-19-staged-continuation.md).

## Scope and source decisions
Reuse IndependentCheckRecord, its private trustedChecks WeakMap, existing Finding type and existing evaluation invalidation. Do not promote worker messages, stdout text or serialized check objects to trusted observations. First slice is opt-in read-only findings for checks with a real TrustedVerificationDescriptor; default descriptor-free checks remain explicitly unavailable for this stronger evidence projection. No new authority registry, ledger, hash, persistent schema, cooldown, model call or automatic repair.

## Files and API
- New src/evaluation/check-findings.ts exports findingsFromIndependentCheck({check, trustedVerification, runId, revision, generation}) and partitionCurrentFindings(findings, {revision, generation}). A bound finding wraps the existing Finding with runId, revision, generation and opaque checkId evidenceRef.
- Use hasTrustedVerificationEvidence(check, descriptor) plus exact revision/cwd/check consistency. Its exact snapshot evidence can be valid even when command functional result is false; inspect existing semantics before coding. Refuse copied/mutated/foreign evidence rather than deriving authority from its fields. If current source cannot support a valid failed check, record a discrepancy and refine the existing boundary without weakening it.
- IDs use explicit tuple serialization (no new hash). Same exact evidence and cause coalesce; new evidence stays observable. Messages describe host check status without parsing stdout into asserted source locations.
- Wire through NativeWriteSession after actual runClosedLoopCheck returns; actual attempt runId can identify generation. Add optional readonly findings on the experimental native result, without changing frozen CLI/events/queue state. Preserve existing acceptance and repair behavior.
- New test/integration/native/check-findings.test.ts plus focused unit partition/dedup tests if needed.

## Acceptance and test-first plan
RED cases use real temporary Git candidate and actual Node checker: functional failure with unchanged verifier produces a bound finding; successful check produces no failure finding; copied/serialized/foreign record refuses; same observation deduplicates; fresh evidence does not disappear; changed revision or generation marks prior observations stale; no raw checker output or source content appears in default finding text. Native actual failed check must expose its observation without treating it as accepted task completion. Cancellation/unsettled effects retain existing claims and must not be converted to a functional finding/automatic repair.

Focused command: pnpm test --test-concurrency=1 test/integration/native/check-findings.test.ts plus relevant existing native/trusted-verification tests. Inspect final diff and perform independent specification then quality reviews. Existing pnpm gate/security/Pi probes apply at integrated delivery.

## Risks and rollback
Findings describe historical host observations, never current acceptance. No finding alone unlocks a dependency, authorizes apply or clears an unknown effect. Old results without optional findings remain compatible. Preserve old evidence on stale partition. Rollback is code-only and retains all candidate/ledger data. Whole M3 automatic correction, source invalidation and single-flight investigation beyond read-only projection remain separate conditions.
