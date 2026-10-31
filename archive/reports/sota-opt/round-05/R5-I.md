MODEL_SLUG=claude-fable-5-thinking-xhigh

# R5-I：CLI / Pi 适配器 / 配置 / 遥测切片第五遍复查报告

**战役:** 全库持久 SOTA 优化 Round 5 / R5-I
**基线:** `cursor/sota-persistent-opt-83a1` @ `184bfd5`
**分支:** `cursor/r5-i-cli-fifth-pass-83a1`（落地提交 `3101aee`）
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**落地 1 个赢家（S5-I-1），其余 4 个第五组新角度候选/变体全部淘汰立排除（S5-I-2…S5-I-5）。**

R4-I 落地 S4-I 后预言本切片"除非找到新的 tens-of-ms 位点，否则回归 µs 级"。
第五遍找到了这个位点：S4-I 消灭 Pi 运行时子树后，`cli/main.ts` 仍然静态导入
**12 个各自只被一条分发分支消费的模块**——8 个一次性子命令 handler
（`cli/auth.js`、`cli/models.js`、`cli/adapt.js`、`cli/episode.js`、
`cli/commits.js`、`cli/pause.js`、`cli/inject.js`、`cli/doctor.js`）加上
`run/supervisor.js`（仅 `resume --supervised`）、`track/loop.js`（仅
`run --track`）、`preferences/export.js`（仅 `pref export`）、
`privacy/deletion.js`（仅 `delete`）。全库交叉检索证实 `main.ts` 是这 12 个
模块在 `src/` 内唯一的静态消费者。

S5-I-1 把这 12 条边全部改为**分发点 `await import()`**（S4-I 确立的同一模式）。
同窗三方交错基准（新旧变体逐次轮换、每次调用全新 state root、四个命令类
各 40–60 次）：**每个测得的命令类中位 spawn-to-exit 一致省 23–30ms**——
包括最重的 `run --track`（配置了自定义 provider）路径，且新构建分布显著
收紧（多数场景下新构建 max < 旧构建 p25）。

规模来源经完整证据链定位（§4）：收益**不与模块数线性相关**。约 15–20ms
来自一个此前未知的 Node v22.14 现象——`main.ts → track/loop.js` 这**一条**
静态边使整图评估触发病态量的包作用域解析（CPU profile：
`getPackageScopeConfig` self-time 25.2ms vs 1.0ms），改为动态边后该成本
消失；其余 ~5–9ms 来自非目标命令少加载 31–41 个模块的常规死重消除。

等价性由提交的确定性仿真 `scripts/round05-r5i-equivalence-sim.ts`（seeded
mulberry32）裁决：12 条静态边消失/12 条动态边存在的结构检查、引擎模块缓存
单例恒等、17 个命令用例 × 双全新夹具的输出确定性电池（含黄金契约）、以及
无竞态的 load-trace 探针（`--version` 不加载 12 者之任一；`auth` 分发只增
自身子树 4 个模块加载）——**119 检查 × 多次独立运行 0 失败**。r4i 仿真复跑
68/68 绿。切片相关测试套件全绿（唯一失败是基线上同样失败的既有环境问题：
VM Node 22.14 低于 engines >=22.19，doctor 单测对 node 版本检查行断言，
经 `git stash` 基线对照证实与本改动无关）。

其余变体/候选全部淘汰：S5-I-2（变体 B）与 S5-I-3（变体 M）是赢家的真子集，
同窗测量分别只剩 ~0–6ms 与 ~7–13ms，被完整集严格支配；S5-I-4（对共享模块
继续惰性化）经结构证明不具分支独占性且单模块边际加载为低 ms 级；S5-I-5
（直接追打 Node 解析器病态/引擎参数）超出切片文件范围。未重开任何
X* / S1-* / S2-* / S3-* / S4-* / S5-* 既有条目。

## 0. 范围与约束遵守

- 切片：`src/cli/`、`src/pi-adapter/`、`src/config/`、`src/telemetry/` 全量
  第五遍实际读码。生产改动仅 `src/cli/main.ts`（36+/20-，全部为 import 边
  移位与分发 case 块加花括号），在切片内。测试零改动。
