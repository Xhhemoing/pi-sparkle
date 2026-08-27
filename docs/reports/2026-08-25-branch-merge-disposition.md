# Branch merge disposition — global SOTA audit (2026-08-25)

**Author:** R1-fable-A (`claude-fable-5-thinking-xhigh`)
**Audited from:** `cursor/merge-preview-release-8011` @ `e88f2ce` (PR #12), which is 11 ahead / 0 behind `origin/main` @ `80eb0bd`.
**Method:** `git fetch --prune`, then for all 274 `origin/*` branches (excluding `origin/main`): ahead/behind vs `origin/main` and vs HEAD, ancestry tests (`git merge-base --is-ancestor`), per-file blob comparison (branch vs main vs merge-base), and `git merge-tree --write-tree` merge/cherry-pick simulations onto HEAD. No usage metrics are cited anywhere in this report because none exist.

## Verdict counts (274 branches)

| Verdict | Count |
|---|---|
| STALE-REPORT | 212 |
| SUPERSEDED | 40 |
| INGESTED | 13 |
| CHERRY-PICK | 6 |
| TRACKER-ONLY | 1 |
| MERGE-NOW | 1 |
| (this branch, PR #12) | 1 |

## 1. MERGE-NOW (1)

### `cursor/agent-market-eval-opt-cae9` — tip `73e9677` (2026-08-25 08:56 UTC), 6 ahead / **0 behind** `origin/main`

The only branch in the repository that is both ahead of and current with main. It is a completed 3-round "market-eval" campaign that landed directly on main's tip `80eb0bd`, in parallel with this preview campaign. Unique production content, none of which exists on main or HEAD:

- `src/run/inspection.ts` (+177): `followRunEvents`, `FOLLOW_STOP_STATUSES`, `buildInspectSummaryJson` — a read-only, lock-free `inspect --run --follow` tail that exits 0 on terminal/operator statuses.
- `src/cli/main.ts` (+248): `--follow`/`--idle-timeout-ms` wiring and an exported `USAGE` block held against the dispatch switch and README by a new `test/unit/cli/readme-command-parity.test.ts`.
- `src/pi-adapter/pi-executor.ts` (+43, "H0 honesty"), `src/cli/doctor.ts` (verification recording).
- `scripts/market-eval-probe.mjs` (new, 274 lines) + `market:eval` script line in `package.json`.
- `docs/research/{agent-ecosystem-eval,mcp-position,node-engine-floor}.md`, `docs/reports/2026-08-25-market-eval-sota-acceptance.md`.
- New tests: `answer-correlation`, `inspect-follow`, `readme-command-parity`, `market-eval-probe`, `mcp-absence`.

Merge simulation into HEAD `e88f2ce`: **5 conflicts**, four of them docs/workspace (`.agent_workspace/PROGRESS.md`, `docs/kernel-reuse.md`, `.agents/skills/pi-sparkle/references/kernel-reuse.md`, `docs/status-matrix.md`) and one real (`src/cli/main.ts`, where PR #11's `--max-cost-usd` and cae9's `USAGE`/`--follow` both edited the usage/dispatch region).

Caveats for the parent:
1. Its `.agent_workspace/` slot files use the **same names as this campaign's** (`r1-fable-a.md`, `r1-opus-a.md`, …) plus `PROGRESS.md`. Resolve those paths with **ours**; take theirs only for `market-eval-OWNERSHIP.md` and `r2-*`/`r3-*` files if wanted.
2. It adds one `package.json` script (`"market:eval"`). It does **not** touch `private`, `engines`, or `bin` — no conflict with the 内测 constraints, but `package.json` edits are a parent-signoff item per the brief.
3. `readme-command-parity.test.ts` will start enforcing README↔USAGE parity; if PR #11's `--max-cost-usd` line is missing from cae9's README table, the merged tree must reconcile before `pnpm gate`.

## 2. CHERRY-PICK (6)

Cherry-pick simulations were run with `git merge-tree --write-tree --merge-base=<sha>^ HEAD <sha>`; "CLEAN" below means zero conflicts against HEAD `e88f2ce`.

### `cursor/privacy-redaction-adapter-guardrails-f31b` — tip `38e20c2`, 6 ahead / 281 behind

The redaction commit itself is dead, but half the branch survives:

| SHA | What | Status vs main | Pick? |
|---|---|---|---|
| `a6a2e1d` fix(privacy): value-aware redaction | **SUPERSEDED.** Main's `src/feedback/redaction.ts` (368 lines, `d4b16e1` 2026-08-24, after this branch's 2026-08-23) covers a strict superset: PEM blocks, `Bearer`, `sk-`, `github_pat_`, `gh[pousr]_`, `AKIA`, `xox[abposr]-`, `AIza`, JWT, quoted+unquoted keyed secrets, POSIX home/`.ssh`/UNC/`Users\` paths, email, IPv4, E.164 + CN-mobile phones, Luhn-validated cards — vs the branch's 213-line 8-rule set. Only branch-unique rule is generic drive-letter paths (`[A-Za-z]:[\\/]…`); main scopes path redaction to user-identifying paths deliberately. | No (conflicts: 5 files) |
| `5f49bdc` + `38e20c2` adapt eval honesty | **UNIQUE.** Main's `src/adaptation/eval-routing.ts` and `src/cli/adapt.ts` are untouched since `09f325c` and have no `qualityEvidence`/`actionDiff` fields; the branch makes `adapt eval` declare "no quality evidence, utilityDelta 0 by construction" and print a per-episode action diff. Directly serves the 内测 honesty goal. | **Yes — CLEAN** |
| `92f00bc` ADR-006 guardrails become assertions | **UNIQUE**, test-only (`test/unit/pi-boundary.test.ts` +38 and friends). | **Yes — CLEAN** |
| `cf29cfb` sidecar `.pi/subagents/runs` ingestion opt-in | **UNIQUE behavior gap on main:** main's `src/learning/auto-loop.ts:145` still defaults to ingesting `<project>/.pi/subagents/runs`; the branch gates it behind `--ingest-pi-runs`/explicit dir and stops attribution stealing. | Port by hand (2 conflicts; auto-loop reworked `1aa4161`) |
| `6301a76` doctor warn tier + `--strict` | **UNIQUE** (main doctor has no warn tier), but main's `doctor.ts` was rebuilt 4× on 2026-08-24 (`5785ee2` et al.). | Port by hand (3 conflicts); Round 3 |

### `cursor/review-followups-d47f` — tip `51c66e5`, 5 ahead / 281 behind

- `df964ae` governance files: **SECURITY.md, CHANGELOG.md, CODEOWNERS, .env.example do not exist on main today.** **CLEAN** pick. A 内测 without SECURITY.md is embarrassing; this is the cheapest respectable fix.
- `808bc0b` CI security probe with waiver register (waives exactly `pii-redaction`/`secret-bodies`, keeps `packaged-secrets` enforced): **CLEAN** pick, and main's `.github/workflows/ci.yml` still runs no probe. **But** the waiver ids must be re-validated against the probe R1-gpt-A/R1-opus-A are re-baselining this round — if redaction is now green, land the CI step with an empty waiver register instead.
- `51c66e5` CLI split of `main.ts` into 11 per-command modules: **SUPERSEDED-in-place.** It splits a 281-commits-old `main.ts`; today's `main.ts` is 2,329 lines of new code (routes frozen character-exact through Loop 4). A split must be redone, not ported.
- `318b5c2`, `8f1a1da` docs renames: stale, skip.

### `cursor/docs-cli-honesty-f31b` — tip `fc6058c`, 1 ahead / 281 behind

`inspect`/`run --children` print `verification=PASSED|FAILED|UNOBSERVED` per TASK_RESULT, `(unverified)` outcome suffix, and an `unverified: N/M` summary; adds pure `src/cli/inspect-format.ts` + 105-line unit test. Main has **no** verification display (`grep 'unverified|verification=' src/cli/main.ts src/run/inspection.ts` → 0 matches; cae9's new inspection code also has 0). Genuine preview-honesty win. Conflicts in `main.ts` + 3 docs → hand-port, **after** cae9 lands (same inspect surface).

### `cursor/review-fixes-f31b` — tip `e761534`, 4 ahead / 281 behind (superset of runtime-fidelity + 1)

Unique commit `e761534`: when the stream consumer `return()`s out of `execute()` early, record the `ModelInvocation` once and abort the agent. Main's rewritten executor has the **abort half** (`if (!drained) kernel.abort()` in `runAttempt`'s `finally`, `src/pi-adapter/pi-executor.ts:615`) but `reportInvocation` is only reached on normal completion (`:777`) — **telemetry is still lost on early consumer exit.** The patch does not apply (executor rewritten; its `streaming.test.ts` was deleted on main) — port the idea: wrap invocation reporting in a `finally` (or record-once guard) around the retry loop. Small, Round 3.

### `cursor/how-to-adapt-guide-f31b` — tip `c31d31f`, 1 ahead / 281 behind

Docs-only operator guide `docs/reports/2026-08-24-how-to-adapt.md`, absent on main. CLEAN by construction, but written against the 08-23 CLI; re-verify command names before landing. Low priority.

### `cursor/algorithm-revalidate-9035` — tip `40544a6`, 29 ahead / 281 behind (tip of the 9035 stack)

The stacked line `routing-cluster-algorithm-hardening-9035 (773d84c)` ⊂ `algorithm-capability-upgrade-9035` = `algorithm-eval-polish-9035 (e06eee6)` ⊂ `algorithm-eval-measure-9035 (acf034d)` ⊂ `algorithm-revalidate-9035`. Genuinely unique algorithm work main never got: main is still `assign-v2`/`flowchart-v1` (`src/routing/feature-version.ts:6-9`), the branch reaches `assign-v5`/`flowchart-v5` — role-first family isolation + vision-capable primary (`eb1a2bf`), constraint-naming refusals (`8a36554`), live analyzeTask filters + provenance-bound failureClass (`e06eee6`), spawn-depth accounting + retry mail handoff (`1243b02`), model-attributed-only bandit updates (`9e46be8`), fail-closed privacy tiering (`ee0308e`). Main's `assign.ts` today has none of it (no role/vision handling, no constraint-naming refusal).

**Not a Round 2 landing.** 25 src files, 6+ of them (`coordinator.ts`, `flowchart-run.ts`, `pi-executor.ts`, `cluster/host.ts`, `cli/main.ts`) rewritten by Loop 4 on main after this branch died — this is a port campaign with its own verification (posteriors keyed on assign-v4 must not be reused), not a cherry-pick. It also brushes ADR-006 surfaces (R1 fail-closed changes), which stay Proposed. Record as the highest-value deferred port; harvest per-commit starting with `eb1a2bf`+`8a36554` when a dedicated round owns `src/routing/`.

## 3. TRACKER-ONLY (1)

### `cursor/sota-persistent-opt-83a1` — PR #9, tip `34a293a` (2026-08-25 15:48 UTC — **still moving**), 464 ahead / 278 behind, CONFLICTING

Do not merge; do not close. The campaign pushed new commits and new r24 slice branches during this audit's fetch. Unique `src/` census vs main (25 changed files at the tip):

- **4 new files:** `src/adaptation/promotion-rules.ts`, `src/experiments/gated-comparison.ts`, `src/pi-adapter/listed-model-common.ts`, `src/pi-adapter/listed-model-lazy.ts`; plus `src/episode/replay.ts`, which main deleted as unused (`3685498`) and the branch kept alive.
- **15 files changed only by the branch** (main untouched since `09f325c`): `src/routing/{r1,r1-shadow-report,posterior,offline-logit,offline-prob-add,lin-alg}.ts`, `src/experiments/{shadow,canary,replay,plan}.ts`, `src/adaptation/registry.ts`, `src/learning/learned-routing.ts`, `src/preferences/loop-eval.ts`, `src/pi-adapter/listed-model.ts`, `src/cli/model-catalog.ts`.
- **6 contested (changed in both):** `src/adaptation/{eval-routing,promotion}.ts`, `src/cli/main.ts`, `src/learning/{auto-loop,from-episode}.ts`, `src/pi-adapter/auth-session.ts`.

All 19 new+exclusive files are shadow/offline adaptive-plane (R1, posteriors, experiments) — exactly the plane ADR-006 keeps Proposed. Nothing in them blocks the 内测. Harvest is a future dedicated port, seeded from the 19 uncontested files.

Also subsumed by this tracker's line (all verified ancestors of `34a293a`, hence zero unique content — SUPERSEDED, counted in §5): the entire earlier slice campaign `r1-*`/`r2-*`/`r3-*` (22 branches: `r1-b…c9b5`, `r1c…a496`, `r1-d…41f0`, `r1e…5cd3`, `r1-f…4ac9`, `r1-g…f48c`, `r1-h…038d`, `r1-i…f177`, `r1j…d508`, `r2a…ccba`, `r2-b…3ef3`, `r2c…6f3a`, `r2-d…1b42`, `r2-e…a47a`, `r2f…c879`, `r2-g…ffb9`, `r2-h…05c5`, `r2-i…7b6c`, `r2-j…a4e3`, `r3-a…41c0`, `r3-b…4959`, `r3c…c9c8`), `sota-r1-a-tracking-1174`, the `three-line-opt-iter1..4` + `three-line-self-opt-audit-e43a` stack (5), and `r7-c-x21-sod-land-83a1`.

## 4. STALE-REPORT (212)

All 212 `cursor/rN-<letter>-*-pass-83a1` branches (r4–r24). Each is a **single commit adding one report file** `docs/reports/sota-opt/round-N/RN-X.md` off the PR #9 line (sampled and verified: `r11-i` `b10307a`, `r15-g` `1257197`, `r23-a` `5ce613d`, `r24-e` `882c1aa`+`9d07640`; every sampled diff touches only its report file). 77 of them (rounds ≤10) are already ancestors of PR #9's tip; 135 (rounds 11–24) dangle as unmerged single-report commits. Zero `src/`. Per the brief: never `git merge` these; they are delete-safe once PR #9's disposition is final.

## 5. SUPERSEDED (40)

- **29 subsumed by PR #9's line** (strict ancestors of `34a293a`; enumerated in §3).
- **4 subsumed by `algorithm-revalidate-9035`** (strict ancestors of `40544a6`): `routing-cluster-algorithm-hardening-9035`, `algorithm-capability-upgrade-9035`, `algorithm-eval-polish-9035`, `algorithm-eval-measure-9035`.
- `cursor/runtime-fidelity-resume-pause-stream-f31b` (3 ahead): main independently landed every claimed behavior later — track pause via `PauseController` (`src/track/loop.ts:30-74`, `81f5b81`), live Pi event streaming (`translatePiEvent` + streamed queue in `pi-executor.ts`, `57ade59`), clustered resume through `ChildCoordinator` (`flowchart-run.ts:140`).
- `cursor/merge-inactive-slices-f31b` (22 ahead) and `cursor/merge-inactive-and-algo-f31b` (37 ahead / 278 behind): stale integrations. Verified composition: slices = merges `3ab1afd` (docs-cli-honesty) + `30f1a2b` (runtime-fidelity) + `1a77762` (review-fixes) + `319a479` (privacy/doctor/adapt) + `ac4398b` (d47f CLI split); and-algo additionally merges the `algorithm-goal-*` stack + `how-to-adapt` (`8085500`, `c2c0571`, `f29add7`). Everything unique in them is dispositioned via their member branches above; merging the integration would drag in the superseded redaction and the stale CLI split.
- `cursor/algorithm-{eval-goal,goal-measure,goal-strategy,goal-polish}-f31b` (24/26/27/30 ahead): f31b algorithm stack on the stale base; its two real routing fixes (`52c7eee` thread task analysis into the execution plane, `71e1eec` constraint-naming refusals) are covered further and later by the 9035 line (`e06eee6`, `8a36554`) — harvest there instead.

## 6. INGESTED (13)

Verified 0 ahead of `origin/main` (or of HEAD where noted): `agent/opt-continuous`, `agent/sota-opt-loop3-7e63`, `agent/sota-opt-next-7e63`, `agent/sota-persistent-opt-7e63`, `cursor/docs-cli-honesty-verification-f31b`, `cursor/pi-adapt-aux-features-e1e3`, `cursor/pi-kernel-reuse-e1e3`, `cursor/routing-algorithm-refactor-3bfb`, `cursor/routing-assign-plan-a55e`, `cursor/routing-iter3-ad76`, `cursor/opt-r18-postmerge-42b1` (merged as PR #10 `80eb0bd`), and — 0 ahead of HEAD on this branch — `cursor/opt-r22-42b1` (PR #11, ingested at merge commit `eeb726e`) and `cursor/loop4-closeout-summary-42b1` (ingested at merge commit `ee7d0bd`).

## 7. Round 2 recommendations (exactly 3, in order)

1. **Merge `cursor/agent-market-eval-opt-cae9` into this branch.** Only current-with-main production branch in the repo; 5 conflicts, 4 of them docs/workspace. Resolve `.agent_workspace/*` ours; reconcile `src/cli/main.ts` usage/dispatch with PR #11's `--max-cost-usd`; re-run README parity test. Parent signs off the one-line `package.json` script addition.
2. **Cherry-pick the clean honesty/governance set onto this branch:** `5f49bdc` + `38e20c2` (adapt eval declares no quality evidence + action diff), `92f00bc` (ADR-006 boundary assertions), `df964ae` (SECURITY.md/CHANGELOG/CODEOWNERS/.env.example), `808bc0b` (CI security-probe step — land with a waiver register matching R1-gpt-A/opus-A's probe re-baseline, empty if the probe is green). All five verified conflict-free against `e88f2ce`.
3. **Hand-port `fc6058c` (verification display) after item 1.** New `src/cli/inspect-format.ts` + `main.ts` wiring + tests; conflicts are in `main.ts` and docs only. This closes the "exit 0 ≠ verified" honesty gap in the preview CLI. (If capacity exists, `e761534`'s invocation-on-early-exit port and `cf29cfb`'s sidecar opt-in are the next two, Round 3 — both require hand-ports into rewritten files.)

Explicitly **not** recommended now: any merge of the 9035/f31b algorithm stacks (281 behind, contested Loop-4 files, port campaigns of their own), PR #9 or any part of its line (active exclusive tracker), and all 212 report slices.
