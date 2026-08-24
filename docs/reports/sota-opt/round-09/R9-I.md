MODEL_SLUG=claude-fable-5-thinking-xhigh

# R9-I：CLI / Pi adapter / config / telemetry 第九遍复查报告（S1-I + S4-I + S5-I-1 + S7-I-1 之上）

- 基线：`cursor/sota-persistent-opt-83a1` @ `b58d859`（含 S9-A-1 / S9-B-1..4 / S9-C-1..4 / S9-D-1..4 / S9-E-1..3 / S9-F-1..3 排除；报告撰写前再次 `git fetch origin cursor/sota-persistent-opt-83a1` 核对 FETCH_HEAD 仍为 `b58d859`）。切片最后一次改动仍是 S7-I-1 落地提交 `8dee7fb`，`git diff 8dee7fb..HEAD -- src/cli src/pi-adapter src/config src/telemetry` 为空——**零漂移，连续第二轮字节不变**。全仓 `src/` 自 `8dee7fb` 后仅 `src/experiments/{canary,plan,shadow}.ts` 与 `src/routing/offline-logit.ts` 变动（S7-C / S7-F / S9 系已落地项），全部切片外；`package.json` / `pnpm-lock.yaml` 亦零漂移（`git diff --quiet` 通过）。
- **切片清单核实（派单指令项）：25 文件**（cli 13 / pi-adapter 9 / config 2 / telemetry 1），`git ls-files`@HEAD 与 `git ls-tree -r 8dee7fb` 双向核对逐目录一致。派单沿承的「~28（cli 16）」出自 R8-I 头部笔误计数（R7-I 记载 cli 12 / pi-adapter 8 亦偏小）；git 为权威，全表见 §0。清单差异是**计数笔误而非文件漂移**——两个提交点的文件集合逐字相同。
- 前置阅读：README、EXCLUSIONS 全表（含 S9-A-1 / S9-B-1..4 / S9-C-1..4 / S9-D-1..4 / S9-E-1..3 / S9-F-1..3 全系）、round-09/PLAN、round-08/PLAN + R8-I、round-07/R7-I ～ round-01/R1-I，25 个切片源文件全量实际读码（未依赖历轮记忆）。
- 分支：`cursor/r9-i-cli-ninth-pass-83a1`（已推送，未开 PR）。
- 环境：**双 Node 版本实测**——VM 默认 22.14.0（`/exec-daemon/node` shim 遮蔽 nvm，基准全部显式传二进制全路径）与 nvm 22.22.2（engines ≥22.19 合规）。pnpm 10.17.1，`pnpm install --frozen-lockfile`（本 VM node_modules 初始缺失，冷装）+ `pnpm build` 后对 `dist/cli/main.js` 测 spawn-to-exit。`@earendil-works/pi-ai` **0.84.1**，与 R7-I/R8-I 同版本；exports 图逐项复核仍为 7 项（`.`、`./compat`、`./providers/*`、`./api/*`、`./oauth`、`./bedrock-provider`、`./bun-oauth`），**无与模型表版本锁定的轻量 provider-id 子路径——S8-I-1 的唯一重开条件未满足**。

## 结论

**无可落地的新更优解，本轮生产代码零改动，切片维持关闭（MORE_OPTIMA=no）。** 本轮按派单定位执行「漂移 + 新结构检查」，非强造候选：

