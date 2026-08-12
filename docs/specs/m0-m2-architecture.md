# Architecture Specification: M0-M2 Runtime

## Status

Proposed. This document defines the approved design target for implementation planning. It does not imply that M0-M2 are implemented.

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

### Task graph

M2 adds a directed acyclic graph. The system must validate missing dependencies, self-dependencies, duplicate IDs, and cycles before any worker starts. A task may transition only through the state machine below.

```text
PENDING -> READY -> RUNNING -> COMPLETED
                         |       |
                         |       -> SKIPPED
                         v
                      BLOCKED -> READY
                         |
                         v
                       FAILED

PENDING | READY | BLOCKED -> CANCELLED
```

`READY` requires all dependencies to be `COMPLETED` or explicitly `SKIPPED` by a declared transition rule. A task is leased to exactly one worker at a time. Lease expiry converts a running task to `BLOCKED`; it never silently duplicates work.

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

### Cancellation and questions

- Parent cancellation propagates an `AbortSignal` through each child adapter and persists `RUN_CANCEL_REQUESTED` before waiting for child settlement.
- A child may request a user decision with `QUESTION`. The parent transitions to `WAITING_FOR_USER`; it may not invent a reply or resume automatically.
- Timeout produces a `TASK_TIMEOUT` event and a `BLOCKED` task. Retry policy is supervisor-owned and must respect `maxAttempts`.

## Pi Adapter

Only `src/pi-adapter/` may import Pi packages. The adapter exposes pi-sparkle-owned interfaces:

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
  | { type: "TOOL_STARTED"; toolCallId: string; toolName: string }
  | { type: "TOOL_FINISHED"; toolCallId: string; isError: boolean; summary: string }
  | { type: "TURN_FINISHED"; usage?: UsageSummary }
  | { type: "EXECUTION_FINISHED"; outcome: "SUCCESS" | "FAILURE" | "CANCELLED" };
```

The adapter translates Pi events into `ExecutionEvent`; no Pi event shape becomes a public pi-sparkle contract. Tool call input and output are treated as sensitive artifacts: the default event log stores a redactable summary and reference, not arbitrary raw content.

## Persistence and Audit

### Event store

Each run receives a directory under the configured local data root:

```text
<state-root>/runs/<run-id>/
  events.jsonl
  checkpoint.json
  artifacts/
```

Every append-only event has a stable event ID, schema version, run ID, task ID where relevant, timestamp, actor, event type, and payload. The writer serializes appends per run and fsyncs at terminal transitions. Readers ignore a final incomplete JSONL line created by a process crash and report it as recovery evidence.

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

`checkpoint.json` is an atomically replaced materialized view. It contains the run, task statuses, active leases, most recent ledger revision, and last durable event ID. Resume reconstructs state from the checkpoint then replays later valid events. Event replay is the source of truth; the checkpoint is an optimization.

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
- M1 tests cancellation propagation, terminal-message uniqueness, malformed-message rejection, concurrency caps, timeout handling, and parent/child correlation.
- M2 tests cycles, dependency joins, lease expiry, legal/illegal transitions, resume replay, stall blocking, and declared judge branches.

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
