[Model: gpt-5.6-sol-xhigh-fast]
# Loop 4 Round 1 — T9 report

## Doctor hermeticity

- `doctorCommand` accepts an optional `nodeVersion`; its default remains `process.versions.node`, so the real CLI behavior is unchanged.
- The two host-dependent passing tests inject Node `22.19.0`.
- A Node `22.18.9` test pins the exact `FAIL  node` line and exit code 1.
- The doctor JSON report contract is unchanged.

## Adaptation-plane value-import closure

The regex-based walker starts from every TypeScript file in the adaptation, learning, preferences, experiments, and feedback directories. It follows relative static, dynamic, and re-export value edges transitively, excludes explicit `import type` edges, and conservatively treats import-shaped comments as edges.

Exact runtime-boundary allowlist:

1. `learning/from-episode.ts -> run/event-store.ts` — sanctioned derived-signal reader that extracts routed task PASS/FAIL only.
2. `learning/from-episode.ts -> run/episode-bind.ts` — resolves the episode id required by that sanctioned reader.
3. `routing/assign.ts -> supervisor/model-router.ts` — offline routing replay uses the deterministic model router, which remains pinned as free of filesystem record access.

An in-test source table proves a synthetic routing-to-runtime edge is rejected, explicit type imports are excluded, and an import-shaped comment fails closed.

## Verification

On Node 22.14.0:

`pnpm test -- test/unit/cli/doctor.test.ts test/unit/privacy/plane-boundary.test.ts`

Result: 16 passed, 0 failed.
