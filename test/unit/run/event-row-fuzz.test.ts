import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import {
  createAgentInstanceId,
  createEpisodeId,
  createMessageId,
  createProjectId,
  createRunId,
  createTaskId
} from "../../../src/domain/ids.js";
import { EventStore } from "../../../src/run/event-store.js";
import {
  EVENT_TYPES,
  validateEvent,
  type Event,
  type M0EventType
} from "../../../src/run/events.js";
import { replayRun } from "../../../src/run/replay.js";
import { hashAssessment, parseTrackingAssessment } from "../../../src/tracking/types.js";
import { makeEvent, makeRun } from "../../helpers/event-factory.js";

const DEFAULT_SEED = 0x4f33_0004;
const FUZZ_TIMEOUT_MS = 5_000;
const ITERATIONS_PER_TYPE = 120;
const FILE_ITERATIONS = 180;
const UUID = (): string => "01234567-89ab-cdef-0123-456789abcdef";
const NOW = "2026-08-24T12:00:00.000Z";
const RUN_ID = createRunId(UUID);
const CHILD_RUN_ID = createRunId(() => "11111111-2222-3333-4444-555555555555");
const TASK_ID = createTaskId(UUID);
const MESSAGE_ID = createMessageId(UUID);
const AGENT_ID = createAgentInstanceId(UUID);
const EPISODE_ID = createEpisodeId(UUID);

const PROJECT = {
  id: createProjectId(UUID),
  rootPath: "/tmp/event-fuzz",
  discoveredAt: NOW,
  instructionFiles: [],
  manifests: [],
  commands: [],
  facts: []
};

const RUN = makeRun();
const CHILD_RUN = { ...makeRun(), id: CHILD_RUN_ID, parentRunId: RUN_ID };
const TASK = {
  id: TASK_ID,
  title: "Fuzz event rows",
  objective: "Keep event decoding fail-closed",
  role: "tester",
  dependencies: [],
  acceptanceCriteria: [{ id: "ac-1", description: "Decoder keeps its error contract" }],
  status: "PENDING",
  attempt: 0,
  maxAttempts: 2,
  timeoutMs: 60_000,
  artifactIds: [],
  evidenceIds: []
};
const MESSAGE = {
  protocolVersion: 1,
  id: MESSAGE_ID,
  occurredAt: NOW,
  runId: CHILD_RUN_ID,
  taskId: TASK_ID,
  from: AGENT_ID,
  to: "SUPERVISOR",
  type: "QUESTION",
  question: "Continue fuzzing?",
  options: ["Yes", "No"]
};
const APPROVAL_PLAN = {
  id: "plan-fuzz",
  items: [{ id: "continue", label: "Continue", selectable: true }]
};
const EPISODE = {
  id: EPISODE_ID,
  projectId: PROJECT.id,
  objective: "Fuzz event rows",
  contractVersion: 1,
  runIds: [RUN_ID],
  startedAt: NOW,
  status: "OPEN",
  acceptance: [
    {
      id: "accept-1",
      description: "Decoder keeps its error contract",
      observableCheck: "pnpm test -- test/unit/run/event-row-fuzz.test.ts"
    }
  ],
  evidenceRefs: []
};
const ASSESSMENT = parseTrackingAssessment({
  schemaVersion: 1,
  episodeId: EPISODE_ID,
  runId: RUN_ID,
  turnId: "turn-fuzz",
  prescore: 1,
  quality: 1,
  coverage: 1,
  human: { kind: "unobserved" },
  score: 1,
  dimensions: [{ id: "check-coverage", verdict: "PASS", evidenceRefs: ["evd_fuzz"] }],
  gate: {
    kind: "none",
    codes: [],
    wakeAnalysis: false,
    expandDetail: false,
    askUser: false,
    openMinors: []
  },
  evidenceRefs: ["evd_fuzz"]
});

