import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAgentProfileId
} from "../../../src/domain/ids.js";
import { isAgentRole, AGENT_ROLES } from "../../../src/domain/roles.js";
import {
  createAgentProfileRegistry,
  defaultAgentProfiles,
  isAgentProfile,
  validateAgentProfile,
  type AgentProfile,
  type AgentProfileRegistry
} from "../../../src/agents/registry.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

function validProfile(overrides: Record<string, unknown> = {}): AgentProfile {
  return {
    id: createAgentProfileId(UUID),
    role: "worker",
    systemInstruction: "You are a worker agent.",
    allowedToolNames: ["read_file", "search_files"],
    canWriteWorkspace: false,
    canDelegate: false,
    inputSchema: { type: "object", properties: { objective: { type: "string" } }, required: ["objective"] },
    outputSchema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
    ...overrides
  } as AgentProfile;
}

test("a conforming AgentProfile validates and round-trips", () => {
  const profile = validProfile();
  assert.deepEqual(validateAgentProfile(profile), profile);
  assert.equal(isAgentProfile(profile), true);
});

test("AgentProfile validation rejects malformed profiles", () => {
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ id: "nope" }, /id/],
    [{ role: "wizard" }, /role/],
    [{ systemInstruction: "" }, /systemInstruction/],
    [{ allowedToolNames: [] }, /allowedToolNames/],
    [{ allowedToolNames: [""] }, /allowedToolNames/],
    [{ canWriteWorkspace: "yes" }, /canWriteWorkspace/],
    [{ canDelegate: 1 }, /canDelegate/],
    [{ inputSchema: { type: "banana" } }, /inputSchema/],
    [{ outputSchema: { type: "object", properties: { a: { type: "nope" } } } }, /outputSchema/]
  ];
  for (const [overrides, pattern] of cases) {
    const profile = validProfile(overrides);
    assert.throws(() => validateAgentProfile(profile), pattern, JSON.stringify(overrides));
    assert.equal(isAgentProfile(profile), false);
  }
  assert.throws(() => validateAgentProfile(null), /object/);
  assert.throws(() => validateAgentProfile("worker"), /object/);
});

test("the default registry resolves every M1 role without hardcoding a model", () => {
  const registry = createAgentProfileRegistry(defaultAgentProfiles());
  assert.ok(AGENT_ROLES.length >= 7, "expected worker + six M1 roles");
  for (const role of AGENT_ROLES) {
    const profile = registry.resolve(role);
    assert.equal(profile.role, role);
    assert.ok(isAgentRole(profile.role));
    assert.ok(profile.systemInstruction.trim().length > 0);
    // A logical role contract never embeds a concrete model/provider choice.
    assert.equal("model" in profile, false);
    assert.equal("modelId" in profile, false);
    assert.equal("providerId" in profile, false);
  }
});

test("the registry rejects unknown roles and duplicate profile roles", () => {
  const registry = createAgentProfileRegistry(defaultAgentProfiles());
  assert.throws(() => registry.resolve("wizard" as never), /Unknown role|role/);
  assert.throws(
    () =>
      createAgentProfileRegistry([
        validProfile(),
        validProfile({ id: createAgentProfileId(() => "fedcba98-7654-3210-fedc-ba9876543210"), role: "worker" })
      ]),
    /duplicate|Duplicate|role/i
  );
});

test("registry.list returns all profiles and has() reflects resolution", () => {
  const registry: AgentProfileRegistry = createAgentProfileRegistry(defaultAgentProfiles());
  assert.equal(registry.list().length, AGENT_ROLES.length);
  assert.equal(registry.has("worker"), true);
  assert.equal(registry.has("scout"), true);
  assert.equal(registry.has("wizard" as never), false);
});

test("a registry built from custom profiles validates and resolves them", () => {
  const custom = validProfile({ id: createAgentProfileId(() => "12345678-9abc-def0-1234-56789abcdef0"), role: "planner" });
  const registry = createAgentProfileRegistry([custom]);
  assert.equal(registry.resolve("planner").systemInstruction, custom.systemInstruction);
});
