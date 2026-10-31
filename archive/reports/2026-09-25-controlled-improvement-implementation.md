# Controlled improvement implementation — verification record

## Identity

- Branch: `codex/controlled-improvement-20260925`.
- Corrected integrated candidate: `8e7de99b3d3b196e3b23807d52e4f6b8b59d57dc`.
- Date/environment: 2026-09-25, Windows, `E:\Project\pi-sparkle`.
- Scope: reconcile the workspace around the corrected critical path and finish the current native bridge, projection safety, pre-S0 read-only evaluator-manifest candidate, and D1 bounded diagnosis author candidate.

## Delivered behavior

- Native routing uses one eligible host-model snapshot for catalog and capability; dispatch resolves back to the unchanged host model after an identity-drift check. Capability snapshots omit `Model.headers`, so request credentials are neither read nor copied into the bridge.
- Observation projection derives sensitivity from both the requested path and the read tool's canonical root-relative target before storage, refuses credential-like paths/content (including auth YAML, singular `secret/`, `.ppk`, and in-root aliases into sensitive directories), and returns a structured recall-budget refusal.
- The read-only evaluator manifest candidate is detached and recursively frozen, validates opaque identities and B/C routing parity, rejects duplicate ledger tasks, and binds results without authorizing a pilot.
- EventStore/JSONL now supports real fail-closed byte/record limits, rejects bounded non-zero-offset reads until that contract is implemented, and rejects valid foreign-run events read from another run path. Inspection reads at 4 MiB/20,000 events and requires a non-empty host evidence reference before closing a read-only evidence gap.
- Native result text attributes the canonical model ids actually assigned to tasks. Corrupt learned-routing registry state fails closed before provider calls or run persistence; an absent registry still means no learned policy.
- Local root artifacts were moved under `.agent_workspace/archived/`; the local pnpm store is ignored.

## Verification

| Command | Result |
|---|---|
| Corrected focused native/projection/D1 set | 71 passed, 0 failed |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm workflow:check` | PASS |
| `pnpm security:probe` | 26 passed, 0 open findings, 0 refused waivers |
| `pnpm pi:probe` | 4 PASS checks on Pi 0.86.1 pins/import boundary |
| `pnpm gate` | 2879 passed, 0 failed, 18 skipped; build PASS |
| `git diff --check` | PASS; only existing CRLF normalization warnings |

## Review and open gates

- An independent integrated review of `9b9fbeec` returned **REQUEST CHANGES** on credential-bearing model snapshots, canonical sensitive-path handling, empty D1 evidence references, actual-model attribution, learned-routing error swallowing, and contradictory status records. Corrected revision `7d7cd59b` received a fresh independent **PASS** with 90 focused tests, typecheck, workflow and contract deltas green and no findings.
- Projection, the read-only evaluator-manifest candidate, and D1 have command evidence. B0 and D1 task acceptance remain open; the current-slice PASS is recorded separately and does not impersonate the post-L2 final review.
- The read-only evaluator manifest is pre-S0 evidence, not the S0-min freeze. S0-min must still freeze the host-owned terminal outcome DTO, trusted source/binding rules, failure attribution, and the single canonicalizer. The D1 host-outcome resolver remains intentionally unconnected until S0-min/L1 supplies that frozen neutral host outcome.
- No live-provider run, exploratory pilot, production apply authorization, F6/F-PROD closure, or Outcome-supported claim follows from this gate.

## Handoff

- Controlling sequence: accept B0 and D1 under their task criteria, obtain the owner/reviewer S0-min decision using the [owner freeze package](2026-09-25-stage0-owner-freeze-package.md), then connect L1 to the frozen neutral host-outcome contract and build the candidate-only L2 historical view.
- Related records: [native bridge](2026-09-25-native-multimodel-bridge.md), [projection boundary](2026-09-25-projection-secret-boundary.md), [read-only evaluator](2026-09-25-readonly-evaluator-candidate.md), and [D1 evidence gap](2026-09-25-native-evidence-gap-d1.md).
