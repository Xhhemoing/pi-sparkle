# R8-A：`src/tracking/` + `src/run/{child-tracking,gate-apply}.ts` 第八遍搜查报告

**战役:** 全库持久 SOTA 优化 Round 8 / R8-A（Round 1–7 同区第八遍）
**基线:** `cursor/sota-persistent-opt-83a1` @ `6cf2d65`（含 S7-F-1/S7-F-2、S7-I-1 落地与 S7-A/B/C/D/E/F/G/H/I 排除；X2-1 SOD 落地在途，不触本切片）
**分支:** `cursor/r8-a-tracking-eighth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动；整片预算收口第六次复核成立。**
切片 14 个文件自 R1-A 基线（`7acb666`）经 R2-A / R3-A / R4-A / R5-A / R6-A /
R7-A 至本轮基线（`6cf2d65`）**逐字节未变**（`git diff 7acb666..6cf2d65 --
src/tracking/ src/run/child-tracking.ts src/run/gate-apply.ts` 为空）。调用面
同样未变：R7-A 基线（`2b85f51`）以来 `src/` 仅 7 个切片外文件变动——
`src/cli/model-catalog.ts` + `src/pi-adapter/listed-model{,-common,-lazy}.ts`
（S7-I-1）、`src/experiments/{canary,shadow,plan}.ts`（S7-F-1/2）——不触及
本切片及其调用方；全库 grep 复核生产调用方仍为 `supervisor.ts`
（applyTrackingGate/nextTrackingSeq）/ `coordinator.ts` / `flowchart-run.ts`
（applyChildThreeLine），每子结果一次（~5 次/run），事件表几十级（41）。
R7-I「默认态夹具掩盖配置态主路径」教训按令复查：`src/track/` 对切片**零导入**
（grep 无匹配），`--track` 供给面就是 supervisor 的同一 applyTrackingGate
调用点，无配置态新热环。R7-A 的 ~86–90 µs/run 预算天花板经本轮实测复核为
**~88–90 µs/run**（同带），量级结论不变。在完整排除表之上以新角度第八遍
枚举，得到 3 个此前未点名的新候选（S8-A-1 … S8-A-3），全部经理论 + 确定性
仿真（seeded mulberry32，等价 fuzz + 真实规模基准，三次独立运行等价/反例
结论逐位一致）裁决后淘汰：1 个**双变体裁决**（激进变体 A 不等价——
未强制跨字段不变式反例，S1-A-9 结构第二例；保守变体 B 等价但死 find 仅
61–65ns/gate 且 e2e 符号不稳定＝噪声，落地还需公开签名或平行入口），
1 个等价但**零生产调用方 + 安全瓶颈防御纵深**（test-only 面），1 个不变式
成立但属**公开类型变更**且朴素基准反而更慢（内联缓存形状污染的测量方法论
教训）。未重开任何 X* / S1-* / S2-* / S3-* / S4-* / S5-* / S6-* / S7-* 条目。

## 0. 范围与约束遵守

- 切片：`src/tracking/`（12 文件）+ `src/run/child-tracking.ts` +
  `src/run/gate-apply.ts`，全部实际读码。
- 先读并遵守（顺序强制）：README / EXCLUSIONS.md（全表，含 S7-A-1..4 与新
  落地 S7-I-1、S7-F-1/2）/ round-08/PLAN.md / round-07/PLAN.md /
  round-01/R1-A.md … round-07/R7-A.md。候选枚举刻意绕开全部既有排除
  （X0-4、X0-6、X1-1、X2-4、S1-A-1..9、S2-A-1..6、S3-A-1..4、S4-A-1..3、
  S5-A-1..3、S6-A-1..3、S7-A-1..4、S6-G-7 及全部无 ID 收口裁决），只探索
  **未被点名的第八组新角度**：生产恒新鲜 seq 下的死幂等扫描（S8-A-1）、
  sanitize-then-project 中间包塌缩（S8-A-2）、公开输入类型死字段（S8-A-3）。
- 换名重提检查（识别为既有方案换名/换位点，**未列为新候选**）：
  - `applyTrackingGate` 返回仅增量事件（delta）而非全表拷贝 = 公开返回
    形状变更，X0-4「接口破坏」族，拒列；
  - gate-apply 写侧 `validateEvent` 跳过（追加事件自建自信）= S4-G-2
    「写侧校验全跳过＝非法收益」同型，拒列；
  - `extractHumanScore` 每调用正则重建 → 模块级缓存 = X0-6 本体
    （/g lastIndex 状态风险），维持不重开；
  - `hashSummary(previous)` 跨调用缓存 = X1-1 本体（隐藏缓存陈旧风险），
    拒列；
  - `turn.ts` 的 `anomalyCodes = [...gate.codes]` 拷贝省略 = S1-A-7 本体
    （可观察对象身份改变），维持；
  - from-child PASS 判定 dimensions 对象享元单例 = S7-B-5 / S1-A-7
    可观察身份族，拒列；
  - `readersInvoked.chainOfThought` 恒 false 的硬编码收敛 = 公开结果形状
    的意图文档（chain-of-thought 读器规格预留位），S4-A-3「死条件消除撞
    公开面」族，拒列；
  - `child-tracking.ts` caller 算 hash、`applyTrackingGate` 内再算的
    双 `hashAssessment` 去重 = 前轮已裁决的 CAS fail-closed 契约位点
    （被调方不信任 caller 传入哈希），维持不重开。
- 公开 API、版本化阈值（softThreshold 0.55 / hardFailCap 0.3 /
  minorPDip 0.03）、哈希契约、事件 schema、CAS/幂等键格式全部不变——
  本轮零 diff，天然满足。三线规格（分析不改 in-flight、Tracking 无命令权、
  H/score 不写路由、live = R0 等价、双 LCB 双归因保留、提升 proposal-first）
  同样天然满足。不声称 Outcome-supported；Checkpoint F-PROD 仍开放（ADR-005）。

## 1. 预算支配论证复核（方法第 1 步，不假设直接实测）

R3-A §3 / R4-A §1 / R5-A §1 / R6-A §1 / R7-A §1 的整片预算论证依赖两个
前提，本轮逐一复核：

1. **切片代码未变**：`git diff 7acb666..6cf2d65 -- <切片>` 为空，逐字节
   一致（八遍全程零 diff）。
2. **调用面未变**：`2b85f51..6cf2d65` 间 `src/` 仅 7 个切片外文件变动
   （见结论节），不触及切片；生产调用方经全库 grep 复核不变。
   **无新热路径，无量级变化。**

R7-I 教训（默认态夹具可能掩盖配置态主路径）专项复查：`--track` /
children / configured-provider 三种配置态都不给本切片开新热环——
`src/track/loop.ts` 对切片零导入；`--track` 的门控供给面就是
`supervisor.ts:483` 的同一 `applyTrackingGate` 调用点（`expectedSeq ??
nextTrackingSeq(events)`）；children 路径经 `coordinator.ts:444` /
`flowchart-run.ts:320` 的 `applyChildThreeLine`，每子结果一次。频次
仍为 ~5 gates/run，非每 turn 热环。**不padding。**

本轮在当前 VM 重测预算锚点（三次独立运行）：

```text
anchor: one applyChildThreeLine over 41-event table = 17.6–17.9 µs（apply 全路径）
=> ~5 gates/run => 切片每 run 总预算 ≈ 88–90 µs
```

与 R3-A（19.0–22.8 µs/gate）、R4-A（12.1–12.3）、R5-A（19.2–20.1）、
R6-A（16.2–17.3）、R7-A（17.2–17.9）同带；量级结论不变：即使把整个切片
优化到零成本，节省上界 ~0.1 ms/run，仍比战役落地线（数十~数百 ms 或
复杂度类下降）低**约三个量级**。复杂度类下降的仅存位点维持既有排除
（X0-4/X2-4 事件表索引化、S1-A-1/S1-A-9 反向早退、X1-1 hashSummary
跨调用缓存、S6-G-7 读侧内存镜像、R1-A 裁决的不可变累计快照构造下界）。
**支配论证第六次复核成立，本切片在当前数据面规模下维持预算收口。**

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S8-A-1 | gate-apply **fresh-seq 死幂等扫描跳过**：两个生产入口都以新鲜 seq 进入 `applyTrackingGate`（`supervisor.ts:487` `expectedSeq ?? nextTrackingSeq(events)`；`child-tracking.ts:45` 无条件 `nextTrackingSeq(events)`），此时 TRACKING_ASSESSMENT find 可证必 miss（子引理：find 谓词与 `nextTrackingSeq` 读同一 `payload.seq`，max+1 不可能在表中）。变体 A＝两个 find 全跳；变体 B＝仅跳 TRACKING_ASSESSMENT find | 免每 gate 1–2 次 O(E) miss-find（生产每 gate 都命中该死路径） | 子引理 5000 fuzz（乱序/重复/负 seq）成立；❌ **变体 A 不等价**：schema 合法反例 GATE_TRANSITION{seq:3, idempotencyKey:"\<hash\>:7"}——`validateEvent` 对 idempotencyKey 只强制非空字符串，跨字段不变式 `idempotencyKey === \`${hash}:${seq}\`` **无处强制**（S1-A-9「未强制不变式」结构第二例）；现行为幂等 no-op，变体 A 会追加重复 gate 事件三连；✅ 变体 B 3000 fuzz 等价（result + events + skip 路径引用身份） | 死 TRACKING_ASSESSMENT find 实测 **60.9–64.8ns/gate**（E=41；收益上界 ~0.3µs/run）；GATE_TRANSITION miss-find 57.5–62.9ns/gate（写侧不变式依赖，A 已死）；e2e fresh apply 三次运行 delta **−142 / +186 / +854 ns/gate 符号不稳定＝噪声**（变体 B 副本多付一次 nextTrackingSeq 重扫充当旗标） | 淘汰：A 不等价；B 落地需调用方传入新鲜性知识——公开签名变更（X0-4 邻域）或平行入口（X1-2 类），且收益在噪声带、上界比落地线低约五个量级 |
| S8-A-2 | analysis.ts `proposeFromAnomaly` **sanitize-then-project 塌缩**：内容投影只读 {gate, score, P, H, evidenceRefs, summary.anomalyCodes, toolSituations(name, exitCode)}——全部被 `sanitizePacketForAnalysis` 原样传递；中间 sanitized packet（window 重构 + UNTRUSTED_TEXT 信任标注）对内容构造是死工作；候选直接从原 packet 投影 | 免每 call 一次中间 packet 构造（对象 + window 重构） | ✅ 4000 fuzz 内容**字节等价** + 双 registry 端到端候选 JSON 逐位一致 | delta **81–107ns/call**；sanitize 步本体 65–73ns；整 `proposeFromAnomaly` 5337–6117ns（JSON.stringify + registry 支配，塌缩份额 <2%） | 淘汰：grep 全库 `proposeFromAnomaly` / `sanitizePacketForAnalysis` **零 src/ 生产调用方**（仅 index.ts 再导出 + 测试；S1-D-3/S1-E-7/S2-F-2 test-only 族）；sanitize 是不可信文本进入分析面的**安全瓶颈**（S3-H-1「删防御纵深」族——字节等价也保留 choke point）；收益 ns 级 |
| S8-A-3 | gates.ts `GateInput` **死字段 P/human**：`evaluateGates` 从不读 `input.P` 与 `input.human`（只读 score / config / 六硬旗标 / openMinors）；候选收窄公开 GateInput 并从 turn.ts 调用点删两属性写 | 免每 turn 2 次属性写 | ✅ 8000 fuzz 不变式成立（P 含 ±500 出域值、human 全四形态；输出逐位同 + `openMinors` 别名身份保持） | **去死字段变体实测反而更慢 −7.2 ~ −10.7ns/turn（三次同向）**：同一调用点交替两种对象形状使内联缓存多态化（PIC 形状污染是 harness 伪影）；真实稳态节省仅两次属性写 ~1–2ns | 淘汰：公开类型变更（S1-F-6 族）；P/H/score 三元组是门控规格的意图文档（规格面向 P/H/score 定义）；收益零级 |

