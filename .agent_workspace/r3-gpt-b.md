model: gpt-5.6-sol-xhigh-fast

# R3 GPT-B — market-eval wiring and release-gate truth-up

## Outcome

- Added `market-eval:probe` as `node scripts/market-eval-probe.mjs`.
- Preserved `private: true` and kept `preview:probe` first in `prerelease`.
- Documented that the CI quality job runs `pnpm security:probe` after build with no waiver.
- Documented the probe's never-waive filter for `packaged-secrets`.
- Replaced the stale preview-probe section with its current prerelease-bar role.
- Kept the GREEN evidence dated 2026-08-25 with 14 passed checks because no screaming-snake sample was present in `scripts/security-probe.mjs`.

## Verification

- PASS — `pnpm test -- test/unit/package/market-eval-probe.test.ts test/unit/package/preview-release-probe.test.ts` (4 tests).
- PASS — `pnpm market-eval:probe`.
- PASS — `pnpm preview:probe` (5 checks).
- The commands warned that active Node.js `v22.14.0` is below the unchanged package requirement `>=22.19.0`.

## Files written

- `package.json` (scripts only)
- `docs/specs/release-gate.md`
- `.agent_workspace/r3-gpt-b.md`

## Opus-A follow-up

- Re-dated the GREEN evidence after opus-A landed two screaming-snake
  `secret-bodies` samples: 16 checks passed with no open or waived findings.
  This supersedes the earlier 14-check note.
- PASS — `pnpm build && node scripts/security-probe.mjs`.
