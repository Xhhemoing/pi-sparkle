# Public scene prior for R0 ranking

Research input converted to a concrete routing contract. Executable tests in
`test/unit/routing/public-prior.test.ts` and `src/routing/public-prior.ts` take
precedence over this note. Live runs still never fetch leaderboards.

Accessed 2026-08-19.

## Decision

- **Old router (R0):** hard eligibility, then a **frozen** public scene-strength
  table, then cheapest among models that clear a quality bar.
- **New router (R1):** local `taskSuccess` only, keyed by
  `(taskFamily, role, modelVersion, featureVersion)`. Tracking `score` does not
  write routing outcomes. User acceptance is a separate column.
- Public numbers are **priors**, not live policy. They are imported into a
  versioned snapshot (`snapshotId` + content hash). A run that needs ranking
  reads that file. HTTP during `route()` is forbidden.

## Why not Arena-as-router

Chatbot Arena (now Arena / arena.ai) is pairwise human preference. The **coding
category** is usable as a *weak* prior for review/research. The **overall**
board is rejected: it ranks chat style, not repository work.

RouteLLM (arXiv:2406.18665) trains on Arena-like preference data and still
requires calibrating the threshold on the *actual query mix*. Public Arena
distribution is not this repo’s scout → implement → review → test mix.

SWE-bench **full leaderboard** compares *systems* (Claude Code vs Codex vs
mini-SWE-agent). That mixes harness with model. For a model prior we only
accept **fixed-harness** rows: SWE-bench Verified **bash-only / mini-SWE-agent**,
and Terminal-Bench rows that name one harness (e.g. Terminus 2) and vary the
model.

Martian Code Review Bench ranks **review products**, not models. Do not import
it as a model prior.

Artificial Analysis Coding Index is a composite (Terminal-Bench v2.1 + SciCode
on the model index; DeepSWE + Terminal-Bench + SWE-Atlas-QnA on the agent
index). Use it later for **pricing freeze**, not as the quality table, because
the free API does not expose per-bench components.

## Family → source map

| Local family | Sources (weights in code) | Why this source |
| --- | --- | --- |
| `edit`, `refactor` | Aider polyglot 0.45 · SWE-bench Verified mini 0.40 · Terminal-Bench 2.1 fixed-harness 0.15 | Polyglot is an edit loop with hidden tests (not Python-only). mini-SWE-agent is the same scaffold for every LM. Terminal-Bench covers tool/debug work without swapping harnesses. |
| `test` | Aider 0.50 · SWE-bench Verified mini 0.50 | No clean public “write tests only” board. Inherit implementation skill; do not invent a test Elo. |
| `review` | Aider 0.35 · SWE-bench Verified mini 0.35 · **Arena coding** 0.30 | Review needs “does this patch look right to a human” plus whether the model can hold a real repo in its head. Arena *coding* only, never overall Elo. |
| `plan`, `research` | SWE-bench Verified mini + Arena coding, equal or Arena-heavier for research | Weak coverage. `analyzeTask` already prefers the primary model for planner / high complexity; that override wins. |
| `deploy` | **none** | Production/secrets are a whitelist, not a leaderboard. |
| `unknown` | none | Cheapest eligible. |

## Snapshot sources (how to import, not live)

| sourceId | Snapshot artifact | Unit | Notes |
| --- | --- | --- | --- |
| `aider-polyglot` | Aider `polyglot_leaderboard.yml` (`pass_rate_2`) | pass_rate | https://github.com/Aider-AI/aider/blob/main/aider/website/_data/polyglot_leaderboard.yml |
| `swe-bench-verified-mini` | SWE-bench site `data/leaderboards.json`, **bash-only / mini-SWE-agent** rows on Verified | pass_rate (`resolved` / 100) | https://github.com/SWE-bench/swe-bench.github.io/blob/master/data/leaderboards.json — skip full-agent submissions |
| `terminal-bench-2.1-fixed-harness` | tbench.ai / Harbor leaderboard, one named harness | pass_rate | Reject Claude Code vs Codex as a model comparison |
| `arena-coding` | Dated JSON snapshot of the **code** board only | elo | Community snapshot pattern: dated files, not `GET arena.ai` at route time |

Import cadence: monthly is enough. SWE-bench Live evidence (43% static Verified vs ~19% live, arXiv:2505.23419) is why we **re-import** and bump `snapshotId`, not why we hot-reload during a run.

## Ranking algorithm (implemented)

1. Hard filter already happened (privacy, capability, allow-list, high-risk).
2. If `preferPrimary` (deploy / high-risk / planner / debugger today), skip the prior.
3. For each source, min-max normalize raw scores **among models in this catalog**. Absolute Elo is useless when all frontier models sit in a tight band.
4. Blend sources by family weights. Missing source for a model is skipped, not filled with 0.
5. If the family has no coverage → cheapest eligible (old behavior).
6. If any covered model has blended quality ≥ `qualityBar` (default 0.55) → **cheapest of those**.
7. Else → highest blended quality (do not pick a noisy local LCB).

Public rows never increment R1 `nObsEff`. Optional later: map blended quality to a **weak Beta prior** (`priorAlpha`/`priorBeta`) that `weightedSampleSize` still subtracts, so a leaderboard cannot impersonate five local passes.

## Local three-line columns (new router)

| Column | Source | Live routing |
| --- | --- | --- |
| `taskSuccess` | Evaluation line: deterministic checks, tests, acceptance | Yes, when `nObsEff ≥ 5` for that cell |
| `userAcceptance` | Explicit user preference / reject | Only via a promoted preference or routing-policy candidate |
| process `P` / `score` | Tracking line | Analysis wake-up only |

## Checkpoint F under this design

Baseline arm = this frozen public prior + hard filters.  
Candidate arm = R1 using **train-split local taskSuccess only**.  
Holdout episodes are paired. Simulation evidence ≠ Outcome-supported.

## Out of scope

- Live Arena / Artificial Analysis HTTP in `assignTasks`
- Training a RouteLLM-style classifier
- Using Martian review-tool F1 as a model score
- Wiring R1 onto live assign before Checkpoint F
