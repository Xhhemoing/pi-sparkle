# pi-sparkle

**Developer preview (0.1.0).** Fake-executor local CLI (`run` / `inspect` / `resume` / `--flowchart` / `--children`) is the supported path. Real providers and adaptive routing are opt-in / proposal-first and are **not** Outcome-supported. This package is not an npm release (`private: true`). See [status-matrix.md](docs/status-matrix.md).

`pi-sparkle` is a project-development multi-agent runtime built on Pi. It coordinates parent/child agent runs, persists event logs and checkpoints, validates task DAGs, and resumes supervised workflows with stall detection and evidence-driven routing.

## Quick Start

### Install

```bash
git clone https://github.com/Xhhemoing/pi-sparkle.git
cd pi-sparkle
corepack enable
pnpm install
pnpm cli version
```

`pnpm cli` runs TypeScript in place (no build). After `pnpm build`, `pnpm pi-sparkle version` or `node dist/cli/main.js --version` runs the compiled CLI. `bin.pi-sparkle` is for a future packed install (`pnpm add -g .`); this repo stays `private: true`.

### Install as a local Pi package

The diagnostic skill and `/sparkle` prompt install into Pi. There is **no**
extension (ADR-006 still Proposed). Local paths are referenced, not copied:

```bash
pi install /absolute/path/to/pi-sparkle
pi list
```

On this machine that is `pi install E:\Project\pi-sparkle`. In a Pi session,
`/skill:pi-sparkle` or `/sparkle` runs the overlay. The CLI above is a
separate runtime (`pnpm cli`), not a Pi slash command.

### Run with the built-in fake executor (no API keys)

```bash
pnpm cli run \
  --project /path/to/your/project \
  --objective "Refactor the payment module and add integration tests"
```

This executes a deterministic fake agent, writes JSONL events, and produces a checkpoint under `~/.pi-sparkle/`.

### Inspect a completed run (and its episode)

```bash
pnpm cli inspect --run <runId>
pnpm cli inspect --run <runId> --json
pnpm cli inspect --episode <epId>
```

### Resume an interrupted run

```bash
pnpm cli resume --run <runId>
```

### Run with a real Pi provider

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

`pi-sparkle auth login openai --key sk-...` writes `~/.pi-sparkle/auth.json` (stored credentials win over env). `PI_PROVIDER` / `PI_MODEL` / `PI_API_KEY` still work as a compatibility override for the default provider.

Optional: `PI_THINKING_LEVEL=medium` (`off` | `minimal` | `low` | `medium` | `high` | `xhigh`).

### Parent + children

Provide a child spec JSON file. Task ids must be `tsk_<suffix>`. Roles must be one of `worker`, `scout`, `planner`, `implementer`, `reviewer`, `tester`, `debugger`. `--children` compiles the spec through `compileChildrenToFlowchart` and executes it on the same flowchart engine as `--flowchart`; the child coordinator preserves parent/child protocol semantics inside that run (bounded children, peer mail, exactly one terminal `TASK_RESULT` per task). The original M1 entry `startParentRun` remains a library/test-only path.

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
      "inputArtifactIds": ["art_research-report"]
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

### Flowchart

`--flowchart` takes an explicit flowchart JSON — the same DAG engine `--children` compiles onto, driven directly. Task ids must be `tsk_<suffix>`. Catalog aliases are `cheap` / `premium`. The flags are mutually exclusive: do not combine with `--children` or `--track`.

Without `--results` or `--executor`, leased nodes stay RUNNING until stall. `--results` is an explicit nodeId → outcome map and wins over `--executor` for those nodes. `--executor fake` runs remaining RUNNING nodes through the protocol child fake (no API keys). `--executor pi` is opt-in.

```bash
pnpm cli run \
  --project /path/to/project \
  --objective "Add remember-me to login" \
  --flowchart flow.json \
  --executor fake
```

## Commands

