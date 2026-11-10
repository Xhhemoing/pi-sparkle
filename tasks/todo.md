# Active checklist

See the [current checkpoint](plan.md#current-execution-checkpoint-2026-10-26), [issue log](issues.md#i-18--exact-apply-refuses-git-texteol-attributes), [ADR011](../docs/decisions/0011-real-task-improvement-loop.md) and [ADR012](../docs/decisions/0012-three-pillar-architecture.md). Unfinished work only.

- [ ] 协调者（阶段A）：第47次已在新副本走通准备→执行→检查→应用（已知费用约 US$0.04），移植PR #157的CI（原项目检查）已通过，私有记录已回填（未见逃逸缺陷，移植记1次介入）；#157合并后在记录PR里把下一个可用结果移到阶段B。
- [ ] 协调者（阶段B）：私有队列q01–q05已重建，均在pi-sparkle副本上；q01为无具体失败的预防性检查，排最后或弃用。副本由Git对象生成（`core.autocrlf=false`，工作区不含CR字节），使用前在新运行时上重跑零模型preflight。第48–49次跑不同任务，记录检查/应用/介入/各阶段时长/费用覆盖/失败类。
- [ ] 协调者：#156延后项（I-14）：`compareTree`三条报错的路径转义、apply描述符每次运行签发两次、新源检查在完整仓库上的耗时、重新验证开始后的拒绝原因与尝试记录中的原因；随相关改动处理，不单独开PR。
- [ ] 协调者（阶段B）：summary失败类别排序由#157交付，待owner合并；返工次数与可得的分阶段token另开普通PR，先写失败测试。
- [ ] 协调者（阶段B）：第48–49次优先产品代码任务（q05先），第49次后加入Soul隔离副本与多文件/跨模块任务；队列条目写明移植路径；汇总每次正确交付的人工与协调者时间，每个新任务记taskSpecMinutes。
- [ ] 协调者：#144 Claude NON-BLOCKING已转发；先rebase到含#156的main，再补Windows两组聚焦测试与typecheck、一次串行gate、新CI后交owner合并（内存不足时暂缓）；prepared容量另议。
- [ ] 协调者（阶段A）：Git < 2.36 在调用模型前拒绝并在doctor提示（`worktree list -z`）；本机2.54，不挡阶段A；切片PR需owner合并。
- [ ] 协调者：#146 Claude BLOCKING已转发（桥接漏了“非inline检查须声明protectedPaths”）；单任务记录完成后先写失败测试修复，rebase到main，新CI与一次串行gate，再交owner冻结实现审阅与合并。
- [ ] 协调者（阶段C–E）：C8交付说明、C6裁判校准（≥ 20条人工标注；现有30份PR评审的精度标注可随时零费用试点）、D连续两次同类失败熔断、E 10%灰度与合成题只进开发集；C2/C8先后按阶段B人工时间构成定；按roadmap顺序，不提前解冻。
- [ ] 协调者：保留I16历史独有能力、68/102本地历史refs、host-check修改与旧dirty快照；不恢复冻结模块或删除证据。
- [ ] 协调者：I10偶发失败按既定方式只重跑一次失败job；保留前后证据，第二次失败先诊断。
- [ ] 协调者：原Soul只读；条件不变不重试P01/P02；第50次或每周复盘合并记录。
- [ ] 协调者：R3中模型行为类（指导/上下文/模板/模型档位）等阶段B排序显示需要时再推进，准备与检查配方不受此限；I02 promotion仍需owner，零收益推断。
- [ ] 协调者：旧direct-helper采用前修复kill-error/成功回收回归。
- [ ] Owner：合并#157（第47次的移植，CI已通过，非纯文档）并确认阶段A是否按第47次的证据收口；腾出本机内存（#144证据需要）；可选让Codex会话补审已合并的#156（`gpt-review`标签仍在）；可选批准零token HTTP错误的有界重试设计；第49次之后的授权（含是否接纳Soul `eol=crlf`）；带node_modules任务的依赖预算。
- [ ] Owner：阶段C的新工具/命令、TaskSpec模型字段与冻结CLI/事件/JSON改动需接口审阅后合并。
- [ ] Owner：旧15任务比较、ADR010收益、R5和发布保留独立证据及授权。
- [ ] 既有负责人：保留[早期未完成义务](../archive/tasks/2026-10-21-pre-integration-checklist.md)，含隐私、隔离和生产批准。
