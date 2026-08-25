model: claude-fable-5-thinking-xhigh

# R1-fable-A — branch merge disposition (Round 1)

**Deliverable:** `docs/reports/2026-08-25-branch-merge-disposition.md` (written).
**Audited from:** HEAD `e88f2ce` on `cursor/merge-preview-release-8011` (11 ahead / 0 behind `origin/main` @ `80eb0bd`). No commits, no checkouts, no src/scripts/test edits.

## Verdicts (274 origin branches, post `fetch --prune`)

| Verdict | Count |
|---|---|
| STALE-REPORT | 212 |
| SUPERSEDED | 40 |
| INGESTED | 13 |
| CHERRY-PICK | 6 |
| TRACKER-ONLY | 1 (PR #9) |
| MERGE-NOW | 1 |
| self (PR #12) | 1 |

## Load-bearing findings

1. **`cursor/agent-market-eval-opt-cae9` is MERGE-NOW** — the only branch 0 behind current main (tip `73e9677`, 6 commits, 2026-08-25). Unique production: `inspect --run --follow` (`src/run/inspection.ts` +177), exported `USAGE` + README-parity test, doctor verification recording, `scripts/market-eval-probe.mjs`, docs/research. Merge-tree vs HEAD: 5 conflicts, only `src/cli/main.ts` is real (collides with PR #11's `--max-cost-usd` usage text). Warning: its `.agent_workspace/` files reuse this campaign's slot names (`r1-fable-a.md`, `PROGRESS.md`) — resolve ours; it adds one `package.json` script line (parent sign-off).
2. **f31b redaction is dead; the rest of the branch is not.** Main's `redaction.ts` (`d4b16e1`, 08-24) is a strict superset of `a6a2e1d` (08-23). But main still lacks: adapt-eval honesty fields (`5f49bdc`+`38e20c2` — apply CLEAN), ADR-006 assertion tests (`92f00bc` — CLEAN), sidecar `.pi/subagents/runs` opt-in (`cf29cfb` — main's `auto-loop.ts:145` still default-ingests; port), doctor warn tier (`6301a76` — port).
3. **Governance gap:** SECURITY.md / CHANGELOG.md / CODEOWNERS / .env.example do not exist on main; `df964ae` and the CI-probe step `808bc0b` from `review-followups-d47f` cherry-pick CLEAN. d47f's CLI split is stale (main.ts rewritten, 2,329 lines) — redo, don't port.
4. **`runtime-fidelity-resume-pause-stream-f31b` SUPERSEDED** (main independently landed pause wiring, live streaming, clustered resume). Its superset `review-fixes-f31b` keeps one live gap: main aborts the kernel on early consumer exit (`pi-executor.ts:615`) but still loses ModelInvocation telemetry (`reportInvocation` only on the normal path, `:777`) — port `e761534`'s idea, Round 3.
5. **`docs-cli-honesty-f31b` (`fc6058c`) unique:** no verification=/unverified display anywhere on main or in cae9's new inspect code. Hand-port after cae9.
6. **9035 stack** (`routing-cluster-…-hardening` ⊂ … ⊂ `algorithm-revalidate-9035`, tip `40544a6`): genuinely unique — main is still `assign-v2`/`flowchart-v1`, branch reached `assign-v5`/`flowchart-v5` (role/vision isolation, constraint-naming refusals, spawn-depth accounting). 281 behind with Loop-4-rewritten contested files → deferred port campaign, NOT a Round 2 landing. `algorithm-*-f31b` stack superseded by it.
7. **`merge-inactive-and-algo-f31b` / `merge-inactive-slices-f31b`** are stale integrations of the above members (verified merge commits `3ab1afd 30f1a2b 1a77762 319a479 ac4398b 8085500 c2c0571 f29add7`) — never merge; harvest members.
8. **PR #9 (`sota-persistent-opt-83a1`, tip `34a293a`, 464/278, CONFLICTING) TRACKER-ONLY and still active** (pushed during audit). Unique src = 4 new + 15 main-untouched + 6 contested files, all shadow-plane (r1/posterior/offline/experiments). The old `r1-*`/`r2-*`/`r3-*`/`three-line-*`/`sota-r1-a`/`r7-c` branches (29) are all strict ancestors of its tip → SUPERSEDED, zero unique content.
9. **All 212 `rN-*-pass-83a1` slices are single-commit report files** (`docs/reports/sota-opt/round-N/RN-X.md`), 77 already in PR #9's tip, 135 dangling. STALE-REPORT, delete-safe after PR #9 disposition.

## Round 2 recommendations (max 3, ordered)

1. Merge `cursor/agent-market-eval-opt-cae9` (resolve 5 conflicts, `.agent_workspace` ours).
2. Cherry-pick clean set: `5f49bdc` `38e20c2` `92f00bc` `df964ae` `808bc0b` (CI waiver ids must match gpt-A/opus-A's probe re-baseline; empty register if green).
3. Hand-port `fc6058c` verification display (after 1).

## Verification notes

- Ahead/behind computed for all 274 branches (`git rev-list --left-right --count`); ancestry via `merge-base --is-ancestor` for every member of the 83a1, 9035, f31b, three-line, and slice families; cherry-pick feasibility via `git merge-tree --write-tree --merge-base=<sha>^ HEAD <sha>` for 10 candidate SHAs.
- No usage metrics invented; every claim cites a SHA, file, or line.