1. **零漂移三重确认**：切片源码（`git diff 8dee7fb..HEAD` 空）、依赖面（`package.json`/`pnpm-lock.yaml` 字节不变、pi-ai 0.84.1 exports 图未变）、切片外邻域（自 `8dee7fb` 起 `src/` 改动全部落在 experiments/routing 已落地项）。R8-I 关闭矩阵所依据的结构前提在本基线上逐项成立，无任何新增文件、新增导入边或新命令类。
2. **本 VM 锚点/矩阵抽测复测（未拷贝 R8-I 数字）**：对 R8-I 矩阵的承重单元格（地板 + builtin/custom × children/track，共 5 格 × 2 Node 版本，configured 态夹具、每迭代全新拷贝 state-root）实测，结构与 R8-I 逐格同构：地板 55.1/53.1 ms，builtin 目录构建 +48~+76 ms，**custom−builtin 差 children +53.9 / track +49.4 ms@22.14.0、+26.9 / +28.2 ms@22.22.2**（R8-I 带：+53.8/+46.2 与 +28.6/+29.2）。进程内冷载锚点：`providers/all` 52.6~69.3 ms@22.14 / 31.1~32.2 ms@22.22；per-provider 表 anthropic 3.4~4.9 / 2.4~2.6 ms、openai 1.6~2.7 / 0.8 ms——S7-I-1 的 per-provider 优势（~10-25×）与 custom 态回退归属完好（§1）。矩阵中唯一剩余的数十 ms 结构仍是 custom/mixed 态的 `providers/all` 失手回退，其唯一消除形态（跳过回退）持有 documented soundness counterexample（S8-I-1）且被硬不变量明令封死，重开条件（pi-ai 上游轻量 id 导出）本轮复核未满足。
3. **新角度枚举为空（有理由的空枚举，§2）**：以「机制分类 × 排除表覆盖」双向扫描，本轮识别的全部形态要么是排除行逐字重现（预热重叠=S8-I-2、跳回退=S8-I-1、enabled 并行化=S8-I-3/S7-I-3 族、compile-cache/分派拆分=S6-I 系、一次性命令类=S7-I-4、凭据面=S1-I-5），要么是已关闭类的机制变体（跨进程磁盘缓存 builtin 目录=S8-I-1 的「绕开回退权威源」同族 + 新数据面缓存契约，双重违规），要么物理上无收益（进程内失手记忆化——ESM 模块缓存已使第二次导入 ~0.6 ms，r7i 仿真 part D 实测在案）。**未铸造任何 S9-I-* 新 ID，无新增排除提议。**
4. **验证面**：三个已落地赢家的等价性仿真在本基线全部复跑通过（r7i 80 checks / r4i 68 / r5i 119，全 0 失败）；全测试套件在 22.22.2 绿（**1168 pass / 0 fail / 1 skip**）。22.14.0 下唯一失败是 `test/unit/cli/doctor.test.ts` 的 engines 检查用例——doctor 的 `node:` 预检在低于 engines ≥22.19 的解释器上 fail-closed（设计行为），**环境工件而非基线破损**，同用例在 22.22.2 exit 0（§3）。记录在案以免后续轮次误判为漂移。

不声称 Outcome-supported；Checkpoint F-PROD 仍开放（ADR-005）。双 LCB 与双归因未动；凭据/数据面契约未触碰（file-credential-store / auth-session 仅只读测量）；无阈值/测试/公开签名变更。仓库变更仅本报告一个文件；无赢家故未提交 `scripts/round09-r9i-equivalence-sim.ts`（抽测 harness 与锚点脚本全文进附录 A，遵守 R7-F/R8-C/R8-F 纪律）。

## 0. 范围与约束遵守

- 阅读顺序按令执行：README → EXCLUSIONS 全表（含 S9-A..F 六切片全系新行）→ round-09/PLAN → round-08/PLAN + R8-I → R7-I..R1-I → 25 个切片源文件全量重读。
- **切片清单（git 权威，@HEAD 与 @8dee7fb 逐字相同）**：
  - `src/cli/`（13）：adapt.ts、auth.ts、commits.ts、doctor-overlay.ts、doctor.ts、episode.ts、errors.ts、flowchart-io.ts、inject.ts、main.ts、model-catalog.ts、models.ts、pause.ts
  - `src/pi-adapter/`（9）：auth-session.ts、cluster-tools.ts、file-credential-store.ts、index.ts、listed-model-common.ts、listed-model-lazy.ts、listed-model.ts、pi-executor.ts、runtime.ts
  - `src/config/`（2）：model-ref.ts、providers-config.ts
  - `src/telemetry/`（1）：model-invocation.ts
