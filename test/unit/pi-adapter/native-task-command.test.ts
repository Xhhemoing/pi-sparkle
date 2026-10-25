import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { snapshotNativeTaskCommandOptions, type NativeTaskCommandOptions } from "../../../src/pi-adapter/native-task-command.js";

test("trusted command paths are captured once without retaining caller mutation", () => {
  const input = { stateRoot: "private-state", sandboxRoot: "private-candidates" };
  const captured = snapshotNativeTaskCommandOptions(input)!;
  input.stateRoot = "changed-state"; input.sandboxRoot = "changed-candidates";
  assert.equal(captured.stateRoot, path.resolve("private-state"));
  assert.equal(captured.sandboxRoot, path.resolve("private-candidates"));
  assert.equal(Object.isFrozen(captured), true);
  assert.equal(snapshotNativeTaskCommandOptions(undefined), undefined);
});

test("trusted path selection refuses getters, proxies, inherited fields and unsupported options without invoking them", () => {
  let invoked = 0;
  const getter = { get stateRoot() { invoked++; return "state"; } };
  const proxy = new Proxy({}, { ownKeys() { invoked++; return []; } });
  for (const input of [getter, proxy, Object.create({ stateRoot: "state" }), { stateRoot: "" },
    { stateRoot: "state", sandboxRoot: 1 }, { stateRoot: "state", provider: "other" }]) {
    assert.throws(() => snapshotNativeTaskCommandOptions(input as NativeTaskCommandOptions), /host task/);
  }
  assert.equal(invoked, 0);
});
