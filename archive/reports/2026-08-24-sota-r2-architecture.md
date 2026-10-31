# SOTA architecture re-audit (Round 2) — 2026-08-24

Scope: verify the Round 1 landed code (branch `agent/sota-persistent-opt-7e63`,
commit `9ceaad8`) against the Round 1 audit
([2026-08-24-sota-architecture-audit.md](2026-08-24-sota-architecture-audit.md))
and identify the remaining architecture gaps for Round 3, with file:line
evidence. Concurrent Round 2 work observed on disk (uncommitted at audit time)
is marked in-flight. Nothing here claims Outcome-supported, closes F-PROD or
the P0 privacy sign-off, or recommends enabling live R1/bandit/topology
(ADR-005; ADR-006 stays Proposed).

## Method

- Re-traced every Round 1 finding and every "遗留缺陷" item from the
  orchestrator log to the current tree, file by file.
- Verified the four Round 1 feature landings (redaction, retry, doctor
  `--json`, `migrate-legacy`) at their call sites, not just their modules.
- Re-ran the CLI-dispatch ↔ README cross-check after this round's README
  command-table expansion.
- Checked the in-flight Round 2 test work (transitive isolation, bandit-store
  units, checkpoint crash windows, evidence invariant) against the gaps it
  claims to close.

## 1. Round 1 findings verified closed at `9ceaad8`

1. **Redaction is a real transform.** Value-removing rules for PEM blocks,
   `Bearer` tokens, vendor keys, JWTs, and keyed assignments
   (`src/feedback/redaction.ts:53–80`), plus email/IPv4/phone/Luhn-card and
   path rules, wired unconditionally at the adaptation-plane write:
   `appendFeedback` applies `redactFeedback` with `redactPII: true` and a
   400-char body cap (`src/feedback/store.ts:32–42`). Exercised by
   `test/unit/feedback/redaction.test.ts`, `test/unit/privacy/redaction.test.ts`,
   `test/integration/m3/redaction.test.ts`.
2. **`doctor --json` contract frozen.** `DoctorJsonReport` pins `preview: true`
   and `liveAdaptive: false` at the type level with an additive-only rule
   (`src/cli/doctor.ts:21–34`).
3. **429/5xx retry with honest attribution.** Retryable statuses and the
   never-retry auth set (`src/pi-adapter/provider-retry.ts:22–25`); policy of
   3 attempts, 8s backoff cap, 30s `Retry-After` cap
   (`provider-retry.ts:71–77`); failed calls persist usage as `undefined` via
   the `usageIsTrustworthy` gate (`src/pi-adapter/pi-executor.ts:364`), so
   error payload zeros can no longer masquerade as usage.
4. **`migrate-legacy` with fixed plane mapping.** Each legacy source is pinned
   to exactly one plane in `LEGACY_SOURCES` (`src/cli/migrate-legacy.ts:35–40`);
   dry-run is the default, `--apply` copies with `COPYFILE_EXCL` and never
   deletes or overwrites (`migrate-legacy.ts:159–174`); a corrupt non-tail
   JSONL line refuses the copy (`migrate-legacy.ts:244–259`).
5. **Plane-boundary prefix gap closed.** `RUNTIME_MODULES` now includes
   `../supervisor/` and `../cli/`
   (`test/unit/privacy/plane-boundary.test.ts:34–43`), and
   `adaptation/eval-routing.ts`'s type-only `ModelRouterConfig` import is an
   explicit justified exception (`plane-boundary.test.ts:64–68`).
6. **`r0.ts` reachability header corrected.** The module comment now states
   the module-graph fact — inside the live closure via `cascade-evidence`'s
   `applyCascade` import, while `routeR0` itself has no live caller
   (`src/routing/r0.ts:62–68`).
