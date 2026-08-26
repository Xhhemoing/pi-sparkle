import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
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

/** The whole refusal `episode` owes an explicitly blank `--state-root`. */
function blankStateRootReport(raw: string): Record<string, unknown> {
  return {
    ok: false,
    command: "episode",
    stage: "parse-args",
    message: `invalid --state-root "${raw}": state root must be a non-empty directory path`,
    next: "pass --state-root <dir> or omit it to use the default ~/.pi-sparkle"
  };
}

const CORRUPT_EVENT_LOG_NEXT =
  "the episode event log is append-only and pi-sparkle never rewrites it: repair or move aside " +
  "the file named above, then retry; pi-sparkle doctor does not inventory episode logs";

const CORRUPT_SNAPSHOT_LOG_NEXT =
  "the episode log is append-only and pi-sparkle never rewrites it: repair or move aside the " +
  "file named above; pnpm cli list --episodes --json lists the readable episodes and names " +
  "damaged records under errors[]";

/**
 * A log damaged in a position `readJsonlObjects` cannot treat as a crash-
 * truncated tail: the bad row is followed by the rows the seed wrote, so the
 * reader fails closed instead of recovering. The seeded episode stays on disk
 * either side of the damage, which is what lets the close pins byte-compare
 * both files.
 */
async function prependCorruptLine(path: string, line: string): Promise<void> {
  await writeFile(path, `${line}\n${await readFile(path, "utf8")}`, "utf8");
}

function eventLogPath(stateRoot: string, episodeId: EpisodeId): string {
  return join(episodesDir(stateRoot), `${episodeId}.events.jsonl`);
}

function snapshotLogPath(stateRoot: string, episodeId: EpisodeId): string {
  return join(episodesDir(stateRoot), `${episodeId}.jsonl`);
}

/** A minimal OPEN episode to seed; the corrupt-log pins never decode it. */
function openEpisodeFixture(suffix: string): ProjectEpisode {
  return {
    id: createEpisodeId(() => suffix),
    projectId: createProjectId(() => suffix),
    objective: "ship",
    contractVersion: 1,
    runIds: [],
    startedAt: nowIso(),
    status: "OPEN",
    acceptance: [],
    evidenceRefs: []
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

/**
 * The remedy these faults used to reach is provably empty.
 *
 * A corrupt episode log threw past this verb into `main.ts`, whose generic
 * catch answers `use pi-sparkle doctor for preflight` — but doctor inventories
 * run logs (`runtime/runs`) and locks, not episode JSONL, so it names neither
 * file and reports every inventory clean while the command keeps refusing. The
 * store's own message already names the file and the line; the pins below hold
 * those bytes and add the two things the operator did not have: the log is
 * append-only and this CLI will never rewrite it, and — for `close` — the one
 * surface that does list the damaged record.
 */
test("a corrupt episode event log is refused by the verb, not routed to a doctor that cannot see it", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-corrupt-events-"));
  const episode = openEpisodeFixture("corrupt01");
  await seedEpisode(stateRoot, episode);
  await prependCorruptLine(eventLogPath(stateRoot, episode.id), "not-json");

  const captured = capture();
  const code = await main(
    ["episode", "events", "--episode", episode.id, "--state-root", stateRoot],
    captured.io
  );

  assert.equal(code, 1);
  assert.deepEqual(captured.out, []);
  assert.deepEqual(parseCliErrorJson(captured.err.join("")), {
    ok: false,
    command: "episode",
    stage: "validation",
    message: `Invalid JSON at line 1 in ${eventLogPath(stateRoot, episode.id)}`,
    next: CORRUPT_EVENT_LOG_NEXT
  });
});

test("an undecodable episode event is refused with the store's own line, not a decoder detail this verb reworded", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-bad-event-"));
  const episode = openEpisodeFixture("badevent1");
  await seedEpisode(stateRoot, episode);
  // Valid JSON, invalid event: the failure is the schema decoder's, one layer
  // past the JSON parse, and its refusal carries a different message shape.
  await prependCorruptLine(eventLogPath(stateRoot, episode.id), '{"type":"BANANA"}');

  const captured = capture();
  const code = await main(
    ["episode", "events", "--episode", episode.id, "--state-root", stateRoot],
    captured.io
  );

  assert.equal(code, 1);
  assert.deepEqual(captured.out, []);
  assert.deepEqual(parseCliErrorJson(captured.err.join("")), {
    ok: false,
    command: "episode",
    stage: "validation",
    message:
      `Invalid episode event at line 1 in ${eventLogPath(stateRoot, episode.id)}: ` +
      "Unknown EpisodeEvent.type: BANANA",
    next: CORRUPT_EVENT_LOG_NEXT
  });
});

