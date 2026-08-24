MODEL_SLUG=claude-fable-5-thinking-xhigh

# R7-E：`src/learning/` 第七遍复查报告（Round 7）

**战役:** 全库持久 SOTA 优化 Round 7 / R7-E
**基线:** `cursor/sota-persistent-opt-83a1` @ `9c26b83`
**分支:** `cursor/r7-e-learning-seventh-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动；R3-E..R6-E 的切片级收口锚点复核成立。**
切片 10 个文件（1770 行）自 R1-E 基线（`adb20d7`）经 R2-E、R3-E、R4-E、R5-E、
R6-E 至本轮基线（`9c26b83`）**逐字节未变**（`git diff adb20d7..9c26b83 --
src/learning/` 为空，期间无任何提交触及该目录）——R6-E「切片自 R1-E 起逐字节
未变」的声明经本轮独立复核确认。`fc0de1d..9c26b83`（R6-E 之后）的 src 变更仅
S6-C（`routing/offline-logit.ts` IRLS 累加直线化）、S5-I-1（`cli/main.ts`
12 条分支独占 dispatch 点用处化）、S6-F-1（`experiments/shadow.ts` +
`canary.ts` restore 成员判断反转），均不触及本切片、不改变其调用频率或输入
规模（S5-I-1 只移动了 `cli/main.ts` 内其它命令的 import 位置，`runAutoAdaptLoop`
与 `loadLearnedRouting` 的静态 import 与调用点原样保留）。R1-E 逐文件收口、
R2-E..R6-E 复查与 S1-E-1..8 / S2-E-1..7 / S3-E-1..5 / S4-E-1..3 / S5-E-1..5 /
S6-E-1..5 共 33 项排除全部继承有效；生产调用面交叉检索复核未变（post-run
自适应环 `runAutoAdaptLoop` @ `cli/main:783` / `track/loop:172` /
`cli/adapt:205`、`runAutoAdaptFromEvents` @ `cli/adapt:188`、
`proposeRoutingFromRoutedEvents` @ `cli/adapt:168` + live 装配面
`applyLearnedRouting` @ `routing/assign:102` / `run/flowchart-run:681`、
`loadLearnedRouting` @ `cli/main:708` / `track/loop:88` /
`run/flowchart-run:712`；`patterns` / `attribution` / `signatures` 仍无任何
生产调用方，仅测试使用）。**SLICE-CPU 总量上界锚点经本轮实测复核成立**：
一次完整 auto-adapt run 的全切片 CPU 合计 **21.2–21.5µs**（与 R6-E 的
22.0–24.4µs、R4-E 的 18.1–18.5µs 同带，VM 差异）——距落地线（≥10ms，本轮
验收标准为数十~数百 ms）**约 464–472×**，即使把切片 CPU 清零也远不达门槛。
本轮在完整排除表之上以第七组新角度枚举（trim 分配消除、恒等快路径、校验
前移、循环不变探针提升、双三元合一），得到 5 个此前未点名的新候选
（S7-E-1 … S7-E-5），全部经理论 + 确定性仿真（seeded mulberry32，>48,000 项
等价检查/次 × 6 次独立运行，等价结论逐位一致；ns 级基准按 S3-E-3 方法论
副本对副本、按 S3-E-4 方法论 ≥5 次判向）裁决后淘汰：1 个等价且 identity-hit
侧方向稳定（S7-E-2 truncate 恒等快路径，273–293ns/call、4.3×）但上界仅
~3–7µs/run、距落地线 ~10³× 且 miss 侧付探针成本；1 个等价但**实测五次全负**
（S7-E-3 校验前移，−35~−67ns/run——小集合教训系列第十例）；1 个等价但方向
随输入分布翻转（S7-E-1，未填充侧全负、填充侧全正，±4–6ns/调用）；2 个等价
但六次异号纯抖动（S7-E-4 / S7-E-5）。未重开任何 X* / S1-* … S7-A/B-* 条目，
特别是 S6-E-1..5（五 Map 合一、组合正则 scoreUserAnswer、mkdir、紧凑
bandit.json、双正则复用）全部未触碰。零 diff 下全部硬不变量天然满足。本切片
在其输出契约与数据面语义下维持 SOTA——第七遍复查再次确认：**剩余的全部
ms 级余量都在被排除表点名保护的 I/O 契约面上**，切片级收口条件（R3-E §7 /
R4-E §7 / R5-E §7 / R6-E §7）依然成立。

## 0. 范围与约束遵守

- 切片：`src/learning/` 全部 10 文件（`attribution` / `auto-loop` /
  `bandit-store` / `diagnostics` / `from-episode` / `learned-routing` /
  `patterns` / `signals` / `signatures` / `task-success`）本轮第七遍全量实际
  读码，未依赖前六轮记忆。上下游 `adaptation/`、`routing/`、`run/`、`track/`、
  `cli/`、`feedback/`、`persist/`、`privacy/` 只读取证，一行未改。
- 先读并遵守（顺序强制）：README → EXCLUSIONS.md（完整表，含 S7-A-1..4、
  S7-B-1..6）→ round-07/PLAN.md → round-01/R1-E.md → round-02/R2-E.md →
  round-03/R3-E.md → round-04/R4-E.md → round-05/R5-E.md → round-06/R6-E.md →
  10 个源文件。
- 基线漂移检查：`git diff adb20d7..9c26b83 -- src/learning/` 为空且
  `git log adb20d7..9c26b83 -- src/learning/` 无提交——R6-E 的
  「逐字节未变」声明复核成立，前六轮全部规模测量、调用面图景与裁决原样
  成立。`fc0de1d..9c26b83` 的 src 变更仅 S6-C / S5-I-1 / S6-F-1——不触及
  本切片调用方语义与调用频率。
- 排除表遵守：候选枚举刻意绕开全部既有排除。特别地：S7-E-1（scoreUserAnswer
  trim 分配消除）与 S6-E-2（双正则合并单遍组合正则）区分——两条正则保持
  独立、负向优先序逐字保留，目标只是 `text.trim()` 的字符串分配与空判改
  `/\S/` 探针；与 X0-6 区分——不含 `/g`，无 lastIndex 状态。S7-E-2
  （truncate 恒等快路径）与 S2-E-5（流式收集 401 字符早退）区分——不重写
  归一化主体，miss 路径逐字保留 `replace(/\s+/g," ").trim()`，只前置一个
  恒等预探针；字符串原值相等使快路径返回原串不构成可观察身份差异
  （JS 字符串按值比较）。S7-E-3（family/role 校验前移到路由插入点）与
  Iter4 点名的「FAMILIES.includes Map 化」区分——不换数据结构，只移动
  校验时点；与 S2-E-2（三遍融合）区分——单函数内部工作重排，不跨函数。
  S7-E-4（request.agent 探针循环外提升）与 S5-E-2（ctx 字面量提升）区分——
  目标是另一个函数（collectSignalsFromSubagentRun）的另一个循环不变量。
  S7-E-5（JUDGE_DECISION verdict 双三元合一）与 S1-E-2（judge 双重
  Map.get 去重）、S3-E-1（互斥分派 + payload 提升）区分——候选副本逐字
  保留双 Map.get 与独立 if 链（全部已排除编辑不捆绑），只合并 verdict 的
  两棵三元树为单次分派。X0-3 / X1-1 / X1-2 / X2-6 / S1-E-* … S6-E-* 全部
  未触碰；反向扫描早退、双故障 Promise.all、auto-loop 惰性 import、嵌套
  Map 分组键、五 Map 合一、mkdir 提升、紧凑序列化均未重提。
- ns 级基准全部副本对副本（S3-E-3 方法论）；几十~几百 ns 量级 delta 以
  6 次独立运行判向（S3-E-4 方法论）；生产导入仅承担等价性参照与绝对量级
  锚点角色。
- 硬不变量：零 diff，`adapt auto` 只提案（`autoPromote` 被忽略、绝不 CAS
  晋升）、SPARKLE_AUTO_ADAPT=0 仍收集、`parseObservedSignal` 拒绝 user/human
  伪造 taskSuccess、`ensureRoutingBaseline` 绝不移动既有指针、双 LCB 与双
  归因保留、Tracking 无指挥权——天然满足。不声称 Outcome-supported；
  Checkpoint F-PROD 仍开放（ADR-005）。不改阈值、测试、公开签名、数据面。

## 1. SLICE-CPU 锚点复核（本轮首要任务）

R3-E §1 / R4-E §1 / R5-E §1 / R6-E §1 的切片级收口论证依赖三个前提，本轮
逐一复核：

1. **切片代码未变**：`git diff adb20d7..9c26b83 -- src/learning/` 为空。
2. **调用面未变**：交叉检索确认生产入口仍是 post-run 自适应环（每 run 一次）
   + live 装配面（每任务一次，M≤10）；`patterns` / `attribution` /
   `signatures` / `compareSignatures` 仍零生产调用方（仅
   `test/unit/learning/patterns.test.ts` 与
   `test/acceptance/adaptive-loop.test.ts`）。R6-E 后落地的 S6-C 在
   `routing/offline-logit.ts`（offline 报告面）、S6-F-1 在 `experiments/`
   （实验面）、S5-I-1 在 `cli/main.ts`（只惰性化其它命令的 dispatch 模块，
   本切片的 `learned-routing` / `auto-loop` 静态 import 原样保留）——均不
   改变 `runAutoAdaptLoop` 的调用时机或事件规模；无新热路径、无 ≥2 个量级
   的规模变化。
3. **锚点量级**：本 VM 重测（六次运行区间）：

```text
collect=13.2-13.5us  outcomes=7.0-7.3us  diagnose=0.13-0.15us  bandit-build=0.7us
total in-slice CPU ~21.2-21.5us per full auto-adapt run
vs landing bar >=10000us  ->  464-472x below EVEN IF ZEROED
```

绝对值落在历史带内（R4-E 18.1–18.5µs < 本轮 21.2–21.5µs < R6-E
22.0–24.4µs < R3-E 24.6–25.2µs < R5-E 28.1–28.9µs，纯 VM 差异），支配结论
不变：落地线要求数十~数百 ms 或复杂度类下降；本切片每 run 全部 CPU 合计
~21µs，唯一的 ms 级余量在 I/O 行为上，而每一条 I/O 边都已被排除表点名保护
（X0-3 保存时机、S2-E-1/4 跳写、S1-G-1 readAll 事实源、S1-E-4/5 顺序追加与
并行读、S4-E-2 编排重叠、S5-E-5 惰性 import、S6-E-3 mkdir、S6-E-4 序列化
格式）。**锚点复核成立，该切片不存在不推翻既有排除就能达门槛的候选。**
本轮第七组新角度（trim 分配、恒等预探针、校验时点、循环不变探针、分派树
合一）正是对「锚点之外还有没有面」的再穷举——结论：没有（§2–§3）。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S7-E-1 | `scoreUserAnswer` trim 分配消除（`/\S/` 探针替代 `trim()+""` 判空，两条 `\b` 正则在原文本上直测） | 免一次字符串分配；`\b` 词边界对边缘空白删除不变（\w 起始词：空白与串首同为边界；CJK 起始词：空白与串首同为非边界——.test 结果逐位保持） | ✅ 8000 fuzz（含 CJK 关键词、NBSP/EM/LS/PS/IDEOGRAPHIC SPACE/ZWNBSP 边缘填充）+ 10 个定向边界全一致 | 副本对副本：未填充现实回答**六次全负**（−14/−20/−17/−22/−14/−22 ns/5 调用）；填充回答六次全正（+26/+19/+28/+27/+25/+20 ns/5 调用）——**方向随输入分布翻转**，±4–6ns/调用 | 淘汰：深度亚噪声且方向不稳定（V8 对已 trim 串的 `trim()` 返回原串近零成本，探针在该侧是纯新增）；每 run USER_ANSWER 个位数次 |
| S7-E-2 | `truncate` 恒等快路径（预探针 `/^ \| $\| {2}\|[^\S ]/` 未命中即跳过 `replace+trim` 分配，直接返回原串/原串切片） | 恒等前提精确可证：无非空格空白 ∧ 无双空格 ∧ 无首尾空格 ⇒ replace+trim 恒等；命中面是模板字面量拼出的单空格摘要（现实多数） | ✅ 65536 全码元探针奇偶校验 + 8000 Unicode fuzz + 399/400/401/402 双形态边界全一致 | identity-hit 68B **六次全正**（+293/+286/+283/+273/+292/+288ns/call，4.3×）；5KB hit 省 ~23µs（5.9×）；identity-miss 48B **五负一正**（−49/−46/−47/+14/−50/−54ns/call）——miss 侧付探针 | 淘汰：等价且 hit 侧方向稳定，但每 run truncate 仅 ~12–25 次调用 ⇒ 上界 **~3–7µs/run**，距落地线（≥10ms）~10³×；miss 侧负优化使净收益进一步收缩；每次 truncate 伴随同信号 ~10²µs appendFeedback（R1-E 锚点）支配（验收标准明文拒收 µs 级） |
| S7-E-3 | `outcomesFromRoutedRun` family/role 校验前移到 MODEL_ROUTED 插入点（每路由一次 `FAMILIES.includes`+`isAgentRole`，TASK_RESULT 消费免重验；无效路由以哨兵存储以保「无效覆盖有效」语义） | 校验次数从 Θ(结果数) 降到 Θ(路由数)（多结果任务免重验）；retry 只改 model/modelVersion，family/role 校验 retry 不变 | ✅ 4000 fuzz（混入 bogus family/role、不完整路由、retry 级联）+「无效路由覆盖有效路由后到达结果」定向反向边界全一致 | 最佳忠实形式副本对副本 E=41 **五次全负**（−67/−56/−55/−47/−35ns/run；含临时 Map 的初版 −268ns 已按公平性修正） | 淘汰：**实测负优化**——插入点校验 + 包装对象分配 > 每结果重验节省（现实路由数 ≈ 结果数，无重验放大）；「小集合上重构固定开销高于线性重算」系列**第十例**（S1-A-4/S1-B-6/S1-E-6/S1-E-8/S2-E-5/S2-E-6/S3-E-4/S5-E-4/S6-E-2 之后） |
| S7-E-4 | `collectSignalsFromSubagentRun` 的 `typeof request.agent === "string"` 探针循环外提升（request 循环不变） | 每 result 免一次 typeof + 属性读 | ✅ 4000 fuzz（含非字符串 agent、缺失 request）一致 | 副本对副本现实 Pi run（1–3 results）**六次异号**（−27/+13/−34/+3/+3/−18ns/文件）——纯抖动 | 淘汰：亚噪声；results 现实 1–3 个、subagent 文件个位数（S5-E-2 循环不变量提升同带宽） |
| S7-E-5 | JUDGE_DECISION verdict 双三元合一为单次分派（一条 if/else 链同时产出 score 与 outcomeKind；judge 双 Map.get 与独立 if 链逐字保留不捆绑） | 每 judge 事件免最多 2 次字符串比较 | ✅ 4000 fuzz 一致（createdAt 归一化后逐字节；副本保真另验 4000） | 副本对副本 E=41 **六次异号**（−22/+109/−32/+74/+177/+15ns/run）——S3-E-1 同带宽纯抖动 | 淘汰：亚噪声；V8 对短字符串比较已近零成本（S1-B-7/S3-E-1 同类） |

另有四处以既有排除/裁决直接覆盖、不立新 ID：`applyLearnedRouting` 的三次
`allowedModels.includes` 换 Set（Iter4 M≤10 live 面 + S2-E-6 域）；
`diagnoseModelProjectIssues` 过滤器谓词频率重排（S6-A-2/S6-B-3 短路重排
同族，ns 级）；`scoreTaskResult` 决策表 Map 化（S1-D-8 小表域，4×3=12 组合
仍小表）；`stableProjectKey` 双 replace 合一（R6-E 已裁决不立 ID，S2-E-5
短输入教训覆盖）。

## 3. 关键裁决细节

### 3.1 S7-E-2：本轮唯一 hit 侧方向稳定的等价候选为何仍不落地

恒等快路径是前六轮未探过的角度（S2-E-5 探的是重写归一化主体为流式循环，
本候选保留主体、只加恒等预探针）。等价性最强：探针的恒等前提
（`/^ | $| {2}|[^\S ]/` 未命中 ⇔ `replace(/\s+/g," ").trim()` 恒等）经
65536 全码元奇偶校验 + 8000 Unicode fuzz + 双形态长度边界逐位确认；且与
S2-E-5 的关键差异是**现实输入侧为正**：`TASK_RESULT SUCCESS: tests passed`
一类模板拼接摘要天然单空格，探针命中即免 380ns 的 replace+trim，实测省
273–293ns/call（4.3×）、5KB 命中省 ~23µs（5.9×）。但淘汰理由有三条独立
成立：

1. **量级**：truncate 的全部生产调用点（TASK_RESULT ~10 次/run、
   USER_ANSWER/RUN_FAILED/PEER 个位数、subagent 文件个位数）合计每 run
   ~12–25 次，全命中上界 **~3–7µs/run**——占落地线 ~10⁻³，本轮验收标准
   明文「Reject µs/ns」。
2. **miss 侧负优化**：含换行/连续空格的摘要（`did the work\n  with details`
   一类）付探针成本，六次测量五负一正（−46~−54ns/call），现实混合分布下
   净收益进一步收缩。
3. **支配**：每次 truncate 的宿主信号在同路径必付 ~10²µs 的
   `appendFeedback`（R1-E 锚点，96–192µs/信号）——~10³× 支配。

为将来重开保留：若 truncate 进入每 turn 热路径或摘要规模增长 ≥2 个量级
（kB 级摘要 hit 侧 5.9× 才有意义），可凭本报告等价证据重开；探针正则本身
无 `/g`、无状态，X0-6 不适用。

### 3.2 S7-E-3：校验前移的负优化（小集合教训第十例）

纸面上校验次数从 Θ(结果数) 降到 Θ(路由数)且多结果任务免重验，等价性严格
成立（含本轮新立的**反向边界**：有效路由被后到的无效路由覆盖后，其结果
必须回到「丢弃」——候选以哨兵存储保住该语义，4000 fuzz + 定向用例逐位
一致）。但 E=41 真实规模五次测量**全负**（−35~−67ns/run）：现实事件表中
路由数 ≈ 结果数（各 ~10），无重验可省；而插入点新增的
`FAMILIES.includes` + `isAgentRole` 对**每条**完整路由执行（含从未收到
结果的路由），加上每条路由一个 `{payload, family, role}` 包装对象分配，
稳定超过省下的每结果重验（includes 上界 8 ≈ 20ns）。与 S1-A-4、S1-B-6、
S1-E-6、S1-E-8、S2-E-5、S2-E-6、S3-E-4、S5-E-4、S6-E-2 构成同一教训的
第十例：**小集合上把工作从消费点搬到生产点，搬运结构的固定开销高于被
消除的重复线性工作**。重开条件：每任务结果数增长 ≥1 个量级（重验放大）
且路由表规模不随之增长。

### 3.3 S7-E-1：trim 不变性证明成立但收益方向随分布翻转

`\b` 词边界对边缘空白删除的不变性是本候选的理论核心，本轮给出完整论证并
经 8000 fuzz 确认：对 \w 起始/结尾的关键词（no/lgtm/…），被删空白是 \W、
串首/串尾在 `\b` 语义下与 \W 等效 ⇒ 边界判定不变；对 CJK 关键词
（不行/错误/可以），字符本身是 \W ⇒ 空白侧与串首侧同为「无边界」⇒ 同样
不变（附带确认现行实现对孤立 CJK 关键词本就不匹配——`\b不行\b` 需毗邻
\w 字符，这是现行行为，候选逐位保留）。但基准揭示 V8 对已 trim 字符串的
`trim()` 直接返回原串（近零成本），未填充侧探针是纯新增（六次全负）；
填充侧免分配为正（六次全正）——净方向取决于 USER_ANSWER 是否带边缘空白，
现实无分布证据支持任一侧，且绝对量 ±4–6ns/调用 × 每 run 个位数次调用，
深度亚噪声。淘汰。

### 3.4 S7-E-4 / S7-E-5：循环不变提升与分派树合一的收口

两者都是前六轮微观角度的残余枚举：S7-E-4 的 request 探针是
`collectSignalsFromSubagentRun` 里最后一个未点名的循环不变量（S5-E-2 点名
的是 collectSignalsFromEvents 的 ctx 字面量）；S7-E-5 的 verdict 双三元是
JUDGE_DECISION 分支里最后一个未点名的重复求值形态（S1-E-2 点名的是双
Map.get）。两者等价性平凡、六次测量全部异号（±34ns/文件、±177ns/run），
确认为纯抖动。至此本切片的「循环不变量提升」与「重复求值去重」两个角度
在全部 10 个文件上完成穷尽点名：signals.ts（S1-E-2、S3-E-1、S5-E-2、
S7-E-5）、auto-loop.ts（S1-E-4）、subagent 路径（S7-E-4）、from-episode
（S2-E-2）、diagnostics（S3-E-3）、bandit-store（S3-E-4）——**该角度不会
再出新候选**，除非规模增长 ≥2 个量级。

## 4. 逐文件收口（前六轮收口之上的本轮新检查点）

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `signals.ts` | S7-E-1（trim 分配消除）、S7-E-2（truncate 恒等快路径）、S7-E-5（verdict 单次分派）淘汰；S1-E-1/2/3、S2-E-5/7、S3-E-1/5、S4-E-1/3、S5-E-2/3、S6-E-1/2/5 维持 | 无候选 |
| `auto-loop.ts` | 无第七组新角度（I/O 契约边已全点名：S1-E-4/5、S2-E-1、S3-E-2、S4-E-2、S5-E-1/5）；`assignments` 死字段=公开签名不动（R5-E 裁决维持） | 无候选 |
| `from-episode.ts` | S7-E-3（family/role 校验前移）淘汰并立反向边界（无效覆盖有效）+ 第十例负优化证据；S2-E-2、`Date.parse`（X1-1 域）维持 | 无候选 |
| `bandit-store.ts` | 无第七组新角度（S2-E-3/4、S3-E-4、S6-E-3/4、X1-2、Iter4 已穷尽该文件的构造、扫描、I/O 三个面） | 无候选 |
| `diagnostics.ts` | 谓词频率重排不立 ID（§2 尾注，S6-A-2 同族）；S1-E-6、S3-E-3、S4-E-3、S5-E-4、恒真守卫维持 | 无候选 |
| `learned-routing.ts` | `applyLearnedRouting` 三次 includes 换 Set 不立 ID（Iter4 M≤10 + S2-E-6 域）；`stableProjectKey`（X1-1 + R6-E 裁决）维持 | 无候选 |
| `patterns.ts` / `attribution.ts` / `signatures.ts` | 本轮交叉检索复核仍零生产调用方；X2-6、S1-E-7/8 维持 | 无候选 |
| `task-success.ts` | S2-E-7 维持；`copyDefinedBinding`+`present()` 空白字段契约实施点不动；`scoreTaskResult` 决策表 Map 化不立 ID（S1-D-8 域） | 无候选 |

## 5. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 6. 测试

零代码改动下切片相关套件基线复核，全绿（Node 22.22.2 / pnpm 10.17.1）：

```bash
npx tsx --test "test/unit/learning/*.test.ts" "test/acceptance/adaptive-loop.test.ts"
# tests 48 / suites 2 / pass 48 / fail 0
pnpm typecheck && pnpm lint && pnpm build   # 全绿
```

仿真（临时脚本 `/tmp/r7e-sim.mts`，未入库以遵守「败者仿真只进报告附录」；
完整源码见附录，seeds `0xe77e01`–`0xe77e08`）共 **6 次独立运行**（第 1 次
含 S7-E-3 临时 Map 初版，第 2–6 次为公平性修正后最终版），>48,000 项等价
检查/次全部通过、等价结论逐位一致。代表性一次运行：

```text
S7-E-1 bench realistic mix (5 answers, replica-vs-replica): current=234ns cand=253ns delta=-20ns/5calls
S7-E-1 bench padded mix (5 answers, replica-vs-replica): current=302ns cand=283ns delta=19ns/5calls
S7-E-2 bench realistic identity-hit 68B: current=371ns cand=85ns delta=286ns/call
S7-E-2 bench realistic identity-miss 48B: current=289ns cand=335ns delta=-46ns/call
S7-E-2 bench 5KB identity-hit: current=28263ns cand=4874ns delta=23390ns/call
S7-E-3 bench E=41 (replica-vs-replica): current=910ns cand=977ns delta=-67ns/run
S7-E-4 bench realistic Pi run (replica-vs-replica): current=3013ns cand=3001ns delta=13ns/file
S7-E-5 bench E=41 (replica-vs-replica): current=12124ns cand=12016ns delta=109ns/run
SLICE-CPU anchor re-verify: collect=13.5us outcomes=7.0us diagnose=0.14us bandit-build=0.7us | total in-slice CPU ~21.4us per run vs landing bar >=10000us (468x below even if zeroed)

ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

