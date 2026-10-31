# Pi 智能自适应闭环与错误预防架构报告

**状态：** 架构提案，供评审与后续实施计划使用  
**范围：** Pi 原生接入、双层 loop、项目/流程风险、BKT-like 协作状态、错误预防、受控自优化  
**优先级：** 项目/流程风险 MVP 优先；用户级 BKT、动态 topology 和 live auto-promotion 后置

## 1. 摘要

`pi-sparkle` 当前已经具备多 agent 运行时、项目 episode、事件与 checkpoint、结构化反馈、偏好记录、模型路由、候选资源、实验、promotion 和 rollback 等基础。下一阶段的目标不应是让 Pi 无限制地自我改写，而应是建立一个可观测、可预测、可干预、可验证、可回滚的智能闭环：

```text
用户意图
  -> 需求契约与风险识别
  -> 项目/用户状态建模
  -> 任务图与执行拓扑
  -> 模型、skill、工具和上下文路由
  -> 有边界的执行循环
  -> 确定性验证与人工反馈
  -> 错误归因与状态更新
  -> 候选策略离线评估
  -> 影子/金丝雀运行
  -> 受控推广或回滚
  -> 下一次任务的预防性干预
```

本报告提出一个双层 loop：

1. **内层任务 loop**：围绕当前任务进行 `contract -> plan -> act -> verify -> repair`，防止本次运行重复犯错或无限反思。
2. **外层学习 loop**：跨 episode 观察用户、项目、模型和 workflow 的状态变化，使用 BKT-like 用户状态模型、错误模式模型和实验系统改进下一次运行。

核心结论如下：

- BKT 适合建模“某个可观察技能或错误预防策略的掌握概率”，不适合直接代表用户人格、能力总分或模型质量。
- AI 错误预防必须同时建模 `错误类型 + 触发上下文 + 责任边界 + 预防控制 + 验证结果`，不能只记录“模型答错了”。
- 用户模型必须与偏好模型分离：偏好回答“用户希望怎样工作”，BKT/诊断状态回答“当前协作中哪些风险需要被主动防护”。
- 自动优化必须遵守 execution plane 与 adaptation plane 分离、证据优先、范围隔离、默认不外传、候选版本化、holdout 验证和自动回滚。
- 第一阶段应先实现遥测、错误本体、BKT-like 状态更新和干预记录；在数据和评估成熟前，不应将 bandit、深度 KT 或自动修改全局 Pi 配置接入 live loop。

本报告是架构与实施路线，不声称当前仓库已经完成全部能力。现有 M3-M6 自适应规范仍是基础规范，本报告补充 Pi 原生接入、用户状态、错误预防和闭环控制细节。

## 2. 目标、非目标与成功定义

### 2.1 目标

系统应能在不依赖用户反复提醒的情况下：

1. 识别当前任务的关键约束、风险、验收标准和所需权限。
2. 结合用户显式要求、项目事实和历史证据，选择合适的 workflow、skill、模型、工具和验证深度。
3. 预测“类似错误在当前上下文再次发生”的概率。
4. 在执行前采取低成本、可解释的预防措施，例如增加约束检查、选择独立 critic、要求用户确认或切换模型。
5. 在执行中检测停滞、重复尝试、证据不足、工具误用和需求漂移，并改变策略而不是盲目重试。
6. 在执行后将错误、成功控制和用户反馈归因到正确的边界，并更新下一次任务的状态。
7. 通过离线 replay、shadow、canary 和 rollback 验证改动是否真的改善了结果。
8. 让用户可以查看、纠正、导出和删除系统学到的偏好与风险状态。

### 2.2 非目标

本报告不建议在当前阶段：

- 直接训练或修改大模型权重；
- 把用户压缩成一个不可解释的“能力分数”；
- 根据一次错误推断用户稳定偏好或人格特征；
- 将模型的自评作为唯一奖励；
- 让 Pi 自动修改凭据、权限、安全配置或不可逆工具策略；
- 将原始对话、隐藏思维链、环境变量或秘密写入学习数据集；
- 以增加 agent 数量、loop 长度或 token 消耗作为“智能提升”的代理指标；
- 在没有 held-out 证据时声称系统已经自我优化成功。

### 2.3 成功定义

采用项目已有的证据成熟度阶梯：

```text
Missing -> Present -> Wired -> Exercised -> Outcome-supported
```

只有达到 `Outcome-supported`，即候选策略在可比的后续或留出 episode 中改善了声明指标且没有违反 guardrail，才允许描述为“系统自我优化”。

## 3. 现状评估与新增边界

### 3.1 当前已有基础

仓库已有以下可复用能力：

| 能力 | 当前代码/文档位置 | 可复用价值 |
| --- | --- | --- |
| Pi API 隔离 | `src/pi-adapter/` | 保持 Pi 类型不扩散到业务 contract |
| Run、子任务、DAG、flowchart | `src/run/`、`src/supervisor/` | 内层任务 loop 和有界执行 |
| Episode 生命周期 | `src/episode/`、`src/run/episode-bind.ts` | 跨 run 的学习单位 |
| 上下文索引与 bounded packet | `src/context/` | 限制上下文污染和 token 爆炸 |
| 反馈、评估、红线 | `src/feedback/`、`src/evaluation/`、`src/privacy/` | 将结果转换成可审计证据 |
| 偏好观察和纠正 | `src/preferences/` | 用户显式偏好与范围治理 |
| 重复模式检测 | `src/learning/` | 为错误模式发现提供输入 |
| R0/R1、后验和 shadow | `src/routing/` | 保守路由和离线适应的基础 |
| candidate、registry、promotion、rollback | `src/adaptation/` | 外层 loop 的版本化控制 |
| replay、holdout、canary、shadow | `src/experiments/` | 候选策略的验证边界 |

