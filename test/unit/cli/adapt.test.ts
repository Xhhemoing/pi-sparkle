import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { hashCandidateContent, type EvaluationPlan } from "../../../src/adaptation/candidate.js";
import {
  adaptationRegistryPath,
  loadAdaptationRegistry,
  saveAdaptationRegistry,
  withAdaptationRegistryLock
} from "../../../src/adaptation/promotion.js";
import { ResourceRegistry } from "../../../src/adaptation/registry.js";
import type { AuthorIdentity, ResourceIdentity } from "../../../src/adaptation/resource.js";
import {
  createEpisodeId,
  createMessageId,
  createProjectId,
  createRunId,
  parseTaskId,
  type AgentInstanceId,
  type IdGenerator,
  type RunId,
  type TaskId
} from "../../../src/domain/ids.js";
import { parseIsoTimestamp, type IsoTimestamp } from "../../../src/domain/timestamp.js";
import { adaptCommand } from "../../../src/cli/adapt.js";
import { main, type CliIo } from "../../../src/cli/main.js";
import { routingPolicyContent, type LearnedRoutingPolicy } from "../../../src/learning/learned-routing.js";
import {
  listObservations,
  preferenceSnapshotPath,
  resetPreferenceStore
} from "../../../src/preferences/store.js";
import { SUPERVISOR } from "../../../src/protocol/v1.js";
import { EventStore } from "../../../src/run/event-store.js";
import type { Event } from "../../../src/run/events.js";
import { ASSIGN_FEATURE_VERSION } from "../../../src/routing/feature-version.js";
import { makeEvent } from "../../helpers/event-factory.js";

interface WrittenEvalReport {
  readonly candidateId: string;
  readonly contentHash: string;
  readonly evidenceClass: string;
  readonly cacheKey: string;
  readonly rerunHash: string;
  readonly comparison: {
    readonly claims: readonly string[];
    readonly evidenceClass: string;
    readonly canCloseProductionCheckpointF: boolean;
  };
}

async function writeReview(
  dir: string,
  actorId: string,
  candidateId: string,
  content: string,
  extras: { readonly acceptProvisional?: boolean; readonly verdict?: unknown } = {}
): Promise<string> {
  const path = join(dir, `review-${candidateId}.json`);
  await writeFile(
    path,
    JSON.stringify({
      reviewId: `review-${candidateId}`,
      candidateId,
      contentHash: hashCandidateContent(content),
      verdict: extras.verdict !== undefined ? extras.verdict : "approved",
      reviewerKind: "independent",
      reviewerId: "human:reviewer",
      actorId,
      evidenceRefs: ["manual-review"],
      ...(extras.acceptProvisional !== undefined
        ? { acceptProvisional: extras.acceptProvisional }
        : {})
    }),
    "utf8"
  );
  return path;
}

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

test("adapt status describes the proposal-first plane", async () => {
  const { io, out, err } = capture();
  const code = await adaptCommand(["status", "--state-root", "/tmp/pi-sparkle-adapt"], io);
  assert.equal(code, 0);
  assert.deepEqual(err, []);
  assert.match(out.join(""), /proposal-first/);
  assert.match(out.join(""), /cannot rewrite policy/);
  assert.match(out.join(""), /shadow-only/);
  assert.match(out.join(""), /propose/);
  assert.doesNotMatch(out.join(""), /may auto-promote/);
});

test("adapt promote refuses to mutate live policy", async () => {
  const { io, err } = capture();
  const code = await adaptCommand(["promote"], io);
  assert.equal(code, 1);
  assert.match(err.join(""), /refusing to mutate live policy/);
});

test("adapt promote without --approve still refuses", async () => {
  const { io, err } = capture();
  const code = await adaptCommand(
    [
      "promote",
      "--candidate",
      "cnd_seq0001",
      "--expected",
      "rsv_seq0001",
      "--content-file",
      "content.txt"
    ],
    io
  );
  assert.equal(code, 1);
  assert.match(err.join(""), /refusing to mutate live policy/);
});

test("adapt promote --approve requires a persisted review artifact", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-review-required-"));
  const contentPath = join(dir, "content.txt");
  await writeFile(contentPath, "v2", "utf8");
  const { io, err } = capture();
  const code = await adaptCommand([
    "promote", "--candidate", "cnd_seq0002", "--expected", "rsv_seq0001",
    "--content-file", contentPath, "--approve", "--state-root", dir
  ], io);
  assert.equal(code, 1);
  assert.match(err.join(""), /--review-file/);
});

test("adapt promote --approve fails closed when no registry snapshot exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-cli-"));
  const contentPath = join(dir, "content.txt");
  const reviewPath = await writeReview(dir, "alice", "cnd_seq0002", "v2");
  await writeFile(contentPath, "v2", "utf8");
  const { io, err } = capture();
  const code = await adaptCommand(
    [
      "promote",
      "--candidate",
      "cnd_seq0002",
      "--expected",
      "rsv_seq0001",
      "--content-file",
      contentPath,
      "--review-file",
      reviewPath,
      "--approve",
      "--state-root",
      dir
    ],
    io
  );
  assert.equal(code, 1);
  assert.match(err.join(""), /no registry snapshot/);
});

