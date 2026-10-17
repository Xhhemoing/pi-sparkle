# M2-A behavior-preserving boundary cleanup

## Identity

- ID: `TASK-20261017-m2-boundary-cleanup`
- Owner: boundary-cleanup implementation agent; integration and publication: root agent.
- State: `ready-for-review` (focused checks passed; integrated full gate is owned by root).
- Date opened: 2026-10-17 (UTC).
- Authority: accepted [ADR-009](../../decisions/0009-lightweight-adaptive-framework.md), [M2 migration slice](../../architecture-migration.md#4-m2-边界与窄-sdk).
- Baseline: recovered local commit `778b235`, restoring the M0 candidate tree from `5fc744c`; repository recovery and remote reconciliation are recorded by the integration owner separately.

## Problem and scope

`cli/pref` imports its shared lock parser from `cli/main`, while `main` imports
`pref`. Native and tracking orchestration reach host-neutral model catalog
construction through CLI. State path helpers live in privacy despite being
foundational path definitions used by both planes.

This slice moves those definitions to narrow modules while retaining the old
export paths. It does not change CLI text, error classes, routing algorithms,
catalog ordering, lazy adapter resolution, persistent paths, event/JSON bytes,
plugin activation, package exports, or record schemas. SDK publication remains
a separate M2 slice.

## Acceptance criteria

- [x] Runtime CLI preference imports no longer form a `main`/`pref` cycle.
- [x] Native/tracking catalog imports no longer depend on CLI.
- [x] State layout has a dependency on `node:path` only; its old path forwards
  the same exports and every path result remains unchanged.
- [x] Existing CLI catalog and main helper deep imports resolve to the same
  function/class values as the new canonical modules.
- [x] The runtime catalog cannot enter adaptation through its new path; no
  privacy or Pi isolation allowlist grows.
- [ ] Focused CLI/native/privacy tests and the integration owner's full gate
  pass, with commands/results recorded before delivery.

## Implementation slice

| Files/symbols | Change | Compatibility |
|---|---|---|
| `src/cli/options.ts`, `main.ts`, `pref.ts` | Move `CliIo` and `lockWaitOptions`; retain main exports | Same parser grammar/errors/default shape |
| `src/routing/model-catalog.ts`, `src/cli/model-catalog.ts` | Move implementation and keep forwarding module | Same function and error constructor identities |
| `src/native/routing-catalog.ts`, `src/track/loop.ts` | Import catalog from routing | No output or algorithm change |
| `src/persist/state-layout.ts`, `src/privacy/state-layout.ts`, layout importers | Move foundational layout and retain forwarder | Same paths; no persistence migration |
| New `test/unit/architecture/boundary-cleanup.test.ts` | Import topology, compatibility and fixed layout guards | Guard intended final boundaries |
| Privacy boundary/closure guards | Classify new runtime catalog path | Existing allowlists unchanged |

The concurrent process-ownership author owns `src/development/controller.ts`;
the integration owner updates that one layout import. No package/lockfile,
shared active task file, status matrix, commit, or push is owned by this agent.

## Test-first plan

1. Add structural tests to demonstrate the old cycle and inverted imports.
2. Run the new test against baseline and confirm intentional failures.
3. Move definitions unchanged; use explicit compatibility exports.
4. Add same-value identity and exact path-result checks; run focused suites.

Commands (Node registration hook avoids CLI IPC):

```sh
pnpm test test/unit/architecture/boundary-cleanup.test.ts
pnpm test test/unit/cli/flowchart-cli.test.ts test/unit/cli/live-catalog.test.ts test/unit/native/routing-catalog.test.ts test/unit/preferences/snapshot-lock.test.ts test/integration/cli/delete.test.ts test/integration/cli/retain.test.ts test/integration/m4/preferences-cli.test.ts test/integration/track/track-loop.test.ts test/unit/privacy/plane-boundary.test.ts test/unit/privacy/adaptation-plane-closure.test.ts test/unit/routing/live-isolation.test.ts test/unit/pi-boundary.test.ts
```

Typecheck/lint/full gate belong to the integration owner after the disjoint
slices are assembled. No live provider, experiment or production gate closes
through this refactor. Abort on changed export identity, changed output/path
semantics or a new allowlist exception; resolve rather than weakening guards.

## Closeout

Current author evidence is in the [verification record](../../reports/2026-10-17-m2-boundary-cleanup.md):
the final structural guard fails on the retained baseline in four intended
places; focused checks pass 98/98 with no skips. The moved catalog and layout
implementations match their original baseline bytes. Typecheck/lint/full gate
and independent review are not claimed by this author record. Remaining M2
SDK/packed consumer examples, and complete M0–M7 acceptance, are outside this
slice.