这些组件构成了“可控适应”的骨架，但目前还缺少三条关键连接：

```text
Pi 原生会话生命周期 -> pi-sparkle telemetry
用户/项目风险状态 -> 下一次 task contract/context packet
错误事件 -> BKT-like 更新 -> 预防性干预
```

### 3.2 必须增加的 Pi 原生集成

当前安装到 Pi 的主要内容是 skill。要让系统真正参与 Pi 的智能化，需要增加一个 Pi extension，而不是只增加更多 `SKILL.md`：

```text
extensions/pi-sparkle/index.ts
```

extension 的职责：

- 监听 agent/session/turn/tool 生命周期；
- 记录当前可用和显式激活的 skill，以及预先声明的 route decision；
- 记录 model、provider、thinking level、工具和 policy version；
- 将 Pi session 作为 transport evidence 关联到已有 episode，或请求 goal/contract engine 建立 episode；
- 注册 `/sparkle status`、`/sparkle audit`、`/sparkle optimize`、`/sparkle rollback`；
- 将高风险干预转为用户确认，而不是绕过 Pi 的权限边界；
- 显示当前 episode、风险提示、等待审批和候选策略状态。

Pi 的 session shutdown、reload、new、resume、fork 和 quit 都不是 episode closure 证据。一个 episode 可以跨多个 session，一个 session 也可能包含多个目标；episode 只能根据 objective/contract/acceptance policy 创建和关闭。

skill telemetry 必须区分可观察事实与推断：Pi 可以观察“available”和显式 `/skill:name` 激活；只有在 router 预先记录 eligible set 和 route decision 时，才允许记录“selected/skipped”。模型是否在语义上真正遵循了 skill 只能由后续 evidence 评估，不能直接标记为“used”。

建议的 package 配置：

```json
{
  "keywords": ["pi-package"],
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  },
  "pi": {
    "extensions": ["extensions"],
    "skills": [".agents/skills"]
  }
}
```

Pi extension 是现有 `src/pi-adapter/` 边界的反向入口。实施前必须通过 ADR 显式修订并取代 `m0-m2-architecture.md` 中“只有 `src/pi-adapter/` 可 import Pi package”的现行条款；新边界只允许 `extensions/pi-sparkle/` 和 `src/pi-adapter/` import Pi package。该 ADR 批准前不得实现 extension import。extension 只做薄适配和交互，策略计算、BKT 更新、实验和 promotion 仍在项目领域模块中。extension 具有进程级权限，必须遵守项目 trust、非交互/RPC 模式、工具权限和 kill switch，不能把安装等同于用户授予自动修改权限。

## 4. 总体架构：双层 Loop

### 4.1 内层：任务执行 loop

内层 loop 面向当前 episode，必须是有边界的状态机：

```text
OPEN
  -> CONTRACTED
  -> PLANNED
  -> ROUTED
  -> EXECUTING
  -> VERIFYING
  -> NEEDS_REPAIR | NEEDS_USER_DECISION | COMPLETED | FAILED
```

每一轮都必须产生可持久化的 `LoopStep`：

```ts
interface LoopStep {
  readonly schemaVersion: 1;
  readonly stepId: string;
  readonly idempotencyKey: string;
  readonly episodeId: string;
  readonly runId: string;
  readonly taskId: string;
  readonly attempt: number;
  readonly round: number;
  readonly phase:
    | "CONTRACT"
    | "PLAN"
    | "ROUTE"
    | "ACT"
    | "VERIFY"
    | "REPAIR"
    | "DECIDE";
  readonly inputRefs: readonly string[];
  readonly actionRefs: readonly string[];
  readonly observationRefs: readonly string[];
  readonly controlRefs: readonly string[];
  readonly budgetSnapshotRef: string;
  readonly status: "PROGRESSED" | "NO_PROGRESS" | "BLOCKED" | "COMPLETED";
  readonly occurredAt: string;
}
```

`LoopStep` 是从现有 run event、`RunStatus`、`TaskStatus`、flowchart node state、lease、attempt、ledger 和 checkpoint 派生的 projection，不是第二套运行状态真相。`ACT/VERIFY/REPAIR` 必须映射到具体 task attempt；episode 层的 `OPEN/CONTRACTED/...` 只汇总 run/task 状态。projection 的重放结果若与 authoritative run event 冲突，必须 fail closed，不能自行推进任务。

内层 loop 的原则：

- 每次 repair 必须引入新证据、新策略或用户决定；
- 相同错误、相同模型、相同上下文和相同动作不能无限重复；
- deterministic check 失败时，不能用语言解释覆盖失败；
- 风险升高时只能升级验证或请求用户，不得自动扩大权限；
- 任务达到 acceptance criteria 后，不再为了提高主观评分而继续循环；
- 子 agent 输出 `StageResult` 和 artifact references，不把完整 transcript 无限制向上传递。

### 4.2 外层：跨 episode 学习 loop

外层 loop 以 `ProjectEpisode` 为分析单位：

```text
OBSERVE
  -> NORMALIZE
  -> ATTRIBUTE
  -> UPDATE STATE
  -> PREDICT RISK
  -> PROPOSE CONTROL
  -> REPLAY
  -> SHADOW
  -> CANARY
  -> PROMOTE / ROLLBACK
```

外层 loop 的输入是结构化事实：

- 任务族、项目区域、角色、模型版本、工具和 skill；
- contract 的要求和遗漏；
- tool error、test/lint/typecheck 结果；
- 用户纠正、接受、拒绝、重做和回滚；
- review finding、delivery outcome、成本和延迟；
- 已采用的预防控制及其结果。

