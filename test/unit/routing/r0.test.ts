import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hasCapability,
  satisfiesPrivacy,
  validateModelDescriptor,
} from "../../../src/routing/capability-registry.js";
import type { ModelDescriptor } from "../../../src/routing/capability-registry.js";
import { evaluateCandidate } from "../../../src/routing/policy.js";
import type { RouteRequest } from "../../../src/routing/policy.js";
import { applyCascade, routeR0 } from "../../../src/routing/r0.js";
import type { R0Config } from "../../../src/routing/r0.js";

function model(overrides: Partial<ModelDescriptor> & { modelId: string }): ModelDescriptor {
  return {
    providerId: "acme",
    version: "1.0",
    contextWindow: 128_000,
    maxOutputTokens: 16_000,
    capabilities: ["tool-use"],
    privacyClass: "cloud-approved",
    providerPolicy: "approved",
    inputCostPerMTok: 1.0,
    outputCostPerMTok: 3.0,
    latencyMsPer1K: 80,
    ...overrides,
  };
}

function request(overrides: Partial<RouteRequest> = {}): RouteRequest {
  return {
    taskFamily: "bugfix",
    privacyRequired: "cloud-approved",
    requiredCapabilities: ["tool-use"],
    contextNeeded: 100_000,
    outputNeeded: 4_000,
    budgetUsd: 1.0,
    deadlineMs: 60_000,
    highRisk: false,
    ...overrides,
  };
}

const config: R0Config = { confidenceGate: 0.7, cascade: true, policyVersion: "r0-v1" };

const CHEAP_LOCAL = model({
  modelId: "cheap-local",
  providerId: "local",
  privacyClass: "local",
  contextWindow: 32_000,
  maxOutputTokens: 8_000,
  inputCostPerMTok: 0.1,
  outputCostPerMTok: 0.3,
  latencyMsPer1K: 50,
});
const MID_CLOUD = model({
  modelId: "mid-cloud",
  contextWindow: 128_000,
  maxOutputTokens: 16_000,
  capabilities: ["tool-use", "vision"],
  inputCostPerMTok: 0.5,
  outputCostPerMTok: 1.5,
  latencyMsPer1K: 80,
  approvedForHighRisk: true,
});
const BIG_GENERAL = model({
  modelId: "big-general",
  privacyClass: "cloud-general",
  contextWindow: 200_000,
  maxOutputTokens: 32_000,
  capabilities: ["tool-use", "vision", "structured-output"],
  inputCostPerMTok: 2.0,
  outputCostPerMTok: 6.0,
  latencyMsPer1K: 120,
  approvedForHighRisk: true,
});
const FORBIDDEN = model({
  modelId: "forbidden-cheap",
  providerId: "rogue",
  providerPolicy: "forbidden",
  inputCostPerMTok: 0.01,
  outputCostPerMTok: 0.01,
});
const TINY_CONTEXT = model({
  modelId: "tiny-context",
  contextWindow: 4_000,
  maxOutputTokens: 2_000,
});

const ALL = [CHEAP_LOCAL, MID_CLOUD, BIG_GENERAL, FORBIDDEN, TINY_CONTEXT];

