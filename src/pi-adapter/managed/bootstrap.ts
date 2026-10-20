// This fresh-process bootstrap must load only Node builtins before installing
// the boundary. Do not add application helpers or third-party static imports.
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { createRequire, isBuiltin, registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

interface EngineVersions {
  readonly core: string;
  readonly ai: string;
}

function inside(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function physicalRoot(value: string): string {
  const requested = path.resolve(value);
  let cursor = path.parse(requested).root;
  for (const component of requested.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    const entry = lstatSync(cursor);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("managed generation directory alias refused");
  }
  return realpathSync.native(requested);
}

/**
 * Install synchronous checks for ESM, dynamic import and CJS/createRequire.
 * Both resolution and pre-load checks run before outside code can evaluate.
 * This does not restrict direct filesystem/network access, native code,
 * workers/custom loaders or a malicious concurrent filesystem writer.
 * The hook intentionally remains installed for the lifetime of this process.
 */
function installBoundary(root: string): void {
  const check = (url: string): void => {
    if (isBuiltin(url)) return;
    if (!url.startsWith("file:")) throw new Error(`unsupported module URL in managed generation: ${url}`);
    const canonical = realpathSync.native(fileURLToPath(url));
    if (!inside(canonical, root)) throw new Error(`module outside managed generation refused: ${canonical}`);
  };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const result = nextResolve(specifier, context);
      check(result.url);
      return result;
    },
    load(url, context, nextLoad) {
      check(url);
      return nextLoad(url, context);
    }
  });
}

function readManifest(file: string, root: string): Record<string, unknown> {
  const canonical = realpathSync.native(file);
  if (!inside(canonical, root)) throw new Error(`manifest outside managed generation refused: ${canonical}`);
  const value: unknown = JSON.parse(readFileSync(canonical, "utf8"));
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid managed manifest");
  return value as Record<string, unknown>;
}

function checkVersions(root: string, expected: EngineVersions): void {
  const app = path.join(root, "app");
  const manifest = readManifest(path.join(root, "candidate.json"), root);
  if (manifest.generationId !== path.basename(root)) throw new Error("managed generation identity mismatch");
  const recorded = manifest.versions as Partial<EngineVersions> | undefined;
  const application = readManifest(path.join(app, "package.json"), root);
  const dependencies = application.dependencies as Record<string, unknown> | undefined;
  for (const [key, name] of [
    ["core", "@earendil-works/pi-agent-core"], ["ai", "@earendil-works/pi-ai"]
  ] as const) {
    const version = expected[key];
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
      throw new Error("managed expected engine version must be literal");
    }
    if (recorded?.[key] !== version || dependencies?.[name] !== version) throw new Error(`managed ${key} version mismatch`);
    // Entries may be ESM-only and package.json may not be exported. Resolve
    // manifest search paths without requiring or evaluating the package entry.
    const paths = createRequire(path.join(app, "package.json")).resolve.paths(name) ?? [];
    let engine: Record<string, unknown> | undefined;
    for (const location of paths) {
      const file = path.join(location, name, "package.json");
      try {
        engine = readManifest(file, root);
        break;
      } catch (error: unknown) {
        if (error !== null && typeof error === "object" && "code" in error &&
            (error.code === "ENOENT" || error.code === "ENOTDIR")) continue;
        throw error;
      }
    }
    if (engine?.name !== name || engine.version !== version) throw new Error(`managed installed ${key} version mismatch`);
  }
}

/**
 * Enter actual copied application code only after checking physical containment
 * and exact installed engine manifests. Lifecycle metadata is not qualification.
 * Call once in a fresh child; loaded module caches must not predate the hook.
 */
export async function loadManagedCandidateEntry(
  generationRoot: string,
  entryInDist: string,
  expectedVersions: EngineVersions
): Promise<Record<string, unknown>> {
  const root = physicalRoot(generationRoot);
  const ownFile = realpathSync.native(fileURLToPath(import.meta.url));
  if (!inside(ownFile, root)) throw new Error("managed bootstrap outside managed generation refused");
  installBoundary(root);
  checkVersions(root, expectedVersions);
  const dist = path.join(root, "app/dist");
  const entry = path.resolve(dist, entryInDist);
  if (!inside(entry, dist)) throw new Error("managed entry outside app dist refused");
  return await import(pathToFileURL(entry).href) as Record<string, unknown>;
}

if (process.argv[1] !== undefined && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [root, entry, core, ai] = process.argv.slice(2);
  if (root === undefined || entry === undefined || core === undefined || ai === undefined) {
    process.stderr.write("usage: managed-bootstrap generation-root entry-in-dist core-version ai-version\n");
    process.exitCode = 1;
  } else {
    await loadManagedCandidateEntry(root, entry, { core, ai }).catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
  }
}
