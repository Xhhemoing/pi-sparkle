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
  readonly qualityEvidence: string;
  readonly actionDiff: readonly {
    readonly episodeHash: string;
    readonly baselineModel: string;
    readonly candidateModel: string;
    readonly costDeltaUsd: number;
  }[];
  readonly cacheKey: string;
  readonly rerunHash: string;
  readonly comparison: {
    readonly claims: readonly string[];
    readonly evidenceClass: string;
    readonly canCloseProductionCheckpointF: boolean;
    readonly utilityDelta: { readonly mean: number };
  };
}

async function writeReview(
  dir: string,
  actorId: string,
  candidateId: string,
  content: string,
  extras: { readonly acceptProvisional?: boolean } = {}
): Promise<string> {
  const path = join(dir, `review-${candidateId}.json`);
  await writeFile(
    path,
    JSON.stringify({
      reviewId: `review-${candidateId}`,
      candidateId,
      contentHash: hashCandidateContent(content),
      verdict: "approved",
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
  assert.match(out.join(""), /qualityEvidence is none-by-construction/);
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
  // First stdout line is the report path; honest evidence copy follows.
  const firstText = first.out.join("");
  const reportPath = (firstText.split("\n")[0] ?? "").trim();
  assert.match(reportPath, /adaptation[\\/]evals/);
  assert.match(firstText, /quality evidence: none-by-construction/);
  assert.match(firstText, /utilityDelta is 0 by construction/);
  assert.match(firstText, /action diff: 2 episode\(s\)/);
  // avoid-cheap-edit reroutes edit episodes to the pricier primary: warn, allow.
  assert.match(firstText, /warning: cost delta upper bound .* promotion stays allowed/);
  const written = JSON.parse(await readFile(reportPath, "utf8")) as WrittenEvalReport;
  assert.equal(written.candidateId, candidate.candidateId);
  assert.equal(written.contentHash, candidate.contentHash);
  assert.equal(written.evidenceClass, "replay");
  assert.equal(written.qualityEvidence, "none-by-construction");
  // utilityDelta 0 is a construction artifact, not observed quality parity.
  assert.equal(written.comparison.utilityDelta.mean, 0);
  assert.equal(written.actionDiff.length, 2);
  for (const row of written.actionDiff) {
    assert.equal(row.baselineModel, "cheap");
    assert.equal(row.candidateModel, "premium");
    assert.ok(row.costDeltaUsd > 0);
  }
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
  const secondPath = (second.out.join("").split("\n")[0] ?? "").trim();
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
  const evalFile = (evalCapture.out.join("").split("\n")[0] ?? "").trim();
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
