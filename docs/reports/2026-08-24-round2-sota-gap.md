# Round 2 SOTA re-review — remaining gap statement (2026-08-24)

Auditor: R2-fable-A (`claude-fable-5-thinking-xhigh`), branch
`cursor/pi-adapt-aux-features-e1e3`. §4 close-out added in Round 3 by
R3-fable-A (same model slug). Companion to
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

## 4. Round 3 close-out (added 2026-08-24, R3-fable-A)

This section closes the gap statement: it separates what is **already in this
tree and verified today** from what **Round 3 must still prove** before the
parent merges. Re-verified on this VM (Node 22.22.2, pnpm 10.17.1):
`pnpm cli pi-compat` exits 0 with `pinned: agent-core=0.84.3 ai=0.84.3`,
`google-thinking=absent`, all seven levels, `nested-skill-discovery=yes`;
`pnpm cli doctor` reports all ten checks ok including `pi-packages` and
`pi-compat`.

### Already in tree — needs no further proof

| Claim | Evidence |
|---|---|
| `run --thinking <level>` exists on all three `run` forms | `src/cli/main.ts` USAGE + `resolveThinkingLevel` (flag > `PI_THINKING_LEVEL` > `off`); `test/unit/cli/thinking-flag.test.ts` covers precedence, all seven levels, and both rejection messages. |
| Nested-skill discovery fixture exists | `test/fixtures/pi-0843-skills/grouping/` (`README.md`, `AGENTS.md`, `nested-skill/SKILL.md`) + `test/unit/pi-compat/skill-discovery-0843.test.ts`. Lives under `test/`, outside `package.json#pi.skills`. |
| `pi-compat` CLI + doctor checks + script aliases | `src/cli/pi-compat.ts`, doctor `pi-packages`/`pi-compat` in `src/cli/doctor.ts`, `package.json` scripts `pi-compat` / `pi:latest` / `pi:probe`. |
| Pin is the 0.84.3 matching pair | `package.json` dependencies, exact versions, no ranges. |
| Google `xhigh`/`max` clamp documented as provider behavior | USAGE one-liner in `src/cli/main.ts`, `THINKING_LEVELS` comment, how-to step 2 watch item, status-matrix row, README thinking line. Never rewritten by the CLI. |
| Status matrix carries the capability rows | `docs/status-matrix.md` § "Pi compatibility line": pin 0.84.3, `pi-compat` CLI, doctor checks, `run --thinking` — all marked not Outcome-supported. |
| ADR-006 holding | `package.json#pi` declares only `skills` and `prompts`; no `pi.extensions`; `pi-coding-agent` not a dependency. |

### Round 3 must still prove (owners per PROGRESS.md; concurrent with this close-out)

1. **Overlay + README flip (§3 item 3) — R3-fable-B; landed mid-round.**
   Observed during this close-out: `README.md` now lists all seven levels
   including `max`, documents `--thinking <level>` winning over
   `PI_THINKING_LEVEL` for that run only ("never persists"), names the
   Google clamp, and carries `pnpm pi:probe` in the command table; the
   skill overlay (`SKILL.md`, `references/pi-version-adapt.md`) calls the
   flag landed, not planned, and does not claim TUI persistence.
   Remaining proof: none beyond the post-round `pnpm gate`.
2. **Thinking-mirror / clamp test (§3 item 1, audit G3) — R3-opus-A;
   landed mid-round.** `test/unit/pi-adapter/thinking-clamp.test.ts` now
   exists (observed during this close-out): it characterizes Pi 0.84.3's
   Google clamp (faux-provider run proves the adapter forwards `xhigh`/`max`
   unchanged; `clampThinkingLevel` clamps them to `high` on every Google
   reasoning model) and compile-time-pins `GoogleApiThinkingLevel` /
   `ResolvedGoogleThinkingLevel` against the adapter's
   `SparkleThinkingLevel`. Combined with the existing boundary assignability
   check (a *narrowed* agent-core union fails `pnpm typecheck` where the
   level is handed to the `Agent`), the residual drift gap narrows to:
   an **added** level goes silently stale in the three sparkle-owned
   mirrors (`SparkleThinkingLevel`, `THINKING_LEVELS`,
   `SPARKLE_THINKING_LEVELS`) — still a manual step-2 comparison per bump.
   Remaining proof: this test passes under the post-round `pnpm gate`.
3. **Full `pnpm gate` green (§3 item 5) — R3-opus-B, then parent.** The tree
   mutates during rounds; only a post-round gate run is trustworthy.
4. **Docs-spelling non-failure proof (§1 row 5 regression) — R3-gpt-B.**
   Keep the behavioral proof that `GoogleThinkingLevel` spelled in prose
   does not fail doctor or `pi-compat`.
5. **Fixture/probe edge cases — R3-gpt-A.** Discovery-test hardening only;
   fixtures must stay under `test/fixtures/`, never `.agents/skills/`.

### Carried beyond Round 3 (unowned, deliberate)

- **Shipped-tree skill packaging doctor check** (§2.1 / §3 item 2) — P1,
  optional; no owner assigned in Round 3.
- **Google clamp stderr notice** (§2.2 / §3 item 4) — P3; the clamp is now
  documented in five places and pinned by the characterization test (see
  above), which this report treats as sufficient for a developer preview.
  Any future notice must warn, never rewrite the level.
- **Online CI cron** (§3 item 6) — needs a network-policy decision first.

With the five Round 3 proofs above delivered, this gap statement is closed;
subsequent Pi bumps run through [how-to-adapt-to-pi.md](../how-to-adapt-to-pi.md)
rather than a new gap report.