test("adapt promote --approve refuses a misspelled verdict instead of reading it as approval", async () => {
  for (const verdict of ["aprove", "Approved", "APPROVED", true]) {
    const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-verdict-"));
    const contentPath = join(dir, "content.txt");
    await writeFile(contentPath, "v2", "utf8");
    const reviewPath = await writeReview(dir, "alice", "cnd_seq0002", "v2", { verdict });
    const { io, err } = capture();
    const code = await adaptCommand(
      [
        "promote",
        "--candidate",
        "cnd_seq0002",
        "--expected",
        "rsv_seq0001",
        "--content-file",
        contentPath,
        "--review-file",
        reviewPath,
        "--approve",
        "--state-root",
        dir
      ],
      io
    );
    assert.equal(code, 1);
    assert.match(err.join(""), /verdict must be "approved" or "rejected"/);
    // Refused at parse time, before the registry is even read.
    assert.doesNotMatch(err.join(""), /no registry snapshot/);
    await rm(dir, { recursive: true, force: true });
  }
});

test("adapt promote --approve CAS-promotes from a registry snapshot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-cli-ok-"));
  const contentPath = join(dir, "content.txt");
  await writeFile(contentPath, "v2 prompt", "utf8");

  let n = 0;
  const generateId: IdGenerator = () => {
    n += 1;
    return `cli${String(n).padStart(4, "0")}`;
  };
  const now = () => "2026-08-15T00:00:00.000Z" as IsoTimestamp;
  const author: AuthorIdentity = { kind: "human", identity: "alice" };
  const plan: EvaluationPlan = {
    stages: ["static"],
    metrics: ["utility"],
    planVersion: 1
  };
  const identity: ResourceIdentity = {
    kind: "prompt",
    name: "main-agent-prompt",
    scope: { kind: "project", projectId: createProjectId(() => "cli0001") }
  };
  const reg = new ResourceRegistry({ now, generateId });
  const baseline = reg.registerBaseline({ identity, content: "v1", author });
  const candidate = reg.createCandidate({
    identity,
    content: "v2 prompt",
    parentVersionId: baseline.versionId,
    author,
    evaluationPlan: plan
  });
  await saveAdaptationRegistry(dir, reg);

  const reviewPath = await writeReview(dir, author.identity, candidate.candidateId, "v2 prompt");
  const { io, out, err } = capture();
  const code = await adaptCommand(
    [
      "promote",
      "--candidate",
      candidate.candidateId,
      "--expected",
      baseline.versionId,
      "--content-file",
      contentPath,
      "--review-file",
      reviewPath,
      "--approve",
      "--state-root",
      dir
    ],
    io
  );
  assert.equal(code, 0, err.join(""));
  assert.deepEqual(err, []);
  assert.match(out.join(""), /promoted/);
  assert.ok(out.join("").includes(candidate.candidateId));
});

test("concurrent CLI promotions serialize registry read-modify-write and preserve CAS", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-cli-race-"));
  const firstPath = join(dir, "first.txt");
  const secondPath = join(dir, "second.txt");
  await writeFile(firstPath, "v2-first", "utf8");
  await writeFile(secondPath, "v2-second", "utf8");

  let n = 0;
  const generateId: IdGenerator = () => `race${String(++n).padStart(4, "0")}`;
  const now = () => "2026-08-15T00:00:00.000Z" as IsoTimestamp;
  const author: AuthorIdentity = { kind: "human", identity: "alice" };
  const plan: EvaluationPlan = { stages: ["static"], metrics: ["utility"], planVersion: 1 };
  const identity: ResourceIdentity = {
    kind: "prompt",
    name: "main-agent-prompt",
    scope: { kind: "project", projectId: createProjectId(() => "race0001") }
  };
  const reg = new ResourceRegistry({ now, generateId });
  const baseline = reg.registerBaseline({ identity, content: "v1", author });
  const first = reg.createCandidate({
    identity,
    content: "v2-first",
    parentVersionId: baseline.versionId,
    author,
    evaluationPlan: plan
  });
  const second = reg.createCandidate({
    identity,
    content: "v2-second",
    parentVersionId: baseline.versionId,
    author,
    evaluationPlan: plan
  });
  await saveAdaptationRegistry(dir, reg);
  const firstReviewPath = await writeReview(dir, author.identity, first.candidateId, "v2-first");
  const secondReviewPath = await writeReview(dir, author.identity, second.candidateId, "v2-second");

  const a = capture();
  const b = capture();
  const results = await Promise.all([
    adaptCommand([
      "promote", "--candidate", first.candidateId, "--expected", baseline.versionId,
      "--content-file", firstPath, "--review-file", firstReviewPath,
      "--approve", "--state-root", dir
    ], a.io),
    adaptCommand([
      "promote", "--candidate", second.candidateId, "--expected", baseline.versionId,
      "--content-file", secondPath, "--review-file", secondReviewPath,
      "--approve", "--state-root", dir
    ], b.io)
  ]);

  assert.deepEqual([...results].sort(), [0, 1]);
  const loaded = await import("../../../src/adaptation/promotion.js").then(({ loadAdaptationRegistry }) =>
    loadAdaptationRegistry(dir)
  );
  assert.equal(loaded.ledger().filter((entry) => entry.kind === "promoted").length, 1);
});