const EVENT_SEEDS = {
  PROJECT_DISCOVERED: makeEvent("PROJECT_DISCOVERED", { project: PROJECT }),
  RUN_CREATED: makeEvent("RUN_CREATED", { run: RUN }),
  RUN_STARTED: makeEvent("RUN_STARTED", {}),
  AGENT_STARTED: makeEvent("AGENT_STARTED", { agentInstanceId: AGENT_ID, taskId: TASK_ID }),
  AGENT_EVENT: makeEvent("AGENT_EVENT", {
    agentInstanceId: AGENT_ID,
    kind: "TOOL_FINISHED",
    summary: "Fuzzed event rows"
  }),
  AGENT_FINISHED: makeEvent("AGENT_FINISHED", {
    agentInstanceId: AGENT_ID,
    outcome: "SUCCESS"
  }),
  RUN_COMPLETED: makeEvent("RUN_COMPLETED", {}),
  RUN_FAILED: makeEvent("RUN_FAILED", { reason: "fuzz fixture" }),
  RUN_CANCEL_REQUESTED: makeEvent("RUN_CANCEL_REQUESTED", {}),
  CHILD_RUN_CREATED: makeEvent("CHILD_RUN_CREATED", { childRun: CHILD_RUN }),
  CHILD_MESSAGE: makeEvent("CHILD_MESSAGE", { message: MESSAGE }),
  TASK_TIMEOUT: makeEvent("TASK_TIMEOUT", { childRunId: CHILD_RUN_ID, attempt: 1 }),
  TASK_RETRY: makeEvent("TASK_RETRY", {
    childRunId: CHILD_RUN_ID,
    attempt: 1,
    reason: "retry fuzz fixture",
    previousModel: "small",
    nextModel: "large",
    nextModelVersion: "large-v1"
  }),
  RUN_WAITING_FOR_USER: makeEvent("RUN_WAITING_FOR_USER", {
    messageId: MESSAGE_ID,
    approvalPlan: APPROVAL_PLAN
  }),
  USER_ANSWER: makeEvent("USER_ANSWER", {
    messageId: MESSAGE_ID,
    answer: "Continue",
    approvalReply: {
      approvalPlanId: APPROVAL_PLAN.id,
      selectedActionIds: ["continue"]
    }
  }),
  TASK_GRAPH_ACCEPTED: makeEvent("TASK_GRAPH_ACCEPTED", { tasks: [TASK] }),
  TASK_LEASED: makeEvent("TASK_LEASED", {
    taskId: TASK_ID,
    childRunId: CHILD_RUN_ID,
    expiresAt: NOW
  }),
  TASK_LEASE_EXPIRED: makeEvent("TASK_LEASE_EXPIRED", {
    taskId: TASK_ID,
    childRunId: CHILD_RUN_ID
  }),
  TASK_STATUS_CHANGED: makeEvent("TASK_STATUS_CHANGED", {
    taskId: TASK_ID,
    status: "RUNNING",
    attempt: 1
  }),
  LEDGER_UPDATED: makeEvent("LEDGER_UPDATED", {
    revision: 1,
    round: 1,
    consecutiveStalls: 0,
    isBlocked: false
  }),
  STALL_DETECTED: makeEvent("STALL_DETECTED", {
    round: 2,
    consecutiveStalls: 1,
    requiredEvidence: ["evd_fuzz"]
  }),
  JUDGE_DECISION: makeEvent("JUDGE_DECISION", {
    taskId: TASK_ID,
    verdict: "APPROVED",
    evidenceIds: ["evd_fuzz"],
    reason: "fixture is valid"
  }),
  MODEL_ROUTED: makeEvent("MODEL_ROUTED", {
    taskId: TASK_ID,
    role: "actor",
    complexity: "MEDIUM",
    model: "fuzz-model",
    justification: "deterministic fixture",
    confidence: 1,
    approvalPlan: APPROVAL_PLAN,
    statusAfterRoute: "RUNNING",
    policyVersion: "router-v1",
    estimatedCostUsd: 0,
    estimatedDurationMs: 1,
    family: "test",
    featureVersion: "fuzz-v1",
    modelVersion: "fuzz-model-v1",
    highRisk: false,
    eligibleModels: ["fuzz-model"],
    rejections: [],
    behaviorDistribution: { "fuzz-model": 1 },
    agentRole: "tester",
    coldStartRoutingScore: 1
  }),
  RUN_BLOCKED: makeEvent("RUN_BLOCKED", {
    reason: "needs evidence",
    requiredEvidence: ["evd_fuzz"]
  }),
  PAUSE_REQUESTED: makeEvent("PAUSE_REQUESTED", { reason: "inspect fuzz state" }),
  PAUSE_CLEARED: makeEvent("PAUSE_CLEARED", {}),
  INJECTION_REQUESTED: makeEvent("INJECTION_REQUESTED", {
    kind: "fact",
    actor: "tester",
    confidence: 1,
    key: "seed",
    value: DEFAULT_SEED
  }),
  EPISODE_OPENED: makeEvent("EPISODE_OPENED", { episode: EPISODE }),
  RUN_ATTACHED: makeEvent("RUN_ATTACHED", {
    episodeId: EPISODE_ID,
    runId: RUN_ID,
    attachedAt: NOW
  }),
  EPISODE_WAITING: makeEvent("EPISODE_WAITING", {
    episodeId: EPISODE_ID,
    reason: "fuzzing",
    requiredEvidence: ["evd_fuzz"]
  }),
  EPISODE_CLOSED: makeEvent("EPISODE_CLOSED", {
    episodeId: EPISODE_ID,
    status: "COMPLETED",
    closedAt: NOW,
    outcomeId: "outcome-fuzz"
  }),
  TRACKING_ASSESSMENT: makeEvent("TRACKING_ASSESSMENT", {
    assessment: ASSESSMENT,
    assessmentHash: hashAssessment(ASSESSMENT),
    seq: 0
  }),
  GATE_TRANSITION: makeEvent("GATE_TRANSITION", {
    transitionId: "transition-fuzz",
    episodeId: EPISODE_ID,
    turnId: "turn-fuzz",
    seq: 0,
    from: "RUNNING",
    to: "WAITING_FOR_USER",
    reasonCode: "soft-threshold",
    assessmentHash: hashAssessment(ASSESSMENT),
    evidenceRefs: ["evd_fuzz"],
    policyVersion: "track-v1",
    idempotencyKey: "fuzz:0",
    directive: "wait_user"
  })
} satisfies Record<M0EventType, Event>;

