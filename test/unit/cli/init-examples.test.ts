import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  CHILDREN_EXAMPLE_FILENAME,
  CHILDREN_EXAMPLE_JSON,
  FLOWCHART_EXAMPLE_FILENAME,
  FLOWCHART_EXAMPLE_JSON,
  INIT_USAGE,
  initExamplesCommand,
  type InitExamplesIo
} from "../../../src/cli/init-examples.js";
import { parseCliErrorJson } from "../../../src/cli/errors.js";
import { main } from "../../../src/cli/main.js";
import { setDefaultModels } from "../../../src/config/providers-config.js";
import { validateFlowchart } from "../../../src/domain/flowchart.js";

interface Captured {
  readonly io: InitExamplesIo;
  readonly out: () => string;
  readonly err: () => string;
}

function capture(): Captured {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (text) => out.push(text), stderr: (text) => err.push(text) },
    out: () => out.join(""),
    err: () => err.join("")
  };
}

async function withDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-init-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

interface ChildSpec {
  readonly tasks: readonly {
    readonly id: string;
    readonly role: string;
    readonly objective: string;
    readonly dependsOn?: readonly string[];
    readonly acceptanceCriteria?: readonly { readonly id: string; readonly description: string }[];
  }[];
}

describe("init writes example specs", () => {
  it("writes both examples as parseable JSON and points at validate", async () => {
    await withDir(async (dir) => {
      const captured = capture();
      const code = await initExamplesCommand(["--dir", dir], captured.io);
      assert.equal(code, 0);

      const childrenPath = join(dir, CHILDREN_EXAMPLE_FILENAME);
      const flowchartPath = join(dir, FLOWCHART_EXAMPLE_FILENAME);
      const children = JSON.parse(await readFile(childrenPath, "utf8")) as ChildSpec;
      const flowchart = JSON.parse(await readFile(flowchartPath, "utf8")) as unknown;

      assert.equal(children.tasks.length, 2);
      for (const task of children.tasks) {
        assert.ok(task.id.startsWith("tsk_"), `task id ${task.id} must be a TaskId`);
      }
      const [first, second] = children.tasks;
      assert.deepEqual(second?.dependsOn, [first?.id]);
      assert.equal(first?.acceptanceCriteria?.length, 1);
      assert.ok((first?.acceptanceCriteria?.[0]?.description ?? "").length > 0);

      const validated = validateFlowchart(flowchart);
      assert.deepEqual(validated.nodes.map((node) => node.role), ["actor", "actor"]);
      assert.equal(validated.edges.length, 1);
      assert.deepEqual(validated.edges[0]?.condition, { type: "success", expected: true });
      for (const node of validated.nodes) {
        assert.deepEqual(node.modelPolicy.allowedModels, ["cheap", "premium"]);
        assert.equal(node.confidenceThreshold, 0.7);
        assert.equal(node.approvalRequired, false);
      }

      assert.ok(captured.out().startsWith(`wrote ${childrenPath}\n`));
      assert.ok(captured.out().includes(`wrote ${flowchartPath}\n`));
      assert.ok(captured.out().endsWith(`next: pi-sparkle validate --children ${childrenPath}\n`));
      assert.equal(captured.err(), "");
    });
  });

  it("creates a missing --dir", async () => {
    await withDir(async (dir) => {
      const nested = join(dir, "deep", "nested");
      const captured = capture();
      assert.equal(await initExamplesCommand(["--dir", nested], captured.io), 0);
      assert.equal(await readFile(join(nested, CHILDREN_EXAMPLE_FILENAME), "utf8"), CHILDREN_EXAMPLE_JSON);
    });
  });

  it("ships the same bytes in examples/ as in the embedded constants", async () => {
    const childrenUrl = new URL("../../../examples/sparkle-children.example.json", import.meta.url);
    const flowchartUrl = new URL("../../../examples/sparkle-flowchart.example.json", import.meta.url);
    assert.equal(await readFile(childrenUrl, "utf8"), CHILDREN_EXAMPLE_JSON);
    assert.equal(await readFile(flowchartUrl, "utf8"), FLOWCHART_EXAMPLE_JSON);
  });
});

