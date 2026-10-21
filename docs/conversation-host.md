# 实验性对话宿主入口

宿主使用 ConversationSession 处理结构化请求和会话内焦点，查询已有 controller 或调用 startDevelopmentTask。2026-10-20 的 P1 已新增显式宿主配置的 Pi 对话工具；当前验收状态见[实施记录](reports/2026-10-20-conversation-tools.md)。P2 的只读引用恢复已通过本地验收，见文末和[恢复记录](reports/2026-10-20-conversation-recovery.md)；自然语言任务配置仍是独立工作，question 请求本身只返回焦点上下文。

构建后可在仓库中通过实验性深路径使用：

```ts
import { ConversationSession } from "./dist/conversation/session.js";

const session = new ConversationSession({
  projects: [{ projectRef: "project-one", controller }],
  tasks: [{
    projectRef: "project-one",
    taskRef: "fix-label",
    input: {
      stateRoot, sourceRepo, sandboxRoot,
      objective: "Update the declared label",
      verification: { command: trustedChecker, args: trustedArguments },
      executorFactory,
      presentation: {
        user: { detail: "brief", language: "en-US" },
        task: { detail: "detailed", language: "zh-CN" }
      }
    }
  }]
});

const target = { projectRef: "project-one", taskRef: "fix-label" };
await session.handle({
  kind: "focus", messageRef: "message-1",
  focus: session.focus().token, target
});

// 插问保留当前焦点，由宿主回答，不启动新的模型或开发任务。
await session.handle({
  kind: "question", messageRef: "message-2", focus: session.focus().token
});

// 请求只选择宿主已经准备并授权的任务，不能携带新的路径或检查器。
const result = await session.handle({
  kind: "run-direct", requestId: "request-1", messageRef: "message-3",
  focus: session.focus().token, target
});
console.log(result);
```

`controller`、检查命令、路径和 `executorFactory` 由宿主真实集成提供；上述变量不是额外的自动配置服务。宿主注册任务前应具备用户授权。注册本身不授予模型签发、应用或扩大权限的能力。本入口不是稳定 package SDK，也没有新增可直接输入自然语言的 CLI 命令。

| 请求 | 行为 |
|---|---|
| `question` | 返回当前焦点给宿主继续回答；焦点和执行占用不变 |
| `status` | 调用注册项目的 `controller.status()` 读取现有队列/action 事实，不调用可能运行检查的 `next()` |
| `focus` | 使用当前 generation/revision 切换到已知引用；临时焦点保留可恢复的主线 |
| `restore` | 恢复已保存引用，不重跑任务或移动候选写入权 |
| `run-direct` | 按已注册输入运行既有直接任务；等待原有关闭链，再返回真实结果 |

焦点令牌只防止旧界面状态覆盖新状态，不是执行或应用授权。切换焦点后，迟到结果仍返回给发起者并标为 `staleFocus`，不会改写新焦点。任务事实继续由 run、候选与检查证据保存；会话仅持有引用。

每个会话同一时刻只允许一个直接任务。查询和切换焦点不能释放占用。相同 `requestId` 或直接任务 `messageRef` 再次使用会被拒绝，既不重复执行，也不替换成另一个目标。去重有硬容量且不淘汰旧条目；达到上限后拒绝新派发。这是会话内约束，不是跨进程/崩溃后的 exactly-once 承诺。未结效果或派发后的未知异常会保持拒绝新写入，由宿主核对原有 run/候选/效果事实；不能用新建会话绕过尚未对账的旧写入。

## 本次表达偏好

直接任务的可选 `presentation` 支持以下字段，每个字段分别按 `user < project < task` 解析。宿主传入的是明确偏好的快照，不会隐式读取或改写进程全局 preference store。

