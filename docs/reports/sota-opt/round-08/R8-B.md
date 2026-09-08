# R8-B：live 路由切片 Round 8 八搜报告

**战役:** 全库持久 SOTA 优化 Round 8 / R8-B（十区之一，R1-B…R7-B 的第八遍）
**基线:** `cursor/sota-persistent-opt-83a1` @ `4b92cef`（含 S7-F-1/2、S7-I-1 落地与 R7-J 排除并入）
**分支:** `cursor/r8-b-live-routing-eighth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动；R4-B…R7-B 的整片成本天花板经第五次复测
成立，且本轮按 R7-I 教训补上的「配置态」口径（配置目录 M=7 + learned
prefer/avoid 非空）也在天花板带内。** 关键前提事实：切片 10 个文件（本轮明确把
`assign-plan.ts`、`live-selection.ts` 划入切片）加只读上下游自 R1-B 的裁决基线
`94ed3d9` 以来**逐字节零变化**（`git diff 94ed3d9..4b92cef` 对切片 10 文件 +
`capability-registry.ts`/`cascade-evidence.ts`/`learned-routing.ts` 为空），全部
生产调用方文件（`adaptation/eval-routing.ts`、`run/child-coordinator.ts`、
`track/loop.ts`、`track/primary-split.ts`、`graph/compile-children.ts`、
`routing/public-prior.ts`）同样零变化——R7-B 基线 `8f806c8` 之后全 src 树的合入
（S7-F-1/2 `experiments/{shadow,canary,plan}.ts`、S7-I-1
`pi-adapter/listed-model*` + `cli/model-catalog.ts`）均在切片与调用方图景之外
（`cli/model-catalog.ts` 只改了目录**构建**的模块加载方式，产出的
`ModelRouterConfig` 形状不变）。R1-B 的结构下界论证、R4-B 的聚合天花板论证与
S1-B-1..8、S2-B-1..4、S3-B-1..6、S4-B-1..5、S5-B-1..4、S6-B-1..5、S7-B-1..6
全部裁决对当前代码原样成立。

天花板本轮实测复核为 **9.6–14.6 ms/eval（M=2；首次运行 14.6 为冷 VM/JIT 预热
离群，第 2/3 次 9.56–9.58）/ 19.2–19.7 ms/eval（M=10）**，replay-faithful
token-free 口径 **7.4–8.7 ms/eval**——与 R7-B（12.3–13.3 / 18.9–22.0 / 9.0–10.4）
和 R6-B（9.3–14.1 / 19.0–19.8 / 7.3–8.7）同带。**本轮新增配置态口径**：
buildLiveCatalogConfig 形状的 M=7 目录（5 个启用 builtin + cheap/premium 别名行，
带 contextWindow/maxOutputTokens/capabilities）+ learned prefer/avoid 非空，
replay-faithful 全量 **16.6–17.4 ms/eval**、live 面 N=30 每批 132.8–138.5 µs、
每 child 级联探针 <1 µs——配置态主路径贵约 2×（M=2→M=7），但仍与 M=10 压力口径
同带，落地线（数十~数百 ms 或复杂度类下降）依旧不可达：即使把整个切片成本消为零
也在落地线下沿之下，且 R1-B §2 已逐函数关闭复杂度类通道。

在此前七轮七组透镜之外，本轮换第八组新透镜穷举（含两个新入切片文件的首次
一等公民检查），得到 4 个排除表未覆盖的新提案（S8-B-1 … S8-B-4），全部经理论 +
确定性仿真（seeded mulberry32，等价性 fuzz + 身份探针 + 真实规模基准，三次独立
运行等价结论逐位一致）裁决后淘汰：1 个等价但每批一次 ns 级（S8-B-1），1 个在
压力规模实测负优化（S8-B-2），1 个等价但深度噪声 + 契约重复（S8-B-3），1 个
等价但符号翻转/噪声带 + 模块边界护栏（S8-B-4）。未重开任何 X* / S1-* / S2-* /
S3-* / S4-* / S5-* / S6-* / S7-* 条目。按指令不硬凑赢家：现状仍为该数据面契约下
的 SOTA。

## 0. 范围与约束遵守

- 切片（本轮 10 文件口径）：`src/routing/{r0,assign,assign-plan,policy,live-cascade,live-selection,analyze-task,primary-catalog,catalog-model}.ts`、
  `src/supervisor/model-router.ts` 全量重读；上下游 `capability-registry.ts`、
  `cascade-evidence.ts`、`learning/learned-routing.ts`、`cli/model-catalog.ts`
  只读取证，一行未改。offline 路由文件（r1、offline-logit、lin-alg 等，C 区，
  X2-1 SOD 专项可能在飞）一行未读改。
- 先读并遵守（顺序强制）：README / EXCLUSIONS.md（全表，含 S7-B-1..6 与
  S7-J-1..6）/ round-08/PLAN.md / round-01/R1-B.md … round-07/R7-B.md。
- 基线漂移检查：`git diff 94ed3d9..4b92cef -- <切片 10 文件 + 上下游 3 文件>`
  为空；调用方 6 文件同样为空。`git diff 8f806c8..4b92cef -- src/` 仅
  `cli/model-catalog.ts`、`experiments/{canary,plan,shadow}.ts`、
  `pi-adapter/listed-model*` 七个切片外文件（S7-F/S7-I 落地）。R1-B…R7-B 的
  规模测量、调用方图景与全部裁决对当前代码原样成立。
- 换名重提检查：本轮枚举中识别出并**未列为新候选**的既有方案换名——
  planAssignmentPolicy 全目录特化（S2-B-4，其「单遍 max/min」量已由本轮
  S8-B-1 一般形态重测确认同为噪声）、validateInput/route 头部校验按批提升
  （X0-4/X1-2 通道类）、批内共享请求/骨架（S3-B-6/S4-B-5 家族）、
  toModelDescriptor 预建（R1-B §4.4 三通道）、`/\n/g` 字面量提升
  （S1-B-1/X0-6 邻域）、cheapFirstTiers 装饰排序（S3-B-2）、
  compareLiveCandidates localeCompare 换码点（S3-B-3 冻结面）、
  oneHotDistribution null-prototype 表（S6-F-4 已实证稳定负优化的同型）。
- R1/posterior/offline-* 未碰；live 保持 R0 等价，R1 未接线：`live-isolation`
  3/3 绿（§6）。三线规格（分析不改 in-flight、双 LCB 双归因保留、提升
  proposal-first、Checkpoint F-PROD 开放、CAS/凭据/数据面契约/公开签名不动）
  零 diff 天然满足。不声称 Outcome-supported。
- 零 diff，公开 API / 决策对象 schema / refusal 消息优先级 / tie-break 语义
  天然不变。无阈值改动，无测试改动。空失败单例 / 默认能力数组的可观察对象身份
  （S4-B-3/S7-B-5 家族）未触碰。

## 1. 第八遍搜索方法与调用方图景复核

R1-B「输出契约渐近下界」、R2-B「跨模块身份/重复归一化/姊妹变体」、R3-B「批内
去重/比较器热循环/语义面」、R4-B「聚合天花板/自动机/约束分解/分配来源」、R5-B
「死值谓词/哨兵恒假/字符串原语/中间对象」、R6-B「双遍构造/常量享元/正则交替/
恒等变换」、R7-B「蕴含吸收/别名返回/构造期物化/默认值享元/索引复用」。本轮换
第八组透镜：

1. **新入切片文件一等公民透镜**：`assign-plan.ts` 与 `live-selection.ts` 此前
   七轮只是只读上下游（多个候选因「需改切片外文件」被联合否决），本轮首次作为
   可编辑面逐行检查——产出 S8-B-1（planAssignmentPolicy 排序拷贝取极值换单遍
   扫描的**一般形态**，非 S2-B-4 的全目录特化）与 S8-B-2（liveRefusalMessage
   双 `.some` 融合单遍，R5-B §5 曾记录为切片外不裁决）。
2. **比较器调用展开透镜**：selectLiveModel 的 min-scan 每步调用
   compareLiveCandidates（两次 Number(boolean) 转换 + 函数调用），把三级判定
   直写进扫描循环（产出 S8-B-3；与 S3-B-2 装饰排序、S1-B-6 Map 化均不同——
   不加索引结构、不动导出比较器本体）。
3. **防御拷贝镜像透镜**：S2-B-1 淘汰的是 learned 路径**第二次**拷贝省略；镜像
   命题——第一次拷贝在 learned 已定义时仅充当 applyLearnedRouting 的输入，
   第二次拷贝已保每 assignment 新鲜性，第一次可省（产出 S8-B-4）。
4. **配置态测量透镜（R7-I 教训执行）**：此前七轮天花板全部跑在默认
   `catalogFromPrimary`（M=2）与合成 M=10 上；本轮补配置态主路径——
   `buildLiveCatalogConfig` 形状目录（启用 builtin + 别名行 + 完整能力/窗口
   字段）× learned prefer/avoid 非空 × replay-faithful token-free 任务
   （`eval-routing.ts` 对**两次**调用都传 learned，见 L353-354）（§2b）。

调用方图景复核（grep 全 src 取证，与 R7-B 记录逐条一致，且因切片 + 全部调用方
文件逐字节零变化而必然一致）：`routeR0` 唯一生产调用方仍是
`r1-shadow-report.ts`；`applyCascade` 生产不可达（`applyEvidenceCascade` 在
src 内无调用方）；`decideLiveCascade` 在 `run/child-coordinator.ts` 每 child
结果一次；`assignTasks` 调用方为 `cli/main.ts`（N≤30）、`track/primary-split.ts`，
最大规模入口 `adaptation/eval-routing.ts` N=episodes ×2（baseline+candidate，
两次都带 learned）。R5-B 取证维持：最大规模入口任务只带 taskId/role/objective
（token-free、`budgetUsd=+∞`、`deadlineMs=MAX_SAFE_INTEGER`、fixed 字段走属性
读）。本轮新增取证：`liveRefusalMessage` 仅在 `route()` 的 refusal 抛错路径
调用（冷路径）；`selectLiveModel`/`compareLiveCandidates` 唯一生产调用方是
`model-router.ts`（切片内）；`applyLearnedRouting`（learning/ 公开函数）只读
其 `catalogIds` 参数且 avoid-all 分支按别名返回该参数（L203-204）。

## 2. 天花板复测：R4-B…R7-B 收口第五次复核成立

实测（本 VM，三次运行区间；语料生成器与 R4-B…R7-B 逐字节相同、种子 `0xb44b01`
复用以保证可比；完整脚本见附录）：

```text
ceiling eval-replay N=2000: assignTasks M=2 4780.8–7289.2us | M=10 9586.9–9824.5us | analyzeTask share 1130.0–1153.8us (16–24%)
ceiling per eval run (x2 calls): M=2 total=9.56–14.58ms | M=10 total=19.17–19.65ms | analyzeTask total=2.26–2.31ms
ceiling replay-faithful (token-free) N=2000: assignTasks M=2 3678.8–4357.9us per call (7.36–8.72ms per eval x2)
ceiling 10x stress N=20000: assignTasks M=2 55.0–59.2ms per call (110.0–118.4ms per eval x2)
ceiling CLI live face N=30: assignTasks M=2 51.8–66.0us per call
```

推论链（R4-B §2 …R7-B §2 的各条在复测数字上原样成立）：

1. M=2 天花板 9.6–14.6 ms/eval（首次运行 14.6 为 tsx 首装 + JIT 预热的冷 VM
   离群，与 R6-B 首次 14.1 同型；第 2/3 次 9.56–9.58 落回 R4-B/R6-B 区间）；
   M=10 19.2–19.7 ms/eval 与 R6-B/R7-B 同带。
2. R5-B 收紧口径复测成立：token-free 真实回放 7.4–8.7 ms/eval。
3. 复杂度类通道维持关闭：R1-B §2 逐函数下界（排序即输出 Ω(M log M)、全约束
   评估即 rejection-matrix 契约 Θ(M×约束数)、决策构造 Θ(输出字段数)）在逐字节
   未变的代码上原样成立。
4. 结构性重开条件不变：10× 压力（N=20000）下切片全量 ~110–118 ms/eval，届时
   20–30% 级候选才开始触线。

## 2b. 配置态口径（R7-I 教训执行）：主路径贵 ~2× 但收口结论不变

R7-I 的教训是默认态夹具会遮蔽配置态主路径。本切片此前七轮的天花板语料全部是
默认 M=2 / 合成 M=10。本轮补测 `buildLiveCatalogConfig` 形状目录（5 个启用
builtin 行 + CLI 追加的 cheap/premium 别名行 = M=7，行内含
contextWindow/maxOutputTokens/capabilities/完整成本字段）+ learned prefer/avoid
非空（eval-routing 对两次调用都传 learned）：

```text
configured-state replay N=2000: M=7 configured+learned 8306.5–8677.1us per call (16.61–17.35ms per eval x2) | M=2 default+learned 4917.6–5085.4us per call (9.84–10.17ms per eval x2)
configured-state CLI live face N=30: M=7 configured+learned 132.8–138.5us per call
configured-state per-child cascade M=7: liveCascadePlanFromAssignment=546–578ns decideLiveCascade=343–349ns
```

三条结论：

1. **无测量盲区翻案**：配置态主路径（M=7 + learned）确实比默认口径贵约 2×
   （9.8→17.4 ms/eval），但恰与既有 M=10 压力口径（19.2–19.7 ms）同带——
   R4-B 当年选 M=10 做压力上界正好覆盖了配置态，收口结论对配置态原样成立。
2. live 面配置态每批 133–139 µs（默认态 52–66 µs），仍低于落地线三个量级；
   每 child 级联探针 <1 µs。
3. 学习态（learned 非空）在两个目录口径下都只增加个位数百分比（第二次防御
   拷贝 + applyLearnedRouting 本体，后者在切片外）——不存在「learned 配置态
   才出现的隐藏热路径」。

## 3. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S8-B-1 | `assign-plan.ts` `planAssignmentPolicy` 双 `[...].sort` 取极值换单遍严格不等式扫描（一般形态；文件本轮新入切片，S2-B-4 的「需改切片外文件」否决项失效，残余噪声项重测） | 每批 2 次 O(M log M) 排序拷贝 → 2 次 O(M) 扫描；V8 稳定排序取首 ≡ 严格 >/< 单遍保最早极值 | ✅ 3000 组 fuzz（成本平手 30% + ghost/重复/乱序 catalogIds）逐字节 | M=2 省 98–103ns、M=10 省 398–420ns——**每 assignTasks 批一次** | 淘汰：每批一次 ns 级（S2-B-4/S7-B-6 同带；createModelRouter+plan 全程本就 ~1µs/批）（§4.1） |
| S8-B-2 | `live-selection.ts` `liveRefusalMessage` 双 `.some` 融合单遍分类扫描（文件本轮新入切片；R5-B §5 曾记录切片外不裁决） | 至多 2 次 O(R) 扫描 → 1 次；先例正向（S5-F 单探针赢过双探针） | ✅ 8000 组 fuzz（全约束 × highRisk × 次序）消息逐字节 | R=4 省 1–3ns；**R=40 实测更慢**（44–45→61–64ns，三次一致） | 淘汰：refusal 抛错冷路径专用 + 现实 R 个位数时 ns 级 + 压力规模负优化（V8 内建 `.some` 快路径反例第四例，S3-B-5/S1-A-4/S1-B-6 同链）（§4.2） |
| S8-B-3 | `live-selection.ts` `selectLiveModel` 比较器调用展开（preferred/cost/localeCompare 三级判定直写 min-scan 循环，免每步函数调用 + 2 次 Number(boolean)） | 每 route 免 (E-1) 次调用开销 | ✅ 6000 组 fuzz（混大小写平手 id × preferred 在/不在/缺席）同对象引用 + 对导出比较器排序头逐一交叉验证 | E=2 33–34→21–23ns、E=10 118–121→57–65ns——**每 route 一次**，N=2000 批上界 ~20–26µs（E=2） | 淘汰：深度噪声（占批 <0.6%）+ 排序语义在两处重复（compareLiveCandidates 是文档化 R0 等价总序契约，直写副本引入静默漂移面）（§4.3） |
| S8-B-4 | `assign.ts` `assignPlanned` learned 路径**第一次**防御拷贝省略（S2-B-1 的镜像：直接把 `plan.allowedIds` 传入 applyLearnedRouting，第二次拷贝保新鲜性） | learned 路径每任务免 1 次数组拷贝；avoid-all 别名返回分支被第二次拷贝兜住 | ✅ 3000 组 fuzz（replica 保真先行 + 值等价含 THROW）+ 三 regime 身份探针全 true | M=2 default：+41.4 / **-107.0** / +151.2µs——**符号翻转**；M=7 configured：83.4–129.9µs（占批 1.0–1.6%） | 淘汰：默认口径符号翻转＝抖动、配置态低于 S2-B-1（202–240µs）已裁决噪声带；且把**全批共享**的 plan.allowedIds 裸传给切片外公开函数，拷贝正是这条模块边界的变异护栏（S2-B-1 型脆弱性的更强形态）（§4.4） |

## 4. 关键裁决细节

### 4.1 S8-B-1：切片扩容只废掉了联合否决的一半

S2-B-4 当年的双重否决是「每批一次 300–950ns 噪声」+「需改切片外
assign-plan.ts 或开 X1-2 味平行路径」。本轮 assign-plan.ts 划入切片，第二项
失效——因此把**一般形态**（不做全目录特化、保留 Sets 与 filter，仅把两个
`[...].sort(...)[0]` 换成严格不等式单遍扫描）作为新候选独立裁决。等价性：
V8 排序稳定，降序取首＝最早最大项，升序取首＝最早最小项；严格 `>`/`<` 单遍
同样保最早极值；3000 组 fuzz（30% 成本平手、ghost id、重复 id、逆序请求）
逐字节一致。但量级重测确认残余否决项独立成立：M=2 省 98–103ns、M=10 省
398–420ns，**每 assignTasks 批一次**——占 N=2000 批 <0.01%，与 S7-B-6
（每批 ns 级）逐字节同带。切片归属变化不改变噪声本质，封死。

### 4.2 S8-B-2：单探针直觉在第四种形态上再次输给 V8 内建

S5-F 的赢家（单探针去重）与本候选直觉同向：两次谓词扫描并一次。8000 组 fuzz
证明消息逐字节等价（先扫描后按公开优先级出消息，precedence 不动）。但基准
三次一致：R=4 时省 1–3ns（亚噪声）；**R=40 时反而慢 44–45→61–64ns**——
两次 `.some`（V8 内建快路径 + 单态回调内联，且首命中即退）胜过手写单遍的
双旗标分支循环（must-scan-all）。这是 S3-B-5（every/includes/find 融合更慢）、
S1-A-4（Set 化更慢）、S1-B-6（Map 化更慢）之后**内建反例链的第四例**，覆盖
第四种形态（多谓词旗标融合）。价值面本就双关：`liveRefusalMessage` 只在
route() 抛 RoutingRefusalError 的冷路径调用，现实 refusal 集是个位数条目。
负优化 + 冷路径，双关封死。

### 4.3 S8-B-3：2× 相对收益、绝对 ns 级、契约面重复

展开后 E=10 时快 ~2×（118–121→57–65ns，三次一致；V8 对跨模块比较器调用
未完全内联，两次 Number(boolean) 装换确有代价）。但绝对量级：每 route 一次，
现实 E≤2 时省 ~10ns/route，N=2000 批上界 20–26µs，占批 <0.6%——S5-B-4
（46–68µs）之下的深度噪声。代价面：`compareLiveCandidates` 的三级总序是
live-selection.ts 文档注释锁定的「R0 等价静态策略」契约本体（S3-B-3 冻结面
的载体），并被 selectLiveModel 之外的测试直接引用；把判定逻辑直写进扫描
循环等于让同一契约存在两份实现——未来任何对总序的合法演化（新 tie-break
维度）都要记得改两处，漂移风险换 ns 级收益。收益/风险双输，封死。

### 4.4 S8-B-4：镜像拷贝省略输在符号翻转与更强的护栏论证

S2-B-1 淘汰的是第二次拷贝（202–240µs，依赖 applyLearnedRouting 返回数组
新鲜性）。镜像命题省第一次拷贝：applyLearnedRouting 只读输入（filter/find/
includes，取证 L198-215），avoid-all 分支返回输入别名，但下游第二次拷贝
`[...applied.allowedModels]` 使每 assignment 仍新鲜——3000 组 fuzz（replica
保真先行，对真实 assignTasks 逐字节）+ 三 regime 身份探针（partial-avoid /
avoid-all / prefer-only 下 per-assignment 数组互异且不别名 plan.allowedIds）
全部通过。但：

1. **量级**：M=2 默认口径三次 delta = +41.4 / -107.0 / +151.2µs，**符号翻转**
   ＝抖动带内；M=7 配置态三次同向为正但仅 83.4–129.9µs（占批 1.0–1.6%），
   低于 S2-B-1 已裁决的同路径噪声带。
2. **护栏**：省略后被传入切片外公开函数的是**全批共享**的 `plan.allowedIds`
   （每任务当前传的是新鲜拷贝）。applyLearnedRouting 今天只读是实现事实而非
   签名承诺——它一旦原地排序/变异（例如未来按成本重排 allow-list），污染的
   不是单个 assignment 而是**整批**后续任务的分配。第一次拷贝正是这条模块
   边界的变异护栏，比 S2-B-1（新鲜性依赖）更强的论证：这里是把自己的共享
   状态交出去，不只是相信对方的返回值。

### 4.5 未立候选的换名识别（负例记录）

- `oneHotDistribution` 换 null-prototype 记录表：S6-F-4 已在同构场景实证
  null-prototype 对象表稳定负优化 38–45%，且原型面可观察，直接按同型换名
  处理，不再立 ID 消耗仿真预算。
- `validateInput`/unknown-model 检查按批提升出 route()：等价性成立的前提是
  allowedModels 批内不变，但 learned 路径逐任务改写 allow-list，提升需按
  内容签名分桶——即重建 S3-B-1 已实证负优化的键构造；通道本身是 X0-4/X1-2
  类公开面变更。双重既有排除，不立新 ID。
- `stay` 闭包消除 / `decideLiveCascade` find+findIndex 合并：S1-B-4 与 R2-B
  收口维持，配置态级联探针（<1µs/child）确认量级未变。

## 5. 逐文件收口（第八遍透镜下的残余检查）

| 文件 | 检查项 | 结论 |
| --- | --- | --- |
| `assign-plan.ts`（新入切片） | S8-B-1 淘汰（每批 ns）；`pickPreferredModel` 四级决策链每级 O(1)/O(P)，prior 路径在最大规模入口不传（R2-B 跨切片记录维持）；`catalogIds` echo 是公开 plan 形状 | 无候选 |
| `live-selection.ts`（新入切片） | S8-B-2 淘汰（冷路径 + 压力负优化）；S8-B-3 淘汰（噪声 + 契约重复）；`compareLiveCandidates` localeCompare = S3-B-3 冻结面维持；`selectLiveModel` 单遍 min 已是 Ω(E) 下界（R1-B §2） | 无候选 |
| `assign.ts` | S8-B-4 淘汰（符号翻转 + 全批共享护栏）；S1-B-8/S2-B-1/S3-B-1/S4-B-4/S4-B-5/S6-B-4 维持 | 无候选 |
| `analyze-task.ts` | 无新面；S1-B-1/2/3、S4-B-1、S5-B-1/3、S6-B-3、S7-B-1/2/5 维持 | 无候选 |
| `policy.ts` | 无新面；S7-B-3、S5-B-2（含 deadline 姊妹封死）、S4-B-2/3 维持；全约束独立评估为契约下界维持 | 无候选 |
| `r0.ts` | 无新面；S1-B-6/S2-B-3/S3-B-4/S4-B-3 维持；排序输出即契约；`applyCascade` 生产不可达维持 | 无候选 |
| `live-cascade.ts` | 配置态级联探针复核（546–578ns plan / 343–349ns decide）；S1-B-4/5、S3-B-2/3 维持 | 无候选 |
| `primary-catalog.ts` / `catalog-model.ts` | 纯构造 Θ(字段)；条件 spread 属性存在性可观察（S1-C-10 类）维持；oneHotDistribution null-prototype 换名识别（§4.5） | 无候选 |
| `supervisor/model-router.ts` | 无新面；S7-B-4/6、S6-B-1/2/5、S5-B-4、S3-B-5、S2-B-2、S1-B-7 维持；`toModelDescriptor` 16% 维持 R1-B §4.4 架构裁决；配置态 M=7 下 route 本体仍是决策构造支配 | 无候选 |
| （跨切片，只记录不改） | `cli/model-catalog.ts` 的别名行 spread（`{...row, id}`）每 CLI 构建一次，µs 级且在切片外；`applyLearnedRouting` 本体属 learning 区 | 不属本切片 |

## 6. 前后对比与测试

无代码 diff。仓库变更仅本报告一个文件。零改动下相关套件复核全绿：

```bash
npx tsx --test test/unit/routing/*.test.ts test/unit/supervisor/*.test.ts
# tests 260 / suites 18 / pass 260 / fail 0
npx tsx --test test/unit/routing/live-isolation.test.ts
# tests 3 / pass 3 / fail 0   （live 面不 import R1/bandit/shadow 继续成立）
pnpm typecheck   # 通过
pnpm lint        # 通过
pnpm build       # 通过
```

环境披露：本 VM 预装 Node 22.14.0 低于 engines `>=22.19.0`，经 nvm 切换
Node 22.22.2 后运行全部测量与门禁（与 R7-B 同处置）。与本切片与本报告零关联。

仿真（临时脚本未入库——无赢家不落地死代码；完整源码见附录，seeds
`0xb88b01`–`0xb88b06`，天花板语料复用 R4-B 的 `0xb44b01`）最终一次运行：

```text
ceiling eval-replay N=2000: assignTasks M=2 4780.8us | M=10 9792.7us | analyzeTask share 1140.8us (24%)
ceiling per eval run (x2 calls): M=2 total=9.56ms | M=10 total=19.59ms | analyzeTask total=2.28ms
ceiling replay-faithful (token-free) N=2000: assignTasks M=2 3678.8us per call (7.36ms per eval x2)
ceiling 10x stress N=20000: assignTasks M=2 55.0ms per call (110.0ms per eval x2)
ceiling CLI live face N=30: assignTasks M=2 51.8us per call
configured-state replay N=2000: M=7 configured+learned 8306.5us per call (16.61ms per eval x2) | M=2 default+learned 4917.6us per call (9.84ms per eval x2)
configured-state CLI live face N=30: M=7 configured+learned 132.8us per call
configured-state per-child cascade M=7: liveCascadePlanFromAssignment=578ns decideLiveCascade=349ns
S8-B-1 bench M=2: sort-copy=332ns single-pass=230ns delta=102ns (once per batch)
S8-B-1 bench M=10: sort-copy=1005ns single-pass=607ns delta=398ns (once per batch)
S8-B-2 bench R=4 budget-last: two-some=20ns single-pass=17ns (refusal/throw path only)
S8-B-2 bench R=40 budget-last: two-some=44ns single-pass=63ns (refusal/throw path only)
S8-B-3 bench E=2: comparator-call=34ns inlined=21ns
S8-B-3 bench E=10: comparator-call=120ns inlined=57ns
S8-B-4 identity probe partial-avoid: per-assignment arrays distinct and not plan-aliased (true)
S8-B-4 identity probe avoid-all: per-assignment arrays distinct and not plan-aliased (true)
S8-B-4 identity probe prefer-only: per-assignment arrays distinct and not plan-aliased (true)
S8-B-4 bench N=2000 learned replay M=2 default: current=3953.5us candidate=3802.3us delta=151.2us | real assignTasks=4862.2us (delta=3.1%)
S8-B-4 bench N=2000 learned replay M=7 configured: current=6978.1us candidate=6885.3us delta=92.8us | real assignTasks=7947.2us (delta=1.2%)

CONCLUSIONS: ceiling M=2 per-eval=9.6ms M=10 per-eval=19.6ms replay-faithful=7.4ms (holds-below-landing-line=true) | configured-state M=7+learned replay per-eval=16.6ms live-face=132.8us (still-below-landing-line=true) | S8-B-1 equal=true | S8-B-2 equal=true | S8-B-3 equal=true | S8-B-4 equal=true identity-distinct=true
ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

三次独立运行 `CONCLUSIONS` 行的等价/身份字段**逐位一致**，计时区间：天花板
M=2 9.56–14.58ms（首次冷 VM 离群 14.58，第 2/3 次 9.56–9.58）/ M=10
19.17–19.65ms / token-free 7.36–8.72ms / 10× 压力 110.0–118.4ms；配置态
M=7+learned 16.61–17.35ms、live 面 132.8–138.5µs；S8-B-1 M=2 98–103ns /
M=10 398–420ns（三次同向）；S8-B-2 R=4 省 1–3ns、R=40 慢 17–20ns（三次
一致负）；S8-B-3 E=2 快 10–13ns、E=10 快 53–63ns（三次同向，绝对 ns 级）；
S8-B-4 M=2 +41.4/-107.0/+151.2µs（**符号翻转**）、M=7 83.4–129.9µs（同向
但噪声带下沿）。身份探针三 regime 三次全部 `distinct=true`。

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S8-B-1 | planAssignmentPolicy 双排序拷贝取极值换单遍扫描（一般形态，assign-plan.ts 入切片后重裁） | 等价（3000 fuzz 含平手/ghost/重复/乱序）但每 assignTasks 批一次 M=2 98–103ns / M=10 398–420ns（S2-B-4/S7-B-6 同带）；S2-B-4 的切片归属否决项失效后噪声项独立成立 |
| S8-B-2 | liveRefusalMessage 双 .some 融合单遍分类扫描 | 等价（8000 fuzz 消息逐字节）但 refusal 抛错冷路径专用；R=4 仅省 1–3ns，R=40 实测更慢（44–45→61–64ns）——V8 内建 .some 首命中早退胜过手写双旗标全扫，内建反例链第四例 |
| S8-B-3 | selectLiveModel 比较器调用展开（三级判定直写 min-scan） | 等价（6000 fuzz 同对象 + 比较器排序头交叉验证）但每 route 省 ~10ns（E=2），N=2000 批上界 20–26µs 深度噪声；总序契约在两处重复引入漂移面 |
| S8-B-4 | assignPlanned learned 路径第一次防御拷贝省略（S2-B-1 镜像） | 等价且身份保持（三 regime 探针），但 M=2 口径 +41/-107/+151µs 符号翻转、M=7 配置态 83–130µs 低于 S2-B-1 已裁决噪声带；且把全批共享的 plan.allowedIds 裸传切片外公开函数——拷贝是模块边界变异护栏（比 S2-B-1 更强的护栏论证） |

**结构性重开条件（对整个切片，与 R4-B…R7-B 一致并经本轮第五次复测 + 配置态
口径确认）**：eval 数据集规模增长 ≥1 个量级（N≥20000 时切片全量 ~110–118
ms/eval，20–30% 级候选开始触线），或 analyzeTask/route 进入每 turn 热路径，
或出现新的高频调用方，或配置目录 M 增长到使 M=10 压力口径失效（本轮配置态
M=7 实测仍在带内）。逐候选重开条件：S8-B-1/3 需先满足结构性条件（等价证据
本报告已备，可直接引用）；S8-B-2 需先推翻 R=40 负优化基准且 refusal 路径
变热；S8-B-4 需 applyLearnedRouting 签名正式承诺不变异输入且结构性条件满足。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.ts` 后 `npx tsx <file>`（仓库根目录，依赖已装）。
seeds：`0xb88b01`–`0xb88b06`；天花板语料复用 R4-B 的 `0xb44b01` 以保证可比。

```ts
/**
 * R8-B deterministic equivalence + benchmark simulation (eighth pass).
 * 1) Re-measures the R4-B..R7-B aggregate slice ceiling (corpus seed 0xb44b01
 *    reused verbatim) plus the replay-faithful token-free corpus (R5-B).
 * 2) NEW (R7-I lesson): configured-state anchors — a buildLiveCatalogConfig-
 *    shaped catalog (enabled builtins + cheap/premium alias rows, context
 *    windows and capabilities declared) with a non-empty learned prefer/avoid
 *    policy, measured on the replay-faithful and live-face entry points.
 * 3) Adjudicates fresh Round-8 candidates S8-B-1 .. S8-B-4 against the live
 *    routing slice, byte-identical since R1-B's baseline 94ed3d9.
 * Seeded PRNG (mulberry32) -> fully reproducible. Seeds 0xb88b01-0xb88b06.
 */
