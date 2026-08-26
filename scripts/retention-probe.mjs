#!/usr/bin/env node
/**
 * Sizing probe for the two record classes whose growth used to be unbounded:
 * the shared `runtime/invocations.jsonl` and every episode under
 * `runtime/episodes/`.
 *
 * Q3 accepted that this retention was unbounded, and this probe reported
 * `unbounded: true` without failing because there was nothing to fail against.
 * `src/privacy/retention.ts` now sets a default age bound and `pi-sparkle
 * retain --apply` enforces it, so the probe reports `bounded: true` and, with
 * `--strict`, exits 1 when it finds records past that bound.
 *
 * The bound is read out of `retention.ts` rather than copied here, so the
 * number the probe checks against cannot drift from the number the runtime
 * enforces. A source file this cannot find the constant in is itself a
 * failure: a probe that silently invents a bound is worse than no probe.
 *
 * Default (no `--state-root`) it measures a synthetic sample instead of a real
 * install. The sample's records are dated relative to now, so the sample is
 * always inside the bound and `--strict` on it stays a check of the probe, not
 * of the calendar.
 */
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLE_RUNS = 32;
const MS_PER_DAY = 86_400_000;
const SAMPLE_AGE_DAYS = 1;
const RETENTION_SOURCE = fileURLToPath(new URL("../src/privacy/retention.ts", import.meta.url));

function parseArguments(args) {
  const usage = "usage: node scripts/retention-probe.mjs [--state-root <dir>] [--strict]";
  let stateRoot;
  let strict = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--strict") {
      strict = true;
      continue;
    }
    if (arg === "--state-root") {
      const value = args[index + 1];
      if (value === undefined || value.trim() === "") throw new Error(usage);
      stateRoot = value;
      index += 1;
      continue;
    }
    throw new Error(usage);
  }
  return { stateRoot, strict };
}

/** The enforced bound, read from the module that enforces it. */
async function readMaxAgeDays() {
  const source = await readFile(RETENTION_SOURCE, "utf8");
  const match = source.match(
    /DEFAULT_RETENTION_POLICY\s*:\s*RetentionPolicy\s*=\s*\{\s*maxAgeDays\s*:\s*(\d[\d_]*)\s*\}/
  );
  if (match === null) {
    throw new Error(
      `could not read DEFAULT_RETENTION_POLICY.maxAgeDays from ${RETENTION_SOURCE}; refusing to probe against a bound this script invented`
    );
  }
  return Number(match[1].replaceAll("_", ""));
}

function isoAgeDays(value, nowMs) {
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : (nowMs - parsed) / MS_PER_DAY;
}

function invocation(index, occurredAt) {
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
    occurredAt,
    attempt: 1,
    cacheHit: false,
    callOutcome: "ok"
  };
}

