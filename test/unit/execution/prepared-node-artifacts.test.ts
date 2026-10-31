import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { detachNodeOfflineLinks } from "../../../src/development/node-offline-preparation.js";
import { DomainValidationError } from "../../../src/domain/errors.js";

async function api() {
  const module = await import("../../../src/execution/prepared-node-artifacts.js").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ERR_MODULE_NOT_FOUND") return undefined;
    throw error;
  });
  assert.equal(typeof module?.issuePreparedNodeArtifacts, "function", "prepared installation needs a genuine immutable artifact capability");
  return module!;
}
function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
interface Fixture { root: string; source: string; candidate: string; modules: string; shared: string; input: { sourceRepo: string; candidatePath: string; sourceRevision: string; readOnlySharedStores: string[] }; }
function fixture(body: (input: Fixture) => void): void {
  const parent = path.resolve(".agent_workspace/prepared-artifact-unit"); fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "case-")), source = path.join(root, "source"), candidate = path.join(root, "candidate"), shared = path.join(root, "shared");
  fs.mkdirSync(source); fs.mkdirSync(shared);
  fs.writeFileSync(path.join(source, "value.txt"), "before", "utf8"); fs.writeFileSync(path.join(source, ".gitignore"), "node_modules/\n.cache/\n", "utf8");
  git(source, ["init", "-b", "fixture"]); git(source, ["config", "core.autocrlf", "false"]);
  git(source, ["add", "."]); git(source, ["-c", "user.name=Synthetic", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture"]);
  const sourceRevision = git(source, ["rev-parse", "HEAD"]); git(source, ["worktree", "add", "--detach", candidate, sourceRevision]);
  const modules = path.join(candidate, "node_modules"); fs.mkdirSync(modules);
  try { body({ root, source, candidate, modules, shared, input: { sourceRepo: source, candidatePath: candidate, sourceRevision, readOnlySharedStores: [shared] } }); }
  finally { assert.equal(path.dirname(root), parent); assert.ok(path.basename(root).startsWith("case-")); fs.rmSync(root, { recursive: true, force: true }); }
}
function write(directory: string, file = "index.cjs", text = "module.exports={version:'1.0.0'}"): string {
  fs.mkdirSync(directory, { recursive: true }); const absolute = path.join(directory, file); fs.writeFileSync(absolute, text, "utf8"); return absolute;
}
function link(target: string, selected: string): void { fs.symlinkSync(target, selected, "junction"); }

test("regular prepared artifacts issue genuine identity and delivery proof without excluding source changes", async () => {
  const a = await api(); fixture(f => {
    write(path.join(f.modules, "pkg"));
    const cap = a.issuePreparedNodeArtifacts(f.input), identity = a.preparedNodeArtifactIdentity(cap);
    assert.deepEqual(identity, { sourceRepo: fs.realpathSync(f.source), candidatePath: fs.realpathSync(f.candidate), sourceRevision: f.input.sourceRevision });
    assert.ok(Object.isFrozen(identity)); assert.deepEqual(a.preparedNodeArtifactLinks(cap), []);
    const proof = a.capturePreparedDelivery(cap), original = a.preparedDeliverySnapshot(cap, proof);
    assert.equal(original.fileCount, 2); a.assertPreparedDelivery(cap, proof);
    fs.writeFileSync(path.join(f.candidate, "value.txt"), "after", "utf8");
    assert.equal(a.preparedDeliverySnapshot(cap, proof), original, "snapshot retrieval does not refresh or pretend to perform a live check");
    assert.throws(() => a.assertPreparedDelivery(cap, proof), /delivery|changed|snapshot/i);
    a.assertPreparedDelivery(cap, a.capturePreparedDelivery(cap));
  });
});
test("linked artifacts bind transitive shared bytes while cleanup journal owns only candidate links", async () => {
  const a = await api(); fixture(f => {
    const first = path.join(f.shared, "first"), second = path.join(f.shared, "second"); write(first); write(second, "payload", "original");
    link(second, path.join(first, "next")); const local = path.join(f.modules, "pkg"); link(first, local);
    const cap = a.issuePreparedNodeArtifacts(f.input); a.assertPreparedNodeArtifacts(cap);
    const journal = a.preparedNodeArtifactLinks(cap);
    assert.deepEqual(journal.map(entry => entry.path), [local]); assert.ok(Object.isFrozen(journal));
    assert.ok(journal.every(entry => Object.isFrozen(entry) && Object.isFrozen(entry.directories)));
    assert.deepEqual(journal[0]!.directories.map(entry => entry.path), [f.candidate, f.modules]);
    detachNodeOfflineLinks(f.candidate, journal);
    assert.equal(fs.existsSync(local), false); assert.equal(fs.lstatSync(path.join(first, "next")).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(path.join(second, "payload"), "utf8"), "original");
    assert.throws(() => a.assertPreparedNodeArtifacts(cap));
  });
});

test("candidate-local pnpm link journal interoperates with actual dependency link detachment", async () => {
  const a = await api(); fixture(f => {
    const installed = path.join(f.modules, ".pnpm/pkg@1.0.0/node_modules/pkg");
    const sharedFile = write(path.join(f.shared, "pkg")), original = fs.readFileSync(sharedFile);
    fs.mkdirSync(path.dirname(installed), { recursive: true }); fs.cpSync(path.dirname(sharedFile), installed, { recursive: true });
    const local = path.join(f.modules, "pkg"); link(installed, local); write(f.modules, ".modules.yaml", "layoutVersion: 5\n");
    const cap = a.issuePreparedNodeArtifacts(f.input); a.assertPreparedNodeArtifacts(cap);
    const journal = a.preparedNodeArtifactLinks(cap);
    assert.deepEqual(journal.map(entry => entry.path), [local]);
    assert.deepEqual(journal[0]!.directories.map(entry => entry.path), [f.candidate, f.modules]);
    detachNodeOfflineLinks(f.candidate, journal);
    assert.equal(fs.existsSync(local), false);
    assert.deepEqual(fs.readFileSync(path.join(installed, "index.cjs")), original);
    assert.deepEqual(fs.readFileSync(sharedFile), original);
    assert.deepEqual(fs.readdirSync(f.shared), ["pkg"]);
    assert.throws(() => a.assertPreparedNodeArtifacts(cap), "detachment must not silently refresh artifact evidence");
  });
});

for (const mutation of ["transitive-bytes", "new-entry", "removed-file", "replaced-file", "retarget-local", "retarget-shared", "replaced-parent", "hardlink-after-issue"] as const) {
  test(`prepared artifact assertion refuses ${mutation}`, async () => {
    const a = await api(); fixture(f => {
      const first = path.join(f.shared, "first"), second = path.join(f.shared, "second"), alternate = path.join(f.shared, "alternate");
      write(first); const payload = write(second, "payload", "original"); write(alternate, "payload", "original");
      link(second, path.join(first, "next")); const local = path.join(f.modules, "pkg"); link(first, local);
      const regular = write(path.join(f.modules, "regular")); const cap = a.issuePreparedNodeArtifacts(f.input);
      if (mutation === "transitive-bytes") fs.writeFileSync(payload, "modified", "utf8");
      if (mutation === "new-entry") write(f.modules, "new-ignored-entry");
      if (mutation === "removed-file") fs.unlinkSync(payload);
      if (mutation === "replaced-file") { fs.renameSync(payload, path.join(f.root, "old-payload")); fs.writeFileSync(payload, "original", "utf8"); }
      if (mutation === "retarget-local") { fs.unlinkSync(local); link(alternate, local); }
      if (mutation === "retarget-shared") { fs.unlinkSync(path.join(first, "next")); link(alternate, path.join(first, "next")); }
      if (mutation === "replaced-parent") { fs.renameSync(path.dirname(regular), path.join(f.root, "old-parent")); write(path.dirname(regular)); }
      if (mutation === "hardlink-after-issue") fs.linkSync(regular, path.join(f.root, "write-through-alias"));
      assert.throws(() => a.assertPreparedNodeArtifacts(cap), /artifact|link|identity|changed|file/i);
    });
  });
}

for (const invalid of ["source-overlap", "candidate-store-overlap", "source-store-overlap", "unknown-output", "tracked-modules", "root-link", "outside-target", "shared-escape", "cycle", "hardlink"] as const) {
  test(`artifact issue refuses ${invalid}`, async () => {
    const a = await api(); fixture(f => {
      write(path.join(f.modules, "pkg"));
      if (invalid === "source-overlap") f.input.candidatePath = f.source;
      if (invalid === "candidate-store-overlap") f.input.readOnlySharedStores = [f.modules];
      if (invalid === "source-store-overlap") f.input.readOnlySharedStores = [f.source];
      if (invalid === "unknown-output") write(path.join(f.candidate, ".cache"), "unowned");
      if (invalid === "tracked-modules") {
        write(path.join(f.source, "node_modules"), "tracked"); git(f.source, ["add", "-f", "node_modules/tracked"]);
        git(f.source, ["-c", "user.name=Synthetic", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "tracked dependency"]);
        f.input.sourceRevision = git(f.source, ["rev-parse", "HEAD"]); git(f.candidate, ["checkout", "--detach", f.input.sourceRevision]);
      }
      if (invalid === "root-link") { fs.renameSync(f.modules, path.join(f.root, "old-modules")); link(path.join(f.root, "old-modules"), f.modules); }
      if (invalid === "outside-target") link(f.source, path.join(f.modules, "escaped"));
      if (invalid === "shared-escape") { link(f.modules, path.join(f.shared, "escaped")); link(f.shared, path.join(f.modules, "shared")); }
      if (invalid === "cycle") { const dir = path.join(f.modules, "pkg"); link(dir, path.join(dir, "self")); }
      if (invalid === "hardlink") fs.linkSync(path.join(f.modules, "pkg/index.cjs"), path.join(f.root, "external-alias"));
      assert.throws(() => a.issuePreparedNodeArtifacts(f.input));
    });
  });
}

test("forged cap, copied proof and cross-cap proof cannot recreate authority", async () => {
  const a = await api(); fixture(f => {
    const cap = a.issuePreparedNodeArtifacts(f.input), proof = a.capturePreparedDelivery(cap), other = a.issuePreparedNodeArtifacts(f.input);
    for (const forged of [{ ...cap }, JSON.parse(JSON.stringify(cap))]) {
      assert.throws(() => a.preparedNodeArtifactIdentity(forged)); assert.throws(() => a.assertPreparedNodeArtifacts(forged));
      assert.throws(() => a.preparedNodeArtifactLinks(forged)); assert.throws(() => a.capturePreparedDelivery(forged));
    }
    assert.throws(() => a.preparedDeliverySnapshot(cap, { ...proof }));
    assert.throws(() => a.assertPreparedDelivery(other, proof));
    assert.throws(() => a.preparedDeliverySnapshot(other, proof));
  });
});
test("zero-artifact capability refuses a later node_modules namespace", async () => {
  const a = await api(); fixture(f => {
    fs.rmdirSync(f.modules); const cap = a.issuePreparedNodeArtifacts(f.input); const proof = a.capturePreparedDelivery(cap);
    assert.equal(a.preparedDeliverySnapshot(cap, proof).fileCount, 2); fs.mkdirSync(f.modules);
    assert.throws(() => a.assertPreparedNodeArtifacts(cap));
  });
});

test("candidate Git marker bytes cannot retarget a genuine artifact capability", async () => {
  const a = await api(); fixture(f => {
    write(path.join(f.modules, "pkg")); const cap = a.issuePreparedNodeArtifacts(f.input);
    const fd = fs.openSync(path.join(f.candidate, ".git"), "r+");
    try { fs.ftruncateSync(fd, 0); fs.writeFileSync(fd, "gitdir: unowned-replacement\n", "utf8"); }
    finally { fs.closeSync(fd); }
    assert.throws(() => a.assertPreparedNodeArtifacts(cap), /Git|identity|changed|artifact/i);
  });
});
test("artifact root replacement between initial observation and traversal refuses issue", async () => {
  const a = await api(); fixture(f => {
    write(path.join(f.modules, "pkg")); const original = fs.lstatSync; let observations = 0;
    fs.lstatSync = ((...args: Parameters<typeof fs.lstatSync>) => {
      if (String(args[0]) === f.modules && ++observations === 2) {
        fs.renameSync(f.modules, path.join(f.root, "old-modules")); write(path.join(f.modules, "pkg"));
      }
      return original(...args);
    }) as typeof fs.lstatSync;
    try { assert.throws(() => a.issuePreparedNodeArtifacts(f.input), /identity|changed|artifact/i); }
    finally { fs.lstatSync = original; }
    assert.ok(observations >= 2, "the real artifact traversal must reach the controlled replacement");
  });
});

test("worktree commondir bytes cannot redirect the sealed Git repository", async () => {
  const a = await api(); fixture(f => {
    const cap = a.issuePreparedNodeArtifacts(f.input);
    const marker = path.join(git(f.candidate, ["rev-parse", "--absolute-git-dir"]), "commondir");
    const fd = fs.openSync(marker, "r+");
    try { fs.ftruncateSync(fd, 0); fs.writeFileSync(fd, "unowned-common-dir\n", "utf8"); }
    finally { fs.closeSync(fd); }
    assert.throws(() => a.assertPreparedNodeArtifacts(cap), /Git|identity|changed|artifact/i);
  });
});

test("link target dot steps cannot erase a transitive edge during normalization", async () => {
  const a = await api(); fixture(f => {
    const inside = path.join(f.shared, "inside"); write(inside); write(path.join(f.shared, "pkg")); write(path.join(f.modules, "pkg"));
    link(inside, path.join(f.modules, "alias")); const ambiguous = path.join(f.modules, "ambiguous");
    link(`${f.modules}${path.sep}alias${path.sep}..${path.sep}pkg`, ambiguous);
    // Windows junction creation may normalize the stored target itself. Inspect
    // the actual edge rather than pretending that it retained POSIX symlink bytes.
    if (fs.readlinkSync(ambiguous).split(/[\\/]/).includes("..")) assert.throws(() => a.issuePreparedNodeArtifacts(f.input), /topology/i);
    else a.assertPreparedNodeArtifacts(a.issuePreparedNodeArtifacts(f.input));
  });
});

test("Git-readable linked marker never supplies repository identity", async () => {
  const a = await api(); fixture(f => {
    const marker = path.join(f.candidate, ".git"), original = path.join(f.root, "original-git-marker");
    fs.renameSync(marker, original); fs.symlinkSync(original, marker, "file");
    assert.equal(git(f.candidate, ["rev-parse", "HEAD"]), f.input.sourceRevision, "the actual Git process must parse the file symlink before claiming a business counterexample");
    assert.throws(() => a.issuePreparedNodeArtifacts(f.input), /marker|link|identity/i);
  });
});
test("linked-worktree shared storage cannot overlap its external Git administration", async () => {
  const a = await api(); fixture(f => {
    const linkedSource = path.join(f.root, "linked-source"); git(f.source, ["worktree", "add", "--detach", linkedSource, f.input.sourceRevision]);
    const admin = git(f.source, ["rev-parse", "--absolute-git-dir"]);
    assert.throws(() => a.issuePreparedNodeArtifacts({ ...f.input, sourceRepo: linkedSource, readOnlySharedStores: [admin] }), /overlap|Git|administration/i);
  });
});
test("deep candidate link journals cannot receive unbudgeted parent observations", async t => {
  const a = await api(); fixture(f => {
    const empty = path.join(f.modules, "empty"); fs.mkdirSync(empty);
    const parentPaths = new Set([f.candidate, f.modules]); let deep = f.modules;
    for (let index = 0; index < 100; index++) { deep = path.join(deep, "d"); fs.mkdirSync(deep); parentPaths.add(deep); }
    for (let index = 0; index < 3000; index++) link(empty, path.join(deep, `link-${index}`));
    const original = fs.lstatSync; let parentObservations = 0;
    fs.lstatSync = ((...args: Parameters<typeof fs.lstatSync>) => {
      if (parentPaths.has(String(args[0])) && ++parentObservations > 16384) throw Error("fixture observation cutoff: unbudgeted parent reads");
      return original(...args);
    }) as typeof fs.lstatSync;
    let observed: { cap: ReturnType<typeof a.issuePreparedNodeArtifacts> } | { error: unknown };
    try { observed = { cap: a.issuePreparedNodeArtifacts(f.input) }; }
    catch (error) { observed = { error }; }
    finally { fs.lstatSync = original; }
    t.diagnostic(`Actual candidate-parent observations before completion/refusal: ${parentObservations}`);
    if ("error" in observed) {
      assert.ok(observed.error instanceof DomainValidationError);
      assert.match(observed.error.message, /traversal|budget/i);
      assert.doesNotMatch(observed.error.message, /fixture observation cutoff/, "production must account for parent observations before the bounded fixture has to stop an unbudgeted walk");
    } else a.assertPreparedNodeArtifacts(observed.cap);
  });
});

for (const budget of ["combined-files", "alias-files", "combined-bytes", "alias-bytes", "traversal", "depth"] as const) {
  test(`artifact and delivery share bounded ${budget} observations`, async () => {
    const a = await api(); fixture(f => {
      if (budget === "combined-files") for (let index = 0; index < 1023; index++) write(f.modules, `file-${index}`, "");
      if (budget === "alias-files") {
        const pkg = path.join(f.modules, "pkg"); for (let index = 0; index < 512; index++) write(pkg, `file-${index}`, "");
        link(pkg, path.join(f.modules, "alias"));
      }
      if (budget === "combined-bytes") fs.writeFileSync(path.join(f.modules, "payload"), Buffer.alloc(16777215));
      if (budget === "alias-bytes") {
        const pkg = path.join(f.modules, "pkg"); fs.mkdirSync(pkg); fs.writeFileSync(path.join(pkg, "payload"), Buffer.alloc(8388608));
        link(pkg, path.join(f.modules, "alias"));
      }
      if (budget === "traversal") {
        for (let level = 0; level < 15; level++) fs.mkdirSync(path.join(f.modules, `level-${level}`));
        for (let level = 0; level < 14; level++) for (const name of ["left", "right"]) link(path.join(f.modules, `level-${level + 1}`), path.join(f.modules, `level-${level}`, name));
      }
      if (budget === "depth") fs.mkdirSync(path.join(f.modules, ...Array<string>(128).fill("d")), { recursive: true });
      assert.throws(() => a.issuePreparedNodeArtifacts(f.input), budget === "traversal" ? /traversal/i : budget === "depth" ? /depth/i : /file|byte|budget/i);
    });
  });
}
