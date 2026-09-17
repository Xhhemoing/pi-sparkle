# Grok 下一轮：可信执行与实验就绪 Implementation Plan

> **For agentic workers:** 按 G0 → G1A → G1B → G2 顺序执行，每个 PR 独立审查；G3 为独立的实验就绪盘点。适用时使用 executing-plans，遵守技能加载上限。Grok 是指定实施者；本任务书不代表已经派发，也不授权自动合并或付费调用。

**Goal:** 在已合并的 PR #36 上补齐独立验收、工具/存储边界及真实适配器的离线闭环证据，再决定是否进入真实 provider 和 F6。

**Architecture:** 复用 `src/execution/` 的 closed-loop API 与 `src/pi-adapter/` 工具注入；先修证据与生命周期，不改默认 CLI、不引入 extension、不接 live 自适应。Git worktree 只隔离编辑目标，不是 OS 安全沙箱。

**Tech Stack:** TypeScript、Node.js >=22.19.0、pnpm、现有 `node:test` / `node:assert/strict`；保持 Pi 依赖 pin 0.85.1，不安装 Vitest 或新沙箱框架。

## Identity

- ID：`TASK-20260913-grok-trusted-execution`。
- Owner：Grok bot（实施）；独立 reviewer/verifier（审查/复验）；SCM/xhh（可访问 baseline、推送、授权留档）；project owner（范围/成本/实验决策）。
- State：`planned`；本会话仅编写任务书，未派发、未实施。
- Date opened：2026-09-13。
- Verified research base：远端 main `6ee16a3722fda35d9b6098144602f199fb0a7d0f`；其 tree 与 PR #36 head `4804d4c625559b58675a4726bbdd43eeecb78e4c` 同为 `1d24b3836aa4faba1492340a823e1d5b039073d2`。源码核对使用后者的本地干净 tracked tree。
- Contracts：[status matrix](../../status-matrix.md)、ADR-001/004/005/006/007、[development workflow](../../development-workflow.md)、[delivery evidence](../../reports/2026-09-13-sol-efficiency-delivery-status.md)。
- 本任务书是后续任务，不按[初始 SoL 计划](2026-09-13-sol-pi-grok-handoff.md)重复实施 A/B/HOTFIX/P3/P4/P5。

## Problem and Scope

### 已知事实与待验证推论

源码证据均来自上述冻结 tree；以下是规划依据，不冒充已运行的漏洞复现或新独立审查。

| 证据位置 | 观察 | 本轮动作 |
|---|---|---|
| `src/execution/acceptance.ts#evaluateIndependentAcceptance` | 比较 cwd/revision，但未比较 `command`；输入也没有预期 argv | G1A 用不同 command/argv 的负例先复现再修 |
| `src/execution/closed-loop.ts#runClosedLoopCheck`、`worktree.ts#readWorktreeRevision` | 绑定 HEAD，不绑定未提交文件内容；现有 `readWorktreeTreeHash` 读 index，不能自动代表 dirty worktree | G1A 绑定实际候选内容与检查前后状态，不能靠让模型 `git add -A` 修补 |
| `src/execution/loop-artifact.ts` | save 直接 mkdir/write；read 只 JSON.parse，未核对内容 hash；未复用 run 生命周期锁 | G1B 增加损坏/删除并发回归，复用现有 writer/delete 协议 |
| `src/execution/paths.ts` | 路径检查仅做词法 resolve/relative，没有文件系统 link 检查 | G1B 验证 symlink/junction 与写入父目录，明确 TOCTOU 边界 |
| `src/pi-adapter/worktree-coding-tools.ts` | command 为调用者输入，子进程继承 `process.env`；cwd 不是权限边界 | G1B 默认禁止命令执行，显式 host policy；受信任测试代码仍需 OS 隔离才能视作敌对代码沙箱 |
| `src/cli/` 与 P3 报告 | 未发现 closed-loop/coding-tools 的默认 CLI 接线；P3 没有 live LLM E2E | G2 先走真实 adapter + 本地 HTTP loopback，不直接开放默认 CLI |
| `holdout/BACKLOG-DRAFT.md`、`holdout/README.md` | 已有 115 草稿；review diff、reserve brief、custodian oracle 未齐；公开草稿与“不得存明文”的口径冲突 | G3 做 readiness/污染与历史暴露对账，不能再写成“从零编写115份”或“115份已经就绪” |
| 合并基线 `package.json` | `gate` 尚无 `workflow:check`；本地主工作区的流程文件尚未并入 | G0 先交付可重现流程基线，不把本地存在当作远端已交付 |