| 字段 | 值 | 影响 |
|---|---|---|
| `language` | 最长 64 字符、可规范化的 BCP47，如 `zh-CN` | 本次结果的表达语言 |
| `detail` | `brief` / `standard` / `detailed` | 本次说明详略 |
| `format` | `prose` / `bullets` / `markdown` | 本次说明组织形式 |

例如上面的任务继承 user 的默认表达，再用 task 的“本次详细、中文”覆盖。下一个任务不传 task 层就恢复宿主传入的默认值。输入在开始异步工作前复制并冻结，重试沿用同一快照，并发任务各自隔离；不传偏好时不增加表达指令。解析结果保留逐字段来源 scope。

偏好只能追加到本次克隆 profile 的表达指令，不改 objective、权限、检查器、验收、费用或重试上限；未知键、访问器、非法语言/枚举会被拒绝。关闭推断学习也不影响明确表达偏好。语言和格式指令不是正确性或用户满意度证据，宿主检查失败仍不接受候选。

## 在 Pi 中加载宿主配置的对话工具

此入口需要宿主已构造的 ConversationSessionOptions，包含允许选择的项目/任务、真实 executor 和可信检查器。模型只选择引用，不能传入路径、检查命令或新权限。未配置时，默认扩展仍只有原来的 delegate/apply 工具。

在宿主工程中创建 wrapper，使用当前源码/已安装包中的扩展入口；下例的 host-config.js 由宿主导出前文同形状的 conversationOptions：

~~~ts
import { createSparkleExtension } from "pi-sparkle/extensions/pi-sparkle/index.ts";
import { conversationOptions } from "./host-config.js";

export default createSparkleExtension({ conversation: conversationOptions });
~~~

用 Pi 加载 wrapper，例如在其所在目录运行 pi -e ./sparkle-host.ts。也可放到宿主信任项目的 .pi/extensions/ 下；不要同时重复加载默认扩展与这个包含默认工具的 wrapper，以免重复注册同名工具。真实 Pi loader 的加载和 handler 行为由集成测试验证，宿主自己的配置与模型可用性仍由该宿主负责。

配置后新增两个工具：

| 工具 | 输入 | 返回 details |
|---|---|---|
| sparkle_conversation_focus | 严格空对象 | refs 数组和 focus 快照；只有 projectRef/taskRef 与焦点引用，不暴露 task binding |
| sparkle_conversation | 已有闭合 request union | 原 ConversationResponse，包含实际结果、focus，以及适用时的 staleFocus |

先用 focus 工具取得 refs 与 focus.token，然后传给 conversation 工具。以下是消息流中的请求对象；generation/revision 必须来自刚读到的 token：

~~~ts
const focusRequest = {
  kind: "focus",
  messageRef: "message:select",
  focus: currentToken,
  target: { projectRef: "project-one", taskRef: "fix-label" }
};
const runRequest = {
  kind: "run-direct",
  messageRef: "message:run",
  requestId: "request:run",
  focus: tokenAfterFocus,
  target: { projectRef: "project-one", taskRef: "fix-label" }
};
~~~

每个响应的 text 是同一 details 的 JSON 表示。question/status 不启动 worker；focus/restore 只切换引用。直接任务仍使用隔离 candidate 和宿主检查，返回结果不自动应用到源码，也不会自动签发 apply handle。相同直接执行 requestId/messageRef 被拒绝；普通查询不因此要求新的执行 provenance。

工具取消与 session_shutdown 合并到原任务取消信号。关闭先拒绝新对话请求，再等待已进入调用实际结束，保留既有 NativeSession 的关闭责任。迟到结果仍属于原目标；切换焦点不会释放执行占用。新建扩展实例只产生新会话，不代表旧未知效果已对账；跨重启恢复与重复执行防护不是本片的承诺。

## 跨会话只读恢复（P2）

P2 提供显式保存引用和恢复专用会话；本地测试、独立评审与完整门禁证据见[恢复记录](reports/2026-10-20-conversation-recovery.md)。恢复不是重新执行：恢复实例始终拒绝 run-direct，即使旧 run 已完成、没有 runId 或换了 requestId。普通宿主执行实例仍由宿主单独配置与授权。

