import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import type { AuthInteraction, AuthType } from "@earendil-works/pi-ai";
import { DomainValidationError } from "../domain/errors.js";
import type { CustomProviderConfig } from "../config/providers-config.js";
import {
  authStorePath,
  EmptyCredentialStore,
  FileCredentialStore
} from "./file-credential-store.js";
import { createPiRuntime } from "./runtime.js";

export interface SparkleAuthIo {
  stdout(text: string): void;
  /**
   * Optional line reader for login prompts. When absent, prompts fall back to
   * a readline interface over stdin, created only once a prompt is actually
   * reached — an OAuth flow that never prompts must not take stdin hostage,
   * and a caller without a TTY (tests, embedders) can supply its own reader
   * instead of one being forced on it.
   */
  question?(prompt: string): Promise<string>;
}

export interface SparkleAuthCheck {
  readonly source?: string;
  readonly type: string;
}

export async function isKnownProvider(
  providerId: string,
  customProviders: readonly CustomProviderConfig[] = []
): Promise<boolean> {
  const { listSparkleProviders } = await import("./listed-model.js");
  return (
    listSparkleProviders().includes(providerId) ||
    customProviders.some((item) => item.id === providerId)
  );
}

export async function storeApiKeyCredential(
  stateRoot: string,
  providerId: string,
  key: string
): Promise<string> {
  requireProviderId(providerId);
  // An empty key is worse than no credential: the stored entry wins over the
  // provider's ambient sources, so writing one silently disables a working
  // environment variable and fails later, at request time.
  if (key.trim() === "") {
    throw new DomainValidationError(`api key for provider "${providerId}" must be non-empty`);
  }
  const store = new FileCredentialStore(authStorePath(stateRoot));
  await store.modify(providerId, async () => ({ type: "api_key", key }));
  return authStorePath(stateRoot);
}

/**
 * Removes a provider's stored credential and reports whether there was one.
 *
 * Idempotent: removing a provider that has no stored credential is a no-op, so
 * `auth logout` stays safe to re-run. The boolean exists so the caller can say
 * which of the two happened instead of claiming a removal either way.
 */
export async function deleteStoredCredential(
  stateRoot: string,
  providerId: string
): Promise<boolean> {
  requireProviderId(providerId);
  return new FileCredentialStore(authStorePath(stateRoot)).deleteExisting(providerId);
}

export async function listStoredCredentials(
  stateRoot: string
): Promise<readonly { providerId: string; type: string }[]> {
  return new FileCredentialStore(authStorePath(stateRoot)).list();
}

/**
 * How this provider resolves auth today: a stored credential first, ambient
 * environment only when nothing is stored. That is Pi's own precedence, and it
 * is the question `auth status` asks — "can this provider be used".
 */
export async function checkProviderAuth(
  stateRoot: string,
  providerId: string,
  customProviders: readonly CustomProviderConfig[] = []
): Promise<SparkleAuthCheck | undefined> {
  const runtime = await createPiRuntime({ stateRoot, customProviders });
  return await checkAuthOf(runtime, providerId);
}

/**
 * Whether the *environment* configures this provider, ignoring `auth.json`.
 *
 * `checkProviderAuth` cannot answer this: Pi reads the credential store first,
 * so it reports success for a provider whose only source is a stored key —
 * which would make `--from-env` pass on the strength of the file it claims not
 * to consult. Running the same check against an empty store is the narrow
 * question, and it stays honest for every provider Pi knows how to resolve
 * ambiently (env vars, ADC files, AWS profiles) without this file re-deriving
 * the variable names and drifting from the pin.
 */
export async function checkProviderEnvAuth(
  stateRoot: string,
  providerId: string,
  customProviders: readonly CustomProviderConfig[] = []
): Promise<SparkleAuthCheck | undefined> {
  const runtime = await createPiRuntime({
    stateRoot,
    customProviders,
    credentials: new EmptyCredentialStore()
  });
  return await checkAuthOf(runtime, providerId);
}

async function checkAuthOf(
  runtime: Awaited<ReturnType<typeof createPiRuntime>>,
  providerId: string
): Promise<SparkleAuthCheck | undefined> {
  const check = await runtime.models.checkAuth(providerId);
  if (check === undefined) return undefined;
  return {
    type: check.type,
    ...(check.source !== undefined ? { source: check.source } : {})
  };
}

export async function loginProviderInteractive(
  stateRoot: string,
  providerId: string,
  type: "api_key" | "oauth",
  io: SparkleAuthIo,
  customProviders: readonly CustomProviderConfig[] = []
): Promise<string> {
  requireProviderId(providerId);
  const runtime = await createPiRuntime({ stateRoot, customProviders });
  // An unknown provider rejects here (Pi's `Unknown provider: …`) before any
  // prompt is shown, so a typo can never write a credential file.
  await runtime.models.login(providerId, type as AuthType, cliAuthInteraction(io));
  return authStorePath(stateRoot);
}

