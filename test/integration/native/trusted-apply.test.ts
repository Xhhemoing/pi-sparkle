import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createEvidenceId, createMessageId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import { prepareTrustedVerification } from "../../../src/execution/trusted-verification.js";
import { NativeApplySession } from "../../../src/native/apply.js";
import { NativeWriteSession, type NativeWriteSessionResult } from "../../../src/native/write-session.js";

const BEFORE = "before\n";
const AFTER = "after!\n";
const VERIFY = {
  command: process.execPath,
  args: ["-e", "const fs=require('node:fs');process.exit(fs.readFileSync('value.txt','utf8')==='after!\\n'?0:1)"]
};

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

interface Fixture { root: string; repo: string; result: NativeWriteSessionResult }

async function withCandidate(body: (fixture: Fixture) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "trusted-apply-"));
  const repo = path.join(root, "repo");
  await mkdir(repo);
  git(repo, ["init"]);
  git(repo, ["config", "user.name", "Trusted Apply Test"]);
  git(repo, ["config", "user.email", "trusted-apply@example.invalid"]);
  git(repo, ["config", "core.autocrlf", "false"]);
  await writeFile(path.join(repo, "value.txt"), BEFORE);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "base"]);
  const sandboxRoot = path.join(root, "sandbox");
  await mkdir(sandboxRoot);
  try {
    const session = new NativeWriteSession({
      stateRoot: path.join(root, "state"), sandboxRoot,
      executorFactory: ({ tools }) => ({
        async *execute(request, signal) {
          const write = tools.find((tool) => tool.name === "sparkle_write_file");
          assert.ok(write);
          await write.execute("write", { path: "value.txt", contents: AFTER }, signal);
          const evidenceId = createEvidenceId();
          yield {
            type: "MESSAGE" as const,
            message: {
              protocolVersion: 1 as const, id: createMessageId(), occurredAt: nowIso(),
              runId: request.runId, taskId: request.taskId, from: request.agentInstanceId,
              to: "SUPERVISOR" as const, type: "TASK_RESULT" as const, outcome: "SUCCESS" as const,
              summary: "candidate updated", artifactIds: [], evidenceIds: [evidenceId],
              verification: { kind: "PASSED" as const, evidenceIds: [evidenceId] }
            }
          };
          yield { type: "EXECUTION_FINISHED" as const, outcome: "SUCCESS" as const };
        }
      })
    });
    const trustedVerification = prepareTrustedVerification(VERIFY);
    const result = await session.execute({
      sourceRepo: repo, objective: "Update value", verification: { ...VERIFY, trustedVerification }
    });
    assert.equal(result.acceptance.accepted, true, result.reason);
    await body({ root, repo, result });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function assertUnapplied(repo: string, result: NativeWriteSessionResult): Promise<void> {
  assert.equal(git(repo, ["rev-parse", "HEAD"]), result.sourceRevision);
  assert.equal(await readFile(path.join(repo, "value.txt"), "utf8"), BEFORE);
  assert.equal(await readFile(path.join(result.candidatePath, "value.txt"), "utf8"), AFTER);
}

test("trusted apply binds checked binary/empty/LF files to the source tree despite autocrlf", async () => {
  await withCandidate(async ({ repo, result }) => {
    await writeFile(path.join(result.candidatePath, "binary.dat"), Buffer.from([0, 255, 13, 10, 4]));
    await writeFile(path.join(result.candidatePath, "empty.txt"), "");
    git(repo, ["config", "core.autocrlf", "true"]);
    let prepared = false;
    const applied = await new NativeApplySession().apply({
      sourceRepo: repo, result, trustedVerification: prepareTrustedVerification({ ...VERIFY, snapshotManifest: { optionalIncludePrefixes: [] } }),
      onPrepared: async (target) => {
        assert.equal(Object.isFrozen(target), true);
        assert.equal(target.sourceRevision, result.sourceRevision);
        assert.equal(target.candidatePath, result.candidatePath);
        assert.equal(git(repo, ["rev-parse", `${target.appliedRevision}^{tree}`]), target.candidateTree);
        assert.equal(git(repo, ["rev-parse", "HEAD"]), result.sourceRevision);
        await Promise.resolve();
        prepared = true;
      }
    });
    assert.equal(prepared, true);
    assert.equal(applied.status, "APPLIED");
    assert.equal(git(repo, ["rev-parse", "HEAD"]), applied.appliedRevision);
    assert.equal(await readFile(path.join(repo, "value.txt"), "utf8"), AFTER);
    assert.deepEqual(await readFile(path.join(repo, "binary.dat")), Buffer.from([0, 255, 13, 10, 4]));
    assert.equal((await readFile(path.join(repo, "empty.txt"))).length, 0);
    assert.equal(await readFile(path.join(result.candidatePath, "value.txt"), "utf8"), AFTER);
  });
});

for (const removed of ["path", "path-and-record"] as const) test(`strict managed disposal refuses missing ${removed} while legacy policy remains available`, async () => {
  await withCandidate(async ({ root, repo, result }) => {
    const session = new NativeApplySession();
    await session.apply({ sourceRepo: repo, result, trustedVerification: prepareTrustedVerification(VERIFY) });
    assert.equal(path.dirname(result.candidatePath), path.join(root, "sandbox"), "remove only this private synthetic candidate");
    if (removed === "path") await rm(result.candidatePath, { recursive: true, force: true });
    else git(repo, ["worktree", "remove", "--force", result.candidatePath]);
    const before = git(repo, ["worktree", "list", "--porcelain", "-z"]);
    await assert.rejects(session.disposeStrict(result.candidatePath), /missing|inaccessible|registered|identity/);
    assert.equal(git(repo, ["worktree", "list", "--porcelain", "-z"]), before, "strict refusal does not prune the registration");
    if (removed === "path-and-record") assert.equal((await session.dispose(result.candidatePath)).status, "DISPOSED", "legacy missing-record reconciliation stays unchanged");
  });
});

test("trusted apply refuses missing, copied and JSON descriptors without changing source", async () => {
  await withCandidate(async ({ repo, result }) => {
    const descriptor = prepareTrustedVerification(VERIFY);
    for (const trustedVerification of [undefined, { ...descriptor }, JSON.parse(JSON.stringify(descriptor))]) {
      await assert.rejects(new NativeApplySession().apply({ sourceRepo: repo, result, trustedVerification }), /trusted|descriptor|capability/i);
      await assertUnapplied(repo, result);
    }
  });
});

test("trusted apply refuses command mismatch and every partial manifest", async () => {
  await withCandidate(async ({ repo, result }) => {
    const descriptors = [
      prepareTrustedVerification({ command: process.execPath, args: ["-e", "process.exit(0)"] }),
      prepareTrustedVerification({ ...VERIFY, snapshotManifest: { includePrefixes: ["value.txt"] } }),
      prepareTrustedVerification({ ...VERIFY, snapshotManifest: { optionalIncludePrefixes: ["value.txt"] } }),
      prepareTrustedVerification({ ...VERIFY, snapshotManifest: { excludePrefixes: ["uncovered"] } })
    ];
    for (const trustedVerification of descriptors) {
      await assert.rejects(new NativeApplySession().apply({ sourceRepo: repo, result, trustedVerification }), /descriptor|argv|command|whole|manifest|scope/i);
      await assertUnapplied(repo, result);
    }
  });
});

test("trusted apply refuses a same-length mutation made by the actual verifier", async () => {
  await withCandidate(async ({ repo, result }) => {
    const verification = { command: process.execPath, args: ["-e", "require('node:fs').writeFileSync('value.txt','other!\\n')"] };
    const changed = { ...result, acceptance: { ...result.acceptance, ...verification } };
    await assert.rejects(new NativeApplySession().apply({
      sourceRepo: repo, result: changed, trustedVerification: prepareTrustedVerification(verification)
    }), /re-verification|snapshot|changed/i);
    assert.equal(git(repo, ["rev-parse", "HEAD"]), result.sourceRevision);
    assert.equal(await readFile(path.join(repo, "value.txt"), "utf8"), BEFORE);
    assert.equal(await readFile(path.join(result.candidatePath, "value.txt"), "utf8"), "other!\n");
  });
});

test("trusted apply refuses an ignored extra file absent from the staged tree", async () => {
  await withCandidate(async ({ repo, result }) => {
    await writeFile(path.join(result.candidatePath, ".gitignore"), "unbound.txt\n");
    await writeFile(path.join(result.candidatePath, "unbound.txt"), "not staged");
    await assert.rejects(new NativeApplySession().apply({ sourceRepo: repo, result, trustedVerification: prepareTrustedVerification(VERIFY) }), /tree|snapshot|file/i);
    await assertUnapplied(repo, result);
  });
});

for (const location of ["candidate", "source-info"] as const) {
  test(`trusted apply refuses active text attributes from ${location}`, async () => {
    await withCandidate(async ({ repo, result }) => {
      const attrs = location === "candidate"
        ? path.join(result.candidatePath, ".gitattributes")
        : path.join(repo, ".git", "info", "attributes");
      await writeFile(attrs, "value.txt text\n");
      await assert.rejects(new NativeApplySession().apply({ sourceRepo: repo, result, trustedVerification: prepareTrustedVerification(VERIFY) }), /attribute|transform/i);
      await assertUnapplied(repo, result);
    });
  });
}

test("trusted apply refuses a real clean filter that would change verified bytes", async () => {
  await withCandidate(async ({ root, repo, result }) => {
    const filter = path.join(root, "filter.cjs");
    await writeFile(filter, "let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>process.stdout.write(input.replace('after!','other!')));");
    const executable = process.execPath.replaceAll("\\", "/");
    const filterPath = filter.replaceAll("\\", "/");
    git(repo, ["config", "filter.tamper.clean", `${JSON.stringify(executable)} ${JSON.stringify(filterPath)}`]);
    await writeFile(path.join(repo, ".git", "info", "attributes"), "value.txt filter=tamper\n");
    await assert.rejects(new NativeApplySession().apply({ sourceRepo: repo, result, trustedVerification: prepareTrustedVerification(VERIFY) }), /attribute|transform/i);
    await assertUnapplied(repo, result);
  });
});

test("trusted prepared callback failure prevents source mutation", async () => {
  await withCandidate(async ({ repo, result }) => {
    await assert.rejects(new NativeApplySession().apply({
      sourceRepo: repo, result, trustedVerification: prepareTrustedVerification(VERIFY),
      onPrepared: async () => { await Promise.resolve(); throw new Error("checkpoint unavailable"); }
    }), /checkpoint unavailable/);
    await assertUnapplied(repo, result);
  });
});

for (const changed of ["candidate", "source", "attributes"] as const) {
  test(`trusted apply rechecks ${changed} after prepared callback settles`, async () => {
    await withCandidate(async ({ repo, result }) => {
      await assert.rejects(new NativeApplySession().apply({
        sourceRepo: repo, result, trustedVerification: prepareTrustedVerification(VERIFY),
        onPrepared: async () => {
          if (changed === "attributes") await writeFile(path.join(repo, ".git", "info", "attributes"), "value.txt text\n");
          else await writeFile(path.join(changed === "candidate" ? result.candidatePath : repo, "value.txt"), "other!\n");
        }
      }), /changed|snapshot|attribute|transform/i);
      assert.equal(git(repo, ["rev-parse", "HEAD"]), result.sourceRevision);
      assert.equal(await readFile(path.join(repo, "value.txt"), "utf8"), changed === "source" ? "other!\n" : BEFORE);
      assert.equal(await readFile(path.join(result.candidatePath, "value.txt"), "utf8"), changed === "candidate" ? "other!\n" : AFTER);
    });
  });
}

test("trusted apply awaits the prepared callback even after cancellation, then refuses checkout", async () => {
  await withCandidate(async ({ repo, result }) => {
    const controller = new AbortController();
    let entered!: () => void;
    const entry = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let settled = false;
    const pending = new NativeApplySession().apply({
      sourceRepo: repo, result, trustedVerification: prepareTrustedVerification(VERIFY), signal: controller.signal,
      onPrepared: async () => { entered(); await gate; }
    }).finally(() => { settled = true; });
    const rejected = assert.rejects(pending, /abort|cancel/i);
    await entry;
    controller.abort();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, false, "in-flight host persistence must not be abandoned");
    release();
    await rejected;
    await assertUnapplied(repo, result);
  });
});

