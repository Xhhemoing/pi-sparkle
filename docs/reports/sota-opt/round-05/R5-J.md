MODEL_SLUG=claude-fable-5-thinking-xhigh

# R5-J：数据面切片（cluster / privacy / preferences / episode / persist / track / context / feedback）第五遍复查报告

**战役:** 全库持久 SOTA 优化 Round 5 / R5-J
**基线:** `cursor/sota-persistent-opt-83a1` @ `0c1b45c`
**分支:** `cursor/r5-j-persist-fifth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 切片 29 个文件（`src/cluster/` 3、
`src/privacy/` 3、`src/preferences/` 7、`src/episode/` 5、`src/persist/` 2、
`src/track/` 4、`src/context/` 2、`src/feedback/` 3，共 3655 行）自 R1-J 落地
J1（`fb41417`）以来**逐字节未变**（`git diff fb41417..0c1b45c -- <切片>` 为空；
自 `7acb666` 起全切片 diff 仍仅含 `loop-eval.ts` 一个文件），R1-J 的逐文件
收口、S1-J-1..7、S2-J-1..11、S3-J-1..6、S4-J-1..6 共三十条排除全部继承有效。
本轮在完整排除表（含 R5 已产出的 S5-C/S5-F/S5-H/S5-A/S5-B/S5-D/S5-E-*）之上
第五次全量实际读码、以新角度枚举，得到 6 个此前未点名的新候选
（S5-J-1 … S5-J-6），全部经理论 + 确定性仿真（seeded mulberry32，等价 fuzz /
**行为发散反例** / **身份别名化演示** / 真实规模基准，seeds
`0x55cc01`/`0x55cc02` 两次独立运行等价与发散结论逐位一致、计时抖动范围内
稳定）裁决后淘汰：**1 个被反例证明非保行为**（S5-J-3 的墓碑读延迟会让损坏的
tombstones.json 在无匹配删除时静默通过——隐私侧车 fail-closed 变 fail-open，
且合法收益仅存在于无匹配路径的 74.8–86.2µs，低于 ~190µs 否决线），**1 个是
身份可观察改变**（S5-J-6 共享 default 分支结果使各 child 的
acceptanceCriteria 数组互为别名，S1-B-8/S4-B-3 同类，且收益 ≤86ns/run），
其余 4 个在真实规模是 ns~µs 级噪声（S5-J-1 复制消除 4.1–5.9µs 被同路径
pretty stringify 支配 ~157–226×；S5-J-2 估算串免分配 2.6–2.7µs/编译；
S5-J-4 冗余 Map.set 6.2–6.6ns；S5-J-5 属性双读 CSE 命中路径 ~10ns/查）。
未重开任何 X* / S1-* / S2-* / S3-* / S4-* / S5-* 条目。J1 落地代码本轮
`scripts/r1j-equivalence-sim.ts` 重跑全绿（2468 项逐位检查，2926.9×）。
数据面（删除/脱敏/状态布局、mailbox、episode 闭合、jsonl 锁语义）**零
diff**，可见行为天然不变。J1 之上本切片在其数据面契约下经五遍穷尽复查仍为
SOTA。

## 0. 范围与约束遵守

- 切片：`src/cluster/`、`src/privacy/`、`src/preferences/`、`src/episode/`、
  `src/persist/`、`src/track/`、`src/context/`、`src/feedback/`。29 个文件
  本轮全部第五次实际读码，未依赖 R1-J/R2-J/R3-J/R4-J 的记忆。
- 先读并遵守（顺序强制）：README → EXCLUSIONS.md（含 S5-C/S5-F 已落地与
  全部 S5-A..H 新排除）→ round-05/PLAN.md → round-01/R1-J.md →
  round-02/R2-J.md → round-03/R3-J.md → round-04/R4-J.md。
- 排除表遵守：候选枚举刻意绕开全部既有排除——S1-J-1..7、S2-J-1..11、
  S3-J-1..6、S4-J-1..6 共三十条全部不再提案。特别地：**J1 落地代码未回退
  未重做**（`loop-eval.ts` 与 `fb41417` 逐字节一致，本轮 `git diff` 核对，
  且 `scripts/r1j-equivalence-sim.ts` 重跑全绿）；**S4-J-2/S4-J-3/S2-J-10
  遵守**（不再提任何串行 await 并行化——本切片 I/O 编排面 R4-J 已四面
  收口，本轮零新提案）；**S2-J-1/S2-J-2 遵守**（`tombstones.has` 调用模式
  与 createdAt 字典序比较器零碰）；**S1-J-1/S3-J-5 遵守**（`rebuildViews`
  与 `lastUpdated` 可观察面零碰）；**S3-J-1 遵守**（`stripForbidden` 顺序
  剥除语义零碰）；**S4-J-1 遵守**（spawn 死分支保留）；X1-1、X0-5、X4-2
  直接跳过。本轮只探索**未被点名的新角度**：授权导出被丢弃的防御拷贝
  （S5-J-1）、codeMap 成本估算的字符串构建（S5-J-2）、删除级联的墓碑读
  时机（S5-J-3）、mailbox enqueue 冗余 Map.set（S5-J-4）、resolveFromMap
  属性双读（S5-J-5）、acceptanceForRole default 分支跨 child 复用
  （S5-J-6）。
- **数据面强调区零 diff**：`privacy/deletion.ts` 的全量读→map→全量重写
  级联（S5-J-3 仅在仿真中建模并被反例否决，生产删除路径一行未改）、
  `persist/file-lock.ts` 的 wx/ownerToken/重试语义、`persist/jsonl.ts` 的
  截尾恢复、`cluster/mailbox.ts` 的 role 队列 claim 语义、
  `episode/manager.ts` 的 fail-closed reducer——可见行为天然不变。
- 规格强制双路（Beta LCB vs 正态 LCB；offline-logit vs 概率可加）不在本区。
  分析不改 in-flight；Tracking 无命令权；H/score 不写路由；live = R0 等价、
  R1 未接线 live（`primary-split.ts` 注释与实现零碰）。不声称
  Outcome-supported；Checkpoint F-PROD 仍开放（ADR-005）。不改阈值、权限、
  数据面契约、公开签名；未改任何测试。
- 仓库变更仅本报告一个文件。无赢家，未落仿真脚本（完整源码见附录）。

## 1. 规模与门槛基底（第五遍继承 + 本轮校准）

R1-J..R4-J 已实测本切片规模：episode 内 run 数、cluster peer 数
（≤ maxTasks=16）、track 子任务数（C≤~6，且 planFromContract 每 role 至多
一个 child）、context 构建输入（十位级）、redaction needles（=4）全部为
小常数；**唯一无上界增长维度是 preference 观察数 N 与 feedback 记录数 N**，
两者的插入/读取路径均被同路径的全量 JSON 序列化 + 磁盘 I/O 支配（R2-J
实测 ~50×，本轮 S5-J-1 再证 ~157–226×），度量路径已被 J1 收口为
Θ(N log N) 且无生产调用方。代码逐字节未变，全部继承。

战役落地线继承：已落地项在百 ms 级或复杂度类下降（J1 2770×、S1-C
~450ms/fit、S3-C ~140–155ms、S5-C/S5-F 均为 ms 级仿真显著项），µs 级候选
一律被否决过（S1-I-1 ~190µs、S3-D-3 351–388µs、S4-J-3 60–62µs）。本轮
全部候选的绝对收益上界是 **74.8–86.2µs/无匹配删除**（S5-J-3，且被反例
证明非保行为）；合法候选的最大值是 **4.1–5.9µs**（S5-J-1，一次性授权
导出路径）。没有候选接近数十 ms 落地线；复杂度类层面，五遍扫描后切片内
已无任何随无上界维度超线性的路径（J1 后唯一超线性残留是 O(N)/插入的
持久化契约本身与 O(E×R) 的 reducer spread——R 个位、S1-J-3 域）。据此裁决。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S5-J-1 | `preferences/export.ts` `exportAuthorizedPreferences` 在带 scopes 过滤时，`listObservations()` 的防御拷贝被 filter 结果立即丢弃，候选消除中间拷贝 | 免一次 O(N) 数组拷贝 | ✅ 40 trial（真实 store 500 obs × 随机 scope 子集，导出 observations 与直接过滤逐位一致） | N=5000：copy+filter=68.6–70.1µs vs direct-filter=64.1–65.4µs → **delta 4.1–5.9µs**（spread 拷贝本体仅 1.8–2.1µs）；同路径 pretty `JSON.stringify`=874–927µs **支配 ~157–226×**；一次性授权导出路径 | 淘汰：S3-J-6 的同函数姊妹（那轮裁过滤/融合，本轮裁上游拷贝），被序列化支配 + 需新 store 访问器或模块内直访（公开面变更） |
| S5-J-2 | `context/index.ts` `estimateCodeMapTokens` 与 `context/packet.ts` `estimateCodeMapEntry` 构建 compact 字符串只为取 `.length`，候选改闭式长度算术（免字符串分配） | 长度公式逐项对应模板字面量段长，Math.ceil 同整数 ⇒ 逐位平凡 | ✅ 500 trial fuzz（随机 path/symbol/kind/public/calls 含空 calls）两法逐位一致（两 seed 同判） | E=60：string-build=3.04–3.13µs vs arithmetic=0.42–0.44µs → **delta 2.6–2.7µs/编译**；整个 `compileContextPacket`=35.1–35.9µs、每 run ≤6 次编译 + 1 次构建 ⇒ 上界 ~19µs/run | 淘汰：一次性构建 µs 级噪声（S1-J-6/S2-J-4/S4-J-6 同域）；跨模块同式去重已被 R3-J 裁为公开形状/X1-1 禁区 |
| S5-J-3 | `privacy/deletion.ts` `cascadeFeedbackTombstones` 在扫描匹配**之前**读 tombstones.json，候选把读延迟到发现首个匹配之后（无匹配免一次文件读） | 无匹配路径省 1 次小文件读 | ❌ **反例**：损坏的 tombstones.json（非字符串数组）+ 无匹配记录时，现实现**确定性抛出** `malformed feedback tombstones.json: expected a string array`（fail-closed 浮出隐私侧车损坏），延迟读变体静默返回 `[]`（**fail-open**）；健康路径（匹配/无匹配）返回值与两文件落盘字节逐位一致 | 无匹配 N=200：current(2 reads)=255.8–269.8µs deferred(1 read)=181.0–183.6µs → **省 74.8–86.2µs/无匹配删除**；匹配路径零节省（读仍必需）且随后全量重写支配 | 淘汰：**非保行为**（隐私面损坏信号被吞——S2-J-7 邻域的错误面版本）+ 低于 ~190µs 否决线 + 删除数据面强调区，三重淘汰 |
| S5-J-4 | `cluster/mailbox.ts` `enqueue` role-cast 分支对已存在列表就地 push 后仍执行 `byRole.set`（冗余），候选仅首建时 set | 免 1 次 Map.set/enqueue | ✅ 300 trial fuzz（单播/役播混合 + 自邮回插 + claim 后 pending/inbox 三面）逐位一致（两 seed 同判） | 一次冗余 Map.set=**6.2–6.6ns**；整个 role-cast enqueue=29–30ns | 淘汰：亚噪声 + mailbox 数据面强调区（R1-J claimRole byRole.get 重取、S4-J-5 box() 提升同域；S3-E-3 同型冗余 set） |
| S5-J-5 | `context/index.ts` `resolveFromMap` 对每个 Record 探针读属性两次（`!== undefined` 守卫 + return），候选 CSE 为局部变量 | 免命中探针的第二次属性读 | ✅ 600 trial fuzz（map undefined / 各键位命中 / 全 miss / alternate/fact 缺省）`Object.is` 逐位一致（两 seed 同判） | 命中：21.1–21.8ns→11.8–12.2ns（**省 ~10ns/查**）；miss：~25ns→~24ns（守卫仍单读，V8 已近优）；整个 `buildProjectContextIndex`（带双 hash map）=40.1–40.4µs、每 run 一次性 | 淘汰：ns 级一次性构建噪声（S4-J-6/S2-J-4 同域；S3-I-1 的"V8 已优化"同型佐证） |
| S5-J-6 | `track/loop.ts` `startTrackedRun` children map 中 planner/implementer/reviewer 三个 child 各自调 `acceptanceForRole` 走同一 default 分支重算同值，候选算一次共享 | 免 ≤2 次 O(criteria) filter+map | ✅ 值等价（三 role 输出 JSON 相同）；❌ **身份发散演示**：现实现每 child 独立数组与独立 criterion 对象（`planner !== implementer`、`planner[0] !== implementer[0]`），共享后互为别名——经一个 child 的 push 在另一 child 可见（实测 `ac-injected` 穿透） | 一次 default 分支调用=38–43ns → 共享省 ≤**77–86ns/run**、每 tracked run 一次性 | 淘汰：可观察身份改变（S1-B-8/S4-B-3 同判据——返回类型是可变数组）+ 亚噪声；深拷贝共享则零收益 |

## 3. 关键裁决细节

### S5-J-3：删除级联的"先读墓碑"不是低效顺序，是损坏检测点（本轮最重要发现）

`cascadeFeedbackTombstones` 的读序是：records（损坏被 `.catch(() => [])`
吞掉——记录读失败等同无记录）→ **tombstones（损坏必抛）** → 扫描匹配 →
（有匹配才）重写两文件。直觉上墓碑读在无匹配时是浪费的 I/O；但把它延迟到
"发现首个匹配之后"恰好删掉了唯一一个**无条件校验 tombstones.json 完整性**
的执行点：构造损坏侧车 `{"not":"an array"}` + 全部记录不匹配目标 episode，
现实现确定性抛 `DomainValidationError`（操作者立刻知道隐私侧车坏了），
延迟读变体静默返回 `[]`——删除工具报告成功、损坏留存。隐私删除路径上
fail-closed → fail-open 是行为回归而非优化。叠加两点：合法收益只存在于
无匹配路径（74.8–86.2µs，低于 ~190µs 否决线——S4-J-3 的 60µs、S3-D-3 的
351–388µs 都被否决过）；匹配路径读仍必需、零节省，且随后的全量重写支配。
三重淘汰，反例入库。至此删除级联的全部三个可想角度（无匹配早退 S2-J-7、
双文件并行 S4-J-3、墓碑读延迟 S5-J-3）收口，**级联的 I/O 序本身就是
错误面契约**。

### S5-J-6：`acceptanceForRole` 的"重复计算"是每 child 独立所有权

planFromContract 每 role 至多产出一个 child，所以 role 级记忆化无对象；
但 planner/implementer/reviewer 三个 role 共享 default 分支，对同一
contract 重算同值 filter+map。共享该结果的廉价形式（直接别名）被身份
演示否决：`acceptanceForRole` 返回**可变**的 `{id, description}[]`，
children 构造后各自持有；共享后经 child A 数组 push 的注入在 child B 的
acceptanceCriteria 可见——与 S1-B-8（allowedIds 防御拷贝省略）、S4-B-3
（共享冻结单例）同判据。忠实形式（共享 + 每 child 深拷贝）收益为负
（拷贝成本 ≥ 重算成本，重算本体仅 38–43ns）。本候选同时封死"把
`acceptanceForRole` 结果提升到 children map 外"的一切变体。

### S5-J-1/2/4/5：四个"客观冗余"在真实规模全是 ns~µs 级

- **S5-J-1**：`listObservations()` 的拷贝在 scopes 过滤时确实被立即丢弃
  ——但 spread 拷贝本体只有 1.8–2.1µs（N=5000），且消除它需要新的 store
  访问器（公开面）或把导出逻辑挪进 store 模块（边界变更）。同路径 pretty
  stringify 支配 ~157–226×。S3-J-6 的规模论证第三次再现。
- **S5-J-2**：成本估算构串是本轮读码新发现的"纯度量用途分配"——算术
  长度闭式可证逐位等价（500 fuzz 全过），但整条链每 run 上界 ~19µs。
  值得注意它同时存在于 index.ts 与 packet.ts 两站点；跨模块去重已被
  R3-J 裁为禁区，站点内消除是 µs 噪声。
- **S5-J-4**：`enqueue` 的冗余 `byRole.set` 是 6.2–6.6ns 的字面冗余，
  mailbox 数据面上不值得任何 diff。
- **S5-J-5**：`resolveFromMap` 命中路径的属性双读 CSE 省 ~10ns/查；miss
  路径 V8 已把守卫读优化到基本免费（~1ns delta）。每 run 一次性构建里
  几十次调用，合计亚 µs。

### 增长维度第五次复核：两条 O(N) 契约路径维持无更优解

preference 插入路径（recurrence 扫描 + rebuildViews + saveToDisk）与
feedback 读写路径（脱敏顺序遍 + jsonl parse + 双读串行 + 级联全量重写）
的收口论证（S1-J-1/2、S2-J-6/9/10、S3-J-1/4/5/6、S5-J-3）在零 diff 下
全部继承并本轮加固（S5-J-1 从导出侧、S5-J-3 从删除侧再各补一票支配/
反例证据）。本轮无剩余角度可提。

### 逐文件收口（第五遍新视角补充，R1-J..R4-J 收口之上）

| 文件 | 第五遍新检查点 | 结论 |
| --- | --- | --- |
| `preferences/export.ts` | 见 S5-J-1；`exportForDataset` 侧 = S3-J-6 维持 | 无候选落地 |
| `preferences/store.ts` | `loadFromDisk`→`rebuildViews` 一次性；`listTombstones` 拷贝为公开契约；insert 路径 = S1-J-1/2、S2-J-6、S3-J-5 四面维持 | 无候选 |
| `preferences/loop-eval.ts`（J1） | 与 `fb41417` 逐字节一致核对 + `r1j-equivalence-sim` 重跑全绿（2468 checks，2926.9×）；S2-J-1/2 维持 | 无候选（J1 未回退未重做） |
| `preferences/precedence.ts` / `materialize.ts` / `service.ts` / `types.ts` | `selectHighestPriority` 2×find(≤5) = X1-4 域第五次维持；materialize entries 循环 = R4-J 已裁 | 无候选 |
| `context/index.ts` | 见 S5-J-2/S5-J-5；`uniquePreserve`/`resolveInstructionOwnership` 单遍或 S3-J-2 同规模；manifests Record 与 fileFact 哈希**不同值**（fallback 串不同）故去重不等价（R4-J 注记本轮复核确认） | 无候选落地 |
| `context/packet.ts` | 见 S5-J-2；`collapseFacts` 单事实组快路径 = R1-J S18 裁决域（组个位、µs）不另立；首 sort = S1-J-7、防御拷贝 = S2-J-5、双遍 = S4-J-4 维持 | 无候选落地 |
| `privacy/deletion.ts` | 见 S5-J-3；`deleteRunRecords` 单 stat+rm 无可省；`[...tombstones].sort()`/`cascaded.sort()` 确定性输出契约 | 无候选落地 |
| `privacy/record-classes.ts` / `state-layout.ts` | 字典 find 无生产调用方（R1-J S12 第五次维持）；纯路径拼接 | 无候选 |
| `cluster/mailbox.ts` | 见 S5-J-4；`drain` 对缺席 agent 的 `set(agentId, [])` 空建 = 同型 ns 不另立；claimRole = S4-J-5/R1-J 维持 | 无候选落地 |
| `cluster/host.ts` / `spawn.ts` | 役播首目标/余目标双段构造合并 = S2-J-3 域 ns；spawn 死分支 = S4-J-1 维持；`?? []` 死分支 = R4-J 已裁 | 无候选 |
| `episode/manager.ts` / `closure.ts` / `replay.ts` / `events.ts` / `store.ts` | reducer 每事件 spread = S1-J-3 域（R 个位）；`decideClosure` = S2-J-8 维持；append 队列 promise 链为顺序契约；`replayFromLog` 单遍 | 无候选 |
| `persist/jsonl.ts` / `file-lock.ts` | S3-J-4 维持（split 占 CPU ~4%）；`readFeedbackTombstoneIds` 的 every+Set 双遍 = 常数噪声不另立；锁语义数据面第五次零碰 | 无候选（数据面） |
| `track/loop.ts` | 见 S5-J-6；`assignments.find` = S1-J-5、双 readAll = S2-J-11、catalog∥learned = S4-J-2 维持；`resolvedQuestionIds`/`catalogIds.includes` 常数规模（X3-1 域） | 无候选落地 |
| `track/plan.ts` / `clarify.ts` / `primary-split.ts` | `planFromContract` 每 role 至多一 child（S5-J-6 的记忆化无对象前提，本轮实证）；内联正则 = S3-E-5 同型；双 getMaterializedView = R4-J 已裁 | 无候选 |
| `feedback/redaction.ts` / `store.ts` / `types.ts` | stripForbidden = S3-J-1、needles 排序 = S2-J-9、双读 = S2-J-10、双层过滤 = R1-J S21 维持；`copyFeedback` 条件展开为公开形状契约 | 无候选 |

## 4. 前后对比

无代码 diff。仓库变更仅本报告一个文件。切片自 R1-J 落地 J1（`fb41417`）起
经 R2-J、R3-J、R4-J、本轮 R5-J 四遍复查累计零后续代码改动，逐字节一致。

## 5. 测试

零代码改动下相关套件与全量门禁基线复核，全绿（Node v22.22.2，pnpm 10.17.1）：

```bash
npx tsx scripts/r1j-equivalence-sim.ts
# ALL EQUIVALENCE CHECKS PASSED (2468 bitwise checks)
# perf fixture: reference 10252.5 ms -> current 3.5 ms (2926.9x)
npx tsx --test test/unit/preferences/*.test.ts test/unit/cluster/*.test.ts \
  test/unit/episode/*.test.ts test/unit/context/*.test.ts \
  test/unit/privacy/*.test.ts test/unit/persist/*.test.ts \
  test/unit/track/*.test.ts test/unit/feedback/*.test.ts
# tests 91 / pass 91 / fail 0
npx tsx --test test/integration/m3/*.test.ts test/integration/cluster/*.test.ts \
  test/integration/track/*.test.ts test/integration/m4/*.test.ts
# tests 49 / pass 49 / fail 0
pnpm gate   # typecheck + lint + test + build 全绿：1168 pass / 0 fail / 1 skipped
```

仿真（临时脚本 `/tmp/r5j-sim.mts`，未入库——无赢家不落仿真文件，完整源码
见附录；seeds `0x55cc01`/`0x55cc02` 两次独立运行等价/反例结论逐位一致、
计时抖动范围内稳定）：

```text
seed=0x55cc01
S5-J-1 bench N=5000: copy+filter=69.5us direct-filter=65.4us delta=4.1us (spread copy alone=2.1us); same-path pretty JSON.stringify=927us dominates ~226x (one-shot authorized export)
S5-J-2 bench E=60: string-build estimates=3.13us arithmetic=0.42us delta=2.71us/compile; whole compileContextPacket=35.6us (<=6 compiles + 1 build per run)
S5-J-3 counterexample (malformed tombstones.json, no matches): current throws "malformed feedback tombstones.json: expected a string array"; deferred returns [] (threw: "")
S5-J-3 bench no-match N=200: current(2 reads)=255.8us deferred(1 read)=181.0us saving=74.8us/no-match delete (match path saves nothing; deletion data plane)
S5-J-4 bench: whole role-cast enqueue=30ns; one redundant Map.set=6.4ns (mailbox data plane)
S5-J-5 bench: hit current=21.5ns cse=12.2ns; miss current=26.0ns cse=23.7ns; whole buildProjectContextIndex(with hash maps)=40.1us (one-shot per run)
S5-J-6 bench: one default-branch acceptanceForRole=39ns -> sharing saves <=2 calls/run = 78ns (identity change; one-shot per tracked run)
ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)

seed=0x55cc02
S5-J-1 bench N=5000: copy+filter=68.6us direct-filter=64.1us delta=4.5us; stringify=874us dominates ~196x
S5-J-2 bench E=60: delta=2.60us/compile; whole compile=35.1us
S5-J-3 counterexample: 与 seed 1 逐位一致；bench saving=86.2us/no-match delete
S5-J-4 bench: enqueue=29ns; one redundant Map.set=6.2ns
S5-J-5 bench: hit 21.1ns→12.0ns; miss 25.0ns→23.9ns; whole build=40.3us
S5-J-6 bench: one call=38ns -> sharing saves <=2 calls = 77ns
ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)
```

环境注记（R1-J 同款）：VM 系统 Node 为 22.14.0，低于 `engines >=22.19.0`；
本轮全部测试与门禁在 nvm 的 Node 22.22.2 下执行，全绿。

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S5-J-1 | preferences 授权导出 `listObservations()` 拷贝在 scopes 过滤时消除 | 拷贝本体 1.8–2.1µs、delta 4.1–5.9µs 被同路径 pretty stringify（~0.9ms）支配 ~157–226×；需新 store 访问器或模块边界变更（S3-J-6 同函数姊妹） |
| S5-J-2 | context codeMap 成本估算构串改闭式长度算术 | 逐位等价（500 fuzz）但 2.6–2.7µs/编译、每 run ≤6 编译 + 1 构建 ⇒ 上界 ~19µs/run；跨模块去重已是 R3-J 禁区（S1-J-6/S2-J-4/S4-J-6 同域） |
| S5-J-3 | privacy 删除级联 tombstones.json 读延迟到首个匹配后 | **非保行为**：损坏侧车 + 无匹配时 fail-closed 抛错变 fail-open 静默成功（反例实测）；合法收益仅无匹配路径 74.8–86.2µs，低于 ~190µs 否决线；删除数据面强调区（S2-J-7/S4-J-3 域收口完成） |
| S5-J-4 | cluster mailbox.enqueue role 分支冗余 `byRole.set` 消除 | 6.2–6.6ns/enqueue（整个 enqueue 29–30ns）；mailbox 数据面（S3-E-3 同型冗余 set） |
| S5-J-5 | context/index `resolveFromMap` 属性双读 CSE | 命中省 ~10ns/查、miss 约 1–2ns（V8 已近优）；每 run 一次性构建（40µs 全量）内几十次调用 |
| S5-J-6 | track startTrackedRun 跨 child 共享 acceptanceForRole default 分支结果 | 可观察身份改变：返回可变数组，共享后 child 间互为别名（push 穿透实测；S1-B-8/S4-B-3 同判据）；忠实深拷贝形式收益为负（重算本体 38–43ns，≤2 次/run） |

重开条件：S5-J-3 需先做出**错误面契约决策**（把"无匹配删除也必须校验
tombstones.json 完整性"显式降级为"仅写前校验"——属语义工作并需重写隐私
测试；若删除变为高频批量工具则与 S4-J-3 的重开条件合并评估）；S5-J-6 若
`acceptanceForRole` 返回类型改为深冻结（`readonly` + `Object.freeze`，属
公开面语义工作），别名共享的身份论证失效，可凭本报告值等价证据重开；
S5-J-1 若导出加入分页/流式（另立项）使 stringify 不再支配，可重开；
S5-J-2/4/5 为 ns~µs 级常数，无现实重开路径。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.mts` 后在仓库根目录 `npx tsx <file> <seed-hex>`
（依赖已装）。seeds：`0x55cc01`、`0x55cc02`（其余段确定性构造，无随机性）。

```ts
/**
 * R5-J deterministic equivalence + counterexample + benchmark simulation.
 * Adjudicates fresh fifth-pass candidates S5-J-1 .. S5-J-6 against the
 * current implementations in src/preferences(export) + src/context +
 * src/privacy + src/cluster(mailbox) + src/track(plan).
 * Seeded PRNG (mulberry32) -> reproducible. Run: npx tsx <file> <seed-hex>
 */
