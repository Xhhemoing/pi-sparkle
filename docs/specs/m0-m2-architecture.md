# Architecture Specification: M0-M2 Runtime

## Status

Implemented as the **runtime spine** under Developer Preview. This document is
the design target that M0–M2.5 were built against. It does **not** mean the
CLI is production-ready.

See [status-matrix.md](../status-matrix.md) for Present / Wired / Exercised /
Outcome-supported. Fake-executor `run` / `inspect` / `resume` / `--flowchart` /
`--children` are Wired and Exercised. Real providers and adaptive outcomes are
not.

> Round 15 sole docs-slot working-tree census (2026-08-25 02:15:43 UTC): HEAD
> was `3793ea4`, with a clean tree and no sibling landing in flight. Round 14's
> landings are committed: `25a3c2f` adds the scoped laundering coda at
> `replay.ts:95-101` (the mechanics at `:85-93` are unchanged) and, as a
> ride-along, retires the spent pointer in `option-a-preconditions.test.ts`;
> `a1ea5f2` is the Round 13 docs truth-up. The hazard is bounded to a node
> neither source records. A recorded node's substituted spec is restored before
> the resumed node runs, while an unvouched logged-empty is detectable as
> unknown, not the caller's known-none.
> The `:89-91` counterfactual remains motivation prose bounded by the coda, not
> a current-state bug. ADR-006 remains Proposed. This census is current at HEAD
> because no sibling is in flight. Subsequent rounds need a new census note
> only when a landing changes what these surfaces describe.

## Milestone names

This document's **M0–M2** are the runtime execution spine (CLI, events, children, DAG/flowchart supervisor). The adaptive work-loop spec's **M3–M6** are the adaptive library plane (episode review, R0/R1 routing, preferences, promotion). They are not later stages of the same CLI product line.

Runtime **M2.5** is flowchart-as-public-orchestrator (`--flowchart`). Since
M2.5 the CLI `--children` path compiles its child spec through
`compileChildrenToFlowchart` and executes it on the flowchart engine; the
child coordinator preserves the M1 parent/child protocol semantics inside
that run, and the original M1 entry `startParentRun` is a library/test-only
path (corrected 2026-08-24 — this paragraph previously claimed the compiler
was not the live `--children` path). `--flowchart` may take
`--executor fake|pi` to run leased nodes; `--results` remains the explicit
override. Topology, R1, and bandit must not attach to the live run loop until
Checkpoint F. Web UI remains last.
`pi-sparkle doctor` exists as a developer-preview diagnostic. Its `--json`
output contract (`DoctorJsonReport`) is frozen additive-only; doctor itself
remains a preview capability, not a production one. Doctor recursively
inventories `*.lock` files below the state root and reports metadata validity,
age/source, recorded PID, and advisory PID liveness in prose and in the
additive `locks` JSON field. Every lock entry includes conservative
`remediation`: a recorded dead PID says to inspect and remove manually, never
automatically; liveness and age do not prove staleness. Additive `runStates`
lists PLANNING/RUNNING logs with age and inspect/resume/delete guidance. Those
are advisory crash candidates because another process may still own the run.
Frozen-additive `learnedState` inventories every discovered project-key
`bandit.json`, plus `preferences.json` and `catalog-observed.json`. Entries
carry `kind`, learned/derived `stateClass`, `projectKey`, `path`,
present/absent/readable/damaged `status`, and plane-correct `remediation`;
the inventory also carries `advisory` and `scanErrors`. Typed snapshot damage
is advisory, and only inventory scan/read errors fail
`learned-state-inventory`; doctor never repairs, moves, deletes, or rebuilds
these files. The `lock-inventory` and `run-state-inventory` checks fail on
their respective scan errors. Doctor never changes run state and never
acquires, steals, or deletes a lock.

`inspect --run --summary-json` emits one `INSPECT_SUMMARY` object with exactly
`type`, `runId`, `status`, and `requiredEvidence`. This non-event contract is
frozen additive: those keys do not change or disappear, any addition must
update the exact-shape pins, and `INSPECT_SUMMARY` stays outside the domain
`Event` union. `inspect --run --json` remains a pure event NDJSON stream.

When a command fails with the frozen `LOCK_TIMEOUT` or
`RUN_RECORDS_SURVIVED` code, its `next:` line routes to
`pi-sparkle doctor --json --state-root <the failing command's root>` and names
the answering `locks[]` and/or `runStates[]` inventory. The frozen route map
has three adaptation-plane entries naming `learnedState[]`:
`BANDIT_STATE_UNREADABLE` says repair or move aside to relearn the project from zero,
`PREFERENCE_SNAPSHOT_UNREADABLE` says repair or move aside to start from an
empty store, and `CATALOG_OBSERVED_CORRUPT` identifies derived state that may
be deleted and rebuilt from `runtime/invocations.jsonl`. This is code-based
classification through a depth-bounded `cause` walk, not message matching;
all other failures keep the generic `next:`. The catalog route is
defense-in-depth for a future command producer: no CLI producer exists today,
and doctor, the only command-path reader, absorbs the typed error into
`learnedState` instead of propagating it.

## Objective

Build `pi-sparkle` as a local, project-scoped, TypeScript runtime for multi-agent software-development work. A run must be inspectable, bounded, cancellable, resumable, and backed by evidence rather than a final-text-only transcript.

Success for M0-M2 is a CLI workflow that can:

1. Discover a project and record the relevant local instructions and commands.
2. Create a run with a durable event stream.
3. Execute one Pi-backed worker (M0).
4. Execute bounded child runs that report structured progress and results to a parent (M1).
5. Execute and resume a validated dependency graph under a supervisor with explicit limits (M2).

## Non-goals

M0-M2 do not provide:

