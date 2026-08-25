import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { formatFollowEventLine, main, type CliIo } from "../../../src/cli/main.js";
import type { Event } from "../../../src/run/events.js";
import { withIsolatedPiEnv } from "../../helpers/pi-env.js";

/**
 * `inspect --run --follow` end-to-end.
 *
 * The two claims a reader has to be able to trust: it stops (a run already in a
 * stopping state prints what is there and exits, and a live one exits when the
 * log reaches one), and it is a pure reader (no lock file, no appended event,
 * no daemon left behind). The live case appends to `events.jsonl` underneath a
 * running follow — including one deliberately torn line — because that is the
 * only way to show the tail tolerance is real rather than asserted.
 */

const REPO_ROOT = process.cwd();

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
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-follow-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-follow-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await withIsolatedPiEnv(() => run(stateRoot, projectRoot));
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

async function completedRun(stateRoot: string, projectRoot: string): Promise<string> {
  const started = capture();
  const code = await main(
    ["run", "--project", projectRoot, "--objective", "Audit the project", "--state-root", stateRoot],
    started.io
  );
  assert.equal(code, 0, started.err.join(""));
  const runId = started.out.join("").match(/Run (run_[A-Za-z0-9_-]+):/)?.[1];
  assert.ok(runId, "the fake run prints its id");
  return runId;
}

function eventLogPath(stateRoot: string, runId: string): string {
  return join(stateRoot, "runtime", "runs", runId, "events.jsonl");
}

async function eventLines(stateRoot: string, runId: string): Promise<string[]> {
  return (await readFile(eventLogPath(stateRoot, runId), "utf8")).trim().split("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

test("follow on an already-terminal run prints its events and exits 0", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await completedRun(stateRoot, projectRoot);
    const persisted = await eventLines(stateRoot, runId);

    const { io, out, err } = capture();
    const code = await main(["inspect", "--run", runId, "--state-root", stateRoot, "--follow"], io);
    assert.equal(code, 0, err.join(""));

    const text = out.join("");
    assert.match(text, /following events\.jsonl \(read-only/);
    assert.match(text, /stops at: COMPLETED, FAILED, CANCELLED, BLOCKED, WAITING_FOR_USER, PAUSED/);
    assert.match(text, new RegExp(`Run ${runId}: COMPLETED \\(${persisted.length} events, follow stopped\\)`));
    assert.deepEqual(err, [], "a clean tail warns about nothing");
    // Every persisted event, in log order, printed in the prose line format.
    for (const line of persisted) {
      assert.ok(
        text.includes(formatFollowEventLine(JSON.parse(line) as Event)),
        `follow omitted or reformatted ${line}`
      );
    }
  });
});

test("follow takes no lock and appends nothing", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await completedRun(stateRoot, projectRoot);
    const before = await readFile(eventLogPath(stateRoot, runId), "utf8");

    const { io, err } = capture();
    assert.equal(await main(["inspect", "--run", runId, "--state-root", stateRoot, "--follow"], io), 0, err.join(""));

    assert.equal(await readFile(eventLogPath(stateRoot, runId), "utf8"), before, "follow is read-only");
    await assert.rejects(
      () => stat(join(stateRoot, "runtime", "runs", `${runId}.lock`)),
      /ENOENT/,
      "follow never takes the run lock an appender could collide with"
    );
  });
});

test("follow --json keeps stdout a pure event stream and reports the status on stderr", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await completedRun(stateRoot, projectRoot);
    const persisted = await eventLines(stateRoot, runId);

    const { io, out, err } = capture();
    const code = await main(
      ["inspect", "--run", runId, "--state-root", stateRoot, "--follow", "--json"],
      io
    );
    assert.equal(code, 0);

    const lines = out.join("").trim().split("\n");
    assert.equal(lines.length, persisted.length, "nothing is appended to the event stream");
    for (const line of lines) {
      const event = JSON.parse(line) as { id?: unknown; type?: unknown };
      assert.ok(typeof event.id === "string" && event.id !== "", "every stdout line is a domain Event");
    }
    assert.match(err.join(""), new RegExp(`Run ${runId}: COMPLETED \\(\\d+ events, follow stopped\\)`));
  });
});

