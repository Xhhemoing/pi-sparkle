MODEL_SLUG=claude-fable-5-thinking-xhigh

# R7-J：数据面切片（cluster / privacy / preferences / episode / persist / track / context / feedback）第七遍复查报告

**战役:** 全库持久 SOTA 优化 Round 7 / R7-J
**基线:** `cursor/sota-persistent-opt-83a1` @ `75b0387`
**分支:** `cursor/r7-j-persist-seventh-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 切片 29 个文件（`src/cluster/` 3、
`src/privacy/` 3、`src/preferences/` 7、`src/episode/` 5、`src/persist/` 2、
`src/track/` 4、`src/context/` 2、`src/feedback/` 3，共 3655 行）自 R1-J 落地
J1（`fb41417`）以来**逐字节未变**（本轮核对 `git diff fb41417..75b0387 --
<切片>` 为空 0 行；R6-J 之后落地的 S7-F-1/S7-F-2 均在 `src/experiments/`，
切片外零碰），R1-J 的逐文件收口与 S1-J-1..7、S2-J-1..11、S3-J-1..6、
S4-J-1..6、S5-J-1..6、S6-J-1..6 共四十二条排除全部继承有效。本轮在完整
排除表（含 R7 已产出的 S7-A/B/D/E/F/G/H-* 与已落地的 S7-F-1/S7-F-2）之上
第七次全量实际读码、以「排序取首元素 / 目的地双遍 / 回调内模板字面量 /
get-push-set 三连 / 无文本脱敏预处理 / 每写 mkdir」六个此前从未被点名的
微观形态角度枚举，得到 6 个新候选（S7-J-1 … S7-J-6），全部经理论 +
确定性仿真（seeded mulberry32，8 项等价断言 × 3 次独立运行逐位一致；
S7-J-1/2 以生产 `compileContextPacket` 为基准做 60 seeds 端到端逐字节
fidelity+等价；S7-J-3 对生产 `decideClosure` 200 seeds、S7-J-5 对生产
`redactFeedback` 100 seeds × 4 记录形态 × 5 策略含身份断言）裁决后淘汰：
**全部候选在真实调用规模下是 ns–µs 级**，最大者 S7-J-1（`pickCanonical`
拷贝排序换首元素 min-scan）端到端每次 packet 编译仅省 1.3–2.5µs、按每 run
16 个 child 计 **0.02–0.04ms/run**，距数十 ms 落地线约三个数量级；S7-J-4
（`rebuildViews` 分组三连中的冗余 `Map.set`）省 8.8–10.5µs@N=1000，但同
路径**紧随其后的 `saveToDisk` 全量落盘实测 638–817µs**（占比 ~1.3%，
S2-J-6 的 I/O 支配判据第七次成立）；S7-J-6（`saveToDisk` 每写 `mkdirSync`
缓存化）是**自愈语义收窄**（外部删目录后当前每写重建、缓存后改为 ENOENT
崩溃——persist 耐久性语义强调区）且实测冗余 mkdir 仅 1.08µs（写地板的
~0.15%）。未重开任何 X* / S1-* / S2-* / S3-* / S4-* / S5-* / S6-* /
S7-A/B/D/E/F/G/H-* 条目。J1 落地代码本轮 `scripts/r1j-equivalence-sim.ts`
重跑全绿（2468 项逐位检查，2719.4×），并本轮 re-grep 再证
`evaluatePreferenceLoop` 仍无生产调用方。数据面（删除/脱敏/状态布局、
mailbox、episode 闭合、jsonl 锁语义）**零 diff**，可见行为天然不变。
复杂度类层面第七遍扫描后切片内仍无任何随无上界维度超线性的路径。J1 之上
本切片在其数据面契约下经七遍穷尽复查仍为 SOTA。

## 0. 范围与约束遵守

- 切片：`src/cluster/`、`src/privacy/`、`src/preferences/`、`src/episode/`、
  `src/persist/`、`src/track/`、`src/context/`、`src/feedback/`。29 个文件
  本轮全部第七次实际读码，未依赖 R1-J..R6-J 的记忆。
- 先读并遵守（顺序强制）：README → EXCLUSIONS.md（含全部 S7-* 新行与已
  落地 S7-F-1/S7-F-2）→ round-07/PLAN.md → round-01/R1-J.md → … →
  round-06/R6-J.md。
- 未编辑任何生产文件；未编辑 EXCLUSIONS.md / PROGRESS.md（父代理所有）；
  未触碰 `src/experiments/`（S7-F-1/S7-F-2 刚落地）。
- 排除表遵守：候选枚举刻意绕开全部既有排除——S1-J-1..7、S2-J-1..11、
  S3-J-1..6、S4-J-1..6、S5-J-1..6、S6-J-1..6 共四十二条全部不再提案。
  特别地：**J1 落地代码未回退未重做**（`loop-eval.ts` 与 `fb41417` 逐字节
  一致，`scripts/r1j-equivalence-sim.ts` 重跑全绿 2468 checks / 2719.4×）；
  **R6-J 六条全部零碰**（级联尾部写序 S6-J-1、loop-eval 键控形态 S6-J-2、
  collapseFacts entries 直迭 S6-J-3、waitForClarification 攒批 S6-J-4、
  reducer 别名快路径 S6-J-5、generatedHints 第三 spread S6-J-6——本轮
  S7-J-1 裁的是 `pickCanonical` 组内取首，与 S6-J-3 的**组间迭代**是同函数
  不同站点；S7-J-2 裁的是 selected→destination 双遍，与 S4-J-4 的
  omissions 双遍是同文件不同站点；S7-J-3 裁的是 legacyMatch 回调内模板
  字面量，与 S2-J-8 的 evidenceRefs Set 化是同函数不同表达式；S7-J-4 与
  S5-J-4 的 mailbox enqueue 同型但站点在 preferences——非 mailbox 数据面，
  故按新站点独立裁决）；**S3-J-1 遵守**（`stripForbidden` 顺序剥除语义
  零碰——S7-J-5 只裁其**调用前的 needle 预处理**在无文本时是否可跳过，
  剥除算法与顺序一字未动）；**S1-J-1/S3-J-5 遵守**（`rebuildViews` 重建
  语义与 `lastUpdated` 可观察面零碰——S7-J-4 只裁分组循环内一次冗余
  `Map.set`，输出与时间戳分布不变）；写并行 / batch-append / alias-return
  三族按 PLAN 指令未重开。
- **数据面强调区零 diff**：`privacy/deletion.ts` 级联 I/O 序（S6-J-1 判定
  「完整 I/O 序即契约」维持）、`persist/file-lock.ts` wx/ownerToken/重试、
  `persist/jsonl.ts` 截尾恢复与每 append mkdir 自愈、`cluster/mailbox.ts`
  role 队列 claim、`episode/manager.ts` fail-closed reducer——可见行为
  天然不变。S7-J-6 对 `preferences/store.ts` `saveToDisk` 的 mkdir 缓存化
  正因踩到同款自愈语义而被理论否决（见 §3）。
- 规格强制双路（Beta LCB vs 正态 LCB；offline-logit vs 概率可加）不在本区。
  分析不改 in-flight；Tracking 无命令权。不声称 Outcome-supported；
  Checkpoint F-PROD 仍开放（ADR-005）。不改阈值、权限、数据面契约、公开
  签名；未改任何测试。
- 仓库变更仅本报告一个文件。无赢家，未落仿真脚本（完整源码见附录；开发中
  曾临时置于 `scripts/round07-r7j-adjudication-sim.ts` 运行三次，提交前
  删除）。

## 1. 规模与门槛基底（第七遍继承 + 本轮校准）

R1-J..R6-J 已实测本切片规模：episode 内 run 数、cluster peer 数
（≤ maxTasks=16）、track 子任务数（C≤~6）、context 构建输入（十位级）、
redaction needles（=4）全部为小常数；**唯一无上界增长维度是 preference
观察数 N 与 feedback 记录数 N**，两者的插入/读取路径均被同路径的全量 JSON
序列化 + 磁盘 I/O 支配（R2-J ~50×、R5-J ~157–226×，本轮再测 N=1000 档
`saveToDisk` 地板 **638–817µs/写** vs 其前分组循环可省量 8.8–10.5µs）。
代码逐字节未变，全部继承。本轮生产调用面 re-grep 校准：
`compileContextPacket` 唯一生产调用方 `run/child-grounding.ts:48`（每
child 一次，≤16/run）；`decideClosure` 调用方 `run/episode-bind.ts:181` 与
`cli/episode.ts:105`（每 episode 闭合尝试一次）;`redactFeedback` 唯一生产
调用方 `feedback/store.ts:39`（appendFeedback，后随 jsonl 磁盘追加）；
`evaluatePreferenceLoop` 仍无生产调用方（仅单测与 r1j 仿真脚本，S2-J-1/
S6-J-2 判据第七次成立）。

战役落地线继承：已落地项在数十 ms 级或复杂度类下降（J1 2770×、S1-C
~450ms/fit、S3-C ~140–155ms、S6-C/S6-F-1、S7-F-1/S7-F-2 175.0→120.5ms），
µs 级候选一律被否决过（S1-I-1 ~190µs、S3-D-3 351–388µs、S4-J-3 60–62µs、
S5-J-3 74.8–86.2µs、S6-J-1 199–308µs）。本轮全部合法候选的绝对收益上界是
**82–95µs**（S7-J-1 压力档 ~2400 facts、S7-J-3 压力档 C=64/R=512——两者
均为超现实 30×+ 夹具）；真实调用规模下全部候选是 ns–µs 级，端到端最大
per-run 收益 0.02–0.04ms（S7-J-1+S7-J-2 合计）。没有候选接近数十 ms
落地线；复杂度类层面，七遍扫描后切片内已无任何随无上界维度超线性的路径。
据此裁决。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S7-J-1 | `context/packet.ts` `pickCanonical` 的 `[...facts].sort(cmp)[0]`（每 fact 值组一次防御拷贝 + 全排序只为取首元素），候选换 first-on-tie 单遍 min-scan（稳定排序取 [0] ≡ 平局保先者的最小扫描） | 免每组 O(g log g) 排序与 O(g) 拷贝，组数 K 随 facts 增长 | ✅ 60 seeds 端到端：仿真副本 vs 生产 `compileContextPacket` 逐字节一致（fidelity），min-scan 变体 vs 生产逐字节一致（平局密集值池强制触发同 trust+hash+freshness 精确平局）；✅ 精确平局身份断言：两侧均取第一个元素（`===`） | `collapseFacts` 现实档 ~81 facts：base 13.8–14.3µs vs 变体 11.2–11.7µs → 省 **2.1–2.9µs/编译**；压力档 ~2393 facts 省 68.9–95.0µs；端到端 `compileContextPacket` 现实档省 1.3–2.5µs/次、每 run ≤16 次 child 编译 → **0.02–0.04ms/run** | 淘汰：距数十 ms 落地线约**三个数量级**；压力档 30× 超现实夹具下仍 <0.1ms；每 child 一次性编译路径无重复调用放大。本轮唯一方向稳定的合法候选，证据入库供重开 |
| S7-J-2 | `context/packet.ts` `compileContextPacket` 的 selected→`requiredFacts`/`relevantFiles` 两次 filter+map（四次遍历），候选融合为单遍 push 分流 | 免 3 次冗余遍历与 2 个中间数组 | ✅ 已并入 S7-J-1 的 60 seeds 端到端逐字节等价（变体同时含 S7-J-1+S7-J-2，输出与生产逐位一致） | 120 selected 档：base 787–813ns vs 变体 370–385ns → 省 **408–443ns/编译**；已计入上行 0.02–0.04ms/run 合计 | 淘汰：S4-J-4（omissions 双遍融合，9–87ns）同文件同族的第二站点，ns 级常数噪声 |
| S7-J-3 | `episode/closure.ts` `decideClosure` 的 `legacyMatch` 中模板字面量 `` `evd_${criterion.id}` `` 位于 `.some()` 回调**内**——每 evidenceRef 重建一次（C×R 次构串），候选提升为每 criterion 一次的 const（C 次） | C×R→C 次字符串构建与哈希 | ✅ 200 seeds（随机 C/R、结构化/legacy 证据混合、三态 status、acceptanceEvidence 有无）vs 生产 `decideClosure` JSON 逐位一致 | 现实档 C=6,R=24：base 864–889ns vs 变体 436–470ns → 省 **419–445ns/闭合判定**；压力档 C=64,R=512 省 82.3–83.4µs（超现实：真实 episode 验收标准个位、evidenceRefs 十位）| 淘汰：每 episode 闭合尝试一次的路径，现实档 ns 级；S2-J-8（同函数 evidenceRefs Set 化 ~800ns）同域同量级判据 |
| S7-J-4 | `preferences/store.ts` `rebuildViews` 分组循环 `byPair.get(key) ?? []` → push → **无条件 `byPair.set`** 三连，候选改条件 set（列表已存在时跳过冗余写） | 免 N−K 次冗余 Map.set | ✅ 50 seeds 分组输出结构等价 + **逐元素身份**（`===`）一致 | N=1000,P=20 档：base 57.2–60.2µs vs 变体 48.3–49.7µs → 省 **8.8–10.5µs/重建**；但同一 `applyObservation` 路径紧随其后的 `saveToDisk`（全量 stringify+writeFileSync+mkdirSync）实测 **638–817µs/写** → 可省量占 ~1.3% | 淘汰：S2-J-6 的 I/O 支配判据原样适用（那轮裁的是同函数 filter→计数）；S5-J-4（mailbox enqueue 同型三连，6.2–6.6ns）家族第二站点——本站点因 N 无上界数字更大但仍被两个数量级的同路径 I/O 地板吞没 |
| S7-J-5 | `feedback/redaction.ts` `redactFeedback` 在 `body` 与 `summary` **均缺席**时仍执行 needles 拷贝+filter+sort 预处理，候选在无文本时整体跳过（`stripForbidden` 本体与调用序一字未动） | 免无输入时的 O(K log K) 预处理 | ✅ 100 seeds × 4 记录形态（body/summary 有无四象限）× 5 策略（needles 有/无/空串/含空、maxBodyChars、redactPII）vs 生产 `redactFeedback` JSON 逐位一致 + 非脱敏路径**输入对象身份**保持断言 | 无文本档 32 needles：base 1386–1413ns vs 变体 17ns → 省 **1.37–1.40µs/条**；但仅命中 body+summary 双缺席的稀有记录形态（生产 feedback 常有 body），且调用点 `appendFeedback` 后随 jsonl 磁盘追加 | 淘汰：S2-J-9（needles 排序提升模块常量，I/O 支配）同域——本变体虽避开 X1-1 邻域的跨调用缓存，仍是稀有形态 + I/O 支配双重不达线 |
| S7-J-6 | `preferences/store.ts` `saveToDisk` 每写 `mkdirSync(dirname, {recursive})`，候选首写后缓存目录已建标志 | 免每写一次冗余 mkdir 系统调用 | ❌ 未做等价仿真——**理论否决**：当前形态下外部删除状态目录后下一次 save 自动重建（自愈）；缓存化使后续 `writeFileSync` 抛 ENOENT——崩溃面拓宽，persist 耐久性语义强调区（`persist/jsonl.ts` 每 append mkdir 的同款自愈语义，R3-J 已按 S5-G-1/S6-E-3 同型裁过） | 实测已存在目录的 `mkdirSync` 仅 **1.08µs/次**，同函数写地板 638–817µs 的 ~0.15% | 淘汰：自愈语义收窄（fail-open→crash 面变化即行为回归，方向与「fail-open 拓宽」相反但同属崩溃面契约改动）+ µs 级 + I/O 支配，三重淘汰 |

## 3. 关键裁决细节

### S7-J-1：本轮唯一方向稳定的合法候选为何仍差三个数量级

`pickCanonical` 是 `collapseFacts` 每个 (key,value) 组的正典选择器，
`[...facts].sort(cmp)[0]` 对组内做防御拷贝 + 完整排序只为取比较序最小者。
稳定排序（ES2019）的 `[0]` 恰等于「平局保最先出现者」的单遍 min-scan——
变体在平局密集值池（同 trust+hash+freshness 重复元素）下经 60 seeds 端到端
与精确平局身份断言双重验证逐位等价。它也是七遍读码以来 packet 编译路径上
第一个**方向稳定**（三次独立运行同向）的加速。不落地的量化理由：现实档
（~81 facts，成熟 index 规模）每次编译省 2.1–2.9µs，端到端 1.3–2.5µs；
`compileContextPacket` 的唯一生产调用方是 `run/child-grounding.ts`（每
child 一次，≤16/run），合计 **0.02–0.04ms/run**——距数十 ms 落地线约
1000×。把 facts 推到 ~2400（30× 超现实）也只省 68.9–95.0µs。S6-J-2 的
判据原样适用：µs 级方向稳定不构成落地资格。证据（含平局身份断言）入库
供重开条件使用。

### S7-J-4：preferences 增长维度上的 CPU 微收益第三次被同路径 I/O 地板吞没

分组三连（get-??-push-set）的冗余 `Map.set` 在 N=1000 档省 8.8–10.5µs，
是 S5-J-4 同型（mailbox enqueue，6.2–6.6ns）在唯一无上界维度上的放大版。
但 `rebuildViews` 的两个调用方（`applyObservation`、`deleteObservation`）
均紧随 `saveToDisk`——本轮实测同 N 档全量 stringify+writeFileSync+
mkdirSync 地板 638–817µs/写，可省量占 ~1.3%。R2-J（~50×）、R5-J
（~157–226×）、本轮（~65–90×）三代实测一致：**preferences 插入路径的
任何 CPU 微观化都低于其 I/O 尾数的抖动**。S1-J-1（增量化）被 lastUpdated
可观察面挡住、快照格式是数据面契约，该路径维持收口。

### S7-J-6：mkdir 缓存化是自愈语义收窄，不是优化

`saveToDisk` 每写 `mkdirSync(recursive)` 与 `persist/jsonl.ts` 每 append
mkdir 是同款**自愈写**语义：状态目录被外部删除后，下一次持久化自动重建
目录并成功落盘。缓存「目录已建」标志后，同场景变为 `writeFileSync` 抛
ENOENT——进程崩溃面被拓宽（今日不可达的崩溃变为可达）。这与 fail-open
拓宽方向相反，但同属**崩溃/恢复契约改动**，按 persist 耐久性语义强调区
自动否决（R3-J 对 jsonl 侧、S5-G-1/S6-E-3 对 G/E 区的同型判据第三次
成立）。实测冗余 mkdir 仅 1.08µs（写地板 ~0.15%），即便语义无虞也远低于
否决线。

### S7-J-3/S7-J-5：两个「回调内不变量」的教科书站点

- **S7-J-3** 是 `decideClosure` 中最后一个未点名的表达式级站点：模板
  字面量在 `.some()` 回调内随 evidenceRef 重建（C×R 次）。提升后现实档
  省 419–445ns/闭合判定——比 S2-J-8 的 Set 化（~800ns）还小，且闭合判定
  每 episode 一次。压力档 82–83µs 需要 C=64/R=512 的超现实 episode。
- **S7-J-5** 与 S2-J-9 的区别在于不引入跨调用缓存（X1-1 邻域零碰）、
  `stripForbidden` 一字未动，只在无文本时跳过预处理——等价性经 4 记录
  形态 × 5 策略矩阵含身份断言验证。但命中形态稀有（生产 feedback 常有
  body），且 1.37–1.40µs 落在 jsonl 追加的 I/O 尾数内。

### 增长维度第七次复核：两条 O(N) 契约路径维持无更优解

preference 插入路径（recurrence 扫描 + rebuildViews + saveToDisk）与
feedback 读写路径（脱敏顺序遍 + jsonl parse + 双读串行 + 级联全量重写）
的收口论证（S1-J-1/2、S2-J-6/9/10、S3-J-1/4/5/6、S5-J-1/3、S6-J-1）在
零 diff 下全部继承并本轮加固（S7-J-4/S7-J-5/S7-J-6 从三个新站点再证
I/O 支配与自愈语义）。本轮无剩余角度可提。

### 逐文件收口（第七遍新视角补充，R1-J..R6-J 收口之上）

| 文件 | 第七遍新检查点 | 结论 |
| --- | --- | --- |
| `context/packet.ts` | 见 S7-J-1/S7-J-2；组间迭代 = S6-J-3、首 sort = S1-J-7、防御拷贝 = S2-J-5、omissions 双遍 = S4-J-4、估算构串 = S5-J-2 维持；`queryPacketGrounding` 本轮 re-grep 仍无生产调用方 | 无候选落地 |
| `episode/closure.ts` | 见 S7-J-3；evidenceRefs Set 化 = S2-J-8 维持；`closeEpisode` 单 spread+拷贝无可省 | 无候选落地 |
| `preferences/store.ts` | 见 S7-J-4/S7-J-6；S1-J-1/2、S2-J-6、S3-J-5 五面维持；`findConflicts` 同型三连但无生产调用方（仅测试）不另立 ID | 无候选落地 |
| `feedback/redaction.ts` / `store.ts` / `types.ts` | 见 S7-J-5；stripForbidden = S3-J-1、needles 排序 = S2-J-9、双读 = S2-J-10、双层过滤 = R1-J S21 维持 | 无候选落地 |
| `preferences/loop-eval.ts`（J1） | 与 `fb41417` 逐字节一致核对 + `r1j-equivalence-sim` 重跑全绿（2468 checks，2719.4×）；`valueKey` 构串与 S6-J-2 的 subjectId 同判据（无生产调用方），不另立 ID；S2-J-1/2 维持 | 无候选落地（J1 未回退未重做） |
| `preferences/export.ts` / `materialize.ts` / `precedence.ts` / `service.ts` / `types.ts` | S3-J-6/S5-J-1/S5-J-5 维持；`materializeView` entries 循环换 spread 属 ns 级且 `getMaterializedView` 调用点（cli:1260、clarify:21-22）常数规模 | 无候选 |
| `context/index.ts` | S1-J-6/S2-J-4/S3-J-2/S4-J-6/S5-J-2/S6-J-6 六面维持；`normalizePath` 无匹配快路径守卫经复核归入 S3-J-2 的一次性构建噪声域（正则无匹配时 V8 已近零拷贝，守卫只省正则扫描本身） | 无候选 |
| `track/loop.ts` / `plan.ts` / `clarify.ts` / `primary-split.ts` | S1-J-5、S2-J-11、S4-J-2、S5-J-6、S6-J-4 维持；`splitAndAssignForPrimary` 纯编排无热点 | 无候选 |
| `episode/manager.ts` / `replay.ts` / `events.ts` / `store.ts` | S1-J-3、S6-J-5 维持；`replayFromLog` 单遍 parse 支配（S3-J-4 域）；append 队列 promise 链为顺序契约 | 无候选 |
| `cluster/host.ts` / `mailbox.ts` / `spawn.ts` | S2-J-3、S3-J-3、S4-J-1、S4-J-5、S5-J-4 维持；第七遍无新表达式级站点 | 无候选 |
| `persist/jsonl.ts` / `file-lock.ts` | S3-J-4 维持；每 append mkdir 自愈 = S7-J-6 同款语义（jsonl 侧 R3-J 已裁）；锁语义数据面第七次零碰 | 无候选（数据面） |
| `privacy/deletion.ts` / `record-classes.ts` / `state-layout.ts` | 级联四角度（S2-J-7/S4-J-3/S5-J-3/S6-J-1）收口维持；字典 find 无生产调用方（R1-J S12 第七次维持） | 无候选 |

## 4. 前后对比

无代码 diff。仓库变更仅本报告一个文件。切片自 R1-J 落地 J1（`fb41417`）起
经 R2-J..R6-J 与本轮 R7-J 六遍复查累计零后续代码改动，逐字节一致。

## 5. 测试

零代码改动下相关基线复核，全绿（Node v22.22.2 via nvm，pnpm 10.17.1）：

```bash
npx tsx scripts/r1j-equivalence-sim.ts
# ALL EQUIVALENCE CHECKS PASSED (2468 bitwise checks)
# perf fixture: reference 10046.0 ms -> current 3.7 ms (2719.4x)
pnpm gate   # typecheck + lint + test + build 全绿
```

仿真（临时脚本，未入库——无赢家不落仿真文件，完整源码见附录；3 次独立
运行 8 项等价断言逐位一致、计时抖动范围内稳定）：

```text
run 1:
C1 collapseFacts realistic (~81 facts): base 13797ns/op, variant 11715ns/op, delta 2082ns/op
C1 collapseFacts stress (~2393 facts): base 583.9us/op, variant 496.1us/op, delta 87.8us/op
C1+C2 full compile realistic: production 35.52us/op, variant 34.25us/op, delta 1.28us/op; per-run (16 children) 0.0204ms
C2 destination split (120 selected): base 787ns/op, variant 379ns/op, delta 408ns/op
C3 decideClosure realistic (C=6,R=24): base 864ns/op, variant 445ns/op, delta 419ns/op
C3 decideClosure stress (C=64,R=512): base 127.5us/op, variant 45.2us/op, delta 82.3us/op
C4 grouping (N=1000,P=20): base 57.65us/op, variant 48.86us/op, delta 8.79us/op
C4 context: saveToDisk floor (N=1000 stringify+writeFileSync+mkdirSync): 638us/op
C5 redactFeedback no-text path (32 needles): base 1413ns/op, variant 17ns/op, delta 1395ns/op
checks=8 failures=0