test("a corrupt episode snapshot log refuses close, names the inventory that answers, and writes nothing", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-bad-snapshot-"));
  const episode = openEpisodeFixture("badsnap01");
  await seedEpisode(stateRoot, episode);
  await prependCorruptLine(snapshotLogPath(stateRoot, episode.id), "not-json");
  const snapshotBefore = await readFile(snapshotLogPath(stateRoot, episode.id), "utf8");
  const eventsBefore = await readFile(eventLogPath(stateRoot, episode.id), "utf8");

  const captured = capture();
  const code = await main(
    ["episode", "close", "--episode", episode.id, "--status", "FAILED", "--state-root", stateRoot],
    captured.io
  );

  assert.equal(code, 1);
  assert.deepEqual(captured.out, []);
  assert.deepEqual(parseCliErrorJson(captured.err.join("")), {
    ok: false,
    command: "episode",
    stage: "validation",
    message: `Invalid JSON at line 1 in ${snapshotLogPath(stateRoot, episode.id)}`,
    next: CORRUPT_SNAPSHOT_LOG_NEXT
  });
  // The refusal fires on the read, before `decideClosure` and both appends:
  // neither log gained a byte, so no WAITING_FOR_USER snapshot and no closing
  // event were recorded against a log nothing could decode.
  assert.equal(await readFile(snapshotLogPath(stateRoot, episode.id), "utf8"), snapshotBefore);
  assert.equal(await readFile(eventLogPath(stateRoot, episode.id), "utf8"), eventsBefore);
});

/**
 * A coded failure is not this verb's to convert.
 *
 * The corrupt-log catches classify on `DomainValidationError` *without* a
 * `code`, because `FileLockTimeoutError` extends the same class and carries
 * `LOCK_TIMEOUT` — a code `main.ts` routes to a `locks[]` remedy that genuinely
 * answers. Swallowing it here would trade a working remedy for an append-only
 * sentence about a file that is not damaged.
 */
test("a held episode lock still reaches main and keeps its routed locks[] remedy", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-held-lock-"));
  const episode = openEpisodeFixture("heldlock1");
  await seedEpisode(stateRoot, episode);
  // The cooperative lock `episode close` takes, already held by someone else.
  // pi-sparkle never steals a lock, so the close waits out its bounded timeout.
  await writeFile(
    join(episodesDir(stateRoot), `${episode.id}.lock`),
    JSON.stringify({ ownerToken: "someone-else", pid: 1, acquiredAt: nowIso() }),
    "utf8"
  );

  const captured = capture();
  const code = await main(
    ["episode", "close", "--episode", episode.id, "--status", "FAILED", "--state-root", stateRoot],
    captured.io
  );

  assert.equal(code, 1);
  const report = parseCliErrorJson(captured.err.join(""));
  assert.equal(report?.command, "episode");
  assert.equal(report?.stage, "validation");
  assert.match(report?.message ?? "", /^timed out waiting for lock at /);
  assert.equal(
    report?.next,
    "the lock is held and pi-sparkle never steals one: run pi-sparkle doctor --json " +
      `--state-root ${stateRoot} and read locks[] for the holder's pid, age and remediation, then retry`
  );
});

/**
 * `--state-root ""` is what `--state-root "$SR"` leaves behind when the shell
 * variable is unset. Resolved, it names a cwd-relative tree the operator never
 * asked about; the `episode` verbs would then report "no events under " and
 * "not found under " for episodes that exist where they meant, with a remedy
 * line whose `list --state-root ` swallows the following word when pasted.
 */
test("an explicitly blank --state-root is refused as an argv fault on both episode verbs", async () => {
  for (const raw of ["", "  "]) {
    for (const argv of [
      ["episode", "events", "--episode", "ep_probe", "--state-root", raw],
      ["episode", "close", "--episode", "ep_probe", "--status", "FAILED", "--state-root", raw]
    ]) {
      const captured = capture();
      const code = await main(argv, captured.io);

      assert.equal(code, 1, argv.join(" "));
      assert.deepEqual(captured.out, [], argv.join(" "));
      assert.deepEqual(parseCliErrorJson(captured.err.join("")), blankStateRootReport(raw), argv.join(" "));
    }
  }
});

