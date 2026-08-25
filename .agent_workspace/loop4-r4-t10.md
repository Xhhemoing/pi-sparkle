# Loop 4 · Round 4 · R4-10 — Offline `--executor pi` loopback provider

## Outcome

Implemented the requested test-only loopback path. No `src/**` file was edited
and the Pi adapter required no production change.

- Added `test/helpers/loopback-openai-provider.ts`, a real loopback HTTP server
  implementing the OpenAI chat-completions streaming protocol used by custom
  providers:
  - accepts `POST /v1/chat/completions`;
  - validates the configured model and `stream: true`;
  - returns SSE text, terminal `finish_reason`, provider token usage, and
    `[DONE]`;
  - records requests and protocol errors for assertions.
- Extended `withIsolatedPiEnv` to isolate `PI_API_KEY` as well as model-selection
  variables, preventing an ambient key from affecting the fixture and restoring
  the caller's key after the test.
- Added `loopback-cli-resume.test.ts`, which writes a real `providers.json`
  containing `customProviders[].baseUrl`, then drives the exported CLI:
  1. `run --flowchart --executor pi` executes the first node over HTTP, waits at
     the second node's approval gate, and persists one invocation row.
  2. `resume --selected route:loopback/loopback-1 --executor pi` executes the
     waiting node over HTTP and appends a second row.
  3. The production `loadInvocationsFromStateRoot` calibration reader decodes
     both rows, including provider/model, task identity, successful call
     outcome, and provider-reported input/output usage.

This executes R3-9's previously source-pinned resume joint and R3-1's invocation
decoder through real provider transport, without credentials or external
network access.

## Scope note

The initial thin flowchart execution records the parent flowchart run ID. On
resume, the existing `resumeFlowchartRun` path rebuilds child tasks and executes
the continued node through `ChildCoordinator`, so that invocation records its
generated child run ID. Both rows append to the shared invocation log and are
read by global calibration; the test pins the stable task/provider/usage
contract rather than treating the child run ID as the parent ID.

## Verification

- Owned-file ESLint:
  `pnpm exec eslint test/helpers/loopback-openai-provider.ts test/helpers/pi-env.ts test/integration/pi-adapter/loopback-cli-resume.test.ts`
  — PASS.
- Whole-tree TypeScript:
  `pnpm exec tsc --noEmit` — PASS.
- Timing-sensitive owned integration test, three consecutive runs — 3/3 PASS.
- Pi-adapter integration census:
  `pnpm test -- test/integration/pi-adapter` — 7 tests, 6 pass, 0 fail,
  **1 skipped**.
- The sole skip remains the unchanged real-provider `PI_SMOKE` gate in
  `provider-smoke.test.ts`.

The VM reports Node v22.14.0 against the package's `>=22.19.0` engine and emits
the existing warning; all commands above completed successfully. No commit was
created, as requested.
