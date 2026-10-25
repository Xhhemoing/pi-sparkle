---
description: Diagnose a concrete Pi instruction, routing, configuration, or delivery problem using current task evidence.
argument-hint: "[focus: repeated-work | evidence | drift | prompts | pi-bump]"
---

Use the `pi-sparkle` skill for this request. Read the repository's
`.agents/skills/pi-sparkle/SKILL.md` or the available installed package copy.
Follow its scoped diagnosis and authorization boundaries.

Tie the diagnosis to the user's intended result. Read current applicable
instructions and only the relevant authoritative evidence; installed packages
need not contain repository `docs/` or `tasks/`. Load at most 1–2 relevant
references, and none when unnecessary. Verify current version, API, and command
facts rather than carrying historical notes forward.

Distinguish necessary rework from repetition without new evidence. Do not infer
performance or non-use from skill counts or missing telemetry. Keep unknown
usage, cost, and outcomes unknown. Prefer a supported correction to existing
rules over new mechanisms; stop when the requested result has sufficient
evidence, and report the limits of checks actually performed.

Diagnosis is read-only unless changes are already explicitly authorized.
Preserve privacy, existing edits, project freezes, and safety boundaries.
Real-provider, crash, benchmark, and holdout runs remain opt-in. Do not
automatically promote policy, start learning, edit credentials, or widen tool
allowlists. Loading this prompt grants no additional authority.

Focus (optional):

${@:-Pi self-review tied to the current task and intended result}
