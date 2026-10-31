# R7-A：`src/tracking/` + `src/run/{child-tracking,gate-apply}.ts` 第七遍搜查报告

**战役:** 全库持久 SOTA 优化 Round 7 / R7-A（Round 1–6 同区第七遍）
**基线:** `cursor/sota-persistent-opt-83a1` @ `2b85f51`（含 S6-C / S6-F-1 / S5-I-1 落地与 S6-G-1..7 排除）
**分支:** `cursor/r7-a-tracking-seventh-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动；整片预算收口第五次复核成立。**
切片 14 个文件自 R1-A 基线（`7acb666`）经 R2-A / R3-A / R4-A / R5-A / R6-A
至本轮基线（`2b85f51`）**逐字节未变**（`git diff 7acb666..2b85f51 --
src/tracking/ src/run/child-tracking.ts src/run/gate-apply.ts` 为空）。调用面
同样未变：R6-A 基线（`07c7b3e`）以来 `src/` 仅 `src/cli/main.ts`（S5-I-1）、
`src/experiments/canary.ts` / `src/experiments/shadow.ts`（S6-F-1）、
`src/routing/offline-logit.ts`（S6-C）变动，不触及本切片及其调用方；全库
grep 复核生产调用方仍为 `supervisor.ts`（applyTrackingGate/nextTrackingSeq）/
`coordinator.ts` / `flowchart-run.ts`（applyChildThreeLine），每子结果一次
（~5 次/run），事件表几十级（41）。R6-A 的 ~81–86 µs/run 预算天花板经本轮
实测复核为 **~86–90 µs/run**（同带），量级结论不变。在完整排除表之上以新
角度第七遍枚举，得到 4 个此前未点名的新候选（S7-A-1 … S7-A-4），全部经
理论 + 确定性仿真（seeded mulberry32，等价 fuzz + 真实规模基准，两次独立
运行结论逐位一致）裁决后淘汰：1 个**不等价**（可观察的舍入后发散
13631 例，且反例落在生产常量 H=0.35 上），1 个**实测负优化**（理论被仿真
推翻第四例），2 个等价但收益在 ns–个位 µs 噪声带（其中 1 个被已否决的
S2-A-1 严格量级支配）。未重开任何 X* / S1-* / S2-* / S3-* / S4-* / S5-* /
S6-* 条目。

## 0. 范围与约束遵守

- 切片：`src/tracking/`（12 文件）+ `src/run/child-tracking.ts` +
  `src/run/gate-apply.ts`，全部实际读码。
- 先读并遵守（顺序强制）：README / EXCLUSIONS.md（全表）/ round-07/PLAN.md /
  round-01/R1-A.md … round-06/R6-A.md。候选枚举刻意绕开全部既有排除
  （X0-4、X0-6、X1-1、X2-4、S1-A-1..9、S2-A-1..6、S3-A-1..4、S4-A-1..3、
  S5-A-1..3、S6-A-1..3、S6-G-7 及全部无 ID 收口裁决），只探索**未被点名的
  第七组新角度**：跨模块常量传播（S7-A-1）、集合构造中间拼接数组消除
  （S7-A-2）、常见路径死分配守卫（S7-A-3）、加权组合代数重排（S7-A-4）。
- 换名重提检查（识别为既有方案换名/换位点，**未列为新候选**）：
  - `turn.ts` 调用 `combineScore` 时 `isMachineScore(P)` 入口校验在
    `computePrescore` 保证 [0,1] 下是死校验——消除 = S3-H-1「删防御纵深」
    类，且 R6-A 已对 combined-score 收口为「边界防御保留」，维持不动；
  - `mergeOpenMinors` 的 `previous.map(item => [item.id, item])` tuple
    中间数组消除 = S7-A-2 同形的另一位点，且该路径生产恒空输入已被
    S3-A-4 点名——并入 S7-A-2 裁决，不另立 ID；
  - `applyChildThreeLine` 的 `runId` O(1) 守卫前置到 `episodeIdFromEvents`
    之前 = 守卫重排：非空事件表下 runId 恒有定义，空表下
    `episodeIdFromEvents` 本就零迭代，重排零收益且属不可达防御纵深面
    （S4-J-1 同类），拒列；
  - `hashAssessment` 维度 id 闭枚举下 `localeCompare` 换码点比较
    = S3-B-3 换位点，R6-A §0 已拒列过一次，维持不重开；
  - `gate-apply.ts` `existing` find 谓词把 `idempotencyKey` 字符串比较换
    hash+seq 双字段比较——复合键无论如何都要构造（写入 payload），谓词
    改写属微观常数（S1-A-8/S2-A-4 族），拒列。
- 公开 API、版本化阈值（softThreshold 0.55 / hardFailCap 0.3 /
  minorPDip 0.03）、哈希契约、事件 schema、CAS/幂等键格式全部不变——
  本轮零 diff，天然满足。三线规格（分析不改 in-flight、Tracking 无命令权、
  H/score 不写路由、live = R0 等价、双 LCB 双归因保留、提升 proposal-first）
  同样天然满足。不声称 Outcome-supported；Checkpoint F-PROD 仍开放（ADR-005）。

## 1. 预算支配论证复核（方法第 1 步，不假设直接实测）

R3-A §3 / R4-A §1 / R5-A §1 / R6-A §1 的整片预算论证依赖两个前提，本轮逐一复核：

1. **切片代码未变**：`git diff 7acb666..2b85f51 -- <切片>` 为空，逐字节一致
   （七遍全程零 diff）。
2. **调用面未变**：`07c7b3e..2b85f51` 间 `src/` 仅 4 个切片外文件变动
   （见结论节），不触及切片；生产调用方经全库 grep 复核不变。
   **无新热路径，无量级变化。**

本轮在当前 VM 重测预算锚点（两次独立运行）：

```text
anchor: one applyChildThreeLine over 41-event table = 17.2–17.9 µs（apply 全路径）
=> ~5 gates/run => 切片每 run 总预算 ≈ 86–90 µs
```

与 R3-A（19.0–22.8 µs/gate）、R4-A（12.1–12.3）、R5-A（19.2–20.1）、
R6-A（16.2–17.3）同带；量级结论不变：即使把整个切片优化到零成本，节省
上界 ~0.1 ms/run，仍比战役落地线（数十~数百 ms 或复杂度类下降）低
**约三个量级**。复杂度类下降的仅存位点维持既有排除（X0-4/X2-4 事件表
索引化、S1-A-1/S1-A-9 反向早退、X1-1 hashSummary 跨调用缓存、S6-G-7
读侧内存镜像、R1-A 裁决的不可变累计快照构造下界）。
**支配论证第五次复核成立，本切片在当前数据面规模下维持预算收口。**

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S7-A-1 | from-child 路径 human 管道**跨模块常量折叠**：`runTrackingTurn` 的唯一生产入口（`assessChildObservation`，`humanInput={}`、window 无 `userText`、`gateFacts={deterministicFail}`）上整条 human 管道是常量——`extractHumanScore ≡ {kind:"unobserved"}`、`obviousProblem ≡ false`、`score ≡ roundScore(P) ≡ P`（toFixed(4) 幂等引理）、`safetyRejected ≡ false`、`userRejectStop ≡ false`、`packet.H ≡ UNOBSERVED` | 免每 turn 一次 extractHumanScore（含入参构造）+ hasObviousHumanProblem + combineScore（含 isMachineScore + toFixed 舍入）+ 两条 ?? 派生链 | ✅ 幂等引理 20000 fuzz（`combineScore(P,unobserved,false) === P` 逐位）+ 5000 组 from-child 形态全 turn 副本对比 JSON 逐位一致 | 被折叠管道实测 **161.6–163.1 ns/turn**；全 turn delta 336–689 ns/turn ≈ **1.7–3.4 µs/run** | 淘汰：利用折叠需 call-site 特化的平行 turn 路径（X1-2 类）或给 `runTrackingTurn` 开公开旗标（S5-A-3/S6-A-3 同拒绝结构）；收益低于落地线四个量级 |
| S7-A-2 | `roller.ts` `uniqueStrings` 双段输入**中间拼接数组消除**：两处调用 `uniqueStrings([...a, ...b])` 各构造一个用完即弃的拼接数组；候选改双循环 Set add（插入序 = 拼接序，输出逐位同） | 免每 turn 2 个 O(累计量) 中间数组分配 | ✅ 插入序引理 + 200 条 episode 链（40% 紧 maxItems 截断路径）JSON 逐位一致 | 12-turn 链 delta **3.17–3.68 µs（6.1–7.0%）**，方向稳定 | 淘汰：被已否决 S2-A-1 严格量级支配（同 harness 上整套 mandatory 机器跳过省 11.3–12.1 µs 都被否决）；S1-J-7/S3-A-1「结构等价冗余分配移除、真实规模噪声」同族 |
| S7-A-3 | `gates.ts` `evaluateGates` 常见路径 **hardCodes 空数组死分配守卫**：全部六个硬旗标 false（生产常态）时现行仍分配 `hardCodes=[]` 并跑六个条件 push；候选用一次六旗标析取前置守卫，仅在命中时分配 | 常见路径免 1 次数组分配 + 6 次条件判断 | ✅ 8000 组 fuzz（六旗标全组合 × minors 全形态）JSON 逐位一致 + `openMinors` 别名身份一致 | **实测负优化**：常见路径 delta −0.6 ~ −2.3 ns（候选更慢，两次运行同向） | 淘汰：负优化。空数组字面量 + 恒不执行的 push 在 V8 上近零成本，而析取守卫在两条路径上都加读取——纯理论常数直觉被仿真推翻**第四例**（S1-A-4 / S2-A-4 / S5-A-2 之后） |
| S7-A-4 | `combined-score.ts` 加权组合**代数重排**：`0.7*Math.min(H,P) + 0.3*Math.max(H,P)` 换 `0.3*(H+P) + 0.4*Math.min(H,P)`（实数上恒等，少一次 Math 调用） | 免 1 次 Math.max/乘法 | ❌ **不等价**：网格（129 个现实 H 源 × 10001 点 P 格）原始值发散 **465206** 例、均匀 fuzz 发散 69423/200000（~35%）；**舍入后可观察发散 13631 例**，首反例 `H=0.35（operation-reject 生产常量）, P=0.0055 → 0.1089 vs 0.1088`——score 进入 `hashAssessment` 载荷与 TRACKING_ASSESSMENT 事件，单点发散即哈希链与事件表可观察发散 | 即便等价也仅省 0.01–0.08 ns/组合，且仅 observed-human 路径执行 | 淘汰：**双重否决**——不等价（比 S6-A-1 更强：S6-A-1 发散集测度薄需构造，本例反例直接落在 short-rule 生产常量 H=0.35 与日常 P 格点上）+ 收益为零级。X2-1/X2-3「非逐位一致」家族在本切片得分契约位点的具体化证据 |

## 3. 关键裁决细节

### S7-A-4 的可观察发散（本轮最重要的健全性证据）

与 S6-A-1（toFixed vs Math.round，发散集测度薄、需网格构造）不同，本候选
的发散在**现实输入上直接可达**：`H=0.35` 是 `extractShortRule` 的
operation-reject 生产常量，P 是 4 位小数格点的日常值。两条表达式的浮点
求值顺序不同（`0.7*min + 0.3*max` vs `0.3*(H+P) + 0.4*min`），中间舍入
误差 ~1 ulp，在 toFixed(4) 的舍入边界附近被放大为末位差 0.0001。网格扫描
13631 个舍入后发散点确定性重现（两次运行计数与首反例逐位一致）。score
写入 `TRACKING_ASSESSMENT.payload.assessment.score` 并参与
`hashAssessment`——单点发散即幂等键与事件表发散。按 S1-A-9/S6-A-1 的
健全性标准直接淘汰，为「加权组合表达式重排」类提案立此反例。

### S7-A-3 的反向教训（理论被仿真推翻第四例）

「六旗标全 false 时跳过空数组分配与六个条件」在纸面上必然不亏，实测两次
运行候选都更慢（−0.6 / −2.3 ns）。V8 对空数组字面量 + 恒假分支的 push
已近零成本（逃逸分析 + 分支预测），而前置析取让硬路径旗标被读两遍、
常见路径多一层判断。与 S1-A-4（Set 构建开销 > 短数组线性扫）、S2-A-4
（concat 慢于 spread+push）、S5-A-2（手写序列化慢于 JSON.stringify 内建）
并列为「纯理论常数直觉在 V8 真实路径上反转」的第四个记录案例。

### S7-A-1 的幂等引理（记录备查）

from-child 路径上 `score ≡ P` 的关键是 `roundScore` 幂等：P 已是
`Number(x.toFixed(4))` 的输出（最接近某 4 位十进制格点 d 的 double，
|P−d| ≤ ulp/2 ≈ 1e-16 ≪ 5e-5 半格距），再走一次 `Number(P.toFixed(4))`
必回到同一格点。20000 组 fuzz 逐位验证（含乘积形态 P）。引理成立但
无处安放：特化 = X1-2 平行路径，旗标 = 公开签名（S5-A-3/S6-A-3 同拒绝
结构），且全部收益 1.7–3.4 µs/run 在预算收口内四个量级之下。若未来
`runTrackingTurn` 出现带真实 human 输入的高频生产调用方、且 from-child
路径占比坍缩，可凭本引理与 5000 组全 turn fuzz 重开。

### S7-A-2 的支配论证

被消除的两个中间数组是 S2-A-1「整套 mandatory 机器跳过」所覆盖机器的
真子集之外的另两处分配，但量级同带：3.17–3.68 µs/12-turn 链，严格小于
S2-A-1 实测的 11.3–12.1 µs——而 S2-A-1 已按门槛 (c) 否决。方向稳定
（两次 6.1–7.0%）说明不是抖动，但绝对量比落地线低约四个量级。滚轮
mandatory 集达数千级时与 S2-A-1 一并重开。

### 逐文件收口（第七遍新角度复查）

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `turn.ts` | human 管道常量折叠（本文件七遍来最后一处未点名跨模块结构）；`combineScore` 入口死校验消除 = S3-H-1 族拒列（见 §0）；S1-A-7 / S2-A-3 / S3-A-2/3/4 / S4-A-1 / S5-A-1 收口维持 | S7-A-1 淘汰 |
| `roller.ts` | uniqueStrings 中间拼接消除（S1-A-5 / S2-A-1 / S3-A-1 三层收口后仅剩的分配位点）；mergeConstraints 已是双循环无中间数组 | S7-A-2 淘汰 |
| `gates.ts` | hardCodes 死分配守卫（S1-A-6 融合收口之外的分配角度） | S7-A-3 淘汰 |
| `combined-score.ts` | 加权组合代数重排（S6-A-1 舍入链之外的表达式重排角度）；isMachineScore 边界防御维持保留 | S7-A-4 淘汰 |
| `from-child.ts` | S1-A-2 / S2-A-2/6 / S4-A-3 / S5-A-3 / S6-A-2/3 六层收口维持；无剩余未点名结构 | 无新候选 |
| `prescore.ts` | S1-A-4 / S3-A-3 / S6-A-1 收口维持；evidenceOutcome/scopeOutcome 的 some 序全部有同类裁决 | 无新候选 |
| `gate-apply.ts` | idempotencyKey find 谓词分量比较拒列（见 §0）；双 find / currentGateStatus / nextTrackingSeq 维持 X2-4/X0-4/S1-A-1/S1-A-9；双 hashAssessment 维持 CAS fail-closed 契约裁决；`mapGateDirective` FAIL_CLOSED 兜底维持保留 | 无新候选 |
| `child-tracking.ts` | runId 守卫前置拒列（见 §0）；5 次事件表扫描维持 X2-4/X0-4；S4-A-2 预检提升、S6-G-7 读侧镜像收口维持 | 无新候选 |
| `human-score.ts` | X0-6 / S1-A-3 / R3-A「X0-6 对偶面」/ R5-A 正则频次重排不等价收口维持 | 无新候选 |
| `types.ts` | hashAssessment 闭枚举码点化拒列（S3-B-3 换位点，R6-A 已拒，见 §0）；S2-A-5 / S5-A-2 / X0-5 / S1-A-8 收口维持 | 无新候选 |
| `analysis.ts` / `isolation.ts` / `config.ts` / `index.ts` | 一次性构造 / O(1) 谓词 / 常量 / 纯再导出 | 无新候选 |

## 4. 前后对比

无代码 diff。仓库变更仅本报告一个文件。仿真为临时脚本未入库（无赢家不落
仿真文件，遵守方法第 4 条；loser 仿真完整源码见附录），未触碰任何测试。

## 5. 测试

零代码改动下相关套件基线复核，全绿（与 R1-A…R6-A 同套件同计数）：

```bash
npx tsx --test "test/unit/tracking/**/*.test.ts" \
  "test/unit/run/gate-apply.test.ts" \
  "test/integration/track/**/*.test.ts"
