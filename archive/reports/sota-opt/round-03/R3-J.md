MODEL_SLUG=claude-fable-5-thinking-xhigh

# R3-J：数据面切片（cluster / privacy / preferences / episode / persist / track / context / feedback）第三遍复查报告

**战役:** 全库持久 SOTA 优化 Round 3 / R3-J
**基线:** `cursor/sota-persistent-opt-83a1` @ `c47e03a`
**分支:** `cursor/r3-j-persist-third-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 切片 29 个文件（`src/cluster/` 3、
`src/privacy/` 3、`src/preferences/` 7、`src/episode/` 5、`src/persist/` 2、
`src/track/` 4、`src/context/` 2、`src/feedback/` 3，共 3655 行）自 R2-J 基线
（`9e1886c`）以来**逐字节未变**（`git diff 9e1886c..c47e03a -- <切片>` 为空；
自 R1-J 基线 `7acb666` 起全部切片 diff 仍仅含已落地的 J1 `fb41417`
`loop-eval.ts` 一个文件），R1-J 的逐文件收口、S1-J-1..7 与 S2-J-1..11 排除
全部继承有效。本轮在完整排除表（含 S3-C 已落地与全部 S3-A/B/C/D/E/F/G-*）
之上第三次全量实际读码、以新角度枚举，得到 6 个此前未点名的新候选
（S3-J-1 … S3-J-6），全部经理论 + 确定性仿真（seeded mulberry32，等价
fuzz / **行为发散反例** / 真实规模基准，seeds `0x53aa01`/`0x53aa02` 两次
独立运行等价与反例结论逐位一致、计时抖动范围内稳定）裁决后淘汰：
**2 个被反例证明非保行为**（S3-J-1 的脱敏融合会让跨 needle 拼合出的密钥
残片逃过剥除——隐私面输出实测发散且融合实现还慢 ~10×；S3-J-5 会改变
`lastUpdated` 的可观察分布，S1-J-1 同一可观察面），**2 个实测负优化**
（S3-J-4 手写行扫描无稳定收益甚至更慢、JSON.parse+I/O 支配 ~95%；S3-J-6
的 includes→Set 在 |scopes|≤5 时慢 7–10µs，S1-B-6 同型反例再现），其余
2 个在真实规模是 ns~µs 级一次性噪声（最强合法者 S3-J-2 在现实 I=12 档
仅 ~15–17µs/构建、压力 I=48 档 ~147–181µs 仍低于 ~190µs 否决线且为每 run
一次性）。未重开任何 X* / S1-* / S2-* / S3-* 条目。数据面（删除/脱敏/
状态布局、mailbox、episode 闭合、jsonl 锁语义）**零 diff**，可见行为天然
不变。J1 之上本切片在其数据面契约下经三遍穷尽复查仍为 SOTA。

## 0. 范围与约束遵守

- 切片：`src/cluster/`、`src/privacy/`、`src/preferences/`、`src/episode/`、
  `src/persist/`、`src/track/`、`src/context/`、`src/feedback/`。29 个文件
  本轮全部第三次实际读码，未依赖 R1-J/R2-J 的记忆。
- 先读并遵守（顺序强制）：README → EXCLUSIONS.md（含 S3-C 已落地与全部
  S3-A..G 新排除）→ round-03/PLAN.md → round-01/R1-J.md → round-02/R2-J.md。
- 排除表遵守：候选枚举刻意绕开全部既有排除——S1-J-1..7、S2-J-1..11 十八条
  全部不再提案。特别地：**J1 落地代码未回退未重做**（`loop-eval.ts` 与
  `fb41417` 逐字节一致，本轮核对）；**S2-J-1 遵守**（两次 `tombstones.has`
  调用模式保持原样）；**S2-J-2 遵守**（createdAt 字典序比较器未碰，Z vs
  +00:00 反例继续有效）；**S2-J-10 遵守**（`readFeedback` 双读保持串行）；
  **S2-J-11 / S1-G-1 遵守**（`waitForClarification` 双 `readAll` 维持磁盘
  事实源语义）；X1-1（模块级隐藏缓存）、X0-5、X4-2（readonly 追加拷贝）
  直接跳过。本轮只探索**未被点名的新角度**：脱敏顺序剥除的融合
  （S3-J-1）、index 构建排序比较器内正则重算（S3-J-2）、单播 send 双 trim
  （S3-J-3）、jsonl split→手写行扫描（S3-J-4）、rebuildViews 每 view
  `nowIso()`（S3-J-5）、export 过滤 Set 化/融合（S3-J-6）。
- **数据面强调区零 diff**：`privacy/deletion.ts` 的全量读→map→全量重写
  级联、`persist/file-lock.ts` 的 wx/ownerToken/重试语义、`persist/jsonl.ts`
  的截尾恢复（S3-J-4 的裁决进一步佐证其现实现已被 parse/I-O 支配、无可省
  空间）、`cluster/mailbox.ts` 的 role 队列 claim 语义、`episode/manager.ts`
  的 fail-closed reducer——可见行为天然不变。
- 规格强制双路（Beta LCB vs 正态 LCB；offline-logit vs 概率可加）不在本区。
  分析不改 in-flight；Tracking 无命令权；H/score 不写路由；live = R0 等价、
  R1 未接线 live（`primary-split.ts` 注释与实现零碰）。不声称
  Outcome-supported；Checkpoint F-PROD 仍开放（ADR-005）。不改阈值、权限、
  数据面契约、公开签名；未改任何测试。
- 仓库变更仅本报告一个文件。

## 1. 规模与门槛基底（第三遍继承 + 本轮校准）

R1-J/R2-J 已实测本切片规模：episode 内 run 数、cluster peer 数
（≤ maxTasks=16）、track 子任务数（C≤~6）、context 构建输入（十位级）、
redaction needles（=4）全部为小常数；**唯一无上界增长维度是 preference
观察数 N 与 feedback 记录数 N**，两者的插入/读取路径均被同路径的全量 JSON
序列化 + 磁盘 I/O 支配（R2-J 实测 `saveToDisk` 序列化 ~1.5ms 支配候选
~50×），度量路径已被 J1 收口为 Θ(N log N) 且无生产调用方。代码逐字节
未变，全部继承。

战役落地线继承：已落地项在百 ms 级或复杂度类下降（J1 2770×、S1-C
~450ms/fit、S3-C ~140–155ms——本轮直接标尺），µs 级候选一律被否决过
（S1-I-1 ~190µs、S2-D-4 ~116µs、S2-J-8 ~800ns）。本轮全部合法候选的绝对
收益上界是 **~15–17µs/构建**（S3-J-2 现实档，一次性）；压力档 I=48 的
~147–181µs 仍低于否决线且 48 个 instruction 文件本身不现实。两个更大的
候选（S3-J-1/5）根本不是合法收益——它们改行为。据此裁决。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S3-J-1 | `feedback/redaction.ts` `stripForbidden` 顺序逐 needle split/join（长优先）融合为单遍同时匹配扫描 | 4 遍 O(len)→1 遍 | ❌ **反例**：剥除较长 needle 会**拼合出较后 needle 的新出现**，顺序遍捕获、融合遍永远看不见——`"sBEGIN PRIVATEk-"` 经顺序剥除为 `""`（先剥 `BEGIN PRIVATE` 拼出 `sk-`，后遍剥除），融合输出 `"sk-"`（**密钥前缀逃过脱敏**）；production 与顺序控制组逐位一致（400 fuzz 全过），融合在 186/400（seed2 同值，seed `0x1234ab` 抽查 206/400）随机 body 上发散 | 400 字符 body 顺序剥除仅 539–543ns，融合实现实测 **5.2–5.3µs（慢 ~10×）**；同路径磁盘 append ~3.3–3.4µs 支配 | 淘汰：**非保行为**（隐私面输出发散——脱敏不彻底即隐私回归）+ 实测负优化，双重淘汰；顺序剥除语义是脱敏彻底性的实现点 |
| S3-J-2 | `context/index.ts` instruction 排序比较器每比较重算 `pathDepth`→`relativeToRoot`→`normalizePath`（对 root 与 path 各 2 次正则）→ decorate-sort-undecorate 每 path 预算一次 | O(I log I) 次正则→O(I) 次 | ✅ 300 trial（production `instructionPrecedence` vs 控制组 vs decorate 变体，含反斜杠/尾斜杠/root 外路径）逐位一致（两 seed 同判） | I=12 现实档 delta **15.5–17.2µs/构建**；I=48 压力档 147–181µs；整个 `buildProjectContextIndex` 114–129µs、**每 run 一次性** | 淘汰：一次性构建 µs 级噪声（S1-J-6/S2-J-4 姊妹）；压力档仍低于 ~190µs 否决线 |
| S3-J-3 | `cluster/host.ts` **单播**路径 `input.body.trim()` 双算（:101 校验 + :114 构造）合并（S2-J-3 役播姊妹的单播位点） | 免 1 次 trim/send | ✅（trim 纯函数，平凡） | 整个单播 send=0.9–1.0µs；一次 trim(256 字符)=16–19ns | 淘汰：亚噪声；mailbox 数据面强调区邻域（S2-J-3 同判） |
| S3-J-4 | `persist/jsonl.ts` `readJsonlObjects` 的 `raw.split("\n")` 换 indexOf/slice 手写行扫描（免整段数组分配，截尾恢复语义逐字保留） | 同 O(n)，免一次分段数组 | ✅ 6 fixtures（干净+尾换行/截尾恢复/空行/空文件/无尾换行/中间损坏同消息抛错）current vs 变体 values+recovery 逐位一致（两 seed 同判） | N=5000（~543KB）：split 仅占 CPU **3.6–4.5%**（75–92µs），scan 变体 delta 在 **-87µs~+7µs 间抖动（无稳定收益，seed1 两次实测均为负）**；JSON.parse ~2ms + readFile ~0.33ms 支配 | 淘汰：被 parse/I-O 支配 + 实测无稳定收益；截尾恢复为数据面契约，风险换零收益 |
| S3-J-5 | `preferences/store.ts` `rebuildViews` 每 view 一次 `nowIso()` 提升为每次重建一次 | 免 (V-1) 次时钟读/重建 | ❌ **反例**（确定性 ticking clock 建模）：现实现允许同一次重建内各 view 的 `lastUpdated` 互不相同（时钟中途走动即发生），提升后强制全部相等——`getView` 可观察分布发散；且时钟读取次数在 stub Date 的测试环境可观测 | 一次 `nowIso()`=424–429ns → V=10 档上界 **~3.8µs/重建**；同一插入路径 `saveToDisk` 全量序列化支配 | 淘汰：**非保行为**（S1-J-1 的裁决把 `lastUpdated` 定为可观察面，本候选是其调用内版本）+ µs 噪声，双重淘汰 |
| S3-J-6 | `preferences/export.ts` `exportAuthorizedPreferences` scopes 过滤 `includes`→Set + `exportForDataset` filter+map 融合单遍 | 免 O(N×5) 或一次中间数组 | ✅ production fidelity（真实 store 500 obs × 40 随机 scope 子集，导出 JSON 的 observations 与控制组逐位一致）+ Set 变体等价 | N=5000：includes=65–67µs vs Set=73–75µs——**Set 化实测慢 6.9–9.5µs**（|scopes|≤5，S1-B-6 同型）；filter+map 融合省 ~80µs 但同路径 `JSON.stringify(...,null,2)`=0.9–1.0ms **支配 ~11–12×**，且导出是一次性授权路径 | 淘汰：Set 化负优化；融合被序列化支配（S2-J-6 的导出侧姊妹） |

## 3. 关键裁决细节

### S3-J-1：脱敏剥除的"顺序遍"不是低效实现，是彻底性语义（本轮最重要发现）

`stripForbidden` 对长度降序排序后的 needles **逐个**做 `split(needle).join("")`：
第 k 遍在第 k-1 遍的**输出**上运行。这意味着剥除一个较长 needle 后拼合出的
较后 needle 新出现会被后续遍捕获。融合单遍扫描（对原文一次同时匹配）看似
等价，实则只见原文中的出现。确定性反例（也是隐私意义上的最坏情形）：

- 输入 body `"sBEGIN PRIVATEk-"`（store 固定策略的 4 条 needles）。
- 现实现：第 1 遍剥 `BEGIN PRIVATE` → `"sk-"`；第 4 遍剥 `sk-` → `""`。
- 融合遍：原文中 `sk-` 不存在（被 `BEGIN PRIVATE` 隔断）→ 输出 `"sk-"`——
  **密钥前缀逃过脱敏进入落盘 JSONL**。

production `redactFeedback` 与顺序控制组在 400 例随机 fuzz 上逐位一致；
融合变体在 186/400 例发散。且公平实现的融合扫描（逐位置试 4 needle 的
`startsWith`）在 400 字符 body 上实测 5.2–5.3µs，比现顺序剥除（539–543ns）
**慢 ~10×**——V8 的 `split(string)` 内建远快于逐字符扫描。非保行为 + 负
优化双重淘汰；反例入库供未来轮次直接引用：**任何对 `stripForbidden` 的
"单遍化/同时匹配化"都被本反例排除**（含 Aho-Corasick / 交替正则
`replaceAll` 变体——它们全都只见原文出现）。顺带的定点校验：本例也再次
确认剥除语义是"非重扫描同 needle"（`"apapi_keyi_key"` 剥 `api_key` 后
剩 `"api_key"` 保留——两实现一致），即现实现的彻底性边界本身是行为，
提速与增强都不属保行为优化。

### S3-J-4：jsonl 读路径的"分配大户"只占 CPU 的 4%

直觉上 `raw.split("\n")` 对 543KB 日志一次性分配 5000+ 字符串是可省的
大头；实测 split 仅 75–92µs，占 split+parse 总 CPU（~2ms）的 **3.6–4.5%**，
JSON.parse 支配其余，readFile 再叠 ~0.33ms。手写 indexOf/slice 行扫描
（截尾恢复语义逐字复刻，6 组 fixture 含中间损坏抛错消息逐位一致）的
delta 在 -87µs~+7µs 间抖动——V8 的 split 快路径 + slice 的 rope 表示使
"省分配"不成立（S3-B-5 的 V8 内建快路径反例同类）。数据面强调区上
风险换零收益，淘汰。这从上界层面封死本切片一切"jsonl 解析微观化"候选：
**瓶颈是 JSON.parse 本身，属必要工作**。

### S3-J-5 与 S1-J-1 的关系：`lastUpdated` 可观察面的调用内版本

S1-J-1 否决 rebuildViews 增量化的理由是"未受影响 view 的 `lastUpdated`
可见时间戳改变"。本轮新角度（不增量、仅提升每 view 的 `nowIso()` 为每次
重建一次）踩中同一可观察面的另一侧：现实现在时钟走动时给各 view **互不
相同**的时间戳，提升后强制相同——存在可区分执行（确定性 ticking clock
建模实测 `["...001Z","...002Z","...003Z"]` vs 三个 `"...001Z"`）。加之
收益上界 ~3.8µs/重建（V=10），双重淘汰。至此 `rebuildViews` 的三个可想
角度（增量化 S1-J-1、跨调用计数器 S1-J-2、调用内时钟提升 S3-J-5）全部
收口。

### 增长维度第三次复核：两条 O(N) 契约路径维持无更优解

- **preference 插入路径**（recurrence 扫描 + rebuildViews + saveToDisk 全量
  序列化）：S1-J-1/S1-J-2/S2-J-6/S3-J-5 四面收口，O(N)/插入是持久化契约
  代价。导出路径本轮补充收口（S3-J-6：过滤优化负收益或被 pretty
  stringify 支配 ~11–12×）。
- **feedback 读/写路径**：S2-J-9/10 + S3-J-1/4 收口——脱敏顺序遍是语义、
  jsonl 解析被必要工作支配、双读串行是错误面契约、needles 排序被 I/O
  支配 ~30×。

### 逐文件收口（第三遍新视角补充，R1-J/R2-J 收口之上）

| 文件 | 第三遍新检查点 | 结论 |
| --- | --- | --- |
| `feedback/redaction.ts` | 见 S3-J-1；`copyFeedback` 条件展开为公开形状契约；`CLASS_ORDER.filter` 表长 5 | 无候选落地 |
| `feedback/store.ts` / `types.ts` | `readFeedbackRecordsRaw`/`readFeedback` 双层过滤为隐私契约（R1-J S21 + S2-J-10 维持）；`writeFeedbackRecords` map+join 为级联重写契约 | 无候选 |
| `persist/jsonl.ts` | 见 S3-J-4；`appendJsonlLine` 每 append `mkdir` 为目录自愈语义（跨进程删除窗口），且 I/O 支配 | 无候选落地 |
| `persist/file-lock.ts` | wx/ownerToken/重试/finally 校验后删锁——全部锁语义数据面，第三次零碰 | 无候选 |
| `context/index.ts` | 见 S3-J-2；`compileCodeMap` 每 entry `[...new Set(calls)].sort` 为规范化契约、一次性；`fileFact` 的 root 重复 normalize 与 S3-J-2 同规模论证不另立 | 无候选落地 |
| `context/packet.ts` | `estimateCodeMapTokens`（index）与 `estimateCodeMapEntry`（packet）跨模块同式重算——去重需在 `CodeMapView` 携带成本（公开形状变更，禁区）或模块缓存（X1-1）；≤6 children/run × ~µs 级 | 无候选（公开面 + 噪声，判据引 S1-C-4 同域，不另立 ID） |
| `preferences/loop-eval.ts`（J1） | 与 `fb41417` 逐字节一致核对；S2-J-1/2 维持；排序拷贝为入参保护 | 无候选（J1 未回退未重做） |
| `preferences/store.ts` | 见 S3-J-5；`loadFromDisk` 一次性；`listTombstones` Array.from 为公开拷贝契约 | 无候选落地 |
| `preferences/export.ts` | 见 S3-J-6 | 无候选落地 |
| `preferences/precedence.ts` / `materialize.ts` / `service.ts` / `types.ts` | `selectHighestPriority` 每元素 2×find(≤5) = R1-J S4 / X1-4 域维持；materialize 的 entries 循环 = 形状契约 | 无候选 |
| `episode/manager.ts` / `closure.ts` / `replay.ts` / `events.ts` / `store.ts` | `reduceEpisodeEvents` 每事件整 episode spread = S1-J-3 域（R 个位）；`decideClosure` = S2-J-8 维持；append 队列/截尾恢复契约 | 无候选 |
| `cluster/host.ts` | 见 S3-J-3；役播过滤 = S1-J-4、每目标 trim = S2-J-3 维持；`viewFor` 闭包每注册一次性 | 无候选落地 |
| `cluster/mailbox.ts` / `spawn.ts` | `claimRole` 自邮回插的循环内 `byRole.get` 重取 = R1-J 已裁数据面噪声；allowlist includes ≤6 | 无候选 |
| `privacy/deletion.ts` / `record-classes.ts` / `state-layout.ts` | 级联 = S2-J-7 维持；`[...tombstones].sort()` 确定性输出契约；字典 find 无生产调用方 | 无候选 |
| `track/loop.ts` / `plan.ts` / `clarify.ts` / `primary-split.ts` | `assignments.find` = S1-J-5、双 readAll = S2-J-11 维持；plan 内联正则 = S3-E-5 同型 ns 级（不另立 ID）；clarify/split 为常数规模一次性 | 无候选 |

## 4. 前后对比

无代码 diff。仓库变更仅本报告一个文件。切片自 R1-J 落地 J1（`fb41417`）
起经 R2-J、本轮 R3-J 两遍复查累计零后续代码改动，逐字节一致。

## 5. 测试

零代码改动下相关套件与全量门禁基线复核，全绿（pnpm 10.17.1）：

```bash
npx tsx --test test/unit/preferences/*.test.ts test/unit/cluster/*.test.ts \
  test/unit/episode/*.test.ts test/unit/context/*.test.ts \
  test/unit/privacy/*.test.ts test/unit/persist/*.test.ts \
  test/unit/track/*.test.ts test/unit/feedback/*.test.ts
# tests 91 / pass 91 / fail 0
npx tsx --test test/integration/m3/*.test.ts test/integration/cluster/*.test.ts \
  test/integration/track/*.test.ts test/integration/m4/*.test.ts
# tests 49 / pass 49 / fail 0
pnpm gate   # Node v22.22.2：typecheck + lint + test + build 全绿
            # 1168 pass / 0 fail / 1 skipped
```

环境注记（R1-J 同款）：VM 系统 Node 为 22.14.0，低于 `engines >=22.19.0`，
在该版本下 `test/unit/cli/doctor.test.ts` 的 node 版本检查于未改动基线上
同样失败（1 fail）；换 nvm 的 Node 22.22.2 后 gate 全绿，与本轮改动无关。

仿真（临时脚本 `/tmp/r3j-sim.mts`，未入库——无赢家不落仿真文件，完整源码
见附录；seeds `0x53aa01`/`0x53aa02` 两次独立运行等价/反例结论逐位一致、
计时抖动范围内稳定；另用 `0x1234ab` 抽查 fuzz 计数随种子变化正常）：

```text
seed=0x53aa01
S3-J-1 counterexample: input="sBEGIN PRIVATEk-" sequential(current)="" fused(candidate)="sk-" production=""
S3-J-1 fuzz: 400 production-fidelity checks passed; fused candidate diverged on 186/400 random bodies
S3-J-1 bench (illegal anyway): sequential=539ns fused=5278ns per 400-char body; same-path disk append=3.4us (I/O dominates ~6x)
S3-J-4 bench N=5000 (~543KB): current split+parse=1980us scan+parse=2068us delta=-87.3us; split alone=89us (4.5% of CPU); file read=333us on top (JSON.parse + I/O dominate)
S3-J-2 bench: I=12 current=21034ns decorated=5514ns delta=15520ns; I=48 current=212.5us decorated=31.2us delta=181.3us; whole buildProjectContextIndex=129.3us (one-shot per run)
S3-J-3 anchor: whole unicast send=1.0us; one trim(256 chars)=18ns -> dedup saves exactly one trim per send (sub-noise; mailbox data plane)
S3-J-5 counterexample (ticking clock): current per-view lastUpdated=["...40.001Z","...40.002Z","...40.003Z"] hoisted=["...40.001Z","...40.001Z","...40.001Z"]
S3-J-5 bench: one nowIso()=427ns -> hoist saves (V-1) calls/rebuild = 3841ns at V=10 views (same insert path then runs saveToDisk full-serialize)
S3-J-6 bench N=5000: includes-filter=67.3us set-filter=74.2us delta=-6.9us; dataset filter+map=194.2us fused=114.2us delta=80.0us; same-path JSON.stringify(...,null,2)=963us dominates the fusion delta ~12x
ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)

seed=0x53aa02
S3-J-1 counterexample: 与 seed 1 逐位一致；fuzz 400 fidelity 全过、fused 发散 186/400
S3-J-1 bench: sequential=541ns fused=5199ns; disk append=3.3us
S3-J-4 bench N=5000: delta=+7.4us（与 seed 1 的 -87.3us 同证无稳定收益）; split alone=75us (3.6% of CPU); file read=344us
S3-J-2 bench: I=12 delta=17204ns; I=48 delta=146.8us; whole build=113.5us
S3-J-3 anchor: send=1.0us; trim=16ns
S3-J-5 counterexample: 与 seed 1 逐位一致；one nowIso()=429ns
S3-J-6 bench: includes vs set delta=-9.5us; fusion delta=81.3us; stringify=906us dominates ~11x
ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)
```

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S3-J-1 | feedback `stripForbidden` 顺序逐 needle split/join 融合单遍同时匹配 | **非保行为**：剥除长 needle 拼合出的后 needle 新出现只有顺序遍能捕获（`"sBEGIN PRIVATEk-"` → 顺序 `""` vs 融合 `"sk-"`，密钥前缀逃过脱敏；fuzz 186/400 发散）；融合实现实测还慢 ~10×。覆盖一切单遍化变体（Aho-Corasick / 交替正则 replaceAll） |
| S3-J-2 | context/index instruction 排序比较器 `pathDepth`/`normalizePath` decorate 提升 | 等价（300 trial 逐位），但现实 I=12 档仅 ~15–17µs/构建、每 run 一次性；压力 I=48 档 ~147–181µs 仍低于 ~190µs 否决线（S1-J-6/S2-J-4 姊妹） |
| S3-J-3 | cluster 单播 send `body.trim()` 双算合并 | 一次 trim 16–19ns、整个单播 send ~1µs；mailbox 数据面邻域（S2-J-3 单播位点姊妹） |
| S3-J-4 | persist/jsonl `split("\n")` 换手写 indexOf 行扫描 | split 仅占 CPU 3.6–4.5%，变体 delta 在 -87µs~+7µs 抖动（无稳定收益）；JSON.parse+readFile 支配；截尾恢复为数据面契约 |
| S3-J-5 | preferences `rebuildViews` 每 view `nowIso()` 提升为每重建一次 | **非保行为**：同一重建内 view 间 `lastUpdated` 可分化的现行为被强制相等（ticking clock 实测发散；S1-J-1 同一可观察面）+ 上界 ~3.8µs/重建 |
| S3-J-6 | preferences export scopes 过滤 Set 化 / dataset filter+map 融合 | Set 化在 |scopes|≤5 实测**慢 6.9–9.5µs**（S1-B-6 同型）；融合省 ~80µs 被同路径 pretty `JSON.stringify`（~0.9–1.0ms）支配 ~11–12×，一次性授权路径 |

重开条件：S3-J-1/5 需先做出**行为变更决策**（分别为脱敏剥除语义的显式重
定义——届时应顺带修复"同 needle 不重扫"的既有边界并重写隐私测试，属语义
工作；以及 view 时间戳语义的显式统一——与 S1-J-1 的重开互为前提）；
S3-J-4 若 jsonl 日志进入数十 MB 级且 JSON.parse 被替换为流式解析（另立
项）后支配结构改变，可凭本报告 6 组 fixture 等价证据重开；S3-J-2 若
instruction 文件数增长 ≥2 个量级且 index 构建变为每任务多次调用，可凭
decorate 等价证据重开；S3-J-3/6 为 ns~µs 级常数或负优化，无现实重开路径。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.mts` 后在仓库根目录 `npx tsx <file> <seed-hex>`
（依赖已装）。seeds：`0x53aa01`、`0x53aa02`（其余段确定性构造，无随机性）。

```ts
/**
 * R3-J deterministic equivalence + counterexample + benchmark simulation.
 * Adjudicates fresh candidates S3-J-1 .. S3-J-6 against the current
 * implementations in src/feedback + src/context + src/cluster + src/persist
 * + src/preferences. Seeded PRNG (mulberry32) -> reproducible.
 * Run: npx tsx <file> <seed-hex>
 */
