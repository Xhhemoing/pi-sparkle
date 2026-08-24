import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Context,
  type FauxResponseStep
} from "@earendil-works/pi-ai";
import * as ts from "typescript";
import type { AgentExecutionRequest, ExecutionEvent } from "../../../src/execution/contract.js";
import type { AgentInstanceId, RunId, TaskId } from "../../../src/domain/ids.js";
import { validateAgentMessage, type TaskResult } from "../../../src/protocol/v1.js";
import {
  createTaskResultTool,
  PiAgentExecutor,
  REPORT_TASK_RESULT_TOOL
} from "../../../src/pi-adapter/pi-executor.js";

/**
 * Loop 4 R9-2 — the executor's verdict channel.
 *
 * `translatePiEvent` maps pi's stream to text / tool / turn events and never
 * to a MESSAGE, so before this tool the adapter could not carry a child's own
 * `TASK_RESULT` at all: `finish` synthesized `UNOBSERVED` on every run and
 * `assessChildObservation` refuses UNOBSERVED. `sparkle_report_task_result` is
 * the producer that closes that hole. These tests pin both halves — what a
 * reported verdict is allowed to say, and that silence still means UNOBSERVED.
 * R10-6 strengthens the standing producer rules with adversarial identity,
 * empty-evidence, same-verdict duplicate, and always-surfaced source pins.
 *
 * Everything here is offline: the faux provider scripts the tool call. No
 * PI_SMOKE gate, no live provider, no new skip.
 */

const RUN_ID = "run_01234567-89ab-cdef-0123-456789abcdef" as RunId;
const TASK_ID = "tsk_01234567-89ab-cdef-0123-456789abcdef" as TaskId;
const AGENT_ID = "agt_01234567-89ab-cdef-0123-456789abcdef" as AgentInstanceId;
const PI_EXECUTOR_PATH = fileURLToPath(
  new URL("../../../src/pi-adapter/pi-executor.ts", import.meta.url)
);
const PI_EXECUTOR_SOURCE = readFileSync(PI_EXECUTOR_PATH, "utf8");

