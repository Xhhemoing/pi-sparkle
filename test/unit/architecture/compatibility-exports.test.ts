import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import * as cliCatalog from "../../../src/cli/model-catalog.js";
import * as routingCatalog from "../../../src/routing/model-catalog.js";
import { lockWaitOptions as mainLockWaitOptions, type CliIo as MainCliIo } from "../../../src/cli/main.js";
import { lockWaitOptions, type CliIo } from "../../../src/cli/options.js";
import * as privacyLayout from "../../../src/privacy/state-layout.js";
import * as persistLayout from "../../../src/persist/state-layout.js";

test("old model catalog path forwards every runtime export with the same identity", () => {
  assert.deepEqual(Object.keys(cliCatalog), Object.keys(routingCatalog));
  for (const key of Object.keys(cliCatalog) as (keyof typeof cliCatalog)[]) {
    assert.equal(cliCatalog[key], routingCatalog[key], key);
  }
  const error = new routingCatalog.UnknownCatalogModelError("custom/missing", "custom", "custom");
  assert.ok(error instanceof cliCatalog.UnknownCatalogModelError);
});

test("main keeps the original helper and IO type exports", () => {
  assert.equal(mainLockWaitOptions, lockWaitOptions);
  const output: string[] = [];
  const io: CliIo = { stdout: (text) => output.push(text), stderr: (text) => output.push(text) };
  const legacyIo: MainCliIo = io;
  legacyIo.stdout("same structural CLI IO contract");
  assert.deepEqual(output, ["same structural CLI IO contract"]);
  assert.deepEqual(lockWaitOptions(undefined), {});
  assert.deepEqual(lockWaitOptions("0"), { timeoutMs: 0 });
  assert.deepEqual(lockWaitOptions("86400000"), { timeoutMs: 86_400_000 });
});

test("old state layout path forwards the same helpers and fixed durable paths", () => {
  assert.deepEqual(Object.keys(privacyLayout), Object.keys(persistLayout));
  for (const key of Object.keys(privacyLayout) as (keyof typeof privacyLayout)[]) {
    assert.equal(privacyLayout[key], persistLayout[key], key);
  }
  const stateRoot = join("state with spaces", "nested");
  assert.equal(persistLayout.runtimeRoot(stateRoot), join(stateRoot, "runtime"));
  assert.equal(persistLayout.adaptationRoot(stateRoot), join(stateRoot, "adaptation"));
  assert.equal(persistLayout.evalDatasetsRoot(stateRoot), join(stateRoot, "adaptation", "eval-datasets"));
  assert.equal(
    persistLayout.defaultEvalDatasetDir(stateRoot, "run_existing"),
    join(stateRoot, "adaptation", "eval-datasets", "run_existing")
  );
});
