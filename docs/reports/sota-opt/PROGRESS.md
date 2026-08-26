# 进度

更新规则：每轮派出前写计划；子代理回传后记结论；合适时把子代理分支快进合并进 `cursor/sota-persistent-opt-83a1`。

## 基线

- 专属分支从 `origin/main` @ `4a59949` 拉出，并已干净合并 `cursor/three-line-opt-iter4-ae47`（Iter0–4 保行为优化 + 报告 + 等价仿真脚本）。
- 不停轮。目标 ≥20 轮 × 10 子代理，之后仍继续。

## 平台约束

云端异步新 VM 上限为 **3**。第 1 轮仍按 10 区计划执行，分波派出，不缩减目标。模型一律 `claude-fable-5-thinking-xhigh`，未降级。

## 轮次

| 轮 | 状态 | 子代理数 | 模型 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 落地 S1-F/J/C/I；其余区报告收口 |
| 2 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 落地 S2-C；其余区报告收口 |
| 3 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 落地 S3-C；其余区报告收口 |
| 4 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 落地 S4-C / S4-I；其余区报告收口。见 [round-04/PLAN.md](./round-04/PLAN.md) |
| 5 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 落地 S5-C / S5-F / S5-I-1；其余区报告收口。见 [round-05/PLAN.md](./round-05/PLAN.md) |
| 6 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 落地 S6-C / S6-F-1；其余区报告收口。见 [round-06/PLAN.md](./round-06/PLAN.md) |
| 7 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 落地 S7-C / S7-F-1 / S7-F-2 / S7-I-1；其余区报告收口。见 [round-07/PLAN.md](./round-07/PLAN.md) |
| 8 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 报告收口，无新落地。见 [round-08/PLAN.md](./round-08/PLAN.md) |
| 9 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 报告收口，无新落地。见 [round-09/PLAN.md](./round-09/PLAN.md) |
| 10 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 报告收口，无新落地。见 [round-10/PLAN.md](./round-10/PLAN.md) |
| 11 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 报告收口，无新落地。见 [round-11/PLAN.md](./round-11/PLAN.md) |
| 12 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 报告收口，无新落地。见 [round-12/PLAN.md](./round-12/PLAN.md) |
| 13 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 报告收口，无新落地（B 淘汰 S13-B-1；其余区空枚举）。见 [round-13/PLAN.md](./round-13/PLAN.md) |
| 14 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 报告收口，无新落地。见 [round-14/PLAN.md](./round-14/PLAN.md) |
| 15 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 报告收口，无新落地。见 [round-15/PLAN.md](./round-15/PLAN.md) |
| 16 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 报告收口，无新落地。见 [round-16/PLAN.md](./round-16/PLAN.md) |
| 17 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 报告收口，无新落地。见 [round-17/PLAN.md](./round-17/PLAN.md) |
| 18 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 报告收口，无新落地。见 [round-18/PLAN.md](./round-18/PLAN.md) |
| 19 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 报告收口，无新落地。见 [round-19/PLAN.md](./round-19/PLAN.md) |
| 20 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 报告收口，无新落地。见 [round-20/PLAN.md](./round-20/PLAN.md) |
| 21 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 报告收口，无新落地。见 [round-21/PLAN.md](./round-21/PLAN.md) |
| 22 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 报告收口，无新落地。见 [round-22/PLAN.md](./round-22/PLAN.md) |
| 23 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 报告收口，无新落地。见 [round-23/PLAN.md](./round-23/PLAN.md) |
| 24 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 报告收口，无新落地。见 [round-24/PLAN.md](./round-24/PLAN.md) |
| 25 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 报告收口，无新落地。见 [round-25/PLAN.md](./round-25/PLAN.md) |
| 26 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 报告收口，无新落地。见 [round-26/PLAN.md](./round-26/PLAN.md) |
| 27 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 报告收口，无新落地。见 [round-27/PLAN.md](./round-27/PLAN.md) |
| 28 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 报告收口，无新落地。见 [round-28/PLAN.md](./round-28/PLAN.md) |
| 29 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 报告收口，无新落地。见 [round-29/PLAN.md](./round-29/PLAN.md) |
| 30 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 报告收口，无新落地。见 [round-30/PLAN.md](./round-30/PLAN.md) |
| 31 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 报告收口，无新落地（J 铸造 **MODEX**，plan-ban 不入表）。见 [round-31/PLAN.md](./round-31/PLAN.md) |
| 32 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 报告收口，无新落地。见 [round-32/PLAN.md](./round-32/PLAN.md) |
| 33 | 完成 | 10 / 10 | claude-fable-5-thinking-xhigh | 报告收口，无新落地。见 [round-33/PLAN.md](./round-33/PLAN.md) |
| 34 | 第 1–9 波进行中 | 6 / 10（A–F 已合入；G/H 运行中；I 本波派出） | claude-fable-5-thinking-xhigh | [round-34/PLAN.md](./round-34/PLAN.md) |

### Round 1 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R1-A 跟踪门控、R1-F 实验门控、R1-J cluster/privacy/episode | A/F/J 完成已合入 |
| 2 | R1-B live 路由、R1-C 离线路由、R1-D 自优化 | B/C/D 完成已合入 |
| 3 | R1-E 学习、R1-G 运行时/图、R1-H 评价/需求 | 全部完成已合入 |
| 4 | R1-I CLI/适配器 | 完成已合入 |

### Round 2 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R2-A 跟踪、R2-B live 路由、R2-C 离线路由 | A/B/C 完成已合入 |
| 2 | R2-D 自优化、R2-E 学习、R2-F 实验 | D/E/F 完成已合入 |
| 3 | R2-G 运行时/图、R2-H 评价/需求 | G/H 完成已合入 |
| 4 | R2-I CLI/适配器、R2-J cluster/privacy | I/J 完成已合入 |

### Round 3 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R3-A 跟踪门控、R3-B live 路由、R3-C 离线路由 | A/B/C 完成已合入（C 落地 S3-C） |
| 2 | R3-D 自优化、R3-E 学习、R3-F 实验 | D/E/F 完成已合入 |
| 3 | R3-G 运行时/图、R3-H 评价/需求 | G/H 完成已合入 |
| 4 | R3-I CLI/适配器、R3-J cluster/privacy | I/J 完成已合入 |

### Round 4 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R4-A 跟踪门控、R4-B live 路由、R4-C 离线路由 | A/B/C 完成已合入（C 落地 S4-C） |
| 2 | R4-D 自优化、R4-E 学习、R4-F 实验 | D/E/F 完成已合入 |
| 3 | R4-G 运行时/图、R4-H 评价/需求 | G/H 完成已合入 |
| 4 | R4-I CLI/适配器、R4-J cluster/privacy | I/J 完成已合入（I 落地 S4-I） |

### Round 5 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R5-A 跟踪门控、R5-B live 路由、R5-C 离线路由 | A/B/C 完成已合入（C 落地 S5-C） |
| 2 | R5-D 自优化、R5-E 学习、R5-F 实验 | D/E/F 完成已合入（F 落地 S5-F） |
| 3 | R5-G 运行时/图、R5-H 评价/需求 | G/H 完成已合入 |
| 4 | R5-I CLI/适配器、R5-J cluster/privacy | I/J 完成已合入（I 落地 S5-I-1） |

### Round 6 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R6-A 跟踪门控、R6-B live 路由、R6-C 离线路由 | A/B/C 完成已合入（C 落地 S6-C） |
| 2 | R6-D 自优化、R6-E 学习、R6-F 实验 | D/E/F 完成已合入（F 落地 S6-F-1） |
| 3 | R6-G 运行时/图、R6-H 评价/需求 | G/H 完成已合入 |
| 4 | R6-I CLI/适配器、R6-J cluster/privacy | I/J 完成已合入 |

### Round 7 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R7-A 跟踪门控、R7-B live 路由、R7-C 离线路由 | A/B 完成已合入；C 落地 S7-C |
| 2 | R7-D 自优化、R7-E 学习、R7-F 实验 | D/E 完成已合入；F 落地 S7-F-1/S7-F-2 |
| 3 | R7-G 运行时/图、R7-H 评价/需求 | G/H 完成已合入 |
| 4 | R7-I CLI/适配器、R7-J cluster/privacy | I 落地 S7-I-1；J 完成已合入 |

### Round 8 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R8-A 跟踪门控、R8-B live 路由、R8-C 离线路由 | A/B/C 完成已合入 |
| 2 | R8-D 自优化、R8-E 学习、R8-F 实验 | D/E/F 完成已合入 |
| 3 | R8-G 运行时/图、R8-H 评价/需求 | G/H 完成已合入 |
| 4 | R8-I CLI/适配器、R8-J cluster/privacy | I/J 完成已合入 |

### Round 9 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R9-A 跟踪门控、R9-B live 路由、R9-C 离线路由 | A/B/C 完成已合入 |
| 2 | R9-D 自优化、R9-E 学习、R9-F 实验 | D/E/F 完成已合入 |
| 3 | R9-G 运行时/图、R9-H 评价/需求 | G/H 完成已合入 |
| 4 | R9-I CLI/适配器、R9-J cluster/privacy | I/J 完成已合入 |

### Round 10 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R10-A 跟踪门控、R10-B live 路由、R10-C 离线路由 | A/B/C 完成已合入 |
| 2 | R10-D 自优化、R10-E 学习、R10-F 实验 | D/E/F 完成已合入 |
| 3 | R10-G 运行时/图、R10-H 评价/需求 | G/H 完成已合入 |
| 4 | R10-I CLI/适配器、R10-J cluster/privacy | I/J 完成已合入 |

### Round 11 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R11-A 跟踪门控、R11-B live 路由、R11-C 离线路由 | A/B/C 完成已合入 |
| 2 | R11-D 自优化、R11-E 学习、R11-F 实验 | D/E/F 完成已合入 |
| 3 | R11-G 运行时/图、R11-H 评价/需求 | G/H 完成已合入 |
| 4 | R11-I CLI/适配器、R11-J cluster/privacy | I/J 完成已合入 |

### Round 12 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R12-A 跟踪门控、R12-B live 路由、R12-C 离线路由 | A/B/C 完成已合入 |
| 2 | R12-D 自优化、R12-E 学习、R12-F 实验 | D/E/F 完成已合入 |
| 3 | R12-G 运行时/图、R12-H 评价/需求 | G/H 完成已合入 |
| 4 | R12-I CLI/适配器、R12-J cluster/privacy | I/J 完成已合入 |

### Round 13 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R13-A 跟踪门控、R13-B live 路由、R13-C 离线路由 | A/B/C 完成已合入 |
| 2 | R13-D 自优化、R13-E 学习、R13-F 实验 | D/E/F 完成已合入 |
| 3 | R13-G 运行时/图、R13-H 评价/需求 | G/H 完成已合入 |
| 4 | R13-I CLI/适配器、R13-J cluster/privacy | I/J 完成已合入 |

### Round 14 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R14-A 跟踪门控、R14-B live 路由、R14-C 离线路由 | A/B/C 完成已合入 |
| 2 | R14-D 自优化、R14-E 学习、R14-F 实验 | D/E/F 完成已合入 |
| 3 | R14-G 运行时/图、R14-H 评价/需求 | G/H 完成已合入 |
| 4 | R14-I CLI/适配器、R14-J cluster/privacy | I/J 完成已合入 |

### Round 15 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R15-A 跟踪门控、R15-B live 路由、R15-C 离线路由 | A/B/C 完成已合入 |
| 2 | R15-D 自优化、R15-E 学习、R15-F 实验 | D/E/F 完成已合入 |
| 3 | R15-G 运行时/图、R15-H 评价/需求 | G/H 完成已合入 |
| 4 | R15-I CLI/适配器、R15-J cluster/privacy | I/J 完成已合入 |

### Round 16 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R16-A 跟踪门控、R16-B live 路由、R16-C 离线路由 | A/B/C 完成已合入 |
| 2 | R16-D 自优化、R16-E 学习、R16-F 实验 | D/E/F 完成已合入 |
| 3 | R16-G 运行时/图、R16-H 评价/需求、R16-I CLI/适配器 | G/H/I 完成已合入 |
| 4 | R16-J cluster/privacy/episode | J 完成已合入 |

### Round 17 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R17-A 跟踪门控、R17-B live 路由、R17-C 离线路由 | A/B/C 完成已合入 |
| 2 | R17-D 自优化、R17-E 学习、R17-F 实验 | D/E/F 完成已合入 |
| 3 | R17-G 运行时/图、R17-H 评价/需求、R17-I CLI/适配器 | G/H/I 完成已合入 |
| 4 | R17-J cluster/privacy/episode | J 完成已合入 |

### Round 18 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R18-A 跟踪门控、R18-B live 路由、R18-C 离线路由 | A/B/C 完成已合入 |
| 2 | R18-D 自优化、R18-E 学习、R18-F 实验 | D/E/F 完成已合入 |
| 3 | R18-G 运行时/图、R18-H 评价/需求 | G/H 完成已合入 |
| 4 | R18-I CLI/适配器、R18-J cluster/privacy | I/J 完成已合入 |

