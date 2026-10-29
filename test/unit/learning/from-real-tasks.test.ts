import assert from "node:assert/strict";
import { test } from "node:test";
import { ResourceRegistry } from "../../../src/lab/adaptation/registry.js";
import { adaptationRegistryPath, saveAdaptationRegistry } from "../../../src/lab/adaptation/promotion.js";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { TASK_RESOURCE_TOPICS } from "../../../src/lab/adaptation/task-resources.js";

async function adapter() {
  const module = await import("../../../src/lab/learning/from-real-tasks.js").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ERR_MODULE_NOT_FOUND") return undefined;
    throw error;
  });
  assert.equal(typeof module?.proposeRealTaskResources, "function", "real-task proposals must use the existing registry");
  return module!;
}
const sourceRecords = [{ ref: "private/record-one.json", record: { id: "attempt-one", date: "2026-10-26", source: "pi-sparkle", arm: "sparkle", status: "FAILED", failureClass: "contract", kept: false, prompt: "PRIVATE_NOT_FOR_PACKET" } }];
const checkRecipeLaunchers = [{ id: "absolute-node", fromCommand: "node", fromPrefixArgs: [], command: process.execPath, prefixArgs: [] }];
const modelSelection = { providerId: "approved", modelId: "small", thinkingLevel: "xhigh" };

