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

## Opt into static model selection

The exported host function also accepts `staticRouting`; the command-line example
continues to use its explicit `--model`. Supply a host-owned catalog and policy:

```ts
const staticRouting = {
  catalog: hostCatalog,
  modelPolicy: { allowedModels: ["provider/small", "provider/large"] },
  inputTokenReserve: 2048,
  outputTokens: 1024,
  privacyRequired: "cloud-approved" as const,
  requiredCapabilities: ["tool-use"],
};
// Add staticRouting to the runDirectDevelopmentTask input above.
```

`hostCatalog` uses the existing `ModelRouterConfig` shape. Every model must declare
its canonical `provider/model` id, matching provider, version, roles, maximum
complexity, capabilities, provider policy, privacy class, context window, maximum
output tokens, input/output prices, latency and fixed cost/duration estimates.
Missing or nonfinite metadata is refused rather than replaced with defaults.
Explicit zero prices are allowed; unknown prices are not zero. Populate metadata
from sources the host has verified. `preferredModel` is an optional preference;
a singleton `allowedModels` list is the strict pin.

The host analyzes the original objective, retaining inferred risk, capability
and privacy requirements. An approved routing resource for the canonical source
project is read once and applied within the host allow-list, with its observed
version included in `MODEL_ROUTED`. Repairs retain that model and resource
version; later logical tasks read the current resource. Missing legacy provenance
remains unknown. A route requiring human approval refuses before model dispatch;
this entry does not add an approval workflow.

Each attempt checks the current formatted prompt, reserved overhead and output
against the selected model's capacity, and estimated latency against remaining
time. The actual grounded executor request is checked again before dispatch.
This is a character-based estimate, not an exact tokenizer, enforced generation
limit or guarantee that the provider will accept the request. Catalog prices
and estimates support selection and diagnostics; this option creates no monetary
cap or total-cost guarantee.

Insufficient capacity, cancellation or provider failure never upgrades or switches
the selected model. Routed calls disable alias redirection and configured fallback
models. An explicit API key for a different original provider is omitted, so the
selected provider uses its own existing credentials. Ordinary fixed model calls
retain their existing behavior.

## Candidate and tool boundaries

Candidate worktrees isolate repository changes, but are not an OS security
sandbox for arbitrary host code or verification commands.

For a bounded subtask inside a larger project, the host can use this same entry
with one Pi worker; a separate project queue or recursive planner is unnecessary.
Choose this path when the objective, permitted edits and independent check are
already clear. Task size does not waive authorization or verification. The
`sparkle_delegate` extension remains a read-only inspection/review tool.

When the structured task result is the worker's complete handoff, a host using
`createConfiguredPiExecutor` may explicitly set `stopAfterTaskResult: true` in
its executor factory. This skips the additional model response after a valid
report. The whole report turn, including its tools and usage, still completes;
the host then performs the usual independent candidate check. An invalid report
does not stop execution, and a report never proves acceptance by itself. The
option defaults to off. If the execution has accepted steering, it keeps normal
continuation so the correction reaches the worker; cost limits and cancellation
still apply. Put the complete findings and unresolved work in the report rather
than relying on a later prose response. This is an experimental host option,
not automatic task classification or a new writable extension tool.

`PiAgentExecutor` uses Pi's core agent loop; it does not automatically load the
Coding SDK's system prompt, project context or skills. For a host that needs the
same coding instructions as a direct Pi session, construct a Pi Coding SDK
session with the same candidate directory, registered tools and resource-loader
settings, read its public `session.systemPrompt`, dispose it without calling
`prompt`, and pass that text through `createConfiguredPiExecutor({ systemPrompt,
... })`. Keep this preparation inside measured setup time when comparing paths.
Do not copy another candidate's working directory or import private SDK prompt
builders. Actual registered tool schemas determine callable operations; role
profiles are not an executable tool inventory. This configuration aligns coding
instructions, but the native task-result protocol and host acceptance still
differ from a direct SDK session and must be measured separately.

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
| `maxWallTimeMs` | Optional cooperative cancellation deadline, 1–1,800,000 ms; opting into loop limits defaults to `min(maxAttempts × 360000, 1800000)`. An explicit value also bounds the worker; the overall timer includes setup, all attempts and verification and never renews. Without an explicit value, the worker keeps its 300,000 ms default. |
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

## Capture offline routing data

The experimental `src/learning/host-routing-dataset.ts` entry captures an
allowlisted task/candidate declaration before execution, then projects the
original host observation through `prepareHostAttribution`. It does not change
model selection, acceptance or resource promotion.

```ts
const captured = await runHostRoutingCase({
  declaration: {
    caseId: "parser-case-01-small",
    problemId: "parser-case-01",
    templateId: "parser-boundary-v1",
    predecision: {
      taskFamily: "coding",
      features: { estimatedInputTokens: 1200, needsTools: true },
    },
    candidate: {
      candidateId: "small-effort-low",
      provider: "configured-provider",
      model: "configured-model",
      modelVersion: "provider-pinned-version",
      effort: "low",
      toolProfileId: "scoped-files-v1",
      maxAttempts: 2,
      maxWallTimeMs: 300000,
    },
  },
  execute: () => runDirectDevelopmentTask(hostTask),
});
const dataset = prepareHostRoutingDataset({
  cases: [captured],
  evidenceMode: "observed",
  cutoff: evaluationCutoff,
});
```

Import the two functions from the experimental entry. `hostTask` must supply
its host-owned evaluator and checker, configured executor and bounded source
scope as above. The declaration must describe that actual configuration.
This wrapper does not configure the executor from a candidate declaration.
The CLI `--checker` alone does not supply a model-quality evaluator; do not
infer model-failure exit codes from an arbitrary command.

Only original in-process captures and observations supply labels. Declared
provider/model/version must match the invocation evidence; unknown actual
versions stay unknown. Effort, tool profile, limits, family and numeric/boolean
features remain host declarations, not invocation-verified facts. Use short
non-sensitive IDs and feature names: the allowlist prevents arbitrary payloads,
not secrets accidentally placed inside a permitted string. Raw objectives,
answers, checker output, credentials and source paths are not dataset fields.

Each logical task contributes one final label, with all repair attempts and
reported usage retained. An independently evaluated failure is a negative label;
unavailable evidence is excluded, not relabeled as failure. Cost summaries
cover recorded usage at snapshot prices, not a provider bill. Unknown prices or
usage are not zero, and invocation-latency sums are not end-to-end task latency.
Cases sharing a problem **or** template belong to one connected group. A group
crossing the time cutoff is excluded from both training and test. The host owns
these semantic IDs; the exporter cannot detect undeclared near duplicates.

The JSON projection can be saved for offline analysis. It has no reader that
restores host authority, and parsing it does not create promotion evidence.
Historical task-result claims cannot be retroactively upgraded by this path.
For a zero-provider-cost executable example using only a synthetic repository:

```sh
pnpm exec tsx examples/host-routing-dataset.ts
```

The example writes its JSON below `.agent_workspace/` and prints a compact
summary. It executes success, checked failure, repaired success, provider error and unavailable
version scenarios through real native sessions and a host checker. Its scripted
executors are explicitly `faux`: those outputs test the data path, not model
quality, neural-router accuracy or cost savings. Real paired comparisons still
need chosen usable model configurations, a bounded budget, common tasks/checkers
and independent evaluation before training or adoption.
