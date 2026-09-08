# R9-A：`src/tracking/` + `src/run/{child-tracking,gate-apply}.ts` 第九遍搜查报告

**战役:** 全库持久 SOTA 优化 Round 9 / R9-A（Round 1–8 同区第九遍）
**基线:** `cursor/sota-persistent-opt-83a1` @ `c83cb1d`（含 S8-G-1..2 / S8-H-1..3 排除与 Round 9 开轮）
**分支:** `cursor/r9-a-tracking-ninth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动；整片预算收口第七次复核成立，并按
R7-I 教训首次closed「门控结局 × 合同配置」锚点矩阵。**
切片 14 个文件自 R1-A 基线（`7acb666`）经 R2-A … R8-A 至本轮基线
（`c83cb1d`）**逐字节未变**（`git diff 7acb666..c83cb1d -- src/tracking/
src/run/child-tracking.ts src/run/gate-apply.ts` 为空，九遍全程零 diff）。
调用面同样未变：R8-A 基线（`6cf2d65`）以来 `src/` 仅
`src/routing/offline-logit.ts` 一个切片外文件变动（S7-C 域内调整），不触及
本切片及其调用方；全库 grep 复核生产调用方仍为 `supervisor.ts:483`
（applyTrackingGate/nextTrackingSeq）/ `coordinator.ts:444` /
`flowchart-run.ts:320`（applyChildThreeLine），每子结果一次（~5 次/run），
事件表几十级（41）。本轮新落档两个调用矩阵事实：(1)
`settleSupervisedOutcome` 的两个 `src/` 调用点（supervisor.ts:601 / :711）
**均不传 `trackingAssessment`**，故 supervisor 侧 applyTrackingGate 站点在
生产中是 O(1) 早退 no-op——**生产门控流量 100% 经 applyChildThreeLine**；
(2) `hashSummary` 仅在 `window.previous` 有定义时执行，而 from-child 路径
恒无 previous ⇒ **hashSummary 生产零流量**。R7-I「默认态夹具掩盖配置态」
教训按令复查：`src/track/` 对切片**零导入**（grep 无匹配），`--track` 经
`startFlowchartRun` 到达同一 flowchart-run.ts:320 调用点，无配置态新热环。
R8-A 的 ~88–90 µs/run 预算天花板经本轮在当前（更快）VM 上实测复核为
**~60–76 µs/run**（PASSED 锚点 11.9–12.8 µs/gate 与 R4-A 的 12.1–12.3 同带；
FAILED×合同配置态单元 15.0–15.3 µs/gate 为矩阵最贵单元），量级结论不变。
在完整排除表之上以新角度第九遍枚举，得到 1 个此前未点名的新候选
（S9-A-1，本切片九遍来仅剩的未点名死工作结构），经理论（双引理）+ 确定性
仿真（seeded mulberry32，4000 组端到端 fuzz 逐位等价，三次独立运行结论
逐位一致）裁决后淘汰：等价成立但落地需 X1-2 平行 turn 路径或公开
旗标/类型变更（S7-A-1 + S8-A-3 同拒绝结构），收益 ~3.5–4.5 µs/run，低于
落地线约四个量级。未重开任何 X* / S1-* … S8-* 条目。

## 0. 范围与约束遵守

- 切片：`src/tracking/`（12 文件）+ `src/run/child-tracking.ts` +
  `src/run/gate-apply.ts`，全部实际读码。
- 先读并遵守（顺序强制）：README / EXCLUSIONS.md（全表，含 S8-A-1..3 /
  S8-B-1..4 / S8-C-1..4 / S8-D-1..5 / S8-E-1..3 / S8-F-1..3 / S8-G-1..2 /
  S8-H-1..3）/ round-09/PLAN.md / round-08/PLAN.md + R8-A.md /
  round-01/R1-A.md … round-07/R7-A.md。候选枚举刻意绕开全部既有排除
  （X0-4、X0-6、X1-1、X2-4、S1-A-1..9、S2-A-1..6、S3-A-1..4、S4-A-1..3、
  S5-A-1..3、S6-A-1..3、S7-A-1..4、S8-A-1..3、S6-G-7 及全部无 ID 收口
  裁决），只探索**未被点名的第九组新角度**：生产消费者投影下的死输出尾
  （S9-A-1）。
- 换名重提检查（识别为既有方案换名/换位点，**未列为新候选**）：
  - gate-apply 按 `mapGateDirective(...) === "none"` 条件跳过第一个
    GATE_TRANSITION find（none 路径从不写入 GATE_TRANSITION，直觉上
    该 find 必 miss）= **S8-A-1 变体 A 的同一未强制跨字段不变式**——
    schema 合法的对抗 GATE_TRANSITION{idempotencyKey:"\<hash\>:\<seq\>"}
    使 find 命中，跳过即把幂等 no-op 变重复追加，被 R8-A 反例逐字击杀，
    拒列；
  - turn.ts / roller.ts 的条件 spread 改后置条件赋值 = S8-E-2 换位点
    （PIC 敏感项收益），拒列；
  - `GateApplyResult` 3 字段/4 字段形状单态化（skip 路径补
    `transitionId: undefined`）= S4-E-3「隐藏类单态化＝形状不等价」族
    + 公开结果形状（`'transitionId' in result` 可观察），拒列；
  - child-tracking `skipped` 对象在 apply 路径上的死分配（第 19 行无条件
    分配、apply 路径不消费）内联到各 return 位点 = S7-A-3「死分配守卫」
    族（V8 空字面量近零成本、实测负优化先例）+ R3-A「常量提升＝共享
    身份」收口的对偶面，拒列；
  - `[...input.events]`+push 追加构造预分配容量 = S2-A-4 追加构造微观
    常数族（concat 慢 3.7× 先例），拒列；
  - `observationFromChild` 无 contract 时 `(contract?.constraints ?? [])
    .map(...)` 的双空数组分配 = S1-B-5 冗余分配噪声族（个位 ns），拒列；
  - 每 gate 三次 `hashAssessment`（caller 侧 + applyTrackingGate CAS 校验
    + `validateEvent` 写侧 `parseTrackingAssessment`+再哈希）——caller/callee
    双算维持 R1-A CAS fail-closed 契约裁决；写侧第三层 = S4-G-2「写侧校验
    跳过＝非法收益」族且实现在 `src/run/events.ts`（**切片外**），拒列；
  - from-child window 的三个空数组字面量享元单例化 = S7-B-5/S1-A-7
    可观察身份族（R8-A §0 已拒 PASS 维度享元同型），拒列。
- 公开 API、版本化阈值（softThreshold 0.55 / hardFailCap 0.3 /
  minorPDip 0.03）、哈希契约、事件 schema、CAS/幂等键格式全部不变——
  本轮零 diff，天然满足。三线规格（分析不改 in-flight、Tracking 无命令权、
  H/score 不写路由、live = R0 等价、双 LCB 双归因保留、提升 proposal-first）
  同样天然满足。GateInput P/human 维持（S8-A-3）；sanitizePacketForAnalysis
  choke point 维持（S8-A-2）；validateEvent 不强制 `idempotencyKey ===
  hash:seq`（S8-A-1 变体 A 反例）持续为裁决依据。不声称 Outcome-supported；
  Checkpoint F-PROD 仍开放（ADR-005）。

## 1. 预算支配论证复核（方法第 1 步，不假设直接实测）

R3-A §3 … R8-A §1 的整片预算论证依赖两个前提，本轮逐一复核：

1. **切片代码未变**：`git diff 7acb666..c83cb1d -- <切片>` 为空，逐字节
   一致（九遍全程零 diff）。
2. **调用面未变**：`6cf2d65..c83cb1d` 间 `src/` 仅
   `src/routing/offline-logit.ts` 一个切片外文件变动，不触及切片；生产
   调用方经全库 grep 复核不变。**无新热路径，无量级变化。**

R7-I 教训（默认态夹具可能掩盖配置态主路径）本轮以**锚点矩阵**形式收口：
历代锚点只测 PASSED（directive none，仅追加 1 个 TRACKING_ASSESSMENT）
且不带合同。本轮补齐门控结局 × 合同两维（三次独立运行）：

```text
anchor [PASSED x no-contract（历代谱系锚点）]: 11.9–12.8 µs/gate (+1 event) => ~60–64 µs/run
anchor [PASSED x contract(3 constraints)]:      12.1–12.6 µs/gate (+1 event) => ~61–63 µs/run
anchor [FAILED x contract(3)（硬门 3 事件）]:   15.0–15.3 µs/gate (+3 events) => ~75–76 µs/run
```

- PASSED 锚点与 R4-A（12.1–12.3 µs/gate）同带（本 VM 快于 R8-A 的
  17.6–17.9 µs VM）；合同配置态**无悬崖**（约束 3 条只改变 prescore/roller
  的个位数循环行程，差异在抖动内）。
- FAILED 单元是矩阵最贵单元：hard gate ⇒ queue_analysis ⇒ 追加
  TRACKING_ASSESSMENT + GATE_TRANSITION + RUN_BLOCKED 三事件（各过一次
  写侧 validateEvent 深校验）+ wakeAnalysis packet 构造，较 PASSED 贵
  ~2.5 µs/gate——**首次实测，配置态测量盲区就此关闭**，量级结论不变。
- 调用矩阵两个新落档事实（见结论节）：supervisor 侧 applyTrackingGate
  站点生产 no-op（两个 settle 调用点均不传 assessment，applyTrackingGate
  的生产流量 100% 来自 applyChildThreeLine 的 child-tracking.ts:41）；
  hashSummary 生产零流量（from-child 路径恒无 previous）。两者都**收紧**
  而非放宽预算：切片生产热面比历代假设更小。

即使把整个切片优化到零成本，节省上界 ~0.08 ms/run，仍比战役落地线
（数十~数百 ms 或复杂度类下降）低**约三个量级**。复杂度类下降的仅存位点
维持既有排除（X0-4/X2-4 事件表索引化、S1-A-1/S1-A-9 反向早退、X1-1
hashSummary 跨调用缓存、S6-G-7 读侧内存镜像、R1-A 裁决的不可变累计快照
构造下界、S8-A-1 fresh-seq 死扫描）。**支配论证第七次复核成立，本切片在
当前数据面规模下维持预算收口。**

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S9-A-1 | from-child 生产路径**死 turn 输出尾跳过**：`runTrackingTurn` 的唯一 `src/` 调用方是 `assessChildObservation`，其产出 `decision.turn` / `decision.prescore` 在 `src/` 内**零读者**（applyChildThreeLine 只读 `apply`+`assessment`；coordinator/flowchart-run 只读 `{events, result}`）；而 assessment 对 turn 的依赖只经 {human, score, gate} 投影——故 runTrackingTurn 内 readers 块、`[...gate.codes]` 拷贝、**整个 rollSummary**、failClosed 门改写、**anomaly packet 构造**、readersInvoked 全是死输出工作。候选＝调用点特化的 stripped turn（保留 S1-A-2 的重复 computePrescore 与全部门/分/人相关计算，仅跳死尾）+ 收窄 `ChildTrackingDecision` 死载体 | 引理 A：from-child 恒不传 `maxItems` ⇒ roller 的 failClosed 赋值条件恒假 ⇒ failClosed 门改写可证 no-op（gate 在 evaluateGates 后即终值）；引理 B：投影闭包——stripped turn 与全量 turn 在 {P, human, score, gate} 上逐位一致 | ✅ 引理 A：300 条 episode 链（2–15 turn，无 maxItems）failClosed 恒 false；✅ 引理 B + 端到端：4000 组 fuzz（PASSED/FAILED/UNOBSERVED/缺失 verification × 角色 × 验收 × 合同约束 0–4 × 证据形态 × 对抗摘要 × 附着/未附着/空事件表）经 applyChildThreeLine 的 {events, result} **逐位一致** + skip 路径引用身份一致 + 投影闭包逐位成立 | 死尾实测 **926–999 ns/turn**（PASSED，无 packet）/ **739–843 ns/turn**（FAILED，含 packet）；端到端 delta PASSED 323–1489 ns/gate、FAILED 609–2231 ns/gate（三次全正但带宽大）；×~5 gates/run ⇒ **~3.5–4.5 µs/run** | 淘汰：落地需 X1-2 平行 turn 路径或给公开 `runTrackingTurn` 开旗标（S7-A-1 同拒绝结构：该报告折叠 human 管道常量时已裁决此路不通）+ 收窄公开 `ChildTrackingDecision` 属公开类型变更（S1-F-6/S8-A-3 族）；收益低于落地线约四个量级 |

## 3. 关键裁决细节

### S9-A-1 的定位（第九遍还剩什么）

这是本切片九遍搜查以来**最后一处未点名的结构性死工作**，也是历代裁决的
汇聚点：S1-A-2 点名了输入侧的重复 computePrescore，S4-A-1 点名了 window
克隆死 openMinors 覆盖，S7-A-1 点名了 human 管道常量折叠（161–163 ns），
但**没人点名输出侧**——runTrackingTurn 花在 rollSummary（含 mandatory
机器）、collectEvidence、packet 构造上的 ~0.9 µs/turn 产出物被生产消费者
整体丢弃。三个 grep 事实支撑：(1) `runTrackingTurn` 唯一 `src/` 调用方是
from-child.ts:81；(2) `decision.turn` / `decision.prescore` 在 `src/` 内
零读取（本轮全库 grep）；(3) rollSummary 唯一 `src/` 调用方是 turn.ts:121。
等价性靠双引理闭合：**引理 A** 保证跳过 failClosed 门改写不改 gate
（from-child 恒不传 maxItems，roller 的 failClosed 赋值在
`input.maxItems !== undefined && mandatory.length > input.maxItems` 下
恒假——这是与 S7-A-1 幂等引理同级的跨模块不变量，300 链 fuzz 佐证）；
**引理 B** 保证 stripped 投影与全量 turn 在 assessment 全部依赖面
{P, human, score, gate} 上逐位一致（4000 组端到端 fuzz，appended events
与 result 逐位同）。

淘汰三重落锤：(1) **落地面**——收益要求调用点特化（X1-2 平行入口）或
公开旗标（S5-A-3/S6-A-3/S7-A-1 三度拒绝的同一结构），收窄
`ChildTrackingDecision` 是公开类型变更（S1-F-6/S8-A-3 族），且 turn 载体
是 test 面在用的观察窗口；(2) **量级**——~3.5–4.5 µs/run 比落地线低约
四个量级，甚至低于已否决的 S2-A-1（12 µs/episode）；(3) **支配**——被
§1 第七次复核的整片预算收口覆盖。重开条件见 §6。

### 锚点矩阵的两个方法论价值

一是把 R7-I 教训在本切片具体化：历代 PASSED-only 锚点确实**低估**了
FAILED 路径 ~20% 的每 gate 成本（3 事件 × 写侧深校验 + packet），但该
配置态悬崖只有 ~2.5 µs/gate，不改变量级裁决——盲区关闭而非翻案。二是
supervisor 站点生产 no-op 与 hashSummary 生产零流量两个事实把切片的
生产热面进一步收紧：任何以 supervisor 侧 applyTrackingGate 或 roller 的
hashSummary(previous) 为热点前提的未来提案可直接引用本轮 grep 证据否决。

### 逐文件收口（第九遍新角度复查）

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `turn.ts` | 死输出尾（rollSummary/collectEvidence/packet/readersInvoked 对生产消费者不可见——本文件九遍来最后一处未点名结构）；条件 spread 后置化 = S8-E-2 换位点拒列（见 §0）；S1-A-7 / S2-A-3 / S3-A-2/3/4 / S4-A-1 / S5-A-1 / S7-A-1 / S8-A-3 收口维持 | S9-A-1 淘汰 |
| `roller.ts` | 生产调用面收口（唯一调用方 turn.ts:121，输出被丢弃——S9-A-1 的机器面）；hashSummary(previous) 生产零流量落档；S1-A-5 / S2-A-1 / S3-A-1 / S7-A-2 四层收口维持 | S9-A-1 覆盖 |
| `from-child.ts` | `ChildTrackingDecision.turn/.prescore` 死公开载体（S8-A-3 死输入字段的输出侧对偶）；空数组字面量享元拒列（S7-B-5 族，见 §0）；S1-A-2 / S2-A-2/6 / S4-A-3 / S5-A-3 / S6-A-2/3 七层收口维持 | S9-A-1 淘汰 |
| `gate-apply.ts` | directive-none 条件跳过第一 find = S8-A-1 变体 A 同型反例拒列（见 §0）；GateApplyResult 形状单态化 = S4-E-3 族拒列；三次 hashAssessment 维持 CAS fail-closed + S4-G-2 + 切片外裁决；双 find / currentGateStatus / nextTrackingSeq 维持 X2-4/X0-4/S1-A-1/S1-A-9/S8-A-1；`mapGateDirective` FAIL_CLOSED 兜底维持保留 | 无新候选 |
| `child-tracking.ts` | `skipped` apply 路径死分配内联 = S7-A-3 族拒列（见 §0）；supervisor settle 站点生产 no-op 落档（调用矩阵事实）；5 次事件表扫描维持 X2-4/X0-4；S4-A-2 / S6-G-7 收口维持 | 无新候选 |
| `gates.ts` | S1-A-6 / S7-A-3 / S8-A-3 收口维持；openMinors 恒空早退 = S3-A-4 族（R6-A 已拒） | 无新候选 |
| `prescore.ts` | S1-A-4 / S3-A-3 / S6-A-1 收口维持；evidenceOutcome successClaim 先算序 = S6-A-2/S1-B-3 短路重排族 | 无新候选 |
| `human-score.ts` | X0-6 / S1-A-3 / R3-A「X0-6 对偶面」/ R5-A 频次重排不等价收口维持；from-child 路径整管道死 = S7-A-1 已裁决 | 无新候选 |
| `combined-score.ts` | S6-A-1 / S7-A-4 反例收口维持；isMachineScore 边界防御保留 | 无新候选 |
| `types.ts` | hashSummary 生产零流量落档（不构成候选——死代码无从优化，仅收紧未来提案前提）；S2-A-5 / S5-A-2 / X0-5 / S1-A-8 / S3-B-3 收口维持 | 无新候选 |
| `analysis.ts` | S8-A-2 收口维持（test-only + choke point） | 无新候选 |
| `isolation.ts` / `config.ts` / `index.ts` | O(1) 谓词 / 常量 / 纯再导出 | 无新候选 |

## 4. 前后对比

无代码 diff。仓库变更仅本报告一个文件。仿真为临时脚本未入库（无赢家不落
仿真文件，遵守方法第 6 条；loser 仿真完整源码见附录），未触碰任何测试。

## 5. 测试

零代码改动下相关套件基线复核，全绿（与 R1-A…R8-A 同套件同计数）：

```bash
npx tsx --test "test/unit/tracking/**/*.test.ts" \
  "test/unit/run/gate-apply.test.ts" \
  "test/integration/track/**/*.test.ts"
