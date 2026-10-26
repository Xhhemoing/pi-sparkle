import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const UNKNOWN = "unknown";
const MAX_PHASE_SECONDS = 7 * 24 * 60 * 60;
const FAILURE_CLASSES = ["model", "contract", "tool", "environment", "provider", "run"];
const STATUSES = ["COMPLETED", "FAILED", "CANCELLED", "TIMEOUT", "REFUSED", "PREFLIGHT_FAILED", "ERROR", UNKNOWN];
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const fail = message => { throw new Error(message); };

export function localDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) fail("date must be a valid local YYYY-MM-DD");
  return value;
}
function text(value, name, limit = 2000) {
  if (typeof value !== "string" || !value.trim() || value.length > limit || [...value].some(character => { const code = character.charCodeAt(0); return code < 32 && code !== 9 && code !== 10 && code !== 13; })) fail(`${name} must be non-empty text (max ${limit})`);
  return value;
}
function bool(value, name) {
  if (value === undefined || value === UNKNOWN) return UNKNOWN;
  if (typeof value !== "boolean") fail(`${name} must be boolean or unknown`);
  return value;
}
function number(value, name, maximum, integer = false) {
  if (value === undefined || value === UNKNOWN) return UNKNOWN;
  if (!finite(value) || value > maximum || (integer && !Number.isSafeInteger(value))) fail(`${name} must be a bounded non-negative ${integer ? "integer" : "number"}`);
  return value;
}
function phase(value, name) {
  if (isObject(value)) {
    const timestamp = input => typeof input === "string" && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input) && Number.isFinite(Date.parse(input));
    if (!timestamp(value.start) || !timestamp(value.end)) fail(`${name} requires start/end timestamps with timezone`);
    value = (Date.parse(value.end) - Date.parse(value.start)) / 1000;
  }
  return number(value, name, MAX_PHASE_SECONDS);
}
function validateMetadata(meta) {
  if (!isObject(meta)) fail("metadata must be an object");
  const id = text(meta.id, "id", 80);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id)) fail("invalid id");
  if (!["pi-sparkle", "soul"].includes(meta.source)) fail("source must be pi-sparkle or soul");
  if (!["sparkle", "direct-pi"].includes(meta.arm)) fail("arm must be sparkle or direct-pi");
  if (meta.failureClass !== undefined && !FAILURE_CLASSES.includes(meta.failureClass)) fail("invalid failureClass (see src/routing/outcomes.ts)");
  if (meta.status !== undefined && !STATUSES.includes(meta.status)) fail("invalid status");
  if (meta.phases !== undefined && !isObject(meta.phases)) fail("phases must be an object");
  const result = { id, date: localDate(meta.date), source: meta.source, arm: meta.arm,
    objective: text(meta.objective, "objective"), taskSpecMinutes: number(meta.taskSpecMinutes, "taskSpecMinutes", MAX_PHASE_SECONDS / 60),
    phases: Object.fromEntries(["prepare", "model", "check", "review"].map(name => [name, phase(meta.phases?.[name], name)])),
    status: meta.status ?? UNKNOWN, accepted: bool(meta.accepted, "accepted"), effectsSettled: bool(meta.effectsSettled, "effectsSettled"),
    applied: bool(meta.applied, "applied"), reviewed: bool(meta.reviewed, "reviewed"), kept: bool(meta.kept, "kept"),
    interventions: number(meta.interventions, "interventions", Number.MAX_SAFE_INTEGER, true),
    escapedDefects: number(meta.escapedDefects, "escapedDefects", Number.MAX_SAFE_INTEGER, true) };
  // Only these owner-entered summaries are retained; no projection bodies or arbitrary metadata.
  for (const name of ["failureClass", "rootCause", "notes", "linkedPR", "branch", "model", "thinking", "comparisonId", "sourceRevision", "checkEvidence"]) {
    if (meta[name] !== undefined) result[name] = text(meta[name], name);
  }
  return result;
}
async function captureProjection(file) {
  if (file === undefined) return [];
  const input = (await readFile(file, "utf8")).replace(/^\uFEFF/, "").trim();
  if (!input) fail("projection capture is empty");
  let rows;
  try { const parsed = JSON.parse(input); rows = Array.isArray(parsed) ? parsed : [parsed]; }
  catch { rows = input.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line)); }
  if (rows.some(row => !isObject(row))) fail("projection rows must be objects");
  return rows;
}
function project(result, rows) {
  if (result.arm === "direct-pi" && rows.some(row => typeof row.type === "string" && row.type.startsWith("TASKSPEC_"))) fail("direct-pi cannot use TaskSpec projection authority");
  const executions = rows.filter(row => row.type === "TASKSPEC_EXECUTION");
  if (executions.length > 1) fail("capture must describe one execution attempt");
  const execution = executions[0];
  const operatorChecked = result.arm === "direct-pi" && result.reviewed === true && typeof result.checkEvidence === "string";
  if (!operatorChecked) {
    result.accepted = UNKNOWN;
    result.effectsSettled = UNKNOWN;
  }
  result.applied = UNKNOWN;
  const actions = rows.filter(row => ["TASKSPEC_APPLICATION", "TASKSPEC_DISPOSAL"].includes(row.type));
  const runId = execution?.runId ?? actions[0]?.runId;
  if (runId !== undefined && (typeof runId !== "string" || !/^run_[A-Za-z0-9_-]{1,96}$/.test(runId))) fail("invalid projection runId");
  if (actions.some(row => row.runId !== runId)) fail("conflicting projection runId");
  if (execution !== undefined) {
    if (!["COMPLETED", "FAILED", "CANCELLED"].includes(execution.status)) fail("invalid execution status");
    result.status = execution.status;
    // Missing fields remain unknown; metadata cannot supply absent projection evidence.
    result.accepted = bool(execution.accepted, "projection accepted");
    result.effectsSettled = bool(execution.effectsSettled, "projection effectsSettled");
    result.applied = UNKNOWN;
    const code = execution.refusal?.code;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_-]{0,79}$/.test(code)) result.refusalCode = code;
  }
  for (const action of actions) {
    const expected = action.type === "TASKSPEC_APPLICATION" ? "APPLIED" : "DISPOSED";
    if (action.status !== expected) fail("invalid terminal action status");
    result.terminalAction = expected;
    if (expected === "APPLIED") {
      result.applicationStatus = expected;
      result.applied = true;
    } else {
      result.disposalStatus = expected;
      if (result.applied !== true) result.applied = false;
    }
  }
  if (runId !== undefined) result.runId = runId;
  return result;
}
async function boundChildCostRun(stateRoot, parent, report) {
  if (!isObject(report) || typeof report.runId !== "string" || !/^run_[A-Za-z0-9_-]{1,96}$/.test(report.runId) ||
      typeof report.taskId !== "string") return false;
  let events;
  try { events = await readFile(path.join(stateRoot, "runtime", "runs", parent, "events.jsonl"), "utf8"); }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
  for (const line of events.split(/\r?\n/).filter(line => line.trim())) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const child = event?.payload?.childRun;
    if (event?.type === "CHILD_RUN_CREATED" && event.runId === parent && event.taskId === report.taskId &&
        child?.id === report.runId && child.parentRunId === parent && child.rootTaskId === report.taskId) return true;
  }
  return false;
}
async function costPopulation(file, result, rows, stateRoot) {
  if (file === undefined) return { runIds: result.runId === undefined ? [] : [result.runId], complete: false };
  const envelope = JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
  const body = envelope?.body, attempts = body?.attempts;
  if (!isObject(envelope) || envelope.schemaVersion !== "loop-artifact-v2" || typeof envelope.id !== "string" ||
      !/^art_v2_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(envelope.id) ||
      result.runId === undefined || envelope.runId !== result.runId || !isObject(body) || body.kind !== "native-write-loop" ||
      body.schemaVersion !== 1 || !Array.isArray(attempts) || attempts.length === 0) fail("loop artifact must describe this native-write-loop execution");
  const runIds = [];
  for (const [index, attempt] of attempts.entries()) {
    if (!isObject(attempt) || attempt.number !== index + 1 || typeof attempt.runId !== "string" ||
        !/^run_[A-Za-z0-9_-]{1,96}$/.test(attempt.runId) || runIds.includes(attempt.runId)) fail("loop artifact attempts require unique sequential run identities");
    runIds.push(attempt.runId);
  }
  if (runIds.at(-1) !== result.runId) fail("loop artifact final attempt must match projection runId");
  const execution = rows.find(row => row.type === "TASKSPEC_EXECUTION");
  if (execution === undefined) fail("loop artifact requires execution projection");
  for (const key of ["candidatePath", "sourceRevision"]) {
    if (execution[key] !== undefined && body[key] !== execution[key]) fail(`loop artifact ${key} does not match execution`);
  }
  // Native attempts identify parent task runs; the cost ledger and invocation
  // sink identify their actual workers. Resolve that distinction through the
  // persisted parent-child event, never from an arbitrary receipt ID alone.
  let complete = true;
  const workers = [];
  for (const [index, parent] of runIds.entries()) {
    const report = body.referenceCost?.attempts?.[index]?.report;
    if (report === undefined || report?.runId === parent) { workers.push(parent); continue; }
    if (!runIds.includes(report?.runId) && await boundChildCostRun(stateRoot, parent, report)) workers.push(report.runId);
    else { workers.push(parent); complete = false; }
  }
  if (new Set(workers).size !== workers.length) { complete = false; workers.splice(0, workers.length, ...runIds); }
  return { runIds: workers, complete, referenceCost: body.referenceCost };
}
function costReportAmount(report, runId, requireComplete) {
  const counter = value => Number.isSafeInteger(value) && value >= 0;
  const coverage = value => ["complete", "partial", "unknown"].includes(value);
  const ledger = report?.ledger;
  if (!isObject(report) || report.runId !== runId || typeof report.taskId !== "string" ||
      typeof report.agentInstanceId !== "string" || !coverage(report.coverage) || typeof report.settled !== "boolean" ||
      (requireComplete && (report.coverage !== "complete" || !report.settled)) ||
      !finite(report.knownReferenceUsd) || !counter(report.streamDispatches) || !isObject(ledger) ||
      !counter(ledger.turns) || ledger.turns > report.streamDispatches || !counter(ledger.turnsWithoutUsage) ||
      ledger.turnsWithoutUsage > ledger.turns || !counter(ledger.tokensIn) || !counter(ledger.tokensOut) ||
      (requireComplete && (ledger.turns !== report.streamDispatches || ledger.turnsWithoutUsage !== 0 || !finite(ledger.spentUsd))) ||
      (ledger.spentUsd !== undefined && (!finite(ledger.spentUsd) || ledger.spentUsd !== report.knownReferenceUsd))) return undefined;
  return report.knownReferenceUsd;
}
function nativeCostAmount(summary, runIds, requireComplete) {
  const coverage = value => ["complete", "partial", "unknown"].includes(value);
  if (!isObject(summary) || !coverage(summary.coverage) || typeof summary.settled !== "boolean" ||
      (requireComplete && (summary.coverage !== "complete" || !summary.settled)) ||
      !finite(summary.maxReferenceUsd) || summary.maxReferenceUsd <= 0 || !finite(summary.knownReferenceUsd) ||
      (requireComplete && summary.remainingReferenceUsd === undefined) ||
      (summary.remainingReferenceUsd !== undefined && (typeof summary.remainingReferenceUsd !== "number" ||
        !Number.isFinite(summary.remainingReferenceUsd) || summary.remainingReferenceUsd !== summary.maxReferenceUsd - summary.knownReferenceUsd)) ||
      !Array.isArray(summary.attempts) || summary.attempts.length !== runIds.length) return undefined;
  let total = 0;
  for (const [index, attempt] of summary.attempts.entries()) {
    if (!isObject(attempt) || attempt.number !== index + 1 ||
        (attempt.fault !== undefined && (requireComplete || typeof attempt.fault !== "string")) ||
        !finite(attempt.offeredReferenceUsd) || attempt.offeredReferenceUsd <= 0) return undefined;
    const amount = costReportAmount(attempt.report, runIds[index], requireComplete);
    if (amount === undefined) return undefined;
    total += amount;
  }
  return finite(total) && total === summary.knownReferenceUsd ? total : undefined;
}
async function directCostObservation(file) {
  const value = JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
  const report = value?.cost;
  if (typeof report?.runId !== "string" || !/^run_[A-Za-z0-9_-]{1,96}$/.test(report.runId)) fail("invalid direct cost report runId");
  const amount = costReportAmount(report, report.runId, false);
  if (amount === undefined) fail("invalid direct cost report");
  // This is a host-observed subtotal, not invocation/pricing provenance and
  // never TaskSpec acceptance or apply authority, even if the report is complete.
  return { referenceUsd: UNKNOWN, cost: { reason: "direct host subtotal; complete reference cost remains unverified",
    invocationCount: 0, knownLowerBoundUsd: amount, reportRunId: report.runId } };
}
async function costForRun(stateRoot, population) {
  let knownLowerBoundUsd = 0, invocationCount = 0;
  const receiptUsd = nativeCostAmount(population.referenceCost, population.runIds, true);
  const observedReceiptUsd = nativeCostAmount(population.referenceCost, population.runIds, false);
  const issues = new Set(), ids = new Set(), observedRuns = new Set();
  const report = () => ({ referenceUsd: issues.size ? UNKNOWN : receiptUsd,
    cost: { reason: [...issues].join("; ") || "complete worker population and real invocation usage/pricing",
      invocationCount, knownLowerBoundUsd: Math.max(knownLowerBoundUsd, observedReceiptUsd ?? 0) } });
  if (!population.complete) issues.add("complete worker population unavailable");
  if (receiptUsd === undefined) issues.add("complete independent native cost receipt unavailable");
  if (population.runIds.length === 0) { issues.add("no runId evidence"); return report(); }
  let input;
  try { input = await readFile(path.join(stateRoot, "runtime", "invocations.jsonl"), "utf8"); }
  catch (error) { if (error.code === "ENOENT") { issues.add("invocation log missing"); return report(); } throw error; }
  if (input && !input.endsWith("\n")) issues.add("invocation log has incomplete final line");
  // Parse independently: a later corrupt/torn row must not erase previously observed spend.
  for (const line of input.split(/\r?\n/).filter(line => line.trim())) {
    let row;
    try { row = JSON.parse(line); } catch { issues.add("invocation log contains corrupt JSON"); continue; }
    if (!isObject(row) || typeof row.runId !== "string" || typeof row.id !== "string") { issues.add("invocation log contains malformed row"); continue; }
    if (!population.runIds.includes(row.runId)) continue;
    invocationCount++;
    observedRuns.add(row.runId);
    if (ids.has(row.id)) { issues.add("duplicate invocation identity"); continue; }
    ids.add(row.id);
    if (row.callOutcome !== "ok" || row.attempt !== 1) issues.add("failed or internally retried call has incomplete attempt usage");
    const priced = row.executorClass === "pi" && row.cacheHit === false &&
      Number.isSafeInteger(row.tokensIn) && row.tokensIn >= 0 && Number.isSafeInteger(row.tokensOut) && row.tokensOut >= 0 &&
      isObject(row.pricing) && typeof row.pricing.catalogVersion === "string" && row.pricing.catalogVersion.trim() &&
      finite(row.pricing.inputUsdPerMTok) && finite(row.pricing.outputUsdPerMTok) &&
      (row.pricing.inputUsdPerMTok > 0 || row.pricing.outputUsdPerMTok > 0);
    if (!priced) { issues.add("call usage, provenance or pricing incomplete"); continue; }
    const usd = (row.tokensIn * row.pricing.inputUsdPerMTok + row.tokensOut * row.pricing.outputUsdPerMTok) / 1_000_000;
    if (!finite(usd) || !finite(knownLowerBoundUsd + usd)) { issues.add("reference cost is not finite"); continue; }
    knownLowerBoundUsd += usd;
  }
  if (population.runIds.some(runId => !observedRuns.has(runId))) issues.add("invocations missing for worker attempt");
  if (receiptUsd !== undefined) {
    if (receiptUsd < knownLowerBoundUsd) issues.add("native cost receipt is below parsed invocation subtotal");
    else knownLowerBoundUsd = receiptUsd;
  }
  return report();
}
// Refuse symlink/junction parents, so even pre-existing workspace links cannot redirect writes.
export async function privateRecordsRoot(root, create = false) {
  const physicalRoot = await realpath(path.resolve(root));
  let current = physicalRoot;
  for (const name of [".agent_workspace", "real-tasks"]) {
    current = path.join(current, name);
    if (create) {
      try { await mkdir(current); } catch (error) { if (error.code !== "EEXIST") throw error; }
    }
    let info;
    try { info = await lstat(current); } catch (error) { if (!create && error.code === "ENOENT") return undefined; throw error; }
    if (info.isSymbolicLink() || !info.isDirectory()) fail("private record parent must be a physical directory");
  }
  return current;
}
export function correctDelivery(result) {
  if (result.accepted === false || result.effectsSettled === false || result.kept === false ||
      (typeof result.escapedDefects === "number" && result.escapedDefects > 0) ||
      (result.terminalAction === "DISPOSED" && result.applied !== true) ||
      ["FAILED", "CANCELLED", "TIMEOUT", "REFUSED", "PREFLIGHT_FAILED", "ERROR"].includes(result.status)) return false;
  if (result.arm === "direct-pi" && (result.runId !== undefined || result.reviewed !== true || typeof result.checkEvidence !== "string" || !result.checkEvidence.trim())) return UNKNOWN;
  return result.status === "COMPLETED" && result.accepted === true && result.effectsSettled === true &&
    result.reviewed === true && result.kept === true && result.escapedDefects === 0 ? true : UNKNOWN;
}
async function updateRecord(root, meta) {
  if (!isObject(meta)) fail("update metadata must be an object");
  const identity = validateMetadata({ id: meta.id, date: meta.date, source: meta.source, arm: meta.arm, objective: "review observation" });
  const allowed = ["id", "date", "source", "arm", "reviewed", "kept", "escapedDefects", "interventions", "notes", "rootCause", "failureClass", "linkedPR", "branch", "phases", "checkEvidence", "accepted", "effectsSettled"];
  if (Object.keys(meta).some(key => !allowed.includes(key))) fail("update may change only explicit review observations");
  if (meta.phases !== undefined && (!isObject(meta.phases) || Object.keys(meta.phases).some(key => key !== "review"))) fail("update may change only review phase");
  const parent = await privateRecordsRoot(root);
  if (parent === undefined) fail("record does not exist");
  const directory = path.join(parent, `${identity.date}-${identity.id}`), output = path.join(directory, "record.json");
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) fail("record directory must be physical");
  const info = await lstat(output);
  if (!info.isFile() || info.isSymbolicLink()) fail("record must be a physical file");
  const result = JSON.parse((await readFile(output, "utf8")).replace(/^\uFEFF/, ""));
  if (!isObject(result) || ["id", "date", "source", "arm"].some(key => result[key] !== identity[key])) fail("record identity mismatch");
  for (const key of ["reviewed", "kept"]) if (Object.hasOwn(meta, key)) result[key] = bool(meta[key], key);
  for (const key of ["escapedDefects", "interventions"]) if (Object.hasOwn(meta, key)) result[key] = number(meta[key], key, Number.MAX_SAFE_INTEGER, true);
  for (const key of ["notes", "rootCause", "failureClass", "linkedPR", "branch", "checkEvidence"]) {
    if (Object.hasOwn(meta, key)) {
      if (key === "failureClass" && !FAILURE_CLASSES.includes(meta[key])) fail("invalid failureClass");
      result[key] = text(meta[key], key);
    }
  }
  if (meta.phases !== undefined && Object.hasOwn(meta.phases, "review")) {
    if (!isObject(result.phases)) fail("existing phases are malformed");
    result.phases.review = phase(meta.phases.review, "review");
  }
  for (const key of ["accepted", "effectsSettled"]) {
    if (Object.hasOwn(meta, key)) {
      if (result.arm !== "direct-pi" || result.runId !== undefined || result.reviewed !== true ||
          typeof result.checkEvidence !== "string" || !result.checkEvidence.trim()) fail("only independently reviewed direct-pi may backfill acceptance");
      result[key] = bool(meta[key], key);
    }
  }
  result.correctDelivery = correctDelivery(result);
  // Single-operator dev workflow: replace atomically, leaving original bytes on validation/write failure.
  const temporary = path.join(directory, `.record-${process.pid}.update`);
  let owned = false;
  try {
    await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    owned = true;
    await rename(temporary, output);
    owned = false;
  } finally {
    if (owned) await unlink(temporary);
  }
  return output;
}

