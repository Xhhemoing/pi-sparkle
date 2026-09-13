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
/** Provider/API/network faults — not the model's reasoning quality. */
const PROVIDER_HINT =
  /\b(ECONN(?:RESET|REFUSED)?|ETIMEDOUT|ENETUNREACH|EPIPE|ENOTFOUND|network|429|rate[- ]?limit(?:ed)?|too many requests|quota(?: exceeded)?|retry-after|socket hang up|upstream (?:overloaded|unavailable)|HTTP[/ ]?5\d\d|provider)\b/i;
/** Local sandbox / filesystem environment — distinct from upstream provider. */
const ENVIRONMENT_HINT =
  /\b(EACCES|EPERM|ENOENT|ENOSPC|permission denied|sandbox)\b/i;
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
    return "provider";
  }
  if (input.transportCode !== undefined && /^(ECONN|ENET|ETIMEDOUT|EPIPE|ENOTFOUND)/i.test(input.transportCode)) {
    return "provider";
  }

  const text = `${input.summary ?? ""} ${input.failure?.detail ?? ""}`.trim();
  if (CONTRACT_HINT.test(text)) return "contract";
  if (PROVIDER_HINT.test(text)) return "provider";
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
    case "PROVIDER_ERROR":
      return "provider";
    default:
      break;
  }

  if (input.verificationKind === "FAILED") return "model";
  return undefined;
}
