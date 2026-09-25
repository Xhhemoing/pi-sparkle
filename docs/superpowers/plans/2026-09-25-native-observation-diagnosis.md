# Native Observation and Bounded Diagnosis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 复用现有运行事件和 inspection，在用户按需检查时可靠呈现“声称完成但缺少宿主验收证据”的 evidence-gap。

**Architecture:** D1 直接查询已有 `EventStore` 和 `src/run/inspection.ts`，生成有界、只读、非持久化的 evidence-gap 视图。它不新增 N1 fact store、N3 artifact store、后台消费者或控制面写入；S0-min/L1 独立负责可信宿主结果。

**Tech Stack:** TypeScript 5.9、Node ≥22.19.0、pnpm 10.17.1、`node:test`、Pi adapter 0.86.1、现有 EventStore/run inspection、离线 fixtures。

## 2026-09-25 independent review correction (controlling)

同日后续独立审查对 N1-N3 新存储链给出 **REQUEST CHANGES**。当前 MVP 只保留 D1；以下 N1-N3 草案保留作历史，不得据此创建新的 fact/artifact store，也没有新的独立 PASS。

### D1: on-demand evidence-gap diagnosis

- **Depends:** B0 only. D1 may run in parallel with S0-min; it does not produce trusted outcomes and is not a substitute for S0-min/L1.
- **Reuse:** query the existing `EventStore` and existing `src/run/inspection.ts` read path at user/CLI inspection time. Reuse already persisted run events and current inspection summaries; do not mirror them into N1 records.
- **Output:** a bounded, deterministic `evidence-gap` view that says which required host evidence is absent or unresolvable. It remains read-only, reports `UNOBSERVED` where appropriate, and never converts child/tool success into independent task success.
- **No persistence:** do not add N1 native-fact storage, N3 diagnosis artifacts, new record classes, new retention/deletion paths, background analysis queues, or a diagnosis replay ledger.
- **No control authority:** D1 cannot retry, resume, unblock, call a model/provider, write run events, blame a model, create a candidate, or change current execution.
- **Bounds:** use the existing inspection/EventStore read bounds where available; if B0 finds an unbounded path, add a focused bound to that existing query rather than a new storage subsystem. Truncation/incomplete history must be disclosed and cannot become positive evidence.

### D1 verification shape

- Claimed-complete child/tool events without a host outcome produce `evidence-gap`/`UNOBSERVED`.
- A resolvable frozen host outcome makes the corresponding gap disappear without D1 signing the outcome itself.
- Corrupt, truncated, missing, foreign-run and unknown event variants fail closed.
- Repeated inspection is idempotent and leaves EventStore, run state, registry, feedback and active policy byte-for-byte unchanged.

Exact files and focused commands are frozen by B0 after checking the existing inspection ownership; likely changes remain localized to `src/run/inspection.ts` and its existing unit/integration/CLI tests. Final acceptance needs a fresh independent review and does not close Stage 0, R10/R11, or F6.

## Superseded pre-review draft retained for provenance

The N1/N2/N3 module, fixture, artifact and integration instructions below are historical draft material. N2's read-only intent is represented by D1; N1 and N3 are deferred outside the MVP.

## Global Constraints

- 所有命令使用 `pwsh`；脚本首行 `$ErrorActionPreference = 'Stop'`；文件读写显式 `-Encoding UTF8`。
- 开工前读 `AGENTS.md`、`tasks/README.md`、活动 plan/checklist、相关 ADR/status；不得覆盖现有 dirty 修改。
- 用户要求本次自主制定多 Agent 计划；本文件是实施计划，不是产品行为已完成、独立审查通过或实验授权。
- `ANALYSIS_QUEUED` / `RUN_BLOCKED` 及显式 unblock 语义不变；消费者不 retry、不 unblock、不调度 agent、不调用模型、不写 run events。
- `ExecutionEvent`、CLI JSON、状态枚举、协议 v1 保持不变；必要公共变更只能 additive-only，由 CI-1b 更新 pinning tests 后独立审查。
- 不采集普通宿主完整会话、用户画像、凭据、工具参数/正文、隐藏推理；`THINKING_DELTA` 也不进入本包事实。
- 工具成功、executor SUCCESS、子任务 PASSED 均不是独立 taskSuccess。只有 E1 的宿主来源重建结果有资格进入对应结果维度。
- ADR-004 proposal-first、ADR-006 thin adapter、ADR-008 opaque locator/exact bytes/local-weak 不变；不添加替代密码学散列。
- `SPARKLE_AUTO_ADAPT=0` 仍可收集/诊断，但不能产生学习候选或写 bandit；本包无晋升及活跃策略写入接口。
- Stage 0、read-only evaluator freeze、A/B/C budget/data、R10/R11 write/apply、F6/F-PROD 是独立 gate；本包不关闭其中任何一项。
- 当前 native 单模型 executor 的 `supportedModelIds` 拒绝保护、typed projection 和累计 recall budget 是需先固定审查的基线，不重新实现。

