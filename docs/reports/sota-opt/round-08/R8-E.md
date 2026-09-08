MODEL_SLUG=claude-fable-5-thinking-xhigh

# R8-E：`src/learning/` 第八遍复查报告（Round 8）

**战役:** 全库持久 SOTA 优化 Round 8 / R8-E
**基线:** `cursor/sota-persistent-opt-83a1` @ `626f14c`（含 S8-A-1..3 / S8-B-1..4 排除与 S7-C / S7-F-1/2 / S7-I-1 落地）
**分支:** `cursor/r8-e-learning-eighth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动；R3-E..R7-E 的切片级收口锚点复核成立，
且本轮按 R7-I 教训补全了「配置态 × 命令类」矩阵中此前未点名的两个调用面洞。**
切片 10 个文件（1770 行）自 R1-E 基线（`adb20d7`）经 R2-E..R7-E 至本轮基线
（`626f14c`）**逐字节未变**（`git diff adb20d7..626f14c -- src/learning/` 为
0 行，期间无任何提交触及该目录）。`9c26b83..626f14c`（R7-E 之后）的 src 变更
仅 S7-C（`routing/offline-logit.ts`）、S7-F-1/2（`experiments/`）、S7-I-1
（`pi-adapter/listed-model*`）——均不触及本切片、不改变其调用频率或输入规模。
R1-E 逐文件收口、R2-E..R7-E 复查与 S1-E-1..8 / S2-E-1..7 / S3-E-1..5 /
S4-E-1..3 / S5-E-1..5 / S6-E-1..5 / S7-E-1..5 共 38 项排除全部继承有效；生产
调用面交叉检索复核未变（post-run 自适应环 `runAutoAdaptLoop` @ `cli/main:783` /
`track/loop:172` / `cli/adapt:205`、`runAutoAdaptFromEvents` @ `cli/adapt:188`、
`proposeRoutingFromRoutedEvents` @ `cli/adapt:168` + live 装配面
`applyLearnedRouting` @ `routing/assign:102` / `run/flowchart-run:681`、
`loadLearnedRouting` @ `cli/main:708` / `track/loop:88` /
`run/flowchart-run:712`；`patterns` / `attribution` / `signatures` /
`compareSignatures` 仍无任何生产调用方，仅测试使用）。**SLICE-CPU 总量上界
锚点经本轮实测复核成立**：本 VM 五次运行 17.2–17.5µs/run（本轮 outcomes
夹具绑定更少结果，按 R7-E 夹具带保守替换后为 ~22.7–24.3µs，与 R6-E 同带）
——距落地线（≥10ms）**≥410×**，即使把切片 CPU 清零也远不达门槛。本轮新增
**配置态 live 面锚点**：learned 策略已装载时 `applyLearnedRouting` 实测
261–276ns/task（×10 任务 ≈ 2.6–2.8µs/run）——配置态不给本切片开出新热环。
在完整排除表之上以第八组新角度枚举（配置态双载入、构造机制变换、跨界重复
求值），得到 3 个此前未点名的新候选（S8-E-1 … S8-E-3），全部经理论 + 确定性
仿真（seeded mulberry32，8000+ 项等价检查/次 × 5 次独立运行，等价结论逐位
一致；ns 级基准按 S3-E-3 方法论副本对副本、按 S3-E-4 方法论 5 次判向、按
R8-A S8-A-3 教训附单态形状对照）裁决后淘汰：1 个真实存在的每 run 双重
`loadLearnedRouting`（配置态调用矩阵洞，80–85µs/次亚 ms 一次性 + 去重需
切片外公开签名变更 + 并发晋升窗口新鲜性发散，S8-E-1）；1 个等价且混合形状
五次全正（171–212ns/call）但每 run 上界仅 ~2.6–3.2µs 的构造机制变换
（S8-E-2）；1 个被 R2-G 无 ID 收口支配的跨界重复求值（15–16ns/节点，
S8-E-3）。未重开任何 X* / S1-* … S7-* / S8-A-* / S8-B-* 条目。零 diff 下
全部硬不变量天然满足。本切片在其输出契约与数据面语义下维持 SOTA——第八遍
复查确认：**剩余的全部 ms 级余量都在被排除表点名保护的 I/O 契约面上**，
切片级收口条件（R3-E §7 … R7-E §7）依然成立，且配置态矩阵的最后两个未点名
调用面（双载入、跨界 find）本轮已闭合。

## 0. 范围与约束遵守

- 切片：`src/learning/` 全部 10 文件（`attribution` / `auto-loop` /
  `bandit-store` / `diagnostics` / `from-episode` / `learned-routing` /
  `patterns` / `signals` / `signatures` / `task-success`）本轮第八遍全量实际
  读码，未依赖前七轮记忆。上下游 `adaptation/`、`routing/`、`run/`、`track/`、
  `cli/`、`feedback/`、`persist/`、`privacy/` 只读取证，一行未改。
- 先读并遵守（顺序强制）：README → EXCLUSIONS.md（完整表，含 S8-A-1..3、
  S8-B-1..4）→ round-08/PLAN.md → round-07/PLAN.md → round-01/R1-E.md …
  round-07/R7-E.md → 10 个源文件。
- 基线漂移检查：`git diff adb20d7..626f14c -- src/learning/` 为 0 行且
  `git log adb20d7..626f14c -- src/learning/` 无提交——切片自 R1-E 裁决基线
  起逐字节未变，前七轮全部规模测量、调用面图景与裁决原样成立（本 VM 天花板
  仍按本轮实测重锚，见 §1）。
- 排除表遵守：候选枚举刻意绕开全部既有排除。特别地：S8-E-1（每 run 双重
  loadLearnedRouting）与 S2-I-1（普通 run 死载荷下沉）、S4-J-2（catalog∥
  learned Promise.all）、S1-I-1（flowchart 路径未校准构建去重）区分——目标
  是 track/children 路径上**调用方载入 + startFlowchartRun 内部再载入**的
  跨模块重复，前三者分别是死载荷消除、编排重叠、catalog 构建去重；S8-E-2
  （条件 spread 链改条件赋值构造）与 S5-E-3（parseObservedSignal 两级 spread
  合一——保留 spread 形式只消层级）、S4-E-3（全字段显式构造——形状改变）、
  S2-E-7（跨界 binding 双拷贝）区分——本候选保持 own-property 集合、键序、
  值逐位不变，只换构造机制；S8-E-3（applyLearnedToNode 的 prefer.find 与
  applyLearnedRouting 内部 find 跨界去重）与 S2-E-6（applyLearnedRouting
  内部中间数组消除）区分——目标是调用方与被调方之间的重复求值。X0-3 /
  X1-1 / X1-2 / X2-6 / S1-E-* … S7-E-* 全部未触碰。
- 换名重提检查（识别为既有方案换名/换位点，**未列为新候选**）：
  - `signals = [...fromEvents, ...fromExtra, ...fromPi]` 改 concat/push
    累加器或空源别名 = S2-A-4（spread→concat 实测更慢）家族 + R5-E §3.4
    分配避免角度收口 + S1-A-7 身份族，拒列；
  - `baseSignal` 的 `evidenceIds: input.evidenceIds ?? []` 共享冻结空单例
    = S1-A-7 / S7-B-5 / S4-B-3 可观察身份族，拒列；
  - USER_ANSWER 分支 `score >= 50` 依据 scoreUserAnswer ∈ {10, 90} 常量
    折叠 = 跨函数耦合 + ~1ns（S1-B-7 近零成本比较族），拒列；
  - bandit reward 循环增量化 = X1-2 本体；`recordReward` 每奖励全量拷贝是
    `routing/bandit` 公开语义（切片外），维持；
  - diagnose 谓词频率重排 / scoreTaskResult 决策表 Map 化 /
    stableProjectKey 双 replace 合一 = R7-E 无 ID 收口维持；
  - `attributeToBoundary` 比较器 decorate = S1-E-7 支配 + test-only，维持。
- ns 级基准全部副本对副本（S3-E-3 方法论）；几十~几百 ns 量级 delta 以
  5 次独立运行判向（S3-E-4 方法论）；混合形状基准附单态形状对照防 PIC
  形状污染伪影（R8-A S8-A-3 教训）；生产导入仅承担等价性参照与绝对量级
  锚点角色。
- 硬不变量：零 diff，`adapt auto` 只提案（`autoPromote` 被忽略、绝不 CAS
  晋升）、SPARKLE_AUTO_ADAPT=0 仍收集、`parseObservedSignal` 拒绝 user/human
  伪造 taskSuccess、`ensureRoutingBaseline` 绝不移动既有指针、双 LCB 与双
  归因保留、Tracking 无指挥权、分析不改 in-flight run——天然满足。不声称
  Outcome-supported；Checkpoint F-PROD 仍开放（ADR-005）。不改阈值、测试、
  公开签名、数据面。S7-C 落地在 `routing/offline-logit.ts`，不触本切片，
  未重做、未另起平行 eta/dot 路径。

## 1. 配置态 × 命令类矩阵复核 + SLICE-CPU 锚点（本轮首要任务）

R7-I 教训（默认态夹具可能掩盖配置态主路径）按令全面复查，逐命令类 ×
配置态列举本切片的全部生产进入点：

| 命令类 × 配置态 | 切片进入点 | 频次与规模 |
| --- | --- | --- |
| `adapt auto --run` | `EventStore.readAll` → `runAutoAdaptFromEvents` → `runAutoAdaptLoop` | 每进程一次，E≈41 |
| `adapt auto --project`（无 --run） | `discoverProject` → `runAutoAdaptLoop`（空事件表，S4-E-1 面） | 每进程一次 |
| `adapt learn --run` | `readAll` → `proposeRoutingFromRoutedEvents`（项目扫描 + outcomes + episode，S2-E-2 面） | 每进程一次 |
| 普通 `run` | `loadLearnedRouting` @ `cli/main:708`（S2-I-1 已裁决的 fail-fast 载入） | 每进程一次 |
| `run --children` | `cli/main:708` 载入 → `smartChildPlan` 内每任务 `applyLearnedRouting` → `startFlowchartRun` → `flowchartForSupervisor` **第二次 `loadLearnedRouting`**（本轮新点名，S8-E-1）→ 每节点 `applyLearnedToNode` → `runAutoAdaptLoop` 一次 | 双载入各一次；任务/节点 ≤10/几十 |
| `track`（startTrackedRun） | `track/loop:88` 载入 → `splitAndAssignForPrimary` 内每任务 `applyLearnedRouting` → `startFlowchartRun` **第二次载入**（同 S8-E-1）→ `runAutoAdaptLoop` 一次 | 同上 |
| flowchart resume / replay | `flowchart-run:880` / `:1021` 各单次载入（无双载入） | 每恢复一次 |
| SPARKLE_AUTO_ADAPT=0 | 仍收集（persistSignals + updateProjectBandit 照付），仅跳过 propose 分支；`diagnoseModelProjectIssues` 在开关检查前执行且两条返回路径都消费（R5-E 裁决维持） | 不变 |
| 事件类 PROJECT_DISCOVERED / USER_ANSWER / JUDGE_DECISION / TASK_RESULT / PEER_NEGATIVE | 全部经 `collectSignalsFromEvents` / `collectSignalsFromSubagentRun` 单一入口，配置态不放大 E | E≈41 不变 |

矩阵结论：**配置态不给本切片开出每 turn 热环**——learned 策略已装载时新增
的工作只有每任务/每节点一次的 `applyLearnedRouting`（本轮实测 261–276ns/
task，×10 任务 ≈ 2.6–2.8µs/run）与每 run 第二次 `loadLearnedRouting`
（S8-E-1，80–85µs 亚 ms 一次性）。`src/track/` 与 `cli/adapt` 经 grep 复核
仍只命中上表同一批切片函数，无隐藏配置态热环。

SLICE-CPU 锚点本 VM 重测（五次运行区间；Node 22.14.0）：

```text
collect=14.6-14.9us  outcomes=1.8-1.9us  diagnose=0.12-0.15us  bandit-build=0.6-0.7us
total in-slice CPU ~17.2-17.5us per full auto-adapt run
vs landing bar >=10000us  ->  571-582x below EVEN IF ZEROED
configured-state addendum: applyLearnedRouting(avoid=10, M=10) = 261-276ns/task
  -> +2.6-2.8us/run live face with learned policy loaded
