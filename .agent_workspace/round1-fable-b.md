MODEL_SLUG: claude-fable-5-thinking-xhigh

# Round 1 report — R1-fable-B (skill overlay, Pi 0.84.3 re-review)

## Files changed

- `.agents/skills/pi-sparkle/SKILL.md`
  - New dated section **"Pi 0.84.3 Adaptation (2026-08-24)"**: nested skill
    discovery in grouping dirs (flat layout unchanged; do not split the
    overlay), root `README.md`/`AGENTS.md` no longer broken-skill findings
    (stale findings on ≥0.84.3 must be re-probed), TUI `/thinking`
    (session-scoped, Ctrl+S) vs runtime `PI_THINKING_LEVEL` are separate
    knobs, still no extension (ADR-006 Proposed; `session_compact_failed`
    events out of scope). Prose defers to `package.json` /
    `pi-sparkle pi-compat` for the live pin so the section cannot go stale
    when R1-opus-A bumps 0.84.1 → 0.84.3.
  - Routing to References table gained one row:
    `references/pi-version-adapt.md`.
- `.agents/skills/pi-sparkle/references/pi-version-adapt.md` (new) — 6-step
  version-bump checklist: changelog → pin vs `pi --version` (fallback
  `scripts/pi-latest-check.mjs`, fail-closed offline) → skill discovery
  re-check (nested + AGENTS.md behaviors on ≥0.84.3) → doctor / pi-compat
  (contract breakage = blocking) → thinking-config sanity → record in the
  dated SKILL.md section. Explicitly states it counts toward the
  1–2-reference cap and forbids adding a top-level skill for a bump.
- `prompts/sparkle.md` — one-line change: `pi-bump` added to the
  `argument-hint` focus list so the new checklist is routable. Still a plain
  prompt template; no extension, no other changes.

## Task 4 (false 0.84.1-latest claims)

None found. Grepped `.agents/skills/pi-sparkle/**` for `0.84`, `latest`,
`/thinking`, `PI_THINKING` (case-insensitive) — zero matches before my edits,
so there was nothing to correct. The new dated section is now the only place
version facts appear, and it points at live sources rather than asserting a pin.

## Verification

- `tsx --test test/unit/package/pi-manifest.test.ts` — 4/4 pass (reference
  regex picks up `pi-version-adapt.md` and the file exists; refs ≥ 6 holds;
  prompt frontmatter intact; no `pi.extensions`).
- No usage JSONL invented, no `USED` persisted, no new top-level skill,
  diagnostic-overlay-only language kept throughout.
- Did not commit (parent orchestrator commits). Did not touch `src/`,
  `test/`, `package.json`, or `docs/`.

## Leftover overlay gaps for Round 2

1. **Nested grouping-dir demo, test-side only.** A discovery fixture (e.g.
   `test/fixtures/skills/group/nested-skill/SKILL.md` exercised by whoever
   owns pi-compat/adapter tests) would prove the ≥0.84.3 nested-discovery
   claim without shipping anything under `.agents/skills/` that reads as a
   second skill. Do NOT place the demo inside the package skill tree.
2. **Pin-bump follow-up.** After R1-opus-A lands 0.84.3 pins, no SKILL.md
   edit is needed (the dated section intentionally defers to live sources),
   but Round 2 should re-run the pi-version-adapt checklist end-to-end once
   `pi-sparkle pi-compat` exists and confirm the command names in the
   checklist match the shipped CLI.
3. **`--thinking` flag.** If Round 2 adds a CLI `--thinking` mapping onto
   `PI_THINKING_LEVEL` (flagged in PROGRESS.md), step 5 of
   `pi-version-adapt.md` should mention the flag alongside the env var.
4. **AGENTS.md placement.** The overlay could now safely carry a root
   `AGENTS.md` inside the skill directory on ≥0.84.3 (no broken-skill
   report), but installed copies on older Pi would regress — hold until the
   pin floor is ≥0.84.3 everywhere the package is installed.