test("existing registry locks are not guessed stale and fail closed on timeout", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-stale-lock-"));
  const lockPath = `${adaptationRegistryPath(dir)}.lock`;
  const staleAt = new Date(Date.now() - 120_000);
  await mkdir(join(dir, "adaptation"), { recursive: true });
  await writeFile(lockPath, JSON.stringify({ pid: 99_999_999, acquiredAt: staleAt.toISOString() }), "utf8");
  await utimes(lockPath, staleAt, staleAt);

  await assert.rejects(
    () => withAdaptationRegistryLock(dir, async () => "unexpected", { timeoutMs: 100, retryMs: 5 }),
    /timed out waiting for lock/
  );
});

test("main prints the package version", async () => {
  for (const flag of ["--version", "-V", "version"] as const) {
    const { io, out, err } = capture();
    const code = await main([flag], io);
    assert.equal(code, 0, flag);
    assert.deepEqual(err, []);
    assert.match(out.join(""), /^0\.1\.0\n$/);
  }
});

test("main routes adapt status as proposal-first", async () => {
  const { io, out, err } = capture();
  const code = await main(["adapt", "status", "--state-root", "/tmp/pi-sparkle-adapt"], io);
  assert.equal(code, 0);
  assert.deepEqual(err, []);
  assert.match(out.join(""), /proposal-first/);
});

test("main routes adapt promote as a refusal", async () => {
  const { io, err } = capture();
  const code = await main(["adapt", "promote"], io);
  assert.equal(code, 1);
  assert.match(err.join(""), /refusing to mutate live policy/);
});

test("adapt eval requires --candidate and --dataset", async () => {
  const { io, err } = capture();
  const code = await adaptCommand(["eval"], io);
  assert.equal(code, 1);
  assert.match(err.join(""), /--candidate/);
  assert.match(err.join(""), /--dataset/);
});

test("adapt eval writes a report path, does not promote, and is deterministic", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-eval-"));
  const frozenWorkspace = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-eval-ws-"));
  const datasetDir = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-eval-ds-"));
  let n = 0;
  const generateId: IdGenerator = () => `ae${String(++n).padStart(4, "0")}`;
  const now = () => "2026-08-19T00:00:00.000Z" as IsoTimestamp;
  const author: AuthorIdentity = { kind: "human", identity: "alice" };
  const plan: EvaluationPlan = { stages: ["static", "replay"], metrics: ["utility", "cost"], planVersion: 1 };
  const identity: ResourceIdentity = {
    kind: "routing-policy",
    name: "smart-assign",
    scope: { kind: "project", projectId: createProjectId(() => "ae0001") }
  };
  const baselinePolicy: LearnedRoutingPolicy = { primaryModelId: "premium", avoid: [], prefer: [] };
  const candidatePolicy: LearnedRoutingPolicy = {
    primaryModelId: "premium",
    avoid: [{ modelId: "cheap", family: "edit", reason: "cli-eval" }],
    prefer: [{ family: "edit", modelId: "premium" }]
  };
  const reg = new ResourceRegistry({ now, generateId });
  const baseline = reg.registerBaseline({
    identity,
    content: routingPolicyContent(baselinePolicy),
    author
  });
  const candidate = reg.createCandidate({
    identity,
    content: routingPolicyContent(candidatePolicy),
    parentVersionId: baseline.versionId,
    author,
    evaluationPlan: plan
  });
  await saveAdaptationRegistry(stateRoot, reg);
  await writeFile(
    join(datasetDir, "manifest.json"),
    JSON.stringify({
      datasetId: "ds-cli-eval",
      environmentVersion: "env-cli-1",
      episodes: [
        {
          episodeHash: "eh-cli-1",
          taskId: "tsk_edit01",
          role: "implementer",
          objective: "Implement the cache layer",
          taskFamily: "edit",
          taskSuccess: "PASS",
          originalWorkspace: frozenWorkspace
        },
        {
          episodeHash: "eh-cli-2",
          taskId: "tsk_edit02",
          role: "implementer",
          objective: "Implement the cache layer",
          taskFamily: "edit",
          taskSuccess: "FAIL",
          originalWorkspace: frozenWorkspace
        }
      ]
    }),
    "utf8"
  );

  const first = capture();
  const firstCode = await adaptCommand(
    [
      "eval",
      "--candidate",
      candidate.candidateId,
      "--dataset",
      datasetDir,
      "--state-root",
      stateRoot
    ],
    first.io
  );
  assert.equal(firstCode, 0, first.err.join(""));
  assert.deepEqual(first.err, []);
  const reportPath = first.out.join("").trim();
  assert.match(reportPath, /adaptation[\\/]evals/);
  const written = JSON.parse(await readFile(reportPath, "utf8")) as WrittenEvalReport;
  assert.equal(written.candidateId, candidate.candidateId);
  assert.equal(written.contentHash, candidate.contentHash);
  assert.equal(written.evidenceClass, "replay");
  assert.equal(written.comparison.evidenceClass, "simulation");
  assert.equal(written.comparison.canCloseProductionCheckpointF, false);
  assert.ok(written.cacheKey.length > 0);
  assert.ok(written.rerunHash.length > 0);
  assert.ok(!written.comparison.claims.some((claim) => /improve|outperform|better/i.test(claim)));

  const after = await loadAdaptationRegistry(stateRoot);
  assert.equal(after.getActiveVersion(identity)?.versionId, baseline.versionId);

  const second = capture();
  const secondCode = await adaptCommand(
    [
      "eval",
      "--candidate",
      candidate.candidateId,
      "--dataset",
      datasetDir,
      "--state-root",
      stateRoot
    ],
    second.io
  );
  assert.equal(secondCode, 0, second.err.join(""));
  const secondPath = second.out.join("").trim();
  const secondReport = JSON.parse(await readFile(secondPath, "utf8")) as WrittenEvalReport;
  assert.equal(secondReport.cacheKey, written.cacheKey);
  assert.equal(secondReport.rerunHash, written.rerunHash);
});

