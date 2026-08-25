import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  Type,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Context,
  type FauxResponseStep
} from "@earendil-works/pi-ai";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { createTaskId, type AgentInstanceId } from "../../../src/domain/ids.js";
import type {
  AgentExecutionRequest,
  AgentExecutor,
  ExecutionEvent
} from "../../../src/execution/contract.js";
import { PiAgentExecutor } from "../../../src/pi-adapter/pi-executor.js";
import type { ChildTaskInput } from "../../../src/run/child-coordinator.js";
import { startParentRun, startRun, type RunningRun } from "../../../src/run/coordinator.js";
import type { Event, SteerInjectedPayload } from "../../../src/run/events.js";

/**
 * A steer must land in the run whose handle accepted it, and nowhere else.
 *
 * One `PiAgentExecutor` serves concurrent runs, and between the attempts of a
 * retried execution its kernel is gone from the executor's live map. Without a
 * target the executor's sole-live rule then hands the text to whichever other
 * run happens to be live: that run's model sees an instruction nobody aimed at
 * it, its `acceptedSteers` would re-deliver the instruction on its own retry,
 * and the aiming run's log records `STEER_INJECTED` naming an agent instance
 * that never received a word of it. `AgentExecutor.steerText` therefore carries
 * the caller's agent instance, and a targeted miss is a loud refusal.
 */

const STEER_TEXT = "RUN-A ONLY: stop the schema migration immediately.";
const RATE_LIMIT = '429: {"error":{"message":"rate limit exceeded"}}';
const OBJECTIVE_A = "RUN-A: audit the schema";
const OBJECTIVE_B = "RUN-B: refactor the parser";
/** Nothing here waits on wall clock; the timers only stop a hang from hanging. */
const FALLBACK_MS = 10_000;

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function deferred(): Deferred {
  let settle: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve: () => settle?.()
  };
}

function userTurnsOf(context: Context): string[] {
  return context.messages
    .filter((message) => message.role === "user")
    .map((message) => JSON.stringify(message.content));
}

/** Which run a provider call belongs to, read off its opening user turn. */
function runOf(turns: readonly string[]): "A" | "B" | undefined {
  const opening = turns[0] ?? "";
  if (opening.includes(OBJECTIVE_A)) return "A";
  if (opening.includes(OBJECTIVE_B)) return "B";
  return undefined;
}

function callsOf(calls: readonly (readonly string[])[], run: "A" | "B"): readonly (readonly string[])[] {
  return calls.filter((turns) => runOf(turns) === run);
}

function callsCarryingSteer(
  calls: readonly (readonly string[])[]
): readonly (readonly string[])[] {
  return calls.filter((turns) => turns.some((turn) => turn.includes(STEER_TEXT)));
}

function steerEvents(events: readonly Event[]): readonly Event[] {
  return events.filter((event) => event.type === "STEER_INJECTED");
}

const hookParameters = Type.Object({});

/**
 * Holds each turn that calls it open until the test releases it. Invocations
 * are handed out in order, which is deterministic here because every start is
 * gated on the previous hook already being inside its `execute`.
 */
function blockingHook(holds: readonly { started: Deferred; release: Deferred }[]): {
  tool: AgentTool<typeof hookParameters, Record<string, never>>;
  releaseAll: () => void;
} {
  let index = 0;
  return {
    tool: {
      name: "blocking_hook",
      label: "Blocking hook",
      description: "Hold this turn open until the test releases it.",
      parameters: hookParameters,
      execute: async () => {
        const hold = holds[index];
        index += 1;
        if (hold === undefined) throw new Error("blocking_hook called more times than the test scripted");
        hold.started.resolve();
        await hold.release.promise;
        return { content: [{ type: "text", text: "hook released" }], details: {} };
      }
    },
    releaseAll: () => {
      for (const hold of holds) hold.release.resolve();
    }
  };
}

interface Roots {
  readonly stateRoot: string;
  readonly projectRoot: string;
}