- 未重开任何 X* / S1-* ～ S8-* / S9-A-1 / S9-B-1..4 / S9-C-1..4 / S9-D-1..4 / S9-E-1..3 / S9-F-1..3 条目。逐条对照：
  - **未重做已落地赢家 S1-I / S4-I / S5-I-1 / S7-I-1**：`--children` 的 smartChildPlan 目录复用、Pi runtime 点用处 `await import`、12 个分支独占分派模块惰性导入、per-provider 惰性模型表全部原样在位（本轮零漂移即其字节级证明；三个等价性仿真复跑通过为其行为级证明）。
  - **未重开 S8-I-1**（custom id 跳回退）：本轮仅复核其重开条件（pi-ai exports 图），未满足，维持淘汰。硬不变量「providers/all 失手回退 + throw-outside-catch 不动」逐字在位（`listed-model-lazy.ts` 未动）。
  - **未重开 S8-I-2**（预热 providers/all）与 **S8-I-3**（enabled 循环并行化）：R8-I 理论否决（无可重叠 I/O 窗口 / µs 级 + 错误选择分歧）在零漂移基线上原样成立。
  - **未重开 S1-I-5**（`auth status --all` 凭据面围栏）与 **S7-I-4**（`models list --available` 一次性命令类）：按派单明令，二者未立项、本轮亦未测量（R8-I 数字仍为在案记录）。
  - **未重开 S6-I-1..3**（剩余独占边惰性 / `module.enableCompileCache()` / 分派拆分）、**S5-I-2..5**（dist 布局向 getPackageScopeConfig 开刀）、**S7-I-2/3**、**S3-I-1**（invocations 验证器）、S2-I / S3-I / S4-I-2..5 全系其余条目。
  - **veteran 态 invocations.jsonl 线性成本**维持 R3-I 量化 + R7-I 关闭记载，不重复立项。
- 硬不变量（生产零 diff 下天然成立，仍逐条核对）：分析不变更在飞 run；tracking 无指挥权；H/score 不写 PASS/FAIL；Live=R0 等价；双 LCB / 双归因在位；提升 proposal-first；CAS / 凭据 / 数据面契约 / 公开签名不动；`listed-model.ts` 同步公开面与惰性面字节等价关系未动；`file-credential-store.ts` / `auth-session.ts` 凭据路径仅只读；未改任何测试与阈值。
- 未编辑 EXCLUSIONS.md / PROGRESS.md / 任何 PLAN.md；未开 PR。

## 1. 本 VM 复测：矩阵抽测 + 进程内锚点（双 Node，未拷贝 R8-I 数字）

R8-I 已完整交付 4 配置态 × 9~10 命令类 × 2 Node = 78 格矩阵（全 exit 0）。本轮为漂移检查，不重复全矩阵，而是抽测其**承重格**（结论所依赖的地板格与「唯一剩余数十 ms 结构」的 8 个加粗格中的 4 个），configured 态夹具（R7-I 教训：默认空配置夹具遮蔽 configured 主路径），每格 2 预热 + 10 测量、每迭代全新拷贝 state-root、`--executor fake` 域内命令、显式二进制全路径。harness 全文见附录 A.1。

### 1.1 抽测中位数（ms，spawn-to-exit）

| 格 | 22.14.0（`/exec-daemon/node`） | 22.22.2（nvm 全路径） |
|---|---|---|
| `--version`（地板） | 55.1 (min 54.1, p90 56.7) | 53.1 (50.7, 56.0) |
| run-children@builtin | 108.6 (106.7, 112.7) | 103.5 (102.3, 105.5) |
| run-track@builtin | 131.2 (128.2, 132.3) | 122.1 (118.1, 126.0) |
| run-children@custom | **162.5** (154.4, 172.9) | **130.4** (127.5, 133.0) |
| run-track@custom | **180.6** (172.3, 184.1) | **150.3** (146.6, 160.4) |

全部 exit 0。结构与 R8-I 逐格同构：

- **custom−builtin 差**：children **+53.9 / +26.9**、track **+49.4 / +28.2** ms（22.14/22.22）。R8-I 带 +53.8/+28.6 与 +46.2/+29.2——同号、同量级、同 Node 版本梯度。归属未变：`buildLiveCatalogConfig` → `resolveListedModelLazy` → per-provider 导入对 custom id 失手 → `providers/all` 回退（`listed-model-lazy.ts`，S7-I-1 落地时明文保留的等价性前提）。
- **builtin 态目录构建**只比地板贵 +53.5/+50.4（children）——S7-I-1 的 per-provider 表 + S1-I 目录复用在 configured 态按设计工作，无回归。
- **Node 版本项**：22.22.2 恰好在触发 `providers/all` 的 custom 格上省 27~32 ms，地板与 builtin 格仅 −2~−9 ms——与 R7-I/R8-I 记载的 `getPackageScopeConfig` 病理属 Node 版本项的判断继续吻合。环境项，非切片代码角度。

### 1.2 进程内冷载锚点（附录 A.2 脚本，各 3 次）

