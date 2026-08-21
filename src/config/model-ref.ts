import { DomainValidationError } from "../domain/errors.js";

export interface ModelRef {
  readonly providerId: string;
  readonly modelId: string;
}

export function formatModelRef(providerId: string, modelId: string): string {
  const provider = providerId.trim();
  const model = modelId.trim();
  if (provider === "" || model === "") {
    throw new DomainValidationError("providerId and modelId must be non-empty");
  }
  if (provider.includes("/")) {
    throw new DomainValidationError(`providerId must not contain '/': ${provider}`);
  }
  return `${provider}/${model}`;
}

export function tryParseModelRef(value: string): ModelRef | undefined {
  const trimmed = value.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) return undefined;
  return {
    providerId: trimmed.slice(0, slash),
    modelId: trimmed.slice(slash + 1)
  };
}

export function parseModelRef(value: string): ModelRef {
  const parsed = tryParseModelRef(value);
  if (parsed === undefined) {
    throw new DomainValidationError(
      `model id must be provider/model (got ${JSON.stringify(value)})`
    );
  }
  return parsed;
}
