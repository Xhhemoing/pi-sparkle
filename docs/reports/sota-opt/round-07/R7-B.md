# R7-B：live 路由切片 Round 7 七搜报告

**战役:** 全库持久 SOTA 优化 Round 7 / R7-B（十区之一，R1-B…R6-B 的第七遍）
**基线:** `cursor/sota-persistent-opt-83a1` @ `8f806c8`（含 S6-C、S6-F-1、S5-I-1 落地与 R6-J 排除并入）
**分支:** `cursor/r7-b-live-routing-seventh-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动；R4-B/R5-B/R6-B 的整片成本天花板经第四次
复测成立。** 关键前提事实：切片 8 个文件加 5 个只读上下游自 R1-B 的裁决基线
`94ed3d9` 以来**逐字节零变化**（`git diff 94ed3d9..8f806c8` 对 13 个文件为空），
且全部生产调用方文件（`adaptation/eval-routing.ts`、`run/child-coordinator.ts`、
`track/loop.ts`、`track/primary-split.ts`、`graph/compile-children.ts`、
`routing/public-prior.ts`）同样零变化——期间全 src 树的合入（S5-I-1
`cli/main.ts` 惰性 import、S6-C `offline-logit.ts`、S6-F-1
`experiments/{shadow,canary,plan}.ts`、J 系 `preferences/loop-eval.ts` 等 8 个
文件）均在切片与调用方图景之外。R1-B 的结构下界论证、R4-B 的聚合天花板论证与
S1-B-1..8、S2-B-1..4、S3-B-1..6、S4-B-1..5、S5-B-1..4、S6-B-1..5 全部裁决对
当前代码原样成立。

天花板本轮实测复核为 **12.3–13.3 ms/eval（M=2）/ 18.9–22.0 ms/eval（M=10）**，
R5-B 的 replay-faithful token-free 口径复测 **9.0–10.4 ms/eval**——本 VM 整体
偏慢使绝对值较 R6-B（9.3–19.8 / 7.3–8.7 ms）成比例上浮，量级与占比结论不变。
落地线（数十~数百 ms 或复杂度类下降）依旧不可达：即使把整个切片成本消为零也在
落地线下沿之下，且 R1-B §2 已逐函数关闭复杂度类通道。

在此前六轮六组透镜之外，本轮换第七组新透镜穷举，得到 6 个排除表未覆盖的新提案
（S7-B-1 … S7-B-6），全部经理论 + 确定性仿真（seeded mulberry32，等价性 fuzz +
语言包含性探针 + 真实规模基准 + 身份见证，三次独立运行等价/见证结论逐位一致）
裁决后淘汰：2 个等价但实测符号翻转即零收益（S7-B-2、S7-B-4），2 个等价但深度
噪声带（S7-B-1、S7-B-3），1 个可观察身份改变（S7-B-5），1 个等价但每批一次
ns 级（S7-B-6）。未重开任何 X* / S1-* / S2-* / S3-* / S4-* / S5-* / S6-* 条目。
按指令不硬凑赢家：现状仍为该数据面契约下的 SOTA。

## 0. 范围与约束遵守

- 切片：`src/routing/{r0,assign,policy,live-cascade,analyze-task,primary-catalog,catalog-model}.ts`、
  `src/supervisor/model-router.ts` 全量重读；上下游 `assign-plan.ts`、`live-selection.ts`、
  `capability-registry.ts`、`cascade-evidence.ts`、`learning/learned-routing.ts`
  只读取证，一行未改。
- 先读并遵守（顺序强制）：README / EXCLUSIONS.md（全表，含 S6-J-1..6 新条目）/
  round-07/PLAN.md / round-01/R1-B.md … round-06/R6-B.md。
- 基线漂移检查：`git diff --stat 94ed3d9..8f806c8 -- <切片 8 文件 + 上下游 5 文件>`
  为空；调用方 6 文件（eval-routing / child-coordinator / track-loop /
  primary-split / compile-children / public-prior）同样为空。
  `git diff --stat 94ed3d9..8f806c8 -- src/` 全 src 仅 `cli/main.ts`、
  `experiments/{canary,plan,shadow}.ts`、`pi-adapter/auth-session.ts`、
  `preferences/loop-eval.ts`、`routing/lin-alg.ts`、`routing/offline-logit.ts`
  八个切片外文件。R1-B…R6-B 的规模测量、调用方图景与全部裁决对当前代码原样成立。
- 换名重提检查：本轮枚举中识别出并**未列为新候选**的既有方案换名——
  validateInput 与 unknown 检查融合并顺手复用 allowed-Set（S3-B-5 + S6-B-5
  家族）、批内共享请求/骨架（S3-B-6/S4-B-5 家族）、toModelDescriptor 构造期
  预建（R1-B §4.4 通道 2：需给 `evaluateLiveCandidate` 加参数即公开签名改动）、
  coldStartRoutingScore 六值查表（S1-B-7/S1-D-8 类小表噪声）、buildDecision
  双模板拼接合一（S5-B-3 字符串构造家族抖动域）、`/\n/g` 字面量提升
  （S1-B-1/X0-6 邻域）。
- R1/posterior/offline-* 未碰；live 保持 R0 等价，R1 未接线：`live-isolation`
  3/3 绿（§6）。三线规格（分析不改 in-flight、Tracking 无命令权、H/score 不写
  路由、双 LCB 双归因保留、提升 proposal-first、Checkpoint F-PROD 开放）零 diff
  天然满足。不声称 Outcome-supported。
- 零 diff，公开 API / 决策对象 schema / refusal 消息优先级 / tie-break 语义
  天然不变。无阈值改动，无测试改动。lint 本轮全绿，无需触碰任何继承脚本。

## 1. 第七遍搜索方法与调用方图景复核

R1-B 用「输出契约渐近下界」，R2-B 用「跨模块身份/重复归一化/姊妹变体」，R3-B 用
「批内去重/比较器热循环/语义面与分配消除」，R4-B 用「聚合天花板/多模式自动机/
约束依赖分解/分配来源穷尽」，R5-B 用「死值谓词/哨兵恒假约束/字符串构造原语/
中间聚合对象」，R6-B 用「同数据双遍构造/常量子对象享元/正则交替次序/恒等变换
检测」。本轮换第七组透镜：

1. **蕴含吸收透镜**：找布尔合取/析取中被其他项在语言/导出层面蕴含的冗余项——
   不是重排（S1-B-3）、不是共享求值（S1-B-1）、不是死值谓词（S5-B-1），而是
   逻辑蕴含使整项可删（产出 S7-B-1——familyOf 的 deploy 门第一合取被
   DEPLOY_RE ⊆ HIGH_RISK_RE 语言包含蕴含；产出 S7-B-2——preferPrimary 的
   highRisk 与 family==="deploy" 析取被 complexity==="HIGH" 双向吸收）。
2. **空前缀别名返回透镜**：组合函数的前置检查全过时，直接返回内层结果对象
   而非重构一份（产出 S7-B-3——`evaluateLiveCandidate` 空前置失败时返回
   `evaluateCandidate` 的 rest）。
3. **构造期字符串物化透镜**：每决策重复做的模型常量数字→字符串转换能否在
   router 构造期一次物化——与 R1-B §4.4 的三通道不同，本目标（justification
   尾段）完全在 model-router.ts 私有函数内，不需要公开签名通道（产出 S7-B-4）。
4. **默认值享元透镜**：`?? ["tool-use"]` 默认数组的每调新鲜分配可否单例化
   （产出 S7-B-5；S6-B-2 享元透镜在「常量数组默认值」上的收口一击）。
5. **构造期索引复用透镜**：同一构造函数内两份内容相同的索引结构（validateConfig
   查重 Set 与闭包 catalogIds Set）可否文件内私有复用（产出 S7-B-6）。

调用方图景复核（grep 全 src 取证，与 R6-B 记录逐条一致，且因切片 + 全部调用方
文件逐字节零变化而必然一致）：`routeR0` 唯一生产调用方仍是
`r1-shadow-report.ts`；`applyCascade` 生产不可达（`applyEvidenceCascade` 在
src 内无调用方）；`decideLiveCascade` 在 `run/child-coordinator.ts` 每 child
结果一次；`evaluateLiveCandidate` 唯一生产调用方是 `model-router.ts`（切片内）；
`assignTasks` 调用方为 `cli/main.ts`（N≤30）、`track/primary-split.ts`，最大
规模入口 `adaptation/eval-routing.ts` N=episodes ×2（baseline+candidate）。
R5-B 的取证维持：最大规模入口任务只带 taskId/role/objective（token-free、
`budgetUsd=+∞`、`deadlineMs=MAX_SAFE_INTEGER`、fixed 字段走属性读）。本轮
新增取证：assign 路径恒传 `analysis.requiredCapabilities`，故
`resolveRouteDefaults` 的 `?? ["tool-use"]` 默认仅在 `routeFlowNode` 路径触发
（S7-B-5 站点二的规模上界依据）。

## 2. 天花板复测：R4-B/R5-B/R6-B 收口第四次复核成立

实测（本 VM，三次运行区间；语料生成器与 R4-B/R5-B/R6-B 逐字节相同、种子
`0xb44b01` 复用以保证可比；完整脚本见附录）：

```text
ceiling eval-replay N=2000: assignTasks M=2 6133.0–6639.8us | M=10 9449.0–10981.5us | analyzeTask share 1141.2–1179.9us (18–19%)
ceiling per eval run (x2 calls): M=2 total=12.27–13.28ms | M=10 total=18.90–21.96ms | analyzeTask total=2.28–2.36ms
ceiling replay-faithful (token-free) N=2000: assignTasks M=2 4481.5–5216.7us per call (8.96–10.43ms per eval x2)
ceiling 10x stress N=20000: assignTasks M=2 57.0–67.5ms per call (113.9–135.0ms per eval x2)
ceiling CLI live face N=30: assignTasks M=2 71.9–87.6us per call
```

推论链（R4-B §2 / R5-B §2 / R6-B §2 的各条在复测数字上原样成立）：

1. M=2 天花板 12.3–13.3 ms/eval、M=10 18.9–22.0 ms/eval——本 VM 较 R6-B 的
   VM 偏慢约 20–30%，绝对值成比例上浮（token-free 与 10× 压力口径同幅上浮），
   占比结构（analyzeTask 18–19%）与全部方向结论不受影响。
2. R5-B 的收紧口径复测成立：token-free 真实回放 9.0–10.4 ms/eval——真实天花板
   仍比保守口径低、离落地线更远。
3. 复杂度类通道维持关闭：R1-B §2 逐函数下界（排序即输出 Ω(M log M)、全约束
   评估即 rejection-matrix 契约 Θ(M×约束数)、决策构造 Θ(输出字段数)）在逐字节
   未变的代码上原样成立。
4. 结构性重开条件不变：10× 压力（N=20000）下切片全量 ~114–135 ms/eval，届时
   20–30% 级候选才开始触线。

## 3. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S7-B-1 | `familyOf` deploy 门冗余合取消除（`HIGH_RISK_RE.test(text) &&` 可删：DEPLOY_RE 语言 ⊆ HIGH_RISK_RE 语言） | deploy/production/prod 三 token 都是 HIGH_RISK_RE 的独立交替项且 `\b` 边界相同 → DEPLOY 匹配处 HIGH_RISK 必匹配，合取第一项恒被蕴含；删除后 contractRisk 已定义的任务全程零次 HIGH_RISK_RE 求值 | ✅ 20000 组语言包含性探针（5278 个 deploy 命中全部蕴含成立）+ 12000 组 fuzz 对真实 analyzeTask 逐字节 | 批省 143.9–159.4µs（options-free）/ 91.7–152.2µs（contractRisk 全定义）；micro 命中省 16–51ns、非命中 9–22ns | 淘汰：S4-B-4/S1-B 捆绑同噪声带 + 合取是意图文档与两正则独立演化的耦合护栏（§4.1） |
| S7-B-2 | `analyzeTask` preferPrimary 被吸收析取消除（`highRisk \|\|` 与 `\|\| family==="deploy"` 删除） | `complexityOf` 唯一 HIGH 分支即 `highRisk \|\| family==="deploy"` → `complexity==="HIGH"` 与该析取双向等价，两项被吸收 | ✅ 12000 组 fuzz 逐字节（含与 S7-B-1 捆绑） | delta -1.2 / +15.1 / +44.6µs 三次**符号翻转**——纯抖动 | 淘汰：实测零收益 + 显式析取是意图文档、删除后语义静默耦合 complexityOf 内部导出（§4.2） |
| S7-B-3 | `evaluateLiveCandidate` 空前置失败时直接返回 `rest`（免 merged 拷贝 + 结果对象字面量） | role/complexity 通过时 merged≡rest.failures 拷贝、eligible≡rest.eligible、modelId≡rest.modelId（toModelDescriptor 保 id）→ 返回 rest 值等价 | ✅ 8000 组组件级 + 3000 组 route 级 fuzz 对真实 router 逐字节；身份探针：每调仍新鲜 | 97.1–416.3µs/批（route-only；首次运行 416µs 为 JIT 预热离群，第 2/3 次 97–114µs） | 淘汰：深度噪声带 + 两个公开返回契约点（CandidateCheck×2）跨函数对象别名，等价依赖未承诺的实现事实（§4.3） |
| S7-B-4 | `buildDecision` justification 模型常量尾段每 router 构造期预计算（Map<id,tail>，纯私有通道） | 每决策免 2 次数字→字符串转换；buildDecision 未导出，不撞 R1-B §4.4 的公开签名通道 | ✅ 3000 组 fuzz 对真实 router 逐字节 | -82.0 / +65.2 / +115.9µs 三次**符号翻转**——抖动 | 淘汰：实测零可靠收益（V8 模板内联数字转换本就便宜，Map.get+concat 不占优）+ 对 config.models 的派生缓存面（X1-1 邻域陈旧风险）（§4.4） |
| S7-B-5 | 默认 `["tool-use"]` 能力数组模块级享元（analyze-task 与 resolveRouteDefaults 两站点） | 每任务/每 route 免 1 次 1 元数组分配 | ❌ 身份论证：`analysis.requiredCapabilities` 是公开 TaskAnalysis 字段且随 TaskAssignment 保留，探针三次一致跨 assignment 互异；单例翻转为别名 | 上界：1 元数组分配 ~4.3–5.2ns → N=2000 批上界 8.7–10.4µs | 淘汰：可观察身份改变（S1-A-7/S4-B-3/S6-B-2 先例链第六例）+ 上界即噪声底；router 站点在 assign 路径不可达（§4.5） |
| S7-B-6 | `validateConfig` 查重 Set 复用为闭包 `catalogIds`（免二次 Set + map 数组，文件内私有改动） | 两份内容相同的 id Set 合一 | ✅ config JSON、Set 内容、1000 组 route 逐字节等价 | M=2 省 -11~131ns（一次符号翻转）、M=10 省 252–355ns——**每批一次** | 淘汰：每批一次的 ns 级（S2-B-2 同带：createModelRouter M=2 全程 ~600ns）（§4.6） |

## 4. 关键裁决细节

### 4.1 S7-B-1：蕴含成立、量级不够——第七轮版的 S1-B 捆绑

理论面完备：`\b(deploy|production|prod\b)\b/i` 的三个交替项逐一是 HIGH_RISK_RE
的独立交替项（`deploy(?:ing|ment|s)?` 可选组缺席分支、`production`、`prod`），
且两侧 `\b` 边界与 `/i` 标志一致，故 **DEPLOY_RE 可匹配的文本集合 ⊆
HIGH_RISK_RE 可匹配的文本集合**——合取 `HIGH_RISK_RE.test(text) &&
DEPLOY_RE.test(text)` 中第一项恒被第二项蕴含。20000 组包含性探针（含
deployment/deploying/preprod/reproduction/部署deploy测试 等对抗词形，5278 个
deploy 命中）全部蕴含成立；12000 组 fuzz 对真实 analyzeTask 逐字节等价。

删除后的额外红利：contractRisk 已定义的任务（analyzeTask 主体不再求值
HIGH_RISK_RE）全程零次大正则求值。但价值面三关全不过：

1. **噪声带**：批 143.9–159.4µs（options-free）——与已裁决淘汰的 S4-B-4
   （143–215µs）、S1-B 捆绑（284µs）逐字节同带宽同路径；contractRisk 全定义的
   上界口径也只有 91.7–152.2µs。
2. **天花板支配**：analyzeTask 全量 2.28–2.36ms/eval（§2），任何其内候选先验
   不可达落地线。
3. **护栏面**：该合取是「deploy 家族 ⊆ 高风险关键词文本」的唯一显式记载，也是
   HIGH_RISK_RE 与 DEPLOY_RE 独立演化的耦合护栏——删除后未来任何人给
   DEPLOY_RE 扩词（如 release/rollout）会静默把非高风险文本判入 deploy 家族，
   蕴含前提无声失效。S5-B-1「意图文档」裁决的同类权衡。

与 S1-B-1 的区分：S1-B-1 是**共享一次求值**（familyOf 与 analyzeTask 主体共用
HIGH_RISK 结果），本候选是**语言包含使整个合取项可删**——机制不同、证据不同
（包含性探针是新证据等级），不属重开；两者的量级结论同向（噪声）。

### 4.2 S7-B-2：双向吸收成立但实测零收益

`complexityOf` 返回 `"HIGH"` 的唯一分支就是 `input.highRisk ||
input.family === "deploy"`，故在 analyzeTask 内
`complexity === "HIGH" ⟺ (highRisk || family === "deploy")`——preferPrimary
五个析取中第 1、5 项被第 2 项**双向吸收**，可删。12000 组 fuzz（含捆绑形态）
逐字节等价。但基准三次运行 delta 为 -1.2 / +15.1 / +44.6µs，**符号翻转**即
抖动带宽内零收益——省下的只是每任务 ≤2 次布尔/字符串比较（~1ns 级）。且两个
显式析取是「高风险任务、deploy 家族必偏主模型」这一路由决策的意图文档；删除后
preferPrimary 的正确性静默依赖 complexityOf 的内部分支结构（未来给 HIGH 增加
新触发条件时 preferPrimary 会随之扩大而无人注意）。零收益 + 派生耦合，双关封死。

### 4.3 S7-B-3：本轮最强候选，输在噪声带与契约点别名

等价成立：role/complexity 前置通过时，当前代码构造
`{ modelId: model.id, eligible: merged.length === 0, failures: merged }`，其中
merged 是 `rest.failures` 的纯拷贝、`model.id ≡ rest.modelId`
（`toModelDescriptor` 字段级保 id，切片内事实）——直接返回 `rest` 逐字节同值。
8000 组组件级 fuzz（全约束组合含失败路径）+ 3000 组 route 级 fuzz 对真实
`router.route` 逐字节；身份探针证明候选下每调结果仍新鲜互异。但：

1. **噪声带**：97.1–416.3µs/批（route-only 口径；首次运行 416µs 为 tsx 首装 +
   JIT 预热离群，第 2/3 次运行 97–114µs 落回 S4-B-5（232–349µs）/S2-B-1
   （202–240µs）已裁决的同一带宽之下），换算 ≤0.8ms/eval，低于落地线一个量级
   以上，且被 §2 天花板支配。
2. **契约点别名**：`CandidateCheck` 同时是 `evaluateCandidate` 与
   `evaluateLiveCandidate` 两个公开导出的返回类型。候选使外层的返回对象与内层
   的返回对象**跨函数同一**——等价性依赖「evaluateCandidate 永远返回新鲜对象、
   其 failures 永不被调用方原地变异」这一实现事实而非签名承诺（S2-B-1 型
   未承诺不变量）。今天成立，但任何未来在 evaluateCandidate 内做结果缓存/
   享元的改动都会静默把别名泄漏进 live 路径的 rejections。防御性重构造正是
   这条函数边界的护栏。

### 4.4 S7-B-4：私有通道走通了，收益却是符号翻转

R1-B §4.4 关闭的是 toModelDescriptor 的三条消除通道（模块缓存=X1-1、加参数=
公开签名、内联=反架构）。本候选找到了第四条通道的一个新目标：justification 的
模型常量尾段（`estimated cost X USD and duration Y ms fit remaining limits`）
只依赖 selected 模型字段，而 buildDecision 是 model-router.ts 的**私有**函数
——构造期 `Map<id, tail>` 穿进去不需要任何公开面改动。3000 组 fuzz 逐字节等价
证明通道可行。但基准三次 delta 为 **-82.0 / +65.2 / +115.9µs——符号翻转**：
V8 对模板字面量内数字转换的快路径使内联构造本就便宜，Map.get + 预物化长字符串
concat 并不占优。零可靠收益之外还有代价面：这是对 `config.models` 字段的派生
缓存，readonly 仅是 TS 编译期约定，任何运行时变异目录字段的调用方都会拿到陈旧
justification（X1-1「陈旧缓存风险」的实例级邻域）。零收益 + 派生缓存面，封死。

### 4.5 S7-B-5：第六个身份否决，先例链继续

`["tool-use"]` 默认数组在两个站点每调新鲜分配。享元化纸面必赚，但身份探针
（三次一致）：当前跨 assignment `analysis.requiredCapabilities` 互异对象；
模块级单例使 `a1.analysis.requiredCapabilities === a2.analysis.requiredCapabilities`
由 false 翻 true——`requiredCapabilities` 是 `TaskAnalysis`（公开输出，随
`TaskAssignment` 保留）的字段，对象身份可观察，与 S1-A-7（anomalyCodes）、
S1-B-8（allowedIds）、S4-B-3（空 failures）、S6-B-2（route:cancel 取消项）、
S1-D-1（addVersion push）同一先例链的第六例。且一旦任何调用方原地 push 能力
即跨任务污染。收益上界实测 1 元数组分配 4.3–5.2ns/次 → N=2000 批上界
8.7–10.4µs——身份论证之外收益也在噪声底。model-router 站点
（`resolveRouteDefaults` 的 `?? ["tool-use"]`）虽不随决策保留（身份不可观察），
但 assign 路径恒传 `analysis.requiredCapabilities` 使该默认仅在 routeFlowNode
路径触发，每 route 一次 1 元数组 = ns 级。双站点双关封死。

### 4.6 S7-B-6：每批一次的 ns 级

`createModelRouter` 先在 `validateConfig` 内建查重 `ids` Set（用后丢弃），又在
闭包里 `new Set(models.map(id))` 建第二份内容相同的 `catalogIds`。两个函数都在
model-router.ts 内私有，复用不需要任何公开面改动；config JSON、Set 内容与
1000 组 route 结果逐字节等价。但收益是**每 assignTasks 批一次**的
M=2 -11~131ns（一次符号翻转）/ M=10 252–355ns——createModelRouter M=2 全程
本就只有 ~600ns/批（S2-B-2 同一带宽的实测复核）。占 N=2000 批 <0.01%。
纯噪声，封死。

## 5. 逐文件收口（第七遍透镜下的残余检查）

| 文件 | 检查项 | 结论 |
| --- | --- | --- |
| `analyze-task.ts` | S7-B-1 淘汰（噪声带 + 意图/耦合护栏）；S7-B-2 淘汰（符号翻转 + 派生耦合）；S7-B-5 站点一淘汰（身份）；S1-B-1/2/3、S4-B-1、S5-B-1/3、S6-B-3 维持 | 无候选 |
| `policy.ts` | S7-B-3 淘汰（噪声带 + 契约点别名）；全约束独立评估为契约下界维持；S5-B-2（含 deadline 姊妹封死）、S4-B-2/3 维持 | 无候选 |
| `supervisor/model-router.ts` | S7-B-4 淘汰（符号翻转 + 派生缓存面）；S7-B-6 淘汰（每批 ns）；S7-B-5 站点二（assign 路径不可达）记录；S6-B-1/2/5、S5-B-4、S3-B-5、S2-B-2、S1-B-7 维持；`toModelDescriptor` 16% 维持 R1-B §4.4 架构裁决 | 无候选 |
| `assign.ts` | 无新面；S6-B-4、S4-B-4/5、S3-B-1、S2-B-1、S1-B-8 维持；防御拷贝护栏维持 | 无候选 |
| `r0.ts` | 无新面；S1-B-6/S2-B-3/S3-B-4/S4-B-3 维持；排序输出即契约（R1-B §2 下界）；`applyCascade` 生产不可达维持 | 无候选 |
| `live-cascade.ts` | 无新面；S1-B-4/5、S3-B-2/3 维持；`stay` 闭包亚噪声维持 R2-B 裁决 | 无候选 |
| `primary-catalog.ts` / `catalog-model.ts` | 纯构造 Θ(字段)；`toModelDescriptor` 的 id 保真是 S7-B-3 等价性的锚（只记录，不改）；条件 spread 属性存在性可观察维持（S1-C-10 类） | 无候选 |
| （跨切片，只记录不改） | `flowchartRoleForAgentRole` 为单三元表达式，无面；`planAssignmentPolicy` 双 sort = S2-B-4 维持；`compareLiveCandidates` localeCompare = S3-B-3 冻结面 | 不属本切片 |

## 6. 前后对比与测试

无代码 diff。仓库变更仅本报告一个文件。零改动下相关套件复核全绿：

```bash
pnpm typecheck   # 通过
pnpm lint        # 通过（本轮无继承 lint 债务，未触碰任何旧脚本）
pnpm build       # 通过
npx tsx --test test/unit/routing/*.test.ts test/unit/supervisor/*.test.ts
# tests 260 / suites 18 / pass 260 / fail 0
npx tsx --test test/unit/routing/live-isolation.test.ts
# tests 3 / pass 3 / fail 0   （live 面不 import R1/bandit/shadow 继续成立）
pnpm gate          # typecheck + lint + test + build 全绿
# 全量 tests 1169 / suites 78 / pass 1168 / fail 0 / skipped 1
```

环境披露：本 VM 预装 Node 22.14.0 低于 engines `>=22.19.0`，doctor preflight
测试（`test/unit/cli/doctor.test.ts`，切片外）在旧 Node 下按设计 fail-closed；
经 nvm 切换 Node 22.23.2 后全量 gate 全绿。与本切片与本报告零关联。

仿真（临时脚本未入库——无赢家不落地死代码；完整源码见附录，seeds
`0xb77b01`–`0xb77b06`，天花板语料复用 R4-B 的 `0xb44b01`）最终一次运行：

```text
ceiling eval-replay N=2000: assignTasks M=2 6155.1us | M=10 9449.0us | analyzeTask share 1141.2us (19%)
ceiling per eval run (x2 calls): M=2 total=12.31ms | M=10 total=18.90ms | analyzeTask total=2.28ms
ceiling replay-faithful (token-free) N=2000: assignTasks M=2 4481.5us per call (8.96ms per eval x2)
ceiling 10x stress N=20000: assignTasks M=2 57.0ms per call (113.9ms per eval x2)
ceiling CLI live face N=30: assignTasks M=2 78.8us per call
S7-B-1 inclusion probe: 20000 texts, deploy-matches=5278, DEPLOY=>HIGH_RISK holds=true
S7-B-1/2 bench N=2000: current=1149.3us S7-B-1=989.9us S7-B-2=1104.7us bundle=994.4us | delta1=159.4us delta2=44.6us
S7-B-1 bench N=2000 contractRisk-defined: current=958.6us cand=865.4us delta=93.2us per batch
S7-B-1 micro no-hit edit: current=612ns absorbed=590ns
S7-B-1 micro high-risk deploy hit: current=309ns absorbed=292ns
S7-B-1 micro credentials-only hit: current=618ns absorbed=590ns
S7-B-3 identity probe: alias-return keeps per-call results distinct (true)
S7-B-3 bench N=2000 (route-only): merged=2030.7us alias-return=1933.6us delta=97.1us per batch
S7-B-4 bench N=2000 (route-only): inline-tail=2096.6us precomputed-tail=1980.8us delta=115.9us per batch
S7-B-5: analysis.requiredCapabilities distinct across assignments = true -> a shared module-level default flips this to false (observable identity change, S1-A-7/S6-B-2 precedent)
S7-B-5 upper bound: ["tool-use"] alloc=0.0043ms per 1000 -> N=2000 batch upper bound 8.7us (sink=true)
S7-B-6 bench M=2: duplicate-set=590ns shared-set=459ns delta=131ns per router construction (once per batch)
S7-B-6 bench M=10: duplicate-set=2360ns shared-set=2109ns delta=252ns per router construction (once per batch)

CONCLUSIONS: ceiling M=2 per-eval=12.3ms M=10 per-eval=18.9ms replay-faithful=9.0ms (holds-below-landing-line=true) | S7-B-1 inclusion-holds=true | S7-B-1 equal=true | S7-B-2 equal=true | bundle equal=true | S7-B-3 equal=true fresh-per-call=true | S7-B-4 equal=true | S7-B-5 current-distinct=true | S7-B-6 equal=true
ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

三次独立运行 `CONCLUSIONS` 行的等价/见证字段**逐位一致**（包含性探针
deploy-matches=5278 三次逐位一致），计时区间：天花板 M=2 12.27–13.28ms /
M=10 18.90–21.96ms / token-free 8.96–10.43ms / 10× 压力 113.9–135.0ms；
S7-B-1 143.9–159.4µs（同向为正）、S7-B-2 -1.2~+44.6µs（**符号翻转**）、
S7-B-3 97.1–416.3µs（同向为正，首次 JIT 离群）、S7-B-4 -82.0~+115.9µs
（**符号翻转**）、S7-B-5 上界 8.7–10.4µs、S7-B-6 M=2 -11~131ns（一次符号
翻转）/ M=10 252–355ns。S7-B-5 身份探针三次全部 `distinct=true`。

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S7-B-1 | familyOf deploy 门冗余合取消除（DEPLOY_RE ⊆ HIGH_RISK_RE 语言包含） | 等价（20000 组包含探针 + 12000 fuzz）但批仅省 92–159µs（S4-B-4/S1-B 捆绑同噪声带）；合取是意图文档 + 两正则独立演化的耦合护栏。与 S1-B-1（共享求值）机制不同。重开：结构性条件满足且 DEPLOY/HIGH_RISK 词表被契约化联动 |
| S7-B-2 | analyzeTask preferPrimary 被吸收析取消除（highRisk 与 family==="deploy" 被 complexity==="HIGH" 双向吸收） | 等价但实测 -1.2~+44.6µs 符号翻转＝零收益；显式析取是意图文档，删除后语义静默耦合 complexityOf 内部分支结构 |
| S7-B-3 | evaluateLiveCandidate 空前置失败时直接返回内层 rest（免 merged 拷贝 + 结果对象） | 等价（8000+3000 fuzz 对真实 router 逐字节，身份仍每调新鲜）但 97–416µs/批深度噪声带；两个公开 CandidateCheck 契约点跨函数对象别名，依赖 evaluateCandidate 返回新鲜性这一未承诺实现事实（S2-B-1 型） |
| S7-B-4 | buildDecision justification 模型常量尾段每 router 构造期预计算（私有通道 Map） | 等价但实测 -82~+116µs 符号翻转＝零可靠收益（V8 模板数字转换本就便宜）；对 config.models 的派生缓存面（X1-1 邻域陈旧风险）。私有通道本身可行性已记录 |
| S7-B-5 | 默认 ["tool-use"] 能力数组模块级享元（analyze-task + resolveRouteDefaults 两站点） | 不等价：analysis.requiredCapabilities 跨 assignment 身份互异是可观察契约（S1-A-7/S4-B-3/S6-B-2 先例链第六例）；上界 8.7–10.4µs/批也在噪声底；router 站点 assign 路径不可达 |
| S7-B-6 | createModelRouter 复用 validateConfig 查重 Set 为 catalogIds | 等价（config/Set/route 逐字节）但每批一次 M=2 -11~131ns（符号翻转）/ M=10 252–355ns；createModelRouter M=2 全程 ~600ns（S2-B-2 同带） |

**结构性重开条件（对整个切片，与 R4-B/R5-B/R6-B 一致并经本轮第四次复测确认）**：
eval 数据集规模增长 ≥1 个量级（N≥20000 时切片全量 ~114–135 ms/eval，20–30%
级候选开始触线），或 analyzeTask/route 进入每 turn 热路径，或出现新的高频
调用方。逐候选重开条件：S7-B-1/3 需先满足结构性条件（等价 + 包含性/身份证据
本报告已备，可直接引用）；S7-B-2/4/6 需先推翻本报告的符号翻转/ns 级基准；
S7-B-5 需先推翻 requiredCapabilities 子对象身份契约论证。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.ts` 后 `npx tsx <file>`（仓库根目录，依赖已装）。
seeds：`0xb77b01`–`0xb77b06`；天花板语料复用 R4-B 的 `0xb44b01` 以保证可比。

```ts
/**
 * R7-B deterministic equivalence + benchmark simulation (seventh pass).
 * 1) Re-measures the R4-B/R5-B/R6-B aggregate slice ceiling (corpus seed
 *    0xb44b01 reused verbatim for comparability) plus the replay-faithful
 *    token-free corpus introduced by R5-B.
 * 2) Adjudicates fresh Round-7 candidates S7-B-1 .. S7-B-6 against the live
 *    routing slice, byte-identical since R1-B's baseline 94ed3d9.
 * Seeded PRNG (mulberry32) -> fully reproducible. Seeds 0xb77b01-0xb77b06.
 */
