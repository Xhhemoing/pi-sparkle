# Agent progress

Parent branch: `cursor/pi-sparkle-sota-opt-0da8`
Campaign: Loop 5 — usability and competitiveness (not Loop 4 honesty-hole hunting)
Started: 2026-08-25

Loop 4 closed Round 20 with 2 ACCEPT landings (`taskCostCeilings`, targeted `steerText`) and recorded Round 21 as a **zero-slot** honesty round. This campaign does **not** re-audit frozen honesty contracts. It adds operator-facing capability so a developer-preview user can find runs, validate specs before spending a run, and scaffold examples — then keeps covering the rest of the tree.

## ROUND 0 (parent bootstrap)

| Field | Value |
|---|---|
| 检查模块 | Repo map, CLI command surface, status matrix, Loop 4 closeout, open PRs |
| 发现问题 | No `list` of runs/episodes (inspect/resume/delete require a known id). No `validate` of children/flowchart JSON without starting a run. No example scaffold. Doctor inventories only PLANNING/RUNNING. PR #12 (open) already carries `--max-cost-usd` / `inspect --follow` — do not duplicate. |
| 解决问题 | Open Loop 5 tracker docs; dispatch Round 1 (5 Fable + 2 GPT-5.6-sol + 3 Opus). |
| 测试结果 | n/a (docs only) |
| Commit | (this file + `docs/agent-decisions.md`) |
| PR | to be opened on `cursor/pi-sparkle-sota-opt-0da8` |
| Merge 状态 | open |
| Blocked | Host Node v22.14.0 < engines `>=22.19.0` (warning only; CI pins 22.x). P0 privacy human sign-off still open. Checkpoint F-PROD still open — live R1/bandit/topology stay off the execution path. |
| 下一轮重点 | Land `list` / `validate` / `init` examples after Fable+GPT challenge; then cover track loop, cost UX, retention diagnostics, completions. |

## ROUND 1 (in flight)

| Agent | Model | Role |
|---|---|---|
| Fable-map | claude-fable-5-thinking-xhigh | Feature map + unused product surfaces |
| Fable-cli | claude-fable-5-thinking-xhigh | CLI operator UX gaps |
| Fable-runtime | claude-fable-5-thinking-xhigh | Run/flowchart/resume user-journey gaps |
| Fable-adapt | claude-fable-5-thinking-xhigh | Adaptation/learning **product** usability (not live R1) |
| Fable-persist | claude-fable-5-thinking-xhigh | Persist/privacy/retention operator gaps |
| GPT-challenge | gpt-5.6-sol-xhigh-fast | Independent challenge of Round 1 feature bets |
| GPT-frozen | gpt-5.6-sol-xhigh-fast | Frozen-contract hazard review for new CLI |
| Opus-list | claude-opus-5-thinking-high-fast | Implement `list` |
| Opus-validate | claude-opus-5-thinking-high-fast | Implement `validate` |
| Opus-init | claude-opus-5-thinking-high-fast | Implement example scaffold `init` |

Deviation from 5/3/2: none. Analysis agents do not implement. Implementation agents own disjoint files (see decisions).
