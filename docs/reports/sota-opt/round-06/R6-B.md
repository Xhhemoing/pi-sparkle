# R6-B：live 路由切片 Round 6 六搜报告

**战役:** 全库持久 SOTA 优化 Round 6 / R6-B（十区之一，R1-B/R2-B/R3-B/R4-B/R5-B 的第六遍）
**基线:** `cursor/sota-persistent-opt-83a1` @ `d3c3570`（含 S5-C、S5-F、S5-J 排除并入）
**分支:** `cursor/r6-b-live-routing-sixth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动；R4-B/R5-B 的整片成本天花板经第三次复测
成立。** 关键前提事实：切片 8 个文件加 4 个只读上下游自 R1-B 的裁决基线
`94ed3d9` 以来**逐字节零变化**（`git diff 94ed3d9..d3c3570` 对 12 个文件为空；
R5-B 基线 `a695ca8` 之后全 src 树的合入——S5-C `lin-alg.ts`、S5-F
`experiments/plan.ts`、S4-I 收尾 `cli/main.ts`/`auth-session.ts`——均在切片外），
R1-B 的结构下界论证、R4-B 的聚合天花板论证与 S1-B-1..8、S2-B-1..4、S3-B-1..6、
S4-B-1..5、S5-B-1..4 全部裁决对当前代码原样成立。

天花板本轮实测复核为 **9.3–14.1 ms/eval（M=2）/ 19.0–19.8 ms/eval（M=10）**，
R5-B 的 replay-faithful token-free 口径复测 **7.3–8.7 ms/eval**——与 R5-B 的
8.3–8.7 ms 同带（M=2 首次运行 14.1 ms 为冷 VM/JIT 预热离群，第 2/3 次运行
9.3–9.6 ms 回到 R4-B/R5-B 区间）。落地线（数十~数百 ms 或复杂度类下降）依旧
不可达：即使把整个切片成本消为零也在落地线下沿之下，且 R1-B §2 已逐函数关闭
复杂度类通道。

在此前五轮五组透镜之外，本轮换第六组新透镜穷举，得到 5 个排除表未覆盖的新提案
（S6-B-1 … S6-B-5），全部经理论 + 确定性仿真（seeded mulberry32，等价性 fuzz +
真实规模基准 + 发散/身份见证，三次独立运行 `CONCLUSIONS` 行逐位一致、基准方向
一致）裁决后淘汰：2 个等价但深度噪声级（S6-B-1、S6-B-3），1 个可观察身份改变
（S6-B-2），2 个廉价形式不等价且正确形式被上界/自败论证封死（S6-B-4、S6-B-5）。
未重开任何 X* / S1-* / S2-* / S3-* / S4-* / S5-* 条目。按指令不硬凑赢家：现状
仍为该数据面契约下的 SOTA。

## 0. 范围与约束遵守

- 切片：`src/routing/{r0,assign,policy,live-cascade,analyze-task,primary-catalog,catalog-model}.ts`、
  `src/supervisor/model-router.ts` 全量重读；上下游 `assign-plan.ts`、`live-selection.ts`、
  `capability-registry.ts`、`cascade-evidence.ts`、`learning/learned-routing.ts`
  只读取证，一行未改。
- 先读并遵守（顺序强制）：README / EXCLUSIONS.md（全表，含 S5-J/S5-G/S5-H 新条目）/
  round-06/PLAN.md / round-01/R1-B.md … round-05/R5-B.md。
- 基线漂移检查：`git diff --stat 94ed3d9..d3c3570 -- <切片 8 文件 + 上下游 4 文件>`
  为空（工具验证输出 `SLICE+NEIGHBORS BYTE-IDENTICAL since 94ed3d9`）。
  `git diff --stat a695ca8..d3c3570 -- src/` 全 src 仅 `cli/main.ts`、
  `experiments/plan.ts`、`pi-adapter/auth-session.ts`、`routing/lin-alg.ts`
  四个切片外文件。R1-B…R5-B 的规模测量、调用方图景与全部裁决对当前代码原样成立。
- 换名重提检查：本轮枚举中识别出并**未列为新候选**的既有方案换名——
  批内共享请求/骨架（S3-B-6/S4-B-5 家族）、分区记忆化（S3-B-1/X1-6）、
  toModelDescriptor 预建（R1-B §4.4 三通道）、planAssignmentPolicy 全目录特化
  （S2-B-4）、role 前置短路（S1-B-3）、analyzeTask 尾部条件 spread 消除
  （S4-D-1/S1-C-10 家族，逐字节同型抖动域）、validateConfig 小表 Set 化
  （S1-D-8 类，R2-B 收口已记）。
- R1/posterior/offline-* 未碰；live 保持 R0 等价，R1 未接线：`live-isolation`
  3/3 绿（§6）。三线规格（分析不改 in-flight、Tracking 无命令权、H/score 不写
  路由、双 LCB 双归因保留、提升 proposal-first、Checkpoint F-PROD 开放）零 diff
  天然满足。不声称 Outcome-supported。
- 零 diff，公开 API / 决策对象 schema / refusal 消息优先级 / tie-break 语义
  天然不变。无阈值改动，无测试改动。

## 1. 第六遍搜索方法与调用方图景复核

R1-B 用「输出契约渐近下界」，R2-B 用「跨模块身份/重复归一化/姊妹变体」，R3-B 用
「批内去重/比较器热循环/语义面与分配消除」，R4-B 用「聚合天花板/多模式自动机/
约束依赖分解/分配来源穷尽」，R5-B 用「死值谓词/哨兵恒假约束/字符串构造原语/
中间聚合对象」。本轮换第六组透镜：

1. **同数据双遍构造透镜**：找同一数组被两个 O(E) 遍历分别构造两个输出的路径
   （产出 S6-B-1——`buildDecision` 的 `eligible.map` + `oneHotDistribution`）。
2. **常量子对象享元透镜**：找每次决策重复构造的字面量常量子对象
   （产出 S6-B-2——`makeApprovalPlan` 的 `route:cancel` 取消项）。
3. **正则引擎交替次序透镜**：`.test()` 布尔存在性对交替项排列不变，按语料频率
   前置常见 token 是否可省回溯（产出 S6-B-3——HIGH_RISK_RE 交替重排；与
   S1-B-1 去重、S1-B-3 分支重排、S4-B-1 单遍化均不同：不动正则数量与分支
   结构，只动单个正则内部次序）。
4. **恒等变换检测透镜**：跨模块调用在特定输入下是否恒等、可否在调用点守卫跳过
   （产出 S6-B-4——空 avoid/prefer 的 `applyLearnedRouting`；产出 S6-B-5——
   全目录 allow-list 的 allowed-Set）。

调用方图景复核（grep 全 src 取证，与 R5-B 记录逐条一致，且因 src 树切片外
四文件之外零变化而必然一致）：`routeR0` 唯一生产调用方仍是
`r1-shadow-report.ts`；`applyCascade` 生产不可达（`applyEvidenceCascade` 在
src 内无调用方）；`decideLiveCascade` 在 `run/child-coordinator.ts` 每 child
结果一次；`assignTasks` 调用方为 `cli/main.ts`（N≤30）、`track/primary-split.ts`，
最大规模入口 `adaptation/eval-routing.ts` N=episodes ×2（baseline+candidate）。
R5-B 的取证维持：最大规模入口任务只带 taskId/role/objective（token-free、
`budgetUsd=+∞`、`deadlineMs=MAX_SAFE_INTEGER`、fixed 字段走属性读）。

## 2. 天花板复测：R4-B/R5-B 收口第三次复核成立

实测（本 VM，三次运行区间；语料生成器与 R4-B/R5-B 逐字节相同、种子 `0xb44b01`
复用以保证可比；完整脚本见附录）：

```text
ceiling eval-replay N=2000: assignTasks M=2 4637.0–7056.6us | M=10 9523.9–9899.2us | analyzeTask share 1092.1–1147.1us (16–25%)
ceiling per eval run (x2 calls): M=2 total=9.27–14.11ms | M=10 total=19.05–19.80ms | analyzeTask total=2.18–2.29ms
ceiling replay-faithful (token-free) N=2000: assignTasks M=2 3653.0–4344.0us per call (7.31–8.69ms per eval x2)
ceiling 10x stress N=20000: assignTasks M=2 52.1–55.0ms per call (104.2–109.9ms per eval x2)
ceiling CLI live face N=30: assignTasks M=2 51.5–66.9us per call
```

推论链（R4-B §2 / R5-B §2 的各条在复测数字上原样成立）：

1. M=2 天花板 9.3–14.1 ms/eval（首次运行 14.1 ms 为 tsx 首装 + JIT 预热的冷
   VM 离群；第 2/3 次 9.27–9.55 ms 落回 R4-B 的 9.7–11.8 与 R5-B 的
   10.96–11.52 邻带）；M=10 19.0–19.8 ms/eval 与 R5-B 的 18.6–18.9 同带。
2. R5-B 的收紧口径复测成立：token-free 真实回放 7.3–8.7 ms/eval——真实天花板
   比保守口径更低，离落地线更远。
3. 复杂度类通道维持关闭：R1-B §2 逐函数下界（排序即输出 Ω(M log M)、全约束
   评估即 rejection-matrix 契约 Θ(M×约束数)、决策构造 Θ(输出字段数)）在逐字节
   未变的代码上原样成立。
4. 结构性重开条件不变：10× 压力（N=20000）下切片全量 ~104–110 ms/eval，届时
   20–30% 级候选才开始触线。

## 3. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S6-B-1 | `buildDecision` 的 `eligible.map(id)` 与 `oneHotDistribution` 融合单遍（一个循环同时构造 id 列表与 one-hot 记录） | 两个 O(E) 遍历 → 一个；免一次中间数组重扫 | ✅ 3000 组 fuzz 对真实 `router.route` 逐字节（replica 保真先行） | N=2000 批（route-only）省 39.7–72.7µs | 淘汰：深度噪声；现实 E≤2 时「两遍」共 4 次微迭代（§4.1） |
| S6-B-2 | `makeApprovalPlan` 取消项 `route:cancel` 字面量提升为模块级冻结享元单例 | 每决策免 1 次 4 字段对象分配 | ❌ 身份论证：当前 `approvalPlan.items[1]` 跨 decision 互异（探针 true 三次），单例使之别名 | 上界：makeApprovalPlan 全量 26–30ns/决策 → N=2000 批 51.5–60.4µs | 淘汰：可观察身份改变（S1-A-7/S4-B-3 先例）+ 收益上界即噪声（§4.2） |
| S6-B-3 | HIGH_RISK_RE 交替项频率重排（production/prod 前置于 deploy(?:…) 等长尾项） | `.test()` 对交替排列不变（匹配存在性 = (位置,交替项) 对集合非空，排列不改集合）；命中文本或可省回溯 | ✅ 12000 组 fuzz 逐字节（replica 保真先行） | micro 命中 305–312→303–307ns、非命中 626–631→624–629ns（≤5ns）；批 delta 4.0–42.3µs 纯抖动 | 淘汰：零收益。非命中主导路径引擎在每个位置都要试尽交替项，次序无可省；irregexp 的 Boyer-Moore 预检使命中路径也无差（§4.3） |
| S6-B-4 | `assignPlanned` 对 `avoid`/`prefer` 皆空的 learned 策略跳过 `applyLearnedRouting` 调用 | 空 avoid/prefer 时 avoided=∅、kept=全量，直觉上恒等 | ❌ 一般契约发散见证 + ✅ 切片内路径 3000 组 fuzz 值等价 | 上界 278.4–403.5µs/批——且仅当调用方传「已定义但空」策略时可达（learned===undefined 已有跳过） | 淘汰：一般契约不等价（见证：preferredModel ∉ allow-list 时空策略仍改写为 primaryModelId）；切片内等价依赖未承诺的「preferredModel ∈ allowedModels」路径不变量（S2-B-1 型跨模块脆弱性）；收益在 S1-B 捆绑同噪声带且触发条件存疑（§4.4） |
| S6-B-5 | `partitionLiveCandidates` 全目录 allow-list 长度守卫跳过 allowed-Set 构建 | assignTasks 主路径 allowedModels ≡ 全目录，Set 成员判断恒 true | ❌ 廉价形式发散见证（重复 id）；正确形式自败论证 | 上界：`new Set(allowedModels)` M=2 仅 35ns/route → N=2000 批 69.7–70.4µs | 淘汰：`allowedModels=["cheap","cheap"]` 使长度守卫误判全覆盖、放行 premium（三次见证一致）；正确守卫必须去重——即构建它想跳过的那个 Set，自败；上界本身也是深度噪声（§4.5） |

## 4. 关键裁决细节

### 4.1 S6-B-1：融合正确但两遍本来就只有四步

等价成立（3000 组 fuzz 对真实 router 逐字节，含 key 插入序——one-hot 记录的键
序由 eligible 顺序决定，融合与两遍一致）。但现实目录 E≤2：`eligible.map` +
`oneHotDistribution` 合计 4 次微迭代 + 1 次小数组分配，融合省下的是其中一半的
循环开销，实测 39.7–72.7µs/批（N=2000，route-only 口径），占批 <5%、换算
<0.15ms/eval——S4-B-4/S5-B-4 同一深度噪声带。决策构造是输出契约本体
（R1-B §2），无复杂度类可降。

### 4.2 S6-B-2：第五个身份否决，先例链继续

`route:cancel` 取消项是纯常量字面量，享元化纸面必赚。但身份探针（三次一致）：
当前两个 decision 的 `approvalPlan.items[1]` 是互异对象；模块级单例使
`d1.approvalPlan.items[1] === d2.approvalPlan.items[1]` 由 false 翻 true。
`approvalPlan` 是 `RoutingDecision`（事件契约输出）的公开字段，对象身份可观察
——与 S1-A-7（anomalyCodes 别名）、S1-B-8（allowedIds 拷贝省略）、S4-B-3
（空 failures 单例）同一先例链的第五例。且冻结单例一旦有任何调用方原地变异
未冻结副本的期望（如审批 UI 标注选中态）即跨决策污染。收益上界实测即
makeApprovalPlan 全量 26–30ns/决策（单例只能省其中取消项一半），N=2000 批
上界 51.5–60.4µs——身份论证之外收益也在噪声底。

### 4.3 S6-B-3：交替次序在两个方向上都无可省

理论面完备：`\b(A|B|C)\b/i` 的 `.test()` 只问「是否存在 (位置, 交替项) 匹配对」，
排列不改集合非空性（12000 组 fuzz 逐字节确认，含 `prod`/`production` 前缀
遮蔽情形——`\b` 使短项在长词内匹配失败后正确回溯到长项）。但价值面双关：

1. **非命中主导**：真实语料多数任务不含高风险 token，引擎在每个起始位置都要
   试尽全部交替项才能否定——次序只影响「先试谁」，不影响总尝试量。
2. **命中路径也无差**：V8 irregexp 对多交替 `\b(...)\b` 生成首字符 Boyer-Moore
   预检表，跳位在交替项排列下不变。micro 三次一致差 ≤5ns（305–312 vs
   303–307ns），批 delta 4.0–42.3µs 且带宽即抖动带宽——实测证实零收益。

与 S1-B-1（去重求值）、S1-B-3（分支间布尔重排）、S4-B-1（单遍多模式自动机）
互不重叠：本候选只动单个正则内部排列，三者的排除理由（噪声/噪声/不等价+域）
不适用，故独立立 ID 后以「实测零收益」封死。

### 4.4 S6-B-4：空策略不是恒等——发散见证直接出自公开函数

发散见证（对真实 `applyLearnedRouting` 直接调用，三次一致）：

```ts
applyLearnedRouting("edit", ["m1","m2"], "m0", { primaryModelId: "m2", avoid: [], prefer: [] })
// -> { allowedModels: ["m1","m2"], preferredModel: "m2" }   // 跳过则保 "m0"
```

即空 avoid/prefer 的策略在 preferredModel ∉ allow-list 时**仍有效果**（尾部
兜底链把 preferredModel 改写为 primaryModelId）。切片内 `assignPlanned` 路径
恰好满足「pickPreferredModel 产物 ∈ plan.allowedIds ∪ {空 allow-list 时任意}」
这一**未承诺**不变量（3000 组 fuzz 值等价证实），但该不变量不在任何签名或
测试锁定中——`pickPreferredModel` 的 `cheapestAssignableId ?? catalogIds[0]`
兜底在 assignable 为空时可返回目录外 id（此时 route 对空 allowedModels 抛错，
两侧同 THROW，等价性靠错误路径巧合维持）。S2-B-1 型跨模块脆弱性的教科书案例。
收益面：278.4–403.5µs/批的上界仅当调用方传「已定义但空」的策略时才可达——
`learned === undefined` 的主路径已有跳过；eval-routing 传入的提案策略按构造
非空。双重否决。

### 4.5 S6-B-5：守卫自败——正确性检查的成本就是被跳过的成本

assignTasks 主路径 `allowedModels ≡ [...plan.allowedIds] ≡ 全目录`，allowed-Set
的每次 `has` 恒 true，直觉上「length === models.length 时跳过 Set」白赚。发散
见证（三次一致）：`allowedModels=["cheap","cheap"]` 对 M=2 目录长度相等但只
覆盖 cheap——naive 快路径放行 premium（`eligibleModels=[cheap,premium]` vs
正确 `[cheap]`），且 `validateInput` 不禁止重复 id（非空字符串数组即合法）。
正确守卫必须先证「allowedModels 无重复且覆盖目录」——去重检查本身就要构建
一个 Set，恰是被跳过的那份工作，净收益恒 ≤0（自败）。即便忽略正确性，上界
也只有 35ns/route × N=2000 ≈ 70µs/批。理论自败 + 上界噪声，双关封死。

## 5. 逐文件收口（第六遍透镜下的残余检查）

| 文件 | 检查项 | 结论 |
| --- | --- | --- |
| `supervisor/model-router.ts` | S6-B-1 淘汰（噪声）；S6-B-2 淘汰（身份）；S6-B-5 淘汰（自败 + 上界）；S5-B-4、S3-B-5、S2-B-2、S1-B-7 维持；`toModelDescriptor` 16% 维持 R1-B §4.4 架构裁决 | 无候选 |
| `analyze-task.ts` | S6-B-3 淘汰（实测零收益）；S1-B-1/2/3、S4-B-1、S5-B-1/3 维持；尾部条件 spread = S4-D-1/S1-C-10 家族抖动域，未立新 ID | 无候选 |
| `assign.ts` | S6-B-4 淘汰（一般契约发散 + 未承诺不变量 + 触发条件存疑）；S1-B-8/S2-B-1/S3-B-1/S4-B-4/S4-B-5 维持；防御拷贝护栏维持 | 无候选 |
| `policy.ts` | 无新面；S5-B-2（含 deadline 姊妹封死）、S4-B-2/3 维持；全约束独立评估为契约下界维持 | 无候选 |
| `r0.ts` | 无新面；S1-B-6/S2-B-3/S3-B-4/S4-B-3 维持；排序输出即契约（R1-B §2 下界）；`applyCascade` 生产不可达维持 | 无候选 |
| `live-cascade.ts` | 无新面；S1-B-4/5、S3-B-2/3 维持；`stay` 闭包亚噪声维持 R2-B 裁决 | 无候选 |
| `primary-catalog.ts` / `catalog-model.ts` | 纯构造 Θ(字段)；`catalogFromPrimary` 产出已按成本升序（fast, primary），下游 `cheapFirstTiers` 对 2 元已序数组的排序为亚噪声、且排序是公开输出不可省；条件 spread 属性存在性可观察维持（S1-C-10 类） | 无候选 |
| （跨切片，只记录不改） | `planAssignmentPolicy` 双 `[...].sort` 取 max/min = S2-B-4 维持；`compareLiveCandidates` localeCompare = S3-B-3 冻结面 | 不属本切片 |

## 6. 前后对比与测试

无代码 diff。仓库变更仅本报告一个文件。零改动下相关套件复核全绿：

```bash
npx tsx --test test/unit/routing/*.test.ts test/unit/supervisor/*.test.ts
# tests 260 / suites 18 / pass 260 / fail 0
npx tsx --test test/unit/routing/live-isolation.test.ts
# tests 3 / pass 3 / fail 0   （live 面不 import R1/bandit/shadow 继续成立）
```

仿真（临时脚本未入库——无赢家不落地死代码；完整源码见附录，seeds
`0xb66b01`–`0xb66b05`，天花板语料复用 R4-B 的 `0xb44b01`）最终一次运行：

```text
ceiling eval-replay N=2000: assignTasks M=2 4637.0us | M=10 9886.7us | analyzeTask share 1147.1us (25%)
ceiling per eval run (x2 calls): M=2 total=9.27ms | M=10 total=19.77ms | analyzeTask total=2.29ms
ceiling replay-faithful (token-free) N=2000: assignTasks M=2 3653.0us per call (7.31ms per eval x2)
ceiling 10x stress N=20000: assignTasks M=2 52.1ms per call (104.2ms per eval x2)
ceiling CLI live face N=30: assignTasks M=2 51.5us per call
S6-B-1 bench N=2000 (route-only): two-pass=1418.9us fused=1349.8us delta=69.0us per batch
S6-B-2: approvalPlan.items[1] distinct across decisions = true -> a shared frozen singleton flips this to false (observable identity change, S1-A-7/S4-B-3 precedent)
S6-B-2 upper bound: makeApprovalPlan full cost=30ns per decision -> N=2000 batch upper bound 60.4us
S6-B-3 bench N=2000: current-order=1109.1us reordered=1105.2us delta=3.97us per batch
S6-B-3 micro high-risk hit: current=312ns reordered=307ns
S6-B-3 micro no-hit edit: current=631ns reordered=629ns
S6-B-4 witness: applyLearnedRouting(family=edit, allowed=[m1,m2], preferred=m0, {avoid:[], prefer:[]}) -> preferredModel=m2; skip would keep m0 -> diverges=true (empty avoid/prefer is NOT the identity on the public contract)
S6-B-4 bench N=2000: with-empty-learned=4298.0us skip-branch=3894.5us delta=403.5us per batch (upper bound; only reachable when a caller passes an empty-but-defined policy)
S6-B-5 witness allowedModels=["cheap","cheap"] on M=2 catalog: current eligibleModels=[cheap] naive-fastpath=[cheap,premium] -> diverges=true; a correct guard must deduplicate, i.e. build the very Set it tries to skip
S6-B-5 upper bound: new Set(allowedModels) M=2 = 35ns per route -> N=2000 batch upper bound 69.7us

CONCLUSIONS: ceiling M=2 per-eval=9.3ms M=10 per-eval=19.8ms replay-faithful=7.3ms (holds-below-landing-line=true) | S6-B-1 equal=true | S6-B-2 current-distinct=true | S6-B-3 equal=true | S6-B-4 witness-diverges=true in-slice-equal=true | S6-B-5 naive-diverges=true
ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

三次独立运行 `CONCLUSIONS` 行**逐位一致**（等价/见证结论全部确定性复现），
基准方向三次一致且带宽稳定：天花板 M=2 9.27–14.11ms（首次冷 VM 离群 14.11，
第 2/3 次 9.27–9.55）/ M=10 19.05–19.80ms / token-free 7.31–8.69ms / 10×
压力 104.2–109.9ms；S6-B-1 39.7–72.7µs、S6-B-2 上界 51.5–60.4µs、S6-B-3
4.0–42.3µs（micro ≤5ns，纯抖动）、S6-B-4 278.4–403.5µs、S6-B-5 上界
69.7–70.4µs。S6-B-4/5 发散见证三次全部 `diverges=true`。

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S6-B-1 | buildDecision eligibleModels map 与 oneHotDistribution 融合单遍 | 等价（3000 fuzz 对真实 router 逐字节）但 N=2000 批仅省 39.7–72.7µs，深度噪声；现实 E≤2 两遍共 4 次微迭代 |
| S6-B-2 | makeApprovalPlan 取消项 route:cancel 模块级冻结享元单例 | 不等价：approvalPlan.items 跨 decision 身份互异是可观察契约（S1-A-7/S4-B-3 先例链第五例）；上界 51.5–60.4µs/批也在噪声底 |
| S6-B-3 | HIGH_RISK_RE 交替项频率重排（production/prod 前置） | 等价（.test() 排列不变性 + 12000 fuzz）但实测零收益：micro ≤5ns、批 4.0–42.3µs 纯抖动——非命中主导路径试尽交替项与次序无关，irregexp BM 预检使命中路径亦无差 |
| S6-B-4 | assignPlanned 对空 avoid/prefer learned 策略跳过 applyLearnedRouting | 一般契约不等价（发散见证：空策略仍把 allow-list 外的 preferredModel 改写为 primaryModelId）；切片内等价依赖未承诺的 preferredModel∈allowedModels 路径不变量（S2-B-1 型）；278–404µs/批上界仅在「已定义但空」策略下可达 |
| S6-B-5 | partitionLiveCandidates 全目录长度守卫跳过 allowed-Set | 廉价长度守卫不等价（重复 id 见证 ["cheap","cheap"] 放行 premium）；正确守卫需去重即自建被跳过的 Set，净收益恒 ≤0（自败）；上界 69.7–70.4µs/批 |

**结构性重开条件（对整个切片，与 R4-B/R5-B 一致并经本轮第三次复测确认）**：
eval 数据集规模增长 ≥1 个量级（N≥20000 时切片全量 ~104–110 ms/eval，20–30%
级候选开始触线），或 analyzeTask/route 进入每 turn 热路径，或出现新的高频
调用方。逐候选重开条件：S6-B-1/3 需先满足结构性条件（等价证据本报告已备，可
直接引用）；S6-B-2 需先推翻 approvalPlan 子对象身份契约论证；S6-B-4 需
applyLearnedRouting 签名正式承诺空 avoid/prefer 恒等（或 preferredModel∈
allowedModels 成为受测承诺）；S6-B-5 需先推翻重复 id 见证（即 validateInput
禁止重复 id，属行为面变更，超出本战役范围）。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.ts` 后 `npx tsx <file>`（仓库根目录，依赖已装）。
seeds：`0xb66b01`–`0xb66b05`；天花板语料复用 R4-B 的 `0xb44b01` 以保证可比。

```ts
/**
 * R6-B deterministic equivalence + benchmark simulation (sixth pass).
 * 1) Re-measures the R4-B/R5-B aggregate slice ceiling (corpus seed 0xb44b01
 *    reused verbatim for comparability) plus the replay-faithful token-free
 *    corpus introduced by R5-B.
 * 2) Adjudicates fresh Round-6 candidates S6-B-1 .. S6-B-5 against the live
 *    routing slice, byte-identical since R1-B's baseline 94ed3d9.
 * Seeded PRNG (mulberry32) -> fully reproducible. Seeds 0xb66b01-0xb66b06.
 */
