import { types } from "node:util";
import { DomainValidationError } from "../domain/errors.js";

export interface NativeWritePhaseTimeLimits { readonly workerTotalMs?: number; readonly checkTotalMs?: number; }
export interface NativeBaseCheckBudget { readonly remainingMs: number; readonly recordElapsedMs: (milliseconds: number) => void; }
function fail(reason: string): never { throw new DomainValidationError(`native phase time budget: ${reason}`); }
/** Copy host limits before any input spread or asynchronous work. */
export function prepareNativePhaseTimeLimits(input: object): NativeWritePhaseTimeLimits | undefined {
  if (types.isProxy(input)) fail("input must not be a Proxy");
  const property = Object.getOwnPropertyDescriptor(input, "phaseTimeLimits");
  if ((property === undefined && "phaseTimeLimits" in input) || (property !== undefined && !("value" in property))) fail("limits must be an own data property");
  if (property?.value === undefined) return undefined;
  const raw: unknown = property.value;
  if (raw === null || typeof raw !== "object" || types.isProxy(raw) || Array.isArray(raw) ||
      (Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null)) fail("limits must be ordinary own data");
  const limits: Record<string, number> = {};
  for (const key of Reflect.ownKeys(raw)) {
    if (key !== "workerTotalMs" && key !== "checkTotalMs") fail("unsupported limit");
    const field = Object.getOwnPropertyDescriptor(raw, key)!;
    if (!("value" in field) || !Number.isSafeInteger(field.value) || field.value < 1 || field.value > 1_800_000) fail("limits must be integers from 1 to 1800000 ms");
    limits[key] = field.value as number;
  }
  return Object.freeze(limits);
}

/** One execute owns these monotonic elapsed totals; no executor or persisted capability. */
export class NativeWriteTimeBudget {
  private workerMs = 0;
  private checkMs = 0;
  private baseReported = false;
  private baseOffered = false;
  private baseOpen = false;
  constructor(private readonly limits: NativeWritePhaseTimeLimits | undefined) {}
  remaining(phase: "worker" | "check"): number {
    const limit = phase === "worker" ? this.limits?.workerTotalMs : this.limits?.checkTotalMs;
    return limit === undefined ? Infinity : Math.floor(limit - (phase === "worker" ? this.workerMs : this.checkMs));
  }
  exhausted(): "worker" | "check" | undefined {
    return this.remaining("worker") < 1 ? "worker" : this.remaining("check") < 1 ? "check" : undefined;
  }
  charge(phase: "worker" | "check", elapsed: number): void {
    if (!Number.isFinite(elapsed) || elapsed < 0) fail("elapsed time must be finite and nonnegative");
    if (phase === "worker") this.workerMs += elapsed; else this.checkMs += elapsed;
  }
  baseCheckBudget(): NativeBaseCheckBudget | undefined {
    if (this.limits?.checkTotalMs === undefined || this.baseOffered) return undefined;
    this.baseOffered = true;
    this.baseOpen = true;
    return Object.freeze({ remainingMs: this.remaining("check"), recordElapsedMs: (milliseconds: number): void => {
      if (!this.baseOpen) fail("base check accounting is closed");
      if (this.baseReported) fail("base checks already reported");
      this.charge("check", milliseconds);
      this.baseReported = true;
    } });
  }
  closeBaseCheckBudget(): void { this.baseOpen = false; }
}
