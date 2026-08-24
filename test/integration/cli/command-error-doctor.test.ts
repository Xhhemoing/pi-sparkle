import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { commandFailureNext, main, type CliIo } from "../../../src/cli/main.js";
import { parseCliErrorJson } from "../../../src/cli/errors.js";
import type { DoctorJsonReport } from "../../../src/cli/doctor.js";
import { createEventId, createRunId, type RunId } from "../../../src/domain/ids.js";
import { LOCK_TIMEOUT_CODE, withExclusiveFileLock } from "../../../src/persist/file-lock.js";
import {
  RUN_RECORDS_SURVIVED_CODE,
  verifyRunRecordsRemoved
} from "../../../src/privacy/deletion.js";
import { EventStore, runLockPath } from "../../../src/run/event-store.js";
import { makeEvent, makeRun } from "../../helpers/event-factory.js";

/**
 * The last hop from a refused command to the surface that answers it.
 *
 * Two refusals are deliberate and unfixable by retrying: a cooperative lock
 * this CLI never steals (`LOCK_TIMEOUT`) and a `delete --run` that could not
 * prove the records are gone (`RUN_RECORDS_SURVIVED`). `pi-sparkle doctor`
 * already inventories exactly what an operator needs for both — `locks[]`
 * with per-entry remediation and `runStates[]` with inspect/resume/delete
 * guidance — so the error surface names it.
 *
 * Routing is keyed on the frozen error codes only. The "same message, no
 * code" case below is the negative control: a message-matching implementation
 * would route it, and this one must not.
 */

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (text) => out.push(text), stderr: (text) => err.push(text) },
    out,
    err
  };
}

