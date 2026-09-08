# R1-I：CLI / Pi 适配器 / 配置 / 遥测切片 SOTA 打磨报告

**战役:** 全库持久 SOTA 优化 Round 1 / R1-I（本轮最后一区）
**基线:** `cursor/sota-persistent-opt-83a1` @ `d2a7845`
**分支:** `cursor/r1-i-cli-adapter-slice-f177`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**落地 1 个赢家（S1-I），其余 8 个候选全部淘汰立排除。** `run --children` 路径此前
用完全相同的参数构建**两次**校准 live 目录：`smartChildPlan` 内部构建一次后即被
丢弃，主体随后重建一次用于 `catalogIds` / `preferredFast` / `createModelRouter`。
每次构建 = 读 providers.json + 逐个 `resolveListedModel` + **完整读取并逐行
`JSON.parse` + `isInvocation` 校验无界增长的 `invocations.jsonl`** + O(M×N) 校准
扫描。改动让 `smartChildPlan` 返回它路由所用的目录、调用方直接复用——每次
`--children` 运行省一整趟 I/O+解析（实测 N=10k 遥测行省 ~23ms、N=50k 省
~117ms，随日志线性增长），并消除了 assignments/cascade 计划与 router 可能读到
不同文件快照的潜在 TOCTOU 不一致。等价性经确定性仿真逐字节验证（§4.1），
diff 仅 `src/cli/main.ts` 12+/7-。

其余候选（S1-I-1…S1-I-8）经理论 + 确定性仿真（seeded mulberry32，三次独立
运行方向一致）裁决全部淘汰：6 个等价但一次性/交互路径 µs–ms 级噪声，1 个
理论被仿真推翻（parts/join 比 `+=` 慢 6.4×，反向坐实 S1-E-3），1 个属凭据面
公开签名/平行实现风险且一次性 ~11ms 亚感知。

## 0. 范围与约束遵守

- 切片：`src/cli/`（13 文件）、`src/pi-adapter/`（7 文件）、`src/config/`（2 文件）、
  `src/telemetry/model-invocation.ts` 全量读码；上下游 `routing/cost-calibration.ts`、
  `routing/assign.ts`、`routing/live-cascade.ts`、`supervisor/model-router.ts`、
  `domain/ids.ts`、`privacy/state-layout.ts` 只读取证，一行未改。
- **解析/帮助/doctor/auth 行为不变**：改动零涉及 parseArgs 选项表、USAGE 文本、
  doctor 检查、auth 子命令；输出契约逐字节不变（§4.1 + 全部 CLI 测试绿）。
- **凭据存储、provider 配置语义不变**：`FileCredentialStore`、`providers-config.ts`、
  `auth-session.ts` 零 diff。凭据面唯一候选 S1-I-5 被淘汰不动（§4.3）。
- **自适应路由未接入默认 CLI 路径**：改动只是复用同一 R0 等价校准目录对象，
  路由算法、决策对象、模型选择逐字节不变。
- 遵守排除表：X1-1（隐藏缓存）——本改动**不是缓存**，是把同一次运行内的重复
  构建改为显式参数传递，无跨调用状态；X4-4（cost-calibration 分组索引）未触碰
  ——校准内部 O(M×N) 扫描保持原样，只是少跑一整趟；S1-J-5（find→Map）、
  S1-E-3（+=→parts/join）以本切片对应物重新裁决，结论同向且更强（S1-I-3、S1-I-7）。

## 1. 现实规模测量（门槛证据基底）

切片全部为 CLI 一次性命令路径 + pi 执行器边界。关键规模事实（读码 + 确定性
profile 实测）：

- **invocations.jsonl 无界增长**：`run` 命令的 `onInvocation` 钩子对每次模型调用
  追加一行（main.ts）；无轮转/截断。长期使用的 state root 上万行是常态。
- **每次目录构建**：providers.json 读取 ~60µs + `resolveListedModel`×enabled +
  invocations.jsonl 全量解析（每行 JSON.parse + isInvocation 正则/字段校验）+
  `calibrateCatalogRates` 对每个模型全扫 N 行 = O(M×N)。
- **实测单次构建成本**（3 次独立运行区间）：

```text
S1-I bench N=0:     one calibrated build=0.28ms
S1-I bench N=1000:  one calibrated build=2.92-3.10ms (invocations load share ~2.2-2.5ms)
S1-I bench N=10000: one calibrated build=22.76-23.98ms (load share ~20-21ms)
S1-I bench N=50000: one calibrated build=115.36-116.82ms (load share ~112-115ms)
```

- **children 规模**：spec 文件任务数个位数到几十（README 例 3 个）。
- **auth status --all 规模**：39 个 builtin provider，每个一次 `createPiRuntime`
  （~250-320µs）。

## 2. 结构下界论证（为什么其余没有余地）