/**
 * `--outcome ""` is what `--outcome "$OC"` leaves behind when the shell
 * variable is unset. Accepted, it is not a wording defect but a write: the
 * close appends `"outcomeId":""` to an append-only log this CLI refuses to
 * rewrite, so the blank reads back forever as an outcome the operator chose.
 * The same blank-value rule D31 drew for `pause --reason` and `inject --key`,
 * applied to the one free-text close flag it never reached.
 */
test("a blank --outcome is refused before the lock on every terminal status and writes nothing", async () => {
  for (const [index, status] of ["FAILED", "COMPLETED"].entries()) {
    for (const [rawIndex, raw] of ["", "  "].entries()) {
      const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-blank-outcome-"));
      const episode = openEpisodeFixture(`blank${index}${rawIndex}01`);
      await seedEpisode(stateRoot, episode);
      const snapshotBefore = await readFile(snapshotLogPath(stateRoot, episode.id), "utf8");
      const eventsBefore = await readFile(eventLogPath(stateRoot, episode.id), "utf8");

      const captured = capture();
      const argv = [
        "episode", "close", "--episode", episode.id, "--status", status,
        "--outcome", raw, "--state-root", stateRoot
      ];
      const code = await main(argv, captured.io);

      assert.equal(code, 1, argv.join(" "));
      assert.deepEqual(captured.out, [], argv.join(" "));
      assert.deepEqual(
        parseCliErrorJson(captured.err.join("")),
        {
          ok: false,
          command: "episode",
          stage: "parse-args",
          message: `invalid --outcome "${raw}": outcome id must be a non-empty string`,
          next: "pass --outcome <id> or omit it"
        },
        argv.join(" ")
      );
      // The refusal precedes the lock and both stores: neither log gained a
      // byte, so no blank outcome and no WAITING_FOR_USER were recorded.
      assert.equal(await readFile(snapshotLogPath(stateRoot, episode.id), "utf8"), snapshotBefore);
      assert.equal(await readFile(eventLogPath(stateRoot, episode.id), "utf8"), eventsBefore);
    }
  }
});

test("a nonblank --outcome is still accepted and a bad --status is still reported first", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-outcome-order-"));
  const accepted = openEpisodeFixture("outcomeok1");
  await seedEpisode(stateRoot, accepted);

  // The value domain is untouched: any nonblank string closes as it did.
  const closed = capture();
  assert.equal(
    await main(
      [
        "episode", "close", "--episode", accepted.id, "--status", "FAILED",
        "--outcome", " oc_padded", "--state-root", stateRoot
      ],
      closed.io
    ),
    0,
    closed.err.join("")
  );
  assert.equal(closed.out.join(""), `Episode ${accepted.id}: FAILED\n`);
  const lines = await humanEventLines(stateRoot, accepted.id);
  assertTimestampedLine(lines[1] ?? "", "EPISODE_CLOSED", "FAILED outcome= oc_padded");

  // The blank guard sits after the status refusal, so a mixed argv still hears
  // about the status it can name a legal value for.
  const mixed = capture();
  assert.equal(
    await main(
      [
        "episode", "close", "--episode", accepted.id, "--status", "banana",
        "--outcome", "", "--state-root", stateRoot
      ],
      mixed.io
    ),
    1
  );
  assert.deepEqual(parseCliErrorJson(mixed.err.join("")), {
    ok: false,
    command: "episode",
    stage: "parse-args",
    message: "episode close requires --status COMPLETED, FAILED, or ABANDONED",
    next: "pass --status COMPLETED, FAILED, or ABANDONED"
  });
});

/** The whole refusal a terminal episode owes a second close, on either path. */
const ALREADY_CLOSED_REPORT: Record<string, unknown> = {
  ok: false,
  command: "episode",
  stage: "close",
  message: "already-closed",
  next: "inspect --episode to see the terminal status"
};

async function closeFailed(stateRoot: string, episodeId: EpisodeId): Promise<void> {
  const captured = capture();
  assert.equal(
    await main(
      ["episode", "close", "--episode", episodeId, "--status", "FAILED", "--state-root", stateRoot],
      captured.io
    ),
    0,
    captured.err.join("")
  );
}

/**
 * One fault, one remedy, and one that works.
 *
 * `decideClosure` returns `already-closed` for a terminal snapshot, but the
 * COMPLETED branch wrapped every reason in the `acceptance-incomplete` next —
 * and both actions it names refuse on a closed episode: no evidence reopens
 * one, and closing it FAILED/ABANDONED lands on the guard that already owns
 * the working envelope. That envelope is now the answer on both paths.
 */
