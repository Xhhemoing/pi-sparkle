MODEL_SLUG: claude-fable-5-thinking-xhigh

# Round 2 report — R2-fable-B (skill overlay polish after Round 1)

## Files changed

- `.agents/skills/pi-sparkle/SKILL.md`
- `.agents/skills/pi-sparkle/references/pi-version-adapt.md`
- `prompts/sparkle.md`

No writes outside the exclusive set. No new top-level skill. Not committed
(parent orchestrator commits).

## Task 1 — point the overlay at live commands

The 0.84.3 section of `SKILL.md` now opens with the three shipped surfaces
instead of a bare `pi-compat --offline` mention:

- `pi-sparkle pi-compat [--json]` — documented as offline-by-default, with
  `--online` fail-closed semantics (unreachable registry = status `unknown`,
  exit 0) and exit 1 reserved for a broken adapter contract.
- `pi-sparkle doctor` — names the two new checks exactly as the CLI prints
  them (`pi-packages`, `pi-compat`) and marks a FAIL on either as blocking.
- `node scripts/pi-latest-check.mjs` — covers agent-core / ai /
  pi-coding-agent, `--offline` prints pins only, `--strict` exits 1 on
  behind/unknown.

`pi-version-adapt.md` step 2 now routes online pin checks through
`pi-sparkle pi-compat --online` (with `pi-latest-check.mjs --strict` as the
automation path), and step 4 names the doctor check names and the
"behind = exit 0, broken contract = exit 1" split. `prompts/sparkle.md`
gained one rule: pull version/pin facts from those live commands, never
remembered prose.

All command names, flags, check names, and exit semantics were verified
against `src/cli/main.ts` USAGE, `src/cli/doctor.ts`, `src/cli/pi-compat.ts`,
and both scripts — and by running the commands (output below).

## Task 2 — thinking-knob clarification

The single two-knob bullet became "three knobs, never conflated":

1. Pi TUI `/thinking` — session-scoped, Ctrl+S saves; owned by the TUI,
   invisible to this package's runtime.
2. `PI_THINKING_LEVEL` — runtime env var, with the exact accepted list from
   `main.ts` (off|minimal|low|medium|high|xhigh|max; default off).
3. `run --thinking <level>` — described as **planned** with precedence over
   the env var. I checked `src/cli/main.ts`: the USAGE does not list it and
   `runCommand`'s parseArgs has no `thinking` option, so both `SKILL.md` and
   checklist step 5 carry an explicit guard: cite the flag only after
   `pi-sparkle help` USAGE lists it. If the R2 agent owning `src/` lands the
   flag, the overlay text stays true as written (the guard resolves to
   "exists"), though dropping "planned" then would read cleaner.

## Task 3 — nested grouping-dir discovery

Kept as checklist step 3. Both `SKILL.md` and the checklist now explicitly
forbid parking a demo/fixture skill under `.agents/skills/` (reads as skill
bloat) and point at `test/fixtures/pi-0843-skills/` as the probe data. That
fixture already exists on the branch (R2-gpt-A's ownership): a grouping dir
with `nested-skill/SKILL.md` plus root `README.md` / `AGENTS.md` without
frontmatter. I did not create or modify anything under `test/`.

## Task 4 — invariants kept

- The 1–2 reference load rule is unchanged in `SKILL.md` (In Pi + Activation
  Rule) and `prompts/sparkle.md`; `pi-version-adapt.md` still declares it
  counts toward the cap.
- ADR-006 framing intact: "diagnostic overlay, not a control plane" in the
  frontmatter/intro, "Still no extension" bullet unchanged, no extension
  commands or session listeners introduced anywhere.

## Verification

- `pnpm exec tsx --test test/unit/package/pi-manifest.test.ts` — 4/4 pass.
- `pnpm cli pi-compat` — offline default confirmed; pins agent-core=0.84.3
  ai=0.84.3; thinking-levels off..max; status unknown, exit 0.
- `pnpm cli doctor` — prints `ok  pi-packages: agent-core=0.84.3 ai=0.84.3`
  and `ok  pi-compat: status=unknown (...)`, matching the names the overlay
  now cites.
- `node scripts/pi-latest-check.mjs --offline` — prints the three PINNED
  lines (pi-coding-agent correctly "(not pinned)", consistent with ADR-006).

## Leftovers for the next round

1. When `run --thinking` actually lands in USAGE, drop the word "planned"
   from `SKILL.md` bullet 3 and checklist step 5 (one-line edits; the
   verify-USAGE guard already keeps the text truthful either way).
2. If package.json gains wrapper scripts for the probes (Round 2 target 1,
   not my file), the overlay could cite `pnpm <script>` aliases instead of
   raw `node scripts/...` invocations — cosmetic only.