function objectProperty(object: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment {
  const matches = object.properties.filter(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      ((ts.isIdentifier(property.name) && property.name.text === name) ||
        (ts.isStringLiteralLike(property.name) && property.name.text === name))
  );
  assert.equal(matches.length, 1, `expected one ${name} property`);
  const match = matches[0];
  assert.ok(match);
  return match;
}

function attemptToolsArray(source: string): {
  readonly parsed: ts.SourceFile;
  readonly tools: ts.ArrayLiteralExpression;
} {
  const parsed = ts.createSourceFile(
    PI_EXECUTOR_PATH,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const agents: ts.NewExpression[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Agent"
    ) {
      agents.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);

  assert.equal(agents.length, 1, "PiAgentExecutor must construct one Agent");
  const agent = agents[0];
  const options = agent?.arguments?.[0];
  assert.ok(options !== undefined && ts.isObjectLiteralExpression(options));
  const initialState = objectProperty(options, "initialState").initializer;
  assert.ok(ts.isObjectLiteralExpression(initialState));
  const tools = objectProperty(initialState, "tools").initializer;
  assert.ok(ts.isArrayLiteralExpression(tools));
  return { parsed, tools };
}

function verdictToolBinding(parsed: ts.SourceFile): string {
  const bindings: string[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === "createTaskResultTool"
    ) {
      bindings.push(node.name.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.equal(bindings.length, 1, "each attempt must build one verdict tool directly");
  const binding = bindings[0];
  assert.ok(binding);
  return binding;
}

function assertVerdictToolAlwaysSurfaced(source: string): void {
  const { parsed, tools } = attemptToolsArray(source);
  const binding = verdictToolBinding(parsed);
  const direct = tools.elements.filter(
    (element) => ts.isIdentifier(element) && element.text === binding
  );
  const references: ts.Identifier[] = [];
  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node) && node.text === binding) references.push(node);
    ts.forEachChild(node, visit);
  }
  visit(tools);

  assert.equal(references.length, 1, "the attempt tools array must mention its verdict tool once");
  assert.equal(
    direct.length,
    1,
    "the verdict tool must be a direct tools-array element, never conditional on a runtime flag"
  );
}

function gateVerdictToolBehindFlag(source: string): string {
  const { parsed, tools } = attemptToolsArray(source);
  const binding = verdictToolBinding(parsed);
  const direct = tools.elements.find(
    (element) => ts.isIdentifier(element) && element.text === binding
  );
  assert.ok(direct, "mutation target verdict tool must exist");
  return (
    source.slice(0, direct.getStart(parsed)) +
    `...(this.options.reportTaskResult ? [${binding}] : [])` +
    source.slice(direct.getEnd())
  );
}

function request(): AgentExecutionRequest {
  return {
    runId: RUN_ID,
    taskId: TASK_ID,
    agentInstanceId: AGENT_ID,
    prompt: "Do the work",
    workingDirectory: "/tmp/project"
  };
}

interface ToolHarness {
  readonly tool: ReturnType<typeof createTaskResultTool>;
  readonly emitted: ExecutionEvent[];
  readonly terminals: () => TaskResult[];
}

function toolHarness(): ToolHarness {
  const emitted: ExecutionEvent[] = [];
  return {
    tool: createTaskResultTool(request(), (event) => emitted.push(event)),
    emitted,
    terminals: () => terminalsOf(emitted)
  };
}

async function report(harness: ToolHarness, args: Record<string, unknown>): Promise<string> {
  const result = await harness.tool.execute("tool_call_1", args);
  const content = result.content[0];
  assert.equal(content?.type, "text");
  return content.text;
}

function terminalsOf(events: readonly ExecutionEvent[]): TaskResult[] {
  return events.flatMap((event) =>
    event.type === "MESSAGE" && event.message.type === "TASK_RESULT" ? [event.message] : []
  );
}

function reportCall(args: Record<string, unknown>): FauxResponseStep {
  return fauxAssistantMessage(fauxToolCall(REPORT_TASK_RESULT_TOOL, args, { id: "tool_call_1" }));
}

function providerError(status: number, body: string): () => never {
  return () => {
    throw new Error(`${status}: ${body}`);
  };
}

function executorFor(responses: FauxResponseStep[], maxAttempts = 1): PiAgentExecutor {
  const faux = fauxProvider();
  faux.setResponses(responses);
  const models = createModels();
  models.setProvider(faux.provider);
  return new PiAgentExecutor({
    providerId: "faux",
    modelId: "faux-1",
    models,
    retry: { maxAttempts, baseDelayMs: 1, jitterRatio: 0, random: () => 0, sleep: async () => {} }
  });
}

async function drain(executor: PiAgentExecutor): Promise<ExecutionEvent[]> {
  const events: ExecutionEvent[] = [];
  for await (const event of executor.execute(request(), new AbortController().signal)) {
    events.push(event);
  }
  return events;
}

function outcomeOf(events: readonly ExecutionEvent[]): string {
  const finished = events.find((event) => event.type === "EXECUTION_FINISHED");
  return finished?.type === "EXECUTION_FINISHED" ? finished.outcome : "none";
}

describe("sparkle_report_task_result", () => {
  it("emits one protocol-v1 TASK_RESULT stamped with the leased identity", async () => {
    const harness = toolHarness();

    const text = await report(harness, {
      verification: "PASSED",
      summary: "  ran the suite  ",
      evidenceIds: ["evd_suite-1"],
      artifactIds: ["art_report-1"]
    });

    assert.equal(text, `recorded PASSED for ${TASK_ID}`);
    const terminals = harness.terminals();
    assert.equal(terminals.length, 1);
    const terminal = terminals[0];
    assert.ok(terminal !== undefined);
    // The message is real protocol v1, not an adapter-shaped lookalike: the
    // child coordinator revalidates it and refuses anything else.
    assert.deepEqual(validateAgentMessage(terminal), terminal);
    // Identity comes from the lease. A model that could name these fields
    // could impersonate a peer, and the coordinator refuses a mismatch.
    assert.equal(terminal.runId, RUN_ID);
    assert.equal(terminal.taskId, TASK_ID);
    assert.equal(terminal.from, AGENT_ID);
    assert.equal(terminal.to, "SUPERVISOR");
    assert.equal(terminal.summary, "ran the suite");
    assert.equal(terminal.outcome, "SUCCESS");
    assert.deepEqual(terminal.verification, { kind: "PASSED", evidenceIds: ["evd_suite-1"] });
    assert.deepEqual(terminal.evidenceIds, ["evd_suite-1"]);
    assert.deepEqual(terminal.artifactIds, ["art_report-1"]);
  });

  it("ignores model-supplied identity fields and stamps the leased request", async () => {
    const harness = toolHarness();
    await report(harness, {
      verification: "PASSED",
      summary: "ran the suite",
      from: "agt_ffffffff-ffff-ffff-ffff-ffffffffffff",
      runId: "run_ffffffff-ffff-ffff-ffff-ffffffffffff",
      taskId: "tsk_ffffffff-ffff-ffff-ffff-ffffffffffff"
    });

    const terminal = harness.terminals()[0];
    assert.ok(terminal);
    assert.deepEqual(
      { from: terminal.from, runId: terminal.runId, taskId: terminal.taskId },
      { from: AGENT_ID, runId: RUN_ID, taskId: TASK_ID },
      "model fields cannot impersonate another lease"
    );
  });

  it("derives the outcome from the verdict and honours an explicit one", async () => {
    const failed = toolHarness();
    await report(failed, {
      verification: "FAILED",
      summary: "two assertions still fail",
      evidenceIds: ["evd_run-7"]
    });
    assert.equal(failed.terminals()[0]?.outcome, "FAILURE");

    const partial = toolHarness();
    await report(partial, {
      verification: "PASSED",
      summary: "the checked half works; the rest is untouched",
      outcome: "PARTIAL"
    });
    assert.equal(partial.terminals()[0]?.outcome, "PARTIAL");
  });

  it("refuses a verdict the gate cannot read", async () => {
    for (const verification of ["UNOBSERVED", "passed", "MAYBE", 1, undefined]) {
      const harness = toolHarness();
      await assert.rejects(
        harness.tool.execute("tool_call_1", { verification, summary: "did the work" }),
        /verification must be one of PASSED, FAILED/,
        `${String(verification)} is not a reportable verdict`
      );
      assert.deepEqual(harness.emitted, [], "a refused report emits nothing");
    }
  });

  it("refuses a FAILED verdict that cites no evidence", async () => {
    const harness = toolHarness();
    await assert.rejects(
      harness.tool.execute("tool_call_1", { verification: "FAILED", summary: "it broke" }),
      /a FAILED verdict must cite at least one evidenceId/
    );
    assert.deepEqual(harness.emitted, []);

    // The rule is not decoration: an unreferenced FAIL is discarded by
    // `assessChildObservation` before it reaches the gate, so the verdict
    // would disappear silently instead of blocking the run. Pinned against
    // the tracking layer in test/unit/tracking/option-a-preconditions.test.ts.
    const withEvidence = toolHarness();
    await report(withEvidence, {
      verification: "FAILED",
      summary: "it broke",
      evidenceIds: ["evd_run-7"]
    });
    assert.deepEqual(withEvidence.terminals()[0]?.verification, {
      kind: "FAILED",
      evidenceIds: ["evd_run-7"]
    });
  });

  it("refuses an explicitly empty evidence list on a FAILED verdict", async () => {
    const harness = toolHarness();
    await assert.rejects(
      harness.tool.execute("tool_call_1", {
        verification: "FAILED",
        summary: "it broke",
        evidenceIds: []
      }),
      /a FAILED verdict must cite at least one evidenceId/
    );
    assert.deepEqual(harness.emitted, []);
  });

  it("refuses a malformed reference instead of dropping it", async () => {
    const evidence = toolHarness();
    await assert.rejects(
      evidence.tool.execute("tool_call_1", {
        verification: "PASSED",
        summary: "did the work",
        evidenceIds: ["evd_ok", "sha256:beef"]
      }),
      /evidenceIds entry "sha256:beef" is not a evd_ id/
    );
    assert.deepEqual(evidence.emitted, [], "one bad reference refuses the whole verdict");

    const artifacts = toolHarness();
    await assert.rejects(
      artifacts.tool.execute("tool_call_1", {
        verification: "PASSED",
        summary: "did the work",
        artifactIds: ["report.md"]
      }),
      /artifactIds entry "report.md" is not a art_ id/
    );
    assert.deepEqual(artifacts.emitted, []);
  });

  it("refuses an empty summary, which protocol v1 would reject anyway", async () => {
    const harness = toolHarness();
    await assert.rejects(
      harness.tool.execute("tool_call_1", { verification: "PASSED", summary: "   " }),
      /summary must be a non-empty string/
    );
    assert.deepEqual(harness.emitted, []);
  });

  it("refuses a CANCELLED claim: cancellation is the parent's observation", async () => {
    const harness = toolHarness();
    await assert.rejects(
      harness.tool.execute("tool_call_1", {
        verification: "PASSED",
        summary: "did the work",
        outcome: "CANCELLED"
      }),
      /outcome must be one of SUCCESS, PARTIAL, FAILURE, got "CANCELLED"/
    );
    assert.deepEqual(harness.emitted, []);
  });

  it("records exactly one verdict per attempt and says which one stands", async () => {
    const harness = toolHarness();
    await report(harness, { verification: "PASSED", summary: "did the work" });

    // Refused at the tool, not emitted and rejected downstream: the attempt
    // transcript treats a second terminal as a protocol violation that fails
    // the whole task, which is too much punishment for a model calling twice.
    await assert.rejects(
      harness.tool.execute("tool_call_2", {
        verification: "FAILED",
        summary: "actually it broke",
        evidenceIds: ["evd_run-7"]
      }),
      /this task already reported PASSED; a task carries exactly one verdict/
    );
    assert.equal(harness.terminals().length, 1);
    assert.equal(harness.terminals()[0]?.verification.kind, "PASSED");
  });

  it("refuses a repeated identical verdict instead of double-emitting it", async () => {
    const harness = toolHarness();
    await report(harness, { verification: "PASSED", summary: "did the work" });

    await assert.rejects(
      harness.tool.execute("tool_call_2", {
        verification: "PASSED",
        summary: "reporting the same result twice"
      }),
      /this task already reported PASSED; a task carries exactly one verdict/
    );
    assert.equal(harness.terminals().length, 1);
  });
});

describe("PiAgentExecutor verdict reporting", () => {
  it("surfaces the verdict tool on every request, cluster or not", async () => {
    const seen: string[][] = [];
    const executor = executorFor([
      (context: Context) => {
        seen.push((context.tools ?? []).map((tool) => tool.name));
        return fauxAssistantMessage("nothing to report");
      }
    ]);

    await drain(executor);

    assert.deepEqual(
      seen,
      [[REPORT_TASK_RESULT_TOOL]],
      "a request carrying no cluster still gets the verdict tool"
    );
  });

  it("keeps the verdict tool unconditional in the attempt tools array", () => {
    assertVerdictToolAlwaysSurfaced(PI_EXECUTOR_SOURCE);

    const optInMutant = gateVerdictToolBehindFlag(PI_EXECUTOR_SOURCE);
    assert.throws(
      () => assertVerdictToolAlwaysSurfaced(optInMutant),
      assert.AssertionError,
      "the source pin must reject an opt-in runtime flag"
    );
  });

  it("replays the child's verdict instead of synthesizing UNOBSERVED", async () => {
    const executor = executorFor([
      reportCall({
        verification: "PASSED",
        summary: "ran the suite",
        evidenceIds: ["evd_suite-1"]
      }),
      fauxAssistantMessage("done")
    ]);

    const events = await drain(executor);

    const terminals = terminalsOf(events);
    assert.equal(terminals.length, 1, "the adapter must not append a second terminal");
    assert.deepEqual(terminals[0]?.verification, { kind: "PASSED", evidenceIds: ["evd_suite-1"] });
    assert.equal(terminals[0]?.summary, "ran the suite");
    assert.equal(outcomeOf(events), "SUCCESS");

    const types = events.map((event) => event.type);
    const started = types.indexOf("TOOL_STARTED");
    const message = types.indexOf("MESSAGE");
    const finished = types.indexOf("TOOL_FINISHED");
    assert.ok(started >= 0 && finished > started, "the verdict rides a real tool call");
    assert.ok(
      message > started && message < finished,
      `the terminal lands inside its own tool call, got ${types.join(",")}`
    );
  });

  it("still synthesizes UNOBSERVED for a child that reports nothing", async () => {
    const executor = executorFor([fauxAssistantMessage("nothing to report")]);

    const events = await drain(executor);

    const terminals = terminalsOf(events);
    assert.equal(terminals.length, 1);
    assert.deepEqual(terminals[0]?.verification, { kind: "UNOBSERVED", evidenceIds: [] });
    assert.equal(terminals[0]?.summary, "pi agent finished");
    assert.equal(outcomeOf(events), "SUCCESS");
  });

  it("leaves the transcript silent when the report is refused", async () => {
    const executor = executorFor([
      reportCall({ verification: "MAYBE", summary: "did the work" }),
      fauxAssistantMessage("giving up on the verdict")
    ]);

    const events = await drain(executor);

    const terminals = terminalsOf(events);
    assert.equal(terminals.length, 1);
    assert.deepEqual(
      terminals[0]?.verification,
      { kind: "UNOBSERVED", evidenceIds: [] },
      "a refused verdict is not a verdict: the run falls back to unobserved"
    );
    const toolFinished = events.find((event) => event.type === "TOOL_FINISHED");
    assert.equal(
      toolFinished?.type === "TOOL_FINISHED" ? toolFinished.isError : undefined,
      true,
      "the refusal is visible in the transcript as a failed tool call"
    );
    assert.equal(outcomeOf(events), "SUCCESS", "a refused report must not fail the run");
  });

  it("drops a verdict reported by an attempt that then failed", async () => {
    const executor = executorFor(
      [
        reportCall({
          verification: "PASSED",
          summary: "ran the suite",
          evidenceIds: ["evd_suite-1"]
        }),
        providerError(429, "rate limited"),
        fauxAssistantMessage("recovered without a verdict")
      ],
      2
    );

    const events = await drain(executor);

    const terminals = terminalsOf(events);
    assert.equal(terminals.length, 1);
    assert.deepEqual(
      terminals[0]?.verification,
      { kind: "UNOBSERVED", evidenceIds: [] },
      "only the surviving attempt's transcript is reported, so its silence stands"
    );
    assert.equal(outcomeOf(events), "SUCCESS");
  });
});
