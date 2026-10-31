MODEL_SLUG=claude-fable-5-thinking-xhigh

# R4-E：`src/learning/` 第四遍复查报告（Round 4）

**战役:** 全库持久 SOTA 优化 Round 4 / R4-E
**基线:** `cursor/sota-persistent-opt-83a1` @ `cb65c81`
**分支:** `cursor/r4-e-learning-fourth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动；R3-E 的切片级收口锚点复核成立并加强。**
切片 10 个文件（1770 行）自 R1-E 基线（`adb20d7`）经 R2-E、R3-E 至本轮基线
（`cb65c81`）**逐字节未变**（`git diff adb20d7..cb65c81 -- src/learning/` 为空，
期间无任何提交触及该目录），R1-E 逐文件收口、R2-E/R3-E 复查与
S1-E-1..8 / S2-E-1..7 / S3-E-1..5 共 20 项排除全部继承有效；生产调用面交叉
检索复核未变（post-run 自适应环 `runAutoAdaptLoop` @ `cli/main` / `track/loop` /
`cli/adapt`、`runAutoAdaptFromEvents`、`proposeRoutingFromRoutedEvents` + live
装配面 `applyLearnedRouting` @ `routing/assign` / `run/flowchart-run`、
`loadLearnedRouting`；`patterns` / `attribution` / `signatures` 仍无任何生产
调用方，仅测试使用）。R3-E 的 **SLICE-CPU 总量上界锚点经本轮实测复核成立**：
一次完整 auto-adapt run 的全切片 CPU 合计 **18.1–18.5µs**（本 VM 略快于 R3-E
的 24.6–25.2µs，量级结论不变且更强）——距落地线（≥10ms）**约 540–554×**，
即使把切片 CPU 清零也远不达门槛。本轮在完整排除表之上以第四组新角度枚举，
得到 3 个此前未点名的新候选（S4-E-1 … S4-E-3），全部经理论 + 确定性仿真
（seeded mulberry32，>12,000 项等价检查/次 × 4 次独立运行——含从本报告附录
原文提取后的复现运行，等价结论逐位一致；ns 级基准按 S3-E-3 方法论副本对
副本）裁决后淘汰：1 个等价但收益面是每次 `adapt auto --project` 调用一次的
~540ns（深度亚噪声，S4-E-1）；1 个终态等价但**双故障浮出错误不确定**且收益
317–443µs 亚 ms 一次性（低于否决线，S4-E-2）；1 个**形状不等价**（own-property 存在性可观察发散，S4-E-3），且即使
忽略形状、真实规模收益也仅 ~50–135ns。未重开任何 X* / S1-* / S2-* / S3-* /
S4-A-* / S4-B-* 条目。零 diff 下全部硬不变量天然满足。本切片在其输出契约与
数据面语义下维持 SOTA——第四遍复查同时确认：**剩余的全部 ms 级余量都在被
排除表点名保护的 I/O 契约面上**，切片级收口条件（R3-E §7）依然成立。

## 0. 范围与约束遵守

- 切片：`src/learning/` 全部 10 文件（`attribution` / `auto-loop` /
  `bandit-store` / `diagnostics` / `from-episode` / `learned-routing` /
  `patterns` / `signals` / `signatures` / `task-success`）本轮第四遍全量实际
  读码，未依赖前三轮记忆。上下游 `adaptation/`、`routing/`、`run/`、`track/`、
  `cli/`、`feedback/`、`persist/`、`privacy/` 只读取证，一行未改。
- 先读并遵守（顺序强制）：README → EXCLUSIONS.md（完整表，含 R4-A/R4-B 新增
  S4-A-1..3、S4-B-1..5）→ round-04/PLAN.md → round-01/R1-E.md →
  round-02/R2-E.md → round-03/R3-E.md → 10 个源文件。
- 基线漂移检查：`git diff adb20d7..cb65c81 -- src/learning/` 为空且
  `git log adb20d7..cb65c81 -- src/learning/` 无提交——切片自 R1-E 裁决基线起
  逐字节未变，前三轮全部规模测量、调用面图景与裁决原样成立。
- 排除表遵守：候选枚举刻意绕开全部既有排除。特别地：S4-E-1 与 S1-E-1（两遍
  合并）、S3-E-1（互斥分派）区分——快路径只在 `events.length === 0` 时提前
  返回，非空路径逐字保留（含 judge 双重 get 等全部已排除编辑不应用）；
  S4-E-2 与 S1-E-5（无界 Promise.all 读扇出）区分——这是自适应环两个**编排
  步骤**间的有界（2 路）重叠，不是目录读并行化；S4-E-3 与 S2-E-7（binding
  双拷贝）、S1-A-7（别名省略）区分——目标是 `baseSignal` 构造的隐藏类单态化
  而非拷贝消除。X0-3 / X1-1 / X1-2 / X2-6 / S1-E-* / S2-E-* / S3-E-* 全部
  未触碰。
- ns 级基准全部副本对副本（S3-E-3 方法论），生产导入仅承担等价性参照与
  绝对量级锚点角色。
- 硬不变量：零 diff，`adapt auto` 只提案（`autoPromote` 被忽略、绝不 CAS
  晋升）、SPARKLE_AUTO_ADAPT=0 仍收集、`parseObservedSignal` 拒绝 user/human
  伪造 taskSuccess、`ensureRoutingBaseline` 绝不移动既有指针、双 LCB 与双归因
  保留——天然满足。不声称 Outcome-supported；Checkpoint F-PROD 仍开放
  （ADR-005）。不改阈值、权限、数据面契约、公开签名。

## 1. SLICE-CPU 锚点复核（本轮首要任务）

R3-E §1 的切片级收口论证依赖三个前提，本轮逐一复核：

1. **切片代码未变**：`git diff adb20d7..cb65c81 -- src/learning/` 为空。
2. **调用面未变**：交叉检索确认生产入口仍是 post-run 自适应环（每 run 一次）
   + live 装配面（每任务一次，M≤10）；`patterns` / `attribution` /
   `signatures` / `compareSignatures` 仍零生产调用方。`adapt learn` 与
   `adapt auto` 为独立命令、`track/loop` 与 `cli/main` 内存传递 events——
   无同命令事件表双读。
3. **锚点量级**：本 VM 重测（四次运行区间）：

```text
collect=10.1-10.3us  outcomes=7.1-7.4us  diagnose=~0.15us  bandit-build=0.6-0.7us
total in-slice CPU ~18.1-18.5us per full auto-adapt run
vs landing bar >=10000us  ->  540-554x below EVEN IF ZEROED
```

绝对值比 R3-E 的 24.6–25.2µs 更低（VM 差异），支配结论不变且更强：落地线
要求数十~数百 ms 或复杂度类下降；本切片每 run 全部 CPU 合计 ~18µs，唯一的
ms 级余量在 I/O 行为上，而每一条 I/O 边都已被排除表点名保护（X0-3 保存时机、
S2-E-1/4 跳写、S1-G-1 readAll 事实源、S1-E-4/5 顺序追加与并行读）。**锚点
复核成立，该切片不存在不推翻既有排除就能达门槛的候选。** 本轮第四组新角度
（分配避免、编排级 I/O 重叠、数据形状单态化）正是对「锚点之外还有没有面」的
穷举检验——结论：没有（§2–§3）。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S4-E-1 | `collectSignalsFromEvents` 空事件快路径（分配 5 个路由 Map + nowIso 之前提前返回 `[]`） | 免 5 Map + 数组 + 时间戳分配；命中面 = `adapt auto --project`（无 --run）以 `input.events ?? []` 空表调用 | ✅ 4000 fuzz + 3 显式空表用例逐位一致（副本保真另验） | 空表调用 **534–542ns/次**（副本对副本，四次稳定），但每次 `adapt auto --project` 进程恰一次；同命令必付 `discoverProject` + registry 载入 + save（~10²µs 级，R2-E 锚点）；E=41 非空路径 delta **四次测量异号**（+401/+26/+119/−7ns）纯抖动 | 淘汰：深度亚噪声——收益是**每进程一次的半微秒**，被同命令 I/O 以 ~10³× 支配（S1-E-4 同构） |
| S4-E-2 | `runAutoAdaptLoop` 内 `persistSignals` 与 `updateProjectBandit` 两个编排步骤 `Promise.all` 有界重叠 | 两步写不同文件（feedback jsonl / bandit.json），重叠省 min(两者)≈bandit 全事务 | ✅ 终态等价：S=12 顺序 vs 重叠两目录 feedback jsonl 与 bandit.json **逐字节一致**；❌ **双故障反例发散**：顺序恒浮出 persist 错误，重叠浮出先落定者（实测浮出 bandit 错误）——浮出错误由 I/O 时序决定，不再确定 | 实测省 **317–443µs/run**（1300–1405µs → 922–983µs），一次性 post-run | 淘汰：亚 ms 一次性收益低于否决线（S2-E-1 的 409–716µs 同级已否决）；双故障浮出错误非确定（S2-J-10 竞态同族）；且 feedback 追加与 bandit 写盘的跨文件次序在重叠下不再确定——两者分别被 S1-E-4/5（顺序追加语义）与 S2-E-4（锁内写通契约）点名保护 |
| S4-E-3 | `baseSignal` 隐藏类单态化：全 17 字段显式构造（缺失字段值 undefined），使下游循环（diagnose/bandit/persist）的属性访问 IC 单态 | 条件 spread 使 ObservedSignal 有指数级隐藏类组合 → 下游属性读 megamorphic；单态化消除 IC 失效 | ❌ **形状不等价**：JSON.stringify 投影相等（4000 fuzz 一致），但 `"modelId" in signal` false→true、`Object.keys` 8→18、`assert.deepStrictEqual` 发散——own-property 存在性是可观察公开面（S3-F-5「形状可观察」同族，测试即断言 deepEqual） | 即使忽略形状：同一逐字副本喂 poly vs mono 数据，S=12 diagnose 省 53–94ns、bandit-build 省 122–135ns；S=120 同量级——理论成立但绝对量深度亚噪声 | 淘汰：不等价（形状可观察）+ 即便等价也是 ns 级；且 undefined 值字段经 spread 拷贝传播到下游对象，污染 feedback record 构造的条件 spread 判定面 |

另有五处以既有排除/裁决直接覆盖、不立新 ID：`attributeToBoundary` 比较器
`BOUNDARY_ORDER.indexOf` 换 rank-Map/decorate（S1-E-7 + S3-B-2 域，test-only
面 P≤8）；`updateProjectBandit` 信号扫描移出文件锁外（S2-E-3/S3-E-4 域——
扫描仅占 ~450µs 锁事务的 0.2%，且 arms 并集依赖锁内 previous 读）；
`.map((signal) => parseObservedSignal(signal))` 换直接函数引用（extraSignals
现实为空/个位数，ns 级）；`persistSignals` 批量/并行 appendFeedback（R1-E §2
与 R2-E 已裁决顺序 jsonl 追加是数据面语义，且批量入口需扩 feedback 切片外
公开 API）；`issues.sort` G≤M 常数（平凡）。

## 3. 关键裁决细节

### 3.1 S4-E-2：本轮最强候选为何仍不落地

这是本轮唯一超过 100µs 的候选（实测 317–443µs/run，S=12 全信号带
episodeId 的重叠上界）。不落地的三条独立理由：

1. **量级**：亚 ms 一次性收益低于战役否决线——S2-E-1（409–716µs）、S2-D-4
   （116µs）、S1-I-1（190µs）均已否决；且真实 run 中 persist 面通常更小
   （仅带 episodeId 的信号写盘，track 环之外 episodeId 常缺失，重叠增益
   随之塌缩）。
2. **双故障确定性**：顺序 await 下浮出错误恒为 persist 侧（先执行者）；
   `Promise.all` 下浮出错误由两条 I/O 路径的落盘时序决定——仿真反例实测
   顺序浮出 `persist-error`、重叠浮出 `bandit-error`。`cli/main` 对
   `runAutoAdaptLoop` 的错误做 `adapt skipped: <message>` 打印，浮出错误
   文本是用户可观察面（S2-J-10 双故障竞态、S3-I-4 CliIo 可观察性同族）。
3. **数据面次序**：feedback jsonl 逐条追加序（S1-E-4/5 点名保护）与
   bandit.json 锁内写通（S2-E-4 点名保护）在顺序执行下有确定的跨文件全序
   （feedback 全部落盘 → bandit 落盘）；重叠使外部读者（并发 `adapt
   diagnose`、备份快照）可观察到 bandit 已更新而 feedback 未写完的中间态。
   两条被保护边的**组合次序**同样是数据面行为，不因单边未变而豁免。

终态字节等价（两目录 feedback jsonl 与 bandit.json 逐字节一致）已由仿真
确认——故本候选的等价性证据可为将来重开保留：若自适应环进入高频路径
（≥每 turn）或 S 增长 ≥2 个量级使重叠收益进入数十 ms 带，且错误浮出与
跨文件次序契约被正式放宽，可凭本报告重开。

### 3.2 S4-E-3：隐藏类理论被形状契约与规模双重否决

V8 IC 单态化是本切片前三轮未探过的角度：`baseSignal` 的 11 个条件 spread
使 ObservedSignal 实例携带不同 own-property 集合（实测 8 vs 18 keys），
下游 `diagnose`/`bandit-build` 的属性读确实 megamorphic。仿真用**同一逐字
副本**喂两种数据形状，确认理论方向为真（mono 一致更快）——但真实规模
（S=12）总节省 ~180–230ns/run，占切片 CPU 锚点（~18µs）的 ~1%，占同路径
I/O（~ms）的 ~0.02%。而形状本身是可观察公开面：`"modelId" in signal`、
`Object.keys`、`assert.deepStrictEqual` 三处发散（JSON 投影虽等价），
仓内测试与任何下游 spread 拷贝都能区分。与 S3-F-5（投影省略直接别名，
形状可观察）同族淘汰。为将来任何「信号对象单态化」提案立此双重证据：
收益上界 ~1% 切片 CPU + 形状契约破坏。

### 3.3 S4-E-1 与「分配避免」角度的收口

第四组角度里唯一等价且方向稳定的候选（空表调用 534–542ns 三次一致），
但其命中面经调用图穷举只有一处：`cli/adapt.ts` 的 `autoCommand` 在
`--project` 无 `--run` 时以 `input.events ?? []` 空表调用。该命令每进程
恰调用一次，同命令必付 `discoverProject`（文件系统扫描）+ registry 锁内
载入/保存（~10²µs–ms 级）——半微秒收益占比 ~10⁻³，S1-E-4 同构淘汰。
非空路径上快路径只增加一次 `length` 检查，E=41 四次 delta（+401/+26/
+119/−7ns）异号，确认纯抖动（S3-E-1 同带宽）。惰性 Map 分配变体
（首个 MODEL_ROUTED 时才建 5 Map）被此裁决支配：其收益面（有事件但无
路由的 run）更窄且异常态，不另立 ID。

## 4. 逐文件收口（前三轮收口之上的本轮新检查点）

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `signals.ts` | S4-E-1（空表快路径）、S4-E-3（baseSignal 单态化）淘汰；S1-E-1/2/3、S2-E-5/7、S3-E-1/5 维持 | 无候选 |
| `auto-loop.ts` | S4-E-2（persist∥bandit 编排重叠）淘汰并立双故障反例；`.map(parseObservedSignal)` 直接引用不立 ID；S1-E-4/5、S2-E-1、S3-E-2 维持 | 无候选 |
| `from-episode.ts` | 调用图复核 `adapt learn` 独立命令无双读；S2-E-2 维持（等价证据在案但噪声）；`Date.parse`/死参数维持前轮裁决 | 无候选 |
| `bandit-store.ts` | 锁外预扫不立 ID（§2 尾注：0.2% 占比 + arms 依赖锁内 previous）；S2-E-3/4、S3-E-4、X1-2 维持 | 无候选 |
| `diagnostics.ts` | S4-E-3 的 poly/mono 基准以本文件副本承载（数据形状角度收口）；S1-E-6、S3-E-3、恒真守卫维持 | 无候选 |
| `learned-routing.ts` | live 面无第四组新角度（S2-E-6 融合、X1-1 缓存、Iter4 M≤10 维持）；`stableProjectKey` 每 run 2 次 = X1-1 | 无候选 |
| `patterns.ts` / `attribution.ts` / `signatures.ts` | 本轮交叉检索复核仍零生产调用方；`attributeToBoundary` 比较器 decorate 不立 ID（S1-E-7 支配）；X2-6、S1-E-7/8 维持 | 无候选 |
| `task-success.ts` | S2-E-7 维持；`copyDefinedBinding`+`present()` 空白字段契约实施点不动 | 无候选 |

## 5. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 6. 测试

零代码改动下切片相关套件基线复核，全绿（Node 22.x / pnpm 10.17.1）：

```bash
npx tsx --test "test/unit/learning/*.test.ts" "test/acceptance/adaptive-loop.test.ts"
# tests 48 / suites 2 / pass 48 / fail 0
```

仿真（临时脚本 `/tmp/r4e-sim.mts`，未入库以遵守「无赢家不写死代码」；完整
源码见附录，seeds `0xe44e01`–`0xe44e08`）共 **4 次独立运行**（第 4 次从
本报告附录原文提取后复现），>12,000 项等价检查/次全部通过、等价结论逐位
一致。代表性一次运行：

```text
S4-E-1 bench empty events (replica-vs-replica): current=553ns cand=11ns delta=542ns/call (once per adapt-auto --project invocation)
S4-E-1 bench E=41 (replica-vs-replica): current=12470ns cand=12069ns delta=401ns/run
S4-E-2 bench S=12 real I/O: sequential=1300us overlapped=983us delta=317us/run (one-shot post-run)
S4-E-2 double-fault: sequential surfaces "persist-error", overlapped surfaces "bandit-error" -> surfaced-error determinism diverges
S4-E-3 shape counterexample: JSON.stringify equal=true; "modelId" in poly/mono=false/true; Object.keys=8/18; deepStrictEqual diverges=true -> NOT shape-equivalent
S4-E-3 bench real S=12 (same replica, poly vs mono data): diagnose 188ns vs 135ns (delta=54ns) | bandit-build 675ns vs 542ns (delta=133ns)
S4-E-3 bench 10x S=120 (same replica, poly vs mono data): diagnose 1180ns vs 1112ns (delta=68ns) | bandit-build 3775ns vs 3600ns (delta=176ns)
SLICE-CPU anchor re-verify: collect=10.2us outcomes=7.3us diagnose=0.15us bandit-build=0.7us | total in-slice CPU ~18.3us per run vs landing bar >=10000us (545x below even if zeroed)

ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

