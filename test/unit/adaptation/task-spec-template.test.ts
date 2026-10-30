import assert from "node:assert/strict";
import { test } from "node:test";
import { ResourceRegistry } from "../../../src/lab/adaptation/registry.js";
import { authorTaskSpecFromTemplate, taskResourceIdentity, verifyAuthoredTaskSpecTemplate } from "../../../src/lab/adaptation/task-resources.js";

test("template order, not catalog insertion order, authors checks and verification needs the separate host request", () => {
  const registry = new ResourceRegistry(), projectRoot = "/synthetic/template";
  const version = registry.registerBaseline({ identity: taskResourceIdentity(projectRoot, "task-spec-template"), author: { kind: "human", identity: "synthetic-owner" },
    content: JSON.stringify({ topic: "task-spec-template", schemaVersion: 1, layout: { prepareRoles: [], checkRoles: [{ role: "regression", requiredBaseline: "fail" }, { role: "compatibility", requiredBaseline: "pass" }] },
      sourceRefs: ["synthetic/hypothesis"], expectedEffect: "Author role layout only; benefit UNOBSERVED" }) });
  const bindings = { templateVersionId: version.versionId, authorityRef: "synthetic/metadata-only", objective: "Update output.txt", context: ["z.txt", "a.txt"],
    write: { allow: ["output.txt"], protect: ["checks"] }, prepareByRole: {}, checksByRole: {
      compatibility: { id: "compat", command: "node", args: ["checks/compat.mjs"], verifierVersion: "1", protectedPaths: ["checks"], expect: { baseline: "pass" } },
      regression: { id: "regression", command: "node", args: ["checks/regression.mjs", "z", "a"], verifierVersion: "1", protectedPaths: ["checks"], expect: { baseline: "fail", failureAssertion: "missing output" } }
    }, budget: { totalSeconds: 30, prepareSeconds: 2, checkSeconds: 5, workerSeconds: 5, usd: 1 }, worker: { model: "inherit" } };
  const request = { projectRoot, logicalTaskId: "synthetic", sourceRevision: "a".repeat(40), versionId: version.versionId, bindings };
  const authored = authorTaskSpecFromTemplate({ registry, ...request });
  assert.deepEqual(authored.spec.checks.map(check => check.id), ["regression", "compat"]);
  assert.deepEqual(authored.spec.context, bindings.context);
  assert.deepEqual(authored.spec.checks[0]!.args, bindings.checksByRole.regression.args);
  assert.deepEqual(verifyAuthoredTaskSpecTemplate(registry, authored, request), authored);
  assert.deepEqual(verifyAuthoredTaskSpecTemplate(registry, authored, { registry, ...request }), authored);
  assert.throws(() => verifyAuthoredTaskSpecTemplate(registry, authored, { registry: new ResourceRegistry(), ...request }), /registry|match/);
  assert.deepEqual(authorTaskSpecFromTemplate({ registry, ...request, bindings: { ...bindings, checksByRole: { regression: bindings.checksByRole.regression, compatibility: bindings.checksByRole.compatibility } } }).spec, authored.spec);
  const changed = { ...request, bindings: { ...bindings, objective: "Different host goal" } };
  const selfConsistentForgery = authorTaskSpecFromTemplate({ registry, ...changed });
  assert.throws(() => verifyAuthoredTaskSpecTemplate(registry, selfConsistentForgery, request), /changed|match/);
  assert.throws(() => authorTaskSpecFromTemplate({ registry, ...request, bindings: { ...bindings, checksByRole: { ...bindings.checksByRole, extra: bindings.checksByRole.compatibility } } }), /catalog|coverage/);
  let reads = 0;
  const accessorCatalog = Object.defineProperty({ regression: bindings.checksByRole.regression }, "compatibility", { enumerable: true, get() { reads++; return bindings.checksByRole.compatibility; } });
  assert.throws(() => authorTaskSpecFromTemplate({ registry, ...request, bindings: { ...bindings, checksByRole: accessorCatalog } }), /data|accessor/);
  assert.equal(reads, 0);
});