- Learned model-quality scoring, automatic provider selection, or online model training.
- A web user interface, remote worker fleet, or distributed scheduler.
- Unattended commits, pushes, merges, deletes, or workspace resets.
- A security sandbox. Pi tools and extensions retain the operating-system permissions of their process.
- Automatic repair of router, policy, credentials, or global harness configuration.
- Cross-project memory beyond a run's persisted records.

## Design Principles

- **Run graph over prompt chain:** tasks and dependencies are first-class persisted state.
- **Contracts over prose:** agents exchange validated messages and result envelopes, not implicit text conventions.
- **Evidence before inference:** claims about progress, tests, changes, or failures reference recorded events and artifacts.
- **Bounded autonomy:** runs enforce maximum tasks, concurrency, attempts, rounds, elapsed time, and cost where provider accounting is available.
- **Adapter isolation:** Pi-specific types stay behind one package boundary.
- **External security boundary:** tool permissions come from the host sandbox/process policy, not an agent prompt.

## Tech Stack

M0 implementation choices to be confirmed in its bootstrap task:

- Runtime: supported Node.js LTS and TypeScript with strict compiler settings.
- Package manager: `pnpm`, chosen for deterministic workspace handling.
- CLI: a lightweight Node.js command parser selected during M0 bootstrap.
- Validation: a runtime schema library selected once and used for all persisted/external data.
- Persistence: local JSONL event files plus atomic JSON checkpoint files. SQLite is deferred until a concrete query/concurrency need is demonstrated.
- Agent kernel: version-pinned `@earendil-works/pi-agent-core`, accessed only through `src/pi-adapter/`.

### Source boundary

Pi agent-core's current public README documents `Agent`, event subscriptions, `AbortSignal`, steering/follow-up queues, tool lifecycle hooks, per-tool parallel/sequential execution, and optional session backends. These are integration primitives, not pi-sparkle state models.

Sources:

- https://github.com/earendil-works/pi/tree/main/packages/agent
- https://github.com/earendil-works/pi/tree/main/packages/coding-agent

## Runtime Model

```text
CLI command
  -> Project discovery
  -> Run coordinator
       -> Event store
       -> Checkpoint store
       -> Task graph (M2)
       -> Agent registry (M1)
       -> Pi adapter
            -> Pi Agent
                 -> model provider and allowed tools
```

### Project

A project is a discovered local workspace, not a hosted account. Discovery must identify the requested root, Git root when available, known instruction files, package/runtime manifests, and candidate commands. It must record evidence paths rather than silently treat guesses as facts.

```ts
interface ProjectSnapshot {
  id: ProjectId;
  rootPath: string;
  gitRootPath?: string;
  discoveredAt: IsoTimestamp;
  instructionFiles: DiscoveredFile[];
  manifests: DiscoveredFile[];
  commands: DetectedCommand[];
  facts: ProjectFact[];
}
```

### Run

A run has one project snapshot and one root task. A child run always retains its parent run ID and parent task ID.

```ts
type RunStatus =
  | "PLANNING"
  | "RUNNING"
  | "WAITING_FOR_USER"
  | "PAUSED"
  | "BLOCKED"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

interface Run {
  id: RunId;
  projectId: ProjectId;
  parentRunId?: RunId;
  rootTaskId: TaskId;
  status: RunStatus;
  limits: RunLimits;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

interface RunLimits {
  maxTasks: number;
  maxConcurrentTasks: number;
  maxAttemptsPerTask: number;
  maxRounds: number;
  maxConsecutiveStalls: number;
  maxWallTimeMs: number;
  maxCostUsd?: number;
}
```

Round 12 commit `b65a8b1` freezes those exact eight `RunStatus` members; adding
a terminal or non-terminal status is a separate contract change.

### Task graph

M2 adds a directed acyclic graph. The system must validate an empty graph,
missing dependencies, self-dependencies, duplicate IDs, and cycles before any
worker starts. `validateTaskGraph([])` is a synchronous preflight refusal:
it occurs before the run lock and every event/checkpoint write, so an empty
input leaves no durable run record. The live supervised DAG produces the
transitions below.

```text
PENDING -> READY -> RUNNING -> COMPLETED
                    |
                    v
                 BLOCKED -> READY
                    |
                    v
                  FAILED

PENDING | READY | RUNNING | BLOCKED -> CANCELLED
```

The scheduler treats a dependency as satisfied when its persisted status is
`COMPLETED` or `SKIPPED`. The `TaskStatus` vocabulary and readiness decoder
retain `SKIPPED` compatibility, but the supervised DAG plane has no skip
producer or declared skip operation; the former `applySkipped` rule was
removed. Current DAG runs therefore satisfy dependencies through
`COMPLETED`. Flowchart `SKIPPED` states are a separate plane and do not create
DAG task transitions.

A task is leased to exactly one worker at a time. The in-memory registry does
not expire or reclaim a lease when its descriptive `expiresAt` timestamp
passes; active work remains leased until its owner releases it. On process
restart, supervised resume rebuilds leases for still-`RUNNING` tasks from
`TASK_LEASED` events and immediately recovers them as orphaned because their
workers did not survive. That recovery currently records the historically
named `TASK_LEASE_EXPIRED` event and applies the timeout/retry transition, but
wall-clock expiry is not its trigger. Per-attempt `timeoutMs` and child
`maxWallTimeMs`, rather than lease expiry, bound active child work.

```ts
interface TaskNode {
  id: TaskId;
  title: string;
  objective: string;
  role: AgentRole;
  dependencies: TaskId[];
  acceptanceCriteria: AcceptanceCriterion[];
  status: TaskStatus;
  attempt: number;
  maxAttempts: number;
  timeoutMs: number;
  assignedRunId?: RunId;
  artifactIds: ArtifactId[];
  evidenceIds: EvidenceId[];
}
```

