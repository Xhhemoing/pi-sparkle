import { chmod, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
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

/** Owner-only. Anything wider on a shared machine is a readable credential. */
const CREDENTIAL_FILE_MODE = 0o600;
/** Owner-only directory so the credential file cannot be listed by others. */
const CREDENTIAL_DIR_MODE = 0o700;

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
    await refuseGroupOrWorldReadable(this.filePath);
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

  /**
   * The mode is requested on the temp file, so the credential is owner-only from
   * before it holds any bytes — a chmod after the rename leaves a window in which
   * the published file is readable at whatever the umask allowed.
   *
   * The chmod that follows only confirms the published file, and its failure is
   * raised rather than swallowed: silently keeping a credential file this process
   * could not restrict is the failure mode the mode argument exists to prevent.
   */
  private async save(all: Record<string, Credential>): Promise<void> {
    const serialized = `${JSON.stringify(all, null, 2)}\n`;
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: CREDENTIAL_DIR_MODE });
    await restrictOwnerOnly(directory, CREDENTIAL_DIR_MODE);
    await writeFileAtomic(this.filePath, serialized, { mode: CREDENTIAL_FILE_MODE });
    await restrictOwnerOnly(this.filePath, CREDENTIAL_FILE_MODE);
    await restrictOwnerOnly(`${this.filePath}.lock`, CREDENTIAL_FILE_MODE, { missingOk: true });
  }
}

/**
 * gh-style fail-closed: a group/world-readable credential file is treated as
 * already leaked. POSIX only — NTFS mode bits are not a trustworthy ACL.
 */
async function refuseGroupOrWorldReadable(path: string): Promise<void> {
  if (process.platform === "win32") return;
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(path);
  } catch (error: unknown) {
    const code =
      error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return;
    throw error;
  }
  if ((info.mode & 0o077) !== 0) {
    const mode = (info.mode & 0o777).toString(8).padStart(3, "0");
    throw new DomainValidationError(
      `refusing to read ${path}: mode ${mode} is readable by group or others; chmod 600 the file before use`
    );
  }
}

async function restrictOwnerOnly(
  path: string,
  mode: number,
  options: { readonly missingOk?: boolean } = {}
): Promise<void> {
  try {
    await chmod(path, mode);
  } catch (error: unknown) {
    const code =
      error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
    if (options.missingOk === true && code === "ENOENT") return;
    // NTFS does not honor POSIX modes; failing closed here would make login
    // impossible on Windows even though the ACL already excludes other users
    // by default on a per-user profile.
    if (process.platform === "win32") return;
    const reason = error instanceof Error ? error.message : String(error);
    throw new DomainValidationError(`cannot restrict ${path} to owner-only permissions: ${reason}`);
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
