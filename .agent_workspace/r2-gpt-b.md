model: gpt-5.6-sol-xhigh-fast

# R2 GPT-B — preview probe wiring

## Outcome

- Added `preview:probe` as `node scripts/preview-release-probe.mjs`.
- Made `preview:probe` the first command in `prerelease`.
- Preserved `private: true` and `engines.node` unchanged.
- Did not add `market-eval:probe` because `scripts/market-eval-probe.mjs` was absent when this slot started.
- Added a focused unit test for probe existence and exact prerelease wiring.

## Verification

- PASS — `pnpm test -- test/unit/package/preview-release-probe.test.ts` (1 test).
- PASS — `node scripts/preview-release-probe.mjs` (`status: ok`, 5 checks).
- The test command reported that the active Node.js v22.14.0 is below the unchanged package requirement `>=22.19.0`.

## Files written

- `package.json` (scripts only)
- `test/unit/package/preview-release-probe.test.ts`
- `.agent_workspace/r2-gpt-b.md`
