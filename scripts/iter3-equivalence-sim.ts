/**
 * Iteration-3 equivalence & performance simulation.
 *
 * Compares the iteration-2 (commit dc5e680) implementation of
 * `replayPolicy` — embedded below, verbatim, as the frozen CONTROL —
 * against the current production code for:
 *
 *   H1  replayPolicy exclusion filter over a prebuilt Set (O(N+E) membership
 *       instead of O(N×E) Array.prototype.includes scans)
 *
 * Every check demands bitwise-identical floats (Object.is) and identical
 * structures/strings, including thrown error messages. Only `replayPolicy`
 * changed this round; `createSeededRng`, `assertIsolatedOutput`,
 * `manifestHash`, `stableStringify`, `hash32`, and `DomainValidationError`
 * are imported from production so the diff under test is exactly the H1
 * edit. The script never touches production state; it only calls pure
 * functions. Run with: npx tsx scripts/iter3-equivalence-sim.ts
 */

import {
  assertIsolatedOutput,
  createSeededRng,
  replayPolicy,
  type FrozenEpisode,
  type ReplayAction,
  type ReplayCacheIdentity,
  type ReplayResult,
  type RoutingPolicy,
} from "../src/experiments/replay.js";
import { manifestHash, stableStringify, type DatasetManifest } from "../src/experiments/manifest.js";
import { hash32 } from "../src/domain/hash.js";
import { DomainValidationError } from "../src/domain/errors.js";

/* ------------------------------------------------------------------ */
/* Frozen iteration-2 reference (control). Verbatim from dc5e680.     */
/* ------------------------------------------------------------------ */

const counters = {
  refMembershipComparisons: 0,
};

/** Counting stand-in for `manifest.exclusions.includes(h)` — same scan order,
 * same SameValueZero semantics, plus a comparison counter. */
function refIncludes(exclusions: readonly string[], hash: string): boolean {
  for (let i = 0; i < exclusions.length; i++) {
    counters.refMembershipComparisons += 1;
    if (exclusions[i] === hash) return true;
  }
  return false;
}

function refReplayPolicy(
  manifest: DatasetManifest,
  episodes: readonly FrozenEpisode[],
  policy: RoutingPolicy,
  outputRoot: string,
  cache?: ReplayCacheIdentity
): ReplayResult {
  assertIsolatedOutput(episodes, outputRoot);

  const byHash = new Map<string, FrozenEpisode>();
  for (const episode of episodes) {
    byHash.set(episode.episodeHash, episode);
  }

  const rng = createSeededRng(manifest.seed);
  const orderedHashes = [...manifest.episodeHashes].filter((h) => !refIncludes(manifest.exclusions, h));
  const actions: ReplayAction[] = [];

  for (const hash of orderedHashes) {
    const episode = byHash.get(hash);
    if (episode === undefined) {
      throw new DomainValidationError(`manifest references missing episode: ${hash}`);
    }
    const eligible = policy.eligibleFor(episode);
    const selected = policy.select(episode, rng);
    if (!eligible.includes(selected)) {
      throw new DomainValidationError(
        `policy selected ${selected} outside the eligible set for ${hash}`
      );
    }
    const propensity = policy.propensityFor(episode, selected);
    const propensities = eligible.map((modelId) => ({
      modelId,
      propensity: policy.propensityFor(episode, modelId),
    }));
    actions.push({ episodeHash: hash, modelId: selected, propensity, eligible, propensities });
  }

  const rerunHash = `rr_${stableStringify({
    actions,
    manifestHash: manifestHash(manifest),
    ...(cache !== undefined ? { cache } : {})
  })}`;
  return {
    manifestHash: manifestHash(manifest),
    rerunHash: hash32(rerunHash),
    actions,
    policyVersion: policy.policyVersion,
    seed: manifest.seed,
  };
}

/* ------------------------------------------------------------------ */
/* Harness                                                            */
/* ------------------------------------------------------------------ */

let checksPassed = 0;
let failures = 0;

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function fail(line: string): void {
  process.stderr.write(`${line}\n`);
}

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    checksPassed += 1;
    return;
  }
  failures += 1;
  fail(`FAIL ${label}${detail === undefined ? "" : `: ${detail}`}`);
}

function sameNumber(a: number, b: number): boolean {
  return Object.is(a, b);
}

