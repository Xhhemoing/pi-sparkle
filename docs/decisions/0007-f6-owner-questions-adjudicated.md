# ADR-007: F6 owner questions — adjudicated by delegation (2026-09-07)

Status: Accepted (delegated). The owner declined to answer the five questions in
`docs/reports/2026-09-04-f6-holdout-decision-package.md` §5 individually and
authorized adjudication with a standing veto: any ruling here can be reversed
by the owner naming it; reversal after Week 1 starts voids episodes collected
under the reversed ruling (decision package §2.10).

## Q1 — Do purpose-authored dogfood tasks count as "production" under ADR-005?

**Yes, with a permanent qualifier.** Candidates B (public benchmark) and C
(synthetic) are rejected in the package; Candidate D (organic traffic) is
infeasible at ~5 invocations to date. Ruling "no" makes F-PROD unclosable, so
the ruling that keeps the gate honest AND reachable is:

- Clean-room paired dogfood blocks close F-PROD's **internal validity**:
  the adaptive routing policy's effect measured against frozen R0 on real
  provider executions.
- **External validity is never claimed from dogfood.** Every F-PROD closure
  report carries the standing sentence: "Evidence class: purpose-authored
  tasks on the development repository; organic-traffic generalization remains
  an open stratum (Candidate D) and does not block this closure."

## Q2 — Custodian

**Mechanism substitutes for a named person.** No second human is available, so
blinding is enforced by key separation instead of trust:

1. Plaintext specs + oracles are encrypted (AES-256-GCM, age or openssl) into
   `holdout/specs.sealed.tar.age`; the SHA-256 commitments of the *plaintext*
   files are sealed via `scripts/holdout-seal.mjs` and committed.
2. The ciphertext and commitments live in this repo. The decryption key lives
   ONLY on the deployment host (SM95, `~/f6-custodian/key.txt`, mode 0600) —
   outside the reach of the agent doing router tuning on this repo.
3. Reveal-on-schedule: a block's spec is decrypted at schedule time, executed
   by `scripts/holdout-block.mjs`, and the plaintext wiped with the disposable
   worktree.

A named independent human custodian remains welcome and upgrades this ruling
without voiding anything.

## Q3 — xhh pricing source

**Owner-frozen price table, labeled ESTIMATE, with a reconciliation hook.**
Probed 2026-09-07: the relay (`api.xhh.cloudns.be`) serves `/v1/models` but
`/v1/usage` and `/v1/billing` require credentials not available to this repo,
and the three dogfood models are unpriced in the catalog (recorded as an
honest limit in the 2026-09-04 acceptance report).

- `holdout/price-table-v1.json` freezes per-model input/output prices (marked
  ESTIMATE) before Week 1; all cost CIs are computed on it and reported as
  ESTIMATE-class.
- If provider billing records later become available, they are reconciled per
  invocation ID and the cost gate is re-evaluated on reconciled numbers; a
  reconciliation that flips the cost CI is reported as a correction, not a
  retcon.

## Q4 — R0 definition

**The live CLI default static router, frozen.** R0 = `createModelRouter` with
the default policy version and the catalog as of the seal commit, routing every
task to the configured primary model (no cascade, no learning reads). The
pre-registration pins the policy version string and the catalog commit; any
change to either during collection voids subsequent episodes.

## Q5 — Learning-arm freeze

**Frozen for the collection window.** The adaptive arm runs with
`parameterHash` pinned at seal; `SPARKLE_AUTO_ADAPT=0` semantics apply to
holdout armRuns (observation may collect, nothing learns). The production
learning loop staying live was rejected: it breaks sealing (the arm under test
would be shaped by the holdout itself).

## Consequence

With Q1–Q5 answered, F6 Week-1 prerequisites reduce to: 100+15 spec authoring
against `holdout/family-templates/`, custodian key provisioning on SM95, price
table freeze, and the seal. The pre-registration template
(`docs/specs/f6-preregistration-template.md`) is filled from this ADR.
