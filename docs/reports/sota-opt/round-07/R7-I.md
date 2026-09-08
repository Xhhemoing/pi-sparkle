MODEL_SLUG=claude-fable-5-thinking-xhigh

# R7-I：CLI / Pi 适配器 / 配置 / 遥测切片第七遍复查报告

**战役:** 全库持久 SOTA 优化 Round 7 / R7-I
**基线:** `cursor/sota-persistent-opt-83a1` @ `aa05347`（含 S7-A/B/D/E/G/H 排除全表）
**分支:** `cursor/r7-i-cli-seventh-pass-83a1`（落地提交 `8dee7fb`）
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**落地 1 个赢家（S7-I-1），其余 3 个第七组新候选全部淘汰立排除（S7-I-2…S7-I-4）。**

R6-I 宣告惰性 import 残差、编译缓存、按命令拆分三个角度关闭后，第七遍在
指令点名的「从未检视过的角度」里找到了一条**从未被测量过的边**：
`pi-adapter/listed-model.ts` 模块顶静态导入
`@earendil-works/pi-ai/providers/all`——约 40 个 provider 模块连同各自的
auth/API 机器，本 VM 冷载中位 **~58ms**（5 次：48.1/56.2/58.2/59.4/62.8ms）。
`cli/model-catalog.ts` 的 `buildLiveCatalogConfig`（`run --children` 经
`smartChildPlan`、`run --track` 经 `track/loop.ts`、`run --flowchart` 与
校准 router 共用的目录构建）在 `enabled.length > 0` 时点用处动态导入
`listed-model.js`——于是**每个配置了 builtin 模型的用户，每次 run 都为这
~50-60ms 付费，即使 `--executor fake`**。

这条边六轮全部漏检的原因可考：R4-I §1 的静态边枚举把它误记为
「`listed-model.ts` 对 pi-ai 仅 type-only import + 点用处动态 import」——
实际上 `providers/all` 自文件创建起就是模块顶**值导入**（git 史核实），
type-only 的只有第二行的 `Api`/`Model`；而 R1-I 的目录构建基准全程使用
**自定义 provider 夹具**（hermetic，从不触发 builtin 表加载），测得的
`resolveListedModel×enabled ≈ µs 级`只覆盖了 miss 路径。两轮的测量交叉
恰好把 configured-builtin 用户的主路径留在了盲区。

S7-I-1 的落地：新增异步孪生 `pi-adapter/listed-model-lazy.ts`
`resolveListedModelLazy`——builtin 命中只导入被查询 provider 的**生成模型
数据表**（`@earendil-works/pi-ai/providers/<id>.models`，包 exports map 的
公开子路径、纯数据模块，单个冷载 ~6ms、两个共 7.5ms）；任何 per-provider
miss（未知/自定义 provider、未来 pi-ai 布局变更）回退到权威的
`providers/all.getBuiltinModel`；`providers/all` 本身加载失败则**在 catch 外**
原样上抛（对齐旧静态边的失败面）。`listed-model.ts` 公开同步面逐字节等价
保留（共享 helper 下沉到叶模块 `listed-model-common.ts`）。

同窗交错基准（N=15，spawn-to-exit 中位）：**配置态 `run --children`
158ms → 109ms（−49ms，−31%），配置态 `run --track` 174ms → 126ms
（−48ms，−28%）**，两个分布不重叠；对照组持平（未配置 children
104→103ms、`--version` 55→54ms）。等价性由提交的确定性仿真
`scripts/round07-r7i-equivalence-sim.ts` 裁决：39 个 builtin provider ×
全部 1220 行模型逐条 lazy===sync、17 个 miss/自定义/对抗 provider-id 用例、
结构边检查、spawn 加载迹探针（builtin 构建后 providers/all 仍冷 65-69ms /
自定义回退后 0.3ms 缓存命中）、配置态 CLI 电池——**80 检查 × 两次独立运行
0 失败**。r4i（68）、r5i（119）仿真复跑通过。