// Create: node scripts/real-task-record.mjs --root . --metadata attempt.json --projection run.jsonl --state-root C:/private/sparkle-state
// Backfill: node scripts/real-task-record.mjs --root . --metadata review.json --update
// review.json contains identity + review observations only; execution and cost cannot be changed.
// Direct Pi can supply accepted/effectsSettled at creation or review backfill only with reviewed:true and checkEvidence referencing independent checks.
// Direct host cost subtotal: --direct-cost-report <runner-result.json>; full cost remains unknown.
// Same-day comparison arms use distinct attempt ids and a shared comparisonId; date-id paths never overwrite.
async function main() {
  const { values } = parseArgs({ options: { root: { type: "string" }, metadata: { type: "string" }, projection: { type: "string" }, "loop-artifact": { type: "string" }, "direct-cost-report": { type: "string" }, "state-root": { type: "string" }, update: { type: "boolean" } }, strict: true });
  if (!values.root || !values.metadata) fail("Usage: node scripts/real-task-record.mjs --root <repo> --metadata <json> [--projection <json|jsonl>] [--state-root <dir>] [--loop-artifact <native-write-loop.json>] [--direct-cost-report <runner-result.json>] | --update");
  const metadata = JSON.parse((await readFile(values.metadata, "utf8")).replace(/^\uFEFF/, ""));
  if (values.update) {
    if (values.projection !== undefined || values["state-root"] !== undefined || values["loop-artifact"] !== undefined || values["direct-cost-report"] !== undefined) fail("update refuses execution and cost evidence options");
    const output = await updateRecord(values.root, metadata);
    process.stdout.write(`${JSON.stringify({ path: output })}\n`);
    return;
  }
  const rows = await captureProjection(values.projection);
  const result = project(validateMetadata(metadata), rows);
  const stateRoot = path.resolve(values["state-root"] ?? path.join(homedir(), ".pi-sparkle"));
  if (values["direct-cost-report"] !== undefined) {
    if (result.arm !== "direct-pi" || values.projection !== undefined || values["loop-artifact"] !== undefined) fail("direct cost report requires direct-pi without TaskSpec evidence");
    Object.assign(result, await directCostObservation(values["direct-cost-report"]));
  } else {
    const population = await costPopulation(values["loop-artifact"], result, rows, stateRoot);
    Object.assign(result, await costForRun(stateRoot, population));
  }
  result.correctDelivery = correctDelivery(result);
  const parent = await privateRecordsRoot(values.root, true);
  const directory = path.join(parent, `${result.date}-${result.id}`);
  try { await mkdir(directory); } catch (error) { if (error.code !== "EEXIST") throw error; }
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) fail("record directory must be physical");
  const output = path.join(directory, "record.json");
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${JSON.stringify({ path: output })}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof SyntaxError ? "Invalid JSON input" : error.message); process.exitCode = 1; });
}
