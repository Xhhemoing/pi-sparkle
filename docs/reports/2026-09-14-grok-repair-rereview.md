# Grok repair re-review — 2026-09-14

## 结论

**REQUEST CHANGES。原来的四个具体反例已修复，但还有三个相关边界缺口，不能整包验收。** 不重开已通过的旧反例，也不把尚未进入 PR 的本地代码当作已交付。

## Scope / Identity

- 独立复核：本会话 coding assistant，未参与本轮 Grok 产品修改；非人类批准。Windows / Node v24.18.0 / pnpm 10.17.1。
- 基线：`fe2533014e76dcddfd10beada5dc22ecec4c2a8a`。
- PR #42 head：`53571632904d45f5417eb545400028a103a72ae9`，OPEN，仅 R3/R1；三个 hosted checks SUCCESS。
- 完整本地整合候选：`412230aa6421a126c63dba964e322ae7ebd7b763`，tree 与 `58b016c5547f860580c4b9d5c096692538aa6f33` 相同，包含 R2/R4。
- 本次所有产品命令在 detached `.agent_workspace/grok-rereview/tree` 的完整候选上运行；不是在含脏修改的 `pi-sparkle-r-fix` 中验证，也不是对 PR #42 head 宣称全包通过。
- 远端 main 查询仍为 `fe253301`；本地 `local/merge-r3r4` 这个 merge commit 不代表 GitHub 已 merge。已发现 R-fix 工作区另有未提交 R2 修改，未触碰。
- 修改范围：本报告和 `tasks/plan.md` / `tasks/todo.md` 当前复核条目；不修改产品源码、不推送或合并。复核计划与日志位于 `.agent_workspace/grok-rereview/`。

## 原发现复验

原审查测试从 `.agent_workspace/grok-review/review-regressions.test.ts` 原样复制到新复核目录，保留输入与断言，仅通过其相对 `./tree/` import 指向新冻结代码。

| 原 ID | 本次实测 | 判断 |
|---|---|---|
| R3 悬空文件 symlink | rejected=true；outsideContent=null | 原根外新建反例通过，无平台 skip |
| R1 中文 quotePath | 正确记录中文路径和内容 hash；中途修改 ok=false | 原中文误解析反例通过 |
| R2 deleted-run revival | revived=false，抛缺失 run 错误 | 原隐式 mkdir 复活反例通过 |
| R4 单 stream 上限 | stdout 64 / cap 8 → ok=false | 原不对称上限反例通过 |
| R1b staged-delete 对照 | 内容改变仍 ok=false | 通过，非旧缺陷 |

**5 tests / 5 pass / 0 fail / 0 skip。** 下述新反例不能被这五条正向复验覆盖。

## Remaining findings

### RR1 — P1：NUL 解析丢弃 rename 源路径，文件集合改变但 fingerprint 不变

**位置：** `src/execution/worktree-snapshot.ts:110-118,158-165`（上述候选及 PR #42 均有该逻辑）。

- `parsePorcelainZ` 虽已解决引用/转义，却直接跳过 rename/copy 的第二路径，只记录 destination；`R` 随后归成 modified，source 的删除/迁移事实完全丢失。
- 复现：repo 中 `a.txt`、`b.txt` 内容相同；检查前 `git mv a.txt dest.txt`。检查命令执行 `git mv dest.txt a.txt`，再 `git mv b.txt dest.txt`。
- 实测 Git 事实从 `R  dest.txt\0a.txt\0` 变成 `R  dest.txt\0b.txt\0`；前后 fingerprint 却都只有 `dest.txt / modified / 相同 hash`，**check.ok=true**。
- 影响：a/b 哪个文件存在已经改变，却能通过“候选内容未变”的验收。这不是仅遗漏显示元数据。
- 修复：保留并编码 source/destination 及正确的 rename/copy 语义，或用等价的完整 working-tree 差异表达；不能将 copy 源误记为删除。与 include/exclude/allowedOutputDirs 的范围过滤一起验证。旧中文测试保持通过。
- 缺失测试：`test/unit/execution/worktree-snapshot.test.ts` 目前只断言目标路径存在，未断言源路径影响 identity。应增加上述 source-swap 真检查回归。

### RR2 — P1：文件名存在不等于 durable run；空/损坏 event log 仍获 accepted

**位置：** `src/execution/loop-artifact.ts:54-62`；`closed-loop.ts:71`；测试 `test/integration/execution/closed-loop.test.ts:38-41`、`pi-closed-loop.test.ts:60-63`。

- 当前 `assertRunPresent` 只 `access(events.jsonl)`，不校验事件内容或 run identity。新测试帮助函数 `seedDurableRun` 直接写空文件，把这种不成立的 identity 固化成正例。
- 复现：全新 runId 下分别放空 `events.jsonl` 和 `not-json\n`，调用高层 `runClosedLoopCheck`，command 为真实 Node exit 0。
- 实测：两种情况都 **accepted=true / error=null**。无 RUN_CREATED，也没有合法事件流。原“删除后不复活”已修复，不应混淆为旧问题仍原样存在。
- 影响：损坏或未初始化的运行获得持久化独立验收，偏离 fail-closed durable lifecycle 合约；限定为该 host/library 路径，不声称远程未经授权入口存在。
- 修复：复用既有 EventStore/replay/identity 验证确认匹配 runId 的有效初始化；空、损坏、中部非法、身份不符必须拒绝。按既有事件尾部恢复策略处理 torn tail，不另造冲突协议。有效 fixture 用真实初始化事件，不能空文件占位。
- 补受控 delete/write 交错测试，验证生命周期锁、不嵌套同一锁和删除后不产生 artifact；此次新增代码仍只有顺序删除用例。

