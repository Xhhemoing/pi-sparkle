import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { EvaluationPlan } from "../../../src/adaptation/candidate.js";
import {
  evalRoutingPolicy,
  ROUTING_EVALUATOR_VERSION
} from "../../../src/adaptation/eval-routing.js";
import { loadAdaptationRegistry, saveAdaptationRegistry } from "../../../src/adaptation/promotion.js";
import { ResourceRegistry } from "../../../src/adaptation/registry.js";
import type { AuthorIdentity, ResourceIdentity, ResourceKind } from "../../../src/adaptation/resource.js";
import { createProjectId, type IdGenerator } from "../../../src/domain/ids.js";
import type { IsoTimestamp } from "../../../src/domain/timestamp.js";
import { validateComparisonReport } from "../../../src/experiments/comparison-report.js";
import { replayCacheKey } from "../../../src/experiments/replay.js";
import { routingPolicyContent, type LearnedRoutingPolicy } from "../../../src/learning/learned-routing.js";

const AUTHOR: AuthorIdentity = { kind: "human", identity: "alice" };
const PLAN: EvaluationPlan = { stages: ["static", "replay"], metrics: ["utility", "cost"], planVersion: 1 };
const NOW = "2026-08-19T00:00:00.000Z" as IsoTimestamp;
const IMPROVE = /improve|outperform|better/i;

function emptyPolicy(): LearnedRoutingPolicy {
  return { primaryModelId: "premium", avoid: [], prefer: [] };
}

function avoidCheapEdit(): LearnedRoutingPolicy {
  return {
    primaryModelId: "premium",
    avoid: [{ modelId: "cheap", family: "edit", reason: "held-out meanScore" }],
    prefer: [{ family: "edit", modelId: "premium" }]
  };
}

function sequentialIds(): IdGenerator {
  let n = 0;
  return () => `eval${String(++n).padStart(4, "0")}`;
}

function routingIdentity(): ResourceIdentity {
  return {
    kind: "routing-policy",
    name: "smart-assign",
    scope: { kind: "project", projectId: createProjectId(() => "eval0001") }
  };
}

async function writeDataset(
  dir: string,
  episodes: readonly {
    readonly episodeHash: string;
    readonly taskId: string;
    readonly role: string;
    readonly objective: string;
    readonly taskFamily?: string;
    readonly taskSuccess?: "PASS" | "FAIL";
    readonly originalWorkspace: string;
  }[],
  environmentVersion = "env-test-1"
): Promise<void> {
  await writeFile(
    join(dir, "manifest.json"),
    JSON.stringify({
      datasetId: "ds-routing-1",
      environmentVersion,
      episodes
    }),
    "utf8"
  );
}

function editEpisode(
  index: number,
  originalWorkspace: string,
  taskSuccess?: "PASS" | "FAIL"
): {
  readonly episodeHash: string;
  readonly taskId: string;
  readonly role: string;
  readonly objective: string;
  readonly taskFamily: string;
  readonly taskSuccess?: "PASS" | "FAIL";
  readonly originalWorkspace: string;
} {
  return {
    episodeHash: `eh-edit-${index}`,
    taskId: `tsk_edit${String(index).padStart(2, "0")}`,
    role: "implementer",
    objective: "Implement the cache layer",
    taskFamily: "edit",
    originalWorkspace,
    ...(taskSuccess !== undefined ? { taskSuccess } : {})
  };
}

