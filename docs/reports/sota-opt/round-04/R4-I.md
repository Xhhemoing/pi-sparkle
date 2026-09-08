MODEL_SLUG=claude-fable-5-thinking-xhigh

# R4-I：CLI / Pi 适配器 / 配置 / 遥测切片第四遍复查报告

**战役:** 全库持久 SOTA 优化 Round 4 / R4-I
**基线:** `cursor/sota-persistent-opt-83a1` @ `d11c125`
**分支:** `cursor/r4-i-cli-fourth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**落地 1 个赢家（S4-I），其余 4 个第四组新角度候选全部淘汰立排除（S4-I-2…S4-I-5）。**

此前**每一次 CLI 调用**——包括 `--version`、`help`、`models list`、`adapt status`、
以及 README 主打的 fake-executor `run` / `run --children` 流程——都通过两条静态
import 边急切加载整个 Pi 运行时子树（`@earendil-works/pi-ai` 冷载实测
92.5–99.8ms + `@earendil-works/pi-agent-core` 增量 31.2–32.4ms，三次独立测量）：

1. `src/cli/main.ts` → `../pi-adapter/runtime.js`（`createConfiguredPiExecutor`，
   全文件唯一消费点是 `createExecutor` 的 `--executor pi` 分支）；
2. `src/pi-adapter/auth-session.ts` → `./runtime.js`（`createPiRuntime`，唯二
   消费点是 `checkProviderAuth` / `loginProviderInteractive` 函数体内部）。

S4-I 把这两条边改为**点用处 `await import()`**（仓库内 `listed-model.js` 对
`getBuiltinModel` 早已确立的同一模式），从所有不构建 Pi 运行时的命令中移除
~103–124ms 的死模块加载。等价性经 21 命令 old-vs-new 矩阵裁决：基线
`d11c125` worktree 构建旧 dist，与新 dist 在成对全新确定性夹具上逐命令对比
stdout/stderr/exit——**127 项检查 × 2 次独立运行 0 失败**（原始逐字节或
id/时间戳归一化后逐字节）。9 个命令类 spawn-to-exit 中位基准：非 Pi 命令
一致省 **102.7–123.6ms**；唯一真正构建 Pi 运行时的 `auth status --all` 在噪声
内（-1.0 / -3.3ms）——成本只是从每次启动搬到首次使用点，总量不变。生产
diff 全部 2 文件 5+/2-（`3b5faae`）。

其余候选经理论 + 确定性仿真（seeded mulberry32，提交于
`scripts/round04-r4i-equivalence-sim.ts`，68 检查 × 2 次独立运行 0 失败、
结论逐位一致）裁决全部淘汰：S4-I-2 / S4-I-4 各有硬发散反例（陈旧
checkpoint fail-open 翻转；错误选择可观察变更），S4-I-3 / S4-I-5 可证等价
但收益为 µs 级噪声。未重开任何 X* / S1-* / S2-* / S3-* / S4-* 条目。

## 0. 范围与约束遵守

- 切片：`src/cli/`（13 文件）、`src/pi-adapter/`（7 文件）、`src/config/`
  （2 文件）、`src/telemetry/`（1 文件）全量第四遍实际读码。生产改动仅
  `src/cli/main.ts`（4+/1-）与 `src/pi-adapter/auth-session.ts`（3+/1-），
  均在切片内。测试零改动。
- 先读并遵守：README / EXCLUSIONS.md（含 S4-A/B/D/E/F/G/H 全部新条目）/
  round-04/PLAN.md / round-01/R1-I.md / round-02/R2-I.md / round-03/R3-I.md。
- **基线不变性核实**：`git diff d0677a3..d11c125 -- src/{cli,pi-adapter,config,telemetry}`
  输出为空——切片自 S1-I 落地提交（`d0677a3`）以来逐字节未变，期间 `src/`
  仅有切片外 routing 提交（S2-C `7010e52`、S3-C `ccd4ab4`）。R1-I 下界表、
  R2-I/R3-I 收口与全部既有排除继承有效。
- 候选枚举刻意绕开全部既有排除，特别核对未触碰：S1-I（已落地，
  `--children` 复用 smartChildPlan 目录——本轮 A.3 电池含该流程回归）、
  S1-I-1..8、S2-I-1..6、S3-I-1..6。与本轮最近的三条辨析见 §2.4。
- R3-I 已收口 telemetry 逐行校验（`invocationError`）无可压缩常数：本轮对
  `telemetry/model-invocation.ts` **零候选**，不硬凑（§5）。
- 硬不变量全部满足：双 LCB 与双归因保留（本改动不触任何评估/归因面）、
  阈值/权限/数据面契约/公开签名/凭据处理不变——`auth-session.ts` 的改动
  只移动**模块加载时机**，`createPiRuntime` 调用位置、参数、凭据流与错误
  面逐字节保持；`FileCredentialStore` / `authStorePath` 静态导入原样保留。
  不声称 Outcome-supported。

## 1. 启动剖面与调用图（本轮新测量基底）

第四遍换角度：前三遍聚焦命令**执行期**热路径（S1-I 的 `--children` 双构建、
R3-I 的 invocations.jsonl 校验下界），本轮实测**进程启动期**的模块图成本——
这是每次 CLI 调用无条件支付、且此前三轮从未测量过的份额。

1. **Pi 子树冷载成本**（`node -e` 三次独立测量）：
   `@earendil-works/pi-ai` 单独冷载 92.5 / 95.8 / 99.8ms；先载 pi-ai 后
   `@earendil-works/pi-agent-core` 增量 31.2 / 31.3 / 32.4ms（两包共享大量
   依赖，单独冷载 agent-core 为 119–120ms）。子树合计 ~125ms。
2. **静态边枚举**（全库 `import ... from ".*runtime.js"` 交叉检索）：
   `runtime.ts` 是切片内唯一静态导入 pi-ai + agent-core 双包的模块；它的
   静态消费者恰两处——`cli/main.ts` 顶部（L11）与 `auth-session.ts` 顶部
   （L6）。`pi-executor.ts` 也静态依赖 agent-core，但它只被 `runtime.ts`
   与 `index.ts`（非 CLI 路径）静态引用；`listed-model.ts` 对 pi-ai 仅
   type-only import + 点用处动态 import（既有模式，S4-I 直接沿用）。
3. **消费点核实**：`createConfiguredPiExecutor` 在 `main.ts` 全文唯一使用点
   是 `createExecutor` 的 `executor === "pi"` 分支（默认 executor 是 fake，
   README 快速上手全程不进该分支）；`createPiRuntime` 在 `auth-session.ts`
   的唯二使用点在 `checkProviderAuth` / `loginProviderInteractive` 函数体内
   （仅 `auth login` / `auth status --all` 触达）。即：**绝大多数命令为这
   ~125ms 支付了 100% 死成本**。
4. **命令级验证**（old dist，spawn-to-exit 中位 15 次）：`--version` 175.6 /
   178.8ms、`help` 175.1 / 176.1ms——对一个打印版本号的命令而言，Pi 子树
   占了近 2/3 的墙钟时间。

## 2. 落地项 S4-I：Pi 运行时子树点用处惰性加载

### 2.1 机制

两条静态边改动态（完整 diff 见 `3b5faae`，共 5+/2-）：

- `main.ts`：删除顶部 `import { createConfiguredPiExecutor } from "../pi-adapter/runtime.js"`；
  在 `createExecutor` 的 `"pi"` 分支内、`PI_THINKING_LEVEL` 校验**之后**插入
  `const { createConfiguredPiExecutor } = await import("../pi-adapter/runtime.js")`。
  放在校验之后保证 `PI_THINKING_LEVEL` 非法时的报错先于任何 Pi 加载（与旧
  行为一致：旧代码抛该错时模块早已加载，错误本身与加载顺序无关，消息/类型/
  exit 逐字节相同——A.3 golden 契约钉死）。
- `auth-session.ts`：删除顶部 `import { createPiRuntime } from "./runtime.js"`；
  在 `checkProviderAuth` 与 `loginProviderInteractive` 各自函数体首行插入
  `const { createPiRuntime } = await import("./runtime.js")`。两函数本就是
  async 且首个动作就是 `await createPiRuntime(...)`，时序面无观察差异。

等价论证要点：ESM 动态 import 与静态 import 解析到**同一模块缓存实例**
（A.2 用双重 `import()` 证同一命名空间对象、同一函数对象）；`runtime.js`
模块体无副作用敏感的顶层代码顺序依赖（其顶层只有 import 与声明）；两个
改动点都在 async 函数内，`await import()` 不改变外部可观察的执行顺序。

### 2.2 等价裁决（old-vs-new 二进制矩阵，附录 A）

基线 worktree（`git worktree add /tmp/r4i-baseline d11c125` + 完整构建）产出
旧 dist；工作区构建新 dist。21 个命令用例覆盖全部子命令族（version/help/
unknown/doctor/models×5/auth×2/adapt/pref/episode/inspect/run 普通/--children/
--track/--executor pi/broken providers/--track×--children 冲突/auth status --all），
每个用例 old/new 各建**独立同构夹具**跑一遍，另对同一持久化 run 快照做
old/new 双端 `inspect`（含 `--json`）逐字节对比：

- 原始模式（无生成 id 的命令）：stdout/stderr/exit **逐字节相等**；
- 归一化模式（含 run/evt/tsk 等生成 id、ISO 时间戳、tmp 路径）：归一化后
  逐字节相等；
- 错误契约钉死：broken providers.json 仍 `invalid providers.json at …` exit 1；
  `--executor pi` 缺模型仍 `requires an enabled primary model` exit 1（且发生
  在任何 Pi 加载之前——见 §2.3 基准，该命令与纯配置命令同速）；
  `--track`×`--children` 冲突消息不变。

**127 检查 × 2 次独立运行 0 失败**（另在落地前以同一矩阵预跑 3 次，同样
0 失败）。

### 2.3 规模收益（spawn-to-exit 中位墙钟，两次独立基准）

| 命令类 | old (ms) | new (ms) | Δ run1 / run2 (ms) |
| --- | --- | --- | --- |
| `--version` | 175.6 / 178.8 | 61.3 / 60.9 | **+114.3 / +118.0** |
| `help` | 175.1 / 176.1 | 60.1 / 61.2 | **+115.1 / +114.9** |
| `models list`（已配置） | 176.8 / 185.3 | 63.1 / 61.7 | **+113.7 / +123.6** |
| `models list --available openai` | 196.8 / 198.2 | 86.6 / 86.6 | **+110.2 / +111.7** |
| `adapt status` | 177.8 / 176.2 | 61.7 / 60.7 | **+116.1 / +115.5** |
| `run` 普通 fake | 192.0 / 190.8 | 75.5 / 75.6 | **+116.5 / +115.2** |
| `run --children` fake（README 流程） | 253.1 / 251.7 | 150.5 / 147.2 | **+102.7 / +104.5** |
| `run --executor pi` 缺模型（Pi 加载前失败） | 178.2 / 175.7 | 61.9 / 62.6 | **+116.3 / +113.1** |
| `auth status --all`（new 在此惰性支付） | 216.6 / 214.2 | 217.6 / 217.5 | -1.0 / -3.3（噪声） |

方向两次运行完全一致；量级在战役落地线（数十~数百 ms）之内且**每次调用
都赚**（对比 S1-I 的 ~117ms 需要 N=50k 遥测行才触发）。committed 仿真 A.4
的缓存探针独立佐证：导入整个 CLI 模块图后 pi-ai 首次 import 仍需
180.9–230.0ms（冷，tsx 环境），第二次 0.51–0.61ms（缓存）——证明 CLI 图
不再预载 pi-ai，且惰性路径命中引擎模块缓存。

### 2.4 与既有排除的辨析（未重开）

- **S1-I-5**（`auth status --all` 每 provider `createPiRuntime` 提升）：那是
  改**调用次数/位置**、触凭据面平行实现风险；S4-I 不动任何 `createPiRuntime`
  调用点与次数，只推迟模块图加载，凭据流逐字节不变。
- **S2-I-2**（pause/inject 换惰性 router）：那是惰性化**运行期对象构建**且
  inject 真实消费 router；S4-I 惰性化的是**模块加载**，且被惰性化的分支在
  非 Pi 命令上是可证死代码。
- **S2-I-1 / S3-I-3**（providers.json 读取下沉的错误路径发散）：S4-I 不移动
  任何配置读取或校验的相对顺序，错误选择面不变（A.3 golden + 附录 A 的
  broken-providers 用例双重钉死）。

## 3. 候选三条件裁决总表

仿真：`scripts/round04-r4i-equivalence-sim.ts`（seeded mulberry32，seeds
0x54a101–0x54a108；68 检查 × 2 次独立运行 0 失败，等价/发散结论逐位一致，
计时方向一致）+ 附录 A old-vs-new 矩阵（127 检查 × 2 次 0 失败）。

| ID | 候选 | 理论 | 仿真/等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| **S4-I（落地）** | Pi 运行时子树两条急切静态边改点用处 `await import()` | 每次非 Pi 命令省 pi-ai ~93–100ms + agent-core 增量 ~31–32ms 死加载 | ✅ 21 命令 old-vs-new 矩阵 127 检查 ×2 逐字节/归一化等价；A.1–A.4 结构/模块身份/电池/缓存探针 | 9 命令类中位省 **102.7–123.6ms**；`auth status --all` -1.0/-3.3ms 噪声内 | **落地**（`3b5faae`，2 文件 5+/2-） |
| S4-I-2 | resume/answer 的 PAUSED 探测（main.ts L1062/L1190）改读 checkpoint.status，跳过 `replayRun(events)` 全量重放 | 省事件全量重放 | ❌ **陈旧 checkpoint 发散实证**（sim B）：事件已追加 PAUSE_REQUESTED 而 checkpoint 尚未重写的崩溃窗口内，events 重放 = PAUSED、checkpoint = RUNNING——候选把「拒绝恢复已暂停 run」翻成 fail-open 继续执行 | 被替换工作实测 E=200 事件 4µs、E=2000 事件 17µs（内存内重放，亚 ms） | 淘汰：正确性发散 + 即便等价也是 µs 级，两条任一即足 |
| S4-I-3 | L1062 `values.unpause !== true` 短路重排到 pause 探测之前（`--unpause` 恢复时跳过 token 读 + replayRun） | 布尔重排等价当且仅当右操作数纯且不抛 | ✅ 2000 例 fuzz（7 种事件类型 × 随机长度日志 × 随机 token/unpause）布尔结果逐位等价；replayRun 纯、不抛已证（sim C） | 省一次 4–17µs 内存重放，且仅在 `--unpause` 交互恢复时 | 淘汰：µs 级噪声（与 S1-I-1 ~190µs 同标准，低于落地线 4 个数量级） |
| S4-I-4 | `--track`×`--children` 冲突检查提升到 providers/executor 加载之前 | 冲突组合更早失败 | ❌ **错误选择发散实证**（sim D）：broken providers.json + 冲突标志时，今日报 `invalid providers.json at …`，提升后改报冲突消息——与 S2-I-1 / S3-I-3 / S1-D-7 完全同型的可观察错误路径变更 | 成功路径零收益（该组合恒失败，非冲突路径顺序不变） | 淘汰：错误路径可见发散 |
| S4-I-5 | `describeSparkleModel` 的 `getBuiltinModel` try/catch 未命中路径（异常做控制流）换预探测——自定义 provider 每个启用 id 每次目录构建都穿越一次 miss | throw/catch 在 V8 有常数成本 | 等价可构造（返回面 undefined 语义一致） | 实测一次 builtin-miss `resolveListedModel` 全程 9.28–9.37µs，×M≤10 启用 id/目录构建 → **<0.1ms** | 淘汰：µs 级噪声；且 catch-miss 是 pi-ai 公开 API 的既定用法，改写引入平行实现风险 |

## 4. 关键裁决细节

### 4.1 S4-I-2：checkpoint 不是事件日志的可靠 PAUSED 镜像

事件追加（`EventStore.append`）与 checkpoint 重写（`CheckpointStore.write`）
是两个独立的持久化步骤。sim B 构造崩溃窗口快照：`[RUN_STARTED]` 时刻
materialize 的 checkpoint（status=RUNNING）+ 事后追加的 PAUSE_REQUESTED 事件。
`replayRun([started, paused]).status === "PAUSED"` 为真；
`staleCheckpoint.status === "PAUSED"` 为假。今日代码在此场景**拒绝** resume
（`run is paused; pass --unpause to continue`）；候选会放行——安全方向翻转，
直接否决。附带基准证明被"优化"的重放本身只有 4–17µs：即便发明双读对账
方案也不可能达线。

### 4.2 S4-I-3：可证等价但目标不存在

这是本轮唯一"等价性无可挑剔"的淘汰项：`&&` 重排合法的充要条件是右操作数
纯且不抛，sim C 以 2000 例 fuzz（含 PAUSE_REQUESTED/PAUSE_CLEARED/
RUN_CANCEL_REQUESTED 等异常序）证明 `replayRun` 满足。但被跳过的工作是
一次亚 ms 内存重放，且只在人类交互的 `--unpause` 上发生——与 R3-I 对
S3-I-2 的结论同类：**可证等价 + µs 收益 = 不动生产代码**。

### 4.3 S4-I-4：错误选择契约第三次钉死

S2-I-1（providers 读取下沉）、S3-I-3（loadProvidersConfig 死载荷下沉）之后，
这是同一错误选择契约的第三个变体（方向相反：不是把读取推后，而是把冲突
检查提前）。sim D 在 broken providers.json 夹具上实证今日行为：
`invalid providers.json at PATH` 先于冲突消息胜出。任何改变"哪个错误先被
报告"的重排都是可观察行为变更——本战役自 S1-D-7 起的一贯否决标准，本轮
维持。

### 4.4 S4-I-5：异常控制流的真实成本实测

理论上 try/catch miss 路径"贵"；实测一次完整 builtin-miss
`resolveListedModel`（穿越 `describeSparkleModel` 的 throw/catch 后走自定义
provider find）为 9.28–9.37µs。目录构建每次最多 M≤10 个启用 id → 单次构建
<0.1ms，低于落地线三个数量级。V8 对该模式的实际开销远小于其名声——与
S3-I-1（"省分配"目标不存在）同一教训的异常版。

## 5. 逐文件收口（第四遍新检查点）

- `cli/main.ts`：**S4-I 落地文件**。resume/answer 的 PAUSED 探测（S4-I-2/3
  裁决区）、`--track`×`--children` 错误选择（S4-I-4）均维持原样。其余热点
  （providers 双读 S1-I-2、flowchart 未校准构建 S1-I-1、`--children` 目录
  复用 S1-I）已由前三轮收口。
- `cli/pause.ts` / `inject.ts`：S2-I-2 收口维持；本轮无新角度。
- `cli/models.ts` / `model-catalog.ts`：S1-I-4/8 收口维持；`--available` 路径
  本轮受益于 S4-I（-110ms，§2.3）。
- `cli/adapt.ts` / `auth.ts` / `episode.ts` / `doctor.ts` / `doctor-overlay.ts` /
  `commits.ts` / `errors.ts` / `flowchart-io.ts`：一次性/交互命令，无无界热
  路径；S1-I-6（errors reverse）等收口维持。
- `pi-adapter/auth-session.ts`：**S4-I 落地文件**（凭据处理逐字节不变，
  §0）。S1-I-5 未重开。
- `pi-adapter/runtime.ts` / `pi-executor.ts` / `cluster-tools.ts` / `index.ts`：
  Pi 会话面，加载时机由 S4-I 管理；执行期由外部 API 延迟支配，无 in-slice
  常数可压。
- `pi-adapter/listed-model.ts`：S4-I-5 裁决区（§4.4），维持原样。
- `pi-adapter/file-credential-store.ts`：凭据面，禁区，零候选。
- `config/model-ref.ts` / `providers-config.ts`：纯解析/校验，R1-I 下界维持；
  S4-I 不移动其任何调用的相对顺序。
- `telemetry/model-invocation.ts`：R3-I 已证逐行校验无可压缩常数，本轮
  **零候选**（遵指令不硬凑）。

## 6. 前后对比

| 维度 | 之前 | 之后 |
| --- | --- | --- |
| 任意非 Pi 命令启动 | 无条件加载 pi-ai + agent-core（~125ms 死成本） | 不加载；中位省 102.7–123.6ms |
| `--version` 中位 | 175.6–178.8ms | 60.9–61.3ms（-65%） |
| README `run --children` fake 流程中位 | 251.7–253.1ms | 147.2–150.5ms |
| `--executor pi` / `auth login` / `auth status --all` | 启动期加载 | 首次使用点加载，总成本不变（-1.0/-3.3ms 噪声内） |
| 输出/退出码/错误契约 | — | 21 命令矩阵逐字节/归一化等价（127 检查 ×2） |
| 模块实例身份 | 静态单例 | 引擎模块缓存单例（A.2 证同一对象） |

## 7. 测试与验证

```
pnpm gate                                   # ✓ typecheck + lint + test + build 全绿
# tests 1169 / suites 78 / pass 1168 / fail 0 / skipped 1（既有 skip）
npx tsx --test test/unit/{cli,pi-adapter,config,telemetry}/**/*.test.ts
# tests 66 / suites 3 / pass 66 / fail 0
npx tsx --test test/integration/{cli,pi-adapter}/**/*.test.ts
# tests 59 / pass 58 / fail 0 / skipped 1（既有 skip）
npx tsx scripts/round04-r4i-equivalence-sim.ts   # ✓ 68 checks, 0 failures × 2 次独立运行
node --import tsx /tmp/r4i-adjudicate.mts        # ✓ 127 checks, 0 failures × 2 次（附录 A）
```

committed 仿真两次独立运行输出（计时为信息性，等价/发散结论逐位一致）：

```
# run 1
part A: CLI graph import=75.1ms; pi-ai after it cold=230.0ms (eliminated from every non-Pi command), cached=0.51ms
part B: replayRun over E=200 in-memory events=4us per answer/resume
part B: replayRun over E=2000 in-memory events=17us per answer/resume
part C: saving = one sub-ms in-memory replayRun, only on --unpause resumes (see part B bench)
part E: one builtin-miss resolveListedModel (throw/catch control flow)=9283ns x M<=10 enabled ids per catalog build