外层 loop 不直接读取隐藏推理，也不把未经归因的自然语言批评直接当成 policy mutation。

### 4.3 三种状态必须分开

#### A. 偏好状态 Preference State

回答：用户希望如何协作。

例如：

- 是否先给计划；
- 进度报告的详细程度；
- 是否偏好便宜模型；
- 是否希望每次提交前人工确认；
- 输出格式和 review 深度。

它应复用现有 `src/preferences/`，遵守 explicit > inferred、scope、recency、conflict 和 delete 规则。

#### B. 掌握/熟练状态 Mastery State

回答：在具有明确行为主体、评估机会和学习暴露的窄协作技能上，下一次可归属响应的成功概率是多少。

例如：

- 用户在被明确询问时是否补充了 acceptance criteria；
- reviewer 在获得完整 diff 和 rubric 后是否识别危险权限；
- 团队成员在明确承担 review 任务后是否发现遗漏测试。

项目测试通过、agent 输出成功或 delivery 完成只能更新项目/流程风险，不能证明用户或团队掌握了技能。MVP 默认只建模项目/流程错误状态；用户或团队 BKT 必须等到 actor-attributable observation、明确 exposure/attempt、纠正 UX 和外部效度检查完成后再启用。这类状态只能称为“协作技能状态”，不能伪装成完整心理测量。

#### C. 风险/错误状态 Risk State

回答：在当前任务上下文中，哪些错误更可能发生。

例如：

- 隐私约束被遗漏；
- 修改范围超过用户要求；
- 只改代码不补测试；
- 反复使用已经失败的模型或工具；
- 子任务之间缺少 artifact contract；
- 高风险变更没有进入人工审批。

风险状态不是用户的缺陷标签，而是执行控制的输入。它应绑定 task family、project、role、model/policy version 和时间范围。

## 5. BKT-like 用户与协作状态模型

### 5.1 为什么使用 BKT，而不是直接使用“用户画像”

经典 BKT 将某个知识点的掌握视为隐变量，通过一系列可观察响应估计：

- `P(L0)`：初始掌握概率；
- `P(T)`：一次学习/干预后转移到掌握的概率；
- `P(G)`：未掌握时仍然答对的猜测概率；
- `P(S)`：已掌握但响应错误的 slip 概率。

这种结构适合回答一个窄问题：在可重复定义、可观察评估的技能上，下一次成功的概率是多少。它不适合直接回答：

- 用户“聪明不聪明”；
- 用户整体能力是多少；
- 用户为什么犯错；
- 用户对所有项目的固定偏好是什么。

因此，pi-sparkle 应把 BKT 的 skill 定义为可验证的协作控制能力，例如：

```text
contract.privacy-constraint-capture
verification.test-plan-completeness
tool.permission-review
delivery.evidence-chain
context.artifact-handoff
```

每个 skill 都必须有明确的 observation rubric 和证据来源。

### 5.2 Skill/Q-matrix

将一个 episode 映射到多个协作 skill，形成 Q-matrix：

```ts
interface CollaborationSkill {
  readonly skillId: string;
  readonly version: string;
  readonly description: string;
  readonly requiredEvidenceKinds: readonly string[];
  readonly riskLevel: "LOW" | "MEDIUM" | "HIGH";
}

interface SkillObservation {
  readonly observationId: string;
  readonly episodeId: string;
  readonly skillId: string;
  readonly actorScope: "USER" | "TEAM_MEMBER" | "PROCESS" | "PROJECT";
  readonly actorKey: string;
  readonly attemptId: string;
  readonly observedAction: string;
  readonly exposedToSkill: boolean;
  readonly learningOpportunity: boolean;
  readonly outcome: "CORRECT" | "INCORRECT" | "UNOBSERVED";
  readonly evidenceRefs: readonly string[];
  readonly source: "ACTOR_RESPONSE" | "USER_CORRECTION" | "REVIEW" | "CHECK" | "DELIVERY";
  readonly confidence: number;
  readonly occurredAt: string;
}
```

一个任务可以覆盖多个 skill，一个错误也可能由多个 skill 共同导致。不要把单一失败粗暴映射为一个 skill 的失败；必须保留候选归因和不确定性。用户/团队状态只有在 `actorScope` 可归属、`exposedToSkill=true` 且存在独立 evidence 时才更新；`CHECK` 或 `DELIVERY` 默认只属于 `PROCESS/PROJECT`，不能反推用户能力。

### 5.3 基础 BKT 更新

对 skill `k`，令：

- `L_t = P(mastered_k at t)`；
- `pT` 为掌握转移概率；
- `pG` 为未掌握猜测成功概率；
- `pS` 为掌握状态 slip 概率。

观察到正确响应时：

```text
P(L_t | correct) = L_t(1-pS) / [L_t(1-pS) + (1-L_t)pG]
```

观察到错误响应时：

```text
P(L_t | incorrect) = L_t pS / [L_t pS + (1-L_t)(1-pG)]
```

只有当 observation 之后存在明确、可归属的学习机会时，才应用 learning transition：

```text
L_{t+1} = P(L_t | observation) + [1 - P(L_t | observation)] pT
```

如果只是重复评估、deterministic check、agent 执行结果或没有教学/反馈暴露，则 `pT=0`。预防干预本身不自动等于学习机会；必须记录用户或团队实际接触并有机会修正行为。

工程实现必须：

- 记录参数版本、行为主体、exposure、attempt 和 observation 来源；
- 对 `UNOBSERVED`、不可归属结果和无 exposure 的用户状态不更新；
- 对低置信、冲突或可能被猜测影响的结果降低权重；
- 按 project/user/task-family scope 隔离；
- 使用时间衰减或 forgetting 扩展，不把旧状态永久当成当前事实；
- 通过 held-out calibration 检查概率是否可信，而不只看 AUC。

