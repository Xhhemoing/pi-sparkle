import { rmSync } from "node:fs";
import type { RunId } from "../../src/domain/ids.js";
import { runLockPath } from "../../src/run/event-store.js";

/**
 * Finishes the process-death fiction after a test abandons a live run handle.
 *
 * A real SIGKILL leaves the lifecycle lock for the operator to remove. This
 * removal is also safe if the abandoned handle later releases: the lock
 * implementation only unlinks a sidecar whose owner token still matches its
 * own, so the old owner cannot remove a successor's lock.
 */
export function simulateProcessDeath(stateRoot: string, runId: RunId): void {
  rmSync(runLockPath(stateRoot, runId), { force: true });
}
