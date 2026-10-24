import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import { isRecord } from "../domain/record.js";
import { adaptationRoot } from "./state-layout.js";
import { BANDIT_STATE_UNREADABLE_CODE } from "./corruption-codes.js";

export interface BanditState {
  readonly arms: readonly string[];
  readonly pulls: Record<string, number>;
  readonly rewardSum: Record<string, number>;
  readonly explorationsUsed: number;
  /** Must always remain zero — high-risk tasks never explore. */
  readonly highRiskExplorations: number;
}

/**
 * Where a *stored* project key's bandit state lives. Callers that discovered a key by scanning
 * `adaptation/learning/projects` have no project root to hand back, so the layout is exported
 * here rather than reconstructed — and never inverted: `stableProjectKey` is one-way.
 */
export function projectBanditPath(stateRoot: string, projectKey: string): string {
  return join(adaptationRoot(stateRoot), "learning", "projects", projectKey, "bandit.json");
}

export { BANDIT_STATE_UNREADABLE_CODE } from "./corruption-codes.js";

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

/**
 * The same read, keyed by the stored project key instead of a project root, for callers that
 * enumerate `adaptation/learning/projects` and never see the roots those keys were hashed from.
 * `undefined` means the project has no bandit yet; damaged bytes throw
 * `BanditStateUnreadableError`, and nothing is written back either way.
 */
export async function loadProjectBanditByKey(
  stateRoot: string,
  projectKey: string
): Promise<BanditState | undefined> {
  return readBanditFile(projectBanditPath(stateRoot, projectKey));
}
