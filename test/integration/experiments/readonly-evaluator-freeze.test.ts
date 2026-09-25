import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertEvaluatorUnmodified,
  freezeReadonlyEvaluatorManifest,
  opaqueId,
  type ReadonlyEvaluatorManifest
} from "../../../src/experiments/readonly-evaluator-manifest.js";

function candidate(): ReadonlyEvaluatorManifest {
  return {
    schemaVersion: "readonly-evaluator-v2",
    manifestId: opaqueId("manifest"),
    experimentId: "readonly-freeze-integration",
    taskSetId: "tasks-1",
    taskSetReference: opaqueId("taskset"),
    repositoryRevisions: [{ repository: "pi-sparkle", revision: "candidate" }],
    evaluatorBundleReference: opaqueId("eval"),
    evaluatorBundleCanonicalJson: "{\"evaluator\":1}",
    evaluatorResultSchema: "result-v1",
    runtimeIdentity: "native-pi",
    toolSchemaReference: "tools-v1",
    policyReference: "policy-v1",
    boundaryDesignRecordId: opaqueId("stage0"),
    armManifests: [
      { id: "A", armManifestId: opaqueId("arm"), runtimeIdentity: "a", toolSchemaReference: "read", routingMode: "disabled", learnedRouting: "disabled", projection: "off" },
      { id: "B", armManifestId: opaqueId("arm"), runtimeIdentity: "b", toolSchemaReference: "read", routingMode: "frozen-snapshot", routingSnapshotReference: "route_v2_00000000-0000-4000-8000-000000000001", routingSnapshotCanonicalJson: "{\"route\":1}", loadedPolicyCanonicalJson: "{\"policy\":1}", learnedRouting: "frozen-snapshot", projection: "off" },
      { id: "C", armManifestId: opaqueId("arm"), runtimeIdentity: "c", toolSchemaReference: "read-recall", routingMode: "frozen-snapshot", routingSnapshotReference: "route_v2_00000000-0000-4000-8000-000000000001", routingSnapshotCanonicalJson: "{\"route\":1}", loadedPolicyCanonicalJson: "{\"policy\":1}", learnedRouting: "frozen-snapshot", projection: "on", declaredSchemaDifference: "projection-recall-tool" }
    ],
    retryPolicy: { taskAttemptsPerScheduledRun: 1, providerAttemptsUpperBoundPerExecute: 3, providerRetryScope: "one-PiAgentExecutor.execute", providerRetryIsGlobal: false },
    protocolLimitations: { taskAttemptEnforcement: "not-implemented" },
    routingMode: "disabled",
    provider: "provider",
    model: "model",
    budget: { maxCalls: 2 },
    environmentReference: "env-v1",
    retentionClass: "run-observation",
    dataTransferPolicy: "local-only",
    createdAt: "2026-09-25T00:00:00.000Z",
    issuesApplyCapability: false
  };
}

test("frozen evaluator candidate is detached, immutable, and refuses authoritative mutation", () => {
  const source = candidate();
  const frozen = freezeReadonlyEvaluatorManifest(source);
  (source.armManifests as ReadonlyArmManifestForMutation[])[0] = { ...source.armManifests[0]!, runtimeIdentity: "mutated-source" };
  assert.equal(frozen.manifest.armManifests[0]?.runtimeIdentity, "a");
  assert.throws(() => {
    (frozen.manifest.armManifests[0] as { runtimeIdentity: string }).runtimeIdentity = "mutated-frozen";
  }, TypeError);
  assert.throws(() => assertEvaluatorUnmodified({
    manifest: frozen.manifest,
    observedCanonicalJson: frozen.manifest.evaluatorBundleCanonicalJson,
    attemptedWrite: true
  }), /refused/);
});

type ReadonlyArmManifestForMutation = ReadonlyEvaluatorManifest["armManifests"][number];
