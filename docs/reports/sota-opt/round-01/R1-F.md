MODEL_SLUG=claude-fable-5-thinking-xhigh

# Round 1 / R1-F：`src/experiments/` 全量 SOTA 打磨

- 基线：`cursor/sota-persistent-opt-83a1` @ `d91e2bd`
- 切片：`src/experiments/` 全部 15 文件（2296 行）
- 结论：**落地 1 项渐近优化（S1-F）**，其余候选经理论 + 仿真裁决后全部否决并记入排除表（S1-F-1…S1-F-8）。落地后本切片在保行为 + 排除表约束下无更多可测优化。

## 1. 落地项 S1-F：restore 全量重校验的 population 成员判断 Set 化

文件：`src/experiments/shadow.ts`（`restoreShadowState`）、`src/experiments/canary.ts`（`restoreCanaryState`），新增共享校验 `requirePopulationMember(population: ReadonlySet<string>, episodeHash)`。

### 1.1 理论

M6-T3 shadow/canary runner 的每次 `assign` / `recordOutcome` / `restore` / `cancel` 都先走 restore 全量重校验（fail-closed，X3-3/X4-1 锁定不可增量化）。Iter4 把该 restore 记为 O(n) 并据此裁决「单次调用渐近被 restore 的 O(n) 锁定」——**该记载漏了一个嵌套因子**：restore 循环内对每条 assignment 调 `requirePopulationEpisode`，内部是 `plan.population.includes(...)` 线性扫描。设 A = 已有 assignment 数、P = 冻结 population 大小（A ≤ min(budget.maxAssignments, P)）：

- 改前单次 restore：O(P)（`validateExperimentPlan`）+ O(A × P)（逐条 includes）＝ **O(A × P)**；一次完整实验（A 次 assign，每次内部 restore）总计 **O(A²P) 级**（按序命中时 Σₖ k²/2 ≈ A³/6 次串比较）。
- 改后单次 restore：O(P)（validate）+ O(P)（建 Set）+ O(A)（O(1) 查询）＝ **O(P + A)**；全程 **O(AP + A²)**。
- 渐近下界论证：fail-closed 契约要求每次调用重验整个 plan（`validateExperimentPlan` 本身即 Ω(P)，内部 `assertUniqueNonEmpty` 已建一次性 Set）与全部 A 条 assignment（Ω(A)），故每调用 Ω(P + A) 是该契约下的下界——**落地后已达契约允许的渐近最优**，继续压低必须动 X3-3/X4-1/X1-1 排除的增量化或隐藏状态，不做。

### 1.2 保行为论证（逐位）

- 成员语义：`Set.has` 与 `Array.prototype.includes` 同为 SameValueZero；population 在进入循环前已由 `validateExperimentPlan` 强制为「唯一、非空字符串」数组，字符串上 SameValueZero ≡ `===`，接受/拒绝集合完全一致。
- 错误消息与顺序：`requirePopulationMember` 保留与 `requirePopulationEpisode` 完全相同的两段检查（先 `episodeHash is required`，后 `episode <hash> is not in the frozen population`），二者共用私有 `requireEpisodeHash`；循环内检查顺序不变（shadow：liveAction → shadowDecision → population；canary：population → action → exposureCount）。首个违规 assignment 抛出的错误逐字节一致。
- Set 从 `serialized.plan.population`（非 runner plan）构建，保持「restore 按序列化 plan 校验」的原语义。
- 公开面：`ShadowState`/`CanaryState` 形状、`requirePopulationEpisode` 签名与行为（assign 路径继续用它，单点查询建 Set 无收益）均不变。新增导出 `requirePopulationMember` 与既有 `requireUniqueAssignment`/`canonicalHaltReason` 同类，是 shadow.ts 作为 canary.ts 共享工具模块的既定模式，非 X1-2 式平行实现。

### 1.3 仿真证据

