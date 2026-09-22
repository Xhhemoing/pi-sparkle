# Read-only evaluator manifest and freeze implementation plan

> **Blocked by TASK-20260921-remove-sha256 / ADR-008 (2026-09-21):** digest-bound manifest and freeze work cannot begin until the owner approves the successor identity/integrity contract and legacy refusal policy. Existing SHA-dependent fields are retained as pre-decision evidence only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task-by-task. This plan does not register write tools or issue apply capabilities.

**Goal:** Freeze an immutable, independently inspectable acceptance definition for the read-only A/B/C pilot without pretending that full candidate/apply R10/R11 is closed.

**Architecture:** A manifest names all inputs needed to interpret a pilot result: task set, repository revisions, evaluator bundle, runtime/tool schema, routing snapshot, model/provider, budget, environment, and retention/data-transfer policy. The evaluator bundle is content-addressed and outside worker/candidate write scope. A mutation-attempt probe refuses changes and a result record carries the manifest digest.

**Tech Stack:** Existing `src/experiments/manifest.ts`, `freeze.ts`, evaluation types, content hashing, JSON/JSONL records, repository workflow checks.

## Identity and gate

- Owner: experiment owner/evaluator; state `planned — read-only, not frozen`.
- Dependency: the pre-pilot evaluator/apply boundary design freeze must be
  recorded first; this plan still cannot authorize apply or worker writes.
- The manifest must carry a `boundaryDesignDigest` matching that Stage 0
  design record once independently reviewed and owner-approved. For
  `routingMode: "frozen-snapshot"`, the existing routing fields
  `routingSnapshotRef`, `routingSnapshotDigest`, and `loadedPolicyHash` are
  one required identity tuple; partial tuples are refused. For
  `routingMode: "disabled"`, all three remain omitted and no learned routing
  file may be consulted.
- Arm identity is separate from common evaluator/task/repository constraints.
  A is native Pi with sparkle learned routing disabled; B and C share the
  frozen routing tuple. Runtime identity and tool schemas may differ by arm.
  C's `sparkle_recall_observation` addition is declared explicitly, not hidden
  behind a claim of complete identical schemas. Every task ledger/result row
  includes `armManifestDigest`.
- Source-bound A facts to freeze independently: `createNativeExecutor` builds a
  separate `PiAgentExecutor`, filters native coding tools to
  `sparkle_read_file`, resolves provider authentication through the host's
  `resolveAuth`, and adds `sparkle_recall_observation` only when projection is
  enabled. These facts describe the current source; they are not claims that A,
  B, and C have identical schemas.
- Refusal rule: missing/mismatched digests, mutable evaluator scope, routing
  drift, or data-policy mismatch yields `INVALID_COLLECTION`/`UNOBSERVED` and
  stops the affected arm.

## Global Constraints

- This is a read-only pilot gate. It cannot authorize `sparkle_apply_candidate`, worker writes, credentials, permissions, trust, or tool activation changes.
- The current host-facing apply tool remains wired but non-production-authorized pending R10/R11 review and owner approval.
- Manifest facts and hashes must be frozen before outcome inspection.
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
  schemaVersion: "readonly-evaluator-v1";
  experimentId: string;
  taskSetId: string;
  taskSetDigest: string;
  repositoryRevisions: readonly { repository: string; revision: string }[];
  evaluatorBundleDigest: string;
  evaluatorResultSchema: string;
  runtimeIdentity: string;
  toolSchemaDigest: string;
  policyDigest: string;
  boundaryDesignDigest: string;
  routingMode: "disabled" | "frozen-snapshot";
  routingSnapshotRef?: string;
  routingSnapshotDigest?: string;
  loadedPolicyHash?: string;
  provider: string;
  model: string;
  modelVersion?: string;
  armManifests: readonly {
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
  }[];
  retryPolicy: {
    taskAttemptsPerScheduledRun: 1;
    taskAttemptEnforcement: "not-implemented";
    providerAttemptsUpperBoundPerExecute: 3;
    providerRetryScope: "one-PiAgentExecutor.execute";
    providerRetryIsGlobal: false;
  };
  budget: { maxUsd?: number; maxCalls?: number };
  environmentDigest: string;
  retentionClass: string;
  dataTransferPolicy: string;
  createdAt: string;
}
```

- The manifest carries `boundaryDesignDigest` from the Stage 0 design record. Frozen routing requires the complete tuple (`routingSnapshotRef`, `routingSnapshotDigest`, `loadedPolicyHash`); partial tuples are refused. Disabled routing omits all three fields and does not consult a learned routing file. The pilot schedule is exactly `K=2` scheduled runs per task/arm with no outcome-driven extra runs; `taskAttemptsPerScheduledRun=1` is a planned field whose enforcement is not implemented by this documentation slice.

## Acceptance Criteria

- [ ] Schema validates required fields and rejects unknown/invalid digest forms.
- [ ] Evaluator bundle is immutable/content-addressed and cannot be modified by
  the worker/candidate; mutation attempt is a tested refusal.
- [ ] Manifest digest is recorded in every pilot result and task ledger row.
- [ ] A manifest mismatch, routing mutation, missing evaluator, or data-policy
  violation yields invalid/UNOBSERVED collection, never a model FAIL.
- [ ] The manifest explicitly states it cannot issue apply capabilities and
  records the fixed task/provider retry policy (`1`/`3`) without treating the
  retry budget as an outcome-dependent control.
- [ ] Freeze output is reproducible from the same inputs and exact command.

## Verification

- RED tests for candidate mutation, routing hash mismatch, missing fields,
  duplicate task IDs, and manifest/result digest mismatch.
- Focused: `pnpm test test/unit/experiments test/integration/experiments`.
- Gate: `pnpm workflow:check && pnpm typecheck && pnpm lint && pnpm build`.
- No live provider is required for this child plan.