import { performance } from "node:perf_hooks";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportAuthorizedPreferences } from "/workspace/src/preferences/export.js";
import {
  recordObservation,
  resetPreferenceStore,
  listObservations
} from "/workspace/src/preferences/store.js";
import type { PreferenceObservation, PreferenceScope } from "/workspace/src/preferences/types.js";
import { buildProjectContextIndex, type CodeMapEntry } from "/workspace/src/context/index.js";
import { compileContextPacket } from "/workspace/src/context/packet.js";
import { cascadeFeedbackTombstones } from "/workspace/src/privacy/deletion.js";
import { feedbackLogPath, feedbackTombstonesPath } from "/workspace/src/feedback/store.js";
import { createMailbox, stampMail, type ClusterMail } from "/workspace/src/cluster/mailbox.js";
import { acceptanceForRole } from "/workspace/src/track/plan.js";
import { parseIsoTimestamp } from "/workspace/src/domain/timestamp.js";
import { createProjectId, createTaskId } from "/workspace/src/domain/ids.js";
import type { AgentInstanceId, EpisodeId } from "/workspace/src/domain/ids.js";
import type { ProjectSnapshot } from "/workspace/src/domain/project.js";
import type { RequirementContract } from "/workspace/src/domain/contract.js";

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
async function benchAsync(fn: () => Promise<void>, reps: number): Promise<number> {
  await fn();
  const t0 = performance.now();
  for (let i = 0; i < reps; i += 1) await fn();
  return (performance.now() - t0) / reps;
}

