import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createProjectId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import {
  loadProjectBanditByKey,
  projectBanditPath,
  updateProjectBandit
} from "../../../src/learning/bandit-store.js";
import {
  routingPolicyIdentity,
  stableProjectKey
} from "../../../src/learning/learned-routing.js";
import type { ObservedSignal } from "../../../src/learning/signals.js";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-project-key-case-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function taskSuccess(modelId: string): ObservedSignal {
  return {
    source: "deterministic",
    kind: "deterministic",
    projectId: createProjectId(),
    modelId,
    score: 90,
    criterion: "taskSuccess",
    outcomeKind: "PASS",
    boundary: "execution",
    summary: "task pass",
    evidenceIds: [],
    createdAt: nowIso()
  };
}

// Case-distinctness contract: two distinct real directories whose paths differ
// only in case are two projects. Whole-string lowercasing (the pre-fix behavior)
// collapses them onto one key, one routing-policy identity, and one learned-state
// directory, so every assertion in this group is RED until the normalization
// stops lowercasing below the volume prefix.

test("case-differing POSIX paths derive distinct project keys", () => {
  assert.notEqual(
    stableProjectKey("/tmp/pi-sparkle-key-case/ProjectA"),
    stableProjectKey("/tmp/pi-sparkle-key-case/projecta")
  );
});

test("case below the Windows volume prefix stays distinct", () => {
  assert.notEqual(
    stableProjectKey("C:/Users/86080/dev/ProjectA"),
    stableProjectKey("C:/Users/86080/dev/projecta")
  );
});

test("case-differing roots do not share a routing-policy identity", () => {
  const upper = routingPolicyIdentity("/tmp/pi-sparkle-key-case/ProjectA");
  const lower = routingPolicyIdentity("/tmp/pi-sparkle-key-case/projecta");
  assert.equal(upper.scope.kind, "project");
  assert.equal(lower.scope.kind, "project");
  if (upper.scope.kind === "project" && lower.scope.kind === "project") {
    assert.notEqual(upper.scope.projectId, lower.scope.projectId);
  }
});

test("case-differing roots write and read isolated bandit state on a shared state root", async () => {
  await withTempDir(async (stateRoot) => {
    const rootA = join(stateRoot, "CaseA");
    const rootB = join(stateRoot, "casea");
    await updateProjectBandit(stateRoot, rootA, [taskSuccess("model-a")]);

    assert.notEqual(
      projectBanditPath(stateRoot, rootA),
      projectBanditPath(stateRoot, rootB),
      "distinct projects must not share a bandit path"
    );
    const leaked = await loadProjectBanditByKey(stateRoot, stableProjectKey(rootB));
    assert.equal(
      leaked,
      undefined,
      "project B must not read project A's bandit through a case-collapsed key"
    );
  });
});

test("case-differing sibling directories key independently on a case-sensitive filesystem", { skip: process.platform === "win32" }, async () => {
  // Skipped on win32: NTFS/Win32 cannot host two sibling directories whose
  // names differ only by case, so the on-disk premise is unconstructable
  // there; the key-level contracts above already run on every platform.
  await withTempDir(async (base) => {
    const dirA = join(base, "SiblingA");
    const dirB = join(base, "siblinga");
    await mkdir(dirA);
    await mkdir(dirB);
    const statLike = await import("node:fs/promises");
    const a = await statLike.readdir(base);
    assert.equal(a.filter((entry) => entry.toLowerCase() === "siblinga").length, 2);
    assert.notEqual(stableProjectKey(dirA), stableProjectKey(dirB));
  });
});

// Characterization: the existing cross-platform equivalence contracts must
// survive the normalization change. These pass before and after the fix.

test("backslash separators and trailing separators normalize to one key", () => {
  assert.equal(stableProjectKey("C:\\a\\b\\"), stableProjectKey("C:/a/b"));
  assert.equal(stableProjectKey("/tmp/x/y/"), stableProjectKey("/tmp/x/y"));
});

test("windows drive letter folding is preserved", () => {
  assert.equal(stableProjectKey("c:/a/b"), stableProjectKey("C:/a/b"));
});

test("UNC host and share prefix folding is preserved", () => {
  assert.equal(
    stableProjectKey("//Server/Share/proj"),
    stableProjectKey("//SERVER/SHARE/proj")
  );
  assert.equal(
    stableProjectKey("//Server/Share/Proj"),
    stableProjectKey("//SERVER/SHARE/Proj")
  );
  assert.notEqual(
    stableProjectKey("//Server/Share/proj"),
    stableProjectKey("//Server/Share/other")
  );
});
