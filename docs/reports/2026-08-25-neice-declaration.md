model: claude-fable-5-thinking-xhigh

# 内测 declaration — what an operator may claim after Round 3

**Date:** 2026-08-25. **Branch:** `cursor/merge-preview-release-8011`.
**Audited state:** the worktree as observed ~16:25–16:50 UTC, with HEAD at
`cafc512376a44dc90f2a16ccf27749355a923422` and all Round 3 landings present in
the worktree but **not yet committed** (redaction boundary fix, two new probe
samples, CI Node pin, `inspect-format` wiring, release-gate truth-up,
`market-eval:probe` script). Round 3 slot reports existed for gpt-A, gpt-B and
opus-A at audit close; opus-B's code was in-tree, its report not yet written.

This document is a **claims audit**. It grants nothing; it only narrows. Every
MAY cites in-tree evidence. Every MUST NOT names its unlock event. A statement
stronger than a MAY below is an overclaim and is forbidden.

---

## 1. Identity and SHA

**MAY claim:**

- The 内测 artifact is `pi-sparkle` `0.1.0`, branch
  `cursor/merge-preview-release-8011` (`package.json`).
- `cafc512` is the last commit **before** the Round 3 landings. It does not
  contain them.

**MUST NOT claim:**

- Any SHA as "the 内测 build" until the parent commits the Round 3 worktree
  and `git status` is clean. At audit time no commit contains the
  screaming-snake redaction fix, the CI pin, or the wired verification
  display; quoting `cafc512` for those changes attributes work to a tree that
  does not have it.

**Rule:** a 内测 identity claim names all four of: branch, exact commit SHA of
a clean worktree, the date of the certifying `pnpm prerelease` run, and the
host Node version of that run.

## 2. What `pnpm prerelease` means

`package.json` defines it exactly as:

```
pnpm preview:probe && pnpm gate && pnpm security:probe && pnpm pi:probe
```

i.e. (1) five cheap preview invariants (`private: true`, non-empty
`engines.node`, the `bin` path, a Status heading in
`docs/specs/release-gate.md`, `pnpm-workspace.yaml`) — first, so a broken
invariant stops the rest; (2) `typecheck && lint && test && build`;
(3) the security probe against the freshly built `dist/`; (4) the Pi pin /
adapter-contract probe.

**MAY claim:** "on \<date\>, commit \<sha\>, host Node \<version\>, all four
bars passed." That is the entire meaning of a pass.

**MUST NOT claim:**

- That a pass is a release authorization. The spec says so itself
  (`docs/specs/release-gate.md` § "What GREEN does not mean").
- That a pass proves quality, performance, or adaptive benefit.
- An undated or host-less pass. The spec marks the pi-compat result "a
  **local, dated claim**; re-run it before treating it as current".
- That `market-eval:probe` is enforced by the bar. It is wired as a script in
  `package.json` (Round 3, gpt-B) but is **not** part of `prerelease`.

## 3. Node floor

**MAY claim:**

- The package requires Node `>=22.19.0` (`package.json` `engines.node`).
- CI's quality and cli-smoke jobs are pinned to `node-version: ["22.19.0"]`
  (`.github/workflows/ci.yml`, Round 3 gpt-A), so once CI runs on the
  committed tree, the probe and gate certify on an engines-compliant host.

**MUST NOT claim:**

- "Verified on supported Node" from any Round 1–3 local evidence. Every
  recorded local run this round — the spec's GREEN run, gpt-B's script
  verification, opus-A's 2135-test run and probe run — was on Node
  `v22.14.0`, **below** the declared floor (each report says so). The
  supported-Node result exists only after a green CI run on the pinned
  matrix, or a local run on `>=22.19.0`.

## 4. Private package — not npm-publishable

**MAY claim:** the preview is internal and developer-operated. `private: true`
in `package.json` makes `npm publish` refuse mechanically; `preview:probe`
fails the release bar if that field ever changes.

**MUST NOT:** publish to any registry, distribute outside the team, or state
that publication is planned — no in-tree decision says so, and the P0 posture
(§6) assumes the internal audience. `private: true` is frozen.

## 5. Security gate — GREEN, but a re-date is REQUIRED before citing it

