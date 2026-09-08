MODEL_SLUG=claude-fable-5-thinking-xhigh

# R8-I：CLI / Pi adapter / config / telemetry 第八遍复查报告（S1-I + S4-I + S5-I-1 + S7-I-1 之上）

- 基线：`cursor/sota-persistent-opt-83a1` @ `da2f351`（含 S8-A-1..3 / S8-B-1..4 / S8-C-1..4 / S8-D-1..5 / S8-E-1..3 / S8-F-1..3 排除；切片最后一次改动即 S7-I-1 落地提交 `8dee7fb`，`git diff 8dee7fb..HEAD -- src/cli src/pi-adapter src/config src/telemetry` 为空——**零漂移**。全仓 src/ 自该提交后仅 `src/experiments/shadow.ts` 与 `src/routing/offline-logit.ts` 变动，均切片外且属已落地的 S7-C/S8 系）
- 切片：`src/cli/`（16 文件）、`src/pi-adapter/`（9 文件）、`src/config/`（2 文件）、`src/telemetry/`（1 文件），全量实际读码；工作在 S1-I / S4-I / S5-I-1 / S7-I-1 之上
- 前置阅读：README、EXCLUSIONS 全表（含 S8-A..F 全系）、round-08/PLAN、round-07/PLAN、round-01/R1-I ～ round-07/R7-I（含 R7-I §7 MORE_OPTIMA 与测量盲区始末）
- 分支：`cursor/r8-i-cli-eighth-pass-83a1`（已推送，未开 PR）
- 环境：**双 Node 版本实测**——VM 默认 22.14.0（`/exec-daemon/node` shim 遮蔽 nvm，基准显式传二进制全路径）与 nvm 22.22.2（engines ≥22.19 合规）。R7-I §7 明令「VM Node 升级到 22.19+ 应复测锚点」，本轮以全矩阵双版本并测的方式执行。pnpm 10.x，`pnpm install --frozen-lockfile`，`pnpm build` 后对 `dist/cli/main.js` 测 spawn-to-exit。

## 结论

**无可落地的新更优解，本轮生产代码零改动。** R8-I 的使命是把 R7-I 揭示的测量盲区（六轮的「已关闭」结论建立在默认空配置夹具上）用**配置态 × 命令类矩阵**正面补测——本轮已完整执行：4 种配置态（空 / 纯 builtin / 纯 custom / 混合）× 9~10 命令类 × 2 Node 版本，共 **39 单元 × 2 = 78 格全部 exit 0**（每格 2 预热 + 12 测量、每次迭代全新拷贝 state-root，逐格中位数见 §1.2）。矩阵结论：

1. **S7-I-1 在配置态被证实按设计工作**：builtin 目录态的四个目录构建命令类（children/track/flowchart/resume）只比空配置贵 **+2.6~+3.9 ms**（per-provider 表的代价），S7-I-1 之前这里是 ~50 ms 的 `providers/all` 全图。
2. **矩阵中唯一剩余的数十 ms 结构**：custom / mixed 配置态在全部四个目录构建命令类上比 builtin 态贵 **+24.7~+53.8 ms**（22.14/22.22 双版本，§1.3）——这是 custom provider id 在 per-provider 导入失手后回退加载 `providers/all` 的成本（进程内冷载锚点 70.7 ms@22.14 / 34.7 ms@22.22）。将其消除的唯一形态（对已声明 custom id 跳过回退，S8-I-1）被硬不变量「providers/all 失手回退 + fail-closed throw-outside-catch 不动」明令封死，且有真实健全性反例（§2.1：未来 pi-ai 布局去掉 per-provider 表 + custom id 遮蔽 builtin id 时，裁决优先级会从 builtin 静默翻转为 custom——恰好发生在回退所守护的 fail-closed 场景里）；pi-ai 的 exports 图不存在可版本锁定的轻量 provider-id 子路径可作健全门（已核，仅 `./providers/*` 通配），import 错误码亦无法区分「custom id」与「未来布局变更」。**该候选按验收规则第 3 条（documented soundness counterexample）淘汰**，重开条件唯一：pi-ai 上游发布与模型表版本锁定的轻量 id 清单导出。
3. 其余全部 >10 ms 单元格逐一追溯到已排除行或切片外子树：`auth status --all`（+235~+158 ms，S1-I-5 凭据面围栏）、`models list --available`（+60/+29 ms，S7-I-4 一次性命令类）、track 子树（S5-I-1 已惰性化边、`track/loop.ts` 切片外）、run 协调器/事件存储（`src/run/` 切片外）。启动地板 ~54 ms 为 S5/S6 轮收割完毕的 main 静态图（S6-I-1..3 关闭）。
4. **Node 版本锚点复测**（R7-I §7 指令项）：22.22.2 恰好在加载 `providers/all` 的单元格上省 **27~36 ms**（models-avail 116→83、auth-all 297→212、custom-children 160→134），不触 `providers/all` 的地板格仅 −2~−4 ms——与 R7-I 记载的 `getPackageScopeConfig` 病理属 Node 版本项的判断逐格吻合。环境项，非代码角度。
5. **SPARKLE_AUTO_ADAPT 维度**：`runAutoAdaptLoop` 在 `main.ts` L53 是静态导入，kill switch 是纯运行期分支（`isAutoAdaptEnabled`，「=0 仍收集」契约）；实测 adapt0 vs 默认 108.0 vs 106.2 / 108.9 vs 105.1 ms，噪声带内——该环境变量不改变本切片导入图，无洞。

