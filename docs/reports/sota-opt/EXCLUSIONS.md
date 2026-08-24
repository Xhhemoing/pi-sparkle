# 全局排除表

后续轮次禁止再提案下列方案，除非先写出推翻的理论 + 仿真证据。

规格强制双路必须都留：Beta LCB vs 正态 LCB；offline-logit vs 概率可加启发式。

## 三线 Iter0–4 继承

| ID | 方案 | 原因 |
| --- | --- | --- |
| X0-1 | 声称 Outcome-supported / 关 Checkpoint F | ADR-005 |
| X0-2 | 给 `planTaskTopology` 接线 | 功能工作，非保行为优化 |
| X0-3 | 合并 auto-loop 与 from-episode 候选创建主体 | 保存时机语义不同 |
| X0-4 | 改 applyTrackingGate/nextTrackingSeq 公开签名为增量索引 | 接口破坏 |
| X0-5 | 合并各文件私有 asRecord/asArray | 错误消息被测试断言 |
| X0-6 | 缓存 human-score 正则 | /g lastIndex 状态风险 |
| X0-7 | 改任何版本化阈值 | 规格冻结 |
| X0-8 | adaptation↔learning 拆第三包 | 公开导入路径 |
| X0-9 | 实现 ADR-006 | 未立项 |
| X0-10 | 降 minSamples / 取消稀疏回退 / 选最高噪声 LCB | 违规格 |
| X0-11 | 删 Beta 或正态 LCB 一路 | 规格强制双路 |
| X1-1 | WeakMap/模块级隐藏缓存 | 陈旧缓存风险 |
| X1-2 | 第二公开入口 routeR1Prepared | 平行实现 |
| X1-3 | Newton/减迭代/闭式近似替代 80 次二分 | 非逐位一致 |
| X1-4 | cheaperEstimate/costOf/tierIndex 换 Map | M≤10 噪声级 |
| X1-5 | 合并 shadow-compare 与 r1-shadow-report | 契约不同 |
| X1-6 | 跨 episode 记忆化整个 routeR1 决策 | 等价键不安全 |
| X2-1 | eta/dot 按支撑求和 | ±0.0 号位不保逐位 |
| X2-2 | APC 按 (row,column) 记忆化 | 隐藏状态/收益不足 |
| X2-3 | 解析 delta/Newton/Cholesky 改数值路径 | 非逐位一致 |
| X2-4 | gate-apply 单遍合并不改签名 | 已否决 |
| X2-5 | drift monitor 基线缓存 | 已否决 |
| X2-6 | patterns 相似度对键记忆化 | 已否决 |
| X3-1 | assign.ts catalog 重过滤换索引 | live + M≤10 |
| X3-2 | comparison-report 六遍改单遍 | 常数噪声 |
| X3-3 | canary/shadow restore 增量 | fail-closed 契约 |
| X3-4 | lnGamma Lanczos 系数模块级提升 | 无可测收益 |
| X3-5 | propensity 双 reduce 并入主循环 | 噪声级 |
| X4-1 | M6-T3 shadow runner RNG 重放/restore 增量 | fail-closed O(n) |
| X4-2 | bandit shadow decisions 追加拷贝改可变 | readonly 公开契约 |
| X4-3 | percentile50 quickselect | 一次性聚合 |
| X4-4 | cost-calibration 分组索引 | M≤10 一次性加载 |
| X4-5 | public-prior 别名索引 | 榜单几十行 |
| X4-6 | Kahn queue.shift 指针化 | 任务图几十级 |
| X4-7 | ledger isDuplicateFact Set 化 | 每轮个位数 |
| X4-8 | flowchart-supervisor propagate/computeStatus 增量 | live 面几十节点 |
| X4-9 | ownership changeSet Set 化 | 一次分配级 |

## 已落地（不要重做）

- gatedComparisonReport 去重；promotion-rules 拆环；ensureRoutingBaseline；routeR1 groupObservationsByKey
- A2 prepared 观测索引；B1 per-key 估计备忘录；C1 lnBeta 提升
- D1 offline-logit design 索引；E2 APC on-prob 提升；F1 IRLS 支撑列表；G1 prob-add 父格复用
- H1 replayPolicy exclusions → Set
- S1-F M6-T3 shadow/canary restore population 成员判断 → Set（fail-closed 全量重校验保留，O(A×P)→O(P+A)/次；见 round-01/R1-F.md）
- main 上已合入：ModelRouter 纯 live selection、catalog-invariant assignment plan、live route request 进共享约束矩阵

## 本战役新增

由各轮子代理追加，格式：`S<轮次>-<区>-<n>`。

| ID | 方案 | 原因 |
| --- | --- | --- |
| S1-F-1 | gatedComparisonReport strip-retry 复用首报告仅换 claims | 可证同值，但仓内调用方（eval-routing `[]`、r1-shadow-report 预 strip）使 retry 对改进声明不可达，收益不可测 |
| S1-F-2 | replayPolicy 消除 selected 的 propensityFor 二次调用 | RoutingPolicy 公开扩展点，调用次数/顺序可观测；1/(E+1) 噪声级 |
| S1-F-3 | HoldoutVault 审计追加拷贝改可变 push | audit 数组外持，readonly 契约（X4-2 同类） |
| S1-F-4 | calibrateSoftThreshold 三遍并单遍 | 常数 3→1，冻结集一次性 informational（X3-2/X3-5 同类） |
| S1-F-5 | comparison-report `Array.from(families.entries())` 直接迭代 | 省一次分配，X3-2 同类噪声 |
| S1-F-6 | validateExperimentPlan 返回 population Set 复用 | 公开 void 签名变更（X0-4 同类） |
| S1-F-7 | canary reversibleScopes Set 化 | scope 个位数（X1-4 同类） |
| S1-F-8 | recordExperimentOutcome 查重/成本累加 Set/增量化 | 单点查询建 Set 同 O(n)；缓存＝X1-1；增量字段＝X0-4；每调用重算为 X3-3 同类 |