### In scope

- G0：合并后交付证据、流程基线和旧记录对账。
- G1A：检查命令、实际候选内容、持久化证据之间的绑定。
- G1B：artifact 生命周期/完整性、工具文件边界与显式命令权限。
- G2：不付费、无外网的真实 adapter 编码闭环 integration。
- G3：F6 就绪盘点与 owner 决策包，不查看/生成盲测 oracle。

### Out of scope / Global Constraints

- 不重写 supervisor/CLI，不新增冻结 Event/CLI/JSON 字段，不改变已有 learning `taskSuccess` 语义；G1 内部证据采用显式版本，旧记录不能被默认为新级别独立验收。
- 不连接 ObservationPack 到 live、不做 Action Fusion/OCC/EPR、不调 live R1/bandit/topology、不自动 promotion。
- 不改 Pi pin/global config/providers/credentials，不注册 `package.json#pi.extensions`；ADR-006 保持原状态。
- 不把 hidden reasoning、环境变量、原始用户日志或 provider secret 写入证据、fixture 或 adaptation plane。
- 未获明确预算/授权前，不运行 paid provider、benchmark、真实 crash、holdout 或 seal；synthetic/loopback 不能标记 production-candidate/Outcome-supported。
- 不 reset/clean/stash 用户工作区，不批量 `git add .`，不复用已有 `grok/sol-efficiency` 工作区覆盖未提交文件；每个小 PR 用新分支。
- Grok 不自任独立 reviewer，不让同一 agent 一边调整 router 一边接触 custodian-held oracle。每个 PR 独立冻结 SHA；后续冲突解决必须复验。

## G0 — 可重现基线与交付收尾（先做，文档/配置 PR）

**Owner:** SCM/xhh 提供基线与材料；Grok 对账并提出最小 PR。依赖：实际 bot 接单入口与可访问任务书。

**Files:** `AGENTS.md`、`docs/development-workflow.md`、`tasks/README.md`、`docs/templates/task-plan.md`、`docs/templates/verification-record.md`、`scripts/workflow-check.mjs`、`test/unit/package/workflow-check.test.ts`、`package.json`、`.github/workflows/ci.yml`、`.github/PULL_REQUEST_TEMPLATE.md`、`CONTRIBUTING.md`、`README.md`；仅移植已获 owner 审阅的 workflow rollout 差异。状态对账限 `tasks/plan.md`、`tasks/todo.md`、`tasks/adaptive-plan.md`、`tasks/adaptive-todo.md`、`docs/status-matrix.md` 的冲突条目，保留历史证据。

- [ ] SCM 提供本任务书及 workflow rollout 的可审阅提交/patch；本地主目录中的 HOTFIX 修改单独比对 `ed9a6e9`，不混入流程 PR、不重复 cherry-pick。
- [ ] Grok 回报身份、repo、分支、完整 base SHA、`git status --short --branch`、Node/pnpm 版本；从获批 base 新建干净 worktree。main 若已前进，报告差异并重新固定 base，不悄悄使用旧 tip。
- [ ] 在原合并 baseline 先跑其现有 `pnpm gate`；此时 `workflow:check` 缺失应如实记录，不能声称该检查已通过。
- [ ] 应用获批流程差异；校正 adaptive-plan 中仍称 P0/M3 未关闭的旧文字，引用已接受 ADR/status，不重新制造历史批准。
- [ ] 补 PR #36 的实际 reviewer SHA/命令和授权来源；材料缺失写 `unavailable` + SCM owner，不编造批准。该归档缺口不等同于代码未合并。
- [ ] 跑下列检查，提交逐文件 diff 给独立 reviewer。G1 只有在流程基线 gate 可重现后才开始。