function compareResults(label: string, expected: ReplayResult, actual: ReplayResult): void {
  check(`${label}.manifestHash`, expected.manifestHash === actual.manifestHash);
  check(`${label}.rerunHash`, expected.rerunHash === actual.rerunHash, `${expected.rerunHash} vs ${actual.rerunHash}`);
  check(`${label}.policyVersion`, expected.policyVersion === actual.policyVersion);
  check(`${label}.seed`, sameNumber(expected.seed, actual.seed));
  check(
    `${label}.actions.length`,
    expected.actions.length === actual.actions.length,
    `${expected.actions.length} vs ${actual.actions.length}`
  );
  const count = Math.min(expected.actions.length, actual.actions.length);
  for (let i = 0; i < count; i++) {
    const e = expected.actions[i]!;
    const a = actual.actions[i]!;
    check(`${label}.actions[${i}].episodeHash`, e.episodeHash === a.episodeHash, `${e.episodeHash} vs ${a.episodeHash}`);
    check(`${label}.actions[${i}].modelId`, e.modelId === a.modelId, `${e.modelId} vs ${a.modelId}`);
    check(`${label}.actions[${i}].propensity`, sameNumber(e.propensity, a.propensity), `${e.propensity} vs ${a.propensity}`);
    check(
      `${label}.actions[${i}].eligible`,
      e.eligible.length === a.eligible.length && e.eligible.every((id, k) => id === a.eligible[k]),
      `${e.eligible.join(",")} vs ${a.eligible.join(",")}`
    );
    check(
      `${label}.actions[${i}].propensities`,
      e.propensities.length === a.propensities.length &&
        e.propensities.every(
          (row, k) =>
            row.modelId === a.propensities[k]!.modelId && sameNumber(row.propensity, a.propensities[k]!.propensity)
        )
    );
  }
}

/** Deterministic fixture generator (mulberry32, distinct seed space from production). */
function fixtureRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                           */
/* ------------------------------------------------------------------ */

const MODELS = ["cheap", "mid", "premium", "specialist"] as const;

interface Fixture {
  readonly name: string;
  readonly manifest: DatasetManifest;
  readonly episodes: readonly FrozenEpisode[];
  readonly policy: RoutingPolicy;
  readonly outputRoot: string;
  readonly cache?: ReplayCacheIdentity;
}

function makeManifest(input: {
  readonly episodeHashes: readonly string[];
  readonly exclusions: readonly string[];
  readonly seed: number;
}): DatasetManifest {
  return {
    manifestVersion: 1,
    datasetId: "ds-iter3",
    episodeHashes: input.episodeHashes,
    exclusions: input.exclusions,
    split: { train: [], eval: [] },
    resourceVersions: { model: "m-1", features: "f-1" },
    environment: { env: "sim" },
    seed: input.seed,
    createdAt: "2026-08-24T00:00:00.000Z",
  };
}

function makeEpisode(hash: string, index: number): FrozenEpisode {
  return {
    episodeHash: hash,
    request: {
      taskId: `task_${index}`,
      role: "worker",
      complexity: (index % 5) / 4,
      modelPolicy: { allowedModels: [...MODELS], preferredModel: MODELS[index % MODELS.length]! },
      approvalRequired: false,
      highRisk: index % 7 === 0,
    } as unknown as FrozenEpisode["request"],
    role: "worker",
    featureVersion: "fv-1",
    originalWorkspace: `/live/workspace-${index % 3}`,
  };
}

/** Varied eligibility, non-trivial float propensities, one rng draw per select. */
function makePolicy(variant: number): RoutingPolicy {
  return {
    policyVersion: `sim-policy-v${variant}`,
    eligibleFor(episode: FrozenEpisode): readonly string[] {
      const charSum = [...episode.episodeHash].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
      const width = 1 + ((charSum + variant) % MODELS.length);
      return MODELS.slice(0, width);
    },
    propensityFor(episode: FrozenEpisode, modelId: string): number {
      const eligible = this.eligibleFor(episode);
      const index = eligible.indexOf(modelId);
      if (index < 0) return 0;
      // Uneven float weights so bitwise drift would be visible.
      const raw = 1 / (index + 1.7);
      const total = eligible.reduce((acc, _, k) => acc + 1 / (k + 1.7), 0);
      return raw / total;
    },
    select(episode: FrozenEpisode, rng: () => number): string {
      const eligible = this.eligibleFor(episode);
      return eligible[Math.floor(rng() * eligible.length)]!;
    },
  };
}

