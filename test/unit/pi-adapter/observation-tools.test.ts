import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createRunId } from "../../../src/domain/ids.js";
import {
  createObservationProjector,
  createRecallTool
} from "../../../src/pi-adapter/observation-tools.js";

const DENSE = "projection-body-".repeat(1000); // >10KiB, few newlines

test("enabled projector: first two sends full, then placeholder, same content idempotent", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "obs-proj-"));
  try {
    const projector = createObservationProjector({ enabled: true, toolName: "sparkle_read_file" });
    const runId = createRunId();
    projector.bind({ runId, stateRoot });
    const first = await projector.project({ sourceId: "s1", text: DENSE });
    assert.equal(first.text, DENSE, "first send is full");
    assert.equal(first.packed, false);
    const second = await projector.project({ sourceId: "s2", text: DENSE });
    assert.equal(second.text, DENSE, "second send is full");
    assert.equal(second.packed, false);
    const third = await projector.project({ sourceId: "s3", text: DENSE });
    assert.equal(third.packed, true, "third send is packed");
    assert.ok(Buffer.byteLength(third.text, "utf8") <= 2048);
    assert.match(third.text, /\[observation packed\]/);
    assert.ok(third.ref !== undefined && third.ref.sha256.length === 64);
    // Same content again: idempotent archive, still packed, same sha.
    const fourth = await projector.project({ sourceId: "s4", text: DENSE });
    assert.equal(fourth.packed, true);
    assert.equal(fourth.ref?.sha256, third.ref?.sha256);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("projector refuses use before bind and double binds", async () => {
  const projector = createObservationProjector({ enabled: true, toolName: "sparkle_read_file" });
  await assert.rejects(() => projector.project({ sourceId: "x", text: DENSE }), /before bind/);
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
      const result = await projector.project({ sourceId: `s${i}`, text: DENSE });
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
    const small = await projector.project({ sourceId: "small", text: "tiny" });
    assert.equal(small.packed, false);
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
    await projector.project({ sourceId: "a", text: DENSE });
    const packed = await projector.project({ sourceId: "b", text: DENSE });
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