候选枚举（§2）：S8-I-1（custom 回退门）如上被健全性反例 + 不变量双重否决；S8-I-2（对 custom 态预热 providers/all import）被理论否决——模块实例化是主线程 CPU 工作、无可重叠的 I/O 窗口（且判断「将需要回退」本身依赖 config 读完成，预热窗口不存在）；S8-I-3（enabled 循环 Promise.all 化）为 µs 级 + 多未知 id 时错误选择分歧（哪个 id 的 DomainValidationError 先浮出），与 S7-I-3 / S2-J-10 同族同裁决。**矩阵显示本切片在现行排除表与硬不变量下不存在可达数十 ms 落地线的候选，切片关闭。**

不声称 Outcome-supported；Checkpoint F-PROD 仍开放（ADR-005）。双 LCB 与双归因未动；凭据/数据面契约未触碰；无阈值/测试/公开签名变更。仓库变更仅本报告一个文件；无赢家故未提交新 scripts 资产（矩阵 harness 全文进附录，遵守 R7-F/R8-C/R8-F 纪律）。

## 0. 范围与约束遵守

- 阅读顺序按令执行：README → EXCLUSIONS 全表 → round-08/PLAN → round-07/PLAN → R1-I..R7-I → 28 个切片源文件全量重读（未依赖历轮记忆）。
- 未重开任何 X* / S1-* ～ S7-* / S8-A-* ～ S8-F-* 条目。逐条对照：
  - **未重做 S1-I / S4-I / S5-I-1 / S7-I-1**：`--children` 的 smartChildPlan 目录复用、Pi runtime 点用处导入、12 个分支独占分派模块惰性导入、per-provider 惰性模型表全部原样在位（本轮矩阵即为其配置态验收）。
  - **S8-I-1 不是重开 S7-I-1**：S7-I-1 是「builtin 命中免加载 providers/all」，其落地明文保留 custom/未知 id 的 providers/all 回退作为等价性构造前提；S8-I-1 是把该回退对已声明 custom id 关门——正是 S7-I-1 约束条款（「providers/all 仍为回退权威源」）所禁止的形态。按新 ID 立项、按健全性反例 + 不变量淘汰，不触碰已落地行。
  - **未重开 S1-I-5**：`auth status --all` 的逐 provider `createPiRuntime`（`auth.ts` L85 → `auth-session.ts` L52-53）原样保留；本轮仅测量（只读、无凭据变异），293~312 ms 记录在案。
  - **未重开 S7-I-4**：`models list --available` 的 `listSparkleModels` 静态 `providers/all` 边保留（一次性命令类整类不计）；矩阵仅测量记录。
  - **未重开 S1-I-1**：flowchart 的双 `buildLiveCatalogConfig`（`main.ts` L569 + L583 内部）R7-I §4.4 已实测 ~190 µs 维持关闭——本轮识别到同一形态后直接对照排除表放弃立项。
  - **未重开 S7-I-2/S7-I-3**、S2-I-1/S3-I-3（错误路径 exit code 语义）、S6-I-1..3（剩余独占边惰性 / enableCompileCache / 分派拆分）、S5-I-2..5（dist/布局向 getPackageScopeConfig 开刀）、S3-I-1（invocations 验证器零收益）与 S2-I/S3-I 全系其余条目。
  - **veteran 态 invocations.jsonl 线性成本不是新洞**：R3-I 已在真实规模量化（`loadInvocationsFromStateRoot` 22.7-22.9 ms@10k 行、124.0-127.0 ms@50k 行），R7-I §1.2/§4.4 已以「读取方 `routing/cost-calibration.ts` 切片外 + 切片内验证器被 S3-I 钉死 + 语义/缓存双墙」关闭。本轮矩阵用 fresh state（0 行）测的是结构成本，规模项维持既有记载，不重复立项。
- 硬不变量（生产零 diff 下天然成立，仍逐条核对）：分析不变更在飞 run；tracking 无指挥权；H/score 不写 PASS/FAIL；Live=R0 等价；双 LCB / 双归因在位；提升 proposal-first；凭据/auth/数据面契约不动（`file-credential-store.ts` 逐字未读改）；`listed-model.ts` 同步公开面字节等价（本轮零改动，天然成立）；providers/all 失手回退 + throw-outside-catch 在位（`listed-model-lazy.ts` L34-37 逐字未动）；未改任何测试与阈值；CAS/公开签名不动。
- 漂移复核：`git diff 8dee7fb..HEAD -- src/cli src/pi-adapter src/config src/telemetry` 为空；四目录文件清单与 R7-I 记载一致，无新增文件。

