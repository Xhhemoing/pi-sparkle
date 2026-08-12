import { DomainValidationError } from "./errors.js";

export type IsoTimestamp = string & { readonly __brand: "IsoTimestamp" };

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

export function nowIso(): IsoTimestamp {
  return new Date().toISOString() as IsoTimestamp;
}

export function isIsoTimestamp(value: unknown): value is IsoTimestamp {
  if (typeof value !== "string" || !ISO_PATTERN.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

export function parseIsoTimestamp(value: unknown): IsoTimestamp {
  if (!isIsoTimestamp(value)) {
    throw new DomainValidationError(`Invalid IsoTimestamp: ${String(value)}`);
  }
  return value;
}
