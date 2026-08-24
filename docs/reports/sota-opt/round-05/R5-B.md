# R5-B：live 路由切片 Round 5 五搜报告

**战役:** 全库持久 SOTA 优化 Round 5 / R5-B（十区之一，R1-B/R2-B/R3-B/R4-B 的第五遍）
**基线:** `cursor/sota-persistent-opt-83a1` @ `a695ca8`（含 S4-C、R5-A 报告与 S5-A-1..3）
**分支:** `cursor/r5-b-live-routing-fifth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动；R4-B 的整片成本天花板经复测成立。**
关键前提事实：切片 8 个文件加 4 个只读上下游自 R1-B 的裁决基线 `94ed3d9` 以来
**逐字节零变化**（`git diff 94ed3d9..a695ca8` 对 12 个文件为空；期间全 src 树的
合入——S1-C/S1-I/S2-C/S3-C/S4-C/J1/S1-F——均在切片外，其中 S4-C 只改
`src/routing/lin-alg.ts`），R1-B 的结构下界论证、R4-B 的聚合天花板论证与
S1-B-1..8、S2-B-1..4、S3-B-1..6、S4-B-1..5 全部裁决对当前代码原样成立。

R4-B 的 9.7–20.0 ms/eval 天花板本轮实测复核为 **11.0–11.5 ms/eval（M=2）/
18.6–18.9 ms/eval（M=10）**，同带成立；本轮另立一个**更贴近真实回放的
token-free 口径**（`eval-routing.ts` 的任务只带 taskId/role/objective，无
token 字段），实测仅 **8.3–8.7 ms/eval**——真实天花板比 R4-B 的保守口径还低。
落地线（数十~数百 ms 或复杂度类下降）依旧不可达：即使把整个切片成本消为零也在
落地线下沿之下，且 R1-B §2 已逐函数关闭复杂度类通道。

在此前四轮四组透镜之外，本轮换第五组新透镜穷举，得到 4 个排除表未覆盖的新提案
（S5-B-1 … S5-B-4），全部经理论 + 确定性仿真（seeded mulberry32，等价性 fuzz +
真实规模基准，三次独立运行等价结论逐位一致、基准方向一致）裁决后淘汰：4 个
全部等价成立但深度噪声级（22–323 µs/批），其中 S5-B-2 的 deadline 姊妹变体另有
**不等价发散见证**（一并封死）。未重开任何 X* / S1-* / S2-* / S3-* / S4-* /
S5-A-* 条目。按指令不硬凑赢家：现状仍为该数据面契约下的 SOTA。

## 0. 范围与约束遵守

- 切片：`src/routing/{r0,assign,policy,live-cascade,analyze-task,primary-catalog,catalog-model}.ts`、
  `src/supervisor/model-router.ts` 全量重读；上下游 `assign-plan.ts`、`live-selection.ts`、
  `capability-registry.ts`、`cascade-evidence.ts` 只读取证，一行未改。
- 先读并遵守（顺序强制）：README / EXCLUSIONS.md（全表）/ round-05/PLAN.md /
  round-01/R1-B.md / round-02/R2-B.md / round-03/R3-B.md / round-04/R4-B.md。
- 基线漂移检查：`git diff --stat 94ed3d9..a695ca8 -- <切片 8 文件 + 上下游 4 文件>`
  为空（工具验证输出 `SLICE+NEIGHBORS BYTE-IDENTICAL since 94ed3d9`）。
  `git diff --stat f0748a9..a695ca8 -- src/` 全 src 仅 `src/routing/lin-alg.ts`
  一个文件（S4-C，切片外）。R1-B/R2-B/R3-B/R4-B 的规模测量、调用方图景与全部
  裁决对当前代码原样成立。
- 换名重提检查：本轮枚举中识别出并**未列为新候选**的既有方案换名——
  decision 字段惰性 getter 化（= S1-C-10/S4-E-3 属性存在性/形状可观察类）、
  批内共享 allowed-Set / 请求骨架（= S4-B-5/S3-B-6 家族）、双 assignTasks 共享
  router/plan/analysis（= S2-D-4）、partitionLiveCandidates 记忆化（= S3-B-1/X1-6）、
  toModelDescriptor 预建/缓存（= R1-B §4.4 架构裁决三通道）。
- R1/posterior/offline-* 未碰；live 保持 R0 等价，R1 未接线：`live-isolation`
  3/3 绿（§6）。三线规格（分析不改 in-flight、Tracking 无命令权、H/score 不写
  路由、双 LCB 双归因保留、提升 proposal-first、Checkpoint F-PROD 开放）零 diff
  天然满足。不声称 Outcome-supported。
- 零 diff，公开 API / 决策对象 schema / refusal 消息优先级 / tie-break 语义
  天然不变。无阈值改动，无测试改动。

## 1. 第五遍搜索方法与调用方图景复核

R1-B 用「输出契约渐近下界」，R2-B 用「跨模块身份/重复归一化/姊妹变体」，R3-B 用
「批内去重/比较器热循环/语义面与分配消除」，R4-B 用「聚合天花板/多模式自动机/
约束依赖分解/分配来源穷尽」。本轮换第五组透镜：

1. **死值谓词透镜**：找条件分支中 consequent 与 fallthrough 收敛到同一值的
   value-dead 判定（产出 S5-B-1——`complexityOf` 尾部 `family===plan||research`
   判定两侧都返回 `"MEDIUM"`）。
2. **哨兵值恒假约束透镜**：live 默认限额路径上 `budgetUsd = +∞`（assignTasks 不带
   remainingCostUsd → `?? Number.POSITIVE_INFINITY`），`cost > +∞` 对一切浮点
   （含 NaN/∞）恒假，成本估计成为死计算（产出 S5-B-2；deadline 哨兵是
   MAX_SAFE_INTEGER，有限，不可同类短路——发散见证见 §4.2）。
3. **字符串构造原语透镜**：`analyzeTask` 的 reason 用 5 元数组 + join 构造，与
   单模板字面量逐字节同值（产出 S5-B-3；方向与 S1-I-7/S2-I-3「parts+join 更慢」
   教训一致——数组分配 + join 调用输给直接拼接）。
4. **中间聚合对象透镜**：`route()` 每次分配 9 字段 `ResolvedRouteRequest` 中间
   对象，可内联为局部变量（产出 S5-B-4）。

调用方图景复核（grep 全 src 取证，与 R4-B 记录逐条一致，且因 src 树除 lin-alg
外零变化而必然一致）：`routeR0` 唯一生产调用方仍是 `r1-shadow-report.ts`；
`applyCascade` 生产不可达（`applyEvidenceCascade` 在 src 内无调用方）；
`decideLiveCascade` 在 `run/child-coordinator.ts` 每 child 结果一次；`assignTasks`
调用方为 `cli/main.ts`（N≤30）、`track/primary-split.ts`、`track/loop.ts`，最大
规模入口 `adaptation/eval-routing.ts` N=episodes ×2（baseline+candidate）。
本轮新增取证：**最大规模入口的任务对象只带 taskId/role/objective**
（eval-routing.ts L348-352），无 contextTokens/outputTokens，且不带
remainingCostUsd/remainingTimeMs——即真实回放全程 `budgetUsd=+∞`、
`deadlineMs=MAX_SAFE_INTEGER`、`useTokens=false`（fixedCostUsd/fixedLatencyMs
走属性读，不调 estimateCostUsd/estimateLatencyMs）。

## 2. 天花板复测：R4-B 收口第二次复核成立且实际更紧

实测（本 VM，三次运行区间；语料生成器与 R4-B 逐字节相同、种子 `0xb44b01` 复用
以保证可比；完整脚本见附录）：

```text
ceiling eval-replay N=2000: assignTasks M=2 5480.8–5758.5us | M=10 9311.1–9433.9us | analyzeTask share 1107.1–1122.4us (19–20%)
ceiling per eval run (x2 calls): M=2 total=10.96–11.52ms | M=10 total=18.62–18.87ms | analyzeTask total=2.21–2.24ms
ceiling replay-faithful (token-free) N=2000: assignTasks M=2 4170.5–4366.4us per call (8.34–8.73ms per eval x2)
ceiling 10x stress N=20000: assignTasks M=2 49.7–50.8ms per call (99.4–101.6ms per eval x2)
ceiling CLI live face N=30: assignTasks M=2 58.1–73.7us per call
```

推论链（R4-B §2 的四条在复测数字上原样成立，另加一条收紧）：

1. M=2/M=10 天花板 11.0–11.5 / 18.6–18.9 ms/eval，落在 R4-B 的 9.7–20.0 ms
   区间内——收口结论无漂移。
2. **收紧**：R4-B 语料带 30% contextTokens/30% outputTokens，而真实回放任务
   无 token 字段（§1 取证）。token-free 口径实测 8.3–8.7 ms/eval，即 R4-B 口径
   本身已是高估——真实天花板离落地线更远。
3. 复杂度类通道维持关闭：R1-B §2 逐函数下界（排序即输出 Ω(M log M)、全约束
   评估即 rejection-matrix 契约 Θ(M×约束数)、决策构造 Θ(输出字段数)）在逐字节
   未变的代码上原样成立。
4. 结构性重开条件不变：10× 压力（N=20000）下切片全量 ~99–102 ms/eval，届时
   20–30% 级候选才开始触线。

## 3. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S5-B-1 | `analyze-task.ts` `complexityOf` 尾部死值谓词消除（`family===plan\|\|research` 两侧同返 `"MEDIUM"`） | 每任务省 ≤2 次字符串比较；静态论证：谓词 value-dead | ✅ 12000 组 fuzz 逐字节（replica 保真 + 候选） | N=2000 批省 22.1–46.4µs | 淘汰：深度噪声；且该谓词是「plan/research 归 MEDIUM」的意图文档，删除属可读性权衡而非性能收益（§4.1） |
| S5-B-2 | `policy.ts` `evaluateCandidate` 无限预算短路（`budgetUsd===+∞` 时跳过成本估计与预算检查） | live 默认限额路径 budget 恒 +∞，`cost > +∞` 恒假（含 NaN/∞），成本估计为死计算 | ✅ 6000 组 fuzz（40% ∞ 预算 + 有限预算 + NaN 邻域）逐字节；❌ deadline 姊妹有发散见证 | 合成上界（token-bearing）批省 136.6–145.7µs；**真实回放口径（token-free + fixed 字段）仅 29.3–55.9µs** | 淘汰：真实路径上成本估计本就不被调用（fixedCostUsd 属性读），收益是死比较级；哨兵特判侵蚀共享约束矩阵「全约束独立评估」的均匀性护栏（§4.2） |
| S5-B-3 | `analyze-task.ts` reason 构造 5 元数组 + join 换单模板字面量 | 免 1 次数组分配 + 1 次 join 调用；与 S1-I-7/S2-I-3「join 更慢」教训同向 | ✅ 12000 组 fuzz 逐字节 | analyzeTask 常数 -23%（646→499ns）；N=2000 批省 301.2–323.3µs | 淘汰：本轮最强候选，但落在 S1-B 捆绑（284µs）/S4-B-5（232–349µs）已裁决的同一噪声带——一次性离线路径 ~5.5% 常数因子，换算 ~0.6ms/eval，低于落地线一个量级以上，且被 §2 天花板支配（§4.3） |
| S5-B-4 | `model-router.ts` `route()` 的 `ResolvedRouteRequest` 9 字段中间对象消除（内联为局部变量） | 每 route 免 1 次 9 字段对象分配 | ✅ 3000 组 fuzz 对真实 `router.route` 逐字节（含 refusal THROW 路径） | N=2000 批（route-only）省 46.1–68.1µs | 淘汰：深度噪声；且拆散命名结构体、把 9 个裸局部穿两个消费点，可读性净损（§4.4） |

## 4. 关键裁决细节

### 4.1 S5-B-1：value-dead 但不是免费删除

`complexityOf` 尾部：

```ts
if (input.family === "plan" || input.family === "research") return "MEDIUM";
return "MEDIUM";
```

谓词两侧收敛同值，静态可证 value-dead；12000 组 fuzz（真实语料模板 + 碎片混合
+ 中文 + 空串 × 7 角色 × 全 options 组合）确认逐字节等价。但收益实测
22.1–46.4µs/批（N=2000），亚 analyzeTask 抖动带（该批 analyzeTask 全量
1107–1148µs）。且该行是「plan/research 家族归 MEDIUM」这一分类决策的**唯一
显式记载**——删除后语义只存在于 fallthrough 里，未来在其后添加更低优先级分支时
极易引入回归。性能上不达标，可读性上是权衡而非纯赚：不动。

### 4.2 S5-B-2：真实路径上短路的是「已经不存在」的计算

理论面完备：`x > Number.POSITIVE_INFINITY` 对一切 IEEE 浮点恒假（含 NaN 与
+∞ 自身），cost 只流入该比较与失败 detail 字符串（预算 ∞ 时不可达），跳过
等价。6000 组 fuzz（∞/有限/极小预算混合）逐字节确认。但两层否决：

1. **收益虚高一层**：合成 token-bearing 口径的 136.6–145.7µs/批是上界——真实
   回放路径 `useTokens=false` 且 `fixedCostUsd` 恒在（partitionLiveCandidates
   总是传 `model.estimatedCostUsd`），`??` 链根本不调 `estimateCostUsd`，
   实际省的只是一次属性读 + 一次恒假比较，实测 29.3–55.9µs/批，深度噪声。
2. **护栏面**：`evaluateCandidate` 的 docstring 与 policy.ts L154-156 注释绑定
   的契约是「每个硬约束独立评估、完整 rejection matrix 可归因」。按请求值特判
   跳过某约束的求值路径，使 live 默认路径永不再执行预算约束代码——行为等价但
   均匀性护栏被侵蚀（S2-H-7/S4-D-4「防御纵深保留」同类裁决）。

**deadline 姊妹变体一并封死**：`deadlineMs` 的哨兵是 `Number.MAX_SAFE_INTEGER`
（有限）。发散见证：`latencyMsPer1K=1e13, outputNeeded=1e6` →
`estimateLatencyMs = 1.00e+16 > 9.007e15`，当前代码 deadline 失败**触发**
（仿真断言 `deadlineFires=true` 三次成立），跳过变体会静默吞掉该失败——不等价。
若未来把 deadline 哨兵改为 +∞ 则属于行为面变更，超出保行为优化范围。

### 4.3 S5-B-3：方向正确、量级不够——第五轮版的 S1-B 捆绑

与 S1-I-7/S2-I-3（parts+join 输给 += 拼接）和 S1-E-3（parts+join 输给折叠）
同一 V8 教训的**正向应用**：现状 join 恰是慢形态，模板字面量免掉数组分配 +
join 调用，micro 三次一致 -23%（646–649→499–508ns real-edit；336–354→218–221ns
planner），批量 301.2–323.3µs/批，是本轮最强候选。但：

1. **同噪声带先例**：S1-B 捆绑（284µs/批，6%）、S2-B-1（202–240µs）、
   S4-B-4（143–215µs）、S4-B-5（232–349µs）全部以「一次性离线路径上的
   <6% 常数因子」淘汰，本候选 301–323µs（占 M=2 批 5.3–5.6%）逐字节落在
   同一带宽。
2. **天花板支配**：analyzeTask 全量仅 2.21–2.24ms/eval（§2），reason 构造是
   其中一部分；即使全部消为零也不可达落地线。
3. 改动落在 live 面文件上，回归风险非零，收益/风险裁决同 R1-B §4.1：不动。
   等价证据（12000 fuzz）已备，满足结构性重开条件时可直接引用。

### 4.4 S5-B-4：一次分配换九个裸局部

等价成立（3000 组 fuzz 对真实 `router.route` 逐字节，含 ghost-model
DomainValidationError 与 refusal THROW 路径；replica 保真先行验证），但
46.1–68.1µs/批（route-only 口径）是深度噪声——每 route 一次 9 字段对象分配
在 V8 分代堆上是 ~10–30ns 级。代价面：`ResolvedRouteRequest` 是「每个文档化
默认值恰好解析一次」的命名契约点（类型注释明示），拆成 9 个裸局部穿
`partitionLiveCandidates` 与 `buildDecision` 两个消费点后该不变量失去类型
锚点。收益/可读性双输：不动。

## 5. 逐文件收口（第五遍透镜下的残余检查）

| 文件 | 检查项 | 结论 |
| --- | --- | --- |
| `analyze-task.ts` | S5-B-1 淘汰（噪声 + 意图文档）；S5-B-3 淘汰（噪声带先例 + 天花板支配）；S1-B-1/2/3、S4-B-1 维持 | 无候选 |
| `policy.ts` | S5-B-2 淘汰（真实路径死比较级 + 均匀性护栏）；deadline 姊妹不等价封死；全约束独立评估为契约下界维持 | 无候选 |
| `assign.ts` | 无新面；S1-B-8/S2-B-1/S3-B-1/S4-B-4/S4-B-5 维持；防御拷贝护栏维持 | 无候选 |
| `r0.ts` | 无新面；`eligibleCandidates` 的 estimateCostUsd 为输出字段本体（R1-B §5）；S1-B-6/S2-B-3/S3-B-4/S4-B-3 维持 | 无候选 |
| `live-cascade.ts` | 无新面；S1-B-4/5、S3-B-2/3 维持；`stay` 闭包亚噪声维持 R2-B 裁决 | 无候选 |
| `primary-catalog.ts` / `catalog-model.ts` | 纯构造 Θ(字段)；条件 spread 属性存在性可观察（S1-C-10 类）维持；惰性 getter 化 = 形状可观察（S4-E-3 类），未立候选 | 无候选 |
| `supervisor/model-router.ts` | S5-B-4 淘汰（噪声 + 命名契约点）；validateInput/unknown 检查维持 S3-B-5/S1-B-7；per-route allowed Set 维持 R2-B 裁决（S1-A-4 域）；`toModelDescriptor` 16% 维持 R1-B §4.4 架构裁决 | 无候选 |
| （跨切片，只记录不改） | `liveRefusalMessage` 双 `.some` 在切片外 `live-selection.ts` 且仅 refusal 路径；双 assignTasks 共享 = S2-D-4 维持 | 不属本切片 |

## 6. 前后对比与测试

无代码 diff。仓库变更仅本报告一个文件。零改动下相关套件复核全绿：

```bash
npx tsx --test test/unit/routing/*.test.ts test/unit/supervisor/*.test.ts
# tests 260 / suites 18 / pass 260 / fail 0
npx tsx --test test/unit/routing/live-isolation.test.ts
# tests 3 / pass 3 / fail 0   （live 面不 import R1/bandit/shadow 继续成立）
```

仿真（临时脚本未入库——无赢家不落地死代码；完整源码见附录，seeds
`0xb55b01`–`0xb55b06`，天花板语料复用 R4-B 的 `0xb44b01`）最终一次运行：

```text
ceiling eval-replay N=2000: assignTasks M=2 5480.8us | M=10 9433.9us | analyzeTask share 1122.4us (20%)
ceiling per eval run (x2 calls): M=2 total=10.96ms | M=10 total=18.87ms | analyzeTask total=2.24ms
ceiling replay-faithful (token-free) N=2000: assignTasks M=2 4264.7us per call (8.53ms per eval x2)
ceiling 10x stress N=20000: assignTasks M=2 50.8ms per call (101.6ms per eval x2)
ceiling CLI live face N=30: assignTasks M=2 73.7us per call
S5-B-1 bench N=2000: with-dead-predicate=1139.2us without=1092.8us delta=46.41us per batch
S5-B-3 bench N=2000: join=1114.0us template=799.6us delta=314.33us per batch
S5-B-3 micro real-edit: join=649ns template=508ns
S5-B-3 micro planner: join=339ns template=221ns
S5-B-2 deadline sibling witness: latency=1.00e+16 > MAX_SAFE_INTEGER -> deadline failure fires=true; a deadline skip would drop it (NOT equivalent)
S5-B-2 bench live-shape N=2000 M=2 (4000 evals, budget=inf): current=606.4us candidate=466.4us delta=140.0us per batch
S5-B-2 bench replay-faithful N=2000 M=2 (tokens=0, fixed fields): current=581.2us candidate=525.3us delta=55.9us per batch
S5-B-4 bench N=2000 (route-only): resolved-object=1957.3us inlined-locals=1911.2us delta=46.1us per batch

CONCLUSIONS: ceiling M=2 per-eval=11.0ms M=10 per-eval=18.9ms (holds-below-landing-line=true) | S5-B-1 equal=true | S5-B-3 equal=true | S5-B-2 equal=true | S5-B-4 equal=true
ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

三次独立运行 `CONCLUSIONS` 行**逐位一致**，基准方向三次一致且带宽稳定：
天花板 M=2 10.96–11.52ms / M=10 18.62–18.87ms / token-free 8.34–8.73ms /
10× 压力 99.4–101.6ms；S5-B-1 22.1–46.4µs、S5-B-2 live 136.6–145.7µs /
replay-faithful 29.3–55.9µs、S5-B-3 301.2–323.3µs、S5-B-4 46.1–68.1µs，
全部同向为正但同在噪声带。deadline 发散见证三次全部 `fires=true`。

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S5-B-1 | analyze-task complexityOf 尾部死值谓词消除（plan/research 判定两侧同返 MEDIUM） | 等价（12000 fuzz）但 N=2000 批仅省 22.1–46.4µs，深度噪声；该谓词是分类意图的唯一显式记载，删除属可读性权衡 |
| S5-B-2 | evaluateCandidate 无限预算短路（budgetUsd===+∞ 跳过成本估计与预算检查；含 deadline 姊妹变体） | budget 版等价但真实回放路径 fixedCostUsd 恒在、估计本不被调用，实测仅 29.3–55.9µs/批；哨兵特判侵蚀「全约束独立评估」均匀性护栏；deadline 姊妹不等价（MAX_SAFE_INTEGER 有限，1e16 latency 发散见证） |
| S5-B-3 | analyzeTask reason 5 元数组 + join 换单模板字面量 | 等价（12000 fuzz）且 micro -23%，但 N=2000 批仅省 301.2–323.3µs（占批 5.3–5.6%）——S1-B 捆绑/S4-B-5 同噪声带先例；被切片天花板（analyzeTask 全量 2.21–2.24ms/eval）支配 |
| S5-B-4 | model-router route() ResolvedRouteRequest 9 字段中间对象内联消除 | 等价（3000 fuzz 含 THROW 路径）但 N=2000 批仅省 46.1–68.1µs；拆散「文档化默认恰好解析一次」的命名契约点 |

**结构性重开条件（对整个切片，与 R4-B 一致并经本轮复测确认）**：eval 数据集
规模增长 ≥1 个量级（N≥20000 时切片全量 ~99–102 ms/eval，20–30% 级候选开始
触线），或 analyzeTask/route 进入每 turn 热路径，或出现新的高频调用方。
逐候选重开条件：S5-B-1/3/4 需先满足结构性条件（等价证据本报告已备，可直接
引用）；S5-B-2 budget 版另需给出不侵蚀共享矩阵均匀性护栏的实现形态；
S5-B-2 deadline 姊妹需先推翻发散见证（即把哨兵改为 +∞，属行为面变更，超出
本战役范围）。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.ts` 后 `npx tsx <file>`（仓库根目录，依赖已装）。
seeds：`0xb55b01`–`0xb55b06`；天花板语料复用 R4-B 的 `0xb44b01` 以保证可比。

```ts
/**
 * R5-B deterministic equivalence + benchmark simulation (fifth pass).
 * 1) Re-measures the R4-B aggregate slice ceiling (corpus seed 0xb44b01 reused
 *    verbatim for comparability) plus a replay-faithful token-free corpus.
 * 2) Adjudicates fresh Round-5 candidates S5-B-1 .. S5-B-4 against the live
 *    routing slice, byte-identical since R1-B's baseline 94ed3d9.
 * Seeded PRNG (mulberry32) -> fully reproducible. Seeds 0xb55b01-0xb55b06.
 */
