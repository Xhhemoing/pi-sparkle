import assert from "node:assert/strict";
import { test } from "node:test";
import * as supervisor from "../../../src/run/supervisor.js";

test("supervised runs do not publish a caller-less tracking settle seam", () => {
  assert.equal("settleSupervisedOutcome" in supervisor, false);
});