test("template proposals require an explicit layout and do not diagnose broad failure classes", async () => {
  const { proposeRealTaskResources } = await import("../../../src/lab/learning/from-real-tasks.js");
  const registry = new ResourceRegistry(), layout = { prepareRoles: [], checkRoles: [{ role: "business", requiredBaseline: "fail" }] };
  const request = { registry, projectRoot: "/synthetic/template-proposal", topic: "task-spec-template" as const,
    sourceRecords: [{ ref: "synthetic/record", record: { id: "one", date: "2026-10-27", source: "pi-sparkle", arm: "sparkle", status: "FAILED", failureClass: "contract" } }] };
  assert.throws(() => proposeRealTaskResources(request), /template|layout/);
  const packet = proposeRealTaskResources({ ...request, templateLayout: layout })[0]!;
  assert.equal(packet.state, "needs-baseline-approval"); assert.equal(packet.observations.relatedFailures, 0);
  assert.deepEqual(JSON.parse(packet.content).layout, layout); assert.equal(registry.snapshot().versions.length, 0);
});
function templateFixture() {
  const registry = new ResourceRegistry(), projectRoot = "/synthetic/template-guards";
  const identity = taskResourceIdentity(projectRoot, "task-spec-template");
  const content = (expectedEffect: string) => JSON.stringify({ topic: "task-spec-template", schemaVersion: 1,
    layout: { prepareRoles: [], checkRoles: [{ role: "regression", requiredBaseline: "fail" }] },
    sourceRefs: ["synthetic/template-hypothesis"], expectedEffect });
  const baseline = registry.registerBaseline({ identity, content: content("Baseline layout; benefit UNOBSERVED"),
    author: { kind: "human", identity: "synthetic-owner" } });
  const bindings: import("../../../src/lab/adaptation/task-resources.js").TaskSpecTemplateBindings = {
    templateVersionId: baseline.versionId, authorityRef: "synthetic/host-request", objective: "Update output.txt", context: [],
    write: { allow: ["output.txt"], protect: ["checks"] }, prepareByRole: {},
    checksByRole: { regression: { id: "regression", command: "node", args: ["checks/regression.mjs"], verifierVersion: "1",
      protectedPaths: ["checks"], expect: { baseline: "fail", failureAssertion: "missing output" } } },
    budget: { totalSeconds: 30, prepareSeconds: 2, checkSeconds: 5, workerSeconds: 5, usd: 1 }, worker: { model: "inherit" }
  };
  const request = { projectRoot, logicalTaskId: "synthetic-guards", sourceRevision: "a".repeat(40), versionId: baseline.versionId, bindings };
  const candidateContent = content("Reviewed layout; benefit remains UNOBSERVED");
  const candidate = registry.createCandidate({ identity, content: candidateContent, parentVersionId: baseline.versionId,
    author: { kind: "detector", identity: "synthetic-author" },
    evaluationPlan: { stages: ["static", "real-task"], metrics: ["correct-delivery"], planVersion: 1 } });
  const promotion = { candidateId: candidate.candidateId, expectedCurrentVersionId: baseline.versionId, content: candidateContent,
    approvedBy: { kind: "human" as const, identity: "synthetic-owner" }, explicitApproval: true,
    review: { reviewId: "synthetic-template-review", candidateId: candidate.candidateId, contentHash: candidate.contentHash,
      verdict: "approved" as const, reviewerKind: "independent" as const, reviewerId: "synthetic-peer", actorId: candidate.author.identity,
      evidenceRefs: ["synthetic/template-review"] },
    changeNote: { scope: "synthetic authoring layout", evidence: ["synthetic/template-review"], guardrails: ["host retains authority"],
      rollbackVersionId: baseline.versionId } };
  const requestFor = (versionId: typeof baseline.versionId) => ({ ...request, versionId, bindings: { ...bindings, templateVersionId: versionId } });
  return { registry, identity, baseline, promotion, request, requestFor };
}

function jsonRoundTrip<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

