import assert from "node:assert/strict";
import { test } from "node:test";

const runId = "run_parent", taskId = "tsk_task", child = "run_child", agent = "agt_worker";
const selection = { providerId: "approved", modelId: "small", thinkingLevel: "xhigh" } as const;
function fixture() {
  const contract = { id: "art_v2_contract", runId, schemaVersion: "loop-artifact-v2", body: { kind: "native-write-task-contract", runId, taskId, sourceRevision: "a".repeat(40), candidatePath: "/synthetic/candidate" } };
  const report = { runId: child, taskId, agentInstanceId: agent, settled: true, coverage: "unknown", streamDispatches: 1, sdkObservations: [{ dispatchIndex: 1, provider: "approved", model: "small", transportReasoning: "xhigh" }] };
  const loop = { schemaVersion: "loop-artifact-v2", runId, id: "art_v2_loop", body: { kind: "native-write-loop", schemaVersion: 1, sourceRevision: contract.body.sourceRevision, candidatePath: contract.body.candidatePath, attempts: [{ number: 1, runId, taskContractArtifact: { id: contract.id } }], referenceCost: { settled: true, attempts: [{ number: 1, report }] } } };
  const events = [{ type: "CHILD_RUN_CREATED", runId, taskId, payload: { childRun: { id: child, parentRunId: runId, rootTaskId: taskId } } }, { type: "CHILD_MESSAGE", runId, taskId, payload: { message: { type: "TASK_REQUEST", runId: child, taskId, to: agent } } }];
  return { contract, loop, events, selection };
}
async function validator() {
  const module = await import("../../../src/lab/adaptation/model-consumption.js").catch((error: NodeJS.ErrnoException) => { if (error.code === "ERR_MODULE_NOT_FOUND") return undefined; throw error; });
  assert.equal(typeof module?.verifyTaskModelConsumption, "function", "model labels must be replaced by actual bound SDK submission observations");
  return module!.verifyTaskModelConsumption;
}
test("bound complete submission identities do not claim complete cost or a successful response", async () => {
  const verify = await validator();
  assert.doesNotThrow(() => verify(fixture()));
});
test("model labels cannot conceal fallback, changed thinking or foreign result identities", async () => {
  const verify = await validator();
  for (const change of [{ model: "large" }, { transportReasoning: "high" }, { resultModel: "large" }, { resultProvider: "foreign" }, { transportReasoning: undefined }]) {
    const f = fixture(); Object.assign(f.loop.body.referenceCost.attempts[0]!.report.sdkObservations[0]!, change);
    assert.throws(() => verify(f), /model|thinking|submission|identity/);
  }
});
test("missing, duplicate, extra and unsettled populations cannot establish model consumption", async () => {
  const verify = await validator();
  const changes: Array<(f: ReturnType<typeof fixture>) => void> = [
    f => { f.loop.body.referenceCost.attempts[0]!.report.streamDispatches = 0; f.loop.body.referenceCost.attempts[0]!.report.sdkObservations = []; },
    f => { f.loop.body.referenceCost.attempts[0]!.report.streamDispatches = 2; },
    f => { const r = f.loop.body.referenceCost.attempts[0]!.report; r.streamDispatches = 2; r.sdkObservations.push({ ...r.sdkObservations[0]! }); },
    f => { f.loop.body.referenceCost.attempts[0]!.report.agentInstanceId = "agt_foreign"; },
    f => { f.loop.body.referenceCost.attempts[0]!.report.settled = false; },
    f => { Object.assign(f.loop.body.referenceCost.attempts[0]!, { fault: "incomplete-usage" }); },
    f => { Object.assign(f.loop.body.referenceCost.attempts[0]!, { fault: "unknown-reference" }); },
    f => { f.loop.body.referenceCost.attempts.push(f.loop.body.referenceCost.attempts[0]!); },
    f => { f.loop.body.attempts.push(f.loop.body.attempts[0]!); },
    f => { f.events.push(f.events[0]!); },
    f => { f.events.push(f.events[1]!); },
    f => { f.events.pop(); },
    f => { f.loop.body.attempts[0]!.taskContractArtifact.id = "art_v2_foreign"; },
    f => { f.loop.body.sourceRevision = "b".repeat(40); },
    f => { f.loop.body.candidatePath = "/other"; }
  ];
  for (const change of changes) { const f = fixture(); change(f); assert.throws(() => verify(f)); }
});
