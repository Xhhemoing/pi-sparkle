import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assertFlowchartModelsInCatalog, cliCatalogModelIds, createCliModelRouter } from "../../../src/cli/model-catalog.js";
import { collectSelectedActionIds, parseChildNodeResults, parseChildNodeResultsFile } from "../../../src/cli/flowchart-io.js";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { validateFlowchart } from "../../../src/domain/flowchart.js";

const tinyFlowchart = validateFlowchart({
  id: "catalog",
  nodes: [
    {
      id: "only",
      taskId: "tsk_only",
      role: "actor",
      objective: "Do the work",
      modelPolicy: { allowedModels: ["cheap"] },
      confidenceThreshold: 0.7,
      approvalRequired: false
    }
  ],
  edges: []
});

test("CLI catalog is cheap and premium", () => {
  assert.deepEqual([...cliCatalogModelIds()], ["cheap", "premium"]);
  const router = createCliModelRouter();
  assert.equal(router.config.policyVersion, "router-v1");
});

test("flowchart models outside the CLI catalog fail closed", () => {
  const flowchart = validateFlowchart({
    ...tinyFlowchart,
    nodes: [{ ...tinyFlowchart.nodes[0]!, modelPolicy: { allowedModels: ["mystery"] } }]
  });
  assert.throws(() => assertFlowchartModelsInCatalog(flowchart), /unavailable model "mystery"/);
});

test("collectSelectedActionIds merges flags and csv without inventing ids", () => {
  assert.equal(collectSelectedActionIds(undefined, undefined), undefined);
  assert.deepEqual(collectSelectedActionIds(["work"], undefined), ["work"]);
  assert.deepEqual(collectSelectedActionIds(undefined, "pathA,pathB"), ["pathA", "pathB"]);
  assert.deepEqual(collectSelectedActionIds(["work"], "work,extra"), ["work", "extra"]);
  assert.deepEqual(collectSelectedActionIds(undefined, ""), []);
});

test("parseChildNodeResults maps nodeId to fake results", () => {
  const parsed = parseChildNodeResults({
    work: { outcome: "SUCCESS", confidence: 0.9, evidenceIds: ["evd_work"] }
  });
  assert.equal(parsed.work?.outcome, "SUCCESS");
  assert.equal(parsed.work?.confidence, 0.9);
  assert.deepEqual(parsed.work?.evidenceIds, ["evd_work"]);
});

const ownKeyResultsJson = `{
  "__proto__": {
    "outcome": "SUCCESS", "confidence": 1, "evidenceIds": ["evd_proto"],
    "facts": [{ "key": "__proto__", "value": "prototype result", "confidence": 0.9 }]
  },
  "constructor": {
    "outcome": "PARTIAL", "confidence": 0.5, "evidenceIds": ["evd_constructor"],
    "facts": [{ "key": "constructor", "value": "constructor result", "confidence": 0.5 }]
  },
  "work": {
    "outcome": "FAILURE", "confidence": 0, "evidenceIds": [],
    "facts": [{ "key": "status", "value": "", "confidence": 0 }]
  },
  "minimal": { "outcome": "SUCCESS" }
}`;

async function withResultsFile(json: string, run: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-flowchart-results-"));
  try {
    const path = join(dir, "results.json");
    await writeFile(path, json, "utf8");
    await run(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function assertOwnKeyResults(parsed: ReturnType<typeof parseChildNodeResults>): void {
  const expected = JSON.parse(ownKeyResultsJson) as Record<string, unknown>;
  assert.deepEqual(Reflect.ownKeys(parsed), ["__proto__", "constructor", "work", "minimal"]);
  const mapped = new Map(Object.entries(parsed));
  assert.equal(mapped.size, 4);
  for (const [nodeId, result] of Object.entries(expected)) {
    assert.ok(Object.hasOwn(parsed, nodeId));
    assert.equal(Object.getOwnPropertyDescriptor(parsed, nodeId)?.enumerable, true);
    assert.deepEqual(parsed[nodeId], result);
    assert.ok(mapped.has(nodeId));
    assert.deepEqual(mapped.get(nodeId), result);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), expected);
}

test("parseChildNodeResults preserves special JSON own keys through Map and serialization", () => {
  assertOwnKeyResults(parseChildNodeResults(JSON.parse(ownKeyResultsJson)));
});

test("parseChildNodeResultsFile preserves the same special JSON own keys", async () => {
  await withResultsFile(ownKeyResultsJson, async (path) => {
    assertOwnKeyResults(await parseChildNodeResultsFile(path));
  });
});

test("result parsers retain domain refusals for invalid top-level results and blank node ids", async () => {
  const cases: readonly [string, string][] = [
    ...["null", "[]", "true", "42", '"results"'].map((json): [string, string] => [
      json, "results file must be a JSON object mapping nodeId to ChildNodeResult"
    ]),
    ['{"": {"outcome": "SUCCESS"}}', "results file must not use an empty node id"],
    ['{"  ": {"outcome": "SUCCESS"}}', "results file must not use an empty node id"]
  ];
  for (const [json, message] of cases) {
    const error = { name: DomainValidationError.name, message };
    assert.throws(() => parseChildNodeResults(JSON.parse(json)), error);
    await withResultsFile(json, async (path) => {
      await assert.rejects(parseChildNodeResultsFile(path), error);
    });
  }
});

test("result parsers validate every result field under special and ordinary node ids", async () => {
  const cases: readonly [unknown, string][] = [
    [null, " must be an object"],
    [[], " must be an object"],
    ["SUCCESS", " must be an object"],
    [{}, ".outcome must be SUCCESS, PARTIAL, or FAILURE"],
    [{ outcome: "UNKNOWN" }, ".outcome must be SUCCESS, PARTIAL, or FAILURE"],
    ...[null, "0.5", -0.1, 1.1].map((confidence): [unknown, string] => [
      { outcome: "SUCCESS", confidence }, ".confidence must be a finite number between 0 and 1"
    ]),
    ...[null, "evd_work", [""], [1]].map((evidenceIds): [unknown, string] => [
      { outcome: "SUCCESS", evidenceIds }, ".evidenceIds must be an array of non-empty strings"
    ]),
    [{ outcome: "SUCCESS", facts: {} }, ".facts must be an array"],
    [{ outcome: "SUCCESS", facts: [null] }, ".facts[0].key must be a non-empty string"],
    [{ outcome: "SUCCESS", facts: [{ key: " " }] }, ".facts[0].key must be a non-empty string"],
    [{ outcome: "SUCCESS", facts: [{ key: "status", value: 1 }] }, ".facts[0].value must be a string"],
    [{ outcome: "SUCCESS", facts: [{ key: "status", value: "ok" }] }, ".facts[0].confidence must be a finite number between 0 and 1"],
    [{ outcome: "SUCCESS", facts: [{ key: "status", value: "ok", confidence: 2 }] }, ".facts[0].confidence must be a finite number between 0 and 1"]
  ];
  for (const nodeId of ["__proto__", "constructor", "work"]) {
    for (const [result, suffix] of cases) {
      const json = `{${JSON.stringify(nodeId)}:${JSON.stringify(result)}}`;
      const error = { name: DomainValidationError.name, message: `results.${nodeId}${suffix}` };
      assert.throws(() => parseChildNodeResults(JSON.parse(json)), error);
      await withResultsFile(json, async (path) => {
        await assert.rejects(parseChildNodeResultsFile(path), error);
      });
    }
  }
});
