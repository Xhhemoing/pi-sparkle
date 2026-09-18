# PS-P3 closed-loop verification (2026-09-13)

## Scope

Real coding closed loop at the tool-execution boundary on `grok/sol-efficiency` tip continuing from HOTFIX `ed9a6e9`.

```
isolated worktree → read real files → controlled edit → independent tests → save artifact → record acceptance
```

Out of scope: live provider smoke, P4 arms, P5 perf, Soul, hierarchical routing, Action Fusion live wiring.

## Assumptions (smallest coherent loop)

1. **Independent acceptance** is a new API (`evaluateIndependentAcceptance` / `runClosedLoopCheck`), not a flip of tracking's `independentEvidence` flag (still voided in `computePrescore`; child self-report remains non-corroboration).
2. Known failure mode kill: `PASSED` + empty `evidenceIds` self-report alone **cannot** satisfy independent acceptance (fail closed). Existing learning `taskSuccessFromResult(SUCCESS, PASSED)` behavior for bandit/R1 is unchanged — it remains a deterministic *self-report* signal, never labeled independent.
3. Coding tools live under `src/pi-adapter/` (ADR-001 Pi import boundary); worktree/check/acceptance stay Pi-free in `src/execution/`.
3b. Isolation via `git worktree add --detach` under a sandbox directory; caller's main checkout is never the mutable edit target.
4. Loop artifacts live at `runtime/runs/<runId>/loop-artifacts/<sha256>.json` and are removed by `deleteRunRecords` subtree rm; durable class `run-loop-artifact` documents the path.
5. Tool injection: `createWorktreeCodingTools` → pass as `tools` into `createConfiguredPiExecutor` / `PiAgentExecutor` (merged ahead of cluster + report tools). Permissions enforced in tool code (`resolveInsideRoot`).

## Modules

| Module | Role |
| --- | --- |
| `src/execution/paths.ts` | Path containment / escape refusal |
| `src/execution/worktree.ts` | Isolated worktree create/dispose + revision |
| `src/pi-adapter/worktree-coding-tools.ts` | `sparkle_read_file` / `sparkle_write_file` / `sparkle_run_command` (Pi boundary) |
| `src/execution/independent-check.ts` | Declared command check with hashes + revision |
| `src/execution/acceptance.ts` | Fail-closed independent acceptance |
| `src/execution/loop-artifact.ts` | Run-scoped content-addressed artifacts |
| `src/execution/closed-loop.ts` | Session open/close + check→artifact→acceptance |
| `src/pi-adapter/runtime.ts` | `tools?` forwarded into executor |

## Tests

- `test/unit/execution/acceptance.test.ts` — self-report alone rejected; check+artifact accepts; command fail / missing hash / mismatch fail
- `test/unit/execution/paths.test.ts` — escape refusal
- `test/unit/pi-adapter/worktree-coding-tools.test.ts` — tools actually run; escape refused
- `test/integration/execution/closed-loop.test.ts` — edit in worktree → independent check sees it → artifact saved → acceptance; failure path; self-report-only rejected
- Privacy dictionary / propagation pins updated for `run-loop-artifact`

## Gate

```
pnpm gate
exit: 0
tests: 2689 total; pass 2688; fail 0; skipped 1; suites 136; duration_ms ~26398
tip: (this commit on grok/sol-efficiency; HOTFIX ed9a6e9 is ancestor)
tip-before-commit: ed9a6e9c81f5e228e9eb202c5a894083c5845354
```

Typecheck + lint + test + build all green. Freeze tip after the PS-P3 commit (no merge / no push).

## Residuals

- Learning-path `taskSuccessFromResult` still maps empty-evidence PASSED → deterministic PASS (not independent). A future slice may require evidenceIds for that path; not done here to avoid poisoning R1 semantics without a separate ticket.
- No live LLM end-to-end in this slice (fake tools / direct API only).
