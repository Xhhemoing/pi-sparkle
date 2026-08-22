---
name: pi-sparkle
description: Use when auditing pi agent operations, detecting skill bloat/performance degradation, analyzing evidence boundary gaps, cross-project knowledge isolation, missing meta-skills, verification discipline execution gaps, reliable-delivery bottlenecks, skill routing observability, negative case capture, agent config drift, and prompt optimization (avoid over/under-fitting via scenario similarity). Trigger for pi self-review, harness health checks, or when user reports pi feels slow or skills are proliferating.
license: MIT
compatibility: Pi coding agent. Diagnostic overlay only; does not register extensions.
---

# Pi Sparkle

Pi agent self-diagnosis, optimization, and harness evolution skill.

This is a **diagnostic overlay** (ADR-006 Proposed), not a control plane. It
does not subscribe to session events, register `/sparkle` as an extension
command, or authorize auto-promotion.

## In Pi

- `/skill:pi-sparkle` — load this skill
- `/sparkle [focus]` — prompt template that forces the same workflow
- Then load **at most 1–2** references below. Keep analysis evidence-based;
  do not invent usage data or persist skill `USED`.

## Core Findings Recorded (from local multi-project survey)

### 1. Skill Proliferation & Performance
- 21 skills in ~/.agents/skills (scenario-skill-router caps at 2 per task)
- No prune/usage-audit mechanism; no bloat detection
- Subagent runs in .pi/subagents/runs/ show agent-not-found failures when project agents drift

### 2. Evidence Boundary Problem
- Better-harness reports: 80%+ dimensions "not observed in this boundary"
- Root: no structured logging of skill activation, routing success/failure, or delivery events (PRs outside agent context)
- Negative cases (should-route-but-did-not) never captured
- Opt-in helper now exists (`scripts/log-skill-route.mjs` → `.pi/logs/skill-routes.jsonl`); `doctor --project` reports enabled/line count; empty until explicitly enabled

### 3. Cross-Project Silos
- AIstudy: 4 agents + 2 skills + 5 prompts + better-harness reports (2 rounds)
- cengfan: custom agents (temp-luna, tokenfree-luna) + cengfan-data-import skill + subagent runs
- better-harness (QoderAI): 4 meta-skills (harness-skill-creator, change-traceability-review, etc.) + detailed AGENTS.md
- Pi core: no .pi/, no self-review harness, skills only at user level

No sharing path for reusable assets (aistudy-git-workflow, cengfan-data-import)

### 4. Missing Meta-Skill
- No harness-friction-analyzer that ingests multi-project reports and proposes global fixes
- scenario-skill-router observability is opt-in JSONL (see evidence-loop.md); still no session listener

### 5. Verification & Delivery Gaps
- AGENTS.md contains failure→cause→fix→recheck + delivery discipline, but no enforcement template or lint
- reliable-delivery stuck at 45 because PR/acceptance happens in GitHub, not agent context
- No 4-step evidence chain in completion reports

### 6. Prompt Optimization Risks
- No dynamic section add/remove based on scenario similarity
- Overfit risk: project-specific agents (worker.md tool lists vary)
- Underfit risk: generic prompts ignore package-level AGENTS.md
- No versioning/A-B for prompt variants

## Health Check 2026-08-21 (evidence-based; refreshed after install verification)

- 80 installed skills (all trees); bloat threshold (>20) breached ~4x. Skill
  counts are volatile point-in-time readings — always re-run
  `scripts/skill-audit.mjs` for the live number instead of trusting this line.
- Route logging enabled (marker) in 5 active projects: AIstudy, Deep-student,
  ai-key-manager, pi-sparkle, 蹭饭图. `skill-audit.mjs` now classifies per-project
  logging state and **withholds** `neverActivated`/`topActivated` when no scanned
  project has logging on — absence of logs is not evidence of non-use.
- Helper copied next to installed router (`~/.pi/agent/skills/scenario-skill-router/log-skill-route.mjs`) so projects without this package can still log
- 3 of 4 recorded subagent runs failed (agent `researcher`, exitCode 1, ~360s, no root-cause field captured)
- usage frontmatter deliberately NOT hand-written: JSONL is the single source of truth (router forbids auto-persisting USED); use `scripts/skill-audit.mjs` for top/never-activated reports
- New scripts: `scripts/doctor.mjs` (logging status + line count, corrupt lines fail closed), `scripts/skill-audit.mjs` (cross-project aggregation, prune candidates)
- Verified 2026-08-21 after `pi install E:/Project/pi-sparkle`: package skill
  discoverable globally (outside the project), `/sparkle` template expands via
  `--prompt-template`, end-to-end audit run succeeded.
- Pruned 2026-08-21: `~/.pi/agent/skills/jailbreak-engineering/` (self-declared
  pure routing alias for `llm-security`) moved to
  `~/.pi/agent/skills-backup/2026-08-21/`; installed count 80 → 79, verified by
  script and by live session probe. Audit correction: `malware-triage` is NOT a
  duplicate — the `malware-analysis` name it references was never installed.
  Remaining flagged overlaps need an owner preference call, not evidence-based
  pruning: `reverse-flow` vs `reverse-engineering` (both comprehensive RE
  workflows), `browser` (CDP) vs `browser-automation` (Playwright),
  `understand` vs `graphify`, `scenario-skill-router` vs `using-superpowers`.
- Verified: append, kill switch (PI_SKILL_ROUTE_LOG=0), doctor ok/corrupt paths, audit aggregation

## Routing to References

- references/skill-bloat.md — detection, pruning, usage metrics
- references/evidence-loop.md — closing "not observed" gaps, negative-case logging
- references/cross-project.md — sharing strategy, sync command proposal
- references/meta-skill.md — harness-friction-analyzer spec
- references/prompt-tuning.md — scenario-similarity router, dynamic composition, fit guardrails
- references/agent-config.md — drift detection, tool-allowlist enforcement, subagent error patterns

## Activation Rule
Only load 1-2 references per invocation. After analysis, propose the smallest durable fix (new reference, router update, or meta-skill) rather than one-off patches.
