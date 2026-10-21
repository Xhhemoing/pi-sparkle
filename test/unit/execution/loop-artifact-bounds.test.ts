import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readLoopArtifact, runEventsPath, saveLoopArtifact, type LoopArtifactReadOptions } from "../../../src/execution/loop-artifact.js";
import { EventStore, runLockPath } from "../../../src/run/event-store.js";
import { makeEvent, makeRun } from "../../helpers/event-factory.js";

type Bounds = LoopArtifactReadOptions;
const boundedRead = readLoopArtifact;
const defaults = () => ({ maxBytes: 512 * 1024, eventLogLimits: { maxBytes: 2 * 1024 * 1024, maxRecords: 10_000 } });

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await fs.mkdtemp(path.join(tmpdir(), "artifact-bounds-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const run = makeRun();
  const store = new EventStore(root, run.id);
  await store.append(makeEvent("RUN_CREATED", { run }, { runId: run.id }));
  const body = { value: "private content" };
  const artifact = await saveLoopArtifact({ stateRoot: root, runId: run.id, body });
  return { root, run, store, body, artifact };
}

test("bounded artifact read enforces artifact bytes and preserves the exact boundary and legacy default", async (t) => {
  const { root, run, body, artifact } = await fixture(t);
  await assert.rejects(boundedRead(root, run.id, artifact.id, { ...defaults(), maxBytes: artifact.byteLength - 1 }), /byte.*limit|maxBytes|exceeds/i);
  assert.deepEqual(await boundedRead(root, run.id, artifact.id, { ...defaults(), maxBytes: artifact.byteLength }), body);
  assert.deepEqual(await readLoopArtifact(root, run.id, artifact.id), body);
});

test("bounded artifact read enforces event-log byte and record caps", async (t) => {
  const { root, run, store, artifact } = await fixture(t);
  const eventSize = (await fs.stat(runEventsPath(root, run.id))).size;
  await assert.rejects(boundedRead(root, run.id, artifact.id,
    { ...defaults(), eventLogLimits: { maxBytes: eventSize - 1, maxRecords: 10 } }), /maxBytes|limit/i);
  await store.append(makeEvent("RUN_STARTED", {}, { runId: run.id }));
  await assert.rejects(boundedRead(root, run.id, artifact.id,
    { ...defaults(), eventLogLimits: { maxBytes: eventSize * 2, maxRecords: 1 } }), /maxRecords|limit/i);
});

test("bounded artifact options reject invalid or accessor values before filesystem work", async (t) => {
  const { root, run, artifact } = await fixture(t);
  for (const value of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(boundedRead(root, run.id, artifact.id, { ...defaults(), maxBytes: value }), /limit|maxBytes|options/i);
    await assert.rejects(boundedRead(root, run.id, artifact.id,
      { ...defaults(), eventLogLimits: { maxBytes: 10000, maxRecords: value } }), /limit|maxRecords|options/i);
  }
  for (const value of [null, {}, { maxBytes: 1 }, { ...defaults(), extra: true }, { ...defaults(), eventLogLimits: {} }]) {
    await assert.rejects(boundedRead(root, run.id, artifact.id, value as Bounds), /limit|options/i);
  }
  let invoked = false;
  const accessor = { ...defaults(), get maxBytes() { invoked = true; return 10000; } };
  await assert.rejects(boundedRead(root, run.id, artifact.id, accessor), /options|ordinary/i);
  assert.equal(invoked, false);
});

test("bounded options are snapshotted before filesystem awaits despite a held run lock", async (t) => {
  const { root, run, artifact } = await fixture(t);
  const lock = runLockPath(root, run.id);
  await fs.writeFile(lock, "held");
  const bounds = { ...defaults(), maxBytes: artifact.byteLength - 1 };
  const reading = boundedRead(root, run.id, artifact.id, bounds);
  const rejected = assert.rejects(reading, /byte.*limit|maxBytes|exceeds/i);
  bounds.maxBytes = 1_000_000;
  bounds.eventLogLimits.maxBytes = 1_000_000;
  await fs.rm(lock);
  await rejected;
});

for (const target of ["artifact", "event log"] as const) {
  test(`bounded reader refuses a symbolic ${target} link`, { skip: process.platform === "win32" }, async (t) => {
    const { root, run, artifact } = await fixture(t);
    const file = target === "artifact" ? artifact.path : runEventsPath(root, run.id);
    const original = `${file}.original`;
    await fs.rename(file, original);
    await fs.symlink(original, file);
    await assert.rejects(boundedRead(root, run.id, artifact.id, defaults()), /link|regular/i);
  });
  test(`bounded reader refuses a multiply linked ${target}`, async (t) => {
    const { root, run, artifact } = await fixture(t);
    const file = target === "artifact" ? artifact.path : runEventsPath(root, run.id);
    await fs.link(file, `${file}.hardlink`);
    await assert.rejects(boundedRead(root, run.id, artifact.id, defaults()), /link|regular/i);
  });
}

test("bounded reader refuses linked parent directories", { skip: process.platform === "win32" }, async (t) => {
  const { root, run, artifact } = await fixture(t);
  const directory = path.dirname(artifact.path);
  await fs.rename(directory, `${directory}.original`);
  await fs.symlink(`${directory}.original`, directory, "dir");
  await assert.rejects(boundedRead(root, run.id, artifact.id, defaults()), /parent|directory|link/i);
});

test("bounded reader refuses special artifact files without opening a blocking reader", { skip: process.platform === "win32" }, async (t) => {
  const { root, run, artifact } = await fixture(t);
  await fs.rm(artifact.path);
  const result = spawnSync("mkfifo", [artifact.path], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  // Keep the FIFO owned by this parent fixture. A regression that opens it
  // with blocking flags must fail within a hard deadline, not hang the suite.
  const moduleUrl = new URL("../../../src/execution/loop-artifact.ts", import.meta.url).href;
  const script = `import { readLoopArtifact } from ${JSON.stringify(moduleUrl)};
    try {
      await readLoopArtifact(process.argv[1], process.argv[2], process.argv[3], ${JSON.stringify(defaults())});
      process.exitCode = 1;
    } catch (error) {
      if (!/regular|special/i.test(String(error?.message))) process.exitCode = 2;
    }`;
  const child = spawnSync(process.execPath,
    ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", script, root, run.id, artifact.id],
    { encoding: "utf8", timeout: 5000, killSignal: "SIGKILL", maxBuffer: 8192, windowsHide: true });
  assert.equal(child.status, 0, child.error?.message ?? child.stderr);
});

test("bounded read preserves initialized-run identity and nonmutating torn-tail policy", async (t) => {
  const { root, run, artifact, body } = await fixture(t);
  const events = runEventsPath(root, run.id);
  await fs.appendFile(events, '{"torn":');
  const before = await fs.readFile(events);
  assert.deepEqual(await boundedRead(root, run.id, artifact.id, defaults()), body);
  assert.deepEqual(await fs.readFile(events), before);
  await fs.writeFile(events, "");
  await assert.rejects(boundedRead(root, run.id, artifact.id, defaults()), /empty|RUN_CREATED/i);
  await fs.writeFile(events, `${JSON.stringify(makeEvent("RUN_STARTED", {}, { runId: run.id }))}\n`);
  await assert.rejects(boundedRead(root, run.id, artifact.id, defaults()), /RUN_CREATED/i);
});

test("bounded reader rejects an artifact replaced while its descriptor is read", async (t) => {
  const { root, run, artifact } = await fixture(t);
  const openOriginal = fs.open;
  let replaced = false;
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await openOriginal(...args);
    if (String(args[0]) === artifact.path) {
      const readOriginal = handle.read;
      t.mock.method(handle, "read", async (...readArgs: unknown[]) => {
        const value: unknown = await Reflect.apply(readOriginal, handle, readArgs);
        if (!replaced) {
          replaced = true;
          await fs.rename(artifact.path, `${artifact.path}.original`);
          await fs.copyFile(`${artifact.path}.original`, artifact.path);
        }
        return value;
      });
    }
    return handle;
  });
  syncBuiltinESMExports();
  t.after(async () => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  await assert.rejects(boundedRead(root, run.id, artifact.id, defaults()), /changed|identity|unstable/i);
});
