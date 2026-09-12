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

test("appendJsonlLine creates missing parent directories for both durability modes", async () => {
  await withTempFile(async (path) => {
    for (const fsync of [false, true]) {
      const nestedPath = join(path, "..", fsync ? "durable" : "buffered", "log.jsonl");
      await appendJsonlLine(nestedPath, JSON.stringify({ fsync }), fsync);
      assert.equal(await readFile(nestedPath, "utf8"), `${JSON.stringify({ fsync })}\n`);
    }
  });
});

test("appendJsonlLine writes and syncs through the same file handle", async () => {
  await withTempFile(async (path) => {
    const probe = await open(path, "w");
    type Handle = typeof probe;
    type HandlePrototype = {
      appendFile: Handle["appendFile"];
      sync: Handle["sync"];
    };
    const prototype = Object.getPrototypeOf(probe) as HandlePrototype;
    const originalAppendFile = prototype.appendFile;
    const originalSync = prototype.sync;
    await probe.close();
    await rm(path);

    const writtenHandles = new WeakSet<Handle>();
    let writeCalls = 0;
    let sameHandleSyncCalls = 0;
    prototype.appendFile = (async function (this: Handle, ...args: unknown[]): Promise<void> {
      writeCalls += 1;
      writtenHandles.add(this);
      await Reflect.apply(originalAppendFile, this, args);
    }) as Handle["appendFile"];
    prototype.sync = (async function (this: Handle): Promise<void> {
      if (writtenHandles.has(this)) sameHandleSyncCalls += 1;
      await Reflect.apply(originalSync, this, []);
    }) as Handle["sync"];
    try {
      await appendJsonlLine(path, JSON.stringify({ durable: true }), true);
    } finally {
      prototype.appendFile = originalAppendFile;
      prototype.sync = originalSync;
    }

    assert.equal(writeCalls, 1);
    assert.equal(sameHandleSyncCalls, 1);
    assert.equal(await readFile(path, "utf8"), '{"durable":true}\n');
  });
});

test("readJsonlObjects recovers a truncated last line and repairs the file", async () => {
  await withTempFile(async (path) => {
    const bytes = Buffer.from('{"ok":true}\n{"partial', "utf8");
    await writeFile(path, bytes);
    const read = await readJsonlObjects(path, (lineNumber) => new Error(`corrupt ${lineNumber}`), {
      repair: true
    });
    assert.deepEqual(read, {
      values: [{ ok: true }],
      recovery: { incompleteLine: '{"partial', lineNumber: 2 }
    });
    assert.equal(await readFile(path, "utf8"), '{"ok":true}\n');
  });
});

test("after tail repair, append and re-read stay clean", async () => {
  await withTempFile(async (path) => {
    await writeFile(path, Buffer.from('{"ok":true}\n{"partial', "utf8"));
    const recovered = await readJsonlObjects(path, (lineNumber) => new Error(`corrupt ${lineNumber}`), {
      repair: true
    });
    assert.equal(recovered.recovery.incompleteLine, '{"partial');
    await appendJsonlLine(path, JSON.stringify({ n: 2 }), false);
    const again = await readJsonlObjects(
      path,
      (lineNumber) => new Error(`JSONL_AFTER_ERROR corrupt line ${lineNumber}`)
    );
    assert.deepEqual(again, { values: [{ ok: true }, { n: 2 }], recovery: {} });
  });
});

test("parallel in-process appends preserve complete 1 KB lines", async () => {
  await withTempFile(async (path) => {
    const workers = 8;
    const appendsPerWorker = 32;
    const lineBytes = 1_023;

    for (const fsync of [false, true]) {
      const appendPath = join(path, "..", fsync ? "parallel-fsync.jsonl" : "parallel.jsonl");
      const expected = Array.from({ length: workers * appendsPerWorker }, (_, ordinal) => {
        const id = `caller-${Math.floor(ordinal / appendsPerWorker)}-${ordinal % appendsPerWorker}`;
        const empty = JSON.stringify({ id, payload: "" });
        const line = JSON.stringify({
          id,
          payload: "x".repeat(lineBytes - Buffer.byteLength(empty))
        });
        assert.equal(Buffer.byteLength(line), lineBytes);
        return line;
      });

      await Promise.all(
        Array.from({ length: workers }, async (_, worker) => {
          for (let index = 0; index < appendsPerWorker; index += 1) {
            await appendJsonlLine(
              appendPath,
              expected[worker * appendsPerWorker + index] as string,
              fsync
            );
          }
        })
      );

      const raw = await readFile(appendPath, "utf8");
      assert.equal(Buffer.byteLength(raw), expected.length * (lineBytes + 1));
      assert.ok(raw.endsWith("\n"));
      const actual = raw.slice(0, -1).split("\n");
      assert.equal(actual.length, expected.length);
      assert.ok(actual.every((line) => Buffer.byteLength(line) === lineBytes));
      assert.deepEqual(new Set(actual), new Set(expected));
    }
  });
});