## Agent Model

Logical roles are distinct from a concrete model or process. M0 supports one `worker` profile. M1 adds `scout`, `planner`, `implementer`, `reviewer`, `tester`, and `debugger` profiles without requiring all of them in a run.

```ts
interface AgentProfile {
  id: AgentProfileId;
  role: AgentRole;
  systemInstruction: string;
  allowedToolNames: string[];
  canWriteWorkspace: boolean;
  canDelegate: boolean;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
}
```

The router is deliberately out of scope through M2. Each profile refers to an explicit configuration-selected model. A future router may choose a model, but it must record both selection constraints and justification as a route event.

## Parent-Child Protocol

M1 messages are persisted protocol envelopes. The protocol version is mandatory. Content fields that cross the boundary are validated before the coordinator changes run/task state.

```ts
type AgentMessage =
  | TaskRequest
  | ProgressUpdate
  | AgentQuestion
  | TaskResult;

interface MessageBase {
  protocolVersion: 1;
  id: MessageId;
  occurredAt: IsoTimestamp;
  runId: RunId;
  taskId: TaskId;
  from: AgentInstanceId;
  to: AgentInstanceId | "SUPERVISOR";
}

interface ChildRunLimits {
  maxAttempts: number;
  timeoutMs: number;
  maxWallTimeMs: number;
  maxCostUsd?: number;
}

interface TaskRequest extends MessageBase {
  type: "TASK_REQUEST";
  objective: string;
  inputArtifactIds: ArtifactId[];
  acceptanceCriteria: AcceptanceCriterion[];
  limits: ChildRunLimits;
}

interface ProgressUpdate extends MessageBase {
  type: "PROGRESS";
  status: "STARTED" | "WORKING" | "WAITING" | "BLOCKED";
  summary: string;
  evidenceIds: EvidenceId[];
  blocker?: Blocker;
}

interface AgentQuestion extends MessageBase {
  type: "QUESTION";
  question: string;
  options?: string[];
}

interface TaskResult extends MessageBase {
  type: "TASK_RESULT";
  outcome: "SUCCESS" | "PARTIAL" | "FAILURE" | "CANCELLED";
  summary: string;
  artifactIds: ArtifactId[];
  evidenceIds: EvidenceId[];
  verification: VerificationResult;
  failure?: FailureClassification;
}
```

An agent may emit many progress messages but exactly one terminal `TASK_RESULT`. The coordinator rejects terminal messages from an unleased agent, unknown task IDs, invalid artifact references, and illegal status transitions.

### Cancellation, questions, and child limits

- Parent cancellation propagates an `AbortSignal` through each child adapter and persists `RUN_CANCEL_REQUESTED` before waiting for child settlement.
- A child may request a user decision with `QUESTION`. The parent transitions to `WAITING_FOR_USER`; it may not invent a reply or resume automatically.
- `maxAttempts` caps the child coordinator's attempt loop. `timeoutMs` is a
  per-attempt deadline; expiry aborts that attempt, records `TASK_TIMEOUT`, and
  may retry while attempts remain.
- `maxWallTimeMs` is an enforced deadline across the child attempt/retry loop.
  Expiry aborts an active attempt and deadline-driven termination yields a
  `TIMEOUT` outcome even when the per-attempt deadline has not elapsed. A
  terminal result or protocol violation that still arrives keeps its own
  outcome.
- `maxCostUsd` is validated as a positive protocol field when present. The child
  coordinator forwards the tighter of it and the run-level ceiling to the
  selected executor on the execution request and stamps that effective cap into
  the child's `RUN_CREATED.limits`. `PiAgentExecutor` prices observed turn usage
  from the resolved model catalog and stops before another provider turn once
  the ceiling is reached; an executor that cannot price its own spend leaves the
  ceiling unenforced rather than inventing a dollar figure, so this stays a
  best-effort per-execution cap, not a cross-child run ledger.

On flowchart resume, a node whose parent log contains a `TASK_REQUEST` runs
under that recorded spec. Objective, input artifacts, acceptance criteria, and
child limits come from the request; the role-bearing assignment
`MODEL_ROUTED` restores the agent role, assigned model, and cascade; dependencies
come from the checkpointed edges. A node without a logged request retains empty
artifacts and receives a substituted budget: the earliest logged sibling's
`maxAttempts`, `timeoutMs`, and `maxWallTimeMs`, or the run's declared per-task
limits when there is no sibling. The substitution carries no `maxCostUsd` from
either source — a sibling's ceiling authorizes that sibling's spend and says
nothing about this node, so an absent cap stays absent rather than becoming an
invented one on the node's `TASK_REQUEST.limits`, its child `RUN_CREATED.limits`,
and its execution request. A ceiling the node's own caller declared is restored
from the durable `FlowchartCheckpointState.taskCostCeilings` record when that
record names the node; when neither the log nor the record names it, the node
resumes with no per-task ceiling. Its acceptance criteria come from the durable
task record when that record names the node; otherwise they remain
empty/unknown. Request reconstruction is stable across repeated resumes
because the latest request per task wins.
Round 11 added the validated optional
`FlowchartCheckpointState.taskCriteria?` seam; Round 12 filled it in `81f5b81`.
Its three sources are caller specs at start, non-empty logged `TASK_REQUEST`s on
checkpoint writes, and the checkpoint's existing record on restore. Entries
are ordered by `taskId` and written monotonically first-write-wins. Empty
logged requests are ignored because they cannot distinguish a real known-none
request from a substituted re-dispatch; only the caller's own empty spec
records known-none. Absence remains unknown. The reader fills only substituted
specs, and a logged request retains its own answer. There is deliberately no
`FlowchartContinuation.taskCriteria`: a continuation cannot re-answer a
durable dispatch fact. The runtime never synthesizes the record from the
episode, flowchart definition, or run contract. The carriage property
`d592f8c` and writer-existence guard `0e61063` prevent checkpoint writers from
dropping the field or silently removing its last writer. Commit `f6e4c04`
corrected the two stale source comments to describe this shipped writer.
Commit `e7d018c` closes the two remaining behavioural persistence gaps. A
caller-recorded known-none entry survives the unblock reopen and the resume's
own checkpoint write when read back from disk. For a valid legacy checkpoint
with the field stripped, resume recovers non-empty logged criteria only: the
substituted node re-dispatches with no criteria, logs `[]`, and stays absent
from the record. That visible legacy cost is recorded rather than hidden.

