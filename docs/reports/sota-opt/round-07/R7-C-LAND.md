MODEL_SLUG=claude-fable-5-thinking-xhigh

# Round 7 / R7-C-LAND：X2-1 重开落地报告（S7-C 支撑求和 eta）

- **战役:** 全库持久 SOTA 优化 Round 7 / R7-C 落地子代理（窄授权：表所有者
  审阅 R7-C §3 档案后重开 X2-1，专项落地该单一形态）
- **基线:** `cursor/sota-persistent-opt-83a1` @ `70336a6`（X2-1 行已由表
  所有者改写、S7-C-1..4 已入排除表；本分支未触碰 EXCLUSIONS.md 与
  PROGRESS.md）
- **分支:** `cursor/r7-c-x21-sod-land-83a1`
- **模型:** `claude-fable-5-thinking-xhigh`
- **赢家 ID:** **S7-C**（支撑求和 eta）；败者维持 S7-C-1..4 不变

## 1. 改了什么（生产 diff 全量）

`src/routing/offline-logit.ts` 单文件、`irls` 单站点：S2-C 去重分支内的
唯一键 eta 计算由全量 `dot(beta, vectors[i]!)`（p 次乘 + p 次加，含
±0.0 零项）替换为对该行 `supports[i]` 的**升序**支撑求和：

```ts
let value = 0;
const active = supports[i]!;
for (let ai = 0; ai < active.length; ai++) value += beta[active[ai]!]!;
```

站点处新增一行前提注释（0/1 设计元素 + 累加器 +0.0 起步 + 有限 β；
设计引入非 0/1 元素时必须回退全量 dot），并把紧邻的 S2-C 去重理由注释中
「eta = dot(beta, x)」更新为支撑求和表述（纯文档触碰，同一站点）。

**逐字未动的部分（授权边界确认）：**

- S2-C stamp/去重本体原样（Int32Array 标记 + etaByKey/muByKey 复用）。
- S6-C `switch(active.length)` 累加分派 s=2..5 直线体 + 滚动 default
  一字未动。
- 共享 `dot()` 辅助函数原样，`onProbabilitiesFor` 与
  `averagePredictiveComparison`（APC）继续逐字使用它——on-prob / APC
  数值路径零改动。
- eta 循环未做任何展开（S6-C-4 已裁决淘汰短支撑展开，不重开）；
  S5-C-5（串行链不重排——保留项相对序原样升序）、S5-C-7、S6-C-1..7、
  S7-C-1..4 全部未重开未触碰。

理论依据即 R7-C §3.1 引理（表所有者已接受，不再复议）：0/1 设计 +
`let value = 0`（+0.0 起步）+ 有限 β（`every(Number.isFinite)` 守卫）
⇒ 部分和永不为 −0.0，被跳过的 `0·β` 项均为逐位无操作、保留的 `1.0·β`
即 `β` 本身。

## 2. 落地资产：`scripts/round07-r7c-equivalence-sim.ts`

以 `scripts/round06-r6c-equivalence-sim.ts` 与 R7-C.md 附录脚本为模板：

- **生产导入 = 新代码**（落地后的 SOD 形态，`fitLogitAdditive` 直接导入）。
- **对照 = 冻结改动前生产 irls**（S6-C 本体逐字：全量 dot eta + switch
  累加），另内嵌独立于生产导入的 SOD 赢家副本（与 CTL 恰差 eta 单编辑）。
- **场景 1**：24 个直接 irls 夹具，支撑大小 1..8 全扫（含生产不可达
  s=6..8）、~1/3 行共享向量引用与规范键、maxIter ∈ {1,3,50}。
- **场景 1b**：R7-C §3.2 三个 ±0.0 对抗夹具原样入库——`beta0-truncated`
  （maxIter=1 钉死 β=0 首迭代）、`negative-beta`（全败哑元驱动负 β，
  参考侧 0·β 产 −0.0 项，直击 X2-1 原排除理由）、`empty-support`
  （全零向量 s=0 端点）。
- **场景 2**：53 个全报告夹具 × {生产导入, SOD 副本} vs 对照。
- 全部数值检查为 coefficients / effects(point/lcb/ucb) 元素级
  `Object.is`（逐位），diagnosis/reason/rowsUsed/estimator 逐字。
- eta 站点插桩 + 多路赛马（默认模式）与干净两路 `--duel` 模式。

