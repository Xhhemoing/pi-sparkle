# pi-sparkle

`pi-sparkle` is a project-development multi-agent runtime built on Pi. It coordinates parent/child agent runs, persists event logs and checkpoints, validates task DAGs, and resumes supervised workflows with stall detection and evidence-driven routing.

## Quick Start

### Install

```bash
git clone https://github.com/Xhhemoing/pi-sparkle.git
cd pi-sparkle
corepack enable
pnpm install
```

### Run with the built-in fake executor (no API keys)

```bash
pnpm cli run \
  --project /path/to/your/project \
  --objective "Refactor the payment module and add integration tests"
```

This executes a deterministic fake agent, writes JSONL events, and produces a checkpoint under `~/.pi-sparkle/`.

### Inspect a completed run

```bash
pnpm cli inspect --run <runId> --json
```

### Resume an interrupted run

```bash
pnpm cli resume --run <runId>
```

### Run with a real Pi provider

Set the required environment variables and use `--executor pi`:

```bash
export PI_PROVIDER=openai
export PI_MODEL=gpt-5.6-sol-pro
export PI_API_KEY=sk-...
export PI_THINKING_LEVEL=medium   # off | minimal | low | medium | high | xhigh

pnpm cli run \
  --project /path/to/your/project \
  --objective "Implement the new checkout flow" \
  --executor pi
```

### Parent + children (multi-agent DAG)

Provide a child spec JSON file:

```json
{
  "tasks": [
    {
      "id": "task-research",
      "role": "researcher",
      "objective": "Survey the latest payment gateway options",
      "acceptanceCriteria": [
        { "id": "ac1", "description": "List 3+ candidates with pros/cons" }
      ]
    },
    {
      "id": "task-impl",
      "role": "implementer",
      "objective": "Integrate the chosen gateway",
      "inputArtifactIds": ["art_research-report"]
    }
  ]
}
```

Run the parent as a coordinator:

```bash
pnpm cli run \
  --project /path/to/project \
  --objective "Migrate to new payment provider" \
  --children tasks.json \
  --executor pi
```

## Commands

| Command | Description |
|---------|-------------|
| `pnpm cli run --project <path> --objective <text>` | Start a new run (optionally with `--children`, `--executor`, `--state-root`) |
| `pnpm cli inspect --run <runId>` | Print status, events, artifacts, and evidence |
| `pnpm cli resume --run <runId>` | Resume a paused or interrupted run |
| `pnpm test` | Run the full test suite (162 tests) |
| `pnpm typecheck && pnpm lint && pnpm build` | Quality gates |

State root defaults to `~/.pi-sparkle`. Use `--state-root` to override.

## What it does

- Executes Pi agents (or deterministic fakes) with structured event emission
- Coordinates parent runs over child tasks with bounded concurrency, cancellation, and timeouts
- Validates task DAGs, prevents cycles, and schedules joins deterministically
- Persists resumable checkpoints and full event logs for replay and inspection
- Detects stalls, records evidence on the ledger, and routes low-confidence work to human approval
- Supports adaptive episode review, preference learning, and rubric-based critic passes (M2 complete)

## Project Status

M0-M2 complete and passing all quality gates locally. Real-provider execution is opt-in via `PI_*` environment variables.

- M0: single-run CLI + event persistence
- M1: parent/child coordination with structured protocol
- M2: supervisor over validated DAGs, stall detection, judge transitions, flowchart routing

Later milestones (M3-M6) will add model learning, web control plane, and harness doctor tooling.

## Documentation

- [Architecture](docs/specs/m0-m2-architecture.md)
- [Adaptive work-loop spec](docs/specs/adaptive-agent-work-loop.md)
- [ADRs](docs/decisions/)
- [Tasks & plans](tasks/)

## License

MIT — see [LICENSE](LICENSE).
