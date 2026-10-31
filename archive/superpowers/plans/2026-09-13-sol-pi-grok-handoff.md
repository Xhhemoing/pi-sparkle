# SoL-Pi Efficiency Improvements — Grok Bot Implementation Plan

> **For agentic workers:** 按本任务书逐 PR 执行。适用时使用 executing-plans；不要因技能引用无限加载技能。Grok 是指定实施者，不要用其他模型冒名替代。当前尚未派发给 bot。

**Goal:** 先交付可核验的效率机会分析和 ObservationPack 离线原型，再经独立审批决定是否进入真实运行时。

**Architecture:** 保留 pi-sparkle 的执行/适应双平面、稳定事件协议和 `src/pi-adapter/` 边界。首批新增独立的只读测量与 run-scoped 归档/投影模块；不连接 CLI live worker、不注册 Pi extension、不引入新模型调用。产品代码和探索性实验分开。

**Tech Stack:** TypeScript，Node.js >=22.19.0，pnpm；测试使用仓库现有 `node:test` + `node:assert/strict`，不是新装 Vitest。

## Identity

- ID: `TASK-20260913-sol-pi-efficiency`
- Owner: Grok bot（实施；待配置/实际接单）；project owner（范围/权限/实验审批）；不同于实施者的 reviewer（验收）。
- State: `planned`；handoff `blocked`，因为本会话未发现 Grok agent、bot workflow 或可确认的远程账号/派发入口。
- Date opened: 2026-09-13。
- Local research base: `8dd31e9ea9215dcfb74e0029331857cd4190df97` **加未提交工作区变更**，不是可远程重现的纯 HEAD。
- Related ADR/spec/status: ADR-001 / ADR-004 / ADR-005 / ADR-006，`docs/status-matrix.md`，`tasks/plan.md`，`tasks/todo.md`。
- 接单必须回复实际 bot 身份、可访问的 repo/branch、完整 base SHA、可访问的任务书路径；缺任一项即 `blocked`，不能写“已执行”。

## Problem and Scope

### Problem

已有事件只能证明有限的工具生命周期和模型 usage，无法据此精确计算原始 observation 大小、每轮 replay、cache 账单。需要先测量可得事实，再用保留原文的可回读投影降低重复文本；不能先承诺“降本一半”。

### In scope — 本轮首批修改

1. PR-A：只读效率分析器、严格输入/输出契约、合成/脱敏 fixture、无缺失数据伪造。
2. PR-B：run-scoped observation store、纯数据投影与分页回读、删除/隔离/失败保留原文测试；**仅离线/合成 integration**。
3. 每 PR 的红绿测试记录、适用 gate、独立审查与状态更新。

### Out of scope — 禁止顺手实施

- 不自动添加 read/edit/write/bash 工具，不更改工具权限。
- 不安装 SoL-Pi 到用户环境，不改 Pi 全局配置、版本 pin、provider 或 credentials。
- 不新增 `package.json#pi.extensions`，不绕过 ADR-006。
- 不连接 live R1/bandit/topology，不自动 promotion，不改变 F-PROD gate。
- 不持久化 hidden reasoning；不将原始 prompt/tool output 复制进 adaptation 数据集。
- 不修改冻结 Event/CLI/JSON 协议；需要新协议时另提变更，不复用已有字段改变含义。
- 不跑付费 provider、真实 A/B、crash/benchmark/holdout，除非 owner 明确批准预算和预注册。
- 后文 PR-C/D/E 是条件性后续任务，不是本轮首批授权。

## Global Constraints

