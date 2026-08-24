# Loop 3 Round 1 — fable-1

MODEL_SLUG: claude-fable-5-thinking-xhigh

Role: declare the `INSPECT_SUMMARY` additive-only freeze in living docs
(loop-2 §3 P1-2); loop-3 architecture report tracking the loop-2 ranked
items. No `src/` or `test/` edits, no git commit (per slot instructions).

## Files changed (exclusive ownership honored)

- `.agent_workspace/loop3-r1-fable1.md` (this file)
- `docs/reports/2026-08-24-sota-loop3-architecture.md` (new)
- `README.md` — freeze + honesty only, two spots: the Quick Start inspect
  paragraph and the `inspect --run` command-table row now say the summary is
  a frozen additive-only contract (`InspectSummaryJson`,
  `src/run/inspection.ts`, same policy as doctor `--json`): pin
  `type`/`runId`/`status`/`requiredEvidence`; new keys may appear; existing
  keys keep meaning; run-only; not a domain event; mutually exclusive with
  `--json`. Nothing else in the README touched.
- `docs/status-matrix.md` — one row (fake executor run/inspect/resume): the
  sentence "`INSPECT_SUMMARY`'s stability is **not yet declared** … open
  Round 2 decision" replaced with the freeze declaration (additive-only,
  `DoctorJsonReport` policy, shape-only promise, preview surface, run-only,
  outside the event log). No other row edited; every Outcome-supported cell
  stays **no**.

## Snapshot honesty

Audited HEAD `ce28506` (no round-1 code) **and** the shared working tree,
which moved mid-audit. When I finished (~16:45 UTC) all sibling work was
in-tree and verified:

1. **opus-1** — `InspectSummaryJson` + `buildInspectSummaryJson` exported
   from `src/run/inspection.ts`; `inspectCommand` emits via the builder;
   `INSPECT_SUMMARY_KEYS` key-set pin in the unit suite; NEW
   `test/integration/cli/inspect-summary.test.ts` (6 cases: blocked-run
   verbatim payload, clean-run `[]`, `--json` purity, both refusals,
   spawned-CLI stdout). My docs freeze matches this shape exactly.
2. **opus-2** — feedback log writer surface (`withFeedbackLogLock`, locked
   queued `appendFeedback`); `cascadeFeedbackTombstones` rewrite + tombstone
   write inside the same critical section; fail-closed timeouts both
   directions; NEW `test/unit/feedback/store-lock.test.ts`.
3. **gpt-sol-1** — one bounded retry on invocation-lock timeout, then still
   drop; NEW `scripts/invocation-lock-probe.mjs` + `invocation:probe` script
   key (only `package.json` change; no dep bumps).
4. **gpt-sol-2** — NEW `test/unit/privacy/adaptation-plane-closure.test.ts`
   (value-import union closure over five adaptation dirs, reasoned runtime
   allowlist, computed-`import(expr)` watchlist); `live-isolation.test.ts`
   untouched.

## Verification I ran (shared tree, Node v22.22.2, pnpm 10.17.1)

- `pnpm exec tsc --noEmit` — clean.
- inspection + feedback + invocation-log + deletion suites —
  **103 pass / 0 fail**.
- inspect-summary integration + store-lock + adaptation-plane-closure —
  **18 pass / 0 fail** (run after they landed mid-round).

## Residual risks

1. My targeted runs predate the **final** combined tree; the parent gate +
   security probe over what actually gets committed is P1-1 in the report —
   nothing counts as closed before it.
2. The freeze is enforced socially + by the two key-set tests; anyone adding
   a summary key must update `INSPECT_SUMMARY_KEYS` in both suites and the
   matrix/README wording in the same change (procedure stated in report
   §2.1).
3. Point-in-time delete semantics: feedback bound to a deleted episode but
   appended after the cascade is untouched by tombstones (new id). Inherent,
   not a lock defect; flagged to fable-2's dictionary as a one-line
   disclosure candidate (report §2.3 / §3 item 8).
4. Probe numbers not yet recorded anywhere durable (report §3 P1-2).

## Constraint compliance

No live R1/bandit/topology enabled or recommended; no Outcome-supported
claim added anywhere; F-PROD, P0 sign-off, ADR-006 untouched and re-affirmed
open/Proposed; retention default stays unbounded; no `--children` contract
invented; no `src/`, `test/`, or `package.json` edits by this slot; no git
commit.
