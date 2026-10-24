---
name: pi-sparkle
description: Diagnose Pi instruction, skill-routing, agent-configuration, or delivery friction when a user requests a Pi self-review or reports repeated work, slow progress, or configuration drift. Use current task evidence to propose a scoped correction; ordinary application work does not require a harness audit.
license: MIT
---

# Pi Sparkle

Use this skill for a directed diagnosis tied to the user's intended result.
Loading this skill or the `/sparkle [focus]` prompt template grants no runtime,
configuration, or deployment permissions.

## Diagnose the current problem

- Reuse the user's goal, constraints, authorization, and acceptance conditions.
  Select a concrete result if the request is broad; ask only when the missing
  choice materially changes scope, cost, or an irreversible outcome.
- Read applicable instructions and the current authoritative state needed for
  that result. In a repository, use its existing active plan and relevant
  accepted decisions when present. An installed package may not include
  `docs/` or `tasks/`; do not require absent repository files or copy another
  project's state into the diagnosis.
- Establish current facts from relevant source, manifests, available command
  help, and task evidence. Keep historical notes separate from current
  behavior. Check the installed command/environment before interpreting a
  missing executable as a product defect. A clone can use `pnpm cli`; a
  built clone can use `node dist/cli/main.js`; use the installed entrypoint
  when available. Do not build or install merely to start an instruction audit.
- Inspect only the evidence needed to distinguish plausible causes. Load at
  most 1–2 relevant references below, and none when the entrypoint suffices.
  Skill counts, prompt length, or missing logs alone do not prove performance
  loss, non-use, or a routing defect. Do not invent usage, costs, route outcomes,
  or persist skill `USED` markers; missing observations remain unknown.
- Separate necessary work from unproductive repetition. Reproduction, a changed
  candidate, a new failure, or an unresolved safety concern can justify another
  check. Repeating the same scan or check without new evidence does not establish
  progress. Prefer correcting when and how existing rules apply before adding
  instructions, templates, skills, routing mechanisms, or enforcement.
- Propose the smallest correction supported by the evidence, including leaving
  the configuration unchanged when the cause is unproven. Do not add hashes,
  frozen contracts, baselines, gates, or learning systems by default. Respect
  existing safety measures and project freezes.

## Scope and stopping

Diagnosis is read-only by default. Apply changes only within explicit user
or existing task authorization; a suggested fix is not execution permission.
Preserve existing edits. Keep evidence in the project's existing task surfaces
and designated private workspace when authorized; do not create routine reports
or collect unrelated projects, private chats, credentials, or provider data.

Real-provider, crash, benchmark, and holdout runs remain opt-in. Do not
self-authorize promotion, adaptation, learning, credential changes, permission
changes, or wider tool allowlists. Preserve synthetic-data and isolated-copy
requirements wherever they apply. Never persist thinking text.

Report concrete findings, evidence, the proposed or authorized change, checks
actually run, and what remains unknown. Distinguish static review, reproduction,
command verification, independent review, delivery, and owner acceptance. A
single self-review or successful task does not prove a performance benefit.
Stop when the requested result has sufficient evidence; do not restart a broad
audit without a new question, candidate, failure, or unresolved concern.

## References when relevant

- [Prompt tuning](references/prompt-tuning.md): repeated or conflicting
  instructions and prompt changes supported by task evidence.
- [Agent configuration](references/agent-config.md): missing declared agents,
  dispatch errors, and role/tool configuration differences.
- [Skill audit](references/skill-bloat.md) and
  [evidence loop](references/evidence-loop.md): historical audit procedures;
  verify current tools and assumptions before using them. Logging and pruning
  remain separately authorized actions, not prerequisites for diagnosis.
- [Cross-project notes](references/cross-project.md) and
  [meta-skill proposal](references/meta-skill.md): historical designs, only for
  an explicitly scoped evaluation; their existence does not authorize new work.
- [Pi version adaptation](references/pi-version-adapt.md) and
  [kernel reuse](references/kernel-reuse.md): historical adaptation material,
  only when the task concerns those interfaces. Verify every version, API,
  architecture, and ADR assumption against current authoritative sources;
  these notes do not describe the current SDK architecture by default.
