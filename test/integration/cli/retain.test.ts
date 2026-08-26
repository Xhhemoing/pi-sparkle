import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import { parseCliErrorJson } from "../../../src/cli/errors.js";
import { runtimeRoot } from "../../../src/privacy/state-layout.js";
import { DEFAULT_RETENTION_POLICY } from "../../../src/privacy/retention.js";

/**
 * `pi-sparkle retain` through the dispatcher. The command's own decisions
 * (what is expired, what the cascade removes) are pinned in
 * `test/unit/privacy/retention.test.ts`; these pins are the CLI contract: dry
 * run by default, an exit code scripts can gate on, and an --apply that
 * reports what it removed.
 */

const MS_PER_DAY = 86_400_000;

function capture(): { io: CliIo; out: () => string; err: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (text) => out.push(text), stderr: (text) => err.push(text) },
    out: () => out.join(""),
    err: () => err.join("")
  };
}

async function withStateRoot(run: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-retain-cli-"));
  try {
    await run(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * MS_PER_DAY).toISOString();
}

async function seedExpiredInvocation(stateRoot: string, id: string, ageDays: number): Promise<string> {
  const path = join(runtimeRoot(stateRoot), "invocations.jsonl");
  await mkdir(runtimeRoot(stateRoot), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify({
      id,
      taskId: "tsk_ret",
      runId: "run_ret",
      agentInstanceId: "agt_ret",
      config: { provider: "fake", model: "cheap", modelVersion: "cheap-v1", parameterHash: "abc" },
      responseHash: "def",
      tokensIn: 10,
      tokensOut: 5,
      latencyMs: 20,
      occurredAt: daysAgo(ageDays),
      callOutcome: "ok"
    })}\n`,
    "utf8"
  );
  return path;
}

test("retain --help prints the usage and exits 0", async () => {
  const { io, out } = capture();
  assert.equal(await main(["retain", "--help"], io), 0);
  assert.match(out(), /pi-sparkle retain \[--state-root <dir>\] \[--max-age-days <n>\]/);
  assert.match(out(), new RegExp(`The default is ${DEFAULT_RETENTION_POLICY.maxAgeDays} days`));
});

test("retain on a state root with nothing over the bound exits 0 and writes nothing", async () => {
  await withStateRoot(async (stateRoot) => {
    const path = await seedExpiredInvocation(stateRoot, "inv_fresh", 1);
    const before = await readFile(path, "utf8");
    const { io, out } = capture();

    assert.equal(await main(["retain", "--state-root", stateRoot], io), 0);
    assert.match(out(), /retain: dry run \(no records removed\)/);
    assert.match(out(), /nothing is over the retention bound/);
    assert.equal(await readFile(path, "utf8"), before);
  });
});

test("a dry run that finds expired records lists them and exits 1 so scripts can gate", async () => {
  await withStateRoot(async (stateRoot) => {
    const path = await seedExpiredInvocation(stateRoot, "inv_ancient", 200);
    const before = await readFile(path, "utf8");
    const { io, out } = capture();

    assert.equal(await main(["retain", "--state-root", stateRoot], io), 1);
    assert.match(out(), /would remove: invocation inv_ancient \(\d+(\.\d+)? day\(s\) old/);
    assert.match(out(), /summary: 1 record\(s\) over the bound/);
    assert.match(out(), /re-run with --apply/);
    assert.equal(await readFile(path, "utf8"), before, "a dry run must not write");
  });
});

test("--apply removes the expired rows and reports the paths it changed", async () => {
  await withStateRoot(async (stateRoot) => {
    const path = await seedExpiredInvocation(stateRoot, "inv_ancient", 200);
    const { io, out } = capture();

    assert.equal(await main(["retain", "--state-root", stateRoot, "--apply"], io), 0);
    assert.match(out(), /retain: apply/);
    assert.match(out(), /removed: .*invocations\.jsonl \(1 invocation row\(s\)\)/);
    assert.match(out(), /summary: 0 episode\(s\) deleted, 1 invocation row\(s\) dropped/);
    assert.equal(await readFile(path, "utf8"), "");
    assert.equal(existsSync(path), true, "the shared log is rewritten, never unlinked");

    // Idempotent: the second run has nothing left to do.
    const second = capture();
    assert.equal(await main(["retain", "--state-root", stateRoot, "--apply"], second.io), 0);
    assert.match(second.out(), /summary: 0 episode\(s\) deleted, 0 invocation row\(s\) dropped/);
  });
});

test("--max-age-days tightens the bound and is refused when it is not whole and positive", async () => {
  await withStateRoot(async (stateRoot) => {
    await seedExpiredInvocation(stateRoot, "inv_recent", 10);

    const tight = capture();
    assert.equal(await main(["retain", "--state-root", stateRoot, "--max-age-days", "7"], tight.io), 1);
    assert.match(tight.out(), /max age: 7 day\(s\)/);

    // `=` spelling throughout: parseArgs refuses a bare `-5` as an ambiguous
    // option argument before the value ever reaches this command's parser.
    for (const bad of ["0", "-5", "7.5", "1e2", " 7"]) {
      const { io, err } = capture();
      assert.equal(await main(["retain", "--state-root", stateRoot, `--max-age-days=${bad}`], io), 1);
      const report = parseCliErrorJson(err());
      assert.equal(report?.command, "retain");
      assert.match(report?.message ?? "", /--max-age-days must be a whole number of days/);
    }
  });
});
