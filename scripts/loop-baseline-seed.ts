/**
 * Loop-baseline probe (fake class, never F-PROD evidence).
 *
 * Seeds one complete run log in which the `cheap` model fails the `review`
 * family five times with FAILED runtime verification, so the adaptation
 * plane has an *attributable* model failure to diagnose. The seeded log is
 * written through EventStore (validated), then the real CLI drives:
 *   adapt learn → candidate proposed → adapt promote --approve → run --children
 * and the second run must route the review task away from `cheap`.
 *
 * Usage: npx tsx scripts/loop-baseline-seed.ts <stateRoot> <projectRoot> <failingModel> <family> <n>
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createEventId,
  createProjectId,
  createRunId,
  createTaskId,
  type ArtifactId,
  type EvidenceId,
  type MessageId,
  type RunId
} from "../src/domain/ids.js";
import { nowIso } from "../src/domain/timestamp.js";
import { EventStore } from "../src/run/event-store.js";
import type { Event } from "../src/run/events.js";
import { runtimeRoot } from "../src/privacy/state-layout.js";

const [stateRoot, projectRoot, failingModel = "cheap", family = "review", nRaw = "5"] = process.argv.slice(2);
if (stateRoot === undefined || projectRoot === undefined) {
  process.stderr.write("usage: loop-baseline-seed.ts <stateRoot> <projectRoot> [model] [family] [n]\n");
  process.exit(2);
}
const n = Number(nRaw);
const runId: RunId = createRunId();
const projectId = createProjectId();
const rootTaskId = createTaskId();
const at = nowIso();

function make(type: Event["type"], payload: unknown, taskId?: string): Event {
  return {
    id: createEventId(),
    schemaVersion: 1,
    occurredAt: nowIso(),
    runId,
    ...(taskId !== undefined ? { taskId } : {}),
    type,
    actor: "flowchart-supervisor",
    payload
  } as Event;
}

const events: Event[] = [
  make("PROJECT_DISCOVERED", {
    project: {
      id: projectId,
      rootPath: projectRoot,
      gitRootPath: projectRoot,
      discoveredAt: at,
      instructionFiles: [],
      manifests: [],
      commands: [],
      facts: [{ key: "git_root", value: projectRoot, confidence: "HIGH" }]
    }
  }),
  make("RUN_CREATED", {
    run: {
      id: runId,
      projectId,
      rootTaskId,
      status: "PLANNING",
      limits: {
        maxTasks: 16,
        maxConcurrentTasks: 2,
        maxAttemptsPerTask: 3,
        maxRounds: 32,
        maxConsecutiveStalls: 3,
        maxWallTimeMs: 3600000
      },
      createdAt: at,
      updatedAt: at
    }
  }),
  make("RUN_STARTED", {})
];

// Pre-generate task ids so TASK_GRAPH_ACCEPTED (which adapt dataset needs for
// objectives) can reference the same ids the MODEL_ROUTED/TASK_RESULT pairs use.
const taskIds = Array.from({ length: n }, () => createTaskId());
events.push(
  make("TASK_GRAPH_ACCEPTED", {
    tasks: taskIds.map((taskId, index) => ({
      id: taskId,
      title: `Review planted-defect diff ${index + 1}`,
      objective: `Review the planted-defect diff ${index + 1} for correctness and nits`,
      role: "reviewer",
      dependencies: [],
      acceptanceCriteria: [{ id: `ac_seed_${index}`, description: "all planted defects are reported" }],
      status: "PENDING",
      attempt: 0,
      maxAttempts: 3,
      timeoutMs: 600000,
      artifactIds: [],
      evidenceIds: []
    }))
  })
);

for (let index = 0; index < n; index += 1) {
  const taskId = taskIds[index]!;
  events.push(
    make(
      "MODEL_ROUTED",
      {
        taskId,
        role: "actor",
        complexity: "MEDIUM",
        model: failingModel,
        justification: "seeded: cheapest eligible",
        confidence: 0.9,
        coldStartRoutingScore: 0.9,
        approvalPlan: {
          id: `approval:${taskId}:${failingModel}`,
          items: [
            { id: `route:${failingModel}`, label: `Use ${failingModel}`, selectable: true, defaultSelected: true },
            { id: "route:cancel", label: "Do not run this task", selectable: true, defaultSelected: false }
          ]
        },
        statusAfterRoute: "RUNNING",
        policyVersion: "router-v1-primary",
        estimatedCostUsd: 0.01,
        estimatedDurationMs: 1000,
        family,
        featureVersion: "assign-v5",
        modelVersion: `${failingModel}-v1`,
        highRisk: false,
        eligibleModels: [failingModel, "premium"],
        rejections: [],
        behaviorDistribution: { [failingModel]: 1, premium: 0 },
        agentRole: "reviewer"
      },
      taskId
    )
  );
  const evd = `evd_seed_${index}` as EvidenceId;
  events.push(
    make(
      "CHILD_MESSAGE",
      {
        message: {
          protocolVersion: 1,
          id: `msg_seed_${index}` as MessageId,
          occurredAt: nowIso(),
          runId,
          taskId,
          from: "agt_seed",
          to: "SUPERVISOR",
          type: "TASK_RESULT",
          outcome: "FAILURE",
          summary: "review missed the planted defect; runtime verification failed",
          artifactIds: [] as ArtifactId[],
          evidenceIds: [evd],
          verification: { kind: "FAILED", evidenceIds: [evd] }
        }
      },
      taskId
    )
  );
}
events.push(make("RUN_FAILED", { reason: "seeded review failures" }));

await mkdir(join(runtimeRoot(stateRoot), "runs", runId), { recursive: true });
const store = new EventStore(stateRoot, runId);
for (const event of events) {
  await store.append(event);
}
process.stdout.write(`${runId}\n`);