const SEED = Number.parseInt(process.argv[2] ?? "0x55cc01", 16) || 0x55cc01;
console.log(`seed=0x${SEED.toString(16)}`);
const NOW = parseIsoTimestamp("2026-08-24T05:00:00.000Z");
const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

/* ============================================================
 * S5-J-1: exportAuthorizedPreferences takes the listObservations()
 * defensive copy and, when a scopes filter is requested, immediately
 * discards that copy in favor of the filter result. Candidate: skip the
 * intermediate copy (requires an in-module accessor or a new store API).
 * Same-valued trivially; anchor the copy cost against the pretty
 * JSON.stringify the same export always performs (S3-J-6's dominator).
 * ============================================================ */
{
  const rng = mulberry32(SEED);
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

  // Production fidelity + copy-elided equivalence on the real store.
  resetPreferenceStore();
  for (let i = 0; i < 500; i += 1) recordObservation(mkObs(i));
  const stored = listObservations();
  for (let trial = 0; trial < 40; trial += 1) {
    const subset = scopes.filter(() => rng() < 0.5);
    if (subset.length === 0) continue;
    const exported = exportAuthorizedPreferences({ scopes: [...subset] });
    const parsed = JSON.parse(exported.data) as { observations: PreferenceObservation[] };
    // Copy-elided shape: filter the module array directly (modeled on the
    // already-copied snapshot; filter allocates the same fresh output).
    const elided = stored.filter((o) => subset.includes(o.scope));
    check(
      "S5-J-1 copy-elided equivalence",
      JSON.stringify(parsed.observations) === JSON.stringify(elided),
      `trial ${trial}`
    );
  }
  resetPreferenceStore();

  const big = Array.from({ length: 5000 }, (_, i) => mkObs(i));
  const wanted: PreferenceScope[] = ["user", "role"];
  const currentShape = bench(() => { [...big].filter((o) => wanted.includes(o.scope)); }, 2000);
  const elidedShape = bench(() => { big.filter((o) => wanted.includes(o.scope)); }, 2000);
  const copyOnly = bench(() => { void [...big]; }, 2000);
  const filtered = big.filter((o) => wanted.includes(o.scope));
  const stringify = bench(() => {
    JSON.stringify({ version: 1, exportedAt: NOW, count: filtered.length, observations: filtered }, null, 2);
  }, 100);
  console.log(
    `S5-J-1 bench N=5000: copy+filter=${(currentShape * 1e3).toFixed(1)}us direct-filter=${(elidedShape * 1e3).toFixed(1)}us delta=${((currentShape - elidedShape) * 1e3).toFixed(1)}us (spread copy alone=${(copyOnly * 1e3).toFixed(1)}us); same-path pretty JSON.stringify=${(stringify * 1e3).toFixed(0)}us dominates ~${Math.round(stringify / Math.max(currentShape - elidedShape, 1e-9))}x (one-shot authorized export)`
  );
}

