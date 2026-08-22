import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("../../../.agents/skills/pi-sparkle/scripts/skill-audit.mjs", import.meta.url)
);

function runCli(
  args: string[],
  env: NodeJS.ProcessEnv = {}
): { status: number | null; stdout: string; stderr: string } {
  const merged = { ...process.env, ...env };
  if (!("PI_SKILL_ROUTE_LOG" in env)) delete merged.PI_SKILL_ROUTE_LOG;
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: merged,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function report(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout) as Record<string, unknown>;
}

async function withDirs(
  run: (dirs: { skillsRoot: string; projectA: string; projectB: string; quietProject: string }) => Promise<void>
): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), "pi-sparkle-skill-audit-"));
  try {
    const skillsRoot = join(base, "skills");
    await mkdir(skillsRoot, { recursive: true });
    const projectA = join(base, "project-a");
    const projectB = join(base, "project-b");
    const quietProject = join(base, "quiet");
    for (const project of [projectA, projectB, quietProject]) {
      await mkdir(join(project, ".pi", "logs"), { recursive: true });
    }
    await run({ skillsRoot, projectA, projectB, quietProject });
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

async function writeLog(project: string, lines: unknown[]): Promise<void> {
  const path = join(project, ".pi", "logs", "skill-routes.jsonl");
  await writeFile(path, lines.map((line) => JSON.stringify(line)).join("\n") + "\n", "utf8");
}

async function enableLogging(project: string): Promise<void> {
  await writeFile(join(project, ".pi", "logs", "skill-route-log.enabled"), "", "utf8");
}

const record = (activated: string[], skipped: string[] = []) => ({
  v: 1,
  taskHash: "fixture",
  task: "fixture task",
  result: "routed",
  activated,
  skipped,
  ts: "2026-08-22T00:00:00.000Z",
});

test("audit withholds usage claims when no project logs", async () => {
  await withDirs(async ({ skillsRoot, quietProject }) => {
    await installSkill(skillsRoot, "alpha", "does alpha things");
    // Log file exists but the marker is absent: the lines are parsed and
    // counted, but must never surface as usage evidence.
    await writeLog(quietProject, [record(["alpha"])]);

    const out = runCli(["--projects", quietProject, "--skills-roots", skillsRoot]);
    assert.equal(out.status, 0, out.stderr);
    const rep = report(out.stdout);
    assert.equal(rep.usageSignalAvailable, false);
    assert.equal(rep.loggingProjectCount, 0);
    assert.deepEqual(rep.neverActivated, []);
    assert.deepEqual(rep.topActivated, {});
    assert.equal(rep.totalRecords, 1);
    assert.match(String(rep.warning), /absence of logs is not evidence of non-use/);
    assert.deepEqual(
      (rep.projectsScanned as Array<Record<string, unknown>>).map((p) => p.loggingEnabled),
      [false]
    );
  });
});

test("audit kill switch disables an enabled marker", async () => {
  await withDirs(async ({ skillsRoot, projectA }) => {
    await installSkill(skillsRoot, "alpha", "does alpha things");
    await enableLogging(projectA);
    await writeLog(projectA, [record(["alpha"])]);

    const out = runCli(["--projects", projectA, "--skills-roots", skillsRoot], {
      PI_SKILL_ROUTE_LOG: "0",
    });
    assert.equal(out.status, 0, out.stderr);
    const rep = report(out.stdout);
    assert.equal(rep.usageSignalAvailable, false);
    assert.deepEqual(rep.topActivated, {});
  });
});

test("audit aggregates enabled projects and scopes recommendations", async () => {
  await withDirs(async ({ skillsRoot, projectA, projectB }) => {
    await installSkill(skillsRoot, "alpha", "does alpha things");
    await installSkill(skillsRoot, "beta", "does beta things");
    await installSkill(skillsRoot, "gamma", "does gamma things");
    await installSkill(skillsRoot, "silent", "never activated in any log");
    await enableLogging(projectA);
    await enableLogging(projectB);
    await writeLog(projectA, [
      record(["alpha", "beta"], ["gamma"]),
      record(["alpha"]),
    ]);
    await writeLog(projectB, [record(["beta"])]);

    const out = runCli(["--projects", `${projectA},${projectB}`, "--skills-roots", skillsRoot]);
    assert.equal(out.status, 0, out.stderr);
    const rep = report(out.stdout);
    assert.equal(rep.usageSignalAvailable, true);
    assert.equal(rep.loggingProjectCount, 2);
    assert.equal(rep.totalRecords, 3);
    assert.deepEqual(rep.topActivated, { alpha: 2, beta: 2 });
    assert.deepEqual(rep.topSkipped, { gamma: 1 });
    // neverActivated only among installed skills, and only with a signal.
    assert.ok((rep.neverActivated as string[]).includes("gamma"));
    assert.ok((rep.neverActivated as string[]).includes("silent"));
    assert.equal((rep.neverActivated as string[]).length, 2);

    // Scope: beta activates in two projects -> keep global; alpha only in A.
    const scope = rep.scopeRecommendations as Record<string, unknown>;
    assert.equal(scope.available, true);
    assert.deepEqual(scope.keepGlobal, [{ skill: "beta", activeIn: 2 }]);
    assert.deepEqual(scope.moveToProject, [{ skill: "alpha", project: projectA }]);
    assert.deepEqual(scope.noActivationEvidence, ["gamma", "silent"]);

    const affinity = rep.scenarioAffinity as Record<string, string[]>;
    assert.deepEqual(affinity[projectA], ["alpha", "beta"]);
    assert.deepEqual(affinity[projectB], ["beta"]);
  });
});

test("audit counts corrupt lines and exits non-zero", async () => {
  await withDirs(async ({ skillsRoot, projectA }) => {
    await installSkill(skillsRoot, "alpha", "does alpha things");
    await enableLogging(projectA);
    await writeFile(
      join(projectA, ".pi", "logs", "skill-routes.jsonl"),
      `${JSON.stringify(record(["alpha"]))}\n{not json}\n`,
      "utf8"
    );

    const out = runCli(["--projects", projectA, "--skills-roots", skillsRoot]);
    assert.equal(out.status, 1, "corrupt records must fail closed via exit code");
    const rep = report(out.stdout);
    assert.equal(rep.corruptRecords, 1);
    // Only successfully parsed records count toward totalRecords.
    assert.equal(rep.totalRecords, 1);
    assert.deepEqual(rep.topActivated, { alpha: 1 });
  });
});

test("alias detection: confirmed only when the target exists", async () => {
  await withDirs(async ({ skillsRoot, quietProject }) => {
    await installSkill(skillsRoot, "real-skill", "the canonical implementation");
    await installSkill(skillsRoot, "pure-alias", "alias for real-skill; nothing else here");
    await installSkill(skillsRoot, "broken-alias", "alias for missing-skill; nothing else");

    const out = runCli(["--projects", quietProject, "--skills-roots", skillsRoot]);
    assert.equal(out.status, 0, out.stderr);
    const aliases = report(out.stdout).aliasCandidates as Array<Record<string, unknown>>;
    assert.equal(aliases.length, 2);
    const pure = aliases.find((a) => a.skill === "pure-alias");
    const broken = aliases.find((a) => a.skill === "broken-alias");
    assert.ok(pure, "pure alias must be detected");
    assert.equal(pure.targetExists, true);
    assert.equal(pure.prunable, true);
    assert.ok(broken, "broken alias must be detected");
    assert.equal(broken.targetExists, false);
    assert.equal(broken.prunable, false);
  });
});

test("installedSkills only counts directories with SKILL.md", async () => {
  await withDirs(async ({ skillsRoot, quietProject }) => {
    await installSkill(skillsRoot, "alpha", "does alpha things");
    await mkdir(join(skillsRoot, "not-a-skill"), { recursive: true });
    await writeFile(join(skillsRoot, "loose-file.md"), "", "utf8");

    const out = runCli(["--projects", quietProject, "--skills-roots", skillsRoot]);
    assert.equal(out.status, 0, out.stderr);
    const rep = report(out.stdout);
    assert.equal(rep.installedSkillCount, 1);
    // No logging project -> neverActivated is withheld, not "everything".
    assert.deepEqual(rep.neverActivated, []);
    assert.equal(existsSync(join(skillsRoot, "not-a-skill")), true);
  });
});
