import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

const loaderUrl = new URL("./core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent"));

test("Pi loader loads packaged native tool and shutdown hook without starting provider work", async () => {
  const { loadExtensions } = await import(loaderUrl.href);
  const result = await loadExtensions([join(process.cwd(), "extensions/pi-sparkle/index.ts")], process.cwd());
  assert.deepEqual(result.errors, []);
  assert.equal(result.extensions.length, 1);
  const extension = result.extensions[0];
  assert.ok(extension.tools.has("sparkle_delegate"));
  assert.ok(extension.commands.has("sparkle-status"));
  assert.equal(extension.commands.has("sparkle"), false, "existing /sparkle prompt remains reachable");
  assert.ok(extension.handlers.has("session_shutdown"));
});

test("native kill switch registers no tools, commands or lifecycle writes", async () => {
  const previous = process.env.SPARKLE_NATIVE;
  try {
    process.env.SPARKLE_NATIVE = "0";
    const { loadExtensions } = await import(loaderUrl.href);
    const result = await loadExtensions([join(process.cwd(), "extensions/pi-sparkle/index.ts")], process.cwd());
    assert.deepEqual(result.errors, []);
    assert.equal(result.extensions[0].tools.size, 0);
    assert.equal(result.extensions[0].commands.size, 0);
    assert.equal(result.extensions[0].handlers.size, 0);
  } finally {
    if (previous === undefined) delete process.env.SPARKLE_NATIVE;
    else process.env.SPARKLE_NATIVE = previous;
  }
});