test("adapt eval fails closed for a non-routing-policy candidate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-eval-kind-"));
  const datasetDir = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-eval-kind-ds-"));
  const frozenWorkspace = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-eval-kind-ws-"));
  let n = 0;
  const generateId: IdGenerator = () => `ak${String(++n).padStart(4, "0")}`;
  const now = () => "2026-08-19T00:00:00.000Z" as IsoTimestamp;
  const author: AuthorIdentity = { kind: "human", identity: "alice" };
  const plan: EvaluationPlan = { stages: ["static"], metrics: ["utility"], planVersion: 1 };
  const identity: ResourceIdentity = {
    kind: "prompt",
    name: "main-agent-prompt",
    scope: { kind: "project", projectId: createProjectId(() => "ak0001") }
  };
  const reg = new ResourceRegistry({ now, generateId });
  const baseline = reg.registerBaseline({ identity, content: "v1", author });
  const candidate = reg.createCandidate({
    identity,
    content: "v2 prompt",
    parentVersionId: baseline.versionId,
    author,
    evaluationPlan: plan
  });
  await saveAdaptationRegistry(dir, reg);
  await writeFile(
    join(datasetDir, "manifest.json"),
    JSON.stringify({
      datasetId: "ds-kind",
      environmentVersion: "env-1",
      episodes: [
        {
          episodeHash: "eh-1",
          taskId: "tsk_edit01",
          role: "implementer",
          objective: "Implement the cache layer",
          taskSuccess: "PASS",
          originalWorkspace: frozenWorkspace
        }
      ]
    }),
    "utf8"
  );
  const { io, err } = capture();
  const code = await adaptCommand(
    [
      "eval",
      "--candidate",
      candidate.candidateId,
      "--dataset",
      datasetDir,
      "--state-root",
      dir
    ],
    io
  );
  assert.equal(code, 1);
  assert.match(err.join(""), /routing-policy/);
});

test("main routes adapt eval", async () => {
  const { io, err } = capture();
  const code = await main(["adapt", "eval"], io);
  assert.equal(code, 1);
  assert.match(err.join(""), /eval requires --candidate/);
});

async function seedRoutingPromoteCli(dir: string): Promise<{
  readonly candidateId: string;
  readonly baselineVersionId: string;
  readonly content: string;
  readonly identity: ResourceIdentity;
}> {
  let n = 0;
  const generateId: IdGenerator = () => `rp${String(++n).padStart(4, "0")}`;
  const now = () => "2026-08-19T00:00:00.000Z" as IsoTimestamp;
  const author: AuthorIdentity = { kind: "human", identity: "alice" };
  const plan: EvaluationPlan = {
    stages: ["static", "replay"],
    metrics: ["utility", "cost"],
    planVersion: 1
  };
  const identity: ResourceIdentity = {
    kind: "routing-policy",
    name: "smart-assign",
    scope: { kind: "project", projectId: createProjectId(() => "rp0001") }
  };
  const baselinePolicy: LearnedRoutingPolicy = { primaryModelId: "premium", avoid: [], prefer: [] };
  const candidatePolicy: LearnedRoutingPolicy = {
    primaryModelId: "premium",
    avoid: [{ modelId: "cheap", family: "edit", reason: "cli-promote" }],
    prefer: [{ family: "edit", modelId: "premium" }]
  };
  const content = routingPolicyContent(candidatePolicy);
  const reg = new ResourceRegistry({ now, generateId });
  const baseline = reg.registerBaseline({
    identity,
    content: routingPolicyContent(baselinePolicy),
    author
  });
  const candidate = reg.createCandidate({
    identity,
    content,
    parentVersionId: baseline.versionId,
    author,
    evaluationPlan: plan
  });
  await saveAdaptationRegistry(dir, reg);
  return {
    candidateId: candidate.candidateId,
    baselineVersionId: baseline.versionId,
    content,
    identity
  };
}

test("adapt promote --approve for routing-policy without --eval-file refuses and leaves the live pointer unchanged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-no-eval-"));
  const seeded = await seedRoutingPromoteCli(dir);
  const contentPath = join(dir, "policy.json");
  await writeFile(contentPath, seeded.content, "utf8");
  const reviewPath = await writeReview(dir, "alice", seeded.candidateId, seeded.content);
  const { io, err } = capture();
  const code = await adaptCommand(
    [
      "promote",
      "--candidate",
      seeded.candidateId,
      "--expected",
      seeded.baselineVersionId,
      "--content-file",
      contentPath,
      "--review-file",
      reviewPath,
      "--approve",
      "--state-root",
      dir
    ],
    io
  );
  assert.equal(code, 1);
  assert.match(err.join(""), /eval-file/);
  const loaded = await loadAdaptationRegistry(dir);
  assert.equal(loaded.getActiveVersion(seeded.identity)?.versionId, seeded.baselineVersionId);
});

