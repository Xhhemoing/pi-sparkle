import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import type { RunId } from "../domain/ids.js";
import { writeFileAtomic } from "../persist/atomic-file.js";
import { runtimeRoot } from "../privacy/state-layout.js";

export class CheckpointStore {
  private readonly checkpointPath: string;

  constructor(
    private readonly stateRoot: string,
    private readonly runId: RunId
  ) {
    this.checkpointPath = join(runtimeRoot(stateRoot), "runs", runId, "checkpoint.json");
  }

  /**
   * Publishes a checkpoint. Crash-atomic (`writeFileAtomic`), and — like
   * `EventStore.append`, and for the same measured reason — without taking the
   * run's cooperative lock (`runLockPath`).
   *
   * The flowchart loop persists a checkpoint after every scheduling step, so
   * this is a per-step writer: acquiring the lock here costs ~0.26 ms on top of
   * a ~0.42 ms write (+62%), which is +17.5% on an end-to-end fake-executor run
   * against a 5% bar. Measured on this VM, both arms in one process,
   * alternating order, medians of 9 reps.
   *
   * The consequence, and why it is survivable: `writeFileAtomic` creates the
   * directory it writes into, so a checkpoint landing inside a concurrent
   * `delete --run` puts the deleted subtree back. That makes the delete fail
   * closed (`RunRecordsSurvivedError`, verified under the lock and again after
   * it) rather than report a removal it cannot prove — 30/30 adversarial
   * attempts refused, 0 reported as success with records on disk. Taking the
   * lock here would instead make the delete *succeed* against a checkpointing
   * writer, which is convenience rather than privacy: a run that is still live
   * writes again moments later either way, and "stop the run, then delete" is
   * the remedy the error already names.
   */
  async write(checkpoint: unknown): Promise<void> {
    await writeFileAtomic(this.checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
  }

  /**
   * Reads without any lock: `writeFileAtomic` publishes by rename, so a reader
   * observes either the previous checkpoint or a whole new one.
   */
  async read(): Promise<unknown> {
    const raw = await readFile(this.checkpointPath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new DomainValidationError(`Invalid checkpoint ${this.checkpointPath}: ${reason}`);
    }
  }
}