计时方向跨 4 次运行汇总：S4-E-1 空表 delta 稳定（542/539/534/540ns），
E=41 delta **四次异号**（+401/+26/+119/−7ns）确认纯抖动；S4-E-2 节省
317/334/408/443µs 方向稳定（亚 ms 带内）；S4-E-3 poly→mono 方向四次一致
（diagnose 54/94/53/90ns、bandit 133/135/126/122ns @ S=12）；SLICE-CPU
总量 18.1–18.5µs 稳定；双故障反例与形状反例四次逐位一致。

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S4-E-1 | collectSignalsFromEvents 空事件快路径 / 惰性路由 Map 分配 | 等价且方向稳定（534–542ns/次）但命中面仅 `adapt auto --project` 每进程一次，被同命令 ~10²µs 级 I/O 以 ~10³× 支配；非空路径 delta 纯抖动 |
| S4-E-2 | runAutoAdaptLoop persistSignals∥updateProjectBandit 编排重叠 | 终态字节等价、省 317–443µs 亚 ms 一次性（低于否决线，S2-E-1 同级）；双故障浮出错误非确定（反例在案）；feedback 追加序 × bandit 锁内写通的跨文件全序是数据面行为（S1-E-4/5 + S2-E-4 组合面） |
| S4-E-3 | baseSignal 隐藏类单态化（全字段显式 undefined 构造） | 形状不等价：own-property 存在性可观察（in/Object.keys/deepStrictEqual 三处发散，S3-F-5 同族）；即使忽略形状，S=12 仅省 ~180–230ns/run（切片 CPU 的 ~1%） |

