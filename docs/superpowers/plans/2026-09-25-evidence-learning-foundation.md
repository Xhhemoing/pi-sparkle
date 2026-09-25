# Evidence and Cross-Episode Learning Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 S0-min 冻结的中立宿主结果形成有界跨 episode 历史视图，只输出 candidate-only 诊断，不批准、晋升或激活策略。

**Architecture:** S0-min 定义并冻结 host-owned outcome DTO、来源/绑定、失败归因和 canonicalizer。L1 通过 neutral evaluation/feedback schema 摄取并有界读取合格结果；L2 把原 E2/E3 合并为即时重建的 `historical-candidate-view`。当前 MVP 不建 learning-owned outcome store，不引入全局 lifecycle 长锁，也不进入 approval/promotion/activation。

**Tech Stack:** TypeScript / Node.js `>=22.19.0`、`pnpm@10.17.1`、`node:test`、现有 JSONL/atomic-file/file-lock。

## 2026-09-25 independent review correction (controlling)

同日后续独立审查对原 E1-E4/CI-1a/CI-1c 设计给出 **REQUEST CHANGES**。本节是当前派工契约；以下原草案保留作历史，不表示仍可执行，也没有新的独立 PASS。

### Corrected learning scope

1. **S0-min is a hard dependency.** 原 E1 不再允许作为可接受的独立 pure slice 先行完成。只有 S0-min 冻结 host-owned terminal outcome DTO、来源/绑定、失败归因和 canonicalizer 后，L1 才能实现并验收；测试夹具只能帮助设计，不能替代冻结契约。
2. **Persisted outcome is neutral.** 持久化 host outcome DTO 属于 evaluation/feedback schema，不属于 `src/learning/`。Learning 只能导入/消费该中立类型；不得创建 learning-owned outcome record、复制宿主结果到第二数据库，或接受 caller 自报 `trusted` 字段。
3. **L1 replaces E1 plus the minimum ingestion work.** L1 validates the frozen DTO, preserves host failure attribution, uses the existing neutral store/lifecycle, and exposes a bounded eligible-history reader. Missing, deleted, mismatched, foreign, legacy, or incomplete sources remain `UNOBSERVED`/ineligible.
4. **L2 merges E2 and E3.** One `historical-candidate-view` reconstructs compatible cross-episode history and produces candidate-only inspection output. There is no separate E2 history window followed by E3 proposal task in the MVP.
5. **Activation and promotion are deferred.** E4, CI-1c, approval fixtures, registry activation, routing changes, and formal promotion are outside this MVP. L2 cannot modify active policy, current/new leases, registry status, or execution behavior.
6. **No global lifecycle long lock.** B0 first records the current lock graph. L1/L2 use bounded reads, existing short store locks and fail-closed revalidation. A new cross-store lifecycle lock may be proposed only in a later design that names a concrete unresolved race and proves lock order/crash behavior with deterministic tests.
7. **One canonicalizer.** Canonical JSON fields must call the exact canonicalizer frozen by S0-min. This plan cannot add a learning-local `stableStringify`, alternate key ordering, or a second canonical byte contract.

### Corrected tasks

| Task | Depends on | Scope | Acceptance | State |
|---|---|---|---|---|
| L1 | S0-min | neutral outcome ingestion + bounded eligible-history reader | forged/incomplete/deleted sources fail closed; persisted DTO remains evaluation/feedback-owned | planned |
| L2 | L1, D1 | merged historical window/diagnosis as candidate-only view | compatible multi-episode inputs are visible; no active-state, approval or routing mutation | planned |

Focused verification is defined when B0 freezes exact files and the S0-min type/canonicalizer names. Final delivery still requires `pnpm gate` plus relevant privacy/security checks and a fresh independent review; these commands are not pre-recorded as PASS.

## Superseded pre-review draft retained for provenance

All later E1-E4, CI-1a/CI-1c, lifecycle-lock, approval, activation and promotion instructions are historical draft material and must not be dispatched where they conflict with the correction above.

## Global Constraints