```

注：本轮 outcomes 夹具绑定的结果数少于 R7-E 夹具（1.8µs vs 7.0–7.3µs，
夹具组成差异非代码差异——切片逐字节未变）；按 R7-E outcomes 带保守替换，
总量 ~22.7–24.3µs，与 R6-E 的 22.0–24.4µs 同带。两种口径下结论一致：落地线
要求数十~数百 ms 或复杂度类下降；本切片每 run 全部 CPU（含配置态 live 面）
合计 ~20–27µs，唯一的 ms 级余量在 I/O 行为上，而每一条 I/O 边都已被排除表
点名保护（X0-3 保存时机、S2-E-1/4 跳写、S1-G-1 readAll 事实源、S1-E-4/5
顺序追加与并行读、S4-E-2 编排重叠、S5-E-5 惰性 import、S6-E-3 mkdir、
S6-E-4 序列化格式，本轮再加 S8-E-1 双载入）。**锚点复核成立，该切片不存在
不推翻既有排除就能达门槛的候选。**

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S8-E-1 | **tracked/children run 每 run 双重 `loadLearnedRouting` 去重**：`track/loop:88`（或 `cli/main:708`）已载入 learned 策略，`startFlowchartRun` 内部 `flowchartForSupervisor`（`flowchart-run:747→712`）对同一 (stateRoot, projectRoot) 再载入一次——每次载入付 `loadAdaptationRegistry`（快照读 + 全量内容重哈希校验）+ 活动指针取回 + `hashCandidateContent` 复验 + `parseLearnedRoutingPolicy` | 免每 run 一次完整 registry 载入链 | —（I/O 编排候选，以锚点 + 契约论证裁决，S2-E-1/S6-E-3 同式）；resume/replay 路径（`flowchart-run:880`/`:1021`）复核仅单次载入，无重复 | 一次载入实测：全新 root（ENOENT 快路径）**25.3–34.1µs**、现实 registry（基线 + 1 候选）**80.4–85.0µs**（五次稳定）；R2-I 长期 51 基线 registry 锚点 464–478µs——即使取上界也是**亚 ms 一次性** | 淘汰三条独立成立：(1) 量级——亚 ms 一次性低于否决线（S1-I-1 ~190µs、S2-E-1 409–716µs 同级已否决）；(2) 工程形态——去重须把 learned 穿过 `startFlowchartRun` 公开入参（切片外公开签名变更，X0-4 族）或模块级缓存（X1-1）；(3) **新鲜性发散**——两次载入在不同时刻读 registry，并发 `adapt promote` 窗口内现行为是 flowchart 节点面看到较新策略而 assignments 用较旧策略，去重把两面钉死在同一快照上，属可观察行为变更（S2-B-1「未承诺新鲜性」/S3-F-2 族）。这是 R7-I 教训点名的配置态调用矩阵洞，本轮闭合 |
| S8-E-2 | **`baseSignal` 条件 spread 链改后置条件赋值构造**（基础 8 字段字面量 + 10 个 `if (x !== undefined) out.x = x`；own-property 集合、键插入序、值逐位保留） | 免每 call 至多 10 个临时单字段对象分配 + spread 迭代；与 S5-E-3（消层级保 spread）、S4-E-3（改形状）、S2-E-7（跨界拷贝）均不同——这是本切片最后一个未点名的构造机制角度 | ✅ 8000 fuzz × 4 重校验（JSON 字节 + `Object.keys` 键序 + 10 个可选键 own-property 存在性 + `deepStrictEqual`）× 5 次运行逐位一致 | 副本对副本：混合形状（生产真实——相邻 baseSignal 调用携带不同可选集）**五次全正**（+175/+212/+187/+171/+186ns/call）；单态满字段五次全正（+34/+37/+31/+36/+37ns）；单态最小字段五次全负（−4/−3/−6/−2/−3ns）。每 run baseSignal 调用 ~12–25 次 ⇒ 上界 **~2.6–3.2µs/run** | 淘汰：等价且混合侧方向稳定，但绝对量距落地线（≥10ms）**~10³×**，占切片 CPU 锚点 ~15% 而切片整体已收口；每信号伴随 ~10²µs `appendFeedback`（R1-E 锚点）支配；验收标准明文拒收 µs 级。附带确认 R8-A S8-A-3 教训：混合 delta（~190ns）≫ 单态 delta（±35ns），收益大半来自 megamorphic 调用点上 spread 的 CloneObject 敏感性，单态位点 V8 已近零成本 |
| S8-E-3 | **`applyLearnedToNode`（`flowchart-run:687`）与 `applyLearnedRouting`（`learned-routing:205`）的 `learned.prefer.find` 跨界去重**（调用方为判断 preferApplied 重复执行被调方已算过的 find） | 免每节点一次 O(L) find，L≤10 | —（重复求值纯函数平凡等价；落地形态才是问题） | 一次重复 find（L=10 miss 全扫）实测 **15–16ns/节点**（五次稳定）；几十节点 ⇒ **亚 µs/run** | 淘汰：被 R2-G 无 ID 收口支配（该报告已把此 find 定价为「每节点一次、启动时一次性 O(N·L) 噪声」——去重收益上界即该已定价成本）；落地须拓宽 `applyLearnedRouting` 公开返回形状（暴露 prefer 是否生效，X0-4 族 +「公开签名不动」硬约束）或在调用方复制回退优先级逻辑（X1-2 族）；且 `flowchart-run.ts` 在切片外 |

## 3. 关键裁决细节

### 3.1 S8-E-1：本轮最重要的发现——配置态调用矩阵洞的闭合

R7-I 教训要求本轮先复核「配置态 × 命令类」矩阵再找新角度。矩阵复核
（§1 表）发现前七轮从未点名的事实：**每个 tracked run 与每个
`run --children` 都付两次完整的 `loadLearnedRouting`**——调用方
（`track/loop:88` / `cli/main:708`）为 split/assign 载入一次，
`startFlowchartRun` 内部 `flowchartForSupervisor` 为节点策略重写再载入
一次。既往相邻裁决都没覆盖它：S2-I-1 是普通 run 的死载荷（这里两次都被
消费）、S4-J-2 是 catalog 与 learned 的并行化（不消重复）、S1-I-1 是
catalog 构建去重（不同资源）。

淘汰理由的第三条值得展开：两次载入之间隔着 `smartChildPlan`/
`splitAndAssignForPrimary` 的整个装配过程，期间并发 `adapt promote`
可以改变 registry 活动指针。现行为下，assignments 用 T₀ 快照、flowchart
节点用 T₁ 快照——这不是缺陷而是「每个消费点读最新已晋升策略」的自然
语义；去重后两面被钉死在 T₀。该窗口行为无测试断言但可被外部观察
（S2-B-1 判据：不依赖未承诺的新鲜性，也不静默改变已有的新鲜性模式）。
加上亚 ms 量级与切片外公开签名变更，三条各自独立即足淘汰。为将来重开
保留：若 registry 载入随基线数增长进入 ms 带（R2-I 的 51 基线锚点
464–478µs 外推 ≥100 基线才近 ms）且 `startFlowchartRun` 公开入参立项
接受注入 learned，可凭本报告重开。

### 3.2 S8-E-2：构造机制角度的收口（并再证 PIC 形状污染教训）

条件 spread 链（`...(cond ? {x} : {})`）是本切片对象构造的统一形态
（baseSignal 11 处、signalFromAgentMessage、parseObservedSignal、
copyDefinedBinding、optimizedPolicy）。前七轮从三个侧面逼近过它
（S5-E-3 消层级、S4-E-3 改形状、S2-E-7 跨界合一），但「保形状换机制」
——后置条件赋值——从未被点名。本轮以最强等价口径（JSON 字节 + 键序 +
own-property 存在性 + deepStrictEqual，8000 fuzz × 5 次）确认逐位等价，
并测得混合形状五次全正 171–212ns/call。

不落地的量级论证：baseSignal 每 run ~12–25 次调用 ⇒ 上界 ~2.6–3.2µs/run，
占落地线 ~10⁻³；每次构造的宿主信号在同路径必付 ~10²µs 的
`appendFeedback`（R1-E 锚点 96–192µs/信号）。单态对照揭示收益结构：
满字段单态仅 +31–37ns、最小字段单态 −2~−6ns——混合场景的 ~190ns 主要是
spread 版在 megamorphic 输入读取点上的 CloneObject/IC 退化，与 R8-A
S8-A-3 的「PIC 形状污染主导 ns 级测量」教训互为印证。该角度就此收口：
**除非信号规模增长 ≥2 个量级，构造机制变换不会再出达门槛候选**。等价
证据与基准形态在案（附录），供将来重开直接引用。

### 3.3 S8-E-3：跨界重复求值的最后一处点名

`applyLearnedRouting` 返回 `{allowedModels, preferredModel}` 时把「prefer
是否生效」的信息折叠掉了；`applyLearnedToNode` 为决定是否保留
`preferredModel` 字段不得不重算同一个 `prefer.find`。这是 R7-E §3.4 宣告
收口的「重复求值去重」角度在**跨模块边界**上的残余一例——R2-G 已把该
find 的绝对成本定价为噪声（本轮复测 15–16ns/节点确认），去重收益上界即
该成本，而落地需要拓宽切片内公开返回形状或在切片外调用方复制回退逻辑。
至此「重复求值去重」角度在切片内（R7-E 点名的六处）与跨界（本例）全部
闭合。

## 4. 逐文件收口（前七轮收口之上的本轮新检查点）

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `signals.ts` | S8-E-2（baseSignal 构造机制）淘汰并收口构造角度；`evidenceIds ?? []` 空单例、USER_ANSWER 常量折叠不立 ID（§0 换名检查）；S1-E-1/2/3、S2-E-5/7、S3-E-1/5、S4-E-1/3、S5-E-2/3、S6-E-1/2/5、S7-E-1/2/5 维持 | 无候选 |
| `auto-loop.ts` | 三源 spread 合并改 concat/别名不立 ID（S2-A-4 族 + R5-E 分配收口）；I/O 契约边全点名维持（S1-E-4/5、S2-E-1、S3-E-2、S4-E-2、S5-E-1/5）；`assignments` 死字段=公开签名不动（R5-E 裁决维持） | 无候选 |
| `from-episode.ts` | 配置态复核 `adapt learn`/`adapt auto` 仍独立命令无双读；S2-E-2、S7-E-3、`Date.parse`（X1-1 域）维持 | 无候选 |
| `bandit-store.ts` | 无第八组新角度（S2-E-3/4、S3-E-4、S6-E-3/4、X1-2、Iter4 已穷尽构造、扫描、I/O 三面；`recordReward` 拷贝语义在切片外） | 无候选 |
| `diagnostics.ts` | 无第八组新角度（S1-E-6、S3-E-3、S4-E-3、S5-E-4、谓词重排无 ID 收口、恒真守卫维持） | 无候选 |
| `learned-routing.ts` | S8-E-1（双载入）淘汰并闭合配置态矩阵洞；S8-E-3（跨界 prefer.find）淘汰；`applyLearnedRouting` 配置态锚点 261–276ns/task 立案；S2-E-6、X1-1、Iter4 M≤10 维持 | 无候选 |
| `patterns.ts` / `attribution.ts` / `signatures.ts` | 本轮交叉检索复核仍零生产调用方（仅 `test/unit/learning/patterns.test.ts` 与 `test/acceptance/adaptive-loop.test.ts`）；X2-6、S1-E-7/8 维持 | 无候选 |
| `task-success.ts` | S2-E-7 维持；`copyDefinedBinding`+`present()` 空白字段契约实施点不动；其条件 spread 形态被 S8-E-2 裁决覆盖（同量级同支配） | 无候选 |

## 5. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 6. 测试

零代码改动下切片相关套件基线复核，全绿（Node 22.14.0）：

```bash
npx tsx --test "test/unit/learning/*.test.ts" "test/acceptance/adaptive-loop.test.ts"
# tests 48 / suites 2 / pass 48 / fail 0
```

仿真（临时脚本 `/tmp/r8e-sim.mts`，未入库以遵守「败者仿真只进报告附录」；
完整源码见附录，seeds `0xe88e01`–`0xe88e06`）共 **5 次独立运行**，8000+ 项
等价检查/次全部通过、等价结论逐位一致。代表性一次运行：

```text
SLICE-CPU anchor re-verify: collect=14.9us outcomes=1.8us diagnose=0.15us bandit-build=0.6us | total in-slice CPU ~17.5us per run vs landing bar >=10000us (571x below even if zeroed)
configured-state anchor: applyLearnedRouting(avoid=10, M=10)=269ns/task -> x10 tasks/run = 2.69us/run (live face with learned policy loaded)
S8-E-3 anchor: one duplicated learned.prefer.find (L=10, miss)=15ns/node -> tens of nodes = sub-us/run (R2-G no-ID closeout re-priced)
S8-E-1 anchor: one loadLearnedRouting fresh-root(ENOENT)=25.3us | realistic registry (baseline+1 candidate)=85.0us -> the duplicate second load per tracked/children run costs exactly one of these, once per run
S8-E-2 bench mixed x1000 (replica-vs-replica): spread=1950ns/call assign=1774ns/call delta=175ns/call
S8-E-2 bench mono-full (replica-vs-replica): spread=163ns/call assign=129ns/call delta=34ns/call
S8-E-2 bench mono-min (replica-vs-replica): spread=74ns/call assign=77ns/call delta=-4ns/call

ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

