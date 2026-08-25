model: claude-fable-5-thinking-xhigh

# R3-fable-A slot report — SOTA acceptance working notes

**Wrote only:** `docs/reports/2026-08-25-r3-sota-acceptance.md` and this file.
Read-only git (log/show/diff/grep/merge-base) — no commit, push, checkout, or
stash. No `src/`, `scripts/`, `.github/` touched.

## Verdict

- **Round 2: ACCEPT, all slots**, against the committed tree `cafc512`
  (not worktree reads). Evidence in the docs report §1.
- **`inspect-format.ts` unwired at Round 2 close: CONFIRMED** the strong way —
  `git grep "inspect-format" cafc512 -- "*.ts" "*.mjs"` returns zero matches,
  so it had no importer in `src/` *or* `test/`. R3-opus-B's wiring
  (`main.ts:56` + four additive hunks) closed it in-tree during my window.
- **Both stale release-gate sentences: CONFIRMED** at `cafc512:93` and `:103`;
  both fixed in-tree by R3-gpt-B.
- **cae9 never merged: CONFIRMED** — `73e9677` is not an ancestor of HEAD, no
  merge commits in `e88f2ce..HEAD`, and `inspection.ts` +
  `market-eval-probe.mjs` are byte-identical to the cae9 tip.
- **Round 4: ZERO.** No reproduced gap exists.

## Reproduction (the part that isn't a file read)

Final `pnpm prerelease` on the stable tree (all six Round 3 slots landed):
exit 0 — preview probe 5/5 ok, gate clean with **2137 tests / 2136 pass /
0 fail / 1 skip**, security probe `ok` **passed: 16** (matches the re-dated
GREEN block), pi:probe pass. Host Node v22.14.0 (below floor, pnpm warns) —
the standing caveat that gpt-A's CI pin to 22.19.0 retires on CI.

One flake, disclosed: my first prerelease (~16:31Z) had exactly 1 test
failure while sibling edits were landing mid-run; it never reproduced across
three subsequent full runs on the settled tree. Truncated capture meant the
test name was lost — if the parent's closeout run ever shows a single
failure, re-run before investigating.

## Timing notes the parent should know

- Sequence observed: gpt-A/gpt-B first, then opus-A, opus-B, fable-B landed
  during my runs. fable-B's declaration §5 ("spec still records passed: 14,
  re-date REQUIRED") was true at their close but was superseded minutes later
  by gpt-B's follow-up re-date to `passed: 16`. The requirement is now
  satisfied in substance; only "cite GREEN against the closeout commit"
  remains live.
- Ownership check: every modified/untracked file maps 1:1 to the ownership
  table; no collisions, nobody touched `src/run/inspection.ts`.

## Closeout one-liners for the parent (not Round 4 material)

1. Drop `CHANGELOG.md:38` "not yet called from `src/cli/main.ts`" — now a
   false underclaim after opus-B's wiring.
2. Optionally one line in the neice declaration noting the re-date landed
   (§5's `passed: 14` snapshot is stale as of gpt-B's follow-up).
3. Cosmetic: GREEN block lacks the literal 9/6 per-class sample split from
   opus-A's payload (has `passed: 16` + delta names — substance is there).
4. Commit; then the declaration's §1 SHA rule governs claims. A build+probe
   on the committed SHA (expect `passed: 16`) makes the GREEN citation
   airtight per the declaration's checklist.

Frozen invariants re-checked and intact: ADR-006 **Proposed**, `private:
true`, engines `>=22.19.0` unchanged, never-waivable predicate unchanged by
opus-A's sample-only probe edit, no live R1 / no Outcome-supported claims
introduced anywhere in Round 2 or 3.
