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

test("save preserves credential bytes, ignores a legacy fixed temp, and publishes owner-only", async () => {
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

test("a permissive umask cannot widen the credential file", async () => {
  const previous = process.umask(0o000);
  try {
    await withDir(async (dir) => {
      const path = join(dir, "runtime", "auth.json");
      const store = new FileCredentialStore(path);
      await store.modify("openai", async () => ({ type: "api_key", key: "sk-secret" }));
      // 0o666 is what the umask would have allowed the create to keep.
      assert.equal((await stat(path)).mode & 0o777, 0o600);
    });
  } finally {
    process.umask(previous);
  }
});

test("credential publishing asks the shared atomic writer for the mode, and refuses to swallow chmod", async () => {
  const source = await readFile("src/pi-adapter/file-credential-store.ts", "utf8");
  assert.match(source, /import \{ writeFileAtomic \} from "\.\.\/persist\/atomic-file\.js";/);
  // The mode belongs on the write, not only after it: a chmod-only store leaves
  // the published file readable for as long as the chmod takes to land.
  assert.match(
    source,
    /await writeFileAtomic\(this\.filePath, serialized, \{ mode: CREDENTIAL_FILE_MODE \}\)/
  );
  // A chmod this process could not apply means the credential on disk may be
  // readable by other users, and that is the one outcome that must not pass
  // silently. Provoking a real chmod failure needs a file this process does
  // not own — nothing a unit test can arrange portably — so the shape is
  // pinned instead: no `.catch`, and a raised DomainValidationError.
  assert.doesNotMatch(source, /chmod\([^)]*\)\.catch/);
  assert.match(source, /throw new DomainValidationError\(\s*`cannot restrict/);
  assert.doesNotMatch(source, /\b(?:open|rename|unlink)\(/);
  assert.doesNotMatch(source, /tempPath|`[^`]*\.tmp`/);
});
