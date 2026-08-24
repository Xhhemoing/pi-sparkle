import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { createProjectId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import {
  loadProjectBandit,
  updateProjectBandit
} from "../../../src/learning/bandit-store.js";
import { stableProjectKey } from "../../../src/learning/learned-routing.js";
import type { ObservedSignal } from "../../../src/learning/signals.js";
import { withExclusiveFileLock } from "../../../src/persist/file-lock.js";
import { adaptationRoot, runtimeRoot } from "../../../src/privacy/state-layout.js";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-bandit-store-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function expectedBanditPath(stateRoot: string, projectRoot: string): string {
  return join(
    adaptationRoot(stateRoot),
    "learning",
    "projects",
    stableProjectKey(projectRoot),
    "bandit.json"
  );
}

function taskSuccess(modelId: string, outcomeKind: "PASS" | "FAIL"): ObservedSignal {
  return {
    source: "deterministic",
    kind: "deterministic",
    projectId: createProjectId(),
    modelId,
    score: outcomeKind === "PASS" ? 90 : 15,
    criterion: "taskSuccess",
    outcomeKind,
    boundary: "execution",
    summary: `task ${outcomeKind.toLowerCase()}`,
    evidenceIds: [],
    createdAt: nowIso()
  };
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("creates, updates, and loads project state only from the adaptation plane", async () => {
  await withTempDir(async (stateRoot) => {
    const projectRoot = join(stateRoot, "project");
    const created = await updateProjectBandit(stateRoot, projectRoot, [
      taskSuccess("model-a", "PASS")
    ]);
    assert.deepEqual(created, {
      arms: ["model-a"],
      pulls: { "model-a": 1 },
      rewardSum: { "model-a": 1 },
      explorationsUsed: 0,
      highRiskExplorations: 0
    });

    const updated = await updateProjectBandit(stateRoot, projectRoot, [
      taskSuccess("model-a", "FAIL"),
      taskSuccess("model-b", "PASS")
    ]);
    assert.deepEqual(updated, {
      arms: ["model-a", "model-b"],
      pulls: { "model-a": 2, "model-b": 1 },
      rewardSum: { "model-a": 1, "model-b": 1 },
      explorationsUsed: 0,
      highRiskExplorations: 0
    });
    assert.deepEqual(await loadProjectBandit(stateRoot, projectRoot), updated);
    await access(expectedBanditPath(stateRoot, projectRoot));
    await assert.rejects(access(runtimeRoot(stateRoot)), { code: "ENOENT" });
  });
});

test("corrupt or structurally invalid bandit JSON fails closed", async () => {
  await withTempDir(async (stateRoot) => {
    const projectRoot = join(stateRoot, "project");
    const path = expectedBanditPath(stateRoot, projectRoot);
    await mkdir(dirname(path), { recursive: true });

    await writeFile(path, '{"arms":', "utf8");
    assert.equal(await loadProjectBandit(stateRoot, projectRoot), undefined);

    await writeFile(
      path,
      JSON.stringify({
        arms: "model-a",
        pulls: { "model-a": 100 },
        rewardSum: { "model-a": 100 },
        explorationsUsed: 0,
        highRiskExplorations: 0
      }),
      "utf8"
    );
    assert.equal(await loadProjectBandit(stateRoot, projectRoot), undefined);

    const recovered = await updateProjectBandit(stateRoot, projectRoot, [
      taskSuccess("model-b", "PASS")
    ]);
    assert.deepEqual(recovered.arms, ["model-b"]);
    assert.deepEqual(await loadProjectBandit(stateRoot, projectRoot), recovered);
  });
});

test("updates acquire the project bandit lock before writing", async () => {
  await withTempDir(async (stateRoot) => {
    const projectRoot = join(stateRoot, "project");
    const path = expectedBanditPath(stateRoot, projectRoot);
    const acquired = deferred();
    const release = deferred();
    const holder = withExclusiveFileLock(`${path}.lock`, async () => {
      acquired.resolve();
      await release.promise;
    });
    await acquired.promise;

    const update = updateProjectBandit(stateRoot, projectRoot, [
      taskSuccess("model-a", "PASS")
    ]);
    try {
      const result = await Promise.race([
        update.then(() => "completed" as const),
        delay(40).then(() => "blocked" as const)
      ]);
      assert.equal(result, "blocked");
    } finally {
      release.resolve();
      await holder;
    }

    assert.deepEqual((await update).pulls, { "model-a": 1 });
    await assert.rejects(access(`${path}.lock`), { code: "ENOENT" });
  });
});