- 上游源码 pin：`NVlabs/SoL-Pi@d7ecfc089944f0d04b80122a0a9a6ca0d786f3d0`；本地 agent-core/ai 当前 pin 为 `0.85.1`，不修改。
- 每项行为先写 failing test 并确认失败原因，再实现；不能以修改测试掩盖实现缺陷。
- 所有 raw logs / snapshots / 临时文件在 `.agent_workspace/` 或测试自建临时 stateRoot；删除只限测试创建的目录。
- 保留脏工作树；禁止 `git reset --hard`、`git clean -fd`、自动 stash/pop、批量 `git add .`。
- 禁止修改 evaluator 来让自己的优化通过；implementation outcome、命令验证、独立 review、人类批准分别记录。
- 若借用上游代码，保留 NVIDIA MIT 版权/许可证归属；不要复制上游 Pi imports 进 domain 模块。

## Portable Research Basis

本任务书是远程 bot 的自包含依据，**不能依赖被 gitignore 的调研目录可见**。

- 源码：https://github.com/NVlabs/SoL-Pi/tree/d7ecfc089944f0d04b80122a0a9a6ca0d786f3d0
- ObservationPack：`src/sol-pi/extensions/observation-pack/observation.ts`、`index.ts`，大于 10 KiB、前两次完整发送、之后稳定占位、`obs_recall` 精确回读，只改发送投影。
- Action Fusion：`extensions/action-fusion/then-run.ts`、`file-queue.ts`，修改成功才执行后续命令；文件队列不是跨进程锁/事务。
- EPR：`extensions/evidence-preserving-reducer/receipt.ts`，校验 exact quotes 不证明所有关键失败都已保留。
- OCC：`extensions/online-context-compact/economics.ts`、`extension.ts`，经济门槛之外还有 abort/settle/compact/continue 生命周期。
- 作者博客 https://nvlabs.github.io/SoL-Pi/ ：EdgeBench token 节省 45–49% 同时平均得分保留约 94%；Terminal-Bench 4 为 Pi 18 solved/$286.45，SoL-Pi 15 solved/$211.12。作者报告，不是本项目验收指标。
- 本地 `src/pi-adapter/runtime.ts#createConfiguredPiExecutor` 不注入普通 coding tools；`pi-executor.ts#runAttempt` 使用 options.tools + cluster + report tool，不能假设安装 Pi 扩展就自动影响 CLI workers。
- `src/execution/contract.ts` 的 TOOL_FINISHED 只有 toolCallId/isError/summary；不能从 summary 反推完整输出、验证命令、replay 次数或字节数。
- 已有 `tasks/adaptive-plan.md` P0/M3 状态文字与最新 status/checklist 存在漂移。按治理优先级核对，报告差异；本任务不重开/关闭历史 gate，也不全面重写原计划。

## Step 0 — 派发和隔离准备（owner + Grok）

- [ ] Owner 提供已确认的 Grok bot 入口/账号与仓库权限；不要猜 `@grok` 或把任务发到无关 issue。
- [ ] Owner 审阅现有未提交改动，将需要的 baseline 和本任务书提交到明确分支，或把完整获批工作树包交给 bot。**不要只给旧 HEAD，也不要泄露 `.agent_workspace/` 原始材料。**
- [ ] Grok 先运行 `git status --short --branch`、`git rev-parse HEAD`、`node --version`、`pnpm --version` 并记录；确认 `AGENTS.md`、workflow-check 和本任务书存在。
- [ ] 若 base 不包含这些工作规则，或与 owner 提供的 SHA 不一致，停止并请求正确 base，禁止自行“补齐”用户未提交代码。
- [ ] 在干净、获批 base 上建立独立分支/worktree；不能复制用户 secrets/runtime state。以下命令使用**实际获批 base**，不能把占位符直接执行：

```bash
# 仅在 owner 已提供真实 SHA 后执行；环境变量空值时直接停止。
: "${APPROVED_BASE_SHA:?owner must supply the approved complete baseline commit}"
git cat-file -e "${APPROVED_BASE_SHA}^{commit}"
git worktree add ../pi-sparkle-sol-efficiency -b grok/sol-efficiency "$APPROVED_BASE_SHA"
cd ../pi-sparkle-sol-efficiency
pnpm install --frozen-lockfile
mkdir -p .agent_workspace/sol-efficiency
pnpm workflow:check
pnpm gate
```