test("template authoring preserves complete host limits through historical reconstruction and rejects tampering", () => {
  const f = templateFixture();
  const limits = { context: { tokenBudget: 4000, maxFiles: 2, maxBytes: 512 }, snapshot: { maxFiles: 8, maxBytes: 65536 } };
  const request = { ...f.request, bindings: { ...f.request.bindings, limits } };
  const authored = authorTaskSpecFromTemplate({ registry: f.registry, ...request });
  assert.deepEqual(authored.spec.limits, limits);
  assert.deepEqual(Reflect.get(authored.bindings, "limits"), limits);
  assert.equal(Object.isFrozen(authored.spec.limits!.context), true);
  limits.context.maxBytes = 511;
  assert.equal(authored.spec.limits!.context.maxBytes, 512, "authoring detaches the host declaration");
  limits.context.maxBytes = 512;
  assert.equal(f.registry.promote(f.promotion).ok, true);
  assert.deepEqual(verifyAuthoredTaskSpecTemplate(f.registry, jsonRoundTrip(authored), jsonRoundTrip(request)), authored);
  for (const field of ["bindings", "spec"] as const) {
    const forged = jsonRoundTrip(authored);
    (Reflect.get(forged[field], "limits") as typeof limits).snapshot.maxBytes--;
    assert.throws(() => verifyAuthoredTaskSpecTemplate(f.registry, forged, request), /changed|match/);
  }
  const legacy = templateFixture();
  assert.equal(Object.hasOwn(authorTaskSpecFromTemplate({ registry: legacy.registry, ...legacy.request }).spec, "limits"), false);
});

test("template limits reject partial, invalid, unknown and accessor declarations without executing getters", () => {
  const f = templateFixture();
  const limits = { context: { tokenBudget: 4000, maxFiles: 2, maxBytes: 512 }, snapshot: { maxFiles: 8, maxBytes: 65536 } };
  for (const invalid of [
    { context: limits.context }, { ...limits, context: { tokenBudget: 4000, maxFiles: 2 } },
    { ...limits, context: { ...limits.context, maxBytes: 0 } },
    { ...limits, snapshot: { ...limits.snapshot, maxFiles: 1025 } },
    { ...limits, extra: true }
  ]) assert.throws(() => authorTaskSpecFromTemplate({ registry: f.registry, ...f.request, bindings: { ...f.request.bindings, limits: invalid } }));
  let reads = 0;
  const accessor = Object.defineProperty({ ...limits }, "context", { enumerable: true, get() { reads++; return limits.context; } });
  assert.throws(() => authorTaskSpecFromTemplate({ registry: f.registry, ...f.request, bindings: { ...f.request.bindings, limits: accessor } }), /data|accessor/);
  assert.equal(reads, 0);
});

test("template authoring follows promotion and rollback while historical JSON artifacts remain verifiable", async () => {
  const { rollbackActive } = await import("../../../src/lab/adaptation/rollback.js");
  const f = templateFixture();
  const baselineArtifact = authorTaskSpecFromTemplate({ registry: f.registry, ...f.request });
  const promoted = f.registry.promote(f.promotion);
  assert.equal(promoted.ok, true);
  const promotedRequest = f.requestFor(promoted.newVersion!.versionId);
  const promotedArtifact = authorTaskSpecFromTemplate({ registry: f.registry, ...promotedRequest });
  assert.throws(() => authorTaskSpecFromTemplate({ registry: f.registry, ...f.request }),
    { message: "task resources: explicit template version must match the current active pointer" });
  assert.equal(rollbackActive(f.registry, { identity: f.identity, expectedCurrentVersionId: promotedRequest.versionId,
    targetVersionId: f.baseline.versionId, reason: "user", automatic: false, evidence: ["synthetic/rollback-decision"] }).ok, true);
  assert.deepEqual(authorTaskSpecFromTemplate({ registry: f.registry, ...f.request }), baselineArtifact);
  assert.throws(() => authorTaskSpecFromTemplate({ registry: f.registry, ...promotedRequest }),
    { message: "task resources: explicit template version must match the current active pointer" });
  assert.deepEqual(verifyAuthoredTaskSpecTemplate(f.registry, jsonRoundTrip(promotedArtifact), jsonRoundTrip(promotedRequest)), promotedArtifact);
});

test("template resources refuse baseSpec materialization with an otherwise valid active baseline", async () => {
  const { materializeTaskResources } = await import("../../../src/lab/adaptation/task-resources.js");
  const f = templateFixture(), authored = authorTaskSpecFromTemplate({ registry: f.registry, ...f.request });
  assert.equal(f.registry.getActiveVersion(f.identity)!.versionId, f.baseline.versionId);
  assert.throws(() => materializeTaskResources({ registry: f.registry, projectRoot: f.request.projectRoot,
    logicalTaskId: f.request.logicalTaskId, sourceRevision: f.request.sourceRevision, spec: authored.spec, topics: ["task-spec-template"] }),
  { message: "task resources: task-spec-template requires explicit authoring, not baseSpec materialization" });
});