计时方向跨 6 次运行汇总：S7-E-1 未填充侧**六次全负**（−14/−20/−17/−22/
−14/−22ns/5 调用）、填充侧六次全正（+26/+19/+28/+27/+25/+20）——方向随
分布翻转；S7-E-2 identity-hit **六次全正**（+293/+286/+283/+273/+292/
+288ns/call）、identity-miss 五负一正（−49/−46/−47/+14/−50/−54）、5KB hit
22.9–23.4µs 稳定；S7-E-3 最佳形式**五次全负**（−67/−56/−55/−47/−35ns/run）；
S7-E-4 六次异号（−27/+13/−34/+3/+3/−18）；S7-E-5 六次异号（−22/+109/−32/
+74/+177/+15）；SLICE-CPU 总量 21.4/21.4/21.3/21.2/21.5/21.2µs 稳定。

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S7-E-1 | scoreUserAnswer trim 分配消除（/\S/ 探针 + \b 正则原文本直测） | 等价严格成立（\b 边界 trim 不变性含 CJK 边界，8000 fuzz）但方向随输入分布翻转（未填充六次全负、填充六次全正，±4–6ns/调用）；每 run 个位数次调用 |
| S7-E-2 | truncate 恒等快路径（预探针未命中跳过 replace+trim） | 等价（65536 全码元奇偶 + 8000 fuzz）且 hit 侧六次方向稳定（273–293ns/call、4.3×；5KB ~23µs），但每 run 仅 ~12–25 次 ⇒ 上界 ~3–7µs/run 距落地线 ~10³×；miss 侧付探针（五负一正）；被同路径 ~10²µs appendFeedback 支配 |
| S7-E-3 | outcomesFromRoutedRun family/role 校验前移到路由插入点 | 等价严格成立（含无效覆盖有效反向边界）但最佳形式五次全负（−35~−67ns/run）：插入点校验 + 包装对象分配 > 每结果重验节省（小集合教训第十例）；现实路由数 ≈ 结果数无重验放大 |
| S7-E-4 | collectSignalsFromSubagentRun request.agent 探针循环外提升 | 等价但六次异号（−34~+13ns/文件）纯抖动；results 现实 1–3 个（S5-E-2 同带宽） |
| S7-E-5 | JUDGE_DECISION verdict 双三元合一单次分派 | 等价但六次异号（−32~+177ns/run）纯抖动（S1-B-7/S3-E-1 同类）；judge 双 Map.get 与独立 if 链未捆绑 |