import { performance } from "node:perf_hooks";
import { analyzeTask, type AnalyzeTaskOptions, type TaskAnalysis } from "/workspace/src/routing/analyze-task.js";
import { assignTasks, type AssignableTask } from "/workspace/src/routing/assign.js";
import { planAssignmentPolicy, pickPreferredModel } from "/workspace/src/routing/assign-plan.js";
import { flowchartRoleForAgentRole } from "/workspace/src/graph/compile-children.js";
import { ASSIGN_FEATURE_VERSION, FLOWCHART_FEATURE_VERSION } from "/workspace/src/routing/feature-version.js";
import { catalogFromPrimary } from "/workspace/src/routing/primary-catalog.js";
import { oneHotDistribution, type CatalogModel, type CatalogModelInput } from "/workspace/src/routing/catalog-model.js";
import { evaluateLiveCandidate } from "/workspace/src/routing/policy.js";
import type { PrivacyClass } from "/workspace/src/routing/capability-registry.js";
import { liveRefusalMessage, selectLiveModel } from "/workspace/src/routing/live-selection.js";
import { applyLearnedRouting, type LearnedRoutingPolicy } from "/workspace/src/learning/learned-routing.js";
import { DomainValidationError, RoutingRefusalError, type RoutingRefusal } from "/workspace/src/domain/errors.js";
import {
  coldStartRoutingScore,
  createModelRouter,
  type ModelRouterConfig,
  type RouteTaskInput,
  type RoutingDecision,
  type RoutingLimits
} from "/workspace/src/supervisor/model-router.js";
import type { AgentRole } from "/workspace/src/domain/roles.js";
import type { ApprovalPlan, FlowchartNodeRole, TaskComplexity } from "/workspace/src/domain/flowchart.js";
import type { TaskId } from "/workspace/src/domain/ids.js";
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

