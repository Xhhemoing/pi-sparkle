import { validateRequirementContract } from "../domain/contract.js";
import { createTrustedSource, type RawSource } from "./normalizer.js";
import {
  buildContractCandidate,
  type ContractCandidate,
  type ContractCritic,
  type RequirementExtractor
} from "./extractor.js";
import { critiqueContract } from "./critic.js";

export const HEURISTIC_EXTRACTOR_ROLE = "heuristic-extractor-v1";
export const HEURISTIC_CRITIC_ROLE = "heuristic-critic-v1";

export interface HeuristicHabits {
  readonly requireTests?: boolean;
  readonly preferReview?: boolean;
  readonly askBeforeWrite?: boolean;
}

const SMALLEST_CHANGE: ConstraintLike = {
  id: "c-smallest",
  description: "Change only files required by the objective; no drive-by refactors",
  enforceable: false
};

const DEFAULT_NON_GOALS = [
  "Unrelated refactors",
  "Drive-by dependency upgrades",
  "Rewriting files not required by the objective"
];

interface ConstraintLike {
  readonly id: string;
  readonly description: string;
  readonly enforceable: boolean;
}

/**
 * Deterministic extractor: turns an objective plus optional habits into a
 * contract. Vague objectives emit questions instead of inventing scope.
 */
export function heuristicExtractor(habits: HeuristicHabits = {}): RequirementExtractor {
  return {
    roleId: HEURISTIC_EXTRACTOR_ROLE,
    async extract(input) {
      const objective = input.objective.trim();
      const vague = isVague(objective);
      const wantsTests = habits.requireTests === true || /\b(tests?|coverage|qa)\b/i.test(objective);
      const wantsReview = habits.preferReview !== false;
      const questions = vague
        ? [
            {
              id: "q-done",
              question: "What does done look like for this work?",
              options: ["ship a code change", "investigation only", "tests and a code change"]
            },
            {
              id: "q-tests",
              question: "Should the plan include running or adding tests?",
              options: ["yes", "no", "only if existing tests fail"]
            }
          ]
        : [];
      if (!vague && habits.requireTests === undefined && !/\b(tests?|coverage)\b/i.test(objective)) {
        questions.push({
          id: "q-tests",
          question: "Should the plan include running or adding tests?",
          options: ["yes", "no", "only if existing tests fail"]
        });
      }
      if (shouldAskScope(objective) && !questions.some((question) => question.id === "q-scope")) {
        questions.push({
          id: "q-scope",
          question: "Which files or modules should this change touch?",
          options: ["the files named in the objective", "let scout discover them", "I will paste paths"]
        });
      }
      if (habits.askBeforeWrite === true && !questions.some((question) => question.id === "q-write")) {
        questions.push({
          id: "q-write",
          question: "May the agent write files, or is this investigation only?",
          options: ["write files", "investigation only"]
        });
      }
      const targets = namedTargets(objective);
      const objectiveRefs = input.sources.map((source) => source.ref);
      const contract = validateRequirementContract({
        schemaVersion: 1,
        objective,
        deliverables: [
          {
            id: "d-change",
            description: vague ? "Change set matching the clarified objective" : `Deliver ${objective}`,
            artifactKind: "diff",
            sourceRefs: objectiveRefs
          },
          ...targets.map((path, index) => ({
            id: `d-file-${index + 1}`,
            description: path,
            artifactKind: "file",
            sourceRefs: objectiveRefs
          }))
        ],
        constraints: [
          { ...SMALLEST_CHANGE, assumptionIds: ["a-defaults"] },
          ...(wantsTests
            ? [{ id: "c-tests", description: "Tests must stay green", enforceable: true, sourceRefs: objectiveRefs }]
            : [])
        ],
        nonGoals: DEFAULT_NON_GOALS,
        acceptanceCriteria: [
          {
            id: "ac-objective",
            description: "The stated objective is addressed",
            observableCheck: "run.status is COMPLETED and child TASK_RESULT summaries cover the objective",
            sourceRefs: objectiveRefs
          },
          ...(wantsTests
            ? [
                {
                  id: "ac-tests",
                  description: "Tests ran",
                  observableCheck: "tester child TASK_RESULT verification is PASSED",
                  sourceRefs: objectiveRefs
                }
              ]
            : [])
        ],
        assumptions: [
          {
            id: "a-defaults",
            statement: "The smallest-change constraint is a heuristic default pending user confirmation",
            source: "heuristic-default"
          },
          ...(vague
            ? [{ id: "a-vague", statement: "Objective is underspecified until the user answers", source: "heuristic" }]
            : [])
        ],
        questions,
        authority: [],
        sourceRefs: objectiveRefs
      });
      const confidence = vague ? 0.55 : wantsReview ? 0.86 : 0.8;
      return {
        contract,
        confidence,
        inferences: [],
        authorityGrounding: []
      };
    }
  };
}

export function heuristicCritic(): ContractCritic {
  return {
    roleId: HEURISTIC_CRITIC_ROLE,
    async critique(input) {
      const critique = critiqueContract(input.contract);
      const omissions = [...critique.omissions];
      if (input.contract.questions.length > 0 && input.contract.acceptanceCriteria.length === 0) {
        omissions.push("acceptance-missing-while-questions-open");
      }
      return { ...critique, omissions };
    }
  };
}

export async function extractHeuristicContract(input: {
  readonly objective: string;
  readonly sources?: readonly RawSource[];
  readonly habits?: HeuristicHabits;
}): Promise<ContractCandidate> {
  const sources =
    input.sources !== undefined && input.sources.length > 0
      ? input.sources
      : [
          createTrustedSource({
            kind: "message",
            ref: "cli-objective",
            origin: "user-turn",
            content: input.objective
          })
        ];
  return buildContractCandidate({
    objective: input.objective,
    sources: [...sources],
    extractor: heuristicExtractor(input.habits ?? {}),
    critic: heuristicCritic(),
    minimumConfidence: 0.8
  });
}

export function isVague(objective: string): boolean {
  const text = objective.trim();
  if (text.length < 12) return true;
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length < 4) return true;
  return !/\b(implement|fix|add|refactor|test|review|migrate|integrate|document|investigate|plan|change|update|rename)\b/i.test(
    text
  );
}

const PATH_RE =
  /(?:[\w.-]+[\\/])+[\w.-]+(?:\.\w+)?|\b[\w-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|md|json)\b/gi;

export function namedTargets(objective: string): string[] {
  return objective.match(PATH_RE) ?? [];
}

/** Skip scout for tiny, local edits that already name the change kind. */
export function shouldScout(objective: string): boolean {
  if (/\b(typo|rename|comment|readme)\b/i.test(objective) && objective.length < 80) return false;
  return !/\b(one-line|trivial|tiny)\b/i.test(objective);
}

function shouldAskScope(objective: string): boolean {
  if (shouldScout(objective)) return false;
  if (namedTargets(objective).length > 0) return false;
  return /\b(implement|fix|add|rename|change|update|refactor)\b/i.test(objective);
}
