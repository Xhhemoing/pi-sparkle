import assert from "node:assert/strict";
import { access, mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { withExclusiveFileLock } from "../../../src/persist/file-lock.js";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-file-lock-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function assertMissing(path: string): Promise<void> {
  await assert.rejects(access(path), { code: "ENOENT" });
}

test("withExclusiveFileLock serializes two concurrent writers", async () => {
  await withTempDir(async (dir) => {
    const lockPath = join(dir, "nested", "write.lock");
    let activeWriters = 0;
    let maximumActiveWriters = 0;
    const completed: string[] = [];

    const write = async (label: string): Promise<void> => {
      await withExclusiveFileLock(lockPath, async () => {
        activeWriters += 1;
        maximumActiveWriters = Math.max(maximumActiveWriters, activeWriters);
        try {
          await delay(20);
          completed.push(label);
        } finally {
          activeWriters -= 1;
        }
      });
    };

    await Promise.all([write("first"), write("second")]);

    assert.equal(maximumActiveWriters, 1);
    assert.deepEqual(completed.toSorted(), ["first", "second"]);
    await assertMissing(lockPath);
  });
});

test("withExclusiveFileLock times out while another owner holds the lock", async () => {
  await withTempDir(async (dir) => {
    const lockPath = join(dir, "write.lock");
    const acquired = deferred();
    const release = deferred();
    const holder = withExclusiveFileLock(lockPath, async () => {
      acquired.resolve();
      await release.promise;
    });
    await acquired.promise;

    let operationCalled = false;
    const startedAt = Date.now();
    try {
      await assert.rejects(
        () =>
          withExclusiveFileLock(
            lockPath,
            async () => {
              operationCalled = true;
            },
            { timeoutMs: 20, retryMs: 2 }
          ),
        (error: unknown) =>
          error instanceof DomainValidationError &&
          "code" in error &&
          error.code === "LOCK_TIMEOUT" &&
          error.message === `timed out waiting for lock at ${lockPath}`
      );
      assert.equal(operationCalled, false);
      assert.ok(Date.now() - startedAt >= 20);
    } finally {
      release.resolve();
      await holder;
    }
  });
});

test("stale-looking lock metadata remains timeout-only", async () => {
  await withTempDir(async (dir) => {
    const lockPath = join(dir, "write.lock");
    const stale = JSON.stringify({
      ownerToken: "abandoned-owner",
      pid: 2_147_483_647,
      acquiredAt: "2000-01-01T00:00:00.000Z"
    });
    await writeFile(lockPath, stale, "utf8");

    await assert.rejects(
      () => withExclusiveFileLock(lockPath, async () => undefined, { timeoutMs: 10, retryMs: 1 }),
      /timed out waiting for lock/
    );
    assert.equal(await readFile(lockPath, "utf8"), stale);
  });
});

test("release removes only a parseable lock with the exact ownerToken", async () => {
  await withTempDir(async (dir) => {
    const lockPath = join(dir, "write.lock");
    let ownerToken = "";
    await withExclusiveFileLock(lockPath, async () => {
      const metadata = JSON.parse(await readFile(lockPath, "utf8")) as {
        readonly ownerToken: string;
        readonly pid: number;
      };
      ownerToken = metadata.ownerToken;
      assert.equal(metadata.pid, process.pid);
    });
    assert.notEqual(ownerToken, "");
    await assertMissing(lockPath);

    const replacement = JSON.stringify({
      ownerToken: "replacement-owner",
      pid: process.pid,
      acquiredAt: new Date().toISOString()
    });
    await withExclusiveFileLock(lockPath, async () => {
      await writeFile(lockPath, replacement, "utf8");
    });
    assert.equal(await readFile(lockPath, "utf8"), replacement);

    await rm(lockPath);
    await withExclusiveFileLock(lockPath, async () => {
      const metadata = JSON.parse(await readFile(lockPath, "utf8")) as {
        readonly ownerToken: string;
      };
      await writeFile(lockPath, `malformed "ownerToken":"${metadata.ownerToken}"`, "utf8");
    });
    assert.match(await readFile(lockPath, "utf8"), /^malformed/);
  });
});

test("operation failure still releases the owned lock", async () => {
  await withTempDir(async (dir) => {
    const lockPath = join(dir, "write.lock");
    await assert.rejects(
      () =>
        withExclusiveFileLock(lockPath, async () => {
          throw new Error("operation failed");
        }),
      /operation failed/
    );
    await assertMissing(lockPath);
    await withExclusiveFileLock(lockPath, async () => undefined);
  });
});

test("metadata write failure closes and removes the partially acquired lock", async () => {
  await withTempDir(async (dir) => {
    const probePath = join(dir, "probe");
    const probe = await open(probePath, "w");
    type Handle = typeof probe;
    type HandlePrototype = {
      writeFile: Handle["writeFile"];
    };
    const prototype = Object.getPrototypeOf(probe) as HandlePrototype;
    const originalWriteFile = prototype.writeFile;
    await probe.close();
    await rm(probePath);

    let failedHandle: Handle | undefined;
    prototype.writeFile = (async function (this: Handle): Promise<void> {
      failedHandle = this;
      throw Object.assign(new Error("simulated metadata write failure"), { code: "EIO" });
    }) as Handle["writeFile"];
    const lockPath = join(dir, "write.lock");
    try {
      await assert.rejects(
        () => withExclusiveFileLock(lockPath, async () => undefined),
        /simulated metadata write failure/
      );
    } finally {
      prototype.writeFile = originalWriteFile;
    }

    assert.ok(failedHandle !== undefined);
    assert.equal(failedHandle.fd, -1);
    await assertMissing(lockPath);
    await withExclusiveFileLock(lockPath, async () => undefined);
  });
});

test("withExclusiveFileLock creates the lock owner-only even under a permissive umask", async (t) => {
  if (process.platform === "win32") {
    t.skip("NTFS mode bits are not a trustworthy ACL");
    return;
  }
  const previous = process.umask(0o000);
  try {
    await withTempDir(async (dir) => {
      const lockPath = join(dir, "write.lock");
      await withExclusiveFileLock(lockPath, async () => {
        assert.equal((await stat(lockPath)).mode & 0o777, 0o600);
      });
    });
  } finally {
    process.umask(previous);
  }
});
