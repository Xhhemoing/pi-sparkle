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
| 1 | 第 3 波进行中 | 10（2 在跑 / 6 完成 / 2 排队） | claude-fable-5-thinking-xhigh | [round-01/PLAN.md](./round-01/PLAN.md) |

### Round 1 波次

| 波 | 区 | 状态 |
| --- | --- | --- |
| 1 | R1-A 跟踪门控、R1-F 实验门控、R1-J cluster/privacy/episode | A/F/J 完成已合入 |
| 2 | R1-B live 路由、R1-C 离线路由、R1-D 自优化 | B/D 完成已合入；C 在跑 |
| 3 | R1-E 学习、R1-G 运行时/图、R1-H 评价/需求 | E 完成已合入；G 在跑；H 本波派出 |
| 4 | R1-I CLI/适配器 | 排队（第 4 波不满 3，空位留给第 2 轮） |

## 待合并 PR / 分支

| 来源 | 分支 | 处置 |
| --- | --- | --- |
| R1-A | `cursor/sota-r1-a-tracking-1174` | 已合入专属分支（仅 `R1-A.md`） |
| R1-F | `cursor/r1-f-experiments-sota-4ac9` | 已合入专属分支（S1-F 代码 + 报告 + 仿真） |
| R1-J | `cursor/r1j-data-plane-opt-d508` | 已合入专属分支（J1 代码 + 报告 + 仿真） |
| R1-B | `cursor/r1-b-live-routing-slice-c9b5` | 已合入专属分支（仅 `R1-B.md`） |
| R1-D | `cursor/r1-d-adaptation-opt-41f0` | 已合入专属分支（仅 `R1-D.md`） |
| R1-E | `cursor/r1e-learning-slice-5cd3` | 已合入专属分支（仅 `R1-E.md`） |

## 合并策略

- 仅合并：相关测试绿、未改阈值/权限/数据面契约、报告写清理论+仿真与排除 ID 的分支。
- 冲突或业务逻辑落地由修复子代理处理（约定修复 slug：`claude-opus-5-thinking-high-fast`），父代理不直改业务代码。
- 多个小区互不重叠的绿分支可一次快进/octopus 合入专属分支。
