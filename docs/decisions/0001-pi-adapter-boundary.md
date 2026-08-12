# ADR-001: Use Pi Through a Version-Pinned Adapter

## Status

Accepted

## Date

2026-08-12

## Context

`pi-sparkle` needs a capable local agent execution kernel. Pi agent-core provides an `Agent` abstraction, event subscriptions, tool lifecycle hooks, queued steering/follow-up messages, abort handling, configurable tool execution, and optional session backends. Those APIs are useful but are not pi-sparkle's durable project/run model.

Pi package metadata currently declares `@earendil-works/pi-agent-core` and `@earendil-works/pi-coding-agent`. The code is publicly visible through the `earendil-works/pi` repository, while the currently retrieved raw source mirror used the `badlogic/pi-mono` GitHub namespace. Source identity and package version must therefore be made explicit during dependency selection.

## Decision

Use a precisely pinned, reviewed Pi package version behind `src/pi-adapter/`. No other source package may import Pi types directly.

The adapter translates Pi events, errors, aborts, and tool lifecycle signals into pi-sparkle-owned execution events. It exposes a fake-compatible `AgentExecutor` interface for deterministic tests.

M0 uses one configured model. The model router remains a later module and may not leak routing assumptions into the adapter.

## Alternatives Considered

### Fork Pi

- Pros: complete implementation control.
- Cons: creates an ongoing merge/security burden and duplicates an actively evolving execution kernel.
- Rejected: pi-sparkle needs orchestration and audit features above Pi, not a divergent agent kernel.

### Import Pi throughout the codebase

- Pros: fewer initial wrapper lines.
- Cons: Pi API changes would spread through domain, persistence, and supervisor logic; tests would depend on provider-specific constructs.
- Rejected: an adapter preserves a stable internal contract and makes fake execution straightforward.

### Start with a generic OpenAI-compatible loop

- Pros: avoids a Pi dependency.
- Cons: duplicates execution, tool lifecycle, and session behavior already provided by Pi and weakens the product's stated Pi foundation.
- Rejected: it creates work with no M0-M2 differentiation.

## Consequences

- Pi upgrades require adapter compatibility tests before version changes.
- The runtime can test most behavior without provider credentials using a fake executor.
- Pi-specific capabilities not represented by the adapter require an explicit domain-contract decision before adoption.
- Pinning makes supply-chain review and reproduction possible, but requires routine maintenance.
