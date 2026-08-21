import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { skillRouteLogCheck, unknownAgentDriftCheck } from "../../../src/cli/doctor-overlay.js";
import { main, type CliIo } from "../../../src/cli/main.js";
import { parseCliErrorJson } from "../../../src/cli/errors.js";

async function withDir(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "pi-sparkle-overlay-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("skill-route check is disabled without marker or env", async () => {
  await withDir(async (root) => {
    const check = skillRouteLogCheck(root, undefined);
    assert.equal(check.ok, true);
    assert.match(check.detail, /disabled/);
  });
});

test("skill-route check fails closed on a corrupt mid-file line", async () => {
  await withDir(async (root) => {
    await mkdir(join(root, ".pi", "logs"), { recursive: true });
    await writeFile(join(root, ".pi", "logs", "skill-route-log.enabled"), "", "utf8");
    await writeFile(join(root, ".pi", "logs", "skill-routes.jsonl"), "NOT JSON\n{\"schemaVersion\":1}\n", "utf8");
    const check = skillRouteLogCheck(root, undefined);
    assert.equal(check.ok, false);
    assert.match(check.detail, /corrupt skill-routes.jsonl at line 1/);
  });
});

test("agent-drift lists historical Unknown agent without adding a profile", async () => {
  await withDir(async (root) => {
    const runs = join(root, ".pi", "subagents", "runs");
    await mkdir(runs, { recursive: true });
    await writeFile(
      join(runs, "msu-fail.json"),
      JSON.stringify({
        status: "failed",
        error: "Unknown agent: general-purpose. Available: worker, reviewer"
      }),
      "utf8"
    );
    const check = unknownAgentDriftCheck(root);
    assert.equal(check.ok, true);
    assert.match(check.detail, /general-purpose x1/);
    assert.match(check.detail, /undeclared in dispatch contract/);
    assert.match(check.detail, /do not add a profile/);
  });
});

test("doctor fails when an enabled skill-route log is corrupt", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-route-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-route-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await mkdir(join(projectRoot, ".pi", "logs"), { recursive: true });
    await writeFile(join(projectRoot, ".pi", "logs", "skill-route-log.enabled"), "", "utf8");
    await writeFile(join(projectRoot, ".pi", "logs", "skill-routes.jsonl"), "NOT JSON\n", "utf8");
    const out: string[] = [];
    const err: string[] = [];
    const io: CliIo = {
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text)
    };
    const code = await main(["doctor", "--state-root", stateRoot, "--project", projectRoot], io);
    assert.equal(code, 1);
    assert.match(out.join(""), /FAIL {2}skill-route:/);
    const parsed = parseCliErrorJson(err.join(""));
    assert.equal(parsed?.command, "doctor");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});