test("adapt promote --approve for routing-policy with a qualifying --eval-file succeeds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-eval-file-"));
  const frozenWorkspace = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-eval-file-ws-"));
  const datasetDir = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-eval-file-ds-"));
  const seeded = await seedRoutingPromoteCli(dir);
  await writeFile(
    join(datasetDir, "manifest.json"),
    JSON.stringify({
      datasetId: "ds-cli-promote",
      environmentVersion: "env-cli-promote",
      episodes: [
        {
          episodeHash: "eh-cli-p1",
          taskId: "tsk_edit01",
          role: "implementer",
          objective: "Implement the cache layer",
          taskFamily: "edit",
          taskSuccess: "PASS",
          originalWorkspace: frozenWorkspace
        },
        {
          episodeHash: "eh-cli-p2",
          taskId: "tsk_edit02",
          role: "implementer",
          objective: "Implement the cache layer",
          taskFamily: "edit",
          taskSuccess: "FAIL",
          originalWorkspace: frozenWorkspace
        }
      ]
    }),
    "utf8"
  );
  const evalCapture = capture();
  const evalCode = await adaptCommand(
    [
      "eval",
      "--candidate",
      seeded.candidateId,
      "--dataset",
      datasetDir,
      "--state-root",
      dir
    ],
    evalCapture.io
  );
  assert.equal(evalCode, 0, evalCapture.err.join(""));
  const evalFile = evalCapture.out.join("").trim();
  const contentPath = join(dir, "policy.json");
  await writeFile(contentPath, seeded.content, "utf8");
  const reviewPath = await writeReview(dir, "alice", seeded.candidateId, seeded.content, {
    acceptProvisional: false
  });
  const { io, out, err } = capture();
  const code = await adaptCommand(
    [
      "promote",
      "--candidate",
      seeded.candidateId,
      "--expected",
      seeded.baselineVersionId,
      "--content-file",
      contentPath,
      "--review-file",
      reviewPath,
      "--eval-file",
      evalFile,
      "--approve",
      "--state-root",
      dir
    ],
    io
  );
  assert.equal(code, 0, err.join(""));
  assert.deepEqual(err, []);
  assert.match(out.join(""), /promoted/);
  const loaded = await loadAdaptationRegistry(dir);
  assert.notEqual(loaded.getActiveVersion(seeded.identity)?.versionId, seeded.baselineVersionId);
});

interface ShowJson {
  readonly type: string;
  readonly preview: boolean;
  readonly candidateId: string;
  readonly kind: string;
  readonly name: string;
  readonly status: string;
  readonly authorKind: string;
  readonly authorIdentity: string;
  readonly reviewActorId: string;
  readonly contentHash: string;
  readonly contentBytes: number;
  readonly content: string;
  readonly contentFile: string | null;
  readonly parentVersionId: string;
  readonly activeVersionId: string | null;
}

/**
 * The auto-loop's own author identity: a detector string no other command
 * prints, and exactly the `actorId` a promotion review must carry.
 */
const AUTO_ACTOR = "pi-sparkle-auto-loop";

const LOOP_AGENT = "agt_00000000-0000-4000-8000-00000000000a" as AgentInstanceId;
const LOOP_OCCURRED = parseIsoTimestamp("2026-08-25T00:00:00.000Z");

/** One tracked edit run with two deterministically verified routed tasks. */
function routedEditRun(runId: RunId, workspace: string): Event[] {
  const tasks = [
    { taskId: parseTaskId("tsk_loop01"), outcome: "PASS" as const },
    { taskId: parseTaskId("tsk_loop02"), outcome: "FAIL" as const }
  ];
  return [
    makeEvent(
      "PROJECT_DISCOVERED",
      {
        project: {
          id: createProjectId(),
          rootPath: workspace,
          discoveredAt: LOOP_OCCURRED,
          instructionFiles: [],
          manifests: [],
          commands: [],
          facts: []
        }
      },
      { runId }
    ),
    makeEvent(
      "TASK_GRAPH_ACCEPTED",
      {
        tasks: tasks.map((task) => ({
          id: task.taskId,
          title: "cache work",
          objective: "Implement the cache layer",
          role: "implementer",
          dependencies: [],
          acceptanceCriteria: [{ id: "ac1", description: "tests pass" }],
          status: "PENDING",
          attempt: 0,
          maxAttempts: 2,
          timeoutMs: 60_000,
          artifactIds: [],
          evidenceIds: []
        }))
      },
      { runId }
    ),
    ...tasks.flatMap((task) => [
      makeEvent(
        "MODEL_ROUTED",
        {
          taskId: task.taskId,
          role: "actor",
          complexity: "MEDIUM",
          model: "cheap",
          justification: "cheapest eligible",
          confidence: 0.8,
          approvalPlan: { id: "ap_loop", items: [{ id: "go", label: "go", selectable: true }] },
          statusAfterRoute: "RUNNING",
          policyVersion: "router-v1",
          estimatedCostUsd: 0.1,
          estimatedDurationMs: 1000,
          family: "edit",
          featureVersion: ASSIGN_FEATURE_VERSION,
          modelVersion: "cheap-v1",
          highRisk: false,
          eligibleModels: ["cheap", "premium"],
          rejections: [],
          behaviorDistribution: { cheap: 1, premium: 0 },
          agentRole: "implementer"
        },
        { taskId: task.taskId, runId }
      ),
      makeEvent(
        "CHILD_MESSAGE",
        {
          message: {
            protocolVersion: 1 as const,
            id: createMessageId(),
            occurredAt: LOOP_OCCURRED,
            runId,
            taskId: task.taskId,
            from: LOOP_AGENT,
            to: SUPERVISOR,
            type: "TASK_RESULT" as const,
            outcome: task.outcome === "PASS" ? ("SUCCESS" as const) : ("FAILURE" as const),
            summary: task.outcome === "PASS" ? "checks green" : "golden fixture mismatch",
            artifactIds: [],
            evidenceIds: ["evd_check"],
            verification:
              task.outcome === "PASS"
                ? { kind: "PASSED" as const, evidenceIds: ["evd_check"] }
                : { kind: "FAILED" as const, evidenceIds: ["evd_check"] },
            ...(task.outcome === "FAIL" ? { failure: { category: "MODEL_ERROR" } } : {})
          }
        },
        { taskId: task.taskId, runId }
      )
    ])
  ];
}

