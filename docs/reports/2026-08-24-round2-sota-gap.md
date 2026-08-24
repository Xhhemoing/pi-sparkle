# Round 2 SOTA re-review — remaining gap statement (2026-08-24)

Auditor: R2-fable-A (`claude-fable-5-thinking-xhigh`), branch
`cursor/pi-adapt-aux-features-e1e3`. Companion to
[2026-08-24-pi-0843-gap-audit.md](2026-08-24-pi-0843-gap-audit.md) (whose §6
records per-gap resolutions) and to
[how-to-adapt-to-pi.md](../how-to-adapt-to-pi.md). Method: every claim comes
from file contents in this tree, `d.ts` reads of the installed 0.84.3
packages, or command runs on this VM (Node 22.22.2, pnpm 10.17.1). No usage
metrics are cited because none were collected.

## 1. What Round 2 landed (verified in this tree)

| Item | Where | Evidence |
|---|---|---|
| `run --thinking <level>` | `src/cli/main.ts` | `resolveThinkingLevel`: flag > `PI_THINKING_LEVEL` > `"off"`; validated at parse-args against `THINKING_LEVELS`; in USAGE with the TUI `/thinking` contrast (per-run, never persisted). Tests: `test/unit/cli/thinking-flag.test.ts`. |
| CLI tests for `pi-compat` | `test/unit/cli/pi-compat.test.ts` | File present alongside doctor test coverage. |
| npm script aliases | `package.json` | `pi-compat`, `pi:latest`, `pi:probe` wrap the CLI and both probe scripts. |
| Nested-skill discovery fixture | `test/fixtures/pi-0843-skills/grouping/` | Plain `README.md`/`AGENTS.md` + nested `nested-skill/SKILL.md`; asserted by `test/unit/pi-compat/skill-discovery-0843.test.ts`. Not a second shipped skill — it lives under `test/`, outside `package.json#pi.skills`. |
| Report-path probe narrowed (audit G2) | `src/pi-compat/check.ts` | Legacy-identifier regex runs on adapter sources only; docs/SKILL.md feed only the nested-skill evidence regex. Verified by spelling the legacy name in the how-to: `pnpm cli pi-compat` still prints `google-thinking=absent`, exit 0. |
| Boundary test on import specifiers (audit G1, parent fix) | `test/unit/pi-boundary.test.ts` | `hasPiPackageImport()` matches `from` / `import(` / `require(` + quoted `@earendil-works/` specifier; data mentions are tested as non-imports. |
| Docs aligned with the actual CLI | `docs/how-to-adapt-to-pi.md` | This round: offline-default/`--online`/`--json` semantics, script aliases, `--thinking`, fixture pointer, retired write-around, thinking-level watch items. |

Command evidence (this VM, 2026-08-24): `pnpm cli pi-compat` exits 0 with
`pinned: agent-core=0.84.3 ai=0.84.3`, `google-thinking=absent`, all seven
levels, `status: unknown` offline; `pnpm cli doctor` reports all ten checks
ok including `pi-packages` and `pi-compat`.

## 2. SOTA remainder (re-stated with evidence)

### 2.1 Nested-skill fixture — landed; shipped-tree doctor check still open

The 0.84.3 discovery rules (nested skills under grouping dirs discovered;
root `README.md`/`AGENTS.md` not broken skills) are pinned by the fixture
above. What remains is the R1-audit P1-3 idea: a doctor check that validates
the **shipped** `.agents/skills` tree (every leaf skill dir has `SKILL.md`
with `name`/`description` frontmatter; grouping dirs contain skill dirs)
so packaging drift is caught before `pi install` is. Optional, P1.

### 2.2 Google `xhigh`/`max` clamp — provider behavior, documented, no code

Evidence in `pi-ai@0.84.3`:
`GoogleApiThinkingLevel = "THINKING_LEVEL_UNSPECIFIED" | "MINIMAL" | "LOW" |
"MEDIUM" | "HIGH"` and
`ResolvedGoogleThinkingLevel = Exclude<ThinkingLevel, "xhigh" | "max">`
(`dist/api/google-shared.d.ts`), plus `clampReasoning()` in
`dist/api/simple-options.d.ts`. A user passing `--thinking xhigh` to a
Google model silently gets at most `high`. The CLI deliberately forwards the
requested level unchanged (comment at the `THINKING_LEVELS` definition in
`src/cli/main.ts`); the how-to's diff-surface section now names the clamp so
it is not mistaken for repo drift. Round 3 option, low priority: a one-line
stderr notice when `--thinking xhigh|max` targets a Google model — never a
rewrite of the level.

### 2.3 pi-ai vs agent-core `ThinkingLevel` `"off"` divergence — watch item

`pi-ai@0.84.3` `dist/types.d.ts`:
`ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max"`
with `ModelThinkingLevel = "off" | ThinkingLevel`.
`pi-agent-core@0.84.3` `dist/types.d.ts` line 260 still has
`"off"` in its `ThinkingLevel`. The adapter imports **agent-core's** union,
so `"off"` (the CLI default) remains valid today. Risk: if a future
agent-core aligns with pi-ai and drops `"off"`, the CLI default and both
repo mirrors break at the same time — and there is still **no automated
drift test** (audit G3, open). The how-to's step-2 checklist now flags this
union as the first thing to check per bump.

### 2.4 No extensions (ADR-006) — holding

`package.json#pi` declares only `skills` and `prompts`; there is no
`pi.extensions` key. `session_compact_failed` and other inbound extension
events remain out of scope until ADR-006 is Accepted. Verified against the
current `package.json`.

### 2.5 No PowerShell tool — holding

Zero matches for `powershell` (case-insensitive) under `src/`. The fake
executor and adapter tool set stay platform-neutral.

### 2.6 No coding-agent dependency — holding

`package.json` dependencies are exactly `@earendil-works/pi-agent-core@0.84.3`
and `@earendil-works/pi-ai@0.84.3`; `@earendil-works/pi-coding-agent` is not
a dependency and, per the boundary test, cannot become an import outside
`src/pi-adapter/` without failing `pnpm test`.

## 3. Leftover for Round 3

1. **G3 drift test (P1):** a test inside the adapter boundary (e.g.
   `test/unit/pi-adapter/`) importing agent-core's `ThinkingLevel` and
   asserting both repo mirrors equal the union via an exhaustiveness check.
2. **Shipped-tree skill packaging doctor check (P1, optional):** validate
   `.agents/skills` against the 0.84.3 rules (see §2.1).
3. **README staleness (P2):** `README.md` still lists `PI_THINKING_LEVEL`
   values without `max` and does not mention `run --thinking` or its
   precedence. README was outside every Round 2 agent's write scope; it
   needs an owner.
4. **Google clamp notice (P3, optional):** see §2.2. Do not rewrite levels.
5. **Full `pnpm gate` confirmation:** the tree was mutating throughout
   Round 2 (multiple agents writing concurrently); the parent should run the
   full gate once after the round merges, before commit.
6. **Online CI cron (P2, needs policy):** scheduled
   `pi-compat --online` / `pnpm pi:latest` runs, carried unchanged from the
   Round 1 audit — both tools already fail closed.