## 1. 配置态 × 命令类矩阵（本轮强制交付，本 VM 实测）

### 1.1 矩阵构造

- **配置态**（fixture 全文见附录 harness）：`empty`（无 providers.json）；`builtin`（enabled=`anthropic/claude-fable-5`+`anthropic/claude-haiku-4-5`+`openai/gpt-4o`，primary/fast 已设——即 `models set-default` 后的状态）；`custom`（enabled=2 个 `customco/*` 模型，customProviders 声明 baseUrl/envVar，密封无网络）；`mixed`（1 builtin + 1 custom enabled）。
- **命令类**：`--version`（地板）；`models list`；`models list --available`；`auth status`；`auth status --all`（只读测量，无凭据变异）；`run`（plain，`--executor fake`）；`run --children`（2 任务谱：implementer + reviewer(dependsOn)）；`run --track --assume-defaults`；`run --flowchart`（单 actor 节点，`allowedModels:["cheap"]`——别名行在任何目录形态都存在，`--executor fake`→fake-children）；`resume`（对预埋的 WAITING_FOR_USER 审批门 flowchart run 重放，走 `main.ts` L1067 的 `createCalibratedCliModelRouter` 路径）。
- **纪律**：spawn-to-exit 墙钟（`spawnSync` + `performance.now()`），每格 2 预热 + 12 测量，**每次迭代 rm-rf 后从模板全新拷贝 state-root**（消除 runs/ 累积与 jsonl 追加的交叉污染）；resume 格的等待 run 在模板中一次性预埋（`Run <id>: WAITING_FOR_USER` 解析校验后各迭代继承拷贝）；环境剥离 `PI_PROVIDER/PI_MODEL/PI_API_KEY`；`--executor fake` 全程无网络。双 Node 版本以显式二进制全路径调用（`/exec-daemon/node` shim 会遮蔽 nvm 的 PATH 切换，历轮病理，本轮显式规避）。

### 1.2 矩阵实测（中位数 ms，括号内 min..p90；全 78 格 exit 0）

| 单元格 | v22.14.0 | v22.22.2 |
|---|---|---|
| version | 53.9 (52.7..55.1) | 51.4 (50.1..52.8) |
| models-list@empty | 55.5 (54.2..57.5) | 52.5 (51.6..54.4) |
| models-avail@empty | 118.9 (109.9..126.4) | 82.1 (80.6..84.2) |
| auth-status@empty | 59.1 (57.1..61.0) | 53.7 (51.8..56.0) |
| auth-status-all@empty | 312.2 (292.7..326.9) | 211.0 (207.4..215.6) |
| run-plain@empty | 72.1 (67.4..82.5) | 65.3 (63.9..67.9) |
| run-children@empty | 102.7 (99.2..108.7) | 102.7 (98.7..105.0) |
| run-track@empty | 125.1 (119.4..139.9) | 119.2 (117.4..122.1) |
| run-flowchart@empty | 78.6 (75.2..83.0) | 77.1 (74.3..78.9) |
| resume-waiting@empty | 69.0 (65.5..71.9) | 65.3 (63.4..67.6) |
| models-list@builtin | 55.7 (55.1..57.2) | 54.2 (53.5..55.9) |
| models-avail@builtin | 115.9 (107.4..120.1) | 83.4 (80.0..85.0) |
| auth-status@builtin | 58.2 (55.8..61.0) | 54.4 (52.2..56.5) |
| auth-status-all@builtin | 297.1 (283.7..316.2) | 212.3 (209.0..215.7) |
| run-plain@builtin | 67.2 (65.5..70.0) | 65.0 (62.9..66.6) |
| run-children@builtin | 106.2 (105.1..111.7) | 105.1 (102.9..110.4) |
| run-track@builtin | 128.1 (121.1..159.0) | 122.5 (120.4..125.1) |
| run-flowchart@builtin | 82.5 (80.3..83.6) | 82.4 (78.0..86.9) |
| resume-waiting@builtin | 71.6 (68.7..72.4) | 72.0 (68.9..74.7) |
| models-list@custom | 56.6 (55.4..57.5) | 55.1 (53.0..56.5) |
| models-avail@custom | 111.1 (104.6..117.8) | 84.6 (80.8..87.0) |
| auth-status@custom | 57.6 (55.9..60.1) | 54.1 (52.7..59.2) |
| auth-status-all@custom | 298.2 (281.9..307.7) | 214.6 (209.1..221.2) |
| run-plain@custom | 66.6 (64.3..68.0) | 66.4 (63.9..68.0) |
| run-children@custom | **160.0** (147.0..200.3) | **133.7** (131.5..138.2) |
| run-track@custom | **174.3** (164.6..178.0) | **151.7** (148.7..154.8) |
| run-flowchart@custom | **126.9** (116.0..133.9) | **112.0** (105.3..112.9) |
| resume-waiting@custom | **115.7** (108.0..123.7) | **96.7** (93.9..98.3) |
| models-list@mixed | 55.7 (54.4..56.6) | 53.6 (52.1..55.7) |
| models-avail@mixed | 115.6 (102.3..122.1) | 83.9 (81.7..85.3) |
| auth-status@mixed | 56.6 (55.5..58.4) | 54.5 (53.2..55.7) |
| auth-status-all@mixed | 293.4 (277.9..309.3) | 216.3 (211.7..219.8) |
| run-plain@mixed | 66.7 (65.2..67.5) | 66.7 (65.3..70.2) |
| run-children@mixed | **159.0** (149.4..164.2) | **132.8** (127.8..135.5) |
| run-track@mixed | **174.7** (172.0..181.9) | **151.7** (146.2..157.0) |
| run-flowchart@mixed | **127.0** (121.6..135.2) | **107.2** (103.2..108.0) |
| resume-waiting@mixed | **115.4** (105.5..120.4) | **95.2** (92.6..97.0) |
| run-children@builtin+SPARKLE_AUTO_ADAPT=0 | 108.0 (106.4..109.8) | 108.9 (105.9..110.5) |

