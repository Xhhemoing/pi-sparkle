# F6 backlog draft — 115 specs (UNSEALED, pre-custody)

**Status: incomplete public draft; NOT READY.** These 115 specs use
`holdout/spec-template.json` and the family templates. G3 recorded schema
validation only (115/115), not runner execution or seal verification. Custody
requires complete materials, an exposure ruling, SM95 key verification, price
binding, preregistration and runner readiness. See the
[current handoff](../docs/reports/2026-09-18-delivery-gate-unblock.md).

## Census

| family | primary | reserve | oracle kind |
|---|---|---|---|
| implementation | 30 (`spec_impl_001`–`030`) | 5 | hidden-acceptance-tests |
| testing | 30 (`spec_test_001`–`030`) | 5 | mutant-kill |
| review | 30 (`spec_review_001`–`030`) | 5 | planted-defects |
| research (exploratory) | 10 (`spec_research_001`–`010`) | 0 | rubric |

Matches the pre-registration §3 floor: 100 blocks (30/30/30 claimed + 10
exploratory) + 15 reserves on the committed replacement schedule.

## What the custodian still owes per spec

The `oracle.custodianRef` names it; the plaintext lives off-repo:

- **implementation** (`oracle_impl_NNN`): hidden acceptance tests authored with
  the spec, run against the arm's worktree + repo gates. taskSuccess = hidden
  tests pass AND gates pass.
- **testing** (`oracle_test_NNN`): the arm's tests must pass on base+patch AND
  fail on at least one of the k pre-registered mutants seeded into the target.
- **review** (`oracle_review_NNN`): the planted-defect ground truth for
  `.holdout-diff.patch` with frozen precision/recall thresholds.
- **research** (`oracle_research_NNN`): the expert rubric + named source set.
  Exploratory only; never promoted post hoc.

## Known honest limits of this draft

1. **Review diffs are not yet authored.** `spec_review_*` reference
   `.holdout-diff.patch`, which the custodian produces per spec (a real change
   to the named area with 2–4 planted defects). Until those exist, review
   blocks cannot run. Complete and bind these materials before seal.
2. **Reserve briefs are placeholders** (`reserve_*` objectives name the
   custodian's attached brief). They are structurally valid and sealable, but
   the completed briefs must be bound before seal.
3. **Implementation targets are real CLI gaps as of the seal-candidate commit
   (`7d3bd2b`)** — if main lands any of them before Week 1, that spec is
   voided and a reserve is drawn (pre-registration §10).
4. Prices in `holdout/price-table-v1.json` are ESTIMATE-class (ADR-007 Q3).

## Seal protocol (when green-lit)

1. Custodian completes the 100+15 specs and referenced materials off-repo.
   Experiment owner records whether exposed drafts are pilot-only or replaced
   with unexposed confirmatory samples. Deleting working files or encrypting
   public history cannot restore blinding.
2. SCM verifies SM95 key custody using metadata only: ownership, mode 0600 and
   separation from tuning hosts. Preserve any existing key; never overwrite it
   as a setup step or copy it into this clone. Provisioning belongs on SM95.
3. Bind the existing ESTIMATE price table digest and model coverage to the
   approved preregistration; close runner readiness and authorization gates.
4. Resolve the custody format discrepancy before seal: ADR-007 names
   `specs.sealed.tar.age`, while `holdout-custody.mjs` implements an AES-256-GCM
   JSON envelope previously documented as `specs.sealed.json`. Owner/custodian
   must record the accepted format and corresponding ADR/tool decision. Renaming
   the JSON envelope does not make it an age archive.
5. On the custodian host, create commitments and approved ciphertext from the
   completed private directory. Transfer only those public artifacts and their
   provenance. Any plaintext disposal needs a preservation/retention decision;
   do not delete the tracked public draft as an automatic seal step.

No seal, key creation, plaintext deletion or Week-1 execution was performed in
this 2026-09-18 documentation update.

## G3 status note (2026-09-13) — evidence only

See `docs/reports/2026-09-13-grok-g3-f6-readiness.md`. Reconfirmed on base
`ba561c33` without seal/custody/live arms:

| Claim in this draft | G3 finding |
|---|---|
| 115 specs present | **Yes** — 115 tracked files under `holdout/backlog-draft/` |
| Pass `holdout-block` / taskSpec validate | **Schema yes** — `validateHoldoutTaskSpec` 115/115; **runner arms NOT RUN** |
| Seal cleanly under `holdout-seal.mjs` | **Not executed** this round; no committed `commitments.json` |
| Custodian oracle / review diffs / reserve briefs | **Still owed** — refs only; 0 patch/oracle payload files in-repo |
| Ready for Week 1 | **NOT READY** — pollution ruling + seal + key + materials required |

Historical exposure: plaintext landed in `dc187a1` on `main`. This note does
not rewrite that history or change ADR-005/007.