`FlowchartContinuation.contract` is an optional, honoured resume seam: a caller
that supplies it gets the same child grounding and assessment as start. The
run requirement contract is also durable as optional
`FlowchartCheckpointState.contract?` without changing checkpoint
`schemaVersion: 1`; absence remains valid for old and contract-less runs.
Checkpoint validation, every flowchart-checkpoint writer, pause/inject
restoration, and both CLI continuation paths preserve it. Resume uses an
explicit continuation contract first and otherwise recovers the checkpointed
value. The runtime never synthesizes a contract from the episode, from
per-task acceptance criteria, or as an empty `{ constraints: [] }` value.
Round 10's recursive AST source pin requires every `materializeCheckpoint`
call with a flowchart payload to carry `contract`; it deliberately enforces a
property rather than freezing the writer count. Its complementary source-wide
episode-reader census rejects construction of `contract`, `constraints`, or
`acceptanceCriteria` and references to `RequirementContract`; episode
acceptance remains closure metadata, never run-contract authority.

The offline `run --track --assume-defaults --executor fake` path does extract
and persist a contract without a live provider. Round 11 wired the tracked
pause seam: `TrackRunInput.pause` is forwarded to `startFlowchartRun`, and
`runCommand` supplies the file-backed controller. Round 12 commit `81f5b81`
added `onRunStarted`, fired under the run lifecycle lock immediately after
`RUN_CREATED` and before round 1's pause poll; callback failures are swallowed
so notification failure cannot orphan a run before its first checkpoint. The
track path prints `Run <id>: started` while the run is still pausable, and the
pure-CLI track pause proof is complete. Commit `1e78220` added the same
callback output to `--flowchart` and `--children`. All three public run paths
now print the disclosure before the terminal `Run <id>: <status>` line, with
the same id; the disclosure-then-terminal sequence is behaviourally pinned.

### Cluster role-cast dead letters

The process-local cluster mailbox bounds a role's own role-cast mail by claim
opportunities on that role. `claimRole` learns holders by role and skips queued
mail when its sender holds the addressed role; it does not compare only the
sender and claimant instance ids. Production retries mint fresh instance ids,
so role-level skipping is what makes the bound reachable: a self-role-cast
may survive `DEFAULT_MAX_ROLE_REQUEUES` claim opportunities and is dropped on
the next claim of that role. Same-role late delivery is deliberately
unavailable. A cast addressed to a role its sender does not hold is unchanged:
it is delivered to the first claimant of that other role, however late.

When the bound is exceeded, the host exposes the drop through two library
surfaces: `deadLetterReport()` returns mailbox-derived totals, counts by role
and reason, ordered entries, and observer-error count; optional
`onDeadLetter` push notification reports each newly observed drop when an
agent registers. An observer throw is tallied and does not fail registration.
There is no wall-clock TTL or persistence, and a role queue with no later
registration does not advance toward the bound.

At run end both cluster embedders pull the host/mailbox state into
`ClusterMailReport`. When any mail remains, the CLI emits one stderr line:
`warning: cluster role-cast mail undelivered: pending=…, dead-lettered=…`,
including role and reason counts for nonzero groups. Both counters are
production-reachable: `dead-lettered=` records a self-role-cast that crossed
the registration bound, while `pending=` records mail for a role that nobody
claimed before the process-local mailbox disappeared.

## Pi Adapter

Only `src/pi-adapter/` currently imports Pi packages. ADR-006 stays Proposed,
so `extensions/pi-sparkle/` remains unimplemented and unregistered; domain,
learning, adaptation, and CLI modules remain outside the import boundary.
The outbound adapter exposes pi-sparkle-owned interfaces:

```ts
interface AgentExecutor {
  execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent>;
}

interface AgentExecutionRequest {
  runId: RunId;
  taskId: TaskId;
  profile: AgentProfile;
  model: ModelReference;
  prompt: string;
  workingDirectory: string;
}

type ExecutionEvent =
  | { type: "TEXT_DELTA"; text: string }
  // Reasoning progress as a byte count only. Chain-of-thought text never
  // enters the execution stream, so it can never reach the event log.
  | { type: "THINKING_DELTA"; bytes: number }
  | { type: "TOOL_STARTED"; toolCallId: string; toolName: string }
  | { type: "TOOL_FINISHED"; toolCallId: string; isError: boolean; summary: string }
  | { type: "TURN_FINISHED"; usage?: UsageSummary }
  | { type: "MESSAGE"; message: AgentMessage }
  | { type: "EXECUTION_FINISHED"; outcome: "SUCCESS" | "FAILURE" | "CANCELLED" };
```

The authoritative union lives in `src/execution/contract.ts`; this spec mirrors it (corrected 2026-08-24 — this block previously omitted `THINKING_DELTA` and `MESSAGE`). `THINKING_DELTA` carries a size only: the raw reasoning text is read exactly once inside the adapter to measure its UTF-8 byte length and never crosses the adapter boundary, so coordinators can record progress without persisting chain-of-thought. `MESSAGE` carries an already-validated M1 protocol envelope (`AgentMessage`) through the executor stream — executors emit the terminal `TASK_RESULT` this way and the child coordinator consumes it.

