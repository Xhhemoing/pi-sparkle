import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DomainValidationError } from "../domain/errors.js";
import { loadProvidersConfig } from "../config/providers-config.js";
import {
  checkProviderAuth,
  deleteStoredCredential,
  isKnownProvider,
  listBuiltinProviderIds,
  listStoredCredentials,
  loginProviderInteractive,
  storeApiKeyCredential
} from "../pi-adapter/auth-session.js";

export interface AuthIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

const AUTH_USAGE = `pi-sparkle auth — per-provider credentials (Pi CredentialStore)

Usage:
  pi-sparkle auth status [--all] [--state-root <dir>]
  pi-sparkle auth login <provider> [--key-file <path> | --from-env | --oauth | --key <key>] [--state-root <dir>]
  pi-sparkle auth logout <provider> [--state-root <dir>]

Stored credentials live in <state-root>/auth.json and win over environment
variables. Status never prints secrets. Prefer --from-env, --key-file, or the
interactive prompt; --key puts the credential in process argv and shell
history. OPENAI_API_KEY / ANTHROPIC_API_KEY / … still work without login.
PI_API_KEY is only a compatibility override for the default provider.
`;

export async function authCommand(args: string[], io: AuthIo): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "status":
      return await statusCommand(rest, io);
    case "login":
      return await loginCommand(rest, io);
    case "logout":
      return await logoutCommand(rest, io);
    case "help":
    case "--help":
    case "-h":
    case undefined:
      io.stdout(AUTH_USAGE);
      return 0;
    default:
      io.stderr(`Unknown auth command: ${sub}\n`);
      io.stderr(AUTH_USAGE);
      return 1;
  }
}

function defaultStateRoot(): string {
  return join(homedir(), ".pi-sparkle");
}

function stateRootOf(values: { readonly ["state-root"]?: string }): string {
  return values["state-root"] ?? defaultStateRoot();
}

async function statusCommand(args: string[], io: AuthIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { all: { type: "boolean", default: false }, "state-root": { type: "string" } }
  });
  const stateRoot = stateRootOf(values);
  const stored = await listStoredCredentials(stateRoot);
  if (stored.length === 0 && values.all !== true) {
    io.stdout("No stored credentials. Provider env vars (OPENAI_API_KEY, …) still apply.\n");
  }
  for (const item of stored) {
    io.stdout(`${item.providerId.padEnd(28)} stored    ${item.type}\n`);
  }
  if (values.all === true) {
    const config = await loadProvidersConfig(stateRoot);
    const storedIds = new Set(stored.map((item) => item.providerId));
    for (const providerId of unique([
      ...(await listBuiltinProviderIds()),
      ...config.customProviders.map((item) => item.id)
    ])) {
      if (storedIds.has(providerId)) continue;
      const check = await checkProviderAuth(stateRoot, providerId, config.customProviders);
      if (check === undefined) continue;
      io.stdout(`${providerId.padEnd(28)} env       ${check.source ?? check.type}\n`);
    }
  }
  return 0;
}

async function loginCommand(args: string[], io: AuthIo): Promise<number> {
  const providerId = args[0];
  const { values } = parseArgs({
    args: args.slice(1),
    options: {
      key: { type: "string" },
      "key-file": { type: "string" },
      "from-env": { type: "boolean", default: false },
      oauth: { type: "boolean", default: false },
      "state-root": { type: "string" }
    }
  });
  if (providerId === undefined || providerId.startsWith("-")) {
    io.stderr("auth login requires <provider>\n");
    io.stderr(AUTH_USAGE);
    return 1;
  }
  const config = await loadProvidersConfig(stateRootOf(values));
  if (!(await isKnownProvider(providerId, config.customProviders))) {
    throw new DomainValidationError(`unknown provider "${providerId}"`);
  }
  if (values.key !== undefined && values.key.trim() === "") {
    throw new DomainValidationError("auth login --key must be non-empty");
  }
  const selected = [
    values.key !== undefined,
    values["key-file"] !== undefined,
    values["from-env"] === true,
    values.oauth === true
  ].filter(Boolean).length;
  if (selected > 1) {
    throw new DomainValidationError(
      "auth login accepts only one of --key-file, --from-env, --oauth, or --key"
    );
  }
  const stateRoot = stateRootOf(values);
  if (values["from-env"] === true) {
    const check = await checkProviderAuth(stateRoot, providerId, config.customProviders);
    if (check === undefined) {
      throw new DomainValidationError(`provider ${providerId} is not configured in the environment`);
    }
    io.stdout(`${providerId} configured via ${check.source ?? check.type} (not written to auth.json)\n`);
    return 0;
  }
  if (values["key-file"] !== undefined) {
    const keyFile = values["key-file"];
    const raw = await readFile(keyFile, "utf8").catch((error: NodeJS.ErrnoException) => {
      const reason = error.message;
      throw new DomainValidationError(`auth login --key-file ${keyFile} cannot be read: ${reason}`);
    });
    const key = raw.trim();
    if (key === "") {
      throw new DomainValidationError(`auth login --key-file ${keyFile} must be non-empty`);
    }
    const path = await storeApiKeyCredential(stateRoot, providerId, key);
    io.stdout(`Stored api_key credential for ${providerId} in ${path}\n`);
    return 0;
  }
  if (values.key !== undefined) {
    io.stderr(
      "warning: auth login --key puts the credential in process argv and shell history; prefer --from-env, --key-file, or the interactive prompt.\n"
    );
    const path = await storeApiKeyCredential(stateRoot, providerId, values.key.trim());
    io.stdout(`Stored api_key credential for ${providerId} in ${path}\n`);
    return 0;
  }
  const type = values.oauth === true ? "oauth" : "api_key";
  const path = await loginProviderInteractive(stateRoot, providerId, type, io, config.customProviders);
  io.stdout(`Stored ${type} credential for ${providerId} in ${path}\n`);
  return 0;
}

async function logoutCommand(args: string[], io: AuthIo): Promise<number> {
  const providerId = args[0];
  const { values } = parseArgs({
    args: args.slice(1),
    options: { "state-root": { type: "string" } }
  });
  if (providerId === undefined || providerId.startsWith("-")) {
    io.stderr("auth logout requires <provider>\n");
    return 1;
  }
  await deleteStoredCredential(stateRootOf(values), providerId);
  io.stdout(`Removed stored credential for ${providerId}\n`);
  return 0;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