describe("M5-T1: capability catalog (explicit models[], no mutable registry)", () => {
  it("descriptor validation rejects missing version and non-positive token limits", () => {
    assert.equal(validateModelDescriptor(MID_CLOUD), MID_CLOUD);
    assert.throws(
      () => validateModelDescriptor(model({ modelId: "bad", contextWindow: 0 })),
      /non-positive/
    );
    assert.throws(
      () => validateModelDescriptor(model({ modelId: "no-version", version: "" })),
      /must declare version/
    );
  });

  it("unknown capabilities are never treated as supported", () => {
    assert.equal(hasCapability(MID_CLOUD, "tool-use"), true);
    assert.equal(hasCapability(MID_CLOUD, "image-gen"), false);
    assert.equal(hasCapability(MID_CLOUD, "structured-output"), false);
  });

  it("privacy ranking: stricter models can serve looser requirements, never the reverse", () => {
    assert.equal(satisfiesPrivacy(CHEAP_LOCAL, "local"), true);
    assert.equal(satisfiesPrivacy(CHEAP_LOCAL, "cloud-approved"), true);
    assert.equal(satisfiesPrivacy(MID_CLOUD, "cloud-approved"), true);
    assert.equal(satisfiesPrivacy(MID_CLOUD, "local"), false);
    assert.equal(satisfiesPrivacy(BIG_GENERAL, "cloud-approved"), false);
    assert.equal(satisfiesPrivacy(BIG_GENERAL, "cloud-general"), true);
  });

  it("undeclared privacy class fails closed for local and cloud-approved data", () => {
    const undeclared = model({ modelId: "undeclared", privacyClass: undefined });
    assert.equal(satisfiesPrivacy(undeclared, "local"), false);
    assert.equal(satisfiesPrivacy(undeclared, "cloud-approved"), false);
    assert.equal(satisfiesPrivacy(undeclared, "cloud-general"), true);
  });
});

describe("M5-T1: hard-constraint matrix", () => {
  it("provider policy is a hard constraint even for the cheapest model", () => {
    const check = evaluateCandidate(FORBIDDEN, request());
    assert.equal(check.eligible, false);
    assert.ok(check.failures.some((f) => f.constraint === "provider-policy"));
  });

  it("privacy class rejects cloud-general models for cloud-approved data", () => {
    const check = evaluateCandidate(BIG_GENERAL, request({ privacyRequired: "cloud-approved" }));
    assert.ok(check.failures.some((f) => f.constraint === "privacy-class"));
  });

  it("undeclared capabilities reject; declared capabilities pass", () => {
    const needVision = request({ requiredCapabilities: ["tool-use", "vision"] });
    assert.equal(evaluateCandidate(MID_CLOUD, needVision).eligible, true);
    const visionFailure = evaluateCandidate(CHEAP_LOCAL, needVision);
    assert.ok(visionFailure.failures.some((f) => f.constraint === "capability"));
    assert.match(visionFailure.failures[0]?.detail ?? "", /vision/);
  });

  it("context window and max output are hard constraints", () => {
    const bigContext = request({ contextNeeded: 150_000 });
    assert.ok(
      evaluateCandidate(MID_CLOUD, bigContext).failures.some((f) => f.constraint === "context-window")
    );
    const bigOutput = request({ outputNeeded: 20_000 });
    assert.ok(
      evaluateCandidate(MID_CLOUD, bigOutput).failures.some((f) => f.constraint === "max-output")
    );
    assert.ok(evaluateCandidate(TINY_CONTEXT, request()).failures.some((f) => f.constraint === "context-window"));
  });

  it("budget and deadline are hard constraints with attributable estimates", () => {
    const tightBudget = request({ budgetUsd: 0.05 });
    const budgetFailure = evaluateCandidate(MID_CLOUD, tightBudget);
    assert.ok(budgetFailure.failures.some((f) => f.constraint === "budget"));

    const tightDeadline = request({ deadlineMs: 100 });
    const deadlineFailure = evaluateCandidate(MID_CLOUD, tightDeadline);
    assert.ok(deadlineFailure.failures.some((f) => f.constraint === "deadline"));
  });

  it("high-risk requests reject models without explicit high-risk approval", () => {
    const check = evaluateCandidate(CHEAP_LOCAL, request({ highRisk: true }));
    assert.ok(check.failures.some((f) => f.constraint === "high-risk-approval"));
    assert.equal(evaluateCandidate(MID_CLOUD, request({ highRisk: true })).eligible, true);
  });
});

