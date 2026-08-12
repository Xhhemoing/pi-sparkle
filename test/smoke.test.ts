import assert from "node:assert/strict";
import { test } from "node:test";
import { PROJECT_NAME } from "../src/toolchain.js";

test("src module is importable through the tsx test runner", () => {
  assert.equal(PROJECT_NAME, "pi-sparkle");
});
