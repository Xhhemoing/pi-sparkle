import { randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { DomainValidationError } from "../../domain/errors.js";
import { isPathInside } from "../../execution/paths.js";
import { physicalDirectoryWithoutLinks } from "../../native/physical-directory.js";
import { writeFileAtomic } from "../../persist/atomic-file.js";

const enginePackages = {
  core: "@earendil-works/pi-agent-core",
  ai: "@earendil-works/pi-ai"
} as const;

export interface ManagedCandidateVersions {
  readonly core: string;
  readonly ai: string;
}

export interface StageManagedCandidateOptions {
  /** Physical package root; the caller must build dist before staging. */
  readonly programRoot: string;
  /** Existing physical manager-owned parent; staging never replaces a generation. */
  readonly generationsRoot: string;
  readonly expectedVersions: ManagedCandidateVersions;
}

export interface ManagedCandidate {
  readonly generationId: string;
  readonly root: string;
  readonly appRoot: string;
  readonly versions: ManagedCandidateVersions;
}

interface PackageManifest {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

interface PackageNode {
  readonly id: string;
  readonly root: string;
  readonly manifest: PackageManifest;
  readonly edges: Map<string, PackageNode>;
}

function packageName(name: string): void {
  if (!/^(?:@[a-zA-Z0-9_~-][a-zA-Z0-9._~-]*\/)?[a-zA-Z0-9_~-][a-zA-Z0-9._~-]*$/.test(name)) {
    throw new DomainValidationError(`invalid package name: ${name}`);
  }
}

function exactVersion(version: string): void {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new DomainValidationError(`managed Pi version must be literal: ${version}`);
  }
}

async function manifestAt(root: string): Promise<PackageManifest> {
  const file = path.join(root, "package.json");
  if ((await lstat(file)).isSymbolicLink()) throw new DomainValidationError(`package manifest link refused: ${file}`);
  const value: unknown = JSON.parse(await readFile(file, "utf8"));
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainValidationError(`invalid package manifest: ${file}`);
  }
  return value as PackageManifest;
}

function declaredEdges(manifest: PackageManifest, includePeers: boolean): Map<string, boolean> {
  const edges = new Map<string, boolean>();
  const add = (declarations: Record<string, string> | undefined, optional: boolean): void => {
    if (declarations === undefined) return;
    if (declarations === null || typeof declarations !== "object" || Array.isArray(declarations)) {
      throw new DomainValidationError("package dependency declarations must be objects");
    }
    for (const [name, range] of Object.entries(declarations)) {
      packageName(name);
      if (typeof range !== "string") throw new DomainValidationError(`invalid dependency version: ${name}`);
      edges.set(name, optional);
    }
  };
  add(manifest.dependencies, false);
  // npm optionalDependencies override same-name dependencies.
  add(manifest.optionalDependencies, true);
  if (includePeers) {
    for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
      packageName(name);
      if (typeof range !== "string") throw new DomainValidationError(`invalid peer version: ${name}`);
      const optional = manifest.peerDependenciesMeta?.[name]?.optional === true;
      edges.set(name, (edges.get(name) ?? true) && optional);
    }
  }
  return edges;
}

async function resolvePackage(name: string, importer: string, installation: string): Promise<string | undefined> {
  // Locate manifests through Node's own per-importer search path without
  // evaluating entries or requiring package.json to be exported.
  const locations = createRequire(path.join(importer, "package.json")).resolve.paths(name) ?? [];
  for (const location of locations) {
    const candidate = path.join(location, name);
    try {
      await lstat(path.join(candidate, "package.json"));
    } catch (error: unknown) {
      if (error !== null && typeof error === "object" && "code" in error &&
          (error.code === "ENOENT" || error.code === "ENOTDIR")) continue;
      throw error;
    }
    const canonical = await realpath(candidate);
    if (!isPathInside(canonical, installation)) {
      throw new DomainValidationError(`package outside source installation refused: ${name}`);
    }
    if (!(await lstat(canonical)).isDirectory()) throw new DomainValidationError(`package is not a directory: ${name}`);
    return canonical;
  }
  return undefined;
}

async function copyPhysicalTree(source: string, destination: string): Promise<void> {
  const entry = await lstat(source);
  if (entry.isSymbolicLink()) throw new DomainValidationError(`package/program file link refused: ${source}`);
  if (entry.isDirectory()) {
    await mkdir(destination);
    for (const child of await readdir(source)) {
      if (child === "node_modules") continue;
      await copyPhysicalTree(path.join(source, child), path.join(destination, child));
    }
    return;
  }
  if (!entry.isFile()) throw new DomainValidationError(`nonregular package/program file refused: ${source}`);
  await copyFile(source, destination);
}

