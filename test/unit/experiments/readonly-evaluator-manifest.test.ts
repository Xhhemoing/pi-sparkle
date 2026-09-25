import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import {
  assertEvaluatorUnmodified,
  bindReadonlyPilotResult,
  collectReadonlyLedger,
  collectReadonlyLedgerRow,
  freezeReadonlyEvaluatorManifest,
  opaqueId,
  type ReadonlyEvaluatorManifest
} from "../../../src/experiments/readonly-evaluator-manifest.js";

function manifest(patch: Partial<ReadonlyEvaluatorManifest> = {}): ReadonlyEvaluatorManifest {
  const base: ReadonlyEvaluatorManifest = {
    schemaVersion: "readonly-evaluator-v2",
    manifestId: opaqueId("manifest"),
    experimentId: "exp-readonly",
    taskSetId: "tasks-1",
    taskSetReference: opaqueId("taskset"),
    repositoryRevisions: [{ repository: "pi-sparkle", revision: "f15a3b8" }],
    evaluatorBundleReference: opaqueId("eval"),
    evaluatorBundleCanonicalJson: "{\"evaluator\":1}",
    evaluatorResultSchema: "result-v1",
    runtimeIdentity: "native-pi",
    toolSchemaReference: "tools-v1",
    policyReference: "policy-v1",
    boundaryDesignRecordId: opaqueId("stage0"),
    armManifests: [
      { id: "A", armManifestId: opaqueId("arm"), runtimeIdentity: "native-a", toolSchemaReference: "read-only", routingMode: "disabled", learnedRouting: "disabled", projection: "off" },
      { id: "B", armManifestId: opaqueId("arm"), runtimeIdentity: "native-b", toolSchemaReference: "read-only", routingMode: "frozen-snapshot", routingSnapshotReference: opaqueId("route"), routingSnapshotCanonicalJson: "{\"route\":1}", loadedPolicyCanonicalJson: "{\"policy\":1}", learnedRouting: "frozen-snapshot", projection: "off" },
      { id: "C", armManifestId: opaqueId("arm"), runtimeIdentity: "native-c", toolSchemaReference: "read-plus-recall", routingMode: "frozen-snapshot", routingSnapshotReference: "placeholder", routingSnapshotCanonicalJson: "{\"route\":1}", loadedPolicyCanonicalJson: "{\"policy\":1}", learnedRouting: "frozen-snapshot", projection: "on", declaredSchemaDifference: "projection-recall-tool" }
    ],
    retryPolicy: { taskAttemptsPerScheduledRun: 1, providerAttemptsUpperBoundPerExecute: 3, providerRetryScope: "one-PiAgentExecutor.execute", providerRetryIsGlobal: false },
    protocolLimitations: { taskAttemptEnforcement: "not-implemented" },
    routingMode: "disabled",
    provider: "xhh-luna",
    model: "gpt-5.6-luna-fast",
    budget: { maxCalls: 2 },
    environmentReference: "env-v1",
    retentionClass: "run-observation",
    dataTransferPolicy: "local-only",
    createdAt: "2026-09-22T00:00:00.000Z",
    issuesApplyCapability: false
  };
  const arms = base.armManifests.map((arm) => ({ ...arm }));
  arms[2] = { ...arms[2]!, routingSnapshotReference: arms[1]!.routingSnapshotReference };
  return { ...base, armManifests: arms, ...patch };
}

test("readonly manifest freezes reproducibly and records both manifest ids", () => {
  const value = manifest();
  const first = freezeReadonlyEvaluatorManifest(value);
  const second = freezeReadonlyEvaluatorManifest(value);
  assert.equal(first.canonicalJson, second.canonicalJson);
  assert.deepEqual(first.manifest, second.manifest);
  assert.equal(Object.isFrozen(first.manifest), true);
  assert.equal(Object.isFrozen(first.manifest.armManifests), true);
  assert.equal(Object.isFrozen(first.manifest.armManifests[0]), true);
  const row = collectReadonlyLedgerRow({
    manifest: value,
    armId: "B",
    taskId: "task-1",
    observedEvaluatorCanonicalJson: value.evaluatorBundleCanonicalJson,
    observedRoutingCanonicalJson: "{\"route\":1}",
    observedLoadedPolicyCanonicalJson: "{\"policy\":1}",
    dataPolicyMatches: true
  });
  assert.equal(row.status, "valid");
  assert.equal(row.manifestId, value.manifestId);
  assert.equal(row.armManifestId, value.armManifests[1]?.armManifestId);
});

