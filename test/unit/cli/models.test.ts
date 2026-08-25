import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseCliErrorJson } from "../../../src/cli/errors.js";
import { modelsCommand, type ModelsIo } from "../../../src/cli/models.js";

/**
 * Offline and hermetic: every case runs against a temp state root, and the
 * only catalog consulted is the builtin one Pi ships plus whatever this file
 * writes into providers.json.
 */
const LOCAL_MODELS = ["m1", "m2"] as const;

function capture(): { io: ModelsIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text)
    },
    out,
    err
  };
}

async function withStateRoot(body: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-models-"));
  try {
    await body(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

async function writeCustomProviders(stateRoot: string): Promise<void> {
  await mkdir(join(stateRoot, "runtime"), { recursive: true });
  await writeFile(
    join(stateRoot, "runtime", "providers.json"),
    `${JSON.stringify({
      version: 1,
      enabled: [],
      customProviders: [
        {
          id: "local",
          baseUrl: "http://127.0.0.1:9/v1",
          models: LOCAL_MODELS.map((id) => ({ id }))
        },
        {
          id: "gateway",
          baseUrl: "http://127.0.0.1:9/v1",
          models: [{ id: "fast" }]
        }
      ]
    })}\n`,
    "utf8"
  );
}

async function available(stateRoot: string, args: string[] = []): Promise<string[]> {
  const { io, out, err } = capture();
  const code = await modelsCommand(["list", "--available", "--state-root", stateRoot, ...args], io);
  assert.equal(code, 0, err.join(""));
  assert.deepEqual(err, []);
  return out.join("").trimEnd().split("\n");
}

test("--available lists the builtin catalog when nothing custom is configured", async () => {
  await withStateRoot(async (stateRoot) => {
    const listed = await available(stateRoot);
    assert.ok(listed.length > 0, "the builtin catalog is not empty");
    assert.ok(
      listed.some((id) => id.startsWith("anthropic/")),
      "a builtin provider is still listed"
    );
    assert.equal(
      listed.some((id) => id.startsWith("local/")),
      false
    );
  });
});

test("--available appends the models of every configured custom provider", async () => {
  await withStateRoot(async (stateRoot) => {
    const before = await available(stateRoot);
    await writeCustomProviders(stateRoot);
    const after = await available(stateRoot);

    // The builtin catalog is unchanged and the custom models follow it, so a
    // provider the operator configured is no longer invisible to the one
    // browse surface the CLI advertises.
    assert.deepEqual(after.slice(0, before.length), before);
    assert.deepEqual(after.slice(before.length), ["local/m1", "local/m2", "gateway/fast"]);
  });
});

test("--available --provider <custom> lists that provider instead of nothing", async () => {
  await withStateRoot(async (stateRoot) => {
    await writeCustomProviders(stateRoot);
    // `models enable local/m1` already succeeds, so "(no models)" here was the
    // browse surface disagreeing with the command that uses it.
    assert.deepEqual(await available(stateRoot, ["--provider", "local"]), ["local/m1", "local/m2"]);
    assert.deepEqual(await available(stateRoot, ["--provider", "gateway"]), ["gateway/fast"]);
  });
});

test("--available --provider <builtin> is unchanged by a custom provider", async () => {
  await withStateRoot(async (stateRoot) => {
    await writeCustomProviders(stateRoot);
    const listed = await available(stateRoot, ["--provider", "anthropic"]);
    assert.ok(listed.length > 0);
    assert.ok(listed.every((id) => id.startsWith("anthropic/")));
  });
});

test("--available still says (no models) for a provider that exists nowhere", async () => {
  await withStateRoot(async (stateRoot) => {
    await writeCustomProviders(stateRoot);
    assert.deepEqual(await available(stateRoot, ["--provider", "not-a-provider-xyz"]), [
      "(no models)"
    ]);
  });
});

test("models list without --available reports the enabled models, not the catalog", async () => {
  await withStateRoot(async (stateRoot) => {
    await writeCustomProviders(stateRoot);
    const { io, out, err } = capture();
    assert.equal(await modelsCommand(["list", "--state-root", stateRoot], io), 0, err.join(""));
    assert.match(out.join(""), /No models enabled/);

    const enabled = capture();
    assert.equal(
      await modelsCommand(["enable", "local/m1", "--state-root", stateRoot], enabled.io),
      0,
      enabled.err.join("")
    );
    const listed = capture();
    assert.equal(await modelsCommand(["list", "--state-root", stateRoot], listed.io), 0);
    assert.equal(listed.out.join(""), "local/m1\n");
  });
});

async function run(stateRoot: string, args: string[]): Promise<string> {
  const { io, out, err } = capture();
  const code = await modelsCommand([...args, "--state-root", stateRoot], io);
  assert.equal(code, 0, err.join(""));
  return out.join("");
}

test("disable discloses the routing default it took with it", async () => {
  await withStateRoot(async (stateRoot) => {
    await writeCustomProviders(stateRoot);
    await run(stateRoot, ["set-default", "--primary", "local/m1", "--fast", "local/m2"]);

    // The config drops the default along with the model, and the operator used
    // to find that out from a run that could not pick one.
    const disabled = await run(stateRoot, ["disable", "local/m1"]);
    assert.match(disabled, /^Disabled local\/m1$/m);
    assert.match(disabled, /note: local\/m1 was the primary default; the default is now unset/);
    assert.match(disabled, /pi-sparkle models set-default/);
    assert.doesNotMatch(disabled, /fast default/);

    assert.equal(await run(stateRoot, ["list"]), "local/m2  fast\n");
  });
});

test("disable of a model that is both defaults discloses both, and one that is neither says nothing", async () => {
  await withStateRoot(async (stateRoot) => {
    await writeCustomProviders(stateRoot);
    await run(stateRoot, ["set-default", "--primary", "local/m1", "--fast", "local/m1"]);
    await run(stateRoot, ["enable", "local/m2"]);

    const quiet = await run(stateRoot, ["disable", "local/m2"]);
    assert.equal(quiet, "Disabled local/m2\n", "a non-default disable has nothing to disclose");

    const both = await run(stateRoot, ["disable", "local/m1"]);
    assert.match(both, /note: local\/m1 was the primary default/);
    assert.match(both, /note: local\/m1 was the fast default/);
  });
});

test("list annotates an enabled model the catalog no longer resolves", async () => {
  await withStateRoot(async (stateRoot) => {
    await mkdir(join(stateRoot, "runtime"), { recursive: true });
    // The shape a pin bump leaves behind: the id survives in providers.json
    // after the model stops existing, and `list` used to present it as enabled
    // and healthy.
    await writeFile(
      join(stateRoot, "runtime", "providers.json"),
      `${JSON.stringify({
        version: 1,
        enabled: ["local/m1", "local/retired"],
        primary: "local/m1",
        customProviders: [
          { id: "local", baseUrl: "http://127.0.0.1:9/v1", models: [{ id: "m1" }] }
        ]
      })}\n`,
      "utf8"
    );
    assert.equal(
      await run(stateRoot, ["list"]),
      "local/m1  primary\nlocal/retired  (not in catalog)\n"
    );
  });
});

/**
 * The frozen `MODELS_LIST` shape, pinned exactly the day it ships (D3) and as
 * whole objects: what a consumer must not have to guess is which keys are
 * always there. `primary` / `fast` are named once at the top level and are
 * `null` when unset — never omitted, and never restated per row where the two
 * copies could disagree.
 *
 * The object reports the stored configuration, not what a run will use: run
 * flags and PI_PROVIDER / PI_MODEL outrank these defaults.
 */
test("list --json emits the exact enabled shape, defaults and staleness included", async () => {
  await withStateRoot(async (stateRoot) => {
    await mkdir(join(stateRoot, "runtime"), { recursive: true });
    await writeFile(
      join(stateRoot, "runtime", "providers.json"),
      `${JSON.stringify({
        version: 1,
        enabled: ["local/m1", "local/m2", "local/retired"],
        primary: "local/m1",
        customProviders: [
          {
            id: "local",
            baseUrl: "http://127.0.0.1:9/v1",
            models: LOCAL_MODELS.map((id) => ({ id }))
          }
        ]
      })}\n`,
      "utf8"
    );
    const { io, out, err } = capture();
    assert.equal(await modelsCommand(["list", "--json", "--state-root", stateRoot], io), 0, err.join(""));
    assert.deepEqual(err, []);
    assert.deepEqual(JSON.parse(out.join("")), {
      type: "MODELS_LIST",
      preview: true,
      mode: "enabled",
      primary: "local/m1",
      fast: null,
      models: [
        { id: "local/m1", inCatalog: true },
        { id: "local/m2", inCatalog: true },
        { id: "local/retired", inCatalog: false }
      ]
    });
  });
});

test("list --json prints exactly one parseable line and no prose", async () => {
  await withStateRoot(async (stateRoot) => {
    await writeCustomProviders(stateRoot);
    await run(stateRoot, ["set-default", "--primary", "local/m1", "--fast", "gateway/fast"]);

    const { io, out, err } = capture();
    assert.equal(await modelsCommand(["list", "--json", "--state-root", stateRoot], io), 0, err.join(""));
    assert.deepEqual(err, []);
    const stdout = out.join("");
    assert.equal(stdout.endsWith("\n"), true);
    const lines = stdout.split("\n").slice(0, -1);
    assert.equal(lines.length, 1, stdout);
    // The two defaults are read off the top level, which is the only place the
    // object states them.
    assert.deepEqual(JSON.parse(lines[0] as string), {
      type: "MODELS_LIST",
      preview: true,
      mode: "enabled",
      primary: "local/m1",
      fast: "gateway/fast",
      models: [
        { id: "local/m1", inCatalog: true },
        { id: "gateway/fast", inCatalog: true }
      ]
    });
  });
});

test("list --json on an empty store is the object with no models, not the notice", async () => {
  await withStateRoot(async (stateRoot) => {
    const { io, out, err } = capture();
    assert.equal(await modelsCommand(["list", "--json", "--state-root", stateRoot], io), 0, err.join(""));
    assert.deepEqual(err, []);
    assert.deepEqual(JSON.parse(out.join("")), {
      type: "MODELS_LIST",
      preview: true,
      mode: "enabled",
      primary: null,
      fast: null,
      models: []
    });
    assert.doesNotMatch(out.join(""), /No models enabled/);
  });
});

test("list --available --json carries the same builtin+custom merge as the human path", async () => {
  await withStateRoot(async (stateRoot) => {
    await writeCustomProviders(stateRoot);
    const human = await available(stateRoot);

    const { io, out, err } = capture();
    assert.equal(
      await modelsCommand(["list", "--available", "--json", "--state-root", stateRoot], io),
      0,
      err.join("")
    );
    assert.deepEqual(err, []);
    // Available mode states no defaults at all: browsing the catalog is not a
    // question about what this state root has configured.
    assert.deepEqual(JSON.parse(out.join("")), {
      type: "MODELS_LIST",
      preview: true,
      mode: "available",
      models: human.map((id) => ({ id }))
    });

    const scoped = capture();
    assert.equal(
      await modelsCommand(
        ["list", "--available", "--json", "--provider", "local", "--state-root", stateRoot],
        scoped.io
      ),
      0,
      scoped.err.join("")
    );
    assert.deepEqual(JSON.parse(scoped.out.join("")), {
      type: "MODELS_LIST",
      preview: true,
      mode: "available",
      models: [{ id: "local/m1" }, { id: "local/m2" }]
    });
  });
});

test("an unknown models subcommand speaks the house dialect and still echoes the usage", async () => {
  const { io, out, err } = capture();
  assert.equal(await modelsCommand(["lsit"], io), 1);
  assert.equal(out.join(""), "");
  const stderr = err.join("");
  assert.match(stderr, /pi-sparkle models list \[--available\]/);
  const report = parseCliErrorJson(stderr);
  assert.ok(report !== undefined, "an unknown subcommand must emit a parseable report");
  assert.equal(report.command, "models");
  assert.equal(report.stage, "parse-args");
  assert.equal(report.message, "Unknown models command: lsit");
  assert.equal(report.next, "use models list, enable, disable, or set-default");
});

test("models list --help prints the usage and exits 0", async () => {
  const { io, out, err } = capture();
  assert.equal(await modelsCommand(["list", "--help"], io), 0, err.join(""));
  assert.deepEqual(err, []);
  assert.match(out.join(""), /pi-sparkle models list \[--available\] \[--provider <id>\] \[--state-root <dir>\] \[--json\]/);
});

test("a mistyped flag on a models subcommand is a parse-args failure, not the doctor remedy", async () => {
  await withStateRoot(async (stateRoot) => {
    const cases = [
      { argv: ["list", "--jsn"], command: "models list" },
      { argv: ["enable", "local/m1", "--stateroot", stateRoot], command: "models enable" },
      { argv: ["disable", "local/m1", "--stateroot", stateRoot], command: "models disable" },
      { argv: ["set-default", "--primry", "local/m1"], command: "models set-default" }
    ];
    for (const { argv, command } of cases) {
      const { io, out, err } = capture();
      assert.equal(await modelsCommand(argv, io), 1, `${command} must fail`);
      assert.equal(out.join(""), "");
      const report = parseCliErrorJson(err.join(""));
      assert.ok(report !== undefined, `${command} must emit a parseable report`);
      assert.equal(report.command, command);
      assert.equal(report.stage, "parse-args");
      assert.equal(report.next, "run pi-sparkle models --help");
    }
  });
});

test("the argument errors of enable, disable and set-default speak the house dialect", async () => {
  await withStateRoot(async (stateRoot) => {
    const cases = [
      {
        argv: ["enable"],
        command: "models enable",
        message: "models enable requires <provider/model>"
      },
      {
        argv: ["disable"],
        command: "models disable",
        message: "models disable requires <provider/model>"
      },
      {
        argv: ["set-default", "--state-root", stateRoot],
        command: "models set-default",
        message: "models set-default requires --primary <provider/model>"
      }
    ];
    for (const { argv, command, message } of cases) {
      const { io, out, err } = capture();
      assert.equal(await modelsCommand([...argv], io), 1, `${command} must fail`);
      assert.equal(out.join(""), "");
      const report = parseCliErrorJson(err.join(""));
      assert.ok(report !== undefined, `${command} must emit a parseable report`);
      assert.equal(report.command, command);
      assert.equal(report.stage, "parse-args");
      assert.equal(report.message, message);
      assert.equal(report.next, "run pi-sparkle models --help");
    }
  });
});