import { performance } from "node:perf_hooks";
import { analyzeTask } from "/workspace/src/routing/analyze-task.js";
import { assignTasks, type AssignableTask, type TaskAssignment } from "/workspace/src/routing/assign.js";
import {
  pickPreferredModel,
  planAssignmentPolicy,
  type AssignmentPolicyPlan
} from "/workspace/src/routing/assign-plan.js";
import { applyLearnedRouting, type LearnedRoutingPolicy } from "/workspace/src/learning/learned-routing.js";
import { flowchartRoleForAgentRole } from "/workspace/src/graph/compile-children.js";
import { ASSIGN_FEATURE_VERSION } from "/workspace/src/routing/feature-version.js";
import { catalogFromPrimary } from "/workspace/src/routing/primary-catalog.js";
import { catalogModel, type CatalogModel, type CatalogModelInput } from "/workspace/src/routing/catalog-model.js";
import {
  liveCascadePlanFromAssignment,
  decideLiveCascade
} from "/workspace/src/routing/live-cascade.js";
import {
  compareLiveCandidates,
  liveRefusalMessage,
  selectLiveModel
} from "/workspace/src/routing/live-selection.js";
import type { RoutingRefusal } from "/workspace/src/domain/errors.js";
import {
  createModelRouter,
  type ModelRouter,
  type ModelRouterConfig,
  type RoutingLimits
} from "/workspace/src/supervisor/model-router.js";
import type { AgentRole } from "/workspace/src/domain/roles.js";
import type { FlowchartNodeRole, TaskComplexity } from "/workspace/src/domain/flowchart.js";

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
  return { policyVersion: "sim-r8b", models };
}
/**
 * Configured-state catalog (R7-I lesson): shaped like buildLiveCatalogConfig's
 * output — five enabled listed-model rows (context windows, output caps,
 * capabilities declared; primary gets judge/router roles + high-risk approval)
 * plus the cheap/premium alias rows the CLI appends. M = 7.
 */
