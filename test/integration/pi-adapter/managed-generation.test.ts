import { readPinnedPiVersions } from "../../../src/pi-compat/check.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { pathToFileURL } from "node:url";

const core = "@earendil-works/pi-agent-core";
const ai = "@earendil-works/pi-ai";
const versions = { core: "1.4.0", ai: "1.4.0" };
const repository = process.cwd();

interface Candidate {
  generationId: string;
  root: string;
  appRoot: string;
  versions: typeof versions;
}

interface CandidateModule {
  stageManagedCandidate(options: {
    programRoot: string;
    generationsRoot: string;
    expectedVersions: typeof versions;
  }): Promise<Candidate>;
}

async function candidateModule(): Promise<CandidateModule> {
  const location = pathToFileURL(path.join(repository, "src/pi-adapter/managed/candidate.ts")).href;
  const loaded = await import(location).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  }) as Partial<CandidateModule>;
  assert.equal(typeof loaded.stageManagedCandidate, "function", "managed candidate staging must be implemented");
  return loaded as CandidateModule;
}

async function json(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value), "utf8");
}

async function fixture(t: TestContext): Promise<{ root: string; program: string; generations: string }> {
  const workspace = path.join(repository, ".agent_workspace/managed-generation-tests");
  await mkdir(workspace, { recursive: true });
  const root = await mkdtemp(path.join(workspace, "case-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const program = path.join(root, "program");
  const generations = path.join(root, "generations");
  await mkdir(path.join(program, "dist"), { recursive: true });
  await mkdir(generations);
  await json(path.join(program, "package.json"), {
    name: "synthetic-program", version: "1.0.0", type: "module",
    dependencies: { [core]: "1.4.0", [ai]: "1.4.0" }
  });
  await writeFile(path.join(program, "dist/index.js"), "export const staged = true;", "utf8");
  await packageAt(path.join(program, "node_modules", core), { name: core, version: "1.4.0" });
  await packageAt(path.join(program, "node_modules", ai), { name: ai, version: "1.4.0" });
  return { root, program, generations };
}

async function packageAt(root: string, manifest: Record<string, unknown>): Promise<void> {
  await json(path.join(root, "package.json"), { type: "module", main: "index.js", ...manifest });
  await writeFile(path.join(root, "index.js"), "export const present = true;", "utf8");
}

async function stage(program: string, generations: string, expectedVersions = versions): Promise<Candidate> {
  return (await candidateModule()).stageManagedCandidate({ programRoot: program, generationsRoot: generations, expectedVersions });
}

test("managed candidate rejects mismatched or nonliteral versions before staging program code", async (t) => {
  const { program, generations } = await fixture(t);
  for (const expected of [{ core: "1.4.1", ai: "1.4.0" }, { core: "^1.4.0", ai: "1.4.0" }]) {
    await assert.rejects(stage(program, generations, expected), /version|literal/);
  }
  await json(path.join(program, "node_modules", ai, "package.json"), { name: ai, version: "1.4.1" });
  await assert.rejects(stage(program, generations), /version/);
  assert.deepEqual(await readdir(generations), [], "invalid versions must not publish or allocate a generation");
});

test("managed candidate preserves cyclic graph identity and distinct same-version peer contexts", async (t) => {
  const { program, generations } = await fixture(t);
  const modules = path.join(program, "node_modules");
  await packageAt(path.join(modules, core), { name: core, version: "1.4.0", dependencies: { left: "1", right: "1" } });
  for (const [name, value] of [["left", "L"], ["right", "R"]] as const) {
    const importer = path.join(modules, name);
    const shared = path.join(importer, "node_modules/shared");
    await packageAt(importer, { name, version: "1.0.0", dependencies: { shared: "1" } });
    await packageAt(shared, { name: "shared", version: "1.0.0", peerDependencies: { flavor: "1" } });
    await packageAt(path.join(importer, "node_modules/flavor"), { name: "flavor", version: "1.0.0" });
    await writeFile(path.join(importer, "node_modules/flavor/index.js"), `export default "${value}";`, "utf8");
    await writeFile(path.join(shared, "index.js"), 'export { default } from "flavor";', "utf8");
  }
  // Both graph nodes resolve the same canonical cycle node, which points back to left.
  await packageAt(path.join(modules, "cycle"), { name: "cycle", version: "1.0.0", dependencies: { left: "1" } });
  await json(path.join(modules, "left/package.json"), {
    name: "left", version: "1.0.0", type: "module", main: "index.js", dependencies: { shared: "1", cycle: "1" }
  });
  const candidate = await stage(program, generations);
  assert.match(candidate.generationId, /^[0-9a-f]{8}-[0-9a-f-]{27}$/);
  assert.deepEqual(candidate.versions, versions);
  const manifest = JSON.parse(await readFile(path.join(candidate.root, "candidate.json"), "utf8")) as {
    packages: Array<{ id: string; name: string; version: string }>;
  };
  assert.equal(manifest.packages.length, 9, "canonical roots are copied once despite cycles");
  assert.equal(manifest.packages.filter((item) => item.name === "shared").length, 2);
  const { createRequire } = await import("node:module");
  const stagedRequire = createRequire(path.join(candidate.appRoot, "package.json"));
  const coreRequire = createRequire(stagedRequire.resolve(`${core}/package.json`));
  const leftRoot = coreRequire.resolve("left/package.json");
  const rightRoot = coreRequire.resolve("right/package.json");
  const left = await import(pathToFileURL(createRequire(leftRoot).resolve("shared")).href) as { default: string };
  const right = await import(pathToFileURL(createRequire(rightRoot).resolve("shared")).href) as { default: string };
  assert.equal(left.default, "L");
  assert.equal(right.default, "R");
  assert.notEqual(createRequire(leftRoot).resolve("shared"), createRequire(rightRoot).resolve("shared"));
  assert.equal(createRequire(createRequire(leftRoot).resolve("cycle/package.json")).resolve("left/package.json"), leftRoot);
  assert.equal(await readFile(path.join(candidate.appRoot, "dist/index.js"), "utf8"), "export const staged = true;");
  assert.deepEqual(await readdir(candidate.appRoot), ["dist", "node_modules", "package.json"]);
});

test("managed candidate refuses missing required peers and records absent optional edges", async (t) => {
  const { program, generations } = await fixture(t);
  const coreRoot = path.join(program, "node_modules", core);
  await packageAt(coreRoot, {
    name: core, version: "1.4.0", peerDependencies: { missing_required: "1" }
  });
  await assert.rejects(stage(program, generations), /missing.*missing_required/);
  await packageAt(coreRoot, {
    name: core, version: "1.4.0",
    dependencies: { missing_optional: "1" }, optionalDependencies: { missing_optional: "1" },
    peerDependencies: { absent_peer: "1", present_peer: "1" },
    peerDependenciesMeta: { absent_peer: { optional: true }, present_peer: { optional: true } }
  });
  await packageAt(path.join(program, "node_modules/present_peer"), { name: "present_peer", version: "1.0.0" });
  const candidate = await stage(program, generations);
  const manifest = JSON.parse(await readFile(path.join(candidate.root, "candidate.json"), "utf8")) as {
    absentOptional: Array<{ name: string }>; packages: Array<{ name: string }>;
  };
  assert.deepEqual(manifest.absentOptional.map((item) => item.name).sort(), ["absent_peer", "missing_optional"]);
  assert.ok(manifest.packages.some((item) => item.name === "present_peer"));
});

test("managed application root peers are required and execute from the staged graph", async (t) => {
  const { program, generations } = await fixture(t);
  const manifestPath = path.join(program, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  await json(manifestPath, { ...manifest, peerDependencies: { controlled_sdk: "1" } });
  await assert.rejects(stage(program, generations), /missing required package: controlled_sdk/);
  assert.deepEqual(await readdir(generations), [], "missing required root peer must not allocate a candidate");
  await packageAt(path.join(program, "node_modules/controlled_sdk"), { name: "controlled_sdk", version: "1.0.0" });
  await writeFile(path.join(program, "dist/index.js"), 'export { present } from "controlled_sdk";', "utf8");
  const candidate = await stage(program, generations);
  const stagedRequire = createRequire(path.join(candidate.appRoot, "package.json"));
  assert.ok(stagedRequire.resolve("controlled_sdk").startsWith(candidate.root + path.sep));
  const entry = await import(pathToFileURL(path.join(candidate.appRoot, "dist/index.js")).href) as { present: boolean };
  assert.equal(entry.present, true, "staged application must really load its root peer");
});

test("managed candidate refuses directory aliases, escaping packages and package file links", async (t) => {
  const { root, program, generations } = await fixture(t);
  const alias = path.join(root, "alias");
  await symlink(generations, alias, "junction");
  await assert.rejects(stage(program, alias), /link|alias/);
  const packageRoot = path.join(program, "node_modules", core);
  const outside = path.join(root, "outside");
  await packageAt(outside, { name: core, version: "1.4.0" });
  await rm(packageRoot, { recursive: true });
  await symlink(outside, packageRoot, "junction");
  await assert.rejects(stage(program, generations), /installation|outside/);
  await rm(packageRoot, { recursive: true });
  await packageAt(packageRoot, { name: core, version: "1.4.0" });
  await symlink(outside, path.join(packageRoot, "unexpected"), "junction");
  await assert.rejects(stage(program, generations), /link/);
  for (const generation of await readdir(generations)) {
    await assert.rejects(readFile(path.join(generations, generation, "candidate.json"), "utf8"), /ENOENT/);
  }
});

test("managed candidate refuses unsafe dependency names rather than traversing paths", async (t) => {
  const { program, generations } = await fixture(t);
  await packageAt(path.join(program, "node_modules", core), {
    name: core, version: "1.4.0", dependencies: { "../outside": "1" }
  });
  await assert.rejects(stage(program, generations), /package name/);
});

test("managed candidate refuses destinations inside copied trees before allocating output", async (t) => {
  for (const tree of ["dist", "package"] as const) {
    await t.test(tree, async (t) => {
      const { root, program } = await fixture(t);
      const copiedTree = tree === "dist" ? path.join(program, "dist") : path.join(program, "node_modules", core);
      const destination = path.join(copiedTree, "generations");
      await mkdir(destination);
      // A source link encountered before the output tree bounds the unfixed
      // regression: it refuses copying rather than recursively filling disk.
      const empty = path.join(root, "empty");
      await mkdir(empty);
      await symlink(empty, path.join(copiedTree, "!copy-safety-link"), "junction");
      await assert.rejects(stage(program, destination), /destination.*copied/);
      assert.deepEqual(await readdir(destination), [], "refuse before allocating a recursive output tree");
    });
  }
});

function childEnvironment(state: string): NodeJS.ProcessEnv {
  return {
    ...(process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot }),
    HOME: state, USERPROFILE: state, APPDATA: state, LOCALAPPDATA: state, TEMP: state, TMP: state
  };
}

let built = false;
async function ensureFreshBuild(): Promise<void> {
  if (built) return;
  const state = path.join(repository, ".agent_workspace/managed-generation-tests/build-state");
  await mkdir(state, { recursive: true });
  const result = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"], {
    cwd: repository, env: childEnvironment(state), encoding: "utf8", timeout: 60_000,
    maxBuffer: 512 * 1024, windowsHide: true
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  built = true;
}

async function copyBootstrap(program: string): Promise<void> {
  await ensureFreshBuild();
  const source = path.join(repository, "dist/pi-adapter/managed/bootstrap.js");
  assert.ok(existsSync(source), "fresh built managed bootstrap must exist");
  const destination = path.join(program, "dist/pi-adapter/managed/bootstrap.js");
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, await readFile(source, "utf8"), "utf8");
}

function child(candidate: Candidate, code: string): { status: number | null; stdout: string; stderr: string } {
  // An allowlist prevents parent API keys, Node injection and user config from
  // entering the deterministic subprocess. The executable is already absolute.
  const state = path.join(candidate.root, "../isolated-child-state");
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    cwd: candidate.appRoot,
    env: childEnvironment(state),
    encoding: "utf8", timeout: 15_000, maxBuffer: 512 * 1024, windowsHide: true
  });
  assert.equal(result.error, undefined, `bounded child failed: ${String(result.error)}`);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function loadEntry(candidate: Candidate, entry = "index.js", expectedVersions = versions): string {
  return `const { loadManagedCandidateEntry } = await import(${JSON.stringify(pathToFileURL(path.join(candidate.appRoot, "dist/pi-adapter/managed/bootstrap.js")).href)});
    const entry = await loadManagedCandidateEntry(${JSON.stringify(candidate.root)}, ${JSON.stringify(entry)}, ${JSON.stringify(expectedVersions)});`;
}

