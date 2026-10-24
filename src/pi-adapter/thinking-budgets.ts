import { types } from "node:util";
import { DomainValidationError } from "../domain/errors.js";

/** The pinned SDK's four optional token-budget numbers; provider interpretation stays with Pi. */
export interface SparkleThinkingBudgets { readonly minimal?: number; readonly low?: number; readonly medium?: number; readonly high?: number; }
function fail(): never { throw new DomainValidationError("thinkingBudgets must contain only finite own-data minimal/low/medium/high numbers"); }
export function snapshotThinkingBudgets(value: unknown): SparkleThinkingBudgets | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || types.isProxy(value) || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const copied: Record<string, number> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (key !== "minimal" && key !== "low" && key !== "medium" && key !== "high") fail();
    const field = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in field) || typeof field.value !== "number" || !Number.isFinite(field.value)) fail();
    copied[key] = field.value as number;
  }
  return Object.freeze(copied);
}
/** Read the optional budget property without invoking an accessor or inherited field. */
export function captureThinkingBudgets(input: object): SparkleThinkingBudgets | undefined {
  if (types.isProxy(input)) fail();
  const field = Object.getOwnPropertyDescriptor(input, "thinkingBudgets");
  if ((field === undefined && "thinkingBudgets" in input) || (field !== undefined && !("value" in field))) fail();
  return snapshotThinkingBudgets(field?.value);
}
