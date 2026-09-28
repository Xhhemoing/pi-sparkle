import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultAgentProfiles } from "../../../src/agents/registry.js";
import { extractHeuristicContract, isVague } from "../../../src/requirement/heuristic.js";
import { findUnsourcedItems } from "../../../src/requirement/provenance.js";
import { planFromContract } from "../../../src/track/plan.js";

const chineseFix = "修复src/auth/login.ts中的登录超时问题，补充单元测试，不修改其他模块";
const chineseReadOnly = "只分析src/auth/login.ts中的登录超时原因，不要修改文件";

for (const objective of [chineseFix, chineseReadOnly, "修复登录超时问题并补充单元测试", "Fix src/auth/login.ts"]) {
  test(`concrete objectives do not require English spaces: ${objective}`, () => {
    assert.equal(isVague(objective), false);
  });
}

for (const objective of ["do it", "make it better", "优化一下", "帮我弄好"]) {
  test(`underspecified objectives remain vague: ${objective}`, () => {
    assert.equal(isVague(objective), true);
  });
}

test("Chinese test request matches English contract and planned roles", async () => {
  const zh = await extractHeuristicContract({ objective: chineseFix });
  const en = await extractHeuristicContract({
    objective: "Fix the login timeout in src/auth/login.ts and add unit tests without changing other modules"
  });
  assert.ok(zh.contract.constraints.some((item) => item.id === "c-tests"));
  assert.ok(zh.contract.acceptanceCriteria.some((item) => item.id === "ac-tests"));
  assert.equal(zh.contract.questions.some((item) => item.id === "q-tests"), false);
  assert.deepEqual(planFromContract({ contract: zh.contract }).map((item) => item.role),
    planFromContract({ contract: en.contract }).map((item) => item.role));
  assert.equal(findUnsourcedItems(zh.contract).ok, true);
  assert.deepEqual(zh.contract.authority, []);
});

for (const objective of [
  chineseReadOnly,
  "Investigate the login timeout in src/auth/login.ts; do not modify files",
  "Read-only: review src/auth/login.ts and report risks",
  "只读检查src/auth/login.ts并报告风险",
  "调查src/auth/login.ts的错误，不写入任何文件"
]) {
  test(`read-only objective yields report and non-writing profiles: ${objective}`, async () => {
    const habits = { requireTests: true, askBeforeWrite: true };
    const { contract } = await extractHeuristicContract({ objective, habits });
    assert.deepEqual(contract.deliverables.map((item) => item.artifactKind), ["report"]);
    assert.ok(contract.constraints.some((item) => item.id === "c-read-only"));
    assert.equal(contract.acceptanceCriteria.some((item) => item.id === "ac-tests"), false);
    assert.equal(contract.questions.some((item) => item.id === "q-write" || item.id === "q-tests"), false);
    assert.deepEqual(contract.authority, []);
    assert.equal(findUnsourcedItems(contract).ok, true);
    const snapshot = structuredClone(contract);
    const children = planFromContract({ contract, habits, answers: { "q-write": "write files", "q-tests": "yes" } });
    assert.deepEqual(children.map((item) => item.role), ["planner", "scout"]);
    assert.deepEqual(contract, snapshot);
    for (const child of children) {
      const profile = defaultAgentProfiles().find((item) => item.role === child.role)!;
      assert.equal(profile.canWriteWorkspace, false);
      assert.equal(profile.allowedToolNames.some((tool) => ["write_file", "edit_file", "run_test"].includes(tool)), false);
    }
  });
}

for (const objective of [
  chineseFix,
  "Fix src/auth/login.ts but do not modify other files",
  "Add a read-only endpoint in src/api/status.ts and add tests",
  "在src/api/status.ts添加只读接口并补充测试"
]) {
  test(`scoped negatives and feature descriptions are not global no-write: ${objective}`, async () => {
    const { contract } = await extractHeuristicContract({ objective });
    assert.ok(planFromContract({ contract }).some((item) => item.role === "implementer"));
    assert.equal(contract.constraints.some((item) => item.id === "c-read-only"), false);
  });
}

