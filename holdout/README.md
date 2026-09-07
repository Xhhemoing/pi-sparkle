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