function configuredCatalog(): ModelRouterConfig {
  const enabled: CatalogModelInput[] = [
    {
      id: "acme/fast-mini", version: "fast-mini-2026-01", providerId: "acme",
      roles: ["actor", "critic"] as const, maxComplexity: "MEDIUM" as TaskComplexity,
      estimatedCostUsd: 0.0009, estimatedDurationMs: 1_500,
      inputCostPerMTok: 0.4, outputCostPerMTok: 1.0,
      contextWindow: 200_000, maxOutputTokens: 16_000,
      capabilities: ["tool-use", "vision"], approvedForHighRisk: false
    },
    {
      id: "acme/std", version: "std-2026-02", providerId: "acme",
      roles: ["actor", "critic"] as const, maxComplexity: "MEDIUM" as TaskComplexity,
      estimatedCostUsd: 0.004, estimatedDurationMs: 1_500,
      inputCostPerMTok: 2.0, outputCostPerMTok: 4.0,
      contextWindow: 200_000, maxOutputTokens: 32_000,
      capabilities: ["tool-use"], approvedForHighRisk: false
    },
    {
      id: "orion/coder", version: "coder-9", providerId: "orion",
      roles: ["actor", "critic"] as const, maxComplexity: "MEDIUM" as TaskComplexity,
      estimatedCostUsd: 0.0035, estimatedDurationMs: 1_500,
      inputCostPerMTok: 1.5, outputCostPerMTok: 4.0,
      contextWindow: 128_000, maxOutputTokens: 8_000,
      capabilities: ["tool-use"], approvedForHighRisk: false
    },
    {
      id: "orion/lite", version: "lite-3", providerId: "orion",
      roles: ["actor", "critic"] as const, maxComplexity: "MEDIUM" as TaskComplexity,
      estimatedCostUsd: 0.0006, estimatedDurationMs: 1_500,
      inputCostPerMTok: 0.25, outputCostPerMTok: 0.7,
      contextWindow: 64_000, maxOutputTokens: 8_000,
      capabilities: ["tool-use"], approvedForHighRisk: false
    },
    {
      id: "acme/frontier", version: "frontier-2026-03", providerId: "acme",
      roles: ["actor", "critic", "judge", "router"] as const, maxComplexity: "HIGH" as TaskComplexity,
      estimatedCostUsd: 0.0125, estimatedDurationMs: 4_000,
      inputCostPerMTok: 5.0, outputCostPerMTok: 15.0,
      contextWindow: 400_000, maxOutputTokens: 64_000,
      capabilities: ["tool-use", "vision"], approvedForHighRisk: true
    }
  ];
  const fastRow = enabled[3]!;
  const primaryRow = enabled[4]!;
  return {
    policyVersion: "router-v1-live",
    models: [...enabled, { ...fastRow, id: "cheap" }, { ...primaryRow, id: "premium" }]
  };
}
function configuredLearned(): LearnedRoutingPolicy {
  return {
    primaryModelId: "acme/frontier",
    avoid: [{ modelId: "orion/coder", reason: "sim: weak review outcomes", family: "review" }],
    prefer: [{ family: "plan", modelId: "acme/frontier" }]
  };
}
const conclusions: string[] = [];