import { performance } from "node:perf_hooks";
import { mkdtempSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactFeedback } from "/workspace/src/feedback/redaction.js";
import type { FeedbackRecord } from "/workspace/src/feedback/types.js";
import { readJsonlObjects } from "/workspace/src/persist/jsonl.js";
import { buildProjectContextIndex } from "/workspace/src/context/index.js";
import { createClusterHost } from "/workspace/src/cluster/host.js";
import { createAgentProfileRegistry, defaultAgentProfiles } from "/workspace/src/agents/registry.js";
import { nowIso, parseIsoTimestamp } from "/workspace/src/domain/timestamp.js";
import { createProjectId, createTaskId } from "/workspace/src/domain/ids.js";
import type { AgentInstanceId, EpisodeId } from "/workspace/src/domain/ids.js";
import type { ProjectSnapshot } from "/workspace/src/domain/project.js";
import {
  recordObservation,
  resetPreferenceStore,
  listObservations
} from "/workspace/src/preferences/store.js";
import { exportAuthorizedPreferences } from "/workspace/src/preferences/export.js";
import type { PreferenceObservation, PreferenceScope } from "/workspace/src/preferences/types.js";

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
function bench(fn: () => void, reps: number): number {
  fn();
  const t0 = performance.now();
  for (let i = 0; i < reps; i += 1) fn();
  return (performance.now() - t0) / reps; // ms per call
}

