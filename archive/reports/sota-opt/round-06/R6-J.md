MODEL_SLUG=claude-fable-5-thinking-xhigh

# R6-J：数据面切片（cluster / privacy / preferences / episode / persist / track / context / feedback）第六遍复查报告

**战役:** 全库持久 SOTA 优化 Round 6 / R6-J
**基线:** `cursor/sota-persistent-opt-83a1` @ `c26e6e6`
**分支:** `cursor/r6-j-persist-sixth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 切片 29 个文件（`src/cluster/` 3、
`src/privacy/` 3、`src/preferences/` 7、`src/episode/` 5、`src/persist/` 2、
`src/track/` 4、`src/context/` 2、`src/feedback/` 3，共 3655 行）自 R1-J 落地
J1（`fb41417`）以来**逐字节未变**（本轮核对 `git diff fb41417..c26e6e6 --
<切片>` 为空；自 `7acb666` 起全切片 diff 仍仅含 `loop-eval.ts` 一个文件；
S5-I-1 / S6-C / S6-F-1 均落在切片外），R1-J 的逐文件收口、S1-J-1..7、
S2-J-1..11、S3-J-1..6、S4-J-1..6、S5-J-1..6 共三十六条排除全部继承有效。
本轮在完整排除表（含 R6 已产出的 S6-A/B/C/D/E/F/H-* 与已落地的 S6-C、
S6-F-1）之上第六次全量实际读码、以新角度枚举，得到 6 个此前未点名的新候选
（S6-J-1 … S6-J-6），全部经理论 + 确定性仿真（seeded mulberry32，等价 fuzz /
**单故障落盘态反例** / **read-your-writes 屏障反例** / **身份别名化演示** /
真实规模基准，seeds `0x66dd01`/`0x66dd02` 两次独立运行等价与发散结论逐位
一致、计时抖动范围内稳定）裁决后淘汰：**2 个被反例证明非保行为**（S6-J-1
的级联尾部双写并行化使今日不可达的"墓碑已更新而 body 未剥除"落盘态变为
可达——删除数据面的崩溃序契约被拓宽，且双故障浮出错误变竞态；S6-J-4 的
事件追加攒批被同函数内 settle 点 readAll 的 read-your-writes 屏障实测击穿，
5 事件 vs 0 事件发散），**1 个是身份可观察改变**（S6-J-5 reducer 无拒绝
快路径使返回数组别名输入，S1-B-8/S4-B-3 同判据，可省拷贝仅 19–20ns），
**1 个在现实规模稳定负优化**（S6-J-3 在 F=40 档两 seed 均慢 421–688ns），
其余 2 个中 S6-J-6 是 12–14ns 的一次性构建噪声；**本轮唯一的合法两位数
百分比 CPU 候选 S6-J-2**（loop-eval 嵌套 Map 键控，N=6000 极端夹具快
495–760µs ≈ 折叠总时长的 14–21%）挂在**无生产调用方**的 API 上（本轮
re-grep 确认仅测试与度量脚本引用，S2-J-1 同判据），真实测试规模 N≤6 时
收益为亚 µs，且 0.5–0.76ms 即便按极端夹具计也低于数十 ms 落地线 1–2 个
量级。未重开任何 X* / S1-* / S2-* / S3-* / S4-* / S5-* / S6-* 条目。
J1 落地代码本轮 `scripts/r1j-equivalence-sim.ts` 重跑全绿（2468 项逐位
检查，2830.7×）。数据面（删除/脱敏/状态布局、mailbox、episode 闭合、
jsonl 锁语义）**零 diff**，可见行为天然不变。J1 之上本切片在其数据面
契约下经六遍穷尽复查仍为 SOTA。

## 0. 范围与约束遵守

- 切片：`src/cluster/`、`src/privacy/`、`src/preferences/`、`src/episode/`、
  `src/persist/`、`src/track/`、`src/context/`、`src/feedback/`。29 个文件
  本轮全部第六次实际读码，未依赖 R1-J..R5-J 的记忆。
- 先读并遵守（顺序强制）：README → EXCLUSIONS.md（含 S6-C/S6-F-1 已落地与
  全部 S6-A..H 新排除）→ round-06/PLAN.md → round-01/R1-J.md →
  round-02/R2-J.md → round-03/R3-J.md → round-04/R4-J.md → round-05/R5-J.md。
- 未编辑 `src/cli/main.ts`（I 区；S5-I-1 的点用处 `track/loop.js` 导入零碰）；
  未编辑任何其他生产文件；未编辑 EXCLUSIONS.md / PROGRESS.md（父代理所有）。
- 排除表遵守：候选枚举刻意绕开全部既有排除——S1-J-1..7、S2-J-1..11、
  S3-J-1..6、S4-J-1..6、S5-J-1..6 共三十六条全部不再提案。特别地：**J1
  落地代码未回退未重做**（`loop-eval.ts` 与 `fb41417` 逐字节一致，本轮
  `git diff` 核对，且 `scripts/r1j-equivalence-sim.ts` 重跑全绿）；
  **S2-J-7/S4-J-3/S5-J-3 遵守**（级联的探测/删除/读时机三面维持，本轮
  S6-J-1 只裁其尾部**写序**这一最后未点名角度）；**S2-J-1/S2-J-2 遵守**
  （`tombstones.has` 调用模式与 createdAt 字典序比较器零碰——S6-J-2 的
  嵌套 Map 变体在仿真中逐字保留两次 has 调用与字符串排序）；**S1-J-1/
  S3-J-5 遵守**（`rebuildViews` 与 `lastUpdated` 可观察面零碰）；
  **S3-J-1 遵守**（`stripForbidden` 顺序剥除语义零碰）；**S4-J-1 遵守**
  （spawn 死分支保留）；**S5-J-6 遵守**（`acceptanceForRole` 每 child
  独立所有权零碰）；X1-1、X0-5、X4-2 直接跳过。本轮只探索**未被点名的
  新角度**：级联尾部双写编排（S6-J-1）、J1 折叠的主体键控形态（S6-J-2）、
  collapseFacts 的组重查（S6-J-3）、等待路径事件追加攒批（S6-J-4）、
  reducer 输出身份（S6-J-5）、index 构建第三处冗余拷贝（S6-J-6）。
- **数据面强调区零 diff**：`privacy/deletion.ts` 的全量读→map→全量重写
  级联（S6-J-1 仅在仿真中建模并被反例否决，生产删除路径一行未改）、
  `persist/file-lock.ts` 的 wx/ownerToken/重试语义、`persist/jsonl.ts` 的
  截尾恢复、`cluster/mailbox.ts` 的 role 队列 claim 语义、
  `episode/manager.ts` 的 fail-closed reducer——可见行为天然不变。
- 规格强制双路（Beta LCB vs 正态 LCB；offline-logit vs 概率可加）不在本区。
  分析不改 in-flight；Tracking 无命令权。不声称 Outcome-supported；
  Checkpoint F-PROD 仍开放（ADR-005）。不改阈值、权限、数据面契约、公开
  签名；未改任何测试。
- 继承脚本 lint 本轮基线**全绿**（`eslint .` 零输出），无需对旧仿真脚本做
  console.* 机械替换。
- 仓库变更仅本报告一个文件。无赢家，未落仿真脚本（完整源码见附录）。

## 1. 规模与门槛基底（第六遍继承 + 本轮校准）

R1-J..R5-J 已实测本切片规模：episode 内 run 数、cluster peer 数
（≤ maxTasks=16）、track 子任务数（C≤~6）、context 构建输入（十位级）、
redaction needles（=4）全部为小常数；**唯一无上界增长维度是 preference
观察数 N 与 feedback 记录数 N**，两者的插入/读取路径均被同路径的全量 JSON
序列化 + 磁盘 I/O 支配（R2-J 实测 ~50×、R5-J 实测 ~157–226×），度量路径
已被 J1 收口为 Θ(N log N) 且无生产调用方（本轮 re-grep 再证：全仓引用仅
`test/unit/preferences/loop-eval.test.ts` 与 `scripts/r1j-equivalence-sim.ts`）。
代码逐字节未变，全部继承。

战役落地线继承：已落地项在数十 ms 级或复杂度类下降（J1 2770×、S1-C
~450ms/fit、S3-C ~140–155ms、S6-C/S6-F-1 均为两位数 ms 级），µs 级候选
一律被否决过（S1-I-1 ~190µs、S3-D-3 351–388µs、S4-J-3 60–62µs、S5-J-3
74.8–86.2µs）。本轮 I/O 地板复核（PLAN 要求）结论：R4-J 四面收口
（S2-J-10/S2-J-11/S4-J-2/S4-J-3）之外，切片内**仅剩一对**未点名的串行
await——级联尾部的 records 重写与 tombstones 写（S6-J-1，重叠收益
199.5–308.1µs），且它被单故障落盘态反例证明非保行为。本轮全部合法候选的
绝对收益上界是 **495–760µs**（S6-J-2，N=6000 极端夹具、无生产调用方 API）；
真实调用规模下全部候选是 ns~µs 级。没有候选接近数十 ms 落地线；复杂度类
层面，六遍扫描后切片内已无任何随无上界维度超线性的路径。据此裁决。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S6-J-1 | `privacy/deletion.ts` `cascadeFeedbackTombstones` 尾部两写（`writeFeedbackRecords` 重写 records.jsonl → mkdir+writeFile tombstones.json）串行，候选 Promise.all 并行 | 重叠两次小文件写；级联中最后一对未点名的串行 await | ✅ 健康路径（match/no-match）production vs 顺序控制组 vs 并行候选：返回 ids 与两文件落盘字节逐位一致；❌ **单故障反例**：records 写故障（延迟 20ms 注入，确定性）时顺序形态 tombstones.json 分毫未动，并行形态已把新墓碑落盘而 body 仍在磁盘——今日**不可达**的"墓碑已更新而未剥除"状态变为可达；❌ 双故障浮出错误随 settle 次序翻转（实测 [tombstones fault, records fault]），顺序形态确定性先抛 records 错误 | 命中路径 N=400：seq=1062.9–1164.6µs par=856.5–863.4µs → 重叠收益 **199.5–308.1µs/删除**；一次性隐私删除工具路径，无重复调用放大 | 淘汰：**非保行为**（删除数据面的崩溃序契约被拓宽——strip-before-tombstone 不变量丢失，S5-J-3 的错误面姊妹在写侧的版本）+ 双故障竞态（S4-J-2/S4-J-3 同判据）+ 低于数十 ms 落地线，三重淘汰。至此级联的全部四个可想角度（探测 S2-J-7、文件删除 S4-J-3、读时机 S5-J-3、写序 S6-J-1）收口：**级联的完整 I/O 序本身就是契约** |
| S6-J-2 | `preferences/loop-eval.ts` 每观察构建 `${scope}\0${scopeKey}\0${key}` 字符串键（bySubject + lastFlippedAway 两处），候选换嵌套 Map<scope,Map<scopeKey,Map<key,slot>>> 键控、flip 原点并入叶 slot | 免每观察 1 次三段字符串拼接与 2 次字符串哈希查找 | ✅ 400 trial fuzz（含 -0/NaN/false 值池、~25% 墓碑、重复 id/引用）：production vs 字符串键控制组 vs 嵌套 Map 变体三方 `Object.is` 逐位一致（两 seed 同判；键从不可观察） | N=6000 极端夹具：production=3.488–3.659ms、控制组=3.351–3.662ms、嵌套 Map=2.856–2.902ms → **快 495.4–760.0µs（折叠总时长的 ~14–21%）**；但该 API **无生产调用方**（本轮 re-grep：仅单测与 r1j 仿真脚本），真实测试规模 N≤6 时收益亚 µs | 淘汰：无生产调用方（S2-J-1 同判据——那轮 ~115–172µs 被否，本轮数字更大但性质相同）+ 即便按极端夹具计 0.5–0.76ms 也低于数十 ms 落地线 1–2 个量级 + 重构 J1 已落地折叠的键控形态属风险换纸面收益 |
| S6-J-3 | `context/packet.ts` `collapseFacts` 的 `[...groups.keys()].sort()` + 循环内 `groups.get(key)` 重查（含 undefined 守卫），候选改 `[...groups.entries()].sort()` 直接迭代 | 免 K 次 Map.get 与守卫 | ✅ 400 trial fuzz（随机 key/value/trust/sourceHash/freshness，含重复组）verbatim 控制组 vs 变体输出 JSON 逐位一致（两 seed 同判） | 现实 F=40 档：current=5783–6254ns vs variant=6204–6942ns → **变体稳定慢 421–688ns（两 seed 同向）**；压力 F=400 档变体仅快 1.0–1.6µs；整个 `compileContextPacket`=31.6–36.0µs、每 run ≤6 次编译 | 淘汰：现实规模**负优化**（entries 装饰对小 K 比 K 次 Map.get 更贵——S1-F-5/X3-2 同类的实测反转）；压力档 µs 级仍低于否决线 |
| S6-J-4 | `track/loop.ts` `waitForClarification` 五次顺序事件追加（PROJECT_DISCOVERED→RUN_CREATED→episode-bind→RUN_STARTED→RUN_WAITING_FOR_USER）攒批合并落盘 | 五次 appendFile 合一 | ❌ **read-your-writes 屏障反例**：同函数 :261 以 `(await eventStore.readAll()).events` 喂 `settleBoundEpisode`——推迟冲刷则 settle 点实测读到 **0** 事件（现形态 **5**），settle 输入发散；:266 第二个 readAll 同理。攒批窗口只能整体位于首个 readAll 之前 | 五次追加=220.4–222.9µs vs 一次攒批=41.8–45.4µs → 有界收益 **175.0–181.1µs**、一次性等待路径 | 淘汰：**S5-G-5 同型镜像**（逐消息持久性 + 跨进程实时可见性被丢弃——任意崩溃前缀合法的性质变为组内 all-or-nothing）+ 屏障使收益上界只剩屏障前段 + 低于 ~190µs 否决线 |
| S6-J-5 | `episode/manager.ts` `reduceEpisodeEvents` 全接受时仍重建 `out` 数组，候选无拒绝快路径直接返回输入数组别名 | 免 O(E) 引用拷贝 | ✅ 干净流（open+2×attach+waiting+closed）值等价（`state.events` 逐元素 === 输入元素）；❌ **身份发散**：production `state.events !== events`（每次新数组），别名快路径使其 ===——调用方可观察（S1-B-8/S4-B-3/S3-F-5 同判据） | E=5：整个 reducer=452–459ns；可省引用拷贝循环仅 **19–20ns**；单 episode 事件数个位（S1-J-3 域规模） | 淘汰：可观察身份改变 + 亚噪声 + episode 闭合数据面强调区，三重淘汰 |
| S6-J-6 | `context/index.ts` `generatedHints = [...generatedPaths].sort(...)` 对 `uniquePreserve` 新产数组的再拷贝消除（就地 sort；后续 `dirtyUnrelated` 过滤的 `.some` 对 generatedPaths 顺序无关） | 免一次 O(G) 数组拷贝 | ✅ 400 trial fuzz（随机分隔符/尾斜杠/深度路径）generatedHints+dirtyUnrelated 双输出逐位一致 + production `buildProjectContextIndex` fidelity 抽查通过 | G=8 档可省 spread 拷贝=**12–14ns**；整个 hints+unrelated 派生=92.7–147.6µs、每 run 一次性构建 | 淘汰：S4-J-6 的**同函数第三站点**（spread-before-map、slice-after-filter 之后的 spread-before-sort），同一 ns 级规模论证；且消除依赖"无别名 + some 顺序无关"双重论证负担（S4-J-6 的 slice 消除同款负性价比） |

## 3. 关键裁决细节

### S6-J-1：级联尾部的"串行双写"不是低效编排，是崩溃序不变量（本轮最重要发现）

`cascadeFeedbackTombstones` 的尾部写序是：records.jsonl 全量重写（body 剥除
落盘）**完成后**才开始写 tombstones.json。这保证一条不变量：**磁盘上
"墓碑列出某 id"蕴含"该 id 的 body 已被剥除或从未存在"**（写侧；读侧另有
双层过滤兜底）。Promise.all 并行化在健康路径字节等价，但注入 records 写
故障（20ms 延迟拒绝，确定性早于 settle）后：顺序形态 tombstones.json 分毫
未动（操作者重跑幂等级联即可），并行形态已把新墓碑落盘而 body 仍留在
records.jsonl——不变量被打破，且这个状态在今日实现下**不可达**。隐私删除
工具的崩溃状态空间被拓宽即行为回归（R5-J 对 S5-J-3 的判据是"读序是损坏
检测点"，本轮写侧对偶：**写序是剥除先行保证**）。叠加双故障浮出错误变
settle 次序竞态（实测翻转）与 199.5–308.1µs 的一次性收益（低于数十 ms
落地线两个量级），三重淘汰。至此级联函数的探测（S2-J-7）、文件删除
（S4-J-3）、读时机（S5-J-3）、写序（S6-J-1）四面全部收口。

### S6-J-2：本切片唯一"合法且两位数百分比"的 CPU 候选为何仍不落地

嵌套 Map 键控是六遍读码以来 J1 折叠上第一个实测**方向稳定**的加速
（两 seed 495–760µs @ N=6000，消除每观察的三段拼接与两次字符串哈希）。
不落地的三条独立理由：(i) `evaluatePreferenceLoop` **无生产调用方**——
本轮 re-grep 确认全仓引用仅单测（N≤6）与 r1j 仿真脚本，与 S2-J-1 被否时
的调用面完全一致；真实规模下收益是亚 µs 事件。(ii) 即便按 N=6000 极端
夹具计，0.5–0.76ms 也低于战役数十 ms 落地线 1–2 个量级（S3-D-3 的
351–388µs、S5-J-3 的 74.8–86.2µs 都被否决过）。(iii) J1 是已落地并被
2468 项逐位检查钉死的参考实现，重构其键控形态用真实回归风险换纸面收益。
fuzz 证据（含 -0/NaN/false 值池与墓碑撤销路径）入库，供重开条件使用。

### S6-J-4：攒批的收益上界被同函数内的 readAll 屏障砍掉

`waitForClarification` 不是"追加五次然后返回"——它在 :261 与 :266 两处
以 `readAll()` 的结果喂 `settleBoundEpisode` 与 checkpoint 物化。任何把
冲刷推迟越过 :261 的攒批都让 settle 读到空前缀（实测 5→0 发散），属硬
功能反例而非仅契约论证；合法的攒批窗口只剩 :223-:252 的五次追加内部，
有界收益 175–181µs 且丢弃逐消息持久性与跨进程实时可见性——S5-G-5 在
G 区的判据原样适用（本轮按 R6-E 先例以镜像 ID 入表）。一次性等待路径，
淘汰。

### S6-J-3/5/6：三个"教科书微观化"的第六遍再现

- **S6-J-3** 是本轮最有教育意义的负优化：把"keys 拷贝排序 + K 次 get
  重查"换成"entries 拷贝排序直迭"在 F=40 现实档**两 seed 稳定更慢**
  （−421/−688ns）——entries 元组装饰的分配成本高于 V8 的 K 次 Map.get；
  只有 F=400 压力档才翻正到 ~1µs。S1-F-5/X3-2 类的第 N 次实测佐证。
- **S6-J-5** 的别名快路径省 19–20ns 但翻转 `state.events !== events` 这一
  可观察身份；episode 闭合是数据面强调区。
- **S6-J-6** 是 S4-J-6 在同函数的第三站点：12–14ns 换"无别名 + some
  顺序无关"双重论证负担。

### 增长维度第六次复核：两条 O(N) 契约路径维持无更优解

preference 插入路径（recurrence 扫描 + rebuildViews + saveToDisk）与
feedback 读写路径（脱敏顺序遍 + jsonl parse + 双读串行 + 级联全量重写）
的收口论证（S1-J-1/2、S2-J-6/9/10、S3-J-1/4/5/6、S5-J-1/3）在零 diff 下
全部继承并本轮加固（S6-J-1 从级联写侧补最后一票崩溃序证据）。本轮无
剩余角度可提。

### 逐文件收口（第六遍新视角补充，R1-J..R5-J 收口之上）

| 文件 | 第六遍新检查点 | 结论 |
| --- | --- | --- |
| `privacy/deletion.ts` | 见 S6-J-1；级联四角度（S2-J-7/S4-J-3/S5-J-3/S6-J-1）全收口；`deleteRunRecords` 单 stat+rm 无可省 | 无候选落地 |
| `preferences/loop-eval.ts`（J1） | 见 S6-J-2；与 `fb41417` 逐字节一致核对 + `r1j-equivalence-sim` 重跑全绿（2468 checks，2830.7×）；S2-J-1/2 维持 | 无候选落地（J1 未回退未重做） |
| `preferences/store.ts` | `loadFromDisk` 的 `push(...spread)` 大 N 栈上限属健壮性议题非保行为优化、一次性载入；insert 路径 = S1-J-1/2、S2-J-6、S3-J-5 五面维持 | 无候选 |
| `preferences/export.ts` / `materialize.ts` / `precedence.ts` / `service.ts` / `types.ts` | S3-J-6/S5-J-1 维持；materialize entries 循环、X1-4 域 find ≤5 = R4-J/R5-J 已裁 | 无候选 |
| `context/packet.ts` | 见 S6-J-3；首 sort = S1-J-7、防御拷贝 = S2-J-5、双遍 = S4-J-4、估算构串 = S5-J-2 维持；`queryPacketGrounding` = R1-J S19 域 | 无候选落地 |
| `context/index.ts` | 见 S6-J-6；S1-J-6/S2-J-4/S3-J-2/S4-J-6/S5-J-2/S5-J-5 六面维持；manifests 哈希 fallback 串不同故去重不等价（R5-J 注记本轮复核确认） | 无候选落地 |
| `track/loop.ts` | 见 S6-J-4；`assignments.find` = S1-J-5、双 readAll = S2-J-11、catalog∥learned = S4-J-2、acceptanceForRole = S5-J-6 维持；切片内惰性 import 无分支独占被调模块（waitForClarification 独用的 discovery/replay 子树同时被 `startFlowchartRun` 静态子树覆盖）= S5-I-4 域 | 无候选落地 |
| `track/plan.ts` / `clarify.ts` / `primary-split.ts` | `planFromContract` 每 role 至多一 child（R5-J 实证维持）；`habitsFromPreferences` 双 view 合并常数规模 | 无候选 |
| `episode/manager.ts` | 见 S6-J-5；reducer 每事件 spread = S1-J-3 域（R 个位）；`TERMINAL_STATUSES` 已模块级 Set | 无候选落地 |
| `episode/closure.ts` / `replay.ts` / `events.ts` / `store.ts` | `decideClosure` = S2-J-8 维持；append 队列 promise 链为顺序契约；`replayFromLog` 单遍；类型声明 | 无候选 |
| `cluster/host.ts` / `mailbox.ts` / `spawn.ts` | 役播 trim = S2-J-3、单播双 trim = S3-J-3、spawn 死分支 = S4-J-1、claimRole box = S4-J-5、enqueue 冗余 set = S5-J-4 维持；役播首/余目标双段构造 = R5-J 已裁 ns | 无候选 |
| `persist/jsonl.ts` / `file-lock.ts` | S3-J-4 维持（split 占 CPU ~4%）；`appendJsonlLine` 每 append mkdir = S5-G-1/S6-E-3 同型自愈语义（R3-J 已裁）；锁语义数据面第六次零碰 | 无候选（数据面） |
| `feedback/redaction.ts` / `store.ts` / `types.ts` | stripForbidden = S3-J-1、needles 排序 = S2-J-9、双读 = S2-J-10、双层过滤 = R1-J S21 维持；`readFeedbackTombstoneIds` every+Set 双遍 = R5-J 已裁常数噪声 | 无候选 |
| `privacy/record-classes.ts` / `state-layout.ts` | 字典 find 无生产调用方（R1-J S12 第六次维持）；纯路径拼接 | 无候选 |

## 4. 前后对比

无代码 diff。仓库变更仅本报告一个文件。切片自 R1-J 落地 J1（`fb41417`）起
经 R2-J、R3-J、R4-J、R5-J、本轮 R6-J 五遍复查累计零后续代码改动，逐字节
一致。

## 5. 测试

零代码改动下相关套件与全量门禁基线复核，全绿（Node v22.22.2，pnpm 10.17.1）：

```bash
npx tsx scripts/r1j-equivalence-sim.ts
# ALL EQUIVALENCE CHECKS PASSED (2468 bitwise checks)
# perf fixture: reference 10182.2 ms -> current 3.6 ms (2830.7x)
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

