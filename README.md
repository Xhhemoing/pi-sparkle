# pi-sparkle

**Developer Preview (0.1.0; `private: true`).** This repository **will not
publish to npm**. Clone the repository and use pnpm locally; npm/global/package
installation is unsupported. The fake-executor CLI (`run` / `inspect` /
`resume` / `--flowchart` / `--children`) is the supported path. Real providers
and adaptive routing are opt-in / proposal-first and are **not**
Outcome-supported. See [status-matrix.md](docs/status-matrix.md).

`pi-sparkle` is a project-development multi-agent runtime built on Pi. It coordinates parent/child agent runs, persists event logs and checkpoints, validates task DAGs, and resumes supervised workflows with stall detection and evidence-driven routing.

## Quick Start

### Install

Requires Node.js >= 22.19.0 and corepack. Clone + pnpm is the only supported
installation path:

```bash
git clone https://github.com/Xhhemoing/pi-sparkle.git
cd pi-sparkle
corepack enable
pnpm install
pnpm cli version
```

`pnpm cli` runs TypeScript in place (no build). After `pnpm build`, `pnpm
pi-sparkle version` or `node dist/cli/main.js --version` runs the compiled CLI.
The package metadata remains `private: true`; packaging is exercised only by
the security probe and is not an installation or publication path.

### Install as a local Pi package

The diagnostic skill and `/sparkle` prompt install into Pi. There is **no**
extension (ADR-006 still Proposed). Local paths are referenced, not copied:

```bash
pi install /absolute/path/to/pi-sparkle
pi list
```

In a Pi session, `/skill:pi-sparkle` or `/sparkle` runs the overlay. The CLI
above is a separate runtime (`pnpm cli`), not a Pi slash command.

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
pnpm cli inspect --run <runId> --summary-json
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

`pi-sparkle auth login openai --from-env` or `auth login openai --key-file /path/to/key`
copies nothing from argv. `auth login openai --key sk-...` still works but warns:
the key is visible in process argv and shell history. Stored credentials live in
`~/.pi-sparkle/runtime/auth.json` and win over environment variables. `PI_PROVIDER`
/ `PI_MODEL` / `PI_API_KEY` still work as a compatibility override for the default
provider.

Optional reasoning effort: `PI_THINKING_LEVEL=medium` (`off` | `minimal` | `low` | `medium` | `high` | `xhigh` | `max`), or `--thinking <level>` on `run`, which wins over the env var for that run only and never persists. Google models silently clamp `xhigh`/`max`.

### Parent + children

Provide a child spec JSON file. Task ids must be `tsk_<suffix>`. Roles must be one of `worker`, `scout`, `planner`, `implementer`, `reviewer`, `tester`, `debugger`. `--children` compiles the spec through `compileChildrenToFlowchart` and executes it on the same flowchart engine as `--flowchart`; the child coordinator preserves parent/child protocol semantics inside that run (bounded children, peer mail, exactly one terminal `TASK_RESULT` per task). The original M1 entry `startParentRun` remains a library/test-only path.

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