async function seedRoutingCandidate(input?: {
  readonly candidatePolicy?: LearnedRoutingPolicy;
  readonly kind?: ResourceKind;
}): Promise<{
  readonly stateRoot: string;
  readonly frozenWorkspace: string;
  readonly datasetDir: string;
  readonly candidateId: string;
  readonly contentHash: string;
  readonly activeVersionId: string;
}> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-eval-state-"));
  const frozenWorkspace = await mkdtemp(join(tmpdir(), "pi-sparkle-eval-frozen-"));
  const datasetDir = await mkdtemp(join(tmpdir(), "pi-sparkle-eval-ds-"));
  const identity: ResourceIdentity = {
    ...routingIdentity(),
    kind: input?.kind ?? "routing-policy"
  };
  const registry = new ResourceRegistry({ now: () => NOW, generateId: sequentialIds() });
  const baselineContent =
    identity.kind === "routing-policy" ? routingPolicyContent(emptyPolicy()) : "v1 prompt";
  const candidateContent =
    identity.kind === "routing-policy"
      ? routingPolicyContent(input?.candidatePolicy ?? avoidCheapEdit())
      : "v2 prompt";
  const baseline = registry.registerBaseline({
    identity,
    content: baselineContent,
    author: AUTHOR
  });
  const candidate = registry.createCandidate({
    identity,
    content: candidateContent,
    parentVersionId: baseline.versionId,
    author: AUTHOR,
    evaluationPlan: PLAN
  });
  await saveAdaptationRegistry(stateRoot, registry);
  return {
    stateRoot,
    frozenWorkspace,
    datasetDir,
    candidateId: candidate.candidateId,
    contentHash: candidate.contentHash,
    activeVersionId: baseline.versionId
  };
}

test("eval cannot emit an improvement claim without a passing comparison validation", async () => {
  const seeded = await seedRoutingCandidate();
  await writeDataset(
    seeded.datasetDir,
    [1, 2, 3].map((index) => editEpisode(index, seeded.frozenWorkspace, "PASS"))
  );

  const { report, reportPath } = await evalRoutingPolicy({
    stateRoot: seeded.stateRoot,
    candidateId: seeded.candidateId,
    datasetDir: seeded.datasetDir
  });

  assert.equal(report.evidenceClass, "replay");
  assert.equal(report.comparison.evidenceClass, "simulation");
  assert.equal(report.comparison.canCloseProductionCheckpointF, false);
  assert.deepEqual([...report.stages], ["static", "replay"]);
  assert.equal(report.comparison.utilityDelta.provisional, true);
  assert.ok(
    !report.comparison.claims.some((claim) => IMPROVE.test(claim)),
    `eval emitted an improvement claim: ${report.comparison.claims.join("; ")}`
  );
  assert.equal(validateComparisonReport(report.comparison).valid, true);

  const spoofed = {
    ...report.comparison,
    claims: ["candidate improves quality"]
  };
  const spoofedValidation = validateComparisonReport(spoofed);
  assert.equal(spoofedValidation.valid, false);
  assert.ok(spoofedValidation.reasons.some((reason) => /provisional|exclude zero|improve/i.test(reason)));

  const persisted = JSON.parse(await readFile(reportPath, "utf8")) as typeof report;
  assert.ok(!persisted.comparison.claims.some((claim) => IMPROVE.test(claim)));

  const registry = await loadAdaptationRegistry(seeded.stateRoot);
  assert.equal(registry.getActiveVersion(routingIdentity())?.versionId, seeded.activeVersionId);
});

