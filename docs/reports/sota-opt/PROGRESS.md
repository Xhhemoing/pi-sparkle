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
| 16 | 第 1–3 波进行中 | 7 / 10（A–D 已合入；E/F 运行中；G 本波派出） | claude-fable-5-thinking-xhigh | [round-16/PLAN.md](./round-16/PLAN.md) |

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
| 2 | R16-D 自优化、R16-E 学习、R16-F 实验 | D 完成已合入；E/F 运行中 |
| 3 | R16-G 运行时/图 | G 本波派出 |

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
| R16-E | `cursor/r16-e-learning-sixteenth-pass-83a1` | 已派出 |
| R16-F | `cursor/r16-f-experiments-sixteenth-pass-83a1` | 已派出 |
| R16-G | `cursor/r16-g-runtime-sixteenth-pass-83a1` | 已派出 |

## 合并策略

- 仅合并：相关测试绿、未改阈值/权限/数据面契约、报告写清理论+仿真与排除 ID 的分支。
- 冲突或业务逻辑落地由修复子代理处理（约定修复 slug：`claude-opus-5-thinking-high-fast`），父代理不直改业务代码。
- 多个小区互不重叠的绿分支可一次快进/octopus 合入专属分支。