### Round 19 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R19-A 跟踪门控、R19-B live 路由、R19-C 离线路由 | A/B/C 完成已合入 |
| 2 | R19-D 自优化、R19-E 学习、R19-F 实验 | D/E/F 完成已合入 |
| 3 | R19-G 运行时/图、R19-H 评价/需求 | G/H 完成已合入 |
| 4 | R19-I CLI/适配器、R19-J cluster/privacy | I/J 完成已合入 |

### Round 20 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R20-A 跟踪门控、R20-B live 路由、R20-C 离线路由 | A/B/C 完成已合入 |
| 2 | R20-D 自优化、R20-E 学习、R20-F 实验 | D/E/F 完成已合入 |
| 3 | R20-G 运行时/图 | G 完成已合入 |
| 4 | R20-H 评价/需求、R20-I CLI/适配器、R20-J cluster/privacy | H/I/J 完成已合入 |

### Round 21 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R21-A 跟踪门控、R21-B live 路由、R21-C 离线路由 | A/B/C 完成已合入 |
| 2 | R21-D 自优化、R21-E 学习、R21-F 实验 | D/E/F 完成已合入 |
| 3 | R21-G 运行时/图、R21-H 评价/需求、R21-I CLI/适配器 | G/H/I 完成已合入 |
| 4 | R21-J cluster/privacy/episode | J 完成已合入 |

### Round 22 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R22-A 跟踪门控、R22-B live 路由、R22-C 离线路由 | A/B/C 完成已合入 |
| 2 | R22-D 自优化、R22-E 学习 | D/E 完成已合入 |
| 3 | R22-F 实验、R22-G 运行时/图、R22-H 评价/需求 | F/G/H 完成已合入 |
| 4 | R22-I CLI/适配器、R22-J cluster/privacy/episode | I/J 完成已合入 |

### Round 23 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R23-A 跟踪门控、R23-B live 路由、R23-C 离线路由 | A/B/C 完成已合入 |
| 2 | R23-D 自优化、R23-E 学习 | D/E 完成已合入 |
| 3 | R23-F 实验、R23-G 运行时/图、R23-H 评价/需求 | F/G/H 完成已合入 |
| 4 | R23-I CLI/适配器、R23-J cluster/privacy | I/J 完成已合入 |

### Round 24 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R24-A 跟踪门控、R24-B live 路由、R24-C 离线路由 | A/B/C 完成已合入 |
| 2 | R24-D 自优化、R24-E 学习 | D/E 完成已合入 |
| 3 | R24-F 实验、R24-G 运行时/图、R24-H 评价/需求 | F/G/H 完成已合入 |
| 4 | R24-I CLI/适配器、R24-J cluster/privacy | I/J 完成已合入 |

### Round 25 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R25-A 跟踪门控、R25-B live 路由、R25-C 离线路由 | A/B/C 已合入 |
| 2 | R25-D 自优化、R25-E 学习 | D/E 已合入 |
| 3 | R25-F 实验、R25-G 运行时/图、R25-H 评价/需求 | F/G/H 已合入 |
| 4 | R25-I CLI/适配器、R25-J cluster/privacy | I/J 完成已合入 |

### Round 26 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R26-A 跟踪门控、R26-B live 路由、R26-C 离线路由 | A/B/C 已合入 |
| 2 | R26-D 自优化、R26-E 学习 | D/E 已合入 |
| 3 | R26-F 实验、R26-G 运行时/图、R26-H 评价/需求 | F/G/H 已合入 |
| 4 | R26-I CLI/适配器、R26-J cluster/privacy | I/J 已合入 |

### Round 27 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R27-A 跟踪门控、R27-B live 路由、R27-C 离线路由 | A/B/C 已合入 |
| 2 | R27-D 自优化、R27-E 学习 | D/E 已合入 |
| 3 | R27-F 实验、R27-G 运行时/图 | F/G 已合入 |
| 4 | R27-H 评价/需求 | H 已合入 |
| 5 | R27-I CLI/适配器 | I 已合入 |
| 6 | R27-J cluster/privacy | J 已合入 |

### Round 28 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R28-A 跟踪门控、R28-B live 路由、R28-C 离线路由 | A/B/C 已合入 |
| 2 | R28-D 自优化 | D 已合入 |
| 3 | R28-E 学习 | E 已合入 |
| 4 | R28-F 实验门控 | F 已合入 |
| 5 | R28-G 运行时/图 | G 已合入 |
| 6 | R28-H 评价/需求 | H 已合入 |
| 7 | R28-I CLI/适配器 | I 已合入 |
| 8 | R28-J cluster/privacy | J 已合入 |

### Round 29 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R29-A 跟踪门控 | A 已合入 |
| 2 | R29-B live 路由 | B 已合入 |
| 3 | R29-C 离线路由 | C 已合入 |
| 4 | R29-D 自优化 | D 已合入 |
| 5 | R29-E 学习 | E 已合入 |
| 6 | R29-F 实验门控 | F 已合入 |
| 7 | R29-G 运行时/图 | G 已合入 |
| 8 | R29-H 评价/需求 | H 已合入 |
| 9 | R29-I CLI/适配器 | I 已合入 |
| 10 | R29-J cluster/privacy | J 已合入 |

### Round 30 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R30-A 跟踪门控 | A 已合入 |
| 2 | R30-B live 路由 | B 已合入 |
| 3 | R30-C 离线路由 | C 已合入 |
| 4 | R30-D 自优化 | D 已合入 |
| 5 | R30-E 学习 | E 已合入 |
| 6 | R30-F 实验门控 | F 已合入 |
| 7 | R30-G 运行时/图 | G 已合入 |
| 8 | R30-H 评价/需求 | H 已合入 |
| 9 | R30-I CLI/适配器 | I 已合入 |
| 10 | R30-J cluster/privacy | J 已合入 |

### Round 31 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R31-A 跟踪门控 | A 已合入 |
| 2 | R31-B live 路由 | B 已合入 |
| 3 | R31-C 离线路由 | C 已合入 |
| 4 | R31-D 自优化 | D 已合入 |
| 5 | R31-E 学习 | E 已合入 |
| 6 | R31-F 实验门控 | F 已合入 |
| 7 | R31-G 运行时/图 | G 已合入 |
| 8 | R31-H 评价/需求 | H 已合入 |
| 9 | R31-I CLI/适配器 | I 已合入 |
| 10 | R31-J cluster/privacy | J 已合入 |

### Round 32 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R32-A 跟踪门控 | A 已合入 |
| 2 | R32-B live 路由 | B 已合入 |
| 3 | R32-C 离线路由 | C 已合入 |
| 4 | R32-D 自优化 | D 已合入 |
| 5 | R32-E 学习 | E 已合入 |
| 6 | R32-F 实验门控 | F 已合入 |
| 7 | R32-G 运行时/图 | G 已合入 |
| 8 | R32-H 评价/需求 | H 已合入 |
| 9 | R32-I CLI/适配器 | I 已合入 |
| 10 | R32-J cluster/privacy | J 已合入 |

### Round 33 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R33-A 跟踪门控 | A 已合入 |
| 2 | R33-B live 路由 | B 已合入 |
| 3 | R33-C 离线路由 | C 已合入 |
| 4 | R33-D 自优化 | D 已合入 |
| 5 | R33-E 学习 | E 已合入 |
| 6 | R33-F 实验门控 | F 已合入 |
| 7 | R33-G 运行时/图 | G 已合入 |
| 8 | R33-H 评价/需求 | H 已合入 |
| 9 | R33-I CLI/适配器 | I 已合入 |
| 10 | R33-J cluster/privacy | J 已合入 |

### Round 34 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R34-A 跟踪门控 | A 已合入 |
| 2 | R34-B live 路由 | B 已合入 |
| 3 | R34-C 离线路由 | C 已合入 |
| 4 | R34-D 自优化 | D 已合入 |
| 5 | R34-E 学习 | E 已合入 |
| 6 | R34-F 实验门控 | F 已合入 |
| 7 | R34-G 运行时/图 | G 运行中 |
| 8 | R34-H 评价/需求 | H 运行中 |
| 9 | R34-I CLI/适配器 | I 本波派出 |

## 待合并 PR / 分支