```bash
pnpm test -- test/unit/package/workflow-check.test.ts
pnpm workflow:check
pnpm gate
git diff --check
```

**Acceptance:** 干净 clone 能读取操作规则并执行 gate；本地未提交改动不丢失、不误带；PR #36 已合并与审查材料缺失分开记录。报告 `docs/reports/2026-09-13-grok-g0-baseline.md`。

## G1A — 独立验收绑定（高优先级，单独 PR）

**Files/symbols:** 修改 `src/execution/acceptance.ts#evaluateIndependentAcceptance`、`independent-check.ts#runIndependentCheck`、`closed-loop.ts#runClosedLoopCheck`；新增 `src/execution/worktree-snapshot.ts`；需要导出时仅修改 `src/execution/index.ts`。测试：`test/unit/execution/acceptance.test.ts`、新增 `test/unit/execution/worktree-snapshot.test.ts`、`test/integration/execution/closed-loop.test.ts`。不修改 learning/R1 的 PASS 标签。

**Behavior contract:**
- Host 固定检查的 command + 完整 argv + cwd；验收必须逐项一致。模型上报字段不能替代 host check。
- 新版检查证据包含明确 `schemaVersion`、HEAD 与实际候选内容 fingerprint；fingerprint 包括选定候选范围内 tracked 修改/删除和 untracked 文件的相对路径、类型、内容 hash，顺序确定；不改用户 index。候选范围/排除项由 host 固定并写入 manifest，不接受模型随检查调整。
- 检查前后 fingerprint 必须一致；测试生成文件只允许落到预声明输出目录，任何候选源码/测试修改导致拒绝。并发写入必须被调度阻止；不能把前后 hash 当作对抗瞬时篡改的 OS 隔离证明。
- 内容 artifact 与 check/acceptance 相互引用必须可核对；JSON 报告的 hash 不是被测试 patch 的身份。历史仅 HEAD 记录保留可读，但不能升级为新版独立验收。
- 与现有结构兼容风险先写进 PR；不借此修改冻结公共事件或要求模型 stage/commit。

**Test-first:**
- [ ] 先添加 command/argv 不符、HEAD 不变而 dirty 文件改变、untracked 文件改变、检查运行中改源码、旧版/缺少 fingerprint、自报 PASS-only 的拒绝测试。
- [ ] 运行 focused command 保存 RED；命令失败必须来自断言揭示的缺口，而不是错误 import/fixture。
- [ ] 实现确定性 snapshot 与版本化绑定，保持正常闭环成功；新增文件、删除和二进制 fixture 均要覆盖。
- [ ] 重跑 GREEN、integration 和 gate，再独立 review 冻结 SHA。

可直接添加的第一条回归（使用当前 `EvaluateAcceptanceInput` 字段；按当前分支条件预计得到 true，实施者必须实际运行确认 RED）：

```ts
assert.equal(evaluateIndependentAcceptance({
  revision: "same-head", cwd: "/fixture", command: "required-check",
  artifactHash: "a".repeat(64),
  independentCheck: {
    kind: "command-check", cwd: "/fixture", command: "different-check", args: [],
    exitCode: 0, stdoutHash: "b".repeat(64), stderrHash: "c".repeat(64),
    revision: "same-head", ok: true
  }
}).accepted, false);
```

```bash
pnpm test -- test/unit/execution/acceptance.test.ts test/unit/execution/worktree-snapshot.test.ts test/integration/execution/closed-loop.test.ts
pnpm gate
```

**Acceptance:** 以上负例全部拒绝；真实声明检查通过且内容未变才 accepted；每个 verdict 可追溯到实际候选内容。报告 `docs/reports/2026-09-13-grok-g1a-acceptance.md`。

