# R9-B：live 路由切片 Round 9 九搜报告

**战役:** 全库持久 SOTA 优化 Round 9 / R9-B（十区之一，R1-B…R8-B 的第九遍）
**基线:** `cursor/sota-persistent-opt-83a1` @ `195cb53`（含 R9-A/S9-A-1 与 R8-I/S8-I-1..3 排除并入）
**分支:** `cursor/r9-b-live-routing-ninth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动；R4-B…R8-B 的整片成本天花板经第六次复测
成立，配置态（M=7 + learned 非空）口径仍在带内，切片按指令收口。** 关键前提
事实：切片 10 个文件加只读上下游 3 文件自 R1-B 的裁决基线 `94ed3d9` 以来
**逐字节零变化**（`git diff 94ed3d9..195cb53` 对 13 个文件为空），全部生产
调用方文件同样零变化——R8-B 基线 `4b92cef` 之后全 src 树的唯一合入是
`src/routing/offline-logit.ts`（S7-C 落地，C 区切片外，不 import 本切片任何
模块）。R1-B 的结构下界论证、R4-B 的聚合天花板论证与 S1-B-1..8、S2-B-1..4、
S3-B-1..6、S4-B-1..5、S5-B-1..4、S6-B-1..5、S7-B-1..6、S8-B-1..4 全部裁决对
当前代码原样成立。

天花板本轮实测复核为 **9.4–15.2 ms/eval（M=2；首次运行 15.2 为冷 VM/JIT 预热
离群，第 2/3 次 9.4–11.2）/ 18.4–20.0 ms/eval（M=10）**，replay-faithful
token-free 口径 **7.0–8.3 ms/eval**——与 R8-B（9.6–14.6 / 19.2–19.7 /
7.4–8.7）同带。配置态口径（buildLiveCatalogConfig 形状 M=7 目录 + learned
prefer/avoid 非空，语料与 R8-B 逐字节相同）：replay-faithful 全量
**17.8–18.4 ms/eval**、live 面 N=30 每批 128.7–131.8 µs、每 child 级联探针
<1 µs——与 R8-B 的 16.6–17.4 ms / 132.8–138.5 µs 同带（VM 抖动幅度内）。
落地线（数十~数百 ms 或复杂度类下降）依旧不可达：即使把整个切片成本消为零也在
落地线下沿之下，且 R1-B §2 已逐函数关闭复杂度类通道。

本轮按指令先跑「配置态 × 命令类」矩阵复核（§1），再换第九组新透镜穷举，得到
4 个排除表未覆盖的新提案（S9-B-1 … S9-B-4），全部经理论 + 确定性仿真（seeded
mulberry32，等价性 fuzz + 发散见证 + 身份探针 + 真实规模基准，三次独立运行
等价/见证结论逐位一致）裁决后淘汰：2 个等价但每批一次/每 route ns 级
（S9-B-1、S9-B-2），1 个等价但三口径全部符号翻转＝纯抖动（S9-B-3），1 个
发散见证 + 自败论证（S9-B-4）。另按 S8-A-3/S8-E-2/S8-H-1 的 PIC 纪律新增一个
**目录隐藏类形状探针**（§2c）：混合形状 M=7 目录较均匀形状稳定慢 7–10%
（613–805 µs/call，三次同向），但唯一修复通道（无条件字段物化）是 S1-C-10
属性存在性可观察排除类，且全额消除也仅 ~1.2–1.6 ms/eval，被天花板支配——
确认不存在契约内可利用的配置态形状漏洞。未重开任何 X* / S1-* … S8-* / S9-A-*
条目。按指令不硬凑赢家：现状仍为该数据面契约下的 SOTA，切片关闭。

## 0. 范围与约束遵守

- 切片（10 文件口径，与 R8-B 一致）：`src/routing/{r0,assign,assign-plan,policy,live-cascade,live-selection,analyze-task,primary-catalog,catalog-model}.ts`、
  `src/supervisor/model-router.ts` 全量重读；上下游 `capability-registry.ts`、
  `cascade-evidence.ts`、`learning/learned-routing.ts` 只读取证，一行未改。
  offline 路由文件（r1、offline-logit、lin-alg 等，C 区）一行未读改。
- 先读并遵守（顺序强制）：README / EXCLUSIONS.md（全表，含 S8-A..I 与
  S9-A-1）/ round-09/PLAN.md / round-08/PLAN.md + R8-B.md /
  round-01/R1-B.md … round-07/R7-B.md。S8-J 在途，未发明任何 S8-J ID。
- 基线漂移检查：`git diff --stat 94ed3d9..195cb53 -- <切片 10 文件 + 上下游
  3 文件>` 为空；调用方 7 文件（`adaptation/eval-routing.ts`、
  `run/child-coordinator.ts`、`track/loop.ts`、`track/primary-split.ts`、
  `graph/compile-children.ts`、`routing/public-prior.ts`、`cli/main.ts`）自
  R8-B 基线 `4b92cef` 零变化（`cli/model-catalog.ts` 相对 `94ed3d9` 的漂移是
  已知的 S7-I-1 落地，R8-B 已裁决其只改目录构建的模块加载方式、产出形状不变）。
  `git diff --stat 4b92cef..195cb53 -- src/` 全 src 仅
  `src/routing/offline-logit.ts`（S7-C 落地，切片外）。R1-B…R8-B 的规模测量、
  调用方图景与全部裁决对当前代码原样成立。
- 换名重提检查：本轮枚举中识别出并**未列为新候选**的既有方案换名（§4.5）——
  makeApprovalPlan / justification 每模型字符串构造期预物化（S7-B-4 同机制
  同函数域，符号翻转 + X1-1 派生缓存面证据直接转移）、目录行无条件字段物化
  「治」PIC 形状罚（S1-C-10 属性存在性可观察 + 公开类型形状）、
  oneHotDistribution null-prototype 表（S6-F-4，R8-B 已换名识别）、
  compareLiveCandidates 体内 Number(boolean) 换三元（S8-B-3 已实测整个比较器
  调用开销 ~10ns/route（E=2），体内任何微改动被其严格支配；比较器本体是
  S3-B-3 冻结面的载体）、validateInput/unknown 检查按批提升（X0-4/X1-2 通道，
  R8-B §4.5 维持）、批内共享请求/骨架（S3-B-6/S4-B-5 家族）。
- R1/posterior/offline-* 未碰；live 保持 R0 等价，R1 未接线：`live-isolation`
  3/3 绿（§6）。三线规格（分析不改 in-flight、Tracking 无命令权、H/score 不写
  路由 PASS/FAIL、双 LCB 双归因保留、提升 proposal-first、Checkpoint F-PROD
  开放、compareLiveCandidates 总序契约不另拷、assignPlanned 防御拷贝不省）
  零 diff 天然满足。不声称 Outcome-supported。
- 零 diff，公开 API / 决策对象 schema / refusal 消息优先级 / tie-break 语义
  天然不变。无阈值改动，无测试改动。

## 1. 第九遍搜索方法：矩阵先行 + 落地赢家镜像透镜

按 R7-I 教训与本轮指令，先复核「配置态 × 命令类」矩阵，再找新角度：

| 矩阵维度 | 复核结果 |
| --- | --- |
| 默认 M=2 vs 配置 M=7 目录 | 两口径均实测（§2/§2b），配置态贵 ~2× 但与 M=10 压力口径同带，R8-B 结论无漂移 |
| learned prefer/avoid 非空 vs 空 | 两口径均实测；learned 非空只增个位数百分比（第二次防御拷贝 + applyLearnedRouting 本体在切片外），无隐藏热路径 |
| assignTasks vs assignPlanned vs selectLiveModel vs analyze-task | 全部命令类覆盖于天花板与候选基准；`assignOne` 本轮新取证：**src 内零生产调用方**（仅导出 + 测试引用），该矩阵格为空 |
| 新 src/ 调用方 since R8-B | 无：`4b92cef..195cb53` 全 src 仅 offline-logit.ts；调用方 7 文件零 diff；`learning/from-episode.ts` 的 grep 命中是其私有 `applyCascadeRetry` 函数重名，非切片 import |

调用方图景复核（grep 全 src 取证，与 R8-B 记录逐条一致）：`routeR0` 唯一生产
调用方仍是 `r1-shadow-report.ts`；`applyCascade` 生产不可达；
`decideLiveCascade` 在 `run/child-coordinator.ts` 每 child 结果一次；
`assignTasks` 调用方为 `cli/main.ts`（N≤30）、`track/primary-split.ts`，最大
规模入口 `adaptation/eval-routing.ts` N=episodes ×2（两次都带 learned）；
`toModelDescriptor` 唯一切片外消费者不存在（仅 catalog-model 定义 +
policy.ts 消费）；`selectLiveModel`/`compareLiveCandidates`/`liveRefusalMessage`
唯一生产调用方是 `model-router.ts`（切片内）。

在此前八轮八组透镜之外，本轮换第九组新透镜：

1. **落地赢家镜像透镜**：系统性检查本战役已落地赢家在本切片内的未开发镜像
   站点——S5-F 单探针去重 → `validateConfig` 查重 `has`+`add`（产出 S9-B-1）；
   S7-F-2 可打印 ASCII 首字符卫 → `validateInput` 的 per-id `trim()` 站点
   （产出 S9-B-2；S8-F-2 在 F 区的镜像已被否决，本站点是第二次镜像尝试）。
   其余落地赢家逐一排查无镜像面：S4-C/S5-C/S6-C 循环变换需要 p≥10 级热循环
   （本切片 M≤10 遍历不构成）；S7-C 支撑求和需要 0/1 设计点积（无）；
   S6-F-1 成员反转需要 O(P) 扫描 vs O(A) 集合的规模不对称（partition 的
   allowed-Set 在 A≤10 无此结构）；S5-I-1/S7-I-1 惰性加载属 CLI/adapter 区。
2. **常量输入不保留对象快路径透镜**：`assignPlanned` 的 options 对象在
   replay-faithful 主路径（三个可选字段全 undefined）每任务新建空对象，而
   analyzeTask 不保留 options 引用——模块级冻结空单例可行且身份不可观察
   （产出 S9-B-3；与被否决的 S4-B-4「直接传 task」机制不同：无宽对象边界
   问题，收益是 S4-B-4 实测值的真子集）。
3. **错误检查下沉透镜**：route() 头部 unknown-model 预扫描可否下沉进
   partitionLiveCandidates 现有遍历（产出 S9-B-4；与 S3-B-5「融合 validateInput
   同层扫描」不同——这是跨层下沉，改变错误发现时机）。
4. **PIC 形状探针透镜（S8-A-3/S8-E-2/S8-H-1 纪律执行）**：此前八轮天花板语料
   的目录行形状均匀（同一 CatalogModelInput 字面量形态）；真实
   buildLiveCatalogConfig 目录可能混合可选字段子集，`catalogModel` 的条件
   spread 使行隐藏类分裂，partitionLiveCandidates / evaluateLiveCandidate /
   toModelDescriptor 的属性读取退化为 polymorphic IC。本轮量化该效应（§2c），
   检验是否存在被均匀形状夹具遮蔽的配置态漏洞。

## 2. 天花板复测：R4-B…R8-B 收口第六次复核成立

实测（本 VM，三次运行区间；语料生成器与 R4-B…R8-B 逐字节相同、种子
`0xb44b01` 复用以保证可比；完整脚本见附录）：

```text
ceiling eval-replay N=2000: assignTasks M=2 4709.6–7575.2us | M=10 9206.1–9988.5us | analyzeTask share 1075.9–1117.2us (14–24%)
ceiling per eval run (x2 calls): M=2 total=9.42–15.15ms | M=10 total=18.41–19.98ms | analyzeTask total=2.15–2.23ms
ceiling replay-faithful (token-free) N=2000: assignTasks M=2 3480.9–4138.6us per call (6.96–8.28ms per eval x2)
ceiling 10x stress N=20000: assignTasks M=2 53.1–55.5ms per call (106.2–111.1ms per eval x2)
ceiling CLI live face N=30: assignTasks M=2 50.2–82.7us per call
```

推论链（R4-B §2 …R8-B §2 的各条在复测数字上原样成立）：

1. M=2 天花板 9.4–15.2 ms/eval（首次运行 15.2 为 tsx 首装 + JIT 预热的冷 VM
   离群，与 R6-B 首次 14.1 / R8-B 首次 14.6 同型；第 2/3 次 9.42–11.17 落回
   R4-B/R6-B/R8-B 区间）；M=10 18.4–20.0 ms/eval 与 R6-B/R7-B/R8-B 同带。
2. R5-B 收紧口径复测成立：token-free 真实回放 7.0–8.3 ms/eval。
3. 复杂度类通道维持关闭：R1-B §2 逐函数下界（排序即输出 Ω(M log M)、全约束
   评估即 rejection-matrix 契约 Θ(M×约束数)、决策构造 Θ(输出字段数)）在逐字节
   未变的代码上原样成立。
4. 结构性重开条件不变：10× 压力（N=20000）下切片全量 ~106–111 ms/eval，届时
   20–30% 级候选才开始触线。

## 2b. 配置态口径复测（R8-B 口径，语料逐字节相同）

```text
configured-state replay N=2000: M=7 configured+learned 8919.5–9219.4us per call (17.84–18.44ms per eval x2) | M=2 default+learned 4565.8–4848.2us per call (9.13–9.70ms per eval x2)
configured-state CLI live face N=30: M=7 configured+learned 128.7–131.8us per call
configured-state per-child cascade M=7: liveCascadePlanFromAssignment=516–561ns decideLiveCascade=322–339ns
```

与 R8-B（16.61–17.35 ms / 132.8–138.5 µs / 546–578 ns / 343–349 ns）同带，
本 VM 配置态回放略高、默认+learned 与 live 面略低——双向个位数百分比属 VM
抖动，方向与占比结论均不变。配置态主路径仍与 M=10 压力口径同带、live 面仍
低于落地线三个量级：**无测量盲区翻案，R8-B 的配置态收口对本 VM 原样成立**。

## 2c. 新增：目录隐藏类形状探针（PIC 纪律执行）

设计：两个 M=7 目录，同一 token-free 语料（seed `0xb44b01`）——均匀形状
（每行都声明 privacyClass/contextWindow/maxOutputTokens/approvedForHighRisk，
经 catalogModel 归一化后共享单一隐藏类）vs 混合形状（7 行声明 7 种不同的
可选字段子集，产生至多 7 个隐藏类流经 partitionLiveCandidates /
evaluateLiveCandidate / toModelDescriptor 的属性读取）：

```text
PIC shape probe N=2000 M=7: uniform-shape=7901.3–8469.7us mixed-shape=8706.7–9083.0us delta=613.3–805.5us per call (7.2–10.2%)
```

三次同向：混合形状稳定慢 7–10%。三条结论：

1. **效应真实但被天花板支配**：全额（把混合形状目录「治」成均匀）也只有
   ~1.2–1.6 ms/eval（×2 调用），低于落地线一个量级以上。
2. **唯一修复通道已被排除**：让 `catalogModel`/`toModelDescriptor` 无条件
   物化全部可选字段（显式 undefined）即形状归一——但属性存在性是可观察行为
   （`Object.keys`/JSON/`in`；CatalogModel 与 ModelDescriptor 都是公开导出
   类型），S1-C-10 类排除原样适用；对公开类型收窄/放宽亦撞 S8-A-3/S8-H-1
   已裁决的「公开输入类型变更」面。
3. **测量纪律校准**：此前八轮的均匀形状天花板语料对混合形状真实目录**低估
   ≤10%**——该幅度不改变任何「低于落地线 1–3 个量级」的裁决余量，全部历史
   收口结论在混合形状口径下仍然成立。这正是 S8-A-3/S8-E-2/S8-H-1 PIC 纪律
   要求「说明收益/成本里的形状敏感项」的正向执行：本切片的形状敏感项已量化
   且有界。

## 3. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S9-B-1 | `model-router.ts` `validateConfig` 查重 `has`+`add` 换 `add`+size 计数单探针（S5-F 落地赢家镜像） | 每模型省 1 次哈希查找；first-fault 次序与消息按构造逐字节不变 | ✅ 4000 组 fuzz（15% 重复 id + 重复/未知角色故障混合）THROW/OK 逐字节 | M=2 省 33–43ns、M=10 省 63–69ns——**每 createModelRouter（每批）一次**；createModelRouter M=2 全程本就 700–745ns | 淘汰：每批一次 ns 级（S7-B-6/S2-B-2 同带）；S5-F 赢在 O(N) 热循环 ×2000 站点，此处 N=M≤10 且每批一次（§4.1） |
| S9-B-2 | `model-router.ts` `validateInput` per-id `trim()` 前可打印 ASCII 首字符卫（S7-F-2 落地赢家第二次镜像；S8-F-2 在 F 区第一次镜像已否决） | 码点 33..126 首字符蕴含 trim 非空，跳过双端扫描 | ✅ 20000 组 fuzz（空串/纯空白/前后空白/CJK/NBSP/全角空格/非字符串）布尔逐位 | M=2 ids 省 2.9–5.0ns/route、M=7 ids 省 21.5–22.3ns/route → N=2000 批上界 ~6–10µs / ~43–45µs | 淘汰：深度噪声（占 M=7 配置态批 <0.5%）；S8-F-2 的镜像否决先例在更小站点上独立成立（§4.2） |
| S9-B-3 | `assign.ts` `assignPlanned` 三字段全 undefined 时以模块级冻结空 `AnalyzeTaskOptions` 单例替代条件 spread 空对象（replay-faithful 主路径命中 100%） | 每任务免 1 次空对象分配；analyzeTask 不保留 options 引用 → 身份不可观察（与 S4-B-3/S6-B-2/S7-B-5 身份否决先例的关键区别） | ✅ 3000 组 fuzz（replica 保真先行 + 值等价含 THROW；M=2/M=10 × learned 混合）+ requiredCapabilities 新鲜性探针 true | M=2 replay：**-40.1 / +240.3 / +133.1µs 符号翻转**；M=7 configured+learned：**+188.1 / +62.0 / -6.3µs 符号翻转**；M=2 混合语料：**-24.5 / +129.1 / +37.3µs 符号翻转** | 淘汰：三口径九次测量全部符号不稳＝纯抖动（指令明示 sign-unstable = noise）；上界被 S4-B-4 已裁决的 143–215µs 噪声带严格支配（§4.3） |
| S9-B-4 | `model-router.ts` route() 头部 unknown-model 预扫描下沉进 partitionLiveCandidates 现有遍历 | 省 1 次 O(A) `find` + O(A) 重复成员判断 | ❌ 发散见证：`allowedModels=[cheap,ghost]` + judge 角色全拒时，当前抛 `DomainValidationError`（ghost 优先），下沉版先抛 `RoutingRefusalError`——错误类优先级是公开契约（测试断言错误类） | — | 淘汰：不等价；修正版必须逐 id 记账「哪些 allowed id 命中了目录行」——即重建它想跳过的成员簿记（S6-B-5 型自败）；且量级上界即 S3-B-5 已裁决的融合域（§4.4） |

## 4. 关键裁决细节

### 4.1 S9-B-1：落地赢家的镜像在错误的规模上

S5-F 的赢家形态（`add` + size 计数替代 `has`+`add`）在 `experiments/plan.ts`
的 `assertUniqueNonEmpty` 上落地，靠的是 O(N) 热循环 × N=2000 级站点 ×
每实验多次调用。本切片 `validateConfig` 的查重循环形态逐字节同型
（`if (ids.has(id)) throw; ids.add(id)`），镜像等价性按构造成立且经 4000 组
故障混合 fuzz（重复 id 在随机位置、重复角色、未知角色）THROW/OK 逐字节确认
——first-fault 次序不变，消息不变。但规模维度完全不同：N=M≤10 且
**每 createModelRouter 一次**（即每 assignTasks 批一次）。实测 M=2 省
33–43ns、M=10 省 63–69ns，而 createModelRouter M=2 全程本就 700–745ns/批
（S2-B-2/S7-B-6 同带的第三次复核）。占 N=2000 批 <0.001%。封死。

### 4.2 S9-B-2：第二次镜像尝试，更小的站点

S7-F-2（可打印 ASCII 首字符卫）在 F 区落地后，S8-F-2 已在 F 区另一线性 trim
站点镜像失败（~6.8µs/实验）。本切片 `validateInput` 的
`id.trim() !== ""` 是 per-route × per-id 站点——比 S8-F-2 更小。等价性完备
（码点 33..126 的首字符是非空白字符，trim 后必非空；20000 组 fuzz 含空串、
纯空白、NBSP、全角空格 U+3000、CJK、前后空白、非字符串，布尔逐位一致）。
实测省 2.9–5.0ns/route（M=2 ids）/ 21.5–22.3ns/route（M=7 ids）→ N=2000 批
上界 6–45µs，占配置态批 <0.5%——比历史噪声带（143–349µs）还低一档。
V8 对无空白字符串的 trim 本就走返回接收者的快路径，卫兵省下的只是双端扫描。
镜像否决链第二例，封死。

### 4.3 S9-B-3：身份论证首次通过的享元候选，输在符号翻转

本战役身份否决先例链（S1-A-7/S1-B-8/S4-B-3/S6-B-2/S7-B-5/S1-D-1）全部输在
「共享对象随公开输出保留」。本候选是第一个**通过**身份关的享元：options
对象只进 `analyzeTask` 的六次字段读取，不随任何输出保留（探针证明候选下
`requiredCapabilities` 默认数组仍每调新鲜——`?? ["tool-use"]` 分支在
analyzeTask 内部分配，与共享 options 无关）。等价性经 3000 组 replica 保真
先行 + 值等价 fuzz（M=2/M=10 × learned 三态 × replay/token 混合语料，含
THROW 路径）逐字节确认。且与 S4-B-4（直接传 task 作 options）机制不同：
无宽对象边界脆弱性，是干净的真子集形态。

但基准三口径九次测量**全部符号不稳**：M=2 replay -40.1/+240.3/+133.1µs、
M=7 configured +188.1/+62.0/-6.3µs、M=2 混合语料 -24.5/+129.1/+37.3µs。
指令明示 sign-unstable = noise。理论上界也自洽：空对象分配在 V8 分代堆
~5–15ns/任务 → N=2000 批 ≤30µs，被三字段 `=== undefined` 卫兵检查部分
抵消——落在 S4-B-4 已裁决的 143–215µs 噪声带之下。等价证据（fuzz + 探针）
已备，满足结构性重开条件时可直接引用。封死。

### 4.4 S9-B-4：错误类优先级 + 自败，双关

发散见证（对真实 `router.route` 直接调用，三次一致）：M=2 目录、
`allowedModels=["cheap","ghost"]`、role=judge（cheap 不声明 judge）——当前
代码先扫 unknown 抛 `DomainValidationError`（"Model policy references
unavailable model: ghost"）；下沉版在 partition 循环后才可能发现 ghost，而
eligible 为空的检查先行，抛出 `RoutingRefusalError`。错误类与消息都是公开
契约（refusal 消息优先级明文冻结，`DomainValidationError` 被测试断言）。
修正版必须在 partition 循环内逐 id 记账哪些 allowed id 命中了目录行、循环后
比对 `matched < allowed.size` 再定位首个 unknown——「首个」还必须按
allowedModels 原序回扫一遍（find 语义），即重建它想跳过的那份成员簿记 +
一次额外扫描：S6-B-5 型自败。量级上界即 S3-B-5 已实证「手写融合输给 V8
内建」的同域。双关封死。

### 4.5 未立候选的换名识别（负例记录）

- **makeApprovalPlan / justification 每模型字符串预物化**（`route:${id}` /
  `Use ${id}` / 成本尾段构造期 Map）：S7-B-4 在同一 buildDecision 函数域已
  实证符号翻转 + X1-1 派生缓存面，证据直接转移；items 对象享元另撞 S6-B-2
  身份否决。不立新 ID。
- **目录行无条件字段物化（治 §2c 形状罚）**：S1-C-10 属性存在性可观察 +
  公开类型形状（CatalogModel/ModelDescriptor 均导出）。不立新 ID。
- **compareLiveCandidates 体内 Number(boolean) 换三元/位运算**：S8-B-3 已
  实测整个比较器调用（含两次转换 + 调用开销）仅 ~10ns/route（E=2），体内
  任何微改动被该测量严格支配；比较器本体是文档化 R0 等价总序契约
  （S3-B-3/S8-B-3 冻结面）。不立新 ID。
- **assignTasks 的 catalogIds 与 validateConfig 内部 Set 复用**：S7-B-6
  同域（每批一次 ns 级 + 需跨函数穿状态）。不立新 ID。

## 5. 逐文件收口（第九遍透镜下的残余检查）

| 文件 | 检查项 | 结论 |
| --- | --- | --- |
| `supervisor/model-router.ts` | S9-B-1 淘汰（每批 ns）；S9-B-2 淘汰（深度噪声）；S9-B-4 淘汰（发散 + 自败）；S8-B-3、S7-B-4/6、S6-B-1/2/5、S5-B-4、S3-B-5、S2-B-2、S1-B-7 维持；`toModelDescriptor` 16% 维持 R1-B §4.4 架构裁决 | 无候选 |
| `assign.ts` | S9-B-3 淘汰（符号翻转 + S4-B-4 支配）；S8-B-4、S6-B-4、S4-B-4/5、S3-B-1、S2-B-1、S1-B-8 维持；防御拷贝护栏维持 | 无候选 |
| `analyze-task.ts` | 无新面；options 消费端取证支撑 S9-B-3 身份论证（六次字段读、零保留）；S1-B-1/2/3、S4-B-1、S5-B-1/3、S6-B-3、S7-B-1/2/5 维持 | 无候选 |
| `policy.ts` | 无新面；§2c 形状探针的属性读取站点在此取证（evaluateCandidate 的 8 处可选字段读是 PIC 敏感面，行为不变）；S7-B-3、S5-B-2、S4-B-2/3 维持；全约束独立评估为契约下界 | 无候选 |
| `assign-plan.ts` | 无新面；S8-B-1 维持（每批 ns）；`pickPreferredModel` 四级决策链维持 R8-B 收口 | 无候选 |
| `live-selection.ts` | 无新面；S8-B-2/3 维持；`compareLiveCandidates` 体内微改动换名识别（§4.5）；localeCompare = S3-B-3 冻结面 | 无候选 |
| `r0.ts` | 无新面；S1-B-6/S2-B-3/S3-B-4/S4-B-3 维持；排序输出即契约；`applyCascade` 生产不可达维持 | 无候选 |
| `live-cascade.ts` | 配置态级联探针复核（516–561ns plan / 322–339ns decide，较 R8-B 无漂移）；S1-B-4/5、S3-B-2/3 维持 | 无候选 |
| `primary-catalog.ts` / `catalog-model.ts` | §2c 形状探针的分裂源在此取证（catalogModel 四处条件 spread；行为不变，S1-C-10 维持）；纯构造 Θ(字段) 维持 | 无候选 |
| （跨切片，只记录不改） | `assignOne` src 内零生产调用方（本轮新取证，call-matrix 空格）；`applyLearnedRouting` 本体属 learning 区；`cli/model-catalog.ts` 别名行 spread 在切片外 | 不属本切片 |

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
Node 22.22.2 后运行全部测量与门禁（与 R7-B/R8-B 同处置）。node_modules 冷启
经 `pnpm install --frozen-lockfile` 补装。与本切片与本报告零关联。

仿真（临时脚本未入库——无赢家不落地死代码；完整源码见附录，seeds
`0xb99b01`–`0xb99b05`，天花板语料复用 R4-B 的 `0xb44b01`）最终一次运行：

```text
ceiling eval-replay N=2000: assignTasks M=2 5585.2us | M=10 9351.1us | analyzeTask share 1111.7us (20%)
ceiling per eval run (x2 calls): M=2 total=11.17ms | M=10 total=18.70ms | analyzeTask total=2.22ms
ceiling replay-faithful (token-free) N=2000: assignTasks M=2 4115.0us per call (8.23ms per eval x2)
ceiling 10x stress N=20000: assignTasks M=2 54.7ms per call (109.5ms per eval x2)
ceiling CLI live face N=30: assignTasks M=2 65.7us per call
configured-state replay N=2000: M=7 configured+learned 9049.1us per call (18.10ms per eval x2) | M=2 default+learned 4676.4us per call (9.35ms per eval x2)
configured-state CLI live face N=30: M=7 configured+learned 130.1us per call
configured-state per-child cascade M=7: liveCascadePlanFromAssignment=561ns decideLiveCascade=323ns
PIC shape probe N=2000 M=7: uniform-shape=8181.7us mixed-shape=8938.0us delta=756.3us per call (9.2%)
S9-B-1 bench M=2: has+add=175ns add+size=141ns delta=33ns (once per batch)
S9-B-1 bench M=10: has+add=729ns add+size=665ns delta=63ns (once per batch)
S9-B-1 anchor: createModelRouter M=2 total=700ns (once per batch)
S9-B-2 bench M=2 default ids: trim=20.5ns guard=15.5ns delta=5.0ns per route
S9-B-2 bench M=7 configured ids: trim=49.0ns guard=26.7ns delta=22.3ns per route
S9-B-3 identity probe: per-assignment requiredCapabilities distinct under candidate (true)
S9-B-3 bench N=2000 M=2 default replay: fresh-options=4568.1us empty-singleton=4434.9us delta=133.1us | real assignTasks=4842.3us (delta=2.7%)
S9-B-3 bench N=2000 M=7 configured+learned replay: fresh-options=8705.7us empty-singleton=8712.0us delta=-6.3us | real assignTasks=9509.4us (delta=-0.1%)
S9-B-3 bench N=2000 M=2 mixed-options corpus: fresh-options=4877.7us empty-singleton=4840.4us delta=37.3us
S9-B-4 witness allowedModels=[cheap,ghost] role=judge: current=DomainValidationError folded=RoutingRefusalError -> diverges=true (error-class precedence is public; corrected fold must rebuild membership bookkeeping = self-defeat)

