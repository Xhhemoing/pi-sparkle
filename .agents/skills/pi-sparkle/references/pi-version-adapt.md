# Pi Version Bump Checklist

Run this when Pi publishes a new version (or a compat check reports
`behind`). Diagnostic overlay only: report findings and propose the smallest
durable fix. Never auto-edit pins, register extensions, or invent usage data.

## Checklist

1. **Changelog.** Read the release notes for `@earendil-works/pi-coding-agent`
   and the inherited `pi-agent-core` / `pi-ai`. Flag anything touching:
   skill/prompt discovery, extension APIs (still out of scope — ADR-006
   Proposed), thinking/model configuration, renamed or removed exports.
2. **Pin vs installed.** Compare the `package.json` pins against
   `pi --version` if a Pi binary is present; otherwise use
   `scripts/pi-latest-check.mjs` (npm dist-tags; fails closed offline).
   Record `current | behind | ahead | unknown` — offline means `unknown`,
   never a guess.
3. **Skill discovery re-check.** After `pi install`, confirm this skill is
   discoverable and `/sparkle` expands as a prompt template. On Pi ≥ 0.84.3
   also confirm: nested Markdown skills inside `.agents/skills/` grouping
   directories are discovered, and root `README.md` / `AGENTS.md` without
   skill frontmatter are NOT flagged as broken skills. Retract stale
   broken-skill findings from older Pi versions instead of repeating them.
4. **Doctor / pi-compat.** Run `pi-sparkle doctor` and
   `pi-sparkle pi-compat --offline` (or `scripts/pi-compat-probe.mjs` when
   the CLI is unavailable). Adapter contract breakage (missing thinking
   levels, legacy `GoogleThinkingLevel` import, unreadable pin) exits 1 —
   treat it as blocking, not a footnote.
5. **Thinking config.** The Pi TUI `/thinking` selector is session-scoped
   (Ctrl+S saves it); this package's runtime reads `PI_THINKING_LEVEL`. They
   are separate knobs. Verify the runtime value still maps to a level the
   pinned `pi-ai` accepts; do not report one knob as drift of the other.
6. **Record.** Update the dated adaptation section in `SKILL.md` and correct
   any version claim that is now false. Do not add a new top-level skill for
   a version bump — that is bloat, not adaptation.

## Cap

This file counts toward the load-at-most-1–2-references rule. If a bump also
needs bloat or evidence analysis, finish this checklist first and run the
other analysis as a separate invocation.