- 先读并遵守：README / EXCLUSIONS.md 全表 / round-05/PLAN.md /
  round-01/R1-I.md / round-02/R2-I.md / round-03/R3-I.md / round-04/R4-I.md。
- **基线不变性核实**：`git diff 3b5faae..184bfd5 -- src/{cli,pi-adapter,config,telemetry}`
  输出为空——切片自 S4-I 落地提交（`3b5faae`）以来逐字节未变（期间父分支
  仅合入切片外的 S5-C/S5-F 与文档提交）。R1-I 下界表、R2-I/R3-I 收口、
  R4-I 的 21 命令等价矩阵与全部既有排除继承有效。
- 候选刻意绕开全部既有排除。特别辨析：
  - **不是重做 S4-I**。S4-I 的对象是 Pi 运行时子树（`pi-adapter/runtime.js`
    的两条边，~103–124ms 外部包加载）；本轮对象是 12 条**仓库内**分支独占
    边，S4-I 落地时这些边原样保留（R4-I §5 逐文件收口也未涉及）。模式相同、
    位点全新，且规模来源（解析器病态 + 死重）与 S4-I（外部包冷载）不同。
  - 未触碰 S4-I-2（checkpoint PAUSED 探针）、S4-I-4（冲突检查提升）：
    本改动不移动任何检查/错误选择顺序——每条动态 import 落在与原静态绑定
    首次使用完全相同的控制流位置之前，错误面逐字节保持（仿真 A.3 黄金契约
    钉死 cliFail 文案与 exit）。
  - 凭据面零触碰：`auth.js` 只是从启动图挪到 `auth` 分发点，
    `FileCredentialStore` / `auth-session.ts` 内部结构不变（S2-I-1 /
    S3-I-3 / S4-I-4 家族未重开）。
- 硬不变量全部满足：双 LCB / 双归因 / 阈值 / 数据面契约 / 公开签名（
  `main.ts` 的导出集合不变：`main`、`CliIo`、`deleteCommand` 等）均不触。
  分析不改在途 run；tracking 无指挥权。不声称 Outcome-supported。

## 1. 第五遍搜索：启动图普查与候选枚举

R4-I 已把外部包从非 Pi 命令中消灭；第五遍先做**仓库内模块图普查**回答
"下一个大常数在哪"：

1. **加载集测量**（`module.register` load-hook 计数）：基线 `--version`
   加载 **149 个 src 模块、0 个外部包模块**。逐模块 load 相位计时全部
   sub-2ms、无单点热模块——成本是分布式的（~0.3–0.6ms/模块量级）。
2. **分支独占性枚举**：对 `main.ts` 顶部每条静态 import 检索全文消费点。
   恰好 12 个模块的全部消费点各自落在单一分发分支内（见结论清单）；
  全库检索证实 `src/` 内无其他静态导入者。其余静态依赖（`run/replay.js`、
   `preferences/service.js`、`cli/model-catalog.js` 等）都被 ≥2 条常驻命令
   路径消费，不具独占性（仿真 Part C 钉死）。
3. **模块纯度核查**：12 个目标模块及其独占子树无模块作用域副作用
  （无顶层 `process.env` 读取 / `Date.now()` / `Math.random()` / 顶层 await /
   可观察 I/O），无反向静态边回 `main.js`——惰性化不改变任何可观察时序。
4. **遥测/config/pi-adapter 零候选**：R3-I 收口的 `invocationError` 下界与
   R4-I 后的 pi-adapter 惰性结构本轮复核未变，不硬凑。

## 2. 落地项 S5-I-1：12 条分支独占边的分发点惰性加载

### 2.1 机制

- 8 个子命令 handler 的动态 import 位于各自 `case` 块首行；
  `track/loop.js` / `run/supervisor.js` / `preferences/export.js` /
  `privacy/deletion.js` 的动态 import 位于原静态绑定首次使用的紧前一行。
  ESM 引擎缓存保证单例与函数恒等（仿真 A.2）。