计时方向跨 5 次运行汇总：S8-E-2 混合形状**五次全正**（+175/+212/+187/
+171/+186ns/call）、单态满字段五次全正（+34/+37/+31/+36/+37）、单态最小
字段五次全负（−4/−3/−6/−2/−3）；S8-E-1 现实 registry 载入 80.4–85.0µs、
全新 root 25.3–34.1µs 稳定；S8-E-3 15–16ns 稳定；SLICE-CPU 总量 17.2–17.5µs
稳定；configured-state live 面 261–276ns/task 稳定。

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S8-E-1 | tracked/children run 每 run 双重 loadLearnedRouting 去重（track/loop:88 或 cli/main:708 + flowchart-run:712 flowchartForSupervisor 内部再载入） | 真实重复但亚 ms 一次性（现实 registry 80–85µs/次、51 基线锚点仍 <0.5ms）；去重须切片外 startFlowchartRun 公开签名变更（X0-4 族）或 X1-1 缓存；并发 adapt promote 窗口内两面快照新鲜性模式是可观察行为（S2-B-1/S3-F-2 族） |
| S8-E-2 | baseSignal 条件 spread 链改后置条件赋值构造（保形状/键序/own-property） | 等价（8000 fuzz × 4 重校验 × 5 运行）且混合形状五次全正 171–212ns/call，但每 run ~12–25 次调用 ⇒ 上界 ~2.6–3.2µs/run 距落地线 ~10³×；被同路径 ~10²µs appendFeedback 支配；单态对照示收益大半为 PIC 形状污染敏感项（R8-A S8-A-3 教训佐证） |
| S8-E-3 | applyLearnedToNode 与 applyLearnedRouting 的 prefer.find 跨界去重 | 被 R2-G 无 ID 收口支配（find 已定价噪声，本轮复测 15–16ns/节点）；落地须拓宽 applyLearnedRouting 公开返回形状（X0-4 族）或调用方复制回退逻辑（X1-2 族）；调用点在切片外 |

