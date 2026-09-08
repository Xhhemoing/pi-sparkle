MODEL_SLUG=claude-fable-5-thinking-xhigh

# Round 2 / R2-C：离线路由切片第二遍 SOTA 打磨

- **战役:** 全库持久 SOTA 优化 Round 2 / R2-C（10 区并行之一）
- **基线:** `cursor/sota-persistent-opt-83a1` @ `627a438`（含 Round 1 全部已合入成果）
- **分支:** `cursor/r2c-offline-routing-6f3a`
- **切片:** `src/routing/{r1,r1-shadow-report,posterior,offline-logit,offline-prob-add,propensity,lin-alg,bandit,shadow}.ts`（9 文件全量重读）

## 结论

**落地 1 项（S2-C）逐位保行为优化**，位于 `offline-logit.ts` 的 IRLS 热路径：
协变量三元组 (scenarioId, modelVersion, projectId) 相同的行持有**逐位相同的
design 向量**，故每次 IRLS 迭代内 `eta = dot(beta, x)` 与 `mu = sigmoid(eta)`
对这些行是同一纯函数值——按"规范行键"每迭代每键只算一次、其余行拷贝该
double，与逐行重算逐位一致。bootstrap 有放回重采样使键重复度进一步放大
（重采样行按索引复用基线键，与 S1-C (a) 的向量/支撑复用同构）。真实规模
夹具（rows=400、p≈60、bootstrap=200，规范键 167 个，即 R1-C 同一夹具）四次
独立运行 **1.09–1.12×（节省 163–202 ms）**；每 fit 的 eta 点积从
**3,586,400 次降到 1,249,652 次（消除 65.2%）**，迭代数逐位相同（8966=8966）。
14420 项逐位一致性检查全绿。同族三个附加变体（on-prob 站点去重、APC 虚零
点积、delta 融合）实测边际均在噪声内，按单赢家裁决淘汰记入排除表
（S2-C-1..3），另有两个理论裁决淘汰项（S2-C-4/5）。落地后本切片在排除表与
规格双路约束下再次收口。

这推翻了 R1-C 收口声明中"eta 的全量 dot 被 X2-1 锁定"的一处过强概括：X2-1
锁定的是**改变求和项集合**（按支撑求和），而 S2-C 不改任何一次求和的项集合
与顺序，只是把"对逐位相同输入的整段重复求值"替换为"求值一次、按位拷贝"，
消除的是重复调用而非浮点运算路径。

不声称 Outcome-supported；Checkpoint F-PROD 仍开放（ADR-005）。双 LCB
（Beta vs 正态）与双归因（offline-logit vs offline-prob-add）全部保留
（X0-11），live 面零文件改动。

## 0. 范围与约束遵守

- 排除表全部维持，禁止重开项零触碰：X2-1（不改求和项集合——eta 仍是全量
  dot，只去重相同输入的调用）、X2-2（APC 按 (row,column) 记忆化维持排除——
  APC off 值仍逐 (行位置, 列) 计算，S2-C 未触及该站点）、X2-3/X1-3（数值
  路径逐字未动）、X1-1（去重 scratch 是 fit 内局部量，不跨调用存活）、
  X1-6/S1-C-1..10（未重提）。
- 公开面零变化：`fitLogitAdditive` 签名、输出字段与顺序、reason 字符串、
  bootstrap PRNG 调用序（每 draw 恰好 rows 次 `random()`）、全部版本化阈值
  （ATTRIBUTION_EFFECT 0.1、QUALITY_FLOOR 0.55、INTERACTION_MIN_N 3、
  MIN_SUCCESSFUL_DRAWS 20、bootstrap 200、IRLS TOL/ridge、二分 80 次）
  逐字未动。`irls` 为模块私有,加参不改公开面（R1-C 已有先例）。
- 仓库变更仅三处：`src/routing/offline-logit.ts`（切片内）、
  `scripts/round02-r2c-equivalence-sim.ts`（本轮仿真回归资产，沿用
  R1-C/R1-F 先例）、本报告。

## 1. 落地项 S2-C：IRLS 规范行 eta/mu 去重

### 1.1 机会与理论