const SEED = Number.parseInt(process.argv[2] ?? "0x53aa01", 16) || 0x53aa01;
console.log(`seed=0x${SEED.toString(16)}`);

/* ============================================================
 * S3-J-1: stripForbidden strips needles SEQUENTIALLY (one split/join pass
 * per needle, longest-first); candidate fuses the passes into one
 * simultaneous left-to-right scan over the original text.
 * COUNTEREXAMPLE: removing an earlier (longer) needle can synthesize an
 * occurrence of a later needle, which the sequential pass catches and the
 * fused scan never sees -> observably different redacted bodies.
 * ============================================================ */
{
  const STORE_NEEDLES = ["sk-", "api_key", "API_KEY", "BEGIN PRIVATE"];
  const sortNeedles = (needles: readonly string[]): string[] =>
    [...needles]
      .filter((needle) => needle.length > 0)
      .sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
  // Verbatim reimplementation of the current stripForbidden fold.
  const sequential = (text: string, needles: readonly string[]): string => {
    let out = text;
    for (const needle of needles) {
      out = out.split(needle).join("");
    }
    return out;
  };
  // Candidate: one simultaneous pass over the ORIGINAL string, trying the
  // needles at each position in the same longest-first order.
  const fused = (text: string, needles: readonly string[]): string => {
    let out = "";
    let i = 0;
    while (i < text.length) {
      let matched: string | undefined;
      for (const needle of needles) {
        if (text.startsWith(needle, i)) {
          matched = needle;
          break;
        }
      }
      if (matched !== undefined) {
        i += matched.length;
      } else {
        out += text[i]!;
        i += 1;
      }
    }
    return out;
  };
  const needles = sortNeedles(STORE_NEEDLES);
  const mkRecord = (body: string): FeedbackRecord =>
    ({
      id: "fb-1",
      episodeId: "ep_x" as EpisodeId,
      kind: "human",
      rubricVersion: "r1",
      score: 80,
      evidenceRefs: [],
      redacted: false,
      createdAt: parseIsoTimestamp("2026-08-24T05:00:00.000Z"),
      body
    }) as FeedbackRecord;
  const policy = { redactPII: false, forbiddenSubstrings: STORE_NEEDLES };
  const productionBody = (body: string): string | undefined =>
    redactFeedback(mkRecord(body), policy).feedback.body;

  // Constructed counterexample: stripping "BEGIN PRIVATE" out of
  // "sBEGIN PRIVATEk-" synthesizes "sk-", which the later sequential pass
  // removes; the fused scan of the original never matches "sk-".
  const cx = "sBEGIN PRIVATEk-";
  const seqOut = sequential(cx, needles);
  const fusedOut = fused(cx, needles);
  const prodOut = productionBody(cx);
  console.log(
    `S3-J-1 counterexample: input=${JSON.stringify(cx)} sequential(current)=${JSON.stringify(seqOut)} fused(candidate)=${JSON.stringify(fusedOut)} production=${JSON.stringify(prodOut)}`
  );
  check("S3-J-1 production matches sequential control", prodOut === seqOut);
  check("S3-J-1 divergence demonstrated (fusion is NOT behavior-preserving)", seqOut !== fusedOut);

  // Fidelity fuzz: production always equals the sequential control; count
  // how often the fused candidate diverges on a random corpus.
  const rng = mulberry32(SEED);
  const fragments = [
    "sk-", "api_key", "API_KEY", "BEGIN PRIVATE", "s", "k-", "BEGIN ", "PRIVATE",
    "api", "_key", "A", "PI_KEY", "x", " ", "text", "sBEGIN PRIVATEk-", "apapi_keyi_key"
  ];
  let fusedDivergences = 0;
  for (let trial = 0; trial < 400; trial += 1) {
    const parts: string[] = [];
    const n = 1 + Math.floor(rng() * 24);
    for (let i = 0; i < n; i += 1) parts.push(fragments[Math.floor(rng() * fragments.length)]!);
    const body = parts.join("");
    const expect = sequential(body, needles);
    check("S3-J-1 production fidelity", productionBody(body) === expect, `trial ${trial}`);
    if (fused(body, needles) !== expect) fusedDivergences += 1;
  }
  console.log(`S3-J-1 fuzz: 400 production-fidelity checks passed; fused candidate diverged on ${fusedDivergences}/400 random bodies`);
  check("S3-J-1 fuzz surfaced divergences", fusedDivergences > 0);

  // Bench at the realistic store scale (post-truncation bodies are <=400
  // chars; 4 fixed needles) against the disk append the same path performs.
  const realistic = `user feedback: the run passed but sk-XYZ leaked into logs; also api_key=abc. ${"filler text ".repeat(26)}`.slice(0, 400);
  const seqCost = bench(() => { sequential(realistic, needles); }, 100000);
  const fusedCost = bench(() => { fused(realistic, needles); }, 100000);
  const dir = mkdtempSync(join(tmpdir(), "r3j-"));
  const appendPath = join(dir, "records.jsonl");
  writeFileSync(appendPath, "");
  const appendCost = bench(() => { appendFileSync(appendPath, `{"id":"x","episodeId":"e","kind":"human","score":1}\n`); }, 500);
  console.log(
    `S3-J-1 bench (illegal anyway): sequential=${(seqCost * 1e6).toFixed(0)}ns fused=${(fusedCost * 1e6).toFixed(0)}ns per 400-char body; same-path disk append=${(appendCost * 1e3).toFixed(1)}us (I/O dominates ~${Math.round(appendCost / seqCost)}x)`
  );

  /* ============================================================
   * S3-J-4 (same temp dir): readJsonlObjects splits the whole file into a
   * segments array; candidate walks lines with indexOf/slice, preserving
   * the truncated-tail recovery semantics exactly. Same O(n); JSON.parse
   * and the file read dominate.
   * ============================================================ */
  interface Recovery { incompleteLine?: string; lineNumber?: number }
  const scanVariant = (raw: string, corrupt: (lineNumber: number) => Error): { values: unknown[]; recovery: Recovery } => {
    if (raw === "") return { values: [], recovery: {} };
    const values: unknown[] = [];
    const recovery: Recovery = {};
    let pos = 0;
    let index = 0;
    for (;;) {
      const nl = raw.indexOf("\n", pos);
      const line = nl === -1 ? raw.slice(pos) : raw.slice(pos, nl);
      const isLast = nl === -1;
      if (line !== "") {
        try {
          values.push(JSON.parse(line) as unknown);
        } catch {
          if (isLast) {
            recovery.incompleteLine = line;
            recovery.lineNumber = index + 1;
          } else {
            throw corrupt(index + 1);
          }
        }
      }
      if (isLast) break;
      pos = nl + 1;
      index += 1;
    }
    return { values, recovery };
  };
  const corrupt = (lineNumber: number): Error => new Error(`corrupt at line ${lineNumber}`);
  const mkLine = (i: number): string =>
    JSON.stringify({ id: `fb-${i}`, episodeId: `ep-${i % 40}`, kind: "human", score: i % 100, body: `body text ${i} ${"pad".repeat(8)}` });
  const cleanRaw = `${Array.from({ length: 5000 }, (_, i) => mkLine(i)).join("\n")}\n`;
  const fixtures: { name: string; raw: string }[] = [
    { name: "clean+trailing-newline", raw: cleanRaw },
    { name: "truncated-tail", raw: `${mkLine(0)}\n${mkLine(1)}\n{"id":"fb-trunc","epis` },
    { name: "empty-interior-lines", raw: `${mkLine(0)}\n\n\n${mkLine(1)}\n` },
    { name: "empty-file", raw: "" },
    { name: "no-trailing-newline", raw: `${mkLine(0)}\n${mkLine(1)}` }
  ];
  const jsonlPath = join(dir, "eq.jsonl");
  for (const fixture of fixtures) {
    writeFileSync(jsonlPath, fixture.raw);
    const current = await readJsonlObjects(jsonlPath, corrupt);
    const variant = scanVariant(fixture.raw, corrupt);
    check(
      `S3-J-4 equivalence (${fixture.name})`,
      JSON.stringify(current) === JSON.stringify(variant)
    );
  }
  {
    const badMiddle = `${mkLine(0)}\n{"broken\n${mkLine(1)}\n`;
    writeFileSync(jsonlPath, badMiddle);
    let currentMessage = "";
    let variantMessage = "";
    try { await readJsonlObjects(jsonlPath, corrupt); } catch (error) { currentMessage = (error as Error).message; }
    try { scanVariant(badMiddle, corrupt); } catch (error) { variantMessage = (error as Error).message; }
    check("S3-J-4 equivalence (middle-corrupt throws same message)", currentMessage === variantMessage && currentMessage !== "");
  }
  const currentCpu = (raw: string): number => {
    const segments = raw.split("\n");
    const values: unknown[] = [];
    for (let index = 0; index < segments.length; index += 1) {
      const line = segments[index];
      if (line === undefined || line === "") continue;
      values.push(JSON.parse(line) as unknown);
    }
    return values.length;
  };
  const splitOnly = bench(() => { cleanRaw.split("\n"); }, 200);
  const curCpu = bench(() => { currentCpu(cleanRaw); }, 100);
  const scanCpu = bench(() => { scanVariant(cleanRaw, corrupt); }, 100);
  writeFileSync(jsonlPath, cleanRaw);
  const readCost = bench(() => { readFileSync(jsonlPath, "utf8"); }, 200);
  console.log(
    `S3-J-4 bench N=5000 (~${Math.round(cleanRaw.length / 1024)}KB): current split+parse=${(curCpu * 1e3).toFixed(0)}us scan+parse=${(scanCpu * 1e3).toFixed(0)}us delta=${((curCpu - scanCpu) * 1e3).toFixed(1)}us; split alone=${(splitOnly * 1e3).toFixed(0)}us (${((splitOnly / curCpu) * 100).toFixed(1)}% of CPU); file read=${(readCost * 1e3).toFixed(0)}us on top (JSON.parse + I/O dominate)`
  );
}

