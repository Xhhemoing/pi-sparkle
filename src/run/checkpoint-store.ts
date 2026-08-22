import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runtimeRoot } from "../privacy/state-layout.js";
import type { RunId } from "../domain/ids.js";

export class CheckpointStore {
  private readonly checkpointPath: string;

  constructor(
    private readonly stateRoot: string,
    private readonly runId: RunId
  ) {
    this.checkpointPath = join(runtimeRoot(stateRoot), "runs", runId, "checkpoint.json");
  }

  async write(checkpoint: unknown): Promise<void> {
    const serialized = `${JSON.stringify(checkpoint, null, 2)}\n`;
    await mkdir(dirname(this.checkpointPath), { recursive: true });
    const tempPath = `${this.checkpointPath}.tmp`;
    const handle = await open(tempPath, "w");
    try {
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, this.checkpointPath);
  }

  async read(): Promise<unknown> {
    const raw = await readFile(this.checkpointPath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    return raw === undefined ? undefined : JSON.parse(raw);
  }
}