import { performance } from "node:perf_hooks";
import { analyzeTask, type AnalyzeTaskOptions, type TaskAnalysis } from "/workspace/src/routing/analyze-task.js";
import { assignTasks, type AssignableTask } from "/workspace/src/routing/assign.js";
import { planAssignmentPolicy, pickPreferredModel, type AssignmentPolicyPlan } from "/workspace/src/routing/assign-plan.js";
import { flowchartRoleForAgentRole } from "/workspace/src/graph/compile-children.js";
import { ASSIGN_FEATURE_VERSION, FLOWCHART_FEATURE_VERSION } from "/workspace/src/routing/feature-version.js";
import { catalogFromPrimary } from "/workspace/src/routing/primary-catalog.js";
import { oneHotDistribution, type CatalogModel, type CatalogModelInput } from "/workspace/src/routing/catalog-model.js";
import { evaluateCandidate, evaluateLiveCandidate, type ConstraintFailure, type RouteRequest } from "/workspace/src/routing/policy.js";
import {
  estimateCostUsd,
  estimateLatencyMs,
  hasCapability,
  satisfiesPrivacy,
  type ModelDescriptor,
  type PrivacyClass
} from "/workspace/src/routing/capability-registry.js";
import { liveRefusalMessage, selectLiveModel } from "/workspace/src/routing/live-selection.js";
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
  return { policyVersion: "sim-r5b", models };
}
const conclusions: string[] = [];

