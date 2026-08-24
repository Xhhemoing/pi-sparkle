import type { Api, Model } from "@earendil-works/pi-ai";
import type { CustomProviderConfig } from "../config/providers-config.js";
import { fromPiModel, listedModelsFromCustom, type SparkleListedModel } from "./listed-model-common.js";

/**
 * Async twin of `resolveListedModel` for hot command paths (the calibrated
 * live-catalog build behind `run --children` / `run --track` /
 * `run --flowchart`). Instead of the whole `@earendil-works/pi-ai/providers/all`
 * module graph (~40 provider modules with auth/API machinery), it imports only
 * the queried provider's generated model table (`providers/<id>.models`, a
 * public exported subpath that holds pure data). The full catalog stays the
 * authoritative source: any per-provider miss falls back to
 * `providers/all.getBuiltinModel`, so results are identical by construction —
 * `MODELS[provider]` in the generated catalog is the same object as the
 * per-provider module's `*_MODELS` export (verified exhaustively per pi-ai
 * version by scripts/round07-r7i-equivalence-sim.ts).
 */

type BuiltinModelTable = Readonly<Record<string, Model<Api>>>;

async function builtinModelLazy(providerId: string, modelId: string): Promise<Model<Api> | undefined> {
  try {
    const ns = (await import(
      `@earendil-works/pi-ai/providers/${providerId}.models`
    )) as Record<string, unknown>;
    const tables = Object.keys(ns).filter((key) => key.endsWith("_MODELS"));
    if (tables.length === 1) {
      return (ns[tables[0]!] as BuiltinModelTable)[modelId];
    }
  } catch {
    // Unknown provider id, custom provider id, or a future pi-ai layout that
    // no longer ships per-provider tables: consult the authoritative catalog.
  }
  // Deliberately outside the catch: if providers/all itself cannot load, the
  // failure must surface exactly like today's static edge in listed-model.ts.
  const { getBuiltinModel } = await import("@earendil-works/pi-ai/providers/all");
  return getBuiltinModel(providerId as never, modelId as never);
}

/** Same result surface as `resolveListedModel`, without loading providers/all on builtin hits. */
export async function resolveListedModelLazy(
  providerId: string,
  modelId: string,
  customProviders: readonly CustomProviderConfig[] = []
): Promise<SparkleListedModel | undefined> {
  const model = await builtinModelLazy(providerId, modelId);
  let builtin: SparkleListedModel | undefined;
  try {
    builtin = model !== undefined ? fromPiModel(model) : undefined;
  } catch {
    builtin = undefined;
  }
  if (builtin !== undefined) return builtin;
  const custom = customProviders.find((item) => item.id === providerId);
  if (custom === undefined) return undefined;
  return listedModelsFromCustom(custom).find((item) => item.modelId === modelId);
}
