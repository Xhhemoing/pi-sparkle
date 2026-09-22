# ADR-008: Remove SHA-256 mechanisms and runtime checks

- Date: 2026-09-21
- Status: **Accepted — removal and implementation authorized; migration/live-provider/production-apply gates remain separate**
- Supersedes: SHA-256-dependent portions of active plans/specs only after acceptance; historical evidence remains authoritative for the behavior it recorded.
- Related task: [`TASK-20260921-remove-sha256`](../superpowers/plans/2026-09-21-remove-sha256.md)

## Decision request

The repository uses SHA-256 for content identity, deduplication, persisted locators, artifact integrity, worktree fingerprints, independent checks, experiment commitments, and apply/evaluator trust bindings. The accepted decision is to remove all first-party SHA-256 mechanisms and runtime integrity checks, not to rename fields, cosmetically relabel the algorithm, or substitute another cryptographic hash.

This acceptance authorizes Luna to execute the removal and implementation slices. It does **not** authorize migration execution, live-provider runs, production apply, holdout resealing, or production rollout; those gates remain separate and open.

## Accepted removal contract

1. New IDs/locators, where an ID is required, use opaque random versioned locators. This ADR intentionally selects no replacement cryptographic hash.
2. Equality/deduplication that needs byte identity uses direct exact-byte comparison (for example `Buffer.equals`); it provides no cryptographic tamper guarantee.
3. Existing SHA-256 data, seals, handles, and reports remain historical/read-only evidence.
4. Legacy SHA-bound records are never silently rehashed, upgraded, dual-written, or reclassified as new/trusted/applyable/evaluable records.
5. Existing holdout seals are never rewritten in place. A new seal version and separate F6 owner decision are required for future collection.
6. Compatibility readers are quarantine/inventory-only unless a separately approved migration manifest binds every conversion and its evidence.

## Consequences

The migration is dependency-ordered: owner/schema freeze; observation and loop-artifact identity/storage; execution evidence and worktree/apply binding; experiment/migration/ledger identity; active documentation; then removal scans and full gates. Renaming fields or changing an algorithm in place is insufficient because filenames, IDs, validators, persisted rows, wire payloads, tests, privacy paths, and evaluator/apply contracts all bind the old mechanism.

The separate non-cryptographic `hash32` helper is not in this request unless the owner explicitly expands scope. Signing/HMAC and encryption are not assumed removable merely because they use hash-like terminology; each must be separately classified by the approved successor design.

## Owner response / acceptance record

- Decision: `ACCEPTED` — remove all first-party SHA-256 mechanisms and runtime integrity checks; implementation authorized.
- Successor identity/integrity primitive: opaque random versioned locators where IDs are needed; direct exact-byte comparison for equality/dedupe; no cryptographic tamper guarantee.
- Versioned schemas approved: only in later migration groups; this `migrate-legacy` slice does not change persisted wire schemas.
- Legacy handling approved: historical/read-only; never silently reclassify, rehash, or upgrade.
- Holdout/F6 treatment: unchanged separate gate; no reseal or run authorized.
- Effective scope and date: user instruction in this session; implementation begins with the dependency-independent `migrate-legacy` comparison slice.

## Correction of prior record

The prior Proposed status and timeout/incorrect-assumption record incorrectly treated owner approval as pending. That history is retained as corrected history: the owner explicitly instructed removal of all first-party SHA-256, delegated execution to Luna, and selected the contract above. The correction does not convert migration, live-provider, production-apply, holdout, or independent-review gates into approvals.