# tests 72 / suites 13 / pass 72 / fail 0
```

全仓门禁复核：`pnpm typecheck` / `pnpm lint` / `pnpm build` 全绿。

仿真（临时脚本；seed 固定可复现，三次独立运行）：

```text
run 1:
S9-A-1 Lemma A: 300 episode chains (2-15 turns), failClosed===false in all rollSummary outputs without maxItems
S9-A-1 Lemma B + e2e: 4000 fuzz trials bit-equal (events, result, skip identity, projection closure)
S9-A-1 bench turn tail (PASSED, no packet): full=1990ns stripped=1060ns dead-tail=930ns/turn
S9-A-1 bench turn tail (FAILED, packet built): full=1891ns stripped=1103ns dead-tail=788ns/turn
S9-A-1 bench e2e (PASSED, E=41, contract 3): current=12.59us cand=11.89us delta=700ns/gate
S9-A-1 bench e2e (FAILED, E=41, contract 3): current=14.13us cand=13.28us delta=845ns/gate
anchor [PASSED x no-contract]: 12.8us (+1 events) => ~64us/run
anchor [PASSED x contract(3)]: 12.4us (+1 events) => ~62us/run
anchor [FAILED x contract(3)]: 15.0us (+3 events) => ~75us/run
ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)

run 2:
S9-A-1 dead-tail PASSED=999ns FAILED=739ns | e2e delta PASSED=323ns FAILED=609ns
anchor: PASSED 11.9us => ~60us/run | PASSED+contract 12.1us => ~61us/run | FAILED+contract 15.0us => ~75us/run
ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)

