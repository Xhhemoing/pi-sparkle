import type { DecisionQuestion } from "../domain/contract.js";
import { getMaterializedView } from "../preferences/materialize.js";
import type { HeuristicHabits } from "../requirement/heuristic.js";
import { extractHeuristicContract } from "../requirement/heuristic.js";
import type { ContractCandidate } from "../requirement/extractor.js";

export interface ClarifyInput {
  readonly objective: string;
  readonly projectKey: string;
  readonly assumeDefaults?: boolean;
}

export interface ClarifyResult {
  readonly candidate: ContractCandidate;
  readonly habits: HeuristicHabits;
  readonly questions: readonly DecisionQuestion[];
  readonly waiting: boolean;
}

export function habitsFromPreferences(projectKey: string): HeuristicHabits {
  const project = getMaterializedView("project", projectKey);
  const user = getMaterializedView("user", "default");
  const keys = { ...(user?.effectiveKeys ?? {}), ...(project?.effectiveKeys ?? {}) };
  return {
    ...(typeof keys["require-tests"] === "boolean" ? { requireTests: keys["require-tests"] } : {}),
    ...(typeof keys["prefer-review"] === "boolean" ? { preferReview: keys["prefer-review"] } : {}),
    ...(typeof keys["ask-before-write"] === "boolean" ? { askBeforeWrite: keys["ask-before-write"] } : {})
  };
}

/**
 * Ask only when the answer changes the plan. Known habits skip the matching
 * question. `--assume-defaults` proceeds with remaining defaults.
 */
export async function clarifyObjective(input: ClarifyInput): Promise<ClarifyResult> {
  const habits = habitsFromPreferences(input.projectKey);
  const candidate = await extractHeuristicContract({
    objective: input.objective,
    habits
  });
  const questions = candidate.contract.questions.filter((question) => {
    if (question.id === "q-tests" && habits.requireTests !== undefined) return false;
    return true;
  });
  const waiting =
    input.assumeDefaults !== true && (candidate.requiresUserDecision || questions.length > 0);
  return { candidate, habits, questions, waiting };
}

export function applyAnswers(
  questions: readonly DecisionQuestion[],
  answers: Readonly<Record<string, string>>
): { readonly unanswered: readonly DecisionQuestion[]; readonly resolved: Readonly<Record<string, string>> } {
  const resolved: Record<string, string> = {};
  const unanswered: DecisionQuestion[] = [];
  for (const question of questions) {
    const answer = answers[question.id]?.trim();
    if (answer === undefined || answer === "") {
      unanswered.push(question);
      continue;
    }
    resolved[question.id] = answer;
  }
  return { unanswered, resolved };
}