/**
 * Each run gets its own state and project root: the two runs share an executor,
 * which is the whole point, and nothing else.
 */
async function withRoots(body: (a: Roots, b: Roots) => Promise<void>): Promise<void> {
  const made: string[] = [];
  const make = async (prefix: string): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    made.push(dir);
    return dir;
  };
  const a: Roots = { stateRoot: await make("pi-sparkle-state-a-"), projectRoot: await make("pi-sparkle-proj-a-") };
  const b: Roots = { stateRoot: await make("pi-sparkle-state-b-"), projectRoot: await make("pi-sparkle-proj-b-") };
  try {
    await body(a, b);
  } finally {
    // Retried and swallowed so a failing assertion is the error a reader sees,
    // not this teardown racing a run that is still writing.
    for (const dir of made) {
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(
        () => undefined
      );
    }
  }
}

function sharedExecutor(options: {
  readonly steps: FauxResponseStep[];
  readonly tools: AgentTool<typeof hookParameters, Record<string, never>>[];
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly onRetry?: () => void;
}): PiAgentExecutor {
  const faux = fauxProvider({
    provider: "steer-target-faux",
    models: [{ id: "steer-target-model", name: "Steer target model" }]
  });
  faux.setResponses(options.steps);
  const models = createModels();
  models.setProvider(faux.provider);
  return new PiAgentExecutor({
    providerId: "steer-target-faux",
    modelId: "steer-target-model",
    models,
    tools: options.tools,
    retry: {
      maxAttempts: 3,
      random: () => 0,
      ...(options.sleep !== undefined ? { sleep: options.sleep } : {}),
      ...(options.onRetry !== undefined ? { onRetry: options.onRetry } : {})
    }
  });
}

test("a steer aimed at a run in retry backoff is refused, not delivered into a run sharing the executor", async () => {
  await withRoots(async (rootsA, rootsB) => {
    const holdB = { started: deferred(), release: deferred() };
    const hook = blockingHook([holdB]);
    const backoffReached = deferred();
    const releaseBackoff = deferred();

    const calls: string[][] = [];
    let aCalls = 0;
    let bCalls = 0;
    const respond = (context: Context) => {
      const turns = userTurnsOf(context);
      calls.push(turns);
      if (runOf(turns) === "A") {
        aCalls += 1;
        // Attempt 1 dies on a retryable failure, which puts run A into the
        // backoff window this test is about.
        if (aCalls === 1) throw new Error(RATE_LIMIT);
        return fauxAssistantMessage("run A restarted after the rate limit");
      }
      bCalls += 1;
      if (bCalls === 1) {
        return fauxAssistantMessage([fauxToolCall("blocking_hook", {})], { stopReason: "toolUse" });
      }
      return fauxAssistantMessage("run B finished the refactor");
    };

    const executor = sharedExecutor({
      steps: [respond, respond, respond, respond],
      tools: [hook.tool],
      sleep: async () => {
        backoffReached.resolve();
        await releaseBackoff.promise;
      }
    });

    const fallback = setTimeout(() => {
      releaseBackoff.resolve();
      hook.releaseAll();
    }, FALLBACK_MS);
    // Held outside the try so a failed assertion still lets both runs finish
    // writing before the temp roots go away; otherwise the teardown's own
    // ENOTEMPTY would be the only error a reader sees.
    const started: RunningRun[] = [];

    try {
      const runA = startRun({ stateRoot: rootsA.stateRoot, executor }, {
        projectRoot: rootsA.projectRoot,
        objective: OBJECTIVE_A
      });
      started.push(runA);
      await backoffReached.promise;

      // Control: the frozen unshared behaviour. Run A's window is open, its
      // agent is between attempts, and no other run is live — a loud refusal.
      assert.throws(() => runA.steer(STEER_TEXT), DomainValidationError);
      assert.throws(() => runA.steer(STEER_TEXT), /no agent run is in flight/);

      const runB = startRun({ stateRoot: rootsB.stateRoot, executor }, {
        projectRoot: rootsB.projectRoot,
        objective: OBJECTIVE_B
      });
      started.push(runB);
      await holdB.started.promise;

      // The regression: run B is now the executor's only live kernel, and run
      // A's own handle must still refuse rather than borrow it.
      assert.throws(() => runA.steer(STEER_TEXT), DomainValidationError);
      assert.throws(() => runA.steer(STEER_TEXT), /no agent run is in flight/);

      releaseBackoff.resolve();
      const outcomeA = await runA.done;
      hook.releaseAll();
      const outcomeB = await runB.done;

      assert.equal(outcomeA.status, "COMPLETED");
      assert.equal(outcomeB.status, "COMPLETED");

      // Neither run's model was ever told: the refusal dropped nothing into a
      // context, least of all somebody else's.
      assert.deepEqual(
        callsCarryingSteer(callsOf(calls, "A")),
        [],
        `no run A model call may carry the steer, got ${JSON.stringify(calls)}`
      );
      assert.deepEqual(
        callsCarryingSteer(callsOf(calls, "B")),
        [],
        `run B must not be handed run A's instruction, got ${JSON.stringify(calls)}`
      );
      assert.equal(callsOf(calls, "A").length, 2, JSON.stringify(calls));
      assert.equal(callsOf(calls, "B").length, 2, JSON.stringify(calls));

      // And no durable record claims otherwise: not a false one on A, whose
      // payload names A's agent instance, nor a stolen one on B.
      assert.deepEqual(steerEvents(outcomeA.events), []);
      assert.deepEqual(steerEvents(outcomeB.events), []);
    } finally {
      clearTimeout(fallback);
      releaseBackoff.resolve();
      hook.releaseAll();
      await Promise.allSettled(started.map((run) => run.done));
    }
  });
});