重开条件：S4-E-1 若 `adapt auto --project` 空表路径进入高频循环（≥每 turn）
可凭等价证据重开；S4-E-2 需同时满足（a）自适应环进入高频路径或 S 增长
≥2 个量级使重叠收益达数十 ms 带，（b）错误浮出文本与跨文件写序契约被正式
放宽——终态等价证据本报告在案；S4-E-3 需先把 ObservedSignal 的形状（own-
property 集合）声明为非契约（含仓内 deepEqual 断言迁移），且信号规模增长
≥2 个量级。切片级重开总条件维持 R3-E §7：SLICE-CPU 锚点失效（全切片 CPU
增长 ≥2 个量级，本轮复核值 18.1–18.5µs）或任一 I/O 契约排除（X0-3 /
S2-E-1/4 / S1-G-1 / S1-E-4/5）被正式推翻。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.mts` 后在仓库根目录 `npx tsx <file>`（依赖已装）。
seeds：`0xe44e01`–`0xe44e08`。

```ts
/**
 * R4-E deterministic equivalence + benchmark simulation (fourth pass over
 * src/learning/). Adjudicates fresh candidates S4-E-1 .. S4-E-3 against the
 * current implementations and re-verifies the R3-E SLICE-CPU anchor.
 * Seeded PRNG (mulberry32) -> fully reproducible. Seeds: 0xe44e01 - 0xe44e08.
 *
 * Reference = production imports (equivalence role + absolute-magnitude
 * anchors). ns-delta benchmarks are replica-vs-replica per the S3-E-3
 * methodology lesson. Replicas keep every already-excluded edit UNAPPLIED
 * (independent if-chains, judge double-get, sequential appendFeedback, ...).
 */
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { deepStrictEqual } from "node:assert";
import {
  collectSignalsFromEvents,
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
import { updateProjectBandit } from "/workspace/src/learning/bandit-store.js";
import { createBanditState, recordReward, type BanditState } from "/workspace/src/routing/bandit.js";
import { oneHotDistribution } from "/workspace/src/routing/catalog-model.js";
import { AGENT_ROLES } from "/workspace/src/domain/roles.js";
import { appendFeedback, feedbackLogPath } from "/workspace/src/feedback/store.js";
import type { FeedbackRecord, FeedbackKind } from "/workspace/src/feedback/types.js";
import { createEvidenceId, isEvidenceId, type EpisodeId, type ProjectId } from "/workspace/src/domain/ids.js";
import { hash32 } from "/workspace/src/domain/hash.js";
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

const NOW = "2026-08-24T07:00:00.000Z" as IsoTimestamp;

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

/* ================================================================
 * S4-E-1 candidate: empty-events fast path (return [] before allocating
 * the five route maps + nowIso). Everything else stays verbatim.
 * Production shape it targets: `adapt auto --project` (no --run) calls
 * runAutoAdaptLoop with events undefined -> collectSignalsFromEvents([], ctx).
 * ================================================================ */
function candidateCollectFastEmpty(events: readonly Event[], context: SignalContext = {}): ObservedSignal[] {
  if (events.length === 0) return []; // candidate edit
  return replicaCollectCurrent(events, context);
}

/* Seeded event-log generator (R1-A composition: E~41). */
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
  const rng = mulberry32(0xe44e01);
  for (let trial = 0; trial < 4000; trial += 1) {
    const events = genEvents(rng, Math.floor(rng() * 60), { forceProject: rng() < 0.9 });
    const ctx: SignalContext = rng() < 0.5 ? { episodeId: "ep_simsim01" as EpisodeId } : {};
    const expected = norm(collectSignalsFromEvents(events, ctx));
    check(
      "S4-E-1 equivalence (fast-empty candidate == production)",
      expected === norm(candidateCollectFastEmpty(events, ctx)),
      `trial ${trial}`
    );
    check(
      "S4-E-1 replica fidelity (verbatim copy == production)",
      expected === norm(replicaCollectCurrent(events, ctx)),
      `trial ${trial}`
    );
  }
  // explicit empty-events cases (the targeted production shape)
  for (const ctx of [{}, { projectId: "prj_simsim01" as ProjectId }, { episodeId: "ep_simsim01" as EpisodeId }] as SignalContext[]) {
    check(
      "S4-E-1 empty-events equivalence",
      norm(collectSignalsFromEvents([], ctx)) === norm(candidateCollectFastEmpty([], ctx))
    );
  }
  // replica-vs-replica bench: empty events (production `adapt auto --project` shape)
  const empty: Event[] = [];
  const curEmpty = bench(() => void replicaCollectCurrent(empty, { projectId: "prj_simsim01" as ProjectId }), 200000);
  const candEmpty = bench(() => void candidateCollectFastEmpty(empty, { projectId: "prj_simsim01" as ProjectId }), 200000);
  // replica-vs-replica bench: E=41 (fast path is one extra length check)
  const events41 = genEvents(mulberry32(0xe44e02), 40);
  const cur41 = bench(() => void replicaCollectCurrent(events41, {}), 20000);
  const cand41 = bench(() => void candidateCollectFastEmpty(events41, {}), 20000);
  console.log(
    `S4-E-1 bench empty events (replica-vs-replica): current=${(curEmpty * 1e6).toFixed(0)}ns cand=${(candEmpty * 1e6).toFixed(0)}ns delta=${((curEmpty - candEmpty) * 1e6).toFixed(0)}ns/call (once per adapt-auto --project invocation)`
  );
  console.log(
    `S4-E-1 bench E=41 (replica-vs-replica): current=${(cur41 * 1e6).toFixed(0)}ns cand=${(cand41 * 1e6).toFixed(0)}ns delta=${((cur41 - cand41) * 1e6).toFixed(0)}ns/run`
  );
}