## 3. 逐位计数

| 项 | 结果 |
| --- | --- |
| 全量电池单次运行 | **6,193 项逐位检查全绿** |
| 独立运行次数 | **× 3 次全绿，输出结论逐位一致** |
| 决斗进程内检查 | 250 项/次 × 4 次（3× ctl,prod + 1× sod,prod）全绿 |
| perf 夹具 eta 站点核算 | rowVisits=3,586,400；dedupDots=1,249,652；**删除 74,979,120 个 mul+add 对**；**保留 5,563,132 次支撑加法**（s̄=4.4517）——与 R7-C §1/§3.3 档案逐一吻合 |

## 4. 三次独立干净两路计时（vs 冻结 S6-C，本 VM，Node 22.22.2）

| 对比 | 三次独立进程 | 说明 |
| --- | --- | --- |
| 干净两路 ctl（冻结 S6-C）vs 生产导入（SOD 落地） | **+76.7 / +75.4 / +71.3 ms**（818.1→741.3、818.3→742.9、817.6→746.3；**1.096–1.104×**） | 三次同号、全部越过 ±35 ms 噪声带（最低值为带宽 2 倍以上） |
| 线束锚点 sod（副本入线束）vs 生产导入（直接） | −4.0 ms（688.0 vs 692.0，0.994×） | 两侧同算法，差值≈0 ⇒ 干净两路线束代价在本 VM 上可忽略，ctl-vs-prod 差值基本全为算法收益 |
| 多路赛马（相对序） ctl → 生产 | 844.0→751.7 / 779.1→687.4 / 780.5→689.8 | 三次方向一致，SOD 副本道同向（769.1/702.8/702.4） |

实测 +71~77 ms 略高于档案预期带（~+40 到 +65 ms）：方向与机理与档案
一致（删除 75.0M 个点积 mul+add 对），线束锚点显示本 VM 干净两路的
注入代价近零（R7-C 当时测得 ~20 ms），故落地形态直读收益略高于预期
属 VM 间正常离散；全部硬性判据（≥3 次独立运行、同号、越 ±35 ms 带）
满足。

## 5. 交叉回归与门禁

既有仿真资产全量复跑（本 VM 锚点，父代理将复核）：

| 资产 | 结果 |
| --- | --- |
| round01-r1c | ✓ 8,028 项全绿 |
| round02-r2c | ✓ 14,420 项全绿 |
| round03-r3c | ✓ 14,730 项全绿 |
| round04-r4c | ✓ 24,888 项全绿 |
| round05-r5c | ✓ 28,555 项全绿 |
| round06-r6c | ✓ 25,483 项全绿 |
| round07-r7c（本资产） | ✓ 6,193 项 × 3 次独立运行全绿 |

门禁（Node 22.22.2 via nvm，VM 默认 22.14.0 低于 engines ≥22.19.0，
与 R1-C..R7-C 同处理；pnpm 10.17.1，`pnpm install --frozen-lockfile`）：

```bash
pnpm typecheck   # ✓
pnpm lint        # ✓
pnpm build       # ✓
npx tsx --test "test/unit/routing/*.test.ts"   # ✓ 198/198 pass（18 suites）
```

测试文件零改动（未削弱、未适配）。EXCLUSIONS.md / PROGRESS.md 零触碰
（归表所有者）。未开 PR。

## 6. 失效条件（回退契约）

若设计矩阵未来引入**非 0/1 元素**（连续特征、行加权等），§3.1 引理
前提失效（乘积有舍入、±0.0 号位不再保逐位），X2-1 原排除理由恢复效力，
本站点必须回退为全量 `dot(beta, vectors[i]!)`。该条件已以一行注释钉在
生产站点上；`computeSupports` 的 `!== 0` 选择与 `build()` 只写 1 的
构造是前提成立的静态证据。

## 7. 供父代理落地清单

- **落地赢家:** S7-C（支撑求和 eta，X2-1 重开专项）——生产单站点编辑 +
  落地仿真资产 + 本报告，共 3 个文件。
- **败者维持:** S7-C-1..4（已在排除表，本分支未触碰）。
- 复核入口：`npx tsx scripts/round07-r7c-equivalence-sim.ts`（全量电池）
  与 `--duel ctl,prod` × 3 次独立进程（干净两路落地数字）。

MORE_OPTIMA=no
BRANCH=cursor/r7-c-x21-sod-land-83a1
