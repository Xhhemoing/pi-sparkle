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

Dispatched 2026-08-25. Cloud new-VM cap is 3, so Round 1 mixed cloud VMs and local Task agents. **No model slug was silently downgraded.**

| Agent | Model | Where | Id |
|---|---|---|---|
| Fable-map | claude-fable-5-thinking-xhigh | cloud VM | `bc-dffa02de-b813-5bda-9bde-2b34ab2301d2` |
| Fable-cli | claude-fable-5-thinking-xhigh | local Task | `bc-9a3dad9c-db2d-52b3-8036-4d8a40c33c2d` |
| Fable-runtime | claude-fable-5-thinking-xhigh | local Task | `bc-d77433cf-d7e9-517e-988c-44015159ca78` |
| Fable-adapt | claude-fable-5-thinking-xhigh | local Task | `bc-00a6633b-6f82-5fdd-b065-bfff94f458b6` |
| Fable-persist | claude-fable-5-thinking-xhigh | local Task | `bc-700b6a78-b566-5102-b8a4-91709694d1d6` |
| GPT-challenge | gpt-5.6-sol-xhigh-fast | local Task | `bc-f57079ff-be82-5bdb-ade9-cc89b17d2ab5` |
| GPT-frozen | gpt-5.6-sol-xhigh-fast | cloud VM | `bc-603f570e-6d30-571f-98a2-acd354826ebf` |
| Opus-list | claude-opus-5-thinking-high-fast | local Task (no `main.ts`) | `bc-76c936c0-0e3d-5bbb-a0b2-34ea7c1e52b8` |
| Opus-validate | claude-opus-5-thinking-high-fast | cloud VM | `bc-3ca9557e-81c9-5fe7-ae9e-1a1e3959128a` |
| Opus-init | claude-opus-5-thinking-high-fast | local Task (no `main.ts`) | `bc-c618ad5b-5ff2-5e9f-acf8-97a8add58731` |

Deviation from 5/3/2: none. Local implementers were forbidden from editing `src/cli/main.ts` so they cannot clobber each other; parent wires after they land. Cloud Opus-validate owns the `validate` extract of `parseChildSpec`.
