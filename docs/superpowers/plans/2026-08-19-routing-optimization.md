# 模型路由优化计划（专家评审后）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement **one wave at a time**. Steps use checkbox (`- [ ]`) syntax for tracking. Do not start Wave 5 unless Wave 4’s simulation report exists and ADR-005 is signed.

**Goal:** 把「静态 R0 + 受控提案学习」做成可验收产品闭环；R1 只在库和仿真里变正确，不在 Checkpoint F 关闭前决定 live 调用。

**Architecture:** Live 继续走 `ModelRouter`（R0 等价：硬过滤 + 最便宜合格 + 已晋升 `routing-policy`）。学习面只写 candidate；`adapt eval` 产出带 cache key 的对照报告后，人才能 `adapt promote --approve`。R1 / bandit / 拓扑保持 shadow。公开先验只作为冻结 R0 排序，永不计入 R1 的 `nObsEff`。

**Tech Stack:** 现有 TypeScript / Node 22 / `tsx --test`。不新增运行时依赖、不接 Temporal、不训练权重。

**依据:** [三线终稿](../specs/2026-08-18-three-line-final.md) §5–6；[ADR-004](../../decisions/0004-controlled-adaptation.md)；[ADR-005](../../decisions/0005-checkpoint-f-holdout-open-questions.md)；[简报](../../reports/2026-08-19-model-routing-briefing.md)；2026-08-19 专家核对。

## 现在能不能优化？

**能排期、能验收的：** 策略晋升前的评估门、live 目录与资格矩阵继续对齐、按 taskId 的 `taskSuccess` 生产适配、冻结公开先验进 R0、flowchart 与 `--track` 读同一指针。这些会改善**可控性**和**归因正确性**，不是「自适应已经更好」。

**现在不能当目标的：** 把 R1/bandit 接到 live、对外说路由质量提升、用仿真关闭生产改进结论、自动晋升 `routing-policy`。

证据阶梯仍然有效：Present → Wired → Exercised → Outcome-supported。本计划结束时 Outcome-supported 必须仍是零，除非另开签字后的 Wave 5。

## Global Constraints

- Live `ModelRouter` / `assign.ts` / `flowchart-run.ts` 不得 `import` `routing/r1`、`routing/bandit`、`routing/shadow`、`routing/topology` 作为决策器（`test/unit/routing/live-isolation.test.ts` 必须保持绿）。
- `adapt auto` 只收集和提案；`SPARKLE_AUTO_ADAPT=0` 仍收集、不创建候选。
- 生产 R1（若存在于库调用）只吃 `taskSuccess` PASS/FAIL；tracking `P`/`H`/`score` 不写入观测。
- 高风险：`approvedForHighRisk` 硬过滤，探索次数保持 0。
- 公开榜禁止运行时 HTTP；必须快照文件 + hash + 精确别名。
- 仿真报告必须带 `evidenceClass: "simulation"`，文案禁止 improve/better/outperform（除非 `validateComparisonReport` 放行且仍标明 simulation）。
- 成本门沿用现行严格规则，直到 ADR-005 另签：效用差 95% CI 为正 **且** 成本差 95% CI **上界** ≤ 0。
- 测试：`corepack pnpm exec tsx --test <files>`，然后 `corepack pnpm run typecheck`。Windows 下 shell 需要完整权限。
- 未经用户明确要求不要 commit。

## 已经完成（不要重做）

