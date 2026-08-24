import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { main, type CliIo } from "../../../src/cli/main.js";
import { createMessageId, createTaskId } from "../../../src/domain/ids.js";
import type { TaskNode } from "../../../src/domain/task.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import type {
  AgentExecutionRequest,
  AgentExecutor,
  ExecutionEvent
} from "../../../src/execution/contract.js";
import { SUPERVISOR, type TaskResult } from "../../../src/protocol/v1.js";
import { startSupervisedRun } from "../../../src/run/supervisor.js";
import { invocationsLogPath } from "../../../src/telemetry/invocation-log.js";
import { withIsolatedPiEnv } from "../../helpers/pi-env.js";

/**
 * Source pin for `resumeCommand`'s telemetry wiring.
 *
 * `resumeCommand` used to build its executors with `hooks = undefined`, so a
 * resumed run made model calls that never reached `runtime/invocations.jsonl`:
 * cost calibration and run-to-run comparison silently under-counted every run
 * that was resumed rather than finished in one go. Nothing observable from a
 * test with a fake executor changes when the hook disappears — the `pi`
 * executor is the only kind that reports invocations, and it needs a live
 * provider — so the wiring itself is what gets pinned here, and the pin is
 * mutation-checked below so it cannot pass vacuously.
 *
 * `runCommand`'s equivalent pin lives in `test/unit/telemetry/invocation-log.test.ts`.
 */
const MAIN_PATH = fileURLToPath(new URL("../../../src/cli/main.ts", import.meta.url));
const MAIN_SOURCE = readFileSync(MAIN_PATH, "utf8");

/**
 * Blank out comment and string-literal contents, preserving length and line
 * structure so the result can be searched structurally. A hook that survives
 * only as a comment must not satisfy the pin.
 */