进程内微锚点（本 VM）：`providers/all` 冷载 **70.7 ms**@22.14 / **34.7 ms**@22.22；per-provider 表冷载 anthropic.models 6.4 ms（22.14）/ 2.3 ms（22.22）、openai.models 1.8 ms；builtin 三表加载后 providers/all 仍需 55.4 ms（graph 共享有限——机制成本在 auth/API 机器而非模型数据，与 R7-I part D 锚点带 65.0-68.8 ms 同量级）。

### 1.3 矩阵读数

- **S7-I-1 配置态验收通过**：builtin−empty 差 children +3.5 / track +3.0 / flowchart +3.9 / resume +2.6 ms（22.14）——per-provider 表就是设计中的个位数 ms。`--executor fake` 全程在场，印证「S7-I-1 paid even under fake」的成本归属是目录构建而非执行器。
- **custom/mixed−builtin 差**（唯一剩余数十 ms 结构，双版本）：children **+53.8/+28.6**、track **+46.2/+29.2**、flowchart **+44.4/+29.6**、resume **+44.1/+24.7** ms。mixed ≈ custom（enabled 里只要有一个 custom id 就触发一次回退，全图进模块缓存后第二个不再付费）。归属唯一：`listed-model-lazy.ts` L36 的 `providers/all` 回退导入（§2.1）。
- **目录构建调用矩阵收口**（rg 全仓）：`createCalibratedCliModelRouter` / `buildLiveCatalogConfig` 共 7 个生产调用点——`main.ts` L357（smartChildPlan ← --children L710，S1-I 复用）、L569+L583（--flowchart）、L1067（resume）、L1189（answer）、`pause.ts` L65、`inject.ts` L84、`track/loop.ts` L82（--track，调用方切片外）。矩阵直接实测 children/track/flowchart/resume 四类；answer/pause/inject 与 resume 走完全同一机制（同函数同参数形态），由迹闭合，无需单测。
- **地板与非目录格**：version 53.9 为 S5/S6 收割后的 main 静态图地板；models-list/auth-status ≈ 地板 +1.6~+5 ms（providers.json 单读 / auth.json 单读，S7-I-2/S7-I-3 已证亚 ms 项）；run-plain ≈ 地板 +13~18 ms（协调器 + 事件存储在 `src/run/` 切片外，plain run 不构建目录——矩阵证实）；run-children@empty 与 run-track@empty 的溢价（+35.7/+22.4 ms）在 `src/run`/`src/supervisor`/`src/learning`/`src/track` 切片外子树。
- **排除行单元格**（仅测量记录，不重开）：models-avail−models-list = +60.4/+29.2 ms（S7-I-4：`listSparkleModels` 需全表，一次性命令类）；auth-status-all−auth-status = +253/+158 ms（S1-I-5：逐 provider `createPiRuntime`；~40 provider × `builtinModels()` 实例化 + providers/all + runtime 子图，凭据面围栏）。
- **SPARKLE_AUTO_ADAPT**：静态导入边不随 env 变（`main.ts` L53），=0 与默认差 +1.8/−3.8 ms 噪声带内。维度关闭。
- **Node 版本锚点**（R7-I §7 指令项执行完毕）：22.22.2 的节省集中于 providers/all 格（−27~−36 ms），地板格 −2~−4 ms——`getPackageScopeConfig` 病理修复的版本项定性成立。VM 升级 Node 是环境动作，与本切片代码无关；若 VM 默认升到 22.19+，custom 态回退成本自然减半（160→134 一档）。

## 2. 候选表 S8-I-1..3