async function linkEdges(root: string, edges: ReadonlyMap<string, PackageNode>, generation: string): Promise<void> {
  const modules = path.join(root, "node_modules");
  await mkdir(modules);
  for (const [name, target] of edges) {
    const destination = path.join(modules, name);
    await mkdir(path.dirname(destination), { recursive: true });
    const packageRoot = path.join(generation, "packages", target.id);
    await symlink(packageRoot, destination, process.platform === "win32" ? "junction" : "dir");
    if (!isPathInside(await realpath(destination), generation)) {
      throw new DomainValidationError(`staged dependency link escapes generation: ${name}`);
    }
  }
}

/**
 * Copy the installed runtime graph into one new final directory. Completed
 * generations are never mutated by this API. This is lifecycle immutability,
 * not protection against another filesystem writer or an OS sandbox.
 * Failed incomplete directories remain unselected for explicit later cleanup.
 */
export async function stageManagedCandidate(options: StageManagedCandidateOptions): Promise<ManagedCandidate> {
  const versions = { ...options.expectedVersions };
  exactVersion(versions.core);
  exactVersion(versions.ai);
  const program = physicalDirectoryWithoutLinks(options.programRoot);
  const generations = physicalDirectoryWithoutLinks(options.generationsRoot);
  const manifest = await manifestAt(program);
  const dist = physicalDirectoryWithoutLinks(path.join(program, "dist"));
  const installation = await realpath(path.join(program, "node_modules"));
  const packages = new Map<string, PackageNode>();
  const absentOptional: Array<{ importer: string; name: string }> = [];

  const discover = async (from: string, owner: string, declarations: Map<string, boolean>): Promise<Map<string, PackageNode>> => {
    const edges = new Map<string, PackageNode>();
    for (const [name, optional] of declarations) {
      const root = await resolvePackage(name, from, installation);
      if (root === undefined) {
        if (!optional) throw new DomainValidationError(`missing required package: ${name} (from ${owner})`);
        absentOptional.push({ importer: owner, name });
        continue;
      }
      let node = packages.get(root);
      if (node === undefined) {
        const dependency = await manifestAt(root);
        if (dependency.name !== name || typeof dependency.version !== "string") {
          throw new DomainValidationError(`package manifest identity mismatch: ${name}`);
        }
        node = { id: `p${String(packages.size).padStart(4, "0")}`, root, manifest: dependency, edges: new Map() };
        packages.set(root, node); // Register before recursion so cycles terminate.
        const childEdges = await discover(root, node.id, declaredEdges(dependency, true));
        for (const [child, target] of childEdges) node.edges.set(child, target);
      }
      edges.set(name, node);
    }
    return edges;
  };

  for (const key of ["core", "ai"] as const) {
    if (manifest.dependencies?.[enginePackages[key]] !== versions[key]) {
      throw new DomainValidationError(`application ${key} version does not match expected version ${versions[key]}`);
    }
  }
  // The controlled SDK is a required host peer. Root peers must travel with
  // the candidate just like transitive peers; the isolated loader cannot
  // borrow them from the original installation.
  const appEdges = await discover(program, "app", declaredEdges(manifest, true));
  for (const key of ["core", "ai"] as const) {
    if (appEdges.get(enginePackages[key])?.manifest.version !== versions[key]) {
      throw new DomainValidationError(`installed ${key} version does not match expected version ${versions[key]}`);
    }
  }
  if ([dist, ...packages.keys()].some((source) => isPathInside(generations, source))) {
    throw new DomainValidationError("generation destination inside a copied source tree refused");
  }

  const generationId = randomUUID();
  const root = path.join(generations, generationId);
  await mkdir(root); // Exclusive final path; never rename absolute junction targets.
  physicalDirectoryWithoutLinks(root);
  const appRoot = path.join(root, "app");
  await mkdir(appRoot);
  await mkdir(path.join(root, "packages"));
  await copyFile(path.join(program, "package.json"), path.join(appRoot, "package.json"));
  await copyPhysicalTree(dist, path.join(appRoot, "dist"));
  for (const node of packages.values()) {
    await copyPhysicalTree(node.root, path.join(root, "packages", node.id));
  }
  await linkEdges(appRoot, appEdges, root);
  for (const node of packages.values()) await linkEdges(path.join(root, "packages", node.id), node.edges, root);
  await writeFileAtomic(path.join(root, "candidate.json"), JSON.stringify({
    generationId,
    versions,
    appVersion: manifest.version,
    dependencies: Object.fromEntries([...appEdges].map(([name, target]) => [name, target.id])),
    packages: [...packages.values()].map((node) => ({
      id: node.id,
      name: node.manifest.name,
      version: node.manifest.version,
      dependencies: Object.fromEntries([...node.edges].map(([name, target]) => [name, target.id]))
    })),
    absentOptional
  }, null, 2) + "\n");
  return { generationId, root, appRoot, versions };
}
