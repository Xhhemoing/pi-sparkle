import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  disableModel,
  enableModel,
  loadProvidersConfig,
  setDefaultModels
} from "../config/providers-config.js";
import { parseModelRef, tryParseModelRef } from "../config/model-ref.js";
import type { SparkleListedModel } from "../pi-adapter/listed-model.js";
import { cliFail } from "./errors.js";

export interface ModelsIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

const MODELS_USAGE = `pi-sparkle models — enable Pi models for routing

Usage:
  pi-sparkle models list [--available] [--provider <id>] [--state-root <dir>] [--json]
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
      io.stderr(MODELS_USAGE);
      return cliFail(io, {
        command: "models",
        stage: "parse-args",
        message: `Unknown models command: ${sub}`,
        next: "use models list, enable, disable, or set-default"
      });
  }
}

function defaultStateRoot(): string {
  return join(homedir(), ".pi-sparkle");
}

function stateRootOf(values: { readonly ["state-root"]?: string }): string {
  return values["state-root"] ?? defaultStateRoot();
}

type ParsedArgs<T> =
  | { readonly ok: true; readonly values: T }
  | { readonly ok: false; readonly code: number };

/**
 * `parseArgs` throws on a mistyped flag, and an uncaught throw here reached the
 * operator as the generic failure with the doctor remedy — a remedy that cannot
 * help someone who typed `--jsn`. Every models subcommand routes its argv
 * errors through the one house dialect instead.
 */
function parseModelsArgs<T>(io: ModelsIo, command: string, parse: () => { values: T }): ParsedArgs<T> {
  try {
    return { ok: true, values: parse().values };
  } catch (error) {
    return {
      ok: false,
      code: cliFail(io, {
        command,
        stage: "parse-args",
        message: error instanceof Error ? error.message : String(error),
        next: "run pi-sparkle models --help"
      })
    };
  }
}

/**
 * Frozen `models list --json` contract. Additive changes only: consumers pin
 * `type` and `preview` and discriminate on `mode`. Not a domain Event (no `id`;
 * `type` is outside the Event union), and `preview: true` says so.
 *
 * What this object reports is the *stored* model configuration under the state
 * root — which ids providers.json records as enabled, and which two it records
 * as the primary and fast defaults. It is not a prediction of what any run will
 * use: `--primary-model` / `--fast-model` and `PI_PROVIDER` / `PI_MODEL` /
 * `PI_FAST_MODEL` both outrank the stored defaults when a run picks its models,
 * so a caller that wants the effective choice has to read the run, not this.
 *
 * The two defaults are named once, as top-level `primary` / `fast`, and are
 * `null` rather than absent when unset: a consumer reads one place for the
 * answer instead of reconciling it against a per-row copy that could disagree.
 * A row therefore carries only what is per-model — its id, and whether the
 * catalog still resolves it.
 */
export interface ModelsListEnabledRow {
  readonly id: string;
  readonly inCatalog: boolean;
}

export interface ModelsListAvailableRow {
  readonly id: string;
}

export interface ModelsListEnabledJson {
  readonly type: "MODELS_LIST";
  readonly preview: true;
  readonly mode: "enabled";
  readonly primary: string | null;
  readonly fast: string | null;
  readonly models: readonly ModelsListEnabledRow[];
}

/** The catalog a model can be enabled from: ids only, and no stored defaults. */
export interface ModelsListAvailableJson {
  readonly type: "MODELS_LIST";
  readonly preview: true;
  readonly mode: "available";
  readonly models: readonly ModelsListAvailableRow[];
}

export type ModelsListJson = ModelsListEnabledJson | ModelsListAvailableJson;

function writeModelsListJson(io: ModelsIo, payload: ModelsListJson): void {
  io.stdout(`${JSON.stringify(payload)}\n`);
}

async function listCommand(args: string[], io: ModelsIo): Promise<number> {
  const parsed = parseModelsArgs(io, "models list", () =>
    parseArgs({
      args,
      options: {
        available: { type: "boolean", default: false },
        provider: { type: "string" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        "state-root": { type: "string" }
      }
    })
  );
  if (!parsed.ok) return parsed.code;
  const { values } = parsed;
  if (values.help === true) {
    io.stdout(MODELS_USAGE);
    return 0;
  }
  // The enabled view never read `--provider`, so asking "which anthropic models
  // are enabled" got the whole enabled list back and an exit 0. Refusing rather
  // than filtering: filtering the enabled view would be a new feature, and the
  // silent-ignore is the defect.
  if (values.provider !== undefined && values.available !== true) {
    return cliFail(io, {
      command: "models list",
      stage: "parse-args",
      message:
        "models list --provider filters the --available catalog and does not apply to enabled models",
      next: "add --available, or drop --provider"
    });
  }
  const json = values.json === true;
  if (values.available === true) {
    const catalog = await import("../pi-adapter/listed-model.js");
    const builtin =
      values.provider !== undefined
        ? catalog.listSparkleModels(values.provider)
        : catalog.listSparkleModels();
    // The catalog an operator can enable from is the builtin one *plus* the
    // providers they configured themselves: `models enable local/m1` already
    // succeeds for those, so browsing had no business hiding them — and with
    // --provider <custom> the browse surface printed "(no models)" about a
    // provider this command would enable a model from.
    const config = await loadProvidersConfig(stateRootOf(values));
    const custom = config.customProviders
      .filter((provider) => values.provider === undefined || provider.id === values.provider)
      .flatMap((provider) => catalog.listedModelsFromCustom(provider));
    const listed = [...builtin, ...custom];
    if (json) {
      writeModelsListJson(io, {
        type: "MODELS_LIST",
        preview: true,
        mode: "available",
        models: listed.map((model) => ({ id: model.catalogId }))
      });
      return 0;
    }
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
  if (json) {
    const { resolveListedModel } = await import("../pi-adapter/listed-model.js");
    // The "No models enabled" notice is prose for a human reader; a caller
    // asking for JSON gets the same object with an empty list rather than a
    // line it would have to sniff for.
    writeModelsListJson(io, {
      type: "MODELS_LIST",
      preview: true,
      mode: "enabled",
      primary: config.primary ?? null,
      fast: config.fast ?? null,
      models: config.enabled.map((id) => {
        const ref = parseModelRef(id);
        return {
          id,
          inCatalog:
            resolveListedModel(ref.providerId, ref.modelId, config.customProviders) !== undefined
        };
      })
    });
    return 0;
  }
  if (config.enabled.length === 0) {
    io.stdout("No models enabled. Use: pi-sparkle models enable <provider/model>\n");
    return 0;
  }
  // An enabled id can stop resolving without anything in this state root
  // changing — a pin bump that drops a model leaves the entry behind, and the
  // only symptom used to be a run failing later. Say it on the surface that
  // claims the model is enabled.
  const { resolveListedModel } = await import("../pi-adapter/listed-model.js");
  for (const id of config.enabled) {
    const tags: string[] = [];
    if (config.primary === id) tags.push("primary");
    if (config.fast === id) tags.push("fast");
    const suffix = tags.length > 0 ? `  ${tags.join(", ")}` : "";
    const ref = parseModelRef(id);
    const stale =
      resolveListedModel(ref.providerId, ref.modelId, config.customProviders) === undefined
        ? "  (not in catalog)"
        : "";
    io.stdout(`${id}${suffix}${stale}\n`);
  }
  return 0;
}

async function enableCommand(args: string[], io: ModelsIo): Promise<number> {
  const catalogId = args[0];
  const parsed = parseModelsArgs(io, "models enable", () =>
    parseArgs({
      args: args.slice(1),
      options: { "state-root": { type: "string" } }
    })
  );
  if (!parsed.ok) return parsed.code;
  const { values } = parsed;
  if (catalogId === undefined || catalogId.startsWith("-")) {
    return cliFail(io, {
      command: "models enable",
      stage: "parse-args",
      message: "models enable requires <provider/model>",
      next: "run pi-sparkle models --help"
    });
  }
  const stateRoot = stateRootOf(values);
  if (tryParseModelRef(catalogId) === undefined) {
    return refuseMalformedId(io, "models enable", "<provider/model>", catalogId, stateRoot);
  }
  const listed = await assertKnownCatalogId(stateRoot, catalogId);
  if (listed === undefined) {
    return refuseUnknownModel(io, "models enable", catalogId, stateRoot);
  }
  await enableModel(stateRoot, catalogId);
  io.stdout(`Enabled ${catalogId}\n`);
  return 0;
}

async function disableCommand(args: string[], io: ModelsIo): Promise<number> {
  const catalogId = args[0];
  const parsed = parseModelsArgs(io, "models disable", () =>
    parseArgs({
      args: args.slice(1),
      options: { "state-root": { type: "string" } }
    })
  );
  if (!parsed.ok) return parsed.code;
  const { values } = parsed;
  if (catalogId === undefined || catalogId.startsWith("-")) {
    return cliFail(io, {
      command: "models disable",
      stage: "parse-args",
      message: "models disable requires <provider/model>",
      next: "run pi-sparkle models --help"
    });
  }
  const stateRoot = stateRootOf(values);
  const ref = tryParseModelRef(catalogId);
  if (ref === undefined) {
    return refuseMalformedId(io, "models disable", "<provider/model>", catalogId, stateRoot);
  }
  // Disabling a model that is a routing default drops the default with it, and
  // the operator used to learn that from a run that could not pick a model.
  // Reading the config before the mutation is what makes the disclosure
  // possible without teaching `disableModel` to report.
  const before = await loadProvidersConfig(stateRoot);
  const formatted = `${ref.providerId}/${ref.modelId}`;
  // The mutation runs either way: a hand-edited config can hold a `primary` or
  // `fast` that is not in `enabled`, and dropping that dangling default is real
  // work. Only the claim is keyed on what was enabled before.
  await disableModel(stateRoot, catalogId);
  if (before.enabled.includes(formatted)) {
    io.stdout(`Disabled ${catalogId}\n`);
  } else {
    io.stdout(
      `${formatted} was not enabled; nothing to disable (pnpm cli models list --state-root ${stateRoot} shows the enabled models)\n`
    );
  }
  for (const role of ["primary", "fast"] as const) {
    if (before[role] !== formatted) continue;
    io.stdout(
      `note: ${formatted} was the ${role} default; the default is now unset — set a new one with pi-sparkle models set-default\n`
    );
  }
  return 0;
}

async function setDefaultCommand(args: string[], io: ModelsIo): Promise<number> {
  const parsed = parseModelsArgs(io, "models set-default", () =>
    parseArgs({
      args,
      options: {
        primary: { type: "string" },
        fast: { type: "string" },
        "state-root": { type: "string" }
      }
    })
  );
  if (!parsed.ok) return parsed.code;
  const { values } = parsed;
  if (values.primary === undefined) {
    return cliFail(io, {
      command: "models set-default",
      stage: "parse-args",
      message: "models set-default requires --primary <provider/model>",
      next: "run pi-sparkle models --help"
    });
  }
  const stateRoot = stateRootOf(values);
  if (tryParseModelRef(values.primary) === undefined) {
    return refuseMalformedId(io, "models set-default", "--primary", values.primary, stateRoot);
  }
  if (values.fast !== undefined && tryParseModelRef(values.fast) === undefined) {
    return refuseMalformedId(io, "models set-default", "--fast", values.fast, stateRoot);
  }
  // Both memberships are checked before the write: a refused --fast must leave
  // providers.json untouched, not land the --primary half of the pair.
  if ((await assertKnownCatalogId(stateRoot, values.primary)) === undefined) {
    return refuseUnknownModel(io, "models set-default", values.primary, stateRoot);
  }
  if (
    values.fast !== undefined &&
    (await assertKnownCatalogId(stateRoot, values.fast)) === undefined
  ) {
    return refuseUnknownModel(io, "models set-default", values.fast, stateRoot);
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

/**
 * A typo'd model id is argv, not configuration. `parseModelRef` used to throw
 * it out of the verb into the generic catch, where the report named `models`
 * with no subcommand and offered doctor preflight — a remedy that cannot fix a
 * mistyped positional. `tryParseModelRef` is the domain's own predicate, so the
 * shape is asked about rather than restated here.
 *
 * `label` is what the operator typed the value as: the positional
 * `<provider/model>`, or the flag `--primary` / `--fast`.
 */
function refuseMalformedId(
  io: ModelsIo,
  command: string,
  label: string,
  value: string,
  stateRoot: string
): number {
  const subject = label.startsWith("--") ? `${label} <provider/model>` : label;
  return cliFail(io, {
    command,
    stage: "parse-args",
    message: `invalid ${label} "${value}": expected a model id of the form provider/model`,
    next: `pass ${subject} as printed by pnpm cli models list --available --state-root ${stateRoot}`
  });
}

/**
 * Catalog membership is stored config plus catalog state, not CLI knowledge, so
 * this stays `validation` — but the remedy is the inventory this install can
 * actually print, not doctor preflight. The message bytes are unchanged.
 */
function refuseUnknownModel(
  io: ModelsIo,
  command: string,
  catalogId: string,
  stateRoot: string
): number {
  return cliFail(io, {
    command,
    stage: "validation",
    message: `unknown model "${catalogId}"`,
    next: `pass an id printed by pnpm cli models list --available --state-root ${stateRoot}; providers.json customProviders adds ids the builtin catalog does not have`
  });
}

/**
 * The catalog resolution for an id already known to parse, or `undefined` when
 * nothing in the builtin catalog or this state root's customProviders resolves
 * it. Returning it keeps the refusal in the verb that owns the report.
 */
async function assertKnownCatalogId(
  stateRoot: string,
  catalogId: string
): Promise<SparkleListedModel | undefined> {
  const ref = parseModelRef(catalogId);
  const config = await loadProvidersConfig(stateRoot);
  const { resolveListedModel } = await import("../pi-adapter/listed-model.js");
  return resolveListedModel(ref.providerId, ref.modelId, config.customProviders);
}
