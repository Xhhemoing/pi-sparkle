MODEL_SLUG=claude-fable-5-thinking-xhigh

# R6-E：`src/learning/` 第六遍复查报告（Round 6）

**战役:** 全库持久 SOTA 优化 Round 6 / R6-E
**基线:** `cursor/sota-persistent-opt-83a1` @ `fc0de1d`
**分支:** `cursor/r6-e-learning-sixth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动；R3-E/R4-E/R5-E 的切片级收口锚点复核
成立。** 切片 10 个文件（1770 行）自 R1-E 基线（`adb20d7`）经 R2-E、R3-E、
R4-E、R5-E 至本轮基线（`fc0de1d`）**逐字节未变**（`git diff adb20d7..fc0de1d
-- src/learning/` 为空，期间无任何提交触及该目录）；`c228dbe..fc0de1d`
（R5-E 之后）的 src 变更仅 S5-C（`routing/lin-alg.ts` 消元 k 循环按 4 展开）
与 S5-F（`experiments/plan.ts` 单探针去重），均不新增本切片热路径、不改变其
调用频率或输入规模。R1-E 逐文件收口、R2-E/R3-E/R4-E/R5-E 复查与 S1-E-1..8 /
S2-E-1..7 / S3-E-1..5 / S4-E-1..3 / S5-E-1..5 共 28 项排除全部继承有效；
生产调用面交叉检索复核未变（post-run 自适应环 `runAutoAdaptLoop` @
`cli/main:790` / `track/loop:172` / `cli/adapt:205`、`runAutoAdaptFromEvents`
@ `cli/adapt:188`、`proposeRoutingFromRoutedEvents` @ `cli/adapt:168` + live
装配面 `applyLearnedRouting` @ `routing/assign:102` / `run/flowchart-run:681`、
`loadLearnedRouting` @ `cli/main:715` / `track/loop:88` /
`run/flowchart-run:712`；`patterns` / `attribution` / `signatures` 仍无任何
生产调用方，仅测试使用）。**SLICE-CPU 总量上界锚点经本轮实测复核成立**：
一次完整 auto-adapt run 的全切片 CPU 合计 **22.0–24.4µs**（与 R3-E 的
24.6–25.2µs、R4-E 的 18.1–18.5µs、R5-E 的 28.1–28.9µs 同带，VM 差异）——距
落地线（≥10ms）**约 411–455×**，即使把切片 CPU 清零也远不达门槛。本轮在
完整排除表之上以第六组新角度枚举（多 Map 数据结构合一、双正则单遍合并、
双正则匹配复用、写侧目录存在性、序列化格式），得到 5 个此前未点名的新候选
（S6-E-1 … S6-E-5），全部经理论 + 确定性仿真（seeded mulberry32，>20,000 项
等价检查/次 × 5 次独立运行，等价结论逐位一致；ns 级基准按 S3-E-3 方法论
副本对副本、按 S3-E-4 方法论 ≥5 次判向）裁决后淘汰：3 个**廉价形式不等价**
（各有确定性发散反例——S6-E-1 部分字段重路由丢绑定、S6-E-2 负向优先级 vs
首位置匹配、S6-E-5 首匹配复用绑错边界，其中 S6-E-2 忠实形式还**实测慢
3–12×**、S6-E-5 忠实形式结构上零节省）、1 个 S5-G-1 同型（S6-E-3，锁内
mkdir 22.7–23.7µs 占事务 5%，亚 ms + 外部清理自愈契约）、1 个 S4-G-6 同型
（S6-E-4，磁盘数据面字节发散 + 序列化 delta 仅占写盘 0.33%）。S6-E-1 的
忠实形式是本轮唯一等价且五次方向稳定的候选（+267…+692ns/run），但其绝对量
距落地线 4–5 个数量级，且被同路径 `EventStore.readAll` ≥100µs I/O 支配——
按验收标准第 3 条淘汰。未重开任何 X* / S1-* / S2-* / S3-* / S4-* / S5-* /
S6-A/B/D-* 条目；未重提反向扫描早退、双故障 Promise.all、auto-loop 惰性
import、嵌套 Map 分组键。零 diff 下全部硬不变量天然满足。本切片在其输出
契约与数据面语义下维持 SOTA——第六遍复查再次确认：**剩余的全部 ms 级余量
都在被排除表点名保护的 I/O 契约面上**，切片级收口条件（R3-E §7 / R4-E §7 /
R5-E §7）依然成立。

## 0. 范围与约束遵守

- 切片：`src/learning/` 全部 10 文件（`attribution` / `auto-loop` /
  `bandit-store` / `diagnostics` / `from-episode` / `learned-routing` /
  `patterns` / `signals` / `signatures` / `task-success`）本轮第六遍全量实际
  读码，未依赖前五轮记忆。上下游 `adaptation/`、`routing/`、`run/`、`track/`、
  `cli/`、`feedback/`、`persist/`、`privacy/` 只读取证，一行未改。
- 先读并遵守（顺序强制）：README → EXCLUSIONS.md（完整表，含 S5-C-1..7、
  S5-F-1..3、S6-A-1..3、S6-B-1..5、S6-D-1..5）→ round-06/PLAN.md →
  round-01/R1-E.md → round-02/R2-E.md → round-03/R3-E.md → round-04/R4-E.md →
  round-05/R5-E.md → 10 个源文件。
- 基线漂移检查：`git diff adb20d7..fc0de1d -- src/learning/` 为空且
  `git log adb20d7..fc0de1d -- src/learning/` 无提交——切片自 R1-E 裁决基线
  起逐字节未变，前五轮全部规模测量、调用面图景与裁决原样成立。
  `c228dbe..fc0de1d`（R5-E 之后）的 src 变更仅 S5-C 与 S5-F——不触及本切片
  调用方语义与调用频率。
- 排除表遵守：候选枚举刻意绕开全部既有排除。特别地：S6-E-1（五 Map 合一）
  与 S1-E-2（judge 双重 get 去重）、S4-E-1（惰性 Map 分配）、S5-E-2（ctx
  循环外提升）区分——目标是**键值数据结构本身**（五个 per-task Map →
  单个 struct Map），候选副本保留 judge 双 get 的结构形态、独立 if 链与
  每事件 ctx 字面量（全部已排除编辑不捆绑）；S6-E-2（scoreUserAnswer 双正则
  合并）与 S1-A-3（tracking/human-score matchAll 早退，切片外文件）、X0-6
  （human-score 正则缓存）区分——目标是本切片 `signals.ts` 的
  USER_NEGATIVE/USER_POSITIVE 顺序双 test，忠实形式每调用新建 /g 正则以
  规避 X0-6 的 lastIndex 状态风险；S6-E-5（PEER_NEGATIVE 与
  `/unknown agent/i` 双扫描合并）与 S3-E-5（字面量提升）区分——目标是匹配
  结果复用而非正则对象创建；S6-E-3（每写 mkdir 消除）是 S5-G-1（G 区
  CheckpointStore 同型）在本切片 `bandit-store.ts` 边上的首次点名；S6-E-4
  （bandit.json 紧凑序列化）是 S4-G-6（G 区 CheckpointStore 同型）在本切片
  边上的首次点名。X0-3 / X1-1 / X1-2 / X2-6 / S1-E-* / S2-E-* / S3-E-* /
  S4-E-* / S5-E-* 全部未触碰；反向扫描早退、双故障 Promise.all、auto-loop
  惰性 import、嵌套 Map 分组键均未重提。
- ns 级基准全部副本对副本（S3-E-3 方法论）；几十~几百 ns 量级 delta 以
  5 次独立运行判向（S3-E-4 方法论）；生产导入仅承担等价性参照与绝对量级
  锚点角色。
- 硬不变量：零 diff，`adapt auto` 只提案（`autoPromote` 被忽略、绝不 CAS
  晋升）、SPARKLE_AUTO_ADAPT=0 仍收集、`parseObservedSignal` 拒绝 user/human
  伪造 taskSuccess、`ensureRoutingBaseline` 绝不移动既有指针、双 LCB 与双
  归因保留——天然满足。不声称 Outcome-supported；Checkpoint F-PROD 仍开放
  （ADR-005）。不改阈值、权限、数据面契约、公开签名。

## 1. SLICE-CPU 锚点复核（本轮首要任务）

R3-E §1 / R4-E §1 / R5-E §1 的切片级收口论证依赖三个前提，本轮逐一复核：

1. **切片代码未变**：`git diff adb20d7..fc0de1d -- src/learning/` 为空。
2. **调用面未变**：交叉检索确认生产入口仍是 post-run 自适应环（每 run 一次）
   + live 装配面（每任务一次，M≤10）；`patterns` / `attribution` /
   `signatures` / `compareSignatures` 仍零生产调用方（仅
   `test/unit/learning/patterns.test.ts` 与
   `test/acceptance/adaptive-loop.test.ts`）。R5-E 后落地的 S5-C 在
   `routing/lin-alg.ts`（offline 报告面）、S5-F 在 `experiments/plan.ts`
   （实验面）——均不改变 `runAutoAdaptLoop` 的调用时机或事件规模；
   无新热路径、无 ≥2 个量级的规模变化。
3. **锚点量级**：本 VM 重测（五次运行区间）：

```text
collect=13.6-15.2us  outcomes=7.5-8.7us  diagnose=0.14-0.15us  bandit-build=0.6us
total in-slice CPU ~22.0-24.4us per full auto-adapt run
vs landing bar >=10000us  ->  411-455x below EVEN IF ZEROED
```

绝对值落在历史带内（R4-E 18.1–18.5µs < 本轮 22.0–24.4µs < R3-E
24.6–25.2µs < R5-E 28.1–28.9µs，纯 VM 差异），支配结论不变：落地线要求
数十~数百 ms 或复杂度类下降；本切片每 run 全部 CPU 合计 ~22–24µs，唯一的
ms 级余量在 I/O 行为上，而每一条 I/O 边都已被排除表点名保护（X0-3 保存
时机、S2-E-1/4 跳写、S1-G-1 readAll 事实源、S1-E-4/5 顺序追加与并行读、
S4-E-2 编排重叠、S5-E-5 惰性 import）。**锚点复核成立，该切片不存在不推翻
既有排除就能达门槛的候选。** 本轮第六组新角度（键值结构合一、正则单遍化、
匹配结果复用、写侧目录守卫、序列化格式）正是对「锚点之外还有没有面」的
再穷举——结论：没有（§2–§3）。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S6-E-1 | `collectSignalsFromEvents` 五个 per-task 路由 Map（model/role/family/modelVersion/featureVersion）合一为单 `Map<taskId, struct>` | 每 MODEL_ROUTED 2–5 次 Map.set → 1 次 set + 1 对象分配；每 TASK_RESULT 5 次 Map.get → 1 次 get + 属性读 | 廉价整体替换形式 ❌ **发散反例**：第二次 MODEL_ROUTED 省略 family/modelVersion 时，逐 Map keep-on-undefined 语义保留旧值，整体替换丢弃之（反例实测 family test→edit、modelVersion v1→undefined）。忠实 field-wise merge（`?? prev`）形式 ✅ 4000 fuzz 一致（含部分字段重路由构造；副本保真另验 4000） | 忠实形式副本对副本 E=41 **五次全正**（+617/+692/+632/+344/+267ns/run）——方向稳定；10× E=410 +4.2~+7.7µs | 淘汰：等价且方向稳定，但绝对量 ~0.3–0.7µs/run 距落地线（≥10ms）**4–5 个数量级**，占切片 CPU 锚点 ~2%，被同路径 `EventStore.readAll` ≥100µs 以 ~10²× 支配（验收标准第 3 条）；SLICE-CPU 锚点判定切片仍收口 |
| S6-E-2 | `scoreUserAnswer` USER_NEGATIVE→USER_POSITIVE 顺序双 test 合并为单遍组合正则 | 2×O(len) → 1×O(len) | 廉价单匹配形式 ❌ **发散反例**：现行语义是负向优先（两正则独立全文扫描，负向先判），组合正则取首**位置**匹配——`"lgtm but no"` 现行=10、廉价=90。忠实形式（matchAll + 任一负向捕获组即 10）✅ 6000 fuzz 一致 | 忠实形式**五次全部更慢 3–12×**（negative-early 23–27ns → 268–271ns；positive-only 36–50ns → 353–356ns；no-match 95–99ns → 266–271ns）——matchAll 迭代器 + 每调用 /g 正则构造开销（模块级 /g 即 X0-6 lastIndex 风险） | 淘汰：廉价形式不等价（优先级 vs 位置序反例在案）；忠实形式真实规模负优化（「小输入上重构固定开销高于线性重算」系列第九例）；且每 run 仅个位数次调用 |
| S6-E-3 | `updateProjectBandit` 每写 `mkdir(recursive)` 消除（存在性守卫或每进程一次提升） | 省一次目录 syscall | —（目录已存在时 mkdir 幂等，输出平凡等价；行为差异在外部清理场景） | 已存在目录上一次 mkdir 实测 **22.7–23.7µs/call**（五次稳定），占同函数锁内事务（~450µs，R2-E 锚点）**~5%**；每 run 恰一次 | 淘汰：S5-G-1 同型——守卫/提升后外部清理（用户删 state 目录）自愈能力换 ENOENT 崩溃或模块级状态（X1-1 域）；量级亚 ms 一次性，低于否决线（S2-E-1 的 409–716µs 同级已否决） |
| S6-E-4 | bandit.json `JSON.stringify(state, null, 2)` 换紧凑序列化 | 省 pretty-print 缩进遍历 | ❌ **字节发散**：磁盘文件 471B → 271B——bandit.json 是可观察数据面（R3-E S3-E-4 fuzz 已示范手工编辑该文件的边界场景，人读/手改是其使用面） | 序列化 delta **243–254ns/write**（五次稳定），占单次 writeFile（75.7µs）**0.33%**，占锁内全事务 ~0.06% | 淘汰：S4-G-6 同型（磁盘数据面字节发散）+ 深度亚噪声；写通格式归一是 S2-E-4 已裁决的锁内读-建-写持久化契约的一部分 |
| S6-E-5 | `collectSignalsFromSubagentRun` 的 `PEER_NEGATIVE.test` 与 `/unknown agent/i.test` 双扫描合并（复用首匹配判边界） | 2×O(len) → 1×O(len) | 廉价复用形式 ❌ **两个发散反例**：A）`"fail: unknown agent x"` 首匹配是 `fail`，复用判非 unknown-agent → boundary execution，现行=tool；B）`"xunknown agent"` + exitCode=1——PEER_NEGATIVE 的 `\b` 边界不匹配而裸 `/unknown agent/i` 匹配 → 现行=tool、复用=execution（两探针语义本就不同：一个词边界受限、一个裸子串） | 忠实形式必须保留第二次正则 test ⇒ **结构上零节省**；第二探针绝对成本实测 **24ns/failed-result** | 淘汰：不等价（两探针是不同语义的独立契约，非冗余）；忠实形式无收益可言；且仅 failed 分支求值、每 run 个位数次 |

另有四处以既有排除/裁决直接覆盖、不立新 ID：`runAutoAdaptLoop` 的
`signals.some(modelId)` 门与信号数组构造融合（跨函数/多消费者单遍化，
S1-E-6 融合系列 + S3-E-2 跨函数域，S≈12 上 some() 仅几十 ns）；
`persistSignals` 的 `hash32` id 键构造（非冗余计算不可消除，且 S1-E-4
同构被每信号 ~10²µs appendFeedback 支配）；`stableProjectKey` 归一化
正则微优化（现实路径 ~30 字符，S2-E-5 短输入流式教训直接覆盖）；
`outcomesFromRoutedRun` 的 `Date.parse` 按时间戳记忆化（X1-1 隐藏缓存域 +
每 run ~10 次 µs 级）。

## 3. 关键裁决细节

### 3.1 S6-E-1：本轮唯一方向稳定的等价候选为何仍不落地

五 Map 合一是前五轮未探过的键值结构角度（S5-E-4 探过的是 diagnostics 的
分组键，本候选是 signals 的路由绑定表）。廉价整体替换形式的反例揭示了
一个此前未成文的切片不变量：**五个条件 `Map.set` 共同实现了 per-field
keep-on-undefined 语义**——任务重路由时，第二个 MODEL_ROUTED 省略的可选
字段保留首路由的值（model/role 无条件覆盖，family/modelVersion/
featureVersion 条件保留）。整体替换把省略字段静默清空，TASK_RESULT 信号
的 family 回退到 `familyFromRole(role)`、modelVersion 丢失——绑定发散。
忠实形式（`payload.family ?? prev?.family` field-wise merge）严格等价
（4000 fuzz 含部分重路由构造逐位一致），且五次测量全正
（+267…+692ns/run @ E=41，+4.2…+7.7µs @ E=410）——这是本切片六轮以来
首个「等价 + 方向稳定 + 真实规模为正」的微观候选。但验收标准第 3 条明确：
落地线是数十~数百 ms，切片 CPU 仍 ~22–24µs 即收口。0.3–0.7µs/run 占落地线
~10⁻⁵、占同路径 readAll I/O（≥100µs）<1%，任何用户可感知面上均不可测。
为将来重开保留：若事件规模增长 ≥2 个量级（E≥4100，外推收益 ~60–80µs/run
仍不达线；需 ≥3 个量级才进入 ms 带），可凭本报告等价证据 + 忠实形式重开，
廉价整体替换形式因反例永久排除。

### 3.2 S6-E-2 / S6-E-5：双正则合并角度的两类反例（并收口该角度）

本切片共有三处「同文本多正则」形态，本轮以两个候选完成该角度的穷尽裁决：

- **优先级 vs 位置序**（S6-E-2）：`scoreUserAnswer` 的负向优先是行为契约
  （含负向词的混合回答必须判 10——「先否决」语义），组合正则的首位置匹配
  改变裁决顺序。忠实保留优先级需 matchAll 全扫 + 捕获组检查，实测慢
  3–12×且每调用需新建 /g 正则（模块级 /g 即 X0-6 的 lastIndex 状态风险，
  matchAll 按规格继承初始 lastIndex）。
- **词边界 vs 裸子串**（S6-E-5）：`PEER_NEGATIVE` 是 `\b` 词边界受限的
  多词负向表，`/unknown agent/i` 是裸子串探针——两者对 `"xunknown agent"`
  一类输入判定不同，这不是冗余扫描而是**两个独立语义的契约**（前者定分数、
  后者定边界归类）。首匹配复用还叠加「首匹配 ≠ 目标词」反例。忠实形式
  必须保留两次扫描，结构上零节省（第二探针仅 24ns 且只在 failed 分支）。

结合 S3-E-5（字面量提升 1–6ns）与 X0-6，本切片的正则面就此收口：**每条
正则各承载独立语义，无可合并冗余；对象级/扫描级微优化全部亚噪声。**

### 3.3 S6-E-3 / S6-E-4：G 区已裁决 I/O 同型在本切片边上的点名

前五轮把本切片的 I/O 契约边逐一点名（保存时机、跳写、readAll、顺序追加、
编排重叠、惰性 import），本轮补上最后两条未点名的 in-slice I/O 微观边：
`updateProjectBandit` 的每写 `mkdir(recursive)`（S5-G-1 同型：22.7–23.7µs
换外部清理自愈能力，且在 ~450µs 锁事务内占比 5%）与 bandit.json 的
pretty JSON（S4-G-6 同型：磁盘字节是数据面，序列化 delta 仅占写盘 0.33%）。
两者均为「G 区已否决模式在 E 区的镜像」，立 ID 防将来跨区重提。至此本切片
**全部 I/O 行为边都有点名排除**：X0-3 / S2-E-1 / S2-E-4 / S1-G-1 /
S1-E-4 / S1-E-5 / S4-E-2 / S5-E-5 / S6-E-3 / S6-E-4。

## 4. 逐文件收口（前五轮收口之上的本轮新检查点）

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `signals.ts` | S6-E-1（五 Map 合一，含 keep-on-undefined 反例）、S6-E-2（双正则合并）、S6-E-5（匹配复用）淘汰；S1-E-1/2/3、S2-E-5/7、S3-E-1/5、S4-E-1/3、S5-E-2/3 维持 | 无候选 |
| `auto-loop.ts` | `signals.some(modelId)` 门融合不立 ID（§2 尾注）；`hash32` id 键构造不立 ID；S1-E-4/5、S2-E-1、S3-E-2、S4-E-2、S5-E-1/5 维持 | 无候选 |
| `from-episode.ts` | `Date.parse` 记忆化不立 ID（X1-1 域）；调用图复核 `adapt learn` 独立命令无双读；S2-E-2 维持 | 无候选 |
| `bandit-store.ts` | S6-E-3（每写 mkdir 消除）淘汰并立 22.7–23.7µs 锚点；S6-E-4（紧凑序列化）淘汰并立字节发散反例；S2-E-3/4、S3-E-4、X1-2 维持 | 无候选 |
| `diagnostics.ts` | 无第六组新角度（键结构 S5-E-4、融合 S1-E-6、冗余 set S3-E-3 已穷尽该文件）；恒真守卫维持 | 无候选 |
| `learned-routing.ts` | `stableProjectKey` 归一化微优化不立 ID（S2-E-5 短输入教训覆盖）；live 面 S2-E-6、X1-1、Iter4 M≤10 维持 | 无候选 |
| `patterns.ts` / `attribution.ts` / `signatures.ts` | 本轮交叉检索复核仍零生产调用方；X2-6、S1-E-7/8 维持 | 无候选 |
| `task-success.ts` | S2-E-7 维持；`copyDefinedBinding`+`present()` 空白字段契约实施点不动 | 无候选 |

## 5. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 6. 测试

零代码改动下切片相关套件基线复核，全绿（Node 22.22.2 / pnpm 10.17.1）：

```bash
npx tsx --test "test/unit/learning/*.test.ts" "test/acceptance/adaptive-loop.test.ts"
# tests 48 / suites 2 / pass 48 / fail 0
```

仿真（临时脚本 `/tmp/r6e-sim.mts`，未入库以遵守「无赢家不提交败者仿真」；
完整源码见附录，seeds `0xe66e01`–`0xe66e08`）共 **6 次独立运行**（第 6 次从
本报告附录原文提取后复现），>20,000 项等价检查/次全部通过、等价结论与三组
反例逐位一致。代表性一次运行：

```text
S6-E-1 naive counterexample: current binds family=test modelVersion=v1; naive merged-struct binds family=edit modelVersion=undefined -> NOT equivalent
S6-E-1 bench E=41 (replica-vs-replica): current=11321ns cand=10704ns delta=617ns/run
S6-E-1 bench 10x E=410 (replica-vs-replica): current=134076ns cand=127732ns delta=6344ns/run
S6-E-2 cheap counterexample: "lgtm but no" current=10 cheap-combined=90 -> NOT equivalent (faithful=10)
S6-E-2 bench negative-early: current=23ns faithful-combined=270ns (0.08x)
S6-E-2 bench positive-only: current=50ns faithful-combined=356ns (0.14x)
S6-E-2 bench no-match: current=96ns faithful-combined=267ns (0.36x)
S6-E-5 cheap counterexamples: A current boundary=tool cheap=execution; B current boundary=tool cheap=execution -> NOT equivalent
S6-E-5 faithful-form anchor: the second /unknown agent/i test costs 24ns per failed result (faithful merge saves nothing structurally)
S6-E-3 anchor: one mkdir(recursive) on an existing dir=22.7us per updateProjectBandit call (in-lock transaction ~450us, R2-E anchor; self-heal after external cleanup is the behavior at stake)
S6-E-4 anchor: pretty=922ns compact=671ns delta=251ns/write; bytes 471 -> 271 (on-disk data plane diverges; S4-G-6 family)
S6-E-4 context: one bandit.json writeFile=75.7us (serialization delta is 0.33% of the write alone)
SLICE-CPU anchor re-verify: collect=13.6us outcomes=7.5us diagnose=0.14us bandit-build=0.6us | total in-slice CPU ~22.0us per run vs landing bar >=10000us (455x below even if zeroed)

ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