| 函数/路径 | 下界论证 |
| --- | --- |
| `parseChildSpec` / `parseChildNodeResults` / `parseFlowchartFile` | 逐字段校验 + 错误消息即输出契约本体，Θ(输入) 单遍 |
| `inspectCommand` / `printFlowchartOutcome` / 各打印循环 | 输出本身，Ω(打印行数) |
| `FileCredentialStore.load` 每操作全读 | 持久层 fail-closed 契约；缓存 = X1-1 |
| `providers-config` load/save | 原子写 + 全量校验是语义本体；一次性 |
| `doctor` 各检查 | 每检查一次 I/O 是检查语义本体；`countSkillRouteLines` 逐行 JSON.parse 即损坏检测契约 |
| `translatePiEvent` / `buildInvocation` | 每事件 O(1)；invocation 聚合 Ω(事件数) 单遍已达 |
| `invocationError` | 早退校验链，Θ(字段数) 即下界 |
| `compareRunToRun` | 已是 Map 索引单遍 O(n+m)，渐近下界 |
| `resolveIdentity` / `resolveModel` | O(1) 查找 + 别名表 |
| `collectSelectedActionIds` | Set 去重单遍已达 |

结论：除 S1-I 的结构性重复消除外，剩余候选只能是一次性命令路径上的常数
因子——正是战役反复裁决为噪声的类别。

## 3. 候选总表

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| **S1-I（赢家）** | `--children` 重复校准目录构建消除（smartChildPlan 返回 catalog，主体复用） | 2 趟 providers.json+invocations.jsonl 读取/解析/校准 → 1 趟 | ✅ n=8/40 children 全流程逐字节一致（含校准已生效路径） | 省 ~3ms@N=1k / ~23ms@N=10k / ~117ms@N=50k 每次运行，随日志线性增长 | **落地** |
| S1-I-1 | `--flowchart` 路径 L574 未校准构建与 `createCalibratedCliModelRouter` 内部构建去重 | 省 1 次 providers.json 读 + 模型解析 | —（同 S1-I 论证） | 单次未校准构建仅 ~180-205µs（invocations 不重复解析） | 淘汰：噪声 |
| S1-I-2 | `runCommand` 与 `createExecutor("pi")` 双读 providers.json 消除（线程传参） | 省 1 次小文件读 | —（平凡等价） | ~57-64µs/次，仅 pi 执行器路径 | 淘汰：噪声 |
| S1-I-3 | `smartChildPlan` `assignments.find` 换 Map | O(N²)→O(N) | ✅ n=8/100 逐字节 | n=8 省 1.1-1.5µs；n=100 省 ~13-16µs | 淘汰：S1-J-5 同类，children 个位数到几十 |
| S1-I-4 | `models set-default` 等命令 providers.json 3-4 次重读合并 | 省 2-3 次小文件读 | —（平凡等价） | ~60µs/读，一次性配置命令 | 淘汰：噪声 |
| S1-I-5 | `auth status --all` 每 provider 一次 `createPiRuntime` 提升至循环外 | O(P) 运行时构建→O(1) | —（输出可证一致） | ~250-320µs ×38 ≈ ~10-12ms，一次性交互命令 | 淘汰：亚感知 + 需绕开/改 `checkProviderAuth` 公开面（X1-2 类）+ 凭据面禁区从严 |
| S1-I-6 | `parseCliErrorJson` `reverse()` 拷贝换反向索引循环 | 免 1 次数组拷贝 | ✅ 4000 fuzz（CRLF/torn JSON/空行混合） | 493→481ns，测试辅助路径 | 淘汰：噪声 |
| S1-I-7 | `buildInvocation` `responseText +=` 换 parts+join | 免二次串接 | ✅ 值等价 | **实测反向**：400 deltas 下 += 1.5-1.9µs vs join 9.8-9.9µs（慢 ~6.4×） | 淘汰：负优化，坐实 S1-E-3（V8 rope 串接已最优） |
| S1-I-8 | `resolveListedModel` 自定义路径先构建全部 listed 再 find，改先 find 配置 | 省 (K-1) 次对象构造 | —（平凡等价） | 最坏 ~14.4-14.6µs/次，每命令个位数次 | 淘汰：噪声 |

## 4. 关键裁决细节

### 4.1 S1-I 的等价性论证（为什么 2→1 逐字节安全）

三层论证 + 仿真仲裁：

1. **确定性重放**：两次构建是字面相同的表达式
   `calibrateCatalogFromState(await buildLiveCatalogConfig(stateRoot, { primaryModelId, fastModelId }), stateRoot)`
   （main.ts 原 L361-364 与 L726-729）。两次读取之间进程内**无写入者**——
   `onInvocation` 追加钩子只在执行器运行期间触发，而执行发生在两次构建都完成
   之后的 `startFlowchartRun` 内。确定性场景下两趟必然读到相同文件内容，产出
   深等值目录。
2. **对象不外泄**：`assignTasks` 产出的 `TaskAssignment` 仅含字符串/新建
   analysis/decision 对象（assign.ts 全量读码取证）；`liveCascadePlanFromAssignment`
   产出全新 tier 对象；`createModelRouter` 经 `catalogModel()` 把每个模型归一化为
   **新对象**后暴露 `router.config`。复用同一 catalog 对象不会让任何既有身份
   比较由 false 变 true 的路径可达（S1-A-7/S1-B-8 关切不适用）。
