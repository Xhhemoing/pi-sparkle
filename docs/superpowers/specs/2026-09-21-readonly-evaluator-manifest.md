# Read-only evaluator manifest v2 (draft)

> **ADR-008 correction (2026-09-22):** This draft uses opaque versioned locators and exact-byte comparison, not SHA-256 or another replacement cryptographic hash. It remains a draft and cannot freeze a manifest, authorize a pilot, issue apply capabilities, or authorize writes.

## Status

- State: `draft — not frozen`
- Owner: pending owner/evaluator approval
- Related plan: [read-only evaluator freeze](../plans/2026-09-21-readonly-evaluator-freeze.md)
- Stage 0 design draft: [evaluator boundary freeze](2026-09-21-evaluator-boundary-freeze.md)
- This manifest can define a read-only A/B/C pilot; it cannot issue apply capabilities or authorize writes.

## Purpose and shared versus arm-scoped identity

The manifest freezes the acceptance definition and common task, repository, evaluator, retention, and data-transfer constraints before live calls. Arm identity is explicit rather than inferred from a single global runtime tuple:

- **A:** native Pi executor; sparkle learned routing disabled. Its native runtime and actual tool schema are independently recorded.
- **B:** pi-sparkle with frozen routing and projection disabled.
- **C:** the same frozen B tuple plus the declared `sparkle_recall_observation` tool and projection policy. C's recall-tool difference is intentional; this document does not claim complete identical tool schemas across A/B/C.

B and C share the frozen tuple for common evaluator/task/repository/provider constraints and routing. Every task ledger/result row carries the applicable `armManifestId` in addition to the common manifest id.

## Schema

```ts
interface ReadonlyEvaluatorManifest {
  schemaVersion: "readonly-evaluator-v2";
  manifestId: "manifest_v2_<uuid>";
  experimentId: string;
  taskSetId: string;
  taskSetReference: string;
  repositoryRevisions: Array<{ repository: string; revision: string }>;
  evaluatorBundleReference: string;
  evaluatorResultSchema: string;
  runtimeIdentity: string;
  toolSchemaReference: string;
  policyReference: string;
  boundaryDesignRecordId: "stage0_v2_<uuid>";
  armManifests: Array<{
    id: "A" | "B" | "C";
    armManifestId: "arm_v2_<uuid>";
    runtimeIdentity: string;
    toolSchemaReference: string;
    routingMode: "disabled" | "frozen-snapshot";
    routingSnapshotReference?: string;
    routingSnapshotCanonicalJson?: string;
    loadedPolicyCanonicalJson?: string;
    learnedRouting: "disabled" | "frozen-snapshot";
    projection: "off" | "on";
    declaredSchemaDifference?: "projection-recall-tool";
  }>;
  retryPolicy: {
    taskAttemptsPerScheduledRun: 1;
    providerAttemptsUpperBoundPerExecute: 3;
    providerRetryScope: "one-PiAgentExecutor.execute";
    providerRetryIsGlobal: false;
  };
  protocolLimitations: {
    taskAttemptEnforcement: "not-implemented";
  };
  // Protocol-only: taskAttemptEnforcement is not implemented by this documentation slice.
  routingMode: "disabled" | "frozen-snapshot";
  routingSnapshotReference?: string;
  routingSnapshotCanonicalJson?: string;
  loadedPolicyCanonicalJson?: string;
  provider: string;
  model: string;
  modelVersion?: string;
  budget: { maxUsd?: number; maxCalls?: number };
  environmentReference: string;
  retentionClass: string;
  dataTransferPolicy: string;
  createdAt: string;
}
```

### Field precedence and identity rules

Common fields establish the shared task/repository/evaluator/provider/retention/data-transfer contract. Arm fields override only arm-scoped runtime, tool, routing, learned-routing, projection, and declared-difference fields. A common field may not be overridden by an arm; an arm-scoped field must be present in every arm and cannot be inferred from the common value. `manifestId` and each `armManifestId` are opaque random locators, not content identities or integrity proofs.

For `routingMode: "frozen-snapshot"`, `routingSnapshotReference`, `routingSnapshotCanonicalJson`, and `loadedPolicyCanonicalJson` are one complete tuple and must be present together. B and C must compare their canonical routing/policy bytes exactly; A uses `routingMode: "disabled"` and omits the tuple. Disabled routing consults no learned routing file. A partial tuple, registry mutation, or exact-byte mismatch refuses collection before the affected arm is classified. The arm identity includes the arm-scoped canonical bytes and declared differences.

All evaluator/task/repository/runtime/tool/policy references must resolve to immutable, run-scoped records before collection. The record's bytes are compared exactly when re-read; this is local-weak binding and provides no cryptographic tamper guarantee.

`providerAttemptsUpperBoundPerExecute=3` is the existing provider-executor upper bound for one `PiAgentExecutor.execute()` execution, including the first attempt. It is not exactly three API calls and is not a global budget across all children or tool turns. The fixed pilot schedule is `K=2` scheduled runs per task per arm, with no outcome-driven extra runs. `taskAttemptsPerScheduledRun=1` is a planned field; its current enforcement status is recorded under `protocolLimitations`, not represented as implemented capability.

## Source-bound A baseline

Before any freeze, record and independently review the actual A configuration from `src/pi-adapter/native-executor.ts`, `src/pi-adapter/pi-executor.ts`, and `src/pi-adapter/provider-retry.ts`: the native executor creates a separate `PiAgentExecutor`, resolves authentication through the host boundary, filters the native coding-tool set to `sparkle_read_file`, and adds `sparkle_recall_observation` only when projection is enabled. The retry policy is local to one `execute()` scope and `maxAttempts=3` includes the first attempt. A mismatch between inspected source facts and the manifest invalidates the affected arm; it is not silently normalized to B/C.

## Freeze and refusal rules

- Independently review and owner-approve the Stage 0 design first; then record its exact `boundaryDesignRecordId` and freeze this manifest after task selection and before the first provider call.
- Refuse missing/mismatched record references, mutable evaluator scope, foreign records, routing drift, incomplete frozen-routing tuples, provider/model mismatch, budget mismatch, arm tuple mismatch, or retention/data-policy mismatch.
- A mutation attempt against evaluator files returns invalid/UNOBSERVED collection, never a model failure. The evaluator is outside candidate/worker write scope and the manifest cannot issue apply capabilities.
- Any manifest mismatch aborts the affected arm; it is not silently repaired. A failed/invalid collection remains in the ledger with its reason and cost.
- This artifact must not contain credentials, prompt secrets, or raw customer source data.

## Acceptance criteria

- [ ] Deterministic canonical-byte serialization and exact-byte comparison procedure are approved; identical inputs yield identical bytes.
- [ ] Common fields and all three arm manifests are frozen before collection; every task ledger/result references both `manifestId` and `armManifestId`.
- [ ] A separate test proves candidate write scope cannot modify the evaluator bundle and that no apply-capability issuance path exists.
- [ ] A manifest mismatch, routing mutation, missing evaluator, or data-policy violation yields invalid/UNOBSERVED collection, never model FAIL.
- [ ] Owner approval records experiment id, manifest id, arm ids, provider/data scope, K=2 schedule, retry upper-bound scope, and budget; absence leaves state `draft`.
- [ ] A native A configuration mismatch is recorded and blocks collection.

## Verification

Planned commands after implementation:

```text
pnpm test test/unit/experiments test/integration/experiments
pnpm workflow:check
```

No live-provider result can freeze this document automatically. This draft is not a freeze, approval, independent review, or experiment authorization.
