# G3 — F6 readiness / pollution inventory (2026-09-13)

## Identity

| Field | Value |
|---|---|
| Seat | Grok bot (report-only) |
| Ticket | PS-G3 / `TASK-20260913-grok-trusted-execution` §G3 |
| Branch | `grok/trusted-execution-g3` |
| Base SHA | `ba561c3304358616c28ef2c319f7e99c16a0a743` (merge of PR #39 / G1B; local tip of `main` ancestry used for this inventory) |
| Worktree | `/workspace/pi-sparkle-g3` (box clone; preferred Windows path `E:\Project\pi-sparkle-g3` when SCM syncs) |
| Scope | Public metadata + runner wiring only. **No** custodian key, **no** oracle plaintext generation, **no** seal, **no** live arms, **no** paid provider. |
| Experiments | **NOT RUN** this round (no `holdout-block` arm execution, no custody seal/open, no 115 loops). |

Contracts read (public): `holdout/README.md`, `holdout/BACKLOG-DRAFT.md`, `holdout/price-table-v1.json`, `scripts/holdout-block.mjs`, `scripts/holdout-custody.mjs`, `src/experiments/{task-spec,freeze,arm-outcome,evidence-retention}.ts`, `docs/specs/f6-preregistration.md`, ADR-005 / ADR-007, PS-P4 verification report, status-matrix F-PROD row.

## Conclusion

**NOT READY** for F6 Week-1 / seal / real-provider collection.

This tip delivers an evidence-backed **readiness decision package** (six-state matrix, exposure facts, blockers with owners/clear conditions, runner wiring gaps). It does **not** close F-PROD, does **not** claim clean-room, and does **not** set a Week-1 start date. Owner/custodian must rule on pollution/validity before any seal.

## 1. Six-state matrix

Distinguish these carefully — “draft exists” ≠ “sealed” ≠ “uncontaminated”.

| State | Status on `ba561c33` | Evidence |
|---|---|---|
| **115 draft exists** | **YES** | `holdout/backlog-draft/` has **115** tracked `*.json` files (30 impl + 30 test + 30 review + 10 research + 15 `spec_reserve_*`). Matches `BACKLOG-DRAFT.md` census. |
| **schema passes** | **YES** (library validate) | Re-ran `validateHoldoutTaskSpec` over all 115 drafts against built `dist/experiments/task-spec.js` → **115/115 pass, 0 fail**. This is schema/shape only — not oracle completeness, not runner smoke, not seal. |
| **oracle + implant + reserve brief complete** | **NO** | Every draft has an `oracle.custodianRef` string, but **no** oracle payloads / planted-defect patches exist under `holdout/` (0 `*.patch` files). `BACKLOG-DRAFT.md` already records: review diffs not authored; reserve briefs are placeholders. Review specs reference `.holdout-diff.patch` (30/30 review) without the custodian artifact present. |
| **current base runnable** | **PARTIAL / NOT EXERCISED** | `scripts/holdout-block.mjs` + `dist/cli/main.js` + price table exist; script **requires** `--now-ms` and defaults `--price-table` to `holdout/price-table-v1.json`. **This round did not execute** any arm (fake or pi). Module presence ≠ paired-block runner exercised on this base. |
| **uncontaminated** | **OWNER DECISION — not declared** | Plaintext taskSpecs are in **public git history** (see §2). Encryption / deleting the working-tree draft **does not** un-expose. Grok will **not** declare clean-room. Owner chooses: pilot-on-exposed-draft vs custodian-authored new unexposed samples. |
| **sealed** | **NO** | No `holdout/commitments.json`. No `holdout/specs.sealed.json` / sealed blob. Pre-registration still has placeholder `Seal commit: <commit sha…>` and unbound `parameterHash`. |

## 2. Exposure inventory (public git history)

| Fact | Detail |
|---|---|
| Introducing commit | `dc187a1b7dd6437b615c86b8ba5afca9fda6960b` — `feat(experiments): F6 backlog draft — 115 specs across four families` (2026-09-08) |
| Reachability | Ancestor of inventory base `ba561c33`; present on `main` / `origin/main` |
| Working tree | Plaintext drafts **still tracked** (`git ls-files holdout/backlog-draft` → 115) |
| Policy tension | `holdout/README.md` says the directory must **never** contain plaintext taskSpecs; `BACKLOG-DRAFT.md` simultaneously keeps the draft and notes history copies are “acceptable (commits are pre-registration public)” |
| Non-remedy | Sealing with `holdout-custody.mjs`, deleting `holdout/backlog-draft/`, or encrypting current copies **does not revoke** historical exposure to anyone who cloned/fetched that commit |

**Owner ask (not answered here):** treat exposed 115 as pilot-only / void for F-PROD confirmatory sample, **or** commission custodian-held **new** samples never published in-repo before seal.

## 3. Blockers — owner + clear conditions

| Blocker | Owner | Clear condition to lift |
|---|---|---|
| **Pollution / validity ruling** | Experiment owner | Written ruling: (a) pilot-only on exposed drafts, and/or (b) new custodian samples required for confirmatory F-PROD. No Week-1 date until ruled. |
| **Review planted-defect diffs** | Custodian (mechanism: ADR-007 Q2 / SM95 key host) | Per `spec_review_*`, author real `.holdout-diff.patch` (2–4 planted defects) held off-repo; arm-blind reveal-on-schedule only. |
| **Reserve briefs** | Custodian | Replace placeholder `spec_reserve_*` objectives/briefs with bound content before those reserves can be drawn. |
| **Hidden oracles** | Custodian | Materialize `oracle_*` payloads named by `custodianRef` (hidden tests / mutants / planted ground truth / rubrics) off-repo; never in router-tuning clones. |
| **Price freeze** | Owner (ADR-007 Q3) | `holdout/price-table-v1.json` already **ESTIMATE**-frozen (`frozenAt: 2026-09-07`). Lift only means: accept ESTIMATE-class cost CIs for Week-1, **or** provision billing reconciliation later (correction path, not retcon). |
| **Key provisioning** | SCM / custodian host (SM95) | `~/f6-custodian/key.txt` = 32-byte hex, mode 0600; key **never** in this repo or agent workspace. |
| **Seal commit + parameterHash** | Owner + SCM after green light | Fill `docs/specs/f6-preregistration.md` seal commit; run `holdout-seal.mjs` → commit **only** `commitments.json`; run `holdout-custody.mjs seal` → commit ciphertext blob; pin adaptive `parameterHash`; remove plaintext draft from tuning trees. |
| **Build provenance** | Implementer (follow-on PR; not G3) | Wire `createExperimentFreeze` / non-empty `buildProvenance.records` into the **runner path** so evaluable samples carry freeze+provenance (library exists; runner does not call it yet — §4). |
| **Raw evidence retention** | Implementer (follow-on PR; not G3) | Ensure holdout armRuns persist under `DEFAULT_HOLDOUT_EVIDENCE_RETENTION = keep-raw` and deletion tooling cannot silently drop raw rows (library + privacy retention wired; **runner does not set/assert** policy on write — §4). |
| **README / operator command hygiene** | Docs owner / SCM | Update dry-run docs to require `--now-ms` + explicit `--price-table` + `--executor fake` for harness smoke; **forbid** copying commands that omit `--now-ms` or default to real `pi` provider. |
| **Independent human custodian (optional upgrade)** | Owner | ADR-007 allows key-separation alone; naming a human upgrades blinding without voiding prior mechanism rulings. |

## 4. `holdout-block.mjs` ↔ P4 wiring (module ≠ exercised)

Trace of **actual** imports/calls in `scripts/holdout-block.mjs` on this base:

| P4 capability | Library module | Runner wiring today | Gap |
|---|---|---|---|
| Spec validate + equivalent R0/R1 compile | `task-spec.ts` (`validateHoldoutTaskSpec`, `compileEquivalentArms`, `modelDescriptorsFromPriceTable`) | **YES** — preflight + R1 flowchart path; `--now-ms` required; price table path defaulted | Unit-tested; **no** live/fake arm run in G3 |
| Evidence class on block record | `arm-outcome.ts` via `scripts/lib/holdout-block-evidence.mjs` → `classifyHoldoutBlockEvidenceClass` | **YES** (coarse block-level class) | |
| Paired analysis / oracle taskSuccess split | `analyzePairedArms` / `classifyArmOutcome` | **Re-exported** from lib wrapper; **not called** by runner when writing the block | Propose follow-on: runner records per-arm `analyzePairedArms` output when oracle label available; add integration test with fixture oracle stub (**do not implement in G3**) |
| Experiment freeze | `freeze.ts` (`createExperimentFreeze`) | **NOT imported / NOT called** | Propose follow-on PR: freeze before arms; persist freeze hash on block; unit+script tests (**not G3**) |
| Evidence retention | `evidence-retention.ts` + `privacy/retention.ts` | **NOT called** from runner | Propose follow-on: attach keep-raw policy to arm state roots; gate cleanup (**not G3**) |
| Observation ledger dedupe | `observation-ledger` (P4) | Outside this script (auto-adapt path) | Holdout arms must keep `SPARKLE_AUTO_ADAPT=0` semantics (ADR-007 Q5); separate verification PR if needed |

Supporting fact: `test/unit/experiments/holdout-block-script.test.ts` only **source-scans** the script for `compileEquivalentArms` / `--now-ms` anti-patterns — it does **not** execute worktrees or arms. PS-P4 report residuals already say compile/oracle/freeze/ledger are library-owned; sealing and live blocks were out of scope.

**G3 action:** document gaps only. Separate tests/PRs later. No implementation in this tip.

## 5. Spec CLI / command hygiene

| Check | Result |
|---|---|
| `holdout-block.mjs` requires `--now-ms` | **Yes** — missing flag → exit 2 with usage |
| Default `--price-table` | `holdout/price-table-v1.json` (ESTIMATE) |
| Default `--executor` | **`pi`** (real provider path) if omitted |
| `holdout/README.md` dry-run command | **Stale** — omits `--now-ms`; would exit 2 on current script. Also insufficient as a “preflight-only” recipe because a successful invocation still provisions worktrees and runs arms |
| Forbidden operator habit | Do **not** copy old README commands that omit `--now-ms` or that run `--executor pi` / default executor against real providers for “dry-run” |

Safe **documentation** shape for a future docs PR (not executed here):

```text
# harness smoke only — still runs fake arms; NOT F-PROD
node scripts/holdout-block.mjs \
  --spec <spec> --base-commit <sha> --out <block.json> \
  --seed 0 --now-ms <frozen> --executor fake \
  --price-table holdout/price-table-v1.json
```

Schema-only validation (what G3 used) is preferred when the goal is “115 drafts parse”, without arm execution.

## 6. What this round did **not** do

- No custodian key read/create; no `holdout-custody` seal/open
- No `holdout-seal.mjs` commitments write committed as a seal
- No real or fake arm loops over the 115 drafts
- No paid provider / xhh live calls for holdout
- No F-PROD / status-matrix closure; no Week-1 date promise
- No ADR edits; no history rewrite of prior reports

## 7. Verification (this tip)

| Check | Result |
|---|---|
| `pnpm workflow:check` | (recorded at commit time below) |
| `git diff --check` | (recorded at commit time below) |
| Link sanity | Report paths resolve to existing holdout/scripts/experiments/ADR/spec files on this tree |
| Experiments | **NOT RUN** |

## 8. Decision package summary for owner

1. **NOT READY** to seal or start Week-1 collection.
2. Six states: draft+schema **yes**; oracle/implant/reserve **no**; runnable **partial/unexercised**; uncontaminated **owner-ruled**; sealed **no**.
3. Historical plaintext exposure is a **fact**; owner must choose pilot vs new samples.
4. Runner gaps (freeze / paired oracle analysis / retention on write) need **separate** PRs after owner direction — not silently assumed from P4 unit tests.
5. Until seal artifacts + custodian materials + pollution ruling exist, F-PROD remains open (status-matrix unchanged by this report).
