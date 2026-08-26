import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  asAuthStoreUnreadable,
  AUTH_STORE_UNREADABLE_CODE,
  AuthStoreUnreadableError,
  EmptyCredentialStore,
  FileCredentialStore
} from "../../../src/pi-adapter/file-credential-store.js";
import { DomainValidationError } from "../../../src/domain/errors.js";

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

test("delete reports whether there was a credential to remove", async () => {
  await withDir(async (dir) => {
    const store = new FileCredentialStore(join(dir, "runtime", "auth.json"));
    assert.equal(await store.deleteExisting("openai"), false);
    await store.modify("openai", async () => ({ type: "api_key", key: "sk-one" }));
    assert.equal(await store.deleteExisting("openai"), true);
    assert.equal(await store.deleteExisting("openai"), false);
  });
});

test("a damaged store fails every verb with the file, a reason, and the move-aside remedy", async () => {
  await withDir(async (dir) => {
    const path = join(dir, "runtime", "auth.json");
    const damaged: readonly [string, RegExp][] = [
      ["{not-json", /not valid JSON/],
      ['["openai"]', /not a JSON object/],
      ['{"openai": "sk-loose"}', /openai entry is not a credential/],
      ['{"openai": {"type": "oauth", "access": "a"}}', /openai oauth credential is incomplete/],
      ['{"openai": {"type": "carrier-pigeon"}}', /openai entry has an unknown credential type/]
    ];
    for (const [contents, reason] of damaged) {
      await mkdir(join(dir, "runtime"), { recursive: true });
      await writeFile(path, contents, "utf8");
      const store = new FileCredentialStore(path);
      // Reading, listing and deleting all load the store, so one damaged file
      // takes the whole surface down — including the log-out-and-back-in
      // remedy an operator would reach for first.
      for (const attempt of [
        () => store.read("openai"),
        () => store.list(),
        () => store.deleteExisting("openai"),
        () => store.modify("openai", async () => ({ type: "api_key", key: "sk-new" }))
      ]) {
        await assert.rejects(attempt, (error: unknown) => {
          assert.ok(error instanceof AuthStoreUnreadableError);
          assert.equal(error.code, AUTH_STORE_UNREADABLE_CODE);
          assert.equal(error.path, path);
          assert.match(error.message, reason);
          assert.match(error.message, new RegExp(`auth\\.json at ${path}`));
          assert.match(error.message, /safe to move aside/);
          // Callers that only know the base class keep working.
          assert.ok(error instanceof DomainValidationError);
          return true;
        });
      }
      // Nothing on this path may remove a credential file it cannot parse.
      assert.equal(await readFile(path, "utf8"), contents);
    }
  });
});

test("the damaged-store failure is recognised through a dependency's wrapper", async () => {
  const inner = new AuthStoreUnreadableError("/state/runtime/auth.json", "not valid JSON");
  // Pi wraps a credential-store read failure in its own error, so the CLI has
  // to classify the cause chain rather than the thrown object alone.
  const wrapped = new Error("Credential store read failed for openai", { cause: inner });
  assert.equal(asAuthStoreUnreadable(wrapped)?.path, "/state/runtime/auth.json");
  assert.equal(asAuthStoreUnreadable(inner)?.message, inner.message);
  assert.equal(asAuthStoreUnreadable(new Error("unrelated")), undefined);
  assert.equal(asAuthStoreUnreadable(undefined), undefined);
});

test("the empty store reports no credentials and refuses to write", async () => {
  const store = new EmptyCredentialStore();
  assert.equal(await store.read("openai"), undefined);
  assert.deepEqual(await store.list(), []);
  // The env-only auth check is its only caller; a write would mean a stored
  // credential had been silently dropped instead of persisted.
  await assert.rejects(
    () => store.modify("openai", async () => ({ type: "api_key", key: "sk-new" })),
    DomainValidationError
  );
  await assert.rejects(() => store.delete("openai"), DomainValidationError);
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
