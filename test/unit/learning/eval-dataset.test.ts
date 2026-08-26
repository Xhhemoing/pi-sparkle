import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
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
import { redactSensitiveText } from "../../../src/feedback/redaction.js";
import {
  exportRoutingEvalDataset,
  OBJECTIVE_MAX_CHARS,
  type EvalDatasetManifest
} from "../../../src/learning/eval-dataset.js";
import { routingPolicyContent } from "../../../src/learning/learned-routing.js";
import {
  assertDefaultEvalDatasetPublished,
  bindDefaultEvalDatasetDir,
  EVAL_DATASET_ALIAS_CODE,
  EvalDatasetAliasError,
  type BoundEvalDatasetDir
} from "../../../src/privacy/eval-dataset-path.js";
import { durableRecordClassById } from "../../../src/privacy/record-classes.js";
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

/** A proposed routing candidate `adapt eval` can replay an export against. */
async function seedRoutingCandidate(stateRoot: string): Promise<{ candidateId: string }> {
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
  return { candidateId: candidate.candidateId };
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
  // The workspace is stored once on the manifest and repeated verbatim on
  // every row; the rows are one run's routed tasks, which the manifest says
  // in as many words rather than leaving a reader to assume independence.
  assert.equal(manifest.source.rowKind, "routed-task-from-one-run");
  assert.equal(manifest.source.originalWorkspace, workspace);
  for (const episode of manifest.episodes) {
    assert.equal(episode.role, "implementer");
    assert.equal(episode.originalWorkspace, manifest.source.originalWorkspace);
    assert.match(episode.episodeHash, /^eh_/);
  }

  // The only state the export produced is the dataset itself: no registry, no
  // bandit, no learned policy.
  assert.deepEqual(await readdir(join(stateRoot, "adaptation")), ["eval-datasets"]);

  // The report only proves the manifest is loadable by the evaluator; the
  // candidate stays proposed and the pointer stays put.
  const { candidateId } = await seedRoutingCandidate(stateRoot);

  const evaluated = await evalRoutingPolicy({
    stateRoot,
    candidateId,
    datasetDir: exported.datasetDir
  });
  assert.equal(evaluated.report.comparison.rawCounts.episodes, 2);
  assert.equal(evaluated.report.environmentVersion, manifest.environmentVersion);
  assert.equal(evaluated.report.evidenceClass, "replay");
});

/**
 * D1 (GPT-r2): the exporter used to excerpt first and redact the excerpt, so a
 * cut that landed inside a secret left a fragment no rule could match — the
 * quoted keyed-secret rule needs its closing quote, the bearer rule needs
 * eight characters of token, and an email needs its domain. Every case below
 * puts the 500-character boundary inside the value, and none of the surviving
 * fragments may reach disk.
 */
const BOUNDARY_CASES: ReadonlyArray<{
  readonly name: string;
  readonly taskId: TaskId;
  readonly before: string;
  readonly value: string;
  readonly after: string;
  /** How many characters of `value` the old excerpt-first cut left behind. */
  readonly survivingChars: number;
  readonly placeholder: RegExp;
}> = [
  {
    name: "quoted keyed secret",
    taskId: parseTaskId("tsk_dsb01"),
    before: 'api_key="',
    value: "SUPERSECRETVALUE1234",
    after: '" and then ship it',
    survivingChars: 5,
    placeholder: /\[secret\]/
  },
  {
    name: "bearer token",
    taskId: parseTaskId("tsk_dsb02"),
    before: "Authorization: Bearer ",
    value: "abcdefghij0123456789KLMNOP",
    after: " and then ship it",
    survivingChars: 5,
    placeholder: /Bearer \[secret\]/
  },
  {
    name: "PEM private key",
    taskId: parseTaskId("tsk_dsb03"),
    before: "-----BEGIN PRIVATE KEY-----\n",
    value: "MIIBVQIBADANBgkqhkiG9w0BAQEFAASCAT8wggE7AgEAAkEA",
    after: "\n-----END PRIVATE KEY-----",
    survivingChars: 12,
    placeholder: /\[secret\]/
  },
  {
    name: "email address",
    taskId: parseTaskId("tsk_dsb04"),
    before: "ask ",
    value: "maria@example.com",
    after: " about the rollout",
    survivingChars: 6,
    placeholder: /\[email\]/
  },
  {
    name: "home directory path",
    taskId: parseTaskId("tsk_dsb05"),
    before: "read ",
    value: "/home/maria/secrets/app",
    after: " before starting",
    survivingChars: 8,
    placeholder: /\[path\]/
  }
];

