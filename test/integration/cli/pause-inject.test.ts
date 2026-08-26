import assert from "node:assert/strict";
import { access, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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

/** A run with no flowchart in its checkpoint: the plain fake-executor path. */
async function startPlainRun(stateRoot: string, projectRoot: string): Promise<string> {
  const started = capture();
  const code = await main(
    ["run", "--project", projectRoot, "--objective", "Plain run", "--state-root", stateRoot],
    started.io
  );
  assert.equal(code, 0);
  assert.match(started.out.join(""), /COMPLETED/);
  return parseRunIdFromOutput(started.out.join(""));
}

async function readEventsText(stateRoot: string, runId: string): Promise<string> {
  return readFile(join(stateRoot, "runtime", "runs", runId, "events.jsonl"), "utf8");
}

async function readEventLines(stateRoot: string, runId: string): Promise<number> {
  const text = await readEventsText(stateRoot, runId);
  return text.split("\n").filter((line) => line.trim() !== "").length;
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

    const before = await readEventLines(stateRoot, runId);
    const unknown = capture();
    const unknownCode = await main(
      ["inject", "--run", runId, "--type", "eval", "--key", "k", "--value", "v", "--state-root", stateRoot],
      unknown.io
    );
    assert.equal(unknownCode, 1);
    assert.match(unknown.err.join(""), /kind|unknown/i);
    const report = parseCliErrorJson(unknown.err.join(""));
    assert.equal(report?.command, "inject");
    assert.equal(report?.stage, "parse-args");
    assert.equal(report?.runId, runId);
    assert.equal(report?.message, 'unknown --type "eval": injection kind must be fact, override, or skip');
    assert.equal(report?.next, "pass --type fact, override, or skip");
    assert.deepEqual(unknown.out, []);
    // A refusal that never reached the plane cannot have written to the log.
    assert.equal(await readEventLines(stateRoot, runId), before);
  });
});

// The plane reads run shape before it reads the payload, so on a run with no
// flowchart snapshot a mistyped --type used to surface as a missing-snapshot
// checkpoint complaint that never named the flag.
test("unknown --type on a non-flowchart run reports parse-args, not a checkpoint", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await startPlainRun(stateRoot, projectRoot);
    const before = await readEventLines(stateRoot, runId);
    const { io, out, err } = capture();
    assert.equal(await main(["inject", "--run", runId, "--type", "banana", "--state-root", stateRoot], io), 1);
    assert.deepEqual(out, []);
    const report = parseCliErrorJson(err.join(""));
    assert.equal(report?.command, "inject");
    assert.equal(report?.stage, "parse-args");
    assert.equal(report?.runId, runId);
    assert.equal(report?.message, 'unknown --type "banana": injection kind must be fact, override, or skip');
    assert.doesNotMatch(err.join(""), /snapshot|checkpoint/i);
    assert.equal(await readEventLines(stateRoot, runId), before);
  });
});

test("a value-domain --type refusal precedes the missing-run lookup", async () => {
  await withRoots(async (stateRoot) => {
    const { io, out, err } = capture();
    const code = await main(
      ["inject", "--run", "run_missing0001", "--type", "banana", "--state-root", stateRoot],
      io
    );
    assert.equal(code, 1);
    assert.deepEqual(out, []);
    const report = parseCliErrorJson(err.join(""));
    assert.equal(report?.stage, "parse-args");
    assert.equal(report?.runId, "run_missing0001");
    assert.match(report?.next ?? "", /--type fact, override, or skip/);
    assert.doesNotMatch(err.join(""), /not found/);
  });
});

