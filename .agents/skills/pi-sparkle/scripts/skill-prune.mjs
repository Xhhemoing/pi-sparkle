#!/usr/bin/env node
/**
 * pi-sparkle skill-prune — evidence-gated pruning for installed skills.
 * Diagnostic overlay tooling; not a Pi extension (ADR-006 Proposed).
 *
 * Evidence rules (fail-closed):
 *   - A skill is CONFIRMED prunable only when it self-declares as an alias
 *     AND the referenced target skill exists. Nothing else is auto-prunable.
 *   - Never-activated skills are REVIEW items only: absence of activation
 *     logs is not evidence of non-use.
 *
 * Usage:
 *   node skill-prune.mjs                       dry-run: lists confirmed + review
 *   node skill-prune.mjs --apply <skill>       move ONE confirmed skill to
 *                                              ~/.pi/agent/skills-backup/<date>/
 *   node skill-prune.mjs --roots "<dir>,<dir>" override skill roots (testing)
 */
import { existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { detectAliasCandidates } from "./skill-audit.mjs";

function parseArgs(argv) {
  let apply;
  let roots;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--apply" && argv[i + 1] && !argv[i + 1].startsWith("--")) {
      apply = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--roots" && argv[i + 1]) {
      roots = argv[i + 1].split(",").map((entry) => resolve(entry.trim()));
      i += 1;
    }
  }
  return { apply, roots };
}

/** Locate which root holds a skill (honors overridden roots for testing). */
function locateSkill(roots, name) {
  for (const root of roots) {
    const dir = join(root, name);
    if (existsSync(dir) && existsSync(join(dir, "SKILL.md"))) return dir;
  }
  return undefined;
}

export function prunePlan(argv, now = new Date()) {
  const { apply, roots: rootOverride } = parseArgs(argv);
  const roots = rootOverride ?? [
    join(homedir(), ".agents", "skills"),
    join(homedir(), ".pi", "agent", "skills"),
  ];
  const installed = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      if (existsSync(join(root, entry, "SKILL.md"))) installed.push(entry);
    }
  }

  const aliasReport = detectAliasCandidates(installed, roots);
  const confirmed = aliasReport.filter((entry) => entry.prunable === true);
  // Aliases whose target is missing stay OUT of confirmed: they are the only
  // implementation of their domain (e.g. malware-triage).
  const brokenAliases = aliasReport.filter((entry) => entry.prunable === false);

  if (apply !== undefined) {
    const match = confirmed.find((entry) => entry.skill === apply);
    const sourceDir = match !== undefined ? locateSkill(roots, apply) : undefined;
    if (match === undefined || sourceDir === undefined) {
      return {
        applied: false,
        refused: apply,
        reason:
          "refusing to remove: skill is not a confirmed alias with an existing target " +
          "(evidence gate). Dry-run lists what qualifies and why.",
        confirmed,
        brokenAliases,
      };
    }
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const backupRoot = join(homedir(), ".pi", "agent", "skills-backup", stamp);
    mkdirSync(backupRoot, { recursive: true });
    const destination = join(backupRoot, apply);
    renameSync(sourceDir, destination);
    return { applied: true, moved: apply, backup: destination, confirmed, brokenAliases };
  }

  return { applied: false, dryRun: true, confirmed, brokenAliases };
}

function run(argv) {
  const report = prunePlan(argv);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]).toLowerCase().endsWith("skill-prune.mjs");
if (isMain) {
  process.exitCode = run(process.argv.slice(2));
}