| ID | 内容 | 理论收益 | 仿真/论证 | 实测 | 裁决 |
|---|---|---|---|---|---|
| S8-I-1 | `resolveListedModelLazy` 对已声明 custom provider id 跳过 `providers/all` 回退（`listed-model-lazy.ts` L54 的 customProviders 查找提前到 L36 回退之前 / 或以声明清单门控回退） | custom/mixed 态目录构建命令 −24.7~−53.8 ms/次 spawn（矩阵 §1.3，真实规模非噪声、达落地线） | **健全性反例**（见 §2.1）：未来 pi-ai 布局去掉 per-provider 表时，custom id 遮蔽 builtin id 的配置下裁决从 builtin 静默翻转为 custom——同步面 `resolveListedModel`（builtin 先于 custom）与惰性面分歧，恰发生在回退所守护的 fail-closed 场景 | 进程内锚点 70.7/34.7 ms；矩阵 8 格加粗行 | **淘汰**：硬不变量明令（providers/all 失手回退 + throw-outside-catch 不动）+ documented soundness counterexample。重开条件：pi-ai 发布与模型表版本锁定的轻量 provider-id 导出（现 exports 图无此子路径，已核）|
| S8-I-2 | custom 态预热 `providers/all` import（读完 config 判定将回退后、循环前发起 import promise） | 理论上与循环内其它 await 重叠 | 理论否决：ESM 实例化是主线程 CPU 工作（~70 ms 里 I/O 占比 µs 级，页缓存热）；且「将需要回退」的判定依赖 `loadProvidersConfig` 完成，之前无窗口；循环内其余 await 是已缓存导入与 µs 级文件读，无可重叠体 | 不适用（收益上界 ≈ 0 由结构推出） | **淘汰**：无重叠窗口，收益上界远低于落地线 |
| S8-I-3 | `buildLiveCatalogConfig` enabled 循环 Promise.all 化（`model-catalog.ts` L59-68） | 首个 id 后导入全缓存，仅省串行 await 微开销 | 理论否决：µs 级 + 多未知 id 配置下错误选择分歧（`unknown model "<id>"` 先抛哪个从 enabled 次序变为首拒绝，可观察差异）——S7-I-3 / S2-J-10 双故障竞态同族 | 不适用 | **淘汰**：同族同裁决，不立独立仿真 |

### 2.1 S8-I-1 详析（本轮核心裁决）

**成本归属证明**：custom/mixed 态的 +44~54 ms（22.14）在四个目录构建命令类上等幅出现、在 models-list/auth-status/run-plain（不构建目录）上零出现；进程内冷载 `providers/all` 70.7 ms、builtin 三表已载后仍 55.4 ms——in-CLI 边际 ~44-54 ms 与锚点自洽（fake 执行器下 pi-ai 子图仅由此路径进入）。触发链：`buildLiveCatalogConfig` L61 → `resolveListedModelLazy` → `builtinModelLazy` 对 `customco` 尝试 `providers/customco.models` → ERR_MODULE_NOT_FOUND → L36 回退 `await import("providers/all")`。

**为何不可修**（三路论证，全部走到底）：

1. **不变量明令**：任务令与 S7-I-1 落地条款均写明「providers/all 仍为回退权威源、失手回退 + fail-closed throw-outside-catch 不动」。对 custom id 关回退门即违令。
2. **健全性反例（独立于条款也成立）**：回退存在的全部意义是「per-provider 导入失手无法区分 unknown id / custom id / 未来 pi-ai 布局变更」。设未来版本不再发布 `<id>.models` 子路径且用户声明了 id 与 builtin 重合的 custom provider（如 `anthropic`）：现行代码 per-provider 失手 → providers/all → builtin 命中 → **builtin 优先**（与同步面 `resolveListedModel` 的 builtin-先-custom 次序一致）；门控版 per-provider 失手 → 发现 id 在 customProviders → **custom 命中返回**——裁决翻转且无任何报错。fail-closed 设计被改成 fail-divergent。
3. **健全门不存在**：唯一能挽救的形态是「以 pi-ai 官方轻量 provider-id 清单门控回退」（id 在清单 → 必回退；不在 → 免回退），要求该清单与模型表版本锁定。已核 `@earendil-works/pi-ai` package.json exports：仅 `.`、`./compat`、`./providers/*`、`./api/*`、`./oauth`、`./bedrock-provider`、`./bun-oauth` 七项，provider-id 清单唯一宿主是 all.js 本体（`getBuiltinProviders`）——加载它即付全款。dist/providers/ 342 文件中亦无 ids-only 模块。import 错误码判别（ERR_MODULE_NOT_FOUND vs ERR_PACKAGE_PATH_NOT_EXPORTED）在 `./providers/*` 通配下对「custom id」与「未来去表布局」给出**同一个**错误码，不可判别。

结论：淘汰，重开条件唯一且在上游（pi-ai 发布版本锁定的轻量 id 导出——届时门控回退等价可证，值 custom 态每目录构建命令 ~25-54 ms）。

### 2.2 不立新 ID 的对照项