run 3:
S9-A-1 dead-tail PASSED=926ns FAILED=843ns | e2e delta PASSED=1489ns FAILED=2231ns
anchor: PASSED 12.7us => ~63us/run | PASSED+contract 12.6us => ~63us/run | FAILED+contract 15.3us => ~76us/run
ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

三次独立运行等价结论逐位一致（引理 A/B 与 4000 组 e2e fuzz 全绿确定性
重现）；死尾计时方向稳定（六次全正，739–999 ns/turn）；e2e delta 三次
全正但带宽大（323–2231 ns/gate），与死尾隔离测量同向；锚点矩阵三单元
三次同带。裁决方向不变。

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S9-A-1 | from-child 生产路径死 turn 输出尾跳过（调用点特化 stripped turn 跳 rollSummary/collectEvidence/packet/readersInvoked + 收窄 ChildTrackingDecision 死载体 turn/prescore） | 等价（引理 A：无 maxItems ⇒ failClosed 恒假 ⇒ 门改写 no-op；引理 B：{P,human,score,gate} 投影闭包；4000 e2e fuzz 逐位）但落地需 X1-2 平行 turn 路径或公开旗标（S7-A-1 同拒绝结构）+ 公开类型变更（S1-F-6/S8-A-3 族）；死尾 739–999ns/turn ⇒ ~3.5–4.5µs/run，低于落地线约四个量级 |