test("an out-of-domain --confidence reports parse-args before the plane", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await startWaiting(stateRoot, projectRoot);
    const before = await readEventLines(stateRoot, runId);
    // `-1` leads with a dash, so parseArgs itself only accepts the `=` form.
    // `""` and `"  "` are here because `Number` reads both as a finite 0: an
    // operator who passed no value must not record no-confidence instead.
    for (const raw of ["banana", "2", "-1", "", "  "]) {
      const { io, out, err } = capture();
      const code = await main(
        [
          "inject",
          "--run",
          runId,
          "--type",
          "override",
          "--node",
          "work",
          `--confidence=${raw}`,
          "--state-root",
          stateRoot
        ],
        io
      );
      assert.equal(code, 1);
      assert.deepEqual(out, []);
      const report = parseCliErrorJson(err.join(""));
      assert.equal(report?.command, "inject");
      assert.equal(report?.stage, "parse-args");
      assert.equal(report?.runId, runId);
      assert.equal(
        report?.message,
        `invalid --confidence "${raw}": confidence must be a finite number between 0 and 1`
      );
      assert.match(report?.next ?? "", /--confidence/);
      assert.equal(await readEventLines(stateRoot, runId), before);
    }
  });
});

test("the --confidence boundaries 0 and 1 still reach the plane", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await startWaiting(stateRoot, projectRoot);
    for (const raw of ["0", "1"]) {
      const { io, out, err } = capture();
      const code = await main(
        [
          "inject",
          "--run",
          runId,
          "--type",
          "override",
          "--node",
          "work",
          "--confidence",
          raw,
          "--state-root",
          stateRoot
        ],
        io
      );
      assert.equal(code, 0);
      assert.match(out.join(""), /Injected override node=work/);
      assert.deepEqual(err, []);
    }
    const eventsText = await readFile(join(stateRoot, "runtime", "runs", runId, "events.jsonl"), "utf8");
    assert.equal(eventsText.match(/INJECTION_REQUESTED/g)?.length, 2);
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

// The unlink swallows ENOENT, so the message is the only thing that can tell an
// operator whether a pause was actually lifted.
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

// A token that will not parse is still a token: what the operator needs to
// know is that the file is gone, which is exactly what the unlink reports. No
// second vocabulary for damaged JSON.
test("pause --clear removes a malformed pause.json and reports it as cleared", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await startWaiting(stateRoot, projectRoot);
    const pausePath = join(stateRoot, "runtime", "runs", runId, "pause.json");
    await writeFile(pausePath, "not-json", "utf8");

    const { io, out, err } = capture();
    assert.equal(await main(["pause", "--clear", "--run", runId, "--state-root", stateRoot], io), 0);
    assert.equal(out.join(""), `Cleared pause for ${runId}\n`);
    assert.deepEqual(err, []);
    await assert.rejects(access(pausePath));
  });
});

// A pasted-wrong run id is an argv typo, and doctor preflight cannot fix one.
test("pause on a malformed --run refuses parse-args and names the flag", async () => {
  await withRoots(async (stateRoot) => {
    const { io, out, err } = capture();
    assert.equal(await main(["pause", "--run", "banana", "--state-root", stateRoot], io), 1);
    assert.deepEqual(out, []);
    const report = parseCliErrorJson(err.join(""));
    assert.equal(report?.command, "pause");
    assert.equal(report?.stage, "parse-args");
    assert.equal(report?.message, 'invalid --run "banana": expected a run id of the form run_<suffix>');
    assert.equal(report?.next, `pass --run <runId> as printed by pnpm cli list --state-root ${stateRoot}`);
    assert.equal(report?.runId, "banana");
    assert.doesNotMatch(err.join(""), /doctor/);
  });
});

test("inject on a malformed --run refuses parse-args and names the flag", async () => {
  await withRoots(async (stateRoot) => {
    const { io, out, err } = capture();
    const code = await main(
      ["inject", "--run", "banana", "--type", "fact", "--key", "k", "--value", "v", "--state-root", stateRoot],
      io
    );
    assert.equal(code, 1);
    assert.deepEqual(out, []);
    const report = parseCliErrorJson(err.join(""));
    assert.equal(report?.command, "inject");
    assert.equal(report?.stage, "parse-args");
    assert.equal(report?.message, 'invalid --run "banana": expected a run id of the form run_<suffix>');
    assert.equal(report?.next, `pass --run <runId> as printed by pnpm cli list --state-root ${stateRoot}`);
    assert.equal(report?.runId, "banana");
    assert.doesNotMatch(err.join(""), /doctor/);
  });
});

