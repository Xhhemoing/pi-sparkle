# Round 1 — branch merge + developer-preview (内测) closeout

**Branch:** `cursor/merge-preview-release-8011`
**Parent:** Cursor Grok 4.6 orchestrator (3 rounds × 6 agents: 2 fable, 2 opus-fast, 2 gpt-sol)
**Base:** `main` @ `80eb0bd` plus ingested PR #11 (`cursor/opt-r22-42b1`) and Loop 4 closeout (`cursor/loop4-closeout-summary-42b1`)
**Goal:** merge remaining unique production from open/stale branches; unblock `pnpm prerelease` for an honest developer-preview 内测.

## Already ingested (parent, do not redo)

- PR #11 (MERGEABLE, CI green): CLI `--max-cost-usd`, flowchart run-level cap, kernel-reuse truth-up.
- `cursor/loop4-closeout-summary-42b1`: 1 docs commit, 0 behind main.

## Constraints

- Subagents **never git commit / push / checkout another branch**. Stay on `cursor/merge-preview-release-8011`.
- First line of every report must declare the **actual model slug** used.
- Do **not** silently downgrade models.
- Do **not** merge PR #9 (`cursor/sota-persistent-opt-83a1`) wholesale — 427 ahead / 278 behind / CONFLICTING / 221 sota-opt reports. Classify unique `src/` survivors; do not dump the campaign log onto preview.
- Do **not** `git merge` the 200+ `rN-*-pass-83a1` report slices.
- ADR-006 stays Proposed. No live R1/bandit/topology. No Outcome-supported. No auto-promote.
- `package.json` `private: true` stays unless fable-B + opus-B jointly prove preview packaging needs a documented exception (parent decides).
- Node in this VM is `v22.14.0`; engines declare `>=22.19.0`. Do not lie about that.

## File ownership (disjoint)

| Slot | Model | Writes | Must not touch |
|---|---|---|---|
| R1-fable-A | `claude-fable-5-thinking-xhigh` | `docs/reports/2026-08-25-branch-merge-disposition.md`, `.agent_workspace/r1-fable-a.md` | `src/`, `scripts/`, `test/` |
| R1-fable-B | `claude-fable-5-thinking-xhigh` | `docs/reports/2026-08-25-preview-release-gap.md`, `.agent_workspace/r1-fable-b.md` | `src/`, `scripts/` (may **read** `docs/specs/release-gate.md`) |
| R1-opus-A | `claude-opus-5-thinking-high-fast` | `src/feedback/redaction.ts`, `test/unit/feedback/redaction.test.ts`, `test/unit/privacy/redaction.test.ts`, `.agent_workspace/r1-opus-a.md` | `src/cli/`, `src/run/flowchart-run.ts`, `docs/specs/release-gate.md` |
| R1-opus-B | `claude-opus-5-thinking-high-fast` | `docs/specs/release-gate.md`, `docs/reports/2026-08-20-developer-preview-readiness.md`, `test/unit/feedback/release-gate-policy.test.ts` (new if needed), `.agent_workspace/r1-opus-b.md` | `src/feedback/redaction.ts`, `src/cli/main.ts` |
| R1-gpt-A | `gpt-5.6-sol-xhigh-fast` | `scripts/security-probe.mjs` (only if a real probe bug), `.agent_workspace/r1-gpt-a.md` | production `src/` except reading |
| R1-gpt-B | `gpt-5.6-sol-xhigh-fast` | `scripts/preview-release-probe.mjs` (new), `.agent_workspace/r1-gpt-b.md` | `src/` |

Parent owns `.agent_workspace/PROGRESS.md`, git, PR.

## Tasks

### R1-fable-A — branch merge disposition (SOTA audit)

Inventory every `origin/*` branch vs `main` and vs this branch. Classify each as:

- **INGESTED** (already on this branch)
- **MERGE-NOW** (unique production, mergeable, not superseded)
- **CHERRY-PICK** (unique files/commits worth porting; list SHAs + files)
- **SUPERSEDED** (unique commits exist but main already has a later equivalent)
- **TRACKER-ONLY** (PR #9 campaign; keep exclusive)
- **STALE-REPORT** (`rN-*-pass-83a1` report slices)

Pay special attention to:

- `cursor/privacy-redaction-adapter-guardrails-f31b` — 6 unique commits; main redaction looks **newer/stronger**. Prove whether any unique behavior remains.
- `cursor/merge-inactive-and-algo-f31b` — 37 ahead / 278 behind; likely a stale integration of the f31b stack.
- `cursor/algorithm-*` / `routing-cluster-algorithm-hardening-9035` — 281 behind, many `changed in both`.
- `cursor/review-followups-d47f` — CLI split, SECURITY.md, CI security probe.
- `cursor/runtime-fidelity-resume-pause-stream-f31b` / `review-fixes-f31b`.
- `cursor/docs-cli-honesty-f31b`.
- PR #9 unique `src/` (25 files listed in parent notes).

Output a table with: branch, ahead/behind, unique `src/` files, verdict, reason. Recommend Round 2 landings (max 3, no padding).

### R1-fable-B — 发行内测 (developer preview) gap vs SOTA

Audit what blocks an honest internal preview:

1. `docs/specs/release-gate.md` says BLOCKED on `pii-redaction` / `secret-bodies` (dated 2026-08-22). Main `src/feedback/redaction.ts` now has value-removing placeholders. Decide: is the spec stale, or is the probe still red?
2. `package.json` `private: true` — keep for 内测? What does "发行内测" mean here: `pnpm prerelease` green + documented preview, **not** npm publish.
3. Engines `>=22.19.0` vs this VM `v22.14.0` and CI `22.x`.
4. P0 privacy still open (human sign-off). What can ship as 内测 without claiming P0 closed.
5. `pnpm prerelease` = gate + security:probe + pi:probe. List each bar.

Do **not** waive `packaged-secrets`. Do not mark Outcome-supported. Write an acceptance checklist for Round 2/3.

### R1-opus-A — close redaction vs the live security probe

1. Census current `redactFeedback` / `redactSensitiveText` against `scripts/security-probe.mjs` samples.
2. If the probe still finds surviving cores, fix **value removal** (placeholders already exist). Keep idempotence and the existing class taxonomy.
3. Add/adjust unit tests that pin each probe sample: after `redactPII: true`, `sample.core` must not appear in `body`.
4. Do not weaken tests. Do not change the probe's sample cores unless a sample is objectively wrong (document why).
5. If already green, report evidence and add any missing pin tests only — no cosmetic refactor.

### R1-opus-B — release-gate spec honesty + preview readiness doc

1. After reading gpt-A probe results (if the file exists) **or** running a local build+probe yourself, rewrite `docs/specs/release-gate.md` to the **current** status. If still BLOCKED, keep BLOCKED with live findings. If green, say GREEN with command + date. Empty waiver register stays empty unless parent recorded one.
2. Refresh `docs/reports/2026-08-20-developer-preview-readiness.md` (or add a 2026-08-25 addendum section) so 内测 operators know: gate commands, Node pin, what is fake vs pi, what is still open (ADR-006, P0 human, F-PROD).
3. Optional new unit test file `test/unit/feedback/release-gate-policy.test.ts` **only if** you can pin a policy constant without editing `redaction.ts` (opus-A owns that file). If you need a shared policy export, request it in the report — do not race opus-A.

### R1-gpt-A — live security + pi probes

1. `pnpm install --frozen-lockfile` if needed, `pnpm build`, run `node scripts/security-probe.mjs`, `pnpm pi:probe` / `pnpm pi-compat`.
2. Record exact JSON, exit codes, Node/pnpm versions.
3. If the probe itself is buggy (false positive against correct redaction), fix `scripts/security-probe.mjs` with a comment citing the sample. Prefer fixing redaction (opus-A) over loosening the probe.
4. Boundary: PEM, bearer, `api_key=`, windows UNC, CN phone, luhn card.

### R1-gpt-B — preview-release probe script

Add `scripts/preview-release-probe.mjs` that fails closed on 内测 blockers we can automate:

- `package.json` private is true (preview must not be accidentally public) — **or** document the inverse if fable-B decides otherwise; default: private must stay true.
- `engines.node` is a semver range, not empty.
- `docs/specs/release-gate.md` contains a Status heading.
- `pnpm-workspace.yaml` exists.
- bin path `dist/cli/main.js` is listed in `bin`.

Keep it fast (no full test suite). Report how parent should wire it (`prerelease` vs standalone). Do not change `package.json` scripts unless fable-B's report already asked and parent signed off — in Round 1, **do not** edit `package.json`; only the script + your report.

## Verification

Each code slot: scoped tests + `tsc --noEmit` if you touched `src/`. No full `pnpm gate` (parent runs it).
Each docs slot: no invented usage numbers; cite files/SHAs.
