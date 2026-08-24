import { createInterface } from "node:readline";
import type { AuthInteraction, AuthType } from "@earendil-works/pi-ai";
import { DomainValidationError } from "../domain/errors.js";
import type { CustomProviderConfig } from "../config/providers-config.js";
import { authStorePath, FileCredentialStore } from "./file-credential-store.js";

export interface SparkleAuthIo {
  stdout(text: string): void;
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
  const store = new FileCredentialStore(authStorePath(stateRoot));
  await store.modify(providerId, async () => ({ type: "api_key", key }));
  return authStorePath(stateRoot);
}

export async function deleteStoredCredential(stateRoot: string, providerId: string): Promise<void> {
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
  const { createPiRuntime } = await import("./runtime.js");
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
  const { createPiRuntime } = await import("./runtime.js");
  const runtime = await createPiRuntime({ stateRoot, customProviders });
  await runtime.models.login(providerId, type as AuthType, cliAuthInteraction(io));
  return authStorePath(stateRoot);
}

export async function listBuiltinProviderIds(): Promise<readonly string[]> {
  const { listSparkleProviders } = await import("./listed-model.js");
  return listSparkleProviders();
}

function cliAuthInteraction(io: SparkleAuthIo): AuthInteraction {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    async prompt(prompt) {
      try {
        if (prompt.type === "select") {
          io.stdout(`${prompt.message}\n`);
          prompt.options.forEach((option, index) => {
            io.stdout(`  ${index + 1}. ${option.label}\n`);
          });
          const answer = await question(rl, `Enter number (1-${prompt.options.length}): `);
          const selected = prompt.options[Number.parseInt(answer, 10) - 1];
          if (selected === undefined) throw new DomainValidationError("invalid selection");
          return selected.id;
        }
        return await question(rl, `${prompt.message}: `);
      } finally {
        rl.close();
      }
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

function question(rl: ReturnType<typeof createInterface>, message: string): Promise<string> {
  return new Promise((resolve) => rl.question(message, resolve));
}