// D30's precedence is pinned: the flag the operator mistyped is reported first.
test("a --type typo still outranks the malformed --run guard", async () => {
  await withRoots(async (stateRoot) => {
    const { io, out, err } = capture();
    assert.equal(await main(["inject", "--run", "banana", "--type", "banana", "--state-root", stateRoot], io), 1);
    assert.deepEqual(out, []);
    const report = parseCliErrorJson(err.join(""));
    assert.equal(report?.stage, "parse-args");
    assert.equal(report?.message, 'unknown --type "banana": injection kind must be fact, override, or skip');
    assert.equal(report?.runId, "banana");
  });
});

// The guard has to precede every state read, or a wrong id under a wrong state
// root reports whichever fault the filesystem happened to hit first.
test("the malformed --run guard precedes all state I/O", async () => {
  await withRoots(async (stateRoot) => {
    const missingRoot = join(stateRoot, "no-such-state-root");
    const { io, out, err } = capture();
    assert.equal(await main(["pause", "--run", "banana", "--state-root", missingRoot], io), 1);
    assert.deepEqual(out, []);
    const report = parseCliErrorJson(err.join(""));
    assert.equal(report?.command, "pause");
    assert.equal(report?.stage, "parse-args");
    assert.equal(report?.message, 'invalid --run "banana": expected a run id of the form run_<suffix>');
    assert.equal(report?.next, `pass --run <runId> as printed by pnpm cli list --state-root ${missingRoot}`);
    await assert.rejects(access(missingRoot));
  });
});

// The controller's own blank-reason rule, moved ahead of the event-log read: a
// blank flag must not cost the operator a state read or a written token.
test("pause on a blank --reason refuses parse-args and writes no token", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await startWaiting(stateRoot, projectRoot);
    const before = await readEventLines(stateRoot, runId);
    const pausePath = join(stateRoot, "runtime", "runs", runId, "pause.json");
    for (const raw of ["", "  "]) {
      const { io, out, err } = capture();
      assert.equal(
        await main(["pause", "--run", runId, `--reason=${raw}`, "--state-root", stateRoot], io),
        1
      );
      assert.deepEqual(out, []);
      const report = parseCliErrorJson(err.join(""));
      assert.equal(report?.command, "pause");
      assert.equal(report?.stage, "parse-args");
      assert.equal(report?.message, `invalid --reason "${raw}": pause reason must be a non-empty string`);
      assert.equal(report?.next, "pass --reason <text> or omit it");
      assert.equal(report?.runId, runId);
      assert.equal(await readEventLines(stateRoot, runId), before);
      await assert.rejects(access(pausePath));
    }
  });
});

// `--clear` plus `--reason` is refused for the flag combination, and that
// precedence is unchanged by the blank-value check that follows it.
test("pause --clear --reason keeps its combination refusal on a blank reason", async () => {
  await withRoots(async (stateRoot) => {
    const { io, err } = capture();
    assert.equal(await main(["pause", "--clear", "--run", "banana", "--reason=", "--state-root", stateRoot], io), 1);
    const report = parseCliErrorJson(err.join(""));
    assert.equal(report?.stage, "parse-args");
    assert.equal(report?.message, "pause --clear does not accept --reason");
    assert.equal(report?.next, "omit --reason when clearing a pause");
  });
});

