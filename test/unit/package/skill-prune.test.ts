import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("../../../.agents/skills/pi-sparkle/scripts/skill-prune.mjs", import.meta.url)
);

function runCli(
  args: string[]
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: process.env,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function report(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout) as Record<string, unknown>;
}

async function withDirs(
  run: (dirs: { skillsRoot: string; backupRoot: string }) => Promise<void>
): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), "pi-sparkle-skill-prune-"));
  try {
    const skillsRoot = join(base, "skills");
    const backupRoot = join(base, "skills-backup");
    await mkdir(skillsRoot, { recursive: true });
    await run({ skillsRoot, backupRoot });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

async function installSkill(skillsRoot: string, name: string, description: string): Promise<void> {
  const dir = join(skillsRoot, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
    "utf8"
  );
}

test("dry-run lists confirmed aliases and broken aliases separately", async () => {
  await withDirs(async ({ skillsRoot }) => {
    await installSkill(skillsRoot, "real-skill", "the canonical implementation");
    await installSkill(skillsRoot, "pure-alias", "alias for real-skill; nothing else here");
    await installSkill(skillsRoot, "broken-alias", "alias for missing-skill; nothing else");
    await installSkill(skillsRoot, "ordinary", "a normal standalone skill");

    const out = runCli(["--roots", skillsRoot]);
    assert.equal(out.status, 0, out.stderr);
    const rep = report(out.stdout);
    assert.equal(rep.applied, false);
    assert.equal(rep.dryRun, true);
    const confirmed = rep.confirmed as Array<Record<string, unknown>>;
    assert.equal(confirmed.length, 1);
    assert.equal(confirmed[0]?.skill, "pure-alias");
    const broken = rep.brokenAliases as Array<Record<string, unknown>>;
    assert.equal(broken.length, 1);
    assert.equal(broken[0]?.skill, "broken-alias");
    // Nothing moved in a dry-run.
    assert.equal(existsSync(join(skillsRoot, "pure-alias", "SKILL.md")), true);
  });
});

test("--apply on a non-confirmed skill is refused with a non-zero exit", async () => {
  await withDirs(async ({ skillsRoot, backupRoot }) => {
    await installSkill(skillsRoot, "ordinary", "a normal standalone skill");

    const out = runCli([
      "--apply",
      "ordinary",
      "--roots",
      skillsRoot,
      "--backup-root",
      backupRoot,
    ]);
    assert.equal(out.status, 1, "a refused apply must fail closed");
    const rep = report(out.stdout);
    assert.equal(rep.applied, false);
    assert.equal(rep.refused, "ordinary");
    assert.match(String(rep.reason), /evidence gate/);
    // The skill is untouched.
    assert.equal(existsSync(join(skillsRoot, "ordinary", "SKILL.md")), true);
    assert.equal(existsSync(backupRoot), false);
  });
});

test("--apply on a broken alias is refused: it is the only implementation", async () => {
  await withDirs(async ({ skillsRoot, backupRoot }) => {
    await installSkill(skillsRoot, "broken-alias", "alias for missing-skill; nothing else");

    const out = runCli([
      "--apply",
      "broken-alias",
      "--roots",
      skillsRoot,
      "--backup-root",
      backupRoot,
    ]);
    assert.equal(out.status, 1);
    const rep = report(out.stdout);
    assert.equal(rep.applied, false);
    assert.equal(rep.refused, "broken-alias");
    assert.equal(existsSync(join(skillsRoot, "broken-alias", "SKILL.md")), true);
  });
});

test("--apply on a confirmed alias moves exactly that skill to the backup root", async () => {
  await withDirs(async ({ skillsRoot, backupRoot }) => {
    await installSkill(skillsRoot, "real-skill", "the canonical implementation");
    await installSkill(skillsRoot, "pure-alias", "alias for real-skill; nothing else here");
    await installSkill(skillsRoot, "other", "must stay put");

    const out = runCli([
      "--apply",
      "pure-alias",
      "--roots",
      skillsRoot,
      "--backup-root",
      backupRoot,
    ]);
    assert.equal(out.status, 0, out.stderr);
    const rep = report(out.stdout);
    assert.equal(rep.applied, true);
    assert.equal(rep.moved, "pure-alias");
    const backup = String(rep.backup);
    assert.ok(backup.startsWith(backupRoot), "backup must live under --backup-root");
    assert.match(backup, /skills-backup[/\\]\d{4}-\d{2}-\d{2}[/\\]pure-alias$/);
    assert.equal(existsSync(join(skillsRoot, "pure-alias")), false, "source must be gone");
    assert.equal(existsSync(join(backup, "SKILL.md")), true, "backup must hold the skill");
    // Bystanders untouched.
    assert.equal(existsSync(join(skillsRoot, "real-skill", "SKILL.md")), true);
    assert.equal(existsSync(join(skillsRoot, "other", "SKILL.md")), true);
  });
});