/* ============================================================
 * S5-J-2: estimateCodeMapTokens (context/index.ts) and
 * estimateCodeMapEntry (context/packet.ts) build the compact string
 * `${path}:${symbol}(${kind})${public ? " public" : ""} calls=${calls.join(",")}`
 * only to take its .length. Candidate: compute the length arithmetically
 * (no string allocation). Bitwise-equal by construction of the formula;
 * fuzz-verify, then anchor per-compile cost at the realistic scale.
 * ============================================================ */
{
  const rng = mulberry32(SEED + 1);
  const KINDS = ["class", "function", "interface", "type", "method", "module"] as const;
  const viaString = (entry: CodeMapEntry): number => {
    const compact = `${entry.path}:${entry.symbol}(${entry.kind})${entry.public ? " public" : ""} calls=${entry.calls.join(",")}`;
    return Math.max(1, Math.ceil(compact.length / 4));
  };
  const viaArithmetic = (entry: CodeMapEntry): number => {
    let joinLen = 0;
    for (const call of entry.calls) joinLen += call.length;
    if (entry.calls.length > 1) joinLen += entry.calls.length - 1;
    const length =
      entry.path.length + entry.symbol.length + entry.kind.length + 3 +
      (entry.public ? 7 : 0) + 7 + joinLen;
    return Math.max(1, Math.ceil(length / 4));
  };
  for (let trial = 0; trial < 500; trial += 1) {
    const calls = Array.from({ length: Math.floor(rng() * 6) }, (_, i) => `callee${Math.floor(rng() * 30)}-${i}`);
    const entry: CodeMapEntry = {
      path: `src/mod${Math.floor(rng() * 9)}/file${Math.floor(rng() * 40)}.ts`,
      symbol: `sym${Math.floor(rng() * 100)}`,
      kind: KINDS[Math.floor(rng() * KINDS.length)]!,
      public: rng() < 0.5,
      calls
    };
    check("S5-J-2 equivalence", viaString(entry) === viaArithmetic(entry), `trial ${trial}`);
  }
  const entries: CodeMapEntry[] = Array.from({ length: 60 }, (_, i) => ({
    path: `src/mod${i % 7}/file${i}.ts`,
    symbol: `sym${i}`,
    kind: "function" as const,
    public: i % 3 === 0,
    calls: [`callee${i % 5}`]
  }));
  const strCost = bench(() => { for (const entry of entries) viaString(entry); }, 20000);
  const ariCost = bench(() => { for (const entry of entries) viaArithmetic(entry); }, 20000);
  // Whole-compile anchor with a realistic index carrying that code map.
  const snapshot = {
    id: createProjectId(UUID),
    rootPath: "/repo",
    discoveredAt: NOW,
    instructionFiles: Array.from({ length: 6 }, (_, i) => ({ path: `/repo/dir${i}/AGENTS.md` })),
    manifests: Array.from({ length: 12 }, (_, i) => ({ path: i === 10 ? "/repo/package.json" : `/repo/pkg${i}/manifest.yaml` })),
    commands: Array.from({ length: 8 }, (_, i) => ({ name: `cmd${i}`, command: `run cmd${i}` })),
    facts: Array.from({ length: 20 }, (_, i) => ({ key: i % 2 ? `architecture.a${i}` : `risk.r${i}`, value: `v${i}`, confidence: "HIGH" as const }))
  } as unknown as ProjectSnapshot;
  const index = {
    ...buildProjectContextIndex(snapshot),
    codeMap: { schemaVersion: 1 as const, tokenBudget: 2000, estimatedTokens: 900, entries, omissions: [] }
  };
  const contract: RequirementContract = {
    schemaVersion: 1,
    objective: "demo objective",
    deliverables: [],
    constraints: [{ id: "c1", description: "keep the API stable" }] as never,
    nonGoals: [],
    acceptanceCriteria: [],
    assumptions: [],
    questions: [],
    authority: [],
    sourceRefs: []
  };
  const whole = bench(() => {
    compileContextPacket({ taskId: createTaskId(UUID), contract, index, tokenBudget: 2000, selectorVersion: 1 });
  }, 3000);
  console.log(
    `S5-J-2 bench E=60: string-build estimates=${(strCost * 1e3).toFixed(2)}us arithmetic=${(ariCost * 1e3).toFixed(2)}us delta=${((strCost - ariCost) * 1e3).toFixed(2)}us/compile; whole compileContextPacket=${(whole * 1e3).toFixed(1)}us (<=6 compiles + 1 build per run)`
  );
}

