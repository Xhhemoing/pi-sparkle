# Controlled improvement implementation — verification record

## Identity

- Branch: `codex/controlled-improvement-20260925`.
- Date/environment: 2026-09-25, Windows, `E:\Project\pi-sparkle`.
- Scope: reconcile the workspace around the corrected critical path and finish the current native bridge, projection safety, pre-S0 read-only evaluator-manifest candidate, and D1 bounded diagnosis author candidate.

## Delivered behavior

- Native routing uses one eligible host-model snapshot for catalog, capability, and dispatch; aliases canonicalize before persistence; credentials remain host-owned; model snapshots and the capability array are runtime-frozen.
- Observation projection derives sensitivity from the read request and content before storage, refuses credential-like paths/content, and returns a structured recall-budget refusal.
- The read-only evaluator manifest candidate is detached and recursively frozen, validates opaque identities and B/C routing parity, rejects duplicate ledger tasks, and binds results without authorizing a pilot.
- EventStore/JSONL now supports real fail-closed byte/record limits. Inspection reads at 4 MiB/20,000 events and exposes a read-only evidence-gap view in prose while preserving pure event NDJSON and the four-key summary JSON contract.
- Local root artifacts were moved under `.agent_workspace/archived/`; the local pnpm store is ignored.

## Verification

| Command | Result |
|---|---|
| Combined focused native/projection/evaluator set | 56 passed, 0 failed |
| D1 EventStore/inspection set | 43 passed, 0 failed |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm workflow:check` | PASS |
| `pnpm security:probe` | 26 passed, 0 open findings, 0 refused waivers |
| `pnpm pi:probe` | 4 PASS checks on Pi 0.86.1 pins/import boundary |
| `pnpm gate` | 2874 passed, 0 failed, 18 skipped; build PASS |
| `git diff --check` | PASS; only existing CRLF normalization warnings |

## Review and open gates

- The corrected native multi-model bridge received fresh independent specification and quality PASS reviews. The final capability-freeze and scope-exclusion minors are covered by the combined focused set and full gate.
- Projection, the read-only evaluator-manifest candidate, and D1 have author-run command evidence. B0 and D1 acceptance remain open, and a fresh independent integrated review remains required before treating the combined workspace as independently accepted.
- The read-only evaluator manifest is pre-S0 evidence, not the S0-min freeze. S0-min must still freeze the host-owned terminal outcome DTO, trusted source/binding rules, failure attribution, and the single canonicalizer. The D1 host-outcome resolver remains intentionally unconnected until S0-min/L1 supplies that frozen neutral host outcome.
- No live-provider run, exploratory pilot, production apply authorization, F6/F-PROD closure, or Outcome-supported claim follows from this gate.

## Handoff

- Controlling sequence: accept B0, review D1 in isolation while obtaining the owner/reviewer S0-min freeze, then connect L1 to the frozen neutral host-outcome contract and build the candidate-only L2 historical view.
- Related records: [native bridge](2026-09-25-native-multimodel-bridge.md), [projection boundary](2026-09-25-projection-secret-boundary.md), [read-only evaluator](2026-09-25-readonly-evaluator-candidate.md), and [D1 evidence gap](2026-09-25-native-evidence-gap-d1.md).