async function seedDetectorCandidate(dir: string): Promise<{
  readonly candidateId: string;
  readonly baselineVersionId: string;
  readonly content: string;
  readonly contentHash: string;
  readonly identity: ResourceIdentity;
}> {
  let n = 0;
  const generateId: IdGenerator = () => `sh${String(++n).padStart(4, "0")}`;
  const now = () => "2026-08-25T00:00:00.000Z" as IsoTimestamp;
  const author: AuthorIdentity = { kind: "detector", identity: AUTO_ACTOR };
  const identity: ResourceIdentity = {
    kind: "routing-policy",
    name: "smart-assign",
    scope: { kind: "project", projectId: createProjectId(() => "sh000001") }
  };
  const content = routingPolicyContent({
    primaryModelId: "premium",
    avoid: [{ modelId: "cheap", family: "edit", reason: "meanScore 0.20 over 5 samples" }],
    prefer: [{ family: "edit", modelId: "premium" }]
  });
  const reg = new ResourceRegistry({ now, generateId });
  const baseline = reg.registerBaseline({
    identity,
    content: routingPolicyContent({ primaryModelId: "premium", avoid: [], prefer: [] }),
    author
  });
  const candidate = reg.createCandidate({
    identity,
    content,
    parentVersionId: baseline.versionId,
    author,
    evaluationPlan: { stages: ["static", "replay"], metrics: ["utility", "cost"], planVersion: 1 }
  });
  await saveAdaptationRegistry(dir, reg);
  return {
    candidateId: candidate.candidateId,
    baselineVersionId: baseline.versionId,
    content,
    contentHash: candidate.contentHash,
    identity
  };
}

test("adapt show prints the promote inputs and leaves the registry untouched", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-show-"));
  const seeded = await seedDetectorCandidate(dir);
  const before = await readFile(adaptationRegistryPath(dir), "utf8");

  const { io, out, err } = capture();
  const code = await adaptCommand(
    ["show", "--candidate", seeded.candidateId, "--state-root", dir],
    io
  );

  assert.equal(code, 0, err.join(""));
  assert.deepEqual(err, []);
  const text = out.join("");
  assert.match(text, new RegExp(`candidate: ${seeded.candidateId}`));
  assert.match(text, /kind: routing-policy/);
  assert.match(text, new RegExp(`review actorId: ${AUTO_ACTOR}`));
  assert.match(text, new RegExp(`contentHash: ${seeded.contentHash}`));
  assert.match(text, new RegExp(`active version: ${seeded.baselineVersionId}`));
  assert.ok(text.includes(seeded.content), "show did not print the candidate content");
  assert.doesNotMatch(text, /promoted/);
  assert.equal(await readFile(adaptationRegistryPath(dir), "utf8"), before);
});

test("adapt show --json is one frozen-additive preview object", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-show-json-"));
  const seeded = await seedDetectorCandidate(dir);
  const contentPath = join(dir, "candidate.json");

  const { io, out, err } = capture();
  const code = await adaptCommand(
    [
      "show",
      "--candidate",
      seeded.candidateId,
      "--content-file",
      contentPath,
      "--json",
      "--state-root",
      dir
    ],
    io
  );

  assert.equal(code, 0, err.join(""));
  assert.deepEqual(err, []);
  const lines = out.join("").trimEnd().split("\n");
  assert.equal(lines.length, 1, "show --json must print exactly one line");
  const payload = JSON.parse(lines[0] ?? "") as ShowJson;
  assert.equal(payload.type, "ADAPT_CANDIDATE");
  assert.equal(payload.preview, true);
  assert.equal(payload.candidateId, seeded.candidateId);
  assert.equal(payload.kind, "routing-policy");
  assert.equal(payload.name, "smart-assign");
  assert.equal(payload.status, "proposed");
  assert.equal(payload.authorKind, "detector");
  assert.equal(payload.authorIdentity, AUTO_ACTOR);
  assert.equal(payload.reviewActorId, AUTO_ACTOR);
  assert.equal(payload.contentHash, seeded.contentHash);
  assert.equal(payload.content, seeded.content);
  assert.equal(payload.contentBytes, Buffer.byteLength(seeded.content, "utf8"));
  assert.equal(payload.contentFile, contentPath);
  assert.equal(payload.parentVersionId, seeded.baselineVersionId);
  assert.equal(payload.activeVersionId, seeded.baselineVersionId);
  // The written bytes are the promote input, not a re-rendering of it.
  assert.equal(await readFile(contentPath, "utf8"), seeded.content);
  assert.equal(hashCandidateContent(await readFile(contentPath, "utf8")), seeded.contentHash);
});

