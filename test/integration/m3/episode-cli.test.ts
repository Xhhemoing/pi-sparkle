import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import { parseCliErrorJson } from "../../../src/cli/errors.js";
import { EPISODE_USAGE } from "../../../src/cli/episode.js";
import {
  createEpisodeId,
  createEvidenceId,
  createProjectId,
  createRunId,
  type EpisodeId
} from "../../../src/domain/ids.js";
import type { ProjectEpisode } from "../../../src/domain/episode.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import { openEpisode } from "../../../src/episode/manager.js";
import { EpisodeEventStore } from "../../../src/episode/store.js";
import { EpisodeStore } from "../../../src/run/episode-store.js";

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (text) => out.push(text), stderr: (text) => err.push(text) },
    out,
    err
  };
}

async function seedEpisode(stateRoot: string, episode: ProjectEpisode): Promise<void> {
  const opened = openEpisode({
    id: episode.id,
    projectId: episode.projectId,
    objective: episode.objective,
    contractVersion: episode.contractVersion,
    acceptance: episode.acceptance
  });
  await new EpisodeStore(stateRoot, episode.id).append(episode);
  await new EpisodeEventStore(stateRoot, episode.id).append(opened.event);
}

function episodesDir(stateRoot: string): string {
  return join(stateRoot, "runtime", "episodes");
}

/**
 * The raw bytes on disk. Compared to `--json` stdout with `assert.equal` and no
 * trimming or splitting: a pin that normalises both sides would survive a lost,
 * added or altered trailing newline, which is exactly the kind of drift a
 * verbatim-JSONL claim has to exclude.
 */
async function rawEventLogText(stateRoot: string, episodeId: EpisodeId): Promise<string> {
  return await readFile(join(episodesDir(stateRoot), `${episodeId}.events.jsonl`), "utf8");
}

async function humanEventLines(stateRoot: string, episodeId: EpisodeId): Promise<string[]> {
  const captured = capture();
  const code = await main(
    ["episode", "events", "--episode", episodeId, "--state-root", stateRoot],
    captured.io
  );
  assert.equal(code, 0, captured.err.join(""));
  return captured.out.join("").trimEnd().split("\n");
}

/** The whole refusal `episode` owes a malformed `--episode`, on either subcommand. */
function malformedIdReport(stateRoot: string): Record<string, unknown> {
  return {
    ok: false,
    command: "episode",
    stage: "parse-args",
    message: 'invalid --episode "banana": expected an episode id of the form ep_<suffix>',
    next: `pass --episode <epId> as printed by pnpm cli list --state-root ${stateRoot} --episodes`
  };
}

function assertTimestampedLine(line: string, type: string, detail: string): void {
  const fields = line.split("\t");
  assert.equal(fields.length, 3, `expected three tab-separated fields, got ${JSON.stringify(line)}`);
  assert.ok(!Number.isNaN(Date.parse(fields[0] ?? "")), `not a timestamp: ${String(fields[0])}`);
  assert.equal(fields[1], type);
  assert.equal(fields[2], detail);
}

test("episode close refuses completion when acceptance evidence is missing and records waiting", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-close-"));
  const episode: ProjectEpisode = {
    id: createEpisodeId(() => "close0001"),
    projectId: createProjectId(() => "close0001"),
    objective: "ship",
    contractVersion: 1,
    runIds: [],
    startedAt: nowIso(),
    status: "OPEN",
    acceptance: [{ id: "tests", description: "tests pass", observableCheck: "pnpm test" }],
    evidenceRefs: []
  };
  await seedEpisode(stateRoot, episode);

  const captured = capture();
  const code = await main([
    "episode", "close", "--episode", episode.id, "--status", "COMPLETED", "--state-root", stateRoot
  ], captured.io);

  assert.equal(code, 1);
  assert.match(captured.err.join(""), /acceptance-incomplete.*tests/);
  assert.match(captured.err.join(""), /recorded WAITING_FOR_USER/);
  const snapshots = await new EpisodeStore(stateRoot, episode.id).readAll();
  assert.equal(snapshots.episodes.at(-1)?.status, "WAITING_FOR_USER");
  const events = await new EpisodeEventStore(stateRoot, episode.id).readAll();
  assert.equal(events.events.at(-1)?.type, "EPISODE_WAITING");
});