test("developer adapter proposes fixed model choices without granting authority or creating a baseline", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "model-choice-propose-"));
  try {
    await writeFile(path.join(root, "record.json"), JSON.stringify(sourceRecords[0]!.record), "utf8");
    await writeFile(path.join(root, "records.json"), JSON.stringify(["record.json"]), "utf8");
    await writeFile(path.join(root, "selection.json"), JSON.stringify(modelSelection), "utf8");
    const script = fileURLToPath(new URL("../../../scripts/real-task-adapt.mjs", import.meta.url));
    const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", script, "propose", "--state-root", path.join(root, "state"), "--project", path.join(root, "project"), "--topic", "model-thinking", "--input", path.join(root, "records.json"), "--model-selection", path.join(root, "selection.json")]);
    const packet = JSON.parse(stdout)[0];
    assert.equal(packet.state, "needs-baseline-approval"); assert.deepEqual(JSON.parse(packet.content).selection, modelSelection);
    await assert.rejects(access(adaptationRegistryPath(path.join(root, "state"))));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("operator-selected failure classes seed review packets without creating or activating baselines", async () => {
  const { proposeRealTaskResources } = await adapter();
  const registry = new ResourceRegistry(), before = registry.snapshot();
  const packets = TASK_RESOURCE_TOPICS.flatMap(topic => proposeRealTaskResources({ registry, projectRoot: "/synthetic/project", topic, sourceRecords, ...(topic === "check-recipes" ? { checkRecipeLaunchers } : {}), ...(topic === "model-thinking" ? { modelSelection } : {}), ...(topic === "context-rule" ? { contextFiles: ["src/host.ts"] } : {}) }));
  assert.deepEqual(packets.map(packet => packet.identity.kind), ["workflow-template", "prompt", "prompt", "workflow-template", "workflow-template", "workflow-template"]);
  assert.ok(packets.every(packet => packet.state === "needs-baseline-approval" && packet.candidateId === undefined));
  assert.deepEqual(registry.snapshot(), before);
  assert.ok(!JSON.stringify(packets).includes("PRIVATE_NOT_FOR_PACKET"));
  assert.ok(packets[1]!.content.includes("UNOBSERVED"));
  assert.ok(packets[0]!.content.includes("packageManager"));
  assert.deepEqual(JSON.parse(packets[4]!.content).selection, modelSelection);
  assert.ok(packets.every(packet => packet.proposalKind === "seeded-class-proposal" && packet.observations.selectedRecords === 1 && packet.observations.relatedFailures === (packet.identity.name === "context-rule" ? 0 : 1)));
});

test("existing parents permit proposals and deduplicate content without moving active pointers", async () => {
  const { proposeRealTaskResources } = await adapter();
  const registry = new ResourceRegistry();
  const propose = () => TASK_RESOURCE_TOPICS.flatMap(topic => proposeRealTaskResources({ registry, projectRoot: "/synthetic/project", topic, sourceRecords, ...(topic === "check-recipes" ? { checkRecipeLaunchers } : {}), ...(topic === "model-thinking" ? { modelSelection } : {}), ...(topic === "context-rule" ? { contextFiles: ["src/host.ts"] } : {}) }));
  const initial = propose();
  const parents = initial.map(packet => registry.registerBaseline({ identity: packet.identity, content: "owner-approved existing guidance", author: { kind: "human", identity: "owner" } }));
  const packets = propose();
  assert.ok(packets.every(packet => packet.state === "proposed" && packet.candidateId !== undefined));
  assert.deepEqual(packets.map(packet => registry.getActiveVersion(packet.identity)?.versionId), parents.map(parent => parent.versionId));
  assert.deepEqual(propose().map(packet => packet.candidateId), packets.map(packet => packet.candidateId));
  assert.equal(registry.snapshot().candidates.length, 6);
});

test("proposal sources reject duplicate identities and malformed records instead of manufacturing observations", async () => {
  const { proposeRealTaskResources } = await adapter();
  const registry = new ResourceRegistry();
  assert.throws(() => proposeRealTaskResources({ registry, projectRoot: "/synthetic/project", topic: "host-only-checks", sourceRecords: [...sourceRecords, ...sourceRecords] }), /duplicate/);
  assert.throws(() => proposeRealTaskResources({ registry, projectRoot: "/synthetic/project", topic: "host-only-checks", sourceRecords: [{ ref: "x", record: { id: "x" } }] }), /record/);
  assert.throws(() => proposeRealTaskResources({ registry, projectRoot: "/synthetic/project", topic: "host-only-checks", sourceRecords: [{ ...sourceRecords[0]!, record: { ...sourceRecords[0]!.record, source: ["pi-sparkle"] } }] }), /record/);
  assert.equal(registry.snapshot().versions.length, 0);
});

test("all-success records do not seed proposals and new evidence references do not churn behavioral candidates", async () => {
  const { proposeRealTaskResources } = await adapter(), registry = new ResourceRegistry();
  const propose = (records = sourceRecords) => proposeRealTaskResources({ registry, projectRoot: "/synthetic/project", topic: "host-only-checks", sourceRecords: records })[0]!;
  assert.throws(() => propose([{ ...sourceRecords[0]!, record: { ...sourceRecords[0]!.record, status: "COMPLETED", kept: true } }]), /related failure/);
  assert.throws(() => propose([{ ...sourceRecords[0]!, record: { ...sourceRecords[0]!.record, failureClass: "provider" } }]), /related failure/);
  const preview = propose(); registry.registerBaseline({ identity: preview.identity, content: "original behavior", author: { kind: "human", identity: "owner" } });
  const first = propose(), later = propose([{ ref: "private/new-evidence.json", record: { ...sourceRecords[0]!.record, id: "another-attempt" } }]);
  assert.equal(later.candidateId, first.candidateId); assert.equal(later.content, first.content, "a reused candidate retains exact reviewable bytes");
  assert.equal(later.sourceRecords[0]!.ref, "private/new-evidence.json"); assert.equal(registry.snapshot().candidates.length, 1);
});

test("development script emits review packets while a missing baseline leaves registry.json absent", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "real-task-adapt-cli-"));
  try {
    await writeFile(path.join(root, "record.json"), JSON.stringify(sourceRecords[0]!.record), "utf8");
    await writeFile(path.join(root, "records.json"), JSON.stringify(["record.json"]), "utf8");
    const script = fileURLToPath(new URL("../../../scripts/real-task-adapt.mjs", import.meta.url));
    const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", script, "propose", "--state-root", root,
      "--project", "/synthetic/project", "--topic", "host-only-checks", "--input", path.join(root, "records.json")]);
    const packets = JSON.parse(stdout) as Array<{ state: string }>;
    assert.equal(packets.length, 1); assert.ok(packets.every(packet => packet.state === "needs-baseline-approval"));
    assert.ok(!stdout.includes("PRIVATE_NOT_FOR_PACKET"));
    await assert.rejects(access(adaptationRegistryPath(root)), { code: "ENOENT" });
    assert.ok((await readFile(path.join(root, "record.json"), "utf8")).includes("PRIVATE_NOT_FOR_PACKET"), "source evidence remains intact");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("development script proposes exact check conversions and materializes actual checks using explicit host bindings", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "real-task-check-cli-"));
  try {
    const script = fileURLToPath(new URL("../../../scripts/real-task-adapt.mjs", import.meta.url));
    const run = async (args: string[]) => JSON.parse((await promisify(execFile)(process.execPath, ["--import", "tsx", script, ...args])).stdout);
    const inputFile = path.join(root, "task.json"), bindingFile = path.join(root, "bindings.json"), launcherFile = path.join(root, "launchers.json"), recordsFile = path.join(root, "records.json");
    await writeFile(path.join(root, "record.json"), JSON.stringify(sourceRecords[0]!.record), "utf8");
    await writeFile(recordsFile, JSON.stringify(["record.json"]), "utf8");
    await writeFile(launcherFile, JSON.stringify(checkRecipeLaunchers), "utf8");
    const common = ["--state-root", root, "--project", "/synthetic/project"];
    const packets = await run(["propose", ...common, "--topic", "check-recipes", "--check-launchers", launcherFile, "--input", recordsFile]);
    assert.equal(packets[0].state, "needs-baseline-approval"); assert.deepEqual(JSON.parse(packets[0].content).launchers, checkRecipeLaunchers);
    await assert.rejects(access(adaptationRegistryPath(root)), { code: "ENOENT" });
    const registry = new ResourceRegistry(); registry.registerBaseline({ identity: packets[0].identity, content: packets[0].content, author: { kind: "human", identity: "synthetic-owner" } });
    await saveAdaptationRegistry(root, registry);
    const task = { version: 1, objective: "Synthetic task", context: [], write: { allow: ["value.txt"], protect: ["checks"] }, prepare: [],
      checks: [{ id: "unit", command: "node", args: ["checks/unit.mjs"], verifierVersion: "1", protectedPaths: ["checks"], expect: { baseline: "pass" } }],
      budget: { totalSeconds: 60, prepareSeconds: 5, workerSeconds: 20, checkSeconds: 20 }, worker: { model: "inherit", maxAttempts: 1 } };
    await writeFile(inputFile, JSON.stringify(task), "utf8");
    await writeFile(bindingFile, JSON.stringify({ authorityRef: "private/authorized-host", originalChecks: task.checks, selections: [{ checkId: "unit", launcherId: "absolute-node" }] }), "utf8");
    const materialized = await run(["materialize", ...common, "--input", inputFile, "--task-id", "synthetic", "--revision", "a".repeat(40), "--topics", "check-recipes", "--check-bindings", bindingFile]);
    assert.equal(materialized.spec.checks[0].command, process.execPath); assert.deepEqual(materialized.spec.checks[0].args, task.checks[0]!.args);
    assert.equal(materialized.spec.objective, task.objective); assert.deepEqual(materialized.spec.budget, task.budget);
  } finally { await rm(root, { recursive: true, force: true }); }
});