test("managed child refuses static, delayed dynamic and CJS ancestor imports before marker evaluation", async (t) => {
  for (const form of ["static", "dynamic", "commonjs"] as const) {
    await t.test(form, async (t) => {
      const { root, program, generations } = await fixture(t);
      await copyBootstrap(program);
      const marker = path.join(root, "outside-evaluated.txt");
      const outside = path.join(root, "node_modules/outside_marker");
      await packageAt(outside, { name: "outside_marker", version: "1.0.0" });
      await writeFile(path.join(outside, "index.js"),
        `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "evaluated", "utf8");`, "utf8");
      const code = form === "static" ? 'import "outside_marker";'
        : form === "dynamic" ? 'await new Promise(resolve => setTimeout(resolve, 1)); await import("outside_marker");'
          : 'import { createRequire } from "node:module"; createRequire(import.meta.url)("outside_marker");';
      if (form === "commonjs") {
        await json(path.join(outside, "package.json"), { name: "outside_marker", version: "1.0.0", main: "index.cjs" });
        await writeFile(path.join(outside, "index.cjs"),
          `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "evaluated", "utf8");`, "utf8");
      }
      await writeFile(path.join(program, "dist/index.js"), code, "utf8");
      const candidate = await stage(program, generations);
      const result = child(candidate, loadEntry(candidate));
      assert.equal(result.status, 1);
      assert.match(result.stderr, /outside managed generation/);
      assert.equal(existsSync(marker), false, "outside module must be refused before evaluation");
    });
  }
});