## G1B — 工具与 artifact 边界（高优先级，单独 PR）

**Files/symbols:** 修改 `src/execution/paths.ts`、`loop-artifact.ts#saveLoopArtifact/readLoopArtifact`、`src/pi-adapter/worktree-coding-tools.ts#createWorktreeCodingTools`、`src/execution/independent-check.ts`（仅 host 进程策略复用）；必要的内部 policy 放新增 `src/execution/command-policy.ts`。测试修改 `test/unit/execution/paths.test.ts`、`test/unit/pi-adapter/worktree-coding-tools.test.ts`，新增 `test/unit/execution/loop-artifact.test.ts`、`test/integration/execution/loop-artifact-lifecycle.test.ts`。字典语义若变化同步 `docs/data-dictionary.md`、`src/privacy/record-classes.ts` 与其 pinning 测试。

**Behavior / RED cases:**
- [ ] 用测试临时目录复现 symlink/junction 指向根外文件、父目录 link 后创建文件；read/write 均拒绝，根外 sentinel 不变。处理已有 link 与将创建的父目录；Windows 缺权限导致跳过须补有权限环境的独立结果，不能以跳过关门。
- [ ] `sparkle_run_command` 默认无权限，不接收任意 command 后直接执行；host 显式声明允许的 executable + argv 规则、env allowlist、timeout/output 上限。伪造测试环境 secret 不进入子进程；拒绝未授权命令、非法 argv、超时与超限不能成为 PASS。
- [ ] 文档明确：即使 exact argv、cwd 固定，仓库测试脚本仍能执行任意进程操作；仅对受信任 fixture/代码启用。面对不可信模型产物需要外部 OS 隔离、无凭据环境；本 PR 不宣称构建了通用 sandbox。
- [ ] `readLoopArtifact` 读回校验实际字节 hash、schema 和 ref；改动 JSON 内容仍可 parse 的情况必须拒绝。
- [ ] save/read 复用 run 生命周期锁与存在性检查，不能嵌套获取同一锁；先核对现有 `ObservationStore`/delete 协议再实现。删除后写入拒绝且不得复活 run；并发 delete/save 按锁顺序完成或给出既有超时错误。
- [ ] 只读/写测试新建 stateRoot，不触碰真实 runtime；断言错误信息不输出 fixture secret。
- [ ] 先保存 RED、定位具体根因，再做最小实现；库 API 的权限收紧在 migration 注记中列出，更新内部调用者而不是静默放行。

```bash
pnpm test -- test/unit/execution/paths.test.ts test/unit/execution/loop-artifact.test.ts test/unit/pi-adapter/worktree-coding-tools.test.ts test/integration/execution/loop-artifact-lifecycle.test.ts test/unit/privacy/deletion.test.ts test/integration/cli/delete.test.ts
pnpm gate
pnpm security:probe
pnpm pi:probe
```

**Acceptance:** 明确拒绝根外读写、未经 host 授权执行、artifact 篡改与删除后复活；记录 TOCTOU/进程隔离的残余限制。报告 `docs/reports/2026-09-13-grok-g1b-boundaries.md`。若必须改变 delete 公共协议/锁层级才能修复，停止并单独设计，不扩展本 PR。

## G2 — 真实适配器的无付费闭环（G1A/B 验收后）

**Files:** 新增 `test/integration/execution/pi-closed-loop.test.ts`；复用已有 `test/integration/pi-adapter/` HTTP/SSE loopback 风格，fixture 在测试创建的临时 repo。仅为明确 wiring 缺口修改 `src/pi-adapter/runtime.ts` 或 `src/execution/closed-loop.ts`，不得改变 `src/cli/main.ts` 默认路径。更新 `docs/status-matrix.md` 独立行：library + loopback exercised，live-provider 未验证。

