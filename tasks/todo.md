# Active checklist

See the [current checkpoint](plan.md#current-execution-checkpoint-2026-10-26), [issue log](issues.md#i-18--exact-apply-refuses-git-texteol-attributes), [ADR011](../docs/decisions/0011-real-task-improvement-loop.md) and [ADR012](../docs/decisions/0012-three-pillar-architecture.md). Unfinished work only.

- [ ] 协调者（阶段A）：I-18由owner定方向后，（a）先写失败测试再修exact apply属性策略并同步preflight（安全核心：Claude评审、串行gate、owner合并），随后第47次在新副本复用a44 TaskSpec走到apply；或（b）只加preflight检测与明确拒绝，阶段A换到无text/eol属性的项目。≤ US$5，记入canonical私有账本；此前不用pi-sparkle副本消耗尝试名额。
- [ ] 协调者（阶段B）：重建私有任务队列（≥ 5个不同任务，其中3个零模型preflight通过，同一文件最多2个）；第47–49次跑不同任务，记录检查/应用/介入/各阶段时长/费用覆盖/失败类；pi-sparkle副本上的任务受I-18阻塞。
- [ ] 协调者（阶段B）：summary失败类别排序：a46候选（+14/−1）已过宿主检查并保留，阶段A走通后由移植PR完成；返工次数与可得的分阶段token另开普通PR，先写失败测试。
- [ ] 协调者：#144 Claude NON-BLOCKING已转发；补Windows两组聚焦测试与typecheck、一次串行gate、含#148的新CI后交owner合并（内存不足时暂缓）；prepared容量另议。
- [ ] 协调者（阶段A）：Git < 2.36 在调用模型前拒绝并在doctor提示（`worktree list -z`）；本机2.54，不挡第46次；切片PR需owner合并。
- [ ] 协调者：#150（操作指南更正）回应Claude复核并保持CI绿，交owner合并。
- [ ] 协调者：#146 Claude BLOCKING已转发（桥接漏了“非inline检查须声明protectedPaths”）；单任务记录完成后先写失败测试修复，rebase到main，新CI与一次串行gate，再交owner冻结实现审阅与合并。
- [ ] 协调者（阶段C–E）：C8交付说明、C6裁判校准（≥ 20条人工标注）、D连续两次同类失败熔断、E 10%灰度与合成题只进开发集；按roadmap顺序，不提前解冻。
- [ ] 协调者：保留I16历史独有能力、68/102本地历史refs、host-check修改与旧dirty快照；不恢复冻结模块或删除证据。
- [ ] 协调者：I10偶发失败按既定方式只重跑一次失败job；保留前后证据，第二次失败先诊断。
- [ ] 协调者：原Soul只读；条件不变不重试P01/P02；第50次或每周复盘合并记录。
- [ ] 协调者：完成R3资源类型和后续任务证据；I02 promotion仍需owner，零收益推断。
- [ ] 协调者：旧direct-helper采用前修复kill-error/成功回收回归。
- [ ] Owner：决定I-18方向（a/b）与a46 apply声明的核对方式；合并#150；可选批准零token HTTP错误的有界重试设计；第49次之后的授权；带node_modules任务的依赖预算。
- [ ] Owner：阶段C的新工具/命令、TaskSpec模型字段与冻结CLI/事件/JSON改动需接口审阅后合并。
- [ ] Owner：旧15任务比较、ADR010收益、R5和发布保留独立证据及授权。
- [ ] 既有负责人：保留[早期未完成义务](../archive/tasks/2026-10-21-pre-integration-checklist.md)，含隐私、隔离和生产批准。
