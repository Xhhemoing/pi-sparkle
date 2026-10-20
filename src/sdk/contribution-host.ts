import type { ContextData, ContributionDeclaration, ContributionDefinition, ContributionHost, ContributionHostOptions, ContributionPlugin, ContributionRequest, ContributionResult, DiagnosticData } from "./host.js";

type Unavailable = Extract<ContributionResult<never>, { status: "unavailable" }>;
const unavailable = (reason: Unavailable["reason"]): Unavailable => Object.freeze({ status: "unavailable", reason });
function text(value: unknown, maximum: number, empty = false): string {
  if (typeof value !== "string" || value.length > maximum || (!empty && !value.trim())) throw new Error("Invalid contribution data");
  return value;
}
function list<T>(value: readonly T[], maximum: number): readonly T[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error("Invalid contribution list");
  return value;
}
function declaration(value: ContributionDeclaration): ContributionDeclaration {
  const { kind, id } = value;
  if (kind !== "context" && kind !== "diagnostic") throw new Error("Invalid contribution kind");
  return Object.freeze({ kind, id: text(id, 128) });
}
function definitions(values: readonly ContributionDefinition[], expected?: readonly ContributionDeclaration[]): Map<string, ContributionDefinition> {
  const staged = new Map<string, ContributionDefinition>();
  for (const value of list(values, 128)) {
    const entry = declaration(value);
    if (staged.has(entry.id)) throw new Error("Duplicate contribution id");
    if (entry.kind === "context") {
      const provide = (value as Extract<ContributionDefinition, { kind: "context" }>).provide;
      if (typeof provide !== "function") throw new Error("Invalid contribution callback");
      staged.set(entry.id, Object.freeze({ ...entry, kind: "context", provide }));
    } else {
      const diagnose = (value as Extract<ContributionDefinition, { kind: "diagnostic" }>).diagnose;
      if (typeof diagnose !== "function") throw new Error("Invalid contribution callback");
      staged.set(entry.id, Object.freeze({ ...entry, kind: "diagnostic", diagnose }));
    }
  }
  if (expected && (staged.size !== expected.length || expected.some((entry) => staged.get(entry.id)?.kind !== entry.kind))) throw new Error("Contribution declaration mismatch");
  return staged;
}
function snapshotRequest(value: ContributionRequest, generationId: string): ContributionRequest {
  if (value.generationId !== generationId) throw new Error("Generation mismatch");
  return Object.freeze({ generationId, revision: text(value.revision, 256), objective: text(value.objective, 16_384), selectedFiles: Object.freeze(list(value.selectedFiles, 64).map((file) => {
    const { path, revision } = file;
    return Object.freeze({ path: text(path, 1024), ...(revision === undefined ? {} : { revision: text(revision, 256) }) });
  })) });
}
function snapshotContext(value: ContextData): ContextData {
  let size = 0;
  const items = list(value.items, 64).map((item) => {
    const { text: itemText, source } = item;
    const entry = { text: text(itemText, 32_768, true), ...(source === undefined ? {} : { source: text(source, 1024) }) };
    size += entry.text.length + (entry.source?.length ?? 0);
    return Object.freeze(entry);
  });
  if (size > 65_536) throw new Error("Contribution output too large");
  return Object.freeze({ items: Object.freeze(items) });
}
function snapshotDiagnostic(value: DiagnosticData): DiagnosticData {
  let size = 0;
  const findings = list(value.findings, 64).map((item) => {
    const { severity, message, path } = item;
    if (severity !== "info" && severity !== "warning" && severity !== "error") throw new Error("Invalid diagnostic severity");
    const entry = { severity, message: text(message, 32_768), ...(path === undefined ? {} : { path: text(path, 1024) }) };
    size += entry.message.length + (entry.path?.length ?? 0);
    return Object.freeze(entry);
  });
  if (size > 65_536) throw new Error("Contribution output too large");
  return Object.freeze({ findings: Object.freeze(findings) });
}