---

## Identity, scope and dependencies

- ID：`TASK-20260925-native-observation-diagnosis`；owner：Native worker；状态：`planned`；日期：2026-09-25。
- 权威：[ADR-004](../../decisions/0004-controlled-adaptation.md)、[ADR-006](../../decisions/0006-pi-extension-reverse-adapter.md)、[ADR-008](../../decisions/0008-remove-sha256.md)、[状态矩阵](../../status-matrix.md)。
- 配套：[E1–E3 evidence-learning plan](2026-09-25-evidence-learning-foundation.md)；[既有 evidence-first 顺序](2026-09-21-evidence-first-phase.md)。
- 输入基线：`f15a3b81d6ff8b2e1b67ac0f26ca5bc7937455bb` 加本次开始前 dirty 文件；实施前由协调者提供精确冻结 revision 与 dirty 来源记录，不能直接从未知 main 开工。
- 本包只新增模块、测试、fixture；`src/native/session.ts`、`src/pi-adapter/native-executor.ts`、`extensions/pi-sparkle/index.ts`、`src/run/*`、`src/learning/auto-loop.ts` 和共享状态文档仅 CI-1b 可改；privacy dictionary 由 CI-1a 修改。
- N1 与 E1 可并行；N2 依赖 N1 + E1 接口冻结；N3 依赖 N2；CI-1a在E1后串行完成共享存储/隐私基础，CI-1b 在 CI-1a + N3 + E3 及适用前置 gate 后完成运行接线。
- 不在本包实现真实多模型 executor、动态模型调用诊断、BKT、普通 Pi 全会话观测、自动纠错、自动 candidate apply。

### 当前事实与第一验收场景

`NativeSession.delegate` 接收 1–4 个显式只读任务，终止后运行 auto-loop，结果明确为 `independentVerification: UNOBSERVED`。现有 `ExecutionEvent` 提供工具开始/结束和 executor 结束，但 `TOOL_FINISHED` 没有可信 exitCode，不能由 summary 文本猜出来。`proposeFromAnomaly` 目前只是库函数；它接受完整 `AnomalyPacket`，不能用伪造 P/H/score 补成生产消费者。

第一场景是：宿主冻结了必需验收项，fake child 报告 SUCCESS/PASSED，但宿主没有对应独立验收。应生成 `missing-independent-verification` 诊断，并仍显示 UNOBSERVED；没有冻结验收要求时只能显示 `acceptance-unobserved` 信息，不应判为不合规。对照场景为同一目标已有 E1 验证通过记录，缺口消失。授权拒绝、provider/工具错误、取消、缺失/损坏事实、未声明验证要求都作为负对照，不能被本包归因为模型失败。

### 文件 ownership

| 包 | 唯一写入文件 | 独立交付物 | 禁止写入 |
|---|---|---|---|
| N1 | `src/native/observation.ts`；`test/unit/native/observation.test.ts` | 有界过程事实转换 | executor/protocol/session |
| N2 | `src/tracking/diagnosis.ts`；`test/unit/tracking/diagnosis.test.ts`；`test/fixtures/native-diagnosis.ts` | 可复现诊断队列投影 | gate/replay/auto-loop |
| N3 | `src/native/diagnosis-artifact.ts`；`test/integration/native/diagnosis-artifact.test.ts` | artifact 与只读展示 | CLI/extension/privacy 共用文件 |
| CI-1b | 主计划列明的共享文件和总体验收 | 持久化快照生产接线 | 不接通 live bandit/自动解阻塞 |