test("inject refuses a blank --key, --node, or --actor before the plane", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await startWaiting(stateRoot, projectRoot);
    const before = await readEventLines(stateRoot, runId);
    const cases = [
      {
        flag: "--key",
        subject: "injection key",
        next: "pass --key <name>",
        argv: (raw: string) => ["--type", "fact", `--key=${raw}`, "--value", "v"]
      },
      {
        flag: "--node",
        subject: "injection nodeId",
        next: "pass --node <id>",
        argv: (raw: string) => ["--type", "skip", `--node=${raw}`]
      },
      {
        flag: "--actor",
        subject: "injection actor",
        next: "pass --actor <who> or omit it",
        argv: (raw: string) => ["--type", "fact", "--key", "k", "--value", "v", `--actor=${raw}`]
      }
    ];
    for (const { flag, subject, next, argv } of cases) {
      for (const raw of ["", "  "]) {
        const { io, out, err } = capture();
        const code = await main(
          ["inject", "--run", runId, ...argv(raw), "--state-root", stateRoot],
          io
        );
        assert.equal(code, 1);
        assert.deepEqual(out, []);
        const report = parseCliErrorJson(err.join(""));
        assert.equal(report?.command, "inject");
        assert.equal(report?.stage, "parse-args");
        assert.equal(report?.message, `invalid ${flag} "${raw}": ${subject} must be a non-empty string`);
        assert.equal(report?.next, next);
        assert.equal(report?.runId, runId);
        assert.equal(await readEventLines(stateRoot, runId), before);
      }
    }
  });
});

// A `fact` may legally carry a node id, so the guard keys on the flag being
// supplied rather than on the injection kind.
test("a blank --node is refused even when the type does not require one", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await startWaiting(stateRoot, projectRoot);
    const before = await readEventLines(stateRoot, runId);
    const { io, err } = capture();
    const code = await main(
      ["inject", "--run", runId, "--type", "fact", "--key", "k", "--value", "v", "--node=  ", "--state-root", stateRoot],
      io
    );
    assert.equal(code, 1);
    const report = parseCliErrorJson(err.join(""));
    assert.equal(report?.message, 'invalid --node "  ": injection nodeId must be a non-empty string');
    assert.equal(await readEventLines(stateRoot, runId), before);
  });
});

const BLANK_ROOT_NEXT = "pass --state-root <dir> or omit it to use the default ~/.pi-sparkle";

function blankRootMessage(raw: string): string {
  return `invalid --state-root "${raw}": state root must be a non-empty directory path`;
}

async function withCwd(dir: string, body: () => Promise<void>): Promise<void> {
  const saved = process.cwd();
  process.chdir(dir);
  try {
    await body();
  } finally {
    process.chdir(saved);
  }
}

// `--state-root ""` used to resolve to the process working directory, so the
// lookup answered `Run … not found under ` about the root the operator meant,
// and its remedy pasted as `pnpm cli list --state-root for the run ids …`.
test("pause refuses a blank --state-root on both its modes, all four fields", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await startWaiting(stateRoot, projectRoot);
    for (const mode of [[], ["--clear"]]) {
      for (const raw of ["", "  "]) {
        const { io, out, err } = capture();
        const code = await main(["pause", ...mode, "--run", runId, `--state-root=${raw}`], io);
        assert.equal(code, 1, [...mode, raw].join(" "));
        assert.deepEqual(out, []);
        const report = parseCliErrorJson(err.join(""));
        assert.equal(report?.command, "pause");
        assert.equal(report?.stage, "parse-args");
        assert.equal(report?.message, blankRootMessage(raw));
        assert.equal(report?.next, BLANK_ROOT_NEXT);
        assert.doesNotMatch(err.join(""), /not found under/);
      }
    }
  });
});

// The mixed case, pinned because it is the one that used to answer with the
// broken remedy: a blank root and a malformed run id together report the root,
// because the run-shape remedy interpolates the root it does not have.
test("pause --run banana --state-root '' reports the blank root, not the run shape", async () => {
  const { io, out, err } = capture();
  assert.equal(await main(["pause", "--run", "banana", "--state-root", ""], io), 1);
  assert.deepEqual(out, []);
  const report = parseCliErrorJson(err.join(""));
  assert.equal(report?.command, "pause");
  assert.equal(report?.stage, "parse-args");
  assert.equal(report?.message, blankRootMessage(""));
  assert.equal(report?.next, BLANK_ROOT_NEXT);
  assert.doesNotMatch(err.join(""), /expected a run id/);
});