const ROLES: readonly AgentRole[] = [
  "worker", "scout", "planner", "implementer", "reviewer", "tester", "debugger"
];
const OBJECTIVE_TEMPLATES = [
  "Survey the payment module",
  "Plan the checkout migration",
  "Run the unit tests",
  "Deploy payment credentials to production",
  "Implement retry logic for the ledger sync",
  "Review the audit log formatting nits",
  "Refactor and rename the tracking roller",
  "Fix the flaky spec for gate transitions",
  "Research and compare vector store options",
  "Investigate why the drop table migration failed in prod",
  "验证路由细节并补充测试",
  ""
];
const FRAGMENTS = [
  "deploy", "production", "credentials", "review", "tests", "coverage", "plan",
  "design", "survey", "research", "refactor", "implement", "add ", "fix ",
  "migrate", "verify", "\n", "the module", "碎片", " "
];
function genObjective(rng: () => number): string {
  if (rng() < 0.5) return pick(rng, OBJECTIVE_TEMPLATES);
  let text = "";
  const parts = 1 + Math.floor(rng() * 8);
  for (let i = 0; i < parts; i += 1) text += pick(rng, FRAGMENTS) + " ";
  return text;
}
function genTasks(rng: () => number, n: number): AssignableTask[] {
  return Array.from({ length: n }, (_, i) => ({
    taskId: `tsk_${i.toString().padStart(6, "0")}` as AssignableTask["taskId"],
    role: pick(rng, ROLES),
    objective: genObjective(rng),
    ...(rng() < 0.1 ? { contractRisk: rng() < 0.5 } : {}),
    ...(rng() < 0.3 ? { contextTokens: Math.floor(rng() * 100000) } : {}),
    ...(rng() < 0.3 ? { outputTokens: Math.floor(rng() * 4000) } : {})
  }));
}
/** Replay-faithful shape: adaptation/eval-routing.ts maps only taskId/role/objective. */
function genReplayTasks(rng: () => number, n: number): AssignableTask[] {
  return Array.from({ length: n }, (_, i) => ({
    taskId: `tsk_${i.toString().padStart(6, "0")}` as AssignableTask["taskId"],
    role: pick(rng, ROLES),
    objective: genObjective(rng)
  }));
}
function tenModelCatalog(): ModelRouterConfig {
  const models: CatalogModelInput[] = Array.from({ length: 10 }, (_, i) => ({
    id: `m${i}`,
    version: `m${i}-v1`,
    roles: ["actor", "critic"] as const,
    maxComplexity: (i >= 7 ? "HIGH" : "MEDIUM") as TaskComplexity,
    estimatedCostUsd: 0.05 * (i + 1),
    estimatedDurationMs: 500 * (i + 1),
    approvedForHighRisk: i >= 8
  }));
  return { policyVersion: "sim-r6b", models };
}
const conclusions: string[] = [];

