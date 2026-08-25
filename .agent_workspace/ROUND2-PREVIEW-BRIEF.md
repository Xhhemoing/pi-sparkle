# Round 2 — ingest MERGE-NOW + 内测 wiring

**Branch:** `cursor/merge-preview-release-8011`
**Parent:** Cursor Grok 4.6 orchestrator
**Do not git commit / push / checkout.** Stay on this branch.
**First line of every report:** the actual model slug.

## Round 1 facts (do not redo)

- Security probe GREEN (14 passed, 0 open, no waiver). Spec now says GREEN — 2026-08-25.
- Production `redaction.ts` unchanged; pin tests landed.
- `scripts/preview-release-probe.mjs` exists and is green; **not yet** wired in `package.json`.
- Branch audit: MERGE-NOW `origin/cursor/agent-market-eval-opt-cae9` (tip `73e9677`, 0 behind main). PR #9 stays TRACKER-ONLY.

## File ownership (disjoint)

| Slot | Model | Writes | Must not touch |
|---|---|---|---|
| R2-fable-A | `claude-fable-5-thinking-xhigh` | `docs/reports/2026-08-25-r2-sota-review.md`, `.agent_workspace/r2-fable-a.md` | `src/`, `scripts/`, `.github/` |
| R2-fable-B | `claude-fable-5-thinking-xhigh` | `docs/reports/2026-08-25-r2-cherry-pick-plan.md`, `.agent_workspace/r2-fable-b.md` | `src/`, `scripts/` |
| R2-opus-A | `claude-opus-5-thinking-high-fast` | `src/run/inspection.ts`, `test/unit/run/inspection.test.ts`, `test/integration/cli/inspect-follow.test.ts`, `src/cli/main.ts` (follow + USAGE only), `scripts/market-eval-probe.mjs`, `test/unit/package/market-eval-probe.test.ts`, `test/unit/cli/readme-command-parity.test.ts`, `.agent_workspace/r2-opus-a.md` | `scripts/security-probe.mjs`, `src/feedback/`, `.github/` |
| R2-opus-B | `claude-opus-5-thinking-high-fast` | `SECURITY.md`, `CHANGELOG.md`, `.github/CODEOWNERS`, `.env.example` (new from `df964ae`), `src/cli/adapt.ts`, `test/unit/cli/adapt.test.ts`, `test/unit/adaptation/eval-routing.test.ts`, `test/unit/pi-boundary.test.ts`, `src/cli/inspect-format.ts` (create if missing for `fc6058c` verification display), `.agent_workspace/r2-opus-b.md` | `src/cli/main.ts`, `src/run/inspection.ts`, `package.json` |
| R2-gpt-A | `gpt-5.6-sol-xhigh-fast` | `scripts/security-probe.mjs` (never-waive `packaged-secrets`), `.github/workflows/ci.yml` (run `pnpm security:probe` after build, **no** `SECURITY_WAIVER`), `.agent_workspace/r2-gpt-a.md` | `src/` |
| R2-gpt-B | `gpt-5.6-sol-xhigh-fast` | `package.json` **scripts only** (add `preview:probe` and put it first in `prerelease`; add `market-eval:probe` if opus-A created the script), `test/unit/package/preview-release-probe.test.ts` (new), `.agent_workspace/r2-gpt-b.md` | `src/`, `scripts/security-probe.mjs` |

## Tasks

### R2-fable-A — SOTA review of Round 1 + cae9 ingest

Review Round 1 landings against SOTA 内测 bar. Confirm opus-A pin tests actually lock the probe. Confirm opus-B GREEN claims match live probe. Recommend at most 2 Round 3 landings (engines/CI 22.19.0, DATABASE_PASSWORD boundary, early-exit telemetry). No padding.

### R2-fable-B — cherry-pick / port verification

Verify the clean cherry-pick set still applies on this HEAD: `5f49bdc` `38e20c2` `92f00bc` `df964ae` (from `privacy-redaction-adapter-guardrails-f31b` / `review-followups-d47f`). Confirm `808bc0b` must be **reimplemented without waivers** (gpt-A owns CI). Confirm `fc6058c` verification=/unverified is still absent. Do not cherry-pick yourself.

### R2-opus-A — port MERGE-NOW production from cae9

Port unique production from `origin/cursor/agent-market-eval-opt-cae9` (tip `73e9677`) **without** `git merge` of that branch (its `.agent_workspace/` collides with ours). Take: `inspect --run --follow` (inspection.ts + tests), CLI flag/USAGE in `main.ts` only as needed for follow, `scripts/market-eval-probe.mjs` + its unit test, readme-command-parity if required for USAGE export. Skip cae9's colliding `.agent_workspace/*` and do not overwrite kernel-reuse docs unless a one-line status-matrix note is required for `--follow`. Census first. Tests + `tsc --noEmit`.

### R2-opus-B — governance files + adapt-eval honesty + inspect verification display

1. Recreate SECURITY.md / CHANGELOG.md / CODEOWNERS / .env.example from `df964ae` adapted to **current** GREEN gate (empty waiver register; do not tell operators to waive pii-redaction).
2. Port adapt-eval "no quality evidence" + actionDiff tests from `5f49bdc`/`38e20c2` and ADR-006 assertion tests from `92f00bc` if still missing. Do not regress Loop-4 CLI.
3. Hand-port `fc6058c` verification=/unverified display via `src/cli/inspect-format.ts` (do **not** edit main.ts — if wiring must live in main.ts, document the exact patch for parent).

### R2-gpt-A — packaged-secrets never-waivable + CI probe

1. `scripts/security-probe.mjs`: `packaged-secrets` findings must survive `SECURITY_WAIVER`. Other ids remain waivable. Add a comment citing release-gate.md.
2. CI quality job: after Build, run `pnpm security:probe` with **no** waiver env. Probe needs `dist/` (already built).
3. Prove: `SECURITY_WAIVER=packaged-secrets` still fails if you inject a finding, or unit-test the filter with a small node assertion in the report if you cannot safely inject secrets.

### R2-gpt-B — wire preview probe

1. `package.json` scripts: `"preview:probe": "node scripts/preview-release-probe.mjs"` and `prerelease` becomes `pnpm preview:probe && pnpm gate && pnpm security:probe && pnpm pi:probe`.
2. If `scripts/market-eval-probe.mjs` exists when you start, add `"market-eval:probe": "node scripts/market-eval-probe.mjs"` — do not fail the slot if opus-A has not created it yet.
3. New unit test that the script exists and `prerelease` mentions `preview:probe`. Keep `private: true`. Do not change engines.

## Frozen

ADR-006 Proposed. No live R1. No Outcome-supported. No wholesale PR #9 merge. `private: true` stays.