仿真（临时脚本 `/tmp/r6j-sim.mts`，未入库——无赢家不落仿真文件，完整源码
见附录；seeds `0x66dd01`/`0x66dd02` 两次独立运行等价/反例结论逐位一致、
计时抖动范围内稳定）：

```text
seed=0x66dd01
S6-J-1 single-fault counterexample (records write faults): sequential tombstones.json untouched=true; parallel tombstones.json already advanced=true (bodies still on disk)
S6-J-1 double-fault: Promise.all surfaced [tombstones fault, records fault] as I/O timing flipped; sequential shape always surfaces "records fault"
S6-J-1 bench hit N=400: sequential=1164.6us parallel=856.5us overlap win=308.1us/delete (one-shot deletion tooling)
S6-J-2 bench N=6000: production=3.659ms string-keyed control=3.662ms nested-map=2.902ms delta(control-nested)=760.0us (no production caller; test/metric-only API)
S6-J-3 bench: F=40 current=6254ns variant=6942ns delta=-688ns; F=400 current=75.2us variant=73.5us delta=1.6us; whole compileContextPacket=36.0us (per-child compile, <=6/run)
S6-J-4 read-your-writes barrier: settle-point readAll sees 5 events today vs 0 under deferred batching -> settleBoundEpisode input diverges
S6-J-4 anchor: five appends=222.9us one batched write=41.8us bounded win=181.1us on a one-shot waiting path (per-message durability + live visibility dropped; S5-G-5 mirror)
S6-J-5 anchor E=5: whole reduceEpisodeEvents=459ns; the elidable ref-copy loop=20ns (identity change; single-episode event count stays single-digit)
S6-J-6 anchor G=8 D=30: elidable spread copy=12ns vs whole hints+unrelated derivation=92.7us (one-shot per build)
ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)

seed=0x66dd02
S6-J-1 counterexample/double-fault: 与 seed 1 逐位一致；bench hit N=400: seq=1062.9us par=863.4us overlap win=199.5us/delete
S6-J-2 bench N=6000: production=3.488ms control=3.351ms nested-map=2.856ms delta=495.4us
S6-J-3 bench: F=40 delta=-421ns（与 seed 1 同向，稳定负优化）; F=400 delta=1.0us; whole compile=31.6us
S6-J-4 barrier: 5 vs 0 与 seed 1 逐位一致; anchor: five appends=220.4us batched=45.4us bounded win=175.0us
S6-J-5 anchor: reducer=452ns; ref-copy=19ns
S6-J-6 anchor: spread copy=14ns; whole derivation=147.6us
ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)
```

