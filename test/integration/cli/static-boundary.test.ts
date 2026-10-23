import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { assignStaticTasks, type TaskAssignment } from "../../../src/routing/static-assign.js";
import type { CliLabBehavior } from "../../../src/cli/lab-behavior.js";
import { main, type CliIo } from "../../../src/cli/main.js";
import { withIsolatedPiEnv } from "../../helpers/pi-env.js";

function capture() {
  const out: string[] = [], err: string[] = [];
  const io: CliIo = { stdout: (text) => out.push(text), stderr: (text) => err.push(text) };
  return { io, out, err };
}
async function fixture(body: (value: { stateRoot: string; projectRoot: string; children: string; flowchart: string; registry: string }) => Promise<void>) {
  const parent = join(process.cwd(), ".agent_workspace", "phase0-cli");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "static-cli-"));
  const stateRoot = join(root, "state"), projectRoot = join(root, "project");
  await mkdir(projectRoot); await writeFile(join(projectRoot, "package.json"), "{}", "utf8");
  const children = join(projectRoot, "children.json"), flowchart = join(projectRoot, "flowchart.json");
  await writeFile(children, JSON.stringify({ tasks: [{ id: "tsk_cli_static", role: "scout", objective: "Inspect parser" }] }), "utf8");
  await writeFile(flowchart, JSON.stringify({ id: "static-cli", nodes: [{ id: "inspect", taskId: "tsk_inspect", role: "actor",
    objective: "Inspect parser", modelPolicy: { allowedModels: ["cheap", "premium"] }, confidenceThreshold: 0.7, approvalRequired: false }], edges: [] }), "utf8");
  const registry = join(stateRoot, "adaptation", "registry.json");
  try { await withIsolatedPiEnv(() => body({ stateRoot, projectRoot, children, flowchart, registry })); }
  finally { await rm(root, { recursive: true, force: true }); }
}
async function corrupt(registry: string) {
  await mkdir(join(registry, ".."), { recursive: true });
  await writeFile(registry, "CORRUPT_LEARNED_REGISTRY_MUST_NOT_BE_READ", "utf8");
}
for (const mode of ["ordinary", "children", "flowchart"] as const) test(`default CLI ${mode} ignores corrupt learned state`, async () => fixture(async (f) => {
  await corrupt(f.registry);
  const c = capture();
  const code = await main(["run", "--project", f.projectRoot, "--objective", "Inspect parser", "--executor", "fake", "--state-root", f.stateRoot,
    ...(mode === "children" ? ["--children", f.children] : mode === "flowchart" ? ["--flowchart", f.flowchart] : [])], c.io);
  assert.equal(code, 0, c.err.join(""));
  assert.match(c.out.join(""), /COMPLETED/);
  assert.doesNotMatch(c.out.join(""), / {2}adapt:/);
  assert.equal(await readFile(f.registry, "utf8"), "CORRUPT_LEARNED_REGISTRY_MUST_NOT_BE_READ");
}));

test("default CLI resumes a persisted flowchart without reading newly corrupt learned state", async () => fixture(async (f) => {
  await writeFile(f.flowchart, JSON.stringify({ id: "static-cli-wait", nodes: [
    { id: "gate", taskId: "tsk_gate", role: "router", objective: "Choose work", modelPolicy: { allowedModels: ["premium"] }, confidenceThreshold: 0.7, approvalRequired: true },
    { id: "work", taskId: "tsk_work", role: "actor", objective: "Inspect parser", modelPolicy: { allowedModels: ["cheap"] }, confidenceThreshold: 0.7, approvalRequired: false }
  ], edges: [{ from: "gate", to: "work", condition: { type: "success", expected: true } }] }), "utf8");
  const started = capture();
  assert.equal(await main(["run", "--project", f.projectRoot, "--objective", "Inspect parser", "--executor", "fake", "--state-root", f.stateRoot,
    "--flowchart", f.flowchart], started.io), 0, started.err.join(""));
  const runId = started.out.join("").match(/Run (run_[A-Za-z0-9_-]+):/)?.[1];
  assert.ok(runId);
  assert.match(started.out.join(""), /WAITING_FOR_USER/);
  await corrupt(f.registry);
  const { main: labMain } = await import("../../../lab/cli.js");
  const rejectedLab = capture();
  assert.equal(await labMain(["resume", "--run", runId, "--selected", "work", "--executor", "fake", "--state-root", f.stateRoot], rejectedLab.io), 1);
  assert.match(rejectedLab.err.join(""), /invalid registry snapshot/);
  const resumed = capture();
  assert.equal(await main(["resume", "--run", runId, "--selected", "work", "--executor", "fake", "--state-root", f.stateRoot], resumed.io), 0, resumed.err.join(""));
  assert.match(resumed.out.join(""), /COMPLETED/);
  assert.equal(await readFile(f.registry, "utf8"), "CORRUPT_LEARNED_REGISTRY_MUST_NOT_BE_READ");
}));

