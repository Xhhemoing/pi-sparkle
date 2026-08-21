# Evidence Boundary Closure

## Problem
80%+ harness dimensions remain "not observed in this boundary" because:
- No structured logging of skill activation, routing outcome, or delivery events
- PR/acceptance decisions live in GitHub, outside agent context
- Negative cases (should-route-but-did-not) are invisible

## Observed Data
- AIstudy better-harness: 2 rounds, learning-capture 38→44, reliable-delivery stuck at 45
- Subagent runs contain "failed" status with "Unknown agent" errors, no root-cause capture

## Fix Direction
1. Mandate `.pi/logs/` with:
   - skill-routes.jsonl (task hash, activated skills, skipped skills, reason)
   - delivery-events.jsonl (PR created/merged, acceptance verdict, rollback recorded)
2. Negative-case reporter: when router skips a skill that matches >70% of past successful triggers, log warning
3. Completion template in AGENTS.md requires 4-step evidence chain (failure→cause→fix→recheck) with command output

## Skill-route log (shipped, opt-in)

Diagnostic overlay only. This is a router convention plus a helper script, **not**
a Pi extension (ADR-006 still Proposed). It does not persist skill `USED`, edit
frontmatter, or change routing policy.

### Enable / kill switch

Logging is **off** unless explicitly enabled:

- Enable: `PI_SKILL_ROUTE_LOG=1` (or `true` / `yes`), **or** a marker file
  `<project>/.pi/logs/skill-route-log.enabled`
- Kill switch: `PI_SKILL_ROUTE_LOG=0` (or `false` / `no`) wins over the marker

Do not create the marker as a side effect of a normal coding task.

### Record (one JSON object per line)

Path: `<project>/.pi/logs/skill-routes.jsonl` (append-only).

```json
{
  "schemaVersion": 1,
  "ts": "2026-08-20T05:06:34.493Z",
  "source": "scenario-skill-router",
  "taskHash": "a1b2c3d4e5f67890",
  "candidates": ["systematic-debugging", "verification-before-completion"],
  "activated": ["systematic-debugging"],
  "skipped": ["verification-before-completion"],
  "reason": "cap-2",
  "result": "routed"
}
```

- `taskHash` is the first 16 hex chars of SHA-256 over trimmed/collapsed task
  text. Never store the raw task, prompt, or user identifier.
- `result`: `routed` | `none` | `skipped-trivial` | `already-loaded`
- `skipped` is the negative-case slot (table match that was not loaded, including cap-2)
- Forbidden keys: `used`, `USED`, `task`, `prompt`, `user`, `text`

### Helper

From a project that contains this package:

```text
node .agents/skills/pi-sparkle/scripts/log-skill-route.mjs --task "<verbatim user task>" --candidates "a,b" --activated "a" --skipped "b" --reason "cap-2" --result routed
```

Stdout is `{"status":"appended",...}` or `{"status":"disabled"}`. Disabled is
exit 0. `scenario-skill-router` must call this after a routing decision,
including "load none". `pi-sparkle doctor --project <path>` reports whether
the log is enabled and how many lines it has (corrupt mid-file lines fail
closed). `PI_SKILL_ROUTE_LOG=0` still kills logging.

## Validation
- After implementation, re-run harness report; "not observed" count must drop below 30%
- After ~10 enabled sessions, `skill-routes.jsonl` exists and contains no raw task text