run 2:
C1 realistic delta 2709ns/op; C1 stress delta 68.9us/op; C1+C2 delta 2.48us/op (0.0397ms/run)
C2 delta 443ns/op; C3 realistic delta 419ns/op; C3 stress delta 83.4us/op
C4 delta 8.84us/op (floor 817us/op); C5 delta 1369ns/op
checks=8 failures=0

run 3:
C1 realistic delta 2949ns/op; C1 stress delta 95.0us/op; C1+C2 delta 2.50us/op (0.0401ms/run)
C2 delta 408ns/op; C3 realistic delta 445ns/op; C3 stress delta 83.2us/op
C4 delta 10.53us/op (floor 708us/op); C5 delta 1366ns/op
checks=8 failures=0

S7-J-6 anchor (node one-shot, best-of-5): mkdirSync existing dir: 1.08 us/op
```

环境注记（R1-J 同款）：VM 系统 Node 为 22.14.0，低于 `engines >=22.19.0`；
本轮全部测试与门禁在 nvm 的 Node 22.22.2 下执行，全绿。

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S7-J-1 | packet `pickCanonical` 拷贝+排序取首换 first-on-tie min-scan | 等价（60 seeds 端到端逐字节 + 精确平局身份断言）且方向稳定，但现实档仅 2.1–2.9µs/编译、端到端 0.02–0.04ms/run（≤16 child 编译），压力档 30× 超现实夹具下 68.9–95.0µs——距数十 ms 落地线约三个数量级 |
| S7-J-2 | packet selected→requiredFacts/relevantFiles 双 filter+map 融合单遍 | 408–443ns/编译；S4-J-4 同文件同族第二站点，ns 级常数噪声 |
| S7-J-3 | closure `legacyMatch` 模板字面量 `` evd_${id} `` 提升出 `.some` 回调 | 现实档 419–445ns/闭合判定（每 episode 一次）；压力档 82–83µs 需 C=64/R=512 超现实 episode；S2-J-8 同函数同量级判据 |
| S7-J-4 | preferences `rebuildViews` 分组 get-push-set 三连冗余 `Map.set` 条件化 | 8.8–10.5µs@N=1000 被同路径紧随的 `saveToDisk` 地板 638–817µs 吞没（占 ~1.3%；S2-J-6 I/O 支配判据 + S5-J-4 同型家族第二站点） |
| S7-J-5 | redaction 无文本（body+summary 双缺席）时跳过 needles 预处理 | 等价（100 seeds × 4 形态 × 5 策略含身份断言）但命中形态稀有 + 1.37–1.40µs 落在 jsonl 追加 I/O 尾数内（S2-J-9 同域，X1-1 邻域零碰） |
| S7-J-6 | preferences `saveToDisk` 每写 `mkdirSync` 缓存化 | **自愈语义收窄**：外部删目录后当前每写自动重建，缓存后改为 ENOENT 崩溃——persist 耐久性/崩溃面契约改动（jsonl 每 append mkdir 同款语义，R3-J/S5-G-1/S6-E-3 同型）；且实测冗余 mkdir 仅 1.08µs（写地板 ~0.15%） |

重开条件：S7-J-1 若 `compileContextPacket` 获得每 run 数百次以上的高频
调用方（如 per-message 重编译）或 facts 规模常态达 10³+，可凭本报告
60-seed 端到端等价证据重开（min-scan 形态已验证方向稳定）；S7-J-4 若
preferences 快照格式改为增量日志（数据面契约决策，另需 S1-J-1 的
lastUpdated 语义决议）使 I/O 地板消失，可连带重估；S7-J-6 需先做出
**崩溃/恢复契约决策**（显式声明状态目录生命周期由启动时一次性保证），
属语义工作并需重写持久化测试；S7-J-2/S7-J-3/S7-J-5 为 ns–µs 级常数或
稀有形态，无现实重开路径。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为 `scripts/round07-r7j-adjudication-sim.ts` 后在仓库根目录
`npx tsx scripts/round07-r7j-adjudication-sim.ts`（依赖已装；Node ≥22.19）。
seeds 内嵌确定性构造，无命令行随机性；三次运行等价断言逐位一致。

```ts
/**
 * Round-7 R7-J adjudication simulation (NOT committed; report-appendix only).
 *
 * Candidates (all never-examined sites in the J slice):
 *  C1 pickCanonical copy+sort -> first-on-tie min-scan (context/packet.ts)
 *  C2 requiredFacts/relevantFiles double filter+map -> fused single pass
 *  C3 decideClosure legacyMatch template hoist out of the .some callback
 *  C4 rebuildViews byPair get/push/set -> conditional set (redundant Map.set)
 *  C5 redactFeedback needle prep skip when body AND summary are undefined
 *
 * Baseline is the PRODUCTION export wherever one exists (compileContextPacket,
 * decideClosure, redactFeedback); variants replicate the function with exactly
 * one candidate edit. Fixtures are seeded (mulberry32) so runs are
 * deterministic. Timing lines are informational (best-of-rounds).
 *
 * Run with: npx tsx scripts/round07-r7j-adjudication-sim.ts
 */