function normalizeSource(source: string): string {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const pair = source.slice(index, index + 2);
    if (pair === "//") {
      while (index < source.length && source[index] !== "\n") {
        out += " ";
        index += 1;
      }
      continue;
    }
    if (pair === "/*") {
      while (index < source.length && source.slice(index, index + 2) !== "*/") {
        out += source[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      out += "  ";
      index += 2;
      continue;
    }
    const char = source[index];
    if (char === '"' || char === "'" || char === "`") {
      out += char;
      index += 1;
      while (index < source.length && source[index] !== char) {
        if (source[index] === "\\") {
          out += "  ";
          index += 2;
          continue;
        }
        out += source[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      out += char;
      index += 1;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

function functionBody(normalized: string, header: string): string {
  const start = normalized.indexOf(header);
  assert.ok(start >= 0, `${header} must still exist in src/cli/main.ts`);
  const end = normalized.indexOf("\n}\n", start);
  assert.ok(end > start, `could not find the end of ${header}`);
  return normalized.slice(start, end);
}

/**
 * Same span as `functionBody`, cut out of the raw source. `normalizeSource`
 * replaces characters one for one, so offsets found in the normalized text
 * address the same characters in the original — which is what lets the parse
 * options below be matched by their real (unblanked) flag names.
 */
function rawFunctionBody(source: string, header: string): string {
  const normalized = normalizeSource(source);
  assert.equal(normalized.length, source.length, "normalizeSource must preserve offsets");
  const start = normalized.indexOf(header);
  assert.ok(start >= 0, `${header} must still exist in src/cli/main.ts`);
  const end = normalized.indexOf("\n}\n", start);
  assert.ok(end > start, `could not find the end of ${header}`);
  return source.slice(start, end);
}

/** Argument text of the call whose `(` sits at `openParen`. */
function callArguments(body: string, openParen: number, what: string): string {
  let depth = 0;
  for (let index = openParen; index < body.length; index += 1) {
    const char = body[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return body.slice(openParen + 1, index);
    }
  }
  return assert.fail(`unbalanced parentheses in ${what}`);
}

/**
 * Argument lists of every `createExecutor(...)` **call** in `body`, skipping
 * the declaration (whose parameter list also mentions `onInvocation`).
 */
function executorCallSites(body: string, what: string): string[] {
  const needle = "createExecutor(";
  const sites: string[] = [];
  for (let at = body.indexOf(needle); at >= 0; at = body.indexOf(needle, at + 1)) {
    if (body.slice(0, at).trimEnd().endsWith("function")) continue;
    sites.push(callArguments(body, at + needle.length - 1, what));
  }
  return sites;
}

/**
 * The pin proper, over raw source so mutants can be fed to it verbatim.
 * Throws (rather than returning a verdict) so the failure message names the
 * call site that lost its hook.
 */
function assertResumeSinkWiring(source: string): void {
  const body = functionBody(normalizeSource(source), "async function resumeCommand(");
  const sites = executorCallSites(body, "a createExecutor call in resumeCommand");
  assert.equal(
    sites.length,
    2,
    "resumeCommand builds exactly two executors: supervised and flowchart --executor"
  );
  for (const args of sites) {
    assert.match(
      args,
      /onInvocation\s*:/,
      `resumeCommand calls createExecutor without an invocation hook: ${args}`
    );
    assert.match(
      args,
      /invocationSink\s*\(/,
      `resumeCommand's invocation hook does not use the shared sink: ${args}`
    );
  }
  assert.match(
    body,
    /const\s+invocationSink\s*=\s*createInvocationSink\(\s*stateRoot/,
    "both resume hooks must share one sink built from the resolved state root"
  );
}

test("both createExecutor call sites in resumeCommand pass the shared invocation hook", () => {
  assertResumeSinkWiring(MAIN_SOURCE);
});

test("no createExecutor call anywhere in main.ts is built without an invocation hook", () => {
  const normalized = normalizeSource(MAIN_SOURCE);
  const sites = executorCallSites(normalized, "a createExecutor call in main.ts");
  assert.equal(sites.length, 4, "run (2) and resume (2) are the only executor builders");
  for (const args of sites) {
    assert.match(args, /onInvocation\s*:/, `createExecutor called without a hook: ${args}`);
  }
  assert.match(
    MAIN_SOURCE,
    /import \{ createInvocationSink \} from "\.\.\/telemetry\/invocation-log\.js";/,
    "main.ts must import the sink factory, not hand-roll a fire-and-forget append"
  );
});

/**
 * Companion pin for the same two call sites, one field over.
 *
 * `resumeCommand` used to accept neither `--primary-model` nor `--thinking`, so
 * a run started on `--primary-model X --thinking high` resumed on whatever the
 * ambient defaults resolved to. Executor configuration is not recorded
 * anywhere (no event payload carries it, and `materializeCheckpoint` derives
 * the checkpoint from the replayed log), so the flags have to be re-accepted
 * and forwarded here. Like the sink, the effect is invisible to an offline
 * test — only `--executor pi` reads either value — so the wiring is what gets
 * pinned, and the mutants below keep the pin from passing vacuously. The
 * disclosure that goes with it is behavioural, and lives in
 * `test/unit/cli/resume-executor-config.test.ts`.
 */
function assertResumeExecutorConfigWiring(source: string): void {
  const raw = rawFunctionBody(source, "async function resumeCommand(");
  assert.match(
    raw,
    /"primary-model":\s*\{\s*type:\s*"string"\s*\}/,
    "resume's parseArgs must accept --primary-model"
  );
  assert.match(
    raw,
    /\bthinking:\s*\{\s*type:\s*"string"\s*\}/,
    "resume's parseArgs must accept --thinking"
  );
  const body = functionBody(normalizeSource(source), "async function resumeCommand(");
  assert.match(
    body,
    /const\s+thinkingLevel\s*=\s*resolveThinkingLevel\(\s*values\.thinking\s*\)/,
    "resume must resolve --thinking the same way run does"
  );
  assert.match(
    body,
    /const\s+modelOverride\s*=[^;]*tryParseModelRef\(/,
    "resume must parse --primary-model into a model ref the same way run does"
  );
  for (const args of executorCallSites(body, "a createExecutor call in resumeCommand")) {
    assert.match(
      args,
      /\bmodelOverride\b/,
      `resumeCommand rebuilds an executor without the requested model: ${args}`
    );
    assert.match(
      args,
      /\bthinkingLevel\b/,
      `resumeCommand rebuilds an executor without the requested thinking level: ${args}`
    );
  }
}

test("both createExecutor call sites in resumeCommand carry the requested executor config", () => {
  assertResumeExecutorConfigWiring(MAIN_SOURCE);
});

/**
 * Mutation check: each edit below is a way the wiring could realistically
 * regress, and the pin has to reject every one of them. A pin that passes on
 * these would be decoration.
 */
function mutateResume(replace: string, replacement: string): string {
  const start = MAIN_SOURCE.indexOf("async function resumeCommand(");
  assert.ok(start >= 0);
  const head = MAIN_SOURCE.slice(0, start);
  const tail = MAIN_SOURCE.slice(start);
  assert.ok(tail.includes(replace), `mutation target not found in resumeCommand: ${replace}`);
  return head + tail.replace(replace, replacement);
}

const MUTANTS: readonly { readonly name: string; readonly source: () => string }[] = [
  {
    name: "the supervised call site drops its hooks argument",
    source: () =>
      mutateResume("createExecutor(executorKind, stateRoot, {", "createExecutor(executorKind) ?? ({")
  },
  {
    name: "the flowchart call site drops its hooks argument",
    source: () =>
      mutateResume(
        "createExecutor(flowchartExecutorKind(values.executor), stateRoot, {",
        "createExecutor(flowchartExecutorKind(values.executor)) ?? ({"
      )
  },
  {
    name: "the hook survives only as a comment",
    source: () =>
      mutateResume(
        "createExecutor(executorKind, stateRoot, {",
        "createExecutor(executorKind /* onInvocation: invocationSink(x) */) ?? ({"
      )
  },
  {
    name: "a hook bypasses the shared sink",
    source: () => mutateResume("void invocationSink(invocation);", "void invocation;")
  },
  {
    name: "the sink is built from something other than the resolved state root",
    source: () =>
      mutateResume("createInvocationSink(stateRoot, {", "createInvocationSink(defaultStateRoot(), {")
  }
];

for (const mutant of MUTANTS) {
  test(`the resume pin fails when ${mutant.name}`, () => {
    assert.throws(
      () => {
        assertResumeSinkWiring(mutant.source());
      },
      assert.AssertionError,
      `mutant "${mutant.name}" slipped past the pin`
    );
  });
}

const CONFIG_MUTANTS: readonly { readonly name: string; readonly source: () => string }[] = [
  {
    name: "the supervised call site drops the requested config",
    source: () => mutateResume("}, modelOverride, thinkingLevel),", "}),")
  },
  {
    name: "the flowchart call site drops the requested config",
    source: () =>
      mutateResume("          }, modelOverride, thinkingLevel)\n", "          })\n")
  },
  {
    name: "the model override is parsed and then dropped on the way to the executor",
    source: () =>
      mutateResume("}, modelOverride, thinkingLevel),", "}, undefined, thinkingLevel),")
  },
  {
    name: "resume stops accepting --primary-model",
    source: () => mutateResume('      "primary-model": { type: "string" },\n', "")
  },
  {
    name: "resume stops accepting --thinking",
    source: () => mutateResume('      thinking: { type: "string" },\n', "")
  },
  {
    name: "the thinking flag is accepted but never resolved",
    source: () =>
      mutateResume("resolveThinkingLevel(values.thinking)", "resolveThinkingLevel(undefined)")
  }
];

for (const mutant of CONFIG_MUTANTS) {
  test(`the resume config pin fails when ${mutant.name}`, () => {
    assert.throws(
      () => {
        assertResumeExecutorConfigWiring(mutant.source());
      },
      assert.AssertionError,
      `mutant "${mutant.name}" slipped past the pin`
    );
  });
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

async function withRoots(run: (stateRoot: string, projectRoot: string) => Promise<void>) {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-sink-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-sink-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await withIsolatedPiEnv(() => run(stateRoot, projectRoot));
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

async function invocationRowCount(stateRoot: string): Promise<number> {
  const text = await readFile(invocationsLogPath(stateRoot), "utf8").catch(() => "");
  return text.split("\n").filter((line) => line.trim() !== "").length;
}

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

class ScriptedSupervisedExecutor implements AgentExecutor {
  async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    if (signal.aborted) {
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    const message: TaskResult = {
      protocolVersion: 1,
      id: createMessageId(UUID),
      occurredAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
      runId: request.runId,
      taskId: request.taskId,
      from: request.agentInstanceId,
      to: SUPERVISOR,
      type: "TASK_RESULT",
      outcome: "SUCCESS",
      summary: "done",
      artifactIds: [],
      evidenceIds: [],
      verification: { kind: "PASSED", evidenceIds: [] }
    };
    yield { type: "MESSAGE", message };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
}

function task(id: string): TaskNode {
  return {
    id: createTaskId(() => id),
    title: id,
    objective: `Do ${id}`,
    role: "worker",
    dependencies: [],
    acceptanceCriteria: [{ id: "ac-1", description: "works" }],
    status: "PENDING",
    attempt: 0,
    maxAttempts: 3,
    timeoutMs: 60_000,
    artifactIds: [],
    evidenceIds: []
  };
}

test("resume --supervised still completes with the invocation hook wired", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const running = startSupervisedRun(
      {
        stateRoot,
        executor: new ScriptedSupervisedExecutor(),
        registry: createAgentProfileRegistry(defaultAgentProfiles())
      },
      {
        projectRoot,
        objective: "Ship the parser",
        tasks: [task("a")]
      }
    );
    assert.equal((await running.done).status, "COMPLETED");

    const resumed = capture();
    const code = await main(
      ["resume", "--run", running.runId, "--supervised", "--state-root", stateRoot],
      resumed.io
    );
    assert.equal(code, 0, resumed.err.join(""));
    assert.match(resumed.out.join(""), /resumed \(COMPLETED\)/);
    assert.doesNotMatch(resumed.err.join(""), /invocation telemetry dropped/);
    // Honest scope note: the fake executors never call a model, so the hook is
    // inert for them. Only `--executor pi` produces rows, and this asserts the
    // wiring costs nothing on the paths a test can drive offline.
    assert.equal(await invocationRowCount(stateRoot), 0);
  });
});

const FLOWCHART = {
  id: "resume-sink",
  nodes: [
    {
      id: "only",
      taskId: "tsk_only",
      role: "actor",
      objective: "Do the work",
      modelPolicy: { allowedModels: ["cheap"] },
      confidenceThreshold: 0.7,
      approvalRequired: false
    }
  ],
  edges: []
};

const RESULTS = { only: { outcome: "SUCCESS", confidence: 0.9, evidenceIds: ["evd_only"] } };

test("resume --executor on a flowchart checkpoint still completes with the hook wired", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const flowchartPath = join(projectRoot, "flow.json");
    const resultsPath = join(projectRoot, "results.json");
    await writeFile(flowchartPath, JSON.stringify(FLOWCHART), "utf8");
    await writeFile(resultsPath, JSON.stringify(RESULTS), "utf8");

    const started = capture();
    const startCode = await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        "Ship",
        "--flowchart",
        flowchartPath,
        "--results",
        resultsPath,
        "--state-root",
        stateRoot
      ],
      started.io
    );
    assert.equal(startCode, 0, started.err.join(""));
    const runId = started.out.join("").match(/Run (run_[A-Za-z0-9_-]+):/)?.[1];
    assert.ok(runId);

    const resumed = capture();
    const code = await main(
      ["resume", "--run", runId, "--executor", "fake", "--state-root", stateRoot],
      resumed.io
    );
    assert.equal(code, 0, resumed.err.join(""));
    assert.match(resumed.out.join(""), /COMPLETED/);
    assert.doesNotMatch(resumed.err.join(""), /invocation telemetry dropped/);
    assert.equal(await invocationRowCount(stateRoot), 0);
  });
});
