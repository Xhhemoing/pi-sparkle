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
| 5 | 第 2 波进行中 | 5 / 10（A/B 完成；C/D 在跑；E 本波派出） | claude-fable-5-thinking-xhigh | [round-05/PLAN.md](./round-05/PLAN.md) |

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
| 1 | R5-A 跟踪门控、R5-B live 路由、R5-C 离线路由 | A/B 完成已合入；C 在跑 |
| 2 | R5-D 自优化、R5-E 学习 | D 在跑；E 本波派出 |

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
| R5-D | `cursor/r5-d-adaptation-fifth-pass-83a1` | 已派出 |
| R5-E | `cursor/r5-e-learning-fifth-pass-83a1` | 已派出 |
| R5-C | `cursor/r5-c-offline-routing-fifth-pass-83a1` | 已派出 |

## 合并策略

- 仅合并：相关测试绿、未改阈值/权限/数据面契约、报告写清理论+仿真与排除 ID 的分支。
- 冲突或业务逻辑落地由修复子代理处理（约定修复 slug：`claude-opus-5-thinking-high-fast`），父代理不直改业务代码。
- 多个小区互不重叠的绿分支可一次快进/octopus 合入专属分支。