### 5.4 面向协作的扩展

基础 BKT 不足以覆盖真实开发协作，需要以下扩展，但应逐步启用：

1. **Evidence-weighted BKT**：确定性测试、schema gate 和实际用户纠正的权重高于 agent 自评。
2. **Contextual BKT**：将 task family、project area、role、模型和风险级别作为上下文，而不是混合所有 episode。
3. **Forgetting BKT**：长时间未使用或项目切换后降低置信度；不等于断言用户“忘记了”。
4. **Prerequisite BKT**：先建模 `contract -> plan -> verify` 的先后依赖；没有 contract evidence 时，不应直接评价 verify skill。
5. **Multi-skill/Q-matrix**：一个任务同时观测多个 skill，避免把复杂缺陷归因到单个标签。
6. **Change-point detection**：模型版本、团队成员、项目迁移或流程变化后，重新校准 prior。
7. **Cognitive diagnosis fallback**：当技能很多、观测稀疏且属性相关时，使用稀疏 CDM/层级状态，而不是强行独立 BKT。

DKT、DKVMN、AKT 或 graph KT 可以在有足够脱敏数据后作为预测对照，但不能替代 BKT-like 状态的解释性和治理边界。任何神经 KT 都必须与 BKT、非神经基线、时间/用户留出和校准指标比较。

### 5.5 BKT 状态如何用于 Pi 行为

BKT 状态不能直接命令 Pi “相信用户不懂”或“替用户决定”。它只能触发预防性控制：

| 状态 | 允许的干预 |
| --- | --- |
| `P(mastered)` 低于经校准的低阈值且风险低 | 在 context packet 中加入短 checklist 或示例 |
| `P(mastered)` 位于经校准的不确定区间 | 增加一次结构化确认或独立验证，不阻塞低风险任务 |
| `P(mastered)` 高于经校准的高阈值 | 减少重复教学式提示，但仍保留 deterministic gates |
| 高风险 skill 低置信 | 请求用户确认、增加 critic 或禁止自动推广 |
| observation 冲突 | 标记不确定，不更新或降低更新权重 |
| 长时间无观测 | 回到保守 prior，不把旧掌握当作当前保证 |

阈值不是全局常量，而是按 skill version、risk class、intervention cost 和 calibration report 管理的版本化 policy。所有干预都要写入 `InterventionRecord`，让系统能回答“为什么这次多了一道检查”。

## 6. AI 错误预防模型

### 6.1 错误不是单一 outcome

建立可扩展的错误本体：

```ts
interface ErrorSignature {
  readonly errorId: string;
  readonly family:
    | "REQUIREMENT_OMISSION"
    | "CONSTRAINT_CONFLICT"
    | "CONTEXT_MISSING"
    | "WRONG_ROUTING"
    | "TOOL_MISUSE"
    | "IMPLEMENTATION_DEFECT"
    | "VERIFICATION_OMISSION"
    | "SCOPE_CREEP"
    | "SECURITY_BOUNDARY"
    | "DELIVERY_FAILURE"
    | "LOOP_STALL";
  readonly taskFamily: string;
  readonly projectArea?: string;
  readonly triggerFeatures: Record<string, string | number | boolean>;
  readonly evidenceRefs: readonly string[];
  readonly severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  readonly attribution:
    | "CONTRACT"
    | "CONTEXT"
    | "PLAN"
    | "ROUTE"
    | "EXECUTION"
    | "TOOL"
    | "REVIEW"
    | "DELIVERY"
    | "UNKNOWN";
  readonly confidence: number;
}
```

错误归因必须遵循最早被证据支持的 causal boundary：

```text
contract -> context -> plan -> route -> execution -> tool -> review -> delivery
```

例如：

- 用户早期明确要求隐私约束，但 contract 没记录：优先归因 `CONTRACT`；
- contract 有约束，context packet 丢失：归因 `CONTEXT`；
- packet 有约束，worker 没执行检查：归因 `EXECUTION` 或 `VERIFICATION_OMISSION`；
- 检查发现问题但错误仍被提交：归因 `DELIVERY`；
- 证据不足：保持 `UNKNOWN`，不生成针对模型的学习结论。

### 6.2 预测目标

系统预测的不是“AI 会不会犯错”这一无界问题，而是：

```text
P(error_family | task context, contract, project state,
                   user/project state, active policy, model, topology)
```

预测模型可以从规则和校准后的 Bayesian baseline 开始：

```text
risk(error) = posterior error rate
              * context match
              * severity weight
              * exposure
              * uncertainty multiplier
```

高风险决策使用错误概率的 upper confidence/credible bound 和 fail-closed 规则；等价实现可以使用安全/成功概率的 lower bound，但必须明确方向。没有足够样本时应扩大不确定区间、选择 abstain 或采用保守干预，不能用错误概率的 lower bound 压低风险。

### 6.3 预防控制的类型

每个错误模式必须绑定一个或多个可验证 control：

| 错误 | 预防控制 | 验证信号 |
| --- | --- | --- |
| 需求遗漏 | contract critic、coverage matrix | 需求到 task/check 的覆盖率 |
| 隐私约束丢失 | constraint extraction + user gate | contract 中存在来源引用 |
| 上下文缺失 | ContextPacket + ContextRequest | 下游关键问题可回答 |
| 模型路由不当 | capability filter + R1 shadow | 相同 task family 的质量/成本 |
| 工具误用 | role allowlist、dry-run、参数 schema | tool error、权限违规 |
| 只改代码不补测试 | acceptance-to-check gate | check 成功和 diff 覆盖 |
| scope creep | dirty-worktree ownership、diff scope gate | 超出范围的变更比例 |
| 无限重复 | novelty/min-delta、stall detector | 每轮是否引入新证据 |
| reviewer 共识错误 | blind pairwise、独立证据 | 复核后缺陷率 |
| 高风险自动推广 | approval profile、CAS、rollback | guardrail breach 为零 |

