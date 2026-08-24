MODEL_SLUG=claude-fable-5-thinking-xhigh

# R9-D：`src/adaptation/` 第九遍搜查报告（Round 1–8 同区第九遍）

**战役:** 全库持久 SOTA 优化 Round 9 / R9-D
**基线:** `cursor/sota-persistent-opt-83a1` @ `9dce7c0`
**分支:** `cursor/r9-d-adaptation-ninth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 切片 14 个文件自 R1-D 基线
（`82bef36`）起至本轮基线（`9dce7c0`）**第九轮逐字节未变**
（`git diff 82bef36..9dce7c0 -- src/adaptation/` 为空），前八轮全部
规模测量、逐文件收口与 S1-D..S8-D 七族排除继承有效。**调用面本轮有
更强的冻结证据**：R8-D 基线 `aa730d2` 之后到 `9dce7c0` 的全部提交都是
`docs(sota-opt)` 报告/摄取——`git diff aa730d2..9dce7c0 -- src/` 为空，
即整个 `src/` 生产面自 R8-D 裁决以来一个字节都没动过，调用图与被调方
（S7-F 后的 experiments/{shadow,plan}.ts）与 R8-D 测量时逐字节相同；
monitor / pareto / reflection / mutate / retirement 族"生产面无切片外
调用方"的图景本轮另以 grep 首手复核成立。本轮按指令先**重测全部
端到端锚点**（§1：toy eval 4.33–4.41ms、load 0.10–0.13ms、save+fsync
0.60–0.63ms；§1b：shadow P=2000/A=1000 → 121.8–123.3ms，落在 R8-D
119.9–124.6 带内；§1c：配置态 146.2KB registry——load 0.61–0.65ms、
save 1.63–1.82ms、eval E=200 **3.65–3.69ms**，与 R8-D 3.67–3.93 重合，
配置态无悬崖第二次独立成立），再**补齐配置态 × 命令类矩阵最后两格**
（§1d，R8-D 只锚了 eval/load/save 三格）：配置态 promote **纯操作
46.1–47.7µs**（含门链 3 次对 9.2KB 政策的 hashCandidateContent，单次
9.6–9.8µs，即门链哈希 ≈29µs 占 op 的 ~60%，X1-1/S1-D-7 已裁的
fail-closed 契约价格）、rollback（user CAS）**纯操作 3.2–3.7µs**——
两个命令类都是 load→op→save 形态，op 占整命令 ≤7%，被 ms 级 I/O
支配，**矩阵四命令类（eval/promote/rollback/monitor）至此全部收口**
（monitor 生产面无调用方，该格为 N/A）。然后换第九组新透镜全量重读
枚举，得到 4 个此前排除表未点名的新候选（S9-D-1 … S9-D-4），全部经
理论 + 确定性仿真（seeded mulberry32，seeds `0xd99d01`–`0xd99d06`，
反例构造 / 等价 fuzz / 真实规模基准，两次独立运行等价/反例结论
**逐位一致**）裁决后淘汰：1 个是授权指令点名的 PIC 观察项落到本切片
的正面解答（S9-D-1 parseEpisode 输出形状单态化——多态是真的、可测
的，但合计 12.8–13.9µs/eval，距落地线 ≥3 个量级）、1 个 ns 级分配
融合（S9-D-2，725–746ns）、1 个可证死码的形式收口（S9-D-3
preparePromotion 第二次 candidateId 比较，收益上界 3.1–3.7ns）、
1 个双杀（S9-D-4：便宜的快路径形态有**确定性 Unicode 大小写折叠
fail-open 反例**——U+212A KELVIN SIGN 折叠成 "k" 使 "api\u212Aey"
绕过凭据字段扫描门；健全形态在真实 camelCase 键分布下**实测更慢**
−1.4~−1.8µs/walk）。未重开任何 X* / S1-* … S8-* / S9-A-* 条目。
X2-5 维持排除未触碰。CAS/权限/凭据/数据面语义零 diff，天然不变。
双 LCB 与双归因未触碰。不声称 Outcome-supported；Checkpoint F-PROD
仍开放。本切片在人审门控低频控制面契约下维持 SOTA；~4ms eval + fsync
地板第七次独立复核成立，配置态矩阵本轮全格闭合，按验收标准第 3 条
切片继续收口——整片唯一重开阈值仍是 E 增长 ≥2 个量级（继承
R6-D..R8-D §7 的单项外推 ~45ms）。

## 0. 范围与约束遵守

- 切片：`src/adaptation/` 全部 14 文件（registry、promotion、
  promotion-rules、candidate、eval-routing、pareto、rollback、resource、
  retirement、active-pointer、monitor、approval-profile、reflection、
  mutate）本轮再次**全量实际读码**，未依赖前八轮记忆。
- 先读并遵守（指令顺序）：README / EXCLUSIONS.md（完整表含 S8-A..J
  全族与 S9-A-1；S7-C 已落地于 offline-logit，未触碰）/
  round-09/PLAN.md / round-08/PLAN.md + R8-D.md /
  round-01/R1-D.md … round-07/R7-D.md。
- 基线漂移检查：`git diff 82bef36..9dce7c0 -- src/adaptation/` 为空
  （第九轮字节恒等）；**切片外调用面**——`git log aa730d2..9dce7c0`
  全部为 docs(sota-opt) 提交，`git diff aa730d2..9dce7c0 -- src/`
  **为空**：自 R8-D 起 `src/` 生产面零变更，调用图 = R8-D 验证过的
  调用图（无新调用方、被调方 experiments/{shadow,plan}.ts 未再动）。
  另以 grep 首手复核：`createAdaptationDriftMonitor` / `retireVersion`
  / `assertAssignable` / `isRetired` / `paretoFront` /
  `evaluateProposalShadow` / `adjustParameter` / `replaceSection` 在
  `src/` 的出现仅限定义文件与切片内部（registry→retirement），
  生产面无切片外调用方。
- 排除表遵守：候选枚举刻意绕开全部既有排除，近缘条目专门比对：
  **S9-D-1 ≠ S8-D-5**（S8-D-5 是"条件展开 → 条件赋值"的构造成本
  消除、**保持键缺席**即保持 4 种隐藏类；S9-D-1 是输出形状单态化——
  可选键恒在、值为 undefined，4 类 → 1 类，理论是下游 IC 多态而非
  分配，正是授权指令点名的 PIC 观察项 S8-A-3/S8-E-2/S8-H-1 落到本
  切片的形态）；**S9-D-2 ≠ S3-D-3**（S3-D-3 是 roots **内容**首现
  去重，改变守卫所见数组；S9-D-2 内容逐元素恒等，只融合构造分配）；
  **S9-D-3** 在 R1-D 叙述中被顺带提过"保留为防御纵深"但从未获 ID
  与仿真——本轮形式裁决收口；**S9-D-4** 的 toLowerCase 逐键成本
  八轮从未点名。禁令点名的再哈希消除 / fsync 消除 / rollbackLog
  预清除 / parseEpisode 展开（S8-D-1..5 域）均未换名重提。
- 已落地项未重做：promotion-rules 拆环、gatedComparisonReport 薄包装、
  `loadAdaptationRegistryOrNew`、S6-C/S6-F-1/S7-F-1/S7-F-2/S5-I-1/
  S7-I-1/S7-C/S8-B 域（均在切片外或已收口，不触碰）。
- CAS 语义（`casActivePointer` + 两阶段 begin/commit + 幂等回滚）、
  权限/安全/凭据永不自动晋升、`adapt auto` 只提案、restore() 逐 blob
  再哈希（S8-D-1）、getActiveContent 读路径再哈希（S8-D-2）、
  saveAdaptationRegistry fsync（S8-D-3）、restore() rollbackLog
  预清除（S8-D-4）——零 diff，全部天然保持。双 LCB 与双归因不涉及
  本切片，均未触碰。不声称 Outcome-supported；Checkpoint F-PROD 仍
  开放（ADR-005）。不改阈值、公开签名、数据面契约。不改测试。无赢家
  故未新建等价仿真入库脚本；败者仿真全文留在本报告附录。lint 全绿。

## 1. 预算支配论证复核（指令要求的第一步）

R3-D §3 … R8-D §1 的论证：全部生产入口是每进程一次的 CLI/auto-loop
（磁盘载入→单次操作→原子保存）；切片内可寻址成本 promote/rollback
路径 <~50µs、eval 路径 <0.5ms，均被固定 ms 级成本支配。本轮用与
R4-D..R8-D 相同的真实入口端到端方法重测（temp stateRoot + 真实
`saveAdaptationRegistry`/`loadAdaptationRegistry`/`evalRoutingPolicy`，
E=200 数据集，两次独立运行）：

```text
run1: registry load=0.10ms save(+fsync)=0.60ms | adapt-eval end-to-end (E=200, toy policy)=4.41ms
run2: registry load=0.13ms save(+fsync)=0.63ms | adapt-eval end-to-end (E=200, toy policy)=4.33ms
```

**eval 锚点带成立**（4.33–4.41ms，与 R8-D 4.05–4.33ms 带上沿重合、
与 R7-D 4.26–4.59ms 带重叠——VM 间抖动）；save+fsync 0.60–0.63ms
较 R8-D 的 0.39–0.45ms 偏高但同为亚 ms 级 I/O 地板（本 VM fsync
抖动，方向不变）。本轮候选中可证等价且非反例的三项（S9-D-1
~13µs、S9-D-2 ~0.7µs、S9-D-3 ~3ns）距数十~数百 ms 落地线 ≥3–7 个
量级；预算支配论证经第七次独立复核后继续成立。

### 1b. `evaluateProposalShadow` 穿透 S7-F 被调方重测

`shadow.ts`/`plan.ts` 自 R8-D 以来零字节变更（§0 的空 diff 证明），
本轮只做同 VM 重锚：

```text
S0b evaluateProposalShadow: P=200  A=100  -> 1.4ms per call
S0b evaluateProposalShadow: P=2000 A=1000 -> 121.8–123.3ms per call
```

落在 R8-D 的 119.9–124.6ms 带内（同类 VM）。逐步 population-restore/
验证成本仍全部在被调方（X4-1 / S3-F-2 / S2-F-1 / S6-F-1 / S7-F-1
辖区，指令明示不编辑 experiments/）；切片内的 `evaluateProposalShadow`
本体只做 plan 校验 + 循环委托 + 状态透传，且在 `src/` 生产面
**无调用方**（§0 grep 复核，测试专用）。调用方结果序无对齐契约的
现状未变。切片内无 ms 级可寻址份额，无候选。

### 1c. 配置态锚点复测（R7-I 教训，R8-D §1c 同构造复刻）

与 R8-D §1c 完全相同的构造（9.2KB 学习政策 = 40 avoid + 40 prefer +
7 assignments 绑定真实目录模型 id；registry V=15/C=9/L=11/B=18 blobs
119.5KB，registry.json 146.2KB）：

```text
S0c configured: load=0.61–0.65ms save(+fsync)=1.63–1.82ms | adapt-eval end-to-end (E=200, configured policy)=3.65–3.69ms
```

配置态 eval 与 R8-D 的 3.67–3.93ms 逐带重合，与本 VM 玩具态
4.33–4.41ms 同在 ~4ms 带内——**"D 切片无配置态悬崖"第二次独立
成立**。load/save 增量仍全部是 JSON 解析/序列化 + 逐 blob 再哈希
（S8-D-1 已裁）+ fsync 的 O(状态规模) 固有成本。

### 1d. 配置态 × 命令类矩阵收口（本轮新格：promote / rollback op）

R8-D 的配置态锚点只覆盖 eval/load/save；**promote 与 rollback 两个
命令类从未在配置态锚过**——这是 R7-I 方法论下矩阵的最后两个空格。
两命令均为 load→op→save 形态，load/save 地板已由 §1c 界定，本轮
单测 op 格（K=60 个独立配置态 registry 夹具，含真实 eval 报告的
`validateComparisonReport` + 路由政策门链）：

```text
S0d configured op-only anchors (K=60): promote op=46.1–47.7us | rollback(user CAS) op=3.2–3.7us | single hash32 over the 9.2KB policy=9.6–9.8us (x3 on the promote gate chain)
```

三个结论：(a) 配置态 promote op 46.1–47.7µs，其中门链 3 次
`hashCandidateContent`（promoteWithRegistry 外层断言 +
preparePromotion 断言 + putContent 键构造）≈29µs 占 ~60%——这是
X1-1/S1-D-7 已裁决的 CAS fail-closed 契约价格，不是可寻址成本；
(b) rollback（user CAS）op 3.2–3.7µs，纯指针/账目操作，政策规模
无关；(c) 两格均比整命令的 load+save（≥2.2ms 配置态）低 ≥1.5 个
量级，**配置态命令类矩阵全格闭合，无格达落地线**。monitor 命令类
生产面无调用方（§0 grep），该格 N/A。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S9-D-1 | `parseEpisode` 输出形状单态化（可选键 taskFamily/taskSuccess 恒在、值为 undefined——4 种隐藏类 → 1 种；≠ S8-D-5 的"展开→条件赋值"构造消除，那条**保持键缺席**即保持多态。授权指令 PIC 观察项 S8-A-3/S8-E-2/S8-H-1 落到本切片的形态） | 下游 replayAssignments/pairedRecords 对 episode.taskFamily/taskSuccess 的读取从 4-way 多态 IC 变单态；构造侧省 spread | ✅ 等价（下游字节面）：300 试次字段值 + 错误路径逐位一致；键存在性发散**仅在模块私有对象上**（`RoutingEvalEpisode` 未导出，grep 证明无消费者枚举键；`??` 读取对 undefined 值与键缺席同义；JSON.stringify 略去 undefined）；E=200 真实消费管线（assignTasks 双政策 + actions + records）**actions/records 字节恒等**（含 rerunHash 序列化路径 stableStringify+hash32 恒等） | E=200：构造 41.0–41.8µs → 33.9–35.0µs、消费 26.7–26.8µs → 19.6–21.1µs，**合计 delta 12.8–13.9µs/eval** = 端到端 0.3–0.4% | 淘汰：多态是真的且两侧均可测改善，但 µs 级距落地线 ≥3 个量级（S8-D-5/S5-D-2/S7-D-5 同带噪声族的第九遍新透镜版本）；PIC 观察项在本切片就此正面解答收口 |
| S9-D-2 | `assertReplayIsolated` roots 构造融合（`[...episodes.map(originalWorkspace), datasetDir]` 两遍 map+spread → 单遍预分配写入；≠ S3-D-3 的 roots **内容**首现去重——本条内容逐元素恒等） | 省一次中间数组 + spread 拷贝/eval | ✅ 等价：200 试次（n=0..11 含重叠工作区）元素逐位同序；`createIsolationGuard` 行为（含 overlap 抛错信息）逐位一致 | E=200：1049–1078ns → 324–332ns，**delta 725–746ns/eval**（S3-D-3 已锚定含守卫的站点总成本 ~0.37ms，本条占站点 ~0.2%） | 淘汰：ns 级距落地线 ≥5 个量级 |
| S9-D-3 | `preparePromotion` 第二次 `review.candidateId !== candidate.candidateId` 比较消除（registry.ts:581——组合门（actorId/candidateId/contentHash，:569–575）对任何 candidateId 失配已先抛；两者之间只有 isPromotableStatus 检查、不改写比较操作数，故第二比较可证恒假。R1-D 顺带提过"保留为防御纵深"但从未获 ID/仿真——第九遍形式收口） | 省一次死字符串比较/promote | ✅ 死码可证：200 试次公开面故障 fuzz（正确/错 candidateId/错 actor/错 contentHash 四态轮换），第二比较的错误信息 `promotion review candidate does not match promotion candidate` **0 次浮出**（组合门信息 + 成功路径覆盖全部结果）；4000 试次局部孪生检查序逐位一致 | 死比较本体 **3.12–3.70ns**/promote（收益上界） | 淘汰：ns 级 + 纯代码卫生非性能项；作为防御纵深（若组合门未来被改窄，第二比较即活）零成本保留（S8-D-2/S6-D-3 成对纵深同族论证） |
| S9-D-4 | `assertNoForbiddenFields` 逐键 `toLowerCase` 消除（快路径守卫跳过折叠）。两形态：便宜形态 = 键无 ASCII 大写即跳过；健全形态 = 键为纯 ASCII 小写才跳过 | 省每键一次字符串分配 ×2 政策/eval | ❌ 便宜形态**确定性 fail-open 反例**：U+212A KELVIN SIGN 折叠为 "k"，键 `"api\u212Aey"`（无 ASCII 大写，守卫盲区）`toLowerCase()` === `"apikey"`——现行门抛 `routing-policy contains forbidden field apiKey`（fail-closed），便宜形态**静默放行**，凭据扫描门被绕过。✅ 健全形态 400 试次等价（含随机深度禁字段命中与 Unicode 键 naïve/İstanbul/Kelvin） | 配置态 9.2KB 政策：现行 16.30–16.35µs/walk、健全形态 17.71–18.12µs/walk——**delta −1.41~−1.77µs（更慢）**：真实键以 camelCase 为主（modelId/primaryModelId 均含大写必折叠），逐字符扫描纯开销叠加在折叠之上 | 淘汰（双杀）：便宜形态 = fail-open 自动否决族（授权指令点名家族，Unicode 大小写折叠是本轮新反例形态）；健全形态负收益。现行逐键无条件折叠即最优，凭据扫描门就此形式收口 |

## 3. 关键裁决细节

### S9-D-1：PIC 观察项在 D 切片的正面解答

授权指令要求盯 PIC 伪影（S8-A-3/S8-E-2/S8-H-1 族）。第九遍的新透镜
是把 S8-D-5 裁决时**刻意保持不变**的那个维度拎出来单独问：条件展开
的成本已裁（µs 噪声），但它产出的 **4 种隐藏类**（±taskFamily ×
±taskSuccess，真实数据集 70% 带 success、50% 带 family，四类混布）
对下游是不是独立成本？仿真答案：是——E=200 下游消费
（replayAssignments 尾部 + pairedRecords）单态形状比四类混布快
~6–7µs，构造侧再省 ~7µs，合计 12.8–13.9µs/eval。合法性论证三条腿：
`RoutingEvalEpisode` 未导出（模块私有，本轮 grep 证明无键枚举
消费者）；两处 `??` 回退对"键缺席"与"键在值 undefined"语义相同；
actions/records 及 rerunHash 序列化字节逐位恒等（stableStringify +
hash32 双重验证）。但绝对份额是 µs——端到端 0.3–0.4%，距落地线
≥3 个量级，与 S8-D-5 同带。**结论：D 切片的 PIC 伪影真实存在但
不构成落地项，观察项就此收口**；重开条件与 S8-D-5 绑定（E 增长
≥3–4 个量级时二者应一并重估，且届时先做 S9-D-1 的形状单态化再谈
S8-D-5 的构造消除，收益叠加方向一致）。

### S9-D-3：死码的形式收口而非重开

R1-D 当年顺带写过第二比较"保留为防御纵深"，但从未给 ID、从未仿真
——严格说这是历史欠账而非新角度，本轮补上形式裁决避免后轮重复
发现。死性证明：组合门（:569–575）对 `review.candidateId !==
candidate.candidateId` 已抛错；两断言之间只有 `isPromotableStatus`
状态检查，不改写 review 或 candidate；故第二比较（:581）可证恒假。
公开面 200 试次故障 fuzz 中其错误信息 0 次浮出。裁决维持 R1-D 的
方向但换了理由权重：不是"防御纵深值得 3ns"（那是修辞），而是
**收益上界 3.12–3.70ns 使消除在任何落地线下都无意义**，而保留成本
为零且在组合门未来被改窄时自动复活。纯代码卫生项，非性能项，不再
占用后轮枚举预算。

### S9-D-4：Unicode 大小写折叠是 fail-open 反例的新形态

八轮反例族（篡改载入、崩溃写序、失败路径混合态、别名泄漏）之外，
本轮出现第一个 **Unicode 语义反例**：`String.prototype.toLowerCase`
按 Unicode 简单小写映射折叠，U+212A KELVIN SIGN（K）→ "k"、
U+0130 İ → i̇ 等映射使"键无 ASCII 大写 ⇒ 折叠是恒等"这一直觉
**为假**。便宜快路径（`hasAsciiUpper(key) ? key.toLowerCase() : key`）
对 `"api\u212Aey"` 走盲区：守卫扫不到 ASCII 大写故跳过折叠，
`FORBIDDEN_POLICY_FIELDS.has("api\u212Aey")` 为假——**凭据字段扫描
门静默放行**，而现行无条件折叠正确抛 forbidden field。健全形态
（纯 ASCII 小写才跳过）无此洞（非 ASCII 一律折叠），400 试次含
Unicode 键 fuzz 与现行逐位一致——但真实政策键是 camelCase
（modelId/primaryModelId/taskFamily 均含大写），必然付"扫描 +
折叠"双份成本，实测比现行**慢 1.41–1.77µs/walk**：JS 层逐字符
扫描的开销超过短 ASCII 串 toLowerCase 内建的节省。两形态各自
独立死刑：便宜形态 fail-open 自动否决，健全形态负收益。**现行
"每键无条件 toLowerCase"就是该门的最优实现**，后轮不必再碰。

### §1d：promote/rollback 配置态 op 格的意义

矩阵方法论（R7-I）的要点是"配置态可能藏着默认态夹具掩盖的主路径"。
R8-D 证明 eval/load/save 三格无悬崖；本轮 promote op 格给出同向
答案且给出**成本构成**：46.1–47.7µs 中 ~60% 是门链 3 次 9.2KB
哈希（9.6–9.8µs/次）——政策再涨一个量级（92KB）op 也只到
~0.3ms，仍被 load+save（配置态 ≥2.2ms）支配；rollback op 3.2–3.7µs
与政策规模无关（纯指针/账目）。矩阵至此**四命令类 × 两状态全格
闭合**，该维度不再是后轮的必查项（除非 E 或状态规模跨量级增长，
见 §7）。

## 4. 逐文件收口（第九遍新检查点，叠加 R1-D..R8-D 收口）

| 文件 | 本轮新检查点 | 结论 |
| --- | --- | --- |
| `registry.ts` | 见 S9-D-3（preparePromotion 第二 candidateId 比较：死码形式收口，3.1–3.7ns 上界，零成本保留）与 §1d（配置态 promote op 46.1–47.7µs 分解：门链哈希 ~60% = X1-1 契约价格）；S8-D-1/2/4、S7-D-1/4、S6-D-1/2、S5-D-3、S1-D-5 维持 | 无候选落地 |
| `promotion.ts` | §1（save+fsync 0.60–0.63ms 本 VM 重锚）；S8-D-3 fsync 域、S7-D-3、S6-D-4 维持——save 分解在 R8-D 已闭合，本轮无新成分 | 无候选 |
| `promotion-rules.ts` | §1d：`assertRoutingPolicyEvalReport` 重哈希实测进入 promote op 格（门链 3 哈希之一）；X1-1 域维持 | 无候选 |
| `candidate.ts` | `hashCandidateContent` 9.2KB 政策单次 9.6–9.8µs（§1d 门链分母）；R8-D 的 2.53–2.59ms/MB 包络维持 | 无候选 |
| `eval-routing.ts` | 见 S9-D-1（parseEpisode 形状单态化 = PIC 观察项正面解答，12.8–13.9µs 淘汰）、S9-D-2（roots 构造融合 725–746ns 淘汰）、S9-D-4（forbidden-fields toLowerCase：便宜形态 Kelvin 反例 fail-open / 健全形态负收益——门就此形式收口）；§1c 配置态复测无悬崖；S8-D-5、S7-D-2/5、S6-D-3/5、S1-D-4/9、S2-D-3/4、S3-D-3、S4-D-3/5、S5-D-2/4 全部维持不重开 | 无候选落地 |
| `pareto.ts` | 第九遍无新角度（S1-D-6/S3-D-2 维持；生产无调用方，§0 grep 首手复核） | 无候选 |
| `rollback.ts` | §1d：rollback op 3.2–3.7µs 配置态首锚（政策规模无关）；S8-D-4、S3-D-4/S4-D-2 维持 | 无候选 |
| `resource.ts` / `retirement.ts` / `active-pointer.ts` | 常量表 + O(1) 谓词 / 薄委托（调用方仅 registry 切片内）/ O(1) 纯函数——第九遍无新角度；S5-D-5 维持 | 无候选 |
| `monitor.ts` | **X2-5 维持排除未触碰**；S2-D-5/S3-D-5 维持；生产无调用方（§0 grep 首手复核），矩阵 monitor 格 N/A | 无候选 |
| `approval-profile.ts` | S4-D-4 维持；`isAutoAdaptEnabled` 每次读 env 是 kill-switch 语义（X1-1 域） | 无候选 |
| `reflection.ts` | §1b：shadow 121.8–123.3ms 落在 R8-D 带内（被调方零字节变更的同 VM 重锚）；本体只做校验+委托；生产无调用方 | 无候选 |
| `mutate.ts` | `adjustParameter`/`replaceSection` 维持「记录不改」；每次新建正则 = X0-6 安全侧；生产无调用方（§0 grep） | 无候选 |

## 5. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 6. 测试

零代码改动下相关套件基线复核，全绿（Node 22，pnpm）：

```bash
npx tsx --test "test/unit/adaptation/**/*.test.ts" "test/acceptance/adaptive-loop.test.ts"
# tests 101 / suites 11 / pass 101 / fail 0
pnpm typecheck && pnpm lint && pnpm build   # 全绿
```

仿真（临时脚本，未入库——无赢家不落死代码；完整源码见附录，seeds
`0xd99d01`–`0xd99d06`，两次独立运行等价/反例结论逐位一致、计时抖动
范围内稳定）：

```text
S0 default anchors: registry load=0.10–0.13ms save(+fsync)=0.60–0.63ms | adapt-eval end-to-end (E=200, toy policy)=4.33–4.41ms per invocation
S0b evaluateProposalShadow through S7-F-1/S7-F-2 shadow.ts+plan.ts: P=200 A=100 -> 1.4ms | P=2000 A=1000 -> 121.8–123.3ms per call
S0c configured anchors (registry.json=146.2KB, V=15 C=9 L=11 B=18 blobs=119.5KB, policy=9.2KB): load=0.61–0.65ms save(+fsync)=1.63–1.82ms | adapt-eval end-to-end (E=200, configured policy)=3.65–3.69ms per invocation
S0d configured op-only anchors (K=60): promote op=46.1–47.7us | rollback(user CAS) op=3.2–3.7us | single hash32 over the 9.2KB policy=9.6–9.8us (x3 on the promote gate chain)
S9-D-1 bench E=200: construct current=41.0–41.8us mono=33.9–35.0us | consume(actions+records) current=26.7–26.8us mono=19.6–21.1us | combined delta/eval-invocation=12.8–13.9us
S9-D-2 bench E=200: current(map+spread)=1049–1078ns fused=324–332ns delta/eval-invocation=725–746ns
S9-D-3 deadness fuzz: second-compare message surfaced 0 times across 200 public-surface fault trials; anchor: one dead string compare = 3.12–3.70ns per promote (upper bound of any gain)
S9-D-4 counterexample (key "api\u212Aey" = api+KELVIN SIGN, folds to "apikey"): current -> "routing-policy contains forbidden field apiKey" (fail-closed) | unsound fast-path variant -> <pass> (fail-open through the forbidden-field scrub) | sound variant -> matches current
S9-D-4 bench configured 9.2KB policy: current=16.30–16.35us sound-variant=17.71–18.12us delta/walk=-1.41 to -1.77us (sound variant SLOWER; camelCase keys pay scan+fold)
ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)
```

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S9-D-1 | `parseEpisode` 输出形状单态化（可选键恒在，4 隐藏类 → 1） | 下游字节面可证等价（模块私有形状、`??` 读取、actions/records/rerunHash 逐位恒等），构造+消费两侧均实测改善，但合计 12.8–13.9µs/eval = 端到端 0.3–0.4%，距落地线 ≥3 个量级；PIC 观察项（S8-A-3/S8-E-2/S8-H-1）在 D 切片的正面解答，与 S8-D-5 绑定重开（E 增长 ≥3–4 个量级时一并重估，先形状后构造） |
| S9-D-2 | `assertReplayIsolated` roots 构造融合（map+spread → 单遍预分配） | 等价可证（元素同序、守卫行为含 overlap 抛错逐位一致），725–746ns/eval，距落地线 ≥5 个量级；≠ S3-D-3（内容去重），站点总成本 ~0.37ms 由守卫支配 |
| S9-D-3 | `preparePromotion` 第二次 `review.candidateId` 比较消除 | 死码可证（组合门先抛 + 中间检查不改操作数；公开面 200 故障 fuzz 第二信息 0 次浮出），但收益上界 3.12–3.70ns/promote——任何落地线下无意义；零成本保留为组合门被改窄时的自动后备（R1-D 历史欠账形式收口，纯代码卫生非性能项） |
| S9-D-4 | `assertNoForbiddenFields` 逐键 toLowerCase 消除（快路径守卫） | 双杀：便宜形态（无 ASCII 大写即跳过）有确定性 Unicode 反例——U+212A KELVIN SIGN 折叠为 "k"，`"api\u212Aey"` 绕过凭据字段扫描门 fail-open（自动否决族新形态）；健全形态（纯 ASCII 小写才跳过）实测**更慢** 1.41–1.77µs/walk（camelCase 键付扫描+折叠双份）。现行无条件折叠即最优，门形式收口 |

重开条件：S9-D-1 与 S8-D-5 绑定——E 增长 ≥3–4 个量级时一并重估
（先单态化后构造消除，收益同向叠加）；S9-D-2 需 E 增长 ≥5 个量级；
S9-D-3 永不作为性能项重开（若做非性能代码卫生轮由父代决策）；
S9-D-4 便宜形态永不重开（fail-open），健全形态需键分布变为纯小写
主导**且** walk 规模跨量级增长（当前负收益）。整片层面：唯一可能
改变预算论证的仍是 E 增长 ≥2 个量级（继承 R3-D §6 … R8-D §7，届时
首先重开的是 S6-D-5 的 ~45ms 外推单项，而非本轮任何候选）；配置态
维度经 §1c 复测 + §1d 补格后**四命令类 × 两状态矩阵全格闭合**，
后轮无需再查（状态规模跨量级增长除外——政策/registry 再涨 1 个
量级也只把 load/save 推到低两位数 ms 且全部是切片外 JSON/I-O 固有
成本，promote op 门链哈希外推 ~0.3ms 仍被支配）。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为仓库外任意 `.mts` 后 `npx tsx <file>`（顶层 await 需
ESM，`.mts` 强制 tsx 走 ESM；依赖已装）。seeds：`0xd99d01`–`0xd99d06`。

```ts
/**
 * R9-D deterministic equivalence + benchmark simulation (ninth pass).
 * Adjudicates fresh candidates S9-D-1 .. S9-D-4 against the current
 * implementations in src/adaptation/, re-verifies the R3-D..R8-D whole-slice
 * budget-domination argument with end-to-end anchors (default AND configured
 * state per the R7-I lesson), closes the two configured-state x command-class
 * matrix cells R8-D did not anchor (promote / rollback op-only costs), and
 * re-measures evaluateProposalShadow through the S7-F-1/S7-F-2
 * experiments/{shadow,plan}.ts callees.
 * Seeded PRNG (mulberry32) -> reproducible. Seeds: 0xd99d01 - 0xd99d06.
 */
