import assert from "node:assert/strict";
import { test } from "node:test";
import { createEpisodeId } from "../../../src/domain/ids.js";
import { createCheckAdapter } from "../../../src/evaluation/check-adapter.js";
import type { AdapterContext, CommandResult } from "../../../src/evaluation/adapters.js";

function context(): AdapterContext {
  return {
    episodeId: createEpisodeId(() => "provenance"),
    workingDirectory: "/work/project",
    revision: "rev-current",
    changeSet: ["src/feature.ts"],
  };
}

function command(overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    exitCode: 0, stdout: "ok", stderr: "", durationMs: 10,
    command: "pnpm test", cwd: "/work/project",
    revision: "rev-current", changeSet: ["src/feature.ts"],
    ...overrides,
  };
}

for (const exitCode of [0, 1]) {
  test(`missing recorded revision is UNOBSERVED, not inferred (exit ${exitCode})`, async () => {
    const result = await createCheckAdapter().evaluate(context(), command({ revision: undefined, exitCode }));
    assert.equal(result.outcome, "UNOBSERVED");
    assert.match(result.reason ?? "", /missing.*revision/i);
    assert.equal(result.metadata?.revision, "unavailable");
    assert.equal(result.metadata?.expectedRevision, "rev-current");
    assert.equal(result.evidenceRef, undefined);
  });

  test(`missing recorded change set is UNOBSERVED, not inferred (exit ${exitCode})`, async () => {
    const result = await createCheckAdapter().evaluate(context(), command({ changeSet: undefined, exitCode }));
    assert.equal(result.outcome, "UNOBSERVED");
    assert.match(result.reason ?? "", /missing.*change set/i);
    assert.equal(result.metadata?.changeSet, null);
    assert.deepEqual(result.metadata?.expectedChangeSet, ["src/feature.ts"]);
    assert.equal(result.metadata?.revision, "rev-current");
  });
}

test("missing both provenance fields never borrows the current context", async () => {
  const result = await createCheckAdapter().evaluate(context(), command({ revision: undefined, changeSet: undefined }));
  assert.equal(result.outcome, "UNOBSERVED");
  assert.equal(result.metadata?.revision, "unavailable");
  assert.equal(result.metadata?.changeSet, null);
  assert.equal(result.metadata?.environmentPolicy, "unavailable");
});

test("explicit stale evidence retains actual and expected attribution separately", async () => {
  const result = await createCheckAdapter().evaluate(context(), command({ revision: "rev-old" }));
  assert.equal(result.outcome, "FAIL");
  assert.equal(result.metadata?.revision, "rev-old");
  assert.equal(result.metadata?.expectedRevision, "rev-current");
});

test("explicit equivalent sets retain PASS without replay or mutation", async () => {
  const ctx = { ...context(), changeSet: Object.freeze(["a.ts", "b.ts"]) };
  const input = Object.freeze(command({ changeSet: Object.freeze(["b.ts", "a.ts", "b.ts"]) }));
  const before = JSON.stringify({ ctx, input });
  const result = await createCheckAdapter().evaluate(Object.freeze(ctx), input);
  assert.equal(result.outcome, "PASS");
  assert.equal(result.evidenceRef, "exit:0");
  assert.equal(JSON.stringify({ ctx, input }), before);
});

test("an explicitly recorded empty change set is not missing provenance", async () => {
  const result = await createCheckAdapter().evaluate({ ...context(), changeSet: [] }, command({ changeSet: [] }));
  assert.equal(result.outcome, "PASS");
  assert.deepEqual(result.metadata?.changeSet, []);
});

test("returned attribution snapshots do not alias caller-owned change sets", async () => {
  const actual = ["src/feature.ts"];
  const expected = ["src/feature.ts"];
  const result = await createCheckAdapter().evaluate({ ...context(), changeSet: expected }, command({ changeSet: actual }));
  assert.equal(result.outcome, "PASS");
  actual.push("later-actual.ts");
  expected.push("later-expected.ts");
  assert.deepEqual(result.metadata?.changeSet, ["src/feature.ts"]);
  assert.deepEqual(result.metadata?.expectedChangeSet, ["src/feature.ts"]);
});

const malformedResults: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["non-finite exit", { exitCode: NaN }],
  ["infinite exit", { exitCode: Infinity }],
  ["fractional exit", { exitCode: 0.5 }],
  ["unsafe exit", { exitCode: Number.MAX_SAFE_INTEGER + 1 }],
  ["missing duration", { durationMs: undefined }],
  ["negative duration", { durationMs: -1 }],
  ["non-finite duration", { durationMs: NaN }],
  ["infinite duration", { durationMs: Infinity }],
  ["non-string revision", { revision: 42 }],
  ["null revision", { revision: null }],
  ["blank revision", { revision: "  " }],
  ["blank command", { command: "  " }],
  ["blank cwd", { cwd: "  " }],
  ["non-string scope", { changeSet: [42] }],
  ["blank scope", { changeSet: [" "] }],
];

for (const [name, fields] of malformedResults) {
  test(`malformed evidence abstains: ${name}`, async () => {
    const result = await createCheckAdapter().evaluate(context(), { ...command(), ...fields });
    assert.equal(result.outcome, "ABSTAIN");
    assert.equal(result.evidenceRef, undefined);
  });
}

test("an array with command-shaped properties is not command evidence", async () => {
  const result = await createCheckAdapter().evaluate(context(), Object.assign([], command()));
  assert.equal(result.outcome, "ABSTAIN");
});

const malformedContexts: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["missing revision", { revision: undefined }],
  ["blank revision", { revision: " " }],
  ["missing scope", { changeSet: undefined }],
  ["non-array scope", { changeSet: "src/feature.ts" }],
  ["non-string scope", { changeSet: [42] }],
  ["blank scope", { changeSet: [""] }],
  ["blank cwd", { workingDirectory: " " }],
];

for (const [name, fields] of malformedContexts) {
  test(`invalid expected context stays UNOBSERVED: ${name}`, async () => {
    const ctx = { ...context(), ...fields } as AdapterContext;
    const result = await createCheckAdapter().evaluate(ctx, command());
    assert.equal(result.outcome, "UNOBSERVED");
    assert.match(result.reason ?? "", /context/i);
    assert.equal(result.evidenceRef, undefined);
  });
}