/* ============================================================
 * §0 Ceiling re-measurement (R4-B..R7-B methodology, corpus seed 0xb44b01
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
 * §0b Configured-state anchors (R7-I lesson): learned prefer/avoid present,
 * buildLiveCatalogConfig-shaped M=7 catalog with alias rows, replay-faithful
 * token-free tasks (eval-routing passes learned on BOTH calls) and the CLI
 * live face; plus the per-child cascade probe on the configured catalog.
 * ============================================================ */
{
  const catalogCfg = configuredCatalog();
  const catalog2 = catalogFromPrimary({ primaryModelId: "premium" });
  const learned = configuredLearned();
  const learnedM2: LearnedRoutingPolicy = {
    primaryModelId: "premium",
    avoid: [{ modelId: "cheap", reason: "sim", family: "review" }],
    prefer: [{ family: "plan", modelId: "premium" }]
  };
  const replayTasks = genReplayTasks(mulberry32(0xb44b01), 2000);
  const cfgReplay = bench(() => assignTasks({ catalog: catalogCfg, tasks: replayTasks, learned }), 30);
  const m2Learned = bench(() => assignTasks({ catalog: catalog2, tasks: replayTasks, learned: learnedM2 }), 30);
  console.log(
    `configured-state replay N=2000: M=7 configured+learned ${(cfgReplay * 1e3).toFixed(1)}us per call (${(cfgReplay * 2).toFixed(2)}ms per eval x2) | M=2 default+learned ${(m2Learned * 1e3).toFixed(1)}us per call (${(m2Learned * 2).toFixed(2)}ms per eval x2)`
  );
  const cli = genTasks(mulberry32(0xb44b01), 30);
  const cfgCli = bench(() => assignTasks({ catalog: catalogCfg, tasks: cli, learned }), 2000);
  console.log(`configured-state CLI live face N=30: M=7 configured+learned ${(cfgCli * 1e3).toFixed(1)}us per call`);
  // Per-child cascade probe on the configured catalog (track/loop + coordinator path).
  const assignments = assignTasks({ catalog: catalogCfg, tasks: cli, learned });
  const first = assignments[0]!;
  const planCost = bench(() => liveCascadePlanFromAssignment(first, { models: catalogCfg.models as never }), 40000);
  const plan = liveCascadePlanFromAssignment(first, { models: catalogCfg.models as never });
  const decideCost = bench(
    () =>
      decideLiveCascade({
        plan,
        previousModelId: first.decision.model,
        evidence: { source: "deterministic-check", kind: "FAIL" },
        failureClass: "model"
      }),
    40000
  );
  console.log(
    `configured-state per-child cascade M=7: liveCascadePlanFromAssignment=${(planCost * 1e6).toFixed(0)}ns decideLiveCascade=${(decideCost * 1e6).toFixed(0)}ns`
  );
  conclusions.push(
    `configured-state M=7+learned replay per-eval=${(cfgReplay * 2).toFixed(1)}ms live-face=${(cfgCli * 1e3).toFixed(1)}us (still-below-landing-line=${cfgReplay * 2 < 30})`
  );
}

