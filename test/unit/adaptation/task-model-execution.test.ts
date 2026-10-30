import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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

async function executionFixture(body: (fixture: { source: string; project: string; git(repo: string, args: string[]): string; prepare(source: string, project: string, usd?: number): ReturnType<Awaited<ReturnType<typeof api>>["prepareMaterializedTaskExecution"]> }) => Promise<void>) {
  const { prepareMaterializedTaskExecution } = await api(), root = await mkdtemp(path.join(tmpdir(), "fixed-model-admission-"));
  try {
    const source = path.join(root, "source"), project = path.join(root, "project");
    const git = (repo: string, args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    await mkdir(source);
    git(source, ["init", "--quiet"]);
    await writeFile(path.join(source, "value.txt"), "original\n", "utf8");
    git(source, ["add", "value.txt"]);
    git(source, ["-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid", "commit", "-qm", "synthetic source"]);
    git(root, ["clone", "--quiet", "--no-hardlinks", source, project]);
    const prepare = (sourceRepo: string, projectRoot: string, usd?: number) => {
      const registry = new ResourceRegistry(), topic = taskResourceTopic("model-thinking"), identity = taskResourceIdentity(projectRoot, topic);
      registry.registerBaseline({ identity, author: { kind: "human", identity: "owner" }, content: JSON.stringify({ topic, selection, sourceRefs: ["private/record"], expectedEffect: "measure" }) });
      const spec = snapshotDevelopmentTaskSpec({ version: 1, objective: "Repair value", context: [], write: { allow: ["value.txt"], protect: [], require: ["value.txt"] }, prepare: [], checks: [{ id: "unit", command: "node", args: ["checks.mjs"], verifierVersion: "1", protectedPaths: ["checks.mjs"], expect: { baseline: "pass" } }], worker: { model: "inherit", maxAttempts: 1 }, budget: { totalSeconds: 60, prepareSeconds: 10, workerSeconds: 20, checkSeconds: 20, ...(usd === undefined ? {} : { usd }) } });
      const materialized = materializeTaskResources({ registry, projectRoot, logicalTaskId: "admission", sourceRevision: git(sourceRepo, ["rev-parse", "HEAD"]), spec, topics: [topic] });
      return prepareMaterializedTaskExecution({ registry, sourceRepo, projectRoot, materialized, authority });
    };
    await body({ source, project, git, prepare });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("execution preparation refuses a missing explicit reference budget", async () => executionFixture(async ({ source, project, prepare }) => {
  assert.throws(() => prepare(source, project), /budget|US\$5/);
}));

test("execution preparation refuses a reference budget above US$5", async () => executionFixture(async ({ source, project, prepare }) => {
  assert.throws(() => prepare(source, project, 5.01), /budget|US\$5/);
}));

for (const usd of [5, 1.25]) {
  test(`execution preparation admits an independent repository with an explicit US$${usd} budget`, async () => executionFixture(async ({ source, project, prepare }) => {
    const prepared = prepare(source, project, usd);
    assert.equal(prepared.spec.budget.usd, usd);
    assert.deepEqual(prepared.modelSelection.selection, selection);
  }));
}

for (const layout of ["main-to-linked", "linked-to-main", "linked-to-linked"] as const) {
  test(`execution preparation refuses shared Git common storage: ${layout}`, async () => executionFixture(async ({ source, git, prepare }) => {
    const linked = path.join(path.dirname(source), "linked"), other = path.join(path.dirname(source), "other-linked");
    git(source, ["worktree", "add", "--detach", linked, "HEAD"]);
    git(source, ["worktree", "add", "--detach", other, "HEAD"]);
    const sourceRepo = layout === "main-to-linked" ? source : linked;
    const projectRoot = layout === "linked-to-main" ? source : layout === "main-to-linked" ? linked : other;
    assert.throws(() => prepare(sourceRepo, projectRoot, 1), /isolated|separate|common|independent/);
  }));
}

test("execution preparation refuses an unreadable Git identity instead of treating it as a logical non-Git project", async () => executionFixture(async ({ source, project, prepare }) => {
  await writeFile(path.join(project, ".git", "config"), "[broken\n", "utf8");
  assert.throws(() => prepare(source, project, 1), /Git|git|isolat|identity/);
}));

test("execution preparation refuses a damaged bare Git repository identity", async () => executionFixture(async ({ source, project, git, prepare }) => {
  const bare = path.join(path.dirname(project), "bare-project.git");
  git(path.dirname(project), ["clone", "--quiet", "--bare", source, bare]);
  await writeFile(path.join(bare, "HEAD"), "invalid\n", "utf8");
  assert.throws(() => prepare(source, bare, 1), /Git|git|isolat|identity/);
}));

for (const missing of ["HEAD", "objects"] as const) {
  test(`execution preparation refuses a bare Git repository missing ${missing}`, async () => executionFixture(async ({ source, project, git, prepare }) => {
    const bare = path.join(path.dirname(project), "bare-project.git");
    git(path.dirname(project), ["clone", "--quiet", "--bare", source, bare]);
    await rm(path.join(bare, missing), { recursive: true, force: true });
    assert.throws(() => prepare(source, bare, 1), /Git|git|isolat|identity/);
  }));
}

test("execution preparation inspects physical Git ancestors through a directory junction", async () => executionFixture(async ({ source, project, prepare }) => {
  const logical = path.join(project, "logical-project"), alias = path.join(path.dirname(project), "logical-alias");
  await mkdir(logical);
  await writeFile(path.join(project, ".git", "HEAD"), "invalid\n", "utf8");
  await symlink(logical, alias, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => prepare(source, alias, 1), /Git|git|isolat|identity/);
}));

for (const ordinary of ["directories", "files"] as const) {
  test(`execution preparation permits ordinary non-Git project names: ${ordinary}`, async () => executionFixture(async ({ source, project, prepare }) => {
    const logical = path.join(path.dirname(project), "ordinary-logical");
    await mkdir(path.join(logical, "objects"), { recursive: true });
    await mkdir(path.join(logical, "refs"));
    if (ordinary === "directories") await mkdir(path.join(logical, "config"));
    else {
      await writeFile(path.join(logical, "config"), "ordinary project configuration\n", "utf8");
      await writeFile(path.join(logical, "HEAD"), "ordinary project heading\n", "utf8");
    }
    assert.equal(prepare(source, logical, 1).spec.budget.usd, 1);
  }));
}
test("execution preparation permits an existing logical project without Git metadata", async () => executionFixture(async ({ source, project, prepare }) => {
  const logical = path.join(path.dirname(project), "logical-project");
  await mkdir(logical);
  assert.equal(prepare(source, logical, 1).spec.budget.usd, 1);
}));
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