test("trusted apply snapshots caller result/input before prepared callback", async () => {
  await withCandidate(async ({ root, repo, result }) => {
    const mutableResult = { ...result, acceptance: { ...result.acceptance, args: [...result.acceptance.args] } };
    const input = {
      sourceRepo: repo, result: mutableResult, trustedVerification: prepareTrustedVerification(VERIFY),
      onPrepared: () => {
        mutableResult.sourceRevision = "0".repeat(40);
        mutableResult.candidatePath = root;
        mutableResult.acceptance.args[0] = "mutated";
        input.sourceRepo = root;
      }
    };
    const session = new NativeApplySession();
    const applied = await session.apply(input);
    assert.equal(applied.sourceRevision, result.sourceRevision);
    assert.equal(applied.candidatePath, result.candidatePath);
    assert.equal(await readFile(path.join(repo, "value.txt"), "utf8"), AFTER);
    await session.dispose(result.candidatePath);
    assert.equal(session.managedCount, 0);
  });
});

test("trusted apply detects raw source drift hidden by assume-unchanged after ORIG_HEAD hook", { skip: process.platform === "win32" }, async () => {
  await withCandidate(async ({ repo, result }) => {
    const hook = path.join(repo, ".git", "hooks", "reference-transaction");
    await writeFile(hook, "#!/bin/sh\nif [ \"$1\" = prepared ]; then\n while read old new ref; do\n  if [ \"$ref\" = ORIG_HEAD ]; then\n   printf 'other!\\n' > value.txt\n   git update-index --assume-unchanged value.txt\n  fi\n done\nfi\n");
    await chmod(hook, 0o755);
    await assert.rejects(new NativeApplySession().apply({ sourceRepo: repo, result, trustedVerification: prepareTrustedVerification(VERIFY) }), /source update failed|tree|snapshot/i);
    assert.equal(git(repo, ["rev-parse", "HEAD"]), result.sourceRevision);
    assert.equal(await readFile(path.join(repo, "value.txt"), "utf8"), "other!\n");
    assert.equal(await readFile(path.join(result.candidatePath, "value.txt"), "utf8"), AFTER);
  });
});

