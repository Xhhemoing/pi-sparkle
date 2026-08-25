import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import { parseCliErrorJson } from "../../../src/cli/errors.js";
import { VALIDATE_USAGE } from "../../../src/cli/validate.js";
import { enableModel, providersConfigPath } from "../../../src/config/providers-config.js";

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
 * `validate --flowchart` reads the model catalog under a state root, so every
 * case passes its own empty `--state-root` and `HOME` still points at an empty
 * directory: the state root proves the read creates no run, event log or
 * checkpoint, and the empty `HOME` proves the default state root
 * (`~/.pi-sparkle`) is never materialised behind the operator's back.
 */
async function withSpecDir(
  run: (specDir: string, stateRoot: string) => Promise<void>
): Promise<void> {
  const specDir = await mkdtemp(join(tmpdir(), "pi-sparkle-validate-spec-"));
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-validate-state-"));
  const home = await mkdtemp(join(tmpdir(), "pi-sparkle-validate-home-"));
  const savedHome = process.env.HOME;
  process.env.HOME = home;
  try {
    await run(specDir, stateRoot);
    assert.deepEqual(await readdir(home), [], "validate writes nothing under the default state root");
  } finally {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    await rm(specDir, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
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

test("validate --flowchart accepts a tiny flowchart against an empty state root's default catalog", async () => {
  await withSpecDir(async (specDir, stateRoot) => {
    const path = await writeSpec(specDir, "flowchart.json", FLOWCHART_SPEC);
    const { io, out, err } = capture();
    const code = await main(["validate", "--flowchart", path, "--state-root", stateRoot], io);
    assert.equal(code, 0, err.join(""));
    assert.match(out.join(""), /valid: flowchart tiny \(2 nodes, 1 edges\)/);
    assert.match(out.join(""), new RegExp(`live catalog at ${stateRoot}`));
    assert.deepEqual(err, []);
    assert.deepEqual(
      await readdir(stateRoot),
      [],
      "reading the catalog creates no run, event log or checkpoint under --state-root"
    );
  });
});

test("validate --flowchart fails closed on a model the live catalog does not expose", async () => {
  await withSpecDir(async (specDir, stateRoot) => {
    const path = await writeSpec(specDir, "unknown-model.json", {
      ...FLOWCHART_SPEC,
      nodes: [
        { ...FLOWCHART_SPEC.nodes[0], modelPolicy: { allowedModels: ["mystery"] } },
        FLOWCHART_SPEC.nodes[1]
      ]
    });
    const { io, out, err } = capture();
    const code = await main(["validate", "--flowchart", path, "--state-root", stateRoot], io);
    assert.equal(code, 1);
    assert.deepEqual(out, []);
    const parsed = parseCliErrorJson(err.join(""));
    assert.equal(parsed?.stage, "validation");
    assert.match(parsed?.message ?? "", /unavailable model "mystery"/);
  });
});

/**
 * The bug this pins: with a static cheap/premium list, `validate` refused a
 * flowchart `run --flowchart` accepts, because `run` builds its catalog from
 * the models enabled under the state root. Both paths must answer the same.
 */
test("validate --flowchart accepts a model enabled under --state-root and refuses it elsewhere", async () => {
  await withSpecDir(async (specDir, stateRoot) => {
    await enableModel(stateRoot, "openai/gpt-4o-mini");
    const enabledEntries = await readdir(stateRoot);
    const path = await writeSpec(specDir, "live-model.json", {
      ...FLOWCHART_SPEC,
      nodes: [
        { ...FLOWCHART_SPEC.nodes[0], modelPolicy: { allowedModels: ["openai/gpt-4o-mini"] } },
        FLOWCHART_SPEC.nodes[1]
      ]
    });

    const accepted = capture();
    assert.equal(
      await main(["validate", "--flowchart", path, "--state-root", stateRoot], accepted.io),
      0,
      accepted.err.join("")
    );
    assert.match(accepted.out.join(""), /valid: flowchart tiny/);
    assert.deepEqual(
      await readdir(stateRoot),
      enabledEntries,
      "validate adds nothing to the state root it read the catalog from"
    );

    const otherRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-validate-other-"));
    try {
      const refused = capture();
      assert.equal(
        await main(["validate", "--flowchart", path, "--state-root", otherRoot], refused.io),
        1,
        "a state root without that model must refuse the same flowchart"
      );
      assert.match(
        parseCliErrorJson(refused.err.join(""))?.message ?? "",
        /unavailable model "openai\/gpt-4o-mini"/
      );
    } finally {
      await rm(otherRoot, { recursive: true, force: true });
    }
  });
});

test("validate --flowchart without --state-root reads the default root without creating it", async () => {
  await withSpecDir(async (specDir) => {
    const path = await writeSpec(specDir, "flowchart.json", FLOWCHART_SPEC);
    const { io, out, err } = capture();
    assert.equal(await main(["validate", "--flowchart", path], io), 0, err.join(""));
    assert.match(out.join(""), new RegExp(`live catalog at ${join(process.env.HOME as string, ".pi-sparkle")}`));
  });
});

test("validate --flowchart reports a broken catalog as a catalog problem, not a spec problem", async () => {
  await withSpecDir(async (specDir, stateRoot) => {
    const configPath = providersConfigPath(stateRoot);
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, "{ not json", "utf8");
    const path = await writeSpec(specDir, "flowchart.json", FLOWCHART_SPEC);
    const { io, out, err } = capture();
    assert.equal(await main(["validate", "--flowchart", path, "--state-root", stateRoot], io), 1);
    assert.deepEqual(out, []);
    const parsed = parseCliErrorJson(err.join(""));
    assert.match(parsed?.message ?? "", new RegExp(`could not build the model catalog at ${stateRoot}`));
    assert.equal(
      parsed?.next,
      `disable an unknown enabled model with pi-sparkle models disable <provider/model>, repair ${configPath}, or pass --state-root <dir>`
    );
  });
});

/**
 * The other way into the broken-catalog branch: providers.json parses, but it
 * enables a model no provider exposes. `models list` cannot repair either case,
 * so the remedy names `models disable`, which rewrites `enabled` and drops the
 * ref from `primary`/`fast`.
 */
test("validate --flowchart names a repair for an enabled model no provider exposes", async () => {
  await withSpecDir(async (specDir, stateRoot) => {
    await enableModel(stateRoot, "nope/unknown-model");
    const path = await writeSpec(specDir, "flowchart.json", FLOWCHART_SPEC);
    const { io, out, err } = capture();
    assert.equal(await main(["validate", "--flowchart", path, "--state-root", stateRoot], io), 1);
    assert.deepEqual(out, []);
    const parsed = parseCliErrorJson(err.join(""));
    assert.match(parsed?.message ?? "", /unknown model "nope\/unknown-model"/);
    assert.match(parsed?.next ?? "", /pi-sparkle models disable <provider\/model>/);
    assert.match(parsed?.next ?? "", new RegExp(providersConfigPath(stateRoot).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
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
  await withSpecDir(async (specDir, stateRoot) => {
    const broken = await writeSpec(specDir, "broken.json", "{ \"tasks\": [");
    const badJson = capture();
    assert.equal(await main(["validate", "--children", broken], badJson.io), 1);
    const parsedBadJson = parseCliErrorJson(badJson.err.join(""));
    assert.equal(parsedBadJson?.stage, "validation");
    assert.match(parsedBadJson?.message ?? "", new RegExp(`Invalid child spec ${broken}`));

    const absent = join(specDir, "absent.json");
    const missing = capture();
    assert.equal(await main(["validate", "--flowchart", absent, "--state-root", stateRoot], missing.io), 1);
    const parsedMissing = parseCliErrorJson(missing.err.join(""));
    assert.equal(parsedMissing?.stage, "lookup");
    assert.match(parsedMissing?.message ?? "", /^cannot read --flowchart /);
    assert.ok(parsedMissing?.message.includes(absent), "the failure names the file it could not read");
    assert.deepEqual(missing.out, []);
  });
});

/**
 * The defect this pins: a path the operator mistyped came back as a raw errno
 * at `stage: "execute"` with "fix the spec and re-run" — a remedy for a spec
 * this command never read. An unreadable operator-supplied path is a lookup
 * fault, and the report names the flag that carried it.
 */
test("validate reports an unreadable --children path as a lookup fault naming the flag", async () => {
  await withSpecDir(async (specDir) => {
    const absent = join(specDir, "absent.json");
    const { io, out, err } = capture();
    assert.equal(await main(["validate", "--children", absent], io), 1);
    assert.deepEqual(out, [], "a refusal prints nothing on stdout");
    const parsed = parseCliErrorJson(err.join(""));
    assert.equal(parsed?.command, "validate");
    assert.equal(parsed?.stage, "lookup");
    assert.equal(
      parsed?.message,
      `cannot read --children ${absent}: ENOENT: no such file or directory, open '${absent}'`
    );
    assert.equal(
      parsed?.next,
      "check the --children path; pi-sparkle init writes example specs this command accepts"
    );
  });
});

test("validate reports an unreadable --flowchart path as a lookup fault naming the flag", async () => {
  await withSpecDir(async (specDir, stateRoot) => {
    const absent = join(specDir, "absent.json");
    const { io, out, err } = capture();
    assert.equal(await main(["validate", "--flowchart", absent, "--state-root", stateRoot], io), 1);
    assert.deepEqual(out, []);
    const parsed = parseCliErrorJson(err.join(""));
    assert.equal(parsed?.command, "validate");
    assert.equal(parsed?.stage, "lookup");
    assert.equal(
      parsed?.message,
      `cannot read --flowchart ${absent}: ENOENT: no such file or directory, open '${absent}'`
    );
    assert.equal(
      parsed?.next,
      "check the --flowchart path; pi-sparkle init writes example specs this command accepts"
    );
  });
});

/**
 * A directory passed as the spec path fails with EISDIR, not ENOENT: the guard
 * classifies by "the error carries a code", so every fs fault on these two
 * flags lands in the same lookup class rather than one errno being special.
 */
test("validate classifies a directory passed as a spec path in the same lookup class", async () => {
  await withSpecDir(async (specDir, stateRoot) => {
    const asDir = join(specDir, "spec-dir");
    await mkdir(asDir, { recursive: true });

    const children = capture();
    assert.equal(await main(["validate", "--children", asDir], children.io), 1);
    assert.deepEqual(children.out, []);
    const parsedChildren = parseCliErrorJson(children.err.join(""));
    assert.equal(parsedChildren?.command, "validate");
    assert.equal(parsedChildren?.stage, "lookup");
    assert.match(parsedChildren?.message ?? "", new RegExp(`^cannot read --children ${asDir}: EISDIR`));
    assert.equal(
      parsedChildren?.next,
      "check the --children path; pi-sparkle init writes example specs this command accepts"
    );

    const flowchart = capture();
    assert.equal(await main(["validate", "--flowchart", asDir, "--state-root", stateRoot], flowchart.io), 1);
    assert.deepEqual(flowchart.out, []);
    const parsedFlowchart = parseCliErrorJson(flowchart.err.join(""));
    assert.equal(parsedFlowchart?.stage, "lookup");
    assert.match(parsedFlowchart?.message ?? "", new RegExp(`^cannot read --flowchart ${asDir}: EISDIR`));
  });
});

/**
 * `""` is not undefined, so it survived the exactly-one check and reached the
 * parser as a path: the operator got `ENOENT … open ''` about a file they
 * never named. A blank flag value is argv, refused before any read.
 */
test("validate refuses a blank spec path as argv, before any read", async () => {
  await withSpecDir(async (_specDir, stateRoot) => {
    const children = capture();
    assert.equal(await main(["validate", "--children", ""], children.io), 1);
    assert.deepEqual(children.out, []);
    const parsedChildren = parseCliErrorJson(children.err.join(""));
    assert.equal(parsedChildren?.command, "validate");
    assert.equal(parsedChildren?.stage, "parse-args");
    assert.equal(parsedChildren?.message, 'invalid --children "": spec path must be a non-empty string');
    assert.equal(parsedChildren?.next, "pass --children <spec.json>");

    const flowchart = capture();
    assert.equal(await main(["validate", "--flowchart", "   ", "--state-root", stateRoot], flowchart.io), 1);
    assert.deepEqual(flowchart.out, []);
    const parsedFlowchart = parseCliErrorJson(flowchart.err.join(""));
    assert.equal(parsedFlowchart?.command, "validate");
    assert.equal(parsedFlowchart?.stage, "parse-args");
    assert.equal(
      parsedFlowchart?.message,
      'invalid --flowchart "   ": spec path must be a non-empty string'
    );
    assert.equal(parsedFlowchart?.next, "pass --flowchart <flowchart.json>");
  });
});

test("validate --json prints the frozen VALIDATE_OK contract and nothing on failure", async () => {
  await withSpecDir(async (specDir, stateRoot) => {
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
    assert.equal(
      await main(["validate", "--flowchart", flowchartPath, "--state-root", stateRoot, "--json"], flowchart.io),
      0,
      flowchart.err.join("")
    );
    assert.deepEqual(JSON.parse(flowchart.out.join("").trim()), {
      type: "VALIDATE_OK",
      preview: true,
      kind: "flowchart",
      path: flowchartPath,
      nodeCount: 2,
      edgeCount: 1,
      flowchartId: "tiny",
      catalogSource: "live",
      stateRoot
    });

    const failing = capture();
    assert.equal(await main(["validate", "--children", join(specDir, "absent.json"), "--json"], failing.io), 1);
    assert.deepEqual(failing.out, [], "--json never prints a VALIDATE_OK for a spec that failed");
  });
});

test("a mistyped validate flag is an argv error that names --help", async () => {
  const { io, out, err } = capture();
  assert.equal(await main(["validate", "--childrenn", "spec.json"], io), 1);
  assert.deepEqual(out, []);
  const parsed = parseCliErrorJson(err.join(""));
  assert.equal(parsed?.command, "validate");
  assert.equal(parsed?.stage, "parse-args");
  assert.match(parsed?.message ?? "", /--childrenn/);
  assert.match(parsed?.next ?? "", /--help/);
});

const BLANK_ROOT_NEXT = "pass --state-root <dir> or omit it to use the default ~/.pi-sparkle";

function blankRootMessage(raw: string): string {
  return `invalid --state-root "${raw}": state root must be a non-empty directory path`;
}

async function withCwd(dir: string, body: () => Promise<void>): Promise<void> {
  const saved = process.cwd();
  process.chdir(dir);
  try {
    await body();
  } finally {
    process.chdir(saved);
  }
}

/** A working directory whose relative `runtime/providers.json` exposes local/m1. */
async function seedCwdCatalog(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "pi-sparkle-validate-cwd-"));
  await mkdir(join(cwd, "runtime"), { recursive: true });
  await writeFile(
    join(cwd, "runtime", "providers.json"),
    `${JSON.stringify({
      version: 1,
      enabled: ["local/m1"],
      customProviders: [
        { id: "local", baseUrl: "http://127.0.0.1:9/v1", models: [{ id: "m1" }] }
      ]
    })}\n`,
    "utf8"
  );
  return cwd;
}

/**
 * The real target defect on this command, and the reason it is pinned on
 * `--flowchart` rather than `--children`: only the flowchart branch resolves
 * the state root, and only to build the catalog its node models are checked
 * against. `--state-root ""` built that catalog out of the working directory's
 * own `providers.json`, so a spec naming a model the intended root does not
 * expose was reported `valid` against whatever the operator happened to be
 * standing in — the opposite of the answer the same spec gets from the root
 * they meant.
 */
test("validate --flowchart refuses a blank --state-root before any catalog is built", async () => {
  await withSpecDir(async (specDir, stateRoot) => {
    const path = await writeSpec(specDir, "cwd-model.json", {
      ...FLOWCHART_SPEC,
      nodes: [
        { ...FLOWCHART_SPEC.nodes[0], modelPolicy: { allowedModels: ["local/m1"] } },
        FLOWCHART_SPEC.nodes[1]
      ]
    });
    const cwd = await seedCwdCatalog();
    try {
      await withCwd(cwd, async () => {
        for (const raw of ["", "  "]) {
          const { io, out, err } = capture();
          assert.equal(await main(["validate", "--flowchart", path, `--state-root=${raw}`], io), 1, raw);
          assert.deepEqual(out, [], "a refusal never prints a valid: line or a VALIDATE_OK");
          const parsed = parseCliErrorJson(err.join(""));
          assert.equal(parsed?.command, "validate");
          assert.equal(parsed?.stage, "parse-args");
          assert.equal(parsed?.message, blankRootMessage(raw));
          assert.equal(parsed?.next, BLANK_ROOT_NEXT);
          // Nothing named the working directory's config, because nothing read
          // it: the guard precedes the catalog build entirely.
          assert.doesNotMatch(err.join(""), /providers\.json|local\/m1|could not build the model catalog/);
        }

        // What the blank root was hiding. The same spec against the root the
        // operator meant is refused on the catalog's own terms.
        const intended = capture();
        assert.equal(
          await main(["validate", "--flowchart", path, "--state-root", stateRoot], intended.io),
          1
        );
        assert.match(
          parseCliErrorJson(intended.err.join(""))?.message ?? "",
          /unavailable model "local\/m1"/
        );

        // A nonblank relative root is still a root the operator named, and it
        // resolves against the same tree the blank one silently borrowed.
        const relative = capture();
        assert.equal(
          await main(["validate", "--flowchart", path, "--state-root", "."], relative.io),
          0,
          relative.err.join("")
        );
        assert.match(relative.out.join(""), /valid: flowchart tiny/);
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

/**
 * `--children` compiles with the default cheap/premium policy and consults no
 * catalog, and the usage says `--state-root` is ignored there. A documented
 * ignored option does not become a blank-only incompatibility.
 */
test("validate --children keeps ignoring --state-root, blank values included", async () => {
  await withSpecDir(async (specDir) => {
    const path = await writeSpec(specDir, "children.json", CHILDREN_SPEC);
    for (const raw of ["", "  "]) {
      const { io, out, err } = capture();
      assert.equal(await main(["validate", "--children", path, `--state-root=${raw}`], io), 0, err.join(""));
      assert.match(out.join(""), /valid: children 2 tasks → flowchart children \(2 nodes\)/);
      assert.deepEqual(err, []);
    }
  });
});

test("the spec-selection checks still outrank the blank --state-root guard", async () => {
  await withSpecDir(async () => {
    const neither = capture();
    assert.equal(await main(["validate", "--state-root", ""], neither.io), 1);
    assert.equal(
      parseCliErrorJson(neither.err.join(""))?.message,
      "validate requires exactly one of --children <spec.json> or --flowchart <flowchart.json>"
    );

    const blankSpec = capture();
    assert.equal(await main(["validate", "--flowchart", "", "--state-root", ""], blankSpec.io), 1);
    assert.equal(
      parseCliErrorJson(blankSpec.err.join(""))?.message,
      'invalid --flowchart "": spec path must be a non-empty string'
    );
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