每包先 RED、后 GREEN、再邻接测试及 gate。新文件若已存在，先核对最新基线和 owner，不能覆盖另一 worker 的产物。

## N1 — 显式委派过程事实（owner Native-A；planned）

**Files:** Create `src/native/observation.ts`；Test `test/unit/native/observation.test.ts`。

**Consumes:** `AgentExecutionRequest`、`ExecutionEvent`（`src/execution/contract.ts`）；现有 RunId/TaskId/AgentInstanceId。事件序号由宿主 wrapper 按 attempt 单调递增，不能从模型参数接受。

**Produces:** 下列接口在本文件导出；这些是过程事实，不含 verdict/score/任务成功标签。

```ts
import type { AgentExecutionRequest, ExecutionEvent } from '../execution/contract.js';
export interface NativeFactSource {
  readonly runId: AgentExecutionRequest['runId'];
  readonly taskId: AgentExecutionRequest['taskId'];
  readonly agentInstanceId: AgentExecutionRequest['agentInstanceId'];
  readonly sequence: number;
  readonly origin: 'executor-lifecycle';
}
export type NativeObservationFact = { readonly source: NativeFactSource } & (
  | { readonly kind: 'tool-start'; readonly toolCallId: string; readonly toolName: string }
  | { readonly kind: 'tool-finish'; readonly toolCallId: string; readonly isError: boolean }
  | { readonly kind: 'executor-exit'; readonly outcome: 'SUCCESS' | 'FAILURE' | 'CANCELLED' }
);
export interface NativeObservationSnapshot {
  readonly schemaVersion: 'native-observation-v1';
  readonly facts: readonly NativeObservationFact[];
  readonly coverage: 'complete' | 'truncated' | 'unavailable';
  readonly dropped: number;
}
export function nativeFactFromEvent(request: AgentExecutionRequest,
  event: ExecutionEvent, sequence: number): NativeObservationFact | undefined;
export function createNativeObservationBuffer(limits?: {
  readonly maxFacts?: number; readonly maxBytes?: number;
}): {
  add(fact: NativeObservationFact): void;
  snapshot(): NativeObservationSnapshot;
};
```

- [ ] **1. RED：先验证工具错误正文不被复制，工具成功不变成验收。**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRunId, createTaskId, createAgentInstanceId } from '../../../src/domain/ids.js';
import { nativeFactFromEvent, createNativeObservationBuffer } from '../../../src/native/observation.js';
const request = { runId: createRunId(), taskId: createTaskId(),
  agentInstanceId: createAgentInstanceId(), prompt: 'secret-parent-prompt', workingDirectory: '.' };
test('process success never claims independent acceptance', () => {
  const fact = nativeFactFromEvent(request, { type: 'TOOL_FINISHED',
    toolCallId: 'read-1', isError: false, summary: 'Bearer secret-body' }, 2);
  assert.deepEqual(fact, { source: { runId: request.runId, taskId: request.taskId,
    agentInstanceId: request.agentInstanceId, sequence: 2, origin: 'executor-lifecycle' },
    kind: 'tool-finish', toolCallId: 'read-1', isError: false });
  assert.doesNotMatch(JSON.stringify(fact), /secret|PASS|taskSuccess|exitCode/);
  assert.equal(nativeFactFromEvent(request, { type: 'THINKING_DELTA', bytes: 30 }, 3), undefined);
});
test('truncation cannot masquerade as no tools executed', () => {
  const buffer = createNativeObservationBuffer({ maxFacts: 1, maxBytes: 4096 });
  for (const sequence of [1, 2]) buffer.add(nativeFactFromEvent(request,
    { type: 'TOOL_STARTED', toolCallId: `call-${sequence}`, toolName: 'sparkle_read_file' }, sequence)!);
  assert.equal(buffer.snapshot().coverage, 'truncated');
  assert.equal(buffer.snapshot().dropped, 1);
});
```

- [ ] **2. 运行 RED。** `pnpm test -- test/unit/native/observation.test.ts`；预期新模块缺失/导出缺失失败；记录实际输出，不接受因工具链无法启动的失败。
- [ ] **3. GREEN：白名单构造字段，不 spread 原始 event/request。**

```ts
// nativeFactFromEvent 的核心分支；先校验 sequence 是 >=0 safe integer。
const source = { runId: request.runId, taskId: request.taskId,
  agentInstanceId: request.agentInstanceId, sequence, origin: 'executor-lifecycle' as const };