/* ============================================================
 * §0 Ceiling re-measurement (R4-B methodology, corpus seed 0xb44b01 reused
 * verbatim) + replay-faithful token-free corpus as a tighter realistic bound.
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
    `ceiling M=2 per-eval=${(totalM2 * 2).toFixed(1)}ms M=10 per-eval=${(totalM10 * 2).toFixed(1)}ms (holds-below-landing-line=${totalM10 * 2 < 30})`
  );
}

/* ============================================================
 * Shared analyzeTask replica machinery (verbatim from analyze-task.ts) used
 * by S5-B-1 and S5-B-3. Replica fidelity is checked against the real
 * analyzeTask before any candidate is adjudicated.
 * ============================================================ */
const HIGH_RISK_RE =
  /\b(deploy(?:ing|ment|s)?|production|prod|credentials?|secrets?|privileged?|rm\s+-[a-z]*|drop\s+(table|database)|privilege\s+escalat\w*)\b/i;
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
function familyOfReplica(text: string, role: AgentRole): TaskFamily {
  if (HIGH_RISK_RE.test(text) && /\b(deploy|production|prod\b)\b/i.test(text)) return "deploy";
  if (PLAN_RE.test(text) || role === "planner") return "plan";
  if (RESEARCH_RE.test(text) || role === "scout") return "research";
  if (TEST_RE.test(text) || role === "tester") return "test";
  if (REVIEW_RE.test(text) || role === "reviewer") return "review";
  if (REFACTOR_RE.test(text)) return "refactor";
  if (IMPLEMENT_RE.test(text) || role === "implementer" || role === "worker") return "edit";
  return ROLE_FAMILY[role] ?? "unknown";
}
type ComplexityInput = {
  readonly role: AgentRole;
  readonly family: TaskFamily;
  readonly highRisk: boolean;
  readonly long: boolean;
};
/** Verbatim complexityOf, including the dead trailing predicate. */
function complexityOfReplica(input: ComplexityInput): TaskComplexity {
  if (input.highRisk || input.family === "deploy") return "HIGH";
  if (input.long) return "MEDIUM";
  if (input.role === "scout" || input.role === "tester") return "LOW";
  if (input.role === "planner" || input.role === "debugger" || input.role === "reviewer") return "MEDIUM";
  if (input.family === "plan" || input.family === "research") return "MEDIUM";
  return "MEDIUM";
}
/** S5-B-1 candidate: the trailing `family===plan||research` conditional is dead
 * (both its consequent and the fallthrough return "MEDIUM"), so drop it. */