| 项 | 证据 |
| --- | --- |
| Live 读 registry active `routing-policy`；禁止 `routing.json` 旁路 | `src/learning/learned-routing.ts`；`test/unit/learning/active-routing.test.ts` |
| `adapt auto` 不 CAS 晋升 | `src/learning/auto-loop.ts` |
| 结果分列；用户反馈不绑最后一次模型；R1/bandit 只吃 `taskSuccess` | `src/learning/signals.ts`、`bandit-store.ts`、`diagnostics.ts` |
| `MODEL_ROUTED` 可带 family / featureVersion / eligible / rejections | `src/run/events.ts`、`model-router.ts` |
| Live 高风险白名单 + `RoutingRefusalError` | `src/supervisor/model-router.ts`；`test/unit/routing/high-risk-filter.test.ts` |
| R1 库：过质量线最便宜、稀疏回 R0、Beta 分位数 LCB、滞回 | `src/routing/r1.ts`；**仍不接 live** |
| 公开先验别名精确匹配 | `src/routing/public-prior.ts` |

旧计划 [phase-b](./2026-08-18-phase-b-outcome-r1.md) 的库部分和 [phase-d](./2026-08-18-phase-d-promotion-cas.md) 的「不自动晋升」部分视为已落地。本文件是它们之后的优化波次。

---

## Wave 1 — 关上「提案 → 评估 → 晋升」门（现在就做）

产品缺口：人批准的是 JSON 文本，不是相对 R0 的对照报告。指针链已通，评估阶梯还是标签。

### Task 1.1: `adapt eval` 对 routing-policy 跑 static + replay

**Files:**
- Create: `src/adaptation/eval-routing.ts`
- Modify: `src/cli/adapt.ts`（增加 `eval` 子命令）
- Test: `test/unit/adaptation/eval-routing.test.ts`；`test/unit/cli/adapt.test.ts`

**Interfaces:**
- Consumes: `ResourceRegistry.getCandidate`；`replayCacheKey`（`src/experiments/replay.ts`）；`computeComparisonReport` / `validateComparisonReport`（`src/experiments/comparison-report.ts`）
- Produces:

```ts
export interface RoutingEvalRequest {
  readonly stateRoot: string;
  readonly candidateId: string;
  readonly datasetDir: string; // frozen replay episodes, never the live workspace
}

export interface RoutingEvalReport {
  readonly candidateId: string;
  readonly contentHash: string;
  readonly cacheKey: string; // replayCacheKey({ runId or datasetId, candidateHash, environmentVersion, evaluatorVersion })
  readonly stages: readonly ("static" | "replay")[];
  readonly comparison: ComparisonReport;
  readonly evidenceClass: "replay";
}
```

- Static stage：解析策略 JSON、身份是 `routing-policy`、不包含权限/凭据字段。
- Replay stage：在隔离目录对冻结 episode 用 **baseline = 当时 active 父版本（R0 等价 allow-list）** vs **candidate 策略** 重新 `assignTasks`（或等价的 allow-list 应用），用确定性结果（已记录的 `taskSuccess`，缺则 `UNOBSERVED`，不得发明 PASS）。
- 报告必须含 candidate hash、environmentVersion、evaluatorVersion。缺 CI 或样本不足 → `provisional: true`，claims 不得含 improve/better。

- [ ] 写失败测试：无对照报告的 eval 不能输出 improvement claim；cache key 随 contentHash 变化。
- [ ] 实现 `adapt eval --candidate <id> --dataset <dir>`，stdout 打印报告路径，不晋升。
- [ ] `corepack pnpm exec tsx --test test/unit/adaptation/eval-routing.test.ts test/unit/cli/adapt.test.ts`

**验收:** `adapt eval` 存在；两次相同输入得到同一 `cacheKey` 和同一 `rerunHash`。

### Task 1.2: 无通过的 eval 报告不得 `promote --approve`

**Files:**
- Modify: `src/adaptation/promotion.ts`、`src/cli/adapt.ts`
- Test: `test/unit/adaptation/promotion.test.ts`、`test/unit/cli/adapt.test.ts`

**Interfaces:**
- `promoteWithRegistry` 对 `kind === "routing-policy"` 增加：必须引用一份已落盘的 `RoutingEvalReport`，其 `contentHash` 等于 candidate，且 `validateComparisonReport` 未因声称失败（provisional 报告可以存档，但不能作为批准材料，除非 review 显式 `acceptProvisional: false` 且 claims 为空）。
- 权限 / 安全 / 凭据类资源保持「永不自动、且本任务不放宽」。