test("a steer through a live run's own handle reaches that run and no other on the same executor", async () => {
  await withRoots(async (rootsA, rootsB) => {
    const holdA = { started: deferred(), release: deferred() };
    const holdB = { started: deferred(), release: deferred() };
    const hook = blockingHook([holdA, holdB]);

    const calls: string[][] = [];
    let aCalls = 0;
    let bCalls = 0;
    const respond = (context: Context) => {
      const turns = userTurnsOf(context);
      calls.push(turns);
      if (runOf(turns) === "A") {
        aCalls += 1;
        if (aCalls === 1) {
          return fauxAssistantMessage([fauxToolCall("blocking_hook", {})], { stopReason: "toolUse" });
        }
        return fauxAssistantMessage("run A acknowledged the change of direction");
      }
      bCalls += 1;
      if (bCalls === 1) {
        return fauxAssistantMessage([fauxToolCall("blocking_hook", {})], { stopReason: "toolUse" });
      }
      return fauxAssistantMessage("run B finished the refactor");
    };

    const executor = sharedExecutor({ steps: [respond, respond, respond, respond], tools: [hook.tool] });
    const fallback = setTimeout(() => hook.releaseAll(), FALLBACK_MS);
    const started: RunningRun[] = [];

    try {
      const runA = startRun({ stateRoot: rootsA.stateRoot, executor }, {
        projectRoot: rootsA.projectRoot,
        objective: OBJECTIVE_A
      });
      started.push(runA);
      await holdA.started.promise;
      const runB = startRun({ stateRoot: rootsB.stateRoot, executor }, {
        projectRoot: rootsB.projectRoot,
        objective: OBJECTIVE_B
      });
      started.push(runB);
      await holdB.started.promise;

      // Two live kernels: an untargeted steer has nothing to go on and refuses,
      // which is what makes the run handle's own target load-bearing here.
      assert.throws(() => executor.steerText(STEER_TEXT), /2 agent runs are in flight/);
      await runA.steer(STEER_TEXT, { actor: "supervisor" });

      holdA.release.resolve();
      const outcomeA = await runA.done;
      holdB.release.resolve();
      const outcomeB = await runB.done;

      assert.equal(outcomeA.status, "COMPLETED");
      assert.equal(outcomeB.status, "COMPLETED");

      const steeredACalls = callsCarryingSteer(callsOf(calls, "A"));
      assert.equal(
        steeredACalls.length,
        1,
        `run A's next model call must carry the steer exactly once, got ${JSON.stringify(calls)}`
      );
      assert.deepEqual(
        callsCarryingSteer(callsOf(calls, "B")),
        [],
        `run B must never see run A's steer, got ${JSON.stringify(calls)}`
      );

      const steeredA = steerEvents(outcomeA.events);
      assert.equal(steeredA.length, 1);
      assert.equal(steeredA[0]?.actor, "supervisor");
      assert.equal((steeredA[0]?.payload as SteerInjectedPayload).text, STEER_TEXT);
      const agentStartedA = outcomeA.events.find((event) => event.type === "AGENT_STARTED");
      assert.equal(
        (steeredA[0]?.payload as SteerInjectedPayload).agentInstanceId,
        (agentStartedA?.payload as { agentInstanceId: string }).agentInstanceId
      );
      assert.deepEqual(steerEvents(outcomeB.events), []);
    } finally {
      clearTimeout(fallback);
      hook.releaseAll();
      await Promise.allSettled(started.map((run) => run.done));
    }
  });
});