function complexityOfCandidate(input: ComplexityInput): TaskComplexity {
  if (input.highRisk || input.family === "deploy") return "HIGH";
  if (input.long) return "MEDIUM";
  if (input.role === "scout" || input.role === "tester") return "LOW";
  if (input.role === "planner" || input.role === "debugger" || input.role === "reviewer") return "MEDIUM";
  return "MEDIUM";
}
type ReasonMode = "join" | "template";
function analyzeReplica(
  objective: string,
  role: AgentRole,
  options: AnalyzeTaskOptions,
  complexityOf: (input: ComplexityInput) => TaskComplexity,
  reasonMode: ReasonMode
): TaskAnalysis {
  const text = objective.trim();
  const family = familyOfReplica(text, role);
  const highRisk = options.contractRisk !== undefined ? options.contractRisk : HIGH_RISK_RE.test(text);
  const long = text.length >= 180 || (text.match(/\n/g) ?? []).length >= 3;
  const complexity = complexityOf({ role, family, highRisk, long });
  const preferPrimary =
    highRisk ||
    complexity === "HIGH" ||
    role === "planner" ||
    role === "debugger" ||
    family === "deploy";
  const requiredCapabilities = options.requiredCapabilities ?? ["tool-use"];
  const reason =
    reasonMode === "join"
      ? [
          `role ${role}`,
          `family ${family}`,
          `${complexity} complexity`,
          highRisk ? "high-risk" : "standard-risk",
          preferPrimary ? "prefer primary model" : "prefer cheapest eligible"
        ].join("; ")
      : `role ${role}; family ${family}; ${complexity} complexity; ${highRisk ? "high-risk" : "standard-risk"}; ${preferPrimary ? "prefer primary model" : "prefer cheapest eligible"}`;
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

/* ============================================================
 * S5-B-1: dead trailing predicate elimination in complexityOf.
 * Static argument: the conditional's consequent and the fallthrough both
 * return "MEDIUM", so the test is value-dead. Fuzz is the arbiter.
 * ============================================================ */
{
  const rng = mulberry32(0xb55b01);
  let allEqual = true;
  for (let trial = 0; trial < 12000; trial += 1) {
    const objective = genObjective(rng);
    const role = pick(rng, ROLES);
    const options = genOptions(rng);
    const real = JSON.stringify(analyzeTask(objective, role, options));
    const replica = JSON.stringify(analyzeReplica(objective, role, options, complexityOfReplica, "join"));
    const cand = JSON.stringify(analyzeReplica(objective, role, options, complexityOfCandidate, "join"));
    if (real !== replica || real !== cand) allEqual = false;
    check("S5-B-1 replica fidelity", real === replica, JSON.stringify({ objective, role }));
    check("S5-B-1 candidate equivalence", real === cand, JSON.stringify({ objective, role }));
  }
  conclusions.push(`S5-B-1 equal=${allEqual}`);
  const tasks = genTasks(mulberry32(0xb55b01), 2000);
  const cur = bench(() => {
    for (const task of tasks) analyzeReplica(task.objective, task.role, {}, complexityOfReplica, "join");
  }, 30);
  const cand = bench(() => {
    for (const task of tasks) analyzeReplica(task.objective, task.role, {}, complexityOfCandidate, "join");
  }, 30);
  console.log(
    `S5-B-1 bench N=2000: with-dead-predicate=${(cur * 1e3).toFixed(1)}us without=${(cand * 1e3).toFixed(1)}us delta=${((cur - cand) * 1e3).toFixed(2)}us per batch`
  );
}

/* ============================================================
 * S5-B-3: analyzeTask reason construction primitive — array-of-5 + join
 * vs a single template literal (byte-identical output required).
 * ============================================================ */
{
  const rng = mulberry32(0xb55b02);
  let allEqual = true;
  for (let trial = 0; trial < 12000; trial += 1) {
    const objective = genObjective(rng);
    const role = pick(rng, ROLES);
    const options = genOptions(rng);
    const real = JSON.stringify(analyzeTask(objective, role, options));
    const cand = JSON.stringify(analyzeReplica(objective, role, options, complexityOfReplica, "template"));
    if (real !== cand) allEqual = false;
    check("S5-B-3 candidate equivalence", real === cand, JSON.stringify({ objective, role }));
  }
  conclusions.push(`S5-B-3 equal=${allEqual}`);
  const tasks = genTasks(mulberry32(0xb55b02), 2000);
  const cur = bench(() => {
    for (const task of tasks) analyzeReplica(task.objective, task.role, {}, complexityOfReplica, "join");
  }, 30);
  const cand = bench(() => {
    for (const task of tasks) analyzeReplica(task.objective, task.role, {}, complexityOfReplica, "template");
  }, 30);
  console.log(
    `S5-B-3 bench N=2000: join=${(cur * 1e3).toFixed(1)}us template=${(cand * 1e3).toFixed(1)}us delta=${((cur - cand) * 1e3).toFixed(2)}us per batch`
  );
  for (const [label, objective, role] of [
    ["real-edit", "Implement retry logic for the ledger sync", "implementer"],
    ["planner", "Plan the checkout migration", "planner"]
  ] as const) {
    const a = bench(() => analyzeReplica(objective, role, {}, complexityOfReplica, "join"), 40000);
    const b = bench(() => analyzeReplica(objective, role, {}, complexityOfReplica, "template"), 40000);
    console.log(`S5-B-3 micro ${label}: join=${(a * 1e6).toFixed(0)}ns template=${(b * 1e6).toFixed(0)}ns`);
  }
}

/* ============================================================
 * S5-B-2: evaluateCandidate infinite-budget short-circuit.
 * budgetUsd = +Infinity on the whole live default-limits path (assignTasks
 * without remainingCostUsd -> resolveRouteDefaults ?? +Infinity). Since
 * `cost > +Infinity` is false for every float (incl. NaN/Infinity) and cost
 * feeds nothing but that check and its failure detail, skipping the cost
 * estimate under budget===+Infinity is equivalent. The deadline sibling is
 * NOT safe: MAX_SAFE_INTEGER is finite (divergence witness below).
 * ============================================================ */
function evaluateCandidateReplica(model: ModelDescriptor, request: RouteRequest) {
  const fails: ConstraintFailure[] = [];
  if (model.providerPolicy === "forbidden") {
    fails.push({ modelId: model.modelId, constraint: "provider-policy", detail: `provider ${model.providerId} is not approved` });
  }
  if (!satisfiesPrivacy(model, request.privacyRequired)) {
    fails.push({
      modelId: model.modelId,
      constraint: "privacy-class",
      detail:
        model.privacyClass === undefined
          ? `undeclared privacy class cannot serve ${request.privacyRequired}`
          : `${model.privacyClass} cannot serve ${request.privacyRequired}`
    });
  }
  for (const capability of request.requiredCapabilities) {
    if (!hasCapability(model, capability)) {
      fails.push({ modelId: model.modelId, constraint: "capability", detail: `capability not declared: ${capability}` });
      break;
    }
  }
  if (model.contextWindow !== undefined && model.contextWindow < request.contextNeeded) {
    fails.push({ modelId: model.modelId, constraint: "context-window", detail: `${model.contextWindow} < ${request.contextNeeded}` });
  }
  if (model.maxOutputTokens !== undefined && model.maxOutputTokens < request.outputNeeded) {
    fails.push({ modelId: model.modelId, constraint: "max-output", detail: `${model.maxOutputTokens} < ${request.outputNeeded}` });
  }
  const useTokens = request.contextNeeded > 0 || request.outputNeeded > 0;
  const cost = useTokens
    ? estimateCostUsd(model, request.contextNeeded, request.outputNeeded)
    : (request.fixedCostUsd ?? estimateCostUsd(model, request.contextNeeded, request.outputNeeded));
  if (cost > request.budgetUsd) {
    fails.push({ modelId: model.modelId, constraint: "budget", detail: `estimated $${cost.toFixed(4)} > budget $${request.budgetUsd}` });
  }
  const latency = useTokens
    ? estimateLatencyMs(model, request.outputNeeded)
    : (request.fixedLatencyMs ?? estimateLatencyMs(model, request.outputNeeded));
  if (latency > request.deadlineMs) {
    fails.push({ modelId: model.modelId, constraint: "deadline", detail: `estimated ${latency.toFixed(0)}ms > deadline ${request.deadlineMs}ms` });
  }
  if (request.highRisk && model.approvedForHighRisk !== true) {
    fails.push({ modelId: model.modelId, constraint: "high-risk-approval", detail: "model is not approved for high-risk tasks" });
  }
  return { modelId: model.modelId, eligible: fails.length === 0, failures: fails };
}
function evaluateCandidateInfBudget(model: ModelDescriptor, request: RouteRequest) {
  const fails: ConstraintFailure[] = [];
  if (model.providerPolicy === "forbidden") {
    fails.push({ modelId: model.modelId, constraint: "provider-policy", detail: `provider ${model.providerId} is not approved` });
  }
  if (!satisfiesPrivacy(model, request.privacyRequired)) {
    fails.push({
      modelId: model.modelId,
      constraint: "privacy-class",
      detail:
        model.privacyClass === undefined
          ? `undeclared privacy class cannot serve ${request.privacyRequired}`
          : `${model.privacyClass} cannot serve ${request.privacyRequired}`
    });
  }
  for (const capability of request.requiredCapabilities) {
    if (!hasCapability(model, capability)) {
      fails.push({ modelId: model.modelId, constraint: "capability", detail: `capability not declared: ${capability}` });
      break;
    }
  }
  if (model.contextWindow !== undefined && model.contextWindow < request.contextNeeded) {
    fails.push({ modelId: model.modelId, constraint: "context-window", detail: `${model.contextWindow} < ${request.contextNeeded}` });
  }
  if (model.maxOutputTokens !== undefined && model.maxOutputTokens < request.outputNeeded) {
    fails.push({ modelId: model.modelId, constraint: "max-output", detail: `${model.maxOutputTokens} < ${request.outputNeeded}` });
  }
  const useTokens = request.contextNeeded > 0 || request.outputNeeded > 0;
  if (request.budgetUsd !== Number.POSITIVE_INFINITY) {
    const cost = useTokens
      ? estimateCostUsd(model, request.contextNeeded, request.outputNeeded)
      : (request.fixedCostUsd ?? estimateCostUsd(model, request.contextNeeded, request.outputNeeded));
    if (cost > request.budgetUsd) {
      fails.push({ modelId: model.modelId, constraint: "budget", detail: `estimated $${cost.toFixed(4)} > budget $${request.budgetUsd}` });
    }
  }
  const latency = useTokens
    ? estimateLatencyMs(model, request.outputNeeded)
    : (request.fixedLatencyMs ?? estimateLatencyMs(model, request.outputNeeded));
  if (latency > request.deadlineMs) {
    fails.push({ modelId: model.modelId, constraint: "deadline", detail: `estimated ${latency.toFixed(0)}ms > deadline ${request.deadlineMs}ms` });
  }
  if (request.highRisk && model.approvedForHighRisk !== true) {
    fails.push({ modelId: model.modelId, constraint: "high-risk-approval", detail: "model is not approved for high-risk tasks" });
  }
  return { modelId: model.modelId, eligible: fails.length === 0, failures: fails };
}
function genDescriptor(rng: () => number, i: number): ModelDescriptor {
  const privacy: readonly PrivacyClass[] = ["local", "cloud-approved", "cloud-general"];
  return {
    modelId: `m${i}`,
    providerId: rng() < 0.9 ? "prov" : "other",
    version: `v${i}`,
    capabilities: rng() < 0.8 ? ["tool-use"] : [],
    providerPolicy: rng() < 0.85 ? "approved" : "forbidden",
    inputCostPerMTok: Number((rng() * 5).toFixed(2)),
    outputCostPerMTok: Number((rng() * 15).toFixed(2)),
    latencyMsPer1K: 40 + Math.floor(rng() * 100),
    ...(rng() < 0.5 ? { contextWindow: 1000 + Math.floor(rng() * 200000) } : {}),
    ...(rng() < 0.5 ? { maxOutputTokens: 100 + Math.floor(rng() * 16000) } : {}),
    ...(rng() < 0.6 ? { privacyClass: pick(rng, privacy) } : {}),
    ...(rng() < 0.6 ? { approvedForHighRisk: rng() < 0.5 } : {})
  };
}
function genRequest(rng: () => number, forceInfiniteBudget: boolean): RouteRequest {
  const privacy: readonly PrivacyClass[] = ["local", "cloud-approved", "cloud-general"];
  const budgetRoll = rng();
  return {
    taskFamily: pick(rng, ["edit", "plan", "test"]),
    privacyRequired: pick(rng, privacy),
    requiredCapabilities: rng() < 0.7 ? ["tool-use"] : [],
    contextNeeded: rng() < 0.3 ? 0 : Math.floor(rng() * 150000),
    outputNeeded: rng() < 0.3 ? 0 : Math.floor(rng() * 8000),
    budgetUsd: forceInfiniteBudget || budgetRoll < 0.4
      ? Number.POSITIVE_INFINITY
      : budgetRoll < 0.5
        ? 0.0001
        : Number((rng() * 2).toFixed(4)),
    deadlineMs: rng() < 0.2 ? 10 : rng() < 0.5 ? Number.MAX_SAFE_INTEGER : Math.floor(rng() * 600000),
    highRisk: rng() < 0.4,
    ...(rng() < 0.4 ? { fixedCostUsd: Number((rng() * 1).toFixed(3)) } : {}),
    ...(rng() < 0.4 ? { fixedLatencyMs: Math.floor(rng() * 8000) } : {})
  };
}
{
  const rng = mulberry32(0xb55b03);
  let allEqual = true;
  for (let trial = 0; trial < 6000; trial += 1) {
    const model = genDescriptor(rng, trial % 10);
    const request = genRequest(rng, false);
    const real = JSON.stringify(evaluateCandidate(model, request));
    const replica = JSON.stringify(evaluateCandidateReplica(model, request));
    const cand = JSON.stringify(evaluateCandidateInfBudget(model, request));
    if (real !== replica || real !== cand) allEqual = false;
    check("S5-B-2 replica fidelity", real === replica, `trial ${trial}`);
    check("S5-B-2 candidate equivalence", real === cand, `trial ${trial}`);
  }
  conclusions.push(`S5-B-2 equal=${allEqual}`);

  // Deadline-sibling divergence witness: MAX_SAFE_INTEGER is finite, so a
  // "skip latency when deadline===MAX_SAFE_INTEGER" variant is NOT equivalent.
  const monsterModel: ModelDescriptor = {
    modelId: "monster",
    providerId: "prov",
    version: "v1",
    capabilities: ["tool-use"],
    providerPolicy: "approved",
    inputCostPerMTok: 1,
    outputCostPerMTok: 1,
    latencyMsPer1K: 1e13
  };
  const monsterRequest: RouteRequest = {
    taskFamily: "edit",
    privacyRequired: "cloud-general",
    requiredCapabilities: ["tool-use"],
    contextNeeded: 0,
    outputNeeded: 1_000_000,
    budgetUsd: Number.POSITIVE_INFINITY,
    deadlineMs: Number.MAX_SAFE_INTEGER,
    highRisk: false
  };
  const monster = evaluateCandidate(monsterModel, monsterRequest);
  const deadlineFires = monster.failures.some((f) => f.constraint === "deadline");
  check("S5-B-2 deadline-sibling divergence witness", deadlineFires);
  console.log(
    `S5-B-2 deadline sibling witness: latency=${estimateLatencyMs(monsterModel, monsterRequest.outputNeeded).toExponential(2)} > MAX_SAFE_INTEGER -> deadline failure fires=${deadlineFires}; a deadline skip would drop it (NOT equivalent)`
  );

  // Bench (a): live-shape default-limits requests, token-bearing corpus.
  const models = [genDescriptor(mulberry32(0xb55b03), 0), genDescriptor(mulberry32(0xb55b04), 1)]
    .map((m) => ({ ...m, providerPolicy: "approved" as const }));
  const liveRequests = Array.from({ length: 2000 }, () => genRequest(rng, true));
  const curLive = bench(() => {
    for (const request of liveRequests) for (const model of models) evaluateCandidateReplica(model, request);
  }, 30);
  const candLive = bench(() => {
    for (const request of liveRequests) for (const model of models) evaluateCandidateInfBudget(model, request);
  }, 30);
  console.log(
    `S5-B-2 bench live-shape N=2000 M=2 (4000 evals, budget=inf): current=${(curLive * 1e3).toFixed(1)}us candidate=${(candLive * 1e3).toFixed(1)}us delta=${((curLive - candLive) * 1e3).toFixed(1)}us per batch`
  );
  // Bench (b): replay-faithful — tokens=0, fixedCostUsd present (property read
  // only, no estimateCostUsd call), budget=inf.
  const replayRequests = Array.from({ length: 2000 }, () => ({
    ...genRequest(rng, true),
    contextNeeded: 0,
    outputNeeded: 0,
    fixedCostUsd: 0.5,
    fixedLatencyMs: 4000,
    deadlineMs: Number.MAX_SAFE_INTEGER
  }));
  const curReplay = bench(() => {
    for (const request of replayRequests) for (const model of models) evaluateCandidateReplica(model, request);
  }, 30);
  const candReplay = bench(() => {
    for (const request of replayRequests) for (const model of models) evaluateCandidateInfBudget(model, request);
  }, 30);
  console.log(
    `S5-B-2 bench replay-faithful N=2000 M=2 (tokens=0, fixed fields): current=${(curReplay * 1e3).toFixed(1)}us candidate=${(candReplay * 1e3).toFixed(1)}us delta=${((curReplay - candReplay) * 1e3).toFixed(1)}us per batch`
  );
}

/* ============================================================
 * S5-B-4: route() resolveRouteDefaults intermediate-object elimination —
 * inline the nine resolved defaults as locals instead of allocating the
 * ResolvedRouteRequest object once per route. Full route replica fidelity is
 * checked against the real router.route first (including refusal throws).
 * ============================================================ */
const LIVE_ROLES: readonly FlowchartNodeRole[] = ["actor", "critic", "router", "judge", "tool", "human"];
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
function buildDecisionReplica(
  policyVersion: string,
  input: RouteTaskInput,
  resolved: ResolvedRouteRequestReplica,
  selected: CatalogModel,
  eligible: readonly CatalogModel[],
  refusals: readonly RoutingRefusal[]
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
  const eligibleModels = eligible.map((model) => model.id);
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
    behaviorDistribution: oneHotDistribution(eligibleModels, selected.id),
    ...(input.agentRole !== undefined ? { agentRole: input.agentRole } : {}),
    ...(preferred && preferredModel !== undefined ? { preferredConstraint: preferredModel } : {})
  };
}
/** Replica of the current route(): allocates ResolvedRouteRequest per route. */
function routeReplicaCurrent(
  models: readonly CatalogModel[],
  catalogIds: ReadonlySet<string>,
  policyVersion: string,
  input: RouteTaskInput
): RoutingDecision {
  validateInputReplica(input);
  const unknownPolicyModel = input.modelPolicy.allowedModels.find((id) => !catalogIds.has(id));
  if (unknownPolicyModel !== undefined) {
    throw new DomainValidationError(`Model policy references unavailable model: ${unknownPolicyModel}`);
  }
  const resolved: ResolvedRouteRequestReplica = {
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
  const allowed = new Set(input.modelPolicy.allowedModels);
  const eligible: CatalogModel[] = [];
  const refusals: RoutingRefusal[] = [];
  for (const model of models) {
    if (!allowed.has(model.id)) continue;
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
  if (eligible.length === 0) {
    throw new RoutingRefusalError(
      liveRefusalMessage({ role: input.role, complexity: input.complexity, highRisk: resolved.highRisk }, refusals),
      refusals
    );
  }
  const selected = selectLiveModel(eligible, input.modelPolicy.preferredModel);
  return buildDecisionReplica(policyVersion, input, resolved, selected, eligible, refusals);
}
/** S5-B-4 candidate: resolved defaults as plain locals; no intermediate object. */
function routeReplicaCandidate(
  models: readonly CatalogModel[],
  catalogIds: ReadonlySet<string>,
  policyVersion: string,
  input: RouteTaskInput
): RoutingDecision {
  validateInputReplica(input);
  const unknownPolicyModel = input.modelPolicy.allowedModels.find((id) => !catalogIds.has(id));
  if (unknownPolicyModel !== undefined) {
    throw new DomainValidationError(`Model policy references unavailable model: ${unknownPolicyModel}`);
  }
  const highRisk = input.highRisk === true;
  const family = input.family ?? "unknown";
  const featureVersion = input.featureVersion ?? FLOWCHART_FEATURE_VERSION;
  const privacyRequired = input.privacyRequired ?? "cloud-general";
  const requiredCapabilities = input.requiredCapabilities ?? ["tool-use"];
  const contextNeeded = input.contextNeeded ?? 0;
  const outputNeeded = input.outputNeeded ?? 0;
  const budgetUsd = input.limits.remainingCostUsd ?? Number.POSITIVE_INFINITY;
  const deadlineMs = input.limits.remainingTimeMs;
  const allowed = new Set(input.modelPolicy.allowedModels);
  const eligible: CatalogModel[] = [];
  const refusals: RoutingRefusal[] = [];
  for (const model of models) {
    if (!allowed.has(model.id)) continue;
    const check = evaluateLiveCandidate(model, {
      role: input.role,
      complexity: input.complexity,
      taskFamily: family,
      privacyRequired,
      requiredCapabilities,
      contextNeeded,
      outputNeeded,
      budgetUsd,
      deadlineMs,
      highRisk,
      fixedCostUsd: model.estimatedCostUsd,
      fixedLatencyMs: model.estimatedDurationMs
    });
    if (check.eligible) {
      eligible.push(model);
    } else {
      refusals.push(...check.failures);
    }
  }
  if (eligible.length === 0) {
    throw new RoutingRefusalError(
      liveRefusalMessage({ role: input.role, complexity: input.complexity, highRisk }, refusals),
      refusals
    );
  }
  const selected = selectLiveModel(eligible, input.modelPolicy.preferredModel);
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
  const eligibleModels = eligible.map((model) => model.id);
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
    family,
    featureVersion,
    modelVersion: selected.version,
    highRisk,
    eligibleModels,
    rejections: refusals,
    behaviorDistribution: oneHotDistribution(eligibleModels, selected.id),
    ...(input.agentRole !== undefined ? { agentRole: input.agentRole } : {}),
    ...(preferred && preferredModel !== undefined ? { preferredConstraint: preferredModel } : {})
  };
}
{
  const catalog = catalogFromPrimary({ primaryModelId: "premium" });
  const router = createModelRouter(catalog);
  const models = router.config.models;
  const catalogIds = new Set(models.map((m) => m.id));
  const plan = planAssignmentPolicy(models, catalog.models.map((m) => m.id));
  const outcome = (fn: () => unknown): string => {
    try {
      return JSON.stringify(fn());
    } catch (error) {
      return `THROW:${(error as Error).name}:${(error as Error).message}`;
    }
  };
  const rng = mulberry32(0xb55b05);
  function genRouteInput(): RouteTaskInput {
    const task = genTasks(rng, 1)[0]!;
    const analysis = analyzeTask(task.objective, task.role, {
      ...(task.contractRisk !== undefined ? { contractRisk: task.contractRisk } : {}),
      ...(task.contextTokens !== undefined ? { contextTokens: task.contextTokens } : {}),
      ...(task.outputTokens !== undefined ? { outputTokens: task.outputTokens } : {})
    });
    const allowedModels = rng() < 0.1 ? ["ghost"] : [...plan.allowedIds];
    const preferredModel = allowedModels[0] === "ghost" ? "ghost" : pickPreferredModel(plan, analysis, undefined);
    return {
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
      ...(rng() < 0.2
        ? { limits: { remainingTimeMs: Math.floor(rng() * 1e6), ...(rng() < 0.5 ? { remainingCostUsd: Number((rng() * 2).toFixed(3)) } : {}) } }
        : { limits: { remainingTimeMs: Number.MAX_SAFE_INTEGER } })
    };
  }
  let allEqual = true;
  for (let trial = 0; trial < 3000; trial += 1) {
    const input = genRouteInput();
    const real = outcome(() => router.route(input));
    const replica = outcome(() => routeReplicaCurrent(models, catalogIds, catalog.policyVersion, input));
    const cand = outcome(() => routeReplicaCandidate(models, catalogIds, catalog.policyVersion, input));
    if (real !== replica || real !== cand) allEqual = false;
    check("S5-B-4 replica fidelity", real === replica, `trial ${trial}`);
    check("S5-B-4 candidate equivalence", real === cand, `trial ${trial}`);
  }
  conclusions.push(`S5-B-4 equal=${allEqual}`);
  const DEFAULT_LIMITS: RoutingLimits = { remainingTimeMs: Number.MAX_SAFE_INTEGER };
  const tasks = genTasks(mulberry32(0xb55b06), 2000);
  const prepared = tasks.map((task) => {
    const analysis = analyzeTask(task.objective, task.role, {
      ...(task.contractRisk !== undefined ? { contractRisk: task.contractRisk } : {}),
      ...(task.contextTokens !== undefined ? { contextTokens: task.contextTokens } : {}),
      ...(task.outputTokens !== undefined ? { outputTokens: task.outputTokens } : {})
    });
    const input: RouteTaskInput = {
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
      limits: DEFAULT_LIMITS
    };
    return input;
  });
  const cur = bench(() => {
    for (const input of prepared) routeReplicaCurrent(models, catalogIds, catalog.policyVersion, input);
  }, 30);
  const cand = bench(() => {
    for (const input of prepared) routeReplicaCandidate(models, catalogIds, catalog.policyVersion, input);
  }, 30);
  console.log(
    `S5-B-4 bench N=2000 (route-only): resolved-object=${(cur * 1e3).toFixed(1)}us inlined-locals=${(cand * 1e3).toFixed(1)}us delta=${((cur - cand) * 1e3).toFixed(1)}us per batch`
  );
}

console.log(`\nCONCLUSIONS: ${conclusions.join(" | ")}`);
if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```
