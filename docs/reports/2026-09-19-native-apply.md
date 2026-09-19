# Native Pi Candidate Application

## Identity

- Task: `TASK-20260918-native-pi`, candidate-application slice (`TASK-20260919-native-apply`).
- Date/environment: 2026-09-19, Windows, Node 24.18.0, pnpm 10.17.1, Git with host-global `core.autocrlf=true`.
- Scope: implement `NativeApplySession` (apply one retained accepted candidate to its source) and `dispose` (explicit candidate worktree removal), with stale-target refusal, non-fast-forward refusal, in-candidate re-verification, rollback, and pre-abort semantics. Do not register anything in the Pi extension or CLI; do not touch credentials/permissions; no automatic disposal.
- Model availability: the owner-preferred `xhh/cursor-grok-4.6-fast` was probed at session start and returned "preferred model ... is unavailable" (consistent with the 2026-09-18 404 `model_not_found` upstream group/catalog inconsistency recorded in [the native-write review report](2026-09-18-native-write-review.md)). Per the standing no-silent-fallback protocol, no other model was used; the main agent implemented the slice directly with test-first evidence.
- Source state: all pre-existing dirty/ignored user changes preserved. No reset, discard, commit, push, or merge performed.
- Review posture: main-agent implementation review and command verification only. No independent reviewer PASS, live-provider acceptance, benchmark, or holdout result is claimed.

## Acceptance Criteria

1. Applying a retained accepted candidate to a clean, revision-matching source updates the source to the candidate tree; the host verification command passes at the source root afterwards.
2. A source whose revision differs from the candidate's `sourceRevision` is refused with no mutation (stale-target refusal).
3. A candidate whose acceptance is not accepted is refused before any git command runs.
4. If re-verification inside the candidate fails, the source is untouched and the candidate is retained.
5. Mid-apply failure rolls the source back (`reset --hard <previous>`) and reports; the candidate is retained.
6. Disposal is explicit and removes only the managed candidate worktree; foreign or already-disposed paths are refused.
7. Pre-abort performs no work.

## Changed Surface

- `src/native/apply.ts` (new): `NativeApplySession.apply()` — accepted-result validation, source re-preflight (reuse `prepareNativeWrite`), revision equality check, candidate existence/HEAD checks, in-candidate re-verification with the frozen host command via `runIndependentCheck`, candidate content binding (in-candidate `git add -A` → `write-tree` → `commit-tree -p <sourceRevision>` with fixed identity/dates), ancestry check, git-native `merge --ff-only` onto the source, HEAD-equality verification with `reset --hard` rollback, managed-set tracking. `dispose()` — managed-path check, owning-repo resolution via `worktree list --porcelain`, `worktree remove --force` with rm+prune fallback. `shutdown()` never deletes retained candidates.
- `test/unit/native/apply.test.ts` (new): 5 refusal-path tests with real git fixtures.
- `test/integration/native/apply.test.ts` (new): 5 integration tests — successful apply + source-root re-verification + retention, sabotaged-candidate refusal, stale-source refusal, explicit dispose + second-dispose refusal, no-op candidate applies cleanly.
- `docs/superpowers/plans/2026-09-19-native-apply.md`, `tasks/todo.md`, `tasks/plan.md`, `docs/status-matrix.md`: durable scope/status/evidence updates.

The session is a library API only. It is not registered in the Pi extension or default CLI, and it does not add shell/spawn tools, credential access, permission mutation, automatic re-run, or automatic disposal.

## Test-First Evidence

- Unit RED: before `src/native/apply.ts` existed, the focused unit suite failed with `ERR_MODULE_NOT_FOUND` (`.agent_workspace/research/native-apply/red-unit.log`).
- Mid-implementation RED→GREEN cycles (both caught by failing tests, both fixed):
  1. Re-verification checked a nonexistent `check.accepted` field (always falsy → spurious refusal). Fixed to `check.ok`. Log: `int-r3.log`.
  2. The first apply shape (`update-ref` + `checkout --detach`) left the working tree stale and staged on this host; replaced with the git-native `merge --ff-only` shape that moves branch/HEAD and working tree atomically. Logs: `int-r4.log`, plus probe evidence in `.agent_workspace/research/native-apply/`.
