/**
 * R1-J equivalence & performance simulation (SOTA campaign round 1).
 *
 * Compares the baseline (commit 7acb666) implementation of
 * `evaluatePreferenceLoop` — embedded below, verbatim, as the frozen
 * CONTROL — against the current production code for:
 *
 *   J1  per-subject incremental fold with O(1) tombstone undo, replacing the
 *       per-observation whole-history regroup (3× `effectiveBySubject(live)`
 *       + `subjectIsExplicitAnchored` scan + `findIndex`), i.e. Θ(N·L) →
 *       Θ(N log N) where L is the live-history length.
 *
 * Every check demands bitwise-identical results (`Object.is` on fit and on
 * all three integer counters). `MIN_INFERRED_RECURRENCE_DEFAULT` and
 * `createSeededRng` are unchanged this round and imported from production,
 * so the diff under test is exactly the J1 edit. The script never touches
 * production state; it only calls pure functions.
 * Run with: npx tsx scripts/r1j-equivalence-sim.ts
 */

import { evaluatePreferenceLoop } from "../src/preferences/loop-eval.js";
import type { PreferenceLoopReport } from "../src/preferences/loop-eval.js";
import { MIN_INFERRED_RECURRENCE_DEFAULT } from "../src/preferences/store.js";
import type { PreferenceObservation, PreferenceScope } from "../src/preferences/types.js";
import { createSeededRng } from "../src/experiments/replay.js";
import { createEpisodeId, type EpisodeId } from "../src/domain/ids.js";
import { parseIsoTimestamp } from "../src/domain/timestamp.js";

/* ------------------------------------------------------------------ */
/* Frozen baseline reference (control). Verbatim from 7acb666, except  */
/* for renames (ref* prefix) and the marked [instrumentation] lines.   */
/* ------------------------------------------------------------------ */

const counters = {
  refElementVisits: 0,
};

function refSubjectId(obs: PreferenceObservation): string {
  return `${obs.scope}\u0000${obs.scopeKey}\u0000${obs.key}`;
}

function refValueKey(value: string | number | boolean): string {
  return `${typeof value}:${String(value)}`;
}

function refSameValue(
  a: string | number | boolean,
  b: string | number | boolean
): boolean {
  return a === b;
}

function refEffectiveForSubject(
  live: readonly PreferenceObservation[]
): string | number | boolean | undefined {
  let lastExplicit: string | number | boolean | undefined;
  const inferredCounts = new Map<string, number>();
  let lastDurableInferred: string | number | boolean | undefined;

  for (const obs of live) {
    counters.refElementVisits += 1; // [instrumentation]
    if (obs.explicit) {
      lastExplicit = obs.value;
      continue;
    }
    const key = refValueKey(obs.value);
    const count = (inferredCounts.get(key) ?? 0) + 1;
    inferredCounts.set(key, count);
    if (count >= MIN_INFERRED_RECURRENCE_DEFAULT) {
      lastDurableInferred = obs.value;
    }
  }

  return lastExplicit ?? lastDurableInferred;
}

function refEffectiveBySubject(
  live: readonly PreferenceObservation[]
): Map<string, string | number | boolean> {
  const grouped = new Map<string, PreferenceObservation[]>();
  for (const obs of live) {
    counters.refElementVisits += 1; // [instrumentation]
    const id = refSubjectId(obs);
    const list = grouped.get(id) ?? [];
    list.push(obs);
    grouped.set(id, list);
  }
  const result = new Map<string, string | number | boolean>();
  for (const [id, list] of grouped) {
    const value = refEffectiveForSubject(list);
    if (value !== undefined) result.set(id, value);
  }
  return result;
}

function refSubjectIsExplicitAnchored(
  live: readonly PreferenceObservation[],
  id: string
): boolean {
  return live.some((obs) => {
    counters.refElementVisits += 1; // [instrumentation]
    return refSubjectId(obs) === id && obs.explicit;
  });
}