test("follow picks up events appended after it started, including a torn line", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    // A real event log, replayed into a second state root up to (but not
    // including) its terminal event, so the follow below starts on a RUNNING
    // run and the appends are byte-identical to what the runtime writes.
    const sourceRunId = await completedRun(stateRoot, projectRoot);
    const lines = await eventLines(stateRoot, sourceRunId);
    const terminalIndex = lines.findIndex((line) => line.includes('"type":"RUN_COMPLETED"'));
    assert.ok(terminalIndex > 0, "the fixture run has a terminal event with events before it");

    const liveRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-follow-live-"));
    try {
      const path = eventLogPath(liveRoot, sourceRunId);
      await mkdir(join(liveRoot, "runtime", "runs", sourceRunId), { recursive: true });
      const head = lines.slice(0, terminalIndex);
      const tail = lines.slice(terminalIndex);
      await writeFile(path, `${head.join("\n")}\n`, "utf8");

      const { io, out, err } = capture();
      const followed = main(["inspect", "--run", sourceRunId, "--state-root", liveRoot, "--follow"], io);

      // Half of the terminal event first: a follower must not print or choke on
      // a line the writer has not finished.
      await sleep(400);
      const split = Math.floor(tail[0]!.length / 2);
      await appendFile(path, tail[0]!.slice(0, split), "utf8");
      await sleep(400);
      assert.ok(!out.join("").includes("RUN_COMPLETED"), "a half-written event is never printed");
      await appendFile(path, `${tail[0]!.slice(split)}\n`, "utf8");
      for (const line of tail.slice(1)) await appendFile(path, `${line}\n`, "utf8");

      assert.equal(await followed, 0, err.join(""));
      const text = out.join("");
      assert.match(text, /RUN_STARTED/, "events already on disk are printed at attach");
      assert.match(text, /RUN_COMPLETED/, "events appended during the follow are printed too");
      assert.match(text, new RegExp(`Run ${sourceRunId}: COMPLETED \\(${lines.length} events, follow stopped\\)`));
      assert.deepEqual(err, [], "a tail that completed is not reported as truncated");
    } finally {
      await rm(liveRoot, { recursive: true, force: true });
    }
  });
});

test("follow refuses --summary-json and is unavailable for --episode", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await completedRun(stateRoot, projectRoot);

    const both = capture();
    assert.equal(
      await main(
        ["inspect", "--run", runId, "--state-root", stateRoot, "--follow", "--summary-json"],
        both.io
      ),
      1
    );
    assert.match(both.err.join(""), /either --follow or --summary-json/);
    assert.deepEqual(both.out, [], "a refused invocation writes nothing to stdout");

    const inspected = capture();
    await main(["inspect", "--run", runId, "--state-root", stateRoot], inspected.io);
    const episodeId = inspected.out.join("").match(/episode: (ep_[A-Za-z0-9_-]+)/)?.[1];
    assert.ok(episodeId, "the fake run binds an episode");

    const episode = capture();
    assert.equal(
      await main(["inspect", "--episode", episodeId, "--state-root", stateRoot, "--follow"], episode.io),
      1
    );
    assert.match(episode.err.join(""), /--follow is only available with --run/);
    assert.deepEqual(episode.out, []);
  });
});

/**
 * A `RUNNING` log nothing will ever append to again — what a SIGKILL leaves
 * behind — in its own state root, so a follow attached to it hangs unless
 * something bounds it.
 */
async function abandonedRunningRun(
  stateRoot: string,
  projectRoot: string,
  liveRoot: string
): Promise<string> {
  const runId = await completedRun(stateRoot, projectRoot);
  const lines = await eventLines(stateRoot, runId);
  const terminalIndex = lines.findIndex((line) => line.includes('"type":"RUN_COMPLETED"'));
  assert.ok(terminalIndex > 0, "the fixture run has a terminal event with events before it");
  await mkdir(join(liveRoot, "runtime", "runs", runId), { recursive: true });
  await writeFile(eventLogPath(liveRoot, runId), `${lines.slice(0, terminalIndex).join("\n")}\n`, "utf8");
  return runId;
}

test("follow --idle-timeout-ms gives up on a log nothing is appending to and exits 1", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const liveRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-follow-idle-"));
    try {
      const runId = await abandonedRunningRun(stateRoot, projectRoot, liveRoot);
      const before = await readFile(eventLogPath(liveRoot, runId), "utf8");

      const { io, out, err } = capture();
      const code = await main(
        ["inspect", "--run", runId, "--state-root", liveRoot, "--follow", "--idle-timeout-ms", "1"],
        io
      );

      assert.equal(code, 1, "silence is a follow failure, not a run that stopped");
      const text = out.join("");
      assert.match(text, /gives up after: 1ms with no new event/, "the deadline is stated up front");
      assert.match(text, /RUN_STARTED/, "what was on disk is still printed before giving up");
      assert.doesNotMatch(text, /follow stopped/, "a timeout is never dressed up as a stopping status");
      const errors = err.join("");
      assert.match(errors, /appended no event for 1ms and is still RUNNING/);
      assert.match(errors, /--idle-timeout-ms/, "the remedy names the flag to drop to keep waiting");
      assert.equal(
        await readFile(eventLogPath(liveRoot, runId), "utf8"),
        before,
        "giving up is still read-only"
      );
    } finally {
      await rm(liveRoot, { recursive: true, force: true });
    }
  });
});

