MODEL_SLUG=claude-fable-5-thinking-xhigh

# R5-E：`src/learning/` 第五遍复查报告（Round 5）

**战役:** 全库持久 SOTA 优化 Round 5 / R5-E
**基线:** `cursor/sota-persistent-opt-83a1` @ `c228dbe`
**分支:** `cursor/r5-e-learning-fifth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动；R3-E/R4-E 的切片级收口锚点复核成立。**
切片 10 个文件（1770 行）自 R1-E 基线（`adb20d7`）经 R2-E、R3-E、R4-E 至本轮
基线（`c228dbe`）**逐字节未变**（`git diff adb20d7..c228dbe -- src/learning/`
为空，期间无任何提交触及该目录）；`cb65c81..c228dbe` 间全库仅两处 src 变更
（S4-C @ `routing/lin-alg.ts`、S4-I @ `cli/main.ts` + `pi-adapter/auth-session.ts`
惰性 Pi 运行时加载），均不新增本切片热路径、不改变其调用频率或输入规模。
R1-E 逐文件收口、R2-E/R3-E/R4-E 复查与 S1-E-1..8 / S2-E-1..7 / S3-E-1..5 /
S4-E-1..3 共 23 项排除全部继承有效；生产调用面交叉检索复核未变（post-run
自适应环 `runAutoAdaptLoop` @ `cli/main:790` / `track/loop:172` / `cli/adapt:205`、
`runAutoAdaptFromEvents` @ `cli/adapt:188`、`proposeRoutingFromRoutedEvents` @
`cli/adapt:168` + live 装配面 `applyLearnedRouting` @ `routing/assign:102` /
`run/flowchart-run:681`、`loadLearnedRouting` @ `cli/main:715` / `track/loop:88` /
`run/flowchart-run:712`；`patterns` / `attribution` / `signatures` 仍无任何生产
调用方，仅测试使用）。**SLICE-CPU 总量上界锚点经本轮实测复核成立**：一次完整
auto-adapt run 的全切片 CPU 合计 **28.1–28.9µs**（本 VM 慢于 R4-E 的
18.1–18.5µs、与 R3-E 的 24.6–25.2µs 同带，纯 VM 差异）——距落地线（≥10ms）
**约 346–356×**，即使把切片 CPU 清零也远不达门槛。本轮在完整排除表之上以
第五组新角度枚举（事件表反向早退、循环不变对象提升、双重构造合一、分组键
数据结构替换、切片内模块子树惰性加载），得到 5 个此前未点名的新候选
（S5-E-1 … S5-E-5），全部经理论 + 确定性仿真（seeded mulberry32，>26,000 项
等价检查/次 × 5 次独立运行，等价结论逐位一致；ns 级基准按 S3-E-3 方法论
副本对副本、按 S3-E-4 方法论 ≥5 次判向）裁决后淘汰：2 个**不等价**（各有
确定性发散反例，S5-E-1 / S5-E-4 廉价形式）、2 个等价但真实规模 delta
**跨 5 次运行异号**纯抖动或忠实形式同样抖动（S5-E-2 / S5-E-4 忠实形式）、
1 个等价且方向稳定但命中面**零生产流量**（S5-E-3，extraSignals 扩展点，
仓内三个调用方全部不传）、1 个一次性进程级收益实测上界仅 **2.8–3.0ms**
（S5-E-5，低于数十 ms 落地线且属「每进程一次的 CLI 噪声」否决类）。未重开
任何 X* / S1-* / S2-* / S3-* / S4-* / S5-A-* / S5-B-* 条目。零 diff 下全部
硬不变量天然满足。本切片在其输出契约与数据面语义下维持 SOTA——第五遍复查
再次确认：**剩余的全部 ms 级余量都在被排除表点名保护的 I/O 契约面上**，
切片级收口条件（R3-E §7 / R4-E §7）依然成立。

## 0. 范围与约束遵守

- 切片：`src/learning/` 全部 10 文件（`attribution` / `auto-loop` /
  `bandit-store` / `diagnostics` / `from-episode` / `learned-routing` /
  `patterns` / `signals` / `signatures` / `task-success`）本轮第五遍全量实际
  读码，未依赖前四轮记忆。上下游 `adaptation/`、`routing/`、`run/`、`track/`、
  `cli/`、`feedback/`、`persist/`、`privacy/` 只读取证，一行未改。
- 先读并遵守（顺序强制）：README → EXCLUSIONS.md（完整表，含 S4-I-2..5、
  S5-A-1..3、S5-B-1..4）→ round-05/PLAN.md → round-01/R1-E.md →
  round-02/R2-E.md → round-03/R3-E.md → round-04/R4-E.md → 10 个源文件。
- 基线漂移检查：`git diff adb20d7..c228dbe -- src/learning/` 为空且
  `git log adb20d7..c228dbe -- src/learning/` 无提交——切片自 R1-E 裁决基线
  起逐字节未变，前四轮全部规模测量、调用面图景与裁决原样成立。
  `cb65c81..c228dbe`（R4-E 之后）的 src 变更仅 S4-C（`routing/lin-alg.ts`）
  与 S4-I（CLI 惰性 Pi 运行时）——不触及本切片调用方语义与调用频率。
- 排除表遵守：候选枚举刻意绕开全部既有排除。特别地：S5-E-1（反向早退）与
  S3-E-2（信任 context 跳过重推导）、S1-E-1（两遍合并）区分——目标是**同一
  函数内**的扫描方向反转 + 早退，非跨函数传递或两遍融合；S5-E-2（ctx 循环外
  提升）与 S3-E-1（互斥分派 + 第一遍 payload 提升）区分——目标是第二遍
  CHILD_MESSAGE 分支每事件分配的 8 字段 ctx 字面量，S3-E-1 的已排除编辑全部
  不捆绑；S5-E-3（双重构造合一）与 S2-E-7（跨边界 binding 双拷贝）、S4-E-3
  （单态化）区分——目标是 `parseObservedSignal` 自身「条件 spread 输入对象 →
  baseSignal 再条件 spread」的两级构造，且**不改变输出形状**（own-property
  集合逐位保留）；S5-E-4（嵌套 Map 分组键）与 S1-E-6（组内多遍融合）、
  S3-E-3（冗余 Map.set）区分——目标是键结构本身；S5-E-5（切片内子树惰性
  加载）与已落地的 S4-I（CLI 切片、Pi 运行时子树）区分——目标是 auto-loop
  在 src/learning/ 内的静态 import 边。X0-3 / X1-1 / X1-2 / X2-6 / S1-E-* /
  S2-E-* / S3-E-* / S4-E-* 全部未触碰。
- ns 级基准全部副本对副本（S3-E-3 方法论）；几十 ns 量级 delta 以 5 次独立
  运行判向（S3-E-4 方法论）；生产导入仅承担等价性参照与绝对量级锚点角色。
- 硬不变量：零 diff，`adapt auto` 只提案（`autoPromote` 被忽略、绝不 CAS
  晋升）、SPARKLE_AUTO_ADAPT=0 仍收集、`parseObservedSignal` 拒绝 user/human
  伪造 taskSuccess、`ensureRoutingBaseline` 绝不移动既有指针、双 LCB 与双归因
  保留——天然满足。不声称 Outcome-supported；Checkpoint F-PROD 仍开放
  （ADR-005）。不改阈值、权限、数据面契约、公开签名。

## 1. SLICE-CPU 锚点复核（本轮首要任务）

R3-E §1 / R4-E §1 的切片级收口论证依赖三个前提，本轮逐一复核：

1. **切片代码未变**：`git diff adb20d7..c228dbe -- src/learning/` 为空。
2. **调用面未变**：交叉检索确认生产入口仍是 post-run 自适应环（每 run 一次）
   + live 装配面（每任务一次，M≤10）；`patterns` / `attribution` /
   `signatures` / `compareSignatures` 仍零生产调用方。R4-E 后落地的 S4-I
   只把 `--executor pi` 的 Pi 运行时改为惰性加载，不改变 `runAutoAdaptLoop`
   的调用时机或事件规模；无新热路径、无 ≥2 个量级的规模变化。
3. **锚点量级**：本 VM 重测（五次运行区间）：

```text
collect=19.3-19.9us  outcomes=7.3-7.6us  diagnose=0.83-0.86us  bandit-build=0.7us
total in-slice CPU ~28.1-28.9us per full auto-adapt run
vs landing bar >=10000us  ->  346-356x below EVEN IF ZEROED
```

绝对值高于 R4-E 的 18.1–18.5µs、与 R3-E 的 24.6–25.2µs 同带（VM 差异，
R4-E 已注明其 VM 偏快），支配结论不变：落地线要求数十~数百 ms 或复杂度类
下降；本切片每 run 全部 CPU 合计 ~28µs，唯一的 ms 级余量在 I/O 行为上，而
每一条 I/O 边都已被排除表点名保护（X0-3 保存时机、S2-E-1/4 跳写、S1-G-1
readAll 事实源、S1-E-4/5 顺序追加与并行读、S4-E-2 编排重叠）。**锚点复核
成立，该切片不存在不推翻既有排除就能达门槛的候选。** 本轮第五组新角度
（扫描方向与早退、循环不变分配、构造级联、键结构、模块图惰性化）正是对
「锚点之外还有没有面」的再穷举——结论：没有（§2–§3）。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S5-E-1 | `runAutoAdaptFromEvents` 前置扫描改反向早退（projectId/episodeId 双绑定齐了即 break） | 免扫大部分事件表 | ❌ **确定性发散反例 + fuzz 1251/4000 发散**：projectId 是 last-wins，但 `projectRoot ?? …` 使 projectRoot（调用方未传时）是 **first-wins**——反向扫描把 root 绑到最后一个 PROJECT_DISCOVERED | 完整正向扫描 E=41 仅 **89–92ns/run**（任何扫描消除的收益上界） | 淘汰：不等价（S1-A-9/S1-E-1/S3-E-2 事件序语义家族第四例）；修正形式需为 root 继续找**第一个** PROJECT_DISCOVERED ⇒ 仍要全扫，零收益 |
| S5-E-2 | `collectSignalsFromEvents` 第二遍 CHILD_MESSAGE 分支的 8 字段 ctx 字面量循环外提升（每 run 免 ~10 次对象分配） | ctx 全字段循环不变（projectId 定格于第一遍后、五 Map 引用同一、episodeId/createdAt 固定）；ctx 只被 `signalFromAgentMessage` 读取、永不逃逸 | ✅ 4000 fuzz 一致（createdAt 归一化后逐字节；副本保真另验 4000） | E=41 副本对副本 delta **五次异号**（+219/+114/−31/+101/−16ns）——纯抖动；10× E=410 方向为正但仅 0.1–2.6µs 且带宽极散 | 淘汰：等价但真实规模亚噪声（S3-E-1 同带宽）；分配削减被 V8 新生代分配的近零成本吸收 |
| S5-E-3 | `parseObservedSignal` 两级条件 spread 构造（11 项输入对象 → baseSignal 再 11 项）合一为单次直接构造（按 baseSignal 键序） | 免一次 11 条件 spread 的中间对象 | ✅ 6000 fuzz 一致（成功例 JSON 字节 + `Object.keys` 键序 + `deepStrictEqual` 三重校验；错误例抛出消息逐字相同，含伪造 taskSuccess 拒绝） | 副本对副本 **278–281ns/信号**（~1.8×，五次方向与幅度均稳定）——但命中面是 `AutoAdaptInput.extraSignals` 扩展点，仓内三个生产调用方（cli/main、track/loop、cli/adapt）**全部不传 extraSignals** | 淘汰：零生产流量面（S1-E-7 test-only 同族）；即便有流量也是每信号亚 µs、被同路径 ~10²µs appendFeedback 支配 |
| S5-E-4 | `diagnoseModelProjectIssues` 分组键 `${projectId}::${modelId}` 字符串拼接换嵌套 `Map<project, Map<model, list>>` | 免每信号一次模板字符串构造与哈希 | 廉价形式 ❌ **发散反例**：嵌套迭代是 project-major 序，扁平 Map 是首见 (project,model) 对序；末尾 `sort` 是稳定排序 ⇒ meanScore 并列组浮出迭代序（反例三组并列实测输出序不同）。忠实形式（另存首见对序列表）✅ 5000 fuzz 一致 | 忠实形式副本对副本 S=12 delta **五次异号**（+73/−31/−12/+183/−11ns）——纯抖动；S=120 多为正但 ≤273ns | 淘汰：廉价形式不等价（稳定排序平局序是可观察输出）；忠实形式的对序簿记抵消键构造节省，真实规模纯抖动（小集合教训系列第八例佐证） |
| S5-E-5 | auto-loop 在切片内把 `adaptation/promotion`、`feedback/store` 等静态 import 改函数体内 `await import`（S4-I 同型、本切片边） | 非 adapt 命令免载 auto-loop 独占子树 | —（模块图重排，输出平凡等价；错误浮出时机改变见裁决） | 编译产物 dist 实测：auto-loop 全子树冷载 **12.6–13.7ms**，但 `cli/main` 无论如何静态拉取 `learned-routing`（`loadLearnedRouting`）⇒ 其共享子树（adaptation/promotion + registry 等）已必付；auto-loop **独占增量仅 2.8–3.0ms**（五次稳定）——这是切片内惰性化的收益上界 | 淘汰：一次性进程级 2.8–3.0ms，低于数十 ms 落地线（S4-I 以 103–124ms 达标的量级对照）且属验收标准点名的「once-per-run CLI 噪声」否决类；模块载入错误从进程启动移到首调用，属 S2-I-1/S3-I-3 点名的错误浮出时机发散家族 |

另有四处以既有排除/裁决直接覆盖、不立新 ID：`AutoAdaptInput.assignments`
死字段（`runAutoAdaptLoop` 从不读取——但删除即公开签名变更，硬不变量禁止；
运行时零成本纯引用传递）；`.map((signal) => parseObservedSignal(signal))`
换直接函数引用（R4-E 已裁决不立 ID）；`diagnoseModelProjectIssues` 在
`isAutoAdaptEnabled()` 检查前执行并非死计算（两条返回路径都携带 `issues`）；
`ingestSubagentDirectory` 有界并发变体（S1-E-5 重开条件要求「有界并发方案 +
现实文件数增长两个量级」**同时**成立，后者未发生——现实仍个位数文件）。

## 3. 关键裁决细节

### 3.1 S5-E-1：first-wins/last-wins 不对称反例（事件序语义家族第四例）

`runAutoAdaptFromEvents` 前置扫描对两个绑定用了**不同的赢家规则**：
`projectId = event.payload.project.id`（每次覆盖 ⇒ last-wins）、
`projectRoot = projectRoot ?? event.payload.project.rootPath`（首个非空后
锁定 ⇒ 调用方未传 root 时 first-wins）。反向早退保留了 projectId/episodeId
的 last-wins（反向首个 ≡ 正向最后一个），却把 projectRoot 静默改成
last-wins：

```text
events = [PROJECT_DISCOVERED(id=prj_a, root=/tmp/rootA),
          PROJECT_DISCOVERED(id=prj_b, root=/tmp/rootB)], input.projectRoot=undefined
