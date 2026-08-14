import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { main, type CliIo } from "../../../src/cli/main.js";
import { clearAll } from "../../../src/preferences/service.js";

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
  clearAll();
});

describe("M4-T5: preference CLI workflow", () => {
  it("pref correct records an explicit preference visible to pref list", async () => {
    const { io, out, err } = capture();
    const code = await main(
      ["pref", "correct", "--scope", "user", "--scope-key", "u1", "--key", "format", "--value", "compact"],
      io
    );
    assert.equal(code, 0);
    assert.match(out.join(""), /recorded explicit preference/);
    assert.deepEqual(err, []);

    const list = capture();
    const listCode = await main(["pref", "list", "--scope", "user"], list.io);
    assert.equal(listCode, 0);
    const text = list.out.join("");
    assert.match(text, /format=compact/);
    assert.match(text, /explicit=true/);
  });

  it("pref list shows the materialized view with confidence and scope", async () => {
    await main(
      ["pref", "correct", "--scope", "project", "--scope-key", "p1", "--key", "ci", "--value", "strict"],
      capture().io
    );
    const list = capture();
    await main(["pref", "list"], list.io);
    const text = list.out.join("");
    assert.match(text, /\[project:p1\]/);
    assert.match(text, /ci=strict/);
    assert.match(text, /confidence=/);
  });

  it("pref export restricts to authorized scopes", async () => {
    await main(
      ["pref", "correct", "--scope", "user", "--scope-key", "u1", "--key", "format", "--value", "compact"],
      capture().io
    );
    await main(
      ["pref", "correct", "--scope", "project", "--scope-key", "p1", "--key", "ci", "--value", "strict"],
      capture().io
    );

    const exp = capture();
    const code = await main(["pref", "export", "--scope", "project"], exp.io);
    assert.equal(code, 0);
    const parsed = JSON.parse(exp.out.join("")) as {
      count: number;
      observations: Array<{ scope: string }>;
    };
    assert.equal(parsed.count, 1);
    assert.ok(parsed.observations.every((o) => o.scope === "project"));
  });

  it("pref delete tombstones a preference and removes it from the list", async () => {
    const correct = capture();
    await main(
      ["pref", "correct", "--scope", "user", "--scope-key", "u1", "--key", "format", "--value", "compact"],
      correct.io
    );
    const idMatch = correct.out.join("").match(/recorded explicit preference (\S+)/);
    assert.ok(idMatch);
    const id = idMatch![1]!;

    const del = capture();
    const code = await main(["pref", "delete", "--id", id], del.io);
    assert.equal(code, 0);
    assert.match(del.out.join(""), /tombstoned/);

    const list = capture();
    await main(["pref", "list"], list.io);
    assert.doesNotMatch(list.out.join(""), /format=compact/);

    // Deleting again reports not found and exits non-zero.
    const again = capture();
    assert.equal(await main(["pref", "delete", "--id", id], again.io), 1);
    assert.match(again.out.join(""), /not found/);
  });

  it("rejects unknown preference scopes", async () => {
    const { io, err } = capture();
    const code = await main(
      ["pref", "correct", "--scope", "bogus", "--scope-key", "u1", "--key", "k", "--value", "v"],
      io
    );
    assert.equal(code, 1);
    assert.match(err.join(""), /scope/);
  });

  it("pref delete requires an id", async () => {
    const { io, err } = capture();
    const code = await main(["pref", "delete"], io);
    assert.equal(code, 1);
    assert.match(err.join(""), /--id/);
  });

  it("help mentions the pref workflow", async () => {
    const { io, out } = capture();
    const code = await main(["help"], io);
    assert.equal(code, 0);
    assert.match(out.join(""), /pref (list|correct|export|delete)/);
  });
});