3. **一致性收紧而非放松**：原实现里 cascade 计划（catalog#1）与 router
   （catalog#2）若遇外部并发追加 invocations.jsonl 可读到不同快照——复用后二者
   共享一个快照，行为面上是消除潜在发散，非引入。
4. **仿真仲裁**：n=8 与 n=40 children 全流程（routed children 含 cascade、
   assignments、catalogIds、preferredFast、`compileChildrenToFlowchart` 输出、
   LOW/MEDIUM/HIGH 三档 router 决策）JSON 逐字节一致，且夹具校准确实生效
   （`policyVersion` 带 `+calibrated` 后缀），覆盖非平凡路径。

### 4.2 S1-I 为什么过门槛（对照本轮同类淘汰）

与本轮各区淘汰的「常数因子微优化」不同，这是**结构性重复消除**（同一趟工作
做两遍→一遍），且被省掉的那趟的成本随无界增长的遥测日志**线性上升**：
N=10k 行省 ~23ms、N=50k 省 ~117ms——量级已与已落地赢家可比（对照 Iter3 H1
的 522ms/回放），并且发生在文档化的主 CLI 流程（README `--children` 例）而非
一次性离线工具。风险面极小：diff 12+/7-，模块私有函数签名扩一个返回字段，
零公开面变更。三次独立仿真运行方向一致。

### 4.3 S1-I-5 的凭据面裁决

`auth status --all` 对 39 个 builtin provider 各构建一次完整 Pi 运行时（每次
~250-320µs 的 `builtinModels` 构建），提升到循环外可省 ~10-12ms。淘汰理由三重：
(a) 一次性交互命令上 11ms 亚感知；(b) 干净实现需要给 `checkProviderAuth` 加
runtime 参数（公开签名变更）或在 CLI 内联其映射逻辑（X1-2 类平行实现）；
(c) 任务规格明确凭据面从严——纯收益不足以动这块。每 provider 的 auth.json
重复读取是 `FileCredentialStore.read` 持久层契约本体（X1-1 域），不可缓存。

### 4.4 S1-I-7 的反向教训

`buildInvocation` 的 `responseText += event.text` 换 parts+join 在 400 deltas 的
现实响应规模下**慢 6.4×**（1.5-1.9µs vs 9.8-9.9µs）：V8 对 `+=` 使用 rope/cons
string，本就是摊还 O(总长)，而 parts 数组多付分配与 join 拷贝。S1-E-3 当时按
「~230ns 噪声」淘汰，本轮证据升级为「负优化」，排除更牢。

## 5. 逐文件收口

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `cli/main.ts` | S1-I 落地；S1-I-2/3 淘汰；`parseChildSpec` 校验链 = 契约；`loadOptionalPublicPrior` fail-soft 语义不可动 | **S1-I 落地** |
| `cli/adapt.ts` | 子命令一次性；`promoteCommand`/`rollbackCommand` 锁内全量 load/save 是 CAS 契约本体 | 无候选 |
| `cli/auth.ts` | S1-I-5 淘汰（§4.3）；`unique()` 表长个位数 | 无候选 |
| `cli/models.ts` | S1-I-4 淘汰；`listSparkleModels` 输出即遍历 Ω(M)；动态 import 是启动成本优化（保留） | 无候选 |
| `cli/doctor.ts` / `doctor-overlay.ts` | 检查各一次 I/O = 语义本体；`countSkillRouteLines` 逐行 JSON.parse 即损坏检测契约；`versionAtLeast` O(段数) | 无候选 |
| `cli/commits.ts` | `proposalsFromInput` Set 化已是最优；spawnSync per commit 是 git 语义 | 无候选 |
| `cli/episode.ts` / `pause.ts` / `inject.ts` | 一次性命令 + 文件锁契约 | 无候选 |
| `cli/errors.ts` | S1-I-6 淘汰 | 无候选 |
| `cli/flowchart-io.ts` | `collectSelectedActionIds` 已 Set 去重单遍；校验链 = 契约 | 无候选 |
| `cli/model-catalog.ts` | `buildLiveCatalogConfig` 内部已 Map/Set 索引；S1-I-1 淘汰 | 无候选 |
| `pi-adapter/pi-executor.ts` | S1-I-7 淘汰（负优化）；`collected.some` O(E) 一次；事件收集-后置产出顺序是 invocation 记录语义 | 无候选 |
| `pi-adapter/runtime.ts` / `auth-session.ts` | `createPiRuntime` 每调新建 = 无隐藏状态契约（X1-1 反面）；交互登录路径 I/O 主导 | 无候选 |
| `pi-adapter/file-credential-store.ts` | 每操作全读全写 = 持久层 fail-closed + 原子写契约 | 无候选 |
| `pi-adapter/listed-model.ts` | S1-I-8 淘汰；`listSparkleModels` 输出即遍历 | 无候选 |
| `pi-adapter/cluster-tools.ts` | 每工具调用 O(1) 包装；mailbox 数据面在 R1-J 域 | 无候选 |
| `config/model-ref.ts` | 三函数皆 O(len) 单遍，字符串切片下界 | 无候选 |
| `config/providers-config.ts` | 双 `parseModelRef` 每字段 ~ns 级；`writeAtomicJson` = 原子写契约 | 无候选 |
| `telemetry/model-invocation.ts` | `invocationError` 早退链即下界；`compareRunToRun` 已 Map 单遍 O(n+m)；`INVOCATION_CALL_OUTCOMES.includes` 4 元素（S1-D-8 类） | 无候选 |