/* ============================================================
 * S8-B-1: planAssignmentPolicy sort-copy extrema -> single-pass max/min
 * (general form, in the now-in-slice assign-plan.ts; distinct from the
 * excluded S2-B-4 full-catalog specialization which bypassed the Sets and
 * filters too). Stable-sort-take-first keeps the earliest extremum on ties;
 * strict >/< single-pass scans keep the earliest too.
 * ============================================================ */
function candidatePlanSinglePass(
  models: readonly CatalogModel[],
  catalogIds: readonly string[]
): AssignmentPolicyPlan {
  const catalog = new Set(models.map((model) => model.id));
  const requested = new Set(catalogIds);
  let primary: CatalogModel | undefined;
  for (const model of models) {
    if (primary === undefined || model.estimatedCostUsd > primary.estimatedCostUsd) primary = model;
  }
  const assignableModels = models.filter((model) => requested.has(model.id));
  let cheapest: CatalogModel | undefined;
  for (const model of assignableModels) {
    if (cheapest === undefined || model.estimatedCostUsd < cheapest.estimatedCostUsd) cheapest = model;
  }
  return {
    catalogIds,
    allowedIds: catalogIds.filter((id) => catalog.has(id)),
    primaryPreferredId:
      primary !== undefined && requested.has(primary.id) ? primary.id : undefined,
    assignableModels,
    cheapestAssignableId: cheapest?.id ?? catalogIds[0]!
  };
}
{
  const rng = mulberry32(0xb88b01);
  for (let trial = 0; trial < 3000; trial += 1) {
    const m = 1 + Math.floor(rng() * 10);
    const models = Array.from({ length: m }, (_, i) =>
      catalogModel({
        id: `m${i}`,
        version: `m${i}-v1`,
        roles: ["actor", "critic"] as const,
        maxComplexity: pick(rng, ["MEDIUM", "HIGH"]) as TaskComplexity,
        // 30% ties so both extremum tie-breaks are exercised
        estimatedCostUsd: rng() < 0.3 ? 0.1 : Number((rng() * 2).toFixed(3)),
        estimatedDurationMs: 500 + Math.floor(rng() * 5000)
      })
    );
    const catalogIds = models.filter(() => rng() < 0.8).map((model) => model.id);
    if (rng() < 0.3) catalogIds.push("ghost");
    if (rng() < 0.2 && catalogIds.length > 0) catalogIds.push(catalogIds[0]!); // duplicate id
    if (rng() < 0.3) catalogIds.reverse(); // non-catalog order
    if (catalogIds.length === 0) catalogIds.push(models[0]!.id);
    check(
      "S8-B-1 equivalence",
      JSON.stringify(planAssignmentPolicy(models, catalogIds)) ===
        JSON.stringify(candidatePlanSinglePass(models, catalogIds)),
      JSON.stringify({ trial })
    );
  }
  for (const m of [2, 10]) {
    const config = m === 2 ? catalogFromPrimary({ primaryModelId: "premium" }) : tenModelCatalog();
    const router = createModelRouter(config);
    const ids = config.models.map((model) => model.id);
    const cur = bench(() => planAssignmentPolicy(router.config.models, ids), 100000);
    const cand = bench(() => candidatePlanSinglePass(router.config.models, ids), 100000);
    console.log(
      `S8-B-1 bench M=${m}: sort-copy=${(cur * 1e6).toFixed(0)}ns single-pass=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns (once per batch)`
    );
  }
  conclusions.push("S8-B-1 equal=true");
}

