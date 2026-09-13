# F6 holdout backlog (Week-1 prerequisite)

This directory is the **repo-side** half of the F6 seal (decision package
§2.6/§3.9). It may contain:

- `spec-template.json` — the authoring vocabulary every taskSpec follows
  (TaskId `tsk_` prefix, `AgentRole` vocabulary, live-catalog `allowedModels`,
  custodian-held oracle reference).
- `family-templates/` — one starting point per claimed family
  (implementation / testing / review) plus the exploratory research family,
  each carrying its oracle contract in prose.
- `commitments.json` — **produced by `node scripts/holdout-seal.mjs seal`** at
  seal time; SHA-256 + byte length per spec, nothing else. Safe to commit —
  it is the immutability seal, not the task content.

It must **never** contain plaintext taskSpecs or oracle material. Plaintext
lives with the independent custodian (decision package §5 question 2 — owner
appointment pending), revealed to an isolated arm only when its block is
scheduled.

Backlog shape (pre-registration §3): 100 specs + 15 reserves =
implementation ×30, testing ×30, review ×30, research ×10 (exploratory),
reserves ×15 drawn by the committed random schedule.

Authoring checklist per spec:
1. Copy the family template; fill `<…>` slots; keep `task.id` matching
   `^tsk_[A-Za-z0-9_-]{1,64}$` and `role` inside `src/domain/roles.ts`.
2. Dry-run preflight: `node scripts/holdout-block.mjs --spec <spec>
   --base-commit HEAD --out /dev/null --seed 0 --executor fake` must not exit
   2 on `spec preflight failed`.
3. Author the custodian-held oracle named by `oracle.custodianRef` (hidden
   acceptance tests / mutants / planted-defect ground truth / rubric) and
   hand it over under the reveal-on-schedule protocol.
4. At seal: `node scripts/holdout-seal.mjs seal --specs <custodian-dir> --out
   holdout/commitments.json`, then commit ONLY the commitments file.

## G3 status note (2026-09-13) — evidence only

Inventory tip: `docs/reports/2026-09-13-grok-g3-f6-readiness.md` on
`grok/trusted-execution-g3` (base `ba561c33`).

- **Six states:** 115 draft exists = yes; schema validate 115/115 = yes;
  oracle/implant/reserve briefs complete = no; current base runnable =
  partial / **not exercised** this round; uncontaminated = **owner decision**
  (do not claim clean-room); sealed = no (`commitments.json` / sealed blob
  absent).
- **Command hygiene:** the dry-run line above is **stale** vs current
  `scripts/holdout-block.mjs`, which **requires** `--now-ms` and defaults
  `--executor` to `pi`. Do **not** copy that old command for real providers.
  Schema-only validation or an explicit `--executor fake --now-ms <n>
  --price-table holdout/price-table-v1.json` recipe belongs in a docs follow-up;
  G3 did not run arms.
- **Policy tension:** this README forbids plaintext taskSpecs here, while
  `backlog-draft/` remains tracked and was published in git history
  (`dc187a1`). Encryption/deletion does not un-expose; owner rules pilot vs
  new samples.
