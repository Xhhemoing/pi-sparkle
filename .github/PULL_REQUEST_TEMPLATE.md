## Summary
Brief description of the changes.

## Type of Change
- [ ] Bug fix (non-breaking change fixing an issue)
- [ ] New feature (non-breaking change adding functionality)
- [ ] Breaking change (fix or feature causing existing functionality to break)
- [ ] Documentation update
- [ ] Refactor / chore

## Related Issues
Closes #(issue number)

## Quality Gates

Before selecting the checks below, update the task plan and test-first record described in [`docs/development-workflow.md`](../docs/development-workflow.md).
- [ ] `pnpm workflow:check` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes
- [ ] `pnpm build` passes

- [ ] Verification record/state/checklist updated with exact outcomes
- [ ] `pnpm gate` output pasted or linked for merge-ready changes

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex logic
- [ ] Documentation updated if needed
- [ ] No new warnings introduced

## AI-Assisted / Automated Merge Landings (skip if fully hand-written)
- [ ] A human read every auto-resolved conflict hunk line-by-line (no blind
      "take branch code" resolutions)
- [ ] `pnpm gate` output for the merged HEAD is pasted or linked below
- [ ] Frozen contracts touched (event types, `--summary-json`/`doctor --json`
      shapes, CLI error strings, status-matrix claims) were diffed against
      their pinning tests
- [ ] Working artifacts (triage CSVs, scan dumps, loop logs) were kept out of
      the commit or archived under `.agent_workspace/`

Gate evidence / conflict-resolution notes:

<!-- paste here -->