/* ============================================================
 * S8-B-2: liveRefusalMessage two .some passes -> one classification pass
 * (in the now-in-slice live-selection.ts; refusal/throw path only).
 * Precedence (high-risk-approval, then budget/deadline, then role/complexity)
 * is applied AFTER the single scan, so the public message order is unchanged.
 * ============================================================ */
function candidateRefusalMessage(
  input: {
    readonly role: FlowchartNodeRole;
    readonly complexity: TaskComplexity;
    readonly highRisk: boolean;
  },
  refusals: readonly RoutingRefusal[]
): string {
  let hasHighRiskApproval = false;
  let hasBudgetOrDeadline = false;
  for (const row of refusals) {
    if (row.constraint === "high-risk-approval") hasHighRiskApproval = true;
    else if (row.constraint === "budget" || row.constraint === "deadline") hasBudgetOrDeadline = true;
  }
  if (input.highRisk && hasHighRiskApproval) {
    return "No allowed model is approved for high-risk tasks";
  }
  if (hasBudgetOrDeadline) {
    return "No allowed model fits the remaining cost and time limits";
  }
  return `No allowed model satisfies role ${input.role} and complexity ${input.complexity}`;
}
{
  const rng = mulberry32(0xb88b02);
  const constraints = [
    "high-risk-approval", "budget", "deadline", "role", "complexity",
    "privacy-class", "capability", "context-window", "max-output", "provider-policy"
  ];
  const flowRoles: readonly FlowchartNodeRole[] = ["actor", "critic", "router", "judge", "tool", "human"];
  for (let trial = 0; trial < 8000; trial += 1) {
    const refusals: RoutingRefusal[] = Array.from({ length: Math.floor(rng() * 13) }, (_, i) => ({
      modelId: `m${i % 4}`,
      constraint: pick(rng, constraints),
      detail: "sim"
    }));
    const input = {
      role: pick(rng, flowRoles),
      complexity: pick(rng, ["LOW", "MEDIUM", "HIGH"]) as TaskComplexity,
      highRisk: rng() < 0.5
    };
    check(
      "S8-B-2 equivalence",
      liveRefusalMessage(input, refusals) === candidateRefusalMessage(input, refusals),
      JSON.stringify({ trial, input, refusals })
    );
  }
  for (const r of [4, 40]) {
    const refusals: RoutingRefusal[] = Array.from({ length: r }, (_, i) => ({
      modelId: `m${i % 4}`,
      constraint: i === r - 1 ? "budget" : "complexity",
      detail: "sim"
    }));
    const input = { role: "actor" as FlowchartNodeRole, complexity: "MEDIUM" as TaskComplexity, highRisk: false };
    const cur = bench(() => liveRefusalMessage(input, refusals), 100000);
    const cand = bench(() => candidateRefusalMessage(input, refusals), 100000);
    console.log(
      `S8-B-2 bench R=${r} budget-last: two-some=${(cur * 1e6).toFixed(0)}ns single-pass=${(cand * 1e6).toFixed(0)}ns (refusal/throw path only)`
    );
  }
  conclusions.push("S8-B-2 equal=true");
}