- 对非目标命令：`--version` 类从 149 模块降至 **108 模块**（-41）；
  `run --track` 从 149 降至 118（-31，track 子树在分发点按需回载，
  边际成本实测仅 3.1–3.5ms）。
- 分发点新增的每次调用开销：已缓存 `await import` 实测 67µs/次（tsx hook
  环境上界；裸 node 更低）——每命令一次，噪声级（仿真 Part B）。

### 2.2 规模收益（同窗三方交错，spawn-to-exit 中位墙钟）

方法：base（基线）/ fulls（S5-I-1 全集）/ 对照变体三个 dist 树逐次轮换
起序、每次调用全新 state root（configured 场景预写 providers.json）、
`--version` 60 次/变体、run 场景 40 次/变体，环境剔除 NODE_COMPILE_CACHE。

第一轮（对照 = 变体 B，见 S5-I-2）：

| 场景 | base 中位 | S5-I-1 中位 | Δ | 变体 B Δ |
|---|---|---|---|---|
| `--version` | 77.8ms | 55.8ms | **-22.0ms** | -0.0ms |
| `run --children`（默认目录） | 130.3ms | 101.8ms | **-28.5ms** | -6.4ms |
| `run --children`（配置 provider） | 125.5ms | 98.9ms | **-26.5ms** | -2.9ms |
| `run --track`（配置 provider） | 149.2ms | 122.4ms | **-26.8ms** | -5.4ms |

第二轮（独立重跑，对照 = 变体 M，见 S5-I-3）：

| 场景 | base 中位 | S5-I-1 中位 | Δ | 变体 M Δ |
|---|---|---|---|---|
| `--version` | 79.5ms | 53.5ms | **-26.0ms** | -11.3ms |
| `run --children`（默认目录） | 129.6ms | 100.0ms | **-29.6ms** | -12.3ms |
| `run --children`（配置 provider） | 132.7ms | 106.3ms | **-26.4ms** | -12.7ms |
| `run --track`（配置 provider） | 149.3ms | 126.2ms | **-23.1ms** | -6.9ms |

分布收紧同样显著（第二轮 children-default：新 p25–p75 = 98.8–102.0ms，
旧 = 121.7–139.0ms；新 max 107.8 < 旧 min 110.4）。真实安装布局复核
（`/workspace/dist` 内逐次换入 main.js，25 次交错）：`--version` 中位
fulls 52.7 / base 73.4 / 变体 B 76.1ms——收益不依赖基准目录布局。

**测量教训（记录在案）**：早期非同窗两轮对比曾给出"children-config 仅
+3.4ms、track-config 回退 -7~-10ms"的假信号；改为同窗逐次轮换 + 每调用
全新夹具后被推翻并稳定复现相反结论。时间漂移在 20ms 量级效应上足以反号，
本切片今后的基准一律要求同窗交错。

### 2.3 等价裁决

- **提交仿真** `scripts/round05-r5i-equivalence-sim.ts`（seeds
  0x55a101–0x55a103）：A.1 结构（12 静态边消失 + 12 动态边存在）；A.2
  乱序重复动态 import 的命名空间/函数恒等；A.3 输出确定性电池——17 个
  用例覆盖全部 12 条惰性分支（`--version`、8 个 handler 的 help/status/
  错误路径、`pref export`、`delete`、`run --track --assume-defaults`
  全流程 COMPLETED、`resume --supervised`），每用例双全新夹具，raw 逐字节
  或 id/时间戳归一化后逐字节，黄金契约钉死版本串、usage 文案、cliFail
  文案与 exit；A.4 load-trace 探针（hook 同步写文件，无消息竞态）：
  `--version` 的加载集不含 12 者之任一，`auth` 分发只新增自身子树。
  **119 检查 × 多次独立运行 0 失败**。
- **r4i 仿真复跑**：68/68 绿 × 2 次独立运行（S4-I 语义未被本改动扰动）。
- 探索期另做过 21 命令 old-vs-new dist 输出矩阵（全过），最终以提交仿真
  为准。

## 3. 候选三条件裁决总表