宿主在合适的交接点显式保存当前焦点。仓库构建后可使用实验性深路径；工具结果中的 focus 也可作为同形状输入：

~~~ts
import {
  saveConversationReferences,
  deleteConversationReferences
} from "./dist/conversation/recovery.js";

await saveConversationReferences(referenceFile, session.focus());
// 不再需要该交接引用时，由宿主明确删除；不删除 run 或 queue。
await deleteConversationReferences(referenceFile);
~~~

referenceFile 建议放宿主私有的 .agent_workspace 内。文件只包含格式版本和 current/suspended 的 projectRef/taskRef/runId，不保存 token、messageRef、提示、检查输出、路径或权限。保存由宿主串行协调；工具和迟到结果不会自动覆盖该文件。删除引用文件不等于删除底层运行数据；反过来，底层 run/artifact 已删除时，保留的引用也不能重新创建它们。

重开 Pi 时由可信宿主明确选择项目映射和历史结果，再加载恢复 wrapper：

~~~ts
import { createSparkleExtension } from "pi-sparkle/extensions/pi-sparkle/index.ts";
import { referenceFile, sourceRepo, stateRoot, selectedRun } from "./host-config.js";

export default createSparkleExtension({
  conversationRecovery: {
    referenceFile,
    projects: [{ projectRef: "project-one", sourceRepo, stateRoot }],
    tasks: [{
      projectRef: "project-one", taskRef: "fix-label", kind: "direct",
      runId: selectedRun.runId,
      artifactId: selectedRun.artifact.id,
      sourceRevision: selectedRun.sourceRevision
    }]
  }
});
~~~

selectedRun 是宿主从已有真实运行结果中明确选择的引用，不是模型提交的对象。direct 的 runId/artifactId/sourceRevision 必须同时提供或同时省略；省略时任务仍可定位，但历史证据不可用。任意 taskRef 不能自动匹配为 queue item、native task 或其他项目的 run。文件中的 runId 必须符合宿主映射；不能只因为两个仓库有相同 commit 就认作同一个项目。

与 P1 相同，用 Pi 加载该 wrapper，先调用 sparkle_conversation_focus 取得新的 generation/token。conversationRecovery 和 conversation 不能同时配置。question/focus/restore 保持原来的闭合参数；status 返回 recovery-status：

| 字段 | 含义 |
|---|---|
| facts.observedAt / provenance | 本次观察时间；引用关系明确标为 host-bound |
| facts.readOnly | 固定 true，不构成执行或应用许可 |
| facts.source | 当前 Git revision、dirty 与 available/stale/unavailable 信息 |
| facts.tasks | 允许的任务引用、最小 run/item/action 状态与失效原因 |
| staleFocus / focus | 读取期间是否换过焦点；旧结果不会覆盖新焦点 |

每次 status 都重新读取事实。源码变化、脏工作区、缺失或损坏证据、截断事件尾行会被明确拒绝或标为失效。历史 run 状态不是整个任务已验收，也不是允许再次执行。输出不会包含整个 run 问答、队列目标、action canonical 输入、claim token 或检查器正文。

队列任务使用 kind: "queue" 和显式 itemId；对应项目还需要既有 controller 与 queuePath。恢复会先检查 queue 文件及其同目录 actions/actions.json 已存在，再调用 controller.status()，仅投影已注册任务的状态。既有 status 可能短暂使用读锁；读取不是跨存储事务，外部并发删除也不受该检查原子保护。缺失存储不应被当作新项目初始化。

缺失、损坏或不被允许的引用文件不会退回可执行会话。恢复没有补齐 executorFactory 到 runId 之间的崩溃窗口，也不提供跨进程 exactly-once。遇到未对账的执行，宿主仍须核对原有运行和副作用责任后，另行决定后续工作。