forward  -> projectId=prj_b projectRoot=/tmp/rootA
reverse  -> projectId=prj_b projectRoot=/tmp/rootB   (DIVERGES)
```

seeded fuzz 中 1251/4000 个日志发散（含显式传 root 的一半试验天然免疫）。
projectRoot 决定 `stableProjectKey` ⇒ bandit 文件路径与 registry identity
——绑错 root 即把学习状态写进另一个项目桶，属数据面破坏。修正形式必须为
root 继续扫到表头（找第一个 PROJECT_DISCOVERED），早退失效、收益归零；
而完整正向扫描本身只有 89–92ns。与 S1-A-9（反向扫描）、S1-E-1（迟到
PROJECT_DISCOVERED）、S3-E-2（信任 context）同族：**事件表的每个绑定各有
自己的赢家规则，任何改变扫描方向/提前终止的方案必须逐绑定证明规则保持**。
为将来任何「auto-loop 前置扫描早退」提案立此反例。

### 3.2 S5-E-4：稳定排序使分组迭代序成为可观察输出

`issues.sort((l, r) => l.meanScore - r.meanScore)` 是稳定排序（ES2019 起
规格保证），meanScore 并列的组保持进入 sort 前的相对序——该序来自分组 Map
的**首见 (project, model) 对序**。嵌套 Map 的自然迭代是 project-major：

```text
signals 对序: (prj_a,m1), (prj_b,m2), (prj_a,m2)  全部 meanScore=0.5
flat   -> [prj_a:m1, prj_b:m2, prj_a:m2]
nested -> [prj_a:m1, prj_a:m2, prj_b:m2]   (DIVERGES)
```

`ModelProjectIssue[]` 是 `AutoAdaptResult.issues` 公开返回值（CLI 打印、
测试断言可见），并列序即行为。忠实形式需另存首见对序列表——簿记开销恰好
抵消字符串键构造的节省：S=12 五次测量 delta 异号（+73/−31/−12/+183/−11ns），
纯抖动。这与 S1-A-4/S1-B-6/S1-E-6/S1-E-8/S2-E-5/S2-E-6/S3-E-4 的「小集合上
结构替换固定开销 ≥ 线性重算」教训一致（第八例佐证，本例是键结构而非融合）。

### 3.3 S5-E-3：本轮唯一方向稳定的等价候选为何仍不落地

双层条件 spread 合一是本切片前四轮未探过的构造级联角度，且等价性最强
（键序、own-property 形状、错误消息三重逐位保留——刻意与 S4-E-3 的形状
破坏划清界限），五次测量 278–281ns/信号 幅度罕见地稳定（~1.8×）。但命中面
经调用图穷举为零：`parseObservedSignal` 仅被 `runAutoAdaptLoop` 的
`(input.extraSignals ?? []).map(...)` 消费，而仓内全部三个生产调用方
（`cli/main:790`、`track/loop:172`、`cli/adapt:205`）都不传 `extraSignals`
——它是对外扩展点 + 测试面。S1-E-7（test-only 面 3.5× 但 ~160ns）同族
淘汰。即使将来有流量，每信号亚 µs 也被同路径每信号 ~10²µs 的
`appendFeedback`（R1-E 锚点）以 ~10²–10³× 支配。等价性证据（含键序与
throw parity 的 6000 fuzz）在案可供重开引用。

### 3.4 S5-E-2：分配削减角度的收口

第二遍每个 CHILD_MESSAGE 事件分配一个 8 字段 ctx 字面量（E=41 下 ~10 次/
run），纸面上是纯浪费——但 V8 新生代指针碰撞分配 + 短命对象的 scavenge
近零成本使五次测量 delta 异号（+219/+114/−31/+101/−16ns）。与 S4-E-1 的
「分配避免」裁决同构：本切片的对象分配率（每 run 数十个）低到任何分配级
优化都在抖动带内。ctx 提升在 10× 规模（E=410）方向为正但也仅 0.1–2.6µs。
分配避免角度在本切片就此收口：**除非事件规模增长 ≥2 个量级，该角度不会
再出达门槛候选**。

### 3.5 S5-E-5：S4-I 同型角度在本切片的上界测量

S4-I（CLI 惰性 Pi 运行时）落地后，「模块子树惰性化」成为已验证的角度模板，
本轮把它套到本切片唯一的重 import 边（auto-loop → adaptation/promotion +
feedback/store + …）。编译产物 dist 上的子进程冷载探针（每组 5 次）：

```bash
node --input-type=module -e "const t0=performance.now(); \
  await import('/workspace/dist/learning/auto-loop.js'); \
  console.log(performance.now()-t0)"          # 12.6-13.7ms 全子树
