import type { TaskId } from "../domain/ids.js";
import type { IsoTimestamp } from "../domain/timestamp.js";

export interface ModelInvocation {
  readonly id: string;
  readonly taskId: TaskId;
  readonly model: string;
  readonly provider: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly latencyMs: number;
  readonly occurredAt: IsoTimestamp;
}

export function recordInvocation(inv: ModelInvocation): ModelInvocation {
  return inv;
}