function randomFixture(rng: () => number, index: number): Fixture {
  const n = 1 + Math.floor(rng() * 200);
  const episodeHashes = Array.from({ length: n }, (_, i) => `h_${index}_${i.toString(16)}`);
  const exclusionRate = rng();
  const exclusions: string[] = [];
  for (const hash of episodeHashes) {
    if (rng() < exclusionRate * 0.5) exclusions.push(hash);
  }
  // Some exclusions that reference no episode at all (pure membership misses).
  if (rng() < 0.3) exclusions.push(`h_missing_${index}`);
  const episodes = episodeHashes.map(makeEpisode);
  return {
    name: `random[${index}]`,
    manifest: makeManifest({ episodeHashes, exclusions, seed: 1 + Math.floor(rng() * 100_000) }),
    episodes,
    policy: makePolicy(index % 5),
    outputRoot: "/replay/out",
    ...(rng() < 0.5
      ? {
          cache: {
            candidateHash: `cand_${index}`,
            environmentVersion: "env-1",
            evaluatorVersion: "ev-1",
          },
        }
      : {}),
  };
}

/* ----------------------- scenario 1: success paths ----------------------- */

function scenarioSuccess(): void {
  const rng = fixtureRng(0x17e3);
  const fixtures: Fixture[] = [];
  for (let i = 0; i < 60; i++) {
    fixtures.push(randomFixture(rng, i));
  }

  // Edge: no exclusions at all.
  const plainHashes = Array.from({ length: 12 }, (_, i) => `p_${i}`);
  fixtures.push({
    name: "no-exclusions",
    manifest: makeManifest({ episodeHashes: plainHashes, exclusions: [], seed: 42 }),
    episodes: plainHashes.map(makeEpisode),
    policy: makePolicy(0),
    outputRoot: "/replay/out",
  });

  // Edge: every episode excluded -> zero actions, rerunHash still computed.
  fixtures.push({
    name: "all-excluded",
    manifest: makeManifest({ episodeHashes: plainHashes, exclusions: [...plainHashes], seed: 43 }),
    episodes: plainHashes.map(makeEpisode),
    policy: makePolicy(1),
    outputRoot: "/replay/out",
  });

  // Edge: duplicate hashes in the episode universe (replayPolicy does not
  // call validateManifest; both sides must process duplicates identically).
  const dupHashes = ["d_0", "d_1", "d_0", "d_2", "d_1"];
  fixtures.push({
    name: "duplicate-hashes",
    manifest: makeManifest({ episodeHashes: dupHashes, exclusions: ["d_1"], seed: 44 }),
    episodes: ["d_0", "d_1", "d_2"].map(makeEpisode),
    policy: makePolicy(2),
    outputRoot: "/replay/out",
  });

  // Edge: duplicate entries inside exclusions (Set dedupes storage; membership
  // answers must not change).
  fixtures.push({
    name: "duplicate-exclusions",
    manifest: makeManifest({
      episodeHashes: plainHashes,
      exclusions: ["p_3", "p_3", "p_7", "p_7", "p_7"],
      seed: 45,
    }),
    episodes: plainHashes.map(makeEpisode),
    policy: makePolicy(3),
    outputRoot: "/replay/out",
  });

  for (const fixture of fixtures) {
    const expected = refReplayPolicy(
      fixture.manifest,
      fixture.episodes,
      fixture.policy,
      fixture.outputRoot,
      fixture.cache
    );
    const actual = replayPolicy(
      fixture.manifest,
      fixture.episodes,
      fixture.policy,
      fixture.outputRoot,
      fixture.cache
    );
    compareResults(fixture.name, expected, actual);
  }
  out(`scenario 1 (replayPolicy H1 success paths): ${fixtures.length} cases compared`);
}

/* ------------------------ scenario 2: error paths ------------------------ */

