# Developer Preview readiness — 2026-08-20

Position: **local developer preview / experimental runtime**. Not a stable
deliverable product. Adaptive routing is **not** Outcome-supported.

## Quality gate (this change)

Commands:

```bash
pnpm install --frozen-lockfile
pnpm gate   # typecheck && lint && test && build
```

Fill after a fresh gate run:

- Node: v24.18.0 (engines `>=22.19.0`)
- pnpm: 10.17.1 (`packageManager` pnpm@10.17.1)
- tests: **1008** total — **1005** pass, **0** fail, **3** skipped
- `git diff --check`: clean (exit 0)
- pnpm `onlyBuiltDependencies` warning: gone after move to `pnpm-workspace.yaml`
- `pnpm install --frozen-lockfile`: lockfile up to date
- `pnpm typecheck` / `pnpm lint` / `pnpm build`: exit 0

Skipped tests: `--children`→flowchart compile (not the CLI path), children-through-flowchart supervisor (deps removed), real-provider smoke (`PI_SMOKE=1`).

## Fake executor path

Usable locally:

```bash
pnpm cli doctor --project .
pnpm cli run --project . --objective "…"
pnpm cli run --project . --objective "…" --children tasks.json
pnpm cli inspect --run <runId>
```

`--children` without `--executor pi` uses the child fake executor.

## Real provider path

Opt-in. Missing credentials must fail clearly (`--executor pi` requires
`models set-default` or `PI_PROVIDER`/`PI_MODEL`). Smoke:

```bash
PI_SMOKE=1 PI_PROVIDER=… PI_MODEL=… PI_API_KEY=… pnpm test -- test/integration/pi-adapter/provider-smoke.test.ts
```

Without those env vars the smoke test skips with an explicit reason.

## Governance still open

- ADR-004 remains Proposed.
- Six adaptive defaults still need human approval.
- P0 privacy review is not closed; the dictionary exists and is tested.
- F-PROD sealed holdout is not started. Live R1 stays off.

See [status-matrix.md](../status-matrix.md) and [data-dictionary.md](../data-dictionary.md).
