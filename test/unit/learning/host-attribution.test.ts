import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { createEvidenceId, createInvocationId, createMessageId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import type { AgentExecutionRequest, ExecutionEvent } from "../../../src/execution/contract.js";
import { prepareTrustedVerification } from "../../../src/execution/trusted-verification.js";
import { prepareHostAttribution as project } from "../../../src/learning/host-attribution.js";
import type { NativeHostObservation } from "../../../src/native/host-outcome.js";
import { NativeWriteSession, isNativeHostObservation } from "../../../src/native/write-session.js";
import type { ModelInvocation } from "../../../src/telemetry/model-invocation.js";

const evaluator = { evaluatorId: "node-checker", evaluatorVersion: "1", rubricId: "value-good", rubricVersion: "1",
  evaluatorDefinitionCanonicalJson: '{"accept":"exit 0","modelFailure":[1]}', modelFailureExitCodes: [1] };
const checkerArgs = ["-e", "process.exit(require('node:fs').readFileSync('value.txt','utf8')==='good'?0:1)"];
let root: string;
let repo: string;
let complete: NativeHostObservation;
let repair: NativeHostObservation;
let unknownVersion: NativeHostObservation;
let mixedVersion: NativeHostObservation;
let unknownProvenance: NativeHostObservation;
let mixedProvenance: NativeHostObservation;
let providerError: NativeHostObservation;
let failed: NativeHostObservation;
let collision: NativeHostObservation;

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
}
function success(request: AgentExecutionRequest): ExecutionEvent {
  const evidenceId = createEvidenceId();
  return { type: "MESSAGE", message: { protocolVersion: 1, id: createMessageId(), occurredAt: nowIso(),
    runId: request.runId, taskId: request.taskId, from: request.agentInstanceId, to: "SUPERVISOR", type: "TASK_RESULT",
    outcome: "SUCCESS", summary: "fixture result", artifactIds: [], evidenceIds: [evidenceId],
    verification: { kind: "PASSED", evidenceIds: [evidenceId] } } };
}
interface FixtureOptions {
  readonly values?: readonly string[];
  readonly versions?: readonly (string | undefined)[];
  readonly classes?: readonly ("faux" | undefined)[];
  readonly callOutcome?: "ok" | "error";
  readonly sharedId?: ModelInvocation["id"];
  readonly partialUsage?: boolean;
}
async function issue(options: FixtureOptions = {}): Promise<NativeHostObservation> {
  let attempt = 0;
  const session = new NativeWriteSession({ stateRoot: path.join(root, "state"), sandboxRoot: path.join(root, "candidates"), hostEvaluator: evaluator,
    executorFactory: (context) => {
      const index = attempt++;
      return { async *execute(request: AgentExecutionRequest): AsyncIterable<ExecutionEvent> {
        const classes = options.classes ?? ["faux"];
        const count = options.partialUsage ? 2 : classes.length;
        for (let rowIndex = 0; rowIndex < count; rowIndex++) {
          const row: ModelInvocation = {
            id: rowIndex === 0 ? options.sharedId ?? createInvocationId() : createInvocationId(),
            taskId: request.taskId, runId: request.runId, agentInstanceId: request.agentInstanceId,
            config: { provider: "faux", model: "fixture", modelVersion: options.versions === undefined ? "2026-10" : options.versions[index], parameterHash: "a" },
            responseHash: "b", tokensIn: rowIndex === 0 ? 100 : undefined, tokensOut: rowIndex === 0 ? 50 : undefined,
            latencyMs: 1, occurredAt: nowIso(), callOutcome: options.callOutcome ?? "ok",
            ...(classes[rowIndex] === undefined ? {} : { executorClass: classes[rowIndex] }),
            ...(rowIndex === 0 ? { pricing: { catalogVersion: "test-estimate", inputUsdPerMTok: 2, outputUsdPerMTok: 4 } } : {})
          };
          // Deterministic execution always stays faux (or explicitly unknown).
          context.onInvocation(row);
        }
        await context.tools.find((tool) => tool.name === "sparkle_write_file")!.execute("write", {
          path: "value.txt", contents: options.values?.[index] ?? "good"
        });
        yield success(request);
        yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
      } };
    } });
  const values = options.values ?? ["good"];
  const result = await session.execute({ sourceRepo: repo, objective: "produce good value", maxAttempts: values.length,
    verification: { command: process.execPath, args: checkerArgs,
      trustedVerification: prepareTrustedVerification({ command: process.execPath, args: checkerArgs }) } });
  assert.ok(isNativeHostObservation(result.hostObservation));
  return result.hostObservation;
}