/* ============================================================
 * S5-J-3: cascadeFeedbackTombstones reads tombstones.json BEFORE scanning
 * the records for episode matches; on the no-match path that read is
 * "wasted". Candidate: defer the tombstones read until a match is found.
 * COUNTEREXAMPLE: with a malformed tombstones.json and no matching
 * records, the current shape surfaces the corruption (readFeedbackTombstoneIds
 * throws); the deferred shape silently returns [] -> a fail-closed
 * corruption signal on the privacy plane becomes fail-open.
 * ============================================================ */
{
  const mkState = (): string => mkdtempSync(join(tmpdir(), "r5j-casc-"));
  const writeRecords = (stateRoot: string, episodeIds: readonly string[]): void => {
    const path = feedbackLogPath(stateRoot);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(
      path,
      episodeIds
        .map((ep, i) =>
          JSON.stringify({
            id: `fb-${i}`,
            episodeId: ep,
            kind: "human",
            rubricVersion: "r1",
            score: 80,
            evidenceRefs: [],
            redacted: false,
            createdAt: NOW,
            body: `body text ${i}`
          })
        )
        .join("\n") + "\n"
    );
  };
  // Deferred-read candidate (verbatim reshape of the current cascade).
  const { readFeedbackRecordsRaw, readFeedbackTombstoneIds, writeFeedbackRecords } = await import(
    "/workspace/src/feedback/store.js"
  );
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const deferredCascade = async (stateRoot: string, episodeId: string): Promise<string[]> => {
    const records = await readFeedbackRecordsRaw(stateRoot).catch(() => []);
    if (records.length === 0) return [];
    const cascaded: string[] = [];
    const updated = records.map((record) => {
      if (record.episodeId !== episodeId) return record;
      cascaded.push(record.id);
      return record.body === undefined ? record : { ...record, body: undefined };
    });
    if (cascaded.length === 0) return [];
    const tombstones = await readFeedbackTombstoneIds(stateRoot); // deferred
    for (const id of cascaded) tombstones.add(id);
    await writeFeedbackRecords(stateRoot, updated);
    const tombstonePath = feedbackTombstonesPath(stateRoot);
    await mkdir(dirname(tombstonePath), { recursive: true });
    await writeFile(tombstonePath, `${JSON.stringify([...tombstones].sort(), null, 2)}\n`, "utf8");
    return cascaded.sort();
  };

  // Counterexample: malformed tombstones.json + zero matching records.
  {
    const stateRoot = mkState();
    writeRecords(stateRoot, ["ep_other1", "ep_other2"]);
    mkdirSync(join(feedbackTombstonesPath(stateRoot), ".."), { recursive: true });
    writeFileSync(feedbackTombstonesPath(stateRoot), `{"not":"an array"}`);
    let currentThrew = "";
    try {
      await cascadeFeedbackTombstones(stateRoot, "ep_target" as EpisodeId);
    } catch (error) {
      currentThrew = (error as Error).message;
    }
    let deferredThrew = "";
    let deferredResult: string[] | undefined;
    try {
      deferredResult = await deferredCascade(stateRoot, "ep_target");
    } catch (error) {
      deferredThrew = (error as Error).message;
    }
    console.log(
      `S5-J-3 counterexample (malformed tombstones.json, no matches): current throws "${currentThrew}"; deferred returns ${JSON.stringify(deferredResult)} (threw: "${deferredThrew}")`
    );
    check(
      "S5-J-3 divergence demonstrated (deferred read is fail-open on corrupt privacy sidecar)",
      currentThrew !== "" && deferredThrew === "" && deferredResult !== undefined && deferredResult.length === 0
    );
    rmSync(stateRoot, { recursive: true, force: true });
  }

  // Healthy-path equivalence: match and no-match, results + resulting files.
  for (const scenario of ["match", "no-match"] as const) {
    const eps = scenario === "match" ? ["ep_target", "ep_other", "ep_target"] : ["ep_other1", "ep_other2"];
    const rootA = mkState();
    writeRecords(rootA, eps);
    writeFileSync(feedbackTombstonesPath(rootA), JSON.stringify(["fb-pre"]));
    const rootB = mkState();
    writeRecords(rootB, eps);
    writeFileSync(feedbackTombstonesPath(rootB), JSON.stringify(["fb-pre"]));
    const a = await cascadeFeedbackTombstones(rootA, "ep_target" as EpisodeId);
    const b = await deferredCascade(rootB, "ep_target");
    check(`S5-J-3 equivalence (${scenario}: cascaded ids)`, JSON.stringify(a) === JSON.stringify(b));
    const fileEq = (rel: (root: string) => string): boolean => {
      const fa = existsSync(rel(rootA)) ? readFileSync(rel(rootA), "utf8") : "<absent>";
      const fb = existsSync(rel(rootB)) ? readFileSync(rel(rootB), "utf8") : "<absent>";
      return fa === fb;
    };
    check(`S5-J-3 equivalence (${scenario}: records.jsonl bytes)`, fileEq(feedbackLogPath));
    check(`S5-J-3 equivalence (${scenario}: tombstones.json bytes)`, fileEq(feedbackTombstonesPath));
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  }

  // Bench the no-match path (the only path the deferral can win on).
  const stateRoot = mkState();
  writeRecords(stateRoot, Array.from({ length: 200 }, (_, i) => `ep_other${i % 20}`));
  writeFileSync(feedbackTombstonesPath(stateRoot), JSON.stringify(["fb-pre"]));
  const curNoMatch = await benchAsync(async () => {
    await cascadeFeedbackTombstones(stateRoot, "ep_target" as EpisodeId);
  }, 300);
  const defNoMatch = await benchAsync(async () => {
    await deferredCascade(stateRoot, "ep_target");
  }, 300);
  console.log(
    `S5-J-3 bench no-match N=200: current(2 reads)=${(curNoMatch * 1e3).toFixed(1)}us deferred(1 read)=${(defNoMatch * 1e3).toFixed(1)}us saving=${((curNoMatch - defNoMatch) * 1e3).toFixed(1)}us/no-match delete (match path saves nothing; deletion data plane)`
  );
  rmSync(stateRoot, { recursive: true, force: true });
}

