import { fileURLToPath } from "node:url";
import { lstatSync, readFileSync, readlinkSync, realpathSync, unlinkSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { DomainValidationError } from "../domain/errors.js";
import type { AuthorizedCommandRunResult } from "../execution/command-runner.js";
import { physicalDirectoryWithoutLinks } from "../native/physical-directory.js";
import type { DevelopmentTaskPreparation } from "./task-spec.js";

function fail(reason: string): never { throw new DomainValidationError(`Node offline preparation: ${reason}`); }
function within(root: string, selected: string): boolean {
  const relative = path.relative(root, selected);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("expected package manifest/lock object");
  return value as Record<string, unknown>;
}
export interface NodeOfflineDirectory { readonly path: string; readonly device: number; readonly inode: number; }
export interface NodeOfflineLink { readonly path: string; readonly target: string; readonly device: number; readonly inode: number; readonly directories: readonly NodeOfflineDirectory[]; }
function directoryIdentity(value: string): NodeOfflineDirectory {
  const physical = physicalDirectoryWithoutLinks(value), entry = lstatSync(physical);
  return Object.freeze({ path: physical, device: entry.dev, inode: entry.ino });
}
function sameDirectory(expected: NodeOfflineDirectory, actual: NodeOfflineDirectory): boolean {
  return expected.path === actual.path && expected.device === actual.device && expected.inode === actual.inode;
}
/** Only observed candidate dependency links are detached; their targets are never traversed or removed. */
export function detachNodeOfflineLinks(candidatePath: string, links: readonly NodeOfflineLink[]): void {
  const candidate = physicalDirectoryWithoutLinks(candidatePath), modules = path.join(candidate, "node_modules");
  const verify = (link: NodeOfflineLink): void => {
    if (!within(modules, link.path)) fail("dependency cleanup path is outside the allocated installation");
    const parent = path.dirname(link.path);
    let cursor = candidate, index = 0;
    for (;;) {
      const expected = link.directories[index++];
      if (expected === undefined || !sameDirectory(expected, directoryIdentity(cursor))) fail("candidate or dependency parent directory changed before cleanup; candidate retained");
      if (cursor === parent) break;
      const remaining = path.relative(cursor, parent).split(path.sep);
      if (remaining.length === 0 || remaining[0] === "..") fail("dependency parent escapes the allocated candidate");
      cursor = path.join(cursor, remaining[0]!);
    }
    if (index !== link.directories.length) fail("dependency parent chain changed before cleanup; candidate retained");
    const entry = lstatSync(link.path);
    if (!entry.isSymbolicLink() || entry.dev !== link.device || entry.ino !== link.inode || readlinkSync(link.path) !== link.target) fail("dependency link changed before cleanup; candidate retained");
  };
  // Validate the complete observed set before beginning destructive link removal.
  for (const link of links) verify(link);
  for (const link of links) { verify(link); unlinkSync(link.path); }
}
export interface NodeOfflineInstallation {
  readonly package: string; readonly version: string; readonly installationPath: string; readonly resolvedPath: string; readonly resolvedEntry?: string;
}
/** Fixed pnpm recipe. Command/argv prefixes select a trusted, host-provided pnpm executable, never a shell. */
export async function prepareNodeOffline(input: {
  readonly recipe: DevelopmentTaskPreparation; readonly candidatePath: string; readonly sourceRepo: string;
  readonly onLink: (link: NodeOfflineLink) => void;
  readonly execute: (args: readonly string[], expectedVersion?: string) => Promise<AuthorizedCommandRunResult>;
}): Promise<readonly NodeOfflineInstallation[]> {
  const declaration = input.recipe.nodeOffline!;
  const allocatedCandidate = directoryIdentity(input.candidatePath);
  const candidate = allocatedCandidate.path, source = realpathSync(input.sourceRepo);
  if (!path.isAbsolute(input.recipe.command) || realpathSync(input.recipe.command) !== realpathSync(process.execPath)) fail("the fixed recipe requires this exact Node executable with a host-selected pnpm CLI prefix");
  if (process.versions.node !== declaration.nodeVersion) fail(`exact Node ${declaration.nodeVersion} unavailable (running ${process.versions.node})`);
  const lockPath = path.join(candidate, "pnpm-lock.yaml"), manifestPath = path.join(candidate, "package.json");
  const manifestBytes = readFileSync(manifestPath), lockBytes = readFileSync(lockPath);
  const manifest = object(JSON.parse(manifestBytes.toString("utf8")));
  if (manifest.packageManager !== `pnpm@${declaration.packageManagerVersion}`) fail("package.json packageManager must match the declared exact pnpm version");
  const lock = object(parse(lockBytes.toString("utf8"))), importers = object(lock.importers);
  if (Object.keys(importers).some(key => key !== ".")) fail("this fixed recipe supports one root importer; workspace installation is unsupported");
  const importer = object(importers["."]);
  const store = realpathSync(declaration.storePath);
  if (within(source, store) || within(store, source)) fail("offline store must be outside the source repository");
  const shared = declaration.readOnlySharedStores.map(selected => {
    const physical = realpathSync(selected);
    if (within(source, physical) || within(physical, source) || within(candidate, physical) || within(physical, candidate) ||
        physical.split(path.sep).some(part => part.toLowerCase() === "node_modules")) fail("shared dependency storage must be outside source/candidate and ancestor node_modules");
    return physical;
  });
  const dependencies = new Map<string, { readonly version: string; readonly required: boolean }>();
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
    const declared = manifest[section] === undefined ? {} : object(manifest[section]);
    const locked = importer[section] === undefined ? {} : object(importer[section]);
    for (const [name, specifier] of Object.entries(declared)) {
      if (!/^(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+$/.test(name) || name === "." || name === "..") fail("unsupported package name");
      const entry = object(locked[name]);
      if (entry.specifier !== specifier || typeof entry.version !== "string") fail(`lockfile does not bind ${name} to its declared specifier`);
      const version = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\(|$)/.exec(entry.version)?.[1];
      if (version === undefined) fail(`unsupported non-registry locked version for ${name}`);
      const previous = dependencies.get(name), required = section !== "optionalDependencies";
      if (previous?.required !== true || required) dependencies.set(name, { version, required: required || previous?.required === true });
    }
  }
  await input.execute([...input.recipe.args, "--version"], declaration.packageManagerVersion);
  await input.execute([...input.recipe.args, "install", "--offline", "--frozen-lockfile", "--ignore-scripts", "--store-dir", store]);
  if (!readFileSync(manifestPath).equals(manifestBytes) || !readFileSync(lockPath).equals(lockBytes)) fail("installation changed package.json or the frozen lockfile");
  const modulesPath = path.join(candidate, "node_modules");
  const observeLinks = (selected: string): void => {
    if (!sameDirectory(allocatedCandidate, directoryIdentity(candidate))) fail("allocated candidate directory identity changed during preparation");
    const directories = [allocatedCandidate];
    let cursor = modulesPath;
    for (const part of ["", ...path.relative(modulesPath, selected).split(path.sep).filter(Boolean)]) {
      cursor = path.join(cursor, part);
      const entry = lstatSync(cursor);
      if (entry.isSymbolicLink()) {
        input.onLink(Object.freeze({ path: cursor, target: readlinkSync(cursor), device: entry.dev, inode: entry.ino, directories: Object.freeze([...directories]) }));
        break;
      }
      directories.push(directoryIdentity(cursor));
    }
  };
  const modules = lstatSync(modulesPath, { throwIfNoEntry: false });
  if (modules === undefined) {
    if ([...dependencies.values()].some(dependency => dependency.required)) fail("required dependency installation is missing from the allocated candidate");
  } else {
    observeLinks(modulesPath);
    if (modules.isSymbolicLink() || !within(candidate, realpathSync(modulesPath))) fail("installation must create candidate-local node_modules");
  }
  // Resolve both Node import and require conditions from the actual candidate cwd.
  // Resolution executes no dependency code, and detects entrypoints escaping an otherwise local package directory.
  const resolveScript = `import {createRequire} from 'node:module';const require=createRequire(import.meta.url);const names=${JSON.stringify([...dependencies.keys()])};process.stdout.write(JSON.stringify(names.map(name=>{const resolved=[];try{resolved.push(import.meta.resolve(name))}catch{}try{resolved.push(require.resolve(name))}catch{}return resolved})))`;
  const resolution = await input.execute(["--input-type=module", "--eval", resolveScript]);
  const entries = JSON.parse(resolution.stdoutText) as string[][];
  const observations: NodeOfflineInstallation[] = [];
  let dependencyIndex = 0;
  for (const [name, { version, required }] of dependencies) {
    const installationPath = path.join(modulesPath, name), entrypoints = entries[dependencyIndex++]!;
    if (!required && lstatSync(installationPath, { throwIfNoEntry: false }) === undefined) {
      if (entrypoints.length !== 0) fail(`${name} optional dependency resolves outside the allocated installation`);
      continue;
    }
    observeLinks(installationPath);
    const resolvedPath = realpathSync(installationPath);
    if (!within(modulesPath, resolvedPath) && !shared.some(root => within(root, resolvedPath))) fail(`${name} resolves outside the allocated installation or declared read-only shared storage`);
    const installed = object(JSON.parse(readFileSync(path.join(resolvedPath, "package.json"), "utf8")));
    if (installed.name !== name || installed.version !== version) fail(`${name} locked version ${version} unavailable in the allocated installation`);
    const resolvedEntries = entrypoints.map(value => realpathSync(value.startsWith("file:") ? fileURLToPath(value) : value));
    if (resolvedEntries.length === 0) {
      // Types-only packages have no runtime module entrypoint.
      if (typeof installed.types !== "string" || installed.main !== undefined || installed.exports !== undefined) fail(`${name} runtime entrypoint unavailable in the allocated installation`);
      resolvedEntries.push(realpathSync(path.resolve(resolvedPath, installed.types)));
    }
    if (resolvedEntries.some(entry => !within(modulesPath, entry) && !shared.some(root => within(root, entry)))) fail(`${name} runtime entrypoint resolves outside the allocated installation or declared read-only shared storage`);
    const resolvedEntry = resolvedEntries[0];
    observations.push(Object.freeze({ package: name, version, installationPath, resolvedPath, ...(resolvedEntry === undefined ? {} : { resolvedEntry }) }));
  }
  return Object.freeze(observations);
}
