import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import { parseCliErrorJson } from "../../../src/cli/errors.js";
import { withIsolatedPiEnv } from "../../helpers/pi-env.js";

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (text) => out.push(text), stderr: (text) => err.push(text) },
    out,
    err
  };
}

async function withRoots(run: (stateRoot: string, projectRoot: string) => Promise<void>) {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-run-cap-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-run-cap-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await withIsolatedPiEnv(() => run(stateRoot, projectRoot));
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

function requireRunId(out: string[], err: string[]): string {
  const runId = out.join("").match(/Run (run_[A-Za-z0-9_-]+):/)?.[1];
  if (runId === undefined) {
    throw new Error(`expected a run id; stdout=${JSON.stringify(out)} stderr=${JSON.stringify(err)}`);
  }
  return runId;
}

async function createdRunLimits(stateRoot: string, runId: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(stateRoot, "runtime", "runs", runId, "events.jsonl"), "utf8");
  const created = raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as { type: string; payload: { run?: { limits?: unknown } } })
    .filter((event) => event.type === "RUN_CREATED");
  assert.equal(created.length, 1, "exactly one RUN_CREATED per run");
  return created[0]!.payload.run!.limits as Record<string, unknown>;
}

async function runDirectoryNames(stateRoot: string): Promise<string[]> {
  try {
    return await readdir(join(stateRoot, "runtime", "runs"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

test("run --max-cost-usd records the ceiling on the run's own RUN_CREATED", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const { io, out, err } = capture();
    const code = await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        "Ship it under a budget",
        "--state-root",
        stateRoot,
        "--max-cost-usd",
        "0.5"
      ],
      io
    );
    assert.equal(code, 0, err.join(""));
    const limits = await createdRunLimits(stateRoot, requireRunId(out, err));
    assert.equal(limits.maxCostUsd, 0.5);
  });
});

test("run without --max-cost-usd leaves maxCostUsd an absent key, not a zero", async () => {
  // The byte-level control for the flag: the no-flag call must still be the
  // call the CLI made before the flag existed, and an unbudgeted run must stay
  // visibly unbudgeted on disk rather than carrying a cap this layer invented.
  await withRoots(async (stateRoot, projectRoot) => {
    const { io, out, err } = capture();
    const code = await main(
      ["run", "--project", projectRoot, "--objective", "Ship it", "--state-root", stateRoot],
      io
    );
    assert.equal(code, 0, err.join(""));
    const limits = await createdRunLimits(stateRoot, requireRunId(out, err));
    assert.equal("maxCostUsd" in limits, false, JSON.stringify(limits));
  });
});

test("run --max-cost-usd refuses a non-decimal spelling and writes no run", async () => {
  // `-1` goes through the `=` spelling because `parseArgs` refuses a bare
  // dash-leading value as ambiguous before this CLI ever sees it; that arm is
  // node's own loud refusal, and the `=` form is what reaches ours.
  for (const [argv, raw] of [
    [["--max-cost-usd", "1e4"], "1e4"],
    [["--max-cost-usd", "0x10"], "0x10"],
    [["--max-cost-usd", "0"], "0"],
    [["--max-cost-usd=-1"], "-1"],
    [["--max-cost-usd", "abc"], "abc"],
    [["--max-cost-usd", " 5 "], " 5 "],
    [["--max-cost-usd", ""], ""]
  ] as const) {
    await withRoots(async (stateRoot, projectRoot) => {
      const { io, out, err } = capture();
      const code = await main(
        ["run", "--project", projectRoot, "--objective", "x", "--state-root", stateRoot, ...argv],
        io
      );
      assert.equal(code, 1);
      const parsed = parseCliErrorJson(err.join(""));
      assert.ok(parsed, err.join(""));
      assert.equal(parsed.command, "run");
      assert.equal(
        parsed.message,
        `--max-cost-usd must be a positive finite number of US dollars, got: ${raw}`
      );
      assert.deepEqual(out, []);
      assert.deepEqual(await runDirectoryNames(stateRoot), []);
    });
  }
});

test("run --max-cost-usd is refused loudly on --flowchart and --track before any work", async () => {
  // Neither plane forwards the cap today. Accepting the flag there would be a
  // ceiling the operator asked for that nothing enforces or even records.
  for (const extra of [
    ["--flowchart", "does-not-exist.json"],
    ["--track"]
  ]) {
    await withRoots(async (stateRoot, projectRoot) => {
      const { io, out, err } = capture();
      const code = await main(
        [
          "run",
          "--project",
          projectRoot,
          "--objective",
          "x",
          "--state-root",
          stateRoot,
          "--max-cost-usd",
          "0.5",
          ...extra
        ],
        io
      );
      assert.equal(code, 1);
      const parsed = parseCliErrorJson(err.join(""));
      assert.ok(parsed, err.join(""));
      assert.equal(parsed.command, "run");
      assert.equal(parsed.stage, "parse-args");
      assert.equal(
        parsed.message,
        "run --max-cost-usd is not wired for --flowchart or --track yet; it caps the default and --children paths"
      );
      assert.equal(parsed.next, "omit --max-cost-usd, or use the default or --children path");
      assert.deepEqual(out, []);
      // "before any work": the refusal precedes the flowchart file read, so a
      // missing spec file never gets a chance to produce a different error.
      assert.deepEqual(await runDirectoryNames(stateRoot), []);
    });
  }
});

test("usage documents the flag on the plain and --children run line and its limits", async () => {
  const { io, out } = capture();
  assert.equal(await main(["help"], io), 0);
  const usage = out.join("");
  assert.match(usage, /pi-sparkle run .*\[--max-cost-usd <usd>\].*\[--children <spec\.json>\]/);
  assert.match(usage, /tighter of it and that child's own\n?limits\.maxCostUsd/);
  assert.match(usage, /An unpriced model cannot enforce it and says so on stderr\./);
  // The disclosure that matters most: a run cap is not a shared pot.
  assert.match(usage, /no cross-child spend ledger: N children under a \$X run cap can spend\nup to N times \$X between them/);
  assert.match(usage, /refused on --flowchart and --track/);
});
