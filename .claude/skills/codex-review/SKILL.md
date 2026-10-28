---
name: codex-review
description: Independent cross-model review of Codex-authored pi-sparkle PRs labeled claude-review, plus a periodic project health review. Use when the owner runs /codex-review, /codex-review <PR>, or /codex-review health.
---

# Codex PR review and health review

Claude is the independent cross-model reviewer for work authored by Codex/GPT sessions. Review only: never commit, push, merge, approve, close, edit branches, or change labels other than `claude-review` → `claude-reviewed`. A review is evidence for the owner, not owner approval, and does not replace the required human review of frozen CLI/event/JSON surfaces or conflict hunks. The repository is public: never put Soul content, transcripts, credentials or private record text into a comment.

The Codex side of this handshake is `.codex/coordinator.md` section 5.

## Modes

- No argument: review every open PR labeled `claude-review`, oldest first (`gh pr list --label claude-review --json number,headRefOid,title,updatedAt`).
- `<PR number>`: review that PR even if unlabeled.
- `health`: periodic project review (below).

## PR review procedure

1. Read `AGENTS.md`, the PR body, and the plan/issue sections it links. Load ADR text only for the boundary the PR touches.
2. Find the newest earlier comment starting with `<!-- claude-review sha=`. If present, review only `git diff <that sha>..<head>` plus anything it affects; otherwise review the full PR.
3. Read without switching the primary checkout: `git fetch origin pull/<n>/head`, `gh pr diff <n>`, `git show <sha>:<path>` for context, `gh pr checks <n>`, and `gh run view <id> --log-failed` for failures.
4. Run code only when a concrete suspicion needs execution. Use a temporary worktree outside the repository (for example `E:/Project/pi-sparkle-review-<n>`), `pnpm install --frozen-lockfile --prefer-offline`, run only the affected `pnpm test -- <files>`, `pnpm typecheck` or targeted eslint, then remove the worktree. Never run `pnpm gate`, `build` or `prerelease`. Report exact commands and exit codes.
5. Check, in order:
   - The stated acceptance is met; each behavior change or bug fix has a test that fails without the fix.
   - Safety invariants: exact candidate bytes, protected paths, accept/apply separation, cumulative budgets, cancellation, settlement, refusal on unknown effects; unknown cost is never treated as zero.
   - Frozen CLI/event/JSON and pinning-test changes are flagged for human review.
   - Windows: paths and case, CRLF, quoting/PowerShell, Node 22.19 versus local Node 24.
   - Privacy: nothing private in the diff, PR body or comments.
   - Scope: only claimed files; no new hash/contract/baseline/gate without the concrete failure AGENTS.md requires.
   - Evidence: commands, results and CI claimed in the PR match what actually ran at this SHA.
6. Report only concrete defects with `file:line`, failure scenario and minimal fix. Out-of-scope improvements are non-blocking.

## Posting

Write the comment to a temporary file, post it with `gh pr comment <n> --body-file <file>`, then delete the file. Format:

```
<!-- claude-review sha=<full head sha> verdict=<BLOCKING|NON-BLOCKING|CLEAN> -->
**Claude review** of `<short sha>` (scope: full | since `<prev short sha>`)

Owner summary (中文): <one sentence: whether it is ready for the owner to merge and why>

**Blocking**
1. `path:line`: defect. Failure scenario. Minimal fix.

**Non-blocking**
- ...

**Not verified**
- What was not run or could not be checked, and why.
```

Then run `gh pr edit <n> --remove-label claude-review --add-label claude-reviewed`. Leave the merge decision to the owner.

## Health mode

Run about every 10 real-task attempts or weekly. Check:

- Workspace: primary checkout branch and dirty paths, `git worktree list`, free space on every drive in use (stop line 2 GiB).
- Queue: open PRs, how long each has waited, CI state, labels, stacked dependencies.
- Outcomes: run the existing `scripts/real-task-summary.mjs` against the canonical private record root recorded in local memory, then group non-correct attempts by recorded root cause. Rank by count × cost.
- Process drift: docs-only PR ratio versus runtime changes, plan/todo size and readability, per-attempt receipt PRs, repeated full gates, new gates added without a concrete failure.

Report to the owner in Chinese: a short state summary, the dominant bottleneck, and two to four decisions with a recommended option. Update local memory with the dated findings. Do not edit `tasks/plan.md`, `tasks/todo.md` or `tasks/issues.md`; the coordinator owns them.
