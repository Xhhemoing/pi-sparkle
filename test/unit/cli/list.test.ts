import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseCliErrorJson } from "../../../src/cli/errors.js";
import {
  LIST_USAGE,
  listCommand,
  sortByLastEvent,
  type ListIo,
  type ListJson
} from "../../../src/cli/list.js";
import type { ProjectEpisode } from "../../../src/domain/episode.js";
import {
  createEpisodeId,
  createEvidenceId,
  createProjectId,
  createRunId,
  type EpisodeId,
  type RunId
} from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { runtimeRoot } from "../../../src/privacy/state-layout.js";
import { EpisodeStore } from "../../../src/run/episode-store.js";
import { EventStore } from "../../../src/run/event-store.js";
import { makeEvent, makeRun } from "../../helpers/event-factory.js";

const RUN_A = createRunId(() => "aaaaaaaa-1111-2222-3333-444444444444");
const RUN_B = createRunId(() => "bbbbbbbb-1111-2222-3333-444444444444");
const RUN_C = createRunId(() => "cccccccc-1111-2222-3333-444444444444");
const EPISODE_A = createEpisodeId(() => "aaaaaaaa-5555-6666-7777-888888888888");
const EPISODE_B = createEpisodeId(() => "bbbbbbbb-5555-6666-7777-888888888888");

