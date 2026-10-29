import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ResourceRegistry } from "../../../src/lab/adaptation/registry.js";
import { promoteWithRegistry } from "../../../src/lab/adaptation/promotion.js";
import { materializeTaskResources, taskResourceIdentity, taskResourceTopic } from "../../../src/lab/adaptation/task-resources.js";
import { snapshotDevelopmentTaskSpec } from "../../../src/development/task-spec.js";

const selection = { providerId: "approved", modelId: "small", thinkingLevel: "xhigh" };
const authority = { authorityRef: "host/owner-decision", approvedSelections: [selection] };
async function api() {
  const module = await import("../../../src/cli/real-task-resource-execution.js").catch((error: NodeJS.ErrnoException) => { if (error.code === "ERR_MODULE_NOT_FOUND") return undefined; throw error; });
  assert.equal(typeof module?.prepareMaterializedTaskExecution, "function", "explicit execution must validate active resource/source before delegating to the original task runner");
  return module!;
}
test("execution preparation consumes only the active fixed recipe and a separate host approval snapshot", async () => {
  const { prepareMaterializedTaskExecution } = await api(), root = await mkdtemp(path.join(tmpdir(), "fixed-model-execution-"));
  try {
    const git = (args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
    git(["init", "--quiet"]); await writeFile(path.join(root, "value.txt"), "original\n", "utf8");
    git(["add", "value.txt"]); git(["-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid", "commit", "-qm", "synthetic source"]);
    const projectRoot = path.join(root, "logical-project"), sourceRevision = git(["rev-parse", "HEAD"]), registry = new ResourceRegistry(), topic = taskResourceTopic("model-thinking"), identity = taskResourceIdentity(projectRoot, topic);
    const version = registry.registerBaseline({ identity, author: { kind: "human", identity: "owner" }, content: JSON.stringify({ topic, selection, sourceRefs: ["private/record"], expectedEffect: "measure" }) });
    const spec = snapshotDevelopmentTaskSpec({ version: 1, objective: "Repair value", context: [], write: { allow: ["value.txt"], protect: [], require: ["value.txt"] }, prepare: [], checks: [{ id: "unit", command: "node", args: ["checks.mjs"], verifierVersion: "1", protectedPaths: ["checks.mjs"], expect: { baseline: "pass" } }], worker: { model: "inherit", maxAttempts: 1 }, budget: { totalSeconds: 60, prepareSeconds: 10, workerSeconds: 20, checkSeconds: 20, usd: 1 } });
    const materialized = materializeTaskResources({ registry, projectRoot, logicalTaskId: "fixed", sourceRevision, spec, topics: [topic] });
    const prepared = prepareMaterializedTaskExecution({ registry, sourceRepo: root, projectRoot, materialized, authority });
    assert.deepEqual(prepared.spec, spec); assert.equal(prepared.expectedSourceRevision, sourceRevision);
    assert.deepEqual(prepared.modelSelection.selection, selection); assert.deepEqual(prepared.modelSelection.authority, authority);
    if (process.platform === "win32") {
      const sameRegistry = new ResourceRegistry(), sameIdentity = taskResourceIdentity(root, topic);
      sameRegistry.registerBaseline({ identity: sameIdentity, author: { kind: "human", identity: "owner" }, content: registry.getContent(version.contentHash)! });
      const sameMaterialized = materializeTaskResources({ registry: sameRegistry, projectRoot: root, logicalTaskId: "same-root", sourceRevision, spec, topics: [topic] });
      assert.throws(() => prepareMaterializedTaskExecution({ registry: sameRegistry, sourceRepo: root.toUpperCase(), projectRoot: root, materialized: sameMaterialized, authority }), /isolated|separate/);
    }
    assert.throws(() => prepareMaterializedTaskExecution({ registry, sourceRepo: root, projectRoot, materialized, authority: { ...authority, approvedSelections: [] } }), /approv|authorit/);
    assert.throws(() => prepareMaterializedTaskExecution({ registry, sourceRepo: root, projectRoot: path.dirname(root), materialized, authority }), /project/);
    assert.throws(() => prepareMaterializedTaskExecution({ registry, sourceRepo: root, projectRoot, materialized: { ...materialized, sourceRevision: "b".repeat(40) }, authority }), /source|revision/);
    const changed = materializeTaskResources({ registry, projectRoot, logicalTaskId: "fixed", sourceRevision, spec: { ...spec, worker: { model: "inherit", maxAttempts: 2 } }, topics: [topic] });
    assert.throws(() => prepareMaterializedTaskExecution({ registry, sourceRepo: root, projectRoot, materialized: changed, authority }), /single|attempt/);
    const candidate = registry.createCandidate({ identity, parentVersionId: version.versionId, author: { kind: "human", identity: "author" }, content: JSON.stringify({ topic, selection: { ...selection, modelId: "other" }, sourceRefs: ["private/record"], expectedEffect: "measure" }), evaluationPlan: { stages: ["static"], metrics: ["correct-delivery"], planVersion: 1 } });
    promoteWithRegistry(registry, { candidateId: candidate.candidateId, expectedCurrentVersionId: version.versionId, content: registry.getContent(candidate.contentHash)!, approvedBy: { kind: "human", identity: "owner" }, explicitApproval: true, review: { reviewId: "peer-review", candidateId: candidate.candidateId, contentHash: candidate.contentHash, reviewerId: "peer", actorId: "author", reviewerKind: "independent", verdict: "approved", evidenceRefs: ["private/review"] }, changeNote: { scope: "fixed profile", evidence: ["private/record"], guardrails: ["no new authority"], rollbackVersionId: version.versionId } });
    assert.throws(() => prepareMaterializedTaskExecution({ registry, sourceRepo: root, projectRoot, materialized, authority }), /active|version/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