function scenarioErrors(): void {
  const plainHashes = Array.from({ length: 6 }, (_, i) => `e_${i}`);
  const episodes = plainHashes.map(makeEpisode);
  const policy = makePolicy(0);

  const rogue: RoutingPolicy = {
    policyVersion: "rogue-v1",
    eligibleFor: () => ["cheap"],
    propensityFor: () => 1,
    select: () => "premium",
  };

  const errorCases: Array<{ name: string; run: (impl: typeof replayPolicy) => void }> = [
    {
      name: "missing-episode",
      run: (impl) =>
        impl(
          makeManifest({ episodeHashes: [...plainHashes, "e_ghost"], exclusions: [], seed: 7 }),
          episodes,
          policy,
          "/replay/out"
        ),
    },
    {
      name: "select-outside-eligible",
      run: (impl) =>
        impl(makeManifest({ episodeHashes: plainHashes, exclusions: [], seed: 7 }), episodes, rogue, "/replay/out"),
    },
    {
      name: "output-overlaps-workspace",
      run: (impl) =>
        impl(
          makeManifest({ episodeHashes: plainHashes, exclusions: [], seed: 7 }),
          episodes,
          policy,
          "/live/workspace-0/out"
        ),
    },
  ];

  for (const testCase of errorCases) {
    let expectedMessage: string | undefined;
    let expectedName: string | undefined;
    let actualMessage: string | undefined;
    let actualName: string | undefined;
    try {
      testCase.run(refReplayPolicy);
    } catch (error) {
      expectedMessage = error instanceof Error ? error.message : String(error);
      expectedName = error instanceof Error ? error.constructor.name : "unknown";
    }
    try {
      testCase.run(replayPolicy);
    } catch (error) {
      actualMessage = error instanceof Error ? error.message : String(error);
      actualName = error instanceof Error ? error.constructor.name : "unknown";
    }
    check(
      `error.${testCase.name}.message`,
      expectedMessage !== undefined && expectedMessage === actualMessage,
      `${expectedMessage} vs ${actualMessage}`
    );
    check(
      `error.${testCase.name}.class`,
      expectedName !== undefined && expectedName === actualName,
      `${expectedName} vs ${actualName}`
    );
  }
  out(`scenario 2 (replayPolicy H1 error paths): ${errorCases.length} cases compared`);
}

/* --------------------------- performance fixture --------------------------- */

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function perfFixture(): void {
  const n = 20_000;
  const episodeHashes = Array.from({ length: n }, (_, i) => `perf_${i.toString(16).padStart(6, "0")}`);
  // Exclude every other episode: half the hashes pay a full O(E) miss scan in
  // the reference, the other half scan until their hit position.
  const exclusions = episodeHashes.filter((_, i) => i % 2 === 1);
  const manifest = makeManifest({ episodeHashes, exclusions, seed: 20260824 });
  const episodes = episodeHashes.map(makeEpisode);
  const policy = makePolicy(4);

  // Correctness first: the perf fixture must also be bitwise identical.
  counters.refMembershipComparisons = 0;
  compareResults(
    "perf-fixture",
    refReplayPolicy(manifest, episodes, policy, "/replay/out"),
    replayPolicy(manifest, episodes, policy, "/replay/out")
  );
  const comparisonsPerRun = counters.refMembershipComparisons;

  const runs = 3;
  const oldTimes: number[] = [];
  const newTimes: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    refReplayPolicy(manifest, episodes, policy, "/replay/out");
    oldTimes.push(performance.now() - t0);
    const t1 = performance.now();
    replayPolicy(manifest, episodes, policy, "/replay/out");
    newTimes.push(performance.now() - t1);
  }
  const oldMs = median(oldTimes);
  const newMs = median(newTimes);
  out(
    `perf fixture (N=${n} episodes, E=${exclusions.length} exclusions): ` +
      `reference ${oldMs.toFixed(1)} ms -> current ${newMs.toFixed(1)} ms (${(oldMs / newMs).toFixed(1)}x)`
  );
  out(
    `reference membership comparisons per replay on this fixture: ${comparisonsPerRun.toLocaleString("en-US")} ` +
      `(current: one Set build of ${exclusions.length.toLocaleString("en-US")} inserts + ${n.toLocaleString("en-US")} O(1) lookups)`
  );
}

scenarioSuccess();
scenarioErrors();
perfFixture();

if (failures > 0) {
  fail(`\n${failures} EQUIVALENCE CHECK(S) FAILED (${checksPassed} passed)`);
  process.exit(1);
}
out(`\nALL EQUIVALENCE CHECKS PASSED (${checksPassed} bitwise checks)`);