test("a second refused COMPLETED close writes no second snapshot and claims no write", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-rewait-"));
  const episode: ProjectEpisode = {
    id: createEpisodeId(() => "close0003"),
    projectId: createProjectId(() => "close0003"),
    objective: "ship",
    contractVersion: 1,
    runIds: [],
    startedAt: nowIso(),
    status: "OPEN",
    acceptance: [{ id: "tests", description: "tests pass", observableCheck: "pnpm test" }],
    evidenceRefs: []
  };
  await seedEpisode(stateRoot, episode);

  const first = capture();
  assert.equal(
    await main(
      ["episode", "close", "--episode", episode.id, "--status", "COMPLETED", "--state-root", stateRoot],
      first.io
    ),
    1
  );
  const afterFirst = await new EpisodeStore(stateRoot, episode.id).readAll();
  assert.equal(afterFirst.episodes.at(-1)?.status, "WAITING_FOR_USER");

  const second = capture();
  assert.equal(
    await main(
      ["episode", "close", "--episode", episode.id, "--status", "COMPLETED", "--state-root", stateRoot],
      second.io
    ),
    1
  );
  const afterSecond = await new EpisodeStore(stateRoot, episode.id).readAll();
  assert.equal(afterSecond.episodes.length, afterFirst.episodes.length);
  assert.doesNotMatch(second.err.join(""), /recorded WAITING_FOR_USER/);
  assert.match(second.err.join(""), /already WAITING_FOR_USER/);
});

test("episode close completes once every criterion has matching evidence and events are inspectable", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-complete-"));
  const evidenceId = createEvidenceId(() => "tests-pass");
  const episode: ProjectEpisode = {
    id: createEpisodeId(() => "close0002"),
    projectId: createProjectId(() => "close0002"),
    objective: "ship",
    contractVersion: 1,
    runIds: [],
    startedAt: nowIso(),
    status: "OPEN",
    acceptance: [{ id: "tests", description: "tests pass", observableCheck: "pnpm test" }],
    evidenceRefs: [evidenceId],
    acceptanceEvidence: [
      { criterionId: "tests", evidenceId, result: "PASSED", sourceRef: "check:pnpm-test" }
    ]
  };
  await seedEpisode(stateRoot, episode);

  const closed = capture();
  const closeCode = await main([
    "episode", "close", "--episode", episode.id, "--status", "COMPLETED", "--state-root", stateRoot
  ], closed.io);
  assert.equal(closeCode, 0, closed.err.join(""));
  assert.match(closed.out.join(""), /COMPLETED/);

  const listed = capture();
  const eventsCode = await main([
    "episode", "events", "--episode", episode.id, "--state-root", stateRoot, "--json"
  ], listed.io);
  assert.equal(eventsCode, 0, listed.err.join(""));
  const events = listed.out.map((line) => JSON.parse(line) as { type: string });
  assert.deepEqual(events.map((event) => event.type), ["EPISODE_OPENED", "EPISODE_CLOSED"]);
});

test("a crash-truncated episode event log is disclosed and the surviving events still print", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-truncated-"));
  const episode: ProjectEpisode = {
    id: createEpisodeId(() => "trunc0001"),
    projectId: createProjectId(() => "trunc0001"),
    objective: "ship",
    contractVersion: 1,
    runIds: [],
    startedAt: nowIso(),
    status: "OPEN",
    acceptance: [],
    evidenceRefs: []
  };
  await seedEpisode(stateRoot, episode);
  await appendFile(
    join(stateRoot, "runtime", "episodes", `${episode.id}.events.jsonl`),
    '{"type":"EPISODE_CLOS',
    "utf8"
  );

  const captured = capture();
  const code = await main(
    ["episode", "events", "--episode", episode.id, "--state-root", stateRoot],
    captured.io
  );

  assert.equal(code, 0, captured.err.join(""));
  assert.match(captured.err.join(""), /warning: ignored truncated episode event log at line \d+/);
  const lines = captured.out.join("").trimEnd().split("\n");
  assert.equal(lines.length, 1);
  assertTimestampedLine(lines[0] ?? "", "EPISODE_OPENED", episode.objective);
});

