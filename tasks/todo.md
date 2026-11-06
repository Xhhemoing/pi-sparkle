# Active checklist

See the [current checkpoint](plan.md#current-execution-checkpoint-2026-10-26), [issue log](issues.md#i-17--new-ledger-provider-outage-before-host-checks), [ADR011](../docs/decisions/0011-real-task-improvement-loop.md) and [ADR012](../docs/decisions/0012-three-pillar-architecture.md). Unfinished work only.

- [ ] 协调者（阶段A）：供应商探测（一次最小补全）成功后，第46次复用a44 TaskSpec完整走到apply；移植PR的CI绿即原项目检查通过；≤ US$5，记入canonical私有账本。探测失败不占尝试名额。
- [ ] 协调者（阶段B）：重建私有任务队列（≥ 5个不同任务，其中3个零模型preflight通过，同一文件最多2个）；第47–49次跑不同任务，记录检查/应用/介入/各阶段时长/费用覆盖/失败类。
- [ ] 协调者（阶段B）：summary失败类别排序就是a44题目，由第46次的移植PR完成；返工次数与可得的分阶段token另开普通PR，先写失败测试。
- [ ] 协调者（阶段A）：#144（#103 rebase）补Windows本地容量测试与typecheck、一次串行gate、Claude评审后交owner合并；prepared容量另议。
- [ ] 协调者（阶段A）：Git < 2.36 在调用模型前拒绝并在doctor提示（`worktree list -z`）；本机2.54，不挡第46次；切片PR需owner合并。
- [ ] 协调者：准备`docs/development-workflow.md`更正（每周上限 US$50；#140后托管apply已可用），改动owner边界表述，由owner合并。
- [ ] 协调者：#146草稿等单任务记录完成后再推进；Claude评审、owner冻结实现审阅后合并。
- [ ] 协调者（阶段C–E）：C8交付说明、C6裁判校准（≥ 20条人工标注）、D连续两次同类失败熔断、E 10%灰度与合成题只进开发集；按roadmap顺序，不提前解冻。
- [ ] 协调者：保留I16历史独有能力、68/102本地历史refs、host-check修改与旧dirty快照；不恢复冻结模块或删除证据。
- [ ] 协调者：I10偶发失败按既定方式只重跑一次失败job；保留前后证据，第二次失败先诊断。
- [ ] 协调者：原Soul只读；条件不变不重试P01/P02；第50次或每周复盘合并记录。
- [ ] 协调者：完成R3资源类型和后续任务证据；I02 promotion仍需owner，零收益推断。
- [ ] 协调者：旧direct-helper采用前修复kill-error/成功回收回归。
- [ ] Owner：决定供应商处理（等待/换供应商或模型/批准零token HTTP错误的有界重试设计）、第49次之后的授权、带node_modules任务的依赖预算。
- [ ] Owner：阶段C的新工具/命令、TaskSpec模型字段与冻结CLI/事件/JSON改动需接口审阅后合并。
- [ ] Owner：旧15任务比较、ADR010收益、R5和发布保留独立证据及授权。
- [ ] 既有负责人：保留[早期未完成义务](../archive/tasks/2026-10-21-pre-integration-checklist.md)，含隐私、隔离和生产批准。