before(async () => {
  await mkdir(path.resolve(".agent_workspace"), { recursive: true });
  root = await mkdtemp(path.resolve(".agent_workspace", "offline-attribution-"));
  repo = path.join(root, "repo");
  await mkdir(repo);
  git(repo, ["init"]); git(repo, ["config", "user.name", "Offline Test"]); git(repo, ["config", "user.email", "test@example.com"]);
  await writeFile(path.join(repo, "value.txt"), "zero", "utf8");
  git(repo, ["add", "."]); git(repo, ["commit", "-m", "fixture"]);
  complete = await issue({ partialUsage: true, classes: ["faux", "faux"] });
  // Keep the training/test fixture boundary separate from clock granularity.
  await new Promise((resolve) => setTimeout(resolve, 2));
  repair = await issue({ values: ["bad", "good"] });
  unknownVersion = await issue({ versions: [undefined] });
  mixedVersion = await issue({ values: ["bad", "good"], versions: ["v1", "v2"] });
  unknownProvenance = await issue({ classes: [undefined] });
  mixedProvenance = await issue({ classes: ["faux", undefined] });
  providerError = await issue({ callOutcome: "error" });
  failed = await issue({ values: ["bad"] });
  collision = await issue({ sharedId: priced().id });
});
after(async () => { if (root !== undefined) await rm(root, { recursive: true, force: true }); });

function afterAll(): string { return new Date(Date.parse(collision.completedAt) + 1).toISOString(); }
function priced(): ModelInvocation { return complete.invocations.find((row) => row.tokensIn === 100)!; }

test("synthetic originals produce bound rows with partial reported cost coverage", () => {
  const result = project({ observations: [complete], evidenceMode: "synthetic", cutoff: afterAll() });
  assert.equal(result.evidenceMode, "synthetic");
  assert.equal(result.eligible.length, 1);
  assert.equal(result.training.length, 1);
  assert.equal(result.test.length, 0);
  assert.equal(result.excluded.length, 0);
  const row = result.training[0]!;
  assert.equal(row.record, complete.assessment.record);
  assert.equal(row.refs.logicalTaskId, complete.logicalTaskId);
  assert.equal(row.refs.parentRunId, complete.runId);
  assert.deepEqual(row.refs.executionRunIds, [complete.assessment.record!.runId]);
  assert.notEqual(row.record.runId, row.refs.parentRunId);
  assert.equal(row.usageCoverage.overall.invocations, 2);
  assert.equal(row.usageCoverage.overall.input.tokens, 100);
  assert.equal(row.usageCoverage.overall.input.complete, false);
  assert.equal(row.usageCoverage.overall.output.missingInvocations, 1);
  assert.equal(row.usageCoverage.overall.cost.pricedInvocations, 1);
  assert.equal(row.usageCoverage.overall.cost.knownUsd, 0.0004);
  assert.equal(row.usageCoverage.overall.cost.completeUsd, undefined);
  assert.deepEqual(result.trainingCoverage, result.overallCoverage);
});

test("all host attempts and parent/child runs stay in one task-disjoint partition", () => {
  assert.equal(repair.attempts.length, 2);
  assert.notEqual(repair.attempts[0]!.runId, repair.attempts[1]!.runId);
  assert.notEqual(repair.attempts[0]!.taskId, repair.attempts[1]!.taskId);
  const result = project({ observations: [repair, repair], evidenceMode: "synthetic", cutoff: afterAll() });
  assert.equal(result.eligible.length, 1);
  assert.equal(result.training.length, 1);
  assert.equal(result.training[0]!.refs.attemptRunIds.length, 2);
  assert.equal(result.training[0]!.refs.executionRunIds.length, 2);
  assert.equal(result.overallCoverage.overall.invocations, 2);
  const crossing = project({ observations: [repair, repair], evidenceMode: "synthetic", cutoff: repair.invocations.at(-1)!.occurredAt });
  assert.equal(crossing.training.length, 0);
  assert.equal(crossing.test.length, 0);
  assert.equal(crossing.excluded[0]!.reason, "cross-boundary-task");
  assert.equal(crossing.overallCoverage.overall.invocations, 2);
});

