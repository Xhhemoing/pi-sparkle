import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFile, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { main, type CliIo } from "../../../src/cli/main.js";
import { COMMITS_USAGE } from "../../../src/cli/commits.js";
import { parseCliErrorJson } from "../../../src/cli/errors.js";
import { createCliModelRouter } from "../../../src/cli/model-catalog.js";
import { createTaskId } from "../../../src/domain/ids.js";
import { validateConfidenceScore } from "../../../src/domain/flowchart.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { startFlowchartRun } from "../../../src/run/flowchart-run.js";

function capture(): { io: CliIo; out: string[]; err: string[] } {
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

const GIT_IDENTITY_ENV = {
  GIT_AUTHOR_NAME: "pi-sparkle-test",
  GIT_AUTHOR_EMAIL: "pi-sparkle-test@example.com",
  GIT_COMMITTER_NAME: "pi-sparkle-test",
  GIT_COMMITTER_EMAIL: "pi-sparkle-test@example.com"
};

function git(args: readonly string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...GIT_IDENTITY_ENV }
  });
}

async function withRoots(run: (stateRoot: string, projectRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-commits-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-commits-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await run(stateRoot, projectRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

async function tinyCompletedRun(stateRoot: string, projectRoot: string) {
  return startFlowchartRun(
    {
      stateRoot,
      router: createCliModelRouter(),
      now: () => parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
      generateId: (() => {
        let n = 0;
        return () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
      })()
    },
    {
      projectRoot,
      objective: "Ship a conventional commit",
      flowchart: {
        id: "commits-tiny",
        nodes: [
          {
            id: "work",
            taskId: createTaskId(() => "work"),
            role: "actor",
            objective: "Do the work",
            modelPolicy: { allowedModels: ["cheap"] },
            confidenceThreshold: validateConfidenceScore(0.7),
            approvalRequired: false
          }
        ],
        edges: []
      },
      childResults: {
        work: {
          outcome: "SUCCESS",
          confidence: validateConfidenceScore(0.9),
          evidenceIds: ["evd_work"]
        }
      }
    }
  );
}

/**
 * Two completed nodes so `apply` has a prefix to lose. `secondId` is a
 * parameter because a flowchart node id is only required to be non-empty
 * (`validateFlowchart`), and an id carrying a comma is the case `--nodes`
 * cannot name.
 */
async function twoNodeCompletedRun(stateRoot: string, projectRoot: string, secondId = "second") {
  return startFlowchartRun(
    {
      stateRoot,
      router: createCliModelRouter(),
      now: () => parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
      generateId: (() => {
        let n = 0;
        return () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
      })()
    },
    {
      projectRoot,
      objective: "Ship two conventional commits",
      flowchart: {
        id: "commits-pair",
        nodes: [
          {
            id: "first",
            taskId: createTaskId(() => "first"),
            role: "actor",
            objective: "Do the first thing",
            modelPolicy: { allowedModels: ["cheap"] },
            confidenceThreshold: validateConfidenceScore(0.7),
            approvalRequired: false
          },
          {
            id: secondId,
            taskId: createTaskId(() => "second"),
            role: "actor",
            objective: "Do the second thing",
            modelPolicy: { allowedModels: ["cheap"] },
            confidenceThreshold: validateConfidenceScore(0.7),
            approvalRequired: false
          }
        ],
        edges: [{ from: "first", to: secondId, condition: { type: "success", expected: true } }]
      },
      childResults: {
        first: {
          outcome: "SUCCESS",
          confidence: validateConfidenceScore(0.9),
          evidenceIds: ["evd_first"]
        },
        [secondId]: {
          outcome: "SUCCESS",
          confidence: validateConfidenceScore(0.9),
          evidenceIds: ["evd_second"]
        }
      }
    }
  );
}

// A `commit-msg` hook is the cheapest way to make git refuse commit *k* of *n*
// with the first k-1 already written.
async function repoRefusingTheSecondSubject(prefix: string): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), prefix));
  git(["-c", "user.name=pi-sparkle-test", "-c", "user.email=pi-sparkle-test@example.com", "init"], repo);
  const hook = join(repo, ".git", "hooks", "commit-msg");
  await writeFile(
    hook,
    "#!/bin/sh\nif grep -q 'Do the second thing' \"$1\"; then\n  echo 'commit-msg hook: refusing the second subject' >&2\n  exit 1\nfi\nexit 0\n",
    "utf8"
  );
  await chmod(hook, 0o755);
  return repo;
}

function noteLine(stderr: string): string | undefined {
  return stderr.split("\n").find((line) => line.startsWith("note: "));
}

const PARTIAL_APPLY_SKIP = platform() === "win32" ? "POSIX commit-msg hook" : false;

async function withGitIdentity<T>(run: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(GIT_IDENTITY_ENV)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("commits preview prints conventional messages with Evidence and the run id", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await tinyCompletedRun(stateRoot, projectRoot);
    const { io, out, err } = capture();
    const code = await main(["commits", "preview", "--run", outcome.runId, "--state-root", stateRoot], io);
    assert.equal(code, 0, err.join(""));
    const text = out.join("");
    assert.match(text, /^feat\(work\): Do the work/m);
    assert.match(text, /Evidence: evd_work/);
    assert.match(text, new RegExp(`Run: ${outcome.runId}`));
    assert.deepEqual(err, []);
  });
});

