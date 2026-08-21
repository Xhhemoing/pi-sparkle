import type { FailureClass } from "./outcomes.js";

export interface ClassifyTaskFailureInput {
  readonly outcome?: string | undefined;
  readonly verificationKind?: string | undefined;
  readonly failure?: { readonly category: string; readonly detail?: string | undefined } | undefined;
  readonly summary?: string | undefined;
  readonly timedOut?: boolean | undefined;
  readonly protocolViolation?: boolean | undefined;
}

const CONTRACT_HINT =
  /\b(acceptance|criterion|criteria|contract|unspecified|not specified|planning omission|missing requirement|scope leak)\b/i;
const ENVIRONMENT_HINT =
  /\b(EACCES|EPERM|ENOENT|ENOSPC|ECONN|permission denied|sandbox|network)\b/i;
const TOOL_HINT = /\b(tool error|tool crashed|command failed|spawn)\b/i;

/**
 * Attribute a task failure so R1/cascade only punish the model when the
 * failure is actually the model's. Unknown non-model classes stay out of R1.
 */
export function classifyTaskFailure(input: ClassifyTaskFailureInput): FailureClass | undefined {
  if (input.timedOut === true || input.protocolViolation === true) return "run";
  if (input.verificationKind === "PASSED" || input.outcome === "SUCCESS") return undefined;

  switch (input.failure?.category) {
    case "MODEL_ERROR":
      return "model";
    case "TOOL_ERROR":
      return "tool";
    case "TIMEOUT":
      return "run";
    case "VALIDATION":
      return "contract";
    default:
      break;
  }

  const text = `${input.summary ?? ""} ${input.failure?.detail ?? ""}`.trim();
  if (CONTRACT_HINT.test(text)) return "contract";
  if (ENVIRONMENT_HINT.test(text)) return "environment";
  if (TOOL_HINT.test(text)) return "tool";

  if (input.verificationKind === "FAILED") return "model";
  return undefined;
}