/* ============================================================
 * S5-J-4: mailbox.enqueue's role-cast branch re-sets the byRole entry
 * (`byRole.set(role, list)`) even when byRole.get returned an existing
 * list that was mutated in place. Candidate: set only on first creation.
 * Same-valued; fuzz all observable mailbox surfaces, then anchor one
 * redundant Map.set against the whole enqueue.
 * ============================================================ */
{
  const rng = mulberry32(SEED + 2);
  const mkMail = (i: number, opts: { to?: string; role?: string; from?: string }): ClusterMail =>
    stampMail({
      id: `m${i}` as ClusterMail["id"],
      from: (opts.from ?? `agent-s${i % 3}`) as AgentInstanceId,
      body: `mail body ${i}`,
      ...(opts.to !== undefined ? { to: opts.to as AgentInstanceId } : {}),
      ...(opts.role !== undefined ? { addressRole: opts.role as ClusterMail["addressRole"] } : {}),
      occurredAt: NOW
    });
  // Conditional-set variant (verbatim reshape of createMailbox.enqueue).
  const mkVariantBox = () => {
    const byAgent = new Map<string, ClusterMail[]>();
    const byRole = new Map<string, ClusterMail[]>();
    const box = (agentId: string): ClusterMail[] => {
      let list = byAgent.get(agentId);
      if (list === undefined) {
        list = [];
        byAgent.set(agentId, list);
      }
      return list;
    };
    return {
      enqueue(mail: ClusterMail) {
        if (mail.to !== undefined) {
          box(mail.to).push(mail);
          return;
        }
        if (mail.addressRole !== undefined) {
          const existing = byRole.get(mail.addressRole);
          if (existing === undefined) {
            byRole.set(mail.addressRole, [mail]);
          } else {
            existing.push(mail); // no redundant re-set
          }
          return;
        }
        throw new Error("cluster mail requires to or addressRole");
      },
      inbox: (agentId: string) => [...(byAgent.get(agentId) ?? [])],
      pendingForRole: (role: string) => [...(byRole.get(role) ?? [])],
      claimRole(role: string, agentId: string) {
        const pending = byRole.get(role) ?? [];
        byRole.set(role, []);
        const delivered: ClusterMail[] = [];
        for (const mail of pending) {
          if (mail.from === agentId) {
            const remaining = byRole.get(role) ?? [];
            remaining.push(mail);
            byRole.set(role, remaining);
            continue;
          }
          const copy = { ...mail, to: agentId as AgentInstanceId };
          box(agentId).push(copy);
          delivered.push(copy);
        }
        return delivered;
      }
    };
  };
  for (let trial = 0; trial < 300; trial += 1) {
    const production = createMailbox();
    const variant = mkVariantBox();
    const n = 1 + Math.floor(rng() * 20);
    for (let i = 0; i < n; i += 1) {
      const kind = rng();
      const mail =
        kind < 0.4
          ? mkMail(i, { to: `agent-t${Math.floor(rng() * 3)}` })
          : mkMail(i, { role: rng() < 0.5 ? "tester" : "reviewer", from: rng() < 0.2 ? "agent-claimer" : undefined });
      production.enqueue(mail);
      variant.enqueue(mail);
    }
    const claimedP = production.claimRole("tester", "agent-claimer" as AgentInstanceId);
    const claimedV = variant.claimRole("tester", "agent-claimer");
    check(
      "S5-J-4 equivalence (claim + inbox + pending)",
      JSON.stringify(claimedP) === JSON.stringify(claimedV) &&
        JSON.stringify(production.inbox("agent-claimer" as AgentInstanceId)) === JSON.stringify(variant.inbox("agent-claimer")) &&
        JSON.stringify(production.pendingForRole("tester")) === JSON.stringify(variant.pendingForRole("tester")) &&
        JSON.stringify(production.pendingForRole("reviewer")) === JSON.stringify(variant.pendingForRole("reviewer")),
      `trial ${trial}`
    );
  }
  const production = createMailbox();
  const roleMail = mkMail(0, { role: "tester" });
  const enqueueCost = bench(() => { production.enqueue(roleMail); }, 100000);
  const map = new Map([["tester", [] as ClusterMail[]]]);
  const list = map.get("tester")!;
  const setCost = bench(() => { map.set("tester", list); }, 1000000);
  console.log(
    `S5-J-4 bench: whole role-cast enqueue=${(enqueueCost * 1e6).toFixed(0)}ns; one redundant Map.set=${(setCost * 1e6).toFixed(1)}ns (mailbox data plane)`
  );
}

