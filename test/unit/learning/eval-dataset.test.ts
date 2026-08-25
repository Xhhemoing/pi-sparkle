import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { evalRoutingPolicy } from "../../../src/adaptation/eval-routing.js";
import { saveAdaptationRegistry } from "../../../src/adaptation/promotion.js";
import { ResourceRegistry } from "../../../src/adaptation/registry.js";
import type { AuthorIdentity, ResourceIdentity } from "../../../src/adaptation/resource.js";
import {
  createEventId,
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
import {
  exportRoutingEvalDataset,
  OBJECTIVE_MAX_CHARS,
  type EvalDatasetManifest
} from "../../../src/learning/eval-dataset.js";
import { routingPolicyContent } from "../../../src/learning/learned-routing.js";
import { SUPERVISOR } from "../../../src/protocol/v1.js";
import { ASSIGN_FEATURE_VERSION } from "../../../src/routing/feature-version.js";
import type { Event } from "../../../src/run/events.js";
import { makeEvent } from "../../helpers/event-factory.js";

const AGENT = "agt_00000000-0000-4000-8000-00000000000d" as AgentInstanceId;
const OCCURRED = parseIsoTimestamp("2026-08-25T00:00:00.000Z");
const NOW = "2026-08-25T00:00:00.000Z" as IsoTimestamp;
const AUTHOR: AuthorIdentity = { kind: "detector", identity: "pi-sparkle-auto-loop" };

interface TaskFixture {
  readonly taskId: TaskId;
  readonly objective: string;
  readonly outcome: "PASS" | "FAIL";
}

function projectDiscovered(runId: RunId, rootPath: string): Event {
  return makeEvent(
    "PROJECT_DISCOVERED",
    {
      project: {
        id: createProjectId(),
        rootPath,
        discoveredAt: OCCURRED,
        instructionFiles: [],
        manifests: [],
        commands: [],
        facts: []
      }
    },
    { runId }
  );
}

function taskGraph(runId: RunId, tasks: readonly TaskFixture[]): Event {
  return makeEvent(
    "TASK_GRAPH_ACCEPTED",
    {
      tasks: tasks.map((task) => ({
        id: task.taskId,
        title: "cache work",
        objective: task.objective,
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
  );
}

function modelRouted(runId: RunId, taskId: TaskId, model = "cheap"): Event {
  return makeEvent(
    "MODEL_ROUTED",
    {
      taskId,
      role: "actor",
      complexity: "MEDIUM",
      model,
      justification: "cheapest eligible",
      confidence: 0.8,
      approvalPlan: { id: "ap_ds", items: [{ id: "go", label: "go", selectable: true }] },
      statusAfterRoute: "RUNNING",
      policyVersion: "router-v1",
      estimatedCostUsd: 0.1,
      estimatedDurationMs: 1000,
      family: "edit",
      featureVersion: ASSIGN_FEATURE_VERSION,
      modelVersion: `${model}-v1`,
      highRisk: false,
      eligibleModels: ["cheap", "premium"],
      rejections: [],
      behaviorDistribution: { cheap: 1, premium: 0 },
      agentRole: "implementer"
    },
    { taskId, runId }
  );
}

function taskResult(runId: RunId, taskId: TaskId, outcome: "PASS" | "FAIL"): Event {
  return makeEvent(
    "CHILD_MESSAGE",
    {
      message: {
        protocolVersion: 1 as const,
        id: createMessageId(),
        occurredAt: OCCURRED,
        runId,
        taskId,
        from: AGENT,
        to: SUPERVISOR,
        type: "TASK_RESULT" as const,
        outcome: outcome === "PASS" ? ("SUCCESS" as const) : ("FAILURE" as const),
        summary: outcome === "PASS" ? "checks green" : "golden fixture mismatch",
        artifactIds: [],
        evidenceIds: ["evd_check"],
        verification:
          outcome === "PASS"
            ? { kind: "PASSED" as const, evidenceIds: ["evd_check"] }
            : { kind: "FAILED" as const, evidenceIds: ["evd_check"] },
        ...(outcome === "FAIL" ? { failure: { category: "MODEL_ERROR" } } : {})
      }
    },
    { taskId, runId, id: createEventId(() => `${taskId}-${outcome}-result`.padEnd(36, "0")) }
  );
}

function routedRun(runId: RunId, workspace: string, tasks: readonly TaskFixture[]): Event[] {
  return [
    projectDiscovered(runId, workspace),
    taskGraph(runId, tasks),
    ...tasks.flatMap((task) => [
      modelRouted(runId, task.taskId),
      taskResult(runId, task.taskId, task.outcome)
    ])
  ];
}

function editTasks(count: number): TaskFixture[] {
  return Array.from({ length: count }, (_, index) => ({
    taskId: parseTaskId(`tsk_ds${String(index + 1).padStart(2, "0")}`),
    objective: "Implement the cache layer",
    outcome: index % 2 === 0 ? ("PASS" as const) : ("FAIL" as const)
  }));
}

async function dirs(): Promise<{ stateRoot: string; workspace: string }> {
  return {
    stateRoot: await mkdtemp(join(tmpdir(), "pi-sparkle-ds-state-")),
    workspace: await mkdtemp(join(tmpdir(), "pi-sparkle-ds-ws-"))
  };
}

async function readManifest(path: string): Promise<EvalDatasetManifest> {
  return JSON.parse(await readFile(path, "utf8")) as EvalDatasetManifest;
}

test("export writes the dataset directory adapt eval consumes and never mutates policy", async () => {
  const { stateRoot, workspace } = await dirs();
  const runId = createRunId();
  const tasks = editTasks(2);

  const exported = await exportRoutingEvalDataset({
    stateRoot,
    runId,
    events: routedRun(runId, workspace, tasks)
  });

  assert.equal(exported.datasetDir, join(stateRoot, "adaptation", "eval-datasets", runId));
  assert.equal(exported.manifestPath, join(exported.datasetDir, "manifest.json"));
  const manifest = await readManifest(exported.manifestPath);
  assert.equal(manifest.datasetId, `ds-${runId}`);
  assert.equal(manifest.source.runId, runId);
  assert.equal(manifest.environmentVersion, `run-log:${ASSIGN_FEATURE_VERSION}:router-v1`);
  assert.deepEqual(
    manifest.episodes.map((episode) => [episode.taskId, episode.taskSuccess, episode.taskFamily]),
    [
      [tasks[0]?.taskId, "PASS", "edit"],
      [tasks[1]?.taskId, "FAIL", "edit"]
    ]
  );
  for (const episode of manifest.episodes) {
    assert.equal(episode.role, "implementer");
    assert.equal(episode.originalWorkspace, workspace);
    assert.match(episode.episodeHash, /^eh_/);
  }

  // The only state the export produced is the dataset itself: no registry, no
  // bandit, no learned policy.
  assert.deepEqual(await readdir(join(stateRoot, "adaptation")), ["eval-datasets"]);

  // The report only proves the manifest is loadable by the evaluator; the
  // candidate stays proposed and the pointer stays put.
  let n = 0;
  const generateId: IdGenerator = () => `ds${String(++n).padStart(4, "0")}`;
  const identity: ResourceIdentity = {
    kind: "routing-policy",
    name: "smart-assign",
    scope: { kind: "project", projectId: createProjectId(() => "ds000001") }
  };
  const registry = new ResourceRegistry({ now: () => NOW, generateId });
  const baseline = registry.registerBaseline({
    identity,
    content: routingPolicyContent({ primaryModelId: "premium", avoid: [], prefer: [] }),
    author: AUTHOR
  });
  const candidate = registry.createCandidate({
    identity,
    content: routingPolicyContent({
      primaryModelId: "premium",
      avoid: [{ modelId: "cheap", family: "edit", reason: "exported dataset" }],
      prefer: [{ family: "edit", modelId: "premium" }]
    }),
    parentVersionId: baseline.versionId,
    author: AUTHOR,
    evaluationPlan: { stages: ["static", "replay"], metrics: ["utility", "cost"], planVersion: 1 }
  });
  await saveAdaptationRegistry(stateRoot, registry);

  const evaluated = await evalRoutingPolicy({
    stateRoot,
    candidateId: candidate.candidateId,
    datasetDir: exported.datasetDir
  });
  assert.equal(evaluated.report.comparison.rawCounts.episodes, 2);
  assert.equal(evaluated.report.environmentVersion, manifest.environmentVersion);
  assert.equal(evaluated.report.evidenceClass, "replay");
});

test("objectives are truncated and scrubbed before they reach the dataset", async () => {
  const { stateRoot, workspace } = await dirs();
  const runId = createRunId();
  const secret = "sk-abcdef0123456789";
  const tasks: TaskFixture[] = [
    {
      taskId: parseTaskId("tsk_dsred01"),
      objective: `Implement the cache layer using api_key="${secret}" for maria@example.com in /home/maria/secrets/app`,
      outcome: "PASS"
    },
    {
      taskId: parseTaskId("tsk_dsred02"),
      objective: `Implement the cache layer ${"x".repeat(OBJECTIVE_MAX_CHARS * 2)}`,
      outcome: "FAIL"
    }
  ];

  const exported = await exportRoutingEvalDataset({
    stateRoot,
    runId,
    events: routedRun(runId, workspace, tasks)
  });

  const bytes = await readFile(exported.manifestPath, "utf8");
  assert.ok(!bytes.includes(secret), "raw secret reached the exported dataset");
  assert.ok(!bytes.includes("maria@example.com"), "raw email reached the exported dataset");
  assert.ok(!bytes.includes("/home/maria"), "raw home path reached the exported dataset");

  const manifest = await readManifest(exported.manifestPath);
  const [redacted, truncated] = manifest.episodes;
  assert.ok(redacted !== undefined && truncated !== undefined);
  assert.match(redacted.objective, /\[secret\]/);
  assert.match(redacted.objective, /\[email\]/);
  assert.match(redacted.objective, /\[path\]/);
  assert.equal(truncated.objective.length, OBJECTIVE_MAX_CHARS);
  assert.equal(manifest.source.objectiveMaxChars, OBJECTIVE_MAX_CHARS);
  assert.equal(manifest.source.redactionPipe, "redactSensitiveText");
  assert.deepEqual([...manifest.source.redactionClasses], ["secret", "path", "pii"].sort());
});

test("re-export of the same run is byte-identical", async () => {
  const { stateRoot, workspace } = await dirs();
  const runId = createRunId();
  const events = routedRun(runId, workspace, editTasks(3));

  const first = await exportRoutingEvalDataset({ stateRoot, runId, events });
  const firstBytes = await readFile(first.manifestPath, "utf8");
  const second = await exportRoutingEvalDataset({ stateRoot, runId, events });
  const secondBytes = await readFile(second.manifestPath, "utf8");

  assert.equal(secondBytes, firstBytes);
});

test("a retried task exports one episode carrying its final recorded outcome", async () => {
  const { stateRoot, workspace } = await dirs();
  const runId = createRunId();
  const taskId = parseTaskId("tsk_dsretry1");
  const events: Event[] = [
    projectDiscovered(runId, workspace),
    taskGraph(runId, [{ taskId, objective: "Implement the cache layer", outcome: "FAIL" }]),
    modelRouted(runId, taskId),
    taskResult(runId, taskId, "FAIL"),
    taskResult(runId, taskId, "PASS")
  ];

  const exported = await exportRoutingEvalDataset({ stateRoot, runId, events });

  assert.equal(exported.supersededAttempts, 1);
  const manifest = await readManifest(exported.manifestPath);
  assert.equal(manifest.episodes.length, 1);
  assert.equal(manifest.episodes[0]?.taskSuccess, "PASS");
});

test("routed PASS/FAIL tasks with no recorded objective are counted, not invented", async () => {
  const { stateRoot, workspace } = await dirs();
  const runId = createRunId();
  const kept = parseTaskId("tsk_dskept01");
  const unnamed = parseTaskId("tsk_dsmiss01");
  const events: Event[] = [
    projectDiscovered(runId, workspace),
    taskGraph(runId, [{ taskId: kept, objective: "Implement the cache layer", outcome: "PASS" }]),
    modelRouted(runId, kept),
    taskResult(runId, kept, "PASS"),
    modelRouted(runId, unnamed),
    taskResult(runId, unnamed, "FAIL")
  ];

  const exported = await exportRoutingEvalDataset({ stateRoot, runId, events });

  assert.equal(exported.skippedWithoutObjective, 1);
  const manifest = await readManifest(exported.manifestPath);
  assert.deepEqual(
    manifest.episodes.map((episode) => episode.taskId),
    [kept]
  );
});

test("runs the evaluator could not use are refused instead of exported", async () => {
  const { stateRoot, workspace } = await dirs();
  const runId = createRunId();
  const taskId = parseTaskId("tsk_dsnone01");

  await assert.rejects(
    () =>
      exportRoutingEvalDataset({
        stateRoot,
        runId,
        events: [taskGraph(runId, [{ taskId, objective: "Implement it", outcome: "PASS" }])]
      }),
    /no project snapshot/
  );
  await assert.rejects(
    () =>
      exportRoutingEvalDataset({
        stateRoot,
        runId,
        events: [projectDiscovered(runId, workspace), modelRouted(runId, taskId)]
      }),
    /recorded PASS or FAIL/
  );
  await assert.rejects(
    () =>
      exportRoutingEvalDataset({
        stateRoot,
        runId,
        events: [
          projectDiscovered(runId, workspace),
          modelRouted(runId, taskId),
          taskResult(runId, taskId, "PASS")
        ]
      }),
    /no recorded task objective/
  );
  assert.equal(existsSync(join(stateRoot, "adaptation")), false);
});

test("the dataset refuses to be written inside the workspace it freezes", async () => {
  const { stateRoot, workspace } = await dirs();
  const runId = createRunId();
  const events = routedRun(runId, workspace, editTasks(1));

  await assert.rejects(
    () =>
      exportRoutingEvalDataset({
        stateRoot,
        runId,
        events,
        datasetDir: join(workspace, "eval-dataset")
      }),
    /must not overlap the recorded project workspace/
  );
  assert.equal(existsSync(join(workspace, "eval-dataset")), false);
});