重开条件：S8-E-1 需 registry 基线数增长使单次载入进入 ms 带（≥100 基线
外推）**且** `startFlowchartRun` 公开入参立项接受注入 learned、且两面
快照新鲜性被正式契约化为单快照；S8-E-2 需信号规模增长 ≥2 个量级或信号
管道进入每 turn 热路径（等价证据本报告在案）；S8-E-3 需 applyLearnedRouting
公开返回形状立项拓宽。切片级重开总条件维持 R3-E §7 … R7-E §7：SLICE-CPU
锚点失效（全切片 CPU 增长 ≥2 个量级，本轮复核值 17.2–17.5µs、保守口径
~22.7–24.3µs）或任一 I/O 契约排除（X0-3 / S2-E-1/4 / S1-G-1 / S1-E-4/5 /
S4-E-2 / S5-E-5 / S6-E-3/4 / S8-E-1）被正式推翻。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.mts` 后在仓库根目录 `npx tsx <file>`（依赖已装）。
seeds：`0xe88e01`–`0xe88e06`。

```ts
/**
 * R8-E deterministic equivalence + benchmark simulation (eighth pass over
 * src/learning/). Adjudicates fresh candidates S8-E-1 .. S8-E-3 against the
 * current implementations and re-verifies the R3-E..R7-E SLICE-CPU anchor,
 * including the configured-state live face (applyLearnedRouting with a
 * learned policy loaded). Seeded PRNG (mulberry32) -> fully reproducible.
 * Seeds: 0xe88e01 - 0xe88e08.
 *
 * Reference = production imports (equivalence role + absolute-magnitude
 * anchors). ns-delta benchmarks are replica-vs-replica per the S3-E-3
 * methodology; tens-of-ns deltas need >=5 independent runs per S3-E-4;
 * mono-shape control benches guard against PIC shape pollution per the
 * R8-A S8-A-3 lesson. Replicas keep every already-excluded edit UNAPPLIED
 * (independent if-chains, judge double-get, per-event ctx literal, five
 * separate route maps, conditional-spread chains elsewhere, sequential
 * appendFeedback, ...).
 */