- 本文件是 `planned` 实施设计，不是产品代码交付、独立审查 PASS 或门禁批准；用户授权本轮自主规划。
- 所有 shell 用 `pwsh`，每个脚本第一行 `$ErrorActionPreference = 'Stop'`，文本读写显式 UTF8。
- 保留 ADR-004 proposal-first、ADR-006 Pi inbound adapter、ADR-008 opaque ID / exact bytes / local-weak；不恢复 SHA-256 或添加替代密码学散列。
- 不降低 `ACTIONABLE_SAMPLES = 5`；保留 primary-model exclusion、failureClass 的宿主归因及 `SPARKLE_AUTO_ADAPT=0` 只观察不学习。
- 不接 live R1/bandit/topology，不改变活动运行快照，不自动晋升，不新增 apply 能力、训练导出或隐式数据迁移。
- 无真实 provider、benchmark、holdout、F6 seal、生产 apply；Stage 0、独立审查、pilot 数据/预算和 F6 仍各自开放。
- `TASK_RESULT PASSED/FAILED`、工具 exit 0、`EvaluationRecord.independenceClass` 和 caller 自报的 `trusted:true` 都不能单独证明独立验收。
- 既有未提交源码修改先由 coordinator 固定基线并保全；实施在各自 `codex/` worktree，文件 lease 不得重叠。

## Identity and Authority

- ID: `TASK-20260925-evidence-learning-foundation`；Owner: Evidence Agent；State: `planned`；opened: 2026-09-25。
- 上级：[受控持续改进路线图](2026-09-25-controlled-improvement-roadmap.md)；相邻：[Native observation/diagnosis](2026-09-25-native-observation-diagnosis.md)。
- 依据：[ADR-004](../../decisions/0004-controlled-adaptation.md)、[ADR-006](../../decisions/0006-pi-extension-reverse-adapter.md)、[ADR-008](../../decisions/0008-remove-sha256.md)、[status matrix](../../status-matrix.md)。
- 前置：[Stage 0 / evaluator-apply boundary](2026-09-21-evaluator-apply-boundary.md)。本包纯函数与离线 fixture 可先做；真实宿主结果接入必须等其冻结的来源/验收契约明确。
- 最后调查基线：`f15a3b81d6ff8b2e1b67ac0f26ca5bc7937455bb` + 既有 dirty tree；实施前必须重记实际 HEAD，不把该 SHA 当未来验收版本。

## Problem, Scope and Acceptance

已读 `auto-loop.ts::runAutoAdaptLoop`、`diagnostics.ts::diagnoseModelProjectIssues`：持久化后仍只用本次 signals 诊断。2026-09-25 合成复现显示同项目 4+4 次失败只各看 4，单批 5 才提出候选，bandit 总计 13；该复现说明连接限制，不证明真实模型收益。

已检查存储：`src/feedback/store.ts` 有 `readFeedback`、redaction、tombstone、写锁及有限重试；`src/evaluation/types.ts` 有 EvaluationRecord，但不存在 `src/evaluation/store.ts` 或独立 evaluation JSONL。`src/execution/loop-artifact.ts` 已有宿主验收 artifact 保存/读取/随 run 删除。复用这些结构，禁止凭名称假定已有 evaluation store。

范围：一个独立验收列、一个兼容版本窗口、一个模型候选路径和下一次快照机制验证。不扩大到用户偏好、通用记忆、自动错误修复或外部宿主产品化。

- [ ] E1：来源可重建；自报、legacy、缺失/删除证据仍为 UNOBSERVED；独立 FAIL 与模型责任分离。
- [ ] E2：同项目兼容版本跨 episode 累积；重复/冲突/超窗/异项目排除；删除不能被读取或追加复活。
- [ ] E3：两 episode 的合格 4+4 可提出候选；单 episode、八条自报、provider 错误不产生模型候选。
- [ ] E4：候选不改 active；离线显式批准 fixture 后新 run 与 resume 尚未租赁节点可读取新版本，已租赁/已记录决策不变。
- [ ] CI-1b 与每包独立 reviewer 明确区别实现结果、命令验证、独立评审、人工批准；不把测试中的批准对象当真实批准。

## File Ownership and Interfaces

| 任务 | 独占新文件 / 测试 | 依赖 | 状态 / owner |
|---|---|---|---|
| E1 | `src/learning/outcome-provenance.ts`；`test/unit/learning/outcome-provenance.test.ts`；`test/fixtures/learning-outcome.ts` | Stage 0 接口冻结；离线 fixture 可先写 | planned / Evidence Agent |
| E2 | `src/learning/history-window.ts`；`test/unit/learning/history-window.test.ts`；`test/integration/learning/history-privacy.test.ts` | E1；CI-1a 存储/删除串行接线（pure selector 可先写） | planned / Evidence Agent |
| E3 | `src/learning/historical-diagnosis.ts`；`test/unit/learning/historical-diagnosis.test.ts` | E1、E2 | planned / Evidence Agent |
| E4 | `test/integration/learning/cross-episode-loop.test.ts` | E1–E3 + CI-1b + CI-1c | planned / Evidence Agent |

