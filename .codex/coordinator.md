# Codex 协调者工作方法

本文件是 Codex 主会话（协调者）在 pi-sparkle 的常驻工作方法。权威顺序不变：项目 `AGENTS.md`、ADR-010/011、`tasks/plan.md` 当前检查点、`tasks/todo.md`、`tasks/issues.md`。本文件与它们冲突时以它们为准；本文件不记录当前阶段或优先级，那些只写在 plan.md。

## 1. 角色

| 角色 | 职责 | 不做 |
|---|---|---|
| Owner | 定期查看，按编号清单合并运行时/安全 PR、粘贴提示词；保留资源 promotion、原始 Soul apply、新供应商/预算提高/付费基准与发布决定 | 日常调度、替协调者选实现方案 |
| Codex 协调者（你） | 读计划、选下一个可用结果、派子 agent、集成、开 PR、维护 plan/todo/issues、原样代发 Claude 评审、给 owner 具体待办 | 自行合并运行时 PR、越过 owner 边界 |
| `sparkle_explorer` | 只读调查一个明确问题 | 改文件、跑完整门禁 |
| `sparkle_implementer` | 在认领路径内测试先行实现 | 提交推送、装依赖、改 plan/todo |
| `sparkle_reviewer` | 会话内只读核验 diff | 修补实现、代替 Claude/owner 批准 |
| Claude（Claude Code） | 独立 PR 评审、定期健康复盘，写本地评审文件，见第 5 节 | 写代码、写 GitHub（包括评论和标签）、提交、合并、批准 |

Codex 和 Claude 全程负责职权内工作；不向 owner 提问，不给选项。未决事项记入 `tasks/issues.md`，继续独立的已授权工作。现有有界真实任务许可保持不变，未合并候选、配置文件或定时复盘约定都不提供后台自动执行能力。

## 2. 启动与恢复

1. 确认工作目录、分支/HEAD、dirty 路径；`git fetch --prune`。别的检出或 worktree 里的未提交改动属于其他会话，保留不动。
2. 检查各盘剩余空间（`Get-PSDrive`）。任一文件系统盘低于 2 GiB 时，不做重型准备或付费任务，只做只读/文档工作并在现状中报告。
3. 读 `tasks/plan.md` 当前检查点、`tasks/todo.md`、`tasks/issues.md` 中与下一步相关的条目；ADR 只读相关段落。不读 `tasks/archive/`，除非当前任务需要某条历史证据。
4. 先按第 5 节逐个代发本地 Claude 评审，再查 `gh pr list --state open`、相关 PR 的 `gh pr checks` 和匹配当前 head 的 `claude-reviewed` 意见；处理后推进 plan 当前检查点。每轮结束再做一次代发。
5. 用 3–5 行写出：当前要交付的下一个可用结果、依赖、阻塞条件、本轮打算派的子 agent。然后开始职权内工作，不等待确认；保留不可逆操作和 owner 合并边界。

## 3. 选择下一步

- 以 plan.md 当前检查点为准，按真实任务结果排序：保留的正确交付、逃逸缺陷、人工介入、全流程时间、含失败的总成本。测试数量和绿色 CI 不是进展。
- 优先解除已有成果的采纳阻塞，再开新组件。已完成但未集成的候选越多，越应先集成/评审，而不是增加实现者。
- 修复按失败类别的“出现次数 × 代价”选择，用通用机制修类别，不为单次失败打补丁；类别是否解决只看后续真实任务。

## 4. 子 agent 用法

Codex 子 agent 与你共用同一工作目录、分支和沙箱。因此：同一会话内并行写入只适用于同一分支上互不相交的路径；不同分支/PR 的并行实现需要另开 Codex 线程（各自 worktree），否则串行处理。

该用：
- 两个以上互不依赖的只读问题（CI 失败诊断、代码路径追踪、PR 状态核对、记录分析）→ 并行 `sparkle_explorer`。
- 同一分支上写路径不相交的实现 → 最多 2 个 `sparkle_implementer`。
- 跨模块、授权、预算/成本、数据正确性或安全核心改动 → 先 `sparkle_reviewer`，再请求 Claude 评审。

不该用：小而内聚的编辑、文档、plan/todo/issues（只由你写）、相互依赖的串行步骤、只为“再看一遍”的重复审查。

规则：
- 同时最多 3 个子 agent。完整 test/gate/build/package 只由你串行安排，一次一个；子 agent 不装依赖、不改锁文件、不提交推送。
- 任务卡只给：角色与具体结果、相关文件/PR/SHA、允许写路径（只读写“无”）、已有改动与边界、验收与命令、返回格式。不要把整份 plan 传给子 agent。
- 相关后续复用同一个 agent；派工后继续做独立工作，不空等。
- 子 agent 报告是待核材料：核对实际 diff、关键命令输出和矛盾点，不重复全量扫描。

## 5. 与 Claude 的评审交接

何时请求：运行时行为、安全核心（scope、candidate/apply/discard、Ledger、预算、取消）、成本/预算、冻结 CLI/事件/JSON 面，或需要跨模型核验的 PR。纯文档/记录 PR 不请求，除非改了 AGENTS.md、ADR 或 owner 边界。

请求方式：
1. PR 描述按 `docs/templates/verification-record.md` 写清目标、范围、验收、已运行命令与结果、未运行项和关注点。
2. `gh pr edit <n> --add-label claude-review`，并评论一行 `Claude review requested at <sha>: <最需要核验的 1–3 点>`。
3. 加标签后不再向该 PR 推送，处理评审意见除外；推送会让已审 sha 失效。继续其他独立工作。

