# Round 3 fable-1

MODEL_SLUG: claude-fable-5-thinking-xhigh

Role: final SOTA acceptance docs. Docs only — no `src/`, no git operations.
Exclusive writes honored: this file, `docs/reports/2026-08-24-sota-r3-acceptance.md`,
`README.md`, `CONTRIBUTING.md`, `docs/status-matrix.md`.

## Implemented

- **README.md**
  - New `adapt promote` command-table row with the full required-flag form
    (`--candidate --expected --content-file --review-file --approve
    [--eval-file]`), stated as the **only** promotion path (CAS honesty;
    matches `src/cli/adapt.ts:240–263` and USAGE `src/cli/main.ts:231`).
  - `delete` row corrected: was bodies-only; now states body **and summary**
    strip, invocation-log filter-rewrite + observed-rate invalidation on
    `delete --run`, episode lock removal, and (after opus-2 landed) the
    residual episode-text run reporting with the delete-the-run recipe.
  - `pnpm test` row documents `pnpm test -- test/unit/<area>` directory form;
    new `pnpm prerelease` row (gate + security probe).
  - Kill-switch honesty updated post-landing: `SPARKLE_AUTO_ADAPT=0` "collects
    and diagnoses only — no bandit update, no proposal" (adapt-auto row and
    §What it does bullet).
  - Documentation section links the R3 acceptance report.
  - Developer-preview framing untouched; nothing marked Outcome-supported.
- **CONTRIBUTING.md**: new §Running Tests (full suite / directory / single
  file, and why the runner expands directories — `scripts/run-tests.mjs`);
  Getting Started uses `pnpm gate`; gate table adds `pnpm prerelease`
  (`package.json:40–42`).
- **docs/status-matrix.md**
  - New rows: Privacy delete cascade (R2 cascade + R3 residual reporting at
    `src/privacy/deletion.ts:243` / `src/cli/main.ts:1392`, preference
    non-goal at `deletion.ts:189`, appender race disclosed), Cost calibration
    (`isCostEligible` gate at `src/routing/cost-calibration.ts:63`,
    exclusion counters), Retention bounds (probe-only,
    `scripts/retention-probe.mjs`, `unbounded: true` not a failure).
  - Refreshed rows: Redaction (R3 persisted `redactionClasses`,
    `src/feedback/types.ts:54`, fail-closed read `store.ts:125–129`,
    three-state semantics), Auto-loop (R3 collect-only kill switch,
    `auto-loop.ts:101–114`, `banditUpdated`), Real Pi executor
    (`auth-session` + `cluster-tools` fake-backed units).
  - P0 policy-gate row: inputs updated with the 2026-08-24 cascade
    extensions; exit marked **still open**. F-PROD row untouched.
- **docs/reports/2026-08-24-sota-r3-acceptance.md**: final acceptance —
  six-property SOTA standard for a developer preview; verdict Accepted under
  standing gates; seven accepted capabilities with file:line; policy-gated
  table (F-PROD, G, P0 sign-off, ADR-006, live R1); §3.0 Round 3 closures +
  ranked P1/P2 leftovers; revocation conditions.

## Honesty (claim → truth)

1. README delete row said "feedback bodies are stripped" → cascade strips
   `body` **and** `summary` (`deletion.ts:52`), rewrites `invocations.jsonl`,
   removes the episode lock, reports residual copies.
2. README table had no `adapt promote` row → promotion looked like an
   auto-capable plane; row now states five required flags and that nothing
   promotes on its own (auto-loop returns `promoted: false` on every branch).
3. Matrix redaction known-limit "per-class decision not stored" → landed this
   round; row now documents the persisted class list **and** its remaining
   limits (`pii` = pass ran; prompt-injection unused; legacy rows unknown).
4. Matrix auto-loop row was silent on the kill-switch bandit write → interim
   note documented the write-before-check, replaced same round with the
   landed collect-only behavior. Both states were only ever documented as
   verified on disk, never ahead of the code.
5. Retention went from admitted-in-a-report to a matrix row with a measuring
   probe; still explicitly not a bounding policy.

## Verification

- Every cited file:line re-read in the final working tree (line numbers
  re-checked after opus-1/opus-2 landings shifted `deletion.ts`,
  `auto-loop.ts`, `types.ts`, `store.ts`).
- `pnpm test -- test/unit/privacy test/unit/feedback test/unit/learning
  test/unit/routing/live-isolation.test.ts`: 143/143 pass.
- `pnpm test -- test/integration/cli/delete.test.ts
  test/integration/cli/commands.test.ts test/unit/pi-adapter`: 77/77 pass.
- `node scripts/retention-probe.mjs`: `{"ok":true,...,"unbounded":true}`.

## Remaining after R3

- **P1**: plain CLI `--children` contract-less (`skipContract: true`,
  `flowchart-run.ts:781`) — derive-or-keep decision; real-provider coverage
  smoke-only; delete-vs-live-appender race (`deletion.ts:476–478`).
- **P2**: retention bounding policy decision; `inspect --json`
  `requiredEvidence`; Node engines floor vs 22.14.0 hosts; regex closure
  walker limits.
- **Policy-gated (not code)**: F-PROD, Outcome-supported, P0 human sign-off,
  ADR-006 Proposed, live R1/bandit/topology.

## Blocked

- Nothing blocked my scope. Note for parent: `src/cli/main.ts` was edited this
  round (one residual-text output line at `:1392`, needed by opus-2's
  deletion result) despite the round-wide "do not edit main.ts" note that was
  scoped to the promote USAGE; the promote USAGE line itself is unchanged and
  the commands integration test passes.
- Parent must re-run the full gate over the combined tree and commit; final
  test count will exceed R2's 1314 (new store/auth-session/cluster-tools
  units).