| ID | 候选 | 不在排除表 | 理论+仿真证明 | 真实规模 | 判定 |
|---|---|---|---|---|---|
| S5-I-1 | 12 条分支独占边分发点惰性化 | ✓ | ✓（119 检查） | ✓ -23~-30ms/调用 | **落地** |
| S5-I-2 | 变体 B：11 条惰性、track/loop 保静态 | ✓ | 是赢家子集 | ✗ -0~-6ms | 淘汰 |
| S5-I-3 | 变体 M：仅 track/loop 惰性 | ✓ | 是赢家子集 | ✗ -7~-13ms | 淘汰 |
| S5-I-4 | 共享模块（replay/service/model-catalog…）继续惰性化 | ✓ | 结构反证（Part C） | ✗ µs~低 ms/模块 | 淘汰 |
| S5-I-5 | 直接追打 Node 解析器病态 / 引擎参数 | ✓ | — | 切片外 | 淘汰 |

## 4. 机制深挖：收益为何不与模块数线性相关

完整证据链（全部在同一 VM、同一 Node v22.14.0 复现）：

1. **模块计数悖论**：`--version` 加载集 base=149 / 变体 B=118 / 全集=108。
   变体 B 少 31 个模块却与 base 同速（中位 77.8 vs 77.8ms）；全集再少
   10 个（track 独占子树：`requirement/*` 6 个 + `track/*` 4 个）却快 22ms。
2. **边际成本排除**：进程内先 import 全集 main.js（39.9–41.8ms）再 import
   `track/loop.js`，边际仅 3.1–3.5ms——10 个模块本身便宜。
3. **图形状排除**：wrapper 静态共导 `main.js` + `track/loop.js`（同样的
   118 模块集，track 为兄弟边）41.8–43.7ms ≈ 全集；同树内文件对换证实
   效应完全跟随 main.js 字节（main 38.7–42.2 / main-vb 54.1–65.8 /
   main-base 68.6–79.6ms）。
4. **单边注入复现**：向全集 main.js 中部插入一行裸 `import "../track/loop.js";`
   即复现全额劣化（56.4–65.9ms），插在最前同样慢（61.5–80.6ms）；对照组
   插入已在图中的 `import "../run/flowchart-run.js";` 无效应（39.8–43.3ms）。
   → 病态条件是"**track/loop 作为 main.js 的直接静态依赖**"，与文本位置、
   模块集合、图大小均无关。
5. **GC 排除**：`--trace-gc` 三变体 scavenge 全部 sub-1.1ms、次数相近。
6. **CPU profile 定位**：`--cpu-prof` 差分（A=全集 58.8ms，B=vb 83.2ms）：
   `getPackageScopeConfig`（原生帧）self-time **1.0ms → 25.2ms（+24.2ms）**，
   次位 `openFileHandle` +4.1ms——多出的时间几乎全部在 Node ESM 解析器的
   包作用域（package.json scope）查找里。
7. **hook 路径反证**：注册 resolve customization hook 后（解析走 hooks
   线程路径）两变体解析总量几乎相同（414 次/11.0ms vs 458 次/11.8ms），
   差距消失——病态只存在于默认无 hook 的进程内解析快路径。

未能（也无需）钉死 Node 内部的确切分支；对裁决而言充分的是：效应强局域
（单边触发/单边消除）、跨布局稳定复现、且落地改动**无论该病态是否存在都
成立**（死重消除 + 分布收紧独立贡献 ~5–9ms 与尾部收紧）。环境注记：VM
Node v22.14.0 < engines >=22.19.0，病态幅度可能随 Node 版本变化——已写入
S5-I-5 重开条件。

## 5. 测试与验证

- `pnpm build` / `pnpm typecheck` / `pnpm lint` 全绿。
- 单测 `test/unit/{cli,config,telemetry,pi-adapter}`：66 tests，65 pass，
  1 fail = `doctor reports developer preview...`——断言 doctor exit 0，而
  VM Node 22.14 触发 `FAIL node: 22.14.0 (engines >=22.19.0)` 检查行；
  `git stash` 后基线**同样 1 fail**，与本改动无关（环境既有）。未改测试。
