# Controlled improvement execution checklist

ID: `TASK-20260925-controlled-improvement-roadmap`。Date: 2026-09-25。Owner: coordinator。State: `in-progress`；B0/D1 作者候选已形成，S0-min 仍待负责人冻结。

[Master plan](../docs/superpowers/plans/2026-09-25-controlled-improvement-roadmap.md) · [E package](../docs/superpowers/plans/2026-09-25-evidence-learning-foundation.md) · [N package](../docs/superpowers/plans/2026-09-25-native-observation-diagnosis.md) · [planning evidence](../docs/reports/2026-09-25-controlled-improvement-planning.md)

## 2026-09-25 REQUEST CHANGES correction (current checklist)

本轮独立审查结论是 **REQUEST CHANGES**。代码问题已由作者修复并通过完整门禁，fresh independent re-review 尚未返回；以下仍是唯一可派工顺序：

`B0 → (D1 || S0-min) → L1 → L2 → final review`

| Task | Role | Depends on | State | Exclusive scope / acceptance |
|---|---|---|---|---|
| B0 | coordinator | none | ready-for-review | preserve reproducible dirty baseline; freeze leases; document current lock graph; name the exact Stage 0 canonicalizer |
| D1 | diagnosis builder | B0 | author-candidate-unreviewed | reuse existing `EventStore` + `src/run/inspection.ts` for on-demand evidence-gap; no N1/N3 storage or control action |
| S0-min | boundary owner + reviewer | B0 | planned | freeze host-owned outcome DTO, source/binding/failure rules and canonicalizer; hard dependency of L1 |
| L1 | evidence builder | S0-min | planned | neutral evaluation/feedback persistence and bounded eligible-history reading; no learning-owned persisted outcome DTO |
| L2 | evidence builder | D1, L1 | planned | merged former E2/E3 `historical-candidate-view`, candidate-only and read-only with respect to active policy |
| final review | coordinator + fresh reviewer | L2 | planned | focused checks, applicable gates, exact remaining-gate statement and an actual independent verdict; the current integrated re-review is not this post-L2 final review |

Current deferrals: N1/N3, CI-1c, E4 activation, approval fixtures as acceptance, registry activation and formal promotion. No global lifecycle long lock may be added before B0's lock graph and a separately reviewed transaction design. R10/R11 and F6 remain independent open/parked gates and are not completion criteria for this read-only MVP.

### Current acceptance checklist

- [x] B0 author candidate records a reproducible baseline, disjoint leases, exact lock graph and canonicalizer identity; acceptance review remains open.
- [x] D1 author candidate produces bounded on-demand evidence-gap from existing data and leaves stores/control state unchanged; independent acceptance remains open.
- [ ] S0-min is frozen by the responsible owner/reviewer before L1 acceptance; fixtures do not substitute for the freeze.
- [ ] L1 stores/reads the host outcome only through neutral evaluation/feedback schema and fails closed on missing/deleted/mismatched evidence.
- [ ] L2 combines compatibility-window selection and historical candidate diagnosis into one candidate-only view; it cannot approve, promote, activate or route.
- [ ] Final review records commands and actual verdict; until then review status remains REQUEST CHANGES and no item is accepted.

## Superseded same-day pre-review checklist retained for provenance

All sections below preserve the earlier draft and must not be dispatched where they conflict with the current checklist above.

## [Superseded] Direction and interpretation

执行规划采用 Pi-first 受控持续改进：显式委派过程事实 → 独立结果 → 项目内跨 episode 窗口 → 有界诊断/候选 → 独立评价与显式批准 → 后续运行快照。近期只承诺离线机制闭环；真实收益另外验证。

此 checklist 补充 active `plan.md`/`todo.md`，不替换已有 evidence-first、ADR-008、Native Pi 或 F6 记录。角色是后续工作职责，不是已获得的人类批准。

## [Superseded] Task dispatch table

`planned` 表示尚未实施。`blocked` 必須有具体阻塞事实和解锁条件，依赖未完成的 planned 任务不自动写成故障。代码任务启动时重记 exact base/head；本调查 SHA 不充当未来验收 SHA。