test("report publication exposes the previous or new complete report at the rename seam", async () => {
  const seeded = await seedRoutingCandidate();
  await writeDataset(seeded.datasetDir, [editEpisode(1, seeded.frozenWorkspace, "PASS")]);
  const previous = await evalRoutingPolicy({
    stateRoot: seeded.stateRoot,
    candidateId: seeded.candidateId,
    datasetDir: seeded.datasetDir
  });
  const previousBytes = await readFile(previous.reportPath, "utf8");

  await writeDataset(seeded.datasetDir, [editEpisode(1, seeded.frozenWorkspace, "FAIL")]);
  let signalRename!: (value: {
    readonly source: string;
    readonly destination: string;
    readonly tempBytes: string;
  }) => void;
  let rejectRename!: (reason?: unknown) => void;
  const renameReached = new Promise<{
    readonly source: string;
    readonly destination: string;
    readonly tempBytes: string;
  }>((resolve, reject) => {
    signalRename = resolve;
    rejectRename = reject;
  });
  let releaseRename!: () => void;
  const renameAllowed = new Promise<void>((resolve) => {
    releaseRename = resolve;
  });

  const publishing = evalRoutingPolicy(
    {
      stateRoot: seeded.stateRoot,
      candidateId: seeded.candidateId,
      datasetDir: seeded.datasetDir
    },
    {
      uniqueSuffix: () => "rename-seam",
      rename: async (source, destination) => {
        try {
          signalRename({ source, destination, tempBytes: await readFile(source, "utf8") });
          await renameAllowed;
          await rename(source, destination);
        } catch (error: unknown) {
          rejectRename(error);
          throw error;
        }
      }
    }
  );
  const seam = await Promise.race([
    renameReached,
    publishing.then(() => {
      throw new Error("report published without reaching the atomic rename seam");
    })
  ]);
  const whileRenamePaused = await readFile(previous.reportPath, "utf8");
  releaseRename();
  const next = await publishing;
  const publishedBytes = await readFile(next.reportPath, "utf8");

  assert.equal(seam.destination, previous.reportPath);
  assert.notEqual(seam.source, seam.destination);
  assert.notEqual(seam.tempBytes, previousBytes);
  assert.equal(whileRenamePaused, previousBytes);
  assert.equal(publishedBytes, seam.tempBytes);
  for (const observed of [whileRenamePaused, publishedBytes]) {
    assert.ok(
      observed === previousBytes || observed === seam.tempBytes,
      "destination exposed bytes other than one complete report"
    );
    assert.doesNotThrow(() => JSON.parse(observed));
  }
});

test("cacheKey follows replayCacheKey and changes with contentHash", async () => {
  const first = await seedRoutingCandidate({ candidatePolicy: avoidCheapEdit() });
  await writeDataset(
    first.datasetDir,
    [1, 2].map((index) => editEpisode(index, first.frozenWorkspace, "PASS"))
  );
  const firstEval = await evalRoutingPolicy({
    stateRoot: first.stateRoot,
    candidateId: first.candidateId,
    datasetDir: first.datasetDir
  });
  const expected = replayCacheKey({
    runId: "ds-routing-1",
    candidateHash: first.contentHash,
    environmentVersion: "env-test-1",
    evaluatorVersion: ROUTING_EVALUATOR_VERSION
  });
  assert.equal(firstEval.report.cacheKey, expected);
  assert.equal(firstEval.report.contentHash, first.contentHash);
  assert.equal(firstEval.report.environmentVersion, "env-test-1");
  assert.equal(firstEval.report.evaluatorVersion, ROUTING_EVALUATOR_VERSION);
  assert.ok(firstEval.report.rerunHash.length > 0);

  const repeat = await evalRoutingPolicy({
    stateRoot: first.stateRoot,
    candidateId: first.candidateId,
    datasetDir: first.datasetDir
  });
  assert.equal(repeat.report.cacheKey, firstEval.report.cacheKey);
  assert.equal(repeat.report.rerunHash, firstEval.report.rerunHash);

  const second = await seedRoutingCandidate({
    candidatePolicy: {
      primaryModelId: "premium",
      avoid: [{ modelId: "cheap", family: "edit", reason: "different candidate" }],
      prefer: [{ family: "edit", modelId: "premium" }]
    }
  });
  await writeDataset(
    second.datasetDir,
    [1, 2].map((index) => editEpisode(index, second.frozenWorkspace, "PASS"))
  );
  const secondEval = await evalRoutingPolicy({
    stateRoot: second.stateRoot,
    candidateId: second.candidateId,
    datasetDir: second.datasetDir
  });
  assert.notEqual(second.contentHash, first.contentHash);
  assert.notEqual(secondEval.report.cacheKey, firstEval.report.cacheKey);
  assert.equal(
    secondEval.report.cacheKey,
    replayCacheKey({
      runId: "ds-routing-1",
      candidateHash: second.contentHash,
      environmentVersion: "env-test-1",
      evaluatorVersion: ROUTING_EVALUATOR_VERSION
    })
  );
});