/* ============================================================
 * S8-B-3: selectLiveModel comparator inlining — expand the three-level
 * preferred/cost/localeCompare order directly into the min-scan loop, removing
 * the compareLiveCandidates call and its two Number(boolean) conversions.
 * compareLiveCandidates stays exported and untouched (it is the documented
 * total-order contract); this only affects the private scan.
 * ============================================================ */
function candidateSelectInlined(
  eligible: readonly CatalogModel[],
  preferredModel: string | undefined
): CatalogModel {
  let best = eligible[0]!;
  let bestPreferred = best.id === preferredModel;
  for (let index = 1; index < eligible.length; index += 1) {
    const candidate = eligible[index]!;
    const candidatePreferred = candidate.id === preferredModel;
    if (candidatePreferred !== bestPreferred) {
      if (candidatePreferred) {
        best = candidate;
        bestPreferred = true;
      }
      continue;
    }
    const costDifference = candidate.estimatedCostUsd - best.estimatedCostUsd;
    if (costDifference < 0 || (costDifference === 0 && candidate.id.localeCompare(best.id) < 0)) {
      best = candidate;
      bestPreferred = candidatePreferred;
    }
  }
  return best;
}
{
  const rng = mulberry32(0xb88b03);
  for (let trial = 0; trial < 6000; trial += 1) {
    const m = 1 + Math.floor(rng() * 10);
    const eligible = Array.from({ length: m }, (_, i) =>
      catalogModel({
        id: rng() < 0.15 ? `M${i}` : `m${i}`, // mixed case exercises localeCompare ties
        version: `v${i}`,
        roles: ["actor"] as const,
        maxComplexity: "HIGH" as TaskComplexity,
        estimatedCostUsd: rng() < 0.4 ? 0.1 : Number((rng() * 2).toFixed(3)),
        estimatedDurationMs: 500
      })
    );
    const roll = rng();
    const preferredModel =
      roll < 0.4 ? eligible[Math.floor(rng() * m)]!.id : roll < 0.6 ? "ghost" : undefined;
    const cur = selectLiveModel(eligible, preferredModel);
    const cand = candidateSelectInlined(eligible, preferredModel);
    check("S8-B-3 same object selected", cur === cand, JSON.stringify({ trial, preferredModel }));
    // Cross-check against the exported comparator contract directly.
    const sorted = [...eligible].sort((l, r) => compareLiveCandidates(l, r, preferredModel));
    check("S8-B-3 matches comparator sort head", cur.id === sorted[0]!.id, JSON.stringify({ trial }));
  }
  for (const e of [2, 10]) {
    const eligible = Array.from({ length: e }, (_, i) =>
      catalogModel({
        id: `m${i}`,
        version: `v${i}`,
        roles: ["actor"] as const,
        maxComplexity: "HIGH" as TaskComplexity,
        estimatedCostUsd: i < e / 2 ? 0.1 : 0.05 * (i + 1),
        estimatedDurationMs: 500
      })
    );
    const cur = bench(() => selectLiveModel(eligible, "m1"), 100000);
    const cand = bench(() => candidateSelectInlined(eligible, "m1"), 100000);
    console.log(
      `S8-B-3 bench E=${e}: comparator-call=${(cur * 1e6).toFixed(0)}ns inlined=${(cand * 1e6).toFixed(0)}ns`
    );
  }
  conclusions.push("S8-B-3 equal=true");
}

/* ============================================================
 * S8-B-4: assignPlanned learned-path FIRST defensive copy elision — pass
 * plan.allowedIds directly into applyLearnedRouting (the mirror image of the
 * excluded S2-B-1, which elided the SECOND copy). The second copy
 * [...applied.allowedModels] still runs, so per-assignment freshness is
 * preserved even on applyLearnedRouting's avoid-all alias-return branch.
 * Replica calls the exact same real dependencies as src/routing/assign.ts.
 * ============================================================ */
