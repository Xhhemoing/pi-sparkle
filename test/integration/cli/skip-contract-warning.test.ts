import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import { withIsolatedPiEnv } from "../../helpers/pi-env.js";

/**
 * Plain `--children` and `--flowchart` start without a requirement contract:
 * the run binds `skipContract: true` and `assertCoverageAllowsStart` never
 * runs. That is a recorded product decision, not a defect — deriving a
 * contract from per-task acceptance criteria would silently change start
 * semantics for every existing spec — so it is *disclosed* rather than
 * patched.
 *
 * These pins are about the disclosure only. They assert the warning exists,
 * lands on stderr (so it cannot interleave with the stdout run report), names
 * `--track` as the coverage-gated alternative, and is printed exactly once per
 * start. They deliberately do not assert anything about coverage behaviour:
 * the semantics are unchanged, and a test that pinned them here would be
 * pinning them in the wrong place.
 */

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (text) => out.push(text), stderr: (text) => err.push(text) },
    out,
    err
  };
}

async function withRoots(run: (stateRoot: string, projectRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-skipcontract-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-skipcontract-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await withIsolatedPiEnv(() => run(stateRoot, projectRoot));
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

const CHILD_SPEC = {
  tasks: [
    {
      id: "tsk_parse",
      role: "implementer",
      objective: "Implement the parser",
      acceptanceCriteria: [{ id: "ac-1", description: "Parses empty input" }],
      limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 300_000 }
    }
  ]
};

const FLOWCHART_SPEC = {
  id: "skip-contract-example",
  nodes: [
    {
      id: "draft",
      taskId: "tsk_draft",
      role: "actor",
      objective: "Draft the change",
      modelPolicy: { allowedModels: ["cheap", "premium"], preferredModel: "cheap" },
      confidenceThreshold: 0.6,
      approvalRequired: false
    }
  ],
  edges: []
};

/** Matches the one line a contract-less start owes the operator. */
const WARNING = /warning: run run_[A-Za-z0-9_-]+ started without a requirement contract \(skipContract: true\)/;

function warningLines(err: readonly string[]): string[] {
  return err
    .join("")
    .split("\n")
    .filter((line) => WARNING.test(line));
}

test("run --children discloses the skipped coverage gate exactly once, on stderr", async () => {
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
        stateRoot
      ],
      io
    );

    assert.equal(code, 0, err.join(""));
    const warnings = warningLines(err);
    assert.equal(warnings.length, 1, `expected exactly one warning, got ${JSON.stringify(warnings)}`);
    assert.match(warnings[0] as string, /Use --track for a coverage-gated start\./);
    assert.doesNotMatch(out.join(""), /skipContract/, "the disclosure belongs on stderr");
  });
});

test("run --flowchart discloses the skipped coverage gate exactly once", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const specPath = join(projectRoot, "flow.json");
    await writeFile(specPath, JSON.stringify(FLOWCHART_SPEC), "utf8");
    const { io, err } = capture();

    await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        "Draft the change",
        "--flowchart",
        specPath,
        "--executor",
        "fake",
        "--state-root",
        stateRoot
      ],
      io
    );

    assert.equal(warningLines(err).length, 1, err.join(""));
  });
});

test("the disclosure names the run it is about", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const specPath = join(projectRoot, "children.json");
    await writeFile(specPath, JSON.stringify(CHILD_SPEC), "utf8");
    const { io, out, err } = capture();

    await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        "Ship the parser",
        "--children",
        specPath,
        "--state-root",
        stateRoot
      ],
      io
    );

    const started = out.join("").match(/Run (run_[A-Za-z0-9_-]+): started/);
    const warned = (warningLines(err)[0] ?? "").match(/run (run_[A-Za-z0-9_-]+)/);
    assert.ok(started?.[1] !== undefined, out.join(""));
    assert.equal(warned?.[1], started[1]);
  });
});