7. **Docs `--children` honesty (this round).** README §Parent + children,
   §Flowchart, §Project Status M1/M2.5, and
   `docs/specs/m0-m2-architecture.md` §Milestone names now state that the CLI
   compiles the child spec through `compileChildrenToFlowchart`
   (`src/cli/main.ts:735`) and executes it on the flowchart engine
   (`main.ts:751`, `cluster: true` at `main.ts:757`) with `ChildCoordinator`
   semantics (`src/run/flowchart-run.ts:241`); `startParentRun`
   (`src/run/coordinator.ts:224`) is library/test-only (consumers:
   `test/integration/m1/parent-run.test.ts`, `test/integration/cluster/*`,
   `test/integration/m3/coverage-gate.test.ts`). The README command table now
   covers all sixteen dispatcher commands including `answer`, `pause`,
   `inject`, `episode`, `pref`, `delete`, `commits`, `doctor --json`, and
   `migrate-legacy`.

## 2. Round 2 in-flight closures observed on disk (uncommitted)

- **Transitive live-isolation test.** `test/unit/routing/live-isolation.test.ts`
  now builds the real import closure from four live entry points
  (`live-isolation.test.ts:40–45`) and judges reachability against a pinned
  two-entry allowlist (`:83–95`): `routing/bandit.ts` only as the post-run
  reward writer (writer-not-selector enforced at `:225–249`),
  `routing/topology.ts` only as the parked `planTaskTopology`
  (`:251–265`). This closes Round 1 leftover #1.
- **`bandit-store` direct units + hardened reads.** Malformed `bandit.json`
  now returns `undefined` instead of being trusted
  (`src/learning/bandit-store.ts`); `loadProjectBandit` is directly tested
  (`test/unit/learning/bandit-store.test.ts`) and still has zero `src/`
  consumers — the isolation boundary is unchanged.
- **Checkpoint crash-window tests.** Crash after temp-write/before-rename,
  temp reclamation, and corrupt-committed-fails-closed proven with zero source
  changes (`test/unit/run/checkpoint-store.test.ts`).
- **Evidence invariant.** COMPLETED terminal episode must carry ≥1 evidence
  ref (`test/acceptance/evidence-invariant.test.ts`) — closes the Round 1
  "per-path convention, not a pinned rule" gap at the acceptance level.
- **Test-runner directory globs.** `pnpm test -- <dir>` works via
  `scripts/run-tests.mjs` (`package.json:36`), closing leftover #5.

## 3. Remaining gaps for Round 3 (ranked)

### P0

1. **`costEligibleInvocations` is still unwired.** The helper exists
   (`src/telemetry/usage-aggregate.ts:29–33`) but the calibration loop filters
   only on usage presence: `inv.tokensIn === undefined || inv.tokensOut ===
   undefined` (`src/routing/cost-calibration.ts:37`) and `tokensOut <= 0`
   (`:38`) — no `callOutcome` check anywhere in `calibrateCatalogRates`
   (`:24–47`) or `calibrateCatalogFromState` (`:110–115`). New failed calls
   are protected upstream by `usageIsTrustworthy`
   (`src/pi-adapter/pi-executor.ts:364`), but any usage-bearing record whose
   outcome is non-`ok` or absent (legacy pre-`callOutcome` lines, partial
   streams) still drags per-token rates. Fix is one guard in
   `calibrateCatalogFromState`; decide explicitly whether legacy no-outcome
   records stay excluded (the documented conservative rule in
   `usage-aggregate.ts:13–17` says yes).
2. **Privacy delete-cascade holes (three, same shape: runtime records outlive
   their owner).**
   - `deleteRunRecords` removes only `runtime/runs/<runId>/`
     (`src/privacy/deletion.ts:55–66`); rows in `runtime/invocations.jsonl`
     carry `runId` (`src/telemetry/model-invocation.ts:45`) and survive
     `delete --run` — a deleted run remains reconstructible as (model,
     timing, usage) tuples.
   - `deleteEpisodeRecords` removes `<epId>.jsonl` and `<epId>.events.jsonl`
     (`deletion.ts:81–89`) but not the `<epId>.lock` file created by
     `src/cli/episode.ts:91`.
   - `cascadeFeedbackTombstones` strips `body` only (`deletion.ts:117`);
     `FeedbackRecord.summary` (`src/feedback/types.ts:18`) is free text —
     auto-loop copies `signal.summary` into it verbatim
     (`src/learning/auto-loop.ts:232`) — and survives the cascade.
   After fixing, re-align the claims in `src/privacy/record-classes.ts` and
   the data dictionary.