重开条件：S7-E-1 需 USER_ANSWER 出现稳定带边缘空白的输入分布证据且调用
进入每 turn 热路径；S7-E-2 需 truncate 进入每 turn 热路径或摘要规模增长
≥2 个量级（等价证据本报告在案，探针无 /g 不触 X0-6）；S7-E-3 需每任务
结果数增长 ≥1 个量级且路由表不随之增长（哨兵形式的等价证据在案）；
S7-E-4/5 若信号管道进入每 turn 热路径或 E/S 增长 ≥2 个量级可凭等价证据
重开。切片级重开总条件维持 R3-E §7 / R4-E §7 / R5-E §7 / R6-E §7：
SLICE-CPU 锚点失效（全切片 CPU 增长 ≥2 个量级，本轮复核值 21.2–21.5µs）
或任一 I/O 契约排除（X0-3 / S2-E-1/4 / S1-G-1 / S1-E-4/5 / S4-E-2 /
S5-E-5 / S6-E-3/4）被正式推翻。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.mts` 后在仓库根目录 `npx tsx <file>`（依赖已装）。
seeds：`0xe77e01`–`0xe77e08`。

```ts
/**
 * R7-E deterministic equivalence + benchmark simulation (seventh pass over
 * src/learning/). Adjudicates fresh candidates S7-E-1 .. S7-E-5 against the
 * current implementations and re-verifies the R3-E..R6-E SLICE-CPU anchor.
 * Seeded PRNG (mulberry32) -> fully reproducible. Seeds: 0xe77e01 - 0xe77e08.
 *
 * Reference = production imports (equivalence role + absolute-magnitude
 * anchors). ns-delta benchmarks are replica-vs-replica per the S3-E-3
 * methodology lesson; tens-of-ns deltas need >=5 independent runs per the
 * S3-E-4 lesson. Replicas keep every already-excluded edit UNAPPLIED
 * (independent if-chains, judge double-get, per-event ctx literal, five
 * separate route maps, sequential appendFeedback, ...).
 */
