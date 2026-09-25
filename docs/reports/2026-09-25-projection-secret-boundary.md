# Projection secret boundary — verification record

## Identity

- Task/commit: projection hardening security follow-up; dirty-worktree candidate on `codex/controlled-improvement-20260925`
- Date and environment: 2026-09-25, Windows, `E:\Project\pi-sparkle`
- Reviewer/owner: author-run verification only; independent acceptance remains open

## Scope and acceptance

- Remove caller authority to assert `secretBearing: false`.
- Derive read sensitivity from original tool parameters/path and returned text before any archive write.
- Refuse missing/malformed paths, `.env*`, credential/auth files, private-key files, secret directories, and text matching the shared secret detector.
- Return a machine-readable recall-budget refusal without including archived content.
- Preserve default-off behavior, existing opaque observation identity, and human-readable refusal text.

Non-goals: no live provider, no pilot, no policy promotion, no persistent telemetry schema, and no change to routing, historical event JSON, or observation-store identity.

## Commands

| Command | Result | Notes/evidence |
|---|---|---|
| `pnpm exec tsx --test test/unit/pi-adapter/observation-tools.test.ts` (RED) | `FAIL` | Module did not yet export `RecallBudgetExceededError`; established the pre-implementation failure. |
| `pnpm exec tsx --test test/unit/pi-adapter/observation-tools.test.ts` | `PASS` | 11 pass / 0 fail, including sensitive path/content no-archive and structured refusal. |
| `pnpm exec tsx --test test/unit/pi-adapter/native-executor.test.ts` | `PASS` | 6 pass / 0 fail; loopback repeats `.env.production` three times and confirms no observation archive. |
| `pnpm exec tsx --test test/unit/native/session.test.ts test/unit/context/observation-projection.test.ts` | `PASS` | 18 pass / 0 fail; existing session projection and low-level eligibility remain green. |
| `pnpm exec eslint src/pi-adapter/observation-tools.ts src/pi-adapter/native-executor.ts test/unit/pi-adapter/observation-tools.test.ts test/unit/pi-adapter/native-executor.test.ts test/unit/native/session.test.ts` | `PASS` | Focused lint. |
| `pnpm typecheck` | `PASS` | TypeScript no-emit check. |
| `pnpm workflow:check` | `PASS` | 10 required files and 16 required headings. |
| `git diff --check` | `PASS` | Existing CRLF conversion warnings only; no whitespace errors. |

## Behavioral Evidence

- Changed behavior: projectability requires verifiable read parameters and an internally clean path/content decision; the native wrapper only forwards the actual parameters.
- Regression covered by: projector unit cases for absent params, `.env.production`, `credentials.json`, `.pem`, and Bearer content; native Pi loopback repeats a credential-like read and checks that no archive directory exists.
- Structured refusal: `RecallBudgetExceededError.code` is `RECALL_BUDGET_EXHAUSTED`; `receipt` carries run/ref/dimension/observed/limit/offset.
- Independent verification source: none. These are current author-run command results, not Stage 0 acceptance.
- Artifact/revision/hash: not assigned; candidate remains in the shared dirty worktree.

## Risks and Gates

- Known limitations: path/content detection is conservative and rule-based; it can refuse benign files. It does not prove the absence of every possible secret format.
- Persistent mechanism/economic telemetry, provider-token accounting, source mutation/delete/resume integration, and two-provider append-only prefix evidence remain incomplete.
- Human approval required: Stage 0 independent review plus owner/evaluator freeze before pilot collection.
- Explicitly not closed: Stage 0, pilot, live-provider verification, production apply, F6, F-PROD, and outcome support.

## Handoff

- Next action: independent specification/quality review, then finish the remaining projection lifecycle and telemetry acceptance items without widening the live boundary.
- Durable record links: [projection hardening plan](../superpowers/plans/2026-09-21-projection-hardening.md), [combined projection/manifest record](2026-09-22-projection-and-readonly-manifest.md).
