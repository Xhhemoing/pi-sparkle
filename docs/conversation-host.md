# 实验性对话宿主入口

本轮为宿主接通结构化请求与会话内焦点。宿主解释用户消息、选择已有项目/任务引用；`ConversationSession` 查询现有 controller 或调用既有 `startDevelopmentTask`。自然语言解析、Pi 扩展工具注册与跨会话恢复仍是后续工作。当前实施与验证见[计划](superpowers/plans/2026-10-18-conversation-presentation.md)和[记录](reports/2026-10-18-conversation-presentation.md)。

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
