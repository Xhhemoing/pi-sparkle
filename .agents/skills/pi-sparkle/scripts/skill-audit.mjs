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
  for (const project of projects) {
    const logPath = join(project, ".pi", "logs", "skill-routes.jsonl");
    let lines = 0;
    if (existsSync(logPath)) {
      for (const line of readFileSync(logPath, "utf8").split("\n")) {
        if (line.trim() === "") continue;
        lines += 1;
        try {
          const rec = JSON.parse(line);
          records += 1;
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
    perProject.push({ project, lines });
  }
  const installed = installedSkills();
  const neverActivated = installed.filter((n) => !activated.has(n));
  const top = [...activated.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topSkipped = [...skipped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return {
    projectsScanned: perProject,
    totalRecords: records,
    corruptRecords: corrupt,
    installedSkillCount: installed.length,
    topActivated: Object.fromEntries(top),
    topSkipped: Object.fromEntries(topSkipped),
    neverActivated
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