### RR4 — P2：timeoutMs 未校验，0 被原样授权为“无限时”

**位置：** `src/execution/command-policy.ts:90-99`；`independent-check.ts` / coding tool 的 `spawnSync(timeout: authorized.timeoutMs)`。

- 新实现只验证 stdout/stderr cap，`timeoutMs` 仍使用 `policy.timeoutMs ?? 60000`。
- 复现：`authorizeCommand({allow:[{executable:'node'}],timeoutMs:0},'node',[])`。
- 实测：**authorized.timeoutMs=0**。Node child_process 的 timeout 0 表示不设 timeout，因此绕过本任务要求的正数执行时限；没有运行无限循环来证明这一点。
- 修复：对 timeout 使用正数安全整数和平台/API 支持范围校验；明确 undefined 的默认值；0、负数、NaN、Infinity、越界值不能到 spawn。分别验证工具和独立检查，保留正数 timeout 的实际停止回归。不要只改测试允许零。

## Commands and evidence

cwd：`.agent_workspace/grok-rereview/tree`；日志目录为其父目录。

| 命令 | 结果 | 日志 |
|---|---|---|
| `pnpm install --frozen-lockfile --offline` | exit 0；@google/genai/protobufjs build scripts ignored，未批准执行 | `install.log` |
| `pnpm test -- test/unit/execution/ test/unit/pi-adapter/worktree-coding-tools.test.ts test/integration/execution/` | **57 pass / 0 fail / 0 skip**, exit 0 | `focused.log` |
| `pnpm exec tsx --test ../review-regressions.test.ts` | **5 pass / 0 fail / 0 skip**, exit 0 | `original-regressions.log` |
| `pnpm exec tsx --test ../additional-regressions.test.ts` | **0 pass / 3 fail / 0 skip**, exit 1 | `additional-regressions.log` |
| `pnpm gate` | exit 0；workflow/typecheck/lint/test/build；**2785 total / 2767 pass / 0 fail / 18 skipped** | `gate.log` |
| `pnpm security:probe`（首次，误与 gate 并行） | **exit 1**，构建尚未产出 dist/feedback/redaction.js，ERR_MODULE_NOT_FOUND | `security-probe-prebuild.log` |
| `pnpm security:probe`（gate build 完成后重跑） | exit 0；status ok / passed 26 / openFindings [] | `security-probe.log` |
| `pnpm pi:probe` | exit 0；4 PASS | `pi-probe.log` |
| `git diff --check`（候选 checkout） | exit 0，tracked tree clean | 实际命令输出 |

首次 security probe 失败是本次验证调度错误：该脚本明确依赖 built dist，不能与尚未完成的首次 build 当作独立任务并行。保留失败日志，不归为产品缺陷，也不隐藏失败后只报告重跑结果。

新增反例在 `.agent_workspace/`，不在产品 gate 的默认 test 集合内，因此 gate 绿色和新增 3 个失败同时成立。既有 18 skipped 仍按平台/opt-in 条件单独保留，不计为 pass。

## 下一步 / Owner

1. **Grok：** 先修 RR1、RR2、RR4，不重复已经通过的旧修复。每项先把本报告精确场景纳入产品测试，RED→GREEN。
2. **SCM：** 将实际待审全量 head 对齐 PR；PR #42 当前只有 R3/R1，不得用它的 CI 作为 R2/R4 的交付证据。不要把本地 merge 名称视作授权或远端 merge。
3. **Grok / reviewer：** 替换空 event-log fixture；补 rename 源变化、durable identity、timeout 校验及删除/写入交错。提交完整 SHA、逐项根因/回归映射及精确命令结果。
4. **独立 reviewer：** 在最终同一 SHA 重跑旧五例 + 新三例、focused、gate，等 build 后再跑 security/Pi probes。
5. **Owner：** 只有上述边界验收通过后，再决定是否批准真实 provider/后续实验；F6 仍 NOT READY，不涉及 seal、oracle 或成本试验。

可直接转发 Grok：

> 旧四项原始反例已在 412230a 上全部通过，但复审仍 Request Changes。请只补三项：① worktree-snapshot 保留 rename 源路径，a/b 同内容交替 rename 到 dest 时必须检测出变化；② assertRunPresent 不得只 access events.jsonl，空/损坏/身份不符日志必须拒绝，正例用真实 RUN_CREATED 初始化而不是空文件；③ command-policy 拒绝 timeoutMs=0 等非法值，保持有限执行时限。先加真实失败测试再修复，补 delete/write 交错，不放宽旧断言。对齐 PR #42 的最终全量 head；在该 SHA 上复跑旧五例、新三例、focused、gate，build 后跑 security/Pi probes。不自动 merge、不跑真实 provider/holdout。具体复现、文件行和结果见本报告。

## Durable links / 文档验收

- [上轮审查](2026-09-13-grok-trusted-execution-review.md)、[原修复提示词](../superpowers/plans/2026-09-13-grok-review-repair-prompt.md)、[active plan](../../tasks/plan.md)、[checklist](../../tasks/todo.md)。
- 本次只更新复审报告和 active task 索引；未实施任何产品修复、未派发新任务、未 push/merge。
- 文档检查：`rereview-doc-check: ok (3 records, 51 local links, unchanged original tests, 5 pass / 3 new fail evidenced)`，exit 0。
- 主工作区 `pnpm workflow:check`：`workflow-check: ok (10 required files, 16 required headings)`，exit 0。
- 主工作区 `git diff --check`：exit 0；保留 tasks/plan 和两个 learning/routing 测试既有 CRLF→LF 警告。
- 日志：`.agent_workspace/grok-rereview/{doc-check,doc-workflow,doc-diff}.log`。产品新反例仍失败，不因文档验收变为通过。
