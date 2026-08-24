# Round 3 report — R3-fable-B (overlay + README alignment)

MODEL_SLUG: claude-fable-5-thinking-xhigh

Date: 2026-08-24. Branch `cursor/pi-adapt-aux-features-e1e3` (worked in place per orchestrator instructions; no commit — parent handles git).

## What changed

### 1. Overlay flipped from "planned" to "landed" (critical fix)

- `.agents/skills/pi-sparkle/SKILL.md` — knob 3 of the "Thinking level — three
  knobs" list no longer says `run --thinking <level>` "does NOT exist". It now
  states the flag is landed and listed in the `pi-sparkle help` USAGE, with
  precedence flag > `PI_THINKING_LEVEL` > `off`, per-run only and never
  persisted — explicitly contrasted with the TUI `/thinking` selector (knob 1),
  which is session-scoped and saved with Ctrl+S. No claim of TUI persistence
  was added.
- `.agents/skills/pi-sparkle/references/pi-version-adapt.md` — checklist item 5
  updated the same way; the bump-time instruction is now "confirm the USAGE
  still lists the flag" instead of "cite it only after it lands".

Both claims were verified against `src/cli/main.ts` before editing (not from
the brief alone): `resolveThinkingLevel(flag, env)` resolves flag ?? env ??
"off", the run USAGE lines list `[--thinking <level>]`, and the help text says
the flag "sets the reasoning effort for this run only and wins over
PI_THINKING_LEVEL … never persists". A repo-wide grep of
`.agents/skills/pi-sparkle/` confirms no other stale "planned" claim remains.

### 2. README (Commands / thinking / probe rows only)

- The provider-setup section's thinking line now reads: `PI_THINKING_LEVEL`
  with the full level list **including `max`**, plus the `--thinking <level>`
  per-run override on `run` (wins over the env var, never persists) and the
  Google `xhigh`/`max` silent-clamp warning (documented warning only, per the
  Round 3 target — no provider clamp change).
- The Commands-table `run` row now lists `--thinking` among the flags.
- `pnpm pi:probe` row: **already present** in the Commands table (adapter-only
  ADR-001 / `GoogleThinkingLevel` probe) — no change needed.

## Explicitly not done (by design)

- No second skill added; nested-discovery demo data stays in
  `test/fixtures/pi-0843-skills/`, and both SKILL.md and the reference still
  forbid parking demo skills under `.agents/skills/`.
- 1–2 reference-cap language untouched (SKILL.md routing section, Activation
  Rule, and the cap note in pi-version-adapt.md all intact).
- ADR-006 overlay-not-extension language untouched (frontmatter
  `compatibility`, "Still no extension" bullet, prompt rules).
- `prompts/sparkle.md` inspected — it carries no planned/landed claim about
  `--thinking`, so it was left unchanged.
- No `src/` edits, no git commit, no README rewrite beyond the three scoped
  spots.

## Cross-checks against "do not regress"

- Pin prose unchanged (0.84.3 matching pair; SKILL.md still says read
  `package.json` / run the shipped commands, never trust prose).
- pi-compat flag names in SKILL.md already correct (offline default,
  `--online` opt-in) — matches the USAGE in `src/cli/main.ts`.
- Probe remains adapter-source-only in all docs I touched.

## Files touched

- `.agents/skills/pi-sparkle/SKILL.md` (knob 3 only)
- `.agents/skills/pi-sparkle/references/pi-version-adapt.md` (item 5 only)
- `README.md` (thinking line + `run` Commands row only)
- `.agent_workspace/round3-fable-b.md` (this report)