import { performance } from "node:perf_hooks";
import {
  collectSignalsFromEvents,
  collectSignalsFromSubagentRun,
  scoreTaskResult,
  scoreUserAnswer,
  type ObservedSignal,
  type SignalContext
} from "/workspace/src/learning/signals.js";
import {
  taskSuccessFromResult,
  type TaskSuccessRouteBinding
} from "/workspace/src/learning/task-success.js";
import { diagnoseModelProjectIssues, type ModelProjectIssue } from "/workspace/src/learning/diagnostics.js";
import { outcomesFromRoutedRun } from "/workspace/src/learning/from-episode.js";
import { createBanditState, recordReward, type BanditState } from "/workspace/src/routing/bandit.js";
import { oneHotDistribution } from "/workspace/src/routing/catalog-model.js";
import { classifyTaskFailure } from "/workspace/src/routing/failure-class.js";
import { parseOutcomeObservation, type OutcomeObservation } from "/workspace/src/routing/outcomes.js";
import { AGENT_ROLES, isAgentRole } from "/workspace/src/domain/roles.js";
import type { EpisodeId, ProjectId } from "/workspace/src/domain/ids.js";
import type { Event, ModelRoutedPayload } from "/workspace/src/run/events.js";
import type { AgentMessage, TaskOutcome, VerificationKind } from "/workspace/src/protocol/v1.js";
import type { IsoTimestamp } from "/workspace/src/domain/timestamp.js";
import { nowIso } from "/workspace/src/domain/timestamp.js";
import type { FeedbackKind } from "/workspace/src/feedback/types.js";
import type { OutcomeCriterion, OutcomeKind } from "/workspace/src/routing/outcomes.js";
import type { EpisodeSignatureKind } from "/workspace/src/learning/signatures.js";
import type { TaskFamily } from "/workspace/src/task/taxonomy.js";

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (!ok) {
    failures += 1;
    console.error(`FAIL ${name}${detail === undefined ? "" : `: ${detail}`}`);
  }
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T;
}
function bench(fn: () => void, reps: number): number {
  fn();
  const t0 = performance.now();
  for (let i = 0; i < reps; i += 1) fn();
  return (performance.now() - t0) / reps;
}
/** createdAt is nowIso() captured per call; normalize for cross-call compare. */
function norm(signals: readonly ObservedSignal[]): string {
  return JSON.stringify(signals.map((s) => ({ ...s, createdAt: "T" })));
}

const NOW = "2026-08-24T12:00:00.000Z" as IsoTimestamp;

/* ================================================================
 * Verbatim private-helper replicas from src/learning/signals.ts.
 * Every already-excluded edit stays UNAPPLIED.
 * ================================================================ */
const USER_NEGATIVE = /\b(no|wrong|revert|reject|bad|不行|错误)\b/i;
const USER_POSITIVE = /\b(lgtm|good|ship|approve|yes|可以)\b/i;
const PEER_NEGATIVE = /\b(fail|bug|issue|missing|violation|unknown agent|错误)\b/i;

