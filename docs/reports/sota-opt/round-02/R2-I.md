MODEL_SLUG=claude-fable-5-thinking-xhigh

# R2-I：CLI / Pi 适配器 / 配置 / 遥测切片复查报告（Round 1 同区第二遍）

- 基线：最新 `cursor/sota-persistent-opt-83a1` @ `ac50051`（含 S1-I 已落地）
- 切片：`src/cli/`（13 文件）、`src/pi-adapter/`（7 文件）、`src/config/`（2 文件）、`src/telemetry/`（1 文件）——本轮全部重读
- 前置阅读：README、EXCLUSIONS（含 S2-A/B/C/D/E/F 新增）、round-02/PLAN、round-01/R1-I 全文
- 分支：`cursor/r2-i-sota-opt-7b6c`
- 模型：`claude-fable-5-thinking-xhigh`

## 结论

**无新更优解落地，零代码改动。** 自 S1-I 落地（`d0677a3`）后切片零 diff，本轮是对同一
代码在完整排除表（X\* + S1-\* + S2-A/B/C/D/E/F）之上的第二遍搜索。找到 6 个排除表
未覆盖的新候选（含 2 个 R1-I 首遍漏检的结构性发现：普通 `run` 路径上的死载荷
`loadLearnedRouting`、`pause`/`inject` 每命令一次的完整校准 router 构建），全部经理论 +
确定性仿真（seeded mulberry32，三次独立运行方向一致）裁决后淘汰，新增排除
S2-I-1…S2-I-6。其中 S2-I-3（buildInvocation toolNames 提升）实测**反向更慢 2.2–2.7×**，
第三次坐实 S1-E-3/S1-I-7 的 V8 rope 教训；S2-I-6（parseProvidersConfig 双遍融合）被
2000 例 fuzz 抓出 203 例错误选择发散——**非保行为**。R1-I 的逐文件下界论证经本轮
复核后维持成立。

## 0. 范围与约束遵守

- 未重开任何 X\* / S1-\* / S2-\* 条目。每个新候选先对照全表：S2-I-1 不是 S1-I-2/4
  （providers.json 重读噪声）——它是**死载荷消除**（调用结果被丢弃）；S2-I-2 不是
  S1-I-1（未校准构建去重）——它质疑的是 pause/inject 是否需要校准 router 本体；
  S2-I-4 不是 S1-G-1（store 增量缓存）——它是 CLI 预读与 run-plane 重读的跨模块
  去重提案。逐条论证见 §3。
- CLI 标志、输出契约、退出码、凭据面零触碰（零代码 diff）。
- 仿真临时脚本按战役纪律不入库（附录内嵌全文，seeds `0x52a101`–`0x52a108`）。

## 1. 现实规模测量（门槛证据基底）

R1-I 的规模事实（invocations.jsonl 无界增长、单次校准构建 ~23ms@10k 行、
children 个位数到几十、auth --all 39 provider）经复核不变。本轮补充实测：

```text
loadLearnedRouting: 28-29us（全新 state root，ENOENT 快路径）
loadLearnedRouting: 464-478us（51 个 routing-policy 基线的长期 registry）
createCalibratedCliModelRouter: 0.36-0.38ms@N=0 / 5.9-6.2ms@N=2000 / 22.9-23.9ms@N=10000
EventStore.readAll: 0.37-0.52ms@200 事件 / 2.9-3.1ms@2000 事件
doctor 三项异步检查串行 184-200us，并行 121-131us
parseProvidersConfig 现实配置 0.9-1.3us/次
```

## 2. 结构下界复核

R1-I §2 的逐条下界论证（parseChildSpec 校验链=契约、FileCredentialStore 每操作
全读=fail-closed、doctor 每检查一次 I/O=语义本体、buildInvocation Ω(事件数) 单遍、
compareRunToRun O(n+m) Map 单遍等）逐条重新展开验算，无漏记嵌套因子，全部
维持。本轮新视角只在**调用图层面**找到重复/死载荷形态候选（S2-I-1/2/4），均被
错误契约、切片外公开签名或一次性交互规模否决。

## 3. 候选总表（全部淘汰，无赢家落地）

仿真脚本全文见附录；6 项检查 0 失败，三次独立运行方向一致。

