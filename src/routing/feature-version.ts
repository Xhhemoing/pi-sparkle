/**
 * Live assign feature version. Bump this string whenever the classifier,
 * sensors, or token estimators that feed routing change. R1 cells key on
 * featureVersion; mixing versions is forbidden.
 */
export const ASSIGN_FEATURE_VERSION = "assign-v3";

/** Flowchart live path now runs analyzeTask (capability + privacy + risk). */
export const FLOWCHART_FEATURE_VERSION = "flowchart-v2";

export const FEATURE_VERSION_REASONS: readonly string[] = [
  "role-regex-classifier",
  "contract-risk-flag-overrides-keywords",
  "optional-token-and-sensor-slots",
  "capability-keywords-vision-reasoning",
  "privacy-required-from-objective",
  "flowchart-live-uses-analyzeTask"
];
