import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import { parseCliErrorJson } from "../../../src/cli/errors.js";
import { INJECT_USAGE } from "../../../src/cli/inject.js";
import { PAUSE_USAGE } from "../../../src/cli/pause.js";
import { withIsolatedPiEnv } from "../../helpers/pi-env.js";

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

const WAITING_FLOWCHART = {
  id: "cli-pause-wait",
  nodes: [
    {
      id: "gate",
      taskId: "tsk_gate",
      role: "router",
      objective: "Choose work",
      modelPolicy: { allowedModels: ["premium"] },
      confidenceThreshold: 0.7,
      approvalRequired: true
    },
    {
      id: "work",
      taskId: "tsk_work",
      role: "actor",
      objective: "Do the work",
      modelPolicy: { allowedModels: ["cheap"] },
      confidenceThreshold: 0.7,
      approvalRequired: false
    }
  ],
  edges: [{ from: "gate", to: "work", condition: { type: "success", expected: true } }]
};

const WORK_RESULTS = {
  work: { outcome: "SUCCESS", confidence: 0.9, evidenceIds: ["evd_work"] }
};

const TINY_FLOWCHART = {
  id: "cli-pause-tiny",
  nodes: [
    {
      id: "only",
      taskId: "tsk_only",
      role: "actor",
      objective: "Do the work",
      modelPolicy: { allowedModels: ["cheap"] },
      confidenceThreshold: 0.7,
      approvalRequired: false
    }
  ],
  edges: []
};

function parseRunIdFromOutput(text: string): string {
  const runId = text.match(/Run (run_[A-Za-z0-9_-]+):/)?.[1];
  assert.ok(runId);
  return runId;
}

async function withRoots(run: (stateRoot: string, projectRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-pause-cli-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-pause-cli-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await withIsolatedPiEnv(() => run(stateRoot, projectRoot));
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

async function startWaiting(stateRoot: string, projectRoot: string): Promise<string> {
  const flowchartPath = join(projectRoot, "flow.json");
  await writeFile(flowchartPath, JSON.stringify(WAITING_FLOWCHART), "utf8");
  const started = capture();
  const code = await main(
    [
      "run",
      "--project",
      projectRoot,
      "--objective",
      "Ship the gate",
      "--flowchart",
      flowchartPath,
      "--state-root",
      stateRoot
    ],
    started.io
  );
  assert.equal(code, 0);
  assert.match(started.out.join(""), /WAITING_FOR_USER/);
  return parseRunIdFromOutput(started.out.join(""));
}

test("pause records PAUSE_REQUESTED and inspect/replay show PAUSED", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await startWaiting(stateRoot, projectRoot);
    const paused = capture();
    const pauseCode = await main(
      ["pause", "--run", runId, "--reason", "hold", "--state-root", stateRoot],
      paused.io
    );
    assert.equal(pauseCode, 0);

    const inspected = capture();
    const inspectCode = await main(["inspect", "--run", runId, "--state-root", stateRoot], inspected.io);
    assert.equal(inspectCode, 0);
    assert.match(inspected.out.join(""), /PAUSED/);

    const eventsText = await readFile(join(stateRoot, "runtime", "runs", runId, "events.jsonl"), "utf8");
    assert.match(eventsText, /PAUSE_REQUESTED/);
    const checkpoint = JSON.parse(await readFile(join(stateRoot, "runtime", "runs", runId, "checkpoint.json"), "utf8")) as {
      status: string;
    };
    assert.equal(checkpoint.status, "PAUSED");
  });
});

test("answer while paused fails closed and does not record USER_ANSWER", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await startWaiting(stateRoot, projectRoot);
    await main(["pause", "--run", runId, "--state-root", stateRoot], capture().io);
    const answered = capture();
    const code = await main(
      ["answer", "--run", runId, "--selected", "work", "--state-root", stateRoot],
      answered.io
    );
    assert.equal(code, 1);
    assert.match(answered.err.join(""), /run is paused; pass --unpause to continue/);
    assert.doesNotMatch(answered.out.join(""), /Recorded answer/);
    const eventsText = await readFile(join(stateRoot, "runtime", "runs", runId, "events.jsonl"), "utf8");
    assert.doesNotMatch(eventsText, /USER_ANSWER/);
  });
});

test("resume without --unpause exits 1 on a paused flowchart", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await startWaiting(stateRoot, projectRoot);
    await main(["pause", "--run", runId, "--state-root", stateRoot], capture().io);
    const resumed = capture();
    const code = await main(["resume", "--run", runId, "--state-root", stateRoot], resumed.io);
    assert.equal(code, 1);
    assert.match(resumed.err.join(""), /run is paused; pass --unpause to continue/);
  });
});