CONCLUSIONS: ceiling M=2 per-eval=11.2ms M=10 per-eval=18.7ms replay-faithful=8.2ms (holds-below-landing-line=true) | configured-state M=7+learned replay per-eval=18.1ms live-face=130.1us (still-below-landing-line=true) | PIC-probe mixed-vs-uniform delta=756us per call | S9-B-1 equal=true | S9-B-2 equal=true | S9-B-3 equal=true identity-fresh=true | S9-B-4 witness-diverges=true
ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

三次独立运行 `CONCLUSIONS` 行的等价/见证/身份字段**逐位一致**，计时区间：
天花板 M=2 9.42–15.15ms（首次冷 VM 离群 15.15，第 2/3 次 9.42–11.17）/
M=10 18.41–19.98ms / token-free 6.96–8.28ms / 10× 压力 106.2–111.1ms；
配置态 M=7+learned 17.84–18.44ms、live 面 128.7–131.8µs；PIC 形状探针
613.3–805.5µs（7.2–10.2%，三次同向）；S9-B-1 M=2 33–43ns / M=10 63–69ns
（三次同向）；S9-B-2 M=2 2.9–5.0ns / M=7 21.5–22.3ns（三次同向）；S9-B-3
三口径九次测量**符号翻转**（M=2 replay -40.1/+240.3/+133.1、M=7
+188.1/+62.0/-6.3、混合 -24.5/+129.1/+37.3µs）。S9-B-4 发散见证三次全部
`diverges=true`。

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S9-B-1 | validateConfig 查重 has+add 换 add+size 单探针（S5-F 落地赢家镜像） | 等价（4000 fuzz first-fault 逐字节）但每 createModelRouter（每批）一次 M=2 33–43ns / M=10 63–69ns；createModelRouter 全程本就 ~700ns/批（S7-B-6/S2-B-2 同带）；S5-F 赢在 O(N)×2000 热站点，此处 N≤10 每批一次 |
| S9-B-2 | validateInput per-id trim 可打印 ASCII 首字符卫（S7-F-2 第二次镜像；S8-F-2 后） | 等价（20000 fuzz 含 NBSP/全角/CJK 布尔逐位）但 2.9–5.0ns（M=2）/ 21.5–22.3ns（M=7）每 route，N=2000 批上界 6–45µs——低于历史噪声带一档；V8 无空白 trim 本有快路径 |
| S9-B-3 | assignPlanned 三字段全 undefined 时共享冻结空 AnalyzeTaskOptions 单例 | 等价且身份不可观察（options 不被 analyzeTask 保留；requiredCapabilities 探针新鲜）——首个通过身份关的享元候选，但三口径九次测量全部符号翻转（M=2 replay -40/+240/+133µs、M=7 +188/+62/-6µs、混合 -25/+129/+37µs）＝纯抖动；上界被 S4-B-4 已裁决噪声带支配 |
| S9-B-4 | route() unknown-model 预扫描下沉进 partitionLiveCandidates | 不等价：发散见证 [cheap,ghost]+judge 全拒时错误类由 DomainValidationError 变 RoutingRefusalError（错误类优先级是公开契约）；修正版须逐 id 记账命中 + 原序回扫定位首 unknown＝重建被跳过的成员簿记（S6-B-5 型自败） |

