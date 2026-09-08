# F6 backlog draft — 115 specs (UNSEALED, pre-custody)

**Status: draft.** These specs are authored against `holdout/spec-template.json`
and the family templates, pass the `holdout-block.mjs` spec preflight (115/115),
and seal cleanly under `holdout-seal.mjs`. They are **not yet sealed into
custody** — that happens when the custodian key exists on SM95 and the owner
(or ADR-007's standing delegation) green-lights Week 1.

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
   blocks cannot run — schedule them last.
2. **Reserve briefs are placeholders** (`reserve_*` objectives name the
   custodian's attached brief). They are structurally valid and sealable, but
   their content binds when the custodian writes the briefs.
3. **Implementation targets are real CLI gaps as of the seal-candidate commit
   (`7d3bd2b`)** — if main lands any of them before Week 1, that spec is
   voided and a reserve is drawn (pre-registration §10).
4. Prices in `holdout/price-table-v1.json` are ESTIMATE-class (ADR-007 Q3).

## Seal protocol (when green-lit)

```sh
# on the custodian host (SM95):
mkdir -p ~/f6-custodian && openssl rand -hex 32 > ~/f6-custodian/key.txt && chmod 600 ~/f6-custodian/key.txt

# in this repo:
node scripts/holdout-seal.mjs seal --specs holdout/backlog-draft --out holdout/commitments.json
node scripts/holdout-custody.mjs seal --specs holdout/backlog-draft \
  --out holdout/specs.sealed.json --key-file ~/f6-custodian/key.txt
git add holdout/commitments.json holdout/specs.sealed.json
# then DELETE the plaintext draft from this machine:
rm -rf holdout/backlog-draft
```

After seal, `holdout/backlog-draft/` must not exist in any clone that tunes
the router. The draft's git history copy is acceptable (commits are
pre-registration public), but the working tree must be clean.