预防控制必须被视为实验变量。一次控制被展示不等于它有效；需要比较“有控制”和“无控制/旧控制”的可比结果。

## 7. 用户状态、项目状态与个性化策略

### 7.1 分层状态

建议使用以下 precedence：

```text
当前用户明确指令
  > 已批准项目规范/ADR
  > 当前仓库事实和可执行约束
  > 项目级显式偏好
  > 用户级显式偏好
  > 任务族中的已验证风险控制
  > 用户/项目 BKT-like 状态
  > 推断偏好
  > 系统默认
```

BKT 低掌握概率不能覆盖当前用户明确说“不要计划，直接完成”；但在高风险任务中，安全和验证 gate 仍然不能被普通偏好绕过。

### 7.2 个性化不等于少做检查

个性化应主要改变：

- 提示的表达方式；
- context packet 的示例和解释深度；
- 默认的 progress cadence；
- 低风险任务的模型/成本选择；
- 是否主动展示 checklist；
- review 的沟通形式。

个性化不能移除：

- schema、typecheck、test、lint 等 deterministic gate；
- 安全、权限、凭据和高风险审批；
- 证据引用和错误归因；
- 用户删除、导出和纠正能力。

### 7.3 反复错误的记忆形式

不要保存模糊结论“用户经常犯隐私错误”，而保存可审计的规则：

```json
{
  "memoryId": "mem_contract_privacy_check",
  "scope": "project",
  "scopeKey": "project_x",
  "trigger": {
    "taskFamily": "api-change",
    "risk": "high",
    "hasSensitiveData": true
  },
  "lesson": "在执行前确认数据暴露边界，并将来源写入 contract",
  "evidenceRefs": ["ev_101", "ev_144"],
  "confidence": 0.82,
  "status": "ACTIVE",
  "expiresAt": null,
  "userCorrectable": true
}
```

这种 memory 是“下一次如何防护”的操作性事实，不是对人的负面标签。

## 8. 事件、数据和存储设计

### 8.1 新增事件

在已有 run/episode event 基础上新增以下逻辑事件：

```text
PI_SESSION_ATTACHED
SKILL_ROUTE_OBSERVED
TOOL_USAGE_OBSERVED
LOOP_STEP_RECORDED
ERROR_SIGNATURE_RECORDED
SKILL_OBSERVATION_RECORDED
BKT_STATE_PROJECTED
RISK_PREDICTION_CREATED
INTERVENTION_APPLIED
INTERVENTION_OUTCOME_RECORDED
USER_CORRECTION_RECORDED
DELIVERY_FEEDBACK_RECORDED
```

其中 `PI_SESSION_ATTACHED`、显式 route、tool usage、用户纠正和 delivery feedback 是 append-only source events；`LOOP_STEP_RECORDED`、error signature、skill observation、BKT state 和 risk prediction 是可从 source events 重建的 versioned projections。projection 不得再次作为自身更新输入，避免 replay 双重应用。每条记录必须包含 schema version、event/projection ID、correlation ID、source event IDs、scope、occurredAt、ingestedAt 和 deduplication key。

stream ownership 如下：Pi transport 观察写入 session telemetry stream；run/task transition 仍只写现有 run stream；goal/contract 和 episode closure 写 episode stream；学习状态和预测写 projection store；promotion/rollback 只写 registry ledger。跨 stream 引用只能指向已经 durable 的事件。

外层优化事件继续复用现有规划：

```text
PATTERN_DETECTED
IMPROVEMENT_CANDIDATE_CREATED
EXPERIMENT_STARTED
EXPERIMENT_RESULT_RECORDED
RESOURCE_PROMOTED
RESOURCE_ROLLED_BACK
RESOURCE_RETIRED
```

### 8.2 状态记录

建议增加：

```ts
interface BktState {
  readonly stateId: string;
  readonly subjectScope: "USER" | "PROJECT" | "TEAM" | "PROCESS";
  readonly subjectKey: string;
  readonly skillId: string;
  readonly skillVersion: string;
  readonly pMastery: number;
  readonly pL0: number;
  readonly pT: number;
  readonly pG: number;
  readonly pS: number;
  readonly observationCount: number;
  readonly effectiveSampleSize: number;
  readonly lastObservationAt?: string;
  readonly parameterVersion: string;
  readonly sourceEventIds: readonly string[];
  readonly projectionVersion: string;
}

interface RiskPrediction {
  readonly predictionId: string;
  readonly episodeId: string;
  readonly errorFamily: string;
  readonly probability: number;
  readonly confidenceLevel: number;
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly severity: string;
  readonly reasons: readonly string[];
  readonly modelVersion: string;
  readonly abstained: boolean;
}

interface InterventionRecord {
  readonly interventionId: string;
  readonly episodeId: string;
  readonly triggerPredictionId: string;
  readonly kind:
    | "CHECKLIST"
    | "CONTRACT_CRITIC"
    | "CONTEXT_EXPANSION"
    | "MODEL_ESCALATION"
    | "INDEPENDENT_REVIEW"
    | "USER_CONFIRMATION"
    | "TOOL_RESTRICTION"
    | "STOP_AND_ESCALATE";
  readonly authority: "AUTO_LOW_RISK" | "USER_APPROVED" | "MANDATORY_POLICY";
  readonly applied: boolean;
  readonly outcomeRefs: readonly string[];
}
```

### 8.3 存储边界