- [ ] baseline gate 若失败：记录具体命令/错误/是否已知基线问题，停止实施；不把无关修复混入效率 PR。
- [ ] 阅读 AGENTS/tasks/status/ADRs 后回复文件白名单、测试路线和风险，才开始 PR-A。

## PR-A — 只读效率机会报告

### Files / symbols

Create:
- `src/telemetry/harness-efficiency.ts` — `analyzeHarnessEfficiency(rows)`，严格输入验证与纯聚合。
- `scripts/analyze-harness-efficiency.ts` — `--input <jsonl>` / `--json`；显式读取指定文件，不自动扫描 home/session/credentials。
- `test/unit/telemetry/harness-efficiency.test.ts`。
- `test/integration/telemetry/harness-efficiency-cli.test.ts`。
- `test/fixtures/harness-efficiency/complete.jsonl`、`missing.jsonl`、`invalid.jsonl`（synthetic，不是用户历史数据）。

Modify only: `tasks/plan.md`、`tasks/todo.md` 的本任务项，以及本 PR 的验证报告。首批不改 `pi-executor.ts`、`ExecutionEvent`、`ModelInvocation`、CLI main 或 package scripts。

### Interfaces / behavior

```ts
export interface EfficiencyRow {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly requestId: string;
  readonly observationId: string;
  readonly baselineBytes: number | null;
  readonly projectedBytes: number | null;
}
export interface EfficiencyReport {
  readonly schemaVersion: 1;
  readonly evidenceClass: 'synthetic' | 'observed';
  readonly rowCount: number;
  readonly pairedRows: number;
  readonly unknownRows: number;
  readonly pairedBaselineBytes: number;
  readonly pairedProjectedBytes: number;
  readonly pairedReductionRatio: number | null;
  readonly monetarySavingUsd: null;
  readonly notes: readonly string[];
}
export function analyzeHarnessEfficiency(
  rows: readonly EfficiencyRow[],
  evidenceClass: EfficiencyReport['evidenceClass']
): EfficiencyReport;
```

- CLI 需显式 `--evidence-class synthetic|observed`，缺省拒绝；调用者标签只是来源声明，不认证真实执行。
- `(runId, requestId, observationId)` 唯一，重复行拒绝；schema/必需字段/未知字段非法拒绝。空白行可忽略，其余每行都必须合法，含截断末行也拒绝。
- 数值只能为非负 safe integer 或 null；缺省字段按 null 处理且计 unknown，不使用 0 补齐。
- 只对两个 byte 值均已知的 paired rows 计算总和；分母为 0 或无配对数据时 ratio=null。
- `ratio = 1 - pairedProjectedBytes / pairedBaselineBytes`；允许负值，不截断以隐藏变大。
- 无论 observed 还是 synthetic，美元节省固定为 null：没有价格/完整 usage/辅助调用就无法推导账单。
- 不输出输入原文，不回显非法 raw 行；错误只写行号+字段名。退出码 0 成功、1 输入/读取/用法错误。
- 数据来自显式 fixture 或以后批准的 producer；当前历史 events 无上述字段，应报告 unavailable，不编造转换器。

### Test-first steps

- [ ] 编写 unit 测试：完整/部分缺失/全缺失/真实 0/负 reduction/重复/非法数字/未知字段/空集，共至少 9 类行为。
- [ ] 写 CLI tests：合法 JSON 输出；坏行/缺文件/nonzero；原文 secret sentinel 不进入 stdout/stderr；退出 1 时不能输出成功报告。
- [ ] RED：运行下列命令，确认失败来自新模块/行为缺失，而非坏命令或环境。
- [ ] 实现严格验证、pure aggregator、薄 CLI；输入有限流式读或声明并验证文件上限 16 MiB，避免任意大文件吃满内存。
- [ ] GREEN：重跑同一命令，所有新增用例 0 fail/0 skip。