test("inject fact then resume --unpause --selected continues with the fact in the snapshot", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await startWaiting(stateRoot, projectRoot);
    await main(["pause", "--run", runId, "--state-root", stateRoot], capture().io);
    const injected = capture();
    const injectCode = await main(
      [
        "inject",
        "--run",
        runId,
        "--type",
        "fact",
        "--key",
        "k",
        "--value",
        "v",
        "--state-root",
        stateRoot
      ],
      injected.io
    );
    assert.equal(injectCode, 0);
    assert.match(injected.out.join(""), /fact/);

    const resultsPath = join(projectRoot, "results.json");
    await writeFile(resultsPath, JSON.stringify(WORK_RESULTS), "utf8");
    const resumed = capture();
    const resumeCode = await main(
      [
        "resume",
        "--run",
        runId,
        "--unpause",
        "--selected",
        "work",
        "--results",
        resultsPath,
        "--state-root",
        stateRoot
      ],
      resumed.io
    );
    assert.equal(resumeCode, 0);
    assert.match(resumed.out.join(""), /COMPLETED/);
    const checkpoint = JSON.parse(await readFile(join(stateRoot, "runtime", "runs", runId, "checkpoint.json"), "utf8")) as {
      flowchart: { snapshot: { facts: Record<string, unknown> } };
    };
    assert.equal(checkpoint.flowchart.snapshot.facts.k, "v");
  });
});

test("inject skip on a PENDING successor and unknown --type fail closed as required", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await startWaiting(stateRoot, projectRoot);
    const skipped = capture();
    const skipCode = await main(
      ["inject", "--run", runId, "--type", "skip", "--node", "work", "--state-root", stateRoot],
      skipped.io
    );
    assert.equal(skipCode, 0);
    const checkpoint = JSON.parse(await readFile(join(stateRoot, "runtime", "runs", runId, "checkpoint.json"), "utf8")) as {
      flowchart: { snapshot: { nodes: Record<string, { state: string }> } };
    };
    assert.equal(checkpoint.flowchart.snapshot.nodes.work?.state, "SKIPPED");

    const unknown = capture();
    const unknownCode = await main(
      ["inject", "--run", runId, "--type", "eval", "--key", "k", "--value", "v", "--state-root", stateRoot],
      unknown.io
    );
    assert.equal(unknownCode, 1);
    assert.match(unknown.err.join(""), /kind|unknown/i);
  });
});

test("pause and inject fail closed on a completed run", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const flowchartPath = join(projectRoot, "flow.json");
    const resultsPath = join(projectRoot, "results.json");
    await writeFile(flowchartPath, JSON.stringify(TINY_FLOWCHART), "utf8");
    await writeFile(resultsPath, JSON.stringify({ only: { outcome: "SUCCESS", confidence: 0.9 } }), "utf8");
    const started = capture();
    const startCode = await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        "done",
        "--flowchart",
        flowchartPath,
        "--results",
        resultsPath,
        "--state-root",
        stateRoot
      ],
      started.io
    );
    assert.equal(startCode, 0);
    assert.match(started.out.join(""), /COMPLETED/);
    const runId = parseRunIdFromOutput(started.out.join(""));

    const paused = capture();
    assert.equal(await main(["pause", "--run", runId, "--state-root", stateRoot], paused.io), 1);
    assert.match(paused.err.join(""), /COMPLETED|fail/i);

    const injected = capture();
    assert.equal(
      await main(
        ["inject", "--run", runId, "--type", "fact", "--key", "k", "--value", "v", "--state-root", stateRoot],
        injected.io
      ),
      1
    );
    assert.match(injected.err.join(""), /COMPLETED|fail/i);
  });
});

test("inject --help and inject help print the usage and exit 0", async () => {
  for (const form of ["--help", "help", "-h"]) {
    const { io, out, err } = capture();
    assert.equal(await main(["inject", form], io), 0);
    assert.equal(out.join(""), INJECT_USAGE);
    assert.deepEqual(err, []);
  }
});

test("a malformed inject flag reports parse-args and points at inject --help", async () => {
  const { io, out, err } = capture();
  assert.equal(await main(["inject", "--run", "x", "--typ", "fact"], io), 1);
  assert.deepEqual(out, []);
  const report = parseCliErrorJson(err.join(""));
  assert.equal(report?.command, "inject");
  assert.equal(report?.stage, "parse-args");
  assert.match(report?.next ?? "", /inject --help/);
});

test("pause --help and pause help print the usage and exit 0", async () => {
  for (const form of ["--help", "help", "-h"]) {
    const { io, out, err } = capture();
    assert.equal(await main(["pause", form], io), 0);
    assert.equal(out.join(""), PAUSE_USAGE);
    assert.deepEqual(err, []);
  }
});