**CI-1a/CI-1b coordinator-owned integration，Evidence/Native implementer 均不得直接修改：** `src/learning/auto-loop.ts`、`src/learning/signals.ts`、`src/feedback/types.ts`、`src/feedback/store.ts`、`src/privacy/deletion.ts`、`src/privacy/record-classes.ts`、`docs/data-dictionary.md`、`src/native/session.ts`、`src/cli/main.ts` 及它们的现有测试。`src/learning/observation-ledger.ts` 若需隐私更正也只能 CI-1b 单写。E1–E4 各自提交所拥有新文件；CI-1a 先交付 schema/lifecycle/store，CI-1b 再接运行，CI-1c 最后接批准来源复验。CI-1c 独占文件见主计划，E4 不直接改 promotion。

已有 API 复用：`readFeedback(stateRoot)`、`appendFeedbackWithRetry`、`readFeedbackTombstoneIds`、`readLoopArtifact(stateRoot, runId, id)`、`deleteEpisodeRecords`、`deleteRunRecords`、`diagnoseModelProjectIssues`、`loadLearnedRouting`、`promoteWithRegistry`。签名以当前源码为准，不改既有 CLI/event 字段语义。

### E1 public contract — 单一 provenance 定义

以下类型放 E1 新模块；导入 `ProjectId/EpisodeId/RunId/TaskId`、`EvaluationRecord/EvaluationTarget`、`ObservedSignal`、`FailureClass`。Native N2 只消费 `OutcomeResolution`，不另造一个“可信结果”类型。

```ts
export interface LearningEvidenceV1 {
  readonly schemaVersion: "learning-evidence-v1";
  readonly projectId: ProjectId;
  readonly episodeId: EpisodeId;
  readonly runId: RunId;
  readonly taskId: TaskId;
  readonly outcomeRef: string;
  readonly bindingRef: string;
  readonly evaluatorVersion: string;
  readonly rubricVersion: string;
  readonly target: EvaluationTarget;
  readonly evidencePosture: "local-weak";
}
export type OutcomeResolution =
  | { readonly status: "observed"; readonly signal: ObservedSignal;
      readonly evidence: LearningEvidenceV1 }
  | { readonly status: "unobserved"; readonly reason: "missing" | "legacy"
      | "self-report-only" | "binding-mismatch" | "non-independent"
      | "invalid-artifact" | "source-deleted" };
export interface ResolveLearningOutcomeInput {
  readonly stateRoot: string; readonly projectId: ProjectId;
  readonly episodeId: EpisodeId; readonly runId: RunId;
  readonly taskId: TaskId; readonly outcomeRef: string;
}
export function resolveLearningOutcome(
  input: ResolveLearningOutcomeInput
): Promise<OutcomeResolution>;
```

宿主写入的两种 artifact body（均用现有 `saveLoopArtifact` 外层 envelope，不另建目录/DB）：

```ts
export interface HostOutcomeBindingV1 {
  readonly kind: "host-outcome-binding-v1";
  readonly projectId: ProjectId; readonly episodeId: EpisodeId;
  readonly runId: RunId; readonly taskId: TaskId;
  readonly modelId: string; readonly modelVersion: string;
  readonly family: string; readonly featureVersion: string;
  readonly criterion: "taskSuccess";
  readonly evaluatorVersion: string; readonly rubricVersion: string;
  readonly evaluatorDefinitionCanonicalJson: string;
  readonly target: EvaluationTarget;
}
export interface HostOutcomeArtifactV1 {
  readonly kind: "host-outcome-v1";
  readonly bindingRef: string;
  readonly evaluation: EvaluationRecord;
  readonly observedEvaluatorDefinitionCanonicalJson: string;
  readonly failureClass?: FailureClass;
}
```

这两个 body 是 **proposed host adapter contract**：Stage 0/CI-1b 必须在 evaluator 执行前从宿主已冻结 definition、run/episode/task/model 绑定生成 binding；执行后从独立 evaluator 的结构化结果生成 outcome。不是把 JSON 的 kind 或 evaluator identity 当授权。Pi 工具、extraSignals、child report 均不可调用写入该类型的入口；工具 schema 不接收上述字段。CI-1b 必须以源码可达性/negative tests 证明这个边界。

resolver 从已存在 run 的 opaque outcomeRef 读取 body，再读其 bindingRef；核对 durable run/episode/task/model 绑定、目标及版本、evaluator/rubric 版本、canonical definition 精确相等、criterion 与实际 evaluator 结果。`createEvaluationRecord` 当前把“存在 evidence 字符串”算 PASS，不能直接作为真实 evaluator 结果生成器。必须复用 Stage 0 独立 evaluator 的结果解析；缺少该接口时真实接线保持 blocked，不能用字符串存在性替代。