import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import {
  compileContextPacket,
  type ContextRequest,
  type ContextPacket,
} from "../src/context/packet.js";
import type { ContextFact, ProjectContextIndex, CodeMapEntry } from "../src/context/index.js";
import { decideClosure } from "../src/episode/closure.js";
import type { ProjectEpisode } from "../src/domain/episode.js";
import { redactFeedback, type RedactionPolicy } from "../src/feedback/redaction.js";
import type { FeedbackRecord } from "../src/feedback/types.js";
import type { RequirementContract } from "../src/domain/contract.js";
import type { EpisodeId, ProjectId, RunId, TaskId, EvidenceId } from "../src/domain/ids.js";
import type { IsoTimestamp } from "../src/domain/timestamp.js";

let checks = 0;
let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  checks += 1;
  if (!ok) {
    failures += 1;
    process.stderr.write(`FAIL: ${label}${detail === undefined ? "" : ` — ${detail}`}\n`);
  }
}
function out(line: string): void {
  process.stdout.write(line + "\n");
}
function bestMs(fn: () => void, rounds = 5): number {
  let best = Infinity;
  for (let r = 0; r < rounds; r++) {
    const t0 = process.hrtime.bigint();
    fn();
    const t1 = process.hrtime.bigint();
    best = Math.min(best, Number(t1 - t0) / 1e6);
  }
  return best;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(rnd: () => number, items: readonly T[]): T {
  return items[Math.floor(rnd() * items.length)]!;
}

/* ------------------------------------------------------------------ */
/* Shared verbatim helpers from src/context/packet.ts                  */
/* ------------------------------------------------------------------ */

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
function trustRank(trust: ContextFact["trust"]): number {
  if (trust === "HIGH") return 0;
  if (trust === "MEDIUM") return 1;
  if (trust === "LOW") return 2;
  return 3;
}

/* Baseline pickCanonical — verbatim from packet.ts */
function pickCanonicalBaseline(facts: readonly ContextFact[]): ContextFact | undefined {
  if (facts.length === 0) return undefined;
  return [...facts].sort((a, b) => {
    const trustDelta = trustRank(a.trust) - trustRank(b.trust);
    if (trustDelta !== 0) return trustDelta;
    const hashDelta = compareStrings(a.sourceHash, b.sourceHash);
    if (hashDelta !== 0) return hashDelta;
    return compareStrings(a.freshness, b.freshness);
  })[0];
}

/* C1 variant: first-on-tie min-scan (stable-sort-[0] semantics) */
function pickCanonicalVariant(facts: readonly ContextFact[]): ContextFact | undefined {
  const first = facts[0];
  if (first === undefined) return undefined;
  let best = first;
  for (let i = 1; i < facts.length; i++) {
    const f = facts[i]!;
    const trustDelta = trustRank(f.trust) - trustRank(best.trust);
    if (trustDelta > 0) continue;
    if (trustDelta < 0) {
      best = f;
      continue;
    }
    const hashDelta = compareStrings(f.sourceHash, best.sourceHash);
    if (hashDelta > 0) continue;
    if (hashDelta < 0) {
      best = f;
      continue;
    }
    if (compareStrings(f.freshness, best.freshness) < 0) best = f;
  }
  return best;
}

/* collapseFacts — verbatim from packet.ts, parameterized on pickCanonical */
function collapseFactsWith(
  facts: readonly ContextFact[],
  pickCanonical: (facts: readonly ContextFact[]) => ContextFact | undefined
): ContextFact[] {
  const groups = new Map<string, ContextFact[]>();
  for (const fact of facts) {
    const group = groups.get(fact.key);
    if (group === undefined) {
      groups.set(fact.key, [fact]);
    } else {
      group.push(fact);
    }
  }
  const collapsed: ContextFact[] = [];
  const keys = [...groups.keys()].sort(compareStrings);
  for (const key of keys) {
    const group = groups.get(key);
    if (group === undefined) continue;
    const byValue = new Map<string, ContextFact[]>();
    for (const fact of group) {
      const same = byValue.get(fact.value);
      if (same === undefined) {
        byValue.set(fact.value, [fact]);
      } else {
        same.push(fact);
      }
    }
    const values = [...byValue.keys()].sort(compareStrings);
    if (values.length === 1) {
      const value = values[0];
      if (value === undefined) continue;
      const chosen = pickCanonical(byValue.get(value) ?? []);
      if (chosen !== undefined) collapsed.push(chosen);
      continue;
    }
    values.forEach((value, index) => {
      const chosen = pickCanonical(byValue.get(value) ?? []);
      if (chosen === undefined) return;
      collapsed.push({ ...chosen, key: `${key}#${index}` });
    });
  }
  return collapsed;
}

/* ------------------------------------------------------------------ */
/* Fixtures for C1 / C2                                                */
/* ------------------------------------------------------------------ */

const TRUSTS: readonly ContextFact["trust"][] = ["HIGH", "MEDIUM", "LOW", "unavailable"];
const FRESH: readonly ContextFact["freshness"][] = ["fresh", "stale", "unavailable"];

function genFacts(rnd: () => number, groupCount: number, maxPerGroup: number): ContextFact[] {
  const facts: ContextFact[] = [];
  for (let g = 0; g < groupCount; g++) {
    const key = `fact.k${g}`;
    const n = 1 + Math.floor(rnd() * maxPerGroup);
    for (let i = 0; i < n; i++) {
      // Small hash/value pools force exact ties (same trust+hash+freshness)
      // so first-on-tie semantics are actually exercised.
      facts.push({
        key,
        value: `v${Math.floor(rnd() * 3)}`,
        trust: pick(rnd, TRUSTS),
        sourceHash: `h${Math.floor(rnd() * 4)}`,
        freshness: pick(rnd, FRESH),
      });
    }
  }
  // Shuffle (Fisher–Yates) so insertion order differs from key order.
  for (let i = facts.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = facts[i]!;
    facts[i] = facts[j]!;
    facts[j] = tmp;
  }
  return facts;
}

function genIndex(rnd: () => number, factGroups: number, maxPerGroup: number): ProjectContextIndex {
  const facts = genFacts(rnd, factGroups, maxPerGroup);
  const manifests: Record<string, string> = {};
  for (let i = 0; i < 4; i++) manifests[`pkg${i}/package.json`] = `mh${i}`;
  const entries: CodeMapEntry[] = [];
  for (let i = 0; i < 12; i++) {
    entries.push({
      path: `src/m${i}.ts`,
      symbol: `sym${i}`,
      kind: "function",
      public: rnd() < 0.5,
      calls: [`c${i}`, `d${i}`],
    });
  }
  return {
    projectId: "proj_r7j" as ProjectId,
    lastUpdated: "2026-08-24T00:00:00.000Z" as IsoTimestamp,
    manifests,
    architecture: ["layered"],
    tests: ["pnpm test"],
    risks: ["risk-a", "risk-b"],
    priorEpisodes: [],
    schemaVersion: 1,
    facts,
    instructionPrecedence: ["AGENTS.md", "docs/AGENTS.md"],
    instructionOwnership: [],
    validationRoutes: ["test", "lint"],
    generatedHints: ["dist/gen.ts"],
    dirtyUnrelated: ["notes/tmp.md"],
    codeMap: {
      schemaVersion: 1,
      tokenBudget: 2000,
      estimatedTokens: 120,
      entries,
      omissions: [{ path: "src/o.ts", symbol: "omit", reason: "token-budget", rank: 2 }],
    },
  };
}

const CONTRACT: RequirementContract = {
  schemaVersion: 1,
  objective: "r7j adjudication",
  deliverables: [],
  constraints: [
    { id: "c1", description: "keep contracts", source: "user" },
    { id: "c2", description: "no threshold changes", source: "user" },
  ] as unknown as RequirementContract["constraints"],
  nonGoals: [],
  acceptanceCriteria: [],
  assumptions: [],
  questions: [
    { id: "q1", question: "which db", options: ["pg", "sqlite"], default: "pg" },
    { id: "q2", question: "which region", options: [] },
  ],
  authority: [
    { scope: "repo", actions: ["read", "write"] },
  ] as unknown as RequirementContract["authority"],
  sourceRefs: [],
};

function genRequest(rnd: () => number, factGroups: number, maxPerGroup: number, budget: number): ContextRequest {
  return {
    taskId: "task_r7j" as TaskId,
    contract: CONTRACT,
    index: genIndex(rnd, factGroups, maxPerGroup),
    tokenBudget: budget,
    selectorVersion: 1,
    dependencyOutputs: ["dep out 1"],
    secretEvidenceRefs: ["evd_secret_1"],
  };
}

/* ------------------------------------------------------------------ */
/* C1+C2 full variant compile (replicates compileContextPacket with    */
/* min-scan pickCanonical and fused destination pass)                  */
/* ------------------------------------------------------------------ */

interface PacketCandidate {
  readonly key: string;
  readonly text: string;
  readonly destination: "requiredFacts" | "relevantFiles";
  readonly rank: number;
  readonly preOmit: "token-budget" | "secret" | "unavailable" | "unrelated-dirty" | undefined;
}
interface OmissionRecord {
  readonly key: string;
  readonly reason: "token-budget" | "secret" | "unavailable" | "unrelated-dirty";
  readonly rank: number;
}

const RANK_MANDATORY = 1;
const RANK_INSTRUCTION = 10;
const RANK_MANIFEST = 20;
const RANK_INDEX_FACT = 30;
const RANK_DEFAULTED_QUESTION = 40;
const RANK_TEST = 50;
const RANK_GENERATED = 60;
const RANK_RISK = 80;
const RANK_UNRELATED_DIRTY = 90;
const RANK_CODE_MAP = 70;
const RANK_SECRET = 100;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
function estimateCodeMapEntry(entry: CodeMapEntry): number {
  const compact = `${entry.path}:${entry.symbol}(${entry.kind})${entry.public ? " public" : ""} calls=${entry.calls.join(",")}`;
  return Math.max(1, Math.ceil(compact.length / 4));
}
function compareCandidates(a: PacketCandidate, b: PacketCandidate): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  return compareStrings(a.key, b.key);
}
function compareOmissions(a: OmissionRecord, b: OmissionRecord): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const keyDelta = compareStrings(a.key, b.key);
  if (keyDelta !== 0) return keyDelta;
  return compareStrings(a.reason, b.reason);
}
function compareCodeMapOmissions(
  a: { rank: number; path: string; symbol: string },
  b: { rank: number; path: string; symbol: string }
): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const path = compareStrings(a.path, b.path);
  if (path !== 0) return path;
  return compareStrings(a.symbol, b.symbol);
}
import { hash32 } from "../src/domain/hash.js";
function contractDigest(contract: RequirementContract): string {
  const criterionIds = contract.acceptanceCriteria.map((criterion) => criterion.id).join("\0");
  return hash32(`${contract.objective}\0${criterionIds}`);
}
function summarizeOmissions(omissions: readonly OmissionRecord[]): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const omission of omissions) {
    counts.set(omission.reason, (counts.get(omission.reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => compareStrings(a[0], b[0]))
    .map(([reason, count]) => ({ reason, count }));
}

function collectCandidatesReplica(
  request: ContextRequest,
  collapse: (facts: readonly ContextFact[]) => ContextFact[]
): PacketCandidate[] {
  const candidates: PacketCandidate[] = [];
  const occupiedKeys = new Set<string>();
  const take = (candidate: PacketCandidate): void => {
    if (occupiedKeys.has(candidate.key)) return;
    occupiedKeys.add(candidate.key);
    candidates.push(candidate);
  };
  for (const constraint of request.contract.constraints) {
    take({
      key: `constraint:${constraint.id}`,
      text: constraint.description,
      destination: "requiredFacts",
      rank: RANK_MANDATORY,
      preOmit: undefined,
    });
  }
  for (const grant of request.contract.authority) {
    const actions = grant.actions.length > 0 ? grant.actions.join(", ") : "no actions";
    const expires = grant.expiresAt !== undefined ? ` (expires ${grant.expiresAt})` : "";
    take({
      key: `authority:${grant.scope}`,
      text: `${grant.scope}: ${actions}${expires}`,
      destination: "requiredFacts",
      rank: RANK_MANDATORY,
      preOmit: undefined,
    });
  }
  for (const question of request.contract.questions) {
    const hasDefault = question.default !== undefined && question.default.trim() !== "";
    const options =
      question.options.length > 0 ? ` [options: ${question.options.join(" | ")}]` : "";
    const defaulted = hasDefault ? ` (default: ${question.default})` : "";
    take({
      key: `question:${question.id}`,
      text: `${question.question}${options}${defaulted}`,
      destination: "requiredFacts",
      rank: hasDefault ? RANK_DEFAULTED_QUESTION : RANK_MANDATORY,
      preOmit: undefined,
    });
  }
  for (const route of request.index.validationRoutes) {
    take({
      key: `validation.route:${route}`,
      text: `validation route: ${route}`,
      destination: "requiredFacts",
      rank: RANK_MANDATORY,
      preOmit: undefined,
    });
  }
  for (const [index, output] of (request.dependencyOutputs ?? []).entries()) {
    take({
      key: `dependency:${index}:${output}`,
      text: `dependency output: ${output}`,
      destination: "requiredFacts",
      rank: RANK_MANDATORY,
      preOmit: undefined,
    });
  }
  for (const fact of collapse(request.index.facts)) {
    if (fact.key.startsWith("validation.route:")) {
      if (fact.trust === "unavailable" || fact.freshness === "unavailable") {
        take({
          key: fact.key,
          text: fact.value,
          destination: "requiredFacts",
          rank: RANK_MANDATORY,
          preOmit: "unavailable",
        });
      }
      continue;
    }
    take({
      key: `fact:${fact.key}`,
      text: `${fact.key}=${fact.value}`,
      destination: "requiredFacts",
      rank: RANK_INDEX_FACT,
      preOmit:
        fact.trust === "unavailable" || fact.freshness === "unavailable" ? "unavailable" : undefined,
    });
  }
  for (const path of request.index.instructionPrecedence) {
    take({
      key: `file:instruction:${path}`,
      text: path,
      destination: "relevantFiles",
      rank: RANK_INSTRUCTION,
      preOmit: undefined,
    });
  }
  for (const path of Object.keys(request.index.manifests).sort(compareStrings)) {
    take({
      key: `file:manifest:${path}`,
      text: path,
      destination: "relevantFiles",
      rank: RANK_MANIFEST,
      preOmit: undefined,
    });
  }
  for (const test of request.index.tests) {
    take({
      key: `test:${test}`,
      text: test,
      destination: "requiredFacts",
      rank: RANK_TEST,
      preOmit: undefined,
    });
  }
  for (const hint of request.index.generatedHints) {
    take({
      key: `generated:${hint}`,
      text: hint,
      destination: "relevantFiles",
      rank: RANK_GENERATED,
      preOmit: undefined,
    });
  }
  for (const [index, risk] of request.index.risks.entries()) {
    take({
      key: `risk:${index}:${risk}`,
      text: risk,
      destination: "requiredFacts",
      rank: RANK_RISK,
      preOmit: undefined,
    });
  }
  for (const path of request.index.dirtyUnrelated) {
    take({
      key: `dirty:${path}`,
      text: path,
      destination: "requiredFacts",
      rank: RANK_UNRELATED_DIRTY,
      preOmit: "unrelated-dirty",
    });
  }
  for (const ref of request.secretEvidenceRefs ?? []) {
    take({
      key: `secret:${ref}`,
      text: ref,
      destination: "requiredFacts",
      rank: RANK_SECRET,
      preOmit: "secret",
    });
  }
  return candidates.sort(compareCandidates);
}

/**
 * mode "baseline": verbatim replica of production compileContextPacket
 * (sort-based pickCanonical, two filter+map destination passes).
 * mode "variant": C1 (min-scan pickCanonical) + C2 (fused destination pass).
 */
function compileReplica(request: ContextRequest, mode: "baseline" | "variant"): ContextPacket {
  const pickFn = mode === "baseline" ? pickCanonicalBaseline : pickCanonicalVariant;
  const collapse = (facts: readonly ContextFact[]) => collapseFactsWith(facts, pickFn);
  const candidates = collectCandidatesReplica(request, collapse);
  const selected: PacketCandidate[] = [];
  const omissions: OmissionRecord[] = [];
  const codeMapSelection = {
    entries: [...request.index.codeMap.entries],
    omissions: [...request.index.codeMap.omissions],
  };
  let used = 0;
  for (const candidate of candidates) {
    if (candidate.preOmit !== undefined) {
      omissions.push({ key: candidate.key, reason: candidate.preOmit, rank: candidate.rank });
      continue;
    }
    const cost = estimateTokens(candidate.text);
    if (used + cost <= request.tokenBudget) {
      selected.push(candidate);
      used += cost;
    } else {
      omissions.push({ key: candidate.key, reason: "token-budget", rank: candidate.rank });
    }
  }
  omissions.sort(compareOmissions);

  let requiredFacts: string[];
  let relevantFiles: string[];
  if (mode === "baseline") {
    requiredFacts = selected
      .filter((candidate) => candidate.destination === "requiredFacts")
      .map((candidate) => candidate.text);
    relevantFiles = selected
      .filter((candidate) => candidate.destination === "relevantFiles")
      .map((candidate) => candidate.text);
  } else {
    requiredFacts = [];
    relevantFiles = [];
    for (const candidate of selected) {
      if (candidate.destination === "requiredFacts") requiredFacts.push(candidate.text);
      else relevantFiles.push(candidate.text);
    }
  }

  const packetCodeMapOmissions = codeMapSelection.omissions.map((omission) => ({
    ...omission,
    source: "index" as const,
  })) as { path: string; symbol: string; reason: "token-budget"; rank: number; source: "index" | "packet" }[];
  for (const omission of codeMapSelection.omissions) {
    omissions.push({
      key: `code-map:${omission.path}:${omission.symbol}`,
      reason: "token-budget",
      rank: RANK_CODE_MAP,
    });
  }
  const codeMapEntries: CodeMapEntry[] = [];
  let codeMapUsed = 0;
  for (const entry of codeMapSelection.entries) {
    const cost = estimateCodeMapEntry(entry);
    if (used + cost <= request.tokenBudget) {
      codeMapEntries.push(entry);
      used += cost;
      codeMapUsed += cost;
    } else {
      packetCodeMapOmissions.push({
        path: entry.path,
        symbol: entry.symbol,
        reason: "token-budget",
        rank: 1,
        source: "packet",
      });
      omissions.push({
        key: `code-map:${entry.path}:${entry.symbol}`,
        reason: "token-budget",
        rank: RANK_CODE_MAP,
      });
    }
  }
  packetCodeMapOmissions.sort(compareCodeMapOmissions);
  omissions.sort(compareOmissions);
  return {
    taskId: request.taskId,
    contractDigest: contractDigest(request.contract),
    requiredFacts,
    relevantFiles,
    codeMap: {
      schemaVersion: 1,
      tokenBudget: request.index.codeMap.tokenBudget,
      estimatedTokens: codeMapUsed,
      entries: codeMapEntries,
      omissions: packetCodeMapOmissions,
    },
    tokenBudget: request.tokenBudget,
    omittedSummary: summarizeOmissions(omissions),
    omissions,
    selectorVersion: 1,
  };
}

/* ------------------------------------------------------------------ */
/* C3 decideClosure variant (hoisted legacy needle)                    */
/* ------------------------------------------------------------------ */

function decideClosureVariant(
  episode: ProjectEpisode,
  _latestRunIds: readonly RunId[]
): { canClose: boolean; reason: string; requiredEvidence: string[] } {
  if (episode.status !== "OPEN" && episode.status !== "WAITING_FOR_USER") {
    return { canClose: false, reason: "already-closed", requiredEvidence: [] };
  }
  const acceptanceEvidence = (
    episode as ProjectEpisode & {
      readonly acceptanceEvidence?: readonly {
        readonly criterionId: string;
        readonly evidenceId: string;
        readonly result: "PASSED" | "FAILED" | "UNOBSERVED";
      }[];
    }
  ).acceptanceEvidence;
  const missing = episode.acceptance
    .filter((criterion) => {
      const structuredMatch = acceptanceEvidence?.some(
        (evidence) =>
          evidence.criterionId === criterion.id &&
          evidence.result === "PASSED" &&
          episode.evidenceRefs.includes(evidence.evidenceId as ProjectEpisode["evidenceRefs"][number])
      );
      const legacyNeedle = `evd_${criterion.id}`;
      const legacyMatch = episode.evidenceRefs.some((ref) => String(ref) === legacyNeedle);
      return structuredMatch !== true && !legacyMatch;
    })
    .map((criterion) => criterion.id);
  if (missing.length > 0) {
    return { canClose: false, reason: "acceptance-incomplete", requiredEvidence: missing };
  }
  return { canClose: true, reason: "all-criteria-met", requiredEvidence: [] };
}

function genEpisode(rnd: () => number, criteria: number, refs: number): ProjectEpisode {
  const acceptance = [];
  for (let i = 0; i < criteria; i++) {
    acceptance.push({ id: `ac${i}`, description: `crit ${i}`, observableCheck: `check ${i}` });
  }
  const evidenceRefs: string[] = [];
  for (let i = 0; i < refs; i++) {
    // Mix legacy-satisfying refs and unrelated refs.
    evidenceRefs.push(rnd() < 0.3 ? `evd_ac${Math.floor(rnd() * criteria)}` : `evd_other_${i}`);
  }
  const acceptanceEvidence =
    rnd() < 0.5
      ? acceptance
          .filter(() => rnd() < 0.4)
          .map((c) => ({
            criterionId: c.id,
            evidenceId: `evd_s_${c.id}` as EvidenceId,
            result: "PASSED" as const,
            sourceRef: "sim",
          }))
      : undefined;
  if (acceptanceEvidence !== undefined && rnd() < 0.5) {
    for (const ev of acceptanceEvidence) evidenceRefs.push(ev.evidenceId);
  }
  const statusPool: ProjectEpisode["status"][] = ["OPEN", "WAITING_FOR_USER", "COMPLETED"];
  return {
    id: "ep_r7j" as EpisodeId,
    projectId: "proj_r7j" as ProjectId,
    objective: "sim",
    contractVersion: 1,
    runIds: ["run_1" as RunId],
    startedAt: "2026-08-24T00:00:00.000Z" as IsoTimestamp,
    status: pick(rnd, statusPool),
    acceptance,
    evidenceRefs: evidenceRefs as unknown as readonly EvidenceId[],
    ...(acceptanceEvidence !== undefined ? { acceptanceEvidence } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* C4 rebuildViews grouping loop                                       */
/* ------------------------------------------------------------------ */

interface ObsLite {
  readonly scope: string;
  readonly scopeKey: string;
  readonly key: string;
}
function groupBaseline(observations: readonly ObsLite[]): Map<string, ObsLite[]> {
  const byPair = new Map<string, ObsLite[]>();
  for (const obs of observations) {
    const key = `${obs.scope}:${obs.scopeKey}`;
    const list = byPair.get(key) ?? [];
    list.push(obs);
    byPair.set(key, list);
  }
  return byPair;
}
function groupVariant(observations: readonly ObsLite[]): Map<string, ObsLite[]> {
  const byPair = new Map<string, ObsLite[]>();
  for (const obs of observations) {
    const key = `${obs.scope}:${obs.scopeKey}`;
    let list = byPair.get(key);
    if (list === undefined) {
      list = [];
      byPair.set(key, list);
    }
    list.push(obs);
  }
  return byPair;
}
function genObservations(rnd: () => number, n: number, pairs: number): ObsLite[] {
  const obs: ObsLite[] = [];
  for (let i = 0; i < n; i++) {
    const p = Math.floor(rnd() * pairs);
    obs.push({ scope: p % 2 === 0 ? "project" : "user", scopeKey: `sk${p}`, key: `k${i % 7}` });
  }
  return obs;
}

/* ------------------------------------------------------------------ */
/* C5 redactFeedback needle-prep skip                                  */
/* ------------------------------------------------------------------ */

type RedactionClass = "secret" | "pii" | "path" | "prompt-injection" | "oversized";
const CLASS_ORDER: readonly RedactionClass[] = [
  "secret",
  "pii",
  "path",
  "prompt-injection",
  "oversized",
];
function stripForbidden(text: string, needles: readonly string[]): string {
  let out = text;
  for (const needle of needles) {
    out = out.split(needle).join("");
  }
  return out;
}
function copyFeedback(
  feedback: FeedbackRecord,
  patch: {
    redacted: boolean;
    body?: string | undefined;
    summary?: string | undefined;
    omitBody?: boolean | undefined;
  }
): FeedbackRecord {
  const nextBody =
    patch.omitBody === true ? undefined : patch.body !== undefined ? patch.body : feedback.body;
  const nextSummary = patch.summary !== undefined ? patch.summary : feedback.summary;
  return {
    id: feedback.id,
    episodeId: feedback.episodeId,
    kind: feedback.kind,
    rubricVersion: feedback.rubricVersion,
    score: feedback.score,
    evidenceRefs: feedback.evidenceRefs,
    redacted: patch.redacted,
    createdAt: feedback.createdAt,
    ...(feedback.runId !== undefined ? { runId: feedback.runId } : {}),
    ...(feedback.taskId !== undefined ? { taskId: feedback.taskId } : {}),
    ...(nextBody !== undefined ? { body: nextBody } : {}),
    ...(nextSummary !== undefined ? { summary: nextSummary } : {}),
  };
}
function redactFeedbackVariant(
  feedback: FeedbackRecord,
  policy: RedactionPolicy
): {
  feedback: FeedbackRecord;
  decision: {
    redacted: boolean;
    classes: readonly RedactionClass[];
    droppedFields: readonly string[];
    referenceOnly: boolean;
  };
} {
  const classes = new Set<RedactionClass>();
  const droppedFields: string[] = [];
  let body = feedback.body;
  let summary = feedback.summary;
  let referenceOnly = false;

  /* C5: needle prep is pure input to stripForbidden; skip it entirely when
     there is no text to strip. stripForbidden itself is untouched. */
  if ((body !== undefined || summary !== undefined) && policy.forbiddenSubstrings !== undefined) {
    const needles = [...policy.forbiddenSubstrings]
      .filter((needle) => needle.length > 0)
      .sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
    if (needles.length > 0) {
      const strippedBody = body !== undefined ? stripForbidden(body, needles) : undefined;
      const strippedSummary = summary !== undefined ? stripForbidden(summary, needles) : undefined;
      if (strippedBody !== body || strippedSummary !== summary) {
        classes.add("secret");
        body = strippedBody;
        summary = strippedSummary;
      }
    }
  }

  if (policy.maxBodyChars !== undefined && body !== undefined && body.length > policy.maxBodyChars) {
    classes.add("oversized");
    droppedFields.push("body");
    body = undefined;
    referenceOnly = true;
  }
  if (policy.redactPII) {
    classes.add("pii");
  }
  const redacted = classes.size > 0;
  if (!redacted) {
    return {
      feedback,
      decision: { redacted: false, classes: [], droppedFields: [], referenceOnly: false },
    };
  }
  return {
    feedback: copyFeedback(feedback, {
      redacted: true,
      ...(body !== undefined ? { body } : { omitBody: true }),
      ...(summary !== undefined ? { summary } : {}),
    }),
    decision: {
      redacted: true,
      classes: CLASS_ORDER.filter((entry) => classes.has(entry)),
      droppedFields,
      referenceOnly,
    },
  };
}
function genFeedback(rnd: () => number, withBody: boolean, withSummary: boolean): FeedbackRecord {
  return {
    id: `fb_${Math.floor(rnd() * 1e9)}`,
    episodeId: "ep_r7j" as EpisodeId,
    kind: "SELF" as FeedbackRecord["kind"],
    rubricVersion: "1",
    score: Math.floor(rnd() * 101),
    evidenceRefs: [],
    redacted: false,
    createdAt: "2026-08-24T00:00:00.000Z" as IsoTimestamp,
    ...(withBody ? { body: `body with sk-secret-${Math.floor(rnd() * 4)} token and text` } : {}),
    ...(withSummary ? { summary: `summary sk-secret-${Math.floor(rnd() * 4)}` } : {}),
  };
}

/* ================================================================== */
/* Equivalence checks                                                  */
/* ================================================================== */

out("=== R7-J adjudication sim ===");

/* C1/C2 equivalence: replica-baseline vs production, then variant vs production */
{
  let replicaOk = true;
  let variantOk = true;
  let collapseOk = true;
  for (let seed = 1; seed <= 60; seed++) {
    const rnd = mulberry32(seed * 7919);
    const groups = 4 + Math.floor(rnd() * 40);
    const maxPer = 1 + Math.floor(rnd() * 5);
    const budget = 50 + Math.floor(rnd() * 800);
    const request = genRequest(rnd, groups, maxPer, budget);
    const prod = compileContextPacket(request);
    const base = compileReplica(request, "baseline");
    const vari = compileReplica(request, "variant");
    if (JSON.stringify(prod) !== JSON.stringify(base)) replicaOk = false;
    if (JSON.stringify(prod) !== JSON.stringify(vari)) variantOk = false;
    const factsOnly = request.index.facts;
    const c0 = collapseFactsWith(factsOnly, pickCanonicalBaseline);
    const c1 = collapseFactsWith(factsOnly, pickCanonicalVariant);
    if (JSON.stringify(c0) !== JSON.stringify(c1)) collapseOk = false;
  }
  check("C1/C2 replica matches production compileContextPacket byte-for-byte (60 seeds)", replicaOk);
  check("C1+C2 variant matches production compileContextPacket byte-for-byte (60 seeds)", variantOk);
  check("C1 collapseFacts min-scan == sort-based (60 seeds, tie-heavy pools)", collapseOk);

  /* Explicit exact-tie identity check: same trust+hash+freshness duplicated */
  const dupA: ContextFact = { key: "k", value: "v", trust: "HIGH", sourceHash: "h", freshness: "fresh" };
  const dupB: ContextFact = { key: "k", value: "v", trust: "HIGH", sourceHash: "h", freshness: "fresh" };
  const tiePick = pickCanonicalVariant([dupA, dupB]);
  const tieBase = pickCanonicalBaseline([dupA, dupB]);
  check("C1 exact tie keeps first element (identity)", tiePick === dupA && tieBase === dupA);
}

/* C3 equivalence */
{
  let ok = true;
  for (let seed = 1; seed <= 200; seed++) {
    const rnd = mulberry32(seed * 104729);
    const episode = genEpisode(rnd, 1 + Math.floor(rnd() * 8), Math.floor(rnd() * 40));
    const a = decideClosure(episode, episode.runIds);
    const b = decideClosureVariant(episode, episode.runIds);
    if (JSON.stringify(a) !== JSON.stringify(b)) ok = false;
  }
  check("C3 decideClosure hoisted-needle == production (200 seeds)", ok);
}

/* C4 equivalence */
{
  let ok = true;
  for (let seed = 1; seed <= 50; seed++) {
    const rnd = mulberry32(seed * 31);
    const obs = genObservations(rnd, 500, 12);
    const a = groupBaseline(obs);
    const b = groupVariant(obs);
    if (a.size !== b.size) ok = false;
    for (const [k, v] of a) {
      const w = b.get(k);
      if (w === undefined || w.length !== v.length) {
        ok = false;
        break;
      }
      for (let i = 0; i < v.length; i++) {
        if (v[i] !== w[i]) {
          ok = false;
          break;
        }
      }
    }
  }
  check("C4 grouping conditional-set == baseline (50 seeds, element identity)", ok);
}

/* C5 equivalence */
{
  const policies: RedactionPolicy[] = [
    { redactPII: false },
    { redactPII: true, maxBodyChars: 40, forbiddenSubstrings: ["sk-secret-0", "sk-secret-1", ""] },
    { redactPII: false, forbiddenSubstrings: ["sk-secret-2", "sk-secret-3", "sk"] },
    { redactPII: false, forbiddenSubstrings: [] },
    { redactPII: true },
  ];
  let ok = true;
  let identityOk = true;
  for (let seed = 1; seed <= 100; seed++) {
    const rnd = mulberry32(seed * 613);
    for (const withBody of [true, false]) {
      for (const withSummary of [true, false]) {
        const record = genFeedback(rnd, withBody, withSummary);
        for (const policy of policies) {
          const a = redactFeedback(record, policy);
          const b = redactFeedbackVariant(record, policy);
          if (JSON.stringify(a) !== JSON.stringify(b)) ok = false;
          /* Non-redacted path must return the input object itself on both sides */
          if (!a.decision.redacted && (a.feedback !== record || b.feedback !== record)) {
            identityOk = false;
          }
        }
      }
    }
  }
  check("C5 redactFeedback prep-skip == production (100 seeds x 4 shapes x 5 policies)", ok);
  check("C5 non-redacted path preserves input identity on both sides", identityOk);
}

/* ================================================================== */
/* Benchmarks                                                          */
/* ================================================================== */

out("");
out("--- benches (best-of-5, informational) ---");

/* C1 isolated: collapseFacts at realistic and stress scale */
{
  const rnd = mulberry32(42);
  const realistic = genFacts(rnd, 40, 3); // ~80 facts, matches a mature index
  const stress = genFacts(mulberry32(43), 800, 5); // ~2400 facts, far beyond real
  const ITER_R = 20000;
  const ITER_S = 500;
  const baseR = bestMs(() => {
    for (let i = 0; i < ITER_R; i++) collapseFactsWith(realistic, pickCanonicalBaseline);
  });
  const variR = bestMs(() => {
    for (let i = 0; i < ITER_R; i++) collapseFactsWith(realistic, pickCanonicalVariant);
  });
  const baseS = bestMs(() => {
    for (let i = 0; i < ITER_S; i++) collapseFactsWith(stress, pickCanonicalBaseline);
  });
  const variS = bestMs(() => {
    for (let i = 0; i < ITER_S; i++) collapseFactsWith(stress, pickCanonicalVariant);
  });
  out(
    `C1 collapseFacts realistic (~${realistic.length} facts): base ${((baseR / ITER_R) * 1e6).toFixed(0)}ns/op, ` +
      `variant ${((variR / ITER_R) * 1e6).toFixed(0)}ns/op, delta ${(((baseR - variR) / ITER_R) * 1e6).toFixed(0)}ns/op`
  );
  out(
    `C1 collapseFacts stress (~${stress.length} facts): base ${((baseS / ITER_S) * 1e3).toFixed(1)}us/op, ` +
      `variant ${((variS / ITER_S) * 1e3).toFixed(1)}us/op, delta ${(((baseS - variS) / ITER_S) * 1e3).toFixed(1)}us/op`
  );
}

/* C1+C2 end-to-end: full packet compile */
{
  const rnd = mulberry32(4242);
  const request = genRequest(rnd, 40, 3, 700);
  const ITER = 5000;
  const prodMs = bestMs(() => {
    for (let i = 0; i < ITER; i++) compileContextPacket(request);
  });
  const variMs = bestMs(() => {
    for (let i = 0; i < ITER; i++) compileReplica(request, "variant");
  });
  const perOpProd = (prodMs / ITER) * 1e3;
  const perOpVari = (variMs / ITER) * 1e3;
  out(
    `C1+C2 full compile realistic: production ${perOpProd.toFixed(2)}us/op, variant ${perOpVari.toFixed(2)}us/op, ` +
      `delta ${(perOpProd - perOpVari).toFixed(2)}us/op; per-run (16 children) ${((perOpProd - perOpVari) * 16 / 1e3).toFixed(4)}ms`
  );
}

/* C2 isolated: destination split on synthetic selected arrays */
{
  const selected: PacketCandidate[] = [];
  const rnd = mulberry32(77);
  for (let i = 0; i < 120; i++) {
    selected.push({
      key: `k${i}`,
      text: `text ${i}`,
      destination: rnd() < 0.7 ? "requiredFacts" : "relevantFiles",
      rank: 30,
      preOmit: undefined,
    });
  }
  const ITER = 100000;
  const baseMs = bestMs(() => {
    for (let i = 0; i < ITER; i++) {
      const rf = selected.filter((c) => c.destination === "requiredFacts").map((c) => c.text);
      const rl = selected.filter((c) => c.destination === "relevantFiles").map((c) => c.text);
      if (rf.length + rl.length !== selected.length) throw new Error("unreachable");
    }
  });
  const variMs = bestMs(() => {
    for (let i = 0; i < ITER; i++) {
      const rf: string[] = [];
      const rl: string[] = [];
      for (const c of selected) {
        if (c.destination === "requiredFacts") rf.push(c.text);
        else rl.push(c.text);
      }
      if (rf.length + rl.length !== selected.length) throw new Error("unreachable");
    }
  });
  out(
    `C2 destination split (120 selected): base ${((baseMs / ITER) * 1e6).toFixed(0)}ns/op, ` +
      `variant ${((variMs / ITER) * 1e6).toFixed(0)}ns/op, delta ${(((baseMs - variMs) / ITER) * 1e6).toFixed(0)}ns/op`
  );
}

/* C3: decideClosure realistic and stress */
{
  const realistic = genEpisode(mulberry32(5), 6, 24);
  const stress = genEpisode(mulberry32(6), 64, 512);
  const ITER_R = 100000;
  const ITER_S = 2000;
  const baseR = bestMs(() => {
    for (let i = 0; i < ITER_R; i++) decideClosure(realistic, realistic.runIds);
  });
  const variR = bestMs(() => {
    for (let i = 0; i < ITER_R; i++) decideClosureVariant(realistic, realistic.runIds);
  });
  const baseS = bestMs(() => {
    for (let i = 0; i < ITER_S; i++) decideClosure(stress, stress.runIds);
  });
  const variS = bestMs(() => {
    for (let i = 0; i < ITER_S; i++) decideClosureVariant(stress, stress.runIds);
  });
  out(
    `C3 decideClosure realistic (C=6,R=24): base ${((baseR / ITER_R) * 1e6).toFixed(0)}ns/op, ` +
      `variant ${((variR / ITER_R) * 1e6).toFixed(0)}ns/op, delta ${(((baseR - variR) / ITER_R) * 1e6).toFixed(0)}ns/op`
  );
  out(
    `C3 decideClosure stress (C=64,R=512): base ${((baseS / ITER_S) * 1e3).toFixed(1)}us/op, ` +
      `variant ${((variS / ITER_S) * 1e3).toFixed(1)}us/op, delta ${(((baseS - variS) / ITER_S) * 1e3).toFixed(1)}us/op`
  );
}

/* C4: grouping loop + the saveToDisk I/O floor it lives behind */
{
  const obs = genObservations(mulberry32(9), 1000, 20);
  const ITER = 5000;
  const baseMs = bestMs(() => {
    for (let i = 0; i < ITER; i++) groupBaseline(obs);
  });
  const variMs = bestMs(() => {
    for (let i = 0; i < ITER; i++) groupVariant(obs);
  });
  out(
    `C4 grouping (N=1000,P=20): base ${((baseMs / ITER) * 1e3).toFixed(2)}us/op, ` +
      `variant ${((variMs / ITER) * 1e3).toFixed(2)}us/op, delta ${(((baseMs - variMs) / ITER) * 1e3).toFixed(2)}us/op`
  );

  // I/O floor: what one applyObservation actually pays after rebuildViews.
  const dir = "/tmp/r7j-sim-io";
  mkdirSync(dir, { recursive: true });
  const snapshot = {
    observations: obs.map((o, i) => ({
      id: `evd_${i}`,
      scope: o.scope,
      scopeKey: o.scopeKey,
      key: o.key,
      value: `value-${i % 13}`,
      evidenceEpisodeId: "ep_r7j",
      weight: 1,
      createdAt: "2026-08-24T00:00:00.000Z",
      explicit: i % 5 === 0,
      recurrenceCount: (i % 3) + 1,
    })),
    tombstones: [] as string[],
  };
  const IO_ITER = 50;
  const ioMs = bestMs(() => {
    for (let i = 0; i < IO_ITER; i++) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}/preferences.json`, JSON.stringify(snapshot));
    }
  });
  out(
    `C4 context: saveToDisk floor (N=1000 stringify+writeFileSync+mkdirSync): ${((ioMs / IO_ITER) * 1e3).toFixed(0)}us/op`
  );
  rmSync(dir, { recursive: true, force: true });
}

/* C5: the skipped prep on the no-text path */
{
  const noText = genFeedback(mulberry32(11), false, false);
  const needles: string[] = [];
  for (let i = 0; i < 32; i++) needles.push(`sk-needle-${i}-${"x".repeat(i % 9)}`);
  const policy: RedactionPolicy = { redactPII: false, forbiddenSubstrings: needles };
  const ITER = 200000;
  const baseMs = bestMs(() => {
    for (let i = 0; i < ITER; i++) redactFeedback(noText, policy);
  });
  const variMs = bestMs(() => {
    for (let i = 0; i < ITER; i++) redactFeedbackVariant(noText, policy);
  });
  out(
    `C5 redactFeedback no-text path (32 needles): base ${((baseMs / ITER) * 1e6).toFixed(0)}ns/op, ` +
      `variant ${((variMs / ITER) * 1e6).toFixed(0)}ns/op, delta ${(((baseMs - variMs) / ITER) * 1e6).toFixed(0)}ns/op`
  );
}

out("");
out(`checks=${checks} failures=${failures}`);
if (failures > 0) process.exitCode = 1;
```

MORE_OPTIMA=no
BRANCH=cursor/r7-j-persist-seventh-pass-83a1