/* ============================================================
 * S3-J-2: buildProjectContextIndex sorts instruction paths with a
 * comparator that recomputes pathDepth (-> relativeToRoot -> normalizePath
 * with two regex replaces, on BOTH the root and the path) per comparison.
 * Candidate: decorate-sort-undecorate with depth + normalized path
 * precomputed once per path. Same-valued (pure functions of the inputs);
 * anchored at the one-shot per-run build scale.
 * ============================================================ */
{
  // Verbatim private helpers from src/context/index.ts.
  const normalizePath = (path: string): string => path.replace(/\\/g, "/").replace(/\/+$/, "");
  const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const relativeToRoot = (rootPath: string, filePath: string): string => {
    const root = normalizePath(rootPath);
    const path = normalizePath(filePath);
    if (path === root) return "";
    if (root !== "" && path.startsWith(`${root}/`)) return path.slice(root.length + 1);
    return path;
  };
  const pathDepth = (rootPath: string, filePath: string): number => {
    const relative = relativeToRoot(rootPath, filePath);
    if (relative === "") return 0;
    return relative.split("/").filter((segment) => segment.length > 0).length;
  };
  const currentSort = (rootPath: string, paths: readonly string[]): string[] =>
    [...paths].sort((a, b) => {
      const depthDelta = pathDepth(rootPath, a) - pathDepth(rootPath, b);
      if (depthDelta !== 0) return depthDelta;
      return compareStrings(normalizePath(a), normalizePath(b));
    });
  const decoratedSort = (rootPath: string, paths: readonly string[]): string[] =>
    paths
      .map((path) => ({ path, depth: pathDepth(rootPath, path), norm: normalizePath(path) }))
      .sort((a, b) => a.depth - b.depth || compareStrings(a.norm, b.norm))
      .map((item) => item.path);

  const rng = mulberry32(SEED + 1);
  const root = "/repo";
  const randomPaths = (n: number): string[] => {
    const out: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const depth = Math.floor(rng() * 5);
      const segments: string[] = [];
      for (let d = 0; d < depth; d += 1) segments.push(`dir${Math.floor(rng() * 4)}`);
      segments.push("AGENTS.md");
      const sep = rng() < 0.2 ? "\\" : "/";
      const prefix = rng() < 0.85 ? `${root}${sep}` : "";
      const suffix = rng() < 0.15 ? "/" : "";
      out.push(`${prefix}${segments.join(sep)}${suffix}`);
    }
    return out;
  };
  const NOW = parseIsoTimestamp("2026-08-24T05:00:00.000Z");
  const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";
  let snapshotForBench: ProjectSnapshot | undefined;
  for (let trial = 0; trial < 300; trial += 1) {
    const paths = randomPaths(1 + Math.floor(rng() * 24));
    const snapshot = {
      id: createProjectId(UUID),
      rootPath: root,
      discoveredAt: NOW,
      instructionFiles: paths.map((path) => ({ path })),
      manifests: Array.from({ length: 12 }, (_, i) => ({ path: i === 10 ? "/repo/package.json" : `/repo/pkg${i}/manifest.yaml` })),
      commands: Array.from({ length: 8 }, (_, i) => ({ name: `cmd${i}`, command: `run cmd${i}` })),
      facts: Array.from({ length: 20 }, (_, i) => ({ key: i % 2 ? `architecture.a${i}` : `risk.r${i}`, value: `v${i}`, confidence: "HIGH" as const }))
    } as unknown as ProjectSnapshot;
    if (trial === 0) snapshotForBench = snapshot;
    const production = buildProjectContextIndex(snapshot).instructionPrecedence;
    const control = currentSort(root, paths);
    const variant = decoratedSort(root, paths);
    check("S3-J-2 control fidelity", JSON.stringify(production) === JSON.stringify(control), `trial ${trial}`);
    check("S3-J-2 equivalence", JSON.stringify(control) === JSON.stringify(variant), `trial ${trial}`);
  }
  const paths12 = randomPaths(12);
  const paths48 = randomPaths(48);
  const cur12 = bench(() => { currentSort(root, paths12); }, 20000);
  const dec12 = bench(() => { decoratedSort(root, paths12); }, 20000);
  const cur48 = bench(() => { currentSort(root, paths48); }, 5000);
  const dec48 = bench(() => { decoratedSort(root, paths48); }, 5000);
  const whole = bench(() => { buildProjectContextIndex(snapshotForBench!); }, 2000);
  console.log(
    `S3-J-2 bench: I=12 current=${(cur12 * 1e6).toFixed(0)}ns decorated=${(dec12 * 1e6).toFixed(0)}ns delta=${((cur12 - dec12) * 1e6).toFixed(0)}ns; I=48 current=${(cur48 * 1e3).toFixed(1)}us decorated=${(dec48 * 1e3).toFixed(1)}us delta=${((cur48 - dec48) * 1e3).toFixed(1)}us; whole buildProjectContextIndex=${(whole * 1e3).toFixed(1)}us (one-shot per run)`
  );
}

