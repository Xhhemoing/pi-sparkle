import { DomainValidationError } from "../domain/errors.js";
import type { ProjectId, EpisodeId } from "../domain/ids.js";
import type { IsoTimestamp } from "../domain/timestamp.js";
import { hash32 } from "../domain/hash.js";
import type { ProjectSnapshot } from "../domain/project.js";

export type FactTrust = "HIGH" | "MEDIUM" | "LOW" | "unavailable";
export type FactFreshness = "fresh" | "stale" | "unavailable";

export interface ContextFact {
  readonly key: string;
  readonly value: string;
  readonly trust: FactTrust;
  readonly sourceHash: string;
  readonly freshness: FactFreshness;
}

export interface CodeMapSymbol {
  readonly path: string;
  readonly symbol: string;
  readonly kind: "class" | "function" | "interface" | "type" | "method" | "module";
  readonly public: boolean;
  readonly calls: readonly string[];
}

export interface CodeMapEntry {
  readonly path: string;
  readonly symbol: string;
  readonly kind: CodeMapSymbol["kind"];
  readonly public: boolean;
  readonly calls: readonly string[];
}

export interface CodeMapOmission {
  readonly path: string;
  readonly symbol: string;
  readonly reason: "token-budget";
  readonly rank: number;
}

export interface CodeMapView {
  readonly schemaVersion: 1;
  readonly tokenBudget: number;
  readonly estimatedTokens: number;
  readonly entries: readonly CodeMapEntry[];
  readonly omissions: readonly CodeMapOmission[];
}

/**
 * Instruction precedence: closer-to-root first (fewer path segments relative
 * to `ProjectSnapshot.rootPath`), then lexicographic by normalized path.
 * Nested instruction files therefore lose to root-level ones.
 */
export interface InstructionOwner {
  readonly path: string;
  /** "root" for files directly under the project root, "nested" otherwise. */
  readonly owner: "root" | "nested";
  /** Directory whose rules this file owns: "." for root-level files. */
  readonly scope: string;
  /** 1-based rank in the same order as `instructionPrecedence`. */
  readonly precedence: number;
}

export interface ProjectContextIndex {
  readonly projectId: ProjectId;
  readonly episodeId?: EpisodeId | undefined;
  readonly lastUpdated: IsoTimestamp;
  readonly manifests: Record<string, string>;
  readonly architecture: string[];
  readonly tests: string[];
  readonly risks: string[];
  readonly priorEpisodes: EpisodeId[];
  readonly schemaVersion: 1;
  readonly facts: readonly ContextFact[];
  readonly instructionPrecedence: readonly string[];
  readonly instructionOwnership: readonly InstructionOwner[];
  readonly validationRoutes: readonly string[];
  readonly generatedHints: readonly string[];
  readonly dirtyUnrelated: readonly string[];
  readonly codeMap: CodeMapView;
}

export interface BuildProjectContextIndexOptions {
  readonly dirtyPaths?: readonly string[] | undefined;
  readonly generatedPaths?: readonly string[] | undefined;
  readonly sourceHashes?: Readonly<Record<string, string>> | undefined;
  readonly priorHashes?: Readonly<Record<string, string>> | undefined;
  readonly codeMap?: readonly CodeMapSymbol[] | undefined;
  readonly codeMapTokenBudget?: number | undefined;
  readonly now?: IsoTimestamp | undefined;
}

const DEFAULT_CODE_MAP_TOKEN_BUDGET = 2000;

const TEST_ROUTE_KEY = "validation.route:test";

export function createEmptyContext(projectId: ProjectId, ts: IsoTimestamp): ProjectContextIndex {
  return {
    projectId,
    lastUpdated: ts,
    manifests: {},
    architecture: [],
    tests: [],
    risks: [],
    priorEpisodes: [],
    schemaVersion: 1,
    facts: [],
    instructionPrecedence: [],
    instructionOwnership: [],
    validationRoutes: [],
    generatedHints: [],
    dirtyUnrelated: [],
    codeMap: {
      schemaVersion: 1,
      tokenBudget: DEFAULT_CODE_MAP_TOKEN_BUDGET,
      estimatedTokens: 0,
      entries: [],
      omissions: []
    }
  };
}

