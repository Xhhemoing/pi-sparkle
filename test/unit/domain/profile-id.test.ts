import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAgentProfileId,
  isAgentProfileId,
  parseAgentProfileId
} from "../../../src/domain/ids.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

test("AgentProfileId factories produce prefixed branded ids", () => {
  const id = createAgentProfileId(UUID);
  assert.match(id, /^prf_/);
  assert.equal(isAgentProfileId(id), true);
  assert.equal(parseAgentProfileId(id), id);
});

test("AgentProfileId rejects malformed values", () => {
  const bad = [undefined, null, 42, "", "prf", "prf_", "PROF_x", "run_abc", "prf_!!!"];
  for (const value of bad) {
    assert.throws(() => parseAgentProfileId(value), /AgentProfileId/);
    assert.equal(isAgentProfileId(value), false);
  }
});
