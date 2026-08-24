# Round 1 gpt-sol-2
MODEL_SLUG: gpt-5.6-sol-xhigh-fast

## Implemented
- Overrode inherited build settings with `sourceMap: false` and
  `declarationMap: false`; declaration emission remains enabled by the root
  config.
- Expanded the strict security gate with macOS and Windows UNC path samples,
  Bearer-token body survival, and PEM private-key body survival. Existing
  findings and `SECURITY_WAIVER` accounting are unchanged.
- Added domain ID boundary/malformed-input tests across every exported parser.
- Added graph tests for disconnected and root-fed cycles, compiled-child
  cycles, duplicate join dependencies, deterministic join order/concurrency,
  and non-success branch statuses.

## Pack/map hygiene
- `pnpm build`: PASS.
- Clean `dist/` map search: 0 `.map` files.
- Declaration output retained: 207 `.d.ts` files.
- `npm pack --dry-run --json`: 429 packaged files, 0 packaged `.map` files.

## Probe results
- `pnpm security:probe`: BLOCKED, as expected for the Round-1 redaction race.
- 13 strict findings remain: 9 PII/path payloads and 4 secret bodies
  (OpenAI-key suffix, API-key value, Bearer token, and PEM body). The package
  content scan itself passed.
- No waiver was added. Current built redaction still labels PII and strips
  configured prefixes while leaving sensitive payload bodies intact.

## Tests
- `pnpm build`: PASS.
- `pnpm test -- test/unit/domain test/unit/graph`: command-level FAIL because
  the package script forwards `--` and Node attempts unsupported ESM directory
  imports.
- Equivalent expanded scope,
  `pnpm test test/unit/domain/*.test.ts test/unit/graph/*.test.ts`: PASS,
  60/60 tests.
- `pnpm typecheck`: PASS.
- Targeted ESLint for the probe and new tests: PASS.
- All pnpm commands warned that Node 22.14.0 is below the declared
  `>=22.19.0` engine.

## Residual risks
- The release gate remains blocked until payload-removing redaction lands and
  the probe is rerun against a fresh build.
- `tsc` does not remove artifacts from an existing `dist/`; a reused workspace
  containing old map files must clean `dist/` before packaging. This
  verification started with no `dist/`.
- The requested directory-form test command does not run tests with the
  current package script; file globs are required unless test invocation is
  changed elsewhere.

## Blocked / handoff
- Opus-1: rerun build and the strict security probe after the redaction change;
  all 13 payload-survival findings should clear without a waiver.
- Parent: consider a clean-before-pack step and correcting the documented
  focused-test invocation. Both require files outside this slot's ownership.
- No domain/graph source defect was exposed by the added edge tests.
- Concurrent persist changes were present in the shared tree and were not
  modified by this slot.