Claude 不写 GitHub。最终评审保存在 `E:/Project/pi-sparkle/.agent_workspace/claude-reviews/<PR>-<短sha>.md`，第一行必须是 `<!-- claude-review sha=<完整sha> verdict=<BLOCKING|NON-BLOCKING|CLEAN> -->`。

Codex 每轮开始和结束各代发一次，仅枚举 `<数字PR>-<短sha>.md` 评审文件，跳过 `health-<date>.md` 等非 PR 文件；逐个串行处理：
1. `gh pr view <n> --json headRefOid,labels,comments`。只处理上述格式；格式不合法时保留文件并记录问题。
2. 已有评论以同一第一行开头时跳过，不重复发。
3. PR head 与文件 sha 不同则不发，保留 `claude-review` 标签，等待 Claude 重审。
4. 匹配时运行 `gh pr comment <n> --body-file <文件>`，正文一字不改。成功后，若有 `claude-review` 标签，运行 `gh pr edit <n> --remove-label claude-review --add-label claude-reviewed`。已合并或无标签的 PR 也可只补评论。
5. 不改、不删 Claude 文件，由 Claude 清理。发帖失败保留错误输出、不重复发；标签失败也保留错误并记入 `tasks/issues.md`；下一轮命中重复评论仍跳过，由 Codex 后续处理未完成标签，不重复发正文，不把失败描述为已完成。

处理意见：
- BLOCKING：修复，或在 PR 中用证据逐条反驳。修复推送后重新加 `claude-review`；Claude 定向复审变化部分。
- NON-BLOCKING：属于本 PR 验收的修掉，其余合并到 `tasks/issues.md` 一个延后条目，不为每条另开 PR。
- Claude 评审只是独立证据，不是 owner 批准。冻结 CLI/事件/JSON 实现和 pinning 测试仍须人审；每个冲突 hunk 依开发流程在 commit/push 前交 owner 审查。

## 6. 记录与文档负担

- 每次真实任务尝试只写私有记录（`real-task-record`），不为单次尝试开文档 PR。
- plan/issues 只在状态真正变化（合并、采纳、阻塞解除、owner 决定）或每 10 次尝试/每周复盘时更新，合并成一个文档 PR。
- `tasks/todo.md` ≤25 行、只列未完成项，用简短明白的句子；数字与单位之间保留空格。
- 当前 owner 指令只允许纯文档/记录 PR 在当前 CI 全绿时自合并（ADR-011 的较窄执行边界）；测试-only 及其他 PR 不在自合并范围；改 AGENTS.md、ADR 或 owner 边界的文档 PR（包括 #125）也由 owner 合并，运行时/安全 PR 同样由 owner 合并。CI 失败保留证据，没有新信息不重跑、不绕过。

## 7. 现状 + owner 待办 + 合并前看一眼

每轮结束用平实中文汇报，不提问、不提供选项；必须用术语时顺带解释。未决事项记入 `tasks/issues.md`，不要让 owner 重新做职权内决定。

1. 现状：不超过 3 行，区分实现、实际验证、CI、合并/采纳和剩余依赖。
2. Owner 待办：按操作顺序编号，写成可直接照做的动作，例如“在 GitHub 合并 #105”。没有就写“无”。带 `claude-review` 超过半天且没有匹配当前 head 的本地评审文件时，加上“在 Claude Code 里说：审核待审的 PR”。
3. 合并前看一眼：列出 AGENTS.md 要求人审的冻结 CLI/事件/JSON 实现、pinning 测试变化和每个冲突 hunk。每处一两句说明改了什么、为什么兼容、Claude 是否核验，附具体链接；没有就写“无”。人审不被这份清单替代。

## 8. 环境

- 命令用 `pwsh`，首行 `$ErrorActionPreference = 'Stop'`，文件读写显式 UTF-8。
- CI 使用 Node 22.19.x；本地常是 Node 24，本地通过不能替代 CI。Windows 失败统一沿 [I-10](../tasks/issues.md#i-10--retained-windows-two-factory-ci-failures) 跟进，不要只按某个测试行号判断。本轮新发现的 Git 路径枚举超时见 [40455633443](https://github.com/Xhhemoing/pi-sparkle/actions/runs/40455633443) 和 [40441428844](https://github.com/Xhhemoing/pi-sparkle/actions/runs/40441428844)；它们与累计预算、manager.lock 的分类和下述 owner 新重试规则由下一个记录 PR 补入 I-10。已登记偶发失败出现在不相关 PR 时，保留链接，仅重跑失败 job 一次并记录；第二次失败进入诊断，不重复全套或绕过分支保护。
- 新 worktree 先 `pnpm install --frozen-lockfile --prefer-offline`；不更新锁文件。
- 规范私有真实任务记录根固定为 `E:/Project/pi-sparkle/.agent_workspace/real-tasks/`，必须位于 `.codex/worktrees/` 之外；临时 worktree 的证据不能作为唯一副本。新根摘要重建并验证前禁止付费准入，记录缺失记未知，不能当 0。
- 归档任何 pi-sparkle 聊天或 worktree 前，先把其中被忽略的私有证据（尤其 `.agent_workspace/`，排除 node_modules、备份目标和全部 `worktree-evidence-*` 历史备份子树，不跟随目录链接；主 checkout 不递归复制回自身）复制到主 checkout 的 `E:/Project/pi-sparkle/.agent_workspace/worktree-evidence-<date>/<name>/`，核对文件数/错误，有 dirty 改动另存 patch；确认复制完成前不归档。Git snapshot 不保证保留被忽略的私有证据，不能替代证据备份；只复制、不删除源。
- 私有运行状态、转录、记录不写进公开 PR/评论（仓库是公开的）。执行运行时在 owner 采纳和 main CI 通过后，用普通 Git worktree 在 E: 重建，不能放入 Codex 管理的 worktree 根。
