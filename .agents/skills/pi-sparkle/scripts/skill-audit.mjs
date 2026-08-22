#!/usr/bin/env node
/**
 * pi-sparkle skill-audit — aggregate skill-routes.jsonl across projects and
 * report top-activated / never-activated installed skills (prune candidates).
 * Diagnostic read-only; no extension (ADR-006 Proposed).
 *
 * Usage:
 *   node skill-audit.mjs [projectRoot ...]   (default: cwd)
 *
 * Data source: <project>/.pi/logs/skill-routes.jsonl (only meaningful after
 * opt-in logging has been enabled for some sessions).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

function parseArgs(argv) {
  const projects = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--projects" && argv[i + 1]) {
      for (const p of argv[i + 1].split(",")) {
        if (p.trim()) projects.push(resolve(p.trim()));
      }
      i += 1;
    } else if (!argv[i].startsWith("--")) {
      projects.push(resolve(argv[i]));
    }
  }
  if (projects.length === 0) projects.push(process.cwd());
  return { projects };
}

export function installedSkills() {
  const roots = [join(homedir(), ".agents", "skills"), join(homedir(), ".pi", "agent", "skills")];
  const names = new Set();
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      const dir = join(root, entry);
      try {
        if (statSync(dir).isDirectory() && existsSync(join(dir, "SKILL.md"))) names.add(entry);
      } catch {
        /* unreadable entry: skip */
      }
    }
  }
  return [...names].sort();
}

export function audit(projects) {
  const activated = new Map();
  const skipped = new Map();
  let records = 0;
  let corrupt = 0;
  const perProject = [];
  const loggingProjects = [];
  for (const project of projects) {
    const logPath = join(project, ".pi", "logs", "skill-routes.jsonl");
    // Route logging is opt-in per project: a marker file enables it unless
    // the kill-switch env var turns it off. Projects without the marker are
    // "not logging" — their empty logs must never be read as usage evidence.
    const marker = existsSync(join(project, ".pi", "logs", "skill-route-log.enabled"));
    const envOff = (process.env.PI_SKILL_ROUTE_LOG ?? "").trim().toLowerCase() === "0";
    const loggingEnabled = marker && !envOff;
    let lines = 0;
    if (existsSync(logPath)) {
      for (const line of readFileSync(logPath, "utf8").split("\n")) {
        if (line.trim() === "") continue;
        lines += 1;
        try {
          const rec = JSON.parse(line);
          records += 1;
          if (!loggingEnabled) continue;
          for (const name of rec.activated ?? []) {
            activated.set(name, (activated.get(name) ?? 0) + 1);
          }
          for (const name of rec.skipped ?? []) {
            skipped.set(name, (skipped.get(name) ?? 0) + 1);
          }
        } catch {
          corrupt += 1;
        }
      }
    }
    if (loggingEnabled) loggingProjects.push(project);
    perProject.push({ project, lines, loggingEnabled });
  }
  const installed = installedSkills();
  // "Never activated" is only meaningful across logging-enabled projects.
  // With zero logging projects there is no usage signal at all — say so
  // instead of listing every skill as never-activated.
  const neverActivated =
    loggingProjects.length > 0
      ? installed.filter((n) => !activated.has(n))
      : [];
  const top = [...activated.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topSkipped = [...skipped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return {
    projectsScanned: perProject,
    loggingProjectCount: loggingProjects.length,
    usageSignalAvailable: loggingProjects.length > 0,
    totalRecords: records,
    corruptRecords: corrupt,
    installedSkillCount: installed.length,
    topActivated: Object.fromEntries(top),
    topSkipped: Object.fromEntries(topSkipped),
    neverActivated,
    ...(loggingProjects.length === 0
      ? {
          warning:
            "no project has route logging enabled; neverActivated/topActivated are withheld because absence of logs is not evidence of non-use",
        }
      : {}),
  };
}

function run(argv) {
  const { projects } = parseArgs(argv);
  const report = audit(projects);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.corruptRecords > 0 ? 1 : 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]).toLowerCase().endsWith("skill-audit.mjs");
if (isMain) {
  process.exitCode = run(process.argv.slice(2));
}