# tests 72 / suites 13 / pass 72 / fail 0
```

全仓门禁复核：`pnpm typecheck` / `pnpm lint` / `pnpm build` 全绿
（继承脚本 lint 本轮无红，无需代为修复）。

仿真（临时脚本；seed 固定可复现，两次独立运行）：

```text
run 1:
S7-A-1 bench: folded human pipeline=163.1ns/turn | whole turn current=2032ns cand=1343ns delta=689ns/turn (x~5 turns/run)
S7-A-2 bench 12-turn episode: current=52.43us cand=48.75us delta=3.68us (7.0%)
S7-A-3 bench common path (no hard codes): current=11.5ns cand=12.1ns delta=-0.6ns/turn (x~5 turns/run)
S7-A-4 grid (|H|=129 x 10001 P): raw divergences=465206, first: H=0.35 P=0.0001 current=0.10507 cand=0.10506999999999998 | POST-ROUND divergences=13631, first: H=0.35 P=0.0055 current->0.1089 cand->0.1088 | uniform raw fuzz=69423/200000
S7-A-4 bench: current=2.76ns cand=2.68ns delta=0.08ns/blend (observed-human path only)
anchor: one applyChildThreeLine over 41-event table = 17.2us -> ~5 gates/run => ~86us/run
ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)

