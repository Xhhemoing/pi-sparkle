import { chmod, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeRoot } from "../privacy/state-layout.js";
import type {
  AuthOperationOptions,
  Credential,
  CredentialInfo,
  CredentialStore
} from "@earendil-works/pi-ai";
import { DomainValidationError } from "../domain/errors.js";
import { isRecord } from "../domain/record.js";
import { writeFileAtomic } from "../persist/atomic-file.js";
import { withExclusiveFileLock } from "../persist/file-lock.js";

export function authStorePath(stateRoot: string): string {
  return join(runtimeRoot(stateRoot), "auth.json");
}

export const AUTH_STORE_UNREADABLE_CODE = "AUTH_STORE_UNREADABLE" as const;

/**
 * `auth.json` exists but cannot be read as a credential store.
 *
 * Every verb loads the store before it does anything — including `logout` —
 * so one damaged file takes the whole `auth` surface down, and refusing to
 * guess is the right posture: the alternative is reading a mangled document as
 * "no credentials yet" and silently falling back to whatever the environment
 * happens to hold.
 *
 * What the operator needs to know is that the way out is cheap. Unlike learned
 * state, nothing here is recomputed from a log and nothing else on disk
 * depends on it: the file holds credentials the operator can enter again, so
 * moving it aside costs one `auth login` per provider. pi-sparkle never
 * deletes it — a secret store is not something a CLI should remove on a parse
 * failure, and the file may still be readable by hand.
 *
 * Discriminate on `code`, never on the message.
 */
export class AuthStoreUnreadableError extends DomainValidationError {
  readonly code = AUTH_STORE_UNREADABLE_CODE;
  readonly path: string;

  constructor(path: string, detail: string) {
    super(
      `auth.json at ${path} is unreadable (${detail}); nothing was changed — ` +
        "it holds only credentials you can enter again, so it is safe to move aside " +
        "(pi-sparkle never deletes it), then re-run pi-sparkle auth login <provider>"
    );
    this.name = "AuthStoreUnreadableError";
    this.path = path;
  }
}

/**
 * The damaged-store failure behind an error, if it is one — including when a
 * dependency has wrapped it, as Pi does for a store read inside `checkAuth`.
 * Depth-bounded so a future wrapper cannot quietly drop the classification.
 */
export function asAuthStoreUnreadable(
  error: unknown
): { readonly message: string; readonly path: string } | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (current === null || typeof current !== "object") return undefined;
    const candidate = current as { code?: unknown; path?: unknown; message?: unknown; cause?: unknown };
    if (candidate.code === AUTH_STORE_UNREADABLE_CODE && typeof candidate.path === "string") {
      return {
        message: typeof candidate.message === "string" ? candidate.message : String(error),
        path: candidate.path
      };
    }
    current = candidate.cause;
  }
  return undefined;
}

/**
 * File-backed Pi CredentialStore. One credential per provider.
 * `list()` returns type metadata only — never secrets.
 */
export class FileCredentialStore implements CredentialStore {
  constructor(private readonly filePath: string) {}

  async read(providerId: string, _options?: AuthOperationOptions): Promise<Credential | undefined> {
    const all = await this.load();
    return all[providerId];
  }

  async list(_options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    const all = await this.load();
    return Object.entries(all).map(([providerId, credential]) => ({
      providerId,
      type: credential.type
    }));
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    _options?: AuthOperationOptions
  ): Promise<Credential | undefined> {
    return withExclusiveFileLock(`${this.filePath}.lock`, async () => {
      const all = await this.load();
      const next = await fn(all[providerId]);
      if (next === undefined) return all[providerId];
      all[providerId] = next;
      await this.save(all);
      return next;
    });
  }

  async delete(providerId: string, _options?: AuthOperationOptions): Promise<void> {
    await this.deleteExisting(providerId);
  }

  /**
   * `delete`, plus whether a credential was actually removed. Pi's
   * `CredentialStore.delete` returns nothing, so a caller that wants to report
   * a removal honestly ("no stored credential" rather than "removed") has no
   * way to tell the two apart; asking first would race the lock this takes.
   */
  async deleteExisting(providerId: string): Promise<boolean> {
    return withExclusiveFileLock(`${this.filePath}.lock`, async () => {
      const all = await this.load();
      if (all[providerId] === undefined) return false;
      delete all[providerId];
      await this.save(all);
      return true;
    });
  }

  private async load(): Promise<Record<string, Credential>> {
    const raw = await readFile(this.filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    if (raw === "") return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new AuthStoreUnreadableError(this.filePath, "not valid JSON");
    }
    if (!isRecord(parsed)) {
      throw new AuthStoreUnreadableError(this.filePath, "the document is not a JSON object");
    }
    const out: Record<string, Credential> = {};
    for (const [providerId, value] of Object.entries(parsed)) {
      const credential = parseCredential(this.filePath, value, providerId);
      if (credential !== undefined) out[providerId] = credential;
    }
    return out;
  }

  private async save(all: Record<string, Credential>): Promise<void> {
    const serialized = `${JSON.stringify(all, null, 2)}\n`;
    await writeFileAtomic(this.filePath, serialized);
    await chmod(this.filePath, 0o600).catch(() => undefined);
  }
}

function parseCredential(path: string, value: unknown, providerId: string): Credential | undefined {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new AuthStoreUnreadableError(path, `the ${providerId} entry is not a credential`);
  }
  if (value.type === "api_key") {
    const env =
      isRecord(value.env) && Object.values(value.env).every((item) => typeof item === "string")
        ? (value.env as Record<string, string>)
        : undefined;
    return {
      type: "api_key",
      ...(typeof value.key === "string" ? { key: value.key } : {}),
      ...(env !== undefined ? { env } : {})
    };
  }
  if (value.type === "oauth") {
    if (typeof value.refresh !== "string" || typeof value.access !== "string" || typeof value.expires !== "number") {
      throw new AuthStoreUnreadableError(path, `the ${providerId} oauth credential is incomplete`);
    }
    return { ...(value as Record<string, unknown>), type: "oauth", refresh: value.refresh, access: value.access, expires: value.expires } as Credential;
  }
  throw new AuthStoreUnreadableError(path, `the ${providerId} entry has an unknown credential type`);
}

/**
 * A credential store that holds nothing and refuses to hold anything.
 *
 * Pi resolves a stored credential before it looks at the environment, which is
 * the behaviour the default login path wants. `auth login --from-env` needs
 * the other question — does the *environment* configure this provider — and
 * asking Pi that means handing it a runtime whose store is empty, rather than
 * re-deriving each provider's environment variables here and drifting from the
 * pin. Writes throw instead of being dropped: the only caller is a check that
 * must not touch auth.json, so a write would be a bug, not a no-op.
 */
export class EmptyCredentialStore implements CredentialStore {
  async read(_providerId: string, _options?: AuthOperationOptions): Promise<Credential | undefined> {
    return undefined;
  }

  async list(_options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    return [];
  }

  async modify(
    providerId: string,
    _fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    _options?: AuthOperationOptions
  ): Promise<Credential | undefined> {
    throw new DomainValidationError(
      `refusing to write a ${providerId} credential: this credential store is read-only`
    );
  }

  async delete(providerId: string, _options?: AuthOperationOptions): Promise<void> {
    throw new DomainValidationError(
      `refusing to delete a ${providerId} credential: this credential store is read-only`
    );
  }
}