| Command | Description |
|---------|-------------|
| `pnpm cli version` | Print `0.1.0` without a build. After `pnpm build`, `node dist/cli/main.js --version` is the compiled equivalent |
| `pnpm cli run --project <path> --objective <text>` | Start a run (`--children`, `--flowchart`, `--track`, `--executor`, `--state-root`) |
| `pnpm cli run --track --assume-defaults --primary-model <id>` | Clarify (or assume defaults), plan a cluster, auto-route models, execute, propose learning |
| `pnpm cli inspect --run <runId>` | Print status, episode id, events, artifacts, and evidence. A crash-truncated JSONL tail is ignored and warned on stderr |
| `pnpm cli inspect --episode <epId>` | Print the episode snapshot bound to a run |
| `pnpm cli resume --run <runId>` | Resume a paused or interrupted run (`--supervised` for M2 DAG checkpoints; `--unpause` to clear a pause token) |
| `pnpm cli answer --run <runId> --message <msgId> --text <answer>` | Answer a waiting run's question. Flowchart approval replies use `--selected` / `--selected-ids` and are validated against the stored approval plan |
| `pnpm cli pause --run <runId> [--reason <text>]` | Write a pause token and `PAUSE_REQUESTED`; `pause --clear` removes the token, `resume --unpause` clears it and continues |
| `pnpm cli inject --run <runId> --type fact\|override\|skip` | Record a typed fact/override/skip against the run's decision policy; user strings are recorded, never executed |
| `pnpm cli episode events\|close --episode <epId>` | Print the episode event view, or close an episode with an acceptance-gated status (`COMPLETED`/`FAILED`/`ABANDONED`) |
| `pnpm cli pref list\|correct\|export\|delete` | Inspect, correct, export, or delete recorded preferences. Export is tombstone-aware and drops deleted payloads |
| `pnpm cli delete --run <runId> \| --episode <epId>` | Delete runtime records. Episode delete cascades: bound feedback bodies are stripped and their ids tombstoned |
| `pnpm cli commits preview\|apply --run <runId>` | Emit conventional commit messages from a completed flowchart run's ledger with evidence refs; `apply` writes them via `git commit --allow-empty` |
| `pnpm cli auth status\|login\|logout` | Manage stored per-provider credentials (stored credentials win over env keys) |
| `pnpm cli models list\|enable\|disable\|set-default` | Manage the enabled model catalog and the default primary/fast models |
| `pnpm cli adapt status` | Show the proposal-first adaptation plane (never mutates a live run) |
| `pnpm cli adapt learn --run <runId>` | Propose a routing-policy candidate from MODEL_ROUTED events |
| `pnpm cli adapt auto [--run] [--project]` | Collect user + subagent feedback and propose routing-policy candidates (never auto-promotes; `SPARKLE_AUTO_ADAPT=0` still collects) |
| `pnpm cli doctor [--project <path>] [--json]` | Developer-preview preflight (Node, pnpm, state-root, providers, legacy layout). `--json` emits the frozen additive-only `DoctorJsonReport` (`preview: true`, `liveAdaptive: false`). Not a production capability |
| `pnpm cli migrate-legacy [--apply]` | Copy pre-plane flat state into `runtime/` + `adaptation/`. Dry run by default; `--apply` copies — never moves, deletes, or overwrites |
| `pnpm test` | Run the full test suite |
| `pnpm gate` | `typecheck && lint && test && build` — merge-time quality gate |

State root defaults to `~/.pi-sparkle`. Use `--state-root` to override.

## What it does

- Executes Pi agents (or deterministic fakes) with structured event emission
- Coordinates `--children` as a parent run over bounded child tasks, with peer mail and bounded spawn
- After `--primary-model` (and optional `--fast-model`), analyzes each task and assigns a catalog model — no per-task manual model pick
- `--track` asks clarifying questions from the objective and recorded habits, plans scout → implement → review → test, executes, and tracks the episode
- Validates flowcharts and DAGs, prevents cycles, and schedules joins deterministically
- Persists resumable checkpoints, JSONL event logs, and an episode bound to each run. A truncated final JSONL line is recovered, not treated as a corrupt log
- `--track` and explicit contracts refuse to start a task graph while mandatory criteria are uncovered; skip-contracts and already-answered questions still start
- Detects stalls, records evidence on the ledger, and routes low-confidence work to human approval
- Keeps adaptive R1/bandit/topology off the live loop; after a run, auto-loop collects user and subagent feedback, attributes issues to (model, project), and may propose a **routing-policy** candidate. Promotion requires `adapt promote --approve`. `SPARKLE_AUTO_ADAPT=0` still collects. Other resource kinds stay proposal-first.

## Project Status

Two planes share this repo. They are not one numbered product line. The
authoritative grid is [docs/status-matrix.md](docs/status-matrix.md).

**Runtime (CLI spine, Developer Preview)**

- M0: single-run CLI + event persistence — Wired + Exercised on the fake path
- M1: parent/child protocol + bounded child runs (fake child executor by default); its `startParentRun` entry is now library/test-only
- M2: DAG supervisor (`--supervised` resume still uses this path)
- M2.5: `--flowchart` is the public orchestrator; optional `--executor` runs nodes; `--children` compiles onto the same flowchart engine (`compileChildrenToFlowchart`) with child-protocol semantics preserved

**Adaptive library (spec M3–M6; not a later CLI rewrite)**

- Live routing is R0-equivalent static `ModelRouter`; R1/bandit stay shadow-only
- `adapt auto` proposes routing-policy candidates only; `adapt promote --approve` is required
- Checkpoint F sealed holdout stays open (ADR-005); do not claim adaptive gains
- Privacy dictionary: [docs/data-dictionary.md](docs/data-dictionary.md). P0 review is not closed.

Real-provider execution is opt-in via `PI_*` environment variables and `--executor pi`.

## Documentation

- [Status matrix](docs/status-matrix.md)
- [Data dictionary](docs/data-dictionary.md)
- [Developer Preview readiness](docs/reports/2026-08-20-developer-preview-readiness.md)
- [Architecture](docs/specs/m0-m2-architecture.md)
- [Adaptive work-loop spec](docs/specs/adaptive-agent-work-loop.md)
- [ADRs](docs/decisions/)
- [Active tasks](tasks/) · [Archived completed plans](tasks/archive/)

## License

MIT — see [LICENSE](LICENSE).
