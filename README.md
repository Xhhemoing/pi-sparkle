# pi-sparkle

`pi-sparkle` is a project-development multi-agent runtime built on Pi. It manages a project-scoped run graph, structured parent/child agent collaboration, evidence, checkpoints, and verification. It does not fork Pi or claim to be a sandbox.

## Status

Design phase. No application code or runtime dependency is present yet.

## Scope

The first delivery milestones are:

- M0: a TypeScript CLI that discovers a project, creates a run, executes one Pi-backed agent, and writes replayable JSONL events.
- M1: isolated child runs with structured messages, cancellation, timeouts, bounded concurrency, and parent/child state.
- M2: a supervisor that schedules a validated task graph, persists its ledger, detects bounded stalls, and resumes from checkpoints.

Model learning/routing, project delivery automation, a web control plane, and Harness Doctor are explicitly later milestones.

## Design Documents

- [Architecture specification](docs/specs/m0-m2-architecture.md)
- [ADR-001: Use Pi through a version-pinned adapter](docs/decisions/0001-pi-adapter-boundary.md)
- [ADR-002: Event log and checkpoint persistence](docs/decisions/0002-event-log-and-checkpoints.md)
- [ADR-003: Structured parent-child protocol](docs/decisions/0003-structured-agent-protocol.md)
- [Implementation plan](tasks/plan.md)
- [Task breakdown](tasks/todo.md)

## Planned Commands

These commands will exist after M0. They are not runnable yet.

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
