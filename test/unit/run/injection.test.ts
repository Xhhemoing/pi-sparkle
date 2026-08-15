import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultDecisionPolicy } from "../../../src/domain/flowchart.js";
import { parseFactValue, validateInjection } from "../../../src/run/injection.js";

const policy = defaultDecisionPolicy(0.7);

test("validates each typed injection kind", () => {
  const fact = validateInjection(
    { kind: "fact", actor: "user", confidence: 0.9, key: "coverage", value: "green" },
    { policy }
  );
  assert.equal(fact.kind, "fact");
  if (fact.kind !== "fact") throw new Error("expected fact");
  assert.equal(fact.key, "coverage");
  assert.equal(fact.value, "green");
  assert.equal(fact.requiresApproval, false);

  const override = validateInjection(
    { kind: "override", actor: "user", confidence: 0.81, nodeId: "work" },
    { policy, nodeState: (id) => (id === "work" ? "COMPLETED" : undefined) }
  );
  assert.equal(override.kind, "override");
  if (override.kind !== "override") throw new Error("expected override");
  assert.equal(override.nodeId, "work");
  assert.equal(override.confidence, 0.81);

  const skip = validateInjection(
    { kind: "skip", actor: "user", confidence: 1, nodeId: "later" },
    { policy, nodeState: (id) => (id === "later" ? "PENDING" : undefined) }
  );
  assert.equal(skip.kind, "skip");
  if (skip.kind !== "skip") throw new Error("expected skip");
  assert.equal(skip.nodeId, "later");
});

test("rejects an unknown injection kind", () => {
  assert.throws(
    () => validateInjection({ kind: "eval", actor: "user", confidence: 1 }, { policy }),
    /unknown|kind/i
  );
});

test("skip of a RUNNING node fails closed", () => {
  assert.throws(
    () =>
      validateInjection(
        { kind: "skip", actor: "user", confidence: 1, nodeId: "work" },
        { policy, nodeState: (id) => (id === "work" ? "RUNNING" : undefined) }
      ),
    /RUNNING|cannot skip/i
  );
});

test("non-scalar fact values fail closed", () => {
  assert.throws(
    () =>
      validateInjection(
        { kind: "fact", actor: "user", confidence: 1, key: "k", value: { nested: true } },
        { policy }
      ),
    /scalar|value/i
  );
  assert.throws(
    () =>
      validateInjection(
        { kind: "fact", actor: "user", confidence: 1, key: "k", value: [1, 2] },
        { policy }
      ),
    /scalar|value/i
  );
  assert.throws(() => parseFactValue("{}"), /scalar/i);
  assert.throws(() => parseFactValue("[1]"), /scalar/i);
});

test("DecisionPolicy is consulted for confidence bounds", () => {
  let seen: number | undefined;
  const consulting = {
    version: "test-policy",
    minHumanConfidence: 0.7,
    requiresApproval: (confidence: number) => {
      seen = confidence;
      return confidence < 0.7;
    }
  };
  const below = validateInjection(
    { kind: "fact", actor: "user", confidence: 0.2, key: "k", value: "v" },
    { policy: consulting }
  );
  assert.equal(seen, 0.2);
  assert.equal(below.requiresApproval, true);

  assert.throws(
    () => validateInjection({ kind: "override", actor: "user", confidence: 1.5, nodeId: "n" }, { policy }),
    /confidence/i
  );
  assert.throws(
    () => validateInjection({ kind: "fact", actor: "user", confidence: -0.1, key: "k", value: "v" }, { policy }),
    /confidence/i
  );
});

test("skip with a fact key is rejected as a mismatched field", () => {
  assert.throws(
    () =>
      validateInjection(
        { kind: "skip", actor: "user", confidence: 1, nodeId: "later", key: "nope" },
        { policy, nodeState: () => "PENDING" }
      ),
    /key|mismatch|not valid/i
  );
});

test("parseFactValue accepts JSON scalars or a bare token", () => {
  assert.equal(parseFactValue('"x"'), "x");
  assert.equal(parseFactValue("1"), 1);
  assert.equal(parseFactValue("true"), true);
  assert.equal(parseFactValue("hello"), "hello");
});
