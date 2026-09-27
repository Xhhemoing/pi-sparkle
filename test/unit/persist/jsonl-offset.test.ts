import assert from "node:assert/strict";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { appendFile, mkdtemp, readFile, rm, truncate, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
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

async function measureReads(t: TestContext, file: string, operation: () => Promise<void>): Promise<number> {
  let bytes = 0;
  const originalOpen = fsPromises.open;
  const originalReadFile = fsPromises.readFile;
  const reads = t.mock.method(fsPromises, "readFile", async (...args: Parameters<typeof originalReadFile>) => {
    const result = await originalReadFile(...args);
    if (args[0] === file) bytes += Buffer.byteLength(result);
    return result;
  });
  const handles: { mock: { restore(): void } }[] = [];
  const opens = t.mock.method(fsPromises, "open", async (...args: Parameters<typeof originalOpen>) => {
    const handle = await originalOpen(...args);
    if (args[0] === file) {
      const read = handle.read;
      handles.push(t.mock.method(handle, "read", async (...params: Parameters<typeof read>) => {
        const result = await Reflect.apply(read, handle, params) as Awaited<ReturnType<typeof read>>;
        bytes += result.bytesRead;
        return result;
      }));
    }
    return handle;
  });
  syncBuiltinESMExports();
  try {
    await operation();
    return bytes;
  } finally {
    reads.mock.restore();
    opens.mock.restore();
    for (const handle of handles) handle.mock.restore();
    syncBuiltinESMExports();
  }
}

async function withReadInterception(
  t: TestContext,
  file: string,
  intercept: (handle: FileHandle, read: FileHandle["read"], params: unknown[]) => Promise<unknown>,
  operation: () => Promise<void>,
  wholeFileHooks: { before?: () => Promise<void>; after?: () => Promise<void> } = {}
): Promise<void> {
  const originalOpen = fsPromises.open;
  const originalReadFile = fsPromises.readFile;
  const reads = t.mock.method(fsPromises, "readFile", async (...args: Parameters<typeof originalReadFile>) => {
    if (args[0] === file) await wholeFileHooks.before?.();
    const result = await originalReadFile(...args);
    if (args[0] === file) await wholeFileHooks.after?.();
    return result;
  });
  const handles: { mock: { restore(): void } }[] = [];
  const opens = t.mock.method(fsPromises, "open", async (...args: Parameters<typeof originalOpen>) => {
    const handle = await originalOpen(...args);
    if (args[0] === file) {
      const read = handle.read;
      handles.push(t.mock.method(handle, "read", (async (...params: unknown[]) =>
        intercept(handle, read, params)) as FileHandle["read"]));
    }
    return handle;
  });
  syncBuiltinESMExports();
  try {
    await operation();
  } finally {
    opens.mock.restore();
    reads.mock.restore();
    for (const handle of handles) handle.mock.restore();
    syncBuiltinESMExports();
  }
}

test("append separates a valid final JSON record without a newline", async () => {
  await withTempFile(async (path) => {
    await writeFile(path, '{"first":"中文🙂"}', "utf8");
    await appendJsonlLine(path, '{"second":2}', true);
    assert.equal(await readFile(path, "utf8"), '{"first":"中文🙂"}\n{"second":2}\n');
    assert.deepEqual((await readJsonlObjects(path, (line) => new Error(`corrupt ${line}`))).values,
      [{ first: "中文🙂" }, { second: 2 }]);
  });
});

for (const count of [100, 1000, 10000]) {
  test(`healthy append uses bounded I/O with ${count} prefix records`, async (t) => {
    await withTempFile(async (path) => {
      const prefix = '{"value":"中文🙂"}\r\n'.repeat(count);
      const suffix = '{"last":true}\n';
      await writeFile(path, prefix, "utf8");
      const appendBytes = await measureReads(t, path, () => appendJsonlLine(path, suffix.trim(), false));
      t.diagnostic(`prefixRecords=${count}; appendReadBytes=${appendBytes}`);
      assert.ok(appendBytes <= 1, `healthy append read ${appendBytes} bytes`);
    });
  });
  test(`offset reads use bounded I/O with ${count} prefix records`, async (t) => {
    await withTempFile(async (path) => {
      const prefix = '{"value":"中文🙂"}\r\n'.repeat(count);
      const suffix = '{"last":true}\n';
      await writeFile(path, prefix + suffix, "utf8");
      const tailBytes = await measureReads(t, path, async () => {
        const result = await readJsonlObjectsFromOffset(path, Buffer.byteLength(prefix), (line) => new Error(`corrupt ${line}`));
        assert.deepEqual(result.values, [{ last: true }]);
        assert.equal(result.completeByteLength, Buffer.byteLength(prefix + suffix));
      });
      t.diagnostic(`prefixRecords=${count}; offsetReadBytes=${tailBytes}`);
      assert.ok(tailBytes <= Buffer.byteLength(suffix) + 1, `offset reader read ${tailBytes} bytes`);
    });
  });
}

test("torn tail repair scans bounded chunks without rereading the healthy prefix", async (t) => {
  await withTempFile(async (path) => {
    const prefix = '{"value":"中文🙂"}\r\n'.repeat(10000) + "\r\n";
    const torn = '{"partial":"' + "🙂".repeat(2500);
    await writeFile(path, prefix + torn, "utf8");
    const bytes = await measureReads(t, path, () => appendJsonlLine(path, '{"last":true}', false));
    assert.equal(await readFile(path, "utf8"), prefix + '{"last":true}\n');
    t.diagnostic(`tornTailBytes=${Buffer.byteLength(torn)}; repairReadBytes=${bytes}`);
    assert.ok(bytes <= Buffer.byteLength(torn) + 4097, `tail repair read ${bytes} bytes`);
  });
});

test("absolute recovery line numbers include CRLF and blank prefix lines", async () => {
  await withTempFile(async (path) => {
    const prefix = '\r\n{"msg":"中文🙂"}\r\n\n';
    const original = prefix + '{"last":true}\n\n{"partial';
    await writeFile(path, original, "utf8");
    const result = await readJsonlObjectsFromOffset(path, Buffer.byteLength(prefix), (line) => new Error(`corrupt ${line}`));
    assert.deepEqual(result.values, [{ last: true }]);
    assert.deepEqual(result.recovery, { incompleteLine: '{"partial', lineNumber: 6 });
    assert.equal(result.completeByteLength, Buffer.byteLength(prefix + '{"last":true}\n'));
    assert.equal(await readFile(path, "utf8"), original);
  });
});

test("offset reads assemble short reads without splitting UTF-8 records", async (t) => {
  await withTempFile(async (path) => {
    const prefix = '{"first":1}\r\n';
    const suffix = '{"msg":"中文🙂"}\r\n\n{"last":true}';
    await writeFile(path, prefix + suffix, "utf8");
    await withReadInterception(t, path, async (handle, read, params) => {
      params[2] = Math.min(params[2] as number, 2);
      return Reflect.apply(read, handle, params);
    }, async () => {
      const result = await readJsonlObjectsFromOffset(path, Buffer.byteLength(prefix), (line) => new Error(`corrupt ${line}`));
      assert.deepEqual(result.values, [{ msg: "中文🙂" }, { last: true }]);
      assert.equal(result.completeByteLength, Buffer.byteLength(prefix + suffix));
    });
  });
});

test("offset reads stop at captured EOF when the file grows during reading", async (t) => {
  await withTempFile(async (path) => {
    const prefix = '{"first":1}\n';
    const original = prefix + '{"second":2}\n';
    await writeFile(path, original, "utf8");
    let grown = false;
    const grow = async (): Promise<void> => {
      if (!grown) {
        grown = true;
        await appendFile(path, '{"third":3}\n', "utf8");
      }
    };
    await withReadInterception(t, path, async (handle, read, params) => {
      await grow();
      return Reflect.apply(read, handle, params);
    }, async () => {
      const result = await readJsonlObjectsFromOffset(path, Buffer.byteLength(prefix), (line) => new Error(`corrupt ${line}`));
      assert.deepEqual(result.values, [{ second: 2 }]);
      assert.equal(result.completeByteLength, Buffer.byteLength(original));
    }, { before: grow });
    assert.equal(await readFile(path, "utf8"), original + '{"third":3}\n');
  });
});

test("truncation during an offset read reports an offset beyond the new EOF", async (t) => {
  await withTempFile(async (path) => {
    const prefix = '{"first":1}\n';
    await writeFile(path, prefix + '{"second":2}\n', "utf8");
    let truncated = false;
    const shrink = async (): Promise<void> => {
      if (!truncated) {
        truncated = true;
        await truncate(path, 0);
      }
    };
    await withReadInterception(t, path, async (handle, read, params) => {
      await shrink();
      return Reflect.apply(read, handle, params);
    }, async () => {
      const result = await readJsonlObjectsFromOffset(path, Buffer.byteLength(prefix), (line) => new Error(`corrupt ${line}`));
      assert.equal(result.unsafe, "offset-beyond-eof");
      assert.equal(result.completeByteLength, 0);
      assert.deepEqual(result.values, []);
    }, { before: shrink });
  });
});

test("repair refuses growth after a torn tail was read and preserves new bytes", async (t) => {
  await withTempFile(async (path) => {
    const original = '{"first":1}\n{"second":';
    await writeFile(path, original, "utf8");
    let grown = false;
    const grow = async (): Promise<void> => {
      if (!grown) {
        grown = true;
        await appendFile(path, '2}\n', "utf8");
      }
    };
    await withReadInterception(t, path, async (handle, read, params) => {
      const result = await Reflect.apply(read, handle, params) as Awaited<ReturnType<FileHandle["read"]>>;
      await grow();
      return result;
    }, async () => {
      await assert.rejects(() => readJsonlObjects(path, (line) => new Error(`corrupt ${line}`), { repair: true }), /changed/i);
    }, { after: grow });
    assert.equal(await readFile(path, "utf8"), original + '2}\n');
  });
});

test("append scans a complete multibyte tail across chunk boundaries and short reads", async (t) => {
  await withTempFile(async (path) => {
    const prefix = '\r\n{"first":1}\r\n\n';
    const complete = JSON.stringify({ msg: "中文🙂".repeat(900) });
    await writeFile(path, prefix + complete, "utf8");
    await withReadInterception(t, path, async (handle, read, params) => {
      params[2] = Math.min(params[2] as number, 127);
      return Reflect.apply(read, handle, params);
    }, () => appendJsonlLine(path, '{"last":true}', true));
    assert.equal(await readFile(path, "utf8"), prefix + complete + '\n{"last":true}\n');
  });
});

test("append refuses a shortened tail without extending the file", async (t) => {
  await withTempFile(async (path) => {
    const prefix = '{"first":1}\n';
    await writeFile(path, prefix + '{"partial', "utf8");
    let shortened = false;
    const shrink = async (): Promise<void> => {
      if (!shortened) {
        shortened = true;
        await truncate(path, Buffer.byteLength(prefix));
      }
    };
    await withReadInterception(t, path, async (handle, read, params) => {
      await shrink();
      return Reflect.apply(read, handle, params);
    }, async () => {
      await assert.rejects(() => appendJsonlLine(path, '{"last":true}', false), /changed/i);
    }, { after: shrink });
    assert.equal(await readFile(path, "utf8"), prefix);
  });
});

test("offset corruption counts a long prefix in bounded chunks only for diagnostics", async (t) => {
  await withTempFile(async (path) => {
    const prefix = '\r\n{"msg":"中文🙂"}\n'.repeat(10000);
    const suffix = 'NOT JSON\n{"last":true}\n';
    await writeFile(path, prefix + suffix, "utf8");
    const bytes = await measureReads(t, path, async () => {
      await withReadInterception(t, path, async (handle, read, params) => {
        assert.ok((params[2] as number) <= 64 * 1024, "diagnostic reads must stay in bounded chunks");
        return Reflect.apply(read, handle, params);
      }, async () => {
        await assert.rejects(() => readJsonlObjectsFromOffset(path, Buffer.byteLength(prefix), (line) => new Error(`corrupt ${line}`)), /corrupt 20001/);
      });
    });
    assert.ok(bytes <= Buffer.byteLength(prefix + suffix) + 1, `diagnostics reread ${bytes} bytes`);
  });
});

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

test("bounded reads with a non-zero offset fail closed instead of misreading a tail buffer", async () => {
  await withTempFile(async (path) => {
    const first = `${JSON.stringify({ n: 1 })}\n`;
    await writeFile(path, `${first}${JSON.stringify({ n: 2 })}\n`);
    const offset = Buffer.byteLength(first, "utf8");
    await assert.rejects(
      () => readJsonlObjectsFromOffset(path, offset, (line) => new Error(`corrupt ${line}`), { maxBytes: 1024 }),
      /bounded JSONL reads require byteOffset 0/
    );
  });
});
