import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type CliIo } from "../../../src/cli/main.js";
import { clearAll, configurePreferencePersistence } from "../../../src/preferences/service.js";

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
    },
    out,
    err,
  };
}

beforeEach(() => {
  configurePreferencePersistence(undefined);
  clearAll();
});

async function withPrefRoot(run: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-pref-cli-"));
  try {
    await run(stateRoot);
  } finally {
    configurePreferencePersistence(undefined);
    clearAll();
    await rm(stateRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => undefined);
  }
}

function withRoot(stateRoot: string, args: string[]): string[] {
  return [...args, "--state-root", stateRoot];
}

describe("M4-T5: preference CLI workflow", () => {
  it("pref correct records an explicit preference visible to pref list", async () => {
    await withPrefRoot(async (stateRoot) => {
      const { io, out, err } = capture();
      const code = await main(
        withRoot(stateRoot, [
          "pref",
          "correct",
          "--scope",
          "user",
          "--scope-key",
          "u1",
          "--key",
          "format",
          "--value",
          "compact"
        ]),
        io
      );
      assert.equal(code, 0);
      assert.match(out.join(""), /recorded explicit preference/);
      assert.deepEqual(err, []);

      const list = capture();
      const listCode = await main(withRoot(stateRoot, ["pref", "list", "--scope", "user"]), list.io);
      assert.equal(listCode, 0);
      const text = list.out.join("");
      assert.match(text, /format=compact/);
      assert.match(text, /explicit=true/);
    });
  });

  it("pref list shows the materialized view with confidence and scope", async () => {
    await withPrefRoot(async (stateRoot) => {
      await main(
        withRoot(stateRoot, [
          "pref",
          "correct",
          "--scope",
          "project",
          "--scope-key",
          "p1",
          "--key",
          "ci",
          "--value",
          "strict"
        ]),
        capture().io
      );
      const list = capture();
      await main(withRoot(stateRoot, ["pref", "list"]), list.io);
      const text = list.out.join("");
      assert.match(text, /\[project:p1\]/);
      assert.match(text, /ci=strict/);
      assert.match(text, /confidence=/);
    });
  });

  it("pref export restricts to authorized scopes", async () => {
    await withPrefRoot(async (stateRoot) => {
      await main(
        withRoot(stateRoot, [
          "pref",
          "correct",
          "--scope",
          "user",
          "--scope-key",
          "u1",
          "--key",
          "format",
          "--value",
          "compact"
        ]),
        capture().io
      );
      await main(
        withRoot(stateRoot, [
          "pref",
          "correct",
          "--scope",
          "project",
          "--scope-key",
          "p1",
          "--key",
          "ci",
          "--value",
          "strict"
        ]),
        capture().io
      );

      const exp = capture();
      const code = await main(withRoot(stateRoot, ["pref", "export", "--scope", "project"]), exp.io);
      assert.equal(code, 0);
      const parsed = JSON.parse(exp.out.join("")) as {
        count: number;
        observations: Array<{ scope: string }>;
      };
      assert.equal(parsed.count, 1);
      assert.ok(parsed.observations.every((o) => o.scope === "project"));
    });
  });

  it("pref delete tombstones a preference and removes it from the list", async () => {
    await withPrefRoot(async (stateRoot) => {
      const correct = capture();
      await main(
        withRoot(stateRoot, [
          "pref",
          "correct",
          "--scope",
          "user",
          "--scope-key",
          "u1",
          "--key",
          "format",
          "--value",
          "compact"
        ]),
        correct.io
      );
      const idMatch = correct.out.join("").match(/recorded explicit preference (\S+)/);
      assert.ok(idMatch);
      const id = idMatch![1]!;

      const del = capture();
      const code = await main(withRoot(stateRoot, ["pref", "delete", "--id", id]), del.io);
      assert.equal(code, 0);
      assert.match(del.out.join(""), /tombstoned/);

      const list = capture();
      await main(withRoot(stateRoot, ["pref", "list"]), list.io);
      assert.doesNotMatch(list.out.join(""), /format=compact/);

      const again = capture();
      assert.equal(await main(withRoot(stateRoot, ["pref", "delete", "--id", id]), again.io), 1);
      assert.match(again.out.join(""), /not found/);
    });
  });

  it("rejects unknown preference scopes", async () => {
    await withPrefRoot(async (stateRoot) => {
      const { io, err } = capture();
      const code = await main(
        withRoot(stateRoot, [
          "pref",
          "correct",
          "--scope",
          "bogus",
          "--scope-key",
          "u1",
          "--key",
          "k",
          "--value",
          "v"
        ]),
        io
      );
      assert.equal(code, 1);
      assert.match(err.join(""), /scope/);
    });
  });

  it("pref delete requires an id", async () => {
    await withPrefRoot(async (stateRoot) => {
      const { io, err } = capture();
      const code = await main(withRoot(stateRoot, ["pref", "delete"]), io);
      assert.equal(code, 1);
      assert.match(err.join(""), /--id/);
    });
  });

  it("help mentions the pref workflow", async () => {
    const { io, out } = capture();
    const code = await main(["help"], io);
    assert.equal(code, 0);
    assert.match(out.join(""), /pref (list|correct|export|delete)/);
  });
});