| 锚点 | 22.14.0 | 22.22.2 |
|---|---|---|
| `providers/all` 冷载 | 52.6 / 57.3 / 69.3 ms | 32.2 / 31.4 / 31.1 ms |
| `providers/anthropic.models` | 3.4 / 4.9 / 3.4 ms | 2.6 / 2.4 / 2.4 ms |
| `providers/openai.models` | 2.0 / 2.7 / 1.6 ms | 0.8 / 0.8 / 0.8 ms |
| `providers/all`（三表已载后） | 80.9 / 70.0 / 45.7 ms | 28.7 / 28.8 / 28.6 ms |

per-provider 表相对 `providers/all` 的 ~10-25× 优势在两个 Node 版本上完好；custom 态 in-CLI 边际（+27~+54 ms）与进程内锚点自洽。22.14 的「已载三表后仍 45~81 ms」再次证明 `providers/all` 的成本主体是其余 ~40 个 provider 模块的解析/编译而非模型表本体——跳过它的唯一收益路径就是 S8-I-1 被封死的那条。

## 2. 新角度枚举：有理由的空枚举

方法：对切片成本池按「结构位置 × 消除机制」双向扫描（导入图惰性化 / 计算复用 / 缓存 / 并行重叠 / 语义降级），每个形态先对 EXCLUSIONS 全表 + 八轮 I 报告做同机制先例检索，只有「排除表未覆盖且理论收益 ≥ 数十 ms」者才立项。本轮扫描结果：**零个可立项形态**，逐类裁决如下（均未铸造新 ID——按方法论，排除行逐字重现与已关闭类的机制变体不重复立项）：

| 形态 | 理论收益位 | 裁决 | 对应先例 |
|---|---|---|---|
| 跳过 custom id 的 providers/all 回退 | custom 态 −27~−54 ms | 排除行逐字重现；重开条件（pi-ai 轻量 id 导出）复核未满足（exports 图 7 项未变） | S8-I-1 + 硬不变量明令 |
| 与 config 读并行预热 providers/all import | custom 态部分重叠 | 排除行逐字重现：模块实例化是主线程 CPU、无可重叠 I/O 窗口；「将需回退」的判断依赖 config 读完成 | S8-I-2 |
| **跨进程磁盘缓存 builtin 目录**（首次回退后将解析结果序列化进 state-root，后续 spawn 免载 providers/all） | custom 态 −27~−54 ms/次（首次除外） | **已关闭类的机制变体，双重违规**：(a) 与 S8-I-1 同族——绕开「providers/all 为回退权威源」，缓存陈旧 vs 包升级时裁决静默偏离 live 表，正是 S8-I-1 反例的 fail-divergent 形态换了载体；(b) 引入新数据面缓存契约与失效协议，撞「CAS / 数据面契约不动」硬不变量。不立项 | S8-I-1 族 + 硬不变量 |
| 进程内记忆化回退失手结果 | custom 态多 id 时第二次起 | 物理无收益：ESM 模块缓存已使第二次 `import("providers/all")` ~0.6 ms（r7i 仿真 part D 本轮复跑实测），失手后的逐 id 查找是 µs 级、once-per-process | 计量否决（µs 线） |
| enabled 循环 Promise.all 化 | µs 级 | 排除行逐字重现（错误选择分歧：多未知 id 时哪个 DomainValidationError 先浮出） | S8-I-3 / S7-I-3 / S2-J-10 族 |
| VM Node 引擎升级（22.14→≥22.19） | custom/一次性格 −27~−36 ms | 环境项非切片代码；doctor 的 engines 预检已 fail-closed 把关（§3 实证）；R8-I §1 第 4 条已记录 | 环境项 |
| 漂移带来的新导入边/新命令类 | — | 不存在：切片、依赖、pi-ai exports 三重零漂移（头部核查） | — |

**提议排除 ID：无。** 切片在现行排除表与硬不变量下不存在可达数十 ms 落地线的候选；R8-I 的关闭判断在本基线、本 VM 上逐项复核成立。

## 3. 验证面（本 VM）