test("a COMPLETED re-close of a terminal episode gets the remedy the FAILED path already gave", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-reclose-"));
  const episode = openEpisodeFixture("reclose001");
  await seedEpisode(stateRoot, episode);
  await closeFailed(stateRoot, episode.id);
  const snapshotBefore = await readFile(snapshotLogPath(stateRoot, episode.id), "utf8");
  const eventsBefore = await readFile(eventLogPath(stateRoot, episode.id), "utf8");

  const captured = capture();
  const code = await main(
    ["episode", "close", "--episode", episode.id, "--status", "COMPLETED", "--state-root", stateRoot],
    captured.io
  );

  assert.equal(code, 1);
  assert.deepEqual(captured.out, []);
  const stderr = captured.err.join("");
  assert.deepEqual(parseCliErrorJson(stderr), ALREADY_CLOSED_REPORT);
  // The dead remedy is gone, and the bare reason line that printed the same
  // word a second time is gone with it: the envelope is the whole report.
  assert.doesNotMatch(stderr, /satisfy required evidence/);
  assert.ok(
    !stderr.split("\n").includes("already-closed"),
    `the bare reason line is still printed: ${JSON.stringify(stderr)}`
  );
  assert.doesNotMatch(stderr, /WAITING_FOR_USER/);

  // Byte-identical to the report the FAILED path issues for the same fault:
  // one terminal episode, one remedy, however the operator spelled the close.
  const failed = capture();
  assert.equal(
    await main(
      ["episode", "close", "--episode", episode.id, "--status", "FAILED", "--state-root", stateRoot],
      failed.io
    ),
    1
  );
  assert.equal(stderr, failed.err.join(""));
  // A refusal on a terminal episode records nothing against either log.
  assert.equal(await readFile(snapshotLogPath(stateRoot, episode.id), "utf8"), snapshotBefore);
  assert.equal(await readFile(eventLogPath(stateRoot, episode.id), "utf8"), eventsBefore);
});

test("a FAILED re-close of a terminal episode keeps the envelope it already had", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-reclose-failed-"));
  const episode = openEpisodeFixture("reclose002");
  await seedEpisode(stateRoot, episode);
  await closeFailed(stateRoot, episode.id);
  const snapshotBefore = await readFile(snapshotLogPath(stateRoot, episode.id), "utf8");
  const eventsBefore = await readFile(eventLogPath(stateRoot, episode.id), "utf8");

  const captured = capture();
  const code = await main(
    ["episode", "close", "--episode", episode.id, "--status", "FAILED", "--state-root", stateRoot],
    captured.io
  );

  assert.equal(code, 1);
  assert.deepEqual(captured.out, []);
  assert.deepEqual(parseCliErrorJson(captured.err.join("")), ALREADY_CLOSED_REPORT);
  assert.equal(await readFile(snapshotLogPath(stateRoot, episode.id), "utf8"), snapshotBefore);
  assert.equal(await readFile(eventLogPath(stateRoot, episode.id), "utf8"), eventsBefore);
});

/**
 * The reason the shared next was written for keeps every byte it had. This is
 * a real write disclosed as one, and generalising the terminal envelope over
 * it would drop both the disclosure and the evidence the episode waits for.
 */
test("an acceptance-incomplete COMPLETED close keeps its disclosure, its evidence line and its next", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-incomplete-bytes-"));
  const episode: ProjectEpisode = {
    ...openEpisodeFixture("incompl001"),
    acceptance: [{ id: "tests", description: "tests pass", observableCheck: "pnpm test" }]
  };
  await seedEpisode(stateRoot, episode);

  const captured = capture();
  const code = await main(
    ["episode", "close", "--episode", episode.id, "--status", "COMPLETED", "--state-root", stateRoot],
    captured.io
  );

  assert.equal(code, 1);
  assert.deepEqual(captured.out, []);
  const stderr = captured.err.join("");
  assert.ok(
    stderr.startsWith(
      `note: recorded WAITING_FOR_USER for ${episode.id} — this refused close changed the episode ` +
        "status; it now names its missing evidence\nacceptance-incomplete: tests\n"
    ),
    stderr
  );
  assert.deepEqual(parseCliErrorJson(stderr), {
    ok: false,
    command: "episode",
    stage: "close",
    message: "acceptance-incomplete",
    next: "satisfy required evidence or close as FAILED/ABANDONED"
  });
  // The write the disclosure claims actually happened.
  const snapshots = await new EpisodeStore(stateRoot, episode.id).readAll();
  assert.equal(snapshots.episodes.at(-1)?.status, "WAITING_FOR_USER");
  const events = await new EpisodeEventStore(stateRoot, episode.id).readAll();
  assert.equal(events.events.at(-1)?.type, "EPISODE_WAITING");
});