## 3. 关键裁决细节

### S8-A-1 变体 A 的反例（本轮最重要的健全性证据）

`applyTrackingGate` 的幂等保护有两层 find：先按
`idempotencyKey === \`${assessmentHash}:${expectedSeq}\`` 扫 GATE_TRANSITION，
再按 `(seq, assessmentHash)` 扫 TRACKING_ASSESSMENT。「seq 新鲜 ⇒ 两层
都必 miss」的直觉对第二层成立（子引理，5000 fuzz），对第一层**不成立**：
`validateEvent` 对 GATE_TRANSITION 的 `idempotencyKey` 只强制非空字符串，
`idempotencyKey` 与本事件 `seq` 字段的跨字段一致性**无处强制**——与
S1-A-9（nextTrackingSeq 反向扫描被乱序 seq 击破）同属「代码依赖未强制
不变式」结构。反例表（schema 全合法）：

```text
[... filler ..., TRACKING_ASSESSMENT{seq:6}, GATE_TRANSITION{seq:3, idempotencyKey:"<hash>:7"}]
nextTrackingSeq = 7（新鲜）；但第一层 find 命中 "<hash>:7"
现行为：幂等 no-op（events 原引用返回，applied=false）
变体 A（两 find 全跳）：追加 TRACKING_ASSESSMENT + GATE_TRANSITION + RUN_*
——事件表可观察发散
```

三次运行反例确定性重现。若未来 `validateEvent` 把该跨字段不变式固化为
schema 契约，变体 A 才具备可证性——现无此契约，直接淘汰。

