# G2 — trusted-execution loopback closed-loop (2026-09-13)

**Marker:** `loopback / no live LLM`

## Identity
- Seat: Sparkle Implementer (Grok executor)
- Ticket: PS-G2
- Branch: `grok/trusted-execution-g2`
- Base: `ba561c3304358616c28ef2c319f7e99c16a0a743` (main after G1B merge / PR #39)

## Scope
Prove real Pi adapter + worktree coding tools + host independent check on a
local HTTP/SSE OpenAI-compatible loopback. No public net, no real keys, no
default CLI wiring, no live provider.

## Behavior delivered
- New `test/integration/execution/pi-closed-loop.test.ts` drives
  `createConfiguredPiExecutor` + `createWorktreeCodingTools({ commandPolicy })`
  through the Pi agent path (not direct tool.execute pretending to be E2E).
- Loopback helper (`test/helpers/loopback-openai-provider.ts`) extended with
  optional `scriptedResponse` tool_calls SSE + HTTP error injection; existing
  text-only callers unchanged.
- Happy path: read broken `src/add.cjs` → write fix → host Node check runs for
  real → loop artifact saved → independent acceptance; source repo content and
  index unchanged.
- Negatives (must not independent PASS; retain diagnostic evidence):
  - provider HTTP 500
  - self-report PASSED but host check fails
  - unauthorized `sparkle_run_command` (default-deny / policy miss → tool error)
  - artifact byte tamper refused by `readLoopArtifact`
  - session cleanup does not wipe sole failure evidence under stateRoot

## Files
- `test/integration/execution/pi-closed-loop.test.ts` (new)
- `test/helpers/loopback-openai-provider.ts` (scripted tool_calls / errors)
- `docs/status-matrix.md` (independent G2 row)
- `docs/reports/2026-09-13-grok-g2-loopback.md` (this file)

**src/:** unchanged — G1B wiring already supported tools injection + closed-loop.

## Focused tests
```
pnpm test -- test/integration/execution/pi-closed-loop.test.ts test/integration/execution/closed-loop.test.ts
```

## Residual / next
- Default CLI closed-loop wiring: not in G2; needs separate owner scope.
- Live provider coding smoke: needs budget/provider/task limits; not claimed here.
- Second save in `runClosedLoopCheck` produces a distinct artifact hash that
  includes acceptance; returned `artifact` ref is the provisional pre-acceptance
  save (pre-existing). G2 evidence asserts check/acceptance objects directly.