重开条件：S9-A-1 需先出现 `decision.turn`/`decision.prescore` 的高频生产
读者消失论证被推翻（即 turn 载体被正式声明为 test-only 并从公开类型移除
——届时随类型解冻一并重开），或 tracking turn 频次/滚轮累计集增长 ≥2–3
个量级（届时与 S2-A-1、S7-A-1、S7-A-2 一并重开）。整片预算支配论证
（§1）的重开条件不变：run 事件表或每 turn 集合规模增长 ≥2–3 个量级，
届时 S1-A-1、S2-A-1、S2-A-3、S4-A-1、S7-A-2、S8-A-1(B)、S9-A-1 可凭
既有等价性证据优先重开。本轮新关的 FAILED×合同锚点单元与 supervisor
站点 no-op / hashSummary 零流量两事实无独立重开条件——它们是测量与
调用矩阵档案，随上述规模前提一并失效。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.ts` 后 `npx tsx <file>`（仓库根目录，依赖已装）。
seeds：`0xa99a01`–`0xa99a04`。

```ts
/**
 * R9-A deterministic equivalence + benchmark simulation (ninth pass).
 * Adjudicates the fresh candidate S9-A-1 against the current implementations
 * in src/tracking + src/run/{child-tracking,gate-apply}, closes the
 * gate-outcome x contract configured-state anchor matrix (R7-I lesson), and
 * re-verifies the whole-slice budget anchor (R3-A..R8-A lineage).
 * S9-A-1 is a NEW angle not named by EXCLUSIONS.md or R1-A..R8-A:
 * the from-child production path discards the entire rollSummary /
 * collectEvidence / anomaly-packet tail of runTrackingTurn (zero src/
 * readers of ChildTrackingDecision.turn/.prescore), so that tail is dead
 * output work; a call-site-specialized turn (parallel path) skips it.
 * Seeded PRNG (mulberry32) -> fully reproducible.
 * Seeds: 0xa99a01 .. 0xa99a04.
 */