import { performance } from "node:perf_hooks";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResourceRegistry } from "/workspace/src/adaptation/registry.js";
import {
  promoteWithRegistry,
  loadAdaptationRegistry,
  saveAdaptationRegistry,
  adaptationRegistryPath,
  type PromoteInput,
  type PromotionReview,
  type ChangeNote
} from "/workspace/src/adaptation/promotion.js";
import { evalRoutingPolicy, parseRoutingEvalReport } from "/workspace/src/adaptation/eval-routing.js";
import { evaluateProposalShadow } from "/workspace/src/adaptation/reflection.js";
import { hashCandidateContent, type EvaluationPlan, type ImprovementCandidate } from "/workspace/src/adaptation/candidate.js";
import type { AuthorIdentity, ResourceIdentity, ResourceVersion } from "/workspace/src/adaptation/resource.js";
import { createProjectId, parseTaskId, type CandidateId, type IdGenerator, type ResourceVersionId } from "/workspace/src/domain/ids.js";
import type { IsoTimestamp } from "/workspace/src/domain/timestamp.js";
import { DomainValidationError } from "/workspace/src/domain/errors.js";
import { isAgentRole, type AgentRole } from "/workspace/src/domain/roles.js";
import { isRecord } from "/workspace/src/domain/record.js";
import { hash32 } from "/workspace/src/domain/hash.js";
import { createIsolationGuard } from "/workspace/src/experiments/isolation.js";
import { stableStringify } from "/workspace/src/experiments/manifest.js";
import type { ExperimentPlan } from "/workspace/src/experiments/plan.js";
import type { ExperimentOutcome } from "/workspace/src/experiments/shadow.js";
import { parseLearnedRoutingPolicy, type LearnedRoutingPolicy } from "/workspace/src/learning/learned-routing.js";
import { assignTasks } from "/workspace/src/routing/assign.js";
import { catalogFromPrimary } from "/workspace/src/routing/primary-catalog.js";
import type { ModelRouterConfig } from "/workspace/src/supervisor/model-router.js";

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