test("preview --json round-trips through apply --file into a temporary git repo", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await tinyCompletedRun(stateRoot, projectRoot);
    const preview = capture();
    const previewCode = await main(
      ["commits", "preview", "--run", outcome.runId, "--state-root", stateRoot, "--json"],
      preview.io
    );
    assert.equal(previewCode, 0, preview.err.join(""));
    const parsed = JSON.parse(preview.out.join("")) as {
      commits: Array<{ subject: string; type: string; scope: string }>;
    };
    assert.ok(Array.isArray(parsed.commits) && parsed.commits.length === 1);
    const expectedSubjects = parsed.commits.map((commit) => `${commit.type}(${commit.scope}): ${commit.subject}`);

    const repo = await mkdtemp(join(tmpdir(), "pi-sparkle-commits-repo-"));
    const file = join(repo, "edited.json");
    try {
      git(["-c", "user.name=pi-sparkle-test", "-c", "user.email=pi-sparkle-test@example.com", "init"], repo);
      await writeFile(file, preview.out.join(""), "utf8");
      const previous = { ...GIT_IDENTITY_ENV };
      const saved: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(previous)) {
        saved[key] = process.env[key];
        process.env[key] = value;
      }
      try {
        const apply = capture();
        const applyCode = await main(
          [
            "commits",
            "apply",
            "--run",
            outcome.runId,
            "--state-root",
            stateRoot,
            "--repo",
            repo,
            "--file",
            file
          ],
          apply.io
        );
        assert.equal(applyCode, 0, apply.err.join(""));
      } finally {
        for (const [key, value] of Object.entries(saved)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }

      const log = git(["log", "--reverse", "--format=%s"], repo).trim().split("\n");
      assert.deepEqual(log, expectedSubjects);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

test("apply without a git repo fails closed", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await tinyCompletedRun(stateRoot, projectRoot);
    const { io, out, err } = capture();
    const code = await main(["commits", "apply", "--run", outcome.runId, "--state-root", stateRoot], io);
    assert.equal(code, 1);
    assert.match(err.join(""), /git|work tree|not a git/i);
    assert.deepEqual(out, []);
  });
});

// `preview: true` marks the developer-preview contract every machine surface
// carries; it does not restate the `preview` subcommand. COMMITS_PREVIEW is a
// CLI view object, not an Event.
test("preview --json prints exactly one COMMITS_PREVIEW object with the pinned keys", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await tinyCompletedRun(stateRoot, projectRoot);
    const { io, out, err } = capture();
    const code = await main(
      ["commits", "preview", "--run", outcome.runId, "--state-root", stateRoot, "--json"],
      io
    );
    assert.equal(code, 0, err.join(""));
    assert.deepEqual(err, []);
    const text = out.join("");
    assert.equal(text.trimEnd().split("\n").length, 1);
    assert.deepEqual(JSON.parse(text), {
      type: "COMMITS_PREVIEW",
      preview: true,
      commits: [
        {
          type: "feat",
          scope: "work",
          subject: "Do the work",
          nodeId: "work",
          evidenceIds: ["evd_work"],
          runId: outcome.runId,
          confidence: 0.9,
          model: "cheap"
        }
      ]
    });
  });
});