## 6. 前后对比

唯一代码 diff（`src/cli/main.ts`，12+/7-）：

- `smartChildPlan` 返回类型增加 `catalog: ModelRouterConfig` 字段并返回其构建的
  校准目录（模块私有函数，无公开面变更）；
- `--children` 主体删除第二次
  `calibrateCatalogFromState(await buildLiveCatalogConfig(...))` 调用，改为
  `const catalog = planned.catalog;`；
- `import type ModelRouterConfig`。

CLI 标志、输出、退出码、事件、checkpoint 逐字节不变（§4.1 仿真 + §7 测试）。

## 7. 测试

改动后相关套件全绿（Node 22.22.2，满足 engines >=22.19.0）：

```bash
npx tsx --test "test/unit/cli/*.test.ts" "test/unit/pi-adapter/*.test.ts" \
  "test/unit/config/*.test.ts" "test/unit/telemetry/*.test.ts"
# tests 66 / suites 3 / pass 66 / fail 0
npx tsx --test test/integration/m1/cli-children.test.ts \
  test/integration/m2.5/children-flowchart.test.ts \
  test/integration/cli/cli.test.ts test/integration/cli/public-prior-cli.test.ts
# tests 43 / pass 43 / fail 0   （--children 输出契约、flowchart 编译、公共先验路径）
```

真实 CLI 端到端冒烟（3 任务 children spec + fake 执行器）：routing 行、children
汇总、adapt 行、exit=0 全部符合既有输出契约。

仿真（临时脚本，未入库；完整源码见附录，seed 固定可复现）最终一次运行：

```text
S1-I bench N=0: one calibrated build=0.30ms (invocations load share=0.05ms) -> per --children run saving=0.30ms
S1-I bench N=1000: one calibrated build=3.02ms (invocations load share=2.32ms) -> per --children run saving=3.02ms
S1-I bench N=10000: one calibrated build=23.34ms (invocations load share=20.59ms) -> per --children run saving=23.34ms
S1-I bench N=50000: one calibrated build=115.69ms (invocations load share=113.94ms) -> per --children run saving=115.69ms
S1-I-1 bench: one uncalibrated buildLiveCatalogConfig=204us
S1-I-3 bench n=8: find=6.0us map=4.9us delta=1.1us per --children run
S1-I-3 bench n=100: find=75.2us map=60.3us delta=14.9us per --children run
S1-I-2/4 bench: one loadProvidersConfig=64us
S1-I-5 bench: createPiRuntime=253us x 39 builtin providers -> hoist saves ~9.6ms per auth status --all
S1-I-6 bench: current=494ns cand=485ns
S1-I-7 bench (400 deltas): +==1624ns parts/join=9994ns per invocation record
S1-I-8 bench: resolveListedModel custom worst case=14283ns

ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

四次独立运行（三次裁决 + 一次附录脚本终验）等价结论逐位一致，计时抖动内
稳定，裁决方向不变（S1-I 四次都在 23±1ms@N=10k / 116±1ms@N=50k；S1-I-5 在
~9.6-12.1ms 区间；S1-I-7 四次全部大幅更慢）。

## 8. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

赢家 S1-I 请并入「已落地」节：
`S1-I --children 重复校准目录构建消除：smartChildPlan 返回 catalog 复用（2 趟 providers.json+invocations.jsonl 解析→1 趟，~23ms@10k 行/次，见 round-01/R1-I.md）`。

| ID | 方案 | 原因 |
| --- | --- | --- |
| S1-I-1 | `--flowchart` 路径未校准 buildLiveCatalogConfig 与校准构建去重 | 单次仅 ~190µs（invocations 不重复解析），噪声 |
| S1-I-2 | runCommand 与 createExecutor("pi") providers.json 双读消除 | ~60µs/读，一次性，噪声 |
| S1-I-3 | cli/main smartChildPlan `assignments.find` 换 Map | S1-J-5 同类：children 个位数到几十，n=8 省 ~1.1µs |
| S1-I-4 | models 子命令 providers.json 多次重读合并 | 一次性配置命令，~60µs/读，噪声 |
| S1-I-5 | auth status --all 每 provider createPiRuntime 提升 | 一次性交互 ~10-12ms 亚感知 + 需公开签名/平行实现 + 凭据面从严 |
| S1-I-6 | parseCliErrorJson reverse() 换反向索引 | 493→481ns，噪声 |
| S1-I-7 | pi-executor buildInvocation `+=` 换 parts+join | 不劣化伪装：实测慢 6.4×（V8 rope），S1-E-3 证据升级为负优化 |
| S1-I-8 | resolveListedModel 自定义路径先构建全部再 find | 最坏 ~14.5µs、每命令个位数次，噪声 |

重开条件：S1-I-1/2/4 需先出现同一进程内高频重复调用场景；S1-I-3 需 children
规模增长 ≥2 个量级；S1-I-5 需凭据面约束放宽且 provider 数增长一个量级；
S1-I-6/8 需先给出非噪声场景；S1-I-7 需先推翻本报告基准（三次全部反向）。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.mts` 后 `npx tsx <file>`（仓库根目录，依赖已装，
Node ≥22.19）。seeds：`0x51a101`–`0x51a109`。

