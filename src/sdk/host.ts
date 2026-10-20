/** Read-only observations from trusted, same-process contribution code. */
export interface ContributionRequest {
  readonly generationId: string;
  readonly revision: string;
  readonly objective: string;
  readonly selectedFiles: readonly { readonly path: string; readonly revision?: string }[];
}
export interface ContextData {
  readonly items: readonly { readonly text: string; readonly source?: string }[];
}
export interface DiagnosticData {
  readonly findings: readonly { readonly severity: "info" | "warning" | "error"; readonly message: string; readonly path?: string }[];
}
export type ContributionResult<T> =
  | { readonly status: "available"; readonly generationId: string; readonly revision: string; readonly value: T }
  | { readonly status: "unavailable"; readonly reason: "missing" | "incompatible" | "activation-failed" | "invalid-request" | "failed" | "aborted" | "closed" };
export interface ContributionDeclaration { readonly kind: "context" | "diagnostic"; readonly id: string }
export type ContributionDefinition =
  | { readonly kind: "context"; readonly id: string; readonly provide: (request: ContributionRequest, signal: AbortSignal) => Promise<ContextData> }
  | { readonly kind: "diagnostic"; readonly id: string; readonly diagnose: (request: ContributionRequest, signal: AbortSignal) => Promise<DiagnosticData> };
export interface ContributionEnvironment {
  readonly generationId: string;
  readonly capabilities: readonly string[];
  readonly signal: AbortSignal;
}
export interface ContributionPlugin {
  readonly id: string;
  readonly enabled: boolean;
  readonly apiVersion: number;
  readonly requiredCapabilities: readonly string[];
  readonly contributions: readonly ContributionDeclaration[];
  readonly load: (environment: ContributionEnvironment) => Promise<readonly ContributionDefinition[]>;
}
export interface ContributionHostOptions {
  readonly generationId: string;
  readonly capabilities: readonly string[];
  readonly plugins: readonly ContributionPlugin[];
  readonly core?: readonly ContributionDefinition[];
}
export interface ContributionHost {
  readonly generationId: string;
  readonly capabilities: readonly string[];
  context(id: string, request: ContributionRequest, signal?: AbortSignal): Promise<ContributionResult<ContextData>>;
  diagnose(id: string, request: ContributionRequest, signal?: AbortSignal): Promise<ContributionResult<DiagnosticData>>;
  /** Stops admission and waits for actual settlement, including lazy activation. */
  close(): Promise<void>;
}
export { createContributionHost } from "./contribution-host.js";