// The argv checks that need no root keep their D31 precedence.
test("pause's root-free argv refusals still outrank the blank --state-root guard", async () => {
  const cases = [
    { argv: ["pause", "--state-root", ""], message: "pause requires --run <runId>" },
    {
      argv: ["pause", "--clear", "--run", "banana", "--reason=", "--state-root", ""],
      message: "pause --clear does not accept --reason"
    },
    {
      argv: ["pause", "--run", "banana", "--reason=  ", "--state-root", ""],
      message: 'invalid --reason "  ": pause reason must be a non-empty string'
    }
  ];
  for (const { argv, message } of cases) {
    const { io, err } = capture();
    assert.equal(await main(argv, io), 1, argv.join(" "));
    assert.equal(parseCliErrorJson(err.join(""))?.message, message, argv.join(" "));
  }
});

test("a refused blank --state-root leaves no state tree in the working directory", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-sparkle-pause-cli-cwd-"));
  try {
    await withCwd(cwd, async () => {
      for (const argv of [
        ["pause", "--run", "run_missing0001", "--state-root", ""],
        ["inject", "--run", "run_missing0001", "--type", "fact", "--key", "k", "--value", "v", "--state-root", ""]
      ]) {
        const { io, out } = capture();
        assert.equal(await main(argv, io), 1, argv.join(" "));
        assert.deepEqual(out, []);
      }
    });
    assert.deepEqual(await readdir(cwd), [], "a refusal reads and writes nothing beside the process");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("inject refuses a blank --state-root on every kind, all four fields", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await startWaiting(stateRoot, projectRoot);
    const before = await readEventLines(stateRoot, runId);
    const kinds = [
      ["--type", "fact", "--key", "k", "--value", "v"],
      ["--type", "skip", "--node", "work"]
    ];
    for (const kind of kinds) {
      for (const raw of ["", "  "]) {
        const { io, out, err } = capture();
        const code = await main(["inject", "--run", runId, ...kind, `--state-root=${raw}`], io);
        assert.equal(code, 1, [...kind, raw].join(" "));
        assert.deepEqual(out, []);
        const report = parseCliErrorJson(err.join(""));
        assert.equal(report?.command, "inject");
        assert.equal(report?.stage, "parse-args");
        assert.equal(report?.message, blankRootMessage(raw));
        assert.equal(report?.next, BLANK_ROOT_NEXT);
      }
    }
    assert.equal(await readEventLines(stateRoot, runId), before);
  });
});

test("inject's D30/D31 value-domain refusals still outrank the blank --state-root guard", async () => {
  const cases = [
    {
      argv: ["inject", "--run", "banana", "--type", "banana", "--state-root", ""],
      message: 'unknown --type "banana": injection kind must be fact, override, or skip'
    },
    {
      argv: ["inject", "--run", "banana", "--type", "override", "--node", "work", "--confidence=2", "--state-root", ""],
      message: 'invalid --confidence "2": confidence must be a finite number between 0 and 1'
    },
    {
      argv: ["inject", "--run", "banana", "--type", "fact", "--key=", "--value", "v", "--state-root", ""],
      message: 'invalid --key "": injection key must be a non-empty string'
    }
  ];
  for (const { argv, message } of cases) {
    const { io, err } = capture();
    assert.equal(await main(argv, io), 1, argv.join(" "));
    assert.equal(parseCliErrorJson(err.join(""))?.message, message, argv.join(" "));
  }
});

