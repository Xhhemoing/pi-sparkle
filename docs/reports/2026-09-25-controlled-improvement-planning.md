# Controlled improvement planning and reconciliation — 2026-09-25

## Identity

- Task: `TASK-20260925-controlled-improvement-roadmap`；scope: documentation/process + evidence-grounded planning。
- Date/environment: 2026-09-25，Windows，`pwsh`，repository `E:\Project\pi-sparkle`。
- Investigation HEAD: `f15a3b81d6ff8b2e1b67ac0f26ca5bc7937455bb` + existing dirty worktree。新增规划尚未提交；验收不得仅引用 HEAD 而忽略文档内容。
- Coordinator: `/root`。Plan coauthors: `/root/evidence_plan`（E package）、`/root/native_plan`（N package）。本节身份是实际协作 agent，不是人类批准者。
- User authorization: 自主分析并制定支持多 agent 共同编写推进的具体计划。没有本轮产品实现、live-provider、迁移、发布、production apply 或 holdout 授权。

## Problem, decision and deliverables

用户要求深入理解后自主落地规划。调查显示原设计意图是改善 Project Episode 的后续表现，现有 evidence/change-control 能力应服务这个目标。因此本轮规划选择 **Pi-first controlled continuous improvement**。后续独立 REQUEST CHANGES 将近期 MVP 收缩为：先固定可重建基线/锁图，按需诊断与最小 Stage 0 并行，再建立中立结果摄取和 candidate-only 历史视图；激活与正式 promotion 延期。

仅新增/修改下列规划文件：

| File | Responsibility |
|---|---|
| [master roadmap](../superpowers/plans/2026-09-25-controlled-improvement-roadmap.md) | controlling path B0 → parallel D1/S0-min → L1 → L2 → final review；旧 CI/E/N DAG 作为历史草案保留 |
| [E child plan](../superpowers/plans/2026-09-25-evidence-learning-foundation.md) | L1 neutral evaluation/feedback ingestion；L2 merged historical-candidate-view；activation/promotion deferred |
| [N child plan](../superpowers/plans/2026-09-25-native-observation-diagnosis.md) | D1 on-demand EventStore/inspection evidence-gap；N1/N3 storage deferred |
| [dispatch checklist](../../tasks/controlled-improvement-todo.md) | task/role/dependency/state/file lease、首批派工与验收表 |
| [active plan](../../tasks/plan.md)、[active checklist](../../tasks/todo.md) | 仅新增 2026-09-25 入口，保留既有脏修改 |
| 本报告 | 决定、历史冲突纠偏、当前文档检查、真实 review 与剩余门禁 |

全部代码任务保持 `planned`；主计划中的代码和命令是实施说明，并未执行为本轮产品变更。

## Evidence supporting the plan

下列命令已在紧接本规划之前的同日只读调查中运行。原始输出保存在 `.agent_workspace/long-term-understanding/`；这里提升结论和完整命令为 durable record。它们不是新计划实现后的验证，也不是独立 reviewer 的实验结果。

| Prior investigation command | Actual result | Scope |
|---|---|---|
| `pnpm test -- --test-concurrency=1 test/unit/native/session.test.ts test/unit/learning/auto-loop.test.ts test/unit/tracking/independent-evidence-posture.test.ts test/unit/routing/live-isolation.test.ts test/integration/track/track-loop.test.ts test/integration/run/criteria-gate.test.ts test/acceptance/adaptive-loop.test.ts` | PASS，exit 0；52 pass / 0 fail / 0 skip | fake/local offline，raw `focused-checks.txt` |
| `pnpm test -- --test-concurrency=1 test/integration/native/write-session.test.ts test/integration/native/apply.test.ts test/integration/execution/pi-closed-loop.test.ts test/unit/pi-adapter/observation-tools.test.ts test/unit/experiments/readonly-evaluator-manifest.test.ts` | PASS，exit 0；39 pass / 0 fail / 0 skip | real-git/local HTTP loopback，raw `execution-and-projection-checks.txt` |
| `pnpm exec tsx .agent_workspace/long-term-understanding/learning-accumulation-probe.ts` | PASS，exit 0；created `[false,false,true]`，samples `[4,4,5]`；bandit pulls 13；每轮 promoted false | 同一隔离 project、不同 run/episode、非 primary model 的合成失败；不证明真实模型效果 |

事实解释：`runAutoAdaptLoop` 当前诊断本次 signals，持久化 bandit 累积不等于跨 episode 诊断已接线；`NativeSession` 结果仍为 UNOBSERVED；现有 learned routing 读 active registry snapshot，未直接读 bandit 做在线选择。修订后的 D1 只查询已有 EventStore/inspection；L1/L2 保持五样本与归因边界，不推断不存在的工具退出码或授权信息，也不激活候选。