- flowchart 双 `buildLiveCatalogConfig`（L569+L583）：S1-I-1/R7-I §4.4 已测 ~190 µs 关闭，模块缓存使第二次构建仅剩重复 config 读 + 缓存命中导入。识别即放弃。
- veteran 态 invocations.jsonl 全量读：R3-I 真实规模已量化（22.7 ms@10k / 124-127 ms@50k 行）、R7-I §1.2 已以切片外 + 双墙关闭。矩阵 fresh-state 设计与其不冲突，规模项维持既有裁决。
- `auth status --all` 逐 provider runtime：S1-I-5。`models enable/set-default` 的同步 `resolveListedModel`：S7-I-4。均仅测量在案。

## 3. 每文件收口

| 文件 | 状态 |
|---|---|
| `cli/main.ts` | S1-I/S4-I/S5-I-1 在位；run 四路径 + resume/answer 矩阵实测；plain run 不构建目录（证实）；`runAutoAdaptLoop` 静态边为 S6-I-1 关闭维度；零改动 |
| `cli/model-catalog.ts` | S7-I-1 点用处在位；S8-I-2/3 淘汰（§2）；L47 空配置短路 `catalogFromPrimary` 是 empty 态快的原因（矩阵证实） |
| `cli/models.ts` | 矩阵 8 格 ≈ 地板；`--available` 为 S7-I-4 排除行，仅测量 |
| `cli/auth.ts` | status ≈ 地板；`--all` 为 S1-I-5 围栏，仅测量（293-312 ms 在案）；凭据面零触碰 |
| `cli/adapt.ts` / `commits.ts` / `doctor.ts` / `doctor-overlay.ts` / `episode.ts` / `inject.ts` / `pause.ts` | 一次性/分支独占命令类，S5-I-1 惰性分派在位；inject/pause 的路由构建与 resume 同机制（迹闭合）；无候选 |
| `cli/errors.ts` / `flowchart-io.ts` | S1-I-6 及 µs 级解析器，历轮收口维持 |
| `pi-adapter/listed-model.ts` / `listed-model-common.ts` | 同步公开面字节等价不变量在位，零改动 |
| `pi-adapter/listed-model-lazy.ts` | S7-I-1 本体；S8-I-1 淘汰记录（§2.1），回退语义逐字未动 |
| `pi-adapter/runtime.ts` / `auth-session.ts` | S4-I 点用处在位；createPiRuntime 逐调用形态受 S1-I-5 围栏保护 |
| `pi-adapter/pi-executor.ts` / `cluster-tools.ts` | 数据面（网络/工具调用支配），执行器惰性子图外无冷启动暴露；无候选 |
| `pi-adapter/file-credential-store.ts` | 语义冻结（硬不变量），未读改 |
| `pi-adapter/index.ts` | 纯再导出 |
| `config/providers-config.ts` | S2-I-6/S3-I-5 关闭维度（parseModelRef 冗余的错误选择语义）；矩阵中 config 读为亚 ms 项 |
| `config/model-ref.ts` | µs 工具，S3-I 族收口维持 |
| `telemetry/model-invocation.ts` | S3-I-1 零收益记录维持；验证器无新候选 |

## 4. 测试与验证

```text
pnpm typecheck  # 干净
pnpm lint       # 干净
pnpm build      # 干净
npx tsx --test test/unit/{cli,config,pi-adapter,telemetry} test/integration/{cli,pi-adapter}
# 125 tests：pass 123 / fail 1 / skipped 1
# 唯一失败为既有环境问题：VM Node 22.14 < engines >=22.19 的 doctor 版本检查行
# 断言（R5-I/R6-I/R7-I 同一记载）；同套件在 nvm 22.22.2 下 7/7 全过；未改测试
node dist/cli/main.js --version   # 0.1.0
```

无生产代码改动，按令未重跑 r4i/r5i/r7i 仿真（父代理在 S7-I-1 后已复跑 68/68、119/119、80/80，本轮切片零漂移使其结论直接有效）。

## 5. MORE_OPTIMA 判定

**MORE_OPTIMA=no**。R7-I 的 yes 是为「配置态 × 命令类矩阵」补测立的旗——本轮该矩阵已在 4 配置态 × 10 命令类 × 双 Node 版本上完整执行（78 格全 exit 0），Node 22.19+ 锚点复测也已并轮完成。矩阵中每一个 >10 ms 单元格都已追溯到named 归属：唯一的数十 ms 新结构（custom 态 providers/all 回退）经三路论证为不变量封死 + 健全性反例 + 上游无健全门，其重开条件在 pi-ai 上游而非后续 pass 可测量或可落地之事；其余全部落在既有排除行或切片外子树。无遗留赢家，无待复测矩阵洞。

## 附录：矩阵 harness 全文（未提交，遵守无赢家纪律）