run 2:
S7-A-1 folded=161.6ns delta=336ns/turn | S7-A-2 delta=3.17us (6.1%) | S7-A-3 delta=-2.3ns
S7-A-4 grid: 465206 raw / 13631 post-round（计数与首反例逐位同 run 1）
anchor: 17.9us -> ~90us/run
ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

两次独立运行等价/发散结论逐位一致（S7-A-4 反例集确定性重现），全部计时
方向稳定（S7-A-3 两次均为负），裁决方向不变。

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S7-A-1 | from-child 路径 human 管道常量折叠（extractHumanScore/combineScore/safetyRejected/userRejectStop 全常量，score ≡ P 幂等引理） | 等价（20000+5000 fuzz）但需 X1-2 平行 turn 路径或公开旗标；161–163ns/turn ≈ 1.7–3.4µs/run，低于落地线四个量级 |
| S7-A-2 | roller uniqueStrings 双段输入中间拼接数组消除（双循环 Set add） | 等价且方向稳定（3.2–3.7µs/12-turn 链）但被已否决 S2-A-1（11.3–12.1µs）严格量级支配；S1-J-7/S3-A-1 同族 |
| S7-A-3 | evaluateGates 常见路径 hardCodes 空数组死分配六旗标析取守卫 | 实测负优化（−0.6~−2.3ns，两次同向）：V8 空数组字面量+恒假 push 近零成本；理论被仿真推翻第四例 |
| S7-A-4 | combineScore 加权组合代数重排（0.7min+0.3max → 0.3(H+P)+0.4min） | 不等价：舍入后可观察发散 13631 例（网格确定性），首反例 H=0.35（生产常量）P=0.0055 → 0.1089 vs 0.1088，哈希链/事件表发散；收益 0.01–0.08ns 零级 |