/* ============================================================
 * §0 Ceiling re-measurement (R4-B/R5-B methodology, corpus seed 0xb44b01
 * reused verbatim) + replay-faithful token-free corpus (R5-B).
 * ============================================================ */
{
  const catalog2 = catalogFromPrimary({ primaryModelId: "premium" });
  const catalog10 = tenModelCatalog();
  const tasks = genTasks(mulberry32(0xb44b01), 2000);
  const totalM2 = bench(() => assignTasks({ catalog: catalog2, tasks }), 30);
  const totalM10 = bench(() => assignTasks({ catalog: catalog10, tasks }), 30);
  const analyzeOnly = bench(() => {
    for (const task of tasks) analyzeTask(task.objective, task.role);
  }, 30);
  console.log(
    `ceiling eval-replay N=2000: assignTasks M=2 ${(totalM2 * 1e3).toFixed(1)}us | M=10 ${(totalM10 * 1e3).toFixed(1)}us | analyzeTask share ${(analyzeOnly * 1e3).toFixed(1)}us (${((analyzeOnly / totalM2) * 100).toFixed(0)}%)`
  );
  console.log(
    `ceiling per eval run (x2 calls): M=2 total=${(totalM2 * 2).toFixed(2)}ms | M=10 total=${(totalM10 * 2).toFixed(2)}ms | analyzeTask total=${(analyzeOnly * 2).toFixed(2)}ms`
  );
  const replayTasks = genReplayTasks(mulberry32(0xb44b01), 2000);
  const replayM2 = bench(() => assignTasks({ catalog: catalog2, tasks: replayTasks }), 30);
  console.log(
    `ceiling replay-faithful (token-free) N=2000: assignTasks M=2 ${(replayM2 * 1e3).toFixed(1)}us per call (${(replayM2 * 2).toFixed(2)}ms per eval x2)`
  );
  const stress = genTasks(mulberry32(0xb44b01), 20000);
  const stressM2 = bench(() => assignTasks({ catalog: catalog2, tasks: stress }), 5);
  console.log(
    `ceiling 10x stress N=20000: assignTasks M=2 ${stressM2.toFixed(1)}ms per call (${(stressM2 * 2).toFixed(1)}ms per eval x2)`
  );
  const cli = genTasks(mulberry32(0xb44b01), 30);
  const cliM2 = bench(() => assignTasks({ catalog: catalog2, tasks: cli }), 2000);
  console.log(`ceiling CLI live face N=30: assignTasks M=2 ${(cliM2 * 1e3).toFixed(1)}us per call`);
  conclusions.push(
    `ceiling M=2 per-eval=${(totalM2 * 2).toFixed(1)}ms M=10 per-eval=${(totalM10 * 2).toFixed(1)}ms replay-faithful=${(replayM2 * 2).toFixed(1)}ms (holds-below-landing-line=${totalM10 * 2 < 30})`
  );
}