test("evaluator mutation and mismatched routing or data policy fail closed", () => {
  const value = manifest();
  assert.throws(
    () => assertEvaluatorUnmodified({ manifest: value, observedCanonicalJson: value.evaluatorBundleCanonicalJson, attemptedWrite: true }),
    (error: unknown) => error instanceof DomainValidationError && /refused/.test(error.message)
  );
  assert.throws(
    () => assertEvaluatorUnmodified({ manifest: value, observedCanonicalJson: "{\"evaluator\":2}", attemptedWrite: false }),
    /canonical bytes changed/
  );
  const mismatched = collectReadonlyLedgerRow({
    manifest: value,
    armId: "C",
    taskId: "task-1",
    observedEvaluatorCanonicalJson: "{\"evaluator\":2}",
    observedRoutingCanonicalJson: "{\"route\":2}",
    dataPolicyMatches: false
  });
  assert.equal(mismatched.status, "INVALID_COLLECTION");
  assert.equal(mismatched.manifestId, value.manifestId);

  const policyMismatched = collectReadonlyLedgerRow({
    manifest: value,
    armId: "C",
    taskId: "task-1",
    observedEvaluatorCanonicalJson: value.evaluatorBundleCanonicalJson,
    observedRoutingCanonicalJson: "{\"route\":1}",
    observedLoadedPolicyCanonicalJson: "{\"policy\":2}",
    dataPolicyMatches: true
  });
  assert.equal(policyMismatched.status, "INVALID_COLLECTION");
});

test("disabled routing observations and non-opaque task references are invalid", () => {
  const value = manifest();
  const disabledObserved = collectReadonlyLedgerRow({
    manifest: value,
    armId: "A",
    taskId: "task-1",
    observedEvaluatorCanonicalJson: value.evaluatorBundleCanonicalJson,
    observedRoutingCanonicalJson: "unexpected-routing",
    dataPolicyMatches: true
  });
  assert.equal(disabledObserved.status, "INVALID_COLLECTION");
  assert.throws(
    () => freezeReadonlyEvaluatorManifest({ ...value, taskSetReference: "taskset-plain" }),
    /taskSetReference/
  );
  assert.throws(
    () => freezeReadonlyEvaluatorManifest({ ...value, repositoryRevisions: [{ repository: "", revision: "" }] }),
    /repositoryRevisions/
  );
});

test("unknown manifest fields fail closed", () => {
  const value = manifest();
  assert.throws(
    () => freezeReadonlyEvaluatorManifest({ ...value, unexpectedField: true } as ReadonlyEvaluatorManifest),
    /unknown manifest field/
  );
  const arms = value.armManifests.map((arm) => ({ ...arm }));
  arms[0] = { ...arms[0]!, unexpectedField: true } as typeof arms[number];
  assert.throws(
    () => freezeReadonlyEvaluatorManifest({ ...value, armManifests: arms }),
    /unknown A arm field/
  );
});

test("nested manifest fields reject unknown keys and fractional call budgets", () => {
  const value = manifest();
  assert.throws(
    () => freezeReadonlyEvaluatorManifest({
      ...value,
      repositoryRevisions: [{ repository: "repo", revision: "rev", unexpected: true } as unknown as ReadonlyEvaluatorManifest["repositoryRevisions"][number]]
    }),
    /unknown repositoryRevisions field/
  );
  assert.throws(
    () => freezeReadonlyEvaluatorManifest({
      ...value,
      budget: { maxCalls: 2, unexpected: true } as ReadonlyEvaluatorManifest["budget"]
    }),
    /unknown budget field/
  );
  assert.throws(
    () => freezeReadonlyEvaluatorManifest({
      ...value,
      retryPolicy: { ...value.retryPolicy, unexpected: true } as ReadonlyEvaluatorManifest["retryPolicy"]
    }),
    /unknown retryPolicy field/
  );
  assert.throws(
    () => freezeReadonlyEvaluatorManifest({
      ...value,
      budget: { maxCalls: 1.5 }
    }),
    /budget.maxCalls must be a positive safe integer/
  );
});

test("optional modelVersion is accepted when non-empty and rejects malformed values", () => {
  const value = manifest();
  assert.doesNotThrow(() => freezeReadonlyEvaluatorManifest({ ...value, modelVersion: "gpt-5.6-v1" } as ReadonlyEvaluatorManifest));
  assert.throws(
    () => freezeReadonlyEvaluatorManifest({ ...value, modelVersion: 7 } as unknown as ReadonlyEvaluatorManifest),
    /modelVersion is required/
  );
  assert.throws(
    () => freezeReadonlyEvaluatorManifest({ ...value, modelVersion: "" } as unknown as ReadonlyEvaluatorManifest),
    /modelVersion is required/
  );
});

test("canonical JSON fields reject malformed or non-canonical bytes", () => {
  const value = manifest();
  assert.throws(
    () => freezeReadonlyEvaluatorManifest({ ...value, evaluatorBundleCanonicalJson: "{\"evaluator\": 1}" }),
    /evaluatorBundleCanonicalJson must be canonical JSON/
  );
  const arms = value.armManifests.map((arm) => ({ ...arm }));
  arms[1] = { ...arms[1]!, routingSnapshotCanonicalJson: "not-json" };
  assert.throws(
    () => freezeReadonlyEvaluatorManifest({ ...value, armManifests: arms }),
    /B routingSnapshotCanonicalJson must be canonical JSON/
  );
});