test("host duration uses strict before and inclusive test cutoff equality", () => {
  const atStart = project({ observations: [complete], evidenceMode: "synthetic", cutoff: complete.startedAt });
  assert.equal(atStart.training.length, 0);
  assert.equal(atStart.test.length, 1);
  assert.equal(atStart.test[0]!.split, "test");
  const atEnd = project({ observations: [complete], evidenceMode: "synthetic", cutoff: complete.completedAt });
  assert.equal(atEnd.training.length, 0);
  assert.equal(atEnd.test.length, 0);
  assert.equal(atEnd.excluded[0]!.reason, "cross-boundary-task");
  assert.equal(atEnd.excluded[0]!.usageCoverage.overall.invocations, 2);
});

test("observed mode rejects deterministic faux evidence and copied pi claims", () => {
  const forged = { ...complete, executorClass: "pi", invocations: complete.invocations.map((row) => ({ ...row, executorClass: "pi" })) };
  const result = project({ observations: [complete, forged], evidenceMode: "observed", cutoff: afterAll() });
  assert.equal(result.eligible.length, 0);
  assert.deepEqual(result.excluded.map((row) => row.reason).sort(), ["evidence-mode-mismatch", "untrusted-observation"]);
  assert.equal(result.overallCoverage.overall.invocations, 2);
  assert.equal(result.trainingCoverage.overall.invocations, 0);
});

test("unknown and mixed executor provenance are explicit exclusions in both modes", () => {
  for (const evidenceMode of ["observed", "synthetic"] as const) {
    const result = project({ observations: [unknownProvenance, mixedProvenance], evidenceMode, cutoff: afterAll() });
    assert.equal(result.eligible.length, 0);
    assert.deepEqual(result.excluded.map((row) => row.reason).sort(), ["mixed-executor-provenance", "unknown-executor-provenance"]);
    assert.equal(result.overallCoverage.overall.invocations, 3);
  }
});

test("unknown and mixed model versions keep genuine usage without eligible labels", () => {
  const result = project({ observations: [unknownVersion, mixedVersion], evidenceMode: "synthetic", cutoff: afterAll() });
  assert.equal(result.eligible.length, 0);
  assert.equal(result.excluded.length, 2);
  assert.ok(result.excluded.every((row) => row.reason === "host-unobserved" && row.detail === "unknown-or-mixed-model-version"));
  assert.equal(result.overallCoverage.overall.invocations, 3);
  assert.equal(result.trainingCoverage.overall.invocations, 0);
  assert.ok(result.excluded.every((row) => row.usageCoverage.overall.invocations > 0));
});

test("failed model labels remain eligible and provider-excluded spend remains visible", () => {
  const result = project({ observations: [failed, providerError], evidenceMode: "synthetic", cutoff: afterAll() });
  assert.equal(result.eligible.length, 1);
  assert.equal(result.eligible[0]!.record.outcome, "FAILED");
  assert.equal(result.excluded[0]!.detail, "provider-failure");
  assert.equal(result.excluded[0]!.usageCoverage.byOutcome.error.invocations, 1);
  assert.equal(result.overallCoverage.byOutcome.error.invocations, 1);
  assert.equal(result.overallCoverage.overall.cost.knownUsd, 0.0008);
  assert.equal(result.trainingCoverage.overall.cost.knownUsd, 0.0004);
});

