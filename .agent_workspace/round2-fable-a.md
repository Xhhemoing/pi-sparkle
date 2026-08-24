MODEL_SLUG: claude-fable-5-thinking-xhigh

# Round 2 report — R2-fable-A (SOTA re-review + docs alignment)

## Delivered (exclusive write paths only; nothing committed)

1. **`docs/how-to-adapt-to-pi.md`** — aligned with the actual CLI:
   - Step 5 now states the real flag semantics: offline is the default,
     `--offline` is an accepted explicit no-op, `--online` is opt-in and
     fails closed, `--json` emits the `PiCompatReport`, and
     `--offline --online` together is a parse-args error. Doctor check names
     `pi-packages` / `pi-compat` were already correct; added that doctor's
     `pi-compat` check is always offline.
   - Wired in the new package scripts (`pnpm pi-compat`, `pnpm pi:latest`,
     `pnpm pi:probe`) at the steps that previously invoked the raw files.
   - `run --thinking <level>` documented as **landed** (not planned): it
     exists in `src/cli/main.ts` (`resolveThinkingLevel`, USAGE lines,
     parse-args validation) with flag > `PI_THINKING_LEVEL` > `"off"`
     precedence, per-run scope, TUI `/thinking` contrast. It landed
     mid-round from R2-opus-A — my first read of `main.ts` predated it, my
     re-read and `test/unit/cli/thinking-flag.test.ts` confirmed it.
   - Step-2 diff-surface section gained the two thinking-level watch items
     with `d.ts` evidence: pi-ai's `ThinkingLevel` dropped `"off"` (moved to
     `ModelThinkingLevel`) while agent-core kept it, and Google's
     `GoogleApiThinkingLevel`/`ResolvedGoogleThinkingLevel` clamp `xhigh`/
     `max` to at most `high`.
   - Step 6 points at the new discovery fixture
     (`test/fixtures/pi-0843-skills/` + its test).
   - Maintainer notes: **retired the write-around** — the doc now spells
     `GoogleThinkingLevel` verbatim, which doubles as a regression probe for
     the narrowed report-path scan. Section 7 now states the boundary
     tripwire matches import specifiers, not raw string mentions.
2. **`docs/reports/2026-08-24-pi-0843-gap-audit.md`** — added §6 resolution
   addendum and heading markers: G1 resolved (specifier-based tripwire,
   parent fix, no path allowlist), G2 resolved (probe inputs separated in
   `check.ts`; verified behaviorally, see below), G3 still open, G4
   unchanged, P1-1 `--thinking` landed, P1-3 partially covered (fixture yes,
   shipped-tree doctor check no), Node-engines FAIL was Round 1 VM-only
   (this VM: 22.22.2, doctor all-ok).
3. **`docs/reports/2026-08-24-round2-sota-gap.md`** (new) — Round 2 landed
   table with evidence pointers, SOTA remainder re-statement (fixture /
   Google clamp / `"off"` divergence / ADR-006 no-extensions / no
   PowerShell / no coding-agent dep, each verified against the tree), and
   the Round 3 leftover list.
4. This report.

## Verification (commands run on this VM, 2026-08-24)

- `pnpm cli pi-compat` before and **after** my doc edits: exit 0,
  `pinned: agent-core=0.84.3 ai=0.84.3`, `google-thinking=absent`,
  all seven levels, `nested-skill-discovery=yes`, no `BROKEN` finding —
  proving the report-path scan is adapter-source-only even with the legacy
  identifier spelled in the how-to, and that my edits kept the
  nested-skill evidence wording intact.
- `pnpm cli doctor`: all ten checks ok, including
  `ok pi-packages: agent-core=0.84.3 ai=0.84.3` and
  `ok pi-compat: status=unknown (offline …)`. Node 22.22.2 ≥ engines
  22.19.0 on this VM (the Round 1 environmental FAIL does not reproduce).
- Parent boundary fix confirmed by reading
  `test/unit/pi-boundary.test.ts`: `hasPiPackageImport()` matches
  `from` / `import(` / `require(` + quoted `@earendil-works/` specifier;
  a data-mention regression test is included. The stale grep description in
  the audit is superseded by §6; no other doc claims raw-substring matching
  (repo-wide grep of `docs/` for `earendil-works` checked).

## Scope discipline

Only my three exclusive paths were written. `src/`, `test/`,
`package.json`, `README.md` untouched. Nothing committed (parent commits).

## Leftover for Round 3

1. **G3 drift test (P1):** no test imports agent-core `ThinkingLevel` to
   pin the two repo mirrors; the only Pi imports under `test/` are the two
   integration suites.
2. **README staleness (P2, needs an owner — README was in no R2 agent's
   write scope):** line "Optional: `PI_THINKING_LEVEL=medium` (…)" omits
   `max` and predates `--thinking`/precedence.
3. **Shipped-tree skill packaging doctor check (P1, optional):** fixture
   covers the rules; the shipped `.agents/skills` tree itself is not
   doctor-validated.
4. **Google clamp stderr notice (P3, optional):** never rewrite the level.
5. **Full `pnpm gate` after merge:** the tree mutated under me during this
   round (`--thinking` landed between two reads of `main.ts`); a
   post-round gate run by the parent is the only trustworthy green.
6. **Online CI cron (P2, needs network policy):** carried unchanged.