function truncate(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > 400 ? `${trimmed.slice(0, 397)}...` : trimmed;
}
function familyFromRole(role: string | undefined): string | undefined {
  if (role === "critic" || role === "reviewer") return "review";
  if (role === "tester") return "test";
  if (role === "scout") return "research";
  if (role === "planner") return "plan";
  if (role === "actor" || role === "implementer" || role === "worker" || role === "debugger") return "edit";
  return undefined;
}
interface BaseSignalInput {
  source: ObservedSignal["source"];
  kind: FeedbackKind;
  projectId: ProjectId;
  score: number;
  boundary: EpisodeSignatureKind;
  summary: string;
  createdAt: IsoTimestamp;
  episodeId?: EpisodeId | undefined;
  runId?: ObservedSignal["runId"];
  taskId?: ObservedSignal["taskId"];
  modelId?: string | undefined;
  modelVersion?: string | undefined;
  role?: string | undefined;
  family?: string | undefined;
  featureVersion?: string | undefined;
  criterion?: OutcomeCriterion | undefined;
  outcomeKind?: OutcomeKind | undefined;
  evidenceIds?: readonly string[] | undefined;
}
function baseSignal(input: BaseSignalInput): ObservedSignal {
  return {
    source: input.source,
    kind: input.kind,
    projectId: input.projectId,
    score: input.score,
    boundary: input.boundary,
    summary: input.summary,
    createdAt: input.createdAt,
    evidenceIds: input.evidenceIds ?? [],
    ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
    ...(input.modelVersion !== undefined ? { modelVersion: input.modelVersion } : {}),
    ...(input.role !== undefined ? { role: input.role } : {}),
    ...(input.family !== undefined ? { family: input.family } : {}),
    ...(input.featureVersion !== undefined ? { featureVersion: input.featureVersion } : {}),
    ...(input.criterion !== undefined ? { criterion: input.criterion } : {}),
    ...(input.outcomeKind !== undefined ? { outcomeKind: input.outcomeKind } : {}),
    ...(input.episodeId !== undefined ? { episodeId: input.episodeId } : {}),
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    ...(input.taskId !== undefined ? { taskId: input.taskId } : {})
  };
}
function isRecordLocal(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
type SignalCtx = {
  projectId: ProjectId;
  modelByTask: ReadonlyMap<string, string>;
  modelVersionByTask: ReadonlyMap<string, string>;
  roleByTask: ReadonlyMap<string, string>;
  familyByTask: ReadonlyMap<string, string>;
  featureVersionByTask: ReadonlyMap<string, string>;
  episodeId?: EpisodeId | undefined;
  createdAt: IsoTimestamp;
};
function signalFromAgentMessage(message: AgentMessage, ctx: SignalCtx): ObservedSignal | undefined {
  if (message.type === "TASK_RESULT") {
    const modelId = ctx.modelByTask.get(message.taskId);
    const role = ctx.roleByTask.get(message.taskId);
    const family = ctx.familyByTask.get(message.taskId) ?? familyFromRole(role);
    const modelVersion = ctx.modelVersionByTask.get(message.taskId);
    const featureVersion = ctx.featureVersionByTask.get(message.taskId);
    const unverified = message.outcome === "SUCCESS" && message.verification.kind === "UNOBSERVED";
    const binding: TaskSuccessRouteBinding = {
      ...(modelId !== undefined ? { modelId } : {}),
      ...(modelVersion !== undefined ? { modelVersion } : {}),
      ...(family !== undefined ? { family } : {}),
      ...(featureVersion !== undefined ? { featureVersion } : {}),
      ...(role !== undefined ? { role } : {})
    };
    const taskSuccess = taskSuccessFromResult(message.outcome, message.verification.kind, binding);
    return baseSignal({
      source: "subagent",
      kind: "deterministic",
      projectId: ctx.projectId,
      score: scoreTaskResult(message.outcome, message.verification.kind),
      boundary: "execution",
      summary: truncate(
        `${unverified ? "unverified-success " : ""}TASK_RESULT ${message.outcome}: ${message.summary}`
      ),
      createdAt: ctx.createdAt,
      episodeId: ctx.episodeId,
      runId: message.runId,
      taskId: message.taskId,
      evidenceIds: message.evidenceIds,
      ...(taskSuccess !== undefined
        ? {
            criterion: taskSuccess.criterion,
            outcomeKind: taskSuccess.outcomeKind,
            ...(taskSuccess.modelVersion !== undefined ? { modelVersion: taskSuccess.modelVersion } : {}),
            ...(taskSuccess.featureVersion !== undefined
              ? { featureVersion: taskSuccess.featureVersion }
              : {})
          }
        : {}),
      ...(modelId !== undefined ? { modelId } : {}),
      ...(role !== undefined ? { role } : {}),
      ...(family !== undefined ? { family } : {})
    });
  }
  if (message.type === "PEER_MESSAGE") {
    const score = PEER_NEGATIVE.test(message.body) ? 25 : 65;
    const modelId = ctx.modelByTask.get(message.taskId);
    return baseSignal({
      source: "subagent",
      kind: "peer",
      projectId: ctx.projectId,
      score,
      criterion: "policyCompliance",
      outcomeKind: score < 40 ? "FAIL" : "PASS",
      boundary: "review",
      summary: truncate(`peer: ${message.body}`),
      createdAt: ctx.createdAt,
      episodeId: ctx.episodeId,
      runId: message.runId,
      taskId: message.taskId,
      ...(modelId !== undefined ? { modelId } : {})
    });
  }
  return undefined;
}

/* ================================================================
 * S7-E-1: scoreUserAnswer without the trim() allocation.
 * Claim: \b word-boundary .test() is invariant under edge-whitespace
 * removal, so `/\S/.test(text)` can replace the trim+"" check and both
 * regexes can run on the raw text.
 * ================================================================ */
function replicaScoreUserAnswer(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  if (USER_NEGATIVE.test(trimmed)) return 10;
  if (USER_POSITIVE.test(trimmed)) return 90;
  return undefined;
}
const HAS_CONTENT = /\S/;
function candidateScoreUserAnswerNoTrim(text: string): number | undefined {
  if (!HAS_CONTENT.test(text)) return undefined;
  if (USER_NEGATIVE.test(text)) return 10;
  if (USER_POSITIVE.test(text)) return 90;
  return undefined;
}

{
  const rng = mulberry32(0xe77e01);
  const atoms = [
    "no", "wrong", "revert", "reject", "bad", "不行", "错误",
    "lgtm", "good", "ship", "approve", "yes", "可以",
    "nope", "goods", "alright", "词", "a", "Z", "9", "-", "_", ".",
    " ", "\t", "\n", "\r", "\u00a0", "\u2003", "\u2028", "\u2029", "\u3000", "\ufeff", ""
  ];
  for (let trial = 0; trial < 8000; trial += 1) {
    let s = "";
    const n = Math.floor(rng() * 12);
    for (let i = 0; i < n; i += 1) s += pick(rng, atoms);
    // half the trials force adversarial edge whitespace around keywords
    if (rng() < 0.5) s = `${pick(rng, [" ", "\n", "\u3000", "\u00a0", ""])}${s}${pick(rng, [" ", "\t", "\u2028", ""])}`;
    const expected = scoreUserAnswer(s);
    check("S7-E-1 replica fidelity", expected === replicaScoreUserAnswer(s), JSON.stringify(s));
    check("S7-E-1 equivalence (no-trim candidate)", expected === candidateScoreUserAnswerNoTrim(s), JSON.stringify(s));
  }
  // targeted edge cases
  for (const s of ["", "   ", "\u3000\u3000", " no ", "\u00a0不行", "a不行b", "不行", " lgtm\n", "x错误 ", "yes."]) {
    check(`S7-E-1 targeted ${JSON.stringify(s)}`, scoreUserAnswer(s) === candidateScoreUserAnswerNoTrim(s));
  }
  const realisticAnswers = ["lgtm", "no, revert this", "please also add coverage", "可以", "hmm ok then"];
  for (const [label, answers] of [
    ["realistic mix", realisticAnswers],
    ["padded mix", realisticAnswers.map((a) => `  ${a}  \n`)]
  ] as const) {
    const cur = bench(() => {
      for (const a of answers) void replicaScoreUserAnswer(a);
    }, 100000);
    const cand = bench(() => {
      for (const a of answers) void candidateScoreUserAnswerNoTrim(a);
    }, 100000);
    console.log(
      `S7-E-1 bench ${label} (5 answers, replica-vs-replica): current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/5calls`
    );
  }
}

/* ================================================================
 * S7-E-2: truncate identity fast path. Probe /^ | $| {2}|[^\S ]/:
 * when it does NOT match, replace(/\s+/g," ").trim() is the identity,
 * so the collapse+trim allocation can be skipped.
 * ================================================================ */
const NEEDS_NORMALIZE = /^ | $| {2}|[^\S ]/;
function candidateTruncateFastPath(text: string): string {
  if (!NEEDS_NORMALIZE.test(text)) {
    return text.length > 400 ? `${text.slice(0, 397)}...` : text;
  }
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > 400 ? `${trimmed.slice(0, 397)}...` : trimmed;
}

{
  // probe precondition parity over every UTF-16 code unit: a single char c
  // needs normalization iff it is whitespace other than a plain space, or a
  // leading/trailing space (single chars: " " itself).
  let parity = true;
  for (let code = 0; code < 0x10000; code += 1) {
    const ch = String.fromCharCode(code);
    const probeSays = NEEDS_NORMALIZE.test(ch);
    const truthSays = truncate(ch) !== ch;
    if (probeSays !== truthSays) {
      parity = false;
      console.error(`parity break at code unit ${code}`);
      break;
    }
  }
  check("S7-E-2 single-code-unit probe parity", parity);

  const rng = mulberry32(0xe77e02);
  const atoms = [
    "a", "Z", "9", "错", "誤", "🙂", "word", "TASK_RESULT", ":",
    " ", "  ", "\t", "\n", "\r", "\u00a0", "\u2003", "\u2028", "\u2029", "\u3000", "\ufeff", "\u200b"
  ];
  for (let trial = 0; trial < 8000; trial += 1) {
    let s = "";
    const n = Math.floor(rng() * 30);
    for (let i = 0; i < n; i += 1) {
      const atom = pick(rng, atoms);
      s += rng() < 0.1 ? atom.repeat(1 + Math.floor(rng() * 30)) : atom;
    }
    check("S7-E-2 equivalence (identity fast path)", truncate(s) === candidateTruncateFastPath(s), JSON.stringify(s.slice(0, 60)));
  }
  // boundary lengths on both the identity-hit and identity-miss forms
  for (const len of [399, 400, 401, 402]) {
    const identityHit = "ab ".repeat(Math.ceil(len / 3)).slice(0, len).trim();
    const identityMiss = `${identityHit}  \n`;
    check(`S7-E-2 boundary identity-hit len=${identityHit.length}`, truncate(identityHit) === candidateTruncateFastPath(identityHit));
    check(`S7-E-2 boundary identity-miss len=${len}`, truncate(identityMiss) === candidateTruncateFastPath(identityMiss));
  }
  const realisticHit = "TASK_RESULT SUCCESS: tests passed after refactoring the retry helper";
  const realisticMiss = "TASK_RESULT SUCCESS: did the work\n  with details";
  const kb5 = Array.from({ length: 120 }, (_, i) => `step ${i} finished ok with output lines`).join(" ");
  for (const [label, text, reps] of [
    ["realistic identity-hit 68B", realisticHit, 100000],
    ["realistic identity-miss 48B", realisticMiss, 100000],
    ["5KB identity-hit", kb5, 20000]
  ] as const) {
    const cur = bench(() => void truncate(text), reps);
    const cand = bench(() => void candidateTruncateFastPath(text), reps);
    console.log(
      `S7-E-2 bench ${label}: current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/call`
    );
  }
}

/* ================================================================
 * S7-E-3: outcomesFromRoutedRun family/role validation lifted to the
 * MODEL_ROUTED insertion point (parse family + validate role once per
 * route instead of once per TASK_RESULT). Invalid routes are stored with
 * a sentinel so that an invalid route still OVERWRITES a valid one, and
 * retries never touch family/role.
 * ================================================================ */
const FAMILIES_LOCAL: readonly TaskFamily[] = [
  "edit", "test", "review", "plan", "research", "refactor", "deploy", "unknown"
];
function familyFromRoutedLocal(value: string): TaskFamily | undefined {
  return (FAMILIES_LOCAL as readonly string[]).includes(value) ? (value as TaskFamily) : undefined;
}
function isCompleteRouteLocal(payload: ModelRoutedPayload): boolean {
  return (
    typeof payload.family === "string" &&
    payload.family.trim() !== "" &&
    typeof payload.featureVersion === "string" &&
    payload.featureVersion.trim() !== "" &&
    typeof payload.modelVersion === "string" &&
    payload.modelVersion.trim() !== "" &&
    typeof payload.agentRole === "string"
  );
}
function outcomeKindFromResultLocal(verification: string): "PASS" | "FAIL" | undefined {
  if (verification === "PASSED") return "PASS";
  if (verification === "FAILED") return "FAIL";
  return undefined;
}
function applyCascadeRetryLocal(
  routes: Map<string, ModelRoutedPayload>,
  taskId: string | undefined,
  nextModel: string | undefined,
  nextModelVersion: string | undefined
): void {
  if (taskId === undefined || nextModel === undefined || nextModel.trim() === "") return;
  const current = routes.get(taskId);
  if (current === undefined) return;
  const eligible = current.eligibleModels.includes(nextModel)
    ? current.eligibleModels
    : [...current.eligibleModels, nextModel];
  routes.set(taskId, {
    ...current,
    model: nextModel,
    modelVersion:
      nextModelVersion !== undefined && nextModelVersion.trim() !== ""
        ? nextModelVersion
        : current.modelVersion,
    behaviorDistribution: oneHotDistribution(eligible, nextModel)
  });
}
/** Verbatim replica of outcomesFromRoutedRun. */
function replicaOutcomes(events: readonly Event[]): OutcomeObservation[] {
  const routes = new Map<string, ModelRoutedPayload>();
  const out: OutcomeObservation[] = [];
  for (const event of events) {
    if (event.type === "MODEL_ROUTED") {
      const payload = event.payload;
      if (isCompleteRouteLocal(payload)) routes.set(payload.taskId, payload);
      continue;
    }
    if (event.type === "TASK_RETRY") {
      applyCascadeRetryLocal(routes, event.taskId, event.payload.nextModel, event.payload.nextModelVersion);
      continue;
    }
    if (event.type !== "CHILD_MESSAGE") continue;
    const message = event.payload.message;
    if (message.type !== "TASK_RESULT") continue;
    const route = routes.get(message.taskId);
    if (route === undefined) continue;
    const family = familyFromRoutedLocal(route.family as string);
    if (family === undefined) continue;
    const role = route.agentRole;
    if (role === undefined || !isAgentRole(role)) continue;
    const kind = outcomeKindFromResultLocal(message.verification.kind);
    if (kind === undefined) continue;
    const failureClass =
      kind === "FAIL"
        ? classifyTaskFailure({
            outcome: message.outcome,
            verificationKind: message.verification.kind,
            summary: message.summary,
            ...(message.failure !== undefined ? { failure: message.failure } : {})
          })
        : undefined;
    try {
      out.push(
        parseOutcomeObservation({
          taskFamily: family,
          role,
          modelId: route.model,
          modelVersion: route.modelVersion,
          featureVersion: route.featureVersion,
          criterion: "taskSuccess",
          outcome: kind,
          occurredAtMs: Date.parse(event.occurredAt),
          source: "deterministic-check",
          ...(failureClass !== undefined ? { failureClass } : {}),
          taskId: message.taskId,
          runId: event.runId,
          evidenceIds: message.evidenceIds
        })
      );
    } catch {
      continue;
    }
  }
  return out;
}
/** Candidate: validation lifted to insertion; stored entry carries the
 *  parsed family + validated role; retries mutate the payload only. */
interface ValidatedRoute {
  payload: ModelRoutedPayload;
  family: TaskFamily;
  role: string;
}
function candidateOutcomesLifted(events: readonly Event[]): OutcomeObservation[] {
  const routes = new Map<string, ValidatedRoute>();
  const out: OutcomeObservation[] = [];
  for (const event of events) {
    if (event.type === "MODEL_ROUTED") {
      const payload = event.payload;
      if (isCompleteRouteLocal(payload)) {
        const family = familyFromRoutedLocal(payload.family as string);
        const role = payload.agentRole;
        if (family !== undefined && role !== undefined && isAgentRole(role)) {
          routes.set(payload.taskId, { payload, family, role });
        } else {
          // faithful drop: results for this task are unusable either way,
          // but a previously stored valid route must be OVERWRITTEN by the
          // invalid one exactly like the current code does.
          routes.delete(payload.taskId);
          routes.set(payload.taskId, { payload, family: "unknown", role: "__invalid__" });
        }
      }
      continue;
    }
    if (event.type === "TASK_RETRY") {
      // faithful inline of applyCascadeRetry against the stored payload
      const taskId = event.taskId;
      const nextModel = event.payload.nextModel;
      if (taskId !== undefined && nextModel !== undefined && nextModel.trim() !== "") {
        const entry = routes.get(taskId);
        if (entry !== undefined) {
          const current = entry.payload;
          const eligible = current.eligibleModels.includes(nextModel)
            ? current.eligibleModels
            : [...current.eligibleModels, nextModel];
          const nextModelVersion = event.payload.nextModelVersion;
          entry.payload = {
            ...current,
            model: nextModel,
            modelVersion:
              nextModelVersion !== undefined && nextModelVersion.trim() !== ""
                ? nextModelVersion
                : current.modelVersion,
            behaviorDistribution: oneHotDistribution(eligible, nextModel)
          };
        }
      }
      continue;
    }
    if (event.type !== "CHILD_MESSAGE") continue;
    const message = event.payload.message;
    if (message.type !== "TASK_RESULT") continue;
    const entry = routes.get(message.taskId);
    if (entry === undefined || entry.role === "__invalid__") continue;
    const kind = outcomeKindFromResultLocal(message.verification.kind);
    if (kind === undefined) continue;
    const failureClass =
      kind === "FAIL"
        ? classifyTaskFailure({
            outcome: message.outcome,
            verificationKind: message.verification.kind,
            summary: message.summary,
            ...(message.failure !== undefined ? { failure: message.failure } : {})
          })
        : undefined;
    try {
      out.push(
        parseOutcomeObservation({
          taskFamily: entry.family,
          role: entry.role,
          modelId: entry.payload.model,
          modelVersion: entry.payload.modelVersion,
          featureVersion: entry.payload.featureVersion,
          criterion: "taskSuccess",
          outcome: kind,
          occurredAtMs: Date.parse(event.occurredAt),
          source: "deterministic-check",
          ...(failureClass !== undefined ? { failureClass } : {}),
          taskId: message.taskId,
          runId: event.runId,
          evidenceIds: message.evidenceIds
        })
      );
    } catch {
      continue;
    }
  }
  return out;
}

/* Seeded routed-run event generator (R2-E composition, with invalid
 * families/roles mixed in to exercise the lifted validation). */
const OUTCOMES: readonly TaskOutcome[] = ["SUCCESS", "PARTIAL", "FAILURE", "CANCELLED"];
const VERIFS: readonly VerificationKind[] = ["PASSED", "FAILED", "UNOBSERVED"];
function genRoutedEvents(rng: () => number, length: number): Event[] {
  const out: unknown[] = [];
  const taskIds = Array.from({ length: 10 }, (_, i) => `tsk_${i}0000000`);
  const models = ["cheap", "premium", "mid"];
  for (let i = 0; i < length; i += 1) {
    const roll = rng();
    const taskId = pick(rng, taskIds);
    if (roll < 0.3) {
      const model = pick(rng, models);
      const complete = rng() < 0.85;
      out.push({
        type: "MODEL_ROUTED",
        runId: "run_simsim01",
        occurredAt: NOW,
        payload: {
          taskId,
          model,
          role: "actor",
          eligibleModels: models,
          behaviorDistribution: oneHotDistribution(models, model),
          ...(complete ? { family: pick(rng, [...FAMILIES_LOCAL, "bogus-family", "x"]) } : {}),
          ...(complete ? { featureVersion: "fv1" } : {}),
          ...(complete ? { modelVersion: "v1" } : {}),
          ...(complete ? { agentRole: pick(rng, [...AGENT_ROLES, "actor", "not-a-role"]) } : {})
        }
      });
    } else if (roll < 0.4) {
      out.push({
        type: "TASK_RETRY",
        runId: "run_simsim01",
        occurredAt: NOW,
        taskId: rng() < 0.8 ? taskId : undefined,
        payload: {
          nextModel: rng() < 0.85 ? pick(rng, [...models, "fresh"]) : rng() < 0.5 ? "" : undefined,
          nextModelVersion: rng() < 0.6 ? "v2" : rng() < 0.5 ? " " : undefined
        }
      });
    } else if (roll < 0.7) {
      out.push({
        type: "CHILD_MESSAGE",
        runId: "run_simsim01",
        occurredAt: NOW,
        payload: {
          message: {
            type: "TASK_RESULT",
            taskId: rng() < 0.85 ? taskId : "tsk_unrouted0",
            runId: "run_simsim01",
            outcome: pick(rng, OUTCOMES),
            verification: { kind: pick(rng, VERIFS) },
            summary: pick(rng, ["tests passed", "compile error in adapter", "did the work", ""]),
            evidenceIds: rng() < 0.6 ? ["evd_00000001"] : []
          }
        }
      });
    } else {
      out.push({
        type: pick(rng, ["USER_ANSWER", "LEDGER_UPDATED", "RUN_STARTED", "TASK_STATUS_CHANGED"] as const),
        runId: "run_simsim01",
        occurredAt: NOW,
        payload: { answer: "lgtm" }
      });
    }
  }
  return out as Event[];
}

{
  const rng = mulberry32(0xe77e03);
  for (let trial = 0; trial < 4000; trial += 1) {
    const events = genRoutedEvents(rng, Math.floor(rng() * 60));
    const expected = JSON.stringify(outcomesFromRoutedRun(events));
    check("S7-E-3 replica fidelity", expected === JSON.stringify(replicaOutcomes(events)), `trial ${trial}`);
    check("S7-E-3 equivalence (lifted validation)", expected === JSON.stringify(candidateOutcomesLifted(events)), `trial ${trial}`);
  }
  // targeted: valid route overwritten by invalid route, then a result arrives
  const overwrite: Event[] = [
    {
      type: "MODEL_ROUTED", runId: "run_simsim01", occurredAt: NOW,
      payload: {
        taskId: "tsk_10000000", model: "cheap", role: "actor",
        eligibleModels: ["cheap"], behaviorDistribution: oneHotDistribution(["cheap"], "cheap"),
        family: "edit", featureVersion: "fv1", modelVersion: "v1", agentRole: AGENT_ROLES[0]
      }
    },
    {
      type: "MODEL_ROUTED", runId: "run_simsim01", occurredAt: NOW,
      payload: {
        taskId: "tsk_10000000", model: "premium", role: "actor",
        eligibleModels: ["premium"], behaviorDistribution: oneHotDistribution(["premium"], "premium"),
        family: "bogus-family", featureVersion: "fv1", modelVersion: "v1", agentRole: AGENT_ROLES[0]
      }
    },
    {
      type: "CHILD_MESSAGE", runId: "run_simsim01", occurredAt: NOW,
      payload: {
        message: {
          type: "TASK_RESULT", taskId: "tsk_10000000", runId: "run_simsim01",
          outcome: "SUCCESS", verification: { kind: "PASSED" }, summary: "ok", evidenceIds: []
        }
      }
    }
  ] as unknown as Event[];
  check(
    "S7-E-3 targeted invalid-overwrites-valid",
    JSON.stringify(outcomesFromRoutedRun(overwrite)) === JSON.stringify(candidateOutcomesLifted(overwrite))
  );
  const events41 = genRoutedEvents(mulberry32(0xe77e04), 41);
  const cur = bench(() => void replicaOutcomes(events41), 20000);
  const cand = bench(() => void candidateOutcomesLifted(events41), 20000);
  console.log(
    `S7-E-3 bench E=41 (replica-vs-replica): current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/run`
  );
}

/* ================================================================
 * S7-E-4: collectSignalsFromSubagentRun request.agent typeof-probe
 * hoisted out of the per-result loop (request is loop-invariant).
 * ================================================================ */
function extractAssistantLocal(messages: unknown): { text: string; model?: string } {
  if (!Array.isArray(messages)) return { text: "" };
  let text = "";
  let model: string | undefined;
  for (const message of messages) {
    if (!isRecordLocal(message) || message.role !== "assistant") continue;
    if (typeof message.model === "string" && message.model.trim() !== "") {
      model = message.model;
    }
    const content = message.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!isRecordLocal(part)) continue;
      if (part.type === "thinking") continue;
      if (part.type === "text" && typeof part.text === "string") {
        text = text === "" ? part.text : `${text}\n${part.text}`;
      }
    }
  }
  return model !== undefined ? { text, model } : { text };
}
/** Verbatim replica. */
function replicaCollectSubagent(raw: unknown, context: SignalContext): ObservedSignal[] {
  if (!isRecordLocal(raw) || context.projectId === undefined) return [];
  const request = isRecordLocal(raw.request) ? raw.request : {};
  const results = Array.isArray(raw.results) ? raw.results : [];
  const status = typeof raw.status === "string" ? raw.status : "";
  const signals: ObservedSignal[] = [];
  const createdAt = nowIso();
  for (const result of results) {
    if (!isRecordLocal(result)) continue;
    const agent = typeof result.agent === "string" ? result.agent : typeof request.agent === "string" ? request.agent : undefined;
    const exitCode = typeof result.exitCode === "number" ? result.exitCode : undefined;
    const extracted = extractAssistantLocal(result.messages);
    const failed =
      status === "failed" || status === "error" || exitCode === 1 || PEER_NEGATIVE.test(extracted.text);
    const score = failed ? 15 : 70;
    const kind: FeedbackKind = agent === "reviewer" || agent === "tester" ? "peer" : "deterministic";
    signals.push(
      baseSignal({
        source: "subagent",
        kind,
        projectId: context.projectId,
        score,
        boundary: failed && /unknown agent/i.test(extracted.text) ? "tool" : "execution",
        summary: truncate(extracted.text === "" ? `subagent ${status || "completed"}` : extracted.text),
        createdAt,
        episodeId: context.episodeId,
        ...(extracted.model !== undefined ? { modelId: extracted.model } : {}),
        ...(agent !== undefined ? { role: agent } : {})
      })
    );
  }
  return signals;
}
/** Candidate: requestAgent computed once per call. */
function candidateCollectSubagentHoist(raw: unknown, context: SignalContext): ObservedSignal[] {
  if (!isRecordLocal(raw) || context.projectId === undefined) return [];
  const request = isRecordLocal(raw.request) ? raw.request : {};
  const results = Array.isArray(raw.results) ? raw.results : [];
  const status = typeof raw.status === "string" ? raw.status : "";
  const requestAgent = typeof request.agent === "string" ? request.agent : undefined; // hoisted
  const signals: ObservedSignal[] = [];
  const createdAt = nowIso();
  for (const result of results) {
    if (!isRecordLocal(result)) continue;
    const agent = typeof result.agent === "string" ? result.agent : requestAgent;
    const exitCode = typeof result.exitCode === "number" ? result.exitCode : undefined;
    const extracted = extractAssistantLocal(result.messages);
    const failed =
      status === "failed" || status === "error" || exitCode === 1 || PEER_NEGATIVE.test(extracted.text);
    const score = failed ? 15 : 70;
    const kind: FeedbackKind = agent === "reviewer" || agent === "tester" ? "peer" : "deterministic";
    signals.push(
      baseSignal({
        source: "subagent",
        kind,
        projectId: context.projectId,
        score,
        boundary: failed && /unknown agent/i.test(extracted.text) ? "tool" : "execution",
        summary: truncate(extracted.text === "" ? `subagent ${status || "completed"}` : extracted.text),
        createdAt,
        episodeId: context.episodeId,
        ...(extracted.model !== undefined ? { modelId: extracted.model } : {}),
        ...(agent !== undefined ? { role: agent } : {})
      })
    );
  }
  return signals;
}
function genPiRun(rng: () => number, partCount: number, partLen: number): unknown {
  const mkParts = () => {
    const content: unknown[] = [];
    for (let i = 0; i < partCount; i += 1) {
      const r = rng();
      if (r < 0.15) content.push({ type: "thinking", text: "..." });
      else if (r < 0.25) content.push({ type: "tool_use", name: "read" });
      else if (r < 0.35) content.push({ type: "text", text: "" });
      else content.push({ type: "text", text: pick(rng, ["step ok", "found a bug", "all done", "x".repeat(partLen)]) });
    }
    return content;
  };
  return {
    status: pick(rng, ["completed", "failed", "error", ""]),
    request: rng() < 0.5 ? { agent: pick(rng, ["reviewer", "tester", "implementer", 42 as unknown as string]) } : {},
    results: Array.from({ length: 1 + Math.floor(rng() * 3) }, () => ({
      ...(rng() < 0.7 ? { agent: pick(rng, ["reviewer", "tester", "implementer"]) } : {}),
      ...(rng() < 0.7 ? { exitCode: rng() < 0.3 ? 1 : 0 } : {}),
      messages: [
        { role: "user", content: [{ type: "text", text: "task" }] },
        { role: "assistant", ...(rng() < 0.6 ? { model: "m1" } : {}), content: mkParts() },
        ...(rng() < 0.4 ? [{ role: "assistant", content: mkParts() }] : [])
      ]
    }))
  };
}
{
  const rng = mulberry32(0xe77e05);
  const ctx: SignalContext = { projectId: "prj_simsim01" as ProjectId };
  for (let trial = 0; trial < 4000; trial += 1) {
    const raw = genPiRun(rng, Math.floor(rng() * 8), 40);
    const expected = norm(collectSignalsFromSubagentRun(raw, ctx));
    check("S7-E-4 replica fidelity", expected === norm(replicaCollectSubagent(raw, ctx)), `trial ${trial}`);
    check("S7-E-4 equivalence (request.agent hoist)", expected === norm(candidateCollectSubagentHoist(raw, ctx)), `trial ${trial}`);
  }
  const realistic = genPiRun(mulberry32(0xe77e06), 6, 60);
  const cur = bench(() => void replicaCollectSubagent(realistic, ctx), 40000);
  const cand = bench(() => void candidateCollectSubagentHoist(realistic, ctx), 40000);
  console.log(
    `S7-E-4 bench realistic Pi run (replica-vs-replica): current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/file`
  );
}