版本比较中的rubricVersion明确取 `evaluation.evaluator.rubricVersion`（string）；`evaluation.rubricVersion`（number）连同rubricId单独与冻结definition核对，不能混为同一字段。缺少modelVersion/featureVersion/family/evaluator/rubric绑定任一项均为binding-mismatch，不凭当前配置补旧事实。

PASS/FAIL 只有 `deterministic` + `independent` 且完整 binding 才输出 observed；ABSTAIN/UNOBSERVED、same-author、paired 不计样本。FAIL 可以 observed 但 `failureClass` 非 model/缺失时不得影响模型候选；失败归因由宿主结构化 verifier/环境错误生成，不能从 child 文案补出 model。现有 closed-loop 的 `accepted:false` 也不能自动等价 taskSuccess FAIL。

ID 只是 locator：相同长度本地替换不可检测，故始终标 `local-weak`。该机制限制应用内伪造路径，不声称抵御拥有 stateRoot 写权限的攻击者。旧 artifact 不静默迁移；resolver 可显示 legacy，但不得反推身份。

### Task E1: 独立结果解析与声明分离

**Consumes / Produces:** consumes 宿主冻结的两类 body + existing `readLoopArtifact`；produces 上述 `OutcomeResolution`。N2 用 unobserved 判断“宣称完成但缺少独立验收”，不得给模型打失败奖励。

- [ ] **RED:** 新建测试，先覆盖 child-shaped artifact、target/version/command definition mismatch、foreign project/run、缺少文件、删除 run、旧 schema；expected `unobserved`。

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveLearningOutcome } from "../../../src/learning/outcome-provenance.js";
import { createProjectId, createEpisodeId, createRunId, createTaskId } from "../../../src/domain/ids.js";

