import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRunId } from "../../../src/domain/ids.js";
import {
  ObservationStore,
  observationsDir
} from "../../../src/context/observation-store.js";
import { projectObservation } from "../../../src/context/observation-projection.js";
import { deleteRunRecords } from "../../../src/privacy/deletion.js";

let uuidCounter = 0;
const UUID = (): string => `fedcba09-8765-4321-abcd-${String(uuidCounter++).padStart(12, "0")}`;

test("lifecycle: fake run → archive → recall → delete → 0 residual", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-obs-life-"));
  const runId = createRunId(UUID);
  try {
    const store = new ObservationStore(stateRoot, runId);
    // Dense text: >10KiB with few newlines so a single recall page can hold it.
    const text = `${"lifecycle-body-".repeat(800)}END\n`;
    assert.ok(Buffer.byteLength(text, "utf8") > 10_240);
    const projected = await projectObservation(
      {
        id: "life-1",
        toolName: "read",
        text,
        isError: false,
        pureText: true,
        evidenceReceipt: false
      },
      { enabled: true, priorFullSends: 0, store }
    );
    assert.equal(projected.reason, "first-two");
    assert.ok(projected.ref);

    async function recallAll(target: ObservationStore): Promise<string> {
      let offset = 0;
      let out = "";
      for (let i = 0; i < 64; i += 1) {
        const page = await target.recall(projected.ref!, offset);
        out += page.text;
        offset = page.nextOffset;
        if (page.eof) break;
      }
      return out;
    }

    assert.equal(await recallAll(store), text);

    // Restart-shaped recall: new store instance, same paths.
    const restarted = new ObservationStore(stateRoot, runId);
    assert.equal(await recallAll(restarted), text);

    await deleteRunRecords(stateRoot, runId, { timeoutMs: 2_000 });
    await assert.rejects(
      () => lstat(observationsDir(stateRoot, runId)),
      (err: NodeJS.ErrnoException) => err.code === "ENOENT"
    );
    await assert.rejects(
      () => lstat(join(stateRoot, "runtime", "runs", runId)),
      (err: NodeJS.ErrnoException) => err.code === "ENOENT"
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("64KiB × 10: first 2 full + 8 placeholders; projected reduction ≥70%", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-obs-reduce-"));
  const runId = createRunId(UUID);
  try {
    const fixture = await readFile(
      join(process.cwd(), "test/fixtures/observation/synthetic-64kib.txt"),
      "utf8"
    );
    assert.equal(Buffer.byteLength(fixture, "utf8"), 65_536);

    const store = new ObservationStore(stateRoot, runId);
    let baseline = 0;
    let projected = 0;
    let fullCount = 0;
    let packedCount = 0;

    for (let i = 0; i < 10; i += 1) {
      // Distinct content per send so each put is a new object; prefix keeps UTF-8 stable.
      const text = `${fixture.slice(0, fixture.length - 12)}${String(i).padStart(12, "0")}`;
      assert.equal(Buffer.byteLength(text, "utf8"), 65_536);
      baseline += Buffer.byteLength(text, "utf8");
      const result = await projectObservation(
        {
          id: `obs-send-${i}`,
          toolName: "bash",
          text,
          isError: false,
          pureText: true,
          evidenceReceipt: false
        },
        { enabled: true, priorFullSends: i, store }
      );
      projected += Buffer.byteLength(result.text, "utf8");
      if (i < 2) {
        assert.equal(result.reason, "first-two");
        assert.equal(result.packed, false);
        assert.equal(result.text, text);
        fullCount += 1;
      } else {
        assert.equal(result.reason, "packed");
        assert.equal(result.packed, true);
        assert.ok(Buffer.byteLength(result.text, "utf8") <= 2048);
        packedCount += 1;
      }
    }

    assert.equal(fullCount, 2);
    assert.equal(packedCount, 8);
    const reduction = 1 - projected / baseline;
    assert.ok(
      reduction >= 0.7,
      `expected ≥70% reduction, got ${(reduction * 100).toFixed(2)}% (baseline=${baseline}, projected=${projected})`
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});