| Task | Role | Depends on | State | Exclusive write scope / acceptance |
|---|---|---|---|---|
| CI-0 | coordinator | none | planned | 主计划/checklist/report；可复建基线、接口、无重叠 lease |
| E1 | evidence builder | CI-0；真实宿主 contract 另需 Stage 0 | planned | outcome-provenance module/test + test/fixtures/learning-outcome.ts；来源重建与伪造拒绝 |
| N1 | native builder | CI-0 | planned | native observation module/test；仅 allowlisted 显式委派事实 |
| CI-1a | coordinator | CI-0, E1 reviewed interface | planned | source-lifecycle、feedback types/store、privacy deletion/class、dictionary 及tests；删除/并发与兼容 |
| E2 | evidence builder | E1, CI-1a；pure slice 可先做 | planned | history-window module/unit、history-privacy integration；去重/兼容组/边界/删除 |
| N2 | native builder | E1 reviewed interface, N1 | planned | tracking diagnosis module/unit + test/fixtures/native-diagnosis.ts；确定性 evidence-gap，无执行权限 |
| E3 | evidence builder | E1, E2 | planned | historical-diagnosis module/unit；至少两 episode、原五样本阈值、candidate-only |
| N3 | native builder | N2 | planned | diagnosis-artifact module/integration；run 生命周期、幂等与读取拒绝 |
| CI-1b | coordinator | CI-1a, E3, N3；真实接线需 Stage 0 | planned | native/session、auto-loop、signals、CLI/inspection 及 master 明列 tests；接线/披露/不改活动策略 |
| CI-1c | coordinator | CI-1a, E3, CI-1b | planned | learning-source-preflight service、CLI/adapt；实际批准入口锁内来源重验到CAS保存 |
| E4 | evidence builder | CI-1b, CI-1c | planned | cross-episode-loop integration；4+4→候选→批准 fixture→已租赁决策不变/新租赁读取批准策略 |
| CI-2 | coordinator + fresh reviewer | CI-1b, CI-1c, E4 | planned | status/task/report；spec/quality review、focused/full gates 与剩余门禁 |

没有 E2→CI-1a 的反向依赖。CI-1a 不接 auto-loop/native；CI-1b 才串联组件，CI-1c保护实际持久化批准入口。所有 E/N 作者禁止修改 shared files，即使在不同 worktree，也只能向 coordinator 提交建议。

## [Superseded] File leases

| Lease | Exact files |
|---|---|
| E1 | `src/learning/outcome-provenance.ts`; `test/unit/learning/outcome-provenance.test.ts`; `test/fixtures/learning-outcome.ts` |
| N1 | `src/native/observation.ts`; `test/unit/native/observation.test.ts` |
| E2 | `src/learning/history-window.ts`; `test/unit/learning/history-window.test.ts`; `test/integration/learning/history-privacy.test.ts` |
| N2 | `src/tracking/diagnosis.ts`; `test/unit/tracking/diagnosis.test.ts`; `test/fixtures/native-diagnosis.ts` |
| E3 | `src/learning/historical-diagnosis.ts`; `test/unit/learning/historical-diagnosis.test.ts` |
| N3 | `src/native/diagnosis-artifact.ts`; `test/integration/native/diagnosis-artifact.test.ts` |
| E4 | `test/integration/learning/cross-episode-loop.test.ts` |
| CI-1a/CI-1b/CI-1c | master 中完整列明的共享文件；同一个 coordinator 顺序写，不能重叠 |
| CI-2 | `docs/status-matrix.md`; active task links; dated reports，代码只读 |

代码并行最多两个 builder，各有独立 `codex/` worktree。lease 激活时还需写 agent identity、base commit、head commit、租用/释放记录；本表是允许范围，不表示已经启动。

## [Superseded] Acceptance checklist

- [ ] CI-0：保全当前脏改动并取得可重建实施基线；不是只记录 HEAD。
- [ ] E1：self report、legacy、foreign/missing/deleted/mismatched evidence 无法成为独立结果；host failures 与 model blame 分离。
- [ ] N1：有事实来源、定额/截断披露，无原始文本或推断 exitCode/授权事实。
- [ ] CI-1a：feedback兼容字段、有界stream reader、source生命周期锁覆盖整段删除、迟到append拒绝；无新隐私孤岛。
- [ ] E2：30 天 / 最近 200 / 至少 2 episodes 的规划初值；版本隔离、重复/冲突拒绝、删除不复活；参数不代表已验证最优。
- [ ] N2：claimed-complete + required-check/binding evidence 缺失只能产生 evidence-gap；不直接产生模型失败或解阻塞。
- [ ] E3：合格 4+4 达到既有五样本阈值；八条 self-report、provider failures、single episode、primary model 不触发同类候选。
- [ ] N3：只存 run-scoped diagnostic artifact；严格 parser/重复消费/删除/失败披露有 tests。
- [ ] CI-1b：真实 run 路径接线、只读人类可读展示；kill switch、权限、旧 JSON/CLI pin 保持；真实 host 未冻则明确 blocked。
- [ ] CI-1c：官方持久化CLI/service入口在source lifecycle锁内重验到CAS保存；删除先完成则拒绝，批准先完成后删除不暗中回滚；不声称纯内存primitive也验证磁盘。
- [ ] E4：未批准时active不变；批准后新run/resume未租赁节点可用新策略，已租赁/已记录决策不变；保持原flowchart pin。
- [ ] CI-2：spec 与 quality 两阶段独立审查有实际 verdict；fresh focused/gate/probes 均记录结果/skip；status 不扩大 claim。

