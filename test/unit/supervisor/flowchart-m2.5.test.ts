import assert from "node:assert/strict";
import { test } from "node:test";

import { createMessageId, createTaskId } from "../../../src/domain/ids.js";
import type { ApprovalPlan } from "../../../src/domain/flowchart.js";
import { validateEvent } from "../../../src/run/events.js";
import { makeEvent } from "../../helpers/event-factory.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";
const approvalPlan: ApprovalPlan = {
  id: "plan-apply",
  items: [
    { id: "apply-a", label: "Apply A", selectable: true },
    { id: "apply-b", label: "Apply B", selectable: true },
    { id: "required", label: "Required context", selectable: false }
  ]
};

test("MODEL_ROUTED is a validated durable event", () => {
  const payload = {
    taskId: createTaskId(UUID),
    role: "actor",
    complexity: "MEDIUM",
    model: "configured-model",
    justification: "Configured model supports actor work and fits remaining limits",
    confidence: 0.8,
    approvalPlan,
    statusAfterRoute: "RUNNING",
    policyVersion: "router-v1",
    estimatedCostUsd: 0.2,
    estimatedDurationMs: 2_000,
    family: "edit",
    featureVersion: "flowchart-v1",
    modelVersion: "configured-model-v1",
    highRisk: false,
    eligibleModels: ["configured-model"],
    rejections: [],
    behaviorDistribution: { "configured-model": 1 }
  };
  const event = makeEvent("MODEL_ROUTED", payload);
  assert.deepEqual(validateEvent(event), event);
  assert.throws(() => validateEvent(makeEvent("MODEL_ROUTED", { ...payload, confidence: Number.NaN })), /confidence/i);
  assert.throws(() => validateEvent(makeEvent("MODEL_ROUTED", { ...payload, justification: "" })), /justification/i);
  assert.throws(() => validateEvent(makeEvent("MODEL_ROUTED", { ...payload, statusAfterRoute: "BLOCKED" })), /statusAfterRoute/i);
  assert.throws(
    () => validateEvent(makeEvent("MODEL_ROUTED", { ...payload, approvalPlan: { ...approvalPlan, id: "" } })),
    /approvalPlan/i
  );
});

test("RUN_WAITING_FOR_USER carries the authoritative approval plan", () => {
  const messageId = createMessageId(UUID);
  const withPlan = makeEvent("RUN_WAITING_FOR_USER", { messageId, approvalPlan });
  assert.deepEqual(validateEvent(withPlan), withPlan);

  // M1 compatibility: waiting without any plan stays valid.
  const withoutPlan = makeEvent("RUN_WAITING_FOR_USER", { messageId });
  assert.deepEqual(validateEvent(withoutPlan), withoutPlan);

  assert.throws(
    () => validateEvent(makeEvent("RUN_WAITING_FOR_USER", { messageId, approvalPlan: { items: approvalPlan.items } })),
    /approvalPlan.*id/i
  );
  assert.throws(
    () => validateEvent(makeEvent("RUN_WAITING_FOR_USER", { messageId, approvalPlan: { id: "p", items: [] } })),
    /approvalPlan/i
  );
});

test("USER_ANSWER references a plan by id and never carries the plan itself", () => {
  const messageId = createMessageId(UUID);
  const payload = {
    messageId,
    answer: "Apply the selected actions",
    approvalReply: { approvalPlanId: approvalPlan.id, selectedActionIds: ["apply-b"] }
  };
  assert.deepEqual(validateEvent(makeEvent("USER_ANSWER", payload)).payload, payload);

  // A client-supplied plan is not part of the contract, so it cannot be trusted
  // to authorize anything: only the referenced id is accepted.
  const reply = validateEvent(makeEvent("USER_ANSWER", payload)).payload as Record<string, unknown>;
  assert.equal(reply.approvalPlan, undefined);

  assert.throws(
    () =>
      validateEvent(
        makeEvent("USER_ANSWER", {
          messageId,
          answer: "Apply the selected actions",
          approvalReply: { approvalPlanId: approvalPlan.id, selectedActionIds: ["apply-b"] },
          approvalPlan
        })
      ),
    /approvalPlan/
  );

  // Plain M1 answers remain valid.
  const plain = makeEvent("USER_ANSWER", { messageId, answer: "Yes" });
  assert.deepEqual(validateEvent(plain), plain);
});

test("USER_ANSWER answeredBy accepts user, assume-defaults-auto, and legacy absence", () => {
  const messageId = createMessageId(UUID);
  const base = {
    messageId,
    answer: "Selected route:premium",
    approvalReply: { approvalPlanId: approvalPlan.id, selectedActionIds: ["apply-b"] }
  };
  assert.deepEqual(
    validateEvent(makeEvent("USER_ANSWER", { ...base, answeredBy: "user" })).payload,
    { ...base, answeredBy: "user" }
  );
  assert.deepEqual(
    validateEvent(makeEvent("USER_ANSWER", { ...base, answeredBy: "assume-defaults-auto" })).payload,
    { ...base, answeredBy: "assume-defaults-auto" }
  );
  assert.deepEqual(validateEvent(makeEvent("USER_ANSWER", base)).payload, base);
  assert.throws(
    () => validateEvent(makeEvent("USER_ANSWER", { ...base, answeredBy: "operator" })),
    /answeredBy/
  );
});

test("USER_ANSWER static validation rejects malformed and duplicate action ids", () => {
  const messageId = createMessageId(UUID);
  const answer = "Apply";
  const cases: Array<[unknown, RegExp]> = [
    [{ approvalPlanId: "", selectedActionIds: ["apply-a"] }, /approvalPlanId/i],
    [{ selectedActionIds: ["apply-a"] }, /approvalPlanId/i],
    [{ approvalPlanId: "plan-apply", selectedActionIds: "apply-a" }, /must be an array/i],
    [{ approvalPlanId: "plan-apply", selectedActionIds: [""] }, /non-empty/i],
    [{ approvalPlanId: "plan-apply", selectedActionIds: ["apply-a", "apply-a"] }, /unique/i],
    [{ approvalPlanId: "plan-apply" }, /selectedActionIds/i],
    ["yes", /object/i]
  ];
  for (const [approvalReply, pattern] of cases) {
    assert.throws(() => validateEvent(makeEvent("USER_ANSWER", { messageId, answer, approvalReply })), pattern);
  }
});

test("static event validation does not claim to verify the selected subset", () => {
  // "apply-z" is not in the plan at all, yet static validation accepts it:
  // deciding subset legality requires the persisted plan, which the event
  // validator does not have. The correlation validator is what rejects it.
  const event = makeEvent("USER_ANSWER", {
    messageId: createMessageId(UUID),
    answer: "Apply",
    approvalReply: { approvalPlanId: "plan-apply", selectedActionIds: ["apply-z"] }
  });
  assert.deepEqual(validateEvent(event), event);
});