### S8-A-1 变体 B 的双重淘汰（健全但零收益 + 公开面）

变体 B 只跳可证必 miss 的 TRACKING_ASSESSMENT find，3000 fuzz（新鲜/陈旧
seq 六四开、PASSED/FAILED 两形态、两类幂等重放）result + events + skip
路径引用身份全部逐位等价。但被跳过的死 find 本体实测仅 60.9–64.8ns/gate
（×~5 gates/run ⇒ 上界 ~0.3µs/run，比落地线低约五个量级）；端到端 delta
三次运行 −142/+186/+854ns **符号不稳定**，纯噪声（副本以 nextTrackingSeq
重扫充当「新鲜性」旗标，真实落地则必须由调用方传入该知识——公开签名
变更 X0-4 邻域，或平行入口 X1-2 类，两条路都是既有拒绝结构）。值得记录
的正面事实：生产两个入口**恒以新鲜 seq 进入**，该死 find 每 gate 都执行
——理论是生产真实的，杀死它的只有量级与公开面。

### S8-A-2 的三重淘汰（test-only + 防御纵深 + 支配）

内容投影所读字段全部被 `sanitizePacketForAnalysis` 原样传递，4000 fuzz
字节等价 + 双 registry 端到端逐位一致——等价性无懈可击。但：
(1) grep 全库，`proposeFromAnomaly` 与 `sanitizePacketForAnalysis` 在
`src/` 内除 `analysis.ts` 自身与 `index.ts` 再导出外**零调用方**，属
test-only 面（S1-D-3/S1-E-7/S2-F-2 族先例：无生产流量的等价优化一律拒）；
(2) sanitize 是不可信文本（userText/aiText/toolBodies）进入分析面前的
**信任标注瓶颈**——候选让内容构造绕开该 choke point，即使今天投影字段
不含文本，也在结构上打开「未来字段加进投影时忘记过 sanitize」的口子，
S3-H-1「删防御纵深」族；(3) 即便不看前两条，delta 81–107ns/call 对
整函数 5337–6117ns（JSON.stringify + registry 支配），份额 <2%，
量级零级。

### S8-A-3 的测量方法论教训（PIC 形状污染）

`evaluateGates` 对 `input.P` / `input.human` 的死读性经 8000 fuzz 确证
（P 打到 ±500 出域值、human 全四形态，输出与 `openMinors` 别名身份全部
不变）。但朴素基准给出反常结果：去掉两个死字段的调用**更慢**
−7.2~−10.7ns/turn（三次同向）。归因：harness 在同一调用点交替构造两种
对象形状（含/不含 P、human），V8 内联缓存从单态退化为多态——这是
**基准伪影**而非生产事实；真实落地后调用点单形状，稳态节省即两次属性写
~1–2ns/turn（×5 turns/run ⇒ ~10ns/run，零级）。与 S7-A-3（V8 空数组
字面量近零成本）同为「纸面常数直觉在 V8 上不成立」档案，但机制不同：
S7-A-3 是真实负优化，本例是测量通道本身被形状污染。落地面上它仍撞死
S1-F-6「公开类型变更」族——`GateInput` 是导出类型，且 P/H/score 三元组
是门控规格（gates 面向 P/H/score 定义）的意图文档，删字段属规格面收窄。

### 逐文件收口（第八遍新角度复查）

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `gate-apply.ts` | fresh-seq 死幂等扫描（本文件八遍来最后一处未点名死工作结构；生产入口恒新鲜 seq 的调用面事实首次记录）；idempotencyKey 谓词分量比较 R7-A §0 已拒；双 find / currentGateStatus / nextTrackingSeq 维持 X2-4/X0-4/S1-A-1/S1-A-9；双 hashAssessment 维持 CAS fail-closed 契约裁决；`mapGateDirective` FAIL_CLOSED 兜底维持保留 | S8-A-1 淘汰 |
| `analysis.ts` | sanitize-then-project 塌缩（前七遍均以「一次性构造/无生产调用方」收口，本轮首次实测穿透并把 test-only + choke-point 双裁决落档） | S8-A-2 淘汰 |
| `gates.ts` | GateInput 死输入字段（S7-A-3 死分配之外的死输入角度）；shouldEscalateMinors 维持 S1-A-6 | S8-A-3 淘汰 |
| `turn.ts` | S7-A-1 human 管道折叠收口维持；anomalyCodes/gate.codes 拷贝 = S1-A-7 本体维持；readersInvoked.chainOfThought 常量收敛拒列（见 §0）；S1-A-7/S2-A-3/S3-A-2/3/4/S4-A-1/S5-A-1 收口维持 | 无新候选 |
| `roller.ts` | S7-A-2/S1-A-5/S2-A-1/S3-A-1 四层收口维持；mergeConstraints 已是双循环无中间数组 | 无新候选 |
| `combined-score.ts` | S7-A-4 反例收口维持；isMachineScore 边界防御保留 | 无新候选 |
| `from-child.ts` | S1-A-2/S2-A-2/S2-A-6/S4-A-3/S5-A-3/S6-A-2/S6-A-3 七层收口维持；PASS 维度享元拒列（见 §0） | 无新候选 |
| `prescore.ts` | S1-A-4/S3-A-3/S6-A-1 收口维持；evidenceOutcome/scopeOutcome some 序同类裁决维持 | 无新候选 |
| `child-tracking.ts` | runId 守卫重排 R7-A §0 已拒；5 次事件表扫描维持 X2-4/X0-4；S4-A-2 预检提升、S6-G-7 读侧镜像收口维持 | 无新候选 |
| `human-score.ts` | X0-6/S1-A-3/R3-A「X0-6 对偶面」/R5-A 正则频次重排不等价收口维持；正则重建缓存拒列（X0-6 本体，见 §0） | 无新候选 |
| `types.ts` | hashSummary 跨调用缓存拒列（X1-1 本体，见 §0）；S2-A-5/S5-A-2/X0-5/S1-A-8/S3-B-3 收口维持 | 无新候选 |
| `isolation.ts` / `config.ts` / `index.ts` | O(1) 谓词 / 常量 / 纯再导出 | 无新候选 |

## 4. 前后对比

无代码 diff。仓库变更仅本报告一个文件。仿真为临时脚本未入库（无赢家不落
仿真文件，遵守方法第 4 条；loser 仿真完整源码见附录），未触碰任何测试。

## 5. 测试

