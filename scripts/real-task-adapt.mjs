// Development adapter only. Existing adapt CLI, registry schema and promotion authority are unchanged.
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { proposeRealTaskResources } from "../src/lab/learning/from-real-tasks.ts";
import { materializeTaskResources, taskResourceIdentity, taskResourceTopic } from "../src/lab/adaptation/task-resources.ts";
import { evaluateRealTaskResources, readRealTaskJson } from "../src/lab/adaptation/eval-real-tasks.ts";
import { loadAdaptationRegistry, loadAdaptationRegistryOrNew, saveAdaptationRegistry, withAdaptationRegistryLock } from "../src/lab/adaptation/promotion.ts";
import { parseDevelopmentTaskSpec } from "../src/development/task-spec.ts";
import { isResourceVersionId } from "../src/domain/ids.ts";

const USAGE = `Development-only resource adapter. Propose/materialize/evaluate never execute commands or models.
Run with: node --import tsx scripts/real-task-adapt.mjs <propose|materialize|evaluate|execute>
  propose --state-root <dir> --project <root> --topic <operator-selected class> --input <JSON array of existing record paths> [--check-launchers <exact conversion JSON>] [--model-selection <fixed triple JSON>] [--context-files <JSON-array-file>]
  materialize --state-root <dir> --project <root> --input <TaskSpec JSON> --task-id <logical-id> --revision <Git SHA> --topics <comma-separated topics> [--prepare-binding <host-selected binding JSON>] [--check-bindings <host-authorized original checks and selections JSON>]
  evaluate --state-root <dir> --project <root> --topic <topic> --version <rsv_...> --input <JSON array of trial file references>
  execute --state-root <dir> --project <logical root> --source <isolated committed repo> --input <reviewed materialized JSON> --model-authority <separate trusted host approval JSON>
Topics: node-preparation, host-only-checks, input-validation, check-recipes, model-thinking, context-rule.
Context-rule proposals require --context-files with explicit nonempty fixed candidate-relative files.
Source references describe an operator-selected hypothesis, not diagnosed omissions or demonstrated benefit.
Context-rule consumption and overall real-task evaluation remain UNOBSERVED; conclusion stays unclear.
Materialize writes JSON to stdout only; host must review and explicitly run its spec. It never runs prepare commands.
Only explicit execute runs a single-attempt fixed model-thinking recipe through the original task-run pipeline; provider calls may incur charges. It requires an active version, unchanged source and a separate approved enabled same-provider profile, disables implicit fallback, caps reference budget at US$5, and always retains candidates. No apply, review stdin, promotion or global configuration change.
Node workflow evaluation stays UNOBSERVED: existing preflight artifacts do not bind preparation argv.
Use existing adapt show/promote --review-file --approve/rollback for owner decisions; a missing baseline is never initialized here.
`;
function required(value, label) { if (typeof value !== "string" || !value.trim()) throw Error(`${label} required`); return value; }
async function main() {
  const [command, ...args] = process.argv.slice(2);
  const { values } = parseArgs({ args, strict: true, options: { "state-root": { type: "string" }, project: { type: "string" }, source: { type: "string" }, input: { type: "string" },
    "task-id": { type: "string" }, revision: { type: "string" }, topics: { type: "string" }, topic: { type: "string" }, version: { type: "string" },
    "prepare-binding": { type: "string" }, "check-launchers": { type: "string" }, "check-bindings": { type: "string" }, "model-selection": { type: "string" }, "model-authority": { type: "string" }, "context-files": { type: "string" }, help: { type: "boolean" } } });
  if (values.help || command === undefined || command === "--help") { process.stdout.write(USAGE); return; }
  if (!["propose", "materialize", "evaluate", "execute"].includes(command)) throw Error("unknown development adapter operation");
  const stateRoot = path.resolve(required(values["state-root"], "--state-root")), projectRoot = path.resolve(required(values.project, "--project"));
  const inputFile = path.resolve(required(values.input, "--input"));
  let result;
  if (command === "propose") {
    const files = await readRealTaskJson(inputFile);
    if (!Array.isArray(files) || files.some(file => typeof file !== "string")) throw Error("proposal input must list existing record paths");
    const sourceRecords = [];
    for (const file of files) {
      const ref = path.resolve(path.dirname(inputFile), file), raw = await readRealTaskJson(ref);
      // Drop free text immediately; proposal construction never retains transcripts/prompts from a record.
      const record = raw && typeof raw === "object" ? { id: raw.id, date: raw.date, source: raw.source, arm: raw.arm, status: raw.status,
        failureClass: raw.failureClass, kept: raw.kept, accepted: raw.accepted, escapedDefects: raw.escapedDefects } : raw;
      sourceRecords.push({ ref, record });
    }
    result = await withAdaptationRegistryLock(stateRoot, async () => {
      const registry = await loadAdaptationRegistryOrNew(stateRoot), before = registry.snapshot().candidates.length;
      const packets = proposeRealTaskResources({ registry, projectRoot, topic: taskResourceTopic(values.topic), sourceRecords,
        ...(values["check-launchers"] === undefined ? {} : { checkRecipeLaunchers: await readRealTaskJson(values["check-launchers"]) }),
        ...(values["model-selection"] === undefined ? {} : { modelSelection: await readRealTaskJson(values["model-selection"]) }),
        ...(values["context-files"] === undefined ? {} : { contextFiles: await readRealTaskJson(values["context-files"]) }) });
      if (registry.snapshot().candidates.length !== before) await saveAdaptationRegistry(stateRoot, registry);
      return packets;
    });
  } else {
    const registry = await loadAdaptationRegistry(stateRoot);
    if (command === "execute") {
      const { executeMaterializedTaskResources } = await import("../src/cli/real-task-resource-execution.ts");
      process.exitCode = await executeMaterializedTaskResources({ registry, stateRoot, projectRoot, sourceRepo: path.resolve(required(values.source, "--source")), materialized: await readRealTaskJson(inputFile),
        authority: await readRealTaskJson(path.resolve(required(values["model-authority"], "--model-authority"))),
        io: { stdout: text => process.stdout.write(text), stderr: text => process.stderr.write(text) } });
      return;
    } else if (command === "materialize") {
      result = materializeTaskResources({ registry, projectRoot, logicalTaskId: required(values["task-id"], "--task-id"),
        sourceRevision: required(values.revision, "--revision"), spec: parseDevelopmentTaskSpec(await readFile(inputFile, "utf8")),
        topics: required(values.topics, "--topics").split(",").map(taskResourceTopic),
        ...(values["prepare-binding"] === undefined ? {} : { preparationBinding: await readRealTaskJson(values["prepare-binding"]) }),
        ...(values["check-bindings"] === undefined ? {} : { checkRecipeBindings: await readRealTaskJson(values["check-bindings"]) }) });
    } else {
      const topic = taskResourceTopic(values.topic), trials = await readRealTaskJson(inputFile);
      if (!Array.isArray(trials)) throw Error("evaluation input must list trial file references");
      const resolved = trials.map(trial => {
        if (!trial || typeof trial !== "object" || Array.isArray(trial)) throw Error("invalid trial file references");
        return Object.fromEntries(Object.entries(trial).map(([key, file]) => {
          if (!["recordFile", "inputFile", "contractFile", "eventsFile", "checkFile", "preflightFile", "loopFile"].includes(key) || typeof file !== "string") throw Error("invalid trial file reference");
          return [key, path.resolve(path.dirname(inputFile), file)];
        }));
      });
      if (!isResourceVersionId(values.version)) throw Error("--version must be a resource version id");
      result = await evaluateRealTaskResources({ registry, identity: taskResourceIdentity(projectRoot, topic), versionId: values.version, trials: resolved });
    }
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href) {
  main().catch(error => { process.stderr.write(`${error instanceof SyntaxError ? "Invalid JSON input" : error.message}\n`); process.exitCode = 1; });
}