test("managed child refuses missing required dependency fallback and escaping dependency junction", async (t) => {
  for (const mutation of ["missing", "escaping-link"] as const) {
    await t.test(mutation, async (t) => {
      const { root, program, generations } = await fixture(t);
      await copyBootstrap(program);
      const coreRoot = path.join(program, "node_modules", core);
      await packageAt(coreRoot, { name: core, version: "1.4.0", dependencies: { required_marker: "1" } });
      await writeFile(path.join(coreRoot, "index.js"), 'import "required_marker";', "utf8");
      await packageAt(path.join(program, "node_modules/required_marker"), { name: "required_marker", version: "1.0.0" });
      const marker = path.join(root, "required-outside-evaluated.txt");
      const outside = path.join(root, "node_modules/required_marker");
      await packageAt(outside, { name: "required_marker", version: "1.0.0" });
      await writeFile(path.join(outside, "index.js"),
        `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "evaluated", "utf8");`, "utf8");
      await writeFile(path.join(program, "dist/index.js"), `import "${core}";`, "utf8");
      const candidate = await stage(program, generations);
      const stagedCore = path.dirname(createRequire(path.join(candidate.appRoot, "package.json")).resolve(`${core}/package.json`));
      const dependency = path.join(stagedCore, "node_modules/required_marker");
      // Intentional adversarial mutation of completed candidate, outside staging API.
      await rm(dependency, { recursive: true });
      if (mutation === "escaping-link") await symlink(outside, dependency, "junction");
      const result = child(candidate, loadEntry(candidate));
      assert.equal(result.status, 1);
      assert.match(result.stderr, /outside managed generation/);
      assert.equal(existsSync(marker), false);
    });
  }
});