import { deepStrictEqual } from "node:assert";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  collectSignalsFromEvents,
  type ObservedSignal
} from "/workspace/src/learning/signals.js";
import { diagnoseModelProjectIssues } from "/workspace/src/learning/diagnostics.js";
import { outcomesFromRoutedRun } from "/workspace/src/learning/from-episode.js";
import {
  applyLearnedRouting,
  ensureRoutingBaseline,
  loadLearnedRouting,
  routingPolicyContent,
  routingPolicyIdentity,
  type LearnedRoutingPolicy
} from "/workspace/src/learning/learned-routing.js";
import { createBanditState, recordReward, type BanditState } from "/workspace/src/routing/bandit.js";
import { oneHotDistribution } from "/workspace/src/routing/catalog-model.js";
import {
  loadAdaptationRegistryOrNew,
  saveAdaptationRegistry
} from "/workspace/src/adaptation/promotion.js";
import { AGENT_ROLES } from "/workspace/src/domain/roles.js";
import type { EpisodeId, ProjectId, RunId, TaskId } from "/workspace/src/domain/ids.js";
import type { Event } from "/workspace/src/run/events.js";
import type { TaskOutcome, VerificationKind } from "/workspace/src/protocol/v1.js";
import type { IsoTimestamp } from "/workspace/src/domain/timestamp.js";
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
async function benchAsync(fn: () => Promise<void>, reps: number): Promise<number> {
  await fn();
  const t0 = performance.now();
  for (let i = 0; i < reps; i += 1) await fn();
  return (performance.now() - t0) / reps;
}

const NOW = "2026-08-24T05:00:00.000Z" as IsoTimestamp;
const FAMILIES_LOCAL: readonly TaskFamily[] = [
  "edit", "test", "review", "plan", "research", "refactor", "deploy", "unknown"
];

/* ================================================================
 * Fixture generators (R1-A composition: E~41, 10 MODEL_ROUTED,
 * 10 CHILD_MESSAGE, few USER_ANSWER/JUDGE/RETRY). Mirrors prior rounds.
 * ================================================================ */
const OUTCOMES: readonly TaskOutcome[] = ["SUCCESS", "PARTIAL", "FAILURE", "CANCELLED"];
const VERIFS: readonly VerificationKind[] = ["PASSED", "FAILED", "UNOBSERVED"];
const ROLES = ["actor", "critic", "tester", "planner", "scout", "reviewer"] as const;
const ANSWERS = ["lgtm", "no, revert this", "please also add coverage", "可以", "不行 错误", "hmm"];

