import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { correctDelivery, localDate, privateRecordsRoot } from "./real-task-record.mjs";

const UNKNOWN = "unknown";
const finite = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const fail = message => { throw new Error(message); };
const measurement = values => {
  const known = values.filter(finite);
  return { knownTotal: known.reduce((sum, value) => sum + value, 0), unknownAttempts: values.length - known.length };
};
function group(records, field) {
  const counts = {};
  for (const row of records) {
    const key = typeof row[field] === "string" ? row[field] : UNKNOWN;
    Object.defineProperty(counts, key, { value: (Object.hasOwn(counts, key) ? counts[key] : 0) + 1, enumerable: true, configurable: true });
  }
  return counts;
}
function observedUsd(row) {
  return finite(row.referenceUsd) ? row.referenceUsd : finite(row.cost?.knownLowerBoundUsd) ? row.cost.knownLowerBoundUsd : 0;
}
function aggregate(records) {
  const costs = measurement(records.map(row => row.referenceUsd));
  return { attempts: records.length, bySource: group(records, "source"), byArm: group(records, "arm"),
    byStatus: group(records, "status"), byFailureClass: group(records, "failureClass"), byRootCause: group(records, "rootCause"),
    correctDeliveries: records.filter(row => correctDelivery(row) === true).length,
    correctDeliveryUnknown: records.filter(row => typeof correctDelivery(row) !== "boolean").length,
    interventions: measurement(records.map(row => row.interventions)),
    escapedDefects: measurement(records.map(row => row.escapedDefects)),
    taskSpecMinutes: measurement(records.map(row => row.taskSpecMinutes)),
    phases: Object.fromEntries(["prepare", "model", "check", "review"].map(name => [name, measurement(records.map(row => row.phases?.[name]))])),
    cost: { knownUsd: records.reduce((sum, row) => sum + observedUsd(row), 0), unknownAttempts: costs.unknownAttempts, totalUsd: costs.unknownAttempts ? UNKNOWN : costs.knownTotal } };
}
async function recordsAt(root) {
  const directory = await privateRecordsRoot(root);
  if (directory === undefined) return [];
  const records = [], identities = new Set();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) fail("linked record directory is not supported");
    if (!entry.isDirectory()) continue;
    const file = path.join(directory, entry.name, "record.json");
    let info;
    try { info = await lstat(file); } catch (error) { if (error.code === "ENOENT") fail(`record missing in ${entry.name}`); throw error; }
    if (!info.isFile() || info.isSymbolicLink()) fail("record must be a physical file");
    const row = JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
    if (row === null || typeof row !== "object" || Array.isArray(row) || typeof row.id !== "string" ||
        !["pi-sparkle", "soul"].includes(row.source) || !["sparkle", "direct-pi"].includes(row.arm)) fail("invalid task record identity");
    localDate(row.date);
    if (row.referenceUsd !== undefined && row.referenceUsd !== UNKNOWN && !finite(row.referenceUsd)) fail("invalid task reference cost");
    if (row.cost?.knownLowerBoundUsd !== undefined && (!finite(row.cost.knownLowerBoundUsd) ||
        (finite(row.referenceUsd) && row.cost.knownLowerBoundUsd > row.referenceUsd))) fail("invalid known cost lower bound");
    const identity = JSON.stringify([row.source, row.arm, row.id]);
    if (identities.has(identity)) fail(`duplicate task identity: ${row.source}/${row.arm}/${row.id}`);
    identities.add(identity);
    records.push(row);
  }
  return records;
}
async function main() {
  const { values } = parseArgs({ options: { root: { type: "string" }, week: { type: "string" }, json: { type: "boolean" } }, strict: true });
  if (!values.root || !values.week) fail("Usage: node scripts/real-task-summary.mjs --root <repo> --week <YYYY-MM-DD Monday> [--json]");
  const start = localDate(values.week);
  if (new Date(`${start}T00:00:00Z`).getUTCDay() !== 1) fail("--week must be an ISO Monday");
  const end = new Date(Date.parse(`${start}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
  const all = await recordsAt(values.root), selected = all.filter(row => row.date >= start && row.date < end);
  const week = aggregate(selected);
  const unknownReservationUsd = selected.filter(row => !finite(row.referenceUsd)).reduce((sum, row) => sum + Math.max(5, observedUsd(row)), 0);
  const accountedUsd = selected.filter(row => finite(row.referenceUsd)).reduce((sum, row) => sum + row.referenceUsd, 0) + unknownReservationUsd;
  const overLimitAttempts = selected.filter(row => observedUsd(row) > 5).length;
  const result = { timezone: "America/Los_Angeles", weekStart: start, weekEndExclusive: end,
    allTime: aggregate(all), week, budget: { perTaskLimitUsd: 5, weeklyLimitUsd: 50, accountedUsd,
      unknownReservationUsd, remainingUsd: Math.max(0, 50 - accountedUsd),
      overLimitAttempts,
      withinWeeklyLimit: accountedUsd <= 50, nextTaskReservationUsd: 5, canAdmitNextTask: overLimitAttempts === 0 && accountedUsd + 5 <= 50,
      admissionReason: overLimitAttempts ? "current-week task exceeded US$5" : accountedUsd + 5 > 50 ? "next US$5 reservation exceeds weekly cap" : "within recorded caps" } };
  if (values.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    const cost = row => row.cost.totalUsd === UNKNOWN ? `unknown (known US$${row.cost.knownUsd.toFixed(4)}; ${row.cost.unknownAttempts} unknown attempts)` : `US$${row.cost.totalUsd.toFixed(4)}`;
    process.stdout.write(`All time: ${all.length} attempts; reference cost ${cost(result.allTime)}\n` +
      `Week ${start} (America/Los_Angeles): ${week.attempts} attempts; reference cost ${cost(week)}\n` +
      `Correct deliveries: ${week.correctDeliveries}; unknown: ${week.correctDeliveryUnknown}\n` +
      `Weekly budget: US$${accountedUsd.toFixed(4)}/50 accounted (max(US$5, observed cost lower bound) per unknown); task limit US$5; ${result.budget.overLimitAttempts} task overruns\n` +
      `Next task reservation: US$5; admission within recorded caps: ${result.budget.canAdmitNextTask} (${result.budget.admissionReason})\n` +
      `Week details: ${JSON.stringify(week)}\n`);
  }
}
main().catch(error => { console.error(error instanceof SyntaxError ? "Invalid record JSON" : error.message); process.exitCode = 1; });
