# Pi-sparkle 当前架构：算法契约

本文维护当前接受的十项算法设计，与[架构总览](framework.md)和[迁移计划](architecture-migration.md)配套。
编号 A1–A10 是算法主题，不是十个服务、十个模型调用或十套状态机。
设计被接受不代表实现已接线、测试已通过，亦不关闭[支持状态](status-matrix.md)中的生产与实验门槛。
源码触点以下述审阅基线为准：`740767403ef634c9d6f8be7829f8f489be7a68db`。

## 共同边界

- 默认任务直接进入执行；队列、独立规划、金额预算、学习评测不是普通任务的必经步骤。
- task/authority、execution/resources、workspace/checks、state/recovery 是四项逻辑职责，可以保持单一部署。
- 当前任务事实可在动作边界更新；权限、检查定义、运行时与插件绑定不能被观察者偷偷改写。
- 沿用 WorkQueue 的任务与 claim、ActionLedger 的效果对账、run events 的历史、Git 的源码权威；派生视图不决定成功。
- 遵守 [ADR-006](decisions/0006-pi-extension-reverse-adapter.md) 的 Pi 双向边界，以及 [ADR-008](decisions/0008-remove-sha256.md) 的存储与比较规则。
- 新身份使用 opaque、版本化 ID；内容相等与去重比较规范化后的精确字节，不新增密码学哈希。
- 精确字节相等不证明可信；历史 SHA-bound 证据保留历史身份，不静默转成新的可信记录。
- 下列“已有测试”是可复用的回归入口，不表示本次文档工作重新运行了产品测试。

## A1 自适应流程：复杂度与风险分开看

**输入 → 输出。** 当前目标、授权范围、可逆性、公共契约、外部效果、定位证据，输出 `path + reason + requiredChecks`。

**候选与选择。** 比较全任务完整流程、全任务无流程、按事实逐步升级；选择第三种。
初期使用可解释规则，不增加一次流程分类 LLM，也不以描述长度或文件数量代替风险。

1. 目标明确、局部且可逆，选择 light：读、改、相关检查。
2. 目标与范围清楚但需跨模块协作，选择 standard；共享证据而不强制新增角色。
3. 位置或原因不清楚，先做一次有界定向调查，再决定执行路径。
4. 公共契约、数据迁移、权限或外部效果出现新风险时，扩大检查或隔离工作。
5. 普通编译失败先在原路径修复；一次失败不足以触发整套流程升级。

用户明确要求深入研究时按该目标执行；同一阶段内避免反复升降级。
升级保留已有证据、改动与授权，不把“升级”实现成从零重跑。

**失败退路。** 调查后仍不能定位，说明缺失事实；只询问会改变实施结果的问题。
现有 strict develop 保持独立验收和可信 apply 的语义，不能因为任务被标为 light 而降级。

**已有与新增。** 已有原生写会话、有界写循环和 develop controller；2026-10-17 的 [实验性 startDevelopmentTask](direct-development-task.md) 已提供直接任务入口。统一路径解释器与[自然语言入口和焦点管理](conversation-workflow.md)仍待接线。
触点：[write-session](../src/native/write-session.ts)、[write-loop](../src/native/write-loop.ts)、[controller](../src/development/controller.ts)。
已有测试：[原生会话](../test/integration/native/write-session.test.ts)、[控制器](../test/integration/development/controller.test.ts)。