```text
state/runs/<run>/events.jsonl
state/episodes/<episode>/events.jsonl
state/evaluations/
state/learning/bkt/<scope>/<skill>.jsonl
state/learning/errors/<error-family>.jsonl
state/interventions/
state/preferences/
state/resources/<kind>/<name>/<version>/
state/experiments/<experiment>/
state/registry/
```

所有 projection 必须可重建、幂等、记录 source event IDs 和 projection version。用户删除先写可审计 tombstone，再对受保护 payload 执行物理或密钥销毁；后续 BKT、错误模式、实验数据集、materialized view 和新备份都必须排除被删除来源。备份保留期限、压缩/归档副本、外部 provider 删除能力和无法即时清除的边界必须成为显式 policy，不能用“视图中不再出现”代替删除承诺。

默认只保存脱敏结构化 facet 和 artifact reference。原始对话、tool body、路径、secret 和 hidden reasoning 不进入共享学习数据。

## 9. 智能路由与执行策略

### 9.1 先选控制，再选模型

路由采用两次上下文编译：

```text
minimal trusted context
  -> policy/privacy/permission filter
  -> task risk and capability classification
  -> prevention-control proposal
  -> topology/model advisory decision
  -> final bounded ContextPacket compilation
```

不能先选一个“最强模型”，再让它解决所有治理问题。模型无法替代 contract、schema、test、权限和交付检查。

### 9.2 错误风险驱动的 topology

建议按风险和不确定性选择最小充分 topology：

```text
低风险、可确定验证: tool / one agent
普通实现: one agent + deterministic checks
重复错误: actor + independent critic
高风险迁移/安全: specialists + adjudicator + user gate
持续失败: 切换模型或 topology，不重复相同 reflection
```

BKT 状态和错误风险只影响 topology 的升级建议，不能绕过硬约束。在现有 Checkpoint F 关闭前，动态 topology 和 model escalation 只能记录 advisory/shadow decision，live loop 继续使用已批准的静态 `ModelRouter` 和 flowchart 配置。

### 9.3 上下文 packet 的预防性注入

Context compiler 应将风险记忆转换成短、带证据的控制项：

```text
[PREVENTION CONTROL]
- 当前任务涉及 API 数据边界。
- 项目历史显示该 task family 曾遗漏隐私 acceptance criterion。
- 执行前必须将数据暴露边界写入 contract，并运行 privacy check。
- 依据: ev_101, ev_144。
- 这是一条项目级风险控制，不是对用户能力的判断。
```

注入内容必须有 token budget、过期策略和去重规则。不能把所有历史错误堆进 prompt，造成 context pollution。

## 10. 自动优化和治理闭环

### 10.1 Candidate 类型

候选资源只能修改一个边界清晰的对象：

- prompt；
- routing-policy；
- rubric；
- skill；
- example；
- memory；
- workflow-template；
- deterministic sensor。

候选必须包含：

```text
parent version
hypothesis
supported evidence
affected scope
expected metric delta
guardrails
evaluation plan
risk class
rollback target
```

### 10.2 Promotion ladder

```text
1. schema/static/policy validation
2. redacted offline replay
3. temporal/project/user holdout
4. counterfactual shadow
5. low-risk canary
6. comparable live window
7. CAS promotion
8. drift monitor and rollback
```

候选的支持证据不能只有它自己生成的内容，也不能只依赖同一个 actor model 的自评。

### 10.3 自动化权限分级

| 等级 | 示例 | 默认行为 |
| --- | --- | --- |
| L0 | 生成报告、更新统计、记录事件 | 自动 |
| L1 | 项目范围的 checklist、memory、低风险 prompt | 初始版本仍显式批准；系统达到既定可靠性后，才可在命名、版本化、可撤销的 approval profile 下自动推广 |
| L2 | routing、topology、默认 thinking、review 深度 | 必须 held-out/replay/canary、可比后续窗口和首次显式批准 |
| L3 | 全局 system prompt、工具 allowlist、权限、security、credential | 永远显式批准，不允许自动推广 |
| L4 | 删除、push、merge、reset、外传数据 | 不属于自动优化权限 |

### 10.4 Promotion guardrails

至少监控：

- requirement coverage；
- deterministic verification pass rate；
- user correction/reopen/revert rate；
- review rework；
- security/privacy violation；
- cost、latency、token usage；
- loop stall 和 retry；
- evidence completeness；
- BKT calibration 和 risk prediction calibration；
- 跨项目 leakage 和用户纠正后的 forgetting/reversal。

建议使用多目标 Pareto frontier，而不是单一 reward。候选只有在声明 scope 内改善 primary metric 且不触发 guardrail，才能进入 promotion。任何 live auto-promotion 还必须具有命名且版本化的 approval profile、可撤销授权、exposure/budget 上限、held-out 与 canary 证据、可比后续窗口和明确 rollback target。

自动回滚由独立的 `GuardrailController` 持有：`canary outcome -> guardrail decision -> CAS rollback active pointer -> append rollback ledger -> reload/recovery`。CAS 发现并发 pointer 变化时必须停止并请求处理，不能回滚到错误版本；进程重启后应从 ledger 幂等恢复。

## 11. 评估方案

### 11.1 BKT/风险模型指标

不能只报告 accuracy 或 AUC。至少报告：

- NLL；
- Brier score；
- ECE/calibration curve；
- precision/recall at intervention budget；
- 高风险错误的 false negative rate；
- abstention rate；
- 按 user/project/task-family/model version 分层；
- 时间留出和新项目留出；
- 负迁移率。

BKT 基线至少应比较：

- 静态 base rate；
- 经典 BKT；
- 带 forgetting/context 的 BKT-like 模型；
- 一个 cognitive diagnosis 或 hierarchical baseline；
- 数据量足够时的 DKT/DKVMN/AKT 对照。