/**
 * Records the target each steer arrives with, so the parent path's "no target"
 * is an assertion rather than a reading of the call site.
 */
class TargetRecordingExecutor implements AgentExecutor {
  readonly seen: (AgentInstanceId | undefined)[] = [];
  readonly started: Promise<void>;
  private inFlight = false;
  private resolveStarted!: () => void;
  private readonly release = deferred();

  constructor() {
    this.started = new Promise<void>((resolve) => {
      this.resolveStarted = resolve;
    });
  }

  steerText(text: string, agentInstanceId?: AgentInstanceId): void {
    if (text.trim() === "") {
      throw new DomainValidationError("steer text must be a non-empty string");
    }
    if (!this.inFlight) {
      throw new DomainValidationError("cannot steer: no agent run is in flight");
    }
    this.seen.push(agentInstanceId);
  }

  finish(): void {
    this.release.resolve();
  }

  async *execute(_request: AgentExecutionRequest, _signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    this.inFlight = true;
    try {
      this.resolveStarted();
      yield { type: "TEXT_DELTA", text: "working" };
      await this.release.promise;
      yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
    } finally {
      this.inFlight = false;
    }
  }
}

function childInput(): ChildTaskInput {
  const registry = createAgentProfileRegistry(defaultAgentProfiles());
  return {
    taskId: createTaskId(() => "steer-target-child"),
    role: "implementer",
    objective: "hold the parent's only child in flight",
    profile: registry.resolve("implementer"),
    inputArtifactIds: [],
    acceptanceCriteria: [],
    limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 300_000 }
  };
}

test("a parent run steers whichever child is live, naming no agent instance", async () => {
  await withRoots(async (roots) => {
    const executor = new TargetRecordingExecutor();
    const running = startParentRun({ stateRoot: roots.stateRoot, executor }, {
      projectRoot: roots.projectRoot,
      objective: "supervise one child",
      children: [childInput()]
    });

    try {
      await executor.started;
      await running.steer("narrow the scope", { actor: "supervisor" });
    } finally {
      executor.finish();
    }
    const outcome = await running.done;

    // A parent has no agent of its own, so it must ask for the executor's
    // disclosed whichever-child targeting rather than invent an instance.
    assert.deepEqual(executor.seen, [undefined]);

    const steered = steerEvents(outcome.events);
    assert.equal(steered.length, 1);
    const payload = steered[0]?.payload as SteerInjectedPayload;
    assert.equal(payload.text, "narrow the scope");
    // Still no `agentInstanceId` on the parent's record: nothing here knows
    // which child heard it, and a guessed instance is the false record this
    // whole seam exists to prevent.
    assert.deepEqual(Object.keys(payload), ["text"]);
  });
});