test("default children execution does not create adaptation stores", async () => fixture(async (f) => {
  const c = capture();
  assert.equal(await main(["run", "--project", f.projectRoot, "--objective", "Inspect parser", "--executor", "fake", "--state-root", f.stateRoot,
    "--children", f.children], c.io), 0, c.err.join(""));
  assert.match(c.out.join(""), /COMPLETED/);
  assert.doesNotMatch(c.out.join(""), / {2}adapt:/);
  await assert.rejects(stat(join(f.stateRoot, "adaptation")), { code: "ENOENT" });
  assert.ok((await readdir(join(f.stateRoot, "runtime", "runs"))).length >= 2, "real fake-backed coordinator and child must execute");
}));

test("repository-local lab CLI retains corrupt learned-state refusal for children and flowcharts", async () => fixture(async (f) => {
  const { main: labMain } = await import("../../../lab/cli.js");
  await corrupt(f.registry);
  for (const flag of ["--children", "--flowchart"]) {
    const c = capture();
    assert.equal(await labMain(["run", "--project", f.projectRoot, "--objective", "Inspect parser", "--state-root", f.stateRoot,
      "--executor", "fake", flag, flag === "--children" ? f.children : f.flowchart], c.io), 1);
    assert.match(c.err.join(""), /invalid registry snapshot/);
  }
  const runs = await readdir(join(f.stateRoot, "runtime", "runs"), { withFileTypes: true });
  for (const entry of runs.filter((entry) => entry.isDirectory())) {
    await assert.rejects(stat(join(f.stateRoot, "runtime", "runs", entry.name, "events.jsonl")), { code: "ENOENT" });
  }
}));

test("repository-local lab CLI applies learned selection and retains automatic feedback collection", async () => fixture(async (f) => {
  const { main: labMain } = await import("../../../lab/cli.js");
  const { ResourceRegistry } = await import("../../../src/adaptation/registry.js");
  const { saveAdaptationRegistry } = await import("../../../src/adaptation/promotion.js");
  const { routingPolicyIdentity, routingPolicyContent } = await import("../../../src/learning/learned-routing.js");
  const registry = new ResourceRegistry();
  registry.registerBaseline({ identity: routingPolicyIdentity(f.projectRoot), author: { kind: "detector", identity: "synthetic-cli" },
    content: routingPolicyContent({ primaryModelId: "premium", avoid: [], prefer: [{ family: "research", modelId: "premium" }] }) });
  await saveAdaptationRegistry(f.stateRoot, registry);
  const c = capture();
  assert.equal(await labMain(["run", "--project", f.projectRoot, "--objective", "Inspect parser", "--state-root", f.stateRoot,
    "--children", f.children], c.io), 0, c.err.join(""));
  assert.match(c.out.join(""), /tsk_cli_static \(scout, LOW\) -> premium/);
  assert.match(c.out.join(""), / {2}adapt:/);
  const feedback = await readFile(join(f.stateRoot, "adaptation", "feedback", "records.jsonl"), "utf8");
  assert.ok(feedback.trim().length > 0, "the retained lab behavior must actually write collected feedback");
}));