/* ============================================================
 * Faithful route() replica machinery (same exported building blocks as
 * src/supervisor/model-router.ts). Fidelity is checked against the real
 * router before any candidate variant is adjudicated. Used by S6-B-1/5.
 * ============================================================ */
function validateScoreReplica(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new DomainValidationError(`${label} must be a finite number between 0 and 1`);
  }
  return value;
}
function validateInputReplica(input: RouteTaskInput): void {
  if (!Array.isArray(input.modelPolicy.allowedModels) || input.modelPolicy.allowedModels.length === 0 ||
      !input.modelPolicy.allowedModels.every((id) => typeof id === "string" && id.trim() !== "")) {
    throw new DomainValidationError("Route modelPolicy.allowedModels must be a non-empty string array");
  }
  if (input.modelPolicy.preferredModel !== undefined &&
      !input.modelPolicy.allowedModels.includes(input.modelPolicy.preferredModel)) {
    throw new DomainValidationError("Route preferredModel must be in allowedModels");
  }
  if (!["LOW", "MEDIUM", "HIGH"].includes(input.complexity)) {
    throw new DomainValidationError("Route complexity is invalid");
  }
  if (!Number.isFinite(input.limits.remainingTimeMs) || input.limits.remainingTimeMs < 0) {
    throw new DomainValidationError("remainingTimeMs must be a non-negative finite number");
  }
  if (input.limits.remainingCostUsd !== undefined &&
      (!Number.isFinite(input.limits.remainingCostUsd) || input.limits.remainingCostUsd < 0)) {
    throw new DomainValidationError("remainingCostUsd must be a non-negative finite number");
  }
  if (input.confidenceThreshold !== undefined) validateScoreReplica(input.confidenceThreshold, "confidenceThreshold");
  if (input.limits.minHumanConfidence !== undefined) {
    validateScoreReplica(input.limits.minHumanConfidence, "minHumanConfidence");
  }
}
function makeApprovalPlanReplica(taskId: TaskId, model: CatalogModel): ApprovalPlan {
  return {
    id: `approval:${taskId}:${model.id}`,
    items: [
      { id: `route:${model.id}`, label: `Use ${model.id}`, selectable: true, defaultSelected: true },
      { id: "route:cancel", label: "Do not run this task", selectable: true, defaultSelected: false }
    ]
  };
}
interface ResolvedRouteRequestReplica {
  readonly highRisk: boolean;
  readonly family: string;
  readonly featureVersion: string;
  readonly privacyRequired: PrivacyClass;
  readonly requiredCapabilities: readonly string[];
  readonly contextNeeded: number;
  readonly outputNeeded: number;
  readonly budgetUsd: number;
  readonly deadlineMs: number;
}
function resolveRouteDefaultsReplica(input: RouteTaskInput): ResolvedRouteRequestReplica {
  return {
    highRisk: input.highRisk === true,
    family: input.family ?? "unknown",
    featureVersion: input.featureVersion ?? FLOWCHART_FEATURE_VERSION,
    privacyRequired: input.privacyRequired ?? "cloud-general",
    requiredCapabilities: input.requiredCapabilities ?? ["tool-use"],
    contextNeeded: input.contextNeeded ?? 0,
    outputNeeded: input.outputNeeded ?? 0,
    budgetUsd: input.limits.remainingCostUsd ?? Number.POSITIVE_INFINITY,
    deadlineMs: input.limits.remainingTimeMs
  };
}
type Partition = { readonly eligible: readonly CatalogModel[]; readonly refusals: readonly RoutingRefusal[] };
/** allowedMode "set" = faithful current; "length-fastpath" = naive S6-B-5 form. */
function partitionReplica(
  models: readonly CatalogModel[],
  input: RouteTaskInput,
  resolved: ResolvedRouteRequestReplica,
  allowedMode: "set" | "length-fastpath" = "set"
): Partition {
  const skipSet = allowedMode === "length-fastpath" && input.modelPolicy.allowedModels.length === models.length;
  const allowed = skipSet ? undefined : new Set(input.modelPolicy.allowedModels);
  const eligible: CatalogModel[] = [];
  const refusals: RoutingRefusal[] = [];
  for (const model of models) {
    if (allowed !== undefined && !allowed.has(model.id)) continue;
    const check = evaluateLiveCandidate(model, {
      role: input.role,
      complexity: input.complexity,
      taskFamily: resolved.family,
      privacyRequired: resolved.privacyRequired,
      requiredCapabilities: resolved.requiredCapabilities,
      contextNeeded: resolved.contextNeeded,
      outputNeeded: resolved.outputNeeded,
      budgetUsd: resolved.budgetUsd,
      deadlineMs: resolved.deadlineMs,
      highRisk: resolved.highRisk,
      fixedCostUsd: model.estimatedCostUsd,
      fixedLatencyMs: model.estimatedDurationMs
    });
    if (check.eligible) {
      eligible.push(model);
    } else {
      refusals.push(...check.failures);
    }
  }
  return { eligible, refusals };
}
/** decisionMode "two-pass" = faithful current buildDecision; "fused" = S6-B-1. */
function buildDecisionReplica(
  policyVersion: string,
  input: RouteTaskInput,
  resolved: ResolvedRouteRequestReplica,
  selected: CatalogModel,
  eligible: readonly CatalogModel[],
  refusals: readonly RoutingRefusal[],
  decisionMode: "two-pass" | "fused"
): RoutingDecision {
  const preferredModel = input.modelPolicy.preferredModel;
  const preferred = selected.id === preferredModel;
  const score = coldStartRoutingScore(input.complexity, preferred);
  const approvalRequired = input.approvalRequired ?? false;
  const statusAfterRoute = approvalRequired ? "WAITING_FOR_USER" as const : "RUNNING" as const;
  const preferredNote = preferred ? `; preferred constraint ${preferredModel}` : "";
  const justification =
    `${selected.id} is allowed for role ${input.role} and ${input.complexity} complexity; ` +
    `estimated cost ${selected.estimatedCostUsd} USD and duration ${selected.estimatedDurationMs} ms fit remaining limits` +
    preferredNote;
  let eligibleModels: readonly string[];
  let behaviorDistribution: Readonly<Record<string, number>>;
  if (decisionMode === "two-pass") {
    eligibleModels = eligible.map((model) => model.id);
    behaviorDistribution = oneHotDistribution(eligibleModels, selected.id);
  } else {
    const ids: string[] = [];
    const dist: Record<string, number> = {};
    for (const model of eligible) {
      ids.push(model.id);
      dist[model.id] = model.id === selected.id ? 1 : 0;
    }
    eligibleModels = ids;
    behaviorDistribution = dist;
  }
  return {
    eventType: "MODEL_ROUTED",
    taskId: input.taskId,
    role: input.role,
    complexity: input.complexity,
    model: selected.id,
    justification,
    confidence: score,
    coldStartRoutingScore: score,
    approvalPlan: makeApprovalPlanReplica(input.taskId, selected),
    statusAfterRoute,
    policyVersion,
    estimatedCostUsd: selected.estimatedCostUsd,
    estimatedDurationMs: selected.estimatedDurationMs,
    family: resolved.family,
    featureVersion: resolved.featureVersion,
    modelVersion: selected.version,
    highRisk: resolved.highRisk,
    eligibleModels,
    rejections: refusals,
    behaviorDistribution,
    ...(input.agentRole !== undefined ? { agentRole: input.agentRole } : {}),
    ...(preferred && preferredModel !== undefined ? { preferredConstraint: preferredModel } : {})
  };
}
function routeReplica(
  models: readonly CatalogModel[],
  catalogIds: ReadonlySet<string>,
  policyVersion: string,
  input: RouteTaskInput,
  decisionMode: "two-pass" | "fused" = "two-pass",
  allowedMode: "set" | "length-fastpath" = "set"
): RoutingDecision {
  validateInputReplica(input);
  const unknownPolicyModel = input.modelPolicy.allowedModels.find((id) => !catalogIds.has(id));
  if (unknownPolicyModel !== undefined) {
    throw new DomainValidationError(`Model policy references unavailable model: ${unknownPolicyModel}`);
  }
  const resolved = resolveRouteDefaultsReplica(input);
  const { eligible, refusals } = partitionReplica(models, input, resolved, allowedMode);
  if (eligible.length === 0) {
    throw new RoutingRefusalError(
      liveRefusalMessage({ role: input.role, complexity: input.complexity, highRisk: resolved.highRisk }, refusals),
      refusals
    );
  }
  const selected = selectLiveModel(eligible, input.modelPolicy.preferredModel);
  return buildDecisionReplica(policyVersion, input, resolved, selected, eligible, refusals, decisionMode);
}
const DEFAULT_LIMITS: RoutingLimits = { remainingTimeMs: Number.MAX_SAFE_INTEGER };
function routeInputFor(
  plan: ReturnType<typeof planAssignmentPolicy>,
  task: AssignableTask,
  limits: RoutingLimits
): RouteTaskInput {
  const analysis = analyzeTask(task.objective, task.role, {
    ...(task.contractRisk !== undefined ? { contractRisk: task.contractRisk } : {}),
    ...(task.contextTokens !== undefined ? { contextTokens: task.contextTokens } : {}),
    ...(task.outputTokens !== undefined ? { outputTokens: task.outputTokens } : {})
  });
  return {
    taskId: task.taskId,
    role: flowchartRoleForAgentRole(task.role),
    complexity: analysis.complexity,
    modelPolicy: { allowedModels: [...plan.allowedIds], preferredModel: pickPreferredModel(plan, analysis, undefined) },
    approvalRequired: analysis.highRisk,
    highRisk: analysis.highRisk,
    family: analysis.family,
    featureVersion: ASSIGN_FEATURE_VERSION,
    agentRole: task.role,
    requiredCapabilities: analysis.requiredCapabilities,
    ...(analysis.contextTokens !== undefined ? { contextNeeded: analysis.contextTokens } : {}),
    ...(analysis.outputTokens !== undefined ? { outputNeeded: analysis.outputTokens } : {}),
    limits
  };
}
const outcome = (fn: () => unknown): string => {
  try {
    return JSON.stringify(fn());
  } catch (error) {
    return `THROW:${(error as Error).name}:${(error as Error).message}`;
  }
};

