# File ownership — Loop 3 Round 1

Parent owns `.agent_workspace/PROGRESS.md`. Subagents never git commit.

If two slots need `src/cli/main.ts`, stay inside the function region listed. Do not reformat the rest of the file. Nobody else edits `package.json` except gpt-sol-1 (one scripts key, optional).

| Slot | Owns |
|---|---|
| fable-1 | `.agent_workspace/loop3-r1-fable1.md`, `docs/reports/2026-08-24-sota-loop3-architecture.md`, `README.md` (INSPECT_SUMMARY freeze + honesty only), `docs/status-matrix.md` |
| fable-2 | `.agent_workspace/loop3-r1-fable2.md`, `docs/reports/2026-08-24-sota-loop3-isolation.md`, `docs/data-dictionary.md` |
| opus-1 | `src/run/inspection.ts` (export frozen `InspectSummaryJson` + builder), `src/cli/main.ts` **only** `inspectCommand` (use the builder; `--json` stays event NDJSON), `test/unit/run/inspection.test.ts`, NEW `test/integration/cli/inspect-summary.test.ts` |
| opus-2 | `src/feedback/store.ts` (locked append + rewrite, invocation-log pattern), `src/privacy/deletion.ts` **only** `cascadeFeedbackTombstones` (take the same lock for rewrite + tombstones), NEW `test/unit/feedback/store-lock.test.ts`, existing `test/unit/feedback/` tests if they must follow the lock |
| gpt-sol-1 | `src/telemetry/invocation-log.ts` (one bounded retry on lock timeout, then still drop), `test/unit/telemetry/invocation-log.test.ts`, NEW `scripts/invocation-lock-probe.mjs`, `package.json` **scripts only** (`invocation:probe` key, no dep bumps) |
| gpt-sol-2 | NEW `test/unit/privacy/adaptation-plane-closure.test.ts` (value-import transitive walker over adaptation dirs; pin runtime-prefix allowlist + model-router no-fs subtree). Do **not** edit `test/unit/routing/live-isolation.test.ts`. Optional: `src/` scan that computed `import(expr)` is absent |

**Forbidden:** live R1/bandit/topology on the execution path, Outcome-supported, ADR-006 Accepted, P0 sign-off, auto-promote, `package.json` dependency bumps, closing F-PROD, inventing a `--children` contract, default retention bounds (unbounded stays the default).