import { performance } from "node:perf_hooks";
import { analyzeTask, type AnalyzeTaskOptions, type TaskAnalysis } from "/workspace/src/routing/analyze-task.js";
import { assignTasks, type AssignableTask } from "/workspace/src/routing/assign.js";
import { planAssignmentPolicy, pickPreferredModel } from "/workspace/src/routing/assign-plan.js";
import { flowchartRoleForAgentRole } from "/workspace/src/graph/compile-children.js";
import { ASSIGN_FEATURE_VERSION, FLOWCHART_FEATURE_VERSION } from "/workspace/src/routing/feature-version.js";
import { catalogFromPrimary } from "/workspace/src/routing/primary-catalog.js";
import {
  catalogModel,
  oneHotDistribution,
  toModelDescriptor,
  type CatalogModel,
  type CatalogModelInput
} from "/workspace/src/routing/catalog-model.js";
import {
  evaluateCandidate,
  evaluateLiveCandidate,
  type CandidateCheck,
  type ConstraintFailure,
  type LiveRouteRequest
} from "/workspace/src/routing/policy.js";
import type { PrivacyClass } from "/workspace/src/routing/capability-registry.js";
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
  return { policyVersion: "sim-r7b", models };
}
const conclusions: string[] = [];

/* ============================================================
 * §0 Ceiling re-measurement (R4-B/R5-B/R6-B methodology, corpus seed
 * 0xb44b01 reused verbatim) + replay-faithful token-free corpus (R5-B).
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
 * Faithful analyze-task replica (same regexes/constants as
 * src/routing/analyze-task.ts). familyMode "current" keeps the
 * HIGH_RISK_RE && DEPLOY_RE conjunction; "absorbed" = S7-B-1 drops the
 * first conjunct (language inclusion DEPLOY ⊆ HIGH_RISK).
 * preferMode "current" keeps all five disjuncts; "absorbed" = S7-B-2 drops
 * highRisk and family==="deploy" (both absorbed by complexity==="HIGH").
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
type FamilyMode = "current" | "absorbed";
type PreferMode = "current" | "absorbed";
function familyOfReplica(text: string, role: AgentRole, mode: FamilyMode): TaskFamily {
  if (mode === "current") {
    if (HIGH_RISK_RE.test(text) && /\b(deploy|production|prod\b)\b/i.test(text)) return "deploy";
  } else {
    if (/\b(deploy|production|prod\b)\b/i.test(text)) return "deploy";
  }
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
  familyMode: FamilyMode,
  preferMode: PreferMode
): TaskAnalysis {
  const text = objective.trim();
  const family = familyOfReplica(text, role, familyMode);
  const highRisk = options.contractRisk !== undefined ? options.contractRisk : HIGH_RISK_RE.test(text);
  const long = text.length >= 180 || (text.match(/\n/g) ?? []).length >= 3;
  const complexity = complexityOfReplica({ role, family, highRisk, long });
  const preferPrimary =
    preferMode === "current"
      ? highRisk ||
        complexity === "HIGH" ||
        role === "planner" ||
        role === "debugger" ||
        family === "deploy"
      : complexity === "HIGH" || role === "planner" || role === "debugger";
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

/* ============================================================
 * S7-B-1 language-inclusion probe + S7-B-1/S7-B-2 equivalence and bench.
 * DEPLOY_RE ⊆ HIGH_RISK_RE as languages: any text where the deploy regex
 * matches also matches the high-risk regex (deploy/production/prod are all
 * standalone alternatives of HIGH_RISK_RE with the same \b boundaries).
 * ============================================================ */
{
  const DEPLOY_RE = /\b(deploy|production|prod\b)\b/i;
  const rng = mulberry32(0xb77b01);
  const adversarial = [
    "deployment", "deploying", "deploys", "deployable", "preprod", "prod",
    "prod.", "prod-server", "reproduction", "PRODUCTION line", "部署deploy测试",
    "deploy", "co-production", "prods", "underproduction", "prod\nnext"
  ];
  let deployHits = 0;
  let inclusionHolds = true;
  for (let trial = 0; trial < 20000; trial += 1) {
    const text = trial < adversarial.length ? adversarial[trial]! : genObjective(rng);
    const d = DEPLOY_RE.test(text);
    if (d) {
      deployHits += 1;
      if (!HIGH_RISK_RE.test(text)) inclusionHolds = false;
      check("S7-B-1 language inclusion DEPLOY => HIGH_RISK", HIGH_RISK_RE.test(text), JSON.stringify(text));
    }
  }
  console.log(
    `S7-B-1 inclusion probe: 20000 texts, deploy-matches=${deployHits}, DEPLOY=>HIGH_RISK holds=${inclusionHolds}`
  );
  conclusions.push(`S7-B-1 inclusion-holds=${inclusionHolds}`);

  // Byte-level equivalence of both candidates and the bundle vs the real analyzeTask.
  const rng2 = mulberry32(0xb77b02);
  let eq1 = true;
  let eq2 = true;
  let eqBundle = true;
  for (let trial = 0; trial < 12000; trial += 1) {
    const objective = genObjective(rng2);
    const role = pick(rng2, ROLES);
    const options = genOptions(rng2);
    const real = JSON.stringify(analyzeTask(objective, role, options));
    const replica = JSON.stringify(analyzeReplica(objective, role, options, "current", "current"));
    const cand1 = JSON.stringify(analyzeReplica(objective, role, options, "absorbed", "current"));
    const cand2 = JSON.stringify(analyzeReplica(objective, role, options, "current", "absorbed"));
    const bundle = JSON.stringify(analyzeReplica(objective, role, options, "absorbed", "absorbed"));
    check("S7-B replica fidelity", real === replica, JSON.stringify({ objective, role }));
    if (real !== cand1) eq1 = false;
    if (real !== cand2) eq2 = false;
    if (real !== bundle) eqBundle = false;
    check("S7-B-1 equivalence", real === cand1, JSON.stringify({ objective, role }));
    check("S7-B-2 equivalence", real === cand2, JSON.stringify({ objective, role }));
    check("S7-B-1+2 bundle equivalence", real === bundle, JSON.stringify({ objective, role }));
  }
  conclusions.push(`S7-B-1 equal=${eq1} | S7-B-2 equal=${eq2} | bundle equal=${eqBundle}`);

  // Batch bench at replay scale (analyze-only path, options-free like the
  // eval-replay entry) plus a contractRisk-defined batch (where S7-B-1 also
  // removes the only remaining HIGH_RISK_RE evaluation).
  const tasks = genTasks(mulberry32(0xb77b02), 2000);
  const cur = bench(() => {
    for (const task of tasks) analyzeReplica(task.objective, task.role, {}, "current", "current");
  }, 30);
  const c1 = bench(() => {
    for (const task of tasks) analyzeReplica(task.objective, task.role, {}, "absorbed", "current");
  }, 30);
  const c2 = bench(() => {
    for (const task of tasks) analyzeReplica(task.objective, task.role, {}, "current", "absorbed");
  }, 30);
  const cb = bench(() => {
    for (const task of tasks) analyzeReplica(task.objective, task.role, {}, "absorbed", "absorbed");
  }, 30);
  console.log(
    `S7-B-1/2 bench N=2000: current=${(cur * 1e3).toFixed(1)}us S7-B-1=${(c1 * 1e3).toFixed(1)}us S7-B-2=${(c2 * 1e3).toFixed(1)}us bundle=${(cb * 1e3).toFixed(1)}us | delta1=${((cur - c1) * 1e3).toFixed(1)}us delta2=${((cur - c2) * 1e3).toFixed(1)}us`
  );
  const curRisk = bench(() => {
    for (const task of tasks) analyzeReplica(task.objective, task.role, { contractRisk: true }, "current", "current");
  }, 30);
  const c1Risk = bench(() => {
    for (const task of tasks) analyzeReplica(task.objective, task.role, { contractRisk: true }, "absorbed", "current");
  }, 30);
  console.log(
    `S7-B-1 bench N=2000 contractRisk-defined: current=${(curRisk * 1e3).toFixed(1)}us cand=${(c1Risk * 1e3).toFixed(1)}us delta=${((curRisk - c1Risk) * 1e3).toFixed(1)}us per batch`
  );
  for (const [label, objective, role] of [
    ["no-hit edit", "Implement retry logic for the ledger sync", "implementer"],
    ["high-risk deploy hit", "Deploy payment credentials to production", "implementer"],
    ["credentials-only hit", "Rotate the credentials for the ledger", "worker"]
  ] as const) {
    const a = bench(() => analyzeReplica(objective, role, {}, "current", "current"), 40000);
    const b = bench(() => analyzeReplica(objective, role, {}, "absorbed", "current"), 40000);
    console.log(`S7-B-1 micro ${label}: current=${(a * 1e6).toFixed(0)}ns absorbed=${(b * 1e6).toFixed(0)}ns`);
  }
}