**验收证据。** 单文件 schema 修改应升级检查；多文件机械替换不因数量自动升级。
普通任务不新增流程专用模型调用，不要求预填金额或进入项目队列；记录首次有效改动时间与实际返工。
简单组合优先的研究依据见 [Anthropic agent patterns](https://www.anthropic.com/engineering/building-effective-agents)，具体阈值仍需本项目校准。

## A2 动态发现与纠偏：事件驱动、同因合并

**输入 → 输出。** 工具、测试与源码事件，加任务/候选 revision、generation 和证据版本，输出 finding 及 continue、verify、repair、pause 或独立修复提案。

**候选与选择。** 不默认每轮 reviewer 或周期全仓扫描；选择廉价只读观察加必要时的短时分析。
观察者提交事实，当前执行者和宿主负责动作，避免建立第二套调度器。

1. 原始取消、claim、效果与费用事实先持久化；分析摘要可以降载，关键事实不能随队列满而丢弃。
2. 按原因、位置、目标、快照及证据版本合并；同一身份最多一个活动分析。
3. 保存完成身份，防止分析完成后被同版重复日志再次启动；新证据可启动新分析。
4. 结果必须匹配当前 revision/generation；过期结果标 stale，不修改当前候选。
5. 可信的立即危害优先停止受影响动作；不确定发现先局部验证，无关样式进入 backlog。
6. 同授权、可逆的局部修复，由当前 writer 在宿主确认的安全边界执行。
7. 每次边界、每个任务/候选 scope 最多发出一个修复动作；其他发现继续待处理。

安全边界须有旧 mutation 已真实 settle 的宿主事实；发出 abort 或 Promise.race 返回均不足以证明。
可隔离的无关工作可以继续；更广的已授权修复另开会话，先结算/对账，源改变后重验旧候选。
观察者不能扩大权限、修改检查器、直接写候选或释放 mutation claim。

**失败退路。** 同因失败且没有新证据时，只换一次诊断路径或停下说明；不无限生成修复任务。
未经确认的取消继续保持 pending/unclean，不把分析去重误用成安全事件冷却。

**已有与新增。** tracking 与 child tracking 提供部分观察/门控；统一 finding reducer、安全边界接线和保留策略待实现。
触点：[tracking/turn](../src/tracking/turn.ts)、[tracking/analysis](../src/tracking/analysis.ts)、[child-tracking](../src/run/child-tracking.ts)、[write-loop](../src/native/write-loop.ts)。
已有测试：[tracking gates](../test/unit/tracking/gates.test.ts)、[controller cancellation](../test/integration/development/controller-cancellation.test.ts)。

**验收证据。** 100 条同版重复日志只产生一次分析；新危险不被 cooldown 压住；迟到结果不落新候选。
两个同 scope finding 在一个安全边界只启动一次修复；未 settle 的取消保留所有权。
控制与小步对账借鉴 [Kubernetes controllers](https://kubernetes.io/docs/concepts/architecture/controller/)，不引入其运行平台或把它视为本项目效果证据。

## A3 上下文选择：任务局部检索优先

**输入 → 输出。** 目标、授权路径、当前明确要求、验收条件、变更、符号/依赖与相关偏好，输出带来源的 context packet、遗漏说明或容量错误。

**候选与选择。** 比较整仓装入、默认向量服务、词法加符号邻域与按需读取；选择第三种起步。
相关性权重是可调假设，不宣称未经测量的“最优检索”。

1. 宿主提供已校验可读、当前有效的必需事实；引用材料不能自称获得授权。
2. 先扣除其他 prompt 与输出预留，再计算 packet 总容量；缺容量返回 `CONTEXT_CAPACITY_UNAVAILABLE`。
3. 当前要求、验收与范围先装入；必需材料不可用返回 `MANDATORY_UNAVAILABLE`。
4. 必需材料超过容量返回 `MANDATORY_OVERFLOW`；可压缩历史，不能静默删目标或检查条件。
5. 可选材料预算为 `min(optionalBudget, totalBudget - mandatoryTokens)`。
6. 从相关路径、失败位置、导入和调用邻域取片段，按相关性、新鲜度与单位 token 价值稳定排序。

缓存绑定实际 source snapshot、查询、recipe 和 policy generation；源变化即失效。
获取的数据是证据，不提升为用户指令；跨项目材料仍受项目与权限边界约束。
必需事实的 freshness/readability 检查属于宿主责任，纯选择器测试不证明文件系统权限或消除 TOCTOU。

**失败退路。** codeMap 不可用时回到词法搜索与范围读取；该 fallback 工具接线也必须验收。
现有 token 估算不等于真实 tokenizer；不能仅因估算通过就宣称全部模型上下文一定可装入。

**已有与新增。** 已有 packet 编译、预算准入及 codeMap DTO；主路径 codeMap 接入、范围读与缓存契约尚未完整实现。
触点：[context/index](../src/context/index.ts)、[context/packet](../src/context/packet.ts)、[project/discovery](../src/project/discovery.ts)、[coding tools](../src/pi-adapter/worktree-coding-tools.ts)。
已有测试：[packet admission](../test/unit/context/packet-admission.test.ts)、[project index](../test/unit/context/project-index.test.ts)、[packet fidelity](../test/integration/m3/packet-fidelity.test.ts)。

**验收证据。** 必需 101、容量 100 时拒绝；不可读或过期必需项拒绝；可选项不能侵占必需容量。
比较首次定位时间、无关 token、遗漏依赖与跨项目泄漏；变源缓存不能返回旧代码。
候选依据：[Aider repository map](https://aider.chat/docs/repomap.html)；不因此默认引入全仓索引服务。

## A4 模型路由与费用：先能力筛选，再有证据升级

**输入 → 输出。** 能力需求、模型可用性、用户指定、上下文量、执行结果和用量，输出模型、fallback、路由理由与费用覆盖状态。

**候选与选择。** 保留固定用户选择，以规则级联起步；bandit 只做 shadow，不默认进入生产路由。
先排除能力、上下文或供应商约束不满足的选项，再在已验证配置中选择合适成本档。
无校准数据时用配置主模型，不盲选价格最低者；用户明确指定与硬能力不兼容时解释冲突。

1. 失败分为环境、工具、provider、功能不足与需求变化，不能一律归咎模型。
2. 有功能不足证据或有依据的高不确定性才升级；重用已有工作，不重新计费重跑全部任务。
3. provider 429 在 provider 层处理重试；上层不得嵌套整任务重放。
4. 默认 observe：未知价格单独报告，不阻止普通任务，也不当作零费用或代码失败。
5. strict 是明确启用的准入约束；全部适用祖先约束保留，后代不能降为 observe 或提高祖先限额。
6. strict 必须取得可靠费用上界，并对全部适用 scope 原子预留；调用、并发、重试都在覆盖范围内。
7. 没有可靠上界就返回 strict unavailable，不静默降级；取各上限最小值不能代替各 scope 累计账本。

可靠上界是本系统所覆盖调用的准入条件，不是供应商最终账单承诺。
取消、丢失 receipt 或未知 dispatch 保持未结 reservation；无已知用量不能自动退款。
价格变化、覆盖外调用与结算差异必须有独立状态，不以单一“成功/失败”掩盖。

**失败退路。** 回到配置模型与可解释 observe；已选择 strict 的任务只能明确阻塞或由用户修改约束。
严格预算账本迁移/回滚需兼容 reader 与单 writer；revert 代码不能自行结清 reservation。

**已有与新增。** 当前 CostGate 是每次执行的回合后观测停机，已有 provider retry；共享根预算及多 scope 预留是新增能力。
触点：[cost-gate](../src/pi-adapter/cost-gate.ts)、[pi-executor](../src/pi-adapter/pi-executor.ts)、[provider-retry](../src/pi-adapter/provider-retry.ts)、[live-cascade](../src/routing/live-cascade.ts)、[invocation-log](../src/telemetry/invocation-log.ts)。
已有测试：[cost gate](../test/unit/pi-adapter/cost-gate.test.ts)、[provider retry](../test/unit/pi-adapter/provider-retry.test.ts)、[cost stop](../test/integration/pi-adapter/cost-stop.test.ts)、[live isolation](../test/unit/routing/live-isolation.test.ts)。

**验收证据。** 并发不能超出已设准入额；祖先 strict 不被子配置撤销；unknown hold 在取消后仍存在。
比较最终验收率、人工返工、耗时和完整费用，包含失败、辅助分析及重试；费用覆盖不足时不宣称节省比例。
重试层次与超时副作用参考 [AWS retries and jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)；路由档位和费用上界仍须在本项目验证。

## A5 Pi 动态升级：资格认证后选择，不热换在飞任务

**输入 → 输出。** 精确包集合、driver/protocol、环境、契约测试和渠道策略，输出 qualified generation、quarantine 或 root binding。

**候选与选择。** 保留随主包发版的固定依赖作为退路；目标采用受管独立进程 generation，不在运行进程内 import latest。
已有 [ADR-001](decisions/0001-pi-adapter-boundary.md) 的 Pi 边界继续有效，动态更新不等于复制 Pi agent loop。

1. 只发现允许 registry/channel 的精确版本，解析匹配依赖，在新的不可变目录准备候选。
2. 记录实际解析来源、路径与依赖集合，防止借用 workspace 依赖；使用安装器既有完整性能力，不新增第一方密码学方案。
3. 在独立进程执行隔离 fixture，不读取个人凭据、配置、扩展，不作用真实项目；独立进程不等于 OS sandbox。
4. 宿主产生资格记录：opaque ID、规范化 manifest 精确字节、driver、环境、测试套件和能力；候选不能自证资格。
5. 完整记录发布后才 CAS 切换 approved 指针；失败候选进入 quarantine，known-good 保持可用。
6. 新 root run 绑定一次，子任务与重试继承；resume 使用原绑定，不跟随指针漂移。
7. GC 同时检查活动 lease、可恢复 checkpoint 引用及 known-good 保留，不只看是否有当前进程。

native Pi 宿主也需新宿主进程与自己的资格认证；首期不跨 IPC 搬运函数式认证或 `streamSimple` 回调。
当前绑定有外部效果或未知 dispatch 时禁止换代盲重放；“没有 receipt”不证明“没有效果”。
跨代建议只适用于宿主明确确认全树在任何 dispatch 前已干净 settle 的新 run 提案，不能直接授权恢复。

**失败退路。** 断网使用已安装合格版本；候选失败保持旧指针；原 generation 不可用时显式阻塞恢复。
回滚指针只影响新 root；已在飞或可恢复任务所需 runtime、driver 与 API 必须保留。

**已有与新增。** 当前 core/ai 固定为 0.86.1，coding-agent peer 为 `>=0.84.4 <0.87.0`；兼容检查和 latest probe 不等于受管安装/资格认证。
触点：[package.json](../package.json)、[pi-compat/check](../src/pi-compat/check.ts)、[kernel](../src/pi-adapter/kernel.ts)、[pi-executor](../src/pi-adapter/pi-executor.ts)。
已有测试：[compat](../test/unit/pi-compat/check.test.ts)、[probe scripts](../test/unit/pi-compat/probe-scripts.test.ts)、[kernel](../test/unit/pi-adapter/kernel.test.ts)、[Pi boundary](../test/unit/pi-boundary.test.ts)。

**验收证据。** 需真实 Pi 矩阵覆盖工具事件、取消/settle、资格绑定、恢复引用与 GC；纯选择原型不能替代。
尤其验证首次达到 cap 后下一 provider 调用未发生，且用量不重复记账。
[Pi 0.87.0 changelog](https://pi.dev/changelog/releases/0.87.0) 的停止钩子时序变化必须由 driver 适配测试确认，不能只比较版本字符串。

## A6 用户偏好与当前需求：明确事实先行

**输入 → 输出。** 用户表达、scope、来源、时间和当前任务事实，输出少量 `BoundPreference(key, value, source, scope, reason, expiry)` 与冲突。

**候选与选择。** 不建立整段“人格摘要”权威；先支持显式偏好，再按证据加入可追溯弱推断。
“用户现在需要什么”来自当前目标、阶段、实际阻塞和交付物，不能由长期风格猜测替代。

1. 先筛 owner、项目、相关 key、已删除、被替代及过期项，再做优先级比较。
2. 当前明确要求优先于相关显式持久规则，再到有定位的弱纠正观察、推断候选与默认值。
3. 同等级按 task/project/user 的适用范围及明确 supersedes 处理；明确纠正本身就是 explicit。
4. 当前“这次详细”立即作用本次任务，不污染“平时简短”；“以后中文”直接更新显式长期偏好。
5. 任务 overlay 只传递允许的交互 key，不传递权限、acceptance、预算或检查器设置。
6. 删除优先使派生索引与缓存失效，tombstone 防止旧来源重放复活；普通 TTL 淘汰不能清除这个约束。

显式创建、纠正和删除不走 holdout、策略实验或晋升；关闭自动适应仍须允许这些用户操作。
工具输出与引用文档不能伪造偏好或授权；模型自报置信度不视为校准概率。

**失败退路。** 冲突不影响结果时用可逆默认；确实改变结果时问一个具体问题；无证据就不使用画像。
首先使用 scope/key 与关键词召回；只有真实遗漏证明必要时再增加语义检索。

**已有与新增。** 已有显式/推断记录、recurrence 和删除 tombstone；当前 precedence 为 user > project > task-family > role > model。
本设计的 task overlay、expiry、supersedes 与逐 key 解释是新增契约，不能声称现有解析器已经实现。
触点：[types](../src/preferences/types.ts)、[precedence](../src/preferences/precedence.ts)、[store](../src/preferences/store.ts)、[materialize](../src/preferences/materialize.ts)。
已有测试：[preferences](../test/unit/preferences/preferences.test.ts)、[deletion replay](../test/unit/preferences/deletion-replay.test.ts)、[CLI](../test/integration/m4/preferences-cli.test.ts)。

**验收证据。** 全局简短加本次详细正确覆盖；跨项目不串用；删除后旧事件重放不复活。
关闭自动适应时显式修改与删除仍生效；引用文档不能进入 explicit 权威；不静默改写现有 recurrence 语义。
相关性、纠正和用户控制借鉴 [Microsoft HAX](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) 与 [Google PAIR](https://pair.withgoogle.com/guidebook-v2/chapter/feedback-controls/)；本项目优先级规则是本地设计，不是这些资料已经验证的编码收益。

## A7 长期优化：先归因与离线比较

**输入 → 输出。** 真实结果、用户纠正、费用覆盖、任务/策略版本，输出候选、比较报告、晋升或回退。

**候选与选择。** 比较点赞强化、全量在线自修改、有限策略离线评测后试用；选择第三种。
运行时只消费已批准策略，学习产生下一 run 的候选；遵守 [ADR-004](decisions/0004-controlled-adaptation.md)。

1. 将失败归因于功能、工具、provider、取消或需求变化；不把取消一律计作模型差。
2. 冻结任务集与 policy/source 绑定，按时间切分训练、校准和评测，避免同一任务泄漏。
3. 正确性、真实验收、隐私与不扩权是门槛；费用、延迟、返工和满意度分别比较。
4. CI 通过、用户沉默、代码合并都不自动代表满意或策略因果收益。
5. 样本与覆盖不足时保留候选，不晋升，也不输出“最优模型”或节省承诺。
6. 首阶段复用 approved/CAS 流程；新策略只对下一 run 生效，当前任务绑定不漂移。

以后可在一次性授权的低风险策略范围内自动试用/回滚，不要求每轮重新确认。
该能力须先通过真实监控到回滚的完整链路；现有 monitor 模块存在不等于生产自动回滚已接通。
用户显式偏好与 tombstone 是用户事实，不受本算法实验、分流或晋升门槛控制。

**失败退路。** 异常保留或恢复旧 approved 策略；关闭自动适应保留必要收集，但停止推断更新与候选生成。
旧 SHA-bound 评测仅作为历史证据，不能靠重算标识把它迁移为新的可信晋升依据。

**已有与新增。** 已有 collect/diagnose/propose、promotion、rollback 与相关离线能力；生产效果与自动试用闭环仍需独立验收。
触点：[auto-loop](../src/learning/auto-loop.ts)、[promotion](../src/adaptation/promotion.ts)、[rollback](../src/adaptation/rollback.ts)、[monitor](../src/adaptation/monitor.ts)。
已有测试：[promotion](../test/unit/adaptation/promotion.test.ts)、[rollback](../test/unit/adaptation/rollback.test.ts)、[live isolation](../test/unit/routing/live-isolation.test.ts)、[privacy boundary](../test/unit/privacy/plane-boundary.test.ts)。

**验收证据。** 固定评测身份、无数据泄漏、实际回滚可复现、未批准候选不进入 live；显式操作不被学习开关阻断。
长期收益需真实任务与完整费用覆盖，不能从策略原型通过率推导。
记忆更新与时序问题参考 [LongMemEval](https://arxiv.org/abs/2410.10813)；满意度信号的局限参考 [OpenAI sycophancy retrospective](https://openai.com/index/expanding-on-sycophancy/)。两者提供反例与评测思路，不证明本项目策略已获益。

## A8 项目推进与连接：现有队列上的薄协调

**输入 → 输出。** WorkQueue revision、当前 source、claims、未结效果和外部对象事实，输出 next item、blocked、proposal 或只读进展投影。

**候选与选择。** 选择薄 `advanceProject`，复用现有队列/controller；保留手动 `runNext`，不新增常驻万能 planner 或业务数据库。
队列拥有任务/claim，ActionLedger 拥有效果对账，Git 拥有当前源码；连接器只搬运事实与提案。

1. 先对账未结效果，再复用优先级、稳定 ID、依赖和冲突 scope 选择逻辑。
2. `runNext` 自身负责锁内 claim；包装器不能先 claim 再调用它造成二次 claim。
3. 依赖必须已进入当前 source；accepted candidate 不等于已集成，不能提前解锁下游。
4. 新目标先生成草稿；未来 `applyPlanPatch(expectedRevision)` 只改 planned 项并检环，不修改在飞/已验收定义或搬用证据。
5. 连接器先只读导入 issue/PR 草稿，由宿主接纳；外部写回只在已授权效果范围触碰自己的进展区。

GitHub 的 delivery ID、远端对象 ID 和本地效果 operation ID 是三种不同身份。
delivery 去重只处理传输重复；按 repository 稳定身份与对象类型/身份映射 issue/PR，事件到达顺序不决定业务状态。
重投递沿用 delivery ID；收到事件后按需读取最新远端事实，遗漏事件靠显式 reconciliation 弥补。
Issues API 包含 PR，返回的 issue ID 不能误当 pull request ID；保存类型与明确映射。
远端拥有的字段以远端读取为事实；共享人工字段冲突生成提案，不自动覆盖；三方比较不是事务 CAS。
ETag 用于支持它的条件读取；通用 PATCH 不具备默认的 ETag CAS 保证。

传输去重采用独立、有界的派生元数据，不能占满现有有限 ActionLedger，也不能成为第二业务权威。
pending delivery 不得为腾空间直接丢弃；容量不足应背压。保留期结束只缩短去重窗口，不豁免效果幂等。
外部 mutation 继续使用 ActionLedger 的 intent/claim/receipt；operation ID 稳定，精确规范化字节用于比较。
远端已成功但响应丢失时状态为 unknown，先对账，禁止盲重发 POST。

**失败退路。** source 变化或未知效果只阻塞受影响项；禁用连接器后本地手动推进仍可工作。
**已有与新增。** 有有限队列、batch、controller 与 ledger；无已完成 GitHub 双向连接器、cron 或常驻项目推进器，`pull-request` 枚举不代表连接器。
触点：[work-items](../src/development/work-items.ts)、[work-item-store](../src/development/work-item-store.ts)、[controller](../src/development/controller.ts)、[action-ledger](../src/development/action-ledger.ts)。
已有测试：[work items](../test/unit/development/work-items.test.ts)、[ledger](../test/unit/development/action-ledger.test.ts)、[work-item store](../test/integration/development/work-item-store.test.ts)。

**验收证据。** 并发 continue 只有一个 claim；过期 revision 拒绝；未集成依赖阻塞；重复/乱序事件不重复执行；双边编辑不覆盖。
必须覆盖远端成功但 receipt 未落盘、漏 webhook 后重建事实、去重容量耗尽与连接器关闭。
官方约束：[webhook practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)、[Issues API](https://docs.github.com/en/rest/issues/issues)、[REST practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)。

## A9 插件激活：少量贡献，使用时才加载

**输入 → 输出。** 显式启用的 manifest、贡献 ID、任务需要、API 版本和宿主能力，输出 activation 或 unavailable。

**候选与选择。** 不启动即全量导入，也不要求全部进程隔离；先采用可信同进程声明式 lazy activation。
首批拟稳定公开的贡献仅 context/diagnostic；tool/observer 继续实验，不能借插件扩展 accept/apply 权威。

1. 静态读取 manifest，不执行 entry；disabled entry 必须零执行。
2. 匹配当前需要，检查 API 与宿主能力交集，再首次 lazy import。
3. 在 staging 注册并检查唯一 ID，禁止覆盖核心贡献；全部成功后一次发布。
4. 并发首次请求共用一个激活 promise；失败不得留下半注册状态。
5. 活动 run 固定 generation；更新对后续 run 生效，旧代先停止并 drain。旧代迟到提案不得发布到新状态；迟到的效果收据、用量和清理证据仍须记录并幂等结算。

宿主 facade 只暴露贡献所需数据与动作，不交出 raw store、Pi 对象、凭据或 accept/apply 权限。
同进程插件仍是可信 Node 代码；类型与 manifest 不阻止其直接文件访问，不宣称 OS sandbox。
staging 能回滚宿主注册，不能撤销 import 期间任意外部副作用。

**失败退路。** 可选 context 失败回到基础检索；必要 diagnostic 失败为 unavailable，不能转换成 PASS。
插件无法 drain 时保留旧代隔离状态并阻塞相关新绑定，不让新旧结果混写。

**已有与新增。** Pi 扩展已有局部按需 import 与 shutdown；通用稳定插件管理器和外部 SDK 入口待实现。
拟议 `sdk/host/testing` 是目标，不是当前已发布的 package exports；新 SDK 示例和新增消费者只依赖支持的入口，旧 src/dist 深导入按迁移窗口和兼容转发处理。
触点：[Pi 扩展](../extensions/pi-sparkle/index.ts)、[package.json](../package.json)、[Pi boundary](../test/unit/pi-boundary.test.ts)。
已有测试：[native extension](../test/unit/native/extension.test.ts)、[task contract extension](../test/unit/native/task-contract-extension.test.ts)。

**验收证据。** disabled 零执行、single-flight、无半注册；旧代迟到提案拒绝而收据不丢；外部消费者仅用公开入口可编译与加载。
候选依据：[VS Code activation events](https://code.visualstudio.com/api/references/activation-events)；参考其按需加载思想，不假设获得相同安全隔离。
权限边界同时参考 [VS Code extension runtime security](https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security) 与 [Node vm](https://nodejs.org/api/vm.html)；插件接口不能代替执行隔离。

## A10 检查与恢复：影响匹配、真实停止、收据对账

**输入 → 输出。** 差异、任务契约、检查能力、进程树和效果记录，输出 evidence、pending、failed 或 accepted candidate。

**候选与选择。** 比较全改全套检查、只信 worker 自述、影响匹配加最终真实验收；选择第三种。
文案核对精确 diff，逻辑改动运行相关回归，public contract/数据迁移扩大验证；严格 develop 的独立验收不降级。

1. 检查前绑定 source、任务定义与 evaluator；可信检查记录只能由宿主产生。
2. 检查 unavailable 不等于 PASS，worker 自述不替代真实检查证据。
3. 发出取消请求后等待实际拥有的进程树结束；信号发送成功或顶层 promise 返回不等于子孙停止。
4. 未 settle 时保留 pending/unclean 和 mutation claim，不允许新 writer 抢占同一范围。
5. 外部效果先 prepare/claim 后 dispatch，完成后写 receipt；取消不能抹掉未知效果。
6. 恢复只有在 receipt 已完成且身份匹配时补回遗漏的队列转移；unknown 必须宿主对账。

缓存只用于准备或有明确身份的可复用诊断，不能取代最终 apply 授权。
source 或检查器绑定变化后旧证据失效；精确字节比较不是 OS 隔离或恶意篡改防御。
不使用 git reset 覆盖用户改动，不把 accepted candidate 直接当成已经集成的源。

**失败退路。** 无法证明停止则暂停相关写入并显示待清理事实；无法确定效果则保留未结状态，提供人工 reconciliation。
回滚代码不能撤销远端效果、退回未知 reservation 或自动兼容已写的新 schema。

**已有与新增。** 已有独立检查、可信验收/apply 与账本恢复路径；嵌套命令取消的真实 develop 端到端可靠性门槛仍开放。
触点：[command-runner](../src/execution/command-runner.ts)、[independent-check](../src/execution/independent-check.ts)、[trusted-verification](../src/execution/trusted-verification.ts)、[acceptance](../src/execution/acceptance.ts)、[controller](../src/development/controller.ts)。
已有测试：[command runner](../test/unit/execution/command-runner.test.ts)、[work-item cancellation](../test/integration/development/work-item-cancellation.test.ts)、[trusted apply](../test/integration/native/trusted-apply.test.ts)。

**验收证据。** 真实 develop nested recipe 取消后没有后续写入；覆盖 Linux/Windows 进程树、崩溃、迟到事件与重复 receipt。
现有等价 runner 复现不能替代该端到端门槛；工作树隔离与 CI 通过也不能证明 OS sandbox 或可靠停止。
进程信号与关闭语义参考 [Node child_process](https://nodejs.org/download/release/v22.19.0/docs/api/child_process.html)，实际子孙进程归属和多平台清理仍以本项目复现/回归为准。

## 证据层级与实施交接

实施回归应覆盖继承 strict 被降级、必需上下文超量、单边界重叠修复、已完成分析重复启动、输入别名改写绑定、无 receipt 被误当无效果等反例。
纯决策检查即使通过，也不证明生产锁、跨 scope 账本、真实进程、网络副作用、Pi 兼容矩阵或经济收益。
宿主如何证明安全边界、clean startup、实际费用上界和可信资格，仍由对应实施切片完成。
本次只接受并记录设计；产品验收必须逐项附真实测试、运行身份与失败证据，不以本文复述替代。

实施顺序、可继续拆分的 M0–M7 切片及 reader 先行/单 writer/回滚条件见[迁移计划](architecture-migration.md)。
文档验证与交接记录见[本次工作报告](../archive/reports/2026-10-16-current-architecture-guide.md)；当前可用性以[支持状态](status-matrix.md)为准。