test("paired records use only recorded PASS/FAIL and never invent PASS", async () => {
  const seeded = await seedRoutingCandidate();
  await writeDataset(seeded.datasetDir, [
    editEpisode(1, seeded.frozenWorkspace, "PASS"),
    editEpisode(2, seeded.frozenWorkspace, "FAIL"),
    editEpisode(3, seeded.frozenWorkspace)
  ]);

  const { report } = await evalRoutingPolicy({
    stateRoot: seeded.stateRoot,
    candidateId: seeded.candidateId,
    datasetDir: seeded.datasetDir
  });

  assert.equal(report.comparison.rawCounts.episodes, 2);
  assert.equal(report.comparison.evaluationCard.baseline.utility, 0.5);
  assert.equal(report.comparison.evaluationCard.candidate.utility, 0.5);
  assert.ok(report.comparison.evaluationCard.baseline.costUsd < report.comparison.evaluationCard.candidate.costUsd);
});

test("n < 5 marks utilityDelta provisional and strips improvement language", async () => {
  const seeded = await seedRoutingCandidate();
  await writeDataset(
    seeded.datasetDir,
    [1, 2, 3, 4].map((index) => editEpisode(index, seeded.frozenWorkspace, "PASS"))
  );
  const { report } = await evalRoutingPolicy({
    stateRoot: seeded.stateRoot,
    candidateId: seeded.candidateId,
    datasetDir: seeded.datasetDir
  });
  assert.equal(report.comparison.utilityDelta.provisional, true);
  assert.ok(!report.comparison.claims.some((claim) => IMPROVE.test(claim)));
});

test("five paired PASS records still cannot claim improvement without a valid comparison", async () => {
  const seeded = await seedRoutingCandidate();
  await writeDataset(
    seeded.datasetDir,
    [1, 2, 3, 4, 5].map((index) => editEpisode(index, seeded.frozenWorkspace, "PASS"))
  );
  const { report } = await evalRoutingPolicy({
    stateRoot: seeded.stateRoot,
    candidateId: seeded.candidateId,
    datasetDir: seeded.datasetDir
  });
  assert.equal(report.comparison.utilityDelta.provisional, false);
  assert.ok(report.comparison.utilityDelta.confidenceInterval !== undefined);
  assert.equal(report.comparison.evidenceClass, "simulation");
  assert.equal(report.comparison.canCloseProductionCheckpointF, false);
  assert.ok(!report.comparison.claims.some((claim) => IMPROVE.test(claim)));
  assert.equal(validateComparisonReport(report.comparison).valid, true);
  const spoofed = { ...report.comparison, claims: ["candidate outperforms baseline"] };
  assert.equal(validateComparisonReport(spoofed).valid, false);
});

test("static stage rejects permission and credential fields", async () => {
  const seeded = await seedRoutingCandidate({
    candidatePolicy: {
      ...avoidCheapEdit(),
      apiKey: "sk-test"
    } as LearnedRoutingPolicy & { apiKey: string }
  });
  await writeDataset(seeded.datasetDir, [editEpisode(1, seeded.frozenWorkspace, "PASS")]);
  await assert.rejects(
    () =>
      evalRoutingPolicy({
        stateRoot: seeded.stateRoot,
        candidateId: seeded.candidateId,
        datasetDir: seeded.datasetDir
      }),
    /apiKey|credential|forbidden/i
  );
});

test("non-routing-policy candidates fail closed", async () => {
  const seeded = await seedRoutingCandidate({ kind: "prompt" });
  await writeDataset(seeded.datasetDir, [editEpisode(1, seeded.frozenWorkspace, "PASS")]);
  await assert.rejects(
    () =>
      evalRoutingPolicy({
        stateRoot: seeded.stateRoot,
        candidateId: seeded.candidateId,
        datasetDir: seeded.datasetDir
      }),
    /routing-policy/
  );
});