test("template historical verification rejects a pending promotion and accepts the same artifact after commit", () => {
  const f = templateFixture(), baselineArtifact = authorTaskSpecFromTemplate({ registry: f.registry, ...f.request });
  const pending = f.registry.beginPromotion(f.promotion), pendingVersion = pending.pendingVersion;
  const pendingRequest = f.requestFor(pendingVersion.versionId);
  const pendingArtifact = jsonRoundTrip({ ...baselineArtifact, bindings: pendingRequest.bindings,
    resources: baselineArtifact.resources.map(resource => ({ ...resource, versionId: pendingVersion.versionId, contentHash: pendingVersion.contentHash })) });
  assert.equal(f.registry.getActiveVersion(f.identity)!.versionId, f.baseline.versionId);
  assert.ok(f.registry.ledger().some(entry => entry.kind === "intent" && entry.toVersionId === pendingVersion.versionId));
  assert.equal(f.registry.ledger().some(entry => entry.kind === "promoted" && entry.toVersionId === pendingVersion.versionId), false);
  assert.throws(() => verifyAuthoredTaskSpecTemplate(f.registry, pendingArtifact, pendingRequest),
    { message: "task resources: template version lacks approved promotion" });
  assert.equal(f.registry.commitPromotion(pending.intentId).ok, true);
  assert.deepEqual(verifyAuthoredTaskSpecTemplate(f.registry, pendingArtifact, pendingRequest), pendingArtifact);
});

test("template requiredBaseline rejects a different valid host check expectation", async () => {
  const { snapshotDevelopmentTaskSpec } = await import("../../../src/development/task-spec.js");
  const f = templateFixture(), authored = authorTaskSpecFromTemplate({ registry: f.registry, ...f.request });
  assert.equal(authored.spec.checks[0]!.expect.baseline, "fail");
  const changedCheck = { ...f.request.bindings.checksByRole.regression!, expect: { baseline: "pass" as const } };
  assert.equal(snapshotDevelopmentTaskSpec({ ...authored.spec, checks: [changedCheck] }).checks[0]!.expect.baseline, "pass");
  assert.throws(() => authorTaskSpecFromTemplate({ registry: f.registry, ...f.request, bindings: { ...f.request.bindings,
    checksByRole: { regression: changedCheck } } }), { message: "task resources: host expect does not match template requiredBaseline" });
});

test("template real-task evaluation reports its exact UNOBSERVED consumption reason after valid promotion and record checks", async () => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { evaluateRealTaskResources } = await import("../../../src/lab/adaptation/eval-real-tasks.js");
  const f = templateFixture(), promoted = f.registry.promote(f.promotion);
  assert.equal(promoted.ok, true);
  const version = promoted.newVersion!;
  assert.equal(version.parentVersionId, f.baseline.versionId);
  assert.ok(f.registry.ledger().some(entry => entry.kind === "promoted" && entry.toVersionId === version.versionId));
  const root = await mkdtemp(path.join(tmpdir(), "template-unobserved-"));
  try {
    const recordFile = path.join(root, "record.json");
    await writeFile(recordFile, JSON.stringify({ id: "synthetic-template-trial", source: "pi-sparkle", arm: "sparkle",
      status: "COMPLETED", referenceUsd: "unknown" }), "utf8");
    // This guard precedes contract/input reads. A missing file must never substitute for its precise refusal reason.
    const trials = [{ recordFile, inputFile: path.join(root, "unread-input.json"),
      contractFile: path.join(root, "unread-contract.json"), eventsFile: path.join(root, "unread-events.jsonl") }];
    const result = await evaluateRealTaskResources({ registry: f.registry, identity: f.identity, versionId: version.versionId, trials });
    assert.equal(result.candidateTasks, 0);
    assert.equal(result.baselineTasks, 0);
    assert.equal(result.evaluations.length, 0);
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0]!.consumed, false);
    assert.equal(result.attempts[0]!.hostCheckReached, "unknown");
    assert.deepEqual(result.attempts[0]!.issues, ["real-task evaluation: TaskSpec template consumption UNOBSERVED: current evaluation cannot certify authoring-template consumption or benefit"]);
    assert.equal(result.conclusion, "unclear");
    assert.deepEqual(result.cost, { knownLowerBoundUsd: 0, unknownAttempts: 1, totalUsd: "unknown" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