### 11.2 预防控制指标

对每类错误建立 episode-level paired evaluation：

```text
baseline policy vs candidate policy
same eligible task family
isolated side effects
frozen model/tool/environment versions
```

主要指标：

```text
error recurrence rate
first-pass success
verification omission rate
human correction cost
time-to-recovery
unnecessary-intervention rate
cost/latency overhead
```

“错误变少”必须和“干预是否导致过度阻塞、成本暴涨或用户失去控制”一起报告。

### 11.3 用户反馈实验

显式反馈可以立即成为范围受限的偏好；推断偏好需要重复、可比 episode 或直接确认。不要把沉默、一次编辑或一次点击当作稳定偏好。

必须保留：

- 原始 observation；
- 来源和 scope；
- 置信度；
- contradiction；
- correction cost；
- forgetting/reversal；
- 用户 inspect/correct/delete 结果。

### 11.4 验收场景

1. **需求遗漏**：用户早期明确提出隐私要求，contract critic 在规划前发现遗漏并阻止无证据执行。
2. **重复错误预防**：同一项目同类任务在独立、可比且已归因的 episode 中重复出现测试遗漏，并排除损坏 instrumentation、相同失败重放和共享 policy confounder 后，系统依据已授权的低风险 profile 在下一次加入 acceptance-to-check control，并引用证据。
3. **错误归因**：worker 被指责前，系统发现真正原因是 context packet 丢失，候选修改 context compiler 而非盲目换模型。
4. **BKT 冷启动**：没有足够 observation 时采用保守 prior，不对用户生成强结论。
5. **冲突偏好**：用户明确要求与历史偏好相反，当前指令生效且历史记录不被删除。
6. **高风险审批**：风险预测较高时触发 user gate，不能仅因 BKT 状态较高而绕过安全审批。
7. **候选回归**：候选在 replay 改善，但 security holdout 退化，候选被拒绝且不进入 active pointer。
8. **自动回滚**：canary 导致 rework 超过 guardrail，`GuardrailController` 通过 CAS 将 active pointer 返回正确前一版本，写入 durable ledger，并在重启与并发 pointer 变化场景保持幂等和 fail closed。
9. **项目隔离**：项目 A 的错误记忆不能注入项目 B，除非存在明确的共享 scope 和 provenance。
10. **无效学习**：没有足够独立证据时系统记录“no supported candidate”，而不是为了生成优化结果强行修改策略。
11. **主体归因**：agent 失败、测试通过和重复 deterministic check 不能更新用户 mastery；只有具有 actor、attempt、exposure 和独立 evidence 的响应才更新。
12. **错误状态纠正**：用户纠正一次错误主体归因后，相关 BKT/risk projection 被重建，旧状态不再影响 context 或实验。
13. **session/episode 分离**：reload、new、resume、fork 和 quit 只产生 transport event，不自动关闭 episode。
14. **UNKNOWN 迁移**：现有 `learning/attribution.ts` 的低置信默认映射在迁移后产生 `UNKNOWN`，且在迁移完成前 BKT 和 candidate generator 不消费该归因。

## 12. 分阶段实施路线

### Phase 0：基础可靠性与边界冻结

目标：让优化器本身可信。

- 修复并保持 typecheck、build、lint 和测试门禁；
- 冻结 execution/adaptation plane 分离；
- 定义 telemetry、error signature、BKT、risk prediction、intervention schema；
- 明确默认本地存储、默认不外传、敏感数据禁止进入学习集；
- 加入 feature flag 和 kill switch。

退出条件：数据 schema 可验证，所有新事件可回放，优化器不能改变 live policy。

### Phase 1：Pi extension 与可观测性

新增建议模块：

```text
extensions/pi-sparkle/index.ts
src/telemetry/pi-session.ts
src/telemetry/skill-route.ts
src/telemetry/loop.ts
src/telemetry/delivery.ts
```

完成：

- Pi session/turn/tool 生命周期接入；
- skill available、显式 activated 和 router selected/skipped 区分记录，禁止把语义“used”当作直接观测；
- session attach；episode 创建和 closure 继续由 objective/contract/acceptance policy 驱动；
- `.pi/logs/` 或 state-root 下 append-only 事件；
- `/sparkle status` 和 `/sparkle audit` 只读可用。

退出条件：一个真实或 faux Pi episode 可以重建 intent、route、tool、check、feedback 和 closure。

### Phase 2：错误本体、归因和最小 BKT

新增建议模块：

```text
src/learning/skills.ts
src/learning/bkt.ts
src/learning/error-signatures.ts
src/learning/risk.ts
src/learning/interventions.ts
```

完成：

- 10-20 个高价值协作 skill；
- 需求遗漏、验证遗漏、scope creep、tool misuse、context missing、loop stall 等错误族；
- 确定性 evidence 优先的归因器；
- 经典 BKT + evidence weight + scope + forgetting；
- 基于版本化校准阈值的 checklist；只允许调用现有已批准的静态 contract critic/user gate，任何动态 critic topology 和 model escalation 仅记录 advisory/shadow decision，直到 Checkpoint F；
- 单元测试、回放测试和校准报告。

退出条件：重复错误能被结构化识别；BKT 更新可解释、可重放；没有 observation 时不会做强结论。

### Phase 3：上下文个性化与预防性执行

完成：

- 将 active prevention controls 编译进 ContextPacket；
- 根据风险生成最小充分 topology 建议；Checkpoint F 前不接入 live loop；
- 引入“同错去重”和 no-progress stop；
- 让用户能看到“为什么这次增加检查”；
- 让用户纠正错误归因或关闭某个低风险 memory；
- 为项目、用户和 task family 分别评估干预收益。