test("adapt show fails closed on a missing, malformed, or unknown candidate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-show-bad-"));
  const seeded = await seedDetectorCandidate(dir);

  const missing = capture();
  assert.equal(await adaptCommand(["show", "--state-root", dir], missing.io), 1);
  assert.match(missing.err.join(""), /--candidate/);

  const malformed = capture();
  assert.equal(
    await adaptCommand(["show", "--candidate", "not-a-candidate", "--state-root", dir], malformed.io),
    1
  );
  assert.match(malformed.err.join(""), /invalid candidate id/);

  const unknown = capture();
  assert.equal(
    await adaptCommand(["show", "--candidate", "cnd_absent01", "--state-root", dir], unknown.io),
    1
  );
  assert.match(unknown.err.join(""), /unknown candidate/);

  const noRegistry = capture();
  const empty = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-show-empty-"));
  assert.equal(
    await adaptCommand(["show", "--candidate", seeded.candidateId, "--state-root", empty], noRegistry.io),
    1
  );
  assert.match(noRegistry.err.join(""), /no registry snapshot/);
});

test("adapt dataset requires --run and refuses a run with no events", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-dataset-args-"));

  const missing = capture();
  assert.equal(await adaptCommand(["dataset", "--state-root", dir], missing.io), 1);
  assert.match(missing.err.join(""), /--run/);

  const unknown = capture();
  assert.equal(
    await adaptCommand(["dataset", "--run", createRunId(), "--state-root", dir], unknown.io),
    1
  );
  assert.match(unknown.err.join(""), /no events recorded/);
});

/**
 * D3/D4 (GPT-r2) at the command surface. `--dir` names a copy of redacted user
 * text that nothing records, so the operator is told it is theirs to delete
 * rather than being left to assume `delete --run` finds it — and the one
 * destination the plane layout forbids outright is refused.
 */
test("adapt dataset --dir discloses an external export and refuses the runtime plane", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-dataset-dir-"));
  const workspace = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-dataset-dir-ws-"));
  const runId = createRunId();
  const store = new EventStore(dir, runId);
  for (const event of routedEditRun(runId, workspace)) {
    await store.append(event);
  }

  const custom = join(dir, "adaptation", "exports", "hand-picked");
  const external = capture();
  assert.equal(
    await adaptCommand(["dataset", "--run", runId, "--dir", custom, "--state-root", dir], external.io),
    0,
    external.err.join("")
  );
  const warning = external.err.join("");
  assert.ok(warning.includes("external export"), warning);
  assert.ok(warning.includes(`NOT cascaded by delete --run ${runId}`), warning);
  assert.ok(warning.includes(custom), warning);
  assert.equal(existsSync(join(custom, "manifest.json")), true);

  const smuggled = join(dir, "runtime", "runs", runId, "dataset");
  const refused = capture();
  assert.equal(
    await adaptCommand(
      ["dataset", "--run", runId, "--dir", smuggled, "--state-root", dir],
      refused.io
    ),
    1
  );
  assert.match(refused.err.join(""), /must not be written into the runtime plane/);
  assert.equal(existsSync(smuggled), false);
  assert.deepEqual(refused.out, [], "a refused export prints no dataset path");
});

/**
 * The loop Round 1 found unrunnable: a proposed candidate reaches promotion
 * through supported commands only, with every input the promote gate demands
 * produced by one of them.
 */
test("adapt dataset feeds adapt eval, and show supplies the content and review actorId promote needs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-loop-"));
  const workspace = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-loop-ws-"));
  const seeded = await seedDetectorCandidate(dir);
  const runId = createRunId();
  const store = new EventStore(dir, runId);
  for (const event of routedEditRun(runId, workspace)) {
    await store.append(event);
  }

  const datasetRun = capture();
  const datasetCode = await adaptCommand(
    ["dataset", "--run", runId, "--state-root", dir],
    datasetRun.io
  );
  assert.equal(datasetCode, 0, datasetRun.err.join(""));
  // The export says what it is on stderr — one run's routed tasks — and says
  // nothing about a warning it has no reason to raise. stdout stays the single
  // dataset path the next command consumes.
  assert.deepEqual(datasetRun.err, [
    `note: the 2 exported row(s) are routed tasks from run ${runId}, not independent episodes; adapt eval replays them as a routing/cost fixture, not as held-out validation evidence\n`
  ]);
  const datasetDir = datasetRun.out.join("").trim();
  assert.equal(datasetRun.out.length, 1);

  const evalRun = capture();
  const evalCode = await adaptCommand(
    ["eval", "--candidate", seeded.candidateId, "--dataset", datasetDir, "--state-root", dir],
    evalRun.io
  );
  assert.equal(evalCode, 0, evalRun.err.join(""));
  const evalFile = evalRun.out.join("").trim();

  const contentPath = join(dir, "promote-content.json");
  const showRun = capture();
  const showCode = await adaptCommand(
    [
      "show",
      "--candidate",
      seeded.candidateId,
      "--content-file",
      contentPath,
      "--json",
      "--state-root",
      dir
    ],
    showRun.io
  );
  assert.equal(showCode, 0, showRun.err.join(""));
  const shown = JSON.parse(showRun.out.join("").trim()) as ShowJson;
  const reviewPath = await writeReview(
    dir,
    shown.reviewActorId,
    shown.candidateId,
    await readFile(contentPath, "utf8"),
    { acceptProvisional: false }
  );

  const promoteRun = capture();
  const promoteCode = await adaptCommand(
    [
      "promote",
      "--candidate",
      shown.candidateId,
      "--expected",
      shown.activeVersionId ?? "",
      "--content-file",
      contentPath,
      "--review-file",
      reviewPath,
      "--eval-file",
      evalFile,
      "--approve",
      "--state-root",
      dir
    ],
    promoteRun.io
  );

  assert.equal(promoteCode, 0, promoteRun.err.join(""));
  assert.match(promoteRun.out.join(""), /promoted/);
  const loaded = await loadAdaptationRegistry(dir);
  assert.notEqual(loaded.getActiveVersion(seeded.identity)?.versionId, seeded.baselineVersionId);
});

