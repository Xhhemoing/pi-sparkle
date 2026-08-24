# File ownership

Parent owns `.agent_workspace/PROGRESS.md`. Subagents never git commit.

## Round 3 (active) — final SOTA pass

| Slot | Owns |
|---|---|
| fable-1 | `.agent_workspace/round3-fable1.md`, `docs/reports/2026-08-24-sota-r3-acceptance.md`, `README.md`, `CONTRIBUTING.md`, `docs/status-matrix.md` |
| fable-2 | `.agent_workspace/round3-fable2.md`, `docs/reports/2026-08-24-sota-r3-isolation.md`, `docs/data-dictionary.md`, `docs/decisions/*.md` (honesty; ADR-006 stays Proposed) |
| opus-1 | `src/feedback/types.ts`, `src/feedback/redaction.ts`, `src/feedback/store.ts`, `test/unit/feedback/**`, `test/integration/m3/redaction.test.ts`, `src/pi-adapter/auth-session.ts`, `test/unit/pi-adapter/` auth-session tests only (new file ok), `.agent_workspace/round3-opus1.md` |
| opus-2 | `src/learning/auto-loop.ts`, `test/unit/learning/auto-loop.test.ts`, `src/privacy/deletion.ts` (run-event EPISODE_OPENED scrub or documented recipe), `test/unit/privacy/deletion.test.ts`, `test/integration/cli/delete.test.ts`, `.agent_workspace/round3-opus2.md` |
| gpt-sol-1 | `src/pi-adapter/cluster-tools.ts` (tests-only preferred; tiny hardening ok), NEW `test/unit/pi-adapter/cluster-tools.test.ts`, NEW `scripts/retention-probe.mjs`, `.agent_workspace/round3-gptsol1.md` |
| gpt-sol-2 | `test/integration/cli/commands.test.ts` (add promote USAGE assertion only), `test/acceptance/evidence-invariant.test.ts`, `scripts/bench-runtime.mjs`, `.agent_workspace/round3-gptsol2.md` |

Do not edit `src/cli/main.ts` in Round 3 (parent already expanded `adapt promote` USAGE). Do not enable live R1. Do not auto-promote. Do not claim Outcome-supported. Do not close P0 human sign-off.