test("apply --file still accepts a legacy untyped { commits: [...] } file", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await tinyCompletedRun(stateRoot, projectRoot);
    const preview = capture();
    assert.equal(
      await main(
        ["commits", "preview", "--run", outcome.runId, "--state-root", stateRoot, "--json"],
        preview.io
      ),
      0
    );
    const { commits } = JSON.parse(preview.out.join("")) as { commits: unknown[] };

    const repo = await mkdtemp(join(tmpdir(), "pi-sparkle-commits-legacy-"));
    const file = join(repo, "legacy.json");
    try {
      git(["-c", "user.name=pi-sparkle-test", "-c", "user.email=pi-sparkle-test@example.com", "init"], repo);
      await writeFile(file, JSON.stringify({ commits }, null, 2), "utf8");
      const saved: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(GIT_IDENTITY_ENV)) {
        saved[key] = process.env[key];
        process.env[key] = value;
      }
      try {
        const apply = capture();
        const applyCode = await main(
          ["commits", "apply", "--run", outcome.runId, "--state-root", stateRoot, "--repo", repo, "--file", file],
          apply.io
        );
        assert.equal(applyCode, 0, apply.err.join(""));
      } finally {
        for (const [key, value] of Object.entries(saved)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
      assert.equal(git(["log", "--format=%s"], repo).trim().split("\n").length, 1);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

test("commits preview and apply without --run report parse-args", async () => {
  for (const sub of ["preview", "apply"]) {
    const { io, out, err } = capture();
    assert.equal(await main(["commits", sub], io), 1);
    assert.deepEqual(out, []);
    const report = parseCliErrorJson(err.join(""));
    assert.equal(report?.command, "commits");
    assert.equal(report?.stage, "parse-args");
    assert.equal(report?.message, `commits ${sub} requires --run <runId>`);
    assert.equal(report?.next, "pass --run <runId>");
  }
});

test("commits on a run that does not exist reports lookup and names the list remedy", async () => {
  await withRoots(async (stateRoot) => {
    const { io, out, err } = capture();
    const code = await main(
      ["commits", "preview", "--run", "run_missing0001", "--state-root", stateRoot],
      io
    );
    assert.equal(code, 1);
    assert.deepEqual(out, []);
    const report = parseCliErrorJson(err.join(""));
    assert.equal(report?.command, "commits");
    assert.equal(report?.stage, "lookup");
    assert.equal(report?.runId, "run_missing0001");
    assert.match(report?.next ?? "", /pnpm cli list/);
  });
});

test("bare commits and an unknown subcommand print usage and a parse-args report", async () => {
  const bare = capture();
  assert.equal(await main(["commits"], bare.io), 1);
  assert.match(bare.err.join(""), /pi-sparkle commits preview --run/);
  const bareReport = parseCliErrorJson(bare.err.join(""));
  assert.equal(bareReport?.stage, "parse-args");
  assert.equal(bareReport?.message, "commits requires a subcommand: preview or apply");
  assert.equal(bareReport?.next, "use commits preview or commits apply");

  const unknown = capture();
  assert.equal(await main(["commits", "squash"], unknown.io), 1);
  const unknownReport = parseCliErrorJson(unknown.err.join(""));
  assert.equal(unknownReport?.command, "commits");
  assert.equal(unknownReport?.stage, "parse-args");
  assert.equal(unknownReport?.message, "Unknown commits command: squash");
});

// Windows has no POSIX shell for the `commit-msg` hook these three cases need,
// and this file is not in the Windows `cli-smoke` matrix.
test(
  "a mid-loop apply failure discloses the commits it already made and names --nodes for the rest",
  { skip: PARTIAL_APPLY_SKIP },
  async () => {
    await withRoots(async (stateRoot, projectRoot) => {
      const outcome = await twoNodeCompletedRun(stateRoot, projectRoot);
      const repo = await repoRefusingTheSecondSubject("pi-sparkle-commits-partial-");
      try {
        const apply = capture();
        const code = await withGitIdentity(() =>
          main(
            ["commits", "apply", "--run", outcome.runId, "--state-root", stateRoot, "--repo", repo],
            apply.io
          )
        );

        assert.equal(code, 1);
        assert.match(apply.out.join(""), /Committed feat\(first\): Do the first thing/);
        assert.equal(
          noteLine(apply.err.join("")),
          `note: 1 of 2 proposed commits were already created in ${repo} before this failure; ` +
            "re-running apply would create them again — the commits not yet created are for node ids second; " +
            "pass --nodes second to apply only those"
        );

        assert.deepEqual(git(["log", "--format=%s"], repo).trim().split("\n"), [
          "feat(first): Do the first thing"
        ]);

        // The disclosed remedy is the one that works: `--nodes second` skips
        // the commit already in the history instead of duplicating it.
        const retry = capture();
        const retryCode = await withGitIdentity(() =>
          main(
            [
              "commits",
              "apply",
              "--run",
              outcome.runId,
              "--state-root",
              stateRoot,
              "--repo",
              repo,
              "--nodes",
              "second"
            ],
            retry.io
          )
        );
        assert.equal(retryCode, 1, "the hook still refuses the second subject");
        assert.deepEqual(retry.out, []);
        assert.equal(noteLine(retry.err.join("")), undefined);
        assert.equal(git(["log", "--format=%s"], repo).trim().split("\n").length, 1);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    });
  }
);

// `--nodes` re-derives its selection from the checkpoint, so it is not a valid
// recovery for an edited file: `parseDecisionCommitFile` accepts a repeated
// `nodeId` (the filter would reselect the commit already created) and one the
// checkpoint never knew (the filter would refuse the whole rerun).
test(
  "a mid-loop apply --file failure sends the operator to a suffix file, never to --nodes",
  { skip: PARTIAL_APPLY_SKIP },
  async () => {
    await withRoots(async (stateRoot, projectRoot) => {
      const outcome = await twoNodeCompletedRun(stateRoot, projectRoot);
      const preview = capture();
      assert.equal(
        await main(
          ["commits", "preview", "--run", outcome.runId, "--state-root", stateRoot, "--json"],
          preview.io
        ),
        0
      );
      const { commits } = JSON.parse(preview.out.join("")) as { commits: unknown[] };
      assert.equal(commits.length, 2);

      const repo = await repoRefusingTheSecondSubject("pi-sparkle-commits-partial-file-");
      const file = join(repo, "edited.json");
      try {
        await writeFile(file, JSON.stringify({ commits }), "utf8");
        const apply = capture();
        const code = await withGitIdentity(() =>
          main(
            [
              "commits",
              "apply",
              "--run",
              outcome.runId,
              "--state-root",
              stateRoot,
              "--repo",
              repo,
              "--file",
              file
            ],
            apply.io
          )
        );

        assert.equal(code, 1);
        const note = noteLine(apply.err.join("")) ?? "";
        assert.equal(
          note,
          `note: 1 of 2 proposed commits were already created in ${repo} before this failure; ` +
            "re-running apply would create them again — the commits not yet created are for node ids second; " +
            'write just those proposals to a new file as { "commits": [...] } and rerun apply with --file on ' +
            "that file — do not rerun an input that still contains the first 1"
        );
        assert.doesNotMatch(note, /--nodes/);
        assert.deepEqual(git(["log", "--format=%s"], repo).trim().split("\n"), [
          "feat(first): Do the first thing"
        ]);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    });
  }
);

// A flowchart node id is only required to be non-empty, and `--nodes` splits on
// commas, so an id containing one cannot round-trip. Disclose the ids and send
// the operator to a suffix file rather than narrowing the id grammar.
test(
  "a remaining node id that --nodes cannot round-trip is disclosed without a --nodes command",
  { skip: PARTIAL_APPLY_SKIP },
  async () => {
    await withRoots(async (stateRoot, projectRoot) => {
      const outcome = await twoNodeCompletedRun(stateRoot, projectRoot, "second,tail");
      const repo = await repoRefusingTheSecondSubject("pi-sparkle-commits-partial-csv-");
      try {
        const apply = capture();
        const code = await withGitIdentity(() =>
          main(
            ["commits", "apply", "--run", outcome.runId, "--state-root", stateRoot, "--repo", repo],
            apply.io
          )
        );

        assert.equal(code, 1);
        const note = noteLine(apply.err.join("")) ?? "";
        assert.match(note, /node ids second,tail;/);
        assert.doesNotMatch(note, /--nodes/);
        assert.match(note, /rerun apply with --file on that file/);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    });
  }
);

test("a crash-truncated event log is disclosed on stderr and leaves --json one clean line", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await tinyCompletedRun(stateRoot, projectRoot);
    await appendFile(
      join(stateRoot, "runtime", "runs", outcome.runId, "events.jsonl"),
      '{"type":"RUN_COMP',
      "utf8"
    );

    const { io, out, err } = capture();
    const code = await main(
      ["commits", "preview", "--run", outcome.runId, "--state-root", stateRoot, "--json"],
      io
    );

    assert.equal(code, 0, err.join(""));
    assert.match(err.join(""), /warning: ignored truncated event log at line \d+/);
    const text = out.join("");
    assert.equal(text.trimEnd().split("\n").length, 1);
    const parsed = JSON.parse(text) as { type: string; commits: unknown[] };
    assert.equal(parsed.type, "COMMITS_PREVIEW");
    assert.equal(parsed.commits.length, 1);
  });
});

for (const sub of ["preview", "apply"]) {
  test(`a mistyped commits ${sub} flag is an argv error that names --help`, async () => {
    const { io, out, err } = capture();
    const code = await main(["commits", sub, "--nodess", "a,b"], io);

    assert.equal(code, 1);
    assert.deepEqual(out, []);
    const parsed = parseCliErrorJson(err.join(""));
    assert.equal(parsed?.command, "commits");
    assert.equal(parsed?.stage, "parse-args");
    assert.match(parsed?.message ?? "", /--nodess/);
    assert.match(parsed?.next ?? "", /--help/);
  });

  test(`commits ${sub} --help prints the usage and reads no run`, async () => {
    const { io, out, err } = capture();
    const code = await main(["commits", sub, "--help"], io);

    assert.equal(code, 0, err.join(""));
    assert.equal(out.join(""), COMMITS_USAGE);
    assert.deepEqual(err, []);
  });
}

// A pasted-wrong run id is an argv typo: the remedy is the id list, never
// doctor preflight, and the refusal echoes what the operator typed.
for (const sub of ["preview", "apply"]) {
  test(`commits ${sub} refuses a malformed --run before reading state`, async () => {
    const stateRoot = join(tmpdir(), "pi-sparkle-commits-nowhere");
    const { io, out, err } = capture();
    const code = await main(["commits", sub, "--run", "banana", "--state-root", stateRoot], io);

    assert.equal(code, 1);
    assert.deepEqual(out, []);
    const report = parseCliErrorJson(err.join(""));
    assert.equal(report?.command, "commits");
    assert.equal(report?.stage, "parse-args");
    assert.equal(report?.message, 'invalid --run "banana": expected a run id of the form run_<suffix>');
    assert.equal(report?.next, `pass --run <runId> as printed by pnpm cli list --state-root ${stateRoot}`);
    assert.equal(report?.runId, "banana");
  });

  // The state root does not exist, so a refusal that names `--nodes` rather
  // than the missing run proves the CSV is judged before any state read.
  test(`commits ${sub} refuses a --nodes CSV that selects nothing, before state`, async () => {
    const stateRoot = join(tmpdir(), "pi-sparkle-commits-nowhere");
    const { io, out, err } = capture();
    const code = await main(
      ["commits", sub, "--run", "run_missing0001", "--state-root", stateRoot, "--nodes", ","],
      io
    );

    assert.equal(code, 1);
    assert.deepEqual(out, []);
    const report = parseCliErrorJson(err.join(""));
    assert.equal(report?.command, "commits");
    assert.equal(report?.stage, "parse-args");
    assert.equal(report?.message, 'invalid --nodes ",": selects no node ids');
    assert.equal(report?.next, "pass --nodes <id,id> or drop the flag to use every completed node");
    assert.equal(report?.runId, undefined);
  });

  // Which node ids exist is run state, so the stage stays `validation` — but
  // the remedy names the flag and the command that prints the ids.
  test(`commits ${sub} sends an unknown --nodes id to inspect, not to doctor`, async () => {
    await withRoots(async (stateRoot, projectRoot) => {
      const outcome = await tinyCompletedRun(stateRoot, projectRoot);
      const { io, out, err } = capture();
      const code = await main(
        ["commits", sub, "--run", outcome.runId, "--state-root", stateRoot, "--nodes", "bogus"],
        io
      );

      assert.equal(code, 1);
      assert.deepEqual(out, []);
      const report = parseCliErrorJson(err.join(""));
      assert.equal(report?.command, "commits");
      assert.equal(report?.stage, "validation");
      assert.equal(report?.message, "unknown flowchart node id(s): bogus");
      assert.equal(
        report?.next,
        "pass --nodes ids from this run's flowchart; " +
          `pi-sparkle inspect --run ${outcome.runId} --state-root ${stateRoot} lists its nodes`
      );
      assert.match(report?.next ?? "", /inspect --run/);
      assert.equal(report?.runId, outcome.runId);
    });
  });
}

// A trailing comma that still names ids is a typo the CSV parser already
// absorbs; only a selection of nothing refuses.
test("commits preview accepts a --nodes CSV with a trailing comma", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await tinyCompletedRun(stateRoot, projectRoot);
    const { io, out, err } = capture();
    const code = await main(
      ["commits", "preview", "--run", outcome.runId, "--state-root", stateRoot, "--nodes", "work,"],
      io
    );

    assert.equal(code, 0, err.join(""));
    assert.match(out.join(""), /^feat\(work\): Do the work/m);
    assert.deepEqual(err, []);
  });
});

