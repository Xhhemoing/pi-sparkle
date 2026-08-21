# Active checklist

Archived: [M0–M2.5](archive/m0-m2-todo.md), [acceptance](archive/ACCEPTANCE-2026-08-17.md).

## Human / policy gates (block claims, not local fake tests)

- [ ] Accept or revise ADR-004 (still Proposed) and the six adaptive defaults. Owner/exit: [status-matrix.md](../docs/status-matrix.md).
- [ ] Close P0: dictionary exists at [data-dictionary.md](../docs/data-dictionary.md); independent privacy review has no blocker.
- [ ] Accept or reject ADR-006 before any `extensions/pi-sparkle/` Pi import.
- [ ] Resolve ADR-005 cost-quality target and holdout data source (Checkpoint F item 1). Do not start F-PROD before P0 + provider smoke.

## Three-line program (2026-08-18 final)

- [ ] Phase A: tracking assessment + supervisor gates ([plan](../docs/superpowers/plans/2026-08-18-phase-a-tracking-supervisor.md))
- [ ] Phase B: outcome vector + dual LCB + corrected R1 ([plan](../docs/superpowers/plans/2026-08-18-phase-b-outcome-r1.md))
- [ ] Phase C: offline logit **and** probability-additive attribution; threshold calibration report ([plan](../docs/superpowers/plans/2026-08-18-phase-c-offline-attribution.md))
- [ ] Phase D: proposal-first candidates + CAS ([plan](../docs/superpowers/plans/2026-08-18-phase-d-promotion-cas.md))

See [adaptive-todo.md](adaptive-todo.md) for older M3 leftovers. Do not mark Checkpoint D/F closed from module tests alone.

## Optional M7

- [ ] Review whether consented data justifies external SFT/preference/RL.
- [ ] Keep training infrastructure outside this TypeScript runtime.
