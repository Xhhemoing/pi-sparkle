import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCliErrorJson } from "../../../src/cli/errors.js";
import { main, type CliIo } from "../../../src/cli/main.js";

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (text) => out.push(text), stderr: (text) => err.push(text) },
    out,
    err
  };
}

test("list reaches its own command instead of the unknown-command path", async () => {
  const { io, out, err } = capture();
  const code = await main(["list", "--help"], io);
  assert.equal(code, 0, err.join(""));
  assert.match(out.join(""), /pi-sparkle list/);
});

test("init reaches its own command and writes nothing for --help", async () => {
  const { io, out, err } = capture();
  const code = await main(["init", "--help"], io);
  assert.equal(code, 0, err.join(""));
  assert.match(out.join(""), /pi-sparkle init/);
});

test("validate stays reachable", async () => {
  const { io, out, err } = capture();
  const code = await main(["validate", "--help"], io);
  assert.equal(code, 0, err.join(""));
  assert.match(out.join(""), /pi-sparkle validate/);
});

test("an unknown command still fails with the routed report", async () => {
  const { io, out, err } = capture();
  const code = await main(["not-a-command"], io);
  assert.equal(code, 1);
  assert.deepEqual(out, []);
  assert.match(err.join(""), /Unknown command: not-a-command/);
  assert.equal(parseCliErrorJson(err.join(""))?.command, "pi-sparkle");
});

test("usage lists the newly dispatched verbs", async () => {
  const { io, out } = capture();
  assert.equal(await main(["help"], io), 0);
  const usage = out.join("");
  assert.match(usage, /^ {2}pi-sparkle list \[--runs \| --episodes\]/m);
  assert.match(usage, /^ {2}pi-sparkle init \[--dir <path>\]/m);
});
