MODEL_SLUG=claude-fable-5-thinking-xhigh

# R3-I：CLI / Pi 适配器 / 配置 / 遥测切片第三遍复查报告（Round 1/2 同区之上）

- 基线：`cursor/sota-persistent-opt-83a1` @ `108b638`（含 R1 十区、R2 十区、R3-A/B/C/D/E/F；C 落地了 S3-C）
- 切片：`src/cli/`（13 文件）、`src/pi-adapter/`（7 文件）、`src/config/`（2 文件）、`src/telemetry/`（1 文件），共 4622 行，本轮全部重读
- 前置阅读：README、EXCLUSIONS 全表（含 S3-A/B/C/D/E/F）、round-03/PLAN、round-01/R1-I、round-02/R2-I 全文
- 分支：`cursor/r3-i-cli-third-pass-83a1`
- 模型：`claude-fable-5-thinking-xhigh`

## 结论

**无新更优解落地，零生产代码改动。** 在 S1-I 落地态与完整排除表之上做第三遍全量搜索，
找到 6 个排除表未覆盖的新角度候选，全部经理论 + 确定性仿真（seeded mulberry32，
**两次独立运行 10 项检查 0 失败、结论逐位一致**）裁决后淘汰，新增排除 S3-I-1…S3-I-6。
本轮最重要的正面结论：**切片内唯一的无界规模热路径——`invocations.jsonl` 逐行校验器
`invocationError`（in-slice，`telemetry/model-invocation.ts`）——被证实已无可压缩常数**：
其元组数组循环在 V8 下实测零成本（±0.02–0.12ms@50k 行，抖动带内），每次校准目录构建
~124–127ms@50k 的成本由 JSON.parse 与切片外 `domain/ids.ts` 的 id 校验支配，切片内
再无杠杆。S3-I-4（inspect --json 批量输出）实测**反向更慢**且在导出的 `CliIo` 缝上
调用次数可观察发散（2000 vs 1）；S3-I-3/S3-I-6 各以一个可复现发散反例被
fail-closed 契约判死。R1-I §2 的逐文件下界论证经本轮第三次复核维持成立。

## 0. 范围与约束遵守

- 未重开任何 X\* / S1-\* / S2-\* / S3-\* 条目。逐条对照：
  - S3-I-1 不是 S2-I-3 / S1-I-7 / S1-E-3（那些是字符串构建族）——它是**校验器内
    元组数组分配消除**，且位于无界 invocations.jsonl 路径而非每 invocation 一次的
    执行器路径；排除表无此条，需独立裁决。
  - S3-I-2 不是 S1-I-3（find→Map）也不是任何已记录双构建——`createAgentProfileRegistry(defaultAgentProfiles())`
    在 `--children` 路径构建两次（`parseChildSpec` L296 + 主体 L758）此前从未被立案。
  - S3-I-3 是 S2-I-1（死 loadLearnedRouting）的 **providers.json 姊妹**：普通 run 路径上
    L619 的 `loadProvidersConfig` 只喂 `primaryModelId`/`fastModelId`，二者在普通路径
    是死值——S2-I-1 覆盖的是 learning registry，不覆盖本条，需独立立案后按同标准判死。
  - S3-I-4 不是 X3-2 / S1-F-5（多遍融合噪声族）——它质疑的是输出**调用粒度**，
    S1-F-2（扩展点调用次数可观测）是判据来源但对象不同，独立立案。
  - S3-I-5 不是 S2-I-6（那是 parseProvidersConfig 的融合+双 parse，已连坐关死）——
    本条是 `setDefaultModels` 内同一输入的双 `parseModelRef`，不同函数、无错误序问题，独立立案。
  - S3-I-6 不是 S2-I-4（CLI 预读与 run-plane 重读去重）——它是把存在性检查**降级为
    stat 探针**的提案，攻击面是 fail-closed 读校验本体，独立立案。
- S1-I 落地物零触碰（`smartChildPlan` 返回 catalog 复用维持原样）；凭据面
  （auth/file-credential-store/providers-config）零 diff；CLI 标志、输出契约、退出码不变。
- 双 LCB 与双归因未动；live = R0 等价、R1 未接线 live 维持；不声称 Outcome-supported，
  Checkpoint F-PROD 仍开放（ADR-005）；未改阈值、权限、数据面契约、公开签名。
- `git diff d0677a3..108b638 -- src/cli src/pi-adapter src/config src/telemetry` 为**空**：
  切片自 S1-I 落地以来逐字节未变，无未记录漂移。
- 按「无赢家不写死代码」纪律，裁决仿真脚本未入库（全文见附录），`scripts/` 未新增文件。

## 1. 规模与调用图基底（本轮新核实）

R1-I/R2-I 的规模事实复核不变（invocations.jsonl 无界增长、单次校准构建 ~23ms@10k 行、
children 个位数到几十、auth --all 39 provider）。本轮新增调用图取证与实测：

- **`isInvocation`/`invocationError`（in-slice）是无界日志解析的逐行校验器**：
  `routing/cost-calibration.ts` 的 `loadInvocationsFromStateRoot` 对每行 JSON.parse 后
  调用 `isInvocation`——这是切片内唯一随状态根无界增长的热路径。实测
  校验器整趟 6.4–6.6ms@10k / 31.9–32.4ms@50k，占全载入（22.7–22.9ms@10k /
  124.0–127.0ms@50k）的 ~26–29%；其内部成本由切片外 `domain/ids.ts` 的 4 次
  `isId`（每次 2 个字符串分配 + 正则）与 `isIsoTimestamp`（正则 + Date.parse）支配。