function straddlingObjective(input: {
  readonly before: string;
  readonly value: string;
  readonly after: string;
  readonly survivingChars: number;
}): string {
  const padding = OBJECTIVE_MAX_CHARS - input.survivingChars - input.before.length;
  assert.ok(padding > 1, "the boundary must fall inside the value, not before it");
  return `${"y".repeat(padding - 1)} ${input.before}${input.value}${input.after}`;
}

test("a secret straddling the excerpt boundary is redacted, not clipped in half", async () => {
  const { stateRoot, workspace } = await dirs();
  const runId = createRunId();
  const tasks: TaskFixture[] = BOUNDARY_CASES.map((boundary) => ({
    taskId: boundary.taskId,
    objective: straddlingObjective(boundary),
    outcome: "PASS" as const
  }));

  const exported = await exportRoutingEvalDataset({
    stateRoot,
    runId,
    events: routedRun(runId, workspace, tasks)
  });

  const bytes = await readFile(exported.manifestPath, "utf8");
  const manifest = await readManifest(exported.manifestPath);
  for (const [index, boundary] of BOUNDARY_CASES.entries()) {
    const episode = manifest.episodes[index];
    assert.ok(episode !== undefined, boundary.name);
    assert.equal(episode.taskId, boundary.taskId);
    const clipped = boundary.value.slice(0, boundary.survivingChars);
    assert.ok(
      !bytes.includes(clipped),
      `${boundary.name}: the fragment left by the cut (${clipped}) reached the dataset`
    );
    assert.ok(!bytes.includes(boundary.value), `${boundary.name}: the whole value reached the dataset`);
    // What "redact, then excerpt" means, stated as an invariant: the stored
    // text is a prefix of the redaction of the whole objective. (The excerpt
    // can end mid-placeholder, which is a clipped `[secret]`, not a value.)
    const redacted = redactSensitiveText(tasks[index]?.objective ?? "").text;
    assert.match(redacted, boundary.placeholder, boundary.name);
    assert.ok(
      redacted.startsWith(episode.objective),
      `${boundary.name}: the stored text is not an excerpt of the redacted objective`
    );
    assert.ok(
      episode.objective.length <= OBJECTIVE_MAX_CHARS,
      `${boundary.name}: the excerpt is still bounded`
    );
  }
  assert.deepEqual([...manifest.source.redactionClasses], ["path", "pii", "secret"]);
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

/**
 * D2 (GPT-r2): the project root used to be copied onto every row verbatim,
 * while the record class called the objective the only user text. Workspace
 * paths carry usernames, customer and repository names, and organization
 * layout, so the root now goes through the same best-effort pass as the
 * objective, is stored once on the manifest, and is declared sensitive.
 */
test("the recorded project root is redacted before it reaches the dataset", async () => {
  const { stateRoot } = await dirs();
  const runId = createRunId();
  const workspace = "/home/maria/customers/acme-corp/checkout";

  const exported = await exportRoutingEvalDataset({
    stateRoot,
    runId,
    events: routedRun(runId, workspace, editTasks(2))
  });

  const bytes = await readFile(exported.manifestPath, "utf8");
  assert.ok(!bytes.includes("maria"), "the raw project root reached the exported dataset");
  assert.ok(!bytes.includes("acme-corp"), "the customer name reached the exported dataset");

  const manifest = await readManifest(exported.manifestPath);
  assert.equal(manifest.source.originalWorkspace, "[path]");
  for (const episode of manifest.episodes) {
    assert.equal(episode.originalWorkspace, manifest.source.originalWorkspace);
  }
  assert.ok([...manifest.source.redactionClasses].includes("path"));

  // The class must not go back to claiming the objective is the only user text.
  const recordClass = durableRecordClassById("routing-eval-dataset");
  assert.ok(recordClass);
  assert.ok(
    recordClass.sensitiveFields.some((field) => field.startsWith("originalWorkspace")),
    "the workspace path is stored but not declared sensitive"
  );
});

test("a redacted workspace still loads through adapt eval", async () => {
  const { stateRoot } = await dirs();
  const runId = createRunId();
  const exported = await exportRoutingEvalDataset({
    stateRoot,
    runId,
    events: routedRun(runId, "/home/maria/customers/acme-corp/checkout", editTasks(2))
  });

  const { candidateId } = await seedRoutingCandidate(stateRoot);
  const evaluated = await evalRoutingPolicy({
    stateRoot,
    candidateId,
    datasetDir: exported.datasetDir
  });

  assert.equal(evaluated.report.comparison.rawCounts.episodes, 2);
});

/**
 * D4 (GPT-r2): `--dir` used to be checked only against the recorded workspace,
 * so an adaptation-plane dataset could be written into the runtime plane the
 * layout says it can never share a directory with — and the lexical check
 * missed even that through a symlink.
 */
test("--dir is refused when it lands in the runtime plane, symlinks included", async () => {
  const { stateRoot, workspace } = await dirs();
  const runId = createRunId();
  const events = routedRun(runId, workspace, editTasks(1));
  const inside = join(stateRoot, "runtime", "runs", runId, "dataset");

  await assert.rejects(
    () => exportRoutingEvalDataset({ stateRoot, runId, events, datasetDir: inside }),
    /must not be written into the runtime plane/
  );
  assert.equal(existsSync(inside), false);

  // A path that only reaches the runtime plane through a symlink resolves to
  // the same refusal: the guard canonicalizes before it compares.
  const linkParent = await mkdtemp(join(tmpdir(), "pi-sparkle-ds-link-"));
  await mkdir(join(stateRoot, "runtime"), { recursive: true });
  const link = join(linkParent, "runtime-link");
  await symlink(join(stateRoot, "runtime"), link, "dir");
  await assert.rejects(
    () =>
      exportRoutingEvalDataset({
        stateRoot,
        runId,
        events,
        datasetDir: join(link, "smuggled-dataset")
      }),
    /must not be written into the runtime plane/
  );
  assert.equal(existsSync(join(link, "smuggled-dataset")), false);

  // A --dir that contains the whole state root would swallow the runtime plane
  // as well, and is refused for the same reason.
  await assert.rejects(
    () => exportRoutingEvalDataset({ stateRoot, runId, events, datasetDir: stateRoot }),
    /must not be written into the runtime plane/
  );

  // The adaptation plane is still a legal destination.
  const allowed = join(stateRoot, "adaptation", "exports", "custom");
  const exported = await exportRoutingEvalDataset({ stateRoot, runId, events, datasetDir: allowed });
  assert.equal(exported.datasetDir, allowed);
});

/**
 * D18: a default export has no `--dir` warning behind it, so it may not
 * produce an external copy at all.
 *
 * The exporter canonicalized `adaptation/eval-datasets/<runId>` for its
 * isolation checks and then wrote `manifest.json` at the lexical path, i.e.
 * straight through a symlink pre-created at the leaf. `delete --run` could
 * only unlink that alias afterwards, so the redacted objective excerpt and
 * redacted project root stayed on disk outside the plane while the delete
 * reported the default directory as removed. The leaf is now `lstat`ed — what
 * it *is*, not what it points at.
 */
test("a default export refuses a <runId> leaf that is a symlink", async () => {
  const { stateRoot, workspace } = await dirs();
  const runId = createRunId();
  const events = routedRun(runId, workspace, editTasks(2));
  const external = await mkdtemp(join(tmpdir(), "pi-sparkle-ds-external-"));
  const datasetDir = join(stateRoot, "adaptation", "eval-datasets", runId);
  await mkdir(join(stateRoot, "adaptation", "eval-datasets"), { recursive: true });
  await symlink(external, datasetDir, "junction");

  await assert.rejects(
    () => exportRoutingEvalDataset({ stateRoot, runId, events }),
    (error: unknown) => {
      assert.ok(error instanceof EvalDatasetAliasError, String(error));
      assert.equal(error.code, EVAL_DATASET_ALIAS_CODE);
      assert.equal(error.stage, "export");
      assert.equal(error.datasetDir, datasetDir);
      assert.ok(error.message.includes(external), error.message);
      return true;
    }
  );
  assert.deepEqual(await readdir(external), [], "the refused export wrote through the alias");

  // Refused, not repaired: an export must not silently replace a link the
  // operator put there, and the delete has to be able to see it too.
  assert.equal((await lstat(datasetDir)).isSymbolicLink(), true);

  // With the alias gone the same export is ordinary, and lands on a real
  // directory bound to the canonical eval-datasets root.
  await rm(datasetDir, { force: true });
  const exported = await exportRoutingEvalDataset({ stateRoot, runId, events });
  assert.equal(exported.datasetDir, datasetDir);
  assert.equal((await lstat(datasetDir)).isDirectory(), true);
  assert.equal(await realpath(datasetDir), datasetDir);
  assert.deepEqual(await readdir(external), []);
});

/**
 * The leaf is created with a non-recursive `mkdir`, so a link planted before
 * the export is refused rather than adopted; one planted after the bind is
 * caught by the re-assert that follows the publish, which also takes back the
 * bytes it can prove it wrote. Node has no directory-relative publish, so this
 * is a detected failure, not a held handle — and it says so instead of
 * reporting a path that does not hold the manifest.
 */
test("a leaf swapped for a symlink during the publish fails loudly and takes its bytes back", async () => {
  const { stateRoot, workspace } = await dirs();
  const runId = createRunId();
  const events = routedRun(runId, workspace, editTasks(1));
  const external = await mkdtemp(join(tmpdir(), "pi-sparkle-ds-swap-"));
  const datasetDir = join(stateRoot, "adaptation", "eval-datasets", runId);

  await assert.rejects(
    () =>
      exportRoutingEvalDataset(
        { stateRoot, runId, events },
        {
          // The rename that publishes the manifest is the last thing the write
          // does, so swapping the bound directory here is the tightest window
          // a caller can reach.
          rename: async (source, destination) => {
            const bytes = await readFile(source, "utf8");
            await rm(datasetDir, { recursive: true, force: true });
            await symlink(external, datasetDir, "junction");
            // What a publish into a swapped leaf does: the destination path is
            // unchanged, and it now resolves outside the plane.
            await writeFile(destination, bytes, "utf8");
          }
        }
      ),
    (error: unknown) => {
      assert.ok(error instanceof EvalDatasetAliasError, String(error));
      assert.equal(error.stage, "publish");
      return true;
    }
  );
  assert.deepEqual(
    await readdir(external),
    [],
    "the manifest published through the swapped alias was left outside the plane"
  );
});

/**
 * D19: the swap does not have to be a symlink.
 *
 * The post-publish check used to compare canonical pathnames — `realpath(leaf)
 * === join(realpath(container), runId)` — which a *fresh real directory*
 * created at the same `<runId>` name satisfies exactly as well as the
 * directory that received the bytes. The export then returned success with a
 * `manifestPath` that contained nothing, which is the one thing this whole
 * binding exists to prevent. The bind now records the directory's identity and
 * the publish re-reads it, so a replacement cannot pass as the original.
 */
test("a leaf replaced by another real directory during the publish is not accepted", async () => {
  const { stateRoot, workspace } = await dirs();
  const runId = createRunId();
  const events = routedRun(runId, workspace, editTasks(1));
  const datasetDir = join(stateRoot, "adaptation", "eval-datasets", runId);
  const displaced = join(stateRoot, "adaptation", "displaced-leaf");

  await assert.rejects(
    () =>
      exportRoutingEvalDataset(
        { stateRoot, runId, events },
        {
          rename: async (source, destination) => {
            // The real publish happens first, into the bound directory, so the
            // manifest genuinely exists before the leaf is swapped.
            await rename(source, destination);
            await rename(datasetDir, displaced);
            await mkdir(datasetDir);
          }
        }
      ),
    (error: unknown) => {
      assert.ok(error instanceof EvalDatasetAliasError, String(error));
      assert.equal(error.code, EVAL_DATASET_ALIAS_CODE);
      assert.equal(error.stage, "publish");
      assert.equal(error.datasetDir, datasetDir);
      assert.equal(error.linkTarget, undefined, "nothing here is a symlink");
      return true;
    }
  );

  // Returning this path with the manifest missing from it is the bug; the
  // refusal is what makes the absence honest.
  assert.equal((await lstat(datasetDir)).isDirectory(), true);
  assert.equal(existsSync(join(datasetDir, "manifest.json")), false);

  // Take-back only reaches the lexical path, and the bytes left with the
  // directory that was renamed out from under it. The error says so rather
  // than claiming a cleanup it did not perform.
  assert.equal(existsSync(join(displaced, "manifest.json")), true);
  const orphan = await readManifest(join(displaced, "manifest.json"));
  assert.equal(orphan.source.runId, runId);
});

/**
 * D23: identity read at the two endpoints is not the claim the return value
 * makes.
 *
 * The bound directory can be moved aside, a replacement can take the manifest
 * at the same `<runId>` name, the replacement can leave with it, and the
 * original can be put back before the post-publish check reads it. `dev`/`ino`
 * then match — it is literally the bound directory — and the export used to
 * return success for a `manifestPath` that does not exist. The check now also
 * asks whether the manifest is in the directory whose identity it just proved.
 */
test("a bound directory restored empty after the publish landed elsewhere is not accepted", async () => {
  const { stateRoot, workspace } = await dirs();
  const runId = createRunId();
  const events = routedRun(runId, workspace, editTasks(1));
  const datasetDir = join(stateRoot, "adaptation", "eval-datasets", runId);
  const parked = join(stateRoot, "adaptation", "parked-bound-leaf");
  const displaced = join(stateRoot, "adaptation", "displaced-replacement");

  await assert.rejects(
    () =>
      exportRoutingEvalDataset(
        { stateRoot, runId, events },
        {
          rename: async (source, destination) => {
            // 1. The bound leaf is moved aside, taking the atomic temp file
            //    with it — the temp lives in the directory being published to.
            await rename(datasetDir, parked);
            // 2. A replacement directory is created at the same lexical path.
            await mkdir(datasetDir);
            // 3. The temp file is moved into the replacement as manifest.json,
            //    so the publish really does land, just not where it will be
            //    reported as landing.
            await rename(join(parked, basename(source)), destination);
            // 4. The replacement leaves, manifest included.
            await rename(datasetDir, displaced);
            // 5. The originally bound directory is restored, so the endpoint
            //    identity is the one the bind accepted.
            await rename(parked, datasetDir);
          }
        }
      ),
    (error: unknown) => {
      assert.ok(error instanceof EvalDatasetAliasError, String(error));
      assert.equal(error.code, EVAL_DATASET_ALIAS_CODE);
      assert.equal(error.stage, "publish");
      assert.equal(error.datasetDir, datasetDir);
      assert.equal(error.linkTarget, undefined, "nothing here is a symlink");
      return true;
    }
  );

  // The directory the caller would have been handed back is the bound one and
  // is empty; returning it as a successful export is exactly the false claim.
  assert.equal((await lstat(datasetDir)).isDirectory(), true);
  assert.equal(
    existsSync(join(datasetDir, "manifest.json")),
    false,
    "the returned path holds no manifest, which is why the export must reject"
  );

  // Take-back is lexical, so the manifest stays where it actually went. The
  // refusal names the absence rather than searching for the displaced copy.
  assert.equal(existsSync(join(displaced, "manifest.json")), true);
  assert.equal((await readManifest(join(displaced, "manifest.json"))).source.runId, runId);
});

/**
 * `dev`/`ino` is the identity wherever the platform has one, but libuv reports
 * `ino === 0` on volumes that expose no file index (Windows network shares,
 * some non-NTFS mounts), and a zero is not an identity. The documented
 * equivalent is a uniquely named file the bind drops inside the directory it
 * bound: a replacement directory created at the same name during the publish
 * cannot contain it. This exercises that branch directly, because no test can
 * make a POSIX filesystem stop handing out inode numbers.
 */
test("the witness fallback distinguishes the bound directory where no inode is reported", async () => {
  const { stateRoot } = await dirs();
  const runId = createRunId();
  const bound = await bindDefaultEvalDatasetDir(stateRoot, runId);
  if (process.platform !== "win32") {
    assert.equal(bound.identity.kind, "inode", "a POSIX bind holds dev/ino, not a witness");
  }

  const file = join(bound.path, ".pi-sparkle-bind-witness-fixture");
  await writeFile(file, "", { flag: "wx", mode: 0o600 });
  const witnessBinding: BoundEvalDatasetDir = {
    path: bound.path,
    identity: { kind: "witness", file }
  };
  // The assertion also requires the published manifest, so the directory has
  // to look like one a publish actually landed in for the identity branch to
  // be what is under test here.
  await writeFile(join(bound.path, "manifest.json"), "{}\n", { mode: 0o600 });

  await assertDefaultEvalDatasetPublished(stateRoot, runId, witnessBinding);
  assert.equal(existsSync(file), false, "the witness is consumed once it has been read");

  await writeFile(file, "", { flag: "wx", mode: 0o600 });
  await rm(bound.path, { recursive: true, force: true });
  await mkdir(bound.path);
  await assert.rejects(
    () => assertDefaultEvalDatasetPublished(stateRoot, runId, witnessBinding),
    (error: unknown) => {
      assert.ok(error instanceof EvalDatasetAliasError, String(error));
      assert.equal(error.stage, "publish");
      return true;
    }
  );
});

/**
 * The post-publish question is "is the manifest here", not "is something
 * here": a directory or a symlink at `manifest.json` is not a manifest a
 * reader can parse, and a returned path that names one is the same false
 * claim as a returned path that names nothing.
 */
test("the bound directory must hold manifest.json as a regular file", async () => {
  const { stateRoot } = await dirs();
  const rejects = async (bound: BoundEvalDatasetDir, runId: string): Promise<void> => {
    await assert.rejects(
      () => assertDefaultEvalDatasetPublished(stateRoot, runId, bound),
      (error: unknown) => {
        assert.ok(error instanceof EvalDatasetAliasError, String(error));
        assert.equal(error.code, EVAL_DATASET_ALIAS_CODE);
        assert.equal(error.stage, "publish");
        assert.equal(error.datasetDir, bound.path);
        return true;
      }
    );
  };

  const empty = createRunId();
  await rejects(await bindDefaultEvalDatasetDir(stateRoot, empty), empty);

  const asDirectory = createRunId();
  const directoryBound = await bindDefaultEvalDatasetDir(stateRoot, asDirectory);
  await mkdir(join(directoryBound.path, "manifest.json"));
  await rejects(directoryBound, asDirectory);

  const asLink = createRunId();
  const linkBound = await bindDefaultEvalDatasetDir(stateRoot, asLink);
  const elsewhere = join(stateRoot, "adaptation", "elsewhere-manifest.json");
  await writeFile(elsewhere, "{}\n", { mode: 0o600 });
  await symlink(elsewhere, join(linkBound.path, "manifest.json"));
  await rejects(linkBound, asLink);
});

test("the manifest is published owner-only", { skip: process.platform === "win32" }, async () => {
  const { stateRoot, workspace } = await dirs();
  const runId = createRunId();

  const exported = await exportRoutingEvalDataset({
    stateRoot,
    runId,
    events: routedRun(runId, workspace, editTasks(1))
  });

  const mode = (await stat(exported.manifestPath)).mode & 0o777;
  assert.equal(mode.toString(8), "600");
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