This is the one place where Round 3 changed what the spec's GREEN covers, and
the spec has not caught up.

**Facts at audit close:**

- `docs/specs/release-gate.md` records GREEN 2026-08-25 with `"passed": 14`
  and a `secret-bodies` row of **4 samples**.
- `scripts/security-probe.mjs` now carries **6** `secret-bodies` samples:
  opus-A added `screaming-snake-password-value`
  (`DATABASE_PASSWORD=hunter2-prod-db`) and `screaming-snake-token-value`
  (`API_TOKEN=abc123def456ghi789`) after gpt-B had already finished the spec
  edit. Both slot reports are correct for their own read times; the net
  result is that the spec's GREEN block is one re-run behind the probe.
- A live post-fix run **is** recorded in `.agent_workspace/r3-opus-a.md`:
  `{"status":"ok","passed":16,"openFindings":[],"waivedFindings":[]}` after
  `pnpm build`, plus a negative control (reverting the built `dist/` to the
  `\b` boundary made the probe go BLOCKED with exactly the two new findings,
  `passed: 14`, exit 1). Host: Node v22.14.0, below floor (§3).

**Required before the spec GREEN may be cited for screaming-snake coverage:**
re-run `pnpm build && node scripts/security-probe.mjs` on the final committed
tree and re-date the GREEN block to record `passed: 16` and the 9/6 sample
split, naming the two added samples. Opus-A's report § "For R3-gpt-B" contains
the exact payload. Until that edit lands:

**MAY claim:**

- The screaming-snake redaction gap is fixed at source level: the `\b`
  boundary around `KEYED_SECRET_NAMES` was replaced with explicit
  letter/digit lookarounds in `src/feedback/redaction.ts`, and the behavior
  is pinned by `test/unit/feedback/redaction.test.ts` (GATE_CORES pins,
  negative matrix keeping `TOKEN_COUNT`/`MAX_TOKENS` untouched, idempotence)
  and `test/unit/privacy/redaction.test.ts` (shipped store policy).
- A probe run with `passed: 16` on the post-fix tree is on record in
  `.agent_workspace/r3-opus-a.md`, on a below-floor host.
- Rule 3 is enforced in code: `SECURITY_WAIVER` cannot suppress
  `packaged-secrets` (probe waiver predicate; spec § Waivers). The waiver
  register is empty.

**MUST NOT claim:**

- "Release-gate GREEN covers `DATABASE_PASSWORD=` / `API_TOKEN=`" while the
  spec says 14 passed / 4 samples.
- A re-dated GREEN without a fresh build+probe run on the tree being dated.
- Any weakening of never-waivable `packaged-secrets` — the unconditional
  block is code, not policy, and stays that way.

## 6. ADR-006 — Proposed, and staying Proposed

**MAY claim:** the Pi-extension reverse-adapter design exists as ADR-006 with
Status **Proposed** (`docs/decisions/0006-pi-extension-reverse-adapter.md`);
`docs/status-matrix.md` records the 2026-08-21 decision "keep Proposed; no
`extensions/pi-sparkle/` import until revisited"; and the boundary is
test-enforced — `test/unit/pi-boundary.test.ts` asserts no `pi.extensions`
manifest entry and no `pi-coding-agent` dependency.

**MUST NOT claim:** that the extension architecture is accepted, adopted, or
implemented; nor register any extension. Unlock: an explicit ADR status
change, which is out of scope for 内测 and frozen for this branch.

## 7. P0 privacy — not closed