class XorShift32 {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  nextUint32(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state;
  }

  int(limit: number): number {
    assert.ok(limit > 0);
    return this.nextUint32() % limit;
  }

  pick<T>(values: readonly T[]): T {
    return values[this.int(values.length)]!;
  }
}

interface Containers {
  readonly records: Record<string, unknown>[];
  readonly arrays: unknown[][];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isMutableRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectContainers(value: unknown): Containers {
  const records: Record<string, unknown>[] = [];
  const arrays: unknown[][] = [];

  function visit(candidate: unknown, depth: number): void {
    if (depth > 7 || records.length + arrays.length >= 128) return;
    if (Array.isArray(candidate)) {
      arrays.push(candidate);
      for (const child of candidate.slice(0, 16)) visit(child, depth + 1);
      return;
    }
    if (!isMutableRecord(candidate)) return;
    records.push(candidate);
    for (const child of Object.values(candidate)) visit(child, depth + 1);
  }

  visit(value, 0);
  return { records, arrays };
}

function invalidValue(random: XorShift32): unknown {
  return clone(
    random.pick([
      null,
      undefined,
      true,
      false,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      2 ** 53,
      "",
      " ",
      "\u200b",
      "\ud800",
      "\0",
      "UNKNOWN_ENUM",
      [],
      {}
    ])
  );
}

function populatedRecord(
  records: readonly Record<string, unknown>[],
  random: XorShift32
): Record<string, unknown> | undefined {
  const populated = records.filter((record) => Object.keys(record).length > 0);
  return populated.length === 0 ? undefined : random.pick(populated);
}

function corruptSemanticField(root: unknown, random: XorShift32): unknown {
  const { records } = collectContainers(root);
  const candidates = records.flatMap((record) =>
    Object.keys(record)
      .filter(
        (key) =>
          /^(schemaVersion|protocolVersion|type|status|kind|outcome|verdict|directive|from|to|occurredAt|attachedAt|closedAt|createdAt|updatedAt|expiresAt|attempt|round|seq|confidence)$/.test(
            key
          ) || /(^id$|Id$|Ids$|Refs$)/.test(key)
      )
      .map((key) => ({ key, record }))
  );
  if (candidates.length === 0) return invalidValue(random);

  const { key, record } = random.pick(candidates);
  if (/At$/.test(key)) {
    record[key] = random.pick(["later", "2026-13-40T25:61:61Z", 0, null]);
  } else if (/^(schemaVersion|protocolVersion|attempt|round|seq|confidence)$/.test(key)) {
    record[key] = random.pick([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1"]);
  } else if (/(^id$|Id$|Ids$|Refs$)/.test(key)) {
    record[key] = random.pick(["bad id", "\u200b", 2 ** 53, null]);
  } else {
    record[key] = invalidValue(random);
  }
  return root;
}

function mutateOnce(input: unknown, random: XorShift32, mutationKind: number): unknown {
  const root = clone(input);
  const { records, arrays } = collectContainers(root);

  switch (mutationKind % 8) {
    case 0: {
      const record = populatedRecord(records, random);
      if (record === undefined) return invalidValue(random);
      delete record[random.pick(Object.keys(record))];
      return root;
    }
    case 1: {
      const record = populatedRecord(records, random);
      if (record === undefined) return invalidValue(random);
      record[random.pick(Object.keys(record))] = invalidValue(random);
      return root;
    }
    case 2:
      return invalidValue(random);
    case 3: {
      if (arrays.length === 0) return corruptSemanticField(root, random);
      const array = random.pick(arrays);
      const exemplar = array.length === 0 ? invalidValue(random) : array[random.int(array.length)];
      const targetLength = 32 + random.int(65);
      while (array.length < targetLength) array.push(clone(exemplar));
      return root;
    }
    case 4: {
      if (records.length === 0) return root;
      Object.defineProperty(random.pick(records), random.pick(["__proto__", "constructor"]), {
        value: { prototype: { polluted: true }, polluted: true },
        enumerable: true,
        configurable: true,
        writable: true
      });
      return root;
    }
    case 5:
      return corruptSemanticField(root, random);
    case 6: {
      const record = populatedRecord(records, random);
      if (record === undefined) return invalidValue(random);
      const key = random.pick(Object.keys(record));
      let nested: unknown = "leaf";
      for (let depth = 0; depth < 1 + random.int(10); depth += 1) nested = { nested };
      record[key] = nested;
      return root;
    }
    default: {
      if (records.length === 0) return root;
      random.pick(records)[`unknown_${random.nextUint32().toString(16)}`] = invalidValue(random);
      return root;
    }
  }
}

function mutate(input: unknown, random: XorShift32, iteration: number): unknown {
  let candidate = clone(input);
  const count = 1 + random.int(3);
  for (let step = 0; step < count; step += 1) {
    candidate = mutateOnce(candidate, random, iteration + step);
  }
  return candidate;
}

function jsonText(value: unknown): string {
  return JSON.stringify(value) ?? "null";
}

function mutateJsonText(value: unknown, random: XorShift32, iteration: number): string {
  const json = jsonText(value);
  switch (iteration % 7) {
    case 0:
      return json;
    case 1:
      return json.slice(0, random.int(json.length + 1));
    case 2:
      return `${json}${random.pick(["x", " null", "]", "\0"])}`;
    case 3: {
      const index = random.int(json.length);
      return `${json.slice(0, index)}${random.pick(["{", "]", "\"", "\\x", "\0"])}${json.slice(index + 1)}`;
    }
    case 4:
      return `${random.pick(["!", "]", "undefined", "\0"])}${json}`;
    case 5: {
      const start = random.int(json.length + 1);
      const length = Math.min(32, json.length - start);
      return `${json.slice(0, start)}${json.slice(start, start + length)}${json.slice(start)}`;
    }
    default:
      return `${json.slice(0, Math.min(json.length, 64))}\\`;
  }
}

function seedText(): string {
  return `0x${DEFAULT_SEED.toString(16).padStart(8, "0")}`;
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function failFuzz(context: string, error: unknown): never {
  const detail = errorDetail(error);
  process.stderr.write(`[event row fuzz] seed=${seedText()} ${context}: ${detail}\n`);
  throw new Error(`Event row fuzz invariant failed (seed=${seedText()}, ${context}): ${detail}`, {
    cause: error
  });
}

function isExactDomainValidationError(error: unknown): error is DomainValidationError {
  return error instanceof Error && error.constructor === DomainValidationError;
}

function assertEventInvariant(value: unknown, context: string): void {
  let validated: Event;
  try {
    validated = validateEvent(value);
  } catch (error) {
    if (!isExactDomainValidationError(error)) failFuzz(context, error);
    return;
  }

  try {
    assert.deepEqual(validateEvent(validated), validated);
    assert.deepEqual(replayRun([validated]), replayRun([validated]));
  } catch (error) {
    failFuzz(`${context}, revalidation/replay`, error);
  }
}

async function withStateRoot(run: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-event-row-fuzz-"));
  try {
    await run(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

test("corrupt middle event-log lines fail with exactly DomainValidationError", async () => {
  await withStateRoot(async (stateRoot) => {
    const path = join(stateRoot, "runtime", "runs", RUN_ID, "events.jsonl");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      `${jsonText(EVENT_SEEDS.RUN_STARTED)}\nNOT JSON\n${jsonText(EVENT_SEEDS.RUN_COMPLETED)}\n`,
      "utf8"
    );

    await assert.rejects(
      () => new EventStore(stateRoot, RUN_ID).readAll(),
      (error: unknown) =>
        isExactDomainValidationError(error) &&
        error.message === "Corrupt event log line 2"
    );
  });
});

test(
  "seeded mutations preserve validateEvent discipline per event type and replay determinism",
  { timeout: FUZZ_TIMEOUT_MS },
  () => {
    assert.deepEqual(Object.keys(EVENT_SEEDS), EVENT_TYPES);
    const random = new XorShift32(DEFAULT_SEED);

    for (const type of EVENT_TYPES) {
      const seed = EVENT_SEEDS[type];
      assert.deepEqual(validateEvent(seed), seed, `invalid seed fixture for ${type}`);
      for (let iteration = 0; iteration < ITERATIONS_PER_TYPE; iteration += 1) {
        assertEventInvariant(
          mutate(seed, random, iteration),
          `validateEvent type=${type} iteration=${iteration}`
        );
      }
    }
  }
);

test(
  "seeded corrupted middle rows preserve EventStore.readAll error discipline",
  { timeout: FUZZ_TIMEOUT_MS },
  async () => {
    await withStateRoot(async (stateRoot) => {
      const path = join(stateRoot, "runtime", "runs", RUN_ID, "events.jsonl");
      await mkdir(dirname(path), { recursive: true });
      const store = new EventStore(stateRoot, RUN_ID);
      const random = new XorShift32(DEFAULT_SEED ^ 0xc077_04ed);

      for (let iteration = 0; iteration < FILE_ITERATIONS; iteration += 1) {
        const type = EVENT_TYPES[iteration % EVENT_TYPES.length]!;
        const candidate = mutate(EVENT_SEEDS[type], random, iteration);
        const row = mutateJsonText(candidate, random, iteration);
        await writeFile(
          path,
          `${jsonText(EVENT_SEEDS.RUN_STARTED)}\n${row}\n${jsonText(EVENT_SEEDS.RUN_COMPLETED)}\n`,
          "utf8"
        );

        let events: Event[];
        try {
          events = (await store.readAll()).events;
        } catch (error) {
          if (!isExactDomainValidationError(error)) {
            failFuzz(`EventStore.readAll type=${type} iteration=${iteration}`, error);
          }
          continue;
        }

        try {
          for (const event of events) assert.deepEqual(validateEvent(event), event);
          assert.deepEqual(replayRun(events), replayRun(events));
          assert.deepEqual((await store.readAll()).events, events);
        } catch (error) {
          failFuzz(`EventStore.readAll type=${type} iteration=${iteration}, reread/replay`, error);
        }
      }
    });
  }
);
