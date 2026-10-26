import assert from "node:assert/strict";
import { test } from "node:test";
import { ResourceRegistry } from "../../../src/lab/adaptation/registry.js";
import { adaptationRegistryPath } from "../../../src/lab/adaptation/promotion.js";
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

test("operator-selected failure classes seed review packets without creating or activating baselines", async () => {
  const { proposeRealTaskResources } = await adapter();
  const registry = new ResourceRegistry(), before = registry.snapshot();
  const packets = TASK_RESOURCE_TOPICS.flatMap(topic => proposeRealTaskResources({ registry, projectRoot: "/synthetic/project", topic, sourceRecords }));
  assert.deepEqual(packets.map(packet => packet.identity.kind), ["workflow-template", "prompt", "prompt"]);
  assert.ok(packets.every(packet => packet.state === "needs-baseline-approval" && packet.candidateId === undefined));
  assert.deepEqual(registry.snapshot(), before);
  assert.ok(!JSON.stringify(packets).includes("PRIVATE_NOT_FOR_PACKET"));
  assert.ok(packets[1]!.content.includes("UNOBSERVED"));
  assert.ok(packets[0]!.content.includes("packageManager"));
  assert.ok(packets.every(packet => packet.proposalKind === "seeded-class-proposal" && packet.observations.selectedRecords === 1 && packet.observations.relatedFailures === 1));
});

test("existing parents permit proposals and deduplicate content without moving active pointers", async () => {
  const { proposeRealTaskResources } = await adapter();
  const registry = new ResourceRegistry();
  const propose = () => TASK_RESOURCE_TOPICS.flatMap(topic => proposeRealTaskResources({ registry, projectRoot: "/synthetic/project", topic, sourceRecords }));
  const initial = propose();
  const parents = initial.map(packet => registry.registerBaseline({ identity: packet.identity, content: "owner-approved existing guidance", author: { kind: "human", identity: "owner" } }));
  const packets = propose();
  assert.ok(packets.every(packet => packet.state === "proposed" && packet.candidateId !== undefined));
  assert.deepEqual(packets.map(packet => registry.getActiveVersion(packet.identity)?.versionId), parents.map(parent => parent.versionId));
  assert.deepEqual(propose().map(packet => packet.candidateId), packets.map(packet => packet.candidateId));
  assert.equal(registry.snapshot().candidates.length, 3);
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