- [ ] 写失败测试：缺 eval 文件的 `adapt promote --approve` 拒绝。
- [ ] 实现；CLI 增加 `--eval-file <path>`。
- [ ] 跑 promotion + adapt CLI 测试。

**验收:** 现有「人批 JSON 就晋升」对 routing-policy 关闭。其它资源种类行为不变。

### Task 1.3: flowchart live 读同一 active pointer

**Files:**
- Modify: `src/run/flowchart-run.ts`、`src/cli/main.ts`（`--flowchart` 启动路径）、必要时 `src/supervisor/flowchart-supervisor.ts`
- Test: `test/integration/m2.5/flowchart-run.test.ts` 或新 `test/unit/run/flowchart-learned-routing.test.ts`

**Interfaces:**
- Consumes: `loadLearnedRouting(stateRoot, projectRoot)`（与 `--track` / `--children` 相同）
- 将 learned avoid/prefer 应用到节点 `modelPolicy.allowedModels` / `preferredModel`，再交给现有 `ModelRouter`。不要在 flowchart 里调用 R1。

- [ ] 写失败测试：晋升后的 avoid 使 flowchart 节点不再选被避免的模型。
- [ ] 实现。
- [ ] 跑 flowchart 相关测试 + live-isolation。

**验收:** learned 策略不再只惠及 `--children`。

**Wave 1 停止条件:** 简报 §6 的 2–5 全绿；CLI/文档仍无 Outcome-supported。

---

## Wave 2 — 资格矩阵与结果生产适配（现在可做，不接 R1）

### Task 2.1: Live catalog 逐步消费 `ModelDescriptor` 字段

**Files:**
- Modify: `src/supervisor/model-router.ts`、`src/routing/primary-catalog.ts`、可选新 `src/routing/live-catalog.ts`（`RoutableModel` ← 从 `ModelDescriptor` 投影）
- Test: `test/unit/routing/live-catalog.test.ts`、扩展 `high-risk-filter.test.ts`

**本波只加、不删 `RoutableModel`:**

| 字段 | live 行为 |
| --- | --- |
| `providerPolicy === "forbidden"` | 拒绝，constraint `provider-policy` |
| `privacyClass` vs 任务所需 | 拒绝，`privacy-class`（无声明则保持今日行为，不默许 cloud-general 服务 local） |
| `capabilities` | 任务 `requiredCapabilities` 必须被声明（高风险不要把 `"high-risk"` 当成 capability 字符串；白名单已由 `approvedForHighRisk` 负责） |
| `contextWindow` / `maxOutputTokens` | 有声明才过滤；无声明不虚构窗口 |

无合格模型：继续 `RoutingRefusalError`，拒绝矩阵写进 `MODEL_ROUTED.rejections`（成功路径）或错误对象（失败路径）。

- [ ] 写失败测试：forbidden provider 不能被 live 选中。
- [ ] 实现投影与过滤。
- [ ] 确认 flowchart 现有测试不被 `approvalRequired` 误伤。

### Task 2.2: 确定性验收 → `taskSuccess` 生产适配器

**Files:**
- Create: `src/learning/task-success.ts`
- Modify: `src/learning/signals.ts`（只委托，不把 judge/user 混进去）
- Test: `test/unit/learning/task-success.test.ts`

**规则（写进测试）:**

| 来源 | criterion | 结果 |
| --- | --- | --- |
| `TASK_RESULT` + verification `PASSED`/`FAILED` | `taskSuccess` | PASS/FAIL |
| 项目测试命令退出码 0/非 0（若事件里已有） | `taskSuccess` | PASS/FAIL |
| `verification.UNOBSERVED` / PARTIAL / CANCELLED | 不写 `taskSuccess` | — |
| `USER_ANSWER` | `userAcceptance` | 不进入 R1 |
| `JUDGE_DECISION` | `policyCompliance` | 不进入 R1 |
| `TRACKING_ASSESSMENT` | 不采集 | 不进入 auto-loop |