export function buildProjectContextIndex(
  snapshot: ProjectSnapshot,
  options: BuildProjectContextIndexOptions = {}
): ProjectContextIndex {
  const generatedPaths = uniquePreserve(options.generatedPaths ?? []);
  const dirtyPaths = uniquePreserve(options.dirtyPaths ?? []);
  const generatedHints = [...generatedPaths].sort(compareStrings);
  const dirtyUnrelated = dirtyPaths
    .filter((path) => !generatedPaths.some((generated) => isUnderGenerated(path, generated, snapshot.rootPath)))
    .slice()
    .sort(compareStrings);

  const instructionPrecedence = [...snapshot.instructionFiles]
    .map((file) => file.path)
    .sort((a, b) => compareInstructionPaths(snapshot.rootPath, a, b));
  const instructionOwnership = resolveInstructionOwnership(snapshot.rootPath, instructionPrecedence);

  const architecture = snapshot.facts
    .filter((fact) => fact.key.startsWith("architecture."))
    .sort((a, b) => compareStrings(a.key, b.key))
    .map((fact) => fact.value);
  const risks = snapshot.facts
    .filter((fact) => fact.key.startsWith("risk."))
    .sort((a, b) => compareStrings(a.key, b.key))
    .map((fact) => fact.value);

  const validationRoutes = snapshot.commands.map((command) => command.name);
  const codeMap = compileCodeMap(
    options.codeMap ?? [],
    options.codeMapTokenBudget ?? DEFAULT_CODE_MAP_TOKEN_BUDGET
  );

  const facts: ContextFact[] = [];

  for (const file of snapshot.instructionFiles) {
    facts.push(fileFact("instruction", file.path, snapshot.rootPath, options));
  }
  for (const file of snapshot.manifests) {
    facts.push(fileFact("manifest", file.path, snapshot.rootPath, options));
  }
  for (const command of snapshot.commands) {
    const key = `validation.route:${command.name}`;
    facts.push(
      sourcedFact(key, command.command, commandSourceKey(snapshot, command.name), "HIGH", options)
    );
  }

  const hasTestRoute = snapshot.commands.some((command) => command.name === "test");
  if (!hasTestRoute) {
    facts.push({
      key: TEST_ROUTE_KEY,
      value: "unavailable",
      trust: "unavailable",
      sourceHash: hash32(TEST_ROUTE_KEY),
      freshness: "unavailable"
    });
  }

  for (const fact of snapshot.facts) {
    facts.push(sourcedFact(fact.key, fact.value, fact.key, fact.confidence, options));
  }

  const manifests: Record<string, string> = {};
  for (const file of snapshot.manifests) {
    manifests[file.path] = resolveHash(file.path, relativeToRoot(snapshot.rootPath, file.path), options) ??
      hash32(`${file.path}\0`);
  }

  const testCommand = snapshot.commands.find((command) => command.name === "test");
  const tests = testCommand !== undefined ? [testCommand.command] : [];

  return {
    projectId: snapshot.id,
    lastUpdated: options.now ?? snapshot.discoveredAt,
    manifests,
    architecture,
    tests,
    risks,
    priorEpisodes: [],
    schemaVersion: 1,
    facts,
    instructionPrecedence,
    instructionOwnership,
    validationRoutes,
    generatedHints,
    dirtyUnrelated,
    codeMap
  };
}

function compileCodeMap(symbols: readonly CodeMapSymbol[], tokenBudget: number): CodeMapView {
  if (!Number.isInteger(tokenBudget) || tokenBudget < 0) {
    throw new DomainValidationError("codeMapTokenBudget must be an integer >= 0");
  }

  const ranked = symbols
    .map((entry) => ({
      entry: {
        path: entry.path,
        symbol: entry.symbol,
        kind: entry.kind,
        public: entry.public,
        calls: [...new Set(entry.calls)].sort(compareStrings)
      },
      rank: entry.public ? 1 : 2
    }))
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      const path = compareStrings(a.entry.path, b.entry.path);
      if (path !== 0) return path;
      const symbol = compareStrings(a.entry.symbol, b.entry.symbol);
      if (symbol !== 0) return symbol;
      return compareStrings(a.entry.kind, b.entry.kind);
    });

  const entries: CodeMapEntry[] = [];
  const omissions: CodeMapOmission[] = [];
  let estimatedTokens = 0;
  for (const item of ranked) {
    const cost = estimateCodeMapTokens(item.entry);
    if (estimatedTokens + cost <= tokenBudget) {
      entries.push(item.entry);
      estimatedTokens += cost;
    } else {
      omissions.push({
        path: item.entry.path,
        symbol: item.entry.symbol,
        reason: "token-budget",
        rank: item.rank
      });
    }
  }

  return {
    schemaVersion: 1,
    tokenBudget,
    estimatedTokens,
    entries,
    omissions
  };
}

function estimateCodeMapTokens(entry: CodeMapEntry): number {
  const compact = `${entry.path}:${entry.symbol}(${entry.kind})${entry.public ? " public" : ""} calls=${entry.calls.join(",")}`;
  return Math.max(1, Math.ceil(compact.length / 4));
}

function fileFact(
  kind: "instruction" | "manifest",
  path: string,
  rootPath: string,
  options: BuildProjectContextIndexOptions
): ContextFact {
  const relative = relativeToRoot(rootPath, path);
  const key = `${kind}:${relative}`;
  return sourcedFact(key, path, path, "HIGH", options, relative);
}

