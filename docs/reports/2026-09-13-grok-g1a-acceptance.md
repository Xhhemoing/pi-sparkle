# G1A — independent acceptance binding (2026-09-13)

## Identity
- Seat: Sparkle Implementer
- Ticket: PS-G1A
- Worktree: `E:\Project\pi-sparkle-g1a`
- Branch: `grok/trusted-execution-g1a`
- Base: `d18e06c7ae7433bd1379144ee8453e629ee119ec` (main after PR #37 / G0)

## Behavior
- Host-declared `command` + full `argv` must match `IndependentCheckRecord`
- Checks carry `schemaVersion: g1a-v1` and before/after content fingerprints
- `captureWorktreeFingerprint` hashes dirty/untracked candidate paths without `git add`
- Fingerprint drift across the check fails `ok` / acceptance; legacy HEAD-only evidence is not upgraded
- Self-report alone still fails closed

## Files
- `src/execution/worktree-snapshot.ts` (new)
- `src/execution/acceptance.ts`, `independent-check.ts`, `closed-loop.ts`, `index.ts`
- `test/unit/execution/acceptance.test.ts`, `worktree-snapshot.test.ts`
- Integration closed-loop unchanged in intent; now produces g1a-v1 checks

## Focused tests
```
pnpm test -- test/unit/execution/acceptance.test.ts test/unit/execution/worktree-snapshot.test.ts test/integration/execution/closed-loop.test.ts
exit: 0
tests 15 pass 15 fail 0
```

## Gate
(see freeze paste below)
## Freeze gate paste
```
command: pnpm gate
cwd: E:\Project\pi-sparkle-g1a
exit: 0
summary: workflow-check ok; typecheck+lint+test+build; tests 2750 pass 2732 fail 0 skipped 18; git diff --check 0
```