test("caller-owned lab assignment mutation cannot change persisted routing after children were planned", async () => fixture(async (f) => {
  let callerPlan: readonly TaskAssignment[] = [], changed = false;
  const behavior: CliLabBehavior = {
    assignChildren: async (input) => { callerPlan = assignStaticTasks(input); return callerPlan; },
    flowchartRouting: () => ({}), afterChildren: async () => ({ reason: "synthetic observation", promoted: false })
  };
  const c = capture();
  const io: CliIo = { ...c.io, stdout: (text) => {
    c.out.push(text);
    if (/Run .*: started/.test(text)) {
      changed = true;
      Reflect.set(callerPlan[0]!.decision, "model", "premium");
      Reflect.set(callerPlan[0]!.decision.eligibleModels, "0", "premium");
      Reflect.set(callerPlan[0]!, "preferredModel", "premium");
    }
  } };
  assert.equal(await main(["run", "--project", f.projectRoot, "--objective", "Inspect parser", "--state-root", f.stateRoot,
    "--children", f.children], io, { labBehavior: behavior }), 0, c.err.join(""));
  assert.equal(changed, true);
  assert.equal(callerPlan[0]!.decision.model, "premium", "the external object must actually mutate at the real progress boundary");
  const runId = c.out.join("").match(/Run (run_[A-Za-z0-9_-]+):/)?.[1]; assert.ok(runId);
  const events = (await readFile(join(f.stateRoot, "runtime", "runs", runId, "events.jsonl"), "utf8")).trim().split("\n")
    .map((line) => JSON.parse(line) as { type: string; payload: { model?: string } });
  const routed = events.filter((event) => event.type === "MODEL_ROUTED");
  assert.ok(routed.length > 0);
  assert.ok(routed.every((event) => event.payload.model === "cheap"), "persisted decisions must use the same owned plan as child execution");
  assert.match(c.out.join(""), /tsk_cli_static \(scout, LOW\) -> cheap/);
}));

test("completed children skip lab analysis after host cancellation and retain soft analysis errors", async () => fixture(async (f) => {
  let calls = 0;
  const stop = new AbortController();
  const behavior: CliLabBehavior = { assignChildren: async (input) => assignStaticTasks(input), flowchartRouting: () => ({}),
    afterChildren: async () => { calls++; throw new Error("synthetic analysis failure"); } };
  const first = capture();
  const io: CliIo = { ...first.io, stdout: (text) => { first.out.push(text); if (text.startsWith("  children:")) stop.abort(); } };
  const args = ["run", "--project", f.projectRoot, "--objective", "Inspect parser", "--state-root", f.stateRoot, "--children", f.children];
  assert.equal(await main(args, io, { signal: stop.signal, labBehavior: behavior }), 0, first.err.join(""));
  assert.equal(stop.signal.aborted, true); assert.equal(calls, 0);
  const second = capture();
  assert.equal(await main(args, second.io, { labBehavior: behavior }), 0, second.err.join(""));
  assert.equal(calls, 1);
  assert.match(second.err.join(""), /adapt skipped: synthetic analysis failure/);
}));

test("CLI lab flowchart composition accepts only the policy factory, never replacement cancellation deps", async () => fixture(async (f) => {
  let loads = 0;
  const behavior: CliLabBehavior = {
    assignChildren: async (input) => assignStaticTasks(input),
    flowchartRouting: () => {
      const returned = { signal: AbortSignal.abort(new Error("must not replace cancellation")),
        loadModelPolicyTransform: async () => { loads++; return undefined; } };
      return returned;
    },
    afterChildren: async () => ({ reason: "unused", promoted: false })
  };
  const c = capture();
  assert.equal(await main(["run", "--project", f.projectRoot, "--objective", "Inspect parser", "--state-root", f.stateRoot,
    "--executor", "fake", "--flowchart", f.flowchart], c.io, { labBehavior: behavior }), 0, c.err.join(""));
  assert.equal(loads, 1);
  assert.match(c.out.join(""), /COMPLETED/);
}));

for (const mutation of ["signal", "router"] as const) test(`flowchart composition input cannot mutate host ${mutation} when returning no policy`, async () => fixture(async (f) => {
  let keys: string[] = [];
  const behavior: CliLabBehavior = {
    assignChildren: async (input) => assignStaticTasks(input),
    flowchartRouting: (input) => {
      keys = Object.keys(input).sort();
      if (mutation === "signal") Reflect.set(input, "signal", AbortSignal.abort(new Error("INPUT_REPLACED_HOST_SIGNAL")));
      else Reflect.set(input.router, "route", () => { throw new Error("INPUT_REPLACED_HOST_ROUTER"); });
      return {};
    },
    afterChildren: async () => ({ reason: "unused", promoted: false })
  };
  const c = capture();
  assert.equal(await main(["run", "--project", f.projectRoot, "--objective", "Inspect parser", "--state-root", f.stateRoot,
    "--executor", "fake", "--flowchart", f.flowchart], c.io,
  { signal: new AbortController().signal, labBehavior: behavior }), 0, c.err.join(""));
  assert.deepEqual(keys, ["router", "stateRoot"], "composition receives no host authorization, cancellation, callbacks or owned operations");
  assert.match(c.out.join(""), /COMPLETED/);
}));

