import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import type { AuthInteraction, AuthType } from "@earendil-works/pi-ai";
import { DomainValidationError } from "../domain/errors.js";
import type { CustomProviderConfig } from "../config/providers-config.js";
import { authStorePath, FileCredentialStore } from "./file-credential-store.js";
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

/** Idempotent: removing a provider that has no stored credential is a no-op. */
export async function deleteStoredCredential(stateRoot: string, providerId: string): Promise<void> {
  requireProviderId(providerId);
  await new FileCredentialStore(authStorePath(stateRoot)).delete(providerId);
}

export async function listStoredCredentials(
  stateRoot: string
): Promise<readonly { providerId: string; type: string }[]> {
  return new FileCredentialStore(authStorePath(stateRoot)).list();
}

export async function checkProviderAuth(
  stateRoot: string,
  providerId: string,
  customProviders: readonly CustomProviderConfig[] = []
): Promise<SparkleAuthCheck | undefined> {
  const runtime = await createPiRuntime({ stateRoot, customProviders });
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
 * A `secret` prompt is never echoed. On a TTY, readline — not the terminal
 * driver — is what redraws each typed character, so the answer is read through
 * an interface whose output is a sink: the prompt is printed by us, the
 * keystrokes are displayed by nobody, and the secret goes straight back to Pi.
 * It is not written to `io.stdout` either, at any point.
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
  // The injected reader owns its own echo policy (a test recorder echoes
  // nothing, an embedder may already be reading from a masked field), so it
  // keeps the same path as every other prompt.
  const askSecret = async (message: string): Promise<string> => {
    if (io.question !== undefined) return io.question(message);
    io.stdout(message);
    const rl = createInterface({
      input: process.stdin,
      output: silentOutput(),
      // Line editing, and therefore echo, only happens in terminal mode. It is
      // forced off the sink's own (absent) TTY-ness and onto stdin's, so a
      // piped stdin still reads a line and a real one still reads it silently.
      terminal: process.stdin.isTTY === true
    });
    try {
      return await question(rl, "");
    } finally {
      rl.close();
      // The newline the user typed was swallowed with the rest of the echo.
      io.stdout("\n");
    }
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
  return new Promise((resolve) => rl.question(message, resolve));
}

/** Accepts and discards everything readline would have drawn. */
function silentOutput(): Writable {
  return new Writable({
    write(_chunk: unknown, _encoding: unknown, done: () => void) {
      done();
    }
  });
}