- **潜在 TypeError 路径核实**：合法 JSON 但缺 `config` 字段的行会让
  `invocationError` 在 `config.provider` 解引用处抛 TypeError 并穿透 loader——这是
  既有行为，任何候选替代实现必须逐位保留（fuzz 已覆盖，见 §3）。
- `EventStore.readAll` 对损坏中间行抛 `Corrupt event log line N`（fail-closed）；
  `access()` 探针对同一文件返回存在——S3-I-6 的发散基底。
- `createAgentProfileRegistry(defaultAgentProfiles())` 单次构建 8.3–8.4µs（7 个 profile
  验证 + Map 构建），registry 为无状态冻结查找闭包（复用本可安全，规模判死）。

## 2. 结构下界第三次复核

R1-I §2 逐条重新展开验算，全部维持；本轮补强两条：

| 路径 | 本轮新论证 |
| --- | --- |
| `invocationError` | 对**合法行**（日志主体）所有检查必须全部执行，检查顺序即错误选择契约（先 id 后 config 后 usage），重排对合法行无收益、对非法行改变返回值。唯一在-slice 可动项是元组数组循环——实测 V8 逃逸分析已使其零成本（§3 S3-I-1）。id 校验的字符串分配在 `domain/ids.ts`（切片外），在 telemetry 内联复刻 = X0-5/X1-2 类平行实现，且改不了 JSON.parse 支配项。**结论：per-row 校验已达其在-slice 常数下界。** |
| `inspect --json` 输出循环 | 每事件一次 `io.stdout` 不只是 Ω(打印行数) 工作下界，还是**流式输出契约**：main.ts L1471-1477 显式支持 `inspect --json \| head` 的 EPIPE 快退（下游关闭时首行已到达即退出）；批量 join 把内存从 O(1 行) 变 O(全量) 并推迟首字节。调用粒度在导出的 `CliIo` 缝上可观察（S1-F-2 同标准）。 |

## 3. 候选总表（全部淘汰，无赢家落地）

仿真脚本全文见附录；10 项检查 × 两次独立运行均 0 失败，结论逐位一致，计时方向一致。

| ID | 候选 | 理论 | 仿真/等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S3-I-1 | `invocationError` tokensIn/tokensOut（及 pricing）元组数组循环改直线检查（无界 invocations.jsonl 每行热路径的分配消除） | 每行省 1 个数组 + 2 个元组分配 ×N 行 ×每次校准构建；若成真在 50k 行档可达 ms 级 | ✅ 20000 例对抗 fuzz（含缺 config 的潜在 TypeError 路径、NaN/Infinity/字符串型 usage、pricing/callOutcome/attempt 全变体）返回值与抛出逐位一致 | **实测零收益**：10k 行档 delta +0.02/+0.07ms、50k 行档 −0.02/+0.12ms（两次运行，全部在 ±0.4% 抖动带内）——V8 对不逃逸的 `for...of` 数组字面量已做标量替换，分配从未发生 | 淘汰：可证等价但收益为零（优化目标不存在）；全载入被 JSON.parse + 切片外 id 校验支配 |
| S3-I-2 | `--children` 路径 `createAgentProfileRegistry(defaultAgentProfiles())` 双构建去重（parseChildSpec + startFlowchartRun 依赖各建一次） | 2 次构建 → 1 次；registry 为无状态冻结查找，线程传递可证安全 | ✅ 两次独立构建对全部角色 resolve 出深等值 profile | 单次构建 8.3–8.4µs，每 `--children` 运行恰省一次 | 淘汰：µs 级噪声（S1-I-1 ~190µs 已否决，本条低一个量级） |
| S3-I-3 | 普通 run 死载荷 `loadProvidersConfig`（L619）下沉 track/children 分支（S2-I-1 的 providers.json 姊妹；`loadOptionalPublicPrior` 的 stderr warning 契约已由 R2-I 收口覆盖，不并入） | 普通 fake run 免一次配置读+解析；primaryModelId/fastModelId 在该路径为死值 | ❌ **错误路径发散实证**：损坏 providers.json（`invalid providers.json at …`）今日使普通 fake run 以 exit 1 失败，下沉后将成功执行——与 S2-I-1 完全同型的可观察行为变更 | 一次读 62–64µs，且普通 run 被 `startRun` 整轮执行支配 | 淘汰：错误路径可见发散（S2-I-1/S1-D-7 同标准）+ 亚 ms 噪声，两条任一即足 |
| S3-I-4 | `inspect --json` / `episode events --json` 每事件一次 `io.stdout` 改单次 join 批量输出 | 减少 E 次调用/流写为 1 次 | ✅ 拼接字节一致；❌ **调用数在导出 CliIo 缝上发散**（E=2000：2000 次 vs 1 次，注入 io 的调用方可观察）；流式→缓冲改变 `\| head` EPIPE 时序与内存曲线（O(1 行)→O(全量)） | **实测反向**：E=2000 下 per-line 0.430–0.436ms vs join 0.515–0.522ms——批量**慢 85–86µs**（join 的大字符串拷贝贵于 2000 次直调） | 淘汰：负优化 + 扩展点调用次数可观测（S1-F-2 同标准）+ 流式输出契约（§2） |
| S3-I-5 | `setDefaultModels` 每字段双 `parseModelRef` 消除（primary/fast 各 parse 两次拼规范 id） | 纯函数同输入去重，2 次 → 1 次/字段 | ✅ 平凡等价（同输入同结果/同抛出，无错误序问题——区别于 S2-I-6 的融合） | 双 parse 64–69ns vs 单 parse 41–42ns/字段，set-default 一次性命令共 2 字段 | 淘汰：~25–28ns/字段 深度亚噪声（S1-D-8/S2-I-6 邻域一次性配置命令） |
| S3-I-6 | `answer`/`pause` 存在性预检查 `EventStore.readAll`（O(E) 全读校验）换 stat/access 探针 | O(E)→O(1) 存在性判定 | ❌ **发散实证**：损坏中间行的 events.jsonl 使 readAll 抛 `Corrupt event log line 2`（今日 cliFail exit 1），access 探针对同一文件返回存在、命令继续执行——fail-closed 读校验被绕过 | 重复读 0.36–0.38ms@200 / 2.72–2.82ms@2000 事件，一次性交互命令 | 淘汰：fail-closed 契约违反（X3-3/S1-G-1 族）+ 低于否决线；与 S2-I-4 的去重提案相互独立地双双关死 |

