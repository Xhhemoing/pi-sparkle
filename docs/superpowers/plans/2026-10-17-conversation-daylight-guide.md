# Conversation workflow and daylight presentation

- ID: `TASK-20261017-conversation-daylight-guide`; owner: Codex.
- State: accepted (documentation verification); source baseline: PR #60 `14a1164`.
- Evidence: [verification record](../../reports/2026-10-17-conversation-daylight-guide.md).
- Request: explain automatic conversational access to CLI capabilities and small-task/long-project continuity in one conversation; switch the presentation to daylight mode.
- Scope: a source-grounded conversational workflow proposal, two explanatory HTML chapters, consistently white/light guide/map/SVG, refreshed downloadable exports.
- Non-goals: implementation of natural-language routing, new durable schemas, runtime migration, or widening existing action authority.
- Contracts: ADR-009 four responsibilities, optional queue/project orchestration, explicit capability binding and separate facts; current migration status remains authoritative.

## Acceptance

1. Explain existing direct task/native/project foundations and label missing conversational routing as a proposed extension.
2. Cover intent resolution, task selection, digressions, resumption, optional task promotion, durable project facts, context selection and effect ownership without requiring a planner/budget form on every turn.
3. Add manually navigable chapters with a concrete long-conversation example; keep no top toolbar and the 48 px footer.
4. Guide and map use explicit white/light backgrounds and pale selections even with a dark system preference; preserve useful contrast, mobile and print/no-JS access.
5. Verify links, chapters/panels, theme, SVG download/export and ZIP; run the pinned docs workflow and whitespace check. Update existing downloadable artifact identities.

## Verification and rollback

Documentation-only policy applies: source review plus focused browser/export checks and `corepack pnpm@10.17.1 workflow:check`. Existing runtime test outcomes are attributed to their own records. Revert only this document/theme delta if it breaks navigation or misstates current support. No independent review is claimed.
