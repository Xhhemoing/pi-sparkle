import fs, { type BigIntStats } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import { physicalDirectoryWithoutLinks } from "../native/physical-directory.js";
import type { NodeOfflineLink } from "../development/node-offline-preparation.js";
import { assertExactProjectionMatchesCompleteGitTree, captureExactSnapshot, exactSnapshotTraversalEntries, sameExactSnapshot, type ExactSnapshot } from "./exact-snapshot.js";

declare const artifactBrand: unique symbol;
declare const proofBrand: unique symbol;
export interface PreparedNodeArtifacts { readonly [artifactBrand]: true; }
export interface DeliveryProof { readonly [proofBrand]: true; }
interface Identity { readonly path: string; readonly key: string; }
interface Entry { readonly path: string; readonly kind: "ancestor" | "directory" | "file" | "link"; readonly key: string; readonly bytes?: Buffer; readonly target?: string; }
type GitMarker = Entry | { readonly path: string; readonly kind: "absent" };
interface Graph { readonly present: boolean; readonly entries: readonly Entry[]; readonly links: readonly NodeOfflineLink[]; readonly files: number; readonly bytes: number; readonly visited: number; }
interface State {
  readonly identity: Readonly<{ sourceRepo: string; candidatePath: string; sourceRevision: string }>;
  readonly roots: readonly Identity[]; readonly markers: readonly GitMarker[]; readonly modules: string; readonly shared: readonly string[];
  readonly graph: Graph;
}
const limits = Object.freeze({ maxFiles: 1024, maxBytes: 16 * 1024 * 1024 });
const traversalLimit = Math.min(1_000_000, Math.max(1024, limits.maxFiles * 16));
const artifacts = new WeakMap<PreparedNodeArtifacts, State>();
const proofs = new WeakMap<DeliveryProof, { readonly cap: PreparedNodeArtifacts; readonly snapshot: ExactSnapshot }>();
function fail(reason: string): never { throw new DomainValidationError(`prepared Node artifacts: ${reason}`); }
function within(root: string, selected: string): boolean {
  const relative = path.relative(root, selected);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}
function overlap(a: string, b: string): boolean { return within(a, b) || within(b, a); }
function pathKey(value: string): string { return process.platform === "win32" ? value.toLowerCase() : value; }
function key(stat: BigIntStats, identityOnly = false): string {
  return identityOnly ? `${stat.dev}:${stat.ino}:${stat.mode}` : `${stat.dev}:${stat.ino}:${stat.mode}:${stat.nlink}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}
function directory(value: string): Identity {
  const physical = physicalDirectoryWithoutLinks(value), stat = fs.lstatSync(physical, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("directory identity is unavailable");
  return Object.freeze({ path: physical, key: key(stat, true) });
}
function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", ["--no-replace-objects", ...args], { cwd, encoding: "utf8", windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) fail(`Git binding failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout.trim();
}
function state(cap: PreparedNodeArtifacts): State {
  const selected = artifacts.get(cap); if (!selected) fail("a genuine in-process artifact capability is required"); return selected;
}
function proof(cap: PreparedNodeArtifacts, value: DeliveryProof): ExactSnapshot {
  state(cap); const selected = proofs.get(value);
  if (!selected || selected.cap !== cap) fail("a genuine delivery proof bound to this artifact capability is required");
  return selected.snapshot;
}
function gitMarker(absolute: string, expected?: Entry): Entry {
  const before = fs.lstatSync(absolute, { bigint: true });
  if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(limits.maxBytes)) fail("Git marker must be a bounded original nonlinked regular file");
  if (expected !== undefined && key(before) !== expected.key) fail("Git marker identity changed");
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  try {
    if (key(fs.fstatSync(fd, { bigint: true })) !== key(before)) fail("Git marker identity changed before read");
    const bytes = Buffer.alloc(Number(before.size)); let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count === 0) fail("Git marker changed during read"); offset += count;
    }
    if (fs.readSync(fd, Buffer.alloc(1), 0, 1, offset)) fail("Git marker grew during read");
    if (key(fs.fstatSync(fd, { bigint: true })) !== key(before) || key(fs.lstatSync(absolute, { bigint: true })) !== key(before)) fail("Git marker identity changed during read");
    return { path: absolute, kind: "file", key: key(before), bytes };
  } finally { fs.closeSync(fd); }
}
function assertRoots(selected: State): void {
  for (const original of selected.roots) {
    const current = directory(original.path);
    if (current.path !== original.path || current.key !== original.key) fail("source, candidate or preparation parent identity changed");
  }
  for (const original of selected.markers) {
    if (original.kind === "absent") {
      if (fs.lstatSync(original.path, { throwIfNoEntry: false }) !== undefined) fail("Git marker topology changed");
    } else {
      const current = gitMarker(original.path, original);
      if (!current.bytes!.equals(original.bytes!)) fail("Git marker identity or target bytes changed");
    }
  }
}
function linkTarget(absolute: string, target: string): string {
  // Collapsing '..' after an unresolved symlink would hide a transitive edge.
  // Pnpm's leading parent steps are supported; ambiguous later steps are refused.
  let componentSeen = false;
  for (const part of target.slice(path.parse(target).root.length).split(/[\\/]/).filter(Boolean)) {
    if (part === "." || part === "..") { if (componentSeen) fail("ambiguous link target topology is unsupported"); }
    else componentSeen = true;
  }
  return path.resolve(path.dirname(absolute), target);
}

