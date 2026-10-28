import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { proposeRealTaskResources } from "../../../src/lab/learning/from-real-tasks.js";
import { snapshotDevelopmentTaskSpec } from "../../../src/development/task-spec.js";
import { ResourceRegistry } from "../../../src/lab/adaptation/registry.js";
import { loadAdaptationRegistry, promoteWithRegistry, saveAdaptationRegistry } from "../../../src/lab/adaptation/promotion.js";
import { materializeTaskResources, parseTaskResourceContent, taskResourceIdentity, verifyMaterializedTaskResources } from "../../../src/lab/adaptation/task-resources.js";

test("context files reach the real proposal CLI and preserve TaskSpec authority after review", { timeout: 35000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-context-cli-"));
  const repo = fileURLToPath(new URL("../../../", import.meta.url));
  const stateRoot = path.join(root, "state"), projectRoot = path.join(root, "project");
  try {
    await mkdir(projectRoot);
    const spec = snapshotDevelopmentTaskSpec({ version: 1, objective: "Update the synthetic output", context: ["original.txt"],
      write: { allow: ["output.txt"], require: ["output.txt"], protect: ["checks"] }, prepare: [],
      checks: [{ id: "unit", command: "node", args: ["checks/unit.mjs"], verifierVersion: "synthetic-v1", protectedPaths: ["checks"], expect: { baseline: "pass" } }],
      budget: { totalSeconds: 30, prepareSeconds: 2, workerSeconds: 5, checkSeconds: 5, usd: 1 }, worker: { model: "inherit", maxAttempts: 1 } });
    const identity = taskResourceIdentity(projectRoot, "context-rule"), registry = new ResourceRegistry();
    const parent = registry.registerBaseline({ identity, author: { kind: "model", identity: "synthetic-delegated-author" },
      content: JSON.stringify({ topic: "context-rule", requiredFiles: [], sourceRefs: ["synthetic/baseline"], expectedEffect: "Preserve original context" }) });
    assert.deepEqual(materializeTaskResources({ registry, projectRoot, logicalTaskId: "synthetic", sourceRevision: "1".repeat(40), spec, topics: ["context-rule"] }).spec, spec,
      "trusted baseline registration does not make author provenance an approval credential");
    await saveAdaptationRegistry(stateRoot, registry);
    const recordFile = path.join(root, "record.json"), inputFile = path.join(root, "inputs.json"), filesFile = path.join(root, "files.json");
    await writeFile(recordFile, JSON.stringify({ id: "synthetic", date: "2026-10-27", source: "pi-sparkle", arm: "sparkle", status: "FAILED", failureClass: "contract", accepted: false, kept: false }), "utf8");
    await writeFile(inputFile, JSON.stringify([recordFile]), "utf8");
    await writeFile(filesFile, JSON.stringify(["extra.txt"]), "utf8");
    const invoke = (extra: string[]) => spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), path.join(repo, "scripts/real-task-adapt.mjs"),
      "propose", "--state-root", stateRoot, "--project", projectRoot, "--topic", "context-rule", "--input", inputFile, ...extra], {
      cwd: repo, encoding: "utf8", windowsHide: true, timeout: 15000,
      env: { ...process.env, HOME: root, USERPROFILE: root, APPDATA: root, LOCALAPPDATA: root, XDG_CONFIG_HOME: root, TSX_DISABLE_CACHE: "1" }
    });
    const missing = invoke([]);
    assert.equal(missing.error, undefined);
    assert.notEqual(missing.status, 0, "a proposal needs explicitly selected files");
    const provided = invoke(["--context-files", filesFile]);
    assert.equal(provided.error, undefined);
    assert.equal(provided.status, 0, provided.stderr);
    const packets = JSON.parse(provided.stdout) as { state: string; content: string; observations: { relatedFailures: number } }[];
    assert.equal(packets.length, 1);
    assert.equal(packets[0]!.state, "proposed");
    const content = parseTaskResourceContent(packets[0]!.content);
    assert.equal(content.topic, "context-rule");
    assert.deepEqual(content.topic === "context-rule" && content.requiredFiles, ["extra.txt"]);
    assert.equal(packets[0]!.observations.relatedFailures, 0, "a failure class is not a diagnosed context omission");
    const saved = await loadAdaptationRegistry(stateRoot);
    assert.equal(saved.getActiveVersion(identity)!.versionId, parent.versionId, "propose never promotes");
    const candidate = saved.candidatesFor(identity)[0]!;
    promoteWithRegistry(saved, { candidateId: candidate.candidateId, expectedCurrentVersionId: parent.versionId, content: packets[0]!.content,
      approvedBy: { kind: "human", identity: "synthetic-owner" }, explicitApproval: true,
      review: { reviewId: "synthetic-review", candidateId: candidate.candidateId, contentHash: candidate.contentHash, verdict: "approved", reviewerKind: "independent", reviewerId: "synthetic-peer", actorId: candidate.author.identity, evidenceRefs: [recordFile] },
      changeNote: { scope: "synthetic context", evidence: [recordFile], guardrails: ["preserve authority"], rollbackVersionId: parent.versionId } });
    const materialized = materializeTaskResources({ registry: saved, projectRoot, logicalTaskId: "synthetic", sourceRevision: "1".repeat(40), spec, topics: ["context-rule"] });
    assert.deepEqual(materialized.spec.context, ["original.txt", "extra.txt"]);
    assert.deepEqual({ ...materialized.spec, context: spec.context }, spec);
    assert.deepEqual(materialized.baseSpec, spec);
    assert.throws(() => verifyMaterializedTaskResources(saved, { ...materialized, spec }), /changed/);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(root).startsWith("sparkle-context-cli-"));
    await rm(root, { recursive: true, force: true });
  }
});