function refEvaluatePreferenceLoop(
  observations: readonly PreferenceObservation[],
  tombstones: ReadonlySet<string>
): PreferenceLoopReport {
  const sorted = [...observations].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
  );

  const live: PreferenceObservation[] = [];
  const lastFlippedAway = new Map<string, string | number | boolean>();

  let laterExplicit = 0;
  let laterExplicitMatches = 0;
  let correctionCost = 0;
  let forgettingEvents = 0;
  let reversalEvents = 0;

  for (const obs of sorted) {
    const id = refSubjectId(obs);
    const before = refEffectiveBySubject(live).get(id);
    const inferredBefore =
      before !== undefined && !refSubjectIsExplicitAnchored(live, id);

    if (obs.explicit && before !== undefined) {
      laterExplicit += 1;
      if (refSameValue(before, obs.value)) {
        laterExplicitMatches += 1;
      } else {
        correctionCost += 1;
        if (inferredBefore) forgettingEvents += 1;
      }
    }

    live.push(obs);
    const mid = refEffectiveBySubject(live).get(id);

    if (tombstones.has(obs.id)) {
      const index = live.findIndex((row) => {
        counters.refElementVisits += 1; // [instrumentation]
        return row.id === obs.id;
      });
      if (index >= 0) live.splice(index, 1);
    }

    const after = refEffectiveBySubject(live).get(id);

    if (tombstones.has(obs.id) && mid !== undefined && after === undefined) {
      forgettingEvents += 1;
    }

    if (before !== undefined && after !== undefined && !refSameValue(before, after)) {
      const origin = lastFlippedAway.get(id);
      if (origin !== undefined && refSameValue(origin, after)) {
        reversalEvents += 1;
      }
      lastFlippedAway.set(id, before);
    } else if (after === undefined) {
      lastFlippedAway.delete(id);
    }
  }

  return {
    fit: laterExplicit === 0 ? 1 : laterExplicitMatches / laterExplicit,
    correctionCost,
    forgettingEvents,
    reversalEvents,
  };
}

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

let totalChecks = 0;
let failures = 0;

function report(line: string): void {
  process.stdout.write(`${line}\n`);
}