环境注记（R1-J 同款）：VM 系统 Node 为 22.14.0，低于 `engines >=22.19.0`；
本轮全部测试与门禁在 nvm 的 Node 22.22.2 下执行，全绿。

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S6-J-1 | privacy 删除级联尾部双写（records 重写 ∥ tombstones 写）Promise.all 并行化 | **非保行为**：单故障反例——今日不可达的"墓碑已更新而 body 未剥除"落盘态在并行下可达（strip-before-tombstone 崩溃序不变量丢失）；双故障浮出错误变 settle 次序竞态；重叠收益 199.5–308.1µs 一次性删除工具路径。级联四角度（S2-J-7/S4-J-3/S5-J-3/S6-J-1）收口完成 |
| S6-J-2 | loop-eval `subjectId` 字符串键换嵌套 Map（scope→scopeKey→key）键控 | 等价（400 fuzz × 2 seeds 逐位）且 N=6000 极端夹具快 495–760µs（折叠的 ~14–21%），但 API 无生产调用方（S2-J-1 同判据），真实测试规模 N≤6 收益亚 µs；低于数十 ms 落地线 1–2 个量级 |
| S6-J-3 | packet `collapseFacts` keys 拷贝排序+组重查换 entries 排序直迭 | 现实 F=40 档两 seed 稳定负优化（慢 421–688ns，entries 装饰贵于 K 次 Map.get）；压力 F=400 档仅 +1.0–1.6µs（S1-F-5/X3-2 同类实测反转） |
| S6-J-4 | track `waitForClarification` 顺序事件追加攒批合并落盘 | **S5-G-5 同型镜像** + 函数内 read-your-writes 硬屏障（settle 点 readAll 实测 5→0 事件发散）；有界收益 175–181µs 一次性等待路径，逐消息持久性与跨进程实时可见性被丢弃 |
| S6-J-5 | episode `reduceEpisodeEvents` 无拒绝快路径返回输入数组别名 | 可观察身份改变（`state.events !== events` 翻转为 ===，S1-B-8/S4-B-3 同判据）；可省引用拷贝仅 19–20ns（E 个位）；episode 闭合数据面强调区 |
| S6-J-6 | context/index `generatedHints` 第三处冗余 spread 拷贝消除（就地 sort） | 12–14ns/构建、每 run 一次性；需"无别名 + some 顺序无关"双重论证负担（S4-J-6 同函数第三站点同判） |

