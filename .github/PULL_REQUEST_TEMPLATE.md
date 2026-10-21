## Summary

Describe the concrete problem, resulting behavior, scope/non-goals and relevant acceptance criteria. Link the active task plan; a separate report is not required.

## Verification

Record the current revision and environment. Paste exact commands/results below and link CI runs/artifacts for detailed logs. Distinguish PASS, FAIL, SKIPPED and NOT RUN; do not reuse historical success as current evidence.

| Command / review | Outcome | CI run or artifact |
|---|---|---|
| Focused check | | |
| `pnpm workflow:check` | | |
| Applicable `pnpm gate` / probes | | |
| Independent review when required | | |

Documentation-only changes require workflow and targeted link/content checks. Code changes use the existing development workflow. A remote branch and current green CI are required for delivery; no per-slice report or receipt-only follow-up commit is needed.

## Risks and Follow-up

State compatibility/privacy impact, unresolved conditions, owner and next action. Keep active todo entries limited to unfinished work. Human/experimental approval is separate from tests and source review.

## AI-Assisted / Automated Merge Landings

- [ ] A human read every auto-resolved conflict hunk line-by-line (not applicable if none).
- [ ] Current merged candidate gate output is pasted or linked above.
- [ ] Changed frozen CLI/event/JSON contracts and status claims were reviewed against their pinning tests.
- [ ] No credentials, private transcripts or temporary work artifacts are committed/uploaded.

Conflict-resolution notes and applicable approval links:
