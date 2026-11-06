# Active checklist

See the [current checkpoint](plan.md#current-execution-checkpoint-2026-10-26), [issue log](issues.md#i-18--exact-apply-refuses-git-texteol-attributes), [ADR011](../docs/decisions/0011-real-task-improvement-loop.md) and [ADR012](../docs/decisions/0012-three-pillar-architecture.md). Unfinished work only.

- [ ] 协调者（阶段A）：I-18按方向（a）先写失败测试再修exact apply属性策略；同一安全核心PR让preflight复用apply只读前置判定（源仓库状态、Git属性、快照与Git树一致、容量），在调用模型前按具体原因拒绝，并显示宿主生成的apply拒绝原因（不含检查器原始输出，需冻结CLI审阅）；失败测试从pi-sparkle自身形态（整仓`* text=auto eol=lf`、text未设置的二进制文件）和工作区CRLF字节（仍应拒绝）开始；跨模型评审、串行gate、owner合并。随后第47次在新副本复用a44 TaskSpec走到apply，≤ US$5，记入canonical私有账本；此前不用pi-sparkle副本消耗尝试名额。
- [ ] 协调者（阶段B）：私有队列q01–q05已重建，零模型preflight全部通过，均在pi-sparkle副本上、受I-18阻塞；q01为无具体失败的预防性检查，排最后或弃用。I-18解决后第47–49次跑不同任务，记录检查/应用/介入/各阶段时长/费用覆盖/失败类。
- [ ] 协调者（阶段B）：summary失败类别排序：a46候选（+14/−1）已过宿主检查并保留，阶段A走通后由移植PR完成；返工次数与可得的分阶段token另开普通PR，先写失败测试。
- [ ] 协调者（阶段B）：第47–49次优先产品代码任务（q05先），第49次后加入Soul隔离副本与多文件/跨模块任务；队列条目写明移植路径；汇总每次正确交付的人工与协调者时间，每个新任务记taskSpecMinutes。
- [ ] 协调者：#144 Claude NON-BLOCKING已转发；补Windows两组聚焦测试与typecheck、一次串行gate、含#148的新CI后交owner合并（内存不足时暂缓）；prepared容量另议。
- [ ] 协调者（阶段A）：Git < 2.36 在调用模型前拒绝并在doctor提示（`worktree list -z`）；本机2.54，不挡阶段A；切片PR需owner合并。
- [ ] 协调者：#150（操作指南更正）Claude NON-BLOCKING已转发、CI全绿，待owner合并；合并后在下一次记录PR更新plan的对应说明。
- [ ] 协调者：#146 Claude BLOCKING已转发（桥接漏了“非inline检查须声明protectedPaths”）；单任务记录完成后先写失败测试修复，rebase到main，新CI与一次串行gate，再交owner冻结实现审阅与合并。
- [ ] 协调者（阶段C–E）：C8交付说明、C6裁判校准（≥ 20条人工标注；现有30份PR评审的精度标注可随时零费用试点）、D连续两次同类失败熔断、E 10%灰度与合成题只进开发集；C2/C8先后按阶段B人工时间构成定；按roadmap顺序，不提前解冻。
- [ ] 协调者：保留I16历史独有能力、68/102本地历史refs、host-check修改与旧dirty快照；不恢复冻结模块或删除证据。
- [ ] 协调者：I10偶发失败按既定方式只重跑一次失败job；保留前后证据，第二次失败先诊断。
- [ ] 协调者：原Soul只读；条件不变不重试P01/P02；第50次或每周复盘合并记录。
- [ ] 协调者：R3中模型行为类（指导/上下文/模板/模型档位）等阶段B排序显示需要时再推进，准备与检查配方不受此限；I02 promotion仍需owner，零收益推断。
- [ ] 协调者：旧direct-helper采用前修复kill-error/成功回收回归。
- [ ] Owner：I-18方向已按（a）记录，仍需定a46 apply声明的核对方式与Soul `eol=crlf`；合并#150与评审路由#153；可选批准零token HTTP错误的有界重试设计；第49次之后的授权；带node_modules任务的依赖预算。
- [ ] Owner：阶段C的新工具/命令、TaskSpec模型字段与冻结CLI/事件/JSON改动需接口审阅后合并。
- [ ] Owner：旧15任务比较、ADR010收益、R5和发布保留独立证据及授权。
- [ ] 既有负责人：保留[早期未完成义务](../archive/tasks/2026-10-21-pre-integration-checklist.md)，含隐私、隔离和生产批准。