/* ================================================================
 * S4-E-2: overlap persistSignals and updateProjectBandit with Promise.all
 * inside runAutoAdaptLoop (bounded 2-way concurrency, NOT the unbounded
 * S1-E-5 read fan-out). persistSignals replica is verbatim from auto-loop.ts.
 * (a) final on-disk state equivalence (feedback jsonl + bandit.json bytes)
 * (b) real-I/O benchmark sequential vs overlapped at S=12
 * (c) double-fault determinism counterexample: surfaced error diverges
 * ================================================================ */
async function persistSignalsReplica(stateRoot: string, signals: readonly ObservedSignal[]): Promise<void> {
  for (const signal of signals) {
    if (signal.episodeId === undefined) continue;
    const record: FeedbackRecord = {
      id: `fbk_${hash32(`${signal.summary}:${signal.score}:${signal.modelId ?? ""}`)}`,
      episodeId: signal.episodeId,
      kind: signal.kind,
      rubricVersion: "auto-loop-v1",
      score: signal.score,
      evidenceRefs: signal.evidenceIds.filter(isEvidenceId).length > 0
        ? signal.evidenceIds.filter(isEvidenceId)
        : [createEvidenceId(() => hash32(signal.summary).padStart(8, "0"))],
      redacted: false,
      createdAt: signal.createdAt,
      summary: signal.summary,
      ...(signal.runId !== undefined ? { runId: signal.runId } : {}),
      ...(signal.taskId !== undefined ? { taskId: signal.taskId } : {})
    };
    await appendFeedback(stateRoot, record);
  }
}