`scripts/round01-r1f-equivalence-sim.ts`（冻结 `d91e2bd` 版 restore/runner 为对照组，其余构件全部从生产导入，被测差异恰为本次编辑；`npx tsx scripts/round01-r1f-equivalence-sim.ts`）：

- 场景 1：120 个随机 plan（population 1–40、三种 missingOutcomePolicy、随机预算/阈值/曝光上限）× 随机操作序列（assign/recordOutcome/JSON 往返 restore/cancel，含未知 episode、重复 assign、重复 outcome、未 assign outcome、非法 scope、时钟回退），共 2409 次操作逐位比对（状态 `stableStringify` 相等；错误消息 + 错误类相等）。
- 场景 2：18 个篡改序列化状态用例（population 外 episode、空/非字符串 episodeHash、changedLiveAction、非法 shadowDecision/action、halted 无 haltReason、负 guardrailBreaches、exposureCount 不符、plan 换 population/mode/experimentId、population 检查先于 action 检查的顺序用例）——两侧抛错逐字节一致。
- 性能：P=2000、A=1000 全程（每 assign 一次 fail-closed restore）：参考 727.4 ms → 现行 152.1 ms（**4.8×**）；消除参考实现 **167,167,000** 次成员比较。剩余耗时为 X3-3/X4-1 锁定的 O(A) 重校验与防御性拷贝本体。
- 总计 **2668 项逐位检查全部通过**。

## 2. 全切片裁决（15 文件）

| 文件 | 裁决（一行） |
| --- | --- |
| `shadow.ts` | **落地 S1-F**（§1）；`recordExperimentOutcome` 的 `some`/成本累加为单点 O(n) 查询，Set 化需跨调用缓存＝X1-1，增量化＝X3-3；`shadowDecisionAt` RNG 重放为 X4-1 |
| `canary.ts` | **落地 S1-F**（§1）；`reversibleScopes.includes` 场景数个位数（S1-F-7） |
| `replay.ts` | H1 已落地；`propensityFor(selected)` 二次调用见 S1-F-2 |
| `gated-comparison.ts` | 共享门第 0 轮落地；strip-retry 复用首报告见 S1-F-1 |
| `comparison-report.ts` | 六遍聚合为 X3-2；`Array.from(families.entries())` 直接迭代为同类微噪声（S1-F-5） |
| `simulation-holdout.ts` | 拆分/查找已全 Set/Map 单遍；`observationsFromTrain` 线性一次性 |
| `dataset.ts` | `validateSealedDatasetManifest` 已 universe Set + membership Map 单遍；`rotateHoldout` 一次性双验是 fail-closed 设计 |
| `manifest.ts` | 已全 Set 单遍；`stableStringify` 为字节稳定序列化契约（第 3 轮认定不可动） |
| `holdout.ts` | `access` 审计追加拷贝 O(n²) 总量，见 S1-F-3（X4-2 同类） |
| `plan.ts` | 纯校验已 Set；返回 population Set 复用见 S1-F-6（X0-4 同类） |
| `isolation.ts` | 每调用 path.resolve 线性于 roots 数，一次性守卫 |
| `threshold-calibration.ts` | 三阈值三遍见 S1-F-4（X3-2/X3-5 同类） |
| `evaluation-card.ts` | 纯校验常数遍 |
| `shadow-compare.ts` | routeR1 薄封装；与 r1-shadow-report 合并为 X1-5 |
| `attribution-report.ts` | 21 行证据封装，无循环 |

## 3. 候选三条件裁决

