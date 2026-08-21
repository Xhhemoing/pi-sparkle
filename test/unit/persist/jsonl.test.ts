import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendJsonlLine, readJsonlObjects } from "../../../src/persist/jsonl.js";

async function withTempFile(run: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-jsonl-"));
  try {
    await run(join(dir, "log.jsonl"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("appendJsonlLine and readJsonlObjects round-trip objects", async () => {
  await withTempFile(async (path) => {
    await appendJsonlLine(path, JSON.stringify({ n: 1 }), false);
    await appendJsonlLine(path, JSON.stringify({ n: 2 }), false);
    const read = await readJsonlObjects(path, (lineNumber) => new Error(`corrupt ${lineNumber}`));
    assert.deepEqual(read.values, [{ n: 1 }, { n: 2 }]);
    assert.deepEqual(read.recovery, {});
  });
});

test("readJsonlObjects recovers a truncated last line", async () => {
  await withTempFile(async (path) => {
    await writeFile(path, '{"ok":true}\n{"partial', "utf8");
    const read = await readJsonlObjects(path, (lineNumber) => new Error(`corrupt ${lineNumber}`));
    assert.deepEqual(read.values, [{ ok: true }]);
    assert.equal(read.recovery.incompleteLine, '{"partial');
    assert.equal(read.recovery.lineNumber, 2);
  });
});

test("readJsonlObjects fails closed on a corrupt mid-file line", async () => {
  await withTempFile(async (path) => {
    await writeFile(path, "NOT JSON\n{\"ok\":true}\n", "utf8");
    await assert.rejects(
      () => readJsonlObjects(path, (lineNumber) => new Error(`corrupt ${lineNumber}`)),
      /corrupt 1/
    );
  });
});