function capture(): { io: ListIo; out: string[]; err: string[] } {
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

async function withStateRoot(body: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-list-"));
  try {
    await body(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

async function seedCompletedRun(stateRoot: string, runId: RunId, episodeId?: EpisodeId): Promise<void> {
  const store = new EventStore(stateRoot, runId);
  await store.append(
    makeEvent("RUN_CREATED", { run: makeRun() }, { runId, occurredAt: "2026-08-20T10:00:00.000Z" })
  );
  if (episodeId !== undefined) {
    await store.append(
      makeEvent(
        "RUN_ATTACHED",
        { episodeId, runId, attachedAt: "2026-08-20T10:01:00.000Z" },
        { runId, occurredAt: "2026-08-20T10:01:00.000Z" }
      )
    );
  }
  await store.append(makeEvent("RUN_STARTED", {}, { runId, occurredAt: "2026-08-20T10:02:00.000Z" }));
  await store.append(makeEvent("RUN_COMPLETED", {}, { runId, occurredAt: "2026-08-20T10:03:00.000Z" }));
}

/** A live run whose whole log carries one caller-chosen timestamp. */
async function seedRunEndingAt(stateRoot: string, runId: RunId, occurredAt: string): Promise<void> {
  const store = new EventStore(stateRoot, runId);
  await store.append(makeEvent("RUN_CREATED", { run: makeRun() }, { runId, occurredAt }));
  await store.append(makeEvent("RUN_STARTED", {}, { runId, occurredAt }));
}

async function seedRunningRun(stateRoot: string, runId: RunId): Promise<void> {
  const store = new EventStore(stateRoot, runId);
  await store.append(
    makeEvent("RUN_CREATED", { run: makeRun() }, { runId, occurredAt: "2026-08-21T09:00:00.000Z" })
  );
  await store.append(makeEvent("RUN_STARTED", {}, { runId, occurredAt: "2026-08-21T09:01:00.000Z" }));
}

function makeEpisode(
  id: EpisodeId,
  overrides: { status?: ProjectEpisode["status"]; closedAt?: string } = {}
): ProjectEpisode {
  return {
    id,
    projectId: createProjectId(() => "cccccccc-1111-2222-3333-444444444444"),
    objective: "List the runtime inventory",
    contractVersion: 1,
    runIds: [RUN_A],
    startedAt: parseIsoTimestamp("2026-08-20T09:00:00.000Z"),
    closedAt: overrides.closedAt === undefined ? undefined : parseIsoTimestamp(overrides.closedAt),
    status: overrides.status ?? "OPEN",
    acceptance: [{ id: "acc-1", description: "Rows are listed", observableCheck: "pi-sparkle list" }],
    evidenceRefs: [createEvidenceId(() => "dddddddd-1111-2222-3333-444444444444")],
    outcomeId: undefined
  };
}

function parseJsonLine(out: string[]): ListJson {
  assert.equal(out.length, 1, `expected exactly one stdout object, got ${out.length}`);
  return JSON.parse(out[0] ?? "") as ListJson;
}

test("list --help prints usage and exits 0 without touching the state root", async () => {
  for (const flag of ["--help", "-h", "help"]) {
    const { io, out, err } = capture();
    const code = await listCommand([flag], io);
    assert.equal(code, 0, err.join(""));
    assert.deepEqual(out, [LIST_USAGE]);
    assert.deepEqual(err, []);
  }
});

test("list on an empty state root reports no runs and exits 0", async () => {
  await withStateRoot(async (stateRoot) => {
    const { io, out, err } = capture();
    const code = await listCommand(["--state-root", stateRoot], io);
    assert.equal(code, 0, err.join(""));
    assert.deepEqual(out, ["(no runs)\n"]);
    assert.deepEqual(err, []);
  });
});

test("list prints one tab-separated row per run, ordered by run id", async () => {
  await withStateRoot(async (stateRoot) => {
    await seedRunningRun(stateRoot, RUN_B);
    await seedCompletedRun(stateRoot, RUN_A, EPISODE_A);

    const { io, out, err } = capture();
    const code = await listCommand(["--runs", "--state-root", stateRoot], io);
    assert.equal(code, 0, err.join(""));
    assert.deepEqual(out, [
      `${RUN_A}\tCOMPLETED\t2026-08-20T10:03:00.000Z\t${EPISODE_A}\n`,
      `${RUN_B}\tRUNNING\t2026-08-21T09:01:00.000Z\t-\n`
    ]);
    assert.deepEqual(err, []);
  });
});

test("list --status keeps only the runs replaying to that status", async () => {
  await withStateRoot(async (stateRoot) => {
    await seedCompletedRun(stateRoot, RUN_A);
    await seedRunningRun(stateRoot, RUN_B);

    const { io, out, err } = capture();
    const code = await listCommand(["--state-root", stateRoot, "--status", "RUNNING"], io);
    assert.equal(code, 0, err.join(""));
    assert.equal(out.length, 1);
    assert.match(out[0] ?? "", new RegExp(`^${RUN_B}\tRUNNING\t`));
  });
});

test("list --status with an empty result still prints the empty marker", async () => {
  await withStateRoot(async (stateRoot) => {
    await seedRunningRun(stateRoot, RUN_B);
    const { io, out } = capture();
    const code = await listCommand(["--state-root", stateRoot, "--status", "FAILED"], io);
    assert.equal(code, 0);
    assert.deepEqual(out, ["(no runs)\n"]);
  });
});

test("list --status refuses a value that is not a RunStatus", async () => {
  await withStateRoot(async (stateRoot) => {
    const { io, out, err } = capture();
    const code = await listCommand(["--state-root", stateRoot, "--status", "SLEEPING"], io);
    assert.equal(code, 1);
    assert.deepEqual(out, []);
    const report = parseCliErrorJson(err.join(""));
    assert.equal(report?.command, "list");
    assert.equal(report?.stage, "parse-args");
  });
});

test("list refuses --runs and --episodes together", async () => {
  await withStateRoot(async (stateRoot) => {
    const { io, out, err } = capture();
    const code = await listCommand(["--runs", "--episodes", "--state-root", stateRoot], io);
    assert.equal(code, 1);
    assert.deepEqual(out, []);
    const report = parseCliErrorJson(err.join(""));
    assert.equal(report?.command, "list");
    assert.equal(report?.stage, "parse-args");
  });
});

test("list --status is refused with --episodes rather than silently ignored", async () => {
  await withStateRoot(async (stateRoot) => {
    const { io, err } = capture();
    const code = await listCommand(["--episodes", "--status", "COMPLETED", "--state-root", stateRoot], io);
    assert.equal(code, 1);
    assert.equal(parseCliErrorJson(err.join(""))?.stage, "parse-args");
  });
});

/**
 * Contract pin, not a snapshot: `type` and `preview` are what a consumer keys
 * off, and stdout in JSON mode is exactly one object with no prose beside it.
 */
test("list --json prints one RUN_LIST object and no prose", async () => {
  await withStateRoot(async (stateRoot) => {
    await seedCompletedRun(stateRoot, RUN_A, EPISODE_A);
    await seedRunningRun(stateRoot, RUN_B);

    const { io, out, err } = capture();
    const code = await listCommand(["--json", "--state-root", stateRoot], io);
    assert.equal(code, 0, err.join(""));
    const payload = parseJsonLine(out);
    assert.equal(payload.type, "RUN_LIST");
    assert.equal(payload.preview, true);
    assert.equal(payload.episodes, undefined);
    assert.deepEqual(payload.errors, []);
    assert.deepEqual(payload.warnings, []);
    assert.deepEqual(payload.runs, [
      {
        runId: RUN_A,
        status: "COMPLETED",
        lastEventAt: "2026-08-20T10:03:00.000Z",
        episodeId: EPISODE_A
      },
      {
        runId: RUN_B,
        status: "RUNNING",
        lastEventAt: "2026-08-21T09:01:00.000Z",
        episodeId: null
      }
    ]);
    assert.deepEqual(err, []);
  });
});

test("an unreadable run log warns on stderr, lists the rest, and still exits 0", async () => {
  await withStateRoot(async (stateRoot) => {
    await seedCompletedRun(stateRoot, RUN_A);
    await seedRunningRun(stateRoot, RUN_B);
    const corrupt = join(runtimeRoot(stateRoot), "runs", RUN_B, "events.jsonl");
    await appendFile(corrupt, "NOT JSON\n", "utf8");
    await appendFile(corrupt, `${JSON.stringify(makeEvent("RUN_COMPLETED", {}, { runId: RUN_B }))}\n`, "utf8");

    const { io, out, err } = capture();
    const code = await listCommand(["--state-root", stateRoot], io);
    assert.equal(code, 0);
    assert.equal(out.length, 1);
    assert.match(out[0] ?? "", new RegExp(`^${RUN_A}\tCOMPLETED\t`));
    assert.deepEqual(err, ["warning: list incomplete: 1 unreadable record(s)\n"]);

    const json = capture();
    assert.equal(await listCommand(["--json", "--state-root", stateRoot], json.io), 0);
    const payload = parseJsonLine(json.out);
    assert.equal(payload.errors.length, 1);
    assert.equal(payload.errors[0]?.path, corrupt);
    assert.deepEqual(payload.warnings, []);
    assert.deepEqual(json.err, ["warning: list incomplete: 1 unreadable record(s)\n"]);
  });
});

test("list --episodes lists episode snapshots and reports an empty plane", async () => {
  await withStateRoot(async (stateRoot) => {
    const empty = capture();
    assert.equal(await listCommand(["--episodes", "--state-root", stateRoot], empty.io), 0);
    assert.deepEqual(empty.out, ["(no episodes)\n"]);

    await new EpisodeStore(stateRoot, EPISODE_A).append(makeEpisode(EPISODE_A));
    await writeFile(join(runtimeRoot(stateRoot), "episodes", `${EPISODE_A}.lock`), "{}", "utf8");

    const { io, out, err } = capture();
    const code = await listCommand(["--episodes", "--state-root", stateRoot], io);
    assert.equal(code, 0, err.join(""));
    assert.deepEqual(out, [`${EPISODE_A}\tOPEN\t2026-08-20T09:00:00.000Z\n`]);
    assert.deepEqual(err, []);
  });
});

test("list --episodes --json prints one EPISODE_LIST object", async () => {
  await withStateRoot(async (stateRoot) => {
    await new EpisodeStore(stateRoot, EPISODE_A).append(makeEpisode(EPISODE_A));

    const { io, out, err } = capture();
    const code = await listCommand(["--episodes", "--json", "--state-root", stateRoot], io);
    assert.equal(code, 0, err.join(""));
    const payload = parseJsonLine(out);
    assert.equal(payload.type, "EPISODE_LIST");
    assert.equal(payload.preview, true);
    assert.equal(payload.runs, undefined);
    assert.deepEqual(payload.episodes, [
      { episodeId: EPISODE_A, status: "OPEN", lastEventAt: "2026-08-20T09:00:00.000Z" }
    ]);
    assert.deepEqual(payload.errors, []);
    assert.deepEqual(payload.warnings, []);
  });
});

test("list refuses an unknown flag instead of ignoring it", async () => {
  await withStateRoot(async (stateRoot) => {
    const { io, err } = capture();
    const code = await listCommand(["--state-root", stateRoot, "--all"], io);
    assert.equal(code, 1);
    assert.equal(parseCliErrorJson(err.join(""))?.stage, "parse-args");
  });
});

/**
 * The defect this closes: the same log that makes `inspect` warn used to list
 * as an ordinary row, so a run crashed mid-completion looked live.
 */
test("a crash-truncated run log is listed with the dropped tail named on stderr", async () => {
  await withStateRoot(async (stateRoot) => {
    await seedRunningRun(stateRoot, RUN_B);
    const truncated = join(runtimeRoot(stateRoot), "runs", RUN_B, "events.jsonl");
    await appendFile(
      truncated,
      JSON.stringify(makeEvent("RUN_COMPLETED", {}, { runId: RUN_B })).slice(0, 40),
      "utf8"
    );

    const { io, out, err } = capture();
    const code = await listCommand(["--state-root", stateRoot], io);
    assert.equal(code, 0);
    assert.equal(out.length, 1);
    assert.match(out[0] ?? "", new RegExp(`^${RUN_B}\tRUNNING\t`));
    assert.deepEqual(err, [
      `warning: ${truncated}: ignored truncated event log at line 3; status and lastEventAt are replayed from the shortened log\n`
    ]);

    const json = capture();
    assert.equal(await listCommand(["--json", "--state-root", stateRoot], json.io), 0);
    const payload = parseJsonLine(json.out);
    assert.deepEqual(payload.errors, []);
    assert.deepEqual(payload.warnings, [
      {
        path: truncated,
        message:
          "ignored truncated event log at line 3; status and lastEventAt are replayed from the shortened log"
      }
    ]);
    assert.equal(payload.runs?.length, 1);
  });
});

test("a crash-truncated episode log warns and still lists the episode", async () => {
  await withStateRoot(async (stateRoot) => {
    await new EpisodeStore(stateRoot, EPISODE_A).append(makeEpisode(EPISODE_A));
    const truncated = join(runtimeRoot(stateRoot), "episodes", `${EPISODE_A}.jsonl`);
    await appendFile(
      truncated,
      JSON.stringify(makeEpisode(EPISODE_A, { status: "COMPLETED", closedAt: "2026-08-21T12:00:00.000Z" })).slice(0, 30),
      "utf8"
    );

    const { io, out, err } = capture();
    const code = await listCommand(["--episodes", "--state-root", stateRoot], io);
    assert.equal(code, 0);
    assert.deepEqual(out, [`${EPISODE_A}\tOPEN\t2026-08-20T09:00:00.000Z\n`]);
    assert.deepEqual(err, [
      `warning: ${truncated}: ignored truncated episode log at line 2; status and lastEventAt are replayed from the shortened log\n`
    ]);
  });
});

/**
 * Run ids are random UUIDs, so the by-id default says nothing about time. The
 * fixture seeds ids whose order inverts their recency, and a tie the id has to
 * break.
 */
test("list --sort last-event orders runs most-recent-first, ties broken by id", async () => {
  await withStateRoot(async (stateRoot) => {
    await seedCompletedRun(stateRoot, RUN_A);
    await seedRunningRun(stateRoot, RUN_B);
    await seedCompletedRun(stateRoot, RUN_C);

    const byId = capture();
    assert.equal(await listCommand(["--state-root", stateRoot], byId.io), 0);
    assert.deepEqual(
      byId.out.map((line) => line.split("\t")[0]),
      [RUN_A, RUN_B, RUN_C]
    );

    const { io, out, err } = capture();
    const code = await listCommand(["--state-root", stateRoot, "--sort", "last-event"], io);
    assert.equal(code, 0, err.join(""));
    assert.deepEqual(
      out.map((line) => line.split("\t")[0]),
      [RUN_B, RUN_A, RUN_C]
    );
    assert.deepEqual(err, []);
  });
});

/** The same offset trap, end to end through the verb. */
test("list --sort last-event orders offset timestamps by the instant they name", async () => {
  await withStateRoot(async (stateRoot) => {
    // 2026-08-25T23:00:00+14:00 is 09:00Z: an hour older than the Z row, and
    // one place later in string order.
    await seedRunEndingAt(stateRoot, RUN_A, "2026-08-25T23:00:00+14:00");
    await seedRunEndingAt(stateRoot, RUN_B, "2026-08-25T10:00:00Z");

    const { io, out, err } = capture();
    const code = await listCommand(["--state-root", stateRoot, "--sort", "last-event"], io);
    assert.equal(code, 0, err.join(""));
    assert.deepEqual(out, [
      `${RUN_B}\tRUNNING\t2026-08-25T10:00:00Z\t-\n`,
      `${RUN_A}\tRUNNING\t2026-08-25T23:00:00+14:00\t-\n`
    ]);
  });
});

test("list --sort last-event composes with --status and --json", async () => {
  await withStateRoot(async (stateRoot) => {
    await seedCompletedRun(stateRoot, RUN_A);
    await seedRunningRun(stateRoot, RUN_B);
    await seedCompletedRun(stateRoot, RUN_C);

    const { io, out, err } = capture();
    const code = await listCommand(
      ["--state-root", stateRoot, "--sort", "last-event", "--status", "COMPLETED", "--json"],
      io
    );
    assert.equal(code, 0, err.join(""));
    const payload = parseJsonLine(out);
    assert.deepEqual(
      payload.runs?.map((run) => run.runId),
      [RUN_A, RUN_C]
    );
    assert.deepEqual(payload.warnings, []);
  });
});

test("list --sort last-event --episodes puts the most recently closed episode first", async () => {
  await withStateRoot(async (stateRoot) => {
    await new EpisodeStore(stateRoot, EPISODE_A).append(makeEpisode(EPISODE_A));
    await new EpisodeStore(stateRoot, EPISODE_B).append(
      makeEpisode(EPISODE_B, { status: "COMPLETED", closedAt: "2026-08-21T12:00:00.000Z" })
    );

    const { io, out, err } = capture();
    const code = await listCommand(["--episodes", "--state-root", stateRoot, "--sort", "last-event"], io);
    assert.equal(code, 0, err.join(""));
    assert.deepEqual(out, [
      `${EPISODE_B}\tCOMPLETED\t2026-08-21T12:00:00.000Z\n`,
      `${EPISODE_A}\tOPEN\t2026-08-20T09:00:00.000Z\n`
    ]);
  });
});

/**
 * A snapshot that validates always carries `startedAt`, so no fixture can put
 * an undefined timestamp through `listEpisodes`. The row type allows one, and
 * the rule for it is pinned here rather than left to the first log that has it.
 */
/**
 * `IsoTimestamp` accepts a UTC offset, and the two below invert between text
 * order and instant order: `+14:00` is 09:00Z, an hour before the `Z` row a
 * string compare would rank as older.
 */
test("last-event ordering compares instants, not timestamp text", () => {
  const rows = [
    { id: "row_offset", lastEventAt: "2026-08-25T23:00:00+14:00" },
    { id: "row_utc", lastEventAt: "2026-08-25T10:00:00Z" }
  ];
  assert.deepEqual(
    sortByLastEvent(rows, (row) => row.id).map((row) => row.id),
    ["row_utc", "row_offset"]
  );
  assert.deepEqual(
    sortByLastEvent([...rows].reverse(), (row) => row.id).map((row) => row.id),
    ["row_utc", "row_offset"]
  );
});

test("rows with no last-event timestamp sort last, id-ordered among themselves", () => {
  const rows = [
    { episodeId: "ep_b", lastEventAt: undefined },
    { episodeId: "ep_c", lastEventAt: "2026-08-20T09:00:00.000Z" },
    { episodeId: "ep_a", lastEventAt: undefined },
    { episodeId: "ep_d", lastEventAt: "2026-08-21T09:00:00.000Z" }
  ];
  assert.deepEqual(
    sortByLastEvent(rows, (row) => row.episodeId).map((row) => row.episodeId),
    ["ep_d", "ep_c", "ep_a", "ep_b"]
  );
});

test("list --sort refuses a value that is neither id nor last-event", async () => {
  await withStateRoot(async (stateRoot) => {
    const { io, out, err } = capture();
    const code = await listCommand(["--state-root", stateRoot, "--sort", "recent"], io);
    assert.equal(code, 1);
    assert.deepEqual(out, []);
    const report = parseCliErrorJson(err.join(""));
    assert.equal(report?.command, "list");
    assert.equal(report?.stage, "parse-args");
    assert.equal(report?.next, "pass --sort id or --sort last-event");
  });
});
