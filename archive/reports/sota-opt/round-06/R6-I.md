MODEL_SLUG=claude-fable-5-thinking-xhigh

# R6-I：CLI / Pi 适配器 / 配置 / 遥测切片第六遍复查报告

**战役:** 全库持久 SOTA 优化 Round 6 / R6-I
**基线:** `cursor/sota-persistent-opt-83a1` @ `338e3e0`
**分支:** `cursor/r6-i-cli-sixth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无新更优解落地，零生产代码改动。** 第六遍在 S5-I-1 落地态与完整排除表之上
换了三个真正的新角度，全部经理论 + 确定性测量（同窗交错 spawn-to-exit 双轮 +
53 检查 × 2 次输出等价电池 0 失败）裁决后淘汰，新增排除 S6-I-1…S6-I-3。

本轮最重要的正面产出是**修正了 R5-I 的一个枚举误差并把它测到底**：R5-I 断言
"剩余 108 个静态模块全部被 ≥2 条常驻命令路径共享"，但其判据是「src/ 全库内无
其他静态导入者」——过严。以**常驻图**（懒子树的静态边不计）重新审计后，
`main.ts` 仍有 7 条直接静态边的消费点各自落在单一分发分支内（`learning/auto-loop`
独占 8 模块子树、`routing/assign`、`graph/compile-children`、
`routing/public-prior-store`、`run/coordinator`、`preferences/materialize`，外加
一条 `import { type PublicPriorSnapshot }` 在 verbatimModuleSyntax 下于 dist 发射
承载加载的 `import {} from "../routing/public-prior.js"` 空边）。把这 7 条边全部
点用处化（S6-I-1）可从每个非 run 命令的加载集中移除 **15 个模块（108→93）**，
原型实测输出逐字节/归一化等价（53 检查 × 2 次 0 失败）——但同窗交错双轮基准
给出的收益只有 **2.2–4.6ms/调用**（≈0.2–0.3ms/模块，children/track 类中性），
S5-I-1 那种解析器病态红利没有再现（与 R5-I CPU profile 一致：S5-I-1 之后
`getPackageScopeConfig` self-time 仅剩 ~1ms），低于落地线一个数量级，按
S5-H-2（2.2–2.4ms）/S5-E-5（2.8–3.0ms）同带先例淘汰，原型改动已回滚。

另两个新角度同样淘汰：S6-I-2（进程内 `module.enableCompileCache()`）被结构性
证明在切片内无效——ESM 整图在入口求值前已全部解析/编译，任何 src 内调用点都
覆盖不到静态图；需要 bin bootstrap 才能全覆盖（package.json + dist 布局 =
切片外，S5-I-5 邻域），且以 `NODE_COMPILE_CACHE` 实测的全覆盖上界也只有
-8.0~-8.2ms，仍低于落地线。S6-I-3（main.ts 全量按命令拆分 handler 模块）经
逐类可达集计算证明收益全部集中在亚感知一次性交互/诊断类（version/help 省 91
模块 ≈18–27ms，R5-I §7 已判无用户价值；pref-list 省 84 ≈17–25ms；inspect 省
51 ≈10–15ms，S1-I-5/S2-I-2 同带先例），而真实工作流 run/resume/answer 只省
3–4 模块 ≈ ~1ms，代价是 1498 行 `main.ts` 的整体重构风险。

未重开任何 X* / S1-* / S2-* / S3-* / S4-* / S5-* / S6-* 条目。

## 0. 范围与约束遵守

- 切片：`src/cli/`（13 文件）、`src/pi-adapter/`（7 文件）、`src/config/`
  （2 文件）、`src/telemetry/`（1 文件）。`main.ts`（唯一自 R5-I 以来动过的
  切片文件）全量重读；其余文件以字节不变性 + 前五轮收口继承（§5）。
  **最终生产 diff 为零**（S6-I-1 原型在裁决后按纪律回滚）。测试零改动。
- 先读并遵守：README / EXCLUSIONS.md 全表（含 S6-A/B/C/D/E/H 新条目）/
  round-06/PLAN.md / round-01..05 全部 I 报告。
- **切片漂移复核**：`git diff 3101aee..338e3e0 -- src/{cli,pi-adapter,config,telemetry}`
  输出为空——切片自 S5-I-1 落地提交（`3101aee`）以来逐字节未变；期间 `src/`
  仅有切片外 `routing/offline-logit.ts` 的 S6-C 提交（92+/7-）。R1-I 下界表、
  R2-I/R3-I 执行期收口、R4-I 21 命令等价矩阵、R5-I 启动图普查与全部既有排除
  继承有效。
- 候选与排除表逐条辨析（关键三条）：
  - **S6-I-1 不是 S5-I-2/S5-I-3**（那是 12 边集的真子集变体）也**不是
    S5-I-4**——S5-I-4 的淘汰理由是"不具分支独占性（各 ≥2 常驻调用点）"，其
    例举对象（`run/replay.js`、`preferences/service.js`、`cli/model-catalog.js`）
    本轮复核确实各有 ≥2 条常驻消费分支，维持关死；本轮 7 条候选边的消费点
    **各自只落在一条分发分支**（run / pref list），处于 S5-I-4 判据之外、
    S5-I-1 同模式的枚举遗漏区。
  - **S6-I-2 不是 S5-I-5**——S5-I-5 关死的是追打解析器病态（dist 布局/
    package.json scope/引擎旗标）；编译缓存针对的是 V8 编译时间、机制无关。
    但其全覆盖实现路径（bin bootstrap）落在同一"切片外构建面"禁区，报告中
    如实标注邻域关系。
  - **S6-I-1 不触碰 S2-I-1/S3-I-3 错误选择契约**——`loadLearnedRouting` /
    `loadProvidersConfig` 的调用位置与静态性均未动；原型中每条动态 import 都
    落在原静态绑定首次使用的紧前位置，损坏 registry / providers.json 的
    fail-fast 面逐字节保留（等价电池含 broken-providers 用例钉死）。
- 硬不变量全部满足：双 LCB / 双归因 / 阈值 / CAS / 凭据面 / 数据面契约 /
  公开签名（`main`、`CliIo`、`deleteCommand` 导出集）零触碰；分析不改在途
  run；tracking 无指挥权；H/score 不写路由 PASS/FAIL。不声称
  Outcome-supported，Checkpoint F-PROD 仍开放（ADR-005）。
- 环境注记：VM Node v22.14.0 < engines >=22.19.0。`test/unit/cli` 中
  `doctor reports developer preview...` 断言 doctor exit 0 而 node 版本检查行
  FAIL——与 R5-I 记载完全相同的既有环境问题，基线同样失败，未改测试。
  本轮 lint 全绿，无需触碰任何继承脚本的 `console.*`。

## 1. 第六遍搜索：常驻图重审计（新测量基底）

前五遍的角度依次是执行期热路径（R1-R3）、外部包启动死重（R4）、仓库内
分支独占边（R5）。R5-I 收口断言剩余 108 模块"全部被 ≥2 条常驻命令路径
共享"（仿真 Part C 钉死代表性三者后外推）。第六遍不接受外推，对全部 108
模块做**逐边独占增量**计算：

1. **静态图解析器**（dist 上按行首 `import/export ... from` 解析，
   `await import()` 不计边）：`--version` 常驻图恰 108 模块，与 R5-I 的
   load-hook 计数一致（交叉验证通过）。
2. **逐边独占增量**（对 `main.js` 每条直接静态边计算移除后不可达集）：
   - `learning/auto-loop.js` → **独占 8 模块**（auto-loop、signals、
     task-success、diagnostics、bandit-store、routing/bandit、feedback/store、
     feedback/redaction）——它在 src/ 内的其他静态导入者（`cli/adapt.ts`、
     `track/loop.ts`）**全部已在懒子树内**，常驻图上 main 是唯一持有者；
     消费点仅 `--children` 分支的 adapt 块一处。
   - `routing/assign.js` → 独占 2（assign、assign-plan）；消费点仅
     `smartChildPlan`（children 分支）。
   - `graph/compile-children.js`、`routing/public-prior-store.js`、
     `run/coordinator.js`、`preferences/materialize.js` → 各独占 1；消费点
     分别仅 children 分支 / `--public-prior` 路径 / 普通 run / `pref list`。
   - **联合移除**再释放 `routing/public-prior.js`（被 main 的类型空边 +
     assign-plan + public-prior-store 共同持有）：合计 **15 模块，108→93**。
3. **R5-I 断言的修正范围**：其余全部 0 独占或 ≥2 常驻消费分支——
   `learned-routing` 被 `run/flowchart-run.js`（常驻，值导入）持有、
   `live-cascade` 被 `child-coordinator` 持有、`primary-catalog`/
   `cost-calibration`/`model-router` 被 `cli/model-catalog.js` 持有、
   `episode-store` 被 `episode-bind` 持有——对这些边点用处化不改变加载集，
   维持不动；`fake-executor`（run+resume）、`inspection`（run+inspect）、
   `preferences/service`（run+pref）等 ≥2 分支者维持 S5-I-4 关死。
4. **dist 发射细节**：`import { type PublicPriorSnapshot } from ...`（行内
   type 修饰符）在 verbatimModuleSyntax 下发射 `import {} from
   "../routing/public-prior.js"`——一条纯类型意图的**承载加载**空边。切片内
   仅此一条（全 dist 扫描：其余 7 处空边都在切片外文件）。
5. **模块纯度核查**：15 个候选释放模块顶层仅常量声明（正则/冻结表/字符串），
   无 `process.env` / `Date.now()` / `Math.random()` / 顶层 I/O——惰性化不
   改变任何可观察时序。

## 2. 候选三条件裁决总表

| ID | 候选 | 不在排除表 | 理论+仿真 | 真实规模 | 判定 |
|---|---|---|---|---|---|
| S6-I-1 | 常驻图分支独占残余 7 边点用处化（释放 15 模块） | ✓（S5-I-4 判据之外，§0） | ✓ 等价（53 检查 × 2 次 0 失败；纯度核查） | ✗ 非 run 类仅 -2.2~-4.6ms/调用；run 族中性 | 淘汰（低于落地线一个量级） |
| S6-I-2 | 进程内 `module.enableCompileCache()` | ✓（机制与 S5-I-5 不同） | ✗ 结构性无效：整图先编译后求值，切片内调用点覆盖不到静态图 | ✗ 全覆盖上界（`NODE_COMPILE_CACHE`）实测仅 -8.0~-8.2ms | 淘汰（结构不可达 + 上界低于线） |
| S6-I-3 | `main.ts` 全量按命令拆分 handler 模块 | ✓（新形态） | 逐类可达集计算（§4.3） | ✗ 收益集中于亚感知一次性类；run 族 ≈1ms | 淘汰（价值错位 + 重构风险） |

## 3. S6-I-1 原型与测量（本轮主体证据）

### 3.1 原型改动（已回滚，记录在案）

7 处编辑，全部在 `src/cli/main.ts`：删除 6 条值静态边 + 把
`import { type PublicPriorSnapshot }` 改为 `import type`；每条动态 import
插在原静态绑定首次使用的紧前位置（S4-I/S5-I-1 同模式）：
`assignTasks` 于 `smartChildPlan` 调用前（返回类型
`ReturnType<typeof assignTasks>` 等价改写为 `readonly TaskAssignment[]`，
与 `assignTasks` 声明返回类型逐字相同）；`compileChildrenToFlowchart` 于
children 分支编译点前；`runAutoAdaptLoop` 于 adapt fail-soft try 块内调用
前（加载失败归类为适应面故障，run 结果保留——比未捕获传播更贴近该块的
既有契约）；`loadPublicPriorSnapshot` 于 `loadOptionalPublicPrior` try 块内
（仅传 `--public-prior` 时才加载；ERR_MODULE_NOT_FOUND 不落入 ENOENT/
DomainValidationError 特判，照旧上抛）；`startRun` 于普通 run 启动前；
`getMaterializedView` 于 `pref list` 物化视图循环前。

### 3.2 等价裁决

- 输出等价电池（base/cand 双 dist × 成对全新夹具，raw 或 id/时间戳归一化
  逐字节）：`--version`、`help`、`pref list`（空 + correct 后物化视图路径，
  穿越动态边）、普通 run、`run --children`（adapt 行穿越 auto-loop 动态边）、
  `run --track`、broken providers fail-fast、`--public-prior` 缺文件 warning
  路径与 `--require-public-prior` 错误路径、同一持久化 run 快照双端
  `inspect`（含 `--json`）——**53 检查 × 2 次独立运行 0 失败**。
- 结构检查：cand 常驻图 93 模块 / base 108，释放集恰为 §1 的 15 模块。
- 引擎模块缓存保证动态 import 单例恒等（S4-I A.2 已证的同一机制，本轮
  改动同构）。

### 3.3 规模测量（同窗交错，spawn-to-exit 中位，两轮独立）

方法：base/cand 两 dist 树逐次轮换起序、有状态场景每次调用全新 state root
（configured 场景预写 providers.json）、inspect 用一次性预生成的持久化 run
快照只读复用、剔除 NODE_COMPILE_CACHE/NODE_OPTIONS。第一轮完整分布：

| 场景 | base 中位 | cand 中位 | Δ 轮1 | Δ 轮2 |
|---|---|---|---|---|
| `--version`（60 次） | 54.7ms | 50.4ms | **-4.2ms** | -3.8ms |
| `pref list`（40 次） | 54.3ms | 51.4ms | **-2.9ms** | -4.0ms |
| `inspect --run`（40 次） | 66.7ms | 62.9ms | **-3.8ms** | -4.6ms |
| 普通 `run`（configured，40 次） | 67.0ms | 64.0ms | **-2.9ms** | -2.2ms |
| `run --children`（configured，40 次） | 102.3ms | 102.9ms | -0.6ms | -0.1ms |
| `run --track`（configured，40 次） | 124.0ms | 124.0ms | +0.1ms | -0.2ms |

方向两轮一致：非 run 类 -2.2~-4.6ms（分布同样收紧：version 类 cand
max 53.2 < base min 52.4×p25 带），children/track 类中性（子树在分发点按需
回载，净额抵消）。**单模块边际成本 ≈0.2–0.3ms**（15 模块 ÷ 3–4ms），与
R5-I 记载的 0.3–0.6ms 带一致偏低。

### 3.4 为什么没有 S5-I-1 那样的病态红利

S5-I-1 的 -23~-30ms 中约 15–20ms 来自单条 `main.js → track/loop.js` 静态边
触发的 Node v22.14 `getPackageScopeConfig` 解析病态；R5-I CPU profile 证明
该边动态化后残余 self-time 仅 ~1ms——本轮 7 条候选边均不携带同类病态
（若有，双轮基准会在 10ms+ 量级显形；实测严格线性于模块数）。结论：
S5-I-1 之后的启动图收益回到纯死重消除的线性区，15 模块的天花板就是
~3–5ms。这正是 R5-I MORE_OPTIMA=no 的量化确认——其 §7(b) 的"继续切分
只剩 µs~低 ms 级"判断对本组候选成立，只是其"全部 ≥2 常驻共享"的结构
断言需要本报告的修正（判据错、结论对）。

## 4. 其余候选裁决细节

### 4.1 S6-I-2：编译缓存的结构性死刑 + 上界测量

ESM 加载分 resolve→parse/compile→instantiate→evaluate 四相：入口模块的
**整个静态图在任何模块体求值之前完成编译**。因此 `main.ts`（或其任何
静态依赖）体内调用 `module.enableCompileCache()` 时，108 模块已编译完毕
——既写不进也读不到缓存；能覆盖的只剩懒子树（track 子树边际加载共
3.1–3.5ms，编译份额亚 ms）。全覆盖需要 bin 指向一个先 enable 再
`await import("./main.js")` 的 bootstrap——改 package.json `bin` 与 dist
布局，双双落在切片外（S5-I-5 邻域禁区）。为把该角度一次关死，以
`NODE_COMPILE_CACHE` 环境变量（bootstrap 的语义等价物）实测全覆盖上界：
`--version` 53.7→45.5ms（-8.2ms）、普通 run 64.8→56.8ms（-8.0ms）——
即使拿到切片外手段，收益仍低于落地线。

### 4.2 S6-I-3：按命令拆分的价值错位

对候选图（93 模块）计算各命令类真实需要的可达集（假想每 handler 独立
模块化后各类只加载自身子树）：

| 命令类 | 自身子树 | 相对联合图节省 | 折算（0.2–0.3ms/模块） |
|---|---|---|---|
| version/help | 2 | 91 | ~18–27ms |
| pref list | 9 | 84 | ~17–25ms |
| inspect | 42 | 51 | ~10–15ms |
| answer | 89 | 4 | ~1ms |
| resume | 90 | 3 | ~1ms |
| 普通 run | 90 | 3 | ~1ms |

节省全部集中在 version/help（R5-I §7 已判"再砍无用户价值"）与 pref/inspect
（一次性交互诊断类——S1-I-5 的 ~10–12ms、S2-I-2 的 ~23ms 同带先例均判
亚感知淘汰）；真实工作流 run/resume/answer 的子树即联合图本体，拆分
净收益 ~1ms。代价面：runCommand/resumeCommand/answerCommand 共享
`createExecutor`/`flowchartContinuation`/`printFlowchartOutcome`/
`readValidatedCheckpoint` 等 ~10 个助手，拆分需把 1498 行 `main.ts` 重构为
多模块并保持全部错误面逐字节（`deleteCommand` 还是公开导出）。价值错位 +
高风险，淘汰。

### 4.3 零候选区（不硬凑）

`pi-adapter/`、`config/`、`telemetry/` 三区自 R1-I 以来字节未变，前五轮
收口（执行期网络支配、凭据面禁区、解析校验=契约本体、`invocationError`
在-slice 常数下界）全部继承有效；本轮常驻图审计对这三区也未产生新形态
（它们的模块全部被 ≥2 常驻分支或懒子树正确持有）。遵 PLAN"不要硬凑"，
零新立案。

## 5. 逐文件收口（第六遍新检查点）

- `cli/main.ts`：S6-I-1 裁决区（原型已回滚）；S6-I-3 拆分裁决区；
  `import { type PublicPriorSnapshot }` 空边随 S6-I-1 一并记录（单独改
  `import type` 虽零风险但加载集不变——public-prior 被 assign-plan/
  public-prior-store 持有，属无收益改动，不单独立案）。前五轮全部检查点
  （S1-I 落地物、S2-I-1/4、S3-I-3/4、S4-I-2/3/4、S5-I-1 落地物）复核原样。
- `cli/adapt.ts`…`cli/doctor.ts` 等 8 个懒 handler 与 `cli/pause.ts`/
  `inject.ts`/`errors.ts`/`flowchart-io.ts`/`model-catalog.ts`：字节未变，
  前五轮收口维持；常驻图审计确认其懒边完好。
- `pi-adapter/*`：字节未变。S4-I 落地物（auth-session 两函数体动态边）
  复核原样；凭据面零触碰。
- `config/*`、`telemetry/model-invocation.ts`：字节未变，R1-I 下界 /
  R3-I 收口维持，零候选。

## 6. 前后对比

零代码改动。基线（S5-I-1 落地态）即本轮终态：非 run 命令 93+15=108 模块
加载维持（其中 15 模块为 run/pref 分支独占死重，量化为 2.2–4.6ms/调用，
低于落地线立此存照）；run 族启动图为其必需集的判断经逐边独占增量计算
从外推升级为实证。

## 7. 测试与验证

```bash
pnpm typecheck   # ✓ 绿
pnpm lint        # ✓ 绿（无继承 console.* 需要处理）
pnpm build       # ✓ 绿
npx tsx scripts/round04-r4i-equivalence-sim.ts   # ✓ 68 checks, 0 failures
npx tsx scripts/round05-r5i-equivalence-sim.ts   # ✓ 119 checks, 0 failures
npx tsx --test test/unit/{cli,pi-adapter,config,telemetry}/*.test.ts
# tests 66 / pass 65 / fail 1 —— 唯一失败为既有环境问题：VM Node 22.14 <
# engines >=22.19，doctor 单测断言 node 版本检查行（R5-I 已记载；基线同样
# 失败；未改测试）
npx tsx --test test/integration/{cli,pi-adapter}/*.test.ts
# tests 59 / pass 58 / fail 0 / skipped 1（既有 skip）
```

S6-I-1 原型期的等价电池（53 检查 × 2 次 0 失败）与双轮基准在原型回滚前
完成；回滚后重建 dist 并复跑上述套件确认终态与基线一致。

## 8. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 | 重开条件 |
|---|---|---|---|
| S6-I-1 | 常驻图分支独占残余 7 边点用处化（`learning/auto-loop`+`routing/assign`+`graph/compile-children`+`routing/public-prior-store`+`run/coordinator`+`preferences/materialize` 值边 + `routing/public-prior` 类型空边；释放 15 模块，108→93） | 等价（53 检查 ×2）且方向稳定，但非 run 类仅 -2.2~-4.6ms/调用（≈0.2–0.3ms/模块，无解析器病态红利），children/track 中性——低于落地线一个量级（S5-H-2/S5-E-5 同带） | 单模块加载成本或 Node 解析病态回升使该组实测 ≥ 两位数 ms；或落地线降档 |
| S6-I-2 | CLI 进程内 `module.enableCompileCache()` 启用 V8 编译缓存 | 结构性无效：ESM 整图在入口求值前已编译，切片内任何调用点覆盖不到静态图；全覆盖需 bin bootstrap（package.json + dist 布局，切片外，S5-I-5 邻域）；`NODE_COMPILE_CACHE` 全覆盖上界实测仅 -8.0~-8.2ms | bin/构建面解冻且落地线容纳 <10ms 档；或图规模增长一个量级 |
| S6-I-3 | `main.ts` 全量按命令拆分 handler 模块（per-command split） | 收益集中于亚感知一次性类（version/help -91 模块 ≈18–27ms 已判无用户价值；pref-list -84 ≈17–25ms、inspect -51 ≈10–15ms 为 S1-I-5/S2-I-2 同带）；run 族仅 -3~-4 模块 ≈1ms；1498 行重构 + 共享助手错误面风险 | 交互/诊断类获得明确延迟预算且其档位收紧一个量级；或 run 族出现大规模类不对称子树 |

## 9. MORE_OPTIMA 判定

**no。** 依据：(a) 执行期热路径 R2-I/R3-I 已收口至逐行下界，本轮复核无
漂移；(b) 启动图经 S4-I + S5-I-1 两刀后，本轮以逐边独占增量计算穷尽了
最后的结构性余量——分支独占残余恰 15 模块，实测天花板 2.2–4.6ms（无病态
红利，线性区），已立 S6-I-1 关死；剩余 93 模块每一个都被 ≥2 条常驻分支
真实持有（本轮实证，非外推）；(c) 越过落地线的仅存路径（编译缓存全覆盖
-8ms、按命令拆分的交互类 -10~-27ms）分别需要切片外构建面手段或把价值
押在已判亚感知/无用户价值的命令类上。翻盘变量与 R5-I 相同：Node 升级
改变解析器行为（S5-I-5 重开条件），属重测触发器而非本切片剩余工作。

## 附录 A：常驻图逐边独占增量分析脚本（临时，未提交；无赢家不入库）

```js
// r6i-graph.mjs — dist 静态图（行首 import/export ... from 为边，
// await import() 不计）；BFS 自 cli/main.js；对 main 每条直接边计算
// 移除后不可达集（独占增量），并对候选组做联合移除。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";

const DIST = "/workspace/dist";
const ROOT = join(DIST, "cli/main.js");
function listJs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listJs(p));
    else if (name.endsWith(".js")) out.push(p);
  }
  return out;
}
const IMPORT_RE = /^(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/gms;
const BARE_IMPORT_RE = /^import\s*["']([^"']+)["']/gm;
function staticDeps(file) {
  const src = readFileSync(file, "utf8");
  const deps = new Set();
  for (const re of [IMPORT_RE, BARE_IMPORT_RE]) {
    re.lastIndex = 0;
    for (const m of src.matchAll(re)) if (m[1].startsWith(".")) deps.add(resolve(dirname(file), m[1]));
  }
  return [...deps];
}
const graph = new Map();
for (const f of listJs(DIST)) graph.set(f, staticDeps(f));
function reachable(from, skipEdges) {
  const seen = new Set();
  const stack = [from];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const dep of graph.get(cur) ?? []) {
      if (skipEdges.has(`${cur}=>${dep}`)) continue;
      if (!seen.has(dep)) stack.push(dep);
    }
  }
  return seen;
}
const base = reachable(ROOT, new Set());
console.log(`resident graph: ${base.size} modules`);
for (const dep of graph.get(ROOT) ?? []) {
  const without = reachable(ROOT, new Set([`${ROOT}=>${dep}`]));
  const removed = [...base].filter((m) => !without.has(m));
  console.log(`${relative(DIST, dep)}  exclusive=${removed.length}`);
}
const CANDIDATES = [
  "learning/auto-loop.js", "routing/assign.js", "graph/compile-children.js",
  "routing/public-prior-store.js", "routing/public-prior.js",
  "run/coordinator.js", "preferences/materialize.js"
].map((p) => join(DIST, p));
const skip = new Set(CANDIDATES.map((c) => `${ROOT}=>${c}`));
const without = reachable(ROOT, skip);
console.log(`combined removal: ${base.size} -> ${without.size}`);
for (const m of [...base].filter((x) => !without.has(x)).map((x) => relative(DIST, x)).sort()) console.log(`  - ${m}`);
```

关键输出（base dist）：`resident graph: 108 modules`；
`learning/auto-loop.js exclusive=8`、`routing/assign.js exclusive=2`、
`run/flowchart-run.js exclusive=2`（≥2 分支，不动）、coordinator/
materialize/public-prior-store 各 exclusive=1、learned-routing/
live-cascade/primary-catalog/cost-calibration/compile-children/episode-store/
model-router 均 exclusive=0（被常驻共享模块持有）；
`combined removal: 108 -> 93`（释放集见 §1）。

## 附录 B：同窗交错基准 harness（临时，未提交；完整可复现）

```js
// r6i-bench.mjs — base/cand 两 dist 树逐次轮换起序；有状态场景每调用
// 全新 state root（configured 预写 providers.json）；inspect 用一次性
// 预生成 run 快照只读复用；剔除 NODE_COMPILE_CACHE/NODE_OPTIONS。
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const WS = "/workspace";
const VARIANTS = [
  ["base", join(WS, ".r6i-bench/dist-base/cli/main.js")],
  ["cand", join(WS, ".r6i-bench/dist-cand/cli/main.js")]
];
const FIX = "/tmp/r6i-fix";
rmSync(FIX, { recursive: true, force: true });
mkdirSync(join(FIX, "project"), { recursive: true });
writeFileSync(join(FIX, "project", "package.json"), JSON.stringify({ name: "bench-project", version: "1.0.0" }));
writeFileSync(join(FIX, "children.json"), JSON.stringify({ tasks: [
  { id: "tsk_bench_a", role: "implementer", objective: "Implement feature A for benchmark" },
  { id: "tsk_bench_b", role: "tester", objective: "Test feature A for benchmark" }
] }));
const PROVIDERS = { version: 1, enabled: [], customProviders: [{
  id: "acme", baseUrl: "https://acme.example/v1", models: [
    { id: "acme-large", contextWindow: 200000, maxTokens: 8192, inputCostPerMTok: 3, outputCostPerMTok: 15, reasoning: true },
    { id: "acme-small", contextWindow: 100000, maxTokens: 8192, inputCostPerMTok: 0.3, outputCostPerMTok: 1.5 }
  ] }] };
const env = { ...process.env };
delete env.NODE_COMPILE_CACHE;
delete env.NODE_OPTIONS;
let stateCounter = 0;
function freshStateRoot(withProviders) {
  const root = join(FIX, `state-${stateCounter++}`);
  if (withProviders) {
    mkdirSync(join(root, "runtime"), { recursive: true });
    writeFileSync(join(root, "runtime", "providers.json"), JSON.stringify(PROVIDERS, null, 2) + "\n");
  } else mkdirSync(root, { recursive: true });
  return root;
}
const INSPECT_ROOT = join(FIX, "inspect-root");
mkdirSync(join(INSPECT_ROOT, "runtime"), { recursive: true });
writeFileSync(join(INSPECT_ROOT, "runtime", "providers.json"), JSON.stringify(PROVIDERS, null, 2) + "\n");
spawnSync(process.execPath, [VARIANTS[0][1], "run", "--project", join(FIX, "project"), "--objective", "Seed run for inspect bench", "--children", join(FIX, "children.json"), "--state-root", INSPECT_ROOT], { env });
const RUN_ID = readdirSync(join(INSPECT_ROOT, "runtime", "runs")).sort()[0];
const PREF_ROOT = join(FIX, "pref-root");
mkdirSync(PREF_ROOT, { recursive: true });
const SCENARIOS = [
  { name: "version", reps: 60, kind: "stateless", args: () => ["--version"] },
  { name: "pref-list", reps: 40, kind: "stateless", args: () => ["pref", "list", "--state-root", PREF_ROOT] },
  { name: "inspect-run", reps: 40, kind: "stateless", args: () => ["inspect", "--run", RUN_ID, "--state-root", INSPECT_ROOT] },
  { name: "plain-config", reps: 40, kind: "stateful", providers: true,
    args: (sr) => ["run", "--project", join(FIX, "project"), "--objective", "Build feature A", "--state-root", sr] },
  { name: "children-config", reps: 40, kind: "stateful", providers: true,
    args: (sr) => ["run", "--project", join(FIX, "project"), "--objective", "Build feature A", "--children", join(FIX, "children.json"), "--state-root", sr] },
  { name: "track-config", reps: 40, kind: "stateful", providers: true,
    args: (sr) => ["run", "--project", join(FIX, "project"), "--objective", "Build feature A", "--track", "--assume-defaults", "--executor", "fake", "--state-root", sr] }
];
function q(sorted, p) {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
const results = {};
for (const sc of SCENARIOS) {
  results[sc.name] = Object.fromEntries(VARIANTS.map(([v]) => [v, []]));
  for (let rep = 0; rep < sc.reps; rep++) {
    for (const [vname, entry] of [0, 1].map((i) => VARIANTS[(i + rep) % 2])) {
      const sr = sc.kind === "stateless" ? null : freshStateRoot(sc.providers);
      const t0 = performance.now();
      const r = spawnSync(process.execPath, [entry, ...sc.args(sr)], { env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
      const dt = performance.now() - t0;
      if (r.status === 0) results[sc.name][vname].push(dt);
      if (sr !== null) rmSync(sr, { recursive: true, force: true });
    }
  }
}
for (const [name, byVariant] of Object.entries(results)) {
  console.log(`\n== ${name} ==`);
  const med = {};
  for (const [vname, arr] of Object.entries(byVariant)) {
    const s = [...arr].sort((a, b) => a - b);
    med[vname] = q(s, 0.5);
    console.log(`${vname} n=${s.length} min=${s[0].toFixed(1)} p25=${q(s, 0.25).toFixed(1)} med=${q(s, 0.5).toFixed(1)} p75=${q(s, 0.75).toFixed(1)} max=${s[s.length - 1].toFixed(1)}`);
  }
  console.log(`delta med (base-cand) = ${(med.base - med.cand).toFixed(1)}ms`);
}
```

配套的输出等价电池（53 检查，R4-I 矩阵样式：raw/归一化逐字节 + 同快照
双端 inspect 含 `--json`）、`NODE_COMPILE_CACHE` 上界基准与逐类可达集
计算脚本均为一次性 /tmp 脚本，关键数值已全部录入 §3/§4；`.r6i-bench/`
dist 树为基准期临时产物，未提交。

MORE_OPTIMA=no
BRANCH=cursor/r6-i-cli-sixth-pass-83a1
