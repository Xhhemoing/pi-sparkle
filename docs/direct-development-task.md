# Direct development task (experimental host entry)

`startDevelopmentTask` runs one isolated development task with the existing
`NativeWriteSession`. The host supplies a clean Git source repository, objective,
executor factory and verification command. A project queue, monetary limit,
planner and reviewer are not required inputs. The function owns its session and
always awaits shutdown before returning or propagating a preflight error.

This is the first bounded M1 slice under [ADR-009](decisions/0009-lightweight-adaptive-framework.md),
not a stable package SDK export. After `pnpm build`, a host in this repository can
use the experimental deep module import:

```ts
import { startDevelopmentTask } from "./dist/development/start-task.js";

const result = await startDevelopmentTask({
  stateRoot,
  sandboxRoot,
  sourceRepo,
  objective: "Implement the declared behavior",
  verification: { command: trustedChecker, args: trustedArguments },
  executorFactory: async ({ tools, signal, attempt }) => {
    return buildExecutor({ tools, signal, attempt });
  },
  signal
});

console.log(result.status, result.reason, result.candidatePath, result.artifact);
```

`buildExecutor`, `trustedChecker`, `trustedArguments` and the other host variables
are integration placeholders. The factory returns the existing `AgentExecutor`
contract and preserves the supplied candidate-scoped tools and cancellation
signal. It must not execute edits against the source checkout. The host chooses
verification; worker output and repair feedback do not grant command authority.
Candidate worktrees isolate repository changes, but are not an OS security
sandbox for arbitrary host code or verification commands.

The source must be the clean physical Git toplevel, including no ignored or
untracked entries. Use state and sandbox directories outside that source.
`sandboxRoot` is optional; a supplied directory must exist and satisfy the
existing worktree checks. Top-level options are captured when the function is
called; the existing synchronous preflight validates and snapshots verification,
criteria and loop limits before allocating the worker. The two worker tools
remain `sparkle_read_file` and `sparkle_write_file`.

| Input / result | Meaning |
|---|---|
| `verification` | Required host command and optional string args, trusted descriptor and exit-code policies; existing native checks remain in force |
| `acceptanceCriteria` | Optional host-authored requirement definitions; descriptive checks are not executable authority or per-criterion verdicts |
| Default limits | One worker attempt; no repair loop metadata or extra orchestration calls |
| `maxAttempts` | Optional integer 1–5; repair reuses the same candidate after a qualifying failed host check |
| `maxWallTimeMs` | Optional cooperative cancellation deadline, 1–1,800,000 ms; opting into loop limits defaults to `min(maxAttempts × 360000, 1800000)` |
| `signal` | Optional host cancellation; the factory and executor must cooperate |
| `candidatePath` | Retained detached Git worktree after success or a completed failed/cancelled run |
| `artifact`, `runId` | Existing persisted evidence, readable after function shutdown |
| `acceptance.accepted` | Host verification accepted this candidate; it does not apply source edits or accept a queue work item |
| `effectsSettled: false` | Stop and reconcile effects; do not reuse, replay or accept the candidate on this result |

To opt into bounded repair, add `maxAttempts: 3` and optionally
`maxWallTimeMs: 600_000`. The factory then receives the frozen attempt number
and bounded prior host-check feedback. Spawn errors, uncertain cleanup,
cancellation, unavailable verification and unchanged failed candidate bytes do
not authorize continued repair. See [bounded native development](native-development-loop.md)
for the underlying limit and evidence contracts.

A pre-execution refusal throws and may have no run or retained candidate.
Once execution has produced a result, shutdown retains its candidate and
artifacts, including failed checks and uncertain effects. Inspect those facts
before taking another action. The wrapper does not resume crashed tasks, apply
changes or coordinate concurrent writers. Process containment, especially on
Windows, remains subject to the [M0 migration](architecture-migration.md#2-m0-基线与进程所有权)
qualification limits. The wrapper adds no durable queue or third completion
state; existing run events and native artifacts remain the records.

The focused offline integration suite uses real temporary Git repositories and
scripted executors, with no provider credentials:

```sh
pnpm test -- --test-concurrency=1 test/integration/development/start-task.test.ts
```

Implementation plan and verification: [M1-A task record](superpowers/plans/2026-10-17-direct-development-task.md).
Controlled list/search/range/patch tools, task-local context selection, stable
SDK exports and packaged external consumers remain separate migration work.
