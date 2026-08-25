model: claude-fable-5-thinking-xhigh

# R3-fable-B slot report — 内测 declaration / claims audit

**Wrote only:** `docs/reports/2026-08-25-neice-declaration.md` and this file.
No git operations, no `src/`, no `scripts/`, no builds, no probe runs — the
audit cites recorded runs (spec GREEN block, gpt-B and opus-A slot reports)
instead of generating new ones on this below-floor host.

## Method

- HEAD read from `.git/HEAD` + `refs/heads/` directly (no git commands):
  `cafc512376a44dc90f2a16ccf27749355a923422`, worktree carrying all Round 3
  landings uncommitted.
- Every MAY/MUST NOT in the declaration is tied to a file read this session:
  `package.json`, `docs/specs/release-gate.md`,
  `docs/decisions/0006-pi-extension-reverse-adapter.md`,
  `docs/status-matrix.md` (P0 / F-PROD / Checkpoint G rows), `CHANGELOG.md`,
  `docs/reports/2026-08-25-preview-release-gap.md` (§4 内测-with-P0-open
  posture), `.github/workflows/ci.yml`, `scripts/security-probe.mjs`,
  `src/feedback/redaction.ts`, `src/cli/main.ts`, README command table, and
  the three sibling Round 3 reports that existed at close.

## Round 3 state as observed (~16:25–16:50 UTC)

| Slot | Code in-tree | Report |
|---|---|---|
| gpt-A | CI `node-version: ["22.19.0"]` on both jobs, with comment | yes |
| gpt-B | `market-eval:probe` script; release-gate truth-up (Rule 3 in-code, CI-is-a-bar); GREEN kept at 14 — correct at their read time | yes |
| opus-A | lookaround boundary fix in `redaction.ts`; 2 probe samples; both test files; live `passed: 16` run + negative control recorded | yes |
| opus-B | `inspect-format` imported and used in `main.ts` (lines 56, 1065, 1149, 1158); `--follow` + `--max-cost-usd` intact; README `unblock`/`help` rows present | **not yet** at close |

Concurrency note: my first read of `scripts/security-probe.mjs` (~16:26) had
no screaming-snake samples; a re-read minutes later had both, and
`main.ts` gained the `inspect-format` import between reads. The audit is of
the final observed state; I re-checked the volatile files (GREEN block,
r3-*.md) immediately before writing.

## Brief conditional — TRIGGERED

"If opus-A's redaction sample is in-tree, require GREEN re-date." Both samples
are in-tree, so the declaration (§5) **requires** the re-date before the spec
GREEN may be cited for screaming-snake coverage: the spec still records
`passed: 14` / 4 `secret-bodies` samples, while the probe now has 16 checks /
6 samples. This is a timing artifact, not an error by either sibling — gpt-B
froze the spec before opus-A's samples landed, exactly as their briefs
instructed. Opus-A's report § "For R3-gpt-B" carries the complete re-date
payload (date, command, `passed: 16`, 9/6 split, delta names).

## Open items handed to the parent

1. **Re-date the GREEN block** on the final tree (build + probe, expect
   `passed: 16`) using opus-A's payload — the only Round 3 doc item left
   open.
2. **Drop the stale CHANGELOG sentence** "not yet called from
   `src/cli/main.ts`" (now an underclaim; safe but wrong).
3. **Commit** — no SHA is claimable as the 内测 build until the parent
   commits the Round 3 worktree; the declaration's §1 rule covers the rest.
