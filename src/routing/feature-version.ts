/**
 * Live assign feature version. Bump this string whenever the classifier,
 * sensors, or token estimators that feed routing change. R1 cells key on
 * featureVersion; mixing versions is forbidden.
 *
 * assign-v4 (2026-08-23): family is role-first for reviewer/tester/scout/
 * planner; review/refactor keywords outrank test for generic edit roles;
 * keyword "reasoning" escalates complexity instead of hard-filtering on an
 * undeclarable capability. Posteriors keyed on assign-v3 must not be reused.
 * Flowchart isolation is `flowchart-v4` (persisted AgentRole + high-risk gate).
 */
export const ASSIGN_FEATURE_VERSION = "assign-v4";

/**
 * Flowchart live path. Bump independently of assign-* when the live
 * flowchart decision (role resolution, human gate, analyzer) changes.
 *
 * flowchart-v4 (2026-08-23): persist AgentRole on compiled nodes so tester
 * / planner / scout do not collapse to implementer; high-risk analysis
 * arms the human gate (`WAITING_FOR_USER`) on the executed path.
 */
export const FLOWCHART_FEATURE_VERSION = "flowchart-v4";

export const FEATURE_VERSION_REASONS: readonly string[] = [
  "role-regex-classifier",
  "contract-risk-flag-overrides-keywords",
  "optional-token-and-sensor-slots",
  "capability-keywords-vision-reasoning",
  "privacy-required-from-objective",
  "flowchart-live-uses-analyzeTask",
  "role-outranks-keywords-for-family",
  "review-refactor-outrank-test",
  "reasoning-escalates-complexity-not-capability",
  "flowchart-persists-agent-role",
  "flowchart-high-risk-arms-human-gate"
];