**结构性重开条件（对整个切片，与 R4-B…R8-B 一致并经本轮第六次复测 + 形状
探针确认）**：eval 数据集规模增长 ≥1 个量级（N≥20000 时切片全量 ~106–111
ms/eval，20–30% 级候选开始触线），或 analyzeTask/route 进入每 turn 热路径，
或出现新的高频调用方，或配置目录 M 增长到使 M=10 压力口径失效。逐候选重开
条件：S9-B-1/2/3 需先满足结构性条件（等价证据本报告已备，可直接引用；
S9-B-3 另需在结构性规模上推翻符号翻转）；S9-B-4 需 unknown-model 错误类
优先级被正式改为 refusal 优先（行为面变更，超出本战役范围）。形状罚
（§2c）的重开条件：CatalogModel/ModelDescriptor 的属性存在性被正式声明为
非契约（S1-C-10 解除），且形状罚随 M 增长突破天花板支配。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.ts` 后 `npx tsx <file>`（仓库根目录，依赖已装）。
seeds：`0xb99b01`–`0xb99b05`；天花板语料复用 R4-B 的 `0xb44b01` 以保证可比；
配置态目录与 R8-B 逐字节相同。

```ts
/**
 * R9-B deterministic equivalence + benchmark simulation (ninth pass).
 * 1) Re-measures the R4-B..R8-B aggregate slice ceiling (corpus seed 0xb44b01
 *    reused verbatim) plus replay-faithful token-free and the R8-B
 *    configured-state anchors (M=7 buildLiveCatalogConfig-shaped catalog +
 *    non-empty learned prefer/avoid).
 * 2) NEW (PIC watch, S8-A-3/S8-E-2/S8-H-1): a catalog hidden-class shape probe
 *    — uniform-shape vs mixed-shape M=7 rows on the same corpus, quantifying
 *    whether optional-field shape polymorphism opens a configured-state hole.
 * 3) Adjudicates fresh Round-9 candidates S9-B-1 .. S9-B-4 against the live
 *    routing slice, byte-identical since R1-B's baseline 94ed3d9.
 * Seeded PRNG (mulberry32) -> fully reproducible. Seeds 0xb99b01-0xb99b06.
 */
