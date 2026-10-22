import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createEvidenceId, createInvocationId, createMessageId } from "../src/domain/ids.js";
import { nowIso } from "../src/domain/timestamp.js";
import type { AgentExecutionRequest, ExecutionEvent } from "../src/execution/contract.js";
import { prepareTrustedVerification } from "../src/execution/trusted-verification.js";
import { prepareHostRoutingDataset, runHostRoutingCase } from "../src/learning/host-routing-dataset.js";
import type { NativeHostEvaluator } from "../src/native/host-outcome.js";
import { NativeWriteSession } from "../src/native/write-session.js";
import type { ModelInvocation } from "../src/telemetry/model-invocation.js";

const evaluator: NativeHostEvaluator = {
  evaluatorId: "synthetic-node-checker", evaluatorVersion: "1",
  rubricId: "value-good", rubricVersion: "1",
  evaluatorDefinitionCanonicalJson: '{"accept":"exit 0","modelFailure":[1]}',
  modelFailureExitCodes: [1]
};
const checkerArgs = ["-e", "process.exit(require('node:fs').readFileSync('value.txt','utf8')==='good'?0:1)"];
const model = "synthetic-writer";
const modelVersion = "fixture-v1";
const maxWallTimeMs = 30_000;

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`synthetic Git fixture failed: ${result.stderr}`);
  return result.stdout;
}

function reportedSuccess(request: AgentExecutionRequest): ExecutionEvent {
  const evidenceId = createEvidenceId();
  return { type: "MESSAGE", message: {
    protocolVersion: 1, id: createMessageId(), occurredAt: nowIso(),
    runId: request.runId, taskId: request.taskId, from: request.agentInstanceId, to: "SUPERVISOR",
    type: "TASK_RESULT", outcome: "SUCCESS", summary: "fixture result", artifactIds: [], evidenceIds: [evidenceId],
    verification: { kind: "PASSED", evidenceIds: [evidenceId] }
  } };
}

interface SyntheticScenario {
  readonly caseId: string;
  readonly values: readonly string[];
  readonly unknownVersion?: boolean;
  readonly providerError?: boolean;
}

/** Offline example only: no providers, user repositories, keys or external inputs. */
export async function runHostRoutingDatasetExample() {
  const workspace = path.resolve(".agent_workspace", "routing-training-data");
  await mkdir(workspace, { recursive: true });
  const root = await mkdtemp(path.join(workspace, "example-"));
  const source = path.join(root, "source");
  const sandboxRoot = path.join(root, "candidates");
  await mkdir(source);
  await mkdir(sandboxRoot);
  git(source, ["init"]);
  git(source, ["config", "user.name", "Synthetic Fixture"]);
  git(source, ["config", "user.email", "fixture@example.invalid"]);
  await writeFile(path.join(source, "value.txt"), "zero", "utf8");
  git(source, ["add", "value.txt"]);
  git(source, ["-c", "core.hooksPath=.", "-c", "commit.gpgsign=false", "commit", "-m", "synthetic fixture"]);

  async function executeScenario(scenario: SyntheticScenario) {
    return runHostRoutingCase({
      declaration: {
        caseId: scenario.caseId, problemId: "value-good", templateId: "single-file-value-v1",
        predecision: { taskFamily: "synthetic-file-edit", features: { fileCount: 1, hasChecker: true } },
        candidate: { candidateId: "faux-file-writer", provider: "faux", model, modelVersion,
          effort: "synthetic-declaration", toolProfileId: "native-file-tools",
          maxAttempts: scenario.values.length, maxWallTimeMs }
      },
      execute: async () => {
        let attempt = 0;
        const session = new NativeWriteSession({
          stateRoot: path.join(root, "state"), sandboxRoot, hostEvaluator: evaluator,
          executorFactory: (context) => {
            const index = attempt++;
            return { async *execute(request: AgentExecutionRequest): AsyncIterable<ExecutionEvent> {
              // Report genuine deterministic fixture calls as faux, never as a real provider.
              const invocation: ModelInvocation = {
                id: createInvocationId(), taskId: request.taskId, runId: request.runId,
                agentInstanceId: request.agentInstanceId,
                config: { provider: "faux", model, parameterHash: "a", modelVersion: scenario.unknownVersion ? undefined : modelVersion },
                responseHash: "b", tokensIn: scenario.providerError ? undefined : 100, tokensOut: scenario.providerError ? undefined : 50,
                latencyMs: 1, occurredAt: nowIso(), callOutcome: scenario.providerError ? "error" : "ok",
                executorClass: "faux",
                ...(scenario.providerError ? {} : { pricing: { catalogVersion: "synthetic-estimate", inputUsdPerMTok: 2, outputUsdPerMTok: 4 } })
              };
              context.onInvocation(invocation);
              const writer = context.tools.find((tool) => tool.name === "sparkle_write_file");
              assert.ok(writer);
              await writer.execute("synthetic-write", { path: "value.txt", contents: scenario.values[index]! });
              // The host checker, not this success claim, decides the acceptance label.
              yield reportedSuccess(request);
              yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
            } };
          }
        });
        try {
          return await session.execute({
            sourceRepo: source, objective: "produce good value", maxAttempts: scenario.values.length, maxWallTimeMs,
            verification: { command: process.execPath, args: checkerArgs,
              trustedVerification: prepareTrustedVerification({ command: process.execPath, args: checkerArgs }) }
          });
        } finally {
          await session.shutdown();
        }
      }
    });
  }

  const cases = [await executeScenario({ caseId: "success", values: ["good"] })];
  for (const scenario of [
    { caseId: "failure", values: ["bad"] },
    { caseId: "repair", values: ["bad", "good"] },
    { caseId: "unknown-version", values: ["good"], unknownVersion: true },
    { caseId: "provider-error", values: ["good"], providerError: true }
  ]) cases.push(await executeScenario(scenario));

  assert.equal(await readFile(path.join(source, "value.txt"), "utf8"), "zero");
  assert.equal(git(source, ["status", "--porcelain"]), "");
  // All variants are the same problem/template; none may leak across the split.
  const cutoff = new Date(Date.now() + 1).toISOString();
  const dataset = prepareHostRoutingDataset({ cases, evidenceMode: "synthetic", cutoff });
  const outputPath = path.join(root, "dataset.json");
  await writeFile(outputPath, JSON.stringify(dataset, null, 2) + "\n", "utf8");
  return { outputPath, dataset };
}

export async function hostRoutingDatasetMain(args: readonly string[]): Promise<void> {
  if (args.length !== 0) throw new Error("This synthetic-only example accepts no arguments.");
  const { outputPath, dataset } = await runHostRoutingDatasetExample();
  process.stdout.write(JSON.stringify({ evidenceMode: dataset.evidenceMode, cases: dataset.rows.length,
    training: dataset.training.length, test: dataset.test.length, excluded: dataset.excluded.length,
    invocations: dataset.overallCoverage.overall.invocations, outputPath }) + "\n");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  hostRoutingDatasetMain(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