/* ============================================================
 * S3-J-3: the UNICAST send path trims input.body twice (emptiness check +
 * mail construction); S2-J-3 adjudicated the role-cast per-target trims,
 * this is the unicast sibling. Equivalence is trivial (trim is pure);
 * anchor the double-trim against the whole send.
 * ============================================================ */
{
  const registry = createAgentProfileRegistry(defaultAgentProfiles());
  const host = createClusterHost({
    registry,
    maxTasks: 16,
    generateId: (() => { let n = 0; return () => `id${(n += 1)}`; })(),
    onSpawn: () => undefined
  });
  host.register("agent-a" as AgentInstanceId, "planner", createTaskId(() => "t-a"));
  host.register("agent-b" as AgentInstanceId, "tester", createTaskId(() => "t-b"));
  const body = `  ${"please verify the acceptance criteria and report evidence refs ".repeat(4)}  `;
  const sendCost = bench(() => {
    host.send({ from: "agent-a" as AgentInstanceId, body, to: "agent-b" as AgentInstanceId });
  }, 5000);
  const trimCost = bench(() => { body.trim(); }, 500000);
  console.log(
    `S3-J-3 anchor: whole unicast send=${(sendCost * 1e3).toFixed(1)}us; one trim(${body.length} chars)=${(trimCost * 1e6).toFixed(0)}ns -> dedup saves exactly one trim per send (sub-noise; mailbox data plane)`
  );
}