计时方向跨 6 次运行汇总：S6-E-1 忠实形式 E=41 delta **六次全正**
（+617/+692/+632/+344/+267/+619ns/run）、E=410 全正（+6344/+7731/+6309/
+4186/+4309/+6188ns）——方向稳定但量级距落地线 4–5 个数量级；S6-E-2 忠实
形式三种输入分布**五次全部更慢**（0.08–0.37×）；S6-E-3 锚点
22.7/23.7/23.6/23.0/23.1µs 稳定；S6-E-4 delta 251/254/252/254/243ns 稳定；
三组反例（S6-E-1 部分重路由、S6-E-2 "lgtm but no"、S6-E-5 A/B）六次逐位
一致；SLICE-CPU 总量 22.0/22.0/22.1/24.4/24.3/22.2µs 稳定。

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S6-E-1 | collectSignalsFromEvents 五个 per-task 路由 Map 合一为单 struct Map | 廉价整体替换不等价：部分字段重路由丢 keep-on-undefined 绑定（反例在案）；忠实 field-wise merge 等价且五次方向稳定，但仅 +0.3–0.7µs/run，距落地线 4–5 个数量级、被同路径 readAll ≥100µs 支配 |
| S6-E-2 | scoreUserAnswer 双正则合并单遍组合正则 | 廉价单匹配不等价：负向优先 vs 首位置匹配（"lgtm but no" 反例）；忠实 matchAll 形式实测慢 3–12×（小输入重构系列第九例）+ 每调用 /g 构造（模块级即 X0-6 风险） |
| S6-E-3 | updateProjectBandit 每写 mkdir(recursive) 消除/提升 | S5-G-1 同型：外部清理自愈换 ENOENT 或模块级状态（X1-1 域）；22.7–23.7µs/call 占锁内事务 ~5%，亚 ms 一次性低于否决线 |
| S6-E-4 | bandit.json 紧凑序列化（去 pretty-print） | S4-G-6 同型：磁盘数据面字节发散（471B→271B，人读/手改面）；序列化 delta 243–254ns 仅占单次写盘 0.33%；写通格式归一属 S2-E-4 已裁决契约 |
| S6-E-5 | collectSignalsFromSubagentRun PEER_NEGATIVE 与 /unknown agent/i 双扫描合并（首匹配复用） | 不等价：两探针语义独立（\b 词边界表 vs 裸子串），A/B 两个发散反例在案；忠实形式必须保留第二探针 ⇒ 结构上零节省（探针仅 24ns，failed 分支每 run 个位数次） |