未重开任何 X* / S1-* / S2-* / S3-* / S4-* / S5-* / S6-* / S7-A/B/D/E/G/H-*
条目（与既有条目的边界证明见 §0 与 §2.3）。

## 0. 范围与约束遵守

- 切片：`src/cli/`（12 文件）、`src/pi-adapter/`（6→8 文件）、
  `src/config/`（2 文件）、`src/telemetry/`（1 文件）全量第七遍实际读码。
  上下游 `routing/cost-calibration.ts`、`track/loop.ts`、
  `preferences/{service,store}.ts`、pi-ai 包内 `providers/all.js` /
  `models.generated.js` / `*.models.js` / `model-catalog.js` 只读取证，
  一行未改。生产 diff 仅 4 个切片内文件 + 1 个 scripts 仿真。
- 先读并遵守（顺序按指令）：README / EXCLUSIONS.md 全表（含 S4-I/S5-I-1
  落地注记与新并入的 S7-A/B/D/E/G/H 行）/ round-07/PLAN.md /
  round-01/R1-I.md … round-06/R6-I.md。
- 与既有条目的边界（重开检查逐条核对）：
  - **非 S4-I 重做**：S4-I 惰性化的是 `runtime.js` 的 Pi 运行时子树
    （pi-ai 根 + agent-core，`--executor pi` 与 auth 函数体）；本项处理的
    是 `listed-model.js → providers/all` 这条**目录数据边**，S4-I 报告
    明文将其误记为已惰性，未测量、未改动。
  - **非 S6-I-1 重开**：S6-I-1 关闭的是 `main.ts` 常驻静态图内 7 条仓内
    独占边（−2.2~−4.6ms）；本边不在 `main.ts` 静态图内——它藏在既有
    条件动态 import 背后，只对 configured 用户触发，R6-I 的常驻图普查
    天然不含它。
  - **非 S4-I-5 / S1-I-8 重开**：那两条是 `resolveListedModel` 函数体内
    µs 级控制流/对象构造；本项不改该函数一字节。
  - **非 X1-1 / S1-G-1 缓存族**：不引入任何自建缓存/状态——per-provider
    表与 `providers/all` 的去重均由引擎 ESM 模块缓存承担（S4-I 同一依赖）。
- 硬不变量全部满足：分析不改 in-flight run；Tracking 无命令权；双 LCB 与
  双归因保留；晋升 proposal-first；阈值零改动；测试零改动（1 个既有环境
  失败与基线一致，见 §5）；CAS/凭据/数据面契约不变（providers.json schema
  未动、凭据面 `auth-session`/`file-credential-store` 未动）；公开签名不变
  （`listed-model.ts` 全部导出名与签名逐字保留，`index.ts` 未动，新增模块
  只加新导出）；错误选择契约不变（§2.3）。不声称 Outcome-supported，
  Checkpoint F-PROD 仍开放（ADR-005）。

## 1. 第七遍搜索：从「切片剩余 I/O」到未测量的目录数据边

按指令先在本 VM 重建测量基底（未沿用 R6-I 数字）：

1. **全切片同步 I/O 普查**：`readFileSync/writeFileSync/existsSync/
   spawnSync/...` 在切片内只存在于一次性命令（doctor、commits、
   `--version` 的 package.json 读取）——按战役规则整类不达标。
2. **run 路径逐步 orchestration 重走**（plain / --children / --track /
   --flowchart 四分支）：providers.json / learned routing / public prior
   等配置读取均为几十 µs 级（R1-I/S4-J-2 量级复核成立）；
   `invocations.jsonl` 全量读取是唯一线性规模项，但读取方
   `routing/cost-calibration.ts` 在切片外、切片内验证器已被 S3-I 钉死、
   dedup 已由 S1-I 落地、任何 tail/缓存方案落 X1-1/S1-G-1 族 + 校准语义
   变更——闭合。
3. **未配置态 children run 剖面**（--cpu-prof，~103ms）：切片内自身
   self-time ≈ 1 个采样；成本全在切片外（tracking/persist/run/supervisor）
   与模块图（S6-I 已关闭）。