| ID | 候选 | 理论 | 仿真/等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S2-I-1 | `runCommand` 普通路径（无 --children/--track/--flowchart)上 `loadLearnedRouting` 结果从未被使用，下沉进 `--children` 分支 | 死载荷消除：普通 run 免一次 registry 读+解析+restore；children 路径逐字搬移（无副作用只读函数） | ✅ children 路径确定性重载逐字节一致；❌ **错误路径发散实证**：损坏 registry（`invalid registry snapshot`）今日使普通 run 以 exit 1 失败，候选后将成功——可观察行为变更 | 全新 root 28µs、51 基线长期 registry 464-478µs/次；且普通 run 被执行器（fake 亦整轮 run，pi 数分钟）支配 | 淘汰：错误路径可见发散（S1-D-7/S1-E-1 同标准）+ 亚 ms 噪声，两条任一即足 |
| S2-I-2 | `pause`/`inject` 命令用未校准或惰性 router 替代 `createCalibratedCliModelRouter`（免整趟 invocations.jsonl 解析） | 一次性省 0.4ms@N=0 → 23.9ms@N=10k（随日志线性） | ❌ **inject 非等价**：`injectFlowchartRun` 经 `applyInjection→advanceRound→router.route`（flowchart-supervisor L684）真实消费 router，换 router 即换路由决策；pause 今日不路由但无「pause 不路由」契约，依赖跨模块隐式不变式 | 一次性交互命令 ~23ms@10k 亚感知（S1-I-5 的 10-12ms 同带被否）；懒代理=隐藏状态（X1-1 域） | 淘汰：非等价（inject）+ 契约脆弱（pause）+ 亚感知一次性 |
| S2-I-3 | `buildInvocation` 中 `toolNames map+sort(+join)` 与 parameterHash 静态后缀提升到构造期 | 每 invocation 免 O(T log T) 排序 + 后缀拼接（identity 随请求变化，只能提升后缀） | ✅ 提升后 hash 逐位一致 | **实测反向**：current 5.4-6.1µs vs hoisted 13.7-14.8µs——慢 2.2-2.7×（预平化大字符串嵌入模板的 rope 行为），且一次 invocation = 一次完整模型调用（百 ms–分钟级） | 淘汰：负优化（三次全反向），第三次坐实 S1-E-3/S1-I-7 的 V8 字符串教训 |
| S2-I-4 | resume/answer/inspect 的 CLI 预读 events+checkpoint 与 `resumeFlowchartRun`/`inspectRun` 内部重读去重（线程传参） | 每命令免一次 O(E) 事件重读 | —（CLI 侧预读本身不可省：存在性 cliFail 文案、`requireDurableFlowchartCheckpoint`、pause 状态检查都消费它） | 重复读 0.37-0.52ms@200 / 2.9-3.1ms@2000 事件，一次性交互命令 | 淘汰：去重需改 `src/run/` 公开签名（S2-D-4 类切片外+签名变更）+ run-plane 边界自读持久态是 fail-closed 契约（X3-3/S1-G-1 同族）+ 低于否决线 |
| S2-I-5 | doctor 异步检查 Promise.all 并行化 | 三项 I/O 检查重叠等待 | —（输出顺序由 checks 数组保持，可证一致） | 串行 184-200µs vs 并行 121-131µs，省 53-75µs/次 | 淘汰：S1-E-5 同类（并行非复杂度下降）+ 亚噪声 |
| S2-I-6 | `parseProvidersConfig` enabled `every`+`map` 双遍融合 + primary/fast 双 `parseModelRef` 消除 | 常数遍数 2→1 + 免重复纯调用 | ❌ **2000 例 fuzz 抓出 203 例发散**：混合非法（如 `["bad-format", 42]`）时现行先全量类型检查报数组错，融合后先报首个格式错——错误选择契约变更 | 有效配置 0.9-1.3µs vs 0.76µs/次，ns 级 | 淘汰：非保行为（错误消息即输出契约，X0-5 同标准）+ S1-C-8 常数遍数噪声 |

## 4. 关键裁决细节

### 4.1 S2-I-1：R1-I 漏检的死载荷为何仍不落地

这是本轮最接近落地形态的候选——`main.ts` L713 的
`const learned = await loadLearnedRouting(stateRoot, projectRoot)` 在 `--track` 提前返回
之后、`--children` 分支之前无条件执行，而普通路径（直落 L812 `startRun`）从不引用
`learned`。下沉进 children 分支在成功路径上逐字等价（只读、无副作用、无输出）。
淘汰理由两条独立：

