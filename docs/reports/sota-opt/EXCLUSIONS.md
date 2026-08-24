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
- S1-C offline-logit：bootstrap 工件复用 + APC copy-derive + IRLS 缓冲每 fit 一次分配（见 round-01/R1-C.md）
- S1-I `run --children` 复用 `smartChildPlan` 已校准 live 目录（见 round-01/R1-I.md）
- S2-C offline-logit IRLS 规范键 eta/mu 去重（见 round-02/R2-C.md）
- S3-C offline-logit IRLS 累加循环单位乘法消除（0/1 设计下 `w*xi[a]*xi[b]`/`w*xi[a]*z` 逐位等于 `w`/`w*z`；见 round-03/R3-C.md）
- S4-C `solveSymmetric` 消元/回代循环不变量引用提升（`m[row]`/`m[col]`/`x[col]` 提升为局部引用；浮点运算集合与顺序不变；见 round-04/R4-C.md）
- S4-I CLI/`auth-session` 在点用处惰性加载 Pi 运行时子树（`--executor pi` 与 auth 函数体内 `await import(runtime)`；见 round-04/R4-I.md）
- S5-C `solveSymmetric` 消元 k 循环按 4 顺序展开（含顺序余数；浮点运算集合与顺序不变；见 round-05/R5-C.md）
- S5-F `assertUniqueNonEmpty` 单探针去重（`add` + size 计数器代替 `has`+`add`；first-fault 与消息逐位不变；见 round-05/R5-F.md）
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
| S1-C-1 | APC off 对共享 on 向量原位置零+恢复 | 别名可变危险；边际在噪声内 |
| S1-C-2 | mergePreparedR1Observations 跨索引播种备忘录 | merge 路径仓内不可达 |
| S1-C-3 | merge overlay/持久索引免 Map 拷贝 | 公开 ReadonlyMap 形状 |
| S1-C-4 | estimateFingerprint 提升/缓存 | 模块缓存或公开面变更 |
| S1-C-5 | prepareR1Observations 过滤+分组单遍融合 | 小数组融合可更慢 |
| S1-C-6 | prob-add kappaS 与主循环 cell 双算合一 | 常数噪声 |
| S1-C-7 | prob-add betaInterval 按 (n,mean) 记忆化 | 亚 ms + 缓存状态 |
| S1-C-8 | propensity 三遍改单遍计数 | 常数遍数噪声 |
| S1-C-9 | bandit/shadow 微观分配 | arms 个位数 |
| S1-C-10 | r1 微观常数 / request spread 省略 | M≤10 或对象身份改变 |
| S1-G-1 | EventStore/EpisodeStore readAll 增量缓存 | 跨进程磁盘事实源 + fail-closed 读校验 |
| S1-G-2 | persistLedger 全量 snapshot 改轻量访问器 | 需扩公开接口 + 噪声 |
| S1-G-3 | EVENT_TYPES includes→Set | 占 validateEvent 1–1.5% |
| S1-G-4 | validateFlowchart join 邻接 Set | live 面几十节点 |
| S1-G-5 | snapshot 聚合 clone | 实测负优化 |
| S1-G-6 | coordinator splice/filter Set 化 | 个位~十位 |
| S1-G-7 | nodeTaskId find→Map | 仅审批路径，N 几十 |
| S1-G-8 | ConcurrencyGate/LeaseRegistry 指针化 | X4-6 同类 |
| S1-G-9 | setRuntime 原地变异 | 别名安全边界 |
| S1-I-1 | flowchart 路径未校准构建去重 | ~190µs 噪声 |
| S1-I-2 | runCommand 与 createExecutor providers.json 双读 | ~60µs 噪声 |
| S1-I-3 | smartChildPlan assignments.find 换 Map | children 个位数 |
| S1-I-4 | models 子命令多次重读 | 一次性配置命令 |
| S1-I-5 | auth status --all 每 provider createPiRuntime 提升 | 亚感知 + 凭据面 |
| S1-I-6 | parseCliErrorJson reverse 换反向索引 | ns 级噪声 |
| S1-I-7 | buildInvocation += 换 parts+join | 实测慢 6.4× |
| S1-I-8 | resolveListedModel 自定义路径先构建再 find | 每命令个位数次 |
| S1-H-1 | checkCoverageGate Object.keys 提升为循环外 Set | C=2 实测更慢 |
| S1-H-2 | assertCoverageAllowsStart 跳过 gated 合同拷贝 | ~80ns/run |
| S1-H-3 | heuristic namedTargets/shouldScout 去重 | 单句噪声 |
| S1-H-4 | assertAuthorityGrounding grounding.find 换 Map | 重复 authorityIndex 发散 |
| S1-H-5 | applyPrecedence 双 filter + conflict.ids Set | ns/run 噪声 |
| S1-H-6 | reconcileReviews 三遍 filter 融合 | n=2 亚噪声 |
| S1-H-7 | createEvaluationRecord 聚合谓词融合 | test-only |
| S1-H-8 | registerRubric copy-on-write 改就地写 | 污染 DEFAULT_REGISTRY |
| S1-H-9 | changeSetsEqual 数组长度早退 | 集合相等语义发散 |
| S2-A-1 | roller 无截断快路径 | ~12µs/episode，低于落地线 |
| S2-A-2 | from-child evidenceRefsOf 双算去重 | 143ns；别名或改签名 |
| S2-A-3 | claimed-verification 复用 prescore 维度 | 2.3ns + 跨函数耦合 |
| S2-A-4 | gate-apply spread+push 换 concat | 实测慢 3.7× |
| S2-A-5 | hashAssessment dimensions 冗余 spread 移除 | 173ns 噪声 |
| S2-A-6 | from-child dimensions 三遍融合 | 10.9ns 亚噪声 |
| S2-D-1 | registry restore versionsByKey 批量重建 | V 个位数，~250ns |
| S2-D-2 | rollback CAS 后冗余 versionsById.get 消除 | 9–18ns；fail-closed 兜底 |
| S2-D-3 | eval-routing 双 parseTaskId 消除 | E=200 约 16.5µs |
| S2-D-4 | 双 assignTasks 共享 analyzeTask | ~116µs 低于否决线 + 需改公开签名 |
| S2-D-5 | monitor snapshot 跳过已验证观测重复校验 | ~615ns；防御纵深 |
| S2-B-1 | assignPlanned learned 路径第二次防御拷贝省略 | 回放批 202–240µs；依赖未承诺新鲜性 |
| S2-B-2 | createModelRouter 跳过二次 catalogModel | ~150ns/批；检测通道撞排除 |
| S2-B-3 | routeR0 高风险过滤内联 Set（S1-B-6 姊妹） | 拖慢常见路径或 ns 级 |
| S2-B-4 | assignTasks 全目录 plan 特化 | 每批 300–950ns + 切片外改动 |
| S2-C-1 | on-prob 站点规范键去重 | 2.5–3.6ms 噪声 |
| S2-C-2 | APC off 点积虚零列 | 上界即 S1-C-1 噪声带 |
| S2-C-3 | IRLS delta map+reduce 换融合循环 | 分配级抖动 |
| S2-C-4 | APC 逐列扫描反转为按行累加 | 个位 ms 上界 |
| S2-C-5 | bootstrap 采样循环融合塌缩检查 | 亚噪声 |
| S2-E-1 | auto-loop 无变更路径跳过 saveAdaptationRegistry | 亚 ms + 侵蚀 X0-3 保存时机 |
| S2-E-2 | proposeRoutingFromRoutedEvents 三遍扫描融合 | E=41 仅 114–142ns |
| S2-E-3 | bandit 弃置 createBanditState 消除 | 305–331ns |
| S2-E-4 | bandit 无变更跳写 | 亚 ms；持久化契约 |
| S2-E-5 | truncate 流式 401 早退 | 现实短摘要实测更慢 |
| S2-E-6 | optimizedPolicy filter+map 融合 | n=10 实测更慢 |
| S2-E-7 | TASK_RESULT binding 双拷贝合一 | ~260ns；契约实施点 |
| S2-F-1 | shadowDecisionAt mulberry32 闭式 O(1) 跳转 | 逐位精确但仅占全实验 ~1% |
| S2-F-2 | replayPolicy 双 manifestHash 消除 | 无生产调用方 |
| S2-F-3 | assertIsolatedOutput workspace 去重 | 90µs 低于否决线 |
| S2-F-4 | assign 复用 restore 已建 Set | 全实验仅 ~0.8% |
| S2-F-5 | splitFromManifest 尾部双验消除 | fail-closed 防御纵深 |
| S2-F-6 | pairedEvaluationCard 多遍融合 | N=40 仅 13µs |
| S2-G-1 | leaseReadyNodes 循环内 computeStatus 缓存 | O(N²) 上界仅数 µs |
| S2-G-2 | failurePathCompletedGraph DFS 去重 | 链式失败恢复终态发散 |
| S2-G-3 | approvedActionIds 改可变 push | ~15ns/审批 |
| S2-G-4 | expandTaskTransition 8×8 BFS 预计算表 | ~480ns/变迁 |
| S2-G-5 | ChildCoordinator 跨轮复用 | 确定性 id 流发散 |
| S2-G-6 | inspectRun 两遍扫描合并 | ~1µs/次 |
| S2-G-7 | joinStatus 三遍计数融合 | ~16ns |
| S2-G-8 | LeaseRegistry Date.parse 缓存 | 全 run ~35µs |
| S2-H-1 | buildContractCandidate 无 inferences 时跳过 sourceRefs Set | 44ns/run |
| S2-H-2 | assertAuthorityGrounding 空 authority 早退 | ~44ns |
| S2-H-3 | critiqueContract 四遍融合 | 真实规模噪声；压力规模更慢 |
| S2-H-4 | changeSetsEqual 单 Set delete 化 | 重复路径经 CheckAdapter 发散 |
| S2-H-5 | selectHighestPrecedence 折叠权重携带 | 9–13ns，test-only |
| S2-H-6 | registerRubric 外层冗余 spread 移除 | 7–20ns，test-only |
| S2-H-7 | normalizeSources 默认 origin 守卫跳过 | 防御纵深保留 |
| S2-I-1 | 普通 run 死载荷 loadLearnedRouting 下沉 children 分支 | 损坏 registry 时错误路径发散 |
| S2-I-2 | pause/inject 换未校准/惰性 router | inject 真实消费 router；亚感知 |
| S2-I-3 | buildInvocation toolNames/后缀提升 | 实测慢 2.2–2.7× |
| S2-I-4 | resume/answer/inspect CLI 预读去重 | 需改 run 公开签名 |
| S2-I-5 | doctor 检查 Promise.all 并行 | 53–75µs |
| S2-I-6 | parseProvidersConfig 双遍融合 | 错误选择发散 |
| S3-A-1 | roller mandatory 死 text 字段移除 | 被 S2-A-1 支配；抖动内 |
| S3-A-2 | lightMinorCount 已定义时跳过 prescoreInput 克隆 | 生产不可达 |
| S3-A-3 | claims.some(isSuccessClaim) 双算去重 | 35–40ns + 公开面变更 |
| S3-A-4 | mergeOpenMinors 双空输入早退 | 32–39ns 亚噪声 |
| S2-J-1 | loop-eval 两次 tombstones.has 合并 | 扩展点调用次数可观测 |
| S2-J-2 | loop-eval createdAt 排序换 Date.parse 数字键 | Z vs +00:00 指标发散 |
| S2-J-3 | cluster 役播 trim 提升 | P≤16，ns–µs |
| S2-J-4 | commandSourceKey package.json find 提升 | ~6µs/构建 |
| S2-J-5 | selectCodeMap 防御拷贝省略 | ~45ns |
| S2-J-6 | applyObservation filter→单遍计数 | 被 saveToDisk 支配 |
| S2-J-7 | privacy 删除级联无匹配早退 | 数据面；有匹配倒贴 |
| S2-J-8 | decideClosure evidenceRefs Set 提升 | ~800ns/close |
| S2-J-9 | feedback store needles 排序提升模块常量 | I/O 支配；X1-1 邻域 |
| S2-J-10 | readFeedback 双读改 Promise.all | 双故障抛错竞态 |
| S2-J-11 | waitForClarification 双 readAll 内存镜像 | S1-G-1 同域 |
| S3-B-1 | assignTasks 批内按请求键记忆化 partitionLiveCandidates | 实测负优化（copy/alias 两变体慢 884–1442µs/批）；alias 身份改变 |
| S3-B-2 | cheapFirstTiers 装饰-排序-还原消除比较器重复查询 | T≤10 省 39–201ns |
| S3-B-3 | cheapFirstTiers tie-break localeCompare 换码点比较 | 混大小写等成本 id 序发散 |
| S3-B-4 | applyCascade previous===selection 免建 tiers 快路径 | 生产不可达 + 50–80ns |
| S3-B-5 | validateInput 与 unknown-model 分段融合单遍 | 实测更慢（V8 内建快路径反例） |
| S3-B-6 | partitionLiveCandidates 共享可变请求对象 | ~260µs 噪声带 + 别名可变危险 |
| S3-D-1 | registry promote() 丢弃 beginPromotion 的 ledger 拷贝 | ~40ns；需改公开返回或平行 begin |
| S3-D-2 | paretoFront 末尾冗余 spread 移除 | 21–37ns，无生产调用方 |
| S3-D-3 | eval-routing assertReplayIsolated roots 去重 | 351–388µs 低于否决线 |
| S3-D-4 | parseRollbackLedgerEntry 外层再拷贝消除 | ~1.1µs/载入 |
| S3-D-5 | monitor report() 死 emptyAxes 分配下沉 | ~70ns，test-only |
| S3-C-1 | X′WX 上三角累加+镜像 | 省项被镜像拷贝抵消，边际抖动 |
| S3-C-2 | 融合单遍+per-key w / per-(key,y) z 去重 | 更慢；仅类型契约内等价 |
| S3-C-3 | bootstrap 采样缓冲跨 draw 复用 | 分配级噪声 |
| S3-E-1 | collectSignalsFromEvents 独立 if 链改互斥分派 + payload 提升 | E=41 八次测量异号，纯抖动 |
| S3-E-2 | runAutoAdaptFromEvents 前置扫描去重 | 105–124ns；信任 context 跳过重推导发散 |
| S3-E-3 | 分组循环冗余 Map.set 消除 | 公平副本对副本 ±8ns 抖动 |
| S3-E-4 | updateProjectBandit arms/reward 双扫融合 | 八次七次更慢；锁内 I/O 支配 |
| S3-E-5 | /unknown agent/i 字面量提升 | 1–6ns 深度亚噪声 |
| S3-F-1 | restore 顺手建 assignment-hash Set 复用于 assign 唯一性 | A=1000 实测慢 5.9–6.5ms |
| S3-F-2 | plan 引用同一性跳过 validateExperimentPlan | 就地变异时 fail-closed 发散；下界维持 |
| S3-F-3 | restore 空 assignments 跳过 population Set | 每实验一次，P=2000 省 50.8µs |
| S3-F-4 | createIsolationGuard 提升 resolve(outputRoot) | 一次性 µs；生产路径已被 S3-D-3 否决 |
| S3-F-5 | toFrozenEpisode 投影省略直接别名 | 形状可观察 + test-only |
| S3-G-1 | snapshot() 平坦记录 structuredClone 改浅展开 | 全 run 上界 2.8–8.6ms；隔离性降级 |
| S3-G-2 | checkpoint 双层校验去重 | 错误消息前缀发散 + ~35µs |
| S3-G-3 | handleExecutionEvent 增量终结计数 | ~0.35µs/尝试 |
| S3-G-4 | finish() 跳过末次 persistCheckpoint | 把 RUNNING 陈旧态当终态落盘 |
| S3-G-5 | isId 前缀模块级提升 | ~33ns/查；外推仅 ~13ms/run |
| S3-H-1 | 生产链双 validateRequirementContract 去重 | 134–185ns；删防御纵深 |
| S3-H-2 | critiqueContract 去中间数组保双 some 早退 | 真实 C=2 仅 ~100ns/run |
| S3-H-3 | q-tests 补问子集正则短路 | 34–45ns |
| S3-H-4 | changeSetsEqual 引用相等快路径 | ≤85ns；零生产流量 |
| S3-I-1 | invocationError 元组数组循环改直线检查 | V8 已标量替换；±0.02–0.12ms@50k 抖动 |
| S3-I-2 | --children 双 createAgentProfileRegistry 去重 | 8.4µs/运行 |
| S3-I-3 | 普通 run 死载荷 loadProvidersConfig 下沉 | 损坏 providers.json 时 exit 1→成功 |
| S3-I-4 | inspect --json 每事件 stdout 批量合并 | 实测慢 85–86µs；CliIo 调用次数可观测 |
| S3-I-5 | setDefaultModels 每字段双 parseModelRef 消除 | ~25ns，一次性配置 |
| S3-I-6 | answer/pause 预检查 readAll 换 stat 探针 | 损坏日志 fail-closed 被绕过 |
| S3-J-1 | stripForbidden 顺序剥除融合单遍 | 密钥前缀逃过脱敏；融合还慢 ~10× |
| S3-J-2 | context/index 排序比较器 decorate 提升 | 现实档 15–17µs；压力档仍低于否决线 |
| S3-J-3 | cluster 单播 send 双 trim 合并 | 16–19ns；mailbox 数据面 |
| S3-J-4 | jsonl split 换手写行扫描 | 无稳定收益；JSON.parse+I/O 支配 |
| S3-J-5 | rebuildViews 每 view nowIso() 提升 | lastUpdated 分布发散 + ~3.8µs |
| S3-J-6 | export scopes Set 化 / filter+map 融合 | Set 化更慢；融合被 stringify 支配 |
| S4-A-1 | turn.ts rollSummary 死 openMinors 覆盖 + 免克隆直传 | 等价但 2.5–2.9µs/run |
| S4-A-2 | applyChildThreeLine caller 侧 verification 预检提升 | 生产路径 ~0 次/run + 亚噪声 |
| S4-A-3 | shouldApplyThreeLine 死首条件消除 | 18–20ns + 公开函数 |
| S4-B-1 | analyze-task 七正则链换单遍多模式扫描 | 廉价形式不等价；修正属负优化域 |
| S4-B-2 | evaluateCandidate 约束依赖分解预评估 | 16–33µs + 平行路径 |
| S4-B-3 | 成功路径共享冻结空 failures 单例 | 跨候选身份可观察改变 |
| S4-B-4 | assignPlanned 直接传 task 作 options | 143–215µs/批噪声带 |
| S4-B-5 | assignTasks 批内共享可变 route-input 骨架 | 232–349µs + S3-B-6 同护栏 |
| S4-C-1 | solveSymmetric 消元 k 循环死存储跳过（起点 col+1） | 双向抖动（+80/−50 ms） |
| S4-C-2 | solveSymmetric 扁平 Float64Array 内部表示（偏移表 / 行拷贝交换） | 实测 1720/1585 ms，劣于行引用提升 |
| S4-C-3 | solveSymmetric 防御拷贝 map+spread 改 for+slice | 与赢家差 1.7 ms 噪声；拷贝存在性维持 |
| S4-C-4 | APC off 向量每 fit scratch 缓冲复用 | 分配级；APC 全站点 ~19 ms 低于噪声带 |
| S4-C-5 | irls 每 fit 预提取 ys 消除 rows[i].y 属性读 | 数 ms，亚噪声 |
| S4-C-6 | IRLS 首迭代 eta/mu 常量短路（beta=0） | ~2 ms/报告，亚噪声 |
| S4-D-1 | parseLedgerEntry 尾部条件 spread 消除 | 两次基准符号翻转，纯抖动 |
| S4-D-2 | rollback 载入链双拷贝消除 | 别名泄漏反例 + 133–143ns |
| S4-D-3 | evalRoutingPolicy registry/dataset 载入重叠 | 双故障/投机读发散；79–127µs |
| S4-D-4 | 默认 approval-profile 跳过校验 | ~110ns；防御纵深 |
| S4-D-5 | assertNoForbiddenFields entries→keys | ~2.6µs ×2/eval，占端到端 ~0.1% |
| S4-E-1 | collectSignalsFromEvents 空事件快路径 | 534–542ns；被 ~10²µs I/O 支配 |
| S4-E-2 | persistSignals∥updateProjectBandit 编排重叠 | 317–443µs；双故障错误非确定 |
| S4-E-3 | baseSignal 隐藏类单态化 | 形状不等价；~180–230ns/run |
| S4-F-1 | dataset 私有 seen Set 复用为 universe | U=2000 双向抖动；sealed 链路 test-only |
| S4-F-2 | replayPolicy 空 exclusions 免 Set+filter | 3–106µs；无生产调用方 |
| S4-F-3 | comparison-report 循环内 delta 减法 CSE | N=1000 仅 ~41µs |
| S4-G-1 | 同轮 RUNNING 节点 Promise.all 并行执行 | 确定性 id 流与事件次序漂移 |
| S4-G-2 | persistCheckpoint 写侧 validateCheckpoint 全跳过 | 损坏态 fsync 落盘；非法收益 |
| S4-G-3 | applyApproval 双层校验去重 | 非法 reply 先追加再抛错 |
| S4-G-4 | persistLedger 整快照改窄投影 | 5.4–14ms/run；需拓宽公开接口 |
| S4-G-5 | finish() 出参复用 checkpoint 内嵌快照 | 身份别名化；0.17ms/run |
| S4-G-6 | CheckpointStore 美化 JSON 改紧凑 | 磁盘数据面字节发散 |
| S4-G-7 | failed 过滤器下沉入 !canProgress | 全 run ≤9.7µs |
| S4-H-1 | checkCoverageGate own-key 换 Object.hasOwn | 非可枚举键 fail-open；2–9ns |
| S4-H-2 | critique 与 detectConflicts 结果级去重 | 公开签名 + 223ns |
| S4-H-3 | heuristicCritic omissions 就地变异免双拷贝 | 322–486ns/run |
| S4-I-2 | resume/answer PAUSED 探测改读 checkpoint.status | 陈旧 checkpoint fail-open 发散 + 4–17µs |
| S4-I-3 | unpause 短路重排到 pause 探测前 | 等价但 µs 级内存重放 |
| S4-I-4 | --track×--children 冲突检查提升到配置加载前 | 错误选择发散（S2-I-1/S3-I-3 同型） |
| S4-I-5 | describeSparkleModel try/catch miss 换预探测 | 9.3µs × M≤10；平行实现风险 |
| S4-J-1 | host.spawn 深度/配额双重复核死分支删除 | 不可达；3.7–5.5ns；防御纵深 |
| S4-J-2 | startTrackedRun catalog∥learned Promise.all | 双故障竞态 + 投机读；17–18µs |
| S4-J-3 | deleteEpisodeRecords 双文件 stat/rm 并行 | 删除数据面 + 竞态；60–62µs |
| S4-J-4 | packet omissions 双遍融合 | 9–87ns 抖动 |
| S4-J-5 | mailbox claimRole box() 提升 | 76–92ns；mailbox 数据面 |
| S4-J-6 | context/index 冗余 spread/slice 消除 | 70–81ns；一次性构建 |
| S5-A-1 | ownershipEscape 与 prescore escaped 扫描跨函数去重 | 廉价变体发散；可靠变体公开类型 + 9.8–10ns |
| S5-A-2 | hashAssessment JSON.stringify 换手写定长序列化 | 等价但慢 11–15% |
| S5-A-3 | from-child PASSED 路径 check-coverage 死校验短路 | 需平行路径或公开旗标；21.6ns |
| S5-B-1 | complexityOf 尾部死值谓词消除 | 22–46µs/批；意图文档 |
| S5-B-2 | evaluateCandidate 无限预算短路 | 真实路径 29–56µs；deadline 姊妹发散 |
| S5-B-3 | analyzeTask reason join 换模板字面量 | 301–323µs/批；S1-B/S4-B-5 同噪声带 |
| S5-B-4 | ResolvedRouteRequest 中间对象内联 | 46–68µs/批 |
| S5-C-1 | solveSymmetric 消元 k 循环按 2 顺序展开 | 被按 4 展开支配 |
| S5-C-2 | solveSymmetric 消元 k 循环按 8 顺序展开 | 对 U4 仅 +9–15 ms，低于噪声带 |
| S5-C-3 | solveSymmetric 消元行对分块（含 +k 展开） | 实测慢于滚动对照 |
| S5-C-4 | solveSymmetric 消元行四分块（含 +k 展开） | 对 U4 +20–25 ms，低于噪声带 |
| S5-C-5 | 回代 k 循环 / eta 点积顺序展开 | 串行依赖链；重排违逐位 |
| S5-C-6 | 主元搜索循环微观重构 | 上界 ~10 ms；选择规则本体 |
| S5-C-7 | irls xtwx 触碰单元置零代替整行 fill(0) | 15–25 ms 上界，低于噪声带 |
| S5-D-1 | restore() 对解析器产物的 id 再校验消除 | fail-open 反例；~805ns |
| S5-D-2 | pairedRecords entries() 换索引循环 | 567–744ns/eval |
| S5-D-3 | 保存链中间 snapshot() 对象消除 | 占 save+fsync 0.4–0.5% |
| S5-D-4 | evalRoutingPolicy 全 UNOBSERVED 前置短路 | 双故障错误选择发散 |
| S5-D-5 | rollback() resourceIdentityKey CSE | ~28ns；需改公开签名 |
| S5-E-1 | runAutoAdaptFromEvents 前置扫描反向早退 | projectRoot first-wins 发散；89–92ns |
| S5-E-2 | collectSignalsFromEvents ctx 循环外提升 | 五次异号抖动 |
| S5-E-3 | parseObservedSignal 两级 spread 合一 | extraSignals 零生产流量；~280ns |
| S5-E-4 | diagnose 分组键换嵌套 Map | 廉价形式平局序发散；忠实形式抖动 |
| S5-E-5 | auto-loop 切片内惰性 import | 独占增量仅 2.8–3.0ms |
| S5-F-1 | dataset/simulation-holdout 探针去重镜像 | test-only 链；U=2000 仅 15µs |
| S5-F-2 | assertUniqueNonEmpty 换 new Set(values).size | 无法命名重复项 + first-fault 重排 |
| S5-F-3 | S5-F 赢家的索引循环形式 | 1.6–3.1ms 形式抖动 |
| S5-G-1 | CheckpointStore/pause 每写 mkdir 提升 | 外部清理后自愈 vs ENOENT；1.8ms |
| S5-G-2 | TRACKING_ASSESSMENT 读侧复验按事件 id memoize | 篡改字节静默接受；7.3–7.5ms |
| S5-G-3 | ReconstructedRun 暴露 unmatchedPause | ≤3.7µs；需拓宽公开类型 |
| S5-G-4 | 跨 store 相邻追加 Promise.all | parent⟹child 崩溃前缀违例 |
| S5-G-5 | AGENT_EVENT 攒批合并落盘 | 逐消息持久性 + 实时可见性 |
| S5-G-6 | edgeStatus→conditionHolds 双 getRuntime 合一 | 4.7–6.3ns/边 |
| S5-H-1 | detectConflicts 分配前守卫 | 121–132ns；冲突侧负优化 |
| S5-H-2 | 切片生产子树惰性 import | 2.2–2.4ms once-per-process CLI 噪声 |
| S5-H-3 | hashArtifact 免拼接增量 hash32 折叠 | 零生产调用方；需复制集中化哈希 |
| S5-J-1 | 授权导出 listObservations 拷贝在 scopes 过滤时消除 | 4–6µs；stringify 支配 |
| S5-J-2 | codeMap 成本估算构串改闭式长度 | 2.6–2.7µs/编译 |
| S5-J-3 | 删除级联 tombstones 读延迟到首匹配后 | fail-open 损坏侧车；75–86µs |
| S5-J-4 | mailbox enqueue 冗余 byRole.set | 6.2–6.6ns；mailbox 数据面 |
| S5-J-5 | resolveFromMap 属性双读 CSE | ~10ns/查 |
| S5-J-6 | 跨 child 共享 acceptanceForRole default | 身份别名；~80ns |
| S6-A-1 | Number(x.toFixed(4)) 换 Math.round(x*1e4)/1e4 | 半格点 4419/10000 发散；~2.5µs |
| S6-A-2 | from-child FAIL 守卫合取短路重排 | 10.0–10.5ns/子结果 |
| S6-A-3 | from-child constraint-retention 死校验短路 | 需平行路径或公开旗标；22–24ns |