旧草案中的30天/200条/至少两episode及N包数量/字节上限是未实施的保守设计选择，不是实测最优参数；它们随旧任务DAG进入superseded历史。B0/S0-min冻结当前接口后，L1/L2再明确必要边界并以测试验证；工作区已实现的投影/模型支持检查不重复实施。

## Dated reconciliation of older records

本节是截至 2026-09-25 的纠偏，历史文件保留；active task 两入口已链接本报告。

| Record conflict | Current controlling interpretation | Follow-up |
|---|---|---|
| `tasks/adaptive-plan.md` 尾部和 `.agents/skills/pi-sparkle/SKILL.md` 仍有 ADR-006 Proposed/no extension 表述 | accepted ADR-006（2026-09-18）、status matrix 与扩展源码已记录 inbound native delegation。旧禁止性措辞是历史状态，不能阻塞已接受的 read-only adapter，也不授权额外写权限 | B0 记录为后续文档维护项并引用本纠偏；当前不全局重写旧文档 |
| adaptive work-loop spec 顶部 Proposed 与已接受切片/ADR 并存 | 按具体切片和后续 accepted decision 判断；不把整篇未来设想视为全部实现或批准 | coordinator 在每 task 派工包写明采用段落 |
| 2026-09-21 vendor-neutral evidence/change-control framing 仍是定位假设 | 本次用户授权自主规划；本计划选择 Pi-first 为近期主线，可靠证据为基础。保留未来第二宿主可能性，不发表市场/法规断言 | 若扩第二宿主，另列实际需求、维护成本与复用边界 |
| 旧文档中的 hash 语言与 ADR-008 不同 | ADR-008 opaque locators/exact bytes/local-weak 控制新实现；不恢复密码学 tamper guarantee | 接口与测试一起 review |
| 既有 relay dispatch 失败 / Stage 0 review 未返回 | 本次写作/规划 review 的协作渠道是新的事实，不证明旧 relay 已恢复，也不关闭旧产品 review | 旧 owner/独立 reviewer 继续按原 gate 精确版本复审 |

## Current documentation commands

以下为本次文档交付的实际命令结果。原始输出位于 `.agent_workspace/planning-2026-09-25/`；代码实施命令仍未运行。

| Command | Result | Evidence |
|---|---|---|
| `pnpm workflow:check` | PASS，exit 0（本次REQUEST CHANGES修订后重跑） | `workflow-check: ok (10 required files, 16 required headings)` |
| `pwsh -NoProfile -File .agent_workspace/planning-2026-09-25/verify-planning.ps1` | NOT RUN after correction | 旧PASS只覆盖superseded 12-task DAG，不能用于当前B0/D1/S0-min/L1/L2路线 |
| `git diff --check` | PASS，exit 0（本次REQUEST CHANGES修订后重跑） | 无whitespace error；输出仅含既有/工作区CRLF→LF advisory |
| `pwsh -NoProfile -File .agent_workspace/planning-2026-09-25/verify-preservation.ps1` | NOT RUN after correction | 旧PASS覆盖pre-review新增段落；本次通过定向diff复核保留其他工作区更改 |
| `pnpm gate` / `pnpm prerelease` | NOT RUN | 本轮仅规划，不复验或代为接受原 dirty 源码 |
| real-provider / crash / benchmark / holdout / production apply | NOT RUN | 没有执行这些 opt-in/实验/生产任务 |

## Planning review provenance

- E/N 作者自检不是独立 review。Native coauthor 一次调用返回 503 billing service temporarily unavailable；在同一 agent 上恢复任务，无隐瞒切换、无恢复旧 relay 的结论。
- Fresh planning reviewer：`/root/planning_review`，通过本次collaboration渠道进行只读审查；独立于root与E/N作者。范围限上述七个规划文件、所引用代码契约及可执行性，不审为产品功能已实现。
- 首轮 spec review / quality review 均为 REQUEST CHANGES，实际返回记录位于 `.agent_workspace/planning-2026-09-25/independent-review.md`。v2 delta中spec PASS、quality仍因R6为REQUEST CHANGES；v3曾对当时快照返回planning-only PASS。**同日更晚的独立审查又返回 REQUEST CHANGES，并要求缩减关键路径；该后续 verdict supersedes v3 作为当前状态。**
- R1（P1）：纯内存promoteWithRegistry不能验证已删除来源。修订新增CI-1c：真实持久化CLI/service入口、source manifest、review/eval绑定、生命周期锁覆盖重验到CAS保存；明确纯primitive不具磁盘保证。
- R2（P1）：episode feedback cascade到unlink之间会插入迟到新索引。修订CI-1a共享source生命周期锁覆盖完整删除/新学习append，指定barrier物理残留测试，禁止反向锁序与重入。
- R3（P2）：取200条前仍可能全量扫描。修订stream reader与8MiB/10,000行、tombstone、artifact/source解析预算，scan不完整时不得提案，明确停止条件。
- R4（P2）：N2 fixture和blocked-next测试lease表不完整。已补入独占范围与CI-1b命令。
- R5（P1，E作者发现、reviewer独立核对）：当前flowchart pin允许resume未租赁节点使用当前approved策略。修订为已租赁/已记录决策不变；不引入整run冻结，也不修改现有pin以迁就草稿。
- R6（v2 delta，P1）：批准服务若持registry锁读取source会反向获取run锁。修订为外层lifecycle持续保护、两段短registry锁，中间无registry锁重验source，最终重读candidate/manifest/content/status/active做精确漂移检查后CAS；新增锁序/漂移负例。
- E coauthor初稿保留贡献；在协调收尾阶段root接管该文件lease并整合上述修订。Native coauthor自检和root自检分别记录，不重标为独立review。
- v3 结论绑定 `.agent_workspace/planning-2026-09-25/review-v3/` 与对应manifest；reviewer当时核对七文件7/7逐字节相同。后续 REQUEST CHANGES 导致实施设计再次修改，所以 v3 不再覆盖当前字节；没有新git commit，也没有当前修订的独立 PASS。
- 规划 review 不关闭已有 Stage 0、R10/R11、旧 native/projection independent review、预算或人类批准。