test("apply names --file when the path cannot be read", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await tinyCompletedRun(stateRoot, projectRoot);
    const file = join(projectRoot, "nope.json");
    const { io, out, err } = capture();
    const code = await main(
      [
        "commits",
        "apply",
        "--run",
        outcome.runId,
        "--state-root",
        stateRoot,
        "--repo",
        projectRoot,
        "--file",
        file
      ],
      io
    );

    assert.equal(code, 1);
    assert.deepEqual(out, []);
    const report = parseCliErrorJson(err.join(""));
    assert.equal(report?.command, "commits");
    assert.equal(report?.stage, "lookup");
    assert.match(report?.message ?? "", new RegExp(`^cannot read --file ${file}: `));
    assert.match(report?.message ?? "", /ENOENT/);
    assert.equal(
      report?.next,
      "check the --file path; commits preview --json writes an input this flag accepts"
    );
    assert.equal(report?.runId, outcome.runId);
  });
});

test("apply reports an unparsable --file against the file, not the run", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await tinyCompletedRun(stateRoot, projectRoot);
    const file = join(projectRoot, "edited.json");
    await writeFile(file, "not json at all", "utf8");
    const { io, out, err } = capture();
    const code = await main(
      [
        "commits",
        "apply",
        "--run",
        outcome.runId,
        "--state-root",
        stateRoot,
        "--repo",
        projectRoot,
        "--file",
        file
      ],
      io
    );

    assert.equal(code, 1);
    assert.deepEqual(out, []);
    const report = parseCliErrorJson(err.join(""));
    assert.equal(report?.command, "commits");
    assert.equal(report?.stage, "validation");
    assert.match(report?.message ?? "", new RegExp(`^${file}: decision commit file is not valid JSON: `));
    assert.equal(report?.next, `fix ${file} or regenerate it with commits preview --json`);
    assert.equal(report?.runId, outcome.runId);
  });
});