test("readJsonlObjects fails closed on a corrupt mid-file line", async () => {
  await withTempFile(async (path) => {
    await writeFile(path, '{"first":true}\nNOT JSON\n{"last":true}\n', "utf8");
    const injected = new Error("injected corruption");
    let corruptLine: number | undefined;
    await assert.rejects(
      () =>
        readJsonlObjects(path, (lineNumber) => {
          corruptLine = lineNumber;
          return injected;
        }),
      (error) => error === injected
    );
    assert.equal(corruptLine, 2);
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


test("readJsonlObjects truncates at real byte offset with leading blank lines", async () => {
  await withTempFile(async (path) => {
    // Heidi repro: leading blanks + complete JSON + truncated tail must not
    // recompute keepBytes by rejoining parsed lines (which drops blank bytes).
    await writeFile(path, Buffer.from('\n\n{"ok":1}\n{"partial', "utf8"));
    const read = await readJsonlObjects(path, (lineNumber) => new Error(`corrupt ${lineNumber}`), {
      repair: true
    });
    assert.deepEqual(read.values, [{ ok: 1 }]);
    assert.equal(read.recovery.incompleteLine, '{"partial');
    assert.equal(await readFile(path, "utf8"), '\n\n{"ok":1}\n');
    await appendJsonlLine(path, JSON.stringify({ n: 2 }), false);
    const again = await readJsonlObjects(
      path,
      (lineNumber) => new Error(`JSONL_AFTER_ERROR corrupt line ${lineNumber}`)
    );
    assert.deepEqual(again.values, [{ ok: 1 }, { n: 2 }]);
    assert.deepEqual(again.recovery, {});
  });
});

test("readJsonlObjects preserves middle blank lines when repairing a truncated tail", async () => {
  await withTempFile(async (path) => {
    await writeFile(path, Buffer.from('{"a":1}\n\n{"b":2}\n{"partial', "utf8"));
    const read = await readJsonlObjects(path, (lineNumber) => new Error(`corrupt ${lineNumber}`), {
      repair: true
    });
    assert.deepEqual(read.values, [{ a: 1 }, { b: 2 }]);
    assert.equal(await readFile(path, "utf8"), '{"a":1}\n\n{"b":2}\n');
  });
});

test("readJsonlObjects repairs CRLF logs using real byte offsets", async () => {
  await withTempFile(async (path) => {
    await writeFile(path, Buffer.from('{"ok":true}\r\n{"partial', "utf8"));
    const read = await readJsonlObjects(path, (lineNumber) => new Error(`corrupt ${lineNumber}`), {
      repair: true
    });
    assert.deepEqual(read.values, [{ ok: true }]);
    assert.equal(await readFile(path, "utf8"), '{"ok":true}\r\n');
  });
});

test("readJsonlObjects keeps multibyte UTF-8 prefix bytes when truncating", async () => {
  await withTempFile(async (path) => {
    const prefix = '{"msg":"你好"}\n';
    await writeFile(path, Buffer.from(`${prefix}{"partial`, "utf8"));
    const read = await readJsonlObjects(path, (lineNumber) => new Error(`corrupt ${lineNumber}`), {
      repair: true
    });
    assert.deepEqual(read.values, [{ msg: "你好" }]);
    assert.equal(await readFile(path, "utf8"), prefix);
    assert.equal(Buffer.byteLength(await readFile(path), "utf8"), Buffer.byteLength(prefix, "utf8"));
  });
});

test("readJsonlObjects does not truncate by default (follow-safe)", async () => {
  await withTempFile(async (path) => {
    const original = '\n\n{"ok":1}\n{"partial';
    await writeFile(path, Buffer.from(original, "utf8"));
    const read = await readJsonlObjects(path, (lineNumber) => new Error(`corrupt ${lineNumber}`));
    assert.deepEqual(read.values, [{ ok: 1 }]);
    assert.equal(read.recovery.incompleteLine, '{"partial');
    assert.equal(await readFile(path, "utf8"), original);
  });
});
