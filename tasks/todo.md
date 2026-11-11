# Active checklist

See the [current checkpoint](plan.md#current-execution-checkpoint-2026-10-26), [issue log](issues.md#i-18--exact-apply-refuses-git-texteol-attributes), [ADR011](../docs/decisions/0011-real-task-improvement-loop.md) and [ADR012](../docs/decisions/0012-three-pillar-architecture.md). Unfinished work only.

- [ ] 协调者（阶段B）：5个不同任务已完成3个（第47、48、49次，费用全部已知，移植CI全绿）；其余2个要等owner授权第49次之后的尝试。未用的q01–q03都改开发脚本，q01无具体失败，排最后或弃用。使用前：副本由Git对象生成（`core.autocrlf=false`），在当前运行时重跑零模型preflight，并先读worker可见的检查文件确认不含答案（第48次的检查文件含答案，只算管道数据）。
- [ ] 协调者：#159、#160合并后更新记录，并从I-14移除#106。
- [ ] 协调者：#156延后项（I-14）：`compareTree`三条报错的路径转义、apply描述符每次运行签发两次、新源检查在完整仓库上的耗时、重新验证开始后的拒绝原因与尝试记录中的原因；随相关改动处理，不单独开PR。
- [ ] 协调者（阶段B）：summary补返工次数、可得的分阶段token、每次正确交付的人工与协调者时间；普通PR，先写失败测试（不花模型费用，可先做）。
- [ ] 协调者（阶段B）：为第49次之后准备更难的任务（多文件/跨模块、Soul隔离副本）；队列条目写明移植路径；每个新任务记taskSpecMinutes（q04、q05未计时，记为unknown）。
- [ ] 协调者：#144 Claude NON-BLOCKING已转发；先rebase到含#156的main，再补Windows两组聚焦测试与typecheck、一次串行gate、新CI后交owner合并（内存不足时暂缓）；prepared容量另议。
- [ ] 协调者：Git < 2.36 在调用模型前拒绝并在doctor提示（`worktree list -z`）；本机2.54，阶段A收口时未做；切片PR需owner合并。
- [ ] 协调者：#146 Claude BLOCKING已转发（桥接漏了“非inline检查须声明protectedPaths”）；单任务记录完成后先写失败测试修复，rebase到main，新CI与一次串行gate，再交owner冻结实现审阅与合并。
- [ ] 协调者（阶段C–E）：C8交付说明、C6裁判校准（≥ 20条人工标注；现有30份PR评审的精度标注可随时零费用试点）、D连续两次同类失败熔断、E 10%灰度与合成题只进开发集；C2/C8先后按阶段B人工时间构成定；按roadmap顺序，不提前解冻。
- [ ] 协调者：保留I16历史独有能力、68/102本地历史refs、host-check修改与旧dirty快照；不恢复冻结模块或删除证据。
- [ ] 协调者：I10偶发失败按既定方式只重跑一次失败job；保留前后证据，第二次失败先诊断。
- [ ] 协调者：原Soul只读；条件不变不重试P01/P02；第50次或每周复盘合并记录。
- [ ] 协调者：R3中模型行为类（指导/上下文/模板/模型档位）等阶段B排序显示需要时再推进，准备与检查配方不受此限；I02 promotion仍需owner，零收益推断。
- [ ] 协调者：旧direct-helper采用前修复kill-error/成功回收回归。
- [ ] Owner：审阅并合并#159（改了`init`对含弯引号路径的可见输出，需冻结CLI审阅）与#160（改了`pnpm pi:latest`的报告）；决定第49次之后的授权（次数与上限，含是否接纳Soul `eol=crlf`）；腾出本机内存（#144证据需要）；可选让Codex会话补审已合并的#156（`gpt-review`标签仍在）；可选批准零token HTTP错误的有界重试设计；带node_modules任务的依赖预算。
- [ ] Owner：阶段C的新工具/命令、TaskSpec模型字段与冻结CLI/事件/JSON改动需接口审阅后合并。
- [ ] Owner：旧15任务比较、ADR010收益、R5和发布保留独立证据及授权。
- [ ] 既有负责人：保留[早期未完成义务](../archive/tasks/2026-10-21-pre-integration-checklist.md)，含隐私、隔离和生产批准。