/**
 * The exporter stores the redacted project root once on `source` and repeats it
 * per row. This reader keeps the row-level key as its contract and defaults to
 * the manifest-level copy, so an export that stops repeating it still loads;
 * with neither, the refusal still names the row that is missing it.
 */
test("a manifest-level workspace stands in for rows that omit it", async () => {
  const seeded = await seedRoutingCandidate();
  const rows = [1, 2].map((index) => {
    const { originalWorkspace: _dropped, ...rest } = editEpisode(
      index,
      seeded.frozenWorkspace,
      "PASS"
    );
    return rest;
  });
  await writeFile(
    join(seeded.datasetDir, "manifest.json"),
    JSON.stringify({
      datasetId: "ds-routing-source-ws",
      environmentVersion: "env-test-1",
      source: { originalWorkspace: seeded.frozenWorkspace },
      episodes: rows
    }),
    "utf8"
  );

  const { report } = await evalRoutingPolicy({
    stateRoot: seeded.stateRoot,
    candidateId: seeded.candidateId,
    datasetDir: seeded.datasetDir
  });
  assert.equal(report.comparison.rawCounts.episodes, 2);

  await writeFile(
    join(seeded.datasetDir, "manifest.json"),
    JSON.stringify({
      datasetId: "ds-routing-no-ws",
      environmentVersion: "env-test-1",
      episodes: rows
    }),
    "utf8"
  );
  await assert.rejects(
    () =>
      evalRoutingPolicy({
        stateRoot: seeded.stateRoot,
        candidateId: seeded.candidateId,
        datasetDir: seeded.datasetDir
      }),
    /episodes\[0\] requires originalWorkspace/
  );
});

/**
 * A redacted workspace can be a placeholder rather than a directory, so only
 * absolute values are treated as read-only roots — resolving `[path]` against
 * the process working directory would invent a root that never existed. The
 * dataset directory itself is always a root, absolute or not.
 */
test("a redacted workspace marker is not resolved into an isolation root", async () => {
  const seeded = await seedRoutingCandidate();
  await writeDataset(seeded.datasetDir, [editEpisode(1, "[path]", "PASS")]);

  const { report } = await evalRoutingPolicy({
    stateRoot: seeded.stateRoot,
    candidateId: seeded.candidateId,
    datasetDir: seeded.datasetDir
  });
  assert.equal(report.comparison.rawCounts.episodes, 1);
});

test("replay output root must not overlap originalWorkspace", async () => {
  const seeded = await seedRoutingCandidate();
  const evalsDir = join(seeded.stateRoot, "adaptation", "evals");
  await mkdir(evalsDir, { recursive: true });
  await writeDataset(seeded.datasetDir, [editEpisode(1, evalsDir, "PASS")]);
  await assert.rejects(
    () =>
      evalRoutingPolicy({
        stateRoot: seeded.stateRoot,
        candidateId: seeded.candidateId,
        datasetDir: seeded.datasetDir
      }),
    /overlap|isolat/i
  );
});

test("eval-routing and adapt CLI do not import r1, bandit, shadow, or topology", async () => {
  const files = [
    new URL("../../../src/adaptation/eval-routing.ts", import.meta.url),
    new URL("../../../src/cli/adapt.ts", import.meta.url)
  ];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    assert.doesNotMatch(text, /routing\/r1/, `${file.pathname} must not import R1`);
    assert.doesNotMatch(text, /routing\/bandit/, `${file.pathname} must not import bandit`);
    assert.doesNotMatch(text, /routing\/shadow/, `${file.pathname} must not import shadow`);
    assert.doesNotMatch(text, /routing\/topology/, `${file.pathname} must not import topology`);
  }
});