const NOW = "2026-08-24T12:00:00.000Z" as IsoTimestamp;
const HUMAN: AuthorIdentity = { kind: "human", identity: "operator" };
const EVAL_PLAN: EvaluationPlan = { stages: ["static", "replay"], metrics: ["utility"], planVersion: 1 };

function sequentialIds(prefix: string): IdGenerator {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}${String(n).padStart(4, "0")}`;
  };
}

const BASELINE_POLICY = JSON.stringify({ primaryModelId: "premium", avoid: [], prefer: [] });
const CANDIDATE_POLICY = JSON.stringify({
  primaryModelId: "premium",
  avoid: [{ modelId: "fast", family: "edit", reason: "deterministic FAIL on edit replay" }],
  prefer: [{ family: "test", modelId: "fast" }]
});

/* Configured-state policies (R7-I lesson; same generator as R8-D §0c). */
function configuredPolicy(variantTag: string): string {
  const avoid = Array.from({ length: 40 }, (_, i) => ({
    modelId: i % 8 === 0 ? "cheap" : `m${i % 7}`,
    family: i % 3 === 0 ? pick(() => (i % 10) / 10, ["edit", "test", "review"]) : `fam${i % 12}`,
    reason: `deterministic FAIL pattern ${i} (${variantTag}): attributable replay regression observed across paired episodes with stable family-level attribution`
  }));
  const prefer = Array.from({ length: 40 }, (_, i) => ({
    family: i % 4 === 0 ? "test" : `fam${i % 12}`,
    modelId: i % 4 === 0 ? "cheap" : `m${(i + 1) % 7}`
  }));
  const assignments = Array.from({ length: 7 }, (_, i) => ({
    role: ["planner", "executor", "tester", "reviewer", "scout", "debugger", "worker"][i] as string,
    model: i % 2 === 0 ? "premium" : "cheap",
    family: ["edit", "test", "review"][i % 3] as string
  }));
  if (variantTag === "candidate") {
    avoid.push({ modelId: "cheap", family: "refactor", reason: "candidate-only: deterministic FAIL on refactor replay (new attribution)" });
  }
  return JSON.stringify({ primaryModelId: "premium", avoid, prefer, assignments });
}
const CONFIGURED_BASELINE_POLICY = configuredPolicy("baseline");
const CONFIGURED_CANDIDATE_POLICY = configuredPolicy("candidate");

const ROLES = ["worker", "scout", "planner", "implementer", "reviewer", "tester", "debugger"] as const;
const OBJECTIVES = [
  "Fix the failing unit test in the adapter and rerun the suite",
  "Refactor the retry helper to remove duplicated backoff logic",
  "Review the migration PR for schema drift and unsafe defaults",
  "Investigate why the nightly benchmark regressed on large inputs",
  "Plan the rollout of the new caching layer across services"
];

function mkReview(candidateId: CandidateId, contentHash: string, tag: string): PromotionReview {
  return {
    reviewId: `rv-${tag}`,
    candidateId,
    contentHash,
    verdict: "approved",
    reviewerKind: "independent",
    reviewerId: "critic-gate",
    actorId: HUMAN.identity,
    evidenceRefs: [`review:${tag}`]
  };
}

function mkNote(scope: string, rollbackVersionId: ResourceVersionId): ChangeNote {
  return {
    scope,
    evidence: ["static"],
    guardrails: ["proposal-first"],
    rollbackVersionId
  };
}

function buildRoutingRegistry(
  tag: string,
  baselinePolicy = BASELINE_POLICY,
  candidatePolicy = CANDIDATE_POLICY
): { registry: ResourceRegistry; candidateId: CandidateId; baseline: ResourceVersion; identity: ResourceIdentity } {
  const registry = new ResourceRegistry({ now: () => NOW, generateId: sequentialIds(tag) });
  const identity: ResourceIdentity = {
    kind: "routing-policy",
    name: "learned-routing",
    scope: { kind: "project", projectId: createProjectId(() => `${tag}proj`) }
  };
  const baseline = registry.registerBaseline({ identity, content: baselinePolicy, author: HUMAN });
  const candidate = registry.createCandidate({
    identity,
    content: candidatePolicy,
    parentVersionId: baseline.versionId,
    author: HUMAN,
    evaluationPlan: EVAL_PLAN
  });
  return { registry, candidateId: candidate.candidateId, baseline, identity };
}

/* Configured-state registry (same construction as R8-D §0c). */
function buildConfiguredRegistry(tag: string): {
  registry: ResourceRegistry;
  candidateId: CandidateId;
  baseline: ResourceVersion;
  identity: ResourceIdentity;
} {
  const built = buildRoutingRegistry(tag, CONFIGURED_BASELINE_POLICY, CONFIGURED_CANDIDATE_POLICY);
  const { registry } = built;
  const versions: { identity: ResourceIdentity; v1: ResourceVersion; v2?: ResourceVersion }[] = [];
  for (let i = 0; i < 8; i += 1) {
    const identity: ResourceIdentity = {
      kind: "prompt",
      name: `agent-prompt-${i}`,
      scope: { kind: "project", projectId: createProjectId(() => `${tag}proj`) }
    };
    const body = `# prompt ${i}\n${`Follow the review checklist, cite evidence for every claim, and keep the diff bounded to the stated scope (${i}).\n`.repeat(30 + i * 8)}`;
    const v1 = registry.registerBaseline({ identity, content: body, author: HUMAN });
    const candidate = registry.createCandidate({
      identity,
      content: `${body}\n## amendment ${i}\nAdd an explicit check for the attributable failure.\n`,
      parentVersionId: v1.versionId,
      author: HUMAN,
      evaluationPlan: EVAL_PLAN
    });
    const entry: { identity: ResourceIdentity; v1: ResourceVersion; v2?: ResourceVersion } = { identity, v1 };
    if (i < 5) {
      const result = promoteWithRegistry(registry, {
        candidateId: candidate.candidateId,
        expectedCurrentVersionId: v1.versionId,
        content: `${body}\n## amendment ${i}\nAdd an explicit check for the attributable failure.\n`,
        approvedBy: HUMAN,
        review: mkReview(candidate.candidateId, candidate.contentHash, `${tag}p${i}`),
        changeNote: mkNote(`prompt:${tag}${i}`, v1.versionId),
        explicitApproval: true
      });
      entry.v2 = result.newVersion as ResourceVersion;
    } else if (i === 5) {
      registry.beginPromotion({
        candidateId: candidate.candidateId,
        expectedCurrentVersionId: v1.versionId,
        content: `${body}\n## amendment ${i}\nAdd an explicit check for the attributable failure.\n`,
        approvedBy: HUMAN,
        review: mkReview(candidate.candidateId, candidate.contentHash, `${tag}p${i}`),
        changeNote: mkNote(`prompt:${tag}${i}`, v1.versionId),
        explicitApproval: true
      });
    }
    versions.push(entry);
  }
  const first = versions[0] as { identity: ResourceIdentity; v1: ResourceVersion; v2?: ResourceVersion };
  registry.rollback({
    identity: first.identity,
    expectedCurrentVersionId: (first.v2 as ResourceVersion).versionId,
    targetVersionId: first.v1.versionId,
    reason: "degradation",
    evidence: ["ev:configured-degradation"],
    automatic: false
  });
  const second = versions[1] as { identity: ResourceIdentity; v1: ResourceVersion; v2?: ResourceVersion };
  registry.rollback({
    identity: second.identity,
    expectedCurrentVersionId: (second.v2 as ResourceVersion).versionId,
    targetVersionId: second.v1.versionId,
    reason: "user",
    evidence: ["ev:configured-user"],
    automatic: false
  });
  registry.retire((versions[2] as { v1: ResourceVersion }).v1.versionId);
  registry.retire((versions[3] as { v1: ResourceVersion }).v1.versionId);
  return built;
}