/* ============================================================
 * Faithful route() replica machinery (same exported building blocks as
 * src/supervisor/model-router.ts). Fidelity is checked against the real
 * router before any candidate variant is adjudicated. Used by S7-B-3/4/6.
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
type EvalFn = (model: CatalogModel, request: LiveRouteRequest) => CandidateCheck;
const COMPLEXITY_RANK_REPLICA: Record<TaskComplexity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
/** Faithful replica of evaluateLiveCandidate ("merged") and S7-B-3 ("alias-return"). */
function makeLiveEvalReplica(mode: "merged" | "alias-return"): EvalFn {
  return (model, request) => {
    const prefix: ConstraintFailure[] = [];
    if (!model.roles.includes(request.role)) {
      prefix.push({
        modelId: model.id,
        constraint: "role",
        detail: `role ${request.role} not declared`
      });
    }
    if (COMPLEXITY_RANK_REPLICA[model.maxComplexity] < COMPLEXITY_RANK_REPLICA[request.complexity]) {
      prefix.push({
        modelId: model.id,
        constraint: "complexity",
        detail: `maxComplexity ${model.maxComplexity} < ${request.complexity}`
      });
    }
    const rest = evaluateCandidate(toModelDescriptor(model), request);
    if (mode === "alias-return" && prefix.length === 0) return rest;
    const merged = [...prefix, ...rest.failures];
    return { modelId: model.id, eligible: merged.length === 0, failures: merged };
  };
}
type Partition = { readonly eligible: readonly CatalogModel[]; readonly refusals: readonly RoutingRefusal[] };
function partitionReplica(
  models: readonly CatalogModel[],
  input: RouteTaskInput,
  resolved: ResolvedRouteRequestReplica,
  evalFn: EvalFn
): Partition {
  const allowed = new Set(input.modelPolicy.allowedModels);
  const eligible: CatalogModel[] = [];
  const refusals: RoutingRefusal[] = [];
  for (const model of models) {
    if (!allowed.has(model.id)) continue;
    const check = evalFn(model, {
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
function buildDecisionReplica(
  policyVersion: string,
  input: RouteTaskInput,
  resolved: ResolvedRouteRequestReplica,
  selected: CatalogModel,
  eligible: readonly CatalogModel[],
  refusals: readonly RoutingRefusal[],
  tailByModelId?: ReadonlyMap<string, string>
): RoutingDecision {
  const preferredModel = input.modelPolicy.preferredModel;
  const preferred = selected.id === preferredModel;
  const score = coldStartRoutingScore(input.complexity, preferred);
  const approvalRequired = input.approvalRequired ?? false;
  const statusAfterRoute = approvalRequired ? "WAITING_FOR_USER" as const : "RUNNING" as const;
  const preferredNote = preferred ? `; preferred constraint ${preferredModel}` : "";
  const justification =
    tailByModelId === undefined
      ? `${selected.id} is allowed for role ${input.role} and ${input.complexity} complexity; ` +
        `estimated cost ${selected.estimatedCostUsd} USD and duration ${selected.estimatedDurationMs} ms fit remaining limits` +
        preferredNote
      : `${selected.id} is allowed for role ${input.role} and ${input.complexity} complexity; ` +
        tailByModelId.get(selected.id)! +
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
function routeReplica(
  models: readonly CatalogModel[],
  catalogIds: ReadonlySet<string>,
  policyVersion: string,
  input: RouteTaskInput,
  evalFn: EvalFn = evaluateLiveCandidate,
  tailByModelId?: ReadonlyMap<string, string>
): RoutingDecision {
  validateInputReplica(input);
  const unknownPolicyModel = input.modelPolicy.allowedModels.find((id) => !catalogIds.has(id));
  if (unknownPolicyModel !== undefined) {
    throw new DomainValidationError(`Model policy references unavailable model: ${unknownPolicyModel}`);
  }
  const resolved = resolveRouteDefaultsReplica(input);
  const { eligible, refusals } = partitionReplica(models, input, resolved, evalFn);
  if (eligible.length === 0) {
    throw new RoutingRefusalError(
      liveRefusalMessage({ role: input.role, complexity: input.complexity, highRisk: resolved.highRisk }, refusals),
      refusals
    );
  }
  const selected = selectLiveModel(eligible, input.modelPolicy.preferredModel);
  return buildDecisionReplica(policyVersion, input, resolved, selected, eligible, refusals, tailByModelId);
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
 * S7-B-3: evaluateLiveCandidate returns `rest` directly when the role and
 * complexity prefix produced no failures (saves one array copy and one
 * result-object literal per candidate). Value equality: rest.modelId is
 * model.id (toModelDescriptor preserves ids), rest.eligible/failures are
 * exactly what the merged form recomputes when prefix is empty. Identity:
 * rest is fresh per call, so cross-call distinctness is preserved.
 * ============================================================ */
{
  const replicaMerged = makeLiveEvalReplica("merged");
  const replicaAlias = makeLiveEvalReplica("alias-return");
  const rng = mulberry32(0xb77b03);
  const privacy: readonly PrivacyClass[] = ["local", "cloud-approved", "cloud-general"];
  const nodeRoles: readonly FlowchartNodeRole[] = ["actor", "critic", "router", "judge", "tool", "human"];
  let allEqual = true;
  for (let trial = 0; trial < 8000; trial += 1) {
    const model = catalogModel({
      id: `m${Math.floor(rng() * 4)}`,
      version: "v1",
      roles: rng() < 0.7 ? ["actor", "critic"] : ["actor"],
      maxComplexity: pick(rng, ["LOW", "MEDIUM", "HIGH"] as const),
      estimatedCostUsd: Number((rng() * 2).toFixed(3)),
      estimatedDurationMs: 100 + Math.floor(rng() * 5000),
      ...(rng() < 0.5 ? { capabilities: rng() < 0.5 ? ["tool-use"] : [] } : {}),
      ...(rng() < 0.3 ? { providerPolicy: rng() < 0.5 ? "approved" as const : "forbidden" as const } : {}),
      ...(rng() < 0.4 ? { privacyClass: pick(rng, privacy) } : {}),
      ...(rng() < 0.4 ? { contextWindow: 1000 + Math.floor(rng() * 100000) } : {}),
      ...(rng() < 0.4 ? { maxOutputTokens: 100 + Math.floor(rng() * 8000) } : {}),
      ...(rng() < 0.5 ? { approvedForHighRisk: rng() < 0.5 } : {})
    });
    const request: LiveRouteRequest = {
      role: pick(rng, nodeRoles),
      complexity: pick(rng, ["LOW", "MEDIUM", "HIGH"] as const),
      taskFamily: pick(rng, ["edit", "plan", "test"]),
      privacyRequired: pick(rng, privacy),
      requiredCapabilities: rng() < 0.6 ? ["tool-use"] : [],
      contextNeeded: rng() < 0.5 ? 0 : Math.floor(rng() * 150000),
      outputNeeded: rng() < 0.5 ? 0 : Math.floor(rng() * 8000),
      budgetUsd: rng() < 0.3 ? 0.0001 : Number((rng() * 2).toFixed(4)),
      deadlineMs: rng() < 0.2 ? 10 : Math.floor(rng() * 600000),
      highRisk: rng() < 0.4,
      ...(rng() < 0.7 ? { fixedCostUsd: Number((rng() * 2).toFixed(3)) } : {}),
      ...(rng() < 0.7 ? { fixedLatencyMs: 100 + Math.floor(rng() * 5000) } : {})
    };
    const real = JSON.stringify(evaluateLiveCandidate(model, request));
    const rep = JSON.stringify(replicaMerged(model, request));
    const cand = JSON.stringify(replicaAlias(model, request));
    if (real !== rep || real !== cand) allEqual = false;
    check("S7-B-3 replica fidelity", real === rep, `trial ${trial}`);
    check("S7-B-3 alias-return equivalence", real === cand, `trial ${trial}`);
  }
  // Identity probe: alias-return still yields fresh objects per call.
  const probeModel = catalogFromPrimary({ primaryModelId: "premium" }).models.map((m) => catalogModel(m))[0]!;
  const probeRequest: LiveRouteRequest = {
    role: "actor", complexity: "MEDIUM", taskFamily: "edit", privacyRequired: "cloud-general",
    requiredCapabilities: ["tool-use"], contextNeeded: 0, outputNeeded: 0,
    budgetUsd: Number.POSITIVE_INFINITY, deadlineMs: Number.MAX_SAFE_INTEGER, highRisk: false,
    fixedCostUsd: probeModel.estimatedCostUsd, fixedLatencyMs: probeModel.estimatedDurationMs
  };
  const p1 = replicaAlias(probeModel, probeRequest);
  const p2 = replicaAlias(probeModel, probeRequest);
  const freshPerCall = p1 !== p2 && p1.failures !== p2.failures;
  check("S7-B-3 candidate identity: fresh per call", freshPerCall);
  console.log(`S7-B-3 identity probe: alias-return keeps per-call results distinct (${freshPerCall})`);
  conclusions.push(`S7-B-3 equal=${allEqual} fresh-per-call=${freshPerCall}`);

  // Full route-path equivalence + bench on the biggest realistic entry.
  const catalog = catalogFromPrimary({ primaryModelId: "premium" });
  const router = createModelRouter(catalog);
  const models = router.config.models;
  const catalogIds = new Set(models.map((m) => m.id));
  const plan = planAssignmentPolicy(models, catalog.models.map((m) => m.id));
  const rng2 = mulberry32(0xb77b04);
  for (let trial = 0; trial < 3000; trial += 1) {
    const task = genTasks(rng2, 1)[0]!;
    const input = routeInputFor(plan, task, DEFAULT_LIMITS);
    const real = outcome(() => router.route(input));
    const rep = outcome(() => routeReplica(models, catalogIds, catalog.policyVersion, input, replicaMerged));
    const cand = outcome(() => routeReplica(models, catalogIds, catalog.policyVersion, input, replicaAlias));
    check("S7-B-3 route-path replica fidelity", real === rep, `trial ${trial}`);
    check("S7-B-3 route-path equivalence", real === cand, `trial ${trial}`);
  }
  const tasks = genTasks(mulberry32(0xb77b04), 2000);
  const prepared = tasks.map((task) => routeInputFor(plan, task, DEFAULT_LIMITS));
  const cur = bench(() => {
    for (const input of prepared) routeReplica(models, catalogIds, catalog.policyVersion, input, replicaMerged);
  }, 30);
  const cand = bench(() => {
    for (const input of prepared) routeReplica(models, catalogIds, catalog.policyVersion, input, replicaAlias);
  }, 30);
  console.log(
    `S7-B-3 bench N=2000 (route-only): merged=${(cur * 1e3).toFixed(1)}us alias-return=${(cand * 1e3).toFixed(1)}us delta=${((cur - cand) * 1e3).toFixed(1)}us per batch`
  );
}

/* ============================================================
 * S7-B-4: per-router precomputation of the model-constant justification
 * tail ("estimated cost X USD and duration Y ms fit remaining limits").
 * Entirely private to model-router.ts (buildDecision is not exported), so
 * no public-signature channel is needed — but it is a derived cache over
 * config.models fields (staleness surface if a caller mutates the frozen-by
 * -convention catalog), and the benefit is bounded by two number-to-string
 * conversions per decision.
 * ============================================================ */
{
  const catalog = catalogFromPrimary({ primaryModelId: "premium" });
  const router = createModelRouter(catalog);
  const models = router.config.models;
  const catalogIds = new Set(models.map((m) => m.id));
  const plan = planAssignmentPolicy(models, catalog.models.map((m) => m.id));
  const buildTailMap = (): ReadonlyMap<string, string> =>
    new Map(models.map((m) => [
      m.id,
      `estimated cost ${m.estimatedCostUsd} USD and duration ${m.estimatedDurationMs} ms fit remaining limits`
    ]));
  const tailMap = buildTailMap();
  const rng = mulberry32(0xb77b05);
  let allEqual = true;
  for (let trial = 0; trial < 3000; trial += 1) {
    const task = genTasks(rng, 1)[0]!;
    const input = routeInputFor(plan, task, DEFAULT_LIMITS);
    const real = outcome(() => router.route(input));
    const cand = outcome(() => routeReplica(models, catalogIds, catalog.policyVersion, input, evaluateLiveCandidate, tailMap));
    if (real !== cand) allEqual = false;
    check("S7-B-4 tail-precompute equivalence", real === cand, `trial ${trial}`);
  }
  conclusions.push(`S7-B-4 equal=${allEqual}`);
  const tasks = genTasks(mulberry32(0xb77b05), 2000);
  const prepared = tasks.map((task) => routeInputFor(plan, task, DEFAULT_LIMITS));
  const cur = bench(() => {
    for (const input of prepared) routeReplica(models, catalogIds, catalog.policyVersion, input);
  }, 30);
  const cand = bench(() => {
    const tails = buildTailMap(); // once per batch, charged to the candidate
    for (const input of prepared) routeReplica(models, catalogIds, catalog.policyVersion, input, evaluateLiveCandidate, tails);
  }, 30);
  console.log(
    `S7-B-4 bench N=2000 (route-only): inline-tail=${(cur * 1e3).toFixed(1)}us precomputed-tail=${(cand * 1e3).toFixed(1)}us delta=${((cur - cand) * 1e3).toFixed(1)}us per batch`
  );
}

/* ============================================================
 * S7-B-5: shared flyweight for the ["tool-use"] default capability array.
 * analyze-task site: analysis.requiredCapabilities is retained on the public
 * TaskAssignment.analysis — the current contract keeps per-task arrays
 * distinct; a module-level singleton flips that (observable identity change,
 * S1-A-7/S4-B-3/S6-B-2 precedent chain). Identity probe + upper bound.
 * ============================================================ */
{
  const catalog = catalogFromPrimary({ primaryModelId: "premium" });
  const tasks = genTasks(mulberry32(0xb77b06), 3).map((task) => ({ ...task, contractRisk: false }));
  const assignments = assignTasks({ catalog, tasks });
  const distinct =
    assignments[0]!.analysis.requiredCapabilities !== assignments[1]!.analysis.requiredCapabilities &&
    assignments[1]!.analysis.requiredCapabilities !== assignments[2]!.analysis.requiredCapabilities;
  check("S7-B-5 current contract: per-task capability arrays distinct", distinct);
  console.log(
    `S7-B-5: analysis.requiredCapabilities distinct across assignments = ${distinct} -> a shared module-level default flips this to false (observable identity change, S1-A-7/S6-B-2 precedent)`
  );
  conclusions.push(`S7-B-5 current-distinct=${distinct}`);
  // Upper bound: the allocation cost of one 1-element array per task.
  let sink: unknown;
  const alloc = bench(() => {
    for (let i = 0; i < 1000; i += 1) sink = ["tool-use"];
  }, 20000);
  console.log(
    `S7-B-5 upper bound: ["tool-use"] alloc=${(alloc).toFixed(4)}ms per 1000 -> N=2000 batch upper bound ${(alloc * 2 * 1e3).toFixed(1)}us (sink=${sink !== undefined})`
  );
}

/* ============================================================
 * S7-B-6: createModelRouter builds the duplicate-detection Set inside
 * validateConfig and then a second identical catalogIds Set for the route
 * closure. Reusing the first (private-to-file change) removes one Set and
 * one map() array per router construction — once per assignTasks batch.
 * ============================================================ */
{
  function validateConfigReplica(config: ModelRouterConfig): { models: readonly CatalogModel[]; ids: Set<string> } {
    if (typeof config.policyVersion !== "string" || config.policyVersion.trim() === "") {
      throw new DomainValidationError("ModelRouter policyVersion must be non-empty");
    }
    if (!Array.isArray(config.models) || config.models.length === 0) {
      throw new DomainValidationError("ModelRouter requires an explicit non-empty model catalog");
    }
    const models = config.models.map((model) => catalogModel(model));
    const ids = new Set<string>();
    const ROLES_R: readonly FlowchartNodeRole[] = ["actor", "critic", "router", "judge", "tool", "human"];
    for (const model of models) {
      if (ids.has(model.id)) {
        throw new DomainValidationError("ModelRouter model ids must be unique and non-empty");
      }
      ids.add(model.id);
      if (!Array.isArray(model.roles) || model.roles.length === 0) {
        throw new DomainValidationError(`ModelRouter model ${model.id} must declare roles`);
      }
      if (new Set(model.roles).size !== model.roles.length) {
        throw new DomainValidationError(`ModelRouter model ${model.id} declares duplicate roles`);
      }
      const unknownRole = model.roles.find((role) => !ROLES_R.includes(role));
      if (unknownRole !== undefined) {
        throw new DomainValidationError(`ModelRouter model ${model.id} declares unknown role: ${String(unknownRole)}`);
      }
    }
    if (config.defaultThreshold !== undefined) {
      // validateScore replica (bounds only; same error text shape).
      validateScoreReplica(config.defaultThreshold, "ModelRouter defaultThreshold");
    }
    return { models, ids };
  }
  function createRouterReplica(config: ModelRouterConfig, shareSet: boolean) {
    const { models, ids } = validateConfigReplica(config);
    const catalogIds = shareSet ? ids : new Set(models.map((model) => model.id));
    return { config: { ...config, models }, catalogIds };
  }
  // Equivalence: same catalog content and byte-identical route outcomes.
  const catalog = catalogFromPrimary({ primaryModelId: "premium" });
  const real = createModelRouter(catalog);
  const repCur = createRouterReplica(catalog, false);
  const repShared = createRouterReplica(catalog, true);
  const sameConfig =
    JSON.stringify(real.config) === JSON.stringify(repCur.config) &&
    JSON.stringify(repCur.config) === JSON.stringify(repShared.config);
  const sameSet =
    repCur.catalogIds.size === repShared.catalogIds.size &&
    [...repCur.catalogIds].every((id) => repShared.catalogIds.has(id));
  check("S7-B-6 config equivalence", sameConfig);
  check("S7-B-6 catalogIds set equivalence", sameSet);
  const plan = planAssignmentPolicy(real.config.models, catalog.models.map((m) => m.id));
  const rng = mulberry32(0xb77b06);
  let routesEqual = true;
  for (let trial = 0; trial < 1000; trial += 1) {
    const task = genTasks(rng, 1)[0]!;
    const input = routeInputFor(plan, task, DEFAULT_LIMITS);
    const a = outcome(() => routeReplica(repCur.config.models, repCur.catalogIds, catalog.policyVersion, input));
    const b = outcome(() => routeReplica(repShared.config.models, repShared.catalogIds, catalog.policyVersion, input));
    if (a !== b) routesEqual = false;
    check("S7-B-6 route equivalence", a === b, `trial ${trial}`);
  }
  conclusions.push(`S7-B-6 equal=${sameConfig && sameSet && routesEqual}`);
  const catalog10 = tenModelCatalog();
  for (const [label, cfg] of [["M=2", catalog], ["M=10", catalog10]] as const) {
    const cur = bench(() => createRouterReplica(cfg, false), 100000);
    const cand = bench(() => createRouterReplica(cfg, true), 100000);
    console.log(
      `S7-B-6 bench ${label}: duplicate-set=${(cur * 1e6).toFixed(0)}ns shared-set=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns per router construction (once per batch)`
    );
  }
}

console.log(`\nCONCLUSIONS: ${conclusions.join(" | ")}`);
if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```
