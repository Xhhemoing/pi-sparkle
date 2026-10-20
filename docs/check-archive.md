# Archive completed checks in a fresh ledger

A trusted host can enable `completedCheckArchive: true` in `DevelopmentControllerOptions` or `new ActionLedger(directory, options)`. The controller uses the ledger at `dirname(queuePath)/actions`; a different state root alone does not create a fresh ledger.

This opt-in initializes schema 2 under the existing ledger lock. Use a fresh physical directory or reopen an existing schema 2 directory with the same option. Existing schema 1, including an empty schema 1 file, refuses the option and remains unchanged. Default callers retain schema 1 and refuse schema 2. Missing primary files beside publication remnants require host reconciliation.

A new action admitted when the active collection is full moves eligible completed `candidate-check` records into the archive in the same atomic snapshot. Completion itself does not compact. Failed, running, uncertain, prepared and non-check actions stay active. The limits are 1,024 active records, 4,096 archived checks and 8 MiB for the combined snapshot. Full capacity or byte exhaustion refuses new admission without discarding keys.

Archived records retain their IDs, exact inputs, results and history. `get`, `list` and exact-key `prepare` can find them after restart. Changed input refuses; claim, admission and reconciliation cannot replay a completed archived check. There is no deletion, downgrade, automatic migration or separate index.

Actual historical-source tests cover the ledger-mediated algorithm at commit `e6f6a5b`: when schema 2 publishes first, a previously constructed old instance refuses preparation and claim; when schema 1 publishes first, the new mode refuses and preserves its running record. This does not isolate arbitrary old hosts or the earlier controller that ran checks outside the ledger. Windows descendant containment, power-loss qualification and shared live-root migration remain separate.

[Implementation plan](superpowers/plans/2026-10-19-check-archive.md) · [Verification record](reports/2026-10-19-staged-continuation.md).
