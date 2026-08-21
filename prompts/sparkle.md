---
description: Audit Pi harness health with the pi-sparkle diagnostic skill.
argument-hint: "[focus: bloat | evidence | drift | prompts]"
---

Use the `pi-sparkle` skill for this request. Read
`.agents/skills/pi-sparkle/SKILL.md` first (or the installed package copy) and
follow it exactly.

Rules:

- Load at most 1–2 references from that skill. Do not ingest every file.
- Stay evidence-based. Do not invent usage counts, route outcomes, or "used"
  skill telemetry.
- Propose the smallest durable fix. Do not add a Pi extension (ADR-006 is
  still Proposed).
- This overlay is diagnostic only. It does not auto-promote routing policy,
  edit credentials, or widen tool allowlists.

Focus (optional):

${@:-pi self-review / harness health check}
