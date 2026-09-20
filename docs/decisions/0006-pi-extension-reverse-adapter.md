# ADR-006: Pi Extension as Reverse Adapter; Skills Stay Diagnostic

## Status

Accepted (revisited 2026-09-18 by owner approval of native integration; scope below)

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

## 2026-09-18 amendment

The owner approved proceeding with native Pi integration, quality-first delegation with preferred `cursor-grok-4.6-fast`, and automatic modification scope B (project resources plus global Pi configuration, excluding credentials and permissions). The implementation plan is [native Pi](../superpowers/plans/2026-09-18-native-pi.md).

The inbound adapter may now register tools and commands that invoke shared orchestration, tracking and post-run analysis services, in addition to telemetry. Product decisions remain in `src/`; Pi host types remain confined to the two adapter trees. `package.json#pi.extensions` is permitted. The first slice provides read-only delegation with cancellation; it does not implement automatic application. A package install does not grant option B to other users. Candidate application requires separately persisted owner scope, independent checks and rollback; credentials, permissions and trust/tool activation fields remain excluded. This does not supersede F-PROD or enable live R1/bandit selection.

The original proposed text below records the pre-acceptance gate; its "until Accepted" restrictions are now discharged. The historical 2026-08-21 keep-Proposed decision remains in prior records.

## Decision

Split Pi integration into three layers. Do not collapse them.

1. **Runtime / CLI (source of product behavior).** Episode, contract, routing,
   evaluation, adaptation, and promotion stay in `src/`. Live runs still cannot
   mutate active resources (ADR-004).
2. **Outbound adapter (`src/pi-adapter/`).** The CLI executes Pi agents. Only
   this tree imports `@earendil-works/pi-agent-core` / `@earendil-works/pi-ai`
   for execution.
3. **Inbound adapter (`extensions/pi-sparkle/`).** After this ADR was
   Accepted, the thin Pi extension became permitted to import
   `@earendil-works/pi-coding-agent` **only in that directory**. It translates
   Pi session/turn/tool events into pi-sparkle-owned telemetry records and
   invokes shared services through tools/commands under the amendment above.
   It does not compute BKT, risk, routing, or promotion. The current extension
   provides bounded read-only delegation; isolated write is a separate library
   slice and automatic application is not registered here.

**Skills remain an optional diagnostic overlay.** `.agents/skills/pi-sparkle`
may explain how to audit harness health. It is not the control plane, not a
session listener, and not a substitute for structured telemetry.

Before this ADR was Accepted (historical pre-amendment posture):

- `PI_EXTENSION_IMPORT_ALLOWED` stayed `false`.
- No source file outside the existing `src/pi-adapter/` boundary could import
  `@earendil-works/pi-coding-agent`.
- `package.json` could not declare `pi.extensions`.

Those restrictions are discharged by the Accepted 2026-09-18 amendment;
current import boundaries and the extension's narrower behavior remain governed
by the decision above.

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

- The current inbound slice owns session/skill-route telemetry and bounded
  read-only delegation behind the extension, plus its kill switch.
- Follow-up slices may extend the extension only through explicit host-facing
  contracts; candidate application still requires independent checks, stale
  target handling, rollback, and owner scope. `@earendil-works/pi-coding-agent`
  remains confined to the inbound extension boundary.
- Users who only install the skill continue to get diagnostic prompts, not
  silent session surveillance.
- Tests must prove that session shutdown does not close an episode and that
  skill “used” cannot be recorded.