switch (event.type) {
  case 'TOOL_STARTED': return { source, kind: 'tool-start', toolCallId: event.toolCallId, toolName: event.toolName };
  case 'TOOL_FINISHED': return { source, kind: 'tool-finish', toolCallId: event.toolCallId, isError: event.isError };
  case 'EXECUTION_FINISHED': return { source, kind: 'executor-exit', outcome: event.outcome };
  default: return undefined;
}
```

buffer 默认最多 512 facts、128 KiB UTF-8 JSON bytes；参数均须有限正 safe integer，不允许超过默认硬上限。相同 `(runId, agentInstanceId, sequence)` 同字节重放去重；不同字节抛 `DomainValidationError`。过限停止保留新事实、增加 dropped、coverage=truncated；snapshot 返回复制值。序号相同但 taskId 不同是冲突，不能借 taskId 掩盖身份冲突。

- [ ] **4. 增加并运行边界验收。** 空buffer complete 不等于执行成功；重复去重、冲突拒绝、maxBytes、非法序号、跨 attempt 分开、取消出口、所有非白名单事件不持久化。工具名/调用 ID 超 256 字符拒绝录入并把 coverage 标为 truncated，不截断成相同身份。运行 `pnpm test -- test/unit/native/observation.test.ts test/unit/pi-adapter/native-executor.test.ts test/unit/native/session.test.ts`、`pnpm typecheck`、`pnpm gate`。
- [ ] **5. 交付。** 提交只包含 N1 两文件和 N1 证据记录；协调者记录 RED/GREEN 命令输出、revision、所有 skip，独立 reviewer 检查事实来源和不接受自由文本。commit 建议 `feat: capture bounded native process facts`。

**验收/失败与回滚：** 未声明字段绝不落盘；不改变 executor yield 顺序；N1 无 I/O，可独立验证。CI-1b 中观测异常须禁用观测并披露 unavailable，不能改变原始执行结果或把缺失当零次工具调用。撤回 wrapper 注入即可停用，既有原始 run events 保留。

## N2 — 快照诊断与有界队列投影（owner Native-B；planned）

**Files:** Create `src/tracking/diagnosis.ts`、`test/fixtures/native-diagnosis.ts`；Test `test/unit/tracking/diagnosis.test.ts`。

**Depends:** N1 + E1 `OutcomeResolution` 已由各 owner 审核冻结。N2 可先写纯单元测试，不能自行实现 E1 的独立性判断。

**Consumes:** 持久化 `Event[]`、N1 snapshot、宿主冻结 binding 中的验收要求、E1 `OutcomeResolution`（`src/learning/outcome-provenance.ts`）。E1 observed 意味着证据资格通过，不等于 signal 为 PASS，更不等于归因到模型。

**Produces:** 仅诊断 artifact body，不产生 `ImprovementCandidate`、`ObservedSignal` 或新的 `AnomalyPacket`。

```ts
import type { Event } from '../run/events.js';
import type { RunId, TaskId } from '../domain/ids.js';
import type { NativeObservationSnapshot } from '../native/observation.js';
import type { OutcomeResolution } from '../learning/outcome-provenance.js';
export interface FrozenCheckRequirement {
  readonly taskId: TaskId; readonly bindingRef: string;
  readonly requiredCriterionIds: readonly string[];
}
export interface RunDiagnosisInput {
  readonly runId: RunId; readonly events: readonly Event[];
  readonly observations: NativeObservationSnapshot;
  readonly requirements: readonly FrozenCheckRequirement[];
  readonly outcomes: ReadonlyMap<TaskId, OutcomeResolution>;
}
export interface NativeDiagnosisItem {
  readonly sourceEventId: string; readonly taskId: TaskId;
  readonly code: 'missing-independent-verification' | 'acceptance-unobserved' | 'tracking-gate-recorded';
  readonly evidenceRefs: readonly string[];
  readonly ruleVersion: 'native-diagnosis-v1';
  readonly severity: 'information' | 'needs-verification';
  readonly suggestion: 'inspect-host-verification' | 'inspect-tracking-evidence';
}
export interface NativeDiagnosis {
  readonly schemaVersion: 'native-diagnosis-v1'; readonly runId: RunId;
  readonly sourceHeadEventId: string; readonly items: readonly NativeDiagnosisItem[];
  readonly observationCoverage: NativeObservationSnapshot['coverage'];
  readonly status: 'complete' | 'truncated'; readonly deferredCount: number;
  readonly activeRunMutation: false;
}
export function diagnoseNativeSnapshot(input: RunDiagnosisInput,
  limits?: { readonly maxItems?: number; readonly maxEvents?: number }): NativeDiagnosis;
