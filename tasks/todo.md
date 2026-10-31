# Active checklist

See the [current checkpoint](plan.md#current-execution-checkpoint-2026-10-26), [issue log](issues.md#i-16--local-and-remote-branch-consolidation), [ADR011](../docs/decisions/0011-real-task-improvement-loop.md) and [ADR012](../docs/decisions/0012-three-pillar-architecture.md). Unfinished work only.

- [ ] 协调者（阶段A）：#140 精确head CI绿后合并；随后观察main CI。Windows串行本地gate未完成，作为已接受的残余风险补跑并记录。
- [ ] 协调者（阶段A）：Git<2.36 在调用模型前拒绝并在doctor提示（`worktree list -z`）；切片PR需owner合并。
- [ ] 协调者（阶段A）：#140所在main CI绿后，把执行runtime从280882b4推进到该main（ADR012已授权）；单独记录安装结果。
- [ ] 协调者（阶段A）：第44次真实Node小任务完整走到apply并通过原项目检查；≤US$5，记入canonical私有账本。
- [ ] 协调者（阶段B）：第45–49次5个不同真实任务（H2优先），记录检查/应用/介入/各阶段时长/费用覆盖/失败类；选出最常见失败类。
- [ ] 协调者（阶段A）：#103 rebase到#140后的main（冲突在retained-candidate.ts及其测试），按安全核心流程审查和CI后合并；自身仓库1766文件超出主干1024上限。#138已关闭。
- [ ] 协调者：保留I16历史独有能力、68/102本地历史refs、host-check修改与旧dirty快照；不恢复冻结模块或删除证据。
- [ ] 协调者：I10偶发失败按既定方式只重跑一次失败job；保留前后证据，第二次失败先诊断。
- [ ] 协调者：原Soul只读；条件不变不重试P01/P02；第50次或每周复盘合并记录。
- [ ] 协调者：完成R3资源类型和后续任务证据；I02 promotion仍需owner，零收益推断。
- [ ] 协调者：旧direct-helper采用前修复kill-error/成功回收回归。
- [ ] Owner：阶段C的新工具/命令、TaskSpec模型字段与冻结CLI/事件/JSON改动需接口审阅后合并。
- [ ] Owner：旧15任务比较、ADR010收益、R5和发布保留独立证据及授权。
- [ ] 既有负责人：保留[早期未完成义务](../archive/tasks/2026-10-21-pre-integration-checklist.md)，含隐私、隔离和生产批准。
