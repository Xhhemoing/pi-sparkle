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
| 2 | 第 1–2 波进行中 | 10（2 在跑 / 2 完成 / 6 排队） | claude-fable-5-thinking-xhigh | [round-02/PLAN.md](./round-02/PLAN.md) |

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
| 1 | R2-A 跟踪、R2-B live 路由、R2-C 离线路由 | A 完成已合入；B/C 在跑 |
| 2 | R2-D 自优化、R2-E 学习 | D 完成已合入；E 本波派出 |

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

## 合并策略

- 仅合并：相关测试绿、未改阈值/权限/数据面契约、报告写清理论+仿真与排除 ID 的分支。
- 冲突或业务逻辑落地由修复子代理处理（约定修复 slug：`claude-opus-5-thinking-high-fast`），父代理不直改业务代码。
- 多个小区互不重叠的绿分支可一次快进/octopus 合入专属分支。