零代码改动下相关套件基线复核，全绿（与 R1-A…R7-A 同套件同计数）：

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
S8-A-1 variant A counterexample: fresh seq=7 but adversarial GATE_TRANSITION{seq:3, idempotencyKey:"<hash>:7"} matches the first find -> current=no-op idempotent, skip-both-finds variant would append a duplicate gate (NOT equivalent; unforced cross-field invariant, S1-A-9 structure)
S8-A-1 bench E=41: dead TRACKING_ASSESSMENT miss-find=64.8ns/gate | GATE_TRANSITION miss-find (writer-invariant only)=61.4ns/gate | e2e fresh apply: current=7.40us variantB=6.54us delta=854ns/gate
S8-A-2 bench: sanitize step=73ns | content current=651ns cand=544ns delta=107ns/call | whole proposeFromAnomaly=5609ns [grep: zero src/ callers -- test-only plane]
S8-A-3 bench: literal+call with dead fields=22.4ns without=29.6ns delta=-7.2ns/turn
anchor: one applyChildThreeLine over 41-event table = 17.7us -> ~5 gates/run => ~88us/run
ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)

run 2:
S8-A-1 TA-find=60.9ns GT-find=62.9ns | e2e current=6.43us variantB=6.57us delta=-142ns/gate
S8-A-2 sanitize=65ns delta=81ns/call whole=5337ns | S8-A-3 delta=-10.2ns/turn
anchor: 17.6us -> ~88us/run
ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)

run 3:
S8-A-1 TA-find=61.0ns GT-find=57.5ns | e2e current=6.54us variantB=6.36us delta=186ns/gate
S8-A-2 sanitize=68ns delta=93ns/call whole=6117ns | S8-A-3 delta=-10.7ns/turn
anchor: 17.9us -> ~90us/run
ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

三次独立运行等价/反例结论逐位一致（S8-A-1 反例、S8-A-2 字节等价、
S8-A-3 不变式确定性重现）；S8-A-1 e2e delta 符号不稳定（−142/+186/+854ns）
即噪声裁决本体；S8-A-3 负值三次同向（PIC 伪影稳定）。裁决方向不变。

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S8-A-1 | gate-apply fresh-seq 死幂等扫描跳过（变体 A 双 find 全跳 / 变体 B 仅跳 TRACKING_ASSESSMENT find） | A 不等价：idempotencyKey 跨字段不变式（=`${hash}:${seq}`）无处强制（validateEvent 仅查非空），schema 合法反例把幂等 no-op 变重复追加（S1-A-9 结构第二例）；B 等价（3000 fuzz）但死 find 仅 61–65ns/gate（上界 ~0.3µs/run），e2e 符号不稳定（−142/+186/+854ns），落地需公开签名（X0-4 邻域）或平行入口（X1-2 类） |
| S8-A-2 | analysis proposeFromAnomaly sanitize-then-project 塌缩（内容直接从原 packet 投影） | 等价（4000 fuzz 字节等 + 端到端）但零 src/ 生产调用方（test-only 族）；sanitize 是不可信文本信任标注安全瓶颈（S3-H-1 族）；81–107ns/call 对整函数 5.3–6.1µs 份额 <2% |
| S8-A-3 | GateInput 死字段 P/human 收窄 + 调用点删属性写 | 不变式成立（8000 fuzz）但公开类型变更（S1-F-6 族）+ P/H/score 三元组是规格意图文档；朴素基准 −7.2~−10.7ns/turn 是 PIC 形状污染伪影，真实稳态 ~1–2ns 零级 |

重开条件：S8-A-1 需先把 `idempotencyKey === \`${hash}:${seq}\`` 固化为
`validateEvent` 的 schema 契约（届时变体 A 才可证），或事件表规模增
≥2–3 个量级使 O(E) find 可测——届时与 X0-4/X2-4 事件表索引化一并重开；
S8-A-2 需 `proposeFromAnomaly` 出现生产调用方**且** sanitize choke-point
契约被表所有者正式放宽；S8-A-3 需 `GateInput` 公开面解冻（门控规格正式
改为仅面向 score 定义）。整片预算支配论证（§1）的重开条件不变：run 事件
表或每 turn 集合规模增长 ≥2–3 个量级，届时 S1-A-1、S2-A-1、S2-A-3、
S4-A-1、S7-A-2、S8-A-1(B) 可凭既有等价性证据优先重开。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.ts` 后 `npx tsx <file>`（仓库根目录，依赖已装）。
seeds：`0xa88a01`–`0xa88a05`。

```ts
/**
 * R8-A deterministic equivalence + benchmark simulation (eighth pass).
 * Adjudicates fresh candidates S8-A-1 .. S8-A-3 against the current
 * implementations in src/tracking + src/run/{child-tracking,gate-apply},
 * and re-verifies the whole-slice budget anchor (R3-A..R7-A lineage).
 * All candidates are NEW angles not named by EXCLUSIONS.md, R1-A..R7-A.
 * Seeded PRNG (mulberry32) -> fully reproducible.
 * Seeds: 0xa88a01 .. 0xa88a05.
 */
