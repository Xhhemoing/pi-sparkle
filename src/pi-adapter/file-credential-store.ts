import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AuthOperationOptions,
  Credential,
  CredentialInfo,
  CredentialStore
} from "@earendil-works/pi-ai";
import { DomainValidationError } from "../domain/errors.js";
import { isRecord } from "../domain/record.js";
import { withExclusiveFileLock } from "../persist/file-lock.js";

export function authStorePath(stateRoot: string): string {
  return join(stateRoot, "auth.json");
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
    await withExclusiveFileLock(`${this.filePath}.lock`, async () => {
      const all = await this.load();
      if (all[providerId] === undefined) return;
      delete all[providerId];
      await this.save(all);
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
      throw new DomainValidationError(`invalid auth.json at ${this.filePath}`);
    }
    if (!isRecord(parsed)) {
      throw new DomainValidationError(`auth.json must be an object at ${this.filePath}`);
    }
    const out: Record<string, Credential> = {};
    for (const [providerId, value] of Object.entries(parsed)) {
      const credential = parseCredential(value, providerId);
      if (credential !== undefined) out[providerId] = credential;
    }
    return out;
  }

  private async save(all: Record<string, Credential>): Promise<void> {
    const serialized = `${JSON.stringify(all, null, 2)}\n`;
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    const handle = await open(tempPath, "w");
    try {
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(tempPath, this.filePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EEXIST" && code !== "EACCES") throw error;
      await unlink(this.filePath);
      await rename(tempPath, this.filePath);
    }
    await chmod(this.filePath, 0o600).catch(() => undefined);
  }
}

function parseCredential(value: unknown, providerId: string): Credential | undefined {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new DomainValidationError(`auth.json ${providerId} is not a credential`);
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
      throw new DomainValidationError(`auth.json ${providerId} oauth credential is incomplete`);
    }
    return { ...(value as Record<string, unknown>), type: "oauth", refresh: value.refresh, access: value.access, expires: value.expires } as Credential;
  }
  throw new DomainValidationError(`auth.json ${providerId} has unknown credential type`);
}