// A supplied blank `--repo` is an argv fault. The checkpoint fallback answers
// only for the flag the operator *omitted*, so blaming a missing environment
// here would hide the empty string they actually passed.
for (const repo of ["", "  "]) {
  test(`apply refuses --repo ${JSON.stringify(repo)} as argv, naming the flag`, async () => {
    await withRoots(async (stateRoot, projectRoot) => {
      const outcome = await tinyCompletedRun(stateRoot, projectRoot);
      const { io, out, err } = capture();
      const code = await main(
        ["commits", "apply", "--run", outcome.runId, "--state-root", stateRoot, "--repo", repo],
        io
      );

      assert.equal(code, 1);
      assert.deepEqual(out, []);
      assert.deepEqual(parseCliErrorJson(err.join("")), {
        ok: false,
        command: "commits",
        stage: "parse-args",
        message: `invalid --repo "${repo}": repository path must be a non-empty string`,
        next: "pass --repo <path to a git work tree> or omit it to use checkpoint project.rootPath",
        runId: outcome.runId
      });
    });
  });
}

// The state root does not exist, so the same argv report proves the blank flag
// is judged before the run is read.
test("apply refuses a whitespace --repo before reading state", async () => {
  const stateRoot = join(tmpdir(), "pi-sparkle-commits-nowhere");
  const { io, out, err } = capture();
  const code = await main(
    ["commits", "apply", "--run", "run_missing0001", "--state-root", stateRoot, "--repo", "  "],
    io
  );

  assert.equal(code, 1);
  assert.deepEqual(out, []);
  assert.deepEqual(parseCliErrorJson(err.join("")), {
    ok: false,
    command: "commits",
    stage: "parse-args",
    message: 'invalid --repo "  ": repository path must be a non-empty string',
    next: "pass --repo <path to a git work tree> or omit it to use checkpoint project.rootPath",
    runId: "run_missing0001"
  });
});

test("apply with no --repo still commits into the checkpoint project.rootPath", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    git(["-c", "user.name=pi-sparkle-test", "-c", "user.email=pi-sparkle-test@example.com", "init"], projectRoot);
    const outcome = await tinyCompletedRun(stateRoot, projectRoot);
    const { io, out, err } = capture();
    const code = await withGitIdentity(() =>
      main(["commits", "apply", "--run", outcome.runId, "--state-root", stateRoot], io)
    );

    assert.equal(code, 0, err.join(""));
    assert.match(out.join(""), /Committed feat\(work\): Do the work/);
    assert.deepEqual(git(["log", "--format=%s"], projectRoot).trim().split("\n"), [
      "feat(work): Do the work"
    ]);
  });
});

// Omitted flag *and* no project on the checkpoint: nothing in argv is wrong, so
// this stays the environment report.
test("apply with no --repo and no checkpoint project reports preflight", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await tinyCompletedRun(stateRoot, projectRoot);
    const checkpointPath = join(stateRoot, "runtime", "runs", outcome.runId, "checkpoint.json");
    const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8")) as Record<string, unknown>;
    delete checkpoint.project;
    await writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf8");

    const { io, out, err } = capture();
    const code = await main(["commits", "apply", "--run", outcome.runId, "--state-root", stateRoot], io);

    assert.equal(code, 1);
    assert.deepEqual(out, []);
    assert.deepEqual(parseCliErrorJson(err.join("")), {
      ok: false,
      command: "commits",
      stage: "preflight",
      message: "apply requires --repo or a checkpoint project.rootPath",
      next: "pass --repo <path to a git work tree>",
      runId: outcome.runId
    });
  });
});

