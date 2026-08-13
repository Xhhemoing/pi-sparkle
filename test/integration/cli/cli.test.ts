import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";

const REPO_ROOT = process.cwd();

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text)
    },
    out,
    err
  };
}

async function withRoots(run: (stateRoot: string, projectRoot: string) => Promise<void>) {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-cli-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-cli-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await run(stateRoot, projectRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

test("run with the fake executor prints a human summary and persists the run", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const { io, out, err } = capture();
    const code = await main(
      ["run", "--project", projectRoot, "--objective", "Audit the project", "--state-root", stateRoot],
      io
    );
    assert.equal(code, 0);
    const text = out.join("");
    assert.match(text, /Run (run_[A-Za-z0-9_-]+): COMPLETED/);
    assert.match(text, /events\.jsonl/);
    assert.match(text, /checkpoint\.json/);
    assert.deepEqual(err, []);

    const match = text.match(/Run (run_[A-Za-z0-9_-]+):/);
    const runId = match?.[1];
    assert.ok(runId);
    const eventsFile = join(stateRoot, "runs", runId, "events.jsonl");
    const checkpointFile = join(stateRoot, "runs", runId, "checkpoint.json");
    const eventsText = await readFile(eventsFile, "utf8");
    assert.equal(eventsText.trim().split("\n").length, 9);
    const checkpoint = JSON.parse(await readFile(checkpointFile, "utf8"));
    assert.equal(checkpoint.status, "COMPLETED");
  });
});

test("run rejects missing required arguments", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const { io, out, err } = capture();
    const code = await main(["run", "--project", projectRoot, "--state-root", stateRoot], io);
    assert.equal(code, 1);
    assert.match(err.join(""), /--objective/);
    assert.deepEqual(out, []);
  });
});

test("run rejects an unknown executor", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const { io, err } = capture();
    const code = await main(
      ["run", "--project", projectRoot, "--objective", "x", "--executor", "magic", "--state-root", stateRoot],
      io
    );
    assert.equal(code, 1);
    assert.match(err.join(""), /executor/);
  });
});

test("inspect prints the status and --json emits one JSON event per line", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runIo = capture();
    await main(["run", "--project", projectRoot, "--objective", "x", "--state-root", stateRoot], runIo.io);
    const runId = runIo.out.join("").match(/Run (run_[A-Za-z0-9_-]+):/)?.[1];
    assert.ok(runId);

    const human = capture();
    const code = await main(["inspect", "--run", runId, "--state-root", stateRoot], human.io);
    assert.equal(code, 0);
    assert.match(human.out.join(""), /COMPLETED/);

    const json = capture();
    const jsonCode = await main(["inspect", "--run", runId, "--state-root", stateRoot, "--json"], json.io);
    assert.equal(jsonCode, 0);
    const lines = json.out.join("").trim().split("\n");
    assert.equal(lines.length, 9);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      assert.ok(parsed.id && parsed.type);
    }
  });
});

test("inspect reports a missing run", async () => {
  const { io, err } = capture();
  const code = await main(["inspect", "--run", "run_01234567-89ab-cdef-0123-456789abcdef", "--state-root", "/tmp/pi-sparkle-nonexistent"], io);
  assert.equal(code, 1);
  assert.match(err.join(""), /not found/);
});

test("resume rebuilds a deleted checkpoint from the event log", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runIo = capture();
    await main(["run", "--project", projectRoot, "--objective", "x", "--state-root", stateRoot], runIo.io);
    const runId = runIo.out.join("").match(/Run (run_[A-Za-z0-9_-]+):/)?.[1];
    assert.ok(runId);
    const checkpointFile = join(stateRoot, "runs", runId, "checkpoint.json");
    await rm(checkpointFile);

    const resumeIo = capture();
    const code = await main(["resume", "--run", runId, "--state-root", stateRoot], resumeIo.io);
    assert.equal(code, 0);
    assert.match(resumeIo.out.join(""), /checkpoint rebuilt/);
    const checkpoint = JSON.parse(await readFile(checkpointFile, "utf8"));
    assert.equal(checkpoint.status, "COMPLETED");
  });
});

test("unknown commands exit with an error", async () => {
  const { io, err } = capture();
  const code = await main(["frobnicate"], io);
  assert.equal(code, 1);
  assert.match(err.join(""), /Unknown command/);
});

test("the CLI entrypoint spawns end-to-end", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "src/cli/main.ts", "help"], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });
  assert.match(output, /pi-sparkle/);
  assert.match(output, /run|inspect|resume/);
});
