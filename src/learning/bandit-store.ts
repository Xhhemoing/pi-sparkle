import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { adaptationRoot } from "../privacy/state-layout.js";
import { createBanditState, recordReward, type BanditState } from "../routing/bandit.js";
import { withExclusiveFileLock } from "../persist/file-lock.js";
import { stableProjectKey } from "./learned-routing.js";
import type { ObservedSignal } from "./signals.js";

function banditPath(stateRoot: string, projectRoot: string): string {
  return join(adaptationRoot(stateRoot), "learning", "projects", stableProjectKey(projectRoot), "bandit.json");
}

async function readBanditFile(path: string): Promise<BanditState | undefined> {
  const raw = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  if (raw === "") return undefined;
  try {
    return JSON.parse(raw) as BanditState;
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
 * Rewards are taskSuccess PASS=1 / FAIL=0 only, and a FAIL counts only when
 * the failure is attributed to the model (failureClass === "model").
 * Contract, tool, environment, and run failures never lower a posterior.
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
      } else if (signal.outcomeKind === "FAIL" && signal.failureClass === "model") {
        state = recordReward(state, signal.modelId, 0);
      }
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    return state;
  });
}
