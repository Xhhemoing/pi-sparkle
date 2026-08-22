# Active checklist

Archived: [M0–M2.5](archive/m0-m2-todo.md), [acceptance](archive/ACCEPTANCE-2026-08-17.md).

## Human / policy gates (block claims, not local fake tests)

- [x] ADR-004 accepted and the six adaptive defaults approved, unchanged (2026-08-21). Exit recorded in [status-matrix.md](../docs/status-matrix.md).
- [ ] Close P0: independent review returned **CONDITIONAL** (2026-08-22): Q3/Q4/Q5 pass; Q1 (plane isolation) and Q2 (delete tooling + cascade) were blockers — both remediated same day (see review package §7). Remaining: reviewer re-verification of the remediation, then sign-off. Package: [2026-08-22-p0-privacy-review-package.md](../docs/reports/2026-08-22-p0-privacy-review-package.md).
- [x] ADR-006 decided (2026-08-21): keep Proposed; no `extensions/pi-sparkle/` Pi import until revisited.
- [x] Cost-quality target resolved: ADR-005 Accepted (2026-08-19) locks the paired CI gates and six decisions.
- [ ] Holdout data source remains open as F6 work inside the F-PROD line; do not start F-PROD before P0 + provider smoke. See [gates readiness](../docs/reports/2026-08-21-gates-readiness.md).

## Three-line program (2026-08-18 final)

- [ ] Phase A: tracking assessment + supervisor gates ([plan](../docs/superpowers/plans/2026-08-18-phase-a-tracking-supervisor.md))
- [ ] Phase B: outcome vector + dual LCB + corrected R1 ([plan](../docs/superpowers/plans/2026-08-18-phase-b-outcome-r1.md))
- [ ] Phase C: offline logit **and** probability-additive attribution; threshold calibration report ([plan](../docs/superpowers/plans/2026-08-18-phase-c-offline-attribution.md))
- [ ] Phase D: proposal-first candidates + CAS ([plan](../docs/superpowers/plans/2026-08-18-phase-d-promotion-cas.md))

See [adaptive-todo.md](adaptive-todo.md) for older M3 leftovers. Do not mark Checkpoint D/F closed from module tests alone.

## Optional M7

- [ ] Review whether consented data justifies external SFT/preference/RL.
- [ ] Keep training infrastructure outside this TypeScript runtime.