S1-C (a) 已把 bootstrap 的静态工件（design 向量、支撑列表）按基行索引复用，
但每次 IRLS 迭代仍对**每个样本位置**重算 `dot(beta, vectors[i])` 与
`sigmoid`。观察：design.build 是协变量三元组的纯函数 ⇒ 三元组相同的行向量
逐位相同 ⇒ 对固定 beta，其 eta/mu 是同一 double。真实归因数据中同键行大量
存在（这正是 INTERACTION_MIN_N≥3 交互列存在的前提）；bootstrap 有放回抽样
再叠一层重复（n 抽 n 期望仅 63.2% 位置互异）。perf 夹具上 400 行仅 167 个
规范键，抽样后每迭代平均仅 ~139 个键需要求值。

实现：`canonicalRowKeys` 每基线拟合算一次（嵌套 Map 免分隔符
碰撞——modelVersion 含 `|` 不会串键），bootstrap 按索引复用；`irls` 内
`Int32Array` 迭代戳 + `Float64Array` 键值缓冲（double 存取无精度损失），
每迭代首现键求值、其余拷贝。scratch 生命周期严格限于单次 `irls` 调用。

### 1.2 保行为论证（逐位）

- 同键行的向量内容逐位相同（build 纯函数 + 三元组相同）⇒ `dot(beta, ·)`
  对相同内容按相同顺序求和 ⇒ 同一 double；`sigmoid` 确定性 ⇒ 同一 double。
  把该值写入 eta[i]/mu[i] 与逐行重算所得逐位相同 ⇒ 后续累加循环
  （w/z/X′WX/X′Wz）读到的输入逐位相同 ⇒ beta 序列、收敛判据、迭代数全部
  逐位复现（仿真实证 8966=8966）。
- 求和项集合与顺序零改变（区别于 X2-1）；数值路径零改变（区别于
  X2-3）；无跨调用状态（区别于 X1-1/X2-2）。PRNG 调用序不变；跳过 draw
  语义不变（sampleKeys 与既有三数组同批推入）。
- 退化域：全同键（键数 1）与全异键（键数 = n，dedup 退化为原逐行计算加
  一次戳检查）两端均在等价夹具中显式覆盖。

### 1.3 相似方案组：单赢家裁决

同族"规范键派生量复用"按站点分组（阶段基准均为 rows=400/p≈60/bootstrap=200
夹具中位，多次独立运行）：

| 站点 | 方案 | 裁决 |
| --- | --- | --- |
| IRLS eta/mu（每迭代热点） | 去重 vs 现状逐行 | **落地 S2-C**：四次运行 1913.4→1746.5 / 1894.6→1731.8 / 1883.0→1716.8 / 1952.4→1750.8 ms（1.09–1.12×），稳定高于 S1-C-1 判定的 8.5–46 ms 噪声带，与 R1-C (c) 落地门槛（~140–150 ms）同级 |
| on-prob（每 fit 一次） | 同款去重 | 淘汰 S2-C-1：边际 −2.5/−3.6/−2.6 ms，在运行噪声（±35 ms）内；站点每 fit 仅 rows 次 sigmoid∘dot |
| APC off 值 | 按 (row,column) 去重/记忆化 | **X2-2 维持排除，未重提**（禁止重开）；off 点积仍逐位置计算 |
| 批量化 | 同键贡献 `k×x` 批量累加 | 违逐位（浮点加法非结合，X2-1/X2-3 域），不可行 |

### 1.4 仿真证据

`scripts/round02-r2c-equivalence-sim.ts`（冻结 `627a438` 版 S1-C 生产原文为
对照组；`betaQuantileLcb`/`solveSymmetric` 本轮未变、从生产导入，被测差异恰
为 S2-C 编辑；`npx tsx scripts/round02-r2c-equivalence-sim.ts`）：

- **等价**：51 个夹具 ×｛生产 S2-C、候选、被拒 S2-C-1/2/3｝五路 vs 冻结
  参考——40 个随机夹具 + 空设计 + 全 PASS/全 FAIL 退化 + bootstrap=5
  （INVALID_ESTIMATE 路径）+ 4 行小样本 + `maxIter=3` 截断 IRLS +
  modelVersion 含 `|`（同时压测嵌套 Map 键免碰撞）+ 单水平因子 + 默认
  bootstrap=200 中型夹具 + **重键夹具**（80 行 2×2 格）+ **全异键夹具**
  （36 行零重复,键空间退化为 n）+ 性能夹具本体。effects 的
  name/point/lcb/ucb 全部 `Object.is` 逐位、diagnosis/reason/rowsUsed/
  estimator/writesActivePointer 逐字。**共 14420 项检查全部通过**
  （四次独立运行结论逐位一致）。