test("absent source stays unobserved", async () => {
  const result = await resolveLearningOutcome({
    stateRoot: ".agent_workspace/absent-outcome-fixture",
    projectId: createProjectId(), episodeId: createEpisodeId(),
    runId: createRunId(), taskId: createTaskId(),
    outcomeRef: "art_v2_00000000-0000-4000-8000-000000000001"
  });
  assert.equal(result.status, "unobserved");
});
```

- [ ] **Run RED:** `pnpm test -- --test-concurrency=1 test/unit/learning/outcome-provenance.test.ts`，先看到缺少 resolver 的失败，再由数据不匹配断言保持红色；导入缺失不是全部 RED 证据。
- [ ] **GREEN:** 实现 resolver 严格 schema/identity/binding 解析；使用 `readLoopArtifact`，ENOENT/已删除映射 missing/source-deleted，错误内容映射 invalid-artifact；权限/I/O 故障显式抛出，不伪装 missing。
- [ ] 增加真实临时 run event store + `saveLoopArtifact` 的 host fixture，断言一个合格 PASS、一个非模型 FAIL、一个宿主判定的 model FAIL；绑定负例只改变一个字段。所有 fixture 无 provider。
- [ ] **Verify:** 上述 focused 命令 + `pnpm typecheck`；CI-1b 后运行 `pnpm test -- --test-concurrency=1 test/unit/tracking/independent-evidence-posture.test.ts test/unit/execution/acceptance.test.ts test/unit/learning/signals.test.ts`。
- [ ] **Handoff:** 提交 E1 owned files，记录已冻结 schema、negative tests、未接 live 的入口；有 binding bypass 即停止合并并保持 UNOBSERVED。


### E1 test fixture export (test-only, no production trust)

E1 also owns `test/fixtures/learning-outcome.ts`; E2/E3 import it without editing it. It constructs already-resolved values for pure selector tests, never replaces E1's separate real-artifact resolver integration fixtures.

```ts
import { randomUUID } from "node:crypto";
import { createProjectId, createEpisodeId, createRunId, createTaskId } from "../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../src/domain/timestamp.js";
import type { OutcomeResolution } from "../../src/learning/outcome-provenance.js";
export function makeLearningOutcomeRows() {
  const projectId = createProjectId();
  const episodes = [createEpisodeId(), createEpisodeId()] as const;
  const rows: OutcomeResolution[] = Array.from({ length: 8 }, (_, index) => {
    const episodeId = episodes[index < 4 ? 0 : 1];
    const runId = createRunId(); const taskId = createTaskId();
    const outcomeRef = `art_v2_${randomUUID()}`;
    return { status: "observed", evidence: {
      schemaVersion: "learning-evidence-v1", projectId, episodeId, runId, taskId,
      outcomeRef, bindingRef: `art_v2_${randomUUID()}`,
      evaluatorVersion: "eval-v1", rubricVersion: "rubric-v1",
      target: { artifactId: `artifact-${index}`, artifactVersion: "1" },
      evidencePosture: "local-weak"
    }, signal: {
      source: "deterministic", kind: "deterministic", projectId, episodeId, runId, taskId,
      modelId: "cheap", modelVersion: "model-v1", family: "review", featureVersion: "features-v1",
      criterion: "taskSuccess", outcomeKind: "FAIL", failureClass: "model", score: 15,
      boundary: "execution", summary: "host independent task outcome", evidenceIds: [outcomeRef],
      createdAt: parseIsoTimestamp("2026-09-24T00:00:00.000Z")
    } };
  });
  const policy = { asOf: "2026-09-25T00:00:00.000Z", maxAgeDays: 30, maxOutcomes: 200,
    minEpisodes: 2, modelVersion: "model-v1", featureVersion: "features-v1",
    evaluatorVersion: "eval-v1", rubricVersion: "rubric-v1" } as const;
  return { projectId, rows, policy };
}
```

### Task E2: 复用 feedback 的有界历史窗口与删除

**Storage decision:** CI-1a 在 `FeedbackRecord` 添加可选 `learningEvidence?: LearningEvidenceV1`，不保存 signal.summary、原文、绝对路径、check stdout 或整份 evaluation 的第二份拷贝。artifact 保留原生生命周期；FeedbackRecord 仅提供 project/episode/ref 索引。既有无字段记录照常可读，但不能据 kind/score 升级为历史合格样本。CI-1a 对该可选字段做严格 read validation；新增索引 ID 用 opaque random ID，不再用现有 summary/score/model 的 hash32 生成跨 episode 冲突 ID。

**Produces:** 新文件导出下列接口，所有类型从 E1 或既有模块导入：

```ts
export interface HistoryWindowPolicy {
  readonly asOf: string; readonly maxAgeDays: 30;
  readonly maxOutcomes: 200; readonly minEpisodes: 2;
  readonly modelVersion: string; readonly featureVersion: string;
  readonly evaluatorVersion: string; readonly rubricVersion: string;
}
export interface LearningHistoryWindow {
  readonly signals: readonly ObservedSignal[];
  readonly evidence: readonly LearningEvidenceV1[];
  readonly excluded: Readonly<Record<string, number>>;
  readonly truncated: boolean;
  readonly complete: boolean;
  readonly scannedBytes: number;
  readonly scannedLines: number;
  readonly resolvedCount: number;
  readonly budgetReason?: "history-budget-exceeded" | "source-budget-exceeded";
}
export function loadLearningHistory(input: {
  readonly stateRoot: string; readonly projectId: ProjectId;
  readonly policy: HistoryWindowPolicy;
}): Promise<LearningHistoryWindow>;
export function selectLearningWindow(input: {
  readonly projectId: ProjectId; readonly policy: HistoryWindowPolicy;
  readonly resolved: readonly OutcomeResolution[];
}): LearningHistoryWindow;
```

- [ ] **RED:** 新建窗口测试；fixture 的每个 observed result 必须完整填入 E1 类型和 signal，`runId/taskId` 独立。以 4+4 兼容结果和重复第一条输入测试去重；同一 source tuple 的矛盾 score/outcome 必须整个 key 排除。

```ts
// 单元测试导入 makeLearningOutcomeRows；此fixture不能作为生产可信来源。
const { projectId, policy, rows } = makeLearningOutcomeRows();
const out = selectLearningWindow({ projectId, policy, resolved: [...rows, rows[0]!] });
assert.equal(out.signals.length, 8);
assert.equal(out.excluded.duplicate, 1);
assert.equal(new Set(out.signals.map(row => row.episodeId)).size, 2);
assert.deepEqual(selectLearningWindow({ projectId: createProjectId(), policy,
  resolved: rows }).signals, []);