```bash
pnpm test -- test/unit/telemetry/harness-efficiency.test.ts test/integration/telemetry/harness-efficiency-cli.test.ts
pnpm exec tsx scripts/analyze-harness-efficiency.ts --input test/fixtures/harness-efficiency/complete.jsonl --evidence-class synthetic --json
pnpm gate
```

关键数值 fixture：3 行依次 `(1000,250)`、`(null,100)`、`(1000,null)` → rowCount=3, pairedRows=1, unknownRows=2, pairedReductionRatio=0.75, monetarySavingUsd=null。非法行测试用 `spawnSync` 断言 status=1，不能当成整体 gate 失败漏报。

示例 unit 断言（按项目 `.js` import 风格）：

```ts
const report = analyzeHarnessEfficiency([
  { schemaVersion: 1, runId: 'run_fixture', requestId: 'req_1', observationId: 'obs_a', baselineBytes: 1000, projectedBytes: 250 },
  { schemaVersion: 1, runId: 'run_fixture', requestId: 'req_2', observationId: 'obs_a', baselineBytes: null, projectedBytes: 100 },
  { schemaVersion: 1, runId: 'run_fixture', requestId: 'req_3', observationId: 'obs_a', baselineBytes: 1000, projectedBytes: null },
], 'synthetic');
assert.equal(report.pairedRows, 1);
assert.equal(report.unknownRows, 2);
assert.equal(report.pairedReductionRatio, 0.75);
assert.equal(report.monetarySavingUsd, null);
```

- [ ] 独立 reviewer 核查字段、缺失值、分母与费用措辞；review 通过才提交/合并 PR-A。

## PR-B — Observation store + offline projection

### Files / symbols

Create:
- `src/context/observation-store.ts` — `ObservationStore`、严格 handle/分页/存储实现。
- `src/context/observation-projection.ts` — `projectObservation`，不导入 Pi 类型、不接 live worker。
- `test/unit/context/observation-store.test.ts`。
- `test/unit/context/observation-projection.test.ts`。
- `test/integration/context/observation-lifecycle.test.ts`。

Modify (只限本功能所需):
- `src/privacy/record-classes.ts`、`docs/data-dictionary.md` — 增加原文 observation 的 owner/retention/redaction/delete/recovery 说明。
- `test/unit/privacy/record-classes.test.ts` — 字典 pinning。
- `docs/status-matrix.md` — 新增独立行，仅 Present=yes、Wired=offline/library、Exercised=本次真实测试命令、Outcome-supported=no。
- `tasks/plan.md`、`tasks/todo.md` 的本任务项及验证报告。

`src/privacy/deletion.ts` 现有 run subtree 删除应已覆盖 store。先通过 lifecycle test 证明；若需改删除协议、锁层级或返回结构，停止并提交变更说明，不能悄悄扩大白名单。

### Interfaces

```ts
export interface ObservationRef {
  readonly id: string; // obs_ + full SHA-256 hex
  readonly sha256: string;
  readonly byteLength: number;
}
export interface ObservationPage {
  readonly text: string;
  readonly nextOffset: number;
  readonly eof: boolean;
}
export class ObservationStore {
  constructor(stateRoot: string, runId: RunId);
  put(text: string): Promise<ObservationRef>;
  recall(ref: ObservationRef, offset?: number): Promise<ObservationPage>;
}
export interface ObservationInput {
  readonly id: string;
  readonly toolName: string;
  readonly text: string;
  readonly isError: boolean;
  readonly pureText: boolean;
  readonly evidenceReceipt: boolean;
}
export interface ProjectionResult {
  readonly text: string;
  readonly packed: boolean;
  readonly ref?: ObservationRef;
  readonly reason: 'disabled' | 'ineligible' | 'first-two' | 'packed' | 'storage-unavailable';
}
export function projectObservation(input: ObservationInput, options: {
  readonly enabled: boolean; // 默认由调用方显式 false；没有 env/全局开关
  readonly priorFullSends: number;
  readonly store: ObservationStore;
}): Promise<ProjectionResult>;
```