重开条件：S7-A-1 需先出现带真实 human 输入的高频 `runTrackingTurn` 生产
调用方（或公开旗标成本判断被推翻）；S7-A-2 与 S2-A-1 同条件（滚轮
mandatory/累计集达数千级）；S7-A-3 需先推翻本报告基准（V8 分配路径大改）；
S7-A-4 需先推翻反例（即证明生产 (H,P) 值域与全部发散点不交并固化为契约——
现无此契约，且 H=0.35 常量在值域内）。整片预算支配论证（§1）的重开条件
不变：run 事件表或每 turn 集合规模增长 ≥2–3 个量级，届时 S1-A-1、S2-A-1、
S2-A-3、S4-A-1、S7-A-2 可凭既有等价性证据优先重开。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.ts` 后 `npx tsx <file>`（仓库根目录，依赖已装）。
seeds：`0xa77a01`–`0xa77a06`。

```ts
/**
 * R7-A deterministic equivalence + benchmark simulation (seventh pass).
 * Adjudicates fresh candidates S7-A-1 .. S7-A-4 against the current
 * implementations in src/tracking + src/run/{child-tracking,gate-apply},
 * and re-verifies the whole-slice budget anchor (R3-A/R4-A/R5-A/R6-A).
 * All candidates are NEW angles not named by EXCLUSIONS.md, R1-A..R6-A.
 * Seeded PRNG (mulberry32) -> fully reproducible.
 * Seeds: 0xa77a01 .. 0xa77a06.
 */
import { performance } from "node:perf_hooks";
import { DEFAULT_TRACKING_CONFIG } from "/workspace/src/tracking/config.js";
import { combineScore } from "/workspace/src/tracking/combined-score.js";
import { evaluateGates, type GateInput } from "/workspace/src/tracking/gates.js";
import {
  extractHumanScore,
  hasObviousHumanProblem,
  humanScoreValue
} from "/workspace/src/tracking/human-score.js";
import { computePrescore, isSuccessClaim } from "/workspace/src/tracking/prescore.js";
import { rollSummary } from "/workspace/src/tracking/roller.js";
import { mergeOpenMinors, runTrackingTurn, type TrackingTurnInput, type TrackingTurnResult } from "/workspace/src/tracking/turn.js";
import {
  prescoreInputFromObservation,
  type ChildObservation
} from "/workspace/src/tracking/from-child.js";
import { applyChildThreeLine } from "/workspace/src/run/child-tracking.js";
import type { Event } from "/workspace/src/run/events.js";
import type { EventId } from "/workspace/src/domain/ids.js";
import type {
  AnomalyCode,
  AnomalyPacket,
  AnomalyPacketWindow,
  ConstraintRecord,
  GateDecision,
  HumanSignal,
  OpenMinor,
  RollingSummary,
  TrackingOmission,
  TrackingWindow
} from "/workspace/src/tracking/types.js";
import { UNOBSERVED, hashSummary } from "/workspace/src/tracking/types.js";

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

/* ============================================================
 * S7-A-1: from-child path human-pipeline constant folding.
 * On the ONLY production path into runTrackingTurn (from-child.ts,
 * humanInput = {}, window has no userText, gateFacts = {deterministicFail}),
 * the whole human pipeline is constant:
 *   extractHumanScore -> {kind:"unobserved"}; obviousProblem -> false;
 *   combineScore -> roundScore(P) === P (toFixed(4) idempotence lemma);
 *   safetyRejected -> false; userRejectStop -> false; packet.H -> UNOBSERVED.
 * Candidate = call-site-specialized runTrackingTurn replica with the
 * pipeline folded. Exploiting it needs a parallel turn path (X1-2 class)
 * or a public flag; adjudicate equivalence + measure the folded work.
 * ============================================================ */
function derivedCVWCReplica(input: TrackingTurnInput): boolean {
  if (input.gateFacts?.claimedVerificationWithoutChecks !== undefined) {
    return input.gateFacts.claimedVerificationWithoutChecks;
  }
  const required = input.prescoreInput.requiredChecks;
  const completed = input.prescoreInput.completedChecks;
  const requiredCheckGap =
    required.length > 0 && !required.every((id) => completed.includes(id));
  return input.prescoreInput.claims.some(isSuccessClaim) && requiredCheckGap;
}

function collectEvidenceReplica(window: TrackingWindow): string[] {
  const refs = new Set<string>();
  for (const tool of window.toolSituations) {
    for (const id of tool.evidenceIds) refs.add(id);
    for (const id of tool.artifactIds) refs.add(id);
    for (const hash of tool.hashes) refs.add(hash);
  }
  return [...refs];
}

function uniqueCodesReplica(codes: readonly AnomalyCode[]): AnomalyCode[] {
  return [...new Set(codes)];
}