```

`FrozenCheckRequirement` 只允许 CI-1b 从 E1 已冻结的宿主 binding 适配；不能由 TASK_RESULT、自报 evidenceIds、模型工具参数构造。N2 不解析 binding 自己宣布可信。N2核对 observed 的 evidence.runId/taskId 以及对应 requirement.bindingRef，错配拒绝；requiredCriterionIds来自宿主冻结evaluator definition，Stage 0没有可用解析接口时真实接线保持blocked。N2 所有来源需匹配同一 run，最新任务结果覆盖该任务早期报告；读取 head 之后追加的证据必须生成新 snapshot，不能修改历史诊断。

- [ ] **1. RED：创建可重复 fixture，然后断言缺口与非归因。** `test/fixtures/native-diagnosis.ts` 导出 `makeNativeDiagnosisFixture(): Promise<{ stateRoot: string; input: RunDiagnosisInput; dispose(): Promise<void> }>`：以 `mkdtemp` 创建隔离根；用现有 `NativeSession` + `ProtocolChildExecutor` 跑一个 reviewer；`EventStore.readAll()` 读取该 run；从 CHILD_MESSAGE/TASK_RESULT 取 taskId；把 fixture 的宿主冻结要求设为 `criterion-review`、bindingRef=`fixture-binding-v1`；outcomes 为 `unobserved/missing`；observations 为 complete 空数组。finally `rm(root,{recursive:true,force:true})`。fixture binding 只用于离线单元输入，不能进入生产资格路径。新增 fixture 的最小代码：

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeSession } from '../../src/native/session.js';
import { ProtocolChildExecutor } from '../../src/testing/fake-executor.js';
import { EventStore } from '../../src/run/event-store.js';
import type { RunDiagnosisInput } from '../../src/tracking/diagnosis.js';
export async function makeNativeDiagnosisFixture(): Promise<{
  stateRoot: string; input: RunDiagnosisInput; dispose(): Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), 'sparkle-diagnosis-'));
  const stateRoot = join(root, 'state');
  const dispose = () => rm(root, { recursive: true, force: true });
  const session = new NativeSession();
  try {
    const result = await session.delegate({ projectRoot: root, stateRoot,
      model: { provider: 'fake', id: 'diagnosis' }, executor: new ProtocolChildExecutor(),
      tasks: [{ role: 'reviewer', objective: 'Read-only fixture review' }] });
    const events = (await new EventStore(stateRoot, result.runId).readAll()).events;
    const reported = events.find(event => event.type === 'CHILD_MESSAGE' && event.payload.message.type === 'TASK_RESULT');
    if (reported?.type !== 'CHILD_MESSAGE' || reported.payload.message.type !== 'TASK_RESULT') throw new Error('fixture missing task result');
    const taskId = reported.payload.message.taskId;
    return { stateRoot, dispose, input: { runId: result.runId, events,
      observations: { schemaVersion: 'native-observation-v1', facts: [], coverage: 'complete', dropped: 0 },
      requirements: [{ taskId, bindingRef: 'fixture-binding-v1', requiredCriterionIds: ['criterion-review'] }],
      outcomes: new Map([[taskId, { status: 'unobserved', reason: 'missing' }]]) } };
  } catch (error) { await dispose(); throw error; }
  finally { await session.shutdown(); }
}
```

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeNativeDiagnosisFixture } from '../../fixtures/native-diagnosis.js';
import { diagnoseNativeSnapshot } from '../../../src/tracking/diagnosis.js';
test('a completion claim cannot fill missing host verification', async () => {
  const fixture = await makeNativeDiagnosisFixture();
  try {
    const before = JSON.stringify(fixture.input.events);
    const result = diagnoseNativeSnapshot(fixture.input);
    assert.ok(result.items.some(item => item.code === 'missing-independent-verification'));
    assert.equal(result.activeRunMutation, false);
    assert.equal(JSON.stringify(fixture.input.events), before);
    assert.doesNotMatch(JSON.stringify(result), /avoid|promoted|taskSuccess|model-failure/);
    const noRequirement = diagnoseNativeSnapshot({ ...fixture.input, requirements: [] });
    assert.ok(noRequirement.items.every(item => item.severity === 'information'));
  } finally { await fixture.dispose(); }
});
```

- [ ] **2. 运行 RED。** `pnpm test -- test/unit/tracking/diagnosis.test.ts`；预期诊断模块缺失或缺口断言失败；记录原因。
- [ ] **3. GREEN：实现确定性规则，绝不填造成功/失败分数。**

```ts
// 对每个最新 TASK_RESULT，在校验 run/task/sourceEventId 后执行：
const resolution = input.outcomes.get(message.taskId);
const required = input.requirements.find(row => row.taskId === message.taskId);
if (message.outcome === 'SUCCESS' && resolution?.status !== 'observed') {
  const mandatory = (required?.requiredCriterionIds.length ?? 0) > 0;
  items.push({ sourceEventId: event.id, taskId: message.taskId,
    code: mandatory ? 'missing-independent-verification' : 'acceptance-unobserved',
    evidenceRefs: required === undefined ? [] : [required.bindingRef],
    ruleVersion: 'native-diagnosis-v1', severity: mandatory ? 'needs-verification' : 'information',
    suggestion: 'inspect-host-verification' });
}
```

队列是持久化事件的**有界投影**：按源事件顺序、再 code 排序，`(sourceEventId,code,ruleVersion)` 精确去重。默认 maxItems=16/maxEvents=10000，正整数且不超过默认上限。事件超限整体拒绝诊断，不裁掉前缀后猜测 gate；条目超限保留前 16，返回 truncated/deferredCount。没有 RUN_CREATED、head、同 run 身份或有效事件时抛 `DomainValidationError`。

对已有 `ANALYSIS_QUEUED`，调用现有 `gateBlockCause(events)`，仅在 `replayRun(events).status === 'BLOCKED'` 且相邻 GATE_TRANSITION/RUN_BLOCKED 匹配时增加 `tracking-gate-recorded`，引用原 event/assessment refs；不重新给 P/H 打分、不把历史旧 block 当当前 block。消费者“完成”只是报告生成，不是从运行状态机 dequeuing。

- [ ] **4. GREEN 与负对照。** 添加 E1 observed PASS 和 observed FAIL 两个合法 fixture：都不因缺少验收而报缺口；FAIL 的内容由 E 包负责，本包只显示来源。缺失/legacy/self-report-only/binding-mismatch/source-deleted 均不能变 observed。provider/授权/取消结果不生成 model avoid；tool SUCCESS 不补 criterion；truncated/unavailable 不声称“验证从未执行”。重复snapshot同结构；不同项目/run引用拒绝；旧block已显式解除无当前gate条目；相同新block前混入旧transition不得借用旧原因。
- [ ] **5. 验证与交付。** `pnpm test -- test/unit/tracking/diagnosis.test.ts test/unit/tracking/analysis.test.ts test/unit/run/inspection.test.ts test/unit/run/gate-status-posture.test.ts test/unit/routing/live-isolation.test.ts`；`pnpm typecheck`；`pnpm gate`。commit 建议 `feat: diagnose native evidence gaps offline`。证据记录声明 pure diagnostic、no provider、no unblock、no outcome-supported。

**验收/失败与回滚：** 两次相同输入除 opaque artifact locator 外内容相同；没有 registry/run writer import；缺失数据保留未知。若发现基线 status 与 snapshot 不一致，停止候选连接并记录冲突；不修复运行事件、不自动 re-run executor。

## N3 — Run artifact 和可查看结果（owner Native-C；planned）

**Files:** Create `src/native/diagnosis-artifact.ts`；Test `test/integration/native/diagnosis-artifact.test.ts`。

**Depends:** N2；存储复用 `saveLoopArtifact/readLoopArtifact`，不扩展 Event/CLI。privacy 字典对本 body kind 的说明和 deletion 基础由 CI-1a 修改，CI-1b 完成生产接线及端到端删除验收后，本包才可宣称 Wired。

**Interfaces:** 导出下列类型；`LoopArtifactRef` 来源于 `src/execution/loop-artifact.ts`，opaque ID 仅定位、无完整性证明。

```ts
import type { RunId } from '../domain/ids.js';
import type { LoopArtifactRef } from '../execution/loop-artifact.js';
import type { NativeDiagnosis } from '../tracking/diagnosis.js';
export interface DiagnosisArtifactBody {
  readonly kind: 'native-diagnosis'; readonly schemaVersion: 1;
  readonly evidencePosture: 'local-weak'; readonly diagnosis: NativeDiagnosis;
}
export function saveNativeDiagnosis(input: {
  readonly stateRoot: string; readonly diagnosis: NativeDiagnosis;
  readonly previousRef?: LoopArtifactRef;
}): Promise<LoopArtifactRef>;
export function readNativeDiagnosis(stateRoot: string, runId: RunId,
  artifactId: string): Promise<DiagnosisArtifactBody>;