重开条件：S6-J-1 需先做出**崩溃序契约决策**（把级联写序显式改为日志/原子
重命名事务——属语义工作并需重写隐私测试；若删除变为高频批量工具则与
S4-J-3/S5-J-3 的重开条件合并评估）；S6-J-2 若 `evaluatePreferenceLoop`
获得 N≥10⁴ 规模的高频生产调用方，可凭本报告三方 fuzz 证据重开（嵌套 Map
形态已验证方向稳定）；S6-J-4 若事件攒批被正式立项（S5-G-5 的重开），冲刷
仍必须先于 :261/:266 两个 readAll 屏障；S6-J-3/5/6 为 ns 级常数或现实档
负优化，无现实重开路径。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.mts` 后在仓库根目录 `npx tsx <file> <seed-hex>`
（依赖已装）。seeds：`0x66dd01`、`0x66dd02`（其余段确定性构造，无随机性）。

```ts
/**
 * R6-J deterministic equivalence + counterexample + benchmark simulation.
 * Adjudicates fresh sixth-pass candidates S6-J-1 .. S6-J-6 against the
 * current implementations in src/privacy(deletion cascade tail writes) +
 * src/preferences(loop-eval subject keying) + src/context(packet collapseFacts,
 * index generatedHints copy) + src/track(waitForClarification append chain) +
 * src/episode(reducer output identity).
 * Seeded PRNG (mulberry32) -> reproducible. Run: npx tsx <file> <seed-hex>
 */
