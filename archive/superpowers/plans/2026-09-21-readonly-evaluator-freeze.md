# Read-only evaluator manifest and freeze implementation plan

> **ADR-008 correction (2026-09-22):** manifest references use opaque versioned locators and exact-byte comparison in explicitly labeled local-weak mode; no SHA-256 or replacement cryptographic hash is selected. A candidate implementation was completed on 2026-09-25, but this plan remains unapproved and cannot authorize a pilot until independent review and owner approval.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task-by-task. This plan does not register write tools or issue apply capabilities.

**Goal:** Freeze an immutable, independently inspectable acceptance definition for the read-only A/B/C pilot without pretending that full candidate/apply R10/R11 is closed.

**Architecture:** A manifest names all inputs needed to interpret a pilot result: task set, repository revisions, evaluator bundle, runtime/tool schema, routing snapshot, model/provider, budget, environment, and retention/data-transfer policy. Each input resolves through an opaque versioned reference to an immutable run-scoped record; re-read bytes are compared exactly. The evaluator bundle is outside worker/candidate write scope. A mutation-attempt probe refuses changes and a result record carries the manifest and arm locators.

**Tech Stack:** Existing `src/experiments/manifest.ts`, `freeze.ts`, evaluation types, content hashing, JSON/JSONL records, repository workflow checks.

## Identity and gate

- Owner: experiment owner/evaluator; state `candidate implemented — read-only, not owner-frozen`.
- Dependency: the pre-pilot evaluator/apply boundary design freeze must be
  recorded first; this plan still cannot authorize apply or worker writes.
- The manifest must carry a `boundaryDesignRecordId` matching that Stage 0
  design record once independently reviewed and owner-approved. For
  `routingMode: "frozen-snapshot"`, the routing reference and the two
  canonical policy/snapshot byte fields are one required identity tuple;
  partial tuples are refused. For `routingMode: "disabled"`, all three remain
  omitted and no learned routing file may be consulted.
- Arm identity is separate from common evaluator/task/repository constraints.
  A is native Pi with sparkle learned routing disabled; B and C share the
  frozen routing tuple. Runtime identity and tool schemas may differ by arm.
  C's `sparkle_recall_observation` addition is declared explicitly, not hidden
  behind a claim of complete identical schemas. Every task ledger/result row
  includes the opaque `armManifestId`.
- Source-bound A facts to freeze independently: `createNativeExecutor` builds a
  separate `PiAgentExecutor`, filters native coding tools to
  `sparkle_read_file`, resolves provider authentication through the host's
  `resolveAuth`, and adds `sparkle_recall_observation` only when projection is
  enabled. These facts describe the current source; they are not claims that A,
  B, and C have identical schemas.
- Refusal rule: missing/mismatched opaque references or canonical bytes, mutable evaluator scope, routing drift, or data-policy mismatch yields `INVALID_COLLECTION`/`UNOBSERVED` and stops the affected arm.

## Global Constraints

- This is a read-only pilot gate. It cannot authorize `sparkle_apply_candidate`, worker writes, credentials, permissions, trust, or tool activation changes.
- The current host-facing apply tool remains wired but non-production-authorized pending R10/R11 review and owner approval.
- Manifest facts, opaque references, and their canonical bytes must be frozen before outcome inspection.
- Retry semantics are scoped to the native provider executor: the existing
  `maxAttempts=3` value is an upper bound including the first attempt for one
  `PiAgentExecutor.execute()` execution. It is not exactly three API calls and
  is not a global budget across all children or tool turns. The pilot's
  `taskAttemptsPerScheduledRun=1` field is planned and must be independently
  frozen; enforcement is not implemented by this documentation slice.
- F6/F-PROD and M7 remain unaffected.

## Planned artifacts

- `docs/superpowers/specs/2026-09-21-readonly-evaluator-manifest.md` — schema and policy.
- Existing experiment manifest/freeze code where compatible; otherwise a focused
  `src/experiments/readonly-evaluator-manifest.ts` module.
- Unit tests under `test/unit/experiments/` and an integration freeze/refusal test.

## Manifest fields

```ts
interface ReadonlyEvaluatorManifest {
  schemaVersion: "readonly-evaluator-v2";
  manifestId: "manifest_v2_<uuid>";
  experimentId: string;
  taskSetId: string;
  taskSetReference: string;
  repositoryRevisions: readonly { repository: string; revision: string }[];
  evaluatorBundleReference: string;
  evaluatorResultSchema: string;
  runtimeIdentity: string;
  toolSchemaReference: string;
  policyReference: string;
  boundaryDesignRecordId: "stage0_v2_<uuid>";
  armManifests: readonly {
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
  }[];
  retryPolicy: {
    taskAttemptsPerScheduledRun: 1;
    providerAttemptsUpperBoundPerExecute: 3;
    providerRetryScope: "one-PiAgentExecutor.execute";
    providerRetryIsGlobal: false;
  };
  protocolLimitations: {
    taskAttemptEnforcement: "not-implemented";
  };
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

- The manifest carries `boundaryDesignRecordId` from the Stage 0 design record. Frozen routing requires the complete tuple (`routingSnapshotReference`, `routingSnapshotCanonicalJson`, `loadedPolicyCanonicalJson`); partial tuples are refused. Disabled routing omits all three fields and does not consult a learned routing file. The pilot schedule is exactly `K=2` scheduled runs per task/arm with no outcome-driven extra runs; `taskAttemptsPerScheduledRun=1` is a planned field whose enforcement is recorded under `protocolLimitations` and is not implemented by this documentation slice.

## Acceptance Criteria

- [x] Schema validates required fields and rejects unknown/invalid opaque references or canonical-byte bindings.
- [x] Evaluator bundle is immutable and referenced by an opaque run-scoped
  locator; it cannot be modified by the worker/candidate; mutation attempt is
  a tested refusal.
- [x] `manifestId` and `armManifestId` are recorded in every pilot result and task ledger row.
- [x] A manifest mismatch, routing mutation, missing evaluator, or data-policy
  violation yields invalid/UNOBSERVED collection, never a model FAIL.
- [x] The manifest explicitly states it cannot issue apply capabilities and
  records the fixed task/provider retry policy (`1`/`3`) without treating the
  retry budget as an outcome-dependent control.
- [x] Freeze output is reproducible from the same inputs and exact command.

Implementation evidence is recorded in
[2026-09-25 read-only evaluator candidate](../../reports/2026-09-25-readonly-evaluator-candidate.md).
These checked engineering criteria do not represent the independent review,
owner freeze, budget/data approval, or pilot authorization.

## Verification

- RED tests for candidate mutation, routing canonical-byte mismatch, missing fields,
  duplicate task IDs, and manifest/result opaque-reference or canonical-byte mismatch.
- Focused: `pnpm test test/unit/experiments test/integration/experiments`.
- Gate: `pnpm workflow:check && pnpm typecheck && pnpm lint && pnpm build`.
- No live provider is required for this child plan.
