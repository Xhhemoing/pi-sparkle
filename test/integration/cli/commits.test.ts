import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { main, type CliIo } from "../../../src/cli/main.js";
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
    const parsed = JSON.parse(preview.out.join("")) as { commits: Array<{ subject: string; type: string; scope: string }> };
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
