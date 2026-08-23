import type { AttributionReport, OfflineRow } from "../routing/offline-types.js";
import { fitLogitAdditive } from "../routing/offline-logit.js";
import { fitProbabilityAdditive } from "../routing/offline-prob-add.js";

/**
 * Phase C Task 4: run both offline estimators on the same rows and return
 * the pair. The optional sink exists ONLY to prove the reports never write
 * the active pointer — `writeAttributionPair` must not call it.
 */
export function writeAttributionPair(
  rows: readonly OfflineRow[],
  sink?: { writeActivePointer?: (id: string) => void }
): { readonly logit: AttributionReport; readonly probAdd: AttributionReport } {
  // Deliberately no sink.writeActivePointer call: attribution is evidence,
  // not promotion. The pointer moves only via `adapt promote --approve`.
  void sink;
  return {
    logit: fitLogitAdditive(rows),
    probAdd: fitProbabilityAdditive(rows)
  };
}