| 来源 | 分支 | 处置 |
| --- | --- | --- |
| R1-A | `cursor/sota-r1-a-tracking-1174` | 已合入专属分支（仅 `R1-A.md`） |
| R1-F | `cursor/r1-f-experiments-sota-4ac9` | 已合入专属分支（S1-F 代码 + 报告 + 仿真） |
| R1-J | `cursor/r1j-data-plane-opt-d508` | 已合入专属分支（J1 代码 + 报告 + 仿真） |
| R1-B | `cursor/r1-b-live-routing-slice-c9b5` | 已合入专属分支（仅 `R1-B.md`） |
| R1-D | `cursor/r1-d-adaptation-opt-41f0` | 已合入专属分支（仅 `R1-D.md`） |
| R1-E | `cursor/r1e-learning-slice-5cd3` | 已合入专属分支（仅 `R1-E.md`） |
| R1-C | `cursor/r1c-offline-routing-a496` | 已合入专属分支（S1-C 代码 + 报告 + 仿真） |
| R1-G | `cursor/r1-g-runtime-graph-domain-f48c` | 已合入专属分支（仅 `R1-G.md`） |
| R1-I | `cursor/r1-i-cli-adapter-slice-f177` | 已合入专属分支（S1-I 代码 + 报告） |
| R1-H | `cursor/r1-h-eval-req-review-rubric-038d` | 已合入专属分支（仅 `R1-H.md`） |
| R2-A | `cursor/r2a-tracking-slice-ccba` | 已合入专属分支（仅 `R2-A.md`） |
| R2-D | `cursor/r2-d-adaptation-reaudit-1b42` | 已合入专属分支（仅 `R2-D.md`） |
| R2-B | `cursor/r2-b-live-routing-slice-3ef3` | 已合入专属分支（仅 `R2-B.md`） |
| R2-C | `cursor/r2c-offline-routing-6f3a` | 已合入专属分支（S2-C 代码 + 报告 + 仿真） |
| R2-E | `cursor/r2-e-learning-slice-a47a` | 已合入专属分支（仅 `R2-E.md`） |
| R2-F | `cursor/r2f-experiments-research-c879` | 已合入专属分支（仅 `R2-F.md`） |
| R2-G | `cursor/r2-g-runtime-graph-domain-ffb9` | 已合入专属分支（仅 `R2-G.md`） |
| R2-H | `cursor/r2-h-eval-req-review-rubric-05c5` | 已合入专属分支（仅 `R2-H.md`） |
| R2-I | `cursor/r2-i-sota-opt-7b6c` | 已合入专属分支（仅 `R2-I.md`） |
| R3-A | `cursor/r3-a-tracking-third-pass-41c0` | 已合入专属分支（仅 `R3-A.md`） |
| R2-J | `cursor/r2-j-persist-slice-a4e3` | 已合入专属分支（仅 `R2-J.md`） |
| R3-B | `cursor/r3-b-routing-slice-4959` | 已合入专属分支（仅 `R3-B.md`） |
| R3-D | `cursor/r3-d-adaptation-third-pass-83a1` | 已合入专属分支（仅 `R3-D.md`） |
| R3-C | `cursor/r3c-offline-routing-c9c8` | 已合入专属分支（S3-C 代码 + 报告 + 仿真） |
| R3-E | `cursor/r3-e-learning-third-pass-83a1` | 已合入专属分支（仅 `R3-E.md`） |
| R3-F | `cursor/r3-f-experiments-third-pass-83a1` | 已合入专属分支（仅 `R3-F.md`） |
| R3-G | `cursor/r3-g-runtime-third-pass-83a1` | 已合入专属分支（仅 `R3-G.md`） |
| R3-H | `cursor/r3-h-eval-third-pass-83a1` | 已合入专属分支（仅 `R3-H.md`） |
| R3-I | `cursor/r3-i-cli-third-pass-83a1` | 已合入专属分支（仅 `R3-I.md`） |
| R3-J | `cursor/r3-j-persist-third-pass-83a1` | 已合入专属分支（仅 `R3-J.md`） |
| R4-A | `cursor/r4-a-tracking-fourth-pass-83a1` | 已合入专属分支（仅 `R4-A.md`） |
| R4-B | `cursor/r4-b-live-routing-fourth-pass-83a1` | 已合入专属分支（仅 `R4-B.md`） |
| R4-C | `cursor/r4-c-offline-routing-fourth-pass-83a1` | 已合入专属分支（S4-C 代码 + 报告 + 仿真）。父代理重跑 r1c/r2c/r3c/r4c 全绿（8028 / 14420 / 14730 / 24888 逐位）；r4c 生产 1126.3 ms vs 冻结 S3-C 2728.9 ms |
| R4-D | `cursor/r4-d-adaptation-fourth-pass-83a1` | 已合入专属分支（仅 `R4-D.md`） |
| R4-E | `cursor/r4-e-learning-fourth-pass-83a1` | 已合入专属分支（仅 `R4-E.md`） |
| R4-F | `cursor/r4-f-experiments-fourth-pass-83a1` | 已合入专属分支（仅 `R4-F.md`） |
| R4-G | `cursor/r4-g-runtime-fourth-pass-83a1` | 已合入专属分支（仅 `R4-G.md`） |
| R4-H | `cursor/r4-h-eval-fourth-pass-83a1` | 已合入专属分支（仅 `R4-H.md`） |
| R4-I | `cursor/r4-i-cli-fourth-pass-83a1` | 已合入专属分支（S4-I 代码 + 报告 + 仿真）。父代理重跑 r4i 全绿（68 检查 / 0 失败）；`cli --version` 冒烟通过 |
| R4-J | `cursor/r4-j-persist-fourth-pass-83a1` | 已合入专属分支（仅 `R4-J.md`） |
| R5-A | `cursor/r5-a-tracking-fifth-pass-83a1` | 已合入专属分支（仅 `R5-A.md`） |
| R5-B | `cursor/r5-b-live-routing-fifth-pass-83a1` | 已合入专属分支（仅 `R5-B.md`） |
| R5-D | `cursor/r5-d-adaptation-fifth-pass-83a1` | 已合入专属分支（仅 `R5-D.md`） |
| R5-C | `cursor/r5-c-offline-routing-fifth-pass-83a1` | 已合入专属分支（S5-C 代码 + 报告 + 仿真）。父代理重跑 r1c/r2c/r3c/r4c/r5c 全绿（8028 / 14420 / 14730 / 24888 / 28555 逐位）；r5c 生产 809.5 ms vs 冻结 S4-C 1132.9 ms（1.40×） |
| R5-E | `cursor/r5-e-learning-fifth-pass-83a1` | 已合入专属分支（仅 `R5-E.md`） |
| R5-F | `cursor/r5-f-experiments-fifth-pass-83a1` | 已合入专属分支（S5-F 代码 + 报告 + 仿真）。父代理重跑 r1f/r5f 全绿（2668 / 224 逐位）；r5f 全实验 P=2000/A=1000 = 259.73 ms |
| R5-I | `cursor/r5-i-cli-fifth-pass-83a1` | 已合入专属分支（S5-I-1 代码 + 报告 + 仿真）。父代理重跑 r4i 68/68、r5i 119/119 全绿；`cli --version` 冒烟通过 |
| R5-G | `cursor/r5-g-runtime-fifth-pass-83a1` | 已合入专属分支（仅 `R5-G.md`） |
| R6-A | `cursor/r6-a-tracking-sixth-pass-83a1` | 已合入专属分支（仅 `R6-A.md`） |
| R6-C | `cursor/r6-c-offline-routing-sixth-pass-83a1` | 已合入专属分支（S6-C 代码 + 报告 + 仿真）。父代理重跑 r1c–r6c 全绿（8028 / 14420 / 14730 / 24888 / 28555 / 25483 逐位）；r6c 生产 743.9 ms vs 冻结 S5-C 780.5 ms（1.05×） |
| R5-H | `cursor/r5-h-eval-fifth-pass-83a1` | 已合入专属分支（仅 `R5-H.md`） |
| R5-J | `cursor/r5-j-persist-fifth-pass-83a1` | 已合入专属分支（仅 `R5-J.md`） |
| R6-B | `cursor/r6-b-live-routing-sixth-pass-83a1` | 已合入专属分支（仅 `R6-B.md`） |
| R6-D | `cursor/r6-d-adaptation-sixth-pass-83a1` | 已合入专属分支（仅 `R6-D.md`） |
| R6-E | `cursor/r6-e-learning-sixth-pass-83a1` | 已合入专属分支（仅 `R6-E.md`） |
| R6-F | `cursor/r6-f-experiments-sixth-pass-83a1` | 已合入专属分支（S6-F-1 代码 + 报告 + 仿真）。父代理重跑 r1f/r5f/r6f 全绿（2668 / 224 / 27 逐位）；r5f 全实验 P=2000/A=1000 = 173.05 ms；r6f 全实验 176.48 ms |
| R6-G | `cursor/r6-g-runtime-sixth-pass-83a1` | 已合入专属分支（仅 `R6-G.md`） |
| R6-H | `cursor/r6-h-eval-sixth-pass-83a1` | 已合入专属分支（仅 `R6-H.md`） |
| R6-I | `cursor/r6-i-cli-sixth-pass-83a1` | 已合入专属分支（仅 `R6-I.md`） |
| R6-J | `cursor/r6-j-persist-sixth-pass-83a1` | 已合入专属分支（仅 `R6-J.md`） |
| R7-A | `cursor/r7-a-tracking-seventh-pass-83a1` | 已合入专属分支（仅 `R7-A.md`） |
| R7-B | `cursor/r7-b-live-routing-seventh-pass-83a1` | 已合入专属分支（仅 `R7-B.md`） |
| R7-C | `cursor/r7-c-offline-routing-seventh-pass-83a1` | 已合入专属分支（仅 `R7-C.md`）。S7-C-1..4 淘汰；X2-1 档案见 R7-C-LAND |
| R7-C-LAND | `cursor/r7-c-x21-sod-land-83a1` | 已合入专属分支（S7-C 代码 + 报告 + 仿真）。父代理重跑 r1c–r7c 全绿（8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193 逐位）；r7c 生产 659.1 ms vs 冻结 S6-C 744.6 ms（1.13×） |
| R7-D | `cursor/r7-d-adaptation-seventh-pass-83a1` | 已合入专属分支（仅 `R7-D.md`） |
| R7-E | `cursor/r7-e-learning-seventh-pass-83a1` | 已合入专属分支（仅 `R7-E.md`） |
| R7-F | `cursor/r7-f-experiments-seventh-pass-83a1` | 已合入专属分支（S7-F-1/S7-F-2 代码 + 报告 + 仿真）。父代理重跑 r1f/r5f/r6f/r7f 全绿（2668 / 224 / 27 / 169 逐位）；r5f 全实验 P=2000/A=1000 = 122.51 ms；r6f 全实验 119.41 ms；r7f 全实验 129.58 ms；r7f 四次序 restore 同号为正（prefix +45.55 / half +28.29 / scattered +4.40 / reversed +5.29 ms） |
| R7-J | `cursor/r7-j-persist-seventh-pass-83a1` | 已合入专属分支（仅 `R7-J.md`） |
| R7-G | `cursor/r7-g-runtime-seventh-pass-83a1` | 已合入专属分支（仅 `R7-G.md`） |
| R7-H | `cursor/r7-h-eval-seventh-pass-83a1` | 已合入专属分支（仅 `R7-H.md`） |
| R7-I | `cursor/r7-i-cli-seventh-pass-83a1` | 已合入专属分支（S7-I-1 代码 + 报告 + 仿真）。父代理重跑 r4i/r5i/r7i 全绿（68 / 119 / 80） |
| R8-A | `cursor/r8-a-tracking-eighth-pass-83a1` | 已合入专属分支（仅 `R8-A.md`）。S8-A-1..3 淘汰；预算锚点复核 88–90 µs/run |
| R8-B | `cursor/r8-b-live-routing-eighth-pass-83a1` | 已合入专属分支（仅 `R8-B.md`） |
| R8-C | `cursor/r8-c-offline-routing-eighth-pass-83a1` | 已合入专属分支（仅 `R8-C.md`）。S8-C-1..4 淘汰；S7-C 后剖析 661–670 ms/报告，贴带不越带 |
| R8-D | `cursor/r8-d-adaptation-eighth-pass-83a1` | 已合入专属分支（仅 `R8-D.md`）。S8-D-1..5 淘汰；eval 地板复核 4.05–4.33 ms，配置态仍同带 |
| R8-E | `cursor/r8-e-learning-eighth-pass-83a1` | 已合入专属分支（仅 `R8-E.md`）。S8-E-1..3 淘汰；SLICE-CPU 复核 17.2–17.5 µs/run |
| R8-F | `cursor/r8-f-experiments-eighth-pass-83a1` | 已合入专属分支（仅 `R8-F.md`）。S8-F-1..3 淘汰；全实验锚点复核 120.39 ms |
| R8-G | `cursor/r8-g-runtime-eighth-pass-83a1` | 已合入专属分支（仅 `R8-G.md`）。S8-G-1..2 淘汰；CPU 0.28–0.29 ms vs I/O 地板 72–100 ms |
| R8-H | `cursor/r8-h-eval-eighth-pass-83a1` | 已合入专属分支（仅 `R8-H.md`）。S8-H-1..3 淘汰；配置态锚点首测无隐藏悬崖 |
| R8-I | `cursor/r8-i-cli-eighth-pass-83a1` | 已合入专属分支（仅 `R8-I.md`）。S8-I-1..3 淘汰；配置态 × 命令类矩阵已闭合 |
| R8-J | `cursor/r8-j-persist-eighth-pass-83a1` | 已合入专属分支（仅 `R8-J.md`）。S8-J-1..2 淘汰；删除级联配置态锚点 666–717µs |
| R9-A | `cursor/r9-a-tracking-ninth-pass-83a1` | 已合入专属分支（仅 `R9-A.md`）。S9-A-1 淘汰；预算复核 60–76 µs/run |
| R9-B | `cursor/r9-b-live-routing-ninth-pass-83a1` | 已合入专属分支（仅 `R9-B.md`）。S9-B-1..4 淘汰；天花板复核含配置态 M=7+learned |
| R9-C | `cursor/r9-c-offline-routing-ninth-pass-83a1` | 已合入专属分支（仅 `R9-C.md`）。S9-C-1..4 淘汰；r1c–r7c 回归门绿；贴带不越带 |
| R9-D | `cursor/r9-d-adaptation-ninth-pass-83a1` | 已合入专属分支（仅 `R9-D.md`）。S9-D-1..4 淘汰；配置态 × 命令类矩阵闭合 |
| R9-E | `cursor/r9-e-learning-ninth-pass-83a1` | 已合入专属分支（仅 `R9-E.md`）。S9-E-1..3 淘汰；SLICE-CPU 复核 17.4–17.6 µs/run |
| R9-F | `cursor/r9-f-experiments-ninth-pass-83a1` | 已合入专属分支（仅 `R9-F.md`）。S9-F-1..3 淘汰；全实验锚点复核 121.87 ms |
| R9-G | `cursor/r9-g-runtime-ninth-pass-83a1` | 已合入专属分支（仅 `R9-G.md`）。S9-G-1..3 淘汰；CPU 0.29 ms vs I/O 87–98 ms |
| R9-H | `cursor/r9-h-eval-ninth-pass-83a1` | 已合入专属分支（仅 `R9-H.md`）。S9-H-1..2 淘汰；配置态锚点仍低于默认态 |
| R9-I | `cursor/r9-i-cli-ninth-pass-83a1` | 已合入专属分支（仅 `R9-I.md`）。无新排除 ID；配置态矩阵抽测复现；切片关闭 |
| R9-J | `cursor/r9-j-persist-ninth-pass-83a1` | 已合入专属分支（仅 `R9-J.md`）。S9-J-1..4 淘汰；删除级联配置态锚点复核 678–714µs |
| R10-A | `cursor/r10-a-tracking-tenth-pass-83a1` | 已合入专属分支（仅 `R10-A.md`）。S10-A-1 淘汰；预算复核 59–70 µs/run |
| R10-B | `cursor/r10-b-live-routing-tenth-pass-83a1` | 已合入专属分支（仅 `R10-B.md`）。S10-B-1..3 淘汰；天花板复核含 M=10+learned |
| R10-C | `cursor/r10-c-offline-routing-tenth-pass-83a1` | 已合入专属分支（仅 `R10-C.md`）。S10-C-1..3 淘汰；r1c–r7c 回归门绿；贴带不越带 |
| R10-D | `cursor/r10-d-adaptation-tenth-pass-83a1` | 已合入专属分支（仅 `R10-D.md`）。S10-D-1..2 淘汰；配置态矩阵复核仍闭合 |
| R10-E | `cursor/r10-e-learning-tenth-pass-83a1` | 已合入专属分支（仅 `R10-E.md`）。无新排除 ID；SLICE-CPU 复核 10.9–11.3 µs/run |
| R10-F | `cursor/r10-f-experiments-tenth-pass-83a1` | 已合入专属分支（仅 `R10-F.md`）。无新排除 ID；全实验锚点复核 123.9–126.0 ms |
| R10-G | `cursor/r10-g-runtime-tenth-pass-83a1` | 已合入专属分支（仅 `R10-G.md`）。S10-G-1 淘汰；CPU 0.29 ms vs I/O 98–107 ms |
| R10-H | `cursor/r10-h-eval-tenth-pass-83a1` | 已合入专属分支（仅 `R10-H.md`）。无新排除 ID；配置态仍低于默认态 |
| R10-I | `cursor/r10-i-cli-tenth-pass-83a1` | 已合入专属分支（仅 `R10-I.md`）。无新排除 ID；custom−builtin 复现；切片关闭 |
| R10-J | `cursor/r10-j-persist-tenth-pass-83a1` | 已合入专属分支（仅 `R10-J.md`）。无新排除 ID；I/O 地板复核；切片关闭 |
| R11-A | `cursor/r11-a-tracking-eleventh-pass-83a1` | 已合入专属分支（仅 `R11-A.md`）。S11-A-1..2 淘汰；预算复核 60–74 µs/run |
| R11-B | `cursor/r11-b-live-routing-eleventh-pass-83a1` | 已合入专属分支（仅 `R11-B.md`）。S11-B-1 淘汰；天花板复核含 M=10+learned |
| R11-C | `cursor/r11-c-offline-routing-eleventh-pass-83a1` | 已合入专属分支（仅 `R11-C.md`）。无新排除 ID；r1c–r7c 回归门绿；贴带不越带 |
| R11-D | `cursor/r11-d-adaptation-eleventh-pass-83a1` | 已合入专属分支（仅 `R11-D.md`）。S11-D-1..2 淘汰；eval 地板复核 3.58–4.41 ms |
| R11-E | `cursor/r11-e-learning-eleventh-pass-83a1` | 已合入专属分支（仅 `R11-E.md`）。无新排除 ID；SLICE-CPU 复核 17.2–17.6 µs/run |
| R11-F | `cursor/r11-f-experiments-eleventh-pass-83a1` | 已合入专属分支（仅 `R11-F.md`）。无新排除 ID；全实验锚点复核 120.3–121.2 ms；outcomes.some 记账勘误 1.63–1.73 ms |
| R11-G | `cursor/r11-g-runtime-eleventh-pass-83a1` | 已合入专属分支（仅 `R11-G.md`）。S11-G-1..3 淘汰；计算顶复核 0.295–0.306 ms vs I/O 91.7–101.5 ms |
| R11-H | `cursor/r11-h-eval-eleventh-pass-83a1` | 已合入专属分支（仅 `R11-H.md`）。无新排除 ID；热层默认复核 8.5–9.1 µs/run |
| R11-I | `cursor/r11-i-cli-eleventh-pass-83a1` | 已合入专属分支（仅 `R11-I.md`）。无新排除 ID；custom−builtin 复核 +22.8~+48.0 ms；S8-I-1 重开物定位为 pi-ai `models.generated` 导出 |
| R12-A | `cursor/r12-a-tracking-twelfth-pass-83a1` | 已合入专属分支（仅 `R12-A.md`）。无新排除 ID；预算复核 70–92 µs/run；合同地板分解 |
| R12-B | `cursor/r12-b-live-routing-twelfth-pass-83a1` | 已合入专属分支（仅 `R12-B.md`）。S12-B-1..2 淘汰；天花板复核含 prior 矩阵格；S12-B-2 为条件式落地物 |
| R11-J | `cursor/r11-j-persist-eleventh-pass-83a1` | 已合入专属分支（仅 `R11-J.md`）。无新排除 ID；I/O 地板复核；切片关闭 |
| R12-C | `cursor/r12-c-offline-routing-twelfth-pass-83a1` | 已合入专属分支（仅 `R12-C.md`）。S12-C-1 淘汰（嵌套序交换，稳定 ~3.6× 负优化）；生产中位复核 658–663 ms/报告 |
| R12-D | `cursor/r12-d-adaptation-twelfth-pass-83a1` | 已合入专属分支（仅 `R12-D.md`）。S12-D-1..2 淘汰；eval 地板复核 3.72–4.07 ms；S12-D-2 生产规模稳定负优化 |
| R12-E | `cursor/r12-e-learning-twelfth-pass-83a1` | 已合入专属分支（仅 `R12-E.md`）。无新排除 ID；SLICE-CPU 复核 18.5–19.2 µs/run |
| R12-F | `cursor/r12-f-experiments-twelfth-pass-83a1` | 已合入专属分支（仅 `R12-F.md`）。无新排除 ID；全实验锚点复核 121–133 ms；账目残差直测 8–204 µs |
| R12-G | `cursor/r12-g-runtime-twelfth-pass-83a1` | 已合入专属分支（仅 `R12-G.md`）。无新排除 ID；计算顶复核 0.294–0.304 ms vs I/O 95.5–105.6 ms |
| R12-H | `cursor/r12-h-eval-twelfth-pass-83a1` | 已合入专属分支（仅 `R12-H.md`）。无新排除 ID；热层默认复核 8.5–8.9 µs/run；热链剖面分解 |
| R12-I | `cursor/r12-i-cli-twelfth-pass-83a1` | 已合入专属分支（仅 `R12-I.md`）。无新排除 ID；custom−builtin 复核 +24.1~+58.7 ms；S8-I-1 7 exports 全部特征化 |
| R12-J | `cursor/r12-j-persist-twelfth-pass-83a1` | 已合入专属分支（仅 `R12-J.md`）。无新排除 ID；I/O 地板复核；切片关闭 |
| R13-A | `cursor/r13-a-tracking-thirteenth-pass-83a1` | 已合入专属分支（仅 `R13-A.md`）。无新排除 ID；预算复核 70–81 µs/run；turn 内部剖面归档 |
| R13-B | `cursor/r13-b-live-routing-thirteenth-pass-83a1` | 已合入专属分支（仅 `R13-B.md`）。S13-B-1 淘汰；天花板复核含 learned-size 格；S12-B-2 重开条件未触发 |
| R13-C | `cursor/r13-c-offline-routing-thirteenth-pass-83a1` | 已合入专属分支（仅 `R13-C.md`）。无新排除 ID；生产中位复核 663–675 ms/报告；五处无名微观不铸 ID |
| R13-D | `cursor/r13-d-adaptation-thirteenth-pass-83a1` | 已合入专属分支（仅 `R13-D.md`）。无新排除 ID；eval 地板复核 3.83–4.05 ms；整命令 21 相位剖面归档 |
| R13-E | `cursor/r13-e-learning-thirteenth-pass-83a1` | 已合入专属分支（仅 `R13-E.md`）。无新排除 ID；SLICE-CPU 复核 13.5–15.9 µs/run；S13-B-1 辖区未重提 |
| R13-F | `cursor/r13-f-experiments-thirteenth-pass-83a1` | 已合入专属分支（仅 `R13-F.md`）。无新排除 ID；全实验锚点复核 119–130 ms；validate Ω(P) 体分解归档 |
| R13-G | `cursor/r13-g-runtime-thirteenth-pass-83a1` | 已合入专属分支（仅 `R13-G.md`）。无新排除 ID；计算顶复核 0.289–0.293 ms vs I/O 85.1–109.2 ms；Node 22.22 API 面轴归档 |
| R13-H | `cursor/r13-h-eval-thirteenth-pass-83a1` | 已合入专属分支（仅 `R13-H.md`）。无新排除 ID；热层默认复核 9.3–10.4 µs/run；规模-越线标定归档 |
| R13-I | `cursor/r13-i-cli-thirteenth-pass-83a1` | 已合入专属分支（仅 `R13-I.md`）。无新排除 ID；custom−builtin 复核 +21.5~+51.7 ms；`all.models` 文件级探针 blocked |
| R13-J | `cursor/r13-j-persist-thirteenth-pass-83a1` | 已合入专属分支（仅 `R13-J.md`）。无新排除 ID；I/O 地板复核；切片关闭 |
| R14-A | `cursor/r14-a-tracking-fourteenth-pass-83a1` | 已合入专属分支（仅 `R14-A.md`）。无新排除 ID；预算复核 69–81 µs/run；E 规模越线标定 + max-codes 格归档 |
| R14-B | `cursor/r14-b-live-routing-fourteenth-pass-83a1` | 已合入专属分支（仅 `R14-B.md`）。无新排除 ID；天花板复核 M=2 9.3–10.2 / M=10 17.6–19.6 ms/eval；GC/JIT 轴归档 |
| R14-C | `cursor/r14-c-offline-routing-fourteenth-pass-83a1` | 已合入专属分支（仅 `R14-C.md`）。无新排除 ID；生产中位复核 658–689 ms/报告；四无名微观不铸 ID |
| R14-D | `cursor/r14-d-adaptation-fourteenth-pass-83a1` | 已合入专属分支（仅 `R14-D.md`）。无新排除 ID；eval 地板复核 4.05–4.21 ms；规模越线标定归档 |
| R14-E | `cursor/r14-e-learning-fourteenth-pass-83a1` | 已合入专属分支（仅 `R14-E.md`）。无新排除 ID；SLICE-CPU 复核 17.2–19.2 µs/run；规模越线 + JIT 档归档 |
| R14-F | `cursor/r14-f-experiments-fourteenth-pass-83a1` | 已合入专属分支（仅 `R14-F.md`）。无新排除 ID；全实验锚点复核 121–129 ms；GC/出处/deopt 轴归档 |
| R14-G | `cursor/r14-g-runtime-fourteenth-pass-83a1` | 已合入专属分支（仅 `R14-G.md`）。无新排除 ID；计算顶复核 0.288–0.295 ms vs I/O 93.6–101.4 ms；引擎态/规模轴归档 |
| R14-H | `cursor/r14-h-eval-fourteenth-pass-83a1` | 已合入专属分支（仅 `R14-H.md`）。无新排除 ID；热层默认复核 9.27–9.38 µs/run；引擎底 GC/JIT 轴归档 |
| R14-I | `cursor/r14-i-cli-fourteenth-pass-83a1` | 已合入专属分支（仅 `R14-I.md`）。无新排除 ID；custom−builtin 复核 +23.7~+55.1 ms；肥配置态交叉不存在；六连空 |
| R14-J | `cursor/r14-j-persist-fourteenth-pass-83a1` | 已合入专属分支（仅 `R14-J.md`）。无新排除 ID；I/O 地板复核；规模越线标定归档；切片关闭 |
| R15-A | `cursor/r15-a-tracking-fifteenth-pass-83a1` | 已合入专属分支（仅 `R15-A.md`）。无新排除 ID；预算复核 69–83 µs/run；C/R 越线 + GC/JIT 轴归档 |
| R15-B | `cursor/r15-b-live-routing-fifteenth-pass-83a1` | 已合入专属分支（仅 `R15-B.md`）。无新排除 ID；天花板复核 M=2 9.5–10.9 / M=10 18.5–25.4 ms/eval；A/A 噪声地板 + 引擎代归档 |
| R15-C | `cursor/r15-c-offline-routing-fifteenth-pass-83a1` | 已合入专属分支（仅 `R15-C.md`）。无新排除 ID；生产中位复核 660.6–667.1 ms/报告；STORD/RIDGE 不铸 ID；AAFLR/GCAX 轴归档 |
| R15-D | `cursor/r15-d-adaptation-fifteenth-pass-83a1` | 已合入专属分支（仅 `R15-D.md`）。无新排除 ID；eval 地板复核 3.10–3.25 ms；分配/GC + A/A MDE 轴归档 |
| R15-E | `cursor/r15-e-learning-fifteenth-pass-83a1` | 已合入专属分支（仅 `R15-E.md`）。无新排除 ID；SLICE-CPU 复核 20.9–22.4 µs/run；GC/A-A 轴归档 |
| R15-F | `cursor/r15-f-experiments-fifteenth-pass-83a1` | 已合入专属分支（仅 `R15-F.md`）。无新排除 ID；全实验锚点复核 120.7–132.3 ms；A/A MDE + L 长度 + 引擎代轴归档 |
| R15-G | `cursor/r15-g-runtime-fifteenth-pass-83a1` | 已合入专属分支（仅 `R15-G.md`）。无新排除 ID；计算顶复核 0.290–0.297 ms vs I/O 89.7–103.5 ms；A/A + 引擎代轴归档；digest 第六次逐位相同 |
| R15-H | `cursor/r15-h-eval-fifteenth-pass-83a1` | 已合入专属分支（仅 `R15-H.md`）。无新排除 ID；热层默认复核 9.46–9.57 µs/run；A/A 决斗地板轴归档；S5-H-1 维持 |
| R15-I | `cursor/r15-i-cli-fifteenth-pass-83a1` | 已合入专属分支（仅 `R15-I.md`）。无新排除 ID；custom−builtin 复核 +23.2~+65.9 ms；七连空；A/A + 引擎代 + 堆足迹轴归档 |
| R15-J | `cursor/r15-j-persist-fifteenth-pass-83a1` | 已合入专属分支（仅 `R15-J.md`）。无新排除 ID；I/O 地板复核；A/A + 引擎代轴归档；切片关闭 |
| R16-A | `cursor/r16-a-tracking-sixteenth-pass-83a1` | 已合入专属分支（仅 `R16-A.md`）。无新排除 ID；预算复核 66–76 µs/run；payload 形态轴 L/V/S 归档 |
| R16-B | `cursor/r16-b-live-routing-sixteenth-pass-83a1` | 已合入专属分支（仅 `R16-B.md`）。无新排除 ID；天花板复核 M=2 8.8–9.4 / M=10 17.7–18.5 ms/eval；剖析站点预算 + 语料基底轴归档 |
| R16-C | `cursor/r16-c-offline-routing-sixteenth-pass-83a1` | 已合入专属分支（仅 `R16-C.md`）。无新排除 ID；生产中位复核 672.8–686.3 ms/报告；ICOL/SFILL 不铸 ID；ITERX/COLDX 轴归档 |
| R16-D | `cursor/r16-d-adaptation-sixteenth-pass-83a1` | 已合入专属分支（仅 `R16-D.md`）。无新排除 ID；eval 地板复核 3.47–3.62 ms；payload 形态轴 L/H/O/σ/P 归档 |
| R16-E | `cursor/r16-e-learning-sixteenth-pass-83a1` | 已合入专属分支（仅 `R16-E.md`）。无新排除 ID；SLICE-CPU 复核 19.0–22.0 µs/run；累积状态 + payload 形态轴归档；S13-B-1 重开条件量化未触发 |
| R16-F | `cursor/r16-f-experiments-sixteenth-pass-83a1` | 已合入专属分支（仅 `R16-F.md`）。无新排除 ID；全实验锚点复核 118.5–133.5 ms；剖析归属 + A 越线点 + 编码格归档 |
| R16-G | `cursor/r16-g-runtime-sixteenth-pass-83a1` | 已合入专属分支（仅 `R16-G.md`）。无新排除 ID；计算顶复核 0.288–0.294 ms vs I/O 96.2–105.0 ms；SYSCENSUS 轴归档；digest 第七次逐位相同 |
| R16-H | `cursor/r16-h-eval-sixteenth-pass-83a1` | 已合入专属分支（仅 `R16-H.md`）。无新排除 ID；热层默认复核 9.35–9.78 µs/run；载荷基底 × 形态格归档；PATH_RE 回溯拒列不铸 ID |
| R16-I | `cursor/r16-i-cli-sixteenth-pass-83a1` | 已合入专属分支（仅 `R16-I.md`）。无新排除 ID；custom−builtin 复核 +22.5~+51.7 ms；八连空；flowchart 抽测格 + 增量采样归因归档 |
| R16-J | `cursor/r16-j-persist-sixteenth-pass-83a1` | 已合入专属分支（仅 `R16-J.md`）。无新排除 ID；I/O 地板复核；SYSCENSUS-J + payload 形态轴归档；切片关闭 |
| R17-A | `cursor/r17-a-tracking-seventeenth-pass-83a1` | 已合入专属分支（仅 `R17-A.md`）。无新排除 ID；预算复核 65–74 µs/run；事件表组成 + 冷进程预算轴归档 |
| R17-B | `cursor/r17-b-live-routing-seventeenth-pass-83a1` | 已合入专属分支（仅 `R17-B.md`）。无新排除 ID；天花板复核 M=2 9.1–11.4 / M=10 19.0–23.8 ms/eval；拒绝路径 + 逐任务尾部分布轴归档 |
| R17-C | `cursor/r17-c-offline-routing-seventeenth-pass-83a1` | 已合入专属分支（仅 `R17-C.md`）。无新排除 ID；生产中位复核 657.6–689.3 ms；NSQRT/PMV/OSTZ 不铸 ID；APC floor 再锚定 |
| R17-D | `cursor/r17-d-adaptation-seventeenth-pass-83a1` | 已合入专属分支（仅 `R17-D.md`）。无新排除 ID；eval 地板复核 3.57–4.00 ms；fail-closed 拒绝路径普查归档 |
| R17-E | `cursor/r17-e-learning-seventeenth-pass-83a1` | 已合入专属分支（仅 `R17-E.md`）。无新排除 ID；SLICE-CPU 复核 18.5–20.2 µs/run；拒绝路径 + 逐事件类价表归档 |
| R17-F | `cursor/r17-f-experiments-seventeenth-pass-83a1` | 已合入专属分支（仅 `R17-F.md`）。无新排除 ID；全实验锚点复核 120.5–129.6 ms；拒绝路径 + 冷进程 + 操作粒度尾部轴归档 |
| R17-G | `cursor/r17-g-runtime-seventeenth-pass-83a1` | 已合入专属分支（仅 `R17-G.md`）。无新排除 ID；计算顶复核 0.287–0.295 vs I/O 95.8–98.4 ms；存储后端分解 + 拒绝路径定价归档 |
| R17-H | `cursor/r17-h-eval-seventeenth-pass-83a1` | 已合入专属分支（仅 `R17-H.md`）。无新排除 ID；热层默认复核 9.17–10.18 µs/run；fail-closed 拒绝路径普查归档 |
| R17-I | `cursor/r17-i-cli-seventeenth-pass-83a1` | 已合入专属分支（仅 `R17-I.md`）。无新排除 ID；custom−builtin 复核 +21.8~+47.3 ms；九连空；拒绝路径定价归档 |
| R17-J | `cursor/r17-j-persist-seventeenth-pass-83a1` | 已合入专属分支（仅 `R17-J.md`）。无新排除 ID；I/O 地板复核；拒绝路径普查 + 冷进程预算归档；切片关闭 |
| R18-A | `cursor/r18-a-tracking-eighteenth-pass-83a1` | 已合入专属分支（仅 `R18-A.md`）。无新排除 ID；预算复核 64–74 µs/run；skip-path 组成 + 拒绝终点普查归档 |
| R18-B | `cursor/r18-b-live-routing-eighteenth-pass-83a1` | 已合入专属分支（仅 `R18-B.md`）。无新排除 ID；天花板复核 M=2 8.9–9.4 / M=10 18.3–18.5 ms/eval；字宽/CJK + 有限 RoutingLimits 轴归档 |
| R18-C | `cursor/r18-c-offline-routing-eighteenth-pass-83a1` | 已合入专属分支（仅 `R18-C.md`）。无新排除 ID；生产中位复核 656.7–672.4 ms；TAILG/REJX 不铸 ID；APC floor 再锚定 |
| R18-D | `cursor/r18-d-adaptation-eighteenth-pass-83a1` | 已合入专属分支（仅 `R18-D.md`）。无新排除 ID；eval 地板复核 3.75–4.14 ms；锁定事务组成账目归档 |
| R18-E | `cursor/r18-e-learning-eighteenth-pass-83a1` | 已合入专属分支（仅 `R18-E.md`）。无新排除 ID；SLICE-CPU 复核 12.4–14.8 / 种子复现 18.8–19.4 µs/run；冷层 + 字宽轴归档 |
| R18-F | `cursor/r18-f-experiments-eighteenth-pass-83a1` | 已合入专属分支（仅 `R18-F.md`）。无新排除 ID；全实验锚点复核 120.8–129.1 ms；对齐分数剂量 + 热进程税 + halt 后定价归档 |
| R18-G | `cursor/r18-g-runtime-eighteenth-pass-83a1` | 已合入专属分支（仅 `R18-G.md`）。无新排除 ID；计算顶复核 0.290–0.299 vs I/O 94.4–110.7 ms；BYTESHAPE 轴归档 |
| R18-H | `cursor/r18-h-eval-eighteenth-pass-83a1` | 已合入专属分支（仅 `R18-H.md`）。无新排除 ID；热层默认复核 9.40–9.55 µs/run；休眠分支普查归档 |
| R18-I | `cursor/r18-i-cli-eighteenth-pass-83a1` | 已合入专属分支（仅 `R18-I.md`）。无新排除 ID；custom−builtin 复核 +25.0~+55.2 ms；十连空；children-spec 基数轴归档 |
| R18-J | `cursor/r18-j-persist-eighteenth-pass-83a1` | 已合入专属分支（仅 `R18-J.md`）。无新排除 ID；I/O 地板复核；skip-path 普查 + 整命令组成账目归档；切片关闭 |
| R19-A | `cursor/r19-a-tracking-nineteenth-pass-83a1` | 已合入专属分支（仅 `R19-A.md`）。无新排除 ID；预算复核 66–75 µs/run；重投递面 + wait_user 指令类归档 |
| R19-B | `cursor/r19-b-live-routing-nineteenth-pass-83a1` | 已合入专属分支（仅 `R19-B.md`）。无新排除 ID；天花板复核 M=2 8.9–9.3 / M=10 18.4–20.4 ms/eval；比较器第三腿 + 目录基数 M 轴归档 |
| R19-C | `cursor/r19-c-offline-routing-nineteenth-pass-83a1` | 已合入专属分支（仅 `R19-C.md`）。无新排除 ID；生产中位复核 667.5–675.1 ms；FITQ 不铸 ID；APC floor 再锚定 |
| R19-D | `cursor/r19-d-adaptation-nineteenth-pass-83a1` | 已合入专属分支（仅 `R19-D.md`）。无新排除 ID；eval 地板复核 3.85–4.22 ms；冷进程模块图组成轴归档 |
| R19-E | `cursor/r19-e-learning-nineteenth-pass-83a1` | 已合入专属分支（仅 `R19-E.md`）。无新排除 ID；SLICE-CPU 复核 19.0–20.6 / 种子复现 18.5–19.7 µs/run；表示保真 + 事件排序轴归档 |
| R19-F | `cursor/r19-f-experiments-nineteenth-pass-83a1` | 已合入专属分支（仅 `R19-F.md`）。无新排除 ID；全实验锚点复核 120.4–130.2 ms；runner 家族（canary）轴归档 |
| R19-G | `cursor/r19-g-runtime-nineteenth-pass-83a1` | 已合入专属分支（仅 `R19-G.md`）。无新排除 ID；计算顶复核 0.292–0.296 vs I/O 94.9–108.2 ms；NAMESHAPE 轴归档 |
| R19-H | `cursor/r19-h-eval-nineteenth-pass-83a1` | 已合入专属分支（仅 `R19-H.md`）。无新排除 ID；热层默认复核 9.53–10.39 µs/run；执行史剂量/平稳性普查归档 |
| R19-I | `cursor/r19-i-cli-nineteenth-pass-83a1` | 已合入专属分支（仅 `R19-I.md`）。无新排除 ID；custom−builtin 复核 +47.6~+48.4 / +23.9~+26.4 ms；十一连空；配置输入基数 E×P×K 轴归档 |
| R19-J | `cursor/r19-j-persist-nineteenth-pass-83a1` | 已合入专属分支（仅 `R19-J.md`）。无新排除 ID；I/O 地板复核；重投递剂量 + 输入次序置换归档；切片关闭 |
| R20-A | `cursor/r20-a-tracking-twentieth-pass-83a1` | 已合入专属分支（仅 `R20-A.md`）。无新排除 ID；预算复核 64–80 µs/run；openMinors 基数 M + 多轮驻留链面归档 |
| R20-B | `cursor/r20-b-live-routing-twentieth-pass-83a1` | 已合入专属分支（仅 `R20-B.md`）。无新排除 ID；天花板复核 M=2 9.03–10.73 / M=10 17.97–24.28 ms/eval；objective 长度 L 轴 + 能力约束 K×W 双线性轴归档 |
| R20-C | `cursor/r20-c-offline-routing-twentieth-pass-83a1` | 已合入专属分支（仅 `R20-C.md`）。无新排除 ID；生产中位复核 661.4–671.5 ms；SCALEX 不铸 ID；APC floor 再锚定 |
| R20-D | `cursor/r20-d-adaptation-twentieth-pass-83a1` | 已合入专属分支（仅 `R20-D.md`）。无新排除 ID；eval 地板复核 3.75–3.97 ms；多进程并发面归档 |
| R20-E | `cursor/r20-e-learning-twentieth-pass-83a1` | 已合入专属分支（仅 `R20-E.md`）。无新排除 ID；SLICE-CPU 复核 17.7–19.3 / 种子 18.7–18.9 µs/run；bandit 多进程并发面归档 |
| R20-F | `cursor/r20-f-experiments-twentieth-pass-83a1` | 已合入专属分支（仅 `R20-F.md`）。无新排除 ID；全实验锚点复核 117.5–129.1 ms；outcome 流组成轴归档 |
| R20-G | `cursor/r20-g-runtime-twentieth-pass-83a1` | 已合入专属分支（仅 `R20-G.md`）。无新排除 ID；计算顶复核 0.287–0.294 vs I/O 91.3–99.9 ms；XPROC 不铸 ID；digest 第十一次逐位相同 |
| R20-H | `cursor/r20-h-eval-twentieth-pass-83a1` | 已合入专属分支（仅 `R20-H.md`）。无新排除 ID；热层默认复核 9.24–9.36 µs/run；环境进程态压力普查归档 |
| R20-I | `cursor/r20-i-cli-twentieth-pass-83a1` | 已合入专属分支（仅 `R20-I.md`）。无新排除 ID；custom−builtin 复核 +46.5/+24.0 / +48.8/+24.1 ms；十二连空；累积遥测态 N 轴归档 |
| R20-J | `cursor/r20-j-persist-twentieth-pass-83a1` | 已合入专属分支（仅 `R20-J.md`）。无新排除 ID；I/O 地板复核；输入类组成剂量面归档；切片关闭 |
| R21-A | `cursor/r21-a-tracking-twenty-first-pass-83a1` | 已合入专属分支（仅 `R21-A.md`）。无新排除 ID；预算复核 66–95 µs/run；H 输入面归档 |
| R21-B | `cursor/r21-b-live-routing-twenty-first-pass-83a1` | 已合入专属分支（仅 `R21-B.md`）。无新排除 ID；天花板复核 M=2 9.08–9.39 / M=10 17.79–18.36 ms/eval；public-prior 快照形状轴归档 |
| R21-C | `cursor/r21-c-offline-routing-twenty-first-pass-83a1` | 已合入专属分支（仅 `R21-C.md`）。无新排除 ID；生产中位复核 661.9–674.2 ms；YMIX 不铸 ID；APC floor 再锚定 |
| R21-D | `cursor/r21-d-adaptation-twenty-first-pass-83a1` | 已合入专属分支（仅 `R21-D.md`）。无新排除 ID；eval 地板复核 3.84–4.19 ms；状态增长方向面归档 |
| R21-E | `cursor/r21-e-learning-twenty-first-pass-83a1` | 已合入专属分支（仅 `R21-E.md`）。无新排除 ID；SLICE-CPU 复核 15.8–16.9 / cmp20 17.8–18.5 µs/run；标识符几何轴归档 |
| R21-F | `cursor/r21-f-experiments-twenty-first-pass-83a1` | 已合入专属分支（仅 `R21-F.md`）。无新排除 ID；全实验锚点复核 120.7–129.8 ms；时钟输入面归档 |
| R21-G | `cursor/r21-g-runtime-twenty-first-pass-83a1` | 已合入专属分支（仅 `R21-G.md`）。无新排除 ID；计算顶复核 0.282–0.290 vs I/O 89.6–96.2 ms；SCHEDWIN 不铸 ID；digest 第十二次逐位相同 |
| R21-H | `cursor/r21-h-eval-twenty-first-pass-83a1` | 已合入专属分支（仅 `R21-H.md`）。无新排除 ID；热层默认复核 9.14–9.53 µs/run；异步调度面普查归档 |
| R21-I | `cursor/r21-i-cli-twenty-first-pass-83a1` | 已合入专属分支（仅 `R21-I.md`）。无新排除 ID；custom−builtin 复核 +43.4/+25.4 / +52.2/+23.9 ms；十三连空；flowchart 平面输入规模轴归档 |
| R21-J | `cursor/r21-j-persist-twenty-first-pass-83a1` | 已合入专属分支（仅 `R21-J.md`）。无新排除 ID；I/O 地板复核；KFAN 不铸 ID；切片关闭 |
| R22-A | `cursor/r22-a-tracking-twenty-second-pass-83a1` | 已合入专属分支（仅 `R22-A.md`）。无新排除 ID；预算复核 65–80 µs/run；公开导出普查 + 分析-隔离面归档 |
| R22-B | `cursor/r22-b-live-routing-twenty-second-pass-83a1` | 已合入专属分支（仅 `R22-B.md`）。无新排除 ID；天花板复核 M=2 8.79–9.13 / M=10 17.63–18.12 ms/eval；标识符几何轴（G×T，平坦）归档 |
| R22-C | `cursor/r22-c-offline-routing-twenty-second-pass-83a1` | 已合入专属分支（仅 `R22-C.md`）。无新排除 ID；生产中位复核 665.7–669.6 ms；SEEDX 不铸 ID；APC floor 再锚定 |
| R22-D | `cursor/r22-d-adaptation-twenty-second-pass-83a1` | 已合入专属分支（仅 `R22-D.md`）。无新排除 ID；eval 地板复核 3.73–3.76 ms；公开导出流普查归档 |
| R22-E | `cursor/r22-e-learning-twenty-second-pass-83a1` | 已合入专属分支（仅 `R22-E.md`）。无新排除 ID；SLICE-CPU 复核 18.6–19.7 µs/run（种子互换复现 R21-E / R20-E 带）；NVG 不铸 ID |
| R22-F | `cursor/r22-f-experiments-twenty-second-pass-83a1` | 已合入专属分支（仅 `R22-F.md`）。无新排除 ID；全实验锚点复核 120.5–131.8 ms；membership-topology 组成轴归档 |
| R22-G | `cursor/r22-g-runtime-twenty-second-pass-83a1` | 已合入专属分支（仅 `R22-G.md`）。无新排除 ID；计算顶复核 0.286–0.289 vs I/O 94.0–97.2 ms；TERMCLASS 不铸 ID；digest 第十三次逐位相同 |
| R22-H | `cursor/r22-h-eval-twenty-second-pass-83a1` | 已合入专属分支（仅 `R22-H.md`）。无新排除 ID；热层默认复核 9.18–9.27 µs/run；调用上下文几何普查归档 |
| R22-I | `cursor/r22-i-cli-twenty-second-pass-83a1` | 已合入专属分支（仅 `R22-I.md`）。无新排除 ID；custom−builtin 复核 +47.6/+23.0 / +44.8/+25.7 / +45.4/+22.9 ms；十五连空；run-record 回读平面归档 |
| R22-J | `cursor/r22-j-persist-twenty-second-pass-83a1` | 已合入专属分支（仅 `R22-J.md`）。无新排除 ID；I/O 地板复核；SHAPEK 不铸 ID；切片关闭 |
| R23-A | `cursor/r23-a-tracking-twenty-third-pass-83a1` | 已合入专属分支（仅 `R23-A.md`）。无新排除 ID；预算复核 66–78 µs/run；G×E 自耦合 run ledger 归档 |
| R23-B | `cursor/r23-b-live-routing-twenty-third-pass-83a1` | 已合入专属分支（仅 `R23-B.md`）。无新排除 ID；天花板复核 M=2 9.20–9.48 / M=10 17.64–18.52 ms/eval；batch arrangement 几何轴（平坦）归档 |
| R23-C | `cursor/r23-c-offline-routing-twenty-third-pass-83a1` | 已合入专属分支（仅 `R23-C.md`）。无新排除 ID；生产中位复核 660.7–665.4 ms；ORDX 不铸 ID；APC floor 再锚定 |
| R23-D | `cursor/r23-d-adaptation-twenty-third-pass-83a1` | 已合入专属分支（仅 `R23-D.md`）。无新排除 ID；eval 地板复核 3.39–3.74 ms；两相提升时间交错 / P-dose 归档 |
| R23-E | `cursor/r23-e-learning-twenty-third-pass-83a1` | 已合入专属分支（仅 `R23-E.md`）。无新排除 ID；SLICE-CPU 复核 18.1–18.6 µs/run；GS（过滤命运 × 分组几何）归档 |
| R23-F | `cursor/r23-f-experiments-twenty-third-pass-83a1` | 已合入专属分支（仅 `R23-F.md`）。无新排除 ID；全实验锚点复核 120.6–129.7 ms；plan count-field 联合面归档 |
| R23-G | `cursor/r23-g-runtime-twenty-third-pass-83a1` | 已合入专属分支（仅 `R23-G.md`）。无新排除 ID；计算顶复核 0.285–0.292 vs I/O 85.1–98.0 ms；CKMIX 不铸 ID；digest 第十四次逐位相同 |
| R23-H | `cursor/r23-h-eval-twenty-third-pass-83a1` | 已合入专属分支（仅 `R23-H.md`）。无新排除 ID；热层默认复核 9.32–9.65 µs/run；rubric-registry membership-mix 普查归档 |
| R23-I | `cursor/r23-i-cli-twenty-third-pass-83a1` | 已合入专属分支（仅 `R23-I.md`）。无新排除 ID；custom−builtin 复核 +42.9/+22.0 / +53.5/+25.4 / +39.2/+21.6 ms；十六连空；`.pi/` 可观测树输入面归档 |
| R23-J | `cursor/r23-j-persist-twenty-third-pass-83a1` | 已合入专属分支（仅 `R23-J.md`）。无新排除 ID；I/O 地板复核；CALLB 不铸 ID；切片关闭 |
| R24-A | `cursor/r24-a-tracking-twenty-fourth-pass-83a1` | 已合入专属分支（仅 `R24-A.md`）。无新排除 ID；预算复核 67–84 µs/run；residual input-face list-dimension 普查归档 |
| R24-B | `cursor/r24-b-live-routing-twenty-fourth-pass-83a1` | 已合入专属分支（仅 `R24-B.md`）。无新排除 ID；天花板复核 M=2 8.75–9.07 / M=10 17.78–17.95 ms/eval；M=1 catalog collapse 配置态格归档 |
| R24-C | `cursor/r24-c-offline-routing-twenty-fourth-pass-83a1` | 已合入专属分支（仅 `R24-C.md`）。无新排除 ID；生产中位复核 658.9–675.3 ms；OCCX 不铸 ID；APC floor 再锚定 |
| R24-D | `cursor/r24-d-adaptation-twenty-fourth-pass-83a1` | 已合入专属分支（仅 `R24-D.md`）。无新排除 ID；eval 地板复核 3.55–3.68 ms；approval-authority face 归档 |
| R24-E | `cursor/r24-e-learning-twenty-fourth-pass-83a1` | 已合入专属分支（仅 `R24-E.md`）。无新排除 ID；SLICE-CPU 本轮构成 16.1–17.5 µs/run；JB 不铸 ID |
| R24-F | `cursor/r24-f-experiments-twenty-fourth-pass-83a1` | 已合入专属分支（仅 `R24-F.md`）。无新排除 ID；锚点复核 r5f 120.1–121.3 / r6f 126.9；state serialization-boundary provenance face 归档 |
| R24-G | `cursor/r24-g-runtime-twenty-fourth-pass-83a1` | 已合入专属分支（仅 `R24-G.md`）。无新排除 ID；计算顶复核 0.289–0.312 vs I/O 92.3–111.6 ms；RUNLIM 不铸 ID；digest 第十五次逐位相同 |
| R24-H | `cursor/r24-h-eval-twenty-fourth-pass-83a1` | 已合入专属分支（仅 `R24-H.md`）。无新排除 ID；热层默认复核 9.37–9.76 µs/run；operand-residency census 归档 |
| R24-I | `cursor/r24-i-cli-twenty-fourth-pass-83a1` | 已合入专属分支（仅 `R24-I.md`）。无新排除 ID；custom−builtin 复核 +44.2/+26.5 / +48.0/+25.9 / +48.7/+16.3 ms；adaptation-state coordinate 归档 |
| R24-J | `cursor/r24-j-persist-twenty-fourth-pass-83a1` | 已合入专属分支（仅 `R24-J.md`）。无新排除 ID；I/O 地板复核；VALCLASS 不铸 ID；切片关闭 |
| R25-A | `cursor/r25-a-tracking-twenty-fifth-pass-83a1` | 已合入专属分支（仅 `R25-A.md`）。无新排除 ID；预算复核 ~69–89 µs/run；value-domain / string content-class census 归档 |
| R25-B | `cursor/r25-b-live-routing-twenty-fifth-pass-83a1` | 已合入专属分支（仅 `R25-B.md`）。无新排除 ID；天花板复核 M=2 9.06–9.29 / M=10 17.92–18.80 ms/eval；task-face optional-field presence topology 归档 |
| R25-C | `cursor/r25-c-offline-routing-twenty-fifth-pass-83a1` | 已合入专属分支（仅 `R25-C.md`）。无新排除 ID；生产中位复核 663.2–681.5 ms；AGEX 不铸 ID；APC floor 再锚定 |
| R25-D | `cursor/r25-d-adaptation-twenty-fifth-pass-83a1` | 已合入专属分支（仅 `R25-D.md`）。无新排除 ID；eval 地板复核 3.55–4.28 ms；identity-coordinate face 归档 |
| R25-E | `cursor/r25-e-learning-twenty-fifth-pass-83a1` | 已合入专属分支（仅 `R25-E.md`）。无新排除 ID；SLICE-CPU 复核 14.9–15.7 µs/run；CG 不铸 ID |
| R25-F | `cursor/r25-f-experiments-twenty-fifth-pass-83a1` | 已合入专属分支（仅 `R25-F.md`）。无新排除 ID；锚点复核 r5f 121.25/130.67 / r6f 122.93 / r7f 127.56/130.12；plan-header identity-geometry face 归档 |
| R25-G | `cursor/r25-g-runtime-twenty-fifth-pass-83a1` | 已合入专属分支（仅 `R25-G.md`）。无新排除 ID；计算顶复核 0.290–0.304 vs I/O 94.3–103.2 ms；injection command-kind face 归档；digest 第十六次逐位相同 |
| R25-H | `cursor/r25-h-eval-twenty-fifth-pass-83a1` | 已合入专属分支（仅 `R25-H.md`）。无新排除 ID；热层默认复核 9.31–10.25 µs/run；consumer-stage string-representation census 归档 |
| R25-I | `cursor/r25-i-cli-twenty-fifth-pass-83a1` | 已合入专属分支（仅 `R25-I.md`）。无新排除 ID；custom−builtin 复核 +37.0~+50.7 / +20.9~+25.8 / +45.7~+53.1 / +23.6~+25.6 / +42.3~+52.5 / +15.1~+24.9 ms；process-environment coordinate 归档 |
| R25-J | `cursor/r25-j-persist-twenty-fifth-pass-83a1` | 已合入专属分支（仅 `R25-J.md`）。无新排除 ID；I/O 地板复核；COTARG 不铸 ID；切片关闭 |
| R26-A | `cursor/r26-a-tracking-twenty-sixth-pass-83a1` | 已合入专属分支（仅 `R26-A.md`）。无新排除 ID；预算复核 ~69–84 µs/run；collation-locale face 归档 |
| R26-B | `cursor/r26-b-live-routing-twenty-sixth-pass-83a1` | 已合入专属分支（仅 `R26-B.md`）。无新排除 ID；天花板复核 M=2 ~9.1–9.3 / M=10 ~17.9–18.8 ms/eval；privacy / provider-policy constraint-leg face 归档 |
| R26-C | `cursor/r26-c-offline-routing-twenty-sixth-pass-83a1` | 已合入专属分支（仅 `R26-C.md`）。无新排除 ID；生产中位复核 663.0–669.9 ms；PRICEX 不铸 ID；APC floor 再锚定 |
| R26-D | `cursor/r26-d-adaptation-twenty-sixth-pass-83a1` | 已合入专属分支（仅 `R26-D.md`）。无新排除 ID；eval 地板复核与 3.55–4.28 ms 带重叠；injection-seam default-arm face 归档 |
| R26-E | `cursor/r26-e-learning-twenty-sixth-pass-83a1` | 已合入专属分支（仅 `R26-E.md`）。无新排除 ID；SLICE-CPU 复核 14.7–15.2 µs/run；RTL 不铸 ID |
| R26-F | `cursor/r26-f-experiments-twenty-sixth-pass-83a1` | 已合入专属分支（仅 `R26-F.md`）。无新排除 ID；锚点复核 r5f 119.27/120.95 / r6f 119.37 / r7f 128.85/128.88；input storage-state face 归档 |
| R26-G | `cursor/r26-g-runtime-twenty-sixth-pass-83a1` | 已合入专属分支（仅 `R26-G.md`）。无新排除 ID；计算顶复核 0.286–0.305 vs I/O 90.7–96.9 ms；edge condition-kind face 归档；digest 第十七次逐位相同 |
| R26-H | `cursor/r26-h-eval-twenty-sixth-pass-83a1` | 已合入专属分支（仅 `R26-H.md`）。无新排除 ID；热层默认复核 9.22–9.75 µs/run；consumer-stage operand-realm face 归档 |
| R26-I | `cursor/r26-i-cli-twenty-sixth-pass-83a1` | 已合入专属分支（仅 `R26-I.md`）。无新排除 ID；custom−builtin 复核 +43.4~+61.7 / +24.0~+27.8 / +48.5~+52.6 / +25.7~+36.9 / +47.1~+49.2 / +12.0~+28.2 ms；argv surface-form face 归档 |
| R26-J | `cursor/r26-j-persist-twenty-sixth-pass-83a1` | 已合入专属分支（仅 `R26-J.md`）。无新排除 ID；I/O 地板复核；DELINV 不铸 ID；切片关闭 |
| R27-A | `cursor/r27-a-tracking-twenty-seventh-pass-83a1` | 已合入专属分支（仅 `R27-A.md`）。无新排除 ID；预算复核 ~68–84 µs/run；scalar numeric value-class face 归档 |
| R27-B | `cursor/r27-b-live-routing-twenty-seventh-pass-83a1` | 已合入专属分支（仅 `R27-B.md`）。无新排除 ID；天花板复核 M=2 8.62–9.24 / M=10 17.27–17.73 ms/eval；batch-cardinality bottom + prelude intercept face 归档 |
| R27-C | `cursor/r27-c-offline-routing-twenty-seventh-pass-83a1` | 已合入专属分支（仅 `R27-C.md`）。无新排除 ID；生产中位复核 660.6–668.4 ms；PROBX 不铸 ID；APC floor 再锚定 |
| R27-D | `cursor/r27-d-adaptation-twenty-seventh-pass-83a1` | 已合入专属分支（仅 `R27-D.md`）。无新排除 ID；eval 地板复核 3.62–3.70 ms；policy-content tree-geometry face 归档 |
| R27-E | `cursor/r27-e-learning-twenty-seventh-pass-83a1` | 已合入专属分支（仅 `R27-E.md`）。无新排除 ID；SLICE-CPU 复核 14.7–15.2 µs/run（cmp25 逐位）；RVL 不铸 ID；最坏 30.4–31.9 µs/run |
| R27-F | `cursor/r27-f-experiments-twenty-seventh-pass-83a1` | 已合入专属分支（仅 `R27-F.md`）。无新排除 ID；锚点复核 r5f 129.98/120.26 / r6f 117.92 / r7f 129.62/131.86；input access-path mechanics face 归档 |
| R27-G | `cursor/r27-g-runtime-twenty-seventh-pass-83a1` | 已合入专属分支（仅 `R27-G.md`）。无新排除 ID；计算顶复核 0.294–0.297 vs I/O 99.8–119.8 ms；digest 第十八次逐位；join-policy face 归档 |
| R27-H | `cursor/r27-h-eval-twenty-seventh-pass-83a1` | 已合入专属分支（仅 `R27-H.md`）。无新排除 ID；热层复核 9005–9493 ns；execution-substrate face 归档；切片关闭 |
| R27-I | `cursor/r27-i-cli-twenty-seventh-pass-83a1` | 已合入专属分支（仅 `R27-I.md`）。无新排除 ID；custom−builtin 复核 +43.0~+46.0 / +22.4~+24.1 / +45.8~+52.6 / +23.2~+25.9 / +42.3~+46.8 / +18.2~+20.6 ms；process output-channel disposition face 归档 |
| R27-J | `cursor/r27-j-persist-twenty-seventh-pass-83a1` | 已合入专属分支（仅 `R27-J.md`）。无新排除 ID；I/O 地板复核 preferences 125.8–310.6 / 422.0–533.8、jsonl 60.7–70.2 / 232.2–324.7 µs；SIDEC 不铸 ID |
| R28-A | `cursor/r28-a-tracking-twenty-eighth-pass-83a1` | 已合入专属分支（仅 `R28-A.md`）。无新排除 ID；预算复核 12.2–15.2 µs/gate ⇒ ~61–76 µs/run；input key-set geometry face 归档 |
| R28-B | `cursor/r28-b-live-routing-twenty-eighth-pass-83a1` | 已合入专属分支（仅 `R28-B.md`）。无新排除 ID；天花板复核 M=2 8.84–9.53 / M=10 17.62–18.13 ms/eval；catalog-face row-arrangement (permutation) face 归档 |
| R28-C | `cursor/r28-c-offline-routing-twenty-eighth-pass-83a1` | 已合入专属分支（仅 `R28-C.md`）。无新排除 ID；中位复核 660.9–667.5 ms；sink=7.309；C-slice numeric-kernel execution-substrate instantiation 归档（face 名归 R27-H） |
| R28-D | `cursor/r28-d-adaptation-twenty-eighth-pass-83a1` | 已合入专属分支（仅 `R28-D.md`）。无新排除 ID；eval 地板复核 3.27–3.44 ms；contents-store population face 归档 |
| R28-E | `cursor/r28-e-learning-twenty-eighth-pass-83a1` | 已合入专属分支（仅 `R28-E.md`）。无新排除 ID；SLICE-CPU 复核 15.0–15.2 µs/run；proposal write-path termination-leg face / **PWL** 归档 |
| R28-F | `cursor/r28-f-experiments-twenty-eighth-pass-83a1` | 已合入专属分支（仅 `R28-F.md`）。无新排除 ID；锚点复核 r5f 121.48/120.18 / r6f 122.81 / r7f 127.06/126.63；boundary call-protocol face 归档 |
| R28-G | `cursor/r28-g-runtime-twenty-eighth-pass-83a1` | 已合入专属分支（仅 `R28-G.md`）。无新排除 ID；计算顶复核 0.286–0.289 vs I/O 89.4–103.1 ms；digest 第十九次逐位；decision-gate resolution face 归档 |
| R28-H | `cursor/r28-h-eval-twenty-eighth-pass-83a1` | 已合入专属分支（仅 `R28-H.md`）。无新排除 ID；热层复核 9006–9483 ns；boundary argument-slot materialization face 归档 |
| R28-I | `cursor/r28-i-cli-twenty-eighth-pass-83a1` | 已合入专属分支（仅 `R28-I.md`）。无新排除 ID；custom−builtin 复核 +46.4~+48.0 / +23.1~+26.3 / +45.9~+50.3 / +23.1~+25.7 / +41.0~+45.9 / +16.5~+24.6 ms；invocation-identity / path-referent spelling × cwd face 归档 |
| R28-J | `cursor/r28-j-persist-twenty-eighth-pass-83a1` | 已合入专属分支（仅 `R28-J.md`）。无新排除 ID；I/O 地板复核 preferences 124.4–218.3 / 402.4–516.2、jsonl 60.3–68.7 / 250.0–354.7 µs；ZREP 不铸 ID |
| R29-A | `cursor/r29-a-tracking-twenty-ninth-pass-83a1` | 已合入专属分支（仅 `R29-A.md`）。无新排除 ID；预算复核 12.2–15.7 µs/gate ⇒ ~61–80 µs/run；input reference-identity / aliasing-topology face 归档 |
| R29-B | `cursor/r29-b-live-routing-twenty-ninth-pass-83a1` | 已合入专属分支（仅 `R29-B.md`）。无新排除 ID；天花板复核 M=2 8.70–9.30 / M=10 17.99–18.73 ms/eval；learned-policy container face 归档 |
| R29-C | `cursor/r29-c-offline-routing-twenty-ninth-pass-83a1` | 已合入专属分支（仅 `R29-C.md`）。无新排除 ID；中位复核 657.1–659.6 ms；sink=7.309；PAIRX 不铸 ID |
| R29-D | `cursor/r29-d-adaptation-twenty-ninth-pass-83a1` | 已合入专属分支（仅 `R29-D.md`）。无新排除 ID；eval 地板复核 S0c 3.45–3.67 / 同进程 3.20–3.33 ms；registry-record string-list payload face 归档 |
| R29-E | `cursor/r29-e-learning-twenty-ninth-pass-83a1` | 已合入专属分支（仅 `R29-E.md`）。无新排除 ID；SLICE-CPU 复核 14.7–15.2 µs/run；wall-clock sampling topology / timestamp-provenance face 归档 |
| R29-F | `cursor/r29-f-experiments-twenty-ninth-pass-83a1` | 已合入专属分支（仅 `R29-F.md`）。无新排除 ID；锚点复核 r5f 120.28/121.96 / r6f 121.05 / r7f 131.29/126.76；boundary output-retention / superseded-snapshot liveness face 归档 |
| R29-G | `cursor/r29-g-runtime-twenty-ninth-pass-83a1` | 已合入专属分支（仅 `R29-G.md`）。无新排除 ID；计算顶复核 0.290–0.298 vs I/O 93.7–97.5 ms；digest 第二十次逐位；M2 supervised-engine adjudication lattice 归档 |
| R29-H | `cursor/r29-h-eval-twenty-ninth-pass-83a1` | 已合入专属分支（仅 `R29-H.md`）。无新排除 ID；热层复核 8889–9147 ns；coverage-relation incidence topology face 归档 |
| R29-I | `cursor/r29-i-cli-twenty-ninth-pass-83a1` | 已合入专属分支（仅 `R29-I.md`）。无新排除 ID；custom−builtin 复核 children +44.0~+50.5 / +22.6~+25.7、track +44.0~+53.2 / +22.5~+25.6、flowchart-flat64 +41.9~+42.8 / +18.5~+21.7 ms；input-file JSON serialization-form face 归档 |
| R29-J | `cursor/r29-j-persist-twenty-ninth-pass-83a1` | 已合入专属分支（仅 `R29-J.md`）。无新排除 ID；I/O 地板复核 preferences 146.5–234.7 / 431.5–542.6、jsonl 59.3–68.1 / 212.8–319.8 µs；CSPELL 不铸 ID |
| R30-A | `cursor/r30-a-tracking-thirtieth-pass-83a1` | 已合入专属分支（仅 `R30-A.md`）。无新排除 ID；预算复核 12.8–15.3 µs/gate ⇒ ~64–77 µs/run；call-stream ordering / dispatch-history face 归档 |
| R30-B | `cursor/r30-b-live-routing-thirtieth-pass-83a1` | 已合入专属分支（仅 `R30-B.md`）。无新排除 ID；天花板复核 M=2 8.87–9.13 / M=10 17.34–18.23 ms/eval；scale-cube second-order interaction face 归档 |
| R30-C | `cursor/r30-c-offline-routing-thirtieth-pass-83a1` | 已合入专属分支（仅 `R30-C.md`）。无新排除 ID；中位复核 658.7–663.0 ms；sink=7.309；REPRX 不铸 ID |
| R30-D | `cursor/r30-d-adaptation-thirtieth-pass-83a1` | 已合入专属分支（仅 `R30-D.md`）。无新排除 ID；eval 地板复核 S0c 3.29–3.66 / 同进程 3.13–3.27 ms；approval-profile constraint-list geometry face 归档 |
| R30-E | `cursor/r30-e-learning-thirtieth-pass-83a1` | 已合入专属分支（仅 `R30-E.md`）。无新排除 ID；SLICE-CPU 复核 14.7–15.2 µs/run；async suspension-point topology / per-run suspension-manifest face 归档 |
| R30-F | `cursor/r30-f-experiments-thirtieth-pass-83a1` | 已合入专属分支（仅 `R30-F.md`）。无新排除 ID；锚点复核 r5f 119.31/120.55/121.20、r6f 120.71/121.34/121.90、r7f 128.31/130.42/132.69；boundary output-consumption / snapshot-readback topology face 归档 |
| R30-G | `cursor/r30-g-runtime-thirtieth-pass-83a1` | 已合入专属分支（仅 `R30-G.md`）。无新排除 ID；计算顶复核 0.292–0.296 vs I/O 93.9–97.1 ms；digest 第二十一次逐位；M1 parent-run child-scheduling lattice 归档 |
| R30-H | `cursor/r30-h-eval-thirtieth-pass-83a1` | 已合入专属分支（仅 `R30-H.md`）。无新排除 ID；热层复核 9178–9647 ns；provenance-resolution pathway face 归档 |
| R31-A | `cursor/r31-a-tracking-thirty-first-pass-83a1` | 已合入专属分支（仅 `R31-A.md`）。无新排除 ID；预算复核 13.6–16.9 µs/gate ⇒ ~68–84 µs/run；injected-callable plane 门停放未铸 |
| R31-D | `cursor/r31-d-adaptation-thirty-first-pass-83a1` | 已合入专属分支（仅 `R31-D.md`）。无新排除 ID；eval 地板复核 S0c 3.38–3.64 ms；drift-monitor analysis-window 配置平面归入 R22-D 属地 |
| R31-F | `cursor/r31-f-experiments-thirty-first-pass-83a1` | 已合入专属分支（仅 `R31-F.md`）。无新排除 ID；锚点复核 r5f 119.97/121.51/122.37、r6f 119.70/119.52/117.11、r7f 127.81/129.00/130.55；故障通道处置残格按分解归属未铸 |
| R31-I | `cursor/r31-i-cli-thirty-first-pass-83a1` | 已合入专属分支（仅 `R31-I.md`）。无新排除 ID；custom−builtin 复核 children +44.6~+46.0 / +21.4~+24.1、track +48.0~+55.4 / +24.0~+27.9、flowchart-flat64 +42.2~+50.2 / +15.3~+19.1 ms；CLI 进程边界门扉闭合审计未铸 |
| R32-B | `cursor/r32-b-live-routing-thirty-second-pass-83a1` | 已合入专属分支（仅 `R32-B.md`）。无新排除 ID；天花板复核 M=2 9.04–9.62 / M=10 17.84–18.43 ms/eval；闭合稳定性审计 54/54 未铸 |
| R32-E | `cursor/r32-e-learning-thirty-second-pass-83a1` | 已合入专属分支（仅 `R32-E.md`）。无新排除 ID；SLICE-CPU cmp25 14.8–15.3 µs/run；两项换名检查拒列未铸 |
| R32-I | `cursor/r32-i-cli-thirty-second-pass-83a1` | 已合入专属分支（仅 `R32-I.md`）。无新排除 ID；custom−builtin 复核 children +45.5~+50.1 / +23.1~+24.8、track +48.3~+55.3 / +21.8~+26.1、flowchart-flat64 +42.4~+45.4 / +16.8~+19.4 ms；五项换名检查拒列未铸 |
| R30-I | `cursor/r30-i-cli-thirtieth-pass-83a1` | 已合入专属分支（仅 `R30-I.md`）。无新排除 ID；custom−builtin 复核 children +38.2~+49.4 / +22.7~+26.4、track +46.0~+52.9 / +22.4~+26.1、flowchart-flat64 +42.5~+51.0 / +15.2~+20.3 ms；process-lifetime temporal-segment topology face 归档 |
| R31-B | `cursor/r31-b-live-routing-thirty-first-pass-83a1` | 已合入专属分支（仅 `R31-B.md`）。无新排除 ID；天花板复核 M=2 9.25–11.46 / M=10 21.02–23.17 ms/eval；面格闭合审计六扇门停放未铸 |
| R31-E | `cursor/r31-e-learning-thirty-first-pass-83a1` | 已合入专属分支（仅 `R31-E.md`）。无新排除 ID；SLICE-CPU cmp25 14.9–15.3 µs vs 14.7–15.2；I/O text-codec topology / per-run transcode-byte manifest face 归档（不铸 ID） |
| R31-H | `cursor/r31-h-eval-thirty-first-pass-83a1` | 已合入专属分支（仅 `R31-H.md`）。无新排除 ID；热层复核 8889/9350/8996 ns；边界参数平面四门分解/停驻未铸 |
| R32-A | `cursor/r32-a-tracking-thirty-second-pass-83a1` | 已合入专属分支（仅 `R32-A.md`）。无新排除 ID；预算复核 13.5–15.7 µs/gate ⇒ ~68–79 µs/run；重开条件哨兵审计 F12a–d 未铸 |
| R32-C | `cursor/r32-c-offline-routing-thirty-second-pass-83a1` | 已合入专属分支（仅 `R32-C.md`）。无新排除 ID；中位复核 659.0–662.0 ms；组合天花板 20.2–26.6 < 35；sink=7.309 |
| R32-G | `cursor/r32-g-runtime-thirty-second-pass-83a1` | 已合入专属分支（仅 `R32-G.md`）。无新排除 ID；计算顶复核 0.289–0.293 vs I/O 88.2–93.5 ms；digest 第二十三次逐位；门扉闭合未铸 |
| R32-J | `cursor/r32-j-persist-thirty-second-pass-83a1` | 已合入专属分支（仅 `R32-J.md`）。无新排除 ID；I/O 地板复核 preferences 124.0–230.7 / 406.9–528.9、jsonl 59.7–66.8 / 199.9–296.8 µs；六残余坐标未过三合取未铸 |
| R33-A | `cursor/r33-a-tracking-thirty-third-pass-83a1` | 已合入专属分支（仅 `R33-A.md`）。无新排除 ID；预算复核 11.8–17.6 µs/gate ⇒ ~59–88 µs/run；A 账本 44/44 闭合稳定性卫生未铸 |
| R33-B | `cursor/r33-b-live-routing-thirty-third-pass-83a1` | 已合入专属分支（仅 `R33-B.md`）。无新排除 ID；天花板复核 M=2 10.75–11.73 / M=10 21.48–23.74 ms/eval（主机偏置）；一处从未点名站点拒列未铸 |
| R33-F | `cursor/r33-f-experiments-thirty-third-pass-83a1` | 已合入专属分支（仅 `R33-F.md`）。无新排除 ID；锚点复核 r5f 124.47/118.96/129.73、r6f 122.96/122.14/121.70、r7f 127.78/127.36/127.07；四项换名检查拒列未铸 |
| R33-C | `cursor/r33-c-offline-routing-thirty-third-pass-83a1` | 已合入专属分支（仅 `R33-C.md`）。无新排除 ID；中位复核 670.2–708.7 ms（主机干扰窗）；组合天花板 25.7–31.7 < 35；sink=7.309 |
| R33-G | `cursor/r33-g-runtime-thirty-third-pass-83a1` | 已合入专属分支（仅 `R33-G.md`）。无新排除 ID；计算顶复核 0.302–0.309 vs I/O 90.4–104.4 ms；digest 第二十四次逐位；三项换名检查拒列未铸 |
| R33-D | `cursor/r33-d-adaptation-thirty-third-pass-83a1` | 已合入专属分支（仅 `R33-D.md`）。无新排除 ID；eval 地板复核 S0c 3.42–3.67 ms；三项换名检查拒列未铸 |
| R33-E | `cursor/r33-e-learning-thirty-third-pass-83a1` | 已合入专属分支（仅 `R33-E.md`）。无新排除 ID；SLICE-CPU cmp25 15.1–15.3 µs/run；零新站点级换名记录；S8-E-1 仍恰 3 处 |
| R33-H | `cursor/r33-h-eval-thirty-third-pass-83a1` | 已合入专属分支（仅 `R33-H.md`）。无新排除 ID；默认链复核 8991/8820/8843 ns；零新站点级换名记录 |
| R33-I | `cursor/r33-i-cli-thirty-third-pass-83a1` | 已合入专属分支（仅 `R33-I.md`）。无新排除 ID；custom−builtin 复核 children +42.0~+45.9 / +22.8~+25.8、track +48.2~+52.8 / +23.6~+24.3、flowchart-flat64 +39.4~+46.8 / +16.8~+19.9；两项换名检查拒列未铸 |
| R33-J | `cursor/r33-j-persist-thirty-third-pass-83a1` | 已合入专属分支（仅 `R33-J.md`）。无新排除 ID；I/O 地板复核 preferences 134.8–237.4 / 408.0–541.2、jsonl 59.2–66.8 / 204.4–350.2 µs；五项换名检查拒列未铸 |
| R34-A | `cursor/r34-a-tracking-thirty-fourth-pass-83a1` | 已合入专属分支（仅 `R34-A.md`）。无新排除 ID；预算复核 12.8–15.2 µs/gate ⇒ ~64–76 µs/run；三项换名检查拒列未铸 |
| R34-D | `cursor/r34-d-adaptation-thirty-fourth-pass-83a1` | 已合入专属分支（仅 `R34-D.md`）。无新排除 ID；eval 地板复核 S0c 3.65–4.70 ms（主机偏高）；三项换名检查拒列未铸 |
| R34-G | `cursor/r34-g-runtime-thirty-fourth-pass-83a1` | 已派出 |
| R34-B | `cursor/r34-b-live-routing-thirty-fourth-pass-83a1` | 已合入专属分支（仅 `R34-B.md`）。无新排除 ID；预算复核 M=2 8.5–9.5 / M=10 17–19（主机偏快）；零新 ID / 零新面 |
| R34-C | `cursor/r34-c-offline-routing-thirty-fourth-pass-83a1` | 已合入专属分支（仅 `R34-C.md`）。无新排除 ID；中位复核 682.1–682.5；组合天花板 28.7–31.6 < 35；sink=7.309 |
| R34-E | `cursor/r34-e-learning-thirty-fourth-pass-83a1` | 已合入专属分支（仅 `R34-E.md`）。无新排除 ID；SLICE-CPU cmp25 14.8–15.1（主机偏快）；一项换名检查拒列未铸；S8-E-1 仍恰 3 处 |
| R34-H | `cursor/r34-h-eval-thirty-fourth-pass-83a1` | 已派出 |
| R34-F | `cursor/r34-f-experiments-thirty-fourth-pass-83a1` | 已合入专属分支（仅 `R34-F.md`）。无新排除 ID；锚点复核 r5f 119.21/119.51/128.96、r6f 121.63/123.10/121.90、r7f 129.72/130.28/128.18；三项换名检查拒列未铸 |
| R34-I | `cursor/r34-i-cli-thirty-fourth-pass-83a1` | 已派出 |
| R30-J | `cursor/r30-j-persist-thirtieth-pass-83a1` | 已合入专属分支（仅 `R30-J.md`）。无新排除 ID；I/O 地板复核 preferences 134.2–238.7 / 415.9–525.4、jsonl 稳态 61.6–66.9 / 220.1–305.4 µs；LINKTOP 不铸 ID |
| R31-C | `cursor/r31-c-offline-routing-thirty-first-pass-83a1` | 已合入专属分支（仅 `R31-C.md`）。无新排除 ID；中位复核 658.1–660.1 ms；APC 20.7–25.1 < 35；sink=7.309；BINDX 不铸 ID |
| R31-G | `cursor/r31-g-runtime-thirty-first-pass-83a1` | 已合入专属分支（仅 `R31-G.md`）。无新排除 ID；计算顶复核 0.284–0.293 vs I/O 92.6–105.2 ms；digest 第二十二次逐位；全切片门扉闭合审计未铸 |
| R31-J | `cursor/r31-j-persist-thirty-first-pass-83a1` | 已合入专属分支（仅 `R31-J.md`）。无新排除 ID；I/O 地板复核 preferences 127.8–248.9 / 410.5–540.0、jsonl 59.1–65.7 / 253.3–304.6 µs；MODEX 不铸 ID |
| R32-D | `cursor/r32-d-adaptation-thirty-second-pass-83a1` | 已合入专属分支（仅 `R32-D.md`）。无新排除 ID；eval 地板复核 S0c 3.37–3.60 ms；元闭合 35 行无一松动未铸 |
| R32-F | `cursor/r32-f-experiments-thirty-second-pass-83a1` | 已合入专属分支（仅 `R32-F.md`）。无新排除 ID；锚点复核 r5f 119.46/120.27/125.31、r6f 124.25/119.48/119.70、r7f 125.62/129.79/129.50；面格无一松动未铸 |
| R32-H | `cursor/r32-h-eval-thirty-second-pass-83a1` | 已合入专属分支（仅 `R32-H.md`）。无新排除 ID；默认链复核 9100/9108/8975 ns；三项换名检查拒列未铸 |

## 合并策略

- 仅合并：相关测试绿、未改阈值/权限/数据面契约、报告写清理论+仿真与排除 ID 的分支。
- 冲突或业务逻辑落地由修复子代理处理（约定修复 slug：`claude-opus-5-thinking-high-fast`），父代理不直改业务代码。
- 多个小区互不重叠的绿分支可一次快进/octopus 合入专属分支。