function genPersistSignal(rng: () => number, models: readonly string[]): ObservedSignal {
  const criterion = pick(rng, ["taskSuccess", "userAcceptance", undefined] as const);
  return baseSignal({
    source: pick(rng, ["subagent", "deterministic"] as const),
    kind: "deterministic",
    projectId: "prj_simsim01" as ProjectId,
    score: Math.floor(rng() * 101),
    boundary: "execution",
    summary: `signal summary ${Math.floor(rng() * 1000)}`,
    createdAt: NOW,
    episodeId: "ep_simsim01" as EpisodeId,
    evidenceIds: rng() < 0.5 ? ["evd_00000001"] : [],
    ...(rng() < 0.9 ? { modelId: pick(rng, models) } : {}),
    ...(criterion !== undefined ? { criterion } : {}),
    ...(rng() < 0.8 ? { outcomeKind: pick(rng, ["PASS", "FAIL"] as const) } : {})
  });
}

{
  const rng = mulberry32(0xe44e03);
  const models = ["m1", "m2", "m3", "m4", "m5"];
  const signals = Array.from({ length: 12 }, () => genPersistSignal(rng, models));
  const projectRoot = "/tmp/proj-r4e";

  // (a) final-state equivalence: sequential dir vs overlapped dir
  const dirSeq = await mkdtemp(join(tmpdir(), "r4e-seq-"));
  const dirPar = await mkdtemp(join(tmpdir(), "r4e-par-"));
  await persistSignalsReplica(dirSeq, signals);
  await updateProjectBandit(dirSeq, projectRoot, signals);
  await Promise.all([
    persistSignalsReplica(dirPar, signals),
    updateProjectBandit(dirPar, projectRoot, signals)
  ]);
  const [fbSeq, fbPar] = await Promise.all([
    readFile(feedbackLogPath(dirSeq), "utf8"),
    readFile(feedbackLogPath(dirPar), "utf8")
  ]);
  check("S4-E-2 final feedback jsonl bytes identical", fbSeq === fbPar);
  const { stableProjectKey } = await import("/workspace/src/learning/learned-routing.js");
  const { adaptationRoot } = await import("/workspace/src/privacy/state-layout.js");
  const banditPathOf = (root: string): string =>
    join(adaptationRoot(root), "learning", "projects", stableProjectKey(projectRoot), "bandit.json");
  const [bdSeq, bdPar] = await Promise.all([
    readFile(banditPathOf(dirSeq), "utf8"),
    readFile(banditPathOf(dirPar), "utf8")
  ]);
  check("S4-E-2 final bandit.json bytes identical", bdSeq === bdPar);

  // (b) real-I/O bench: fresh dirs per strategy, 30 reps
  const benchDirSeq = await mkdtemp(join(tmpdir(), "r4e-bseq-"));
  const benchDirPar = await mkdtemp(join(tmpdir(), "r4e-bpar-"));
  const seqCost = await benchAsync(async () => {
    await persistSignalsReplica(benchDirSeq, signals);
    await updateProjectBandit(benchDirSeq, projectRoot, signals);
  }, 30);
  const parCost = await benchAsync(async () => {
    await Promise.all([
      persistSignalsReplica(benchDirPar, signals),
      updateProjectBandit(benchDirPar, projectRoot, signals)
    ]);
  }, 30);
  console.log(
    `S4-E-2 bench S=12 real I/O: sequential=${(seqCost * 1e3).toFixed(0)}us overlapped=${(parCost * 1e3).toFixed(0)}us delta=${((seqCost - parCost) * 1e3).toFixed(0)}us/run (one-shot post-run)`
  );

  // (c) double-fault determinism counterexample
  const failAfter = (ms: number, tag: string): Promise<never> =>
    new Promise((_, reject) => setTimeout(() => reject(new Error(tag)), ms));
  let seqError = "";
  try {
    await failAfter(20, "persist-error");
    await failAfter(1, "bandit-error");
  } catch (error) {
    seqError = (error as Error).message;
  }
  let parError = "";
  try {
    await Promise.all([failAfter(20, "persist-error"), failAfter(1, "bandit-error")]);
  } catch (error) {
    parError = (error as Error).message;
  }
  check(
    "S4-E-2 double-fault counterexample must diverge (seq surfaces persist error, overlap surfaces fastest)",
    seqError === "persist-error" && parError === "bandit-error"
  );
  console.log(
    `S4-E-2 double-fault: sequential surfaces "${seqError}", overlapped surfaces "${parError}" -> surfaced-error determinism diverges`
  );
}