test("a crash-truncated episode snapshot log is disclosed on close", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-trunc-snapshot-"));
  const episode: ProjectEpisode = {
    id: createEpisodeId(() => "trunc0002"),
    projectId: createProjectId(() => "trunc0002"),
    objective: "ship",
    contractVersion: 1,
    runIds: [],
    startedAt: nowIso(),
    status: "OPEN",
    acceptance: [],
    evidenceRefs: []
  };
  await seedEpisode(stateRoot, episode);
  await appendFile(join(stateRoot, "runtime", "episodes", `${episode.id}.jsonl`), '{"id":"ep_trunc', "utf8");

  const captured = capture();
  const code = await main(
    ["episode", "close", "--episode", episode.id, "--status", "ABANDONED", "--state-root", stateRoot],
    captured.io
  );

  assert.equal(code, 0, captured.err.join(""));
  assert.match(captured.err.join(""), /warning: ignored truncated episode log at line \d+/);
  assert.match(captured.out.join(""), /ABANDONED/);
});

test("episode close refuses --json instead of ignoring it", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-close-json-"));
  const episode: ProjectEpisode = {
    id: createEpisodeId(() => "closejson"),
    projectId: createProjectId(() => "closejson"),
    objective: "ship",
    contractVersion: 1,
    runIds: [],
    startedAt: nowIso(),
    status: "OPEN",
    acceptance: [],
    evidenceRefs: []
  };
  await seedEpisode(stateRoot, episode);

  const captured = capture();
  const code = await main(
    ["episode", "close", "--episode", episode.id, "--status", "ABANDONED", "--state-root", stateRoot, "--json"],
    captured.io
  );

  assert.equal(code, 1);
  assert.deepEqual(captured.out, []);
  const report = parseCliErrorJson(captured.err.join(""));
  assert.equal(report?.command, "episode");
  assert.equal(report?.stage, "parse-args");
  assert.equal(report?.message, "episode close prints no JSON; --json applies to episode events");
  assert.equal(report?.next, "drop --json, or use episode events --json");
  // The refusal wrote nothing: the episode is still OPEN.
  const snapshots = await new EpisodeStore(stateRoot, episode.id).readAll();
  assert.equal(snapshots.episodes.at(-1)?.status, "OPEN");
});

test("episode events on an unknown episode points at list --episodes, not at a run id", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-events-missing-"));
  const missing = createEpisodeId(() => "missing001");

  const captured = capture();
  const code = await main(
    ["episode", "events", "--episode", missing, "--state-root", stateRoot],
    captured.io
  );

  assert.equal(code, 1);
  assert.deepEqual(captured.out, []);
  const report = parseCliErrorJson(captured.err.join(""));
  assert.equal(report?.command, "episode");
  assert.equal(report?.stage, "lookup");
  assert.match(report?.next ?? "", /pnpm cli list/);
  assert.match(report?.next ?? "", /--episodes/);
  assert.ok((report?.next ?? "").includes(stateRoot));
});

test("a mistyped episode flag is an argv error that names --help, not an execute failure", async () => {
  const captured = capture();
  const code = await main(["episode", "events", "--epsiode", "ep_typo"], captured.io);

  assert.equal(code, 1);
  assert.deepEqual(captured.out, []);
  const report = parseCliErrorJson(captured.err.join(""));
  assert.equal(report?.command, "episode");
  assert.equal(report?.stage, "parse-args");
  assert.match(report?.message ?? "", /--epsiode/);
  assert.match(report?.next ?? "", /--help/);
});

test("episode events --help prints the usage the subcommand used to refuse", async () => {
  const captured = capture();
  const code = await main(["episode", "events", "--help"], captured.io);

  assert.equal(code, 0, captured.err.join(""));
  assert.equal(captured.out.join(""), EPISODE_USAGE);
  assert.deepEqual(captured.err, []);
});

