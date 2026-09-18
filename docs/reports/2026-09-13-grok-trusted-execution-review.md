# Grok trusted-execution review — 2026-09-13

## 结论

**REQUEST CHANGES：G0～G3 已合并，但 G1A/G1B 的关键验收仍有 4 个可复现缺陷（3 个 P1、1 个 P2）。** 不应继续开放默认 coding CLI、真实 provider 或 F6。既有 gate 通过不覆盖这些反例。

范围：`6ee16a3722fda35d9b6098144602f199fb0a7d0f..fe2533014e76dcddfd10beada5dc22ecec4c2a8a`（PR #37～#41）。本次重点审查新增执行证据、工具/存储边界与 integration；不是全仓安全认证。未修改产品代码。

## Identity / 已核验交付

- 审查者：本会话 coding assistant；与 Grok 实施输出分开检查、实际运行命令；不是人类批准，也未另行启动外部 reviewer。
- 环境：Windows，Node `v24.18.0`、pnpm `10.17.1`。
- 隔离 checkout：`.agent_workspace/grok-review/tree`，detached `fe2533014e76dcddfd10beada5dc22ecec4c2a8a`；检查后 tracked worktree clean。
- 原主工作区仍保留用户修改及旧 HEAD，本次没有 pull/reset/stash/push/merge。
- 远端 main 实时查询为上述 head；[PR #37](https://github.com/Xhhemoing/pi-sparkle/pull/37)、[#38](https://github.com/Xhhemoing/pi-sparkle/pull/38)、[#39](https://github.com/Xhhemoing/pi-sparkle/pull/39)、[#40](https://github.com/Xhhemoing/pi-sparkle/pull/40)、[#41](https://github.com/Xhhemoing/pi-sparkle/pull/41) 均 MERGED，每项 PR 的三个 hosted checks 均 SUCCESS。留档：`.agent_workspace/grok-review/{pr-status.json,remote.txt}`。

## Findings

以下位置均指审查 SHA，不是旧主工作区同名文件。所有复现只访问本次创建的 synthetic fixture，无真实用户文件/凭据。

### R3 — P1：悬空 symlink 绕过写入边界（CWE-61）

**位置：** `src/execution/paths.ts:20-21,44-54`；调用路径 `src/pi-adapter/worktree-coding-tools.ts` 的 write tool。

- 根因：`existsSync` 跟随 link。link 指向不存在的文件时返回 false，因此跳过 `lstatSync` 和 `realpathSync`；最终 `writeFile` 跟随同一个悬空 link，在根外创建文件。第二次路径检查仍使用相同条件，无需竞态即可绕过。
- 复现：在 fixture worktree 内建 `link.txt`，目标为另一临时目录下尚不存在的 `outside-new.txt`；调用 `sparkle_write_file({path:'link.txt',contents:'outside sentinel'})`。
- 实测：`{"rejected":false,"outsideContent":"outside sentinel"}`。预期拒绝且根外目标不产生；断言失败。此 Windows 环境能创建 file symlink，本用例没有跳过。
- 影响：即使 `sparkle_run_command` 默认 deny，仅写文件工具也能越出 worktree。限定为工具已注入的路径，不声称默认 CLI 已暴露。
- 修复方向：用不跟随 link 的 `lstat` 检查每个已存在组件，区分“组件不存在”和“组件是悬空 link”；对 link 解析失败 fail closed。覆盖悬空文件 link、父目录 link/junction、正常新建文件；不能只靠更换 prompt 或竞态重试。

### R1 — P1：Git 引号/转义路径被错误解析，改文件却不改变指纹（CWE-20 / 完整性）

**位置：** `src/execution/worktree-snapshot.ts:75,101-123`。

- 根因：使用逐行 `git status --porcelain=v1 -uall`，剥双引号但不解 Git C-style 转义，再把反斜杠改成 `/`。中文路径成为不存在的伪路径，代码把读取不到的非删除项记为 `sha256:null`。检查前后都是 null，错误地判定一致。
- 复现：提交 `中文.txt=v1`，设 `core.quotePath=true`，检查前改为 v2，运行真实 Node 检查命令把同一文件改为 v3 并 exit 0。
- 实测：before/after 都记录 `path:"/344/270/255/346/226/207.txt", kind:"modified", sha256:null`，`check.ok:true`；预期 false，断言失败。
- 影响：合法非 ASCII 文件的中途变化可被独立验收漏掉；不是只影响显示名称。
- 修复方向：使用 NUL-delimited porcelain，正确处理记录及 rename/copy 的额外路径；不要拆 ` -> ` 或猜测转义。非删除项无法读取时拒绝/明确 unsupported，不能悄悄当成稳定 null。不要用关闭 `core.quotePath` 的用户配置“修复”。
- 对照：另测 staged delete 后同名 untracked 重建，内容变化被当前实现检测到，**该假设未构成发现**；保留为通过对照，不扩写成第五个 bug。

### R2 — P1：高层 closed-loop 入口复活已删除 run（隐私/生命周期）

**位置：** `src/execution/closed-loop.ts:72-75`，`src/execution/loop-artifact.ts:50-57`。

- 根因：`runClosedLoopCheck` 在取 artifact 锁前直接递归 mkdir run directory；artifact 的 `assertRunPresent` 仅检查目录可访问。因此底层 save/read 的“删除后拒绝”可被高层 API 绕开。
- 复现：创建 fixture run → `deleteRunRecords` → 确认目录已不存在 → 用同一 runId 调用 `runClosedLoopCheck`（真实 Node `process.exit(0)`）。
- 实测：`{"revived":true,"accepted":true,"error":null}`；预期 run 持续不存在且调用拒绝，断言失败。
- 影响：在隐私删除后重新写入同一 run 的持久化材料，并标记 accepted。原 lifecycle test 只直接调用 save/read，未覆盖该真实入口。
- 修复方向：run 初始化归已有 durable run 生命周期；检查入口不得隐式建 run。存在性检查不能只看目录，应与既有 run event/identity 协议一致；删除/保存复用同一锁且不能嵌套同一锁。使用真实 run fixture 更新 G2 测试，不用裸 mkdir 掩盖生命周期。

### R4 — P2：独立检查忽略单独的 stdout/stderr 上限（资源策略/验收）

**位置：** `src/execution/independent-check.ts:102,120-123`。

- 根因：`spawnSync.maxBuffer` 取两个上限的最大值；返回后未像 coding tool 一样逐 stream 检查字节数。进程 exit 0 即可满足这部分 ok 条件。
- 复现：host policy `maxStdoutBytes:8,maxStderrBytes:1024`，Node 写 stdout 64 bytes、exit 0。
- 实测：`{"stdoutProduced":64,"stdoutLimit":8,"stderrLimit":1024,"ok":true,"exitCode":0}`；预期拒绝或 ok=false，断言失败。
- 修复方向：统一工具与独立检查的进程结果验证；任一 stream 超限、spawn/timeout/truncation error 均不得 PASS；验证正整数/安全范围配置，保留不同上下限的测试，错误信息不复制原始输出。

## Commands / 当前验证

除主工作区文档检查外，下列产品命令 cwd 均为 `.agent_workspace/grok-review/tree`。

| 命令 | 结果 | 证据 |
|---|---|---|
| `pnpm install --frozen-lockfile --offline` | exit 0；提示 @google/genai、protobufjs build scripts ignored，未主动批准 | `install.log` |
| `pnpm test -- test/unit/execution/ test/unit/pi-adapter/worktree-coding-tools.test.ts test/integration/execution/` | **PASS**；38 tests / 38 pass / 0 fail / 0 skip | `focused.log` |
| `pnpm exec tsx --test ../review-regressions.test.ts` | **FAIL / exit 1**；5 tests / 1 pass / **4 fail** / 0 skip | `regressions.log` |
| `pnpm gate` | **PASS / exit 0**；workflow/typecheck/lint/test/build；2766 tests / 2748 pass / 0 fail / **18 skipped** | `gate.log` |
| `pnpm security:probe` | exit 0；status ok / passed 26 / openFindings [] | `security-probe.log` |
| `pnpm pi:probe` | exit 0；4 条 PASS | `pi-probe.log` |
| `git diff --check`（审查 checkout） | exit 0，tracked tree clean | 命令输出 |

日志根为 `.agent_workspace/grok-review/`。新增审查测试在其下 `review-regressions.test.ts`，不属于产品 `test/`，所以没有包含在既有 gate 的绿色计数中。失败是实际断言失败，不是环境/导入错误。原有 gate 的跳过项含平台权限、并发和 opt-in crash 条件；详见日志，未将 18 skip 当作 pass。

`security:probe` 的空发现只说明该 probe 的覆盖范围，不能推翻本报告实际复现的文件边界缺陷。

## 覆盖、优点与限制

- 已检查：command/argv binding、schema/fingerprint、run artifact save/read、工具路径/命令策略、closed-loop integration；既有正例与 provider/自报/篡改负例均实际运行通过。
- 已改善：自报与独立命令检查分离、命令默认 deny、普通已有 symlink 的边界、artifact 内容 hash 检查、G2 真 adapter loopback。
- G3 结论保持 **NOT READY**，正确区分 public drafts / oracle / runner wiring / seal；但其 §7 两个验证结果仍写“recorded at commit time below”且没有实际结果，后续补留档，不能把缺失记录冒充历史测试输出。
- 远端 task checklist 的 G0～G2 仍未勾选，部分旧 PR-B “待 merge”和 P3 旧路径也未对账；修复后按“merged / reviewed / accepted”分开更新，不批量打勾。
- 未覆盖：完整全仓安全审计、依赖漏洞数据库、Linux 上本次新增反例、任意恶意子进程 OS 隔离、真实 provider、benchmark、crash probe、custody/holdout；均不从本次测试推断通过。
- 未关闭：ADR-006、F-PROD、Outcome-supported、人类批准。冻结 CLI/Event/JSON 契约未改动。

## Handoff / 处理顺序

Grok 按 **R3 → R1 → R2 → R4** 分小提交修复（同一文件改动串行）；先移植本次负例进入产品测试并确认 RED，再实现，保存 GREEN 与最终 gate/probe。独立 reviewer 复验修复 head；SCM 只在 owner policy 允许时推送/合并，不重做 G0～G3。

可直接转发的完整任务书：[Grok review repair prompt](../superpowers/plans/2026-09-13-grok-review-repair-prompt.md)。原规划：[trusted execution](../superpowers/plans/2026-09-13-grok-trusted-execution.md)。

## 本次文档收尾

仅新增本报告/修复提示词并更新 `tasks/plan.md`、`tasks/todo.md` 跟踪项；不改产品源码。

- `node .agent_workspace/grok-review/check-docs.mjs`：exit 0；`review-doc-check: ok (4 records, 50 local links, 4 findings matched to regression evidence)`。
- 主工作区 `pnpm workflow:check`：exit 0；`workflow-check: ok (10 required files, 16 required headings)`。
- 主工作区 `git diff --check`：exit 0，保留 tasks/plan 与两个 learning/routing 测试既有 CRLF→LF 警告。
- 日志：`.agent_workspace/grok-review/{doc-check,doc-workflow-check,doc-diff-check}.log`。
- 审查结论仍 REQUEST CHANGES，四个产品缺陷未修复；新提示词未派发。这些文档检查通过不能替代失败的产品反例。
