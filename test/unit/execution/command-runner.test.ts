import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runAuthorizedCommand, type AuthorizedCommandRunResult } from "../../../src/execution/command-runner.js";

const policy = { timeoutMs: 5_000, maxStdoutBytes: 1024, maxStderrBytes: 1024 };

test("successful commands preserve stdout, stderr and exit status", async () => {
  const result = await runAuthorizedCommand({
    executable: process.execPath,
    args: ["-e", "process.stdout.write('ok'); process.stderr.write('warning')"],
    cwd: process.cwd(), env: process.env, ...policy
  });
  assert.equal(result.status, "completed");
  assert.equal(result.exitCode, 0);
  assert.equal(result.ok, true);
  assert.equal(result.stdoutText, "ok");
  assert.equal(result.stderrText, "warning");
});

test("a missing executable returns spawn_error without waiting for timeout", async () => {
  const result = await runAuthorizedCommand({
    executable: path.join(tmpdir(), "sparkle-command-does-not-exist", "missing"),
    args: [], cwd: process.cwd(), env: process.env, ...policy
  });
  assert.equal(result.status, "spawn_error");
  assert.equal(result.ok, false);
});

test("pre-aborted command never starts", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await runAuthorizedCommand({
    executable: process.execPath,
    args: ["-e", "process.exit(17)"],
    cwd: process.cwd(),
    env: process.env,
    ...policy,
    signal: controller.signal
  });
  assert.equal(result.status, "cancelled");
  assert.equal(result.spawned, false);
});

test("abort terminates a running command and returns bounded output", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "sparkle-runner-"));
  try {
    const controller = new AbortController();
    const running = runAuthorizedCommand({
      executable: process.execPath,
      args: ["-e", "setInterval(() => process.stdout.write('x'), 5)"],
      cwd,
      env: process.env,
      timeoutMs: 5_000,
      maxStdoutBytes: 32,
      maxStderrBytes: 32,
      signal: controller.signal
    });
    setTimeout(() => controller.abort(), 40).unref();
    const result = await running;
    assert.equal(result.status, "cancelled");
    assert.equal(result.spawned, true);
    assert.ok(result.stdoutByteLength >= result.stdoutText.length);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("output overflow is a distinct terminal result", async () => {
  const result = await runAuthorizedCommand({
    executable: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(1000))"],
    cwd: process.cwd(),
    env: process.env,
    ...policy,
    maxStdoutBytes: 32
  });
  assert.equal(result.status, "output_limit");
  assert.equal(result.ok, false);
});

const posixOnly = { skip: process.platform === "win32" };