3. **Redaction decisions are not persisted.** `redactFeedback` computes
   `RedactionDecision.classes` (`src/feedback/redaction.ts:11–16`) and the
   store drops it: the record at rest keeps only `redacted: boolean`
   (`src/feedback/types.ts:15`, write at `src/feedback/store.ts:39–41`). An
   auditor cannot distinguish "a secret was removed" from "the PII pass ran
   and matched nothing" (`redaction.ts:249–252` marks `pii` whenever the pass
   runs). Additive fix: persist the class list (or a sidecar decision log);
   never rewrite existing lines.

### P1

4. **Orphan barrel `src/supervisor/flowchart.ts`.** 47 lines of re-exports
   with zero importers in `src/` and `test/` (unchanged since Round 1).
   Delete, or add the one-line justification the audit asked for.
5. **USAGE still shows bare `adapt promote`.** `src/cli/main.ts:231` lists
   `pi-sparkle adapt promote` while promotion refuses without
   `--candidate --expected --content-file --review-file --approve`
   (`src/cli/adapt.ts:240–263`). One-line USAGE edit.
6. **Plain CLI `--children` starts without a requirement contract.** The
   `startFlowchartRun` input at `src/cli/main.ts:751–767` passes no
   `contract`, so the coverage gate (`src/run/flowchart-run.ts:758–760`) never
   fires on that path and the run records `skipContract: true`
   (`flowchart-run.ts:781`). This is documented (status-matrix Coverage-gate
   row) but is a real asymmetry with `--track`. Round 3 decision: derive a
   minimal contract from the spec's `acceptanceCriteria`, or keep and document
   the asymmetry as intended.
7. **Real-provider coverage of `--children` / `--track` stays smoke-only**
   (`PI_SMOKE=1`). The retry layer (§1.3) reduced the known 429 failure mode;
   there is still no CI-shaped proof of the compiled-children path against a
   real provider. Must not be closed by claiming outcomes — only by adding
   opt-in integration coverage.

### P2

8. **Fake-backed units for `src/pi-adapter/auth-session.ts` and
   `src/pi-adapter/cluster-tools.ts`.** Still reachable only through the
   opt-in smoke path.
9. **Retention is unbounded.** `runtime/invocations.jsonl` and
   `runtime/episodes/` grow forever (weak-areas report §5). Needs an explicit
   retention policy decision (age- or size-based, with delete-cascade
   consistency), not silent trimming.
10. **`inspect --json` does not surface `STALL_DETECTED.requiredEvidence`.**
    No `requiredEvidence` in `src/run/inspection.ts`; the evidence a blocked
    run needs is only in the raw event log. Verify the inspection payload's
    freeze status before adding an additive field.
11. **Node engines floor vs real hosts.** `engines.node >=22.19.0`
    (`package.json:29`) while known hosts run 22.14.0; `doctor` fails closed
    (correct). Decide: lower the floor with a compatibility test, or keep and
    document the requirement.

## 4. Verified-good this round (no action)

- Pi imports confined to `src/pi-adapter/*` (`test/unit/pi-boundary.test.ts`).
- Plane storage split (`src/privacy/state-layout.ts`) and the deletion
  engine's tombstone re-assertion idempotency (`src/privacy/deletion.ts:69–71`).
- Learned live input remains only the promoted routing-policy pointer with
  content-hash verification (`src/learning/learned-routing.ts:114`).
- Checkpoint store atomic-rename semantics survived crash-window tests with
  zero source changes — the design was already right.

## Standing constraints

Unchanged and re-affirmed: nothing in this repo is Outcome-supported;
Checkpoint F-PROD and the P0 privacy sign-off stay open; ADR-006 stays
Proposed; live R1, bandit, and topology stay off the execution path.