export function renderNativeDiagnosis(body: DiagnosisArtifactBody): string;
```

- [ ] **1. RED：真实 run-scoped 保存/读取，来源缺失拒绝，重复重用。**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diagnoseNativeSnapshot } from '../../../src/tracking/diagnosis.js';
import { saveNativeDiagnosis, readNativeDiagnosis, renderNativeDiagnosis } from '../../../src/native/diagnosis-artifact.js';
// N2 fixture 已导出 stateRoot/input/dispose；N3不修改该fixture。
test('run artifacts retain the distinction between claim and acceptance', async () => {
  const { makeNativeDiagnosisFixture } = await import('../../fixtures/native-diagnosis.js');
  const fixture = await makeNativeDiagnosisFixture();
  try {
    const diagnosis = diagnoseNativeSnapshot(fixture.input);
    const ref = await saveNativeDiagnosis({ stateRoot: fixture.stateRoot, diagnosis });
    const reused = await saveNativeDiagnosis({ stateRoot: fixture.stateRoot, diagnosis, previousRef: ref });
    assert.equal(reused.id, ref.id);
    const body = await readNativeDiagnosis(fixture.stateRoot, diagnosis.runId, ref.id);
    assert.equal(body.evidencePosture, 'local-weak');
    assert.match(renderNativeDiagnosis(body), /UNOBSERVED/);
    assert.doesNotMatch(renderNativeDiagnosis(body), /activated|promoted|unblocked/);
  } finally { await fixture.dispose(); }
});
```