test("trusted apply refuses active attributes introduced by an ORIG_HEAD hook", { skip: process.platform === "win32" }, async () => {
  await withCandidate(async ({ repo, result }) => {
    const hook = path.join(repo, ".git", "hooks", "reference-transaction");
    await writeFile(hook, "#!/bin/sh\nif [ \"$1\" = prepared ]; then\n while read old new ref; do\n  if [ \"$ref\" = ORIG_HEAD ]; then\n   printf 'value.txt text\\n' > .git/info/attributes\n  fi\n done\nfi\n");
    await chmod(hook, 0o755);
    await assert.rejects(new NativeApplySession().apply({
      sourceRepo: repo, result, trustedVerification: prepareTrustedVerification(VERIFY)
    }), /source update failed|attribute|transform/i);
    assert.equal(git(repo, ["rev-parse", "HEAD"]), result.sourceRevision);
    // The reference hook runs after the two-tree checkout. Apply refuses to publish
    // the branch but preserves the observed checkout state; it never guesses a rollback.
    assert.equal(await readFile(path.join(repo, "value.txt"), "utf8"), AFTER);
    assert.equal(await readFile(path.join(repo, ".git", "info", "attributes"), "utf8"), "value.txt text\n");
    assert.equal(await readFile(path.join(result.candidatePath, "value.txt"), "utf8"), AFTER);
  });
});

test("trusted apply rejects pattern-only descriptors before staging source changes", async () => {
  await withCandidate(async ({ repo, result }) => {
    for (const snapshotManifest of [{ includePatterns: ["**"] }, { optionalIncludePatterns: ["**"] }]) {
      const descriptor = prepareTrustedVerification({ ...VERIFY, snapshotManifest });
      let prepared = false;
      await assert.rejects(new NativeApplySession().apply({ sourceRepo: repo, result, trustedVerification: descriptor,
        onPrepared: () => { prepared = true; } }), /whole-candidate descriptor without manifest exceptions/);
      assert.equal(prepared, false);
      await assertUnapplied(repo, result);
    }
  });
});
