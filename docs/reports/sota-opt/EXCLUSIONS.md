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
- J1 `evaluatePreferenceLoop` 每主体增量折叠 + O(1) 墓碑撤销（见 round-01/R1-J.md）
- main 上已合入：ModelRouter 纯 live selection、catalog-invariant assignment plan、live route request 进共享约束矩阵

## 本战役新增

由各轮子代理追加，格式：`S<轮次>-<区>-<n>`。

| ID | 方案 | 原因 |
| --- | --- | --- |
| S1-A-1 | gate-apply `currentGateStatus` 反向扫描早退 | 等价但 E=41 每 run 省 318ns，噪声 |
| S1-A-2 | from-child 复用外层 prescore | 噪声 + 公开注入口风险 |
| S1-A-3 | human-score matchAll 早退/惰性「分」匹配 | 单句输入噪声 |
| S1-A-4 | prescore 循环融合 + Set 化 | 等价但实测更慢 |
| S1-A-5 | roller confirmedDecisions 过滤 Set 化 | 个位数，实测持平 |
| S1-A-6 | gates shouldEscalateMinors 单遍融合 | minors≤6，亚噪声 |
| S1-A-7 | turn.ts anomalyCodes 别名省略拷贝 | 可观察对象身份改变，零收益 |
| S1-A-8 | types evidenceWeight/枚举 Map/Set | 表长≤9，噪声 |
| S1-A-9 | nextTrackingSeq 反向扫描 | 不等价：乱序 seq 发散 |
| S1-F-1 | gatedComparisonReport strip-retry 复用首报告仅换 claims | 可证同值，但仓内调用方使 retry 对改进声明不可达 |
| S1-F-2 | replayPolicy 消除 selected 的 propensityFor 二次调用 | 公开扩展点调用次数可观测；噪声级 |
| S1-F-3 | HoldoutVault 审计追加拷贝改可变 push | readonly 契约（X4-2 同类） |
| S1-F-4 | calibrateSoftThreshold 三遍并单遍 | 一次性 informational，噪声 |
| S1-F-5 | comparison-report `Array.from(families.entries())` 直接迭代 | X3-2 同类噪声 |
| S1-F-6 | validateExperimentPlan 返回 population Set 复用 | 公开 void 签名变更 |
| S1-F-7 | canary reversibleScopes Set 化 | scope 个位数 |
| S1-F-8 | recordExperimentOutcome 查重/成本累加 Set/增量化 | 与 X1-1/X0-4/X3-3 同类 |
| S1-J-1 | preferences `rebuildViews` 增量化（按 pair 局部更新） | 未受影响 view 的 `lastUpdated` 可见时间戳改变 |
| S1-J-2 | preferences `applyObservation` recurrence 计数器化 | 同路径已是 O(N)；派生索引同步风险 |
| S1-J-3 | episode `reduceEpisodeEvents` runIds Set 化 | 个位级；数据面强调区 |
| S1-J-4 | cluster 役播 role→agent 目录索引 | P 小常数；mailbox 数据面 |
| S1-J-5 | track/loop `assignments.find` 换 Map | C≤~6，live 面 |
| S1-J-6 | context/index dirty×generated 前缀匹配索引化 | 一次性构建，噪声级 |
| S1-J-7 | context/packet 首个 `omissions.sort` 冗余移除 | k 小，常数噪声 |
| S1-B-1 | analyze-task 去重 HIGH_RISK_RE + DEPLOY_RE 提升常量 | 等价但 ns 级噪声 |
| S1-B-2 | analyze-task `long` 换手写换行计数早退 | 现实短单行，亚噪声 |
| S1-B-3 | familyOf 同分支布尔短路重排 | 最大现实规模仍噪声 |
| S1-B-4 | decideLiveCascade find+findIndex 合并单扫 | T≤10，噪声 |
| S1-B-5 | cheapFirstTiers 冗余 spread 移除 | 一次分配，噪声 |
| S1-B-6 | routeR0 高风险过滤 Map 化 | 等价但 M=10 实测更慢 |
| S1-B-7 | validateInput 复杂度数组字面量提升 | V8 已优化，零收益 |
| S1-B-8 | assignPlanned allowedIds 防御拷贝省略 | 跨 assignment 共享引用，身份改变 |
| S1-D-1 | registry addVersion 拷贝追加改可变 push | 调用方持有数组可观察增长 |
| S1-D-2 | candidatesFor identity 二级索引 | C=8 实测更慢 |
| S1-D-3 | reconstructPromotion 反向早退 | 无生产调用方，ns 级 |
| S1-D-4 | eval-routing catalogCost 换 Map | 真实 M=2，全程 <0.1µs |
| S1-D-5 | registry Array.from(values()) 改直接迭代 | 常数噪声 |
| S1-D-6 | paretoFront 换排序/分治 skyline | n 个位数，收益上界亚微秒 |
| S1-D-7 | promoteWithRegistry 外层 evalReport 去重 | 双故障抛错次序可观察发散 |
| S1-D-8 | adaptation 小表 includes 换 Set/Map | 表长≤10，噪声 |
| S1-D-9 | parseRoutingPolicyContent 双 JSON.parse 消除 | 需改公开签名 + 噪声 |
| S1-E-1 | collectSignalsFromEvents 两遍扫描合并单遍 | 迟到 PROJECT_DISCOVERED / 重路由绑错模型 |
| S1-E-2 | JUDGE_DECISION role/family 双重 Map.get 去重 | ±ns 抖动，亚噪声 |
| S1-E-3 | extractAssistant 字符串折叠改 parts+join | 现实 6 段 ~230ns |
| S1-E-4 | persistSignals evidenceIds.filter 去重 | 被 appendFeedback I/O 支配 |
| S1-E-5 | ingestSubagentDirectory Promise.all 并行读 | 非复杂度下降；fd 风险 |
| S1-E-6 | diagnose 组内多遍融合单遍 | 真实规模亚噪声，10× 更慢 |
| S1-E-7 | attributeToBoundary 排序换单遍 min | test-only，无生产调用方 |
| S1-E-8 | detectRepeatedPatterns keys 预取 | 小规模更慢；无生产调用方 |
