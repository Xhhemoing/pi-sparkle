#!/usr/bin/env node
/**
 * Opt-in skill-route logger. Diagnostic overlay only (ADR-006 Proposed).
 * Does not persist skill USED, does not promote policy, is not a Pi extension.
 *
 * Enable: PI_SKILL_ROUTE_LOG=1|true|yes  OR  <project>/.pi/logs/skill-route-log.enabled
 * Kill switch: PI_SKILL_ROUTE_LOG=0|false|no  (wins over the marker file)
 *
 * Usage:
 *   node log-skill-route.mjs --task "<verbatim user task>" --candidates "a,b" \
 *     --activated "a" --skipped "b" --reason "cap-2" --result routed
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RESULTS = new Set(["routed", "none", "skipped-trivial", "already-loaded"]);
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SKILLS = 16;
const MAX_REASON = 200;
const FORBIDDEN_KEYS = new Set(["used", "USED", "task", "prompt", "user", "text"]);

export function parseArgs(argv) {
  const out = {
    project: process.cwd(),
    source: "scenario-skill-router",
    task: "",
    candidates: [],
    activated: [],
    skipped: [],
    reason: "",
    result: ""
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const val = argv[i + 1];
    if (!key?.startsWith("--")) continue;
    const listFlag = key === "--candidates" || key === "--activated" || key === "--skipped";
    const hasVal = val !== undefined && !val.startsWith("--");
    if (!hasVal) {
      if (listFlag) continue;
      throw new Error(`missing value for ${key}`);
    }
    i += 1;
    switch (key) {
      case "--project":
        out.project = val;
        break;
      case "--source":
        out.source = val;
        break;
      case "--task":
        out.task = val;
        break;
      case "--candidates":
        out.candidates = splitSkills(val);
        break;
      case "--activated":
        out.activated = splitSkills(val);
        break;
      case "--skipped":
        out.skipped = splitSkills(val);
        break;
      case "--reason":
        out.reason = val;
        break;
      case "--result":
        out.result = val;
        break;
      default:
        throw new Error(`unknown flag ${key}`);
    }
  }
  return out;
}

function splitSkills(raw) {
  if (raw.trim() === "") return [];
  const names = raw.split(",").map((part) => part.trim()).filter(Boolean);
  if (names.length > MAX_SKILLS) {
    throw new Error(`at most ${MAX_SKILLS} skill names`);
  }
  for (const name of names) {
    if (!SKILL_NAME.test(name)) {
      throw new Error(`invalid skill name: ${name}`);
    }
  }
  return names;
}

export function envFlag(value) {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") return "off";
  if (v === "1" || v === "true" || v === "yes") return "on";
  return "unset";
}

export function isEnabled(projectRoot, envValue) {
  const flag = envFlag(envValue);
  if (flag === "off") return false;
  if (flag === "on") return true;
  return existsSync(join(projectRoot, ".pi", "logs", "skill-route-log.enabled"));
}

export function hashTask(task) {
  const normalized = task.trim().replace(/\s+/g, " ");
  if (normalized === "") throw new Error("--task is required");
  return createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 16);
}

export function buildRecord(input, ts = new Date().toISOString()) {
  if (!RESULTS.has(input.result)) {
    throw new Error(`--result must be one of ${[...RESULTS].join("|")}`);
  }
  if (input.reason.length > MAX_REASON) {
    throw new Error(`--reason longer than ${MAX_REASON} characters`);
  }
  if (!SKILL_NAME.test(input.source)) {
    throw new Error("invalid --source");
  }
  const record = {
    schemaVersion: 1,
    ts,
    source: input.source,
    taskHash: hashTask(input.task),
    candidates: input.candidates,
    activated: input.activated,
    skipped: input.skipped,
    reason: input.reason,
    result: input.result
  };
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`forbidden field ${key}`);
  }
  const serialized = JSON.stringify(record);
  for (const needle of ["used", "USED"]) {
    if (serialized.includes(`"${needle}"`)) {
      throw new Error("refusing to persist USED");
    }
  }
  const normalizedTask = input.task.trim().replace(/\s+/g, " ");
  const reasonNorm = input.reason.trim().replace(/\s+/g, " ");
  if (normalizedTask.length >= 8 && reasonNorm.includes(normalizedTask)) {
    throw new Error("refusing to persist raw task text");
  }
  if (normalizedTask.length >= 12 && serialized.includes(normalizedTask)) {
    throw new Error("refusing to persist raw task text");
  }
  return record;
}

export function appendRecord(projectRoot, record) {
  const dir = join(projectRoot, ".pi", "logs");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "skill-routes.jsonl");
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
  return path;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function run(argv) {
  const input = parseArgs(argv);
  if (!isEnabled(input.project, process.env.PI_SKILL_ROUTE_LOG)) {
    printJson({ status: "disabled" });
    return 0;
  }
  const record = buildRecord(input);
  const path = appendRecord(input.project, record);
  printJson({ status: "appended", path, taskHash: record.taskHash });
  return 0;
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url).toLowerCase() === resolve(entry).toLowerCase();
}

if (isMainModule()) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