- **等价性仿真复跑**（三个已落地赢家，零漂移基线上的行为级回归验证）：`round07-r7i-equivalence-sim.ts` **80 checks / 0 failures**（含 part D 载荷探针：builtin 构建后 providers/all 仍冷 75.8 ms、custom 回退后缓存命中 0.6 ms）；`round04-r4i-equivalence-sim.ts` **68 / 0**；`round05-r5i-equivalence-sim.ts` **119 / 0**。
- **全测试套件**：
  - 22.22.2：**1169 tests，1168 pass / 0 fail / 1 skip**（skip 为既有标记）。
  - 22.14.0（VM 默认）：1167 pass / **1 fail** —— `test/unit/cli/doctor.test.ts`「doctor reports developer preview and fake-executor next steps」：doctor 的 `node:` 预检对低于 engines ≥22.19 的解释器 FAIL → exit 1，用例断言 exit 0。**设计行为（fail-closed engines 检查）在不合规解释器上的环境工件，非代码漂移**——同用例在 22.22.2 通过，且本轮切片零改动。记录在案：后续轮次在 22.14 VM 上复跑测试时勿误判为基线破损；正确做法是 nvm 22.22.2（历轮同处理）。
- **构建/类型**：`pnpm build` 通过（dist 产物即 §1 基准对象）。

## 4. MORE_OPTIMA 判定

- 结构性新角度：无（§2 空枚举，逐形态有理由）。
- 剩余赢家：无（唯一数十 ms 结构被 S8-I-1 健全性反例 + 硬不变量封死，重开条件未满足）。
- 矩阵空洞：无（R8-I 78 格全覆盖；本轮承重格抽测同构复现，configured 态夹具无新盲区）。

**MORE_OPTIMA=no。**

---

## 附录 A：本轮测量资产（未提交 scripts/，遵守无赢家纪律）

### A.1 矩阵抽测 harness（/tmp/r9i-bench/spot.mjs）

```js
// R9-I spot re-measure: floor + builtin/custom children+track cells (R8-I harness style).
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const CLI = "/workspace/dist/cli/main.js";
const ROOT = "/tmp/r9i-bench";
const FIX = join(ROOT, "fixtures");
const WORK = join(ROOT, "work");
const nodeBin = process.argv[2];
const WARMUP = 2, ITERS = 10;

const customProvider = {
  id: "customco", name: "Custom Co", baseUrl: "http://127.0.0.1:59999/v1", envVar: "CUSTOMCO_API_KEY",
  models: [
    { id: "custom-big", name: "Custom Big", contextWindow: 200000, maxTokens: 8192, inputCostPerMTok: 3, outputCostPerMTok: 15 },
    { id: "custom-small", name: "Custom Small", contextWindow: 100000, maxTokens: 4096, inputCostPerMTok: 0.3, outputCostPerMTok: 1.5 }
  ]
};
const states = {
  builtin: { version: 1, enabled: ["anthropic/claude-fable-5", "anthropic/claude-haiku-4-5", "openai/gpt-4o"], primary: "anthropic/claude-fable-5", fast: "anthropic/claude-haiku-4-5", customProviders: [] },
  custom: { version: 1, enabled: ["customco/custom-big", "customco/custom-small"], primary: "customco/custom-big", fast: "customco/custom-small", customProviders: [customProvider] }
};
rmSync(FIX, { recursive: true, force: true });
mkdirSync(FIX, { recursive: true });
for (const [name, cfg] of Object.entries(states)) {
  const dir = join(FIX, `state-${name}`);
  mkdirSync(join(dir, "runtime"), { recursive: true });
  writeFileSync(join(dir, "runtime", "providers.json"), JSON.stringify(cfg, null, 2) + "\n");
}
const PROJ = join(FIX, "project");
mkdirSync(join(PROJ, "src"), { recursive: true });
writeFileSync(join(PROJ, "package.json"), JSON.stringify({ name: "bench-project", version: "1.0.0" }) + "\n");
writeFileSync(join(PROJ, "src", "index.js"), "export const x = 1;\n");
const CHILDREN = join(FIX, "children.json");
writeFileSync(CHILDREN, JSON.stringify({ tasks: [
  { id: "tsk_a", role: "implementer", objective: "Do the work" },
  { id: "tsk_b", role: "reviewer", objective: "Review the work", dependsOn: ["tsk_a"] }
] }) + "\n");

const cells = [
  { id: "version", args: () => ["--version"], state: undefined },
  ...["builtin", "custom"].flatMap((state) => [
    { id: `run-children@${state}`, state, args: (s) => ["run", "--project", PROJ, "--objective", "bench objective", "--state-root", s, "--children", CHILDREN] },
    { id: `run-track@${state}`, state, args: (s) => ["run", "--project", PROJ, "--objective", "bench objective", "--state-root", s, "--track", "--assume-defaults"] }
  ])
];
function freshState(state, cellId, iter) {
  if (state === undefined) return undefined;
  const dir = join(WORK, `${cellId.replace(/[^a-z0-9-]/gi, "_")}-${iter}`);
  rmSync(dir, { recursive: true, force: true });
  cpSync(join(FIX, `state-${state}`), dir, { recursive: true });
  return dir;
}
function q(sorted, p) { const idx = (sorted.length - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx); return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo); }
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
for (const cell of cells) {
  const times = []; let exit;
  for (let i = 0; i < WARMUP + ITERS; i++) {
    const sd = freshState(cell.state, cell.id, i);
    const args = typeof cell.args === "function" ? cell.args(sd) : cell.args;
    const env = { ...process.env };
    delete env.PI_PROVIDER; delete env.PI_MODEL; delete env.PI_API_KEY;
    const t0 = performance.now();
    const r = spawnSync(nodeBin, [CLI, ...args], { env, encoding: "utf8", timeout: 120000 });
    const dt = performance.now() - t0;
    exit = r.status;
    if (i === 0 && r.status !== 0) console.error(`  FIRST-FAIL ${cell.id}: ${(r.stderr ?? "").slice(0, 200)}`);
    if (i >= WARMUP) times.push(dt);
  }
  times.sort((a, b) => a - b);
  console.log(`${cell.id}: median=${q(times, 0.5).toFixed(1)}ms min=${times[0].toFixed(1)} p90=${q(times, 0.9).toFixed(1)} exit=${exit}`);
}
```

