import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isRecord } from "../domain/record.js";
import { adaptationRoot } from "../privacy/state-layout.js";
import { createBanditState, recordReward, type BanditState } from "../routing/bandit.js";
import { withExclusiveFileLock } from "../persist/file-lock.js";
import { stableProjectKey } from "./learned-routing.js";
import type { ObservedSignal } from "./signals.js";

function banditPath(stateRoot: string, projectRoot: string): string {
  return join(adaptationRoot(stateRoot), "learning", "projects", stableProjectKey(projectRoot), "bandit.json");
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isBanditState(value: unknown): value is BanditState {
  if (
    !isRecord(value) ||
    !Array.isArray(value.arms) ||
    !isNonNegativeInteger(value.explorationsUsed) ||
    !isNonNegativeInteger(value.highRiskExplorations)
  ) {
    return false;
  }

  const arms = value.arms;
  const pulls = value.pulls;
  const rewardSum = value.rewardSum;
  if (!isRecord(pulls) || !isRecord(rewardSum)) return false;
  if (
    !arms.every((arm): arm is string => typeof arm === "string" && arm.trim() !== "") ||
    new Set(arms).size !== arms.length
  ) {
    return false;
  }
  const armSet = new Set(arms);
  if (
    Object.keys(pulls).some((arm) => !armSet.has(arm)) ||
    Object.keys(rewardSum).some((arm) => !armSet.has(arm))
  ) {
    return false;
  }
  return arms.every((arm) => {
    const armPulls = pulls[arm];
    const armRewardSum = rewardSum[arm];
    return (
      isNonNegativeInteger(armPulls) &&
      typeof armRewardSum === "number" &&
      Number.isFinite(armRewardSum) &&
      armRewardSum >= 0 &&
      armRewardSum <= armPulls
    );
  });
}

async function readBanditFile(path: string): Promise<BanditState | undefined> {
  const raw = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  if (raw === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isBanditState(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function loadProjectBandit(
  stateRoot: string,
  projectRoot: string
): Promise<BanditState | undefined> {
  return readBanditFile(banditPath(stateRoot, projectRoot));
}

/**
 * Epsilon-greedy mean reward over models for one project. Adaptation-plane only;
 * live routing still reads the promoted routing-policy, not this file.
 * Rewards are taskSuccess PASS=1 / FAIL=0 only.
 */
export async function updateProjectBandit(
  stateRoot: string,
  projectRoot: string,
  signals: readonly ObservedSignal[]
): Promise<BanditState> {
  const path = banditPath(stateRoot, projectRoot);
  return withExclusiveFileLock(`${path}.lock`, async () => {
    const previous = await readBanditFile(path);
    const arms = new Set(previous?.arms ?? []);
    for (const signal of signals) {
      if (signal.modelId !== undefined && signal.modelId.trim() !== "") {
        arms.add(signal.modelId);
      }
    }
    const armList = [...arms];
    let state = createBanditState(armList);
    if (previous !== undefined) {
      const pulls: Record<string, number> = {};
      const rewardSum: Record<string, number> = {};
      for (const arm of armList) {
        pulls[arm] = previous.pulls[arm] ?? 0;
        rewardSum[arm] = previous.rewardSum[arm] ?? 0;
      }
      state = {
        arms: armList,
        pulls,
        rewardSum,
        explorationsUsed: previous.explorationsUsed,
        highRiskExplorations: previous.highRiskExplorations
      };
    }
    for (const signal of signals) {
      if (signal.criterion !== "taskSuccess") continue;
      if (signal.source === "user" || signal.kind === "human" || signal.kind !== "deterministic") continue;
      if (signal.modelId === undefined || !state.arms.includes(signal.modelId)) continue;
      if (signal.outcomeKind === "PASS") {
        state = recordReward(state, signal.modelId, 1);
      } else if (signal.outcomeKind === "FAIL") {
        state = recordReward(state, signal.modelId, 0);
      }
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    return state;
  });
}
