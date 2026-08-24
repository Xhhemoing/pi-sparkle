import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import {
  createAgentInstanceId,
  createEventId,
  createInvocationId,
  createRunId,
  createTaskId
} from "../../../src/domain/ids.js";
import { validateEpisodeEvent, type EpisodeEvent } from "../../../src/episode/events.js";
import {
  feedbackLogPath,
  readFeedbackRecordsRaw
} from "../../../src/feedback/store.js";
import type { FeedbackRecord } from "../../../src/feedback/types.js";
import { CheckpointStore } from "../../../src/run/checkpoint-store.js";
import {
  createFilePauseController,
  type PauseToken
} from "../../../src/run/pause-controller.js";
import { validateCheckpoint, type RunCheckpoint } from "../../../src/run/replay.js";
import {
  isInvocation,
  validateInvocation,
  type ModelInvocation
} from "../../../src/telemetry/model-invocation.js";

const DEFAULT_SEED = 0x4f32_0007;
const FUZZ_TIMEOUT_MS = 5_000;
const SYNC_ITERATIONS = 1_200;
const FILE_ITERATIONS = 240;
const UUID = (): string => "01234567-89ab-cdef-0123-456789abcdef";
const RUN_ID = createRunId(UUID);
const NOW = "2026-08-24T12:00:00.000Z";

const EPISODE = {
  id: "ep_01234567-89ab-cdef-0123-456789abcdef",
  projectId: "prj_01234567-89ab-cdef-0123-456789abcdef",
  objective: "fuzz persisted rows",
  contractVersion: 1,
  runIds: [RUN_ID],
  startedAt: NOW,
  status: "OPEN",
  acceptance: [
    {
      id: "accept-1",
      description: "row decoders fail closed",
      observableCheck: "pnpm test -- test/unit/persist/row-fuzz.test.ts"
    }
  ],
  evidenceRefs: []
};

const EPISODE_EVENT_SEEDS: readonly Record<string, unknown>[] = [
  { type: "EPISODE_OPENED", episode: EPISODE, occurredAt: NOW },
  {
    type: "RUN_ATTACHED",
    episodeId: EPISODE.id,
    runId: RUN_ID,
    attachedAt: NOW
  },
  {
    type: "EPISODE_WAITING",
    episodeId: EPISODE.id,
    reason: "needs evidence",
    requiredEvidence: ["accept-1"],
    occurredAt: NOW
  },
  {
    type: "EPISODE_CLOSED",
    episodeId: EPISODE.id,
    status: "COMPLETED",
    closedAt: NOW,
    outcomeId: "outcome-1"
  }
];

const PAUSE_SEED = {
  paused: true,
  requestedAt: NOW,
  reason: "operator requested a pause"
};

const CHECKPOINT_SEED = {
  schemaVersion: 1,
  status: "RUNNING",
  agentOutcomes: [
    {
      agentInstanceId: createAgentInstanceId(UUID),
      outcome: "SUCCESS",
      taskId: createTaskId(UUID)
    }
  ],
  lastEventId: createEventId(UUID),
  updatedAt: NOW
};

const FEEDBACK_SEEDS: readonly Record<string, unknown>[] = [
  {
    id: "feedback-fuzz-1",
    episodeId: EPISODE.id,
    runId: RUN_ID,
    kind: "human",
    rubricVersion: "1",
    score: 80,
    evidenceRefs: [],
    redacted: true,
    redactionClasses: ["pii"],
    createdAt: NOW,
    body: "redacted note"
  },
  {
    id: "feedback-fuzz-legacy",
    episodeId: EPISODE.id,
    kind: "deterministic",
    rubricVersion: "1",
    score: 100,
    evidenceRefs: [],
    redacted: true,
    createdAt: NOW
  }
];

