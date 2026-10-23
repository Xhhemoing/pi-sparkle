import { createBanditState, recordReward } from "../routing/bandit.js";
import { loadProjectBanditByKey, projectBanditPath, type BanditState } from "../../persist/bandit-state.js";
import { writeFileAtomic } from "../../persist/atomic-file.js";
import { withExclusiveFileLock } from "../../persist/file-lock.js";
import { stableProjectKey } from "../../persist/project-key.js";
import type { ObservedSignal } from "./signals.js";

export {
  BANDIT_STATE_UNREADABLE_CODE,
  BanditStateUnreadableError,
  loadProjectBanditByKey,
  projectBanditPath
} from "../../persist/bandit-state.js";

/**
 * Epsilon-greedy mean reward over models for one project. Adaptation-plane only;
 * live routing still reads the promoted routing-policy, not this file.
 * Rewards are taskSuccess PASS=1 / FAIL=0 only, and a FAIL counts only when
 * the failure is attributed to the model (failureClass === "model").
 * Contract, tool, environment, provider, and run failures never lower a posterior.
 *
 * The lock serializes writers; `writeFileAtomic` is what makes each publish whole, so a reader
 * that does not take the lock still sees either the previous state or this call's complete one.
 * A damaged file rejects with `BanditStateUnreadableError` from the read under the lock, before
 * anything is written: the unreadable bytes survive for repair instead of being overwritten.
 */
export async function updateProjectBandit(
  stateRoot: string,
  projectRoot: string,
  signals: readonly ObservedSignal[]
): Promise<BanditState> {
  const projectKey = stableProjectKey(projectRoot);
  const path = projectBanditPath(stateRoot, projectKey);
  return withExclusiveFileLock(`${path}.lock`, async () => {
    const previous = await loadProjectBanditByKey(stateRoot, projectKey);
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
    await writeFileAtomic(path, `${JSON.stringify(state, null, 2)}\n`);
    return state;
  });
}