/** Cooperative complete observations of reachable installation edges and bytes, never OS isolation. */
function captureGraph(selected: Omit<State, "graph">): Graph {
  const entries: Entry[] = [], links = new Map<string, NodeOfflineLink>();
  let files = 0, bytes = 0, visited = 0;
  const observe = (absolute: string, depth: number): BigIntStats => {
    if (++visited > traversalLimit) fail("artifact traversal entry budget exceeded");
    if (depth > 128) fail("artifact traversal depth exceeded");
    return fs.lstatSync(absolute, { bigint: true });
  };
  const candidateStat = observe(selected.identity.candidatePath, 0);
  if (!candidateStat.isDirectory() || key(candidateStat, true) !== selected.roots.find(root => root.path === selected.identity.candidatePath)!.key) fail("candidate parent identity changed");
  const chains = new Map<string, { key: string; chain: NodeOfflineLink["directories"] }>([[pathKey(selected.identity.candidatePath), {
    key: key(candidateStat, true), chain: Object.freeze([Object.freeze({ path: selected.identity.candidatePath, device: Number(candidateStat.dev), inode: Number(candidateStat.ino) })])
  }]]);
  const rememberDirectory = (absolute: string, stat: BigIntStats): void => {
    if (!within(selected.modules, absolute)) return;
    const existing = chains.get(pathKey(absolute));
    if (existing) { if (existing.key !== key(stat, true)) fail("artifact directory identity changed"); return; }
    const parent = chains.get(pathKey(path.dirname(absolute)));
    if (!parent) fail("artifact directory parent has not been proved");
    if (++visited > traversalLimit) fail("artifact traversal entry budget exceeded");
    const physical = fs.realpathSync.native(absolute);
    if (pathKey(physical) !== pathKey(absolute) || pathKey(path.dirname(physical)) !== pathKey(parent.chain.at(-1)!.path)) fail("artifact parent identity changed during resolution");
    const entry = Object.freeze({ path: physical, device: Number(stat.dev), inode: Number(stat.ino) });
    chains.set(pathKey(absolute), { key: key(stat, true), chain: Object.freeze([...parent.chain, entry]) });
  };
  const record = (absolute: string, kind: Entry["kind"], stat: BigIntStats, extra: Partial<Entry> = {}): void => {
    if (kind === "link" && stat.nlink !== 1n) fail("artifact link must have one filesystem link");
    if (kind === "directory" || kind === "ancestor") rememberDirectory(absolute, stat);
    entries.push({ path: absolute, kind, key: key(stat, kind === "ancestor"), ...extra });
  };
  const journal = (absolute: string, target: string, stat: BigIntStats): void => {
    if (!within(selected.modules, absolute)) return;
    const directories = chains.get(pathKey(path.dirname(absolute)))?.chain;
    if (!directories) fail("candidate link parent has not been proved");
    const physical = path.join(directories.at(-1)!.path, path.basename(absolute)), identity = pathKey(physical);
    if (!links.has(identity)) links.set(identity, Object.freeze({ path: physical, target, device: Number(stat.dev), inode: Number(stat.ino), directories }));
  };
  const resolve = (requested: string, depth: number, chain: ReadonlySet<string>, sharedOnly: boolean): { absolute: string; depth: number } => {
    const absolute = path.resolve(requested);
    const anchor = (sharedOnly ? selected.shared : [selected.modules, ...selected.shared]).find(root => within(root, absolute));
    if (anchor === undefined) fail("link target escaped the proved installation or declared read-only roots");
    const rootStat = observe(anchor, depth);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("link target parent identity changed");
    record(anchor, "ancestor", rootStat);
    const parts = path.relative(anchor, absolute).split(path.sep).filter(Boolean); let cursor = anchor;
    for (let index = 0; index < parts.length; index++) {
      cursor = path.join(cursor, parts[index]!); const stat = observe(cursor, depth + index + 1);
      if (stat.isSymbolicLink()) {
        if (chain.has(cursor)) fail("cyclic artifact links are unsupported");
        const target = fs.readlinkSync(cursor); record(cursor, "link", stat, { target }); journal(cursor, target, stat);
        const next = new Set(chain); next.add(cursor);
        const resolved = resolve(linkTarget(cursor, target), depth + index + 2, next, !within(selected.modules, cursor));
        return index === parts.length - 1 ? resolved : resolve(path.join(resolved.absolute, ...parts.slice(index + 1)), resolved.depth + 1, next, !within(selected.modules, resolved.absolute));
      }
      if (index < parts.length - 1 && !stat.isDirectory()) fail("unsupported artifact parent topology");
      if (stat.isDirectory()) record(cursor, "ancestor", stat);
    }
    return { absolute: cursor, depth: depth + parts.length };
  };
  const walk = (absolute: string, depth: number, ancestors: ReadonlySet<string>): void => {
    const stat = observe(absolute, depth);
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(absolute); record(absolute, "link", stat, { target }); journal(absolute, target, stat);
      const resolved = resolve(linkTarget(absolute, target), depth + 1, new Set([absolute]), !within(selected.modules, absolute));
      walk(resolved.absolute, resolved.depth + 1, ancestors); return;
    }
    if (stat.isDirectory()) {
      const identity = `${stat.dev}:${stat.ino}`;
      if (ancestors.has(identity)) fail("cyclic artifact directory topology is unsupported");
      const next = new Set(ancestors); next.add(identity); record(absolute, "directory", stat);
      const handle = fs.opendirSync(absolute, { bufferSize: 32 });
      try {
        for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
          if (entry.name.includes("\ufffd") || entry.name.includes("\\")) fail("unsupported artifact path encoding");
          walk(path.join(absolute, entry.name), depth + 1, next);
        }
      } finally { handle.closeSync(); }
      return;
    }
    if (!stat.isFile() || stat.nlink !== 1n) fail("artifact must be a nonlinked regular file");
    if (++files > limits.maxFiles || stat.size > BigInt(limits.maxBytes - bytes)) fail("artifact file or byte budget exceeded");
    const fd = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    try {
      if (key(fs.fstatSync(fd, { bigint: true })) !== key(stat)) fail("artifact file identity changed before read");
      const contents = Buffer.alloc(Number(stat.size)); let offset = 0;
      while (offset < contents.length) {
        const count = fs.readSync(fd, contents, offset, contents.length - offset, offset);
        if (count === 0) fail("artifact file changed during read"); offset += count;
      }
      if (fs.readSync(fd, Buffer.alloc(1), 0, 1, offset) || key(fs.fstatSync(fd, { bigint: true })) !== key(stat)) fail("artifact file changed during read");
      bytes += contents.length; record(absolute, "file", stat, { bytes: contents });
    } finally { fs.closeSync(fd); }
  };
  if (++visited > traversalLimit) fail("artifact traversal entry budget exceeded");
  const rootStat = fs.lstatSync(selected.modules, { bigint: true, throwIfNoEntry: false });
  if (rootStat !== undefined) {
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("node_modules root must be a nonlinked directory");
    walk(selected.modules, 1, new Set());
  }
  for (const entry of entries) {
    const current = fs.lstatSync(entry.path, { bigint: true });
    if (key(current, entry.kind === "ancestor") !== entry.key || (entry.target !== undefined && fs.readlinkSync(entry.path) !== entry.target)) fail("artifact identity changed during capture");
  }
  const finalRoot = fs.lstatSync(selected.modules, { bigint: true, throwIfNoEntry: false });
  if ((rootStat === undefined) !== (finalRoot === undefined) || (rootStat !== undefined && finalRoot !== undefined && key(rootStat) !== key(finalRoot))) fail("artifact root identity changed during capture");
  entries.sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind));
  return { present: rootStat !== undefined, entries, links: Object.freeze([...links.values()].sort((a, b) => a.path.localeCompare(b.path))), files, bytes, visited };
}
function sameGraph(a: Graph, b: Graph): boolean {
  return a.present === b.present && a.entries.length === b.entries.length && a.entries.every((entry, index) => {
    const other = b.entries[index]!;
    return entry.path === other.path && entry.kind === other.kind && entry.key === other.key && entry.target === other.target &&
      (entry.bytes === undefined ? other.bytes === undefined : other.bytes !== undefined && entry.bytes.equals(other.bytes));
  });
}
function delivery(selected: State): ExactSnapshot {
  const snapshot = captureExactSnapshot(selected.identity.candidatePath, selected.graph.present ? { excludePrefixes: ["node_modules"] } : {}, limits);
  if (snapshot.fileCount + selected.graph.files > limits.maxFiles || snapshot.byteLength + selected.graph.bytes > limits.maxBytes) fail("combined delivery and artifact file or byte budget exceeded");
  if (exactSnapshotTraversalEntries(snapshot) + selected.graph.visited > traversalLimit) fail("combined delivery and artifact traversal budget exceeded");
  return snapshot;
}

