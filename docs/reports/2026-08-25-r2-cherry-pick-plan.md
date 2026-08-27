model: claude-fable-5-thinking-xhigh

# R2 cherry-pick / port verification plan (2026-08-25)

**Author:** R2-fable-B (`claude-fable-5-thinking-xhigh`)
**Verified against:** committed HEAD `afec150` on `cursor/merge-preview-release-8011` (one commit past `e88f2ce`, which the Round 1 disposition simulated against). Method: `git merge-tree --write-tree --merge-base=<sha>^ HEAD <sha>` per commit, `git grep` against `HEAD:` (never the worktree) for content claims, and manual diff reads of every commit in scope. No cherry-picks were performed; nothing was committed.

**Caveat on timing:** while this verification ran (~16:11–16:15 UTC), all four other Round 2 slots were writing uncommitted changes into the shared worktree (gpt-A: `ci.yml` + `security-probe.mjs`; gpt-B: `package.json` + probe test; opus-A: `main.ts` + `inspection.ts` + its test; opus-B: the adapt-eval/pi-boundary/inspect-format set). Every claim below is therefore anchored to committed HEAD `afec150`, with worktree observations flagged as such.

## 1. The four-commit clean set — all still CLEAN on HEAD `afec150`

| SHA | Subject | Files | merge-tree vs `afec150` |
|---|---|---|---|
| `5f49bdc` | adapt eval declares no quality evidence + action diff | `src/adaptation/eval-routing.ts` (+46), `src/cli/adapt.ts` (+24), `test/unit/adaptation/eval-routing.test.ts` (+10), `test/unit/cli/adapt.test.ts` (+31) | **CLEAN** (tree `2679986`) |
| `38e20c2` | eval-report fixtures carry the honesty fields | `test/unit/adaptation/promotion.test.ts`, `test/unit/learning/active-routing.test.ts`, `test/unit/run/flowchart-learned-routing.test.ts` (+3 each) | **CLEAN** (tree `3103006`) |
| `92f00bc` | ADR-006 guardrails become assertions | `test/unit/pi-boundary.test.ts` (+38) | **CLEAN** (tree `11b54a3`) |
| `df964ae` | governance files | `SECURITY.md`, `CHANGELOG.md`, `.github/CODEOWNERS`, `.env.example` (all new) | **CLEAN** (tree `a5d9ac3`) |

