# pi-sparkle

`pi-sparkle` is a project-development multi-agent runtime built on Pi. It manages a project-scoped run graph, structured parent/child agent collaboration, evidence, checkpoints, and verification. It does not fork Pi or claim to be a sandbox.

## Status

M0 foundation is in progress. The repository contains the TypeScript runtime,
durable event/checkpoint infrastructure, project discovery, a single-run
coordinator, and an in-progress Pi adapter/CLI slice.

## Scope

The first delivery milestones are:

- M0: a TypeScript CLI that discovers a project, creates a run, executes one Pi-backed agent, and writes replayable JSONL events.
- M1: isolated child runs with structured messages, cancellation, timeouts, bounded concurrency, and parent/child state.
- M2: a supervisor that schedules a validated task graph, persists its ledger, detects bounded stalls, and resumes from checkpoints.

Model learning/routing, project delivery automation, a web control plane, and Harness Doctor are explicitly later milestones.

The proposed post-M2 adaptive work loop adds native episode review, scoped
preference learning, evidence-driven model routing, and controlled resource
optimization. It deliberately separates runtime execution from candidate
evaluation and promotion.

## Design Documents

- [Architecture specification](docs/specs/m0-m2-architecture.md)
- [Proposed adaptive agent work loop](docs/specs/adaptive-agent-work-loop.md)
- [Adaptive work-loop research brief](docs/research/adaptive-agent-evidence.md)
- [Modification-point validation and optimization](docs/research/modification-points-validation.md)
- [ADR-001: Use Pi through a version-pinned adapter](docs/decisions/0001-pi-adapter-boundary.md)
- [ADR-002: Event log and checkpoint persistence](docs/decisions/0002-event-log-and-checkpoints.md)
- [ADR-003: Structured parent-child protocol](docs/decisions/0003-structured-agent-protocol.md)
- [ADR-004: Separate runtime execution from controlled adaptation](docs/decisions/0004-controlled-adaptation.md)
- [Implementation plan](tasks/plan.md)
- [Task breakdown](tasks/todo.md)
- [Proposed M3-M6 adaptive implementation plan](tasks/adaptive-plan.md)
- [Adaptive task checklist](tasks/adaptive-todo.md)

## Commands

The current development commands are:

| Command | Purpose |
| --- | --- |
| `pnpm dev -- --help` | Run the development CLI help. |
| `pnpm test` | Run the unit and integration test suite. |
| `pnpm lint` | Lint source and tests. |
| `pnpm typecheck` | Type-check without emitting JavaScript. |
| `pnpm build` | Produce the distributable CLI. |

## Primary Source

Pi integration decisions are based on the Pi agent-core documentation and source:

- https://github.com/earendil-works/pi/tree/main/packages/agent
- https://github.com/earendil-works/pi/tree/main/packages/coding-agent

The public package metadata retrieved on 2026-08-12 identified `@earendil-works/pi-agent-core` and `@earendil-works/pi-coding-agent` at version `0.84.1`. The implementation will pin an explicitly reviewed version rather than follow `latest`.
