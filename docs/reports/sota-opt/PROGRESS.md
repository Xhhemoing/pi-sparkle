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
| 8 | 第 2 波进行中 | 5 / 10（A/B 完成已合入；C/D 运行中；E 本波派出） | claude-fable-5-thinking-xhigh | [round-08/PLAN.md](./round-08/PLAN.md) |

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
| 1 | R8-A 跟踪门控、R8-B live 路由、R8-C 离线路由 | A/B 完成已合入；C 运行中 |
| 2 | R8-D 自优化、R8-E 学习 | D 运行中；E 本波派出 |

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
| R8-C | `cursor/r8-c-offline-routing-eighth-pass-83a1` | 已派出 |
| R8-D | `cursor/r8-d-adaptation-eighth-pass-83a1` | 已派出 |
| R8-E | `cursor/r8-e-learning-eighth-pass-83a1` | 已派出 |

## 合并策略

- 仅合并：相关测试绿、未改阈值/权限/数据面契约、报告写清理论+仿真与排除 ID 的分支。
- 冲突或业务逻辑落地由修复子代理处理（约定修复 slug：`claude-opus-5-thinking-high-fast`），父代理不直改业务代码。
- 多个小区互不重叠的绿分支可一次快进/octopus 合入专属分支。