import { performance } from "node:perf_hooks";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { mkdir, writeFile, appendFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { cascadeFeedbackTombstones } from "/workspace/src/privacy/deletion.js";
import {
  feedbackLogPath,
  feedbackTombstonesPath,
  readFeedbackRecordsRaw,
  readFeedbackTombstoneIds,
  writeFeedbackRecords
} from "/workspace/src/feedback/store.js";
import type { FeedbackRecord } from "/workspace/src/feedback/types.js";
import { evaluatePreferenceLoop } from "/workspace/src/preferences/loop-eval.js";
import { MIN_INFERRED_RECURRENCE_DEFAULT } from "/workspace/src/preferences/store.js";
import type { PreferenceObservation } from "/workspace/src/preferences/types.js";
import { reduceEpisodeEvents } from "/workspace/src/episode/manager.js";
import type { EpisodeEvent } from "/workspace/src/episode/events.js";
import type { ProjectEpisode } from "/workspace/src/domain/episode.js";
import { buildProjectContextIndex } from "/workspace/src/context/index.js";
import { compileContextPacket } from "/workspace/src/context/packet.js";
import type { ContextFact } from "/workspace/src/context/index.js";
import { parseIsoTimestamp } from "/workspace/src/domain/timestamp.js";
import { createProjectId, createTaskId } from "/workspace/src/domain/ids.js";
import type { EpisodeId, RunId } from "/workspace/src/domain/ids.js";
import type { ProjectSnapshot } from "/workspace/src/domain/project.js";
import type { RequirementContract } from "/workspace/src/domain/contract.js";

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (!ok) {
    failures += 1;
    process.stderr.write(`FAIL ${name}${detail === undefined ? "" : `: ${detail}`}\n`);
  }
}
function log(line: string): void {
  process.stdout.write(`${line}\n`);
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

const SEED = Number.parseInt(process.argv[2] ?? "0x66dd01", 16) || 0x66dd01;
log(`seed=0x${SEED.toString(16)}`);
const NOW = parseIsoTimestamp("2026-08-24T05:00:00.000Z");
const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

/* ============================================================
 * S6-J-1: cascadeFeedbackTombstones performs its two tail writes
 * sequentially (records.jsonl rewrite, then tombstones.json mkdir+write).
 * Candidate: Promise.all the two writes. The last serial-await pair of the
 * cascade not yet adjudicated (S2-J-7 covered the no-match probe, S4-J-3
 * the episode file removals, S5-J-3 the read timing).
 * Divergence surfaces: (a) SINGLE-fault write ordering — today the state
 * "tombstones updated but bodies still present" is unreachable because the
 * tombstone write starts only after the records rewrite completed; under
 * Promise.all a records-write fault can leave exactly that state on disk;
 * (b) double-fault error identity becomes settlement-order dependent
 * (S4-J-2/S4-J-3 class). Anchor the overlap win on the hit path.
 * ============================================================ */
{
  const mkState = (): string => mkdtempSync(join(tmpdir(), "r6j-casc-"));
  const mkRecord = (i: number, ep: string): FeedbackRecord =>
    ({
      id: `fb-${i}`,
      episodeId: ep as EpisodeId,
      kind: "human",
      rubricVersion: "r1",
      score: 80,
      evidenceRefs: [],
      redacted: false,
      createdAt: NOW,
      body: `body text ${i}`
    }) as FeedbackRecord;
  const writeRecordsFile = (stateRoot: string, eps: readonly string[]): void => {
    const path = feedbackLogPath(stateRoot);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, eps.map((ep, i) => JSON.stringify(mkRecord(i, ep))).join("\n") + "\n");
  };

  type WriteRecordsFn = (stateRoot: string, records: readonly FeedbackRecord[]) => Promise<void>;
  // Verbatim reshape of the current cascade with an injectable records write.
  const makeCascade = (parallel: boolean, writeRecs: WriteRecordsFn) =>
    async (stateRoot: string, episodeId: string): Promise<string[]> => {
      const records = await readFeedbackRecordsRaw(stateRoot).catch(() => []);
      if (records.length === 0) return [];
      const tombstones = await readFeedbackTombstoneIds(stateRoot);
      const cascaded: string[] = [];
      const updated = records.map((record) => {
        if (record.episodeId !== episodeId) return record;
        cascaded.push(record.id);
        tombstones.add(record.id);
        return record.body === undefined ? record : { ...record, body: undefined };
      });
      if (cascaded.length === 0) return [];
      const tombstonePath = feedbackTombstonesPath(stateRoot);
      const writeTombstones = async (): Promise<void> => {
        await mkdir(dirname(tombstonePath), { recursive: true });
        await writeFile(tombstonePath, `${JSON.stringify([...tombstones].sort(), null, 2)}\n`, "utf8");
      };
      if (parallel) {
        await Promise.all([writeRecs(stateRoot, updated), writeTombstones()]);
      } else {
        await writeRecs(stateRoot, updated);
        await writeTombstones();
      }
      return cascaded.sort();
    };
  const sequentialCascade = makeCascade(false, writeFeedbackRecords);
  const parallelCascade = makeCascade(true, writeFeedbackRecords);

  // Healthy-path fidelity + equivalence: production vs sequential control vs
  // parallel candidate — returned ids and final bytes of both files.
  for (const scenario of ["match", "no-match"] as const) {
    const eps = scenario === "match" ? ["ep_target", "ep_other", "ep_target"] : ["ep_a", "ep_b", "ep_c"];
    const roots = [mkState(), mkState(), mkState()];
    for (const root of roots) {
      writeRecordsFile(root, eps);
      writeFileSync(feedbackTombstonesPath(root), JSON.stringify(["fb-pre"]));
    }
    const outProd = await cascadeFeedbackTombstones(roots[0]!, "ep_target" as EpisodeId);
    const outSeq = await sequentialCascade(roots[1]!, "ep_target");
    const outPar = await parallelCascade(roots[2]!, "ep_target");
    check(
      `S6-J-1 fidelity+equivalence (${scenario}: cascaded ids)`,
      JSON.stringify(outProd) === JSON.stringify(outSeq) && JSON.stringify(outSeq) === JSON.stringify(outPar)
    );
    const bytes = (root: string, rel: (r: string) => string): string =>
      existsSync(rel(root)) ? readFileSync(rel(root), "utf8") : "<absent>";
    check(
      `S6-J-1 fidelity+equivalence (${scenario}: records.jsonl bytes)`,
      bytes(roots[0]!, feedbackLogPath) === bytes(roots[1]!, feedbackLogPath) &&
        bytes(roots[1]!, feedbackLogPath) === bytes(roots[2]!, feedbackLogPath)
    );
    check(
      `S6-J-1 fidelity+equivalence (${scenario}: tombstones.json bytes)`,
      bytes(roots[0]!, feedbackTombstonesPath) === bytes(roots[1]!, feedbackTombstonesPath) &&
        bytes(roots[1]!, feedbackTombstonesPath) === bytes(roots[2]!, feedbackTombstonesPath)
    );
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }

  // Single-fault ordering counterexample: the records rewrite faults (delayed
  // 20ms so the tombstone write deterministically completes first under
  // Promise.all). Sequential shape never touches tombstones.json; parallel
  // shape persists the new tombstones although no body was stripped.
  {
    const faultyWrite: WriteRecordsFn = () =>
      new Promise((_, reject) => setTimeout(() => reject(new Error("records write fault")), 20));
    const seqFaulty = makeCascade(false, faultyWrite);
    const parFaulty = makeCascade(true, faultyWrite);
    const rootSeq = mkState();
    const rootPar = mkState();
    for (const root of [rootSeq, rootPar]) {
      writeRecordsFile(root, ["ep_target", "ep_other"]);
      writeFileSync(feedbackTombstonesPath(root), JSON.stringify(["fb-pre"]));
    }
    let seqThrew = "";
    try {
      await seqFaulty(rootSeq, "ep_target");
    } catch (error) {
      seqThrew = (error as Error).message;
    }
    let parThrew = "";
    try {
      await parFaulty(rootPar, "ep_target");
    } catch (error) {
      parThrew = (error as Error).message;
    }
    // Let the detached tombstone write settle before inspecting bytes.
    await new Promise((resolve) => setTimeout(resolve, 40));
    const seqTombs = readFileSync(feedbackTombstonesPath(rootSeq), "utf8");
    const parTombs = readFileSync(feedbackTombstonesPath(rootPar), "utf8");
    const seqUntouched = seqTombs === JSON.stringify(["fb-pre"]);
    const parAdvanced = parTombs.includes("fb-0");
    log(
      `S6-J-1 single-fault counterexample (records write faults): sequential tombstones.json untouched=${seqUntouched}; parallel tombstones.json already advanced=${parAdvanced} (bodies still on disk) [seq threw "${seqThrew}", par threw "${parThrew}"]`
    );
    check(
      "S6-J-1 divergence demonstrated (parallel makes tombstones-without-strip reachable)",
      seqThrew !== "" && parThrew !== "" && seqUntouched && parAdvanced
    );
    rmSync(rootSeq, { recursive: true, force: true });
    rmSync(rootPar, { recursive: true, force: true });
  }

  // Double-fault demonstration: surfaced rejection follows settlement order.
  {
    const failAfter = (ms: number, message: string): Promise<never> =>
      new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
    const surfaced: string[] = [];
    for (const [recDelay, tombDelay] of [[8, 1], [1, 8]] as const) {
      try {
        await Promise.all([failAfter(recDelay, "records fault"), failAfter(tombDelay, "tombstones fault")]);
      } catch (error) {
        surfaced.push((error as Error).message);
      }
    }
    log(`S6-J-1 double-fault: Promise.all surfaced [${surfaced.join(", ")}] as I/O timing flipped; sequential shape always surfaces "records fault"`);
    check("S6-J-1 double-fault identity is settlement-order dependent", surfaced.length === 2 && surfaced[0] !== surfaced[1]);
  }

  // Bench the hit path (the only path with two writes): N=400 records, 5%
  // matching. Files recreated untimed per iteration.
  {
    const N = 400;
    const eps = Array.from({ length: N }, (_, i) => (i % 20 === 0 ? "ep_target" : `ep_other${i % 40}`));
    const root = mkState();
    let seqTotal = 0;
    let parTotal = 0;
    const REPS = 150;
    for (let i = 0; i < REPS; i += 1) {
      writeRecordsFile(root, eps);
      writeFileSync(feedbackTombstonesPath(root), JSON.stringify(["fb-pre"]));
      const t0 = performance.now();
      await sequentialCascade(root, "ep_target");
      seqTotal += performance.now() - t0;
      writeRecordsFile(root, eps);
      writeFileSync(feedbackTombstonesPath(root), JSON.stringify(["fb-pre"]));
      const t1 = performance.now();
      await parallelCascade(root, "ep_target");
      parTotal += performance.now() - t1;
    }
    log(
      `S6-J-1 bench hit N=${N}: sequential=${((seqTotal / REPS) * 1e3).toFixed(1)}us parallel=${((parTotal / REPS) * 1e3).toFixed(1)}us overlap win=${(((seqTotal - parTotal) / REPS) * 1e3).toFixed(1)}us/delete (one-shot deletion tooling)`
    );
    rmSync(root, { recursive: true, force: true });
  }
}