4. **配置态对照**：为复现真实用户态（`models set-default` 后），以 2 个
   enabled builtin 模型（anthropic+openai）重测同一命令：**+45~55ms**
   （147-166ms vs 102-107ms）。配置态剖面归因：node-internals self-time
   63.7ms + `getPackageScopeConfig` **17.9ms**（Node v22.14 解析病态在
   pi-ai 子树上的份额，属指令要求的「新证据」）+ pi-ai 模块 JS 自身仅
   ~1.1ms——差额是**模块解析/编译**，不是数据展平。
5. **归因验证**：`@earendil-works/pi-ai/providers/all` 单独冷载
   48.1-62.8ms（中位 58.2）；`models.generated.js`（39 provider 纯数据）
   单独 20.8ms；单个 `<p>.models` 6.0-6.4ms、两个共 7.5ms。即 ~2/3 成本
   来自 40 个 provider 模块的 auth/API 机器，而目录构建只需要
   `getBuiltinModel` 的纯数据读。

## 2. 落地项 S7-I-1：目录构建按 provider 惰性加载 builtin 模型表

### 2.1 机制

pi-ai 的生成目录满足两个可验证不变量（`models.generated.js` 由
`scripts/generate-models.ts` 从各 `providers/<id>.models.js` 直接聚合）：

- `MODELS[provider]` 与 `providers/<id>.models.js` 的唯一 `*_MODELS` 导出
  **引用恒等**（仿真 part B 对 39 provider × 1220 行逐条断言）；
- `./providers/*` 是包 exports map 的公开子路径，`*.models.js` 是纯数据
  模块（JSON import + 纯函数 `flattenModelCatalog`），无副作用。

`resolveListedModelLazy(providerId, modelId, customProviders)`：

1. `await import("@earendil-works/pi-ai/providers/" + providerId + ".models")`，
   要求恰好一个 `*_MODELS` 导出，命中则表读 `table[modelId]`；
2. 任何 per-provider 失败（模块不存在＝未知/自定义 provider、导出形状
   不符＝未来布局变更）→ **catch 内回退** `providers/all.getBuiltinModel`
   （权威源，成本＝旧行为）；
3. `providers/all` 本身加载失败 → **catch 外上抛**（对齐旧静态边）；
4. 其后与 `resolveListedModel` 完全同构：`fromPiModel` 抛错吞为
   undefined → 自定义 provider 查找。

`model-catalog.ts` 的 enabled 循环改为逐 id `await` 该孪生（顺序保留，
不引入 Promise.all——S2-J-10/S4-J-2/S7-G-5 族边界）。specifier 注入面：
`providerId` 经 `parseModelRef` 保证不含 `/`，模板只能落在
`providers/*.models` 模式内；对抗用例（`all`、`..`、`.`、空串、
`__proto__`+`constructor`、`anthropic.models`）由仿真 part C 逐一断言与
同步实现等价且不抛。

### 2.2 规模收益（同窗交错，spawn-to-exit 中位，N=15）

| 命令类 | 旧（中位/min/max） | 新（中位/min/max） | Δ中位 |
|---|---|---|---|
| `run --children`（配置态） | 158 / 145 / 166ms | **109** / 105 / 125ms | **−49ms（−31%）** |
| `run --track --assume-defaults`（配置态） | 174 / 164 / 185ms | **126** / 121 / 129ms | **−48ms（−28%）** |
| `run --children`（未配置，对照） | 104 / 101 / 118ms | 103 / 100 / 106ms | ±0（噪声内） |
| `--version`（对照） | 55 / 53 / 59ms | 54 / 53 / 56ms | ±0（噪声内） |

两个受益类分布不重叠（新 max 125/129 < 旧 min 145/164）。
`run --flowchart` 与校准 router 共用同一 `buildLiveCatalogConfig`，机制
同覆盖。`--executor pi` 路径 `runtime.js` 本就加载完整 pi-ai——per-provider
表是其模块缓存子集，成本恒等。自定义-provider-only 用户走回退，成本＝
旧行为（仿真 part D 断言回退确实加载了 `providers/all`）。