Reusable child and flowchart input files belong under `examples/`; the
`tasks.json` and `flow.json` names in these snippets are placeholders for
those local examples.

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
| `pnpm cli run --project <path> --objective <text>` | Start a run (`--children`, `--flowchart`, `--track`, `--executor`, `--thinking`, `--state-root`) |
| `pnpm cli run --track --assume-defaults --primary-model <id>` | Clarify (or assume defaults), plan a cluster, auto-route models, execute, propose learning |
| `pnpm cli inspect --run <runId>` | Print status, episode id, events, artifacts, evidence, and — when the run stalled or blocked — the latest `required evidence` demand. `--json` is the pure event stream (one event per line, nothing appended); `--summary-json` is one `INSPECT_SUMMARY` object with `status` and `requiredEvidence` — a frozen additive-only contract: pin `type`/`runId`/`status`/`requiredEvidence`, new keys may appear, existing keys keep meaning (mutually exclusive with `--json`, run-only). A crash-truncated JSONL tail is ignored and warned on stderr |
| `pnpm cli inspect --episode <epId>` | Print the episode snapshot bound to a run |
| `pnpm cli resume --run <runId>` | Resume a paused or interrupted run (`--supervised` for M2 DAG checkpoints; `--unpause` to clear a pause token) |
| `pnpm cli answer --run <runId> --message <msgId> --text <answer>` | Answer a waiting run's question. Flowchart approval replies use `--selected` / `--selected-ids` and are validated against the stored approval plan |
| `pnpm cli pause --run <runId> [--reason <text>]` | Write a pause token and `PAUSE_REQUESTED`; `pause --clear` removes the token, `resume --unpause` clears it and continues |
| `pnpm cli inject --run <runId> --type fact\|override\|skip` | Record a typed fact/override/skip against the run's decision policy; user strings are recorded, never executed |
| `pnpm cli unblock --run <runId> --reason <text> [--retry-node <nodeId>]` | Reopen the active `RUN_BLOCKED` interval without executing work; inspect first, then resume after the unblock succeeds. `--discard-executed` is available only with the exact failed retry node when the runtime computes executed descendants |
| `pnpm cli episode events\|close --episode <epId>` | Print the episode event view, or close an episode with an acceptance-gated status (`COMPLETED`/`FAILED`/`ABANDONED`) |
| `pnpm cli pref list\|correct\|export\|delete` | Inspect, correct, export, or delete recorded preferences. Export is tombstone-aware and drops deleted payloads |
| `pnpm cli delete --run <runId> \| --episode <epId>` | Delete runtime records. Run delete also filter-rewrites the shared `invocations.jsonl` (dropping that run's rows, fail-closed on a corrupt log) and invalidates the observed-rate snapshot. Episode delete removes the episode files **and lock**, strips both free-text fields (`body` and `summary`) from bound feedback, tombstones their ids, and reports any attached runs whose append-only logs still hold a copy of the episode text (delete those runs to remove it) |
| `pnpm cli retain [--max-age-days <n>] [--apply]` | Enforce the runtime invocation/episode age policy (90 days by default). Dry-run without `--apply`; applying uses the same deletion cascades and residual-copy reporting as `delete` |
| `pnpm cli commits preview\|apply --run <runId>` | Emit conventional commit messages from a completed flowchart run's ledger with evidence refs; `apply` writes them via `git commit --allow-empty` |
| `pnpm cli auth status\|login\|logout` | Manage stored per-provider credentials (stored credentials win over env keys) |
| `pnpm cli models list\|enable\|disable\|set-default` | Manage the enabled model catalog and the default primary/fast models |
| `pnpm cli adapt status` | Show the proposal-first adaptation plane (never mutates a live run) |
| `pnpm cli adapt learn --run <runId>` | Propose a routing-policy candidate from MODEL_ROUTED events |
| `pnpm cli adapt auto [--run] [--project]` | Collect user + subagent feedback and propose routing-policy candidates (never auto-promotes; `SPARKLE_AUTO_ADAPT=0` collects and diagnoses only — no bandit update, no proposal) |
| `pnpm cli adapt promote --candidate <id> --expected <ver> --content-file <path> --review-file <path> --approve [--eval-file <path>]` | The **only** promotion path (CAS: `--expected` must name the active version). All five flags are required — promote refuses without explicit approval and persisted independent-review provenance. Nothing in the runtime promotes on its own |
| `pnpm cli doctor [--project <path>] [--json]` | Developer-preview preflight (Node, pnpm, state-root, providers, legacy layout, plus `pi-packages` / `pi-compat`). `--json` emits the frozen additive-only `DoctorJsonReport` (`preview: true`, `liveAdaptive: false`). Not a production capability |
| `pnpm cli migrate-legacy [--apply]` | Copy pre-plane flat state into `runtime/` + `adaptation/`. Dry run by default; `--apply` copies — never moves, deletes, or overwrites |
| `pnpm cli pi-compat [--json] [--offline]` | Offline-first report of the pinned Pi packages against the adapter contract; `--online` adds npm dist-tags and fails closed. Exit 1 only on a broken adapter contract |
| `pnpm pi-compat [--json] [--online]` | Shorthand for `pnpm cli pi-compat` |
| `pnpm pi:latest [--json] [--offline] [--strict]` | Compare the pinned Pi packages against the npm `latest` dist-tags |
| `pnpm pi:probe` | Probe `src/pi-adapter` for the ADR-001 boundary and the legacy `GoogleThinkingLevel` symbol |
| `pnpm test` | Run the full test suite. `pnpm test -- test/unit/<area>` runs one directory (expanded to its `*.test.ts` files); a single file path also works |
| `pnpm gate` | `typecheck && lint && test && build` — merge-time quality gate |
| `pnpm prerelease` | `pnpm gate && pnpm security:probe && pnpm pi:probe` — run the quality, packaged-security, and Pi-boundary probes before tagging a preview build |

State root defaults to `~/.pi-sparkle`. Use `--state-root` to override.

## What it does

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
- Keeps adaptive R1/bandit/topology off the live loop; after a run, auto-loop collects user and subagent feedback, attributes issues to (model, project), and may propose a **routing-policy** candidate. Promotion requires `adapt promote --approve`. `SPARKLE_AUTO_ADAPT=0` still collects and diagnoses, but nothing learns: no bandit update, no proposal. Other resource kinds stay proposal-first.

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
- Privacy dictionary: [docs/data-dictionary.md](docs/data-dictionary.md). P0
  closed by technical re-verification on 2026-08-26; an independent
  privacy-officer countersign remains welcome but does not block this
  Developer Preview.

Real-provider execution is opt-in via `PI_*` environment variables and `--executor pi`.

## Documentation

- [Status matrix](docs/status-matrix.md)
- [Data dictionary](docs/data-dictionary.md)
- [P0 technical re-verification (2026-08-26)](docs/reports/2026-08-26-p0-technical-reverification.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Developer Preview readiness](docs/reports/2026-08-20-developer-preview-readiness.md)
- [SOTA acceptance (2026-08-24 loop, final)](docs/reports/2026-08-24-sota-r3-acceptance.md)
- [Architecture](docs/specs/m0-m2-architecture.md)
- [Adaptive work-loop spec](docs/specs/adaptive-agent-work-loop.md)
- [ADRs](docs/decisions/)
- [Active tasks](tasks/) · [Archived completed plans](tasks/archive/)

## License

MIT — see [LICENSE](LICENSE).