function candidateTurnFromChild(input: TrackingTurnInput): TrackingTurnResult {
  const config = input.config ?? DEFAULT_TRACKING_CONFIG;
  const openMinors = mergeOpenMinors(input.window.previous?.openMinors ?? [], input.window.openMinors);
  const lightMinorCount =
    input.prescoreInput.lightMinorCount ??
    openMinors.filter((item) => item.status === "verified-true").length;
  const prescore = computePrescore({
    ...input.prescoreInput,
    lightMinorCount
  });
  // FOLDED: human pipeline constants on the from-child path
  const human: HumanSignal = { kind: "unobserved" };
  const score = prescore.P; // lemma: roundScore(P) === P (idempotence)

  let gate = evaluateGates({
    P: prescore.P,
    score,
    human,
    config,
    deterministicFail: input.gateFacts?.deterministicFail ?? false,
    ownershipEscape:
      input.gateFacts?.ownershipEscape ?? input.window.toolSituations.some((tool) => tool.escaped),
    claimedVerificationWithoutChecks: derivedCVWCReplica(input),
    repeatedNoProgress: input.gateFacts?.repeatedNoProgress ?? input.prescoreInput.stalledTurns >= 2,
    userRejectStop: false, // FOLDED
    safetyRejected: false, // FOLDED
    openMinors
  });

  let readersInvoked: TrackingTurnResult["readersInvoked"] = {
    toolBodies: false,
    chainOfThought: false
  };
  let toolBodies: readonly string[] | undefined;
  if (gate.expandDetail && input.readers?.readToolBodies !== undefined) {
    toolBodies = input.readers.readToolBodies();
    readersInvoked = { toolBodies: true, chainOfThought: false };
  }

  const anomalyCodes = [...gate.codes];

  const rolled = rollSummary({
    window: { ...input.window, openMinors },
    prescore: prescore.P,
    human,
    score,
    anomalyCodes,
    evidenceRefs: collectEvidenceReplica(input.window),
    openMinors,
    ...(input.maxItems !== undefined ? { maxItems: input.maxItems } : {})
  });

  let summary = rolled.summary;
  if (summary.failClosed) {
    const codes: AnomalyCode[] = uniqueCodesReplica([...summary.anomalyCodes, "mandatory-omission"]);
    summary = { ...summary, anomalyCodes: codes };
    gate = { ...gate, askUser: true, codes };
  }

  let packet: AnomalyPacket | undefined;
  if (gate.wakeAnalysis) {
    const windowDetail: AnomalyPacketWindow = {
      contextFacts: input.window.contextFacts,
      toolSituations: input.window.toolSituations,
      ...(input.window.userText !== undefined
        ? { userText: input.window.userText, userTextTrust: "UNTRUSTED_TEXT" as const }
        : {}),
      ...(input.window.aiText !== undefined ? { aiText: input.window.aiText } : {}),
      ...(toolBodies !== undefined ? { toolBodies } : {})
    };
    packet = {
      summary,
      window: windowDetail,
      P: prescore.P,
      H: UNOBSERVED, // FOLDED: humanScoreValue({kind:"unobserved"})
      score,
      gate: gate.codes[0] ?? "soft-threshold",
      evidenceRefs: summary.evidenceRefs
    };
  }

  return {
    summary,
    P: prescore.P,
    human,
    score,
    gate,
    ...(packet !== undefined ? { packet } : {}),
    readersInvoked
  };
}

function genObservation(rng: () => number, trial: number): ChildObservation {
  const nConstraints = Math.floor(rng() * 4);
  return {
    taskId: `tsk_${trial}`,
    role: pick(rng, ["implementer", "tester", "scout", "worker"]),
    outcome: pick(rng, ["SUCCESS", "PARTIAL", "FAILURE", "CANCELLED", "TIMEOUT"] as const),
    summary: pick(rng, ["tests passed", "child completed the task", "", "wip", "verified output"]),
    evidenceIds: rng() < 0.7 ? [`evd_${trial}`, "evd_shared"] : [],
    artifactIds: rng() < 0.5 ? [`art_${trial}`] : [],
    verification: {
      kind: rng() < 0.5 ? ("PASSED" as const) : ("FAILED" as const),
      evidenceIds: rng() < 0.8 ? [`evd_v_${trial}`] : []
    },
    requiredChecks: rng() < 0.5 ? (rng() < 0.5 ? ["test"] : ["chk_0", "chk_1"]) : [],
    constraints: Array.from({ length: nConstraints }, (_, i) => ({
      id: `c_${i}`,
      text: `constraint ${i}`,
      kind: "constraint" as const,
      mandatory: true as const
    }))
  };
}

function fromChildTurnInput(observation: ChildObservation): TrackingTurnInput {
  const prescoreInput = prescoreInputFromObservation(observation);
  const verification = observation.verification;
  return {
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
    gateFacts: { deterministicFail: verification?.kind === "FAILED" }
  };
}

{
  // (a) idempotence lemma: combineScore on unobserved human returns P bit-for-bit
  const rng = mulberry32(0xa77a01);
  for (let trial = 0; trial < 20000; trial += 1) {
    const P = Number((rng() * (trial % 2 === 0 ? 1 : rng())).toFixed(4));
    const score = combineScore({ P, human: { kind: "unobserved" }, obviousProblem: false });
    check("S7-A-1 lemma roundScore(P)===P", Object.is(score, P), `P=${P} score=${score}`);
  }
  // pipeline constants
  const humanEmpty = extractHumanScore({});
  check("S7-A-1 lemma extractHumanScore({}) is unobserved", JSON.stringify(humanEmpty) === JSON.stringify({ kind: "unobserved" }));
  check("S7-A-1 lemma obviousProblem is false", hasObviousHumanProblem(humanEmpty) === false);
  check("S7-A-1 lemma humanScoreValue is UNOBSERVED", humanScoreValue(humanEmpty) === UNOBSERVED);

  // (b) full-turn equivalence fuzz on from-child-shaped inputs
  for (let trial = 0; trial < 5000; trial += 1) {
    const input = fromChildTurnInput(genObservation(rng, trial));
    const expected = runTrackingTurn(input);
    const actual = candidateTurnFromChild(input);
    check(
      "S7-A-1 equivalence (specialized turn vs current)",
      JSON.stringify(expected) === JSON.stringify(actual),
      JSON.stringify(input.prescoreInput)
    );
  }

  // (c) bench: the folded-away human-pipeline work per turn, and the whole turn
  const P = 0.8333;
  const folded = bench(() => {
    const human = extractHumanScore({});
    const obvious = hasObviousHumanProblem(human);
    void combineScore({ P, human, obviousProblem: obvious });
    void humanScoreValue(human);
  }, 200000);
  const benchInput = fromChildTurnInput({
    taskId: "tsk_bench",
    role: "tester",
    outcome: "SUCCESS",
    summary: "tests passed",
    evidenceIds: ["evd_1"],
    artifactIds: ["art_1"],
    verification: { kind: "PASSED", evidenceIds: ["evd_1"] },
    requiredChecks: ["test"],
    constraints: [{ id: "c1", text: "keep scope", kind: "constraint", mandatory: true }]
  });
  const cur = bench(() => runTrackingTurn(benchInput), 20000);
  const cand = bench(() => candidateTurnFromChild(benchInput), 20000);
  console.log(
    `S7-A-1 bench: folded human pipeline=${(folded * 1e6).toFixed(1)}ns/turn | whole turn current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/turn (x~5 turns/run)`
  );
}

