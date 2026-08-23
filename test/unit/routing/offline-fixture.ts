import type { OfflineRow } from "../../../src/routing/offline-types.js";

/**
 * Phase C Task 3 shared fixture: a separable scenario where "strong" always
 * passes and "weak" always fails, across three projects. Imported by the
 * logit and attribution-report tests (Tasks 3–4).
 */
export const OFFLINE_FIXTURE_ROWS: OfflineRow[] = [
  { scenarioId: "s|r", modelVersion: "weak", projectId: "prj_0", y: 0, occurredAtMs: 1 },
  { scenarioId: "s|r", modelVersion: "weak", projectId: "prj_1", y: 0, occurredAtMs: 2 },
  { scenarioId: "s|r", modelVersion: "weak", projectId: "prj_2", y: 0, occurredAtMs: 3 },
  { scenarioId: "s|r", modelVersion: "strong", projectId: "prj_0", y: 1, occurredAtMs: 4 },
  { scenarioId: "s|r", modelVersion: "strong", projectId: "prj_1", y: 1, occurredAtMs: 5 },
  { scenarioId: "s|r", modelVersion: "strong", projectId: "prj_2", y: 1, occurredAtMs: 6 }
];
