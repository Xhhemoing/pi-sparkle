# PS-P4 trusted experiment verification (2026-09-13)

## Scope

F6 hard gate: equivalent R0/R1 arms, freeze, observation ledger dedupe, independent oracle / paired analysis, evidence retention. Continue from P3 tip `950b9ef`.

Out of scope: sealing F6 Week-1 collection; live provider holdout runs; P5; Soul; F-PROD promotion claims.

## Done bar

1. **Equivalent arms** — `compileEquivalentArms` builds one full multi-task taskSpec for both arms (not `tasks[0]`). `taskFamily` from `spec.family` (fixed `"holdout"` rejected). Real catalog / price-table prices (missing → fail closed). Injectable `nowMs` (no `Date.now` in sealed path).
2. **Freeze** — `createExperimentFreeze` / `validateExperimentFreeze`: config hash, catalog snapshot, dirs, build provenance, clock. Empty freeze / empty provenance record sets / missing provider+default config fail closed.
3. **Observation ledger** — `observationIdentity` + `updateProjectBanditDeduped`; wired from `runAutoAdaptLoop`. Same signal cannot double-apply a bandit reward.
4. **Oracle / pairing** — `classifyArmOutcome` / `analyzePairedArms` split collection vs task vs telemetry vs `evidenceClass`. Harness UNKNOWN ≠ `production-candidate`. Independent oracle label preferred when present.
5. **Evidence retention** — `DEFAULT_HOLDOUT_EVIDENCE_RETENTION = keep-raw`; `assertHoldoutEvidenceDeletionAllowed` wired through `src/privacy/retention.ts`. Durable classes `observation-ledger` + `holdout-arm-evidence`.
6. **Tests + gate** — focused unit coverage + independent `pnpm gate`; tip freeze; no merge.

## Modules

| Module | Role |
| --- | --- |
| `src/experiments/task-spec.ts` | Validate + compile equivalent R0/R1 taskSpecs |
| `src/experiments/freeze.ts` | Freeze record (config/catalog/dirs/provenance/clock) |
| `src/experiments/arm-outcome.ts` | Task-fail vs collect-fail + auditable pairing |
| `src/experiments/evidence-retention.ts` | keep-raw vs aggregates-only policy |
| `src/learning/observation-ledger.ts` | Dedupe before bandit update |
| `scripts/holdout-block.mjs` | Thin runner; requires `--now-ms`; price table; library compile |

## Tests

- `test/unit/experiments/task-spec.test.ts`
- `test/unit/experiments/freeze.test.ts`
- `test/unit/experiments/arm-outcome.test.ts`
- `test/unit/experiments/evidence-retention.test.ts`
- `test/unit/experiments/holdout-block-script.test.ts`
- `test/unit/experiments/holdout-block-evidence.test.ts`
- `test/unit/learning/observation-ledger.test.ts`

## Gate

```
pnpm gate
exit: 0
tests: 2711 total; pass 2710; fail 0; skipped 1; suites 142; duration_ms ~26943
tip-before: 950b9ef154bbe0ad795f098ab359aff99d957805
```

## Residuals

- Not sealing F6 Week-1 collection or running live provider holdout blocks in this tip.
- Holdout script still orchestrates worktrees; compile/oracle/freeze/ledger logic is library-owned and unit-tested.
- No P5 / no F-PROD close / no Soul.
