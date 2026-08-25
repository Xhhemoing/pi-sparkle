import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import { parseCliErrorJson } from "../../../src/cli/errors.js";
import { VALIDATE_USAGE } from "../../../src/cli/validate.js";

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (text) => out.push(text), stderr: (text) => err.push(text) },
    out,
    err
  };
}

const CHILDREN_SPEC = {
  tasks: [
    { id: "tsk_parse", role: "implementer", objective: "Write the parser" },
    {
      id: "tsk_test",
      role: "tester",
      objective: "Test the parser",
      dependsOn: ["tsk_parse"],
      limits: { maxCostUsd: 0.25 }
    }
  ]
};

const FLOWCHART_SPEC = {
  id: "tiny",
  nodes: [
    {
      id: "work",
      taskId: "tsk_work",
      role: "actor",
      objective: "Do the work",
      modelPolicy: { allowedModels: ["cheap"] },
      confidenceThreshold: 0.7,
      approvalRequired: false
    },
    {
      id: "check",
      taskId: "tsk_check",
      role: "critic",
      objective: "Check the work",
      modelPolicy: { allowedModels: ["premium"] },
      confidenceThreshold: 0.7,
      approvalRequired: false
    }
  ],
  edges: [{ from: "work", to: "check", condition: { type: "success", expected: true } }]
};

/**
 * The whole point of `validate` is that it reads a spec and touches nothing
 * else, so every case runs with `HOME` pointed at an empty directory: that is
 * where the default state root would be created if this command ever grew a
 * writer, and the directory is asserted empty afterwards.
 */
