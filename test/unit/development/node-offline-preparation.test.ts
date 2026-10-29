import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile, lstat, readlink, realpath, rename } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runAuthorizedCommand } from "../../../src/execution/command-runner.js";
import { detachNodeOfflineLinks, prepareNodeOffline } from "../../../src/development/node-offline-preparation.js";

test("fixed Node inspection resolves an import-only locked dependency through Node ESM resolution", async () => {
  const parent = path.resolve(".agent_workspace/node-offline-unit"); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "case-")), candidate = path.join(root, "candidate"), source = path.join(root, "source"), store = path.join(root, "store");
  await mkdir(path.join(candidate, "node_modules", "fixture"), { recursive: true }); await mkdir(source); await mkdir(store);
  const manager = path.join(root, "pnpm.cjs");
  await writeFile(manager, "if(process.argv[2]==='--version')console.log('10.17.1')", "utf8");
  await writeFile(path.join(candidate, "package.json"), JSON.stringify({ packageManager: "pnpm@10.17.1", dependencies: { fixture: "1.0.0" } }), "utf8");
  await writeFile(path.join(candidate, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      fixture:\n        specifier: 1.0.0\n        version: 1.0.0\n", "utf8");
  const dependency = path.join(candidate, "node_modules", "fixture");
  await writeFile(path.join(dependency, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0", type: "module", exports: { ".": { import: "./index.mjs" } } }), "utf8");
  await writeFile(path.join(dependency, "index.mjs"), "export const usable=true", "utf8");
  try {
    const observed = await prepareNodeOffline({ candidatePath: candidate, sourceRepo: source,
      recipe: { id: "offline", command: process.execPath, args: [manager], nodeOffline: { nodeVersion: process.versions.node, packageManagerVersion: "10.17.1", storePath: store, readOnlySharedStores: [] } },
      onLink: () => assert.fail("fixture has no links"), execute: async (args, expectedVersion) => {
        const result = await runAuthorizedCommand({ executable: process.execPath, args, cwd: candidate, env: {}, timeoutMs: 3000, maxStdoutBytes: 65536, maxStderrBytes: 4096 });
        assert.equal(result.ok, true, result.stderrText);
        if (expectedVersion !== undefined) assert.equal(result.stdoutText.trim(), expectedVersion);
        return result;
      } });
    assert.equal(observed.length, 1);
    assert.equal(observed[0]!.resolvedEntry, path.join(dependency, "index.mjs"));
  } finally { assert.equal(path.dirname(root), parent); await rm(root, { recursive: true, force: true }); }
});

test("fixed dependency link cleanup refuses a replaced target and preserves external bytes", async () => {
  const parent = path.resolve(".agent_workspace/node-offline-unit"); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "case-")), candidate = path.join(root, "candidate"), store = path.join(root, "store"), replacement = path.join(root, "replacement");
  const link = path.join(candidate, "node_modules", "fixture"); await mkdir(path.dirname(link), { recursive: true }); await mkdir(store); await mkdir(replacement);
  await writeFile(path.join(store, "keep.txt"), "KEEP", "utf8"); await symlink(store, link, "junction");
  try {
    const before = await lstat(link), observed = { path: link, target: await readlink(link), device: before.dev, inode: before.ino,
      directories: await Promise.all([candidate, path.dirname(link)].map(async value => { const entry = await lstat(value); return { path: await realpath(value), device: entry.dev, inode: entry.ino }; })) };
    await rm(link, { recursive: true }); await symlink(replacement, link, "junction");
    assert.throws(() => detachNodeOfflineLinks(candidate, [observed]), /changed.*cleanup|candidate retained/i);
    assert.equal(await readFile(path.join(store, "keep.txt"), "utf8"), "KEEP");
    assert.equal((await lstat(link)).isSymbolicLink(), true);
  } finally { assert.equal(path.dirname(root), parent); await rm(root, { recursive: true, force: true }); }
});