test("context rules require explicit literal files and materialize only approved additions without changing TaskSpec authority", () => {
  const registry = new ResourceRegistry(), projectRoot = "/synthetic/context-rule";
  const rule = { topic: "context-rule", requiredFiles: ["extra.txt"], sourceRefs: ["synthetic/operator-hypothesis"], expectedEffect: "Test explicit inclusion only" };
  assert.deepEqual(parseTaskResourceContent(JSON.stringify(rule)), rule);
  for (const requiredFiles of [null, "extra.txt", ["extra.txt", "extra.txt"], ["../escape"], ["*.ts"], ["a\\b"], Array.from({ length: 33 }, (_, index) => `f${index}`)]) {
    assert.throws(() => parseTaskResourceContent(JSON.stringify({ ...rule, requiredFiles })));
  }
  assert.throws(() => parseTaskResourceContent(JSON.stringify({ ...rule, objective: "replace" })), /field/);
  const identity = taskResourceIdentity(projectRoot, "context-rule");
  assert.equal(identity.kind, "workflow-template");
  const parent = registry.registerBaseline({ identity, content: JSON.stringify({ ...rule, requiredFiles: [] }), author: { kind: "human", identity: "synthetic-owner" } });
  const spec = snapshotDevelopmentTaskSpec({ version: 1, objective: "Keep [[file:declared.txt]] and update value.txt", context: ["value.txt"],
    write: { allow: ["value.txt"], protect: ["checks", "extra.txt"], require: ["value.txt"] }, prepare: [],
    checks: [{ id: "unit", command: "node", args: ["checks/unit.mjs"], verifierVersion: "1", protectedPaths: ["checks"], expect: { baseline: "pass" } }],
    budget: { totalSeconds: 30, prepareSeconds: 2, workerSeconds: 5, checkSeconds: 5, usd: 1 }, worker: { model: "inherit", maxAttempts: 1 } });
  const materialize = (base = spec) => materializeTaskResources({ registry, projectRoot, logicalTaskId: "context-rule", sourceRevision: "a".repeat(40), spec: base, topics: ["context-rule"] });
  assert.deepEqual(materialize().spec, spec);
  const input = { registry, projectRoot, topic: "context-rule" as const, sourceRecords: [{ ref: "synthetic/operator-hypothesis", record: {
    id: "hypothesis", date: "2026-10-27", source: "pi-sparkle", arm: "sparkle", status: "COMPLETED"
  } }] };
  assert.throws(() => proposeRealTaskResources(input), /context|files/);
  assert.throws(() => proposeRealTaskResources({ ...input, contextFiles: [] }), /context|files/);
  const packet = proposeRealTaskResources({ ...input, contextFiles: ["extra.txt"] })[0]!;
  assert.equal(packet.state, "proposed");
  assert.equal(registry.getActiveVersion(identity)!.versionId, parent.versionId);
  const candidate = registry.getCandidate(packet.candidateId!)!;
  assert.equal(promoteWithRegistry(registry, { candidateId: candidate.candidateId, expectedCurrentVersionId: parent.versionId, content: packet.content,
    approvedBy: { kind: "human", identity: "synthetic-owner" }, explicitApproval: true,
    review: { reviewId: "synthetic-context-review", candidateId: candidate.candidateId, contentHash: candidate.contentHash, verdict: "approved", reviewerKind: "independent",
      reviewerId: "synthetic-peer", actorId: candidate.author.identity, evidenceRefs: rule.sourceRefs },
    changeNote: { scope: "fixed context files", evidence: rule.sourceRefs, guardrails: ["original authority"], rollbackVersionId: parent.versionId } }).ok, true);
  const materialized = materialize();
  assert.deepEqual(materialized.baseSpec, spec);
  assert.deepEqual(materialized.spec.context, [...spec.context, "extra.txt"]);
  assert.deepEqual({ ...materialized.spec, context: spec.context }, spec);
  assert.deepEqual(verifyMaterializedTaskResources(registry, materialized), materialized);
  assert.throws(() => verifyMaterializedTaskResources(registry, { ...materialized, spec: { ...materialized.spec, context: spec.context } }), /changed/);
  assert.throws(() => materialize(snapshotDevelopmentTaskSpec({ ...spec, objective: "Keep original", context: Array.from({ length: 32 }, (_, index) => `f${index}`) })), /32/);
});