1. **错误路径可见发散（主因）**：`loadLearnedRouting` 对损坏 registry
   （`invalid registry snapshot`）与内容哈希失配（`active routing-policy content hash
   mismatch`）抛 `DomainValidationError`。今日普通 `run` 会在启动前以结构化
   cliFail（exit 1）失败；候选后同一状态下 run 正常执行完成。战役标准
   （S1-D-7「抛错次序可观察发散」、S1-E-1）下这是行为变更，且现状的
   fail-fast 语义在坏状态根上有防护价值——不属「可证无害」。
2. **规模**：即使 51 基线的长期 registry 也只 ~478µs/次，而普通 run 路径被
   `startRun` 全流程（事件写盘、执行器整轮）支配。fail-soft 化（catch 后继续）
   则直接改变可观察 stderr/退出码，同样非保行为。

重开条件：若未来规格明确「普通 run 不消费适应面且不应因适应面坏态失败」，
本候选连同其错误语义可一并重裁。

### 4.2 S2-I-2：pause/inject 的校准构建是消费方而非重复

R1-I 的 S1-I 消除的是**同一次运行内字面相同的第二次构建**；本轮检查 pause/inject
时发现的是另一形态——每命令一次、无重复，问题只在「是否需要校准」。裁决取证：
`injectFlowchartRun` 注入后 `advanceRound()` 可调度节点并调用
`this.router.route({...})`（flowchart-supervisor.ts L684），路由决策进入事件与
checkpoint——换未校准 router 直接改变可持久化行为，**非等价**。`pauseFlowchartRun`
今日路径确实不调用 route()，但「pause 永不路由」不是任何模块的声明契约，
依赖它属跨模块隐式不变式（S2-A-3「跨函数耦合」同类）；惰性构造代理则是
X1-1 域的隐藏状态。绝对量上 23ms@10k 行的一次性交互成本与 S1-I-5 被否的
10-12ms 同带。三重独立否决。

### 4.3 S2-I-3：第三次 rope 反向

理论上把 `tools.map(t=>t.name).sort()` 与 `join(",")|systemPrompt` 后缀提升到构造期
应省每 invocation 的排序+拼接。实测三次全部反向（5.4-6.1µs vs 13.7-14.8µs）：把
~1.7KB 的预平化后缀嵌入模板字面量迫使 V8 走大字符串拼接路径，而现行小段
模板由 StringBuilder 直接平化。叠加「一次 invocation = 一次完整网络模型调用」的
规模锚点，此候选即使正向也深陷亚噪声。S1-E-3（~230ns）→ S1-I-7（慢 6.4×）→
本条（慢 2.2-2.7×），该家族证据已三重加固。

### 4.4 S2-I-6：融合被 fuzz 判死

`parseProvidersConfig` 对 `enabled` 先 `every(typeof string)` 后 `map(parseModelRef)`，
错误选择语义是「先报数组级类型错，再报首个格式错」。融合单遍无法在不预扫
类型的前提下保持该次序：2000 例确定性 fuzz 中 203 例（10.2%）错误消息发散
（如 `["bad-format", 42]`：现行报 `enabled must be an array of catalog ids`，融合报
`model id must be provider/model`）。错误消息属输出契约（X0-5 同标准），直接判死；
即便可保序变体存在，收益也只有 ns 级（S1-C-8 域）。primary/fast 的双
`parseModelRef` 消除单独看可证等价，但 ~ns 级且 R1-I 收口已记载——并入本 ID
一次性关死。

## 5. 逐文件收口（R1-I 收口之上的本轮新检查点）