/* ============================================================
 * S5-J-5: context/index.ts resolveFromMap reads each Record property
 * twice (`map[k] !== undefined` guard, then `return map[k]`). Candidate:
 * CSE each probe into a local. Same-valued (pure record reads); fuzz all
 * hit positions, then anchor per-build cost.
 * ============================================================ */
{
  const rng = mulberry32(SEED + 3);
  // Verbatim private helper from src/context/index.ts.
  const current = (
    map: Readonly<Record<string, string>> | undefined,
    sourceKey: string,
    alternateKey?: string,
    factKey?: string
  ): string | undefined => {
    if (map === undefined) return undefined;
    if (map[sourceKey] !== undefined) return map[sourceKey];
    if (alternateKey !== undefined && map[alternateKey] !== undefined) return map[alternateKey];
    if (factKey !== undefined && map[factKey] !== undefined) return map[factKey];
    return undefined;
  };
  const cse = (
    map: Readonly<Record<string, string>> | undefined,
    sourceKey: string,
    alternateKey?: string,
    factKey?: string
  ): string | undefined => {
    if (map === undefined) return undefined;
    const bySource = map[sourceKey];
    if (bySource !== undefined) return bySource;
    if (alternateKey !== undefined) {
      const byAlternate = map[alternateKey];
      if (byAlternate !== undefined) return byAlternate;
    }
    if (factKey !== undefined) {
      const byFact = map[factKey];
      if (byFact !== undefined) return byFact;
    }
    return undefined;
  };
  const keys = ["a", "b", "c", "d", "e", "f"];
  for (let trial = 0; trial < 600; trial += 1) {
    const map: Record<string, string> | undefined =
      rng() < 0.1
        ? undefined
        : Object.fromEntries(keys.filter(() => rng() < 0.5).map((k) => [k, `v-${k}-${Math.floor(rng() * 5)}`]));
    const pick = (): string | undefined => (rng() < 0.3 ? undefined : keys[Math.floor(rng() * keys.length)]);
    const sourceKey = keys[Math.floor(rng() * keys.length)]!;
    const alternateKey = pick();
    const factKey = pick();
    check(
      "S5-J-5 equivalence",
      Object.is(current(map, sourceKey, alternateKey, factKey), cse(map, sourceKey, alternateKey, factKey)),
      `trial ${trial}`
    );
  }
  const hashes: Record<string, string> = Object.fromEntries(
    Array.from({ length: 30 }, (_, i) => [`/repo/pkg${i}/manifest.yaml`, `hash${i}`])
  );
  const missMap: Record<string, string> = { unrelated: "x" };
  const curHit = bench(() => { current(hashes, "/repo/pkg7/manifest.yaml", "pkg7/manifest.yaml", "manifest:pkg7"); }, 500000);
  const cseHit = bench(() => { cse(hashes, "/repo/pkg7/manifest.yaml", "pkg7/manifest.yaml", "manifest:pkg7"); }, 500000);
  const curMiss = bench(() => { current(missMap, "/repo/pkgX/manifest.yaml", "pkgX/manifest.yaml", "manifest:pkgX"); }, 500000);
  const cseMiss = bench(() => { cse(missMap, "/repo/pkgX/manifest.yaml", "pkgX/manifest.yaml", "manifest:pkgX"); }, 500000);
  const snapshot = {
    id: createProjectId(UUID),
    rootPath: "/repo",
    discoveredAt: NOW,
    instructionFiles: Array.from({ length: 6 }, (_, i) => ({ path: `/repo/dir${i}/AGENTS.md` })),
    manifests: Array.from({ length: 12 }, (_, i) => ({ path: i === 10 ? "/repo/package.json" : `/repo/pkg${i}/manifest.yaml` })),
    commands: Array.from({ length: 8 }, (_, i) => ({ name: `cmd${i}`, command: `run cmd${i}` })),
    facts: Array.from({ length: 20 }, (_, i) => ({ key: i % 2 ? `architecture.a${i}` : `risk.r${i}`, value: `v${i}`, confidence: "HIGH" as const }))
  } as unknown as ProjectSnapshot;
  const whole = bench(() => {
    buildProjectContextIndex(snapshot, { sourceHashes: hashes, priorHashes: hashes });
  }, 2000);
  console.log(
    `S5-J-5 bench: hit current=${(curHit * 1e6).toFixed(1)}ns cse=${(cseHit * 1e6).toFixed(1)}ns; miss current=${(curMiss * 1e6).toFixed(1)}ns cse=${(cseMiss * 1e6).toFixed(1)}ns; whole buildProjectContextIndex(with hash maps)=${(whole * 1e3).toFixed(1)}us (one-shot per run)`
  );
}