import { performance } from "node:perf_hooks";
import type { EventId } from "/workspace/src/domain/ids.js";
import type { RequirementContract } from "/workspace/src/domain/contract.js";
import { DEFAULT_TRACKING_CONFIG } from "/workspace/src/tracking/config.js";
import { combineScore } from "/workspace/src/tracking/combined-score.js";
import { evaluateGates } from "/workspace/src/tracking/gates.js";
import { extractHumanScore, hasObviousHumanProblem } from "/workspace/src/tracking/human-score.js";
import { computePrescore, isSuccessClaim } from "/workspace/src/tracking/prescore.js";
import { rollSummary } from "/workspace/src/tracking/roller.js";
import { mergeOpenMinors, runTrackingTurn, type TrackingTurnInput } from "/workspace/src/tracking/turn.js";
import {
  assessChildObservation,
  shouldApplyThreeLine,
  type ChildObservation
} from "/workspace/src/tracking/from-child.js";
import {
  applyChildThreeLine,
  observationFromChild
} from "/workspace/src/run/child-tracking.js";
import { applyTrackingGate, nextTrackingSeq, type GateApplyResult } from "/workspace/src/run/gate-apply.js";
import { episodeIdFromEvents } from "/workspace/src/run/episode-bind.js";
import type { Event } from "/workspace/src/run/events.js";
import type {
  ConstraintRecord,
  GateDecision,
  HumanSignal,
  RollingSummary,
  TrackingAssessment,
  TrackingWindow
} from "/workspace/src/tracking/types.js";
import { UNOBSERVED, hashAssessment } from "/workspace/src/tracking/types.js";

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
  fn(); // warm
  const t0 = performance.now();
  for (let i = 0; i < reps; i += 1) fn();
  return (performance.now() - t0) / reps;
}

const NOW_ISO = "2026-08-24T00:00:00.000Z";
const RUN_ID = "run_x" as Event["runId"];

/* ============================================================
 * Shared: realistic event tables (R3-A..R8-A harness lineage).
 * ============================================================ */
function buildEventTable(opts: { attached: boolean; filler: number }): Event[] {
  let idCounter = 0;
  const nextId = (): EventId => `evt_${String(idCounter++).padStart(8, "0")}` as EventId;
  const events: Event[] = [];
  events.push({
    id: nextId(),
    schemaVersion: 1,
    occurredAt: NOW_ISO as Event["occurredAt"],
    runId: RUN_ID,
    type: "RUN_STARTED",
    actor: "system",
    payload: { title: "bench" }
  } as unknown as Event);
  if (opts.attached) {
    events.push({
      id: nextId(),
      schemaVersion: 1,
      occurredAt: NOW_ISO as Event["occurredAt"],
      runId: RUN_ID,
      type: "RUN_ATTACHED",
      actor: "supervisor",
      payload: { episodeId: "ep_bench", runId: RUN_ID, attachedAt: NOW_ISO }
    } as unknown as Event);
  }
  for (let i = 0; i < opts.filler; i += 1) {
    events.push({
      id: nextId(),
      schemaVersion: 1,
      occurredAt: NOW_ISO as Event["occurredAt"],
      runId: RUN_ID,
      type: "CHILD_MESSAGE",
      actor: "child",
      payload: { taskId: `tsk_${i % 5}`, content: "..." }
    } as unknown as Event);
  }
  return events;
}

/* ============================================================
 * S9-A-1 Lemma A: with maxItems undefined (the from-child call shape),
 * rollSummary can never set failClosed, so the failClosed gate rewrite
 * in runTrackingTurn is a provable no-op on the production path.
 * Fuzz over generic windows including previous chains.
 * ============================================================ */
{
  const rng = mulberry32(0xa99a01);
  function genWindow(previous: RollingSummary | undefined, turn: number): TrackingWindow {
    const decisions = Array.from({ length: Math.floor(rng() * 5) }, (_, i) => `decision t${turn}#${i}`);
    return {
      ...(previous !== undefined ? { previous } : {}),
      contextFacts: ["fact"],
      toolSituations: [],
      constraints: Array.from({ length: Math.floor(rng() * 4) }, (_, i) => ({
        id: `c_t${turn}#${i}`,
        text: `text ${i}`,
        kind: "constraint" as const,
        mandatory: true as const
      })),
      unresolvedDecisions: decisions,
      confirmedDecisions: decisions.filter(() => rng() < 0.3),
      openMinors: []
    };
  }
  for (let episode = 0; episode < 300; episode += 1) {
    let previous: RollingSummary | undefined;
    const turns = 2 + Math.floor(rng() * 14);
    for (let turn = 0; turn < turns; turn += 1) {
      // maxItems deliberately NEVER set: the from-child call shape
      const rolled = rollSummary({
        window: genWindow(previous, turn),
        prescore: Number(rng().toFixed(4)),
        human: { kind: "unobserved" },
        score: Number(rng().toFixed(4)),
        anomalyCodes: [],
        evidenceRefs: [`evd_${turn}`],
        openMinors: []
      });
      check(
        "S9-A-1 Lemma A (no maxItems => failClosed is impossible)",
        rolled.summary.failClosed === false,
        `episode ${episode} turn ${turn}`
      );
      previous = rolled.summary;
    }
  }
  console.log("S9-A-1 Lemma A: 300 episode chains (2-15 turns), failClosed===false in all rollSummary outputs without maxItems");
}

/* ============================================================
 * S9-A-1 candidate machinery: call-site-specialized stripped turn.
 * Verbatim replica of runTrackingTurn's live prefix; skips ONLY the
 * dead tail on the from-child path: readers block (no readers are ever
 * passed), anomalyCodes copy, rollSummary, the failClosed gate rewrite
 * (a no-op by Lemma A), packet construction, readersInvoked.
 * Keeps the duplicate computePrescore (S1-A-2 stays closed) and every
 * gate/score/human-relevant computation bit-for-bit.
 * ============================================================ */
function derivedClaimedVerificationWithoutChecksReplica(input: TrackingTurnInput): boolean {
  if (input.gateFacts?.claimedVerificationWithoutChecks !== undefined) {
    return input.gateFacts.claimedVerificationWithoutChecks;
  }
  const required = input.prescoreInput.requiredChecks;
  const completed = input.prescoreInput.completedChecks;
  const requiredCheckGap =
    required.length > 0 && !required.every((id) => completed.includes(id));
  return input.prescoreInput.claims.some(isSuccessClaim) && requiredCheckGap;
}