`RunId` 使用 `src/domain/ids.ts` 的现有类型。以上 constructor/method 是接口说明，不是把无函数体代码直接贴成实现。

### Storage / privacy contract

- 路径固定：`<stateRoot>/runtime/runs/<runId>/observations/objects/<sha256>.txt`；不接受用户提供任意 archive path。
- 仅对已有 durable run 写入：under existing `runLockPath` lock 核对 run event log 仍存在。run 删除后 put 必须拒绝，不能重新 mkdir 复活已删 run。
- 复用 `withExclusiveFileLock`，每次 public operation 只取一次 run lock，不嵌套相同锁。测试不能用假的本地 mutex 代替跨进程 writer/delete 协议。
- 原文只在 runtime；不送 provider、不进入反馈、dataset、prompt/skill 变更。POSIX dir/file 最小权限 0700/0600；Windows 权限差异在证据中明确。
- 原型单对象上限 8 MiB，单 run 总 archive 上限 64 MiB；达到上限拒绝 put，projection 保留原文。重复 hash 幂等复用、不重复计费；在锁内核验 quota。
- 拒绝路径穿越、畸形 id/hash/byteLength、对象/受控目录 symlink；存在对象需比对 hash/长度，不能覆盖不同内容。
- 原文 SHA-256 与引用一致；recall 验证 hash，损坏/不存在/已删除直接报错，不返回“成功但空文本”。
- `deleteRunRecords` 后本 run archive 必须不存在，其他 run 不受影响。episode delete 继续沿用现有“绑定 run 另行删除”语义；不得谎称 episode delete 已清掉所有 run 原文。

### Projection / recall contract

- enabled=false：0 磁盘读写、0 网络请求，逐字保留输入。
- 默认行为未连接 live；不在 CLI 添加 flag，也不加载 extension。
- eligibility：UTF-8 字节数 >10240、pureText=true、isError=false、evidenceReceipt=false。
- priorFullSends=0 或 1：完整输出；>=2 且 archive 已验证成功才返回稳定 placeholder；非法计数拒绝。
- placeholder 含 id/hash/原字节数/明确的回读说明，UTF-8 总长 <=2048 bytes；不得包含会随轮次变化的时间/计数。
- 不修改 input 或既有历史；存储/权限/quota 故障返回原文+storage-unavailable，不把 evidence 丢掉。取消/abort 若以后接入需传播，不能捕获为普通存储失败后继续执行。
- recall 每页 <=16384 payload bytes、<=400 lines，offset 为非负 safe integer；越界或处于 UTF-8 continuation byte 中间时拒绝。合法页总是前进，EOF 可为空，不死循环。
- 首批原型的 `priorFullSends` 是显式 fixture/调用参数，**不宣称已实现真实 provider request 计数、retry/resume/fork 语义**；这些属于后续 live 接入。

### Test-first / acceptance steps

- [ ] Store RED：幂等/hash 损坏/不存在/穿越/合法和非法 offset/UTF-8/超长单行/quota/并发/已删除 run。
- [ ] Projection RED：禁用、10240 边界、首次两轮、第3轮、后续稳定、error/mixed/receipt 排除、存储失败保留、deep-frozen input 不变。
- [ ] Lifecycle RED：创建两个真实 fake run；archive 写/recall/重建 store 后回读；删除一个 run；回读失败且不能复活；另一个 run byte-for-byte 不变。
- [ ] 实现最小 store 和 pure projection；不修改 Pi executor 或 kernel；从 upstream 借代码先剥离 Pi 依赖并保留 license attribution。
- [ ] GREEN：覆盖上面每个 named case，新增必要用例 0 fail/0 skip。