## 4. 关键裁决细节

### 4.1 S3-I-1：本轮最重要候选为何零收益（正面结论）

这是本切片仅存的「理论上随规模无界增长」的在-slice 杠杆：`invocationError` 每次调用
构造 `[["tokensIn", v1], ["tokensOut", v2]]` 数组字面量迭代——直觉上 N=50k 行 ×3 分配
应有 ms 级可省。实测两次运行 delta 全部落在 ±0.4% 抖动带（+0.02 / −0.02 / +0.07 /
+0.12ms），方向不稳定、量级不成立。机理：该数组字面量**不逃逸**当前函数帧，V8
TurboFan 的逃逸分析对其做标量替换（scalar replacement），生产代码里分配从未真实发生
——「省分配」的目标本身不存在。这与 S1-I-7/S2-I-3 的 rope 教训同属一类：**V8 已
优化掉的常数不构成优化余地，必须实测**。等价性本身无可挑剔（20000 例 fuzz 含
潜在 TypeError 路径逐位一致），但「可证等价 + 零收益」= 不动生产代码。

由此收口：invocations.jsonl 载入的 ~26–29% 校验份额由切片外 `domain/ids.ts`
（每 `isId` 2 次字符串分配 + 正则）与 `isIsoTimestamp`（Date.parse）构成，其余
~70% 是 JSON.parse 本体。切片内 telemetry 侧已无常数可压；跨切片改 ids.ts 属
R1-*/域外，且在 telemetry 内联 id 校验 = X0-5/X1-2 类平行实现，一并关死。

### 4.2 S3-I-4：批量输出的三重死因（一条实测 + 两条契约）

- **实测负优化**：E=2000 下批量 join 比逐行调用慢 85–86µs（两次运行同向）。join
  需要先物化一个 ~E×行长 的大字符串（本例 ~200KB），其分配+拷贝成本超过 2000 次
  无操作 sink 调用；真实 `process.stdout.write` 有内部缓冲，逐行写并不逐行 syscall。
- **扩展点可观测**：`main(argv, io)` 是导出 API，`CliIo` 由调用方注入——调用次数
  从 E 次变 1 次是缝上可观察行为变更（S1-F-2 判例：propensityFor 二次调用不可消除）。
- **流式契约**：main.ts 的 EPIPE 处理（L1471-1477）为 `inspect --json | head` 而存在
  ——逐行写让下游尽早收到首行并触发提前退出；批量化把首字节推迟到全量序列化完成，
  内存曲线从 O(1 行) 变 O(全量)，在大事件日志上是纯劣化。

### 4.3 S3-I-3 / S3-I-6：两个 fail-closed 发散反例

二者同属「用更便宜的读法换掉带校验的读法」形态，各被一行式反例判死：
S3-I-3 的反例是损坏 providers.json——今日普通 fake run 在 L619 fail-fast（exit 1 +
结构化 cliFail），下沉后同一坏状态根上 run 正常完成，与 S2-I-1（损坏 learning
registry）逐字同型；S3-I-6 的反例是损坏 events.jsonl 中间行——今日 answer/pause
以 `Corrupt event log line 2` fail-closed，stat 探针版继续执行并向损坏日志**追加**
新事件（更糟）。战役标准下错误路径可见发散一票否决，规模论证（62µs / 2.7ms
一次性）只是第二重保险。

## 5. 逐文件收口（R1-I/R2-I 收口之上的本轮新检查点）

| 文件 | 本轮新检查点 | 结论 |
| --- | --- | --- |
| `telemetry/model-invocation.ts` | S3-I-1（零收益）；缺 config 的潜在 TypeError 穿透 loader 为既有行为，修复属行为变更不属优化；`compareRunToRun`/`invocationError` 下界维持 | 无候选落地 |
| `cli/main.ts` | S3-I-2（双 registry 构建 8.4µs）、S3-I-3（普通路径死 providers 读，发散判死）、S3-I-4（inspect --json 批量，负优化+契约）；S1-I 落地物复核原样 | 无候选落地 |
| `cli/episode.ts` | S3-I-4 同型（events --json 逐行输出）随 S3-I-4 一并关死；锁内 readAll = S1-G-1 域维持 | 无候选落地 |
| `cli/pause.ts` / `inject.ts` | S3-I-6（存在性预检查降级，发散判死）；S2-I-2 维持（校准 router 是消费方） | 无候选落地 |
| `config/providers-config.ts` | S3-I-5（setDefaultModels 双 parseModelRef，~25ns/字段）；S2-I-6 维持；`writeAtomicJson`/save 前 re-validate 契约维持 | 无候选落地 |
| `cli/adapt.ts` / `auth.ts` / `models.ts` / `doctor.ts` / `doctor-overlay.ts` / `commits.ts` / `errors.ts` / `flowchart-io.ts` / `model-catalog.ts` | R1-I/R2-I 全部检查点复核维持（S1-I-1/4/5/6、S2-I-5 等）；无新形态 | 无候选 |
| `pi-adapter/pi-executor.ts` | `createClusterTools` 每 execute 构建 3 个工具对象 = 每次完整模型调用一次的 µs 级、且每调新建即无隐藏状态契约（X1-1 反面），不立案；S1-I-7/S2-I-3 维持 | 无候选 |
| `pi-adapter/runtime.ts` / `auth-session.ts` / `file-credential-store.ts` / `listed-model.ts` / `cluster-tools.ts` / `index.ts` | 每调新建/每操作全读契约维持；动态 import 模块缓存后 O(1) 维持 | 无候选 |
| `config/model-ref.ts` | O(len) 单遍字符串切片下界维持 | 无候选 |

