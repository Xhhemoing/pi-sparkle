# pi-sparkle SOTA persistent optimization — orchestrator log

- **Branch:** `agent/sota-persistent-opt-7e63`
- **SOP alias:** `agent/sota-persistent-opt`
- **Started:** 2026-08-24
- **Parent:** Cursor Grok 4.6 orchestrator (3-round × 6-agent loop)
- **Goal:** Polish every plane of pi-sparkle to SOTA quality without claiming Outcome-supported, F-PROD, or live R1/bandit/topology. Never auto-promote. Keep ADR-004/005/006 honesty.

## Loop protocol

Each round dispatches **6 concurrent subagents** with exclusive file ownership:

| Slot | Model slug | Role |
|---|---|---|
| fable-1 | `claude-fable-5-thinking-xhigh` | Global architecture / SOTA audit |
| fable-2 | `claude-fable-5-thinking-xhigh` | Isolation, privacy-claim, ADR honesty review |
| opus-1 | `claude-opus-5-thinking-high-fast` | Core implementation A |
| opus-2 | `claude-opus-5-thinking-high-fast` | Core implementation B |
| gpt-sol-1 | `gpt-5.6-sol-xhigh-fast` | Benchmarks / persist stress |
| gpt-sol-2 | `gpt-5.6-sol-xhigh-fast` | Boundary probes / package hygiene |

Subagents **do not git commit**. Parent commits, pushes, and updates the PR after each round.

## Known baseline (main @ `4a59949`)

Evidence from `docs/reports/2026-08-22-weak-areas-data-collection.md` and `docs/status-matrix.md`:

1. `redactPII` labels only — email/IP/phone/card/path/secret *values* survive (`src/feedback/redaction.ts`).
2. No 429 Retry-After / backoff at the Pi executor (`src/pi-adapter/`).
3. Error invocations can record `tokensIn: 0` despite “unavailable is undefined, never zero”.
4. Doctor output is prose-only — no frozen `--json` contract.
5. Legacy flat state-root paths are invisible (fail-closed) with no migrate command or doctor warning.
6. Published build inherits `sourceMap`/`declarationMap` from root tsconfig (pack bloat).
7. Retention unbounded; doctor Node engine is `>=22.19.0` while some environments run 22.14.0.
8. Real-provider coverage of `--children` / `--track` still thin. Checkpoint F-PROD stays open.

## Round 1 — initial build & baseline (in flight)

Exclusive ownership (do not touch another slot’s files):

| Slot | Owns |
|---|---|
| fable-1 | `.agent_workspace/round1-fable1.md`, `docs/reports/2026-08-24-sota-architecture-audit.md`; may honesty-patch `docs/status-matrix.md`, `CONTRIBUTING.md` |
| fable-2 | `.agent_workspace/round1-fable2.md`, `docs/reports/2026-08-24-sota-isolation-privacy.md`; may honesty-patch `docs/data-dictionary.md`, `docs/decisions/*.md` |
| opus-1 | `src/feedback/redaction.ts`, `test/unit/feedback/**`, `test/unit/privacy/redaction.test.ts`, `test/integration/m3/redaction.test.ts`, `src/cli/doctor.ts`, `src/cli/doctor-overlay.ts`, `test/unit/cli/doctor*.ts` |
| opus-2 | `src/pi-adapter/**`, `test/unit/pi-adapter/**`, `test/integration/pi-adapter/**`, `src/telemetry/**`, `test/unit/telemetry/**`, new `src/cli/migrate-legacy.ts` + its tests; **minimal** `src/cli/main.ts` switch/USAGE for `migrate-legacy` only |
| gpt-sol-1 | `scripts/bench-runtime.mjs`, `test/unit/persist/**`, `src/persist/**` (bugfix only), `.agent_workspace/round1-gptsol1.md` |
| gpt-sol-2 | `tsconfig.build.json` (strip maps), `scripts/security-probe.mjs`, `test/unit/domain/**` extra edges, `test/unit/graph/**` extra edges, `.agent_workspace/round1-gptsol2.md` |

**Forbidden to all Round 1 agents:** `README.md`, `package.json`, `pnpm-lock.yaml`, `.github/**`, live R1/bandit/topology on the execution path, Outcome-supported claims.

## Round 1 结论简报

_Pending collection of the six subagent reports._

## Round 2 结论简报

_Not started._

## Round 3 结论简报

_Not started._
