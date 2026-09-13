import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  appendJsonlLine,
  readJsonlObjects,
  readJsonlObjectsFromOffset
} from "../../../src/persist/jsonl.js";

async function withTempFile(run: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-jsonl-off-"));
  try {
    await run(join(dir, "log.jsonl"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("offset 0 matches readJsonlObjects", async () => {
  await withTempFile(async (path) => {
    await appendJsonlLine(path, JSON.stringify({ n: 1 }), false);
    await appendJsonlLine(path, JSON.stringify({ n: 2 }), false);
    const full = await readJsonlObjects(path, (line) => new Error(`corrupt ${line}`));
    const offset = await readJsonlObjectsFromOffset(path, 0, (line) => new Error(`corrupt ${line}`));
    assert.deepEqual(offset.values, full.values);
    assert.deepEqual(offset.recovery, full.recovery);
    assert.equal(offset.fromByteOffset, 0);
    assert.equal(offset.completeByteLength, Buffer.byteLength(await readFile(path), "utf8"));
  });
});

test("reading after the first record returns only the tail", async () => {
  await withTempFile(async (path) => {
    const first = `${JSON.stringify({ n: 1 })}\n`;
    await writeFile(path, `${first}${JSON.stringify({ n: 2 })}\n`);
    const offset = Buffer.byteLength(first, "utf8");
    const read = await readJsonlObjectsFromOffset(path, offset, (line) => new Error(`corrupt ${line}`));
    assert.deepEqual(read.values, [{ n: 2 }]);
    assert.deepEqual(read.recovery, {});
    assert.equal(read.fromByteOffset, offset);
    assert.equal(read.unsafe, undefined);
  });
});

test("a mid-file offset that is not on a newline is unsafe, not parsed", async () => {
  await withTempFile(async (path) => {
    await writeFile(path, '{"n":1}\n{"n":2}\n');
    const read = await readJsonlObjectsFromOffset(path, 3, (line) => new Error(`corrupt ${line}`));
    assert.equal(read.unsafe, "offset-not-on-boundary");
    assert.deepEqual(read.values, []);
  });
});

test("offset past EOF is unsafe so persist can fall back", async () => {
  await withTempFile(async (path) => {
    await writeFile(path, '{"n":1}\n');
    const read = await readJsonlObjectsFromOffset(path, 999, (line) => new Error(`corrupt ${line}`));
    assert.equal(read.unsafe, "offset-beyond-eof");
    assert.deepEqual(read.values, []);
  });
});

test("corrupt middle in the tail still fails closed with the absolute line number", async () => {
  await withTempFile(async (path) => {
    const first = `${JSON.stringify({ n: 1 })}\n`;
    await writeFile(path, `${first}NOT JSON\n{"n":3}\n`);
    const offset = Buffer.byteLength(first, "utf8");
    await assert.rejects(
      () => readJsonlObjectsFromOffset(path, offset, (line) => new Error(`corrupt ${line}`)),
      /corrupt 2/
    );
  });
});

test("truncated tail after an offset is recovery, and repair keeps the prefix bytes", async () => {
  await withTempFile(async (path) => {
    const first = `${JSON.stringify({ n: 1 })}\n`;
    await writeFile(path, Buffer.from(`${first}{"partial`, "utf8"));
    const offset = Buffer.byteLength(first, "utf8");
    const read = await readJsonlObjectsFromOffset(path, offset, (line) => new Error(`corrupt ${line}`), {
      repair: true
    });
    assert.deepEqual(read.values, []);
    assert.equal(read.recovery.incompleteLine, '{"partial');
    assert.equal(await readFile(path, "utf8"), first);
    assert.equal(read.completeByteLength, offset);
  });
});
