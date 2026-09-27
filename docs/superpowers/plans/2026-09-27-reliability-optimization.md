# Reliability and Bounded Runtime Optimization Plan

> **For agentic workers:** Use the `executing-plans` workflow task-by-task when implementation is requested. Checklist items below are unimplemented acceptance work, not approval or completion claims.

**Goal:** 优先保护用户代码、确保取消与回收可信、修正证据与统计有效性，再优化实际 I/O 和内存成本，最后在既有批准边界内评估收益。

**Architecture:** 保留现有 CLI/flowchart、NativeSession、EventStore 和宿主模型桥接。先收敛跨入口的 apply、command、read、evidence 规则；复用现有注册记录、文件锁、隐私删除和中立结果接口。新共享模块只从两个已确认调用点提取，避免先建框架再迁移业务。

**Tech Stack:** TypeScript、Node.js `>=22.19.0`、`pnpm@10.17.1`、`node:test`、Pi 现有精确依赖、Git linked worktree、现有 JSONL/atomic-file/file-lock。

## Identity

- ID: `TASK-20260927-reliability-optimization`；日期：2026-09-27。
- Owner: coordinator 负责计划与证据；各包下的 owner 是职责分工，不表示已派工或获得人类批准。
- State: 用户于 2026-09-27 授权按计划实施并使用多 subagent；当前首批有界切片已获聚焦测试/源码审查，组合验证与其余验收仍 `in-progress`。O09a/b 由用户授权的协调会话在 `offline-determinism-o09` 独立 worktree 专属实施，待提交与证据交付后集成；O12 仍 `deferred`。实施与验证见[执行记录](../../reports/2026-09-27-reliability-implementation.md)。
- Inspected commit: `e1ce19c0f93d8e34e7ca25512c5d32d2743ba669`，这是定位依据，不新增冻结 baseline。
- Evidence: [本轮核对与命令记录](../../reports/2026-09-27-review-reconciliation.md)。
- Related authority: [ADR-008](../../decisions/0008-remove-sha256.md)、[状态矩阵](../../status-matrix.md)、[受控改进主计划](2026-09-25-controlled-improvement-roadmap.md)、[现有 R10/R11 计划](2026-09-21-evaluator-apply-boundary.md)。

## Global Constraints

- 所有命令使用 `pwsh`；脚本首行 `$ErrorActionPreference = 'Stop'`；文件读写显式 UTF-8。
- 默认不新增 hash、冻结 contract、baseline 或 gate；ADR-008 继续有效，ID 用既有 opaque reference，精确相等用直接字节比较。Git 自身 revision/tree 身份继续使用。
- 不得以简化为由删除已有安全措施；先写有行为意义的 RED 回归，再做最小修复。普通类型、主键/唯一性、短事务和现有锁能够解决的问题不再增加完整性系统。
- 只使用现有 `pnpm gate`、适用 probes 和 `pnpm prerelease`；不新设任务前置门禁。测量/执行证据必须先于收益结论。
- 工作树修改先核对归属；不同包不能同时修改同一文件。应用/删除只在测试临时仓库运行，保留失败证据。
- S0-min 仍未批准/冻结；R10/R11、F6 和真实 provider/数据预算批准不因本计划而关闭。

## Problem and Scope

当前最紧急的缺口集中在 apply 的并发变更保护、文件系统身份、取消与候选清理。另有证据重复计数、错误吞噬、重复状态恢复、并发配置写入与大日志重复 I/O。用户材料中的 R2/R7 已被后续代码修复，应保留并补足覆盖。

本计划覆盖用户 R1–R7、上一轮 A01–A16，及带空格路径、跨平台验证、跨子任务预算的后续设计。详细逐项处理见核对记录。

非目标：不切换数据库，不把 CLI/native 强行统一成一个引擎，不升级 Pi，不扩充 agent 角色，不开启在线 bandit/promotion，不做大规模目录重排，不启用真实 provider/holdout/生产 apply。

## Priorities and dependencies

P0 表示相关 apply 能力的用户数据风险；P1 表示正确性、安全边界或可靠性缺口；P2 表示性能、可用性和后续设计。工作包按可独立审阅的小切片交付，不强制压成六个大 PR。

