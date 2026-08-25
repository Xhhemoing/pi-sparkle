import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
    const path = join(dir, "runtime", "auth.json");
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
    const store = new FileCredentialStore(join(dir, "runtime", "auth.json"));
    assert.equal(await store.read("openai"), undefined);
    assert.deepEqual(await store.list(), []);
    await store.modify("openai", async () => ({ type: "api_key", key: "sk-one" }));
    assert.deepEqual(await store.read("openai"), { type: "api_key", key: "sk-one" });
    await store.delete("openai");
    assert.equal(await store.read("openai"), undefined);
  });
});

test("save preserves credential bytes, ignores a legacy fixed temp, and chmods after publish", async () => {
  await withDir(async (dir) => {
    const path = join(dir, "runtime", "auth.json");
    const legacyTemp = `${path}.tmp`;
    const store = new FileCredentialStore(path);
    await store.modify("openai", async () => ({ type: "api_key", key: "old" }));
    await writeFile(legacyTemp, "stale-writer-bytes", "utf8");

    await store.modify("openai", async () => ({ type: "api_key", key: "sk-secret" }));

    assert.equal(
      await readFile(path, "utf8"),
      '{\n  "openai": {\n    "type": "api_key",\n    "key": "sk-secret"\n  }\n}\n'
    );
    assert.equal(await readFile(legacyTemp, "utf8"), "stale-writer-bytes");
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  });
});

test("credential publishing delegates to the shared atomic writer before chmod", async () => {
  const source = await readFile("src/pi-adapter/file-credential-store.ts", "utf8");
  assert.match(source, /import \{ writeFileAtomic \} from "\.\.\/persist\/atomic-file\.js";/);
  assert.match(
    source,
    /await writeFileAtomic\(this\.filePath, serialized\);\s+await chmod\(this\.filePath, 0o600\)/
  );
  assert.doesNotMatch(source, /\b(?:open|rename|unlink)\(/);
  assert.doesNotMatch(source, /tempPath|`[^`]*\.tmp`/);
});