/* ============================================================
 * S5-J-6: startTrackedRun's children map calls acceptanceForRole once per
 * child; planner/implementer/reviewer all take the default branch and
 * recompute the same filter+map over contract.acceptanceCriteria.
 * Candidate: compute the default-branch result once and share it.
 * COUNTEREXAMPLE (identity): today each child owns an independent array
 * (and independent criterion objects); sharing aliases them, so a
 * mutation through one child becomes visible through another
 * (S1-B-8 / S4-B-3 identity class). Anchor the recompute cost.
 * ============================================================ */
{
  const contract: RequirementContract = {
    schemaVersion: 1,
    objective: "add tests for the retry helper",
    deliverables: [],
    constraints: [],
    nonGoals: [],
    acceptanceCriteria: [
      { id: "ac-1", description: "retry helper handles 3 failures" },
      { id: "ac-2", description: "backoff is exponential" },
      { id: "ac-tests", description: "unit tests pass" },
      { id: "ac-3", description: "no public API change" }
    ] as never,
    assumptions: [],
    questions: [],
    authority: [],
    sourceRefs: []
  };
  const planner = acceptanceForRole("planner", contract);
  const implementer = acceptanceForRole("implementer", contract);
  const reviewer = acceptanceForRole("reviewer", contract);
  check(
    "S5-J-6 premise: default-branch roles compute equal values",
    JSON.stringify(planner) === JSON.stringify(implementer) && JSON.stringify(implementer) === JSON.stringify(reviewer)
  );
  check(
    "S5-J-6 current shape: each child owns an independent array + objects",
    planner !== implementer && implementer !== reviewer && planner[0] !== implementer[0]
  );
  // Sharing demo: one shared array aliases mutations across children.
  const shared = acceptanceForRole("planner", contract);
  const childA = { acceptanceCriteria: shared };
  const childB = { acceptanceCriteria: shared };
  childA.acceptanceCriteria.push({ id: "ac-injected", description: "injected via child A" });
  check(
    "S5-J-6 divergence demonstrated (shared result aliases mutations across children)",
    childB.acceptanceCriteria.some((criterion) => criterion.id === "ac-injected")
  );
  const oneCall = bench(() => { acceptanceForRole("implementer", contract); }, 200000);
  console.log(
    `S5-J-6 bench: one default-branch acceptanceForRole=${(oneCall * 1e6).toFixed(0)}ns -> sharing saves <=2 calls/run = ${(2 * oneCall * 1e6).toFixed(0)}ns (identity change; one-shot per tracked run)`
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)");
```

MORE_OPTIMA=no
BRANCH=cursor/r5-j-persist-fifth-pass-83a1