test("episode close on an unknown episode points at list --episodes, not at a run id", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-close-missing-"));
  const missing = createEpisodeId(() => "missing002");

  const captured = capture();
  const code = await main(
    ["episode", "close", "--episode", missing, "--status", "FAILED", "--state-root", stateRoot],
    captured.io
  );

  assert.equal(code, 1);
  const report = parseCliErrorJson(captured.err.join(""));
  assert.equal(report?.command, "episode");
  assert.equal(report?.stage, "lookup");
  assert.match(report?.next ?? "", /pnpm cli list/);
  assert.match(report?.next ?? "", /--episodes/);
  assert.ok((report?.next ?? "").includes(stateRoot));
});

test("episode events names what the episode waits for, and --json keeps its raw bytes", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-waiting-line-"));
  const episode: ProjectEpisode = {
    id: createEpisodeId(() => "lines0001"),
    projectId: createProjectId(() => "lines0001"),
    objective: "ship the operator contract",
    contractVersion: 1,
    runIds: [],
    startedAt: nowIso(),
    status: "OPEN",
    acceptance: [{ id: "tests", description: "tests pass", observableCheck: "pnpm test" }],
    evidenceRefs: []
  };
  await seedEpisode(stateRoot, episode);
  const refused = capture();
  assert.equal(
    await main(
      ["episode", "close", "--episode", episode.id, "--status", "COMPLETED", "--state-root", stateRoot],
      refused.io
    ),
    1
  );

  const lines = await humanEventLines(stateRoot, episode.id);
  assert.equal(lines.length, 2);
  assertTimestampedLine(lines[0] ?? "", "EPISODE_OPENED", episode.objective);
  assertTimestampedLine(lines[1] ?? "", "EPISODE_WAITING", "acceptance-incomplete: tests");

  // The human view is a rendering of events the JSON view already discloses:
  // `--json` stays verbatim JSONL of the rows on disk.
  const asJson = capture();
  assert.equal(
    await main(
      ["episode", "events", "--episode", episode.id, "--state-root", stateRoot, "--json"],
      asJson.io
    ),
    0,
    asJson.err.join("")
  );
  assert.equal(asJson.out.join(""), await rawEventLogText(stateRoot, episode.id));
  const events = asJson.out.map((line) => JSON.parse(line) as { type: string; reason?: string });
  assert.deepEqual(events.map((event) => event.type), ["EPISODE_OPENED", "EPISODE_WAITING"]);
  assert.equal(events[1]?.reason, "acceptance-incomplete");
});

test("episode events prints the closed status, and the outcome id only when one was recorded", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-closed-line-"));
  const bare: ProjectEpisode = {
    id: createEpisodeId(() => "lines0002"),
    projectId: createProjectId(() => "lines0002"),
    objective: "ship",
    contractVersion: 1,
    runIds: [],
    startedAt: nowIso(),
    status: "OPEN",
    acceptance: [],
    evidenceRefs: []
  };
  const withOutcome: ProjectEpisode = { ...bare, id: createEpisodeId(() => "lines0003") };
  await seedEpisode(stateRoot, bare);
  await seedEpisode(stateRoot, withOutcome);

  const first = capture();
  assert.equal(
    await main(
      ["episode", "close", "--episode", bare.id, "--status", "ABANDONED", "--state-root", stateRoot],
      first.io
    ),
    0,
    first.err.join("")
  );
  const second = capture();
  assert.equal(
    await main(
      [
        "episode", "close", "--episode", withOutcome.id, "--status", "FAILED",
        "--outcome", "oc_r8probe", "--state-root", stateRoot
      ],
      second.io
    ),
    0,
    second.err.join("")
  );

  const bareLines = await humanEventLines(stateRoot, bare.id);
  assert.equal(bareLines.length, 2);
  assertTimestampedLine(bareLines[1] ?? "", "EPISODE_CLOSED", "ABANDONED");

  const outcomeLines = await humanEventLines(stateRoot, withOutcome.id);
  assert.equal(outcomeLines.length, 2);
  assertTimestampedLine(outcomeLines[1] ?? "", "EPISODE_CLOSED", "FAILED outcome=oc_r8probe");
});

