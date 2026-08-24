# Loop 2 Round 1 — fable-1

MODEL_SLUG: claude-fable-5-thinking-xhigh

Role: global architecture audit of the four carried-over R3 P1/P2 gaps; docs
honesty (README, status matrix); ranked Round 2 plan. No `src/` edits, no git
commit (per slot instructions).

## Exclusive writes honored

- `.agent_workspace/loop2-r1-fable1.md` (this file)
- `docs/reports/2026-08-24-sota-loop2-architecture.md` (new)
- `README.md` — honesty only: inspect `--summary-json` + `--json` purity,
  children `skipContract: true` note (Quick Start, command table, Parent +
  children section, one "What it does" bullet). Nothing else touched.
- `docs/status-matrix.md` — five rows: fake-executor/inspect (summary-json,
  undeclared stability), `--children` (skip-contract start + loop-2 keep-and-
  document decision), coverage gate (same decision), delete cascade (race
  closed via shared lock; residuals: row drop on lock timeout, cross-process
  order, lock-free readers), telemetry attribution (single locked writer
  surface). All Outcome-supported cells stay **no**.

## Snapshot honesty

Audited HEAD `1b228d3` **and** the shared Round 1 working tree (~16:20 UTC),
which was moving while I worked. State of the four gaps when I finished:

1. **inspect `requiredEvidence`** — implemented in-tree by opus-1:
   `RunInspection.requiredEvidence` (last-writer-wins from latest
   `STALL_DETECTED`/`RUN_BLOCKED`), prose list, opt-in `--summary-json`
   emitting one non-Event `INSPECT_SUMMARY` object; `--json` stays a pure
   event stream (integration tests pin exact line counts, so appending was a
   breaking change). 8 new unit cases.
2. **Locked invocation append** — implemented in-tree by opus-2: new
   `src/telemetry/invocation-log.ts` (path owner + cooperative lock +
   validating locked append + in-process queue); `deletion.ts` rewrite and
   the CLI `onInvocation` hook share the same lock; `cost-calibration`
   re-exports the path. 11 new telemetry tests + 3 deletion race tests.
3. **Plane-boundary comment** — fixed in-tree by gpt-sol-1: accurate
   two-step comment (type-only direct import, runtime value chain via
   `routing/assign`), plus a test pinning the chain and that `model-router`
   stays filesystem-free. `ALLOWED` unchanged.
4. **`--children` skipContract** — still true (`flowchart-run.ts:781`,
   children path passes no contract) **by decision**: document, don't derive.
   My README/matrix edits do the documenting; gpt-sol-2's
   `test/integration/m2.5/cli-contract-honesty.test.ts` landed mid-round and
   pins it (plain `--children` persists only the synthetic `run-complete`
   criterion; child criteria never promoted; `--track` records its extracted
   contract). Verified: 1 pass / 0 fail.

## Verification I ran (shared tree, Node v22.22.2)

- `pnpm exec tsc --noEmit` — clean.
- plane-boundary + inspection + deletion + cost-calibration suites —
  48 pass / 0 fail.
- invocation-log + deletion suites — 32 pass / 0 fail.
- One earlier targeted run hit 2 transient failures while a sibling was
  mid-write; immediate re-runs green twice. Full parent gate over the final
  combined tree is Round 2 P1-1 — nothing counts as closed before it.

## Ranked Round 2 (full detail in the loop2-architecture report §3)

P1: (1) parent gate + security probe over the final tree; (2) declare
`INSPECT_SUMMARY` stability (recommend additive-frozen like doctor `--json`)
+ `test/integration/cli/` coverage; (3) probe the contended locked append /
row-drop-on-timeout so the residual is measured, not just admitted.

P2: (4) adaptation-plane transitive closure check (reuse `live-isolation`
walker); (5) real-provider `--children` stays smoke-only, opt-in coverage
only; (6) retention bounding + Node engines floor decisions; (7) prefer
symbol anchors over line numbers in living docs.

## Constraint compliance

No live R1/bandit/topology enabled or recommended; no Outcome-supported
claim added anywhere; F-PROD, P0 sign-off, ADR-006 untouched and re-affirmed
open/Proposed in the report. No `src/` files edited by this slot.
