# Loop 5 · Round 8 — GPT-d32-recheck

## Verdict: **KEEP**

Fetched and reviewed `origin/cursor/commits-refusal-retarget-0da8` at `763c158`
(source/test landing through `c91af7b`) against
`origin/cursor/pi-sparkle-sota-opt-0da8`. No operator-contract correction is
required.

## Contract review

- The five original D32 surfaces match Fable Rank 2:
  - malformed `--run` refuses at `parse-args`, before state, with the specified
    list remedy and raw `runId`;
  - an explicit `--nodes` CSV selecting no ids refuses at `parse-args` before
    state with the specified message and next action;
  - unknown node ids remain `validation`, preserve the helper message, and
    retarget next to `inspect --run`;
  - unreadable `--file` is `lookup`, names the path and flag, and gives the
    preview-JSON remedy;
  - unavailable repo fallback and a supplied non-work-tree path are distinct
    `preflight` reports with Fable's messages and next actions.
- The GPT-r8 blank-`--repo` rider is correctly landed. Both `--repo ""` and
  `--repo "  "` produce the exact raw-value `parse-args` report after run-id
  validation and before `loadCommitInput` or any state read. Omitting the flag
  still uses checkpoint `project.rootPath`; an unavailable fallback and a
  supplied non-git path retain their separate preflight reports.
- The try/catch for node filtering contains only the synchronous
  `filterDecisionCommitNodeIds(knownIds, nodeIds)` call in each command.
  Proposal generation and file selection remain outside it.
- `src/tools/decision-commit.ts` and `src/cli/main.ts` are byte-identical to
  the base (matching blob hashes on both refs). The `COMMITS_PREVIEW` emitter,
  `partialApplyNote`, and `nodesCsvSelectsExactly` are untouched; the focused
  suite retains the pinned preview and D20 partial-apply behavior.
- The branch changes only `src/cli/commits.ts`,
  `test/integration/cli/commits.test.ts`, and the implementer report.

## Verification

From a detached worktree at `763c158`:

`npx tsx --test test/integration/cli/commits.test.ts`

Result: **32 passed, 0 failed**. This includes exact pins for both blank repo
values, the no-state ordering proof, omitted checkpoint fallback success,
missing-fallback preflight, and non-git-path preflight. The temporary worktree
was clean and removed after the run.
