#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { tsImport } from "tsx/esm/api";

const SAMPLES = 1_000;
const LOCK_WORKERS = 4;

async function measure(operation) {
  const startedAt = performance.now();
  await operation();
  return performance.now() - startedAt;
}

function milliseconds(value) {
  return Number(value.toFixed(3));
}

let dir;
try {
  const { appendJsonlLine, readJsonlObjects } = await tsImport(
    "../src/persist/jsonl.ts",
    import.meta.url
  );
  const { withExclusiveFileLock } = await tsImport(
    "../src/persist/file-lock.ts",
    import.meta.url
  );

  dir = await mkdtemp(join(tmpdir(), "pi-sparkle-runtime-bench-"));
  const jsonlPath = join(dir, "events.jsonl");
  const jsonlAppendMs = await measure(async () => {
    for (let index = 0; index < SAMPLES; index += 1) {
      await appendJsonlLine(jsonlPath, JSON.stringify({ index, ok: true }), false);
    }
  });

  let values;
  const jsonlReadMs = await measure(async () => {
    const read = await readJsonlObjects(
      jsonlPath,
      (lineNumber) => new Error(`corrupt benchmark JSONL at line ${lineNumber}`)
    );
    values = read.values;
  });
  if (values?.length !== SAMPLES) {
    throw new Error(`expected ${SAMPLES} JSONL objects, read ${values?.length ?? 0}`);
  }

  const serialLockPath = join(dir, "serial.lock");
  let serialOperations = 0;
  const lockSerialMs = await measure(async () => {
    for (let index = 0; index < SAMPLES; index += 1) {
      await withExclusiveFileLock(serialLockPath, async () => {
        serialOperations += 1;
      });
    }
  });

  const contendedLockPath = join(dir, "contended.lock");
  let contendedOperations = 0;
  const lockContendedMs = await measure(async () => {
    await Promise.all(
      Array.from({ length: LOCK_WORKERS }, async (_, worker) => {
        for (let index = worker; index < SAMPLES; index += LOCK_WORKERS) {
          await withExclusiveFileLock(
            contendedLockPath,
            async () => {
              contendedOperations += 1;
              await Promise.resolve();
            },
            { timeoutMs: 30_000, retryMs: 1 }
          );
        }
      })
    );
  });
  if (serialOperations !== SAMPLES || contendedOperations !== SAMPLES) {
    throw new Error(
      `lock operation count mismatch: serial=${serialOperations}, contended=${contendedOperations}`
    );
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      samples: SAMPLES,
      jsonlAppendMs: milliseconds(jsonlAppendMs),
      jsonlReadMs: milliseconds(jsonlReadMs),
      lockSerialMs: milliseconds(lockSerialMs),
      lockContendedMs: milliseconds(lockContendedMs)
    })}\n`
  );
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      samples: SAMPLES,
      jsonlAppendMs: null,
      jsonlReadMs: null,
      lockSerialMs: null,
      lockContendedMs: null,
      error: error instanceof Error ? error.message : String(error)
    })}\n`
  );
  process.exitCode = 1;
} finally {
  if (dir !== undefined) {
    await rm(dir, { recursive: true, force: true });
  }
}