test("exact observation and invocation copies deduplicate without mutating frozen inputs", async () => {
  const invocations = Object.freeze([...complete.invocations.map((row) => structuredClone(row)), ...complete.invocations]);
  const input = Object.freeze({ observations: Object.freeze([complete, complete]), invocations, evidenceMode: "synthetic" as const, cutoff: afterAll() });
  const before = JSON.stringify(input);
  const result = project(input);
  assert.equal(result.eligible.length, 1);
  assert.equal(result.overallCoverage.overall.invocations, 2);
  assert.equal(result.overallCoverage.overall.cost.knownUsd, 0.0004);
  assert.equal(JSON.stringify(input), before);
  assert.equal(await readFile(path.join(repo, "value.txt"), "utf8"), "zero");
});

test("missing joined calls cannot silently retain a dataset label", () => {
  const result = project({ observations: [complete], invocations: [complete.invocations[0]!], evidenceMode: "synthetic", cutoff: afterAll() });
  assert.equal(result.eligible.length, 0);
  assert.equal(result.excluded[0]!.reason, "missing-invocation");
  assert.equal(result.overallCoverage.overall.invocations, 2);
});

test("untrusted join conflicts cannot erase genuine published spend", () => {
  const changed = { ...priced(), tokensIn: 900 };
  const result = project({ observations: [complete], invocations: [...complete.invocations, changed], evidenceMode: "synthetic", cutoff: afterAll() });
  assert.equal(result.eligible.length, 0);
  assert.equal(result.excluded[0]!.reason, "conflicting-invocation");
  assert.equal(result.overallCoverage.overall.invocations, 2);
  assert.equal(result.overallCoverage.overall.input.tokens, 100);
  assert.equal(result.overallCoverage.overall.cost.knownUsd, 0.0004);
  assert.equal(result.excluded[0]!.usageCoverage.overall.cost.knownUsd, 0.0004);
});

test("joined token and pricing accessors are rejected without invoking getters", () => {
  let reads = 0;
  const tokenAccessor = { ...priced() };
  Object.defineProperty(tokenAccessor, "tokensIn", { enumerable: true, get: () => { reads++; return 900; } });
  const priceAccessor = { ...priced() };
  Object.defineProperty(priceAccessor, "pricing", { enumerable: true, get: () => { reads++; return { catalogVersion: "forged", inputUsdPerMTok: 99, outputUsdPerMTok: 99 }; } });
  const nestedPriceAccessor = { ...priced(), pricing: { ...priced().pricing! } };
  Object.defineProperty(nestedPriceAccessor.pricing, "inputUsdPerMTok", { enumerable: true, get: () => { reads++; return 99; } });
  for (const row of [tokenAccessor, priceAccessor, nestedPriceAccessor]) {
    const result = project({ observations: [complete], invocations: [...complete.invocations, row], evidenceMode: "synthetic", cutoff: afterAll() });
    assert.equal(reads, 0);
    assert.equal(result.eligible.length, 0);
    assert.equal(result.excluded[0]!.reason, "conflicting-invocation");
    assert.equal(result.overallCoverage.overall.input.tokens, 100);
    assert.equal(result.overallCoverage.overall.cost.knownUsd, 0.0004);
  }
});

test("joined tokens and prices cannot fill unknown published fields", () => {
  const missing = complete.invocations.find((row) => row.tokensIn === undefined)!;
  const filled = { ...missing, tokensIn: 0, tokensOut: 0,
    pricing: { catalogVersion: "forged", inputUsdPerMTok: 0, outputUsdPerMTok: 0 } };
  const result = project({ observations: [complete], invocations: [priced(), filled], evidenceMode: "synthetic", cutoff: afterAll() });
  assert.equal(result.eligible.length, 0);
  assert.equal(result.excluded[0]!.reason, "conflicting-invocation");
  assert.equal(result.overallCoverage.overall.input.missingInvocations, 1);
  assert.equal(result.overallCoverage.overall.cost.pricedInvocations, 1);
  assert.equal(result.overallCoverage.overall.cost.completeUsd, undefined);
});