/* ============================================================
 * S6-J-2: evaluatePreferenceLoop builds a `${scope}\0${scopeKey}\0${key}`
 * string per observation for the bySubject / lastFlippedAway maps.
 * Candidate: nested Map<scope, Map<scopeKey, Map<key, slot>>> keying with
 * the flip origin carried in the leaf slot (no string concatenation).
 * Value-equivalent (keys are never observable); adjudicate by fuzz vs the
 * production fold and bench both shapes at N=6000. The API has no
 * production caller (test/metric-only, per R2-J S2-J-1).
 * ============================================================ */
{
  type EffVal = string | number | boolean;
  interface SubjState {
    lastExplicit: EffVal | undefined;
    lastDurableInferred: EffVal | undefined;
    inferredCounts: Map<string, number>;
  }
  interface Slot {
    state: SubjState;
    lastFlippedAway: EffVal | undefined;
  }
  const effectiveOf = (s: SubjState): EffVal | undefined => s.lastExplicit ?? s.lastDurableInferred;
  const valueKey = (v: EffVal): string => `${typeof v}:${String(v)}`;

  const foldCore = (
    observations: readonly PreferenceObservation[],
    tombstones: ReadonlySet<string>,
    slotOf: (obs: PreferenceObservation) => Slot
  ): ReturnType<typeof evaluatePreferenceLoop> => {
    const sorted = [...observations].sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
    );
    let laterExplicit = 0;
    let laterExplicitMatches = 0;
    let correctionCost = 0;
    let forgettingEvents = 0;
    let reversalEvents = 0;
    for (const obs of sorted) {
      const slot = slotOf(obs);
      const state = slot.state;
      const before = effectiveOf(state);
      const inferredBefore = before !== undefined && state.lastExplicit === undefined;
      if (obs.explicit && before !== undefined) {
        laterExplicit += 1;
        if (before === obs.value) laterExplicitMatches += 1;
        else {
          correctionCost += 1;
          if (inferredBefore) forgettingEvents += 1;
        }
      }
      const prevLastExplicit = state.lastExplicit;
      const prevLastDurableInferred = state.lastDurableInferred;
      let inferredKey: string | undefined;
      if (obs.explicit) state.lastExplicit = obs.value;
      else {
        inferredKey = valueKey(obs.value);
        const count = (state.inferredCounts.get(inferredKey) ?? 0) + 1;
        state.inferredCounts.set(inferredKey, count);
        if (count >= MIN_INFERRED_RECURRENCE_DEFAULT) state.lastDurableInferred = obs.value;
      }
      const mid = effectiveOf(state);
      if (tombstones.has(obs.id)) {
        state.lastExplicit = prevLastExplicit;
        state.lastDurableInferred = prevLastDurableInferred;
        if (inferredKey !== undefined) {
          const count = state.inferredCounts.get(inferredKey) ?? 0;
          if (count <= 1) state.inferredCounts.delete(inferredKey);
          else state.inferredCounts.set(inferredKey, count - 1);
        }
      }
      const after = effectiveOf(state);
      if (tombstones.has(obs.id) && mid !== undefined && after === undefined) forgettingEvents += 1;
      if (before !== undefined && after !== undefined && before !== after) {
        const origin = slot.lastFlippedAway;
        if (origin !== undefined && origin === after) reversalEvents += 1;
        slot.lastFlippedAway = before;
      } else if (after === undefined) {
        slot.lastFlippedAway = undefined;
      }
    }
    return {
      fit: laterExplicit === 0 ? 1 : laterExplicitMatches / laterExplicit,
      correctionCost,
      forgettingEvents,
      reversalEvents
    };
  };

  const mkSlot = (): Slot => ({
    state: { lastExplicit: undefined, lastDurableInferred: undefined, inferredCounts: new Map() },
    lastFlippedAway: undefined
  });
  const stringKeyed = (
    observations: readonly PreferenceObservation[],
    tombstones: ReadonlySet<string>
  ): ReturnType<typeof evaluatePreferenceLoop> => {
    const bySubject = new Map<string, Slot>();
    return foldCore(observations, tombstones, (obs) => {
      const id = `${obs.scope}\u0000${obs.scopeKey}\u0000${obs.key}`;
      let slot = bySubject.get(id);
      if (slot === undefined) {
        slot = mkSlot();
        bySubject.set(id, slot);
      }
      return slot;
    });
  };
  const nestedKeyed = (
    observations: readonly PreferenceObservation[],
    tombstones: ReadonlySet<string>
  ): ReturnType<typeof evaluatePreferenceLoop> => {
    const byScope = new Map<string, Map<string, Map<string, Slot>>>();
    return foldCore(observations, tombstones, (obs) => {
      let byScopeKey = byScope.get(obs.scope);
      if (byScopeKey === undefined) {
        byScopeKey = new Map();
        byScope.set(obs.scope, byScopeKey);
      }
      let byKey = byScopeKey.get(obs.scopeKey);
      if (byKey === undefined) {
        byKey = new Map();
        byScopeKey.set(obs.scopeKey, byKey);
      }
      let slot = byKey.get(obs.key);
      if (slot === undefined) {
        slot = mkSlot();
        byKey.set(obs.key, slot);
      }
      return slot;
    });
  };

  const sameReport = (
    a: ReturnType<typeof evaluatePreferenceLoop>,
    b: ReturnType<typeof evaluatePreferenceLoop>
  ): boolean =>
    Object.is(a.fit, b.fit) &&
    Object.is(a.correctionCost, b.correctionCost) &&
    Object.is(a.forgettingEvents, b.forgettingEvents) &&
    Object.is(a.reversalEvents, b.reversalEvents);

  const randomObservations = (
    rng: () => number,
    n: number
  ): { observations: PreferenceObservation[]; tombstones: Set<string> } => {
    const scopes = ["user", "project", "task-family", "role", "model"] as const;
    const values: EffVal[] = ["fast", "slow", "0", 0, 1, true, false];
    const observations: PreferenceObservation[] = [];
    const tombstones = new Set<string>();
    for (let i = 0; i < n; i += 1) {
      const id = `obs-${i}`;
      const ms = 1700000000000 + Math.floor(rng() * 500000) * 1000;
      observations.push({
        id,
        scope: scopes[Math.floor(rng() * scopes.length)]!,
        scopeKey: `k${Math.floor(rng() * 2)}`,
        key: `key${Math.floor(rng() * 3)}`,
        value: values[Math.floor(rng() * values.length)]!,
        evidenceEpisodeId: "ep_x" as EpisodeId,
        weight: 1,
        createdAt: parseIsoTimestamp(new Date(ms).toISOString()),
        explicit: rng() < 0.3,
        recurrenceCount: 1
      });
      if (rng() < 0.25) tombstones.add(id);
    }
    return { observations, tombstones };
  };

  const rng = mulberry32(SEED + 1);
  for (let trial = 0; trial < 400; trial += 1) {
    const { observations, tombstones } = randomObservations(rng, 1 + Math.floor(rng() * 80));
    const prod = evaluatePreferenceLoop(observations, tombstones);
    check("S6-J-2 control fidelity (string-keyed)", sameReport(prod, stringKeyed(observations, tombstones)), `trial ${trial}`);
    check("S6-J-2 equivalence (nested-keyed)", sameReport(prod, nestedKeyed(observations, tombstones)), `trial ${trial}`);
  }
  const big = randomObservations(mulberry32(SEED + 2), 6000);
  const prodCost = bench(() => {
    evaluatePreferenceLoop(big.observations, big.tombstones);
  }, 60);
  const strCost = bench(() => {
    stringKeyed(big.observations, big.tombstones);
  }, 60);
  const nestCost = bench(() => {
    nestedKeyed(big.observations, big.tombstones);
  }, 60);
  log(
    `S6-J-2 bench N=6000: production=${prodCost.toFixed(3)}ms string-keyed control=${strCost.toFixed(3)}ms nested-map=${nestCost.toFixed(3)}ms delta(control-nested)=${((strCost - nestCost) * 1e3).toFixed(1)}us (no production caller; test/metric-only API)`
  );
}

