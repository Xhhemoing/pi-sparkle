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
  const deepReasoning = REASONING_RE.test(text);
  const complexity = complexityOf({ role, family, highRisk, long, deepReasoning });
  const preferPrimary =
    highRisk ||
    complexity === "HIGH" ||
    role === "planner" ||
    role === "debugger" ||
    family === "deploy";
  const requiredCapabilities = options.requiredCapabilities ?? capabilitiesOf(text, role);
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

/**
 * Roles that actually consume visual artifacts. A shared run objective that
 * mentions a screenshot must not escalate planner / scout / reviewer / tester
 * onto a vision-capable (usually premium) model.
 */
const VISION_ROLES: ReadonlySet<AgentRole> = new Set(["implementer", "debugger", "worker"]);

/**
 * Only physical capability boundaries become hard requirements. `vision` is
 * one: a text-only model cannot read a screenshot, so refusing is correct.
 * Keyword-flagged "reasoning" is a quality gradient, not an incapability —
 * it escalates complexity (and therefore the model tier) instead of hard-
 * filtering the catalog. Contract-supplied capabilities still pass through
 * untouched via AnalyzeTaskOptions.requiredCapabilities.
 */
function capabilitiesOf(text: string, role: AgentRole): readonly string[] {
  const capabilities = ["tool-use"];
  if (VISION_ROLES.has(role) && VISION_RE.test(text)) capabilities.push("vision");
  return capabilities;
}

/**
 * Family is the R1 data-isolation key. Role outranks keywords for roles with
 * an intrinsic family, so a shared run objective cannot relabel the reviewer
 * or tester (all children usually see the same objective text). Generic edit
 * roles specialize by text; review/refactor still outrank test so "refactor X
 * and add a unit test" counts as refactor work. TEST_RE does not relabel
 * implementer / debugger / worker — a shared "verify / QA coverage" objective
 * must not contaminate the edit posterior. This mapping agrees with the
 * learning plane's familyFromRole fallback.
 */
function familyOf(text: string, role: AgentRole): TaskFamily {
  if (HIGH_RISK_RE.test(text) && /\b(deploy|production|prod\b)\b/i.test(text)) return "deploy";
  if (role === "planner") return "plan";
  if (role === "scout") return "research";
  if (role === "tester") return "test";
  if (role === "reviewer") return "review";
  if (PLAN_RE.test(text)) return "plan";
  if (RESEARCH_RE.test(text)) return "research";
  if (REVIEW_RE.test(text)) return "review";
  if (REFACTOR_RE.test(text)) return "refactor";
  const genericEdit = role === "implementer" || role === "debugger" || role === "worker";
  if (!genericEdit && TEST_RE.test(text)) return "test";
  if (IMPLEMENT_RE.test(text)) return "edit";
  return ROLE_FAMILY[role] ?? "unknown";
}

function complexityOf(input: {
  readonly role: AgentRole;
  readonly family: TaskFamily;
  readonly highRisk: boolean;
  readonly long: boolean;
  readonly deepReasoning: boolean;
}): TaskComplexity {
  if (input.highRisk || input.family === "deploy") return "HIGH";
  if (input.deepReasoning) return "HIGH";
  if (input.long) return "MEDIUM";
  if (input.role === "scout" || input.role === "tester") return "LOW";
  if (input.role === "planner" || input.role === "debugger" || input.role === "reviewer") return "MEDIUM";
  if (input.family === "plan" || input.family === "research") return "MEDIUM";
  return "MEDIUM";
}
