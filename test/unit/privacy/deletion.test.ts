import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import type { ProjectEpisode } from "../../../src/domain/episode.js";
import {
  createAgentInstanceId,
  createEpisodeId,
  createEventId,
  createInvocationId,
  createProjectId,
  createRunId,
  createTaskId,
  type EpisodeId,
  type RunId
} from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import {
  validateConfidenceScore,
  type Flowchart,
  type FlowNode
} from "../../../src/domain/flowchart.js";
import {
  appendFeedback,
  feedbackLogLockPath,
  feedbackLogPath,
  feedbackTombstonesPath,
  readFeedback,
  readFeedbackRecordsRaw,
  withFeedbackLogLock
} from "../../../src/feedback/store.js";
import {
  clearAll,
  configurePreferencePersistence,
  inspectPreferences,
  recordExplicitPreference
} from "../../../src/preferences/service.js";
import { exportRoutingEvalDataset } from "../../../src/learning/eval-dataset.js";
import { adaptationRoot } from "../../../src/privacy/state-layout.js";
import { SUPERVISOR } from "../../../src/protocol/v1.js";
import { ASSIGN_FEATURE_VERSION } from "../../../src/routing/feature-version.js";
import {
  FREE_TEXT_FEEDBACK_FIELDS,
  RUN_RECORDS_SURVIVED_CODE,
  RunRecordsSurvivedError,
  cascadeFeedbackTombstones,
  deleteEpisodeRecords,
  deleteRunRecords,
  findResidualEpisodeText,
  verifyRunRecordsRemoved
} from "../../../src/privacy/deletion.js";
import { LOCK_TIMEOUT_CODE, withExclusiveFileLock } from "../../../src/persist/file-lock.js";
import { CheckpointStore } from "../../../src/run/checkpoint-store.js";
import { episodeLockPath } from "../../../src/run/episode-bind.js";
import { runLockPath } from "../../../src/run/event-store.js";
import { catalogObservedPath } from "../../../src/routing/catalog-observed.js";
import {
  invocationsLogPath,
  loadInvocationsFromStateRoot
} from "../../../src/routing/cost-calibration.js";
import { hash32 } from "../../../src/domain/hash.js";
import {
  appendInvocationRecord,
  invocationLogLockPath,
  withInvocationLogLock
} from "../../../src/telemetry/invocation-log.js";
import type { ModelInvocation } from "../../../src/telemetry/model-invocation.js";
import { EventStore } from "../../../src/run/event-store.js";
import type { Event } from "../../../src/run/events.js";
import { EpisodeStore } from "../../../src/run/episode-store.js";
import { startFlowchartRun } from "../../../src/run/flowchart-run.js";
import type { PauseController, PauseToken } from "../../../src/run/pause-controller.js";
import { createModelRouter, type ModelRouter } from "../../../src/supervisor/model-router.js";

let uuidCounter = 0;
const UUID = (): string => `abcdef01-2345-6789-abcd-${String(uuidCounter++).padStart(12, "0")}`;