| 文件 | 本轮新检查点 | 结论 |
| --- | --- | --- |
| `cli/main.ts` | S2-I-1（普通路径死载荷）、S2-I-4（children 路径 `inspectRun` 对 outcome.events 的持久态重读=耐久性验证语义）；`loadOptionalPublicPrior` 在普通路径同样"死"但其 stderr warning 是可见契约，不另立 ID | 无候选落地 |
| `cli/pause.ts` / `inject.ts` | S2-I-2；`createFilePauseController` O(1) | 无候选落地 |
| `cli/adapt.ts` | `statusCommand` 一次 registry 读=输出本体；promote/rollback 锁内 load/save=CAS 契约（R1-I 维持） | 无候选 |
| `cli/auth.ts` | S1-I-5 维持；`checkProviderAuth` 每 provider 全量 runtime 属同域不重开 | 无候选 |
| `cli/models.ts` | S1-I-4 维持（enable=2 读、set-default=3-4 读） | 无候选 |
| `cli/doctor.ts` / `doctor-overlay.ts` | S2-I-5（并行化）；`countSkillRouteLines` 逐行 parse=损坏检测契约维持 | 无候选落地 |
| `cli/commits.ts` | `loadCommitInput` 事件+checkpoint 各一读；spawnSync per commit=git 语义 | 无候选 |
| `cli/episode.ts` | 锁内 `EpisodeStore.readAll` 取 at(-1)=S1-G-1 域（跨进程磁盘事实源） | 无候选 |
| `cli/errors.ts` / `flowchart-io.ts` | S1-I-6 维持；`collectSelectedActionIds` Set 单遍已最优 | 无候选 |
| `cli/model-catalog.ts` | S1-I-1 维持；`buildLiveCatalogConfig` 内 Set/Map 索引单遍；动态 import 模块缓存后 O(1) | 无候选 |
| `pi-adapter/pi-executor.ts` | S2-I-3（负优化）；`translatePiEvent` O(1)/事件、`collected.some` O(E) 一次维持 | 无候选落地 |
| `pi-adapter/runtime.ts` / `auth-session.ts` | `createPiRuntime` 每调新建=无隐藏状态契约维持（X1-1 反面） | 无候选 |
| `pi-adapter/file-credential-store.ts` | 每操作全读全写=fail-closed+原子写契约维持 | 无候选 |
| `pi-adapter/listed-model.ts` / `cluster-tools.ts` / `index.ts` | S1-I-8 维持；cluster 工具 O(1) 包装；纯 re-export | 无候选 |
| `config/model-ref.ts` | 三函数 O(len) 单遍=字符串切片下界维持 | 无候选 |
| `config/providers-config.ts` | S2-I-6（fuzz 判死）；`writeAtomicJson`=原子写契约；save 前 re-validate=写前校验契约 | 无候选落地 |
| `telemetry/model-invocation.ts` | `invocationError` 早退链、`compareRunToRun` Map 单遍 O(n+m) 复核维持；`INVOCATION_CALL_OUTCOMES.includes` 4 元素 S1-D-8 域 | 无候选 |

## 6. 前后对比

零代码改动。基线（S1-I 落地态）即本轮终态：`--children` 单趟校准构建维持
（本机复测 22.9-23.9ms@10k 行/趟，与 R1-I 记载 23±1ms 一致），其余残余候选
全部撞排除域、错误契约或否决线。

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

裁决仿真（附录全文）三次独立运行 6 项检查 0 失败，计时方向逐次一致
（S2-I-3 三次全部反向更慢；S2-I-6 三次同为 203/2000 发散——fuzz 种子固定）。

## 8. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S2-I-1 | runCommand 普通路径死载荷 loadLearnedRouting 下沉 children 分支 | 损坏 registry 时普通 run 的 fail-fast（exit 1）会变为成功——错误路径可见发散；且 28µs-478µs 被整轮执行支配 |
| S2-I-2 | pause/inject 换未校准/惰性 router 免 invocations.jsonl 解析 | inject 经 advanceRound→router.route 真实消费 router（非等价）；pause 无「不路由」契约；一次性交互 ~23ms@10k 亚感知（S1-I-5 同带） |
| S2-I-3 | pi-executor buildInvocation toolNames/静态后缀提升到构造期 | 实测慢 2.2-2.7×（预平化大后缀的 rope 行为），三次全反向；每 invocation=一次完整模型调用 |
| S2-I-4 | resume/answer/inspect CLI 预读与 run-plane/inspectRun 内部重读去重 | 需改 src/run 公开签名（S2-D-4 类）+ run-plane 自读持久态是 fail-closed 契约（X3-3/S1-G-1 族）+ 0.4-3.1ms 一次性低于否决线 |
| S2-I-5 | doctor 异步检查 Promise.all 并行化 | S1-E-5 同类非复杂度下降；实测省 53-75µs/次，亚噪声 |
| S2-I-6 | parseProvidersConfig enabled 双遍融合 + primary/fast 双 parseModelRef 消除 | 2000 例 fuzz 中 203 例错误选择发散（非保行为，X0-5 同标准）；等价部分仅 ns 级 |

重开条件：S2-I-1 需规格明确普通 run 对适应面坏态的容忍语义；S2-I-2 需
pause 路径获得「不路由」声明契约且交互延迟预算收紧一个量级；S2-I-3 需先
推翻本报告与 S1-I-7 的双重反向基准；S2-I-4 需 src/run 公开签名解冻或事件日志
增长两个量级；S2-I-5/6 需先给出非噪声/保序场景。

MORE_OPTIMA=NO
BRANCH=cursor/r2-i-sota-opt-7b6c