## 6. 前后对比

零代码改动。基线（S1-I 落地态）即本轮终态：`--children` 单趟校准构建维持
（本机复测全载入 22.7–22.9ms@10k / 124.0–127.0ms@50k，与 R1-I 记载同带），残余
候选全部撞契约、实测反向或否决线。切片自 `d0677a3`（S1-I 落地）至基线 `108b638`
逐字节未变（`git diff` 为空）。

## 7. 测试

零代码 diff，基线套件全绿复验（Node 22.22.2，满足 engines >=22.19.0）：

```bash
npx tsx --test "test/unit/cli/*.test.ts" "test/unit/pi-adapter/*.test.ts" \
  "test/unit/config/*.test.ts" "test/unit/telemetry/*.test.ts"
# tests 66 / suites 3 / pass 66 / fail 0
npx tsx --test test/integration/m1/cli-children.test.ts \
  test/integration/m2.5/children-flowchart.test.ts \
  test/integration/cli/cli.test.ts test/integration/cli/public-prior-cli.test.ts
# tests 43 / pass 43 / fail 0
pnpm test  # 全量：1168 pass / 0 fail / 1 skipped（既有 provider-smoke 凭据跳过）
```

裁决仿真（附录全文）两次独立运行 10 项检查 0 失败，等价/发散结论逐位一致，
计时方向逐次一致（S3-I-1 两次均在抖动带；S3-I-4 两次均批量更慢；S3-I-3/6
发散反例两次均复现）。

## 8. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S3-I-1 | invocationError tokens/pricing 元组数组循环改直线检查 | 20000 例 fuzz 等价，但实测零收益（±0.02–0.12ms@50k 行抖动带）——V8 逃逸分析已标量替换该分配；载入被 JSON.parse + 切片外 id 校验支配 |
| S3-I-2 | --children 路径 createAgentProfileRegistry(defaultAgentProfiles()) 双构建去重 | 单次构建 8.3–8.4µs/运行，µs 级噪声 |
| S3-I-3 | 普通 run 死载荷 loadProvidersConfig 下沉 track/children 分支 | 损坏 providers.json 时普通 fake run 的 fail-fast（exit 1）会变为成功——S2-I-1 同型错误路径发散；且 62–64µs 被整轮执行支配 |
| S3-I-4 | inspect --json / episode events --json 每事件 io.stdout 批量合并 | 实测批量慢 85–86µs（大字符串物化）；导出 CliIo 缝调用次数可观测（S1-F-2 标准）；流式→缓冲改变 EPIPE 时序与内存曲线 |
| S3-I-5 | setDefaultModels 每字段双 parseModelRef 消除 | ~25–28ns/字段、一次性配置命令，深度亚噪声 |
| S3-I-6 | answer/pause 存在性预检查 readAll 换 stat/access 探针 | 损坏日志时 fail-closed（`Corrupt event log line N`，exit 1）被绕过且会向损坏日志追加写——契约违反；0.36–2.8ms 一次性亦低于否决线 |

重开条件：S3-I-1 需 V8 逃逸分析行为回退或 ids.ts 校验迁入本切片（届时重测整体
常数）；S3-I-2/5 需先给出非噪声场景；S3-I-3 需规格明确普通 run 对配置面坏态的
容忍语义（与 S2-I-1 重开条件联动）；S3-I-4 需 CliIo 契约显式允许批量粒度且
流式消费场景被放弃；S3-I-6 需存在性判定获得独立于事件读取的声明契约。

MORE_OPTIMA=no
BRANCH=cursor/r3-i-cli-third-pass-83a1

## 附录：确定性裁决仿真脚本（完整，可复现）

保存为 `scripts/round03-r3i-decision-sim.ts` 后
`npx tsx scripts/round03-r3i-decision-sim.ts` 运行（仓库根目录，依赖已装，
Node ≥22.19）。无赢家，按战役纪律不入库，报告内嵌全文。
seeds：`0x53a101`–`0x53a108`。