| Package | Priority / owner | Scope | Dependency / exit |
|---|---|---|---|
| O01 | P0/P1 / native owner | 非破坏性 apply + candidate 真实归属 | 第一优先；并发用户修改、HEAD、索引保留；相关 R10/R11 边界仍开放 |
| O02 | P1 / execution owner | 异步可取消命令 + delegate setup 清理 | O01 后整合 apply；NativeSession 局部清理可独立先修 |
| O03 | P2 / native owner | issued ownership、跨实例清理、路径参数 | O01 身份规则；复用注册记录；持久化状态设计走既有 R10/R11 |
| O04a/b/c | P1 / privacy、config、adaptation owners | 删除错误 / 配置事务 / registry 恢复 | 三个独立修复，可与 O01 分别推进 |
| O05 | P1 / evaluation owner | 唯一样本与报告证据验证 | 不依赖 S0；不关闭 F6 |
| O06a/b/c | P1/P2 / native/context owner | 有界分页 / 上下文计数 / 多模型补测 | 保留 R2/R7 现有实现；接口变更独立审查 |
| O07 | P2 / persistence owner | JSONL 尾部读取、真正增量读取 | 保持 checkpoint/event/recovery 语义 |
| O08a/b | P2 / runtime owner | 队列复杂度 / 控制请求排序 | 各自独立；先定义顺序语义再触碰持久化 |
| O09a/b | P1/P2 / offline analysis owner | logit 排列不变性 / 聚类规则 | 与效果评估分离；保持 offline-only |
| O10 | P1/P2 / learning owner | 历史重复、读取预算、账本成本 | 正确性修复可独立；新 host outcome 接线依赖 S0-min/L1 |
| O11 | P1/P2 / release & tooling owner | 现有安全豁免、跨平台覆盖、状态一致性 | 随各包交付，最后做组合验证 |
| O12 | deferred / runtime & experiment owners | 总预算、并发、收益试验、热点拆分 | 核心正确性通过后提交具体设计；真实试验仍需原批准 |

推荐顺序：**O01 → O02 → O03**；同时处理不重叠的 **O04、O05、O11 豁免修复**。随后 **O06 → O07/O08 → O09/O10**。O11 的测试与证据随每个包交付，不拖到最后。O12 最后评估是否值得实施。

既有路线保持 **B0（已接受）→ D1 review / S0-min owner decision → L1 → L2 → final review**。本计划提供缺陷修复，不重开 B0，不用本轮 32 个测试替代 D1/S0-min/post-L2 的验收。

## O01 — Preserve user changes and prove candidate ownership

**Files/symbols:** `src/native/apply.ts::{apply,reverifyCandidate,dispose}`；`src/native/write-preflight.ts::prepareNativeWrite`；`test/integration/native/apply.test.ts`；`test/unit/native/apply.test.ts`；`extensions/pi-sparkle/index.ts` 的 apply 结果说明；对应状态矩阵文字。Owner: native owner。

**Design:** 先拒绝 source 自身、外部仓库、失效 worktree、别名/路径替换，再运行候选命令。核对规范化真实路径、Git common directory、worktree 注册和 base revision；HEAD 相同不等于属于同一仓库。候选复验后、源更新前复查源的分支/HEAD/index/worktree 状态。merge 拒绝时不触碰原有文件；结果与预期不符时读取状态、保留候选并报告明确的“未应用/已应用/无法自动确定”。不能把任何错误都映射为 `reset --hard`。

仅依靠第二次检查仍不能消除检查后的竞态；并发写入若无法证明属于本操作，就保留现场，不宣称自动恢复成功。不新增全局长锁。Git/index 锁不能阻止编辑器，版本号也不能表示未提交内容。先完成最小非破坏性修复；需要持久化 crash 状态时进入 O03/R10/R11，不能顺手构造新授权体系。

- [ ] RED：复验命令期间在 source 写入/暂存不同内容，或切分支/前进 HEAD；拒绝后逐字节和 Git 状态比较，任何第三方变更必须保留。
- [ ] RED：`candidatePath === sourceRepo`、指向同一路径的 junction、外部仓库、已注销 worktree，全部在 verification marker 产生前拒绝。
- [ ] 修复上述路径；将已有 `mid-apply HEAD drift` 测试改为保留第三方提交并披露歧义，不删去 hook 故障覆盖。
- [ ] 检查成功路径仍应用已复验候选，失败保留 candidate 与 run evidence；写入既有 R10/R11 的边界修正记录。

核心行为断言（放入现有真实 Git fixture）：

```ts
await assert.rejects(() => session.apply(input));
assert.deepEqual(await readFile(userFile), userBytes);
assert.equal(git(repo, ["rev-parse", "HEAD"]).trim(), userHead);
assert.equal(git(repo, ["diff", "--cached"]), userIndexDiff);
```