function killFixture(pid: number): void {
  try { process.kill(pid, "SIGKILL"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function within<T>(pending: Promise<T>, milliseconds: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("command cleanup exceeded test deadline")), milliseconds);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function withStubbornFixture(
  kind: "direct" | "inherited" | "escaped" | "overflow",
  inspect: (fixture: {
    running: Promise<AuthorizedCommandRunResult>;
    controller: AbortController;
  }) => Promise<void>,
  timeoutMs = 5_000
): Promise<void> {
  const cwd = await mkdtemp(path.join(tmpdir(), "sparkle-runner-cleanup-"));
  const readyPath = path.join(cwd, "ready.json");
  const controller = new AbortController();
  // Every fixture also self-exits, independently of the runner and test cleanup.
  const stubborn = `
    const fs = require('node:fs');
    process.on('SIGTERM', () => {});
    setTimeout(() => process.exit(99), 10000);
    fs.writeFileSync(process.argv[1], JSON.stringify({
      leader: Number(process.argv[2]) || process.pid, child: process.pid
    }));
    ${kind === "overflow" ? "process.stdout.write('x'.repeat(4096));" : ""}
  `;
  const script = kind === "direct" || kind === "overflow" ? stubborn : `
    const { spawn } = require('node:child_process');
    const fs = require('node:fs');
    spawn(process.execPath, ['-e', ${JSON.stringify(stubborn)}, process.argv[1], String(process.pid)], {
      detached: ${kind === "escaped"}, stdio: ['ignore', 'inherit', 'inherit']
    });
    setTimeout(() => process.exit(98), 10000);
    const ready = setInterval(() => {
      if (fs.existsSync(process.argv[1])) { clearInterval(ready); process.exit(0); }
    }, 5);
  `;
  const running = runAuthorizedCommand({
    executable: process.execPath, args: ["-e", script, readyPath], cwd,
    env: process.env, ...policy, timeoutMs, signal: controller.signal
  });
  let pids: { leader: number; child: number } | undefined;
  try {
    const readReady = async (): Promise<void> => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
          pids = JSON.parse(await readFile(readyPath, "utf8")) as typeof pids;
          return;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      throw new Error("command fixture did not become ready");
    };
    await readReady();
    await inspect({ running, controller });
  } finally {
    controller.abort();
    if (pids !== undefined) {
      for (const pid of [-pids.leader, pids.child]) {
        killFixture(pid);
      }
    }
    await within(running, 11_000);
    await rm(cwd, { recursive: true, force: true });
  }
}

test("abort force-kills a ready command that ignores SIGTERM", posixOnly, async () => {
  await withStubbornFixture("direct", async ({ running, controller }) => {
    controller.abort();
    const result = await within(running, 2_000);
    assert.equal(result.status, "cancelled");
    assert.equal(result.signal, "SIGKILL");
    assert.equal(result.ok, false);
    assert.equal(result.errorMessage, undefined);
  });
});

test("timeout force-kills a ready command that ignores SIGTERM", posixOnly, async () => {
  await withStubbornFixture("direct", async ({ running }) => {
    const result = await within(running, 2_000);
    assert.equal(result.status, "timed_out");
    assert.equal(result.signal, "SIGKILL");
    assert.equal(result.errorMessage, "command exceeded 300ms");
  }, 300);
});

test("output overflow force-kills without replacing the first failure reason", posixOnly, async () => {
  await withStubbornFixture("overflow", async ({ running }) => {
    const result = await within(running, 2_000);
    assert.equal(result.status, "output_limit");
    assert.equal(result.signal, "SIGKILL");
    assert.equal(result.errorMessage, "stdout exceeded host limit");
    assert.equal(result.stdoutText.length, policy.maxStdoutBytes);
  }, 300);
});

test("timeout kills inherited-pipe descendants after the group leader exits", posixOnly, async () => {
  await withStubbornFixture("inherited", async ({ running }) => {
    const result = await within(running, 2_000);
    assert.equal(result.status, "timed_out");
    assert.equal(result.exitCode, 0);
    assert.equal(result.ok, false);
    assert.equal(result.errorMessage, "command exceeded 300ms");
  }, 300);
});

test("escaped descendants cannot hold cleanup forever or produce success", posixOnly, async () => {
  await withStubbornFixture("escaped", async ({ running }) => {
    const result = await within(running, 2_000);
    assert.equal(result.status, "timed_out");
    assert.equal(result.ok, false);
    assert.match(result.errorMessage ?? "", /cleanup incomplete/);
    assert.equal(result.cleanupUnsettled, true);
  }, 300);
});

test("a normal leader exit cannot accept a surviving ignored-stdio descendant", posixOnly, async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "sparkle-runner-residue-"));
  const heartbeat = path.join(cwd, "heartbeat");
  const readyPath = path.join(cwd, "ready");
  let pid: number | undefined;
  try {
    const script = `
      const fs = require('node:fs');
      const {spawn} = require('node:child_process');
      const child = spawn(process.execPath, ['-e', ${JSON.stringify(`
        const fs = require('node:fs');
        process.on('SIGTERM', () => {});
        setTimeout(() => process.exit(99), 10000);
        fs.writeFileSync(${JSON.stringify(heartbeat)}, 'start');
        setInterval(() => fs.appendFileSync(${JSON.stringify(heartbeat)}, '.'), 10);
        fs.writeFileSync(${JSON.stringify(`${readyPath}.tmp`)}, String(process.pid));
        fs.renameSync(${JSON.stringify(`${readyPath}.tmp`)}, ${JSON.stringify(readyPath)});
      `)}], {stdio: 'ignore'});
      child.unref();
      const ready = setInterval(() => { if (fs.existsSync(${JSON.stringify(readyPath)})) {clearInterval(ready); process.exit(0);} }, 10);
      setTimeout(() => process.exit(98), 10000).unref();
    `;
    const result = await within(runAuthorizedCommand({ executable: process.execPath, args: ["-e", script],
      cwd, env: process.env, ...policy }), 3_000);
    pid = Number(await readFile(readyPath, "utf8"));
    assert.ok(Number.isSafeInteger(pid) && pid > 1);
    assert.equal(result.ok, false);
    assert.equal(result.cleanupUnsettled, true);
    const stopped = await readFile(heartbeat, "utf8");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await readFile(heartbeat, "utf8"), stopped);
  } finally {
    if (pid === undefined) {
      try { pid = Number(await readFile(readyPath, "utf8")); } catch { /* Fixture failed before spawn. */ }
    }
    if (pid !== undefined && Number.isSafeInteger(pid) && pid > 1) killFixture(pid);
    await rm(cwd, { recursive: true, force: true });
  }
});