/* ============================================================
 * S7-A-2: roller.ts uniqueStrings two-segment intermediate-array
 * elimination. Both call sites build a throwaway concatenated array
 * [...a, ...b] before the Set; candidate feeds the Set with two loops
 * (identical insertion order -> identical output order).
 * Candidate = full replica of rollSummary with uniqueStringsPair.
 * ============================================================ */
function uniqueStringsPair(a: readonly string[], b: readonly string[]): string[] {
  const set = new Set<string>();
  for (const value of a) set.add(value);
  for (const value of b) set.add(value);
  return [...set];
}

function mergeConstraintsReplica(
  previous: readonly ConstraintRecord[],
  current: readonly ConstraintRecord[]
): ConstraintRecord[] {
  const byId = new Map<string, ConstraintRecord>();
  for (const item of previous) byId.set(item.id, item);
  for (const item of current) byId.set(item.id, item);
  return [...byId.values()];
}

function candidateRollPair(input: Parameters<typeof rollSummary>[0]): { summary: RollingSummary } {
  const previous = input.window.previous;
  const mergedConstraints = mergeConstraintsReplica(previous?.constraints ?? [], input.window.constraints);
  const unresolvedQuestions = uniqueStringsPair(
    previous?.unresolvedQuestions ?? [],
    input.window.unresolvedDecisions
  ).filter((question) => !input.window.confirmedDecisions.includes(question));
  const confirmedDecisions = uniqueStringsPair(
    previous?.confirmedDecisions ?? [],
    input.window.confirmedDecisions
  );

  const mandatory: Array<{ key: string; kind: TrackingOmission["kind"]; text?: string }> = [
    ...mergedConstraints.map((item) => ({ key: item.id, kind: item.kind, text: item.text })),
    ...unresolvedQuestions.map((question) => ({ key: question, kind: "unresolved-decision" as const }))
  ];

  const omissions: TrackingOmission[] = [];
  let keptMandatory = mandatory;
  let failClosed = false;
  let failClosedReason: string | undefined;

  if (input.maxItems !== undefined && mandatory.length > input.maxItems) {
    keptMandatory = mandatory.slice(0, input.maxItems);
    for (const dropped of mandatory.slice(input.maxItems)) {
      omissions.push({ key: dropped.key, kind: dropped.kind, mandatory: true, reason: "budget" });
    }
    failClosed = true;
    failClosedReason = "mandatory item could not fit; fail closed";
  }

  const keptIds = new Set(keptMandatory.map((item) => item.key));
  const constraints: ConstraintRecord[] = mergedConstraints.filter((item) => keptIds.has(item.id));
  const keptQuestions = unresolvedQuestions.filter((question) => keptIds.has(question));

  const prevSummaryHash = previous === undefined ? undefined : hashSummary(previous);

  const summary: RollingSummary = {
    schemaVersion: 1,
    constraints,
    unresolvedQuestions: keptQuestions,
    confirmedDecisions,
    operations: input.window.toolSituations,
    prescore: input.prescore,
    human: input.human,
    score: input.score,
    anomalyCodes: input.anomalyCodes,
    evidenceRefs: input.evidenceRefs,
    openMinors: input.openMinors,
    omissions,
    failClosed,
    ...(failClosedReason !== undefined ? { failClosedReason } : {}),
    ...(prevSummaryHash !== undefined ? { prevSummaryHash } : {})
  };
  return { summary };
}