重开条件：S6-E-1 需事件规模增长 ≥3 个量级（外推 E≥4100 时收益仍仅
~60–80µs/run）且必须采用忠实 field-wise merge 形式（整体替换因反例永久
排除）——等价证据本报告在案；S6-E-2 需先把负向优先语义正式改为位置序契约
（行为变更立项，非优化）；S6-E-3 需 bandit 事务离开文件锁 I/O 面且外部
清理自愈契约被正式放宽；S6-E-4 需 bandit.json 被正式声明为非人读数据面
（含手工编辑场景迁移）；S6-E-5 需两探针先统一语义（词边界规则合并立项）。
切片级重开总条件维持 R3-E §7 / R4-E §7 / R5-E §7：SLICE-CPU 锚点失效
（全切片 CPU 增长 ≥2 个量级，本轮复核值 22.0–24.4µs）或任一 I/O 契约排除
（X0-3 / S2-E-1/4 / S1-G-1 / S1-E-4/5 / S4-E-2 / S5-E-5 / S6-E-3/4）被
正式推翻。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.mts` 后在仓库根目录 `npx tsx <file>`（依赖已装）。
seeds：`0xe66e01`–`0xe66e08`。

```ts
/**
 * R6-E deterministic equivalence + benchmark simulation (sixth pass over
 * src/learning/). Adjudicates fresh candidates S6-E-1 .. S6-E-5 against the
 * current implementations and re-verifies the R3-E/R4-E/R5-E SLICE-CPU anchor.
 * Seeded PRNG (mulberry32) -> fully reproducible. Seeds: 0xe66e01 - 0xe66e08.
 *
 * Reference = production imports (equivalence role + absolute-magnitude
 * anchors). ns-delta benchmarks are replica-vs-replica per the S3-E-3
 * methodology lesson; tens-of-ns deltas need >=5 independent runs per the
 * S3-E-4 lesson. Replicas keep every already-excluded edit UNAPPLIED
 * (independent if-chains, judge double-get, ctx literal per event, ...).
 */
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
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
import { diagnoseModelProjectIssues } from "/workspace/src/learning/diagnostics.js";
import { outcomesFromRoutedRun } from "/workspace/src/learning/from-episode.js";
import { createBanditState, recordReward, type BanditState } from "/workspace/src/routing/bandit.js";
import { oneHotDistribution } from "/workspace/src/routing/catalog-model.js";
import { AGENT_ROLES } from "/workspace/src/domain/roles.js";
import type { EpisodeId, ProjectId } from "/workspace/src/domain/ids.js";
import type { Event } from "/workspace/src/run/events.js";
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
async function benchAsync(fn: () => Promise<void>, reps: number): Promise<number> {
  await fn();
  const t0 = performance.now();
  for (let i = 0; i < reps; i += 1) await fn();
  return (performance.now() - t0) / reps;
}
/** createdAt is nowIso() captured per call; normalize for cross-call compare. */
function norm(signals: readonly ObservedSignal[]): string {
  return JSON.stringify(signals.map((s) => ({ ...s, createdAt: "T" })));
}

