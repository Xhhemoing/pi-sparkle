import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

function providersJsonPath(stateRoot: string): string {
  return join(stateRoot, "runtime", "providers.json");
}

async function providersJsonBytes(stateRoot: string): Promise<string> {
  return await readFile(providersJsonPath(stateRoot), "utf8");
}

async function refusal(
  stateRoot: string | undefined,
  argv: string[]
): Promise<{ report: NonNullable<ReturnType<typeof parseCliErrorJson>>; stdout: string }> {
  const { io, out, err } = capture();
  const full = stateRoot === undefined ? argv : [...argv, "--state-root", stateRoot];
  assert.equal(await modelsCommand(full, io), 1, `${full.join(" ")} must fail`);
  const report = parseCliErrorJson(err.join(""));
  assert.ok(report !== undefined, `${full.join(" ")} must emit a parseable report`);
  return { report, stdout: out.join("") };
}

/**
 * A typo'd id is argv. It used to reach the operator as the top-level `models`
 * verb failing validation with the doctor remedy, which cannot fix a mistyped
 * positional — and the positional itself was never named.
 */
test("a malformed model id is a parse-args refusal that names what was typed", async () => {
  await withStateRoot(async (stateRoot) => {
    const cases = [
      {
        argv: ["enable", "banana"],
        command: "models enable",
        label: "<provider/model>",
        value: "banana",
        subject: "<provider/model>"
      },
      {
        argv: ["enable", ""],
        command: "models enable",
        label: "<provider/model>",
        value: "",
        subject: "<provider/model>"
      },
      {
        argv: ["disable", "banana"],
        command: "models disable",
        label: "<provider/model>",
        value: "banana",
        subject: "<provider/model>"
      },
      {
        argv: ["disable", ""],
        command: "models disable",
        label: "<provider/model>",
        value: "",
        subject: "<provider/model>"
      },
      {
        argv: ["set-default", "--primary", "banana"],
        command: "models set-default",
        label: "--primary",
        value: "banana",
        subject: "--primary <provider/model>"
      },
      {
        argv: ["set-default", "--primary", ""],
        command: "models set-default",
        label: "--primary",
        value: "",
        subject: "--primary <provider/model>"
      },
      {
        argv: ["set-default", "--primary", "local/m1", "--fast", "banana"],
        command: "models set-default",
        label: "--fast",
        value: "banana",
        subject: "--fast <provider/model>"
      },
      {
        argv: ["set-default", "--primary", "local/m1", "--fast", "trailing/"],
        command: "models set-default",
        label: "--fast",
        value: "trailing/",
        subject: "--fast <provider/model>"
      }
    ];
    await writeCustomProviders(stateRoot);
    for (const { argv, command, label, value, subject } of cases) {
      const { report, stdout } = await refusal(stateRoot, argv);
      assert.equal(stdout, "", `${command} must not claim anything on stderr's behalf`);
      assert.equal(report.command, command);
      assert.equal(report.stage, "parse-args");
      assert.equal(
        report.message,
        `invalid ${label} "${value}": expected a model id of the form provider/model`
      );
      assert.equal(
        report.next,
        `copy ${subject} from pi-sparkle models list --available using the same --state-root`
      );
      // No run is in play on any models verb.
      assert.equal(report.runId, undefined);
      // The remedy names the flag, never this run's raw value: a state root
      // holding a space or a shell metacharacter would look copy-paste safe.
      assert.doesNotMatch(report.next, /--state-root \S/);
      assert.equal(report.next.includes(stateRoot), false);
    }
  });
});

test("--primary is checked before --fast when both are malformed", async () => {
  await withStateRoot(async (stateRoot) => {
    const { report } = await refusal(stateRoot, [
      "set-default",
      "--primary",
      "banana",
      "--fast",
      "apple"
    ]);
    assert.match(report.message, /^invalid --primary "banana"/);
  });
});

/**
 * The guard has to fire before the state root is opened at all: the operator
 * who mistyped the id has not made a configuration mistake, and a refusal about
 * their providers.json would send them to the wrong file.
 */
test("a malformed id refuses on argv before any config is read", async () => {
  await withStateRoot(async (stateRoot) => {
    const missing = join(stateRoot, "no-such-dir");
    const absent = await refusal(missing, ["enable", "banana"]);
    assert.equal(absent.report.stage, "parse-args");
    assert.match(absent.report.message, /^invalid <provider\/model> "banana"/);

    // A providers.json this command could not parse is the sharper proof: the
    // load would throw past the verb, so reaching a parse-args report means
    // nothing read it.
    await mkdir(join(stateRoot, "runtime"), { recursive: true });
    await writeFile(providersJsonPath(stateRoot), "{ not json", "utf8");
    for (const argv of [
      ["enable", "banana"],
      ["disable", "banana"],
      ["set-default", "--primary", "banana"]
    ]) {
      const { report } = await refusal(stateRoot, argv);
      assert.equal(report.stage, "parse-args", argv.join(" "));
      assert.match(report.message, /^invalid /);
    }
    assert.equal(await providersJsonBytes(stateRoot), "{ not json");
  });
});

