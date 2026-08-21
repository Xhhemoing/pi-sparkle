import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { main, type CliIo } from "../../../src/cli/main.js";

const FIXTURE_JSON = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../dataset/public-priors/pps_fixture_v1.json"
);

const CHILD_SPEC = {
  tasks: [
    {
      id: "tsk_parse",
      role: "implementer",
      objective: "Implement the parser",
      acceptanceCriteria: [{ id: "ac-1", description: "Parses empty input" }],
      limits: { maxAttempts: 2, timeoutMs: 60_000, maxWallTimeMs: 300_000 }
    }
  ]
};

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

function stderrLines(err: readonly string[]): string[] {
  return err.join("").split(/\r?\n/).filter((line) => line.trim() !== "");
}

function publicPriorStderr(err: readonly string[]): string[] {
  return stderrLines(err).filter((line) => /public prior/i.test(line));
}

function implementerModel(out: readonly string[]): string | undefined {
  return out.join("").match(/\(implementer, [^)]+\) -> (\S+)/)?.[1];
}

async function withRoots(run: (stateRoot: string, projectRoot: string) => Promise<void>) {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-prior-cli-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-prior-cli-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await run(stateRoot, projectRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

async function writeMismatchedPrior(dir: string): Promise<string> {
  const path = join(dir, "pps_mismatch.json");
  await writeFile(path, await readFile(FIXTURE_JSON, "utf8"), "utf8");
  await writeFile(join(dir, "pps_mismatch.hash"), "deadbeef\n", "utf8");
  return path;
}

test("--track --assume-defaults --public-prior routes edit work to the fixture pick (premium)", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const { io, out, err } = capture();
    const code = await main(
      [
        "run",
        "--track",
        "--assume-defaults",
        "--project",
        projectRoot,
        "--objective",
        "Implement the parser",
        "--state-root",
        stateRoot,
        "--primary-model",
        "premium",
        "--fast-model",
        "cheap",
        "--public-prior",
        FIXTURE_JSON
      ],
      io
    );
    assert.equal(code, 0);
    assert.equal(publicPriorStderr(err).length, 0);
    assert.match(out.join(""), /public prior: pps_fixture_v1/);
    assert.equal(implementerModel(out), "premium");
  });
});

test("--children --public-prior routes implementer edit work to premium", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const specPath = join(projectRoot, "children.json");
    await writeFile(specPath, JSON.stringify(CHILD_SPEC), "utf8");
    const { io, out, err } = capture();
    const code = await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        "Ship the parser",
        "--children",
        specPath,
        "--state-root",
        stateRoot,
        "--primary-model",
        "premium",
        "--fast-model",
        "cheap",
        "--public-prior",
        FIXTURE_JSON
      ],
      io
    );
    assert.equal(code, 0);
    assert.equal(publicPriorStderr(err).length, 0);
    assert.equal(implementerModel(out), "premium");
  });
});

test("missing --public-prior file is fail-soft: cheap assignments, exit 0, one stderr line", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const { io, out, err } = capture();
    const code = await main(
      [
        "run",
        "--track",
        "--assume-defaults",
        "--project",
        projectRoot,
        "--objective",
        "Implement the parser",
        "--state-root",
        stateRoot,
        "--primary-model",
        "premium",
        "--fast-model",
        "cheap",
        "--public-prior",
        join(stateRoot, "missing-prior.json")
      ],
      io
    );
    assert.equal(code, 0);
    assert.match(out.join(""), /COMPLETED/);
    assert.equal(implementerModel(out), "cheap");
    const priorLines = publicPriorStderr(err);
    assert.equal(priorLines.length, 1);
    assert.equal(stderrLines(err).length, 1);
    assert.doesNotMatch(err.join(""), /^error:/m);
  });
});

test("hash mismatch --public-prior is fail-soft on --children: cheap, exit 0, one stderr line", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const specPath = join(projectRoot, "children.json");
    await writeFile(specPath, JSON.stringify(CHILD_SPEC), "utf8");
    const priorPath = await writeMismatchedPrior(stateRoot);
    const { io, out, err } = capture();
    const code = await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        "Ship the parser",
        "--children",
        specPath,
        "--state-root",
        stateRoot,
        "--primary-model",
        "premium",
        "--fast-model",
        "cheap",
        "--public-prior",
        priorPath
      ],
      io
    );
    assert.equal(code, 0);
    assert.match(out.join(""), /COMPLETED/);
    assert.equal(implementerModel(out), "cheap");
    const priorLines = publicPriorStderr(err);
    assert.equal(priorLines.length, 1);
    assert.equal(stderrLines(err).length, 1);
    assert.doesNotMatch(err.join(""), /^error:/m);
  });
});

test("--require-public-prior with a missing file exits non-zero and does not run as if prior loaded", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const specPath = join(projectRoot, "children.json");
    await writeFile(specPath, JSON.stringify(CHILD_SPEC), "utf8");
    const { io, out, err } = capture();
    const code = await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        "Ship the parser",
        "--children",
        specPath,
        "--state-root",
        stateRoot,
        "--primary-model",
        "premium",
        "--fast-model",
        "cheap",
        "--public-prior",
        join(stateRoot, "missing-prior.json"),
        "--require-public-prior"
      ],
      io
    );
    assert.notEqual(code, 0);
    assert.doesNotMatch(err.join(""), /Unknown option/i);
    assert.match(err.join(""), /public prior/i);
    assert.doesNotMatch(out.join(""), /COMPLETED/);
    assert.notEqual(implementerModel(out), "premium");
  });
});

test("--require-public-prior with a hash mismatch exits non-zero and does not apply the prior", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const priorPath = await writeMismatchedPrior(stateRoot);
    const { io, out, err } = capture();
    const code = await main(
      [
        "run",
        "--track",
        "--assume-defaults",
        "--project",
        projectRoot,
        "--objective",
        "Implement the parser",
        "--state-root",
        stateRoot,
        "--primary-model",
        "premium",
        "--fast-model",
        "cheap",
        "--public-prior",
        priorPath,
        "--require-public-prior"
      ],
      io
    );
    assert.notEqual(code, 0);
    assert.doesNotMatch(err.join(""), /Unknown option/i);
    assert.match(err.join(""), /public prior/i);
    assert.doesNotMatch(out.join(""), /COMPLETED/);
    assert.notEqual(implementerModel(out), "premium");
  });
});

test("no --public-prior keeps today's cheap edit path and adds no public-prior stderr", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const specPath = join(projectRoot, "children.json");
    await writeFile(specPath, JSON.stringify(CHILD_SPEC), "utf8");
    const { io, out, err } = capture();
    const code = await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        "Ship the parser",
        "--children",
        specPath,
        "--state-root",
        stateRoot,
        "--primary-model",
        "premium",
        "--fast-model",
        "cheap"
      ],
      io
    );
    assert.equal(code, 0);
    assert.equal(implementerModel(out), "cheap");
    assert.equal(publicPriorStderr(err).length, 0);
    assert.equal(stderrLines(err).length, 0);
  });
});