/**
 * `--status` and `--outcome` are close's flags. Parsed and ignored on `events`,
 * an operator who reads `--status FAILED` as a filter is handed the whole
 * unfiltered log as the answer to a question they did not ask — the same fault
 * the close `--json` refusal already covers in the opposite direction.
 */
test("episode events refuses the close-only flags it used to ignore, in both output modes", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-events-flags-"));
  const episode = openEpisodeFixture("evflags001");
  await seedEpisode(stateRoot, episode);

  for (const [flag, value] of [["--status", "FAILED"], ["--outcome", "oc_probe"]] as const) {
    for (const json of [[], ["--json"]]) {
      const captured = capture();
      const argv = [
        "episode", "events", "--episode", episode.id, "--state-root", stateRoot, flag, value, ...json
      ];
      const code = await main(argv, captured.io);

      assert.equal(code, 1, argv.join(" "));
      assert.deepEqual(captured.out, [], argv.join(" "));
      assert.deepEqual(
        parseCliErrorJson(captured.err.join("")),
        {
          ok: false,
          command: "episode",
          stage: "parse-args",
          message: `episode events does not accept ${flag}; ${flag} applies to episode close`,
          next: `drop ${flag}, or use episode close`
        },
        argv.join(" ")
      );
    }
  }

  // The success path is untouched: the same command without the close flags
  // still prints verbatim JSONL of the rows on disk.
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
});

test("the events flag refusal does not displace the missing --episode or the blank --state-root", async () => {
  // D39 put missing `--episode` ahead of the blank root, and both ahead of any
  // flag this verb judges for itself: an operator who named no episode has not
  // yet made a `--status` mistake, and the literal argv below must keep saying
  // so rather than reporting the root or the flag.
  const missing = capture();
  assert.equal(await main(["episode", "events", "--status", "FAILED", "--state-root", ""], missing.io), 1);
  assert.deepEqual(missing.out, []);
  assert.deepEqual(parseCliErrorJson(missing.err.join("")), {
    ok: false,
    command: "episode",
    stage: "parse-args",
    message: "episode command requires --episode <epId>",
    next: "pass --episode <epId>"
  });

  // With the episode named, the blank root is still the earlier fault.
  const blankRoot = capture();
  assert.equal(
    await main(
      ["episode", "events", "--episode", "ep_evflags", "--status", "FAILED", "--state-root", ""],
      blankRoot.io
    ),
    1
  );
  assert.deepEqual(blankRoot.out, []);
  assert.deepEqual(parseCliErrorJson(blankRoot.err.join("")), blankStateRootReport(""));

  // And the verb still settles before any of them.
  const unknown = capture();
  assert.equal(
    await main(
      ["episode", "nonsense", "--episode", "banana", "--status", "FAILED", "--state-root", ""],
      unknown.io
    ),
    1
  );
  assert.deepEqual(parseCliErrorJson(unknown.err.join("")), {
    ok: false,
    command: "episode",
    stage: "parse-args",
    message: "Unknown episode command: nonsense",
    next: "use episode events or episode close"
  });
});

test("a blank --state-root does not displace the help return or the unknown-subcommand refusal", async () => {
  // D33's rule: which verb was asked for is settled before that verb's flags
  // are judged, and `--help` answers before any of them. Neither of these two
  // paths needs a state root, so neither may start reporting one.
  const helped = capture();
  assert.equal(await main(["episode", "events", "--help", "--state-root", ""], helped.io), 0);
  assert.equal(helped.out.join(""), EPISODE_USAGE);
  assert.deepEqual(helped.err, []);

  const unknown = capture();
  assert.equal(
    await main(["episode", "nonsense", "--episode", "ep_probe", "--state-root", ""], unknown.io),
    1
  );
  assert.deepEqual(unknown.out, []);
  const stderr = unknown.err.join("");
  assert.ok(stderr.startsWith(EPISODE_USAGE), "usage still precedes the report on stderr");
  assert.deepEqual(parseCliErrorJson(stderr), {
    ok: false,
    command: "episode",
    stage: "parse-args",
    message: "Unknown episode command: nonsense",
    next: "use episode events or episode close"
  });
});