function check(label: string, expected: unknown, actual: unknown): void {
  totalChecks += 1;
  if (!Object.is(expected, actual)) {
    failures += 1;
    report(`FAIL ${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function compareCase(
  label: string,
  observations: readonly PreferenceObservation[],
  tombstones: ReadonlySet<string>
): void {
  const expected = refEvaluatePreferenceLoop(observations, tombstones);
  const actual = evaluatePreferenceLoop(observations, tombstones);
  check(`${label}.fit`, expected.fit, actual.fit);
  check(`${label}.correctionCost`, expected.correctionCost, actual.correctionCost);
  check(`${label}.forgettingEvents`, expected.forgettingEvents, actual.forgettingEvents);
  check(`${label}.reversalEvents`, expected.reversalEvents, actual.reversalEvents);
}

/* ------------------------------------------------------------------ */
/* Fixture generation                                                  */
/* ------------------------------------------------------------------ */

const episodeId: EpisodeId = createEpisodeId();

const SCOPES: readonly PreferenceScope[] = ["user", "project", "task-family", "role", "model"];
const SCOPE_KEYS = ["k1", "k2"] as const;
const KEYS = ["format", "tests", "budget"] as const;
const VALUES: readonly (string | number | boolean)[] = [
  "compact",
  "verbose",
  0,
  1,
  2.5,
  -0,
  Number.NaN,
  true,
  false,
  "0",
];
const TIMESTAMPS = [
  "2026-01-01T00:00:00.000Z",
  "2026-01-02T00:00:00.000Z",
  "2026-01-02T00:00:00.000Z", // duplicate on purpose: exercises sort ties
  "2026-01-03T00:00:00.000Z",
  "2026-01-04T00:00:00.000Z",
  "2026-01-05T00:00:00.000Z",
].map(parseIsoTimestamp);

function pick<T>(rng: () => number, pool: readonly T[]): T {
  return pool[Math.floor(rng() * pool.length)]!;
}

function observation(
  overrides: Partial<PreferenceObservation> &
    Pick<PreferenceObservation, "id" | "value" | "createdAt" | "explicit">
): PreferenceObservation {
  return {
    scope: "user",
    scopeKey: "u1",
    key: "format",
    evidenceEpisodeId: episodeId,
    weight: overrides.explicit ? 1 : 0.5,
    recurrenceCount: 1,
    ...overrides,
  };
}

function randomCase(rng: () => number, size: number): {
  observations: PreferenceObservation[];
  tombstones: Set<string>;
} {
  const observations: PreferenceObservation[] = [];
  const tombstones = new Set<string>();
  for (let i = 0; i < size; i++) {
    // ~12% duplicate record ids (some also tombstoned), the adversarial case
    // for the removal-targets-the-just-pushed-observation invariant.
    const reuse = i > 0 && rng() < 0.12;
    const id = reuse ? observations[Math.floor(rng() * observations.length)]!.id : `o${i}`;
    const obs = observation({
      id,
      scope: pick(rng, SCOPES),
      scopeKey: pick(rng, SCOPE_KEYS),
      key: pick(rng, KEYS),
      value: pick(rng, VALUES),
      createdAt: pick(rng, TIMESTAMPS),
      explicit: rng() < 0.3,
      weight: rng(),
      recurrenceCount: 1 + Math.floor(rng() * 3), // ignored by loop-eval; proves independence
    });
    // ~8% duplicate object references.
    if (i > 0 && rng() < 0.08) {
      observations.push(observations[Math.floor(rng() * observations.length)]!);
    }
    observations.push(obs);
    if (rng() < 0.25) tombstones.add(obs.id);
  }
  // Tombstone ids that never occur.
  tombstones.add("absent-1");
  tombstones.add("absent-2");
  return { observations, tombstones };
}

/* ------------------------------------------------------------------ */
/* Scenario 1: deterministic edge cases                                */
/* ------------------------------------------------------------------ */

report("scenario 1 (deterministic edge cases):");

compareCase("empty", [], new Set());
compareCase("empty-with-tombstones", [], new Set(["x"]));

const t = (index: number) => TIMESTAMPS[index]!;

compareCase(
  "unit-mirror-agree",
  [
    observation({ id: "e1", value: "compact", explicit: true, createdAt: t(0) }),
    observation({ id: "e2", value: "compact", explicit: true, createdAt: t(1) }),
  ],
  new Set()
);
compareCase(
  "unit-mirror-reversal",
  [
    observation({ id: "e1", value: "compact", explicit: true, createdAt: t(0) }),
    observation({ id: "e2", value: "verbose", explicit: true, createdAt: t(1) }),
    observation({ id: "e3", value: "compact", explicit: true, createdAt: t(3) }),
  ],
  new Set()
);
compareCase(
  "threshold-boundary-single-inferred",
  [
    observation({ id: "i1", value: "compact", explicit: false, createdAt: t(0) }),
    observation({ id: "e1", value: "verbose", explicit: true, createdAt: t(1) }),
  ],
  new Set()
);
compareCase(
  "threshold-boundary-durable-inferred",
  [
    observation({ id: "i1", value: "compact", explicit: false, createdAt: t(0) }),
    observation({ id: "i2", value: "compact", explicit: false, createdAt: t(1) }),
    observation({ id: "e1", value: "verbose", explicit: true, createdAt: t(3) }),
  ],
  new Set()
);
compareCase(
  "tombstone-forgetting",
  [observation({ id: "e1", value: "compact", explicit: true, createdAt: t(0) })],
  new Set(["e1"])
);
compareCase(
  "false-valued-effective",
  [
    observation({ id: "e1", value: false, explicit: true, createdAt: t(0) }),
    observation({ id: "e2", value: false, explicit: true, createdAt: t(1) }),
    observation({ id: "e3", value: true, explicit: true, createdAt: t(3) }),
  ],
  new Set()
);
compareCase(
  "nan-values",
  [
    observation({ id: "e1", value: Number.NaN, explicit: true, createdAt: t(0) }),
    observation({ id: "e2", value: Number.NaN, explicit: true, createdAt: t(1) }),
    observation({ id: "i1", value: Number.NaN, explicit: false, createdAt: t(3) }),
    observation({ id: "i2", value: Number.NaN, explicit: false, createdAt: t(4) }),
  ],
  new Set(["e2"])
);
compareCase(
  "duplicate-tombstoned-id-cross-subject",
  [
    observation({ id: "dup", value: "a", explicit: true, createdAt: t(0), key: "format" }),
    observation({ id: "dup", value: "b", explicit: true, createdAt: t(1), key: "tests" }),
    observation({ id: "dup", value: "c", explicit: true, createdAt: t(3), key: "format" }),
  ],
  new Set(["dup"])
);
compareCase(
  "duplicate-tombstoned-id-same-subject",
  [
    observation({ id: "keep", value: "a", explicit: true, createdAt: t(0) }),
    observation({ id: "dup", value: "b", explicit: true, createdAt: t(1) }),
    observation({ id: "dup", value: "c", explicit: true, createdAt: t(3) }),
    observation({ id: "keep2", value: "a", explicit: true, createdAt: t(4) }),
  ],
  new Set(["dup"])
);
compareCase(
  "duplicate-live-id-no-tombstone",
  [
    observation({ id: "dup", value: "a", explicit: true, createdAt: t(0) }),
    observation({ id: "dup", value: "b", explicit: true, createdAt: t(1) }),
  ],
  new Set()
);
{
  const shared = observation({ id: "ref", value: "a", explicit: true, createdAt: t(0) });
  compareCase("duplicate-reference-tombstoned", [shared, shared], new Set(["ref"]));
  compareCase("duplicate-reference-live", [shared, shared], new Set());
}
compareCase(
  "tombstoned-flip-does-not-stick",
  [
    observation({ id: "e1", value: "a", explicit: true, createdAt: t(0) }),
    observation({ id: "gone", value: "b", explicit: true, createdAt: t(1) }),
    observation({ id: "e2", value: "b", explicit: true, createdAt: t(3) }),
    observation({ id: "e3", value: "a", explicit: true, createdAt: t(4) }),
  ],
  new Set(["gone"])
);
{
  // Frozen inputs: neither implementation may mutate the caller's data.
  const frozen = [
    Object.freeze(observation({ id: "e1", value: "compact", explicit: true, createdAt: t(1) })),
    Object.freeze(observation({ id: "i1", value: "verbose", explicit: false, createdAt: t(0) })),
  ] as const;
  Object.freeze(frozen);
  compareCase("frozen-inputs", frozen, new Set(["e1"]));
}

const scenario1Checks = totalChecks;
report(`  ${scenario1Checks} checks over ${scenario1Checks / 4} cases`);

/* ------------------------------------------------------------------ */
/* Scenario 2: randomized fixtures                                     */
/* ------------------------------------------------------------------ */

const rng = createSeededRng(0x517a1e);
const RANDOM_CASES = 600;
for (let round = 0; round < RANDOM_CASES; round++) {
  const size = 1 + Math.floor(rng() * 120);
  const { observations, tombstones } = randomCase(rng, size);
  compareCase(`random-${round}`, observations, tombstones);
}
report(
  `scenario 2 (randomized): ${totalChecks - scenario1Checks} checks over ${RANDOM_CASES} cases`
);

/* ------------------------------------------------------------------ */
/* Performance fixture                                                 */
/* ------------------------------------------------------------------ */

const perfRng = createSeededRng(0xbeef);
const PERF_N = 6000;
const perfFixture = randomCase(perfRng, PERF_N);

function median(samples: number[]): number {
  const sortedSamples = [...samples].sort((a, b) => a - b);
  return sortedSamples[Math.floor(sortedSamples.length / 2)]!;
}

function time(run: () => PreferenceLoopReport): number {
  const start = process.hrtime.bigint();
  run();
  return Number(process.hrtime.bigint() - start) / 1e6;
}

const refSamples: number[] = [];
const currentSamples: number[] = [];
counters.refElementVisits = 0;
refEvaluatePreferenceLoop(perfFixture.observations, perfFixture.tombstones); // warm-up + count
const refVisitsPerEvaluation = counters.refElementVisits;
evaluatePreferenceLoop(perfFixture.observations, perfFixture.tombstones); // warm-up
for (let i = 0; i < 5; i++) {
  refSamples.push(time(() => refEvaluatePreferenceLoop(perfFixture.observations, perfFixture.tombstones)));
  currentSamples.push(time(() => evaluatePreferenceLoop(perfFixture.observations, perfFixture.tombstones)));
}
compareCase("perf-fixture", perfFixture.observations, perfFixture.tombstones);

const refMs = median(refSamples);
const currentMs = median(currentSamples);
report(`perf fixture (N=${PERF_N}, multi-subject, ~25% tombstoned):`);
report(`  reference ${refMs.toFixed(1)} ms -> current ${currentMs.toFixed(1)} ms (${(refMs / currentMs).toFixed(1)}x)`);
report(`  reference element visits per evaluation: ${refVisitsPerEvaluation.toLocaleString("en-US")}`);
report(`  (current: O(1) map operations per observation after the O(N log N) sort)`);

/* ------------------------------------------------------------------ */
/* Verdict                                                             */
/* ------------------------------------------------------------------ */

if (failures > 0) {
  report(`${failures} of ${totalChecks} checks FAILED`);
  process.exit(1);
}
report(`ALL EQUIVALENCE CHECKS PASSED (${totalChecks} bitwise checks)`);