async function withSpecDir(
  run: (specDir: string, home: string) => Promise<void>
): Promise<void> {
  const specDir = await mkdtemp(join(tmpdir(), "pi-sparkle-validate-spec-"));
  const home = await mkdtemp(join(tmpdir(), "pi-sparkle-validate-home-"));
  const savedHome = process.env.HOME;
  process.env.HOME = home;
  try {
    await run(specDir, home);
    assert.deepEqual(await readdir(home), [], "validate writes nothing under the default state root");
  } finally {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    await rm(specDir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
}

async function writeSpec(specDir: string, name: string, contents: unknown): Promise<string> {
  const path = join(specDir, name);
  await writeFile(path, typeof contents === "string" ? contents : JSON.stringify(contents), "utf8");
  return path;
}

test("validate --children accepts a spec with dependencies and reports the compiled flowchart", async () => {
  await withSpecDir(async (specDir) => {
    const path = await writeSpec(specDir, "children.json", CHILDREN_SPEC);
    const { io, out, err } = capture();
    const code = await main(["validate", "--children", path], io);
    assert.equal(code, 0);
    assert.match(out.join(""), /valid: children 2 tasks → flowchart children \(2 nodes\)/);
    assert.deepEqual(err, []);
    assert.deepEqual(await readdir(specDir), ["children.json"], "validate creates no files beside the spec");
  });
});

test("validate --children refuses a dependency cycle without starting a run", async () => {
  await withSpecDir(async (specDir) => {
    const path = await writeSpec(specDir, "cycle.json", {
      tasks: [
        { id: "tsk_a", role: "implementer", objective: "A", dependsOn: ["tsk_b"] },
        { id: "tsk_b", role: "implementer", objective: "B", dependsOn: ["tsk_a"] }
      ]
    });
    const { io, out, err } = capture();
    const code = await main(["validate", "--children", path], io);
    assert.equal(code, 1);
    assert.deepEqual(out, [], "a refusal prints nothing on stdout");
    const parsed = parseCliErrorJson(err.join(""));
    assert.equal(parsed?.command, "validate");
    assert.equal(parsed?.stage, "validation");
    assert.match(parsed?.message ?? "", /cycle/);
    assert.equal(parsed?.next, "fix the spec and re-run pi-sparkle validate");
  });
});

test("validate --children refuses a missing dependency", async () => {
  await withSpecDir(async (specDir) => {
    const path = await writeSpec(specDir, "missing-dep.json", {
      tasks: [{ id: "tsk_a", role: "implementer", objective: "A", dependsOn: ["tsk_ghost"] }]
    });
    const { io, err } = capture();
    const code = await main(["validate", "--children", path], io);
    assert.equal(code, 1);
    assert.match(err.join(""), /references missing dependency tsk_ghost/);
  });
});

test("validate --flowchart accepts a tiny flowchart and counts nodes and edges", async () => {
  await withSpecDir(async (specDir) => {
    const path = await writeSpec(specDir, "flowchart.json", FLOWCHART_SPEC);
    const { io, out, err } = capture();
    const code = await main(["validate", "--flowchart", path], io);
    assert.equal(code, 0);
    assert.match(out.join(""), /valid: flowchart tiny \(2 nodes, 1 edges\)/);
    assert.deepEqual(err, []);
  });
});

test("validate --flowchart fails closed on a model outside the CLI catalog", async () => {
  await withSpecDir(async (specDir) => {
    const path = await writeSpec(specDir, "unknown-model.json", {
      ...FLOWCHART_SPEC,
      nodes: [
        { ...FLOWCHART_SPEC.nodes[0], modelPolicy: { allowedModels: ["mystery"] } },
        FLOWCHART_SPEC.nodes[1]
      ]
    });
    const { io, out, err } = capture();
    const code = await main(["validate", "--flowchart", path], io);
    assert.equal(code, 1);
    assert.deepEqual(out, []);
    const parsed = parseCliErrorJson(err.join(""));
    assert.equal(parsed?.stage, "validation");
    assert.match(parsed?.message ?? "", /unavailable model "mystery"/);
  });
});

test("validate requires exactly one of --children and --flowchart", async () => {
  await withSpecDir(async (specDir) => {
    const children = await writeSpec(specDir, "children.json", CHILDREN_SPEC);
    const flowchart = await writeSpec(specDir, "flowchart.json", FLOWCHART_SPEC);

    const both = capture();
    assert.equal(
      await main(["validate", "--children", children, "--flowchart", flowchart], both.io),
      1
    );
    assert.equal(parseCliErrorJson(both.err.join(""))?.stage, "parse-args");
    assert.deepEqual(both.out, []);

    const neither = capture();
    assert.equal(await main(["validate"], neither.io), 1);
    assert.equal(parseCliErrorJson(neither.err.join(""))?.stage, "parse-args");
    assert.deepEqual(neither.out, []);
  });
});

test("validate reports unparseable JSON and a missing file with the path", async () => {
  await withSpecDir(async (specDir) => {
    const broken = await writeSpec(specDir, "broken.json", "{ \"tasks\": [");
    const badJson = capture();
    assert.equal(await main(["validate", "--children", broken], badJson.io), 1);
    const parsedBadJson = parseCliErrorJson(badJson.err.join(""));
    assert.equal(parsedBadJson?.stage, "validation");
    assert.match(parsedBadJson?.message ?? "", new RegExp(`Invalid child spec ${broken}`));

    const absent = join(specDir, "absent.json");
    const missing = capture();
    assert.equal(await main(["validate", "--flowchart", absent], missing.io), 1);
    const parsedMissing = parseCliErrorJson(missing.err.join(""));
    assert.equal(parsedMissing?.stage, "execute");
    assert.ok(parsedMissing?.message.includes(absent), "the failure names the file it could not read");
    assert.deepEqual(missing.out, []);
  });
});

test("validate --json prints the frozen VALIDATE_OK contract and nothing on failure", async () => {
  await withSpecDir(async (specDir) => {
    const childrenPath = await writeSpec(specDir, "children.json", CHILDREN_SPEC);
    const children = capture();
    assert.equal(await main(["validate", "--children", childrenPath, "--json"], children.io), 0);
    const childrenLines = children.out.join("").trim().split("\n");
    assert.equal(childrenLines.length, 1, "--json prints exactly one object");
    assert.deepEqual(JSON.parse(childrenLines[0]!), {
      type: "VALIDATE_OK",
      preview: true,
      kind: "children",
      path: childrenPath,
      taskCount: 2,
      nodeCount: 2,
      flowchartId: "children"
    });

    const flowchartPath = await writeSpec(specDir, "flowchart.json", FLOWCHART_SPEC);
    const flowchart = capture();
    assert.equal(await main(["validate", "--flowchart", flowchartPath, "--json"], flowchart.io), 0);
    assert.deepEqual(JSON.parse(flowchart.out.join("").trim()), {
      type: "VALIDATE_OK",
      preview: true,
      kind: "flowchart",
      path: flowchartPath,
      nodeCount: 2,
      edgeCount: 1,
      flowchartId: "tiny"
    });

    const failing = capture();
    assert.equal(await main(["validate", "--children", join(specDir, "absent.json"), "--json"], failing.io), 1);
    assert.deepEqual(failing.out, [], "--json never prints a VALIDATE_OK for a spec that failed");
  });
});

test("validate --help prints its usage and exits 0", async () => {
  await withSpecDir(async () => {
    const { io, out, err } = capture();
    assert.equal(await main(["validate", "--help"], io), 0);
    assert.equal(out.join(""), VALIDATE_USAGE);
    assert.deepEqual(err, []);
  });
});
