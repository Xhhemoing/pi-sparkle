# 最终规格：三线门控与路由（合成稿）

日期：2026-08-18  
状态：**Accepted — 按此实现**（取代冻结审阅稿的产品效力）  
来源：头脑风暴定稿、[提议文件1](./提议文件1.md)、《设计执行与分析线审核.pdf》、仓库 ADR-004/005 与现有 R0/R1 代码  
英文对照仍可参考 [2026-08-18-three-line-tracking-design.md](./2026-08-18-three-line-tracking-design.md)；冲突时以**本文件**为准。

未实现。不引入 Temporal、OPA、新数据库或国密 KMS。不训练模型权重。不声称 Outcome-supported，直到 Checkpoint F 关闭。

---

## 0. 拍板摘要

| 项 | 决定 |
| --- | --- |
| 三线 | 执行 / 跟踪 / 分析。分析不改 in-flight run |
| 门的权威 | **现有 deterministic supervisor**，不新增 GateController |
| 滚轮摘要 | 只进跟踪下一轮；哈希链；强制 omission 失败关闭 |
| 隐藏思维链 | **运行时不读取**，不进异常包 |
| `P` | 过程可信度 = 质量 × 覆盖；叙述一致性不进 P |
| `H` / `score` | 只叫醒分析；不写入路由 PASS/FAIL |
| 软阈值 | 版本化默认 **0.55**。另做校准/F1 **报告**（不在 live 上自适应） |
| Live 选模 | R0 硬过滤 + **单层 R1**。稀疏 → **批准的 R0 基线**，不选最高噪声 LCB |
| 层级归因 | **只离线**。Live 不接 |
| 晋升 | 全部提案优先。`adapt auto` 只提案。权限/安全/凭据永不自动晋升 |
| 加密 v1 | 正文默认引用；若落盘则 AES-256-GCM + 本机密钥，不做 SM4/CCRC/ISO 认证工程 |

**双路执行（拿不准的两套都做，比选出错）：**

1. **LCB：** 同时实现 Beta 单侧分位数与现有正态近似；用覆盖率模拟选生产默认（谁先达到预注册覆盖谁当默认，另一个留作对照报告）。  
2. **离线归因：** 同时做 logit 可加层级模型（研究估计器）与概率可加启发式（对照基线）。两者都只出报告，不写 live 指针。

---

## 1. 权威与状态机

```text
Execution  → 不可变 M0–M2 run events
Tracking   → TrackingAssessment + RollingSummary（无命令权）
Supervisor → 校验 assessment，只做白名单状态转换，发出有界指令
Analysis   → 脱敏异常包 → 一条 ImprovementCandidate
Promotion  → 用户批准 + CAS + 回滚账本
```

Tracking 可以说「建议重跑检查 / 问用户 / 排队分析」，**转换必须由 supervisor 代码生成**。自由文本「继续执行」不能改状态。

允许的转换：

```text
RUNNING → REPAIRING | WAITING_FOR_USER | ANALYSIS_QUEUED | COMPLETED | ABORTED
REPAIRING → RUNNING | WAITING_FOR_USER | ANALYSIS_QUEUED | ABORTED
```

`REPAIRING` 只能跑预注册修补（例如重跑一个已知检查），不能改计划、权限、工具集或活跃资源。

每次转换写 append-only 事件：`transitionId, runId, episodeId, turnId, seq, from, to, reasonCode, assessmentHash, evidenceRefs, policyVersion, idempotencyKey`。同一 assessment 重放只产生一次转换。

---

## 2. 事件与滚轮

事件需带：`schemaVersion, eventId, traceId, parentEventId, runId, episodeId, turnId, seq, source, trust, policyVersion, 工具 situation 字段, evidenceIds, contentHashes`。

`trust`: `FACT | DERIVED | INFERENTIAL | UNTRUSTED_TEXT`。用户文本、路径、工具输出、模型输出均为 `UNTRUSTED_TEXT`，分析时当数据不当指令。

滚动摘要只做索引：活动约束、未决、操作引用、当前 assessment、open-minors、omissions、`prevSummaryHash`。不复制正文，不进执行 packet。强制 omission → fail-closed。

---

