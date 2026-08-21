#!/usr/bin/env node
/**
 * pi-sparkle doctor — diagnostic read-only check of skill-route logging.
 * Not a Pi extension (ADR-006 Proposed). Changes nothing.
 *
 * Usage:
 *   node doctor.mjs --project <path>        (default: cwd)
 *
 * Reports whether route logging is enabled and how many JSONL lines exist.
 * Corrupt mid-file lines fail closed: exit 1 with status "corrupt".
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

function parseArgs(argv) {
  let project = process.cwd();
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--project" && argv[i + 1] && !argv[i + 1].startsWith("--")) {
      project = argv[i + 1];
      i += 1;
    }
  }
  return { project: resolve(project) };
}

function envFlag(value) {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") return "off";
  if (v === "1" || v === "true" || v === "yes") return "on";
  return "unset";
}

export function inspect(projectRoot, envValue) {
  const flag = envFlag(envValue);
  const marker = existsSync(join(projectRoot, ".pi", "logs", "skill-route-log.enabled"));
  const enabled = flag === "off" ? false : flag === "on" ? true : marker;
  const logPath = join(projectRoot, ".pi", "logs", "skill-routes.jsonl");
  let lines = 0;
  let corruptLines = 0;
  let lastTs = null;
  if (existsSync(logPath)) {
    const raw = readFileSync(logPath, "utf8");
    for (const line of raw.split("\n")) {
      if (line.trim() === "") continue;
      lines += 1;
      try {
        const rec = JSON.parse(line);
        if (rec?.ts && typeof rec.ts === "string") lastTs = rec.ts;
      } catch {
        corruptLines += 1;
      }
    }
  }
  const exists = existsSync(logPath);
  const status = corruptLines > 0 ? "corrupt" : "ok";
  return {
    status,
    project: projectRoot,
    loggingEnabled: enabled,
    envFlag: flag,
    markerFile: marker,
    logExists: exists,
    lines,
    corruptLines,
    lastTs
  };
}

function run(argv) {
  const { project } = parseArgs(argv);
  const report = inspect(project, process.env.PI_SKILL_ROUTE_LOG);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.status === "ok" ? 0 : 1;
}

const isMain = process.argv[1] && resolve(process.argv[1]).toLowerCase().endsWith("doctor.mjs");
if (isMain) {
  process.exitCode = run(process.argv.slice(2));
}