- [ ] 搭建本地 HTTP provider；驱动真正 `createConfiguredPiExecutor` 与 `createWorktreeCodingTools`，不能只直接调用工具函数冒充 adapter E2E。
- [ ] 测试任务：读取 fixture 的错误函数 → 写入修复 → host 声明的 Node 检查真实运行 → 保存内容 artifact → 独立验收；原 repo 内容/index 均不变。
- [ ] 新测试先运行；如现有组合已经支持，不为制造 RED 修改实现，仅补通过的集成证据；如发现 wiring 缺口，先记录失败再最小修复。
- [ ] 覆盖 provider 失败、自报成功但检查失败、越权工具调用、artifact 损坏、清理失败；均不得输出独立 PASS，保留可诊断失败证据。
- [ ] cleanup 只清理本次创建资源，不能以 finally 删除唯一失败证据；不读取全局 auth/config，不访问公网、不用真实 key。

```bash
pnpm test -- test/integration/execution/pi-closed-loop.test.ts test/integration/execution/closed-loop.test.ts
pnpm gate
pnpm security:probe
pnpm pi:probe
```

**Acceptance:** 正常路径有真正工具与进程执行、可回读 artifact、未改原 repo；负例 fail closed。报告 `docs/reports/2026-09-13-grok-g2-loopback.md`，必须标 `loopback / no live LLM`。默认 CLI wiring 和真实 provider smoke 只提出后续 scope/预算建议，不自动实施。

## G3 — F6 readiness 与证据污染盘点（可与 G1 独立进行；仅报告）

**Owner:** Grok 对公开元数据盘点；实验 owner/custodian 裁定。此任务不给 Grok custodian key 或隐藏 oracle。

**Read:** `holdout/README.md`、`BACKLOG-DRAFT.md`、`price-table-v1.json`、`scripts/holdout-block.mjs`、`scripts/holdout-custody.mjs`、`src/experiments/{task-spec,freeze,arm-outcome,evidence-retention}.ts`、`docs/specs/f6-preregistration.md`、ADR-005/007。仅统计草稿文件及既有公开状态，不额外展开 task 正文或盲测内容。

**Write:** `docs/reports/2026-09-13-grok-g3-f6-readiness.md`；`holdout/README.md`/`BACKLOG-DRAFT.md` 只增加有依据的当前状态和冲突注记，不重写历史或自行更改 ADR。

- [ ] 区分“115 草稿存在”“schema 通过”“oracle/植入缺陷/备用 brief 完整”“当前 base 可执行”“未污染”“sealed”六种状态。
- [ ] 对公开 git 历史里的 task 内容记录暴露事实；加密当前副本/删除明文不撤销历史暴露。是否只能作为 pilot、是否需 custodian 新写未暴露样本，由实验 owner 裁定，不能自行宣布 clean-room。
- [ ] 对每个 blocker 列 owner 和解除条件：review diff、reserve brief、隐藏 oracle、价格冻结、key provisioning、seal commit/parameterHash、构建来源及原始证据保留。
- [ ] 从 `holdout-block.mjs` 的实际调用追踪 P4 freeze/oracle/retention 接线；module present 不等于 runner exercised。对缺口提出单独测试与 PR，不在本报告任务里实施。
- [ ] 查验现有 spec CLI 命令是否已包含 `--now-ms`、正确价格/配置；禁止照搬旧 README 命令直接跑真实 provider。
- [ ] 提交结论 `NOT READY` 或有逐项证据的 readiness decision package；本轮不运行 seal/custody、真实 arm、115 次循环，也不关闭 F-PROD。

**Verification:** `pnpm workflow:check`、定向链接/引用校验、`git diff --check`；具体实验执行保持 NOT RUN。owner 未裁定污染/有效性之前，不给 Week-1 日期承诺。

## Gates and Handoff