The adapter translates Pi events into `ExecutionEvent`; no Pi event shape becomes a public pi-sparkle contract. Tool call input and output are treated as sensitive artifacts: the default event log stores a redactable summary and reference, not arbitrary raw content.

Resume accepts `--primary-model` and `--thinking` for either Pi executor
reconstruction path. These values are not stored in run events or checkpoints:
they configure the executor built for this resume and never imply restoration.
A flagged Pi resume prints a `note:` describing what was requested now; a
flag-free Pi resume warns that defaults were rebuilt. Passing either flag when
resume builds no executor or a non-Pi executor warns that it was ignored. The
disclosure is printed before executor construction, and invalid
`PI_THINKING_LEVEL` values fail with the same validation as `run`.

## Persistence and Audit

### Event store

Each run receives a directory under the configured local data root:

```text
<state-root>/runtime/runs/<run-id>/
  events.jsonl
  checkpoint.json
  artifacts/

<state-root>/runtime/runs/<run-id>.lock
```

Every append-only event has a stable event ID, schema version, run ID, task ID
where relevant, timestamp, actor, event type, and payload. The writer serializes
appends per `EventStore` instance and fsyncs at terminal transitions. Readers
ignore a final incomplete JSONL line created by a process crash and report it as
recovery evidence.

The sidecar is a cooperative run-plane lock. The M0, parent, flowchart, and
supervised start/resume paths acquire it before their first record and hold it
through teardown. Clarification runs do the same for their event, checkpoint,
episode, and questions writes; project discovery is hoisted outside and the
questions write does not nest a second acquisition because the helper is not
reentrant. Start preflight stays outside the lock, so a refused start persists
nothing. Resume must lock before reading records that deletion could remove;
a refused resume of a nonexistent supervised or flowchart run therefore
leaves an empty `runtime/runs/` directory, but no run subtree, lock, or record.

Run deletion takes the same lock across subtree removal and a first
verification, then verifies again after release. `delete --run` and
`delete --episode` accept `--lock-wait-ms <ms>`: omission preserves the 5 s
default, `0` refuses immediately, strict decimal input is capped at 24 h, and
the bound covers every cooperative lock the delete takes (on the `--run` path,
`invocations.jsonl.lock` as well as the run lock). A delete aimed at a live run
waits for teardown up to that bound and otherwise fails with `LOCK_TIMEOUT`
having removed none of the run's own records — but its pre-lock half (the
invocation-log rewrite, or the episode path's feedback strip and tombstones)
has already completed and is not rolled back; the `--run` path discloses that
on stderr, and a re-delete is idempotent. A cross-process pause takes
the same lock and likewise fails closed while the locked run is live, rather
than settling its episode/checkpoint from underneath the driver. `pause`
deliberately has no wait flag because a longer wait can succeed only after the
run has already stopped, when the pause token would be a slow no-op.

Normal teardown releases the owned sidecar. SIGKILL cannot run teardown and
therefore leaves the lock behind. The lock implementation never steals one:
delete, pause, and track-question writes stay blocked until an operator uses
doctor's PID/liveness, age, remediation, and run-state evidence, stops any live
owner, and manually removes a confirmed abandoned lock. The crash-probe case
`sigkill-run-lock-operator-recovery` proves this complete cross-process
posture: the lock records a dead child PID, a bounded delete leaves the run's
own directory byte-identical (the scope the probe snapshots),
doctor reports `pidLiveness: "not-running"` with manual-removal guidance, and
deletion succeeds only after that confirmed abandoned lock is removed.

Event appends and checkpoint writes deliberately do not acquire the sidecar
because measured per-step locking exceeded the end-to-end regression bar. A
direct/out-of-lifecycle writer can therefore recreate records during deletion;
the double verification fails closed with `RUN_RECORDS_SURVIVED`. A write after
the final verification is a new write, so operators should still delete after
termination.

Required M0 event types:

```text
PROJECT_DISCOVERED
RUN_CREATED
RUN_STARTED
AGENT_STARTED
AGENT_EVENT
AGENT_FINISHED
RUN_COMPLETED
RUN_FAILED
RUN_CANCEL_REQUESTED
```

M1 adds child lifecycle and message events. M2 adds graph, lease, supervisor, retry, stall, and checkpoint events.

### Checkpoints

`checkpoint.json` is an atomically replaced materialized view. Its base fields
carry the run and project snapshots when present, overall status, agent
outcomes, the last durable event ID, and update time. A flowchart checkpoint
also carries the flowchart definition, validated supervisor snapshot (including
node statuses and its ledger), limits required for flowchart resume, and the
optional run requirement contract. Production flowchart resume projects that
validated contract into `FlowchartContinuation`; pause and injection preserve
the same field when they rewrite the checkpoint. The checkpoint still does
**not** contain the M2 DAG supervisor's active leases. Its validated optional
`taskCriteria` record is now populated by the three Round 12 sources described
above and carried by every flowchart-checkpoint writer. Absence remains unknown
rather than being rewritten as known-none; an empty logged request is ignored,
while an empty caller spec is durable known-none. Supervised DAG resume
reconstructs its graph, task statuses, attempts, ledger, and leases from the
event log, including `TASK_LEASED`; a reconstructed lease for a still-running
task is recovered as orphaned because no worker survives process restart.

`catalog-observed.json` and `preferences.json` also publish by atomic
replacement, but their recovery contracts differ. Invalid catalog JSON throws
`CATALOG_OBSERVED_CORRUPT`; the snapshot is derived from
`runtime/invocations.jsonl` and can be rebuilt. Invalid preference JSON or
snapshot shape throws `PREFERENCE_SNAPSHOT_UNREADABLE`; preferences are learned
state with no rebuild source, and persistence binds only after a successful
load so damaged bytes are not silently reset or overwritten.

