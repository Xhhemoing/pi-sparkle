#!/usr/bin/env node
/**
 * Diagnostic probe for invocation-log lock contention.
 *
 * The held-lock case intentionally keeps the lock through both equal timeout
 * windows, documenting the accepted telemetry drop after the single retry.
 * The live run remains higher priority than this telemetry row.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { tsImport } from "tsx/esm/api";

const RETRIES = 1;
const LOCK_TIMEOUT_MS = 25;
const LOCK_RETRY_MS = 2;
const CONTENDED_APPENDS = 32;

function invocation(suffix) {
  return {
    id: `inv_probe_${suffix}`,
    taskId: `tsk_probe_${suffix}`,
    runId: `run_probe_${suffix}`,
    agentInstanceId: `agt_probe_${suffix}`,
    config: {
      provider: "probe",
      model: "probe-model",
      modelVersion: "probe-v1",
      parameterHash: "1234abcd"
    },
    responseHash: "5678efab",
    tokensIn: 120,
    tokensOut: 24,
    latencyMs: 50,
    occurredAt: "2026-08-24T00:00:00.000Z",
    callOutcome: "ok"
  };
}

function milliseconds(value) {
  return Number(value.toFixed(3));
}

let stateRoot;
try {
  const { appendInvocationRecord, readInvocationRecords, withInvocationLogLock } = await tsImport(
    "../src/telemetry/invocation-log.ts",
    import.meta.url
  );

  stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-invocation-lock-"));
  const heldRecord = invocation("held");
  let heldError;
  const heldStartedAt = performance.now();
  await withInvocationLogLock(stateRoot, async () => {
    heldError = await appendInvocationRecord(stateRoot, heldRecord, {
      timeoutMs: LOCK_TIMEOUT_MS,
      retryMs: LOCK_RETRY_MS
    }).then(
      () => undefined,
      (error) => error
    );
  });
  const heldAppendMs = performance.now() - heldStartedAt;

  if (!(heldError instanceof Error) || !heldError.message.includes("timed out waiting for lock")) {
    throw new Error("held-lock append did not end in the expected lock-timeout drop");
  }
  if (heldAppendMs < LOCK_TIMEOUT_MS * (RETRIES + 1) - LOCK_RETRY_MS) {
    throw new Error(
      `held-lock append ended before both timeout windows elapsed (${milliseconds(heldAppendMs)}ms)`
    );
  }

  const records = Array.from({ length: CONTENDED_APPENDS }, (_, index) =>
    invocation(`contended_${String(index).padStart(2, "0")}`)
  );
  const contendedStartedAt = performance.now();
  await Promise.all(records.map((record) => appendInvocationRecord(stateRoot, record)));
  const contendedAppendMs = performance.now() - contendedStartedAt;

  const { values } = await readInvocationRecords(stateRoot);
  const ids = new Set(
    values.flatMap((value) =>
      value !== null && typeof value === "object" && "id" in value && typeof value.id === "string"
        ? [value.id]
        : []
    )
  );
  const landed = records.filter((record) => ids.has(record.id)).length;
  const dropped = ids.has(heldRecord.id) ? 0 : 1;
  if (landed !== CONTENDED_APPENDS) {
    throw new Error(`expected ${CONTENDED_APPENDS} contended rows, found ${landed}`);
  }
  if (dropped !== 1) {
    throw new Error("held-lock row landed while the parent still held the lock");
  }

  process.stdout.write(
    `${JSON.stringify({
      retries: RETRIES,
      dropped,
      landed,
      contendedAppendMs: milliseconds(contendedAppendMs),
      contendedAppends: CONTENDED_APPENDS,
      lockTimeoutMs: LOCK_TIMEOUT_MS,
      heldAppendMs: milliseconds(heldAppendMs),
      ok: true
    })}\n`
  );
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      retries: RETRIES,
      dropped: 0,
      landed: 0,
      contendedAppendMs: 0,
      contendedAppends: CONTENDED_APPENDS,
      lockTimeoutMs: LOCK_TIMEOUT_MS,
      heldAppendMs: 0,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })}\n`
  );
  process.exitCode = 1;
} finally {
  if (stateRoot !== undefined) {
    await rm(stateRoot, { recursive: true, force: true });
  }
}