test("conflicting joins choose no variant and cannot fill unknown usage or model versions", () => {
  const changed = { ...priced(), tokensIn: 900 };
  for (const invocations of [[...complete.invocations, changed], [changed, ...complete.invocations.filter((row) => row.id !== changed.id)]]) {
    const result = project({ observations: [complete], invocations, evidenceMode: "synthetic", cutoff: afterAll() });
    assert.equal(result.eligible.length, 0);
    assert.equal(result.excluded[0]!.reason, "conflicting-invocation");
    assert.equal(result.overallCoverage.conflicts.length, 0);
    assert.equal(result.overallCoverage.overall.input.tokens, 100);
    assert.equal(result.overallCoverage.overall.cost.knownUsd, 0.0004);
  }
  const filled = { ...unknownVersion.invocations[0]!, config: { ...unknownVersion.invocations[0]!.config, modelVersion: "forged-fill" } };
  const result = project({ observations: [unknownVersion], invocations: [filled], evidenceMode: "synthetic", cutoff: afterAll() });
  assert.equal(result.eligible.length, 0);
  assert.equal(result.excluded[0]!.reason, "conflicting-invocation");
});

test("genuine conflicting invocation identities exclude all affected observations", () => {
  const result = project({ observations: [complete, collision], evidenceMode: "synthetic", cutoff: afterAll() });
  assert.equal(result.eligible.length, 0);
  assert.equal(result.excluded.length, 2);
  assert.ok(result.excluded.every((row) => row.reason === "conflicting-invocation"));
  assert.equal(result.overallCoverage.conflicts.length, 1);
  assert.equal(result.overallCoverage.overall.invocations, 1);
});

test("unpublished invocation identities are excluded and cannot add spend", () => {
  const extra = { ...complete.invocations[0]!, id: createInvocationId(), tokensIn: 9999999 };
  const result = project({ observations: [complete], invocations: [...complete.invocations, extra], evidenceMode: "synthetic", cutoff: afterAll() });
  assert.equal(result.eligible.length, 1);
  assert.equal(result.excluded[0]!.reason, "unbound-invocation");
  assert.deepEqual(result.excluded[0]!.refs.invocationIds, [extra.id]);
  assert.equal(result.overallCoverage.overall.invocations, 2);
  assert.equal(result.overallCoverage.overall.input.tokens, 100);
});

test("serialized, missing-time and missing-identity copies remain untrusted with no coverage", () => {
  const result = project({ observations: [JSON.parse(JSON.stringify(complete)), { ...complete, startedAt: undefined },
    { ...complete, logicalTaskId: "" }, null], evidenceMode: "synthetic", cutoff: afterAll() });
  assert.equal(result.eligible.length, 0);
  assert.equal(result.excluded.length, 4);
  assert.ok(result.excluded.every((row) => row.reason === "untrusted-observation"));
  assert.equal(result.overallCoverage.overall.invocations, 0);
});

test("partitions and coverage are permutation invariant", () => {
  const observations = [complete, repair, providerError, unknownVersion, failed, complete];
  const invocations = observations.flatMap((row) => row.invocations);
  const input = { observations, invocations, evidenceMode: "synthetic" as const, cutoff: repair.startedAt };
  const first = project(input);
  const reversed = project({ ...input, observations: [...observations].reverse(), invocations: [...invocations].reverse() });
  assert.deepEqual(first, reversed);
  assert.equal(first.training.length, 1);
  assert.equal(first.test.length, 2);
  assert.equal(first.overallCoverage.overall.invocations, 7);
  const changed = { ...priced(), tokensOut: 800 };
  const conflicts = { ...input, invocations: [...invocations, changed] };
  assert.deepEqual(project(conflicts), project({ ...conflicts, observations: [...observations].reverse(), invocations: [...conflicts.invocations].reverse() }));
});

test("cutoff and evidence mode are explicit and invalid values fail closed", () => {
  assert.throws(() => project({ observations: [complete], evidenceMode: "synthetic", cutoff: "not-a-date" }), /cutoff/i);
  assert.throws(() => project({ observations: [complete], evidenceMode: undefined as unknown as "synthetic", cutoff: afterAll() }), /evidence.mode/i);
  const empty = project({ observations: [], evidenceMode: "observed", cutoff: afterAll() });
  assert.equal(empty.overallCoverage.overall.cost.knownUsd, undefined);
  assert.equal(empty.overallCoverage.overall.cost.completeUsd, undefined);
  assert.equal(empty.eligible.length, 0);
});