{
  const rng = mulberry32(0xa77a02);
  function genWindow(previous: RollingSummary | undefined, turn: number): TrackingWindow {
    const decisions = Array.from({ length: Math.floor(rng() * 4) }, (_, i) => `decision t${turn}#${i}`);
    const confirmed = [
      ...decisions.filter(() => rng() < 0.3),
      ...(previous?.unresolvedQuestions ?? []).filter(() => rng() < 0.25)
    ];
    return {
      ...(previous !== undefined ? { previous } : {}),
      contextFacts: ["fact"],
      toolSituations: [],
      constraints: Array.from({ length: Math.floor(rng() * 3) }, (_, i) => ({
        id: `c_t${turn}#${i}`,
        text: `text ${i}`,
        kind: "constraint" as const,
        mandatory: true as const
      })),
      unresolvedDecisions: decisions,
      confirmedDecisions: confirmed,
      openMinors: []
    };
  }
  for (let episode = 0; episode < 200; episode += 1) {
    let prevCurrent: RollingSummary | undefined;
    let prevCandidate: RollingSummary | undefined;
    const turns = 2 + Math.floor(rng() * 14);
    const maxItems = rng() < 0.4 ? 1 + Math.floor(rng() * 10) : undefined;
    for (let turn = 0; turn < turns; turn += 1) {
      const windowCurrent = genWindow(prevCurrent, turn);
      const windowCandidate: TrackingWindow = { ...windowCurrent };
      if (prevCandidate !== undefined) {
        (windowCandidate as { previous?: RollingSummary }).previous = prevCandidate;
      } else {
        delete (windowCandidate as { previous?: unknown }).previous;
      }
      const base = {
        prescore: 0.8,
        human: { kind: "unobserved" } as HumanSignal,
        score: 0.8,
        anomalyCodes: [],
        evidenceRefs: [`evd_${turn}`],
        openMinors: [],
        ...(maxItems !== undefined ? { maxItems } : {})
      };
      prevCurrent = rollSummary({ window: windowCurrent, ...base }).summary;
      prevCandidate = candidateRollPair({ window: windowCandidate, ...base }).summary;
      check(
        "S7-A-2 equivalence",
        JSON.stringify(prevCurrent) === JSON.stringify(prevCandidate),
        `episode ${episode} turn ${turn} maxItems=${maxItems}`
      );
    }
  }
  // benchmark: same 12-turn chain harness as R1-A/R2-A/R3-A for comparability
  function chain(fn: (input: Parameters<typeof rollSummary>[0]) => { summary: RollingSummary }): void {
    const rng2 = mulberry32(0xa77a03);
    const localGen = (previous: RollingSummary | undefined, turn: number): TrackingWindow => {
      const decisions = Array.from({ length: Math.floor(rng2() * 4) }, (_, i) => `decision t${turn}#${i}`);
      return {
        ...(previous !== undefined ? { previous } : {}),
        contextFacts: ["fact"],
        toolSituations: [],
        constraints: Array.from({ length: Math.floor(rng2() * 3) }, (_, i) => ({
          id: `c_t${turn}#${i}`,
          text: `text ${i}`,
          kind: "constraint" as const,
          mandatory: true as const
        })),
        unresolvedDecisions: decisions,
        confirmedDecisions: decisions.filter(() => rng2() < 0.3),
        openMinors: []
      };
    };
    let previous: RollingSummary | undefined;
    for (let turn = 0; turn < 12; turn += 1) {
      previous = fn({
        window: localGen(previous, turn),
        prescore: 0.8,
        human: { kind: "unobserved" },
        score: 0.8,
        anomalyCodes: [],
        evidenceRefs: [`evd_${turn}`],
        openMinors: []
      }).summary;
    }
  }
  const cur = bench(() => chain(rollSummary), 3000);
  const cand = bench(() => chain(candidateRollPair), 3000);
  console.log(
    `S7-A-2 bench 12-turn episode: current=${(cur * 1e3).toFixed(2)}us cand=${(cand * 1e3).toFixed(2)}us delta=${((cur - cand) * 1e3).toFixed(2)}us (${(((cur - cand) / cur) * 100).toFixed(1)}%)`
  );
}

/* ============================================================
 * S7-A-3: gates.ts evaluateGates dead empty-array allocation guard.
 * On the common path (all six hard flags false) the current code
 * still allocates hardCodes=[] and runs six conditional pushes.
 * Candidate: one six-flag disjunction; allocate + push only inside.
 * ============================================================ */
function candidateGatesGuard(input: GateInput): GateDecision {
  if (
    input.deterministicFail ||
    input.ownershipEscape ||
    input.claimedVerificationWithoutChecks ||
    input.repeatedNoProgress ||
    input.userRejectStop ||
    input.safetyRejected
  ) {
    const hardCodes: AnomalyCode[] = [];
    if (input.deterministicFail) hardCodes.push("deterministic-fail");
    if (input.ownershipEscape) hardCodes.push("ownership-escape");
    if (input.claimedVerificationWithoutChecks) hardCodes.push("claimed-verification-without-checks");
    if (input.repeatedNoProgress) hardCodes.push("repeated-no-progress");
    if (input.userRejectStop) hardCodes.push("user-reject-stop");
    if (input.safetyRejected) hardCodes.push("permission-security-reject");
    return {
      kind: "hard",
      codes: hardCodes,
      wakeAnalysis: true,
      expandDetail: true,
      askUser: input.userRejectStop,
      openMinors: input.openMinors
    };
  }

  if (input.score < input.config.softThreshold) {
    return {
      kind: "soft",
      codes: ["soft-threshold"],
      wakeAnalysis: true,
      expandDetail: true,
      askUser: false,
      openMinors: input.openMinors
    };
  }

  if (shouldEscalateMinorsReplica(input.openMinors)) {
    return {
      kind: "soft",
      codes: ["minor-escalated"],
      wakeAnalysis: true,
      expandDetail: true,
      askUser: false,
      openMinors: input.openMinors
    };
  }

  return {
    kind: "none",
    codes: [],
    wakeAnalysis: false,
    expandDetail: false,
    askUser: false,
    openMinors: input.openMinors
  };
}

function shouldEscalateMinorsReplica(minors: readonly OpenMinor[]): boolean {
  const verified = minors.filter((item) => item.status === "verified-true");
  if (verified.some((item) => item.consecutiveTurns >= 2)) return true;
  if (verified.length >= 3) return true;
  if (verified.some((item) => item.touchesConstraint || item.userRejected)) return true;
  return false;
}

{
  const rng = mulberry32(0xa77a04);
  for (let trial = 0; trial < 8000; trial += 1) {
    const minors: OpenMinor[] = Array.from({ length: Math.floor(rng() * 6) }, (_, i) => ({
      id: `m${i}`,
      text: `minor ${i}`,
      status: rng() < 0.7 ? "verified-true" : UNOBSERVED,
      consecutiveTurns: Math.floor(rng() * 4),
      touchesConstraint: rng() < 0.15,
      userRejected: rng() < 0.1
    }));
    const input: GateInput = {
      P: rng(),
      score: rng(),
      human: { kind: "unobserved" },
      config: DEFAULT_TRACKING_CONFIG,
      deterministicFail: rng() < 0.15,
      ownershipEscape: rng() < 0.15,
      claimedVerificationWithoutChecks: rng() < 0.15,
      repeatedNoProgress: rng() < 0.15,
      userRejectStop: rng() < 0.15,
      safetyRejected: rng() < 0.15,
      openMinors: minors
    };
    const expected = evaluateGates(input);
    const actual = candidateGatesGuard(input);
    check("S7-A-3 equivalence", JSON.stringify(expected) === JSON.stringify(actual), JSON.stringify(input));
    check("S7-A-3 openMinors alias identity", expected.openMinors === input.openMinors && actual.openMinors === input.openMinors);
  }
  // bench on the production common path (all flags false, score above threshold, no escalation)
  const commonInput: GateInput = {
    P: 0.9,
    score: 0.9,
    human: { kind: "unobserved" },
    config: DEFAULT_TRACKING_CONFIG,
    deterministicFail: false,
    ownershipEscape: false,
    claimedVerificationWithoutChecks: false,
    repeatedNoProgress: false,
    userRejectStop: false,
    safetyRejected: false,
    openMinors: []
  };
  const cur = bench(() => void evaluateGates(commonInput), 500000);
  const cand = bench(() => void candidateGatesGuard(commonInput), 500000);
  console.log(
    `S7-A-3 bench common path (no hard codes): current=${(cur * 1e6).toFixed(1)}ns cand=${(cand * 1e6).toFixed(1)}ns delta=${((cur - cand) * 1e6).toFixed(1)}ns/turn (x~5 turns/run)`
  );
}

