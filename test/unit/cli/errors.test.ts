import assert from "node:assert/strict";
import { test } from "node:test";
import { cliFail, parseCliErrorJson, writeCliError } from "../../../src/cli/errors.js";
import { versionAtLeast } from "../../../src/cli/doctor.js";

test("cliFail writes command, stage, next, and a trailing JSON object", () => {
  const err: string[] = [];
  const code = cliFail(
    { stderr: (text) => err.push(text) },
    {
      command: "run",
      stage: "parse-args",
      message: "run requires --project <path> and --objective <text>",
      next: "pass both flags"
    }
  );
  assert.equal(code, 1);
  const text = err.join("");
  assert.match(text, /^error: run requires/m);
  assert.match(text, /command: run/);
  assert.match(text, /stage: parse-args/);
  assert.match(text, /next: pass both flags/);
  const parsed = parseCliErrorJson(text);
  assert.ok(parsed);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.command, "run");
  assert.equal(parsed.stage, "parse-args");
  assert.equal(parsed.next, "pass both flags");
});

test("writeCliError includes run and task ids when provided", () => {
  const err: string[] = [];
  writeCliError(
    { stderr: (text) => err.push(text) },
    {
      command: "inspect",
      stage: "lookup",
      message: "missing",
      next: "check --run",
      runId: "run_abc",
      taskId: "tsk_one"
    }
  );
  const parsed = parseCliErrorJson(err.join(""));
  assert.equal(parsed?.runId, "run_abc");
  assert.equal(parsed?.taskId, "tsk_one");
});

test("versionAtLeast compares dotted versions", () => {
  assert.equal(versionAtLeast("22.19.0", "22.19.0"), true);
  assert.equal(versionAtLeast("24.18.0", "22.19.0"), true);
  assert.equal(versionAtLeast("22.18.9", "22.19.0"), false);
  assert.equal(versionAtLeast("v22.19.1", "22.19.0"), true);
});
