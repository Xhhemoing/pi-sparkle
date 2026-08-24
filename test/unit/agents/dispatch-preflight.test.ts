import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as dispatchPreflight from "../../../src/agents/dispatch-preflight.js";
import {
  DEFAULT_PI_DISPATCH_CONTRACT,
  createPiDispatchGuard,
  listPiAgentProfiles,
  preflightAgentRole,
  preflightPiAgentName
} from "../../../src/agents/dispatch-preflight.js";

const LOADED = [
  "debugger",
  "documenter",
  "dsv4-flash",
  "planner",
  "researcher",
  "reviewer",
  "scout",
  "security",
  "verifier",
  "worker"
] as const;

test("the contract declares Pi profiles and an explicit implementer mapping, not general-purpose", () => {
  assert.equal(DEFAULT_PI_DISPATCH_CONTRACT.schemaVersion, 1);
  assert.ok(DEFAULT_PI_DISPATCH_CONTRACT.piProfiles.includes("worker"));
  assert.equal(DEFAULT_PI_DISPATCH_CONTRACT.roleToPiProfile.implementer, "worker");
  assert.equal(DEFAULT_PI_DISPATCH_CONTRACT.roleToPiProfile.tester, undefined);
  assert.equal(
    (DEFAULT_PI_DISPATCH_CONTRACT.piProfiles as readonly string[]).includes("general-purpose"),
    false
  );
});

test("dispatch preflight exposes result values, not an unthrown error wrapper", () => {
  assert.equal("DispatchPreflightError" in dispatchPreflight, false);
});

test("general-purpose is refused before a subagent run is created", () => {
  const created: string[] = [];
  const guard = createPiDispatchGuard({
    loadedProfiles: LOADED,
    writeRun: (profile) => {
      created.push(profile);
    }
  });
  const result = guard.dispatch("general-purpose");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "undeclared");
  assert.equal(result.requestedName, "general-purpose");
  assert.deepEqual(result.available, [...LOADED].sort());
  assert.match(result.message, /Unknown agent: general-purpose/);
  assert.deepEqual(created, []);
});

test("worker passes preflight and may create a run", () => {
  const created: string[] = [];
  const guard = createPiDispatchGuard({
    loadedProfiles: LOADED,
    writeRun: (profile) => {
      created.push(profile);
    }
  });
  const result = guard.dispatch("worker");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.profile, "worker");
  assert.deepEqual(created, ["worker"]);
});

test("a declared profile that is not loaded fails closed without a run", () => {
  const created: string[] = [];
  const guard = createPiDispatchGuard({
    loadedProfiles: ["worker", "scout"],
    writeRun: (profile) => {
      created.push(profile);
    }
  });
  const result = guard.dispatch("debugger");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "declared-missing");
  assert.equal(result.requestedName, "debugger");
  assert.deepEqual(created, []);
});

test("implementer maps to worker; tester stays unmapped; no silent substitute for general-purpose", () => {
  const implementer = preflightAgentRole("implementer", LOADED);
  assert.equal(implementer.ok, true);
  if (implementer.ok) assert.equal(implementer.profile, "worker");

  const tester = preflightAgentRole("tester", LOADED);
  assert.equal(tester.ok, false);
  if (!tester.ok) {
    assert.equal(tester.code, "unmapped-role");
    assert.equal(tester.requestedName, "tester");
  }

  const unknownRole = preflightAgentRole("general-purpose", LOADED);
  assert.equal(unknownRole.ok, false);
  if (!unknownRole.ok) {
    assert.equal(unknownRole.code, "undeclared");
    assert.equal(unknownRole.requestedName, "general-purpose");
  }

  const byName = preflightPiAgentName("general-purpose", LOADED);
  assert.equal(byName.ok, false);
  if (!byName.ok) assert.notEqual(byName.requestedName, "worker");
});

test("listPiAgentProfiles reads markdown stems and ignores missing directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-sparkle-agents-"));
  try {
    await mkdir(join(root, "agents"));
    await writeFile(join(root, "agents", "worker.md"), "---\nname: worker\n---\n", "utf8");
    await writeFile(join(root, "agents", "scout.md"), "# scout\n", "utf8");
    assert.deepEqual(listPiAgentProfiles(join(root, "agents")), ["scout", "worker"]);
    assert.deepEqual(listPiAgentProfiles(join(root, "missing")), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