```js
// /tmp/r8i-bench/bench.mjs — R8-I configured-state x command-class matrix.
// Spawn-to-exit wall time for dist/cli/main.js under a chosen node binary.
// Usage: node bench.mjs <node-binary> <label> [--filter cellRegex]
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const REPO = "/workspace";
const CLI = join(REPO, "dist/cli/main.js");
const ROOT = "/tmp/r8i-bench";
const FIX = join(ROOT, "fixtures");
const WORK = join(ROOT, "work");
const nodeBin = process.argv[2] ?? process.execPath;
const label = process.argv[3] ?? "default";
const filterArg = process.argv.indexOf("--filter");
const filter = filterArg >= 0 ? new RegExp(process.argv[filterArg + 1]) : undefined;

const WARMUP = 2;
const ITERS = 12;

// ---------- fixtures ----------
const customProvider = {
  id: "customco",
  name: "Custom Co",
  baseUrl: "http://127.0.0.1:59999/v1",
  envVar: "CUSTOMCO_API_KEY",
  models: [
    { id: "custom-big", name: "Custom Big", contextWindow: 200000, maxTokens: 8192, inputCostPerMTok: 3, outputCostPerMTok: 15 },
    { id: "custom-small", name: "Custom Small", contextWindow: 100000, maxTokens: 4096, inputCostPerMTok: 0.3, outputCostPerMTok: 1.5 }
  ]
};

const states = {
  empty: undefined, // no providers.json at all
  builtin: {
    version: 1,
    enabled: ["anthropic/claude-fable-5", "anthropic/claude-haiku-4-5", "openai/gpt-4o"],
    primary: "anthropic/claude-fable-5",
    fast: "anthropic/claude-haiku-4-5",
    customProviders: []
  },
  custom: {
    version: 1,
    enabled: ["customco/custom-big", "customco/custom-small"],
    primary: "customco/custom-big",
    fast: "customco/custom-small",
    customProviders: [customProvider]
  },
  mixed: {
    version: 1,
    enabled: ["anthropic/claude-fable-5", "customco/custom-small"],
    primary: "anthropic/claude-fable-5",
    fast: "customco/custom-small",
    customProviders: [customProvider]
  }
};

rmSync(FIX, { recursive: true, force: true });
mkdirSync(FIX, { recursive: true });
for (const [name, cfg] of Object.entries(states)) {
  const dir = join(FIX, `state-${name}`);
  mkdirSync(join(dir, "runtime"), { recursive: true });
  if (cfg !== undefined) {
    writeFileSync(join(dir, "runtime", "providers.json"), JSON.stringify(cfg, null, 2) + "\n");
  }
}
// project fixture
const PROJ = join(FIX, "project");
mkdirSync(join(PROJ, "src"), { recursive: true });
writeFileSync(join(PROJ, "package.json"), JSON.stringify({ name: "bench-project", version: "1.0.0" }) + "\n");
writeFileSync(join(PROJ, "src", "index.js"), "export const x = 1;\n");
writeFileSync(join(PROJ, "README.md"), "# bench project\n");
// child spec
const CHILDREN = join(FIX, "children.json");
writeFileSync(CHILDREN, JSON.stringify({
  tasks: [
    { id: "tsk_a", role: "implementer", objective: "Do the work" },
    { id: "tsk_b", role: "reviewer", objective: "Review the work", dependsOn: ["tsk_a"] }
  ]
}) + "\n");
// flowchart spec (aliases cheap/premium exist in every catalog shape)
const FLOWCHART = join(FIX, "flowchart.json");
writeFileSync(FLOWCHART, JSON.stringify({
  id: "bench-fc",
  nodes: [
    { id: "only", taskId: "tsk_only", role: "actor", objective: "Do the work", modelPolicy: { allowedModels: ["cheap"] }, confidenceThreshold: 0.7, approvalRequired: false }
  ],
  edges: []
}) + "\n");
// waiting flowchart (approval gate) for resume cells
const WAITING_FC = join(FIX, "waiting-fc.json");
writeFileSync(WAITING_FC, JSON.stringify({
  id: "bench-wait",
  nodes: [
    { id: "gate", taskId: "tsk_gate", role: "router", objective: "Choose work", modelPolicy: { allowedModels: ["premium"] }, confidenceThreshold: 0.7, approvalRequired: true },
    { id: "work", taskId: "tsk_work", role: "actor", objective: "Do the work", modelPolicy: { allowedModels: ["cheap"] }, confidenceThreshold: 0.7, approvalRequired: false }
  ],
  edges: [{ from: "gate", to: "work", condition: { type: "success", expected: true } }]
}) + "\n");
// seed one WAITING_FOR_USER run into each state template so resume cells can replay it
const seededRunIds = {};
for (const state of Object.keys(states)) {
  const dir = join(FIX, `state-${state}`);
  const r = spawnSync(process.execPath, [CLI, "run", "--project", PROJ, "--objective", "seed waiting run", "--state-root", dir, "--flowchart", WAITING_FC, "--executor", "fake"], { encoding: "utf8", timeout: 120000 });
  const m = /^Run (\S+): (\S+)/m.exec(r.stdout ?? "");
  if (r.status !== 0 || m === null || m[2] !== "WAITING_FOR_USER") {
    console.error(`seed failed for ${state}: exit=${r.status} stdout=${(r.stdout ?? "").slice(0, 200)} stderr=${(r.stderr ?? "").slice(0, 200)}`);
    process.exit(1);
  }
  seededRunIds[state] = m[1];
}

// ---------- cells ----------
function cells() {
  const out = [];
  out.push({ id: "version", args: ["--version"], state: undefined });
  for (const state of Object.keys(states)) {
    out.push({ id: `models-list@${state}`, state, args: (s) => ["models", "list", "--state-root", s] });
    out.push({ id: `models-avail@${state}`, state, args: (s) => ["models", "list", "--available", "--state-root", s] });
    out.push({ id: `auth-status@${state}`, state, args: (s) => ["auth", "status", "--state-root", s] });
    out.push({ id: `auth-status-all@${state}`, state, args: (s) => ["auth", "status", "--all", "--state-root", s] });
    out.push({ id: `run-plain@${state}`, state, args: (s) => ["run", "--project", PROJ, "--objective", "bench objective", "--state-root", s, "--executor", "fake"] });
    out.push({ id: `run-children@${state}`, state, args: (s) => ["run", "--project", PROJ, "--objective", "bench objective", "--state-root", s, "--children", CHILDREN] });
    out.push({ id: `run-track@${state}`, state, args: (s) => ["run", "--project", PROJ, "--objective", "bench objective", "--state-root", s, "--track", "--assume-defaults"] });
    out.push({ id: `run-flowchart@${state}`, state, args: (s) => ["run", "--project", PROJ, "--objective", "bench objective", "--state-root", s, "--flowchart", FLOWCHART, "--executor", "fake"] });
    out.push({ id: `resume-waiting@${state}`, state, args: (s) => ["resume", "--run", seededRunIds[state], "--state-root", s] });
  }
  // SPARKLE_AUTO_ADAPT kill switch (runtime-only; measured to confirm no import delta)
  out.push({ id: "run-children@builtin+adapt0", state: "builtin", env: { SPARKLE_AUTO_ADAPT: "0" }, args: (s) => ["run", "--project", PROJ, "--objective", "bench objective", "--state-root", s, "--children", CHILDREN] });
  return out;
}

function freshState(state, cellId, iter) {
  if (state === undefined) return undefined;
  const dir = join(WORK, `${cellId.replace(/[^a-z0-9-]/gi, "_")}-${iter}`);
  rmSync(dir, { recursive: true, force: true });
  cpSync(join(FIX, `state-${state}`), dir, { recursive: true });
  return dir;
}

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

const results = [];
for (const cell of cells()) {
  if (filter && !filter.test(cell.id)) continue;
  const times = [];
  let exitCode;
  let firstStderr = "";
  for (let i = 0; i < WARMUP + ITERS; i++) {
    const stateDir = freshState(cell.state, cell.id, i);
    const args = typeof cell.args === "function" ? cell.args(stateDir) : cell.args;
    const env = { ...process.env, ...(cell.env ?? {}) };
    delete env.PI_PROVIDER; delete env.PI_MODEL; delete env.PI_API_KEY;
    if (!cell.env?.SPARKLE_AUTO_ADAPT) delete env.SPARKLE_AUTO_ADAPT;
    const t0 = performance.now();
    const r = spawnSync(nodeBin, [CLI, ...args], { env, encoding: "utf8", timeout: 120000 });
    const dt = performance.now() - t0;
    exitCode = r.status;
    if (i === 0 && r.status !== 0) firstStderr = (r.stderr ?? "").slice(0, 400);
    if (i >= WARMUP) times.push(dt);
  }
  times.sort((a, b) => a - b);
  const median = quantile(times, 0.5);
  results.push({
    cell: cell.id, exit: exitCode,
    min: +times[0].toFixed(1), median: +median.toFixed(1),
    p90: +quantile(times, 0.9).toFixed(1), max: +times[times.length - 1].toFixed(1),
    ...(firstStderr ? { stderr: firstStderr } : {})
  });
  console.error(`[${label}] ${cell.id}: median=${median.toFixed(1)}ms exit=${exitCode}`);
}

console.log(JSON.stringify({ label, node: nodeBin, results }, null, 2));
```

微锚点探针（进程内，双版本各自执行）：

```js
// providers/all vs per-provider table cold-import anchors
const t0 = performance.now();
await import("@earendil-works/pi-ai/providers/anthropic.models");
const t1 = performance.now();
await import("@earendil-works/pi-ai/providers/openai.models");
const t2 = performance.now();
await import("@earendil-works/pi-ai/providers/all");
const t3 = performance.now();
console.log("anthropic.models:", (t1 - t0).toFixed(1), "openai.models:", (t2 - t1).toFixed(1), "providers/all (after tables):", (t3 - t2).toFixed(1));
// separate cold run: providers/all alone = 70.7ms @22.14 / 34.7ms @22.22
```