原始输出（run 命令均为 `--executor` 缺省下的域内校验路径，全部 exit 0）：

```
== v22.14.0 ==
version: median=55.1ms min=54.1 p90=56.7 exit=0
run-children@builtin: median=108.6ms min=106.7 p90=112.7 exit=0
run-track@builtin: median=131.2ms min=128.2 p90=132.3 exit=0
run-children@custom: median=162.5ms min=154.4 p90=172.9 exit=0
run-track@custom: median=180.6ms min=172.3 p90=184.1 exit=0
== v22.22.2 ==
version: median=53.1ms min=50.7 p90=56.0 exit=0
run-children@builtin: median=103.5ms min=102.3 p90=105.5 exit=0
run-track@builtin: median=122.1ms min=118.1 p90=126.0 exit=0
run-children@custom: median=130.4ms min=127.5 p90=133.0 exit=0
run-track@custom: median=150.3ms min=146.6 p90=160.4 exit=0
```

### A.2 进程内冷载锚点脚本（临时置于 /workspace 根以获得 node_modules 解析，测毕删除）

```js
import { performance } from "node:perf_hooks";
const which = process.argv[2];
if (which === "tables") {
  const t0 = performance.now();
  await import("@earendil-works/pi-ai/providers/anthropic.models");
  const t1 = performance.now();
  await import("@earendil-works/pi-ai/providers/openai.models");
  const t2 = performance.now();
  await import("@earendil-works/pi-ai/providers/all");
  const t3 = performance.now();
  console.log(`anthropic.models=${(t1-t0).toFixed(1)}ms openai.models=${(t2-t1).toFixed(1)}ms providers/all-after-tables=${(t3-t2).toFixed(1)}ms`);
} else {
  const t0 = performance.now();
  await import("@earendil-works/pi-ai/providers/all");
  const t1 = performance.now();
  console.log(`providers/all-cold=${(t1-t0).toFixed(1)}ms`);
}
```

原始输出（各 3 次独立进程）：

```
== v22.14.0 ==
providers/all-cold=52.6ms / 57.3ms / 69.3ms
anthropic.models=3.4/4.9/3.4ms openai.models=2.0/2.7/1.6ms providers/all-after-tables=80.9/70.0/45.7ms
== v22.22.2 ==
providers/all-cold=32.2ms / 31.4ms / 31.1ms
anthropic.models=2.6/2.4/2.4ms openai.models=0.8/0.8/0.8ms providers/all-after-tables=28.7/28.8/28.6ms
```

MORE_OPTIMA=no