| 候选 | (a) 复杂度下降 | (b) 逐位/契约可证 | (c) 现实规模非噪声 | 裁决 |
| --- | --- | --- | --- | --- |
| restore population 成员判断 Set 化 | ✓ O(A×P)→O(P+A)/次，达 fail-closed 契约下界 | ✓ SameValueZero + 错误消息/顺序逐字节一致（2668 项仿真） | ✓ P=2000/A=1000 实测 4.8×、1.67 亿次比较消除 | **落地 S1-F** |
| gatedComparisonReport strip-retry 复用首报告（`{...report, claims}`） | ✓ retry 路径省一次全量 compute | ✓ claims 不参与任何数值/校验计算，可证同值 | ✗ 仓内两调用方（eval-routing `claims: []`；r1-shadow-report 预 strip）使改进声明触发的 retry 不可达，收益不可测 | S1-F-1 |
| replayPolicy 消除 selected 的 `propensityFor` 二次调用 | ✗ 省 1/(E+1) 次调用 | ✗ `RoutingPolicy` 为公开扩展点，对带副作用/计数的策略调用次数与顺序可观测 | ✗ 常数噪声 | S1-F-2 |
| HoldoutVault.access 审计追加拷贝改可变 push | ✓ O(n²)→O(n) 总量 | ✗ `access` 返回 `updated.audit` 且状态外持，readonly 契约（X4-2 同类） | — | S1-F-3 |
| threshold-calibration 三遍并单遍 | ✗ 常数 3→1 | ✓ | ✗ 冻结标注集一次性、informational-only | S1-F-4 |

## 4. 新增排除项（已追加至 EXCLUSIONS.md）

| ID | 方案 | 排除原因 |
| --- | --- | --- |
| S1-F-1 | gatedComparisonReport strip-retry 复用首报告仅换 claims | claims 不参与数值计算、可证同值，但仓内两调用方（`eval-routing` 传 `[]`、`r1-shadow-report` 预 strip）使 retry 对改进声明不可达，收益不可测（X3-4/X4-3 同类）；strip 后重验 fail-closed 语义须保留 |
| S1-F-2 | replayPolicy 消除 selected 的 propensityFor 二次调用 | RoutingPolicy 公开扩展点，调用次数/顺序可观测；每 episode 仅省 1/(E+1) 次调用，噪声级 |
| S1-F-3 | HoldoutVault.access/replace 审计追加拷贝改可变 push | `access` 返回 audit 数组且 HoldoutState 外持，readonly 公开契约，可变化引入别名污染（X4-2 同类） |
| S1-F-4 | calibrateSoftThreshold 三阈值三遍并单遍 | 常数 3→1，冻结标注集一次性 informational 路径，收益不可测（X3-2/X3-5 同类） |
| S1-F-5 | comparison-report `Array.from(families.entries())` 改直接迭代 | 省一次数组分配，X3-2 同类常数噪声 |
| S1-F-6 | validateExperimentPlan 返回 population Set 供 restore 复用 | 公开 `: void` 签名变更（X0-4 同类）；restore 建 Set 已摊入其自身 Ω(P) 校验 |
| S1-F-7 | canary `reversibleScopes.includes` Set 化 | 声明 scope 个位数，X1-4 同类噪声 |
| S1-F-8 | recordExperimentOutcome 的 assignments/outcomes 查重与成本累加 Set/增量化 | 单调用单点查询建 Set 同 O(n)；跨调用缓存＝X1-1 隐藏状态；状态增量字段＝改公开 state 形状（X0-4）；fail-closed 每调用重算为 X3-3 同类 |

## 5. 验证

- `pnpm typecheck` ✓、`pnpm lint` ✓、`pnpm test` ✓（1168 pass / 0 fail / 1 skipped——既有的 provider-smoke 凭据跳过）、`pnpm build` ✓
- `npx tsx scripts/round01-r1f-equivalence-sim.ts` ✓（2668 项逐位检查，0 失败）
- 未触碰任何版本化阈值、权限、数据面契约；`canCloseProductionCheckpointF` 语义未动（simulation ≠ production）；X1-5、X3-2、X3-3、X4-1 全部维持。

MORE_OPTIMA=NO
BRANCH=cursor/r1-f-experiments-sota-4ac9