async function withStateRoot(run: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-deletion-"));
  try {
    await run(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

function invocationRow(runId: RunId, id: string): Record<string, unknown> {
  return {
    id,
    taskId: "tsk_del",
    runId,
    agentInstanceId: "agt_del",
    config: { provider: "fake", model: "cheap", modelVersion: "cheap-v1", parameterHash: "abc" },
    responseHash: "def",
    tokensIn: 1000,
    tokensOut: 500,
    latencyMs: 200,
    occurredAt: "2026-08-24T00:00:00.000Z",
    callOutcome: "ok"
  };
}

async function writeInvocationLog(stateRoot: string, lines: readonly string[]): Promise<string> {
  const path = invocationsLogPath(stateRoot);
  await mkdir(join(stateRoot, "runtime"), { recursive: true });
  await writeFile(path, lines.join(""), "utf8");
  return path;
}

async function seedFeedback(
  stateRoot: string,
  episodeId: EpisodeId,
  id: string,
  free: { body?: string; summary?: string }
): Promise<void> {
  await appendFeedback(stateRoot, {
    id,
    episodeId,
    kind: "human",
    rubricVersion: "1",
    score: 70,
    evidenceRefs: [],
    redacted: false,
    createdAt: parseIsoTimestamp("2026-08-24T00:00:00.000Z"),
    ...(free.body !== undefined ? { body: free.body } : {}),
    ...(free.summary !== undefined ? { summary: free.summary } : {})
  });
}

const OBJECTIVE = "Ship the payroll importer for acme-corp";
const ACCEPTANCE = "Imported rows match the Q3 payroll ledger";

function episodeFixture(episodeId: EpisodeId): ProjectEpisode {
  return {
    id: episodeId,
    projectId: createProjectId(UUID),
    objective: OBJECTIVE,
    contractVersion: 1,
    runIds: [],
    startedAt: parseIsoTimestamp("2026-08-24T00:00:00.000Z"),
    status: "COMPLETED",
    acceptance: [{ id: "ac-1", description: ACCEPTANCE, observableCheck: "diff is empty" }],
    evidenceRefs: []
  };
}

function runEvent(runId: RunId, type: Event["type"], payload: unknown): Event {
  return {
    id: createEventId(UUID),
    schemaVersion: 1,
    occurredAt: parseIsoTimestamp("2026-08-24T00:00:00.000Z"),
    runId,
    type,
    actor: "deletion-test",
    payload
  } as Event;
}

/**
 * One routed, deterministically verified task — the minimum
 * `exportRoutingEvalDataset` accepts, so the derived replay dataset in the
 * cascade tests below is written by the real exporter rather than mocked.
 */
function routedRunEvents(runId: RunId, workspace: string, objective: string): Event[] {
  const taskId = "tsk_dsdel01";
  const occurredAt = parseIsoTimestamp("2026-08-24T00:00:00.000Z");
  return [
    runEvent(runId, "PROJECT_DISCOVERED", {
      project: {
        id: createProjectId(UUID),
        rootPath: workspace,
        discoveredAt: occurredAt,
        instructionFiles: [],
        manifests: [],
        commands: [],
        facts: []
      }
    }),
    runEvent(runId, "TASK_GRAPH_ACCEPTED", {
      tasks: [
        {
          id: taskId,
          title: "cache work",
          objective,
          role: "implementer",
          dependencies: [],
          acceptanceCriteria: [{ id: "ac1", description: "tests pass" }],
          status: "PENDING",
          attempt: 0,
          maxAttempts: 2,
          timeoutMs: 60_000,
          artifactIds: [],
          evidenceIds: []
        }
      ]
    }),
    runEvent(runId, "MODEL_ROUTED", {
      taskId,
      role: "actor",
      complexity: "MEDIUM",
      model: "cheap",
      justification: "cheapest eligible",
      confidence: 0.8,
      approvalPlan: { id: "ap_del", items: [{ id: "go", label: "go", selectable: true }] },
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
    }),
    runEvent(runId, "CHILD_MESSAGE", {
      message: {
        protocolVersion: 1,
        id: "msg_00000000-0000-4000-8000-00000000d001",
        occurredAt,
        runId,
        taskId,
        from: "agt_00000000-0000-4000-8000-000000000009",
        to: SUPERVISOR,
        type: "TASK_RESULT",
        outcome: "SUCCESS",
        summary: "checks green",
        artifactIds: [],
        evidenceIds: ["evd_check"],
        verification: { kind: "PASSED", evidenceIds: ["evd_check"] }
      }
    })
  ];
}

/** A run whose event log opens the episode, i.e. embeds the whole snapshot. */
async function seedRunOpeningEpisode(stateRoot: string, episodeId: EpisodeId): Promise<RunId> {
  const runId = createRunId(UUID);
  const store = new EventStore(stateRoot, runId);
  await store.append(runEvent(runId, "EPISODE_OPENED", { episode: episodeFixture(episodeId) }));
  await store.append(
    runEvent(runId, "RUN_ATTACHED", {
      episodeId,
      runId,
      attachedAt: parseIsoTimestamp("2026-08-24T00:00:00.000Z")
    })
  );
  return runId;
}

test("delete --episode lists attached runs that still hold the objective, and rewrites none", async () => {
  await withStateRoot(async (stateRoot) => {
    const episodeId = createEpisodeId(UUID);
    await new EpisodeStore(stateRoot, episodeId).append(episodeFixture(episodeId));
    const runId = await seedRunOpeningEpisode(stateRoot, episodeId);
    const logPath = join(stateRoot, "runtime", "runs", runId, "events.jsonl");
    const before = await readFile(logPath, "utf8");

    const result = await deleteEpisodeRecords(stateRoot, episodeId);
    assert.deepEqual(result.residualEpisodeTextRunIds, [runId]);
    // Integrity: the append-only log is disclosed, never edited.
    assert.equal(await readFile(logPath, "utf8"), before);
    assert.match(before, new RegExp(OBJECTIVE));
    assert.ok(
      !result.removedPaths.includes(logPath),
      "a run log the delete did not touch must not be reported as removed"
    );

    const findings = await findResidualEpisodeText(stateRoot, episodeId);
    assert.deepEqual(findings, [{ runId, path: logPath, reason: "episode-opened" }]);
  });
});

test("an episode with no attached runs reports an empty residual list", async () => {
  await withStateRoot(async (stateRoot) => {
    const episodeId = createEpisodeId(UUID);
    await new EpisodeStore(stateRoot, episodeId).append(episodeFixture(episodeId));
    // A run that exists but never references this episode.
    const other = createRunId(UUID);
    await new EventStore(stateRoot, other).append(
      runEvent(other, "AGENT_EVENT", {
        agentInstanceId: "agt_00000000-0000-4000-8000-000000000001",
        kind: "TEXT_DELTA",
        summary: "unrelated work"
      })
    );

    const result = await deleteEpisodeRecords(stateRoot, episodeId);
    assert.deepEqual(result.residualEpisodeTextRunIds, []);
    assert.deepEqual(await findResidualEpisodeText(stateRoot, episodeId), []);
  });
});

test("a run that only names the episode without copying its text is not listed", async () => {
  await withStateRoot(async (stateRoot) => {
    const episodeId = createEpisodeId(UUID);
    await new EpisodeStore(stateRoot, episodeId).append(episodeFixture(episodeId));
    const runId = createRunId(UUID);
    await new EventStore(stateRoot, runId).append(
      runEvent(runId, "RUN_ATTACHED", {
        episodeId,
        runId,
        attachedAt: parseIsoTimestamp("2026-08-24T00:00:00.000Z")
      })
    );

    // An id is a reference, not episode text: reporting it would send the
    // operator deleting runs that hold nothing of the deleted episode.
    const result = await deleteEpisodeRecords(stateRoot, episodeId);
    assert.deepEqual(result.residualEpisodeTextRunIds, []);
  });
});

test("an objective copy outside the open event is listed, including track-questions.json", async () => {
  await withStateRoot(async (stateRoot) => {
    const episodeId = createEpisodeId(UUID);
    await new EpisodeStore(stateRoot, episodeId).append(episodeFixture(episodeId));

    // This run never opens the episode; it names it and quotes the objective.
    const quoting = createRunId(UUID);
    const store = new EventStore(stateRoot, quoting);
    await store.append(
      runEvent(quoting, "RUN_ATTACHED", {
        episodeId,
        runId: quoting,
        attachedAt: parseIsoTimestamp("2026-08-24T00:00:00.000Z")
      })
    );
    await store.append(
      runEvent(quoting, "AGENT_EVENT", {
        agentInstanceId: "agt_00000000-0000-4000-8000-000000000002",
        kind: "TEXT_DELTA",
        summary: `working on: ${OBJECTIVE}`
      })
    );
    const questions = join(stateRoot, "runtime", "runs", quoting, "track-questions.json");
    await writeFile(questions, JSON.stringify({ objective: OBJECTIVE, questions: [] }), "utf8");

    const result = await deleteEpisodeRecords(stateRoot, episodeId);
    assert.deepEqual(result.residualEpisodeTextRunIds, [quoting]);
    const findings = await findResidualEpisodeText(stateRoot, episodeId, [OBJECTIVE]);
    assert.deepEqual(
      findings.map((entry) => entry.path).sort(),
      [join(stateRoot, "runtime", "runs", quoting, "events.jsonl"), questions].sort()
    );
    assert.ok(findings.every((entry) => entry.reason === "objective-copy"));
  });
});

test("acceptance text counts as episode text even when the objective was never copied", async () => {
  await withStateRoot(async (stateRoot) => {
    const episodeId = createEpisodeId(UUID);
    await new EpisodeStore(stateRoot, episodeId).append(episodeFixture(episodeId));
    const runId = createRunId(UUID);
    const store = new EventStore(stateRoot, runId);
    await store.append(
      runEvent(runId, "RUN_ATTACHED", {
        episodeId,
        runId,
        attachedAt: parseIsoTimestamp("2026-08-24T00:00:00.000Z")
      })
    );
    await store.append(
      runEvent(runId, "AGENT_EVENT", {
        agentInstanceId: "agt_00000000-0000-4000-8000-000000000003",
        kind: "TEXT_DELTA",
        summary: `checking that ${ACCEPTANCE}`
      })
    );

    const result = await deleteEpisodeRecords(stateRoot, episodeId);
    assert.deepEqual(result.residualEpisodeTextRunIds, [runId]);
  });
});

test("the residual list survives a repeat delete by reading the run's own open event", async () => {
  await withStateRoot(async (stateRoot) => {
    const episodeId = createEpisodeId(UUID);
    await new EpisodeStore(stateRoot, episodeId).append(episodeFixture(episodeId));
    const runId = await seedRunOpeningEpisode(stateRoot, episodeId);

    await deleteEpisodeRecords(stateRoot, episodeId);
    // The episode's own records are gone now, so the second scan has no seed
    // text: it must recover the objective from the run log itself.
    const again = await deleteEpisodeRecords(stateRoot, episodeId);
    assert.deepEqual(again.residualEpisodeTextRunIds, [runId]);
  });
});

test("an attached run with an unparsable line is reported rather than assumed clean", async () => {
  await withStateRoot(async (stateRoot) => {
    const episodeId = createEpisodeId(UUID);
    const runId = createRunId(UUID);
    const runDir = join(stateRoot, "runtime", "runs", runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(
      join(runDir, "events.jsonl"),
      `{"type":"EPISODE_OPENED","payload":{"episode":{"id":"${episodeId}","objectiv\n`,
      "utf8"
    );

    const findings = await findResidualEpisodeText(stateRoot, episodeId);
    assert.deepEqual(findings, [
      { runId, path: join(runDir, "events.jsonl"), reason: "unreadable-log" }
    ]);
  });
});

test("delete --run never claims residual episode text", async () => {
  await withStateRoot(async (stateRoot) => {
    const runId = createRunId(UUID);
    await mkdir(join(stateRoot, "runtime", "runs", runId), { recursive: true });
    const result = await deleteRunRecords(stateRoot, runId);
    assert.deepEqual(result.residualEpisodeTextRunIds, []);
  });
});

/**
 * Pins the non-goal documented in `deletion.ts`: an episode delete must not
 * touch preferences. If a cascade is ever implemented, this test and the
 * record-class dictionary have to change together — that is the point.
 */
test("deleting an episode does not delete preferences learned from it", async () => {
  await withStateRoot(async (stateRoot) => {
    const preferencesPath = join(adaptationRoot(stateRoot), "preferences.json");
    const episodeId = createEpisodeId(UUID);
    try {
      configurePreferencePersistence(preferencesPath);
      const observation = recordExplicitPreference(
        "project",
        "acme",
        "require-tests",
        true,
        episodeId
      );
      const before = await readFile(preferencesPath, "utf8");

      await new EpisodeStore(stateRoot, episodeId).append(episodeFixture(episodeId));
      const result = await deleteEpisodeRecords(stateRoot, episodeId);
      assert.ok(result.removedPaths.length > 0);

      assert.equal(await readFile(preferencesPath, "utf8"), before, "preferences.json must not move");
      // Reload from disk: the observation is still live, and its evidence
      // pointer is left dangling on purpose.
      clearAll();
      configurePreferencePersistence(preferencesPath);
      const reloaded = inspectPreferences().observations.find((row) => row.id === observation.id);
      assert.ok(reloaded, "the preference must survive the episode delete");
      assert.equal(reloaded.evidenceEpisodeId, episodeId);
      assert.equal(reloaded.value, true);
    } finally {
      configurePreferencePersistence(undefined);
      clearAll();
    }
  });
});

test("the episode cascade strips every declared free-text feedback field", async () => {
  await withStateRoot(async (stateRoot) => {
    const episodeId = createEpisodeId(UUID);
    await seedFeedback(stateRoot, episodeId, "fb-both", {
      body: "raw user body text",
      summary: "user: I keep failing to log in with alice@example.com"
    });

    const cascaded = await cascadeFeedbackTombstones(stateRoot, episodeId);
    assert.deepEqual(cascaded, ["fb-both"]);

    // No free-text field may survive on the record shell...
    const [record] = await readFeedbackRecordsRaw(stateRoot);
    assert.ok(record);
    for (const field of FREE_TEXT_FEEDBACK_FIELDS) {
      assert.equal(record[field], undefined, `${field} must be stripped`);
    }
    // ...and none may survive as raw bytes in the log either.
    const raw = await readFile(
      join(stateRoot, "adaptation", "feedback", "records.jsonl"),
      "utf8"
    );
    assert.doesNotMatch(raw, /raw user body text/);
    assert.doesNotMatch(raw, /alice@example\.com/);
    assert.doesNotMatch(raw, /"summary"/);
    // The audit shell survives so the deletion itself stays inspectable.
    assert.equal(record.id, "fb-both");
    assert.equal(record.score, 70);
  });
});

test("a summary-only record is cascaded even with no body present", async () => {
  await withStateRoot(async (stateRoot) => {
    const episodeId = createEpisodeId(UUID);
    await seedFeedback(stateRoot, episodeId, "fb-summary-only", {
      summary: "peer: the migration script drops the audit table"
    });
    await deleteEpisodeRecords(stateRoot, episodeId);

    const [record] = await readFeedbackRecordsRaw(stateRoot);
    assert.ok(record);
    assert.equal(record.summary, undefined);
    assert.deepEqual(await readFeedback(stateRoot), []);
  });
});

test("a second cascade cannot resurrect a stripped summary", async () => {
  await withStateRoot(async (stateRoot) => {
    const episodeId = createEpisodeId(UUID);
    await seedFeedback(stateRoot, episodeId, "fb-idempotent", {
      body: "body text",
      summary: "summary text"
    });
    await deleteEpisodeRecords(stateRoot, episodeId);
    const again = await deleteEpisodeRecords(stateRoot, episodeId);
    assert.deepEqual(again.cascadedFeedbackTombstones, ["fb-idempotent"]);

    const raw = await readFile(join(stateRoot, "adaptation", "feedback", "records.jsonl"), "utf8");
    assert.doesNotMatch(raw, /summary text/);
    assert.doesNotMatch(raw, /body text/);
  });
});

/**
 * The cascade rewrites the whole feedback log, so an append landing between
 * its read and its write used to be erased — and an append landing after the
 * write used to put free text back on disk under an id that was just
 * tombstoned. Both writers now take `records.jsonl.lock`.
 */
test("the episode cascade waits for the feedback log lock", async () => {
  await withStateRoot(async (stateRoot) => {
    const episodeId = createEpisodeId(UUID);
    await seedFeedback(stateRoot, episodeId, "fb-locked", { body: "text to strip" });
    const path = feedbackLogPath(stateRoot);
    const before = await readFile(path, "utf8");
    let pending: Promise<{ cascadedFeedbackTombstones: readonly string[] }> | undefined;

    await withFeedbackLogLock(stateRoot, async () => {
      pending = deleteEpisodeRecords(stateRoot, episodeId);
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(
        await readFile(path, "utf8"),
        before,
        "the cascade must not start while another writer holds the lock"
      );
    });

    assert.ok(pending !== undefined);
    assert.deepEqual((await pending).cascadedFeedbackTombstones, ["fb-locked"]);
    assert.doesNotMatch(await readFile(path, "utf8"), /text to strip/);
    assert.equal(existsSync(feedbackLogLockPath(stateRoot)), false, "lock is released");
  });
});

test("a cascade that cannot take the feedback lock fails closed and changes nothing", async () => {
  await withStateRoot(async (stateRoot) => {
    const episodeId = createEpisodeId(UUID);
    await seedFeedback(stateRoot, episodeId, "fb-contended", { body: "still here" });
    const path = feedbackLogPath(stateRoot);
    const before = await readFile(path, "utf8");
    let outcome: unknown;

    await withFeedbackLogLock(stateRoot, async () => {
      outcome = await cascadeFeedbackTombstones(stateRoot, episodeId, {
        timeoutMs: 40,
        retryMs: 5
      }).then(
        (cascaded) => cascaded,
        (error: unknown) => error
      );
    });

    assert.ok(outcome instanceof DomainValidationError, "a lock timeout must reject the cascade");
    assert.match(outcome.message, /timed out waiting for lock/);
    assert.equal(await readFile(path, "utf8"), before, "the log must be byte-identical");
    assert.equal(
      existsSync(feedbackTombstonesPath(stateRoot)),
      false,
      "a cascade that never ran must not claim a tombstone"
    );
  });
});

test("feedback appended while the episode cascade runs survives whole", async () => {
  await withStateRoot(async (stateRoot) => {
    const doomed = createEpisodeId(UUID);
    const other = createEpisodeId(UUID);
    await seedFeedback(stateRoot, doomed, "fb-doomed", {
      body: "doomed body",
      summary: "doomed summary"
    });

    const [result] = await Promise.all([
      deleteEpisodeRecords(stateRoot, doomed),
      appendFeedback(stateRoot, {
        id: "fb-live",
        episodeId: other,
        kind: "human",
        rubricVersion: "1",
        score: 55,
        evidenceRefs: [],
        redacted: false,
        createdAt: parseIsoTimestamp("2026-08-24T00:00:05.000Z"),
        body: "live note written mid-delete"
      })
    ]);

    assert.deepEqual(result.cascadedFeedbackTombstones, ["fb-doomed"]);
    const records = await readFeedbackRecordsRaw(stateRoot);
    const live = records.find((record) => record.id === "fb-live");
    assert.ok(live, "the append must not be clobbered by the rewrite");
    assert.equal(live.body, "live note written mid-delete");
    const stripped = records.find((record) => record.id === "fb-doomed");
    assert.ok(stripped);
    assert.equal(stripped.body, undefined);
    assert.equal(stripped.summary, undefined);
    // Whichever order the two writers ran in, no torn line reached the log.
    assert.equal(records.length, 2);
  });
});

/**
 * The other side of the race: an append that lands *after* the cascade. That
 * row is a new fact, not a resurrected one — the tombstone keeps it out of
 * `readFeedback`, and the operator has to delete again to clear the bytes.
 */
test("a late append cannot resurrect stripped text through the read API", async () => {
  await withStateRoot(async (stateRoot) => {
    const episodeId = createEpisodeId(UUID);
    await seedFeedback(stateRoot, episodeId, "fb-late", { body: "first body" });
    await deleteEpisodeRecords(stateRoot, episodeId);

    await seedFeedback(stateRoot, episodeId, "fb-late", { body: "second body" });
    assert.deepEqual(await readFeedback(stateRoot), [], "the tombstone still hides the id");

    const second = await deleteEpisodeRecords(stateRoot, episodeId);
    assert.deepEqual(second.cascadedFeedbackTombstones, ["fb-late", "fb-late"]);
    assert.doesNotMatch(await readFile(feedbackLogPath(stateRoot), "utf8"), /second body/);
  });
});

test("a corrupt feedback line fails the episode delete closed, before anything is unlinked", async () => {
  await withStateRoot(async (stateRoot) => {
    const episodeId = createEpisodeId(UUID);
    await seedFeedback(stateRoot, episodeId, "fb-first", { body: "text that must not survive" });
    const path = feedbackLogPath(stateRoot);
    // A corrupt middle line: the reader cannot prove whose row it is, so the
    // cascade cannot prove it stripped every row bound to this episode.
    await writeFile(path, `${await readFile(path, "utf8")}{ not json\n{"id":"fb-third"}\n`, "utf8");
    const before = await readFile(path, "utf8");
    const episodesDir = join(stateRoot, "runtime", "episodes");
    await mkdir(episodesDir, { recursive: true });
    await writeFile(join(episodesDir, `${episodeId}.jsonl`), "{}\n", "utf8");

    await assert.rejects(
      () => deleteEpisodeRecords(stateRoot, episodeId),
      (error: unknown) => {
        assert.ok(error instanceof DomainValidationError);
        assert.match(error.message, /corrupt feedback jsonl at line 2 /);
        assert.match(error.message, /refusing to cascade an episode delete through it/);
        return true;
      }
    );

    assert.equal(await readFile(path, "utf8"), before, "no partial rewrite");
    assert.equal(
      existsSync(feedbackTombstonesPath(stateRoot)),
      false,
      "a delete that could not strip the text must not claim a tombstone"
    );
    assert.equal(
      existsSync(join(episodesDir, `${episodeId}.jsonl`)),
      true,
      "a failed delete must not half-delete the episode"
    );
    assert.equal(existsSync(feedbackLogLockPath(stateRoot)), false, "lock is released");
  });
});

test("an episode delete with no feedback log is a no-op, not an adaptation-plane write", async () => {
  await withStateRoot(async (stateRoot) => {
    const episodeId = createEpisodeId(UUID);
    const result = await deleteEpisodeRecords(stateRoot, episodeId);
    assert.deepEqual(result.cascadedFeedbackTombstones, []);
    assert.deepEqual(await cascadeFeedbackTombstones(stateRoot, episodeId), []);
    assert.equal(
      existsSync(adaptationRoot(stateRoot)),
      false,
      "a delete must not create the plane it deletes from"
    );
  });
});

/**
 * The episode lock is the file both episode writers serialize on (CLI
 * `episode close` and the run-side settle). A delete that unlinks the records
 * without holding it — or that unlinks the lock out from under a live holder —
 * reopens the interleaving the lock exists to prevent, so these tests pin the
 * acquire-then-unlink discipline rather than the old "remove the lock file
 * too" behaviour.
 */
async function seedEpisodeRecords(stateRoot: string, episodeId: EpisodeId): Promise<string[]> {
  const episodesDir = join(stateRoot, "runtime", "episodes");
  await mkdir(episodesDir, { recursive: true });
  const paths = [
    join(episodesDir, `${episodeId}.jsonl`),
    join(episodesDir, `${episodeId}.events.jsonl`)
  ];
  await writeFile(paths[0] as string, `${JSON.stringify(episodeFixture(episodeId))}\n`, "utf8");
  await writeFile(
    paths[1] as string,
    `${JSON.stringify({ type: "EPISODE_OPENED", episode: episodeFixture(episodeId) })}\n`,
    "utf8"
  );
  return paths;
}

test("delete --episode waits for a live holder before unlinking the episode records", async () => {
  await withStateRoot(async (stateRoot) => {
    const episodeId = createEpisodeId(UUID);
    const paths = await seedEpisodeRecords(stateRoot, episodeId);
    const lockPath = episodeLockPath(stateRoot, episodeId);
    let pending: Promise<{ removedPaths: readonly string[] }> | undefined;

    await withExclusiveFileLock(lockPath, async () => {
      pending = deleteEpisodeRecords(stateRoot, episodeId);
      await new Promise((resolve) => setTimeout(resolve, 80));
      for (const path of paths) {
        assert.equal(
          existsSync(path),
          true,
          "records must not be unlinked while another writer holds the episode lock"
        );
      }
    });

    assert.ok(pending !== undefined);
    assert.deepEqual((await pending).removedPaths, paths);
    for (const path of paths) assert.equal(existsSync(path), false);
    assert.equal(existsSync(lockPath), false, "the delete releases the lock it took");
  });
});

test("an episode delete that cannot take the episode lock fails closed", async () => {
  await withStateRoot(async (stateRoot) => {
    const episodeId = createEpisodeId(UUID);
    const paths = await seedEpisodeRecords(stateRoot, episodeId);
    const before = await Promise.all(paths.map(async (path) => readFile(path, "utf8")));
    await seedFeedback(stateRoot, episodeId, "fb-lock-timeout", { body: "text to strip" });
    const lockPath = episodeLockPath(stateRoot, episodeId);
    let outcome: unknown;

    await withExclusiveFileLock(lockPath, async () => {
      outcome = await deleteEpisodeRecords(stateRoot, episodeId, {
        timeoutMs: 40,
        retryMs: 5
      }).then(
        (result) => result,
        (error: unknown) => error
      );
    });

    assert.ok(outcome instanceof DomainValidationError, "a lock timeout must reject the delete");
    assert.match(outcome.message, /timed out waiting for lock/);
    assert.ok(outcome.message.includes(lockPath), "the failure must name the episode lock");
    for (const [index, path] of paths.entries()) {
      assert.equal(await readFile(path, "utf8"), before[index], "episode records must be intact");
    }
    // The disclosed half-way point: the cascade ran before the episode lock was
    // attempted, so the feedback text is already gone. That is the privacy-safe
    // direction, and the re-delete below is idempotent about it.
    assert.doesNotMatch(await readFile(feedbackLogPath(stateRoot), "utf8"), /text to strip/);
    const retry = await deleteEpisodeRecords(stateRoot, episodeId);
    assert.deepEqual(retry.removedPaths, paths);
    assert.deepEqual(retry.cascadedFeedbackTombstones, ["fb-lock-timeout"]);
  });
});

test("a completed episode delete leaves no lock behind and does not report one", async () => {
  await withStateRoot(async (stateRoot) => {
    const episodeId = createEpisodeId(UUID);
    const paths = await seedEpisodeRecords(stateRoot, episodeId);
    const lockPath = episodeLockPath(stateRoot, episodeId);

    const result = await deleteEpisodeRecords(stateRoot, episodeId);
    assert.equal(existsSync(lockPath), false, "episode lock must not outlive the episode");
    assert.deepEqual(result.removedPaths, paths);
    assert.ok(
      !result.removedPaths.includes(lockPath),
      "the lock this delete created itself is not an episode record it removed"
    );
    assert.equal(result.droppedInvocations, 0);

    // Idempotent: the second delete finds nothing, takes no lock, and leaves
    // no new lock file behind.
    const again = await deleteEpisodeRecords(stateRoot, episodeId);
    assert.deepEqual(again.removedPaths, []);
    assert.equal(existsSync(lockPath), false);
  });
});

test("a delete of an episode with nothing on disk creates neither the directory nor a lock", async () => {
  await withStateRoot(async (stateRoot) => {
    const episodeId = createEpisodeId(UUID);
    const result = await deleteEpisodeRecords(stateRoot, episodeId);
    assert.deepEqual(result.removedPaths, []);
    assert.equal(
      existsSync(join(stateRoot, "runtime", "episodes")),
      false,
      "a delete must not create the directory it deletes from just to take a lock"
    );
  });
});

/**
 * A lock with no records next to it is still a live writer: waiting for it is
 * what stops the delete from reporting "nothing found" a millisecond before
 * the holder writes the episode back to disk.
 */
test("a delete that waits on a live writer removes the records that writer just wrote", async () => {
  await withStateRoot(async (stateRoot) => {
    const episodeId = createEpisodeId(UUID);
    const recordPath = join(stateRoot, "runtime", "episodes", `${episodeId}.jsonl`);
    let pending: Promise<{ removedPaths: readonly string[] }> | undefined;

    await withExclusiveFileLock(episodeLockPath(stateRoot, episodeId), async () => {
      pending = deleteEpisodeRecords(stateRoot, episodeId);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await writeFile(recordPath, `${JSON.stringify(episodeFixture(episodeId))}\n`, "utf8");
    });

    assert.ok(pending !== undefined);
    assert.deepEqual((await pending).removedPaths, [recordPath]);
    assert.equal(existsSync(recordPath), false);
  });
});

test("the delete serializes on the same lock file the episode writers take", async () => {
  const episodeId = createEpisodeId(UUID);
  assert.equal(
    episodeLockPath("/state", episodeId),
    join("/state", "runtime", "episodes", `${episodeId}.lock`)
  );
  // Source pin: the delete must reuse the shared path helper. Rebuilding the
  // template here would let the two sides drift onto different lock files.
  const source = await readFile(new URL("../../../src/privacy/deletion.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ episodeLockPath \} from "\.\.\/run\/episode-bind\.js";/);
  assert.doesNotMatch(source, /`\$\{episodeId\}\.lock`/);
});

test("delete --run drops only that run's rows from the shared invocation log", async () => {
  await withStateRoot(async (stateRoot) => {
    const doomed = createRunId(UUID);
    const keeper = createRunId(UUID);
    const path = await writeInvocationLog(stateRoot, [
      `${JSON.stringify(invocationRow(doomed, "inv_a"))}\n`,
      `${JSON.stringify(invocationRow(keeper, "inv_b"))}\n`,
      `${JSON.stringify(invocationRow(doomed, "inv_c"))}\n`
    ]);

    const result = await deleteRunRecords(stateRoot, doomed);
    assert.equal(result.droppedInvocations, 2);
    assert.ok(result.removedPaths.some((line) => line.startsWith(path)));

    const remaining = await loadInvocationsFromStateRoot(stateRoot);
    assert.deepEqual(
      remaining.map((inv) => inv.id),
      ["inv_b"]
    );
    assert.doesNotMatch(await readFile(path, "utf8"), new RegExp(doomed));
  });
});

test("delete --run leaves the invocation log untouched when the run has no rows", async () => {
  await withStateRoot(async (stateRoot) => {
    const keeper = createRunId(UUID);
    const path = await writeInvocationLog(stateRoot, [
      `${JSON.stringify(invocationRow(keeper, "inv_b"))}\n`
    ]);
    const before = await readFile(path, "utf8");

    const result = await deleteRunRecords(stateRoot, createRunId(UUID));
    assert.equal(result.droppedInvocations, 0);
    assert.deepEqual(result.removedPaths, []);
    assert.equal(await readFile(path, "utf8"), before);
  });
});

test("a corrupt middle line fails the run delete closed, before anything is unlinked", async () => {
  await withStateRoot(async (stateRoot) => {
    const doomed = createRunId(UUID);
    await writeInvocationLog(stateRoot, [
      `${JSON.stringify(invocationRow(doomed, "inv_a"))}\n`,
      "{ this is not json\n",
      `${JSON.stringify(invocationRow(doomed, "inv_c"))}\n`
    ]);
    const runDir = join(stateRoot, "runtime", "runs", doomed);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "events.jsonl"), "{}\n", "utf8");

    await assert.rejects(
      () => deleteRunRecords(stateRoot, doomed),
      (error: unknown) => {
        assert.ok(error instanceof DomainValidationError);
        assert.match(error.message, /corrupt invocation jsonl at line 2/);
        return true;
      }
    );
    assert.equal(existsSync(runDir), true, "a failed delete must not half-delete the run");
  });
});

test("a crash-truncated final line is dropped by the rewrite instead of being kept", async () => {
  await withStateRoot(async (stateRoot) => {
    const doomed = createRunId(UUID);
    const keeper = createRunId(UUID);
    const path = await writeInvocationLog(stateRoot, [
      `${JSON.stringify(invocationRow(doomed, "inv_a"))}\n`,
      `${JSON.stringify(invocationRow(keeper, "inv_b"))}\n`,
      '{"id":"inv_partial","runId":"run_'
    ]);

    const result = await deleteRunRecords(stateRoot, doomed);
    assert.equal(result.droppedInvocations, 1);
    const rewritten = await readFile(path, "utf8");
    assert.doesNotMatch(rewritten, /inv_partial/);
    assert.match(rewritten, /inv_b/);
  });
});

/**
 * A live invocation the executor would hand to `onInvocation`. Unlike
 * `invocationRow` this has to survive `validateInvocation`, because the locked
 * append fails closed on a record it could not read back.
 */
function liveInvocation(runId: RunId): ModelInvocation {
  return {
    id: createInvocationId(UUID),
    taskId: createTaskId(UUID),
    runId,
    agentInstanceId: createAgentInstanceId(UUID),
    config: {
      provider: "faux",
      model: "cheap",
      modelVersion: "cheap-v1",
      parameterHash: hash32("params")
    },
    responseHash: hash32("response"),
    tokensIn: 1000,
    tokensOut: 500,
    latencyMs: 200,
    occurredAt: parseIsoTimestamp("2026-08-24T00:00:00.000Z"),
    callOutcome: "ok"
  };
}

test("the run-delete rewrite waits for the invocation log lock", async () => {
  await withStateRoot(async (stateRoot) => {
    const doomed = createRunId(UUID);
    const path = await writeInvocationLog(stateRoot, [
      `${JSON.stringify(invocationRow(doomed, "inv_a"))}\n`
    ]);
    const before = await readFile(path, "utf8");
    let pending: Promise<{ droppedInvocations: number }> | undefined;

    await withInvocationLogLock(stateRoot, async () => {
      pending = deleteRunRecords(stateRoot, doomed);
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(
        await readFile(path, "utf8"),
        before,
        "the rewrite must not start while another writer holds the lock"
      );
    });

    assert.ok(pending !== undefined);
    assert.equal((await pending).droppedInvocations, 1);
    assert.equal(await readFile(path, "utf8"), "");
    assert.equal(existsSync(invocationLogLockPath(stateRoot)), false, "lock is released");
  });
});

/**
 * The delete-vs-live-appender race: `deleteRunRecords` reads, filters, and
 * rewrites the shared log, so an append that lands between its read and its
 * write used to be erased. Both writers now take the same lock, so whichever
 * order they run in, the appended row survives and the deleted run's rows do
 * not.
 */
test("an invocation appended while a run delete runs is never clobbered", async () => {
  await withStateRoot(async (stateRoot) => {
    const doomed = createRunId(UUID);
    const keeper = createRunId(UUID);
    const path = await writeInvocationLog(stateRoot, [
      `${JSON.stringify(invocationRow(doomed, "inv_a"))}\n`,
      `${JSON.stringify(invocationRow(keeper, "inv_b"))}\n`,
      `${JSON.stringify(invocationRow(doomed, "inv_c"))}\n`
    ]);
    const live = liveInvocation(keeper);

    const [result] = await Promise.all([
      deleteRunRecords(stateRoot, doomed),
      appendInvocationRecord(stateRoot, live)
    ]);

    assert.equal(result.droppedInvocations, 2);
    const rows = (await readFile(path, "utf8"))
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as { id: string });
    assert.deepEqual(
      rows.map((row) => row.id).sort(),
      ["inv_b", live.id].sort(),
      "the live append survives the rewrite and the deleted run's rows do not"
    );
  });
});

test("a live append cannot resurrect the deleted run's rows after the rewrite", async () => {
  await withStateRoot(async (stateRoot) => {
    const doomed = createRunId(UUID);
    await writeInvocationLog(stateRoot, [
      `${JSON.stringify(invocationRow(doomed, "inv_a"))}\n`
    ]);

    await deleteRunRecords(stateRoot, doomed);
    // An in-flight executor whose run was just deleted still appends. That row
    // is a new fact, not a resurrected one: the delete is a point-in-time
    // operation, and the operator has to delete again to clear it.
    const late = liveInvocation(doomed);
    await appendInvocationRecord(stateRoot, late);
    assert.deepEqual(
      (await loadInvocationsFromStateRoot(stateRoot)).map((inv) => inv.id),
      [late.id]
    );

    const second = await deleteRunRecords(stateRoot, doomed);
    assert.equal(second.droppedInvocations, 1);
    assert.deepEqual(await loadInvocationsFromStateRoot(stateRoot), []);
  });
});

/**
 * The run plane's cooperative lock is `runtime/runs/<runId>.lock`
 * (`runLockPath`). `deleteRunRecords` holds it across the removal and the
 * verification, and the writers that are not in the per-step loop take it too
 * (`requestPause`, the track-questions write). The two per-step writers do not
 * — a measured decision pinned in their own tests — so `appendJsonlLine`'s
 * ENOENT recovery and `writeFileAtomic`'s `mkdir` can still put a removed
 * directory back. These tests pin what the delete does about that: it verifies
 * under the lock and again after releasing it, and it refuses to call a
 * removal a success when the records are on disk at either point.
 */
function agentEvent(runId: RunId, summary: string): Event {
  return runEvent(runId, "AGENT_EVENT", {
    agentInstanceId: "agt_00000000-0000-4000-8000-000000000009",
    kind: "TEXT_DELTA",
    summary
  });
}

/**
 * D3 (GPT-r2): `adapt dataset` writes a durable, derived copy of the run's own
 * task text under `adaptation/eval-datasets/<runId>/`, and no delete reached
 * it — so deleting the source run left the objective excerpt and the project
 * root on disk indefinitely while the record class claimed `delete-files`.
 * The default path is derived from the run id, which is what makes the cascade
 * possible without searching the filesystem for manifests.
 */
test("delete --run removes the replay dataset exported from that run", async () => {
  await withStateRoot(async (stateRoot) => {
    const runId = createRunId(UUID);
    const workspace = await mkdtemp(join(tmpdir(), "pi-sparkle-deletion-ws-"));
    const objective = "Ship the payroll importer for acme-corp";
    const events = routedRunEvents(runId, workspace, objective);
    const store = new EventStore(stateRoot, runId);
    for (const event of events) await store.append(event);

    const exported = await exportRoutingEvalDataset({ stateRoot, runId, events });
    assert.equal(
      exported.datasetDir,
      join(adaptationRoot(stateRoot), "eval-datasets", runId),
      "the cascade only reaches the default path, so the export must use it"
    );
    assert.ok((await readFile(exported.manifestPath, "utf8")).includes("payroll importer"));

    const result = await deleteRunRecords(stateRoot, runId);

    assert.equal(existsSync(exported.datasetDir), false, "the derived task text survived the delete");
    assert.ok(
      result.removedPaths.includes(exported.datasetDir),
      `the delete must report the dataset it removed: ${JSON.stringify(result.removedPaths)}`
    );
    // Only the run's own dataset goes; the plane it lives in stays.
    assert.equal(existsSync(join(adaptationRoot(stateRoot), "eval-datasets")), true);
    await rm(workspace, { recursive: true, force: true });
  });
});

test("a re-delete of a run whose dataset is already gone reports only what it removed", async () => {
  await withStateRoot(async (stateRoot) => {
    const runId = createRunId(UUID);
    const workspace = await mkdtemp(join(tmpdir(), "pi-sparkle-deletion-ws-"));
    const events = routedRunEvents(runId, workspace, "Implement the cache layer");
    const store = new EventStore(stateRoot, runId);
    for (const event of events) await store.append(event);
    const exported = await exportRoutingEvalDataset({ stateRoot, runId, events });

    const first = await deleteRunRecords(stateRoot, runId);
    assert.ok(first.removedPaths.includes(exported.datasetDir));

    const second = await deleteRunRecords(stateRoot, runId);
    assert.deepEqual(second.removedPaths, [], "an absent dataset is not a removal to report");
    await rm(workspace, { recursive: true, force: true });
  });
});

test("verifying a run delete passes on an absent subtree and fails on a recreated one", async () => {
  await withStateRoot(async (stateRoot) => {
    const runId = createRunId(UUID);
    // Nothing on disk: there is nothing to disprove.
    await verifyRunRecordsRemoved(stateRoot, runId);

    // `appendJsonlLine`'s recovery path creates the directory first and
    // appends second, so even a bare directory is a resurrection in flight.
    const runDir = join(stateRoot, "runtime", "runs", runId);
    await mkdir(runDir, { recursive: true });
    await assert.rejects(
      () => verifyRunRecordsRemoved(stateRoot, runId),
      (error: unknown) => {
        assert.ok(error instanceof RunRecordsSurvivedError);
        assert.equal(error.code, RUN_RECORDS_SURVIVED_CODE);
        assert.equal(error.runDir, runDir);
        assert.deepEqual(error.survivingEntries, []);
        assert.match(error.message, /an empty directory/);
        // The CLI maps this class onto a validation failure, not a crash.
        assert.ok(error instanceof DomainValidationError);
        return true;
      }
    );
  });
});

test("a live append recreates the deleted run directory, and the check says so", async () => {
  await withStateRoot(async (stateRoot) => {
    const runId = createRunId(UUID);
    const store = new EventStore(stateRoot, runId);
    await store.append(agentEvent(runId, "first"));
    const runDir = join(stateRoot, "runtime", "runs", runId);

    const result = await deleteRunRecords(stateRoot, runId);
    assert.deepEqual(result.removedPaths, [runDir]);
    assert.equal(existsSync(runDir), false);
    // The success the delete reported is one it proved.
    await verifyRunRecordsRemoved(stateRoot, runId);

    // The disclosed window: an executor that outlived the delete appends
    // again and the appender's ENOENT retry puts the directory back. Those
    // bytes are a new fact rather than a resurrected one, but a caller must
    // be able to find out that run records exist again.
    await store.append(agentEvent(runId, "written after the delete"));
    assert.equal(existsSync(runDir), true, "the appender recreates what the delete removed");
    await assert.rejects(
      () => verifyRunRecordsRemoved(stateRoot, runId),
      (error: unknown) => {
        assert.ok(error instanceof RunRecordsSurvivedError);
        assert.deepEqual(error.survivingEntries, ["events.jsonl"]);
        return true;
      }
    );

    // Deleting again is honest about the new bytes: removed, then verified.
    const second = await deleteRunRecords(stateRoot, runId);
    assert.deepEqual(second.removedPaths, [runDir]);
    await verifyRunRecordsRemoved(stateRoot, runId);
    assert.doesNotMatch(
      await readFile(join(stateRoot, "runtime", "runs", runId, "events.jsonl"), "utf8").catch(
        () => ""
      ),
      /written after the delete/
    );
  });
});

/**
 * The race itself. The writer does exactly what `appendJsonlLine` does when
 * its directory disappeared — mkdir, then append — in a tight loop, so the
 * recursive removal reliably loses. Whether it loses by `rm` failing
 * (ENOTEMPTY, a file created inside the walk) or by the directory being back
 * afterwards, the delete must raise the one typed error instead of returning
 * a `DeletionResult`.
 *
 * The second assertion is the one this round added: a delete that *does*
 * return must have the run directory gone at the moment it returns. That is
 * why the removal is verified again after the lock is released — before, a
 * writer that landed in the release window (or just after the in-lock check)
 * left the caller holding a success over records that were already back. An
 * adversarial probe measured up to 5 such deletes per 30 before this change
 * (5/30 against a tight-loop appender, 2/30 against a checkpoint writer) and
 * 0 per 30 after, for every writer shape.
 */
test("a run directory recreated by a live writer fails the delete loudly", async () => {
  await withStateRoot(async (stateRoot) => {
    let survived: RunRecordsSurvivedError | undefined;
    for (let attempt = 0; attempt < 12 && survived === undefined; attempt += 1) {
      const runId = createRunId(UUID);
      const runDir = join(stateRoot, "runtime", "runs", runId);
      await mkdir(runDir, { recursive: true });
      // Enough entries that the removal spans several event-loop turns: a
      // one-file directory is walked and gone before a writer can interleave.
      await Promise.all(
        Array.from({ length: 300 }, (_, index) =>
          writeFile(join(runDir, `part-${index}.json`), "{}\n", "utf8")
        )
      );

      let writing = true;
      const writer = (async () => {
        while (writing) {
          await mkdir(runDir, { recursive: true }).catch(() => undefined);
          await appendFile(join(runDir, "events.jsonl"), "{}\n", "utf8").catch(() => undefined);
        }
      })();
      const outcome: unknown = await deleteRunRecords(stateRoot, runId).then(
        (result) => result,
        (error: unknown) => error
      );
      const onDiskAtReturn = existsSync(runDir);
      writing = false;
      await writer;

      if (outcome instanceof RunRecordsSurvivedError) survived = outcome;
      else {
        assert.ok(
          !(outcome instanceof Error),
          `a lost race must surface as RunRecordsSurvivedError, not ${String(outcome)}`
        );
        assert.equal(
          onDiskAtReturn,
          false,
          "a delete that returned a result must have the run directory gone when it returned"
        );
      }
      await rm(runDir, { recursive: true, force: true });
    }

    assert.ok(survived, "a delete that lost the race must not return a DeletionResult");
    assert.equal(survived.code, RUN_RECORDS_SURVIVED_CODE);
    assert.match(survived.message, /refusing to report the delete as successful/);
    assert.match(survived.message, /Stop or cancel the run before deleting it again/);
    assert.ok(survived.runDir.includes("runtime"));
    assert.ok(
      survived.message.includes(`${survived.runDir}.lock`),
      "the remedy must name the lock the delete held, so the operator can inspect it"
    );
  });
});

/**
 * The same race driven by the writers a real run uses, rather than by raw
 * `fs`: the event appender (which does not take the run lock) and the
 * checkpoint writer (which does not either). Neither may produce a delete that
 * returns success over records that are on disk.
 */
test("a live run's own writers cannot make a delete report a removal it lost", async () => {
  await withStateRoot(async (stateRoot) => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const runId = createRunId(UUID);
      const runDir = join(stateRoot, "runtime", "runs", runId);
      const store = new EventStore(stateRoot, runId);
      const checkpoints = new CheckpointStore(stateRoot, runId);
      await store.append(agentEvent(runId, "before the delete"));
      await Promise.all(
        Array.from({ length: 200 }, (_, index) =>
          writeFile(join(runDir, `part-${index}.json`), "{}\n", "utf8")
        )
      );

      let writing = true;
      const writer = (async () => {
        for (let index = 0; writing; index += 1) {
          await store.append(agentEvent(runId, `during ${index}`)).catch(() => undefined);
          await checkpoints.write({ schemaVersion: 1, generation: index }).catch(() => undefined);
        }
      })();
      const outcome: unknown = await deleteRunRecords(stateRoot, runId).then(
        (result) => result,
        (error: unknown) => error
      );
      const onDiskAtReturn = existsSync(runDir);
      writing = false;
      await writer;

      if (outcome instanceof Error) {
        assert.ok(
          outcome instanceof RunRecordsSurvivedError,
          `a lost race must surface as RunRecordsSurvivedError, not ${String(outcome)}`
        );
      } else {
        assert.equal(onDiskAtReturn, false, "a returned delete must leave nothing on disk");
      }
      await rm(runDir, { recursive: true, force: true });
    }
  });
});

/**
 * The two outcomes a `delete --run` aimed at a *live* run can now have, and
 * the one it can no longer have.
 *
 * The run lifecycle holds `runLockPath` for the whole run
 * (`withRunLifecycleLock`), so the delete waits at the lock instead of walking
 * into the run's records. Before that acquisition it took the free lock
 * between two of the run's own writes, removed the subtree, watched the next
 * append put it back, and threw `RunRecordsSurvivedError` — fail-closed, but
 * only after destroying part of a live run. The two cases below are what
 * replaced it: the run ends inside the bounded wait and the delete is clean,
 * or the wait runs out and the delete removes none of the run's own records.
 * "None of the run's own records" is the whole claim — the telemetry half
 * runs before the lock and stays run; the partiality cases below pin that.
 */
function deletionFlowchart(): Flowchart {
  const only: FlowNode = {
    id: "only",
    taskId: createTaskId(() => "only"),
    role: "actor",
    objective: "Do only",
    modelPolicy: { allowedModels: ["cheap"] },
    confidenceThreshold: validateConfidenceScore(0.7),
    approvalRequired: false
  };
  return { id: "deletion-live-run", nodes: [only], edges: [] };
}

function deletionRouter(): ModelRouter {
  return createModelRouter({
    policyVersion: "router-v1",
    models: [
      {
        id: "cheap",
        version: "cheap-v1",
        roles: ["actor", "critic"],
        maxComplexity: "MEDIUM",
        estimatedCostUsd: 0.1,
        estimatedDurationMs: 1_000
      }
    ]
  });
}

/** A pause controller that never pauses but runs `probe` on the first poll. */
function onFirstPoll(probe: (runId: RunId) => Promise<void>): PauseController {
  let probed = false;
  return {
    async requestPause(): Promise<PauseToken> {
      return { paused: false };
    },
    async clearPause(): Promise<void> {},
    async token(runId: RunId): Promise<PauseToken> {
      if (!probed) {
        probed = true;
        await probe(runId);
      }
      return { paused: false };
    }
  };
}

async function withProjectRoot(run: (projectRoot: string) => Promise<void>): Promise<void> {
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-deletion-proj-"));
  try {
    await run(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

test("a delete aimed at a live run waits for it, then removes it cleanly", async () => {
  await withStateRoot(async (stateRoot) => {
    await withProjectRoot(async (projectRoot) => {
      let pending: Promise<{ removedPaths: readonly string[] }> | undefined;
      let runDir: string | undefined;

      const outcome = await startFlowchartRun(
        {
          stateRoot,
          router: deletionRouter(),
          now: () => parseIsoTimestamp("2026-08-24T09:00:00.000Z"),
          generateId: UUID,
          pause: onFirstPoll(async (runId) => {
            runDir = join(stateRoot, "runtime", "runs", runId);
            pending = deleteRunRecords(stateRoot, runId);
            await new Promise((resolve) => setTimeout(resolve, 80));
            assert.equal(
              existsSync(join(runDir, "events.jsonl")),
              true,
              "a delete must not remove a live run's records out from under it"
            );
          })
        },
        {
          projectRoot,
          flowchart: deletionFlowchart(),
          childResults: {
            only: { outcome: "SUCCESS", confidence: validateConfidenceScore(0.9), evidenceIds: ["evd_only"] }
          }
        }
      );

      assert.equal(outcome.status, "COMPLETED", "the run finished undamaged");
      assert.ok(pending !== undefined && runDir !== undefined);
      assert.deepEqual(
        (await pending).removedPaths,
        [runDir],
        "the delete that waited reports a removal, not a survivor"
      );
      assert.equal(existsSync(runDir), false);
      await verifyRunRecordsRemoved(stateRoot, outcome.runId);
    });
  });
});

test("a delete that cannot outwait a live run fails closed with the records intact", async () => {
  await withStateRoot(async (stateRoot) => {
    await withProjectRoot(async (projectRoot) => {
      let refused: unknown;
      let survivingLog: string | undefined;

      const outcome = await startFlowchartRun(
        {
          stateRoot,
          router: deletionRouter(),
          now: () => parseIsoTimestamp("2026-08-24T09:00:00.000Z"),
          generateId: UUID,
          pause: onFirstPoll(async (runId) => {
            refused = await deleteRunRecords(stateRoot, runId, { timeoutMs: 40, retryMs: 5 }).then(
              (result) => result,
              (error: unknown) => error
            );
            survivingLog = await readFile(
              join(stateRoot, "runtime", "runs", runId, "events.jsonl"),
              "utf8"
            );
          })
        },
        {
          projectRoot,
          flowchart: deletionFlowchart(),
          childResults: {
            only: { outcome: "SUCCESS", confidence: validateConfidenceScore(0.9), evidenceIds: ["evd_only"] }
          }
        }
      );

      assert.ok(refused instanceof DomainValidationError, "the delete must reject, not return");
      assert.equal((refused as { code?: unknown }).code, LOCK_TIMEOUT_CODE);
      assert.ok(
        !(refused instanceof RunRecordsSurvivedError),
        "a live run is a wait that ran out, not a resurrection"
      );
      assert.match(survivingLog ?? "", /RUN_STARTED/, "the refused delete removed nothing");
      assert.equal(outcome.status, "COMPLETED");

      // Once the run has released the lock, the same delete is clean.
      const after = await deleteRunRecords(stateRoot, outcome.runId);
      assert.deepEqual(after.removedPaths, [join(stateRoot, "runtime", "runs", outcome.runId)]);
    });
  });
});

/**
 * The lock side of the delete, pinned the way the episode lock is: a delete
 * waits for a live holder instead of deleting around it, and it fails closed
 * when it cannot have the lock at all.
 */
test("delete --run waits for a live run-lock holder before removing anything", async () => {
  await withStateRoot(async (stateRoot) => {
    const runId = createRunId(UUID);
    const runDir = join(stateRoot, "runtime", "runs", runId);
    await new EventStore(stateRoot, runId).append(agentEvent(runId, "recorded work"));
    let pending: Promise<{ removedPaths: readonly string[] }> | undefined;

    await withExclusiveFileLock(runLockPath(stateRoot, runId), async () => {
      pending = deleteRunRecords(stateRoot, runId);
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(
        existsSync(runDir),
        true,
        "records must not be removed while another writer holds the run lock"
      );
    });

    assert.ok(pending !== undefined);
    assert.deepEqual((await pending).removedPaths, [runDir]);
    assert.equal(existsSync(runDir), false);
    assert.equal(
      existsSync(runLockPath(stateRoot, runId)),
      false,
      "the delete releases the lock it took"
    );
  });
});

test("a run delete that cannot take the run lock fails closed over the run's records", async () => {
  await withStateRoot(async (stateRoot) => {
    const runId = createRunId(UUID);
    const runDir = join(stateRoot, "runtime", "runs", runId);
    await new EventStore(stateRoot, runId).append(agentEvent(runId, "still here"));
    const before = await readFile(join(runDir, "events.jsonl"), "utf8");
    const lockPath = runLockPath(stateRoot, runId);
    let outcome: unknown;

    await withExclusiveFileLock(lockPath, async () => {
      outcome = await deleteRunRecords(stateRoot, runId, { timeoutMs: 40, retryMs: 5 }).then(
        (result) => result,
        (error: unknown) => error
      );
    });

    assert.ok(outcome instanceof DomainValidationError, "a lock timeout must reject the delete");
    assert.equal((outcome as { code?: unknown }).code, LOCK_TIMEOUT_CODE);
    assert.match(outcome.message, /timed out waiting for lock/);
    assert.ok(outcome.message.includes(lockPath), "the failure must name the run lock");
    assert.equal(await readFile(join(runDir, "events.jsonl"), "utf8"), before);

    // Idempotent once the holder is gone.
    assert.deepEqual((await deleteRunRecords(stateRoot, runId)).removedPaths, [runDir]);
  });
});

/**
 * The half of a timed-out delete that *did* happen.
 *
 * The two tests above use fixtures with no invocation rows, so they cannot see
 * the shape of the real contract: the telemetry rewrite runs before the run
 * lock is ever requested, and a timeout at that lock does not put its rows
 * back. Everything the operator-facing surfaces say about a lock timeout is
 * pinned here — the run's records survive byte-for-byte, the dropped rows and
 * the derived snapshot stay gone, exactly one disclosure line names them, and
 * the re-delete finishes the refused half without re-dropping the first.
 */
test("a timed-out run delete keeps the invocation rows it already dropped, and discloses them", async () => {
  await withStateRoot(async (stateRoot) => {
    const doomed = createRunId(UUID);
    const keeper = createRunId(UUID);
    const runDir = join(stateRoot, "runtime", "runs", doomed);
    await new EventStore(stateRoot, doomed).append(agentEvent(doomed, "work the timeout keeps"));
    const beforeEvents = await readFile(join(runDir, "events.jsonl"), "utf8");
    const logPath = await writeInvocationLog(stateRoot, [
      `${JSON.stringify(invocationRow(doomed, "inv_a"))}\n`,
      `${JSON.stringify(invocationRow(keeper, "inv_b"))}\n`
    ]);
    const observed = catalogObservedPath(stateRoot);
    await mkdir(join(stateRoot, "runtime", "routing"), { recursive: true });
    await writeFile(observed, '{"models":[]}\n', "utf8");

    const disclosed: string[] = [];
    let outcome: unknown;
    await withExclusiveFileLock(runLockPath(stateRoot, doomed), async () => {
      outcome = await deleteRunRecords(stateRoot, doomed, {
        timeoutMs: 40,
        retryMs: 5,
        disclosePartial: (line) => disclosed.push(line)
      }).then(
        (result) => result,
        (error: unknown) => error
      );
    });

    assert.equal((outcome as { code?: unknown }).code, LOCK_TIMEOUT_CODE);
    assert.equal(
      await readFile(join(runDir, "events.jsonl"), "utf8"),
      beforeEvents,
      "the lock-guarded half is the half a timeout refuses"
    );
    assert.deepEqual(
      (await readFile(logPath, "utf8"))
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => (JSON.parse(line) as { id: string }).id),
      ["inv_b"],
      "the pre-lock rewrite is not rolled back by the failure that follows it"
    );
    assert.equal(existsSync(observed), false, "the derived snapshot goes with the rows");

    assert.equal(disclosed.length, 1, `one disclosure, got: ${JSON.stringify(disclosed)}`);
    const line = disclosed[0] ?? "";
    assert.match(line, /1 invocation row\(s\) were dropped/);
    assert.ok(line.includes(logPath), "the disclosure must name the log it rewrote");
    assert.ok(line.includes(observed), "the disclosure must name the snapshot it invalidated");
    assert.ok(!line.includes("\n"), "one line, so a CLI can write it as one");

    // The re-delete finishes the half that was refused, and the half that
    // already completed is a no-op the second time.
    const after = await deleteRunRecords(stateRoot, doomed);
    assert.deepEqual(after.removedPaths, [runDir]);
    assert.equal(after.droppedInvocations, 0);
  });
});

test("a run delete that drops no rows before failing discloses nothing", async () => {
  await withStateRoot(async (stateRoot) => {
    const runId = createRunId(UUID);
    await new EventStore(stateRoot, runId).append(agentEvent(runId, "no telemetry for this run"));
    const disclosed: string[] = [];

    await withExclusiveFileLock(runLockPath(stateRoot, runId), async () => {
      await deleteRunRecords(stateRoot, runId, {
        timeoutMs: 40,
        retryMs: 5,
        disclosePartial: (line) => disclosed.push(line)
      }).then(
        () => assert.fail("a held run lock must refuse the delete"),
        (error: unknown) => assert.equal((error as { code?: unknown }).code, LOCK_TIMEOUT_CODE)
      );
    });

    assert.deepEqual(disclosed, [], "a delete that changed nothing must not claim it did");
  });
});

/**
 * `--lock-wait-ms` names one bound, and a `delete --run` takes two locks. The
 * invocation log's acquisition used to keep the 5 s default no matter what the
 * operator asked for, so a zero wait could still sit on it and a long wait was
 * cut short by it. Pinned from the short end, where the difference is a wall
 * clock reading rather than an assertion about which default applied.
 */
test("delete --run bounds the invocation log lock with the wait it was given", async () => {
  await withStateRoot(async (stateRoot) => {
    const doomed = createRunId(UUID);
    const logPath = await writeInvocationLog(stateRoot, [
      `${JSON.stringify(invocationRow(doomed, "inv_a"))}\n`
    ]);
    const before = await readFile(logPath, "utf8");
    const disclosed: string[] = [];
    let outcome: unknown;
    let elapsedMs = 0;

    await withInvocationLogLock(stateRoot, async () => {
      const startedAt = Date.now();
      outcome = await deleteRunRecords(stateRoot, doomed, {
        timeoutMs: 0,
        retryMs: 5,
        disclosePartial: (line) => disclosed.push(line)
      }).then(
        (result) => result,
        (error: unknown) => error
      );
      elapsedMs = Date.now() - startedAt;
    });

    assert.equal((outcome as { code?: unknown }).code, LOCK_TIMEOUT_CODE);
    assert.ok(
      (outcome as Error).message.includes(invocationLogLockPath(stateRoot)),
      "the refusal must name the lock the delete could not have"
    );
    assert.ok(elapsedMs < 2_000, `a zero wait must not sit on the 5s default: ${elapsedMs}ms`);
    assert.equal(await readFile(logPath, "utf8"), before, "nothing was rewritten");
    assert.deepEqual(disclosed, [], "a rewrite that never ran has nothing to disclose");
  });
});

/**
 * A lock with no records next to it is still a live writer: waiting for it is
 * what stops the delete from reporting "nothing found" a millisecond before
 * the holder writes the run's records back. Same contract as the episode side.
 */
test("a run delete waits on a lock with no records and removes what that writer wrote", async () => {
  await withStateRoot(async (stateRoot) => {
    const runId = createRunId(UUID);
    const runDir = join(stateRoot, "runtime", "runs", runId);
    let pending: Promise<{ removedPaths: readonly string[] }> | undefined;

    await withExclusiveFileLock(runLockPath(stateRoot, runId), async () => {
      pending = deleteRunRecords(stateRoot, runId);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await mkdir(runDir, { recursive: true });
      await writeFile(join(runDir, "pause.json"), "{}\n", "utf8");
    });

    assert.ok(pending !== undefined);
    assert.deepEqual((await pending).removedPaths, [runDir]);
    assert.equal(existsSync(runDir), false);
  });
});

test("a completed run delete leaves no lock behind and does not report one", async () => {
  await withStateRoot(async (stateRoot) => {
    const runId = createRunId(UUID);
    const runDir = join(stateRoot, "runtime", "runs", runId);
    await new EventStore(stateRoot, runId).append(agentEvent(runId, "work"));

    const result = await deleteRunRecords(stateRoot, runId);
    assert.deepEqual(result.removedPaths, [runDir]);
    assert.equal(
      existsSync(runLockPath(stateRoot, runId)),
      false,
      "the run lock must not outlive the delete that created it"
    );
    assert.ok(
      !result.removedPaths.includes(runLockPath(stateRoot, runId)),
      "a lock the delete created itself is not a run record it removed"
    );
  });
});

test("a delete of a run with nothing on disk creates neither the directory nor a lock", async () => {
  await withStateRoot(async (stateRoot) => {
    const runId = createRunId(UUID);
    const result = await deleteRunRecords(stateRoot, runId);
    assert.deepEqual(result.removedPaths, []);
    assert.equal(
      existsSync(join(stateRoot, "runtime", "runs")),
      false,
      "a delete must not create the directory it deletes from just to take a lock"
    );
    assert.equal(existsSync(runLockPath(stateRoot, runId)), false);
  });
});

test("the run delete serializes on the same lock file the run writers take", async () => {
  const runId = createRunId(UUID);
  assert.equal(
    runLockPath("/state", runId),
    join("/state", "runtime", "runs", `${runId}.lock`),
    "the lock is beside the run directory, so the delete's own rm cannot remove it"
  );
  // Source pin: the delete must reuse the shared path helper, and it must
  // re-verify after the lock is released — a window no behavioural test can
  // hit deterministically once it is closed.
  const source = await readFile(new URL("../../../src/privacy/deletion.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ runLockPath \} from "\.\.\/run\/event-store\.js";/);
  assert.doesNotMatch(source, /`\$\{runId\}\.lock`/);
  assert.match(
    source,
    /removeRunSubtreeLocked\(stateRoot, runId, runDir, options\);[\s\S]*?if \(removed\.length > 0\) await verifyRunRecordsRemoved\(stateRoot, runId\);/
  );
});

test("the run delete cannot report a subtree removal it did not verify", async () => {
  const source = await readFile(new URL("../../../src/privacy/deletion.ts", import.meta.url), "utf8");
  // Source pin: the only path that reports `runDir` as removed is the one that
  // goes through the verified helper, and it runs inside the run lock.
  // Removing the check would leave the resurrection race reported as a clean
  // delete again, and no behavioural test can catch a window that closed.
  assert.match(
    source,
    /withExclusiveFileLock\(\s*lockPath,\s*async \(\) => \{[\s\S]*?await removeRunSubtree\(stateRoot, runId, runDir\);\s*return \[runDir\];/
  );
  assert.match(source, /await verifyRunRecordsRemoved\(stateRoot, runId\);/);
});

test("run delete invalidates the derived observed snapshot only when rows were dropped", async () => {
  await withStateRoot(async (stateRoot) => {
    const doomed = createRunId(UUID);
    const observed = catalogObservedPath(stateRoot);
    await mkdir(join(stateRoot, "runtime", "routing"), { recursive: true });
    await writeFile(observed, JSON.stringify({ versions: {} }), "utf8");

    // No rows for this run: a delete must not touch an unrelated aggregate.
    await deleteRunRecords(stateRoot, doomed);
    assert.equal(existsSync(observed), true);

    await writeInvocationLog(stateRoot, [`${JSON.stringify(invocationRow(doomed, "inv_a"))}\n`]);
    const result = await deleteRunRecords(stateRoot, doomed);
    assert.equal(existsSync(observed), false, "stale p50 aggregate must not survive the delete");
    assert.ok(result.removedPaths.includes(observed));
  });
});