function strippedTurnProjection(input: TrackingTurnInput): {
  readonly P: number;
  readonly human: HumanSignal;
  readonly score: number;
  readonly gate: GateDecision;
} {
  const config = input.config ?? DEFAULT_TRACKING_CONFIG;
  const openMinors = mergeOpenMinors(input.window.previous?.openMinors ?? [], input.window.openMinors);
  const lightMinorCount =
    input.prescoreInput.lightMinorCount ??
    openMinors.filter((item) => item.status === "verified-true").length;
  const prescore = computePrescore({
    ...input.prescoreInput,
    lightMinorCount
  });
  const userText = input.humanInput.userText ?? input.window.userText;
  const human = extractHumanScore({
    ...(input.humanInput.list !== undefined ? { list: input.humanInput.list } : {}),
    ...(userText !== undefined ? { userText } : {})
  });
  const obviousProblem = hasObviousHumanProblem(human);
  const score = combineScore({ P: prescore.P, human, obviousProblem });
  const safetyRejected = input.gateFacts?.safetyRejected ?? (human.kind === "ratio" && human.safetyRejected);
  const userRejectStop =
    input.gateFacts?.userRejectStop ?? (human.kind === "short-rule" && human.bucket === "whole-reject");
  const gate = evaluateGates({
    P: prescore.P,
    score,
    human,
    config,
    deterministicFail: input.gateFacts?.deterministicFail ?? false,
    ownershipEscape:
      input.gateFacts?.ownershipEscape ?? input.window.toolSituations.some((tool) => tool.escaped),
    claimedVerificationWithoutChecks: derivedClaimedVerificationWithoutChecksReplica(input),
    repeatedNoProgress: input.gateFacts?.repeatedNoProgress ?? input.prescoreInput.stalledTurns >= 2,
    userRejectStop,
    safetyRejected,
    openMinors
  });
  // Lemma A: no maxItems on this path => summary.failClosed === false =>
  // the full turn's failClosed gate rewrite never fires; gate is final here.
  return { P: prescore.P, human, score, gate };
}

// verbatim replica of from-child's private evidenceRefsOf
function evidenceRefsOfReplica(observation: ChildObservation): string[] {
  const refs = new Set<string>();
  for (const id of observation.evidenceIds) refs.add(id);
  for (const id of observation.verification?.evidenceIds ?? []) refs.add(id);
  return [...refs];
}

// candidate assessChildObservation: verbatim except the stripped turn;
// the decision drops the dead public carriers prescore/turn (zero src/ readers)
function candidateAssess(input: {
  readonly observation: ChildObservation;
  readonly episodeId: string;
  readonly runId: string;
}): { readonly apply: false } | { readonly apply: true; readonly assessment: TrackingAssessment } {
  const verification = input.observation.verification;
  if (verification === undefined || (verification.kind !== "PASSED" && verification.kind !== "FAILED")) {
    return { apply: false };
  }
  const prescoreInput = import_prescoreInputFromObservation(input.observation);
  const prescore = computePrescore(prescoreInput);
  const hasHardPassOrFail = prescore.dimensions.some(
    (dimension) => dimension.hardRelated && (dimension.outcome === "PASS" || dimension.outcome === "FAIL")
  );
  if (
    !shouldApplyThreeLine({
      verificationKind: verification.kind,
      coverage: prescore.coverage,
      hasHardPassOrFail
    })
  ) {
    return { apply: false };
  }
  const failRefs = evidenceRefsOfReplica(input.observation);
  if (prescore.dimensions.some((dimension) => dimension.outcome === "FAIL") && failRefs.length === 0) {
    return { apply: false };
  }
  const window = {
    contextFacts: [`role ${input.observation.role}`, `task ${input.observation.taskId}`],
    toolSituations: prescoreInput.toolSituations,
    constraints: input.observation.constraints,
    unresolvedDecisions: [],
    confirmedDecisions: [],
    openMinors: []
  };
  const turn = strippedTurnProjection({
    window,
    prescoreInput,
    humanInput: {},
    gateFacts: { deterministicFail: verification.kind === "FAILED" }
  });
  return {
    apply: true,
    assessment: {
      schemaVersion: 1,
      episodeId: input.episodeId,
      runId: input.runId,
      turnId: input.observation.taskId,
      prescore: prescore.displayPrescore,
      quality: prescore.quality,
      coverage: prescore.coverage,
      human: turn.human,
      score: turn.score,
      dimensions: prescore.dimensions.map((dimension) => {
        const verdict = dimension.outcome === "ABSTAIN" ? "UNOBSERVED" : dimension.outcome;
        if (verdict === "FAIL") {
          return { id: dimension.id, verdict, evidenceRefs: failRefs };
        }
        return { id: dimension.id, verdict };
      }),
      gate: turn.gate,
      evidenceRefs: failRefs
    }
  };
}
import { prescoreInputFromObservation as import_prescoreInputFromObservation } from "/workspace/src/tracking/from-child.js";

// candidate applyChildThreeLine: verbatim except candidateAssess
function candidateApplyChildThreeLine(input: Parameters<typeof applyChildThreeLine>[0]): {
  readonly events: readonly Event[];
  readonly result: GateApplyResult;
} {
  const skipped: GateApplyResult = { applied: false, directive: "none", runStatus: "RUNNING" };
  const terminal = input.child.terminalResult;
  if (terminal === undefined) {
    return { events: input.events, result: skipped };
  }
  const episodeId = episodeIdFromEvents(input.events);
  if (episodeId === undefined) {
    return { events: input.events, result: skipped };
  }
  const runId = input.events[0]?.runId;
  if (runId === undefined) {
    return { events: input.events, result: skipped };
  }
  const observation = observationFromChild(input.child, input.spec, input.contract);
  const assessed = candidateAssess({ observation, episodeId, runId });
  if (!assessed.apply) {
    return { events: input.events, result: skipped };
  }
  return applyTrackingGate({
    events: input.events,
    assessment: assessed.assessment,
    assessmentHash: hashAssessment(assessed.assessment),
    expectedSeq: nextTrackingSeq(input.events),
    policyVersion: "track-v1",
    nowIso: input.nowIso,
    generateEventId: input.generateEventId
  });
}