test("unblock composition input cannot replace the host state root", async () => fixture(async (f) => {
  const started = capture();
  assert.equal(await main(["run", "--project", f.projectRoot, "--objective", "Inspect parser", "--state-root", f.stateRoot,
    "--flowchart", f.flowchart], started.io), 1);
  assert.match(started.out.join(""), /BLOCKED/);
  const runId = started.out.join("").match(/Run (run_[A-Za-z0-9_-]+):/)?.[1]; assert.ok(runId);
  let keys: string[] = [];
  const behavior: CliLabBehavior = {
    assignChildren: async (input) => assignStaticTasks(input),
    flowchartRouting: (input) => { keys = Object.keys(input).sort(); Reflect.set(input, "stateRoot", `${f.stateRoot}-WRONG`); return {}; },
    afterChildren: async () => ({ reason: "unused", promoted: false })
  };
  const c = capture();
  assert.equal(await main(["unblock", "--run", runId, "--reason", "Synthetic review", "--state-root", f.stateRoot], c.io,
    { labBehavior: behavior }), 0, c.err.join(""));
  assert.deepEqual(keys, ["router", "stateRoot"]);
  assert.match(c.out.join(""), /unblocked/);
}));

for (const operation of ["inject", "pause"] as const) test(`explicit lab ${operation} retains learned refusal while default remains static`, async () => fixture(async (f) => {
  await writeFile(f.flowchart, JSON.stringify({ id: "lab-idle-review", nodes: [{ id: "gate", taskId: "tsk_gate", role: "actor",
    objective: "Inspect parser", modelPolicy: { allowedModels: ["cheap", "premium"] }, confidenceThreshold: 0.7, approvalRequired: true }], edges: [] }), "utf8");
  const started = capture();
  assert.equal(await main(["run", "--project", f.projectRoot, "--objective", "Inspect parser", "--state-root", f.stateRoot,
    "--executor", "fake", "--flowchart", f.flowchart], started.io), 0, started.err.join(""));
  assert.match(started.out.join(""), /WAITING_FOR_USER/);
  const runId = started.out.join("").match(/Run (run_[A-Za-z0-9_-]+):/)?.[1]; assert.ok(runId);
  const eventPath = join(f.stateRoot, "runtime", "runs", runId, "events.jsonl");
  const before = await readFile(eventPath, "utf8");
  await corrupt(f.registry);
  const args = [operation, "--run", runId, "--state-root", f.stateRoot,
    ...(operation === "inject" ? ["--type", "fact", "--key", "review", "--value", "synthetic"] : [])];
  const { main: labMain } = await import("../../../lab/cli.js");
  const lab = capture();
  assert.equal(await labMain(args, lab.io), 1, "explicit lab must preserve the learned-state failure");
  assert.match(lab.err.join(""), /invalid registry snapshot/);
  assert.equal(await readFile(eventPath, "utf8"), before, "failed restore must not record injection or pause as applied");
  const normal = capture();
  assert.equal(await main(args, normal.io), 0, normal.err.join(""));
  assert.match(normal.out.join(""), operation === "inject" ? /Injected fact/ : /PAUSED/);
  assert.equal(await readFile(f.registry, "utf8"), "CORRUPT_LEARNED_REGISTRY_MUST_NOT_BE_READ");
}));

test("CLI help distinguishes static children from explicit research adaptation", async () => {
  const c = capture();
  assert.equal(await main(["help"], c.io), 0);
  assert.doesNotMatch(c.out.join(""), /feedback automatically after --track\/--children/);
  assert.match(c.out.join(""), /Default\s+--children uses static routing without automatic adaptation/);
  assert.match(c.out.join(""), /lab\/cli\.ts/);
});