test("inject --run banana --state-root '' reports the blank root, not the run shape", async () => {
  const { io, out, err } = capture();
  const code = await main(
    ["inject", "--run", "banana", "--type", "fact", "--key", "k", "--value", "v", "--state-root", ""],
    io
  );
  assert.equal(code, 1);
  assert.deepEqual(out, []);
  const report = parseCliErrorJson(err.join(""));
  assert.equal(report?.message, blankRootMessage(""));
  assert.doesNotMatch(err.join(""), /expected a run id/);
});

// The plane's relevance rule reached the operator only after the run lookup,
// as `injection key is not valid for skip` with the doctor remedy. Passing a
// flag the kind does not take is argv, and the refusal has to name it.
test("inject refuses --key and --value on the kinds that do not take them", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await startWaiting(stateRoot, projectRoot);
    const before = await readEventsText(stateRoot, runId);
    const cases = [
      { type: "skip", flag: "--key", kindArgv: ["--type", "skip", "--node", "work", "--key", "k1"] },
      { type: "skip", flag: "--value", kindArgv: ["--type", "skip", "--node", "work", "--value", "v1"] },
      {
        type: "override",
        flag: "--key",
        kindArgv: ["--type", "override", "--node", "work", "--confidence", "0.5", "--key", "k1"]
      },
      {
        type: "override",
        flag: "--value",
        kindArgv: ["--type", "override", "--node", "work", "--confidence", "0.5", "--value", "v1"]
      }
    ];
    for (const { type, flag, kindArgv } of cases) {
      const { io, out, err } = capture();
      const code = await main(["inject", "--run", runId, ...kindArgv, "--state-root", stateRoot], io);
      assert.equal(code, 1, kindArgv.join(" "));
      assert.deepEqual(out, []);
      const report = parseCliErrorJson(err.join(""));
      assert.equal(report?.command, "inject");
      assert.equal(report?.stage, "parse-args");
      assert.equal(report?.message, `inject --type ${type} does not accept ${flag}`);
      assert.equal(report?.next, `drop ${flag}; --key and --value apply to --type fact`);
      assert.equal(report?.runId, runId);
      assert.doesNotMatch(err.join(""), /doctor|not valid for/);
      assert.equal(await readEventsText(stateRoot, runId), before);
    }
  });
});

// `--node` on a fact and `--confidence` on any kind are plane-legal, so the
// relevance guard must not sweep them up with the two flags it does refuse.
test("a fact carrying --node and every kind carrying --confidence still reach the plane", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await startWaiting(stateRoot, projectRoot);
    const withNode = capture();
    const nodeCode = await main(
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
        "--node",
        "work",
        "--state-root",
        stateRoot
      ],
      withNode.io
    );
    assert.equal(nodeCode, 0);
    assert.match(withNode.out.join(""), /Injected fact key=k value=v node=work/);
    assert.deepEqual(withNode.err, []);

    const withConfidence = capture();
    const confidenceCode = await main(
      [
        "inject",
        "--run",
        runId,
        "--type",
        "fact",
        "--key",
        "k2",
        "--value",
        "v2",
        "--confidence",
        "0.5",
        "--state-root",
        stateRoot
      ],
      withConfidence.io
    );
    assert.equal(confidenceCode, 0);
    assert.deepEqual(withConfidence.err, []);

    const skipped = capture();
    const skipCode = await main(
      ["inject", "--run", runId, "--type", "skip", "--node", "work", "--confidence", "0.5", "--state-root", stateRoot],
      skipped.io
    );
    assert.equal(skipCode, 0);
    assert.deepEqual(skipped.err, []);
  });
});