```ts
/**
 * Round-3 R3-I adjudication simulation (temporary — embedded in the R3-I
 * report appendix; committed only if a winner lands, per campaign rule).
 *
 * Third pass over the CLI / pi-adapter / config / telemetry slice on top of
 * the landed S1-I baseline and the full exclusion table (X*, S1-*, S2-*,
 * S3-A/B/C/D/E/F). Adjudicates six fresh candidates not covered by any
 * existing exclusion ID:
 *
 *   S3-I-1  telemetry invocationError: replace the tokensIn/tokensOut (and
 *           pricing) tuple-array loops with straight-line checks. This is the
 *           per-line validator on the UNBOUNDED invocations.jsonl load that
 *           dominates every calibrated catalog build (~20ms@10k rows). Fuzz
 *           exact return-value equivalence (including the latent
 *           missing-config TypeError path, which must be preserved) + bench
 *           the validator and the full load replica at 10k/50k rows.
 *   S3-I-2  run --children builds createAgentProfileRegistry(
 *           defaultAgentProfiles()) twice (parseChildSpec + startFlowchartRun
 *           deps). Registry is a stateless frozen-lookup closure so threading
 *           one through is safe; bench one build to size the saving.
 *   S3-I-3  plain run (no --track/--children/--flowchart) dead-loads
 *           providers.json (primaryModelId/fastModelId are never used on that
 *           path when the executor is fake). Sibling of the excluded S2-I-1
 *           (dead loadLearnedRouting): prove the corrupt-providers.json
 *           error-path divergence + bench one load.
 *   S3-I-4  inspect --json / episode events --json emit one io.stdout call
 *           per event; candidate batches into one join. Demonstrate the
 *           CliIo call-count observability at the exported seam and bench the
 *           in-process delta (the streaming/EPIPE contract is the main kill).
 *   S3-I-5  providers-config setDefaultModels parses each of primary/fast
 *           TWICE with parseModelRef to format the canonical id. Dedup is
 *           trivially equivalent (pure function, same input); bench the ns.
 *   S3-I-6  answer/pause existence pre-check uses EventStore.readAll (full
 *           O(E) fail-closed read); candidate swaps a stat/access existence
 *           probe. Prove the corrupt-log divergence (today exit 1, candidate
 *           would proceed) + bench the duplicate share.
 *
 * Deterministic: seeded mulberry32 for every generated fixture (seeds
 * 0x53a101–0x53a108). Timings are informational; equivalence/divergence
 * conclusions must be bitwise identical across independent runs. Run with:
 *   npx tsx scripts/round03-r3i-decision-sim.ts
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { runtimeRoot } from "../src/privacy/state-layout.js";
import {
  invocationError,
  isInvocation,
  INVOCATION_CALL_OUTCOMES,
  type ModelInvocation
} from "../src/telemetry/model-invocation.js";
import { isAgentInstanceId, isInvocationId, isRunId, isTaskId, parseRunId } from "../src/domain/ids.js";
import { isIsoTimestamp } from "../src/domain/timestamp.js";
import { loadInvocationsFromStateRoot } from "../src/routing/cost-calibration.js";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../src/agents/registry.js";
import { AGENT_ROLES } from "../src/domain/roles.js";
import { loadProvidersConfig } from "../src/config/providers-config.js";
import { parseModelRef } from "../src/config/model-ref.js";
import { EventStore } from "../src/run/event-store.js";
import { createEventId, parseMessageId } from "../src/domain/ids.js";
import { nowIso } from "../src/domain/timestamp.js";
import type { Event } from "../src/run/events.js";

let checks = 0;
let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  checks += 1;
  if (!ok) {
    failures += 1;
    console.error(`FAIL: ${label}${detail === undefined ? "" : ` — ${detail}`}`);
  }
}
function out(line: string): void {
  console.log(line);
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
 * Shared fixture pieces (same corpus shape as the R1-I/R2-I sims).
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
  if (roll < 0.03) return "{ this line is torn";
  const modelIdx = Math.floor(rng() * MODEL_IDS.length);
  const matching = rng() < 0.5;
  const invalid = roll < 0.06;
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
    responseHash: (((index * 2654435761) % 0xffffffff) >>> 0).toString(16),
    tokensIn: rng() < 0.9 ? Math.floor(rng() * 100000) : undefined,
    tokensOut: rng() < 0.9 ? 1 + Math.floor(rng() * 8000) : undefined,
    latencyMs: Math.floor(rng() * 60000),
    occurredAt: new Date(1756000000000 + index * 1000).toISOString(),
    ...(rng() < 0.2 ? { attempt: 1 + Math.floor(rng() * 3) } : {}),
    ...(rng() < 0.15 ? { callOutcome: pick(rng, INVOCATION_CALL_OUTCOMES) } : {}),
    ...(rng() < 0.1
      ? {
          pricing: {
            catalogVersion: "cat-v1",
            inputUsdPerMTok: 0.5,
            outputUsdPerMTok: 1.5
          }
        }
      : {})
  };
  return JSON.stringify(row);
}

function makeStateRoot(n: number, seed: number): string {
  const root = mkdtempSync(join(tmpdir(), `r3i-sim-${n}-`));
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
 * Part A — S3-I-1: invocationError straight-line token/pricing checks
 * ============================================================ */
const HASH_PATTERN = /^[0-9a-f]{1,8}$/;

/** Candidate replica: identical semantics, tuple-array loops unrolled. */
function candidateInvocationError(inv: ModelInvocation): string | undefined {
  if (!isInvocationId(inv.id)) {
    return `invalid invocation id: ${String(inv.id)}`;
  }
  if (!isTaskId(inv.taskId)) {
    return `invalid taskId: ${String(inv.taskId)}`;
  }
  if (!isRunId(inv.runId)) {
    return `invalid runId: ${String(inv.runId)}`;
  }
  if (!isAgentInstanceId(inv.agentInstanceId)) {
    return `invalid agentInstanceId: ${String(inv.agentInstanceId)}`;
  }
  const { config } = inv;
  if (typeof config.provider !== "string" || config.provider.trim() === "") {
    return "config.provider is required";
  }
  if (typeof config.model !== "string" || config.model.trim() === "") {
    return "config.model is required";
  }
  if (config.modelVersion !== undefined && config.modelVersion.trim() === "") {
    return "config.modelVersion must not be empty when present";
  }
  if (typeof config.parameterHash !== "string" || !HASH_PATTERN.test(config.parameterHash)) {
    return `invalid parameterHash: ${String(config.parameterHash)}`;
  }
  if (typeof inv.responseHash !== "string" || !HASH_PATTERN.test(inv.responseHash)) {
    return `invalid responseHash: ${String(inv.responseHash)}`;
  }
  if (inv.tokensIn !== undefined && (!Number.isInteger(inv.tokensIn) || inv.tokensIn < 0)) {
    return "tokensIn must be a non-negative integer when present";
  }
  if (inv.tokensOut !== undefined && (!Number.isInteger(inv.tokensOut) || inv.tokensOut < 0)) {
    return "tokensOut must be a non-negative integer when present";
  }
  if (!Number.isFinite(inv.latencyMs) || inv.latencyMs < 0) {
    return "latencyMs must be a non-negative finite number";
  }
  if (!isIsoTimestamp(inv.occurredAt)) {
    return "occurredAt must be an ISO timestamp";
  }
  if (inv.attempt !== undefined && (!Number.isInteger(inv.attempt) || inv.attempt < 1)) {
    return "attempt must be an integer >= 1 when present";
  }
  if (inv.cacheHit !== undefined && typeof inv.cacheHit !== "boolean") {
    return "cacheHit must be a boolean when present";
  }
  if (inv.callOutcome !== undefined && !INVOCATION_CALL_OUTCOMES.includes(inv.callOutcome)) {
    return `invalid callOutcome: ${String(inv.callOutcome)}`;
  }
  if (inv.pricing !== undefined) {
    if (typeof inv.pricing.catalogVersion !== "string" || inv.pricing.catalogVersion.trim() === "") {
      return "pricing.catalogVersion is required when pricing is present";
    }
    const input = inv.pricing.inputUsdPerMTok;
    if (input !== undefined && (!Number.isFinite(input) || input < 0)) {
      return "pricing.inputUsdPerMTok must be a non-negative finite number when present";
    }
    const output = inv.pricing.outputUsdPerMTok;
    if (output !== undefined && (!Number.isFinite(output) || output < 0)) {
      return "pricing.outputUsdPerMTok must be a non-negative finite number when present";
    }
  }
  return undefined;
}

function outcomeOf(fn: () => string | undefined): { threw: boolean; value: string } {
  try {
    const value = fn();
    return { threw: false, value: String(value) };
  } catch (error) {
    return { threw: true, value: error instanceof Error ? error.constructor.name : "unknown" };
  }
}

function fuzzInvocation(rng: () => number): unknown {
  const tokenPool: unknown[] = [undefined, 0, 1234, -1, 3.5, Number.NaN, "10", Number.MAX_SAFE_INTEGER];
  const pricingNumberPool: unknown[] = [undefined, 0, 1.5, -0.1, Number.NaN, Number.POSITIVE_INFINITY];
  const base: Record<string, unknown> = {
    id: pick(rng, ["inv_ok1", "bad", 42, "inv_", "inv_ok2"]),
    taskId: pick(rng, ["tsk_ok", "nope", undefined]),
    runId: pick(rng, ["run_ok", "run_", null]),
    agentInstanceId: pick(rng, ["agt_ok", "agent-1"]),
    responseHash: pick(rng, ["abc123", "ZZZ", "", 7]),
    tokensIn: pick(rng, tokenPool),
    tokensOut: pick(rng, tokenPool),
    latencyMs: pick(rng, [0, 150, -3, Number.NaN, Number.POSITIVE_INFINITY]),
    occurredAt: pick(rng, ["2026-08-24T00:00:00.000Z", "not-a-date", "2026-13-45T99:99:99Z", 5]),
    ...(rng() < 0.5 ? { attempt: pick(rng, [1, 0, 2.5, -1, "1"]) } : {}),
    ...(rng() < 0.5 ? { cacheHit: pick(rng, [true, false, "yes", 1]) } : {}),
    ...(rng() < 0.5 ? { callOutcome: pick(rng, ["ok", "timeout", "weird", 3]) } : {}),
    ...(rng() < 0.6
      ? {
          pricing: {
            catalogVersion: pick(rng, ["cat-v1", "", 9]),
            inputUsdPerMTok: pick(rng, pricingNumberPool),
            outputUsdPerMTok: pick(rng, pricingNumberPool)
          }
        }
      : {})
  };
  // 10% of cases omit config entirely to pin the latent TypeError path;
  // the rest carry a config record with mixed-validity fields.
  if (rng() < 0.1) return base;
  return {
    ...base,
    config: {
      provider: pick(rng, [PROVIDER_ID, "", 4]),
      model: pick(rng, ["sim-a", "", undefined]),
      modelVersion: pick(rng, [undefined, "v1", ""]),
      parameterHash: pick(rng, ["abc123", "ZZZZ", "", undefined])
    }
  };
}

async function partA(): Promise<void> {
  // A.1 fuzz equivalence: exact return value (or exact throw class) parity.
  const rng = mulberry32(0x53a101);
  let typeErrorCases = 0;
  for (let i = 0; i < 20000; i += 1) {
    const inv = fuzzInvocation(rng) as ModelInvocation;
    const cur = outcomeOf(() => invocationError(inv));
    const cand = outcomeOf(() => candidateInvocationError(inv));
    if (cur.threw) typeErrorCases += 1;
    if (cur.threw !== cand.threw || cur.value !== cand.value) {
      check("A.1 fuzz equivalence", false, `${JSON.stringify(inv)} -> ${cur.value} vs ${cand.value}`);
      break;
    }
  }
  check("A.1 fuzz equivalence (20000 adversarial invocations)", failures === 0);
  check("A.1 latent missing-config throw path exercised on both sides", typeErrorCases > 0);

  // A.2 corpus equivalence + validator-only bench at unbounded-log scale.
  for (const [n, reps] of [
    [10000, 30],
    [50000, 8]
  ] as const) {
    const corpusRng = mulberry32(0x53a102 + n);
    const parsedRows: unknown[] = [];
    for (let i = 0; i < n; i += 1) {
      const line = invocationLine(corpusRng, i);
      try {
        parsedRows.push(JSON.parse(line));
      } catch {
        /* torn line: loader skips before validation */
      }
    }
    let agree = true;
    for (const row of parsedRows) {
      const cur = isInvocation(row);
      const cand =
        typeof row === "object" && row !== null && candidateInvocationError(row as ModelInvocation) === undefined;
      if (cur !== cand) {
        agree = false;
        break;
      }
    }
    check(`A.2 corpus equivalence N=${n}`, agree);
    const curMs = bench(() => {
      for (const row of parsedRows) isInvocation(row);
    }, reps);
    const candMs = bench(() => {
      for (const row of parsedRows) {
        if (typeof row === "object" && row !== null) candidateInvocationError(row as ModelInvocation);
      }
    }, reps);
    out(
      `part A: N=${n} rows — validator pass current=${curMs.toFixed(2)}ms candidate=${candMs.toFixed(2)}ms ` +
        `(delta=${(curMs - candMs).toFixed(2)}ms per calibrated catalog build)`
    );
  }

  // A.3 end-to-end load share so the delta can be read against the whole.
  for (const [n, reps] of [
    [10000, 10],
    [50000, 4]
  ] as const) {
    const root = makeStateRoot(n, 0x53a103);
    try {
      const loadMs = await benchAsync(async () => {
        await loadInvocationsFromStateRoot(root);
      }, reps);
      out(`part A: N=${n} rows — full loadInvocationsFromStateRoot=${loadMs.toFixed(2)}ms (JSON.parse + validate)`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

/* ============================================================
 * Part B — S3-I-2: --children double default-profile-registry build
 * ============================================================ */
function partB(): void {
  const first = createAgentProfileRegistry(defaultAgentProfiles());
  const second = createAgentProfileRegistry(defaultAgentProfiles());
  let identical = true;
  for (const role of AGENT_ROLES) {
    if (!first.has(role) && !second.has(role)) continue;
    if (JSON.stringify(first.resolve(role)) !== JSON.stringify(second.resolve(role))) identical = false;
  }
  check("B two independent builds resolve identical profiles (reuse is safe)", identical);
  const one = bench(() => {
    createAgentProfileRegistry(defaultAgentProfiles());
  }, 5000);
  out(
    `part B: one createAgentProfileRegistry(defaultAgentProfiles()) build=${(one * 1e3).toFixed(1)}us ` +
      `-> dedupe saves ${(one * 1e3).toFixed(1)}us per --children run`
  );
}

/* ============================================================
 * Part C — S3-I-3: plain-run dead providers.json load
 * ============================================================ */
async function partC(): Promise<void> {
  // C.1 corrupt providers.json: today the plain fake run fails at the L619
  // load (before any executor work); after the sink it would start the run.
  {
    const root = makeStateRoot(0, 0x53a104);
    try {
      writeFileSync(join(runtimeRoot(root), "providers.json"), "{ torn providers", "utf8");
      let threw: string | undefined;
      try {
        await loadProvidersConfig(root);
      } catch (error) {
        threw = error instanceof Error ? error.message : String(error);
      }
      check(
        "C.1 corrupt providers.json throws on today's plain path (candidate sink would not)",
        threw !== undefined && /invalid providers\.json/.test(threw),
        threw
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  // C.2 saving upper bound = one load on a realistic config.
  {
    const root = makeStateRoot(0, 0x53a105);
    try {
      const one = await benchAsync(async () => {
        await loadProvidersConfig(root);
      }, 500);
      out(`part C: one loadProvidersConfig=${(one * 1e3).toFixed(0)}us per plain run (dead on that path)`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

/* ============================================================
 * Part D — S3-I-4: inspect --json per-event io.stdout batching
 * ============================================================ */
function partD(): void {
  const rng = mulberry32(0x53a106);
  const events = Array.from({ length: 2000 }, (_, i) => ({
    id: `evt_${i.toString(16)}`,
    type: pick(rng, ["RUN_STARTED", "TASK_STARTED", "MESSAGE_SENT", "TASK_COMPLETED"]),
    payload: { seq: i, note: "n".repeat(1 + Math.floor(rng() * 40)) }
  }));
  // D.1 observability at the exported CliIo seam: call counts differ.
  let perLineCalls = 0;
  let batchedCalls = 0;
  const collectPerLine: string[] = [];
  const collectBatched: string[] = [];
  const ioPerLine = { stdout: (t: string) => { perLineCalls += 1; collectPerLine.push(t); } };
  const ioBatched = { stdout: (t: string) => { batchedCalls += 1; collectBatched.push(t); } };
  for (const event of events) ioPerLine.stdout(`${JSON.stringify(event)}\n`);
  ioBatched.stdout(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  check("D.1 byte-identical concatenated output", collectPerLine.join("") === collectBatched.join(""));
  check(
    "D.1 CliIo call count diverges at the exported seam (2000 vs 1)",
    perLineCalls === 2000 && batchedCalls === 1
  );
  // D.2 in-process delta on a null sink (stream/syscall cost excluded — the
  // per-line path additionally streams incrementally, which batching loses).
  const sink = { stdout: (_t: string) => undefined };
  const per = bench(() => {
    for (const event of events) sink.stdout(`${JSON.stringify(event)}\n`);
  }, 200);
  const batched = bench(() => {
    sink.stdout(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  }, 200);
  out(
    `part D: E=2000 events — per-line io.stdout=${per.toFixed(3)}ms batched-join=${batched.toFixed(3)}ms ` +
      `(delta=${((per - batched) * 1e3).toFixed(0)}us per inspect --json)`
  );
}

/* ============================================================
 * Part E — S3-I-5: setDefaultModels double parseModelRef per field
 * ============================================================ */
function partE(): void {
  const id = "simprov/sim-c";
  const twice = () => `${parseModelRef(id).providerId}/${parseModelRef(id).modelId}`;
  const once = () => {
    const ref = parseModelRef(id);
    return `${ref.providerId}/${ref.modelId}`;
  };
  check("E dedup is value-equivalent (pure function, same input)", twice() === once());
  const cur = bench(() => void twice(), 100000);
  const cand = bench(() => void once(), 100000);
  out(
    `part E: canonical-id build twice-parse=${(cur * 1e6).toFixed(0)}ns single-parse=${(cand * 1e6).toFixed(0)}ns ` +
      `per field (set-default touches 2 fields once per command)`
  );
}

/* ============================================================
 * Part F — S3-I-6: answer/pause existence pre-check readAll -> stat
 * ============================================================ */
async function partF(): Promise<void> {
  const rng = mulberry32(0x53a107);
  // F.1 corrupt event log: today answer/pause fail closed (readAll throws
  // "Corrupt event log line N" -> cliFail exit 1); a stat/access existence
  // probe would succeed and let the command proceed.
  {
    const root = makeStateRoot(0, 0x53a108);
    try {
      const runId = parseRunId("run_r3icorrupt01");
      const runDir = join(runtimeRoot(root), "runs", runId);
      mkdirSync(runDir, { recursive: true });
      const good = {
        id: createEventId(),
        schemaVersion: 1,
        occurredAt: nowIso(),
        runId,
        type: "USER_ANSWER",
        actor: "cli",
        payload: { messageId: parseMessageId("msg_r3i0"), answer: "a" }
      } as Event;
      writeFileSync(join(runDir, "events.jsonl"), `${JSON.stringify(good)}\n{ torn line\n${JSON.stringify(good)}\n`, "utf8");
      let threw: string | undefined;
      try {
        await new EventStore(root, runId).readAll();
      } catch (error) {
        threw = error instanceof Error ? error.message : String(error);
      }
      let statSaysExists = false;
      try {
        await access(join(runDir, "events.jsonl"));
        statSaysExists = true;
      } catch {
        statSaysExists = false;
      }
      check(
        "F.1 corrupt log: readAll fails closed while a stat probe passes (divergence)",
        threw !== undefined && /Corrupt event log line 2/.test(threw) && statSaysExists,
        threw
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  // F.2 duplicate share = one readAll per interactive command.
  for (const eCount of [200, 2000]) {
    const root = makeStateRoot(0, 0x53a108 + eCount);
    try {
      const runId = parseRunId("run_r3ibench0001");
      const runDir = join(runtimeRoot(root), "runs", runId);
      mkdirSync(runDir, { recursive: true });
      const lines: string[] = [];
      for (let i = 0; i < eCount; i += 1) {
        const event = {
          id: createEventId(),
          schemaVersion: 1,
          occurredAt: nowIso(),
          runId,
          type: "USER_ANSWER",
          actor: "cli",
          payload: { messageId: parseMessageId(`msg_r3i${i.toString(16)}`), answer: `answer ${Math.floor(rng() * 1e6)}` }
        } as Event;
        lines.push(JSON.stringify(event));
      }
      writeFileSync(join(runDir, "events.jsonl"), `${lines.join("\n")}\n`, "utf8");
      const store = new EventStore(root, runId);
      const one = await benchAsync(async () => {
        await store.readAll();
      }, eCount === 200 ? 100 : 20);
      out(`part F: E=${eCount} events — existence pre-check via readAll=${one.toFixed(2)}ms per answer/pause command`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

await partA();
partB();
await partC();
partD();
partE();
await partF();

out(`\ntotal: ${checks} checks, ${failures} failures`);
if (failures > 0) process.exit(1);
```

仿真原始输出（两次独立运行；等价/发散结论逐位一致，计时方向一致）：

```
# run 1
part A: N=10000 rows — validator pass current=6.59ms candidate=6.57ms (delta=0.02ms per calibrated catalog build)
part A: N=50000 rows — validator pass current=32.40ms candidate=32.42ms (delta=-0.02ms per calibrated catalog build)
part A: N=10000 rows — full loadInvocationsFromStateRoot=22.85ms (JSON.parse + validate)
part A: N=50000 rows — full loadInvocationsFromStateRoot=127.00ms (JSON.parse + validate)
part B: one createAgentProfileRegistry(defaultAgentProfiles()) build=8.4us -> dedupe saves 8.4us per --children run
part C: one loadProvidersConfig=62us per plain run (dead on that path)
part D: E=2000 events — per-line io.stdout=0.436ms batched-join=0.522ms (delta=-86us per inspect --json)
part E: canonical-id build twice-parse=69ns single-parse=42ns per field (set-default touches 2 fields once per command)
part F: E=200 events — existence pre-check via readAll=0.36ms per answer/pause command
part F: E=2000 events — existence pre-check via readAll=2.72ms per answer/pause command

total: 10 checks, 0 failures

# run 2
part A: N=10000 rows — validator pass current=6.47ms candidate=6.40ms (delta=0.07ms per calibrated catalog build)
part A: N=50000 rows — validator pass current=32.03ms candidate=31.91ms (delta=0.12ms per calibrated catalog build)
part A: N=10000 rows — full loadInvocationsFromStateRoot=22.65ms (JSON.parse + validate)
part A: N=50000 rows — full loadInvocationsFromStateRoot=123.99ms (JSON.parse + validate)
part B: one createAgentProfileRegistry(defaultAgentProfiles()) build=8.3us -> dedupe saves 8.3us per --children run
part C: one loadProvidersConfig=64us per plain run (dead on that path)
part D: E=2000 events — per-line io.stdout=0.430ms batched-join=0.515ms (delta=-85us per inspect --json)
part E: canonical-id build twice-parse=64ns single-parse=41ns per field (set-default touches 2 fields once per command)
part F: E=200 events — existence pre-check via readAll=0.38ms per answer/pause command
part F: E=2000 events — existence pre-check via readAll=2.82ms per answer/pause command

total: 10 checks, 0 failures
```
