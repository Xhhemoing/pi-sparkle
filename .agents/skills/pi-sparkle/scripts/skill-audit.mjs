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

const ALIAS_PATTERNS = [
  /路由别名[一-鿿\s]*[—-]?[一-鿿\s]*由\s*([a-z0-9-]+)/i,
  /alias\s+(?:for|of)\s+[`']?([a-z0-9-]+)/i,
  /([a-z0-9-]+)\s+的\s*canonical\s*名/i,
  /canonical\s+name\s+of\s+[`']?([a-z0-9-]+)/i,
];

/**
 * Scan installed skill descriptions for self-declared aliases ("this skill is
 * just an alias for X"). A candidate is confirmed only when the referenced
 * target actually exists — otherwise the "alias" IS the only implementation.
 */
export function detectAliasCandidates(
  installed,
  roots = [join(homedir(), ".agents", "skills"), join(homedir(), ".pi", "agent", "skills")],
) {
  const known = new Set(installed);
  const out = [];
  for (const name of installed) {
    let description = "";
    for (const root of roots) {
      const file = join(root, name, "SKILL.md");
      if (!existsSync(file)) continue;
      const head = readFileSync(file, "utf8").slice(0, 2000);
      const match = head.match(/^description:\s*["'`]?([^\n]+)/m);
      if (match) description = match[1];
      break;
    }
    for (const pattern of ALIAS_PATTERNS) {
      const m = description.match(pattern);
      if (m === undefined || m === null || m[1] === undefined) continue;
      const target = m[1].toLowerCase();
      if (target === name.toLowerCase()) break;
      out.push({
        skill: name,
        claimsAliasTo: target,
        targetExists: known.has(target),
        // Confirmed prune candidate: pure alias AND the real thing exists.
        prunable: known.has(target),
      });
      break;
    }
  }
  return out;
}

export function audit(projects) {
  const activated = new Map();
  const skipped = new Map();
  let records = 0;
  let corrupt = 0;
  const perProject = [];
  const loggingProjects = [];
  const projectAffinity = new Map();
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
          if (!projectAffinity.has(project)) projectAffinity.set(project, new Set());
          for (const name of rec.activated ?? []) {
            activated.set(name, (activated.get(name) ?? 0) + 1);
            projectAffinity.get(project).add(name);
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
    aliasCandidates: detectAliasCandidates(installed),
    // Scenario affinity: which skills activate in which project. Evidence for
    // scenario-scoped management instead of one flat global pile.
    scenarioAffinity: Object.fromEntries(
      [...projectAffinity.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([project, skills]) => [project, [...skills].sort()]),
    ),
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