// `parseFactValue` used to run inside the request assembly, after the log read,
// so a pasted object arrived as a run validation failure that never said which
// flag was wrong. `1e999` is here because JSON parses it and the result is not
// a finite scalar — the domain rule, not a syntax rule.
test("inject refuses a non-scalar --value as parse-args and names the flag", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await startWaiting(stateRoot, projectRoot);
    const before = await readEventsText(stateRoot, runId);
    for (const raw of ['{"a":1}', "[1,2]", "null", "1e999"]) {
      const { io, out, err } = capture();
      const code = await main(
        ["inject", "--run", runId, "--type", "fact", "--key", "k", "--value", raw, "--state-root", stateRoot],
        io
      );
      assert.equal(code, 1, raw);
      assert.deepEqual(out, []);
      const report = parseCliErrorJson(err.join(""));
      assert.equal(report?.command, "inject");
      assert.equal(report?.stage, "parse-args");
      assert.equal(
        report?.message,
        `invalid --value "${raw}": fact value must be a JSON scalar or bare string; objects, arrays, and null are refused`
      );
      assert.equal(report?.next, "pass --value <json-scalar|text> as documented in pi-sparkle inject --help");
      assert.equal(report?.runId, runId);
      assert.doesNotMatch(err.join(""), /doctor/);
      assert.equal(await readEventsText(stateRoot, runId), before);
    }
  });
});

// An empty-string fact is legal in the plane, so the new guard must not invent
// a rule no plane owns.
test("an empty --value is still a legal fact", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await startWaiting(stateRoot, projectRoot);
    const { io, out, err } = capture();
    const code = await main(
      ["inject", "--run", runId, "--type", "fact", "--key", "empty", "--value=", "--state-root", stateRoot],
      io
    );
    assert.equal(code, 0);
    assert.deepEqual(err, []);
    assert.match(out.join(""), /facts: empty=/);
  });
});

// D30 and D31 keep their precedence: the mistyped kind reports before the
// value domain is consulted, and a blank --key still outranks a bad --value.
test("the unknown --type and blank --key refusals still outrank the --value domain", async () => {
  await withRoots(async (stateRoot) => {
    const unknown = capture();
    assert.equal(
      await main(
        [
          "inject",
          "--run",
          "run_missing0001",
          "--type",
          "banana",
          "--key",
          "k",
          "--value",
          '{"a":1}',
          "--state-root",
          stateRoot
        ],
        unknown.io
      ),
      1
    );
    assert.equal(
      parseCliErrorJson(unknown.err.join(""))?.message,
      'unknown --type "banana": injection kind must be fact, override, or skip'
    );

    const blankKey = capture();
    assert.equal(
      await main(
        [
          "inject",
          "--run",
          "run_missing0001",
          "--type",
          "fact",
          "--key=",
          "--value",
          '{"a":1}',
          "--state-root",
          stateRoot
        ],
        blankKey.io
      ),
      1
    );
    assert.equal(
      parseCliErrorJson(blankKey.err.join(""))?.message,
      'invalid --key "": injection key must be a non-empty string'
    );
  });
});

// The complete argv, with the command's required --run and fact's required
// --key both present, so the ordering it pins is the value guard against D37's
// blank-root guard and nothing else. The blank root resolves to the working
// directory, so an empty cwd afterwards is the proof no state was read or made.
test("a non-scalar --value reports before the blank --state-root and touches no state", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-sparkle-pause-cli-cwd-"));
  try {
    await withCwd(cwd, async () => {
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
          '{"a":1}',
          "--state-root",
          ""
        ],
        io
      );
      assert.equal(code, 1);
      assert.deepEqual(out, []);
      const report = parseCliErrorJson(err.join(""));
      assert.equal(report?.command, "inject");
      assert.equal(report?.stage, "parse-args");
      assert.equal(
        report?.message,
        'invalid --value "{"a":1}": fact value must be a JSON scalar or bare string; objects, arrays, and null are refused'
      );
      assert.equal(report?.next, "pass --value <json-scalar|text> as documented in pi-sparkle inject --help");
      assert.equal(report?.runId, "run_missing0001");
      assert.doesNotMatch(err.join(""), /state root|not found under/);
    });
    assert.deepEqual(await readdir(cwd), [], "a value refusal reads and writes nothing beside the process");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
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
