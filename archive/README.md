# 历史归档（只读）

本目录保存不再指导当前工作的历史材料。当前状态以 [tasks/plan.md](../tasks/plan.md)、[tasks/todo.md](../tasks/todo.md)、[docs/framework.md](../docs/framework.md) 和 [docs/roadmap.md](../docs/roadmap.md) 为准；这里的旧“下一步”、旧授权和旧等待条件都不派发当前工作，也不解除任何冻结。

文件只做了 `git mv`，内容未改（仅修正了相对链接）。用 `git log --follow <新路径>` 可以追溯完整历史。

## 旧路径 → 新路径

| 旧路径 | 新路径 | 内容 |
|---|---|---|
| `docs/reports/` | [`archive/reports/`](reports/) | 代理生成的过程报告、审查包、SOTA 轮次记录 |
| `docs/superpowers/` | [`archive/superpowers/`](superpowers/) | 历史实施计划 |
| `tasks/archive/` | [`archive/tasks/`](tasks/) | 已归档的计划、清单和证据 |
| `tasks/adaptive-plan.md`、`tasks/adaptive-todo.md` | `archive/tasks/` | 早期自适应计划 |
| `tasks/controlled-improvement-todo.md` | `archive/tasks/` | 受控改进清单（2026-09） |
| `tasks/development-batch-review-todo.md`、`tasks/development-control-plane-todo.md` | `archive/tasks/` | 开发控制面清单（2026-10） |
| `tasks/report-execution-todo.md`、`tasks/report-improvement-todo.md` | `archive/tasks/` | 报告驱动改进清单 |
| `tasks/trusted-apply-binding-todo.md` | `archive/tasks/` | apply 绑定清单 |

代码注释、提交信息或外部链接里仍出现旧路径时，按上表对应即可。

## 规则

- 不在这里新增“当前”计划或待办；新的过程报告写在 PR 正文或私有 `.agent_workspace/`。
- 未完成的安全义务、失败与未知结果仍由当前计划引用，不因归档而视为完成。
