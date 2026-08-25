# Developer Preview readiness — 2026-08-20

Position: **local developer preview / experimental runtime**. Not a stable
deliverable product. Adaptive routing is **not** Outcome-supported.

> **Partly superseded.** The sections below are the 2026-08-20 snapshot and are
> kept as the dated record; their numbers and the governance list have since
> moved. Operators running the 内测 should read the
> [2026-08-25 addendum](#2026-08-25-addendum--内测-operator-brief) first.

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

## 2026-08-25 addendum — 内测 operator brief

Written on `cursor/merge-preview-release-8011`. What "发行内测" means here:
**`pnpm prerelease` green plus this documented preview**. It is not an npm
publish. `package.json` keeps `private: true`, and no step below changes that.

### Gate commands

```bash
pnpm install --frozen-lockfile
pnpm gate            # typecheck && lint && test && build
pnpm build && pnpm security:probe   # the probe reads dist/; build first
pnpm pi:probe
# all of the above, in order:
pnpm prerelease
```

`pnpm prerelease` is `pnpm gate && pnpm security:probe && pnpm pi:probe` —
three bars, not two. Full detail and the current status line live in
[release-gate.md](../specs/release-gate.md).

Live results from this branch, 2026-08-25 ~15:55 UTC (Node `v22.14.0`, pnpm
`10.17.1`):

| bar | result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm test` | 2070 tests, 2069 pass, 0 fail, 1 skipped (exit 0) |
| `pnpm build` | exit 0 |
| `node scripts/security-probe.mjs` | `{"status":"ok","passed":14,"openFindings":[],"waivedFindings":[]}` (exit 0) |
| `node scripts/pi-compat-probe.mjs` | 4 PASS (exit 0) |

The single skipped test is the opt-in real-provider smoke
(`PI_SMOKE=1` unset). The 2026-08-20 counts above (1008 total / 3 skipped) are
superseded. These runs were taken in a working tree that also held sibling
agents' uncommitted Round 1 work; parent must re-run the gate on the committed
tree before calling it.

CI does **not** run either probe — `.github/workflows/ci.yml` runs
typecheck/lint/test/build plus a CLI smoke on Linux and Windows. Probe status is
a dated local claim; re-run it rather than trusting a doc.

### Node pin

- `engines.node` is `>=22.19.0`; `packageManager` is `pnpm@10.17.1`.
- This VM runs Node `v22.14.0`, which does **not** satisfy the range. pnpm
  prints `WARN Unsupported engine: wanted: {"node":">=22.19.0"} (current:
  {"node":"v22.14.0","pnpm":"10.17.1"})` on every script and continues; there is
  no `.npmrc`, so `engine-strict` is off. Everything above passed anyway, but
  that is tolerance, not support.
- CI installs `22.x`, which resolves to a current 22 and does satisfy the range.
- Operator guidance: run the 内测 on Node `>=22.19.0`. If you must use an older
  22, say so when reporting results — an off-pin run is not evidence about the
  supported runtime.

### Fake path vs real Pi path

Default is the **fake** executor. Nothing below calls a provider or the network:

```bash
pnpm cli doctor --project .
pnpm cli run --project . --objective "…"
pnpm cli run --project . --objective "…" --children tasks.json
pnpm cli inspect --run <runId>
```

`--children` without `--executor pi` uses the child fake executor. Two fake-path
honesty notes operators hit first: plain `--children` starts **without** a
requirement contract (`skipContract: true`), so the coverage gate never fires on
that path — use `--track` for a coverage-gated start; and `--max-cost-usd` is
**recorded and forwarded but not enforced** on the fake executor, so proof there
is that the number reaches the records, not that spend stopped.

The **real Pi path** (`--executor pi`) is opt-in and needs credentials; missing
ones fail clearly. Deterministic coverage is the offline loopback HTTP
integration test. The real-provider smoke stays opt-in:

```bash
PI_SMOKE=1 PI_PROVIDER=… PI_MODEL=… PI_API_KEY=… \
  pnpm test -- test/integration/pi-adapter/provider-smoke.test.ts
```

Without those env vars it skips with an explicit reason. It also wants Node
`>=22.19.0`.

### Still open — do not claim these closed

- **ADR-006 stays Proposed.** No Pi extension is registered: `package.json#pi`
  declares only `skills` and `prompts`, and `@earendil-works/pi-coding-agent` is
  not a dependency. (Correction to the 2026-08-20 list above: it named ADR-004,
  which was Accepted 2026-08-21 along with the six adaptive defaults. ADR-006 is
  the one still Proposed.)
- **P0 privacy needs human sign-off.** The dictionary exists, the delete cascade
  is implemented and tested, and the release gate's redaction findings are
  closed — none of that is the reviewer's Q1/Q2 re-verification. The gate going
  GREEN does not close P0.
- **F-PROD sealed holdout has not started** (ADR-005), so live R1, bandit, and
  topology stay off the execution path and **nothing is Outcome-supported** —
  including anything the 内测 appears to show working.
- **Retention is unbounded** for `runtime/invocations.jsonl` and
  `runtime/episodes/`; `scripts/retention-probe.mjs` measures it and does not
  gate.
- `packaged-secrets` is documented as never waivable but the probe would still
  honour `SECURITY_WAIVER="packaged-secrets"`. Never set it; see
  [release-gate.md](../specs/release-gate.md#waivers).

See [status-matrix.md](../status-matrix.md) and
[data-dictionary.md](../data-dictionary.md) for the per-capability truth.