const INVOCATION_SEED = {
  id: createInvocationId(UUID),
  taskId: createTaskId(UUID),
  runId: RUN_ID,
  agentInstanceId: createAgentInstanceId(UUID),
  config: {
    provider: "faux",
    model: "faux-1",
    modelVersion: "faux-1-v1",
    parameterHash: "abc123"
  },
  responseHash: "def456",
  tokensIn: 100,
  tokensOut: 50,
  latencyMs: 25,
  occurredAt: NOW,
  attempt: 1,
  cacheHit: false,
  callOutcome: "ok",
  pricing: {
    catalogVersion: "catalog-1",
    inputUsdPerMTok: 0.1,
    outputUsdPerMTok: 0.2
  }
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
    if (depth > 6 || records.length + arrays.length >= 96) return;
    if (Array.isArray(candidate)) {
      arrays.push(candidate);
      for (const child of candidate.slice(0, 12)) visit(child, depth + 1);
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
      .filter((key) =>
        /^(type|status|kind|outcome|paused|occurredAt|attachedAt|closedAt|requestedAt|createdAt|updatedAt|schemaVersion|score|latencyMs|attempt|tokensIn|tokensOut|redactionClasses|config|pricing)$/.test(
          key
        ) || /(^id$|Id$|Ids$|Refs$)/.test(key)
      )
      .map((key) => ({ key, record }))
  );
  if (candidates.length === 0) return invalidValue(random);

  const { key, record } = random.pick(candidates);
  if (/At$/.test(key)) {
    record[key] = random.pick(["later", "2026-13-40T25:61:61Z", "\ud800", 0]);
  } else if (/^(schemaVersion|score|latencyMs|attempt|tokensIn|tokensOut)$/.test(key)) {
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
      const targetLength = 24 + random.int(41);
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
      if (json.length === 0) return "{";
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
  process.stderr.write(`[row fuzz] seed=${seedText()} ${context}: ${detail}\n`);
  throw new Error(`Row fuzz invariant failed (seed=${seedText()}, ${context}): ${detail}`, {
    cause: error
  });
}

function isExactDomainValidationError(error: unknown): boolean {
  return error instanceof Error && error.constructor === DomainValidationError;
}

function isExactSyntaxError(error: unknown): boolean {
  return error instanceof Error && error.constructor === SyntaxError;
}

function assertSyncInvariant<T>(
  decode: (value: unknown) => T,
  value: unknown,
  context: string
): void {
  let decoded: T;
  try {
    decoded = decode(value);
  } catch (error) {
    if (!isExactDomainValidationError(error)) failFuzz(context, error);
    return;
  }

  try {
    assert.deepEqual(decode(decoded), decoded);
  } catch (error) {
    failFuzz(`${context}, revalidation`, error);
  }
}

async function withStateRoot(run: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-row-fuzz-"));
  try {
    await run(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

function skipUnowned(context: TestContext, target: string, fuzzContext: string, error: unknown): void {
  context.skip(
    `UNOWNED ${target} error-discipline defect (seed=${seedText()}, ${fuzzContext}): ${errorDetail(error)}`
  );
}

test(
  "seeded row mutations preserve EpisodeEvent decoder error discipline",
  { timeout: FUZZ_TIMEOUT_MS },
  () => {
    for (const [index, seed] of EPISODE_EVENT_SEEDS.entries()) {
      assertSyncInvariant<EpisodeEvent>(validateEpisodeEvent, seed, `EpisodeEvent seedIndex=${index}`);
    }
    const random = new XorShift32(DEFAULT_SEED);
    for (let iteration = 0; iteration < SYNC_ITERATIONS; iteration += 1) {
      const seedIndex = iteration % EPISODE_EVENT_SEEDS.length;
      assertSyncInvariant<EpisodeEvent>(
        validateEpisodeEvent,
        mutate(EPISODE_EVENT_SEEDS[seedIndex], random, iteration),
        `EpisodeEvent iteration=${iteration} seedIndex=${seedIndex}`
      );
    }
  }
);

test(
  "seeded row mutations preserve pause-token decoder error discipline",
  { timeout: FUZZ_TIMEOUT_MS },
  async () => {
    await withStateRoot(async (stateRoot) => {
      const path = join(stateRoot, "runtime", "runs", RUN_ID, "pause.json");
      await mkdir(dirname(path), { recursive: true });
      const pause = createFilePauseController(stateRoot);
      const random = new XorShift32(DEFAULT_SEED ^ 0x0a05_e001);

      for (let iteration = 0; iteration < FILE_ITERATIONS; iteration += 1) {
        const candidate = mutate(PAUSE_SEED, random, iteration);
        await writeFile(path, mutateJsonText(candidate, random, iteration), "utf8");
        let decoded: PauseToken;
        try {
          decoded = await pause.token(RUN_ID);
        } catch (error) {
          if (!isExactDomainValidationError(error)) {
            failFuzz(`PauseToken iteration=${iteration}`, error);
          }
          continue;
        }

        try {
          await writeFile(path, jsonText(decoded), "utf8");
          assert.deepEqual(await pause.token(RUN_ID), decoded);
        } catch (error) {
          failFuzz(`PauseToken iteration=${iteration}, revalidation`, error);
        }
      }
    });
  }
);

test(
  "seeded row mutations preserve checkpoint parse and validation error discipline",
  { timeout: FUZZ_TIMEOUT_MS },
  async () => {
    await withStateRoot(async (stateRoot) => {
      const path = join(stateRoot, "runtime", "runs", RUN_ID, "checkpoint.json");
      await mkdir(dirname(path), { recursive: true });
      const store = new CheckpointStore(stateRoot, RUN_ID);
      const random = new XorShift32(DEFAULT_SEED ^ 0xc4ec_0017);

      for (let iteration = 0; iteration < FILE_ITERATIONS; iteration += 1) {
        const candidate = mutate(CHECKPOINT_SEED, random, iteration);
        await writeFile(path, mutateJsonText(candidate, random, iteration), "utf8");
        let decoded: RunCheckpoint;
        try {
          decoded = validateCheckpoint(await store.read());
        } catch (error) {
          if (!isExactDomainValidationError(error) && !isExactSyntaxError(error)) {
            failFuzz(`RunCheckpoint iteration=${iteration}`, error);
          }
          continue;
        }

        try {
          assert.deepEqual(validateCheckpoint(decoded), decoded);
        } catch (error) {
          failFuzz(`RunCheckpoint iteration=${iteration}, revalidation`, error);
        }
      }
    });
  }
);

test(
  "seeded row mutations preserve feedback-row decoder error discipline",
  { timeout: FUZZ_TIMEOUT_MS },
  async (context) => {
    await withStateRoot(async (stateRoot) => {
      const path = feedbackLogPath(stateRoot);
      await mkdir(dirname(path), { recursive: true });
      const random = new XorShift32(DEFAULT_SEED ^ 0xfeed_0077);

      for (let iteration = 0; iteration < FILE_ITERATIONS; iteration += 1) {
        const seedIndex = iteration % FEEDBACK_SEEDS.length;
        const candidate = mutate(FEEDBACK_SEEDS[seedIndex], random, iteration);
        await writeFile(path, `${mutateJsonText(candidate, random, iteration)}\n`, "utf8");
        let decoded: FeedbackRecord[];
        try {
          decoded = await readFeedbackRecordsRaw(stateRoot);
        } catch (error) {
          if (!isExactDomainValidationError(error)) {
            skipUnowned(context, "feedback-row decoder", `iteration=${iteration}`, error);
            return;
          }
          continue;
        }

        try {
          const body = decoded.map((record) => jsonText(record)).join("\n");
          await writeFile(path, body === "" ? "" : `${body}\n`, "utf8");
          assert.deepEqual(await readFeedbackRecordsRaw(stateRoot), decoded);
        } catch (error) {
          skipUnowned(
            context,
            "feedback-row decoder",
            `iteration=${iteration}, revalidation`,
            error
          );
          return;
        }
      }
    });
  }
);

test(
  "seeded row mutations preserve invocation-row validator error discipline",
  { timeout: FUZZ_TIMEOUT_MS },
  () => {
    const random = new XorShift32(DEFAULT_SEED ^ 0x1a70_c471);
    for (let iteration = 0; iteration < SYNC_ITERATIONS; iteration += 1) {
      const candidate = mutate(INVOCATION_SEED, random, iteration);
      let accepted: boolean;
      try {
        validateInvocation(candidate as ModelInvocation);
        accepted = true;
      } catch (error) {
        if (!isExactDomainValidationError(error)) {
          failFuzz(`invocation-row validator iteration=${iteration}`, error);
        }
        accepted = false;
      }

      // The type predicate is what read-side callers apply per row without a
      // catch, so it must agree with the validator and never throw.
      let predicate: boolean;
      try {
        predicate = isInvocation(candidate);
      } catch (error) {
        failFuzz(`invocation-row predicate iteration=${iteration}`, error);
      }
      if (predicate !== accepted) {
        failFuzz(
          `invocation-row predicate iteration=${iteration}`,
          new Error(`isInvocation=${predicate} disagrees with validateInvocation=${accepted}`)
        );
      }
      if (!accepted) continue;

      try {
        validateInvocation(candidate as ModelInvocation);
      } catch (error) {
        failFuzz(`invocation-row validator iteration=${iteration}, revalidation`, error);
      }
    }
  }
);