The per-project `bandit.json` is learned state too. It publishes through the
shared atomic writer; ENOENT is the only silent path. Empty, invalid JSON, or
invalid core counters throw `BanditStateUnreadableError` (a
`DomainValidationError`) with code `BANDIT_STATE_UNREADABLE`, leave the bytes
untouched, and instruct the operator to repair the file or explicitly move it
aside to relearn from zero. Unknown extra keys on an otherwise valid core are
tolerated version skew and are dropped at the read boundary. Under
`run --children`, failure of the automatic post-run update is disclosed as
`adapt skipped: …` without replacing the run's status; `adapt auto` and the
tracked-run path propagate the same typed error to the CLI's
`stage: "validation"` surface. The bandit remains off live selection.

`CheckpointStore.read()` is also fail-closed: ENOENT returns `undefined`, but
malformed checkpoint JSON throws a path-naming `DomainValidationError`.

### Evidence and artifacts

```ts
interface Evidence {
  id: EvidenceId;
  kind: "PROJECT_FACT" | "AGENT_MESSAGE" | "TOOL_EVENT" | "COMMAND_RESULT" | "TEST_RESULT" | "GIT_DIFF" | "REVIEW_RESULT";
  summary: string;
  sourceEventId: EventId;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  redaction: "NONE" | "REDACTED" | "REFERENCE_ONLY";
}

interface Artifact {
  id: ArtifactId;
  kind: "TEXT" | "JSON" | "FILE_DIFF" | "COMMAND_OUTPUT";
  contentPath?: string;
  sha256?: string;
  createdByEventId: EventId;
}
```

An artifact may be reference-only when retaining its body would expose credentials, user data, or tool arguments. The implementation must never write raw environment variables, provider credentials, or unbounded tool bodies into `events.jsonl`.

## Supervisor and Ledger (M2)

The M2 supervisor is deterministic for scheduling and state transitions. An LLM may propose a task graph or ledger update only as validated input; it never directly mutates state.

`GateApplyResult.runStatus` is a ledger projection, not a control input. The
runtime controls execution through the gate directive and durable events; no
runtime plane reads `runStatus` (or its sibling result metadata `applied` and
`transitionId`) to authorize a transition. A future reader is therefore a
separate control-plane decision, not incidental wiring.

```ts
interface RunLedger {
  revision: number;
  objective: string;
  facts: LedgerFact[];
  progress: ProgressEntry[];
  blockers: Blocker[];
  nextActions: NextAction[];
  round: number;
  consecutiveStalls: number;
  updatedByEventId: EventId;
}
```

A round has progress only when it adds a completed task, validated artifact, new non-duplicate fact, resolved blocker, or a user-decision boundary. Repeating an equivalent plan or retrying without new evidence increments `consecutiveStalls`. Reaching the configured limit transitions the run to `BLOCKED` with a summary of the evidence required to continue.

The M2 judge is a pluggable verifier that produces `APPROVED`, `REJECTED`, or `NEEDS_USER_DECISION` with evidence references. Its output routes a task only through declared graph transitions; it cannot issue arbitrary host commands.

Acceptance criteria remain prompt guidance and a plan-time coverage obligation.
The criteria-shaped tracking dimensions may change recorded verdicts and the
numeric prescore, but cannot themselves change the directive:
`check-coverage` has no `FAIL` outcome in production, while
`constraint-retention` is fed the original constraints rather than an
independent observation. Round 11 added a distinct control path from the
child's reported per-criterion outcomes; it does not infer a failure from those
dimensions or from a score.

`PiAgentExecutor` exposes `sparkle_report_task_result` on every leased attempt.
The request supplies run/task/agent identity; the model cannot override it.
The tool accepts only a non-empty-summary `PASSED` or `FAILED` whole-task
verdict (`CANCELLED` is a parent fact), rejects the whole call on malformed
`evd_`/`art_` references, and requires at least one evidence id for `FAILED`.
Each attempt may emit one verdict: the first valid report wins, and a report
from an attempt that later fails cannot leak into its retry. The adapter
synthesizes `UNOBSERVED` only when the surviving attempt is silent or every
report is refused. Round 10 freezes the producer's remaining standing rules:
model-supplied `from`/`runId`/`taskId` cannot displace the leased identity, an
explicitly empty `FAILED.evidenceIds` emits nothing, an identical second report
is still a forbidden repeat, and the tool remains an unconditional direct
element of every attempt's `tools` array.

The same call now optionally carries a non-empty, unique-id list of
per-criterion results on `VerificationResult.criteria`, added compatibly
without a protocol version bump. A reported `FAILED` criterion must cite
evidence and reaches the hard `unmet-acceptance-criterion` gate for all seven
roles, even when the whole-task verdict is `PASSED`. The gate is supplied from
the child's reported failures only: omission, protocol-level `UNOBSERVED`, and
a task that never ran stay unknown-not-unmet and leave it open.

Round 12 commit `b8f784f` proves that path through production: the child can
report the task `PASSED` with one evidence-backed failed criterion, leaving the
node COMPLETED while the run is BLOCKED by
`unmet-acceptance-criterion`. A retry request is refused because the node is
not failed; no-retry `unblock` is the sanctioned exit and resume does not drive
the completed node again. `--discard-executed` is structurally unavailable for
this block class because there is no failed retry node to name.

