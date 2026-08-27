import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
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
import { DomainValidationError } from "../domain/errors.js";
import { cliFail } from "./errors.js";

export interface AuthIo {
  stdout(text: string): void;
  stderr(text: string): void;
  /** Seam for tests and embedders; the real --key-stdin path reads process.stdin. */
  readStdin?(): Promise<string>;
}

const AUTH_USAGE = `pi-sparkle auth — per-provider credentials (Pi CredentialStore)

Usage:
  pi-sparkle auth status [--all] [--json] [--state-root <dir>]
  pi-sparkle auth login <provider> [--key <key> | --key-file <path> | --key-stdin | --from-env | --oauth] [--state-root <dir>]
  pi-sparkle auth logout <provider> [--state-root <dir>]

Stored credentials live in <state-root>/runtime/auth.json and win over
environment variables. Status never prints secrets. OPENAI_API_KEY /
ANTHROPIC_API_KEY / … still work without login. PI_API_KEY is only a
compatibility override for the default provider. Prefer --from-env, --key-file,
or --key-stdin; --key puts the credential in process argv and shell history.

login takes exactly one mode. --key, --key-file, --key-stdin and --oauth store a
credential; --from-env
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
        io.stderr(AUTH_USAGE);
        return cliFail(io, {
          command: "auth",
          stage: "parse-args",
          message: `Unknown auth command: ${sub}`,
          next: "use auth status, login, or logout"
        });
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

/**
 * An explicitly blank `--state-root` is what an unset shell variable leaves
 * behind (`--state-root "$SR"`), and resolving it stored the credential in a
 * cwd-relative tree: `auth login openai --key … --state-root ""` wrote
 * `<cwd>/runtime/auth.json` — a repository checkout, in the common case — and
 * reported it as a success against a relative path that named no root. Every
 * subcommand checks it after its own positional and value checks and before
 * any store or config read.
 *
 * The remedy names the flag rather than this run's value.
 */
function refuseBlankStateRoot(io: AuthIo, command: string, raw: string): number {
  return cliFail(io, {
    command,
    stage: "parse-args",
    message: `invalid --state-root "${raw}": state root must be a non-empty directory path`,
    next: "pass --state-root <dir> or omit it to use the default ~/.pi-sparkle"
  });
}

type ParsedArgs<T> =
  | { readonly ok: true; readonly values: T }
  | { readonly ok: false; readonly code: number };

/**
 * `parseArgs` throws on a mistyped flag, and an uncaught throw here reached the
 * operator as an execution failure whose remedy was "use pi-sparkle doctor for
 * preflight" — the one thing that cannot help someone who typed `--jsno`. The
 * catch covers the synchronous parse and nothing else: provider checks, store
 * reads and the damaged-store report keep their own classifications.
 */
function parseAuthArgs<T>(io: AuthIo, command: string, parse: () => { values: T }): ParsedArgs<T> {
  try {
    return { ok: true, values: parse().values };
  } catch (error) {
    return {
      ok: false,
      code: cliFail(io, {
        command,
        stage: "parse-args",
        message: error instanceof Error ? error.message : String(error),
        next: "run pi-sparkle auth --help"
      })
    };
  }
}

/**
 * Asking for help is not an error, and `login`/`logout` read their provider as
 * a positional — so `auth logout --help` arrives as the provider itself.
 */
function isHelpPositional(value: string | undefined): boolean {
  return value === "help" || value === "--help" || value === "-h";
}

/**
 * Frozen `auth status --json` contract. Additive changes only: consumers pin
 * `type` and `preview` and discriminate on `mode`. Not a domain Event (no `id`;
 * `type` is outside the Event union), and `preview: true` says so. The private
 * `AUTH_STATUS` HTTP-status set in `pi-adapter/provider-retry.ts` is unrelated.
 *
 * Nothing here is a secret and nothing here is new: the object carries provider
 * ids, credential *types*, and source *names* (`OPENAI_API_KEY`) — every byte
 * of it already printed by the human columns. A credential value is never read
 * on this path, in either mode.
 *
 * `stored` reports what `auth.json` holds under this state root, and — as in
 * the human listing — `environment` covers only providers with nothing stored,
 * because a stored credential wins over the environment. Both are sorted by
 * `providerId` so a caller diffing two runs sees credential changes rather than
 * store or catalog ordering.
 */
export interface AuthStatusStoredRow {
  readonly providerId: string;
  readonly credentialType: string;
}

/**
 * `label` is `sourceLabel`'s verdict, not a second derivation of it, and
 * `source` is the same string the human source column prints — so the two
 * surfaces cannot disagree about what resolved a provider, including the rows
 * the label deliberately understates (`AWS access keys` stays `ambient`).
 */
export interface AuthStatusEnvironmentRow {
  readonly providerId: string;
  readonly label: string;
  readonly source: string;
}

export interface AuthStatusStoredJson {
  readonly type: "AUTH_STATUS";
  readonly preview: true;
  readonly mode: "stored";
  readonly stored: readonly AuthStatusStoredRow[];
}

export interface AuthStatusAllJson {
  readonly type: "AUTH_STATUS";
  readonly preview: true;
  readonly mode: "all";
  readonly stored: readonly AuthStatusStoredRow[];
  readonly environment: readonly AuthStatusEnvironmentRow[];
}

export type AuthStatusJson = AuthStatusStoredJson | AuthStatusAllJson;

function writeAuthStatusJson(io: AuthIo, payload: AuthStatusJson): void {
  io.stdout(`${JSON.stringify(payload)}\n`);
}

function byProviderId<T extends { readonly providerId: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) =>
    left.providerId < right.providerId ? -1 : left.providerId > right.providerId ? 1 : 0
  );
}

async function statusCommand(args: string[], io: AuthIo): Promise<number> {
  const parsed = parseAuthArgs(io, "auth status", () =>
    parseArgs({
      args,
      options: {
        all: { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        "state-root": { type: "string" }
      }
    })
  );
  if (!parsed.ok) return parsed.code;
  const { values } = parsed;
  // Before the store read: a help request must not create auth.json.
  if (values.help === true) {
    io.stdout(AUTH_USAGE);
    return 0;
  }
  const rawStateRoot = values["state-root"];
  if (rawStateRoot !== undefined && rawStateRoot.trim() === "") {
    return refuseBlankStateRoot(io, "auth status", rawStateRoot);
  }
  const json = values.json === true;
  const stateRoot = stateRootOf(values);
  const stored = await listStoredCredentials(stateRoot);
  if (!json) {
    // `--all` used to suppress this notice, so an operator with an empty store
    // and no configured environment got a command that printed nothing at all
    // and exited 0 — indistinguishable from a swallowed failure. A caller
    // asking for JSON gets `stored: []` instead, which needs no sniffing.
    if (stored.length === 0) {
      io.stdout("No stored credentials. Provider env vars (OPENAI_API_KEY, …) still apply.\n");
    }
    for (const item of stored) {
      io.stdout(`${item.providerId.padEnd(28)} stored    ${item.type}\n`);
    }
  }
  const storedRows = byProviderId(
    stored.map((item) => ({ providerId: item.providerId, credentialType: item.type }))
  );
  if (values.all !== true) {
    if (json) {
      writeAuthStatusJson(io, { type: "AUTH_STATUS", preview: true, mode: "stored", stored: storedRows });
    }
    return 0;
  }
  const config = await loadProvidersConfig(stateRoot);
  const storedIds = new Set(stored.map((item) => item.providerId));
  const environment: AuthStatusEnvironmentRow[] = [];
  for (const providerId of unique([
    ...(await listBuiltinProviderIds()),
    ...config.customProviders.map((item) => item.id)
  ])) {
    if (storedIds.has(providerId)) continue;
    const check = await checkProviderAuth(stateRoot, providerId, config.customProviders);
    if (check === undefined) continue;
    const label = sourceLabel(check, providerId, config.customProviders);
    const source = check.source ?? check.type;
    environment.push({ providerId, label, source });
    if (!json) io.stdout(`${providerId.padEnd(28)} ${label.padEnd(10)}${source}\n`);
  }
  if (json) {
    writeAuthStatusJson(io, {
      type: "AUTH_STATUS",
      preview: true,
      mode: "all",
      stored: storedRows,
      environment: byProviderId(environment)
    });
    return 0;
  }
  if (environment.length === 0) {
    io.stdout("(no environment-configured providers found)\n");
  }
  return 0;
}

/**
 * What kind of source resolved this provider, for the second column.
 *
 * The column was hardcoded `env`, which mislabelled every row Pi resolves
 * without an environment variable — a custom provider with no `envVar` prints
 * `<id> (no key)` as its source, and the ADC/AWS-profile providers name a file
 * or a profile.
 *
 * A custom provider is classified against the one name `providers.json`
 * configures. The runtime builds its resolver from `envVar` and that resolver
 * reports exactly that name back, so equality with it — rather than the source
 * string looking variable-shaped, or happening to match something in the
 * environment — is what makes the row an environment row.
 *
 * Equality against the configured bytes, not against a trimmed copy of them.
 * Parsing stores `envVar` as written and the runtime passes that same string
 * to the resolver, which looks it up under exactly that key — so a configured
 * `" PADDED_KEY "` resolves through a variable of that name and comes back as
 * that source. Trimming here alone would print `ambient` for a row a
 * configured variable did resolve; normalizing instead is a wider change, in
 * parsing and in the runtime together, and this column is not the place to
 * start it.
 *
 * A builtin has no configured name to compare against: Pi's `ApiKeyAuth` keeps
 * its variable list inside the resolver closure and exposes only the source it
 * chose, and re-deriving those names here would drift from the pinned
 * provider set on every bump. What the closure does guarantee is that a branch
 * resolving a single variable returns that variable's own name, and only after
 * reading a non-empty value from it — so a source naming a live variable is an
 * environment row.
 *
 * The converse does not follow, and where the heuristic is wrong it
 * understates. `gcloud application default credentials` really is a file, but
 * `AWS access keys` is returned only once both `AWS_ACCESS_KEY_ID` and
 * `AWS_SECRET_ACCESS_KEY` resolve — an environment configuration whose source
 * names no single variable, so it prints `ambient`. Hardcoding that pair is
 * the drift this heuristic avoids, and the source column still names what
 * resolved the provider.
 */
function sourceLabel(
  check: SparkleAuthCheck,
  providerId: string,
  customProviders: readonly CustomProviderConfig[]
): string {
  const source = check.source;
  if (source === undefined) return "ambient";
  const custom = customProviders.find((item) => item.id === providerId);
  if (custom !== undefined) {
    // `trim()` only mirrors the runtime's own guard for whether a resolver is
    // built from the variable at all; the comparison itself is the raw value.
    const envVar = custom.envVar;
    return envVar !== undefined && envVar.trim() !== "" && source === envVar ? "env" : "ambient";
  }
  const value = process.env[source];
  return typeof value === "string" && value.trim() !== "" ? "env" : "ambient";
}

async function loginCommand(args: string[], io: AuthIo): Promise<number> {
  const providerId = args[0];
  const parsed = parseAuthArgs(io, "auth login", () =>
    parseArgs({
      args: args.slice(1),
      options: {
        key: { type: "string" },
        "key-file": { type: "string" },
        "key-stdin": { type: "boolean", default: false },
        "from-env": { type: "boolean", default: false },
        oauth: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        "state-root": { type: "string" }
      }
    })
  );
  if (!parsed.ok) return parsed.code;
  const { values } = parsed;
  // Ahead of the `requires <provider>` refusal, which `--help` in the provider
  // position would otherwise turn the discovery gesture into, and ahead of any
  // store read.
  if (values.help === true || isHelpPositional(providerId)) {
    io.stdout(AUTH_USAGE);
    return 0;
  }
  // A blank positional is the same mistake as an absent one — `auth login ""`
  // used to reach the provider lookup and be reported as an unknown provider.
  if (providerId === undefined || providerId.startsWith("-") || providerId.trim() === "") {
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
    ...(values["key-file"] !== undefined ? ["--key-file"] : []),
    ...(values["key-stdin"] === true ? ["--key-stdin"] : []),
    ...(values["from-env"] === true ? ["--from-env"] : []),
    ...(values.oauth === true ? ["--oauth"] : [])
  ];
  if (modes.length > 1) {
    const hasFileMode = values["key-file"] !== undefined || values["key-stdin"] === true;
    const message = hasFileMode
      ? `auth login takes only one of --key-file, --key-stdin, --from-env, --oauth, or --key; got ${modes.join(" and ")} — nothing was stored`
      : `auth login takes one of --key, --from-env, --oauth; got ${modes.join(" and ")} — nothing was stored`;
    const next = hasFileMode
      ? "pass exactly one of --key-file, --key-stdin, --from-env, --oauth, or --key"
      : "pass exactly one of --key, --from-env, --oauth";
    return cliFail(io, {
      command: "auth login",
      stage: "parse-args",
      message,
      next
    });
  }
  // Beside the mode check rather than after the provider lookup: an empty
  // `--key` is wrong whatever the config says, so it is refused before the
  // config read — and the key is never echoed, blank or not.
  if (values.key !== undefined && values.key.trim() === "") {
    return cliFail(io, {
      command: "auth login",
      stage: "parse-args",
      message: "auth login --key must be non-empty",
      next: "pass --key <key> with a non-empty value"
    });
  }
  const rawStateRoot = values["state-root"];
  if (rawStateRoot !== undefined && rawStateRoot.trim() === "") {
    return refuseBlankStateRoot(io, "auth login", rawStateRoot);
  }
  const config = await loadProvidersConfig(stateRootOf(values));
  if (!(await isKnownProvider(providerId, config.customProviders))) {
    return cliFail(io, {
      command: "auth login",
      stage: "validation",
      message: `unknown provider "${providerId}"`,
      // The inventory has to be read under the root that just refused: a
      // custom provider comes from that root's providers.json, so the same
      // command against the default root would print a different catalog.
      next: "pass a provider shown by pi-sparkle models list --available using the same --state-root; custom providers come from that root's providers.json"
    });
  }
  const stateRoot = stateRootOf(values);
  if (values["from-env"] === true) {
    return await loginFromEnvCommand(stateRoot, providerId, config.customProviders, io);
  }
  // Every remaining mode — `--key`, `--oauth`, the interactive prompt — ends in
  // a credential written to auth.json, and this provider's resolver never reads
  // it: Pi loads the stored credential and hands it over, and the resolver the
  // runtime builds for an envVar-less custom returns without consulting it. So
  // the write is not a credential that fails at request time, it is one that is
  // never asked for. The claim stops there — `PI_API_KEY` can still put a key
  // on these requests — so the remedy names the two things that do configure
  // the provider rather than telling the operator to drop a flag, which would
  // only enter the interactive path this same guard refuses.
  if (isKeylessCustomProvider(providerId, config.customProviders)) {
    return cliFail(io, {
      command: "auth login",
      stage: "validation",
      message:
        `provider ${providerId} is a custom provider with no envVar in providers.json, so its ` +
        "request resolver ignores auth.json; auth login cannot configure it — add envVar to " +
        "providers.json and use that variable or stored login, or use the per-run PI_API_KEY " +
        "compatibility override for the selected default provider",
      next: `add envVar for ${providerId} to providers.json, or use the per-run PI_API_KEY override for the selected default provider`
    });
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
  if (values["key-stdin"] === true) {
    const key = (await readKeyFromStdin(io)).trim();
    if (key === "") {
      throw new DomainValidationError("auth login --key-stdin must be non-empty");
    }
    const path = await storeApiKeyCredential(stateRoot, providerId, key);
    io.stdout(`Stored api_key credential for ${providerId} in ${path}\n`);
    return 0;
  }
  if (values.key !== undefined) {
    io.stderr(
      "warning: auth login --key puts the credential in process argv and shell history; prefer --from-env, --key-file, --key-stdin, or the interactive prompt.\n"
    );
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
 * A custom provider `providers.json` gives no `envVar`. The runtime builds
 * these their own resolver, and it returns without consulting the credential
 * Pi passes it, so `auth.json` has no bearing on such a provider.
 *
 * That is a statement about the credential store, not about the wire: a run
 * whose selected default provider is this one still forwards `PI_API_KEY` as
 * the request key, ahead of resolved auth. "Nothing is stored here" and
 * "requests carry no key" are different claims, and only the first is true.
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
  // The configured bytes, untrimmed: the runtime looks the variable up under
  // exactly them (the same fact `status --all` labels a padded name `env` on),
  // so a refusal derived from a trimmed copy would name a variable the probe
  // never read. A whitespace-only value is keyless and refused just below.
  const customEnvVar = customProviders.find((item) => item.id === providerId)?.envVar;
  if (isKeylessCustomProvider(providerId, customProviders)) {
    return cliFail(io, {
      command: "auth login",
      stage: "preflight",
      message:
        `provider ${providerId} is a custom provider with no envVar in providers.json, ` +
        "so no environment variable configures it and --from-env has nothing to check",
      next: `add envVar for ${providerId} to providers.json`
    });
  }
  const check = await checkProviderEnvAuth(stateRoot, providerId, customProviders);
  if (check === undefined) {
    // An unconfigured environment is an environment fault, not a bad argument
    // and not an execution failure: nothing about the command line is wrong.
    return cliFail(io, {
      command: "auth login",
      stage: "preflight",
      ...unconfiguredEnvironmentReport(providerId, customEnvVar)
    });
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

/**
 * What `--from-env` found nothing for, and what to do about it — both stated
 * in terms of what the probe actually checked.
 *
 * The remedy splits because the two messages name different things. A custom
 * provider's message names one variable, so the remedy is to set that variable
 * as configured. A builtin's message names *categories* — environment
 * variables, ADC files, AWS profiles — because Pi keeps the variable list
 * inside its resolver, so "set the variable the message names" would be
 * pointing at a name that is not there.
 *
 * The padded case is the same fact `status --all` labels a padded `envVar`
 * `env` on: `providers.json` keeps the name as written and the runtime looks
 * it up under exactly those bytes, so the trimmed spelling is a *different*
 * variable and setting it changes nothing. Naming it would send the operator
 * to configure something the probe will not read. Quoted through
 * `JSON.stringify` because the whitespace is otherwise invisible in the line;
 * an unpadded name keeps its existing bytes rather than gaining quotes.
 */
function unconfiguredEnvironmentReport(
  providerId: string,
  customEnvVar: string | undefined
): { readonly message: string; readonly next: string } {
  const storeInstead = `store a credential with pi-sparkle auth login ${providerId} --key <key>`;
  if (customEnvVar === undefined) {
    return {
      message: `provider ${providerId} is not configured in the environment; --from-env checks what this provider resolves ambiently (environment variables, and ADC files or AWS profiles for the providers that use them) and ignores auth.json, so configure one of those, or run pi-sparkle auth login ${providerId} --key <key> to store a credential instead`,
      next: `configure one of the ambient sources named in the message, or ${storeInstead}`
    };
  }
  const next = `set the providers.json envVar exactly as configured for ${providerId}, or ${storeInstead}`;
  if (customEnvVar !== customEnvVar.trim()) {
    return {
      message: `provider ${providerId} is not configured in the environment: providers.json envVar ${JSON.stringify(customEnvVar)} is unset or empty (whitespace is part of the variable name)`,
      next
    };
  }
  return {
    message: `provider ${providerId} is not configured in the environment: ${customEnvVar} is unset or empty (providers.json names it for this provider)`,
    next
  };
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
  const parsed = parseAuthArgs(io, "auth logout", () =>
    parseArgs({
      args: args.slice(1),
      options: {
        help: { type: "boolean", short: "h", default: false },
        "state-root": { type: "string" }
      }
    })
  );
  if (!parsed.ok) return parsed.code;
  const { values } = parsed;
  if (values.help === true || isHelpPositional(providerId)) {
    io.stdout(AUTH_USAGE);
    return 0;
  }
  // A blank positional is a missing one; the store's own non-empty check is
  // then unreachable from argv, and never reports itself as a plane failure.
  if (providerId === undefined || providerId.startsWith("-") || providerId.trim() === "") {
    return cliFail(io, {
      command: "auth logout",
      stage: "parse-args",
      message: "auth logout requires <provider>",
      next: "run pi-sparkle auth --help"
    });
  }
  const rawStateRoot = values["state-root"];
  if (rawStateRoot !== undefined && rawStateRoot.trim() === "") {
    return refuseBlankStateRoot(io, "auth logout", rawStateRoot);
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

/**
 * The `--key-stdin` source: piped bytes only. A TTY would echo the credential
 * to the terminal or block forever, so it is refused with the remedy named.
 */
async function readKeyFromStdin(io: AuthIo): Promise<string> {
  if (io.readStdin !== undefined) return io.readStdin();
  if (process.stdin.isTTY === true) {
    throw new DomainValidationError(
      "auth login --key-stdin requires piped input (a TTY would echo or block); use --key-file or the interactive prompt"
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
