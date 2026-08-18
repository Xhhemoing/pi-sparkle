import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ResourceRegistry } from "../../../src/adaptation/registry.js";
import type { AuthorIdentity, ResourceIdentity } from "../../../src/adaptation/resource.js";
import { createProjectId, type IdGenerator } from "../../../src/domain/ids.js";
import { proposeFromAnomaly, sanitizePacketForAnalysis } from "../../../src/tracking/analysis.js";
import type { AnomalyPacket, RollingSummary } from "../../../src/tracking/types.js";
import type { IsoTimestamp } from "../../../src/domain/timestamp.js";

const NOW = "2026-08-18T00:00:00.000Z" as IsoTimestamp;
const AUTHOR: AuthorIdentity = { kind: "human", identity: "alice" };

function sequentialIds(): IdGenerator {
  let n = 0;
  return () => {
    n += 1;
    return `trk${String(n).padStart(4, "0")}`;
  };
}

function identity(): ResourceIdentity {
  return {
    kind: "prompt",
    name: "tracker-analysis",
    scope: { kind: "project", projectId: createProjectId(() => "trkproj01") }
  };
}

const SUMMARY: RollingSummary = {
  schemaVersion: 1,
  constraints: [],
  unresolvedQuestions: [],
  confirmedDecisions: [],
  operations: [],
  prescore: 0.9,
  human: { kind: "short-rule", H: 0.2, bucket: "whole-reject" },
  score: 0.41,
  anomalyCodes: ["soft-threshold"],
  evidenceRefs: ["evd_1"],
  openMinors: [],
  omissions: [],
  failClosed: false
};

function packet(): AnomalyPacket {
  return {
    summary: SUMMARY,
    window: {
      contextFacts: ["keep going"],
      toolSituations: [],
      toolBodies: ["stdout blob"]
    },
    P: 0.9,
    H: 0.2,
    score: 0.41,
    gate: "soft-threshold",
    evidenceRefs: ["evd_1"]
  };
}

describe("analysis line", () => {
  it("emits a versioned candidate without promoting or patching the live pointer", () => {
    const registry = new ResourceRegistry({ now: () => NOW, generateId: sequentialIds() });
    const resource = identity();
    const baseline = registry.registerBaseline({
      identity: resource,
      content: "baseline prompt",
      author: AUTHOR
    });
    const candidate = proposeFromAnomaly({
      packet: packet(),
      registry,
      identity: resource
    });
    assert.equal(candidate.status, "proposed");
    assert.equal(candidate.parentVersionId, baseline.versionId);
    assert.equal(registry.getActiveVersion(resource)?.versionId, baseline.versionId);
    assert.equal(candidate.autoPromotable, true);
    assert.match(candidate.contentHash, /^[0-9a-f]+$/);
  });

  it("does not persist hidden chain-of-thought or actor defense on the candidate", () => {
    const registry = new ResourceRegistry({ now: () => NOW, generateId: sequentialIds() });
    const resource = identity();
    registry.registerBaseline({ identity: resource, content: "baseline prompt", author: AUTHOR });
    const dirty = {
      ...packet(),
      actorDefense: "I meant well",
      actorIdentity: "worker-7"
    };
    const sanitized = sanitizePacketForAnalysis(dirty);
    assert.equal("actorDefense" in sanitized, false);
    assert.equal("actorIdentity" in sanitized, false);
    const sanitizedJson = JSON.stringify(sanitized);
    assert.doesNotMatch(sanitizedJson, /chainOfThought/);
    assert.doesNotMatch(sanitizedJson, /hiddenReasoning/);
    const candidate = proposeFromAnomaly({
      packet: dirty,
      registry,
      identity: resource
    });
    const stored = JSON.stringify(candidate);
    assert.doesNotMatch(stored, /I meant well/);
    assert.doesNotMatch(stored, /stdout blob/);
  });
});