for (const mode of ["missing-required", "missing-optional", "wrong-optional", "escaped-optional", "required-overlap"] as const) {
  test(`fixed Node inspection handles ${mode} without treating optional platform packages as required`, async () => {
    const parent = path.resolve(".agent_workspace/node-offline-unit"); await mkdir(parent, { recursive: true });
    const root = await mkdtemp(path.join(parent, "case-")), candidate = path.join(root, "candidate"), source = path.join(root, "source"), store = path.join(root, "store");
    await mkdir(path.join(candidate, "node_modules"), { recursive: true }); await mkdir(source); await mkdir(store);
    const manager = path.join(root, "pnpm.cjs"); await writeFile(manager, "if(process.argv[2]==='--version')console.log('10.17.1')", "utf8");
    const required = mode === "missing-required" || mode === "required-overlap";
    const manifest = { packageManager: "pnpm@10.17.1", ...(required ? { dependencies: { fixture: "1.0.0" } } : {}),
      ...(mode === "missing-required" ? {} : { optionalDependencies: { fixture: "1.0.0" } }) };
    await writeFile(path.join(candidate, "package.json"), JSON.stringify(manifest), "utf8");
    const dependency = "      fixture:\n        specifier: 1.0.0\n        version: 1.0.0\n";
    const lock = "lockfileVersion: '9.0'\nimporters:\n  .:\n" + (required ? "    dependencies:\n" + dependency : "") + (mode === "missing-required" ? "" : "    optionalDependencies:\n" + dependency);
    await writeFile(path.join(candidate, "pnpm-lock.yaml"), lock, "utf8");
    if (mode === "wrong-optional" || mode === "escaped-optional") {
      const installed = path.join(candidate, "node_modules", "fixture"); await mkdir(installed);
      const entry = mode === "escaped-optional" ? path.join(root, "escaped.cjs") : path.join(installed, "index.cjs");
      await writeFile(entry, "module.exports={usable:true}", "utf8");
      await writeFile(path.join(installed, "package.json"), JSON.stringify({ name: "fixture", version: mode === "wrong-optional" ? "0.9.0" : "1.0.0", main: entry }), "utf8");
    }
    try {
      const pending = prepareNodeOffline({ candidatePath: candidate, sourceRepo: source,
        recipe: { id: "offline", command: process.execPath, args: [manager], nodeOffline: { nodeVersion: process.versions.node, packageManagerVersion: "10.17.1", storePath: store, readOnlySharedStores: [] } },
        onLink: () => assert.fail("fixture has no links"), execute: async (args, expectedVersion) => {
          const result = await runAuthorizedCommand({ executable: process.execPath, args, cwd: candidate, env: {}, timeoutMs: 3000, maxStdoutBytes: 65536, maxStderrBytes: 4096 });
          assert.equal(result.ok, true, result.stderrText);
          if (expectedVersion !== undefined) assert.equal(result.stdoutText.trim(), expectedVersion);
          return result;
        } });
      if (mode === "missing-optional") assert.deepEqual(await pending, [], "successful offline installation may skip optional dependencies for this platform/configuration");
      else await assert.rejects(pending, /ENOENT|required.*missing|locked version|outside.*installation/i);
    } finally { assert.equal(path.dirname(root), parent); await rm(root, { recursive: true, force: true }); }
  });
}

for (const replaced of ["candidate", "installation parent", "scoped parent"] as const) {
  test(`fixed dependency cleanup refuses a replaced ${replaced} even when the leaf identity is unchanged`, async () => {
    const parent = path.resolve(".agent_workspace/node-offline-unit"); await mkdir(parent, { recursive: true });
    const root = await mkdtemp(path.join(parent, "case-")), candidate = path.join(root, "candidate"), store = path.join(root, "store"), moved = path.join(root, "moved");
    const modules = path.join(candidate, "node_modules"), scope = path.join(modules, "@scope");
    const link = path.join(replaced === "scoped parent" ? scope : modules, "fixture");
    await mkdir(path.dirname(link), { recursive: true }); await mkdir(store); await writeFile(path.join(store, "keep.txt"), "KEEP", "utf8"); await symlink(store, link, "junction");
    try {
      const before = await lstat(link), paths = [candidate, modules, ...(replaced === "scoped parent" ? [scope] : [])];
      const observed = { path: link, target: await readlink(link), device: before.dev, inode: before.ino,
        directories: await Promise.all(paths.map(async value => { const entry = await lstat(value); return { path: await realpath(value), device: entry.dev, inode: entry.ino }; })) };
      if (replaced === "candidate") {
        await rename(candidate, moved); await mkdir(candidate); await rename(path.join(moved, "node_modules"), modules);
      } else if (replaced === "installation parent") {
        await rename(modules, moved); await mkdir(modules); await rename(path.join(moved, "fixture"), link);
      } else { await rename(scope, moved); await symlink(moved, scope, "junction"); }
      assert.equal((await lstat(link)).ino, before.ino, "the original leaf identity survives the parent replacement");
      assert.throws(() => detachNodeOfflineLinks(candidate, [observed]), /changed|link aliases|retained/i);
      assert.equal((await lstat(link)).isSymbolicLink(), true, "refusal must preserve the unchanged leaf");
      assert.equal(await readFile(path.join(store, "keep.txt"), "utf8"), "KEEP");
    } finally { assert.equal(path.dirname(root), parent); await rm(root, { recursive: true, force: true }); }
  });
}