/**
 * Catalog membership is stored config plus catalog state, so this stays
 * `validation` — but the remedy is now the inventory this install can print,
 * including the ids only providers.json knows about.
 */
test("an unknown model keeps its message and names the inventory that lists valid ids", async () => {
  await withStateRoot(async (stateRoot) => {
    await writeCustomProviders(stateRoot);
    const next =
      "copy an id from pi-sparkle models list --available using the same --state-root; " +
      "providers.json customProviders adds ids the builtin catalog does not have";
    const cases = [
      { argv: ["enable", "local/nope"], command: "models enable", id: "local/nope" },
      {
        argv: ["set-default", "--primary", "bogus/model"],
        command: "models set-default",
        id: "bogus/model"
      },
      {
        argv: ["set-default", "--primary", "local/m1", "--fast", "local/nope"],
        command: "models set-default",
        id: "local/nope"
      }
    ];
    for (const { argv, command, id } of cases) {
      const { report, stdout } = await refusal(stateRoot, argv);
      assert.equal(stdout, "");
      assert.equal(report.command, command);
      assert.equal(report.stage, "validation");
      assert.equal(report.message, `unknown model "${id}"`);
      assert.equal(report.next, next);
      assert.equal(report.next.includes(stateRoot), false);
    }
  });
});

test("a refused set-default --fast writes nothing at all", async () => {
  await withStateRoot(async (stateRoot) => {
    await writeCustomProviders(stateRoot);
    const before = await providersJsonBytes(stateRoot);

    await refusal(stateRoot, ["set-default", "--primary", "local/m1", "--fast", "local/nope"]);
    assert.equal(await providersJsonBytes(stateRoot), before);

    await refusal(stateRoot, ["set-default", "--primary", "local/m1", "--fast", "banana"]);
    assert.equal(await providersJsonBytes(stateRoot), before);
  });
});

/**
 * `Disabled <id>` for an id that was never enabled is a claim about work that
 * did not happen: the operator walks away believing an expensive model is off
 * while routing still resolves it. The honest answer for the pure no-op is that
 * there was nothing to clear — and it is the one case that writes nothing.
 */
test("disable of an id that is enabled nowhere and routed nowhere writes nothing", async () => {
  await withStateRoot(async (stateRoot) => {
    await writeCustomProviders(stateRoot);
    await run(stateRoot, ["enable", "local/m1"]);
    const before = await providersJsonBytes(stateRoot);

    const { io, out, err } = capture();
    assert.equal(
      await modelsCommand(["disable", "local/m2", "--state-root", stateRoot], io),
      0,
      err.join("")
    );
    assert.deepEqual(err, []);
    assert.equal(
      out.join(""),
      "local/m2 was not enabled; routing configuration was already clear\n"
    );
    assert.doesNotMatch(out.join(""), /Disabled/);
    // Raw bytes, not just semantic content: the pure no-op is the only branch
    // that skips `disableModel`, so nothing rewrote the file.
    assert.equal(await providersJsonBytes(stateRoot), before);
    assert.equal(await run(stateRoot, ["list"]), "local/m1\n");
  });
});

/**
 * A hand-edited config can name a default that is not in `enabled`. Clearing
 * that reference is real work, so this path must claim neither a `Disabled` it
 * did not do nor a no-op it was not: it says what it cleared, and the D21
 * per-role disclosure still fires.
 */