/* ============================================================
 * S6-B-1: buildDecision eligibleModels map + oneHotDistribution fusion —
 * one pass builds both the id list and the one-hot record instead of
 * eligible.map() followed by a second O(E) loop.
 * ============================================================ */
{
  const catalog = catalogFromPrimary({ primaryModelId: "premium" });
  const router = createModelRouter(catalog);
  const models = router.config.models;
  const catalogIds = new Set(models.map((m) => m.id));
  const plan = planAssignmentPolicy(models, catalog.models.map((m) => m.id));
  const rng = mulberry32(0xb66b01);
  let allEqual = true;
  for (let trial = 0; trial < 3000; trial += 1) {
    const task = genTasks(rng, 1)[0]!;
    const input = routeInputFor(plan, task, DEFAULT_LIMITS);
    const real = outcome(() => router.route(input));
    const replica = outcome(() => routeReplica(models, catalogIds, catalog.policyVersion, input, "two-pass"));
    const cand = outcome(() => routeReplica(models, catalogIds, catalog.policyVersion, input, "fused"));
    if (real !== replica || real !== cand) allEqual = false;
    check("S6-B-1 replica fidelity", real === replica, `trial ${trial}`);
    check("S6-B-1 fused equivalence", real === cand, `trial ${trial}`);
  }
  conclusions.push(`S6-B-1 equal=${allEqual}`);
  const tasks = genTasks(mulberry32(0xb66b02), 2000);
  const prepared = tasks.map((task) => routeInputFor(plan, task, DEFAULT_LIMITS));
  const cur = bench(() => {
    for (const input of prepared) routeReplica(models, catalogIds, catalog.policyVersion, input, "two-pass");
  }, 30);
  const cand = bench(() => {
    for (const input of prepared) routeReplica(models, catalogIds, catalog.policyVersion, input, "fused");
  }, 30);
  console.log(
    `S6-B-1 bench N=2000 (route-only): two-pass=${(cur * 1e3).toFixed(1)}us fused=${(cand * 1e3).toFixed(1)}us delta=${((cur - cand) * 1e3).toFixed(1)}us per batch`
  );
}