- [ ] **2. 运行 RED。** `pnpm test -- test/integration/native/diagnosis-artifact.test.ts`；预期新模块缺失或 persistence 断言失败。
- [ ] **3. GREEN：校验结构后复用 artifact API。**

```ts
const body: DiagnosisArtifactBody = { kind: 'native-diagnosis', schemaVersion: 1,
  evidencePosture: 'local-weak', diagnosis: input.diagnosis };
if (input.previousRef !== undefined) {
  const prior = await readNativeDiagnosis(input.stateRoot, input.diagnosis.runId, input.previousRef.id);
  if (JSON.stringify(prior) === JSON.stringify(body)) return input.previousRef;
}
return saveLoopArtifact({ stateRoot: input.stateRoot, runId: input.diagnosis.runId, body });
```

read 先调用现有 reader，再严格白名单解析全部枚举/布尔/ID/数组边界；拒绝 foreign run、陌生 body kind、额外原始正文键、过量 items、无 head、非法 source refs、旧 envelope。save 同样校验，previousRef 不存在/损坏/错run即失败，不静默新建掩盖失配。equal-length 篡改不能保证发现，明确 local-weak；不制造“认证来源”措辞。CI-1b 保证每run单一诊断写者；并发同snapshot允许产生两个等价 artifact，但不得重复创建候选或产生任何控制动作。