test("apply against a directory that is not a work tree reports preflight", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await tinyCompletedRun(stateRoot, projectRoot);
    const { io, out, err } = capture();
    const code = await main(
      ["commits", "apply", "--run", outcome.runId, "--state-root", stateRoot, "--repo", projectRoot],
      io
    );

    assert.equal(code, 1);
    assert.deepEqual(out, []);
    const report = parseCliErrorJson(err.join(""));
    assert.equal(report?.command, "commits");
    assert.equal(report?.stage, "preflight");
    assert.match(report?.message ?? "", new RegExp(`^apply requires a git work tree at ${projectRoot}: `));
    assert.equal(report?.next, `run git init in ${projectRoot} or pass --repo <git work tree>`);
    assert.equal(report?.runId, outcome.runId);
  });
});

const BLANK_ROOT_NEXT = "pass --state-root <dir> or omit it to use the default ~/.pi-sparkle";

function blankRootMessage(raw: string): string {
  return `invalid --state-root "${raw}": state root must be a non-empty directory path`;
}

// `--state-root ""` resolved to the process working directory, so the ledger
// read answered `Run … not found under ` about the root the operator meant and
// offered a remedy that pasted as `pnpm cli list --state-root for the run ids`.
// Both subcommands refuse it before their own root assignment.
test("commits preview and apply refuse a blank --state-root, all four fields", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await tinyCompletedRun(stateRoot, projectRoot);
    for (const sub of ["preview", "apply"]) {
      for (const raw of ["", "  "]) {
        const { io, out, err } = capture();
        const code = await main(["commits", sub, "--run", outcome.runId, `--state-root=${raw}`], io);
        assert.equal(code, 1, `${sub} ${raw}`);
        assert.deepEqual(out, [], `${sub} prints nothing on a refusal`);
        assert.deepEqual(parseCliErrorJson(err.join("")), {
          ok: false,
          command: "commits",
          stage: "parse-args",
          message: blankRootMessage(raw),
          next: BLANK_ROOT_NEXT
        });
        assert.doesNotMatch(err.join(""), /not found under/);
      }
    }
  });
});

test("commits preview --json refuses a blank --state-root before any COMMITS_PREVIEW", async () => {
  const { io, out, err } = capture();
  assert.equal(await main(["commits", "preview", "--run", "run_missing0001", "--json", "--state-root", ""], io), 1);
  assert.deepEqual(out, []);
  assert.doesNotMatch(err.join(""), /COMMITS_PREVIEW/);
  assert.equal(parseCliErrorJson(err.join(""))?.message, blankRootMessage(""));
});

// Placement: the guard sits before each subcommand's root assignment, so it
// precedes the run-shape and `--repo` refusals whose reports would otherwise
// carry the root the operator did not supply. `--run` is still required first,
// because that refusal needs no root at all.
test("the blank --state-root guard sits after --run is required and before the root-bearing refusals", async () => {
  const missingRun = capture();
  assert.equal(await main(["commits", "apply", "--state-root", ""], missingRun.io), 1);
  assert.equal(
    parseCliErrorJson(missingRun.err.join(""))?.message,
    "commits apply requires --run <runId>"
  );

  for (const argv of [
    ["commits", "preview", "--run", "banana", "--state-root", ""],
    ["commits", "apply", "--run", "banana", "--state-root", "", "--repo", "  "]
  ]) {
    const { io, err } = capture();
    assert.equal(await main(argv, io), 1, argv.join(" "));
    const report = parseCliErrorJson(err.join(""));
    assert.equal(report?.message, blankRootMessage(""), argv.join(" "));
    assert.equal(report?.next, BLANK_ROOT_NEXT);
    assert.doesNotMatch(err.join(""), /expected a run id|repository path must be/);
  }
});

// ---------------------------------------------------------------------------
// The four stored-ledger faults. Each one used to reach `main.ts`'s generic
// catch and tell the operator to run `pi-sparkle doctor`, which inventories run
// event logs and not checkpoint files: on a root holding a deleted and a
// corrupt `checkpoint.json`, doctor passes every check and never prints the
// word `checkpoint`. The store's and the commit plane's message bytes are kept;
// only the remedy changes.
// ---------------------------------------------------------------------------

function checkpointPath(stateRoot: string, runId: string): string {
  return join(stateRoot, "runtime", "runs", runId, "checkpoint.json");
}

async function editCheckpoint(
  stateRoot: string,
  runId: string,
  edit: (checkpoint: Record<string, unknown>) => void
): Promise<void> {
  const path = checkpointPath(stateRoot, runId);
  const checkpoint = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  edit(checkpoint);
  await writeFile(path, JSON.stringify(checkpoint, null, 2), "utf8");
}

// A state root is arbitrary operator text, so no new remedy pastes one into a
// line that looks copy-paste safe; only the run id, whose grammar `isRunId`
// has already constrained, is interpolated.
function absentCheckpointNext(runId: string): string {
  return (
    "this run recorded events but no durable checkpoint; " +
    `pi-sparkle inspect --run ${runId} using the same --state-root shows its status — ` +
    "only checkpointed runs have a decision ledger"
  );
}

const CORRUPT_CHECKPOINT_NEXT =
  "repair or move aside the checkpoint file named above, then retry; " +
  "pi-sparkle doctor does not inventory checkpoint files";