/* ================================================================
 * Verbatim private-helper replicas from src/learning/signals.ts.
 * ================================================================ */
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
function baseSignal(input: {
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
}): ObservedSignal {
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
type FiveMapCtx = {
  projectId: ProjectId;
  modelByTask: ReadonlyMap<string, string>;
  modelVersionByTask: ReadonlyMap<string, string>;
  roleByTask: ReadonlyMap<string, string>;
  familyByTask: ReadonlyMap<string, string>;
  featureVersionByTask: ReadonlyMap<string, string>;
  episodeId?: EpisodeId | undefined;
  createdAt: IsoTimestamp;
};
function signalFromAgentMessage(message: AgentMessage, ctx: FiveMapCtx): ObservedSignal | undefined {
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

/** Verbatim replica of collectSignalsFromEvents (five per-task Maps).
 *  All excluded edits UNAPPLIED: independent if-chain, judge double-get,
 *  per-event ctx literal. Fair same-module baseline for the bench. */
function replicaCollectCurrent(events: readonly Event[], context: SignalContext = {}): ObservedSignal[] {
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
      if (event.payload.family !== undefined) {
        familyByTask.set(event.payload.taskId, event.payload.family);
      }
      if (event.payload.modelVersion !== undefined) {
        modelVersionByTask.set(event.payload.taskId, event.payload.modelVersion);
      }
      if (event.payload.featureVersion !== undefined) {
        featureVersionByTask.set(event.payload.taskId, event.payload.featureVersion);
      }
    }
  }
  if (projectId === undefined) return [];

  for (const event of events) {
    if (event.type === "CHILD_MESSAGE") {
      const message = event.payload.message;
      const fromResult = signalFromAgentMessage(message, {
        projectId,
        modelByTask,
        modelVersionByTask,
        roleByTask,
        familyByTask,
        featureVersionByTask,
        episodeId: context.episodeId,
        createdAt
      });
      if (fromResult !== undefined) signals.push(fromResult);
    }
    if (event.type === "USER_ANSWER") {
      const score = scoreUserAnswer(event.payload.answer);
      if (score === undefined) continue;
      signals.push(
        baseSignal({
          source: "user", kind: "human", projectId, score,
          criterion: "userAcceptance", outcomeKind: score >= 50 ? "PASS" : "FAIL",
          boundary: "review", summary: truncate(`user: ${event.payload.answer}`),
          createdAt, episodeId: context.episodeId, runId: event.runId
        })
      );
    }
    if (event.type === "JUDGE_DECISION") {
      const score = event.payload.verdict === "APPROVED" ? 85 : event.payload.verdict === "REJECTED" ? 20 : 50;
      const modelId = modelByTask.get(event.payload.taskId);
      signals.push(
        baseSignal({
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
        })
      );
    }
    if (event.type === "RUN_FAILED") {
      signals.push(
        baseSignal({
          source: "deterministic", kind: "deterministic", projectId, score: 10,
          boundary: "execution", summary: truncate(`run failed: ${event.payload.reason}`),
          createdAt, episodeId: context.episodeId, runId: event.runId
        })
      );
    }
  }
  return signals;
}