describe("init refuses to clobber", () => {
  it("fails without --force and leaves every file untouched", async () => {
    await withDir(async (dir) => {
      assert.equal(await initExamplesCommand(["--dir", dir], capture().io), 0);
      const childrenPath = join(dir, CHILDREN_EXAMPLE_FILENAME);
      const flowchartPath = join(dir, FLOWCHART_EXAMPLE_FILENAME);
      await writeFile(childrenPath, "{ \"tasks\": [] }\n", "utf8");

      const captured = capture();
      const code = await initExamplesCommand(["--dir", dir], captured.io);
      assert.equal(code, 1);
      const report = parseCliErrorJson(captured.err());
      assert.equal(report?.command, "init");
      assert.equal(report?.stage, "execute");
      assert.ok(report?.message.includes(childrenPath));
      assert.equal(report?.next, "re-run with --force to overwrite");

      assert.equal(await readFile(childrenPath, "utf8"), "{ \"tasks\": [] }\n");
      assert.equal(await readFile(flowchartPath, "utf8"), FLOWCHART_EXAMPLE_JSON);
      assert.equal(captured.out(), "");
    });
  });

  it("refuses before writing when only the flowchart example is missing", async () => {
    await withDir(async (dir) => {
      const childrenPath = join(dir, CHILDREN_EXAMPLE_FILENAME);
      await writeFile(childrenPath, "{ \"tasks\": [] }\n", "utf8");

      const captured = capture();
      assert.equal(await initExamplesCommand(["--dir", dir], captured.io), 1);
      assert.equal(await readFile(childrenPath, "utf8"), "{ \"tasks\": [] }\n");
      await assert.rejects(readFile(join(dir, FLOWCHART_EXAMPLE_FILENAME), "utf8"));
    });
  });

  it("overwrites with --force", async () => {
    await withDir(async (dir) => {
      const childrenPath = join(dir, CHILDREN_EXAMPLE_FILENAME);
      await writeFile(childrenPath, "stale\n", "utf8");

      const captured = capture();
      assert.equal(await initExamplesCommand(["--dir", dir, "--force"], captured.io), 0);
      assert.equal(await readFile(childrenPath, "utf8"), CHILDREN_EXAMPLE_JSON);
      assert.equal(
        await readFile(join(dir, FLOWCHART_EXAMPLE_FILENAME), "utf8"),
        FLOWCHART_EXAMPLE_JSON
      );
      assert.equal(captured.err(), "");
    });
  });
});

/**
 * The hand-checks above read the examples as JSON; these feed them to the
 * parsers `run` uses, which is the only way to find out whether "run
 * immediately" is true. The flowchart is checked against both catalogs an
 * operator can have on first contact: an untouched state root (the default
 * cheap/premium list) and one with a single primary set (where both aliases
 * resolve to that model).
 */
describe("init writes examples the run-path parsers accept", () => {
  it("validates the children and flowchart examples against every first-run catalog", async () => {
    await withDir(async (dir) => {
      assert.equal(await initExamplesCommand(["--dir", dir], capture().io), 0);
      const childrenPath = join(dir, CHILDREN_EXAMPLE_FILENAME);
      const flowchartPath = join(dir, FLOWCHART_EXAMPLE_FILENAME);

      const children = capture();
      assert.equal(await main(["validate", "--children", childrenPath], children.io), 0, children.err());

      await withDir(async (emptyRoot) => {
        const validated = capture();
        assert.equal(
          await main(["validate", "--flowchart", flowchartPath, "--state-root", emptyRoot], validated.io),
          0,
          validated.err()
        );
      });

      await withDir(async (primaryRoot) => {
        await setDefaultModels(primaryRoot, { primary: "openai/gpt-4o-mini" });
        const validated = capture();
        assert.equal(
          await main(["validate", "--flowchart", flowchartPath, "--state-root", primaryRoot], validated.io),
          0,
          validated.err()
        );
      });
    });
  });
});

describe("init contracts", () => {
  it("pins the --json shape", async () => {
    await withDir(async (dir) => {
      const first = capture();
      assert.equal(await initExamplesCommand(["--dir", dir, "--json"], first.io), 0);
      assert.deepEqual(JSON.parse(first.out()) as unknown, {
        type: "INIT_EXAMPLES",
        preview: true,
        dir,
        files: [join(dir, CHILDREN_EXAMPLE_FILENAME), join(dir, FLOWCHART_EXAMPLE_FILENAME)],
        overwritten: false
      });

      const second = capture();
      assert.equal(await initExamplesCommand(["--dir", dir, "--json", "--force"], second.io), 0);
      assert.equal((JSON.parse(second.out()) as { overwritten: boolean }).overwritten, true);
    });
  });

  it("prints usage for --help and exits 0", async () => {
    const captured = capture();
    assert.equal(await initExamplesCommand(["--help"], captured.io), 0);
    assert.equal(captured.out(), INIT_USAGE);
    assert.match(captured.out(), /pi-sparkle init \[--dir <path>\] \[--force\] \[--json\]/);
    assert.equal(captured.err(), "");
  });
});