| 阶段 | 放行条件 | 停止条件 / 下一负责人 |
|---|---|---|
| G0 | 规则/任务书可访问、干净 base gate 可复现 | baseline 失败先诊断；SCM 提供获批材料 |
| G1A | 内容/命令绑定负例拒绝 + gate + 独立 review | 需改变冻结协议则另立设计 |
| G1B | 工具/存储边界负例拒绝 + gate/probes + 独立 review | 无法证明边界则保持禁用，不开放不可信命令 |
| G2 | 真 adapter loopback 成功/失败证据完整 | 不满足 G1 或需公网/凭据就停止 |
| G3 | blocker/owner/解除条件及污染裁定请求完整 | 等 owner/custodian 决策，不生成假 seal |

每个 PR 必须交付：base/head 完整 SHA、改动文件/兼容风险、RED/GREEN 原始日志位置、gate/probe 的 pass/fail/skip 数、独立 reviewer 身份与被审 SHA、owner 授权来源、下一步。大日志放 `.agent_workspace/grok-trusted-execution/<slice>/`；脱敏结论放各阶段报告，并同步 `tasks/plan.md` / `tasks/todo.md`。未通过验收项不打勾，不以聊天里的 PASS 替代证据。

建议独立分支前缀 `grok/trusted-execution-`。各 PR 完成后冻结 head；推送/合并由 SCM 按 owner policy 执行。独立报告可以与代码审查并行，但不能让多个 agent 同改 `closed-loop.ts` / `independent-check.ts`。SCM 单独负责主工作区脏改动保全。

### 可直接转发给 Grok 的接单要求

> 先接 G0，不重复 PR #36 的 A/B/HOTFIX/P3/P4/P5。阅读本任务书并回复实际身份、可访问任务书位置、repo/branch、完整 base SHA、工作区状态及 G0 的文件白名单。确认流程基线 gate 后按 G1A → G1B → G2 逐 PR 实施，每个行为变更先 RED 后 GREEN，独立 reviewer 放行。G3 只做 F6 readiness/污染盘点，不接触 custodian oracle。未经额外批准不运行真实 provider/benchmark/holdout，不开放默认 CLI、不接 live 自适应、不自动合并。材料不足回复具体 blocker，不自行补写授权或重造已合并功能。

## Deferred / 明确不派发

- P5 性能量化：在 G2 可信链稳定后再写独立 benchmark 预注册，冻结相同 fixture/资源/版本、区分冷启动和 warm persist；不从少写 event 推导账单收益。
- ObservationPack live、Action Fusion、OCC/EPR：没有完成回读/生命周期/权限与真实收益证据前不进入本轮。
- 真实 coding smoke：需 owner 指定 provider、任务、调用/费用/时长上限、无凭据执行环境及失败停止条件；通过仍不是 F-PROD。
- F6 Week-1：取决于 G3 的污染裁定、custodian 材料和 seal，不从已合并 P4 推断可开始。

## 本次计划编辑范围与 Closeout

- 本次只新增本计划，并在 `tasks/plan.md` / `tasks/todo.md` 添加后续任务索引；不修改源码或旧计划历史。
- 本次验收：优先级、准确文件/符号、负例/命令、角色/依赖/非目标明确；与 PR #36 和实验门禁不冲突；链接可解析。
- `node .agent_workspace/grok-trusted-execution-plan/check-plan.mjs`：PASS / exit 0；`grok-plan-check: ok (3 records, 47 local links, 20 existing source/test paths; scope/gate markers present)`。只检查计划引用和范围标记，不验证新行为。
- `pnpm workflow:check`：PASS / exit 0；`workflow-check: ok (10 required files, 16 required headings)`。
- `git diff --check`：PASS / exit 0；现有 tasks/plan 与两份 learning/routing 测试仍有 CRLF→LF 警告。
- 本次自查：各源码观察都有对应 slice；G0/G1/G2/G3 的文件、负例、命令和审批边界已列出；未来新文件明确标“新增”；不会把既有115草稿、loopback 或 PR CI 当作 holdout 验收。
- 日志：`.agent_workspace/grok-trusted-execution-plan/{plan-check,workflow-check,diff-check}.log`。产品测试、上述实施任务、独立代码 review、派发：NOT RUN；本计划仍为 planned，等待真实 Grok 接单与可访问材料。
