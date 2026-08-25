import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import {
  assertAtMostOneTerminal,
  validateAgentMessage,
  validateApprovalReplyForPlan,
  type AgentMessage
} from "../../../src/protocol/v1.js";

const DEFAULT_SEED = 0x4f31_0008;
const FUZZ_TIMEOUT_MS = 5_000;

const APPROVAL_PLAN = {
  id: "plan-1",
  items: [
    { id: "inspect", label: "Inspect", selectable: true, defaultSelected: true },
    { id: "apply", label: "Apply", selectable: true },
    { id: "fixed", label: "Always included", selectable: false }
  ]
};

const BASE_MESSAGE = {
  protocolVersion: 1,
  id: "msg_01234567-89ab-cdef-0123-456789abcdef",
  occurredAt: "2026-08-12T09:00:00.000Z",
  runId: "run_01234567-89ab-cdef-0123-456789abcdef",
  taskId: "tsk_01234567-89ab-cdef-0123-456789abcdef",
  from: "agt_abcdef01-2345-6789-abcd-ef0123456789",
  to: "agt_01234567-89ab-cdef-0123-456789abcdef"
};

const MESSAGE_SEEDS: readonly Record<string, unknown>[] = [
  {
    ...BASE_MESSAGE,
    type: "TASK_REQUEST",
    objective: "Implement the parser",
    inputArtifactIds: ["art_01234567-89ab-cdef-0123-456789abcdef"],
    acceptanceCriteria: [{ id: "ac-1", description: "Parser handles input" }],
    limits: { maxAttempts: 2, timeoutMs: 60_000, maxWallTimeMs: 300_000, maxCostUsd: 1.5 },
    approvalPlan: APPROVAL_PLAN
  },
  {
    ...BASE_MESSAGE,
    type: "PROGRESS",
    status: "BLOCKED",
    summary: "Waiting for input",
    evidenceIds: ["evd_01234567-89ab-cdef-0123-456789abcdef"],
    blocker: { kind: "NEEDS_INFO", description: "Need the schema" }
  },
  {
    ...BASE_MESSAGE,
    type: "QUESTION",
    question: "Should I update the parser?",
    options: ["Yes", "No"],
    confidence: 0.75,
    rationale: "The wire format changed",
    approvalPlan: APPROVAL_PLAN
  },
  {
    ...BASE_MESSAGE,
    to: "SUPERVISOR",
    type: "PEER_MESSAGE",
    body: "Found the parser",
    addressRole: "reviewer",
    inReplyTo: "msg_abcdef01-2345-6789-abcd-ef0123456789",
    topic: "protocol"
  },
  {
    ...BASE_MESSAGE,
    type: "TASK_RESULT",
    outcome: "PARTIAL",
    summary: "Parser updated",
    artifactIds: ["art_01234567-89ab-cdef-0123-456789abcdef"],
    evidenceIds: ["evd_01234567-89ab-cdef-0123-456789abcdef"],
    verification: {
      kind: "FAILED",
      evidenceIds: ["evd_abcdef01-2345-6789-abcd-ef0123456789"]
    },
    failure: { category: "VALIDATION", detail: "One fixture remains" }
  }
];

const APPROVAL_REPLY = {
  approvalPlanId: "plan-1",
  selectedActionIds: ["apply"]
};

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
    if (depth > 6 || records.length + arrays.length >= 128) return;
    if (Array.isArray(candidate)) {
      arrays.push(candidate);
      for (let index = 0; index < Math.min(candidate.length, 16); index += 1) {
        visit(candidate[index], depth + 1);
      }
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
      -0,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      2 ** 53,
      "",
      "\u200b",
      "\ud800",
      "\0",
      "UNKNOWN_ENUM",
      [],
      {}
    ])
  );
}

