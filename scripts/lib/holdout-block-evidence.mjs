/**
 * F6 paired-block evidence classification (PS-P1 ship-clean).
 *
 * Empty arms / config-collector failure must not enter production-candidate.
 * Real task failures that still wrote invocation rows stay eligible.
 */

/**
 * @param {{
 *   executor: string,
 *   results: ReadonlyArray<{
 *     invocations: ReadonlyArray<unknown>,
 *     status: string,
 *     runId?: string
 *   }>
 * }} input
 * @returns {"simulation" | "harness-failure" | "production-candidate"}
 */
export function classifyHoldoutBlockEvidenceClass({ executor, results }) {
  if (executor !== "pi") return "simulation";
  const harnessOnly = results.every(
    (result) =>
      result.invocations.length === 0 &&
      (result.status === "UNKNOWN" || result.runId === undefined)
  );
  return harnessOnly ? "harness-failure" : "production-candidate";
}
