# CLI and Pi package usage

> Detailed usage moved out of the root README. Start at [README](../README.md) for install and the command list; this page keeps the full explanations of each run mode, output contract and the legacy runtime/adaptive planes.
## Install as a local Pi package

The local package includes the native delegation extension, diagnostic skill
and `/sparkle` prompt (ADR-006 Accepted). Local paths are referenced, not copied:

```bash
pi install /absolute/path/to/pi-sparkle
pi list
```

Reload Pi after installing. In a normal session, ask the assistant to use
`sparkle_delegate` for up to four read-only inspections/reviews. Workers use
the host model catalogue/auth and actual file reads. Each delegation inherits
the effective host system prompt and thinking level sampled at admission;
request-time context or provider-payload transforms are not inherited. Parent
transcripts and tool closures are not copied. `/sparkle-status` shows
active runs. Workers default to the host model captured at admission; the tool
accepts
an explicit `provider/model` override and refuses unavailable/ambiguous models.
Static eligibility checks can refuse that selection but cannot route to a
different model.
The main conversation model is unchanged. Esc and session shutdown cancel
workers. `SPARKLE_NATIVE=0` disables the extension at load time.
A [trusted host wrapper](how-to-adapt-to-pi.md#explicit-worker-resources) can supply selected context and skill bodies; the default package does not discover extra resource text.

Delegated evidence lives in `.agent_workspace/pi-sparkle/` under the project;
use `pnpm cli inspect --run <id> --state-root <project>/.agent_workspace/pi-sparkle`.
Results are bounded child reports, not independently verified acceptance.
The initial slice does not write files or execute shell commands in workers.
The default delegate does not load learned routing or run post-task adaptation.
The legacy research session remains available separately.
Offline checks exercise the actual Pi 1.2/1.4 loaders, host dispatch, usage and cancellation, including the mixed host/app installation. Earlier 0.84.4/0.85.1/0.86.1 results remain historical. Live-provider behavior is not
established by the offline loopback tests.

`/skill:pi-sparkle` and `/sparkle` remain diagnostic overlays. The CLI is also
available independently. See the [native integration plan](../archive/superpowers/plans/2026-09-18-native-pi.md)
for isolated write tasks, quality routing and automatic improvement scope.

## Run with the built-in fake executor (no API keys)

```bash
pnpm cli run \
  --project /path/to/your/project \
  --objective "Refactor the payment module and add integration tests"
```

This executes a deterministic fake agent, writes JSONL events, and produces a checkpoint under `~/.pi-sparkle/`.

## Inspect a completed run (and its episode)

```bash
pnpm cli inspect --run <runId>
pnpm cli inspect --run <runId> --json
pnpm cli inspect --run <runId> --summary-json
pnpm cli inspect --run <runId> --status-json
pnpm cli inspect --episode <epId>
```

`--json` prints the raw event stream, one event per line, with nothing
appended. `--summary-json` prints exactly one `INSPECT_SUMMARY` object with
the run status and the evidence the latest stall/block asked for
(`requiredEvidence`, empty for a run that never stalled). The summary is a
**frozen additive-only contract** (`InspectSummaryJson` in
`src/run/inspection.ts`, same policy as doctor `--json`): scripts may pin
`type`, `runId`, `status`, and `requiredEvidence`; new keys may be added over
time, and existing keys keep their meaning. It remains a developer-preview
surface, is only available with `--run`, is not a domain event (no `id`, its
`type` is outside the event union), and the two flags stay mutually
exclusive. A stalled or blocked run also shows its `required evidence` list
in the default prose view.

`--status-json` prints exactly one `RUN_STATUS_PROJECTION` object: child-reported
outcomes/verification/criteria (not independent acceptance), current blockers,
this run's eligible token counts and fully priced USD subset, separate event
and telemetry torn-tail flags, and advisory recovery commands. Missing files
set `cost.invocationsAvailable: false`; empty files stay available. Unknown
numeric totals are omitted, never invented as zero. Corruption, invalid rows,
read limits and I/O failures are command errors, not missing data. Cost is not
a bill, root-budget settlement, or child-run rollup. Outcome-success and
unknown-verification counts can overlap. The output is a **frozen additive-only
contract** (`RunStatusProjection` in `src/run/projection.ts`; field semantics in
[the data dictionary](data-dictionary.md#run-status-projection-ps-06)), only
available with `--run`, mutually exclusive with `--json` / `--summary-json` /
`--follow`, and read-only. It never invents a terminal status or accepts a
model's "percent complete" as fact.

## Resume an interrupted run

```bash
pnpm cli resume --run <runId>
```

## Run with a real Pi provider

Configure providers and models (once), then run:

```bash
# Per-provider keys (Pi native). Stored login is optional.
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...

pnpm cli models enable openai/gpt-4o-mini
pnpm cli models enable anthropic/claude-sonnet-4-5
pnpm cli models set-default --primary anthropic/claude-sonnet-4-5 --fast openai/gpt-4o-mini
pnpm cli auth status

pnpm cli run \
  --project /path/to/your/project \
  --objective "Implement the new checkout flow" \
  --executor pi
```

`pi-sparkle auth login openai --from-env`, `--key-file /path/to/key`, or
`--key-stdin` (piped, not a TTY) copies nothing from argv. `auth login openai
--key sk-...` still works but warns: the key is visible in process argv and
shell history. Stored credentials live in `~/.pi-sparkle/runtime/auth.json`
(owner-only; POSIX refuses a group/world-readable file) and win over
environment variables. `PI_PROVIDER` / `PI_MODEL` / `PI_API_KEY` still work as
a compatibility override for the default provider.

### Custom OpenAI-compatible provider

Custom providers are read from `<state-root>/runtime/providers.json`. Add the
provider entry to your existing configuration; do not overwrite the file, since
it may already contain other providers, enabled models, or defaults. For example,
merge this entry into the existing `customProviders` array (or use this complete
minimal config only when creating a new file):

```json
{
  "version": 1,
  "enabled": [],
  "customProviders": [
    {
      "id": "example",
      "name": "Example local-compatible service",
      "baseUrl": "https://api.example.invalid/v1",
      "envVar": "EXAMPLE_API_KEY",
      "models": [
        {
          "id": "example-chat",
          "name": "Example chat model",
          "inputCostPerMTok": 1.25,
          "outputCostPerMTok": 5,
          "cacheReadCostPerMTok": 0.125,
          "cacheWriteCostPerMTok": 1.5,
          "costTiers": [
            {
              "inputTokensAbove": 128000,
              "input": 2.5,
              "output": 7.5,
              "cacheRead": 0.25,
              "cacheWrite": 3
            }
          ]
        }
      ]
    }
  ]
}
```

These reference prices are illustrative, hypothetical values in USD per million
tokens (including the rates in `costTiers`); actual gateway billing is unknown.
Verify your own model/provider prices before using them. All rates must be finite
and nonnegative. `costTiers` thresholds (`inputTokensAbove`) must be nonnegative
safe integers in strictly increasing order. A tier applies only when total input
including cached tokens (`input + cacheRead + cacheWrite`) is strictly above its
threshold. The last applicable tier sets whole-request rates for input, output,
cache reads and cache writes, rather than marginal pricing on only the excess
tokens. With this example, 128,000 total input tokens use the base rates;
128,001 use the tier rates for the whole request.

Keep `envVar` nonempty even when you plan to use interactive stored login. A
custom provider without it uses a keyless local resolver and cannot use stored
`auth.json` credentials. In PowerShell, choose one explicit state root and use
it for registration, login, status, catalog lookup, and defaults:

```powershell
$stateRoot = Join-Path $HOME ".pi-sparkle-example"
# Save the config above as $stateRoot\runtime\providers.json, merging it if present.
pnpm cli auth login example --state-root $stateRoot
pnpm cli auth status --all --state-root $stateRoot
pnpm cli models list --available --provider example --state-root $stateRoot
pnpm cli models set-default --primary example/example-chat --state-root $stateRoot
```

The login command prompts interactively and stores the credential. In the
credentialed branch, stored login wins over the environment variable configured
by `envVar`. `pnpm cli auth login example --from-env --state-root $stateRoot`
checks only environment/ambient authentication and saves nothing; it does not
test or store an interactive credential. Unpriced models are not free: absent cost metadata is not a price
quote. Local auth and catalog checks confirm only local configuration, not that
a remote request succeeds.

Optional reasoning effort: `PI_THINKING_LEVEL=medium` (`off` | `minimal` | `low` | `medium` | `high` | `xhigh` | `max`), or `--thinking <level>` on `run`, which wins over the env var for that run only and never persists. Google models silently clamp `xhigh`/`max`.

## Parent + children

Provide a child spec JSON file. Task ids must be `tsk_<suffix>`. Roles must be one of `worker`, `scout`, `planner`, `implementer`, `reviewer`, `tester`, `debugger`. `--children` compiles the spec through `compileChildrenToFlowchart` and executes it on the same flowchart engine as `--flowchart`; the child coordinator preserves parent/child protocol semantics inside that run (bounded children, peer mail, exactly one terminal `TASK_RESULT` per task). The original M1 entry `startParentRun` remains a library/test-only path.

A task may declare `"model": "<catalog-id>"` as an exact per-task pin (the children-spec counterpart of a flowchart node's single-model `modelPolicy`). A pinned task is not routed: the planner leaves it untouched, the flowchart node compiles to `allowedModels: [pin]`, no cascade escalates off it, and the run refuses to start if the pin names a model the live catalog does not expose. Pins print on their own `(pinned)` routing line so operator input is never mistaken for planner output. `validate --children` checks pins against the same live catalog (pass `--state-root` to point it at a non-default root).

Honesty note: plain `--children` starts **without a requirement contract** —
the run records `skipContract: true` and the coverage gate does not run on
this path. Per-task `acceptanceCriteria` still gate each child's
`TASK_RESULT`, but they are not compiled into a run-level contract, and the
runtime deliberately does not invent one from them. For a coverage-gated
start (refusing while mandatory criteria are uncovered), use `--track`.

```json
{
  "tasks": [
    {
      "id": "tsk_research",
      "role": "scout",
      "objective": "Survey the latest payment gateway options",
      "acceptanceCriteria": [
        { "id": "ac1", "description": "List 3+ candidates with pros/cons" }
      ]
    },
    {
      "id": "tsk_impl",
      "role": "implementer",
      "objective": "Integrate the chosen gateway",
      "inputArtifactIds": ["art_research-report"],
      "model": "anthropic/claude-sonnet-4-5"
    }
  ]
}
```

Run the compiled children with the **fake** executor (no API keys):

```bash
pnpm cli run \
  --project /path/to/project \
  --objective "Migrate to new payment provider" \
  --children tasks.json
```

Real providers remain opt-in: add `--executor pi` after `models set-default` (and credentials). Do not treat that path as the preview default.

Reusable child and flowchart input files belong under `examples/`; the
`tasks.json` and `flow.json` names in these snippets are placeholders for
those local examples.

## Flowchart

`--flowchart` takes an explicit flowchart JSON — the same DAG engine `--children` compiles onto, driven directly. Task ids must be `tsk_<suffix>`. Catalog aliases are `cheap` / `premium`. The flags are mutually exclusive: do not combine with `--children` or `--track`.

Without `--results` or `--executor`, leased nodes stay RUNNING until stall. `--results` is an explicit nodeId → outcome map and wins over `--executor` for those nodes. `--executor fake` runs remaining RUNNING nodes through the protocol child fake (no API keys). `--executor pi` is opt-in.

```bash
pnpm cli run \
  --project /path/to/project \
  --objective "Add remember-me to login" \
  --flowchart flow.json \
  --executor fake
```

## What the run / children / flowchart CLI does

- Executes Pi agents (or deterministic fakes) with structured event emission
- Coordinates `--children` as a parent run over bounded child tasks, with peer mail and bounded spawn
- After `--primary-model` (and optional `--fast-model`), analyzes each task and assigns a catalog model — no per-task manual model pick
- `--track` asks clarifying questions from the objective and recorded habits, plans scout → implement → review → test, executes, and tracks the episode
- Validates flowcharts and DAGs, prevents cycles, and schedules joins deterministically
- Persists resumable checkpoints, JSONL event logs, and an episode bound to each run. A truncated final JSONL line is recovered, not treated as a corrupt log
- Bounds retained runtime invocations and episodes to 90 days by default
  through the explicit, dry-run-first `retain --apply` command
- `--track` and explicit contracts refuse to start a task graph while mandatory criteria are uncovered; skip-contracts and already-answered questions still start. Plain `--children` is a skip-contract start (`skipContract: true`) — no coverage gate on that path
- Detects stalls, records evidence on the ledger, and routes low-confidence work to human approval
- Keeps adaptive R1/bandit/topology off the live loop; in the explicit research composition, auto-loop collects user and subagent feedback, attributes issues to (model, project), and may propose a **routing-policy** candidate. Promotion requires `adapt promote --approve`. `SPARKLE_AUTO_ADAPT=0` still collects and diagnoses, but nothing learns: no bandit update, no proposal. Other resource kinds stay proposal-first.

## Runtime and adaptive planes (status as of the old README)

Two planes share this repo. They are not one numbered product line. The
authoritative grid is [docs/status-matrix.md](status-matrix.md).

**Runtime (CLI spine, Developer Preview)**

- M0: single-run CLI + event persistence — Wired + Exercised on the fake path
- M1: parent/child protocol + bounded child runs (fake child executor by default); its `startParentRun` entry is now library/test-only
- M2: DAG supervisor (`--supervised` resume still uses this path)
- M2.5: `--flowchart` is the public orchestrator; optional `--executor` runs nodes; `--children` compiles onto the same flowchart engine (`compileChildrenToFlowchart`) with child-protocol semantics preserved

**Adaptive library (spec M3–M6; not a later CLI rewrite)**

- Live routing is R0-equivalent static `ModelRouter`; R1/bandit stay shadow-only
- `adapt auto` proposes routing-policy candidates only; `adapt promote --approve` is required
- Checkpoint F sealed holdout stays open (ADR-005); do not claim adaptive gains
- Privacy dictionary: [docs/data-dictionary.md](data-dictionary.md). P0
  closed by technical re-verification on 2026-08-26; an independent
  privacy-officer countersign remains welcome but does not block this
  Developer Preview.

Real-provider execution is opt-in via `PI_*` environment variables and `--executor pi`.