### 2.3 等价裁决

- **结果面**：39 provider × 1220 builtin 行 lazy===sync 逐条深等价 +
  表项引用恒等（part B）；17 个 miss/自定义/遮蔽/对抗用例等价（part C）；
  配置态 children run 归一化输出跨轮逐字节一致（part E）；A/B 双 dist
  的 id-归一化输出 diff 为空（§5 冒烟）。
- **错误选择面**：`unknown model "<id>"` 仍按 enabled 顺序在同一循环内
  抛出；包损坏场景旧行为在 `await import("listed-model.js")` 处抛
  ERR_MODULE_NOT_FOUND(providers/all)，新行为在首个
  `resolveListedModelLazy` 的回退 import 处抛**同一模块 URL 的同类错误**
  （S4-I 已确立「错误位点随点用处移动」的先例），二者均先于任何部分
  目录被消费。
- **公开面**：`listed-model.ts` 的 5 个导出（`describeSparkleModel` /
  `listSparkleModels` / `listSparkleProviders` / `resolveListedModel` /
  `listedModelsFromCustom`）与 `SparkleListedModel` 类型签名逐字保留，
  单测/集成测/r4i 仿真零改动通过；`index.ts` 未动。
- **守卫**：pi-ai 升级若移除 per-provider 模块或改变导出形状，运行时
  回退保证正确性（性能回到旧成本），仿真 part B/D 复跑会显式暴露。

## 3. 候选三条件裁决总表

| ID | 候选 | 理论 | 仿真/测量 | 裁决 |
|---|---|---|---|---|
| **S7-I-1** | 目录构建按 provider 惰性加载 builtin 模型表（providers/all → `<id>.models`） | 目录只需纯数据读；~2/3 冷载成本是无关的 auth/API 机器 | 80 检查 ×2 独立运行 0 失败；A/B −49/−48ms 中位，对照持平 | **落地** |
| S7-I-2 | run 路径 preferences.json 同步水合迁移/惰性化 | 每 run 一次 readFileSync+rebuildViews | 实测 10/100/1000 观测 = 0.24/0.22/1.07ms；store 在切片外，切片内只能动调用点且会改持久化语义 | 淘汰：量级 + 切片外 |
| S7-I-3 | run 路径配置读取 Promise.all 并行（providers/learned/prior） | 隐藏 I/O 等待 | 各读取几十 µs（R1-I 量级本 VM 复核）；双故障竞态改错误选择 | 淘汰：S2-J-10/S4-J-2/S7-G-5 族 |
| S7-I-4 | per-provider 表推广到一次性命令（models enable/set-default、auth） | 同 S7-I-1 机制 | 受益类是一次性 CLI（models/auth），战役规则整类不计 | 淘汰：一次性命令类 |

## 4. 其余候选裁决细节

### 4.1 S7-I-2：preferences.json 每 run 同步水合

`runCommand` 每次执行 `bindPreferenceStore` →
`configurePreferencePersistence`（切片外 `preferences/store.ts`）：
`existsSync + readFileSync + JSON.parse + rebuildViews`。实测水合成本
10/100/1000 观测分别 0.24/0.22/1.07ms——真实偏好规模（十级）下亚 ms。
切片内唯一可动的是调用点位置，而推迟/条件化绑定会改变 run 期间
`recordPreference` 的持久化行为（数据面契约）。淘汰。

### 4.2 S7-I-3：run 路径配置读取并行化

`loadProvidersConfig` → `createExecutor` → `loadOptionalPublicPrior` →
`loadLearnedRouting` 串行 await 链上每项都是几十 µs 的小 JSON 读；
Promise.all 化收益 µs 级且引入双故障错误选择竞态——与 S2-J-10 /
S4-J-2 / S7-G-5 同族同裁决。淘汰，不立独立仿真。

### 4.3 S7-I-4：机制推广到一次性命令