test("episode events prints the attached run id for a RUN_ATTACHED event", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-attached-line-"));
  const episode: ProjectEpisode = {
    id: createEpisodeId(() => "lines0004"),
    projectId: createProjectId(() => "lines0004"),
    objective: "ship",
    contractVersion: 1,
    runIds: [],
    startedAt: nowIso(),
    status: "OPEN",
    acceptance: [],
    evidenceRefs: []
  };
  await seedEpisode(stateRoot, episode);
  const runId = createRunId(() => "attached01");
  // Appended through the store, so the seeded row is one `validateEpisodeEvent`
  // accepts — the human line renders a real event, not a test-only shape.
  await new EpisodeEventStore(stateRoot, episode.id).append({
    type: "RUN_ATTACHED",
    episodeId: episode.id,
    runId,
    attachedAt: nowIso()
  });

  const lines = await humanEventLines(stateRoot, episode.id);
  assert.equal(lines.length, 2);
  assertTimestampedLine(lines[0] ?? "", "EPISODE_OPENED", episode.objective);
  assertTimestampedLine(lines[1] ?? "", "RUN_ATTACHED", runId);
});

test("a malformed --episode is an argv refusal on events, not a validation failure", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-bad-id-events-"));

  const captured = capture();
  const code = await main(
    ["episode", "events", "--episode", "banana", "--state-root", stateRoot],
    captured.io
  );

  assert.equal(code, 1);
  assert.deepEqual(captured.out, []);
  assert.deepEqual(parseCliErrorJson(captured.err.join("")), malformedIdReport(stateRoot));
});

test("a malformed --episode is an argv refusal on close and writes nothing", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-bad-id-close-"));
  const episode: ProjectEpisode = {
    id: createEpisodeId(() => "badid0001"),
    projectId: createProjectId(() => "badid0001"),
    objective: "ship",
    contractVersion: 1,
    runIds: [],
    startedAt: nowIso(),
    status: "OPEN",
    acceptance: [],
    evidenceRefs: []
  };
  await seedEpisode(stateRoot, episode);
  const before = (await readdir(episodesDir(stateRoot))).sort();
  const snapshotPath = join(episodesDir(stateRoot), `${episode.id}.jsonl`);
  const snapshotBefore = await readFile(snapshotPath, "utf8");

  const captured = capture();
  const code = await main(
    ["episode", "close", "--episode", "banana", "--status", "FAILED", "--state-root", stateRoot],
    captured.io
  );

  assert.equal(code, 1);
  assert.deepEqual(captured.out, []);
  assert.deepEqual(parseCliErrorJson(captured.err.join("")), malformedIdReport(stateRoot));
  // The refusal precedes the lock and both stores: no new file, no new row.
  assert.deepEqual((await readdir(episodesDir(stateRoot))).sort(), before);
  assert.equal(await readFile(snapshotPath, "utf8"), snapshotBefore);
});

test("an unknown episode subcommand is refused before the --episode value is judged", async () => {
  const captured = capture();
  // The id is malformed too: the operator has to hear about the verb they got
  // wrong first, because no `--episode` value could have made this argv work.
  const code = await main(["episode", "nonsense", "--episode", "banana"], captured.io);

  assert.equal(code, 1);
  assert.deepEqual(captured.out, []);
  const stderr = captured.err.join("");
  assert.ok(stderr.startsWith(EPISODE_USAGE), "usage still precedes the report on stderr");
  assert.deepEqual(parseCliErrorJson(stderr), {
    ok: false,
    command: "episode",
    stage: "parse-args",
    message: "Unknown episode command: nonsense",
    next: "use episode events or episode close"
  });
});