/** One immutable generation. Plugins are trusted Node code, not a sandbox. */
export function createContributionHost(options: ContributionHostOptions): ContributionHost {
  const generationId = text(options.generationId, 128);
  const capabilities = Object.freeze(list(options.capabilities, 128).map((value) => text(value, 128)));
  const lifetime = new AbortController();
  const published = definitions(options.core ?? []);
  const declared = new Set(published.keys());
  const owners = new Map<string, ContributionPlugin>();
  const pluginIds = new Set<string>();
  for (const input of list(options.plugins, 128)) {
    const { id: inputId, enabled, apiVersion, requiredCapabilities, contributions, load } = input;
    const id = text(inputId, 128);
    if (pluginIds.has(id)) throw new Error("Duplicate plugin id");
    pluginIds.add(id);
    if (typeof enabled !== "boolean" || !Number.isInteger(apiVersion) || typeof load !== "function") throw new Error("Invalid plugin manifest");
    const plugin: ContributionPlugin = Object.freeze({ id, enabled, apiVersion, requiredCapabilities: Object.freeze(list(requiredCapabilities, 128).map((capability) => text(capability, 128))), contributions: Object.freeze(list(contributions, 128).map(declaration)), load });
    for (const entry of plugin.contributions) {
      if (declared.has(entry.id)) throw new Error("Duplicate contribution id");
      declared.add(entry.id); owners.set(entry.id, plugin);
    }
  }
  const activations = new Map<string, Promise<boolean>>();
  const pending = new Set<Promise<unknown>>();
  let closed = false;
  let closing: Promise<void> | undefined;
  const environment = Object.freeze({ generationId, capabilities, signal: lifetime.signal });
  function activate(plugin: ContributionPlugin): Promise<boolean> {
    let activation = activations.get(plugin.id);
    if (!activation) {
      activation = Promise.resolve().then(async () => {
        if (closed) return false;
        const staged = definitions(await plugin.load(environment), plugin.contributions);
        if (closed) return false;
        for (const [id, definition] of staged) published.set(id, definition);
        return true;
      }).catch(() => false);
      activations.set(plugin.id, activation);
    }
    return activation;
  }
  function invoke<T>(kind: "context" | "diagnostic", id: string, input: ContributionRequest, signal: AbortSignal | undefined, snapshot: (value: ContextData | DiagnosticData) => T): Promise<ContributionResult<T>> {
    if (closed) return Promise.resolve(unavailable("closed"));
    if (signal?.aborted) return Promise.resolve(unavailable("aborted"));
    let request: ContributionRequest;
    try { request = snapshotRequest(input, generationId); }
    catch { return Promise.resolve(unavailable("invalid-request")); }
    const operation = Promise.resolve().then(async (): Promise<ContributionResult<T>> => {
      try {
        if (closed) return unavailable("closed");
        const plugin = owners.get(id);
        if (plugin) {
          if (!plugin.contributions.some((entry) => entry.id === id && entry.kind === kind)) return unavailable("missing");
          if (!plugin.enabled || plugin.apiVersion !== 1 || plugin.requiredCapabilities.some((capability) => !capabilities.includes(capability))) return unavailable("incompatible");
          if (!await activate(plugin)) return unavailable(closed ? "closed" : "activation-failed");
        }
        if (closed) return unavailable("closed");
        if (signal?.aborted) return unavailable("aborted");
        const definition = published.get(id);
        if (!definition || definition.kind !== kind) return unavailable("missing");
        const invocationSignal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
        const value = definition.kind === "context" ? await definition.provide(request, invocationSignal) : await definition.diagnose(request, invocationSignal);
        if (closed) return unavailable("closed");
        if (signal?.aborted) return unavailable("aborted");
        const copiedValue = snapshot(value);
        if (closed) return unavailable("closed");
        if (signal?.aborted) return unavailable("aborted");
        return Object.freeze({ status: "available", generationId, revision: request.revision, value: copiedValue });
      } catch { return unavailable(closed ? "closed" : signal?.aborted ? "aborted" : "failed"); }
    });
    pending.add(operation);
    void operation.then(() => pending.delete(operation));
    if (!signal) return operation;
    return new Promise((resolve) => {
      const abort = () => resolve(unavailable("aborted"));
      signal.addEventListener("abort", abort, { once: true });
      void operation.then((result) => { signal.removeEventListener("abort", abort); resolve(result); });
      if (signal.aborted) abort();
    });
  }
  return Object.freeze({
    generationId, capabilities,
    context: (id: string, request: ContributionRequest, signal?: AbortSignal) => invoke("context", id, request, signal, (value) => snapshotContext(value as ContextData)),
    diagnose: (id: string, request: ContributionRequest, signal?: AbortSignal) => invoke("diagnostic", id, request, signal, (value) => snapshotDiagnostic(value as DiagnosticData)),
    close: () => {
      if (!closing) {
        closed = true; lifetime.abort();
        closing = Promise.allSettled([...pending]).then(() => undefined);
      }
      return closing;
    },
  });
}