node --input-type=module -e "await import('/workspace/dist/learning/learned-routing.js'); \
  const t0=performance.now(); \
  await import('/workspace/dist/learning/auto-loop.js'); \
  console.log(performance.now()-t0)"          # 2.8-3.0ms 独占增量
```

关键结构事实：`cli/main` 为 `loadLearnedRouting`（live 装配面，run 命令
必用）静态拉取 `learned-routing`，其子树含 `adaptation/promotion` →
`adaptation/registry` 等全部重模块——即**共享子树无论如何必付**。auto-loop
独占增量（feedback/store、signals、diagnostics、bandit-store →
routing/bandit、persist/file-lock）仅 2.8–3.0ms。这是切片内任何惰性化方案
的收益上界：低于数十 ms 落地线一个量级（S4-I 达标值 103–124ms 的 ~1/40），
属验收标准明文的「once-per-run CLI 噪声」否决类；且函数体内 `await import`
把损坏安装/循环依赖等模块载入错误从进程启动移到 post-run 首调用（该处被
`try/catch` 包裹打印 `adapt skipped:`），错误浮出面发散（S2-I-1/S3-I-3
同族）。淘汰，测量在案供将来子树增重时对照。

## 4. 逐文件收口（前四轮收口之上的本轮新检查点）

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `signals.ts` | S5-E-2（ctx 循环外提升）、S5-E-3（parseObservedSignal 双重构造合一）淘汰；S1-E-1/2/3、S2-E-5/7、S3-E-1/5、S4-E-1/3 维持 | 无候选 |
| `auto-loop.ts` | S5-E-1（前置扫描反向早退）淘汰并立 first-wins/last-wins 不对称反例；S5-E-5（子树惰性化）淘汰并立 2.8–3.0ms 上界；`assignments` 死字段=公开签名不动；S1-E-4/5、S2-E-1、S3-E-2、S4-E-2 维持 | 无候选 |
| `from-episode.ts` | 调用图复核 `adapt learn` 独立命令无双读；S2-E-2 维持；`Date.parse`/死参数维持前轮裁决 | 无候选 |
| `bandit-store.ts` | 无第五组新角度（键结构角度被 S5-E-4 裁决覆盖：`arms` 是数组非分组键）；S2-E-3/4、S3-E-4、X1-2 维持 | 无候选 |
| `diagnostics.ts` | S5-E-4（嵌套 Map 分组键）淘汰并立稳定排序平局序反例；S1-E-6、S3-E-3、S4-E-3、恒真守卫维持 | 无候选 |
| `learned-routing.ts` | live 面无第五组新角度（S2-E-6 融合、X1-1 缓存、Iter4 M≤10 维持）；`parseLearnedRoutingPolicy` 全字段校验是 fail-closed 契约 | 无候选 |
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

仿真（临时脚本 `/tmp/r5e-sim.mts`，未入库以遵守「无赢家不提交败者仿真」；
完整源码见附录，seeds `0xe55e01`–`0xe55e08`）共 **5 次独立运行**，>26,000 项
等价检查/次全部通过、等价结论逐位一致（S5-E-1 fuzz 发散数五次恒为
1251/4000，确定性）。代表性一次运行：

```text
S5-E-1 counterexample: forward binds projectId=prj_b0000000 projectRoot=/tmp/rootA; reverse-early-exit binds projectId=prj_b0000000 projectRoot=/tmp/rootB -> NOT equivalent
S5-E-1 fuzz: 1251/4000 seeded logs diverge (any >0 kills the candidate)
S5-E-1 ceiling: full forward prefix scan at E=41 costs 90ns/run (upper bound of any scan-elimination win)
S5-E-2 bench E=41 (replica-vs-replica): current=13470ns cand=13251ns delta=219ns/run
S5-E-2 bench 10x E=410 (replica-vs-replica): current=130456ns cand=127866ns delta=2590ns/run
S5-E-3 bench fully-populated signal (replica-vs-replica): current=613ns cand=334ns delta=279ns/signal (extraSignals extension point only; zero in-repo production traffic)
S5-E-4 cheap-form counterexample: flat order=[prj_a0000000:m1, prj_b0000000:m2, prj_a0000000:m2]; nested order=[prj_a0000000:m1, prj_a0000000:m2, prj_b0000000:m2] -> NOT equivalent under meanScore ties
S5-E-4 bench real S=12 (replica-vs-replica, faithful form): current=164ns cand=91ns delta=73ns/call
S5-E-4 bench 10x S=120 (replica-vs-replica, faithful form): current=1496ns cand=1223ns delta=273ns/call
SLICE-CPU anchor re-verify: collect=19.9us outcomes=7.6us diagnose=0.83us bandit-build=0.7us | total in-slice CPU ~28.9us per run vs landing bar >=10000us (346x below even if zeroed)

ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

