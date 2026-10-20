import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Offline opt-in probe of an actual prebuilt tarball. Never installs or publishes.
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const artifact = path.resolve(process.argv[2] ?? path.join(root, ".agent_workspace/staged-continuation/sdk-package.tgz"));
const workspace = path.join(root, ".agent_workspace/staged-continuation");
await mkdir(workspace, { recursive: true });
const consumer = await mkdtemp(path.join(workspace, "sdk-consumer-"));
const packaged = path.join(consumer, "node_modules/pi-sparkle");
await mkdir(packaged, { recursive: true });
function run(command, args, cwd = consumer) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}
run("tar", ["-xf", artifact, "-C", packaged, "--strip-components=1"]);
// Reuse the existing local dependency tree offline; the package itself is extracted bytes.
await symlink(path.join(root, "node_modules"), path.join(packaged, "node_modules"), process.platform === "win32" ? "junction" : "dir");
await writeFile(path.join(consumer, "package.json"), '{"private":true,"type":"module"}\n', "utf8");
for (const name of ["context", "diagnostic"]) await copyFile(path.join(root, `examples/sdk-consumer-${name}.mts`), path.join(consumer, `${name}.mts`));
run(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2024", "--strict", "--skipLibCheck", "--typeRoots", path.join(root, "node_modules/@types"), "--outDir", "out", "context.mts", "diagnostic.mts"]);
for (const name of ["context", "diagnostic"]) run(process.execPath, [path.join(consumer, "out", `${name}.mjs`)]);
const require = createRequire(pathToFileURL(path.join(consumer, "out/context.mjs")));
assert.equal(require.resolve("pi-sparkle/package.json"), path.join(packaged, "package.json"));
const metadata = JSON.parse(await readFile(path.join(packaged, "package.json"), "utf8"));
assert.equal("exports" in metadata, false);
assert.equal("main" in metadata, false);
assert.ok(metadata.files.includes("sdk"));
await import(pathToFileURL(require.resolve("pi-sparkle/dist/domain/ids.js")).href);
for (const entry of ["src/execution/contract.ts", "extensions/pi-sparkle/index.ts"]) assert.ok((await stat(require.resolve(`pi-sparkle/${entry}`))).isFile());
assert.equal(run(process.execPath, [path.join(packaged, "dist/cli/main.js"), "--version"]), metadata.version);
console.log(JSON.stringify({ status: "PASS", artifact, consumer, examples: ["NodeNext context + FakeExecutor", "NodeNext diagnostic"], legacyPaths: ["dist/domain/ids.js", "package.json", "src/execution/contract.ts", "extensions/pi-sparkle/index.ts", "CLI --version"], dependencyReuse: path.join(root, "node_modules"), networkInstall: false, published: false }, null, 2));