## 附录：确定性仿真脚本（完整，可复现）

保存为 `scripts/round02-r2i-decision-sim.ts` 后
`npx tsx scripts/round02-r2i-decision-sim.ts` 运行（仓库根目录，依赖已装，
Node ≥22.19）。按战役纪律不入库，报告内嵌全文。seeds：`0x52a101`–`0x52a108`。

```ts
/**
 * Round-2 R2-I adjudication simulation (temporary — embedded in the R2-I
 * report appendix, not committed as a standing script).
 *
 * Adjudicates six fresh candidates over the CLI / pi-adapter / config /
 * telemetry slice on top of the landed S1-I baseline:
 *
 *   S2-I-1  runCommand plain-path dead loadLearnedRouting (sink the load into
 *           the --children branch). Bench fresh-root vs long-lived-registry
 *           cost + corrupt-registry error-path divergence proof.
 *   S2-I-2  pause/inject build a fully calibrated router (unbounded
 *           invocations.jsonl parse). Candidate would substitute a lazy or
 *           uncalibrated router; inject provably consumes the router
 *           (applyInjection -> advanceRound -> router.route), pause has no
 *           "never routes" contract. Bench the one-time build cost.
 *   S2-I-3  pi-executor buildInvocation hoists toolNames map+sort(+join) to
 *           construction time (identity varies per request; only the tool
 *           list and system prompt are static).
 *   S2-I-4  resume/answer/inspect CLI pre-read of events and the run-plane /
 *           inspectRun internal re-read dedupe (requires an out-of-slice
 *           public signature change on src/run). Bench the duplicate share.
 *   S2-I-5  doctor async checks Promise.all parallelization (S1-E-5 class).
 *   S2-I-6  parseProvidersConfig duplicate parseModelRef on primary/fast and
 *           enabled every+map two-pass fusion — error-selection divergence
 *           fuzz + bench.
 *
 * Deterministic: seeded mulberry32 for every generated fixture. Run with:
 *   npx tsx scripts/round02-r2i-decision-sim.ts
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { access, mkdir, writeFile, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { runtimeRoot } from "../src/privacy/state-layout.js";
import { loadProvidersConfig, parseProvidersConfig, type ProvidersConfig } from "../src/config/providers-config.js";
import { parseModelRef } from "../src/config/model-ref.js";
import { createCalibratedCliModelRouter } from "../src/cli/model-catalog.js";
import {
  loadLearnedRouting,
  routingPolicyIdentity,
  routingPolicyContent,
  type LearnedRoutingPolicy
} from "../src/learning/learned-routing.js";
import { ResourceRegistry } from "../src/adaptation/registry.js";
import { saveAdaptationRegistry, adaptationRegistryPath } from "../src/adaptation/promotion.js";
import { EventStore } from "../src/run/event-store.js";
import { parseRunId, createEventId, parseMessageId } from "../src/domain/ids.js";
import { nowIso } from "../src/domain/timestamp.js";
import type { Event } from "../src/run/events.js";
import { hash32 } from "../src/domain/hash.js";
import { DomainValidationError } from "../src/domain/errors.js";
import { isRecord } from "../src/domain/record.js";

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
 * Shared fixture: hermetic state root with a custom provider and a
 * deterministic invocations.jsonl of N rows (mix of calibration-matching,
 * non-matching, invalid, malformed — same corpus shape as the R1-I sim).
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
    occurredAt: new Date(1756000000000 + index * 1000).toISOString()
  };
  return JSON.stringify(row);
}

function makeStateRoot(n: number, seed: number): string {
  const root = mkdtempSync(join(tmpdir(), `r2i-sim-${n}-`));
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
 * Part A — S2-I-1: plain-run dead loadLearnedRouting
 * ============================================================ */
function learnedPolicy(rng: () => number, assignmentsCount: number): LearnedRoutingPolicy {
  return {
    primaryModelId: PRIMARY_ID,
    avoid: Array.from({ length: 2 }, (_, i) => ({
      modelId: pick(rng, CATALOG_IDS),
      family: ["research", "implement"][i],
      reason: "observed repeated FAILED verification on this family"
    })),
    prefer: [{ family: "test", modelId: FAST_ID }],
    assignments: Array.from({ length: assignmentsCount }, (_, i) => ({
      role: pick(rng, ["worker", "scout", "planner", "tester", "reviewer"]),
      model: pick(rng, CATALOG_IDS),
      family: `family-${i % 4}`
    }))
  };
}

async function partA(): Promise<void> {
  const targetProject = "/home/user/projects/target-app";
  // A.1 fresh root: the common case for a plain run (no registry yet).
  {
    const root = makeStateRoot(0, 0x52a101);
    try {
      const one = await benchAsync(async () => {
        const learned = await loadLearnedRouting(root, targetProject);
        if (learned !== undefined) throw new Error("unexpected policy");
      }, 400);
      out(`part A: fresh root loadLearnedRouting=${(one * 1000).toFixed(0)}us per plain run`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  // A.2 long-lived root: registry with 50 project baselines + the target's
  // active routing policy (10 learned assignments) — realistic upper band.
  {
    const root = makeStateRoot(0, 0x52a102);
    try {
      const rng = mulberry32(0x52a103);
      const registry = new ResourceRegistry({});
      for (let p = 0; p < 50; p += 1) {
        registry.registerBaseline({
          identity: routingPolicyIdentity(`/home/user/projects/app-${p}`),
          content: routingPolicyContent(learnedPolicy(rng, 6)),
          author: { kind: "detector", identity: "r2i-sim" }
        });
      }
      registry.registerBaseline({
        identity: routingPolicyIdentity(targetProject),
        content: routingPolicyContent(learnedPolicy(rng, 10)),
        author: { kind: "detector", identity: "r2i-sim" }
      });
      await saveAdaptationRegistry(root, registry);
      const first = await loadLearnedRouting(root, targetProject);
      const second = await loadLearnedRouting(root, targetProject);
      check("A.2 deterministic re-load (verbatim-move equivalence on the --children path)",
        JSON.stringify(first) === JSON.stringify(second) && first !== undefined);
      const one = await benchAsync(async () => {
        await loadLearnedRouting(root, targetProject);
      }, 100);
      out(`part A: 51-baseline registry loadLearnedRouting=${(one * 1000).toFixed(0)}us per plain run`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  // A.3 corrupt registry: today a plain run FAILS before starting; after the
  // sink it would succeed — observable error-path divergence (the kill).
  {
    const root = makeStateRoot(0, 0x52a104);
    try {
      const path = adaptationRegistryPath(root);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, "{ torn registry", "utf8");
      let threw: string | undefined;
      try {
        await loadLearnedRouting(root, targetProject);
      } catch (error) {
        threw = error instanceof Error ? error.message : String(error);
      }
      check(
        "A.3 corrupt registry throws on today's plain path (candidate would not)",
        threw !== undefined && /invalid registry snapshot/.test(threw),
        threw
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

/* ============================================================
 * Part B — S2-I-2: pause/inject one-time calibrated router build
 * ============================================================ */
async function partB(): Promise<void> {
  for (const [n, reps] of [
    [0, 200],
    [2000, 40],
    [10000, 10]
  ] as const) {
    const root = makeStateRoot(n, 0x52a105);
    try {
      const one = await benchAsync(async () => {
        await createCalibratedCliModelRouter(root);
      }, reps);
      out(`part B: N=${n} invocation lines — createCalibratedCliModelRouter=${one.toFixed(2)}ms per pause/inject command`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

/* ============================================================
 * Part C — S2-I-3: buildInvocation toolNames map+sort hoist
 * ============================================================ */
function partC(): void {
  const tools = [
    { name: "sparkle_send" },
    { name: "sparkle_inbox" },
    { name: "sparkle_spawn_subagent" }
  ];
  const systemPrompt = "You are a bounded subagent.\n".repeat(64); // ~1.7KB
  const identity = { providerId: PROVIDER_ID, modelId: "sim-c" };
  const level = "off";
  const current = () => {
    const toolNames = tools.map((tool) => tool.name).sort();
    return hash32(`${identity.providerId}|${identity.modelId}|${level}|${toolNames.join(",")}|${systemPrompt}`);
  };
  const hoistedSuffix = `${tools.map((tool) => tool.name).sort().join(",")}|${systemPrompt}`;
  const candidate = () => hash32(`${identity.providerId}|${identity.modelId}|${level}|${hoistedSuffix}`);
  check("C hoisted parameterHash identical", current() === candidate());
  const cur = bench(() => void current(), 20000);
  const cand = bench(() => void candidate(), 20000);
  out(
    `part C: buildInvocation parameter-hash work current=${(cur * 1e6).toFixed(0)}ns hoisted=${(cand * 1e6).toFixed(0)}ns ` +
      `per invocation (one invocation = one full model call)`
  );
}

/* ============================================================
 * Part D — S2-I-4: CLI pre-read + run-plane re-read duplicate share
 * ============================================================ */
async function partD(): Promise<void> {
  for (const eCount of [200, 2000]) {
    const root = makeStateRoot(0, 0x52a106);
    try {
      const runId = parseRunId("run_r2ibench0001");
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
          payload: { messageId: parseMessageId(`msg_r2i${i.toString(16)}`), answer: `answer ${i}` }
        } as Event;
        lines.push(JSON.stringify(event));
      }
      writeFileSync(join(runDir, "events.jsonl"), `${lines.join("\n")}\n`, "utf8");
      const store = new EventStore(root, runId);
      const read = await store.readAll();
      check(`D E=${eCount} log readable`, read.events.length === eCount);
      const one = await benchAsync(async () => {
        await store.readAll();
      }, eCount === 200 ? 100 : 20);
      out(
        `part D: E=${eCount} events — one EventStore.readAll=${one.toFixed(2)}ms; ` +
          `resume/answer/inspect each re-read once more inside src/run (duplicate=${one.toFixed(2)}ms per interactive command)`
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

/* ============================================================
 * Part E — S2-I-5: doctor async checks sequential vs Promise.all
 * (private check functions replicated verbatim from src/cli/doctor.ts)
 * ============================================================ */
interface DoctorCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}
async function refStateRootWritable(stateRoot: string): Promise<DoctorCheck> {
  try {
    await mkdir(stateRoot, { recursive: true });
    await access(stateRoot, constants.W_OK);
    const probe = join(stateRoot, ".doctor-write-probe");
    await writeFile(probe, "ok", "utf8");
    await unlink(probe);
    return { name: "state-root", ok: true, detail: `${stateRoot} writable` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name: "state-root", ok: false, detail: `${stateRoot} not writable: ${message}` };
  }
}
async function refProvidersCheck(stateRoot: string): Promise<DoctorCheck> {
  try {
    const config = await loadProvidersConfig(stateRoot);
    const primary = config.primary ?? "(none)";
    const enabled = config.enabled.length;
    return {
      name: "providers",
      ok: true,
      detail: `enabled=${enabled} primary=${primary} — fake executor does not need credentials`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name: "providers", ok: false, detail: message };
  }
}
async function refProjectCheck(projectRoot: string | undefined): Promise<DoctorCheck> {
  if (projectRoot === undefined) {
    return { name: "project", ok: true, detail: "omitted (pass --project to check package.json)" };
  }
  try {
    await access(join(projectRoot, "package.json"), constants.R_OK);
    return { name: "project", ok: true, detail: `${projectRoot} has package.json` };
  } catch {
    return { name: "project", ok: false, detail: `${projectRoot} is missing package.json` };
  }
}
async function partE(): Promise<void> {
  const root = makeStateRoot(0, 0x52a107);
  const project = mkdtempSync(join(tmpdir(), "r2i-proj-"));
  writeFileSync(join(project, "package.json"), `{"name":"x","version":"0.0.0"}\n`, "utf8");
  try {
    const sequential = await benchAsync(async () => {
      const a = await refStateRootWritable(root);
      const b = await refProvidersCheck(root);
      const c = await refProjectCheck(project);
      if (!a.ok || !b.ok || !c.ok) throw new Error("check failed");
    }, 100);
    const parallel = await benchAsync(async () => {
      const [a, b, c] = await Promise.all([
        refStateRootWritable(root),
        refProvidersCheck(root),
        refProjectCheck(project)
      ]);
      if (!a.ok || !b.ok || !c.ok) throw new Error("check failed");
    }, 100);
    out(
      `part E: doctor async checks sequential=${(sequential * 1000).toFixed(0)}us parallel=${(parallel * 1000).toFixed(0)}us ` +
        `(saving ${((sequential - parallel) * 1000).toFixed(0)}us per doctor run)`
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
}

/* ============================================================
 * Part F — S2-I-6: parseProvidersConfig fusion — error-selection
 * divergence fuzz + bench
 * ============================================================ */
/** Candidate replica: single pass over enabled, single parseModelRef per field. */
function candidateParseProvidersConfig(value: unknown): ProvidersConfig {
  if (!isRecord(value)) {
    throw new DomainValidationError("providers.json must be an object");
  }
  if (value.version !== 1) {
    throw new DomainValidationError("providers.json version must be 1");
  }
  if (!Array.isArray(value.enabled)) {
    throw new DomainValidationError("providers.json enabled must be an array of catalog ids");
  }
  const enabled = value.enabled.map((id) => {
    if (typeof id !== "string") {
      throw new DomainValidationError("providers.json enabled must be an array of catalog ids");
    }
    const ref = parseModelRef(id);
    return `${ref.providerId}/${ref.modelId}`;
  });
  // customProviders handling identical to production (delegate to the
  // production parser for that subtree).
  const customProviders = parseProvidersConfig({
    version: 1,
    enabled: [],
    customProviders: value.customProviders
  }).customProviders;
  const primaryRef = value.primary === undefined ? undefined : parseModelRef(String(value.primary));
  const fastRef = value.fast === undefined ? undefined : parseModelRef(String(value.fast));
  return {
    version: 1,
    enabled,
    customProviders,
    ...(primaryRef !== undefined ? { primary: `${primaryRef.providerId}/${primaryRef.modelId}` } : {}),
    ...(fastRef !== undefined ? { fast: `${fastRef.providerId}/${fastRef.modelId}` } : {})
  };
}
function runCatch(fn: () => unknown): { threw: boolean; message: string; value: string } {
  try {
    const value = fn();
    return { threw: false, message: "", value: JSON.stringify(value) };
  } catch (error) {
    return { threw: true, message: error instanceof Error ? error.message : String(error), value: "" };
  }
}
function partF(): void {
  const rng = mulberry32(0x52a108);
  const enabledPool: unknown[] = [
    "simprov/sim-a",
    "simprov/sim-b",
    "openai/gpt-x",
    "bad-format",
    "/leading",
    "trailing/",
    42,
    null,
    "prov/deep/model"
  ];
  let divergences = 0;
  let sameCases = 0;
  for (let c = 0; c < 2000; c += 1) {
    const count = Math.floor(rng() * 5);
    const enabled = Array.from({ length: count }, () => pick(rng, enabledPool));
    const config = {
      version: 1,
      enabled,
      ...(rng() < 0.5 ? { primary: pick(rng, enabledPool.slice(0, 4)) } : {}),
      ...(rng() < 0.3 ? { fast: "simprov/sim-a" } : {})
    };
    const a = runCatch(() => parseProvidersConfig(config));
    const b = runCatch(() => candidateParseProvidersConfig(config));
    if (a.threw !== b.threw || a.message !== b.message || a.value !== b.value) {
      divergences += 1;
    } else {
      sameCases += 1;
    }
  }
  check("F fused candidate diverges on mixed-invalid enabled arrays (error-selection contract)", divergences > 0);
  out(`part F: fuzz 2000 configs — ${sameCases} identical, ${divergences} DIVERGENT error selections (fusion is not behavior-preserving)`);
  const valid = JSON.parse(providersJson()) as unknown;
  const cur = bench(() => void parseProvidersConfig(valid), 20000);
  const cand = bench(() => void candidateParseProvidersConfig(valid), 20000);
  out(`part F: valid config parse current=${(cur * 1e6).toFixed(0)}ns fused-candidate=${(cand * 1e6).toFixed(0)}ns per load`);
}

await partA();
await partB();
partC();
await partD();
await partE();
partF();

out(`\ntotal: ${checks} checks, ${failures} failures`);
if (failures > 0) process.exit(1);
```

仿真原始输出（最终一次运行；三次运行方向一致）：

```
part A: fresh root loadLearnedRouting=29us per plain run
part A: 51-baseline registry loadLearnedRouting=475us per plain run
part B: N=0 invocation lines — createCalibratedCliModelRouter=0.37ms per pause/inject command
part B: N=2000 invocation lines — createCalibratedCliModelRouter=6.20ms per pause/inject command
part B: N=10000 invocation lines — createCalibratedCliModelRouter=22.87ms per pause/inject command
part C: buildInvocation parameter-hash work current=5369ns hoisted=14764ns per invocation (one invocation = one full model call)
part D: E=200 events — one EventStore.readAll=0.37ms; resume/answer/inspect each re-read once more inside src/run (duplicate=0.37ms per interactive command)
part D: E=2000 events — one EventStore.readAll=2.99ms; resume/answer/inspect each re-read once more inside src/run (duplicate=2.99ms per interactive command)
part E: doctor async checks sequential=184us parallel=131us (saving 53us per doctor run)
part F: fuzz 2000 configs — 1797 identical, 203 DIVERGENT error selections (fusion is not behavior-preserving)
part F: valid config parse current=901ns fused-candidate=766ns per load

total: 6 checks, 0 failures
```
