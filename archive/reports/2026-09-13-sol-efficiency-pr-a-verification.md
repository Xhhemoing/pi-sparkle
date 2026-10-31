# PR-A harness-efficiency verification (2026-09-13)

Branch `grok/sol-efficiency` at base `8dd31e9ea9215dcfb74e0029331857cd4190df97`.
Offline aggregator + thin CLI only. Runtime CLI / ExecutionEvent / observation store untouched.

## RED

```
pnpm test -- test/unit/telemetry/harness-efficiency.test.ts test/integration/telemetry/harness-efficiency-cli.test.ts
```

Failed as missing modules (`ERR_MODULE_NOT_FOUND` for `src/telemetry/harness-efficiency.js` and `scripts/analyze-harness-efficiency.ts`), not environment breakage. 8 fail / 1 incidental CLI pass (spawn exit 1 on missing script) / 0 skip.

## GREEN (focused)

Same command after implementation:

- tests 20
- suites 3
- pass 20
- fail 0
- skipped 0

Unit: 12 behaviors (`analyzeHarnessEfficiency` 8 + `parseEfficiencyJsonl` 4).
CLI: 8 cases (complete fixture, required flags, invalid sentinel non-leak, missing.jsonl unknowns, missing file, 16 MiB cap).

## Manual CLI

```
pnpm exec tsx scripts/analyze-harness-efficiency.ts --input test/fixtures/harness-efficiency/complete.jsonl --evidence-class synthetic --json
```

Exit 0. Report: `rowCount=3`, `pairedRows=1`, `unknownRows=2`, `pairedReductionRatio=0.75`, `monetarySavingUsd=null`, `evidenceClass=synthetic`.

## Gate

```
pnpm gate
```

Exit 0.

- typecheck: pass
- lint: pass
- test: 2648 tests, 2647 pass, 0 fail, 1 skip (`PI_SMOKE` real-provider smoke; pre-existing)
- build: pass

Duration ~59s.

## Scope check

Not modified: `src/cli/main.ts`, `package.json` scripts, ExecutionEvent, ModelInvocation, pi-executor, observation store.