/* ================================================================
 * S7-E-5: JUDGE_DECISION verdict single dispatch — one if/else chain
 * yields both score and outcomeKind instead of two ternary trees.
 * Judge double Map.get stays VERBATIM (S1-E-2 excluded edit unapplied);
 * independent if-chains stay VERBATIM (S3-E-1 unapplied).
 * ================================================================ */
function replicaCollect(events: readonly Event[], context: SignalContext = {}): ObservedSignal[] {
  let projectId = context.projectId;
  const modelByTask = new Map<string, string>();
  const modelVersionByTask = new Map<string, string>();
  const roleByTask = new Map<string, string>();
  const familyByTask = new Map<string, string>();
  const featureVersionByTask = new Map<string, string>();
  const signals: ObservedSignal[] = [];
  const createdAt = nowIso();
  for (const event of events) {
    if (event.type === "PROJECT_DISCOVERED") {
      const id = event.payload.project.id;
      projectId = id;
    }
    if (event.type === "MODEL_ROUTED") {
      modelByTask.set(event.payload.taskId, event.payload.model);
      roleByTask.set(event.payload.taskId, event.payload.role);
      if (event.payload.family !== undefined) familyByTask.set(event.payload.taskId, event.payload.family);
      if (event.payload.modelVersion !== undefined) modelVersionByTask.set(event.payload.taskId, event.payload.modelVersion);
      if (event.payload.featureVersion !== undefined) featureVersionByTask.set(event.payload.taskId, event.payload.featureVersion);
    }
  }
  if (projectId === undefined) return [];
  for (const event of events) {
    if (event.type === "CHILD_MESSAGE") {
      const fromResult = signalFromAgentMessage(event.payload.message, {
        projectId, modelByTask, modelVersionByTask, roleByTask, familyByTask, featureVersionByTask,
        episodeId: context.episodeId, createdAt
      });
      if (fromResult !== undefined) signals.push(fromResult);
    }
    if (event.type === "USER_ANSWER") {
      const score = scoreUserAnswer(event.payload.answer);
      if (score === undefined) continue;
      signals.push(baseSignal({
        source: "user", kind: "human", projectId, score,
        criterion: "userAcceptance", outcomeKind: score >= 50 ? "PASS" : "FAIL",
        boundary: "review", summary: truncate(`user: ${event.payload.answer}`),
        createdAt, episodeId: context.episodeId, runId: event.runId
      }));
    }
    if (event.type === "JUDGE_DECISION") {
      const score = event.payload.verdict === "APPROVED" ? 85 : event.payload.verdict === "REJECTED" ? 20 : 50;
      const modelId = modelByTask.get(event.payload.taskId);
      signals.push(baseSignal({
        source: "deterministic", kind: "judge", projectId, score,
        criterion: "policyCompliance",
        outcomeKind:
          event.payload.verdict === "APPROVED" ? "PASS" : event.payload.verdict === "REJECTED" ? "FAIL" : "ABSTAIN",
        boundary: "review", summary: `judge ${event.payload.verdict}`,
        createdAt, episodeId: context.episodeId, runId: event.runId,
        taskId: event.payload.taskId, evidenceIds: event.payload.evidenceIds,
        ...(modelId !== undefined ? { modelId } : {}),
        ...(roleByTask.get(event.payload.taskId) !== undefined
          ? { role: roleByTask.get(event.payload.taskId) }
          : {}),
        ...(familyByTask.get(event.payload.taskId) !== undefined
          ? { family: familyByTask.get(event.payload.taskId) }
          : {})
      }));
    }
    if (event.type === "RUN_FAILED") {
      signals.push(baseSignal({
        source: "deterministic", kind: "deterministic", projectId, score: 10,
        boundary: "execution", summary: truncate(`run failed: ${event.payload.reason}`),
        createdAt, episodeId: context.episodeId, runId: event.runId
      }));
    }
  }
  return signals;
}
/** Candidate: single verdict dispatch. Everything else verbatim. */
function candidateCollectVerdictDispatch(events: readonly Event[], context: SignalContext = {}): ObservedSignal[] {
  let projectId = context.projectId;
  const modelByTask = new Map<string, string>();
  const modelVersionByTask = new Map<string, string>();
  const roleByTask = new Map<string, string>();
  const familyByTask = new Map<string, string>();
  const featureVersionByTask = new Map<string, string>();
  const signals: ObservedSignal[] = [];
  const createdAt = nowIso();
  for (const event of events) {
    if (event.type === "PROJECT_DISCOVERED") {
      const id = event.payload.project.id;
      projectId = id;
    }
    if (event.type === "MODEL_ROUTED") {
      modelByTask.set(event.payload.taskId, event.payload.model);
      roleByTask.set(event.payload.taskId, event.payload.role);
      if (event.payload.family !== undefined) familyByTask.set(event.payload.taskId, event.payload.family);
      if (event.payload.modelVersion !== undefined) modelVersionByTask.set(event.payload.taskId, event.payload.modelVersion);
      if (event.payload.featureVersion !== undefined) featureVersionByTask.set(event.payload.taskId, event.payload.featureVersion);
    }
  }
  if (projectId === undefined) return [];
  for (const event of events) {
    if (event.type === "CHILD_MESSAGE") {
      const fromResult = signalFromAgentMessage(event.payload.message, {
        projectId, modelByTask, modelVersionByTask, roleByTask, familyByTask, featureVersionByTask,
        episodeId: context.episodeId, createdAt
      });
      if (fromResult !== undefined) signals.push(fromResult);
    }
    if (event.type === "USER_ANSWER") {
      const score = scoreUserAnswer(event.payload.answer);
      if (score === undefined) continue;
      signals.push(baseSignal({
        source: "user", kind: "human", projectId, score,
        criterion: "userAcceptance", outcomeKind: score >= 50 ? "PASS" : "FAIL",
        boundary: "review", summary: truncate(`user: ${event.payload.answer}`),
        createdAt, episodeId: context.episodeId, runId: event.runId
      }));
    }
    if (event.type === "JUDGE_DECISION") {
      // candidate edit: one dispatch computes both score and outcomeKind
      let score: number;
      let outcomeKind: OutcomeKind;
      if (event.payload.verdict === "APPROVED") {
        score = 85;
        outcomeKind = "PASS";
      } else if (event.payload.verdict === "REJECTED") {
        score = 20;
        outcomeKind = "FAIL";
      } else {
        score = 50;
        outcomeKind = "ABSTAIN";
      }
      const modelId = modelByTask.get(event.payload.taskId);
      signals.push(baseSignal({
        source: "deterministic", kind: "judge", projectId, score,
        criterion: "policyCompliance",
        outcomeKind,
        boundary: "review", summary: `judge ${event.payload.verdict}`,
        createdAt, episodeId: context.episodeId, runId: event.runId,
        taskId: event.payload.taskId, evidenceIds: event.payload.evidenceIds,
        ...(modelId !== undefined ? { modelId } : {}),
        ...(roleByTask.get(event.payload.taskId) !== undefined
          ? { role: roleByTask.get(event.payload.taskId) }
          : {}),
        ...(familyByTask.get(event.payload.taskId) !== undefined
          ? { family: familyByTask.get(event.payload.taskId) }
          : {})
      }));
    }
    if (event.type === "RUN_FAILED") {
      signals.push(baseSignal({
        source: "deterministic", kind: "deterministic", projectId, score: 10,
        boundary: "execution", summary: truncate(`run failed: ${event.payload.reason}`),
        createdAt, episodeId: context.episodeId, runId: event.runId
      }));
    }
  }
  return signals;
}