test("main routes adapt show and adapt dataset", async () => {
  const show = capture();
  assert.equal(await main(["adapt", "show"], show.io), 1);
  assert.match(show.err.join(""), /show requires --candidate/);

  const dataset = capture();
  assert.equal(await main(["adapt", "dataset"], dataset.io), 1);
  assert.match(dataset.err.join(""), /dataset requires --run/);

  const usage = capture();
  assert.equal(await main(["adapt", "help"], usage.io), 0);
  assert.match(usage.out.join(""), /adapt show --candidate/);
  assert.match(usage.out.join(""), /adapt dataset --run/);
});

const LEARN_AGENT = "agt_00000000-0000-4000-8000-000000000009" as AgentInstanceId;
const LEARN_OCCURRED = parseIsoTimestamp("2026-08-19T00:00:00.000Z");

/**
 * A routed run that failed on the model and is bound to an episode — the exact
 * shape `adapt learn` used to turn into an inferred preference as well as a
 * routing-policy candidate.
 */
function learnableRun(runId: RunId, taskId: TaskId): Event[] {
  return [
    makeEvent(
      "PROJECT_DISCOVERED",
      {
        project: {
          id: createProjectId(),
          rootPath: "/tmp/adapt-learn-proj",
          discoveredAt: LEARN_OCCURRED,
          instructionFiles: [],
          manifests: [],
          commands: [],
          facts: []
        }
      },
      { runId }
    ),
    makeEvent(
      "RUN_ATTACHED",
      { episodeId: createEpisodeId(), runId, attachedAt: LEARN_OCCURRED },
      { runId }
    ),
    makeEvent(
      "MODEL_ROUTED",
      {
        taskId,
        role: "actor",
        complexity: "MEDIUM",
        model: "cheap",
        justification: "cheapest eligible",
        confidence: 0.8,
        approvalPlan: { id: "ap_adapt_learn", items: [{ id: "go", label: "go", selectable: true }] },
        statusAfterRoute: "RUNNING",
        policyVersion: "router-v1",
        estimatedCostUsd: 0.1,
        estimatedDurationMs: 1000,
        family: "edit",
        featureVersion: ASSIGN_FEATURE_VERSION,
        modelVersion: "cheap-v1",
        highRisk: false,
        eligibleModels: ["cheap", "premium"],
        rejections: [],
        behaviorDistribution: { cheap: 1, premium: 0 },
        agentRole: "implementer"
      },
      { taskId, runId }
    ),
    makeEvent(
      "CHILD_MESSAGE",
      {
        message: {
          protocolVersion: 1 as const,
          id: createMessageId(),
          occurredAt: LEARN_OCCURRED,
          runId,
          taskId,
          from: LEARN_AGENT,
          to: SUPERVISOR,
          type: "TASK_RESULT" as const,
          outcome: "FAILURE" as const,
          summary: "golden fixture mismatch",
          artifactIds: [],
          evidenceIds: ["evd_check"],
          verification: { kind: "FAILED" as const, evidenceIds: ["evd_check"] },
          failure: { category: "MODEL_ERROR" }
        }
      },
      { taskId, runId }
    )
  ];
}

test("adapt learn persists a routing-policy candidate and no preference snapshot", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-learn-"));
  const runId = createRunId();
  const store = new EventStore(stateRoot, runId);
  for (const event of learnableRun(runId, parseTaskId("tsk_learn01"))) {
    await store.append(event);
  }

  resetPreferenceStore();
  try {
    const { io, out, err } = capture();
    const code = await adaptCommand(
      ["learn", "--run", runId, "--primary-model", "premium", "--state-root", stateRoot],
      io
    );
    assert.equal(code, 0, err.join(""));
    assert.deepEqual(err, []);
    assert.match(out.join(""), /proposed routing-policy candidate/);

    // What the command advertises is durable; what it never mentioned is not
    // recorded at all, on disk or in this process.
    assert.equal(existsSync(adaptationRegistryPath(stateRoot)), true);
    assert.equal(existsSync(preferenceSnapshotPath(stateRoot)), false);
    assert.deepEqual(listObservations(), []);
  } finally {
    resetPreferenceStore();
    await rm(stateRoot, { recursive: true, force: true });
  }
});
