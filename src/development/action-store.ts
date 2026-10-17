import { lstat, mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalizeStableJson, parseStableJsonBytes } from "../domain/canonical-json.js";
import { DomainValidationError } from "../domain/errors.js";
import { writeFileAtomic } from "../persist/atomic-file.js";
import { withExclusiveFileLock, type FileLockOptions } from "../persist/file-lock.js";

const MAX_STORE_BYTES = 8 * 1024 * 1024;

/** Local cooperative store; no effect runs while this short metadata lock is held. */
export class ActionStore<T> {
  private readonly directory: string;
  private readonly path: string;
  private readonly lockPath: string;

  constructor(
    directory: string,
    private readonly validate: (value: unknown) => T,
    private readonly empty: () => T,
    private readonly lockOptions: FileLockOptions = {}
  ) {
    if (typeof directory !== "string" || directory.trim() === "") {
      throw new DomainValidationError("action store directory must be nonempty");
    }
    this.directory = resolve(directory);
    this.path = join(this.directory, "actions.json");
    this.lockPath = join(this.directory, "actions.lock");
  }

  async read(): Promise<T> {
    return this.locked(() => this.load());
  }

  async update<R>(change: (state: T) => { state: T; result: R; changed: boolean }): Promise<R> {
    return this.locked(async () => {
      const update = change(await this.load());
      if (update.changed) {
        const validated = this.validate(update.state);
        const bytes = canonicalizeStableJson(validated);
        if (Buffer.byteLength(bytes) > MAX_STORE_BYTES) {
          throw new DomainValidationError("action store exceeds 8 MiB; archive completed actions explicitly");
        }
        // Returning only after atomic publication makes claim/complete failures
        // observable. Callers must never invoke an effect after a rejected claim.
        await writeFileAtomic(this.path, bytes, { mode: 0o600 });
      }
      return update.result;
    });
  }

  private async locked<R>(operation: () => Promise<R>): Promise<R> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const root = await lstat(this.directory);
    if (!root.isDirectory() || root.isSymbolicLink()) {
      throw new DomainValidationError("action store must be a real directory, not a symlink");
    }
    return withExclusiveFileLock(this.lockPath, operation, this.lockOptions);
  }

  private async load(): Promise<T> {
    let metadata;
    try { metadata = await lstat(this.path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // Atomic replacement on some hosts uses an aside file. A missing primary
      // beside interrupted publication artifacts is ambiguous, never an empty ledger.
      const entries = await readdir(this.directory);
      if (entries.some((entry) => entry.startsWith("actions.json."))) {
        throw new DomainValidationError("action store missing beside publication remnants; host reconciliation required");
      }
      return this.empty();
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new DomainValidationError("action store snapshot must be a regular file, not a symlink");
    }
    if (metadata.size > MAX_STORE_BYTES) throw new DomainValidationError("action store exceeds 8 MiB");
    const bytes = await readFile(this.path);
    if (bytes.length > MAX_STORE_BYTES) throw new DomainValidationError("action store exceeds 8 MiB");
    try { return this.validate(parseStableJsonBytes(bytes)); }
    catch (error) {
      throw new DomainValidationError(`invalid action store: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
