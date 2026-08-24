# File ownership

Parent owns `.agent_workspace/PROGRESS.md`. Subagents never git commit.

## Round 1 (closed)

See historical table in PROGRESS.md. Do not rewrite Round 1 files unless you own the same path in Round 2.

## Round 2 (active)

If a change needs a file you do not own, write the request into `Blocked / handoff`. Do not edit it.

| Slot | Owns |
|---|---|
| fable-1 | `.agent_workspace/round2-fable1.md`, `docs/reports/2026-08-24-sota-r2-architecture.md`, `README.md`, `docs/specs/m0-m2-architecture.md`, `docs/status-matrix.md` |
| fable-2 | `.agent_workspace/round2-fable2.md`, `docs/reports/2026-08-24-sota-r2-isolation.md`, `docs/data-dictionary.md`, `docs/decisions/*.md` (honesty only) |
| opus-1 | `test/unit/routing/live-isolation.test.ts`, `test/unit/privacy/plane-boundary.test.ts`, `src/routing/r0.ts` (header comment only), `src/supervisor/flowchart.ts` (delete if still zero importers), `.agent_workspace/round2-opus1.md` |
| opus-2 | `src/privacy/deletion.ts`, `src/privacy/record-classes.ts`, `test/unit/privacy/**` except `plane-boundary.test.ts`, `test/integration/cli/delete.test.ts`, `src/routing/cost-calibration.ts`, `test/unit/routing/` cost-calibration tests only, `.agent_workspace/round2-opus2.md` |
| gpt-sol-1 | `package.json` (test script only — do not bump deps), `scripts/run-tests.mjs` if needed, `src/learning/bandit-store.ts`, `test/unit/learning/**`, `.agent_workspace/round2-gptsol1.md` |
| gpt-sol-2 | `test/acceptance/**` evidence invariant, `test/unit/run/checkpoint-store.test.ts` (add crash cases), `scripts/bench-runtime.mjs` (optional extra fields), `.agent_workspace/round2-gptsol2.md` |

**Forbidden to all Round 2 agents:** live R1/bandit/topology on the execution path, Outcome-supported claims, flipping ADR-006 to Accepted, closing P0 human sign-off, auto-promotion.