test("disable of a dangling default clears it and says so, without a Disabled claim", async () => {
  await withStateRoot(async (stateRoot) => {
    await mkdir(join(stateRoot, "runtime"), { recursive: true });
    await writeFile(
      providersJsonPath(stateRoot),
      `${JSON.stringify({
        version: 1,
        enabled: ["local/m2"],
        primary: "local/m1",
        fast: "local/m2",
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

    const disabled = await run(stateRoot, ["disable", "local/m1"]);
    assert.doesNotMatch(disabled, /Disabled/);
    assert.doesNotMatch(disabled, /nothing to disable|nothing changed|already clear/);
    assert.equal(
      disabled,
      "No enabled entry for local/m1; clearing dangling routing default references\n" +
        "note: local/m1 was the primary default; the default is now unset — set a new one with pi-sparkle models set-default\n"
    );

    // The claim is checked against the configuration, not against file bytes:
    // this branch does write. The dangling primary is gone and the unrelated
    // fast default survived.
    const after = JSON.parse(await providersJsonBytes(stateRoot)) as Record<string, unknown>;
    assert.equal(after.primary, undefined);
    assert.equal(after.fast, "local/m2");
    assert.deepEqual(after.enabled, ["local/m2"]);
    assert.equal(await run(stateRoot, ["list"]), "local/m2  fast\n");
  });
});

test("a dangling fast default is cleared and disclosed the same way", async () => {
  await withStateRoot(async (stateRoot) => {
    await mkdir(join(stateRoot, "runtime"), { recursive: true });
    await writeFile(
      providersJsonPath(stateRoot),
      `${JSON.stringify({
        version: 1,
        enabled: [],
        fast: "local/m1",
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

    const disabled = await run(stateRoot, ["disable", "local/m1"]);
    assert.match(
      disabled,
      /^No enabled entry for local\/m1; clearing dangling routing default references$/m
    );
    assert.match(disabled, /note: local\/m1 was the fast default; the default is now unset/);
    const after = JSON.parse(await providersJsonBytes(stateRoot)) as Record<string, unknown>;
    assert.equal(after.fast, undefined);

    // Re-running is the pure no-op now that the reference is gone.
    assert.equal(
      await run(stateRoot, ["disable", "local/m1"]),
      "local/m1 was not enabled; routing configuration was already clear\n"
    );
  });
});

/**
 * `--provider` was parsed and silently ignored outside `--available`, so "which
 * anthropic models are enabled" answered with the whole enabled list and exit
 * 0. Refused rather than filtered: filtering the enabled view would be a new
 * feature, and the silent ignore is the defect.
 */
test("list --provider without --available refuses instead of being ignored", async () => {
  await withStateRoot(async (stateRoot) => {
    await writeCustomProviders(stateRoot);
    await run(stateRoot, ["enable", "local/m1"]);
    for (const argv of [
      ["list", "--provider", "gateway"],
      ["list", "--provider", "gateway", "--json"]
    ]) {
      const { report, stdout } = await refusal(stateRoot, argv);
      assert.equal(stdout, "", "no MODELS_LIST and no prose on a refusal");
      assert.equal(report.command, "models list");
      assert.equal(report.stage, "parse-args");
      assert.equal(
        report.message,
        "models list --provider filters the --available catalog and does not apply to enabled models"
      );
      assert.equal(report.next, "add --available, or drop --provider");
    }
    // The enabled view without the flag is untouched.
    assert.equal(await run(stateRoot, ["list"]), "local/m1\n");
  });
});

/**
 * A blank provider id names nothing in either mode. Under `--available` it used
 * to be answered with `(no models)` — a successful empty inventory — so an
 * operator who followed a generic "add --available" remedy would have converted
 * the typo into that false answer instead of learning about it.
 */
test("a blank --provider is refused in both list modes, before either branch reads config", async () => {
  await withStateRoot(async (stateRoot) => {
    await writeCustomProviders(stateRoot);
    await run(stateRoot, ["enable", "local/m1"]);
    const cases = [
      { argv: ["list", "--provider", ""], raw: "" },
      { argv: ["list", "--provider", "", "--json"], raw: "" },
      { argv: ["list", "--available", "--provider", ""], raw: "" },
      { argv: ["list", "--available", "--json", "--provider", ""], raw: "" },
      { argv: ["list", "--available", "--provider", "  "], raw: "  " }
    ];
    for (const { argv, raw } of cases) {
      const { report, stdout } = await refusal(stateRoot, argv);
      assert.equal(stdout, "", `${argv.join(" ")} must print no inventory`);
      assert.equal(report.command, "models list");
      assert.equal(report.stage, "parse-args");
      assert.equal(
        report.message,
        `invalid --provider "${raw}": provider id must be a non-empty string`
      );
      assert.equal(report.next, "pass --provider <id>, or omit --provider");
    }

    // The blank guard runs first, so the blank value is never reported as the
    // narrower "--provider needs --available" incompatibility.
    const { report } = await refusal(stateRoot, ["list", "--provider", ""]);
    assert.doesNotMatch(report.message, /does not apply to enabled models/);
  });
});

test("a blank --provider refuses before the state root is opened", async () => {
  await withStateRoot(async (stateRoot) => {
    await mkdir(join(stateRoot, "runtime"), { recursive: true });
    await writeFile(providersJsonPath(stateRoot), "{ not json", "utf8");
    for (const argv of [
      ["list", "--provider", ""],
      ["list", "--available", "--provider", ""]
    ]) {
      const { report } = await refusal(stateRoot, argv);
      assert.equal(report.stage, "parse-args", argv.join(" "));
      assert.match(report.message, /^invalid --provider ""/);
    }
  });
});