test("a malformed pause flag reports parse-args and points at pause --help", async () => {
  const { io, out, err } = capture();
  assert.equal(await main(["pause", "--run", "x", "--rason", "hold"], io), 1);
  assert.deepEqual(out, []);
  const report = parseCliErrorJson(err.join(""));
  assert.equal(report?.command, "pause");
  assert.equal(report?.stage, "parse-args");
  assert.match(report?.next ?? "", /pause --help/);
});

test("inject on a run that does not exist refuses at lookup and points at list", async () => {
  await withRoots(async (stateRoot) => {
    const { io, out, err } = capture();
    const code = await main(
      [
        "inject",
        "--run",
        "run_missing0001",
        "--type",
        "fact",
        "--key",
        "k",
        "--value",
        "v",
        "--state-root",
        stateRoot
      ],
      io
    );
    assert.equal(code, 1);
    assert.deepEqual(out, []);
    const report = parseCliErrorJson(err.join(""));
    assert.equal(report?.command, "inject");
    assert.equal(report?.stage, "lookup");
    assert.equal(report?.runId, "run_missing0001");
    assert.match(report?.next ?? "", /pnpm cli list/);
    assert.ok((report?.next ?? "").includes(stateRoot));
  });
});

test("pause on a run that does not exist gives inject's remedy verbatim", async () => {
  await withRoots(async (stateRoot) => {
    const { io, out, err } = capture();
    const code = await main(["pause", "--run", "run_missing0001", "--state-root", stateRoot], io);
    assert.equal(code, 1);
    assert.deepEqual(out, []);
    const report = parseCliErrorJson(err.join(""));
    assert.equal(report?.command, "pause");
    assert.equal(report?.stage, "lookup");
    assert.equal(report?.runId, "run_missing0001");
    assert.match(report?.next ?? "", /pnpm cli list/);
    assert.equal(
      report?.next,
      `check --state-root, then pnpm cli list --state-root ${stateRoot} for the run ids that exist there`
    );
  });
});

// `clearPause` swallows ENOENT, so the message is the only thing that can tell
// an operator whether a pause was actually lifted.
test("pause --clear claims only the token it removed", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await startWaiting(stateRoot, projectRoot);
    const pausePath = join(stateRoot, "runtime", "runs", runId, "pause.json");

    const absent = capture();
    assert.equal(await main(["pause", "--clear", "--run", runId, "--state-root", stateRoot], absent.io), 0);
    assert.equal(absent.out.join(""), `No pause token for ${runId}; nothing to clear\n`);
    assert.deepEqual(absent.err, []);

    assert.equal(await main(["pause", "--run", runId, "--state-root", stateRoot], capture().io), 0);
    await access(pausePath);
    const cleared = capture();
    assert.equal(await main(["pause", "--clear", "--run", runId, "--state-root", stateRoot], cleared.io), 0);
    assert.equal(cleared.out.join(""), `Cleared pause for ${runId}\n`);
    await assert.rejects(access(pausePath));

    // A clear that follows a real one must not claim the same work twice.
    const again = capture();
    assert.equal(await main(["pause", "--clear", "--run", runId, "--state-root", stateRoot], again.io), 0);
    assert.match(again.out.join(""), /nothing to clear/);
  });
});

test("pause --clear on a malformed pause.json clears it and says so", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await startWaiting(stateRoot, projectRoot);
    const pausePath = join(stateRoot, "runtime", "runs", runId, "pause.json");
    await writeFile(pausePath, "not-json", "utf8");

    const { io, out, err } = capture();
    assert.equal(await main(["pause", "--clear", "--run", runId, "--state-root", stateRoot], io), 0);
    assert.equal(out.join(""), `Cleared malformed pause token for ${runId}\n`);
    assert.deepEqual(err, []);
    await assert.rejects(access(pausePath));
  });
});

test("pause fails closed on a BLOCKED flowchart", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const flowchartPath = join(projectRoot, "flow.json");
    await writeFile(flowchartPath, JSON.stringify(TINY_FLOWCHART), "utf8");
    const started = capture();
    const startCode = await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        "stall",
        "--flowchart",
        flowchartPath,
        "--state-root",
        stateRoot
      ],
      started.io
    );
    assert.equal(startCode, 1);
    assert.match(started.out.join(""), /BLOCKED/);
    const runId = parseRunIdFromOutput(started.out.join(""));

    const paused = capture();
    assert.equal(await main(["pause", "--run", runId, "--state-root", stateRoot], paused.io), 1);
    assert.match(paused.err.join(""), /BLOCKED/);
  });
});