function commandSourceKey(snapshot: ProjectSnapshot, commandName: string): string {
  const packageJson = snapshot.manifests.find((file) => {
    const normalized = normalizePath(file.path);
    return normalized === "package.json" || normalized.endsWith("/package.json");
  });
  return packageJson?.path ?? `validation.route:${commandName}`;
}

function sourcedFact(
  key: string,
  value: string,
  sourceKey: string,
  trust: Exclude<FactTrust, "unavailable">,
  options: BuildProjectContextIndexOptions,
  alternateKey?: string
): ContextFact {
  const current =
    resolveHash(sourceKey, alternateKey, options, key) ?? hash32(`${sourceKey}\0${value}`);
  const prior = resolveFromMap(options.priorHashes, sourceKey, alternateKey, key);
  const providedCurrent = resolveFromMap(options.sourceHashes, sourceKey, alternateKey, key);
  let freshness: FactFreshness = "fresh";
  if (prior !== undefined && providedCurrent !== undefined && prior !== providedCurrent) {
    freshness = "stale";
  } else if (prior !== undefined && prior !== current) {
    freshness = "stale";
  }
  return { key, value, trust, sourceHash: current, freshness };
}

function resolveHash(
  sourceKey: string,
  alternateKey: string | undefined,
  options: BuildProjectContextIndexOptions,
  factKey?: string
): string | undefined {
  return resolveFromMap(options.sourceHashes, sourceKey, alternateKey, factKey);
}

function resolveFromMap(
  map: Readonly<Record<string, string>> | undefined,
  sourceKey: string,
  alternateKey?: string,
  factKey?: string
): string | undefined {
  if (map === undefined) return undefined;
  if (map[sourceKey] !== undefined) return map[sourceKey];
  if (alternateKey !== undefined && map[alternateKey] !== undefined) return map[alternateKey];
  if (factKey !== undefined && map[factKey] !== undefined) return map[factKey];
  return undefined;
}

function uniquePreserve(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function relativeToRoot(rootPath: string, filePath: string): string {
  const root = normalizePath(rootPath);
  const path = normalizePath(filePath);
  if (path === root) return "";
  if (root !== "" && path.startsWith(`${root}/`)) return path.slice(root.length + 1);
  return path;
}

function pathDepth(rootPath: string, filePath: string): number {
  const relative = relativeToRoot(rootPath, filePath);
  if (relative === "") return 0;
  return relative.split("/").filter((segment) => segment.length > 0).length;
}

function compareInstructionPaths(rootPath: string, a: string, b: string): number {
  const depthDelta = pathDepth(rootPath, a) - pathDepth(rootPath, b);
  if (depthDelta !== 0) return depthDelta;
  return compareStrings(normalizePath(a), normalizePath(b));
}

function isPathInside(child: string, parent: string): boolean {
  const c = normalizePath(child);
  const p = normalizePath(parent);
  if (p === "") return false;
  return c === p || c.startsWith(`${p}/`);
}

function isUnderGenerated(dirty: string, generated: string, rootPath: string): boolean {
  if (isPathInside(dirty, generated)) return true;
  const dirtyRel = relativeToRoot(rootPath, dirty);
  const generatedRel = relativeToRoot(rootPath, generated);
  return isPathInside(dirtyRel, generatedRel);
}

function resolveInstructionOwnership(rootPath: string, orderedPaths: readonly string[]): InstructionOwner[] {
  return orderedPaths.map((path, position) => {
    const relative = relativeToRoot(rootPath, path);
    const segments = relative.split("/").filter((segment) => segment.length > 0);
    const owner: InstructionOwner["owner"] = segments.length <= 1 ? "root" : "nested";
    const scope = segments.length <= 1 ? "." : segments.slice(0, -1).join("/");
    return { path, owner, scope, precedence: position + 1 };
  });
}

/**
 * Incremental refresh: rebuild derived views from the frozen project inputs
 * while carrying accumulated state (`priorEpisodes`) forward and marking
 * facts stale when their source hash differs from the prior index.
 * Deterministic: same prior + same inputs produce deep-equal output.
 */
export function refreshProjectContextIndex(
  prior: ProjectContextIndex,
  snapshot: ProjectSnapshot,
  options: BuildProjectContextIndexOptions = {}
): ProjectContextIndex {
  const rebuilt = buildProjectContextIndex(snapshot, options);
  const priorHashes = new Map(prior.facts.map((fact) => [fact.key, fact.sourceHash]));
  const facts = rebuilt.facts.map((fact) => {
    const before = priorHashes.get(fact.key);
    if (before !== undefined && before !== fact.sourceHash && fact.freshness === "fresh") {
      return { ...fact, freshness: "stale" as const };
    }
    return fact;
  });
  return { ...rebuilt, facts, priorEpisodes: [...prior.priorEpisodes] };
}