- **性能**：见 §1.3 表；落地后生产实测 1952.4→1769.1 ms（1.10×）。
  每 fit eta 点积 3,586,400→1,249,652（−65.2%），迭代数 8966=8966。
- **交叉验证**：`round01-r1c-equivalence-sim.ts` 全绿且对 bb39570 参考
  实测 2426.5→1755.0 ms（**1.38×**，R1-C 时 1.24×；1.24×1.10≈1.36 与本轮
  增量吻合）；`iter2-equivalence-sim.ts` 全绿且 12236.6→1796.6 ms
  （**6.8×**，S1-C 后为 6.2×）。
- **渐近收口**：落地后每迭代 eta 成本下界为 Ω(distinct keys × p)——互异
  输入的纯函数求值集合已是最小；进一步压缩只剩批量化（违逐位）或改数值
  路径（X1-3/X2-3）。APC off 点积被 X2-2 + S1-C-1/S2-C-2 三面锁定；
  `solveSymmetric` 的 O(p³) 与防御性拷贝是版本化数值路径 + 公开 readonly
  契约本体；bootstrap 抽样本身 Ω(draws×rows)。**本文件重新达到排除表约束
  下的可测最优。**

## 2. 全切片裁决（9 文件）

| 文件 | 裁决（一行） |
| --- | --- |
| `offline-logit.ts` | **落地 S2-C**（§1）；同族附加项 S2-C-1..3 实测噪声淘汰；APC 循环反转 S2-C-4、采样塌缩检查融合 S2-C-5 理论淘汰；X2-1/X2-2/X2-3 维持 |
| `offline-prob-add.ts` | 与 R1-C 裁决一致：S1-C-6/7 维持；`diagnose` lastSegment 观察项维持"只记录不改"（Frozen formula）；无新候选 |
| `posterior.ts` | C1/B1/A2 已落地形态；S1-C-2/3/4/5 维持；`updatePosterior` 的 `Math.pow` 换乘倒数为非逐位（X2-3 域）；无新候选 |
| `r1.ts` | S1-C-10/X1-4/X1-6 维持；config spread 与 modelsById 重建 M≤10 常数；无新候选 |
| `r1-shadow-report.ts` | 主路径 A2/B1 后形态；merge 路径仓内不可达（S1-C-2/3）；X1-5 维持；无新候选 |
| `propensity.ts` | S1-C-8/X3-5 维持；固定字段校验无热点；无新候选 |
| `lin-alg.ts` | 数值路径 + 入参防御性拷贝双锁定（X2-3 + 公开 readonly 契约）；所有权转移变体=X1-2/X0-4 同类,维持 R1-C 裁决 |
| `bandit.ts` | S1-C-9/S1-A-8 维持；`recordReward` includes 换 Set 为 arms 个位数同族噪声；不可变契约拷贝保留（X4-2 同类） |
| `shadow.ts` | X4-2（decisions 追加拷贝）/S1-C-9 维持；drift/预算扣减 O(1)；无新候选 |

## 3. 候选三条件裁决总表