/* ================================================================
 * S6-E-1 candidate: consolidate the five per-task route Maps into one
 * Map<taskId, RouteBinding>.
 *  (a) NAIVE form: MODEL_ROUTED replaces the whole struct -> must diverge
 *      on a partial re-route (second MODEL_ROUTED omitting family etc.).
 *  (b) FAITHFUL form: field-wise merge (`?? prev`) preserves the per-Map
 *      keep-on-undefined semantics. Judge double-get kept verbatim in shape.
 * ================================================================ */
interface RouteBindingStruct {
  model: string;
  role: string;
  family: string | undefined;
  modelVersion: string | undefined;
  featureVersion: string | undefined;
}
type MergedCtx = {
  projectId: ProjectId;
  routeByTask: ReadonlyMap<string, RouteBindingStruct>;
  episodeId?: EpisodeId | undefined;
  createdAt: IsoTimestamp;
};
function signalFromAgentMessageMerged(message: AgentMessage, ctx: MergedCtx): ObservedSignal | undefined {
  if (message.type === "TASK_RESULT") {
    const route = ctx.routeByTask.get(message.taskId);
    const modelId = route?.model;
    const role = route?.role;
    const family = route?.family ?? familyFromRole(role);
    const modelVersion = route?.modelVersion;
    const featureVersion = route?.featureVersion;
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
    const modelId = ctx.routeByTask.get(message.taskId)?.model;
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
function candidateCollectMerged(
  events: readonly Event[],
  context: SignalContext = {},
  naive = false
): ObservedSignal[] {
  let projectId = context.projectId;
  const routeByTask = new Map<string, RouteBindingStruct>();
  const signals: ObservedSignal[] = [];
  const createdAt = nowIso();

  for (const event of events) {
    if (event.type === "PROJECT_DISCOVERED") {
      const id = event.payload.project.id;
      projectId = id;
    }
    if (event.type === "MODEL_ROUTED") {
      const payload = event.payload;
      if (naive) {
        // (a) NAIVE: whole-struct replacement (drops fields the second route omits)
        routeByTask.set(payload.taskId, {
          model: payload.model,
          role: payload.role,
          family: payload.family,
          modelVersion: payload.modelVersion,
          featureVersion: payload.featureVersion
        });
      } else {
        // (b) FAITHFUL: field-wise merge preserving keep-on-undefined
        const prev = routeByTask.get(payload.taskId);
        routeByTask.set(payload.taskId, {
          model: payload.model,
          role: payload.role,
          family: payload.family ?? prev?.family,
          modelVersion: payload.modelVersion ?? prev?.modelVersion,
          featureVersion: payload.featureVersion ?? prev?.featureVersion
        });
      }
    }
  }
  if (projectId === undefined) return [];

  for (const event of events) {
    if (event.type === "CHILD_MESSAGE") {
      const message = event.payload.message;
      const fromResult = signalFromAgentMessageMerged(message, {
        projectId,
        routeByTask,
        episodeId: context.episodeId,
        createdAt
      });
      if (fromResult !== undefined) signals.push(fromResult);
    }
    if (event.type === "USER_ANSWER") {
      const score = scoreUserAnswer(event.payload.answer);
      if (score === undefined) continue;
      signals.push(
        baseSignal({
          source: "user", kind: "human", projectId, score,
          criterion: "userAcceptance", outcomeKind: score >= 50 ? "PASS" : "FAIL",
          boundary: "review", summary: truncate(`user: ${event.payload.answer}`),
          createdAt, episodeId: context.episodeId, runId: event.runId
        })
      );
    }
    if (event.type === "JUDGE_DECISION") {
      const score = event.payload.verdict === "APPROVED" ? 85 : event.payload.verdict === "REJECTED" ? 20 : 50;
      const modelId = routeByTask.get(event.payload.taskId)?.model;
      signals.push(
        baseSignal({
          source: "deterministic", kind: "judge", projectId, score,
          criterion: "policyCompliance",
          outcomeKind:
            event.payload.verdict === "APPROVED" ? "PASS" : event.payload.verdict === "REJECTED" ? "FAIL" : "ABSTAIN",
          boundary: "review", summary: `judge ${event.payload.verdict}`,
          createdAt, episodeId: context.episodeId, runId: event.runId,
          taskId: event.payload.taskId, evidenceIds: event.payload.evidenceIds,
          ...(modelId !== undefined ? { modelId } : {}),
          // double-get shape kept verbatim (S1-E-2 excluded edit NOT applied):
          ...(routeByTask.get(event.payload.taskId)?.role !== undefined
            ? { role: routeByTask.get(event.payload.taskId)?.role }
            : {}),
          ...(routeByTask.get(event.payload.taskId)?.family !== undefined
            ? { family: routeByTask.get(event.payload.taskId)?.family }
            : {})
        })
      );
    }
    if (event.type === "RUN_FAILED") {
      signals.push(
        baseSignal({
          source: "deterministic", kind: "deterministic", projectId, score: 10,
          boundary: "execution", summary: truncate(`run failed: ${event.payload.reason}`),
          createdAt, episodeId: context.episodeId, runId: event.runId
        })
      );
    }
  }
  return signals;
}

/* Seeded event-log generator (R1-A composition: E~41), extended with
 * partial re-routes (second MODEL_ROUTED omitting optional fields) so the
 * fuzz exercises the keep-on-undefined per-Map semantics. */
const OUTCOMES: readonly TaskOutcome[] = ["SUCCESS", "PARTIAL", "FAILURE", "CANCELLED"];
const VERIFS: readonly VerificationKind[] = ["PASSED", "FAILED", "UNOBSERVED"];
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
          ...(rng() < 0.7 ? { family: pick(rng, FAMS) } : {}),
          ...(rng() < 0.7 ? { modelVersion: pick(rng, ["v1", "v2"]) } : {}),
          ...(rng() < 0.7 ? { featureVersion: "fv1" } : {})
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
  // S6-E-1 (a): NAIVE whole-struct replacement must diverge on a partial re-route.
  const reroute: Event[] = [
    { type: "PROJECT_DISCOVERED", payload: { project: { id: "prj_simsim01", rootPath: "/tmp/x" } } },
    {
      type: "MODEL_ROUTED",
      payload: { taskId: "tsk_10000000", model: "modelA", role: "planner", family: "test", modelVersion: "v1", featureVersion: "fv1" }
    },
    {
      // partial re-route: model/role only; family/modelVersion/featureVersion omitted
      type: "MODEL_ROUTED",
      payload: { taskId: "tsk_10000000", model: "modelB", role: "actor" }
    },
    {
      type: "CHILD_MESSAGE",
      payload: {
        message: {
          type: "TASK_RESULT", taskId: "tsk_10000000", runId: "run_simsim01",
          outcome: "SUCCESS", verification: { kind: "PASSED" }, summary: "ok", evidenceIds: []
        }
      }
    }
  ] as unknown as Event[];
  const cur = collectSignalsFromEvents(reroute);
  const naive = candidateCollectMerged(reroute, {}, true);
  const faithful = candidateCollectMerged(reroute, {}, false);
  check(
    "S6-E-1 naive counterexample must diverge (family/modelVersion lost on partial re-route)",
    cur[0]?.family === "test" && cur[0]?.modelVersion === "v1" &&
      naive[0]?.family === "edit" && naive[0]?.modelVersion === undefined
  );
  check("S6-E-1 faithful form keeps counterexample intact", norm([faithful[0]!]) === norm([cur[0]!]));
  console.log(
    `S6-E-1 naive counterexample: current binds family=${cur[0]?.family} modelVersion=${cur[0]?.modelVersion}; naive merged-struct binds family=${naive[0]?.family} modelVersion=${String(naive[0]?.modelVersion)} -> NOT equivalent`
  );

  // S6-E-1 (b): FAITHFUL field-wise merge fuzz + replica fidelity.
  const rng = mulberry32(0xe66e01);
  for (let trial = 0; trial < 4000; trial += 1) {
    const events = genEvents(rng, Math.floor(rng() * 60), { forceProject: rng() < 0.9 });
    const ctx: SignalContext = rng() < 0.5 ? { episodeId: "ep_simsim01" as EpisodeId } : {};
    const expected = norm(collectSignalsFromEvents(events, ctx));
    check("S6-E-1 faithful equivalence (merged route Map)", expected === norm(candidateCollectMerged(events, ctx)), `trial ${trial}`);
    check("S6-E-1 replica fidelity (verbatim copy == production)", expected === norm(replicaCollectCurrent(events, ctx)), `trial ${trial}`);
  }
  const events = genEvents(mulberry32(0xe66e02), 40);
  const cur41 = bench(() => replicaCollectCurrent(events, {}), 20000);
  const cand41 = bench(() => candidateCollectMerged(events, {}), 20000);
  console.log(
    `S6-E-1 bench E=41 (replica-vs-replica): current=${(cur41 * 1e6).toFixed(0)}ns cand=${(cand41 * 1e6).toFixed(0)}ns delta=${((cur41 - cand41) * 1e6).toFixed(0)}ns/run`
  );
  const events410 = genEvents(mulberry32(0xe66e02), 409);
  const cur410 = bench(() => replicaCollectCurrent(events410, {}), 2000);
  const cand410 = bench(() => candidateCollectMerged(events410, {}), 2000);
  console.log(
    `S6-E-1 bench 10x E=410 (replica-vs-replica): current=${(cur410 * 1e6).toFixed(0)}ns cand=${(cand410 * 1e6).toFixed(0)}ns delta=${((cur410 - cand410) * 1e6).toFixed(0)}ns/run`
  );
}

/* ================================================================
 * S6-E-2 candidate: scoreUserAnswer's two sequential regex tests merged
 * into one combined-alternation scan.
 *  (a) CHEAP form: first positional match decides -> must diverge on
 *      "lgtm but no" (positive appears first, negative-precedence says 10).
 *  (b) FAITHFUL form: matchAll over a combined /g regex, any-negative wins
 *      -> equivalent but full scan + per-call allocation; bench it.
 * ================================================================ */
const USER_NEGATIVE = /\b(no|wrong|revert|reject|bad|不行|错误)\b/i;
const USER_POSITIVE = /\b(lgtm|good|ship|approve|yes|可以)\b/i;
function replicaScoreUserAnswer(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  if (USER_NEGATIVE.test(trimmed)) return 10;
  if (USER_POSITIVE.test(trimmed)) return 90;
  return undefined;
}
function cheapCombinedScore(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  // first positional match decides (combined single-match regex)
  const m = /\b(?:(?<neg>no|wrong|revert|reject|bad|不行|错误)|(?<pos>lgtm|good|ship|approve|yes|可以))\b/i.exec(trimmed);
  if (m === null) return undefined;
  return m.groups?.neg !== undefined ? 10 : 90;
}
function faithfulCombinedScore(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  // fresh /g regex per call (module-level /g would carry X0-6 lastIndex hazard)
  const combined = /\b(?:(?<neg>no|wrong|revert|reject|bad|不行|错误)|(?<pos>lgtm|good|ship|approve|yes|可以))\b/gi;
  let sawPositive = false;
  for (const m of trimmed.matchAll(combined)) {
    if (m.groups?.neg !== undefined) return 10; // negative precedence preserved
    sawPositive = true;
  }
  return sawPositive ? 90 : undefined;
}
{
  const ce = "lgtm but no";
  check(
    "S6-E-2 cheap counterexample must diverge (negative precedence vs first positional match)",
    replicaScoreUserAnswer(ce) === 10 && cheapCombinedScore(ce) === 90 && faithfulCombinedScore(ce) === 10
  );
  console.log(
    `S6-E-2 cheap counterexample: "lgtm but no" current=${replicaScoreUserAnswer(ce)} cheap-combined=${cheapCombinedScore(ce)} -> NOT equivalent (faithful=${faithfulCombinedScore(ce)})`
  );
  const rng = mulberry32(0xe66e03);
  const words = ["no", "wrong", "revert", "reject", "bad", "不行", "错误", "lgtm", "good", "ship", "approve", "yes", "可以", "notaword", "goodness", "shipment", "the", "fix", "", "  "];
  for (let trial = 0; trial < 6000; trial += 1) {
    const n = Math.floor(rng() * 8);
    const text = Array.from({ length: n }, () => pick(rng, words)).join(pick(rng, [" ", ", ", "-", ""]));
    check(
      "S6-E-2 faithful equivalence (combined matchAll)",
      replicaScoreUserAnswer(text) === faithfulCombinedScore(text),
      JSON.stringify(text)
    );
    check(
      "S6-E-2 replica fidelity",
      replicaScoreUserAnswer(text) === scoreUserAnswer(text),
      JSON.stringify(text)
    );
  }
  for (const [label, text] of [["negative-early", "no thanks"], ["positive-only", "lgtm ship it"], ["no-match", "please also add more coverage here"]] as const) {
    const cur = bench(() => void replicaScoreUserAnswer(text), 200000);
    const cand = bench(() => void faithfulCombinedScore(text), 200000);
    console.log(
      `S6-E-2 bench ${label}: current=${(cur * 1e6).toFixed(0)}ns faithful-combined=${(cand * 1e6).toFixed(0)}ns (${(cur / cand).toFixed(2)}x)`
    );
  }
}

/* ================================================================
 * S6-E-5 candidate: collectSignalsFromSubagentRun's PEER_NEGATIVE test and
 * /unknown agent/i boundary re-test merged into one scan.
 *  (a) CHEAP form: reuse PEER_NEGATIVE's first match to decide the boundary
 *      -> two counterexamples:
 *      A: "fail: unknown agent x" (first match is "fail", boundary must be tool)
 *      B: "xunknown agent" + exitCode=1 (PEER_NEGATIVE \b misses, plain
 *         /unknown agent/i hits -> boundary tool; cheap reuse says execution)
 *  (b) FAITHFUL form: still needs the second regex -> zero structural saving;
 *      anchor the second test's absolute cost.
 * ================================================================ */
{
  const ctx: SignalContext = { projectId: "prj_simsim01" as ProjectId };
  const mkRun = (text: string, exitCode: number): unknown => ({
    status: "completed",
    request: { agent: "implementer" },
    results: [
      {
        agent: "implementer",
        exitCode,
        messages: [
          { role: "assistant", model: "m1", content: [{ type: "text", text }] }
        ]
      }
    ]
  });
  const cheapBoundary = (text: string, exitCode: number, status: string): string => {
    const m = PEER_NEGATIVE.exec(text);
    const failed = status === "failed" || status === "error" || exitCode === 1 || m !== null;
    return failed && m !== null && m[0]!.toLowerCase() === "unknown agent" ? "tool" : "execution";
  };
  const caseA = "fail: unknown agent x";
  const prodA = collectSignalsFromSubagentRun(mkRun(caseA, 0), ctx)[0]!;
  check(
    "S6-E-5 cheap counterexample A must diverge (first PEER_NEGATIVE match is not the boundary probe)",
    prodA.boundary === "tool" && cheapBoundary(caseA, 0, "completed") === "execution"
  );
  const caseB = "xunknown agent said hi";
  const prodB = collectSignalsFromSubagentRun(mkRun(caseB, 1), ctx)[0]!;
  check(
    "S6-E-5 cheap counterexample B must diverge (\\b-bounded PEER_NEGATIVE misses what the plain probe hits)",
    prodB.boundary === "tool" && cheapBoundary(caseB, 1, "completed") === "execution"
  );
  console.log(
    `S6-E-5 cheap counterexamples: A current boundary=${prodA.boundary} cheap=execution; B current boundary=${prodB.boundary} cheap=execution -> NOT equivalent`
  );
  const text = "fail: unknown agent x " + "step ok ".repeat(10);
  const probeCost = bench(() => void /unknown agent/i.test(text), 200000);
  console.log(
    `S6-E-5 faithful-form anchor: the second /unknown agent/i test costs ${(probeCost * 1e6).toFixed(0)}ns per failed result (faithful merge saves nothing structurally)`
  );
}

/* ================================================================
 * S6-E-3 anchor: updateProjectBandit's per-write mkdir(recursive) on an
 * already-existing directory (S5-G-1 same type, in-slice edge). Measure the
 * syscall the guard/hoist would skip vs the ~450us in-lock transaction.
 * ================================================================ */
{
  const root = await mkdtemp(join(tmpdir(), "r6e-mkdir-"));
  const dir = join(root, "adaptation", "learning", "projects", "p12345678");
  await mkdir(dir, { recursive: true });
  const mkdirCost = await benchAsync(async () => {
    await mkdir(dir, { recursive: true });
  }, 2000);
  console.log(
    `S6-E-3 anchor: one mkdir(recursive) on an existing dir=${(mkdirCost * 1e3).toFixed(1)}us per updateProjectBandit call (in-lock transaction ~450us, R2-E anchor; self-heal after external cleanup is the behavior at stake)`
  );
  void dirname;
}

/* ================================================================
 * S6-E-4 anchor: bandit.json compact vs pretty serialization (S4-G-6 same
 * type, in-slice edge). Byte divergence shown; measure the delta.
 * ================================================================ */
function buildBanditState(models: readonly string[], rng: () => number): BanditState {
  let state = createBanditState([...models]);
  for (let i = 0; i < 30; i += 1) {
    state = recordReward(state, pick(rng, models), rng() < 0.5 ? 1 : 0);
  }
  return state;
}
{
  const rng = mulberry32(0xe66e04);
  const models10 = Array.from({ length: 10 }, (_, i) => `m${i}`);
  const state = buildBanditState(models10, rng);
  const pretty = `${JSON.stringify(state, null, 2)}\n`;
  const compact = `${JSON.stringify(state)}\n`;
  check("S6-E-4 byte divergence (compact != pretty on-disk bytes)", pretty !== compact);
  const prettyCost = bench(() => void JSON.stringify(state, null, 2), 100000);
  const compactCost = bench(() => void JSON.stringify(state), 100000);
  console.log(
    `S6-E-4 anchor: pretty=${(prettyCost * 1e6).toFixed(0)}ns compact=${(compactCost * 1e6).toFixed(0)}ns delta=${((prettyCost - compactCost) * 1e6).toFixed(0)}ns/write; bytes ${pretty.length} -> ${compact.length} (on-disk data plane diverges; S4-G-6 family)`
  );
  // write anchor: full pretty write cost for context
  const root = await mkdtemp(join(tmpdir(), "r6e-bandit-"));
  const path = join(root, "bandit.json");
  const writeCost = await benchAsync(async () => {
    await writeFile(path, pretty, "utf8");
  }, 500);
  console.log(
    `S6-E-4 context: one bandit.json writeFile=${(writeCost * 1e3).toFixed(1)}us (serialization delta is ${(((prettyCost - compactCost) / writeCost) * 100).toFixed(2)}% of the write alone)`
  );
}

/* ================================================================
 * SLICE-CPU anchor re-verify (R3-E/R4-E/R5-E): total in-slice CPU on one
 * full auto-adapt run at real scale vs the landing bar (>=10ms).
 * ================================================================ */
function genSignal(rng: () => number): ObservedSignal {
  const criterion = pick(rng, ["taskSuccess", "userAcceptance", "policyCompliance", undefined] as const);
  return {
    source: pick(rng, ["user", "subagent", "deterministic"] as const),
    kind: pick(rng, ["human", "peer", "judge", "deterministic"] as const),
    projectId: pick(rng, ["prj_a0000000", "prj_b0000000"]) as ProjectId,
    score: rng() < 0.5 ? Math.floor(rng() * 101) : Number((rng() * 100).toFixed(3)),
    boundary: "execution",
    summary: "s",
    createdAt: "2026-08-24T00:00:00.000Z" as IsoTimestamp,
    evidenceIds: [],
    ...(rng() < 0.85 ? { modelId: pick(rng, ["m1", "m2", "m3", "  ", ""]) } : {}),
    ...(criterion !== undefined ? { criterion } : {}),
    ...(rng() < 0.7 ? { family: pick(rng, FAMS) } : {}),
    ...(rng() < 0.8 ? { outcomeKind: pick(rng, ["PASS", "FAIL", "ABSTAIN"] as const) } : {})
  };
}
function currentBanditBuild(previous: BanditState | undefined, signals: readonly ObservedSignal[]): BanditState {
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
  const events = genEvents(mulberry32(0xe66e05), 40);
  const collectCost = bench(() => collectSignalsFromEvents(events, {}), 20000);

  const NOW = "2026-08-24T05:00:00.000Z" as IsoTimestamp;
  const FAMILIES_LOCAL: readonly TaskFamily[] = ["edit", "test", "review", "plan", "research", "refactor", "deploy", "unknown"];
  const rng = mulberry32(0xe66e06);
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

  const sRng = mulberry32(0xe66e07);
  const signals12 = Array.from({ length: 12 }, () => genSignal(sRng));
  const diagnoseCost = bench(() => void diagnoseModelProjectIssues(signals12), 40000);

  const bRng = mulberry32(0xe66e08);
  const models10 = Array.from({ length: 10 }, (_, i) => `m${i}`);
  const previous = currentBanditBuild(undefined, Array.from({ length: 30 }, () => genSignal(bRng)));
  const banditSignals = Array.from({ length: 12 }, () => genSignal(bRng));
  const banditCost = bench(() => void currentBanditBuild(previous, banditSignals), 40000);
  void models10;

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
