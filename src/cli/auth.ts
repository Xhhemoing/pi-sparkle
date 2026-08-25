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
  storeApiKeyCredential,
  type SparkleAuthCheck
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
provider — a credential already in auth.json does not make it pass. "The
environment" is whatever the provider resolves ambiently: environment
variables, and ADC files or AWS profiles for the providers that use them.
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
  // `--all` used to suppress this notice, so an operator with an empty store
  // and no configured environment got a command that printed nothing at all
  // and exited 0 — indistinguishable from a swallowed failure.
  if (stored.length === 0) {
    io.stdout("No stored credentials. Provider env vars (OPENAI_API_KEY, …) still apply.\n");
  }
  for (const item of stored) {
    io.stdout(`${item.providerId.padEnd(28)} stored    ${item.type}\n`);
  }
  if (values.all === true) {
    const config = await loadProvidersConfig(stateRoot);
    const storedIds = new Set(stored.map((item) => item.providerId));
    let printed = 0;
    for (const providerId of unique([
      ...(await listBuiltinProviderIds()),
      ...config.customProviders.map((item) => item.id)
    ])) {
      if (storedIds.has(providerId)) continue;
      const check = await checkProviderAuth(stateRoot, providerId, config.customProviders);
      if (check === undefined) continue;
      io.stdout(
        `${providerId.padEnd(28)} ${sourceLabel(check).padEnd(10)}${check.source ?? check.type}\n`
      );
      printed += 1;
    }
    if (printed === 0) {
      io.stdout("(no environment-configured providers found)\n");
    }
  }
  return 0;
}

/**
 * What kind of source resolved this provider, for the second column.
 *
 * The column was hardcoded `env`, which mislabelled every row Pi resolves
 * without an environment variable — a keyless custom provider prints
 * `<id> (no key)` as its source, and the ADC/AWS-profile providers name a file
 * or a profile. The honest question is whether the printed source is the name
 * of a variable that is actually set, which is the same condition Pi's own
 * resolution used to pick it.
 */
function sourceLabel(check: SparkleAuthCheck): string {
  const source = check.source;
  if (source === undefined) return "ambient";
  const value = process.env[source];
  return typeof value === "string" && value.trim() !== "" ? "env" : "ambient";
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
    io.stderr(AUTH_USAGE);
    return cliFail(io, {
      command: "auth login",
      stage: "parse-args",
      message: "auth login requires <provider>",
      next: "run pi-sparkle auth --help"
    });
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
  // Every remaining mode — `--key`, `--oauth`, the interactive prompt — ends in
  // a credential written to auth.json, and for a keyless custom provider that
  // credential is never sent: the request path resolves these providers with no
  // key at all and ignores the store. Storing one would leave the operator
  // believing login worked; the interactive path additionally hands them Pi's
  // own `<id> does not support api_key login` instead of the reason.
  if (isKeylessCustomProvider(providerId, config.customProviders)) {
    throw new DomainValidationError(
      `provider ${providerId} is keyless (no envVar in providers.json): requests are sent ` +
        "with no key, so there is nothing to store and nothing was written — add envVar to " +
        "providers.json if the endpoint needs a key"
    );
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
 * A self-configured provider that has no key at all: `providers.json` names no
 * `envVar`, so the runtime builds it a resolver that sends every request
 * unauthenticated. Nothing about such a provider reads or writes `auth.json`.
 */
function isKeylessCustomProvider(
  providerId: string,
  customProviders: readonly CustomProviderConfig[]
): boolean {
  const custom = customProviders.find((item) => item.id === providerId);
  if (custom === undefined) return false;
  const envVar = custom.envVar?.trim();
  return envVar === undefined || envVar === "";
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
 *
 * That disclosure is the only part that reads the file, so it is also the only
 * part a damaged `auth.json` can take away — the verdict on the environment
 * stands either way.
 */
async function loginFromEnvCommand(
  stateRoot: string,
  providerId: string,
  customProviders: readonly CustomProviderConfig[],
  io: AuthIo
): Promise<number> {
  const customEnvVar = customProviders.find((item) => item.id === providerId)?.envVar?.trim();
  if (isKeylessCustomProvider(providerId, customProviders)) {
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
        : `provider ${providerId} is not configured in the environment; --from-env checks what this provider resolves ambiently (environment variables, and ADC files or AWS profiles for the providers that use them) and ignores auth.json, so configure one of those, or run pi-sparkle auth login ${providerId} --key <key> to store a credential instead`
    );
  }
  // Read the store before reporting success, not after: an unexpected read
  // failure has to fail the command whole rather than land under a success
  // line. A damaged file is the one exception — see below.
  const listing = await listStoredCredentialsIfReadable(stateRoot);
  io.stdout(
    `${providerId} is configured by the environment via ${check.source ?? check.type} (nothing written to auth.json)\n`
  );
  if (listing.kind === "unreadable") {
    io.stderr(
      `warning: ${listing.path} could not be read, so whether a stored credential for ${providerId} outranks the environment is unknown; run pi-sparkle auth status for the reason\n`
    );
    return 0;
  }
  if (listing.items.some((item) => item.providerId === providerId)) {
    io.stdout(
      `note: a stored credential for ${providerId} in ${authStorePath(stateRoot)} still wins over the environment; run pi-sparkle auth logout ${providerId} to use the environment\n`
    );
  }
  return 0;
}

type StoreListing =
  | { readonly kind: "listed"; readonly items: readonly { providerId: string; type: string }[] }
  | { readonly kind: "unreadable"; readonly path: string };

/**
 * The stored credentials, or the fact that the file cannot be read.
 *
 * `--from-env` asks about the environment, and the probe answers it without
 * opening `auth.json`. Only the precedence note needs the file, so a document
 * that fails to parse must not turn an answered question into exit 1 — the
 * environment either configures the provider or it does not, and that is true
 * whatever state the credential file is in. What is lost is the note, and
 * losing it is the honest outcome: a file pi-sparkle cannot parse holds no
 * stored credential it can name. Nothing here rewrites or removes the file.
 *
 * Only the damaged-store failure is absorbed. A permission error or a failing
 * disk still propagates, because those say nothing about what the file holds.
 */
async function listStoredCredentialsIfReadable(stateRoot: string): Promise<StoreListing> {
  try {
    return { kind: "listed", items: await listStoredCredentials(stateRoot) };
  } catch (error) {
    const unreadable = asAuthStoreUnreadable(error);
    if (unreadable === undefined) throw error;
    return { kind: "unreadable", path: unreadable.path };
  }
}

async function logoutCommand(args: string[], io: AuthIo): Promise<number> {
  const providerId = args[0];
  const { values } = parseArgs({
    args: args.slice(1),
    options: { "state-root": { type: "string" } }
  });
  if (providerId === undefined || providerId.startsWith("-")) {
    return cliFail(io, {
      command: "auth logout",
      stage: "parse-args",
      message: "auth logout requires <provider>",
      next: "run pi-sparkle auth --help"
    });
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
