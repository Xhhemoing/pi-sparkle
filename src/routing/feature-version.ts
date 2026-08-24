/**
 * Live assign feature version. Bump this string whenever the classifier,
 * sensors, or token estimators that feed routing change. R1 cells key on
 * featureVersion; mixing versions is forbidden.
 *
 * assign-v5 (2026-08-24): vision is role-scoped to implementer / debugger /
 * worker; generic edit roles no longer inherit TEST_RE families. Posteriors
 * keyed on assign-v4 must not be reused.
 * Flowchart isolation is `flowchart-v5` (analysis complexity when AgentRole
 * is persisted).
 */
export const ASSIGN_FEATURE_VERSION = "assign-v5";

/**
 * Flowchart live path. Bump independently of assign-* when the live
 * flowchart decision (role resolution, human gate, analyzer) changes.
 *
 * flowchart-v5 (2026-08-24): when compile persisted `agentRole`, record
 * analyzeTask complexity instead of max(supervisor floor, analysis) so
 * scout / tester match assign-v5. Posteriors keyed on flowchart-v4 must
 * not be reused.
 */
export const FLOWCHART_FEATURE_VERSION = "flowchart-v5";

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
  "flowchart-high-risk-arms-human-gate",
  "role-scoped-vision-capability",
  "generic-edit-roles-skip-test-family",
  "flowchart-uses-analysis-complexity-when-agent-role-persisted"
];
