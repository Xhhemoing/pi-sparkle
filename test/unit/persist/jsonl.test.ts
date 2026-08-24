import assert from "node:assert/strict";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
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

test("readJsonlObjects treats missing and empty files as empty logs", async () => {
  await withTempFile(async (path) => {
    const corrupt = (lineNumber: number): Error => new Error(`corrupt ${lineNumber}`);
    assert.deepEqual(await readJsonlObjects(path, corrupt), { values: [], recovery: {} });

    await writeFile(path, "", "utf8");
    assert.deepEqual(await readJsonlObjects(path, corrupt), { values: [], recovery: {} });
  });
});

test("appendJsonlLine creates parent directories and exercises the fsync path", async () => {
  await withTempFile(async (path) => {
    const probe = await open(path, "w");
    type Handle = typeof probe;
    type HandlePrototype = { sync: Handle["sync"] };
    const prototype = Object.getPrototypeOf(probe) as HandlePrototype;
    const originalSync = prototype.sync;
    await probe.close();
    await rm(path);

    let syncCalls = 0;
    prototype.sync = (async function (this: Handle): Promise<void> {
      syncCalls += 1;
      await Reflect.apply(originalSync, this, []);
    }) as Handle["sync"];
    const nestedPath = join(path, "..", "nested", "durable.jsonl");
    try {
      await appendJsonlLine(nestedPath, JSON.stringify({ durable: true }), true);
    } finally {
      prototype.sync = originalSync;
    }

    assert.equal(syncCalls, 1);
    assert.equal(await readFile(nestedPath, "utf8"), '{"durable":true}\n');
    const read = await readJsonlObjects(
      nestedPath,
      (lineNumber) => new Error(`corrupt ${lineNumber}`)
    );
    assert.deepEqual(read, { values: [{ durable: true }], recovery: {} });
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
    await writeFile(path, '{"first":true}\nNOT JSON\n{"last":true}\n', "utf8");
    await assert.rejects(
      () => readJsonlObjects(path, (lineNumber) => new Error(`corrupt ${lineNumber}`)),
      /corrupt 2/
    );
  });
});

test("readJsonlObjects fails closed when an invalid tail is newline-terminated", async () => {
  await withTempFile(async (path) => {
    await writeFile(path, '{"ok":true}\nNOT JSON\n', "utf8");
    await assert.rejects(
      () => readJsonlObjects(path, (lineNumber) => new Error(`corrupt ${lineNumber}`)),
      /corrupt 2/
    );
  });
});

test("readJsonlObjects accepts a valid final line without a newline", async () => {
  await withTempFile(async (path) => {
    await writeFile(path, '{"first":true}\n{"last":true}', "utf8");
    const read = await readJsonlObjects(path, (lineNumber) => new Error(`corrupt ${lineNumber}`));
    assert.deepEqual(read, { values: [{ first: true }, { last: true }], recovery: {} });
  });
});