**MAY claim:** the machinery is implemented and tested — 18 record classes,
plane layout, redaction-as-transform on every adaptation-plane feedback
write, persisted `redactionClasses`, and the delete cascade — and the gap is
disclosed in the preview docs ("P0 privacy review is not closed",
`docs/reports/2026-08-20-developer-preview-readiness.md`; "CONDITIONAL, not
closed", `CHANGELOG.md`).

**MUST NOT claim:** that P0 is closed, approved, or signed off — or imply it
by omission. `docs/status-matrix.md` is the authority: "Reviewer
re-verification of Q1/Q2 remediation, then sign-off — **still open**".
内测 ships *with* the open item disclosed, inside the posture the open review
assumes: internal audience, nothing adaptive live, nothing published. Unlock:
the reviewer's recorded sign-off, a human event no document in this round can
substitute for.

## 8. Not Outcome-supported — no adaptive claims

**MAY claim:** a proposal-first adaptation plane exists; promotion requires
the five-flag human path (`adapt promote --candidate --expected
--content-file --review-file --approve`); `adapt eval` labels its own output
`qualityEvidence: "none-by-construction"`.

**MUST NOT claim:**

- Any adaptive gain, benefit, or "Outcome-supported" status. The status
  matrix forbids it structurally: Checkpoint G is "Forbidden until F", and
  F-PROD has not started ("do not start before P0 + Provider smoke").
- That live adaptive routing is on. Live routing is R0-equivalent static
  `ModelRouter`; R1/bandit/topology are pinned off the execution path by
  `live-isolation` tests. Turning them on is frozen.

## 9. Verification display — honesty plumbing, not new capability

Round 3 wired `src/cli/inspect-format.ts` into `src/cli/main.ts` (the import
plus the `--track`, `run --children` result lines and the `unverified: N/M`
summaries); `inspect --follow` and `run --max-cost-usd` are intact.

**MAY claim:** CLI inspection output now displays
`verification=PASSED|FAILED|UNOBSERVED` and marks unverified outcomes, so an
operator can see what was never verified.

**MUST NOT claim:** that the display verifies anything. `UNOBSERVED` printed
as `(unverified)` is the feature — it reports absence of verification; it
does not create verification.

**Claim-surface flag for the parent:** `CHANGELOG.md` still says the module
"is not yet called from `src/cli/main.ts`". That sentence is now stale in the
safe direction (an underclaim). Drop it at commit time; it blocks no claim
meanwhile.

## Forbidden claims — consolidated

1. P0 closed / approved / signed off. *Unlock: recorded reviewer sign-off.*
2. Outcome-supported, adaptive gains, or live R1/bandit routing.
   *Unlock: F-PROD then Checkpoint G — frozen.*
3. npm publication, registry distribution, or distribution outside the team.
   *Unlock: none for 内测; `private: true` is frozen.*
4. ADR-006 accepted or any Pi extension registered. *Frozen at Proposed.*
5. Spec GREEN covering the screaming-snake samples, or any "16 passed" spec
   citation, before the GREEN block is re-dated by a fresh build+probe run
   (§5).
6. Any SHA quoted as the 内测 build before the clean post-Round-3 commit
   exists (§1).
7. "Verified on supported Node" from this VM's v22.14.0 evidence (§3).
8. PR #9 merged, or any merge of it. *Frozen.*
9. A Round 4 by default. Frozen: further rounds require a new, reproduced
   gap, not padding.

## What upgrades a claim

| Claim wanted | Event that unlocks it |
|---|---|
| "内测 build is commit X" | Parent commits Round 3 tree; clean `git status`; X = that HEAD |
| "prerelease passed on the 内测 build" | `pnpm prerelease` exit 0 on commit X, date + host recorded |
| "gate GREEN, 16 checks, screaming-snake covered" | Build+probe re-run on commit X; GREEN block re-dated with `passed: 16`, 9/6 split |
| "certified on supported Node" | Green CI run on the `22.19.0` matrix (or a local run on `>=22.19.0`) |
| "P0 closed" | Reviewer sign-off recorded in the status matrix |
| "Outcome-supported" | F-PROD complete, then Checkpoint G — not a 内测 concern |

Anything not upgraded stays at its §1–§9 MAY level. When in doubt, the weaker
claim is the correct one.

## Parent closeout (2026-08-25, after Round 3 slot files existed)

- GREEN block in `docs/specs/release-gate.md` was re-dated to `passed: 16`
  with the 9/6 sample split (gpt-B follow-up after opus-A).
- `CHANGELOG.md` no longer says `inspect-format` is unwired.
- `pnpm prerelease` on this closeout is recorded in `.agent_workspace/PROGRESS.md`
  and the PR. The 内测 SHA is the Round 3 commit once this tree is clean.
- Local host remains Node v22.14.0 (below floor). CI is pinned to 22.19.0.

