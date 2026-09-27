import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createSignature,
  compareSignatures,
} from "../../../src/learning/signatures.js";
import type { EpisodeSignature, EpisodeSignatureKind } from "../../../src/learning/signatures.js";
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

  it("a single severe safety event surfaces as a one-off readiness finding", () => {
    const single = sig("execution", { severeSafety: true, failure: "secret-leak" });
    const patterns = detectRepeatedPatterns([single]);
    assert.equal(patterns.length, 1);
    assert.equal(patterns[0]?.count, 1);
    assert.equal(patterns[0]?.oneOffReadiness, true);
    assert.equal(patterns[0]?.negativeControl, false);
    assert.equal(patterns[0]?.kind, "execution");
  });

  it("a single ordinary event still does not surface without recurrence", () => {
    const single = sig("execution", { failure: "timeout" });
    assert.deepEqual(detectRepeatedPatterns([single]), []);
  });

  it("repeated severe safety events stay recurring patterns, not one-offs", () => {
    const a = sig("execution", { severeSafety: true, failure: "secret-leak" });
    const b = sig("execution", { severeSafety: true, failure: "secret-leak" });
    const patterns = detectRepeatedPatterns([a, b]);
    assert.equal(patterns.length, 1);
    assert.equal(patterns[0]?.count, 2);
    assert.equal(patterns[0]?.oneOffReadiness, false);
  });

  it("a severe safety one-off is not suppressed by a benign-cause marker", () => {
    const single = sig("delivery", {
      severeSafety: true,
      unrelated: true,
      failure: "credential-exposed"
    });
    const patterns = detectRepeatedPatterns([single]);
    assert.equal(patterns.length, 1);
    assert.equal(patterns[0]?.oneOffReadiness, true);
  });

  it("produces an explicit no-candidate result instead of filler patterns", () => {
    const noCandidates = detectRepeatedPatterns([]);
    assert.deepEqual(noCandidates, []);

    const attribution = attributeToBoundary([]);
    assert.equal(attribution.boundary, "contract");
    assert.equal(attribution.confidence, 0);
  });
});

function fixedSignature(
  episodeId: string,
  kind: EpisodeSignatureKind,
  features: EpisodeSignature["features"],
  hash = episodeId,
): EpisodeSignature {
  return {
    episodeId: episodeId as EpisodeSignature["episodeId"],
    kind,
    features,
    hash,
    createdAt: "2026-09-27T00:00:00.000Z" as EpisodeSignature["createdAt"],
  };
}

const chainOrders = [
  [0, 1, 2], [0, 2, 1], [1, 0, 2],
  [1, 2, 0], [2, 0, 1], [2, 1, 0],
] as const;

const chainPatterns = [
  {
    key: "execution:cluster-0", kind: "execution", count: 2,
    avgSimilarity: 0.8, negativeControl: false,
    boundary: "execution", oneOffReadiness: false,
  },
  {
    key: "execution:cluster-1", kind: "execution", count: 1,
    avgSimilarity: 1, negativeControl: false,
    boundary: "execution", oneOffReadiness: false,
  },
];

describe("O09b: deterministic complete-link pattern admission", () => {
  // A~B = 4/5, B~C = 3/5, A!~C = 2/5. B sorts first, so comparing
  // candidates only with the seed would incorrectly admit both endpoints.
  const chain = [
    fixedSignature("episode-2", "execution", { a: 0, b: 0, c: 0, d: 0, e: 0 }),
    fixedSignature("episode-1", "execution", { a: 0, b: 0, c: 0, d: 0, e: 1 }),
    fixedSignature("episode-3", "execution", { a: 0, b: 0, c: 1, d: 1, e: 1 }),
  ];

  for (const order of chainOrders) {
    it(`keeps dissimilar chain endpoints apart for permutation ${order.join("")}`, () => {
      const input = order.map((index) => chain[index]!);
      const patterns = detectRepeatedPatterns(input, { minCount: 1 });
      assert.deepEqual(patterns, chainPatterns);
      assert.ok(patterns.every((pattern) => pattern.count <= 2));
      assert.deepEqual(detectRepeatedPatterns(input), [chainPatterns[0]]);
    });
  }

  it("orders kinds consistently across interleaved input", () => {
    const kinds: EpisodeSignatureKind[] = [
      "tool", "route", "review", "plan", "execution", "delivery", "context", "contract",
    ];
    const first = kinds.map((kind) => fixedSignature(`${kind}-1`, kind, { failure: "timeout" }));
    const second = kinds.map((kind) => fixedSignature(`${kind}-2`, kind, { failure: "timeout" }));
    const input = [...first, ...second];
    const expectedKinds = ["context", "contract", "delivery", "execution", "plan", "review", "route", "tool"];
    for (const ordering of [input, [...input].reverse(), [...second, ...first]]) {
      const patterns = detectRepeatedPatterns(ordering);
      assert.deepEqual(patterns.map((pattern) => pattern.kind), expectedKinds);
      assert.ok(patterns.every((pattern) => pattern.count === 2 && pattern.avgSimilarity === 1));
    }
  });

  it("breaks equal episode identities with canonical exact features despite a shared hash", () => {
    const input = [
      fixedSignature("shared", "execution", { a: 0, b: 0, c: 0, d: 0, e: 0 }, "collision"),
      fixedSignature("shared", "execution", { e: 1, d: 0, c: 0, b: 0, a: 0 }, "collision"),
      fixedSignature("shared", "execution", { c: 1, a: 0, e: 1, d: 1, b: 0 }, "collision"),
    ];
    for (const order of chainOrders) {
      assert.deepEqual(
        detectRepeatedPatterns(order.map((index) => input[index]!), { minCount: 1 }),
        chainPatterns,
      );
    }
  });

  for (const [firstValue, secondValue] of [[1, "1"], [true, "true"], [-Infinity, Infinity]] as const) {
    it(`orders exact primitive values ${typeof firstValue}:${firstValue} and ${typeof secondValue}:${secondValue}`, () => {
      const first = fixedSignature("shared", "execution", { severeSafety: true, value: firstValue }, "first");
      const second = fixedSignature("shared", "execution", { value: secondValue, severeSafety: true }, "second");
      for (const input of [[first, second], [second, first]]) {
        assert.deepEqual(
          detectRepeatedPatterns(input).map((pattern) => pattern.key),
          ["execution:one-off:first", "execution:one-off:second"],
        );
      }
    });
  }

  it("orders severe one-offs by episode identity before feature content or legacy hash", () => {
    const first = fixedSignature("episode-1", "delivery", { severeSafety: true, failure: "z", unrelated: true }, "z");
    const second = fixedSignature("episode-2", "delivery", { severeSafety: true, failure: "a", unrelated: true }, "a");
    for (const input of [[second, first], [first, second]]) {
      const patterns = detectRepeatedPatterns(input, { minSimilarity: 0.8 });
      assert.deepEqual(patterns.map((pattern) => pattern.key), ["delivery:one-off:z", "delivery:one-off:a"]);
      assert.ok(patterns.every((pattern) => pattern.oneOffReadiness && !pattern.negativeControl));
    }
  });

  it("does not mutate the input array, signatures, or feature insertion order", () => {
    const input = Object.freeze([...chain].reverse().map((signature) => Object.freeze({
      ...signature,
      episodeId: "shared" as EpisodeSignature["episodeId"],
      features: Object.freeze(Object.fromEntries(Object.entries(signature.features).reverse())),
    })));
    const before = JSON.stringify(input);
    assert.deepEqual(detectRepeatedPatterns(input, { minCount: 1 }), chainPatterns);
    assert.equal(JSON.stringify(input), before);
  });
});