- 集成 `test/integration/{cli,pi-adapter,track}`：64 tests，63 pass，
  1 skip（既有），0 fail。
- 关联平面单测 `test/unit/{run,supervisor,preferences,privacy,track}`：
  185/185 pass。
- 仿真：r5i 119/119 × 多次独立运行；r4i 复跑 68/68 × 2。

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 内容 | 淘汰理由 | 重开条件 |
|---|---|---|---|
| S5-I-2 | 变体 B：8 handler + supervisor/export/deletion 惰性，`track/loop` 保持静态 | 同窗测量回到基线水平（-0~-6ms）：单条静态 track 边重新触发解析器病态，吞掉几乎全部收益 | Node 解析器行为改变使该边免费，且 handler 死重单独测得 ≥ 两位数 ms |
| S5-I-3 | 变体 M：仅 `track/loop` 惰性，其余 11 条保持静态 | 只拿到约一半（-7~-13ms），被落地全集严格支配 | 若全集因维护性回退，M 是保住约半数收益的最小回退版 |
| S5-I-4 | 对共享模块（`run/replay.js`、`preferences/service.js`、`cli/model-catalog.js` 等）继续点用处惰性化 | 不具分支独占性（仿真 Part C：各 ≥2 常驻调用点），任何主命令都要付；单模块边际加载 µs~低 ms 级，低于落地线一个量级 | 未来重构使某重型共享子树变为分支独占 |
| S5-I-5 | 直接追打 Node `getPackageScopeConfig` 病态（改 dist 布局 / package.json scope 钉桩 / `--max-semi-space-size` 等引擎参数） | 超出切片文件范围（构建布局/引擎旗标非 src）；GC 旗标实测无稳定相对收益；病态与 Node 版本绑定 | 引擎升级到 ≥22.19 后复测 §2.2 表；若病态在上游仍在，向 Node 报 issue 而非仓库内规避 |

## 7. MORE_OPTIMA 判定

**no。** 依据：(a) 执行期热路径已由 R2-I/R3-I 收口到逐行下界；(b) 启动图
经 S4-I（外部包）+ S5-I-1（仓库内分支独占子树）两刀后，剩余 108 个静态
模块全部被 ≥2 条常驻命令路径共享（仿真 Part C 钉死代表性三者），无单点
热模块（逐模块 load 相位 sub-2ms），继续切分只剩 µs~低 ms 级且要付多点
import 的复杂度；(c) 对真实工作流（run 族）而言剩余静态图恰是其必需集，
把 `--version`/`help` 再砍到 ~15ms 无用户价值。唯一已知的翻盘变量是
Node 版本升级改变解析器病态幅度——那是重测触发器（S5-I-5 重开条件），
不是本切片的剩余工作。

## 附录 A：同窗三方交错基准 harness（临时，未提交；完整可复现）