/* ============================================================
 * S9-A-1 Lemma B (projection closure) + end-to-end equivalence fuzz:
 * over child-outcome shapes (PASSED/FAILED/UNOBSERVED/absent verification,
 * roles, acceptance, contract constraints, evidence shapes, adversarial
 * summaries), the candidate produces bit-identical {events, result}
 * through applyChildThreeLine, and identical skip-path reference identity.
 * ============================================================ */
{
  const rng = mulberry32(0xa99a02);
  type ChildShape = Parameters<typeof applyChildThreeLine>[0]["child"];
  type SpecShape = Parameters<typeof applyChildThreeLine>[0]["spec"];

  for (let trial = 0; trial < 4000; trial += 1) {
    const vroll = rng();
    const verification =
      vroll < 0.8
        ? {
            kind: vroll < 0.45 ? ("PASSED" as const) : vroll < 0.7 ? ("FAILED" as const) : ("UNOBSERVED" as const),
            evidenceIds: rng() < 0.8 ? [`evd_v_${trial}`, "evd_shared"] : []
          }
        : undefined;
    const child = {
      taskId: `tsk_${trial % 7}`,
      outcome: pick(rng, ["SUCCESS", "PARTIAL", "FAILURE", "CANCELLED", "TIMEOUT"] as const),
      summary: pick(rng, ["tests passed", "child completed the task", "", "wip", "回滚全部 rollback", "verified output"]),
      evidenceIds: rng() < 0.75 ? [`evd_${trial}`, "evd_shared"] : [],
      artifactIds: rng() < 0.5 ? [`art_${trial}`] : [],
      ...(rng() < 0.9 ? { terminalResult: { ...(verification !== undefined ? { verification } : {}) } } : {})
    } as unknown as ChildShape;
    const spec =
      rng() < 0.8
        ? ({
            role: pick(rng, ["tester", "implementer", "scout"]),
            acceptanceCriteria: Array.from({ length: Math.floor(rng() * 4) }, (_, i) => ({
              id: `chk_${i}`,
              description: `criterion ${i}`
            }))
          } as unknown as SpecShape)
        : undefined;
    const contract =
      rng() < 0.5
        ? ({
            constraints: Array.from({ length: Math.floor(rng() * 5) }, (_, i) => ({
              id: `con_${i}`,
              description: `constraint ${i}`
            }))
          } as unknown as RequirementContract)
        : undefined;
    const shape = rng();
    const events =
      shape < 0.8
        ? buildEventTable({ attached: true, filler: Math.floor(rng() * 45) })
        : shape < 0.9
          ? buildEventTable({ attached: false, filler: Math.floor(rng() * 10) })
          : [];
    let c1 = 100;
    let c2 = 100;
    const base = {
      events,
      child,
      nowIso: NOW_ISO,
      ...(spec !== undefined ? { spec } : {}),
      ...(contract !== undefined ? { contract } : {})
    };
    const expected = applyChildThreeLine({
      ...base,
      generateEventId: () => `evt_${String(c1++).padStart(8, "0")}` as EventId
    });
    const actual = candidateApplyChildThreeLine({
      ...base,
      generateEventId: () => `evt_${String(c2++).padStart(8, "0")}` as EventId
    });
    check(
      "S9-A-1 e2e equivalence (result)",
      JSON.stringify(expected.result) === JSON.stringify(actual.result),
      `trial ${trial}`
    );
    check(
      "S9-A-1 e2e equivalence (events)",
      JSON.stringify(expected.events) === JSON.stringify(actual.events),
      `trial ${trial}`
    );
    check(
      "S9-A-1 skip-path reference identity matches",
      (expected.events === events) === (actual.events === events),
      `trial ${trial}`
    );
    // inner projection cross-check on apply paths: full runTrackingTurn vs
    // stripped projection agree on {P, human, score, gate} bit-for-bit
    if (expected.result.applied) {
      const observation = observationFromChild(child, spec, contract);
      const decision = assessChildObservation({ observation, episodeId: "ep_bench", runId: String(RUN_ID) });
      check("S9-A-1 inner apply agreement", decision.apply === true, `trial ${trial}`);
      if (decision.apply) {
        const prescoreInput = import_prescoreInputFromObservation(observation);
        const turnInput: TrackingTurnInput = {
          window: {
            contextFacts: [`role ${observation.role}`, `task ${observation.taskId}`],
            toolSituations: prescoreInput.toolSituations,
            constraints: observation.constraints,
            unresolvedDecisions: [],
            confirmedDecisions: [],
            openMinors: []
          },
          prescoreInput,
          humanInput: {},
          gateFacts: { deterministicFail: observation.verification?.kind === "FAILED" }
        };
        const full = runTrackingTurn(turnInput);
        const stripped = strippedTurnProjection(turnInput);
        check(
          "S9-A-1 Lemma B projection closure (P/human/score/gate bit-equal)",
          full.P === stripped.P &&
            JSON.stringify(full.human) === JSON.stringify(stripped.human) &&
            full.score === stripped.score &&
            JSON.stringify(full.gate) === JSON.stringify(stripped.gate),
          `trial ${trial}`
        );
      }
    }
  }
  console.log("S9-A-1 Lemma B + e2e: 4000 fuzz trials bit-equal (events, result, skip identity, projection closure)");
}

