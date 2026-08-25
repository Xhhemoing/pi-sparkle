import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

test("preview release probe exists and runs first in prerelease", () => {
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };

  assert.equal(existsSync(join(root, "scripts/preview-release-probe.mjs")), true);
  assert.equal(packageJson.scripts?.["preview:probe"], "node scripts/preview-release-probe.mjs");
  assert.equal(
    packageJson.scripts?.prerelease,
    "pnpm preview:probe && pnpm gate && pnpm security:probe && pnpm pi:probe"
  );
});
