# P0 privacy technical re-verification — 2026-08-26

## Decision

**P0 is technically closed for the Developer Preview.** Q1 plane isolation
and Q2 deletion/cascade behavior were re-verified against the current
implementation. An independent privacy-officer countersign remains welcome,
but is no longer a blocking release condition for this local,
`private: true` preview.

This is a technical control decision. It is not a production privacy
certification and does not make any capability Outcome-supported.

## Q1 — plane isolation

The runtime and adaptation records use separate state-root planes.
`test/unit/privacy/record-classes.test.ts` checks that each concrete durable
path belongs to its declared plane. `plane-boundary.test.ts` and
`adaptation-plane-closure.test.ts` pin both direct and transitive crossings,
including the narrow, justified derived-signal exceptions.

Result: **closed; no technical blocker found.**

## Q2 — deletion and cascade

The CLI exposes both required operator paths:

```bash
pnpm cli delete --run <runId>
pnpm cli delete --episode <episodeId>
```

Run deletion removes and verifies the run subtree, rewrites the shared
invocation log, and invalidates derived observed rates. Episode deletion
removes both episode record shapes, strips bound feedback free text,
tombstones the feedback ids, and reports attached append-only run logs that
still contain episode text. Lock failures and damaged inputs fail closed.

Result: **closed; no technical blocker found.**

## Verification

Executed on 2026-08-26:

```bash
pnpm test -- test/unit/privacy/ test/integration/cli/delete.test.ts
```

Result: **87 passed, 0 failed, 0 skipped**. The runner warned that the
verification host used Node 22.14.0 while the repository declares Node
>=22.19.0; no test was suppressed or failed because of that warning.

The broader preview-tag gate remains:

```bash
pnpm prerelease
# pnpm gate && pnpm security:probe && pnpm pi:probe
```

P0 closure rests on the focused Q1/Q2 evidence above. A failure elsewhere in
the broader gate still blocks a preview tag independently.

## Remaining posture

- Independent privacy review is encouraged and can reopen P0 with a concrete
  blocker.
- `retain` supplies a 90-day default bound for runtime invocations and
  episodes. It is an explicit, dry-run-first operator command rather than a
  background deletion timer.
- Local-only operation does not imply that provider prompts are local when a
  user explicitly opts into a real remote provider.