function genCollectEvents(rng: () => number, length: number): Event[] {
  const out: unknown[] = [];
  const taskIds = Array.from({ length: 10 }, (_, i) => `tsk_${i}0000000`);
  out.push({ type: "PROJECT_DISCOVERED", payload: { project: { id: "prj_simsim01", rootPath: "/tmp/x" } } });
  for (let i = 0; i < length; i += 1) {
    const roll = rng();
    const taskId = pick(rng, taskIds);
    if (roll < 0.25) {
      out.push({
        type: "MODEL_ROUTED",
        payload: {
          taskId,
          model: pick(rng, ["cheap", "premium", "mid"]),
          role: pick(rng, ROLES),
          ...(rng() < 0.8 ? { family: pick(rng, FAMILIES_LOCAL) } : {}),
          ...(rng() < 0.8 ? { modelVersion: "v1" } : {}),
          ...(rng() < 0.8 ? { featureVersion: "fv1" } : {})
        }
      });
    } else if (roll < 0.5) {
      out.push({
        type: "CHILD_MESSAGE",
        payload: {
          message: {
            type: "TASK_RESULT",
            taskId,
            runId: "run_simsim01",
            outcome: pick(rng, OUTCOMES),
            verification: { kind: pick(rng, VERIFS) },
            summary: pick(rng, ["tests passed", "did the work\n  with details", "failed to compile", ""]),
            evidenceIds: rng() < 0.6 ? ["evd_00000001"] : []
          }
        }
      });
    } else if (roll < 0.6) {
      out.push({ type: "USER_ANSWER", runId: "run_simsim01", payload: { answer: pick(rng, ANSWERS) } });
    } else if (roll < 0.7) {
      out.push({
        type: "JUDGE_DECISION",
        runId: "run_simsim01",
        payload: {
          taskId,
          verdict: pick(rng, ["APPROVED", "REJECTED", "NEEDS_USER_DECISION"] as const),
          evidenceIds: rng() < 0.5 ? ["evd_00000002"] : []
        }
      });
    } else {
      out.push({ type: pick(rng, ["LEDGER_UPDATED", "TASK_STATUS_CHANGED", "RUN_STARTED"] as const), payload: {} });
    }
  }
  return out as Event[];
}

function genRoutedEvents(rng: () => number, length: number): Event[] {
  const out: unknown[] = [];
  const taskIds = Array.from({ length: 10 }, (_, i) => `tsk_${i}0000000`);
  const models = ["cheap", "premium", "mid"];
  out.push({
    type: "PROJECT_DISCOVERED",
    runId: "run_simsim01",
    occurredAt: NOW,
    payload: { project: { id: "prj_simsim01", rootPath: "/tmp/proj-a" } }
  });
  for (let i = 0; i < length; i += 1) {
    const roll = rng();
    const taskId = pick(rng, taskIds);
    if (roll < 0.28) {
      const model = pick(rng, models);
      const complete = rng() < 0.85;
      out.push({
        type: "MODEL_ROUTED",
        runId: "run_simsim01",
        occurredAt: NOW,
        payload: {
          taskId,
          model,
          role: pick(rng, ["actor", ...AGENT_ROLES]),
          eligibleModels: models,
          behaviorDistribution: oneHotDistribution(models, model),
          ...(complete ? { family: pick(rng, FAMILIES_LOCAL) } : {}),
          ...(complete ? { featureVersion: "fv1" } : {}),
          ...(complete ? { modelVersion: "v1" } : {}),
          ...(complete ? { agentRole: pick(rng, [...AGENT_ROLES]) } : {})
        }
      });
    } else if (roll < 0.36) {
      out.push({
        type: "TASK_RETRY",
        runId: "run_simsim01",
        occurredAt: NOW,
        taskId: rng() < 0.8 ? taskId : undefined,
        payload: { nextModel: rng() < 0.85 ? pick(rng, [...models, "fresh"]) : undefined }
      });
    } else if (roll < 0.62) {
      out.push({
        type: "CHILD_MESSAGE",
        runId: "run_simsim01",
        occurredAt: NOW,
        payload: {
          message: {
            type: "TASK_RESULT",
            taskId,
            runId: "run_simsim01",
            outcome: pick(rng, OUTCOMES),
            verification: { kind: pick(rng, VERIFS) },
            summary: "tests passed",
            evidenceIds: rng() < 0.6 ? ["evd_00000001"] : []
          }
        }
      });
    } else {
      out.push({
        type: pick(rng, ["USER_ANSWER", "LEDGER_UPDATED", "RUN_STARTED"] as const),
        runId: "run_simsim01",
        occurredAt: NOW,
        payload: { answer: "lgtm" }
      });
    }
  }
  return out as Event[];
}

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
    ...(rng() < 0.85 ? { modelId: pick(rng, ["m1", "m2", "m3"]) } : {}),
    ...(criterion !== undefined ? { criterion } : {}),
    ...(rng() < 0.7 ? { family: pick(rng, ["edit", "test", "review"]) } : {}),
    ...(rng() < 0.8 ? { outcomeKind: pick(rng, ["PASS", "FAIL"] as const) } : {})
  };
}

/* Verbatim in-lock bandit build replica (R2-E S2-E-3 reference form). */
function banditBuild(previous: BanditState | undefined, signals: readonly ObservedSignal[]): BanditState {
  const arms = new Set(previous?.arms ?? []);
  for (const signal of signals) {
    if (signal.modelId !== undefined && signal.modelId.trim() !== "") arms.add(signal.modelId);
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
    if (signal.outcomeKind === "PASS") state = recordReward(state, signal.modelId, 1);
    else if (signal.outcomeKind === "FAIL") state = recordReward(state, signal.modelId, 0);
  }
  return state;
}