async function withNaturallySettlingDescendant(
  settleAfterLeaderMs: number,
  inspect: (fixture: {
    running: Promise<AuthorizedCommandRunResult>;
    controller: AbortController;
    leader: number;
    settledPath: string;
    waitForLeaderExit: () => Promise<void>;
  }) => Promise<void>
): Promise<void> {
  const cwd = await mkdtemp(path.join(tmpdir(), "sparkle-runner-natural-"));
  const readyPath = path.join(cwd, "ready.json");
  const leaderExitedPath = path.join(cwd, "leader-exited");
  const settledPath = path.join(cwd, "settled");
  const controller = new AbortController();
  const descendant = `
    const fs = require('node:fs');
    const leader = Number(process.argv[1]);
    setTimeout(() => process.exit(99), 10000).unref();
    const watch = setInterval(() => {
      try { process.kill(leader, 0); }
      catch (error) {
        if (error.code !== 'ESRCH') throw error;
        clearInterval(watch);
        fs.writeFileSync(${JSON.stringify(leaderExitedPath)}, 'leader exited');
        setTimeout(() => {
          fs.writeFileSync(${JSON.stringify(settledPath)}, 'settled');
          process.exit(0);
        }, ${settleAfterLeaderMs});
      }
    }, 5);
    fs.writeFileSync(${JSON.stringify(`${readyPath}.tmp`)}, JSON.stringify({ leader, child: process.pid }));
    fs.renameSync(${JSON.stringify(`${readyPath}.tmp`)}, ${JSON.stringify(readyPath)});
  `;
  const leaderScript = `
    const fs = require('node:fs');
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}, String(process.pid)], { stdio: 'ignore' });
    child.unref();
    const ready = setInterval(() => {
      if (fs.existsSync(${JSON.stringify(readyPath)})) { clearInterval(ready); process.exit(0); }
    }, 5);
    setTimeout(() => process.exit(98), 10000).unref();
  `;
  const running = runAuthorizedCommand({
    executable: process.execPath, args: ["-e", leaderScript], cwd,
    env: process.env, ...policy, signal: controller.signal
  });
  const waitForFile = async (file: string): Promise<string> => {
    for (let attempt = 0; attempt < 250; attempt += 1) {
      try { return await readFile(file, "utf8"); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    throw new Error(`command fixture did not produce ${path.basename(file)}`);
  };
  let pids: { leader: number; child: number } | undefined;
  try {
    pids = JSON.parse(await waitForFile(readyPath)) as { leader: number; child: number };
    await inspect({
      running, controller, leader: pids.leader, settledPath,
      waitForLeaderExit: async () => { await waitForFile(leaderExitedPath); }
    });
  } finally {
    controller.abort();
    if (pids === undefined) {
      try { pids = JSON.parse(await readFile(readyPath, "utf8")) as typeof pids; }
      catch { /* Preserve the original failure; an unready fixture self-expires. */ }
    }
    if (pids !== undefined) {
      killFixture(-pids.leader);
      killFixture(pids.child);
    }
    await within(running, 11_000);
    await rm(cwd, { recursive: true, force: true });
  }
}

test("normal leader exit waits for natural descendant settlement before accepting", posixOnly, async () => {
  await withNaturallySettlingDescendant(80, async ({ running, leader, settledPath }) => {
    const result = await within(running, 3_000);
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.equal(result.exitCode, 0);
    assert.equal(result.ok, true);
    assert.equal(result.cleanupUnsettled, undefined);
    assert.equal(await readFile(settledPath, "utf8"), "settled");
    assert.throws(() => process.kill(-leader, 0), (error: unknown) =>
      (error as NodeJS.ErrnoException).code === "ESRCH", "acceptance waits for the actual process group to disappear");
  });
});

test("abort during natural descendant settlement remains unsettled and cannot accept", posixOnly, async () => {
  await withNaturallySettlingDescendant(1_000, async ({ running, controller, waitForLeaderExit }) => {
    await waitForLeaderExit();
    controller.abort();
    const result = await within(running, 3_000);
    assert.equal(result.status, "cancelled");
    assert.equal(result.exitCode, 0, "the leader had already exited successfully before cancellation");
    assert.equal(result.ok, false);
    assert.equal(result.cleanupUnsettled, true);
  });
});

test("a transient positive group probe after successful exit is rechecked before cancelling", posixOnly, async (t) => {
  const realKill = process.kill.bind(process);
  let groupProbes = 0;
  const signals: Array<NodeJS.Signals | number | undefined> = [];
  t.mock.method(process, "kill", (pid: number, signal?: NodeJS.Signals | number) => {
    if (pid < 0 && signal === 0) {
      groupProbes += 1;
      // Reproduce the observed race: the group existed at the first probe, but
      // disappears before the next probe without requiring a termination signal.
      if (groupProbes === 1) return true;
    } else if (pid < 0) {
      signals.push(signal);
    }
    return realKill(pid, signal);
  });
  const controller = new AbortController();
  const running = runAuthorizedCommand({
    executable: process.execPath, args: ["-e", "process.exit(0)"],
    cwd: process.cwd(), env: process.env, ...policy, signal: controller.signal
  });
  try {
    const result = await within(running, 3_000);
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.equal(result.exitCode, 0);
    assert.equal(result.ok, true);
    assert.equal(result.cleanupUnsettled, undefined);
    assert.ok(groupProbes >= 2, "a transient positive process-group probe must be rechecked");
    assert.deepEqual(signals, [], "a group that disappears naturally needs no termination signals");
  } finally {
    controller.abort();
    await within(running, 3_000);
  }
});

test("command deadline remains active after the leader closes while its group settles", {
  ...posixOnly, timeout: 10_000
}, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const realKill = process.kill.bind(process);
  let groupProbes = 0;
  t.mock.method(process, "kill", (pid: number, signal?: NodeJS.Signals | number) => {
    if (pid < 0 && signal === 0) {
      if (++groupProbes === 1) {
        // Advance the command deadline only after close has observed a group.
        queueMicrotask(() => {
          t.mock.timers.tick(policy.timeoutMs);
          t.mock.timers.tick(policy.timeoutMs);
        });
      }
      return true;
    }
    return realKill(pid, signal);
  });
  const result = await runAuthorizedCommand({
    executable: process.execPath, args: ["-e", "process.exit(0)"],
    cwd: process.cwd(), env: process.env, ...policy
  });
  assert.ok(groupProbes > 0, "deadline must expire after the close-time group probe");
  assert.equal(result.exitCode, 0);
  assert.equal(result.status, "timed_out", JSON.stringify(result));
  assert.equal(result.errorMessage, `command exceeded ${policy.timeoutMs}ms`);
  assert.equal(result.ok, false);
  assert.equal(result.cleanupUnsettled, true);
});
