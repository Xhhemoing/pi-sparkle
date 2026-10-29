import { DomainValidationError } from "../../domain/errors.js";
import { isRecord } from "../../domain/record.js";
import type { CandidateId, ResourceVersionId } from "../../domain/ids.js";
import type { ResourceRegistry } from "../adaptation/registry.js";
import type { ResourceIdentity } from "../adaptation/resource.js";
import { parseCheckRecipeLaunchers, parseTaskResourceContent, taskResourceIdentity, taskResourceTopic, type TaskResourceContent, type TaskResourceTopic } from "../adaptation/task-resources.js";
import { isDeepStrictEqual } from "node:util";
import type { FailureClass } from "../../routing/outcomes.js";
import { parseTaskModelSelection } from "../../domain/task-model-selection.js";

const GUIDANCE: Readonly<Record<Exclude<TaskResourceTopic, "check-recipes" | "model-thinking">, { guidance: string; expectedEffect: string }>> = {
  "node-preparation": {
    guidance: "Host preparation: select the exact packageManager version declared by the project and its locked dependency recipe. Prepare any external cache only under separate authorization. Keep the source pristine; install locked dependencies only in the isolated candidate through an explicitly reviewed fixed prepare wrapper. Declare the wrapper's child environment explicitly: TaskSpec commands do not inherit the launching shell environment. A standalone preflight removes its settled candidate; repeat candidate preparation for the actual task. Do not auto-install, loosen checks, change lockfiles, or give the file-only worker command authority.",
    expectedEffect: "Fewer Node preparation-routing failures on later comparable tasks, with every failure, intervention, time and unknown cost retained; not a causal improvement claim."
  },
  "host-only-checks": {
    guidance: "Use only the tools actually available. For file-only workers, declared checks are HOST-ONLY: the host runs the exact checks after normal worker completion. Do not fabricate PASSED, mark an unavailable check FAILED, or invent evidence. Leave unchecked criteria unreported. If no independent checks were executed, do not call sparkle_report_task_result, whose verdict is only PASSED/FAILED; finish normally so verification stays UNOBSERVED until host acceptance. Describe actual discovered defects honestly. If command tools are explicitly authorized, run every declared visible check after the final edit within its budgets; one smoke test never substitutes for full declared coverage.",
    expectedEffect: "More file-only tasks reach independent host verification without false worker verdicts; actual checker failures and unknown settlement remain failures or unknowns."
  },
  "input-validation": {
    guidance: "Applicable only to a task that changes input validation: use the existing input schema to select the affected fields and small synthetic counterexamples. Check relevant null, array, object and wrong-scalar shapes, and empty or delimiter-separated lists where the schema admits lists. Preserve sibling failures, partial records and unknown measurements; do not invent zero. Work only inside the original authorized write scope and preserve existing tests. Do not add an unrelated full matrix or demand an indiscriminate full suite. File-only workers leave unexecuted host checks UNOBSERVED; the host remains responsible for final verification.",
    expectedEffect: "Fewer review escapes from narrow input-validation repairs on later applicable tasks; preserved failures and unknowns remain part of the denominator."
  }
};
export interface RealTaskSource { readonly ref: string; readonly record: unknown; }
const RELATED_CLASSES: Readonly<Record<TaskResourceTopic, readonly FailureClass[]>> = {
  "node-preparation": ["environment", "tool", "contract"], "host-only-checks": ["model", "contract", "run"], "input-validation": ["model", "contract"], "check-recipes": ["environment", "tool", "contract", "run"], "model-thinking": ["model", "provider", "run", "contract"]
};
export interface TaskResourceProposal {
  readonly proposalKind: "seeded-class-proposal";
  readonly observations: { readonly selectedRecords: number; readonly relatedFailures: number };
  readonly identity: ResourceIdentity;
  readonly content: string;
  readonly state: "needs-baseline-approval" | "proposed" | "unchanged";
  readonly parentVersionId?: ResourceVersionId;
  readonly candidateId?: CandidateId;
  readonly sourceRecords: readonly { readonly ref: string; readonly id: string; readonly date: string; readonly source: string; readonly arm: string; readonly status: string;
    readonly failureClass?: FailureClass; readonly kept?: boolean | "unknown"; readonly accepted?: boolean | "unknown"; readonly escapedDefects?: number | "unknown" }[];
  readonly rollback: string;
}
function fail(message: string): never { throw new DomainValidationError(`real-task proposal: ${message}`); }
function sameBehavior(raw: string | undefined, proposed: TaskResourceContent): boolean {
  if (raw === undefined) return false;
  try {
    const previous = parseTaskResourceContent(raw);
    if (previous.topic === "model-thinking" || proposed.topic === "model-thinking") return previous.topic === "model-thinking" && proposed.topic === "model-thinking" &&
      isDeepStrictEqual(previous.selection, proposed.selection) && previous.expectedEffect === proposed.expectedEffect;
    if (previous.topic === "check-recipes" || proposed.topic === "check-recipes") return previous.topic === "check-recipes" && proposed.topic === "check-recipes" && previous.mode === proposed.mode &&
      isDeepStrictEqual(previous.launchers, proposed.launchers) && previous.expectedEffect === proposed.expectedEffect;
    return previous.topic === proposed.topic && previous.guidance === proposed.guidance && previous.expectedEffect === proposed.expectedEffect;
  } catch { return false; }
}
/** Bounded source facts only: no task body, prompt, transcript or credential enters a packet. */
export function proposeRealTaskResources(input: { registry: ResourceRegistry; projectRoot: string; topic: TaskResourceTopic; sourceRecords: readonly RealTaskSource[]; checkRecipeLaunchers?: unknown; modelSelection?: unknown }): TaskResourceProposal[] {
  const topic = taskResourceTopic(input.topic);
  if (input.sourceRecords.length < 1 || input.sourceRecords.length > 1000) fail("require 1..1000 source records");
  const ids = new Set<string>(), refs = new Set<string>();
  const sourceRecords = input.sourceRecords.map(({ ref, record }) => {
    if (typeof ref !== "string" || !ref.trim() || ref.includes("\0") || ref.length > 4096 || !isRecord(record) ||
      typeof record.id !== "string" || !record.id.trim() || typeof record.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(record.date) ||
      !Number.isFinite(Date.parse(`${record.date}T00:00:00Z`)) || new Date(`${record.date}T00:00:00Z`).toISOString().slice(0, 10) !== record.date ||
      typeof record.source !== "string" || !["pi-sparkle", "soul"].includes(record.source) || !["sparkle", "direct-pi"].includes(String(record.arm)) ||
      !["COMPLETED", "FAILED", "CANCELLED", "TIMEOUT", "REFUSED", "PREFLIGHT_FAILED", "ERROR", "unknown"].includes(String(record.status))) return fail("invalid source record");
    if ((record.failureClass !== undefined && !["model", "contract", "tool", "environment", "provider", "run"].includes(String(record.failureClass))) ||
        [record.kept, record.accepted].some(value => value !== undefined && value !== "unknown" && typeof value !== "boolean") ||
        (record.escapedDefects !== undefined && record.escapedDefects !== "unknown" && (typeof record.escapedDefects !== "number" || !Number.isSafeInteger(record.escapedDefects) || record.escapedDefects < 0))) fail("invalid source failure evidence");
    const identity = JSON.stringify([record.source, record.arm, record.id]);
    if (ids.has(identity) || refs.has(ref)) fail("duplicate source record");
    ids.add(identity); refs.add(ref);
    return { ref, id: record.id, date: record.date, source: String(record.source), arm: String(record.arm), status: String(record.status),
      ...(record.failureClass === undefined ? {} : { failureClass: record.failureClass as FailureClass }),
      ...(record.kept === undefined ? {} : { kept: record.kept as boolean | "unknown" }),
      ...(record.accepted === undefined ? {} : { accepted: record.accepted as boolean | "unknown" }),
      ...(record.escapedDefects === undefined ? {} : { escapedDefects: record.escapedDefects as number | "unknown" }) };
  }).sort((a, b) => a.ref.localeCompare(b.ref));
  const relatedFailures = sourceRecords.filter(record => record.failureClass !== undefined && RELATED_CLASSES[topic].includes(record.failureClass) &&
    (["FAILED", "CANCELLED", "TIMEOUT", "REFUSED", "PREFLIGHT_FAILED", "ERROR"].includes(record.status) || record.kept === false || record.accepted === false ||
      (typeof record.escapedDefects === "number" && record.escapedDefects > 0))).length;
  if (relatedFailures === 0) fail("selected topic requires at least one related failure; source selection is an operator judgment, not automatic causal diagnosis");
  const proposal = { proposalKind: "seeded-class-proposal" as const, observations: { selectedRecords: sourceRecords.length, relatedFailures } };
  return [topic].map(topic => {
    const identity = taskResourceIdentity(input.projectRoot, topic);
    const sourceRefs = sourceRecords.map(record => record.ref);
    const body: TaskResourceContent = topic === "check-recipes" ? { topic, mode: "host-bindings", launchers: parseCheckRecipeLaunchers(input.checkRecipeLaunchers), sourceRefs,
      expectedEffect: "Reduce recorded checker-launcher failures while preserving every original business check; independent equivalence review and later real-task evidence are required." } : topic === "model-thinking" ? { topic, selection: parseTaskModelSelection(input.modelSelection), sourceRefs,
      expectedEffect: "Compare a fixed host-approved model/thinking profile on matched later tasks. A provider failure is not evidence that another profile is better; retain every failure and unknown cost." } : { topic, ...GUIDANCE[topic], sourceRefs };
    if (body.topic === "check-recipes" && body.launchers.length === 0) fail("check-recipes proposal requires exact fixed launcher conversions");
    const content = JSON.stringify(body, null, 2);
    const parent = input.registry.getActiveVersion(identity);
    if (parent === undefined) return { ...proposal, identity, content, state: "needs-baseline-approval", sourceRecords,
      rollback: "Owner must first approve the exact existing-guidance baseline; no pointer was created or changed." };
    const existing = input.registry.candidatesFor(identity).find(candidate => candidate.parentVersionId === parent.versionId &&
      candidate.status !== "rejected" && candidate.status !== "retired" && sameBehavior(input.registry.getContent(candidate.contentHash), body));
    const common = { ...proposal, identity, content, sourceRecords, parentVersionId: parent.versionId, rollback: `Restore ${parent.versionId} through existing explicit CAS rollback.` };
    if (sameBehavior(input.registry.getContent(parent.contentHash), body)) return { ...common, content: input.registry.getContent(parent.contentHash)!, state: "unchanged" };
    const candidate = existing ?? input.registry.createCandidate({ identity, content, parentVersionId: parent.versionId,
      author: { kind: "detector", identity: "real-task-review" }, evaluationPlan: { stages: ["static", "real-task"],
        metrics: [topic === "node-preparation" ? "first-preflight-ready" : "host-check-reached", "correct-delivery", "interventions", "time", "reference-cost"], planVersion: 1 } });
    return { ...common, content: input.registry.getContent(candidate.contentHash)!, state: "proposed", candidateId: candidate.candidateId };
  });
}