test("a promoted empty context rule cannot masquerade as the original baseline", () => {
  const registry = new ResourceRegistry(), projectRoot = "/synthetic/promoted-empty-context";
  const identity = taskResourceIdentity(projectRoot, "context-rule"), sourceRefs = ["synthetic/empty-context-review"];
  const content = (requiredFiles: string[]) => JSON.stringify({ topic: "context-rule", requiredFiles, sourceRefs, expectedEffect: "Synthetic fixed context selection" });
  const parent = registry.registerBaseline({ identity, content: content(["extra.txt"]), author: { kind: "human", identity: "synthetic-owner" } });
  const candidate = registry.createCandidate({ identity, content: content([]), parentVersionId: parent.versionId,
    author: { kind: "model", identity: "synthetic-author" }, evaluationPlan: { stages: ["static", "real-task"], metrics: ["correct-delivery"], planVersion: 1 } });
  const promoted = promoteWithRegistry(registry, { candidateId: candidate.candidateId, expectedCurrentVersionId: parent.versionId, content: content([]),
    approvedBy: { kind: "human", identity: "synthetic-owner" }, explicitApproval: true,
    review: { reviewId: "synthetic-empty-context-review", candidateId: candidate.candidateId, contentHash: candidate.contentHash, verdict: "approved", reviewerKind: "independent",
      reviewerId: "synthetic-peer", actorId: candidate.author.identity, evidenceRefs: sourceRefs },
    changeNote: { scope: "synthetic empty context", evidence: sourceRefs, guardrails: ["original authority"], rollbackVersionId: parent.versionId } });
  assert.equal(promoted.ok, true);
  const active = registry.getActiveVersion(identity)!;
  assert.notEqual(active.versionId, parent.versionId);
  assert.equal(active.parentVersionId, parent.versionId);
  const spec = snapshotDevelopmentTaskSpec({ version: 1, objective: "Update value.txt", context: [], write: { allow: ["value.txt"], protect: ["checks"] }, prepare: [],
    checks: [{ id: "unit", command: "node", args: ["checks/unit.mjs"], verifierVersion: "1", protectedPaths: ["checks"], expect: { baseline: "pass" } }],
    budget: { totalSeconds: 30, prepareSeconds: 2, workerSeconds: 5, checkSeconds: 5 }, worker: { model: "inherit", maxAttempts: 1 } });
  assert.throws(() => materializeTaskResources({ registry, projectRoot, logicalTaskId: "promoted-empty", sourceRevision: "a".repeat(40), spec, topics: ["context-rule"] }), /original baseline/);
});