```

- [ ] **Run RED:** `pnpm test -- --test-concurrency=1 test/unit/learning/history-window.test.ts`；另写临时状态集成测试使 `deleteEpisodeRecords` 后窗口从 8 降到 4，`deleteRunRecords` 后 source-deleted 排除。
- [ ] **GREEN:** CI-1a 在现有 feedback store 新增 `readLearningFeedbackBounded(stateRoot)`，复用严格 parser/tombstone 而不是调用全量 `readFeedback`。tombstone sidecar也限1MiB/20,000 IDs且严格解析；以 fd streaming 读取同一个文件快照，硬上限 8 MiB、10,000 行；文件预检超限或读取发现增长/预算超限均返回 `complete:false`、`history-budget-exceeded`，不给可提案的部分前缀。source解析最多400条、每次 loop-artifact JSON预检不超过64 KiB，binding与outcome两次读取的总预算不超过50 MiB；超限为 `source-budget-exceeded`、`complete:false`。在 learning-source lifecycle lock 内进行候选相关读取，锁超时单独披露。记录 scannedBytes/scannedLines/resolvedCount；窗口不完整时 E3 proposalIssues 必须为空。旧非学习 readFeedback 的行为不变。30天含边界、未来时间拒绝；过滤project/版本、完整解析/去重/冲突排除后按 `(createdAt, runId, taskId, outcomeRef)` 稳定排序，取最近200；样本策略截断仅使 `truncated:true`，与扫描不完整区分。遇到超限停止候选生成，由owner另开显式保留/索引优化任务；禁止静默裁剪用户历史或为生成候选提高限额。
- [ ] 比较单元固定 `(projectId, modelId, modelVersion, family, featureVersion, evaluatorVersion, rubricVersion)`；版本缺失不混入，family 不取跨组 mode。窗口保留单episode的诊断样本；E3在时间过滤、版本分组、去重、冲突排除及最近200截断后重算每组不同episode数，只有至少2个的组可提案。单episode窗口可返回4条而proposal为空；避免一次重试批次伪装跨任务经验。
- [ ] 去重用 exact canonical tuple `(projectId, episodeId, runId, taskId, criterion, target.artifactId, target.artifactVersion, evaluatorVersion, rubricVersion)`；same tuple 同结果只计一次，冲突全部拒绝。不能按 score、summary、采集时间或 opaque outcomeRef 的变化“制造新样本”；不使用摘要散列。
- [ ] CI-1a 新建 `src/learning/source-lifecycle.ts` 的 `withLearningSourceLifecycle(stateRoot, operation)`；stateRoot级固定锁 `adaptation/feedback/learning-source.lock` 是互斥锁，不是数据仓库。所有新 learningEvidence append、run/episode删除全过程、候选创建和 CI-1c批准采用同一外层锁；内部次序 lifecycle→run/episode（必要时）→feedback→registry，不允许反向获取或重入；已有持锁调用使用明确的 locked helper，不能递归取同一run锁。非学习反馈继续原规则，本保证只覆盖新的 learningEvidence 通道。
- [ ] deleteEpisodeRecords 在外层 lifecycle 锁内完成 feedback cascade 到 episode unlink 的整个流程；append 取得同锁后才检查source仍存在并进入feedback锁。deleteRunRecords同样从删除入口到来源清除/最终核对受保护。强制barrier停在cascade后、unlink前，并发新学习append必须等待，删除成功后拒绝；检查原始JSONL确无新的learningEvidence/body/summary残留，不只验证read过滤。空feedback log也不能绕过锁；不创建可学习索引。删除失败披露部分完成且不称删除成功；进程中断遗留锁按既有有界超时/显式恢复处理，不自动偷锁。
- [ ] CI-1a 删除时物理去除 `learningEvidence` 与 body/summary，不仅过滤视图。run 删除后 outcome artifact 消失且相关 learning index tombstoned；更新现有 privacy dictionary 与相应 pinning tests。不要宣称已抹除现有非学习日志或旧候选：它们按既有类分别管理。
- [ ] 不复用 `observationIdentity` 作新窗口 key：它包含 summary；新 eligible signal 使用常量 summary（`host independent task outcome`）。CI-1a 审查既有 ledger 的删除影响，不把新 free text 写进去；不在本包执行历史数据清理。
- [ ] **Verify:** `pnpm test -- --test-concurrency=1 test/unit/learning/history-window.test.ts test/integration/learning/history-privacy.test.ts test/unit/feedback/store-lock.test.ts test/unit/privacy/deletion.test.ts test/unit/privacy/record-classes.test.ts`；`pnpm security:probe`；`pnpm typecheck`。
- [ ] **Handoff:** 提交 E2 owned files；列出 CI-1a shared patch 和 lock-order proof；删除/并发用例未通过则 E2 不 accepted，E3 不接实际存储。

### Task E3: 累积诊断只生成建议输入

**Produces:** `src/learning/historical-diagnosis.ts` 导出纯函数，复用 diagnostics，不写 registry/bandit：

```ts
export interface LearningCompatibility {
  readonly projectId: ProjectId; readonly modelId: string;
  readonly modelVersion: string; readonly family: string;
  readonly featureVersion: string; readonly evaluatorVersion: string;
  readonly rubricVersion: string;
}
export interface HistoricalDiagnosisGroup {
  readonly compatibility: LearningCompatibility;
  readonly distinctEpisodes: number;
  readonly issues: readonly ModelProjectIssue[];
  readonly proposalIssues: readonly ModelProjectIssue[];
  readonly evidenceRefs: readonly string[];
}
export interface HistoricalDiagnosis {
  readonly groups: readonly HistoricalDiagnosisGroup[];
  readonly excluded: Readonly<Record<string, number>>;
}
export function diagnoseLearningHistory(input: {
  readonly window: LearningHistoryWindow;
  readonly primaryModelId: string;
}): HistoricalDiagnosis;
```

- [ ] **RED:** 使用 E1 的 `makeLearningOutcomeRows()` 完整4+4 fixture；先对rows.slice(0,4)调用select得到firstWindow，再对rows调用select得到secondWindow；first只有一episode所以无proposal，second按E2兼容组至少两episode。增加只有一个 episode 的 8 条、provider/contract/environment/tool/run failures、用户拒绝、self-report-only、未知版本负例。

```ts
const { projectId, policy, rows } = makeLearningOutcomeRows();
const firstWindow = selectLearningWindow({ projectId, policy, resolved: rows.slice(0, 4) });
const secondWindow = selectLearningWindow({ projectId, policy, resolved: rows });
const first = diagnoseLearningHistory({ window: firstWindow, primaryModelId: "premium" });
const second = diagnoseLearningHistory({ window: secondWindow, primaryModelId: "premium" });
assert.equal(first.groups.flatMap(group => group.proposalIssues).length, 0);
assert.equal(second.groups[0]?.proposalIssues[0]?.samples, 8);
assert.equal(second.groups[0]?.proposalIssues[0]?.modelId, "cheap");
assert.equal(diagnoseLearningHistory({ window: secondWindow,
  primaryModelId: "cheap" }).groups.flatMap(group => group.proposalIssues).length, 0);
