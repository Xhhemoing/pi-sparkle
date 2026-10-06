# PR #54 independent review package

Date: 2026-10-06. Exact review head:
`ebc8d8fdf3c86d91f69c20ef23b2bdc20dc9ca28`. Draft PR:
[#54](https://github.com/Xhhemoing/pi-sparkle/pull/54).

## Scope under review

- PS-06 read-only status projection:
  `inspect --run <runId> --status-json`, `src/run/projection.ts`, bounded
  telemetry reads, README/data-dictionary contract, and projection tests.
- O03 crash-window receipt reconciliation after a completed
  `git worktree remove --force`: `src/native/apply.ts` and
  `test/integration/native/apply-registration-crash.test.ts`.
- npm 12/11 packaged-listing compatibility in `scripts/security-probe.mjs`.
- Combined-source reconciliation records and status/checklist updates.

## Review questions

### PS-06

1. Does the projection remain read-only and additive-only, with no new domain
   event or mutation path?
2. Are child verification and criteria explicitly child reports rather than
   independent acceptance?
3. Are absent telemetry, empty telemetry, unpriced usage, foreign-run usage,
   and torn tails represented distinctly without inventing zero costs?
4. Are event and telemetry corruption/read-limit failures fail-closed?
5. Do existing `--json`, `--summary-json`, `--follow`, episode inspection, and
   CLI refusal messages remain unchanged?
6. Do README, data dictionary, tests, and implementation agree on the
   frozen-additive contract?

### O03 crash reconciliation

1. Is the source-identity check still performed before any missing-path
   reconciliation?
2. Is reconciliation limited to the exact authorized absent path?
3. Does absence of the exact Git worktree record correctly represent the
   observed successful-removal state, without trusting a foreign path?
4. Does the prunable-record repair remain narrow, rechecked, and fail-closed?
5. Are live replacement, foreign path, non-prunable record, changed candidate,
   ignored/untracked file, locked worktree, and failed Git removal still
   refused without recursive fallback?
6. Is the evidence wording honest: this is receipt reconciliation after a
   completed Git removal, not a claim that the whole pipeline is crash-atomic?

### Probe compatibility

1. Does the npm 12 object shape and npm 11 array shape parser preserve the
   existing fail-closed scanning and waiver accounting?
2. Are secret patterns, scanning scope, and waiver refusals unchanged?

## Verification available to the reviewer

Author verification at the exact head, Windows local:

- `pnpm prerelease` PASS: preview probe 5 PASS; workflow/type/lint/build PASS;
  tests 3272 / 3253 pass / 0 fail / 19 skip; security probe 26 PASS / no
  findings; Pi probe 4 PASS.
- Focused native/apply/registration suite before full gate: 37 tests / 37 pass
  / 0 fail / 0 skip.
- New crash regression before fix: RED on absent candidate path; after fix:
  1 pass / 0 fail / 0 skip.
- Hosted CI for PR head `ebc8d8fd`: all five checks PASS (quality; Ubuntu and
  Windows root regression; Ubuntu and Windows CLI smoke). Runs:
  [quality/smoke](https://github.com/Xhhemoing/pi-sparkle/actions/runs/37459295557),
  [root regression](https://github.com/Xhhemoing/pi-sparkle/actions/runs/37459295570).
- Hosted CI for the documentation-only review-package head `4936d683`: all
  five checks PASS (quality; Ubuntu and Windows root regression; Ubuntu and
  Windows CLI smoke). Runs:
  [quality/smoke](https://github.com/Xhhemoing/pi-sparkle/actions/runs/37460271243),
  [root regression](https://github.com/Xhhemoing/pi-sparkle/actions/runs/37460271251).
- Fresh worktree probe validation at `ebc8d8fd`: clean install, build, then
  security probe 26 PASS / no findings; `security-waiver.test.ts` 3/0/0.
- Review-worktree focused suite at `ebc8d8fd`: 32 tests / 32 pass / 0 fail /
  0 skip. Separately, the O03 disposal suite remained 13 pass / 0 fail after
  a measured Git stale-record probe showed a missing candidate path with a
  `prunable gitdir file points to non-existent location` record is still
  refused, as required.

## Git-state observation

A direct Git probe confirmed the other side of the boundary: deleting the
candidate directory without a Git removal leaves the exact worktree record
with `prunable gitdir file points to non-existent location`. The current
implementation refuses that record, so it does not authorize filesystem
cleanup that Git itself did not perform. This narrower safety behavior is
intentional and should be reviewed together with the crash-window receipt
logic.

## Human conflict-hunk review packet

The previous conflict was in `tasks/report-execution-todo.md` between the PS-06
section and the Native cancellation/O03 section. The reconciliation merge
`062384f0b1ff70538c9ed973eae9f517f4035302` retained both sections. Current
relevant lines are:

```text
## PS-06 status/recovery projection (2026-10-02)
...
- [ ] Independent review: Grok dispatch HTTP 403 produced no verdict. Combined-source gate, candidate lookup, main merge and host/owner/experiment gates remain open.

## Native cancellation — PS-03/O02 bounded continuation (2026-10-02)
...
- [x] O03 non-crash cross-instance disposal is implemented in PR #55 ...
- [x] 2026-10-06 O03 crash-window receipt reconciliation ...
- [ ] O03 independent review ... remains open.
```

A human reviewer should verify that no PS-06 checklist item or Native
cancellation/O03 item was silently dropped or marked complete without evidence.

## Explicit boundaries

- Author verification is not independent acceptance.
- A passing hosted CI is not independent review.
- The reviewer must return a verdict of `PASS`, `REQUEST CHANGES`, or
  `BLOCKED`, with exact findings and commands. No verdict may be inferred.
- Merge, draft-to-ready conversion, and any preview.3 release step require
  owner authorization.