total: 68 checks, 0 failures

# run 2
part A: CLI graph import=69.7ms; pi-ai after it cold=180.9ms (eliminated from every non-Pi command), cached=0.61ms
part B: replayRun over E=200 in-memory events=4us per answer/resume
part B: replayRun over E=2000 in-memory events=17us per answer/resume
part C: saving = one sub-ms in-memory replayRun, only on --unpause resumes (see part B bench)
part E: one builtin-miss resolveListedModel (throw/catch control flow)=9374ns x M<=10 enabled ids per catalog build

total: 68 checks, 0 failures
```

## 8. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

落地项（并入「已落地赢家」区）：

- **S4-I** CLI 的 Pi 运行时子树点用处惰性加载（`main.ts` `--executor pi`
  分支 + `auth-session.ts` 两函数体；见 round-04/R4-I.md）

新排除（并入排除表）：

| ID | 候选 | 一句话理由 |
| --- | --- | --- |
| S4-I-2 | resume/answer PAUSED 探测改读 checkpoint.status | 陈旧 checkpoint fail-open 发散 + 被替换重放仅 4–17µs |
| S4-I-3 | `values.unpause !== true` 短路重排到 pause 探测前 | 可证等价但省的是一次 µs 级内存重放 |
| S4-I-4 | `--track`×`--children` 冲突检查提升到配置加载前 | 错误选择发散（broken providers 今日先胜出），S2-I-1/S3-I-3 同型 |
| S4-I-5 | `describeSparkleModel` try/catch miss 路径换预探测 | 实测 9.3µs × M≤10/目录构建，µs 噪声 + 平行实现风险 |

重开条件：S4-I-2 仅当事件追加与 checkpoint 写入变为单一原子步骤（数据面
契约变更，超出本战役范围）；S4-I-3/5 仅当落地线降到 µs 档；S4-I-4 仅当
错误选择契约被产品决策显式改变。

## 附录 A：old-vs-new 裁决矩阵脚本（临时，未提交；完整可复现）

前置：`git worktree add /tmp/r4i-baseline d11c125 && cd /tmp/r4i-baseline &&
pnpm install --frozen-lockfile && pnpm build`；工作区 `pnpm build`。
运行：`node --import tsx /tmp/r4i-adjudicate.mts`。

```typescript
/**
 * R4-I adjudication harness (temporary, NOT committed).
 * Old (baseline d11c125 dist) vs new (workspace dist) CLI:
 *  - byte-identical stdout/stderr/exit on deterministic commands
 *  - normalized-identical on commands with generated ids/timestamps
 *  - startup wall-time benchmark per command class
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NODE = process.execPath;
const OLD = "/tmp/r4i-baseline/dist/cli/main.js";
const NEW = "/workspace/dist/cli/main.js";

let checks = 0;
let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  checks += 1;
  if (!ok) {
    failures += 1;
    console.error(`FAIL: ${label}${detail === undefined ? "" : ` — ${detail}`}`);
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

const PROVIDER_ID = "simprov";
const MODEL_IDS = ["sim-a", "sim-b", "sim-c"] as const;
const CATALOG_IDS = MODEL_IDS.map((id) => `${PROVIDER_ID}/${id}`);

function providersJson(): string {
  return `${JSON.stringify(
    {
      version: 1,
      enabled: CATALOG_IDS,
      primary: `${PROVIDER_ID}/sim-c`,
      fast: `${PROVIDER_ID}/sim-a`,
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

interface Fixture {
  home: string;
  stateRootEmpty: string;
  stateRootConfigured: string;
  stateRootBroken: string;
  project: string;
  childrenSpec: string;
}

function makeFixture(tag: string): Fixture {
  const home = mkdtempSync(join(tmpdir(), `r4i-home-${tag}-`));
  const stateRootEmpty = join(home, "sr-empty");
  const stateRootConfigured = join(home, "sr-conf");
  const stateRootBroken = join(home, "sr-broken");
  for (const root of [stateRootEmpty, stateRootConfigured, stateRootBroken]) {
    mkdirSync(join(root, "runtime"), { recursive: true });
  }
  writeFileSync(join(stateRootConfigured, "runtime", "providers.json"), providersJson(), "utf8");
  writeFileSync(join(stateRootBroken, "runtime", "providers.json"), "{ torn providers", "utf8");
  const project = join(home, "proj");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "package.json"), `{"name":"fixture","version":"0.0.0"}\n`, "utf8");
  const childrenSpec = join(home, "children.json");
  writeFileSync(
    childrenSpec,
    `${JSON.stringify({
      tasks: [
        { id: "tsk_scout1", role: "scout", objective: "Survey the payment module" },
        { id: "tsk_impl1", role: "implementer", objective: "Implement retry logic", dependsOn: ["tsk_scout1"] },
        { id: "tsk_test1", role: "tester", objective: "Run the unit tests", dependsOn: ["tsk_impl1"] }
      ]
    })}\n`,
    "utf8"
  );
  return { home, stateRootEmpty, stateRootConfigured, stateRootBroken, project, childrenSpec };
}

function runCli(bin: string, args: string[], home: string): { stdout: string; stderr: string; code: number } {
  const result = spawnSync(NODE, [bin, ...args], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: home,
      // keep the executor/env deterministic: no PI_* leakage
    },
    windowsHide: true
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.status ?? -1 };
}

/** Strip generated ids, ISO timestamps, durations. */
function normalize(text: string): string {
  return text
    .replace(/\b(run|evt|ep|agt|msg|art|evd|cnd|inv|tsk|fbk|rsv)_[A-Za-z0-9-]+/g, "$1_X")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})/g, "TS")
    .replace(/\b\d+ms\b/g, "Nms")
    .replace(/\/tmp\/[^\s"']+/g, "PATH");
}

interface Case {
  name: string;
  args: (f: Fixture) => string[];
  mode: "raw" | "normalized";
}

const CASES: Case[] = [
  { name: "--version", args: () => ["--version"], mode: "raw" },
  { name: "help", args: () => ["help"], mode: "raw" },
  { name: "unknown command", args: () => ["frobnicate"], mode: "raw" },
  { name: "doctor", args: (f) => ["doctor", "--state-root", f.stateRootConfigured, "--project", f.project], mode: "normalized" },
  { name: "models list (empty)", args: (f) => ["models", "list", "--state-root", f.stateRootEmpty], mode: "raw" },
  { name: "models list (configured)", args: (f) => ["models", "list", "--state-root", f.stateRootConfigured], mode: "raw" },
  { name: "models list --available openai", args: (f) => ["models", "list", "--available", "--provider", "openai", "--state-root", f.stateRootEmpty], mode: "raw" },
  { name: "models enable custom", args: (f) => ["models", "enable", "simprov/sim-b", "--state-root", f.stateRootConfigured], mode: "raw" },
  { name: "models set-default", args: (f) => ["models", "set-default", "--primary", "simprov/sim-c", "--fast", "simprov/sim-a", "--state-root", f.stateRootConfigured], mode: "raw" },
  { name: "auth status (empty)", args: (f) => ["auth", "status", "--state-root", f.stateRootEmpty], mode: "raw" },
  { name: "auth login bad provider", args: (f) => ["auth", "login", "nosuchprovider", "--key", "k", "--state-root", f.stateRootEmpty], mode: "raw" },
  { name: "adapt status", args: (f) => ["adapt", "status", "--state-root", f.stateRootEmpty], mode: "normalized" },
  { name: "pref list", args: (f) => ["pref", "list", "--state-root", f.stateRootEmpty], mode: "raw" },
  { name: "episode events missing", args: (f) => ["episode", "events", "--episode", "ep_missing01", "--state-root", f.stateRootEmpty], mode: "normalized" },
  { name: "inspect missing run", args: (f) => ["inspect", "--run", "run_missing0001", "--state-root", f.stateRootEmpty], mode: "normalized" },
  { name: "run plain fake", args: (f) => ["run", "--project", f.project, "--objective", "survey the module", "--state-root", f.stateRootConfigured], mode: "normalized" },
  { name: "run --children fake", args: (f) => ["run", "--project", f.project, "--objective", "ship the feature", "--children", f.childrenSpec, "--state-root", f.stateRootConfigured], mode: "normalized" },
  { name: "run --track fake", args: (f) => ["run", "--project", f.project, "--objective", "ship the tracked feature", "--track", "--assume-defaults", "--state-root", f.stateRootConfigured], mode: "normalized" },
  { name: "run broken providers.json (fail-fast)", args: (f) => ["run", "--project", f.project, "--objective", "x", "--state-root", f.stateRootBroken], mode: "normalized" },
  { name: "run --executor pi without model", args: (f) => ["run", "--project", f.project, "--objective", "x", "--executor", "pi", "--state-root", f.stateRootEmpty], mode: "normalized" },
  { name: "run --track --children conflict", args: (f) => ["run", "--project", f.project, "--objective", "x", "--track", "--children", f.childrenSpec, "--state-root", f.stateRootConfigured], mode: "normalized" },
  { name: "auth status --all (lazy Pi load in NEW)", args: (f) => ["auth", "status", "--all", "--state-root", f.stateRootConfigured], mode: "raw" }
];

// ---------------------------------------------------------------------------
// Part 1: old-vs-new output equivalence on identical fixtures.
// Seeded RNG shuffles case order to vary interleaving deterministically.
// ---------------------------------------------------------------------------
const rng = mulberry32(0x54a101);
const order = CASES.map((_, i) => i).sort(() => rng() - 0.5);

const fixtureOld = makeFixture("old");
const fixtureNew = makeFixture("new");
for (const idx of order) {
  const c = CASES[idx]!;
  const oldRun = runCli(OLD, c.args(fixtureOld), fixtureOld.home);
  const newRun = runCli(NEW, c.args(fixtureNew), fixtureNew.home);
  const [oOut, oErr] = c.mode === "raw" ? [oldRun.stdout, oldRun.stderr] : [normalize(oldRun.stdout), normalize(oldRun.stderr)];
  const [nOut, nErr] = c.mode === "raw" ? [newRun.stdout, newRun.stderr] : [normalize(newRun.stdout), normalize(newRun.stderr)];
  check(`${c.name}: exit`, oldRun.code === newRun.code, `${oldRun.code} vs ${newRun.code}`);
  check(`${c.name}: stdout`, oOut === nOut, `\n--- old ---\n${oOut}\n--- new ---\n${nOut}`);
  check(`${c.name}: stderr`, oErr === nErr, `\n--- old ---\n${oErr}\n--- new ---\n${nErr}`);
}

// Read-only follow-ups on the SAME persisted run: copy the state root the new
// CLI produced, then inspect it with both binaries (byte-level determinism of
// the read path over one shared snapshot).
{
  const shared = mkdtempSync(join(tmpdir(), "r4i-shared-"));
  const sr = join(shared, "sr");
  cpSync(fixtureNew.stateRootConfigured, sr, { recursive: true });
  // find a runId from the runs directory
  const { readdirSync } = await import("node:fs");
  const runsDir = join(sr, "runtime", "runs");
  const runIds = readdirSync(runsDir);
  check("shared fixture has persisted runs", runIds.length > 0);
  for (const runId of runIds) {
    for (const json of [false, true]) {
      const args = ["inspect", "--run", runId, "--state-root", sr, ...(json ? ["--json"] : [])];
      const oldRun = runCli(OLD, args, shared);
      const newRun = runCli(NEW, args, shared);
      check(`inspect ${runId}${json ? " --json" : ""}: exit`, oldRun.code === newRun.code);
      check(`inspect ${runId}${json ? " --json" : ""}: stdout`, oldRun.stdout === newRun.stdout);
      check(`inspect ${runId}${json ? " --json" : ""}: stderr`, oldRun.stderr === newRun.stderr);
    }
  }
  rmSync(shared, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Part 2: startup benchmark old vs new (median of N spawns).
// ---------------------------------------------------------------------------
function benchCli(bin: string, args: string[], home: string, reps: number): number {
  const times: number[] = [];
  runCli(bin, args, home); // warm fs cache
  for (let i = 0; i < reps; i += 1) {
    const t0 = performance.now();
    runCli(bin, args, home);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)]!;
}

const benches: { name: string; args: (f: Fixture) => string[]; reps: number }[] = [
  { name: "--version", args: () => ["--version"], reps: 15 },
  { name: "help", args: () => ["help"], reps: 15 },
  { name: "models list (configured)", args: (f) => ["models", "list", "--state-root", f.stateRootConfigured], reps: 15 },
  { name: "models list --available openai (touches providers/all)", args: (f) => ["models", "list", "--available", "--provider", "openai", "--state-root", f.stateRootEmpty], reps: 15 },
  { name: "adapt status", args: (f) => ["adapt", "status", "--state-root", f.stateRootEmpty], reps: 15 },
  { name: "run plain fake", args: (f) => ["run", "--project", f.project, "--objective", "bench", "--state-root", f.stateRootConfigured], reps: 9 },
  { name: "run --children fake (README flow)", args: (f) => ["run", "--project", f.project, "--objective", "bench", "--children", f.childrenSpec, "--state-root", f.stateRootConfigured], reps: 9 },
  { name: "run --executor pi without model (fails pre-Pi-load)", args: (f) => ["run", "--project", f.project, "--objective", "x", "--executor", "pi", "--state-root", f.stateRootEmpty], reps: 9 },
  { name: "auth status --all (NEW pays lazy Pi load here)", args: (f) => ["auth", "status", "--all", "--state-root", f.stateRootConfigured], reps: 9 }
];

console.log("\n=== startup benchmark (median wall ms per spawn) ===");
for (const b of benches) {
  const oldMs = benchCli(OLD, b.args(fixtureOld), fixtureOld.home, b.reps);
  const newMs = benchCli(NEW, b.args(fixtureNew), fixtureNew.home, b.reps);
  console.log(
    `${b.name.padEnd(58)} old=${oldMs.toFixed(1)}ms new=${newMs.toFixed(1)}ms delta=${(oldMs - newMs).toFixed(1)}ms`
  );
}

rmSync(fixtureOld.home, { recursive: true, force: true });
rmSync(fixtureNew.home, { recursive: true, force: true });

console.log(`\ntotal: ${checks} checks, ${failures} failures`);
if (failures > 0) process.exit(1);
```

两次独立运行原始输出（等价结论逐位一致，计时方向一致）：

```
# run 1
=== startup benchmark (median wall ms per spawn) ===
--version                                                  old=175.6ms new=61.3ms delta=114.3ms
help                                                       old=175.1ms new=60.1ms delta=115.1ms
models list (configured)                                   old=176.8ms new=63.1ms delta=113.7ms
models list --available openai (touches providers/all)     old=196.8ms new=86.6ms delta=110.2ms
adapt status                                               old=177.8ms new=61.7ms delta=116.1ms
run plain fake                                             old=192.0ms new=75.5ms delta=116.5ms
run --children fake (README flow)                          old=253.1ms new=150.5ms delta=102.7ms
run --executor pi without model (fails pre-Pi-load)        old=178.2ms new=61.9ms delta=116.3ms
auth status --all (NEW pays lazy Pi load here)             old=216.6ms new=217.6ms delta=-1.0ms

total: 127 checks, 0 failures

# run 2
=== startup benchmark (median wall ms per spawn) ===
--version                                                  old=178.8ms new=60.9ms delta=118.0ms
help                                                       old=176.1ms new=61.2ms delta=114.9ms
models list (configured)                                   old=185.3ms new=61.7ms delta=123.6ms
models list --available openai (touches providers/all)     old=198.2ms new=86.6ms delta=111.7ms
adapt status                                               old=176.2ms new=60.7ms delta=115.5ms
run plain fake                                             old=190.8ms new=75.6ms delta=115.2ms
run --children fake (README flow)                          old=251.7ms new=147.2ms delta=104.5ms
run --executor pi without model (fails pre-Pi-load)        old=175.7ms new=62.6ms delta=113.1ms
auth status --all (NEW pays lazy Pi load here)             old=214.2ms new=217.5ms delta=-3.3ms

total: 127 checks, 0 failures
```

## 附录 B：committed 仿真脚本

全文见 `scripts/round04-r4i-equivalence-sim.ts`（本轮仿真回归资产；
`npx tsx scripts/round04-r4i-equivalence-sim.ts`）。结构：A.1 结构检查（两条
静态边已消失、动态边存在）→ A.2 模块身份（双重动态 import 同一命名空间/
函数对象）→ A.3 进程内 CLI 电池（14 用例 × 双夹具，golden 契约含版本串、
providers fail-fast、`--executor pi` 校验、冲突消息）→ A.4 缓存探针（spawn
子进程证 CLI 图不预载 pi-ai）→ B/C/D/E 分别裁决 S4-I-2/3/4/5。