render 只用固定文案、schema枚举、run/task/refs：证据缺口写 `UNOBSERVED — required host verification is missing`；observed失败不显示在缺口列表；truncated 写 deferred 数与 coverage；tracking block 写“诊断已生成，运行仍需显式 unblock”。不要把诊断建议标成已批准适配资源。E3 candidateId 在 CI-1b 单独展示 proposed/unactivated，不由本模块创建或验证。

- [ ] **4. GREEN 与隐私/恢复验收。** 增加现有 `deleteRunRecords` 删除后 read/save 拒绝、不复活目录；same-length JSON 非法结构拒绝但合法同长篡改不承诺检测；存储 symlink/缺 run/错误 ID沿用现有 fail-closed；readonly rendering 不改文件；重复previousRef相等重用、新head生成新记录、旧记录不改写。工具正文/summary/秘密样例不能出现在 artifact 字节中。
- [ ] **5. 验证与交付。** `pnpm test -- test/integration/native/diagnosis-artifact.test.ts test/unit/execution/loop-artifact.test.ts test/integration/cli/delete.test.ts`；`pnpm gate`；`pnpm security:probe`；`pnpm pi:probe`。commit 建议 `feat: persist inspectable native diagnosis artifacts`。失败保留原run证据，披露 diagnosis unavailable，不 fallback 成 success/候选。

## CI-1b handoff contract（共享接线由协调者执行）

- [ ] 将 N1 wrapper 加到显式 delegate executor 外层，保留 supportedModelIds/steerText 能力及原 yield顺序；普通宿主session不订阅。run尚无 durable identity 时不能保存 artifact。
- [ ] 保存 N1 facts于现有 run-loop-artifact body，N2只读回已持久化facts和EventStore snapshot；记录 source head，禁止以当时内存声称durable。N1失败→coverage unavailable；原执行按既有规则结算。
- [ ] 对 COMPLETED/FAILED/BLOCKED 的稳定持久化snapshot显式调用 N2/N3；CANCELLED/shutdown不启动新学习。BLOCKED诊断不能解除阻塞；唯一调用点从原gate写者分离，不循环等待模型输出。
- [ ] E1结果由宿主冻结binding重建；E3候选仅从合格历史生成。本包 evidence-gap 不直接调用 `proposeFromAnomaly`，因为没有可替代的已批准 prompt/workflow baseline 和真实改进内容。
- [ ] 同时更新现有 `formatGateCauseNote` 的“没有consumer”披露，但只有接线已生效时才写“diagnostic artifact available; explicit unblock remains required”。CI-1b负责 `test/integration/cli/blocked-next.test.ts`、`blocked-gate-cause.test.ts` 及 frozen JSON pinning；不新增自动状态转换。
- [ ] 新增全链假executor验收：自报成功→缺宿主验收→诊断可查看；E1真实本地fixture验收→无缺口；授权/provider失败非模型归因；kill switch无候选/无bandit；删除cascade；重放不重复创建候选；run event字节不因诊断改变。
- [ ] CI-1a先刷新 `src/privacy/record-classes.ts` 的既有 run-loop-artifact body用途和privacy说明；CI-1b复核接线后的状态矩阵与证据。N1 observation body不得含工具正文、raw prompt或隐含exitCode；不另建跨run的未注册存储。

## Delivery record and deferred work

本计划验收：N1事实有来源、N2缺口可复现、N3可查看且删除有效、CI-1b共享接线独立审查；不以源码存在替代上述验收。各包交付记录使用 [verification template](../../templates/verification-record.md)，包含 files/symbols、精确revision、RED原因、GREEN结果、gate/probes、skip、兼容/隐私风险、reviewer和未决项；活动状态由协调者唯一更新。

最近验证：2026-09-25 文档规划；产品测试命令为未来实施验收，未在本文件声明已执行。本轮文档检查和独立计划审查结果由主计划交付报告记录。下一实施命令：在协调者冻结基线、独占文件worktree及接口后执行 N1 RED；当前不能根据本计划宣称自动诊断已 Wired。

后续条件：真实多模型executor须另立任务，证明 request model/provider实际执行、授权隔离、路由事件与provider计费一致后才可替换当前拒绝保护；通用prompt/workflow候选须有版本化可执行格式、批准baseline、独立后续验收和回滚后另开计划。本包不为这两项预留未经验证的公共API。