```bash
pnpm test -- test/unit/context/observation-store.test.ts test/unit/context/observation-projection.test.ts test/integration/context/observation-lifecycle.test.ts test/unit/privacy/record-classes.test.ts
pnpm test -- test/unit/privacy/deletion.test.ts test/integration/cli/delete.test.ts test/integration/m3/packet-fidelity.test.ts test/unit/pi-boundary.test.ts test/unit/routing/live-isolation.test.ts
pnpm gate
pnpm security:probe
pnpm pi:probe
```

- [ ] 合成效率 fixture：同一个恰好 65536 bytes 的纯文本 observation 连续投影 10 次，无 recall；前2次原文、后8次 placeholder。通过 PR-A 统计实际输出，累计 byte reduction >=70%。这是 synthetic projected bytes，不是 token/账单或任务成功率收益。
- [ ] 原文完整性：ASCII/中文/emoji/CRLF/无末尾换行/单行>16KiB 每类至少一例，从 offset=0 用 nextOffset 直到 EOF，拼接原文及 SHA-256 必须 100% 相同。
- [ ] 隔离指标：禁用路径 0 新文件/0 调用；跨 run 泄漏 0；存储故障丢失原 observation 0；删除后可回读对象 0。
- [ ] Windows 与 POSIX 的 symlink/permissions 证据分开；环境不支持的必须标 NOT RUN/blocked，并提供适用 CI 证据，不能靠 skip 声称隐私 gate 通过。
- [ ] Reviewer 独立重跑聚焦 tests，检查 writer/delete race、锁顺序、quota、hash、fallback、测试是否偷换 byte/token/美元口径；PR-B 不通过不进入 live。

## 后续条件任务 — 不在首批实施范围

| ID | 触发条件 | 预期改动文件 | 操作与明确验收 |
|---|---|---|---|
| PR-C Action Fusion | owner 批准真实 coding tools 宿主、权限和预算；明确 ADR 是否需修订 | 新建 `src/pi-adapter/action-fusion.ts`、`test/unit/pi-adapter/action-fusion.test.ts`、`test/integration/pi-adapter/action-fusion.test.ts` | 先失败用例覆盖写失败/验证失败/并发/cwd/timeout/cancel；写失败后命令运行0次，写成功验证失败时不能声称写未发生；同文件 mutation/validation 不交错；不要求 async path resolve 前 FIFO；验证次数不能下降。focused tests→gate→security/pi probes；接入点另经白名单审批 |
| PR-D Evidence Receipt | archive/privacy 契约通过；本地 validator 可独立立项，remote reducer 需数据政策与预算批准 | 新建 `src/context/evidence-receipt.ts`、`test/unit/context/evidence-receipt.test.ts` | schema/hash/status/quote 验证，伪造引用接受0条，源不匹配接受0条；多失败 fixture 明确展示“引用正确不等于覆盖完整”；不改变 deterministic verdict。先纯函数，再另议 remote adapter；全套失败记录保留 |
| PR-E Compaction Economics | P0 数据足以支持估算；只读 shadow 先批准，live compaction 另批 | 新建 `src/context/compaction-economics.ts`、`test/unit/context/compaction-economics.test.ts` | ratio unknown/0/正值、负收益、debt、窗口压力都有固定 fixture；shadow 调用 abort/continue/promotion 次数均0；不把固定 ratio 当真实账单。live 接入必须另测 lease/唯一终态/取消/steer/预算/审批；不能仅有经济函数测试就打开 |

不要预先为 PR-C/D/E 添加接口、配置开关、空模块或 permanent workflow；先完成可独立评审的首批。

## 验收总表