const NON_FLOWCHART_NEXT =
  "decision commits are generated from a flowchart run's checkpoint; " +
  "this run was not started with run --flowchart, so it has no decision ledger";

function noProposalsNext(runId: string): string {
  return (
    `pi-sparkle inspect --run ${runId} using the same --state-root lists its nodes; ` +
    "commit proposals exist only for COMPLETED nodes"
  );
}

const DOCTOR_NEXT = "fix the reported error, then retry; use pi-sparkle doctor for preflight";

// A run that recorded events and died before its first durable write. The
// record is absent rather than damaged, so this is `lookup` — the same class as
// a `--file` that is not there.
test("commits preview on a run whose checkpoint is gone reports lookup and never doctor", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await tinyCompletedRun(stateRoot, projectRoot);
    await rm(checkpointPath(stateRoot, outcome.runId));

    const { io, out, err } = capture();
    const code = await main(["commits", "preview", "--run", outcome.runId, "--state-root", stateRoot], io);

    assert.equal(code, 1);
    assert.deepEqual(out, []);
    assert.deepEqual(parseCliErrorJson(err.join("")), {
      ok: false,
      command: "commits",
      stage: "lookup",
      message: `Run ${outcome.runId} has no durable checkpoint`,
      next: absentCheckpointNext(outcome.runId),
      runId: outcome.runId
    });
    assert.doesNotMatch(err.join(""), /doctor/);
    assert.ok(!absentCheckpointNext(outcome.runId).includes(stateRoot), "the remedy carries no raw state root");
  });
});

test("commits preview on a corrupt checkpoint keeps the store's bytes and says doctor cannot help", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await tinyCompletedRun(stateRoot, projectRoot);
    await writeFile(checkpointPath(stateRoot, outcome.runId), "not json{\n", "utf8");

    const { io, out, err } = capture();
    const code = await main(["commits", "preview", "--run", outcome.runId, "--state-root", stateRoot], io);

    assert.equal(code, 1);
    assert.deepEqual(out, []);
    const report = parseCliErrorJson(err.join(""));
    assert.equal(report?.command, "commits");
    assert.equal(report?.stage, "validation");
    assert.match(
      report?.message ?? "",
      new RegExp(`^Invalid checkpoint ${checkpointPath(stateRoot, outcome.runId)}: `)
    );
    assert.equal(report?.next, CORRUPT_CHECKPOINT_NEXT);
    assert.equal(report?.runId, outcome.runId);
    assert.doesNotMatch(report?.next ?? "", /doctor for preflight/);
  });
});

// The default run kind (`run` with no `--flowchart`) writes exactly this
// checkpoint, so it is the first thing a preview operator hits.
for (const sub of ["preview", "apply"]) {
  test(`commits ${sub} on a checkpoint with no flowchart names the run kind, not doctor`, async () => {
    await withRoots(async (stateRoot, projectRoot) => {
      git(["-c", "user.name=pi-sparkle-test", "-c", "user.email=pi-sparkle-test@example.com", "init"], projectRoot);
      const outcome = await tinyCompletedRun(stateRoot, projectRoot);
      await editCheckpoint(stateRoot, outcome.runId, (checkpoint) => {
        delete checkpoint.flowchart;
      });

      const { io, out, err } = capture();
      const code = await main(["commits", sub, "--run", outcome.runId, "--state-root", stateRoot], io);

      assert.equal(code, 1);
      assert.deepEqual(out, []);
      assert.deepEqual(parseCliErrorJson(err.join("")), {
        ok: false,
        command: "commits",
        stage: "validation",
        message: "checkpoint has no flowchart; decision-to-commit requires a flowchart run",
        next: NON_FLOWCHART_NEXT,
        runId: outcome.runId
      });
      // The refusal precedes the commit loop, so `apply` wrote no history.
      assert.equal(git(["rev-list", "--all"], projectRoot).trim(), "");
    });
  });

  test(`commits ${sub} on a run with no completed node retargets to inspect, not doctor`, async () => {
    await withRoots(async (stateRoot, projectRoot) => {
      git(["-c", "user.name=pi-sparkle-test", "-c", "user.email=pi-sparkle-test@example.com", "init"], projectRoot);
      const outcome = await tinyCompletedRun(stateRoot, projectRoot);
      await editCheckpoint(stateRoot, outcome.runId, (checkpoint) => {
        const flowchart = checkpoint.flowchart as { snapshot: { nodes: Record<string, { state: string }> } };
        const work = flowchart.snapshot.nodes.work;
        assert.ok(work !== undefined, "the tiny run has a work node");
        work.state = "FAILED";
      });

      const { io, out, err } = capture();
      const code = await main(["commits", sub, "--run", outcome.runId, "--state-root", stateRoot], io);

      assert.equal(code, 1);
      assert.deepEqual(out, []);
      assert.deepEqual(parseCliErrorJson(err.join("")), {
        ok: false,
        command: "commits",
        stage: "validation",
        message: "no completed nodes to commit",
        next: noProposalsNext(outcome.runId),
        runId: outcome.runId
      });
      assert.ok(!noProposalsNext(outcome.runId).includes(stateRoot), "the remedy carries no raw state root");
      assert.equal(git(["rev-list", "--all"], projectRoot).trim(), "");
    });
  });
}