| 候选 | (a) 复杂度下降 | (b) 逐位/契约可证 | (c) 现实规模非噪声 | 裁决 |
| --- | --- | --- | --- | --- |
| IRLS 规范行 eta/mu 去重 | ✓ 每迭代 dot 数 rows→distinct keys（夹具 −65.2%,重键数据更甚） | ✓ 14420 项逐位（含全同键/全异键/截断/`\|` 路径） | ✓ 四次运行 1.09–1.12×（163–202 ms） | **落地 S2-C** |
| on-prob 站点同款去重 | ✓ 每 fit rows→distinct 次 sigmoid∘dot | ✓ 同一论证,已仿真证明 | ✗ 边际 2.5–3.6 ms,噪声内（站点每 fit 仅一次） | S2-C-1 |
| APC off 点积虚零列（免 slice 拷贝） | ✓ 每活跃对省 O(p) 拷贝+分配 | ✓ `coef[c]×(+0)` 与拷贝路径同操作数同序,已仿真证明 | ✗ 边际 ±5 ms;上界即 S1-C-1 实测的 8.5–46 ms 噪声带,且每元素多一分支 | S2-C-2 |
| IRLS 收敛 delta 融合（免 map+reduce 分配） | ✗ 每迭代省 1 个 p 数组,分配级 | ✓ 同序求和,已仿真证明 | ✗ 边际 −9~+22 ms 双向抖动,噪声 | S2-C-3 |
| APC 循环反转（按行遍历支撑列,单遍出全列和） | ✗ 仅省 O(names×rows) 扫描（~4.5M 读/报告）,主导 slice+dot 不变 | ✓ 每列累加序仍为位置升序 | ✗ 上界个位 ms（X3-2/S1-C-5 同族）,且重构侵入大 | S2-C-4 |
| 采样循环融合单类塌缩检查（抽样时计数 y） | ✗ 省两遍短路 every（典型 1–3 元素即返回） | ✓ | ✗ 亚噪声;S1-A-4 已实证此类融合可更慢 | S2-C-5 |
| 同键贡献批量累加（sum += k×x） | ✓ | ✗ 浮点加法非结合,非逐位（X2-1/X2-3 域） | — | 不可行,不立项 |
| APC off 值按 (row,column) 去重 | — | — | — | X2-2 禁止重开,未重提 |

## 4. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S2-C-1 | offline-logit on-prob 站点规范键去重（`onProbabilitiesFor`） | 等价且已仿真证明,但站点每 fit 仅一次、边际 2.5–3.6 ms 在运行噪声内;IRLS 站点（S2-C）已取走同族全部可测收益 |
| S2-C-2 | offline-logit APC off 点积虚零列（免 slice 拷贝,`coef[c]×(+0)` 同操作数） | 等价且已仿真证明,但收益上界即 S1-C-1 实测 8.5–46 ms 噪声带且每元素多一分支,实测边际 ±5 ms |
| S2-C-3 | offline-logit IRLS 收敛 delta map+reduce 换融合循环 | 分配级常数（每迭代 1 个 p 数组）,实测边际 −9~+22 ms 双向抖动,噪声 |
| S2-C-4 | offline-logit APC 逐列扫描反转为按行遍历支撑列单遍累加 | 仅消除 O(names×rows) 扫描（~4.5M 读/报告,个位 ms 上界）,主导 slice+dot 成本不变（X3-2/S1-C-5 同族） |
| S2-C-5 | offline-logit bootstrap 采样循环融合单类塌缩检查 | 现状双 every 短路极快,融合收益亚噪声且 S1-A-4 已实证可更慢 |

## 5. 测试与验证

环境：Node 22.22.2（VM 默认 22.14.0 低于 engines ≥22.19.0,与 R1-C 同处理）。

```bash
pnpm typecheck   # ✓
pnpm lint        # ✓
pnpm build       # ✓
pnpm test        # ✓ 1168 pass / 0 fail / 1 skipped（既有 provider-smoke 凭据跳过）

# 相关子套件
npx tsx --test "test/unit/routing/**/*.test.ts" "test/unit/experiments/**/*.test.ts" \
  "test/integration/m5/**/*.test.ts" "test/integration/m6/**/*.test.ts"
# ✓ 297 pass / 0 fail

# 本轮仿真 + 全部既有回归资产
npx tsx scripts/round02-r2c-equivalence-sim.ts   # ✓ 14420 项逐位；1.09–1.12×
npx tsx scripts/round01-r1c-equivalence-sim.ts   # ✓ 8028 项；1.38×（原 1.24×,含本轮增量）
npx tsx scripts/iter1-equivalence-sim.ts         # ✓（146.4×）
npx tsx scripts/iter2-equivalence-sim.ts         # ✓ 6596 项；6.8×（原 6.2×,含本轮增量）
npx tsx scripts/iter3-equivalence-sim.ts         # ✓ 71351 项
npx tsx scripts/round01-r1f-equivalence-sim.ts   # ✓ 2668 项
npx tsx scripts/r1j-equivalence-sim.ts           # ✓ 2468 项
```

未修改任何测试文件；live 面文件零改动（`test/unit/routing/live-isolation.test.ts`
继续看护）；双 LCB 与双归因两路一行未删。

MORE_OPTIMA=yes
BRANCH=cursor/r2c-offline-routing-6f3a