/* ============================================================
 * S6-B-2: makeApprovalPlan constant cancel-item flyweight singleton.
 * The current contract keeps approvalPlan.items[1] as a distinct object per
 * decision; a module-level frozen singleton is an observable identity change
 * (S1-A-7 / S4-B-3 precedent). Identity probe + benefit upper bound.
 * ============================================================ */
{
  const catalog = catalogFromPrimary({ primaryModelId: "premium" });
  const router = createModelRouter(catalog);
  const plan = planAssignmentPolicy(router.config.models, catalog.models.map((m) => m.id));
  const tasks = genTasks(mulberry32(0xb66b03), 2).map((task) => ({ ...task, contractRisk: false }));
  const d1 = router.route(routeInputFor(plan, tasks[0]!, DEFAULT_LIMITS));
  const d2 = router.route(routeInputFor(plan, tasks[1]!, DEFAULT_LIMITS));
  const distinct = d1.approvalPlan.items[1] !== d2.approvalPlan.items[1];
  check("S6-B-2 current contract: cancel items distinct across decisions", distinct);
  console.log(
    `S6-B-2: approvalPlan.items[1] distinct across decisions = ${distinct} -> a shared frozen singleton flips this to false (observable identity change, S1-A-7/S4-B-3 precedent)`
  );
  // Benefit upper bound: full makeApprovalPlan cost per call (the singleton
  // would save at most the cancel-item literal, a fraction of this).
  const model = router.config.models[0]!;
  const planCost = bench(() => makeApprovalPlanReplica("tsk_anchor" as TaskId, model), 100000);
  console.log(
    `S6-B-2 upper bound: makeApprovalPlan full cost=${(planCost * 1e6).toFixed(0)}ns per decision -> N=2000 batch upper bound ${(planCost * 2000 * 1e3).toFixed(1)}us`
  );
  conclusions.push(`S6-B-2 current-distinct=${distinct}`);
}

/* ============================================================
 * S6-B-3: HIGH_RISK_RE intra-alternation frequency reordering.
 * .test() is invariant to alternation order (a match exists iff any
 * (position, alternative) pair matches; permutation cannot change set
 * emptiness). Fuzz is the arbiter; bench decides value.
 * ============================================================ */
const HIGH_RISK_RE_CURRENT =
  /\b(deploy(?:ing|ment|s)?|production|prod|credentials?|secrets?|privileged?|rm\s+-[a-z]*|drop\s+(table|database)|privilege\s+escalat\w*)\b/i;
const HIGH_RISK_RE_REORDERED =
  /\b(production|prod|deploy(?:ing|ment|s)?|credentials?|secrets?|privileged?|rm\s+-[a-z]*|drop\s+(table|database)|privilege\s+escalat\w*)\b/i;
const REVIEW_RE = /\b(review|audit|critique|nits?)\b/i;
const TEST_RE = /\b(tests?|spec|coverage|qa|verify|validation)\b/i;
const PLAN_RE = /\b(plan|decompos|roadmap|break down|design)\b/i;
const RESEARCH_RE = /\b(survey|research|investigat|scout|explor|compar)\b/i;
const REFACTOR_RE = /\b(refactor|cleanup|rename|extract)\b/i;
const IMPLEMENT_RE = /\b(implement|add |fix |integrate|migrate|write |build )\b/i;
const ROLE_FAMILY: Record<AgentRole, TaskFamily> = {
  worker: "edit",
  scout: "research",
  planner: "plan",
  implementer: "edit",
  reviewer: "review",
  tester: "test",
  debugger: "edit"
};
function familyOfReplica(text: string, role: AgentRole, highRiskRe: RegExp): TaskFamily {
  if (highRiskRe.test(text) && /\b(deploy|production|prod\b)\b/i.test(text)) return "deploy";
  if (PLAN_RE.test(text) || role === "planner") return "plan";
  if (RESEARCH_RE.test(text) || role === "scout") return "research";
  if (TEST_RE.test(text) || role === "tester") return "test";
  if (REVIEW_RE.test(text) || role === "reviewer") return "review";
  if (REFACTOR_RE.test(text)) return "refactor";
  if (IMPLEMENT_RE.test(text) || role === "implementer" || role === "worker") return "edit";
  return ROLE_FAMILY[role] ?? "unknown";
}
function complexityOfReplica(input: {
  readonly role: AgentRole;
  readonly family: TaskFamily;
  readonly highRisk: boolean;
  readonly long: boolean;
}): TaskComplexity {
  if (input.highRisk || input.family === "deploy") return "HIGH";
  if (input.long) return "MEDIUM";
  if (input.role === "scout" || input.role === "tester") return "LOW";
  if (input.role === "planner" || input.role === "debugger" || input.role === "reviewer") return "MEDIUM";
  if (input.family === "plan" || input.family === "research") return "MEDIUM";
  return "MEDIUM";
}
function analyzeReplica(
  objective: string,
  role: AgentRole,
  options: AnalyzeTaskOptions,
  highRiskRe: RegExp
): TaskAnalysis {
  const text = objective.trim();
  const family = familyOfReplica(text, role, highRiskRe);
  const highRisk = options.contractRisk !== undefined ? options.contractRisk : highRiskRe.test(text);
  const long = text.length >= 180 || (text.match(/\n/g) ?? []).length >= 3;
  const complexity = complexityOfReplica({ role, family, highRisk, long });
  const preferPrimary =
    highRisk ||
    complexity === "HIGH" ||
    role === "planner" ||
    role === "debugger" ||
    family === "deploy";
  const requiredCapabilities = options.requiredCapabilities ?? ["tool-use"];
  const reason = [
    `role ${role}`,
    `family ${family}`,
    `${complexity} complexity`,
    highRisk ? "high-risk" : "standard-risk",
    preferPrimary ? "prefer primary model" : "prefer cheapest eligible"
  ].join("; ");
  return {
    family,
    complexity,
    highRisk,
    requiredCapabilities,
    preferPrimary,
    reason,
    ...(options.contextTokens !== undefined ? { contextTokens: options.contextTokens } : {}),
    ...(options.outputTokens !== undefined ? { outputTokens: options.outputTokens } : {}),
    ...(options.hasTests !== undefined ? { hasTests: options.hasTests } : {}),
    ...(options.ownershipRestricted !== undefined ? { ownershipRestricted: options.ownershipRestricted } : {})
  };
}
function genOptions(rng: () => number): AnalyzeTaskOptions {
  return {
    ...(rng() < 0.3 ? { contractRisk: rng() < 0.5 } : {}),
    ...(rng() < 0.3 ? { contextTokens: Math.floor(rng() * 200000) } : {}),
    ...(rng() < 0.3 ? { outputTokens: Math.floor(rng() * 8000) } : {}),
    ...(rng() < 0.2 ? { requiredCapabilities: rng() < 0.5 ? ["tool-use"] : ["tool-use", "vision"] } : {}),
    ...(rng() < 0.2 ? { hasTests: rng() < 0.5 } : {}),
    ...(rng() < 0.2 ? { ownershipRestricted: rng() < 0.5 } : {})
  };
}
{
  const rng = mulberry32(0xb66b04);
  let allEqual = true;
  for (let trial = 0; trial < 12000; trial += 1) {
    const objective = genObjective(rng);
    const role = pick(rng, ROLES);
    const options = genOptions(rng);
    const real = JSON.stringify(analyzeTask(objective, role, options));
    const replica = JSON.stringify(analyzeReplica(objective, role, options, HIGH_RISK_RE_CURRENT));
    const cand = JSON.stringify(analyzeReplica(objective, role, options, HIGH_RISK_RE_REORDERED));
    if (real !== replica || real !== cand) allEqual = false;
    check("S6-B-3 replica fidelity", real === replica, JSON.stringify({ objective, role }));
    check("S6-B-3 reordered equivalence", real === cand, JSON.stringify({ objective, role }));
  }
  conclusions.push(`S6-B-3 equal=${allEqual}`);
  const tasks = genTasks(mulberry32(0xb66b04), 2000);
  const cur = bench(() => {
    for (const task of tasks) analyzeReplica(task.objective, task.role, {}, HIGH_RISK_RE_CURRENT);
  }, 30);
  const cand = bench(() => {
    for (const task of tasks) analyzeReplica(task.objective, task.role, {}, HIGH_RISK_RE_REORDERED);
  }, 30);
  console.log(
    `S6-B-3 bench N=2000: current-order=${(cur * 1e3).toFixed(1)}us reordered=${(cand * 1e3).toFixed(1)}us delta=${((cur - cand) * 1e3).toFixed(2)}us per batch`
  );
  for (const [label, objective, role] of [
    ["high-risk hit", "Deploy payment credentials to production", "implementer"],
    ["no-hit edit", "Implement retry logic for the ledger sync", "implementer"]
  ] as const) {
    const a = bench(() => analyzeReplica(objective, role, {}, HIGH_RISK_RE_CURRENT), 40000);
    const b = bench(() => analyzeReplica(objective, role, {}, HIGH_RISK_RE_REORDERED), 40000);
    console.log(`S6-B-3 micro ${label}: current=${(a * 1e6).toFixed(0)}ns reordered=${(b * 1e6).toFixed(0)}ns`);
  }
}

