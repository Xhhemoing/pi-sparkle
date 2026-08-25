import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DomainValidationError } from "../domain/errors.js";
import {
  disableModel,
  enableModel,
  loadProvidersConfig,
  setDefaultModels
} from "../config/providers-config.js";
import { parseModelRef } from "../config/model-ref.js";

export interface ModelsIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

const MODELS_USAGE = `pi-sparkle models — enable Pi models for routing

Usage:
  pi-sparkle models list [--available] [--provider <id>] [--state-root <dir>]
  pi-sparkle models enable <provider/model> [--state-root <dir>]
  pi-sparkle models disable <provider/model> [--state-root <dir>]
  pi-sparkle models set-default --primary <provider/model> [--fast <provider/model>] [--state-root <dir>]

Routing only uses enabled models. Browse the Pi catalog with --available.
`;

export async function modelsCommand(args: string[], io: ModelsIo): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "list":
      return await listCommand(rest, io);
    case "enable":
      return await enableCommand(rest, io);
    case "disable":
      return await disableCommand(rest, io);
    case "set-default":
      return await setDefaultCommand(rest, io);
    case "help":
    case "--help":
    case "-h":
    case undefined:
      io.stdout(MODELS_USAGE);
      return 0;
    default:
      io.stderr(`Unknown models command: ${sub}\n`);
      io.stderr(MODELS_USAGE);
      return 1;
  }
}

function defaultStateRoot(): string {
  return join(homedir(), ".pi-sparkle");
}

function stateRootOf(values: { readonly ["state-root"]?: string }): string {
  return values["state-root"] ?? defaultStateRoot();
}

async function listCommand(args: string[], io: ModelsIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      available: { type: "boolean", default: false },
      provider: { type: "string" },
      "state-root": { type: "string" }
    }
  });
  if (values.available === true) {
    const { listSparkleModels, listedModelsFromCustom } = await import(
      "../pi-adapter/listed-model.js"
    );
    const builtin = values.provider !== undefined ? listSparkleModels(values.provider) : listSparkleModels();
    // The catalog an operator can enable from is the builtin one *plus* the
    // providers they configured themselves: `models enable local/m1` already
    // succeeds for those, so browsing had no business hiding them — and with
    // --provider <custom> the browse surface printed "(no models)" about a
    // provider this command would enable a model from.
    const config = await loadProvidersConfig(stateRootOf(values));
    const custom = config.customProviders
      .filter((provider) => values.provider === undefined || provider.id === values.provider)
      .flatMap((provider) => listedModelsFromCustom(provider));
    const listed = [...builtin, ...custom];
    if (listed.length === 0) {
      io.stdout("(no models)\n");
      return 0;
    }
    for (const model of listed) {
      io.stdout(`${model.catalogId}\n`);
    }
    return 0;
  }
  const config = await loadProvidersConfig(stateRootOf(values));
  if (config.enabled.length === 0) {
    io.stdout("No models enabled. Use: pi-sparkle models enable <provider/model>\n");
    return 0;
  }
  for (const id of config.enabled) {
    const tags: string[] = [];
    if (config.primary === id) tags.push("primary");
    if (config.fast === id) tags.push("fast");
    const suffix = tags.length > 0 ? `  ${tags.join(", ")}` : "";
    io.stdout(`${id}${suffix}\n`);
  }
  return 0;
}

async function enableCommand(args: string[], io: ModelsIo): Promise<number> {
  const catalogId = args[0];
  const { values } = parseArgs({
    args: args.slice(1),
    options: { "state-root": { type: "string" } }
  });
  if (catalogId === undefined || catalogId.startsWith("-")) {
    io.stderr("models enable requires <provider/model>\n");
    return 1;
  }
  const stateRoot = stateRootOf(values);
  await assertKnownCatalogId(stateRoot, catalogId);
  await enableModel(stateRoot, catalogId);
  io.stdout(`Enabled ${catalogId}\n`);
  return 0;
}

async function disableCommand(args: string[], io: ModelsIo): Promise<number> {
  const catalogId = args[0];
  const { values } = parseArgs({
    args: args.slice(1),
    options: { "state-root": { type: "string" } }
  });
  if (catalogId === undefined || catalogId.startsWith("-")) {
    io.stderr("models disable requires <provider/model>\n");
    return 1;
  }
  await disableModel(stateRootOf(values), catalogId);
  io.stdout(`Disabled ${catalogId}\n`);
  return 0;
}

async function setDefaultCommand(args: string[], io: ModelsIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      primary: { type: "string" },
      fast: { type: "string" },
      "state-root": { type: "string" }
    }
  });
  if (values.primary === undefined) {
    io.stderr("models set-default requires --primary <provider/model>\n");
    return 1;
  }
  const stateRoot = stateRootOf(values);
  await assertKnownCatalogId(stateRoot, values.primary);
  if (values.fast !== undefined) {
    await assertKnownCatalogId(stateRoot, values.fast);
  }
  await setDefaultModels(stateRoot, {
    primary: values.primary,
    ...(values.fast !== undefined ? { fast: values.fast } : {})
  });
  io.stdout(
    `Defaults: primary=${values.primary}${values.fast !== undefined ? ` fast=${values.fast}` : ""}\n`
  );
  return 0;
}

async function assertKnownCatalogId(stateRoot: string, catalogId: string): Promise<void> {
  const ref = parseModelRef(catalogId);
  const config = await loadProvidersConfig(stateRoot);
  const { resolveListedModel } = await import("../pi-adapter/listed-model.js");
  const listed = resolveListedModel(ref.providerId, ref.modelId, config.customProviders);
  if (listed === undefined) {
    throw new DomainValidationError(`unknown model "${catalogId}"`);
  }
}
