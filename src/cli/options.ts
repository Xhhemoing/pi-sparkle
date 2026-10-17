import { DomainValidationError } from "../domain/errors.js";
import type { FileLockOptions } from "../persist/file-lock.js";

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

/**
 * Upper bound on `--lock-wait-ms`, in milliseconds (24 hours).
 *
 * The flag exists to let an operator wait out a long run, so the ceiling is
 * deliberately far above any real one. What it buys is that a typo — an extra
 * digit on an otherwise reasonable value — is refused at parse time instead of
 * presenting as a CLI that hung.
 */
const MAX_LOCK_WAIT_MS = 86_400_000;

/**
 * `--lock-wait-ms` as `withExclusiveFileLock` options, shared by `delete` and
 * the two locked `pref` mutators.
 *
 * An absent flag yields an empty object rather than an explicit default, so an
 * unflagged command makes exactly the call it made before this flag existed:
 * the 5s bound stays the lock's own, in one place, and cannot drift here.
 *
 * Only whole non-negative decimal milliseconds are accepted. `Number` would
 * also take `1e4`, `0x10` and ` 5 `; a command that waits a different amount
 * of time than the operator typed is worse than one that refuses the spelling.
 */
export function lockWaitOptions(raw: string | undefined): FileLockOptions {
  if (raw === undefined) return {};
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value > MAX_LOCK_WAIT_MS) {
    throw new DomainValidationError(
      `--lock-wait-ms must be a whole number of milliseconds between 0 and ${MAX_LOCK_WAIT_MS}, got: ${raw}`
    );
  }
  return { timeoutMs: value };
}