function episode(index, startedAt, closedAt) {
  const suffix = String(index).padStart(4, "0");
  return {
    id: `ep_probe_${suffix}`,
    projectId: "prj_retention_probe",
    objective: "Representative retained episode record for estimating state growth.",
    contractVersion: 1,
    runIds: [`run_probe_${suffix}`],
    startedAt,
    closedAt,
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

async function createSampleStateRoot(nowMs) {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-retention-"));
  const runtime = join(stateRoot, "runtime");
  const episodes = join(runtime, "episodes");
  const runs = join(runtime, "runs");
  await mkdir(episodes, { recursive: true });
  await mkdir(runs, { recursive: true });

  const startedAt = new Date(nowMs - SAMPLE_AGE_DAYS * MS_PER_DAY).toISOString();
  const closedAt = new Date(nowMs - SAMPLE_AGE_DAYS * MS_PER_DAY + 60_000).toISOString();
  const invocationLines = [];
  for (let index = 0; index < SAMPLE_RUNS; index += 1) {
    const suffix = String(index).padStart(4, "0");
    invocationLines.push(JSON.stringify(invocation(index, closedAt)));
    await mkdir(join(runs, `run_probe_${suffix}`));
    await writeFile(
      join(episodes, `ep_probe_${suffix}.jsonl`),
      `${JSON.stringify(episode(index, startedAt, closedAt))}\n`
    );
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

async function readLines(path) {
  try {
    const raw = await readFile(path, "utf8");
    return raw.split("\n").filter((line) => line.trim() !== "");
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return [];
    throw error;
  }
}

/**
 * Ages of the two bounded record classes, using the same rules
 * `planRetention` uses: an invocation ages from `occurredAt`, an episode from
 * the newest `closedAt ?? startedAt` on its records. A record whose age cannot
 * be established is held, never counted as expired — the probe does not report
 * a violation it cannot prove.
 */
async function measureAges(stateRoot, nowMs, maxAgeDays) {
  const ages = [];
  let held = 0;

  for (const runtime of [join(stateRoot, "runtime"), stateRoot]) {
    const lines = await readLines(join(runtime, "invocations.jsonl"));
    if (lines.length === 0) continue;
    for (const line of lines) {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        held += 1;
        continue;
      }
      const age = isoAgeDays(parsed?.occurredAt, nowMs);
      if (age === undefined) held += 1;
      else ages.push(age);
    }
    break;
  }

  for (const runtime of [join(stateRoot, "runtime"), stateRoot]) {
    const episodesDir = join(runtime, "episodes");
    let entries;
    try {
      entries = await readdir(episodesDir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") continue;
      throw error;
    }
    const newest = new Map();
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const id = entry.name.replace(/\.events\.jsonl$|\.jsonl$/, "");
      for (const line of await readLines(join(episodesDir, entry.name))) {
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        const shape = parsed?.episode ?? parsed;
        const age = isoAgeDays(shape?.closedAt, nowMs) ?? isoAgeDays(shape?.startedAt, nowMs);
        if (age === undefined) continue;
        const current = newest.get(id);
        if (current === undefined || age < current) newest.set(id, age);
      }
    }
    for (const age of newest.values()) ages.push(age);
    break;
  }

  const expired = ages.filter((age) => age > maxAgeDays).length;
  const oldest = ages.length === 0 ? undefined : Math.max(...ages);
  return {
    datedRecords: ages.length,
    heldRecords: held,
    expiredRecords: expired,
    oldestAgeDays: oldest === undefined ? null : Math.round(oldest * 100) / 100
  };
}

let temporaryStateRoot;
try {
  const { stateRoot: requestedStateRoot, strict } = parseArguments(process.argv.slice(2));
  const nowMs = Date.now();
  const maxAgeDays = await readMaxAgeDays();
  temporaryStateRoot =
    requestedStateRoot === undefined ? await createSampleStateRoot(nowMs) : undefined;
  const stateRoot = requestedStateRoot ?? temporaryStateRoot;
  const summary = await summarize(stateRoot);
  const runCount = Math.max(await countRunDirectories(stateRoot), summary.episodeFiles);
  const perRunEstimateBytes =
    summary.files === 0 ? 0 : Math.ceil(summary.bytes / Math.max(runCount, 1));
  const ages = await measureAges(stateRoot, nowMs, maxAgeDays);
  const overBound = ages.expiredRecords > 0;

  process.stdout.write(
    `${JSON.stringify({
      ok: !(strict && overBound),
      files: summary.files,
      bytes: summary.bytes,
      perRunEstimateBytes,
      bounded: true,
      maxAgeDays,
      ...ages,
      ...(strict && overBound
        ? {
            error: `${ages.expiredRecords} record(s) older than the ${maxAgeDays}-day retention bound; run pi-sparkle retain --apply`
          }
        : {})
    })}\n`
  );
  if (strict && overBound) process.exitCode = 1;
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      files: 0,
      bytes: 0,
      perRunEstimateBytes: 0,
      bounded: false,
      error: error instanceof Error ? error.message : String(error)
    })}\n`
  );
  process.exitCode = 1;
} finally {
  if (temporaryStateRoot !== undefined) {
    await rm(temporaryStateRoot, { recursive: true, force: true });
  }
}
