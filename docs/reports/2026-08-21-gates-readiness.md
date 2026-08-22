# Policy gates readiness — 2026-08-21

Decision package for the human-owned gates in
[status-matrix.md](../status-matrix.md). Evidence is as of commit
`d7ab292` (suite: 1110 tests, gate green). Nothing here closes a gate;
it makes each decision a single review.

## Outcomes (decided 2026-08-21)

- **ADR-004: Accepted.** Owner ratified the runtime/adaptation separation
  after reviewing the shipped guardrails.
- **Six adaptive defaults: Approved, unchanged.** Ratified as already-
  enforced behavior.
- **ADR-006: Kept Proposed.** No `extensions/pi-sparkle/` import until
  revisited after the F line.
- **Checkpoint D: Closed.** Whole-checkpoint scenarios verified.
- **P0 privacy: still open** — independent review remains outstanding.
- **Checkpoint F-PROD: still blocked** on P0 + provider smoke + F0–F7.

## Gate states at a glance

| Gate | Status | Decision needed |
|---|---|---|
| ADR-004 (controlled adaptation) | **Proposed** | Accept or revise |
| ADR-005 (F holdout evidence) | **Accepted** (2026-08-19) | none — target locked; F0–F7 prerequisites remain work, not decisions |
| ADR-006 (Pi extension reverse adapter) | **Proposed** | Accept or reject before any `extensions/pi-sparkle/` import |
| Six adaptive defaults (spec §842) | open for approval | Ratify or revise — all six are already enforced by shipped code |
| P0 privacy preflight | dictionary exists; `record-classes` suite green | Independent review sign-off (human) |
| Checkpoint D closure | scenarios assembled (`checkpoint-d.test.ts`), M3 leftovers closed | Adaptive-owner sign-off against the plan's whole-checkpoint list |
| Checkpoint F-PROD | not started | Blocked on P0 + provider smoke + F0–F7 line |

## Per-gate evidence

### ADR-004 — accept means ratifying what already ships

The proposal separates live execution from controlled adaptation. The
implementation matches it: R1/bandit/topology are shadow/offline only
(`src/routing/`, exercised but never imported by live paths), promotion is
CAS-after-approval (`adapt promote` refuses without review provenance —
locked by `test/integration/cli/commands.test.ts`), and nothing in this repo
is Outcome-supported. Accepting ADR-004 changes one status line in
`docs/decisions/0004-controlled-adaptation.md` from Proposed to Accepted.

Risk of accepting: none identified beyond what already ships. Risk of
delaying: the "Proposed" label keeps the adaptive line formally provisional
while its guardrails are load-bearing.

### Six adaptive defaults — ratification, not new behavior

Spec §"Decision required" lists six defaults. Each maps to shipped,
tested enforcement:

1. *M0–M2 first* — process default; M0–M2.5 rows are Exercised.
2. *Propose-then-approve promotion* — CAS + refusal without provenance.
3. *No weight training before M7* — training stays out of this runtime.
4. *No raw conversation bodies in datasets* — record classes exclude them;
   redaction chain integration-tested.
5. *High-risk work excluded from online exploration* — routing hard filters.
6. *"Improved" = held-out benefit without guardrail regression* — the
   Outcome-supported bar; still unmet by design until F-PROD.

### ADR-006 — decision blocks an import, nothing else

Accepting would permit building `extensions/pi-sparkle/` as a Pi extension.
Rejecting keeps the diagnostic-overlay posture (`/skill:pi-sparkle`,
`/sparkle` prompt) indefinitely. No code waits on this; it is a pure
direction call.

### P0 privacy

Inputs verified 2026-08-21: [data-dictionary.md](../data-dictionary.md)
lists all 13 durable record classes sourced from
`DURABLE_RECORD_CLASSES`; `pnpm test -- test/unit/privacy/record-classes.test.ts`
is green (2/2). Remaining input is the independent review itself — outside
agent scope by definition.

### Checkpoint D

All M3 leftover items closed 2026-08-21 with fail-closed episode reducer,
provenance, packet fidelity, evaluation identity, telemetry attribution, and
the seven-scenario assembly in
[test/integration/m3/checkpoint-d.test.ts](../../test/integration/m3/checkpoint-d.test.ts).
Sign-off = walking that scenario list against the plan.

### Checkpoint F-PROD path (per accepted ADR-005)

Ordered prerequisites, none gated on a further policy decision:
provider smoke (`PI_SMOKE=1`, credentials required) → F0 freeze → F1
eligibility → F2 exposure/outcome schema → F3 cascade+cost telemetry → F4
feature-version approval naming → F5 public prior into R0 → F6 shadow +
legal holdout → sealed paired evaluation under decision 1's CI gates.

## Stale claims corrected this pass

- `tasks/todo.md`: the ADR-005 resolution item was split — cost-quality
  target is locked by the Accepted ADR; only the holdout data source
  (inside F6) remains, which is work inside F-PROD, not a separate gate.
- `docs/data-dictionary.md`: cross-stream refs and multi-run attach are now
  fail-closed and tested (M3-T1); tombstone propagation covers dataset
  exports and materialized views.