const DEFAULT_LIMITS: RoutingLimits = { remainingTimeMs: Number.MAX_SAFE_INTEGER };
function assignPlannedReplica(
  router: ModelRouter,
  plan: AssignmentPolicyPlan,
  task: AssignableTask,
  limits: RoutingLimits,
  learned: LearnedRoutingPolicy | undefined,
  elideFirstCopy: boolean
): TaskAssignment {
  const analysis = analyzeTask(task.objective, task.role, {
    ...(task.contractRisk !== undefined ? { contractRisk: task.contractRisk } : {}),
    ...(task.contextTokens !== undefined ? { contextTokens: task.contextTokens } : {}),
    ...(task.outputTokens !== undefined ? { outputTokens: task.outputTokens } : {})
  });
  let allowedModels: readonly string[] =
    elideFirstCopy && learned !== undefined ? plan.allowedIds : [...plan.allowedIds];
  let preferredModel = pickPreferredModel(plan, analysis, undefined);
  if (learned !== undefined) {
    const applied = applyLearnedRouting(analysis.family, allowedModels, preferredModel, learned);
    allowedModels = [...applied.allowedModels];
    preferredModel = applied.preferredModel;
  }
  const decision = router.route({
    taskId: task.taskId,
    role: flowchartRoleForAgentRole(task.role),
    complexity: analysis.complexity,
    modelPolicy: { allowedModels, preferredModel },
    approvalRequired: analysis.highRisk,
    highRisk: analysis.highRisk,
    family: analysis.family,
    featureVersion: ASSIGN_FEATURE_VERSION,
    agentRole: task.role,
    requiredCapabilities: analysis.requiredCapabilities,
    ...(analysis.contextTokens !== undefined ? { contextNeeded: analysis.contextTokens } : {}),
    ...(analysis.outputTokens !== undefined ? { outputNeeded: analysis.outputTokens } : {}),
    limits
  });
  return { taskId: task.taskId, role: task.role, analysis, decision, allowedModels, preferredModel };
}
function genCatalog(rng: () => number): ModelRouterConfig {
  const m = 2 + Math.floor(rng() * 9);
  const models: CatalogModelInput[] = Array.from({ length: m }, (_, i) => ({
    id: `m${i}`,
    version: `m${i}-v1`,
    roles: ["actor", "critic"] as const,
    maxComplexity: (i >= m - 2 ? "HIGH" : pick(rng, ["MEDIUM", "HIGH"])) as TaskComplexity,
    estimatedCostUsd: Number((0.05 + rng()).toFixed(3)),
    estimatedDurationMs: 500 + Math.floor(rng() * 5000),
    capabilities: ["tool-use"],
    approvedForHighRisk: i >= m - 2 ? true : rng() < 0.3
  }));
  return { policyVersion: "sim-r8b", models };
}
function genLearned(rng: () => number, catalogIds: readonly string[]): LearnedRoutingPolicy | undefined {
  const roll = rng();
  if (roll < 0.2) return undefined;
  const families = ["edit", "plan", "research", "test", "review", "refactor", "deploy"];
  if (roll < 0.32) {
    // avoid-all: forces applyLearnedRouting's catalogIds alias-return branch
    return {
      primaryModelId: catalogIds[catalogIds.length - 1]!,
      avoid: catalogIds.map((id) => ({ modelId: id, reason: "sim avoid-all" })),
      prefer: []
    };
  }
  const avoid = catalogIds
    .filter(() => rng() < 0.3)
    .map((id) => ({
      modelId: id,
      reason: "sim",
      ...(rng() < 0.5 ? { family: pick(rng, families) } : {})
    }));
  const prefer = families
    .filter(() => rng() < 0.3)
    .map((family) => ({ family, modelId: pick(rng, catalogIds) }));
  return { primaryModelId: catalogIds[catalogIds.length - 1]!, avoid, prefer };
}
function outcomeOf(fn: () => TaskAssignment): string {
  try {
    return JSON.stringify(fn());
  } catch (error) {
    return `THROW:${(error as Error).message}`;
  }
}
{
  const rng = mulberry32(0xb88b04);
  for (let trial = 0; trial < 3000; trial += 1) {
    const catalog = genCatalog(rng);
    const router = createModelRouter(catalog);
    const catalogIds = catalog.models.map((model) => model.id);
    const plan = planAssignmentPolicy(router.config.models, catalogIds);
    const learned = genLearned(rng, catalogIds);
    const tasks = genTasks(rng, 1 + Math.floor(rng() * 4));
    // Fidelity: replica (elide off) must equal the real assignTasks byte-for-byte.
    let real: string;
    try {
      real = JSON.stringify(assignTasks({ catalog, tasks, learned }));
    } catch (error) {
      real = `THROW:${(error as Error).message}`;
    }
    let replicaBatch: string;
    try {
      replicaBatch = JSON.stringify(
        tasks.map((task) => assignPlannedReplica(router, plan, task, DEFAULT_LIMITS, learned, false))
      );
    } catch (error) {
      replicaBatch = `THROW:${(error as Error).message}`;
    }
    check("S8-B-4 replica fidelity vs assignTasks", real === replicaBatch, `trial ${trial}`);
    for (const task of tasks) {
      const cur = outcomeOf(() => assignPlannedReplica(router, plan, task, DEFAULT_LIMITS, learned, false));
      const cand = outcomeOf(() => assignPlannedReplica(router, plan, task, DEFAULT_LIMITS, learned, true));
      check("S8-B-4 value equivalence", cur === cand, `trial ${trial}`);
    }
  }
  // Identity probes under the candidate, all three learned regimes.
  const catalog = genCatalog(mulberry32(0xb88b05));
  const router = createModelRouter(catalog);
  const catalogIds = catalog.models.map((model) => model.id);
  const plan = planAssignmentPolicy(router.config.models, catalogIds);
  const probeTasks = genTasks(mulberry32(0xb88b05), 4).map((task) => ({ ...task, contractRisk: false }));
  const regimes: readonly [string, LearnedRoutingPolicy][] = [
    ["partial-avoid", {
      primaryModelId: catalogIds[catalogIds.length - 1]!,
      avoid: [{ modelId: catalogIds[0]!, reason: "sim" }],
      prefer: []
    }],
    ["avoid-all", {
      primaryModelId: catalogIds[catalogIds.length - 1]!,
      avoid: catalogIds.map((id) => ({ modelId: id, reason: "sim" })),
      prefer: []
    }],
    ["prefer-only", {
      primaryModelId: catalogIds[catalogIds.length - 1]!,
      avoid: [],
      prefer: [{ family: "edit", modelId: catalogIds[0]! }]
    }]
  ];
  for (const [label, learned] of regimes) {
    const out = probeTasks.map((task) =>
      assignPlannedReplica(router, plan, task, DEFAULT_LIMITS, learned, true)
    );
    let distinct = true;
    for (let i = 0; i < out.length; i += 1) {
      if (out[i]!.allowedModels === plan.allowedIds) distinct = false;
      for (let j = i + 1; j < out.length; j += 1) {
        if (out[i]!.allowedModels === out[j]!.allowedModels) distinct = false;
      }
    }
    check(`S8-B-4 candidate identity (${label})`, distinct);
    console.log(`S8-B-4 identity probe ${label}: per-assignment arrays distinct and not plan-aliased (${distinct})`);
  }
  // Benchmark at the largest realistic scale: replay-faithful token-free
  // tasks + learned policy on both the M=2 default and M=7 configured catalogs.
  for (const [label, benchCatalog, benchLearned] of [
    ["M=2 default", catalogFromPrimary({ primaryModelId: "premium" }), {
      primaryModelId: "premium",
      avoid: [{ modelId: "cheap", reason: "sim", family: "review" }],
      prefer: [{ family: "plan", modelId: "premium" }]
    } satisfies LearnedRoutingPolicy],
    ["M=7 configured", configuredCatalog(), configuredLearned()]
  ] as const) {
    const benchRouter = createModelRouter(benchCatalog);
    const benchIds = benchCatalog.models.map((model) => model.id);
    const benchPlan = planAssignmentPolicy(benchRouter.config.models, benchIds);
    const benchTasks = genReplayTasks(mulberry32(0xb88b06), 2000);
    const cur = bench(() => {
      for (const task of benchTasks) {
        assignPlannedReplica(benchRouter, benchPlan, task, DEFAULT_LIMITS, benchLearned, false);
      }
    }, 30);
    const cand = bench(() => {
      for (const task of benchTasks) {
        assignPlannedReplica(benchRouter, benchPlan, task, DEFAULT_LIMITS, benchLearned, true);
      }
    }, 30);
    const whole = bench(() => assignTasks({ catalog: benchCatalog, tasks: benchTasks, learned: benchLearned }), 30);
    console.log(
      `S8-B-4 bench N=2000 learned replay ${label}: current=${(cur * 1e3).toFixed(1)}us candidate=${(cand * 1e3).toFixed(1)}us delta=${((cur - cand) * 1e3).toFixed(1)}us | real assignTasks=${(whole * 1e3).toFixed(1)}us (delta=${(((cur - cand) / whole) * 100).toFixed(1)}%)`
    );
  }
  conclusions.push("S8-B-4 equal=true identity-distinct=true");
}

console.log(`\nCONCLUSIONS: ${conclusions.join(" | ")}`);
if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```