| Gate | 必须满足 | 不足时状态 |
|---|---|---|
| H0 派发 | bot 确认身份、可访问任务书和完整 base SHA；隔离工作区 | blocked，不能标 started |
| A0 Baseline | workflow + gate exit0；无未归属的基线失败 | blocked；失败与本次修改分开 |
| A1 分析器 | null/0/缺失/负节省都正确；fixture 0.75；原文与美元臆测0 | PR-A rejected |
| B1 可恢复 | 指定文本 fixture 100% byte/hash 还原；restart 后可 recall | PR-B rejected |
| B2 效率 | 64KiB×10、前2次完整、无 recall 时累计 bytes 少>=70% | prototype 不满足效率验收；不能降低门槛后称通过 |
| B3 不丢证据 | disabled无副作用；失败保留原文100%；error/mixed/receipt不被压缩 | PR-B rejected |
| B4 隐私 | 删除/隔离/hash/quota/路径测试全部通过；平台限制有独立证据 | blocked，不能标 privacy accepted |
| Q1 软件 gate | 必要 focused tests 0 fail/0 skip；pnpm gate、适用 probes exit0；独立 review 无未解 P0/P1 | ready-for-review，未 accepted |
| E0 实验 gate | 首批不运行真实实验、不能标 Outcome-supported | remains NOT RUN |

## Real-world Benefit Gate — 单独申请，不随 PR 验收关闭

若 owner 后续批准 live adapter 和成本预算，再冻结 paired A/B 协议：模型/版本/thinking/tools/任务/价格/随机化顺序/超时/缺失 usage/重试规则一致；计入 recall/reducer/compaction/cache 和 fallback 全部成本。

- 样本按 ADR-005 的 MDE 计算；无 pilot 时保守起点100 episodes，单独声称某 family 要>=30，欠额仅 provisional。
- 不额外擅自 author/run 密封 F6；沿用 custodian 与预注册治理。
- 合并收益若要关闭既定 F-PROD：utility-delta 95% LCB >0 且 cost-delta 95% UCB <=0；安全/权限/验收不能退化。
- 若只做效率非劣性研究，必须另有 owner 批准的协议/容忍度，不能冒用 F-PROD 标签。
- 70% synthetic bytes 或上游45–49% tokens均不能替代这一 gate。

## Gates and Handoff

### 每个 PR 的交付格式

```text
Task/PR ID:
Bot identity + approved base SHA + final commit:
Changed files / symbols:
Behavior and explicit non-goals:
RED command + intended failure + log:
GREEN command + exact counts + log:
Gate/probe commands + exit codes + output summaries:
Fixture metrics (units and evidence class):
Privacy/compatibility checks:
Independent reviewer identity + review evidence:
NOT RUN / SKIPPED / blockers:
Status changes (Present/Wired/Exercised/Outcome-supported):
Rollback + next owner/action:
```

使用 `docs/templates/verification-record.md` 为每 PR 创建 `docs/reports/2026-09-13-sol-efficiency-pr-a-verification.md` / `...-pr-b-verification.md`（执行日期变化则使用实际日期）。报告摘要进 git；完整日志留 `.agent_workspace/sol-efficiency/` 或可访问 CI artifact。不能只贴本机绝对路径给远程 reviewer。

### Git/PR 操作

- 每 PR 明确列举 files 后选择性 `git add <files>`；先 `git diff --cached --check` 再提交。
- 只提交自己改动；不提交 credentials、raw transcripts、私有 state 或整份 upstream clone。
- bot 只有获批 branch/PR 权限，禁止自动 merge/push protected branch。
- rollback：首批未连 live，revert 本 PR 即可；不删除 baseline 数据、不运行广域清理。测试 archive 仅删除该测试创建的 root。
- 任何需要修改白名单外冻结协议、用户配置、工具权限或真实数据流的发现，标 `blocked` 并请求 owner 决定。

## Closeout

本文件交付的是可执行任务与验收契约，**不是实现完成证明**。当前任务书已写入本地，但未 commit/push、未派发、未安装 bot、未运行付费模型。只有 owner 提供确认的 Grok 入口和完整获批 base 后，H0 才能开始核验。