async function withStateRoot(run: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-error-doctor-"));
  try {
    await run(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

let sequence = 0;
const nextId = (): string => `error-doctor-${++sequence}`;

/** A run log doctor's `runStates` inventory reports as a crash candidate. */
async function seedRunningRun(stateRoot: string, occurredAt: string): Promise<RunId> {
  const runId = createRunId(nextId);
  const store = new EventStore(stateRoot, runId);
  await store.append(
    makeEvent(
      "RUN_CREATED",
      { run: { ...makeRun(), id: runId } },
      { id: createEventId(nextId), runId, occurredAt }
    )
  );
  await store.append(
    makeEvent("RUN_STARTED", {}, { id: createEventId(nextId), runId, occurredAt })
  );
  return runId;
}

/** A real `FileLockTimeoutError`, produced by a real contended acquisition. */
async function lockTimeout(lockPath: string): Promise<unknown> {
  return withExclusiveFileLock(lockPath, async () =>
    withExclusiveFileLock(lockPath, async () => undefined, { timeoutMs: 40, retryMs: 5 }).then(
      () => assert.fail("the nested acquisition must time out"),
      (error: unknown) => error
    )
  );
}

/** A real `RunRecordsSurvivedError`, produced by the delete's own verifier. */
async function recordsSurvived(stateRoot: string, runId: RunId): Promise<unknown> {
  return verifyRunRecordsRemoved(stateRoot, runId).then(
    () => assert.fail("a run directory that is still on disk must refuse"),
    (error: unknown) => error
  );
}

test("a lock timeout routes the operator to doctor's locks inventory", async () => {
  await withStateRoot(async (stateRoot) => {
    const runId = createRunId(nextId);
    const error = await lockTimeout(runLockPath(stateRoot, runId));
    assert.equal((error as { code?: unknown }).code, LOCK_TIMEOUT_CODE);

    const next = commandFailureNext(error, ["--run", runId, "--state-root", stateRoot]);
    assert.ok(
      next.includes(`pi-sparkle doctor --json --state-root ${stateRoot}`),
      `the remedy must name the doctor command for this state root: ${next}`
    );
    assert.match(next, /locks\[\]/, "the remedy must name the field that answers it");
    assert.match(next, /never steals/, "the no-steal posture is why retrying does not help");
  });
});

test("a run delete that cannot prove removal routes to runStates and locks", async () => {
  await withStateRoot(async (stateRoot) => {
    const runId = await seedRunningRun(stateRoot, "2026-08-24T17:59:00.000Z");
    const error = await recordsSurvived(stateRoot, runId);
    assert.equal((error as { code?: unknown }).code, RUN_RECORDS_SURVIVED_CODE);

    const next = commandFailureNext(error, ["--run", runId, "--state-root", stateRoot]);
    assert.ok(next.includes(`pi-sparkle doctor --json --state-root ${stateRoot}`), next);
    assert.match(next, /runStates\[\]/);
    assert.match(next, /locks\[\]/);

    // The named surface answers: doctor lists this run as a live candidate
    // with the inspect/resume/delete guidance the operator needs next.
    const doctor = capture();
    // Exit code is host-dependent here (the `node` check reads the real
    // runtime version), and irrelevant to the routing: the report is stdout.
    await main(["doctor", "--json", "--state-root", stateRoot], doctor.io);
    const report = JSON.parse(doctor.out.join("")) as DoctorJsonReport;
    const entry = report.runStates.entries.find((candidate) => candidate.runId === runId);
    assert.ok(entry, "doctor must inventory the run the delete refused to claim was gone");
    assert.equal(entry.status, "RUNNING");
    assert.match(entry.remediation, new RegExp(`delete --run ${runId}`));
  });
});

test("the remedy omits --state-root only when the failing command did too", async () => {
  await withStateRoot(async (stateRoot) => {
    const error = await lockTimeout(runLockPath(stateRoot, createRunId(nextId)));

    assert.ok(commandFailureNext(error, []).includes("run pi-sparkle doctor --json and"));
    assert.equal(
      commandFailureNext(error, ["--run", "run_x"]).includes("--state-root"),
      false,
      "doctor must not be told to inspect a state root the operator never named"
    );
    // Both spellings the CLI accepts reach the same remedy.
    assert.equal(
      commandFailureNext(error, [`--state-root=${stateRoot}`]),
      commandFailureNext(error, ["--state-root", stateRoot])
    );
    // A flag with no value must not swallow the next flag as a path.
    assert.equal(
      commandFailureNext(error, ["--state-root", "--json"]).includes("--state-root"),
      false
    );
  });
});

test("routing is code-discriminated: the message is never matched", async () => {
  await withStateRoot(async (stateRoot) => {
    const real = await lockTimeout(runLockPath(stateRoot, createRunId(nextId)));
    const message = (real as Error).message;
    assert.match(message, /^timed out waiting for lock at /, "the pinned message is unchanged");

    // Negative control: the same message, no code. Message-matching routes
    // this; code-discrimination must not.
    const impostor = new Error(message);
    assert.match(commandFailureNext(impostor, ["--state-root", stateRoot]), /fix the reported error/);

    // The mirror case: the code with a message that says nothing at all.
    const opaque = Object.assign(new Error("?"), { code: LOCK_TIMEOUT_CODE });
    assert.match(commandFailureNext(opaque, ["--state-root", stateRoot]), /locks\[\]/);

    // A wrapper must not drop the routing on the way out.
    assert.match(
      commandFailureNext(new Error("delete failed", { cause: real }), []),
      /locks\[\]/
    );
  });
});

test("an unrouted failure keeps the generic next line", async () => {
  await withStateRoot(async (stateRoot) => {
    const io = capture();
    // A malformed run id: a typed failure with no code, and no doctor
    // inventory that answers it.
    const code = await main(["delete", "--run", "nope", "--state-root", stateRoot], io.io);
    assert.equal(code, 1);
    const parsed = parseCliErrorJson(io.err.join(""));
    assert.equal(
      parsed?.next,
      "fix the reported error, then retry; use pi-sparkle doctor for preflight"
    );
  });
});

/**
 * End-to-end through the real CLI: `delete --run` against a lock held by
 * someone else. The wait is `withExclusiveFileLock`'s 5s default, which the
 * `delete` command does not parameterise, so this case costs that wall time
 * on purpose — it is the only offline way to make the shipped command produce
 * a real `LOCK_TIMEOUT`.
 */
test("delete --run refused by a held lock tells the operator to run doctor", async () => {
  await withStateRoot(async (stateRoot) => {
    const runId = await seedRunningRun(stateRoot, "2026-08-24T17:59:00.000Z");
    const runDir = join(stateRoot, "runtime", "runs", runId);
    const lockPath = runLockPath(stateRoot, runId);
    const io = capture();
    const doctor = capture();

    await withExclusiveFileLock(lockPath, async () => {
      assert.equal(await main(["delete", "--run", runId, "--state-root", stateRoot], io.io), 1);
      await main(["doctor", "--json", "--state-root", stateRoot], doctor.io);
    });

    const text = io.err.join("");
    // The existing surface is intact: the message still names the lock path.
    assert.match(text, new RegExp(`^error: timed out waiting for lock at ${lockPath}$`, "m"));
    assert.match(text, /^ {2}command: delete$/m);
    assert.match(text, /^ {2}stage: validation$/m);
    assert.match(text, /^ {2}next: .*pi-sparkle doctor --json --state-root /m);

    const parsed = parseCliErrorJson(text);
    assert.equal(parsed?.command, "delete");
    assert.ok(parsed?.next.includes(`pi-sparkle doctor --json --state-root ${stateRoot}`));
    assert.match(parsed.next, /locks\[\]/);
    // Fail-closed: the refusal deleted nothing.
    assert.equal(existsSync(runDir), true);

    // The remedy answers: doctor's inventory names the lock the delete hit,
    // with the remediation and the liveness advisory attached.
    const report = JSON.parse(doctor.out.join("")) as DoctorJsonReport;
    const entry = report.locks.entries.find((candidate) => candidate.path === lockPath);
    assert.ok(entry, "doctor must inventory the lock the delete timed out on");
    assert.equal(entry.pid, process.pid);
    assert.match(entry.remediation, /never automatic|do not remove based on age alone/);
    assert.match(report.locks.advisory, /doctor never steals or deletes locks/);
  });
});