test("malformed common manifest fields fail closed with validation errors", () => {
  const value = manifest();
  for (const patch of [
    { runtimeIdentity: "" },
    { toolSchemaReference: 7 as unknown as string },
    { environmentReference: null as unknown as string },
    { budget: { maxCalls: 0 } },
    { budget: {} },
    { createdAt: "not-an-instant" },
    { createdAt: "2026-09-22" }
  ]) {
    assert.throws(
      () => freezeReadonlyEvaluatorManifest({ ...value, ...patch }),
      (error: unknown) => error instanceof DomainValidationError
    );
  }
  assert.throws(
    () => freezeReadonlyEvaluatorManifest({ ...value, armManifests: null as unknown as ReadonlyEvaluatorManifest["armManifests"] }),
    (error: unknown) => error instanceof DomainValidationError
  );
});

test("partial routing tuples, apply capability, and duplicate arm order are refused", () => {
  const arms = manifest().armManifests.map((arm) => ({ ...arm }));
  const broken = { ...arms[1]!, routingSnapshotCanonicalJson: undefined };
  arms[1] = broken;
  assert.throws(() => freezeReadonlyEvaluatorManifest(manifest({ armManifests: arms })), /complete canonical tuple/);
  assert.throws(() => freezeReadonlyEvaluatorManifest(manifest({ issuesApplyCapability: true as unknown as false })), /cannot issue/);
});

test("routing snapshot references are opaque and arms B/C share one frozen tuple", () => {
  const invalidReference = manifest().armManifests.map((arm) => ({ ...arm }));
  invalidReference[1] = { ...invalidReference[1]!, routingSnapshotReference: "route-v2-plain" };
  invalidReference[2] = { ...invalidReference[2]!, routingSnapshotReference: "route-v2-plain" };
  assert.throws(() => freezeReadonlyEvaluatorManifest(manifest({ armManifests: invalidReference })), /routingSnapshotReference must be an opaque route_v2_ locator/);

  const diverged = manifest().armManifests.map((arm) => ({ ...arm }));
  diverged[2] = { ...diverged[2]!, routingSnapshotCanonicalJson: "{\"route\":2}" };
  assert.throws(() => freezeReadonlyEvaluatorManifest(manifest({ armManifests: diverged })), /arms B and C must share the frozen routing tuple/);
});

test("arm B stays projection-off and only arm C may declare the recall schema difference", () => {
  const enabledB = manifest().armManifests.map((arm) => ({ ...arm }));
  enabledB[1] = { ...enabledB[1]!, projection: "on" };
  assert.throws(() => freezeReadonlyEvaluatorManifest(manifest({ armManifests: enabledB })), /arm B must keep projection off/);

  const declaredB = manifest().armManifests.map((arm) => ({ ...arm }));
  declaredB[1] = { ...declaredB[1]!, declaredSchemaDifference: "projection-recall-tool" };
  assert.throws(() => freezeReadonlyEvaluatorManifest(manifest({ armManifests: declaredB })), /only arm C/);
});

test("missing observations are UNOBSERVED while malformed observations are invalid", () => {
  const value = manifest();
  const missing = collectReadonlyLedgerRow({
    manifest: value,
    armId: "B",
    taskId: "task-1",
    observedEvaluatorCanonicalJson: undefined,
    observedRoutingCanonicalJson: undefined,
    observedLoadedPolicyCanonicalJson: undefined,
    dataPolicyMatches: true
  });
  assert.equal(missing.status, "UNOBSERVED");
});

test("ledger rejects duplicate task identities within one arm and binds pilot results", () => {
  const value = manifest();
  const input = {
    manifest: value,
    armId: "B" as const,
    taskId: "task-1",
    observedEvaluatorCanonicalJson: value.evaluatorBundleCanonicalJson,
    observedRoutingCanonicalJson: "{\"route\":1}",
    observedLoadedPolicyCanonicalJson: "{\"policy\":1}",
    dataPolicyMatches: true
  };
  assert.throws(() => collectReadonlyLedger([input, input]), /duplicate readonly ledger task/);

  const row = collectReadonlyLedgerRow(input);
  const result = bindReadonlyPilotResult({ manifest: value, ledgerRow: row, outcome: "PASS" });
  assert.equal(result.manifestId, value.manifestId);
  assert.equal(result.armManifestId, value.armManifests[1]?.armManifestId);
  assert.equal(result.taskId, "task-1");
  assert.equal(result.outcome, "PASS");

  const invalid = { ...row, status: "INVALID_COLLECTION" as const };
  assert.equal(bindReadonlyPilotResult({ manifest: value, ledgerRow: invalid, outcome: "FAIL" }).outcome, "UNOBSERVED");
});