Measured production-input reachability confirms the whole-task control result:
`PASSED` opened all 360 swept cells (minimum prescore 0.750, above the 0.55
soft threshold), while `FAILED` hard-blocked all 180 swept cells with
`deterministic-fail` leading. An `--executor pi` run can therefore really
become BLOCKED on the child's whole-task verdict. The per-criterion channel is
separately held at the protocol, tool, assessment, gate, and persistence
boundaries.
`cappedByHardFail` and `displayPrescore` are display facts only; `combineScore`
and `evaluateGates` consume the uncapped `P`.

The unfortunately named `PrescoreInput.independentEvidence` is not independent
corroboration. Its sole production writer derives it from the same child-authored
verdict, and `computePrescore` discards it. Round 10 records that self-report
posture in source and pins it with a whole-`src` dereference census whose sole
allowed read is the `void` discard; `95a2b25` additionally requires the
flowchart spine to contain no mention. A 144-cell sweep confirms it changes no
score today. A reader or rename is a separate design decision.

When `run --flowchart` or `run --children` returns BLOCKED, stderr reports the
newest `RUN_BLOCKED` reason and required evidence, then gives exactly four
routed lines: `inspect`, `inject`, and `unblock` `next:` lines followed by the
`note:` that resume alone replays BLOCKED. Flowchart `resume` and `answer`
print the same block. The operator first runs the locked
`unblock --reason <text> [--retry-node <nodeId>]` command, then resume executes
the reopened work. `unblock` records a `RUN_UNBLOCKED` naming the exact active
block and reopens state without executing it; stale, repeated, and wrong-node
requests fail closed. The BLOCKED exit code remains 1.