test("managed child checks engine manifests before entry evaluation and refuses non-file URLs", async (t) => {
  const { root, program, generations } = await fixture(t);
  await copyBootstrap(program);
  const marker = path.join(root, "entry-evaluated.txt");
  await writeFile(path.join(program, "dist/index.js"),
    `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "evaluated", "utf8");`, "utf8");
  const candidate = await stage(program, generations);
  const stagedAi = path.dirname(createRequire(path.join(candidate.appRoot, "package.json")).resolve(`${ai}/package.json`));
  await json(path.join(stagedAi, "package.json"), { name: ai, version: "1.4.1" });
  const result = child(candidate, loadEntry(candidate));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /version/);
  assert.equal(existsSync(marker), false);
  // Restore only the adversarial test mutation; production staging never updates a generation.
  await json(path.join(stagedAi, "package.json"), { name: ai, version: "1.4.0" });
  const scheme = child(candidate, `${loadEntry(candidate)} await import("data:text/javascript,export default 1");`);
  assert.equal(scheme.status, 1);
  assert.match(scheme.stderr, /unsupported module URL/);
});

test("actual copied built adapter and kernel execute one deterministic real Agent under the boundary", { timeout: 120_000 }, async (t) => {
  await ensureFreshBuild();
  assert.ok(existsSync(path.join(repository, "dist/pi-adapter/managed/bootstrap.js")), "fresh built managed bootstrap must exist");
  const { generations } = await fixture(t);
  const pins = readPinnedPiVersions(JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8")));
  const actualVersions = { core: pins.agentCore, ai: pins.ai };
  const candidate = await stage(repository, generations, actualVersions);
  assert.ok(existsSync(path.join(candidate.appRoot, "dist/pi-adapter/managed/bootstrap.js")), "fresh build includes bootstrap");
  const result = child(candidate, `${loadEntry(candidate, "pi-adapter/pi-executor.js", actualVersions)}
    const ai = await import(${JSON.stringify(ai)});
    const kernel = await import(${JSON.stringify(pathToFileURL(path.join(candidate.appRoot, "dist/pi-adapter/kernel.js")).href)});
    const faux = ai.fauxProvider({ provider: "isolated-faux", models: [{ id: "isolated", name: "Isolated" }] });
    faux.setResponses([ai.fauxAssistantMessage("isolated completed")]);
    const models = ai.createModels(); models.setProvider(faux.provider);
    const executor = new entry.PiAgentExecutor({ providerId: "isolated-faux", modelId: "isolated", models });
    const events = [];
    for await (const event of executor.execute({ runId: "run-isolated", taskId: "task-isolated", agentInstanceId: "agent-isolated", prompt: "Reply once.", workingDirectory: ${JSON.stringify(candidate.appRoot)} }, new AbortController().signal)) events.push(event);
    process.stdout.write(JSON.stringify({ calls: faux.state.callCount, pending: faux.getPendingResponseCount(), terminal: events.at(-1)?.type, text: events.filter(event => event.type === "TEXT_DELTA").map(event => event.text).join(""), kernel: typeof kernel.SparkleKernel }));`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    calls: 1, pending: 0, terminal: "EXECUTION_FINISHED", text: "isolated completed", kernel: "function"
  });
  const manifest = JSON.parse(await readFile(path.join(candidate.root, "candidate.json"), "utf8")) as {
    packages: Array<{ name: string; version: string }>;
  };
  for (const name of [core, ai]) {
    assert.equal(manifest.packages.find((item) => item.name === name)?.version, name === core ? actualVersions.core : actualVersions.ai);
  }
  assert.equal(existsSync(path.join(candidate.appRoot, "src")), false);
  assert.equal(existsSync(path.join(candidate.appRoot, ".agent_workspace")), false);
});