```js
// r5i-bench3.mjs — base / fulls / <对照变体> 三 dist 树逐次轮换起序，
// 每次调用全新 state root；configured 场景预写 providers.json。
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const WS = "/workspace";
const VARIANTS = [
  ["base", join(WS, ".r5i-bench/dist-base/cli/main.js")],
  ["fulls", join(WS, ".r5i-bench/dist-fulls/cli/main.js")],
  ["vb", join(WS, ".r5i-bench/dist-vb/cli/main.js")] // 第二轮换成 dist-m
];

const FIX = "/tmp/r5i-fix";
rmSync(FIX, { recursive: true, force: true });
mkdirSync(join(FIX, "project"), { recursive: true });
writeFileSync(join(FIX, "project", "package.json"), JSON.stringify({ name: "bench-project", version: "1.0.0" }));
writeFileSync(
  join(FIX, "children.json"),
  JSON.stringify({
    tasks: [
      { id: "tsk_bench_a", role: "implementer", objective: "Implement feature A for benchmark" },
      { id: "tsk_bench_b", role: "tester", objective: "Test feature A for benchmark" }
    ]
  })
);
const PROVIDERS = {
  version: 1,
  enabled: [],
  customProviders: [
    {
      id: "acme",
      baseUrl: "https://acme.example/v1",
      models: [
        { id: "acme-large", contextWindow: 200000, maxTokens: 8192, inputCostPerMTok: 3, outputCostPerMTok: 15, reasoning: true },
        { id: "acme-small", contextWindow: 100000, maxTokens: 8192, inputCostPerMTok: 0.3, outputCostPerMTok: 1.5 }
      ]
    }
  ]
};

const env = { ...process.env };
delete env.NODE_COMPILE_CACHE;
delete env.NODE_OPTIONS;

let stateCounter = 0;
function freshStateRoot(withProviders) {
  const root = join(FIX, `state-${stateCounter++}`);
  if (withProviders) {
    mkdirSync(join(root, "runtime"), { recursive: true });
    writeFileSync(join(root, "runtime", "providers.json"), JSON.stringify(PROVIDERS, null, 2) + "\n");
  } else {
    mkdirSync(root, { recursive: true });
  }
  return root;
}

const SCENARIOS = [
  { name: "version", reps: 60, providers: false, args: () => ["--version"] },
  {
    name: "children-default", reps: 40, providers: false,
    args: (sr) => ["run", "--project", join(FIX, "project"), "--objective", "Build feature A", "--children", join(FIX, "children.json"), "--state-root", sr]
  },
  {
    name: "children-config", reps: 40, providers: true,
    args: (sr) => ["run", "--project", join(FIX, "project"), "--objective", "Build feature A", "--children", join(FIX, "children.json"), "--state-root", sr]
  },
  {
    name: "track-config", reps: 40, providers: true,
    args: (sr) => ["run", "--project", join(FIX, "project"), "--objective", "Build feature A", "--track", "--assume-defaults", "--executor", "fake", "--state-root", sr]
  }
];

function q(sorted, p) {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

const results = {};
const failures = [];
for (const sc of SCENARIOS) {
  results[sc.name] = Object.fromEntries(VARIANTS.map(([v]) => [v, []]));
  for (let rep = 0; rep < sc.reps; rep++) {
    const order = [0, 1, 2].map((i) => VARIANTS[(i + rep) % 3]);
    for (const [vname, entry] of order) {
      const sr = sc.name === "version" ? null : freshStateRoot(sc.providers);
      const args = sc.args(sr);
      const t0 = performance.now();
      const r = spawnSync(process.execPath, [entry, ...args], { env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
      const dt = performance.now() - t0;
      if (r.status !== 0) failures.push({ scenario: sc.name, variant: vname, status: r.status });
      else results[sc.name][vname].push(dt);
      if (sr !== null) rmSync(sr, { recursive: true, force: true });
    }
  }
}

if (failures.length > 0) console.log("FAILURES:", failures.length);
for (const [name, byVariant] of Object.entries(results)) {
  console.log(`\n== ${name} ==`);
  const med = {};
  for (const [vname, arr] of Object.entries(byVariant)) {
    const s = [...arr].sort((a, b) => a - b);
    med[vname] = q(s, 0.5);
    console.log(
      `${vname.padEnd(6)} n=${s.length} min=${s[0].toFixed(1)} p25=${q(s, 0.25).toFixed(1)} med=${q(s, 0.5).toFixed(1)} p75=${q(s, 0.75).toFixed(1)} max=${s[s.length - 1].toFixed(1)}`
    );
  }
}
```

配套机制取证工具（load 计数 hook、逐模块 load 计时 hook、resolve 计数
hook、`--cpu-prof` 差分器、单边注入/对照文件、wrapper 共导入口）均为
一次性 /tmp 脚本，关键数值已全部录入 §1/§2/§4；`.r5i-bench/` dist 树为
基准期临时产物，未提交。

## 附录 B：committed 仿真脚本

`scripts/round05-r5i-equivalence-sim.ts`（本分支 `3101aee` 提交）。
运行：`npx tsx scripts/round05-r5i-equivalence-sim.ts`，预期
`total: 119 checks, 0 failures`、exit 0。
