import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractHumanScore,
  hasObviousHumanProblem,
  humanScoreValue
} from "../../../src/tracking/human-score.js";
import { UNOBSERVED } from "../../../src/tracking/types.js";

describe("tracking human score H", () => {
  it("treats silence as no human evaluation", () => {
    const signal = extractHumanScore({});
    assert.equal(signal.kind, "unobserved");
    assert.equal(humanScoreValue(signal), UNOBSERVED);
    assert.equal(hasObviousHumanProblem(signal), false);
  });

  it("treats a short confirm as no obvious problem and no evaluation", () => {
    for (const userText of ["ok", "行", "继续", "好", "LGTM", "yes"]) {
      const signal = extractHumanScore({ userText });
      assert.equal(signal.kind, "unobserved", userText);
      assert.equal(hasObviousHumanProblem(signal), false, userText);
    }
  });

  it("treats requirement-only additions as no evaluation", () => {
    const signal = extractHumanScore({ userText: "另外还要加上日志" });
    assert.equal(signal.kind, "unobserved");
    assert.equal(hasObviousHumanProblem(signal), false);
  });

  it("uses agreement ratio when the AI output is a countable list (4/5 agree)", () => {
    const signal = extractHumanScore({
      list: {
        items: [
          { id: "1", text: "plan step one" },
          { id: "2", text: "plan step two" },
          { id: "3", text: "plan step three" },
          { id: "4", text: "plan step four" },
          { id: "5", text: "plan step five" }
        ],
        agreedIds: ["1", "2", "3", "4"]
      }
    });
    assert.equal(signal.kind, "ratio");
    if (signal.kind !== "ratio") return;
    assert.equal(signal.H, 0.8);
    assert.equal(signal.agreed, 4);
    assert.equal(signal.evaluable, 5);
    assert.equal(signal.safetyRejected, false);
    assert.equal(hasObviousHumanProblem(signal), true);
  });

  it("does not treat a fully agreed list as an obvious problem", () => {
    const signal = extractHumanScore({
      list: {
        items: [
          { id: "1", text: "a" },
          { id: "2", text: "b" }
        ],
        agreedIds: ["1", "2"]
      }
    });
    assert.equal(signal.kind, "ratio");
    if (signal.kind !== "ratio") return;
    assert.equal(signal.H, 1);
    assert.equal(hasObviousHumanProblem(signal), false);
  });

  it("does not let a high ratio cancel a rejected permission or security item", () => {
    const signal = extractHumanScore({
      list: {
        items: [
          { id: "safe", text: "rename helper" },
          { id: "net", text: "open outbound network", class: "permission" },
          { id: "more", text: "add tests" },
          { id: "docs", text: "update readme" },
          { id: "lint", text: "fix lint" }
        ],
        agreedIds: ["safe", "more", "docs", "lint"]
      }
    });
    assert.equal(signal.kind, "ratio");
    if (signal.kind !== "ratio") return;
    assert.equal(signal.H, 0.8);
    assert.equal(signal.safetyRejected, true);
    assert.equal(hasObviousHumanProblem(signal), true);
  });

  it("extracts a ten-point mark from x/10 or x分 before short-rule buckets", () => {
    const marked = extractHumanScore({ userText: "先打 7分" });
    assert.equal(marked.kind, "ten-point");
    if (marked.kind !== "ten-point") return;
    assert.equal(marked.H, 0.7);
    assert.equal(marked.mark, 7);
    assert.equal(hasObviousHumanProblem(marked), true);

    const slash = extractHumanScore({ userText: "给 8/10 吧" });
    assert.equal(slash.kind, "ten-point");
    if (slash.kind !== "ten-point") return;
    assert.equal(slash.H, 0.8);
    assert.equal(hasObviousHumanProblem(slash), false);
  });

  it("prefers ratio over a ten-point mark when a countable list is present", () => {
    const signal = extractHumanScore({
      userText: "7分",
      list: {
        items: [
          { id: "a", text: "one" },
          { id: "b", text: "two" }
        ],
        agreedIds: ["a"]
      }
    });
    assert.equal(signal.kind, "ratio");
    if (signal.kind !== "ratio") return;
    assert.equal(signal.H, 0.5);
  });

  it("maps unstructured negation onto the short-rule buckets", () => {
    const whole = extractHumanScore({ userText: "全部回滚，推倒重来" });
    assert.equal(whole.kind, "short-rule");
    if (whole.kind !== "short-rule") return;
    assert.equal(whole.H, 0.15);
    assert.equal(whole.bucket, "whole-reject");
    assert.equal(hasObviousHumanProblem(whole), true);

    const operation = extractHumanScore({ userText: "这个操作不行，计划还可以" });
    assert.equal(operation.kind, "short-rule");
    if (operation.kind !== "short-rule") return;
    assert.equal(operation.H, 0.35);
    assert.equal(operation.bucket, "operation-reject");

    const named = extractHumanScore({ userText: "这个文件名错了，先继续" });
    assert.equal(named.kind, "short-rule");
    if (named.kind !== "short-rule") return;
    assert.equal(named.H, 0.45);
    assert.equal(named.bucket, "named-error-continue");
  });

  it("returns unobserved when extraction is uncertain", () => {
    const signal = extractHumanScore({ userText: "看情况吧，下午再说" });
    assert.equal(signal.kind, "unobserved");
    assert.equal(humanScoreValue(signal), UNOBSERVED);
    assert.equal(hasObviousHumanProblem(signal), false);
  });

  it("does not treat a bare 4/5 as a ten-point mark", () => {
    const signal = extractHumanScore({ userText: "4/5" });
    assert.equal(signal.kind, "unobserved");
  });

  it("treats two unscoped ten-point marks as unobserved", () => {
    const signal = extractHumanScore({ userText: "7分 也给 3分" });
    assert.equal(signal.kind, "unobserved");
  });
});
