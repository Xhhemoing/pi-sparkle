import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createRunId } from "../../../src/domain/ids.js";
import {
  createObservationProjector,
  createRecallTool,
  RecallBudgetExceededError
} from "../../../src/pi-adapter/observation-tools.js";

const DENSE = "projection-body-".repeat(1000); // >10KiB, few newlines
const SAFE = {
  resultKind: "observation" as const,
  isError: false,
  mutatesState: false,
  securityCritical: false,
  toolKind: "read" as const,
  toolPolicyProjectable: true
};
const SAFE_READ = { path: "src/safe-observation.txt" };

test("enabled projector: first two sends full, then placeholder, same content idempotent", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "obs-proj-"));
  try {
    const projector = createObservationProjector({ enabled: true, toolName: "sparkle_read_file" });
    const runId = createRunId();
    projector.bind({ runId, stateRoot });
    const first = await projector.project({ sourceId: "s1", text: DENSE, toolParams: SAFE_READ, projectability: SAFE });
    assert.equal(first.text, DENSE, "first send is full");
    assert.equal(first.packed, false);
    const second = await projector.project({ sourceId: "s2", text: DENSE, toolParams: SAFE_READ, projectability: SAFE });
    assert.equal(second.text, DENSE, "second send is full");
    assert.equal(second.packed, false);
    const third = await projector.project({ sourceId: "s3", text: DENSE, toolParams: SAFE_READ, projectability: SAFE });
    assert.equal(third.packed, true, "third send is packed");
    assert.ok(Buffer.byteLength(third.text, "utf8") <= 2048);
    assert.match(third.text, /\[observation packed\]/);
    assert.ok(third.ref !== undefined && third.ref.id.startsWith("obs_v2_"));
    // Same content again: exact-byte reuse, still packed, same opaque id.
    const fourth = await projector.project({ sourceId: "s4", text: DENSE, toolParams: SAFE_READ, projectability: SAFE });
    assert.equal(fourth.packed, true);
    assert.equal(fourth.ref?.id, third.ref?.id);
    assert.ok(projector.mechanism.repeatMassBytes > 10_240);
    assert.ok(projector.mechanism.placeholderBytes > 0);
    assert.ok(projector.mechanism.placeholderBytes <= 2048 * 2);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("projector refuses use before bind and double binds", async () => {
  const projector = createObservationProjector({ enabled: true, toolName: "sparkle_read_file" });
  await assert.rejects(() => projector.project({ sourceId: "x", text: DENSE, toolParams: SAFE_READ, projectability: SAFE }), /before bind/);
  const stateRoot = await mkdtemp(path.join(tmpdir(), "obs-proj-bind-"));
  try {
    projector.bind({ runId: createRunId(), stateRoot });
    assert.throws(() => projector.bind({ runId: createRunId(), stateRoot }), /already bound/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("disabled projector returns text unchanged and archives nothing", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "obs-proj-off-"));
  try {
    const { readdir } = await import("node:fs/promises");
    const runId = createRunId();
    const projector = createObservationProjector({ enabled: false, toolName: "sparkle_read_file" });
    projector.bind({ runId, stateRoot });
    for (let i = 0; i < 5; i++) {
      const result = await projector.project({ sourceId: `s${i}`, text: DENSE, toolParams: SAFE_READ, projectability: SAFE });
      assert.equal(result.text, DENSE);
      assert.equal(result.packed, false);
    }
    const obsDir = path.join(stateRoot, "runtime", "runs", runId, "observations");
    await assert.rejects(() => readdir(obsDir), /ENOENT/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("ineligible results (small, error, receipt) are never projected", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "obs-proj-elig-"));
  try {
    const projector = createObservationProjector({ enabled: true, toolName: "sparkle_read_file" });
    projector.bind({ runId: createRunId(), stateRoot });
    const small = await projector.project({ sourceId: "small", text: "tiny", toolParams: SAFE_READ, projectability: SAFE });
    assert.equal(small.packed, false);
    const observationsDir = path.join(stateRoot, "runtime", "runs", projector.runId!, "observations");
    await assert.rejects(() => import("node:fs/promises").then(({ readdir }) => readdir(observationsDir)), /ENOENT/);
    const errored = await projector.project({ sourceId: "err", text: DENSE, isError: true });
    assert.equal(errored.packed, false);
    const receipt = await projector.project({ sourceId: "rcpt", text: DENSE, evidenceReceipt: true });
    assert.equal(receipt.packed, false);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("recall tool pages through the archived object and refuses foreign ids", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "obs-proj-recall-"));
  try {
    const projector = createObservationProjector({ enabled: true, toolName: "sparkle_read_file" });
    projector.bind({ runId: createRunId(), stateRoot });
    await projector.project({ sourceId: "a", text: DENSE, toolParams: SAFE_READ, projectability: SAFE });
    const packed = await projector.project({ sourceId: "b", text: DENSE, toolParams: SAFE_READ, projectability: SAFE });
    assert.ok(packed.ref !== undefined);
    const tool = createRecallTool(projector);
    const page1 = await tool.execute("t1", { id: packed.ref.id, offset: 0 });
    const text1 = page1.content[0]?.type === "text" ? page1.content[0].text : "";
    assert.ok(text1.length > 0);
    assert.match(text1, /projection-body-/);
    // Foreign / unknown id refused.
    await assert.rejects(() => tool.execute("t2", { id: "obs_does_not_exist", offset: 0 }), /unknown|not archived/i);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("middle-only mutation gets a fresh first-two window and a distinct ref", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "obs-proj-middle-"));
  try {
    const projector = createObservationProjector({ enabled: true, toolName: "sparkle_read_file" });
    projector.bind({ runId: createRunId(), stateRoot });
    const head = "H".repeat(300);
    const tail = "T".repeat(300);
    const original = `${head}${"a".repeat(12_000)}${tail}`;
    const mutated = `${head}${"b".repeat(12_000)}${tail}`;
    await projector.project({ sourceId: "o1", text: original, toolParams: SAFE_READ, projectability: SAFE });
    await projector.project({ sourceId: "o2", text: original, toolParams: SAFE_READ, projectability: SAFE });
    const packedOriginal = await projector.project({ sourceId: "o3", text: original, toolParams: SAFE_READ, projectability: SAFE });
    assert.equal(packedOriginal.packed, true);
    const firstMutated = await projector.project({ sourceId: "m1", text: mutated, toolParams: SAFE_READ, projectability: SAFE });
    assert.equal(firstMutated.packed, false);
    assert.equal(firstMutated.text, mutated);
    assert.notEqual(firstMutated.ref?.id, packedOriginal.ref?.id);
    const secondMutated = await projector.project({ sourceId: "m2", text: mutated, toolParams: SAFE_READ, projectability: SAFE });
    assert.equal(secondMutated.packed, false);
    assert.equal(secondMutated.text, mutated);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("unsafe or missing projectability metadata is never packed", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "obs-proj-meta-"));
  try {
    const projector = createObservationProjector({ enabled: true, toolName: "sparkle_read_file" });
    projector.bind({ runId: createRunId(), stateRoot });
    const safe = {
      resultKind: "observation" as const,
      isError: false,
      mutatesState: false,
      securityCritical: false,
      toolKind: "read" as const,
      toolPolicyProjectable: true
    };
    const cases = [
      undefined,
      { ...safe, isError: true },
      { ...safe, mutatesState: true },
      { ...safe, securityCritical: true },
      { ...safe, resultKind: "error" as const },
      { ...safe, toolKind: "write" as const },
      { ...safe, toolKind: "verification" as const },
      { ...safe, toolPolicyProjectable: false }
    ];
    for (const projectability of cases) {
      for (let send = 0; send < 3; send += 1) {
        const result = await projector.project({
          sourceId: `meta-${send}`,
          text: DENSE,
          toolParams: SAFE_READ,
          ...(projectability !== undefined ? { projectability } : {})
        });
        assert.equal(result.packed, false, `metadata ${JSON.stringify(projectability)} send ${send}`);
        assert.equal(result.text, DENSE);
      }
    }
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("read projection derives secret-bearing status from path, params, and content", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "obs-proj-secrets-"));
  try {
    const projector = createObservationProjector({ enabled: true, toolName: "sparkle_read_file" });
    projector.bind({ runId: createRunId(), stateRoot });
    const secretContent = `${DENSE}\nAuthorization: Bearer abcdefghijklmnop`;
    const cases = [
      { name: "missing params", params: undefined, text: DENSE },
      { name: ".env path", params: { path: ".env.production" }, text: DENSE },
      { name: "auth yaml", params: { path: "config/auth.yaml" }, text: DENSE },
      { name: "credential path", params: { path: "config/credentials.json" }, text: DENSE },
      { name: "singular secret directory", params: { path: "config/secret/service.txt" }, text: DENSE },
      { name: "private-key path", params: { path: "keys/service.pem" }, text: DENSE },
      { name: "putty private-key path", params: { path: "keys/service.ppk" }, text: DENSE },
      {
        name: "trusted resolved secret alias",
        params: { path: "public-cache/vault.dat" },
        resolvedReadPath: path.join(stateRoot, "project", "secrets", "vault.dat"),
        text: DENSE
      },
      { name: "secret content", params: SAFE_READ, text: secretContent }
    ];
    for (const entry of cases) {
      for (let send = 0; send < 3; send += 1) {
        const result = await projector.project({
          sourceId: `${entry.name}-${send}`,
          text: entry.text,
          ...(entry.params === undefined ? {} : { toolParams: entry.params }),
          ...("resolvedReadPath" in entry ? { resolvedReadPath: entry.resolvedReadPath } : {}),
          projectability: SAFE
        });
        assert.equal(result.packed, false, entry.name);
        assert.equal(result.text, entry.text, entry.name);
      }
    }
    const observationsDir = path.join(stateRoot, "runtime", "runs", projector.runId!, "observations");
    await assert.rejects(() => import("node:fs/promises").then(({ readdir }) => readdir(observationsDir)), /ENOENT/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("invalid cumulative recall budgets are refused at construction", () => {
  for (const recallBudget of [
    { maxCalls: 0, maxBytes: 16_384, maxPages: 1 },
    { maxCalls: 1, maxBytes: -1, maxPages: 1 },
    { maxCalls: 1.5, maxBytes: 16_384, maxPages: 1 },
    { maxCalls: 1, maxBytes: 16_384, maxPages: Number.POSITIVE_INFINITY }
  ]) {
    assert.throws(
      () => createObservationProjector({ enabled: true, toolName: "sparkle_read_file", recallBudget }),
      /recall budget/
    );
  }
});

test("storage failure returns the full result and records a fallback", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "obs-proj-storage-failure-"));
  try {
    // Block the runtime root so ObservationStore.put fails before creating an archive.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(stateRoot, "runtime"), "not-a-directory");
    const projector = createObservationProjector({ enabled: true, toolName: "sparkle_read_file" });
    projector.bind({ runId: createRunId(), stateRoot });
    const result = await projector.project({ sourceId: "storage-failure", text: DENSE, toolParams: SAFE_READ, projectability: SAFE });
    assert.equal(result.text, DENSE);
    assert.equal(result.packed, false);
    assert.equal(projector.mechanism.storageUnavailable, 1);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("recall budget exhaustion is a typed refusal and does not truncate the page", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "obs-proj-budget-"));
  try {
    const projector = createObservationProjector({
      enabled: true,
      toolName: "sparkle_read_file",
      recallBudget: { maxCalls: 1, maxBytes: 16_384, maxPages: 32 }
    });
    projector.bind({ runId: createRunId(), stateRoot });
    await projector.project({ sourceId: "b1", text: DENSE, toolParams: SAFE_READ, projectability: SAFE });
    const packed = await projector.project({ sourceId: "b2", text: DENSE, toolParams: SAFE_READ, projectability: SAFE });
    assert.ok(packed.ref !== undefined);
    const archived = packed.ref;
    const tool = createRecallTool(projector);
    const first = await tool.execute("c1", { id: archived.id, offset: 0 });
    const firstText = first.content[0]?.type === "text" ? first.content[0].text : "";
    assert.match(firstText, /projection-body-/);
    await assert.rejects(
      () => tool.execute("c2", { id: archived.id, offset: 0 }),
      (error: Error) => {
        assert.ok(error instanceof RecallBudgetExceededError);
        assert.equal(error.code, "RECALL_BUDGET_EXHAUSTED");
        assert.equal(error.receipt.dimension, "calls");
        assert.equal(error.receipt.refId, archived.id);
        assert.match(error.message, /recall budget exhausted: calls/);
        assert.match(error.message, new RegExp(archived.id));
        assert.equal(projector.mechanism.recallRefusals, 1);
        assert.doesNotMatch(error.message, /projection-body-/);
        return true;
      }
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});
