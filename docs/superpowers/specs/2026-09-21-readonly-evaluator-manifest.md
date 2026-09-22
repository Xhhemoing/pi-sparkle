# Read-only evaluator manifest v1 (draft)

> **Removal gate (2026-09-21):** This draft is blocked by [TASK-20260921-remove-sha256](../plans/2026-09-21-remove-sha256.md) and [ADR-008](../../decisions/0008-remove-sha256.md). Its digest fields and integrity rules are not implementable or freezeable until the owner approves the successor identity/integrity contract and legacy fail-closed policy. Existing wording is retained as pre-decision evidence; no pilot or evaluator freeze is authorized.

## Status

- State: `draft — not frozen`
- Owner: pending owner/evaluator approval
- Related plan: [read-only evaluator freeze](../plans/2026-09-21-readonly-evaluator-freeze.md)
- Stage 0 design draft: [evaluator boundary freeze](2026-09-21-evaluator-boundary-freeze.md)
- This manifest can judge a read-only A/B/C pilot; it cannot issue apply capabilities or authorize writes.

## Purpose and shared versus arm-scoped identity

The manifest freezes the acceptance definition and common task, repository,
evaluator, retention, and data-transfer constraints before live calls. Arm
identity is explicit rather than inferred from a single global runtime tuple:

- **A:** native Pi executor; sparkle learned routing disabled. Its native
  runtime and actual tool schema are independently recorded.
- **B:** pi-sparkle with frozen routing and projection disabled.
- **C:** the same frozen B tuple plus the declared
  `sparkle_recall_observation` tool and projection policy. C's recall-tool
  difference is intentional; this document does not claim complete identical
  tool schemas across A/B/C.

B and C share the frozen tuple for common evaluator/task/repository/provider
constraints and routing. Every task ledger/result row carries the applicable
`armManifestDigest` in addition to the common manifest digest.

## Schema

```ts
interface ReadonlyEvaluatorManifest {
  schemaVersion: "readonly-evaluator-v1";
  experimentId: string;
  taskSetId: string;
  taskSetDigest: string;
  repositoryRevisions: Array<{ repository: string; revision: string }>;
  evaluatorBundleDigest: string;
  evaluatorResultSchema: string;
  runtimeIdentity: string;
  toolSchemaDigest: string;
  policyDigest: string;
  boundaryDesignDigest: string;
  armManifests: Array<{
    id: "A" | "B" | "C";
    armManifestDigest: string;
    runtimeIdentity: string;
    toolSchemaDigest: string;
    routingMode: "disabled" | "frozen-snapshot";
    routingSnapshotRef?: string;
    routingSnapshotDigest?: string;
    loadedPolicyHash?: string;
    learnedRouting: "disabled" | "frozen-snapshot";
    projection: "off" | "on";
    declaredSchemaDifference?: "projection-recall-tool";
  }>;
  retryPolicy: {
    taskAttemptsPerScheduledRun: 1;
    taskAttemptEnforcement: "not-implemented";
    providerAttemptsUpperBoundPerExecute: 3;
    providerRetryScope: "one-PiAgentExecutor.execute";
    providerRetryIsGlobal: false;
  };
  routingMode: "disabled" | "frozen-snapshot";
  routingSnapshotRef?: string;
  routingSnapshotDigest?: string;
  loadedPolicyHash?: string;
  provider: string;
  model: string;
  modelVersion?: string;
  budget: { maxUsd?: number; maxCalls?: number };
  environmentDigest: string;
  retentionClass: string;
  dataTransferPolicy: string;
  createdAt: string;
}
```

Digest fields use lowercase SHA-256 values; a path is only a locator. A frozen
routing tuple consists of `routingSnapshotRef`, `routingSnapshotDigest`, and
`loadedPolicyHash`; all three are required together at the common level and on
each arm using `routingMode: "frozen-snapshot"`. B and C must carry the same
three values; A uses `routingMode: "disabled"` and omits all three. Disabled
routing consults no learned routing file. A partial tuple, registry mutation,
or hash mismatch invalidates collection. The arm digest covers the arm-scoped
runtime identity, tool schema, routing fields, projection setting, and declared
differences.

`providerAttemptsUpperBoundPerExecute=3` is the existing provider-executor
upper bound for one `PiAgentExecutor.execute()` execution, including the first
attempt. It is not exactly three API calls and is not a global budget across
all children or tool turns. The fixed pilot schedule is `K=2` scheduled runs
per task per arm, with no outcome-driven extra runs. `taskAttemptsPerScheduledRun=1`
is a planned preregistered field; enforcement is not implemented by this
documentation slice.

## Freeze and refusal rules

- Independently review and owner-approve the Stage 0 design first; then record
  its exact `boundaryDesignDigest` and freeze this manifest after task selection
  and before the first provider call. A missing or mismatched boundary digest
  is invalid/UNOBSERVED and cannot authorize a run.
- Freeze A's native runtime/tool/auth configuration independently. Any mismatch
  is declared and blocks collection; it is not silently normalized to B/C.
- Refuse duplicate task/repository IDs, missing revisions, invalid digest
  formats, missing evaluator bundle, mutable evaluator path, routing hash
  mismatch or incomplete frozen-routing identity, provider/model mismatch,
  budget mismatch, arm tuple mismatch, or retention-policy mismatch.
- A mutation attempt against evaluator files returns invalid/UNOBSERVED
  collection, never a model failure. The evaluator is outside candidate/worker
  write scope and the manifest cannot issue apply capabilities.
- Any manifest mismatch aborts the affected arm; it is not silently repaired.
  A failed/invalid collection remains in the ledger with its reason and cost.
- This artifact must not contain credentials, prompt secrets, or raw customer
  source data.

## Acceptance criteria

- [ ] Deterministic serialization and digest procedure are approved; identical
  inputs yield the same digest.
- [ ] Common fields and all three arm manifests are frozen before collection;
  every task ledger/result references both manifest and `armManifestDigest`.
  B/C routing tuple values are byte-for-byte equal; A's disabled-routing
  omission and native runtime/tool identity are independently recorded.
- [ ] A separate test proves candidate write scope cannot modify the evaluator
  bundle and that no apply-capability issuance path exists.
- [ ] A manifest mismatch, routing mutation, missing evaluator, or data-policy
  violation yields invalid/UNOBSERVED collection, never model FAIL.
- [ ] Owner approval records experiment ID, manifest digest, arm digests,
  provider/data scope, K=2 schedule, retry upper-bound scope, and budget;
  absence leaves state `draft`.
- [ ] A native A configuration mismatch is recorded and blocks collection.

## Verification

Planned commands after implementation:

```text
pnpm test test/unit/experiments test/integration/experiments
pnpm workflow:check
```

No live-provider result can freeze this document automatically. This draft is
not a freeze, approval, independent review, or experiment authorization.
