import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createSignature,
  compareSignatures,
} from "../../../src/learning/signatures.js";
import { detectRepeatedPatterns } from "../../../src/learning/patterns.js";
import { attributeToBoundary } from "../../../src/learning/attribution.js";
import { createEpisodeId } from "../../../src/domain/ids.js";

function sig(kind: "contract" | "context" | "plan" | "route" | "execution" | "tool" | "review" | "delivery", features: Record<string, string | number | boolean>) {
  return createSignature(createEpisodeId(), kind, features);
}

describe("M4-T6: repeated-pattern detector with negative controls", () => {
  it("identical comparable signatures compare at similarity 1 and cross-kind at 0", () => {
    const a = sig("execution", { failure: "timeout", tool: "build" });
    const b = sig("execution", { failure: "timeout", tool: "build" });
    const otherKind = sig("review", { failure: "timeout", tool: "build" });
    assert.equal(compareSignatures(a, b), 1);
    assert.equal(compareSignatures(a, otherKind), 0);
  });

  it("default recurrence requires two comparable episodes", () => {
    assert.deepEqual(detectRepeatedPatterns([]), []);
    const single = sig("execution", { failure: "timeout" });
    assert.deepEqual(detectRepeatedPatterns([single]), []);

    const first = sig("execution", { failure: "timeout", tool: "build" });
    const second = sig("execution", { failure: "timeout", tool: "build" });
    const patterns = detectRepeatedPatterns([first, second]);
    assert.equal(patterns.length, 1);
    assert.equal(patterns[0]?.count, 2);
    assert.equal(patterns[0]?.kind, "execution");
    assert.equal(patterns[0]?.avgSimilarity, 1);
  });

  it("patterns never span episode kinds", () => {
    const execA = sig("execution", { failure: "timeout" });
    const execB = sig("execution", { failure: "timeout" });
    const reviewA = sig("review", { failure: "timeout" });
    const reviewB = sig("review", { failure: "timeout" });
    const patterns = detectRepeatedPatterns([execA, execB, reviewA, reviewB]);
    assert.equal(patterns.length, 2);
    assert.deepEqual(new Set(patterns.map((p) => p.kind)), new Set(["execution", "review"]));
  });

  it("honors a configurable minimum cluster size", () => {
    const s1 = sig("tool", { tool: "git", failure: "auth" });
    const s2 = sig("tool", { tool: "git", failure: "auth" });
    const s3 = sig("tool", { tool: "git", failure: "auth" });
    assert.equal(detectRepeatedPatterns([s1, s2, s3], { minCount: 3 }).length, 1);
    assert.equal(detectRepeatedPatterns([s1, s2, s3], { minCount: 4 }).length, 0);
  });

  it("dissimilar signatures do not cluster into patterns", () => {
    const a = sig("execution", { failure: "timeout" });
    const b = sig("execution", { failure: "syntax", tool: "lint", depth: 3 });
    assert.deepEqual(detectRepeatedPatterns([a, b]), []);
  });

  it("negative controls flag repeated reads and edit-only noise from real clusters", () => {
    const reads = [
      sig("execution", { operation: "read", failure: "timeout" }),
      sig("execution", { operation: "read", failure: "timeout" }),
    ];
    const edits = [
      sig("tool", { operation: "edit", tool: "git" }),
      sig("tool", { operation: "edit", tool: "git" }),
    ];
    const patterns = detectRepeatedPatterns([...reads, ...edits]);
    assert.equal(patterns.length, 2);
    assert.ok(patterns.every((p) => p.negativeControl));
  });

  it("negative controls flag missing instrumentation, gate blocks, and unrelated failures", () => {
    const uninstrumented = [
      sig("execution", { instrumented: false, failure: "timeout" }),
      sig("execution", { instrumented: false, failure: "timeout" }),
    ];
    const blocked = [
      sig("plan", { gateBlocked: true, kind_hint: "policy" }),
      sig("plan", { gateBlocked: true, kind_hint: "policy" }),
    ];
    const unrelated = [
      sig("delivery", { unrelated: true, failure: "flaky-ci" }),
      sig("delivery", { unrelated: true, failure: "flaky-ci" }),
    ];
    const patterns = detectRepeatedPatterns([...uninstrumented, ...blocked, ...unrelated]);
    assert.equal(patterns.length, 3);
    assert.ok(patterns.every((p) => p.negativeControl));
  });

  it("a cluster with a benign marker on only some signatures stays actionable", () => {
    const readNoise = sig("execution", { operation: "read", failure: "timeout", tool: "build" });
    const realFailure = sig("execution", { operation: "execute", failure: "timeout", tool: "build" });
    const patterns = detectRepeatedPatterns([readNoise, realFailure]);
    assert.equal(patterns.length, 1);
    assert.equal(patterns[0]?.negativeControl, false);
  });

  it("attributes findings to the earliest supported boundary", () => {
    const result = attributeToBoundary([
      { kind: "execution", count: 2 },
      { kind: "plan", count: 3 },
    ]);
    assert.equal(result.boundary, "plan");
    assert.equal(result.earliestSupported, "plan");
    assert.equal(result.confidence, 1);

    const single = attributeToBoundary([{ kind: "delivery", count: 2 }]);
    assert.equal(single.boundary, "delivery");
    assert.equal(single.confidence, 2 / 3);
  });

  it("produces an explicit no-candidate result instead of filler patterns", () => {
    const noCandidates = detectRepeatedPatterns([]);
    assert.deepEqual(noCandidates, []);

    const attribution = attributeToBoundary([]);
    assert.equal(attribution.boundary, "contract");
    assert.equal(attribution.confidence, 0);
  });
});