/* Seeded event-log generator (R1-A composition: E~41). */
const ROLES = ["actor", "critic", "tester", "planner", "scout", "reviewer"] as const;
const FAMS = ["edit", "test", "review", "plan", "research"] as const;
const ANSWERS = ["lgtm", "no, revert this", "please also add coverage", "可以", "不行 错误", "hmm"];
const PEERS = ["found a bug in the ledger", "looks fine to me", "missing tests", "unknown agent addressed", "ok"];
function genEvents(rng: () => number, length: number, opts?: { forceProject?: boolean }): Event[] {
  const out: unknown[] = [];
  const taskIds = Array.from({ length: 10 }, (_, i) => `tsk_${i}0000000`);
  if (opts?.forceProject !== false) {
    out.push({ type: "PROJECT_DISCOVERED", payload: { project: { id: "prj_simsim01", rootPath: "/tmp/x" } } });
  }
  for (let i = 0; i < length; i += 1) {
    const roll = rng();
    const taskId = pick(rng, taskIds);
    if (roll < 0.05) {
      out.push({ type: "PROJECT_DISCOVERED", payload: { project: { id: `prj_p${Math.floor(rng() * 3)}simsim`, rootPath: "/tmp/x" } } });
    } else if (roll < 0.3) {
      out.push({
        type: "MODEL_ROUTED",
        payload: {
          taskId,
          model: pick(rng, ["cheap", "premium", "mid"]),
          role: pick(rng, ROLES),
          ...(rng() < 0.8 ? { family: pick(rng, FAMS) } : {}),
          ...(rng() < 0.8 ? { modelVersion: "v1" } : {}),
          ...(rng() < 0.8 ? { featureVersion: "fv1" } : {})
        }
      });
    } else if (roll < 0.55) {
      const isResult = rng() < 0.6;
      out.push({
        type: "CHILD_MESSAGE",
        payload: {
          message: isResult
            ? {
                type: "TASK_RESULT",
                taskId: rng() < 0.85 ? taskId : "tsk_unrouted0",
                runId: "run_simsim01",
                outcome: pick(rng, OUTCOMES),
                verification: { kind: pick(rng, VERIFS) },
                summary: pick(rng, ["tests passed", "did the work\n  with details", "failed to compile", ""]),
                evidenceIds: rng() < 0.6 ? ["evd_00000001"] : []
              }
            : { type: "PEER_MESSAGE", taskId, runId: "run_simsim01", body: pick(rng, PEERS) }
        }
      });
    } else if (roll < 0.65) {
      out.push({ type: "USER_ANSWER", runId: "run_simsim01", payload: { answer: pick(rng, ANSWERS) } });
    } else if (roll < 0.75) {
      out.push({
        type: "JUDGE_DECISION",
        runId: "run_simsim01",
        payload: {
          taskId,
          verdict: pick(rng, ["APPROVED", "REJECTED", "NEEDS_USER_DECISION"] as const),
          evidenceIds: rng() < 0.5 ? ["evd_00000002"] : []
        }
      });
    } else if (roll < 0.8) {
      out.push({ type: "RUN_FAILED", runId: "run_simsim01", payload: { reason: "boom  reason" } });
    } else {
      out.push({ type: pick(rng, ["LEDGER_UPDATED", "TASK_STATUS_CHANGED", "RUN_STARTED"] as const), payload: {} });
    }
  }
  return out as Event[];
}