/* ================================================================
 * SLICE-CPU anchor re-verify + configured-state live-face anchor.
 * ================================================================ */
{
  const events = genCollectEvents(mulberry32(0xe88e01), 40);
  const routed = genRoutedEvents(mulberry32(0xe88e02), 40);
  const sigRng = mulberry32(0xe88e03);
  const signals = Array.from({ length: 12 }, () => genSignal(sigRng));
  const models10 = Array.from({ length: 10 }, (_, i) => `m${i}`);
  const prevSeed = Array.from({ length: 30 }, () => genSignal(sigRng));
  const previous = banditBuild(undefined, prevSeed);

  const collect = bench(() => void collectSignalsFromEvents(events, {}), 20000);
  const outcomes = bench(() => void outcomesFromRoutedRun(routed), 20000);
  const diagnose = bench(() => void diagnoseModelProjectIssues(signals), 40000);
  const bandit = bench(() => void banditBuild(previous, signals), 40000);
  const total = collect + outcomes + diagnose + bandit;
  console.log(
    `SLICE-CPU anchor re-verify: collect=${(collect * 1e3).toFixed(1)}us outcomes=${(outcomes * 1e3).toFixed(1)}us diagnose=${(diagnose * 1e3).toFixed(2)}us bandit-build=${(bandit * 1e3).toFixed(1)}us | total in-slice CPU ~${(total * 1e3).toFixed(1)}us per run vs landing bar >=10000us (${Math.round(10 / total)}x below even if zeroed)`
  );

  // Configured-state live face: applyLearnedRouting per task with a loaded
  // learned policy (avoid=10 half family-scoped, prefer 1, catalog M=10).
  const catalog10 = models10;
  const learned10: LearnedRoutingPolicy = {
    primaryModelId: "m0",
    avoid: Array.from({ length: 10 }, (_, i) => ({
      modelId: `m${i % 5}`,
      reason: "r",
      ...(i % 2 === 0 ? { family: ["edit", "test", "review", "plan", "research"][i % 5]! } : {})
    })),
    prefer: [{ family: "edit", modelId: "m1" }]
  };
  const applyCost = bench(() => void applyLearnedRouting("edit", catalog10, "m2", learned10), 100000);
  console.log(
    `configured-state anchor: applyLearnedRouting(avoid=10, M=10)=${(applyCost * 1e6).toFixed(0)}ns/task -> x10 tasks/run = ${(applyCost * 10 * 1e3).toFixed(2)}us/run (live face with learned policy loaded)`
  );

  // S8-E-3 anchor: the duplicated learned.prefer.find at flowchart-run:687
  // (already computed inside applyLearnedRouting:205). L=10 prefer entries,
  // miss-heavy shape (worst case scans all L).
  const prefer10: LearnedRoutingPolicy["prefer"] = Array.from({ length: 10 }, (_, i) => ({
    family: ["test", "review", "plan", "research", "refactor"][i % 5]!,
    modelId: `m${i}`
  }));
  const findCost = bench(() => void prefer10.find((entry) => entry.family === "edit"), 200000);
  console.log(
    `S8-E-3 anchor: one duplicated learned.prefer.find (L=10, miss)=${(findCost * 1e6).toFixed(0)}ns/node -> tens of nodes = sub-us/run (R2-G no-ID closeout re-priced)`
  );
}

/* ================================================================
 * S8-E-1 anchor: the duplicated loadLearnedRouting per tracked/children
 * run (caller at track/loop:88 or cli/main:708, then again inside
 * startFlowchartRun -> flowchartForSupervisor at flowchart-run:712).
 * Measures one full production load on (a) fresh root (ENOENT fast path)
 * and (b) a realistic registry with an active routing-policy baseline
 * plus one proposed candidate. The duplicate costs exactly one load.
 * ================================================================ */
{
  const freshRoot = await mkdtemp(join(tmpdir(), "r8e-fresh-"));
  const freshCost = await benchAsync(async () => {
    await loadLearnedRouting(freshRoot, "/tmp/proj-r8e");
  }, 200);

  const stateRoot = await mkdtemp(join(tmpdir(), "r8e-reg-"));
  const projectRoot = "/tmp/proj-r8e";
  const registry = await loadAdaptationRegistryOrNew(stateRoot);
  const identity = routingPolicyIdentity(projectRoot);
  const parent = ensureRoutingBaseline(registry, identity, "premium", "r8e-sim");
  const policy: LearnedRoutingPolicy = {
    primaryModelId: "premium",
    avoid: [{ modelId: "cheap", family: "edit", reason: "meanScore 0.30 over 6 samples" }],
    prefer: [{ family: "edit", modelId: "premium" }]
  };
  registry.createCandidate({
    identity,
    content: routingPolicyContent(policy),
    parentVersionId: parent.versionId,
    author: { kind: "detector", identity: "r8e-sim" },
    evaluationPlan: { stages: ["static", "replay"], metrics: ["task-success", "cost"], planVersion: 1 }
  });
  await saveAdaptationRegistry(stateRoot, registry);
  const loaded = await loadLearnedRouting(stateRoot, projectRoot);
  check("S8-E-1 registry fixture yields an active policy", loaded !== undefined);
  const realCost = await benchAsync(async () => {
    await loadLearnedRouting(stateRoot, projectRoot);
  }, 200);
  console.log(
    `S8-E-1 anchor: one loadLearnedRouting fresh-root(ENOENT)=${(freshCost * 1e3).toFixed(1)}us | realistic registry (baseline+1 candidate)=${(realCost * 1e3).toFixed(1)}us -> the duplicate second load per tracked/children run costs exactly one of these, once per run`
  );
}

/* ================================================================
 * S8-E-2: baseSignal conditional-spread chain -> post-literal conditional
 * property assignment. Reference replica = verbatim spread form from
 * signals.ts; candidate differs ONLY in construction mechanism. Shape,
 * key insertion order, values, and own-property sets must all be
 * preserved bit-for-bit.
 * ================================================================ */
interface BaseSignalInput {
  source: ObservedSignal["source"];
  kind: FeedbackKind;
  projectId: ProjectId;
  score: number;
  boundary: EpisodeSignatureKind;
  summary: string;
  createdAt: IsoTimestamp;
  episodeId?: EpisodeId | undefined;
  runId?: RunId | undefined;
  taskId?: TaskId | undefined;
  modelId?: string | undefined;
  modelVersion?: string | undefined;
  role?: string | undefined;
  family?: string | undefined;
  featureVersion?: string | undefined;
  criterion?: OutcomeCriterion | undefined;
  outcomeKind?: OutcomeKind | undefined;
  evidenceIds?: readonly string[] | undefined;
}