function pickPopulatedRecord(
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
      .filter((key) =>
        /^(protocolVersion|type|status|kind|outcome|category|addressRole|occurredAt|maxAttempts|timeoutMs|maxWallTimeMs|maxCostUsd)$/.test(
          key
        ) || /(^id$|Id$|Ids$)/.test(key)
      )
      .map((key) => ({ key, record }))
  );
  if (candidates.length === 0) return invalidValue(random);

  const { key, record } = random.pick(candidates);
  if (key === "occurredAt") {
    record[key] = random.pick(["later", "2026-13-40T25:61:61Z", "\ud800", "\u200b"]);
  } else if (/^(maxAttempts|timeoutMs|maxWallTimeMs|maxCostUsd)$/.test(key)) {
    record[key] = random.pick([-0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, "1"]);
  } else if (/(^id$|Id$|Ids$)/.test(key)) {
    record[key] = random.pick(["bad id", "\u200b", "\ud800", 2 ** 53, null]);
  } else {
    record[key] = random.pick(["UNKNOWN_ENUM", "\u200b", "\ud800", 2 ** 53, null]);
  }
  return root;
}

function mutateOnce(input: unknown, random: XorShift32, mutationKind: number): unknown {
  const root = clone(input);
  const { records, arrays } = collectContainers(root);

  switch (mutationKind % 7) {
    case 0: {
      const record = pickPopulatedRecord(records, random);
      if (record === undefined) return null;
      delete record[random.pick(Object.keys(record))];
      return root;
    }
    case 1: {
      const record = pickPopulatedRecord(records, random);
      if (record === undefined) return invalidValue(random);
      record[random.pick(Object.keys(record))] = invalidValue(random);
      return root;
    }
    case 2: {
      if (arrays.length === 0) {
        const record = pickPopulatedRecord(records, random);
        if (record === undefined) return Array.from({ length: 64 }, () => invalidValue(random));
        record[random.pick(Object.keys(record))] = Array.from({ length: 64 + random.int(65) }, () =>
          invalidValue(random)
        );
        return root;
      }
      const array = random.pick(arrays);
      const exemplar = array.length === 0 ? invalidValue(random) : array[random.int(array.length)];
      const targetLength = 64 + random.int(193);
      while (array.length < targetLength) array.push(clone(exemplar));
      return root;
    }
    case 3: {
      const record = pickPopulatedRecord(records, random);
      if (record === undefined) return root;
      const oldKey = random.pick(Object.keys(record));
      record[`${oldKey}_renamed`] = record[oldKey];
      delete record[oldKey];
      return root;
    }
    case 4: {
      if (records.length === 0) return root;
      const record = random.pick(records);
      const key = random.pick(["__proto__", "constructor"]);
      Object.defineProperty(record, key, {
        value: { prototype: { polluted: true }, polluted: true },
        enumerable: true,
        configurable: true,
        writable: true
      });
      return root;
    }
    case 5:
      return corruptSemanticField(root, random);
    default: {
      const record = pickPopulatedRecord(records, random);
      if (record === undefined) return invalidValue(random);
      const key = random.pick(Object.keys(record));
      let nested: unknown = "leaf";
      for (let depth = 0; depth < 1 + random.int(12); depth += 1) nested = { nested };
      record[key] = nested;
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

function seedText(): string {
  return `0x${DEFAULT_SEED.toString(16).padStart(8, "0")}`;
}

function failFuzz(context: string, error: unknown): never {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  process.stderr.write(`[protocol fuzz] seed=${seedText()} ${context}: ${detail}\n`);
  throw new Error(`Protocol fuzz invariant failed (seed=${seedText()}, ${context}): ${detail}`, {
    cause: error
  });
}

function isExactDomainValidationError(error: unknown): boolean {
  return error instanceof Error && error.constructor === DomainValidationError;
}

function assertAgentMessageInvariant(value: unknown, context: string): void {
  let validated: AgentMessage;
  try {
    validated = validateAgentMessage(value);
  } catch (error) {
    if (!isExactDomainValidationError(error)) failFuzz(context, error);
    return;
  }

  try {
    const revalidated = validateAgentMessage(validated);
    assert.deepEqual(revalidated, validated);
  } catch (error) {
    failFuzz(`${context}, revalidation`, error);
  }
}

function assertApprovalInvariant(plan: unknown, reply: unknown, context: string): void {
  let validated: unknown;
  try {
    validated = validateApprovalReplyForPlan(plan, reply);
  } catch (error) {
    if (!isExactDomainValidationError(error)) failFuzz(context, error);
    return;
  }

  try {
    assert.deepEqual(validateApprovalReplyForPlan(plan, validated), validated);
  } catch (error) {
    failFuzz(`${context}, revalidation`, error);
  }
}

function assertTerminalInvariant(messages: unknown[], context: string): void {
  let first: void;
  try {
    first = assertAtMostOneTerminal(messages as AgentMessage[]);
  } catch (error) {
    if (!isExactDomainValidationError(error)) failFuzz(context, error);
    return;
  }

  try {
    const second = assertAtMostOneTerminal(messages as AgentMessage[]);
    assert.deepEqual(second, first);
  } catch (error) {
    failFuzz(`${context}, revalidation`, error);
  }
}

function generatedMessageArray(iteration: number, random: XorShift32): unknown[] {
  if (iteration === 0) return [null];
  if (iteration === 1) return [clone(MESSAGE_SEEDS[4]), clone(MESSAGE_SEEDS[1]), clone(MESSAGE_SEEDS[4])];

  const messages: unknown[] = [];
  const length = random.int(24);
  for (let index = 0; index < length; index += 1) {
    const seed = random.pick(MESSAGE_SEEDS);
    messages.push(random.int(3) === 0 ? mutate(seed, random, iteration + index) : clone(seed));
  }

  switch (iteration % 5) {
    case 0:
      messages.splice(random.int(messages.length + 1), 0, invalidValue(random));
      break;
    case 1:
      messages.unshift(clone(MESSAGE_SEEDS[4]));
      messages.push(clone(MESSAGE_SEEDS[4]));
      break;
    case 2:
      while (messages.length < 256) messages.push(clone(MESSAGE_SEEDS[1]));
      break;
    case 3:
      Object.defineProperty(messages, "__proto__", {
        value: { polluted: true },
        enumerable: true,
        configurable: true,
        writable: true
      });
      break;
    default:
      messages.push(mutate(MESSAGE_SEEDS[4], random, iteration));
  }
  return messages;
}

test("seeded structured mutations preserve AgentMessage validator error discipline", { timeout: FUZZ_TIMEOUT_MS }, () => {
  const random = new XorShift32(DEFAULT_SEED);
  for (const [messageIndex, message] of MESSAGE_SEEDS.entries()) {
    assert.deepEqual(validateAgentMessage(message), message, `invalid seed fixture at messageIndex=${messageIndex}`);
  }
  for (let iteration = 0; iteration < 3_000; iteration += 1) {
    const messageIndex = iteration % MESSAGE_SEEDS.length;
    const candidate = mutate(MESSAGE_SEEDS[messageIndex], random, iteration);
    assertAgentMessageInvariant(candidate, `AgentMessage iteration=${iteration} messageIndex=${messageIndex}`);
  }
});

test("seeded structured mutations preserve approval reply validator error discipline", { timeout: FUZZ_TIMEOUT_MS }, () => {
  const random = new XorShift32(DEFAULT_SEED ^ 0xa11c_e55);
  assert.deepEqual(validateApprovalReplyForPlan(APPROVAL_PLAN, APPROVAL_REPLY), APPROVAL_REPLY);
  for (let iteration = 0; iteration < 800; iteration += 1) {
    const plan = iteration % 7 === 0 ? clone(APPROVAL_PLAN) : mutate(APPROVAL_PLAN, random, iteration);
    const reply = iteration % 11 === 0 ? clone(APPROVAL_REPLY) : mutate(APPROVAL_REPLY, random, iteration + 3);
    assertApprovalInvariant(plan, reply, `ApprovalReply iteration=${iteration}`);
  }
});

test("seeded generated arrays preserve terminal assertion error discipline", { timeout: FUZZ_TIMEOUT_MS }, () => {
  const random = new XorShift32(DEFAULT_SEED ^ 0x7e12_1a1);
  for (let iteration = 0; iteration < 800; iteration += 1) {
    assertTerminalInvariant(generatedMessageArray(iteration, random), `terminal iteration=${iteration}`);
  }
});