## [Superseded] First dispatch packets

**Coordinator / CI-0**

Read AGENTS、tasks/README、master、两个 child plans、相关 accepted ADR/status。下一条命令：`git status --short`，再保存 base/diff/untracked 清单。完成基线/lease/interface 后同时分发以下两包。CI-0 不能 reset/stash/清理旧文件或自行关闭旧 review。

**Evidence / E1**

只写 E1 两个文件；读取 E1 public contract、loop-artifact、evaluation/types、run/episode binding。先写 self-report/absent/binding mismatch RED，再写 resolver，下一命令：`pnpm test -- --test-concurrency=1 test/unit/learning/outcome-provenance.test.ts`。交回 schema、focused logs、source-boundary refusals 和未接真实 evaluator 的条件。

**Native / N1**

只写 N1 两个文件；读取 ExecutionEvent、NativeSession executor wrapper 与 N1 contract。先测允许事实/未知事件/隐私/截断，下一命令：`pnpm test -- --test-concurrency=1 test/unit/native/observation.test.ts`。不得加入普通会话观测、扩展 event union、解析 summary 或给 model 打独立奖励。

后续任务按 dependency table 分发。测试文件尚不存在的首次命令应在 RED 文件写好后运行；不存在文件不是实现验收证据。

## [Superseded] Verification routing

| Task group | Focused command location | Delivery gate |
|---|---|---|
| Planning only (本次) | report 的 link/content/diff review | `pnpm workflow:check`；不声称 pnpm gate 复验旧源码 |
| E1/E3/N1/N2 pure components | E/N 子计划 task 中逐条命令 | `pnpm gate` |
| E2/CI-1a privacy | E2 history-privacy + existing feedback/deletion/class tests | `pnpm gate`, `pnpm security:probe` |
| N3/CI-1b native/CLI | N3 artifact + master native/ingestion/CLI tests | `pnpm gate`, `pnpm security:probe`, `pnpm pi:probe` |
| CI-1c approval | master source-bound-promotion + CLI/adapt/registry/promotion tests | `pnpm gate`, `pnpm security:probe` |
| E4/CI-2 combined | master CI-2 exact focused command | `pnpm gate`, security/Pi probes；发布另走 prerelease |

## [Superseded] Blocking gates and ownership

| Gate | Current state | Owner role / unblock condition |
|---|---|---|
| Dirty implementation baseline | 未冻结为本计划的 clean base | coordinator 与已有修改 owner 保全并审查后给出可重建 revision |
| Stage 0 design freeze | open | 原 boundary reviewer + owner 提交设计冻结证据；新规划审查不关闭它 |
| Real independent evaluator contract | 未由本计划交付 | evaluator owner 按 Stage 0 提供 host-owned binding/result；不能替换为 caller trusted flag |
| Projection/economic telemetry + readonly manifest | 既有 author-verified 部分代码，未整体 accepted | 原 evidence-first owner 逐条验收与冻结 |
| A/B/C collection budget/data | open | experiment owner 的预注册与预算/数据批准 |
| Actual learning benefit | unobserved | 当前 native 单模型且 primary exclusion；先取得合格非 primary 真实样本的执行能力，或另立候选类，再做单独代表性任务实验；不能使用 E4 fixture 或投影 pilot 替代 |
| Apply / future worker write | open | R10/R11 独立审查、rollback/disposal 与 owner authorization |
| F6 / live adaptation | parked | custodian 既有材料与 owner 决定；本路线图不重开 |

## [Superseded] Handoff and closeout rules

每个 task 从 `planned` 到 `in-progress` 前登记 lease，从 `ready-for-review` 到 `accepted` 前填 [master handoff fields](../docs/superpowers/plans/2026-09-25-controlled-improvement-roadmap.md#multi-agent-execution-and-handoff-protocol)。用 [verification template](../docs/templates/verification-record.md) 写 durable record。实际 reviewer/channel/revision、author tests、human decision、outcome evidence 分列。

本次规划证据见 dated report；本页不预先给实现任务打勾。首个可推进任务是 CI-0，随后 E1/N1 并行。
