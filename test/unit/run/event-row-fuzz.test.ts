import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import {
  createAgentInstanceId,
  createEpisodeId,
  createEventId,
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
import { validateAgentMessage } from "../../../src/protocol/v1.js";
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
const BLOCKED_EVENT_ID = createEventId(() => "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
const ROUTE_EVENT_ID = createEventId(() => "bbbbbbbb-cccc-dddd-eeee-ffffffffffff");

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
  RUN_UNBLOCKED: makeEvent("RUN_UNBLOCKED", {
    blockedEventId: BLOCKED_EVENT_ID,
    reason: "operator reviewed the queued analysis",
    retryNodeId: "node-fuzz"
  }),
  RUN_UNBLOCKED_WITH_DISCARD: makeEvent("RUN_UNBLOCKED_WITH_DISCARD", {
    blockedEventId: BLOCKED_EVENT_ID,
    reason: "operator authorized discarding the executed branch",
    retryNodeId: "node-fuzz",
    rewoundDescendants: [
      {
        nodeId: "node-fuzz-left",
        taskId: TASK_ID,
        previousState: "COMPLETED",
        modelRouteEventIds: [ROUTE_EVENT_ID],
        childRunIds: [CHILD_RUN_ID],
        chargedEstimatedCostUsd: 0.5,
        chargedEstimatedDurationMs: 4_000
      },
      {
        nodeId: "node-fuzz-right",
        taskId: TASK_ID,
        previousState: "SKIPPED",
        modelRouteEventIds: [],
        childRunIds: [],
        chargedEstimatedCostUsd: 0,
        chargedEstimatedDurationMs: 0
      }
    ]
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
  STEER_INJECTED: makeEvent("STEER_INJECTED", {
    text: "focus the remaining work on the failing fuzz invariant",
    agentInstanceId: AGENT_ID
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

type RunUnblockedPayloadKeys = keyof Extract<Event, { type: "RUN_UNBLOCKED" }>["payload"];
type RunUnblockedPayloadKeysAreExact =
  [RunUnblockedPayloadKeys] extends ["blockedEventId" | "reason" | "retryNodeId"]
    ? ["blockedEventId" | "reason" | "retryNodeId"] extends [RunUnblockedPayloadKeys]
      ? true
      : false
    : false;

test("RUN_UNBLOCKED payload type is frozen to its three allowed keys", () => {
  const exactKeySet: RunUnblockedPayloadKeysAreExact = true;
  assert.equal(exactKeySet, true);
});

type DiscardPayload = Extract<Event, { type: "RUN_UNBLOCKED_WITH_DISCARD" }>["payload"];
type DiscardPayloadKeys = keyof DiscardPayload;
type DiscardPayloadKeysAreExact =
  [DiscardPayloadKeys] extends ["blockedEventId" | "reason" | "retryNodeId" | "rewoundDescendants"]
    ? ["blockedEventId" | "reason" | "retryNodeId" | "rewoundDescendants"] extends [DiscardPayloadKeys]
      ? true
      : false
    : false;

type RewoundKeys = keyof DiscardPayload["rewoundDescendants"][number];
type RewoundKeysAreExact =
  [RewoundKeys] extends [
    | "nodeId"
    | "taskId"
    | "previousState"
    | "modelRouteEventIds"
    | "childRunIds"
    | "chargedEstimatedCostUsd"
    | "chargedEstimatedDurationMs"
  ]
    ? [
        | "nodeId"
        | "taskId"
        | "previousState"
        | "modelRouteEventIds"
        | "childRunIds"
        | "chargedEstimatedCostUsd"
        | "chargedEstimatedDurationMs"
      ] extends [RewoundKeys]
      ? true
      : false
    : false;

/**
 * The same freeze R9-10 put on the ordinary authorization, extended to the
 * stronger one at both levels it has.
 *
 * The runtime exact-key refusals below catch a hand-written row; these catch
 * the other direction — a future field added to the interface, which would
 * otherwise compile happily and only fail once someone wrote one. Freezing the
 * nested entry matters as much as the envelope: `rewoundDescendants` is where
 * an "actualCostUsd" or a copied evidence id would want to be added, and the
 * reason it must not be is a schema decision, not a drive-by.
 */
test("RUN_UNBLOCKED_WITH_DISCARD is type-frozen at its payload and its descendant entry", () => {
  const payloadKeys: DiscardPayloadKeysAreExact = true;
  const rewoundKeys: RewoundKeysAreExact = true;
  assert.equal(payloadKeys, true);
  assert.equal(rewoundKeys, true);
});

/**
 * The refusals behind the seed above, each naming the claim the row could not
 * support.
 *
 * A discard authorization is the strongest thing an operator can write to a run
 * log: it says specific executed work no longer counts. So every part of it has
 * to be checkable in isolation — an unreadable target, a state outside the
 * transform's vocabulary, a duplicate or out-of-order entry, a discard that
 * discards nothing, or a `READY`/`SKIPPED` entry claiming a route it never had.
 * Each of those would leave a reader unable to say what was superseded, which
 * is the only thing this event exists to say.
 */
test("a RUN_UNBLOCKED_WITH_DISCARD row is refused unless every claim it makes is auditable", () => {
  const seed = EVENT_SEEDS.RUN_UNBLOCKED_WITH_DISCARD;
  assert.deepEqual(validateEvent(seed), seed);

  const executed = {
    nodeId: "node-fuzz-left",
    taskId: TASK_ID,
    previousState: "COMPLETED",
    modelRouteEventIds: [ROUTE_EVENT_ID],
    childRunIds: [CHILD_RUN_ID],
    chargedEstimatedCostUsd: 0.5,
    chargedEstimatedDurationMs: 4_000
  };
  const base = { blockedEventId: BLOCKED_EVENT_ID, reason: "reviewed", retryNodeId: "node-fuzz" };
  const withPayload = (payload: unknown): unknown => ({ ...seed, payload });
  const cases: readonly [unknown, RegExp][] = [
    [
      { ...base, rewoundDescendants: [executed], discardExecuted: true },
      /payload may only include blockedEventId, reason, retryNodeId, rewoundDescendants; unknown: discardExecuted/
    ],
    [{ ...base, blockedEventId: "nope", rewoundDescendants: [executed] }, /payload\.blockedEventId must be a valid EventId/],
    [{ ...base, reason: "  ", rewoundDescendants: [executed] }, /payload\.reason must be a non-empty string/],
    // The ordinary event's node is optional; this one's is not — a targetless
    // stall block has no consequences to discard.
    [
      { blockedEventId: BLOCKED_EVENT_ID, reason: "reviewed", rewoundDescendants: [executed] },
      /payload\.retryNodeId must be a non-empty string/
    ],
    [{ ...base, rewoundDescendants: [] }, /payload\.rewoundDescendants must be a non-empty array/],
    [
      { ...base, rewoundDescendants: [{ ...executed, actualCostUsd: 1 }] },
      /payload\.rewoundDescendants\[0\] may only include nodeId, taskId, previousState, modelRouteEventIds, childRunIds, chargedEstimatedCostUsd, chargedEstimatedDurationMs; unknown: actualCostUsd/
    ],
    [
      { ...base, rewoundDescendants: [{ ...executed, taskId: "node-fuzz-left" }] },
      /payload\.rewoundDescendants\[0\]\.taskId must be a valid TaskId/
    ],
    [
      { ...base, rewoundDescendants: [{ ...executed, previousState: "PENDING" }] },
      /payload\.rewoundDescendants\[0\]\.previousState must be one of READY, SKIPPED, RUNNING, WAITING_FOR_USER, COMPLETED, FAILED/
    ],
    [
      { ...base, rewoundDescendants: [{ ...executed, modelRouteEventIds: ["not-an-event"] }] },
      /payload\.rewoundDescendants\[0\]\.modelRouteEventIds must be an array of EventIds/
    ],
    [
      { ...base, rewoundDescendants: [{ ...executed, childRunIds: [TASK_ID] }] },
      /payload\.rewoundDescendants\[0\]\.childRunIds must be an array of RunIds/
    ],
    [
      { ...base, rewoundDescendants: [{ ...executed, chargedEstimatedCostUsd: -1 }] },
      /payload\.rewoundDescendants\[0\]\.chargedEstimatedCostUsd must be a non-negative finite number/
    ],
    [
      { ...base, rewoundDescendants: [{ ...executed, chargedEstimatedDurationMs: Number.NaN }] },
      /payload\.rewoundDescendants\[0\]\.chargedEstimatedDurationMs must be a non-negative finite number/
    ],
    // Absence is not zero, and zero is not a route: a state that never held one
    // may not cite one either.
    [
      {
        ...base,
        rewoundDescendants: [
          { ...executed, previousState: "SKIPPED", childRunIds: [], chargedEstimatedCostUsd: 0, chargedEstimatedDurationMs: 0 }
        ]
      },
      /payload\.rewoundDescendants\[0\] is SKIPPED, which never held a route: it must carry no references and zero charged estimates/
    ],
    [
      {
        ...base,
        rewoundDescendants: [
          { ...executed, previousState: "READY", modelRouteEventIds: [], childRunIds: [], chargedEstimatedDurationMs: 0 }
        ]
      },
      /payload\.rewoundDescendants\[0\] is READY, which never held a route/
    ],
    // The retry target is named once, by `retryNodeId`.
    [
      { ...base, rewoundDescendants: [{ ...executed, nodeId: "node-fuzz" }] },
      /payload\.rewoundDescendants must not repeat the retry target node-fuzz/
    ],
    [
      { ...base, rewoundDescendants: [executed, executed] },
      /payload\.rewoundDescendants must be unique and ordered by nodeId/
    ],
    [
      { ...base, rewoundDescendants: [{ ...executed, nodeId: "zzz" }, executed] },
      /payload\.rewoundDescendants must be unique and ordered by nodeId/
    ],
    // A discard that discarded nothing executed is not a discard; the ordinary
    // event is the honest record of that act.
    [
      {
        ...base,
        rewoundDescendants: [
          {
            nodeId: "node-fuzz-right",
            taskId: TASK_ID,
            previousState: "READY",
            modelRouteEventIds: [],
            childRunIds: [],
            chargedEstimatedCostUsd: 0,
            chargedEstimatedDurationMs: 0
          }
        ]
      },
      /payload\.rewoundDescendants must include at least one descendant in RUNNING, WAITING_FOR_USER, COMPLETED, FAILED/
    ]
  ];
  for (const [payload, message] of cases) {
    assert.throws(() => validateEvent(withPayload(payload)), message, JSON.stringify(payload));
  }

  // And the ordinary event keeps its own exact keys: the new one is a separate
  // type, not a widening of that payload.
  assert.throws(
    () =>
      validateEvent({
        ...EVENT_SEEDS.RUN_UNBLOCKED,
        payload: { blockedEventId: BLOCKED_EVENT_ID, reason: "reviewed", rewoundDescendants: [executed] }
      }),
    /payload may only include blockedEventId, reason, retryNodeId; unknown: rewoundDescendants/
  );
});

/**
 * The named refusals behind the `RUN_UNBLOCKED` seed above.
 *
 * The fuzzer proves the row survives arbitrary mutation without escaping
 * `DomainValidationError`; this proves the four specific payloads a hand-edited
 * log or a future producer could plausibly write are each refused, and for the
 * stated reason. An unblock is an authorization record: a row whose target is
 * unreadable, whose rationale is blank, or which carries a field the reader
 * does not understand is not one, and letting any of them replay would leave a
 * run whose block was cleared by something nobody can account for.
 */
test("a RUN_UNBLOCKED row is refused unless its target, reason and node id are all sound", () => {
  const seed = EVENT_SEEDS.RUN_UNBLOCKED;
  assert.deepEqual(validateEvent(seed), seed);

  const withPayload = (payload: unknown): unknown => ({ ...seed, payload });
  const cases: readonly [unknown, RegExp][] = [
    [
      { blockedEventId: BLOCKED_EVENT_ID, reason: "reviewed", evidenceIds: ["evd_x"] },
      /payload may only include blockedEventId, reason, retryNodeId; unknown: evidenceIds/
    ],
    [{ reason: "reviewed" }, /payload\.blockedEventId must be a valid EventId/],
    [
      { blockedEventId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", reason: "reviewed" },
      /payload\.blockedEventId must be a valid EventId/
    ],
    [{ blockedEventId: BLOCKED_EVENT_ID }, /payload\.reason must be a non-empty string/],
    [
      { blockedEventId: BLOCKED_EVENT_ID, reason: "   " },
      /payload\.reason must be a non-empty string/
    ],
    [
      { blockedEventId: BLOCKED_EVENT_ID, reason: "reviewed", retryNodeId: "" },
      /payload\.retryNodeId must be a non-empty string when present/
    ],
    [
      { blockedEventId: BLOCKED_EVENT_ID, reason: "reviewed", retryNodeId: 7 },
      /payload\.retryNodeId must be a non-empty string when present/
    ]
  ];
  for (const [payload, message] of cases) {
    assert.throws(() => validateEvent(withPayload(payload)), message, JSON.stringify(payload));
  }

  // Omitting the optional node is the run-level stall shape, and is valid.
  assert.doesNotThrow(() =>
    validateEvent(withPayload({ blockedEventId: BLOCKED_EVENT_ID, reason: "reviewed" }))
  );
});

/**
 * Option (a)'s new payload shape, seeded here for the same reason every other
 * shape is seeded: a `CHILD_MESSAGE` row is the durable record of what a child
 * said, and the per-criterion outcomes are now the part of that record an
 * operator reads to find out *which* criterion blocked a run. If a row can
 * carry a criterion the decoder half-understands, the record lies.
 *
 * The base seed keeps a QUESTION so the mutation sweep above stays comparable
 * across rounds; this seed is exercised on its own, with the same invariant.
 */
const CRITERIA_TERMINAL = validateAgentMessage({
  protocolVersion: 1,
  id: MESSAGE_ID,
  occurredAt: NOW,
  runId: CHILD_RUN_ID,
  taskId: TASK_ID,
  from: AGENT_ID,
  to: "SUPERVISOR",
  type: "TASK_RESULT",
  outcome: "PARTIAL",
  summary: "the suite runs; one criterion is still open",
  artifactIds: [],
  evidenceIds: ["evd_fuzz"],
  verification: {
    kind: "PASSED",
    evidenceIds: ["evd_fuzz"],
    criteria: [
      { id: "ac-1", kind: "PASSED", evidenceIds: [] },
      { id: "ac-2", kind: "FAILED", evidenceIds: ["evd_fuzz"] },
      { id: "ac-3", kind: "UNOBSERVED", evidenceIds: [] }
    ]
  }
});

test(
  "a CHILD_MESSAGE carrying per-criterion outcomes decodes, and is refused unless each one is sound",
  { timeout: FUZZ_TIMEOUT_MS },
  () => {
    const seed = makeEvent("CHILD_MESSAGE", { message: CRITERIA_TERMINAL });
    assert.deepEqual(validateEvent(seed), seed);

    const random = new XorShift32(DEFAULT_SEED ^ 0x0a11_0a11);
    for (let iteration = 0; iteration < ITERATIONS_PER_TYPE; iteration += 1) {
      assertEventInvariant(
        mutate(seed, random, iteration),
        `validateEvent type=CHILD_MESSAGE(criteria) iteration=${iteration}`
      );
    }

    const withCriteria = (criteria: unknown): unknown => ({
      ...seed,
      payload: {
        message: {
          ...CRITERIA_TERMINAL,
          verification: { kind: "PASSED", evidenceIds: ["evd_fuzz"], criteria }
        }
      }
    });
    const refused: readonly unknown[] = [
      // Absent and empty must not be two spellings of the same thing.
      [],
      "ac-1",
      // A duplicate id has no merge rule, so it is a violation rather than a
      // last-wins.
      [
        { id: "ac-1", kind: "PASSED", evidenceIds: [] },
        { id: "ac-1", kind: "FAILED", evidenceIds: ["evd_fuzz"] }
      ],
      // A FAILED criterion gates a run; an unreferenced one would name nothing.
      [{ id: "ac-1", kind: "FAILED", evidenceIds: [] }],
      [{ id: "", kind: "PASSED", evidenceIds: [] }],
      [{ id: "ac-1", kind: "MAYBE", evidenceIds: [] }],
      [{ id: "ac-1", kind: "PASSED", evidenceIds: ["not-an-evidence-id"] }],
      [{ id: "ac-1", kind: "PASSED" }]
    ];
    for (const criteria of refused) {
      assert.throws(
        () => validateEvent(withCriteria(criteria)),
        (error: unknown) =>
          isExactDomainValidationError(error) &&
          /verification must be a valid VerificationResult/.test(error.message),
        JSON.stringify(criteria)
      );
    }

    // And the shape every row written before the field still has: absent, not
    // empty, and unchanged by a round trip through the decoder.
    const silent = makeEvent("CHILD_MESSAGE", {
      message: validateAgentMessage({
        ...CRITERIA_TERMINAL,
        verification: { kind: "PASSED", evidenceIds: ["evd_fuzz"] }
      })
    });
    assert.deepEqual(validateEvent(silent), silent);
  }
);

/**
 * The gate vocabulary grew by one code with option (a), and both rows that
 * carry a gate decision have to survive it: the assessment that records the
 * codes, and the transition that stamps the leading one as its reason.
 */
test("a TRACKING_ASSESSMENT and its transition carry the unmet-acceptance-criterion code", () => {
  const blocked = parseTrackingAssessment({
    ...JSON.parse(JSON.stringify(ASSESSMENT)),
    gate: {
      kind: "hard",
      codes: ["unmet-acceptance-criterion"],
      wakeAnalysis: true,
      expandDetail: true,
      askUser: false,
      openMinors: []
    }
  });
  const assessmentRow = makeEvent("TRACKING_ASSESSMENT", {
    assessment: blocked,
    assessmentHash: hashAssessment(blocked),
    seq: 1
  });
  assert.deepEqual(validateEvent(assessmentRow), assessmentRow);

  const transitionRow = makeEvent("GATE_TRANSITION", {
    transitionId: "transition-criterion",
    episodeId: EPISODE_ID,
    turnId: "turn-fuzz",
    seq: 1,
    from: "RUNNING",
    to: "BLOCKED",
    reasonCode: "unmet-acceptance-criterion",
    assessmentHash: hashAssessment(blocked),
    evidenceRefs: ["evd_fuzz"],
    policyVersion: "track-v1",
    idempotencyKey: "fuzz:1",
    directive: "queue_analysis"
  });
  assert.deepEqual(validateEvent(transitionRow), transitionRow);

  // The code is in the recorded vocabulary, not merely tolerated as a string:
  // a spelling nobody declared still fails the assessment parser.
  assert.throws(
    () =>
      parseTrackingAssessment({
        ...JSON.parse(JSON.stringify(blocked)),
        gate: { ...blocked.gate, codes: ["criteria-unmet"] }
      }),
    (error: unknown) => isExactDomainValidationError(error) && /gate\.codes\[0\] is invalid/.test(error.message)
  );
});

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
