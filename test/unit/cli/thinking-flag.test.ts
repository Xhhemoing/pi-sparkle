import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, resolveThinkingLevel, type CliIo } from "../../../src/cli/main.js";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { parseCliErrorJson } from "../../../src/cli/errors.js";
import type { SparkleThinkingLevel } from "../../../src/pi-adapter/pi-executor.js";

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
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-thinking-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-thinking-proj-"));
  const savedLevel = process.env.PI_THINKING_LEVEL;
  delete process.env.PI_THINKING_LEVEL;
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await run(stateRoot, projectRoot);
  } finally {
    if (savedLevel === undefined) delete process.env.PI_THINKING_LEVEL;
    else process.env.PI_THINKING_LEVEL = savedLevel;
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

test("thinking level defaults to off and reads PI_THINKING_LEVEL when no flag is given", () => {
  assert.equal(resolveThinkingLevel(undefined, undefined), "off");
  assert.equal(resolveThinkingLevel(undefined, "medium"), "medium");
});

test("--thinking wins over PI_THINKING_LEVEL", () => {
  assert.equal(resolveThinkingLevel("high", "low"), "high");
  assert.equal(resolveThinkingLevel("off", "max"), "off");
  // An unusable ambient value must not defeat an explicit flag.
  assert.equal(resolveThinkingLevel("low", "nonsense"), "low");
});

test("every accepted level round-trips", () => {
  for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
    assert.equal(resolveThinkingLevel(level, undefined), level);
  }
});

test("an invalid level names its source and lists the allowed values", () => {
  assert.throws(
    () => resolveThinkingLevel("ultra", undefined),
    (error: unknown) =>
      error instanceof DomainValidationError &&
      /^--thinking must be one of off, minimal, low, medium, high, xhigh, max$/.test(error.message)
  );
  assert.throws(
    () => resolveThinkingLevel(undefined, "ultra"),
    (error: unknown) =>
      error instanceof DomainValidationError &&
      /^PI_THINKING_LEVEL must be one of off, minimal, low, medium, high, xhigh, max$/.test(error.message)
  );
});

test("run --thinking with an unknown level fails at parse-args before any run starts", async () => {
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
        "--thinking",
        "ultra"
      ],
      io
    );
    assert.equal(code, 1);
    const parsed = parseCliErrorJson(err.join(""));
    assert.equal(parsed?.command, "run");
    assert.equal(parsed?.stage, "parse-args");
    assert.match(err.join(""), /--thinking must be one of off, minimal, low, medium, high, xhigh, max/);
    assert.deepEqual(out, []);
  });
});

test("run accepts --thinking on the fake executor path and ignores an unusable PI_THINKING_LEVEL", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    process.env.PI_THINKING_LEVEL = "ultra";
    const { io, out } = capture();
    const code = await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        "x",
        "--state-root",
        stateRoot,
        "--executor",
        "fake",
        "--thinking",
        "high"
      ],
      io
    );
    assert.equal(code, 0);
    assert.match(out.join(""), /COMPLETED/);
  });
});

test("run rejects an unusable PI_THINKING_LEVEL when --thinking is absent", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    process.env.PI_THINKING_LEVEL = "ultra";
    const { io, err } = capture();
    const code = await main(
      ["run", "--project", projectRoot, "--objective", "x", "--state-root", stateRoot],
      io
    );
    assert.equal(code, 1);
    assert.match(err.join(""), /PI_THINKING_LEVEL must be one of off, minimal, low, medium, high, xhigh, max/);
  });
});

test("run --executor fake still refuses an unusable PI_THINKING_LEVEL before the run starts", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    process.env.PI_THINKING_LEVEL = "ultra";
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
        "--executor",
        "fake"
      ],
      io
    );
    assert.equal(code, 1);
    // The fake executor never runs: an ambient level this CLI cannot honour is
    // rejected before the run, not silently downgraded to "off".
    assert.deepEqual(out, []);
    const parsed = parseCliErrorJson(err.join(""));
    assert.equal(parsed?.command, "run");
    assert.match(err.join(""), /PI_THINKING_LEVEL must be one of off, minimal, low, medium, high, xhigh, max/);
  });
});

test("usage documents --thinking and its precedence over PI_THINKING_LEVEL", async () => {
  const { io, out } = capture();
  assert.equal(await main(["help"], io), 0);
  const usage = out.join("");
  assert.match(usage, /--thinking <level>/);
  assert.match(usage, /wins over PI_THINKING_LEVEL/);
});

test("usage lists exactly the levels the CLI accepts", async () => {
  const { io, out } = capture();
  assert.equal(await main(["help"], io), 0);
  const documented = /--thinking\s*<([a-z|\n]+)>\s+sets the reasoning effort/.exec(out.join(""));
  assert.ok(documented, "USAGE should spell out the accepted --thinking levels");
  const levels = documented[1]!.replace(/\n/g, "").split("|");
  for (const level of levels) {
    assert.equal(resolveThinkingLevel(level, undefined), level);
  }
  assert.deepEqual(levels, ["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
});

/**
 * The Google clamp lives in pi-ai (see test/unit/pi-adapter/thinking-clamp.test.ts);
 * this CLI forwards the requested level untouched, so the only thing it owes a
 * user asking for xhigh on Gemini is the warning.
 */
test("usage warns that Google clamps the top two levels", async () => {
  const { io, out } = capture();
  assert.equal(await main(["help"], io), 0);
  assert.match(out.join(""), /Google models silently clamp xhigh\/max/);
});

/**
 * The CLI keeps its own level union (ADR-001: no Pi types in the CLI), so the
 * two lists can drift. This mirrors them at compile time: adding a level on
 * one side without the other fails typecheck here.
 */
type SameUnion<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

test("the CLI level union mirrors the adapter's SparkleThinkingLevel", () => {
  const mirrored: SameUnion<ReturnType<typeof resolveThinkingLevel>, SparkleThinkingLevel> = true;
  assert.equal(mirrored, true);
  const forwardable: SparkleThinkingLevel = resolveThinkingLevel("xhigh", undefined);
  assert.equal(forwardable, "xhigh");
});
