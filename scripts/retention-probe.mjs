#!/usr/bin/env node
/**
 * Diagnostic sizing probe only; it is intentionally not a CI gate.
 *
 * Q3 accepted that invocation and episode retention is currently unbounded.
 * This probe makes the resulting on-disk growth measurable without treating
 * `unbounded: true` as a failure.
 */
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const SAMPLE_RUNS = 32;

function parseStateRoot(args) {
  if (args.length === 0) return undefined;
  if (args.length === 2 && args[0] === "--state-root" && args[1].trim() !== "") {
    return args[1];
  }
  throw new Error("usage: node scripts/retention-probe.mjs [--state-root <dir>]");
}

function invocation(index) {
  const suffix = String(index).padStart(4, "0");
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
    tokensIn: 1_200,
    tokensOut: 240,
    latencyMs: 850,
    occurredAt: "2026-08-24T00:00:00.000Z",
    attempt: 1,
    cacheHit: false,
    callOutcome: "ok"
  };
}

function episode(index) {
  const suffix = String(index).padStart(4, "0");
  return {
    id: `ep_probe_${suffix}`,
    projectId: "prj_retention_probe",
    objective: "Representative retained episode record for estimating unbounded state growth.",
    contractVersion: 1,
    runIds: [`run_probe_${suffix}`],
    startedAt: "2026-08-24T00:00:00.000Z",
    closedAt: "2026-08-24T00:01:00.000Z",
    status: "COMPLETED",
    acceptance: [
      {
        id: "probe",
        description: "Measure retained state",
        observableCheck: "record is present"
      }
    ],
    evidenceRefs: ["evd_probe"]
  };
}

async function createSampleStateRoot() {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-retention-"));
  const runtime = join(stateRoot, "runtime");
  const episodes = join(runtime, "episodes");
  const runs = join(runtime, "runs");
  await mkdir(episodes, { recursive: true });
  await mkdir(runs, { recursive: true });

  const invocationLines = [];
  for (let index = 0; index < SAMPLE_RUNS; index += 1) {
    const suffix = String(index).padStart(4, "0");
    invocationLines.push(JSON.stringify(invocation(index)));
    await mkdir(join(runs, `run_probe_${suffix}`));
    await writeFile(join(episodes, `ep_probe_${suffix}.jsonl`), `${JSON.stringify(episode(index))}\n`);
  }
  await writeFile(join(runtime, "invocations.jsonl"), `${invocationLines.join("\n")}\n`);
  return stateRoot;
}

async function summarize(directory) {
  let files = 0;
  let bytes = 0;
  let episodeFiles = 0;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await summarize(path);
      files += nested.files;
      bytes += nested.bytes;
      episodeFiles += nested.episodeFiles;
    } else if (entry.isFile()) {
      files += 1;
      bytes += (await stat(path)).size;
      if (
        basename(dirname(path)) === "episodes" &&
        entry.name.endsWith(".jsonl") &&
        !entry.name.endsWith(".events.jsonl")
      ) {
        episodeFiles += 1;
      }
    }
  }
  return { files, bytes, episodeFiles };
}

async function countRunDirectories(stateRoot) {
  for (const runsPath of [join(stateRoot, "runtime", "runs"), join(stateRoot, "runs")]) {
    try {
      const entries = await readdir(runsPath, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).length;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return 0;
}

let temporaryStateRoot;
try {
  const requestedStateRoot = parseStateRoot(process.argv.slice(2));
  temporaryStateRoot = requestedStateRoot === undefined ? await createSampleStateRoot() : undefined;
  const stateRoot = requestedStateRoot ?? temporaryStateRoot;
  const summary = await summarize(stateRoot);
  const runCount = Math.max(await countRunDirectories(stateRoot), summary.episodeFiles);
  const perRunEstimateBytes =
    summary.files === 0 ? 0 : Math.ceil(summary.bytes / Math.max(runCount, 1));

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      files: summary.files,
      bytes: summary.bytes,
      perRunEstimateBytes,
      unbounded: true
    })}\n`
  );
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      files: 0,
      bytes: 0,
      perRunEstimateBytes: 0,
      unbounded: true,
      error: error instanceof Error ? error.message : String(error)
    })}\n`
  );
  process.exitCode = 1;
} finally {
  if (temporaryStateRoot !== undefined) {
    await rm(temporaryStateRoot, { recursive: true, force: true });
  }
}
