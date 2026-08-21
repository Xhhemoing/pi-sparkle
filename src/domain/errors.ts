export class DomainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainValidationError";
  }
}

export interface RoutingRefusal {
  readonly modelId: string;
  readonly constraint: string;
  readonly detail: string;
}

export class RoutingRefusalError extends DomainValidationError {
  readonly refusals: readonly RoutingRefusal[];

  constructor(message: string, refusals: readonly RoutingRefusal[]) {
    super(message);
    this.name = "RoutingRefusalError";
    this.refusals = refusals;
  }
}
