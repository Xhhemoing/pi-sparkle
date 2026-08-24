MODEL_SLUG: claude-fable-5-thinking-xhigh

# Round 1 report — R1-fable-A (architecture / SOTA audit)

## Delivered (exclusive write paths only; nothing committed)

1. **`docs/how-to-adapt-to-pi.md`** — durable per-bump operator playbook:
   changelog triage taxonomy, the full adapter import-surface table (file ×
   symbol), pnpm-store `d.ts` diff technique, adapter test matrix
   (`pi-boundary`, `test/unit/pi-adapter/*`, `test/integration/pi-adapter/*`,
   `PI_SMOKE=1` gate), pin-after-typecheck rule, compat-surface refresh
   commands (`pi-compat`, `doctor`, both probe scripts), 0.84.3
   skill-discovery rules, ADR-001 boundary rule, and the "what we will not
   absorb" list (TUI `/thinking`, PowerShell tool, inbound extension events
   per ADR-006). Maintainer notes record the deliberate constraint that the
   doc never spells the pre-rename Google thinking-level identifier
   contiguously (see risk R2).
2. **`docs/reports/2026-08-24-pi-0843-gap-audit.md`** — evidence-based audit.
   Every delta claim is backed by a `dist/*.d.ts` diff between the 0.84.1 and
   0.84.3 copies in the pnpm store; every state claim by a command run on
   this branch. Verdict: the bump is a no-code-change bump for the adapter
   (the breaking rename touched a never-imported symbol; agent-core's
   consumed surface is byte-identical; `toolChoice` etc. are additive and
   flow through the existing options spread).
3. This report.

## Verification interplay confirmed

- `src/pi-compat/check.ts` reads `docs/how-to-adapt-to-pi.md` as prose
  evidence. After writing the doc: `pi-compat` still reports
  `google-thinking=absent`, and the "assumed nested skill discovery" finding
  is gone (the doc now supplies the nested-skill evidence the regex looks
  for). Verified by re-running `pnpm cli pi-compat` and by testing both
  regexes against the doc directly.

## Leftover risks

- **R1 (merge-blocking, P0):** `test/unit/pi-boundary.test.ts` fails on this
  branch — it greps file *content* for `@earendil-works/` and false-positives
  on `src/pi-compat/check.ts` + `src/cli/pi-compat.ts`, which name the
  packages as data but import nothing from them. `pnpm gate` fails until the
  tripwire matches import specifiers instead of substrings. Not in my write
  scope (`test/`); needs an owner in Round 2 (natural fit: whoever owns
  adapter tests, or gpt-B who owns pi-compat tests).
- **R2 (P1):** `check.ts`'s report-body scan greps prose docs for the legacy
  Google identifier; only the exit-code path was narrowed to adapter sources
  (`readAdapterSourcesOnly` in `src/cli/pi-compat.ts`). A doc that names the
  legacy symbol verbatim flips the printed report to `legacy-…`/BROKEN at
  exit 0. My doc writes around it; `references/pi-version-adapt.md` spells it
  and is safe only because it is not on the evidence list.
- **R3 (P1):** thinking-level list is mirrored in three places with no drift
  test (agent-core union, `src/cli/main.ts`, `src/pi-compat/check.ts`).
- **R4 (environmental):** audit VM runs Node 22.14.0 < engines 22.19.0 —
  doctor's only FAIL line. Tests ran fine; not a repo defect.
- **R5 (process):** the tree mutated under me mid-audit (pin bump + install
  landed between two probes). Audit §2 timestamps its evidence; re-verify
  after Round 1 merges.

## Recommended Round 2 focus

1. Fix R1 (import-specifier matching in the boundary test) — everything else
   in Round 1 is blocked on `pnpm gate` behind it.
2. `--thinking` CLI flag (headless counterpart of Pi's session-scoped
   `/thinking`; plumbing already exists via `createConfiguredPiExecutor`).
3. Nested-skill doctor check validating `.agents/skills` against 0.84.3
   discovery rules.
4. R2 + R3 cleanups in `src/pi-compat/check.ts` and a mirror-drift unit test
   inside the adapter boundary.
5. Skip `toolChoice` executor plumbing until a concrete use case appears —
   the adapter already passes through whatever Pi's `Agent` sets.

## Policy conformance

ADR-001 respected (no `src/` edits; docs only). ADR-004 proposal-first intact
(no promotion claims, no live-run mutation). ADR-006 intact (docs explicitly
keep extensions and `session_compact_failed` out of scope; P2 items gated on
ADR acceptance). No usage metrics invented. Did not commit (orchestrator
commits after the round).