export async function listBuiltinProviderIds(): Promise<readonly string[]> {
  const { listSparkleProviders } = await import("./listed-model.js");
  return listSparkleProviders();
}

/**
 * Terminal-side of a Pi login flow. Exported so it can be driven with an
 * injected reader: the interactive paths are otherwise only reachable through
 * a real stdin.
 *
 * What the user types at a `secret` prompt is never written anywhere by this
 * module: the answer goes straight back to Pi, not to `io.stdout`, and on a
 * real TTY the keystrokes are not echoed back to the terminal either — the
 * readline interface for a secret writes through `mutedPromptOutput`, which
 * passes the prompt and then swallows everything, so a pasted API key does not
 * land in the operator's scrollback. An injected `io.question` owns its own
 * echo policy; this module cannot mute a reader it did not create.
 */
export function cliAuthInteraction(io: SparkleAuthIo): AuthInteraction {
  // Opened on the first prompt and closed after it, rather than once per
  // interaction: a flow that prompts twice (select an auth method, then enter
  // the key) would otherwise ask its second question on a closed interface.
  const ask = async (message: string): Promise<string> => {
    if (io.question !== undefined) return io.question(message);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await question(rl, message);
    } finally {
      rl.close();
    }
  };
  const askSecret = async (message: string): Promise<string> => {
    if (io.question !== undefined) return io.question(message);
    return await hiddenQuestion(message);
  };
  return {
    async prompt(prompt) {
      if (prompt.type === "select") {
        io.stdout(`${prompt.message}\n`);
        prompt.options.forEach((option, index) => {
          io.stdout(`  ${index + 1}. ${option.label}\n`);
        });
        const answer = await ask(`Enter number (1-${prompt.options.length}): `);
        const selected = prompt.options[Number.parseInt(answer, 10) - 1];
        if (selected === undefined) throw new DomainValidationError("invalid selection");
        return selected.id;
      }
      if (prompt.type === "secret") return await askSecret(`${prompt.message}: `);
      return await ask(`${prompt.message}: `);
    },
    notify(event) {
      if (event.type === "auth_url") {
        io.stdout(`Open this URL:\n${event.url}\n`);
        if (event.instructions !== undefined) io.stdout(`${event.instructions}\n`);
        return;
      }
      if (event.type === "device_code") {
        io.stdout(`Open ${event.verificationUri} and enter code ${event.userCode}\n`);
        return;
      }
      if (event.type === "info" || event.type === "progress") {
        io.stdout(`${event.message}\n`);
      }
    }
  };
}

function requireProviderId(providerId: string): void {
  if (providerId.trim() === "") {
    throw new DomainValidationError("provider id must be non-empty");
  }
}

function question(rl: ReturnType<typeof createInterface>, message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // A closed stdin (EOF, a piped input that ran out, a killed parent) never
    // delivers the answer, so without this the login promise settles never
    // instead of failing.
    rl.once("close", () => {
      reject(new DomainValidationError("stdin closed before the prompt was answered"));
    });
    rl.question(message, resolve);
  });
}

export interface MutedPromptOutput {
  /** Readline's output stream: writes reach `sink` until `mute()` is called. */
  readonly stream: Writable;
  readonly mute: () => void;
}

/**
 * A writable that forwards what readline prints and can then be silenced.
 *
 * On a TTY, readline turns off the terminal driver's own echo and re-renders
 * the typed line to its output itself, so muting that output — after the
 * prompt has been written and before the first keystroke is rendered — is what
 * keeps a secret off the screen and out of scrollback. Exported for the unit
 * test: the muting is the whole security property, so it is worth pinning on
 * its own rather than only through a prompt that needs a real terminal.
 */
export function mutedPromptOutput(sink: (text: string) => void): MutedPromptOutput {
  let muted = false;
  const stream = new Writable({
    write(chunk: string | Buffer, _encoding, callback) {
      if (!muted) sink(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      callback();
    }
  });
  return {
    stream,
    mute: () => {
      muted = true;
    }
  };
}

async function hiddenQuestion(message: string): Promise<string> {
  const output = mutedPromptOutput((text) => process.stdout.write(text));
  const rl = createInterface({
    input: process.stdin,
    output: output.stream,
    // Raw mode is what stops the terminal driver from echoing; without it
    // readline neither owns the echo nor can suppress it.
    terminal: process.stdin.isTTY === true
  });
  try {
    return await new Promise<string>((resolve, reject) => {
      rl.once("close", () => {
        reject(new DomainValidationError("stdin closed before the prompt was answered"));
      });
      rl.question(message, resolve);
      // Only now: `question` writes the prompt synchronously, so muting before
      // it would hide the question along with the answer.
      output.mute();
    });
  } finally {
    rl.close();
    // The submitted newline was swallowed with the rest of the echo, so the
    // next line of output would otherwise start beside the prompt.
    process.stdout.write("\n");
  }
}
