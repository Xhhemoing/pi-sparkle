MODEL_SLUG: gpt-5.6-sol-xhigh-fast

# Round 2 — R2-gpt-B

## Changes

- Restricted the default compatibility probe to source files in
  `src/pi-adapter/`; it no longer reads docs or skills.
- Made thinking-level detection inspect the adapter-owned
  `SparkleThinkingLevel` union, so an empty contract can produce the required
  `BROKEN:` finding instead of being masked by a constant.
- Added an optional adapter reader to `buildPiCompatReport` for deterministic
  failure-path testing. Reader failures remain non-throwing report findings.
- Kept all existing exports and ADR-001: `src/pi-compat` does not import any
  `@earendil-works/*` module. Package identifiers remain data, which is allowed
  by the specifier-based boundary test.
- Added coverage for documentation isolation, empty thinking levels, and a
  failing/missing adapter reader.

## Verification

- `pnpm exec tsx --test test/unit/pi-compat/check.test.ts` — 14 passed.
- `pnpm exec tsc --noEmit --pretty false` — passed.
- Focused ESLint for owned source/tests — passed.
- `pnpm exec tsx --test test/unit/pi-boundary.test.ts` — 3 passed.
- Default adapter probe smoke test — passed with all seven thinking levels and
  no `BROKEN:` findings.
- `pnpm exec tsx --test test/unit/cli/pi-compat.test.ts` — 5 passed.
- Concurrently added `test/unit/pi-compat/skill-discovery-0843.test.ts` — 2
  passed (not modified by this agent).

No commit was created.
