import type { FailureClass } from "./outcomes.js";

export interface ClassifyTaskFailureInput {
  readonly outcome?: string | undefined;
  readonly verificationKind?: string | undefined;
  readonly failure?: { readonly category: string; readonly detail?: string | undefined } | undefined;
  readonly summary?: string | undefined;
  readonly timedOut?: boolean | undefined;
  readonly protocolViolation?: boolean | undefined;
  /** HTTP status observed by the runtime, not by the model. */
  readonly httpStatus?: number | undefined;
  /** Node/transport errno observed by the runtime (ECONNRESET, …). */
  readonly transportCode?: string | undefined;
}

const CONTRACT_HINT =
  /\b(acceptance|criterion|criteria|contract|unspecified|not specified|planning omission|missing requirement|scope leak)\b/i;
const ENVIRONMENT_HINT =
  /\b(EACCES|EPERM|ENOENT|ENOSPC|ECONN(?:RESET|REFUSED)?|ETIMEDOUT|ENETUNREACH|EPIPE|permission denied|sandbox|network|429|rate[- ]?limit(?:ed)?|too many requests|quota(?: exceeded)?|retry-after|socket hang up|upstream (?:overloaded|unavailable)|HTTP[/ ]?5\d\d)\b/i;
const TOOL_HINT = /\b(tool error|tool crashed|command failed|spawn)\b/i;

/**
 * Attribute a task failure so R1/cascade only punish the model when the
 * failure is actually the model's. Runtime-observed transport/timeout
 * evidence outranks agent-authored `failure.category`. Unknown non-model
 * classes stay out of R1.
 */
export function classifyTaskFailure(input: ClassifyTaskFailureInput): FailureClass | undefined {
  if (input.timedOut === true || input.protocolViolation === true) return "run";
  if (input.verificationKind === "PASSED" || input.outcome === "SUCCESS") return undefined;

  if (input.httpStatus === 429 || (input.httpStatus !== undefined && input.httpStatus >= 500)) {
    return "environment";
  }
  if (input.transportCode !== undefined && /^(ECONN|ENET|ETIMEDOUT|EPIPE|ENOTFOUND)/i.test(input.transportCode)) {
    return "environment";
  }

  const text = `${input.summary ?? ""} ${input.failure?.detail ?? ""}`.trim();
  if (CONTRACT_HINT.test(text)) return "contract";
  if (ENVIRONMENT_HINT.test(text)) return "environment";
  if (TOOL_HINT.test(text)) return "tool";

  switch (input.failure?.category) {
    case "TOOL_ERROR":
      return "tool";
    case "TIMEOUT":
      return "run";
    case "VALIDATION":
      return "contract";
    case "MODEL_ERROR":
      return "model";
    default:
      break;
  }

  if (input.verificationKind === "FAILED") return "model";
  return undefined;
}