/* ============================================================
 * S3-J-5: rebuildViews calls nowIso() once PER VIEW inside the rebuild
 * loop; candidate hoists a single nowIso() call for the whole rebuild.
 * COUNTEREXAMPLE (modeled with a deterministic ticking clock): the current
 * shape permits distinct lastUpdated values across views within one
 * rebuild whenever the clock ticks mid-loop; hoisting forces them all
 * equal -> getView-observable divergence (S1-J-1's adjudication treated
 * exactly this field as an observable surface).
 * ============================================================ */
{
  let tick = 0;
  const tickingClock = (): string => new Date(1756000000000 + (tick += 1)).toISOString();
  const viewKeys = ["user:default", "project:p1", "role:tester"];
  tick = 0;
  const currentStamps = viewKeys.map(() => tickingClock());
  tick = 0;
  const hoistedStamp = tickingClock();
  const hoistedStamps = viewKeys.map(() => hoistedStamp);
  console.log(
    `S3-J-5 counterexample (ticking clock): current per-view lastUpdated=${JSON.stringify(currentStamps)} hoisted=${JSON.stringify(hoistedStamps)}`
  );
  check(
    "S3-J-5 divergence demonstrated (hoist changes observable lastUpdated pattern)",
    JSON.stringify(currentStamps) !== JSON.stringify(hoistedStamps) && new Set(currentStamps).size === 3
  );
  const nowCost = bench(() => { nowIso(); }, 200000);
  console.log(
    `S3-J-5 bench: one nowIso()=${(nowCost * 1e6).toFixed(0)}ns -> hoist saves (V-1) calls/rebuild = ${(9 * nowCost * 1e6).toFixed(0)}ns at V=10 views (same insert path then runs saveToDisk full-serialize)`
  );
}