计时方向跨 5 次运行汇总：S5-E-2 E=41 delta **五次异号**
（+219/+114/−31/+101/−16ns）确认纯抖动；S5-E-3 五次稳定
（279/280/278/279/281ns）；S5-E-4 忠实形式 S=12 **五次异号**
（+73/−31/−12/+183/−11ns）确认纯抖动；S5-E-1 反例与 fuzz 发散数、
S5-E-4 廉价形式反例五次逐位一致；SLICE-CPU 总量 28.1–28.9µs 稳定。
S5-E-5 探针（dist 子进程冷载 ×5）：全子树 12.55/12.82/12.85/12.98/13.74ms、
独占增量 2.82/2.84/2.84/2.87/2.97ms，方向与幅度稳定。

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S5-E-1 | runAutoAdaptFromEvents 前置扫描反向早退 | 不等价：projectId last-wins 而 projectRoot first-wins（`??` 锁定），反例 + fuzz 1251/4000 发散；root 绑错即写错项目桶（数据面）；修正形式仍需全扫，正向全扫仅 89–92ns |
| S5-E-2 | collectSignalsFromEvents 第二遍 CHILD_MESSAGE ctx 字面量循环外提升 | 等价但 E=41 delta 五次异号（+219…−16ns）纯抖动；分配率太低，分配避免角度在本切片收口 |
| S5-E-3 | parseObservedSignal 两级条件 spread 构造合一（按 baseSignal 键序直接构造） | 等价（键序/形状/错误消息逐位保留）且方向稳定 ~1.8×（278–281ns/信号），但 extraSignals 扩展点零仓内生产流量（三个调用方全不传），且被同路径 ~10²µs appendFeedback 支配 |
| S5-E-4 | diagnoseModelProjectIssues 分组键换嵌套 Map（廉价与忠实两形式） | 廉价形式不等价：稳定排序使 meanScore 并列组浮出分组迭代序（project-major vs 首见对序，反例在案）；忠实形式对序簿记抵消收益，S=12 五次异号纯抖动 |
| S5-E-5 | auto-loop 切片内静态 import 改函数体 `await import`（S4-I 同型） | 一次性进程级收益上界实测 2.8–3.0ms（cli/main 经 learned-routing 必付共享子树，auto-loop 独占增量小）；低于数十 ms 落地线且属「once-per-run CLI 噪声」否决类；模块载入错误浮出时机发散（S2-I-1/S3-I-3 同族） |

重开条件：S5-E-1 需先证明事件表全局只有单个 PROJECT_DISCOVERED 的不变量
（或统一两绑定的赢家规则并迁移数据面）；S5-E-2 需事件规模增长 ≥2 个量级；
S5-E-3 需 extraSignals 出现仓内生产调用方**且**信号管道脱离 appendFeedback
支配（两者同时）——等价性证据本报告在案；S5-E-4 需 meanScore 并列序被正式
声明为非契约（含 CLI 打印与测试断言迁移）且 S 增长 ≥2 个量级；S5-E-5 需
auto-loop 独占子树增重至数十 ms 带（如引入重依赖）且错误浮出契约被正式放宽。
切片级重开总条件维持 R3-E §7 / R4-E §7：SLICE-CPU 锚点失效（全切片 CPU
增长 ≥2 个量级，本轮复核值 28.1–28.9µs）或任一 I/O 契约排除（X0-3 /
S2-E-1/4 / S1-G-1 / S1-E-4/5 / S4-E-2）被正式推翻。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.mts` 后在仓库根目录 `npx tsx <file>`（依赖已装）。
seeds：`0xe55e01`–`0xe55e08`。S5-E-5 探针命令见 §3.5（需先 `pnpm build`）。

```ts
/**
 * R5-E deterministic equivalence + benchmark simulation (fifth pass over
 * src/learning/). Re-verifies the R4-E SLICE-CPU anchor and adjudicates
 * fresh candidates S5-E-1 .. S5-E-4 (S5-E-5 module-load anchor is measured
 * by a separate child-process probe, see report §3.5).
 * Seeded PRNG (mulberry32) -> fully reproducible. Seeds: 0xe55e01 - 0xe55e08.
 *
 * Reference = production imports (equivalence role + absolute-magnitude
 * anchors). ns-delta benchmarks are replica-vs-replica per the S3-E-3
 * methodology lesson. Replicas keep every already-excluded edit UNAPPLIED
 * (independent if-chains, judge double-get, per-event ctx allocation, ...).
 */
import { performance } from "node:perf_hooks";
import { deepStrictEqual } from "node:assert";
import {
  collectSignalsFromEvents,
  parseObservedSignal,
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
import { AGENT_ROLES } from "/workspace/src/domain/roles.js";
import { DomainValidationError } from "/workspace/src/domain/errors.js";
import { isRecord } from "/workspace/src/domain/record.js";
import type { FeedbackKind } from "/workspace/src/feedback/types.js";
import type { EpisodeId, ProjectId, RunId, TaskId } from "/workspace/src/domain/ids.js";
import type { Event } from "/workspace/src/run/events.js";
import type { AgentMessage, TaskOutcome, VerificationKind } from "/workspace/src/protocol/v1.js";
import type { IsoTimestamp } from "/workspace/src/domain/timestamp.js";
import { nowIso } from "/workspace/src/domain/timestamp.js";
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

const NOW = "2026-08-24T08:00:00.000Z" as IsoTimestamp;

/* ================================================================
 * Verbatim private-helper replicas from src/learning/signals.ts.
 * Every already-excluded edit stays UNAPPLIED.
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

/** Verbatim replica of collectSignalsFromEvents (all excluded edits unapplied). */
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
          source: "user",
          kind: "human",
          projectId,
          score,
          criterion: "userAcceptance",
          outcomeKind: score >= 50 ? "PASS" : "FAIL",
          boundary: "review",
          summary: truncate(`user: ${event.payload.answer}`),
          createdAt,
          episodeId: context.episodeId,
          runId: event.runId
        })
      );
    }
    if (event.type === "JUDGE_DECISION") {
      const score = event.payload.verdict === "APPROVED" ? 85 : event.payload.verdict === "REJECTED" ? 20 : 50;
      const modelId = modelByTask.get(event.payload.taskId);
      signals.push(
        baseSignal({
          source: "deterministic",
          kind: "judge",
          projectId,
          score,
          criterion: "policyCompliance",
          outcomeKind:
            event.payload.verdict === "APPROVED"
              ? "PASS"
              : event.payload.verdict === "REJECTED"
                ? "FAIL"
                : "ABSTAIN",
          boundary: "review",
          summary: `judge ${event.payload.verdict}`,
          createdAt,
          episodeId: context.episodeId,
          runId: event.runId,
          taskId: event.payload.taskId,
          evidenceIds: event.payload.evidenceIds,
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
          source: "deterministic",
          kind: "deterministic",
          projectId,
          score: 10,
          boundary: "execution",
          summary: truncate(`run failed: ${event.payload.reason}`),
          createdAt,
          episodeId: context.episodeId,
          runId: event.runId
        })
      );
    }
  }
  return signals;
}