## Later independent REQUEST CHANGES and controlling revision

本节记录 2026-09-25 同日后续独立审查及本次修订。它不改写上面的历史轮次，也不把修订动作写成 PASS。

| Review requirement | Controlling revision |
|---|---|
| Critical path | `B0 → (D1 || S0-min) → L1 → L2 → final review` replaces the earlier CI/E/N execution DAG |
| Stage 0 minimum | S0-min is a hard dependency of L1 (and the former E1 behavior); fixtures may not substitute for the freeze |
| Diagnosis | D1 computes on-demand evidence-gap from existing EventStore/inspection data; no N1/N3 store or background artifact pipeline |
| MVP scope | N1, N3, CI-1c, E4 activation and formal promotion are deferred |
| Historical learning | former E2/E3 merge into L2 `historical-candidate-view`; output is candidate-only |
| Concurrency | no global lifecycle long lock; B0 first records the real lock graph, and later lock changes require a separate reviewed transaction design |
| Persisted outcome ownership | host outcome DTO belongs to neutral evaluation/feedback schema, not learning |
| Canonical JSON | L1/L2 may only reuse the exact canonicalizer frozen by S0-min; no second canonicalizer is planned |
| Independent gates | R10/R11 apply/write review and F6 governance/holdout remain separate; neither is silently closed or merged into MVP |
| Truthful state | all implementation tasks and final review remain `planned`; current independent verdict is REQUEST CHANGES until a fresh review returns |

The previous same-day plan text is retained in the three plan files and dedicated checklist under explicit superseded headings for provenance. Active `tasks/plan.md` and `tasks/todo.md` point only to the corrected path.

## Risks and gates

- B0 必须处理 dirty baseline 的可重建性，不能把裸 HEAD 当当前代码。
- S0-min 冻结的宿主 evaluator/outcome contract 是 L1 的硬依赖；fixture可用于设计测试，但不能形成L1接受证据。
- B0先记录现有run/event/feedback/deletion/registry锁图。当前MVP不引入全局lifecycle长锁；删除/并发风险通过既有短锁、bounded read与fail-closed revalidation处理，未解决的具体race另立设计。
- 历史可观察与候选可生效分离；L2只提供candidate-only view。primary exclusion、kill switch、五样本阈值不变，且当前MVP不进入approval、registry activation或routing mutation。
- A/B/C 是投影探索实验；候选学习效果另预注册。单位测试或 agent 自报均不产生 Outcome-supported。
- 人类/实验/生产门禁继续 open；F6 parked。本轮没有任何 merge、push、deployment 或真实收费实验。

## Handoff

- 交付状态：规划文档已按后续独立 REQUEST CHANGES 修订；实现任务与修订后final review均为planned。不得沿用v3声称当前字节已获独立PASS。
- 当前可继续：B0 固定可重建基线、文件lease、lock graph和Stage 0 canonicalizer位置；之后D1与S0-min才可并行。L1硬依赖S0-min，L2硬依赖D1/L1。
- 不需要再次询问方向或多 agent 执行偏好；用户已授权自主做规划。涉及未来真实实验/生产动作时按既有具体 gate 处理。
- B0冻结当前实际接口与文件lease后，再为D1/S0-min/L1/L2填写确切文件、签名、RED/GREEN与命令；执行者记录新的revision和原始输出，不复用本报告的调查PASS。
- 本轮 durable record 是此报告与链接的计划集合；scratch 文件辅助追踪，不能替代它们。