/* ============================================================
 * S6-J-3: packet collapseFacts copies groups.keys() into an array, sorts
 * it, then re-queries groups.get(key) per key. Candidate: sort the copied
 * entries and iterate them directly (saves K Map.gets and the undefined
 * guard). X3-2 / S1-F-5 class; anchor at realistic and stress scales.
 * ============================================================ */
{
  const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const trustRank = (trust: ContextFact["trust"]): number =>
    trust === "HIGH" ? 0 : trust === "MEDIUM" ? 1 : trust === "LOW" ? 2 : 3;
  const pickCanonical = (facts: readonly ContextFact[]): ContextFact | undefined => {
    if (facts.length === 0) return undefined;
    return [...facts].sort((a, b) => {
      const trustDelta = trustRank(a.trust) - trustRank(b.trust);
      if (trustDelta !== 0) return trustDelta;
      const hashDelta = compareStrings(a.sourceHash, b.sourceHash);
      if (hashDelta !== 0) return hashDelta;
      return compareStrings(a.freshness, b.freshness);
    })[0];
  };
  const collapseBody = (groups: Map<string, ContextFact[]>, iterate: (fn: (key: string, group: ContextFact[]) => void) => void): ContextFact[] => {
    const collapsed: ContextFact[] = [];
    iterate((key, group) => {
      const byValue = new Map<string, ContextFact[]>();
      for (const fact of group) {
        const same = byValue.get(fact.value);
        if (same === undefined) byValue.set(fact.value, [fact]);
        else same.push(fact);
      }
      const values = [...byValue.keys()].sort(compareStrings);
      if (values.length === 1) {
        const value = values[0];
        if (value === undefined) return;
        const chosen = pickCanonical(byValue.get(value) ?? []);
        if (chosen !== undefined) collapsed.push(chosen);
        return;
      }
      values.forEach((value, index) => {
        const chosen = pickCanonical(byValue.get(value) ?? []);
        if (chosen === undefined) return;
        collapsed.push({ ...chosen, key: `${key}#${index}` });
      });
    });
    return collapsed;
  };
  const group = (facts: readonly ContextFact[]): Map<string, ContextFact[]> => {
    const groups = new Map<string, ContextFact[]>();
    for (const fact of facts) {
      const g = groups.get(fact.key);
      if (g === undefined) groups.set(fact.key, [fact]);
      else g.push(fact);
    }
    return groups;
  };
  // Verbatim current shape: keys copied, sorted, re-queried.
  const currentCollapse = (facts: readonly ContextFact[]): ContextFact[] => {
    const groups = group(facts);
    return collapseBody(groups, (fn) => {
      const keys = [...groups.keys()].sort(compareStrings);
      for (const key of keys) {
        const g = groups.get(key);
        if (g === undefined) continue;
        fn(key, g);
      }
    });
  };
  // Candidate: sort entries once, iterate directly.
  const variantCollapse = (facts: readonly ContextFact[]): ContextFact[] => {
    const groups = group(facts);
    return collapseBody(groups, (fn) => {
      const entries = [...groups.entries()].sort((a, b) => compareStrings(a[0], b[0]));
      for (const [key, g] of entries) fn(key, g);
    });
  };
  const rng = mulberry32(SEED + 3);
  const trusts: ContextFact["trust"][] = ["HIGH", "MEDIUM", "LOW", "unavailable"];
  const freshnesses: ContextFact["freshness"][] = ["fresh", "stale", "unavailable"];
  const randomFacts = (n: number): ContextFact[] =>
    Array.from({ length: n }, (_, i) => ({
      key: `fact.k${Math.floor(rng() * Math.max(2, n / 3))}`,
      value: `v${Math.floor(rng() * 4)}`,
      trust: trusts[Math.floor(rng() * trusts.length)]!,
      sourceHash: `h${Math.floor(rng() * 6)}-${i % 3}`,
      freshness: freshnesses[Math.floor(rng() * freshnesses.length)]!
    }));
  for (let trial = 0; trial < 400; trial += 1) {
    const facts = randomFacts(Math.floor(rng() * 60));
    check(
      "S6-J-3 equivalence",
      JSON.stringify(currentCollapse(facts)) === JSON.stringify(variantCollapse(facts)),
      `trial ${trial}`
    );
  }
  const realistic = randomFacts(40);
  const stress = randomFacts(400);
  const curReal = bench(() => {
    currentCollapse(realistic);
  }, 20000);
  const varReal = bench(() => {
    variantCollapse(realistic);
  }, 20000);
  const curStress = bench(() => {
    currentCollapse(stress);
  }, 2000);
  const varStress = bench(() => {
    variantCollapse(stress);
  }, 2000);
  // Whole-compile anchor.
  const snapshot = {
    id: createProjectId(UUID),
    rootPath: "/repo",
    discoveredAt: NOW,
    instructionFiles: Array.from({ length: 6 }, (_, i) => ({ path: `/repo/dir${i}/AGENTS.md` })),
    manifests: Array.from({ length: 12 }, (_, i) => ({ path: i === 10 ? "/repo/package.json" : `/repo/pkg${i}/manifest.yaml` })),
    commands: Array.from({ length: 8 }, (_, i) => ({ name: `cmd${i}`, command: `run cmd${i}` })),
    facts: Array.from({ length: 20 }, (_, i) => ({ key: i % 2 ? `architecture.a${i}` : `risk.r${i}`, value: `v${i}`, confidence: "HIGH" as const }))
  } as unknown as ProjectSnapshot;
  const index = buildProjectContextIndex(snapshot);
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
  log(
    `S6-J-3 bench: F=40 current=${(curReal * 1e6).toFixed(0)}ns variant=${(varReal * 1e6).toFixed(0)}ns delta=${((curReal - varReal) * 1e6).toFixed(0)}ns; F=400 current=${(curStress * 1e3).toFixed(1)}us variant=${(varStress * 1e3).toFixed(1)}us delta=${((curStress - varStress) * 1e3).toFixed(1)}us; whole compileContextPacket=${(whole * 1e3).toFixed(1)}us (per-child compile, <=6/run)`
  );
}

/* ============================================================
 * S6-J-4: waitForClarification appends its events one awaited call at a
 * time (PROJECT_DISCOVERED, RUN_CREATED, episode-bind events, RUN_STARTED,
 * RUN_WAITING_FOR_USER). Candidate: buffer and batch them into one disk
 * write. S5-G-5 mirror in this slice. Counterexample: the same function
 * calls settleBoundEpisode with `(await eventStore.readAll()).events` —
 * a read-your-writes barrier; deferring the flush past it makes the read
 * miss the buffered events. Batching also drops per-message durability
 * (any crash prefix is currently a valid log; a batch makes co-flushed
 * events all-or-nothing) and live cross-process visibility. Anchor the
 * bounded win: 5 small appends vs 1 batched write.
 * ============================================================ */
{
  const dir = mkdtempSync(join(tmpdir(), "r6j-append-"));
  const logPath = join(dir, "events.jsonl");
  const lines = Array.from({ length: 5 }, (_, i) =>
    JSON.stringify({ id: `evt-${i}`, schemaVersion: 1, type: "RUN_CREATED", occurredAt: NOW, payload: { i } })
  );
  // Read-your-writes barrier counterexample: current shape reads 5 events at
  // the settle point; the deferred-batch shape reads 0.
  const readCount = async (): Promise<number> => {
    const raw = await readFile(logPath, "utf8").catch(() => "");
    return raw === "" ? 0 : raw.split("\n").filter((line) => line !== "").length;
  };
  writeFileSync(logPath, "");
  for (const line of lines) await appendFile(logPath, `${line}\n`, "utf8");
  const seenCurrent = await readCount();
  writeFileSync(logPath, "");
  const buffered = [...lines]; // batch variant: nothing flushed yet
  const seenBatched = await readCount();
  await appendFile(logPath, `${buffered.join("\n")}\n`, "utf8"); // flush after the read
  const seenAfterFlush = await readCount();
  log(
    `S6-J-4 read-your-writes barrier: settle-point readAll sees ${seenCurrent} events today vs ${seenBatched} under deferred batching (flush later restores ${seenAfterFlush}) -> settleBoundEpisode input diverges`
  );
  check("S6-J-4 divergence demonstrated (barrier read misses buffered events)", seenCurrent === 5 && seenBatched === 0 && seenAfterFlush === 5);

  // Bounded win anchor: 5 sequential appends vs 1 batched write.
  writeFileSync(logPath, "");
  const seqCost = await benchAsync(async () => {
    for (const line of lines) await appendFile(logPath, `${line}\n`, "utf8");
  }, 200);
  writeFileSync(logPath, "");
  const batchCost = await benchAsync(async () => {
    await appendFile(logPath, `${lines.join("\n")}\n`, "utf8");
  }, 200);
  log(
    `S6-J-4 anchor: five appends=${(seqCost * 1e3).toFixed(1)}us one batched write=${(batchCost * 1e3).toFixed(1)}us bounded win=${((seqCost - batchCost) * 1e3).toFixed(1)}us on a one-shot waiting path (per-message durability + live visibility dropped; S5-G-5 mirror)`
  );
  rmSync(dir, { recursive: true, force: true });
}