绑定键：`taskId` → `MODEL_ROUTED.model` + `modelVersion` + `family` + `featureVersion`。没有 `MODEL_ROUTED` 的结果不得发明模型 id。

- [ ] 现有 `signals.test.ts` 保持绿。
- [ ] 增加：缺路由事件的 TASK_RESULT 没有 `modelId`。

### Task 2.3: 真实 tokens/延迟回写估计（只读目录，不改选模公式）

**Files:**
- Modify: `src/telemetry/model-invocation.ts` 的消费者；新 `src/routing/catalog-observed.ts`（按 modelVersion 聚合 p50，**不**在 live 热路径改 `estimatedCostUsd`）
- Test: `test/unit/routing/catalog-observed.test.ts`

Live `primary-catalog.ts` 的固定估计值本波保持。观测写入独立快照，供 Wave 4 仿真成本使用。未观测保持 `undefined`，禁止填 0。

**Wave 2 停止条件:** live 拒绝矩阵能表达 provider/privacy/capability；`taskSuccess` 只来自检查；目录价与观测价分列。

---

## Wave 3 — 冻结公开先验进入 R0 排序（R1 仍不吃）

先于 CLI 接线完成快照契约。

### Task 3.1: 快照文件 + hash 加载器

**Files:**
- Create: `src/routing/public-prior-store.ts`（或扩 `public-prior.ts`）
- Fixture: `dataset/public-priors/<snapshotId>.json`
- Test: `test/unit/routing/public-prior-store.test.ts`

**Interfaces:**
- `loadPublicPriorSnapshot(path): { snapshot, hash }`
- 启动时比对 `publicPriorHash(snapshot)` 与 sidecar / 内嵌 hash；不匹配 fail-closed。
- 别名：已是精确匹配；本任务加「未知 catalog id → 不 zero-fill」的回归（已有测试须保持）。

禁止：运行时拉榜、Arena 总分、把榜单次数加进 posterior。

### Task 3.2: `--track` / `--children` 传入 `prior`

**Files:**
- Modify: `src/cli/main.ts`、`src/track/loop.ts`
- Test: `test/unit/routing/assign.test.ts` 已覆盖 `prior` 参数；加 CLI/track 集成测试证明 flag 真正传入。

**行为:**
- 仅当快照覆盖该 `family` 时改 `preferredModel`（过质量线最便宜）。
- `preferPrimary`（高风险 / HIGH / planner / debugger / deploy）仍覆盖榜单。
- 缺快照或 hash 失败：静默走今日无 prior 路径，并在 stderr 打一行，不抛成 run 失败（除非 `--require-public-prior`）。

**Wave 3 停止条件:** 产品路径上公开先验可复现、可哈希、可关掉；R1 观测数不变。

---

## Wave 4 — Shadow R1 与仿真 holdout（可做实验，不能接 live）

本波产出 **simulation-evidence**，不是生产改进。

### Task 4.1: 离线 R1 shadow 报告（不改 live assign）

**Files:**
- Create: `src/routing/r1-shadow-report.ts`
- Test: `test/unit/routing/r1-shadow-report.test.ts`

对冻结 episode：R0 与 `routeR1` 都给出 selection；对照写入 comparison-report。Live 循环零调用。

### Task 4.2: Paired simulation holdout runner

**Files:**
- Modify/Create: `src/experiments/simulation-holdout.ts`（不要把结果写进 `HoldoutVault` 的 open 集而不审计）
- Test: `test/integration/m6/simulation-holdout.test.ts`