describe("M5-T1: R0 router", () => {
  it("selects the cheapest eligible model and records every candidate rejection", () => {
    const decision = routeR0(config, ALL, request());
    assert.equal(decision.selection, "mid-cloud");
    assert.equal(decision.candidates.length, 5);
    assert.equal(decision.exploratory, false);
    // cheap-local is cheapest but its context window is too small -> recorded.
    const cheap = decision.candidates.find((c) => c.modelId === "cheap-local");
    assert.equal(cheap?.eligible, false);
    assert.ok(cheap?.failures.some((f) => f.constraint === "context-window"));
  });

  it("falls back to the cheapest eligible when context allows, and lists cascade tiers", () => {
    const smallContext = request({ contextNeeded: 20_000, outputNeeded: 2_000 });
    const decision = routeR0(config, ALL, smallContext);
    assert.equal(decision.selection, "cheap-local");
    // big-general is privacy-rejected under cloud-approved.
    assert.deepEqual(decision.fallbacks, ["mid-cloud"]);
  });

  it("privacy requirement removes cloud-general from eligibility entirely", () => {
    const decision = routeR0(config, ALL, request({ privacyRequired: "cloud-approved" }));
    assert.ok(!decision.candidates.find((c) => c.modelId === "big-general")?.eligible);
  });

  it("fails closed when nothing is eligible and records the reason", () => {
    const impossible = request({ requiredCapabilities: ["image-gen"] });
    const decision = routeR0(config, ALL, impossible);
    assert.equal(decision.selection, undefined);
    assert.match(decision.reason, /refused/);
    assert.ok(decision.candidates.every((c) => !c.eligible));
  });

  it("high-risk routes only to approved models and never explores", () => {
    const decision = routeR0(config, ALL, request({ highRisk: true, budgetUsd: 5 }));
    assert.equal(decision.selection, "mid-cloud");
    assert.equal(decision.exploratory, false);
    assert.ok(decision.candidates.find((c) => c.modelId === "cheap-local")?.failures
      .some((f) => f.constraint === "high-risk-approval"));
  });

  it("high-risk fails closed when no approved model is eligible", () => {
    const tinyBudget = request({ highRisk: true, budgetUsd: 0.01 });
    const decision = routeR0(config, ALL, tinyBudget);
    assert.equal(decision.selection, undefined);
    assert.match(decision.reason, /high-risk/);
  });

  it("cost-cascade escalates below the confidence gate and records the step", () => {
    // cloud-general privacy keeps both mid-cloud and big-general eligible.
    const decision = routeR0(
      config,
      ALL,
      request({ privacyRequired: "cloud-general" })
    );
    assert.equal(decision.selection, "mid-cloud");
    assert.deepEqual(decision.fallbacks, ["big-general"]);

    const escalated = applyCascade(config, decision, {
      previousModelId: "mid-cloud",
      previousConfidence: 0.3,
    });
    assert.equal(escalated.selection, "big-general");
    assert.deepEqual(escalated.escalations, ["mid-cloud->big-general"]);
    assert.match(escalated.reason, /escalated mid-cloud -> big-general/);

    // A further failure stays on the most expensive tier.
    const exhausted = applyCascade(config, escalated, {
      previousModelId: "big-general",
      previousConfidence: 0.1,
    });
    assert.equal(exhausted.selection, "big-general");
    assert.match(exhausted.reason, /exhausted/);
  });

  it("cascade retains a tier that clears the confidence gate", () => {
    const decision = routeR0(config, ALL, request({ contextNeeded: 20_000 }));
    const retained = applyCascade(config, decision, {
      previousModelId: "cheap-local",
      previousConfidence: 0.9,
    });
    assert.equal(retained.selection, "cheap-local");
    assert.match(retained.reason, /retained cheap-local/);
  });

  it("cascade can be disabled by policy and refuses to move", () => {
    const noCascade: R0Config = { ...config, cascade: false };
    const decision = routeR0(noCascade, ALL, request());
    const after = applyCascade(noCascade, decision, {
      previousModelId: "mid-cloud",
      previousConfidence: 0.1,
    });
    assert.equal(after.selection, "mid-cloud");
    assert.match(after.reason, /cascade disabled/);
  });

  it("an empty catalog fails closed with a recorded refusal", () => {
    const decision = routeR0(config, [], request());
    assert.equal(decision.selection, undefined);
    assert.equal(decision.candidates.length, 0);
    assert.match(decision.reason, /refused/);
  });
});
