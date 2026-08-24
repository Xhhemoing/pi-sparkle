import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import { isRecord } from "../domain/record.js";
import { adaptationRoot } from "../privacy/state-layout.js";
import { createBanditState, recordReward, type BanditState } from "../routing/bandit.js";
import { writeFileAtomic } from "../persist/atomic-file.js";
import { withExclusiveFileLock } from "../persist/file-lock.js";
import { stableProjectKey } from "./learned-routing.js";
import type { ObservedSignal } from "./signals.js";

function banditPath(stateRoot: string, projectRoot: string): string {
  return join(adaptationRoot(stateRoot), "learning", "projects", stableProjectKey(projectRoot), "bandit.json");
}

export const BANDIT_STATE_UNREADABLE_CODE = "BANDIT_STATE_UNREADABLE" as const;

/**
 * `bandit.json` exists but cannot be read as this project's bandit state.
 *
 * Pulls and rewards are *learned*: no log replays them and no aggregation rebuilds them, so
 * unlike the observed catalog — derived, and rebuildable from `invocations.jsonl` — a damaged
 * bandit file has no second copy. It therefore fails closed rather than reading as "no bandit
 * yet", which was the old posture: any parse or shape failure became `undefined`, and the next
 * `updateProjectBandit` published a fresh state over the damaged bytes, destroying the history
 * for good.
 *
 * Damage and version skew are different failures, and both halves are pinned in the unit tests:
 *
 *   - **Damage — this error.** Bytes no version of this writer has produced: unparseable JSON,
 *     an empty file, a non-object envelope, missing or ill-typed counters, a counter naming an
 *     arm absent from `arms`, a `rewardSum` above its own pull count. The file is left exactly
 *     as found and nothing is written back, so repairing it stays an operator decision.
 *   - **Version skew — tolerated.** A document whose bandit core reads cleanly but that carries
 *     additional keys this version does not know. The core loads and updates normally; the
 *     unknown keys are dropped at the read boundary and are absent from the next publish.
 *     Refusing them would leave an older binary unable to run at all against a newer file, and
 *     the counters — the only thing this plane learns — are intact.
 *
 * The file is published through `writeFileAtomic`, so a crash mid-write can no longer splice a
 * document together; what remains is external damage (a truncated restore, a hand edit, a disk
 * fault) or a file left behind by the pre-atomic writer. Discriminate on `code`, never on the
 * message.
 */
export class BanditStateUnreadableError extends DomainValidationError {
  readonly code = BANDIT_STATE_UNREADABLE_CODE;
  readonly path: string;

  constructor(path: string, detail: string, cause?: unknown) {
    super(
      `bandit state at ${path} is unreadable (${detail}); ` +
        "learned pulls and rewards cannot be recomputed from any log, so nothing was written " +
        "back — repair the file or move it aside to relearn this project from zero"
    );
    this.name = "BanditStateUnreadableError";
    this.path = path;
    if (cause !== undefined) this.cause = cause;
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

type BanditDocument =
  | { readonly ok: true; readonly state: BanditState }
  | { readonly ok: false; readonly defect: string };

/**
 * The same structural gate the old `isBanditState` applied, reporting *why* it refused so the
 * caller can name the damage. The returned state is rebuilt from the validated fields only:
 * that is where unknown keys from a newer writer are dropped (documented skew, not damage).
 */
function readBanditDocument(value: unknown): BanditDocument {
  if (!isRecord(value)) return { ok: false, defect: "top level is not a JSON object" };
  const arms: unknown = value.arms;
  const pulls: unknown = value.pulls;
  const rewardSum: unknown = value.rewardSum;
  const explorationsUsed: unknown = value.explorationsUsed;
  const highRiskExplorations: unknown = value.highRiskExplorations;

  if (!Array.isArray(arms)) return { ok: false, defect: "arms is not an array" };
  if (!arms.every((arm): arm is string => typeof arm === "string" && arm.trim() !== "")) {
    return { ok: false, defect: "arms holds an entry that is not a non-empty arm id" };
  }
  if (new Set(arms).size !== arms.length) return { ok: false, defect: "arms holds duplicate ids" };
  if (!isNonNegativeInteger(explorationsUsed)) {
    return { ok: false, defect: "explorationsUsed is not a non-negative integer" };
  }
  if (!isNonNegativeInteger(highRiskExplorations)) {
    return { ok: false, defect: "highRiskExplorations is not a non-negative integer" };
  }
  if (!isRecord(pulls)) return { ok: false, defect: "pulls is not a JSON object" };
  if (!isRecord(rewardSum)) return { ok: false, defect: "rewardSum is not a JSON object" };

  const armSet = new Set<string>(arms);
  const orphan = [...Object.keys(pulls), ...Object.keys(rewardSum)].find((arm) => !armSet.has(arm));
  if (orphan !== undefined) {
    return { ok: false, defect: `a counter names ${orphan}, which is not in arms` };
  }

  const checkedPulls: Record<string, number> = {};
  const checkedRewardSum: Record<string, number> = {};
  for (const arm of arms) {
    const armPulls = pulls[arm];
    const armRewardSum = rewardSum[arm];
    if (!isNonNegativeInteger(armPulls)) {
      return { ok: false, defect: `pulls.${arm} is not a non-negative integer` };
    }
    if (typeof armRewardSum !== "number" || !Number.isFinite(armRewardSum) || armRewardSum < 0) {
      return { ok: false, defect: `rewardSum.${arm} is not a finite non-negative number` };
    }
    if (armRewardSum > armPulls) {
      return { ok: false, defect: `rewardSum.${arm} exceeds its pull count` };
    }
    checkedPulls[arm] = armPulls;
    checkedRewardSum[arm] = armRewardSum;
  }

  return {
    ok: true,
    state: {
      arms: [...arms],
      pulls: checkedPulls,
      rewardSum: checkedRewardSum,
      explorationsUsed,
      highRiskExplorations
    }
  };
}

/**
 * `undefined` means this project has never had a bandit written: ENOENT is the one silent path,
 * and it is the only one. Anything else on disk that will not read throws
 * `BanditStateUnreadableError` — see the class for why torn is not absent here.
 */
async function readBanditFile(path: string): Promise<BanditState | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (raw.trim() === "") throw new BanditStateUnreadableError(path, "the file is empty");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new BanditStateUnreadableError(path, "not valid JSON", error);
  }
  const document = readBanditDocument(parsed);
  if (!document.ok) throw new BanditStateUnreadableError(path, document.defect);
  return document.state;
}

/** Throws `BanditStateUnreadableError` on damaged bytes; a project with no bandit yet is `undefined`. */
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
    await writeFileAtomic(path, `${JSON.stringify(state, null, 2)}\n`);
    return state;
  });
}
