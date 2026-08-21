# ADR-006: Pi Extension as Reverse Adapter; Skills Stay Diagnostic

## Status

Proposed

## Date

2026-08-15

## Context

`pi-sparkle` currently appears inside Pi mainly as a skill:

```json
{
  "pi": {
    "skills": [".agents/skills"]
  }
}
```

That choice was the smallest Pi-package hook that did not violate ADR-001
(`src/pi-adapter/` is the only module allowed to import Pi types) and did not
require `@earendil-works/pi-coding-agent` as a runtime dependency.

A skill is the wrong long-term control surface:

- Skills are prompt text. Pi may or may not load them; loading is not
  evidence that the model followed them; “used” is not an observation.
- Skills cannot subscribe to session, turn, or tool lifecycle events.
- Skills cannot register `/sparkle` commands, intercept tools, or persist
  transport telemetry outside the model’s goodwill.
- Skills cannot enforce a kill switch. An installed markdown file is not
  authorization to mutate policy.

Pi packages already support extensions (`package.json#pi.extensions`). An
extension runs with process privileges, so it is a second adapter, not a
license to spread Pi types through domain code.

ADR-001 still holds for the **outbound** direction: the CLI runtime drives Pi
agents through `src/pi-adapter/`. This ADR adds the **inbound** direction: Pi
sessions may call into pi-sparkle through one thin extension.

## Decision

Split Pi integration into three layers. Do not collapse them.

1. **Runtime / CLI (source of product behavior).** Episode, contract, routing,
   evaluation, adaptation, and promotion stay in `src/`. Live runs still cannot
   mutate active resources (ADR-004).
2. **Outbound adapter (`src/pi-adapter/`).** The CLI executes Pi agents. Only
   this tree imports `@earendil-works/pi-agent-core` / `@earendil-works/pi-ai`
   for execution.
3. **Inbound adapter (`extensions/pi-sparkle/`, not implemented until this
   ADR is Accepted).** A future Pi extension may import
   `@earendil-works/pi-coding-agent` **only in that directory**. It translates
   Pi session/turn/tool events into pi-sparkle-owned telemetry records. It
   does not compute BKT, risk, routing, or promotion.

**Skills remain an optional diagnostic overlay.** `.agents/skills/pi-sparkle`
may explain how to audit harness health. It is not the control plane, not a
session listener, and not a substitute for structured telemetry.

Until this ADR is Accepted:

- `PI_EXTENSION_IMPORT_ALLOWED` stays `false`.
- No source file outside the existing `src/pi-adapter/` boundary may import
  `@earendil-works/pi-coding-agent`.
- `package.json` must not declare `pi.extensions`.

After acceptance, the architecture spec’s “only `src/pi-adapter/` may import
Pi packages” clause is replaced by: **only `src/pi-adapter/` and
`extensions/pi-sparkle/` may import Pi packages.** Domain, learning,
adaptation, and CLI modules still must not.

Session transport is not episode closure. `reload`, `new`, `resume`, `fork`,
`quit`, and shutdown emit session telemetry only. Episodes open and close from
objective, contract, and acceptance policy.

Skill telemetry may record `AVAILABLE` and `EXPLICITLY_ACTIVATED`. It may
record `SELECTED` / `SKIPPED` only when a router decision with an eligible set
was persisted first. It must never persist `USED`.

Installing the package or enabling the extension does not grant auto-promotion,
credential changes, or tool-allowlist edits. A kill switch must disable
telemetry writes without touching live resource pointers.

## Alternatives Considered

### Keep growing SKILL.md files as the product

- Pros: zero new Pi import surface; works with today’s package manifest.
- Cons: unobservable, unenforceable, token-heavy, and cannot close the
  evidence loop the skill itself diagnosed.
- Rejected as the product path. Retained as a diagnostic overlay.

### Import Pi coding-agent from `src/` and skip the extension

- Pros: one adapter.
- Cons: mixes inbound session hooks with outbound execution; spreads coding-agent
  types into the runtime; breaks ADR-001 without a replacement boundary.
- Rejected.

### Implement the extension while this ADR is still Proposed

- Pros: faster demo.
- Cons: the current architecture spec still forbids the import; a half-wired
  extension would look like authorization.
- Rejected. Phase 0 may ship schemas, a kill switch, and a read-only CLI
  without importing Pi coding-agent.

## Consequences

- The next durable slice is session/skill-route telemetry owned by pi-sparkle,
  plus a kill switch, with no coding-agent import.
- A later Accepted follow-up can add `extensions/pi-sparkle/index.ts`, pin
  `@earendil-works/pi-coding-agent` as a peer dependency, and declare
  `pi.extensions`.
- Users who only install the skill continue to get diagnostic prompts, not
  silent session surveillance.
- Tests must prove that session shutdown does not close an episode and that
  skill “used” cannot be recorded.
