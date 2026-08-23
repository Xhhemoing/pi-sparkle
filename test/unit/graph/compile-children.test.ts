import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTaskId } from "../../../src/domain/ids.js";
import { validateFlowchart } from "../../../src/domain/flowchart.js";
import { DomainValidationError } from "../../../src/domain/errors.js";
import {
  compileChildrenToFlowchart,
  flowchartRoleForAgentRole,
  resolvedAgentRole,
  type CompilableChild
} from "../../../src/graph/compile-children.js";

const child = (
  id: string,
  role: CompilableChild["role"],
  dependsOn?: readonly string[]
): CompilableChild => ({
  taskId: parseTaskId(`tsk_${id}`),
  role,
  objective: `Do ${id}`,
  ...(dependsOn !== undefined ? { dependsOn: dependsOn.map((dep) => parseTaskId(`tsk_${dep}`)) } : {})
});

test("flowchartRoleForAgentRole maps reviewer to critic and everyone else to actor", () => {
  assert.equal(flowchartRoleForAgentRole("reviewer"), "critic");
  assert.equal(flowchartRoleForAgentRole("implementer"), "actor");
  assert.equal(flowchartRoleForAgentRole("tester"), "actor");
  assert.equal(flowchartRoleForAgentRole("planner"), "actor");
});

test("compile persists AgentRole so tester does not collapse to implementer", () => {
  const flowchart = compileChildrenToFlowchart([child("test", "tester"), child("plan", "planner")]);
  assert.equal(flowchart.nodes[0]?.role, "actor");
  assert.equal(flowchart.nodes[0]?.agentRole, "tester");
  assert.equal(resolvedAgentRole(flowchart.nodes[0]!), "tester");
  assert.equal(flowchart.nodes[1]?.agentRole, "planner");
  assert.equal(resolvedAgentRole(flowchart.nodes[1]!), "planner");
});

test("compile forwards high-risk approvalRequired from the child spec", () => {
  const gated = compileChildrenToFlowchart([
    { ...child("ship", "implementer"), approvalRequired: true }
  ]);
  assert.equal(gated.nodes[0]?.approvalRequired, true);
  const ordinary = compileChildrenToFlowchart([child("edit", "implementer")]);
  assert.equal(ordinary.nodes[0]?.approvalRequired, false);
});

test("independent children compile to a validated flowchart with a shared parallel group and no edges", () => {
  const flowchart = compileChildrenToFlowchart([child("parse", "implementer"), child("test", "tester")]);
  const validated = validateFlowchart(flowchart);
  assert.equal(validated.nodes.length, 2);
  assert.deepEqual(validated.edges, []);
  assert.equal(validated.nodes[0]?.id, "tsk_parse");
  assert.equal(validated.nodes[0]?.taskId, "tsk_parse");
  assert.equal(validated.nodes[0]?.role, "actor");
  assert.equal(validated.nodes[0]?.parallelGroup, "children");
  assert.equal(validated.nodes[1]?.parallelGroup, "children");
  assert.deepEqual(validated.nodes[0]?.modelPolicy.allowedModels, ["cheap", "premium"]);
});

test("a reviewer child compiles as a critic node", () => {
  const flowchart = compileChildrenToFlowchart([child("review", "reviewer")]);
  assert.equal(flowchart.nodes[0]?.role, "critic");
  assert.equal(flowchart.nodes[0]?.parallelGroup, undefined);
});

test("dependsOn becomes success edges and an all-join on the dependent node", () => {
  const flowchart = compileChildrenToFlowchart([
    child("parse", "implementer"),
    child("test", "tester"),
    child("ship", "implementer", ["parse", "test"])
  ]);
  const validated = validateFlowchart(flowchart);
  assert.equal(validated.edges.length, 2);
  assert.deepEqual(
    [...validated.edges].sort((a, b) => a.from.localeCompare(b.from)),
    [
      { from: "tsk_parse", to: "tsk_ship", condition: { type: "success", expected: true } },
      { from: "tsk_test", to: "tsk_ship", condition: { type: "success", expected: true } }
    ]
  );
  assert.deepEqual(validated.nodes.find((node) => node.id === "tsk_ship")?.joinPolicy, {
    mode: "all",
    requiredNodeIds: ["tsk_parse", "tsk_test"]
  });
  assert.equal(validated.nodes.find((node) => node.id === "tsk_parse")?.parallelGroup, "children");
  assert.equal(validated.nodes.find((node) => node.id === "tsk_ship")?.parallelGroup, undefined);
});

test("per-child preferredModel overrides the compile default", () => {
  const flowchart = compileChildrenToFlowchart(
    [
      { ...child("parse", "implementer"), preferredModel: "premium" },
      { ...child("test", "tester"), preferredModel: "cheap" }
    ],
    { allowedModels: ["cheap", "premium"], preferredModel: "cheap" }
  );
  assert.equal(flowchart.nodes.find((node) => node.id === "tsk_parse")?.modelPolicy.preferredModel, "premium");
  assert.equal(flowchart.nodes.find((node) => node.id === "tsk_test")?.modelPolicy.preferredModel, "cheap");
});

test("empty children, missing deps, and self-deps fail closed", () => {
  assert.throws(() => compileChildrenToFlowchart([]), DomainValidationError);
  assert.throws(() => compileChildrenToFlowchart([child("a", "worker", ["ghost"])]), /missing dependency/);
  assert.throws(() => compileChildrenToFlowchart([child("a", "worker", ["a"])]), /itself/);
});