```

- [ ] **Run RED:** `pnpm test -- --test-concurrency=1 test/unit/learning/historical-diagnosis.test.ts`。
- [ ] **GREEN:** 若window.complete=false则groups只能返回观察性diagnostics且所有proposalIssues为空；完整窗口按 E2 兼容组分别调用 `diagnoseModelProjectIssues`，每组返回 compatibility 与自己的 refs，禁止 flatten 后再合并；保留五样本/均值阈值；单 episode 只 diagnostics，不可 proposal。proposalIssues 过滤非 actionable、primaryModelId；evidenceRefs 返回参与组的 opaque outcomeRef，不返回 raw prose。
- [ ] **CI-1b handoff:** `runAutoAdaptLoop` 先持久化，再从成功落盘且未删除的 feedback 重建窗口；未落盘的数据不得组成候选的证据集。保留原 collected/persisted/dropped disclosure；存储失败不能借内存样本绕过。历史 corruption 显式诊断，不回退到更宽松的旧候选路径。
- [ ] CI-1b 对兼容组分别生成 candidate，避免 `ModelProjectIssue` 原来省略版本后将不同组再次混合；candidate 证据必须能重建同一窗口。重复 episode/run 导入不新建相同政策候选；不改变 existing active pointer。
- [ ] CI-1b 按主计划 CI-1c 的 `LearningCandidateSourceV1` 在 candidate 新增可选 source metadata（refs + 固定窗口/兼容组/版本，不放原文）；CI-1c 持久化批准入口在生命周期锁内重验到CAS保存完成。source删后拒绝只由该实际入口的负例证明，不能在测试里提前调用resolver并手写拒绝。纯同步promoteWithRegistry不是磁盘来源validator；已批准资源不自动回滚，沿用原rollback authority。
- [ ] **Verify:** focused E3 + `pnpm test -- --test-concurrency=1 test/unit/learning/diagnostics.test.ts test/unit/learning/auto-loop.test.ts test/unit/routing/live-isolation.test.ts`；`pnpm typecheck`。
- [ ] **Handoff:** 提交 E3 owned files；CI-1b 必须证明 `autoPromote:true` 仍 ignored、kill switch 不写 bandit/candidate、没有增加 selectArm 可达边。

### Task E4: 跨 episode 到批准后新租赁决策的离线闭环

**Files / inputs:** 依赖 CI-1c 批准来源复验；仅新建 `test/integration/learning/cross-episode-loop.test.ts`；参考 `test/unit/run/flowchart-learned-routing.test.ts` 的实际 `startFlowchartRun`/`resumeFlowchartRun` 依赖构造、`promoteInput` 字段及 `test/acceptance/adaptive-loop.test.ts` 的 gate fixture。不修改生产 promotion 规则或用直接 `registerBaseline` 冒充批准。

- [ ] **RED:** fixture 建临时 project/stateRoot，两个 episode、每个 4 个不同 task 的 E1 host artifact；真实 feedback store/auto-loop/registry 走完整离线路径。重复第二批、删除第一 episode、provider 负对照各用独立 fixture，避免共享状态掩盖错误。

```ts
// first/second/replayed 为三次真实 runAutoAdaptLoop 返回值。
assert.equal(first.created, false);
assert.equal(second.created, true);
assert.equal(second.promoted, false);
assert.equal(replayed.created, false);
assert.equal(registry.getActiveVersion(candidate.identity)?.versionId, candidate.parentVersionId);
assert.deepEqual((await loadLearnedRouting(stateRoot, projectRoot))?.avoid, []);
```

- [ ] **Run RED:** `pnpm test -- --test-concurrency=1 test/integration/learning/cross-episode-loop.test.ts`。在 CI-1b 未接线时必须因 second.created/sample count 断言失败，而非假 fixture 返回值。
- [ ] **GREEN / coordinator CI-1b + CI-1c:** 合并 shared patch 后跑 test；通过 CI-1c 的 `promoteHistoricalCandidate` 持久化服务及 CLI 同路径，保留现有 `promoteWithRegistry` 的独立 review + approvedBy + routing eval fixture，保存 registry，再启动下个 run。fixture actors 明确 `test-human` / `test-independent-reviewer`，它们只在测试临时目录存在。
- [ ] 覆盖没有显式 approval、错误 expectedCurrentVersionId、同作者 review、缺失来源时拒绝；同一个先启动的 paused run 在批准后 resume，已租赁的 first 节点仍保留旧 MODEL_ROUTED；尚未租赁的 second 节点按现有 pin 使用当前已批准策略。新 run 同样反映批准版本；未批准 candidate 不得影响任何新租赁。断言内容与 recorded version 两者，不只检查一个 mock 被调用。
- [ ] 运行中若 E1 outcome/schema 变更，先修文档/fixture，再合并；不在验收测试里下调 gate、把模拟 holdout 作为 F-PROD，或把 history/bandit 接到 live selector。
- [ ] **Verify:** focused E4；`pnpm test -- --test-concurrency=1 test/unit/run/flowchart-learned-routing.test.ts test/unit/routing/live-isolation.test.ts test/acceptance/adaptive-loop.test.ts`；集成头再跑 `pnpm gate`、`pnpm security:probe`、`pnpm pi:probe`。
- [ ] **Handoff:** 提交 E4 文件；报告“离线机制 exercised”，不报告实际质量改善/Outcome-supported。reviewer 独立重跑并检查 authority boundary 后才可接受本切片。

## Rollback, Gates and Closeout

- 回滚：停止 CI-1b 新 history bridge，保留只读诊断、既有已批准策略与已记录决策；新字段向后兼容、保留原始文件，不删除用户状态。若新 evidence 解析不可靠，则 fail closed UNOBSERVED，不能回退信任 child self-report。
- abort：跨项目泄漏、删后复活、没有独立标签仍提出候选、kill switch 写学习状态、已租赁决策被改写、共享写者冲突任一出现即停止合并。
- 30 天 / 200 / 2 episodes 是本规划的保守初值，不是经过效果实验的最优参数。变更需独立计划及负例，不能为凑样本临时改阈值。
- 档案模板：[verification record](../../templates/verification-record.md)；每任务证据存 `.agent_workspace/planning-2026-09-25/implementation/<task-id>/`，结论由 coordinator 提升到 dated `docs/reports/`。
- 每份 handoff 必带：task/owner/base HEAD、owned 文件与 shared patch 建议、RED/GREEN 原始输出、focused/full gate pass/fail/skip、接口兼容/隐私风险、未闭门禁、下一条命令。
- 当前 Closeout：仅规划；E1–E4 均未实施、未验证产品行为。文档自检/共同评审与 `pnpm workflow:check` 结果由主计划交付记录统一记录，不在本文件虚构测试通过。
- 下一条实施命令（基线/lease 分配后）：`pnpm test -- --test-concurrency=1 test/unit/learning/outcome-provenance.test.ts`；该文件先由 E1 RED step 创建。

同日语义纠偏：现有 flowchart-learned-routing pin允许resume未租赁节点读取当前已批准策略。本计划不引入run-wide freeze；仅保护已租赁/已记录决策。当前native单primary模型也无法自然达到非primary路由候选，E4仅为离线机制证据。