Ordinary `RUN_UNBLOCKED` deliberately remains exact-keyed to
`blockedEventId`, `reason`, and optional `retryNodeId`; it cannot authorize
rewinding already executed descendants. The signed-off stronger operation is
`unblock --discard-executed`, represented by one distinct exact-keyed
`RUN_UNBLOCKED_WITH_DISCARD` authorization. This is not a fourth
`RUN_UNBLOCKED` key and not a two-event sequence with a half-authorization
crash window. The implementation computes the complete descendant set under
the lifecycle lock rather than accepting an operator-supplied list. Its
required retry target and non-empty canonical list exclude the target and
include executed work; each charged estimate is re-derived from exactly the
cited durable `MODEL_ROUTED` rows before the single append, never from
best-effort invocation telemetry. Restore recomputes the consequence set and
fails closed on a hand-edited mismatch, then validates every recorded
route/child reference and charged total against the cited log rows. The
consequence-set check deliberately runs before the charge audit, and later log
growth cannot alter the result because only cited rows are read. The recorded
completeness limit is producer-side: a correctly-totalled subset-citing
authorization passes, while the sole producer `chargedAttempts` takes every
row. Evidence and history survive, superseded control-state outcomes clear
(including a rewound waiter's pending approval), and no budget is refunded.
Replay and gate matching are uniform for both clearing events, so the stronger
authorization applies only to the named block rather than becoming a run mode.
The original discard semantics are anchored to `54cf5e5`;
`2399346`/`d4b52b1` pin the scheduler/gate postures, and `9663294` plus
`39c97c3` land and hold the restore-side audit.

### Crash teardown

The active terminal a flowchart log replays wins. Its blocked, completed, and
failed writers and the replay anomaly rule share
`TERMINAL_REPLAY_STATUSES` / `replayedTerminalStatus`, so they cannot derive
terminal status differently. A tracking-gate `queue_analysis` therefore beats
a later node failure: a verification-failed child leaves one active
`RUN_BLOCKED` with reason `ANALYSIS_QUEUED`, checkpoint BLOCKED, episode
WAITING, and no terminal-overwrite anomaly. A `RUN_UNBLOCKED` that names that
exact block ends the interval; replay then has no terminal and the next
COMPLETED, FAILED, or BLOCKED can become active. A stale or mismatched unblock
is an anomaly and leaves the block in force.

The library/test-only parent plane uses the same shared definition:
`runParentRun` routes its completion, failure, and crash exits through one
`recordTerminal`; that recorder asks `replayedTerminalStatus` first and refuses
to append a second terminal over the replayed one. Its two residuals are
settled decisions. A crash over a log replaying `WAITING_FOR_USER` records
`RUN_FAILED` because the parent loop's in-memory answering channel died with
the process. `RUN_CANCEL_REQUESTED` remains unguarded because it records an
operator fact, not a status claim; replay preserves any existing terminal and
reports the after-terminal ordering anomaly.

If an error escapes supervised rounds while replay is PLANNING or RUNNING, the
wrapper best-effort appends one `RUN_FAILED` with a bounded crash reason and
settles launched round-mates. The crash path then re-reads the log, closes the
bound episode, materializes a checkpoint at the status replay honestly reports
(`FAILED` when the crash terminal landed), and rethrows the original error.
Episode close and checkpoint write are independent best-effort steps: failure
of either does not suppress the other or mask the escaping error. On the
ordinary path, only `EPISODE_CLOSED` follows the crash terminal. The wrapper
does not overwrite a blocked, cancelled, or already-terminal log.

The same terminal-then-settle pair covers failures while opening the supervised
state before rounds begin. A pre-rounds death therefore ends with a FAILED
event log, closed FAILED episode, and FAILED checkpoint instead of leaving a
RUNNING log that no command can settle; terminal recording and each settle
step remain best effort, and the original error still escapes.

Flowchart teardown first cancels and settles child work, applies the same
in-flight-only terminal posture, and rethrows. PAUSED, WAITING_FOR_USER, and
BLOCKED are intentionally resumable rather than terminal-on-crash; for those
statuses `preserveResumableState` best-effort flushes a checkpoint from the
event log so the durable resume point is not behind already-applied results.
Work still in flight at the crash remains at-least-once and may execute again
on resume.

## Security and Workspace Boundaries

- Project discovery canonicalizes the requested root and rejects escapes outside it.
- Worker tool allowlists are declared by profile and enforced by the Pi adapter integration point.
- M0-M2 do not treat a tool allowlist as a sandbox. Production isolation must use an operating-system/container/VM policy outside Pi.
- Agents may inspect Git state and run configured validation commands. They may not commit, push, merge, reset, or delete by default.
- Child agents receive the smallest artifact set needed for their task, not the parent transcript by default.
- Sensitive content is redacted or stored as reference-only before persistence.

## Commands and Project Structure

M0 will create the following layout:

```text
src/
  cli/              command parsing and human output
  domain/           pure IDs, state machines, contracts
  project/          discovery and instruction collection
  run/              coordinator, event store, checkpoint store
  pi-adapter/       the only Pi package boundary
  testing/          deterministic fakes

test/
  unit/             pure domain and storage contract tests
  integration/      temporary-workspace CLI and adapter tests

docs/
  specs/
  decisions/

tasks/
```

Planned commands:

```text
pnpm dev -- --help
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

## Testing Strategy

- Unit-test all IDs, schema parsing, state transitions, graph validation, event encoding/replay, checkpoint recovery, and retry/stall policies without an LLM provider.
- Use a fake `AgentExecutor` for integration tests; it emits a fixed event sequence and honors `AbortSignal`.
- Use temporary directories for project discovery and event persistence tests.
- M0 has one opt-in Pi smoke test that is skipped when model credentials are not configured; it must never be the only proof of correctness.
- The deterministic offline Pi path uses
  `test/helpers/loopback-openai-provider.ts` as a local OpenAI-compatible SSE
  server through `customProviders[].baseUrl`.
  `test/integration/pi-adapter/loopback-cli-resume.test.ts` drives the exported
  CLI through run, approval, and resume. Its wire witness verifies that the
  server receives requested model `loopback-1` rather than configured default
  `loopback-2`, `stream: true`, and flagged
  `reasoning_effort: "high"` (absent from the unflagged request). The supervised
  resume path carries the same request witness and intentionally settles
  BLOCKED. A second witness drives one two-tier child through a deterministic
  test-only FAILED/PASSED verifier sequence; production records `TASK_RETRY`,
  selects the next tier, and sends exactly two HTTP requests whose second body
  carries `model: "loopback-2"`. The decorator supplies only verification
  verdicts, not tier choice or transport. Invocation rows are decoded with the
  production calibration reader. It requires no external provider or network.
- `scripts/crash-probe.mjs` exercises eleven crash/recovery cases for three
  iterations each. The cross-process `sigkill-run-lock-operator-recovery`
  chain is described under Persistence and Audit. The added tenth case,
  `unblock-append-before-checkpoint-sigkill`, externally kills the producer
  after its complete `RUN_UNBLOCKED` append and proves resume applies the
  reopen exactly once. The added eleventh case,
  `unblock-discard-append-before-checkpoint-sigkill`, does the same for the
  single `RUN_UNBLOCKED_WITH_DISCARD` event and proves resume re-executes the
  retry target and discarded descendant exactly once. The ordered name pin
  lives at
  `test/integration/persist/crash-recovery.test.ts`.
- M1 tests cancellation propagation, terminal-message uniqueness, malformed-message rejection, concurrency caps, timeout handling, and parent/child correlation.
- M2 tests cycles, dependency joins, lease mutual exclusion, orphan recovery
  on resume, legal/illegal transitions, resume replay, stall blocking, and
  declared judge branches.

## Acceptance Scenarios

### M0-AC1: Discover and execute one worker

Given a temporary Git project with `AGENTS.md` and a package manifest, when the user starts a run, the CLI records the project facts, creates a run directory, consumes a fake worker event stream, and writes valid ordered JSONL events ending in `RUN_COMPLETED`.

### M0-AC2: Recover after interrupted append

Given an event stream with an incomplete final line, when the run is loaded, replay retains valid preceding events, reports the partial line as recovery evidence, and does not corrupt the checkpoint.

### M1-AC1: Bounded parallel child runs

Given two independent child tasks and a concurrency limit of one, when the parent schedules them, the event history shows that their execution intervals do not overlap and both results are attributed to the parent run.

### M1-AC2: Cancellation propagates

Given a running child executor, when the parent run is cancelled, the child receives an aborted signal, emits/correlates a cancellation terminal result, and the parent settles as `CANCELLED` only after all children settle or time out.

### M2-AC1: Join and resume

Given a graph where review depends on implementation and tests, when both prerequisite tasks complete, review becomes `READY`; after restart, replay and checkpoint produce the same ready task without running prior tasks again.

### M2-AC2: Stall stops rather than loops

Given repeated supervisor rounds that add no admissible progress evidence, when `maxConsecutiveStalls` is reached, the run transitions to `BLOCKED`, records the reason, and starts no further worker.

## Boundaries

- Always: validate external and persisted input; record evidence for material state changes; run focused tests and type checks before committing; preserve user workspace changes.
- Ask first: add a package dependency; change persistence format incompatibly; introduce a database; enable write-capable tools beyond the M0-M2 profile; configure provider credentials; add CI or hosted services.
- Never: fork Pi merely to access a public integration point; persist secrets; treat agent policies as a sandbox; auto-commit/push/reset/delete user work; make learned routing claims without comparable outcomes.

## Open Questions

1. Which Node.js LTS and pnpm versions should be declared as the project baseline?
2. Which provider/model should M0 use for the opt-in real Pi smoke test, and should the default first worker be read-only?
3. Should M0 initialize a local `~/.pi-sparkle` state root, or require `--state-root` until the storage policy is reviewed?
4. Is file-edit authority required in M1, or should M1 demonstrate collaboration using read-only tasks first?
