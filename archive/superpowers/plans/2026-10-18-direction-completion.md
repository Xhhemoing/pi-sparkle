# Pi-sparkle 最新方向调整与实施计划

## Identity

- ID: `TASK-20261018-direction-completion`
- Owner: root coordinator; workspace-reader builder; scope-guard builder; independent reviewer.
- State: `ready-for-review` (bounded source independently reviewed and local gate verified)
- Date opened: 2026-10-18 UTC（用户当地 2026-10-17）。
- Authority: [ADR-009](../../../docs/decisions/0009-lightweight-adaptive-framework.md)、[当前架构](../../../docs/framework.md)、[迁移顺序](../../../docs/architecture-migration.md)、[对话工作流](../../../docs/conversation-workflow.md)。
- Baseline: latest fetched PR #60 branch, not merged main; exact commit recorded in the verification report. PR #61 remains separate.

## Problem and Scope

最新方向是轻量核心与按需适应：普通任务直接完成，复杂任务按事实增加协作；受控自优化作为有证据的后续能力。已有实验性直接任务入口，但 worker 只能整文件读写，无法在候选中发现文件、搜索、局部阅读与精确修改。这使小任务仍需猜路径或重写整份文件。对话路由、长期恢复、插件 SDK 和学习收益也不能因架构文档存在就记为实现。

本轮先交付 M1-B 候选代码工具：宿主无关、定额 list / literal search / range read / unique exact patch，再接到既有 Pi adapter 与 NativeWriteSession。保持旧整文件读写和命令权限语义；工具不提供 accept/apply、shell、检查器配置或新的任务完成状态。先不接 CodeMap、自然语言分类器、持久焦点、新 schema、在线学习或付费 provider。

## 调整后的推进顺序

| 顺序 | 交付 | 可观察验收 | 前置与边界 |
|---|---|---|---|
| 本轮 P0 / M1-B | 候选内 list/search/range/patch | 真实 Git 小任务用发现→定位→局部读→精确改→宿主检查完成；源仓库未改 | 复用 PR #60；取消、越界、歧义和限额拒绝都有回归 |
| P0 / 集成 | 收敛 #60 与 #61 | 核对各自源码和 CI，按差异集成并独立 review | 本轮不把两个未合并分支直接叠加；M0 Windows/旧 writer/未结效果仍单独跟踪 |
| P1 / C1–C2 | 宿主能力入口和版本化焦点 | 已授权直接任务、只读进度、插问后恢复；迟到结果不串任务 | 复用现有运行事实；不为每句话追加 planner，不从模型复述生成授权 |
| P1 / M1 context、M4 | 任务局部上下文、即时偏好和用量缺口 | 必需目标不被压缩丢失；task 覆盖不污染长期偏好；unknown 费用单列 | 不先建向量服务；明确 correct/delete 不走实验 |
| P2 / M3、M6 | revision-bound 发现、项目继续与跨会话恢复 | 过期观察失效；无重复执行；accepted 未集成不解锁依赖 | 现有 store/controller 保持唯一事实所有权；先只读和有界修复 |
| P2 / M2、M5 | 窄 SDK、按需插件、合格 Pi generation | 未启用零激活；打包消费者可用；停止后无额外 provider 调用 | 先 M0 生命周期资格；不原地热换正在运行的 Pi |
| P3 / M7 | 反馈→归因→离线比较→候选→批准→反馈 | 冻结基线与时间切分任务；质量、返工、总费用覆盖可解释 | S0-min/R10/R11/F6/F-PROD 各自保留；真实收益另做预注册验证 |

## Acceptance Criteria

- [x] 旧 `sparkle_read_file` 无范围参数时 content/details 保持兼容，命令工具仍 default-deny。
- [x] 新工具只访问候选根内路径；拒绝越界、外部 symlink/junction 和不合格参数；扫描与输出有硬上限，截断可见。
- [x] 范围读取使用一基行号，搜索为确定性字面匹配；精确 patch 只允许唯一原文匹配，未匹配/多匹配不写入。
- [x] 已取消的操作不启动写入；新工具不能调用进程、修改源仓库或改变宿主验证条件。
- [x] 真实临时 Git 集成完成发现、定位、局部阅读、patch 和宿主检查；邻近 native/adapter 回归、全 gate 与相关 probes 记录实际结果。
- [x] 当前任务、使用说明、状态和验证报告明确已交付与未交付项。

## Implementation Slice

| Files / symbols | Owner | Change / risk |
|---|---|---|
| `src/execution/workspace-files.ts`, `test/unit/execution/workspace-files.test.ts` | workspace-reader builder | Pi-neutral bounded read/list/search; no writes or process calls |
| `src/execution/workspace-patch.ts`, its focused tests | root | bounded exact unique patch; candidate path/cancellation checks, preserve unchanged files on refusal |
| `src/pi-adapter/worktree-coding-tools.ts`, adapter tests | root | thin schemas/translation; old result contract and default-deny command retained |
| `src/native/write-session.ts`, `src/cli/development.ts`, direct-task and CLI integration tests | root | explicit file-tool allowlists; preserve scoped host closures; no command tool admitted |
| `src/development/controller.ts`, controller integration test | scope-guard builder | write and exact patch share lexical/canonical allowedScope/protected verifier guard before mutation; nearest existing parent checked for new writes |
| this plan, `tasks/{plan,todo,migration-todo}.md`, `docs/direct-development-task.md`, status matrix and dated report | root | record bounded state and actual evidence |

## Test-First Plan

Write and run focused RED before source implementation. Cover deterministic limits/truncation, range/UTF-8, literal search, symlink/path refusal, cancellation, patch no-match/ambiguity and real Git source isolation. Run `node scripts/run-tests.mjs --test-concurrency=1` with the changed suites and adjacent native/execution suites; then genuine pinned `pnpm@10.17.1 gate`, security/Pi probes and `git diff --check`. Provider tests remain opt-in; Linux evidence does not imply Windows execution.

## Gates and Handoff

No new human decision is needed for this authorized reversible implementation. Retain existing experimental/production gates. Independent source review must inspect final changed code; conflict hunks, if encountered, require separate handling. Stop tool exposure on escaping paths, unbounded allocation, weakened checker authority or a frozen contract discrepancy. Rollback is code-only: no persistent schema or migration introduced. Evidence goes in `docs/reports/2026-10-18-direction-completion.md`; full logs remain under `.agent_workspace/`.

## Closeout

Source `b0dffab4ed8e8cd179555ac3263cccc24447dbff`: author focused 83/83 and controller 16/16; independent source review PASS with 90/90 checks; pinned actual gate 3,657 pass / 0 fail / 2 conditional skips plus build. Current commands, initial failures and probe/publication status are in the [verification record](../../reports/2026-10-18-direction-completion.md). Only M1-B is delivered; whole M1–M7, main/#61 integration and real-provider benefit remain open.


Publication note: external GitHub upload was blocked by automatic approval review,
which requested explicit approval for the exact 22-file payload to
`Xhhemoing/pi-sparkle` / existing PR #60. No remote branch was updated. Local
implementation and checks above are complete; [blocker evidence and unblock
condition](../../reports/2026-10-18-direction-completion.md#publication-blocker--automatic-approval-review).