## 3. 评分

### 3.1 P（质量 × 覆盖）

维度（固定，版本化权重，不学）：

| 维度 | 可 hard gate |
| --- | --- |
| evidence consistency | 是 |
| scope safety | 是 |
| check coverage | 是 |
| constraint retention | 是 |
| progress（重复失败时） | 是 |
| narrative coherence | **否，不进 P** |

```text
P = round(quality * coverage, 4)
quality  = Σ(w * value) / observedWeight     value: PASS=1 FAIL=0
coverage = observedWeight / applicableWeight
```

`NOT_APPLICABLE` 不进分母。`UNOBSERVED` 不填 0，只降 coverage。无任何可观察维度 → `P = 0`。Hard 相关 FAIL 走 hard gate；诊断显示可将 P cap 在 0.30。

### 3.2 H

顺序：清单占比 → 十分制 → 短句规则。evaluable=0 或多个无指向分数 → `UNOBSERVED`。权限/安全/停止/回滚先 hard gate，不被 4/5 占比抵消。不测情绪。

### 3.3 score

- 无人类评价或无「明显问题」→ `score = P`
- 否则 → `0.7*min(H,P)+0.3*max(H,P)`
- 明显问题：至少一条不同意，或打了分且 `< 8`，或短句否定
- **只**在 hard gate 未命中时，`score < 0.55` → `ANALYSIS_QUEUED`
- 不得写入 `OutcomeObservation`

### 3.4 Minor

`minorKey = hash(ruleCode, normalizedTarget, constraintId)`。连续 2 轮 = 相邻 tracking turn 仍 verified-true；累计 3 条按 episode 未关闭 key。只有新事件/哈希/确定性检查能关闭。

---

## 4. 异常包

包含：结构化摘要、工具 situation、事件 ID、退出码、hash、P/H/score、gate code、必要产物的安全片段。  
**不含隐藏思维链，不注册 CoT reader。** 提供商公开 rationale 标 `INFERENTIAL`。

---

## 5. 路由

结果向量分列：`taskSuccess`、`policyCompliance`、`userAcceptance`、`cost`、`latency`、`rework`。生产 R1 **只吃 taskSuccess 的 PASS/FAIL**。路径逃逸记 policy，不自动等于模型无能。

Live：

```text
R0 硬过滤
  → 高风险：白名单，不探索
  → 无批准自适应策略或 nObsEff 不够：批准的 R0 基线
  → 过门且 LCB ≥ 质量线：过线最便宜
  → 都过不了：批准的保守升级/回退（不是稀疏时的最高 LCB）
```

单层 R1 key：`(taskFamily, role, modelVersion, featureVersion)`。`UNOBSERVED` 只加曝光。晋升看 `nObsEff` 不看 prior 强度。版本变更开新 key，旧数据可审计。增加 cooldown/hysteresis，避免边界来回切。

层级模型（logit 可加 + 概率可加对照）仅 Phase C 离线。不得把同一观测重复计入 parent 又计入 interaction 的 **live** 估计器（live 根本不接 interaction）。

曝光、eligible set、propensity 必须记；未调用的影子模型没有 outcome。OPE 缺 overlap/ESS → `INVALID_ESTIMATE`，不声称改进。

---

## 6. 晋升与 Checkpoint F

分析每次一个 resource 边界。阶梯：static → replay → sealed holdout → shadow/paired → 低风险 canary → 以后可比窗口 → CAS。  
Checkpoint F：主终点是预注册 `taskSuccess`（或显式多目标），不是 score；paired 优先；成本看 CI **上界**；simulation ≠ production improvement。

---

## 7. 隐私

原始对话/工具正文默认引用。秘密、隐藏 CoT、PII 不进路由数据集。删除沿依赖图传播。外部共享默认关。v1 不做等保认证工程。

---

## 8. 验收（必须有测试）

隔离与控制：提议文件1 §11 用例 1–6（含摘要不能当权威、幂等 CAS、注入不提权、强制 omission 失败关闭）。  
评分：用例 7–12。  
路由：用例 13–20（含 nPrior 不能冒充 nObs、稀疏回退基线、双 LCB 覆盖率）。  
实验晋升：用例 21–25。
