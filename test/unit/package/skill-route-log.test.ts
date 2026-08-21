import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("../../../.agents/skills/pi-sparkle/scripts/log-skill-route.mjs", import.meta.url)
);

async function withProject(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "pi-sparkle-skill-route-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function hashTask(task: string): string {
  const normalized = task.trim().replace(/\s+/g, " ");
  return createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 16);
}

function runCli(
  args: string[],
  env: NodeJS.ProcessEnv
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("skill-route log is disabled by default and kill switch wins", async () => {
  await withProject(async (root) => {
    const task = "fix the flaky router test";
    const env = { ...process.env };
    delete env.PI_SKILL_ROUTE_LOG;
    const off = runCli(["--project", root, "--task", task, "--result", "none"], env);
    assert.equal(off.status, 0, off.stderr);
    assert.match(off.stdout, /"status":"disabled"/);
    assert.equal(existsSync(join(root, ".pi", "logs", "skill-routes.jsonl")), false);

    await mkdir(join(root, ".pi", "logs"), { recursive: true });
    await writeFile(join(root, ".pi", "logs", "skill-route-log.enabled"), "", "utf8");
    const killed = runCli(["--project", root, "--task", task, "--result", "none"], {
      PI_SKILL_ROUTE_LOG: "0"
    });
    assert.equal(killed.status, 0, killed.stderr);
    assert.match(killed.stdout, /"status":"disabled"/);
    assert.equal(existsSync(join(root, ".pi", "logs", "skill-routes.jsonl")), false);
  });
});

test("enabled helper appends one JSONL line without raw task or USED", async () => {
  await withProject(async (root) => {
    const task = "unique-task-text-must-not-appear-in-log";
    const result = runCli(
      [
        "--project",
        root,
        "--task",
        task,
        "--candidates",
        "systematic-debugging,verification-before-completion",
        "--activated",
        "systematic-debugging",
        "--skipped",
        "verification-before-completion",
        "--reason",
        "cap-2",
        "--result",
        "routed"
      ],
      { PI_SKILL_ROUTE_LOG: "1" }
    );
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout) as { status: string; path: string; taskHash: string };
    assert.equal(payload.status, "appended");
    const text = await readFile(payload.path, "utf8");
    assert.equal(text.includes(task), false);
    assert.equal(text.includes('"USED"'), false);
    assert.equal(text.includes('"used"'), false);
    const row = JSON.parse(text.trim()) as {
      schemaVersion: number;
      activated: string[];
      skipped: string[];
      result: string;
      taskHash: string;
      source: string;
    };
    assert.equal(row.schemaVersion, 1);
    assert.equal(row.source, "scenario-skill-router");
    assert.deepEqual(row.activated, ["systematic-debugging"]);
    assert.deepEqual(row.skipped, ["verification-before-completion"]);
    assert.equal(row.result, "routed");
    assert.equal(row.taskHash, hashTask(task));
  });
});

test("unknown flags and used-like results fail closed", () => {
  const unknown = runCli(["--used", "true", "--task", "x", "--result", "routed"], {
    PI_SKILL_ROUTE_LOG: "1"
  });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /unknown flag/);
  const badResult = runCli(["--task", "x", "--result", "used"], { PI_SKILL_ROUTE_LOG: "1" });
  assert.equal(badResult.status, 1);
  assert.match(badResult.stderr, /--result must be/);
});

test("reason must not echo the raw task", async () => {
  await withProject(async (root) => {
    const task = "Implement skill-route JSONL logging";
    const leaked = runCli(
      ["--project", root, "--task", task, "--reason", task, "--result", "routed"],
      { PI_SKILL_ROUTE_LOG: "1" }
    );
    assert.equal(leaked.status, 1);
    assert.match(leaked.stderr, /raw task text/);
    assert.equal(existsSync(join(root, ".pi", "logs", "skill-routes.jsonl")), false);
  });
});

test("omitted --skipped is an empty list when enabled", async () => {
  await withProject(async (root) => {
    const result = runCli(
      ["--project", root, "--task", "omit skipped skills on purpose", "--activated", "scenario-skill-router", "--result", "routed", "--reason", "table-match"],
      { PI_SKILL_ROUTE_LOG: "1" }
    );
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout) as { path: string };
    const row = JSON.parse((await readFile(payload.path, "utf8")).trim()) as { skipped: string[] };
    assert.deepEqual(row.skipped, []);
  });
});