test("episode events escapes control characters so one event is always one line", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-escape-"));
  const episodeId = createEpisodeId(() => "escape0001");
  const projectId = createProjectId(() => "escape0001");
  const runId = createRunId(() => "escape0001");
  // Every unconstrained detail field — including each evidence entry, which is
  // rendered individually — carries all four characters the renderer replaces:
  // a literal backslash, a tab, a carriage return and a newline. The last three
  // would otherwise forge a column or a whole row in a tab-separated,
  // line-per-event surface; the backslash catches an escape that is not
  // round-trippable.
  const objective = "ship\\now\tfast\r\nplease";
  const reason = "blocked\\hard\ton\r\nreview";
  const requiredEvidence = ["tests\\one\tunit\r\nlinux", "docs\\two\tadr\r\nreview"];
  const outcomeId = "oc\\1\tb\r\nc";
  // Enforced, not just claimed above: a later edit that weakens any one field
  // would silently stop exercising a replacement the line format depends on.
  for (const field of [objective, reason, ...requiredEvidence, outcomeId]) {
    for (const char of ["\\", "\t", "\r", "\n"]) {
      assert.ok(
        field.includes(char),
        `fixture field ${JSON.stringify(field)} does not exercise ${JSON.stringify(char)}`
      );
    }
  }
  const openedAt = nowIso();
  const attachedAt = nowIso();
  const waitedAt = nowIso();
  const closedAt = nowIso();
  const episode: ProjectEpisode = {
    id: episodeId,
    projectId,
    objective,
    contractVersion: 1,
    runIds: [],
    startedAt: openedAt,
    status: "OPEN",
    acceptance: [],
    evidenceRefs: []
  };
  // Appended through the store, so each row had to satisfy
  // `validateEpisodeEvent`: none of these events is rejected today, and the
  // renderer must not start rejecting them either.
  const store = new EpisodeEventStore(stateRoot, episodeId);
  await store.append({ type: "EPISODE_OPENED", episode, occurredAt: openedAt });
  await store.append({ type: "RUN_ATTACHED", episodeId, runId, attachedAt });
  await store.append({
    type: "EPISODE_WAITING",
    episodeId,
    reason,
    requiredEvidence,
    occurredAt: waitedAt
  });
  await store.append({ type: "EPISODE_CLOSED", episodeId, status: "FAILED", closedAt, outcomeId });

  const captured = capture();
  const code = await main(
    ["episode", "events", "--episode", episodeId, "--state-root", stateRoot],
    captured.io
  );
  assert.equal(code, 0, captured.err.join(""));

  const raw = captured.out.join("");
  assert.ok(raw.endsWith("\n"));
  const lines = raw.slice(0, -1).split("\n");
  assert.equal(lines.length, 4, "exactly one physical line per event");
  for (const line of lines) {
    assert.doesNotMatch(line, /[\r\n]/, `line carries a raw newline: ${JSON.stringify(line)}`);
    assert.equal(
      line.split("\t").length - 1,
      2,
      `expected exactly two structural tabs: ${JSON.stringify(line)}`
    );
  }
  // The expected escapes are written out longhand rather than through the
  // renderer's own helper, so this pins the format and not the implementation.
  assert.deepEqual(lines, [
    `${openedAt}\tEPISODE_OPENED\tship\\\\now\\tfast\\r\\nplease`,
    `${attachedAt}\tRUN_ATTACHED\t${runId}`,
    `${waitedAt}\tEPISODE_WAITING\tblocked\\\\hard\\ton\\r\\nreview: ` +
      `tests\\\\one\\tunit\\r\\nlinux, docs\\\\two\\tadr\\r\\nreview`,
    `${closedAt}\tEPISODE_CLOSED\tFAILED outcome=oc\\\\1\\tb\\r\\nc`
  ]);

  // Escaping is a property of the human view alone: `--json` still emits the
  // raw bytes on disk, and the decoded events carry the operator's originals.
  const asJson = capture();
  assert.equal(
    await main(["episode", "events", "--episode", episodeId, "--state-root", stateRoot, "--json"], asJson.io),
    0,
    asJson.err.join("")
  );
  assert.equal(asJson.out.join(""), await rawEventLogText(stateRoot, episodeId));
  assert.deepEqual(
    asJson.out.map((line) => JSON.parse(line) as unknown),
    [
      {
        type: "EPISODE_OPENED",
        episode: {
          id: episodeId,
          projectId,
          objective,
          contractVersion: 1,
          runIds: [],
          startedAt: openedAt,
          status: "OPEN",
          acceptance: [],
          evidenceRefs: []
        },
        occurredAt: openedAt
      },
      { type: "RUN_ATTACHED", episodeId, runId, attachedAt },
      { type: "EPISODE_WAITING", episodeId, reason, requiredEvidence, occurredAt: waitedAt },
      { type: "EPISODE_CLOSED", episodeId, status: "FAILED", closedAt, outcomeId }
    ]
  );
});