export function issuePreparedNodeArtifacts(input: { readonly sourceRepo: string; readonly candidatePath: string; readonly sourceRevision: string; readonly readOnlySharedStores: readonly string[] }): PreparedNodeArtifacts {
  try {
    if (!/^[0-9a-f]{40}$/.test(input.sourceRevision)) fail("sourceRevision must be an exact Git revision");
    const source = directory(input.sourceRepo), candidate = directory(input.candidatePath);
    if (overlap(source.path, candidate.path)) fail("source and candidate overlap");
    const declaredShared = input.readOnlySharedStores.map(directory);
    if (declaredShared.some(root => overlap(source.path, root.path) || overlap(candidate.path, root.path))) fail("source, candidate and shared roots must not overlap");
    // Redundant declarations preserve the same union; they grant no extra scope.
    const shared = declaredShared.filter((root, index) => !declaredShared.some((other, otherIndex) => otherIndex !== index && within(other.path, root.path) &&
      (pathKey(other.path) !== pathKey(root.path) || otherIndex < index)));
    for (const root of [source, candidate]) {
      if (git(root.path, ["rev-parse", "--show-cdup"]) !== "" || git(root.path, ["rev-parse", "HEAD"]) !== input.sourceRevision) fail("repository base does not match the source revision");
    }
    const sourceCommon = directory(path.resolve(source.path, git(source.path, ["rev-parse", "--git-common-dir"])));
    const candidateCommon = directory(path.resolve(candidate.path, git(candidate.path, ["rev-parse", "--git-common-dir"])));
    if (sourceCommon.path !== candidateCommon.path || sourceCommon.key !== candidateCommon.key) fail("candidate must belong to the source Git repository");
    const gitDirectories = [source, candidate].map(root => directory(git(root.path, ["rev-parse", "--absolute-git-dir"])));
    if (shared.some(root => [sourceCommon, ...gitDirectories].some(admin => overlap(root.path, admin.path)))) fail("shared storage overlaps Git administration");
    const markers: GitMarker[] = [];
    for (const root of [source, candidate]) {
      const marker = path.join(root.path, ".git"), stat = fs.lstatSync(marker);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) fail("linked or unsupported Git marker is refused");
      if (stat.isFile()) markers.push(gitMarker(marker));
    }
    for (const root of gitDirectories) for (const name of ["commondir", "gitdir"]) {
      const marker = path.join(root.path, name);
      markers.push(fs.lstatSync(marker, { throwIfNoEntry: false }) === undefined ? { path: marker, kind: "absent" } : gitMarker(marker));
    }
    const base = { identity: Object.freeze({ sourceRepo: source.path, candidatePath: candidate.path, sourceRevision: input.sourceRevision }),
      roots: Object.freeze([source, candidate, sourceCommon, ...gitDirectories, ...shared]), markers,
      modules: path.join(candidate.path, "node_modules"), shared: shared.map(root => root.path) };
    const selected: State = { ...base, graph: captureGraph(base) };
    const snapshot = delivery(selected), tree = git(candidate.path, ["rev-parse", `${input.sourceRevision}^{tree}`]);
    assertExactProjectionMatchesCompleteGitTree(snapshot, candidate.path, tree);
    const cap = Object.freeze({}) as PreparedNodeArtifacts; artifacts.set(cap, selected);
    assertPreparedNodeArtifacts(cap); return cap;
  } catch (error) {
    if (error instanceof DomainValidationError) throw error;
    fail(`installation capture refused: ${error instanceof Error ? error.message : "unknown filesystem effect"}`);
  }
}
/** Authenticity only; no live observation and no authority reconstructed from serialized metadata. */
export function preparedNodeArtifactIdentity(cap: PreparedNodeArtifacts): State["identity"] { return state(cap).identity; }
export function assertPreparedNodeArtifacts(cap: PreparedNodeArtifacts): void {
  const selected = state(cap);
  try {
    assertRoots(selected);
    if (!sameGraph(selected.graph, captureGraph(selected))) fail("prepared artifact bytes, entries or identities changed");
    delivery(selected);
    assertRoots(selected);
  } catch (error) {
    if (error instanceof DomainValidationError) throw error;
    fail(`prepared artifact changed or unavailable: ${error instanceof Error ? error.message : "unknown effect"}`);
  }
}
export function capturePreparedDelivery(cap: PreparedNodeArtifacts): DeliveryProof {
  assertPreparedNodeArtifacts(cap); const snapshot = delivery(state(cap)); assertPreparedNodeArtifacts(cap);
  const value = Object.freeze({}) as DeliveryProof; proofs.set(value, { cap, snapshot }); return value;
}
export function assertPreparedDelivery(cap: PreparedNodeArtifacts, value: DeliveryProof): void {
  const original = proof(cap, value); assertPreparedNodeArtifacts(cap);
  if (!sameExactSnapshot(original, delivery(state(cap)))) fail("delivery bytes or file set changed after proof capture");
  assertPreparedNodeArtifacts(cap);
}
/** Return the original immutable snapshot only. Call assertPreparedDelivery for a live check. */
export function preparedDeliverySnapshot(cap: PreparedNodeArtifacts, value: DeliveryProof): ExactSnapshot { return proof(cap, value); }
/** Original candidate-owned link identities only; shared-store links never grant cleanup authority. */
export function preparedNodeArtifactLinks(cap: PreparedNodeArtifacts): readonly NodeOfflineLink[] { return state(cap).graph.links; }