// `--nodes` names an id the checkpoint knows, so D32's unknown-id filter passes
// it through; the file simply does not carry a proposal for it. That is the
// same zero-proposal fact, reached through the other throw site.
test("apply --file whose --nodes selection is absent from the file reports zero proposals", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await twoNodeCompletedRun(stateRoot, projectRoot);
    const preview = capture();
    assert.equal(
      await main(
        ["commits", "preview", "--run", outcome.runId, "--state-root", stateRoot, "--json", "--nodes", "first"],
        preview.io
      ),
      0,
      preview.err.join("")
    );

    const repo = await mkdtemp(join(tmpdir(), "pi-sparkle-commits-filesel-"));
    const file = join(repo, "first-only.json");
    try {
      git(["-c", "user.name=pi-sparkle-test", "-c", "user.email=pi-sparkle-test@example.com", "init"], repo);
      await writeFile(file, preview.out.join(""), "utf8");

      const { io, out, err } = capture();
      const code = await main(
        [
          "commits",
          "apply",
          "--run",
          outcome.runId,
          "--state-root",
          stateRoot,
          "--repo",
          repo,
          "--file",
          file,
          "--nodes",
          "second"
        ],
        io
      );

      assert.equal(code, 1);
      assert.deepEqual(out, []);
      assert.deepEqual(parseCliErrorJson(err.join("")), {
        ok: false,
        command: "commits",
        stage: "validation",
        message: "no completed nodes to commit",
        next: noProposalsNext(outcome.runId),
        runId: outcome.runId
      });
      assert.equal(git(["rev-list", "--all"], repo).trim(), "");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

// Ordering: the zero-proposal catch sits after `filterDecisionCommitNodeIds`,
// so an id the checkpoint never knew still gets D32's closed envelope — whose
// remedy predates the no-raw-path rule and is not reopened here.
test("apply --file with an unknown --nodes id keeps the D32 envelope, not the zero-proposal one", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await twoNodeCompletedRun(stateRoot, projectRoot);
    const preview = capture();
    assert.equal(
      await main(
        ["commits", "preview", "--run", outcome.runId, "--state-root", stateRoot, "--json", "--nodes", "first"],
        preview.io
      ),
      0,
      preview.err.join("")
    );

    const repo = await mkdtemp(join(tmpdir(), "pi-sparkle-commits-filebogus-"));
    const file = join(repo, "first-only.json");
    try {
      git(["-c", "user.name=pi-sparkle-test", "-c", "user.email=pi-sparkle-test@example.com", "init"], repo);
      await writeFile(file, preview.out.join(""), "utf8");

      const { io, out, err } = capture();
      const code = await main(
        [
          "commits",
          "apply",
          "--run",
          outcome.runId,
          "--state-root",
          stateRoot,
          "--repo",
          repo,
          "--file",
          file,
          "--nodes",
          "bogus"
        ],
        io
      );

      assert.equal(code, 1);
      assert.deepEqual(out, []);
      assert.deepEqual(parseCliErrorJson(err.join("")), {
        ok: false,
        command: "commits",
        stage: "validation",
        message: "unknown flowchart node id(s): bogus",
        next:
          "pass --nodes ids from this run's flowchart; " +
          `pi-sparkle inspect --run ${outcome.runId} --state-root ${stateRoot} lists its nodes`,
        runId: outcome.runId
      });
      assert.equal(git(["rev-list", "--all"], repo).trim(), "");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

// The two passthroughs that keep the new catches narrow. A corrupt *event log*
// is the one family in this command doctor genuinely inventories, so it must
// still reach main's generic envelope with the doctor remedy intact.
test("a corrupt event log still reaches main's generic envelope with the doctor remedy", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await tinyCompletedRun(stateRoot, projectRoot);
    await appendFile(join(stateRoot, "runtime", "runs", outcome.runId, "events.jsonl"), "not an event\n", "utf8");

    const { io, out, err } = capture();
    const code = await main(["commits", "preview", "--run", outcome.runId, "--state-root", stateRoot], io);

    assert.equal(code, 1);
    assert.deepEqual(out, []);
    const report = parseCliErrorJson(err.join(""));
    assert.equal(report?.command, "commits");
    assert.equal(report?.stage, "validation");
    assert.match(report?.message ?? "", /^Corrupt event log line \d+$/);
    assert.equal(report?.next, DOCTOR_NEXT);
    assert.equal(report?.runId, undefined);
  });
});

// A coded filesystem fault is an environment fault main already routes, so the
// new catches rethrow it untouched.
test("a regular file as --state-root keeps today's coded ENOTDIR report", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const blocker = join(projectRoot, "not-a-directory");
    await writeFile(blocker, "", "utf8");

    const { io, out, err } = capture();
    const code = await main(["commits", "preview", "--run", "run_missing0001", "--state-root", blocker], io);

    assert.equal(code, 1);
    assert.deepEqual(out, []);
    const report = parseCliErrorJson(err.join(""));
    assert.equal(report?.command, "commits");
    assert.equal(report?.stage, "execute");
    assert.match(report?.message ?? "", /ENOTDIR/);
    assert.equal(report?.next, DOCTOR_NEXT);
    assert.equal(report?.runId, undefined);
  });
});

test("preview does not create commits", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    git(["-c", "user.name=pi-sparkle-test", "-c", "user.email=pi-sparkle-test@example.com", "init"], projectRoot);
    const outcome = await tinyCompletedRun(stateRoot, projectRoot);
    const before = git(["rev-list", "--all"], projectRoot).trim();
    const { io, err } = capture();
    const code = await main(["commits", "preview", "--run", outcome.runId, "--state-root", stateRoot], io);
    assert.equal(code, 0, err.join(""));
    const after = git(["rev-list", "--all"], projectRoot).trim();
    assert.equal(after, before);
    assert.equal(after, "");
  });
});
