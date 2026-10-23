import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { observeManagedQualification } from "../../../src/pi-adapter/managed/qualification-scenarios.js";
import { validateManagedQualificationRecord } from "../../../src/pi-adapter/managed/qualification.js";

test("managed qualification validates actual SDK caching and cancellation without an extra dispatch", async (t) => {
  const observations = await observeManagedQualification();
  const managerRoot = path.resolve(".agent_workspace", "qualification-record-only");
  const generationId = "11111111-1111-4111-8111-111111111111";
  const record = { managerRoot, candidateRoot: path.join(managerRoot, "generations", generationId), generationId,
    versions: { core: "1.4.0", ai: "1.4.0" }, observations };
  const validated = validateManagedQualificationRecord(record);
  assert.ok(Object.isFrozen(validated));
  const cached = observations[1]!;
  assert.equal(cached.scenario, "unpriced-cap");
  if (cached.scenario !== "unpriced-cap") throw new Error("missing fixed cache scenario");
  assert.equal(cached.invocation?.cacheHit, true);
  const cancelled = observations[3]!;
  assert.equal(cancelled.scenario, "blocked-tool-cancel");
  if (cancelled.scenario !== "blocked-tool-cancel") throw new Error("missing fixed cancellation scenario");
  assert.equal(cancelled.streamEntries, 1);
  assert.equal(cancelled.turns.length, 1);

  type MutableRecord = { observations: Array<Record<string, unknown>> } & Record<string, unknown>;
  const copy = (): MutableRecord => JSON.parse(JSON.stringify(record)) as MutableRecord;
  await t.test("older uncached records and their aborted non-provider turn remain readable", () => {
    const legacy = copy();
    for (const observed of legacy.observations.slice(0, 4)) delete observed.providerUsage;
    const priced = legacy.observations[0]!;
    const cost = (priced.costEvents as Array<{ ledger: { turnsWithoutUsage: number } }>)[0]!;
    cost.ledger.turnsWithoutUsage = 0;
    const uncached = legacy.observations[1]!;
    const contexts = uncached.contexts as string[];
    const first = { inputTokens: Math.ceil(contexts[0]!.length / 4), outputTokens: 4 };
    const second = { inputTokens: Math.ceil(contexts[1]!.length / 4), outputTokens: 6 };
    uncached.turns = [first, second];
    uncached.invocation = { outcome: "ok", tokensIn: first.inputTokens + second.inputTokens, tokensOut: 10, cacheHit: false };
    const abort = legacy.observations[3]!;
    abort.streamEntries = 2;
    abort.streamAborted = [false, true];
    (abort.turns as unknown[]).push(null);
    const events = abort.eventTypes as string[];
    events.splice(events.indexOf("TURN_FINISHED") + 1, 0, "TURN_FINISHED");
    assert.doesNotThrow(() => validateManagedQualificationRecord(legacy));
    abort.streamAborted = [false, false];
    assert.throws(() => validateManagedQualificationRecord(legacy), /stream abort flags/);
  });

  const changes: Array<[string, (value: MutableRecord) => void, RegExp]> = [
    ["one worker cannot mix SDK cost cases with a legacy cancellation trace", (value) => {
      const abort = value.observations[3]!;
      delete abort.providerUsage;
      abort.streamEntries = 2;
      abort.streamAborted = [false, true];
      (abort.turns as unknown[]).push(null);
      const events = abort.eventTypes as string[];
      events.splice(events.indexOf("TURN_FINISHED") + 1, 0, "TURN_FINISHED");
    }, /execution observation format/],
    ["provider cache counters differ from actual context prefix", (value) => {
      const usage = value.observations[1]!.providerUsage as Array<{ cacheReadTokens: number }>;
      usage[1]!.cacheReadTokens++;
    }, /raw provider cache usage/],
    ["turn drops the witnessed cache read", (value) => {
      const turns = value.observations[1]!.turns as Array<{ cacheReadTokens?: number }>;
      delete turns[1]!.cacheReadTokens;
    }, /actual turn usage/],
    ["invocation hides the witnessed cache hit", (value) => {
      (value.observations[1]!.invocation as { cacheHit: boolean }).cacheHit = false;
    }, /invocation usage trust/],
    ["SDK cancellation adds an unwitnessed stream entry", (value) => {
      value.observations[3]!.streamEntries = 2;
    }, /stream entries/],
    ["SDK cancellation appends a phantom empty turn", (value) => {
      (value.observations[3]!.turns as unknown[]).push(null);
    }, /actual turn usage/],
    ["cancellation dispatches again", (value) => {
      value.observations[3]!.providerDispatches = 2;
    }, /provider dispatches/],
    ["unpriced cache is reported as complete cost", (value) => {
      const costs = value.observations[0]!.costEvents as Array<{ ledger: { turnsWithoutUsage: number } }>;
      costs[0]!.ledger.turnsWithoutUsage = 0;
    }, /cost cap observations/]
  ];
  for (const [name, mutate, error] of changes) {
    await t.test(name, () => {
      const changed = copy(); mutate(changed);
      assert.throws(() => validateManagedQualificationRecord(changed), error);
    });
  }
});
