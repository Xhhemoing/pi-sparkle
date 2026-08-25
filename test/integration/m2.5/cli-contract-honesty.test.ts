import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import { parseRunId, type RunId } from "../../../src/domain/ids.js";
import type { AcceptanceCriterion } from "../../../src/domain/episode.js";
import { CheckpointStore } from "../../../src/run/checkpoint-store.js";
import type { Event } from "../../../src/run/events.js";
import { EventStore } from "../../../src/run/event-store.js";
import { validateCheckpoint } from "../../../src/run/replay.js";
import { withIsolatedPiEnv } from "../../helpers/pi-env.js";

const OBJECTIVE = "Implement the checkout parser and add tests";

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

function runIdFromOutput(out: readonly string[]): RunId {
  const match = out.join("").match(/Run (run_[A-Za-z0-9_-]+):/);
  assert.ok(match?.[1], `expected run id in output: ${JSON.stringify(out)}`);
  return parseRunId(match[1]);
}

async function openedAcceptance(stateRoot: string, runId: RunId): Promise<readonly AcceptanceCriterion[]> {
  const { events } = await new EventStore(stateRoot, runId).readAll();
  const opened = events.find((event) => event.type === "EPISODE_OPENED");
  assert.ok(opened?.type === "EPISODE_OPENED", "run must record its episode contract projection");
  return opened.payload.episode.acceptance;
}

function constraintRetentionByTurn(events: readonly Event[]): Record<string, string> {
  const verdicts: Record<string, string> = {};
  for (const event of events) {
    if (event.type !== "TRACKING_ASSESSMENT") continue;
    const assessment = event.payload.assessment as unknown as {
      turnId: string;
      dimensions: readonly { id: string; verdict: string }[];
    };
    const dimension = assessment.dimensions.find((entry) => entry.id === "constraint-retention");
    if (dimension !== undefined) verdicts[assessment.turnId] = dimension.verdict;
  }
  return verdicts;
}

async function withRoots(run: (stateRoot: string, projectRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-contract-honesty-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-contract-honesty-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await withIsolatedPiEnv(() => run(stateRoot, projectRoot));
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

test("CLI keeps --children contract-skipped while --track records its extracted contract", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const specPath = join(projectRoot, "children.json");
    await writeFile(
      specPath,
      JSON.stringify({
        tasks: [
          {
            id: "tsk_implement",
            role: "implementer",
            objective: "Implement the checkout parser",
            acceptanceCriteria: [{ id: "ac-child-parser", description: "Parser handles checkout input" }]
          },
          {
            id: "tsk_test",
            role: "tester",
            objective: "Test the checkout parser",
            dependsOn: ["tsk_implement"],
            acceptanceCriteria: [{ id: "ac-child-tests", description: "Checkout parser tests pass" }]
          }
        ]
      }),
      "utf8"
    );

    const children = capture();
    const childrenCode = await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        OBJECTIVE,
        "--children",
        specPath,
        "--state-root",
        stateRoot
      ],
      children.io
    );
    assert.equal(childrenCode, 0, children.err.join(""));
    const childrenAcceptance = await openedAcceptance(stateRoot, runIdFromOutput(children.out));
    assert.deepEqual(
      childrenAcceptance.map((criterion) => criterion.id),
      ["run-complete"],
      "child criteria must not be promoted into an invented parent contract"
    );

    const tracked = capture();
    const trackedCode = await main(
      [
        "run",
        "--track",
        "--assume-defaults",
        "--project",
        projectRoot,
        "--objective",
        OBJECTIVE,
        "--state-root",
        stateRoot
      ],
      tracked.io
    );
    assert.equal(trackedCode, 0, tracked.err.join(""));
    const trackedAcceptance = await openedAcceptance(stateRoot, runIdFromOutput(tracked.out));
    assert.deepEqual(
      trackedAcceptance.map((criterion) => criterion.id),
      ["ac-objective", "ac-tests"]
    );
    assert.equal(
      trackedAcceptance.some((criterion) => criterion.id === "run-complete"),
      false,
      "--track supplied a contract and must not be recorded as contract-skipped"
    );
  });
});

/**
 * The test above proves the two commands *record* different contracts. This
 * one proves the recorded difference is load-bearing, with no embedder
 * anywhere: `--track` is the only shipped command that produces a contract at
 * all (no flag accepts one), and the constraints it extracts from the
 * objective are what its children are then assessed against. The `--children`
 * run in the same state root is the discriminator — same executor, same
 * project, no contract, so `constraint-retention` is `NOT_APPLICABLE` rather
 * than a `PASS` that would have been free.
 */
test("the contract --track extracts is the one its children are assessed against", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const tracked = capture();
    const trackedCode = await main(
      [
        "run",
        "--track",
        "--assume-defaults",
        "--project",
        projectRoot,
        "--objective",
        OBJECTIVE,
        "--state-root",
        stateRoot,
        "--executor",
        "fake"
      ],
      tracked.io
    );
    assert.equal(trackedCode, 0, tracked.err.join(""));
    const trackedRunId = runIdFromOutput(tracked.out);
    assert.match(tracked.out.join(""), new RegExp(`Run ${trackedRunId}: COMPLETED`));

    const contract = validateCheckpoint(await new CheckpointStore(stateRoot, trackedRunId).read()).flowchart
      ?.contract;
    assert.ok(contract, "a tracked run leaves its contract on the durable checkpoint");
    assert.deepEqual(
      contract.constraints.map((constraint) => constraint.id),
      ["c-smallest", "c-tests"]
    );

    const trackedVerdicts = constraintRetentionByTurn(
      (await new EventStore(stateRoot, trackedRunId).readAll()).events
    );
    assert.ok(Object.keys(trackedVerdicts).length > 1, "the tracked plan assessed more than one turn");
    for (const [turnId, verdict] of Object.entries(trackedVerdicts)) {
      assert.equal(verdict, "PASS", `${turnId} is assessed against the extracted constraints`);
    }

    const specPath = join(projectRoot, "single-child.json");
    await writeFile(
      specPath,
      JSON.stringify({
        tasks: [
          {
            id: "tsk_implement",
            role: "implementer",
            objective: "Implement the checkout parser",
            acceptanceCriteria: [{ id: "ac-child-parser", description: "Parser handles checkout input" }]
          }
        ]
      }),
      "utf8"
    );
    const children = capture();
    const childrenCode = await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        OBJECTIVE,
        "--children",
        specPath,
        "--state-root",
        stateRoot
      ],
      children.io
    );
    assert.equal(childrenCode, 0, children.err.join(""));
    assert.deepEqual(
      constraintRetentionByTurn((await new EventStore(stateRoot, runIdFromOutput(children.out)).readAll()).events),
      { tsk_implement: "NOT_APPLICABLE" },
      "a contract-skipped run has no constraints to retain, so PASS is not the default verdict"
    );
  });
});
