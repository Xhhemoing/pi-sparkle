# Scoped project work items

## Identity

- ID: `TASK-20261015-project-work-items`
- Owner: baseline agent; root owns CLI/controller integration and independent review.
- State: `ready-for-review`; opened 2026-10-15.
- Authority: current user-authorized Stage 2 continuation, repository `AGENTS.md`, task workflow and accepted evidence boundaries.

## Problem and Scope

Add a bounded host-authored queue library for executing one explicitly scoped part of the existing plan. `tasks/plan.md`, accepted ADRs and `docs/status-matrix.md` remain the source of project authority; a queue records its `authorityRef` and never becomes a second global roadmap. Repository/issue text and child success are not authority to accept work.

In scope: strict immutable work definitions, dependency validation, deterministic advisory selection, atomic persisted state, exclusive cooperative claims, token fencing, verified ready/accepted transitions and explicit release/retry. Queue file paths are supplied by the host; no timer, auto-claim, lock stealing, policy promotion, code apply or provider invocation is added.

## Acceptance Criteria

- [ ] IDs/goals/scopes/priorities/recipes and queue state are bounded and reject unknown/malformed fields, unsafe relative scopes, duplicate/unknown dependencies and cycles.
- [ ] Selection is deterministic and read-only; dependencies require accepted evidence, not child success or a status string alone.
- [ ] Concurrent store instances cannot claim the same work item; a replaced claim fences all old token writes. Abandoned claims/lock files never expire or get stolen automatically.
- [ ] Ready/accept require exact work-item/base-revision/recipe/version/command bindings plus a mandatory host callback that resolves actual evidence. Missing/false/throwing/timed-out verification refuses without changing state.
- [ ] Persisted accepted dependencies are reverified before claim. Ready-for-review and accepted stay separate host actions.
- [ ] Source files and tests are disjoint from CLI/native/execution ownership; report exact verification and limitations.

## Implementation Slice

| File | Change | Owner | Risk |
|---|---|---|---|
| `src/development/work-items.ts` | Strict schema, immutable snapshot, graph and advisory selector | baseline | false acceptance / scope ambiguity |
| `src/development/work-item-store.ts` | Bounded file read, atomic writes, lock, token-fenced transitions and host verification | baseline | concurrency, stale evidence |
| `test/unit/development/work-items.test.ts` | Schema and graph/selection regressions | baseline | missing dependency cases |
| `test/integration/development/work-item-store.test.ts` | Actual file/lock races and verification refusal | baseline | environmental false success |

## Test-First Plan

Write assertions before implementations, run focused RED, implement, then run focused suites plus neighboring persistence tests and TypeScript/ESLint. Cases cover child-success-only payloads, wrong version/base/item/command, false resolver, concurrent claims, stale tokens, immutable snapshots, corruption/oversized state and abandoned lock refusal. Root owns the final integrated gate.

## Gates and Handoff

Verification callbacks are host-owned, read-only artifact resolvers; JSON claiming `source: host-command` is insufficient. No cryptographic authenticity or hostile same-user filesystem defense is promised. Queue state lives at a host-selected scoped path, typically under `.agent_workspace/`, and does not close B2/S0-min, native apply, production or Outcome-supported gates.

## Closeout

Report: `docs/reports/2026-10-15-project-work-items.md`. Next owner: root integrates the queue API with host artifact verification and CLI commands; independent reviewer checks final bytes before final gate.

Author verification 2026-10-15: 12 queue tests and 39 queue/persistence tests pass; TypeScript and affected ESLint pass. The initial RED was missing implementation-module loading, recorded explicitly without claiming a pre-existing regression. Independent review and final integrated gate remain separate.

Independent review follow-up 2026-10-15: a persisted accepted descendant could be structurally valid while its prerequisite remained planned. Add a behavioral RED regression covering every claimed status with an unresolved prerequisite, then require accepted prerequisites for all non-planned records before selection or store transitions. This is a schema invariant of reachable host transitions; it does not replace artifact verification.

Follow-up complete: RED 5 pass / 1 fail, then GREEN 40 queue/persistence tests; TypeScript and affected ESLint pass. Research agent independently re-reviewed the corrected source and passed all 13 queue tests, with no remaining scoped blocker. Root still owns the integrated controller gate and prerequisite source-integration policy.

Protected-checker follow-up 2026-10-15: controller review found that an allowed worker write scope could include the recipe's decisive checker itself. Add optional `WorkItemRecipe.protectedPaths`, a copied/frozen list of at most 16 unique literal repository-relative prefixes using the same path rules as write scopes. Preserve absent fields and explicit empty lists for the queue library; the controller owns refusing missing protection for non-inline recipes, write denial, clean-base snapshots and subsequent comparison. Add RED schema round-trip/immutability and malformed-path cases before the parser change. Declaring complete transitive checker dependencies remains a host responsibility.

Protected-checker schema complete: feature RED 6 pass / 1 fail and malformed-list RED 6 pass / 1 fail, followed by 14 queue tests passing, TypeScript and affected ESLint passing. Research agent independently reviewed the additive parser and passed its focused protected-path test with no scoped blocker. Controller enforcement remains a separately verified integration.