function baseSignalSpread(input: BaseSignalInput): ObservedSignal {
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

type MutableSignal = {
  source: ObservedSignal["source"];
  kind: FeedbackKind;
  projectId: ProjectId;
  score: number;
  boundary: EpisodeSignatureKind;
  summary: string;
  createdAt: IsoTimestamp;
  evidenceIds: readonly string[];
  modelId?: string;
  modelVersion?: string;
  role?: string;
  family?: string;
  featureVersion?: string;
  criterion?: OutcomeCriterion;
  outcomeKind?: OutcomeKind;
  episodeId?: EpisodeId;
  runId?: RunId;
  taskId?: TaskId;
};

function baseSignalAssign(input: BaseSignalInput): ObservedSignal {
  const out: MutableSignal = {
    source: input.source,
    kind: input.kind,
    projectId: input.projectId,
    score: input.score,
    boundary: input.boundary,
    summary: input.summary,
    createdAt: input.createdAt,
    evidenceIds: input.evidenceIds ?? []
  };
  if (input.modelId !== undefined) out.modelId = input.modelId;
  if (input.modelVersion !== undefined) out.modelVersion = input.modelVersion;
  if (input.role !== undefined) out.role = input.role;
  if (input.family !== undefined) out.family = input.family;
  if (input.featureVersion !== undefined) out.featureVersion = input.featureVersion;
  if (input.criterion !== undefined) out.criterion = input.criterion;
  if (input.outcomeKind !== undefined) out.outcomeKind = input.outcomeKind;
  if (input.episodeId !== undefined) out.episodeId = input.episodeId;
  if (input.runId !== undefined) out.runId = input.runId;
  if (input.taskId !== undefined) out.taskId = input.taskId;
  return out as ObservedSignal;
}

const OPTIONAL_KEYS = [
  "modelId", "modelVersion", "role", "family", "featureVersion",
  "criterion", "outcomeKind", "episodeId", "runId", "taskId"
] as const;

function genBaseInput(rng: () => number): BaseSignalInput {
  return {
    source: pick(rng, ["user", "subagent", "deterministic"] as const),
    kind: pick(rng, ["human", "peer", "judge", "deterministic"] as const) as FeedbackKind,
    projectId: "prj_simsim01" as ProjectId,
    score: Math.floor(rng() * 101),
    boundary: pick(rng, ["execution", "review", "tool"] as const) as EpisodeSignatureKind,
    summary: pick(rng, ["tests passed", "user: lgtm", "judge APPROVED", ""]),
    createdAt: NOW,
    ...(rng() < 0.6 ? { modelId: pick(rng, ["m1", "m2", ""]) } : {}),
    ...(rng() < 0.6 ? { modelVersion: "v1" } : {}),
    ...(rng() < 0.6 ? { role: pick(rng, ROLES) } : {}),
    ...(rng() < 0.6 ? { family: "edit" } : {}),
    ...(rng() < 0.6 ? { featureVersion: "fv1" } : {}),
    ...(rng() < 0.6 ? { criterion: pick(rng, ["taskSuccess", "userAcceptance"] as const) } : {}),
    ...(rng() < 0.6 ? { outcomeKind: pick(rng, ["PASS", "FAIL", "ABSTAIN"] as const) } : {}),
    ...(rng() < 0.6 ? { episodeId: "ep_simsim01" as EpisodeId } : {}),
    ...(rng() < 0.6 ? { runId: "run_simsim01" as RunId } : {}),
    ...(rng() < 0.6 ? { taskId: "tsk_10000000" as TaskId } : {}),
    ...(rng() < 0.6 ? { evidenceIds: rng() < 0.5 ? [] : ["evd_00000001"] } : {})
  };
}

{
  const rng = mulberry32(0xe88e04);
  for (let trial = 0; trial < 8000; trial += 1) {
    const input = genBaseInput(rng);
    const ref = baseSignalSpread(input);
    const cand = baseSignalAssign(input);
    let ok = JSON.stringify(ref) === JSON.stringify(cand);
    ok = ok && Object.keys(ref).join(",") === Object.keys(cand).join(",");
    for (const key of OPTIONAL_KEYS) {
      ok = ok && (key in ref) === (key in cand);
    }
    try {
      deepStrictEqual(cand, ref);
    } catch {
      ok = false;
    }
    check("S8-E-2 equivalence (assign replica)", ok, `trial ${trial}`);
  }
  // production parity spot-check: replica matches the production constructor
  // through collectSignalsFromEvents output shape on a full fixture
  const events = genCollectEvents(mulberry32(0xe88e05), 40);
  const prod = collectSignalsFromEvents(events, { episodeId: "ep_simsim01" as EpisodeId });
  check("S8-E-2 production fixture non-trivial", prod.length > 3);

  // Bench: realistic mixed-shape input set (PIC-polluted, matches production
  // where consecutive baseSignal calls carry different optional sets), plus
  // mono-shape controls per the R8-A S8-A-3 lesson.
  const benchRng = mulberry32(0xe88e06);
  const mixedInputs = Array.from({ length: 1000 }, () => genBaseInput(benchRng));
  const fullInput: BaseSignalInput = {
    source: "subagent", kind: "deterministic", projectId: "prj_simsim01" as ProjectId,
    score: 90, boundary: "execution", summary: "TASK_RESULT SUCCESS: tests passed",
    createdAt: NOW, episodeId: "ep_simsim01" as EpisodeId, runId: "run_simsim01" as RunId,
    taskId: "tsk_10000000" as TaskId, modelId: "premium", modelVersion: "v1", role: "implementer",
    family: "edit", featureVersion: "fv1", criterion: "taskSuccess", outcomeKind: "PASS",
    evidenceIds: ["evd_00000001"]
  };
  const minInput: BaseSignalInput = {
    source: "deterministic", kind: "deterministic", projectId: "prj_simsim01" as ProjectId,
    score: 10, boundary: "execution", summary: "run failed: boom", createdAt: NOW
  };

  for (const [label, run] of [
    ["mixed x1000", (fn: (i: BaseSignalInput) => ObservedSignal) => {
      for (const input of mixedInputs) void fn(input);
    }],
    ["mono-full", (fn: (i: BaseSignalInput) => ObservedSignal) => {
      for (let i = 0; i < 1000; i += 1) void fn(fullInput);
    }],
    ["mono-min", (fn: (i: BaseSignalInput) => ObservedSignal) => {
      for (let i = 0; i < 1000; i += 1) void fn(minInput);
    }]
  ] as const) {
    const cur = bench(() => run(baseSignalSpread), 200);
    const cand = bench(() => run(baseSignalAssign), 200);
    console.log(
      `S8-E-2 bench ${label} (replica-vs-replica): spread=${(cur * 1e6 / 1000).toFixed(0)}ns/call assign=${(cand * 1e6 / 1000).toFixed(0)}ns/call delta=${((cur - cand) * 1e6 / 1000).toFixed(0)}ns/call`
    );
  }
  console.log(
    "S8-E-2 per-run upper bound: delta x ~15 baseSignal calls/run (see report; landing bar >=10000000ns/run)"
  );
}

if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```