`models enable/set-default`（`models.ts` L160 的 `resolveListedModel`）与
`auth` 面（`listSparkleProviders` 需全表，本就无法按 provider 拆）仍走
`listed-model.js` 静态边。这些是一次性交互命令，战役规则明文整类不计；
且 auth 属凭据面（S1-I-5 已有先例）。维持原样，淘汰。

### 4.4 零候选区（不硬凑）

`invocations.jsonl` 读取方在切片外且语义/缓存双墙（§1.2）；`onInvocation`
追加是 fire-and-forget 不在延迟路径；`inspectRun` 复读、双
`createAgentProfileRegistry`、flowchart 双 `buildLiveCatalogConfig`
（S1-I-1，~190µs）均维持既有裁决；telemetry 验证器（S3-I）零新候选。

## 5. 测试与验证

```text
pnpm typecheck  # 干净
pnpm lint       # 干净
pnpm build      # 干净
pnpm test       # tests 1169 / pass 1167 / fail 1 / skipped 1
# 唯一失败为既有环境问题：VM Node 22.14 < engines >=22.19，doctor 单测
# 断言 node 版本检查行（R5-I/R6-I 已记载；git stash 后基线同样失败；
# 未改测试）
npx tsx scripts/round07-r7i-equivalence-sim.ts   # 80 检查 0 失败 ×2
npx tsx scripts/round04-r4i-equivalence-sim.ts   # 68 检查 0 失败
npx tsx scripts/round05-r5i-equivalence-sim.ts   # 119 检查 0 失败
```

冒烟：`--version`（0.1.0）、配置态 `models list` / `models list
--available` / `auth status` 输出正常；A/B 双 dist 配置态 children run
id-归一化输出 diff 为空。`main.ts` 本轮零改动。

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 内容 | 理由（重开条件） |
|---|---|---|
| S7-I-1 | **落地**：目录构建按 provider 惰性加载 builtin 模型表（`listed-model-lazy.ts` + `model-catalog.ts` 点用处；`providers/all` 仍为回退权威源） | 已落地；pi-ai 升级改变生成布局时复跑 round07 仿真 part B/D |
| S7-I-2 | run 路径 preferences.json 同步水合优化 | 0.22-1.07ms@≤1000 观测 + store 切片外；重开：偏好规模达万级或 store 进切片 |
| S7-I-3 | run 路径配置读取 Promise.all 并行 | µs 级 + 双故障竞态族（S2-J-10/S4-J-2/S7-G-5）；重开：单项配置读达 10ms+ |
| S7-I-4 | per-provider 表推广到 models/auth 一次性命令 | 一次性 CLI 类 + 凭据面；重开：落地线放宽到一次性命令 |

## 7. MORE_OPTIMA 判定

**MORE_OPTIMA=yes**——本轮证明「已关闭」的结论可能建立在测量盲区上
（R4-I 的边枚举笔误 + R1-I 的夹具选择恰好互补遮蔽了一条 ~50ms 的主路径
边六轮）。同类盲区值得下一遍以「配置态 × 命令类」矩阵而非「默认态」
重测全部切片；此外配置态 run 剖面中仍有 node-internals ~64ms 的模块图
份额属 S6-I 已关闭角度、`getPackageScopeConfig` ~18ms 属 Node 版本项，
若 VM Node 升级到 22.19+ 应复测锚点。

## 附录：等价仿真

赢家落地，仿真已按战役规则提交：`scripts/round07-r7i-equivalence-sim.ts`
（seeded mulberry32 0x77a701；part A 结构边 / part B 39×1220 行穷举等价 +
引用恒等 / part C 17 对抗用例 / part D spawn 加载迹探针（builtin 构建后
providers/all 仍冷 65.0-68.8ms、自定义回退后 0.3ms 缓存命中）/ part E
配置态 CLI 电池）。同窗 A/B harness 为临时脚本未提交（构造：双 dist 快照
+ 逐次轮换 4 命令类 × N=15，数据全文见 §2.2）。