/* ============================================================
 * S9-A-1 bench: dead-tail cost per turn at from-child scale
 * (PASSED shape: no packet; FAILED shape: hard gate -> packet built),
 * end-to-end applyChildThreeLine delta, x ~5 gates/run.
 * ============================================================ */
{
  function mkChild(kind: "PASSED" | "FAILED"): {
    child: Parameters<typeof applyChildThreeLine>[0]["child"];
    spec: Parameters<typeof applyChildThreeLine>[0]["spec"];
    contract: RequirementContract;
  } {
    return {
      child: {
        taskId: "tsk_bench",
        outcome: kind === "PASSED" ? "SUCCESS" : "FAILURE",
        summary: "tests ran",
        evidenceIds: ["evd_1"],
        artifactIds: ["art_1"],
        terminalResult: { verification: { kind, evidenceIds: ["evd_1"] } }
      } as unknown as Parameters<typeof applyChildThreeLine>[0]["child"],
      spec: {
        role: "tester",
        acceptanceCriteria: [{ id: "chk_0", description: "tests pass" }]
      } as unknown as Parameters<typeof applyChildThreeLine>[0]["spec"],
      contract: {
        constraints: [
          { id: "con_0", description: "keep scope" },
          { id: "con_1", description: "no new deps" },
          { id: "con_2", description: "tests stay green" }
        ]
      } as unknown as RequirementContract
    };
  }

  // (a) per-turn dead tail: full runTrackingTurn vs stripped projection
  for (const kind of ["PASSED", "FAILED"] as const) {
    const { child, spec, contract } = mkChild(kind);
    const observation = observationFromChild(child, spec, contract);
    const prescoreInput = import_prescoreInputFromObservation(observation);
    const turnInput: TrackingTurnInput = {
      window: {
        contextFacts: [`role ${observation.role}`, `task ${observation.taskId}`],
        toolSituations: prescoreInput.toolSituations,
        constraints: observation.constraints,
        unresolvedDecisions: [],
        confirmedDecisions: [],
        openMinors: []
      },
      prescoreInput,
      humanInput: {},
      gateFacts: { deterministicFail: kind === "FAILED" }
    };
    const full = bench(() => void runTrackingTurn(turnInput), 50000);
    const stripped = bench(() => void strippedTurnProjection(turnInput), 50000);
    console.log(
      `S9-A-1 bench turn tail (${kind}${kind === "FAILED" ? ", packet built" : ", no packet"}): full=${(full * 1e6).toFixed(0)}ns stripped=${(stripped * 1e6).toFixed(0)}ns dead-tail=${((full - stripped) * 1e6).toFixed(0)}ns/turn (x~5 turns/run)`
    );
  }

  // (b) end-to-end applyChildThreeLine delta at E=41
  for (const kind of ["PASSED", "FAILED"] as const) {
    const { child, spec, contract } = mkChild(kind);
    const events = buildEventTable({ attached: true, filler: 39 });
    const cur = bench(() => {
      let c = 100;
      void applyChildThreeLine({
        events,
        child,
        spec,
        contract,
        nowIso: NOW_ISO,
        generateEventId: () => `evt_${String(c++).padStart(8, "0")}` as EventId
      });
    }, 10000);
    const cand = bench(() => {
      let c = 100;
      void candidateApplyChildThreeLine({
        events,
        child,
        spec,
        contract,
        nowIso: NOW_ISO,
        generateEventId: () => `evt_${String(c++).padStart(8, "0")}` as EventId
      });
    }, 10000);
    console.log(
      `S9-A-1 bench e2e (${kind}, E=41, contract 3 constraints): current=${(cur * 1e3).toFixed(2)}us cand=${(cand * 1e3).toFixed(2)}us delta=${((cur - cand) * 1e6).toFixed(0)}ns/gate (x~5 gates/run)`
    );
  }
}

/* ============================================================
 * Budget anchor matrix (R3-A..R8-A lineage + R7-I configured-state):
 * applyChildThreeLine end-to-end at real scale (41-event table) across
 * gate-outcome x contract cells. The PASSED/no-contract cell is the
 * historical lineage anchor; FAILED and contract cells close the
 * configured-state measurement holes for this slice.
 * ============================================================ */
{
  const cells: Array<{ label: string; kind: "PASSED" | "FAILED"; withContract: boolean }> = [
    { label: "PASSED x no-contract (lineage anchor)", kind: "PASSED", withContract: false },
    { label: "PASSED x contract(3)", kind: "PASSED", withContract: true },
    { label: "FAILED x contract(3) (hard gate, 3 events appended)", kind: "FAILED", withContract: true }
  ];
  const events = buildEventTable({ attached: true, filler: 39 });
  for (const cell of cells) {
    const child = {
      taskId: "tsk_bench",
      outcome: cell.kind === "PASSED" ? ("SUCCESS" as const) : ("FAILURE" as const),
      summary: "tests ran",
      evidenceIds: ["evd_1"],
      artifactIds: ["art_1"],
      terminalResult: { verification: { kind: cell.kind, evidenceIds: ["evd_1"] } }
    } as unknown as Parameters<typeof applyChildThreeLine>[0]["child"];
    const spec = {
      role: "tester",
      acceptanceCriteria: [{ id: "chk_0", description: "tests pass" }]
    } as unknown as Parameters<typeof applyChildThreeLine>[0]["spec"];
    const contract = {
      constraints: [
        { id: "con_0", description: "keep scope" },
        { id: "con_1", description: "no new deps" },
        { id: "con_2", description: "tests stay green" }
      ]
    } as unknown as RequirementContract;
    let applied = false;
    let appendedCount = 0;
    const one = bench(() => {
      let c = 100;
      const out = applyChildThreeLine({
        events,
        child,
        spec,
        ...(cell.withContract ? { contract } : {}),
        nowIso: NOW_ISO,
        generateEventId: () => `evt_${String(c++).padStart(8, "0")}` as EventId
      });
      applied = out.result.applied;
      appendedCount = out.events.length - events.length;
    }, 5000);
    check(`anchor cell applies the gate [${cell.label}]`, applied);
    console.log(
      `anchor [${cell.label}]: one applyChildThreeLine over 41-event table = ${(one * 1e3).toFixed(1)}us (+${appendedCount} events) -> ~5 gates/run => ~${(one * 5 * 1e3).toFixed(0)}us/run`
    );
  }
}

void mulberry32(0xa99a03);
void mulberry32(0xa99a04);
void UNOBSERVED;
void ({} as ConstraintRecord);

if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```
