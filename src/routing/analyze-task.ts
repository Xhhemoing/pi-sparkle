import type { AgentRole } from "../domain/roles.js";
import type { TaskComplexity } from "../domain/flowchart.js";
import type { TaskFamily } from "../task/taxonomy.js";
import type { PrivacyClass } from "./capability-registry.js";

export interface TaskAnalysis {
  readonly family: TaskFamily;
  readonly complexity: TaskComplexity;
  readonly highRisk: boolean;
  readonly requiredCapabilities: readonly string[];
  readonly preferPrimary: boolean;
  readonly reason: string;
  readonly privacyRequired: PrivacyClass;
  readonly contextTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
  readonly hasTests?: boolean | undefined;
  readonly ownershipRestricted?: boolean | undefined;
}

export interface AnalyzeTaskOptions {
  /** When set, overrides keyword risk. */
  readonly contractRisk?: boolean | undefined;
  readonly contextTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
  readonly requiredCapabilities?: readonly string[] | undefined;
  readonly hasTests?: boolean | undefined;
  readonly ownershipRestricted?: boolean | undefined;
  readonly privacyRequired?: PrivacyClass | undefined;
}

const HIGH_RISK_RE =
  /\b(deploy(?:ing|ment|s)?|production|prod|credentials?|secrets?|privileged?|rm\s+-[a-z]*|drop\s+(table|database)|privilege\s+escalat\w*)\b/i;
const REVIEW_RE = /\b(review|audit|critique|nits?)\b/i;
const TEST_RE = /\b(tests?|spec|coverage|qa|verify|validation)\b/i;
const PLAN_RE = /\b(plan|decompos|roadmap|break down|design)\b/i;
const RESEARCH_RE = /\b(survey|research|investigat|scout|explor|compar)\b/i;
const REFACTOR_RE = /\b(refactor|cleanup|rename|extract)\b/i;
const IMPLEMENT_RE = /\b(implement|add |fix |integrate|migrate|write |build )\b/i;
const VISION_RE =
  /\b(screenshots?|ui mockups?|截图|图片|(?:png|jpe?g|gif|webp)(?:\s+files?)?|image files?|attached images?|look at (?:this |the )?(?:image|screenshot))\b/i;
const REASONING_RE =
  /\b(prove|proof|formal (?:verif|reason)|multi-step reason|theorem|invariants?)\b/i;
const LOCAL_ONLY_RE =
  /\b(on[- ]prem|air[- ]gapped|local[- ]only|must stay local|do not (?:send|upload) to (?:the )?cloud)\b/i;

const ROLE_FAMILY: Record<AgentRole, TaskFamily> = {
  worker: "edit",
  scout: "research",
  planner: "plan",
  implementer: "edit",
  reviewer: "review",
  tester: "test",
  debugger: "edit"
};

/**
 * Deterministic task analysis used by live R0-equivalent assignment.
 * Role is the strongest signal; a contract risk flag overrides keywords.
 */
export function analyzeTask(objective: string, role: AgentRole, options: AnalyzeTaskOptions = {}): TaskAnalysis {
  const text = objective.trim();
  const family = familyOf(text, role);
  const highRisk = options.contractRisk !== undefined ? options.contractRisk : HIGH_RISK_RE.test(text);
  const long = text.length >= 180 || (text.match(/\n/g) ?? []).length >= 3;
  const complexity = complexityOf({ role, family, highRisk, long });
  const preferPrimary =
    highRisk ||
    complexity === "HIGH" ||
    role === "planner" ||
    role === "debugger" ||
    family === "deploy";
  const requiredCapabilities = options.requiredCapabilities ?? capabilitiesOf(text);
  const privacyRequired =
    options.privacyRequired ??
    (options.ownershipRestricted === true || LOCAL_ONLY_RE.test(text) ? "local" : "cloud-general");
  const reason = [
    `role ${role}`,
    `family ${family}`,
    `${complexity} complexity`,
    highRisk ? "high-risk" : "standard-risk",
    `privacy ${privacyRequired}`,
    preferPrimary ? "prefer primary model" : "prefer cheapest eligible"
  ].join("; ");
  return {
    family,
    complexity,
    highRisk,
    requiredCapabilities,
    preferPrimary,
    privacyRequired,
    reason,
    ...(options.contextTokens !== undefined ? { contextTokens: options.contextTokens } : {}),
    ...(options.outputTokens !== undefined ? { outputTokens: options.outputTokens } : {}),
    ...(options.hasTests !== undefined ? { hasTests: options.hasTests } : {}),
    ...(options.ownershipRestricted !== undefined ? { ownershipRestricted: options.ownershipRestricted } : {})
  };
}

function capabilitiesOf(text: string): readonly string[] {
  const capabilities = ["tool-use"];
  if (VISION_RE.test(text)) capabilities.push("vision");
  if (REASONING_RE.test(text)) capabilities.push("reasoning");
  return capabilities;
}

function familyOf(text: string, role: AgentRole): TaskFamily {
  if (HIGH_RISK_RE.test(text) && /\b(deploy|production|prod\b)\b/i.test(text)) return "deploy";
  if (PLAN_RE.test(text) || role === "planner") return "plan";
  if (RESEARCH_RE.test(text) || role === "scout") return "research";
  if (TEST_RE.test(text) || role === "tester") return "test";
  if (REVIEW_RE.test(text) || role === "reviewer") return "review";
  if (REFACTOR_RE.test(text)) return "refactor";
  if (IMPLEMENT_RE.test(text) || role === "implementer" || role === "worker") return "edit";
  return ROLE_FAMILY[role] ?? "unknown";
}

function complexityOf(input: {
  readonly role: AgentRole;
  readonly family: TaskFamily;
  readonly highRisk: boolean;
  readonly long: boolean;
}): TaskComplexity {
  if (input.highRisk || input.family === "deploy") return "HIGH";
  if (input.long) return "MEDIUM";
  if (input.role === "scout" || input.role === "tester") return "LOW";
  if (input.role === "planner" || input.role === "debugger" || input.role === "reviewer") return "MEDIUM";
  if (input.family === "plan" || input.family === "research") return "MEDIUM";
  return "MEDIUM";
}