import { performance } from "node:perf_hooks";
import { analyzeTask, type AnalyzeTaskOptions } from "/workspace/src/routing/analyze-task.js";
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
import { catalogModel, type CatalogModelInput } from "/workspace/src/routing/catalog-model.js";
import {
  liveCascadePlanFromAssignment,
  decideLiveCascade
} from "/workspace/src/routing/live-cascade.js";
import { DomainValidationError } from "/workspace/src/domain/errors.js";
import {
  createModelRouter,
  type ModelRouter,
  type ModelRouterConfig,
  type RoutingLimits
} from "/workspace/src/supervisor/model-router.js";
import type { AgentRole } from "/workspace/src/domain/roles.js";
import type { TaskComplexity } from "/workspace/src/domain/flowchart.js";

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
  return { policyVersion: "sim-r9b", models };
}
/** Configured-state catalog, byte-identical to R8-B's (M=7, alias rows). */
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
 * §0 Ceiling re-measurement (R4-B..R8-B methodology, corpus seed 0xb44b01
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
 * §0b Configured-state anchors (R8-B methodology, byte-identical catalog).
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
 * §0c NEW: catalog hidden-class shape probe (PIC watch).
 * Uniform-shape M=7 (every row declares privacyClass + contextWindow +
 * maxOutputTokens + approvedForHighRisk -> one post-catalogModel hidden class)
 * vs mixed-shape M=7 (rows declare different optional subsets -> up to 7
 * distinct hidden classes flowing through partitionLiveCandidates /
 * evaluateLiveCandidate / toModelDescriptor). Same corpus, same policy shape.
 * This is a measurement, not a candidate: shape canonicalization itself is
 * excluded (S1-C-10 property-existence class), so the probe only checks that
 * shape polymorphism does not open an unmeasured configured-state hole.
 * ============================================================ */
{
  const base = {
    roles: ["actor", "critic"] as const,
    maxComplexity: "MEDIUM" as TaskComplexity,
    estimatedDurationMs: 1500,
    inputCostPerMTok: 1,
    outputCostPerMTok: 3
  };
  const uniform: ModelRouterConfig = {
    policyVersion: "sim-r9b-uniform",
    models: Array.from({ length: 7 }, (_, i) => ({
      ...base,
      id: `u${i}`,
      version: `u${i}-v1`,
      maxComplexity: (i === 6 ? "HIGH" : "MEDIUM") as TaskComplexity,
      estimatedCostUsd: 0.001 * (i + 1),
      privacyClass: "cloud-general" as const,
      contextWindow: 100_000,
      maxOutputTokens: 16_000,
      approvedForHighRisk: i === 6
    }))
  };
  // Mixed: rows declare different optional-field subsets (7 distinct shapes).
  const mixed: ModelRouterConfig = {
    policyVersion: "sim-r9b-mixed",
    models: [
      { ...base, id: "x0", version: "x0-v1", estimatedCostUsd: 0.001 },
      { ...base, id: "x1", version: "x1-v1", estimatedCostUsd: 0.002, contextWindow: 100_000 },
      { ...base, id: "x2", version: "x2-v1", estimatedCostUsd: 0.003, maxOutputTokens: 16_000 },
      { ...base, id: "x3", version: "x3-v1", estimatedCostUsd: 0.004, privacyClass: "cloud-general" as const },
      { ...base, id: "x4", version: "x4-v1", estimatedCostUsd: 0.005, contextWindow: 100_000, maxOutputTokens: 16_000 },
      { ...base, id: "x5", version: "x5-v1", estimatedCostUsd: 0.006, privacyClass: "cloud-general" as const, contextWindow: 100_000, maxOutputTokens: 16_000 },
      { ...base, id: "x6", version: "x6-v1", maxComplexity: "HIGH" as TaskComplexity, estimatedCostUsd: 0.007, privacyClass: "cloud-general" as const, contextWindow: 100_000, maxOutputTokens: 16_000, approvedForHighRisk: true }
    ]
  };
  const replayTasks = genReplayTasks(mulberry32(0xb44b01), 2000);
  const uniformCost = bench(() => assignTasks({ catalog: uniform, tasks: replayTasks }), 30);
  const mixedCost = bench(() => assignTasks({ catalog: mixed, tasks: replayTasks }), 30);
  console.log(
    `PIC shape probe N=2000 M=7: uniform-shape=${(uniformCost * 1e3).toFixed(1)}us mixed-shape=${(mixedCost * 1e3).toFixed(1)}us delta=${((mixedCost - uniformCost) * 1e3).toFixed(1)}us per call (${(((mixedCost - uniformCost) / uniformCost) * 100).toFixed(1)}%)`
  );
  conclusions.push(
    `PIC-probe mixed-vs-uniform delta=${((mixedCost - uniformCost) * 1e3).toFixed(0)}us per call`
  );
}

/* ============================================================
 * S9-B-1: validateConfig duplicate-id probe dedup (S5-F landed-winner mirror).
 * current:  if (ids.has(model.id)) throw; ids.add(model.id)
 * candidate: const before = ids.size; ids.add(model.id);
 *            if (ids.size === before) throw
 * First-fault order and message byte-identical by construction; adjudicated
 * over a duplicate/role-fault fuzz. Once per createModelRouter (per batch).
 * ============================================================ */
const SIM_ROLES = ["actor", "critic", "router", "judge", "tool", "human"] as const;
function validateConfigReplica(models: readonly ReturnType<typeof catalogModel>[], probeDedup: boolean): void {
  const ids = new Set<string>();
  for (const model of models) {
    if (probeDedup) {
      const before = ids.size;
      ids.add(model.id);
      if (ids.size === before) {
        throw new DomainValidationError("ModelRouter model ids must be unique and non-empty");
      }
    } else {
      if (ids.has(model.id)) {
        throw new DomainValidationError("ModelRouter model ids must be unique and non-empty");
      }
      ids.add(model.id);
    }
    if (!Array.isArray(model.roles) || model.roles.length === 0) {
      throw new DomainValidationError(`ModelRouter model ${model.id} must declare roles`);
    }
    if (new Set(model.roles).size !== model.roles.length) {
      throw new DomainValidationError(`ModelRouter model ${model.id} declares duplicate roles`);
    }
    const unknownRole = model.roles.find((role) => !(SIM_ROLES as readonly string[]).includes(role));
    if (unknownRole !== undefined) {
      throw new DomainValidationError(`ModelRouter model ${model.id} declares unknown role: ${String(unknownRole)}`);
    }
  }
}
function outcomeOfVoid(fn: () => void): string {
  try {
    fn();
    return "OK";
  } catch (error) {
    return `THROW:${(error as Error).message}`;
  }
}
{
  const rng = mulberry32(0xb99b01);
  for (let trial = 0; trial < 4000; trial += 1) {
    const m = 1 + Math.floor(rng() * 10);
    const models = Array.from({ length: m }, (_, i) =>
      catalogModel({
        id: rng() < 0.15 && i > 0 ? `m${Math.floor(rng() * i)}` : `m${i}`, // 15% duplicate ids
        version: `v${i}`,
        roles:
          rng() < 0.1
            ? (["actor", "actor"] as never) // duplicate roles fault
            : rng() < 0.1
              ? (["actor", "ghost-role"] as never) // unknown role fault
              : (["actor", "critic"] as const),
        maxComplexity: "MEDIUM" as TaskComplexity,
        estimatedCostUsd: 0.1,
        estimatedDurationMs: 500
      })
    );
    const cur = outcomeOfVoid(() => validateConfigReplica(models, false));
    const cand = outcomeOfVoid(() => validateConfigReplica(models, true));
    check("S9-B-1 first-fault equivalence", cur === cand, JSON.stringify({ trial, cur, cand }));
  }
  for (const m of [2, 10]) {
    const config = m === 2 ? catalogFromPrimary({ primaryModelId: "premium" }) : tenModelCatalog();
    const models = config.models.map((model) => catalogModel(model));
    const cur = bench(() => validateConfigReplica(models, false), 100000);
    const cand = bench(() => validateConfigReplica(models, true), 100000);
    console.log(
      `S9-B-1 bench M=${m}: has+add=${(cur * 1e6).toFixed(0)}ns add+size=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns (once per batch)`
    );
  }
  // Whole-construction anchor: how much of createModelRouter is this at all?
  const cfg = catalogFromPrimary({ primaryModelId: "premium" });
  const whole = bench(() => createModelRouter(cfg), 20000);
  console.log(`S9-B-1 anchor: createModelRouter M=2 total=${(whole * 1e6).toFixed(0)}ns (once per batch)`);
  conclusions.push("S9-B-1 equal=true");
}

/* ============================================================
 * S9-B-2: validateInput trim printable-ASCII first-char guard (S7-F-2 mirror,
 * second mirror attempt after S8-F-2's rejection in the experiments slice).
 * current per id: typeof id === "string" && id.trim() !== ""
 * candidate: code-point 33..126 first char skips the trim; otherwise fall back.
 * ============================================================ */
function idNonEmptyCurrent(id: unknown): boolean {
  return typeof id === "string" && (id as string).trim() !== "";
}
function idNonEmptyGuarded(id: unknown): boolean {
  if (typeof id !== "string") return false;
  const s = id as string;
  if (s.length > 0) {
    const c = s.charCodeAt(0);
    if (c >= 33 && c <= 126) return true;
  }
  return s.trim() !== "";
}
{
  const rng = mulberry32(0xb99b02);
  const CASES: readonly unknown[] = [
    "cheap", "premium", "acme/frontier", " leading", "trailing ", "  ", "", "\t\n",
    "验证", "碎片id", "\u00a0nbsp", "m0", "M0", "!bang", "~tilde", 42, undefined, null, "\u3000full-width"
  ];
  for (let trial = 0; trial < 20000; trial += 1) {
    const id = rng() < 0.6 ? pick(rng, CASES) : `${rng() < 0.5 ? " " : ""}m${Math.floor(rng() * 100)}${rng() < 0.3 ? " " : ""}`;
    check(
      "S9-B-2 guard equivalence",
      idNonEmptyCurrent(id) === idNonEmptyGuarded(id),
      JSON.stringify({ trial, id: String(id) })
    );
  }
  for (const [label, ids] of [
    ["M=2 default ids", ["cheap", "premium"]],
    ["M=7 configured ids", ["acme/fast-mini", "acme/std", "orion/coder", "orion/lite", "acme/frontier", "cheap", "premium"]]
  ] as const) {
    const cur = bench(() => {
      for (const id of ids) idNonEmptyCurrent(id);
    }, 200000);
    const cand = bench(() => {
      for (const id of ids) idNonEmptyGuarded(id);
    }, 200000);
    console.log(
      `S9-B-2 bench ${label}: trim=${(cur * 1e6).toFixed(1)}ns guard=${(cand * 1e6).toFixed(1)}ns delta=${((cur - cand) * 1e6).toFixed(1)}ns per route`
    );
  }
  conclusions.push("S9-B-2 equal=true");
}

/* ============================================================
 * S9-B-3: assignPlanned shared frozen empty AnalyzeTaskOptions on the
 * all-undefined path (the replay-faithful main path). The options object is
 * never retained by analyzeTask (it only reads six fields), so a module-level
 * frozen {} is not identity-observable. Distinct from the excluded S4-B-4
 * (pass task directly): no wide-object boundary, and its measured saving is a
 * strict subset of S4-B-4's (the checks stay; only the allocation goes).
 * Replica calls the exact same real dependencies as src/routing/assign.ts.
 * ============================================================ */
const DEFAULT_LIMITS: RoutingLimits = { remainingTimeMs: Number.MAX_SAFE_INTEGER };
const EMPTY_OPTIONS: AnalyzeTaskOptions = Object.freeze({});
function assignPlannedReplica(
  router: ModelRouter,
  plan: AssignmentPolicyPlan,
  task: AssignableTask,
  limits: RoutingLimits,
  learned: LearnedRoutingPolicy | undefined,
  emptySingleton: boolean
): TaskAssignment {
  const options =
    emptySingleton &&
    task.contractRisk === undefined &&
    task.contextTokens === undefined &&
    task.outputTokens === undefined
      ? EMPTY_OPTIONS
      : {
          ...(task.contractRisk !== undefined ? { contractRisk: task.contractRisk } : {}),
          ...(task.contextTokens !== undefined ? { contextTokens: task.contextTokens } : {}),
          ...(task.outputTokens !== undefined ? { outputTokens: task.outputTokens } : {})
        };
  const analysis = analyzeTask(task.objective, task.role, options);
  let allowedModels: readonly string[] = [...plan.allowedIds];
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
function outcomeOf(fn: () => TaskAssignment): string {
  try {
    return JSON.stringify(fn());
  } catch (error) {
    return `THROW:${(error as Error).message}`;
  }
}
{
  const rng = mulberry32(0xb99b03);
  for (let trial = 0; trial < 3000; trial += 1) {
    const catalog = rng() < 0.5 ? catalogFromPrimary({ primaryModelId: "premium" }) : tenModelCatalog();
    const router = createModelRouter(catalog);
    const catalogIds = catalog.models.map((model) => model.id);
    const plan = planAssignmentPolicy(router.config.models, catalogIds);
    const learned: LearnedRoutingPolicy | undefined =
      rng() < 0.5
        ? undefined
        : {
            primaryModelId: catalogIds[catalogIds.length - 1]!,
            avoid: rng() < 0.5 ? [{ modelId: catalogIds[0]!, reason: "sim" }] : [],
            prefer: rng() < 0.5 ? [{ family: "plan", modelId: catalogIds[catalogIds.length - 1]! }] : []
          };
    const tasks = rng() < 0.5 ? genTasks(rng, 1 + Math.floor(rng() * 4)) : genReplayTasks(rng, 1 + Math.floor(rng() * 4));
    // Fidelity: replica (singleton off) must equal the real assignTasks byte-for-byte.
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
    check("S9-B-3 replica fidelity vs assignTasks", real === replicaBatch, `trial ${trial}`);
    for (const task of tasks) {
      const cur = outcomeOf(() => assignPlannedReplica(router, plan, task, DEFAULT_LIMITS, learned, false));
      const cand = outcomeOf(() => assignPlannedReplica(router, plan, task, DEFAULT_LIMITS, learned, true));
      check("S9-B-3 value equivalence", cur === cand, `trial ${trial}`);
    }
  }
  // Identity probe: requiredCapabilities defaults stay fresh per assignment
  // under the candidate (the ?? ["tool-use"] branch allocates inside
  // analyzeTask, not from the shared options object).
  {
    const catalog = catalogFromPrimary({ primaryModelId: "premium" });
    const router = createModelRouter(catalog);
    const catalogIds = catalog.models.map((model) => model.id);
    const plan = planAssignmentPolicy(router.config.models, catalogIds);
    const probeTasks = genReplayTasks(mulberry32(0xb99b04), 3);
    const out = probeTasks.map((task) => assignPlannedReplica(router, plan, task, DEFAULT_LIMITS, undefined, true));
    const distinct =
      out[0]!.analysis.requiredCapabilities !== out[1]!.analysis.requiredCapabilities &&
      out[1]!.analysis.requiredCapabilities !== out[2]!.analysis.requiredCapabilities;
    check("S9-B-3 candidate identity (requiredCapabilities fresh)", distinct);
    console.log(`S9-B-3 identity probe: per-assignment requiredCapabilities distinct under candidate (${distinct})`);
  }
  // Benchmark at the largest realistic scale: replay-faithful token-free tasks
  // (the all-undefined fast-path corpus) on M=2 default and M=7 configured,
  // plus the mixed corpus where the guard pays double checks on misses.
  for (const [label, benchCatalog, benchLearned] of [
    ["M=2 default replay", catalogFromPrimary({ primaryModelId: "premium" }), undefined],
    ["M=7 configured+learned replay", configuredCatalog(), configuredLearned()]
  ] as const) {
    const benchRouter = createModelRouter(benchCatalog);
    const benchIds = benchCatalog.models.map((model) => model.id);
    const benchPlan = planAssignmentPolicy(benchRouter.config.models, benchIds);
    const benchTasks = genReplayTasks(mulberry32(0xb99b05), 2000);
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
    const whole = bench(() => assignTasks({ catalog: benchCatalog, tasks: benchTasks, ...(benchLearned !== undefined ? { learned: benchLearned } : {}) }), 30);
    console.log(
      `S9-B-3 bench N=2000 ${label}: fresh-options=${(cur * 1e3).toFixed(1)}us empty-singleton=${(cand * 1e3).toFixed(1)}us delta=${((cur - cand) * 1e3).toFixed(1)}us | real assignTasks=${(whole * 1e3).toFixed(1)}us (delta=${(((cur - cand) / whole) * 100).toFixed(1)}%)`
    );
  }
  {
    // Mixed corpus: 10% contractRisk / 30% contextTokens / 30% outputTokens —
    // the guard's miss path pays three extra === undefined checks.
    const benchCatalog = catalogFromPrimary({ primaryModelId: "premium" });
    const benchRouter = createModelRouter(benchCatalog);
    const benchIds = benchCatalog.models.map((model) => model.id);
    const benchPlan = planAssignmentPolicy(benchRouter.config.models, benchIds);
    const benchTasks = genTasks(mulberry32(0xb99b05), 2000);
    const cur = bench(() => {
      for (const task of benchTasks) {
        assignPlannedReplica(benchRouter, benchPlan, task, DEFAULT_LIMITS, undefined, false);
      }
    }, 30);
    const cand = bench(() => {
      for (const task of benchTasks) {
        assignPlannedReplica(benchRouter, benchPlan, task, DEFAULT_LIMITS, undefined, true);
      }
    }, 30);
    console.log(
      `S9-B-3 bench N=2000 M=2 mixed-options corpus: fresh-options=${(cur * 1e3).toFixed(1)}us empty-singleton=${(cand * 1e3).toFixed(1)}us delta=${((cur - cand) * 1e3).toFixed(1)}us`
    );
  }
  conclusions.push("S9-B-3 equal=true identity-fresh=true");
}

/* ============================================================
 * S9-B-4: unknown-model check folded into partitionLiveCandidates.
 * Divergence witness: when allowedModels holds a ghost id AND every real
 * allowed model is refused, route() must throw DomainValidationError for the
 * ghost (checked before partitioning); the folded form only discovers the
 * ghost after the scan and would surface RoutingRefusalError instead —
 * error-class precedence is public (tests assert DomainValidationError).
 * A corrected fold must track which allowed ids matched catalog rows, i.e.
 * rebuild the membership bookkeeping it tried to skip (S6-B-5-style
 * self-defeat).
 * ============================================================ */
{
  const catalog = catalogFromPrimary({ primaryModelId: "premium" });
  const router = createModelRouter(catalog);
  let currentError = "none";
  try {
    router.route({
      taskId: "tsk_witness" as AssignableTask["taskId"],
      role: "judge", // cheap does not declare judge; premium does but complexity gate below
      complexity: "HIGH",
      modelPolicy: { allowedModels: ["cheap", "ghost"] },
      limits: { remainingTimeMs: Number.MAX_SAFE_INTEGER }
    });
  } catch (error) {
    currentError = (error as Error).constructor.name;
  }
  // Folded replica: skip the pre-scan; partition first, then discover ghost.
  let foldedError = "none";
  try {
    const models = router.config.models;
    const allowed = new Set(["cheap", "ghost"]);
    const eligible: unknown[] = [];
    const refusals: unknown[] = [];
    let matched = 0;
    for (const model of models) {
      if (!allowed.has(model.id)) continue;
      matched += 1;
      // cheap fails the judge role gate -> refusal
      refusals.push({ modelId: model.id, constraint: "role", detail: "role judge not declared" });
    }
    if (eligible.length === 0) {
      // The naive fold reports refusal before it ever learns about the ghost.
      throw new Error("RoutingRefusalError-shaped");
    }
    if (matched < allowed.size) throw new DomainValidationError("ghost discovered late");
  } catch (error) {
    foldedError = (error as Error).constructor.name === "DomainValidationError" ? "DomainValidationError" : "RoutingRefusalError";
  }
  const diverges = currentError === "DomainValidationError" && foldedError !== "DomainValidationError";
  check("S9-B-4 divergence witness", diverges, JSON.stringify({ currentError, foldedError }));
  console.log(
    `S9-B-4 witness allowedModels=[cheap,ghost] role=judge: current=${currentError} folded=${foldedError} -> diverges=${diverges} (error-class precedence is public; corrected fold must rebuild membership bookkeeping = self-defeat)`
  );
  conclusions.push(`S9-B-4 witness-diverges=${diverges}`);
}

console.log(`\nCONCLUSIONS: ${conclusions.join(" | ")}`);
if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```
