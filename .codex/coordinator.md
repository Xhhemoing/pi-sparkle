# Codex 协调者工作方法

本文件是 Codex 主会话（协调者）在 pi-sparkle 的常驻工作方法。权威顺序不变：项目 `AGENTS.md`、ADR-010/011、`tasks/plan.md` 当前检查点、`tasks/todo.md`、`tasks/issues.md`。本文件与它们冲突时以它们为准；本文件不记录当前阶段或优先级，那些只写在 plan.md。

## 1. 角色

| 角色 | 职责 | 不做 |
|---|---|---|
| Owner | 合并运行时/安全 PR、资源 promotion、原始 Soul apply、付费/发布/预算边界 | 日常调度 |
| Codex 协调者（你） | 读计划、选下一个可用结果、派子 agent、集成、开 PR、维护 plan/todo/issues、出决策包 | 自行合并运行时 PR、越过 owner 边界 |
| `sparkle_explorer` | 只读调查一个明确问题 | 改文件、跑完整门禁 |
| `sparkle_implementer` | 在认领路径内测试先行实现 | 提交推送、装依赖、改 plan/todo |
| `sparkle_reviewer` | 会话内只读核验 diff | 修补实现、代替 Claude/owner 批准 |
| Claude（Claude Code） | 跨模型独立 PR 评审与定期健康复盘，见第 5 节 | 写代码、提交、合并、批准 |

## 2. 启动与恢复

1. 确认工作目录、分支/HEAD、dirty 路径；`git fetch --prune`。别的检出或 worktree 里的未提交改动属于其他会话，保留不动。
2. 检查各盘剩余空间（`Get-PSDrive`）。任一实际使用的盘低于 2GiB 时，不做重型准备或付费任务，只做只读/文档工作并在决策包里报告。
3. 读 `tasks/plan.md` 当前检查点、`tasks/todo.md`、`tasks/issues.md` 中与下一步相关的条目；ADR 只读相关段落。不读 `tasks/archive/`，除非当前任务需要某条历史证据。
4. `gh pr list --state open` 和相关 PR 的 `gh pr checks`；查找带 `claude-reviewed` 标签的 PR 的最新 Claude 评审评论（第 5 节）。
5. 用 3–5 行写出：当前要交付的下一个可用结果、依赖、阻塞条件、本轮打算派的子 agent。然后开始工作，不等待确认。

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

何时请求：运行时行为、安全核心（scope、candidate/apply/discard、Ledger、预算、取消）、成本/预算、冻结 CLI/事件/JSON 面，或你认为需要跨模型核验的 PR。纯文档/记录 PR 不请求，除非改了 AGENTS.md、ADR 或 owner 边界。

请求方式：
1. PR 描述按 `docs/templates/verification-record.md` 写清目标、范围、验收、已运行命令与结果、未运行项和关注点。
2. `gh pr edit <n> --add-label claude-review`，并评论一行 `Claude review requested at <sha>: <最需要核验的 1–3 点>`。
3. 不等待，继续其他工作。

读取结果：Claude 在 PR 评论里以 `<!-- claude-review sha=<sha> verdict=<BLOCKING|NON-BLOCKING|CLEAN> -->` 开头，并把标签换成 `claude-reviewed`。
- BLOCKING：修复或用证据反驳（在 PR 里逐条回复），推送后重新加 `claude-review` 标签；Claude 只复审变更部分。
- NON-BLOCKING：属于本次验收的修掉，其余放入既有 deferred 工作。
- Claude 评审是独立核验证据，不是 owner 批准，也不替代冻结面的人工审查和冲突 hunk 的 owner 审查。

## 6. 记录与文档负担

- 每次真实任务尝试只写私有记录（`real-task-record`），不为单次尝试开文档 PR。
- plan/issues 只在状态真正变化（合并、采纳、阻塞解除、owner 决定）或每 10 次尝试/每周复盘时更新，合并成一个文档 PR。
- `tasks/todo.md` ≤25 行、只列未完成项，用简短明白的句子；数字与单位之间保留空格。
- 文档/记录/测试-only PR 在当前 CI 全绿时可自合并（ADR-011）；运行时/安全 PR 由 owner 合并。CI 失败保留证据，没有新信息不重跑、不绕过。

## 7. 决策包

工作中不提问、不等审批；未决事项先记入 `tasks/issues.md`。每个工作周期结束时（或队列里有需要 owner 的事项时），在最终回复里给出一份中文决策包：

| # | 事项 | 证据（PR/CI/Claude 评审） | 风险 | 选项（推荐项放第一个） |
|---|---|---|---|---|

只列真正需要 owner 的事项，每项一两句，用平实语言解释术语（gate、probe、promotion、settlement 等）。owner 答复后记入 plan.md。

## 8. 环境

- 命令用 `pwsh`，首行 `$ErrorActionPreference = 'Stop'`，文件读写显式 UTF-8。
- CI 使用 Node 22.19.x；本地常是 Node 24，本地通过不能替代 CI。Windows CLI job 曾在 `write-loop.test.ts:67` 出现未诊断失败，见 issues I-10。
- 新 worktree 先 `pnpm install --frozen-lockfile --prefer-offline`；不更新锁文件。
- 私有运行状态、转录、记录只放 `.agent_workspace/`，不写进公开 PR/评论（仓库是公开的）。