/* ================================================================
 * S4-E-3: baseSignal hidden-class monomorphization — construct every
 * ObservedSignal with all 17 fields (explicit undefined) so downstream
 * loops see one hidden class instead of many.
 * (a) shape counterexample: JSON identical but own-property presence
 *     observable (in-operator, Object.keys, deepStrictEqual)
 * (b) data-shape bench through the SAME verbatim diagnose/bandit replicas
 * ================================================================ */
function baseSignalMono(input: BaseSignalInput): ObservedSignal {
  return {
    source: input.source,
    kind: input.kind,
    projectId: input.projectId,
    score: input.score,
    boundary: input.boundary,
    summary: input.summary,
    createdAt: input.createdAt,
    evidenceIds: input.evidenceIds ?? [],
    modelId: input.modelId,
    modelVersion: input.modelVersion,
    role: input.role,
    family: input.family,
    featureVersion: input.featureVersion,
    criterion: input.criterion,
    outcomeKind: input.outcomeKind,
    episodeId: input.episodeId,
    runId: input.runId,
    taskId: input.taskId
  } as ObservedSignal;
}

/** Verbatim diagnose replica (same as R3-E fair-bench replica). */
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
    const first = group[0];
    if (first === undefined || first.modelId === undefined) continue;
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
  return issues.sort((left, right) => left.meanScore - right.meanScore);
}
/** Verbatim in-lock bandit build replica (same as R2-E/R3-E). */
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