**协议（专家建议，写入报告元数据，待 ADR-005 正式签字）:**
- 设计：paired（同一 episode 两臂都路由）。OPE 可当附录，不得当主 claims。
- Train 更新 R1 后验；holdout 只评估。
- `evidenceClass: "simulation"`。
- `minPairedSamples: 5` 只作为**非临时报告**门；每族结论需要报告里单独的 `familyBreakdown` 且不得在 n_family 很小时声称该族更好。
- 成本门：效用 CI 为正且成本 CI 上界 ≤ 0。

**明确禁止:** 用这份报告关闭 Checkpoint F 的生产改进项；文案写「仿真证据」，不写「自适应已更好」。

**Wave 4 停止条件:** 有一份可复现的 simulation 报告；live-isolation 仍绿。

---

## Wave 5 — R1 接 live（默认冻结）

**入口条件（全部满足才能开工）:**
1. Wave 1–3 验收绿。
2. Wave 4 至少一份 paired simulation 报告通过 `validateComparisonReport`（claims 允许的前提下仍标 simulation）。
3. ADR-005 对成本门 / holdout 来源有书面签字（可把专家建议落成 Accepted）。
4. 另开变更：live `assign.ts` 在 `ModelRouter` 资格过滤之后调用 `routeR1`，稀疏回退 **当前已晋升 R0 策略选出的模型**，而不是再跑一遍无策略的 cheapest。

**仍然禁止:** 高风险探索、tracking score 进 R1、live 层级交互项、自动晋升。

在此之前把 R1 接上 = 在未知成功标准上做产品。

---

## 明确不做（整份计划有效期内）

- 高风险在线探索
- 跟踪 `P`/`H`/`score` 写入 R1 或 bandit reward
- live 层级项目效应 / 交互项（离线报告可另开 Phase C，不进本计划 live）
- `routing-policy` 自动晋升
- Arena 总分或混杂 harness 的 agent 榜当路由器
- LLM 任务分类器（确定性分类器保持 baseline；若以后要加，必须密封对照 + 正则回退，另开计划）
- 把 `n >= 5` 当成每任务族可靠结论

## 建议实施顺序与依赖

```text
Wave 1.1 adapt eval
    └─ 1.2 promote 必须带 eval 报告
    └─ 1.3 flowchart 读同一指针
Wave 2 可与 1.3 并行（不依赖 eval 报告格式）
Wave 3 依赖 2.1 的资格过滤，不依赖 R1
Wave 4 依赖 2.2 的 taskSuccess 和 1.1 的报告格式
Wave 5 冻结，直到 4 + ADR-005
```

## 每波外部可见结果

| Wave | 用户能看到的 | 不能说的 |
| --- | --- | --- |
| 1 | `adapt eval`；无报告不能晋升；flowchart 也遵守已批策略 | 选模更聪明了 |
| 2 | 高风险/隐私/禁供模型会被拒，原因可查 | 目录价已校准到账单 |
| 3 | `--track` 可按冻结榜排序便宜合格模型 | 公开榜 = 本地战绩 |
| 4 | 一份 simulation 对照报告 | 生产已证明更好 |
| 5 | （签字后）样本足够时 live 走过线最便宜 | 在 F 生产项关闭前仍不得称 Outcome-supported |

## 关键文件（实施时）

| 文件 | 角色 |
| --- | --- |
| `src/cli/adapt.ts` | eval 子命令；promote 增加 `--eval-file` |
| `src/adaptation/promotion.ts` | routing-policy 晋升门 |
| `src/run/flowchart-run.ts` | 与 track 共用 `loadLearnedRouting` |
| `src/supervisor/model-router.ts` | live 资格矩阵 |
| `src/learning/signals.ts` / 新 `task-success.ts` | 结果分列 |
| `src/routing/public-prior.ts` | 冻结先验 |
| `src/routing/r1.ts` | 仅 Wave 4–5；5 之前禁止 live import |
| `src/experiments/comparison-report.ts` | 改进声称的代码门 |
| `test/unit/routing/live-isolation.test.ts` | 防回归：R1 不得进 live 平面 |