退出条件：下一次 comparable episode 的错误复发率下降，且干预成本在预先定义的预算内。

### Phase 4：Shadow/Canary 自适应优化

完成：

- BKT 参数和 risk predictor 的时间/项目 holdout；
- candidate generator 只修改一个 typed resource；
- replay、shadow、canary、Pareto 和 guardrail；
- R1 和 contextual bandit 仅 shadow；
- `/sparkle optimize --dry-run` 生成带证据 proposal；
- 初始低风险 candidate 仍需显式批准；系统达到既定可靠性后，才可在命名、版本化、可撤销且有 exposure/budget 上限的 approval profile 下自动推广。

退出条件：至少一个低风险 candidate 在 held-out、canary 和可比后续窗口上改善，并能在强制回归时通过 CAS 自动 rollback；Checkpoint F/G 未关闭前不允许 live 动态 topology 或 auto-promotion。

### Phase 5：受控长期学习

只有 Phase 4 稳定后再考虑：

- graph-structured skill prerequisite；
- DKT/DKVMN/AKT 作为预测对照；
- topology expected-value learning；
- 跨项目共享的匿名统计；
- 外部 SFT/preference/RL trainer 的 dataset export。

模型权重训练不属于当前 runtime 的责任，应保留在外部训练和发布流程，并经过独立隐私、许可和模型风险审查。

## 13. 风险与防护

| 风险 | 防护 |
| --- | --- |
| BKT 把用户误标成“能力不足” | 只建模可观察协作 skill，使用操作性 memory，禁止人格标签 |
| 一次错误污染长期状态 | recurrence threshold、confidence、scope、decay、user correction |
| 模型自评形成闭环幻觉 | deterministic evidence、独立 evaluator、禁止 self-supporting candidate |
| 预防提示造成 context bloat | token budget、摘要、去重、过期和 answerability test |
| 错误归因错误换模型 | causal boundary、竞争假设、UNKNOWN/abstain |
| 高风险自动决策 | hard policy filter、user gate、approval profile |
| 负迁移和跨项目污染 | project/user scope、provenance、holdout、显式共享 |
| 优化器修改后无法恢复 | immutable resource version、CAS pointer、rollback ledger |
| 追求低成本牺牲质量 | quality floor、multi-objective metrics、Pareto frontier |
| 无限 loop | max rounds/time/cost、novelty、minimum delta、stall stop |
| 数据泄露和投毒 | redaction、trust class、secret scan、来源多样性、数据默认不外传 |

## 14. 研究与证据依据

本报告采用的依据分为三类，不能混为产品效果证据：

1. **Pi-sparkle 本地工程证据**：
   - `docs/specs/adaptive-agent-work-loop.md`：episode、context packet、R0/R1、evaluation、candidate、promotion 和 rollback 规范；
   - `docs/research/modification-points-validation.md`：28 个修改点、holdout、scope、approval 和 evidence ladder；
   - `src/learning/`、`src/preferences/`、`src/routing/`、`src/adaptation/`：当前实现和接口边界。
2. **知识追踪与认知诊断依据**：
   - Corbett & Anderson (1995), Knowledge Tracing，DOI: `10.1007/BF01099821`；
   - Abdelrahman, Wang & Nunes (2023), Knowledge Tracing: A Survey，DOI: `10.1145/3569576`；
   - Ghosh, Heffernan & Lan (2020), AKT，DOI: `10.1145/3394486.3403282`；
   - de la Torre (2011), Generalized DINA，DOI: `10.1007/s11336-011-9207-7`；
   - 纵向 DCM 与技能转变可靠性文献，详见本机 adaptive-learning-research skill 的 literature map。
3. **自适应 agent 与实验依据**：
   - FrugalGPT：级联和成本质量权衡，`https://arxiv.org/abs/2305.05176`；
   - RouteLLM：偏好驱动的路由，`https://arxiv.org/abs/2406.18665`；
   - Self-Refine：有界反馈修订，`https://arxiv.org/abs/2303.17651`；
   - AFlow：版本化 workflow 搜索，`https://arxiv.org/abs/2410.10762`；
   - ADAS：自动 agent 设计，但也显示评估预算和过拟合风险，`https://arxiv.org/abs/2408.08435`；
   - SWE-bench Live：静态 holdout 失效和分布漂移警示，`https://arxiv.org/abs/2505.23419`。

这些来源支持设计选择或揭示风险，并不证明本项目接入后一定能提升 Pi 的实际质量。产品结论必须由本项目的 paired replay、sealed holdout 和后续 delivery evidence 支持。

## 15. 最终建议

`pi-sparkle` 的产品定位应从“会分析 Pi 的 skill”升级为：

> 一个接入 Pi 生命周期、维护用户和项目协作状态、预测可重复错误、执行低成本预防控制，并通过可验证实验安全改进 workflow 的本地 adaptive control plane。

推荐的最小可行闭环是：

```text
Pi extension telemetry
  -> error signature + causal attribution
  -> scoped BKT-like state
  -> risk prediction
  -> prevention control in ContextPacket
  -> deterministic verification
  -> intervention outcome
  -> replay/holdout proposal
```

不要先追求 DKT、bandit、自动改 prompt 或模型权重训练。先让系统对以下问题给出可靠答案：

1. 这次发生了什么？
2. 证据证明错误发生在哪里？
3. 下一次类似任务的风险是什么？
4. 采取了什么预防措施？
5. 预防措施是否减少了错误且没有造成额外伤害？
6. 这条经验属于哪个用户、项目、任务族和版本范围？
7. 如果它导致退化，能否自动恢复？

当这些问题可以被事件、概率、证据和回滚记录回答时，Pi 的“智能性”才从更长的 prompt 或更多的 agent，转变为真正的长期适应能力。