function genShapeInput(rng: () => number): BaseSignalInput {
  const criterion = pick(rng, ["taskSuccess", "userAcceptance", "policyCompliance", undefined] as const);
  return {
    source: pick(rng, ["user", "subagent", "deterministic"] as const),
    kind: pick(rng, ["human", "peer", "judge", "deterministic"] as const) as FeedbackKind,
    projectId: pick(rng, ["prj_a0000000", "prj_b0000000"]) as ProjectId,
    score: Math.floor(rng() * 101),
    boundary: "execution",
    summary: "s",
    createdAt: NOW,
    ...(rng() < 0.85 ? { modelId: pick(rng, ["m1", "m2", "m3", "  ", ""]) } : {}),
    ...(criterion !== undefined ? { criterion } : {}),
    ...(rng() < 0.7 ? { family: pick(rng, FAMS) } : {}),
    ...(rng() < 0.5 ? { outcomeKind: pick(rng, ["PASS", "FAIL"] as const) } : {}),
    ...(rng() < 0.5 ? { episodeId: "ep_simsim01" as EpisodeId } : {})
  };
}

{
  // (a) shape counterexample
  const input: BaseSignalInput = {
    source: "subagent",
    kind: "deterministic",
    projectId: "prj_a0000000" as ProjectId,
    score: 90,
    boundary: "execution",
    summary: "s",
    createdAt: NOW
  };
  const poly = baseSignal(input);
  const mono = baseSignalMono(input);
  const jsonEqual = JSON.stringify(poly) === JSON.stringify(mono);
  const inDiverges = !("modelId" in poly) && "modelId" in mono;
  const keysDiverge = Object.keys(poly).length !== Object.keys(mono).length;
  let deepEqualDiverges = false;
  try {
    deepStrictEqual(poly, mono);
  } catch {
    deepEqualDiverges = true;
  }
  check(
    "S4-E-3 shape counterexample (JSON equal but own-property shape observable)",
    jsonEqual && inDiverges && keysDiverge && deepEqualDiverges
  );
  console.log(
    `S4-E-3 shape counterexample: JSON.stringify equal=${String(jsonEqual)}; "modelId" in poly/mono=${String("modelId" in poly)}/${String("modelId" in mono)}; Object.keys=${Object.keys(poly).length}/${Object.keys(mono).length}; deepStrictEqual diverges=${String(deepEqualDiverges)} -> NOT shape-equivalent`
  );

  // fuzz: JSON projection stays equal across arbitrary field mixes
  const rng = mulberry32(0xe44e04);
  for (let trial = 0; trial < 4000; trial += 1) {
    const shapeInput = genShapeInput(rng);
    check(
      "S4-E-3 JSON projection parity",
      JSON.stringify(baseSignal(shapeInput)) === JSON.stringify(baseSignalMono(shapeInput)),
      `trial ${trial}`
    );
  }

  // (b) data-shape bench through the same verbatim replicas
  for (const [label, count, reps] of [["real S=12", 12, 40000], ["10x S=120", 120, 5000]] as const) {
    const shapeRng = mulberry32(0xe44e05 + count);
    const inputs = Array.from({ length: count }, () => genShapeInput(shapeRng));
    const polySignals = inputs.map((item) => baseSignal(item));
    const monoSignals = inputs.map((item) => baseSignalMono(item));
    const diagPoly = bench(() => void replicaDiagnose(polySignals), reps);
    const diagMono = bench(() => void replicaDiagnose(monoSignals), reps);
    const prevRng = mulberry32(0xe44e06 + count);
    const previous = replicaBanditBuild(
      undefined,
      Array.from({ length: 30 }, () => baseSignal(genShapeInput(prevRng)))
    );
    const banditPoly = bench(() => void replicaBanditBuild(previous, polySignals), reps);
    const banditMono = bench(() => void replicaBanditBuild(previous, monoSignals), reps);
    console.log(
      `S4-E-3 bench ${label} (same replica, poly vs mono data): diagnose ${(diagPoly * 1e6).toFixed(0)}ns vs ${(diagMono * 1e6).toFixed(0)}ns (delta=${((diagPoly - diagMono) * 1e6).toFixed(0)}ns) | bandit-build ${(banditPoly * 1e6).toFixed(0)}ns vs ${(banditMono * 1e6).toFixed(0)}ns (delta=${((banditPoly - banditMono) * 1e6).toFixed(0)}ns)`
    );
  }
}

/* ================================================================
 * SLICE-CPU anchor re-verification (R3-E): total in-slice CPU on one
 * full auto-adapt run at real scale vs the campaign landing bar (>=10ms).
 * Production imports carry the absolute-magnitude anchor role.
 * ================================================================ */
{
  const events = genEvents(mulberry32(0xe44e07), 40);
  const collectCost = bench(() => void collectSignalsFromEvents(events, {}), 20000);

  const FAMILIES_LOCAL: readonly TaskFamily[] = ["edit", "test", "review", "plan", "research", "refactor", "deploy", "unknown"];
  const rng = mulberry32(0xe44e07 + 1);
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

  const sRng = mulberry32(0xe44e07 + 2);
  const signals12 = Array.from({ length: 12 }, () => baseSignal(genShapeInput(sRng)));
  const diagnoseCost = bench(() => void diagnoseModelProjectIssues(signals12), 40000);

  const bRng = mulberry32(0xe44e08);
  const previous = replicaBanditBuild(
    undefined,
    Array.from({ length: 30 }, () => baseSignal(genShapeInput(bRng)))
  );
  const banditSignals = Array.from({ length: 12 }, () => baseSignal(genShapeInput(bRng)));
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
