import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FileCredentialStore } from "../../../src/pi-adapter/file-credential-store.js";

async function withDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-auth-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("list returns provider metadata without secrets", async () => {
  await withDir(async (dir) => {
    const path = join(dir, "auth.json");
    const store = new FileCredentialStore(path);
    await store.modify("openai", async () => ({ type: "api_key", key: "sk-secret-do-not-list" }));
    const listed = await store.list();
    assert.deepEqual(listed, [{ providerId: "openai", type: "api_key" }]);
    const raw = await readFile(path, "utf8");
    assert.match(raw, /sk-secret-do-not-list/);
    assert.equal(JSON.stringify(listed).includes("sk-"), false);
  });
});

test("read returns the stored credential and missing file is empty", async () => {
  await withDir(async (dir) => {
    const store = new FileCredentialStore(join(dir, "auth.json"));
    assert.equal(await store.read("openai"), undefined);
    assert.deepEqual(await store.list(), []);
    await store.modify("openai", async () => ({ type: "api_key", key: "sk-one" }));
    assert.deepEqual(await store.read("openai"), { type: "api_key", key: "sk-one" });
    await store.delete("openai");
    assert.equal(await store.read("openai"), undefined);
  });
});
