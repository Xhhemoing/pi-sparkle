# Additive SDK and lazy read-only contributions

## Identity
- ID: TASK-20261019-sdk-contributions
- Owner: root coordinator and sequential builder/review agents.
- State: in-progress; implementation and independent reviews complete, final integrated gate pending.
- Date: 2026-10-19 (America/Los_Angeles).
- Authority: ADR-009 / architecture-algorithms A9; parent [continuation](2026-10-19-staged-continuation.md).

## Problem and compatibility decision
No generic context/diagnostic contribution host or supported package SDK entry exists. Existing learning/diagnostics is statistical learning logic, not a plugin diagnostic API. Introduce a narrow trusted-host composition API for read-only contributions. Keep native/controller/apply/store and Pi types out of the facade.

Use physical package sdk/host.js and sdk/testing.js ESM forwarders plus matching declarations, included in package.json files, targeting dist/sdk modules. Consumers use pi-sparkle/sdk/host.js and pi-sparkle/sdk/testing.js. Do not add exports: even a wildcard mapping can change extensionless CommonJS resolution; physical additive files preserve the existing package resolver. Do not promise a root package import that was previously unsupported.

## Implementation files
- src/sdk/host.ts: named context/diagnostic types and createContributionHost.
- src/sdk/contribution-host.ts if implementation needs separation: trusted same-process lazy activation, complete staging validation, cancellation and lifecycle.
- src/sdk/testing.ts: existing FakeExecutor/GatedExecutor and execution contract types, no production authority.
- sdk/{host,testing}.{js,d.ts}: small exact forwarders; package.json files includes sdk.
- test/unit/sdk/contribution-host.test.ts: real callbacks, deferred promises, snapshot/refusal behavior.
- test/integration/sdk/packed-consumer.test.ts or standalone opt-in packed verification script under scripts/: actual local tarball consumer compile/run.
- docs/sdk.md: supported entries, explicit trusted-code boundary, examples and compatibility scope.

## Contract and acceptance
Host configuration includes an immutable generation identifier, host capability list and static plugin manifests: ID, explicit enabled flag, API version, required capabilities, declared context/diagnostic IDs and lazy load callback. Do not call load for disabled plugins or incompatible requests. Validate unique declared IDs across core and all plugins before any activation; staged returned definitions must match declared kinds/IDs and publish all-or-none. Context and diagnostic requests contain bounded copied task data (objective, selected file references, revision/generation), no raw stores, credentials, Pi objects, command or apply authority. Results are bounded copied readonly data.

One host instance serves one immutable generation; concurrent first requests share activation. Per-request abort does not cancel another caller's shared activation, but prevents that caller's result publication. Closing retires the instance and cancels its lifetime signal; late results cannot publish. Await/drain in-flight read-only invocations at close; do not claim arbitrary import side effects were undone. A plugin that never settles cannot qualify as drained. No live hot-swap manager or process backend is introduced.

Context failure returns unavailable so caller can use its existing retrieval fallback. Diagnostic failure returns unavailable, never a passed diagnostic. These results are observations, not accepted task completion. Same-process plugins remain trusted Node code; declarations do not sandbox filesystem/network access.

## Test-first sequence
1. RED missing supported entry/host; disabled loader count remains zero; two concurrent requests call one loader; incompatible version/capabilities do not load.
2. RED duplicate declaration or mismatched activation causes no partial publication; a throwing loader cannot leave earlier callbacks usable.
3. RED caller input/output mutation cannot alter another request; per-request cancellation does not poison shared activation; close waits for cooperative settlement and refuses late publication.
4. GREEN implementation and focused unit command; typecheck/lint.
5. Build and pnpm pack --out .agent_workspace/staged-continuation/sdk-package.tgz --json. Extract actual artifact into an external consumer node_modules/pi-sparkle using available local tools. Compile NodeNext TypeScript consumers using only supported entries; run context/diagnostic and scripted executor examples.
6. Verify packaged legacy dist file import, package.json resolution, documented source/extension paths and CLI version remain usable; record exact existing failures separately rather than inventing root compatibility.
7. Independent specification review then quality review; existing pnpm gate and boundary probes at integrated delivery.

## Limits and rollback
No network install/publish or registry update is needed. Runtime dependencies resolve through the installed local dependency environment during the offline consumer test; record that explicitly. No stable promise for all internals or automatic plugin discovery. No hash, baseline, frozen contract or new gate. Rollback removes additive SDK entries and documentation; existing deep paths and persistent data are unchanged. Real upgrade generations, arbitrary plugin side effects and full M5 qualification remain separate.