/* Seeded event-log generator (R1-A composition: E~41), plus optional
 * EPISODE_OPENED events for the S5-E-1 prefix-scan replica. */
const OUTCOMES: readonly TaskOutcome[] = ["SUCCESS", "PARTIAL", "FAILURE", "CANCELLED"];
const VERIFS: readonly VerificationKind[] = ["PASSED", "FAILED", "UNOBSERVED"];
const ROLES = ["actor", "critic", "tester", "planner", "scout", "reviewer"] as const;
const FAMS = ["edit", "test", "review", "plan", "research"] as const;
const ANSWERS = ["lgtm", "no, revert this", "please also add coverage", "可以", "不行 错误", "hmm"];
const PEERS = ["found a bug in the ledger", "looks fine to me", "missing tests", "unknown agent addressed", "ok"];

function genEvents(
  rng: () => number,
  length: number,
  opts?: { forceProject?: boolean; withEpisodes?: boolean }
): Event[] {
  const out: unknown[] = [];
  const taskIds = Array.from({ length: 10 }, (_, i) => `tsk_${i}0000000`);
  if (opts?.forceProject !== false) {
    out.push({ type: "PROJECT_DISCOVERED", payload: { project: { id: "prj_simsim01", rootPath: "/tmp/x" } } });
  }
  for (let i = 0; i < length; i += 1) {
    const roll = rng();
    const taskId = pick(rng, taskIds);
    if (roll < 0.05) {
      out.push({
        type: "PROJECT_DISCOVERED",
        payload: {
          project: { id: `prj_p${Math.floor(rng() * 3)}simsim`, rootPath: `/tmp/root${Math.floor(rng() * 3)}` }
        }
      });
    } else if (opts?.withEpisodes === true && roll < 0.1) {
      out.push({
        type: "EPISODE_OPENED",
        payload: { episode: { id: `ep_e${Math.floor(rng() * 4)}0000000` } }
      });
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

/* ================================================================
 * S5-E-1: runAutoAdaptFromEvents prefix scan -> reverse scan with early
 * exit once projectId and episodeId are both bound.
 * Expected NOT equivalent: projectId is last-wins but projectRoot (when
 * input.projectRoot is undefined) is FIRST-wins via `projectRoot ?? ...`.
 * ================================================================ */
interface PrefixScanResult {
  projectId: string | undefined;
  projectRoot: string | undefined;
  episodeId: string | undefined;
}
/** Verbatim replica of the runAutoAdaptFromEvents prefix scan. */
function referencePrefixScan(events: readonly Event[], inputProjectRoot: string | undefined): PrefixScanResult {
  let projectId: string | undefined;
  let projectRoot = inputProjectRoot;
  let episodeId: string | undefined;
  for (const event of events) {
    if (event.type === "PROJECT_DISCOVERED") {
      projectId = event.payload.project.id;
      projectRoot = projectRoot ?? event.payload.project.rootPath;
    }
    if (event.type === "EPISODE_OPENED") {
      episodeId = event.payload.episode.id;
    }
  }
  return { projectId, projectRoot, episodeId };
}
/** Candidate: reverse scan, early exit when both bindings are found. */
function candidateReverseScan(events: readonly Event[], inputProjectRoot: string | undefined): PrefixScanResult {
  let projectId: string | undefined;
  let projectRoot = inputProjectRoot;
  let episodeId: string | undefined;
  let needProject = true;
  let needEpisode = true;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    if (needProject && event.type === "PROJECT_DISCOVERED") {
      projectId = event.payload.project.id;
      projectRoot = projectRoot ?? event.payload.project.rootPath;
      needProject = false;
    }
    if (needEpisode && event.type === "EPISODE_OPENED") {
      episodeId = event.payload.episode.id;
      needEpisode = false;
    }
    if (!needProject && !needEpisode) break;
  }
  return { projectId, projectRoot, episodeId };
}

{
  // explicit counterexample: two PROJECT_DISCOVERED with different roots,
  // caller did not pass projectRoot
  const events = [
    { type: "PROJECT_DISCOVERED", payload: { project: { id: "prj_a0000000", rootPath: "/tmp/rootA" } } },
    { type: "PROJECT_DISCOVERED", payload: { project: { id: "prj_b0000000", rootPath: "/tmp/rootB" } } }
  ] as unknown as Event[];
  const ref = referencePrefixScan(events, undefined);
  const cand = candidateReverseScan(events, undefined);
  check(
    "S5-E-1 counterexample must diverge (projectRoot first-wins vs reverse binds last root)",
    ref.projectId === "prj_b0000000" &&
      cand.projectId === "prj_b0000000" &&
      ref.projectRoot === "/tmp/rootA" &&
      cand.projectRoot === "/tmp/rootB"
  );
  console.log(
    `S5-E-1 counterexample: forward binds projectId=${ref.projectId} projectRoot=${ref.projectRoot}; reverse-early-exit binds projectId=${cand.projectId} projectRoot=${cand.projectRoot} -> NOT equivalent`
  );
  // fuzz: count divergences over seeded logs with multiple PROJECT_DISCOVERED
  const rng = mulberry32(0xe55e01);
  let divergences = 0;
  let trials = 0;
  for (let trial = 0; trial < 4000; trial += 1) {
    const evs = genEvents(rng, Math.floor(rng() * 60), { forceProject: rng() < 0.9, withEpisodes: true });
    const root = rng() < 0.5 ? "/tmp/explicit" : undefined;
    trials += 1;
    const a = referencePrefixScan(evs, root);
    const b = candidateReverseScan(evs, root);
    if (JSON.stringify(a) !== JSON.stringify(b)) divergences += 1;
  }
  console.log(`S5-E-1 fuzz: ${divergences}/${trials} seeded logs diverge (any >0 kills the candidate)`);
  check("S5-E-1 fuzz must expose divergences", divergences > 0);
  // ceiling: what the full forward scan costs at E=41 (upper bound of any win)
  const events41 = genEvents(mulberry32(0xe55e02), 40, { withEpisodes: true });
  const scanCost = bench(() => void referencePrefixScan(events41, undefined), 200000);
  console.log(
    `S5-E-1 ceiling: full forward prefix scan at E=41 costs ${(scanCost * 1e6).toFixed(0)}ns/run (upper bound of any scan-elimination win)`
  );
}

/* ================================================================
 * S5-E-2: hoist the loop-invariant SignalCtx object out of the second
 * pass of collectSignalsFromEvents (one allocation instead of one per
 * CHILD_MESSAGE event). ctx never escapes signalFromAgentMessage.
 * ================================================================ */
function candidateCollectHoistedCtx(events: readonly Event[], context: SignalContext = {}): ObservedSignal[] {
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

  // candidate edit: the per-CHILD_MESSAGE ctx literal is loop-invariant
  const ctx: SignalCtx = {
    projectId,
    modelByTask,
    modelVersionByTask,
    roleByTask,
    familyByTask,
    featureVersionByTask,
    episodeId: context.episodeId,
    createdAt
  };

  for (const event of events) {
    if (event.type === "CHILD_MESSAGE") {
      const fromResult = signalFromAgentMessage(event.payload.message, ctx);
      if (fromResult !== undefined) signals.push(fromResult);
    }
    if (event.type === "USER_ANSWER") {
      const score = scoreUserAnswer(event.payload.answer);
      if (score === undefined) continue;
      signals.push(
        baseSignal({
          source: "user",
          kind: "human",
          projectId,
          score,
          criterion: "userAcceptance",
          outcomeKind: score >= 50 ? "PASS" : "FAIL",
          boundary: "review",
          summary: truncate(`user: ${event.payload.answer}`),
          createdAt,
          episodeId: context.episodeId,
          runId: event.runId
        })
      );
    }
    if (event.type === "JUDGE_DECISION") {
      const score = event.payload.verdict === "APPROVED" ? 85 : event.payload.verdict === "REJECTED" ? 20 : 50;
      const modelId = modelByTask.get(event.payload.taskId);
      signals.push(
        baseSignal({
          source: "deterministic",
          kind: "judge",
          projectId,
          score,
          criterion: "policyCompliance",
          outcomeKind:
            event.payload.verdict === "APPROVED"
              ? "PASS"
              : event.payload.verdict === "REJECTED"
                ? "FAIL"
                : "ABSTAIN",
          boundary: "review",
          summary: `judge ${event.payload.verdict}`,
          createdAt,
          episodeId: context.episodeId,
          runId: event.runId,
          taskId: event.payload.taskId,
          evidenceIds: event.payload.evidenceIds,
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
          source: "deterministic",
          kind: "deterministic",
          projectId,
          score: 10,
          boundary: "execution",
          summary: truncate(`run failed: ${event.payload.reason}`),
          createdAt,
          episodeId: context.episodeId,
          runId: event.runId
        })
      );
    }
  }
  return signals;
}

{
  const rng = mulberry32(0xe55e03);
  for (let trial = 0; trial < 4000; trial += 1) {
    const events = genEvents(rng, Math.floor(rng() * 60), { forceProject: rng() < 0.9 });
    const ctx: SignalContext = rng() < 0.5 ? { episodeId: "ep_simsim01" as EpisodeId } : {};
    const expected = norm(collectSignalsFromEvents(events, ctx));
    check(
      "S5-E-2 equivalence (hoisted-ctx candidate == production)",
      expected === norm(candidateCollectHoistedCtx(events, ctx)),
      `trial ${trial}`
    );
    check(
      "S5-E-2 replica fidelity (verbatim copy == production)",
      expected === norm(replicaCollectCurrent(events, ctx)),
      `trial ${trial}`
    );
  }
  // replica-vs-replica bench at E=41 and 10x E=410
  for (const [label, len, reps] of [["E=41", 40, 20000], ["10x E=410", 400, 2000]] as const) {
    const events = genEvents(mulberry32(0xe55e04 + len), len);
    const cur = bench(() => void replicaCollectCurrent(events, {}), reps);
    const cand = bench(() => void candidateCollectHoistedCtx(events, {}), reps);
    console.log(
      `S5-E-2 bench ${label} (replica-vs-replica): current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/run`
    );
  }
}

/* ================================================================
 * S5-E-3: parseObservedSignal builds an 11-conditional-spread input
 * object and then baseSignal rebuilds an 11-conditional-spread output.
 * Candidate constructs the ObservedSignal once, directly, in baseSignal's
 * key order. Hit surface: the extraSignals extension point only (all
 * three in-repo production callers omit extraSignals).
 * ================================================================ */
/** Verbatim replica of parseObservedSignal (via the local baseSignal replica). */
function replicaParseObserved(value: unknown): ObservedSignal {
  if (!isRecord(value)) {
    throw new DomainValidationError("observed signal must be an object");
  }
  if (value.source !== "user" && value.source !== "subagent" && value.source !== "deterministic") {
    throw new DomainValidationError("observed signal source is invalid");
  }
  if (typeof value.kind !== "string" || value.kind.trim() === "") {
    throw new DomainValidationError("observed signal kind is required");
  }
  if (typeof value.projectId !== "string" || value.projectId.trim() === "") {
    throw new DomainValidationError("observed signal projectId is required");
  }
  if (typeof value.score !== "number" || !Number.isFinite(value.score)) {
    throw new DomainValidationError("observed signal score is required");
  }
  if (typeof value.boundary !== "string") {
    throw new DomainValidationError("observed signal boundary is required");
  }
  if (typeof value.summary !== "string") {
    throw new DomainValidationError("observed signal summary is required");
  }
  if (typeof value.createdAt !== "string") {
    throw new DomainValidationError("observed signal createdAt is required");
  }
  if (value.criterion === "taskSuccess" && (value.source === "user" || value.kind === "human")) {
    throw new DomainValidationError("extraSignals cannot forge criterion taskSuccess");
  }
  return baseSignal({
    source: value.source,
    kind: value.kind as ObservedSignal["kind"],
    projectId: value.projectId as ProjectId,
    score: value.score,
    boundary: value.boundary as ObservedSignal["boundary"],
    summary: value.summary,
    createdAt: value.createdAt as ObservedSignal["createdAt"],
    ...(typeof value.modelId === "string" ? { modelId: value.modelId } : {}),
    ...(typeof value.modelVersion === "string" ? { modelVersion: value.modelVersion } : {}),
    ...(typeof value.role === "string" ? { role: value.role } : {}),
    ...(typeof value.family === "string" ? { family: value.family } : {}),
    ...(typeof value.featureVersion === "string" ? { featureVersion: value.featureVersion } : {}),
    ...(typeof value.criterion === "string" ? { criterion: value.criterion as ObservedSignal["criterion"] } : {}),
    ...(typeof value.outcomeKind === "string"
      ? { outcomeKind: value.outcomeKind as ObservedSignal["outcomeKind"] }
      : {}),
    ...(typeof value.episodeId === "string" ? { episodeId: value.episodeId as EpisodeId } : {}),
    ...(typeof value.runId === "string" ? { runId: value.runId as RunId } : {}),
    ...(typeof value.taskId === "string" ? { taskId: value.taskId as TaskId } : {}),
    ...(Array.isArray(value.evidenceIds)
      ? { evidenceIds: value.evidenceIds.filter((id): id is string => typeof id === "string") }
      : {})
  });
}
/** Candidate: single direct construction in baseSignal's key order. */
function candidateParseDirect(value: unknown): ObservedSignal {
  if (!isRecord(value)) {
    throw new DomainValidationError("observed signal must be an object");
  }
  if (value.source !== "user" && value.source !== "subagent" && value.source !== "deterministic") {
    throw new DomainValidationError("observed signal source is invalid");
  }
  if (typeof value.kind !== "string" || value.kind.trim() === "") {
    throw new DomainValidationError("observed signal kind is required");
  }
  if (typeof value.projectId !== "string" || value.projectId.trim() === "") {
    throw new DomainValidationError("observed signal projectId is required");
  }
  if (typeof value.score !== "number" || !Number.isFinite(value.score)) {
    throw new DomainValidationError("observed signal score is required");
  }
  if (typeof value.boundary !== "string") {
    throw new DomainValidationError("observed signal boundary is required");
  }
  if (typeof value.summary !== "string") {
    throw new DomainValidationError("observed signal summary is required");
  }
  if (typeof value.createdAt !== "string") {
    throw new DomainValidationError("observed signal createdAt is required");
  }
  if (value.criterion === "taskSuccess" && (value.source === "user" || value.kind === "human")) {
    throw new DomainValidationError("extraSignals cannot forge criterion taskSuccess");
  }
  return {
    source: value.source,
    kind: value.kind as ObservedSignal["kind"],
    projectId: value.projectId as ProjectId,
    score: value.score,
    boundary: value.boundary as ObservedSignal["boundary"],
    summary: value.summary,
    createdAt: value.createdAt as ObservedSignal["createdAt"],
    evidenceIds: Array.isArray(value.evidenceIds)
      ? value.evidenceIds.filter((id): id is string => typeof id === "string")
      : [],
    ...(typeof value.modelId === "string" ? { modelId: value.modelId } : {}),
    ...(typeof value.modelVersion === "string" ? { modelVersion: value.modelVersion } : {}),
    ...(typeof value.role === "string" ? { role: value.role } : {}),
    ...(typeof value.family === "string" ? { family: value.family } : {}),
    ...(typeof value.featureVersion === "string" ? { featureVersion: value.featureVersion } : {}),
    ...(typeof value.criterion === "string" ? { criterion: value.criterion as ObservedSignal["criterion"] } : {}),
    ...(typeof value.outcomeKind === "string"
      ? { outcomeKind: value.outcomeKind as ObservedSignal["outcomeKind"] }
      : {}),
    ...(typeof value.episodeId === "string" ? { episodeId: value.episodeId as EpisodeId } : {}),
    ...(typeof value.runId === "string" ? { runId: value.runId as RunId } : {}),
    ...(typeof value.taskId === "string" ? { taskId: value.taskId as TaskId } : {})
  };
}

function genRawSignal(rng: () => number): unknown {
  const maybe = <T>(p: number, v: T): T | undefined => (rng() < p ? v : undefined);
  const record: Record<string, unknown> = {
    source: pick(rng, ["user", "subagent", "deterministic", "bogus", 42] as const),
    kind: pick(rng, ["human", "peer", "judge", "deterministic", "", 7] as const),
    projectId: pick(rng, ["prj_a0000000", "prj_b0000000", "", 9] as const),
    score: pick(rng, [90, 15.5, Number.NaN, "90"] as const),
    boundary: pick(rng, ["execution", "review", 3] as const),
    summary: pick(rng, ["s", "", 1] as const),
    createdAt: pick(rng, [NOW, 5] as const)
  };
  const optional: Record<string, unknown> = {
    modelId: maybe(0.6, pick(rng, ["m1", "", 4] as const)),
    modelVersion: maybe(0.4, pick(rng, ["v1", 2] as const)),
    role: maybe(0.4, pick(rng, ["actor", 6] as const)),
    family: maybe(0.4, pick(rng, ["edit", 8] as const)),
    featureVersion: maybe(0.3, "fv1"),
    criterion: maybe(0.5, pick(rng, ["taskSuccess", "userAcceptance", "policyCompliance", 5] as const)),
    outcomeKind: maybe(0.4, pick(rng, ["PASS", "FAIL", 4] as const)),
    episodeId: maybe(0.4, "ep_simsim01"),
    runId: maybe(0.4, "run_simsim01"),
    taskId: maybe(0.4, "tsk_00000000"),
    evidenceIds: maybe(0.5, pick(rng, [["evd_00000001", 42, "x"], [], "not-array"] as const))
  };
  for (const [key, val] of Object.entries(optional)) {
    if (val !== undefined) record[key] = val;
  }
  return rng() < 0.03 ? pick(rng, [null, "str", 42, [record]] as const) : record;
}

{
  const rng = mulberry32(0xe55e05);
  for (let trial = 0; trial < 6000; trial += 1) {
    const raw = genRawSignal(rng);
    let prodResult: ObservedSignal | undefined;
    let prodError: string | undefined;
    try {
      prodResult = parseObservedSignal(raw);
    } catch (error) {
      prodError = (error as Error).message;
    }
    let replicaResult: ObservedSignal | undefined;
    let replicaError: string | undefined;
    try {
      replicaResult = replicaParseObserved(raw);
    } catch (error) {
      replicaError = (error as Error).message;
    }
    let candResult: ObservedSignal | undefined;
    let candError: string | undefined;
    try {
      candResult = candidateParseDirect(raw);
    } catch (error) {
      candError = (error as Error).message;
    }
    check("S5-E-3 replica fidelity (throw parity)", prodError === replicaError, `trial ${trial}`);
    check("S5-E-3 candidate throw parity", prodError === candError, `trial ${trial}`);
    if (prodResult !== undefined && candResult !== undefined && replicaResult !== undefined) {
      check(
        "S5-E-3 candidate JSON bytes",
        JSON.stringify(prodResult) === JSON.stringify(candResult),
        `trial ${trial}`
      );
      check(
        "S5-E-3 candidate key order",
        JSON.stringify(Object.keys(prodResult)) === JSON.stringify(Object.keys(candResult)),
        `trial ${trial}`
      );
      let deepOk = true;
      try {
        deepStrictEqual(prodResult, candResult);
      } catch {
        deepOk = false;
      }
      check("S5-E-3 candidate deepStrictEqual", deepOk, `trial ${trial}`);
    }
  }
  // replica-vs-replica bench: one fully-populated extraSignal
  const full = {
    source: "subagent",
    kind: "deterministic",
    projectId: "prj_a0000000",
    score: 88,
    boundary: "execution",
    summary: "extra signal summary",
    createdAt: NOW,
    modelId: "m1",
    modelVersion: "v1",
    role: "actor",
    family: "edit",
    featureVersion: "fv1",
    criterion: "taskSuccess",
    outcomeKind: "PASS",
    episodeId: "ep_simsim01",
    runId: "run_simsim01",
    taskId: "tsk_00000000",
    evidenceIds: ["evd_00000001"]
  };
  const cur = bench(() => void replicaParseObserved(full), 200000);
  const cand = bench(() => void candidateParseDirect(full), 200000);
  console.log(
    `S5-E-3 bench fully-populated signal (replica-vs-replica): current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/signal (extraSignals extension point only; zero in-repo production traffic)`
  );
}

/* ================================================================
 * S5-E-4: diagnoseModelProjectIssues flat string group key
 * `${projectId}::${modelId}` -> nested Map<project, Map<model, list>>.
 * Cheap form is NOT equivalent: nested iteration reorders groups
 * (project-major) while the flat map iterates in first-seen PAIR order;
 * the final sort is stable, so equal-meanScore groups surface the
 * iteration order. Faithful form keeps a first-seen pair list and is
 * benched replica-vs-replica.
 * ================================================================ */
const ACTIONABLE_MEAN = 0.45;
const ACTIONABLE_SAMPLES = 5;
function uniqueLocal(values: readonly string[]): string[] {
  const seen: string[] = [];
  for (const value of values) {
    if (!seen.includes(value)) seen.push(value);
  }
  return seen;
}
function modeLocal(values: readonly string[]): string | undefined {
  if (values.length === 0) return undefined;
  const counts = new Map<string, number>();
  let best = values[0]!;
  let bestCount = 0;
  for (const value of values) {
    const next = (counts.get(value) ?? 0) + 1;
    counts.set(value, next);
    if (next > bestCount) {
      best = value;
      bestCount = next;
    }
  }
  return best;
}
function aggregateGroup(group: ObservedSignal[], issues: ModelProjectIssue[]): void {
  const first = group[0];
  if (first === undefined || first.modelId === undefined) return;
  const samples = group.length;
  const meanScore = group.reduce((sum, item) => sum + item.score, 0) / samples / 100;
  const failuresCount = group.filter((item) => item.score < 40).length;
  const kinds = uniqueLocal(group.map((item) => item.kind));
  const family = modeLocal(group.map((item) => item.family).filter((item): item is string => item !== undefined));
  const independent = kinds.includes("deterministic") && !kinds.includes("human");
  const actionable = samples >= ACTIONABLE_SAMPLES && meanScore < ACTIONABLE_MEAN && independent;
  issues.push({
    projectId: first.projectId,
    modelId: first.modelId,
    samples,
    meanScore,
    failures: failuresCount,
    kinds,
    actionable,
    ...(family !== undefined ? { family } : {})
  });
}
/** Verbatim replica of diagnoseModelProjectIssues. */
function replicaDiagnose(signals: readonly ObservedSignal[]): ModelProjectIssue[] {
  const groups = new Map<string, ObservedSignal[]>();
  for (const signal of signals) {
    if (signal.criterion !== "taskSuccess") continue;
    if (signal.source === "user" || signal.kind === "human") continue;
    if (signal.kind !== "deterministic") continue;
    if (signal.modelId === undefined || signal.modelId.trim() === "") continue;
    const key = `${signal.projectId}::${signal.modelId}`;
    const list = groups.get(key) ?? [];
    list.push(signal);
    groups.set(key, list);
  }
  const issues: ModelProjectIssue[] = [];
  for (const group of groups.values()) {
    aggregateGroup(group, issues);
  }
  return issues.sort((left, right) => left.meanScore - right.meanScore);
}
/** Cheap candidate: nested maps, natural (project-major) iteration. */
function candidateDiagnoseNestedCheap(signals: readonly ObservedSignal[]): ModelProjectIssue[] {
  const byProject = new Map<string, Map<string, ObservedSignal[]>>();
  for (const signal of signals) {
    if (signal.criterion !== "taskSuccess") continue;
    if (signal.source === "user" || signal.kind === "human") continue;
    if (signal.kind !== "deterministic") continue;
    if (signal.modelId === undefined || signal.modelId.trim() === "") continue;
    let models = byProject.get(signal.projectId);
    if (models === undefined) {
      models = new Map();
      byProject.set(signal.projectId, models);
    }
    let list = models.get(signal.modelId);
    if (list === undefined) {
      list = [];
      models.set(signal.modelId, list);
    }
    list.push(signal);
  }
  const issues: ModelProjectIssue[] = [];
  for (const models of byProject.values()) {
    for (const group of models.values()) {
      aggregateGroup(group, issues);
    }
  }
  return issues.sort((left, right) => left.meanScore - right.meanScore);
}
/** Faithful candidate: nested maps for lookup + first-seen pair-order list. */
function candidateDiagnoseNestedFaithful(signals: readonly ObservedSignal[]): ModelProjectIssue[] {
  const byProject = new Map<string, Map<string, ObservedSignal[]>>();
  const groupsInOrder: ObservedSignal[][] = [];
  for (const signal of signals) {
    if (signal.criterion !== "taskSuccess") continue;
    if (signal.source === "user" || signal.kind === "human") continue;
    if (signal.kind !== "deterministic") continue;
    if (signal.modelId === undefined || signal.modelId.trim() === "") continue;
    let models = byProject.get(signal.projectId);
    if (models === undefined) {
      models = new Map();
      byProject.set(signal.projectId, models);
    }
    let list = models.get(signal.modelId);
    if (list === undefined) {
      list = [];
      models.set(signal.modelId, list);
      groupsInOrder.push(list);
    }
    list.push(signal);
  }
  const issues: ModelProjectIssue[] = [];
  for (const group of groupsInOrder) {
    aggregateGroup(group, issues);
  }
  return issues.sort((left, right) => left.meanScore - right.meanScore);
}

function genDiagSignal(rng: () => number): ObservedSignal {
  const criterion = pick(rng, ["taskSuccess", "userAcceptance", "policyCompliance", undefined] as const);
  return {
    source: pick(rng, ["user", "subagent", "deterministic"] as const),
    kind: pick(rng, ["human", "peer", "judge", "deterministic"] as const),
    projectId: pick(rng, ["prj_a0000000", "prj_b0000000"]) as ProjectId,
    score: rng() < 0.5 ? Math.floor(rng() * 101) : Number((rng() * 100).toFixed(3)),
    boundary: "execution",
    summary: "s",
    createdAt: NOW,
    evidenceIds: [],
    ...(rng() < 0.85 ? { modelId: pick(rng, ["m1", "m2", "m3", "  ", ""]) } : {}),
    ...(criterion !== undefined ? { criterion } : {}),
    ...(rng() < 0.7 ? { family: pick(rng, FAMS) } : {})
  };
}

{
  // (a) cheap-form counterexample: three tied groups, interleaved pair order
  const mk = (projectId: string, modelId: string): ObservedSignal => ({
    source: "subagent",
    kind: "deterministic",
    projectId: projectId as ProjectId,
    score: 50,
    boundary: "execution",
    summary: "s",
    createdAt: NOW,
    evidenceIds: [],
    modelId,
    criterion: "taskSuccess"
  });
  const tied = [mk("prj_a0000000", "m1"), mk("prj_b0000000", "m2"), mk("prj_a0000000", "m2")];
  const refOrder = replicaDiagnose(tied).map((issue) => `${issue.projectId}:${issue.modelId}`);
  const cheapOrder = candidateDiagnoseNestedCheap(tied).map((issue) => `${issue.projectId}:${issue.modelId}`);
  check(
    "S5-E-4 cheap-form counterexample must diverge (stable sort surfaces group iteration order)",
    JSON.stringify(refOrder) !== JSON.stringify(cheapOrder)
  );
  console.log(
    `S5-E-4 cheap-form counterexample: flat order=[${refOrder.join(", ")}]; nested order=[${cheapOrder.join(", ")}] -> NOT equivalent under meanScore ties`
  );
  // production parity of the replica + faithful-form equivalence
  const rng = mulberry32(0xe55e06);
  for (let trial = 0; trial < 5000; trial += 1) {
    const signals = Array.from({ length: Math.floor(rng() * 30) }, () => genDiagSignal(rng));
    const expected = JSON.stringify(diagnoseModelProjectIssues(signals));
    check(
      "S5-E-4 replica fidelity (verbatim copy == production)",
      expected === JSON.stringify(replicaDiagnose(signals)),
      `trial ${trial}`
    );
    check(
      "S5-E-4 faithful-form equivalence",
      expected === JSON.stringify(candidateDiagnoseNestedFaithful(signals)),
      `trial ${trial}`
    );
  }
  // (b) faithful-form bench replica-vs-replica
  for (const [label, count, reps] of [["real S=12", 12, 40000], ["10x S=120", 120, 5000]] as const) {
    const benchRng = mulberry32(0xe55e07 + count);
    const signals = Array.from({ length: count }, () => genDiagSignal(benchRng));
    const cur = bench(() => void replicaDiagnose(signals), reps);
    const cand = bench(() => void candidateDiagnoseNestedFaithful(signals), reps);
    console.log(
      `S5-E-4 bench ${label} (replica-vs-replica, faithful form): current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/call`
    );
  }
}

/* ================================================================
 * Bandit in-lock build replica (same as R2-E/R3-E/R4-E) for the anchor.
 * ================================================================ */
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

/* ================================================================
 * SLICE-CPU anchor re-verification (R3-E/R4-E): total in-slice CPU on one
 * full auto-adapt run at real scale vs the campaign landing bar (>=10ms).
 * Production imports carry the absolute-magnitude anchor role.
 * ================================================================ */
{
  const events = genEvents(mulberry32(0xe55e07), 40);
  const collectCost = bench(() => void collectSignalsFromEvents(events, {}), 20000);

  const FAMILIES_LOCAL: readonly TaskFamily[] = ["edit", "test", "review", "plan", "research", "refactor", "deploy", "unknown"];
  const rng = mulberry32(0xe55e07 + 1);
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

  const sRng = mulberry32(0xe55e07 + 2);
  const signals12 = Array.from({ length: 12 }, () => genDiagSignalForAnchor(sRng));
  const diagnoseCost = bench(() => void diagnoseModelProjectIssues(signals12), 40000);

  const bRng = mulberry32(0xe55e08);
  const previous = replicaBanditBuild(
    undefined,
    Array.from({ length: 30 }, () => genDiagSignalForAnchor(bRng))
  );
  const banditSignals = Array.from({ length: 12 }, () => genDiagSignalForAnchor(bRng));
  const banditCost = bench(() => void replicaBanditBuild(previous, banditSignals), 40000);

  const totalUs = (collectCost + outcomesCost + diagnoseCost + banditCost) * 1e3;
  console.log(
    `SLICE-CPU anchor re-verify: collect=${(collectCost * 1e3).toFixed(1)}us outcomes=${(outcomesCost * 1e3).toFixed(1)}us diagnose=${(diagnoseCost * 1e3).toFixed(2)}us bandit-build=${(banditCost * 1e3).toFixed(1)}us | total in-slice CPU ~${totalUs.toFixed(1)}us per run vs landing bar >=10000us (${(10000 / totalUs).toFixed(0)}x below even if zeroed)`
  );
}

function genDiagSignalForAnchor(rng: () => number): ObservedSignal {
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

if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```