for (const objective of [
  "修复src/auth/login.ts中的超时问题，不要运行测试",
  "修复src/auth/login.ts中的超时问题，无需补充单元测试",
  "Fix the timeout in src/auth/login.ts without tests",
  "Fix the timeout in src/auth/login.ts; do not run tests",
  "Fix the timeout in src/auth/login.ts; skip tests",
  "Fix src/auth/login.ts; skip existing tests"
]) {
  test(`explicit no-tests overrides a preference default: ${objective}`, async () => {
    const habits = { requireTests: true };
    const { contract } = await extractHeuristicContract({ objective, habits });
    assert.equal(contract.constraints.some((item) => item.id === "c-tests"), false);
    assert.equal(contract.acceptanceCriteria.some((item) => item.id === "ac-tests"), false);
    assert.equal(contract.questions.some((item) => item.id === "q-tests"), false);
    assert.equal(planFromContract({ contract, habits }).some((item) => item.role === "tester"), false);
  });
}

for (const answer of ["investigation only", "investigation-only", "仅分析", "只读"]) {
  test(`read-only answers accept legacy, stable and Chinese values: ${answer}`, async () => {
    const { contract } = await extractHeuristicContract({ objective: "Investigate the login timeout in src/auth/login.ts" });
    const children = planFromContract({ contract, answers: { "q-write": answer } });
    assert.deepEqual(children.map((item) => item.role), ["planner", "scout"]);
  });
}

test("a structured no-write constraint cannot be lifted by defaults or answers", async () => {
  const { contract } = await extractHeuristicContract({ objective: "Fix the login timeout in src/auth/login.ts" });
  const restricted = { ...contract, constraints: [...contract.constraints,
    { id: "c-read-only", description: "Do not modify files", enforceable: true, sourceRefs: contract.sourceRefs }] };
  assert.deepEqual(planFromContract({ contract: restricted, answers: { "q-write": "write files" } }).map((item) => item.role), ["planner", "scout"]);
});

for (const objective of ["src/fix.ts", "src/test.ts documentation", "src/plan.ts"]) {
  test(`an action-looking filename is not an action: ${objective}`, () => {
    assert.equal(isVague(objective), true);
  });
}

for (const objective of [
  "Fix the timeout in src/auth/login.ts; do not skip tests",
  "Fix src/auth/login.ts; do not skip existing tests",
  "Fix src/auth/login.ts; never skip the existing regression tests",
  "Fix the timeout in src/auth/login.ts with no test failures"
]) {
  test(`negative wording does not cancel required tests: ${objective}`, async () => {
    const { contract } = await extractHeuristicContract({ objective });
    assert.ok(contract.constraints.some((item) => item.id === "c-tests"));
    assert.ok(planFromContract({ contract }).some((item) => item.role === "tester"));
  });
}

for (const objective of [
  "Fix src/auth/login.ts; run existing tests, but do not add tests",
  "修复src/auth/login.ts并运行现有测试，不添加新测试",
  "Fix src/auth/login.ts; no new tests, run the existing tests",
  "修复src/auth/login.ts，不需要新增测试，但执行已有测试"
]) {
  test(`no new tests preserves explicit existing-test execution: ${objective}`, async () => {
    const habits = { requireTests: true };
    const { contract } = await extractHeuristicContract({ objective, habits });
    assert.ok(contract.acceptanceCriteria.some((item) => item.id === "ac-tests"));
    const tester = planFromContract({ contract, habits }).find((item) => item.role === "tester");
    assert.ok(tester);
    assert.ok(tester.objective.includes(objective));
  });
}

for (const objective of [
  "Fix src/auth/login.ts; do not add tests and do not run existing tests",
  "修复src/auth/login.ts，不添加新测试，也不要运行现有测试",
  "Fix src/auth/login.ts; no new tests and do not run the existing tests",
  "修复src/auth/login.ts，不添加新测试，也不要运行已有的测试"
]) {
  test(`an existing-test execution prohibition still overrides defaults: ${objective}`, async () => {
    const habits = { requireTests: true };
    const { contract } = await extractHeuristicContract({ objective, habits });
    assert.equal(contract.acceptanceCriteria.some((item) => item.id === "ac-tests"), false);
    assert.equal(planFromContract({ contract, habits }).some((item) => item.role === "tester"), false);
  });
}