/* ============================================================
 * S7-A-4: combined-score.ts algebraic rearrangement of the weighted
 * blend: 0.7*min(H,P) + 0.3*max(H,P)  ->  0.3*(H+P) + 0.4*min(H,P)
 * (one Math call fewer). Mathematically equal on the reals; adjudicate
 * bitwise equality of the doubles (campaign standard: X2-1/X2-3 class).
 * ============================================================ */
{
  const currentExpr = (H: number, P: number): number => 0.7 * Math.min(H, P) + 0.3 * Math.max(H, P);
  const candExpr = (H: number, P: number): number => 0.3 * (H + P) + 0.4 * Math.min(H, P);

  // (a) raw-value divergence fuzz over realistic H sources x 4-decimal P lattice
  const rng = mulberry32(0xa77a05);
  const hValues: number[] = [0.35, 0.45, 0.15]; // short-rule constants
  for (let mark = 0; mark <= 100; mark += 5) hValues.push(mark / 10 / 10); // ten-point marks step 0.5
  for (let n = 1; n <= 20; n += 1) for (let k = 0; k <= n; k += 1) hValues.push(k / n); // ratio H
  const hSet = [...new Set(hValues)];
  let rawDivergences = 0;
  let firstRaw: string | undefined;
  let roundedDivergences = 0;
  let firstRounded: string | undefined;
  for (const H of hSet) {
    for (let p = 0; p <= 10000; p += 1) {
      const P = p / 10000;
      const a = currentExpr(H, P);
      const b = candExpr(H, P);
      if (!Object.is(a, b)) {
        rawDivergences += 1;
        if (firstRaw === undefined) firstRaw = `H=${H} P=${P} current=${a} cand=${b}`;
        const ra = Number(a.toFixed(4));
        const rb = Number(b.toFixed(4));
        if (!Object.is(ra, rb)) {
          roundedDivergences += 1;
          if (firstRounded === undefined) firstRounded = `H=${H} P=${P} current->${ra} cand->${rb}`;
        }
      }
    }
  }
  // plus uniform fuzz for raw divergence density
  let uniformRaw = 0;
  for (let trial = 0; trial < 200000; trial += 1) {
    const H = rng();
    const P = rng();
    if (!Object.is(currentExpr(H, P), candExpr(H, P))) uniformRaw += 1;
  }
  check("S7-A-4 raw divergence must exist (not bitwise-equal)", rawDivergences > 0);
  console.log(
    `S7-A-4 grid (|H|=${hSet.length} x 10001 P): raw divergences=${rawDivergences}, first: ${firstRaw ?? "-"} | POST-ROUND divergences=${roundedDivergences}${firstRounded !== undefined ? `, first: ${firstRounded}` : ""} | uniform raw fuzz=${uniformRaw}/200000`
  );
  const curB = bench(() => void currentExpr(0.45, 0.8333), 2000000);
  const candB = bench(() => void candExpr(0.45, 0.8333), 2000000);
  console.log(
    `S7-A-4 bench: current=${(curB * 1e6).toFixed(2)}ns cand=${(candB * 1e6).toFixed(2)}ns delta=${((curB - candB) * 1e6).toFixed(2)}ns/blend (observed-human path only)`
  );
}

/* ============================================================
 * Budget anchor re-verification (R3-A section 3 lineage):
 * applyChildThreeLine end-to-end at real scale (41-event table,
 * apply path) x ~5 gates/run bounds ANY optimization in this slice.
 * ============================================================ */
{
  const NOW_ISO = "2026-08-24T00:00:00.000Z";
  let idCounter = 0;
  const nextId = (): EventId => `evt_${String(idCounter++).padStart(8, "0")}` as EventId;
  const runId = "run_x" as Event["runId"];
  const events: Event[] = [];
  events.push({
    id: nextId(),
    schemaVersion: 1,
    occurredAt: NOW_ISO as Event["occurredAt"],
    runId,
    type: "RUN_STARTED",
    actor: "system",
    payload: { title: "bench" }
  } as unknown as Event);
  events.push({
    id: nextId(),
    schemaVersion: 1,
    occurredAt: NOW_ISO as Event["occurredAt"],
    runId,
    type: "RUN_ATTACHED",
    actor: "supervisor",
    payload: { episodeId: "ep_bench", runId, attachedAt: NOW_ISO }
  } as unknown as Event);
  for (let i = 0; i < 39; i += 1) {
    events.push({
      id: nextId(),
      schemaVersion: 1,
      occurredAt: NOW_ISO as Event["occurredAt"],
      runId,
      type: "CHILD_MESSAGE",
      actor: "child",
      payload: { taskId: `tsk_${i % 5}`, content: "..." }
    } as unknown as Event);
  }
  const child = {
    taskId: "tsk_bench",
    outcome: "SUCCESS" as const,
    summary: "tests passed",
    evidenceIds: ["evd_1"],
    artifactIds: ["art_1"],
    terminalResult: {
      verification: { kind: "PASSED" as const, evidenceIds: ["evd_1"] }
    }
  };
  const spec = {
    role: "tester",
    acceptanceCriteria: [{ id: "chk_0", description: "tests pass" }]
  };
  let applied = false;
  const one = bench(() => {
    let localCounter = 100;
    const out = applyChildThreeLine({
      events,
      child: child as never,
      spec: spec as never,
      nowIso: NOW_ISO,
      generateEventId: () => `evt_${String(localCounter++).padStart(8, "0")}` as EventId
    });
    applied = out.result.applied;
  }, 5000);
  check("anchor path actually applies the gate", applied);
  console.log(
    `anchor: one applyChildThreeLine over 41-event table = ${(one * 1e3).toFixed(1)}us -> ~5 gates/run => whole-slice per-run budget ~${(one * 5 * 1e3).toFixed(0)}us (campaign landing line: tens-hundreds of ms or complexity-class drop)`
  );
}

void mulberry32(0xa77a06);

if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```