test("follow --json --idle-timeout-ms keeps stdout a pure event stream when it gives up", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const liveRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-follow-idle-json-"));
    try {
      const runId = await abandonedRunningRun(stateRoot, projectRoot, liveRoot);
      const { io, out, err } = capture();
      const code = await main(
        ["inspect", "--run", runId, "--state-root", liveRoot, "--follow", "--json", "--idle-timeout-ms", "1"],
        io
      );

      assert.equal(code, 1);
      for (const line of out.join("").trim().split("\n")) {
        const event = JSON.parse(line) as { id?: unknown };
        assert.ok(typeof event.id === "string" && event.id !== "", "the failure never lands on stdout");
      }
      assert.match(err.join(""), /appended no event for 1ms/);
    } finally {
      await rm(liveRoot, { recursive: true, force: true });
    }
  });
});

test("follow --idle-timeout-ms leaves a run that reaches a stopping status exiting 0", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await completedRun(stateRoot, projectRoot);
    const { io, out, err } = capture();
    // The deadline is opt-in and only about silence: a log that stopped
    // because the run stopped reports the status it reached, as it always did.
    const code = await main(
      ["inspect", "--run", runId, "--state-root", stateRoot, "--follow", "--idle-timeout-ms", "1"],
      io
    );
    assert.equal(code, 0, err.join(""));
    assert.match(out.join(""), new RegExp(`Run ${runId}: COMPLETED \\(\\d+ events, follow stopped\\)`));
  });
});

test("--idle-timeout-ms is refused without --follow and refused when it is not a positive integer", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await completedRun(stateRoot, projectRoot);

    const withoutFollow = capture();
    assert.equal(
      await main(
        ["inspect", "--run", runId, "--state-root", stateRoot, "--idle-timeout-ms", "1000"],
        withoutFollow.io
      ),
      1
    );
    assert.match(withoutFollow.err.join(""), /--idle-timeout-ms is only meaningful with --follow/);
    assert.deepEqual(withoutFollow.out, [], "a refused invocation writes nothing to stdout");

    // `Number` would take every one of these; a follow that waits a different
    // amount of time than the operator typed is worse than one that refuses.
    for (const value of ["0", "-1", "1.5", "1e4", "0x10", " 5 ", "abc", "86400001"]) {
      // A dash-leading value needs the `=` spelling; parseArgs refuses an
      // option-like token as an option's argument before we get to see it.
      const flag = value.startsWith("-")
        ? [`--idle-timeout-ms=${value}`]
        : ["--idle-timeout-ms", value];
      const bad = capture();
      assert.equal(
        await main(["inspect", "--run", runId, "--state-root", stateRoot, "--follow", ...flag], bad.io),
        1,
        `--idle-timeout-ms ${value} must be refused`
      );
      assert.match(bad.err.join(""), /--idle-timeout-ms must be a whole number of milliseconds/);
      assert.deepEqual(bad.out, [], "a refused deadline never attaches a follow");
    }
  });
});

test("follow reports a run whose log disappeared under it", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await completedRun(stateRoot, projectRoot);
    const { io, err } = capture();
    // Truncating to nothing is what a delete looks like from a reader's side.
    await writeFile(eventLogPath(stateRoot, runId), "", "utf8");
    const code = await main(["inspect", "--run", runId, "--state-root", stateRoot, "--follow"], io);
    // The pre-flight read reports the run as missing before follow attaches;
    // either way the operator is told, and nothing hangs.
    assert.equal(code, 1);
    assert.match(err.join(""), /not found|disappeared/);
  });
});

test("the spawned CLI exits on its own from a run that will never append again", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const liveRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-follow-idle-spawn-"));
    try {
      const runId = await abandonedRunningRun(stateRoot, projectRoot, liveRoot);
      // The whole point, in the only shape that proves it: a real process, on
      // the log a SIGKILL leaves behind, ending without anyone pressing Ctrl-C.
      const spawned = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli/main.ts",
          "inspect",
          "--run",
          runId,
          "--state-root",
          liveRoot,
          "--follow",
          "--idle-timeout-ms",
          "1"
        ],
        { cwd: REPO_ROOT, encoding: "utf8", timeout: 30_000 }
      );
      assert.equal(spawned.signal, null, "the deadline ends it, not the test's kill timer");
      assert.equal(spawned.status, 1, spawned.stderr);
      assert.match(spawned.stderr, /appended no event for 1ms and is still RUNNING/);
    } finally {
      await rm(liveRoot, { recursive: true, force: true });
    }
  });
});

test("the spawned CLI exits on its own when following a terminal run", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await completedRun(stateRoot, projectRoot);
    const stdout = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/cli/main.ts", "inspect", "--run", runId, "--state-root", stateRoot, "--follow"],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 30_000 }
    );
    assert.match(stdout, /follow stopped/);
  });
});