**Verify:** `pnpm test -- --test-concurrency=1 test/unit/native/apply.test.ts test/integration/native/apply.test.ts`，之后 `pnpm gate`、build 后 security/Pi probes。Abort: 任何测试丢失用户字节、索引或 ref，停止自动 apply 的交付，保留现场。

Implementation correction (2026-09-27): real Git hook evidence requires two-tree checkout followed by guarded ORIG_HEAD/branch ref updates, with no index/worktree writes after hooks. Detached source HEAD is refused; the candidate remains detached. Partial checkout/ref failures retain source and candidate without automatic rollback. See the [ADR-006 correction](../../decisions/0006-pi-extension-reverse-adapter.md#2026-09-27-reliability-correction--preserve-source-changes). This narrows historical merge/rollback wording, not R10/R11 or production-apply approval.

## O02 — Cancellation, subprocess completion and setup cleanup

**Files/symbols:** 新增 `src/execution/command-runner.ts` 与 `test/unit/execution/command-runner.test.ts`；修改 `src/execution/independent-check.ts`、`src/execution/closed-loop.ts`、`src/pi-adapter/worktree-coding-tools.ts`、`src/native/apply.ts`、`src/native/session.ts`；回归 `test/unit/native/session.test.ts`、`test/integration/native/apply.test.ts`、`test/unit/execution/independent-check.test.ts`。先检索所有 `runIndependentCheck` 调用者，完整覆盖 Promise 传播。

**Design:** 从独立检查和命令工具两处真实调用提取异步 runner。输入承接既有 `authorizeCommand` 的 executable/argv/cwd/env/timeout/stdout/stderr budgets，加 `AbortSignal`；输出区分 exit、start error、cancel、timeout、output limit。进程收尾以 close/实际退出为准；取消后必须确认子进程及受管理子树结束。保留 shell-less 执行和 host command policy。

NativeSession 从 run 创建后立即覆盖 setup 的清理路径：projector bind/listener 安装失败时取消、等待 done settle、移除 active/listener，再抛原错误。取消在源修改前阻止 apply；源更新已经启动则完成状态核对，不能谎报“取消成功且未修改”。

- [ ] RED：pre-abort、stat 后、verification 中、merge 前、merge 中五种时点；心跳 timer 在命令运行中仍能推进。
- [ ] RED：超时、输出超限、child spawn 失败、child 再 spawn 的清理；没有遗留可运行进程或未处理拒绝。
- [ ] RED：预绑定 projector 令 delegate setup 抛错，返回后 `activeCount === 0`，无后台分析。
- [ ] runner 两调用点转为 await，更新工具 signal 传递和 apply 状态披露；保持原验证记录字段含义。

**Verify:** `pnpm test -- --test-concurrency=1 test/unit/execution/command-runner.test.ts test/unit/execution/independent-check.test.ts test/unit/pi-adapter/worktree-coding-tools.test.ts test/unit/native/session.test.ts test/integration/native/apply.test.ts`；O11 跑 Linux/Windows 实际进程测试。Abort: 取消不能证明完成时明确返回未完成清理状态，不进入源更新。

## O03 — Issued candidate lifecycle and path-safe input

**Files:** `src/native/apply-registration.ts`、`src/native/apply.ts`、`extensions/pi-sparkle/index.ts`；`test/unit/native/apply-registration.test.ts`、`test/integration/native/apply-registration.test.ts`、`test/unit/native/extension.test.ts`。Owner: native owner。

**Design:** 在现有 run-scoped registration/receipt 中承接 source identity、candidate ownership 与生命周期，避免新增平行 CandidateRegistry 存储。随机 handle 不是真实性证明；重建时仍按 O01 重验当前文件系统。`dispose` 使用完整已签发身份，而非只给路径或放开 managed 校验。持久化字段/可恢复 apply 协议属于现有 R10/R11 的设计范围，保持未批准状态直到原决策关闭。

- [ ] RED：`issue → apply → 新管理实例 → dispose` 成功；相同 dispose 重试明确幂等，外部目录始终拒绝。
- [ ] RED：run 证据仍存在；failed rm/permission/占用不能返回 `DISPOSED`；路径被替换时不执行 fallback recursive rm。
- [ ] RED：source/candidate/state-root 带空格、中文、引号；为现有 host command 增加结构化 JSON 输入形式并保留简单五参数兼容，不用 shell 执行解析结果。
- [ ] 扩展既有记录的重建/删除语义；旧记录缺必要身份时明确拒绝或仅库存展示，不自动升级为可应用。

**Verify:** `pnpm test -- --test-concurrency=1 test/unit/native/apply-registration.test.ts test/integration/native/apply-registration.test.ts test/integration/native/apply.test.ts test/unit/native/extension.test.ts`。Abort: 无法确认 ownership 时保留候选，不清理整个父目录；不将 run evidence 与 worktree 一起删除。

## O04 — Small correctness repairs with independent delivery

### O04a: privacy errors are not absence

**Files:** `src/privacy/deletion.ts::statExists` 及其调用者；`test/unit/privacy/deletion.test.ts`、`test/unit/privacy/adaptation-plane-closure.test.ts`；`test/integration/cli/delete.test.ts`。

- [ ] RED：存在的记录在 stat 阶段返回 EACCES/EBUSY/EIO，调用必须失败并保留原因；已发生的部分删除继续披露。
- [ ] 仅 ENOENT 表示缺失；ENOTDIR 在各调用点明确判定，不能统一吞掉。
- [ ] 执行聚焦删除测试，再执行 `pnpm gate`、`pnpm security:probe`。既有安全措施与正常 absent/idempotent 路径都保留。

核心修复原则：

```ts
catch (error) {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
  throw error;
}
```

### O04b: providers config updates are complete transactions

**Files:** `src/config/providers-config.ts`；`src/persist/atomic-file.ts` 仅在独立复现仍证明底层发布缺陷时修改；`test/unit/config/providers-config.test.ts`、`test/unit/persist/atomic-file.test.ts`。

- [ ] RED：同进程及两个子进程交错 enable/disable/set-default，不丢已成功提交的更新；Windows 不跳过这条应用级竞态。
- [ ] 用现有 `withExclusiveFileLock` 覆盖 load→transform→atomic save；lock-held helper 防止同一路径嵌套死锁，保持公共 save 的替换语义清楚。
- [ ] RED：token limit 必须正安全整数；cost 必须有限且非负；拒绝重复 provider/model IDs 和显式非法类型，保留缺失定价及合法 0。
- [ ] `pnpm test -- --test-concurrency=1 test/unit/config/providers-config.test.ts test/unit/persist/atomic-file.test.ts`，再 `pnpm gate`。类型校验和普通短事务足够，不新增 hash/版本冻结。

### O04c: registry restoration is validated before mutation

**Files:** `src/adaptation/promotion.ts::parseRegistrySnapshot`、`src/adaptation/registry.ts::restore`；`test/unit/adaptation/promotion.test.ts`、`test/unit/adaptation/registry.test.ts`。

- [ ] RED：同值及冲突的重复 version/candidate/intent、重复 active identity、悬空引用全部拒绝；之前可读 registry 在失败后不变。
- [ ] 用 Set 和临时 Map 校验唯一性、内容/parent/active/pending 关系，然后一次替换状态；不在校验完成前 clear 旧 map。
- [ ] `pnpm test -- --test-concurrency=1 test/unit/adaptation/promotion.test.ts test/unit/adaptation/registry.test.ts`，再 `pnpm gate`。兼容性风险：以前被静默接受的损坏存储开始拒绝，需明确诊断，不自动修复磁盘。

## O05 — Unique pairs and evidence-backed report validation

**Files:** `src/experiments/comparison-report.ts::{computeComparisonReport,validateComparisonReport}`、实际使用报告作接受判断的调用点（实施时用 `rg` 找全）；`test/unit/experiments/comparison-report.test.ts`。Owner: evaluation owner。

- [ ] RED：单 episode 复制五次不得成为五个独立样本；相同 ID 冲突值同样拒绝；不同 taskFamily 不绕过 episode 唯一性。
- [ ] 在生成报告前拒绝重复 ID。沿用 `episodeHash` 现有字段名作为 identity，不恢复密码学 hash；如确需一 episode 多 pair，另明确复合主键，不能临时把重复都算独立。
- [ ] 现有 validator 只有 report，不能空造唯一性验证。接受方必须拿原 records 重算并比较 report；legacy report-only 检查保留结构用途，不能独立授权生产接受。必要的接口变更与 pinning tests 单独审查。
- [ ] 小样本、simulation、无独立证据不关闭 F；相同 five unique fixtures 的既有正常报告继续有效。

核心 RED 断言：

```ts
assert.throws(
  () => computeComparisonReport(Array.from({ length: 5 }, () => ({ ...row })), card, [], config),
  /duplicate|unique/i
);
```

`row/card/config` 使用核对报告中已运行的确切输入。**Verify:** `pnpm test -- --test-concurrency=1 test/unit/experiments/comparison-report.test.ts`，再 `pnpm gate`。这是 P1 证据缺陷修复，不声称现实中的 F6 曾被关闭。

## O06 — Bounded reads, projection context and native route coverage

### O06a: real read bounds and paging

**Files:** `src/pi-adapter/worktree-coding-tools.ts`、`src/pi-adapter/native-executor.ts`、`src/execution/paths.ts`（确需共享校验时）；`test/unit/pi-adapter/worktree-coding-tools.test.ts`、`test/unit/pi-adapter/native-executor.test.ts`。

保留现有小文件调用；增加 `offset`/`limit` 和 `nextOffset`/`eof`，明确单位为字节。先 open/fstat 拒绝非普通文件，再限定实际 `read` 长度，处理短读、增长、UTF-8 边界与越界。为识别 UTF-8 边界至多额外读 3 bytes；检测实际消耗，不以返回字符串长度充当 I/O 上限。

- [ ] RED：100 KiB+ 中文/emoji 源码可分页重建；每页实际读取量 ≤ requested bound + 明确的小额边界读取。
- [ ] RED：文件变化、路径别名/替换、目录/特殊文件、超限参数均有明确结果；保留 secret 路径和 resolvedPath 信息。
- [ ] metadata 变化检测不等于内容完整性。普通分页标明 weak/change-detection 语义；需要同一不可变内容时只复用已获准的 run-scoped observation 对象及现有限额，不能默认开启归档或增加新 snapshot/hash 系统。

### O06b: correct identity is not per-worker exposure

**Files:** `src/pi-adapter/observation-tools.ts`、`src/pi-adapter/native-executor.ts`、`src/native/session.ts`；`test/unit/pi-adapter/observation-tools.test.ts`、`test/integration/context/observation-lifecycle.test.ts`。

- [ ] 保留 `ref.id` + exact-byte dedupe，以及 middle-only-mutation 回归；不重写 R7 已修复代码。
- [ ] RED：worker A 已读两次不能让 worker B 第一次看到的正文直接被替换。按稳定的实际模型上下文/attempt 标识管理计数；切上下文、重试、resume 的初始可见性分别测试。若无法获得可信上下文 ID，保守发送正文。
- [ ] recall budget 按已定义作用域累计，测试并发调用在 await 前预留预算、失败释放策略；完整正文、placeholder、recall 分别测量，禁止把字符缩减当 token/费用收益。

### O06c: preserve the repaired model bridge

**Files:** `test/unit/pi-adapter/native-executor.test.ts`、`test/unit/native/extension.test.ts`、`test/helpers/loopback-openai-provider.ts`；产品修改仅限被新失败测试证明的缺口。

- [ ] 同 provider 双模型、跨 provider 双活跃任务、不同请求认证、本地 HTTP/SSE 失败与取消；断言实际请求模型/认证/provider 与路由事实一致、失败没有静默 fallback。
- [ ] 明确 `sparkle_delegate.model` 的当前默认/偏好语义与 per-task routing 的关系；不得仅通过帮助文字把现有偏好变成硬 pin。

**Verify O06:** `pnpm test -- --test-concurrency=1 test/unit/pi-adapter/worktree-coding-tools.test.ts test/unit/pi-adapter/native-executor.test.ts test/unit/pi-adapter/observation-tools.test.ts test/unit/native/extension.test.ts test/integration/context/observation-lifecycle.test.ts`，再 `pnpm gate`、security/Pi probes。没有真实 provider 调用。

## O07 — Remove repeated whole-log reads

**Files:** `src/persist/jsonl.ts::{repairCrashTruncatedTail,readJsonlObjectsFromOffset}`；`src/run/flowchart-checkpoint.ts`、`src/run/event-store.ts` 仅按接口需要最小修改；`test/unit/persist/jsonl.test.ts`、`test/unit/persist/jsonl-offset.test.ts`、`test/unit/run/event-store-offset.test.ts`、`test/unit/run/flowchart-checkpoint.test.ts`。

- [ ] RED：N=100/1,000/10,000 records，统计实际 fs read bytes。已有完整换行的 append 读取固定尾字节；固定大小 suffix 的 offset 读取不随 prefix 线性增长。
- [ ] 正常 append 读尾字节；仅不完整尾从末端分块查找 newline。offset 读 `[offset-1, EOF)` 的必要范围；仅出现错误且需全局行号时流式统计前缀，不新增 checkpoint baseline。
- [ ] 保留 CRLF、空行、UTF-8 byte offsets、无 newline 的完整 JSON、截断尾、中部损坏、只读不变更、fsync 和 delete/replay 语义。特别测试完整尾行没有 newline 后继续 append，不能拼出无效 JSON。
- [ ] 记录前后 read bytes、heap peak、append/checkpoint 时延；不承诺未测量的倍数收益。仅读字节规模进入确定性回归，墙钟时间不加脆弱阈值。

**Verify:** `pnpm test -- --test-concurrency=1 test/unit/persist/jsonl.test.ts test/unit/persist/jsonl-offset.test.ts test/unit/run/event-store.test.ts test/unit/run/event-store-offset.test.ts test/unit/run/flowchart-checkpoint.test.ts`，再 `pnpm gate`。`pnpm bench:runtime` 保持显式 opt-in；未运行就标 NOT RUN。

## O08 — Event buffering and control ordering

### O08a: queue cost

**Files:** `src/pi-adapter/kernel.ts::AsyncEventQueue`、`src/pi-adapter/pi-executor.ts`；`test/unit/pi-adapter/kernel.test.ts`、`test/integration/pi-adapter/live-stream.test.ts`。

- [ ] RED/measurement：100,000 event burst + 慢 consumer，记录顺序、settlement、峰值 backlog；close 后排空、cancel 后终态都可检验。
- [ ] 先将 shift 改为 head-index deque 并清理已消费引用/分批压缩；不改变事件内容与顺序。确认 executor history 的实际用途后再去重引用。
- [ ] 无界内存另行根据测量收敛；不能让 Pi listener 等待 consumer 形成死锁，不能静默合并/丢掉 tool、terminal 或已承诺的 delta 事件。超限行为必须有显式失败/取消与终态交付规则。

### O08b: control request order

**Files:** `src/run/control-plane.ts`、`src/run/flowchart-run.ts` 的 drain；`test/unit/run/control-plane-single-writer.test.ts`、`test/integration/cli/pause-inject.test.ts`。

- [ ] RED：受控时钟、逆序随机 ID 下先完成 inject submit 再 submit pause，观察实际应用顺序与 ack。相同时间和并发 submit 单列，不能用 timestamp 宣称严格 FIFO。
- [ ] 先写清单写者/先后完成请求的语义。若要求严格顺序，复用最短提交事务为现有请求分配序号；旧无序号请求与新请求混用规则需明确，不能静默迁移或引入生命周期长锁。
- [ ] 如产品只承诺确定性排序，采用 `(submittedAt, requestId)` 并如实标注不保证毫秒内 FIFO；两种契约不在实现中混用。

**Verify:** 分别运行上述文件的 `pnpm test -- --test-concurrency=1`，之后 `pnpm gate`。O08b 的精确顺序契约在实施前形成短设计，不预先更改持久化格式。

## O09 — Deterministic offline conclusions

### O09a: logit

**Files:** `src/routing/offline-logit.ts`、`test/unit/routing/offline-logit.test.ts`，必要时同步 `src/routing/offline-types.ts` 的已有结果解释。

- [ ] RED：相同 records 的多次固定 shuffle，结果按 effect 名对齐后 diagnosis 相同、数值在明确浮点容差内；包括弱模型恰为 reference 的情况。
- [ ] stable levels、canonical row order、bootstrap sampling 顺序一起校正；参考水平不能作为真实“零问题”水平。为所有模型定义同一可识别预测 contrast，保留 singular/non-identifiable 返回 uncertain。
- [ ] 效应解释/阈值若改变，更新既有统计协议与版本说明，不把它包装成纯性能重构；真实收益单独评估。

### O09b: recurring patterns

**Files:** `src/learning/patterns.ts`、`test/unit/learning/patterns.test.ts`。

- [ ] RED：A~B、B~C、A!~C 的全部排列产生同一结果；severe one-off 和 negative control 不回归。
- [ ] 推荐显式的 complete-link 最低组内相似度规则，采用稳定身份排序和确定性 tie-break；它比当前 anchor 语义保守，需先记录规则变化。connected-components 会把不相似两端串成一组，不能与 complete-link 混称等价。

**Verify:** `pnpm test -- --test-concurrency=1 test/unit/routing/offline-logit.test.ts test/unit/learning/patterns.test.ts`，再 `pnpm gate`。本包只改善离线结论可信度，不改变 live routing。

## O10 — Bounded and repeat-safe history ingestion

**Files:** `src/learning/auto-loop.ts`、`src/learning/observation-ledger.ts`、`src/feedback/store.ts`（只在现有幂等键不能满足时）、相关 `test/unit/learning/{auto-loop,observation-ledger}.test.ts` 与 feedback 测试；删除回归复用 O04a。Owner: learning owner；遵循 B0 的 `LEDGER → BANDIT` 锁关系。

- [ ] RED：同目录执行两次，第二次没有新增持久化反馈/奖励/候选；corrupt/permission/超预算显式 incomplete，不能产出可信新候选。
- [ ] 在读取阶段限制文件数、单文件和总字节，避免 readFile 后才检查。预算参数从既有输入尺度和测量确定，文档记录超限行为。
- [ ] 保持 kill switch 仍允许观察、不允许学习。feedback 的观测幂等不能仅复用会被 kill switch 跳过的 bandit ledger；重用现有反馈身份/存储的唯一性实现，避免新 cursor store。
- [ ] 测试 feedback 已写/bandit 未写、bandit 已写/ledger 未写时重启重试；锁只保证并发互斥，不保证跨文件 crash 原子性。未解决的中间态必须拒绝重复奖励并披露恢复条件。
- [ ] O07 后测 1k/10k/100k ledger 的 read/write bytes、heap、锁等待。先批量更新和有界解析；不能删除旧 ID 破坏去重。只有测量显示单文件方案不满足目标时，另提交现有数据格式的分段/事务设计，保留删除与恢复语义。
- [ ] 新的中立 host outcome 持久化与历史窗口仍归 S0-min → L1 → L2；不新增 N1/N3，不趁修复扩展 live learning。

**Verify:** `pnpm test -- --test-concurrency=1 test/unit/learning/auto-loop.test.ts test/unit/learning/observation-ledger.test.ts test/unit/learning/bandit-store-atomic.test.ts test/unit/privacy/adaptation-plane-closure.test.ts`，再 `pnpm gate`、security probe。无法完成原子性证明时保留不完整状态，不能以“去重已实现”结项。

## O11 — Existing release checks, cross-platform tests and honest status

**Files:** `scripts/security-probe.mjs`、`docs/specs/release-gate.md`；新增 `test/unit/package/security-waiver.test.ts`；`.github/workflows/ci.yml`、`scripts/run-tests.mjs`（只有定位原因后才改）；`test/unit/persist/row-fuzz.test.ts`、`test/unit/package/workflow-check.test.ts`；active task/status 文档。

- [ ] RED：empty/unknown/unregistered/expired/wrong-release waiver 不掩盖 finding；packaged-secrets 永不可豁免。先保留当前空 register，显式拒绝未经登记的请求。若未来真正需要 waiver，再让现有登记成为机器可读的唯一来源，不添加新 gate。
- [ ] apply、path、cancel、dispose 和 providers 并发 tests 随相应包进入现有 Linux/Windows CI；hook 只能 POSIX 的路径如实 skip，并用跨平台故障 seam 覆盖同一行为，不把 Windows skip 当通过。
- [ ] 单独重现 2026-09-26 full-suite 超时，记录机器负载、test concurrency、耗时。先排除同时运行的其他测试，再比较有界并发。原因未明前不提高 20 s timeout 或禁用 fuzz；保留失败记录。
- [ ] `workflow:check` 只宣称它真正检查的内容。先修复实际矛盾的状态说明/链接，避免扩大为不必要的 Markdown gate。历史记录采用 dated correction，不能把旧 PASS 改成当前 PASS。
- [ ] 每个修复先 focused，再 `pnpm gate`；隐私/adapter 按既有工作流增加 `pnpm security:probe`、`pnpm pi:probe`，kernel 改动增加 `pnpm kernel-reuse:probe`。发布另跑已有 `pnpm prerelease`。

现有 `pnpm gate` 的失败必须完整披露，不能用单独两个 fuzz PASS 代替。build 后运行 dist probes，跳过的真实 provider/crash/benchmark 明列 NOT RUN 或 SKIPPED。

## O12 — Follow-on work, conditioned on measured need

本包是后续设计清单，不是本轮实施授权，也不构成已有问题修复的前置门槛。

1. **Run budget / provider concurrency:** 针对当前没有 cross-child spend ledger 的已披露限制，先从 `src/run/child-coordinator.ts`、`src/run/coordinator.ts`、`src/run/flowchart-run.ts`、`src/telemetry/model-invocation.ts` 和现有 cost-cap tests 形成具体设计：retry/model switch 累计、预留/结算、取消退款规则、未知定价策略、多个 delegate 合计并发。未知不能算 0；跨进程共享预算不能由单进程计数器冒充。
2. **Outcome evaluation:** 在 S0-min/只读 evaluator、预算/数据批准后，复用既有 evidence-first A/B/C 协议安排约 20–30 个预注册流程试验任务；确切样本量和停止规则由原 experiment owner 确定。对照固定单模型、静态路由、shadow 建议，测独立验收率、每通过任务成本、延迟、人工介入、取消/恢复；全失败时成本/成功不得报 0。shadow 并不能证明实际自适应执行收益，小样本不关闭 F6。
3. **Maintainability:** O01–O11 的行为稳定后，仅按已发现热点从 `flowchart-run.ts` 抽取 control drain、checkpoint、调度副作用；只移动结构的 PR 不改变 event/checkpoint/inspection 输出。没有代码测量支持时不替换 EventStore 或整套引擎。

## Gates, ownership and handoff

- 开始实施时重读当前 HEAD/worktree 与相关 task，不创建新的冻结 baseline。按包登记实际修改文件；同一个 `apply.ts`、`native-executor.ts` 或 `jsonl.ts` 同时只能一个 owner 写。
- 新增 schema、持久化事务、授权或现有冻结输出改变时先修订对应设计；普通 Set 校验、短锁、尾读、清理修复使用既有方法完成。
- 只有具体失败场景证明 Git、版本号、主键、事务、唯一约束、类型和普通测试都不足时，才提议 hash/freeze/baseline/gate；本计划未提出这类新增机制。
- 交付必须分别列 implementation、命令验证、独立 review、人类批准。代码存在、测试通过不等于所有 gates accepted。
- 需要回退实现时仅回退本包 Git 变更；不要执行用户源码的硬重置或无归属目录删除作为运行时恢复。

## Acceptance and closeout

### 2026-09-27 delivery authorization and coordinated ownership

用户进一步授权：完成当前可实施阶段 O01–O11 及适用验证/审查后，本地整合与合并、清理已交付工作区，清点并提交/push 项目内非敏感数据到 GitHub。协调会话确认这里不是只接受当前首批或 O09；O12 与既有人工/实验边界仍排除。Root 是唯一整合/合并/push 通道。

后续加急指示（同日）：先把已通过独立审查及完整 gate 的首批切片本地整合并同步 GitHub，不等待 O01–O11 全部结束才首次推送；余下切片继续后续提交。本段修订的是交付顺序，不把首批误标为全部完成。O09a 的 P1 复审未通过前不得合入，O09b/O08b 继续由协调会话交付。

- O09a/b 及其后的 O08b 由 `offline-determinism-o09` 协调工作区专属负责；root 不重复修改这两包。O08b 在实现前记录排序契约，测试不同时区、逆序 ID、实际 drain/ack 与同毫秒/并发语义。
- 先逐包完成 RED/GREEN、规格审查、质量审查，再在稳定集成树执行适用 gate/probes；不得把有界切片的 PASS 当作整包验收。
- 本地整合前重新检查各分支/工作区的 dirty state 与归属，保留用户原有修改；不使用 reset/强制覆盖。提交范围和本地 merge 结果须可审阅，push 前核对 GitHub remote 与待推差异；不默认 force-push。
- 未交付或仍在使用的 worktree 一律保留。仅对确认交付、不再使用的托管 worktree 使用原生 archive，保留恢复快照；先清点并保全 ignored 数据（归档工具不保留它们）。不修改用户全局目录，不删除未交付分支内容。
- 对项目 tracked/untracked/ignored 数据逐类清点后再决定发布清单。密钥、认证材料、原始私密会话与其他敏感数据不得提交/push；不能以 ignored 代替内容审查，也不能把“非敏感”扩大为上传项目外的数据。对于数据用途或敏感性不明的材料，先保留本地并请求明确处理。
- 记录合并前后 revision、适用验证、实际上传范围、未上传原因、归档清单及恢复方式。上述授权不代表这些步骤已经执行。

- [ ] O01 并发变更保护和候选身份真实 Git 回归通过。
- [ ] O02/O03 取消、setup 清理与跨实例候选回收通过，无虚假成功。
- [ ] O04/O05 删除、配置、registry、独立 pair 数据规则通过。
- [ ] O06 页读取有真实上限，projection 作用域明确，保留已修复模型/身份行为。
- [ ] O07/O08 有可复测的 I/O/内存/顺序证据，恢复与终态语义不回归。
- [ ] O09/O10 排列、重复、损坏、预算和 crash 中间态回归通过。
- [ ] O11 现有门禁完整通过，失败/skip/未跑项和跨平台结果保存在仓库。
- [ ] 原 S0-min、R10/R11、F6 等未关闭项明确保留；O12 的真实收益单独验证。

下一实施动作：先在临时 Git fixture 写 O01 的“复验期间用户改动、merge 拒绝仍保留”的 RED 测试；不是先改 rollback 或触发真实候选 apply。计划交付证据见[核对记录](../../reports/2026-09-27-review-reconciliation.md)。
