import { readFileSync } from "node:fs";
import type { Api, Model, SimpleStreamOptions, Usage } from "@earendil-works/pi-ai";

// Read the package actually supplying calculateCost; do not invent a catalog version.
const sdkPackage: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.resolve("@earendil-works/pi-ai/models")), "utf8"));
if (sdkPackage === null || typeof sdkPackage !== "object" || !("version" in sdkPackage) || typeof sdkPackage.version !== "string") {
  throw new Error("SDK calculator package version unavailable");
}
const calculatorVersion = sdkPackage.version;
const reasons = ["stop", "length", "toolUse", "error", "aborted"] as const;
type StopReason = typeof reasons[number];
export type SdkModelCost = Readonly<Omit<Model<Api>["cost"], "tiers">> & {
  readonly tiers?: readonly Readonly<NonNullable<Model<Api>["cost"]["tiers"]>[number]>[];
};
const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Bounded numeric/identity projection only: never a transcript or restored live capability. */
export interface SdkCostObservation {
  readonly dispatchIndex: number;
  readonly provider: string;
  readonly model: string;
  /** What the host submitted to the transport, not a claim about server reasoning. */
  readonly transportReasoning?: string;
  readonly calculatorVersion: string;
  readonly modelCost: SdkModelCost;
  readonly resultProvider?: string;
  readonly resultModel?: string;
  readonly stopReason?: StopReason;
  readonly usage?: Readonly<Partial<Omit<Usage, "cost">> & { readonly cost?: Readonly<Partial<Usage["cost"]>> }>;
  readonly pricingComplete: boolean;
}
type DispatchSnapshot = Omit<SdkCostObservation, "pricingComplete" | "usage" | "resultProvider" | "resultModel" | "stopReason">;
export function captureSdkDispatch(index: number, model: Model<Api>, options: SimpleStreamOptions | undefined): DispatchSnapshot {
  const rates = (cost: Model<Api>["cost"]) => ({ input: cost.input, output: cost.output, cacheRead: cost.cacheRead, cacheWrite: cost.cacheWrite });
  const modelCost = Object.freeze({ ...rates(model.cost), ...(model.cost.tiers === undefined ? {} : {
    tiers: Object.freeze(model.cost.tiers.map(tier => Object.freeze({ inputTokensAbove: tier.inputTokensAbove, ...rates(tier) })))
  }) });
  const reasoning = options?.reasoning ?? "off";
  return Object.freeze({ dispatchIndex: index, provider: model.provider, model: model.id, calculatorVersion, modelCost,
    ...(levels.includes(reasoning) ? { transportReasoning: reasoning } : {}) });
}
export function finishSdkDispatch(snapshot: DispatchSnapshot, message: unknown, pricingComplete: boolean): SdkCostObservation {
  const row = object(message) ? message : {};
  const rawUsage = object(row.usage) ? row.usage : undefined;
  const numeric = (raw: Record<string, unknown>, keys: readonly string[]) => Object.fromEntries(keys.flatMap(key =>
    typeof raw[key] === "number" && Number.isFinite(raw[key]) ? [[key, raw[key]]] : []));
  const usage = rawUsage === undefined ? undefined : Object.freeze({
    ...numeric(rawUsage, ["input", "output", "cacheRead", "cacheWrite", "cacheWrite1h", "totalTokens"]),
    ...(object(rawUsage.cost) ? { cost: Object.freeze(numeric(rawUsage.cost, ["input", "output", "cacheRead", "cacheWrite", "total"])) } : {})
  });
  const identity = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 1024;
  return Object.freeze({ ...snapshot, pricingComplete,
    ...(identity(row.provider) ? { resultProvider: row.provider } : {}), ...(identity(row.model) ? { resultModel: row.model } : {}),
    ...(reasons.includes(row.stopReason as StopReason) ? { stopReason: row.stopReason as StopReason } : {}),
    ...(usage === undefined ? {} : { usage }) });
}