/* ============================================================
 * S3-J-6: exportAuthorizedPreferences filters with options.scopes.includes
 * per observation (|scopes| <= 5) and exportForDataset chains filter+map;
 * candidates Set-ify / fuse. Same-valued; both exports then JSON.stringify
 * the whole result with 2-space indentation, which dominates.
 * ============================================================ */
{
  const rng = mulberry32(SEED + 2);
  const scopes: PreferenceScope[] = ["user", "project", "task-family", "role", "model"];
  const mkObs = (i: number): PreferenceObservation =>
    ({
      id: `obs-${i}`,
      scope: scopes[Math.floor(rng() * scopes.length)]!,
      scopeKey: `k${Math.floor(rng() * 3)}`,
      key: `key${Math.floor(rng() * 4)}`,
      value: rng() < 0.5 ? `v${Math.floor(rng() * 6)}` : Math.floor(rng() * 100),
      evidenceEpisodeId: "ep_x" as EpisodeId,
      weight: 1,
      createdAt: parseIsoTimestamp(new Date(1756000000000 + i * 1000).toISOString()),
      explicit: rng() < 0.3,
      recurrenceCount: 1
    }) as PreferenceObservation;

  // Production fidelity on the real store (persistence unconfigured, so
  // saveToDisk is a no-op).
  resetPreferenceStore();
  for (let i = 0; i < 500; i += 1) recordObservation(mkObs(i));
  const stored = listObservations();
  for (let trial = 0; trial < 40; trial += 1) {
    const subset = scopes.filter(() => rng() < 0.5);
    const wanted = subset.length > 0 ? subset : undefined;
    const exported = exportAuthorizedPreferences(wanted !== undefined ? { scopes: [...wanted] } : {});
    const parsed = JSON.parse(exported.data) as { observations: PreferenceObservation[] };
    const control = wanted !== undefined ? stored.filter((o) => wanted.includes(o.scope)) : stored;
    check(
      "S3-J-6 production fidelity (includes-filter shape)",
      JSON.stringify(parsed.observations) === JSON.stringify(control),
      `trial ${trial}`
    );
    const viaSet = ((): PreferenceObservation[] => {
      if (wanted === undefined) return stored;
      const set = new Set(wanted);
      return stored.filter((o) => set.has(o.scope));
    })();
    check("S3-J-6 Set-filter equivalence", JSON.stringify(viaSet) === JSON.stringify(control), `trial ${trial}`);
  }
  resetPreferenceStore();

  const big = Array.from({ length: 5000 }, (_, i) => mkObs(i));
  const wanted: PreferenceScope[] = ["user", "role"];
  const wantedSet = new Set(wanted);
  const inc = bench(() => { big.filter((o) => wanted.includes(o.scope)); }, 2000);
  const set = bench(() => { big.filter((o) => wantedSet.has(o.scope)); }, 2000);
  const filtered = big.filter((o) => wantedSet.has(o.scope));
  const stringify = bench(() => {
    JSON.stringify({ version: 1, exportedAt: "2026-08-24T05:00:00.000Z", count: filtered.length, observations: filtered }, null, 2);
  }, 100);
  // exportForDataset shape: filter(!tombstoned) + map(project) vs fused loop.
  const tombs = new Set<string>(big.filter(() => rng() < 0.1).map((o) => o.id));
  const chained = bench(() => {
    big.filter((o) => !tombs.has(o.id)).map((o) => ({ scope: o.scope, scopeKey: o.scopeKey, key: o.key, value: o.value, weight: o.weight, createdAt: o.createdAt }));
  }, 2000);
  const fusedLoop = bench(() => {
    const out: unknown[] = [];
    for (const o of big) {
      if (tombs.has(o.id)) continue;
      out.push({ scope: o.scope, scopeKey: o.scopeKey, key: o.key, value: o.value, weight: o.weight, createdAt: o.createdAt });
    }
  }, 2000);
  console.log(
    `S3-J-6 bench N=5000: includes-filter=${(inc * 1e3).toFixed(1)}us set-filter=${(set * 1e3).toFixed(1)}us delta=${((inc - set) * 1e3).toFixed(1)}us; dataset filter+map=${(chained * 1e3).toFixed(1)}us fused=${(fusedLoop * 1e3).toFixed(1)}us delta=${((chained - fusedLoop) * 1e3).toFixed(1)}us; same-path JSON.stringify(...,null,2)=${(stringify * 1e3).toFixed(0)}us dominates the fusion delta ~${Math.round(stringify / Math.max(chained - fusedLoop, 1e-9))}x`
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)");
```

MORE_OPTIMA=NO
BRANCH=cursor/r3-j-persist-third-pass-83a1
