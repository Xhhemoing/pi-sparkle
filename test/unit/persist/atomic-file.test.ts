import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { writeFileAtomic } from "../../../src/persist/atomic-file.js";

async function withTempDir(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "pi-sparkle-atomic-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function tempFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory);
  return entries.filter((entry) => entry.endsWith(".tmp")).toSorted();
}

function codedError(code: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(`simulated ${code}`);
  error.code = code;
  return error;
}

/** A payload large enough that a torn write would land mid-string rather than at a boundary. */
function payload(writer: number): string {
  return `${JSON.stringify({ writer, filler: String(writer).repeat(200_000) }, null, 2)}\n`;
}

test("writeFileAtomic creates missing directories and publishes the exact bytes", async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, "nested", "deeper", "value.json");
    await writeFileAtomic(path, '{"a":1}\n');
    assert.equal(await readFile(path, "utf8"), '{"a":1}\n');
    assert.deepEqual(await tempFiles(join(directory, "nested", "deeper")), []);

    await writeFileAtomic(path, '{"a":2}\n');
    assert.equal(await readFile(path, "utf8"), '{"a":2}\n');
    assert.deepEqual(await tempFiles(join(directory, "nested", "deeper")), []);
  });
});

test("concurrent writers publish one complete payload and never a torn hybrid", async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, "contended.json");
    const writers = 8;
    const payloads = Array.from({ length: writers }, (_unused, writer) => payload(writer));

    let writing = true;
    let allWritesLanded = false;
    let readerError: unknown;
    const observations: string[] = [];
    // Runs alongside the writers; the trailing condition guarantees at least one observation
    // on the success path without ever spinning when a write failed and no file exists.
    const reader = (async () => {
      while (writing || (allWritesLanded && observations.length === 0)) {
        try {
          observations.push(await readFile(path, "utf8"));
        } catch (error: unknown) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          readerError = error;
          return;
        }
      }
    })();

    try {
      await Promise.all(payloads.map((contents) => writeFileAtomic(path, contents)));
      allWritesLanded = true;
    } finally {
      writing = false;
      await reader;
    }

    assert.equal(readerError, undefined);
    assert.ok(observations.length > 0, "the concurrent reader never observed the file");
    // Every intermediate state a reader could see is one writer's whole payload, not a splice.
    for (const observed of observations) {
      assert.ok(payloads.includes(observed), "reader observed bytes no writer ever wrote");
    }
    const final = await readFile(path, "utf8");
    assert.ok(payloads.includes(final));
    const parsed = JSON.parse(final) as { writer: number; filler: string };
    assert.equal(parsed.filler, String(parsed.writer).repeat(200_000));
    assert.deepEqual(await tempFiles(directory), []);
  });
});

test("temp names are unique per write and namespaced by pid", async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, "unique.json");
    const observed: string[] = [];
    const recordingRename = async (source: string, destination: string): Promise<void> => {
      observed.push(source);
      await rename(source, destination);
    };

    await writeFileAtomic(path, "one\n", { rename: recordingRename });
    await writeFileAtomic(path, "two\n", { rename: recordingRename });

    assert.equal(observed.length, 2);
    assert.notEqual(observed[0], observed[1]);
    for (const temp of observed) {
      assert.ok(temp.startsWith(`${path}.${process.pid}.`), `unexpected temp name ${temp}`);
      assert.ok(temp.endsWith(".tmp"), `unexpected temp name ${temp}`);
    }
    assert.equal(await readFile(path, "utf8"), "two\n");
  });
});

test("stale temp files from crashed writers neither corrupt nor block the next write", async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, "stale.json");
    const legacyTemp = `${path}.tmp`;
    const newStyleTemp = `${path}.999999.abandoned.tmp`;
    await writeFile(legacyTemp, '{"torn": tru', "utf8");
    await writeFile(newStyleTemp, '{"also": "abandoned"', "utf8");

    await writeFileAtomic(path, '{"fresh":true}\n');

    assert.equal(await readFile(path, "utf8"), '{"fresh":true}\n');
    // Another writer's abandoned temp is left exactly as found: never adopted, never truncated.
    assert.equal(await readFile(legacyTemp, "utf8"), '{"torn": tru');
    assert.equal(await readFile(newStyleTemp, "utf8"), '{"also": "abandoned"');
    assert.deepEqual(await tempFiles(directory), [
      "stale.json.999999.abandoned.tmp",
      "stale.json.tmp"
    ]);
  });
});

test("a colliding temp name is retried with a fresh one instead of truncating it", async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, "collide.json");
    const occupied = `${path}.${process.pid}.taken.tmp`;
    await writeFile(occupied, "someone else is writing here", "utf8");

    const suffixes = ["taken", "free"];
    let next = 0;
    await writeFileAtomic(path, '{"ok":true}\n', {
      uniqueSuffix: () => suffixes[next++] ?? "exhausted"
    });

    assert.equal(next, 2);
    assert.equal(await readFile(path, "utf8"), '{"ok":true}\n');
    assert.equal(await readFile(occupied, "utf8"), "someone else is writing here");
  });
});

for (const code of ["EPERM", "EEXIST", "EACCES"]) {
  test(`rename failing with ${code} falls back to unlink-then-rename`, async () => {
    await withTempDir(async (directory) => {
      const path = join(directory, "fallback.json");
      await writeFileAtomic(path, '{"generation":1}\n');

      let attempts = 0;
      await writeFileAtomic(path, '{"generation":2}\n', {
        rename: async (source, destination) => {
          attempts += 1;
          if (attempts === 1) throw codedError(code);
          await rename(source, destination);
        }
      });

      assert.equal(attempts, 2);
      assert.equal(await readFile(path, "utf8"), '{"generation":2}\n');
      assert.deepEqual(await tempFiles(directory), []);
    });
  });
}

test("a rename failure outside the fallback set propagates and cleans up its own temp", async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, "hard-fail.json");
    await writeFileAtomic(path, '{"generation":1}\n');

    let attempts = 0;
    await assert.rejects(
      () =>
        writeFileAtomic(path, '{"generation":2}\n', {
          rename: async () => {
            attempts += 1;
            throw codedError("EXDEV");
          }
        }),
      { code: "EXDEV" }
    );

    assert.equal(attempts, 1);
    assert.equal(await readFile(path, "utf8"), '{"generation":1}\n');
    assert.deepEqual(await tempFiles(directory), []);
  });
});

test("a failing fallback rename still cleans up its own temp", async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, "fallback-fail.json");

    await assert.rejects(
      () =>
        writeFileAtomic(path, '{"generation":1}\n', {
          rename: async () => {
            throw codedError("EPERM");
          }
        }),
      { code: "EPERM" }
    );

    assert.deepEqual(await tempFiles(directory), []);
  });
});
