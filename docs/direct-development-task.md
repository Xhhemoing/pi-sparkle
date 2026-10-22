# Direct development task (experimental host entry)

`startDevelopmentTask` runs one isolated development task with the existing
`NativeWriteSession`. The host supplies a clean Git source repository, objective,
executor factory and verification command. A project queue, monetary limit,
planner and reviewer are not required inputs. The function owns its session and
always awaits shutdown before returning or propagating a preflight error.

The next bounded host continuation adds an experimental [conversation session and
task presentation](conversation-host.md); its actual verification state is
recorded separately from the original M1 task entry.

This is the first bounded M1 slice under [ADR-009](decisions/0009-lightweight-adaptive-framework.md),
not a stable package SDK export. The runnable Pi example supplies the actual
adapter assembly, keeps the five host-scoped file tools, and waits for invocation
telemetry writes before returning. From this repository, run:

```powershell
$ErrorActionPreference = 'Stop'
pnpm exec tsx examples/direct-development-task.ts --source C:/work/clean-source --state-root C:/work/pi-state --sandbox-root C:/work/candidates --objective "Implement the declared behavior" --model provider/model --checker node --checker-arg=checks/accept.cjs --max-wall-time-ms 300000
```

Use an existing sandbox directory and a clean source repository. The explicit
`provider/model` uses provider definitions and credentials in the supplied state
root (and the provider's normal credential environment). For custom providers,
configure their `envVar` and provide that environment variable. The executable does not
select an alternative model. Repeat `--checker-arg=<arg>` to pass separate checker
arguments; the checker runs in the candidate directory. SIGINT/SIGTERM request
cooperative cancellation; the 300-second default deadline is also cooperative,
so cleanup can exceed it. A nonzero exit means the candidate was not accepted.
The JSON result contains retained candidate and evidence paths, including for
completed failed or cancelled runs.

An embedding host running TypeScript can use the same tested example function:

```ts
import { runDirectDevelopmentTask } from "./examples/direct-development-task.js";

const result = await runDirectDevelopmentTask({
  stateRoot: "C:/work/pi-state",
  sandboxRoot: "C:/work/candidates",
  sourceRepo: "C:/work/clean-source",
  objective: "Implement the declared behavior",
  verification: { command: "node", args: ["checks/accept.cjs"] },
  pi: { providerId: "provider", modelId: "model" },
  maxWallTimeMs: 300_000,
});

console.log(result.status, result.reason, result.candidatePath, result.artifact);
```

Replace the example paths/model/checker with your host-owned configuration.
The lower-level `startDevelopmentTask` still accepts an `executorFactory` returning
the existing `AgentExecutor` contract. The CLI and example share
`createDevelopmentPiExecutorFactory` from `src/pi-adapter/development-executor.ts`:
it preserves supplied candidate-scoped tool objects, combines the native invocation
collector with an optional configured callback, and introduces no command tools,
environment selection, routing or implicit fallback. The example owns its durable
sink (or accepts an explicit `invocationSink`) and awaits pending writes. A host may
pass an `AbortSignal` as `signal` for cancellation. The host chooses verification;
worker output and repair feedback do not grant command authority.
If an explicit sink throws or rejects, the example drains all pending writes and
reports an `AggregateError` whose `cause` holds the retained task result. An
original task exception remains the primary error.
Candidate worktrees isolate repository changes, but are not an OS security
sandbox for arbitrary host code or verification commands.

The source must be the clean physical Git toplevel, including no ignored or
untracked entries. Use state and sandbox directories outside that source.
`sandboxRoot` is optional; a supplied directory must exist and satisfy the
existing worktree checks. Top-level options are captured when the function is
called; the existing synchronous preflight validates and snapshots verification,
criteria and loop limits before allocating the worker. The worker receives candidate-scoped file tools. The command tool is excluded;
verification commands remain host-owned.

| Tool | Behavior |
|---|---|
| `sparkle_list_files` | Optional `path` and `limit`; deterministic lexical traversal; returns relative file `paths` and `truncated` |
| `sparkle_search_files` | Literal single-line `query`, optional `path`/`limit`; returns `{path,line,text}` matches and `truncated` |
| `sparkle_read_file` | Existing whole read, or optional one-based inclusive `startLine`/`endLine`; original line endings retained |
| `sparkle_patch_file` | Existing UTF-8 file, nonempty `oldText` occurring exactly once, and `newText`; ambiguity/missing text refuses before mutation |
| `sparkle_write_file` | Existing full-file creation/replacement behavior |

Discovery skips `.git`, `node_modules`, `.agent_workspace` and traversal symlinks.
Explicit reads retain the existing path permissions; traversal never follows an
external link. List/search default to 200 results, hard maximum 1000. Discovery
visits at most 10,001 entries (including an overflow sentinel), depth 64 and
4 KiB paths; an overfull directory is omitted entirely and disclosed. Search
scans at most 16 MiB, skips oversized/binary files visibly, and bounds each match
snippet/query to 4 KiB. Returned path/text payloads total at most 1 MiB; JSON
framing/escaping adds overhead. `truncated` means completeness was not established,
including reaching the result cap; narrow the path/query to investigate further.

Whole reads and exact patch input/result files have a 1 MiB ceiling; the host
may lower `maxReadBytes`. Range reads may excerpt a larger file, scan at most
16 MiB and emit at most the read ceiling. Ranges exceeding these bounds fail
explicitly; `totalLines` is reported only if EOF was reached. No fuzzy patch or
automatic whole-file fallback is performed. Exact patch is for the candidate's
single writer; independent external edits still require ownership coordination,
and file I/O failure can leave partial changes for inspection. Path checks are
best-effort containment, not an OS sandbox or crash-atomic filesystem transaction.

The same tools reach strict `develop` Pi workers through the existing host
closures. Both write and patch must pass the controller's allowed-scope and
protected-verifier checks before editing; discovery does not grant write authority.

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
pnpm test -- --test-concurrency=1 test/integration/development/start-task.test.ts test/integration/development/pi-host.test.ts
```

The Pi host tests use a real local HTTP provider fixture and real file tools,
with independent acceptance/rejection, cancellation and invocation-sink flushing.
They make no live provider calls. Current work: [active task plan](../tasks/plan.md).
Historical implementation: [M1-A task record](superpowers/plans/2026-10-17-direct-development-task.md).
M1-B implementation and current checks: [latest direction plan](superpowers/plans/2026-10-18-direction-completion.md)
and [verification](reports/2026-10-18-direction-completion.md). Task-local context
selection is described below; SDK exports and packaged consumers have separate migration evidence.

## Select task-local source context

The host may add `taskContext` to the input above:

```ts
// sourceRevision is the clean source repository's current Git HEAD.
const taskContext = {
  requiredFiles: ["src/example.ts"],
  relatedFiles: ["src/example.test.ts"],
  expectedSourceRevision: sourceRevision,
  tokenBudget: 8000,
};
```

Pass this object as `startDevelopmentTask({ ...hostTask, taskContext })`, using
an otherwise valid host task as shown above. The input is copied synchronously.
The session reads selected files from its candidate before creating the executor;
`executorFactory` receives the resulting `preparedContext`. The same rendered
context reaches the actual worker prompt. A repair reads the candidate again,
so prior edits appear in its next context.

`requiredFiles` must be readable in full, valid UTF-8, candidate-relative and
within the configured context budget. Missing, stale, escaping or oversized
mandatory context fails explicitly before dispatch; it is never silently trimmed.
After an earlier attempt, a context failure retains that attempt's candidate and
evidence and stops without allocating another worker or invoking the checker.

`relatedFiles` are optional and selected in lexical order. `omissions` reports
`token-budget`, `byte-limit` or `unavailable`. At most 32 selected files and 64 KiB
of source are admitted, with an 8 KiB per-related-file bound. The token budget
is an integer from 1 to 32,768, measured by the existing deterministic estimator
over objective and rendered context; it is not a limit on the entire provider
prompt. Objective and acceptance metadata are retained in this admission.

The returned CodeMap contains honest file/module entries for admitted related
files; it does not claim parsed symbols or semantic calls. Revision identifies
the candidate's initial Git base, not unchanged current bytes. File contents are
labeled untrusted data and grant no tool or verification authority. `.git`,
`node_modules`, `.agent_workspace`, path traversal and escaping aliases are
excluded. Conversation-host registration accepts this same host-only input and
snapshots it; model requests cannot supply their own context selection.

M1-C implementation and verification are recorded in the
[staged continuation report](reports/2026-10-19-staged-continuation.md), including
actual final-prompt tests and the separately authorized two-case provider smoke.
