import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DomainValidationError } from "../domain/errors.js";
import { loadProvidersConfig, type CustomProviderConfig } from "../config/providers-config.js";
import {
  checkProviderAuth,
  checkProviderEnvAuth,
  deleteStoredCredential,
  isKnownProvider,
  listBuiltinProviderIds,
  listStoredCredentials,
  loginProviderInteractive,
  storeApiKeyCredential
} from "../pi-adapter/auth-session.js";
import { asAuthStoreUnreadable, authStorePath } from "../pi-adapter/file-credential-store.js";
import { cliFail } from "./errors.js";

export interface AuthIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

const AUTH_USAGE = `pi-sparkle auth — per-provider credentials (Pi CredentialStore)

Usage:
  pi-sparkle auth status [--all] [--state-root <dir>]
  pi-sparkle auth login <provider> [--key <key> | --from-env | --oauth] [--state-root <dir>]
  pi-sparkle auth logout <provider> [--state-root <dir>]

Stored credentials live in <state-root>/runtime/auth.json and win over
environment variables. Status never prints secrets. OPENAI_API_KEY /
ANTHROPIC_API_KEY / … still work without login. PI_API_KEY is only a
compatibility override for the default provider.

login takes exactly one mode. --key and --oauth store a credential; --from-env
stores nothing and only reports whether the environment configures the
provider — a credential already in auth.json does not make it pass.
`;

export async function authCommand(args: string[], io: AuthIo): Promise<number> {
  const [sub, ...rest] = args;
  try {
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
  } catch (error) {
    // A damaged auth.json fails every verb, `logout` included, so the remedy
    // the operator needs is the one thing the generic "fix the reported error"
    // cannot give them: which file, and that moving it aside is safe.
    const unreadable = asAuthStoreUnreadable(error);
    if (unreadable === undefined) throw error;
    return cliFail(io, {
      command: `auth ${sub ?? ""}`.trim(),
      stage: "load-credentials",
      message: unreadable.message,
      next: `move ${unreadable.path} aside — it holds only credentials you can enter again, and pi-sparkle will not delete it for you — then re-run pi-sparkle auth login <provider>`
    });
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
  // The modes do different things to auth.json, so a combination has no
  // coherent meaning and used to resolve by silent precedence: --from-env beat
  // --key, which meant `--key sk-new --from-env` exited 0 reporting the *old*
  // stored credential and never wrote the new one. Refusing is the only
  // reading of `[--key | --from-env | --oauth]` that cannot lose a rotation.
  const modes = [
    ...(values.key !== undefined ? ["--key"] : []),
    ...(values["from-env"] === true ? ["--from-env"] : []),
    ...(values.oauth === true ? ["--oauth"] : [])
  ];
  if (modes.length > 1) {
    throw new DomainValidationError(
      `auth login takes one of --key, --from-env, --oauth; got ${modes.join(" and ")} — nothing was stored`
    );
  }
  const config = await loadProvidersConfig(stateRootOf(values));
  if (!(await isKnownProvider(providerId, config.customProviders))) {
    throw new DomainValidationError(`unknown provider "${providerId}"`);
  }
  if (values.key !== undefined && values.key.trim() === "") {
    throw new DomainValidationError("auth login --key must be non-empty");
  }
  const stateRoot = stateRootOf(values);
  if (values["from-env"] === true) {
    return await loginFromEnvCommand(stateRoot, providerId, config.customProviders, io);
  }
  if (values.key !== undefined) {
    const path = await storeApiKeyCredential(stateRoot, providerId, values.key);
    io.stdout(`Stored api_key credential for ${providerId} in ${path}\n`);
    return 0;
  }
  const type = values.oauth === true ? "oauth" : "api_key";
  const path = await loginProviderInteractive(stateRoot, providerId, type, io, config.customProviders);
  io.stdout(`Stored ${type} credential for ${providerId} in ${path}\n`);
  return 0;
}

/**
 * `--from-env` verifies the environment and writes nothing.
 *
 * It used to ask `checkAuth`, which resolves a stored credential first — so
 * the flag reported success off `auth.json` for a provider with no environment
 * variable set anywhere, and then said "(not written to auth.json)" about the
 * very file it had just read. The check is now env-only and fails closed, and
 * a stored credential that outranks the environment is disclosed rather than
 * mistaken for one: the operator asked whether the environment works, and it
 * will not be what a run uses while that credential is on disk.
 */
async function loginFromEnvCommand(
  stateRoot: string,
  providerId: string,
  customProviders: readonly CustomProviderConfig[],
  io: AuthIo
): Promise<number> {
  const custom = customProviders.find((item) => item.id === providerId);
  const customEnvVar = custom?.envVar?.trim();
  if (custom !== undefined && (customEnvVar === undefined || customEnvVar === "")) {
    throw new DomainValidationError(
      `provider ${providerId} is a custom provider with no envVar in providers.json, ` +
        "so no environment variable configures it and --from-env has nothing to check"
    );
  }
  const check = await checkProviderEnvAuth(stateRoot, providerId, customProviders);
  if (check === undefined) {
    throw new DomainValidationError(
      customEnvVar !== undefined
        ? `provider ${providerId} is not configured in the environment: ${customEnvVar} is unset or empty (providers.json names it for this provider)`
        : `provider ${providerId} is not configured in the environment; --from-env checks environment variables only, so set this provider's API-key variable, or run pi-sparkle auth login ${providerId} --key <key> to store one instead`
    );
  }
  // Read the store before reporting success, not after: a damaged auth.json
  // has to fail the command whole rather than land under a success line.
  const stored = await listStoredCredentials(stateRoot);
  io.stdout(
    `${providerId} is configured by the environment via ${check.source ?? check.type} (nothing written to auth.json)\n`
  );
  if (stored.some((item) => item.providerId === providerId)) {
    io.stdout(
      `note: a stored credential for ${providerId} in ${authStorePath(stateRoot)} still wins over the environment; run pi-sparkle auth logout ${providerId} to use the environment\n`
    );
  }
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
  const stateRoot = stateRootOf(values);
  // Deleting nothing still succeeds — re-running logout has to stay safe — but
  // saying "removed" about a provider that was never stored (a typo, or a
  // provider configured purely from the environment) reports work that did not
  // happen, and reads as if it had cleared an environment variable.
  const removed = await deleteStoredCredential(stateRoot, providerId);
  io.stdout(
    removed
      ? `Removed stored credential for ${providerId} from ${authStorePath(stateRoot)}\n`
      : `No stored credential for ${providerId} in ${authStorePath(stateRoot)}; nothing to remove (environment variables are untouched).\n`
  );
  return 0;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