- Candidate CRLF note: the write tool writes LF bytes; with host `core.autocrlf=true` a post-apply checkout materializes CRLF. Fixtures set `core.autocrlf=false` for byte-exact assertions; product code is encoding-agnostic (git-managed).
- Final focused command:
  `pnpm exec tsx --test test/integration/native/apply.test.ts test/unit/native/apply.test.ts test/integration/native/write-session.test.ts test/unit/native/write-preflight.test.ts test/unit/native/session.test.ts test/unit/native/extension.test.ts`
  Result: `32 tests / 32 pass / 0 fail / 0 skip` (focused-r3.log). Apply subset alone: 5 integration + 5 unit = 10/10 (focused-r1/r2.log).

## Verification Commands

| Command | Result | Evidence |
|---|---|---|
| `pnpm exec tsx --test` (focused native set, above) | 32 pass / 0 fail / 0 skip | `.agent_workspace/research/native-apply/focused-r3.log` |
| `pnpm typecheck` | PASS | this session shell; exit 0 |
| `pnpm exec eslint src/native/apply.ts test/unit/native/apply.test.ts test/integration/native/apply.test.ts` | PASS, exit 0 | shell |
| `pnpm workflow:check` | PASS, 10 required files / 16 headings | shell |
| `pnpm test -- --test-concurrency=1` | PASS, `2804 tests / 2786 pass / 0 fail / 18 skip` | `.agent_workspace/research/native-apply/full-suite.log` |
| `pnpm build` | PASS | shell |
| `pnpm security:probe` | PASS, 26 passed, 0 open / 0 waived | shell |
| `pnpm pi:probe` | PASS, 4/4 | shell |
| `git diff --check` | exit 0 (pre-existing CRLF normalization notices only) | shell |

As with the write slice, the normal parallel `pnpm gate` test phase is known to hit Windows process/Git-fixture resource contention on this host; the serialized gate-equivalent sequence above is the current reproducible local evidence. No `pnpm gate` pass is claimed.

## Behavioral Evidence

- Apply requires `acceptance.accepted === true` and a 40-hex `sourceRevision` before any git call; the source must re-preflight clean at exactly that revision.
- The frozen host verification command/argv come from the acceptance record (trusted host input snapshotted at write time), never from model text; they are re-validated and re-executed inside the candidate before the source is touched.
- Candidate content is bound exactly: staging happens inside the candidate worktree only; the source index is never written by candidate staging. `commit-tree` uses fixed author/committer identity and dates so the apply commit is deterministic given the same tree and parent.
- `merge --ff-only` refuses non-fast-forward targets natively; the ancestry check rejects earlier with a clear error, and the post-merge HEAD-equality check plus `reset --hard` rollback covers drift between merge and verification.
- Disposal resolves the owning repository from the candidate itself (`worktree list --porcelain`), so removal is issued by the repo that owns the worktree registry; only managed paths can be disposed, and a second dispose of the same path is refused.

## Risks and Open Gates

- Git worktree isolation is not an OS sandbox. Re-verification executes candidate code inside the candidate; host policy must supply the command and environment boundary.
- The HEAD-drift rollback path (`merge` succeeds but HEAD verification fails, then `reset --hard`) is implemented and code-reviewed but not exercised by an induced-failure test on this host; the two tested refusal paths (sabotaged candidate, stale source) cover the refuse-before-mutation cases. An induced mid-apply HEAD-drift test is a candidate follow-up.
- No independent reviewer PASS or real-provider run is claimed. Local deterministic executors and real-git fixtures establish contract behavior, not model quality.
- Registering `NativeApplySession` as a host-facing tool, global non-credential/non-permission configuration (option B allowlists), disposal policy for long-lived retained candidates, and unified quality routing remain program follow-ups requiring policy review and human authorization.
- F-PROD, live routing, holdout, and Outcome-supported claims remain unchanged and open.

## Handoff

- Next program slices per [the native Pi plan](../superpowers/plans/2026-09-18-native-pi.md): host-facing registration decisions, unified quality routing, live observation projection/recall, global non-security Pi settings.
- Do not register the apply session as an unrestricted Pi tool until the command-policy/environment boundary review and human authorization complete.
- Durable plan/checklist/status links: [native-apply plan](../superpowers/plans/2026-09-19-native-apply.md), [active checklist](../../tasks/todo.md), [status matrix](../status-matrix.md).