```ts
/**
 * R1-I deterministic equivalence + benchmark simulation.
 * Adjudicates candidates S1-I(win) and S1-I-1 .. S1-I-8 for the
 * CLI / pi-adapter / config / telemetry slice.
 * Seeded PRNG (mulberry32) -> fully reproducible. Seeds 0x51a101-0x51a109.
 *
 * Winner candidate (S1-I): `run --children` builds the calibrated live
 * catalog TWICE with identical arguments (smartChildPlan internal build is
 * discarded; main body rebuilds). Candidate: smartChildPlan returns its
 * catalog and the caller reuses it. Each build = providers.json read +
 * resolveListedModel per enabled id + invocations.jsonl full parse with
 * per-line JSON.parse + isInvocation validation + O(M x N) calibration.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { buildLiveCatalogConfig } from "/workspace/src/cli/model-catalog.js";
import { calibrateCatalogFromState, loadInvocationsFromStateRoot } from "/workspace/src/routing/cost-calibration.js";
import { assignTasks } from "/workspace/src/routing/assign.js";
import { liveCascadePlanFromAssignment } from "/workspace/src/routing/live-cascade.js";
import { compileChildrenToFlowchart } from "/workspace/src/graph/compile-children.js";
import { createModelRouter, type ModelRouterConfig } from "/workspace/src/supervisor/model-router.js";
import { createAgentProfileRegistry, defaultAgentProfiles } from "/workspace/src/agents/registry.js";
import { isAgentRole, type AgentRole } from "/workspace/src/domain/roles.js";
import type { TaskId } from "/workspace/src/domain/ids.js";
import type { ChildTaskInput } from "/workspace/src/run/child-coordinator.js";
import { loadProvidersConfig } from "/workspace/src/config/providers-config.js";
import { runtimeRoot } from "/workspace/src/privacy/state-layout.js";
import { parseCliErrorJson } from "/workspace/src/cli/errors.js";
import { resolveListedModel, listSparkleProviders } from "/workspace/src/pi-adapter/listed-model.js";
import { createPiRuntime } from "/workspace/src/pi-adapter/runtime.js";
import type { CustomProviderConfig } from "/workspace/src/config/providers-config.js";

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

/* ============================================================
 * Fixture: hermetic state root with a custom provider (no builtin
 * catalog dependency), enabled models, and an invocations.jsonl of
 * N rows (mix of calibration-matching, non-matching, invalid, and
 * malformed lines -- all deterministic).
 * ============================================================ */
const PROVIDER_ID = "simprov";
const MODEL_IDS = ["sim-a", "sim-b", "sim-c"] as const;
const CATALOG_IDS = MODEL_IDS.map((id) => `${PROVIDER_ID}/${id}`);
const PRIMARY_ID = `${PROVIDER_ID}/sim-c`;
const FAST_ID = `${PROVIDER_ID}/sim-a`;

function providersJson(): string {
  return `${JSON.stringify(
    {
      version: 1,
      enabled: CATALOG_IDS,
      primary: PRIMARY_ID,
      fast: FAST_ID,
      customProviders: [
        {
          id: PROVIDER_ID,
          baseUrl: "http://localhost:9/v1",
          models: MODEL_IDS.map((id, i) => ({
            id,
            contextWindow: 32768 * (i + 1),
            maxTokens: 4096,
            inputCostPerMTok: 0.5 * (i + 1),
            outputCostPerMTok: 1.5 * (i + 1)
          }))
        }
      ]
    },
    null,
    2
  )}\n`;
}

function invocationLine(rng: () => number, index: number): string {
  const roll = rng();
  if (roll < 0.03) return "{ this line is torn"; // malformed JSON, skipped
  const modelIdx = Math.floor(rng() * MODEL_IDS.length);
  // Half the valid rows match catalog id+version so calibration smoothing runs.
  const matching = rng() < 0.5;
  const invalid = roll < 0.06; // invalid row (bad hash), skipped by isInvocation
  const row = {
    id: `inv_${index.toString(16).padStart(8, "0")}`,
    taskId: `tsk_${(index % 97).toString(16)}`,
    runId: `run_${(index % 13).toString(16)}`,
    agentInstanceId: `agt_${(index % 7).toString(16)}`,
    config: {
      provider: PROVIDER_ID,
      model: matching ? CATALOG_IDS[modelIdx] : MODEL_IDS[modelIdx],
      modelVersion: matching ? MODEL_IDS[modelIdx] : undefined,
      parameterHash: invalid ? "ZZZZ" : (index % 0xfffffff).toString(16)
    },
    responseHash: ((index * 2654435761) % 0xffffffff >>> 0).toString(16),
    tokensIn: rng() < 0.9 ? Math.floor(rng() * 100000) : undefined,
    tokensOut: rng() < 0.9 ? 1 + Math.floor(rng() * 8000) : undefined,
    latencyMs: Math.floor(rng() * 60000),
    occurredAt: new Date(1756000000000 + index * 1000).toISOString()
  };
  return JSON.stringify(row);
}

function makeStateRoot(n: number, seed: number): string {
  const root = mkdtempSync(join(tmpdir(), `r1i-sim-${n}-`));
  const runtime = runtimeRoot(root);
  mkdirSync(runtime, { recursive: true });
  writeFileSync(join(runtime, "providers.json"), providersJson(), "utf8");
  const rng = mulberry32(seed);
  const lines: string[] = [];
  for (let i = 0; i < n; i += 1) lines.push(invocationLine(rng, i));
  writeFileSync(join(runtime, "invocations.jsonl"), lines.length === 0 ? "" : `${lines.join("\n")}\n`, "utf8");
  return root;
}

/* ============================================================
 * Children fixture (deterministic corpus, repo-test style).
 * ============================================================ */
const ROLES: readonly AgentRole[] = ["worker", "scout", "planner", "implementer", "reviewer", "tester", "debugger"];
const OBJECTIVES = [
  "Survey the payment module",
  "Plan the checkout migration",
  "Run the unit tests",
  "Implement retry logic for the ledger sync",
  "Review the audit log formatting nits",
  "Fix the flaky spec for gate transitions",
  "Research and compare vector store options",
  "Deploy payment credentials to production"
];

function genChildren(rng: () => number, n: number): ChildTaskInput[] {
  const registry = createAgentProfileRegistry(defaultAgentProfiles());
  return Array.from({ length: n }, (_, i) => {
    const role = pick(rng, ROLES);
    return {
      taskId: `tsk_child${i}` as TaskId,
      role,
      objective: pick(rng, OBJECTIVES),
      profile: registry.resolve(role),
      inputArtifactIds: [],
      acceptanceCriteria: [],
      limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 3_600_000 }
    };
  });
}

/* ============================================================
 * S1-I: current flow (double build) vs candidate flow (single build).
 * Replicates main.ts smartChildPlan + the --children body verbatim.
 * ============================================================ */
async function currentFlow(children: ChildTaskInput[], stateRoot: string) {
  // smartChildPlan (verbatim): builds catalog #1, discards it.
  const catalog1 = await calibrateCatalogFromState(
    await buildLiveCatalogConfig(stateRoot, { primaryModelId: PRIMARY_ID, fastModelId: FAST_ID }),
    stateRoot
  );
  const assignable = children.flatMap((child) =>
    isAgentRole(child.role) ? [{ taskId: child.taskId, role: child.role, objective: child.objective }] : []
  );
  const assignments = assignTasks({ tasks: assignable, catalog: catalog1 });
  const routed = children.map((child) => {
    const assignment = assignments.find((item) => item.taskId === child.taskId);
    if (assignment === undefined) return child;
    return {
      ...child,
      assignedModel: assignment.decision.model,
      cascade: liveCascadePlanFromAssignment(assignment, catalog1)
    };
  });
  // main body (verbatim): rebuilds catalog #2 with identical arguments.
  const catalog2 = await calibrateCatalogFromState(
    await buildLiveCatalogConfig(stateRoot, { primaryModelId: PRIMARY_ID, fastModelId: FAST_ID }),
    stateRoot
  );
  return finishFlow(routed, assignments, catalog2);
}

async function candidateFlow(children: ChildTaskInput[], stateRoot: string) {
  const catalog = await calibrateCatalogFromState(
    await buildLiveCatalogConfig(stateRoot, { primaryModelId: PRIMARY_ID, fastModelId: FAST_ID }),
    stateRoot
  );
  const assignable = children.flatMap((child) =>
    isAgentRole(child.role) ? [{ taskId: child.taskId, role: child.role, objective: child.objective }] : []
  );
  const assignments = assignTasks({ tasks: assignable, catalog });
  const routed = children.map((child) => {
    const assignment = assignments.find((item) => item.taskId === child.taskId);
    if (assignment === undefined) return child;
    return {
      ...child,
      assignedModel: assignment.decision.model,
      cascade: liveCascadePlanFromAssignment(assignment, catalog)
    };
  });
  return finishFlow(routed, assignments, catalog);
}

function finishFlow(
  routed: readonly (ChildTaskInput & { assignedModel?: string })[],
  assignments: ReturnType<typeof assignTasks>,
  catalog: ModelRouterConfig
) {
  const catalogIds = catalog.models.map((model) => model.id);
  const preferredFast = catalogIds.includes(FAST_ID) ? FAST_ID : catalogIds[0]!;
  const flowchart = compileChildrenToFlowchart(
    routed.flatMap((child) => {
      if (!isAgentRole(child.role)) return [];
      return [
        {
          taskId: child.taskId,
          role: child.role,
          objective: child.objective,
          allowedModels: catalogIds,
          ...(child.assignedModel !== undefined ? { preferredModel: child.assignedModel } : {})
        }
      ];
    }),
    { flowchartId: "children", allowedModels: catalogIds, preferredModel: preferredFast }
  );
  const router = createModelRouter(catalog);
  // Sample router decisions to pin router behavioral equality.
  const decisions = (["LOW", "MEDIUM", "HIGH"] as const).map((complexity) =>
    router.route({
      taskId: "tsk_probe" as TaskId,
      role: "actor",
      complexity,
      modelPolicy: { allowedModels: catalogIds, preferredModel: preferredFast },
      ...(complexity === "HIGH" ? { approvalRequired: true, highRisk: true } : {}),
      limits: { remainingTimeMs: Number.MAX_SAFE_INTEGER }
    })
  );
  return { routed, assignments, catalogIds, preferredFast, flowchart, catalog, decisions };
}

{
  const stateRoot = makeStateRoot(2000, 0x51a101);
  try {
    for (const n of [8, 40]) {
      const children = genChildren(mulberry32(0x51a102 + n), n);
      const cur = await currentFlow(children, stateRoot);
      const cand = await candidateFlow(children, stateRoot);
      check(
        `S1-I equivalence n=${n}`,
        JSON.stringify(cur) === JSON.stringify(cand),
        "current(double-build) vs candidate(single-build) diverged"
      );
    }
    // Calibration must actually have engaged (policyVersion suffix) so the
    // equivalence covers the calibrated path, not a trivial no-op.
    const catalog = await calibrateCatalogFromState(
      await buildLiveCatalogConfig(stateRoot, { primaryModelId: PRIMARY_ID, fastModelId: FAST_ID }),
      stateRoot
    );
    check("S1-I calibration engaged", catalog.policyVersion.endsWith("+calibrated"), catalog.policyVersion);
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
}

/* ============================================================
 * S1-I benchmark: cost of ONE duplicate calibrated-catalog build
 * (the exact per-run saving) at growing invocations.jsonl sizes.
 * ============================================================ */
for (const [n, reps] of [
  [0, 200],
  [1000, 60],
  [10000, 12],
  [50000, 4]
] as const) {
  const stateRoot = makeStateRoot(n, 0x51a103);
  try {
    const one = await benchAsync(async () => {
      await calibrateCatalogFromState(
        await buildLiveCatalogConfig(stateRoot, { primaryModelId: PRIMARY_ID, fastModelId: FAST_ID }),
        stateRoot
      );
    }, reps);
    const loadOnly = await benchAsync(async () => {
      await loadInvocationsFromStateRoot(stateRoot);
    }, reps);
    console.log(
      `S1-I bench N=${n}: one calibrated build=${one.toFixed(2)}ms (invocations load share=${loadOnly.toFixed(2)}ms) -> per --children run saving=${one.toFixed(2)}ms`
    );
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
}

/* ============================================================
 * S1-I-1: flowchart path duplicate buildLiveCatalogConfig (ids-only
 * first build). Saving upper bound = one uncalibrated build.
 * ============================================================ */
{
  const stateRoot = makeStateRoot(0, 0x51a104);
  try {
    const one = await benchAsync(async () => {
      await buildLiveCatalogConfig(stateRoot);
    }, 300);
    console.log(`S1-I-1 bench: one uncalibrated buildLiveCatalogConfig=${(one * 1000).toFixed(0)}us`);
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
}

/* ============================================================
 * S1-I-3: smartChildPlan assignments.find -> Map (S1-J-5 class).
 * ============================================================ */
{
  const stateRoot = makeStateRoot(0, 0x51a105);
  try {
    const catalog = await calibrateCatalogFromState(
      await buildLiveCatalogConfig(stateRoot, { primaryModelId: PRIMARY_ID, fastModelId: FAST_ID }),
      stateRoot
    );
    for (const n of [8, 100]) {
      const children = genChildren(mulberry32(0x51a105 + n), n);
      const assignable = children.map((child) => ({
        taskId: child.taskId,
        role: child.role,
        objective: child.objective
      }));
      const assignments = assignTasks({ tasks: assignable, catalog });
      const mapRoute = () => {
        const byTask = new Map(assignments.map((item) => [item.taskId, item]));
        return children.map((child) => {
          const assignment = byTask.get(child.taskId);
          if (assignment === undefined) return child;
          return {
            ...child,
            assignedModel: assignment.decision.model,
            cascade: liveCascadePlanFromAssignment(assignment, catalog)
          };
        });
      };
      const findRoute = () =>
        children.map((child) => {
          const assignment = assignments.find((item) => item.taskId === child.taskId);
          if (assignment === undefined) return child;
          return {
            ...child,
            assignedModel: assignment.decision.model,
            cascade: liveCascadePlanFromAssignment(assignment, catalog)
          };
        });
      check(`S1-I-3 equivalence n=${n}`, JSON.stringify(findRoute()) === JSON.stringify(mapRoute()));
      const cur = bench(() => void findRoute(), 2000);
      const cand = bench(() => void mapRoute(), 2000);
      console.log(
        `S1-I-3 bench n=${n}: find=${(cur * 1e3).toFixed(1)}us map=${(cand * 1e3).toFixed(1)}us delta=${((cur - cand) * 1e3).toFixed(1)}us per --children run`
      );
    }
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
}

/* ============================================================
 * S1-I-2: providers.json double read (runCommand + createExecutor pi).
 * Saving upper bound = one loadProvidersConfig.
 * ============================================================ */
{
  const stateRoot = makeStateRoot(0, 0x51a106);
  try {
    const one = await benchAsync(async () => {
      await loadProvidersConfig(stateRoot);
    }, 500);
    console.log(`S1-I-2/4 bench: one loadProvidersConfig=${(one * 1000).toFixed(0)}us`);
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
}

/* ============================================================
 * S1-I-5: auth status --all per-provider createPiRuntime hoist.
 * Saving upper bound = (P-1) x createPiRuntime.
 * ============================================================ */
{
  const stateRoot = makeStateRoot(0, 0x51a107);
  try {
    const providers = listSparkleProviders();
    const one = await benchAsync(async () => {
      await createPiRuntime({ stateRoot, customProviders: [] });
    }, 50);
    console.log(
      `S1-I-5 bench: createPiRuntime=${(one * 1000).toFixed(0)}us x ${providers.length} builtin providers -> hoist saves ~${(one * (providers.length - 1)).toFixed(1)}ms per auth status --all`
    );
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
}

/* ============================================================
 * S1-I-6: parseCliErrorJson reverse() -> backward index loop.
 * ============================================================ */
function candidateParseCliErrorJson(stderr: string): ReturnType<typeof parseCliErrorJson> {
  const lines = stderr.trim().split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const trimmed = (lines[i] as string).trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as NonNullable<ReturnType<typeof parseCliErrorJson>>;
      if (parsed.ok === false && typeof parsed.command === "string" && typeof parsed.stage === "string") {
        return parsed;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}
{
  const rng = mulberry32(0x51a108);
  const fragments = [
    "error: something failed",
    "  next: retry",
    "{\"ok\":false,\"command\":\"run\",\"stage\":\"parse-args\",\"message\":\"m\",\"next\":\"n\"}",
    "{\"ok\":true}",
    "{ torn json",
    "",
    "plain text line"
  ];
  for (let trial = 0; trial < 4000; trial += 1) {
    const lineCount = Math.floor(rng() * 12);
    const text = Array.from({ length: lineCount }, () => pick(rng, fragments)).join(rng() < 0.5 ? "\n" : "\r\n");
    check(
      "S1-I-6 equivalence",
      JSON.stringify(parseCliErrorJson(text)) === JSON.stringify(candidateParseCliErrorJson(text)),
      JSON.stringify(text)
    );
  }
  const sample = `error: x\n  stage: y\n{"ok":false,"command":"run","stage":"parse-args","message":"m","next":"n"}`;
  const cur = bench(() => void parseCliErrorJson(sample), 40000);
  const cand = bench(() => void candidateParseCliErrorJson(sample), 40000);
  console.log(`S1-I-6 bench: current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns`);
}

/* ============================================================
 * S1-I-7: pi-executor buildInvocation responseText += (S1-E-3 class).
 * Realistic scale anchor: deltas per response.
 * ============================================================ */
{
  const rng = mulberry32(0x51a109);
  const deltas = Array.from({ length: 400 }, () => "token ".repeat(1 + Math.floor(rng() * 5)));
  const concat = () => {
    let text = "";
    for (const d of deltas) text += d;
    return text;
  };
  const parts = () => {
    const out: string[] = [];
    for (const d of deltas) out.push(d);
    return out.join("");
  };
  check("S1-I-7 equivalence", concat() === parts());
  const cur = bench(() => void concat(), 5000);
  const cand = bench(() => void parts(), 5000);
  console.log(
    `S1-I-7 bench (400 deltas): +==${(cur * 1e6).toFixed(0)}ns parts/join=${(cand * 1e6).toFixed(0)}ns per invocation record`
  );
}

/* ============================================================
 * S1-I-8: resolveListedModel custom path builds ALL listed models
 * then finds one. Candidate: find the model config first.
 * ============================================================ */
{
  const custom: CustomProviderConfig = {
    id: PROVIDER_ID,
    baseUrl: "http://localhost:9/v1",
    models: Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, inputCostPerMTok: 1, outputCostPerMTok: 2 }))
  };
  const cur = bench(() => void resolveListedModel(PROVIDER_ID, "m9", [custom]), 40000);
  console.log(`S1-I-8 bench: resolveListedModel custom worst case=${(cur * 1e6).toFixed(0)}ns`);
}

if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```