The four file sets are fully disjoint, so sequential application stays clean in any order; logically `5f49bdc` and `38e20c2` must land together (`5f49bdc` adds required `qualityEvidence`/`qualityEvidenceNote`/`actionDiff` fields to the report type, so fixtures fail `tsc` until `38e20c2`'s +3-line blocks follow).

Content gaps re-confirmed at HEAD (all greps against `HEAD:`, exit 1 = no match):

- `qualityEvidence`/`actionDiff`: absent from `HEAD:src/` (only false positive is `interactionDiffs` in `src/routing/offline-prob-add.ts`). Note the disposition's "eval-routing untouched since `09f325c`" is now slightly stale — `9c58b90` (atomic report publish) touched it — but the pick stays clean.
- ADR-006 assertions: `HEAD:test/unit/pi-boundary.test.ts` has zero `ADR-006` matches; it still ends at the single "only Pi importer" test. `92f00bc`'s package whitelist (`pi-agent-core`, `pi-ai`) and the no-`pi.extensions`/no-`pi-coding-agent` assertions are all missing.
- Governance files: `SECURITY.md`, `CHANGELOG.md`, `.github/CODEOWNERS`, `.env.example` all absent from HEAD.

**However: a raw pick of `df964ae` is mechanically clean but factually stale.** Its content predates the Round 1 GREEN re-baseline (`HEAD:docs/specs/release-gate.md:16` now reads "Status: GREEN — 2026-08-25", waiver register "(empty)"). Stale passages that must be adapted, not picked verbatim:

- `SECURITY.md` §"Known open findings": "As of 2026-08-22, `pii-redaction` and `secret-bodies` are open" — wrong; probe is GREEN, 14 passed, 0 open, no waiver.
- `.env.example` line ~45: "CI uses: pii-redaction,secret-bodies" — wrong; Round 2 CI runs the probe with **no** waiver (gpt-A).
- `CHANGELOG.md` lines ~18–19 and ~67: "CI now runs `pnpm security:probe` … with a registered waiver for the two open findings" and "findings … are open" — both wrong now.
- Keep unchanged: the never-waivable `packaged-secrets` language, the register-before-use waiver rule, and `.github/CODEOWNERS` (2 lines, no adaptation needed).

So the four-commit set is **verified viable as a raw cherry-pick fallback**, but the primary path stays the brief's: opus-B hand-writes the same content adapted to the GREEN gate. The parent must choose exactly one mechanism — opus-B's worktree already contains most of this content uncommitted (see §5), and raw-picking on top of it would conflict or double-apply.

## 2. `808bc0b` — confirmed: reimplement without waivers; do not pick

Verdict confirmed on three independent grounds:

1. **It no longer applies.** Against `e88f2ce` it was CLEAN; against `afec150` it now **CONFLICTS** in `docs/specs/release-gate.md` (Round 1 rewrote the status section it edits). Only the `ci.yml` half still auto-merges.
2. **Its CI step is wrong by design for today's gate.** The step sets `SECURITY_WAIVER: pii-redaction,secret-bodies` — waiving two findings that are now closed. Landing it would reopen a waiver for nothing and normalize a waiver env var in CI that Round 2 explicitly bans.
3. **Its release-gate.md diff resurrects "Status: currently BLOCKED"** and fills the (now empty) waiver register with a `ci-quality-probe` entry expiring 2026-09-30 — both contradict `HEAD:docs/specs/release-gate.md:16` ("GREEN — 2026-08-25") and line 101 ("(empty)").

The only idea worth keeping from `808bc0b` is *"CI runs the probe after Build against `dist/`"* — reimplemented with **no `SECURITY_WAIVER` env at all**. That is exactly R2-gpt-A's slot (`scripts/security-probe.mjs` never-waivable `packaged-secrets` + `ci.yml` probe step), and gpt-A was observed writing both files in the worktree during this verification. Nobody should cherry-pick `808bc0b`; opus-B and the parent should treat it as reference-only.

## 3. `fc6058c` — confirmed: verification display still absent at HEAD; hand-port required

- `git grep 'unverified|verification=' HEAD -- src/cli src/run README.md` → **0 matches** (exit 1). The only `unverified` in `HEAD:src/` is `src/learning/signals.ts:303,319`, which labels learning episodes internally and prints nothing to the CLI.
- Raw pick **CONFLICTS in 5 files** vs `afec150`: `README.md`, `docs/specs/m0-m2-architecture.md`, `docs/specs/release-gate.md`, `docs/status-matrix.md`, `src/cli/main.ts` (one more than the disposition's count — Round 1's release-gate rewrite added the fifth). Hand-port stands.
- **Data dependencies are intact on HEAD**, so the port is mechanical: `HEAD:src/run/inspection.ts:18` still exposes `ChildInspection.terminalResult?: TaskResult`, and `HEAD:src/protocol/v1.ts:142` still defines `VerificationResult { kind, evidenceIds }`. `src/cli/inspect-format.ts` (38 lines, pure functions `formatTaskResultLine` / `unverifiedTaskIds` / `formatUnverifiedSummary`) can be taken from `fc6058c:src/cli/inspect-format.ts` essentially verbatim.
- **Scope trim:** take only the verification display. Skip `fc6058c`'s other freight — the `resume --supervised` deprecation warning, the `--children`-engine usage-doc rewrite, the README mini-grid replacement, and its status-matrix/release-gate edits (which add a "BLOCKED with open finding ids" row that is now false). Those were written against the 08-23 tree and are superseded or wrong today.

### Exact `main.ts` wiring patch (for the parent — opus-B must not touch `main.ts`)

Line numbers are HEAD `afec150`; opus-A is editing `main.ts` for `--follow` right now, so splice by anchor string, after opus-A commits:

1. Imports: add `import { formatTaskResultLine, formatUnverifiedSummary } from "./inspect-format.js";` next to the existing `import { inspectRun } from "../run/inspection.js";`.
2. `run --track` block (anchor: the `` `  learn: ${outcome.learn.reason}...` `` line, HEAD:1032): after that `if`, add
   `const trackInspection = await inspectRun(stateRoot, outcome.runId);` + print `formatUnverifiedSummary(trackInspection.children)` when defined.
3. `run --children` block (anchor: `` `      result: ${terminal.outcome} — ${terminal.summary}\n` ``, HEAD:1114): replace with `` `      result: ${formatTaskResultLine(terminal)}\n` ``; after the `for (const child of inspection.children)` loop closes (HEAD:~1123, before `const episodeId = episodeIdFromEvents(...)`), print `formatUnverifiedSummary(inspection.children)` when defined.
4. `inspect` command (anchor: the identical `result:` line, HEAD:1338): same replacement; print the summary after the loop, still inside the `if (inspection.children.length > 0)` block (HEAD:~1347).
5. `--json` output unchanged (matches `fc6058c`'s contract and cae9's frozen `InspectSummaryJson`).

## 4. Exact files opus-B should write

**Assigned by the brief and confirmed correct (10):**

1. `SECURITY.md` — from `df964ae`, with §"Known open findings" rewritten to GREEN (0 open, no waiver, cite release-gate.md 2026-08-25); keep never-waivable `packaged-secrets` and register-before-use rules.
2. `CHANGELOG.md` — from `df964ae`, drop/rewrite the two stale waiver passages (lines ~18–19, ~67); CI probe entry should say "no waiver".
3. `.github/CODEOWNERS` — verbatim from `df964ae` (`* @Xhhemoing`).
4. `.env.example` — from `df964ae`, fix the `SECURITY_WAIVER` comment ("CI uses: pii-redaction,secret-bodies" → CI runs unwaived; `packaged-secrets` never waivable).
5. `src/cli/adapt.ts` — `5f49bdc`'s +24 (quality-evidence disclaimer in usage + per-episode action diff, capped at 10 rows).
6. `test/unit/cli/adapt.test.ts` — `5f49bdc`'s +31.
7. `test/unit/adaptation/eval-routing.test.ts` — `5f49bdc`'s +10.
8. `test/unit/pi-boundary.test.ts` — `92f00bc`'s +38 (package whitelist + no-`pi.extensions`/no-`pi-coding-agent` assertions).
9. `src/cli/inspect-format.ts` — new, from `fc6058c` (38 lines, pure; no `main.ts` import needed to compile standalone).
10. `.agent_workspace/r2-opus-b.md`.

**Required by the same ports but missing from the brief's list (5) — opus-B should write these too; none collide with another slot, and none are on opus-B's must-not-touch list:**

11. `src/adaptation/eval-routing.ts` — `5f49bdc`'s +46 is the substance of the port (report-type fields, conditional validation, population in the eval path); `src/cli/adapt.ts` alone won't compile without it. Already being written in the worktree.
12. `test/unit/adaptation/promotion.test.ts` — `38e20c2` fixture +3 (required for `tsc` once the report type carries the fields).
13. `test/unit/learning/active-routing.test.ts` — `38e20c2` fixture +3.
14. `test/unit/run/flowchart-learned-routing.test.ts` — `38e20c2` fixture +3.
15. `test/unit/cli/inspect-format.test.ts` — `fc6058c`'s 105-line unit test; without it the verification display lands with zero coverage. New file, owned by nobody else.

**Out of opus-B's hands — route elsewhere:**

- `src/cli/main.ts` wiring (§3 patch) → parent, after opus-A's `--follow` commit.
- `test/unit/run/inspection.test.ts` — `fc6058c` adds 6 assertion lines (`terminal?.verification.kind === "PASSED"`, `terminalResult?.verification.kind`); opus-A owns and is currently editing this file → hand the 6-line block to opus-A/parent.
- `test/integration/cli/cli.test.ts` (+45 in `fc6058c`) — unowned this round; optional given the unit test; parent decision.
- `.github/workflows/ci.yml` → gpt-A only (§2).
- `fc6058c`'s README/status-matrix/release-gate/m0-m2 doc edits → skip (stale/superseded; doc reconciliation is fable-A/parent territory).

## 5. Worktree observations and sequencing (as of ~16:14 UTC)

Uncommitted parallel writes seen: `M .github/workflows/ci.yml`, `M scripts/security-probe.mjs` (gpt-A); `M package.json`, `?? test/unit/package/preview-release-probe.test.ts` (gpt-B); `M src/cli/main.ts`, `M src/run/inspection.ts`, `M test/unit/run/inspection.test.ts` (opus-A); `M src/adaptation/eval-routing.ts`, `M src/cli/adapt.ts`, `?? src/cli/inspect-format.ts` (content matches `fc6058c`'s), `M test/unit/{adaptation/eval-routing,adaptation/promotion,cli/adapt,learning/active-routing,pi-boundary,run/flowchart-learned-routing}.test.ts` (opus-B). Governance files (items 1–4) and `test/unit/cli/inspect-format.test.ts` (item 15) were **not yet present**.

Sequencing for the parent:

1. Let opus-B's hand-port land as the single application of `5f49bdc`/`38e20c2`/`92f00bc`/`df964ae` content. Do **not** also raw-cherry-pick those SHAs afterward — the worktree already contains the content and picks would conflict or duplicate. Raw picks remain a clean fallback **only** if opus-B's slot is abandoned before commit (and then `df964ae`'s stale GREEN-contradicting text still needs a follow-up edit).
2. `main.ts` verification wiring (§3) goes in after opus-A's `--follow` commit — both edit the same inspect/children display region.
3. `808bc0b`: reference-only; gpt-A's unwaived reimplementation supersedes it. Nobody picks it.