import { performance } from "node:perf_hooks";
import { createMessageId, type EventId, type RunId } from "/workspace/src/domain/ids.js";
import type { IsoTimestamp } from "/workspace/src/domain/timestamp.js";
import { ResourceRegistry } from "/workspace/src/adaptation/registry.js";
import type { AuthorIdentity, ResourceIdentity } from "/workspace/src/adaptation/resource.js";
import { createProjectId, type IdGenerator } from "/workspace/src/domain/ids.js";
import { DEFAULT_TRACKING_CONFIG } from "/workspace/src/tracking/config.js";
import { evaluateGates, type GateInput } from "/workspace/src/tracking/gates.js";
import {
  assessChildObservation,
  type ChildObservation
} from "/workspace/src/tracking/from-child.js";
import { proposeFromAnomaly, sanitizePacketForAnalysis, type AnalysisPacketInput } from "/workspace/src/tracking/analysis.js";
import { applyChildThreeLine } from "/workspace/src/run/child-tracking.js";
import {
  applyTrackingGate,
  nextTrackingSeq,
  type GateApplyResult,
  type GateDirective,
  type GateRunStatus
} from "/workspace/src/run/gate-apply.js";
import { validateEvent, type Event } from "/workspace/src/run/events.js";
import type {
  AnomalyPacket,
  HumanSignal,
  OpenMinor,
  RollingSummary,
  TrackingAssessment
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
const RUN_ID = "run_x" as RunId;

/* Shared: build a realistic event table. Existing events are only read for
 * type/payload by applyTrackingGate (validateEvent runs on appended events),
 * so plain-object casts are sound here, matching the R3-A..R7-A harnesses. */
type LooseEvent = { type: string; payload?: Record<string, unknown>; runId?: RunId };
function fillerEvents(n: number): LooseEvent[] {
  const out: LooseEvent[] = [{ type: "RUN_STARTED", payload: { title: "bench" }, runId: RUN_ID }];
  for (let i = 0; i < n; i += 1) {
    out.push({ type: "CHILD_MESSAGE", payload: { taskId: `tsk_${i % 5}`, content: "..." }, runId: RUN_ID });
  }
  return out;
}

function realAssessment(kind: "PASSED" | "FAILED"): TrackingAssessment {
  const observation: ChildObservation = {
    taskId: "tsk_bench",
    role: "tester",
    outcome: kind === "PASSED" ? "SUCCESS" : "FAILURE",
    summary: "tests ran",
    evidenceIds: ["evd_1"],
    artifactIds: ["art_1"],
    verification: { kind, evidenceIds: ["evd_1"] },
    requiredChecks: ["test"],
    constraints: []
  };
  const assessed = assessChildObservation({ observation, episodeId: "ep_x", runId: "run_x" });
  if (!assessed.apply) throw new Error("expected apply");
  return assessed.assessment;
}

/* ============================================================
 * S8-A-1: gate-apply fresh-seq dead idempotency scans.
 * When expectedSeq === nextTrackingSeq(events):
 *  - sub-lemma (SOUND, unconditional): no TRACKING_ASSESSMENT event can
 *    have payload.seq === expectedSeq (both the find predicate and
 *    nextTrackingSeq read the same payload.seq; max+1 cannot be present).
 *  - full lemma (UNSOUND): the GATE_TRANSITION idempotencyKey find can
 *    still match, because validateEvent enforces only "non-empty string"
 *    on idempotencyKey -- the cross-field invariant
 *    idempotencyKey === `${hash}:${seq}` is enforced nowhere (S1-A-9
 *    unforced-invariant structure).
 * Variant A = skip both finds when fresh (unsound; counterexample below).
 * Variant B = skip only the TRACKING_ASSESSMENT find when fresh (sound;
 * replica below), needs caller knowledge => public signature change
 * (X0-4-adjacent) or parallel entry (X1-2 class).
 * ============================================================ */

// --- verbatim private-logic replicas (from gate-apply.ts) ---
function currentGateStatusReplica(events: readonly Event[]): GateRunStatus {
  let status: GateRunStatus = "RUNNING";
  for (const event of events) {
    if (event.type === "GATE_TRANSITION") status = event.payload.to;
    else if (event.type === "RUN_BLOCKED") status = "BLOCKED";
    else if (event.type === "RUN_WAITING_FOR_USER") status = "WAITING_FOR_USER";
    else if (event.type === "USER_ANSWER" || event.type === "RUN_STARTED") status = "RUNNING";
  }
  return status;
}

function mapGateDirectiveReplica(assessment: TrackingAssessment): {
  directive: GateDirective;
  runStatus: GateRunStatus;
  reasonCode: string;
} {
  const gate = assessment.gate;
  if (gate.askUser) {
    return { directive: "wait_user", runStatus: "WAITING_FOR_USER", reasonCode: gate.codes[0] ?? "ASK_USER" };
  }
  if (gate.kind === "none") {
    return { directive: "none", runStatus: "RUNNING", reasonCode: "NONE" };
  }
  if (gate.kind === "hard" && gate.codes.includes("user-reject-stop")) {
    return { directive: "wait_user", runStatus: "WAITING_FOR_USER", reasonCode: "user-reject-stop" };
  }
  if (gate.kind === "soft" || gate.kind === "hard" || gate.wakeAnalysis) {
    return { directive: "queue_analysis", runStatus: "BLOCKED", reasonCode: gate.codes[0] ?? "ANALYSIS_QUEUED" };
  }
  return { directive: "wait_user", runStatus: "WAITING_FOR_USER", reasonCode: "FAIL_CLOSED" };
}

type GateApplyInput = Parameters<typeof applyTrackingGate>[0];

/** Variant B: skip ONLY the TRACKING_ASSESSMENT find when the seq is fresh. */
function candidateApplyGateB(input: GateApplyInput): {
  readonly events: readonly Event[];
  readonly result: GateApplyResult;
} {
  if (input.assessmentHash !== hashAssessment(input.assessment)) {
    throw new Error("assessmentHash mismatch: does not match hashAssessment(assessment)");
  }
  const idempotencyKey = `${input.assessmentHash}:${input.expectedSeq}`;
  const existing = input.events.find(
    (event): event is Extract<Event, { type: "GATE_TRANSITION" }> =>
      event.type === "GATE_TRANSITION" && event.payload.idempotencyKey === idempotencyKey
  );
  if (existing !== undefined) {
    return {
      events: input.events,
      result: {
        applied: false,
        directive: existing.payload.directive,
        transitionId: existing.payload.transitionId,
        runStatus: existing.payload.to
      }
    };
  }
  // CANDIDATE: the caller-precondition check stands in for a public flag /
  // parallel entry; when the seq is fresh the scan is provably a miss.
  const fresh = input.expectedSeq === nextTrackingSeq(input.events);
  if (!fresh) {
    const existingAssessment = input.events.find(
      (event): event is Extract<Event, { type: "TRACKING_ASSESSMENT" }> =>
        event.type === "TRACKING_ASSESSMENT" &&
        event.payload.seq === input.expectedSeq &&
        event.payload.assessmentHash === input.assessmentHash
    );
    if (existingAssessment !== undefined) {
      return {
        events: input.events,
        result: {
          applied: false,
          directive: mapGateDirectiveReplica(input.assessment).directive,
          runStatus: currentGateStatusReplica(input.events)
        }
      };
    }
  }

  const mapped = mapGateDirectiveReplica(input.assessment);
  const from = currentGateStatusReplica(input.events);
  const runId = input.assessment.runId as RunId;
  const occurredAt = input.nowIso as IsoTimestamp;
  const next = [...input.events];

  next.push(
    validateEvent({
      id: input.generateEventId(),
      schemaVersion: 1,
      occurredAt,
      runId,
      type: "TRACKING_ASSESSMENT",
      actor: "supervisor",
      payload: {
        assessment: input.assessment,
        assessmentHash: input.assessmentHash,
        seq: input.expectedSeq
      }
    })
  );

  if (mapped.directive === "none") {
    return { events: next, result: { applied: true, directive: "none", runStatus: from } };
  }

  const transitionId = input.generateEventId();
  next.push(
    validateEvent({
      id: transitionId,
      schemaVersion: 1,
      occurredAt,
      runId,
      type: "GATE_TRANSITION",
      actor: "supervisor",
      payload: {
        transitionId,
        episodeId: input.assessment.episodeId,
        turnId: input.assessment.turnId,
        seq: input.expectedSeq,
        from,
        to: mapped.runStatus,
        reasonCode: mapped.reasonCode,
        assessmentHash: input.assessmentHash,
        evidenceRefs: input.assessment.evidenceRefs,
        policyVersion: input.policyVersion,
        idempotencyKey,
        directive: mapped.directive
      }
    })
  );

  if (mapped.directive === "queue_analysis") {
    next.push(
      validateEvent({
        id: input.generateEventId(),
        schemaVersion: 1,
        occurredAt,
        runId,
        type: "RUN_BLOCKED",
        actor: "supervisor",
        payload: {
          reason: "ANALYSIS_QUEUED",
          requiredEvidence: [...input.assessment.evidenceRefs]
        }
      })
    );
  }

  if (mapped.directive === "wait_user") {
    const waitingId = input.generateEventId();
    next.push(
      validateEvent({
        id: waitingId,
        schemaVersion: 1,
        occurredAt,
        runId,
        type: "RUN_WAITING_FOR_USER",
        actor: "supervisor",
        payload: {
          messageId: createMessageId(() => waitingId.slice("evt_".length))
        }
      })
    );
  }

  return {
    events: next,
    result: { applied: true, directive: mapped.directive, transitionId, runStatus: mapped.runStatus }
  };
}

{
  const rng = mulberry32(0xa88a01);

  // (a) SOUND sub-lemma fuzz: for arbitrary tables (out-of-order, duplicate,
  // negative seqs), expectedSeq = nextTrackingSeq(events) implies the
  // TRACKING_ASSESSMENT find must miss.
  for (let trial = 0; trial < 5000; trial += 1) {
    const events: LooseEvent[] = fillerEvents(Math.floor(rng() * 40));
    const nGate = Math.floor(rng() * 6);
    for (let i = 0; i < nGate; i += 1) {
      const seq = Math.floor(rng() * 12) - (rng() < 0.1 ? 5 : 0); // include negatives
      if (rng() < 0.5) {
        events.push({ type: "TRACKING_ASSESSMENT", payload: { seq, assessmentHash: `h${Math.floor(rng() * 3)}` } });
      } else {
        events.push({
          type: "GATE_TRANSITION",
          payload: { seq, idempotencyKey: `h${Math.floor(rng() * 3)}:${Math.floor(rng() * 12)}`, to: "RUNNING" }
        });
      }
    }
    const table = events as unknown as readonly Event[];
    const fresh = nextTrackingSeq(table);
    const hit = table.some(
      (event) => event.type === "TRACKING_ASSESSMENT" && (event.payload as { seq: number }).seq === fresh
    );
    check("S8-A-1 sound sub-lemma (fresh seq never present)", !hit, `fresh=${fresh}`);
  }

  // (b) Variant A counterexample: schema-valid GATE_TRANSITION whose
  // idempotencyKey suffix disagrees with its seq. validateEvent enforces
  // only non-empty-string on idempotencyKey, so this table is reachable
  // by the schema; the invariant is enforced nowhere (S1-A-9 structure).
  const assessment = realAssessment("PASSED");
  const h = hashAssessment(assessment);
  const advTable = [
    ...fillerEvents(5),
    { type: "TRACKING_ASSESSMENT", payload: { seq: 6, assessmentHash: "hOther" } },
    { type: "GATE_TRANSITION", payload: { seq: 3, idempotencyKey: `${h}:7`, to: "BLOCKED", transitionId: "evt_adv", directive: "queue_analysis" } }
  ] as unknown as readonly Event[];
  const freshSeq = nextTrackingSeq(advTable);
  check("S8-A-1 counterexample precondition (seq is fresh)", freshSeq === 7);
  let counter = 100;
  const gen = (): EventId => `evt_${String(counter++).padStart(8, "0")}` as EventId;
  const currentOut = applyTrackingGate({
    events: advTable,
    assessment,
    assessmentHash: h,
    expectedSeq: freshSeq,
    policyVersion: "track-v1",
    nowIso: NOW_ISO,
    generateEventId: gen
  });
  // variant A would skip BOTH finds and append; current treats it idempotent.
  check(
    "S8-A-1 variant A diverges (current is an idempotent no-op on the adversarial table)",
    currentOut.result.applied === false && currentOut.events === advTable
  );
  console.log(
    `S8-A-1 variant A counterexample: fresh seq=${freshSeq} but adversarial GATE_TRANSITION{seq:3, idempotencyKey:"<hash>:7"} matches the first find -> current=no-op idempotent, skip-both-finds variant would append a duplicate gate (NOT equivalent; unforced cross-field invariant, S1-A-9 structure)`
  );

  // (c) Variant B replica equivalence fuzz: fresh and stale expectedSeq,
  // PASSED (directive none) and FAILED (hard -> queue_analysis) shapes,
  // idempotent replays of both finds' kinds.
  const passed = realAssessment("PASSED");
  const failed = realAssessment("FAILED");
  for (let trial = 0; trial < 3000; trial += 1) {
    const a = rng() < 0.5 ? passed : failed;
    const ha = hashAssessment(a);
    const events: LooseEvent[] = fillerEvents(Math.floor(rng() * 40));
    const nPrior = Math.floor(rng() * 4);
    for (let i = 0; i < nPrior; i += 1) {
      const seq = Math.floor(rng() * 8);
      if (rng() < 0.5) {
        events.push({ type: "TRACKING_ASSESSMENT", payload: { seq, assessmentHash: rng() < 0.3 ? ha : `h${i}` } });
      } else {
        events.push({
          type: "GATE_TRANSITION",
          payload: {
            seq,
            idempotencyKey: rng() < 0.3 ? `${ha}:${seq}` : `h${i}:${seq}`,
            to: pick(rng, ["RUNNING", "BLOCKED", "WAITING_FOR_USER"] as const),
            transitionId: `evt_prior_${i}`,
            directive: pick(rng, ["none", "queue_analysis", "wait_user"] as const)
          }
        });
      }
    }
    const table = events as unknown as readonly Event[];
    const fresh = nextTrackingSeq(table);
    // 60% fresh seq (production shape), 40% stale seq (replay shape)
    const expectedSeq = rng() < 0.6 ? fresh : Math.floor(rng() * Math.max(1, fresh));
    let c1 = 100;
    let c2 = 100;
    const in1: GateApplyInput = {
      events: table,
      assessment: a,
      assessmentHash: ha,
      expectedSeq,
      policyVersion: "track-v1",
      nowIso: NOW_ISO,
      generateEventId: () => `evt_${String(c1++).padStart(8, "0")}` as EventId
    };
    const in2: GateApplyInput = { ...in1, generateEventId: () => `evt_${String(c2++).padStart(8, "0")}` as EventId };
    const expected = applyTrackingGate(in1);
    const actual = candidateApplyGateB(in2);
    check(
      "S8-A-1 variant B equivalence (result)",
      JSON.stringify(expected.result) === JSON.stringify(actual.result),
      `trial ${trial} expectedSeq=${expectedSeq} fresh=${fresh}`
    );
    check(
      "S8-A-1 variant B equivalence (events)",
      JSON.stringify(expected.events) === JSON.stringify(actual.events),
      `trial ${trial}`
    );
    if (!expected.result.applied) {
      check(
        "S8-A-1 variant B skip path returns same reference",
        (expected.events === table) === (actual.events === table)
      );
    }
  }

  // (d) bench: the dead TRACKING_ASSESSMENT miss-find over E=41; the
  // GATE_TRANSITION miss-find; end-to-end current vs variant B on the
  // fresh apply path.
  const benchTable = [
    ...fillerEvents(38),
    { type: "TRACKING_ASSESSMENT", payload: { seq: 0, assessmentHash: "hPrior" } },
    { type: "GATE_TRANSITION", payload: { seq: 0, idempotencyKey: "hPrior:0", to: "RUNNING", transitionId: "evt_p", directive: "none" } }
  ] as unknown as readonly Event[];
  const freshB = nextTrackingSeq(benchTable);
  const hb = hashAssessment(passed);
  const key = `${hb}:${freshB}`;
  const taFind = bench(() => {
    void benchTable.find(
      (event) =>
        event.type === "TRACKING_ASSESSMENT" &&
        (event.payload as { seq: number }).seq === freshB &&
        (event.payload as { assessmentHash: string }).assessmentHash === hb
    );
  }, 100000);
  const gtFind = bench(() => {
    void benchTable.find(
      (event) => event.type === "GATE_TRANSITION" && (event.payload as { idempotencyKey: string }).idempotencyKey === key
    );
  }, 100000);
  const curE2E = bench(() => {
    let c = 100;
    void applyTrackingGate({
      events: benchTable,
      assessment: passed,
      assessmentHash: hb,
      expectedSeq: freshB,
      policyVersion: "track-v1",
      nowIso: NOW_ISO,
      generateEventId: () => `evt_${String(c++).padStart(8, "0")}` as EventId
    });
  }, 10000);
  const candE2E = bench(() => {
    let c = 100;
    void candidateApplyGateB({
      events: benchTable,
      assessment: passed,
      assessmentHash: hb,
      expectedSeq: freshB,
      policyVersion: "track-v1",
      nowIso: NOW_ISO,
      generateEventId: () => `evt_${String(c++).padStart(8, "0")}` as EventId
    });
  }, 10000);
  console.log(
    `S8-A-1 bench E=41: dead TRACKING_ASSESSMENT miss-find=${(taFind * 1e6).toFixed(1)}ns/gate | GATE_TRANSITION miss-find (writer-invariant only)=${(gtFind * 1e6).toFixed(1)}ns/gate | e2e fresh apply: current=${(curE2E * 1e3).toFixed(2)}us variantB=${(candE2E * 1e3).toFixed(2)}us delta=${((curE2E - candE2E) * 1e6).toFixed(0)}ns/gate (x~5 gates/run; note variantB pays an extra nextTrackingSeq rescan standing in for the flag)`
  );
}

/* ============================================================
 * S8-A-2: analysis.ts proposeFromAnomaly sanitize-then-project collapse.
 * The candidate content reads only {gate, score, P, H, evidenceRefs,
 * summary.anomalyCodes, window.toolSituations(name, exitCode?)}, all of
 * which sanitizePacketForAnalysis passes through unchanged; the sanitized
 * intermediate packet (window reshaping, trust tagging) is dead work for
 * content construction. Candidate projects directly from the dirty packet.
 * Rejection axes to verify: byte-equality (yes), production reachability
 * (zero src/ callers -- test-only), cost share (JSON.stringify + registry
 * dominate), and the sanitize step being the security choke point
 * (defense-in-depth, S3-H-1 family).
 * ============================================================ */
{
  const rng = mulberry32(0xa88a02);
  const NOW = "2026-08-18T00:00:00.000Z" as IsoTimestamp;
  const AUTHOR: AuthorIdentity = { kind: "human", identity: "alice" };
  function sequentialIds(): IdGenerator {
    let n = 0;
    return () => {
      n += 1;
      return `trk${String(n).padStart(4, "0")}`;
    };
  }
  const identity = (): ResourceIdentity => ({
    kind: "prompt",
    name: "tracker-analysis",
    scope: { kind: "project", projectId: createProjectId(() => "trkproj01") }
  });

  function genPacket(trial: number): AnalysisPacketInput {
    const summary: RollingSummary = {
      schemaVersion: 1,
      constraints: [],
      unresolvedQuestions: [],
      confirmedDecisions: [],
      operations: [],
      prescore: Number(rng().toFixed(4)),
      human: { kind: "short-rule", H: 0.15, bucket: "whole-reject" },
      score: Number(rng().toFixed(4)),
      anomalyCodes: rng() < 0.5 ? ["soft-threshold"] : ["deterministic-fail", "soft-threshold"],
      evidenceRefs: [`evd_${trial}`],
      openMinors: [],
      omissions: [],
      failClosed: false
    };
    return {
      summary,
      window: {
        contextFacts: ["fact"],
        toolSituations:
          rng() < 0.7
            ? [
                {
                  name: pick(rng, ["test", "lint", "task-result"]),
                  ...(rng() < 0.7 ? { exitCode: Math.floor(rng() * 2) } : {}),
                  wrote: rng() < 0.5,
                  escaped: false,
                  artifactIds: [],
                  evidenceIds: ["evd_1"],
                  hashes: []
                }
              ]
            : [],
        ...(rng() < 0.5 ? { userText: "回滚全部" } : {}),
        ...(rng() < 0.3 ? { aiText: "assistant text" } : {}),
        ...(rng() < 0.4 ? { toolBodies: ["stdout blob"] } : {})
      },
      P: Number(rng().toFixed(4)),
      H: rng() < 0.5 ? Number(rng().toFixed(4)) : UNOBSERVED,
      score: Number(rng().toFixed(4)),
      gate: "soft-threshold",
      evidenceRefs: [`evd_${trial}`],
      ...(rng() < 0.6 ? { actorDefense: "I meant well" } : {}),
      ...(rng() < 0.6 ? { actorIdentity: "worker-7" } : {})
    };
  }

  // current content construction (verbatim from proposeFromAnomaly)
  function currentContent(packet: AnalysisPacketInput, rollbackTarget: string): string {
    const safe = sanitizePacketForAnalysis(packet);
    return JSON.stringify({
      gate: safe.gate,
      score: safe.score,
      P: safe.P,
      H: safe.H,
      evidenceRefs: safe.evidenceRefs,
      anomalyCodes: safe.summary.anomalyCodes,
      operations: safe.window.toolSituations.map((tool) => ({
        name: tool.name,
        ...(tool.exitCode !== undefined ? { exitCode: tool.exitCode } : {})
      })),
      rollbackTarget
    });
  }
  // candidate: direct projection, no sanitized intermediate
  function candidateContent(packet: AnalysisPacketInput, rollbackTarget: string): string {
    return JSON.stringify({
      gate: packet.gate,
      score: packet.score,
      P: packet.P,
      H: packet.H,
      evidenceRefs: packet.evidenceRefs,
      anomalyCodes: packet.summary.anomalyCodes,
      operations: packet.window.toolSituations.map((tool) => ({
        name: tool.name,
        ...(tool.exitCode !== undefined ? { exitCode: tool.exitCode } : {})
      })),
      rollbackTarget
    });
  }

  for (let trial = 0; trial < 4000; trial += 1) {
    const packet = genPacket(trial);
    check(
      "S8-A-2 content byte-equality",
      currentContent(packet, "ver_x") === candidateContent(packet, "ver_x"),
      JSON.stringify(packet)
    );
  }

  // end-to-end: candidate full JSON equals current full JSON with twin registries
  {
    const reg1 = new ResourceRegistry({ now: () => NOW, generateId: sequentialIds() });
    const reg2 = new ResourceRegistry({ now: () => NOW, generateId: sequentialIds() });
    const res = identity();
    reg1.registerBaseline({ identity: res, content: "baseline prompt", author: AUTHOR });
    const baseline2 = reg2.registerBaseline({ identity: res, content: "baseline prompt", author: AUTHOR });
    const dirty = genPacket(9999);
    const current = proposeFromAnomaly({ packet: dirty, registry: reg1, identity: res });
    const candidate = reg2.createCandidate({
      identity: res,
      content: candidateContent(dirty, baseline2.versionId),
      parentVersionId: baseline2.versionId,
      author: { kind: "detector", identity: "tracking-analysis" },
      evaluationPlan: { stages: ["static", "replay"], metrics: ["utility", "safety"], planVersion: 1 }
    });
    check("S8-A-2 end-to-end candidate equality", JSON.stringify(current) === JSON.stringify(candidate));
  }

  // bench: sanitize step alone vs direct projection; full proposeFromAnomaly
  const benchPacket = genPacket(12345);
  const sanitizeCost = bench(() => void sanitizePacketForAnalysis(benchPacket), 100000);
  const curCost = bench(() => void currentContent(benchPacket, "ver_x"), 100000);
  const candCost = bench(() => void candidateContent(benchPacket, "ver_x"), 100000);
  const reg = new ResourceRegistry({ now: () => NOW, generateId: sequentialIds() });
  const res2 = identity();
  reg.registerBaseline({ identity: res2, content: "baseline prompt", author: AUTHOR });
  const full = bench(() => void proposeFromAnomaly({ packet: benchPacket, registry: reg, identity: res2 }), 5000);
  console.log(
    `S8-A-2 bench: sanitize step=${(sanitizeCost * 1e6).toFixed(0)}ns | content current=${(curCost * 1e6).toFixed(0)}ns cand=${(candCost * 1e6).toFixed(0)}ns delta=${((curCost - candCost) * 1e6).toFixed(0)}ns/call | whole proposeFromAnomaly=${(full * 1e6).toFixed(0)}ns [grep: zero src/ callers -- test-only plane]`
  );
}

/* ============================================================
 * S8-A-3: GateInput dead fields P/human.
 * evaluateGates never reads input.P or input.human (only score, config,
 * the six hard flags, openMinors). Narrowing the public GateInput type
 * and dropping the two properties from turn.ts's call would be a public
 * type change (S1-F-6 class); the fields also document the spec intent
 * (gates are specified over P/H/score). Prove invariance, measure the
 * two property writes.
 * ============================================================ */
{
  const rng = mulberry32(0xa88a03);
  const humans: readonly HumanSignal[] = [
    { kind: "unobserved" },
    { kind: "ten-point", H: 0.7, mark: 7 },
    { kind: "short-rule", H: 0.15, bucket: "whole-reject" },
    { kind: "ratio", H: 0.5, agreed: 1, evaluable: 2, safetyRejected: true }
  ];
  for (let trial = 0; trial < 8000; trial += 1) {
    const minors: OpenMinor[] = Array.from({ length: Math.floor(rng() * 6) }, (_, i) => ({
      id: `m${i}`,
      text: `minor ${i}`,
      status: rng() < 0.7 ? "verified-true" : UNOBSERVED,
      consecutiveTurns: Math.floor(rng() * 4),
      touchesConstraint: rng() < 0.15,
      userRejected: rng() < 0.1
    }));
    const base = {
      score: rng(),
      config: DEFAULT_TRACKING_CONFIG,
      deterministicFail: rng() < 0.15,
      ownershipEscape: rng() < 0.15,
      claimedVerificationWithoutChecks: rng() < 0.15,
      repeatedNoProgress: rng() < 0.15,
      userRejectStop: rng() < 0.15,
      safetyRejected: rng() < 0.15,
      openMinors: minors
    };
    const a: GateInput = { ...base, P: rng(), human: pick(rng, humans) };
    const b: GateInput = { ...base, P: rng() * 1000 - 500, human: pick(rng, humans) };
    const outA = evaluateGates(a);
    const outB = evaluateGates(b);
    check(
      "S8-A-3 invariance to P/human",
      JSON.stringify(outA) === JSON.stringify(outB) && outA.openMinors === minors && outB.openMinors === minors,
      JSON.stringify({ a: { P: a.P, human: a.human }, b: { P: b.P, human: b.human } })
    );
  }
  // bench: literal with vs without the two dead properties (call included)
  const human: HumanSignal = { kind: "unobserved" };
  const withDead = bench(() => {
    void evaluateGates({
      P: 0.9,
      score: 0.9,
      human,
      config: DEFAULT_TRACKING_CONFIG,
      deterministicFail: false,
      ownershipEscape: false,
      claimedVerificationWithoutChecks: false,
      repeatedNoProgress: false,
      userRejectStop: false,
      safetyRejected: false,
      openMinors: []
    });
  }, 500000);
  const withoutDead = bench(() => {
    void evaluateGates({
      score: 0.9,
      config: DEFAULT_TRACKING_CONFIG,
      deterministicFail: false,
      ownershipEscape: false,
      claimedVerificationWithoutChecks: false,
      repeatedNoProgress: false,
      userRejectStop: false,
      safetyRejected: false,
      openMinors: []
    } as unknown as GateInput);
  }, 500000);
  console.log(
    `S8-A-3 bench: literal+call with dead fields=${(withDead * 1e6).toFixed(1)}ns without=${(withoutDead * 1e6).toFixed(1)}ns delta=${((withDead - withoutDead) * 1e6).toFixed(1)}ns/turn (x~5 turns/run)`
  );
}

/* ============================================================
 * Budget anchor re-verification (R3-A..R7-A lineage):
 * applyChildThreeLine end-to-end at real scale (41-event table,
 * apply path) x ~5 gates/run bounds ANY optimization in this slice.
 * ============================================================ */
{
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
  events.push({
    id: nextId(),
    schemaVersion: 1,
    occurredAt: NOW_ISO as Event["occurredAt"],
    runId: RUN_ID,
    type: "RUN_ATTACHED",
    actor: "supervisor",
    payload: { episodeId: "ep_bench", runId: RUN_ID, attachedAt: NOW_ISO }
  } as unknown as Event);
  for (let i = 0; i < 39; i += 1) {
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

void mulberry32(0xa88a04);
void mulberry32(0xa88a05);

if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```