/* ============================================================
 * S6-J-5: reduceEpisodeEvents rebuilds the accepted-events array even when
 * every event is accepted. Candidate: fast path returning the input array
 * alias when nothing was rejected. Identity counterexample: production
 * always returns a fresh array (state.events !== events); the alias makes
 * them ===, an observable identity change (S1-B-8/S4-B-3/S3-F-5 class).
 * Anchor the copy cost at the single-episode scale (R in the single digits).
 * ============================================================ */
{
  const episode: ProjectEpisode = {
    id: "ep_r6j" as EpisodeId,
    projectId: createProjectId(UUID),
    objective: "demo",
    contractVersion: 1,
    runIds: [],
    startedAt: NOW,
    status: "OPEN",
    acceptance: [],
    evidenceRefs: []
  } as unknown as ProjectEpisode;
  const events: EpisodeEvent[] = [
    { type: "EPISODE_OPENED", episode, occurredAt: NOW },
    { type: "RUN_ATTACHED", episodeId: episode.id, runId: "run-1" as RunId, attachedAt: NOW },
    { type: "RUN_ATTACHED", episodeId: episode.id, runId: "run-2" as RunId, attachedAt: NOW },
    { type: "EPISODE_WAITING", episodeId: episode.id, reason: "user", requiredEvidence: [], occurredAt: NOW },
    { type: "EPISODE_CLOSED", episodeId: episode.id, status: "COMPLETED", closedAt: NOW }
  ];
  const state = reduceEpisodeEvents(events);
  check("S6-J-5 clean stream premise (all accepted, not fail-closed)", !state.failClosed && state.events.length === events.length);
  check(
    "S6-J-5 identity: production returns a fresh array; alias fast path would flip this to ===",
    (state.events as readonly EpisodeEvent[]) !== events &&
      state.events.every((event, i) => event === events[i])
  );
  const reduceCost = bench(() => {
    reduceEpisodeEvents(events);
  }, 100000);
  const copyCost = bench(() => {
    const out: EpisodeEvent[] = [];
    for (const e of events) out.push(e);
  }, 500000);
  log(
    `S6-J-5 anchor E=${events.length}: whole reduceEpisodeEvents=${(reduceCost * 1e6).toFixed(0)}ns; the elidable ref-copy loop=${(copyCost * 1e6).toFixed(0)}ns (identity change; single-episode event count stays single-digit)`
  );
}

/* ============================================================
 * S6-J-6: buildProjectContextIndex copies the fresh uniquePreserve output
 * once more (`[...generatedPaths].sort`) to build generatedHints because
 * generatedPaths is still consumed (in input order) by the dirtyUnrelated
 * filter. Candidate: sort generatedPaths in place — the later `.some` is
 * order-independent for its boolean result, so outputs match, but the
 * elision needs that no-alias + order-independence argument (S4-J-6's
 * third site in the same function). Fuzz outputs + anchor the copy.
 * ============================================================ */
{
  const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const normalizePath = (path: string): string => path.replace(/\\/g, "/").replace(/\/+$/, "");
  const relativeToRoot = (rootPath: string, filePath: string): string => {
    const root = normalizePath(rootPath);
    const path = normalizePath(filePath);
    if (path === root) return "";
    if (root !== "" && path.startsWith(`${root}/`)) return path.slice(root.length + 1);
    return path;
  };
  const isPathInside = (child: string, parent: string): boolean => {
    const c = normalizePath(child);
    const p = normalizePath(parent);
    if (p === "") return false;
    return c === p || c.startsWith(`${p}/`);
  };
  const isUnderGenerated = (dirty: string, generated: string, rootPath: string): boolean => {
    if (isPathInside(dirty, generated)) return true;
    return isPathInside(relativeToRoot(rootPath, dirty), relativeToRoot(rootPath, generated));
  };
  const uniquePreserve = (items: readonly string[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of items) {
      if (seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
    return out;
  };
  const root = "/repo";
  const currentShape = (rawGenerated: readonly string[], rawDirty: readonly string[]) => {
    const generatedPaths = uniquePreserve(rawGenerated);
    const dirtyPaths = uniquePreserve(rawDirty);
    const generatedHints = [...generatedPaths].sort(compareStrings);
    const dirtyUnrelated = dirtyPaths
      .filter((path) => !generatedPaths.some((generated) => isUnderGenerated(path, generated, root)))
      .slice()
      .sort(compareStrings);
    return { generatedHints, dirtyUnrelated };
  };
  const inPlaceShape = (rawGenerated: readonly string[], rawDirty: readonly string[]) => {
    const generatedPaths = uniquePreserve(rawGenerated);
    const dirtyPaths = uniquePreserve(rawDirty);
    const generatedHints = generatedPaths.sort(compareStrings); // in-place, aliases generatedPaths
    const dirtyUnrelated = dirtyPaths
      .filter((path) => !generatedPaths.some((generated) => isUnderGenerated(path, generated, root)))
      .slice()
      .sort(compareStrings);
    return { generatedHints, dirtyUnrelated };
  };
  const rng = mulberry32(SEED + 4);
  const randomPaths = (n: number, pool: number): string[] =>
    Array.from({ length: n }, () => {
      const sep = rng() < 0.15 ? "\\" : "/";
      const depth = 1 + Math.floor(rng() * 3);
      const segments = Array.from({ length: depth }, () => `d${Math.floor(rng() * pool)}`);
      const suffix = rng() < 0.15 ? "/" : "";
      return `${root}${sep}${segments.join(sep)}${suffix}`;
    });
  let snapshotChecked = false;
  for (let trial = 0; trial < 400; trial += 1) {
    const rawGenerated = randomPaths(Math.floor(rng() * 10), 4);
    const rawDirty = randomPaths(Math.floor(rng() * 30), 6);
    const a = currentShape(rawGenerated, rawDirty);
    const b = inPlaceShape(rawGenerated, rawDirty);
    check("S6-J-6 equivalence", JSON.stringify(a) === JSON.stringify(b), `trial ${trial}`);
    if (!snapshotChecked) {
      // Production fidelity spot-check on the first trial.
      const snapshot = {
        id: createProjectId(UUID),
        rootPath: root,
        discoveredAt: NOW,
        instructionFiles: [],
        manifests: [],
        commands: [],
        facts: []
      } as unknown as ProjectSnapshot;
      const built = buildProjectContextIndex(snapshot, { generatedPaths: rawGenerated, dirtyPaths: rawDirty });
      check(
        "S6-J-6 production fidelity",
        JSON.stringify({ generatedHints: built.generatedHints, dirtyUnrelated: built.dirtyUnrelated }) === JSON.stringify(a)
      );
      snapshotChecked = true;
    }
  }
  const gen8 = randomPaths(8, 4);
  const copyCost = bench(() => {
    void [...gen8];
  }, 500000);
  const dirty30 = randomPaths(30, 6);
  const whole = bench(() => {
    currentShape(gen8, dirty30);
  }, 20000);
  log(
    `S6-J-6 anchor G=8 D=30: elidable spread copy=${(copyCost * 1e6).toFixed(0)}ns vs whole hints+unrelated derivation=${(whole * 1e3).toFixed(1)}us (one-shot per build; needs no-alias + some-order-independence argument)`
  );
}

if (failures > 0) {
  process.stderr.write(`\n${failures} check(s) FAILED\n`);
  process.exit(1);
}
log("\nALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)");
```

MORE_OPTIMA=no
BRANCH=cursor/r6-j-persist-sixth-pass-83a1
