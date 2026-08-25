model: claude-fable-5-thinking-xhigh

# R2-fable-B slot report — cherry-pick / port verification

**Wrote only:** `docs/reports/2026-08-25-r2-cherry-pick-plan.md` and this file. No commits, no pushes, no checkouts, no cherry-picks performed.

## What was verified (against committed HEAD `afec150`, not the worktree)

HEAD moved one commit past the disposition's baseline `e88f2ce` (Round 1 landings in `afec150`), so every simulation was re-run.

1. **Four-commit clean set: still CLEAN.** `git merge-tree --write-tree --merge-base=<sha>^ HEAD <sha>` reports zero conflicts for `5f49bdc` (adapt-eval honesty, 4 files), `38e20c2` (fixture honesty fields, 3 test files), `92f00bc` (ADR-006 assertions, 1 test file), `df964ae` (SECURITY.md/CHANGELOG/CODEOWNERS/.env.example). File sets fully disjoint; `5f49bdc`+`38e20c2` must land together or `tsc` breaks on fixtures. Content gaps re-confirmed at HEAD by `git grep` (exit 1): no `qualityEvidence`/`actionDiff` in `HEAD:src/`, no `ADR-006` in `HEAD:test/unit/pi-boundary.test.ts`, all four governance files absent. **One correction to a raw-pick plan:** `df964ae` is mechanically clean but factually stale — its SECURITY.md/"CI uses: pii-redaction,secret-bodies" `.env.example` comment/CHANGELOG waiver passages contradict the GREEN gate (`HEAD:docs/specs/release-gate.md:16`, register "(empty)"). Adaptation (opus-B) beats raw pick.

2. **`808bc0b`: confirmed reimplement-without-waivers, do not pick.** Three grounds: (a) it now CONFLICTS on `docs/specs/release-gate.md` (was clean vs `e88f2ce`; Round 1 rewrote the section); (b) its CI step hard-codes `SECURITY_WAIVER: pii-redaction,secret-bodies` for findings that are now closed; (c) its release-gate diff resurrects "Status: currently BLOCKED" and fills the now-empty waiver register with an entry expiring 2026-09-30. Only the "run probe after Build against dist/" idea survives — that is gpt-A's slot, observed in-flight (`ci.yml` + `security-probe.mjs` modified in worktree).

3. **`fc6058c`: verification display confirmed still absent at HEAD.** `git grep 'unverified|verification=' HEAD -- src/cli src/run README.md` → 0 matches (the `src/learning/signals.ts` hits are internal episode labels, not CLI output). Raw pick now conflicts in **5** files (README, m0-m2, release-gate, status-matrix, main.ts — one more than the disposition counted). Data deps intact: `HEAD:src/run/inspection.ts:18` keeps `terminalResult?: TaskResult`; `HEAD:src/protocol/v1.ts:142` keeps `VerificationResult { kind, evidenceIds }`. Exact 5-point `main.ts` splice patch (anchors + HEAD line numbers 1032/1114/1338) documented in the plan §3 for the parent — opus-B must not touch `main.ts`, and opus-A is editing it now, so wiring goes in after opus-A commits.

## Exact opus-B file list (plan §4 has full detail)

- Brief-assigned (10): `SECURITY.md`, `CHANGELOG.md`, `.github/CODEOWNERS`, `.env.example` (all GREEN-adapted from `df964ae`), `src/cli/adapt.ts`, `test/unit/cli/adapt.test.ts`, `test/unit/adaptation/eval-routing.test.ts`, `test/unit/pi-boundary.test.ts`, `src/cli/inspect-format.ts`, `.agent_workspace/r2-opus-b.md`.
- **Missing from the brief but required by the ports (5), no slot collisions:** `src/adaptation/eval-routing.ts` (the +46 substance of `5f49bdc`), the three `38e20c2` fixture files (`test/unit/adaptation/promotion.test.ts`, `test/unit/learning/active-routing.test.ts`, `test/unit/run/flowchart-learned-routing.test.ts`), and `test/unit/cli/inspect-format.test.ts` (`fc6058c`'s 105-line test — otherwise the display lands untested).
- Route elsewhere: `main.ts` wiring → parent post-opus-A; `test/unit/run/inspection.test.ts` +6 verification assertions → opus-A (owns/editing the file); `test/integration/cli/cli.test.ts` +45 → unowned, parent optional; `ci.yml` → gpt-A; `fc6058c` doc edits → skip (stale, includes a now-false BLOCKED row).

## Hazard flagged for the parent

At ~16:14 UTC the worktree already contained most of the four-commit content uncommitted (opus-B mid-write; `src/cli/inspect-format.ts` matches `fc6058c`'s verbatim; governance files and the inspect-format test not yet present). The content must be applied exactly once: accept opus-B's hand-port and do **not** raw-cherry-pick the SHAs on top. Raw picks are the fallback only if opus-B's slot dies before commit, and then `df964ae`'s stale gate text still needs a follow-up edit.
