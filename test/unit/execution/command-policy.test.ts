import assert from "node:assert/strict";
import { test } from "node:test";
import { authorizeCommand } from "../../../src/execution/command-policy.js";

const policy = (timeoutMs?: number) => ({
  allow: [{ executable: "node" }],
  ...(timeoutMs === undefined ? {} : { timeoutMs })
});

test("command policy rejects invalid timeout values and preserves the default", () => {
  for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => authorizeCommand(policy(timeoutMs), "node", []), /timeoutMs/);
  }
  assert.equal(authorizeCommand(policy(), "node", []).timeoutMs, 60_000);
  assert.equal(authorizeCommand(policy(1234), "node", []).timeoutMs, 1234);
});
