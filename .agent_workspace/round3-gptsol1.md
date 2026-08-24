# Round 3 gpt-sol-1
MODEL_SLUG: gpt-5.6-sol-xhigh-fast

## Implemented
- Added direct, network-free unit coverage for all three tools returned by
  `createClusterTools` using a fake `ClusterSessionView`.
- Hardened `sparkle_send` so a supplied unknown role or malformed `agt_...`
  recipient fails validation instead of being silently omitted. This also
  prevents a malformed `to` value from falling through to a valid role target.
- Covered non-empty and empty `sparkle_inbox` output.
- Covered the existing spawn preflight refusal for undeclared Pi agent names,
  plus valid spawn delegation.
- Added `scripts/retention-probe.mjs`. With no argument it creates and cleans
  up a representative temporary state root; `--state-root <dir>` sizes an
  existing root. Successful output is JSON with `ok`, `files`, `bytes`,
  `perRunEstimateBytes`, and `unbounded`.

## Q3 retention decision
Q3 accepts invocation/episode retention as unbounded for this release. The
probe therefore always reports `unbounded: true` on successful measurements
and exits 0; it is diagnostic only and is not a CI gate. Operational probe
errors remain distinguishable as `ok: false` with a nonzero exit.

## Verification
- `pnpm test -- test/unit/pi-adapter/cluster-tools.test.ts`: PASS, 7/7.
- `pnpm test -- test/unit/pi-adapter`: PASS, 49/49.
- `pnpm test`: PASS, 1,322 passed / 1 skipped / 0 failed (1,323 tests).
- `pnpm typecheck`: PASS.
- Focused ESLint on the owned source, test, and script: PASS.
- `node scripts/retention-probe.mjs`: PASS, emitted
  `{"ok":true,"files":33,"bytes":25856,"perRunEstimateBytes":808,"unbounded":true}`.
- Explicit `--state-root .agent_workspace` mode also emitted `ok: true` and
  exited 0.

## Scope
- No network calls were used.
- No live R1 routing was enabled.
- No package metadata or forbidden files were changed.
- Per parent ownership instructions, no git commit was created.
