import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DomainValidationError } from "../../../src/domain/errors.js";
import {
  blendedQuality,
  loadPublicPriorFile,
  parsePublicPriorSnapshot,
  publicPriorHash
} from "../../../src/routing/public-prior.js";
import { loadPublicPriorSnapshot } from "../../../src/routing/public-prior-store.js";

const TS = "2026-08-19T00:00:00.000Z";
const SNAPSHOT_ID = "pps_fixture_v1";
const FIXTURE_JSON = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../dataset/public-priors",
  `${SNAPSHOT_ID}.json`
);

function score(sourceId: string, alias: string, raw: number, sourceUrl: string) {
  return {
    sourceId,
    modelAliases: [alias],
    raw,
    unit: "pass_rate" as const,
    fetchedAt: TS,
    sourceUrl
  };
}

function snapshotBody() {
  return {
    schemaVersion: 1,
    snapshotId: SNAPSHOT_ID,
    createdAt: TS,
    qualityBar: 0.55,
    scores: [
      score("aider-polyglot", "cheap", 0.4, "https://aider.chat/docs/leaderboards/"),
      score("aider-polyglot", "premium", 0.88, "https://aider.chat/docs/leaderboards/"),
      score("swe-bench-verified-mini", "cheap", 0.31, "https://www.swebench.com/verified"),
      score("swe-bench-verified-mini", "premium", 0.74, "https://www.swebench.com/verified"),
      score("terminal-bench-2.1-fixed-harness", "cheap", 0.5, "https://www.tbench.ai/leaderboard/terminal-bench/2.1"),
      score("terminal-bench-2.1-fixed-harness", "premium", 0.8, "https://www.tbench.ai/leaderboard/terminal-bench/2.1")
    ]
  };
}

function expectedHash(): string {
  return publicPriorHash(parsePublicPriorSnapshot(snapshotBody()));
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-public-prior-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("sidecar hash mismatch fails closed with DomainValidationError", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, `${SNAPSHOT_ID}.json`);
    await writeFile(path, `${JSON.stringify(snapshotBody(), null, 2)}\n`, "utf8");
    await writeFile(join(dir, `${SNAPSHOT_ID}.hash`), "deadbeef", "utf8");
    await assert.rejects(() => loadPublicPriorSnapshot(path), (error: unknown) => {
      assert.ok(error instanceof DomainValidationError);
      assert.match(error.message, /mismatch/i);
      return true;
    });
  });
});

test("matching sibling .hash sidecar loads snapshot and hash", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, `${SNAPSHOT_ID}.json`);
    const hash = expectedHash();
    await writeFile(path, `${JSON.stringify(snapshotBody(), null, 2)}\n`, "utf8");
    await writeFile(join(dir, `${SNAPSHOT_ID}.hash`), `${hash}\n`, "utf8");
    const loaded = await loadPublicPriorSnapshot(path);
    assert.equal(loaded.snapshot.snapshotId, SNAPSHOT_ID);
    assert.equal(loaded.hash, hash);
    assert.equal(publicPriorHash(loaded.snapshot), hash);
  });
});

test("matching path.json.hash sidecar loads snapshot and hash", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, `${SNAPSHOT_ID}.json`);
    const hash = expectedHash();
    await writeFile(path, `${JSON.stringify(snapshotBody(), null, 2)}\n`, "utf8");
    await writeFile(`${path}.hash`, hash, "utf8");
    const loaded = await loadPublicPriorSnapshot(path);
    assert.equal(loaded.hash, hash);
    assert.equal(loaded.snapshot.qualityBar, 0.55);
  });
});

test("matching embedded contentHash loads snapshot and hash", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, `${SNAPSHOT_ID}.json`);
    const hash = expectedHash();
    await writeFile(path, `${JSON.stringify({ ...snapshotBody(), contentHash: hash }, null, 2)}\n`, "utf8");
    const loaded = await loadPublicPriorSnapshot(path);
    assert.equal(loaded.hash, hash);
    assert.equal(loaded.snapshot.snapshotId, SNAPSHOT_ID);
  });
});

test("matching embedded hash field loads snapshot and hash", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, `${SNAPSHOT_ID}.json`);
    const hash = expectedHash();
    await writeFile(path, `${JSON.stringify({ ...snapshotBody(), hash }, null, 2)}\n`, "utf8");
    const loaded = await loadPublicPriorSnapshot(path);
    assert.equal(loaded.hash, hash);
  });
});

test("missing sidecar and embedded hash fails closed", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, `${SNAPSHOT_ID}.json`);
    await writeFile(path, `${JSON.stringify(snapshotBody(), null, 2)}\n`, "utf8");
    await assert.rejects(() => loadPublicPriorSnapshot(path), (error: unknown) => {
      assert.ok(error instanceof DomainValidationError);
      assert.match(error.message, /hash/i);
      return true;
    });
  });
});

test("unreadable snapshot file fails closed", async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(
      () => loadPublicPriorSnapshot(join(dir, "missing.json")),
      DomainValidationError
    );
  });
});

test("invalid JSON fails closed", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, `${SNAPSHOT_ID}.json`);
    await writeFile(path, "{not-json", "utf8");
    await writeFile(join(dir, `${SNAPSHOT_ID}.hash`), expectedHash(), "utf8");
    await assert.rejects(() => loadPublicPriorSnapshot(path), (error: unknown) => {
      assert.ok(error instanceof DomainValidationError);
      assert.match(error.message, /JSON/i);
      return true;
    });
  });
});

test("dataset fixture loads when sidecar hash matches publicPriorHash", async () => {
  const loaded = await loadPublicPriorSnapshot(FIXTURE_JSON);
  assert.equal(loaded.snapshot.snapshotId, SNAPSHOT_ID);
  assert.equal(loaded.hash, publicPriorHash(loaded.snapshot));
  assert.equal(loaded.snapshot.scores.length, 6);
});

test("unknown catalog id is not zero-filled after hashed load", async () => {
  const { snapshot } = await loadPublicPriorSnapshot(FIXTURE_JSON);
  const quality = blendedQuality(snapshot, "edit", ["cheap", "premium", "mystery"]);
  assert.equal(quality.has("mystery"), false);
  assert.equal(quality.get("mystery"), undefined);
  assert.ok(quality.has("cheap"));
  assert.ok(quality.has("premium"));
});

test("loadPublicPriorFile still loads without a hash", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, `${SNAPSHOT_ID}.json`);
    await writeFile(path, `${JSON.stringify(snapshotBody(), null, 2)}\n`, "utf8");
    const snapshot = await loadPublicPriorFile(path);
    assert.equal(snapshot.snapshotId, SNAPSHOT_ID);
  });
});

test("hashed loader does not import r1 or fetch HTTP", async () => {
  const source = await readFile(new URL("../../../src/routing/public-prior-store.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /routing\/r1/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /https?:\/\//);
});