/* ============================================================
 * S6-B-4: assignPlanned skips applyLearnedRouting when learned.avoid and
 * learned.prefer are both empty. Divergence witness on the general contract:
 * with empty avoid/prefer, applyLearnedRouting still rewrites preferredModel
 * to learned.primaryModelId whenever preferredModel is not in the allow-list.
 * The skip is value-equivalent only under the unpromised in-slice invariant
 * "preferredModel is always inside allowedModels" (S2-B-1-type fragility).
 * ============================================================ */
{
  // General-contract divergence witness (direct call to the real function):
  const witness = applyLearnedRouting("edit", ["m1", "m2"], "m0", {
    primaryModelId: "m2",
    avoid: [],
    prefer: []
  });
  const diverges = witness.preferredModel !== "m0";
  check("S6-B-4 general-contract divergence witness", diverges);
  console.log(
    `S6-B-4 witness: applyLearnedRouting(family=edit, allowed=[m1,m2], preferred=m0, {avoid:[], prefer:[]}) -> preferredModel=${witness.preferredModel}; skip would keep m0 -> diverges=${diverges} (empty avoid/prefer is NOT the identity on the public contract)`
  );
  // In-slice value equivalence under the path invariant (fuzz), and benefit.
  const catalog = catalogFromPrimary({ primaryModelId: "premium" });
  const emptyLearned: LearnedRoutingPolicy = { primaryModelId: "premium", avoid: [], prefer: [] };
  const rng = mulberry32(0xb66b05);
  let allEqual = true;
  for (let trial = 0; trial < 3000; trial += 1) {
    const tasks = genTasks(rng, 1 + Math.floor(rng() * 3));
    const withLearned = JSON.stringify(assignTasks({ catalog, tasks, learned: emptyLearned }));
    const skipped = JSON.stringify(assignTasks({ catalog, tasks }));
    if (withLearned !== skipped) allEqual = false;
    check("S6-B-4 in-slice value equivalence (assignTasks full-catalog path)", withLearned === skipped, `trial ${trial}`);
  }
  conclusions.push(`S6-B-4 witness-diverges=${diverges} in-slice-equal=${allEqual}`);
  const tasks = genTasks(mulberry32(0xb66b05), 2000);
  const cur = bench(() => assignTasks({ catalog, tasks, learned: emptyLearned }), 30);
  const cand = bench(() => assignTasks({ catalog, tasks }), 30);
  console.log(
    `S6-B-4 bench N=2000: with-empty-learned=${(cur * 1e3).toFixed(1)}us skip-branch=${(cand * 1e3).toFixed(1)}us delta=${((cur - cand) * 1e3).toFixed(1)}us per batch (upper bound; only reachable when a caller passes an empty-but-defined policy)`
  );
}

/* ============================================================
 * S6-B-5: partitionLiveCandidates full-catalog fast path skipping the
 * allowed-Set. The cheap length-based guard is NOT equivalent: allowedModels
 * may contain duplicates, so equal length does not imply full coverage.
 * A correct guard needs the very Set it tries to avoid (self-defeating).
 * ============================================================ */
{
  const catalog = catalogFromPrimary({ primaryModelId: "premium" });
  const router = createModelRouter(catalog);
  const models = router.config.models;
  const catalogIds = new Set(models.map((m) => m.id));
  // Divergence witness: duplicates make length equal without full coverage.
  const dupInput: RouteTaskInput = {
    taskId: "tsk_dup" as TaskId,
    role: "actor" as FlowchartNodeRole,
    complexity: "MEDIUM" as TaskComplexity,
    modelPolicy: { allowedModels: ["cheap", "cheap"] },
    family: "edit",
    featureVersion: ASSIGN_FEATURE_VERSION,
    requiredCapabilities: [],
    limits: DEFAULT_LIMITS
  };
  const realOut = outcome(() => router.route(dupInput));
  const replicaOut = outcome(() => routeReplica(models, catalogIds, catalog.policyVersion, dupInput, "two-pass", "set"));
  const naiveOut = outcome(() => routeReplica(models, catalogIds, catalog.policyVersion, dupInput, "two-pass", "length-fastpath"));
  check("S6-B-5 replica fidelity on duplicate witness", realOut === replicaOut);
  const diverges = realOut !== naiveOut;
  check("S6-B-5 naive length-guard divergence witness", diverges);
  const realEligible = (JSON.parse(realOut) as RoutingDecision).eligibleModels;
  const naiveEligible = (JSON.parse(naiveOut) as RoutingDecision).eligibleModels;
  console.log(
    `S6-B-5 witness allowedModels=["cheap","cheap"] on M=2 catalog: current eligibleModels=[${realEligible.join(",")}] naive-fastpath=[${naiveEligible.join(",")}] -> diverges=${diverges}; a correct guard must deduplicate, i.e. build the very Set it tries to skip`
  );
  conclusions.push(`S6-B-5 naive-diverges=${diverges}`);
  // Benefit upper bound of any correct form: the Set construction itself.
  const allowedModels = models.map((m) => m.id);
  const setCost = bench(() => new Set(allowedModels), 100000);
  console.log(
    `S6-B-5 upper bound: new Set(allowedModels) M=2 = ${(setCost * 1e6).toFixed(0)}ns per route -> N=2000 batch upper bound ${(setCost * 2000 * 1e3).toFixed(1)}us`
  );
}

console.log(`\nCONCLUSIONS: ${conclusions.join(" | ")}`);
if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```