{
  const rng = mulberry32(0xe77e07);
  for (let trial = 0; trial < 4000; trial += 1) {
    const events = genEvents(rng, Math.floor(rng() * 60), { forceProject: rng() < 0.9 });
    const ctx: SignalContext = rng() < 0.5 ? { episodeId: "ep_simsim01" as EpisodeId } : {};
    const expected = norm(collectSignalsFromEvents(events, ctx));
    check("S7-E-5 replica fidelity", expected === norm(replicaCollect(events, ctx)), `trial ${trial}`);
    check("S7-E-5 equivalence (verdict single dispatch)", expected === norm(candidateCollectVerdictDispatch(events, ctx)), `trial ${trial}`);
  }
  const events41 = genEvents(mulberry32(0xe77e08), 40);
  const cur = bench(() => void replicaCollect(events41, {}), 20000);
  const cand = bench(() => void candidateCollectVerdictDispatch(events41, {}), 20000);
  console.log(
    `S7-E-5 bench E=41 (replica-vs-replica): current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/run`
  );
}

/* ================================================================
 * SLICE-CPU anchor re-verification (R3-E..R6-E): total in-slice CPU on
 * one full auto-adapt run at real scale vs the landing bar (>=10ms).
 * Production imports carry the absolute-magnitude anchor role.
 * ================================================================ */
function genSignal(rng: () => number): ObservedSignal {
  const criterion = pick(rng, ["taskSuccess", "userAcceptance", "policyCompliance", undefined] as const);
  return {
    source: pick(rng, ["user", "subagent", "deterministic"] as const),
    kind: pick(rng, ["human", "peer", "judge", "deterministic"] as const),
    projectId: pick(rng, ["prj_a0000000", "prj_b0000000"]) as ProjectId,
    score: Math.floor(rng() * 101),
    boundary: "execution",
    summary: "s",
    createdAt: NOW,
    evidenceIds: [],
    ...(rng() < 0.85 ? { modelId: pick(rng, ["m1", "m2", "m3", "  ", ""]) } : {}),
    ...(criterion !== undefined ? { criterion } : {}),
    ...(rng() < 0.7 ? { family: pick(rng, FAMS) } : {}),
    ...(rng() < 0.5 ? { outcomeKind: pick(rng, ["PASS", "FAIL"] as const) } : {})
  };
}
function replicaBanditBuild(previous: BanditState | undefined, signals: readonly ObservedSignal[]): BanditState {
  const arms = new Set(previous?.arms ?? []);
  for (const signal of signals) {
    if (signal.modelId !== undefined && signal.modelId.trim() !== "") {
      arms.add(signal.modelId);
    }
  }
  const armList = [...arms];
  let state = createBanditState(armList);
  if (previous !== undefined) {
    const pulls: Record<string, number> = {};
    const rewardSum: Record<string, number> = {};
    for (const arm of armList) {
      pulls[arm] = previous.pulls[arm] ?? 0;
      rewardSum[arm] = previous.rewardSum[arm] ?? 0;
    }
    state = {
      arms: armList,
      pulls,
      rewardSum,
      explorationsUsed: previous.explorationsUsed,
      highRiskExplorations: previous.highRiskExplorations
    };
  }
  for (const signal of signals) {
    if (signal.criterion !== "taskSuccess") continue;
    if (signal.source === "user" || signal.kind === "human" || signal.kind !== "deterministic") continue;
    if (signal.modelId === undefined || !state.arms.includes(signal.modelId)) continue;
    if (signal.outcomeKind === "PASS") {
      state = recordReward(state, signal.modelId, 1);
    } else if (signal.outcomeKind === "FAIL") {
      state = recordReward(state, signal.modelId, 0);
    }
  }
  return state;
}
{
  const events = genEvents(mulberry32(0xe77e08 + 1), 40);
  const collectCost = bench(() => void collectSignalsFromEvents(events, {}), 20000);

  const rng = mulberry32(0xe77e08 + 2);
  const routed: unknown[] = [];
  const models = ["cheap", "premium", "mid"];
  for (let i = 0; i < 10; i += 1) {
    const model = pick(rng, models);
    routed.push({
      type: "MODEL_ROUTED", runId: "run_simsim01", occurredAt: NOW,
      payload: {
        taskId: `tsk_${i}0000000`, model, role: "actor",
        eligibleModels: models, behaviorDistribution: oneHotDistribution(models, model),
        family: pick(rng, FAMILIES_LOCAL), featureVersion: "fv1", modelVersion: "v1",
        agentRole: pick(rng, AGENT_ROLES)
      }
    });
    routed.push({
      type: "CHILD_MESSAGE", runId: "run_simsim01", occurredAt: NOW,
      payload: {
        message: {
          type: "TASK_RESULT", taskId: `tsk_${i}0000000`, runId: "run_simsim01",
          outcome: pick(rng, ["SUCCESS", "FAILURE"] as const),
          verification: { kind: pick(rng, ["PASSED", "FAILED"] as const) },
          summary: "tests passed", evidenceIds: []
        }
      }
    });
  }
  const routedEvents = routed as Event[];
  const outcomesCost = bench(() => void outcomesFromRoutedRun(routedEvents), 20000);

  const sRng = mulberry32(0xe77e08 + 3);
  const signals12 = Array.from({ length: 12 }, () => genSignal(sRng));
  const diagnoseCost = bench(() => void diagnoseModelProjectIssues(signals12), 40000);

  const bRng = mulberry32(0xe77e08 + 4);
  const previous = replicaBanditBuild(undefined, Array.from({ length: 30 }, () => genSignal(bRng)));
  const banditSignals = Array.from({ length: 12 }, () => genSignal(bRng));
  const banditCost = bench(() => void replicaBanditBuild(previous, banditSignals), 40000);

  const totalUs = (collectCost + outcomesCost + diagnoseCost + banditCost) * 1e3;
  console.log(
    `SLICE-CPU anchor re-verify: collect=${(collectCost * 1e3).toFixed(1)}us outcomes=${(outcomesCost * 1e3).toFixed(1)}us diagnose=${(diagnoseCost * 1e3).toFixed(2)}us bandit-build=${(banditCost * 1e3).toFixed(1)}us | total in-slice CPU ~${totalUs.toFixed(1)}us per run vs landing bar >=10000us (${(10000 / totalUs).toFixed(0)}x below even if zeroed)`
  );
}

if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```
