# PR-B observation store + projection verification (2026-09-13)

Branch `grok/sol-efficiency` continuing from PR-A tip `51e906d`.
Run-scoped observation archive + offline projection only. No live Pi executor / CLI main wiring.

Interfaces aligned to `2026-09-13-sol-pi-grok-handoff.PARTIAL.md`.

## Scope

Created:
- `src/context/observation-store.ts` — `ObservationStore` put/recall
- `src/context/observation-projection.ts` — `projectObservation`
- `test/unit/context/observation-store.test.ts`
- `test/unit/context/observation-projection.test.ts`
- `test/integration/context/observation-lifecycle.test.ts`
- `test/fixtures/observation/synthetic-64kib.txt`

Modified:
- `src/privacy/record-classes.ts` (+ `run-observation`)
- `test/unit/privacy/record-classes.test.ts`
- `docs/data-dictionary.md`, `docs/status-matrix.md`
- `src/privacy/state-layout.ts` (plane comment)
- `tasks/plan.md`, `tasks/todo.md`

## RED → GREEN (focused)

```
pnpm test -- test/unit/context/observation-store.test.ts \
  test/unit/context/observation-projection.test.ts \
  test/integration/context/observation-lifecycle.test.ts \
  test/unit/privacy/record-classes.test.ts
```

After implementation fixes (lifecycle paging, quota byte math, lock-hold pattern):

- tests 30
- pass 30
- fail 0

## Regression

```
pnpm test -- test/unit/privacy/deletion.test.ts \
  test/integration/cli/delete.test.ts \
  test/integration/m3/packet-fidelity.test.ts \
  test/unit/pi-boundary.test.ts \
  test/unit/routing/live-isolation.test.ts
```

- tests 85 / pass 85 / fail 0

## Gate / probes

```
pnpm gate
```

Exit 0.

- typecheck: pass
- lint: pass
- test: 2668 tests, 2667 pass, 0 fail, 1 skip (`PI_SMOKE` real-provider smoke; pre-existing)
- build: pass

Duration ~56s.

```
pnpm security:probe
```

Exit 0. `status=ok`, passed=26, openFindings=[].

```
pnpm pi:probe
```

Exit 0. Pins 0.85.1; legacy GoogleThinkingLevel absent; ThinkingLevel import path OK.

## Contracts pinned

- Path: `runtime/runs/<runId>/observations/objects/<sha256>.txt`
- Caps: 8 MiB/object, 64 MiB/run; run lock on put/recall; symlink refusal; 0700/0600
- Projection: enabled=false identity; eligibility >10240 + pureText + !error + !receipt; priorFullSends 0|1 full, ≥2 placeholder ≤2048
- `deleteRunRecords` clears archive via run subtree rm; class declared on `run-event.deletionPropagatesTo`