async function writeDataset(dir: string, episodes: number, rng: () => number): Promise<void> {
  await mkdir(dir, { recursive: true });
  const eps = Array.from({ length: episodes }, (_, i) => ({
    episodeHash: `eh_${i}`,
    taskId: `tsk_e${i}`,
    role: pick(rng, ROLES),
    objective: pick(rng, OBJECTIVES),
    originalWorkspace: "/repos/alpha",
    ...(rng() < 0.7 ? { taskSuccess: rng() < 0.5 ? "PASS" : "FAIL" } : {}),
    ...(rng() < 0.5 ? { taskFamily: pick(rng, ["edit", "test", "review"]) } : {})
  }));
  const manifest = { datasetId: "ds-r9d", environmentVersion: "env-1", episodes: eps };
  await writeFile(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/* ============================================================
 * Section 0: whole-slice budget re-verification, default-state anchors.
 * ============================================================ */
const workRoot = await mkdtemp(join(tmpdir(), "r9d-sim-"));
let configuredEvalReport: ReturnType<typeof parseRoutingEvalReport> | undefined;
{
  const rng = mulberry32(0xd99d01);
  const stateRoot = join(workRoot, "state");
  const { registry } = buildRoutingRegistry("b0");
  await saveAdaptationRegistry(stateRoot, registry);
  const datasetDir = join(workRoot, "dataset");
  await writeDataset(datasetDir, 200, rng);

  const loadMs = await benchAsync(async () => {
    await loadAdaptationRegistry(stateRoot);
  }, 30);
  const saveMs = await benchAsync(async () => {
    await saveAdaptationRegistry(stateRoot, registry);
  }, 30);

  const { registry: r2, candidateId } = buildRoutingRegistry("b1");
  await saveAdaptationRegistry(stateRoot, r2);
  const evalMs = await benchAsync(async () => {
    await evalRoutingPolicy({ stateRoot, candidateId, datasetDir });
  }, 20);
  console.log(
    `S0 default anchors: registry load=${loadMs.toFixed(2)}ms save(+fsync)=${saveMs.toFixed(2)}ms | adapt-eval end-to-end (E=200, toy policy)=${evalMs.toFixed(2)}ms per invocation`
  );
}

/* ============================================================
 * Section 0b: evaluateProposalShadow wall clock through the
 * S7-F-1/S7-F-2-landed experiments/{shadow,plan}.ts (callee-side domain;
 * measured only to keep the post-S7-F profile anchored on this VM).
 * ============================================================ */
{
  const mkPlan = (p: number, a: number): ExperimentPlan => ({
    planVersion: 1,
    experimentId: "exp_r9d-shadow",
    mode: "shadow",
    baselineVersionId: "rsv_r9d0001" as ResourceVersionId,
    candidateId: "cnd_r9d0002" as CandidateId,
    population: Array.from({ length: p }, (_, i) => `eh_${i}`),
    metrics: ["utility"],
    thresholds: { maxGuardrailBreaches: 1000000, maxCostUsd: 1e9 },
    budget: { maxAssignments: a + 1, maxWallClockMs: 1000000000 },
    randomization: { seed: 7 },
    stopPolicy: { onGuardrail: "halt", onBudgetExhausted: "halt" },
    missingOutcomePolicy: "exclude"
  });
  const mkOutcomes = (a: number): ExperimentOutcome[] =>
    Array.from({ length: a }, (_, i) => ({
      episodeHash: `eh_${i}`,
      utility: i % 2,
      costUsd: 0.001,
      guardrailBreached: false
    }));
  for (const [p, a, reps] of [
    [200, 100, 20],
    [2000, 1000, 3]
  ] as const) {
    const plan = mkPlan(p, a);
    const outcomes = mkOutcomes(a);
    const state = evaluateProposalShadow(plan, outcomes, 0);
    check(`S0b shadow run completes without halt (P=${p},A=${a})`, !state.halted && state.outcomes.length === a);
    const ms = bench(() => {
      evaluateProposalShadow(plan, outcomes, 0);
    }, reps);
    console.log(
      `S0b evaluateProposalShadow through S7-F-1/S7-F-2 shadow.ts+plan.ts: P=${p} A=${a} -> ${ms.toFixed(1)}ms per call (test-only; per-step restore cost is callee-side)`
    );
  }
}

/* ============================================================
 * Section 0c: configured-state anchors (R8-D §0c replica on this VM):
 * 9.2KB learned policy + KB-scale registry -> load / save / eval E=200.
 * ============================================================ */
{
  const rng = mulberry32(0xd99d02);
  const stateRoot = join(workRoot, "state-configured");
  const { registry, candidateId } = buildConfiguredRegistry("c0");
  await saveAdaptationRegistry(stateRoot, registry);
  const snapshot = registry.snapshot();
  const contents = snapshot.contents ?? [];
  const totalBlobBytes = contents.reduce((sum, blob) => sum + blob.content.length, 0);
  const datasetDir = join(workRoot, "dataset-configured");
  await writeDataset(datasetDir, 200, rng);

  const loadMs = await benchAsync(async () => {
    await loadAdaptationRegistry(stateRoot);
  }, 30);
  const saveMs = await benchAsync(async () => {
    await saveAdaptationRegistry(stateRoot, registry);
  }, 30);
  const evalMs = await benchAsync(async () => {
    await evalRoutingPolicy({ stateRoot, candidateId, datasetDir });
  }, 20);
  const result = await evalRoutingPolicy({ stateRoot, candidateId, datasetDir });
  configuredEvalReport = parseRoutingEvalReport(result.report);
  const { readFile } = await import("node:fs/promises");
  const raw = await readFile(adaptationRegistryPath(stateRoot), "utf8");
  console.log(
    `S0c configured anchors (registry.json=${(raw.length / 1024).toFixed(1)}KB, V=${snapshot.versions.length} C=${snapshot.candidates.length} L=${snapshot.ledger.length} B=${contents.length} blobs=${(totalBlobBytes / 1024).toFixed(1)}KB, policy=${(CONFIGURED_CANDIDATE_POLICY.length / 1024).toFixed(1)}KB): load=${loadMs.toFixed(2)}ms save(+fsync)=${saveMs.toFixed(2)}ms | adapt-eval end-to-end (E=200, configured policy)=${evalMs.toFixed(2)}ms per invocation`
  );
}

/* ============================================================
 * Section 0d (NEW matrix cells): configured-state promote and rollback
 * OP-ONLY costs. R8-D anchored the configured eval/load/save cells; the
 * promote and rollback command classes were never anchored in configured
 * state. Both commands are load -> op -> save; the op cell is measured here
 * in isolation (the load/save floors above bound the rest). The promote op
 * includes the full routing-policy gate chain: 3x hashCandidateContent over
 * the 9.2KB policy (promoteWithRegistry outer assert + preparePromotion
 * assert + putContent — X1-1/S1-D-7 adjudicated CAS fail-closed contract)
 * plus validateComparisonReport on the real eval report.
 * ============================================================ */
{
  const report = configuredEvalReport;
  check("S0d setup: configured eval report available", report !== undefined);
  const K = 60;
  const promoteFixtures = Array.from({ length: K }, (_, i) => {
    const { registry, candidateId, baseline } = buildConfiguredRegistry(`pm${i}x`);
    const candidate = registry.getCandidate(candidateId) as ImprovementCandidate;
    const input: PromoteInput = {
      candidateId,
      expectedCurrentVersionId: baseline.versionId,
      content: CONFIGURED_CANDIDATE_POLICY,
      approvedBy: HUMAN,
      review: mkReview(candidateId, candidate.contentHash, `pm${i}`),
      changeNote: mkNote(`routing:pm${i}`, baseline.versionId),
      explicitApproval: true,
      evalReport: {
        ...(report as NonNullable<typeof report>),
        candidateId,
        contentHash: candidate.contentHash
      }
    };
    return { registry, input };
  });
  const t0 = performance.now();
  const promoted: { registry: ResourceRegistry; newVersion: ResourceVersion; identity: ResourceIdentity; baselineId: ResourceVersionId }[] = [];
  for (const fixture of promoteFixtures) {
    const result = promoteWithRegistry(fixture.registry, fixture.input);
    promoted.push({
      registry: fixture.registry,
      newVersion: result.newVersion as ResourceVersion,
      identity: (result.newVersion as ResourceVersion).identity,
      baselineId: fixture.input.expectedCurrentVersionId
    });
  }
  const promoteUs = ((performance.now() - t0) / K) * 1e3;
  check("S0d all configured promotes succeeded", promoted.length === K && promoted.every((p) => p.newVersion !== undefined));

  const t1 = performance.now();
  for (const p of promoted) {
    p.registry.rollback({
      identity: p.identity,
      expectedCurrentVersionId: p.newVersion.versionId,
      targetVersionId: p.baselineId,
      reason: "user",
      evidence: ["ev:r9d-op-anchor"],
      automatic: false
    });
  }
  const rollbackUs = ((performance.now() - t1) / K) * 1e3;
  const hashUs = bench(() => {
    hashCandidateContent(CONFIGURED_CANDIDATE_POLICY);
  }, 3000) * 1e3;
  console.log(
    `S0d configured op-only anchors (K=${K}): promote op=${promoteUs.toFixed(1)}us | rollback(user CAS) op=${rollbackUs.toFixed(1)}us | single hash32 over the ${(CONFIGURED_CANDIDATE_POLICY.length / 1024).toFixed(1)}KB policy=${hashUs.toFixed(1)}us (x3 on the promote gate chain)`
  );
}

/* ============================================================
 * Shared replicas of the eval-routing internals used by S9-D-1 / S9-D-2.
 * parseEpisodeCurrent is a VERBATIM copy of the current parseEpisode.
 * ============================================================ */
interface EpisodeShape {
  readonly episodeHash: string;
  readonly taskId: string;
  readonly role: AgentRole;
  readonly objective: string;
  readonly taskFamily?: string | undefined;
  readonly taskSuccess?: "PASS" | "FAIL" | undefined;
  readonly originalWorkspace: string;
}
function validateEpisodeFields(value: unknown, index: number): {
  episodeHash: string; taskId: string; role: AgentRole; objective: string;
  originalWorkspace: string; taskFamily: string | undefined; taskSuccess: "PASS" | "FAIL" | undefined;
} {
  if (!isRecord(value)) {
    throw new DomainValidationError(`dataset episodes[${index}] must be an object`);
  }
  if (typeof value.episodeHash !== "string" || value.episodeHash.trim() === "") {
    throw new DomainValidationError(`dataset episodes[${index}] requires episodeHash`);
  }
  if (typeof value.taskId !== "string") {
    throw new DomainValidationError(`dataset episodes[${index}] requires taskId`);
  }
  parseTaskId(value.taskId);
  if (!isAgentRole(value.role)) {
    throw new DomainValidationError(`dataset episodes[${index}] has invalid role`);
  }
  if (typeof value.objective !== "string" || value.objective.trim() === "") {
    throw new DomainValidationError(`dataset episodes[${index}] requires objective`);
  }
  if (typeof value.originalWorkspace !== "string" || value.originalWorkspace.trim() === "") {
    throw new DomainValidationError(`dataset episodes[${index}] requires originalWorkspace`);
  }
  let taskSuccess: "PASS" | "FAIL" | undefined;
  if (value.taskSuccess !== undefined) {
    if (value.taskSuccess !== "PASS" && value.taskSuccess !== "FAIL") {
      throw new DomainValidationError(
        `dataset episodes[${index}] taskSuccess must be PASS or FAIL when present`
      );
    }
    taskSuccess = value.taskSuccess;
  }
  const taskFamily =
    typeof value.taskFamily === "string" && value.taskFamily.trim() !== ""
      ? value.taskFamily
      : undefined;
  return {
    episodeHash: value.episodeHash,
    taskId: value.taskId,
    role: value.role,
    objective: value.objective,
    originalWorkspace: value.originalWorkspace,
    taskFamily,
    taskSuccess
  };
}
/** Verbatim tail of the current parseEpisode: conditional spreads, 4 hidden classes. */
function parseEpisodeCurrent(value: unknown, index: number): EpisodeShape {
  const f = validateEpisodeFields(value, index);
  return {
    episodeHash: f.episodeHash,
    taskId: f.taskId,
    role: f.role,
    objective: f.objective,
    originalWorkspace: f.originalWorkspace,
    ...(f.taskFamily !== undefined ? { taskFamily: f.taskFamily } : {}),
    ...(f.taskSuccess !== undefined ? { taskSuccess: f.taskSuccess } : {})
  };
}
/** S9-D-1 variant: always-present optional keys -> one hidden class. */
function parseEpisodeMono(value: unknown, index: number): EpisodeShape {
  const f = validateEpisodeFields(value, index);
  return {
    episodeHash: f.episodeHash,
    taskId: f.taskId,
    role: f.role,
    objective: f.objective,
    originalWorkspace: f.originalWorkspace,
    taskFamily: f.taskFamily,
    taskSuccess: f.taskSuccess
  };
}

interface ReplayActionShape {
  readonly episodeHash: string;
  readonly taskFamily: string;
  readonly taskSuccess: "PASS" | "FAIL" | "UNOBSERVED";
  readonly baselineModel: string;
  readonly candidateModel: string;
  readonly baselineCostUsd: number;
  readonly candidateCostUsd: number;
}
interface PairedRecordShape {
  readonly episodeHash: string;
  readonly taskFamily: string;
  readonly baselineUtility: number;
  readonly candidateUtility: number;
  readonly baselineCostUsd: number;
  readonly candidateCostUsd: number;
}
function catalogCostReplica(catalog: ModelRouterConfig, modelId: string): number {
  const model = catalog.models.find((entry) => entry.id === modelId);
  if (model === undefined) {
    throw new DomainValidationError(`selected model ${modelId} is not in the catalog`);
  }
  return model.estimatedCostUsd;
}
type Assignments = ReturnType<typeof assignTasks>;
/** Verbatim consumption pipeline (replayAssignments tail + pairedRecords), one copy per variant so ICs are variant-local. */
function makeConsumer(): (
  episodes: readonly EpisodeShape[],
  catalog: ModelRouterConfig,
  baseline: Assignments,
  candidate: Assignments
) => { actions: ReplayActionShape[]; records: PairedRecordShape[] } {
  return (episodes, catalog, baseline, candidate) => {
    const actions = episodes.map((episode, index) => {
      const baselineAssignment = baseline[index];
      const candidateAssignment = candidate[index];
      if (baselineAssignment === undefined || candidateAssignment === undefined) {
        throw new DomainValidationError(`missing assignment for ${episode.episodeHash}`);
      }
      return {
        episodeHash: episode.episodeHash,
        taskFamily: episode.taskFamily ?? baselineAssignment.analysis.family,
        taskSuccess: episode.taskSuccess ?? ("UNOBSERVED" as const),
        baselineModel: baselineAssignment.decision.model,
        candidateModel: candidateAssignment.decision.model,
        baselineCostUsd: catalogCostReplica(catalog, baselineAssignment.decision.model),
        candidateCostUsd: catalogCostReplica(catalog, candidateAssignment.decision.model)
      };
    });
    const records: PairedRecordShape[] = [];
    for (const [index, episode] of episodes.entries()) {
      if (episode.taskSuccess !== "PASS" && episode.taskSuccess !== "FAIL") {
        continue;
      }
      const action = actions[index];
      if (action === undefined) {
        throw new DomainValidationError(`missing replay action for ${episode.episodeHash}`);
      }
      const utility = episode.taskSuccess === "PASS" ? 1 : 0;
      records.push({
        episodeHash: episode.episodeHash,
        taskFamily: episode.taskFamily ?? action.taskFamily,
        baselineUtility: utility,
        candidateUtility: utility,
        baselineCostUsd: action.baselineCostUsd,
        candidateCostUsd: action.candidateCostUsd
      });
    }
    return { actions, records };
  };
}

/* ============================================================
 * S9-D-1: parseEpisode output-shape monomorphization (always-present
 * optional keys). The PIC lens (S8-A-3/S8-E-2/S8-H-1 watch item) applied to
 * the D slice: the current conditional spreads create 4 hidden classes and
 * every downstream episode.taskFamily/taskSuccess read is a polymorphic IC.
 * RoutingEvalEpisode is module-private; no in-slice consumer enumerates
 * episode keys (replayAssignments / pairedRecords / assertReplayIsolated all
 * do field reads only), so the key-presence change is internal-only.
 * Equivalence: downstream actions/records/rerunHash bytes must be identical.
 * ============================================================ */
{
  const rng = mulberry32(0xd99d03);
  const mkRaw = (i: number, mode: number): unknown => {
    if (mode === 1) return "not-an-object";
    const base: Record<string, unknown> = {
      episodeHash: `eh_${i}`,
      taskId: `tsk_s91_${i}`,
      role: pick(rng, ROLES),
      objective: pick(rng, OBJECTIVES),
      originalWorkspace: "/repos/alpha"
    };
    if (mode === 2) base.episodeHash = "  ";
    if (mode === 3) base.role = "chief-vibes-officer";
    if (mode === 4) base.taskSuccess = "MAYBE";
    if (mode === 5) base.objective = "";
    if (rng() < 0.5) base.taskFamily = rng() < 0.2 ? "  " : pick(rng, ["edit", "test", "review"]);
    if (rng() < 0.6) base.taskSuccess = base.taskSuccess ?? (rng() < 0.5 ? "PASS" : "FAIL");
    return base;
  };

  // Field-value + error-path equivalence, and the documented internal-only divergence.
  let keyDivergences = 0;
  for (let trial = 0; trial < 300; trial += 1) {
    const mode = Math.floor(rng() * 7);
    const raw = mkRaw(trial, mode <= 5 ? mode : 0);
    let cur: EpisodeShape | undefined;
    let curErr: string | undefined;
    let mono: EpisodeShape | undefined;
    let monoErr: string | undefined;
    try {
      cur = parseEpisodeCurrent(raw, trial);
    } catch (error) {
      curErr = (error as Error).message;
    }
    try {
      mono = parseEpisodeMono(raw, trial);
    } catch (error) {
      monoErr = (error as Error).message;
    }
    check("S9-D-1 error-path equivalence", curErr === monoErr, `trial ${trial}: ${curErr} vs ${monoErr}`);
    if (cur !== undefined && mono !== undefined) {
      check(
        "S9-D-1 field-value equivalence",
        cur.episodeHash === mono.episodeHash &&
          cur.taskId === mono.taskId &&
          cur.role === mono.role &&
          cur.objective === mono.objective &&
          cur.originalWorkspace === mono.originalWorkspace &&
          cur.taskFamily === mono.taskFamily &&
          cur.taskSuccess === mono.taskSuccess,
        `trial ${trial}`
      );
      if (Object.keys(cur).join(",") !== Object.keys(mono).join(",")) keyDivergences += 1;
    }
  }
  check("S9-D-1 documented divergence: key presence differs on absent-optional episodes (internal objects only)", keyDivergences > 0);

  // Downstream byte-equivalence through the real consumption pipeline.
  const catalog = catalogFromPrimary({ primaryModelId: "premium" });
  const E = 200;
  const raws = Array.from({ length: E }, (_, i) => mkRaw(10000 + i, 0));
  const consumeA = makeConsumer();
  const consumeB = makeConsumer();
  const curEpisodes = raws.map((raw, index) => parseEpisodeCurrent(raw, index));
  const monoEpisodes = raws.map((raw, index) => parseEpisodeMono(raw, index));
  const tasks = curEpisodes.map((episode) => ({
    taskId: parseTaskId(episode.taskId),
    role: episode.role,
    objective: episode.objective
  }));
  const baselinePolicy = parseLearnedRoutingPolicy(CONFIGURED_BASELINE_POLICY) as LearnedRoutingPolicy;
  const candidatePolicy = parseLearnedRoutingPolicy(CONFIGURED_CANDIDATE_POLICY) as LearnedRoutingPolicy;
  const baselineAssign = assignTasks({ catalog, tasks, learned: baselinePolicy });
  const candidateAssign = assignTasks({ catalog, tasks, learned: candidatePolicy });
  const outCur = consumeA(curEpisodes, catalog, baselineAssign, candidateAssign);
  const outMono = consumeB(monoEpisodes, catalog, baselineAssign, candidateAssign);
  check(
    "S9-D-1 downstream equivalence: actions byte-identical (incl. rerunHash serialization)",
    stableStringify(outCur.actions) === stableStringify(outMono.actions) &&
      hash32(stableStringify(outCur.actions)) === hash32(stableStringify(outMono.actions))
  );
  check(
    "S9-D-1 downstream equivalence: paired records byte-identical",
    JSON.stringify(outCur.records) === JSON.stringify(outMono.records)
  );

  // Bench: construction + consumption per eval invocation at E=200,
  // realistic 4-shape mix (70% success, 50% family) vs mono shapes.
  const constructCur = bench(() => {
    raws.map((raw, index) => parseEpisodeCurrent(raw, index));
  }, 3000);
  const constructMono = bench(() => {
    raws.map((raw, index) => parseEpisodeMono(raw, index));
  }, 3000);
  const consumeCur = bench(() => {
    consumeA(curEpisodes, catalog, baselineAssign, candidateAssign);
  }, 3000);
  const consumeMono = bench(() => {
    consumeB(monoEpisodes, catalog, baselineAssign, candidateAssign);
  }, 3000);
  const totalDeltaUs = (constructCur - constructMono + (consumeCur - consumeMono)) * 1e3;
  console.log(
    `S9-D-1 bench E=${E}: construct current=${(constructCur * 1e3).toFixed(1)}us mono=${(constructMono * 1e3).toFixed(1)}us | consume(actions+records) current=${(consumeCur * 1e3).toFixed(1)}us mono=${(consumeMono * 1e3).toFixed(1)}us | combined delta/eval-invocation=${totalDeltaUs.toFixed(1)}us`
  );
}

/* ============================================================
 * S9-D-2: assertReplayIsolated roots construction fusion
 * ([...episodes.map(originalWorkspace), datasetDir] two-pass map+spread ->
 * single preallocated pass). Distinct from S3-D-3 (first-occurrence dedup of
 * the roots CONTENT, rejected at 351-388us); this is the construction
 * allocation only, at the same call site.
 * ============================================================ */
{
  const rng = mulberry32(0xd99d04);
  const currentRoots = (episodes: readonly EpisodeShape[], datasetDir: string): string[] => [
    ...episodes.map((episode) => episode.originalWorkspace),
    datasetDir
  ];
  const fusedRoots = (episodes: readonly EpisodeShape[], datasetDir: string): string[] => {
    const roots = new Array<string>(episodes.length + 1);
    for (let i = 0; i < episodes.length; i += 1) {
      roots[i] = (episodes[i] as EpisodeShape).originalWorkspace;
    }
    roots[episodes.length] = datasetDir;
    return roots;
  };
  // Equivalence incl. guard behavior on ok and overlap inputs.
  for (let trial = 0; trial < 200; trial += 1) {
    const n = Math.floor(rng() * 12);
    const overlap = rng() < 0.25;
    const episodes: EpisodeShape[] = Array.from({ length: n }, (_, i) => ({
      episodeHash: `eh_${i}`,
      taskId: `tsk_x${i}`,
      role: "worker" as AgentRole,
      objective: "o",
      originalWorkspace: overlap && i === Math.floor(n / 2) ? "/out/evals" : `/repos/w${i % 3}`
    }));
    const a = currentRoots(episodes, "/data/ds");
    const b = fusedRoots(episodes, "/data/ds");
    check("S9-D-2 same elements same order", a.length === b.length && a.every((v, i) => v === b[i]), `trial ${trial}`);
    let errA: string | undefined;
    let errB: string | undefined;
    try {
      createIsolationGuard({ readOnlyRoots: a, outputRoot: "/out/evals" });
    } catch (error) {
      errA = (error as Error).message;
    }
    try {
      createIsolationGuard({ readOnlyRoots: b, outputRoot: "/out/evals" });
    } catch (error) {
      errB = (error as Error).message;
    }
    check("S9-D-2 guard behavior identical (incl. overlap errors)", errA === errB, `trial ${trial}: ${errA} vs ${errB}`);
  }
  const E = 200;
  const episodes: EpisodeShape[] = Array.from({ length: E }, (_, i) => ({
    episodeHash: `eh_${i}`,
    taskId: `tsk_x${i}`,
    role: "worker" as AgentRole,
    objective: "o",
    originalWorkspace: "/repos/alpha"
  }));
  const cur = bench(() => {
    currentRoots(episodes, "/data/ds");
  }, 20000);
  const fused = bench(() => {
    fusedRoots(episodes, "/data/ds");
  }, 20000);
  console.log(
    `S9-D-2 bench E=${E}: current(map+spread)=${(cur * 1e6).toFixed(1)}ns fused=${(fused * 1e6).toFixed(1)}ns delta/eval-invocation=${((cur - fused) * 1e6).toFixed(1)}ns (site total incl. guard was anchored by S3-D-3 at ~0.37ms)`
  );
}

/* ============================================================
 * S9-D-3: preparePromotion dead second review.candidateId compare.
 * The combined gate (actorId/candidateId/contentHash) at the top of the
 * review-match block already throws on any candidateId mismatch, so the
 * later `if (input.review.candidateId !== candidate.candidateId)` compare is
 * provably unreachable. R1-D noted it "kept as defensive depth" in passing
 * but never adjudicated it with an ID or sim — ninth-pass formal closure.
 * ============================================================ */
{
  const rng = mulberry32(0xd99d05);
  // Public-surface fuzz: the second message must never surface.
  let combinedMsg = 0;
  let secondMsg = 0;
  let successes = 0;
  for (let trial = 0; trial < 200; trial += 1) {
    const tag = `d3t${trial}x`;
    const registry = new ResourceRegistry({ now: () => NOW, generateId: sequentialIds(tag) });
    const identity: ResourceIdentity = {
      kind: "prompt",
      name: "main-agent-prompt",
      scope: { kind: "project", projectId: createProjectId(() => `${tag}p`) }
    };
    const v1 = registry.registerBaseline({ identity, content: "v1", author: HUMAN });
    const c1 = registry.createCandidate({
      identity, content: "v2", parentVersionId: v1.versionId, author: HUMAN, evaluationPlan: EVAL_PLAN
    });
    const c2 = registry.createCandidate({
      identity, content: "v3", parentVersionId: v1.versionId, author: HUMAN, evaluationPlan: EVAL_PLAN
    });
    const fault = Math.floor(rng() * 4); // 0=ok 1=wrong review candidateId 2=wrong actor 3=wrong contentHash
    const review = mkReview(
      fault === 1 ? c2.candidateId : c1.candidateId,
      fault === 3 ? "deadbeef" : c1.contentHash,
      tag
    );
    const input: PromoteInput = {
      candidateId: c1.candidateId,
      expectedCurrentVersionId: v1.versionId,
      content: "v2",
      approvedBy: HUMAN,
      review: fault === 2 ? { ...review, actorId: "someone-else" } : review,
      changeNote: mkNote(`prompt:${tag}`, v1.versionId),
      explicitApproval: true
    };
    try {
      promoteWithRegistry(registry, input);
      successes += 1;
      check("S9-D-3 ok-path only on fault=0", fault === 0, `trial ${trial}`);
    } catch (error) {
      const msg = (error as Error).message;
      if (msg === "promotion review must match candidate author, id, and content hash") combinedMsg += 1;
      if (msg === "promotion review candidate does not match promotion candidate") secondMsg += 1;
    }
  }
  check("S9-D-3 deadness: the second compare's message never surfaced across the fault fuzz", secondMsg === 0, String(secondMsg));
  check("S9-D-3 fuzz coverage: combined gate fired and successes observed", combinedMsg > 0 && successes > 0, `${combinedMsg}/${successes}`);

  // Local twin: check sequence with vs without the dead compare is byte-identical.
  const seqWith = (revCand: string, cand: string, actorOk: boolean, hashOk: boolean): string => {
    if (!actorOk || revCand !== cand || !hashOk) return "combined";
    if (revCand !== cand) return "second";
    return "ok";
  };
  const seqWithout = (revCand: string, cand: string, actorOk: boolean, hashOk: boolean): string => {
    if (!actorOk || revCand !== cand || !hashOk) return "combined";
    return "ok";
  };
  for (let trial = 0; trial < 4000; trial += 1) {
    const revCand = `cnd_${Math.floor(rng() * 3)}`;
    const cand = `cnd_${Math.floor(rng() * 3)}`;
    const actorOk = rng() < 0.7;
    const hashOk = rng() < 0.7;
    check("S9-D-3 twin equivalence", seqWith(revCand, cand, actorOk, hashOk) === seqWithout(revCand, cand, actorOk, hashOk));
  }
  const a = "cnd_aaaa0001";
  const b = "cnd_aaaa0001";
  const cmp = bench(() => {
    if (a !== b) throw new Error("unreachable");
  }, 500000);
  console.log(
    `S9-D-3 deadness fuzz: second-compare message surfaced 0 times across 200 public-surface fault trials; anchor: one dead string compare = ${(cmp * 1e6).toFixed(2)}ns per promote (upper bound of any gain)`
  );
}

/* ============================================================
 * S9-D-4: assertNoForbiddenFields per-key toLowerCase elision via a
 * lowercase fast-path guard. Two forms:
 *  - UNSOUND cheap form (skip toLowerCase when the key has no ASCII
 *    uppercase): Unicode case-folding counterexample — U+212A KELVIN SIGN
 *    lowercases to "k", so "api\u212Aey" folds to the forbidden "apikey";
 *    the guard sees no ASCII uppercase and skips the fold -> the credential
 *    scrub gate fails open.
 *  - SOUND form (skip only for pure-ASCII keys with no [A-Z]): equivalent,
 *    but real policy keys are camelCase ("primaryModelId", "modelId") which
 *    pay scan + toLowerCase; benched on the configured 9.2KB policy.
 * ============================================================ */
{
  const rng = mulberry32(0xd99d06);
  const FORBIDDEN = new Set(["permission", "credential", "secret", "token", "apikey", "password", "authorization"]);
  function currentWalk(value: unknown): void {
    if (Array.isArray(value)) {
      for (const entry of value) currentWalk(entry);
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN.has(key.toLowerCase())) {
        throw new DomainValidationError(`routing-policy contains forbidden field ${key}`);
      }
      currentWalk(child);
    }
  }
  function hasAsciiUpper(s: string): boolean {
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charCodeAt(i);
      if (c >= 65 && c <= 90) return true;
    }
    return false;
  }
  function unsoundWalk(value: unknown): void {
    if (Array.isArray(value)) {
      for (const entry of value) unsoundWalk(entry);
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      const folded = hasAsciiUpper(key) ? key.toLowerCase() : key;
      if (FORBIDDEN.has(folded)) {
        throw new DomainValidationError(`routing-policy contains forbidden field ${key}`);
      }
      unsoundWalk(child);
    }
  }
  function isPureAsciiLower(s: string): boolean {
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charCodeAt(i);
      if (c >= 128 || (c >= 65 && c <= 90)) return false;
    }
    return true;
  }
  function soundWalk(value: unknown): void {
    if (Array.isArray(value)) {
      for (const entry of value) soundWalk(entry);
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      const folded = isPureAsciiLower(key) ? key : key.toLowerCase();
      if (FORBIDDEN.has(folded)) {
        throw new DomainValidationError(`routing-policy contains forbidden field ${key}`);
      }
      soundWalk(child);
    }
  }

  // Counterexample: Kelvin-sign key folds into a forbidden field.
  const kelvinKey = "api\u212Aey";
  check("S9-D-4 setup: Kelvin key case-folds to the forbidden field", kelvinKey.toLowerCase() === "apikey");
  check("S9-D-4 setup: Kelvin key has no ASCII uppercase (guard blind spot)", !hasAsciiUpper(kelvinKey));
  const tampered = { primaryModelId: "premium", avoid: [{ [kelvinKey]: "sk-live-123", modelId: "m1", reason: "r" }], prefer: [] };
  let curOutcome = "<pass>";
  let unsoundOutcome = "<pass>";
  let soundOutcome = "<pass>";
  try { currentWalk(tampered); } catch (error) { curOutcome = (error as Error).message; }
  try { unsoundWalk(tampered); } catch (error) { unsoundOutcome = (error as Error).message; }
  try { soundWalk(tampered); } catch (error) { soundOutcome = (error as Error).message; }
  check("S9-D-4 counterexample: current gate fails closed on the Kelvin key", /forbidden field/.test(curOutcome));
  check("S9-D-4 counterexample: unsound fast path FAILS OPEN (scrub gate bypassed)", unsoundOutcome === "<pass>", unsoundOutcome);
  check("S9-D-4 sound form stays closed (non-ASCII falls back to the fold)", soundOutcome === curOutcome, `${soundOutcome} vs ${curOutcome}`);
  console.log(
    `S9-D-4 counterexample (key "api\\u212Aey" = api+KELVIN SIGN, folds to "apikey"): current -> "${curOutcome}" | unsound fast-path variant -> ${unsoundOutcome} (fail-open through the forbidden-field scrub) | sound variant -> matches current`
  );

  // Sound-form equivalence fuzz incl. forbidden hits at random depths and Unicode keys.
  for (let trial = 0; trial < 400; trial += 1) {
    const depth = 1 + Math.floor(rng() * 3);
    const mkNode = (d: number): unknown => {
      if (d === 0) return rng() < 0.5 ? "leaf" : 42;
      const obj: Record<string, unknown> = {};
      const keys = Math.floor(rng() * 4) + 1;
      for (let k = 0; k < keys; k += 1) {
        const r = rng();
        const key =
          r < 0.08 ? pick(rng, ["Password", "TOKEN", "apiKey", "Secret"]) :
          r < 0.12 ? pick(rng, [kelvinKey, "na\u00EFve", "\u0130stanbul"]) :
          r < 0.5 ? pick(rng, ["modelId", "primaryModelId", "taskFamily"]) :
          pick(rng, ["family", "reason", "model", "role", "avoid", "prefer"]);
        obj[key] = rng() < 0.3 ? [mkNode(d - 1)] : mkNode(d - 1);
      }
      return obj;
    };
    const node = mkNode(depth);
    let cur = "<pass>";
    let sound = "<pass>";
    try { currentWalk(node); } catch (error) { cur = (error as Error).message; }
    try { soundWalk(node); } catch (error) { sound = (error as Error).message; }
    check("S9-D-4 sound-form equivalence (first forbidden key + message identical)", cur === sound, `trial ${trial}: ${cur} vs ${sound}`);
  }

  // Bench the sound form on the configured 9.2KB policy (the real key mix).
  const configured = JSON.parse(CONFIGURED_CANDIDATE_POLICY) as unknown;
  const cur = bench(() => {
    currentWalk(configured);
  }, 5000);
  const sound = bench(() => {
    soundWalk(configured);
  }, 5000);
  console.log(
    `S9-D-4 bench configured ${(CONFIGURED_CANDIDATE_POLICY.length / 1024).toFixed(1)}KB policy: current=${(cur * 1e3).toFixed(2)}us sound-variant=${(sound * 1e3).toFixed(2)}us delta/walk=${((cur - sound) * 1e3).toFixed(2)}us (x2 policies per eval; camelCase keys pay scan+fold)`
  );
}

await rm(workRoot, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)");
```
